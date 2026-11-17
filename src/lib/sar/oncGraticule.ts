import type { Feature, FeatureCollection, Geometry } from 'geojson';

export type OncGridProperties = {
  kind: 'major' | 'minor' | 'tick' | 'minute-label' | 'degree-label';
  axis?: 'longitude' | 'latitude';
  tickMinutes?: number;
  label?: string;
};

const EMPTY_GRID: FeatureCollection<Geometry, OncGridProperties> = { type: 'FeatureCollection', features: [] };
const MAX_MERCATOR_LAT = 85.05112878;

function lineFeature(start: [number, number], end: [number, number], properties: OncGridProperties): Feature<Geometry, OncGridProperties> {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: [start, end] } };
}

function pointFeature(position: [number, number], properties: OncGridProperties): Feature<Geometry, OncGridProperties> {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: position } };
}

function axisText(degrees: number, axis: 'longitude' | 'latitude'): string {
  const abs = Math.abs(degrees);
  const whole = Math.floor(abs + 1e-8);
  const hemisphere = axis === 'longitude' ? degrees < 0 ? 'W' : 'E' : degrees < 0 ? 'S' : 'N';
  return `${String(whole).padStart(axis === 'longitude' ? 3 : 2, '0')}°${hemisphere}`;
}

function minuteLabel(totalMinutes: number): string | null {
  const minute = Math.abs(totalMinutes) % 60;
  return minute !== 0 && minute % 10 === 0 ? String(minute) : null;
}

function alignedStart(min: number, interval: number): number {
  return Math.ceil((min - 1e-8) / interval) * interval;
}

function mercatorY(latitude: number): number {
  const radians = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, latitude)) * Math.PI / 180;
  return -Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function latitudeAtMercatorY(value: number): number {
  return (2 * Math.atan(Math.exp(-value)) - Math.PI / 2) * 180 / Math.PI;
}

function gridValues(minimum: number, maximum: number, interval: number): number[] {
  const values: number[] = [];
  for (let value = alignedStart(minimum / interval, 1) * interval; value <= maximum + 1e-8; value += interval) {
    values.push(Number(value.toFixed(8)));
  }
  return values;
}

/** Generate viewport-only ONC graticule geometry. Tick lengths are constant screen pixels. */
export function buildOncGraticule(
  bounds: { west: number; south: number; east: number; north: number },
  width: number,
  height: number,
  zoom: number,
): FeatureCollection<Geometry, OncGridProperties> {
  const west = Math.max(-180, bounds.west);
  const east = Math.min(180, bounds.east);
  const south = Math.max(-MAX_MERCATOR_LAT, bounds.south);
  const north = Math.min(MAX_MERCATOR_LAT, bounds.north);
  if (!Number.isFinite(west + south + east + north + zoom) || east <= west || north <= south || width <= 0 || height <= 0) {
    return EMPTY_GRID;
  }

  const features: Array<Feature<Geometry, OncGridProperties>> = [];
  const worldPixels = 512 * 2 ** zoom;
  const pixelsPerLongitudeDegree = worldPixels / 360;
  const tickMinutes = zoom < 6 ? 10 : zoom < 10 ? 5 : 1;
  const tickPixels = tickMinutes === 10 ? 9 : tickMinutes === 5 ? 6 : 4;
  const minuteInterval = tickMinutes / 60;
  const halfTickLon = tickPixels / 2 / pixelsPerLongitudeDegree;
  const halfTickMercator = (tickPixels / 2) * 2 * Math.PI / worldPixels;
  const minuteLabelMinSpacingPx = 48;

  // Primary one-degree and secondary half-degree graticule lines.
  for (const lon of gridValues(west, east, 0.5)) {
    const major = Math.abs(lon - Math.round(lon)) < 1e-7;
    features.push(lineFeature([lon, south], [lon, north], { kind: major ? 'major' : 'minor', axis: 'longitude' }));
  }
  for (const lat of gridValues(south, north, 0.5)) {
    const major = Math.abs(lat - Math.round(lat)) < 1e-7;
    features.push(lineFeature([west, lat], [east, lat], { kind: major ? 'major' : 'minor', axis: 'latitude' }));
  }

  // Tick marks cross each graticule line in the map interior, at the zoom-selected minute interval.
  const graticuleLongitudes = gridValues(west, east, 0.5);
  const graticuleLatitudes = gridValues(south, north, 0.5);
  const tickLatitudes = gridValues(south, north, minuteInterval);
  const tickLongitudes = gridValues(west, east, minuteInterval);

  for (const lon of graticuleLongitudes) {
    let lastMinuteLabelY: number | undefined;
    for (const lat of tickLatitudes) {
      features.push(lineFeature([lon - halfTickLon, lat], [lon + halfTickLon, lat], {
        kind: 'tick', axis: 'longitude', tickMinutes,
      }));
      const label = minuteLabel(Math.round(lat * 60));
      const screenY = mercatorY(lat) * worldPixels / (2 * Math.PI);
      const onMajorLine = Math.abs(lon - Math.round(lon)) < 1e-7;
      if (tickMinutes === 10 && onMajorLine && label
        && (lastMinuteLabelY === undefined || Math.abs(screenY - lastMinuteLabelY) >= minuteLabelMinSpacingPx)) {
        features.push(pointFeature([lon + halfTickLon * 2.3, lat], { kind: 'minute-label', axis: 'longitude', label }));
        lastMinuteLabelY = screenY;
      }
    }
  }

  for (const lat of graticuleLatitudes) {
    let lastMinuteLabelX: number | undefined;
    for (const lon of tickLongitudes) {
      const centerY = mercatorY(lat);
      const northTickLat = latitudeAtMercatorY(centerY + halfTickMercator);
      const southTickLat = latitudeAtMercatorY(centerY - halfTickMercator);
      features.push(lineFeature([lon, northTickLat], [lon, southTickLat], {
        kind: 'tick', axis: 'latitude', tickMinutes,
      }));
      const label = minuteLabel(Math.round(lon * 60));
      const screenX = lon * pixelsPerLongitudeDegree;
      const onMajorLine = Math.abs(lat - Math.round(lat)) < 1e-7;
      if (tickMinutes === 10 && onMajorLine && label
        && (lastMinuteLabelX === undefined || Math.abs(screenX - lastMinuteLabelX) >= minuteLabelMinSpacingPx)) {
        features.push(pointFeature([lon, latitudeAtMercatorY(centerY - halfTickMercator * 2.3)], {
          kind: 'minute-label', axis: 'latitude', label,
        }));
        lastMinuteLabelX = screenX;
      }
    }
  }

  // Repeat degree labels along full-degree grid lines at approximately 300 px spacing.
  const labelSpacingPx = 300;
  const northY = mercatorY(north);
  const southY = mercatorY(south);
  const mercatorUnitsPerPixel = 2 * Math.PI / worldPixels;
  const labelSpacingY = Math.max(1, Math.min(labelSpacingPx, (southY - northY) / mercatorUnitsPerPixel));
  for (const lon of gridValues(west, east, 1)) {
    const firstY = northY + labelSpacingY / 2 * mercatorUnitsPerPixel;
    const spacingY = labelSpacingY * mercatorUnitsPerPixel;
    for (let y = firstY; y <= southY; y += spacingY) {
      const lat = latitudeAtMercatorY(y);
      if (lat >= south && lat <= north) features.push(pointFeature([lon, lat], {
        kind: 'degree-label', axis: 'longitude', label: axisText(lon, 'longitude'),
      }));
    }
  }
  const labelSpacingX = Math.max(1, Math.min(labelSpacingPx, (east - west) * pixelsPerLongitudeDegree));
  for (const lat of gridValues(south, north, 1)) {
    const spacing = labelSpacingX / pixelsPerLongitudeDegree;
    for (let lon = west + spacing / 2; lon <= east; lon += spacing) {
      features.push(pointFeature([lon, lat], { kind: 'degree-label', axis: 'latitude', label: axisText(lat, 'latitude') }));
    }
  }

  return { type: 'FeatureCollection', features };
}
