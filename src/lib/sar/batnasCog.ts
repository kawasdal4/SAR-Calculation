/**
 * BATNAS Cloud Optimized GeoTIFF (COG) reader — browser-only.
 *
 * Reads a COG file hosted externally (e.g. on Supabase Storage, R2, S3)
 * via HTTP range requests. Uses geotiff.js for parsing.
 *
 * Why dynamic import:
 *   - geotiff.js is ESM-only and uses `Buffer`, `stream`, etc. when imported
 *     at module top-level — these break Next.js SSR (server bundle).
 *   - By dynamic-importing only inside async functions, the geotiff.js code
 *     only loads when called from the browser (after hydration).
 *
 * Env var: NEXT_PUBLIC_BATNAS_COG_URL
 *   - Must be a publicly accessible HTTPS URL to a .tif or .cog file.
 *   - The host must allow CORS (Range requests) and HTTP/1.1 Range header.
 *   - If unset, this module is a no-op (returns null) and the app falls
 *     back to GEBCO WMS GetFeatureInfo.
 *
 * Resolution note: BATNAS grid is ~180 m. Each pixel covers ~0.0016° lat.
 */

import type { LatLng } from './sarCalculations';

const BATNAS_COG_URL = process.env.NEXT_PUBLIC_BATNAS_COG_URL;

// Cache parsed GeoTIFF so we don't re-fetch on every depth query.
// We use `unknown` here because geotiff.js's TypeScript types don't fully
// match the runtime API (e.g. GeoTransform, ModelPixelScale are untyped).
// All access to `image` is done via small typed wrappers below.
let cogParsed: { image: unknown } | null = null;
let cogInitPromise: Promise<{ image: unknown } | null> | null = null;

/** Lazily parse the COG file. Cached. Returns null if env var unset or fetch fails. */
async function loadCog(): Promise<{ image: unknown } | null> {
  if (!BATNAS_COG_URL) return null;
  if (cogParsed) return cogParsed;
  if (cogInitPromise) return cogInitPromise;

  cogInitPromise = (async () => {
    try {
      // Dynamic import inside the function — only loads in browser at runtime.
      const mod = await import('geotiff');
      // geotiff v3 exports `fromUrl` as a named export (and default in some builds)
      const fromUrl = (mod as { fromUrl?: (url: string) => Promise<unknown> }).fromUrl
        ?? (mod as { default?: { fromUrl?: (url: string) => Promise<unknown> } }).default?.fromUrl;
      if (!fromUrl) throw new Error('geotiff.js fromUrl not found');
      const tiff: unknown = await fromUrl(BATNAS_COG_URL);
      const image = await (tiff as { getImage: () => Promise<unknown> }).getImage();
      cogParsed = { image };
      return cogParsed;
    } catch (e) {
      console.warn('BATNAS COG load failed — will fall back to GEBCO WMS:', (e as Error).message);
      cogParsed = null;
      return null;
    } finally {
      cogInitPromise = null;
    }
  })();
  return cogInitPromise;
}

/** Type-safe wrapper around the cached geotiff.js image. */
interface GeoTiffImage {
  getOrigin: () => Promise<number[]>;
  getResolution: () => Promise<number[]>;
  getFileDirectory: () => Record<string, unknown>;
  readRasters: (opts: {
    window: [number, number, number, number];
    width: number;
    height: number;
    samples?: number[];
  }) => Promise<ArrayLike<ArrayLike<number>>>;
}

function asGeoTiffImage(image: unknown): GeoTiffImage {
  return image as GeoTiffImage;
}

/** Convert lat/lng to pixel (col, row) using GeoTransform. */
function latLngToPixel(
  lat: number,
  lng: number,
  origin: [number, number, number] | { x: number; y: number; z: number },
  pixelScale: { X: number; Y: number },
): { col: number; row: number } {
  const ox = Array.isArray(origin) ? origin[0] : origin.x;
  const oy = Array.isArray(origin) ? origin[1] : origin.y;
  const col = Math.floor((lng - ox) / pixelScale.X);
  const row = Math.floor((oy - lat) / pixelScale.Y);
  return { col, row };
}

export interface BatnasDepthResult {
  lat: number;
  lng: number;
  elevation: number | null;
  dataset: string;
}

/**
 * Fetch depth (elevation in metres) at a single lat/lng from BATNAS COG.
 * Returns null if env var unset, COG failed to load, or point is out of range.
 */
export async function fetchBatnasDepth(lat: number, lng: number): Promise<BatnasDepthResult | null> {
  if (!BATNAS_COG_URL) return null;
  const cog = await loadCog();
  if (!cog) return null;

  try {
    const image = asGeoTiffImage(cog.image);
    // GeoTransform: [originX, pixelSizeX, 0, originY, 0, pixelSizeY]
    // Standard COG from BIG should have GeoTransform set.
    const fd = image.getFileDirectory();
    let origin: [number, number, number];
    let pixelScale: { X: number; Y: number };

    // Prefer GeoTransform (most COG files have this)
    const geoTransform = fd.GeoTransform as number[] | undefined;
    if (geoTransform && geoTransform.length >= 6) {
      // GeoTransform: [top-left X, pixel width, 0, top-left Y, 0, pixel height (negative)]
      origin = [geoTransform[0], geoTransform[3], 0];
      pixelScale = { X: geoTransform[1], Y: Math.abs(geoTransform[5]) };
    } else {
      // Fallback: ModelPixelScale + ModelTiepoint
      const scale = fd.ModelPixelScale as { X: number; Y: number } | undefined;
      const tiepoint = fd.ModelTiepoint as number[] | undefined;
      if (!scale || !tiepoint || tiepoint.length < 6) {
        // Last resort: use getOrigin + getResolution (geotiff.js abstracted)
        const o = await image.getOrigin();
        const r = await image.getResolution();
        origin = [o[0], o[1], o[2]];
        pixelScale = { X: r[0], Y: Math.abs(r[1]) };
      } else {
        origin = [tiepoint[3], tiepoint[4], tiepoint[5]];
        pixelScale = { X: scale.X, Y: scale.Y };
      }
    }

    const { col, row } = latLngToPixel(lat, lng, origin, pixelScale);
    if (col < 0 || row < 0) return null;

    // Read a 1x1 window at (col, row). geotiff.js expects window as [left, top, right, bottom].
    const rasters = await image.readRasters({
      window: [col, row, col + 1, row + 1],
      width: 1,
      height: 1,
      samples: [0],
    });
    const arr = rasters[0];
    if (!arr || arr.length === 0) return null;
    const raw = arr[0];
    // BATNAS elevations are typically metres (signed: negative = below sea level).
    const elevation = typeof raw === 'number' ? raw : Number(raw);
    if (!isFinite(elevation)) return null;

    return {
      lat,
      lng,
      elevation,
      dataset: 'BATNAS (BIG)',
    };
  } catch (e) {
    console.warn('BATNAS COG depth lookup failed:', (e as Error).message);
    return null;
  }
}

/**
 * Sample depths across a polygon from BATNAS COG.
 *
 * Because geotiff.js is slow at many 1x1 reads, we read the bounding box
 * of the polygon in one call (with subsetting to a reasonable size),
 * then sample grid points from the resulting array.
 *
 * Returns [] if COG is not available.
 */
export async function fetchBatnasPolygonDepths(
  polygon: Array<{ lat: number; lng: number }>,
  maxPoints = 100,
): Promise<BatnasDepthResult[]> {
  if (!BATNAS_COG_URL) return [];
  if (polygon.length < 3) return [];

  const cog = await loadCog();
  if (!cog) return [];

  try {
    const image = asGeoTiffImage(cog.image);
    const fd = image.getFileDirectory();
    let origin: [number, number, number];
    let pixelScale: { X: number; Y: number };
    const geoTransform = fd.GeoTransform as number[] | undefined;
    if (geoTransform && geoTransform.length >= 6) {
      origin = [geoTransform[0], geoTransform[3], 0];
      pixelScale = { X: geoTransform[1], Y: Math.abs(geoTransform[5]) };
    } else {
      const scale = fd.ModelPixelScale as { X: number; Y: number } | undefined;
      const tiepoint = fd.ModelTiepoint as number[] | undefined;
      if (!scale || !tiepoint || tiepoint.length < 6) {
        const o = await image.getOrigin();
        const r = await image.getResolution();
        origin = [o[0], o[1], o[2]];
        pixelScale = { X: r[0], Y: Math.abs(r[1]) };
      } else {
        origin = [tiepoint[3], tiepoint[4], tiepoint[5]];
        pixelScale = { X: scale.X, Y: scale.Y };
      }
    }

    // Bounding box of polygon
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
    const ul = latLngToPixel(maxLat, minLng, origin, pixelScale);
    const lr = latLngToPixel(minLat, maxLng, origin, pixelScale);
    const col0 = Math.max(0, ul.col);
    const row0 = Math.max(0, ul.row);
    const col1 = Math.max(col0 + 1, lr.col);
    const row1 = Math.max(row0 + 1, lr.row);

    // Limit window size to avoid huge reads. Cap at maxPoints × maxPoints.
    const maxDim = Math.max(1, Math.ceil(Math.sqrt(maxPoints)));
    const width = Math.min(col1 - col0, maxDim);
    const height = Math.min(row1 - row0, maxDim);

    const rasters = await image.readRasters({
      window: [col0, row0, col0 + width, row0 + height],
      width,
      height,
      samples: [0],
    });
    const arr = rasters[0];
    if (!arr || arr.length === 0) return [];

    // Sample up to maxPoints from the read grid, filtered by point-in-polygon.
    const results: BatnasDepthResult[] = [];
    const aspect = Math.max(0.1, width / Math.max(1, height));
    const cols = Math.max(2, Math.ceil(Math.sqrt(maxPoints * aspect)));
    const rows = Math.max(2, Math.ceil(maxPoints / cols));
    let pushed = 0;
    for (let i = 0; i < rows && pushed < maxPoints; i++) {
      for (let j = 0; j < cols && pushed < maxPoints; j++) {
        const sampleRow = Math.floor((i + 0.5) * height / rows);
        const sampleCol = Math.floor((j + 0.5) * width / cols);
        const idx = sampleRow * width + sampleCol;
        if (idx >= arr.length) continue;
        const raw = arr[idx];
        const elevation = typeof raw === 'number' ? raw : Number(raw);
        if (!isFinite(elevation)) continue;
        // Convert pixel back to lat/lng for point-in-polygon test + result
        const lng = origin[0] + (col0 + sampleCol) * pixelScale.X;
        const lat = origin[1] - (row0 + sampleRow) * pixelScale.Y;
        if (pointInPolygon(lat, lng, polygon)) {
          results.push({ lat, lng, elevation, dataset: 'BATNAS (BIG)' });
          pushed++;
        }
      }
    }
    return results;
  } catch (e) {
    console.warn('BATNAS polygon depth lookup failed:', (e as Error).message);
    return [];
  }
}

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

/** True if BATNAS COG is configured (env var set). */
export function isBatnasCogConfigured(): boolean {
  return !!BATNAS_COG_URL;
}

// LatLng import is referenced by JSDoc only — silence unused-import warning.
export type _LatLng = LatLng;
