import type { Feature, FeatureCollection, Geometry } from 'geojson';

export type OncGridProperties = {
  kind: 'major' | 'minor' | 'tick-10' | 'tick-5' | 'tick-1' | 'degree-label' | 'minute-label';
  axis?: 'longitude' | 'latitude';
  edge?: 'north' | 'south' | 'west' | 'east';
  label?: string;
};

const EMPTY_GRID: FeatureCollection<Geometry, OncGridProperties> = { type: 'FeatureCollection', features: [] };

function lineFeature(
  start: [number, number],
  end: [number, number],
  properties: OncGridProperties,
): Feature<Geometry, OncGridProperties> {
  return { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: [start, end] } };
}

function pointFeature(
  position: [number, number],
  properties: OncGridProperties,
): Feature<Geometry, OncGridProperties> {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: position } };
}

function axisText(degrees: number, axis: 'longitude' | 'latitude'): string {
  const abs = Math.abs(degrees);
  const whole = Math.floor(abs + 1e-8);
  const hemisphere = axis === 'longitude'
    ? degrees < 0 ? 'W' : 'E'
    : degrees < 0 ? 'S' : 'N';
  return `${String(whole).padStart(axis === 'longitude' ? 3 : 2, '0')}°${hemisphere}`;
}

function minuteLabel(totalMinutes: number): string | null {
  const minute = Math.abs(totalMinutes) % 60;
  return minute !== 0 && minute % 10 === 0 ? String(minute) : null;
}

function alignedStart(min: number, interval: number): number {
  return Math.ceil((min - 1e-8) / interval) * interval;
}

/** Generate only the current viewport's ONC-style graticule and neatline ticks. */
export function buildOncGraticule(
  bounds: { west: number; south: number; east: number; north: number },
  width: number,
  height: number,
  zoom: number,
): FeatureCollection<Geometry, OncGridProperties> {
  const { west, south, east, north } = bounds;
  if (!Number.isFinite(west + south + east + north) || east <= west || north <= south || width <= 0 || height <= 0) {
    return EMPTY_GRID;
  }

  const features: Array<Feature<Geometry, OncGridProperties>> = [];
  const latTickLength = (north - south) * 8 / height;
  const lngTickLength = (east - west) * 8 / width;
  const longitudeLabelInset = Math.max(latTickLength * 1.7, (north - south) * 20 / height);
  const latitudeLabelInset = Math.max(lngTickLength * 1.7, (east - west) * 24 / width);

  // Primary meridians and parallels: 1 degree.
  for (let lon = Math.ceil(west); lon <= east + 1e-8; lon += 1) {
    features.push(lineFeature([lon, south], [lon, north], { kind: 'major', axis: 'longitude' }));
    features.push(pointFeature([lon, north - longitudeLabelInset], {
      kind: 'degree-label', axis: 'longitude', edge: 'north', label: axisText(lon, 'longitude'),
    }));
  }
  for (let lat = Math.ceil(south); lat <= north + 1e-8; lat += 1) {
    features.push(lineFeature([west, lat], [east, lat], { kind: 'major', axis: 'latitude' }));
    features.push(pointFeature([west + latitudeLabelInset, lat], {
      kind: 'degree-label', axis: 'latitude', edge: 'west', label: axisText(lat, 'latitude'),
    }));
  }

  // Secondary graticule: every 30 minutes.
  for (let halfLon = alignedStart(west * 2, 1); halfLon / 2 <= east + 1e-8; halfLon += 1) {
    const lon = halfLon / 2;
    if (Math.abs(lon - Math.round(lon)) < 1e-8) continue;
    features.push(lineFeature([lon, south], [lon, north], { kind: 'minor', axis: 'longitude' }));
  }
  for (let halfLat = alignedStart(south * 2, 1); halfLat / 2 <= north + 1e-8; halfLat += 1) {
    const lat = halfLat / 2;
    if (Math.abs(lat - Math.round(lat)) < 1e-8) continue;
    features.push(lineFeature([west, lat], [east, lat], { kind: 'minor', axis: 'latitude' }));
  }

  const tickMinutes = zoom < 6 ? 10 : zoom < 10 ? 5 : 1;
  const tickKind: OncGridProperties['kind'] = tickMinutes === 10 ? 'tick-10' : tickMinutes === 5 ? 'tick-5' : 'tick-1';
  const tickLengthFactor = tickMinutes === 10 ? 1 : tickMinutes === 5 ? 0.65 : 0.4;
  const latTick = latTickLength * tickLengthFactor;
  const lngTick = lngTickLength * tickLengthFactor;
  const firstLonMinute = alignedStart(west * 60, tickMinutes);
  const lastLonMinute = Math.floor(east * 60 + 1e-8);
  for (let total = firstLonMinute; total <= lastLonMinute; total += tickMinutes) {
    const lon = total / 60;
    if (lon < west || lon > east) continue;
    for (const edge of ['north', 'south'] as const) {
      const edgeLat = edge === 'north' ? north : south;
      const insideLat = edge === 'north' ? north - latTick : south + latTick;
      features.push(lineFeature([lon, edgeLat], [lon, insideLat], { kind: tickKind, axis: 'longitude', edge }));
      const label = minuteLabel(total);
      if (label) features.push(pointFeature([lon, edge === 'north' ? north - longitudeLabelInset : south + longitudeLabelInset], {
        kind: 'minute-label', axis: 'longitude', edge, label,
      }));
    }
  }

  const firstLatMinute = alignedStart(south * 60, tickMinutes);
  const lastLatMinute = Math.floor(north * 60 + 1e-8);
  for (let total = firstLatMinute; total <= lastLatMinute; total += tickMinutes) {
    const lat = total / 60;
    if (lat < south || lat > north) continue;
    for (const edge of ['west', 'east'] as const) {
      const edgeLon = edge === 'west' ? west : east;
      const insideLon = edge === 'west' ? west + lngTick : east - lngTick;
      features.push(lineFeature([edgeLon, lat], [insideLon, lat], { kind: tickKind, axis: 'latitude', edge }));
      const label = minuteLabel(total);
      if (label) features.push(pointFeature([edge === 'west' ? west + latitudeLabelInset : east - latitudeLabelInset, lat], {
        kind: 'minute-label', axis: 'latitude', edge, label,
      }));
    }
  }

  return { type: 'FeatureCollection', features };
}
