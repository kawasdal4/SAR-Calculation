/**
 * Layered depth-data source for the "Angka kedalaman" overlay on the sea map.
 *
 * Source priority:
 *   1. `NEXT_PUBLIC_BATNAS_COG_URL`  → BATNAS Cloud Optimized GeoTIFF (~180 m)
 *   2. `NEXT_PUBLIC_GEBCO_COG_URL`   → GEBCO Cloud Optimized GeoTIFF (~450 m)
 *   3. `/api/depth` proxy → GEBCO 2020 (server-side; see src/app/api/depth)
 *
 * COG sources read pixels directly from the remote TIFF via HTTP range
 * requests (geotiff.js, in-browser, no proxy). The GEBCO fallback goes
 * through the same-origin `/api/depth` Next.js route — the upstream API
 * (api.opentopodata.org) does NOT send CORS headers, so a direct browser
 * fetch always fails; the proxy fetches server-side and adds its own
 * TTL cache + rate limiting. On the client side this path is limited to
 * 100 points per request.
 *
 * Caching:
 *   - In-memory `Map<string, number>` keyed by `"lat,lng"` (rounded to 6 dp).
 *   - Optional localStorage mirror capped at 5000 entries (try/catch around
 *     every access; failures are silent — private mode, sandbox, etc.).
 *
 * Cancellation:
 *   - Every fetch carries an AbortController. When a newer viewport supersedes
 *     the in-flight one, the older controller is aborted. Stale reads are
 *     discarded silently.
 *
 * Error handling:
 *   - On rate limit (HTTP 429) or network error: emit a non-blocking error
 *     notification via the callback. Cached values are still returned. No
 *     retry storm.
 *
 * No `any`. Strict-typed throughout.
 */

import { fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff';
import type { DepthSource, GridPoint } from './depthLabels';

// ============================================================================
// Config (env-var driven; all client-side)
// ============================================================================

const BATNAS_COG_URL = process.env.NEXT_PUBLIC_BATNAS_COG_URL;
const GEBCO_COG_URL = process.env.NEXT_PUBLIC_GEBCO_COG_URL;
// Same-origin proxy (src/app/api/depth/route.ts). The upstream API sends no
// CORS headers, so the browser must never call it directly.
const DEPTH_PROXY_ENDPOINT = '/api/depth';
const DEPTH_PROXY_MAX_PER_REQUEST = 100;
// The proxy throttles upstream calls (>=1.1 s) and caches server-side, so
// the client only needs a small gap between its own requests.
const DEPTH_PROXY_MIN_INTERVAL_MS = 250;

const LOCALSTORAGE_KEY = 'seamap:depthCache';
const LOCALSTORAGE_MAX_ENTRIES = 5000;

// ============================================================================
// Active source detection
// ============================================================================

/** Returns the highest-priority source that's configured. */
export function getActiveDepthSource(): DepthSource {
  if (BATNAS_COG_URL) return 'BATNAS_COG';
  if (GEBCO_COG_URL) return 'GEBCO_COG';
  return 'OPENTOPO_GEBCO';
}

/** Human-readable label for the active source, for the Layers panel. */
export function getDepthSourceLabel(): string {
  switch (getActiveDepthSource()) {
    case 'BATNAS_COG': return 'BATNAS COG (~180 m, BIG Indonesia)';
    case 'GEBCO_COG': return 'GEBCO COG (~450 m)';
    case 'OPENTOPO_GEBCO': return 'GEBCO 2020 via proxy server (~450 m)';
    case 'NONE': return 'Tidak ada sumber';
  }
}

/** True if the active source is a Cloud Optimized GeoTIFF (range-request). */
function isCogSource(s: DepthSource): boolean {
  return s === 'BATNAS_COG' || s === 'GEBCO_COG';
}

// ============================================================================
// In-memory + localStorage cache
// ============================================================================

/** Cache key — rounded to 6 decimal places (~0.1 m at the equator). */
function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

const memoryCache = new Map<string, number>();

/** Load the localStorage mirror once, lazily. Returns null on any failure. */
function loadLocalCache(): Map<string, number> | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(LOCALSTORAGE_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(parsed));
  } catch {
    return null;
  }
}

let localCache: Map<string, number> | null = null;
function getLocalCache(): Map<string, number> | null {
  if (localCache === null) localCache = loadLocalCache();
  return localCache;
}

function saveLocalCache(cache: Map<string, number>): void {
  try {
    if (typeof window === 'undefined') return;
    // Trim to most-recent MAX entries (FIFO — Map preserves insertion order).
    if (cache.size > LOCALSTORAGE_MAX_ENTRIES) {
      const toRemove = cache.size - LOCALSTORAGE_MAX_ENTRIES;
      let i = 0;
      for (const k of cache.keys()) {
        cache.delete(k);
        if (++i >= toRemove) break;
      }
    }
    const obj: Record<string, number> = {};
    let n = 0;
    for (const [k, v] of cache) {
      obj[k] = v;
      if (++n >= LOCALSTORAGE_MAX_ENTRIES) break;
    }
    window.localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore quota / private mode
  }
}

function cacheGet(lat: number, lng: number): number | undefined {
  const k = cacheKey(lat, lng);
  if (memoryCache.has(k)) return memoryCache.get(k);
  const lc = getLocalCache();
  if (lc && lc.has(k)) {
    const v = lc.get(k)!;
    memoryCache.set(k, v); // promote to memory
    return v;
  }
  return undefined;
}

function cacheSet(lat: number, lng: number, value: number): void {
  const k = cacheKey(lat, lng);
  memoryCache.set(k, value);
  const lc = getLocalCache();
  if (lc) {
    lc.set(k, value);
    // Throttle localStorage writes — only every ~50 new entries.
    if (lc.size % 50 === 0) saveLocalCache(lc);
  }
}

function cacheFlush(): void {
  const lc = getLocalCache();
  if (lc) saveLocalCache(lc);
}

// ============================================================================
// COG reader (geotiff.js)
// ============================================================================

interface CogReader {
  /** Read a window of elevation values covering the given lat/lng bounds. */
  readWindow(south: number, north: number, west: number, east: number): Promise<Float32Array>;
  /** GeoTIFF bounding box [minX, minY, maxX, maxY] in lat/lng. */
  bbox: [number, number, number, number];
  /** Pixel width of the source image. */
  width: number;
  /** Pixel height of the source image. */
  height: number;
  /** Sample a single pixel value at pixel (px, py). */
  samplePixel(px: number, py: number): Promise<number | null>;
}

let cogReaderPromise: Promise<CogReader | null> | null = null;
let cogReaderInstance: CogReader | null = null;

async function loadCogReader(): Promise<CogReader | null> {
  if (cogReaderInstance) return cogReaderInstance;
  const url = BATNAS_COG_URL ?? GEBCO_COG_URL;
  if (!url) return null;

  if (!cogReaderPromise) {
    cogReaderPromise = (async () => {
      try {
        const tiff: GeoTIFF = await fromUrl(url);
        const image: GeoTIFFImage = await tiff.getImage();
        const tiffBbox = image.getBoundingBox(); // [minX, minY, maxX, maxY] in georef coords
        const width = image.getWidth();
        const height = image.getHeight();
        const reader: CogReader = {
          bbox: tiffBbox as [number, number, number, number],
          width,
          height,
          async readWindow(s, n, w, e) {
            // Convert lat/lng bounds to pixel window [left, top, right, bottom].
            // GEBCO/BATNAS COGs are typically georeferenced as:
            //   origin = (west, north) at pixel (0, 0)
            //   x resolution = (east - west) / width  (deg per pixel)
            //   y resolution = (north - south) / height (deg per pixel, negative)
            const [minX, minY, maxX, maxY] = tiffBbox;
            const xRes = (maxX - minX) / width;
            const yRes = (maxY - minY) / height;
            const left = Math.max(0, Math.floor((w - minX) / xRes));
            const right = Math.min(width - 1, Math.ceil((e - minX) / xRes));
            const top = Math.max(0, Math.floor((maxY - n) / yRes));
            const bottom = Math.min(height - 1, Math.ceil((maxY - s) / yRes));
            if (right <= left || bottom <= top) {
              return new Float32Array(0);
            }
            const result = await image.readRasters({
              window: [left, top, right, bottom],
              samples: [0],
              interleave: true,
              fillValue: 0,
            });
            // result is a TypedArray with shape (right-left) × (bottom-top).
            return result as unknown as Float32Array;
          },
          async samplePixel(px, py) {
            if (px < 0 || px >= width || py < 0 || py >= height) return null;
            const result = await image.readRasters({
              window: [px, py, px + 1, py + 1],
              samples: [0],
              interleave: true,
              fillValue: 0,
            });
            const arr = result as unknown as Float32Array;
            return arr.length > 0 ? arr[0] : null;
          },
        };
        cogReaderInstance = reader;
        return reader;
      } catch {
        return null;
      }
    })();
  }
  return cogReaderPromise;
}

/**
 * Look up the elevation at a single (lat, lng) via the COG reader. Uses
 * HTTP range requests under the hood; the geotiff.js library handles caching
 * of byte ranges.
 */
async function cogSample(lat: number, lng: number, signal: AbortSignal): Promise<number | null> {
  const reader = await loadCogReader();
  if (!reader) return null;
  if (signal.aborted) return null;
  const [minX, minY, maxX, maxY] = reader.bbox;
  if (lng < minX || lng > maxX || lat < minY || lat > maxY) return null;
  const xRes = (maxX - minX) / reader.width;
  const yRes = (maxY - minY) / reader.height;
  const px = Math.floor((lng - minX) / xRes);
  const py = Math.floor((maxY - lat) / yRes);
  try {
    return await reader.samplePixel(px, py);
  } catch {
    return null;
  }
}

// ============================================================================
// /api/depth proxy path (GEBCO 2020, fetched server-side)
// ============================================================================

/** Single-request queue: only one proxy request in flight at a time,
 *  with at least DEPTH_PROXY_MIN_INTERVAL_MS between requests. */
let opentopoQueue: Promise<void> = Promise.resolve();
let opentopoLastRequest = 0;

async function opentopoThrottle(): Promise<void> {
  const now = Date.now();
  const elapsed = now - opentopoLastRequest;
  if (elapsed < DEPTH_PROXY_MIN_INTERVAL_MS) {
    await new Promise<void>((r) => setTimeout(r, DEPTH_PROXY_MIN_INTERVAL_MS - elapsed));
  }
  opentopoLastRequest = Date.now();
}

async function opentopoBatchFetch(
  points: GridPoint[],
  signal: AbortSignal,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (points.length === 0) return out;

  // Chunk into groups of DEPTH_PROXY_MAX_PER_REQUEST.
  for (let i = 0; i < points.length; i += DEPTH_PROXY_MAX_PER_REQUEST) {
    if (signal.aborted) return out;
    const chunk = points.slice(i, i + DEPTH_PROXY_MAX_PER_REQUEST);
    const locations = chunk.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
    const url = `${DEPTH_PROXY_ENDPOINT}?locs=${encodeURIComponent(locations)}`;
    // Queue ensures only one request at a time, with a small gap. The queue
    // handler NEVER throws (that would poison the shared chain); failures
    // are reported via the `upstreamFailed` flag instead.
    let upstreamFailed = false;
    await new Promise<void>((resolve) => {
      opentopoQueue = opentopoQueue.then(async () => {
        try {
          await opentopoThrottle();
          if (signal.aborted) { resolve(); return; }
          const res = await fetch(url, { signal });
          if (res.status === 429) {
            // Rate limited — stop, leave the rest of the queue to cache.
            upstreamFailed = true;
            resolve();
            return;
          }
          if (!res.ok) {
            upstreamFailed = true;
            resolve();
            return;
          }
          const json = (await res.json()) as {
            ok?: boolean;
            status?: 'ok' | 'upstream-error';
            results?: Record<string, number>;
          };
          if (json.status === 'upstream-error') {
            // Proxy couldn't reach upstream (and served nothing from its
            // server-side cache) — surface as an error, not "rate limit".
            upstreamFailed = true;
            resolve();
            return;
          }
          const results = json.results ?? {};
          for (const p of chunk) {
            const k = cacheKey(p.lat, p.lng);
            const v = results[k];
            if (typeof v === 'number') {
              out.set(k, v);
            }
          }
          resolve();
        } catch (err) {
          if ((err as Error).name !== 'AbortError') {
            upstreamFailed = true;
          }
          resolve(); // always resolve — never reject into the shared queue
        }
      });
    });
    // Propagate hard failures to fetchDepths (status 'error') only when we
    // got nothing at all — partial results still populate the cache.
    if (upstreamFailed && out.size === 0) {
      throw new Error('depth proxy upstream error');
    }
  }
  return out;
}

// ============================================================================
// Public API
// ============================================================================

export type DepthStatus = 'idle' | 'loading' | 'ok' | 'rate-limited' | 'error';

export interface DepthFetchResult {
  /** Map from cacheKey → elevation (meters; negative = below sea level). */
  values: Map<string, number>;
  /** Final status — drives the UI badge. */
  status: DepthStatus;
  /** Number of points actually fetched from the network (cache misses). */
  fetchedCount: number;
  /** Number of points served from cache. */
  cachedCount: number;
}

/**
 * Look up elevations for a list of grid points. Returns as soon as all
 * in-flight requests settle (or are aborted). Cached points are returned
 * without a network round-trip.
 *
 * @param points  Grid points (lat, lng).
 * @param signal  AbortSignal — when aborted, pending requests are cancelled
 *                and partial cached results are returned.
 */
export async function fetchDepths(
  points: GridPoint[],
  signal: AbortSignal,
): Promise<DepthFetchResult> {
  const values = new Map<string, number>();
  const toFetch: GridPoint[] = [];
  let cachedCount = 0;

  // Pass 1: serve everything we already have from cache.
  for (const p of points) {
    const v = cacheGet(p.lat, p.lng);
    if (v !== undefined) {
      values.set(cacheKey(p.lat, p.lng), v);
      cachedCount++;
    } else {
      toFetch.push(p);
    }
  }

  if (toFetch.length === 0 || signal.aborted) {
    return { values, status: 'ok', fetchedCount: 0, cachedCount };
  }

  const source = getActiveDepthSource();
  let status: DepthStatus = 'ok';
  let fetchedCount = 0;

  if (isCogSource(source)) {
    // COG path: read pixels one-by-one via range requests. (Reading a
    // window in one shot would be faster, but the per-point approach
    // matches the cache shape and lets us abort cleanly.)
    for (const p of toFetch) {
      if (signal.aborted) break;
      try {
        const v = await cogSample(p.lat, p.lng, signal);
        if (v !== null && !Number.isNaN(v)) {
          values.set(cacheKey(p.lat, p.lng), v);
          cacheSet(p.lat, p.lng, v);
          fetchedCount++;
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') break;
        status = 'error';
      }
    }
  } else {
    // Open-Topo-Data path: batch with rate limit + queue.
    try {
      const batch = await opentopoBatchFetch(toFetch, signal);
      for (const [k, v] of batch) {
        values.set(k, v);
        // Reverse-lookup the (lat,lng) to push to memoryCache.
        const [latStr, lngStr] = k.split(',');
        cacheSet(parseFloat(latStr), parseFloat(lngStr), v);
        fetchedCount++;
      }
      if (batch.size < toFetch.length) {
        // Some chunks were rate-limited.
        status = fetchedCount > 0 ? 'ok' : 'rate-limited';
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // partial results are fine
      } else {
        status = 'error';
      }
    }
  }

  // Flush any pending localStorage writes on idle.
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(() => cacheFlush());
  } else {
    setTimeout(() => cacheFlush(), 0);
  }

  return { values, status, fetchedCount, cachedCount };
}

/**
 * Synchronous lookup: returns the cached elevation for a point, or null if
 * not yet fetched. Used by the canvas redraw loop so it doesn't block on
 * network — pixels appear as soon as their fetch resolves and the next
 * redraw picks them up.
 */
export function getCachedDepth(lat: number, lng: number): number | null {
  const v = cacheGet(lat, lng);
  return v === undefined ? null : v;
}

/** Test-only: clear all caches. Not used in production. */
export function _clearCachesForTests(): void {
  memoryCache.clear();
  localCache = null;
  cogReaderInstance = null;
  cogReaderPromise = null;
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LOCALSTORAGE_KEY);
    }
  } catch {
    // ignore
  }
}
