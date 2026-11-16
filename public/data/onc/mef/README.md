# MEF dataset output directory

Run `python scripts/build_onc_mef.py` with elevation tiles and an Indonesia WGS84 boundary mask to generate:

- `mef-1deg.geojson`
- `mef-30min.geojson`
- `mef-15min.geojson`

The app loads these preprocessed files on demand. No elevation values are bundled until they are generated from a documented DEM source. See `docs/worksheet4-onc-overlays.md` for setup, attribution, and safety limitations. Do not place raw DEM rasters here.
