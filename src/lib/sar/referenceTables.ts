/**
 * REFERENCE TABLES REGISTRY (Fase 1 AI Copilot) — status verifikasi tabel
 * referensi SAR terhadap sumber resminya (keputusan implementasi no. 6).
 *
 * ATURAN MUTLAK:
 * - Nilai VERIFIED boleh dipakai untuk hasil final.
 * - UNVERIFIED/MISSING TIDAK boleh diperlakukan sebagai nilai resmi dan tidak
 *   boleh dipakai menyatakan hasil perhitungan final — AI wajib meminta
 *   sumber/konfirmasi ke pengguna bila membutuhkannya.
 * - Data pengembangan berlabel SIMULATION dan tidak boleh tercampur data resmi.
 *
 * Registry ini ADDITIVE: tidak mengubah tabel/nilai apa pun yang sudah dipakai
 * worksheet. Provenance tiap tabel merujuk file sumber di repo.
 */

export type TableVerificationStatus = 'VERIFIED' | 'UNVERIFIED' | 'MISSING' | 'SIMULATION';

export interface ReferenceTableInfo {
  /** Id singkat (mis. 'I-5/I-6'). */
  id: string;
  /** Nama manusiawi. */
  label: string;
  /** Sumber resmi / provenance digitisasi + lokasi kode sumber. */
  source: string;
  status: TableVerificationStatus;
  note?: string;
}

export const REFERENCE_TABLES: ReferenceTableInfo[] = [
  {
    id: 'I-1/I-2',
    label: 'Leeway object types (51 objek)',
    source: 'AUS SAR Appendix I — digitisasi src/lib/sar/sarCalculations.ts (LEEWAY_OBJECT_TYPES); test leewayTableI1.test.ts',
    status: 'VERIFIED',
  },
  {
    id: 'I-3/I-4',
    label: 'Uncorrected sweep width — kapal (eye height 8/14 ft, MERSHIP)',
    source: 'AUS SAR Appendix I — src/lib/sar/wscPodTables.ts (W8_I3/W8_I4)',
    status: 'VERIFIED',
  },
  {
    id: 'I-5/I-6',
    label: 'Uncorrected sweep width — fixed-wing & helicopter (500–2000 ft)',
    source: 'AUS SAR Appendix I — src/lib/sar/wscPodTables.ts (FIXED/HELI)',
    status: 'VERIFIED',
  },
  {
    id: 'I-7',
    label: 'Weather correction fw (angin / gelombang)',
    source: 'AUS SAR Appendix I hal. I-16 — src/lib/sar/wscPodTables.ts (fwRowFromWind/fwRowFromWave/lookupFwByRow)',
    status: 'VERIFIED',
  },
  {
    id: 'I-8',
    label: 'Speed correction fs (TAS)',
    source: 'AUS SAR Appendix I — src/lib/sar/wscPodTables.ts (TABLE_I8_ROWS/lookupFs)',
    status: 'VERIFIED',
  },
  {
    id: 'I-9/I-10',
    label: 'Sweep width & vegetasi pencarian darat',
    source: 'AUS SAR Appendix I — src/lib/sar/landSearchTables.ts (TABLE_I9/TABLE_I10)',
    status: 'VERIFIED',
  },
  {
    id: 'J-1/J-2/J-3',
    label: 'Nav fix error (x/y, %DR)',
    source: 'AUS SAR Appendix J — src/lib/sar/sarCalculations.ts (TABLE_J1_NAV_ERRORS/J2/J3)',
    status: 'VERIFIED',
  },
  {
    id: 'FIG-I-12',
    label: 'POD vs coverage (kurva pencarian 1–5)',
    source: 'Fit polinomial derajat-6 dari POD.xls milik pemilik — src/lib/sar/wscPodTables.ts (POD_POLY_COEFFS); test podExcelPolynomial.test.ts',
    status: 'VERIFIED',
  },
  {
    id: 'N-13',
    label: 'Rate of descent parasut',
    source: 'IAMSAR Vol II N-20 — src/lib/sar/tableN13.mjs (N13_PARACHUTES); test tableN13.test.mjs',
    status: 'VERIFIED',
  },
  {
    id: 'N-14',
    label: 'Drift distance parasut',
    source: 'IAMSAR Vol II — src/lib/sar/tableN13.mjs (N14_DRIFT_DISTANCE_MILES)',
    status: 'VERIFIED',
  },
  {
    id: 'FS-TABLE',
    label: 'Safety factor fs pencarian 1–5 (1.1/1.6/2.0/2.3/2.5; darat 1.1/1.8/2.0/2.3/2.6)',
    source: 'National SAR Manual Tabel 4.2 / Panduan WS1 — src/lib/sar/datumWs1.ts (WS1_FS_TABLE)',
    status: 'VERIFIED',
  },
  {
    id: 'FIG-I-1',
    label: 'Wind current (arus angin) — grafik',
    source: 'Didekati konstanta 0.036 × angin (WS1_WC_COEF) dengan anotasi "needs confirmation" di datumWs1.ts',
    status: 'UNVERIFIED',
    note: 'Koefisien 0.036 adalah pendekatan garis lurus Fig. I-1; hasil drift arus angin tidak final sebelum dikonfirmasi.',
  },
  {
    id: 'N-4..N-8',
    label: 'Uncorrected sweep width (IAMSAR Appendix N)',
    source: 'Tidak terdigitisasi — SearchPlanWorksheet memakai matrix ad-hoc 5×8 (sarCalculations.ts UNCORRECTED_SWEEP_WIDTHS) tanpa provenance appendix',
    status: 'MISSING',
    note: 'Matrix ad-hoc hanya untuk worksheet Panduan Pencarian; jangan dipakai sebagai nilai resmi di luar itu.',
  },
  {
    id: 'N-10',
    label: 'POD kurva fixed pattern',
    source: 'Tidak tersedia — Worksheet5 (orphan) memakai rumus random search POD=1−e^(−C)',
    status: 'MISSING',
  },
  {
    id: 'FATIGUE',
    label: 'Faktor fatigue observer',
    source: 'Konstanta 0.9 (fatigue) / 1.0 di computeW2Row/computeW8Row/Worksheet3 — tanpa tabel sumber',
    status: 'UNVERIFIED',
    note: 'Nilai konstanta dipakai worksheet existing; belum ada tabel resmi di repo.',
  },
];

/** Ambil status verifikasi tabel by id (mis. 'I-7', 'FIG-I-1'). */
export function getReferenceTableStatus(id: string): TableVerificationStatus {
  const table = REFERENCE_TABLES.find((entry) => entry.id === id);
  return table?.status ?? 'MISSING';
}

/** Info lengkap tabel by id. */
export function getReferenceTableInfo(id: string): ReferenceTableInfo | undefined {
  return REFERENCE_TABLES.find((entry) => entry.id === id);
}

/** Daftar ringkas untuk tool `lookup_table` (Fase 2) — status + sumber saja. */
export function summarizeReferenceTables(): Array<{ id: string; label: string; status: TableVerificationStatus }> {
  return REFERENCE_TABLES.map(({ id, label, status }) => ({ id, label, status }));
}
