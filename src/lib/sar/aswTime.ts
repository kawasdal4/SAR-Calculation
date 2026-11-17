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
function extractDateParts(s: string): { day: number; month: number } | null {
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

/**
 * Konversi string waktu apa pun (dari soal/AI/manual) menjadi "MMDD.HHMM".
 * Bila input tidak mencantumkan tanggal, bulan/tanggal diambil dari
 * fallbackDate (field tanggal worksheet). Mengembalikan null bila waktu
 * tidak bisa diparse atau bulan/tanggal tetap tidak diketahui.
 */
export function toBasarnasTimeFormat(input: string, fallbackDate?: string): string | null {
  const parsed = parseSarTimeToHours(input);
  if (!parsed) return null;
  const fallback = fallbackDate ? parseDateParts(fallbackDate) : null;
  return formatBasarnasTime(parsed, fallback);
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
