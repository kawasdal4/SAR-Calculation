/**
 * Bathymetric depth lookup via GEBCO WMS GetFeatureInfo.
 *
 * Calls go DIRECTLY from the browser to https://wms.gebco.net/mapserv?
 * (no Route Handler / Server Action / proxy) so the Vercel free tier doesn't
 * burn Fast Origin Transfer or Functions quota.
 *
 * Why GEBCO WMS GetFeatureInfo instead of Open-Topo-Data?
 *   - GEBCO WMS returns `Access-Control-Allow-Origin: *` (CORS works)
 *   - Open-Topo-Data public endpoint does NOT return CORS headers, so
 *     browser-side fetch fails. Self-hosting would violate the user's
 *     "no server-side proxy" rule.
 *   - GEBCO WMS is the same data source as the bathymetry tiles
 *     (consistency: tiles & depth query use the same grid).
 *
 * Endpoint verified Nov 2026 via:
 *   https://wms.gebco.net/mapserv?service=WMS&request=GetCapabilities&version=1.3.0
 * Layer `GEBCO_LATEST_2` is `queryable="1"` and returns elevation values.
 *
 * Example response (text/plain, default info_format):
 *   GetFeatureInfo results:
 *
 *   Layer 'GEBCO_LATEST_2'
 *     Feature 0:
 *       x = '106.50625'
 *       y = '-5.50625'
 *       value_list = '-23'
 *
 * `value_list` is the elevation in metres (negative = below sea level).
 */

import type { LatLng } from './sarCalculations';

export interface DepthResult {
  /** Latitude as queried. */
  lat: number;
  /** Longitude as queried. */
  lng: number;
  /** Elevation in metres (negative = below sea level). */
  elevation: number | null;
  /** Dataset name. */
  dataset: string;
}

const GEBCO_WMS_URL = 'https://wms.gebco.net/mapserv?';
const GEBCO_QUERY_LAYER = 'GEBCO_LATEST_2';

// In-memory cache: rounded to 0.001° (~111 m) — good enough for SAR planning.
const cache = new Map<string, DepthResult>();

function roundCoord(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

/** Parse GEBCO GetFeatureInfo plain-text response. */
function parseGebcoResponse(text: string, lat: number, lng: number): DepthResult {
  // Match: value_list = '-23'  OR  value_list = '-23.5'
  const match = text.match(/value_list\s*=\s*'?(-?\d+(?:\.\d+)?)'?/);
  if (!match) {
    return { lat, lng, elevation: null, dataset: 'GEBCO_LATEST_2' };
  }
  const elevation = parseFloat(match[1]);
  return {
    lat,
    lng,
    elevation: isFinite(elevation) ? elevation : null,
    dataset: 'GEBCO_LATEST_2',
  };
}

/**
 * Fetch depth for a single lat/lng from GEBCO WMS GetFeatureInfo.
 * Cached so repeat clicks on the same point don't re-fetch.
 *
 * Implementation: request a tiny 3x3 image around the point and query the
 * centre pixel. This is more reliable than requesting a 1x1 image because
 * some WMS servers dislike edge-pixel queries.
 */
export async function fetchDepth(lat: number, lng: number): Promise<DepthResult | null> {
  const key = roundCoord(lat, lng);
  const cached = cache.get(key);
  if (cached) return cached;

  // Build a small WMS GetFeatureInfo request centred on (lat, lng).
  // bbox: ±0.005° (~550 m) around the point; image 3x3; query centre pixel (i=1, j=1).
  const half = 0.005;
  const south = lat - half;
  const north = lat + half;
  const west = lng - half;
  const east = lng + half;
  // WMS 1.3.0 + EPSG:4326 → bbox order is (south, west, north, east) = (minLat, minLng, maxLat, maxLng)
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetFeatureInfo',
    layers: GEBCO_QUERY_LAYER,
    query_layers: GEBCO_QUERY_LAYER,
    crs: 'EPSG:4326',
    bbox: `${south},${west},${north},${east}`,
    width: '3',
    height: '3',
    i: '1', // x index of centre pixel (0-based)
    j: '1', // y index of centre pixel (0-based)
  });
  const url = `${GEBCO_WMS_URL}${params.toString()}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(
        res.status === 429
          ? 'GEBCO WMS rate limit exceeded. Coba lagi sebentar.'
          : `GEBCO WMS HTTP ${res.status}`,
      );
    }
    const text = await res.text();
    const result = parseGebcoResponse(text, lat, lng);
    cache.set(key, result);
    return result;
  } catch (e) {
    throw new Error(
      `Gagal mengambil kedalaman dari GEBCO WMS: ${(e as Error).message}. ` +
      `Pastikan koneksi internet aktif.`,
    );
  }
}

/**
 * Sample depths across a polygon. Generates a grid of up to `maxPoints`
 * sample points inside the polygon bounding box, filters to those inside
 * the polygon (via point-in-polygon test), and queries each point.
 *
 * @param polygon Array of {lat,lng} vertices (closed or open)
 * @param maxPoints Maximum number of sample points (default 100)
 * @returns Array of DepthResult for points inside the polygon.
 */
export async function fetchPolygonDepths(
  polygon: Array<{ lat: number; lng: number }>,
  maxPoints = 100,
): Promise<DepthResult[]> {
  if (polygon.length < 3) return [];

  // Bounding box
  let minLat = polygon[0].lat;
  let maxLat = polygon[0].lat;
  let minLng = polygon[0].lng;
  let maxLng = polygon[0].lng;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  // Choose grid resolution so we don't exceed maxPoints
  const aspect = Math.max(0.1, (maxLng - minLng) / Math.max(0.001, maxLat - minLat));
  const cols = Math.max(2, Math.ceil(Math.sqrt(maxPoints * aspect)));
  const rows = Math.max(2, Math.ceil(maxPoints / cols));
  const dLat = (maxLat - minLat) / rows;
  const dLng = (maxLng - minLng) / cols;

  const samples: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const lat = minLat + (i + 0.5) * dLat;
      const lng = minLng + (j + 0.5) * dLng;
      if (pointInPolygon(lat, lng, polygon)) {
        samples.push({ lat, lng });
        if (samples.length >= maxPoints) break;
      }
    }
    if (samples.length >= maxPoints) break;
  }

  if (samples.length === 0) return [];

  // Query each sample point. GEBCO WMS has no published rate limit, but we
  // still batch in groups of 10 concurrent requests to be polite.
  const results: DepthResult[] = [];
  const BATCH = 10;
  for (let i = 0; i < samples.length; i += BATCH) {
    const batch = samples.slice(i, i + BATCH);
    const batchResults = await Promise.all(
      batch.map(async (p) => {
        try {
          return await fetchDepth(p.lat, p.lng);
        } catch {
          return null;
        }
      }),
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }
  }
  return results;
}

/** Ray-casting point-in-polygon test. Polygon must be closed (no need to repeat first point). */
function pointInPolygon(lat: number, lng: number, polygon: Array<{ lat: number; lng: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Compute min / max / mean elevation from a list of DepthResult. */
export function summariseDepths(results: DepthResult[]): {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
} {
  const elevations = results
    .map((r) => r.elevation)
    .filter((e): e is number => e != null && isFinite(e));
  if (elevations.length === 0) {
    return { count: 0, min: null, max: null, mean: null };
  }
  let min = elevations[0];
  let max = elevations[0];
  let sum = 0;
  for (const e of elevations) {
    if (e < min) min = e;
    if (e > max) max = e;
    sum += e;
  }
  return {
    count: elevations.length,
    min,
    max,
    mean: sum / elevations.length,
  };
}
