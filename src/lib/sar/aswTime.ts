/**
 * Parser waktu & generator baris pengamatan ASW (Appendix K-19).
 *
 * Masalah yang diperbaiki: parser lama (parseBasarnasHHMM) hanya mengenali
 * format Basarnas MMDD.HHMM ("1117.0700 Z"). Soal kasus nyata (mis. EXE
 * FAKFAK 2026) menulis waktu sebagai "07.00 UTC", "17 Nov 2026 07.00 UTC",
 * "0700Z", dll — semuanya gagal diparse → generateObservations mengembalikan
 * kosong → baris ASW dari AI assistant tetap timeObs/timeStart/timeEnd kosong
 * dan hours 0 (kolom "Time of observation" & "Time interval" kosong; kolom
 * itu read-only sehingga tidak bisa diperbaiki manual).
 *
 * Lib ini murni (tanpa dependensi React/server) supaya bisa dipakai baik di
 * page.tsx (handleApplyASW) maupun di ASWWorksheet (regenerasi ulang).
 */

import { type ASWObservation } from './sarCalculations';
import { TIMEZONES, type TzZone } from './basicCalculations';
import { dtgToZones, parseDtg } from './dtg.mjs';

export interface ParsedSarTime {
  /** Total jam: day*24 + jam + menit/60 bila ada info hari; tanpa info hari hanya jam+menit/60. */
  hours: number;
  /** true bila hari (tanggal) ikut terdeteksi dari input. */
  hasDay: boolean;
  /** Tanggal (1–31) bila terdeteksi. */
  day?: number;
  /** Bulan (1–12) bila terdeteksi. */
  month?: number;
}

export interface AswTimeRow {
  timeObs: string;
  timeStart: string;
  timeEnd: string;
  hours: number;
}

export interface SarDateParts {
  year?: number;
  month: number;
  day: number;
}

const MONTH_ALIASES: Record<string, number> = {
  JANUARI: 1, JANUARY: 1, JAN: 1,
  FEBRUARI: 2, FEBRUARY: 2, FEB: 2,
  MARET: 3, MARCH: 3, MAR: 3,
  APRIL: 4, APR: 4,
  MEI: 5, MAY: 5,
  JUNI: 6, JUNE: 6, JUN: 6,
  JULI: 7, JULY: 7, JUL: 7,
  AGUSTUS: 8, AUGUST: 8, AGT: 8, AGU: 8, AUG: 8,
  SEPTEMBER: 9, SEPT: 9, SEP: 9,
  OKTOBER: 10, OCTOBER: 10, OKT: 10, OCT: 10,
  NOVEMBER: 11, NOV: 11,
  DESEMBER: 12, DECEMBER: 12, DES: 12, DEC: 12,
};

/** Panjang bulan untuk penggulungan hari (format Basarnas tanpa tahun → Februari 28 hari). */
const MONTH_LENGTHS: Record<number, number> = {
  1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format HH.MM / HH:MM / HHMM → jam desimal; pilih kandidat berakhiran Z/UTC bila ada. */
function extractTimeOfDay(s: string): { hour: number; minute: number } | null {
  const scan = (re: RegExp, groupHour: number, groupMinute: number) => {
    const matches = [...s.matchAll(re)];
    let fallback: { hour: number; minute: number } | null = null;
    for (const m of matches) {
      const hour = parseInt(m[groupHour], 10);
      const minute = parseInt(m[groupMinute], 10);
      if (hour > 23 || minute > 59) continue;
      const candidate = { hour, minute };
      // Utamakan waktu yang jelas UTC/Z (soal sering mencantumkan WIT dulu, UTC dalam kurung).
      const after = s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 8);
      if (/^\s*(UTC|Z)/.test(after)) return candidate;
      fallback ??= candidate;
    }
    return fallback;
  };

  // "07.00", "07:00", "15.56 WIT" — pemisah titik/koma/due-dua-titik wajib agar
  // tidak menelan bagian tanggal "2026" atau kode "1117".
  const sep = scan(/(\d{1,2})[.:](\d{2})(?!\d)/g, 1, 2);
  if (sep) return sep;
  // "0700Z", "0700" — empat digit berdiri sendiri (bukan bagian angka lebih panjang).
  return scan(/(?<!\d)(\d{2})(\d{2})(?!\d)/g, 1, 2);
}

/** Deteksi tanggal+bulan: "17 NOV 2026", "18 NOVEMBER", "17/11", "17-11". */
function extractDateParts(s: string): SarDateParts | null {
  const byName = s.match(/\b(\d{1,2})\s*\.?\s*(JANUARI|FEBRUARI|MARET|APRIL|MEI|MAY|JUNI|JUNE|JULI|JULY|AGUSTUS|AUGUST|SEPTEMBER|OKTOBER|OCTOBER|NOVEMBER|DESEMBER|DECEMBER|JAN|FEB|MAR|APR|JUN|JUL|AGT|AGU|SEP|OKT|OCT|NOV|DES|DEC)\b/);
  if (byName) {
    const day = parseInt(byName[1], 10);
    const month = MONTH_ALIASES[byName[2]];
    if (day >= 1 && day <= 31 && month) return { day, month };
  }
  const numeric = s.match(/\b(\d{1,2})\s*[\/\-]\s*(\d{1,2})\b/);
  if (numeric) {
    const day = parseInt(numeric[1], 10);
    const month = parseInt(numeric[2], 10);
    // dd/mm gaya Indonesia; tolak "07.00 UTC" (bulan 0) — titik tidak termasuk pemisah di sini.
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return { day, month };
  }
  return null;
}

/**
 * Parse waktu SAR liberal. Mengenali:
 *  - Basarnas MMDD.HHMM: "1117.0700 Z", "1122 1600 Z"
 *  - Berlabel zona: "07.00 UTC", "01.00 UTC", "0700Z", "15.56 WIT"
 *  - Dengan tanggal: "17 Nov 2026 07.00 UTC", "18 November 2026 pukul 01.00 UTC", "17/11 0700"
 *  - Waktu polos: "07:00", "07.00", "0700"
 * Mengembalikan null bila tidak ada jam yang sah.
 */
export function parseSarTimeToHours(input: string): ParsedSarTime | null {
  if (!input) return null;
  const s = input.trim().toUpperCase();
  if (!s) return null;

  // 1) Basarnas MMDD.HHMM (pemisah titik/spasi antara MMDD dan HHMM; pemisah
  //    opsional agar "11170700" dari model tetap dikenali seperti parser lama).
  const basarnas = s.match(/^(\d{2})(\d{2})\s*[.\s]?\s*(\d{2})(\d{2})/);
  if (basarnas) {
    const month = parseInt(basarnas[1], 10);
    const day = parseInt(basarnas[2], 10);
    const hour = parseInt(basarnas[3], 10);
    const minute = parseInt(basarnas[4], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59) {
      return { hours: day * 24 + hour + minute / 60, hasDay: true, day, month };
    }
  }

  const timeOfDay = extractTimeOfDay(s);
  if (!timeOfDay) return null;
  const parts = extractDateParts(s);
  const base = timeOfDay.hour + timeOfDay.minute / 60;
  // Konvensi hari seragam dengan cabang Basarnas: day*24 + jam (hanya selisih
  // dan %24 yang dipakai, tapi nilai absolut harus konsisten antar format).
  return parts
    ? { hours: parts.day * 24 + base, hasDay: true, ...parts }
    : { hours: base, hasDay: false };
}

/** Jam desimal → "HH.MM" (format Basarnas pendek, dipakai di tabel ASW). */
export function formatHHMM(decimalHours: number): string {
  let h = decimalHours % 24;
  if (h < 0) h += 24;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}.${String(mm).padStart(2, '0')}`;
}

/** Jendela observasi standar BMKG/Basarnas (mode 6 jam dan 3 jam). */
export const OBS_WINDOWS_6H: { obsHour: number; startHour: number; endHour: number }[] = [
  { obsHour: 0,  startHour: 21, endHour: 3 },   // 21.00 – 03.00
  { obsHour: 6,  startHour: 3,  endHour: 9 },   // 03.00 – 09.00
  { obsHour: 12, startHour: 9,  endHour: 15 },  // 09.00 – 15.00
  { obsHour: 18, startHour: 15, endHour: 21 },  // 15.00 – 21.00
];

export const OBS_WINDOWS_3H: { obsHour: number; startHour: number; endHour: number }[] = [
  { obsHour: 0,  startHour: 22.5, endHour: 1.5 },   // 22.30 – 01.30
  { obsHour: 3,  startHour: 1.5,  endHour: 4.5 },   // 01.30 – 04.30
  { obsHour: 6,  startHour: 4.5,  endHour: 7.5 },   // 04.30 – 07.30
  { obsHour: 9,  startHour: 7.5,  endHour: 10.5 },  // 07.30 – 10.30
  { obsHour: 12, startHour: 10.5, endHour: 13.5 },  // 10.30 – 13.30
  { obsHour: 15, startHour: 13.5, endHour: 16.5 },  // 13.30 – 16.30
  { obsHour: 18, startHour: 16.5, endHour: 19.5 },  // 16.30 – 19.30
  { obsHour: 21, startHour: 19.5, endHour: 22.5 },  // 19.30 – 22.30
];

/**
 * Potong rentang distress → datum ke jendela observasi BMKG (6h atau 3h).
 * Interval pertama mulai tepat di waktu distress, interval terakhir berakhir
 * tepat di waktu datum. Bila kedua waktu tanpa info hari dan datum ≤ distress,
 * datum diasumsikan hari berikutnya (kasus soal: distress sore, datum dini hari).
 * Mengembalikan [] bila waktu tidak bisa diparse atau rentangnya tidak sah.
 */
export function generateAswObservationTimes(
  distressStr: string,
  datumStr: string,
  mode: '6h' | '3h',
): AswTimeRow[] {
  const distress = parseSarTimeToHours(distressStr);
  const datum = parseSarTimeToHours(datumStr);
  if (!distress || !datum) return [];

  let distressTotal = distress.hours;
  let datumTotal = datum.hours;
  if (!distress.hasDay && !datum.hasDay && datumTotal < distressTotal) {
    datumTotal += 24;
  }
  if (datumTotal <= distressTotal || datumTotal - distressTotal > 72) return [];

  const windows = mode === '6h' ? OBS_WINDOWS_6H : OBS_WINDOWS_3H;
  const totalSpanHours = datumTotal - distressTotal;

  const result: AswTimeRow[] = [];
  let cursor = distressTotal % 24;
  let hoursAccounted = 0;
  let safetyCounter = 0;

  while (hoursAccounted < totalSpanHours && safetyCounter < 20) {
    safetyCounter += 1;

    // Cari jendela yang memuat posisi cursor (jendela bisa melewati tengah malam).
    let foundWindow: { obsHour: number; startHour: number; endHour: number } | null = null;
    for (const w of windows) {
      const ws = w.startHour;
      const we = w.endHour;
      if (ws > we) {
        if (cursor >= ws || cursor < we) { foundWindow = w; break; }
      } else if (cursor >= ws && cursor < we) {
        foundWindow = w; break;
      }
    }

    if (!foundWindow) {
      cursor = (cursor + 0.5) % 24;
      continue;
    }

    const windowEnd = foundWindow.endHour;
    const remainingSpan = totalSpanHours - hoursAccounted;
    const intervalStart = cursor;
    let intervalHours: number;
    if (windowEnd > intervalStart) {
      intervalHours = Math.min(windowEnd - intervalStart, remainingSpan);
    } else {
      intervalHours = Math.min((24 - intervalStart) + windowEnd, remainingSpan);
    }
    const intervalEnd = (intervalStart + intervalHours) % 24;

    result.push({
      timeObs: formatHHMM(foundWindow.obsHour),
      timeStart: formatHHMM(intervalStart),
      timeEnd: formatHHMM(intervalEnd),
      hours: Math.round(intervalHours * 10) / 10,
    });

    hoursAccounted += intervalHours;
    cursor = intervalEnd;
  }

  return result;
}

/**
 * Bangun baris observasi ASW lengkap dari data kasus AI: waktu dihitung dari
 * rentang distress → datum, angin dari model di-merge per indeks. Bila waktu
 * tidak bisa diparse, fallback ke perilaku lama (baris tanpa waktu, hours 0)
 * supaya worksheet tetap mencoba regenerasi sendiri.
 */
export function buildAswObservationsFromCase(
  distressTime: string,
  datumTime: string,
  intervalMode: '6h' | '3h',
  windData?: ReadonlyArray<{ windDirFrom: number; windSpeed: number }>,
): ASWObservation[] {
  const times = generateAswObservationTimes(distressTime, datumTime, intervalMode);
  if (times.length === 0) {
    return (windData ?? []).map((w) => ({
      timeObs: '',
      timeStart: '',
      timeEnd: '',
      hours: 0,
      windDirFrom: w.windDirFrom,
      windSpeed: w.windSpeed,
    }));
  }
  return times.map((t, i) => ({
    timeObs: t.timeObs,
    timeStart: t.timeStart,
    timeEnd: t.timeEnd,
    hours: t.hours,
    windDirFrom: windData?.[i]?.windDirFrom ?? 0,
    windSpeed: windData?.[i]?.windSpeed ?? 0,
  }));
}

// ─── Konversi ke format Basarnas (MMDD.HHMM Z) ────────────────────────────
// Permintaan workflow: format tanggal/waktu apa pun yang diberikan di soal
// kasus dikonversi otomatis oleh worksheet ke format Basarnas.

/**
 * Parse tanggal dari string konteks: "2026-11-17" (ISO) atau "17 Nov 2026" /
 * "17 November 2026" (nama bulan Indonesia/Inggris). Dipakai sebagai fallback
 * bulan/tanggal bila string waktunya tidak mencantumkan tanggal.
 */
export function parseDateParts(input: string): SarDateParts | null {
  if (!input) return null;
  const s = input.trim().toUpperCase();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const year = parseInt(iso[1], 10);
    const month = parseInt(iso[2], 10);
    const day = parseInt(iso[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { year, month, day };
    return null;
  }
  const text = s.match(/^(\d{1,2})\s+([A-Z]+)\s+(\d{4})$/);
  if (text) {
    const day = parseInt(text[1], 10);
    const month = MONTH_ALIASES[text[2]];
    if (day >= 1 && day <= 31 && month) return { year: parseInt(text[3], 10), month, day };
  }
  return null;
}

/** Susun "MMDD.HHMM" dari hasil parse; bulan/tanggal kosong diisi fallback. */
export function formatBasarnasTime(
  parsed: ParsedSarTime,
  fallback?: SarDateParts | null,
): string | null {
  const month = parsed.month ?? fallback?.month;
  const day = (parsed.hasDay ? parsed.day : undefined) ?? fallback?.day;
  if (!month || !day) return null;
  const minutesOfDay = Math.round((parsed.hours % 24) * 60);
  const hh = Math.floor(minutesOfDay / 60) % 24;
  const mm = minutesOfDay % 60;
  return `${pad2(month)}${pad2(day)}.${pad2(hh)}${pad2(mm)}`;
}

// ─── Konversi zona waktu → UTC (Z) — selaras dengan tab Penghitungan Dasar ─
// Point A.1 worksheet ADW wajib ditampilkan dalam format Basarnas MMDD.HHMM
// pada zona UTC (Z). Bila soal kasus masih memakai zona lain (WIB/WITA/WIT,
// huruf zona G/H/I, atau offset "UTC+9"), konversi ke UTC dilakukan otomatis
// memakai konstanta zona + parser TW/DTG yang sama dengan tab Penghitungan
// Dasar (basicCalculations.TIMEZONES + dtg.mjs: parseDtg & dtgToZones).

export interface DetectedSourceZone {
  zone: TzZone;
  /** Offset terhadap UTC dalam jam (bisa pecahan, mis. 9,5 untuk +09:30). */
  offsetHours: number;
  /** Posisi token zona pada string uppercase. */
  index: number;
  raw: string;
}

export interface BasarnasUtcConversion {
  /** Hasil akhir format Basarnas "MMDD.HHMM" dalam UTC. */
  value: string;
  /** true bila input memakai zona non-UTC sehingga waktunya digeser. */
  converted: boolean;
  fromZone?: TzZone;
  offsetHours?: number;
  /** Teks waktu lokal sumber, mis. "15.56". */
  localTimeText?: string;
  /** Teks waktu UTC hasil, mis. "06.56". */
  utcTimeText?: string;
  /** Pergeseran tanggal UTC terhadap tanggal lokal: -1 / 0 / +1. */
  dayShift?: number;
}

const LETTER_ZONE_OF: Record<string, TzZone> = { G: 'WIB', H: 'WITA', I: 'WIT', Z: 'UTC' };

/** Parse offset numerik "±H" / "±HH" / "±HH:MM" → jam desimal bertanda. */
function parseOffsetHours(sign: string, h: string, m?: string): number {
  const value = parseInt(h, 10) + (m ? parseInt(m, 10) / 60 : 0);
  return sign === '-' ? -value : value;
}

/**
 * Deteksi token zona sumber pada string waktu: kata WIB/WITA/WIT, UTC/GMT
 * (± offset numerik opsional), huruf zona menempel 6 digit DTG ("171847G"),
 * atau HHMM + huruf zona ("1900 G", "0700Z", "1122.1600 Z"). Token terawal
 * pada string yang menang. null bila tidak ada zona dicantumkan.
 */
export function detectSourceZone(input: string): DetectedSourceZone | null {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  const found: DetectedSourceZone[] = [];

  // Kata zona Indonesia: WIB / WITA / WIT.
  for (const m of s.matchAll(/(?<![A-Z])(WIB|WITA|WIT)(?![A-Z])/g)) {
    const zone = m[1] as TzZone;
    found.push({ zone, offsetHours: TIMEZONES[zone].offset, index: m.index ?? 0, raw: m[0] });
  }
  // UTC/GMT dengan offset numerik opsional ("UTC+9", "GMT+09:30", "UTC").
  for (const m of s.matchAll(/(?<![A-Z])(UTC|GMT)(?![A-Z])\s*(?:([+\-])\s*(\d{1,2})(?::(\d{2}))?)?/g)) {
    const offsetHours = m[2] ? parseOffsetHours(m[2], m[3], m[4]) : 0;
    found.push({ zone: 'UTC', offsetHours, index: m.index ?? 0, raw: m[0].trim() });
  }
  // DTG militer tanpa spasi: "171847G" → huruf zona menempel pada 6 digit.
  for (const m of s.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{2})\s*([GHIZ])(?![A-Z])/g)) {
    const zone = LETTER_ZONE_OF[m[4]];
    found.push({ zone, offsetHours: TIMEZONES[zone].offset, index: m.index ?? 0, raw: m[4] });
  }
  // HHMM + huruf zona: "1900 G", "0700Z", "1122.1600 Z".
  for (const m of s.matchAll(/(?<!\d)(\d{2})(\d{2})\s*([GHIZ])(?![A-Z])/g)) {
    const zone = LETTER_ZONE_OF[m[3]];
    found.push({ zone, offsetHours: TIMEZONES[zone].offset, index: m.index ?? 0, raw: m[3] });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.index - b.index);
  return found[0];
}

interface TimeCandidate {
  hour: number;
  minute: number;
  start: number;
  end: number;
}

/** Semua kandidat jam:menit pada string (tanpa preferensi UTC), dengan posisi. */
function extractTimeCandidates(s: string): TimeCandidate[] {
  const out: TimeCandidate[] = [];
  const push = (m: RegExpMatchArray, gh: number, gm: number) => {
    const hour = parseInt(m[gh], 10);
    const minute = parseInt(m[gm], 10);
    if (hour > 23 || minute > 59) return;
    out.push({ hour, minute, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  };
  // "07.00", "07:00", "15.56" — pemisah titik/due-dua-titik wajib.
  for (const m of s.matchAll(/(\d{1,2})[.:](\d{2})(?!\d)/g)) push(m, 1, 2);
  // "0700", "1900" — empat digit berdiri sendiri.
  for (const m of s.matchAll(/(?<!\d)(\d{2})(\d{2})(?!\d)/g)) push(m, 1, 2);
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** true bila ada kandidat waktu yang eksplisit menyebut UTC/Z/GMT (tanpa offset) di belakangnya. */
function hasExplicitUtcTime(s: string): boolean {
  for (const c of extractTimeCandidates(s)) {
    // "UTC+9" BUKAN penanda sudah-UTC — offsetnya harus ikut dikonversi.
    if (/^\s*(?:Z(?![A-Z])|(?:UTC|GMT)(?![A-Z])\s*(?![+\-]\d))/.test(s.slice(c.end, c.end + 10))) {
      return true;
    }
  }
  return false;
}

/** Geser tanggal-waktu lokal (zona offsetHours) ke UTC, termasuk penggulungan hari/bulan. */
function shiftToUtc(
  day: number,
  month: number,
  year: number,
  hour: number,
  minute: number,
  offsetHours: number,
): { month: number; day: number; hour: number; minute: number; dayShift: number } {
  const ms = Date.UTC(year, month - 1, day, hour, minute) - Math.round(offsetHours * 60) * 60_000;
  const d = new Date(ms);
  const baseDayMs = Date.UTC(year, month - 1, day);
  const dayShift = Math.round(
    (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - baseDayMs) / 86_400_000,
  );
  return {
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    dayShift,
  };
}

/**
 * Konversi narasi dengan zona non-UTC eksplisit ("17 Nov 2026 15.56 WIT") ke
 * format Basarnas MMDD.HHMM UTC. Waktu yang dipakai = kandidat jam terdekat di
 * depan token zona. null bila tidak ada zona non-UTC, bila UTC sudah
 * dicantumkan eksplisit (pasangan lokal + UTC), atau bila tanggal tak diketahui.
 */
function convertNarrativeToUtc(input: string, fallbackDate?: string): BasarnasUtcConversion | null {
  const s = input.trim().toUpperCase();
  if (!s) return null;
  const zone = detectSourceZone(s);
  if (!zone || zone.offsetHours === 0) return null;
  if (hasExplicitUtcTime(s)) return null;
  const candidates = extractTimeCandidates(s);
  if (candidates.length === 0) return null;
  // Kandidat jam terdekat SEBELUM token zona (zona mendifinisikan jam di depannya).
  const before = candidates.filter((c) => c.end <= zone.index);
  const chosen = before.length > 0 ? before[before.length - 1] : candidates[0];
  const dateParts = extractDateParts(s) ?? (fallbackDate ? parseDateParts(fallbackDate) : null);
  if (!dateParts) return null;
  const utc = shiftToUtc(
    dateParts.day,
    dateParts.month,
    dateParts.year ?? 2000,
    chosen.hour,
    chosen.minute,
    zone.offsetHours,
  );
  return {
    value: `${pad2(utc.month)}${pad2(utc.day)}.${pad2(utc.hour)}${pad2(utc.minute)}`,
    converted: true,
    fromZone: zone.zone,
    offsetHours: zone.offsetHours,
    localTimeText: `${pad2(chosen.hour)}.${pad2(chosen.minute)}`,
    utcTimeText: `${pad2(utc.hour)}.${pad2(utc.minute)}`,
    dayShift: utc.dayShift,
  };
}

/** Jalur lama: tanpa konversi zona (input dianggap sudah UTC). */
function legacyBasarnas(input: string, fallbackDate?: string): string | null {
  const parsed = parseSarTimeToHours(input);
  if (!parsed) return null;
  const fallback = fallbackDate ? parseDateParts(fallbackDate) : null;
  return formatBasarnasTime(parsed, fallback);
}

/**
 * Konversi string waktu apa pun → format Basarnas MMDD.HHMM dalam UTC (Z)
 * beserta metadata konversi zona untuk hint UI. Aturan (urut prioritas):
 *  1) TW/DTG dengan huruf zona eksplisit (G/H/I/Z) → parser tab Penghitungan
 *     Dasar (dtg.mjs); zona non-UTC digeser ke UTC lewat dtgToZones.
 *  2) Narasi dengan zona eksplisit non-UTC (WIB/WITA/WIT, "UTC+9") → geser ke
 *     UTC; bila soal mencantumkan pasangan lokal + UTC sekaligus, nilai UTC
 *     yang dipakai (tanpa konversi ulang).
 *  3) Sudah UTC (Z/UTC/GMT) atau tanpa zona → dianggap sudah UTC (perilaku lama).
 */
export function describeBasarnasUtcConversion(
  input: string,
  fallbackDate?: string,
): BasarnasUtcConversion | null {
  if (!input || !input.trim()) return null;
  const s = input.trim().toUpperCase();

  // 1) Format TW/DTG dengan huruf zona eksplisit.
  const dtg = parseDtg(input);
  if (dtg && !dtg.zoneAssumed) {
    const utcRow = dtgToZones(dtg).find((r) => r.zone === 'UTC');
    if (utcRow) {
      return {
        value: `${pad2(utcRow.month)}${pad2(utcRow.day)}.${utcRow.hhmm}`,
        converted: dtg.zone !== 'UTC',
        fromZone: dtg.zone,
        offsetHours: TIMEZONES[dtg.zone].offset,
        localTimeText: `${pad2(dtg.hour)}.${pad2(dtg.minute)}`,
        utcTimeText: `${pad2(utcRow.hour)}.${pad2(utcRow.minute)}`,
        dayShift: utcRow.dayShift,
      };
    }
  }

  // 2) Narasi dengan zona non-UTC eksplisit → konversi otomatis.
  const narrative = convertNarrativeToUtc(s, fallbackDate);
  if (narrative) return narrative;

  // 3) Tanpa zona / sudah UTC → perilaku lama.
  const legacy = legacyBasarnas(s, fallbackDate);
  return legacy ? { value: legacy, converted: false } : null;
}

/**
 * Konversi string waktu apa pun (dari soal/AI/manual) menjadi "MMDD.HHMM"
 * dalam zona UTC (Z). Bila input memakai zona lain (WIB/WITA/WIT, huruf
 * G/H/I, "UTC±offset"), konversi ke UTC dilakukan otomatis — selaras dengan
 * tab Penghitungan Dasar. Bila input tidak mencantumkan tanggal, bulan/
 * tanggal diambil dari fallbackDate (field tanggal worksheet). Mengembalikan
 * null bila waktu tidak bisa diparse atau bulan/tanggal tetap tidak diketahui.
 */
export function toBasarnasTimeFormat(input: string, fallbackDate?: string): string | null {
  return describeBasarnasUtcConversion(input, fallbackDate)?.value ?? null;
}

/**
 * Pembulatan setengah-ke-atas ke menit utuh (aturan worksheet): pecahan ≥ 0,5
 * naik — 8.129 → 8; 8.500 → 9; 8.499 → 8. Dipakai B.13 dan waktu distress ASW.
 */
export function roundHalfUpToMinute(minutes: number): number {
  return Math.floor(minutes + 0.5);
}

/**
 * Tambah menit ke waktu Basarnas ("1117.0700" + 4 → "1117.0704"). Hari yang
 * melewati 2400 berlanjut ke tanggal berikutnya, termasuk penggulungan bulan
 * (30 Nov + 45 menit → 1 Des). Bila input tanpa tanggal, bulan/tanggal
 * diambil dari fallbackDate. Mengembalikan null bila tidak bisa diparse.
 */
export function addMinutesBasarnas(input: string, minutes: number, fallbackDate?: string): string | null {
  const parsed = parseSarTimeToHours(input);
  if (!parsed || !Number.isFinite(minutes)) return null;
  const fallback = fallbackDate ? parseDateParts(fallbackDate) : null;
  const month = parsed.month ?? fallback?.month;
  const day = (parsed.hasDay ? parsed.day : undefined) ?? fallback?.day;
  if (!month || !day) return null;

  const minutesOfDay = Math.round((parsed.hours % 24) * 60) + Math.round(minutes);
  let nextDay = day + Math.floor(minutesOfDay / 1440);
  let nextMonth = month;
  let remaining = minutesOfDay % 1440;
  // Penggulungan tanggal/bulan (tanpa tahun → Februari 28 hari, batasan terdokumentasi).
  let guard = 0;
  while (nextDay > (MONTH_LENGTHS[nextMonth] ?? 30) && guard < 24) {
    nextDay -= MONTH_LENGTHS[nextMonth] ?? 30;
    nextMonth = nextMonth === 12 ? 1 : nextMonth + 1;
    guard += 1;
  }
  return `${pad2(nextMonth)}${pad2(nextDay)}.${pad2(Math.floor(remaining / 60))}${pad2(remaining % 60)}`;
}
