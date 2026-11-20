/**
 * SAR Asset Allocation Calculation Engine
 * (Kalkulasi Alokasi Aset & Efektivitas SRU)
 */

import { type LatLng, distanceNm } from './sarCalculations';

export type SruType =
  | 'rescue-vessel'       // Kapal SAR (misal KN SAR)
  | 'patrol-boat'         // Kapal Patroli / RB
  | 'rib'                 // Rigid Inflatable Boat (RIB)
  | 'sea-rider'           // Sea Rider
  | 'helicopter'          // Helikopter SAR
  | 'fixed-wing-aircraft';// Pesawat Patroli Maritim

export interface SruAssetInput {
  id: string;
  name: string;
  type: SruType;
  homeBaseName: string;
  homeBasePos: LatLng;
  transitSpeedKts: number;  // Kecepatan jelajah (V transit)
  searchSpeedKts: number;   // Kecepatan pencarian (V search)
  enduranceHours: number;   // Ketahanan bahan bakar (Te)
  sweepWidthNm: number;     // Track spacing S (NM) pada rencana pencarian
  assignedSubArea?: string; // Sub-area yang ditugaskan (misal 'Datum Kiri', 'Datum Kanan', 'Sub-Area 1')
  airEngineType?: 'piston' | 'turbine';
  tafCondition?: 'cerah' | 'inter' | 'tempo';
  maritimeTsfMins?: number;
}

/** Domain alut dari jenis SRU: udara (fixed-wing/helikopter), laut, atau darat
 *  (tipe alut darat mengikuti penyediaan bank aset; saat ini belum ada sehingga
 *  tab Alokasi Aset Darat menampilkan keadaan kosong yang informatif). */
export function assetDomain(type: SruType): 'udara' | 'laut' | 'darat' {
  return type === 'helicopter' || type === 'fixed-wing-aircraft' ? 'udara' : 'laut';
}

/**
 * Normalisasi kondisi TAF dari narasi soal yang dianalisa AI asisten.
 * Menerima variasi tulisan (huruf besar/kecil, istilah ICAO/Inggris) dan
 * memetakannya ke salah satu nilai worksheet: cerah (0'), inter (30'),
 * tempo (60'). Bila tidak dikenali → undefined (tidak mengarang).
 *  - cerah:  "cerah", "CLEAR", "CAVOK", "clear"
 *  - inter:  "INTER", "intermittent", "inter 30"
 *  - tempo:  "TEMPO", "temporary", "tempo 60", "shower"
 */
export function normalizeTafCondition(value?: string | null): 'cerah' | 'inter' | 'tempo' | undefined {
  if (typeof value !== 'string') return undefined;
  const raw = value.toLowerCase().trim();
  if (raw === '') return undefined;
  if (raw.includes('inter')) return 'inter';
  if (raw.includes('tempo') || raw.includes('temporary') || raw.includes('shower')) return 'tempo';
  if (raw.includes('cerah') || raw.includes('clear') || raw.includes('cavok')) return 'cerah';
  return undefined;
}

/**
 * Payload tool AI `set_asset_allocation_case` untuk SATU lembar Worksheet
 * Alokasi Aset (1 alut = 1 lembar). AI asisten mengklasifikasi alut udara/laut
 * dari `sruType` dan menentukan posisi pangkalan (bandara/dermaga/pelabuhan)
 * dari soal; bila soal tidak memberi koordinat, AI meresolusi nama
 * bandara/dermaga pada peta ONC dan mengirim homeBaseLat/homeBaseLng hasil
 * pembacaan chart (dinyatakan sebagai asumsi).
 */
export interface AssetAllocationCaseInput {
  caseTitle?: string;
  sruName: string;
  sruType: SruType;
  homeBaseName: string;
  homeBaseLat?: number;
  homeBaseLng?: number;
  transitSpeedKts?: number;
  searchSpeedKts?: number;
  enduranceHours?: number;
  sweepWidthNm?: number;
  maritimeTsfMins?: number;
  airEngineType?: 'piston' | 'turbine';
  tafCondition?: 'cerah' | 'inter' | 'tempo';
  assignedSubArea?: string;
}

export interface SruAssetCalculation {
  asset: SruAssetInput;
  transitGoDistanceNm: number;
  transitGoHours: number;
  transitBackDistanceNm: number;
  transitBackHours: number;
  totalTransitHours: number;
  totalSafetyFuelMinutes: number | null;
  variableTransitMinutes: number | null;
  reserveMinutes: number | null;
  tafMinutes: number | null;
  onSceneEnduranceMinutes: number | null;
  effectiveSearchHours: number;
  sweepAreaNm2: number;
  isValid: boolean;
  isEnduranceDeficit: boolean;
  statusMessage: string;
}

export interface AssetAllocationSummary {
  perAsset: SruAssetCalculation[];
  totalSweepAreaNm2: number;
  requiredAreaAoNm2: number;
  coverageRatio: number;     // totalAllocatedArea / requiredAreaAo
  surplusAreaNm2: number;
  isSufficient: boolean;
  deficitAreaNm2: number;
  recommendation: string;
  combinations: AllocationCombination[];
}

export interface AllocationCombination {
  assetIds: string[];
  assetNames: string[];
  totalSweepAreaNm2: number;
  coveragePercent: number;
  surplusNm2: number;
  meetsTarget: boolean;
}

/**
 * Hitung kalkulasi lengkap alokasi aset SRU per unit
 */
export function calculateSruAsset(
  input: SruAssetInput,
  csp: LatLng,
  exitPoint: LatLng
): SruAssetCalculation {
  const validTransitSpeed = input.transitSpeedKts > 0;
  const transitGoDist = distanceNm(input.homeBasePos, csp);
  const transitBackDist = distanceNm(exitPoint, input.homeBasePos);
  const transitGoHours = validTransitSpeed ? transitGoDist / input.transitSpeedKts : 0;
  const transitBackHours = validTransitSpeed ? transitBackDist / input.transitSpeedKts : 0;
  const totalTransitHours = transitGoHours + transitBackHours;
  const totalTransitMinutes = totalTransitHours * 60;

  const isAir = input.type === 'fixed-wing-aircraft' || input.type === 'helicopter';
  const engine = input.type === 'helicopter' ? 'helicopter' : input.airEngineType;
  const variableTransitMinutes = isAir && engine
    ? totalTransitMinutes * (engine === 'piston' ? 0.15 : 0.10)
    : null;
  const reserveMinutes = isAir && engine ? engine === 'piston' ? 45 : 30 : null;
  const tafMinutes = isAir && input.tafCondition
    ? input.tafCondition === 'cerah' ? 0 : input.tafCondition === 'inter' ? 30 : 60
    : null;
  const tsf = isAir
    ? variableTransitMinutes !== null && reserveMinutes !== null && tafMinutes !== null
      ? totalTransitMinutes + variableTransitMinutes + reserveMinutes + tafMinutes
      : null
    : Number.isFinite(input.maritimeTsfMins) && (input.maritimeTsfMins ?? -1) >= 0
      ? input.maritimeTsfMins!
      : null;

  const enduranceMinutes = input.enduranceHours * 60;
  const ose = tsf === null || !(input.enduranceHours > 0) ? null : enduranceMinutes - tsf;
  const isEnduranceDeficit = ose !== null && ose <= 0;
  const validInputs = validTransitSpeed
    && input.name.trim() !== '' && input.name !== '-'
    && input.homeBaseName.trim() !== '' && input.homeBaseName !== '-'
    && input.searchSpeedKts > 0 && input.sweepWidthNm > 0
    && input.enduranceHours > 0 && tsf !== null;
  const effectiveSearchHours = validInputs && ose !== null && ose > 0 ? 0.85 * ose / 60 : 0;
  const sweepAreaNm2 = effectiveSearchHours * input.searchSpeedKts * input.sweepWidthNm;
  const isValid = validInputs && ose !== null && ose > 0;
  const statusMessage = !validInputs
    ? isAir
      ? 'Lengkapi endurance, V_TAS, V_search, S, engine type, dan TAF.'
      : 'Lengkapi endurance, Speed (V), V_search, S, dan TSF maritime dari instruksi.'
    : isEnduranceDeficit
      ? `OSE tidak positif (${ose?.toFixed(2)} menit); kapasitas sapuan tidak tersedia.`
      : 'Perhitungan OSE, EST, dan Sweep Width Area valid.';

  return {
    asset: input,
    transitGoDistanceNm: transitGoDist,
    transitGoHours,
    transitBackDistanceNm: transitBackDist,
    transitBackHours,
    totalTransitHours,
    totalSafetyFuelMinutes: tsf,
    variableTransitMinutes,
    reserveMinutes,
    tafMinutes,
    onSceneEnduranceMinutes: ose,
    effectiveSearchHours,
    sweepAreaNm2,
    isValid,
    isEnduranceDeficit,
    statusMessage,
  };
}

/**
 * Hitung rekapitulasi alokasi seluruh aset terhadap kebutuhan luas area (Ao dari WS 1)
 */
export function calculateAssetAllocationSummary(
  assets: SruAssetInput[],
  csp: LatLng,
  exitPoint: LatLng,
  requiredAreaAoNm2: number
): AssetAllocationSummary {
  const perAsset = assets.map((a) => calculateSruAsset(a, csp, exitPoint));
  const totalSweepAreaNm2 = perAsset.filter((r) => r.isValid).reduce((sum, r) => sum + r.sweepAreaNm2, 0);
  const Ao = requiredAreaAoNm2;
  const coverageRatio = Ao > 0 ? totalSweepAreaNm2 / Ao : 0;
  const surplusAreaNm2 = totalSweepAreaNm2 - Ao;
  const isSufficient = Ao > 0 && surplusAreaNm2 >= 0;
  const deficitAreaNm2 = Ao > 0 ? Math.max(0, -surplusAreaNm2) : 0;

  const validAssets = perAsset.filter((r) => r.isValid);
  const combinations: AllocationCombination[] = [];
  const addCombination = (group: SruAssetCalculation[]) => {
    const total = group.reduce((sum, asset) => sum + asset.sweepAreaNm2, 0);
    combinations.push({
      assetIds: group.map((asset) => asset.asset.id),
      assetNames: group.map((asset) => asset.asset.name),
      totalSweepAreaNm2: total,
      coveragePercent: Ao > 0 ? total / Ao * 100 : 0,
      surplusNm2: total - Ao,
      meetsTarget: Ao > 0 && total >= Ao,
    });
  };
  if (validAssets.length <= 12) {
    for (let mask = 1; mask < 2 ** validAssets.length; mask += 1) {
      addCombination(validAssets.filter((_, index) => mask & (1 << index)));
    }
  } else {
    validAssets.forEach((asset) => addCombination([asset]));
    addCombination(validAssets);
  }
  combinations.sort((a, b) => a.assetIds.length - b.assetIds.length || Math.abs(a.surplusNm2) - Math.abs(b.surplusNm2));

  let recommendation = '';
  if (Ao <= 0) {
    recommendation = 'Search Area belum tersedia; kombinasi aset belum dapat dibandingkan.';
  } else if (isSufficient) {
    const best = combinations.find((combo) => combo.meetsTarget);
    recommendation = best
      ? `Kombinasi yang memenuhi dengan unit paling sedikit: ${best.assetNames.join(', ')} (${best.totalSweepAreaNm2.toFixed(2)} NM²; surplus ${best.surplusNm2.toFixed(2)} NM²). Validasi koordinasi dan keputusan operasional tetap diperlukan.`
      : `Kapasitas armada valid ${totalSweepAreaNm2.toFixed(2)} NM² (${(coverageRatio * 100).toFixed(2)}% dari target ${Ao.toFixed(2)} NM²).`;
  } else {
    recommendation = validAssets.length
      ? `Kapasitas sapuan gabungan ${totalSweepAreaNm2.toFixed(2)} NM² (${(coverageRatio * 100).toFixed(2)}%); defisit ${deficitAreaNm2.toFixed(2)} NM².`
      : 'Belum ada SRU dengan parameter OSE/EST dan kapasitas sapuan yang lengkap.';
  }

  return {
    perAsset,
    totalSweepAreaNm2,
    requiredAreaAoNm2: Ao,
    coverageRatio,
    surplusAreaNm2,
    isSufficient,
    deficitAreaNm2,
    recommendation,
    combinations,
  };
}
