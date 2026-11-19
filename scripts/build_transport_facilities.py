#!/usr/bin/env python3
"""
Build src/data/transportFacilities.json dari upload pemilik
"Daftar_Koordinat_Fasilitas_Transportasi_Indonesia.csv" (170 baris:
132 bandara, 19 pelabuhan, 19 terminal/dermaga).

Aturan provenance (keputusan implementasi no. 6 & 7):
  - setiap entri membawa source (per baris CSV), updatedRef, units,
    verification, approval — TANPA mengarang/menambah nilai.
  - koordinat ditulis apa adanya dari CSV (derajat desimal WGS84, S/W negatif).
  - verification: VERIFIED = koordinat eksplisit dari file data yang diberikan
    pemilik (sumber per baris dicatat). approval tetap DRAFT sampai
    disetujui admin (→ APPROVED).
Jalankan: python3 scripts/build_transport_facilities.py
"""
import csv
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
# File milik pemilik di upload workspace; fallback ke upload/ di dalam repo.
CSV_CANDIDATES = [
    Path("/home/z/my-project/upload/Daftar_Koordinat_Fasilitas_Transportasi_Indonesia.csv"),
    REPO / "upload" / "Daftar_Koordinat_Fasilitas_Transportasi_Indonesia.csv",
]
CSV_PATH = next((p for p in CSV_CANDIDATES if p.exists()), CSV_CANDIDATES[0])
OUT_PATH = REPO / "src" / "data" / "transportFacilities.json"

CATEGORY_MAP = {
    "Bandara": "bandara",
    "Pelabuhan": "pelabuhan",
    "Terminal / dermaga": "terminal-dermaga",
}

# Tanggal pembaruan data sumber, dari teks kolom source CSV (tidak dikarang).
UPDATED_REF_BY_SOURCE = {
    "Navo24 / OurAirports (data 6 Nov 2026)": "2026-11-06",
    "ListBase / OpenTravelData (updated Apr 2026)": "2026-04",
    "SMDG Terminal Code List (rows for Indonesia)": None,  # CSV tidak menyebut tanggal
}


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:60] if slug else "tanpa-nama"


def main() -> int:
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    entries = []
    seen_ids = set()
    warnings = []

    for idx, row in enumerate(rows):
        category_raw = (row.get("category") or "").strip()
        category = CATEGORY_MAP.get(category_raw)
        if category is None:
            warnings.append(f"baris {idx + 2}: kategori tak dikenal {category_raw!r} — dilewati")
            continue

        name = (row.get("name") or "").strip()
        lat_raw = (row.get("latitude") or "").strip()
        lng_raw = (row.get("longitude") or "").strip()
        lat = float(lat_raw)
        lng = float(lng_raw)
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            warnings.append(f"baris {idx + 2}: koordinat di luar rentang ({lat}, {lng}) — dilewati")
            continue
        # Sanity kewilayahan Indonesia (peringatan, bukan penolakan).
        if not (-12.0 <= lat <= 7.0 and 93.0 <= lng <= 142.0):
            warnings.append(f"baris {idx + 2}: {name} di luar kotak Indonesia ({lat}, {lng}) — cek manual")

        code = (row.get("code") or "").strip()
        secondary = (row.get("secondary_code") or "").strip()
        base_id = f"fac-{category}-{slugify(code or name)}"
        entry_id = base_id
        n = 2
        while entry_id in seen_ids:
            entry_id = f"{base_id}-{n}"
            n += 1
        seen_ids.add(entry_id)

        source = (row.get("source") or "").strip()
        entries.append({
            "id": entry_id,
            "kind": "transport-facility",
            "name": name,
            "category": category,
            "lat": lat,
            "lng": lng,
            "specs": {
                "cityRegion": (row.get("city_region") or "").strip(),
                "code": code,
                "secondaryCode": secondary,
                "sizeClass": (row.get("kind") or "").strip(),
            },
            "mapUrl": (row.get("map_url") or "").strip(),
            "source": source,
            "updatedRef": UPDATED_REF_BY_SOURCE.get(source),
            "units": "koordinat: derajat desimal WGS84 (S/W negatif)",
            "verification": "VERIFIED",
            "approval": "DRAFT",
        })

    category_order = {"bandara": 0, "pelabuhan": 1, "terminal-dermaga": 2}
    entries.sort(key=lambda e: (category_order[e["category"]], e["name"]))

    OUT_PATH.write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    counts: dict[str, int] = {}
    for e in entries:
        counts[e["category"]] = counts.get(e["category"], 0) + 1
    print(f"OK: {len(entries)} entri → {OUT_PATH.relative_to(REPO)}")
    print("per kategori:", json.dumps(counts, ensure_ascii=False))
    for w in warnings:
        print("PERINGATAN:", w)
    return 0


if __name__ == "__main__":
    sys.exit(main())
