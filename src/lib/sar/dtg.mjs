/**
 * Format Tanggal-Waktu (DTG / TW) — parser, konverter zona, dan format ulang.
 *
 * Dua format yang lazim dipakai pada soal kasus SAR/Basarnas:
 *
 * 1) FORMAT TW (Basarnas):  [TW] [Bulan][Tanggal] [Jam][Menit] [HurufZona]
 *    Contoh:  "TW 1117 1900 G"  → 17 November pukul 19.00 WIB
 *             (11 = bulan November, 17 = tanggal, 1900 = pukul 19:00, G = WIB)
 *    Varian : "1122.1600 Z"     → 22 November pukul 16.00 UTC
 *
 * 2) FORMAT DTG (militer/NATO): [Tanggal][Jam][Menit][HurufZona] [Bulan] [Tahun]
 *    Contoh:  "171847G NOV 2026" → 17 November 2026 pukul 18.47 WIB
 *             (17 = tanggal, 1847 = pukul 18:47, G = WIB, NOV = November, 2026 = tahun)
 *    Varian : "171847Z NOV 26"   → 17 November 2026 pukul 18.47 UTC
 *
 * Huruf zona (alfabet fonetik NATO):
 *    G = WIB  (UTC+7)   H = WITA (UTC+8)   I = WIT (UTC+9)   Z = UTC (Zulu)
 *
 * CATATAN PENTING: urutan angka KEDUA format BERBEDA —
 *    Format TW diawali BULAN (MMDD), Format DTG diawali TANGGAL (DD).
 */

// ---------------------------------------------------------------------------
// Konstanta referensi
// ---------------------------------------------------------------------------

export const MONTH_NAMES_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export const MONTH_SHORT_ID = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

/** Alias singkatan bulan (Indonesia + Inggris) → nomor bulan. */
const MONTH_ALIASES = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MEI: 5, MAY: 5, JUN: 6, JUL: 7,
  AGT: 8, AGU: 8, AUG: 8, SEP: 9, OKT: 10, OCT: 10, NOV: 11, DES: 12, DEC: 12,
};

export const DTG_ZONE_LETTERS = [
  { letter: 'G', zone: 'WIB', offset: 7, name: 'WIB (Waktu Indonesia Bagian Barat)' },
  { letter: 'H', zone: 'WITA', offset: 8, name: 'WITA (Waktu Indonesia Bagian Tengah)' },
  { letter: 'I', zone: 'WIT', offset: 9, name: 'WIT (Waktu Indonesia Bagian Timur)' },
  { letter: 'Z', zone: 'UTC', offset: 0, name: 'Zulu (UTC)' },
];

const ZONE_OFFSETS = { UTC: 0, WIB: 7, WITA: 8, WIT: 9 };
const ZONE_LETTER_OF = { UTC: 'Z', WIB: 'G', WITA: 'H', WIT: 'I' };

/* Indeks = nomor bulan (indeks 0 tidak dipakai); Februari ditangani daysInMonth(). */
const DAYS_IN_MONTH = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ---------------------------------------------------------------------------
// Util kecil
// ---------------------------------------------------------------------------

function daysInMonth(month, year) {
  if (month === 2) {
    const y = year ?? 2000; // 2000 kabisat → 29 hari (paling longgar)
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return leap ? 29 : 28;
  }
  return DAYS_IN_MONTH[month];
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function pad4(n) {
  return String(n).padStart(4, '0');
}

/** Huruf/kata zona ("G", "z", "WIB", "UTC") → nama zona kanonik | null. */
function resolveZone(token) {
  if (!token) return null;
  const t = token.toUpperCase().replace(/[^A-Z]/g, '');
  if (ZONE_OFFSETS[t] !== undefined && t.length > 1) return t; // WIB/WITA/WIT/UTC
  if (t === 'GMT') return 'UTC';
  if (['G', 'H', 'I', 'Z'].includes(t)) {
    return t === 'G' ? 'WIB' : t === 'H' ? 'WITA' : t === 'I' ? 'WIT' : 'UTC';
  }
  return null;
}

function buildResult(kind, raw, day, month, year, hour, minute, zone, zoneAssumed) {
  const letter = ZONE_LETTER_OF[zone];
  const jamText = `${pad2(hour)}.${pad2(minute)}`;
  const desc = [
    `${day} ${MONTH_NAMES_ID[month - 1]}`,
    year !== null ? `${year}` : '',
    `pukul ${jamText}`,
    `${zone} (huruf ${letter})`,
  ]
    .filter(Boolean)
    .join(' ');
  return {
    kind, // 'TW' | 'DTG'
    raw,
    day,
    month,
    year,
    hour,
    minute,
    zone,
    zoneLetter: letter,
    zoneAssumed,
    description: desc,
  };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * FORMAT TW (Basarnas): [TW] [Bulan][Tanggal] [Jam][Menit] [Zona]
 * Menerima: "TW 1117 1900 G", "1117 1900 G", "1122.1600 Z", "TW 11.17 19.00 G".
 */
const TW_RE =
  /^(?:TW\s+)?(\d{2})[.\s]?(\d{2})\s*[.:\-]?\s*(\d{2})[.\s]?(\d{2})\s*([A-Za-z]+)?$/;

/**
 * FORMAT DTG (militer/NATO): [Tanggal][Jam][Menit][Zona] [Bulan] [Tahun]
 * Menerima: "171847G NOV 2026", "171847Z NOV 26", "171847G NOV", "171847 G NOV 2026".
 */
const DTG_RE =
  /^(?:DTG\s+)?(\d{2})(\d{2})(\d{2})\s*([A-Za-z])?\s*,?\s*([A-Za-z]{3})\b\.?(?:\s*,?\s*(\d{4}|\d{2}))?$/;

/**
 * Parse string tanggal-waktu dalam format TW atau DTG.
 * @returns {import('./dtg.d.mts').DtgParsed | null} null bila format tidak dikenali.
 */
export function parseDtg(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();

  // --- Coba FORMAT DTG dulu (paling spesifik: ada nama bulan 3 huruf) ---
  const mDtg = text.match(DTG_RE);
  if (mDtg) {
    const [, dStr, hStr, mStr, zoneTok, monStr, yrStr] = mDtg;
    const day = parseInt(dStr, 10);
    const hour = parseInt(hStr, 10);
    const minute = parseInt(mStr, 10);
    const month = MONTH_ALIASES[monStr] ?? null;
    let year = null;
    if (yrStr) {
      const y = parseInt(yrStr, 10);
      year = yrStr.length === 2 ? 2000 + y : y;
    }
    if (month === null) return null;
    if (day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59) return null;
    if (year !== null && day > daysInMonth(month, year)) return null;

    let zone = resolveZone(zoneTok);
    const zoneAssumed = zone === null;
    if (zone === null) zone = 'WIB'; // zona tidak dicantumkan → asumsi WIB
    return buildResult('DTG', raw, day, month, year, hour, minute, zone, zoneAssumed);
  }

  // --- Coba FORMAT TW (Basarnas): [Bulan][Tanggal] [Jam][Menit] [Zona] ---
  const mTw = text.match(TW_RE);
  if (mTw) {
    const [, moStr, dStr, hStr, miStr, zoneTok] = mTw;
    const month = parseInt(moStr, 10);
    const day = parseInt(dStr, 10);
    const hour = parseInt(hStr, 10);
    const minute = parseInt(miStr, 10);
    if (month < 1 || month > 12) return null;
    if (day < 1 || day > 31) return null;
    if (hour > 23 || minute > 59) return null;
    if (day > daysInMonth(month, null)) return null;

    let zone = resolveZone(zoneTok);
    const zoneAssumed = zone === null;
    if (zone === null) zone = 'WIB'; // zona tidak dicantumkan → asumsi WIB
    return buildResult('TW', raw, day, month, null, hour, minute, zone, zoneAssumed);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Konversi zona & format ulang
// ---------------------------------------------------------------------------

/**
 * Konversi tanggal-waktu yang sudah di-parse ke KEEMPAT zona Indonesia + UTC.
 * @param {import('./dtg.d.mts').DtgParsed} p hasil parseDtg
 * @param {number} [fallbackYear=2000] tahun pembanding bila p.year null
 * @returns {import('./dtg.d.mts').DtgZoneRow[]}
 */
export function dtgToZones(p, fallbackYear = 2000) {
  const y0 = p.year ?? fallbackYear;
  const baseUtcMs =
    Date.UTC(y0, p.month - 1, p.day, p.hour, p.minute) -
    ZONE_OFFSETS[p.zone] * 3600_000;
  const baseDayMs = Date.UTC(y0, p.month - 1, p.day);

  return DTG_ZONE_LETTERS.map(({ zone, letter }) => {
    const localMs = baseUtcMs + ZONE_OFFSETS[zone] * 3600_000;
    const d = new Date(localMs);
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const dy = d.getUTCDate();
    const hh = d.getUTCHours();
    const mi = d.getUTCMinutes();
    const dayShift = Math.round(
      (Date.UTC(y, mo - 1, dy) - baseDayMs) / 86_400_000,
    );
    return {
      zone,
      letter,
      year: y,
      month: mo,
      day: dy,
      hour: hh,
      minute: mi,
      hhmm: `${pad2(hh)}${pad2(mi)}`,
      dayShift,
      label: `${dy} ${MONTH_SHORT_ID[mo - 1]} ${y} pukul ${pad2(hh)}.${pad2(mi)}`,
    };
  });
}

/**
 * Bentuk ISO 8601 dengan offset zona, mis. "2026-11-17T18:47:00+07:00".
 * @returns {string | null} null bila tahun tidak diketahui.
 */
export function dtgToIso(p) {
  if (p.year === null) return null;
  const off = ZONE_OFFSETS[p.zone];
  const sign = off >= 0 ? '+' : '-';
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(
    p.minute,
  )}:00${sign}${pad2(Math.abs(off))}:00`;
}

/** "171847G NOV 2026" — bentuk DTG kanonik dari hasil parse. */
export function formatDtg(p) {
  const y =
    p.year !== null
      ? ` ${String(p.year).length === 2 ? 2000 + p.year : p.year}`
      : '';
  return `${pad2(p.day)}${pad2(p.hour)}${pad2(p.minute)}${ZONE_LETTER_OF[p.zone]} ${
    MONTH_SHORT_ID[p.month - 1].toUpperCase()
  }${y}`;
}
