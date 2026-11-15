/**
 * SAR Assets Allocation calculation engine.
 *
 * Implements the OSE/EST/Sweep Area worksheet from the SAR Assets Allocation
 * training material (DIKLAT SAR Tingkat Spesialis SAR Planning, Angkatan XL).
 *
 * Formulas:
 *   Air Asset:
 *     Transit Go = S_go / V_TAS × 60 (minutes)
 *     Transit Back = S_back / V_TAS × 60 (minutes)
 *     Total Transit = Tr_Go + Tr_Back
 *     Variable Transit = 15% (Piston) or 10% (Turbine) × Total Transit
 *     Reserve = 45' (Piston), 30' (Turbine), 30' (Helicopter)
 *     TAF = 0' (Cerah), 30' (INTER), 60' (TEMPO)
 *     TSF = Total Transit + Variable Transit + Reserve + TAF
 *     OSE = Endurance - TSF (minutes)
 *     EST = 85% × OSE (hours)
 *     Sweep Area = EST × V_search × Track Spacing (NM²)
 *
 *   Maritime Asset:
 *     Transit Go = S_go / V × 60 (minutes)
 *     Transit Back = S_back / V × 60 (minutes)
 *     TSF = Transit Go + Transit Back (no variable/reserve/TAF)
 *     OSE = Endurance - TSF (minutes)
 *     EST = 85% × OSE (hours)
 *     Sweep Area = EST × V_search × Track Spacing (NM²)
 */

export type EngineType = 'piston' | 'turbine';
export type AssetType = 'air' | 'maritime';
export type TafType = 'cerah' | 'inter' | 'tempo';

export interface SruInput {
  id: string;
  name: string;
  callSign: string;
  assetType: AssetType;
  engineType: EngineType;
  enduranceMin: number;        // Endurance (E) in minutes
  speedTas: number;             // True Air Speed / vessel speed (kts)
  searchSpeed: number;          // Search speed (kts)
  transitGoNm: number;          // Distance to scene (NM)
  transitBackNm: number;        // Distance from scene (NM)
  trackSpacing: number;         // Track spacing (NM)
  tafType: TafType;             // Weather condition for TAF
}

export interface SruCalculation {
  input: SruInput;
  // Part A: TSF
  transitGoMin: number;
  transitBackMin: number;
  totalTransitMin: number;
  variableTransitMin: number;
  reserveMin: number;
  tafMin: number;
  tsfMin: number;
  // Part B: OSE
  oseMin: number;
  oseHrs: number;
  // Part C: EST
  estHrs: number;
  // Part D: Sweep Area
  sweepAreaNm2: number;
}

export interface CombinationResult {
  srus: SruCalculation[];
  totalSweepArea: number;
  targetArea: number;
  surplus: number;
  coveragePct: number;
  isSufficient: boolean;
  labels: string[];
}

/** Variable transit percentages by engine type. */
const VARIABLE_PERCENT: Record<EngineType, number> = {
  piston: 0.15,
  turbine: 0.10,
};

/** Fuel reserve in minutes by engine type. */
const RESERVE_MIN: Record<EngineType, number> = {
  piston: 45,
  turbine: 30, // Turbine & Helicopter both use 30'
};

/** TAF time in minutes by weather type. */
const TAF_MIN: Record<TafType, number> = {
  cerah: 0,
  inter: 30,
  tempo: 60,
};

/**
 * Calculate OSE, EST, and sweep area for a single SRU.
 */
export function calculateSru(sru: SruInput): SruCalculation {
  const { assetType, engineType, enduranceMin, speedTas, searchSpeed, transitGoNm, transitBackNm, trackSpacing, tafType } = sru;

  // Part A: Total Safety Fuel (TSF)
  const transitGoMin = speedTas > 0 ? (transitGoNm / speedTas) * 60 : 0;
  const transitBackMin = speedTas > 0 ? (transitBackNm / speedTas) * 60 : 0;
  const totalTransitMin = transitGoMin + transitBackMin;

  let variableTransitMin = 0;
  let reserveMin = 0;
  let tafMin = 0;

  if (assetType === 'air') {
    // Air assets have variable transit, reserve, and TAF
    variableTransitMin = totalTransitMin * VARIABLE_PERCENT[engineType];
    reserveMin = RESERVE_MIN[engineType];
    tafMin = TAF_MIN[tafType];
  }
  // Maritime assets: TSF = Total Transit only (no variable/reserve/TAF)

  const tsfMin = totalTransitMin + variableTransitMin + reserveMin + tafMin;

  // Part B: On-Scene Endurance (OSE)
  const oseMin = Math.max(0, enduranceMin - tsfMin);
  const oseHrs = oseMin / 60;

  // Part C: Effective Search Time (EST)
  const estHrs = 0.85 * oseHrs;

  // Part D: Sweep Width Area (A) = EST × V_search × S
  const sweepAreaNm2 = estHrs * searchSpeed * trackSpacing;

  return {
    input: sru,
    transitGoMin,
    transitBackMin,
    totalTransitMin,
    variableTransitMin,
    reserveMin,
    tafMin,
    tsfMin,
    oseMin,
    oseHrs,
    estHrs,
    sweepAreaNm2,
  };
}

/**
 * Calculate all SRUs and return results.
 */
export function calculateAllSrus(srus: SruInput[]): SruCalculation[] {
  return srus.map(calculateSru);
}

/**
 * Find all combinations of size k from an array.
 */
function combinations<T>(arr: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [head, ...tail] = arr;
  const withHead = combinations(tail, k - 1).map((c) => [head, ...c]);
  const withoutHead = combinations(tail, k);
  return [...withHead, ...withoutHead];
}

/**
 * Find the most efficient combination of SRUs that meets the target area.
 * "Efficient" = smallest surplus (capacity closest to target without going under).
 *
 * @param calculations Per-SRU calculation results
 * @param targetArea Required search area (NM²)
 * @param minSize Minimum number of SRUs to consider (default 1)
 * @param maxSize Maximum number of SRUs to consider (default = all)
 * @returns All sufficient combinations sorted by surplus (ascending)
 */
export function findOptimalCombinations(
  calculations: SruCalculation[],
  targetArea: number,
  minSize = 1,
  maxSize?: number,
): CombinationResult[] {
  const max = maxSize ?? calculations.length;
  const results: CombinationResult[] = [];

  for (let k = minSize; k <= max; k++) {
    const combos = combinations(calculations, k);
    for (const combo of combos) {
      const totalSweepArea = combo.reduce((sum, c) => sum + c.sweepAreaNm2, 0);
      const surplus = totalSweepArea - targetArea;
      const coveragePct = targetArea > 0 ? (totalSweepArea / targetArea) * 100 : 0;
      const isSufficient = totalSweepArea >= targetArea;

      results.push({
        srus: combo,
        totalSweepArea,
        targetArea,
        surplus,
        coveragePct,
        isSufficient,
        labels: combo.map((c) => c.input.name || c.input.callSign || c.input.id),
      });
    }
  }

  // Sort: sufficient combinations first (by smallest surplus), then insufficient (by largest coverage)
  results.sort((a, b) => {
    if (a.isSufficient && !b.isSufficient) return -1;
    if (!a.isSufficient && b.isSufficient) return 1;
    if (a.isSufficient && b.isSufficient) return a.surplus - b.surplus; // smallest surplus first
    return b.coveragePct - a.coveragePct; // insufficient: closest to target first
  });

  return results;
}

/**
 * Get the recommended combination (most efficient sufficient combo).
 */
export function getRecommendation(
  calculations: SruCalculation[],
  targetArea: number,
): CombinationResult | null {
  const all = findOptimalCombinations(calculations, targetArea);
  const sufficient = all.filter((c) => c.isSufficient);
  return sufficient.length > 0 ? sufficient[0] : null;
}

/**
 * Calculate total sweep area for a set of SRUs.
 */
export function totalSweepArea(calcs: SruCalculation[]): number {
  return calcs.reduce((sum, c) => sum + c.sweepAreaNm2, 0);
}

/**
 * Calculate number of search legs for a given SRU in a search area.
 * For Creeping Line: legs = sweepArea / (searchAreaLength / N) → simplified as:
 *   Legs = floor(sweepArea / (legLength × trackSpacing))
 * For Parallel Sweep: legs = floor(sweepArea / (legWidth × trackSpacing))
 *
 * Simplified: Legs = floor(sweepArea / (areaDimension × trackSpacing))
 */
export function calculateLegs(
  sweepAreaNm2: number,
  areaDimensionNm: number,
  trackSpacing: number,
): number {
  if (areaDimensionNm <= 0 || trackSpacing <= 0) return 0;
  return Math.floor(sweepAreaNm2 / (areaDimensionNm * trackSpacing));
}
