#!/usr/bin/env python3
"""
build_mef.py - Pra-proses "MEF turunan DEM" per kotak grid untuk web app.

Menghasilkan GeoJSON berisi elevasi maksimum per kotak (1 derajat, 30', 15')
dari Copernicus DEM (DSM). Hasilnya BUKAN angka resmi ONC dan tidak boleh
menjadi satu-satunya acuan keselamatan penerbangan.

Contoh:
  # Wilayah kerja dulu (cepat), mis. sekitar Sulawesi Barat
  python build_mef.py --bbox 117 -4 120 0 --out public/data

  # Seluruh Indonesia (unduhan besar, jalankan sekali)
  python build_mef.py --out public/data

  # Pakai tile DEM yang sudah ada di folder lokal (tanpa internet)
  python build_mef.py --dem-dir ./dem_tiles --bbox 117 -4 120 0

Keluaran: <out>/mef_60min.geojson, mef_30min.geojson, mef_15min.geojson
(ubah awalan dengan --prefix, pilih ukuran dengan --cells).
"""
import argparse
import json
import math
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
import warnings
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

import numpy as np
import rasterio

M_TO_FT = 3.280839895
N_BASE = 4  # sel dasar 15' => 4 x 4 per tile 1 derajat
SUP = str.maketrans("0123456789", "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079")

# Pola nama tile Copernicus DEM di AWS Open Data. Verifikasi URL ini sebelum
# dipakai massal; kalau berubah, pakai --base-url atau --dem-dir.
SOURCES = {
    "cop30": {
        "base_url": "https://copernicus-dem-30m.s3.amazonaws.com",
        "code": "10",
        "label": "Copernicus GLO-30 DEM (DSM)",
    },
    "cop90": {
        "base_url": "https://copernicus-dem-90m.s3.amazonaws.com",
        "code": "30",
        "label": "Copernicus GLO-90 DEM (DSM)",
    },
}

DISCLAIMER = (
    "MEF turunan DEM, bukan angka resmi ONC. DEM Copernicus adalah model "
    "permukaan (DSM) dan tidak memuat toleransi rintangan vertikal. Jangan "
    "dijadikan satu-satunya acuan keselamatan penerbangan."
)


class Missing(Exception):
    """Tile tidak ada di sumber (umumnya tile laut)."""


# --------------------------------------------------------------------------
# Rumus MEF
# --------------------------------------------------------------------------
def mef_parts(max_m):
    """max_m (meter) -> (max_ft, mef_ft, ribuan, ratusan).

    mef_ft = elevasi maksimum dalam kaki, dibulatkan ke atas ke kelipatan 100.
    Contoh: 6549 ft -> 6600 ft -> (6, 6); 299 ft -> 300 ft -> (0, 3).
    """
    max_ft = round(max_m * M_TO_FT, 3)  # round dulu supaya kelipatan tepat tidak naik
    mef_ft = int(math.ceil(max_ft / 100.0)) * 100
    return max_ft, mef_ft, mef_ft // 1000, (mef_ft % 1000) // 100


def label_of(thousands, hundreds):
    return f"{thousands}{str(hundreds).translate(SUP)}"


# --------------------------------------------------------------------------
# Tile
# --------------------------------------------------------------------------
def tile_name(lat0, lon0, code):
    ns = "N" if lat0 >= 0 else "S"
    ew = "E" if lon0 >= 0 else "W"
    return f"Copernicus_DSM_COG_{code}_{ns}{abs(lat0):02d}_00_{ew}{abs(lon0):03d}_00_DEM"


def http_download(url, dest, retries=3):
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f, 1 << 20)
            return
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):  # S3 publik: objek tidak ada => 403/404
                raise Missing(url)
            last = e
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
            last = e
        if os.path.exists(dest):
            os.remove(dest)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"gagal mengunduh {url}: {last}")


def base_grid(path, lat0, lon0):
    """Baca satu tile 1 derajat -> grid 4x4 elevasi maksimum (meter) per sel 15'.

    grid[i][j]: i=0 baris paling utara, j=0 kolom paling barat. None = tanpa daratan.
    Nilai nodata dan elevasi <= 0 dianggap bukan daratan.
    """
    with rasterio.open(path) as src:
        b = src.bounds
        if abs(b.left - lon0) > 0.01 or abs(b.top - (lat0 + 1)) > 0.01:
            raise ValueError(
                f"batas tile tidak cocok: bounds={tuple(b)} diharapkan "
                f"barat={lon0}, utara={lat0 + 1}"
            )
        data = src.read(1).astype("float32")
        nodata = src.nodata
    if nodata is not None and not np.isnan(nodata):
        data[data == nodata] = np.nan
    data[data <= 0] = np.nan
    h, w = data.shape
    if h < N_BASE or w < N_BASE:
        raise ValueError(f"ukuran raster terlalu kecil: {data.shape}")
    rows = np.linspace(0, h, N_BASE + 1).astype(int)
    cols = np.linspace(0, w, N_BASE + 1).astype(int)
    grid = [[None] * N_BASE for _ in range(N_BASE)]
    for i in range(N_BASE):
        for j in range(N_BASE):
            blk = data[rows[i]:rows[i + 1], cols[j]:cols[j + 1]]
            if blk.size and not np.isnan(blk).all():
                grid[i][j] = float(np.nanmax(blk))
    return grid


def process_tile(lat0, lon0, args, tmpdir):
    """Kembalikan grid 4x4 untuk satu tile, atau raise Missing."""
    name = tile_name(lat0, lon0, SOURCES[args.source]["code"])
    cache_file = None
    if args.cache:
        cache_file = os.path.join(args.cache, f"{args.source}_{name}.json")
        if os.path.exists(cache_file):
            with open(cache_file) as f:
                return json.load(f)["grid"]

    if args.dem_dir:
        path = os.path.join(args.dem_dir, name + ".tif")
        if not os.path.exists(path):
            raise Missing(path)
        grid = base_grid(path, lat0, lon0)
    else:
        base = (args.base_url or SOURCES[args.source]["base_url"]).rstrip("/")
        url = f"{base}/{name}/{name}.tif"
        tmp = os.path.join(tmpdir, name + ".tif")
        http_download(url, tmp)
        try:
            grid = base_grid(tmp, lat0, lon0)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    if cache_file:
        with open(cache_file, "w") as f:
            json.dump({"grid": grid}, f)
    return grid


# --------------------------------------------------------------------------
# Agregasi dan keluaran
# --------------------------------------------------------------------------
def add_tile_to_base(base, lat0, lon0, grid):
    """base: dict {(ys, xs): max_m}, indeks dalam satuan 15' (0.25 derajat)."""
    for i in range(N_BASE):
        for j in range(N_BASE):
            v = grid[i][j]
            if v is None:
                continue
            ys = lat0 * N_BASE + (N_BASE - 1 - i)  # sel paling selatan = ys
            xs = lon0 * N_BASE + j
            base[(ys, xs)] = v


def aggregate(base, arcmin):
    """Gabungkan sel 15' menjadi sel arcmin (15/30/60) dengan nilai maksimum."""
    f = arcmin // 15
    out = {}
    for (ys, xs), v in base.items():
        k = (ys // f, xs // f)  # // = floor, benar juga untuk belahan selatan
        if k not in out or v > out[k]:
            out[k] = v
    return out


def build_features(agg, arcmin, source=None, generated_at=None):
    size = arcmin / 60.0
    feats = []
    for (ky, kx) in sorted(agg):
        max_m = agg[(ky, kx)]
        s, w = round(ky * size, 6), round(kx * size, 6)
        n, e = round(s + size, 6), round(w + size, 6)
        max_ft, mef_ft, th, hu = mef_parts(max_m)
        feats.append({
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
            },
            "properties": {
                "south": s, "west": w, "north": n, "east": e,
                "cx": round((w + e) / 2, 6), "cy": round((s + n) / 2, 6),
                "max_m": round(max_m, 1),
                "max_ft": int(round(max_ft)),
                "mef_ft": mef_ft,
                "thousands": th,
                "hundreds": hu,
                "label": label_of(th, hu),
                "source": source,
                "generated_at": generated_at,
            },
        })
    return feats


def write_geojson(path, feats, arcmin, meta):
    doc = {
        "type": "FeatureCollection",
        "metadata": dict(meta, cell_arcmin=arcmin, cell_count=len(feats)),
        "features": feats,
    }
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    os.replace(tmp, path)  # tulis atomik: app tidak pernah membaca file setengah jadi


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------
def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--bbox", nargs=4, type=float, default=[94, -12, 142, 7],
                   metavar=("MINLON", "MINLAT", "MAXLON", "MAXLAT"),
                   help="default: seluruh Indonesia. Dibulatkan keluar ke derajat penuh.")
    p.add_argument("--source", choices=sorted(SOURCES), default="cop30",
                   help="cop30 (akurat, unduhan besar) atau cop90 (lebih kecil; puncak bisa sedikit lebih rendah)")
    p.add_argument("--cells", nargs="+", type=int, choices=[60, 30, 15], default=[60, 30, 15],
                   help="ukuran kotak dalam menit busur")
    p.add_argument("--out", default="public/data")
    p.add_argument("--prefix", default="mef")
    p.add_argument("--dem-dir", help="folder berisi tile .tif lokal (tanpa unduh)")
    p.add_argument("--base-url", help="ganti URL dasar sumber DEM")
    p.add_argument("--cache", default=".mef_cache", help="folder cache hasil per tile")
    p.add_argument("--no-cache", action="store_true")
    p.add_argument("--workers", type=int, default=4)
    args = p.parse_args(argv)
    if args.no_cache:
        args.cache = None
    return args


def run(args):
    minlon, minlat, maxlon, maxlat = args.bbox
    lat_range = range(math.floor(minlat), math.ceil(maxlat))
    lon_range = range(math.floor(minlon), math.ceil(maxlon))
    tiles = [(la, lo) for la in lat_range for lo in lon_range]
    if not tiles:
        sys.exit("bbox kosong atau terbalik (urutan: MINLON MINLAT MAXLON MAXLAT)")
    if args.cache:
        os.makedirs(args.cache, exist_ok=True)

    print(f"Sumber: {SOURCES[args.source]['label']} | tile diperiksa: {len(tiles)} "
          f"(lat {lat_range.start}..{lat_range.stop}, lon {lon_range.start}..{lon_range.stop})")

    base, failed, missing, done = {}, [], 0, 0
    with tempfile.TemporaryDirectory() as tmpdir, ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(process_tile, la, lo, args, tmpdir): (la, lo) for la, lo in tiles}
        for fut in as_completed(futs):
            la, lo = futs[fut]
            done += 1
            try:
                add_tile_to_base(base, la, lo, fut.result())
            except Missing:
                missing += 1
            except Exception as e:  # satu tile gagal tidak menghentikan semuanya
                failed.append((la, lo, str(e)))
            if done % 25 == 0 or done == len(tiles):
                print(f"  {done}/{len(tiles)} tile | berdaratan: {done - missing - len(failed)} "
                      f"| tidak ada: {missing} | gagal: {len(failed)}", flush=True)

    # Jangan menimpa keluaran lama dengan data yang tidak lengkap.
    if failed:
        print(f"\nGAGAL: {len(failed)} tile bermasalah, file keluaran TIDAK ditulis "
              f"(file lama tetap aman). Jalankan ulang; tile yang sudah berhasil dipakai dari cache:",
              file=sys.stderr)
        for la, lo, msg in failed[:20]:
            print(f"  lat {la}, lon {lo}: {msg}", file=sys.stderr)
        return 1
    if missing == len(tiles):
        print("\nGAGAL: tidak ada satu pun tile ditemukan. Kemungkinan URL/pola nama sumber DEM salah, "
              "bbox seluruhnya laut, atau --dem-dir salah. File keluaran TIDAK ditulis.", file=sys.stderr)
        return 2

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    meta = {
        "source": SOURCES[args.source]["label"],
        "generated_at": generated_at,
        "bbox_tiles": [math.floor(minlon), math.floor(minlat), math.ceil(maxlon), math.ceil(maxlat)],
        "disclaimer": DISCLAIMER,
    }
    for arcmin in sorted(set(args.cells), reverse=True):
        feats = build_features(aggregate(base, arcmin), arcmin, meta["source"], generated_at)
        path = os.path.join(args.out, f"{args.prefix}_{arcmin}min.geojson")
        write_geojson(path, feats, arcmin, meta)
        if feats:
            top = max(feats, key=lambda x: x["properties"]["max_m"])["properties"]
            print(f"[{arcmin}'] {len(feats)} kotak -> {path} | tertinggi {top['max_m']} m "
                  f"({top['max_ft']} ft, MEF {top['label']}) di sekitar {top['cy']}, {top['cx']}")
        else:
            print(f"[{arcmin}'] 0 kotak -> {path} (tidak ada daratan di bbox ini?)")

    return 0


if __name__ == "__main__":
    warnings.filterwarnings("ignore", category=RuntimeWarning)
    sys.exit(run(parse_args()))
