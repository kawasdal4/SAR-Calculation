#!/usr/bin/env python3
"""Build clipped ONC-style MEF GeoJSON from local elevation rasters.

Input rasters are processed in blocks; raw DEM data is never shipped to the browser.
The script writes 15-minute cells and aggregates those maxima into 30-minute and 1-degree grids.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import rasterio
from rasterio.features import geometry_mask
from rasterio.vrt import WarpedVRT
from rasterio.windows import Window


REGION = (94.0, -12.0, 142.0, 7.0)  # west, south, east, north; includes Indonesia's outer islands
FINE_CELL_DEGREES = 0.25  # 15 arc minutes
GRID_SIZES = {
    "15min": 0.25,
    "30min": 0.5,
    "1deg": 1.0,
}
BLOCK_SIZE = 512
SUPER = "⁰¹²³⁴⁵⁶⁷⁸⁹"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dem-dir", required=True, type=Path, help="Folder with GeoTIFF or SRTM HGT tiles")
    parser.add_argument("--output-dir", type=Path, default=Path("public/data/onc/mef"))
    parser.add_argument("--source", default="Copernicus DEM GLO-30")
    parser.add_argument("--data-date", default="2011–2015 (TanDEM-X acquisition; verify tile metadata)")
    parser.add_argument("--vertical-unit", choices=("meters", "feet"), default="meters")
    parser.add_argument("--mask-geojson", required=True, type=Path, help="Indonesia boundary GeoJSON in WGS84; clips foreign land")
    return parser.parse_args()


def load_mask(path: Path | None) -> Any | None:
    if path is None:
        return None
    try:
        from shapely.geometry import shape
        from shapely.ops import unary_union
    except ImportError as error:
        raise SystemExit("Install shapely to use --mask-geojson: pip install shapely") from error
    payload = json.loads(path.read_text(encoding="utf-8"))
    features = payload.get("features", []) if payload.get("type") == "FeatureCollection" else [payload]
    geometries = [shape(feature.get("geometry", feature)) for feature in features if feature]
    if not geometries:
        raise SystemExit(f"No polygon geometry found in {path}")
    return unary_union(geometries)


def max_by_15_minute_cell(
    dataset: rasterio.io.DatasetReader,
    vertical_unit: str,
    clip_geometry: Any | None,
) -> dict[tuple[int, int], float]:
    if dataset.crs is None:
        raise ValueError(f"Raster has no CRS: {dataset.name}")

    output: dict[tuple[int, int], float] = {}
    west_limit, south_limit, east_limit, north_limit = REGION
    for row in range(0, dataset.height, BLOCK_SIZE):
        for col in range(0, dataset.width, BLOCK_SIZE):
            window = Window(
                col,
                row,
                min(BLOCK_SIZE, dataset.width - col),
                min(BLOCK_SIZE, dataset.height - row),
            )
            band = dataset.read(1, window=window, masked=True)
            values = np.asarray(band.data, dtype=np.float64)
            valid = ~np.ma.getmaskarray(band) & np.isfinite(values)
            valid &= (values > -32000) & (values < 10000)
            valid &= (values != -9999) & (values != -32767)
            transform = dataset.window_transform(window)
            if abs(transform.b) > 1e-10 or abs(transform.d) > 1e-10:
                raise ValueError(f"Rotated rasters are not supported; warp to north-up EPSG:4326 first: {dataset.name}")

            if clip_geometry is not None:
                valid &= geometry_mask(
                    [clip_geometry],
                    out_shape=values.shape,
                    transform=transform,
                    invert=True,
                    all_touched=False,
                )
            rows, cols = np.nonzero(valid)
            if rows.size == 0:
                continue

            longitudes = transform.c + (cols + 0.5) * transform.a
            latitudes = transform.f + (rows + 0.5) * transform.e
            inside = (
                (longitudes >= west_limit)
                & (longitudes < east_limit)
                & (latitudes >= south_limit)
                & (latitudes < north_limit)
            )
            if not np.any(inside):
                continue
            rows = rows[inside]
            cols = cols[inside]
            longitudes = longitudes[inside]
            latitudes = latitudes[inside]
            elevations = values[rows, cols]
            if vertical_unit == "feet":
                elevations = elevations / 3.280839895

            cell_x = np.floor(longitudes / FINE_CELL_DEGREES).astype(np.int32)
            cell_y = np.floor(latitudes / FINE_CELL_DEGREES).astype(np.int32)
            unique_cells, inverse = np.unique(np.column_stack((cell_x, cell_y)), axis=0, return_inverse=True)
            block_max = np.full(len(unique_cells), -np.inf, dtype=np.float64)
            np.maximum.at(block_max, inverse, elevations)
            for (ix, iy), elevation in zip(unique_cells, block_max):
                key = (int(ix), int(iy))
                output[key] = max(output.get(key, -math.inf), float(elevation))
    return output


def mef_feet(max_elevation_meters: float) -> int:
    max_feet = max_elevation_meters * 3.280839895
    return 0 if max_feet <= 0 else math.ceil(max_feet / 100) * 100


def mef_parts(value_feet: int) -> tuple[str, str, str]:
    large = str(value_feet // 1000)
    hundreds = (value_feet % 1000) // 100
    superscript = SUPER[hundreds]
    return large, superscript, f"{large}{superscript}"


def build_feature(ix: int, iy: int, size: float, max_meters: float, source: str, data_date: str) -> dict[str, Any]:
    west = ix * size
    south = iy * size
    east = west + size
    north = south + size
    max_feet = max_meters * 3.280839895
    rounded_mef = mef_feet(max_meters)
    large, superscript, label = mef_parts(rounded_mef)
    return {
        "type": "Feature",
        "properties": {
            "grid_size_deg": size,
            "max_elev_m": round(max_meters, 1),
            "max_elev_ft": round(max_feet, 1),
            "mef_ft": rounded_mef,
            "mef_large": large,
            "mef_hundreds_superscript": superscript,
            "mef_label": label,
            "west": round(west, 6),
            "south": round(south, 6),
            "east": round(east, 6),
            "north": round(north, 6),
            "dem_source": source,
            "dem_date": data_date,
        },
        "geometry": {
            "type": "Polygon",
            "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
        },
    }


def main() -> None:
    args = parse_args()
    files = sorted(path for path in args.dem_dir.rglob("*") if path.suffix.lower() in {".tif", ".tiff", ".hgt"})
    if not files:
        raise SystemExit(f"No .tif, .tiff, or .hgt rasters found in {args.dem_dir}")
    clip_geometry = load_mask(args.mask_geojson)
    fine_maxima: dict[tuple[int, int], float] = {}

    for index, path in enumerate(files, start=1):
        with rasterio.open(path) as source:
            if source.crs is None:
                raise SystemExit(f"Missing CRS in {path}; define or warp the raster before processing")
            if source.crs.to_epsg() == 4326:
                datasets = [source]
                vrt_context = None
            else:
                vrt_context = WarpedVRT(source, crs="EPSG:4326", resampling=rasterio.enums.Resampling.nearest)
                datasets = [vrt_context]
            try:
                for dataset in datasets:
                    block_max = max_by_15_minute_cell(dataset, args.vertical_unit, clip_geometry)
                    for key, value in block_max.items():
                        fine_maxima[key] = max(fine_maxima.get(key, -math.inf), value)
            finally:
                if vrt_context is not None:
                    vrt_context.close()
        print(f"[{index}/{len(files)}] {path.name}: {len(fine_maxima)} 15-minute cells so far")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for label, size in GRID_SIZES.items():
        factor = round(size / FINE_CELL_DEGREES)
        coarse_maxima: dict[tuple[int, int], float] = {}
        for (ix, iy), elevation in fine_maxima.items():
            key = (math.floor(ix / factor), math.floor(iy / factor))
            coarse_maxima[key] = max(coarse_maxima.get(key, -math.inf), elevation)
        features = [
            build_feature(ix, iy, size, elevation, args.source, args.data_date)
            for (ix, iy), elevation in sorted(coarse_maxima.items(), key=lambda item: (item[0][1], item[0][0]))
        ]
        output = {
            "type": "FeatureCollection",
            "name": f"ONC-style MEF derived from {args.source}",
            "metadata": {
                "dem_source": args.source,
                "dem_date": args.data_date,
                "vertical_unit": "meters",
                "mef_rule": "maximum elevation converted to feet, rounded upward to the next 100 feet",
                "warning": "Derived from DEM; not an official ONC MEF value.",
                "clip": str(args.mask_geojson) if args.mask_geojson else "Indonesia bounding box; may include adjacent land",
            },
            "features": features,
        }
        destination = args.output_dir / f"mef-{label}.geojson"
        destination.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"Wrote {len(features)} cells: {destination}")


if __name__ == "__main__":
    main()
