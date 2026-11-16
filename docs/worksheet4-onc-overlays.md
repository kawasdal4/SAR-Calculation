# Worksheet 4: ONC-style overlays

The Worksheet 4 map has a client-side ONC-style graticule and optional MEF and chart-scan layers. Basemap controls remain independent from worksheet routes and calculations.

## Graticule

The viewport GeoJSON is regenerated after the map settles (debounced 120 ms), not while every pan/zoom frame is rendered. Major lines and edge degree labels use one-degree spacing; minor lines use 30 minutes. Neatline ticks switch to 10 minutes below zoom 6, 5 minutes from zoom 6 to 10, and 1 minute at zoom 10 or above. Ten-minute ticks get minute labels. MapLibre collision handling suppresses labels that would overlap. The minute/degree lines are a visual chart aid and do not turn OSM into an official aeronautical chart.

## Building the MEF data

The repository intentionally contains no fabricated elevation cells. Download an elevation DEM and an Indonesia boundary polygon first. The preprocessor reads GeoTIFF or SRTM HGT tiles in blocks and writes static GeoJSON files to `public/data/onc/mef/`; the browser only loads the selected output. A WGS84 country mask is required so neighboring countries are not included.

Copernicus DEM GLO-30 is a 30 m **digital surface model** (DSM), not bare-earth terrain. Its source describes TanDEM-X acquisitions from 2011–2015. It is open data, with the Copernicus attribution notice required by its terms. SRTM is an alternative global elevation dataset acquired in 2000 and available through USGS download services. Record the actual product/tile release and acquisition date in `--source` and `--data-date`; do not use the default date label as a substitute for checking tile metadata.

Install the preprocessing dependencies in a Python environment:

```powershell
python -m pip install rasterio numpy shapely
```

Place DEM rasters in a local folder and provide a WGS84 GeoJSON Feature or FeatureCollection containing the Indonesia boundary:

```powershell
python scripts/build_onc_mef.py `
  --dem-dir data/dem/copernicus-glo30 `
  --mask-geojson data/boundaries/indonesia.geojson `
  --source "Copernicus DEM GLO-30" `
  --data-date "Copernicus DEM release and tile acquisition dates"
```

The script creates `mef-15min.geojson`, `mef-30min.geojson`, and `mef-1deg.geojson`. It stores maximum elevation in meters and feet, grid bounds, the source/date strings, and MEF rounded upward to the next 100 ft. Zero or negative maxima are displayed as `0⁰`; positive maxima below 100 ft round up to 100 ft (`0¹`). A value of 6,549 ft rounds to 6,600 ft (`6⁶`).

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

Run `npm run test:mef` for rounding and label formatting cases. The map reports when the selected GeoJSON file is absent or empty. Deployments need the generated `public/data/onc/mef/*.geojson` files committed or otherwise made available at the documented static paths; do not commit raw DEM downloads.
