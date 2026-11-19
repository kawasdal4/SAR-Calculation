/**
 * Definisi tabel Appendix (Manual SAR AUS — dialog Manual di web app) dalam
 * bentuk HTML-ready untuk panel verifikasi nilai worksheet.
 *
 * Rujukan resmi = PDF yang ditampilkan dialog Manual SAR AUS (R2:
 * Appendix_I_al1.pdf, Appendix_J.pdf). Nomor halaman PDF di bawah dipetakan
 * langsung dari PDF tersebut (bukan label cetak "I-16" dst.).
 *
 * Dipakai bersama TableValue (klik nilai worksheet) + AusSarManualDialog
 * (panel verifikasi: sel dirujuk diberi efek blinking + bisa dioverride).
 */
import { FIXED, HELI, TABLE_I8_ROWS, W2_TARGET_OPTIONS, W8_TARGET_OPTIONS, W8_I3, W8_I4 } from './wscPodTables';
import { LAND_SEARCH_TARGETS, TABLE_I9, TABLE_I10 } from './landSearchTables';
import { TABLE_J1_NAV_ERRORS, TABLE_J2_NAV_ERRORS } from './sarCalculations';

export type ManualDocId = 'combined' | 'appendix-i' | 'appendix-j' | 'appendix-k';

export interface ManualTableRow {
  key: string;
  label: string;
  cells: string[];
}

export interface ManualTableGroup {
  key: string;
  label: string;
  /** Halaman PDF sub-tabel ini (mis. I-5(1) hal. 13, I-5(2) hal. 14). */
  page: number;
  rows: ManualTableRow[];
}

export interface ManualTableDef {
  id: string;
  title: string;
  docId: ManualDocId;
  /** Halaman PDF tabel (untuk lompatan #page= di penampil PDF). */
  page: number;
  colKeys: string[];
  columns: string[];
  rows: ManualTableRow[];
  note?: string;
  /** Sub-tabel per kelompok (mis. per ketinggian: I-5/I-6/I-9). */
  groups?: ManualTableGroup[];
  /** Referensi berupa kurva/gambar (Figure) — panel menampilkan info, bukan sel tabel. */
  figure?: boolean;
  /** Unit nilai pada tabel (untuk keterangan panel). */
  unit?: string;
}

const fmt = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : String(v));

// ---------------------------------------------------------------------------
// Table I-7 — Weather correction factors (hal. 16 Appendix_I_al1.pdf)
// ---------------------------------------------------------------------------
const I7_ROWS: ManualTableRow[] = [
  { key: 'r1', label: 'Winds <28 km/h (<15 kt) atau seas 0–1 m (0–3 ft)', cells: ['1.0', '1.0'] },
  { key: 'r2', label: 'Winds 28–46 km/h (15–25 kt) atau seas 1–1.5 m (3–5 ft)', cells: ['0.5', '0.8'] },
  { key: 'r3', label: 'Winds >46 km/h (>25 kt) atau seas >1.5 m (>5 ft)', cells: ['0.25', '0.5'] },
];

const TABLE_I7: ManualTableDef = {
  id: 'I-7',
  title: 'Table I-7. Weather correction factors for all types of search facilities',
  docId: 'appendix-i',
  page: 16,
  colKeys: ['small', 'other'],
  columns: ['Person in water, raft or boat <10 m (33 ft)', 'Other search objects'],
  rows: I7_ROWS,
  note: 'Baris dipilih dari winds (angin header worksheet) ATAU seas (gelombang) — kondisi terburuk bila keduanya ada. Kolom dari search object: PIW/raft/boat <10 m → kolom 1, lainnya → kolom 2. Faktor row 2/3 "other" berbeda dari IAMSAR (nilai AusSAR — lihat note tabel).',
};

// ---------------------------------------------------------------------------
// Table I-8 — Speed correction factors (hal. 17)
// ---------------------------------------------------------------------------
const I8_COL_DEFS: Array<{ key: string; label: string; platform: 'fixed-wing' | 'helicopter'; index: number }> = [
  { key: 'fw<=150', label: 'Fixed Wing ≤150 kts', platform: 'fixed-wing', index: 0 },
  { key: 'fw180', label: 'Fixed Wing 180 kts', platform: 'fixed-wing', index: 1 },
  { key: 'fw210', label: 'Fixed Wing 210 kts', platform: 'fixed-wing', index: 2 },
  { key: 'heli60', label: 'Helicopter 60 kts', platform: 'helicopter', index: 0 },
  { key: 'heli90', label: 'Helicopter 90 kts', platform: 'helicopter', index: 1 },
  { key: 'heli120', label: 'Helicopter 120 kts', platform: 'helicopter', index: 2 },
  { key: 'heli140', label: 'Helicopter 140 kts', platform: 'helicopter', index: 3 },
];

const TABLE_I8: ManualTableDef = {
  id: 'I-8',
  title: 'Table I-8. Speed (velocity) correction factors for helicopter and fixed wing aircraft search facilities',
  docId: 'appendix-i',
  page: 17,
  colKeys: I8_COL_DEFS.map((c) => c.key),
  columns: I8_COL_DEFS.map((c) => c.label),
  rows: Object.keys(TABLE_I8_ROWS).map((fsRow) => ({
    key: fsRow,
    label: fsRow,
    cells: I8_COL_DEFS.map((c) => fmt(TABLE_I8_ROWS[fsRow]?.[c.platform]?.[c.index])),
  })),
  note: 'Baris dari search object, kolom dari kecepatan (TAS) platform pencarian. Vessel masuk nilai 1.0 (tanpa koreksi kecepatan).',
};

// ---------------------------------------------------------------------------
// Table I-3 — Wu vessels & small boats (hal. 12); kolom [eye 8ft × vis 6] + [eye 14ft × vis 6]
// ---------------------------------------------------------------------------
const W8_I3_VIS = ['2', '5', '10', '15', '20', '>25'];
const I3_COL_DEFS = [
  ...W8_I3_VIS.map((v, i) => ({ key: `8:${v}`, label: `8 ft · ${v} km`, eye: 0 as const, index: i })),
  ...W8_I3_VIS.map((v, i) => ({ key: `14:${v}`, label: `14 ft · ${v} km`, eye: 1 as const, index: i })),
];

const TABLE_I3: ManualTableDef = {
  id: 'I-3',
  title: 'Table I-3. Uncorrected visual sweep width for vessels and small boats (NM)',
  docId: 'appendix-i',
  page: 12,
  colKeys: I3_COL_DEFS.map((c) => c.key),
  columns: I3_COL_DEFS.map((c) => c.label),
  rows: W8_TARGET_OPTIONS.map((t) => ({
    key: t.id,
    label: t.label,
    cells: I3_COL_DEFS.map((c) => fmt(W8_I3[t.id]?.[c.eye]?.[c.index])),
  })),
  unit: 'NM',
  note: 'Baris = search object, kolom = tinggi mata pencari (8 ft / 14 ft) dan visibilitas.',
};

// ---------------------------------------------------------------------------
// Table I-4 — Wu merchant ships / MERSHIP (hal. 12), kolom visibilitas 5–40 km
// ---------------------------------------------------------------------------
const I4_VIS = ['5', '10', '20', '30', '40'];
const TABLE_I4: ManualTableDef = {
  id: 'I-4',
  title: 'Table I-4. Visual sweep widths for merchant ships (MERSHIP) (NM)',
  docId: 'appendix-i',
  page: 12,
  colKeys: I4_VIS,
  columns: I4_VIS.map((v) => `${v} km`),
  rows: W8_TARGET_OPTIONS
    .filter((t) => W8_I4[t.id] !== undefined)
    .map((t) => ({ key: t.id, label: t.label, cells: (W8_I4[t.id] as number[]).map((v) => fmt(v)) })),
  unit: 'NM',
  note: 'Dipakai bila pencari dari anjungan kapal besar (MERSHIP) — kolom visibilitas 5–40 km.',
};

// ---------------------------------------------------------------------------
// Table I-5 / I-6 — Wu fixed wing / helicopter per ketinggian (hal. 13–16)
// ---------------------------------------------------------------------------
const W2_VIS = ['2', '5', '10', '20', '30', '>40'];
function w2Groups(source: typeof FIXED, pageLow: number, pageHigh: number, tableLabel: string): ManualTableGroup[] {
  return ([500, 1000] as const).map((alt) => ({
    key: String(alt),
    label: `${tableLabel} — ${alt} ft`,
    page: pageLow,
    rows: W2_TARGET_OPTIONS.map((t) => ({ key: t.id, label: t.label, cells: source[alt][t.id].map((v) => fmt(v)) })),
  })).concat(([1500, 2000] as const).map((alt) => ({
    key: String(alt),
    label: `${tableLabel} — ${alt} ft`,
    page: pageHigh,
    rows: W2_TARGET_OPTIONS.map((t) => ({ key: t.id, label: t.label, cells: source[alt][t.id].map((v) => fmt(v)) })),
  })));
}

const TABLE_I5: ManualTableDef = {
  id: 'I-5',
  title: 'Table I-5. Sweep Widths for Fixed Wing aircraft (NM) — sub-tabel per ketinggian',
  docId: 'appendix-i',
  page: 13,
  colKeys: W2_VIS,
  columns: W2_VIS.map((v) => `${v} km`),
  rows: W2_TARGET_OPTIONS.map((t) => ({ key: t.id, label: t.label, cells: FIXED[500][t.id].map((v) => fmt(v)) })),
  groups: w2Groups(FIXED, 13, 14, 'Fixed Wing'),
  unit: 'NM',
  note: 'Kolom = MET visibility (2/5/10/20/30/>40 km). PDF: 500 & 1000 ft hal. 13, 1500 & 2000 ft hal. 14.',
};

const TABLE_I6: ManualTableDef = {
  id: 'I-6',
  title: 'Table I-6. Sweep Widths for Helicopters (NM) — Maritime, sub-tabel per ketinggian',
  docId: 'appendix-i',
  page: 15,
  colKeys: W2_VIS,
  columns: W2_VIS.map((v) => `${v} km`),
  rows: W2_TARGET_OPTIONS.map((t) => ({ key: t.id, label: t.label, cells: HELI[500][t.id].map((v) => fmt(v)) })),
  groups: w2Groups(HELI, 15, 16, 'Helicopter'),
  unit: 'NM',
  note: 'Kolom = MET visibility (2/5/10/20/30/>40 km). PDF: 500 & 1000 ft hal. 15, 1500 & 2000 ft hal. 16.',
};

// ---------------------------------------------------------------------------
// Table I-9 / I-10 — darat (hal. 17)
// ---------------------------------------------------------------------------
const TABLE_I9_DEF: ManualTableDef = {
  id: 'I-9',
  title: 'Table I-9. Sweep Widths for visual land search (NM)',
  docId: 'appendix-i',
  page: 17,
  colKeys: ['5', '10', '20', '30', '40'],
  columns: ['5 km', '10 km', '20 km', '30 km', '40 km'],
  rows: LAND_SEARCH_TARGETS.map((t) => ({ key: t.id, label: t.label, cells: TABLE_I9[t.id][500].map((v) => fmt(v)) })),
  groups: ([500, 1000, 1500, 2000] as const).map((alt) => ({
    key: String(alt),
    label: `Land search — ${alt} ft`,
    page: 17,
    rows: LAND_SEARCH_TARGETS.map((t) => ({ key: t.id, label: t.label, cells: TABLE_I9[t.id][alt].map((v) => fmt(v)) })),
  })),
  unit: 'NM',
  note: 'Baris = search object darat, kolom = visibilitas; sub-tabel per ketinggian. Tanda "—" = tidak tersedia (mis. Person >1000 ft).',
};

const I10_COLS: Array<{ key: string; label: string }> = [
  { key: 'under-15', label: '<15% vegetasi' },
  { key: '15-60', label: '15–60% vegetasi / berbukit' },
  { key: '60-85', label: '60–85% vegetasi / pegunungan' },
  { key: 'over-85', label: '>85% vegetasi' },
];
const TABLE_I10_DEF: ManualTableDef = {
  id: 'I-10',
  title: 'Table I-10. Correction factors — vegetation and high terrain',
  docId: 'appendix-i',
  page: 17,
  colKeys: I10_COLS.map((c) => c.key),
  columns: I10_COLS.map((c) => c.label),
  rows: LAND_SEARCH_TARGETS.map((t) => ({
    key: t.id,
    label: t.label,
    cells: I10_COLS.map((c) => fmt(TABLE_I10[t.id][c.key as keyof (typeof TABLE_I10)[keyof typeof TABLE_I10]])),
  })),
  note: 'Faktor koreksi vegetasi/terrain (Fv) sesuai jenis objek dan tutupan vegetasi.',
};

// ---------------------------------------------------------------------------
// Table J-1 / J-2 — fix error navigasi (Appendix_J.pdf hal. 1)
// ---------------------------------------------------------------------------
const TABLE_J1: ManualTableDef = {
  id: 'J-1',
  title: 'Table J-1. Navigational fix errors',
  docId: 'appendix-j',
  page: 1,
  colKeys: ['error'],
  columns: ['Galat posisi (NM)'],
  rows: TABLE_J1_NAV_ERRORS.map((e) => ({ key: e.id, label: e.label, cells: [String(e.errorNm)] })),
  unit: 'NM',
  note: 'Dipakai untuk x (distress craft error) dan y (search craft error) sesuai alat navigasi yang tersedia.',
};

const TABLE_J2: ManualTableDef = {
  id: 'J-2',
  title: 'Table J-2. Fix error — jenis kapal/pesawat bila navigasi tidak diketahui',
  docId: 'appendix-j',
  page: 1,
  colKeys: ['error'],
  columns: ['Galat posisi (NM)'],
  rows: TABLE_J2_NAV_ERRORS.map((e) => ({ key: e.id, label: e.label, cells: [String(e.errorNm)] })),
  unit: 'NM',
  note: 'Galat untuk area praktis bila alat navigasi tidak diketahui.',
};

// ---------------------------------------------------------------------------
// Figure I-12 — POD curve (hal. 11) — referensi gambar (tanpa sel tabel)
// ---------------------------------------------------------------------------
const FIGURE_I12: ManualTableDef = {
  id: 'FIG-I-12',
  title: 'Figure I-12. Probability of Detection (POD) — kurva pencarian ke-1..5',
  docId: 'appendix-i',
  page: 11,
  colKeys: [],
  columns: [],
  rows: [],
  figure: true,
  note: 'POD di aplikasi dihitung dengan rumus polinomial Excel POD.xls (fitting kurva Figure I-12, domain C ∈ [0, 2]) — bukan pembacaan kurva manual.',
};

// ---------------------------------------------------------------------------
// Registry + helper
// ---------------------------------------------------------------------------
export const MANUAL_TABLES: Record<string, ManualTableDef> = {
  'I-3': TABLE_I3,
  'I-4': TABLE_I4,
  'I-5': TABLE_I5,
  'I-6': TABLE_I6,
  'I-7': TABLE_I7,
  'I-8': TABLE_I8,
  'I-9': TABLE_I9_DEF,
  'I-10': TABLE_I10_DEF,
  'J-1': TABLE_J1,
  'J-2': TABLE_J2,
  'FIG-I-12': FIGURE_I12,
};

/** Baris efektif dari def (group bila ada). */
export function manualTableRows(def: ManualTableDef, groupKey?: string): ManualTableRow[] {
  if (def.groups && groupKey) {
    return def.groups.find((g) => g.key === groupKey)?.rows ?? def.rows;
  }
  return def.rows;
}

/** Halaman PDF efektif (group dapat menimpa halaman tabel induk). */
export function manualTablePage(def: ManualTableDef, groupKey?: string): number {
  if (def.groups && groupKey) {
    return def.groups.find((g) => g.key === groupKey)?.page ?? def.page;
  }
  return def.page;
}

/** Nilai sel yang dirujuk (string apa adanya di tabel); undefined bila tak ketemu. */
export function manualTableCell(
  def: ManualTableDef,
  rowKey: string | undefined,
  colKey: string | undefined,
  groupKey?: string,
): string | undefined {
  if (!rowKey || !colKey || def.figure) return undefined;
  const row = manualTableRows(def, groupKey).find((r) => r.key === rowKey);
  const colIndex = def.colKeys.indexOf(colKey);
  if (!row || colIndex < 0) return undefined;
  return row.cells[colIndex];
}
