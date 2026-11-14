/**
 * BMKG Maritim API client.
 *
 * BMKG (Badan Meteorologi, Klimatologi, dan Geofisika) publishes free, no-API-key
 * marine weather data for Indonesian waters via https://maritim.bmkg.go.id/.
 *
 * Workflow:
 *  1. Download `meta/wilmetos.min.geojson` once (cached in memory) — contains 379
 *     polygons covering Indonesian sea areas (perairan).
 *  2. For a given LKP (lat, lng), find the polygon that contains the point.
 *  3. Fetch `perairan/{ID_MAR}.json` to get the forecast.
 *  4. Convert wind direction from Bahasa Indonesia ("Utara", "Barat Laut", …)
 *     to degrees True.
 *
 * Reference: https://maritim.bmkg.go.id/apidoc
 * License: Public data, no API key required, CORS allowed.
 */

import type { LatLng } from './sarCalculations';

const BMKG_BASE = 'https://maritim.bmkg.go.id/marine2026-data';
const BMKG_GEOJSON_URL = `${BMKG_BASE}/meta/wilmetos.min.geojson`;

/** Indonesian wind direction names → degrees True (direction FROM which wind blows). */
const WIND_DIR_ID_TO_DEG: Record<string, number> = {
  'Utara': 0,
  'Timur Laut': 45,
  'Timur': 90,
  'Tenggara': 135,
  'Selatan': 180,
  'Barat Daya': 225,
  'Barat': 270,
  'Barat Laut': 315,
  'Tengah': 0, // treated as variable — default to 0
  'Tenang': 0, // calm — no direction
  'Berubah-ubah': 0, // variable
};

/** Indonesian current direction names → degrees True (direction TOWARD which current flows). */
const CURRENT_DIR_ID_TO_DEG: Record<string, number> = {
  'Utara': 0,
  'Timur Laut': 45,
  'Timur': 90,
  'Tenggara': 135,
  'Selatan': 180,
  'Barat Daya': 225,
  'Barat': 270,
  'Barat Laut': 315,
};

/** One marine area polygon from BMKG geojson. */
export interface BmkgArea {
  id: string; // ID_MAR
  name: string; // perairan
  province: string;
}

interface GeoJsonFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    ID_MAR?: string;
    perairan?: string;
    provinsi?: string;
    wilpro?: string;
    [k: string]: unknown;
  };
}

interface GeoJson {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
}

// In-memory cache of the GeoJSON
let geojsonCache: GeoJson | null = null;
let geojsonPromise: Promise<GeoJson | null> | null = null;

/** Fetch and cache the BMKG wilmetos geojson. Returns null on failure. */
async function loadGeoJson(): Promise<GeoJson | null> {
  if (geojsonCache) return geojsonCache;
  if (geojsonPromise) return geojsonPromise;
  geojsonPromise = (async () => {
    try {
      const res = await fetch(BMKG_GEOJSON_URL, { cache: 'force-cache' });
      if (!res.ok) return null;
      const json = (await res.json()) as GeoJson;
      geojsonCache = json;
      return json;
    } catch {
      return null;
    } finally {
      geojsonPromise = null;
    }
  })();
  return geojsonPromise;
}

/** Ray-casting point-in-polygon test for a single polygon ring. */
function pointInRing(lat: number, lng: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]; // lng
    const yi = ring[i][1]; // lat
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lat: number, lng: number, geom: GeoJsonFeature['geometry']): boolean {
  if (geom.type === 'Polygon') {
    // First ring is outer; subsequent rings are holes (excluded if point is in hole).
    const rings = geom.coordinates as number[][][];
    if (!pointInRing(lat, lng, rings[0])) return false;
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(lat, lng, rings[i])) return false;
    }
    return true;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates as number[][][][];
    return polys.some((poly) => pointInPolygon(lat, lng, { type: 'Polygon', coordinates: poly }));
  }
  return false;
}

/**
 * Find the BMKG marine area that contains the given lat/lng.
 * Returns null if the point is outside BMKG coverage (e.g. open ocean outside Indonesia).
 */
export async function findBmkgArea(lat: number, lng: number): Promise<BmkgArea | null> {
  const gj = await loadGeoJson();
  if (!gj) return null;
  for (const feature of gj.features) {
    if (pointInPolygon(lat, lng, feature.geometry)) {
      const id = feature.properties.ID_MAR;
      if (!id) continue;
      return {
        id,
        name: feature.properties.perairan ?? feature.properties.wilpro ?? 'Unknown area',
        province: feature.properties.provinsi ?? '',
      };
    }
  }
  return null;
}

/** Convert Indonesian wind direction string to degrees True (FROM direction). */
export function windDirIdToDeg(dir: string | undefined | null): number {
  if (!dir) return 0;
  const cleaned = dir.trim();
  if (WIND_DIR_ID_TO_DEG[cleaned] != null) return WIND_DIR_ID_TO_DEG[cleaned];
  // Try matching substring (e.g. "Angin Utara" → 0)
  for (const [key, deg] of Object.entries(WIND_DIR_ID_TO_DEG)) {
    if (cleaned.includes(key)) return deg;
  }
  // Try parsing as a number (degrees)
  const n = Number(cleaned.replace(/[^\d.]/g, ''));
  return isFinite(n) ? n : 0;
}

/** Convert Indonesian current direction string to degrees True (TOWARD direction). */
export function currentDirIdToDeg(dir: string | undefined | null): number {
  if (!dir) return 0;
  const cleaned = dir.trim();
  if (CURRENT_DIR_ID_TO_DEG[cleaned] != null) return CURRENT_DIR_ID_TO_DEG[cleaned];
  for (const [key, deg] of Object.entries(CURRENT_DIR_ID_TO_DEG)) {
    if (cleaned.includes(key)) return deg;
  }
  const n = Number(cleaned.replace(/[^\d.]/g, ''));
  return isFinite(n) ? n : 0;
}

/** Forecast entry from BMKG perairan endpoint. */
export interface BmkgForecastEntry {
  time: string;
  weather: string;
  temp_avg: number;
  rh_avg: number;
  wind_from: string;
  wind_speed: number;
  wind_gust: number;
  wave_cat: string;
  wave_height: number;
  current_to: string;
  current_speed: number;
}

/** BMKG perairan response shape. */
interface BmkgPerairanResponse {
  code: string;
  name: string;
  issued: string;
  valid_from: string;
  valid_to: string;
  forecast_day1?: BmkgForecastEntry[];
  forecast_day2?: BmkgForecastEntry[];
  forecast_day3?: BmkgForecastEntry[];
  forecast_day4?: BmkgForecastEntry[];
  [k: string]: unknown;
}

export interface BmkgMarineData {
  areaId: string;
  areaName: string;
  province: string;
  issued: string;
  validFrom: string;
  validTo: string;
  /** Combined hourly forecasts across all forecast_day1..4 arrays. */
  forecasts: BmkgForecastEntry[];
}

/**
 * Fetch BMKG marine forecast for a given area ID.
 * Endpoint: /perairan/{ID_MAR}.json
 */
export async function fetchBmkgForecast(areaId: string): Promise<BmkgMarineData | null> {
  try {
    const url = `${BMKG_BASE}/perairan/${encodeURIComponent(areaId)}.json`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = (await res.json()) as BmkgPerairanResponse;
    const forecasts: BmkgForecastEntry[] = [];
    for (const key of ['forecast_day1', 'forecast_day2', 'forecast_day3', 'forecast_day4'] as const) {
      if (Array.isArray(json[key])) {
        forecasts.push(...(json[key] as BmkgForecastEntry[]));
      }
    }
    return {
      areaId: json.code,
      areaName: json.name,
      province: '',
      issued: json.issued,
      validFrom: json.valid_from,
      validTo: json.valid_to,
      forecasts,
    };
  } catch {
    return null;
  }
}

/** Fetch and aggregate BMKG data, averaged over the drift interval (hours from now). */
export interface BmkgAggregatedData {
  areaId: string;
  areaName: string;
  windDirFromDeg: number;
  windSpeedKts: number;
  visibilityNm: number; // estimated from weather description (no direct field in BMKG)
  waveHeightM: number;
  /** Wave direction is not provided by BMKG; default to wind direction as approximation. */
  waveDirectionDeg: number;
  wavePeriodS: number;
  /** Current direction (°T, toward). */
  currentDirDeg: number;
  currentSpeedKts: number;
  /** Sea surface temperature (°C) — BMKG returns temp_avg as air temp; use as SST approximation. */
  sstC: number;
  fetchTime: string;
  issued: string;
  validFrom: string;
  validTo: string;
}

/**
 * Aggregate BMKG forecast entries over the drift interval starting from "now".
 * Wind: vector average (downwind dir + 180 to get "from").
 * Current: vector average (set = "toward" direction).
 * Wave/temp: arithmetic mean.
 */
export function aggregateBmkgForecast(
  data: BmkgMarineData,
  driftIntervalHours: number,
): BmkgAggregatedData {
  const now = new Date();
  // BMKG uses UTC time strings like "2026-11-15 00:00 UTC"
  const entries = data.forecasts.filter((f) => {
    try {
      const t = new Date(f.time.replace(' UTC', 'Z'));
      return t >= now;
    } catch {
      return false;
    }
  });
  const take = entries.slice(0, Math.max(1, Math.ceil(driftIntervalHours / 3) + 1));

  // Vector-average wind (downwind = wind_from + 180)
  let uWind = 0, vWind = 0, nWind = 0;
  let waveSum = 0, nWave = 0;
  let tempSum = 0, nTemp = 0;
  let ocU = 0, ocV = 0, nOc = 0;
  for (const e of take) {
    const wDir = windDirIdToDeg(e.wind_from);
    const wSpd = typeof e.wind_speed === 'number' ? e.wind_speed : 0;
    const downwindRad = ((wDir + 180) * Math.PI) / 180;
    uWind += wSpd * Math.sin(downwindRad);
    vWind += wSpd * Math.cos(downwindRad);
    nWind++;
    if (typeof e.wave_height === 'number') { waveSum += e.wave_height; nWave++; }
    if (typeof e.temp_avg === 'number') { tempSum += e.temp_avg; nTemp++; }
    const cDir = currentDirIdToDeg(e.current_to);
    const cSpd = typeof e.current_speed === 'number' ? e.current_speed : 0;
    const cRad = (cDir * Math.PI) / 180;
    ocU += cSpd * Math.sin(cRad);
    ocV += cSpd * Math.cos(cRad);
    nOc++;
  }
  const downwindDir = nWind > 0 ? (Math.atan2(uWind, vWind) * 180) / Math.PI : 0;
  const avgWindDirFrom = ((downwindDir + 360) % 360 + 180) % 360;
  const avgWindSpeed = nWind > 0 ? Math.sqrt(uWind * uWind + vWind * vWind) / nWind : 0;
  const avgWaveH = nWave > 0 ? waveSum / nWave : 0;
  const avgTemp = nTemp > 0 ? tempSum / nTemp : 0;
  const currentDir = nOc > 0 ? (Math.atan2(ocU, ocV) * 180) / Math.PI : 0;
  const currentDirNorm = (currentDir + 360) % 360;
  const currentSpeed = nOc > 0 ? Math.sqrt(ocU * ocU + ocV * ocV) / nOc : 0;

  // Estimate visibility from weather description (BMKG doesn't return visibility directly)
  const visibility = estimateVisibilityFromWeather(take[0]?.weather ?? '');

  return {
    areaId: data.areaId,
    areaName: data.areaName,
    windDirFromDeg: avgWindDirFrom,
    windSpeedKts: avgWindSpeed,
    visibilityNm: visibility,
    waveHeightM: avgWaveH,
    waveDirectionDeg: avgWindDirFrom, // approximate — BMKG doesn't provide wave direction
    wavePeriodS: 0, // not provided
    currentDirDeg: currentDirNorm,
    currentSpeedKts: currentSpeed,
    sstC: avgTemp,
    fetchTime: now.toISOString(),
    issued: data.issued,
    validFrom: data.validFrom,
    validTo: data.validTo,
  };
}

/** Rough visibility estimate from BMKG weather description (Indonesian). */
function estimateVisibilityFromWeather(weather: string): number {
  const w = weather.toLowerCase();
  if (w.includes('cerah') || w.includes('berawan')) return 10;
  if (w.includes('hujan ringan')) return 5;
  if (w.includes('hujan sedang') || w.includes('hujan lebat')) return 2;
  if (w.includes('kabut') || w.includes('asap')) return 1;
  if (w.includes('hujan petir') || w.includes('badai')) return 0.5;
  return 8; // default
}
