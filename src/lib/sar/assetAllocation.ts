/**
 * IAMSAR Volume II Chapter 4 & 5 - SAR Asset Allocation Calculation Engine
 * (Kalkulasi Alokasi Aset & Efektivitas SRU)
 */

import { type LatLng, distanceNm } from './sarCalculations';

export type SruType =
  | 'rescue-vessel'       // Kapal SAR (misal KN SAR)
  | 'patrol-boat'         // Kapal Patroli / RB
  | 'rib'                 // Rigid Inflatable Boat (RIB)
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
  daylightHours: number;    // Batas waktu operasi siang / sortie limit
  fuelReservePct: number;   // Cadangan bahan bakar cadangan (default 15%)
  sweepWidthNm: number;     // Lebar sapuan sensor / visual (W)
  targetCoverage: number;   // Target faktor cakupan C (default 1.0)
  assignedSubArea?: string; // Sub-area yang ditugaskan (misal 'Datum Kiri', 'Datum Kanan', 'Sub-Area 1')
}

export interface SruAssetCalculation {
  asset: SruAssetInput;
  transitGoDistanceNm: number;
  transitGoHours: number;
  transitBackDistanceNm: number;
  transitBackHours: number;
  totalTransitHours: number;
  fuelReserveHours: number;
  onSceneSearchHours: number; // Tos
  searchTrackLengthNm: number; // Ltrack
  searchEffortZiNm2: number;  // Zi = Vsearch * Tos * W
  recommendedTrackSpacingNm: number; // S = W / C
  allocatedAreaNm2: number;   // Ai = Zi / C
  pod: number;                // POD = 1 - exp(-C)
  isEnduranceDeficit: boolean;
  statusMessage: string;
}

export interface AssetAllocationSummary {
  perAsset: SruAssetCalculation[];
  totalZtaNm2: number;
  totalAllocatedAreaNm2: number;
  requiredAreaAoNm2: number;
  coverageRatio: number;     // totalAllocatedArea / requiredAreaAo
  compositeCoverageC: number;// totalZta / requiredAreaAo
  compositePOD: number;      // 1 - exp(-compositeCoverageC)
  isSufficient: boolean;
  deficitAreaNm2: number;
  recommendation: string;
}

/**
 * Hitung kalkulasi lengkap alokasi aset SRU per unit
 */
export function calculateSruAsset(
  input: SruAssetInput,
  csp: LatLng,
  exitPoint: LatLng
): SruAssetCalculation {
  const vTransit = Math.max(1, input.transitSpeedKts);
  const vSearch = Math.max(1, input.searchSpeedKts);
  const Te = Math.max(0.5, input.enduranceHours);
  const daylight = Math.max(0.5, input.daylightHours);
  const reserveFrac = Math.max(0, Math.min(0.5, input.fuelReservePct / 100));
  const W = Math.max(0.1, input.sweepWidthNm);
  const C = Math.max(0.1, input.targetCoverage);

  // 1. Transit Go: Home Base -> CSP
  const transitGoDist = distanceNm(input.homeBasePos, csp);
  const transitGoHours = transitGoDist / vTransit;

  // 2. Transit Back: Exit Point -> Home Base
  const transitBackDist = distanceNm(exitPoint, input.homeBasePos);
  const transitBackHours = transitBackDist / vTransit;

  const totalTransitHours = transitGoHours + transitBackHours;
  const fuelReserveHours = Te * reserveFrac;

  // 3. Waktu Pencarian di Lokasi (On-Scene Time Tos)
  // Tos = Te - fuelReserve - totalTransit
  const rawOnScene = Te - fuelReserveHours - totalTransitHours;
  const isEnduranceDeficit = rawOnScene <= 0;
  const onSceneSearchHours = Math.max(0, Math.min(rawOnScene, daylight));

  // 4. Panjang Lintasan & Kapabilitas Upaya Pencarian (Zi)
  const searchTrackLengthNm = vSearch * onSceneSearchHours;
  const searchEffortZiNm2 = vSearch * onSceneSearchHours * W;

  // 5. Track Spacing & Luas Area yang Mampu Dicari
  const recommendedTrackSpacingNm = W / C;
  const allocatedAreaNm2 = searchEffortZiNm2 / C;

  // 6. POD
  const pod = 1 - Math.exp(-C);

  let statusMessage = 'Siap Operasi';
  if (isEnduranceDeficit) {
    statusMessage = `Bahan bakar tidak cukup untuk pulang-pergi (Butuh transit ${(totalTransitHours + fuelReserveHours).toFixed(1)}j, kapasitas Te ${Te}j)`;
  } else if (onSceneSearchHours < 1.0) {
    statusMessage = `Waktu di lokasi sangat singkat (${(onSceneSearchHours * 60).toFixed(0)} menit)`;
  }

  return {
    asset: input,
    transitGoDistanceNm: transitGoDist,
    transitGoHours,
    transitBackDistanceNm: transitBackDist,
    transitBackHours,
    totalTransitHours,
    fuelReserveHours,
    onSceneSearchHours,
    searchTrackLengthNm,
    searchEffortZiNm2,
    recommendedTrackSpacingNm,
    allocatedAreaNm2,
    pod,
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
  const totalZtaNm2 = perAsset.reduce((sum, r) => sum + r.searchEffortZiNm2, 0);
  const totalAllocatedAreaNm2 = perAsset.reduce((sum, r) => sum + r.allocatedAreaNm2, 0);
  const Ao = Math.max(1, requiredAreaAoNm2);

  const coverageRatio = totalAllocatedAreaNm2 / Ao;
  const compositeCoverageC = totalZtaNm2 / Ao;
  const compositePOD = 1 - Math.exp(-compositeCoverageC);
  const isSufficient = totalAllocatedAreaNm2 >= Ao * 0.95;
  const deficitAreaNm2 = Math.max(0, Ao - totalAllocatedAreaNm2);

  let recommendation = '';
  if (isSufficient) {
    recommendation = `Kapasitas aset SAR memadai (${(coverageRatio * 100).toFixed(0)}% dari luas sasaran ${Ao.toFixed(0)} NM² terpenuhi). Rencana pencarian dapat dilaksanakan sesuai jadwal.`;
  } else {
    const deficitPct = ((deficitAreaNm2 / Ao) * 100).toFixed(0);
    recommendation = `Defisit Alokasi Aset: Hanya mampu mencakup ${(coverageRatio * 100).toFixed(0)}% dari area target. Kurang ${deficitAreaNm2.toFixed(0)} NM² (${deficitPct}%). Disarankan: (1) Menambah unit SRU bantuan, (2) Memperlebar Track Spacing S, atau (3) Memprioritaskan pencarian pada Sub-Area POD tertinggi terlebih dahulu.`;
  }

  return {
    perAsset,
    totalZtaNm2,
    totalAllocatedAreaNm2,
    requiredAreaAoNm2: Ao,
    coverageRatio,
    compositeCoverageC,
    compositePOD,
    isSufficient,
    deficitAreaNm2,
    recommendation,
  };
}
