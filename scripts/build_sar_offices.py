#!/usr/bin/env python3
"""
Build src/data/sarOffices.json — posisi 43 KANSAR + Kantor Pusat Basarnas.

Sumber:
  1. 43 KANSAR: centroid deterministik dari batas wilayah resmi yang diberikan
     pemilik (upload "BATAS WILAYAH KANSAR 9 OKT 21.kmz" →
     src/data/kansarBoundaries.json). Posisi = TITIK REPRESENTATIF wilayah
     kerja (centroid ring terbesar; bila centroid jatuh di luar poligon
     dipindah ke titik vertex terdekat agar berada DI DALAM wilayah) —
     BUKAN alamat/titik gedung kantor fisik. verification: UNVERIFIED.
  2. Kantor Pusat Basarnas: alamat VERIFIED "Jl. Angkasa Blok B.15 Kav 2-3,
     Kemayoran, Jakarta Pusat 10720" (id.wikipedia.org + panduan BAPETEN
     2024 + kontak basarnas.go.id, dicek 19 Nov 2026). Titik = hasil geocode
     jalan alamat via OSM Nominatim (2 segmen Jalan Angkasa, Kemayoran;
     diakses 19 Nov 2026) — posisi indikatif jalan, bukan titik gedung.
     verification: UNVERIFIED.

Jalankan: python3 scripts/build_sar_offices.py
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BOUNDARIES_PATH = REPO / "src" / "data" / "kansarBoundaries.json"
OUT_PATH = REPO / "src" / "data" / "sarOffices.json"

# Dua segmen "Jalan Angkasa, Kemayoran, Jakarta Pusat" dari OSM Nominatim
# (https://nominatim.openstreetmap.org/search?q=Jalan+Angkasa+Kemayoran+Jakarta+Pusat,
# diakses 19 Nov 2026). Midpoint dihitung deterministik di bawah.
NOMINATIM_STREET_SEGMENTS = [
    (-6.1584511, 106.8482212),
    (-6.1566933, 106.8472725),
]

KANSAR_SOURCE = (
    "BATAS WILAYAH KANSAR 9 OKT 21.kmz (upload pemilik) — titik representatif "
    "centroid wilayah kerja (bukan titik gedung kantor)"
)
HQ_SOURCE = (
    "Alamat resmi: Jl. Angkasa Blok B.15 Kav 2-3, Kemayoran, Jakarta Pusat 10720 "
    "(id.wikipedia.org / panduan BAPETEN 2024, dicek 19 Nov 2026); titik = geocode "
    "jalan alamat via OSM Nominatim (diakses 19 Nov 2026) — indikatif, bukan titik gedung"
)

UNITS = "koordinat: derajat desimal WGS84 (S/W negatif)"
UPDATED_REF = "2026-11-19"


def ring_centroid(ring):
    """Centroid area poligon (rumus shoelace terstandar; ring [lng, lat])."""
    n = len(ring)
    if n == 0:
        return None
    # Ring tertutup (titik pertama == terakhir) tidak diulang dua kali.
    pts = ring[:-1] if n >= 2 and ring[0] == ring[-1] else ring
    area2 = 0.0
    cx = 0.0
    cy = 0.0
    for i, (x0, y0) in enumerate(pts):
        x1, y1 = pts[(i + 1) % len(pts)]
        cross = x0 * y1 - x1 * y0
        area2 += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(area2) < 1e-12:
        # Degenerate — rata-rata vertex.
        return (
            sum(p[0] for p in pts) / len(pts),
            sum(p[1] for p in pts) / len(pts),
        )
    area = area2 / 2.0
    return (cx / (6.0 * area), cy / (6.0 * area))


def point_in_ring(lng, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def representative_point(rings):
    """Centroid ring terbesar; bila di luar semua ring → vertex terdekat."""
    largest = max(rings, key=lambda r: len(r))
    c = ring_centroid(largest)
    if c is None:
        return None
    lng, lat = c
    if any(point_in_ring(lng, lat, r) for r in rings):
        return (lat, lng)
    # Pindah ke vertex ring terbesar terdekat agar titik di dalam wilayah.
    best = min(
        ((v[1], v[0]) for v in largest),
        key=lambda v: (v[0] - lat) ** 2 + (v[1] - lng) ** 2,
    )
    return best


def main() -> int:
    data = json.loads(BOUNDARIES_PATH.read_text(encoding="utf-8"))
    entries = []
    seen = set()

    for feature in data.get("features", []):
        props = feature.get("properties", {})
        kansar = (props.get("kansar") or "").strip()
        kansar_id = (props.get("kansarId") or "").strip() or f"loc-kansar-{kansar.lower().replace(' ', '-')}"
        if not kansar or kansar_id in seen:
            continue
        seen.add(kansar_id)

        geometry = feature.get("geometry", {})
        gtype = geometry.get("type")
        if gtype == "Polygon":
            rings = geometry.get("coordinates", [])
        elif gtype == "MultiPolygon":
            rings = [ring for poly in geometry.get("coordinates", []) for ring in poly]
        else:
            print(f"PERINGATAN: geometri {gtype} dilewati untuk {kansar}")
            continue

        point = representative_point(rings)
        if point is None:
            print(f"PERINGATAN: centroid gagal untuk {kansar}")
            continue
        lat, lng = point

        entries.append({
            "id": kansar_id,
            "kind": "sar-office",
            "name": f"Kantor SAR {kansar}",
            "category": "kantor-sar",
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "specs": {
                "kansar": kansar,
                "positionBasis": "centroid wilayah kerja KANSAR (representatif)",
            },
            "source": KANSAR_SOURCE,
            "updatedRef": UPDATED_REF,
            "units": UNITS,
            "verification": "UNVERIFIED",
            "approval": "DRAFT",
        })

    # Kantor Pusat Basarnas — midpoint deterministik dua segmen jalan alamat.
    lats = [p[0] for p in NOMINATIM_STREET_SEGMENTS]
    lngs = [p[1] for p in NOMINATIM_STREET_SEGMENTS]
    entries.append({
        "id": "loc-basarnas-kantor-pusat",
        "kind": "sar-office",
        "name": "Kantor Pusat Basarnas",
        "category": "kantor-pusat",
        "lat": round(sum(lats) / len(lats), 6),
        "lng": round(sum(lngs) / len(lngs), 6),
        "specs": {
            "address": "Jl. Angkasa Blok B.15 Kav 2-3, Kemayoran, Jakarta Pusat 10720",
            "positionBasis": "geocode jalan alamat (indikatif, bukan titik gedung)",
        },
        "source": HQ_SOURCE,
        "updatedRef": UPDATED_REF,
        "units": UNITS,
        "verification": "UNVERIFIED",
        "approval": "DRAFT",
    })

    entries.sort(key=lambda e: (0 if e["category"] == "kantor-pusat" else 1, e["name"]))
    OUT_PATH.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"OK: {len(entries)} entri → {OUT_PATH.relative_to(REPO)}")
    print("kantor pusat:", entries[0]["lat"], entries[0]["lng"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
