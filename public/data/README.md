# Worksheet 4 MEF data

Generate `mef_60min.geojson`, `mef_30min.geojson`, and `mef_15min.geojson` with `python build_mef.py`. Test around Mamuju first:

```powershell
python build_mef.py --bbox 117 -4 120 0 --out public/data
```

After reviewing the regional layer, generate the full Indonesia bounding box:

```powershell
python build_mef.py --out public/data
```

The client fetches these static files only when the MEF layer is enabled. See [`docs/worksheet4-onc-overlays.md`](../../docs/worksheet4-onc-overlays.md) for data source attribution and limitations. Do not store raw DEM tiles in this directory.
