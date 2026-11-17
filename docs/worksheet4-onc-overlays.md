# Worksheet 4: ONC-style overlays

The Worksheet 4 map has a client-side ONC-style graticule and optional MEF and chart-scan layers. Basemap controls remain independent from worksheet routes and calculations.

## Graticule

The viewport GeoJSON is regenerated after the map settles (debounced 120 ms), not while every pan/zoom frame is rendered. Major lines and edge degree labels use one-degree spacing; minor lines use 30 minutes. Neatline ticks switch to 10 minutes below zoom 6, 5 minutes from zoom 6 to 10, and 1 minute at zoom 10 or above. Ten-minute ticks get minute labels. MapLibre collision handling suppresses labels that would overlap. The minute/degree lines are a visual chart aid and do not turn OSM into an official aeronautical chart.

## Building the MEF data

The repository contains `build_mef.py`, which downloads Copernicus COG tiles one at a time, reduces each to 15-minute maxima, deletes the temporary raster, and caches only the small reduced grid. Run a regional bbox first, inspect the resulting cells on the map, then run the default Indonesia bbox. The bbox is a rectangular envelope and can include neighboring countries and ocean-adjacent cells; verify border cells before operational use.

Copernicus DEM GLO-30 is a 30 m **digital surface model** (DSM), not bare-earth terrain. Its source describes TanDEM-X acquisitions from 2011–2015. It is open data, with the Copernicus attribution notice required by its terms. SRTM is an alternative global elevation dataset acquired in 2000 and available through USGS download services. Record the actual product/tile release and acquisition date in `--source` and `--data-date`; do not use the default date label as a substitute for checking tile metadata.

Install the preprocessing dependencies from the repository root:

```powershell
python -m pip install -r requirements.txt
```

Quick regional build for Mamuju / Sulawesi Barat:

```powershell
python build_mef.py --bbox 117 -4 120 0 --out public/data
```

If the regional output looks right, build the full Indonesia envelope:

```powershell
python build_mef.py --out public/data
```

Outputs are `public/data/mef_60min.geojson`, `mef_30min.geojson`, and `mef_15min.geojson`, corresponding to 1°, 30′, and 15′. Each cell stores max elevation in meters and feet, MEF, superscript components, source, and generation timestamp. Positive maxima below 100 ft round up to 100 ft (`0¹`); a value of 6,549 ft rounds to 6,600 ft (`6⁶`). Sea-level and non-land cells are omitted. Successful tile reductions are cached in `.mef_cache/`; temporary downloaded rasters are removed. If an individual tile fails, no output is overwritten; rerun to reuse successful cached cells.

Copernicus GLO-30 attribution (include it when distributing outputs made from this dataset):

> produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved

The generated layer is an MEF **derived from DEM**, not an official ONC value. DEM resolution, DSM surface objects, vertical datum, age, and grid sampling introduce uncertainty. Never use it as the only source for flight safety decisions; verify the method and data with current official aeronautical information. The value shown by the map is rounded from the stored DEM maximum in the popup.

## Optional georeferenced ONC scan

Use a scan that you own or are licensed to use. In QGIS, open **Raster → Georeferencer**, add the scan, set ground control points using identifiable chart graticule intersections and their published coordinates, choose the chart's stated CRS/projection, and use a suitable resampling method. Review the result against known control points before exporting. For browser XYZ tiles, export/warp to EPSG:3857 and generate tiles, for example:

```powershell
gdalwarp -t_srs EPSG:3857 georeferenced-onc.tif onc-3857.tif
gdal2tiles.py --xyz -z 4-14 -w none onc-3857.tif public/data/onc/scan
```

Copy the tile tree under `public/data/onc/scan/{z}/{x}/{y}.png`, then set `NEXT_PUBLIC_ONC_SCAN_TILE_URL=/data/onc/scan/{z}/{x}/{y}.png` in `.env.local` and restart the app. The scan toggle and opacity slider appear when that URL is configured. Layer order is basemap → scan → graticule → MEF → OpenAIP airports, followed by the worksheet's own plotted results.

## Verification

Run `python -m pytest -q test_build_mef.py` for raster, tile, aggregation, and end-to-end tests, and `npm run test:mef` for browser label formatting. The map requests `/data/mef_60min.geojson`, `/data/mef_30min.geojson`, or `/data/mef_15min.geojson`; a 404 includes the exact missing URL and a regional build command. Partial outputs are valid and display only cells with land data. Commit the generated GeoJSON outputs if they are intended for deployment; do not commit raw DEM tiles or `.mef_cache/`.
