/**
 * Depth source abstraction.
 *
 * Dispatches depth queries to:
 *   1. BATNAS Cloud Optimized GeoTIFF (if NEXT_PUBLIC_BATNAS_COG_URL is set)
 *   2. GEBCO WMS GetFeatureInfo (fallback — always available)
 *
 * Polygon depth sampling follows the same priority order.
 */

import type { LatLng } from './sarCalculations';
import { fetchBatnasDepth, fetchBatnasPolygonDepths, isBatnasCogConfigured } from './batnasCog';
import {
  fetchDepth as fetchGebcoDepth,
  fetchPolygonDepths as fetchGebcoPolygonDepths,
  summariseDepths as summariseGebcoDepths,
  type DepthResult,
} from './depthApi';

export interface DepthSourceInfo {
  /** Which source provided the depth (BATNAS or GEBCO). */
  source: 'BATNAS' | 'GEBCO';
  /** True if BATNAS COG is configured (env var set). */
  batnasConfigured: boolean;
}

/** Fetch depth at a single point. Tries BATNAS first, falls back to GEBCO. */
export async function getDepthAt(lat: number, lng: number): Promise<DepthResult | null> {
  if (isBatnasCogConfigured()) {
    const r = await fetchBatnasDepth(lat, lng);
    if (r) {
      return {
        lat: r.lat,
        lng: r.lng,
        elevation: r.elevation,
        dataset: 'BATNAS (BIG)',
      };
    }
    // fall through to GEBCO
  }
  const r = await fetchGebcoDepth(lat, lng);
  if (r) {
    // Override dataset label to clarify which source actually provided the data
    return { ...r, dataset: 'GEBCO WMS (fallback)' };
  }
  return null;
}

/** Sample depths across a polygon. Tries BATNAS first, falls back to GEBCO. */
export async function getPolygonDepths(
  polygon: Array<{ lat: number; lng: number }>,
  maxPoints = 100,
): Promise<DepthResult[]> {
  if (isBatnasCogConfigured()) {
    const results = await fetchBatnasPolygonDepths(polygon, maxPoints);
    if (results.length > 0) {
      return results.map((r) => ({
        lat: r.lat,
        lng: r.lng,
        elevation: r.elevation,
        dataset: 'BATNAS (BIG)',
      }));
    }
    // fall through to GEBCO
  }
  return fetchGebcoPolygonDepths(polygon, maxPoints);
}

/** Compute min / max / mean elevation from a list of DepthResult. */
export function summariseDepths(results: DepthResult[]): {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
} {
  return summariseGebcoDepths(results);
}

/** Useful for UI badges/tooltips. */
export function getDepthSourceInfo(): DepthSourceInfo {
  return {
    source: isBatnasCogConfigured() ? 'BATNAS' : 'GEBCO',
    batnasConfigured: isBatnasCogConfigured(),
  };
}

// LatLng is used by callers; re-export for convenience.
export type { LatLng };
