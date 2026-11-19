/**
 * CHANGE LOG BATCH AI (Fase 2, keputusan no.9 & 10) — audit + undo per-batch.
 *
 * KONTRAK (keputusan no.10):
 * - Setiap "Konfirmasi & Terapkan" AI = SATU batch: pratinjau → persetujuan →
 *   disimpan atomic per batch (transaksi DB di /api/ai/change-log) → nilai
 *   sebelum/sesudah tersimpan → rollback aman → TIDAK menimpa perubahan manual
 *   yang terjadi setelah batch diterapkan.
 * - Field yang dicatat = field TERDAFTAR di SET_FIELDS_REGISTRY (satu skema
 *   dengan tool set_fields) — tanpa arbitrary path (keputusan no.5).
 * - Semua tool/mechanisme update memakai setter yang sama; undo juga lewat
 *   jalur set_fields (satu mekanisme penyimpanan, tidak ada jalur kedua).
 *
 * Modul ini MURNI (tanpa React/DB): dipakai page.tsx (diff & undo) dan
 * /api/ai/change-log (validasi payload).
 */

import { SET_FIELDS_REGISTRY, SET_FIELDS_WORKSHEETS, type SetFieldsWorksheet } from './tools/setFields';

/** Worksheet yang dilacak change-log: registry set_fields + ws1 (Fs terukur). */
export const CHANGE_LOG_WORKSHEETS = [...SET_FIELDS_WORKSHEETS, 'ws1'] as const;
export type ChangeLogWorksheet = (typeof CHANGE_LOG_WORKSHEETS)[number];

/** Satu baris perubahan field (nilai = JSON string kanonik; null = kosong). */
export interface ChangeLogRow {
  worksheet: ChangeLogWorksheet;
  /** Nama field terdaftar; lembar per-SRU/aset: `${field}@${nama lembar}`. */
  field: string;
  valueBefore: string | null;
  valueAfter: string | null;
}

export interface ChangeLogBatchInput {
  batchId: string;
  caseId?: string | null;
  sessionId?: string | null;
  /** 'ai-apply' | 'undo' */
  source: 'ai-apply' | 'undo';
  rows: ChangeLogRow[];
}

/** Info batch untuk UI undo (page → AIChatPanel). */
export interface AiBatchInfo {
  batchId: string;
  at: number;
  /** Worksheet yang tersentuh (label ringkas). */
  worksheets: string[];
  /** Jumlah field berubah. */
  changedCount: number;
  rows: ChangeLogRow[];
  /** Hasil undo bila sudah dilakukan (batch tercatat sebagai batch undo baru). */
  undone?: { batchId: string; undoneCount: number; skippedManual: number; at: number };
}

// ── Serialisasi kanonik ──────────────────────────────────────────────────────

/** JSON string dengan kunci objek terurut — diff stabil lintas render. */
export function stableStringify(value: unknown): string | null {
  if (value === undefined) return null;
  const seen = new WeakSet<object>();
  const walk = (input: unknown): unknown => {
    if (input === undefined) return null;
    if (input === null || typeof input !== 'object') return input;
    if (seen.has(input as object)) return null;
    seen.add(input as object);
    if (Array.isArray(input)) return input.map(walk);
    const record = input as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) sorted[key] = walk(record[key]);
    return sorted;
  };
  try {
    return JSON.stringify(walk(value));
  } catch {
    return String(value);
  }
}

// ── Pemetaan worksheet → bagian snapshot buildState ──────────────────────────

type SnapshotState = Record<string, unknown>;

/** Kunci registry pattern tersebar di root snapshot (bukan objek tersarang). */
const PATTERN_ROOT_KEYS = [
  'patternType', 'patternOrientationText', 'patternTurn', 'patternEnvironment',
  'patternLandHeight', 'sectorAngleText', 'sectorLegLengthText', 'sectorLegCountText',
  'trackLineLengthText', 'tsReturnOffsetText', 'tsReturn',
];

/** Worksheet change-log → kunci snapshot buildState().state. */
const STATE_KEY_BY_WORKSHEET: Record<ChangeLogWorksheet, string> = {
  asw: 'asw',
  awa: 'awa',
  aero: 'aero',
  datum: 'datum',
  ws1: 'ws1',
  lkp: 'lkp',
  ws2: 'ws2Sheets',
  ws3: 'ws3Sheets',
  ws8: 'ws8Sheets',
  assets: 'assets',
  ws4: 'ws4',
  intercept: 'intercept',
  briefing: 'briefing',
  renops: 'renops',
  pattern: '', // khusus: kunci tersebar di root (lihat pickWorksheetState)
};

function pickWorksheetState(state: SnapshotState, worksheet: ChangeLogWorksheet): unknown {
  if (worksheet === 'pattern') {
    return Object.fromEntries(PATTERN_ROOT_KEYS.map((key) => [key, state[key]]));
  }
  return state[STATE_KEY_BY_WORKSHEET[worksheet]];
}

function worksheetFieldNames(worksheet: ChangeLogWorksheet): string[] {
  if (worksheet === 'ws1') return ['fs', 'measured.distanceNm'];
  const registry = SET_FIELDS_REGISTRY[worksheet as SetFieldsWorksheet] as Record<string, { type: string }> | undefined;
  if (!registry) return [];
  if (worksheet === 'briefing' || worksheet === 'renops') {
    // Form bebas string: daftar field dinamis — penanganan khusus di diff.
    return [];
  }
  return Object.keys(registry);
}

function worksheetFieldType(worksheet: ChangeLogWorksheet, field: string): string {
  if (worksheet === 'ws1') return 'number';
  const registry = SET_FIELDS_REGISTRY[worksheet as SetFieldsWorksheet] as Record<string, { type: string }> | undefined;
  return registry?.[field]?.type ?? 'string';
}

function readPath(source: unknown, path: string): unknown {
  if (!source || typeof source !== 'object') return undefined;
  return (source as Record<string, unknown>)[path];
}

function readMeasuredDistance(source: unknown): unknown {
  const record = source && typeof source === 'object' ? (source as Record<string, unknown>) : undefined;
  const measured = record?.measured;
  return measured && typeof measured === 'object' ? (measured as Record<string, unknown>).distanceNm : undefined;
}

/** Ambil nilai field (termasuk kualifikasi `field@namaLembar`) dari state. */
export function readChangeRowValue(state: SnapshotState, row: Pick<ChangeLogRow, 'worksheet' | 'field'>): unknown {
  const at = row.field.indexOf('@');
  const fieldName = at >= 0 ? row.field.slice(0, at) : row.field;
  const sheetName = at >= 0 ? row.field.slice(at + 1) : undefined;
  const worksheetState = pickWorksheetState(state, row.worksheet);
  if (sheetName !== undefined) {
    const list = Array.isArray(worksheetState) ? worksheetState : [];
    for (const entry of list) {
      const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : undefined;
      const data = record?.data ?? record; // lembar WS2/3/8: data; assets: objek langsung
      const name = readPath(data, 'sruName') ?? readPath(data, 'name') ?? readPath(record, 'key');
      if (typeof name === 'string' && name === sheetName) {
        return fieldName === 'measured.distanceNm' ? readMeasuredDistance(data) : readPath(data, fieldName);
      }
    }
    return undefined;
  }
  if (fieldName === 'measured.distanceNm') return readMeasuredDistance(worksheetState);
  return readPath(worksheetState, fieldName);
}

// ── Diff before/after ────────────────────────────────────────────────────────

const MAX_ROWS_PER_BATCH = 200;

function diffScalarWorksheet(
  worksheet: ChangeLogWorksheet,
  before: unknown,
  after: unknown,
  rows: ChangeLogRow[],
): void {
  if (worksheet === 'briefing' || worksheet === 'renops') {
    // Form bebas: diff SEMUA kunci string sebelum/sesudah (field = kunci form).
    const beforeRecord = before && typeof before === 'object' ? (before as Record<string, unknown>) : {};
    const afterRecord = after && typeof after === 'object' ? (after as Record<string, unknown>) : {};
    const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
    for (const key of [...keys].sort()) {
      const valueBefore = stableStringify(beforeRecord[key]);
      const valueAfter = stableStringify(afterRecord[key]);
      if (valueBefore !== valueAfter) rows.push({ worksheet, field: key, valueBefore, valueAfter });
      if (rows.length >= MAX_ROWS_PER_BATCH) return;
    }
    return;
  }
  for (const field of worksheetFieldNames(worksheet)) {
    let valueBefore: string | null;
    let valueAfter: string | null;
    if (field === 'measured.distanceNm') {
      valueBefore = stableStringify(readMeasuredDistance(before));
      valueAfter = stableStringify(readMeasuredDistance(after));
    } else {
      valueBefore = stableStringify(readPath(before, field));
      valueAfter = stableStringify(readPath(after, field));
    }
    if (valueBefore !== valueAfter) rows.push({ worksheet, field, valueBefore, valueAfter });
    if (rows.length >= MAX_ROWS_PER_BATCH) return;
  }
}

function sheetEntries(worksheetState: unknown, worksheet: ChangeLogWorksheet): Array<{ name: string; data: unknown }> {
  if (!Array.isArray(worksheetState)) return [];
  return worksheetState.map((entry) => {
    const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    if (worksheet === 'assets') {
      const name = typeof record.name === 'string' ? record.name : '';
      return { name, data: entry };
    }
    const data = record.data;
    const name = data && typeof data === 'object'
      ? (typeof (data as Record<string, unknown>).sruName === 'string' ? (data as Record<string, unknown>).sruName as string
        : typeof record.key === 'string' ? record.key : '')
      : '';
    return { name, data };
  }).filter((entry) => entry.name !== '');
}

function diffSheetWorksheet(
  worksheet: ChangeLogWorksheet,
  before: unknown,
  after: unknown,
  rows: ChangeLogRow[],
): void {
  const beforeSheets = sheetEntries(before, worksheet);
  const afterSheets = sheetEntries(after, worksheet);
  const beforeByName = new Map(beforeSheets.map((entry) => [entry.name, entry.data]));
  for (const sheet of afterSheets) {
    const beforeData = beforeByName.get(sheet.name);
    const fields = worksheetFieldNames(worksheet);
    for (const field of fields) {
      const valueBefore = beforeData === undefined ? null : stableStringify(readPath(beforeData, field));
      const valueAfter = stableStringify(readPath(sheet.data, field));
      if (valueBefore !== valueAfter) {
        rows.push({ worksheet, field: `${field}@${sheet.name}`, valueBefore, valueAfter });
        if (rows.length >= MAX_ROWS_PER_BATCH) return;
      }
    }
  }
  // Lembar yang dihapus: catat field terdaftarnya → null.
  const afterNames = new Set(afterSheets.map((entry) => entry.name));
  for (const sheet of beforeSheets) {
    if (afterNames.has(sheet.name)) continue;
    for (const field of worksheetFieldNames(worksheet)) {
      const valueBefore = stableStringify(readPath(sheet.data, field));
      if (valueBefore !== null) {
        rows.push({ worksheet, field: `${field}@${sheet.name}`, valueBefore, valueAfter: null });
        if (rows.length >= MAX_ROWS_PER_BATCH) return;
      }
    }
  }
}

/**
 * Diff snapshot `buildState().state` sebelum/sesudah satu batch apply AI →
 * baris change-log (field terdaftar; lembar per-SRU berkualifikasi `@nama`).
 * Cap 200 baris per batch. TIDAK pernah melempar.
 */
export function buildChangeRows(
  beforeState: SnapshotState,
  afterState: SnapshotState,
  worksheets?: readonly string[],
): ChangeLogRow[] {
  const rows: ChangeLogRow[] = [];
  const targets = (worksheets && worksheets.length > 0
    ? CHANGE_LOG_WORKSHEETS.filter((ws) => worksheets.includes(ws))
    : [...CHANGE_LOG_WORKSHEETS]) as ChangeLogWorksheet[];
  for (const worksheet of targets) {
    if (rows.length >= MAX_ROWS_PER_BATCH) break;
    if (worksheet === 'ws2' || worksheet === 'ws3' || worksheet === 'ws8' || worksheet === 'assets') {
      diffSheetWorksheet(worksheet, pickWorksheetState(beforeState, worksheet), pickWorksheetState(afterState, worksheet), rows);
    } else {
      diffScalarWorksheet(worksheet, pickWorksheetState(beforeState, worksheet), pickWorksheetState(afterState, worksheet), rows);
    }
  }
  return rows;
}

// ── Undo (keputusan no.10) ───────────────────────────────────────────────────

export interface UndoPlan {
  ok: boolean;
  /** Baris yang masih cocok dengan nilai sesudah (aman di-rollback). */
  undoable: ChangeLogRow[];
  /** Baris yang nilainya berubah setelah batch (perubahan manual — TIDAK ditimpa). */
  skippedManual: Array<ChangeLogRow & { currentValue: string | null }>;
  /** Baris yang tidak punya field terdaftar untuk di-rollback via set_fields. */
  skippedUnsupported: ChangeLogRow[];
}

/** Rencana undo: bandingkan nilai saat ini dengan valueAfter tiap baris.
 *  Baris yang tidak cocok = perubahan manual setelah batch → DILARANG ditimpa. */
export function planUndo(rows: ChangeLogRow[], currentState: SnapshotState): UndoPlan {
  const undoable: ChangeLogRow[] = [];
  const skippedManual: Array<ChangeLogRow & { currentValue: string | null }> = [];
  const skippedUnsupported: ChangeLogRow[] = [];
  for (const row of rows) {
    const at = row.field.indexOf('@');
    const fieldName = at >= 0 ? row.field.slice(0, at) : row.field;
    if (row.worksheet === 'briefing' || row.worksheet === 'renops' || row.field === 'measured.distanceNm') {
      // Form bebas & jarak terukur: belum ada jalur set_fields — v1 lewati.
      skippedUnsupported.push(row);
      continue;
    }
    const registry = SET_FIELDS_REGISTRY[row.worksheet as SetFieldsWorksheet] as Record<string, { type: string }> | undefined;
    if (!registry || registry[fieldName] === undefined) {
      skippedUnsupported.push(row);
      continue;
    }
    const currentValue = stableStringify(readChangeRowValue(currentState, row));
    if (currentValue === row.valueAfter) undoable.push(row);
    else skippedManual.push({ ...row, currentValue });
  }
  return { ok: undoable.length > 0, undoable, skippedManual, skippedUnsupported };
}

/** Konversi baris undo → payload SetFieldsApplied (SATU mekanisme apply, no.5):
 *  nilai sebelum di-parse kembali ke bentuk aslinya (objek/angka/boolean/teks).
 *  Baris dengan valueBefore null (field sebelumnya kosong) dilewati — pengosongan
 *  field bukan bagian undo v1. */
export function undoRowsToSetFieldsValues(
  rows: ChangeLogRow[],
): Array<{ worksheet: ChangeLogWorksheet; sruName?: string; values: Record<string, unknown> }> {
  const byKey = new Map<string, { worksheet: ChangeLogWorksheet; sruName?: string; values: Record<string, unknown> }>();
  for (const row of rows) {
    if (row.valueBefore === null) continue;
    if (row.worksheet === 'briefing' || row.worksheet === 'renops') continue;
    const at = row.field.indexOf('@');
    const fieldName = at >= 0 ? row.field.slice(0, at) : row.field;
    const sruName = at >= 0 ? row.field.slice(at + 1) : undefined;
    // Defense-in-depth: hanya field TERDAFTAR (keputusan no.5) yang boleh
    // di-restore lewat jalur set_fields.
    const registry = SET_FIELDS_REGISTRY[row.worksheet as SetFieldsWorksheet] as Record<string, { type: string }> | undefined;
    if (!registry || registry[fieldName] === undefined) continue;
    const type = worksheetFieldType(row.worksheet, fieldName);
    const raw = safeParse(row.valueBefore);
    const key = `${row.worksheet}::${sruName ?? ''}`;
    const entry = byKey.get(key) ?? { worksheet: row.worksheet, ...(sruName ? { sruName } : {}), values: {} };
    if (type === 'json') {
      entry.values[fieldName] = raw;
    } else if (type === 'number') {
      const numeric = typeof raw === 'number' ? raw : Number(row.valueBefore);
      if (!Number.isFinite(numeric)) continue;
      entry.values[fieldName] = numeric;
    } else if (type === 'boolean') {
      const bool = typeof raw === 'boolean' ? raw : raw === 'true' ? true : raw === 'false' ? false : undefined;
      if (bool === undefined) continue;
      entry.values[fieldName] = bool;
    } else {
      const text = typeof raw === 'string' ? raw : String(row.valueBefore);
      if (text === '') continue;
      entry.values[fieldName] = text;
    }
    byKey.set(key, entry);
  }
  return [...byKey.values()].filter((entry) => Object.keys(entry.values).length > 0);
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

/** Baris undo (nilai dibalik) untuk dicatat sebagai batch baru source 'undo'. */
export function invertRows(rows: ChangeLogRow[]): ChangeLogRow[] {
  return rows.map((row) => ({
    worksheet: row.worksheet,
    field: row.field,
    valueBefore: row.valueAfter,
    valueAfter: row.valueBefore,
  }));
}

// ── Client fetch (best-effort; DB = sumber audit utama, keputusan no.4) ──────

export async function postChangeLogBatch(input: ChangeLogBatchInput): Promise<boolean> {
  try {
    const response = await fetch('/api/ai/change-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        batchId: input.batchId,
        caseId: input.caseId ?? null,
        sessionId: input.sessionId ?? null,
        source: input.source,
        rows: input.rows,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface ChangeLogBatchSummary {
  batchId: string;
  source: string;
  createdAt: string;
  changedCount: number;
  worksheets: string[];
}

export async function fetchChangeLogBatches(caseId: string | null, limit = 20): Promise<ChangeLogBatchSummary[]> {
  try {
    const query = new URLSearchParams({ limit: String(limit) });
    if (caseId) query.set('caseId', caseId);
    const response = await fetch(`/api/ai/change-log?${query.toString()}`);
    if (!response.ok) return [];
    const data = (await response.json()) as { batches?: ChangeLogBatchSummary[] };
    return Array.isArray(data.batches) ? data.batches : [];
  } catch {
    return [];
  }
}
