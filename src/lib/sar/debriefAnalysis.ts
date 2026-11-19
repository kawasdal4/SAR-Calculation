/**
 * DE-BRIEF ANALYSIS (Fase 4 AI Copilot) — analisis hasil sortie de-briefing:
 * input hasil sortie → coverage (C) → POD tahap ini & POD kumulatif via
 * KALKULATOR RESMI existing (`computePOD` — kurva Figure I-12, polinomial
 * POD.xls, parameter searchNumber) → usulan tahap berikutnya.
 *
 * ATURAN (spesifikasi + keputusan no.6):
 * - TIDAK ADA rumus baru: coverage = luas disapu / Ao (definisi coverage
 *   yang sama dengan worksheet WS 2/WS 8 — computeW2Row/computeW8Row);
 *   luas disapu sortie = jam × kecepatan × sweep width (konvensi identik
 *   assetAllocation.ts:163 sweepAreaNm2 = hours × speed × width);
 *   POD SELALU dari computePOD(C, searchNumber) — LLM tidak menghitung.
 * - Angin/arus/POD lain TIDAK dikarang: input tidak lengkap → langkah
 *   dilewati dengan alasan, bukan diisi nilai tebakan.
 * - POC/POS TIDAK dihitung (tidak ada implementasi resmi di app untuk
 *   probability of containment) — hasil menyajikan POD & coverage; label
 *   "POS" tidak dipakai agar tidak menyesatkan.
 * - Murni + deterministik: input sama → output sama. TIDAK pernah melempar.
 */

import { computePOD, type SearchNumber } from './wscPodTables';

export interface DebriefSortieInput {
  /** Urutan pencarian sortie ini (1 = pencarian pertama). */
  searchNumber: SearchNumber;
  /** Luas area kontainmen (Ao) dari Worksheet 1 — penyebut coverage. */
  aoTotalNm2: number;
  /** Coverage kumulatif tahap-tahap SEBELUM sortie ini (opsional). */
  previousCoverageC?: number;
  /** Luas aktual disapu sortie ini (NM²) — sumber utama. */
  sweptAreaNm2?: number;
  /** Alternatif: jam pencarian efektif sortie ini. */
  hoursSearched?: number;
  /** Alternatif: kecepatan pencarian (kts). */
  searchSpeedKts?: number;
  /** Alternatif: sweep width (S, NM) dari lembar WS 2/WS 8. */
  sweepWidthNm?: number;
}

export interface DebriefSortieResult {
  ok: boolean;
  /** Pesan alasan bila langkah tidak bisa dihitung (input kurang). */
  error?: string;
  warnings: string[];
  /** Luas disapu sortie ini (NM²) — dari input langsung atau jam×kts×S. */
  sweptAreaNm2: number | null;
  /** Coverage tahap ini = sweptArea / Ao (0 bila tidak terhitung). */
  cThis: number | null;
  /** POD tahap ini (%) — computePOD(C_this, searchNumber) × 100. */
  podThisPercent: number | null;
  /** Coverage kumulatif = previous + C_this (bila previous diberikan). */
  cCumulative: number | null;
  /** POD kumulatif (%) = computePOD(C_cum, searchNumber) × 100. */
  podCumulativePercent: number | null;
  /** Ao − luas kumulatif disapu (NM²) bila Ao diketahui. */
  remainingAreaNm2: number | null;
  /** Usulan tahap berikutnya (deterministik, tanpa mengubah angka). */
  recommendation: string[];
}

/** Cari berapa kali lolos menghitung POD — hasil identik dengan kurva resmi. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Analisis sortie de-briefing. TIDAK pernah melempar. */
export function analyzeDebrief(input: DebriefSortieInput): DebriefSortieResult {
  const warnings: string[] = [];
  const recommendation: string[] = [];
  const out: DebriefSortieResult = {
    ok: false,
    warnings,
    sweptAreaNm2: null,
    cThis: null,
    podThisPercent: null,
    cCumulative: null,
    podCumulativePercent: null,
    remainingAreaNm2: null,
    recommendation,
  };

  const aoTotal = typeof input.aoTotalNm2 === 'number' && Number.isFinite(input.aoTotalNm2) ? input.aoTotalNm2 : NaN;
  if (!(aoTotal > 0)) {
    out.error = 'Luas area kontainmen (Ao dari Worksheet 1) wajib angka > 0 NM² — jalankan Worksheet 1 terlebih dahulu atau isi Ao hasil perhitungan.';
    return out;
  }

  // Luas disapu: input langsung UTAMA; alternatif jam × kecepatan × S
  // (konvensi identik Alokasi Aset: sweepAreaNm2 = hours × speed × width).
  let swept = typeof input.sweptAreaNm2 === 'number' && Number.isFinite(input.sweptAreaNm2) && input.sweptAreaNm2 > 0
    ? input.sweptAreaNm2
    : null;
  if (swept === null) {
    const hours = typeof input.hoursSearched === 'number' && Number.isFinite(input.hoursSearched) && input.hoursSearched > 0 ? input.hoursSearched : null;
    const speed = typeof input.searchSpeedKts === 'number' && Number.isFinite(input.searchSpeedKts) && input.searchSpeedKts > 0 ? input.searchSpeedKts : null;
    const width = typeof input.sweepWidthNm === 'number' && Number.isFinite(input.sweepWidthNm) && input.sweepWidthNm > 0 ? input.sweepWidthNm : null;
    if (hours !== null && speed !== null && width !== null) {
      swept = hours * speed * width;
      warnings.push(`Luas disapu dihitung dari jam × kecepatan × sweep width = ${round(swept, 2)} NM² (konvensi Alokasi Aset) — konfirmasi sama dengan track aktual di de-briefing.`);
    } else {
      out.error = 'Luas disapu sortie tidak tersedia: isi sweptAreaNm2, ATAU pasang lengkap jam pencarian + kecepatan pencarian + sweep width (S lembar WS 2/WS 8).';
      return out;
    }
  }

  const searchNumber = (Number.isInteger(input.searchNumber) && input.searchNumber >= 1 && input.searchNumber <= 5
    ? input.searchNumber : 1) as SearchNumber;
  if (input.searchNumber !== searchNumber) {
    warnings.push(`Nomor pencarian tidak wajar — dipakai ${searchNumber} (konvensi worksheet).`);
  }

  const cThis = swept / aoTotal;
  out.sweptAreaNm2 = round(swept, 2);
  out.cThis = round(cThis, 3);
  out.podThisPercent = round(computePOD(cThis, searchNumber) * 100, 1);
  out.remainingAreaNm2 = round(Math.max(0, aoTotal - swept), 2);

  if (swept > aoTotal) {
    warnings.push('Luas disapu melebihi Ao — periksa input (area luar Ao bukan bagian kontainmen datum).');
  }
  if (cThis < 0.5) {
    recommendation.push(`Coverage sortie ini hanya ${out.cThis} — POD tahap ini rendah; agar efektif, coverage per pencarian biasanya ditarget mendekati 1 (aturan Appendix L: C = Zta/Ao).`);
    recommendation.push('Lanjutkan tahap berikutnya: hitung ulang alokasi effort (Search Plan/Appendix L) dengan effort kumulatif (previousZr) agar radius pencarian membesar, bukan mengulang pola yang sama.');
  } else {
    recommendation.push(`Coverage sortie ini ${out.cThis} (POD ${out.podThisPercent}%) — bila target nihil, evaluasi area sebelum melanjutkan dengan tahap berikutnya (searchNumber ${Math.min(5, searchNumber + 1)}).`);
  }

  const prevC = typeof input.previousCoverageC === 'number' && Number.isFinite(input.previousCoverageC) && input.previousCoverageC >= 0
    ? input.previousCoverageC
    : null;
  if (prevC !== null) {
    const cCum = prevC + cThis;
    out.cCumulative = round(cCum, 3);
    out.podCumulativePercent = round(computePOD(cCum, searchNumber) * 100, 1);
    out.remainingAreaNm2 = round(Math.max(0, aoTotal - (prevC * aoTotal) - swept), 2);
    if (cCum >= 1) {
      recommendation.push(`Coverage kumulatif ${out.cCumulative} (POD kumulatif ${out.podCumulativePercent}%): area datum telah disapu penuh — pertimbangkan memperluas area (E baru/datum bergeser) alih-alih mengulang area yang sama.`);
    }
  } else {
    warnings.push('Coverage kumulatif tahap sebelumnya tidak diberikan — POD kumulatif tidak dihitung (jangan diasumsikan 0 tanpa konfirmasi).');
  }

  out.ok = true;
  return out;
}
