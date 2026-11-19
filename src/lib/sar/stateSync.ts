/**
 * Utilitas sinkronisasi state antar worksheet & manajemen kasus (save/load).
 *
 * Dipakai oleh:
 * - page.tsx  : guard mirror state lembar WS 2/3/8 → `sheet.data` (cegah loop
 *               update React #185 saat identitas callback berubah tiap render).
 * - CaseManager.tsx : pencarian kasus tersimpan pada dialog Open Case.
 */

/** Equal mendalam untuk data polir (JSON-safe): objek, array, primitif.
 *  Dipakai untuk membandingkan snapshot input worksheet sebelum menulis ulang
 *  state induk — mencegah re-render loop bila isi sama tetapi referensi baru. */
export function deepEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqualValue(item, b[i]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) =>
      deepEqualValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

/** Bandingkan dua record polir secara mendalam (pembungkus deepEqualValue).
 *  `undefined` diperlakukan setara objek kosong (belum ada data = data kosong). */
export function shallowEqualRecord(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  return deepEqualValue(a ?? {}, b ?? {});
}

export interface SarCaseSearchFields {
  title?: string | null;
  caseNumber?: string | null;
  searchObject?: string | null;
  notes?: string | null;
  phase?: string | null;
}

/** Filter daftar kasus tersimpan berdasarkan kata kunci (title, nomor kasus,
 *  objek pencarian, notes, fase). Pencarian tidak peka huruf besar/kecil;
 *  kata kunci multi-kata dibagi per spasi — semua token harus cocok. */
export function filterSarCases<T extends SarCaseSearchFields>(cases: T[], query: string): T[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed === '') return [...cases];
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  return cases.filter((entry) => {
    const haystack = [entry.title, entry.caseNumber, entry.searchObject, entry.notes, entry.phase]
      .map((field) => (field ?? '').toString().toLowerCase())
      .join(' ');
    return tokens.every((token) => haystack.includes(token));
  });
}

/** True bila nilai "berisi": bukan null/undefined/string kosong/0/false/NaN,
 *  array tidak kosong, atau objek dengan minimal satu nilai berisi (rekursif).
 *  Nol diperlakukan "tidak berisi" karena snapshot worksheet default-nya nol —
 *  {X:0, Y:0} tidak boleh mengalahkan data awal (AI/kasus) yang berisi. */
export function hasFilledValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '' || value === false) return false;
  if (typeof value === 'number') return Number.isFinite(value) && value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasFilledValue);
  }
  return true;
}

/** Pilih snapshot terisi: mirror (worksheet terpasang, paling segar) bila
 *  berisi, selain itu fallback (data awal dari AI/kasus). Mengatasi masalah
 *  TabsContent yang meng-unmount tab non-aktif — mirror tak pernah terisi
 *  untuk tab yang belum dibuka, sehingga data AI/kasus masih tersimpan. */
export function firstFilledSnapshot<T extends object>(
  mirror: T | null | undefined,
  fallback: T | null | undefined,
): T | undefined {
  if (mirror && hasFilledValue(mirror)) return mirror;
  if (fallback && hasFilledValue(fallback)) return fallback;
  return undefined;
}

export interface AswSnapshotFields {
  observations?: unknown;
  aswErr?: number;
  distressTime?: string;
  datumTime?: string;
  obsIntervalMode?: '6h' | '3h';
  caseTitle?: string;
}

/** Gabungkan snapshot ASW per-bidang: mirror menang bila berisi, bagian kosong
 *  diisi dari fallback (data awal AI/kasus). Perlu per-bidang karena mirror ASW
 *  selalu ada ({observations: [], aswErr: 0}) walau tab belum pernah dibuka. */
export function mergeAswSnapshot(
  mirror: AswSnapshotFields | null | undefined,
  fallback: AswSnapshotFields | null | undefined,
): AswSnapshotFields {
  const m = mirror ?? {};
  const f = fallback ?? {};
  const mirrorObs = Array.isArray(m.observations) ? (m.observations as unknown[]) : [];
  const fallbackObs = Array.isArray(f.observations) ? (f.observations as unknown[]) : [];
  const firstNonEmpty = (a: unknown, b: unknown): unknown =>
    a === undefined || a === null || a === '' ? (b ?? undefined) : a;
  return {
    observations: mirrorObs.length > 0 ? mirrorObs : fallbackObs,
    aswErr: (typeof m.aswErr === 'number' && m.aswErr !== 0 ? m.aswErr : (typeof f.aswErr === 'number' ? f.aswErr : 0)) as number,
    distressTime: firstNonEmpty(m.distressTime, f.distressTime) as string | undefined,
    datumTime: firstNonEmpty(m.datumTime, f.datumTime) as string | undefined,
    obsIntervalMode: (firstNonEmpty(m.obsIntervalMode, f.obsIntervalMode) ?? '6h') as '6h' | '3h',
    caseTitle: firstNonEmpty(m.caseTitle, f.caseTitle) as string | undefined,
  };
}

/** Bagian worksheet pada snapshot kasus + label Indonesia untuk toast restore. */
export const CASE_SECTION_LABELS: Record<string, string> = {
  awa: 'AWA',
  asw: 'ASW',
  aero: 'ADW',
  datum: 'WS 1 (Datum)',
  search: 'Panduan Pencarian',
  lkp: 'LKP',
  assets: 'Aset SRU',
  ws2Sheets: 'WS 2',
  ws3Sheets: 'WS 3',
  ws8Sheets: 'WS 8',
  ws4: 'WS 4',
  intercept: 'Intercept',
  briefing: 'Briefing',
  renops: 'Renops',
  pattern: 'Pola Pencarian',
};

/** Daftar bagian kasus yang berisi vs kosong — dipakai toast info saat load
 *  agar pengguna tahu kasus versi lama hanya menyimpan sebagian worksheet. */
export function describeRestoredCaseSections(state: Record<string, unknown> | null | undefined): {
  filled: string[];
  empty: string[];
} {
  if (!state || typeof state !== 'object') return { filled: [], empty: Object.values(CASE_SECTION_LABELS) };
  const patternFilled = state.patternType
    || hasFilledValue(state.patternOrientationText)
    || hasFilledValue(state.sectorAngleText)
    || hasFilledValue(state.trackLineLengthText);
  const probes: Record<string, unknown> = {
    awa: (state.awa as { observations?: unknown[] } | undefined)?.observations,
    asw: (state.asw as { observations?: unknown[] } | undefined)?.observations,
    aero: state.aero,
    datum: state.datum,
    search: state.search,
    lkp: state.lkp,
    assets: state.assets,
    ws2Sheets: (state.ws2Sheets as Array<{ data?: unknown }> | undefined)?.some((sheet) => hasFilledValue(sheet?.data)),
    ws3Sheets: (state.ws3Sheets as Array<{ data?: unknown }> | undefined)?.some((sheet) => hasFilledValue(sheet?.data)),
    ws8Sheets: (state.ws8Sheets as Array<{ data?: unknown }> | undefined)?.some((sheet) => hasFilledValue(sheet?.data)),
    ws4: state.ws4,
    intercept: state.intercept,
    briefing: state.briefing,
    renops: state.renops,
    pattern: patternFilled,
  };
  const filled: string[] = [];
  const empty: string[] = [];
  for (const [key, label] of Object.entries(CASE_SECTION_LABELS)) {
    (hasFilledValue(probes[key]) ? filled : empty).push(label);
  }
  return { filled, empty };
}
