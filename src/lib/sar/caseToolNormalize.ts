/**
 * Normalisasi argumen tool kasus AI sebelum validasi apply (AIChatPanel).
 * =====================================================================
 * Model (terutama model cadangan pada rantai fallback) sering mengirim nilai
 * dengan format yang melewati maksud soal tetapi GAGAL validasi ketat di
 * klien — angka sebagai string ("140", "1000 ft"), varian ejaan enum
 * ("Fixed Wing", "no", "20 km"), atau id target teks bebas ("life raft
 * 6 person"). Akibatnya pratinjau menampilkan SEMUA operasi worksheet, tetapi
 * setelah "Terapkan" hanya satu-dua yang lolos gate (bug kasus nyata: hanya
 * AWA yang terisi). Normalizer ini mengonversi bentuk umum ke bentuk kanonik
 * SEBELUM gate validasi dijalankan — tanpa mengarang fakta yang tidak ada.
 */

import {
  LEEWAY_OBJECT_TYPES,
  resolveLeewayObjectFromDescription,
} from './sarCalculations';
import { W2_TARGET_OPTIONS, W8_TARGET_OPTIONS } from './wscPodTables';
import { normalizeTafCondition } from './assetAllocation';

type Args = Record<string, unknown>;

/** Konversi angka dari number atau string berlabel ("140", "18.9 kts",
 *  "070°T", "1,5", "1.000 ft"). Undefined/null/'' → undefined. */
export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return undefined;
  if (typeof value !== 'string') return undefined;
  let text = value.trim().toLowerCase();
  if (!text || text === '-' || text === '—') return undefined;
  text = text.replace(/(kts?|knot(s)?|nm|mil|ft|feet|kaki|m\/s|km\/h|km|°[ct]?|deg(rees)?|jam|hours?|hrs?|menit|min(utes)?|%|person|orang|pax|pw)\b/g, '')
    .replace(/[°'"″′\s]/g, '');
  // Ribuan gaya Indonesia: titik tiap 3 digit ("1.000 ft" → 1000, "1.000.000"
  // → 1000000). Bukan ribuan bila bagian depan "0" ("0.036" = desimal).
  if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, '');
  } else if (text.includes('.') && text.includes(',')) {
    // Ada titik DAN koma: titik = desimal, koma = ribuan (konvensi soal ID).
    text = text.replace(/,/g, '');
  } else if (text.includes(',') && !text.includes('.')) {
    // Koma = desimal gaya Indonesia ("1,5" → 1.5, "0,036" → 0.036);
    // banyak koma dianggap ribuan ("1,000,000" → 1000000).
    text = (text.match(/,/g) ?? []).length === 1 ? text.replace(',', '.') : text.replace(/,/g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Konversi boolean dari true/false/"true"/"yes"/"ya"/1 dst. */
export function coerceBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== 'string') return undefined;
  const text = value.trim().toLowerCase();
  if (['true', 'yes', 'ya', 'y', '1', 'fatigue', 'ada'].includes(text)) return true;
  if (['false', 'no', 'tidak', 'n', '0', 'none', 'tidak ada'].includes(text)) return false;
  return undefined;
}

/** String sederhana: undefined/null → undefined, lainnya trim. */
function coerceText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

/** Sudut 0–359: normalisasi modulus. */
function coerceAngle(value: unknown): number | undefined {
  const num = coerceNumber(value);
  if (num === undefined) return undefined;
  const wrapped = ((num % 360) + 360) % 360;
  return Number(wrapped.toFixed(1));
}

function coerceInt(value: unknown): number | undefined {
  const num = coerceNumber(value);
  return num === undefined ? undefined : Math.round(num);
}

/** Coerce array angka dari [1, "2", "3 nm"] → [1, 2, 3]; elemen tak valid dibuang. */
function coerceNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map((item) => coerceNumber(item)).filter((n): n is number => n !== undefined);
  return out.length > 0 ? out : undefined;
}

/** Pilih angka terdekat dari daftar nilai kanonik. */
function snapTo(value: number, options: readonly number[]): number {
  return options.reduce((best, option) =>
    Math.abs(option - value) < Math.abs(best - value) ? option : best, options[0]);
}

// ---------------------------------------------------------------------------
// Pemetaan alias enum → id kanonik (sumber: gate validasi AIChatPanel + UI)
// ---------------------------------------------------------------------------

function normalizeSearchPlatform(value: unknown): 'fixed-wing' | 'helicopter' | undefined {
  const text = coerceText(value)?.toLowerCase() ?? '';
  if (!text) return undefined;
  if (/heli|chopper|rotary|ec\s?\d|as\s?3\d\d|bell\s?\d|h\d{3}/i.test(text)) return 'helicopter';
  if (/fix|wing|pesawat|aircraft|plane|turbo|prop|cn-?? ?235|b737|b-?737|nomad|skyvan/i.test(text)) return 'fixed-wing';
  return undefined;
}

function normalizeSruType(value: unknown): string | undefined {
  const text = coerceText(value)?.toLowerCase() ?? '';
  if (!text) return undefined;
  if (/heli|chopper/.test(text)) return 'helicopter';
  if (/fix|wing|pesawat|aircraft|plane|turbo|prop/.test(text)) return 'fixed-wing-aircraft';
  if (/\brib\b|rigid\s+inflatable|perahu\s+karet/.test(text)) return 'rib';
  if (/sea\s?rider|speed\s?boat|kapal\s+cepat|fibra|fiber\s?glass/.test(text)) return 'sea-rider';
  if (/patroli|patrol|pc-?\s?\d\d/.test(text)) return 'patrol-boat';
  if (/sar|rescue|penyelamat/.test(text)) return 'rescue-vessel';
  if (/kapal|vessel|ship|boat|perahu/.test(text)) return 'rescue-vessel';
  return undefined;
}

function normalizeYesNo(value: unknown): 'Yes' | 'No' | undefined {
  const bool = coerceBool(value);
  if (bool !== undefined) return bool ? 'Yes' : 'No';
  return undefined;
}

/** Waktu Basarnas/ISO apa pun → string wajib; kosong → undefined (gate menolak). */
function normalizeTimeString(value: unknown): string | undefined {
  return coerceText(value);
}

const W2_HEIGHTS = [500, 1000, 1500, 2000] as const;
const WS3_VIS_KM = [5, 10, 20, 30, 40] as const;
const WS4_SAFETY_FACTORS = [1.1, 1.8, 2, 2.3, 2.6] as const;
/** Kolom visibilitas Table I-5/I-6 (WS 2): 2 / 5 / 10 / 20 / 30 / >40 km. */
const W2_VIS_COLUMNS = [2, 5, 10, 20, 30, 40] as const;

/** visibilityIndex dari angka index langsung, km, atau string "20 km". */
export function normalizeW2VisibilityIndex(
  visibilityIndex: unknown,
  visibilityKm: unknown,
): number | undefined {
  const direct = coerceInt(visibilityIndex);
  if (direct !== undefined && direct >= 0 && direct <= 5) return direct;
  const km = coerceNumber(visibilityKm);
  if (km === undefined) return undefined;
  // >40 → kolom terakhir (5); selain itu kolom dengan nilai terkecil yang >= km,
  // bila km melebihi 30 tapi ≤40 → kolom 30?? Tidak: kolom = batas atas terdekat.
  if (km >= 40) return 5;
  for (let i = 0; i < W2_VIS_COLUMNS.length; i += 1) {
    if (km <= W2_VIS_COLUMNS[i]) return i;
  }
  return 5;
}

/** W8 visibility string kanonik: '2'|'5'|'10'|'15'|'20'|'>25' atau '5'|'10'|'20'|'30'|'40' (MERSHIP). */
export function normalizeW8Visibility(value: unknown): string | undefined {
  const km = coerceNumber(value);
  if (km !== undefined) {
    if (km >= 26) return '>25';
    return String(Math.round(snapTo(km, [2, 5, 10, 15, 20])));
  }
  const text = coerceText(value)?.replace(/\s*km\s*$/i, '') ?? '';
  if (!text) return undefined;
  if (/^>{0,1}25|26|30|35|>=\s*25/i.test(text)) return '>25';
  if (['2', '5', '10', '15', '20'].includes(text)) return text;
  const num = coerceNumber(text);
  if (num === undefined) return undefined;
  return num >= 26 ? '>25' : String(Math.round(snapTo(num, [2, 5, 10, 15, 20])));
}

/** Eye height WS 8: '8'|'14'|'MERSHIP'; angka/String "14 ft" dipetakan; default per jenis alut. */
export function normalizeEyeHeight(value: unknown, sruType?: string): string | undefined {
  const text = coerceText(value);
  if (!text) {
    // Default pilihan planner (aturan app): kapal patroli/rescue 14 ft, perahu kecil/RIB 8 ft.
    if (sruType === 'rib' || sruType === 'sea-rider') return '8';
    if (sruType === 'rescue-vessel' || sruType === 'patrol-boat') return '14';
    return undefined;
  }
  if (/mersar|mer ship|mership|kapal\s+besar|ship/i.test(text)) return 'MERSHIP';
  const num = coerceNumber(text);
  if (num === undefined) return undefined;
  if (num >= 12) return '14';
  return '8';
}

const W2_TARGET_MATCHERS: Array<{ re: RegExp; pick: (text: string) => string }> = [
  {
    // PIW / person in water / orang di air / manusia
    re: /piw|person\s+in\s+the?\s*water|orang\s+(di\s+)?(dalam\s+)?air|manusia|swimmer|penumpang\s+jatuh/i,
    pick: () => 'piw',
  },
  {
    // Raft + jumlah orang → raft1/4/6/8/10/15/20/25
    re: /raft|rakit|life\s*raft|feralung/i,
    pick: (text) => {
      const persons = coerceNumber(text.match(/(\d{1,2})\s*(person|orang|pax|org)/i)?.[1])
        ?? coerceNumber(text.match(/(\d{1,2})\s*-?\s*man/i)?.[1]);
      if (persons === undefined) return 'raft6';
      if (persons <= 1) return 'raft1';
      if (persons <= 4) return 'raft4';
      if (persons <= 6) return 'raft6';
      if (persons <= 8) return 'raft8';
      if (persons <= 10) return 'raft10';
      if (persons <= 15) return 'raft15';
      if (persons <= 20) return 'raft20';
      return 'raft25';
    },
  },
  {
    // Sail boat + panjang meter → sail terdekat
    re: /sail|yacht|layar|sailing/i,
    pick: (text) => {
      const meters = coerceNumber(text.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:m\b|meter|metre)/i)?.[1]);
      const options = [5, 8, 12, 15, 21, 25];
      const ids = ['sail5', 'sail8', 'sail12', 'sail15', 'sail21', 'sail25'];
      if (meters === undefined) return 'sail8';
      let best = 0;
      options.forEach((option, i) => { if (Math.abs(option - meters) < Math.abs(options[best] - meters)) best = i; });
      return ids[best];
    },
  },
  {
    // Ship/kapal besar + panjang → ship27/ship46/shipOver91
    re: /ship|kapal(?! patroli| sar| penyelamat| cepat)|cargo|tanker|ferry|ferry|barge|tongkang/i,
    pick: (text) => {
      const meters = coerceNumber(text.match(/(\d{2,3})\s*(?:m\b|meter|metre)/i)?.[1]);
      if (meters === undefined) return 'ship46';
      if (meters < 46) return 'ship27';
      if (meters <= 91) return 'ship46';
      return 'shipOver91';
    },
  },
  {
    // Power boat + panjang → boatSmall/boat10/boat16/boat24
    re: /boat|perahu|skoci|kapal\s+patroli|kapal\s+sar|kapal\s+cepat|power\s?boat|craft/i,
    pick: (text) => {
      const meters = coerceNumber(text.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:m\b|meter|metre)/i)?.[1]);
      if (meters === undefined) return 'boatSmall';
      if (meters < 5) return 'boatSmall';
      if (meters <= 12) return 'boat10';
      if (meters <= 20) return 'boat16';
      return 'boat24';
    },
  },
];

/** Search object WS 2 dari id/label/teks bebas soal. */
export function normalizeW2Target(value: unknown, description?: unknown): string | undefined {
  const direct = coerceText(value);
  if (direct) {
    const asId = W2_TARGET_OPTIONS.find((option) => option.id.toLowerCase() === direct.toLowerCase());
    if (asId) return asId.id;
    const asLabel = W2_TARGET_OPTIONS.find((option) => option.label.toLowerCase() === direct.toLowerCase());
    if (asLabel) return asLabel.id;
  }
  const text = [coerceText(description), direct].filter(Boolean).join(' ');
  if (!text) return undefined;
  for (const matcher of W2_TARGET_MATCHERS) {
    if (matcher.re.test(text)) return matcher.pick(text);
  }
  return undefined;
}

const W8_TARGET_MATCHERS: Array<{ re: RegExp; pick: (text: string) => string }> = [
  { re: /piw|person|orang\s*(di)?\s*air|manusia/i, pick: () => 'person' },
  {
    re: /raft|rakit|life\s*raft|feralung/i,
    pick: (text) => {
      const persons = coerceNumber(text.match(/(\d{1,2})\s*(person|orang|pax|org)/i)?.[1]);
      if (persons === undefined) return 'raft6';
      if (persons <= 1) return 'raft1';
      if (persons <= 4) return 'raft4';
      if (persons <= 6) return 'raft6';
      if (persons <= 8) return 'raft8';
      if (persons <= 10) return 'raft10';
      if (persons <= 15) return 'raft15';
      if (persons <= 20) return 'raft20';
      return 'raft25';
    },
  },
  {
    re: /sail|yacht|layar/i,
    pick: (text) => {
      const meters = coerceNumber(text.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:m\b|meter|metre)/i)?.[1]);
      const options = [5, 6, 8, 9, 12, 15, 21, 25];
      const ids = ['sail5', 'sail6', 'sail8', 'sail9', 'sail12', 'sail15', 'sail20to23', 'sail23to27'];
      if (meters === undefined) return 'sail8';
      let best = 0;
      options.forEach((option, i) => { if (Math.abs(option - meters) < Math.abs(options[best] - meters)) best = i; });
      return ids[best];
    },
  },
  {
    re: /boat|perahu|skoci|kapal|craft|vessel/i,
    pick: (text) => {
      const meters = coerceNumber(text.match(/(\d{1,2}(?:[.,]\d)?)\s*(?:m\b|meter|metre)/i)?.[1]);
      if (meters === undefined) return 'boat5to8';
      if (meters < 5) return 'boatUnder5';
      if (meters <= 8) return 'boat5to8';
      if (meters <= 12) return 'boat8to12';
      if (meters <= 20) return 'boat12to20';
      return 'boat20to27';
    },
  },
];

/** Search object WS 8 dari id/label/teks bebas soal. */
export function normalizeW8Target(value: unknown, description?: unknown): string | undefined {
  const direct = coerceText(value);
  if (direct) {
    const asId = W8_TARGET_OPTIONS.find((option) => option.id.toLowerCase() === direct.toLowerCase());
    if (asId) return asId.id;
    const asLabel = W8_TARGET_OPTIONS.find((option) => option.label.toLowerCase() === direct.toLowerCase());
    if (asLabel) return asLabel.id;
  }
  const text = [coerceText(description), direct].filter(Boolean).join(' ');
  if (!text) return undefined;
  for (const matcher of W8_TARGET_MATCHERS) {
    if (matcher.re.test(text)) return matcher.pick(text);
  }
  return undefined;
}

/** Id leeway Table I-1/I-2 dari id langsung atau deskripsi target soal. */
function normalizeLeewayId(value: unknown, description: unknown): string | undefined {
  const direct = coerceText(value);
  if (direct && LEEWAY_OBJECT_TYPES.some((option) => option.id === direct)) return direct;
  const text = coerceText(description) ?? direct;
  if (!text) return undefined;
  // LeewayDescriptionMatch: id baris tabel ada di .object.id (bukan .id).
  return resolveLeewayObjectFromDescription(text)?.object.id;
}

/** Id alat navigasi Table J-1 dari teks bebas ("GPS", "radar ARPA", "visual"). */
const NAV_AID_MATCHERS: Array<[RegExp, string]> = [
  [/gps|global\s+position/i, 'gps'],
  [/radar|arpa/i, 'radar'],
  [/celestial|astro|sextan/i, 'celestial'],
  [/visual|mata|three\s+line|3\s+garis|garis\s+penampang/i, 'visual'],
  [/radio\s*beacon|mrb/i, 'marine-radio-beacon'],
  [/loran/i, 'loran-c'],
  [/\bins\b|inertial/i, 'ins'],
  [/vor|tacan/i, 'vor-tacan'],
];

function normalizeNavAid(value: unknown): string | undefined {
  const text = coerceText(value);
  if (!text) return undefined;
  const lower = text.toLowerCase();
  for (const [re, id] of NAV_AID_MATCHERS) {
    if (re.test(lower)) return id;
  }
  return undefined;
}

function normalizeVegetation(value: unknown): string | undefined {
  const text = coerceText(value)?.toLowerCase() ?? '';
  if (!text) return undefined;
  if (/under|<|kurang|belum.*15/.test(text) && /15/.test(text)) return 'under-15';
  if (/(15|16|17|18|19)\s*(-|–|to|sd|sampai)?\s*(60|59|55|50)/.test(text)) return '15-60';
  if (/(60|61|65|70|75|80|84)\s*(-|–|to|sd|sampai)?\s*(85|84|83|82|81|80)/.test(text)) return '60-85';
  if (/over|>|lebih.*85|di\s?atas\s*85/.test(text)) return 'over-85';
  if (/60|61|65|70|75|80|81|82|83|84|85/.test(text)) return '60-85';
  if (/15|16|20|25|30|35|40|45|50|55|59/.test(text)) return '15-60';
  if (/5|6|7|8|9|10|11|12|13|14/.test(text)) return 'under-15';
  return undefined;
}

function normalizeWs3Object(value: unknown, description?: unknown): string | undefined {
  const text = [coerceText(value), coerceText(description)].filter(Boolean).join(' ').toLowerCase();
  if (!text) return undefined;
  if (/person|orang|piw|manusia/.test(text)) return 'person';
  if (/vehicle|kendaraan|mobil|truck|bus/.test(text)) return 'vehicle';
  if (/aircraft|pesawat|helikopter|helicopter/.test(text)) {
    if (/under|<|kurang|light|kecil|5700|5\.7/.test(text)) return 'aircraft-under-5700';
    if (/over|>|besar|heavy|lebih/.test(text)) return 'aircraft-over-5700';
    return 'aircraft-under-5700';
  }
  return undefined;
}

function normalizeIntervalMode(value: unknown): '6h' | '3h' | undefined {
  const text = coerceText(value)?.toLowerCase() ?? '';
  if (!text) return undefined;
  if (/^3(\s*(h|hour|jam))?$/.test(text) || /3h/.test(text)) return '3h';
  if (/^6(\s*(h|hour|jam))?$/.test(text) || /6h/.test(text)) return '6h';
  return undefined;
}

/** Parse jam:menit dari teks obsTime bebas — dukung Basarnas MMDD.HHMM
 *  ("1117.0700" → 07:00; angka setelah titik = HHMM) dan "17/07.00"/"07:00". */
function parseObsClock(value: string): { hour: number; minute: number } | undefined {
  const compact = value.match(/\b(\d{4})\.(\d{4})\b/);
  if (compact) return { hour: Number(compact[2].slice(0, 2)), minute: Number(compact[2].slice(2)) };
  const clock = value.match(/(\d{1,2})[.:](\d{2})/);
  if (clock) return { hour: Number(clock[1]), minute: Number(clock[2]) };
  return undefined;
}

/** IntervalMode ASW dari jam observasi (aturan app): ada 03/09/15/21 → "3h";
 *  semua 00/06/12/18 → "6h"; jam non-sinoptik (mis. 07/13) → jarak antar-
 *  observasi ≥ 4,5 jam → "6h", selain itu "3h"; tanpa waktu → default "6h". */
function deriveIntervalMode(rows: Array<Record<string, unknown>> | undefined): '6h' | '3h' {
  const clocks = (rows ?? [])
    .map((row) => coerceText(row.obsTime))
    .filter((time): time is string => Boolean(time))
    .map(parseObsClock)
    .filter((clock): clock is { hour: number; minute: number } => clock !== undefined);
  if (clocks.length === 0) return '6h';
  if (clocks.some((clock) => [3, 9, 15, 21].includes(clock.hour))) return '3h';
  if (clocks.every((clock) => [0, 6, 12, 18].includes(clock.hour))) return '6h';
  const sorted = [...clocks].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = (sorted[i].hour * 60 + sorted[i].minute) - (sorted[i - 1].hour * 60 + sorted[i - 1].minute);
    if (gap > maxGap) maxGap = gap;
  }
  return maxGap >= 270 ? '6h' : '3h';
}

function normalizePatternType(value: unknown): string | undefined {
  const text = coerceText(value)?.toLowerCase() ?? '';
  if (!text) return undefined;
  if (/expanding\s*square|persegi|^ps\b|square/.test(text)) return 'PS';
  if (/sector|sektor|^vs\b/.test(text)) return 'VS';
  if (/track\s*line|^ts\b|trackline/.test(text)) return 'TS';
  if (/parallel|^cs\b|garis/.test(text)) return 'CS';
  if (/contour|^ss\b/.test(text)) return 'SS';
  return undefined;
}

function normalizeTurnDirection(value: unknown): 'right' | 'left' | undefined {
  const text = coerceText(value)?.toLowerCase() ?? '';
  if (!text) return undefined;
  if (/right|kanan|starboard/.test(text)) return 'right';
  if (/left|kiri|port/.test(text)) return 'left';
  return undefined;
}

function normalizeInterceptType(value: unknown): string | undefined {
  const text = coerceText(value)?.toLowerCase() ?? '';
  if (!text) return undefined;
  if (/head|depan|berlawanan|opposite|lawan/.test(text)) return 'head-on';
  if (/over|susul|same\s+direction|searah/.test(text)) return 'overtaking';
  if (/beam|silang|lintas|cross/.test(text)) return 'beam-on';
  return undefined;
}

function normalizeEngineType(value: unknown): 'piston' | 'turbine' | undefined {
  const text = coerceText(value)?.toLowerCase() ?? '';
  if (!text) return undefined;
  if (/turb|jet|fan/.test(text)) return 'turbine';
  if (/piston|prop|bensin|aviagaz|avgas/.test(text)) return 'piston';
  return undefined;
}

/** Pos {lat,lng} dari objek/angka/string. */
function normalizeLatLng(value: unknown): { lat: number; lng: number } | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const lat = coerceNumber(record.lat ?? record.latitude);
    const lng = coerceNumber(record.lng ?? record.lon ?? record.longitude);
    if (lat !== undefined && lng !== undefined
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      && (lat !== 0 || lng !== 0)) {
      return { lat, lng };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Normalizer per tool
// ---------------------------------------------------------------------------

function normalizeWindRows(rows: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(rows)) return undefined;
  const mapped = rows
    .filter((row) => row && typeof row === 'object')
    .map((row) => {
      const record = row as Record<string, unknown>;
      const out: Record<string, unknown> = {
        windDirFrom: coerceAngle(record.windDirFrom ?? record.dir ?? record.direction),
        windSpeed: coerceNumber(record.windSpeed ?? record.speed),
      };
      const alt = coerceText(record.altObs ?? record.altitude ?? record.level);
      if (alt !== undefined) out.altObs = alt;
      const time = coerceText(record.obsTime ?? record.time);
      if (time !== undefined) out.obsTime = time;
      const hours = coerceNumber(record.hours);
      if (hours !== undefined) out.hours = hours;
      const timeStart = coerceText(record.timeStart);
      if (timeStart !== undefined) out.timeStart = timeStart;
      const timeEnd = coerceText(record.timeEnd);
      if (timeEnd !== undefined) out.timeEnd = timeEnd;
      return out;
    })
    .filter((row) => typeof row.windDirFrom === 'number' && typeof row.windSpeed === 'number');
  return mapped.length > 0 ? mapped : undefined;
}

/**
 * Normalisasi satu panggilan tool kasus. Nama tool tak dikenal → args apa adanya.
 * Prinsip: bentuk yang tidak bisa dinormalisasi dibiarkan — gate validasi yang
 * menolak, jangan mengarang nilai fakta soal.
 */
export function normalizeCaseToolArgs(toolName: string, rawArgs: Args | undefined | null): Args {
  const args: Args = { ...(rawArgs ?? {}) };
  switch (toolName) {
    case 'set_awa_case': {
      const alt = coerceNumber(args.distressAltFt);
      if (alt !== undefined) args.distressAltFt = alt;
      const rows = normalizeWindRows(args.windData);
      if (rows) args.windData = rows;
      const title = coerceText(args.caseTitle);
      if (title) args.caseTitle = title;
      break;
    }
    case 'set_asw_case': {
      const distress = normalizeTimeString(args.distressTime);
      if (distress) args.distressTime = distress;
      const datum = normalizeTimeString(args.datumTime);
      if (datum) args.datumTime = datum;
      const rows = normalizeWindRows(args.windData);
      if (rows) args.windData = rows;
      const interval = normalizeIntervalMode(args.intervalMode);
      // Default pilihan planner tanpa bertanya: interval dari jam observasi.
      args.intervalMode = interval ?? deriveIntervalMode(rows);
      const title = coerceText(args.caseTitle);
      if (title) args.caseTitle = title;
      break;
    }
    case 'set_aero_drift_case': {
      for (const key of ['aircraftAltMaxFt', 'aircraftAltMinFt', 'aircraftGlideRatio', 'aircraftTASgKts', 'aircraftDescentHeadingDeg', 'parachuteAltMaxFt', 'parachuteTerrainAltFt', 'parachuteRateOfDescentFtMin', 'parachuteGlideRatio', 'parachuteTASgKts', 'parachuteDescentHeadingDeg', 'incidentAltFt']) {
        const num = coerceNumber(args[key]);
        if (num !== undefined) args[key] = num;
      }
      const heading = coerceAngle(args.aircraftDescentHeadingDeg);
      if (heading !== undefined) args.aircraftDescentHeadingDeg = heading;
      const headingP = coerceAngle(args.parachuteDescentHeadingDeg);
      if (headingP !== undefined) args.parachuteDescentHeadingDeg = headingP;
      const incident = normalizeLatLng(args.incidentPos);
      if (incident) args.incidentPos = incident;
      const glide = coerceBool(args.useAircraftGlide);
      if (glide !== undefined) args.useAircraftGlide = glide;
      const chute = coerceBool(args.useParachute);
      if (chute !== undefined) args.useParachute = chute;
      break;
    }
    case 'set_lkp': {
      const lat = coerceNumber(args.lat ?? args.latitude);
      const lng = coerceNumber(args.lng ?? args.longitude);
      if (lat !== undefined && Math.abs(lat) <= 90) args.lat = lat;
      if (lng !== undefined && Math.abs(lng) <= 180) args.lng = lng;
      break;
    }
    case 'set_datum_case': {
      const interval = coerceNumber(args.driftInterval);
      if (interval !== undefined) args.driftInterval = interval;
      const dir = coerceAngle(args.seaCurrentDir);
      if (dir !== undefined) args.seaCurrentDir = dir;
      const speed = coerceNumber(args.seaCurrentSpeed);
      if (speed !== undefined) args.seaCurrentSpeed = speed;
      const err = coerceNumber(args.seaCurrentErr);
      if (err !== undefined) args.seaCurrentErr = err;
      const lkp = normalizeLatLng(args.lkp);
      if (lkp) args.lkp = lkp;
      const latitude = coerceNumber(args.latitude);
      if (latitude !== undefined) {
        args.latitude = Math.min(Math.abs(latitude), 90);
      } else if (lkp) {
        // |Latitude| untuk divergensi WC turunan koordinat LKP (aturan worksheet).
        args.latitude = Math.min(Math.abs(lkp.lat), 90);
      }
      const x = coerceNumber(args.X);
      if (x !== undefined) args.X = x;
      const y = coerceNumber(args.Y);
      if (y !== undefined) args.Y = y;
      const xAid = normalizeNavAid(args.xNavAid);
      if (xAid) args.xNavAid = xAid;
      const yAid = normalizeNavAid(args.yNavAid);
      if (yAid) args.yNavAid = yAid;
      const leewayId = normalizeLeewayId(args.leewayObjectId, args.leewayDescription ?? args.searchObject ?? args.targetDescription);
      if (leewayId) args.leewayObjectId = leewayId;
      const lkpSource = coerceText(args.lkpSource)?.toLowerCase();
      if (lkpSource === 'adw-landing' || lkpSource === 'explicit') args.lkpSource = lkpSource;
      else if (!lkpSource && (lkp || coerceNumber(args.latitude) !== undefined)) args.lkpSource = 'explicit';
      break;
    }
    case 'set_ws2_case': {
      const platform = normalizeSearchPlatform(args.searchPlatform);
      if (platform) args.searchPlatform = platform;
      const tas = coerceNumber(args.searchTas);
      if (tas !== undefined) args.searchTas = tas;
      const visIndex = normalizeW2VisibilityIndex(args.visibilityIndex, args.visibilityKm ?? args.visibility);
      if (visIndex !== undefined) args.visibilityIndex = visIndex;
      const fatigue = normalizeYesNo(args.isFatigue);
      if (fatigue) args.isFatigue = fatigue;
      const searchNumber = coerceInt(args.searchNumber);
      if (searchNumber !== undefined && searchNumber >= 1 && searchNumber <= 5) args.searchNumber = searchNumber;
      else if (searchNumber === undefined && args.searchNumber === undefined) args.searchNumber = 1;
      const height = coerceNumber(args.selectedHeight);
      args.selectedHeight = height !== undefined
        ? snapTo(height, W2_HEIGHTS)
        : 1000; // default pilihan planner (aturan app)
      const target = normalizeW2Target(args.searchObject, args.targetDescription ?? args.searchObjectDescription ?? args.searchObjectLabel);
      if (target) args.searchObject = target;
      const windDir = coerceAngle(args.caseWindDirFrom);
      if (windDir !== undefined) args.caseWindDirFrom = windDir;
      const windKts = coerceNumber(args.caseWindSpeed);
      if (windKts !== undefined) args.caseWindSpeed = windKts;
      const wave = coerceNumber(args.caseWaveHeightM);
      if (wave !== undefined) args.caseWaveHeightM = wave;
      const hours = coerceNumber(args.hoursAvailable);
      if (hours !== undefined) args.hoursAvailable = hours;
      const title = coerceText(args.caseTitle);
      if (title) args.caseTitle = title;
      const sru = coerceText(args.sruName);
      if (sru) args.sruName = sru;
      break;
    }
    case 'set_ws3_case': {
      const target = normalizeWs3Object(args.searchObject, args.targetDescription ?? args.searchObjectDescription);
      if (target) args.searchObject = target;
      const visKm = coerceNumber(args.visibilityKm);
      if (visKm !== undefined) args.visibilityKm = snapTo(visKm, WS3_VIS_KM);
      const vegetation = normalizeVegetation(args.vegetationType);
      if (vegetation) args.vegetationType = vegetation;
      const fatigue = coerceBool(args.isFatigue);
      if (fatigue !== undefined) args.isFatigue = fatigue;
      const platform = normalizeSearchPlatform(args.searchPlatform);
      if (platform) args.searchPlatform = platform;
      const searchNumber = coerceInt(args.searchNumber);
      if (searchNumber !== undefined && searchNumber >= 1 && searchNumber <= 5) args.searchNumber = searchNumber;
      else if (searchNumber === undefined && args.searchNumber === undefined) args.searchNumber = 1;
      for (const key of ['searchSpeedKts', 'searchTas', 'searchAreaNm2']) {
        const num = coerceNumber(args[key]);
        if (num !== undefined) args[key] = num;
      }
      const title = coerceText(args.caseTitle);
      if (title) args.caseTitle = title;
      const sru = coerceText(args.sruName);
      if (sru) args.sruName = sru;
      break;
    }
    case 'set_ws4_case': {
      for (const key of ['initialTrNm', 'targetTasKts', 'elapsedMinutesSinceLastFix', 'yNavError']) {
        const num = coerceNumber(args[key]);
        if (num !== undefined) args[key] = num;
      }
      const safety = coerceNumber(args.safetyFactor);
      if (safety !== undefined) args.safetyFactor = snapTo(safety, WS4_SAFETY_FACTORS);
      const legs = coerceNumberArray(args.routeLegDistancesNm);
      if (legs) args.routeLegDistancesNm = legs;
      const trList = coerceNumberArray(args.trList);
      if (trList) args.trList = trList;
      const fixErrors = coerceNumberArray(args.fixErrors);
      if (fixErrors) args.fixErrors = fixErrors;
      const navType = coerceText(args.targetNavigationType)?.toLowerCase();
      if (navType) {
        if (/gps/.test(navType)) args.targetNavigationType = 'gps';
        else if (/non|manual|tanpa\s*gps/.test(navType)) args.targetNavigationType = 'non-gps';
        else if (/self\s*contained|mandiri/.test(navType)) args.targetNavigationType = 'self-contained';
        else if (/dead\s*reckoning|dr\b/.test(navType)) args.targetNavigationType = 'dead-reckoning';
        else if (/other\s*aircraft|pesawat\s*lain/.test(navType)) args.targetNavigationType = 'other-aircraft';
        else if (/custom|lain|custom/.test(navType)) args.targetNavigationType = 'custom';
      }
      if (Array.isArray(args.routePoints)) {
        args.routePoints = args.routePoints.map((point) => {
          const normalized = normalizeLatLng(point);
          if (!normalized || typeof point !== 'object') return null;
          const record = point as Record<string, unknown>;
          return {
            name: coerceText(record.name) ?? '-',
            lat: normalized.lat,
            lng: normalized.lng,
            active: coerceBool(record.active) ?? true,
          };
        });
      }
      const title = coerceText(args.caseTitle);
      if (title) args.caseTitle = title;
      break;
    }
    case 'set_ws8_case': {
      const sruType = normalizeSruType(args.sruType);
      if (sruType) args.sruType = sruType;
      args.eyeHeight = normalizeEyeHeight(args.eyeHeight, (args.sruType as string) ?? undefined) ?? args.eyeHeight;
      const vis = normalizeW8Visibility(args.visibilityKm ?? args.visibility);
      if (vis) args.visibilityKm = vis;
      const fatigue = normalizeYesNo(args.isFatigue);
      if (fatigue) args.isFatigue = fatigue;
      const searchNumber = coerceInt(args.searchNumber);
      if (searchNumber !== undefined && searchNumber >= 1 && searchNumber <= 5) args.searchNumber = searchNumber;
      else if (searchNumber === undefined && args.searchNumber === undefined) args.searchNumber = 1;
      const speed = coerceNumber(args.vesselSpeedKts);
      if (speed !== undefined) args.vesselSpeedKts = speed;
      const target = normalizeW8Target(args.searchObject, args.targetDescription ?? args.searchObjectDescription ?? args.searchObjectLabel);
      if (target) args.searchObject = target;
      const windDir = coerceAngle(args.caseWindDirFrom);
      if (windDir !== undefined) args.caseWindDirFrom = windDir;
      const windKts = coerceNumber(args.caseWindSpeed);
      if (windKts !== undefined) args.caseWindSpeed = windKts;
      const wave = coerceNumber(args.caseWaveHeightM);
      if (wave !== undefined) args.caseWaveHeightM = wave;
      const hours = coerceNumber(args.hoursAvailable);
      if (hours !== undefined) args.hoursAvailable = hours;
      const title = coerceText(args.caseTitle);
      if (title) args.caseTitle = title;
      const sru = coerceText(args.sruName);
      if (sru) args.sruName = sru;
      break;
    }
    case 'set_asset_allocation_case': {
      const sruType = normalizeSruType(args.sruType);
      if (sruType) args.sruType = sruType;
      for (const key of ['transitSpeedKts', 'searchSpeedKts', 'enduranceHours', 'sweepWidthNm', 'homeBaseLat', 'homeBaseLng', 'maritimeTsfMins']) {
        const num = coerceNumber(args[key]);
        if (num !== undefined) args[key] = num;
      }
      const engine = normalizeEngineType(args.airEngineType);
      if (engine) args.airEngineType = engine;
      const taf = normalizeTafCondition(coerceText(args.tafCondition));
      if (taf) args.tafCondition = taf;
      const base = coerceText(args.homeBaseName);
      if (base) args.homeBaseName = base;
      const sru = coerceText(args.sruName);
      if (sru) args.sruName = sru;
      const subArea = coerceText(args.assignedSubArea);
      if (subArea) args.assignedSubArea = subArea;
      break;
    }
    case 'set_search_pattern_case': {
      const pattern = normalizePatternType(args.patternType);
      if (pattern) args.patternType = pattern;
      const orientation = coerceAngle(args.orientationDeg);
      if (orientation !== undefined) args.orientationDeg = orientation;
      const turn = normalizeTurnDirection(args.turnDirection);
      if (turn) args.turnDirection = turn;
      for (const key of ['sectorAngleDeg', 'sectorLegLengthNm', 'sectorLegCount', 'trackLineLengthNm', 'tsReturnOffsetNm']) {
        const num = coerceNumber(args[key]);
        if (num !== undefined) args[key] = key === 'sectorLegCount' ? Math.round(num) : num;
      }
      const tsReturn = coerceBool(args.tsReturn);
      if (tsReturn !== undefined) args.tsReturn = tsReturn;
      const datumPoint = normalizeLatLng(args.datumPos);
      if (datumPoint) args.datumPos = datumPoint;
      break;
    }
    case 'set_intercept_case': {
      const type = normalizeInterceptType(args.type);
      if (type) args.type = type;
      for (const group of ['target', 'sru']) {
        if (args[group] && typeof args[group] === 'object' && !Array.isArray(args[group])) {
          const record = { ...(args[group] as Record<string, unknown>) };
          const pos = normalizeLatLng(record.pos);
          if (pos) record.pos = pos;
          const speed = coerceNumber(record.speedKts);
          if (speed !== undefined) record.speedKts = speed;
          const course = coerceAngle(record.courseDeg);
          if (course !== undefined) record.courseDeg = course;
          args[group] = record;
        }
      }
      break;
    }
    default:
      break;
  }
  return args;
}
