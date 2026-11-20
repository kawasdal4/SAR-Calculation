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
  /** Semua waktu naratif di soal (pencarian/SRU tiba/MAYDAY/DETRESFA/dsb.) —
   *  bila ≥2, aturan pengguna: kartu pemilihan Datum Time wajib ditampilkan. */
  datumTimeCandidates?: CaseTextFact<DatumTimeCandidateFact[]>;
  sruCandidates?: CaseTextFact<Array<Record<string, unknown>>>;
  /** Tanggal di awal soal ("03/12/2024, pesawat SRX48 berangkat …") — bacaan
   *  DD/MM vs MM/DD bisa AMBIGU (lihat CaseDateFact.ambiguous). */
  caseDate?: CaseDateFact;
  /** Waktu deklarasi DETRESFA ("ATC declare DETRESFA pada pukul 1053 WIT …")
   *  — aturan pengguna: waktu kejadian untuk point A.1 worksheet ADW. */
  detresfaTime?: CaseTextFact<DetresfaTimeFact>;
}

function snippet(text: string, index: number, span = 110): string {
  const start = Math.max(0, index - 10);
  return text.slice(start, Math.min(text.length, index + span)).replace(/\s+/g, ' ').trim();
}

function toNumber(raw: string): number {
  return Number(raw.replace(/\./g, '').replace(',', '.'));
}

/** Kecepatan berlabel satuan (arus/angin, kts): "1.3" → 1.3 (titik desimal —
 *  kecepatan arus 1300 kts tidak masuk akal; soal FULL EXERCISE SRX48 menulis
 *  "Arus laut di lokasi : 25⁰ / 1.3kts" yang sebelumnya terbaca 13 kts).
 *  Titik RIBUAN hanya bila pola grup 3 digit ("1.300" → 1300); koma selalu
 *  desimal ("0,3" → 0.3). */
function toUnitSpeed(raw: string): number {
  const text = raw.trim();
  if (text.includes(',')) return Number(text.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ''));
  return Number(text);
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
  // Varian label soal: "Koordinat Lost Contact", "LKP:", dan kalimat DETRESFA
  // "ATC declare DETRESFA pada pukul 1053 WIT dengan LKP pada koordinat …"
  // (varian terakhir dulu TIDAK tertangkap sehingga koordinat LKP soal kasus
  // FULL EXERCISE SRX48 tidak pernah masuk worksheet ADW).
  const label = text.match(/(?:koordinat\s+(?:lost\s*contact|kontak\s+terakhir|lkp)|lost\s*contact\s*(?:point|position|coord(?:inate)?)?|position\s+of\s+last\s+known|lkp\s*(?:pada|di|at)\s*(?:koordinat|posisi)|lkp\s*[:=])/i);
  if (!label || label.index === undefined) return undefined;
  const slice = text.slice(label.index, label.index + 160);
  const pair = coordPairFromTokens(findCoordTokens(slice));
  if (!pair) return undefined;
  return { value: pair, source: snippet(text, label.index, 130) };
}

function parseWindLayers(text: string): CaseTextFact<Array<{ altitudeFt: number; altitudeLabel?: string; windDirFrom: number; windSpeedKts: number }>> | undefined {
  // Header tabel angin BANYAK VARIAN di soal Basarnas: "ALTITUDE DIRECTION
  // VELOCITY" (PK-TAL), "KETINGGIAN ALTITUDE / ARAH DIRECTON / KECEPATAN
  // SPEED" (FULL EXERCISE — "DIRECTON" typo + SPEED, bukan VELOCITY), dan
  // padanan Indonesia. Sebelumnya regex mentok ke direction+velocity persis
  // sehingga tabel ini TIDAK PERNAH terbaca dan bacaan salah model (nilai
  // angin karangan) dibiarkan masuk worksheet AWA tanpa jaring pengaman.
  const header = text.match(
    /(?:altitude|ketinggian)[\s\S]{0,80}?(?:direction|directon|arah|direct)[\s\S]{0,80}?(?:velocity|speed|kecepatan)/i,
  );
  const collected = collectWindLayerRows(
    header && header.index !== undefined
      ? text.slice(header.index + header[0].length, header.index + header[0].length + 1400)
      : null,
  );
  if (collected.rows.length >= 2) {
    return { value: collected.rows, source: snippet(text, header?.index ?? 0) };
  }
  // Fallback TANPA header: tabel soal kadang tanpa label kolom — bila ada
  // ≥3 baris berurutan berpola "ketinggian arah kecepatan" yang alt-nya
  // menaik, perlakukan sebagai tabel angin ketinggian.
  if (!header) {
    const loose = collectConsecutiveWindRows(text);
    if (loose.rows.length >= 3) {
      return { value: loose.rows, source: snippet(text, loose.startIndex ?? 0) };
    }
  }
  return undefined;
}

interface WindRowCollection {
  rows: Array<{ altitudeFt: number; altitudeLabel?: string; windDirFrom: number; windSpeedKts: number }>;
  startIndex?: number;
}

function collectWindLayerRows(block: string | null): WindRowCollection {
  if (!block) return { rows: [] };
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
  return { rows };
}

/** Fallback tanpa header: kumpulkan ≥3 baris berurutan berpola "ketinggian
 *  arah kecepatan" (alt menaik) langsung dari teks penuh. Baris deret waktu
 *  ("00.00 155⁰ / 12kts") otomatis gugur karena token pertamanya HH.MM. */
function collectConsecutiveWindRows(text: string): WindRowCollection {
  const rowRe = /^(surface|permukaan|\d{1,5}(?:[.,]\d{3})*)\s*(?:feet|ft)?\s+(\d{1,3})\s*[°º⁰*]?\s*\/?\s*(\d{1,3}(?:[.,]\d+)?)\s*(?:kts|kt)?\s*$/i;
  const lines = text.split(/\n/);
  let best: WindRowCollection = { rows: [] };
  let current: WindRowCollection['rows'] = [];
  let currentStart: number | undefined;
  const flush = (): void => {
    if (current.length > best.rows.length) best = { rows: current, startIndex: currentStart };
    current = [];
    currentStart = undefined;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const match = trimmed ? trimmed.match(rowRe) : null;
    if (!match) {
      flush();
      continue;
    }
    const altitudeToken = /surface|permukaan/i.test(match[1]) ? '0' : /^\d{1,3},\d{3}$/.test(match[1]) ? match[1].replace(',', '') : match[1];
    const altitudeFt = toNumber(altitudeToken);
    const dir = Number(match[2]);
    const speed = toNumber(match[3]);
    if (!Number.isFinite(altitudeFt) || !Number.isFinite(dir) || !Number.isFinite(speed)
      || altitudeFt > 60000 || dir > 360 || speed > 200) {
      flush();
      continue;
    }
    if (current.length === 0) currentStart = index;
    current.push({
      altitudeFt,
      altitudeLabel: match[1].trim(),
      windDirFrom: dir,
      windSpeedKts: speed,
    });
    if (current.length >= 15) break;
  }
  flush();
  // Alt harus menaik unik — bukti tabel ketinggian, bukan kebetulan.
  const rows = best.rows;
  const ascending = rows.every((row, i) => i === 0 || row.altitudeFt > rows[i - 1].altitudeFt);
  if (!ascending || rows.length < 3) return { rows: [] };
  return best;
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
  const speedKts = toUnitSpeed(match[2]);
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

// ── Kandidat waktu naratif (kartu pemilihan Datum Time — aturan pengguna) ───

export interface DatumTimeCandidateFact {
  /** Label mudah dibaca: makna waktu di soal + nilai, mis. "Waktu pencarian kedua — 19 November 2026 03.00 UTC". */
  label: string;
  /** Nilai waktu apa adanya (tanggal bila ketemu + jam + zona). */
  value: string;
  /** Kutipan frasa soal sumber kandidat. */
  source: string;
  /** Posisi kemunculan di teks (urut kandidat sesuai soal). */
  index: number;
}

interface DatumTimeCandidatePattern {
  label: string;
  regex: RegExp;
}

/** Frasa naratif yang menyebut waktu — kandidat Datum Time / waktu kejadian.
 *  Urutan = prioritas label (frasa spesifik menang atas catch-all). */
const DATUM_TIME_CANDIDATE_PATTERNS: DatumTimeCandidatePattern[] = [
  { label: 'Waktu pencarian', regex: /pencarian[^.\n]{0,130}?(?:dimulai|dilakukan)\s+(?:pada\s+)?(?:pukul|jam)/gi },
  { label: 'SRU/unit tiba di lokasi (onscene)', regex: /(?:sru|unit|osc|sar\s+unit)[^.\n]{0,70}?tiba[^.\n]{0,70}?(?:pukul|jam)/gi },
  { label: 'On-scene arrival (SRU tiba di lokasi)', regex: /on[\s-]*scene\s+(?:arrival|time)[^.\n]{0,60}?(?:at|pukul|jam)/gi },
  { label: 'Pencarian oleh SRU dimulai', regex: /(?:sru|unit)[^.\n]{0,90}?melaksanakan\s+pencarian[^.\n]{0,60}?(?:pukul|jam)/gi },
  { label: 'Search commenced (pencarian dimulai)', regex: /search\s+(?:commence[ds]?|started|conducted)[^.\n]{0,60}?(?:at|pukul|jam)/gi },
  { label: 'Waktu MAYDAY diterima (waktu kejadian)', regex: /(?:menerima\s+(?:panggilan\s+)?mayday|mayday\s+(?:call|diterima|dipancarkan)|panggilan\s+mayday)[^.\n]{0,90}?(?:pukul|jam)/gi },
  { label: 'Waktu MAYDAY diterima (waktu kejadian)', regex: /(?:pukul|jam)\s+\d{1,2}[.:]\d{2}[^.\n]{0,80}?mayday/gi },
  { label: 'Waktu deklarasi DETRESFA', regex: /detresfa[^.\n]{0,140}?(?:pukul|jam|at|time)/gi },
  { label: 'Waktu Kantor SAR/RCC menerima informasi', regex: /(?:kantor\s+sar|rcc|scc|sar\s+office|airport\s+authority)[^.\n]{0,100}?menerima\s+(?:informasi|laporan|pemberitahuan)[^.\n]{0,60}?(?:pukul|jam)/gi },
  { label: 'Waktu berangkat', regex: /(?:berangkat|departure|departed|take[\s-]*off|wheels[\s-]*up)[^.\n]{0,70}?(?:pukul|jam)/gi },
];

/** Kualifikasi frasa pencarian → label lebih spesifik. */
function searchPhraseQualifier(phrase: string): string | null {
  if (/kedua|second/i.test(phrase)) return 'Waktu pencarian kedua';
  if (/ketiga|third/i.test(phrase)) return 'Waktu pencarian ketiga';
  if (/pertama|first/i.test(phrase)) return 'Waktu pencarian pertama';
  if (/selanjutnya|berikutnya|lanjutan|next/i.test(phrase)) return 'Waktu pencarian selanjutnya';
  return null;
}

/** Ambil jam-menit + zona dalam jendela sekitar frasa (cari SETELAH frasa dulu,
 *  fallback ke BELAKANG frasa untuk pola "pukul 10.53 WIT ATC menyatakan …").
 *  Menangani "10.53", "10:53", dan "1053" (4 digit tanpa pemisah). */
function extractTimeNear(text: string, index: number): { hour: number; minute: number; zone?: string; value: string } | null {
  const forward = text.slice(index, index + 220);
  const around = text.slice(Math.max(0, index - 160), index + 220);
  const tryWindows: Array<[string, number]> = [[forward, index], [around, Math.max(0, index - 160)]];
  for (const [window, windowStart] of tryWindows) {
    const timeMatch = window.match(/(?:pukul|jam)\s+(\d{1,2})(?:[.:](\d{2})|(\d{2}))?\b/i);
    if (!timeMatch || timeMatch.index === undefined) continue;
    if (!timeMatch[2] && !timeMatch[3]) continue; // tanpa menit ("pukul 05") — bukan kandidat
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2] ?? timeMatch[3]);
    if (hour > 23 || minute > 59) continue;
    const zoneEnd = windowStart + timeMatch.index + timeMatch[0].length + 24;
    const zoneWindow = text.slice(windowStart + timeMatch.index + timeMatch[0].length, Math.min(text.length, Math.max(zoneEnd, windowStart + timeMatch.index + timeMatch[0].length + 4)));
    const zone = zoneWindow.match(/\b(WIB|WITA|WIT|UTC|Z)\b/i)?.[1]?.toUpperCase();
    const time = `${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')}${zone ? ` ${zone}` : ''}`;
    return { hour, minute, ...(zone ? { zone } : {}), value: time };
  }
  return null;
}

/** Tanggal terdekat di sekitar posisi teks: prioritas tanggal SESUDAH frasa
 *  (mis. "pukul 03.00 UTC pada 19 November 2026"), bila nihil tanggal TERDEKAT
 *  SEBELUM frasa (tanggal kasus di awal soal bisa berjarak beberapa baris). */
function nearestDateAround(text: string, index: number): { day: number; month: number; year: number } | null {
  const after = parseIndoDate(text.slice(index, index + 140));
  if (after) return after;
  const before = text.slice(Math.max(0, index - 400), index);
  const matches = [...before.matchAll(new RegExp(`(\\d{1,2}\\s+(?:${MONTH_NAME_PATTERN})\\s+\\d{4})`, 'gi'))];
  return matches.length > 0 ? parseIndoDate(matches[matches.length - 1][1]) : null;
}

/** Semua waktu naratif di soal (bukan tabel deret angin): frasa pencarian/SRU
 *  tiba/onscene/MAYDAY/DETRESFA/informasi/berangkat + catch-all "pukul HH.MM".
 *  Kandidat sama (jam+menit+zona sama) hanya dicatat sekali — frasa spesifik
 *  menang atas catch-all, kandidat bertanggal menang atas varian tanpa tanggal.
 *  Aturan pengguna: bila ≥2 kandidat, AI asisten WAJIB menampilkan kartu
 *  pemilihan waktu, bukan memilih sendiri. */
export function findDatumTimeCandidates(text: string): DatumTimeCandidateFact[] {
  const flat = (text ?? '').replace(/\r/g, '');
  if (!flat.trim()) return [];
  const candidates: DatumTimeCandidateFact[] = [];
  const seen = new Set<string>();

  const push = (index: number, label: string, time: { hour: number; minute: number; zone?: string; value: string }): void => {
    const date = nearestDateAround(flat, index);
    const value = `${date ? `${formatIndoDateFull(date)} ` : ''}${time.value}`;
    const timeKey = `${String(time.hour).padStart(2, '0')}.${String(time.minute).padStart(2, '0')}|${time.zone ?? ''}`.toLowerCase();
    const key = `${date ? `${date.day}-${date.month}-${date.year}|` : ''}${timeKey}`;
    if (seen.has(key)) return;
    // Varian sama (jam/zona sama) tanpa tanggal vs bertanggal: sisakan yang
    // bertanggal — label kartu lebih informatif tanpa kandidat ganda.
    if (date && seen.has(`undated|${timeKey}`)) {
      const idx = candidates.findIndex((candidate) => candidate.value.toLowerCase().endsWith(time.value.toLowerCase()));
      if (idx >= 0) {
        candidates.splice(idx, 1);
        seen.delete(`undated|${timeKey}`);
      }
    }
    if (!date && seen.has(`dated|${timeKey}`)) return;
    seen.add(key);
    seen.add(date ? `dated|${timeKey}` : `undated|${timeKey}`);
    candidates.push({ label: `${label} — ${value}`, value, source: snippet(flat, index, 130), index });
  };

  for (const pattern of DATUM_TIME_CANDIDATE_PATTERNS) {
    for (const match of flat.matchAll(pattern.regex)) {
      if (match.index === undefined) continue;
      const time = extractTimeNear(flat, match.index);
      if (!time) continue;
      const label = pattern.label === 'Waktu pencarian'
        ? (searchPhraseQualifier(match[0]) ?? 'Waktu pencarian')
        : pattern.label;
      push(match.index, label, time);
    }
  }

  // Catch-all: "pukul HH.MM (zona)" naratif lain — tabel deret angin tidak
  // memakai kata "pukul", jadi tidak ikut terambat.
  for (const match of flat.matchAll(/\b(?:pukul|jam)\s+(\d{1,2})[.:](\d{2})\b/gi)) {
    if (match.index === undefined) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    const zone = flat.slice(match.index + match[0].length, match.index + match[0].length + 20).match(/\b(WIB|WITA|WIT|UTC|Z)\b/i)?.[1]?.toUpperCase();
    const time = { hour, minute, ...(zone ? { zone } : {}), value: `${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')}${zone ? ` ${zone}` : ''}` };
    push(match.index, 'Waktu lain di soal', time);
  }
  // Catch-all 4 digit tanpa pemisah: "pukul 1050 WIT" (= 10.50) — gaya umum
  // soal kasus Basarnas.
  for (const match of flat.matchAll(/\b(?:pukul|jam)\s+(\d{2})(\d{2})\s*(WIB|WITA|WIT|UTC|Z)?\b/gi)) {
    if (match.index === undefined) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    const zone = match[3]?.toUpperCase();
    const time = { hour, minute, ...(zone ? { zone } : {}), value: `${String(hour).padStart(2, '0')}.${String(minute).padStart(2, '0')}${zone ? ` ${zone}` : ''}` };
    push(match.index, 'Waktu lain di soal', time);
  }

  return candidates.sort((a, b) => a.index - b.index);
}

/** Mode interval observasi ASW dari jarak antar baris deret angin soal:
 *  baris berjarak ~3 jam → "3h", ~6 jam → "6h". */
function inferAswIntervalMode(series?: Array<{ obsTime: string }>): { mode: '6h' | '3h'; spacingHours: number } | null {
  if (!series || series.length < 2) return null;
  const hours = series
    .map((entry) => {
      const match = entry.obsTime.match(/(\d{1,2})[.:](\d{2})\s+WIB$/i) ?? entry.obsTime.match(/\b(\d{1,2})[.:](\d{2})\b/);
      return match ? Number(match[1]) + Number(match[2]) / 60 : null;
    })
    .filter((value): value is number => value !== null);
  if (hours.length < 2) return null;
  let best: number | null = null;
  for (let i = 1; i < hours.length; i += 1) {
    const diff = hours[i] - hours[i - 1];
    if (diff > 0.01 && (best === null || diff < best)) best = diff;
  }
  if (best === null) return null;
  return best <= 3.5 ? { mode: '3h', spacingHours: Math.round(best * 10) / 10 } : { mode: '6h', spacingHours: Math.round(best * 10) / 10 };
}

/** Anchor DATUM TIME worksheet ASW (aturan pengguna): daftar kandidat waktu
 *  naratif hasil parse teks soal + perintah WAJIB menampilkan kartu pemilihan
 *  (clarify_datum_time) bila soal memuat banyak tanggal/waktu. Dipakai route
 *  /api/chat sebagai bagian "JANGKAR DETERMINISTIK". */
export function formatAswDatumTimeAnchor(facts: CaseTextFacts): string | null {
  const lines: string[] = [];
  const candidates = facts.datumTimeCandidates?.value ?? [];
  if (candidates.length >= 2) {
    lines.push(
      `SOAL MEMUAT ${candidates.length} KANDIDAT TANGGAL/WAKTU (hasil parse teks soal — ATURAN PENGGUNA):`
      + '\n' + candidates.map((candidate, i) => `${i + 1}. ${candidate.label} | value: "${candidate.value}" | kutipan: "${candidate.source}"`).join('\n')
      + '\n→ WAJIB tampilkan KARTU PEMILIHAN WAKTU: panggil tool clarify_datum_time dengan SEMUA kandidat di atas sebagai candidates (label/value/source persis seperti daftar) SEBELUM memanggil set_asw_case. JANGAN memilih sendiri dan JANGAN mengisi datumTime sebelum pengguna memilih di kartu. Kandidat datum time yang benar umumnya waktu pencarian/SRU tiba/onscene — bukan waktu MAYDAY/DETRESFA/informasi — tapi KEPUTUSAN AKHIR TETAP MILIK PENGGUNA di kartu. Bila waktu yang benar tidak ada di daftar, tetap tampilkan kartu dan minta pengguna mengisi manual. Bila kandidat tidak memuat tanggal, saat mengisi datumTime gabungkan jam terpilih dengan tanggal awal soal yang SUDAH dikonfirmasi pengguna.',
    );
  } else if (candidates.length === 1) {
    lines.push(
      `WAKTU PENCARIAN/DATUM di soal (hasil parse): ${candidates[0].label} (kutipan: "${candidates[0].source}").`
      + '\n→ Pakai PERSIS sebagai datumTime set_asw_case — jangan mengubah nilai.',
    );
  }
  if (candidates.length <= 1 && facts.datumTime && !candidates.some((candidate) => candidate.value === facts.datumTime!.value)) {
    lines.push(`DATUM TIME hasil parse frasa pencarian: "${facts.datumTime.value}" (kutipan: "${facts.datumTime.source}").`);
  }
  const interval = inferAswIntervalMode(facts.surfaceWindSeries?.value);
  if (interval) {
    lines.push(`MODE INTERVAL OBSERVASI ASW (hasil parse deret angin soal): "${interval.mode}" — baris angin berjarak ${interval.spacingHours} jam. Pakai di intervalMode set_asw_case agar Time of Observation & Time Interval worksheet terisi benar.`);
  }
  return lines.length > 0 ? lines.join('\n') : null;
}

// ── Tanggal angka berslash (DD/MM vs MM/DD) & waktu deklarasi DETRESFA ──────

export interface SlashDateReading {
  day: number;
  month: number;
  year: number;
}

export interface SlashDateFact {
  raw: string;
  index: number;
  /** Bacaan DD/MM (konvensi Indonesia): komponen pertama = tanggal. */
  dayFirst: SlashDateReading;
  /** Bacaan MM/DD (konvensi AS): komponen pertama = bulan. */
  monthFirst: SlashDateReading;
  /** true bila KEDUA bacaan berbeda dan sama-sama valid (kedua komponen ≤ 12),
   *  mis. "03/12/2024" bisa 3 Desember 2024 ATAU 12 Maret 2024. */
  ambiguous: boolean;
}

/** Semua tanggal angka berslash "03/12/2024" di teks, urut kemunculan.
 *  Tahun 2 digit → 20xx. Salah satu komponen wajib ≤ 12 (kandidat bulan). */
export function findSlashDates(text: string): SlashDateFact[] {
  const facts: SlashDateFact[] = [];
  for (const match of text.matchAll(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4}|\d{2})\b/g)) {
    const a = Number(match[1]);
    const b = Number(match[2]);
    const rawYear = Number(match[3]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1 || a > 31 || b > 31) continue;
    if (Math.min(a, b) > 12) continue; // tidak ada kandidat bulan valid
    const year = match[3].length === 2 ? 2000 + rawYear : rawYear;
    if (!Number.isFinite(year) || year < 1900 || year > 2100) continue;
    const dayFirst = { day: a, month: b, year };
    const monthFirst = { day: b, month: a, year };
    const ambiguous = a <= 12 && b <= 12 && a !== b;
    facts.push({ raw: match[0], index: match.index ?? 0, dayFirst, monthFirst, ambiguous });
  }
  return facts;
}

export interface CaseDateFact {
  raw: string;
  index: number;
  /** Bacaan terpilih: DD/MM bila ambigu (konvensi Indonesia), bacaan tunggal
   *  yang valid bila tidak ambigu (mis. "17/11/2026" jelas 17 November). */
  reading: SlashDateReading;
  ambiguous: boolean;
  /** Semua bacaan valid berlabel — bahan kartu konfirmasi ke pengguna. */
  readings: Array<SlashDateReading & { label: string }>;
}

/** Tanggal awal soal: tanggal NAMA BULAN (tidak ambigu, mis. "12 Maret 2024")
 *  atau tanggal berslash paling awal di bagian awal teks. Contoh soal kasus:
 *  "• 03/12/2024, pesawat SRX48 berangkat dari Ternate menuju Merauke …" →
 *  ambigu (bisa 3 Desember 2024 atau 12 Maret 2024). */
export function findCaseOpeningDate(text: string): CaseDateFact | null {
  const window = text.slice(0, 1200);
  const indoMatch = window.match(new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_NAME_PATTERN})\\s+(\\d{4})\\b`, 'i'));
  const slash = findSlashDates(window)[0];
  if (indoMatch && indoMatch.index !== undefined && (!slash || indoMatch.index < slash.index)) {
    const reading = parseIndoDate(indoMatch[0]);
    if (!reading) return null;
    return {
      raw: indoMatch[0],
      index: indoMatch.index,
      reading,
      ambiguous: false,
      readings: [{ ...reading, label: formatIndoDateFull(reading) }],
    };
  }
  if (slash) {
    const labeled = (reading: SlashDateReading) => ({ ...reading, label: formatIndoDateFull(reading) });
    if (slash.ambiguous) {
      return {
        raw: slash.raw,
        index: slash.index,
        reading: slash.dayFirst,
        ambiguous: true,
        readings: [labeled(slash.dayFirst), labeled(slash.monthFirst)],
      };
    }
    // Tidak ambigu: komponen > 12 adalah TANGGAL (bukan bulan).
    const reading = slash.dayFirst.month > 12 ? slash.monthFirst : slash.dayFirst;
    return {
      raw: slash.raw,
      index: slash.index,
      reading,
      ambiguous: false,
      readings: [labeled(reading)],
    };
  }
  return null;
}

export interface DetresfaTimeFact {
  hour: number;
  minute: number;
  /** Zona tertulis di soal (WIB/WITA/WIT/UTC/Z) bila ada — tanpa zona jangan dikarang. */
  zone?: string;
  raw: string;
  index: number;
  source: string;
}

const DETRESFA_TIME_PATTERNS: RegExp[] = [
  // "ATC declare DETRESFA pada pukul 1053 WIT dengan LKP …" — jam 4 digit
  // tanpa pemisah, gaya umum soal kasus Basarnas.
  /detresfa[^.\n]{0,140}?(?:pukul|at|time)\s*(\d{2})(\d{2})\s*(WIB|WITA|WIT|UTC|Z)?\b/i,
  // "declare DETRESFA pada pukul 10.53 WIT" / "10:53" — jam dengan pemisah.
  /detresfa[^.\n]{0,140}?(?:pukul|at|time)\s*(\d{1,2})\s*[.:]\s*(\d{2})\s*(WIB|WITA|WIT|UTC|Z)?\b/i,
  // Jam mendahului frasa: "pukul 10.53 WIT ATC menyatakan DETRESFA …"
  /pukul\s*(\d{1,2})\s*[.:]\s*(\d{2})\s*(WIB|WITA|WIT|UTC|Z)?\s*[^.\n]{0,60}?detresfa/i,
  /pukul\s*(\d{2})(\d{2})\s*(WIB|WITA|WIT|UTC|Z)?\s*[^.\n]{0,60}?detresfa/i,
];

/** Waktu deklarasi DETRESFA dari kalimat soal — waktu kejadian untuk point
 *  A.1 worksheet ADW (aturan pengguna). Jam "1053" tanpa pemisah = 10.53. */
export function parseDetresfaTime(text: string): DetresfaTimeFact | null {
  for (const pattern of DETRESFA_TIME_PATTERNS) {
    const match = pattern.exec(text);
    if (!match || match.index === undefined) continue;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) continue;
    const zone = match[3]?.toUpperCase();
    return {
      hour,
      minute,
      ...(zone ? { zone } : {}),
      raw: match[0],
      index: match.index,
      source: snippet(text, match.index, 130),
    };
  }
  return null;
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
  const datumTimeCandidates = findDatumTimeCandidates(flat);
  if (datumTimeCandidates.length > 0) {
    facts.datumTimeCandidates = { value: datumTimeCandidates, source: `${datumTimeCandidates.length} kandidat waktu naratif di soal` };
  }
  const caseDate = findCaseOpeningDate(flat);
  if (caseDate) facts.caseDate = caseDate;
  const detresfa = parseDetresfaTime(flat);
  if (detresfa) facts.detresfaTime = { value: detresfa, source: detresfa.source };
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
  /** Field yang nilainya DITIMPA teks soal — bacaan model salah (mis. tabel
   *  angin altitude terbaca salah oleh model sehingga worksheet AWA terisi
   *  nilai yang tidak ada di soal). Koreksi HANYA untuk field yang teksnya
   *  bisa diparse deterministik penuh, dan selalu tercatat di sini. */
  corrections: Array<{ field: string; from: string; to: string; source: string }>;
}

/** Semua nilai ketinggian BERLABEL di teks ("ketinggian 18000 feet",
 *  "altitude 12000 ft", "FL200") — bukti eksplisit untuk validasi bacaan
 *  model atas ketinggian insiden. */
function labeledAltitudeValues(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(/\b(?:altitude|ketinggian|alt)\b[^.\n]{0,40}?(\d{3,5})\s*(?:ft|feet)/gi)) {
    const value = toNumber(match[1]);
    if (Number.isFinite(value) && value >= 100 && value <= 60000) values.push(value);
  }
  for (const match of text.matchAll(/\bFL\s?(\d{2,3})\b/gi)) {
    const value = Number(match[1]);
    if (value >= 50 && value <= 600) values.push(value * 100);
  }
  return values;
}

/** Bandingkan dua set lapis angin (model vs teks) — sama bila tiap baris
 *  model terdapat padanan altitude/dir/speed di teks (toleransi ±1°/±0,5 kt
 *  untuk pembulatan) dan jumlahnya sama. */
function windLayersMatch(model: Array<{ altitudeFt: number; windDirFrom: number; windSpeedKts: number }>, deterministic: Array<{ altitudeFt: number; windDirFrom: number; windSpeedKts: number }>): boolean {
  if (model.length !== deterministic.length) return false;
  const sortedDet = [...deterministic].sort((a, b) => a.altitudeFt - b.altitudeFt);
  const sortedModel = [...model].sort((a, b) => a.altitudeFt - b.altitudeFt);
  return sortedModel.every((row, index) => {
    const reference = sortedDet[index];
    return Math.abs(row.altitudeFt - reference.altitudeFt) <= 50
      && Math.abs(row.windDirFrom - reference.windDirFrom) <= 1
      && Math.abs(row.windSpeedKts - reference.windSpeedKts) <= 0.5;
  });
}

/** Tipe satu entri SRU (array optional — akses [number] perlu NonNullable). */
type SruEntry = NonNullable<SarCaseSchema['sru']>[number];

/** Isi field kasus yang masih kosong dari fakta teks soal — TANPA menimpa
 *  nilai model, KECUALI dua pengecualian terukur yang bacaan salahnya langsung
 *  merusak worksheet (pengalaman FULL EXERCISE SRX48: tabel angin altitude
 *  terbaca salah → AWA/ADW dan seluruh hilir salah):
 *  1. `aeroDrift.windLayers` — tabel angin per ketinggian (sumber kolom
 *     "Altitude interval (A)" di worksheet AWA). Bila bacaan model TIDAK
 *     cocok dengan tabel di teks, teks soal menang.
 *  2. `incident.altitudeFt`/`flightLevelFt` — ketinggian distress/target AWA.
 *     Nilai model dipertahankan HANYA bila didukung salah satu ketinggian
 *     berlabel di teks; bila tidak, dipakai nilai dari teks.
 *  Setiap timpaan tercatat di `corrections` + meta.fieldSources (VERIFIED). */
export function enrichCaseFromSourceText(sarCase: SarCaseSchema, sourceText: string): CaseEnrichResult {
  const facts = extractCaseFacts(sourceText);
  const working = JSON.parse(JSON.stringify(sarCase)) as SarCaseSchema;
  const filled: CaseEnrichResult['filled'] = [];
  const corrections: CaseEnrichResult['corrections'] = [];
  const sources = [...(working.meta?.fieldSources ?? [])];
  const assumptions = [...(working.meta?.assumptions ?? [])];

  const record = (field: string, value: string, source: string): void => {
    filled.push({ field, value, source });
    sources.push({ field, source: `Ekstraksi deterministik teks soal: ${source}`, status: 'VERIFIED' });
  };

  const correct = (field: string, from: string, to: string, source: string): void => {
    corrections.push({ field, from, to, source });
    filled.push({ field, value: to, source });
    sources.push({ field, source: `Koreksi deterministik teks soal (nilai model "${from}" tidak didukung teks): ${source}`, status: 'VERIFIED' });
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
  if (facts.windLayers) {
    const deterministic = facts.windLayers.value;
    const model = aero.windLayers ?? [];
    if (model.length === 0) {
      aero.windLayers = deterministic;
      record('aeroDrift.windLayers', `${deterministic.length} baris`, facts.windLayers.source);
      aeroChanged = true;
    } else if (!windLayersMatch(model, deterministic)) {
      // Bacaan model TIDAK cocok dengan tabel di teks soal — teks menang.
      const format = (rows: typeof deterministic): string =>
        rows.map((row) => `${row.altitudeFt}ft ${row.windDirFrom}°/${row.windSpeedKts}kt`).join(', ');
      correct(
        'aeroDrift.windLayers',
        `${model.length} baris: ${format(model.slice(0, 4))}${model.length > 4 ? '…' : ''}`,
        `${deterministic.length} baris: ${format(deterministic.slice(0, 4))}${deterministic.length > 4 ? '…' : ''}`,
        facts.windLayers.source,
      );
      aero.windLayers = deterministic;
      aeroChanged = true;
    }
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
  // Ketinggian insiden — nilai model dipertahankan bila didukung ketinggian
  // berlabel di teks; bila tidak (bacaan salah tabel/FL), koreksi dari teks.
  const labeledAltitudes = labeledAltitudeValues(sourceText);
  const modelAltSupported = labeledAltitudes.some((value) => {
    if (incident.flightLevelFt !== undefined && Math.abs(value - incident.flightLevelFt * 100) <= 50) return true;
    if (incident.altitudeFt !== undefined && Math.abs(value - incident.altitudeFt) <= 50) return true;
    return false;
  });
  if (!modelAltSupported && (facts.flightLevelFt || facts.altitudeFt)) {
    const fact = (facts.flightLevelFt ?? facts.altitudeFt)!;
    const fromParts: string[] = [];
    if (incident.flightLevelFt !== undefined) fromParts.push(`FL${incident.flightLevelFt}`);
    if (incident.altitudeFt !== undefined) fromParts.push(`${incident.altitudeFt} ft`);
    const isFlightLevel = fact === facts.flightLevelFt;
    if (isFlightLevel) {
      incident.flightLevelFt = fact.value;
      incident.altitudeFt = undefined;
    } else {
      incident.altitudeFt = fact.value;
      incident.flightLevelFt = undefined;
    }
    correct(
      isFlightLevel ? 'incident.flightLevelFt' : 'incident.altitudeFt',
      fromParts.join(' / ') || '(kosong)',
      isFlightLevel ? `FL${fact.value}` : `${fact.value} ft`,
      fact.source,
    );
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

  // ── Tanggal & waktu kejadian A.1 (aturan pengguna: DETRESFA → A.1) ─────────
  // Kalimat "ATC declare DETRESFA pada pukul 1053 WIT dengan LKP …" → A.1 =
  // tanggal di AWAL soal + jam deklarasi DETRESFA (bukan waktu Kantor SAR
  // menerima informasi). Tanggal berslash ambigu ("03/12/2024") diisi bacaan
  // DD/MM + catatan DIASUMSIKAN: WAJIB konfirmasi tanggal ke pengguna.
  if (facts.caseDate && facts.detresfaTime) {
    const incidentTime = working.incident.lastContactTime;
    const detresfa = facts.detresfaTime.value;
    const detresfaTimeText = `${String(detresfa.hour).padStart(2, '0')}.${String(detresfa.minute).padStart(2, '0')}${detresfa.zone ? ` ${detresfa.zone}` : ''}`;
    const alreadyCorrect = typeof incidentTime === 'string' && incidentTime.includes(detresfaTimeText);
    if (incidentTime && alreadyCorrect) {
      // Nilai model sudah memakai jam DETRESFA — biarkan.
    } else {
      const reading = facts.caseDate.reading;
      const value = `${formatIndoDateFull(reading)} ${detresfaTimeText}`;
      const source = `Tanggal awal soal "${facts.caseDate.raw}" + waktu deklarasi DETRESFA: ${facts.detresfaTime.source}`;
      const previous = incidentTime ?? '(kosong)';
      working.incident.lastContactTime = value;
      filled.push({ field: 'incident.lastContactTime', value, source });
      if (facts.caseDate.ambiguous) {
        // Tanggal berslash ambigu — DD/MM dipakai SEMENTARA (konvensi
        // Indonesia); konfirmasi tanggal wajib dilakukan pengguna.
        sources.push({ field: 'incident.lastContactTime', source: `${source} (status tanggal: AMBIGU — butuh konfirmasi)`, status: 'UNVERIFIED' });
        assumptions.push({
          field: 'incident.lastContactTime',
          value,
          reason: `Tanggal "${facts.caseDate.raw}" di awal soal AMBIGU (format DD/MM vs MM/DD): bisa ${facts.caseDate.readings.map((entry) => entry.label).join(' atau ')}. Dipakai SEMENTARA bacaan DD/MM (konvensi Indonesia) — WAJIB konfirmasi tanggal ke pengguna sebelum worksheet difinalkan.`,
        });
      } else {
        sources.push({ field: 'incident.lastContactTime', source, status: 'VERIFIED' });
      }
      if (incidentTime) {
        corrections.push({
          field: 'incident.lastContactTime',
          from: previous,
          to: value,
          source,
        });
      }
    }
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
  return { case: working, filled, corrections };
}

/** Anchor deterministik untuk prompt chat AI: tabel angin per ketinggian dari
 *  teks soal (hasil parse regex, bukan bacaan visual model). Dipakai route
 *  /api/chat agar argumen set_awa_case memakai nilai soal persis. */
export function formatWindLayersAnchor(rows: Array<{ altitudeFt: number; windDirFrom: number; windSpeedKts: number }>): string {
  return rows
    .map((row) => `- ${row.altitudeFt === 0 ? 'Surface (0 ft)' : `${row.altitudeFt} ft`}: ${row.windDirFrom}°T / ${row.windSpeedKts} kts`)
    .join('\n');
}

/** Anchor argumen set_awa_case SIAP PAKAI (JSON persis): model tinggal menyalin
 *  tanpa mentransformasi label ketinggian ("Surface", "3000 FT" → altObs).
 *  Bug yang dicegah (FULL EXERCISE SRX48): isian altitude/kolom "Altitude
 *  interval (A)" worksheet AWA kosong karena baris angin tak sampai/menjadi
 *  tidak valid saat model menyalin tabel soal. */
export function formatAwaCaseDataAnchor(
  rows: Array<{ altitudeFt: number; windDirFrom: number; windSpeedKts: number }>,
  distressAltFt?: number,
): string {
  const windData = rows.map((row) => ({
    altObs: String(row.altitudeFt),
    windDirFrom: row.windDirFrom,
    windSpeed: row.windSpeedKts,
  }));
  return [
    'ARGUMEN set_awa_case SIAP PAKAI (salin PERSIS — DILARANG mengubah nilai, menambah/mengurangi baris, atau mengganti altObs dengan label lain seperti "Surface"/"3000 FT"):',
    `distressAltFt: ${typeof distressAltFt === 'number' ? distressAltFt : '<ketinggian insiden dari soal, feet>'}`,
    `windData: ${JSON.stringify(windData)}`,
    'altObs "0" = Surface. Semua baris di atas wajib masuk windData set_awa_case.',
  ].join('\n');
}

export interface IncidentDateTimeAnchorInput {
  caseDate?: CaseDateFact;
  /** Fact terbungkus dari CaseTextFacts.detresfaTime (pakai .value di dalam). */
  detresfaTime?: CaseTextFacts['detresfaTime'];
  lkpCoord?: CaseTextFacts['lkpCoord'];
}

/** Anchor tanggal/waktu kejadian A.1 ADW (aturan pengguna):
 *  - Tanggal awal soal ambigu ("03/12/2024") → WAJIB konfirmasi ke pengguna
 *    via clarify_incident_time dengan kandidat DD/MM dan MM/DD.
 *  - Kalimat DETRESFA → waktu kejadian A.1 = tanggal awal soal + jam DETRESFA.
 *  - Koordinat LKP hasil parse (varian "LKP pada koordinat …").
 *  Dipakai route /api/chat sebagai bagian "JANGKAR DETERMINISTIK". */
export function formatIncidentDateTimeAnchor(input: IncidentDateTimeAnchorInput): string | null {
  const lines: string[] = [];
  if (input.caseDate) {
    if (input.caseDate.ambiguous) {
      const [first, second] = input.caseDate.readings;
      lines.push(
        `TANGGAL AWAL SOAL "${input.caseDate.raw}" AMBIGU (format DD/MM vs MM/DD):`
        + `\n- Kandidat A (dibaca DD/MM, konvensi Indonesia): ${first.label}`
        + `\n- Kandidat B (dibaca MM/DD, konvensi AS): ${second.label}`
        + '\n→ WAJIB konfirmasi ke pengguna lewat tool clarify_incident_time (kedua kandidat di atas = daftar candidates) SEBELUM mengisi tanggal pada worksheet mana pun. Setelah pengguna memilih, pakai tanggal terpilih untuk SEMUA tanggal worksheet kasus ini dan tuliskan pilihannya di jawaban.',
      );
    } else {
      lines.push(
        `TANGGAL AWAL SOAL: ${input.caseDate.readings[0].label} (kutipan "${input.caseDate.raw}") — pakai untuk semua tanggal worksheet kasus ini (A.1 ADW, dsb.).`,
      );
    }
  }
  if (input.detresfaTime) {
    const detresfa = input.detresfaTime.value;
    const time = `${String(detresfa.hour).padStart(2, '0')}.${String(detresfa.minute).padStart(2, '0')}${detresfa.zone ? ` ${detresfa.zone}` : ''}`;
    lines.push(
      `WAKTU KEJADIAN A.1 ADW = WAKTU DEKLARASI DETRESFA: pukul ${time} (kutipan soal: "${input.detresfaTime.source}").`
      + `\n→ incidentTime set_aero_drift_case = "<tanggal awal soal yang sudah dikonfirmasi> ${time}" (mis. "19 November 2026 ${time}"); JANGAN memakai waktu Kantor SAR/RCC menerima informasi sebagai A.1.`,
    );
  }
  if (input.lkpCoord) {
    lines.push(
      `KOORDINAT LKP (hasil parse teks soal — pakai untuk incidentPos set_aero_drift_case dan set_lkp): ${input.lkpCoord.value.dmsLat} – ${input.lkpCoord.value.dmsLng} (desimal: ${input.lkpCoord.value.lat}, ${input.lkpCoord.value.lng}).`,
    );
  }
  return lines.length > 0 ? lines.join('\n\n') : null;
}
