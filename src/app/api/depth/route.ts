/**
 * Server-side proxy for sea-depth (bathymetry) lookups.
 *
 * WHY THIS EXISTS
 * The GEBCO 2020 API at api.opentopodata.org does NOT send
 * `Access-Control-Allow-Origin` on its responses (verified 2026-11), so a
 * browser `fetch()` from this app always fails with "Failed to fetch" and
 * the "Angka kedalaman" layer can never load data client-side. Node-side
 * fetch has no CORS restriction, so the client calls this same-origin
 * endpoint instead; this route talks to the upstream API.
 *
 * Contract:
 *   GET /api/depth?locs=lat,lng|lat,lng|...
 *   - `locs` uses the same "lat,lng" 6-decimal format the client cache uses,
 *     so response keys can be used directly as cache keys.
 *   - max 100 locations per call (upstream limit).
 *   - Response: { ok: true, status: 'ok' | 'upstream-error', results } where
 *     results maps "lat,lng" -> elevation in meters (negative below sea
 *     level). Points the upstream couldn't resolve are simply absent.
 *
 * Caching: depth never changes — in-memory TTL cache (30 days, capped) so
 * repeated viewports cost zero upstream calls. Upstream calls are serialized
 * with >= 1.1 s spacing (upstream rate limit is 1 req/s).
 */

import { NextRequest, NextResponse } from 'next/server';

const UPSTREAM_ENDPOINT = 'https://api.opentopodata.org/v1/gebco2020';
const MAX_LOCATIONS = 100; // upstream API hard limit
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const CACHE_MAX_ENTRIES = 20_000;
const MIN_UPSTREAM_INTERVAL_MS = 1100; // >= 1 req/s per upstream docs

interface CacheEntry {
  v: number;
  t: number;
}

const cache = new Map<string, CacheEntry>();
let upstreamChain: Promise<void> = Promise.resolve();
let lastUpstreamCall = 0;

function cachePrune(): void {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  const toRemove = cache.size - CACHE_MAX_ENTRIES;
  let i = 0;
  for (const k of cache.keys()) {
    cache.delete(k);
    if (++i >= toRemove) break;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Call the upstream API (serialized + throttled). Returns elevations
 * positionally aligned with the request order; unresolvable points come
 * back as null. Throws on any upstream failure.
 */
async function fetchUpstream(locsStr: string): Promise<Array<number | null>> {
  const run = upstreamChain.then(async () => {
    const wait = MIN_UPSTREAM_INTERVAL_MS - (Date.now() - lastUpstreamCall);
    if (wait > 0) await delay(wait);
    lastUpstreamCall = Date.now();
    const res = await fetch(`${UPSTREAM_ENDPOINT}?locations=${locsStr}`, {
      headers: { 'User-Agent': 'sar-workbench/1.0 (depth proxy)' },
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const json = (await res.json()) as {
      results?: Array<{ elevation: number | null } | null>;
    };
    return (json.results ?? []).map((r) =>
      r && typeof r.elevation === 'number' ? r.elevation : null,
    );
  });
  // Keep the chain alive even when a call fails.
  upstreamChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export async function GET(req: NextRequest) {
  const locsParam = req.nextUrl.searchParams.get('locs') ?? '';
  const parts = locsParam.split('|').filter(Boolean);

  if (parts.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'Query parameter "locs" is required (lat,lng|lat,lng|...)' },
      { status: 400 },
    );
  }
  if (parts.length > MAX_LOCATIONS) {
    return NextResponse.json(
      { ok: false, error: `Too many locations (max ${MAX_LOCATIONS} per call)` },
      { status: 400 },
    );
  }

  const pts: Array<{ key: string; lat: number; lng: number }> = [];
  for (const p of parts) {
    const comma = p.indexOf(',');
    if (comma <= 0) {
      return NextResponse.json({ ok: false, error: `Bad location "${p}"` }, { status: 400 });
    }
    const lat = Number(p.slice(0, comma));
    const lng = Number(p.slice(comma + 1));
    if (
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 85 || Math.abs(lng) > 180
    ) {
      return NextResponse.json({ ok: false, error: `Bad location "${p}"` }, { status: 400 });
    }
    pts.push({ key: `${lat.toFixed(6)},${lng.toFixed(6)}`, lat, lng });
  }

  // Pass 1: serve everything from the server-side cache.
  const now = Date.now();
  const results: Record<string, number> = {};
  const missing: typeof pts = [];
  for (const p of pts) {
    const hit = cache.get(p.key);
    if (hit && now - hit.t < CACHE_TTL_MS) {
      results[p.key] = hit.v;
    } else {
      missing.push(p);
    }
  }

  let status: 'ok' | 'upstream-error' = 'ok';
  if (missing.length > 0) {
    try {
      const locsStr = missing.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|');
      const elevations = await fetchUpstream(locsStr);
      for (let i = 0; i < missing.length && i < elevations.length; i++) {
        const v = elevations[i];
        if (v === null) continue; // upstream couldn't resolve — leave absent
        cache.set(missing[i].key, { v, t: Date.now() });
        results[missing[i].key] = v;
      }
      cachePrune();
    } catch {
      status = 'upstream-error';
    }
  }

  return NextResponse.json({ ok: true, status, results });
}
