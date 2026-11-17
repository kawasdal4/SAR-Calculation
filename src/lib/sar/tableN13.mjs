/**
 * Table N-13 & N-14 — Parachute descent data (IAMSAR Manual Vol II, 2022, Appendix N, hal. N-20).
 *
 * SUMBER RESMI untuk nilai Rate of Descent dan Glide Ratio PARACHUTE pada
 * Aeronautical Drift Worksheet (B.4 dan B.6) — sesuai Panduan Agent ADW:
 *   - Aircraft: Glide Ratio & TASg dari Soal Kasus / Flight Manual.
 *   - Parachute: Rate of Descent NILAI TABEL N-13 (bukan rumus TASg×101/gr).
 *   - DILARANG menginterpolasi atau mengarang nilai di luar tabel.
 *
 * Tabel N-13 – Parachute descent data (300 lb person, except Apollo):
 * kolom: Rate of descent at sea level (ft/min), at 7,000 feet (ft/min),
 * Glide ratio (horizontal/vertical).
 */

export const TABLE_N13_SOURCE =
  'IAMSAR Manual Vol II (2022), Appendix N, Table N-13 — Parachute descent data (300 lb person, except Apollo), hal. N-20';

export const TABLE_N14_SOURCE =
  'IAMSAR Manual Vol II (2022), Appendix N, Table N-14 — Parachute drift distance (zero glide ratio), hal. N-20';

/**
 * @typedef {Object} N13Parachute
 * @property {string} id
 * @property {string} label
 * @property {number | null} rodSeaLevelFtMin rate of descent di permukaan laut (ft/min); null bila tabel memberi rentang.
 * @property {number | null} rod7000FtMin rate of descent di 7.000 ft (ft/min); null bila tidak dicantumkan.
 * @property {[number, number] | null} rodRangeFtMin rentang ROD (baris eksperimental).
 * @property {number} glideRatio rasio glide horizontal/vertikal (0 = zero glide).
 * @property {boolean} experimental true untuk baris eksperimental (ROD berupa rentang).
 */
export const N13_PARACHUTES = [
  {
    id: 'c9-escape',
    label: '28 feet (C-9), escape',
    rodSeaLevelFtMin: 1176,
    rod7000FtMin: 1284,
    rodRangeFtMin: null,
    glideRatio: 0,
    experimental: false,
  },
  {
    id: 'c9-4slr',
    label: '28 feet (C-9), with 4 suspension line release, escape',
    rodSeaLevelFtMin: 1146,
    rod7000FtMin: 1260,
    rodRangeFtMin: null,
    glideRatio: 0.4,
    experimental: false,
  },
  {
    id: '24pt-reserve',
    label: '24 feet, paratroop reserve',
    rodSeaLevelFtMin: 1362,
    rod7000FtMin: 1494,
    rodRangeFtMin: null,
    glideRatio: 0,
    experimental: false,
  },
  {
    id: 'martin-baker',
    label: '24 feet, Martin-Baker system',
    rodSeaLevelFtMin: 1440,
    rod7000FtMin: null,
    rodRangeFtMin: null,
    glideRatio: 0,
    experimental: false,
  },
  {
    id: 't10-army',
    label: '35 feet (T-10), Army paratroop',
    rodSeaLevelFtMin: 918,
    rod7000FtMin: 1008,
    rodRangeFtMin: null,
    glideRatio: 0,
    experimental: false,
  },
  {
    id: 'halo-35',
    label: '35 feet (HALO), AF and Army special paratroop',
    rodSeaLevelFtMin: 960,
    rod7000FtMin: 1038,
    rodRangeFtMin: null,
    glideRatio: 0.35,
    experimental: false,
  },
  {
    id: 'skysail',
    label: 'Skysail (Navy), escape',
    rodSeaLevelFtMin: 1212,
    rod7000FtMin: 1320,
    rodRangeFtMin: null,
    glideRatio: 0,
    experimental: false,
  },
  {
    id: 'paracommander',
    label: 'Paracommander, AF special paratroop',
    rodSeaLevelFtMin: 1080,
    rod7000FtMin: 482,
    rodRangeFtMin: null,
    glideRatio: 1.16,
    experimental: false,
  },
  {
    id: 'parawing',
    label: 'Parawing (experimental)',
    rodSeaLevelFtMin: null,
    rod7000FtMin: null,
    rodRangeFtMin: [600, 900],
    glideRatio: 3.0,
    experimental: true,
  },
  {
    id: 'parafoil',
    label: 'Parafoil (experimental)',
    rodSeaLevelFtMin: null,
    rod7000FtMin: null,
    rodRangeFtMin: [600, 900],
    glideRatio: 3.0,
    experimental: true,
  },
  {
    id: 'parasail',
    label: 'Parasail (experimental)',
    rodSeaLevelFtMin: null,
    rod7000FtMin: null,
    rodRangeFtMin: [600, 900],
    glideRatio: 2.7,
    experimental: true,
  },
  {
    id: 'apollo-2',
    label: 'Apollo, 2 each (83 feet diameter)',
    rodSeaLevelFtMin: 2100,
    rod7000FtMin: 2232,
    rodRangeFtMin: null,
    glideRatio: 0,
    experimental: false,
  },
  {
    id: 'apollo-3',
    label: 'Apollo, 3 each (83 feet diameter; deployed at 24,000 feet)',
    rodSeaLevelFtMin: 1800,
    rod7000FtMin: 1950,
    rodRangeFtMin: null,
    glideRatio: 0,
    experimental: false,
  },
];

/** Ambil baris Table N-13 berdasarkan id; null bila tidak dikenal. */
export function getN13Parachute(id) {
  if (typeof id !== 'string') return null;
  return N13_PARACHUTES.find((p) => p.id === id) ?? null;
}

/**
 * Pilih nilai Rate of Descent dari Table N-13 TANPA interpolasi:
 * kolom yang dipilih adalah kolom ber-header paling dekat dengan ketinggian
 * pembukaan parasut (opening/bailout altitude):
 *   opening <= 3.500 ft  → kolom sea level;
 *   opening >  3.500 ft  → kolom 7.000 ft (bila ada; bila null → null).
 * Baris eksperimental (rentang 600–900) selalu null → planner harus menetapkan nilai.
 * @param {string} id id jenis parasut N-13
 * @param {number} openingAltFt ketinggian pembukaan (Altmax parasut)
 * @returns {{ rodFtMin: number | null, column: 'sea-level' | '7000ft' | 'range' | null, row: N13Parachute | null }}
 */
export function n13RateOfDescent(id, openingAltFt) {
  const row = getN13Parachute(id);
  if (!row) return { rodFtMin: null, column: null, row: null };
  if (row.experimental) return { rodFtMin: null, column: 'range', row };
  const use7000 = Number.isFinite(openingAltFt) && openingAltFt > 3500 && row.rod7000FtMin !== null;
  if (use7000) return { rodFtMin: row.rod7000FtMin, column: '7000ft', row };
  return { rodFtMin: row.rodSeaLevelFtMin, column: 'sea-level', row };
}

/**
 * Table N-14 — Parachute drift distance (zero glide ratio).
 * Jarak posisi pendaratan ke arah hilir (downwind) dari posisi pembukaan parasut,
 * dalam MIL (statute miles) — sesuai header tabel IAMSAR.
 * Baris: ketinggian pembukaan; kolom: kecepatan angin (knots).
 */
export const N14_OPENING_ALTS_FT = [30000, 20000, 14000, 10000, 8000, 6000, 4000, 2000];
export const N14_WINDS_KT = [10, 20, 30, 40, 50, 60, 70];

export const N14_DRIFT_DISTANCE_MILES = {
  30000: [3.7, 7.4, 11.1, 14.7, 18.4, 22.1, 25.8],
  20000: [2.7, 5.3, 8.0, 10.7, 13.3, 16.0, 18.7],
  14000: [1.9, 3.8, 5.7, 7.7, 9.5, 11.4, 13.3],
  10000: [1.4, 2.8, 4.2, 5.7, 7.0, 8.3, 9.7],
  8000: [1.2, 2.3, 3.5, 4.6, 5.8, 6.9, 8.1],
  6000: [0.9, 1.7, 2.6, 3.5, 4.4, 5.2, 6.1],
  4000: [0.6, 1.2, 1.8, 2.4, 3.0, 3.5, 4.1],
  2000: [0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1],
};

/**
 * Nilai Table N-14 terdekat TANPA interpolasi (baris & kolom terdekat).
 * @param {number} openingAltFt ketinggian pembukaan parasut
 * @param {number} windKts kecepatan angin (kts)
 * @returns {{ miles: number | null, altRowFt: number | null, windColKt: number | null }}
 */
export function n14DriftDistanceMiles(openingAltFt, windKts) {
  if (!Number.isFinite(openingAltFt) || !Number.isFinite(windKts)) {
    return { miles: null, altRowFt: null, windColKt: null };
  }
  const altRowFt = N14_OPENING_ALTS_FT.reduce((best, alt) =>
    Math.abs(alt - openingAltFt) < Math.abs(best - openingAltFt) ? alt : best,
  N14_OPENING_ALTS_FT[0]);
  const windColKt = N14_WINDS_KT.reduce((best, w) =>
    Math.abs(w - windKts) < Math.abs(best - windKts) ? w : best,
  N14_WINDS_KT[0]);
  const colIndex = N14_WINDS_KT.indexOf(windColKt);
  const miles = N14_DRIFT_DISTANCE_MILES[altRowFt]?.[colIndex] ?? null;
  return { miles, altRowFt, windColKt };
}
