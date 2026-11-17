import functools
import http.server
import json
import os
import threading

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_bounds

import build_mef as m


# ---------------------------------------------------------------- rumus MEF
@pytest.mark.parametrize("max_m, expected", [
    (6549 / m.M_TO_FT, (6600, 6, 6)),   # 6.549 ft -> 6.600 ft -> 6 ribu, 6 ratus
    (299 / m.M_TO_FT, (300, 0, 3)),     # 299 ft  -> 300 ft   -> 0 ribu, 3 ratus
    (30.48, (100, 0, 1)),               # tepat 100 ft tidak naik ke 200
    (600 / m.M_TO_FT, (600, 0, 6)),     # kelipatan 100 ft tepat tetap
    (0.5, (100, 0, 1)),                 # sangat rendah tetap naik ke 100 ft
    (2000.0, (6600, 6, 6)),
])
def test_mef_parts(max_m, expected):
    _, mef_ft, th, hu = m.mef_parts(max_m)
    assert (mef_ft, th, hu) == expected


def test_label_superscript():
    assert m.label_of(6, 6) == "6\u2076"
    assert m.label_of(0, 3) == "0\u00b3"


# ---------------------------------------------------------------- agregasi
def test_aggregate_southern_hemisphere_uses_floor():
    # sel 15' lat -2.75..-2.5 (ys = -11), lon 118.75..119.0 (xs = 475)
    base = {(-11, 475): 2000.0, (-12, 472): 100.0}  # -12: lat -3.0..-2.75, lon 118.0..118.25
    a30 = m.aggregate(base, 30)
    # 30': ys//2 -> -6 (lat -3.0..-2.5); xs//2 -> 237 (118.5..119.0) dan 236 (118.0..118.5)
    assert a30[(-6, 237)] == 2000.0
    assert a30[(-6, 236)] == 100.0
    a60 = m.aggregate(base, 60)
    assert a60 == {(-3, 118): 2000.0}   # kotak 1 derajat lat -3..-2, lon 118..119


def test_features_coordinates_are_clean():
    feats = m.build_features({(-6, 237): 2000.0}, 30)
    p = feats[0]["properties"]
    assert (p["south"], p["west"], p["north"], p["east"]) == (-3.0, 118.5, -2.5, 119.0)
    assert p["label"] == "6\u2076" and p["mef_ft"] == 6600


# ------------------------------------------------- tile sintetis end-to-end
def make_tile(path, lat0, lon0, peaks, size=400):
    """Raster 1 derajat; peaks = [(lat, lon, tinggi_m)]."""
    data = np.zeros((size, size), dtype="float32")
    px = 1.0 / size
    for lat, lon, h in peaks:
        r = int((lat0 + 1 - lat) / px)
        c = int((lon - lon0) / px)
        data[r, c] = h
    t = from_bounds(lon0, lat0, lon0 + 1, lat0 + 1, size, size)
    with rasterio.open(path, "w", driver="GTiff", height=size, width=size, count=1,
                       dtype="float32", crs="EPSG:4326", transform=t) as dst:
        dst.write(data, 1)


@pytest.fixture
def dem_dir(tmp_path):
    d = tmp_path / "dem"
    d.mkdir()
    name = m.tile_name(-3, 118, "10")
    assert name == "Copernicus_DSM_COG_10_S03_00_E118_00_DEM"
    make_tile(d / f"{name}.tif", -3, 118, [(-2.6, 118.9, 2000.0), (-2.9, 118.1, 100.0)])
    return d


def check_outputs(out):
    f30 = json.load(open(out / "mef_30min.geojson"))
    labels = {(f["properties"]["south"], f["properties"]["west"]): f["properties"]["label"]
              for f in f30["features"]}
    assert labels == {(-3.0, 118.5): "6\u2076", (-3.0, 118.0): "0\u2074"}
    assert f30["metadata"]["cell_arcmin"] == 30
    assert "bukan angka resmi ONC" in f30["metadata"]["disclaimer"]

    f60 = json.load(open(out / "mef_60min.geojson"))
    assert [f["properties"]["label"] for f in f60["features"]] == ["6\u2076"]

    f15 = json.load(open(out / "mef_15min.geojson"))
    assert len(f15["features"]) == 2


def test_end_to_end_local_dem_dir(dem_dir, tmp_path):
    out = tmp_path / "out"
    # bbox sengaja meliputi tile S04_E118 yang tidak ada: harus dihitung 'tidak ada', bukan gagal
    args = m.parse_args(["--bbox", "118", "-4", "119", "-2", "--dem-dir", str(dem_dir),
                         "--out", str(out), "--no-cache"])
    assert m.run(args) == 0
    check_outputs(out)


def test_end_to_end_http_download(dem_dir, tmp_path):
    # susun ulang ke pola URL {base}/{name}/{name}.tif dan layani lewat HTTP lokal
    root = tmp_path / "www"
    for f in dem_dir.iterdir():
        sub = root / f.stem
        sub.mkdir(parents=True)
        (sub / f.name).write_bytes(f.read_bytes())

    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a, **k: None
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base_url = f"http://127.0.0.1:{srv.server_address[1]}"
    cache = tmp_path / "cache"
    try:
        out = tmp_path / "out"
        args = m.parse_args(["--bbox", "118", "-4", "119", "-2", "--base-url", base_url,
                             "--out", str(out), "--cache", str(cache)])
        assert m.run(args) == 0
        check_outputs(out)
        assert os.listdir(cache)  # cache terisi
    finally:
        srv.shutdown()
        srv.server_close()

    # server mati: bbox yang hanya berisi tile ber-cache tetap sukses (tanpa jaringan)
    out2 = tmp_path / "out2"
    args2 = m.parse_args(["--bbox", "118", "-3", "119", "-2", "--base-url", base_url,
                          "--out", str(out2), "--cache", str(cache)])
    assert m.run(args2) == 0
    check_outputs(out2)


def test_bad_bounds_reported_and_outputs_not_written(tmp_path):
    d = tmp_path / "dem"
    d.mkdir()
    name = m.tile_name(-3, 118, "10")
    make_tile(d / f"{name}.tif", -3, 120, [(-2.5, 120.5, 50.0)])  # georeferensi salah
    out = tmp_path / "o"
    args = m.parse_args(["--bbox", "118", "-3", "119", "-2", "--dem-dir", str(d),
                         "--out", str(out), "--no-cache"])
    assert m.run(args) == 1
    assert not out.exists()  # tidak menimpa/menulis keluaran dari data tidak lengkap


def test_all_tiles_missing_is_an_error(tmp_path):
    d = tmp_path / "dem"
    d.mkdir()
    out = tmp_path / "o"
    args = m.parse_args(["--bbox", "118", "-3", "119", "-2", "--dem-dir", str(d),
                         "--out", str(out), "--no-cache"])
    assert m.run(args) == 2
    assert not out.exists()
