/**
 * Penghitungan Dasar SAR — fungsi konversi & solver.
 *
 * Materi referensi:
 * "Introduction to SAR Calculation" — Ipuk Prasetyarin,
 * Diklat SARPLAN Angkatan XL, Jakarta, 26 Oktober 2026.
 *
 * Semua materi pelatihan: jarak (S), waktu (T), kecepatan (V), luasan/area (A),
 * konversi satuan, konversi zona waktu, dan rumus S·V·T / A·T·V·S.
 */

// ---------------------------------------------------------------------------
// Format angka gaya Indonesia (desimal koma, ribuan titik) — sesuai materi.
// ---------------------------------------------------------------------------

export function formatId(n: number, maxFrac = 2): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: maxFrac }).format(n);
}

// ---------------------------------------------------------------------------
// KONVERSI JARAK (S)
// ---------------------------------------------------------------------------

export type DistanceUnit = 'km' | 'm' | 'cm' | 'nm' | 'inch' | 'ft' | 'yd' | 'mil';

/** Faktor konversi ke meter (dasar). Sesuai materi: 1 Nm = 1,852 km; 1 inch = 2,54 cm; 1 yard = 0,9144 m; 1 mil ≈ 1,609 km. */
export const DISTANCE_UNITS: Record<DistanceUnit, { label: string; toMeter: number }> = {
  km: { label: 'Kilometer (km)', toMeter: 1000 },
  m: { label: 'Meter (m)', toMeter: 1 },
  cm: { label: 'Centimeter (cm)', toMeter: 0.01 },
  nm: { label: 'Mil laut (nm)', toMeter: 1852 },
  inch: { label: 'Inch', toMeter: 0.0254 },
  ft: { label: 'Feet (ft)', toMeter: 0.3048 },
  yd: { label: 'Yard (yd)', toMeter: 0.9144 },
  mil: { label: 'Mil darat (mil)', toMeter: 1609 },
};

export const DISTANCE_UNIT_ORDER: DistanceUnit[] = ['km', 'm', 'cm', 'nm', 'inch', 'ft', 'yd', 'mil'];

/** Konversi nilai jarak dari satu satuan ke semua satuan lainnya. */
export function convertDistance(value: number, from: DistanceUnit): Record<DistanceUnit, number> {
  const meters = value * DISTANCE_UNITS[from].toMeter;
  const out = {} as Record<DistanceUnit, number>;
  for (const unit of DISTANCE_UNIT_ORDER) {
    out[unit] = meters / DISTANCE_UNITS[unit].toMeter;
  }
  return out;
}

// ---------------------------------------------------------------------------
// KONVERSI WAKTU (T): desimal ↔ jam menit detik
// ---------------------------------------------------------------------------

export interface Hms {
  h: number;
  m: number;
  s: number;
}

/** Ubah jam desimal menjadi jam, menit, detik (pembulatan ke detik terdekat). */
export function decimalHoursToHms(hours: number): Hms {
  const totalSeconds = Math.round(hours * 3600);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { h, m, s };
}

/** Ubah jam, menit, detik menjadi jam desimal. */
export function hmsToDecimalHours(h: number, m: number, s: number): number {
  return h + m / 60 + s / 3600;
}

/** "2 jam 36 menit" — komponen nol di akhir tidak ditampilkan. */
export function formatDuration(hours: number): string {
  const { h, m, s } = decimalHoursToHms(hours);
  const parts: string[] = [];
  if (h > 0) parts.push(`${formatId(h)} jam`);
  if (m > 0) parts.push(`${formatId(m)} menit`);
  if (s > 0 || parts.length === 0) parts.push(`${formatId(s)} detik`);
  return parts.join(' ');
}

/** Sama seperti formatDuration, tetapi jam ≥ 24 ditampilkan sebagai hari. */
export function formatDurationDays(hours: number): string {
  if (hours < 24) return formatDuration(hours);
  const days = Math.floor(hours / 24);
  const rest = hours - days * 24;
  const { h, m, s } = decimalHoursToHms(rest);
  const parts: string[] = [`${formatId(days)} hari`];
  if (h > 0) parts.push(`${formatId(h)} jam`);
  if (m > 0) parts.push(`${formatId(m)} menit`);
  if (s > 0) parts.push(`${formatId(s)} detik`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// KONVERSI ZONA WAKTU — UTC ↔ WIB/WITA/WIT
// ---------------------------------------------------------------------------

export type TzZone = 'UTC' | 'WIB' | 'WITA' | 'WIT';

/** Offset terhadap UTC + huruf zona (alfabet fonetik NATO, sesuai materi). */
export const TIMEZONES: Record<TzZone, { offset: number; letter: string; name: string }> = {
  UTC: { offset: 0, letter: 'Z', name: 'Zulu (UTC)' },
  WIB: { offset: 7, letter: 'G', name: 'WIB — UTC+7 (Golf)' },
  WITA: { offset: 8, letter: 'H', name: 'WITA — UTC+8 (Hotel)' },
  WIT: { offset: 9, letter: 'I', name: 'WIT — UTC+9 (India)' },
};

export const TZ_ZONE_ORDER: TzZone[] = ['UTC', 'WIB', 'WITA', 'WIT'];

export interface TzResult {
  hours: number;
  /** Pergeseran hari terhadap hari sumber: -1 (sebelumnya), 0, +1 (besoknya). */
  dayShift: number;
}

/** Konversi jam (0–23, desimal diperbolehkan) dari zona `from` ke semua zona. */
export function convertTimezone(hour: number, from: TzZone): Record<TzZone, TzResult> {
  const utc = hour - TIMEZONES[from].offset;
  const out = {} as Record<TzZone, TzResult>;
  for (const zone of TZ_ZONE_ORDER) {
    const local = utc + TIMEZONES[zone].offset;
    out[zone] = { hours: ((local % 24) + 24) % 24, dayShift: Math.floor(local / 24) };
  }
  return out;
}

/** Format jam desimal menjadi "HHMM" (ganda empat digit, gaya SAR). */
export function formatHhmm(hours: number): string {
  const { h, m } = decimalHoursToHms(hours);
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// KONVERSI KECEPATAN (V): knot ↔ km/jam ↔ m/s ↔ cm/s
// ---------------------------------------------------------------------------

export type SpeedUnit = 'kts' | 'kmh' | 'ms' | 'cms';

/**
 * 1 kts = 1,852 km/jam = 51,4444 cm/s = 0,514444 m/s (sesuai materi Diklat SARPLAN Slide 36).
 * 1 m/s = 100 cm/s = 3,6 km/jam = 100 / 51,4444 ≈ 1,9438444 kts.
 * 1 cm/s = 0,036 km/jam = 1 / 51,4444 ≈ 0,019438444 kts.
 */
export const SPEED_UNITS: Record<SpeedUnit, { label: string; short: string; toKts: number }> = {
  kts: { label: 'Knot (nm/jam)', short: 'kts', toKts: 1 },
  kmh: { label: 'Kilometer/jam', short: 'km/jam', toKts: 1 / 1.852 },
  ms: { label: 'Meter/detik (m/s)', short: 'm/s', toKts: 100 / 51.4444 },
  cms: { label: 'Centimeter/detik (cm/s)', short: 'cm/s', toKts: 1 / 51.4444 },
};

export const SPEED_UNIT_ORDER: SpeedUnit[] = ['kts', 'kmh', 'ms', 'cms'];

/** Konversi kecepatan dari satu satuan ke semua satuan lainnya. */
export function convertSpeed(value: number, from: SpeedUnit): Record<SpeedUnit, number> {
  const kts = value * SPEED_UNITS[from].toKts;
  const out = {} as Record<SpeedUnit, number>;
  for (const unit of SPEED_UNIT_ORDER) {
    out[unit] = kts / SPEED_UNITS[unit].toKts;
  }
  return out;
}

/** Konversi nilai meter/detik (m/s) ke knot (nm/jam), km/jam, dan cm/s. */
export function convertMeterPerSecond(ms: number): {
  kts: number;
  kmh: number;
  cms: number;
} {
  return {
    kts: (ms * 100) / 51.4444,
    kmh: ms * 3.6,
    cms: ms * 100,
  };
}

/** Konversi nilai centimeter/detik (cm/s) ke knot (nm/jam), km/jam, dan m/s. */
export function convertCmPerSecond(cms: number): {
  kts: number;
  kmh: number;
  ms: number;
} {
  return {
    kts: cms / 51.4444,
    kmh: cms * 0.036,
    ms: cms / 100,
  };
}

// ---------------------------------------------------------------------------
// RUMUS S · V · T  (S = V × T | T = S/V | V = S/T)
// ---------------------------------------------------------------------------

export interface SvtState {
  /** Jarak dalam mil laut (nm). */
  s: number | null;
  /** Kecepatan dalam knot (kts). */
  v: number | null;
  /** Waktu dalam jam desimal. */
  t: number | null;
}

/** Lengkapi satu variabel yang kosong dari dua variabel yang diketahui. */
export function solveSvt(state: SvtState): SvtState {
  const { s, v, t } = state;
  if (s === null && v !== null && t !== null) return { s: v * t, v, t };
  if (v === null && s !== null && t !== null) return { s, v: t === 0 ? null : s / t, t };
  if (t === null && s !== null && v !== null) return { s, v, t: v === 0 ? null : s / v };
  return state;
}

// ---------------------------------------------------------------------------
// RUMUS A · T · V · S  (A = T × V × S | T = A/(V·S) | V = A/(T·S) | S = A/(T·V))
// ---------------------------------------------------------------------------

export interface AreaState {
  /** Luasan dalam mil laut persegi (nm²). */
  a: number | null;
  /** Waktu dalam jam desimal. */
  t: number | null;
  /** Kecepatan dalam knot (kts). */
  v: number | null;
  /** Track spacing dalam mil laut (nm). */
  s: number | null;
}

/** Lengkapi satu variabel yang kosong dari tiga variabel yang diketahui. */
export function solveArea(state: AreaState): AreaState {
  const { a, t, v, s } = state;
  if (a === null && t !== null && v !== null && s !== null) return { a: t * v * s, t, v, s };
  if (t === null && a !== null && v !== null && s !== null)
    return { a, t: v * s === 0 ? null : a / (v * s), v, s };
  if (v === null && a !== null && t !== null && s !== null)
    return { a, t, v: t * s === 0 ? null : a / (t * s), s };
  if (s === null && a !== null && t !== null && v !== null)
    return { a, t, v, s: t * v === 0 ? null : a / (t * v) };
  return state;
}

/** Jumlah unit pencari (pesawat/kapal): n = A / (T × V × S). */
export function calcSearchers(a: number, t: number, v: number, s: number): {
  exact: number;
  recommended: number;
} {
  const denom = t * v * s;
  if (denom === 0) return { exact: NaN, recommended: NaN };
  const exact = a / denom;
  return { exact, recommended: Math.ceil(exact) };
}

/** Persentase area yang mampu disapu: (A_disapu / A_total) × 100. */
export function sweptPercentage(swept: number, total: number): number {
  if (total === 0) return NaN;
  return (swept / total) * 100;
}
