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
