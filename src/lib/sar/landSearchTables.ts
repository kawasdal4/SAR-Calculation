export type LandSearchTarget = 'person' | 'vehicle' | 'aircraft-under-5700' | 'aircraft-over-5700';
export type LandSearchPlatform = 'fixed-wing' | 'helicopter';
export type LandVegetation = 'under-15' | '15-60' | '60-85' | 'over-85';
export type LandSearchHeight = 500 | 1000 | 1500 | 2000;

export const LAND_SEARCH_TARGETS: Array<{ id: LandSearchTarget; label: string }> = [
  { id: 'person', label: 'Person' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'aircraft-under-5700', label: 'Aircraft < 5700 kg' },
  { id: 'aircraft-over-5700', label: 'Aircraft > 5700 kg' },
];

export const LAND_SEARCH_HEIGHTS: LandSearchHeight[] = [500, 1000, 1500, 2000];
export const LAND_SEARCH_VISIBILITIES = [5, 10, 20, 30, 40] as const;

type WuByHeight = Record<LandSearchHeight, readonly [number | null, number | null, number | null, number | null, number | null]>;
type WuTable = Record<LandSearchTarget, WuByHeight>;

// Appendix I, Table I-9. Columns are visibility 5, 10, 20, 30, and 40 km.
const TABLE_I9: WuTable = {
  person: {
    500: [0.4, 0.4, 0.5, 0.5, 0.5], 1000: [0.4, 0.4, 0.5, 0.5, 0.5],
    1500: [null, null, null, null, null], 2000: [null, null, null, null, null],
  },
  vehicle: {
    500: [0.9, 1.3, 1.3, 1.3, 1.3], 1000: [1.0, 1.4, 1.4, 1.5, 1.5],
    1500: [1.0, 1.4, 1.7, 1.7, 1.7], 2000: [1.0, 1.5, 2.0, 2.0, 2.0],
  },
  'aircraft-under-5700': {
    500: [1.0, 1.4, 1.4, 1.4, 1.4], 1000: [1.0, 1.5, 1.5, 1.6, 1.6],
    1500: [1.0, 1.5, 1.8, 1.8, 1.8], 2000: [1.0, 1.6, 2.0, 2.0, 2.0],
  },
  'aircraft-over-5700': {
    500: [1.2, 2.0, 2.2, 2.2, 2.2], 1000: [1.8, 2.7, 3.0, 3.0, 3.0],
    1500: [2.0, 2.8, 3.2, 3.2, 3.2], 2000: [2.2, 2.9, 3.5, 3.5, 3.5],
  },
};

// Appendix I, Table I-10. A null value means the required lookup is incomplete.
const TABLE_I10: Record<LandSearchTarget, Record<LandVegetation, number>> = {
  person: { 'under-15': 0.8, '15-60': 0.5, '60-85': 0.3, 'over-85': 0.1 },
  vehicle: { 'under-15': 1.0, '15-60': 0.7, '60-85': 0.4, 'over-85': 0.1 },
  'aircraft-under-5700': { 'under-15': 1.0, '15-60': 0.7, '60-85': 0.4, 'over-85': 0.1 },
  'aircraft-over-5700': { 'under-15': 1.0, '15-60': 0.8, '60-85': 0.4, 'over-85': 0.1 },
};

export function lookupLandWu(target: LandSearchTarget | null, height: LandSearchHeight, visibilityKm: number): number | null {
  if (!target) return null;
  const visibilityIndex = LAND_SEARCH_VISIBILITIES.indexOf(visibilityKm as (typeof LAND_SEARCH_VISIBILITIES)[number]);
  return visibilityIndex < 0 ? null : TABLE_I9[target][height][visibilityIndex];
}

export function lookupLandFv(target: LandSearchTarget | null, vegetation: LandVegetation | null): number | null {
  return target && vegetation ? TABLE_I10[target][vegetation] : null;
}

export function nearestLandTrackSpacing(widthNm: number, platform: LandSearchPlatform): number {
  const interval = platform === 'fixed-wing' ? 0.5 : 0.25;
  if (!Number.isFinite(widthNm) || widthNm <= 0) return 0;
  return Math.max(interval, Math.round(widthNm / interval) * interval);
}
