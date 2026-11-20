/**
 * CASE TEXT ENRICH (Fase C2) — ekstraksi DETERMINISTIK dari teks soal kasus.
 *
 * Tujuan (regresi PK-TAL Final Test XL 2026): field yang JELAS tertulis di
 * soal (glide speed, variation, heading, FL, Koordinat Lost Contact, tabel
 * angin per ketinggian, deret angin permukaan, arus laut, Datum Time, tabel
 * SRU) tidak boleh berakhir MISSING hanya karena LLM meleset/lengah membaca
 * halaman/tabel lampiran.
 *
 * ATURAN:
 * - MURNI + deterministik (teks sama → hasil sama), tanpa dependensi UI/server.
 * - HANYA mengisi field yang masih KOSONG — nilai model TIDAK pernah ditimpa.
 * - TIDAK mengarang: field hanya diisi bila pola labelnya benar-benar ditemukan
 *   di teks; setiap isian mencatat meta.fieldSources (VERIFIED + kutipan).
 * - Deret angin: tanggal entri di luar hari pertama mengikuti rollover tengah
 *   malam (jam kembali kecil) — dicatat juga sebagai meta.assumptions agar
 *   transparan di pratinjau (status DIASUMSIKAN per field).
 */

import type { SarCaseSchema } from '../sar/caseSchema';
import { parseCoordinate } from '../sar/coordFormat';
import { parseGlideRatio } from './parseCase';

// ── Primitif teks ───────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7,
  agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
  january: 1, february: 2, march: 3, may: 5, june: 6, july: 7, august: 8,
  october: 10, december: 12,
};

const MONTH_NAME_PATTERN = 'januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember|january|february|march|may|june|july|august|october|december';

/** "19 November 2026" → {day, month, year}; null bila bukan tanggal. */
function parseIndoDate(text: string): { day: number; month: number; year: number } | null {
  const match = text.match(new RegExp(`(\\d{1,2})\\s+(${MONTH_NAME_PATTERN})\\s+(\\d{4})`, 'i'));
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (day < 1 || day > 31) return null;
  return { day, month, year };
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Nama bulan Indonesia untuk nomor bulan (deterministik). */
function indoMonthName(month: number): string {
  const list = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember'];
  return capitalize(list[month - 1] ?? '');
}

// ── Token koordinat ─────────────────────────────────────────────────────────

/** Semua token koordinat DMS/desimal di potongan teks (urut kemunculan). */
export function findCoordTokens(slice: string): string[] {
  const tokens: string[] = [];
  // DMS: 06° 52′ 46″ S / 6°50,5'S / 105°15'41"E — hemisfer penutup.
  const dms = slice.match(/\d{1,3}\s*[°º][^NSEW\n.]{0,24}?[NSEW](?![A-Za-z])/gi) ?? [];
  for (const raw of dms) {
    const token = raw.trim();
    if (parseCoordinate(token, /[NSEW]/i.test(token.slice(-1)) && /[SN]/i.test(token.slice(-1)) ? 'lat' : 'lng') !== null) {
      tokens.push(token);
    }
  }
  if (tokens.length > 0) return tokens;
  // Desimal: -6.879, 105.261 (pasangan lat,lng).
  const dec = slice.match(/-\s?\d{1,2}(?:[.,]\d{1,6})?\s*[,;]\s*-?\s?\d{1,3}(?:[.,]\d{1,6})?/g) ?? [];
  for (const raw of dec) {
    const [latPart, lngPart] = raw.split(/[;,]/).map((part) => part.trim());
    const lat = parseCoordinate(latPart, 'lat');
    const lng = parseCoordinate(lngPart, 'lng');
    if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      tokens.push(`${latPart}, ${lngPart}`);
    }
  }
  return tokens;
}

function coordPairFromTokens(tokens: string[]): { lat: number; lng: number; dmsLat: string; dmsLng: string } | null {
  let lat: { value: number; raw: string } | null = null;
  let lng: { value: number; raw: string } | null = null;
  for (const token of tokens) {
    const hemi = token.slice(-1).toUpperCase();
    if ((hemi === 'N' || hemi === 'S') && !lat) {
      const value = parseCoordinate(token, 'lat');
      if (value !== null) lat = { value, raw: token };
    } else if ((hemi === 'E' || hemi === 'W') && !lng) {
      const value = parseCoordinate(token, 'lng');
      if (value !== null) lng = { value, raw: token };
    } else if (/,/.test(token) && !lat && !lng) {
      const [latPart, lngPart] = token.split(',');
      const latValue = parseCoordinate(latPart.trim(), 'lat');
      const lngValue = parseCoordinate(lngPart.trim(), 'lng');
      if (latValue !== null && lngValue !== null) {
        lat = { value: latValue, raw: latPart.trim() };
        lng = { value: lngValue, raw: lngPart.trim() };
      }
    }
  }
  if (!lat || !lng) return null;
  return { lat: lat.value, lng: lng.value, dmsLat: lat.raw, dmsLng: lng.raw };
}

// ── Hasil ekstraksi fakta ───────────────────────────────────────────────────

export interface CaseTextFact<T = unknown> {
  value: T;
  /** Kutipan pendek dari soal (bukti eksplisit). */
  source: string;
}

export interface CaseTextFacts {
  glideSpeedKts?: CaseTextFact<number>;
  glideRatio?: CaseTextFact<{ ratio: number; raw: string }>;
  variationDeg?: CaseTextFact<{ deg: number; dir: 'E' | 'W' }>;
  deviationDeg?: CaseTextFact<{ deg: number; dir: 'E' | 'W' }>;
  headingDeg?: CaseTextFact<{ deg: number; ref?: 'true' | 'magnetic' | 'compass' }>;
  flightLevelFt?: CaseTextFact<number>;
  altitudeFt?: CaseTextFact<number>;
  lkpCoord?: CaseTextFact<{ lat: number; lng: number; dmsLat: string; dmsLng: string }>;
  windLayers?: CaseTextFact<Array<{ altitudeFt: number; altitudeLabel?: string; windDirFrom: number; windSpeedKts: number }>>;
  surfaceWindSeries?: CaseTextFact<Array<{ obsTime: string; windDirFrom: number; windSpeedKts: number }>>;
  current?: CaseTextFact<{ dirToDeg: number; speedKts: number }>;
  datumTime?: CaseTextFact<string>;
  sruCandidates?: CaseTextFact<Array<Record<string, unknown>>>;
}

function snippet(text: string, index: number, span = 110): string {
  const start = Math.max(0, index - 10);
  return text.slice(start, Math.min(text.length, index + span)).replace(/\s+/g, ' ').trim();
}

function toNumber(raw: string): number {
  return Number(raw.replace(/\./g, '').replace(',', '.'));
}

// ── Parser per field ────────────────────────────────────────────────────────

function parseGlideSpeed(text: string): CaseTextFact<number> | undefined {
  const match = text.match(/glide\s*speed\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)/i);
  if (!match) return undefined;
  const value = toNumber(match[1]);
  if (!Number.isFinite(value) || value <= 0 || value > 500) return undefined;
  return { value, source: snippet(text, match.index ?? 0) };
}

function parseGlideRatioFact(text: string): CaseTextFact<{ ratio: number; raw: string }> | undefined {
  const match = text.match(/glide\s*(?:ratio|rasio)\s*[:=]?\s*(\d{1,3}(?:[.,]\d+)?)\s*[:：]\s*(\d{1,3}(?:[.,]\d+)?)/i);
  if (!match) return undefined;
  const raw = `${match[1]}:${match[2]}`;
  const ratio = parseGlideRatio(raw);
  if (ratio === null) return undefined;
  return { value: { ratio, raw }, source: snippet(text, match.index ?? 0) };
}

function parseDirValue(text: string, label: RegExp): CaseTextFact<{ deg: number; dir: 'E' | 'W' }> | undefined {
  const match = text.match(label);
  if (!match) return undefined;
  const deg = toNumber(match[1]);
  if (!Number.isFinite(deg) || deg < 0 || deg > 180) return undefined;
  const dir = match[2].toUpperCase() as 'E' | 'W';
  return { value: { deg, dir }, source: snippet(text, match.index ?? 0) };
}

function parseHeading(text: string): CaseTextFact<{ deg: number; ref?: 'true' | 'magnetic' | 'compass' }> | undefined {
  const match = text.match(/\bheading(?:\s+(?:adalah|sebesar|of))?[^.\n]{0,20}?(\d{1,3}(?:[.,]\d+)?)\s*[°º⁰*]?\s*\(?([MTC])?\)?/i);
  if (!match) return undefined;
  const deg = toNumber(match[1]);
  if (!Number.isFinite(deg) || deg < 0 || deg > 360) return undefined;
  const refMap: Record<string, 'true' | 'magnetic' | 'compass'> = { M: 'magnetic', T: 'true', C: 'compass' };
  const ref = match[2] ? refMap[match[2].toUpperCase()] : undefined;
  return { value: { deg, ref }, source: snippet(text, match.index ?? 0) };
}

function parseFlightLevel(text: string): CaseTextFact<number> | undefined {
  const match = text.match(/\bFL\s?(\d{2,3})\b/i);
  if (match) {
    const fl = Number(match[1]);
    if (fl >= 50 && fl <= 600) return { value: fl, source: snippet(text, match.index ?? 0) };
  }
  return undefined;
}

function parseAltitude(text: string): CaseTextFact<number> | undefined {
  const match = text.match(/\b(?:altitude|ketinggian)\b[^.\n]{0,40}?(\d{3,5})\s*(?:ft|feet)/i);
  if (!match) return undefined;
  const value = toNumber(match[1]);
  if (value < 100 || value > 60000) return undefined;
  return { value, source: snippet(text, match.index ?? 0) };
}

function parseLkpCoord(text: string): CaseTextFact<{ lat: number; lng: number; dmsLat: string; dmsLng: string }> | undefined {
  const label = text.match(/(?:koordinat\s+(?:lost\s*contact|kontak\s+terakhir|lkp)|lost\s*contact\s*(?:point|position|coord(?:inate)?)?|position\s+of\s+last\s+known|lkp\s*[:=])/i);
  if (!label || label.index === undefined) return undefined;
  const slice = text.slice(label.index, label.index + 160);
  const pair = coordPairFromTokens(findCoordTokens(slice));
  if (!pair) return undefined;
  return { value: pair, source: snippet(text, label.index, 130) };
}

function parseWindLayers(text: string): CaseTextFact<Array<{ altitudeFt: number; altitudeLabel?: string; windDirFrom: number; windSpeedKts: number }>> | undefined {
  const header = text.match(/altitude[\s\S]{0,60}?direction[\s\S]{0,60}?velocity/i);
  if (!header || header.index === undefined) return undefined;
  const block = text.slice(header.index + header[0].length, header.index + header[0].length + 1400);
  const rows: Array<{ altitudeFt: number; altitudeLabel?: string; windDirFrom: number; windSpeedKts: number }> = [];
  let misses = 0;
  for (const line of block.split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (rows.length > 0) misses += 1;
      continue;
    }
    const match = trimmed.match(/^(surface|permukaan|\d{1,5}(?:[.,]\d{3})*)(\s*(?:feet|ft))?\s+(\d{1,3})\s*[°º⁰*]?\s+(\d{1,3}(?:[.,]\d+)?)\s*$/i);
    if (!match) {
      misses += 1;
      // Baris label kolom tambahan di awal (mis. "ALTITUDE DIRECTION VELOCITY") diabaikan.
      if (rows.length > 0 && misses >= 2) break;
      continue;
    }
    misses = 0;
    const altitudeToken = /surface|permukaan/i.test(match[1])
      ? '0'
      // "12,000" gaya ribuan Inggris → "12000" (soal Indonesia jarang, tapi aman).
      : /^\d{1,3},\d{3}$/.test(match[1]) ? match[1].replace(',', '') : match[1];
    const altitudeFt = toNumber(altitudeToken);
    const altitudeLabel = `${match[1]}${match[2]?.trim() ? ` ${match[2].trim()}` : ''}`.trim();
    const dir = Number(match[3]);
    const speed = toNumber(match[4]);
    if (!Number.isFinite(altitudeFt) || !Number.isFinite(dir) || !Number.isFinite(speed)) continue;
    if (altitudeFt > 60000 || dir > 360 || speed > 200) continue;
    rows.push({ altitudeFt, altitudeLabel, windDirFrom: dir, windSpeedKts: speed });
    if (rows.length >= 15) break;
  }
  if (rows.length < 2) return undefined;
  return { value: rows, source: snippet(text, header.index, 140) };
}

function parseSurfaceWindSeries(text: string): CaseTextFact<Array<{ obsTime: string; windDirFrom: number; windSpeedKts: number }>> | undefined {
  // Pencarian tanggal dasar: "Data angin dari tanggal 18 November 2026" / "pada tanggal X".
  const baseMatch = text.match(new RegExp(`data\\s+angin[^:\\n]{0,90}?(?:dari\\s+tanggal|tanggal|per\\s+tanggal)?\\s*[:=]?\\s*(\\d{1,2}\\s+(?:${MONTH_NAME_PATTERN})\\s+\\d{4})`, 'i'));
  let base = baseMatch ? parseIndoDate(baseMatch[1]) : null;
  let seriesStart = baseMatch ? (baseMatch.index ?? 0) + baseMatch[0].length : 0;

  // Fallback: deret bernomor tanpa frasa "data angin" — cari blok "1) HH.MM D/V kts".
  const entryProbe = /\d{1,2}[.:]\d{2}\s+\d{1,3}\s*[°º⁰*]?\s*\/\s*\d+(?:[.,]\d+)?/g;
  if (!base) {
    const probe = entryProbe.exec(text);
    if (probe) {
      seriesStart = Math.max(0, probe.index - 300);
      // Tanggal terdekat SEBELUM blok deret.
      const before = text.slice(Math.max(0, probe.index - 600), probe.index);
      const dates = [...before.matchAll(new RegExp(`(\\d{1,2}\\s+(?:${MONTH_NAME_PATTERN})\\s+\\d{4})`, 'gi'))];
      base = dates.length > 0 ? parseIndoDate(dates[dates.length - 1][1]) : null;
    } else {
      return undefined;
    }
  }

  const block = text.slice(seriesStart, seriesStart + 1600);
  const entryRe = /(\d{1,2})[.:](\d{2})\s+(\d{1,3})\s*[°º⁰*]?\s*\/\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:kts|kt|knot|knots)?/gi;
  const entries: Array<{ hour: number; minute: number; dir: number; speed: number }> = [];
  for (const match of block.matchAll(entryRe)) {
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const dir = Number(match[3]);
    const speed = toNumber(match[4]);
    if (hour > 23 || minute > 59 || dir > 360 || speed > 200) continue;
    entries.push({ hour, minute, dir, speed });
    if (entries.length >= 24) break;
  }
  if (entries.length < 2) return undefined;

  const year = base?.year ?? 2026;
  const month = base?.month ?? 1;
  let day = base?.day ?? 1;
  let prevHour: number | null = null;
  let rolledOver = false;
  const series = entries.map((entry) => {
    if (prevHour !== null && entry.hour <= prevHour) {
      day += 1;
      rolledOver = true;
    }
    prevHour = entry.hour;
    const obsTime = `${String(day).padStart(2, '0')} ${indoMonthName(month)} ${year} ${String(entry.hour).padStart(2, '0')}.${String(entry.minute).padStart(2, '0')} WIB`;
    return { obsTime, windDirFrom: entry.dir, windSpeedKts: entry.speed };
  });
  const sourceIndex = baseMatch?.index ?? Math.max(0, seriesStart - 40);
  return {
    value: series,
    source: `${snippet(text, sourceIndex, 90)}${rolledOver ? ' (tanggal entri lanjutan mengikuti rollover tengah malam)' : ''}`,
  };
}

function parseCurrent(text: string): CaseTextFact<{ dirToDeg: number; speedKts: number }> | undefined {
  const match = text.match(/arus\s*(?:laut|air)?[^.\n]{0,90}?(\d{1,3})\s*[°º⁰*]?\s*(?:\/|at|ke)\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:knot|kts|knots)/i)
    ?? text.match(/(?:current|tidal)\s*(?:setting|stream)?[^.\n]{0,50}?(\d{1,3})\s*[°º⁰*]?\s*(?:\/|@|at)\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:knot|kts|knots)/i);
  if (!match) return undefined;
  const dirToDeg = Number(match[1]);
  const speedKts = toNumber(match[2]);
  if (!Number.isFinite(dirToDeg) || dirToDeg > 360 || !Number.isFinite(speedKts) || speedKts > 15) return undefined;
  return { value: { dirToDeg, speedKts }, source: snippet(text, match.index ?? 0) };
}

const DATUM_TIME_PHRASES: RegExp[] = [
  // Kalimat awal pencarian — kandidat TERKUAT, jam tepat menyusul frasa:
  // "Pencarian (selanjutnya/pertama) akan dimulai/dilakukan pukul …",
  // "Pencarian akan dilakukan pukul …", "Pencarian pertama dilakukan pukul …".
  /pencarian\s+(?:selanjutnya|berikutnya|lanjutan|pertama(?:\s+kali)?)?[^.\n]{0,120}?(?:dimulai|dilakukan)\s+(?:pada\s+)?pukul/i,
  // "SRU tiba di lokasi pukul …" / on-scene arrival.
  /(?:sru|unit)\s+tiba\s+di\s*(?:lokasi|onscene|lokasi\s+insiden)[^.\n]{0,60}?(?:pada\s+)?pukul/i,
  /on\s*scene\s+(?:arrival|time)[^.\n]{0,60}?(?:at|pukul)/i,
  // Fallback umum: penyebutan "(Datum Time)" — jam BISA mendahului frasa
  // ("… pukul 07.00 (Datum Time)"), jadi jendela perlu ke belakang.
  /datum\s*time/i,
];

function parseDatumTime(text: string): CaseTextFact<string> | undefined {
  for (const phrase of DATUM_TIME_PHRASES) {
    const match = phrase.exec(text);
    if (!match || match.index === undefined) continue;
    // Kalimat spesifik: cari jam TEPAT SETELAH frasa dulu — mencegah jam dari
    // kalimat sebelumnya (mis. "… pukul 05.00. SRU tiba di lokasi pukul 06.30")
    // ikut terambat. Jendela ke belakang hanya bila frasa mendahului jam.
    let window = text.slice(match.index, match.index + 260);
    let timeMatch = window.match(/pukul\s+(\d{1,2})[.:](\d{2})/i)
      ?? window.match(/\b(\d{1,2})[.:](\d{2})\s*(?:WIB|WITA|WIT|Z|UTC)?\b/i);
    if (!timeMatch) {
      window = text.slice(Math.max(0, match.index - 120), match.index + 260);
      timeMatch = window.match(/pukul\s+(\d{1,2})[.:](\d{2})/i)
        ?? window.match(/\b(\d{1,2})[.:](\d{2})\s*(?:WIB|WITA|WIT|Z|UTC)?\b/i);
    }
    if (!timeMatch) continue;
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (hour > 23 || minute > 59) continue;
    const zone = (window.match(/\b(WIB|WITA|WIT|UTC|Z)\b/i)?.[1] ?? 'WIB').toUpperCase();
    const time = `${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')} ${zone}`;
    // Tanggal bisa mendahului frasa ("… pada 19 November 2026." di kalimat
    // sebelumnya) — perluas jendela tanggal ke belakang bila di depan nihil.
    const date = parseIndoDate(window)
      ?? parseIndoDate(text.slice(Math.max(0, match.index - 120), match.index + 260));
    const value = date ? `${formatIndoDateFull(date)} ${time}` : time;
    return { value, source: snippet(text, match.index, 140) };
  }
  return undefined;
}

function formatIndoDateFull(date: { day: number; month: number; year: number }): string {
  return `${String(date.day).padStart(2, '0')} ${indoMonthName(date.month)} ${date.year}`;
}

// ── Tabel SRU (row-major, umum di soal Diklat) ──────────────────────────────

const SRU_ROW_LABELS: Array<{ key: string; test: RegExp }> = [
  { key: 'tipe', test: /^\s*tipe\b/i },
  { key: 'coord', test: /^\s*koordinat/i },
  { key: 'endurance', test: /^\s*endurance/i },
  { key: 'callsign', test: /^\s*call[\s-]*sign/i },
  { key: 'tasMax', test: /^\s*tas\s*\/?\s*speed\s*max/i },
  { key: 'tasSearch', test: /^\s*tas\s*\/?\s*speed\s*di/i },
  { key: 'visibility', test: /^\s*visibility/i },
  { key: 'wind', test: /^\s*wind\b/i },
  { key: 'observer', test: /^\s*kondisi\s*observer|^\s*observer/i },
  { key: 'taf', test: /^\s*taf\b/i },
  { key: 'frequencies', test: /^\s*radio|^\s*freq/i },
  { key: 'captain', test: /^\s*captain/i },
  { key: 'phone', test: /^\s*hp\s*satelit|^\s*hp\s*satellite|^\s*satellite|^\s*satelit/i },
  { key: 'navigation', test: /^\s*navigat/i },
];

function detectSruKinds(headerLine: string): Array<'helicopter' | 'fixed-wing' | 'vessel'> | null {
  const kinds: Array<'helicopter' | 'fixed-wing' | 'vessel'> = [];
  const tokens = headerLine.replace(/\bSRU\b/gi, ' ').split(/\s{2,}|\s+/);
  for (const token of tokens) {
    const t = token.toLowerCase();
    if (/helikopter|helicopter/.test(t)) kinds.push('helicopter');
    else if (/rescue\s*boat|kapal|vessel|patroli|boat/.test(t)) kinds.push('vessel');
    else if (/fixed[\s-]*wing|pesawat/.test(t)) kinds.push('fixed-wing');
  }
  return kinds.length >= 1 && kinds.length <= 6 ? kinds : null;
}

function parseSruTable(text: string): CaseTextFact<Array<Record<string, unknown>>> | undefined {
  // Kandidat header: SEMUA baris yang memuat "SRU" — baris narasi ("...tugas SRU
  // di lokasi...") otomatis gugur karena tidak memuat nama jenis alut.
  const headerLines = [...text.matchAll(/(^|\n)([^\n]*\bSRU\b[^\n]*)/g)];
  for (const headerMatch of headerLines) {
    if (headerMatch.index === undefined) continue;
    const parsed = parseSruTableAt(text, headerMatch.index, headerMatch[2]);
    if (parsed) return parsed;
  }
  return undefined;
}

function parseSruTableAt(text: string, headerIndex: number, headerLine: string): CaseTextFact<Array<Record<string, unknown>>> | undefined {
  const kinds = detectSruKinds(headerLine);
  if (!kinds) return undefined;
  const count = kinds.length;
  const blockLines = text.slice(headerIndex).split(/\n/).slice(1, 60);

  // Gabungkan baris fisik → baris LOGIS: label selangkangan PDF kerap terpecah
  // ("TAS / Speed di" + "area pencarian 90 kts ...", "Koordinat lokasi" +
  // "aset 6° ..."). Baris tanpa label = lanjutan baris sebelumnya.
  const logicalRows: string[] = [];
  let currentRow = '';
  for (const line of blockLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const label = SRU_ROW_LABELS.find((entry) => entry.test.test(trimmed));
    if (label) {
      if (currentRow) logicalRows.push(currentRow);
      currentRow = trimmed;
    } else {
      currentRow = currentRow ? `${currentRow} ${trimmed}` : trimmed;
    }
  }
  if (currentRow) logicalRows.push(currentRow);

  const rows = new Map<string, string>();
  for (const row of logicalRows) {
    for (const label of SRU_ROW_LABELS) {
      const match = row.match(label.test);
      if (match) {
        rows.set(label.key, row.slice(match[0].length).trim());
        break;
      }
    }
    if (rows.size >= SRU_ROW_LABELS.length) break;
  }

  const numbersOf = (raw: string | undefined, max: number): number[] => {
    if (!raw) return [];
    const values = [...raw.matchAll(/\d{1,3}(?:[.,]\d{1,3})?/g)].map((m) => toNumber(m[0]));
    return values.length === count ? values : [];
  };

  const callsignTokens = rows.get('callsign');
  if (!callsignTokens) return undefined;
  const callsigns = splitTokens(callsignTokens, count);
  if (!callsigns) return undefined;

  const sru: Array<Record<string, unknown>> = callsigns.map((callsign, index) => {
    const entry: Record<string, unknown> = { callsign, kind: kinds[index] };
    if (rows.get('tipe')) {
      const models = splitByParen(rows.get('tipe')!, count);
      if (models) {
        entry['model'] = models[index];
        if (/turbin/i.test(models[index] ?? '')) entry['engine'] = kinds[index] === 'vessel' ? undefined : 'turbine';
      }
    }
    return entry;
  });

  // Koordinat aset per kolom — token berurutan (lat,lng) atau pasangan DMS.
  const coordTokens = rows.get('coord') ? findCoordTokens(rows.get('coord')!) : [];
  const coordPairs: Array<Record<string, unknown>> = [];
  if (coordTokens.length === count * 2) {
    for (let i = 0; i < count; i += 1) {
      const pair = coordPairFromTokens([coordTokens[2 * i], coordTokens[2 * i + 1]]);
      if (pair) coordPairs.push(pair);
    }
  } else if (coordTokens.length === count) {
    for (let i = 0; i < count; i += 1) {
      const pair = coordPairFromTokens([coordTokens[i]]);
      if (pair) coordPairs.push(pair);
    }
  }
  if (coordPairs.length === count) {
    for (let i = 0; i < count; i += 1) sru[i]['coord'] = coordPairs[i];
  }

  const enduranceMatches = rows.get('endurance') ? [...(rows.get('endurance')!.matchAll(/(\d{1,3})\s*(?:jam|j\b|hours?|h\b)\s*(\d{1,2})?\s*(?:menit|min)?/gi))] : [];
  if (enduranceMatches.length === count) {
    for (let i = 0; i < count; i += 1) {
      sru[i]['enduranceHours'] = Number(enduranceMatches[i][1]);
      if (enduranceMatches[i][2]) sru[i]['enduranceMinutes'] = Number(enduranceMatches[i][2]);
    }
  }

  const tasMax = numbersOf(rows.get('tasMax'), 300);
  if (tasMax.length === count) for (let i = 0; i < count; i += 1) sru[i]['tasMaxKts'] = tasMax[i];
  const tasSearch = numbersOf(rows.get('tasSearch'), 300);
  if (tasSearch.length === count) for (let i = 0; i < count; i += 1) sru[i]['tasSearchKts'] = tasSearch[i];
  const visibility = numbersOf(rows.get('visibility'), 100);
  if (visibility.length === count) for (let i = 0; i < count; i += 1) sru[i]['visibilityKm'] = visibility[i];

  const windRow = rows.get('wind');
  if (windRow) {
    const pairs = [...windRow.matchAll(/(\d{1,3})\s*[°º⁰*]?\s*\/\s*(\d{1,3})/g)];
    if (pairs.length === count) {
      for (let i = 0; i < count; i += 1) {
        sru[i]['windDirFrom'] = Number(pairs[i][1]);
        sru[i]['windSpeedKts'] = Number(pairs[i][2]);
      }
    }
  }

  const observerRow = rows.get('observer');
  if (observerRow) {
    const tokens = observerRow.match(/fresh|fatigue/gi);
    const expanded = uniformExpand(tokens ?? [], count);
    if (expanded) for (let i = 0; i < count; i += 1) sru[i]['observerCondition'] = expanded[i].toLowerCase();
  }
  const tafRow = rows.get('taf');
  if (tafRow) {
    const tokens = tafRow.match(/inter|continue|con\b/gi);
    const expanded = uniformExpand(tokens ?? [], count);
    if (expanded) for (let i = 0; i < count; i += 1) sru[i]['taf'] = /^[Ii]/.test(expanded[i]) ? 'Inter' : 'Continue';
  }
  const phoneRow = rows.get('phone');
  if (phoneRow) {
    const tokens = phoneRow.match(/\d{6,15}/g);
    if (tokens && tokens.length === count) for (let i = 0; i < count; i += 1) sru[i]['phoneSatellite'] = tokens[i];
  }
  const navRow = rows.get('navigation');
  if (navRow) {
    const tokens = navRow.match(/GPS|INS|Radar|GLONASS|Galileo/gi);
    const expanded = uniformExpand(tokens ?? [], count);
    if (expanded) for (let i = 0; i < count; i += 1) sru[i]['navigation'] = [expanded[i].toUpperCase()];
  }
  const freqRow = rows.get('frequencies');
  if (freqRow) {
    const tokens = freqRow.match(/\d{3}(?:\.\d)?|\bCh\.?\s?\d+\b/gi);
    if (tokens) {
      let groups: string[] | null = null;
      if (tokens.length === count) groups = tokens;
      else if (tokens.length === count + 1 && /ch/i.test(tokens[count - 1]) && /^\d/.test(tokens[count] ?? '')) {
        // Kolom terakhir memuat dua frekuensi ("Ch.16 dan 123.1").
        groups = [...tokens.slice(0, count - 1), `${tokens[count - 1]}, ${tokens[count]}`];
      }
      if (groups) for (let i = 0; i < count; i += 1) sru[i]['frequencies'] = groups[i].split(',').map((f) => f.trim());
    }
  }
  const captainRow = rows.get('captain');
  if (captainRow) {
    const names = splitTokens(captainRow, count);
    if (names) for (let i = 0; i < count; i += 1) sru[i]['captain'] = names[i];
  }

  // Minimal layak: callsign + (speed atau visibility atau coord).
  const usable = sru.filter((entry) => entry['tasSearchKts'] !== undefined || entry['visibilityKm'] !== undefined || entry['coord'] !== undefined);
  if (usable.length === 0) return undefined;
  return {
    value: sru,
    source: snippet(text, headerIndex, 120),
  };
}

/** Baris selangkangan PDF kerap kehilangan satu kolom identik ("Inter Inter"
 *  untuk 3 SRU) — bila SEMUA token SAMA dan kurang ≤1 dari `count`, ulangi
 *  nilai yang sama (kebiasaan tabel soal: kolom seragam). Selain itu null. */
function uniformExpand(tokens: string[], count: number): string[] | null {
  if (tokens.length === 0 || tokens.length > count) return null;
  const allSame = tokens.every((token) => token.toLowerCase() === tokens[0].toLowerCase());
  if (!allSame) return null;
  if (tokens.length === count || tokens.length === count - 1) {
    return Array.from({ length: count }, () => tokens[0]);
  }
  return null;
}

/** Split token baris "HR-3604 PK-ELS KN SAR Drupada" menjadi `count` nilai —
 *  token pertama..ke-(n-1) utuh, sisanya digabung ke nilai terakhir. */
function splitTokens(row: string, count: number): string[] | null {
  const tokens = row.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < count) return null;
  if (tokens.length === count) return tokens;
  // Heuristic: gabungkan sisa token ke nilai terakhir (nama/kode multi-kata).
  const result = tokens.slice(0, count - 1);
  result.push(tokens.slice(count - 1).join(' '));
  return result;
}

/** Split nilai model SRU berdasarkan penutup kurung "(Turbin)" bila jumlahnya
 *  pas; bila tidak ada kurung → null (dilewati, jangan menebak). */
function splitByParen(row: string, count: number): string[] | null {
  if (count <= 1) return [row.trim()];
  const parts = row.trim().split(/(?<=\))\s+(?=[A-Z(])/g).map((part) => part.trim()).filter(Boolean);
  return parts.length === count ? parts : null;
}

// ── Ekstraksi semua fakta ───────────────────────────────────────────────────

/** Jalankan SELURUH parser deterministik atas teks soal. */
export function extractCaseFacts(text: string): CaseTextFacts {
  const flat = (text ?? '').replace(/\r/g, '');
  const facts: CaseTextFacts = {};
  const glide = parseGlideSpeed(flat);
  if (glide) facts.glideSpeedKts = glide;
  const ratio = parseGlideRatioFact(flat);
  if (ratio) facts.glideRatio = ratio;
  const variation = parseDirValue(flat, /\bvariation\s*[:=]?\s*(\d{1,2}(?:[.,]\d+)?)\s*[°º⁰*]?\s*([EW])\b/i);
  if (variation) facts.variationDeg = variation;
  const deviation = parseDirValue(flat, /\bdeviation\s*[:=]?\s*(\d{1,2}(?:[.,]\d+)?)\s*[°º⁰*]?\s*([EW])\b/i);
  if (deviation) facts.deviationDeg = deviation;
  const heading = parseHeading(flat);
  if (heading) facts.headingDeg = heading;
  const flightLevel = parseFlightLevel(flat);
  if (flightLevel) facts.flightLevelFt = flightLevel;
  const altitude = parseAltitude(flat);
  if (altitude) facts.altitudeFt = altitude;
  const lkp = parseLkpCoord(flat);
  if (lkp) facts.lkpCoord = lkp;
  const windLayers = parseWindLayers(flat);
  if (windLayers) facts.windLayers = windLayers;
  const series = parseSurfaceWindSeries(flat);
  if (series) facts.surfaceWindSeries = series;
  const current = parseCurrent(flat);
  if (current) facts.current = current;
  const datumTime = parseDatumTime(flat);
  if (datumTime) facts.datumTime = datumTime;
  const sru = parseSruTable(flat);
  if (sru) facts.sruCandidates = sru;
  return facts;
}

// ── Enrichment kasus ────────────────────────────────────────────────────────

export interface CaseEnrichResult {
  /** Kasus baru (clone) dengan field kosong yang berhasil diisi dari teks. */
  case: SarCaseSchema;
  /** Daftar field yang terisi oleh pass deterministik. */
  filled: Array<{ field: string; value: string; source: string }>;
}

/** Tipe satu entri SRU (array optional — akses [number] perlu NonNullable). */
type SruEntry = NonNullable<SarCaseSchema['sru']>[number];

/** Isi field kasus yang masih kosong dari fakta teks soal — TANPA menimpa
 *  nilai model. Setiap isian dicatat ke meta.fieldSources (VERIFIED). */
export function enrichCaseFromSourceText(sarCase: SarCaseSchema, sourceText: string): CaseEnrichResult {
  const facts = extractCaseFacts(sourceText);
  const working = JSON.parse(JSON.stringify(sarCase)) as SarCaseSchema;
  const filled: CaseEnrichResult['filled'] = [];
  const sources = [...(working.meta?.fieldSources ?? [])];
  const assumptions = [...(working.meta?.assumptions ?? [])];

  const record = (field: string, value: string, source: string): void => {
    filled.push({ field, value, source });
    sources.push({ field, source: `Ekstraksi deterministik teks soal: ${source}`, status: 'VERIFIED' });
  };

  // ADW
  const aero = { ...(working.aeroDrift ?? {}) };
  let aeroChanged = false;
  if (facts.glideSpeedKts && aero.glideSpeedKts === undefined) {
    aero.glideSpeedKts = facts.glideSpeedKts.value;
    record('aeroDrift.glideSpeedKts', String(facts.glideSpeedKts.value), facts.glideSpeedKts.source);
    aeroChanged = true;
  }
  if (facts.glideRatio && aero.glideRatio === undefined) {
    aero.glideRatio = facts.glideRatio.value.ratio;
    aero.glideRatioRaw = facts.glideRatio.value.raw;
    record('aeroDrift.glideRatio', facts.glideRatio.value.raw, facts.glideRatio.source);
    aeroChanged = true;
  }
  if (facts.variationDeg && aero.variationDeg === undefined) {
    aero.variationDeg = facts.variationDeg.value.deg;
    aero.variationDirection = facts.variationDeg.value.dir;
    record('aeroDrift.variation', `${facts.variationDeg.value.deg}° ${facts.variationDeg.value.dir}`, facts.variationDeg.source);
    aeroChanged = true;
  }
  if (facts.deviationDeg && aero.deviationDeg === undefined) {
    aero.deviationDeg = facts.deviationDeg.value.deg;
    aero.deviationDirection = facts.deviationDeg.value.dir;
    record('aeroDrift.deviation', `${facts.deviationDeg.value.deg}° ${facts.deviationDeg.value.dir}`, facts.deviationDeg.source);
    aeroChanged = true;
  }
  if (facts.windLayers && (aero.windLayers === undefined || aero.windLayers.length === 0)) {
    aero.windLayers = facts.windLayers.value;
    record('aeroDrift.windLayers', `${facts.windLayers.value.length} baris`, facts.windLayers.source);
    aeroChanged = true;
  }
  if (aeroChanged) working.aeroDrift = aero;

  // Insiden
  const incident = { ...working.incident };
  let incidentChanged = false;
  if (facts.headingDeg && incident.headingDeg === undefined) {
    incident.headingDeg = facts.headingDeg.value.deg;
    if (facts.headingDeg.value.ref && incident.headingReference === undefined) incident.headingReference = facts.headingDeg.value.ref;
    record('incident.headingDeg', String(facts.headingDeg.value.deg), facts.headingDeg.source);
    incidentChanged = true;
  }
  if (facts.flightLevelFt && incident.flightLevelFt === undefined && incident.altitudeFt === undefined) {
    incident.flightLevelFt = facts.flightLevelFt.value;
    record('incident.flightLevelFt', String(facts.flightLevelFt.value), facts.flightLevelFt.source);
    incidentChanged = true;
  } else if (facts.altitudeFt && incident.altitudeFt === undefined && incident.flightLevelFt === undefined) {
    incident.altitudeFt = facts.altitudeFt.value;
    record('incident.altitudeFt', String(facts.altitudeFt.value), facts.altitudeFt.source);
    incidentChanged = true;
  }
  if (incidentChanged) working.incident = incident;

  // LKP — bentuk skema: { coord: {lat,lng,dmsLat,dmsLng}, source }.
  // Koordinat soal ("Koordinat Lost Contact") adalah TITIK AWAL drift ADW;
  // diisi juga bila model memilih lkp.source "adw-landing" — keputusan itu
  // menyangkut LKP untuk DATUM (posisi ditching), bukan input drift.
  if (facts.lkpCoord && !working.lkp?.coord) {
    working.lkp = {
      ...(working.lkp ?? {}),
      coord: {
        lat: facts.lkpCoord.value.lat,
        lng: facts.lkpCoord.value.lng,
        dmsLat: facts.lkpCoord.value.dmsLat,
        dmsLng: facts.lkpCoord.value.dmsLng,
      },
      source: 'explicit',
    } as SarCaseSchema['lkp'];
    record(
      'lkp.coord',
      `${facts.lkpCoord.value.dmsLat} – ${facts.lkpCoord.value.dmsLng}`,
      facts.lkpCoord.source,
    );
  }

  // Laut
  const sea = { ...(working.sea ?? {}) };
  let seaChanged = false;
  if (facts.current && sea.current === undefined) {
    sea.current = facts.current.value;
    record('sea.current', `${facts.current.value.dirToDeg}° / ${facts.current.value.speedKts} kts`, facts.current.source);
    seaChanged = true;
  }
  if (facts.surfaceWindSeries && (sea.surfaceWindSeries === undefined || sea.surfaceWindSeries.length === 0)) {
    sea.surfaceWindSeries = facts.surfaceWindSeries.value;
    record('sea.surfaceWindSeries', `${facts.surfaceWindSeries.value.length} entri`, facts.surfaceWindSeries.source);
    assumptions.push({
      field: 'sea.surfaceWindSeries',
      value: 'tanggal entri mengikuti rollover tengah malam deret soal',
      reason: 'Tanggal entri deret angin setelah jam kembali kecil (rollover 00.00) diturunkan dari tanggal dasar "Data angin dari tanggal ..." — verifikasi bila soal memakai tanggal berbeda.',
    });
    seaChanged = true;
  }
  if (seaChanged) working.sea = sea;

  // Pencarian
  if (facts.datumTime && !working.search?.datumTime) {
    working.search = { ...(working.search ?? {}), datumTime: facts.datumTime.value };
    record('search.datumTime', facts.datumTime.value, facts.datumTime.source);
  }

  // SRU — isi entry baru/kurang tanpa menimpa nilai model.
  if (facts.sruCandidates && facts.sruCandidates.value.length > 0) {
    const existing = [...(working.sru ?? [])];
    let added = 0;
    for (const candidate of facts.sruCandidates.value) {
      const callsign = String(candidate['callsign'] ?? '').trim();
      if (!callsign) continue;
      const index = existing.findIndex((entry) => entry.callsign.trim().toLowerCase() === callsign.toLowerCase());
      if (index === -1) {
        // Tambah hanya bila ada bukti kuat (speed/visibility/coord) — sudah difilter parser.
        existing.push(candidate as SruEntry);
        added += 1;
      } else {
        const merged = { ...existing[index] } as Record<string, unknown>;
        for (const [key, value] of Object.entries(candidate)) {
          if (key === 'callsign' || key === 'kind') continue;
          if (merged[key] === undefined && value !== undefined && value !== null) merged[key] = value;
        }
        existing[index] = merged as SruEntry;
      }
    }
    working.sru = existing;
    if (added > 0) {
      record('sru', `${facts.sruCandidates.value.length} SRU`, facts.sruCandidates.source);
    }
  }

  if (filled.length > 0) {
    working.meta = { ...working.meta, fieldSources: sources, assumptions };
  }
  return { case: working, filled };
}
