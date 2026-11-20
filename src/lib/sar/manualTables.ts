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
import { LEEWAY_OBJECT_TYPES, isLeewayTableI2, TABLE_J1_NAV_ERRORS, TABLE_J2_NAV_ERRORS } from './sarCalculations';

export type ManualDocId = 'combined' | 'appendix-i' | 'appendix-j' | 'appendix-k';

export interface ManualTableRow {
  key: string;
  label: string;
  cells: string[];
  /** Baris JUDUL SEKSI (kolom kategori manual, mis. "Survival Craft — Aviation
   *  Life Rafts") — dirender full-width, tidak bisa diklik, tidak blink. */
  header?: boolean;
}

export interface ManualTableGroup {
  key: string;
  label: string;
  /** Halaman PDF sub-tabel ini (mis. I-5(1) hal. 13, I-5(2) hal. 14). */
  page: number;
  rows: ManualTableRow[];
  /** Judul kolom label milik sub-tabel ini — menimpa def.rowLabelHeader
   *  pada mode stacked (J-1 "Alat navigasi" vs J-2 "Jenis kapal/pesawat"). */
  rowLabelHeader?: string;
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
  /** Tampilkan SEMUA sub-tabel berjajar (satu per group, lengkap sesuai
   *  manual) pada panel verifikasi — untuk tabel pilihan KATEGORI seperti
   *  leeway Table I-1 + sub-tabel I-2. Bila false, hanya group aktif yang
   *  ditampilkan (mis. sub-tabel ketinggian I-5/I-6/I-9 mengikuti worksheet). */
  stackGroups?: boolean;
  /** Referensi berupa kurva/gambar (Figure) — panel menampilkan info, bukan sel tabel. */
  figure?: boolean;
  /** Unit nilai pada tabel (untuk keterangan panel). */
  unit?: string;
  /** Judul kolom LABEL baris untuk tabel satu kolom nilai (mis. J-1 "Alat
   *  navigasi", J-2 "Jenis kapal/pesawat", J-3 "Jenis unit"). Tanpa ini,
   *  tabel satu kolom hanya merender angka tanpa label baris. */
  rowLabelHeader?: string;
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
// Table J-1 / J-2 — fix error navigasi (Appendix_J.pdf hal. 1 — ketiga tabel
// J-1/J-2/J-3 berada pada halaman pertama PDF Appendix J)
// ---------------------------------------------------------------------------
// Baris J-1/J-2 dipisah per tabel: panel verifikasi (stackGroups) menampilkan
// KEDUA tabel berjajar lengkap — baris alat navigasi aktif blink pada tabelnya
// (blink di J-1 bila x/y dari alat navigasi, di J-2 bila per jenis kapal/
// pesawat), dan klik baris di tabel mana pun langsung menerapkan nilai.
const J1_ROWS: ManualTableRow[] = TABLE_J1_NAV_ERRORS.map((e) => ({ key: e.id, label: e.label, cells: [String(e.errorNm)] }));
const J2_ROWS: ManualTableRow[] = TABLE_J2_NAV_ERRORS.map((e) => ({ key: e.id, label: e.label, cells: [String(e.errorNm)] }));

/** Kedua tabel J selalu berjajar — x/y Worksheet 1 & Datum bisa bersumber dari
 *  J-1 (alat navigasi diketahui) ATAU J-2 (navigasi tidak diketahui), jadi
 *  panel verifikasi "Table J-1/J-2" wajib menampilkan keduanya (hal. 1 PDF). */
const J_STACK_GROUPS: ManualTableGroup[] = [
  { key: 'J-1', label: 'Table J-1 — Navigational fix errors (alat navigasi diketahui)', page: 1, rows: J1_ROWS, rowLabelHeader: 'Alat navigasi' },
  { key: 'J-2', label: 'Table J-2 — Fix error bila alat navigasi tidak diketahui (per jenis kapal/pesawat)', page: 1, rows: J2_ROWS, rowLabelHeader: 'Jenis kapal/pesawat' },
];

const TABLE_J1: ManualTableDef = {
  id: 'J-1',
  title: 'Table J-1. Navigational fix errors',
  docId: 'appendix-j',
  page: 1,
  colKeys: ['error'],
  columns: ['Galat posisi (NM)'],
  rows: J1_ROWS,
  rowLabelHeader: 'Alat navigasi',
  unit: 'NM',
  stackGroups: true,
  groups: J_STACK_GROUPS,
  note: 'Dipakai untuk x (distress craft error) dan y (search craft error) sesuai alat navigasi yang tersedia (mis. GPS → 0.1 NM). Bila alat navigasi tidak diketahui, pakai Table J-2 berdasarkan jenis kapal/pesawat. Klik baris untuk memakai galat tersebut di worksheet.',
};

const TABLE_J2: ManualTableDef = {
  id: 'J-2',
  title: 'Table J-2. Fix error — jenis kapal/pesawat bila navigasi tidak diketahui',
  docId: 'appendix-j',
  page: 1,
  colKeys: ['error'],
  columns: ['Galat posisi (NM)'],
  rows: J2_ROWS,
  rowLabelHeader: 'Jenis kapal/pesawat',
  unit: 'NM',
  stackGroups: true,
  groups: J_STACK_GROUPS,
  note: 'Galat untuk area praktis bila alat navigasi tidak diketahui. Panel juga menampilkan Table J-1 — klik baris pada salah satu tabel untuk memakai galat tersebut di worksheet.',
};

// Table J-3 — dead reckoning (DR) errors (Appendix_J.pdf hal. 1, baris teks).
const TABLE_J3: ManualTableDef = {
  id: 'J-3',
  title: 'Table J-3. Dead reckoning (DR) errors',
  docId: 'appendix-j',
  page: 1,
  colKeys: ['dre'],
  columns: ['Dead reckoning error (DRe)'],
  rows: [
    {
      key: 'ship',
      label: 'Ship, Submarine (Military)',
      cells: ['Galat fix positif terakhir + 5% jarak dari fix tersebut'],
    },
    {
      key: 'aircraft',
      label: 'Aircraft',
      cells: ['Galat fix positif terakhir + 10% jarak dari fix tersebut'],
    },
    {
      key: 'small-craft',
      label: 'Small craft, Submersibles',
      cells: ['Galat fix positif terakhir + 15% jarak dari fix tersebut'],
    },
  ],
  rowLabelHeader: 'Jenis unit',
  note: 'Ditambahkan di atas galat fix terakhir untuk navigasi dead reckoning ( Worksheet 4: DR 10% × Tr pesawat). Nilai J.1–J.3 adalah nilai minimum dan boleh dinaikkan SMC.',
};

// ---------------------------------------------------------------------------
// Table I-1/I-2 — Leeway (Appendix_I_al1.pdf) — multiplier × windspeed +
// modifier & divergence angle per kategori search target. Daftar baris SAMA
// PERSIS dengan manual: Table I-1 (hal. 3) berisi seluruh kategori (PIW,
// Maritime Life Rafts, Other Maritime Survival Craft, AVIATION LIFE RAFTS,
// Person-Powered Craft, Sailing Vessels, Power Vessels, Boating Debris) dan
// Table I-2 (hal. 4) berisi 12 baris sub-tabel deep ballast. Nilai per baris
// adalah data yang sama dengan LEEWAY_OBJECT_TYPES (didigitasi dari manual),
// jadi panel verifikasi selalu cocok dengan yang dipakai aplikasi.
// ---------------------------------------------------------------------------
/** Kategori leeway pada labelnya menunjukkan tabel sumbernya (Table I-1 / I-2)
 *  — dipakai untuk memilih halaman PDF lompatan rujukan (I-1 hal. 3, I-2 hal. 4). */
export function leewayTableGroupKey(type: { id?: string; label: string }): 'I-1' | 'I-2' {
  // Keanggotaan eksplisit sub-tabel I-2 (daftar id) — label hanya fallback.
  if (type.id) return isLeewayTableI2(type.id) ? 'I-2' : 'I-1';
  return type.label.includes('Table I-2') ? 'I-2' : 'I-1';
}

/** Baris nilai Table I-1/I-2 dari kategori aplikasi (urutan = urutan manual). */
function leewayRow(t: (typeof LEEWAY_OBJECT_TYPES)[number]): ManualTableRow {
  return {
    key: t.id,
    label: t.label,
    cells: [
      String(t.leewayRate),
      fmt(t.leewayModifier ?? 0),
      String(t.divergenceAngle),
      fmt(t.probableError),
    ],
  };
}

/** Baris judul seksi (kolom Category / Sub Categories pada Table I-1 manual). */
function leewayHeader(key: string, label: string): ManualTableRow {
  return { key, label, cells: [], header: true };
}

function leewaySection(header: { key: string; label: string }, ids: string[]): ManualTableRow[] {
  const rows = ids
    .map((id) => LEEWAY_OBJECT_TYPES.find((t) => t.id === id))
    .filter((t): t is (typeof LEEWAY_OBJECT_TYPES)[number] => !!t)
    .map(leewayRow);
  return [leewayHeader(header.key, header.label), ...rows];
}

// Seksi Table I-1 persis kolom Category / Sub Categories manual (hal. 3) —
// termasuk seksi AVIATION LIFE RAFTS (2 baris: no ballast w/canopy 4-6 person
// w/o drogue, Evac/Slide 46-person).
const I1_SECTIONS: Array<{ key: string; label: string; ids: string[] }> = [
  { key: 'sec-piw', label: 'PIW — Persons In Water', ids: ['piw-novice', 'piw-vertical-2', 'piw-sitting', 'piw-lifejacket', 'piw-scuba', 'piw-deceased'] },
  { key: 'sec-maritime-rafts', label: 'Survival Craft — Maritime Life Rafts', ids: ['raft-1520-person', 'raft-46-person', 'raft-noballast-drogue', 'raft-canopy-no-drogue', 'raft-canopy-drogue', 'dinghy-upright', 'raft-shallow-ballast-nodrogue', 'raft-shallow-ballast-drogue', 'dinghy-fibreglass', 'raft-deep-ballast'] },
  { key: 'sec-other-maritime', label: 'Survival Craft — Other Maritime Survival Craft', ids: ['life-capsule', 'uscg-sea-rescue-kit'] },
  { key: 'sec-aviation', label: 'Survival Craft — Aviation Life Rafts', ids: ['raft-aviation-46', 'raft-evac-slide'] },
  { key: 'sec-person-powered', label: 'Person-Powered Craft', ids: ['sea-kayak', 'surf-board', 'windsurfer'] },
  { key: 'sec-sailing', label: 'Sailing Vessels — Mono-hull', ids: ['sailboat', 'sailboat-fin-keel'] },
  { key: 'sec-power-skiffs', label: 'Power Vessels — Skiffs, Sport Boats & Sport Fisher', ids: ['skiff-flat-bottom', 'skiff-v-hull', 'skiff-swamped', 'sport-boat-cuddy', 'sport-fisher-center-console'] },
  { key: 'sec-power-fishing', label: 'Power Vessels — Commercial Fishing Vessels & Coastal Freighter', ids: ['small-fishing', 'fishing-sampans', 'commercial-fishing', 'fishing-longliners', 'fishing-junk', 'fishing-gill-netter', 'merchant-vessel'] },
  { key: 'sec-debris', label: 'Boating Debris', ids: ['debris-fv', 'debris-bait-box', 'debris-bait-box-light', 'debris-bait-box-full'] },
];

const I1_ROWS: ManualTableRow[] = I1_SECTIONS.flatMap((s) => leewaySection(s, s.ids));

// Table I-2 — sub-tabel maritime life rafts with deep ballast systems and
// canopies (hal. 4): 12 baris, urutan & nilai persis manual.
const I2_ROWS: ManualTableRow[] = LEEWAY_OBJECT_TYPES
  .filter((t) => isLeewayTableI2(t.id))
  .map(leewayRow);

// Gabungan lengkap (tanpa baris header) untuk tampilan tanpa groupKey.
const I1_I2_ALL_ROWS: ManualTableRow[] = [...I1_ROWS, ...I2_ROWS].filter((r) => !r.header);

const TABLE_I1: ManualTableDef = {
  id: 'I-1',
  title: 'Table I-1/I-2. Leeway speed — multiplier × windspeed + modifier & divergence angle',
  docId: 'appendix-i',
  // Halaman PDF Table I-1 pada Appendix_I_al1.pdf (verifikasi pdftotext: hal. 3;
  // cover = hal. 1, Table I-2 sub-tabel life raft deep ballast = hal. 4).
  page: 3,
  colKeys: ['multiplier', 'modifier', 'divergence', 'error'],
  columns: ['Multiplier', 'Modifier (kt)', 'Divergence (°)', 'LWe (kt)'],
  rows: I1_I2_ALL_ROWS,
  // Daftar baris mengikuti pembagian manual: grup I-1 = seluruh baris Table I-1
  // (hal. 3, dengan judul seksi per kategori), grup I-2 = 12 baris sub-tabel
  // deep ballast (hal. 4). stackGroups: panel verifikasi menampilkan KEDUA
  // tabel berjajar sehingga daftar lengkap seperti manual.
  stackGroups: true,
  groups: [
    { key: 'I-1', label: 'Table I-1 — Leeway speed and direction values for drift objects (kts)', page: 3, rows: I1_ROWS },
    { key: 'I-2', label: 'Table I-2 — Sub-table for maritime life rafts with deep ballast systems and canopies (kts)', page: 4, rows: I2_ROWS },
  ],
  unit: 'kt / °',
  note: 'Leeway speed = multiplier × kecepatan angin (ASW) + modifier; arah = downwind ± divergence. Daftar baris lengkap sesuai manual: Table I-1 per seksi kategori (PIW, Maritime Life Rafts, Other Maritime Survival Craft, Aviation Life Rafts, Person-Powered Craft, Sailing Vessels, Power Vessels, Boating Debris) + sub-tabel Table I-2 (deep ballast). Klik baris pada tabel untuk memakai kategori tersebut di Worksheet Datum / Worksheet 1.',
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
// Figure I-1 — Local Wind Current Graph (hal. 2) — referensi gambar
// ---------------------------------------------------------------------------
const FIGURE_I1: ManualTableDef = {
  id: 'FIG-I-1',
  title: 'Figure I-1. Local Wind Current Graph — arus angin & divergensi menurut lintang',
  docId: 'appendix-i',
  page: 2,
  colKeys: [],
  columns: [],
  rows: [],
  figure: true,
  note: 'Drift arus angin = 0,036 × ASW (kt). Divergensi: pita 10°N–10°S → 0°; di luarnya 30° (utara 10°N ke kanan, selatan 10°S ke kiri) — konstanta yang sama dipakai Worksheet Datum.',
};

// ---------------------------------------------------------------------------
// Registry + helper
// ---------------------------------------------------------------------------
export const MANUAL_TABLES: Record<string, ManualTableDef> = {
  'I-1': TABLE_I1,
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
  'J-3': TABLE_J3,
  'FIG-I-12': FIGURE_I12,
  'FIG-I-1': FIGURE_I1,
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

/** Nilai sel yang dirujuk (string apa adanya di tabel); undefined bila tak ketemu.
 *  Baris juga dicari di SEMUA group (mode stacked J-1/J-2: klik pada tabel
 *  satungan tetap menemukan selnya meski def induknya tabel lain). */
export function manualTableCell(
  def: ManualTableDef,
  rowKey: string | undefined,
  colKey: string | undefined,
  groupKey?: string,
): string | undefined {
  if (!rowKey || !colKey || def.figure) return undefined;
  let row = manualTableRows(def, groupKey).find((r) => r.key === rowKey);
  if (!row && def.groups) {
    row = def.groups.flatMap((g) => g.rows).find((r) => r.key === rowKey);
  }
  const colIndex = def.colKeys.indexOf(colKey);
  if (!row || colIndex < 0) return undefined;
  return row.cells[colIndex];
}
