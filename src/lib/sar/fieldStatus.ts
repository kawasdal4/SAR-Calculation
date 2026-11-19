/**
 * FIELD STATUS CLASSIFICATION (Fase B) — klasifikasi status SETIAP field kasus
 * dengan metadata lengkap. Mengganti pola lama "belum ada angka = HILANG".
 *
 * ATURAN MUTLAK (spesifikasi Fase B):
 * - Data yang tertulis dalam PDF = EXTRACTED (raw value dipertahankan).
 * - Data turunan aturan worksheet = DERIVED (bukan ASSUMED/MISSING).
 * - Data hasil worksheet sebelumnya = PENDING_DEPENDENCY (bukan MISSING).
 * - Nilai default aplikasi yang terdokumentasi = DEFAULTED.
 * - Pilihan Appendix/Table = PLANNER_INPUT (belum) / REFERENCE (setelah
 *   dikonfirmasi) / AI_RECOMMENDED_PENDING_CONFIRMATION (proposal AI).
 * - MISSING HANYA untuk nilai yang memang tidak ada dan WAJIB bagi worksheet
 *   yang dipilih (dari checkCaseCompleteness — field hilir sudah dikecualikan).
 *
 * MURNI + deterministik (input sama → klasifikasi sama) tanpa dependensi UI —
 * dipakai parseCase (pratinjau chat), CaseExtractionCard (FASE G), dan test.
 */

import { type SarCaseSchema } from './caseSchema';
import { type CasePlannerInputs, type CaseAssumptionNote } from './caseAdapter';

/** Delapan status resmi field (spesifikasi Fase B). */
export type FieldStatus =
  | 'EXTRACTED'
  | 'DERIVED'
  | 'REFERENCE'
  | 'DEFAULTED'
  | 'PLANNER_INPUT'
  | 'AI_RECOMMENDED_PENDING_CONFIRMATION'
  | 'PENDING_DEPENDENCY'
  | 'MISSING';

export const FIELD_STATUS_ORDER: readonly FieldStatus[] = [
  'EXTRACTED',
  'DERIVED',
  'REFERENCE',
  'DEFAULTED',
  'AI_RECOMMENDED_PENDING_CONFIRMATION',
  'PLANNER_INPUT',
  'PENDING_DEPENDENCY',
  'MISSING',
];

export const FIELD_STATUS_LABELS: Record<FieldStatus, string> = {
  EXTRACTED: 'Ditemukan di soal',
  DERIVED: 'Turunan (aturan/perhitungan)',
  REFERENCE: 'Dari Appendix/Table',
  DEFAULTED: 'Default aplikasi',
  PLANNER_INPUT: 'Keputusan planner',
  AI_RECOMMENDED_PENDING_CONFIRMATION: 'Rekomendasi AI — menunggu konfirmasi',
  PENDING_DEPENDENCY: 'Menunggu worksheet sebelumnya',
  MISSING: 'Hilang — wajib & tidak tersedia',
};

export const FIELD_STATUS_BADGE_CLASS: Record<FieldStatus, string> = {
  EXTRACTED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  DERIVED: 'bg-sky-100 text-sky-800 border-sky-300',
  REFERENCE: 'bg-violet-100 text-violet-800 border-violet-300',
  DEFAULTED: 'bg-slate-100 text-slate-700 border-slate-300',
  PLANNER_INPUT: 'bg-amber-100 text-amber-800 border-amber-300',
  AI_RECOMMENDED_PENDING_CONFIRMATION: 'bg-indigo-100 text-indigo-800 border-indigo-300',
  PENDING_DEPENDENCY: 'bg-cyan-100 text-cyan-800 border-cyan-300',
  MISSING: 'bg-rose-100 text-rose-800 border-rose-300',
};

/** Metadata lengkap satu field (spesifikasi Fase B). */
export interface FieldStatusMeta {
  field: string;
  worksheet: string;
  value: string;
  status: FieldStatus;
  /** Nilai mentah dari dokumen (mis. "6:1", DMS) — selalu bisa dibandingkan. */
  rawValue?: string;
  /** Kutipan/keterangan sumber. */
  source?: string;
  sourcePage?: string;
  unit?: string;
  /** Worksheet/capability yang MEMPRODUKSI nilai (untuk PENDING_DEPENDENCY). */
  worksheetProducer?: string;
  /** Keterangan dependency (mis. "menunggu output env-awa"). */
  dependency?: string;
  /** ID item Appendix/Table (mis. id kategori leeway). */
  referenceId?: string;
  validationMessage?: string;
  /** Tindakan yang tersedia untuk field ini di UI. */
  action?: 'none' | 'confirm-reference' | 'choose-reference' | 'fill' | 'run-worksheet';
}

/** Pemilihan referensi yang sudah terjadi (dari kartu interaktif FASE E). */
export interface ReferenceSelection {
  referenceId: string;
  label?: string;
  /** Sumber Appendix/Table (mis. 'I-1/I-2'). */
  sourceTable?: string;
  /** AI merekomendasikan (true) atau dipilih manual planner (false). */
  fromAiRecommendation?: boolean;
  /** Sudah dikonfirmasi pengguna (USER_CONFIRMED_REFERENCE). */
  confirmed?: boolean;
}

// ── Peta field → satuan (untuk kolom satuan di UI) ──────────────────────────

const FIELD_UNITS: Array<{ test: RegExp; unit: string }> = [
  { test: /SpeedKts|Speed\b|vesselSpeed|tas|transitSpeed|searchSpeed|windSpeed|currentSpeed|driftInterval.*kts/i, unit: 'knots' },
  { test: /Alt(itude)?Ft|flightLevelFt|selectedHeight|altitude/i, unit: 'ft' },
  { test: /Dir(From|To)?Deg|variationDeg|deviationDeg|heading|orientation/i, unit: '°' },
  { test: /visibilityKm/i, unit: 'km' },
  { test: /waveHeight/i, unit: 'meter' },
  { test: /enduranceHours|hours/i, unit: 'jam' },
  { test: /lengthM|wingspanM|heightM|cabinHeight|cabinWidth/i, unit: 'meter' },
  { test: /latitude|lat\b|longitude|lng\b/i, unit: '° (desimal)' },
];

function unitOfField(field: string): string | undefined {
  return FIELD_UNITS.find((entry) => entry.test.test(field))?.unit;
}

// ── Klasifikasi per pola field (aturan deterministik) ───────────────────────

/** Field-field yang nilainya DEFAULT aplikasi yang terdokumentasi
 *  (dipetakan dari buildCaseWorksheetSeeds/caseToolNormalize — C.7). */
const DEFAULTED_FIELD_PATTERNS: Array<{ test: RegExp; value: string; basis: string }> = [
  { test: /^datum\.X\/Y$/i, value: '0 NM', basis: 'Default galat posisi x/y 0 NM (aturan handleApplyDatum; Tabel J-1 GPS 0.1 bila planner memilihnya).' },
  { test: /^datum\.x\/y/i, value: '0 NM', basis: 'Default galat posisi x/y 0 NM (aturan worksheet).' },
  { test: /ws2\.selectedHeight|ws2Sheets.*selectedHeight/i, value: '1000 ft', basis: 'Ketinggian pencarian WS 2 default konvensi aplikasi 1000 ft.' },
  { test: /isFatigue/i, value: 'No', basis: 'Fatigue observer default "No" (konstanta 0.9 saat Yes — konvensi aplikasi).' },
  { test: /aircraftAltMinFt/i, value: '0 ft', basis: 'Ditching di laut → Altmin = 0 ft (aturan worksheet).' },
  { test: /aero\.safetyFactorFs|safetyFactorFs/i, value: '1.1', basis: 'Fs default pencarian pertama worksheet (1.1).' },
  { test: /searchNumber/i, value: '1', basis: 'Nomor pencarian default 1 (konvensi aplikasi).' },
  { test: /asw\.intervalMode/i, value: '6h', basis: 'Mode interval ASW default 6 jam bila jam observasi tidak terbaca.' },
  { test: /datum\.seaCurrentErr/i, value: '0', basis: 'Galat arus default 0 (aturan worksheet).' },
  { test: /^pattern\.patternType/i, value: 'PS', basis: 'Pola pencarian default Parallel Sweep (PS) — orientasi dihitung pipeline.' },
];

/** Field-field hasil ATURAN/TURUNAN (C.4 & serupa) — bukan asumsi. */
const DERIVED_FIELD_PATTERNS: Array<{ test: RegExp; producer?: string; basis: string }> = [
  { test: /^datum\.latitude$/i, basis: 'Latitude datum = nilai absolut latitude LKP (aturan resmi worksheet Datum).' },
  { test: /^datum\.driftInterval$/i, producer: 'env-asw', basis: 'Hours of drift = total hours ASW (dihitung fungsi resmi dari deret angin + waktu).' },
  { test: /eyeHeight/i, basis: 'Tinggi mata dihitung dari jenis/ukuran SRU (MERSHIP ≥50 m; patroli 14; RIB 8).' },
  { test: /searchPlatform/i, basis: 'Platform pencarian = jenis SRU di soal (helicopter/fixed-wing).' },
  { test: /visibilityIndex$/i, basis: 'Indeks kolom visibility = ambang Tabel I-5/I-6 terbesar ≤ visibility soal.' },
  { test: /w8.*visibilityKm$/i, basis: 'Label kolom visibility = ambang Tabel I-3/I-4 terbesar ≤ visibility soal.' },
];

/** Field yang nilainya OUTPUT worksheet sebelumnya (PENDING_DEPENDENCY). */
const PENDING_DEPENDENCY_PATTERNS: Array<{ test: RegExp; producer: string; dependency: string }> = [
  { test: /awaGlide(DirFrom|SpeedKts)/i, producer: 'env-awa', dependency: 'Arah & kecepatan angin glide dihasilkan worksheet AWA (Interpolasi IAMSAR K-10).' },
  { test: /^aero\.awa/i, producer: 'env-awa', dependency: 'Input angin glide ADW dihasilkan worksheet AWA.' },
  { test: /driftInterval/i, producer: 'env-asw', dependency: 'Hours of drift = output worksheet ASW (total hours).' },
  { test: /^lkp\.coord.*adw/i, producer: 'env-adw', dependency: 'LKP diambil dari posisi ditching hasil ADW (lkpSource adw-landing).' },
  { test: /sweepWidth/i, producer: 'ws2/ws8', dependency: 'Sweep width alokasi aset = S hasil WS 2/WS 8.' },
  { test: /pattern.*orientation/i, producer: 'ws1-datum', dependency: 'Orientasi pola = bearing LKP → Datum (dihasilkan pipeline setelah Datum).' },
];

/** Field yang nilainya PILIHAN dari Appendix/Table (PLANNER_INPUT/REFERENCE). */
const REFERENCE_FIELD_PATTERNS: Array<{ test: RegExp; refId: string; worksheet: string; question: string }> = [
  { test: /leewayObjectId/i, refId: 'I-1/I-2', worksheet: 'Datum WS 1', question: 'Kategori objek leeway (Tabel I-1/I-2 Appendix) belum dipilih.' },
];

/** Tindakan UI per status. */
function actionOfStatus(status: FieldStatus): FieldStatusMeta['action'] {
  switch (status) {
    case 'AI_RECOMMENDED_PENDING_CONFIRMATION': return 'confirm-reference';
    case 'PLANNER_INPUT': return 'choose-reference';
    case 'PENDING_DEPENDENCY': return 'run-worksheet';
    case 'MISSING': return 'fill';
    default: return 'none';
  }
}

// ── Klasifikasi utama ───────────────────────────────────────────────────────

export interface ClassifyFieldsOptions {
  /** Pemilihan Appendix/Table yang sudah terjadi (konfirmasi/klik pengguna). */
  referenceSelections?: Record<string, ReferenceSelection>;
  /** Rekomendasi AI yang menunggu konfirmasi (fieldPath → proposal). */
  aiRecommendations?: Record<string, { referenceId: string; label: string; reason: string }>;
  /** Assumption notes dari buildCaseWorksheetSeeds (default/dervied). */
  seedAssumptions?: CaseAssumptionNote[];
}

/** Klasifikasikan SATU field berdasar pola + konteks. Urutan prioritas:
 *  MISSING (dari completeness) > referensi > dependency > derived > defaulted. */
export function classifyFieldStatus(
  field: string,
  hasConcreteValue: boolean,
  isMissingRequired: boolean,
  options: ClassifyFieldsOptions = {},
): { status: FieldStatus; meta: Partial<FieldStatusMeta> } {
  const selection = options.referenceSelections?.[field];
  const recommendation = options.aiRecommendations?.[field];

  // 1. Referensi Appendix/Table (leeway dsb.).
  for (const pattern of REFERENCE_FIELD_PATTERNS) {
    if (!pattern.test.test(field)) continue;
    if (selection?.confirmed) {
      return { status: 'REFERENCE', meta: {
        referenceId: selection.referenceId,
        source: `Dipilih dari Appendix/Table ${selection.sourceTable ?? pattern.refId}${selection.fromAiRecommendation ? ' (menerima rekomendasi AI)' : ' (pilihan planner)'} — dikonfirmasi pengguna.`,
        worksheetProducer: pattern.worksheet,
      } };
    }
    if (recommendation) {
      return { status: 'AI_RECOMMENDED_PENDING_CONFIRMATION', meta: {
        referenceId: recommendation.referenceId,
        source: `Rekomendasi AI: ${recommendation.label} — ${recommendation.reason}. Belum resmi sebelum dikonfirmasi.`,
      } };
    }
    return { status: 'PLANNER_INPUT', meta: { source: pattern.question } };
  }

  // 2. Wajib tapi tidak ada → MISSING (satu-satunya jalur ke MISSING).
  if (isMissingRequired && !hasConcreteValue) {
    return { status: 'MISSING', meta: {} };
  }

  // 3. Output worksheet sebelumnya (belum dihitung).
  for (const pattern of PENDING_DEPENDENCY_PATTERNS) {
    if (pattern.test.test(field) && !hasConcreteValue) {
      return { status: 'PENDING_DEPENDENCY', meta: {
        worksheetProducer: pattern.producer,
        dependency: pattern.dependency,
      } };
    }
  }

  // 4. Turunan aturan.
  for (const pattern of DERIVED_FIELD_PATTERNS) {
    if (pattern.test.test(field)) {
      return { status: 'DERIVED', meta: {
        ...(pattern.producer ? { worksheetProducer: pattern.producer } : {}),
        source: pattern.basis,
      } };
    }
  }

  // 5. Default aplikasi.
  for (const pattern of DEFAULTED_FIELD_PATTERNS) {
    if (pattern.test.test(field)) {
      return { status: 'DEFAULTED', meta: { source: pattern.basis } };
    }
  }

  return { status: hasConcreteValue ? 'EXTRACTED' : 'PLANNER_INPUT', meta: {} };
}

/** Klasifikasi seluruh field kasus → daftar metadata (dipakai UI & test).
 *  `filledFields` = path → nilai terformat dari JSON kasus; `missing` = issue
 *  dari checkCaseCompleteness (hanya field hilir yang dianggap wajib). */
export function classifyCaseFields(
  sarCase: SarCaseSchema,
  filledRows: Array<{ field: string; worksheet: string; value: string; source?: string }>,
  missingIssues: Array<{ field: string; worksheet: string; reason: string }>,
  options: ClassifyFieldsOptions = {},
): FieldStatusMeta[] {
  const missingByField = new Map(missingIssues.map((issue) => [issue.field, issue]));
  const missingFieldNames = new Set(missingIssues.map((issue) => issue.field));
  const results: FieldStatusMeta[] = [];
  const seen = new Set<string>();

  // 1) Field bernilai (JSON kasus).
  for (const row of filledRows) {
    seen.add(row.field);
    const missingIssue = missingByField.get(row.field);
    const { status, meta } = classifyFieldStatus(row.field, true, Boolean(missingIssue), options);
    results.push({
      field: row.field,
      worksheet: row.worksheet,
      value: row.value,
      status,
      rawValue: row.field.includes('dms') ? row.value : undefined,
      source: row.source ?? meta.source,
      unit: unitOfField(row.field),
      ...meta,
      action: actionOfStatus(status),
    });
  }

  // 2) Field wajib yang hilang (checkCaseCompleteness).
  for (const issue of missingIssues) {
    if (seen.has(issue.field)) continue;
    seen.add(issue.field);
    const { status, meta } = classifyFieldStatus(issue.field, false, true, options);
    results.push({
      field: issue.field,
      worksheet: issue.worksheet,
      value: '',
      status: status === 'PLANNER_INPUT' ? 'PLANNER_INPUT' : 'MISSING',
      source: issue.reason,
      ...meta,
      action: actionOfStatus(status === 'PLANNER_INPUT' ? 'PLANNER_INPUT' : 'MISSING'),
    });
  }

  // 3) Catatan default/derived/dependency dari seed assumptions (belum punya
  //    baris bernilai) — mis. datum.latitude, datum.X/Y, ws2.selectedHeight.
  for (const note of options.seedAssumptions ?? []) {
    if (seen.has(note.field)) continue;
    seen.add(note.field);
    const isMissing = missingFieldNames.has(note.field);
    const { status, meta } = classifyFieldStatus(note.field, false, isMissing, options);
    const statusFinal: FieldStatus = status === 'EXTRACTED' && note.value !== undefined
      ? 'DEFAULTED' // catatan seed dengan nilai = default aplikasi yang dipakai
      : status;
    results.push({
      field: note.field,
      worksheet: note.field.startsWith('datum') || note.field.startsWith('sea') ? 'Datum WS 1'
        : note.field.startsWith('asw') ? 'ASW'
        : note.field.startsWith('aero') ? 'ADW (Aero Drift)'
        : note.field.startsWith('ws2') ? 'WS 2'
        : note.field.startsWith('ws8') ? 'WS 8'
        : 'Lainnya',
      value: note.value ?? '',
      status: statusFinal,
      source: note.reason ?? meta.source,
      unit: unitOfField(note.field),
      ...meta,
      action: actionOfStatus(statusFinal),
    });
  }

  return results.sort((a, b) => {
    if (a.worksheet !== b.worksheet) return a.worksheet.localeCompare(b.worksheet, 'id');
    return a.field.localeCompare(b.field, 'id');
  });
}
