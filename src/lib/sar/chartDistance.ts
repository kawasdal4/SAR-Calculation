/**
 * PENGUKURAN JARAK DI PETA — PETA LAUT & PETA UDARA (permintaan pengguna, PHASE 4)
 * ================================================================================
 * Ketentuan web app ini: 1 menit busur pada skala peta = 1 nautical mile (NM).
 *
 * Dasar ilmiah (pengetahuan navigasi standar, bukan formula baru):
 * - 1 NM = 1852 m (definisi internasional 1929) ≈ 1 menit busur LINTANG.
 * - Peta laut Mercator: skala LINTANG dipakai untuk mengukur jarak (baca menit
 *   pada skala lintang di latitude tengah segmen); skala BUJUR mengecil ke kutub:
 *   1' bujur = cos(lat) NM.
 * - Peta udara ONC (1:1.000.000, Lambert Conformal Conic): graticule 1° = 60'
 *   ≈ 60 NM, sehingga aturan 1' = 1 NM tetap berlaku pada graticule; skala nominal
 *   1:1.000.000 → 1 cm peta = 10 km ≈ 5,40 NM.
 */

import { distanceNm, type LatLng } from './sarCalculations';

export const NM_PER_MINUTE = 1;          // 1 menit = 1 NM (ketentuan aplikasi)
export const METERS_PER_NM = 1852;       // definisi NM internasional
export const KM_PER_NM = 1.852;
export const ONC_SCALE = 1_000_000;      // skala nominal ONC

/** Menit skala lintang → NM (1' = 1 NM). */
export function minutesToNm(minutes: number): number {
  return minutes * NM_PER_MINUTE;
}

/** NM → meter (1852 m per NM). */
export function nmToMeters(nm: number): number {
  return nm * METERS_PER_NM;
}

/** Menit skala lintang → meter. */
export function minutesToMeters(minutes: number): number {
  return nmToMeters(minutesToNm(minutes));
}

/** Menit skala BUJUR pada latitude tertentu → NM (1' bujur = cos(lat) NM). */
export function lonMinutesToNm(lonMinutes: number, latDeg: number): number {
  return lonMinutes * Math.cos((latDeg * Math.PI) / 180);
}

/** Skala nominal peta (1:N) → berapa NM per cm peta. */
export function cmToNmAtScale(scaleDenominator: number): number {
  // 1 cm peta = scaleDenominator cm dunia = scaleDenominator/100 m = /1852 NM
  return scaleDenominator / 100 / METERS_PER_NM;
}

export type ChartKind = 'sea' | 'air';

export interface ChartDistanceResult {
  method: 'lat-minutes' | 'points';
  chartKind: ChartKind;            // jenis peta yang diukur (hanya melabeli metode)
  deltaLatMinutes: number;         // komponen utara-selatan (menit lintang)
  deltaLonMinutes: number;
  midLatDeg: number;
  lonMinuteNm: number;             // nilai 1' bujur pada midLat (cos)
  distanceNm: number;              // hasil ukur menurut metode
  distanceKm: number;
  distanceM: number;
  greatCircleNm: number | null;    // jarak sebenarnya (haversine) bila dua titik diberikan
}

/**
 * Mode 1 — pengguna membaca span pengukuran pada SKALA LINTANG peta (menit).
 * Jarak = jumlah menit × 1 NM (ketentuan aplikasi).
 */
export function chartDistanceFromMinutes(
  deltaLatMinutes: number,
  chartKind: ChartKind = 'sea',
): ChartDistanceResult {
  const distanceNm = Math.abs(minutesToNm(deltaLatMinutes));
  return {
    method: 'lat-minutes',
    chartKind,
    deltaLatMinutes,
    deltaLonMinutes: 0,
    midLatDeg: 0,
    lonMinuteNm: 0,
    distanceNm,
    distanceKm: distanceNm * KM_PER_NM,
    distanceM: nmToMeters(distanceNm),
    greatCircleNm: null,
  };
}

/**
 * Mode 2 — dua koordinat WGS84 di peta. Memberi:
 * - Δlat/Δlon dalam menit (untuk membaca graticule),
 * - faktor skala bujur 1' = cos(midLat) NM,
 * - jarak sebenarnya (haversine, lib existing) = hasil ukur jangka di skala
 *   lintang pada latitude tengah segmen.
 */
export function chartDistanceFromPoints(p1: LatLng, p2: LatLng, chartKind: ChartKind = 'sea'): ChartDistanceResult {
  const gcNm = distanceNm(p1, p2);
  const dLatMin = Math.abs(p2.lat - p1.lat) * 60;
  const dLonMin = Math.abs(p2.lng - p1.lng) * 60;
  const midLat = (p1.lat + p2.lat) / 2;
  const lonMinuteNm = Math.cos((midLat * Math.PI) / 180);
  return {
    method: 'points',
    chartKind,
    deltaLatMinutes: dLatMin,
    deltaLonMinutes: dLonMin,
    midLatDeg: midLat,
    lonMinuteNm,
    distanceNm: gcNm,
    distanceKm: gcNm * KM_PER_NM,
    distanceM: nmToMeters(gcNm),
    greatCircleNm: gcNm,
  };
}

// ============================================================================
// PENGETAHUAN — cara mengukur jarak (teks panduan, tampil juga di UI)
// ============================================================================

export interface GuideStep {
  title: string;
  steps: string[];
  notes: string[];
}

/** Aturan dasar yang berlaku untuk kedua jenis peta. */
export const CHART_DISTANCE_RULE =
  '1 menit pada skala peta = 1 nautical mile (1 NM = 1852 m). Pada graticule: 1° = 60 menit = 60 NM.';

export const CHART_MEASURE_GUIDE: Record<'sea' | 'air', GuideStep> = {
  sea: {
    title: 'Peta Laut (Mercator)',
    steps: [
      'Buka jangka pengukur (dividers) pada dua titik yang ingin diukur di peta laut.',
      'Pindahkan jangka ke SKALA LINTANG (garis bujur/lintang di tepi peta) pada latitude tengah segmen — bukan ke skala bujur.',
      'Baca span dalam menit: jumlah menit lintang = jarak dalam NM (1 menit = 1 NM).',
      'Untuk segmen utara–selatan, jarak langsung = selisih lintang dalam menit.',
      'Untuk arah timur–barat, jangan membaca menit bujur sebagai NM: 1\' bujur = cos(lat) NM (semakin ke kutub makin kecil).',
    ],
    notes: [
      'Gunakan skala lintang dekat latitude segmen agar distorsi Mercator minimal.',
      'Jarak > skala peta: bagi span (mis. 5 menit per bukaan) lalu kalikan jumlah bukaan.',
    ],
  },
  air: {
    title: 'Peta Udara (ONC 1:1.000.000)',
    steps: [
      'Gunakan graticule ONC (garis mayor 1°, minor 30\'/tick 1\' — sudah dirender di tab Worksheet 4).',
      'Ukur span dua titik dengan jangka/ruler, pindahkan ke sisi graticule lintang.',
      'Baca menit: 1 menit = 1 NM; 1° = 60 NM.',
      'Alternatif ruler/skala nominal: 1:1.000.000 → 1 cm peta = 10 km ≈ 5,40 NM (1 inci ≈ 13,71 NM).',
      'Arah timur–barat: 1\' bujur = cos(lat) NM — sama seperti peta laut.',
    ],
    notes: [
      'Skala Lambert Conformal Conic sedikit bervariasi per latitude; pada wilayah kerja (±15°) deviasi < 0,5%.',
      'MEF/ketinggian bukan bagian pengukuran jarak — lihat capability map-onc-mef.',
    ],
  },
};

/** Palet langkah gabungan untuk AI (headless retrieval). */
export function chartMeasureGuide(chart: 'sea' | 'air' | 'both' = 'both'): {
  rule: string;
  sections: GuideStep[];
  conversionTable: Array<{ unit: string; valueNm: number }>;
} {
  const sections =
    chart === 'both' ? [CHART_MEASURE_GUIDE.sea, CHART_MEASURE_GUIDE.air] : [CHART_MEASURE_GUIDE[chart]];
  return {
    rule: CHART_DISTANCE_RULE,
    sections,
    conversionTable: [
      { unit: "1 menit skala lintang", valueNm: 1 },
      { unit: "1° skala lintang", valueNm: 60 },
      { unit: "1 NM", valueNm: 1 },
      { unit: '1 cm peta (ONC 1:1.000.000)', valueNm: Number(cmToNmAtScale(ONC_SCALE).toFixed(2)) },
    ],
  };
}
