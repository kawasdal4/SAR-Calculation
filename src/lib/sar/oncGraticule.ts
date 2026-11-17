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

/** Select a tick interval using its projected screen spacing, or return 0 when too zoomed out. */
export function selectOncTickInterval(zoom: number, latitude: number): number {
  const pixelsPerLongitudeDegree = 512 * 2 ** zoom / 360;
  if (pixelsPerLongitudeDegree < 80) return 0;
  const pixelsPerLatitudeDegree = pixelsPerLongitudeDegree / Math.max(0.01, Math.cos(latitude * Math.PI / 180));
  const limitingPixelsPerDegree = Math.min(pixelsPerLongitudeDegree, pixelsPerLatitudeDegree);
  for (const interval of [1, 5, 10]) {
    if (limitingPixelsPerDegree * interval / 60 >= 6) return interval;
  }
  return 30;
}

/** Generate viewport-only ONC graticule geometry. Tick dimensions remain constant in screen pixels. */
export function buildOncGraticule(
  bounds: { west: number; south: number; east: number; north: number },
  width: number,
  height: number,
  zoom: number,
): FeatureCollection<Geometry, OncGridProperties> {
  const longitudeMargin = (bounds.east - bounds.west) * 0.05;
  const latitudeMargin = (bounds.north - bounds.south) * 0.05;
  const west = Math.max(-180, bounds.west - longitudeMargin);
  const east = Math.min(180, bounds.east + longitudeMargin);
  const south = Math.max(-MAX_MERCATOR_LAT, bounds.south - latitudeMargin);
  const north = Math.min(MAX_MERCATOR_LAT, bounds.north + latitudeMargin);
  if (!Number.isFinite(west + south + east + north + zoom) || east <= west || north <= south || width <= 0 || height <= 0) {
    return EMPTY_GRID;
  }

  const features: Array<Feature<Geometry, OncGridProperties>> = [];
  const worldPixels = 512 * 2 ** zoom;
  const pixelsPerLongitudeDegree = worldPixels / 360;
  const minuteInterval = 1 / 60;
  const halfLabelGapPx = 20;
  const minuteLabelMinSpacingPx = 40;
  const isDegreeIntersectionMinute = (minute: number) => minute === 0;

  // Keep the existing major 1° and minor 30′ graticule lines.
  for (const lon of gridValues(west, east, 0.5)) {
    const major = Math.abs(lon - Math.round(lon)) < 1e-7;
    features.push(lineFeature([lon, south], [lon, north], { kind: major ? 'major' : 'minor', axis: 'longitude' }));
  }
  for (const lat of gridValues(south, north, 0.5)) {
    const major = Math.abs(lat - Math.round(lat)) < 1e-7;
    features.push(lineFeature([west, lat], [east, lat], { kind: major ? 'major' : 'minor', axis: 'latitude' }));
  }

  // Cross marks are drawn only on full-degree graticules. Shorter subordinate marks retain
  // their 1′/5′/10′ visual hierarchy when the selected minimum interval is 1′.
  const meridians = gridValues(west, east, 1);
  const parallels = gridValues(south, north, 1);
  for (const lon of meridians) {
    const interval = selectOncTickInterval(zoom, (south + north) / 2);
    if (!interval) continue;
    let lastLabelScreenY: number | undefined;
    const firstMinute = Math.ceil((south * 60 - 1e-8) / interval) * interval;
    const lastMinute = Math.floor((north * 60 + 1e-8) / interval) * interval;
    for (let totalMinutes = firstMinute; totalMinutes <= lastMinute; totalMinutes += interval) {
      const minuteInDegree = ((totalMinutes % 60) + 60) % 60;
      if (isDegreeIntersectionMinute(minuteInDegree)) continue;
      const lat = totalMinutes / 60;
      const intervalAtPoint = selectOncTickInterval(zoom, lat);
      if (intervalAtPoint !== interval && intervalAtPoint > interval) continue;
      const tickMinutes = minuteInDegree % 10 === 0 ? 10 : minuteInDegree % 5 === 0 ? 5 : 1;
      const halfPixels = tickMinutes === 10 ? 8 : tickMinutes === 5 ? 5 : 3;
      const halfLon = halfPixels / pixelsPerLongitudeDegree;
      features.push(lineFeature([lon - halfLon, lat], [lon + halfLon, lat], {
        kind: 'tick', axis: 'longitude', tickMinutes,
      }));
      const label = minuteLabel(totalMinutes);
      const screenY = mercatorY(lat) * worldPixels / (2 * Math.PI);
      const distanceToIntersection = Math.min(minuteInDegree, 60 - minuteInDegree)
        * pixelsPerLongitudeDegree / 60;
      if (label && distanceToIntersection >= halfLabelGapPx
        && (lastLabelScreenY === undefined || Math.abs(screenY - lastLabelScreenY) >= minuteLabelMinSpacingPx)) {
        features.push(pointFeature([lon + halfLon + 5 / pixelsPerLongitudeDegree, lat], {
          kind: 'minute-label', axis: 'longitude', label,
        }));
        lastLabelScreenY = screenY;
      }
    }
  }

  for (const lat of parallels) {
    const interval = selectOncTickInterval(zoom, lat);
    if (!interval) continue;
    let lastLabelScreenX: number | undefined;
    const firstMinute = Math.ceil((west * 60 - 1e-8) / interval) * interval;
    const lastMinute = Math.floor((east * 60 + 1e-8) / interval) * interval;
    for (let totalMinutes = firstMinute; totalMinutes <= lastMinute; totalMinutes += interval) {
      const minuteInDegree = ((totalMinutes % 60) + 60) % 60;
      if (isDegreeIntersectionMinute(minuteInDegree)) continue;
      const lon = totalMinutes / 60;
      const intervalAtPoint = selectOncTickInterval(zoom, lat);
      if (intervalAtPoint !== interval && intervalAtPoint > interval) continue;
      const tickMinutes = minuteInDegree % 10 === 0 ? 10 : minuteInDegree % 5 === 0 ? 5 : 1;
      const halfPixels = tickMinutes === 10 ? 8 : tickMinutes === 5 ? 5 : 3;
      const halfMercator = halfPixels * 2 * Math.PI / worldPixels;
      const centerY = mercatorY(lat);
      const northTickLat = latitudeAtMercatorY(centerY + halfMercator);
      const southTickLat = latitudeAtMercatorY(centerY - halfMercator);
      features.push(lineFeature([lon, northTickLat], [lon, southTickLat], {
        kind: 'tick', axis: 'latitude', tickMinutes,
      }));
      const label = minuteLabel(totalMinutes);
      const screenX = lon * pixelsPerLongitudeDegree;
      const distanceToIntersection = Math.min(minuteInDegree, 60 - minuteInDegree)
        * pixelsPerLongitudeDegree / 60;
      if (label && distanceToIntersection >= halfLabelGapPx
        && (lastLabelScreenX === undefined || Math.abs(screenX - lastLabelScreenX) >= minuteLabelMinSpacingPx)) {
        const labelLat = latitudeAtMercatorY(centerY - (halfPixels + 5) * 2 * Math.PI / worldPixels);
        features.push(pointFeature([lon, labelLat], { kind: 'minute-label', axis: 'latitude', label }));
        lastLabelScreenX = screenX;
      }
    }
  }

  // Keep degree labels on the full-degree lines at approximately 300 px spacing.
  const labelSpacingPx = 300;
  const northY = mercatorY(north);
  const southY = mercatorY(south);
  const mercatorUnitsPerPixel = 2 * Math.PI / worldPixels;
  const labelSpacingY = Math.max(1, Math.min(labelSpacingPx, (southY - northY) / mercatorUnitsPerPixel));
  for (const lon of meridians) {
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
  for (const lat of parallels) {
    const spacing = labelSpacingX / pixelsPerLongitudeDegree;
    for (let lon = west + spacing / 2; lon <= east; lon += spacing) {
      features.push(pointFeature([lon, lat], { kind: 'degree-label', axis: 'latitude', label: axisText(lat, 'latitude') }));
    }
  }

  return { type: 'FeatureCollection', features };
}
