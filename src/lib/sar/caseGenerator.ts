/**
 * CASE GENERATOR (Fase 5a AI Copilot) — generator soal latihan SAR
 * deterministik ber-seed (keputusan implementasi no. 6, 8, 13).
 *
 * Prinsip mutlak:
 *  - DETERMINISTIK: seed + parameter yang sama menghasilkan kasus yang SAMA
 *    persis (PRNG mulberry32; tanpa Math.random / Date.now di jalur generate).
 *  - Angka wilayah (angin/arus) adalah DATA LATIHAN berlabel SIMULATION —
 *    bukan data cuaca/operasi resmi (keputusan no. 6).
 *  - Jebakan terkontrol (heading magnetic vs true, variation W, lintas
 *    tengah malam, interval 3 jam, zona waktu, inferensi search number,
 *    wind shear) menuntut KONVERSI/TAFSIRAN — tidak pernah menciptakan data
 *    yang saling bertentangan (kompatibel syarat solvability pipeline).
 *  - Seluruh output divalidasi `sarCaseSchema` + pemeriksaan kelengkapan per
 *    jenis insiden sebelum dikembalikan.
 */

import type {
  SarCaseSchema,
  CaseSru,
  WindLayer,
  SurfaceWindEntry,
  IncidentType,
} from './caseSchema';
import { sarCaseSchema } from './caseSchema';
import {
  checkCaseCompleteness,
  type CaseCompleteness,
  type CasePlannerInputs,
} from './caseAdapter';
import {
  SCENARIO_BANK_SEED,
  listScenarioBank,
  isSruUsableAsset,
  bankEntryToCaseSru,
  bankEntryToCaseTarget,
  type BankEntry,
} from './scenarioBank';
import { formatDMS } from './coordFormat';

// ---------------------------------------------------------------------------
// PRNG deterministik
// ---------------------------------------------------------------------------

/** Hash string → uint32 (xfnv1a). Seed apa pun (termasuk kosong) valid. */
export function hashSeedToNumber(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 — PRNG kecil, cepat, deterministik. */
export function mulberry32(seedNum: number): () => number {
  let a = seedNum >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** Float [0,1). */
  next(): number;
  /** Integer [min, max] inklusif. */
  int(min: number, max: number): number;
  /** Float [min, max] dibulatkan ke `step`. */
  float(min: number, max: number, step?: number): number;
  /** Elemen acak array. */
  pick<T>(items: readonly T[]): T;
  /** True dengan peluang `p` (0-1). */
  bool(p: number): boolean;
  /** Sudut = base + offset acak [-spread, +spread], dibungkus 0-360. */
  angle(base: number, spread: number): number;
  /** `n` elemen acak tanpa pengulangan. */
  pickMany<T>(items: readonly T[], n: number): T[];
}

export function createRng(seed: string): Rng {
  const rand = mulberry32(hashSeedToNumber(seed));
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  return {
    next: rand,
    int,
    float(min: number, max: number, step = 0.1) {
      const steps = Math.floor((max - min) / step + 1e-9);
      const value = min + int(0, steps) * step;
      return Math.round(value * 1e6) / 1e6;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('rng.pick: array kosong');
      return items[int(0, items.length - 1)];
    },
    bool(p: number): boolean {
      return rand() < p;
    },
    angle(base: number, spread: number): number {
      const raw = base + (rand() * 2 - 1) * spread;
      return Math.round(((raw % 360) + 360) % 360) % 360;
    },
    pickMany<T>(items: readonly T[], n: number): T[] {
      const pool = [...items];
      const out: T[] = [];
      while (out.length < n && pool.length > 0) {
        out.push(pool.splice(int(0, pool.length - 1), 1)[0]);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Wilayah & musim (angin/arus wajar per wilayah — DATA LATIHAN SIMULATION)
// ---------------------------------------------------------------------------

export type TimeZoneId = 'WIB' | 'WITA' | 'WIT';

export type Season = 'barat' | 'transisi-barat-timur' | 'timur' | 'transisi-timur-barat';

/** Musim monsun Indonesia (model sederhana untuk data latihan SIMULATION). */
export function seasonOfMonth(month: number): Season {
  if (month >= 12 || month <= 2) return 'barat';
  if (month >= 3 && month <= 4) return 'transisi-barat-timur';
  if (month >= 5 && month <= 9) return 'timur';
  return 'transisi-timur-barat';
}

export interface ScenarioRegion {
  id: string;
  name: string;
  /** Perkiraan pusat wilayah (data latihan, bukan koordinat resmi). */
  center: { lat: number; lng: number };
  timeZone: TimeZoneId;
  /** Tag untuk memilih entri bank lokasi terkait. */
  bankRegion: string;
  /** Arah dasar angin monsun per musim (FROM, °T). */
  windBaseBySeason: Record<Season, number>;
  /** Arus dasar (arah KE, °T) + rentang kecepatan kts. */
  currentBase: { dirToDeg: number; speedMinKts: number; speedMaxKts: number };
}

export const SCENARIO_REGIONS: ScenarioRegion[] = [
  {
    id: 'selat-sunda',
    name: 'Selat Sunda',
    center: { lat: -6.9, lng: 105.3 },
    timeZone: 'WIB',
    bankRegion: 'selat-sunda',
    windBaseBySeason: { barat: 300, 'transisi-barat-timur': 250, timur: 130, 'transisi-timur-barat': 210 },
    currentBase: { dirToDeg: 250, speedMinKts: 0.2, speedMaxKts: 0.9 },
  },
  {
    id: 'teluk-jakarta',
    name: 'Teluk Jakarta',
    center: { lat: -5.95, lng: 106.75 },
    timeZone: 'WIB',
    bankRegion: 'teluk-jakarta',
    windBaseBySeason: { barat: 310, 'transisi-barat-timur': 260, timur: 120, 'transisi-timur-barat': 200 },
    currentBase: { dirToDeg: 230, speedMinKts: 0.2, speedMaxKts: 0.8 },
  },
  {
    id: 'laut-jawa',
    name: 'Laut Jawa (utara Jawa Tengah)',
    center: { lat: -6.0, lng: 108.5 },
    timeZone: 'WIB',
    bankRegion: 'laut-jawa',
    windBaseBySeason: { barat: 300, 'transisi-barat-timur': 250, timur: 110, 'transisi-timur-barat': 190 },
    currentBase: { dirToDeg: 220, speedMinKts: 0.3, speedMaxKts: 1.0 },
  },
  {
    id: 'selat-bangka',
    name: 'Selat Bangka',
    center: { lat: -2.5, lng: 106.2 },
    timeZone: 'WIB',
    bankRegion: 'selat-bangka',
    windBaseBySeason: { barat: 320, 'transisi-barat-timur': 270, timur: 120, 'transisi-timur-barat': 200 },
    currentBase: { dirToDeg: 190, speedMinKts: 0.3, speedMaxKts: 1.2 },
  },
  {
    id: 'selat-karimata',
    name: 'Selat Karimata',
    center: { lat: -3.0, lng: 108.8 },
    timeZone: 'WIB',
    bankRegion: 'selat-karimata',
    windBaseBySeason: { barat: 310, 'transisi-barat-timur': 260, timur: 110, 'transisi-timur-barat': 190 },
    currentBase: { dirToDeg: 200, speedMinKts: 0.4, speedMaxKts: 1.3 },
  },
  {
    id: 'selat-makassar',
    name: 'Selat Makassar',
    center: { lat: -3.5, lng: 117.5 },
    timeZone: 'WITA',
    bankRegion: 'selat-makassar',
    windBaseBySeason: { barat: 300, 'transisi-barat-timur': 240, timur: 130, 'transisi-timur-barat': 210 },
    currentBase: { dirToDeg: 180, speedMinKts: 0.4, speedMaxKts: 1.5 },
  },
  {
    id: 'selat-bali',
    name: 'Selat Bali',
    center: { lat: -8.7, lng: 115.5 },
    timeZone: 'WITA',
    bankRegion: 'selat-bali',
    windBaseBySeason: { barat: 290, 'transisi-barat-timur': 240, timur: 120, 'transisi-timur-barat': 200 },
    currentBase: { dirToDeg: 260, speedMinKts: 0.5, speedMaxKts: 1.6 },
  },
  {
    id: 'selat-sorong',
    name: 'Perairan Sorong',
    center: { lat: -0.9, lng: 131.1 },
    timeZone: 'WIT',
    bankRegion: 'selat-sorong',
    windBaseBySeason: { barat: 300, 'transisi-barat-timur': 250, timur: 120, 'transisi-timur-barat': 210 },
    currentBase: { dirToDeg: 170, speedMinKts: 0.3, speedMaxKts: 1.2 },
  },
];

export function findScenarioRegion(id: string): ScenarioRegion | undefined {
  return SCENARIO_REGIONS.find((r) => r.id === id);
}

// ---------------------------------------------------------------------------
// Tingkat kesulitan & jebakan terkontrol
// ---------------------------------------------------------------------------

export const GENERATOR_DIFFICULTIES = ['mudah', 'sedang', 'sulit'] as const;
export type GeneratorDifficulty = (typeof GENERATOR_DIFFICULTIES)[number];

export const GENERATOR_TRAPS = [
  'heading-magnetic',        // heading diberikan (M) — peserta konversi true = mag ± var
  'variation-west',          // variation W (dikurangi, bukan ditambah)
  'midnight-crossing',       // MAYDAY menjelang tengah malam, datum pagi hari berikut
  'wind-series-3h',          // deret angin interval 3 jam (bukan 6 jam)
  'zona-waktu-wita',         // waktu dalam WITA (UTC+8)
  'zona-waktu-wit',          // waktu dalam WIT (UTC+9)
  'search-number-inference', // nomor pencarian hanya bisa disimpulkan dari stage nihil
  'light-surface-wind',      // angin permukaan lemah, angin atas kuat
  'wind-shear-rotation',     // arah angin berputar besar antar ketinggian
] as const;
export type GeneratorTrap = (typeof GENERATOR_TRAPS)[number];

export const TRAP_LABELS: Record<GeneratorTrap, string> = {
  'heading-magnetic': 'Heading magnetik (konversi true)',
  'variation-west': 'Variation barat (W — dikurangi)',
  'midnight-crossing': 'Waktu MAYDAY lintas tengah malam',
  'wind-series-3h': 'Deret angin interval 3 jam',
  'zona-waktu-wita': 'Zona waktu WITA (UTC+8)',
  'zona-waktu-wit': 'Zona waktu WIT (UTC+9)',
  'search-number-inference': 'Nomor pencarian disimpulkan dari stage nihil',
  'light-surface-wind': 'Angin permukaan lemah vs angin atas kuat',
  'wind-shear-rotation': 'Wind shear — arah berputar antar ketinggian',
};

/** Jebakan minimum tersedia mulai tingkat kesulitan tertentu. */
const TRAP_MIN_DIFFICULTY: Record<GeneratorTrap, GeneratorDifficulty> = {
  'heading-magnetic': 'sedang',
  'variation-west': 'sedang',
  'midnight-crossing': 'sedang',
  'search-number-inference': 'sedang',
  'zona-waktu-wita': 'sedang',
  'zona-waktu-wit': 'sedang',
  'wind-series-3h': 'sulit',
  'light-surface-wind': 'sulit',
  'wind-shear-rotation': 'sulit',
};

const DIFFICULTY_ORDER: Record<GeneratorDifficulty, number> = { mudah: 0, sedang: 1, sulit: 2 };

export function trapAllowedForDifficulty(trap: GeneratorTrap, difficulty: GeneratorDifficulty): boolean {
  return DIFFICULTY_ORDER[difficulty] >= DIFFICULTY_ORDER[TRAP_MIN_DIFFICULTY[trap]];
}

function defaultTrapsFor(difficulty: GeneratorDifficulty, region: ScenarioRegion, rng: Rng): GeneratorTrap[] {
  if (difficulty === 'mudah') return [];
  if (difficulty === 'sedang') {
    const pool: GeneratorTrap[] = ['heading-magnetic', 'midnight-crossing', 'search-number-inference'];
    if (region.timeZone === 'WITA') pool.push('zona-waktu-wita');
    if (region.timeZone === 'WIT') pool.push('zona-waktu-wit');
    return rng.pickMany(pool, 2);
  }
  // sulit: pastikan variasi jebakan konversi + data
  const pool: GeneratorTrap[] = ['heading-magnetic', 'variation-west', 'wind-series-3h', 'light-surface-wind', 'wind-shear-rotation', 'midnight-crossing', 'search-number-inference'];
  const chosen = rng.pickMany(pool, 4);
  if (region.timeZone === 'WITA' && rng.bool(0.6)) chosen.push('zona-waktu-wita');
  if (region.timeZone === 'WIT' && rng.bool(0.6)) chosen.push('zona-waktu-wit');
  return chosen;
}

// ---------------------------------------------------------------------------
// Parameter generate
// ---------------------------------------------------------------------------

export interface GenerateCaseParams {
  /** Seed deterministik (string apa pun). */
  seed: string;
  incidentType: Extract<IncidentType, 'aircraft-ditching' | 'vessel-sinking'>;
  regionId: string;
  difficulty: GeneratorDifficulty;
  /** Override jebakan (opsional). Kosong = pilihan default per kesulitan. */
  traps?: GeneratorTrap[];
  /** Jumlah SRU (2-4). Default per kesulitan. */
  sruCount?: number;
  /** Tanggal kejadian ISO "YYYY-MM-DD" — wajib untuk determinisme. */
  incidentDateISO?: string;
  /** Header ujian (judul/diklat/angkatan/durasi). */
  examHeader?: {
    title?: string;
    trainingName?: string;
    angkatan?: string;
    year?: number;
    durationMinutes?: number;
    isOpenBook?: boolean;
  };
  /** Id entri bank aset untuk target (default: pilihan deterministik). */
  targetAssetId?: string;
  /** Id entri bank aset untuk SRU (default: pilihan deterministik). */
  sruAssetIds?: string[];
}

export interface GenerateCaseResult {
  case: SarCaseSchema;
  completeness: CaseCompleteness;
  /** Jebakan efektif yang diterapkan (setelah filter kesulitan & wilayah). */
  appliedTraps: GeneratorTrap[];
  /** Jebakan diminta tapi tidak bisa diterapkan + alasannya. */
  skippedTraps: Array<{ trap: GeneratorTrap; reason: string }>;
  warnings: string[];
  params: GenerateCaseParams & { incidentDateISO: string; sruCount: number };
}

// ---------------------------------------------------------------------------
// Helper tanggal/waktu (zona dari wilayah; format teks Basarnas)
// ---------------------------------------------------------------------------

const MONTHS_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

const DEFAULT_INCIDENT_DATE = '2026-03-17';

function parseDateISO(iso: string): { year: number; month: number; day: number; valid: boolean } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return { year: 2026, month: 3, day: 17, valid: false };
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const valid = month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 2000 && year <= 2100;
  return { year: valid ? year : 2026, month: valid ? month : 3, day: valid ? day : 17, valid };
}

function addDays(d: { year: number; month: number; day: number }, days: number): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(d.year, d.month - 1, d.day));
  dt.setUTCDate(dt.getUTCDate() + days);
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function formatIndoDate(d: { year: number; month: number; day: number }): string {
  return `${d.day} ${MONTHS_ID[d.month - 1]} ${d.year}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function timeString(hours: number, minutes: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.floor(minutes) % 60;
  return `${pad2(h)}.${pad2(m)}`;
}

// ---------------------------------------------------------------------------
// Pemilihan entri bank
// ---------------------------------------------------------------------------

const CALLSIGN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const KN_SAR_NAMES = ['Drupada', 'Gangga', 'Paguyangan', 'Kanawa', 'Burwani', 'Batu Ampar'];

const CAPTAIN_NAMES = ['Joko', 'Agus', 'Budi', 'Sari', 'Dewi', 'Rizky', 'Andi', 'Fitri', 'Hendra', 'Wawan'];

const DAMAGE_OPTIONS = ['kerusakan mesin', 'kehabisan bahan bakar', 'kerusakan sistem bahan bakar', 'tekanan oli mesin turun'];

const OBSERVER_CONDITIONS = ['fresh', 'fresh', 'fresh', 'fatigue'];

const TAF_OPTIONS = ['Inter', '1H', '3H'];

const VESSEL_NAME_PREFIX = ['TB.', 'KM ', 'MV '];

const VESSEL_NAME_BASE = ['Samudra', 'Bahari', 'Makmur', 'Sejahtera', 'Lestari'];

function sruCallsignFor(kind: CaseSru['kind'], rng: Rng, used: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let cs: string;
    if (kind === 'vessel') cs = `KN SAR ${rng.pick(KN_SAR_NAMES)}`;
    else if (kind === 'helicopter') cs = `HR-${rng.int(3000, 3999)}`;
    else cs = `PK-${rng.pick(CALLSIGN_LETTERS.split(''))}${rng.pick(CALLSIGN_LETTERS.split(''))}${rng.pick(CALLSIGN_LETTERS.split(''))}`;
    if (!used.has(cs)) {
      used.add(cs);
      return cs;
    }
  }
  const fallback = `SRU-${rng.int(100, 999)}`;
  used.add(fallback);
  return fallback;
}

function pickTargetAsset(params: GenerateCaseParams, rng: Rng): BankEntry {
  const candidates = listScenarioBank('asset').filter((e) =>
    e.category === (params.incidentType === 'aircraft-ditching' ? 'fixed-wing' : 'vessel')
    && e.specs.lengthM !== undefined
    && e.specs.cruiseSpeedKts !== undefined);
  if (params.targetAssetId) {
    const chosen = candidates.find((e) => e.id === params.targetAssetId);
    if (chosen) return chosen;
  }
  return rng.pick(candidates);
}

function pickSruAssets(params: GenerateCaseParams, rng: Rng, count: number): BankEntry[] {
  const usable = listScenarioBank('asset').filter(isSruUsableAsset);
  const helis = usable.filter((e) => e.category === 'helicopter');
  const vessels = usable.filter((e) => e.category === 'vessel');
  const picked: BankEntry[] = [];

  if (params.sruAssetIds && params.sruAssetIds.length > 0) {
    for (const id of params.sruAssetIds.slice(0, count)) {
      const found = usable.find((e) => e.id === id);
      if (found && !picked.includes(found)) picked.push(found);
    }
  }
  // Komposisi wajar: ≥1 helikopter + ≥1 kapal, sisanya campuran.
  const needHeli = Math.max(1, count - 1);
  for (const h of rng.pickMany(helis, needHeli)) {
    if (picked.length < count) picked.push(h);
  }
  for (const v of rng.pickMany(vessels, 1)) {
    if (picked.length < count) picked.push(v);
  }
  while (picked.length < count) {
    const rest = usable.filter((e) => !picked.includes(e));
    if (rest.length === 0) break;
    picked.push(rng.pick(rest));
  }
  return picked.slice(0, count);
}

function pickSruHomeLocation(region: ScenarioRegion, preferCategory: 'helipad' | 'pelabuhan', rng: Rng): { lat: number; lng: number } | null {
  const withCoord = listScenarioBank('location').filter((e) =>
    e.specs.region === region.bankRegion && e.lat !== undefined && e.lng !== undefined);
  const preferred = withCoord.filter((e) => e.category === preferCategory);
  const pool = preferred.length > 0 ? preferred : withCoord;
  if (pool.length === 0) return null;
  const c = rng.pick(pool);
  return { lat: c.lat as number, lng: c.lng as number };
}

function pickInfoSource(region: ScenarioRegion, rng: Rng): string {
  const byRegion: Record<string, string[]> = {
    'teluk-jakarta': ['Jakarta Air Traffic Service (JATSC)'],
    'selat-sunda': ['Jakarta Air Traffic Service (JATSC)', 'ATS Lampung'],
    'selat-makassar': ['Air Traffic Service Center (ATSC) Makassar', 'ATS Balikpapan'],
    'selat-bali': ['ATS Bali'],
    'selat-karimata': ['ATS Pontianak'],
    'selat-bangka': ['ATS Palembang'],
    'laut-jawa': ['ATS Semarang', 'Jakarta Air Traffic Service (JATSC)'],
    'selat-sorong': ['ATS Sorong'],
  };
  const options = byRegion[region.id] ?? ['Air Traffic Service (ATS) setempat'];
  return rng.pick(options);
}

function pickLeewayObjectIdForVessel(targetEntry: BankEntry): string {
  const length = targetEntry.specs.lengthM ?? 0;
  if (length <= 8) return 'skiff-v-hull';
  if (length <= 12) return 'small-fishing';
  if (length <= 27) return 'commercial-fishing';
  return 'merchant-vessel';
}

// ---------------------------------------------------------------------------
// Deret angin & tabel angin per ketinggian
// ---------------------------------------------------------------------------

const AIRCRAFT_WIND_LAYERS: Array<{ ft: number; label: string }> = [
  { ft: 0, label: 'Surface' },
  { ft: 3000, label: '3000 Feet' },
  { ft: 6000, label: '6000 Feet' },
  { ft: 9000, label: '9000 Feet' },
  { ft: 12000, label: '12000 Feet' },
  { ft: 18000, label: '18000 Feet' },
  { ft: 24000, label: '24000 Feet' },
];

function buildWindLayers(
  rng: Rng,
  windBase: number,
  difficulty: GeneratorDifficulty,
  traps: Set<GeneratorTrap>,
): WindLayer[] {
  const rotationPerLayer = traps.has('wind-shear-rotation') ? rng.int(18, 32) : rng.int(6, 14);
  return AIRCRAFT_WIND_LAYERS.map((layer, idx) => {
    const dir = rng.angle(windBase + rotationPerLayer * idx, 8);
    let speed: number;
    if (layer.ft === 0) {
      speed = traps.has('light-surface-wind') ? rng.int(2, 5) : rng.int(4, 10);
    } else {
      const floor = difficulty === 'mudah' ? 5 : 8;
      const ceil = difficulty === 'sulit' ? 25 : 20;
      speed = rng.int(floor, ceil);
    }
    return { altitudeFt: layer.ft, altitudeLabel: layer.label, windDirFrom: dir, windSpeedKts: speed };
  });
}

function buildSurfaceWindSeries(
  rng: Rng,
  windBase: number,
  incidentDay: { year: number; month: number; day: number },
  datumDay: { year: number; month: number; day: number },
  timeZone: TimeZoneId,
  traps: Set<GeneratorTrap>,
  difficulty: GeneratorDifficulty,
): SurfaceWindEntry[] {
  const speedCeil = difficulty === 'sulit' ? 18 : difficulty === 'sedang' ? 14 : 10;
  const entries: SurfaceWindEntry[] = [];
  const day0Label = formatIndoDate(incidentDay);
  const day1Label = formatIndoDate(datumDay);
  // Deret selalu mencakup hari kejadian s.d. pagi hari datum supaya ASW punya
  // pengamatan sampai Datum Time (gaya PK-TAL).
  if (traps.has('wind-series-3h')) {
    for (const h of [0, 3, 6, 9, 12, 15, 18, 21]) {
      entries.push({ obsTime: `${day0Label} ${timeString(h, 0)} ${timeZone}`, windDirFrom: rng.angle(windBase, 25), windSpeedKts: rng.int(3, speedCeil) });
    }
    entries.push({ obsTime: `${day1Label} 00.00 ${timeZone}`, windDirFrom: rng.angle(windBase, 25), windSpeedKts: rng.int(3, speedCeil) });
    entries.push({ obsTime: `${day1Label} 03.00 ${timeZone}`, windDirFrom: rng.angle(windBase, 25), windSpeedKts: rng.int(3, speedCeil) });
    entries.push({ obsTime: `${day1Label} 06.00 ${timeZone}`, windDirFrom: rng.angle(windBase, 25), windSpeedKts: rng.int(3, speedCeil) });
  } else {
    for (const h of [0, 6, 12, 18]) {
      entries.push({ obsTime: `${day0Label} ${timeString(h, 0)} ${timeZone}`, windDirFrom: rng.angle(windBase, 25), windSpeedKts: rng.int(3, speedCeil) });
    }
    entries.push({ obsTime: `${day1Label} 00.00 ${timeZone}`, windDirFrom: rng.angle(windBase, 25), windSpeedKts: rng.int(3, speedCeil) });
    entries.push({ obsTime: `${day1Label} 06.00 ${timeZone}`, windDirFrom: rng.angle(windBase, 25), windSpeedKts: rng.int(3, speedCeil) });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Kelengkapan per jenis insiden
// ---------------------------------------------------------------------------

/** Kelengkapan kasus generator — dispatch per jenis insiden.
 *  aircraft-ditching memakai `checkCaseCompleteness()` Fase 1 (perilaku
 *  existing tidak diubah); jenis lain punya aturan sendiri. */
export function checkGeneratedCaseCompleteness(
  sarCase: SarCaseSchema,
  planner: CasePlannerInputs = {},
): CaseCompleteness {
  if (sarCase.incident.type === 'aircraft-ditching') {
    return checkCaseCompleteness(sarCase, planner);
  }
  const issues: CaseCompleteness['issues'] = [];
  const push = (field: string, worksheet: string, reason: string) =>
    issues.push({ status: 'MISSING', field, worksheet, reason });

  if (!sarCase.incident.lastContactTime) push('incident.lastContactTime', 'ASW', 'Waktu kontak terakhir tidak ada.');
  if (!sarCase.search?.datumTime) push('search.datumTime', 'ASW/Datum', 'Datum Time tidak ada.');
  if (!sarCase.lkp?.coord) push('lkp.coord', 'Datum WS 1', 'Koordinat LKP (posisi terakhir) tidak ada.');
  if (!sarCase.sea?.current) push('sea.current', 'Datum WS 1', 'Arus laut tidak ada.');
  if ((sarCase.sea?.surfaceWindSeries?.length ?? 0) === 0) push('sea.surfaceWindSeries', 'ASW', 'Deret angin permukaan tidak ada.');
  if (sarCase.incident.pob === undefined) push('incident.pob', 'Perencanaan', 'POB tidak ada.');
  if (sarCase.target?.lengthM === undefined) push('target.lengthM', 'Datum WS 1', 'Panjang target (kategori leeway) tidak ada.');
  for (const sru of sarCase.sru ?? []) {
    if (sru.tasSearchKts === undefined) push(`sru[${sru.callsign}].tasSearchKts`, sru.kind === 'vessel' ? 'WS 8' : 'WS 2', 'Speed di area pencarian tidak ada.');
    if (sru.visibilityKm === undefined) push(`sru[${sru.callsign}].visibilityKm`, sru.kind === 'vessel' ? 'WS 8' : 'WS 2', 'Visibility SRU tidak ada.');
    if (sru.coord === undefined) push(`sru[${sru.callsign}].coord`, 'Alokasi Aset', 'Koordinat lokasi aset tidak ada.');
  }

  return { complete: issues.length === 0, issues, missingCount: issues.length, assumedCount: 0 };
}

// ---------------------------------------------------------------------------
// Generator utama
// ---------------------------------------------------------------------------

export function generateCase(params: GenerateCaseParams): GenerateCaseResult {
  const warnings: string[] = [];
  const skippedTraps: GenerateCaseResult['skippedTraps'] = [];

  const region = findScenarioRegion(params.regionId) ?? SCENARIO_REGIONS[0];
  if (!findScenarioRegion(params.regionId)) {
    warnings.push(`Region "${params.regionId}" tidak dikenal — memakai "${region.id}".`);
  }

  const incidentDate = parseDateISO(params.incidentDateISO ?? DEFAULT_INCIDENT_DATE);
  if (params.incidentDateISO && !incidentDate.valid) {
    warnings.push(`incidentDateISO "${params.incidentDateISO}" tidak valid — memakai ${DEFAULT_INCIDENT_DATE}.`);
  }

  const rng = createRng([
    params.seed,
    params.incidentType,
    region.id,
    params.difficulty,
    params.traps?.join(',') ?? '',
    params.sruCount ?? '',
    `${incidentDate.year}-${incidentDate.month}-${incidentDate.day}`,
    params.targetAssetId ?? '',
    params.sruAssetIds?.join(',') ?? '',
  ].join('|'));

  const season = seasonOfMonth(incidentDate.month);
  const windBase = region.windBaseBySeason[season];
  const datumDay = addDays(incidentDate, 1);
  const timeZone = region.timeZone;

  // ── Jebakan ──
  let traps: GeneratorTrap[];
  if (params.traps && params.traps.length > 0) {
    traps = [];
    for (const t of params.traps) {
      if (!trapAllowedForDifficulty(t, params.difficulty)) {
        skippedTraps.push({ trap: t, reason: `tidak tersedia pada kesulitan "${params.difficulty}"` });
        continue;
      }
      if ((t === 'zona-waktu-wita' && region.timeZone !== 'WITA') || (t === 'zona-waktu-wit' && region.timeZone !== 'WIT')) {
        skippedTraps.push({ trap: t, reason: `wilayah "${region.name}" memakai ${region.timeZone}` });
        continue;
      }
      if (t === 'variation-west' && !(params.traps.includes('heading-magnetic'))) {
        skippedTraps.push({ trap: t, reason: 'butuh jebakan heading-magnetic aktif agar konversi terasa' });
        continue;
      }
      traps.push(t);
    }
  } else {
    traps = defaultTrapsFor(params.difficulty, region, rng);
  }
  const trapSet = new Set<GeneratorTrap>(traps);

  // ── Waktu kejadian ──
  const midnight = trapSet.has('midnight-crossing');
  const lastContactHour = midnight ? 23 : rng.int(12, 16);
  const lastContactMin = midnight ? rng.pick([10, 20, 25, 35]) : rng.pick([0, 10, 20, 30, 50]);
  const reportOffsetMin = midnight ? rng.int(10, 25) : rng.int(15, 40);
  let reportHour = lastContactHour;
  let reportMin = lastContactMin + reportOffsetMin;
  if (reportMin >= 60) {
    reportMin -= 60;
    reportHour = (reportHour + 1) % 24;
  }
  const reportRollsOver = reportHour < lastContactHour;
  const reportDate = reportRollsOver ? addDays(incidentDate, 1) : incidentDate;
  const datumHour = rng.int(6, 8);

  const lastContactTime = `${formatIndoDate(incidentDate)} ${timeString(lastContactHour, lastContactMin)} ${timeZone}`;
  const reportTime = `${formatIndoDate(reportDate)} ${timeString(reportHour, reportMin)} ${timeZone}`;
  const datumTime = `${formatIndoDate(datumDay)} ${timeString(datumHour, 0)} ${timeZone}`;

  // ── Lokasi lost contact / LKP ──
  const lkpCoord = {
    lat: Math.round((region.center.lat + rng.float(-0.45, 0.45, 0.005)) * 1e6) / 1e6,
    lng: Math.round((region.center.lng + rng.float(-0.45, 0.45, 0.005)) * 1e6) / 1e6,
  };

  // ── Target & perlengkapan keselamatan ──
  const targetEntry = pickTargetAsset(params, rng);
  const target = bankEntryToCaseTarget(targetEntry);
  const rafts = listScenarioBank('asset').filter((e) => e.category === 'liferaft' && e.specs.lifeRaftCapacityPerRaft !== undefined);
  const raftEntry = rng.pick(rafts);
  const raftCapacity = raftEntry.specs.lifeRaftCapacityPerRaft ?? 6;
  const lifeRaftCount = rng.int(1, 2);
  const pobMax = raftCapacity * lifeRaftCount;
  const pobUpper = targetEntry.category === 'fixed-wing' ? Math.min(pobMax, 19) : Math.min(pobMax, 22);
  const pob = Math.max(2, rng.int(3, Math.max(3, pobUpper)));
  target.leewayObjectId = params.incidentType === 'aircraft-ditching'
    ? (raftCapacity <= 6 ? 'raft-aviation-46' : 'raft-1520-person')
    : pickLeewayObjectIdForVessel(targetEntry);

  // ── Insiden ──
  const callsignLetters = `${rng.pick(CALLSIGN_LETTERS.split(''))}${rng.pick(CALLSIGN_LETTERS.split(''))}${rng.pick(CALLSIGN_LETTERS.split(''))}`;
  const callsign = params.incidentType === 'aircraft-ditching'
    ? `PK-${callsignLetters}`
    : `${rng.pick(VESSEL_NAME_PREFIX)} ${rng.pick(VESSEL_NAME_BASE)}-${rng.int(1, 99)}`;
  const infoSource = pickInfoSource(region, rng);
  // FL ≤ 200: layer angin tertinggi tabel soal 24000 ft — AWA menuntut data
  // angin pada/di atas ketinggian distress (FL250 akan membuat AWA gagal).
  const flightLevel = rng.pick([100, 150, 200]);
  const heading = rng.int(45, 315);
  const headingReference = trapSet.has('heading-magnetic') ? 'magnetic' : 'true';

  // ── Variation ──
  const variationDeg = rng.float(0.5, 3, 0.5);
  const variationDirection = trapSet.has('variation-west') ? 'W' : 'E';

  // ── Kantor SAR + radial ──
  const officeCandidates = listScenarioBank('location').filter((e) =>
    e.category === 'kantor-sar' && e.specs.region === region.bankRegion);
  const officeEntry = officeCandidates.length > 0 ? rng.pick(officeCandidates) : undefined;
  const officeName = officeEntry?.name ?? `Kantor SAR wilayah ${region.name}`;
  const radialDeg = rng.int(0, 71) * 5;
  const transitHours = rng.float(1, 5, 0.5);

  // ── Blok laut ──
  const currentCeil = difficultyOr(params.difficulty, {
    mudah: region.currentBase.speedMinKts + 0.2,
    sedang: (region.currentBase.speedMinKts + region.currentBase.speedMaxKts) / 2,
    sulit: region.currentBase.speedMaxKts,
  });
  const currentSpeed = rng.float(region.currentBase.speedMinKts, currentCeil, 0.1);
  const currentDir = rng.angle(region.currentBase.dirToDeg, params.difficulty === 'mudah' ? 15 : 40);
  const surfaceWindSeries = buildSurfaceWindSeries(rng, windBase, incidentDate, datumDay, timeZone, trapSet, params.difficulty);
  const waveHeightM = rng.float(0.8, 2.5, 0.1);

  // ── Pencarian ──
  const stagesCount = params.difficulty === 'mudah' ? rng.int(1, 2) : rng.int(1, 3);
  const stagesDone = Array.from({ length: stagesCount }, (_, i) => ({
    stage: i + 1,
    result: 'sudah dilakukan, belum membuahkan hasil',
  }));
  const searchNumber = stagesCount + 1;

  // ── SRU ──
  const requestedSru = params.sruCount ?? (params.difficulty === 'mudah' ? 2 : 3);
  const sruCount = Math.min(4, Math.max(2, requestedSru));
  if (requestedSru < 2 || requestedSru > 4) {
    warnings.push(`sruCount ${requestedSru} di luar rentang 2-4 — memakai ${sruCount}.`);
  }
  const sruEntries = pickSruAssets(params, rng, sruCount);
  if (sruEntries.length < sruCount) {
    warnings.push(`Bank aset SRU hanya menyediakan ${sruEntries.length} entri lengkap — jumlah SRU dikurangi.`);
  }
  const usedCallsigns = new Set<string>();
  const captains = rng.pickMany(CAPTAIN_NAMES, sruEntries.length);
  const sruList: CaseSru[] = sruEntries.map((entry, idx) => {
    const kind: CaseSru['kind'] = entry.category === 'vessel' ? 'vessel' : entry.category === 'fixed-wing' ? 'fixed-wing' : 'helicopter';
    const home = pickSruHomeLocation(region, kind === 'vessel' ? 'pelabuhan' : 'helipad', rng);
    const basePos = home ?? {
      lat: region.center.lat + rng.float(-0.2, 0.2, 0.01),
      lng: region.center.lng + rng.float(-0.2, 0.2, 0.01),
    };
    const coord = {
      lat: Math.round((basePos.lat + rng.float(-0.02, 0.02, 0.005)) * 1e6) / 1e6,
      lng: Math.round((basePos.lng + rng.float(-0.02, 0.02, 0.005)) * 1e6) / 1e6,
    };
    return bankEntryToCaseSru(entry, sruCallsignFor(kind, rng, usedCallsigns), {
      coord,
      windDirFrom: rng.angle(windBase, 30),
      windSpeedKts: rng.int(5, 20),
      observerCondition: rng.pick(OBSERVER_CONDITIONS),
      taf: rng.pick(TAF_OPTIONS),
      captain: captains[idx % captains.length],
      phoneSatellite: `870${rng.int(100000, 999999)}`,
      visibilityKm: entry.specs.visibilityKm ?? rng.pick([10, 15, 20]),
    });
  });

  // ── Rakit kasus ──
  const examHeader = params.examHeader ?? {};

  const draft: SarCaseSchema = {
    schemaVersion: 1,
    caseTitle: `Soal Latihan ${region.name} — ${callsign}`,
    examHeader: {
      title: examHeader.title ?? 'SOAL LATIHAN',
      trainingName: examHeader.trainingName ?? 'Diklat SAR Tingkat Spesialis SAR Planning',
      ...(examHeader.angkatan ? { angkatan: examHeader.angkatan } : {}),
      year: examHeader.year ?? incidentDate.year,
      durationMinutes: examHeader.durationMinutes ?? 360,
      isOpenBook: examHeader.isOpenBook ?? true,
      examDate: formatIndoDate(datumDay),
    },
    incident: {
      type: params.incidentType,
      callsign,
      craftType: targetEntry.name,
      pob,
      lifeRaftCount,
      lifeRaftCapacityPerRaft: raftCapacity,
      infoSource,
      reportTime,
      lastContactTime,
      ...(params.incidentType === 'aircraft-ditching'
        ? {
            checkpoint: rng.pick(['SIMAB', 'SIMUC', 'SIMID', 'SIMOL', 'SIMUX']),
            flightLevelFt: flightLevel,
            headingDeg: heading,
            headingReference: headingReference as 'magnetic' | 'true',
            damageDescription: rng.pick(DAMAGE_OPTIONS),
            ditchingIndication: 'diindikasikan akan ditching',
          }
        : {}),
    },
    target,
    sarOffice: {
      name: officeName,
      radialDegToLkp: radialDeg,
      transitHoursToLkp: transitHours,
    },
    lkp: {
      coord: {
        lat: lkpCoord.lat,
        lng: lkpCoord.lng,
        dmsLat: formatDMS(lkpCoord.lat, false),
        dmsLng: formatDMS(lkpCoord.lng, true),
      },
      source: 'explicit',
    },
    ...(params.incidentType === 'aircraft-ditching'
      ? {
          aeroDrift: {
            glideSpeedKts: rng.int(95, 135),
            glideRatio: rng.int(5, 9),
            variationDeg,
            variationDirection: variationDirection as 'E' | 'W',
            windLayers: buildWindLayers(rng, windBase, params.difficulty, trapSet),
          },
        }
      : {}),
    sea: {
      current: { dirToDeg: currentDir, speedKts: currentSpeed },
      surfaceWindSeries,
      waveHeightM,
    },
    search: {
      datumTime,
      stagesDone,
      visibilityKm: rng.int(10, 30),
      searchNumber,
    },
    sru: sruList,
    tasksRequested: params.incidentType === 'aircraft-ditching'
      ? ['aeronautical-drift', 'asw', 'search-area-abcd', 'wsc-pod', 'asset-allocation', 'search-pattern-csp', 'sru-task-assignment']
      : ['asw', 'search-area-abcd', 'wsc-pod', 'asset-allocation', 'search-pattern-csp', 'sru-task-assignment'],
    meta: {
      source: 'generator',
      seed: params.seed,
      extractedAt: formatIndoDate(incidentDate),
      approval: 'DRAFT',
      assumptions: [
        {
          field: 'meta.source',
          value: 'generator',
          reason: `Seluruh nilai kasus dihasilkan generator ber-seed "${params.seed}" untuk LATIHAN — data berstatus SIMULATION, bukan data cuaca/operasi resmi.`,
        },
        {
          field: 'datum.x/y nav aid',
          reason: 'Alat navigasi distress craft & SRU (Tabel J-1) tidak disebut di naskah — default 0 NM sampai planner memilih.',
        },
      ],
      fieldSources: [
        { field: 'incident', source: `Generator seed "${params.seed}" (wilayah ${region.name}, kesulitan ${params.difficulty})`, status: 'SIMULATION' },
        ...(params.incidentType === 'aircraft-ditching'
          ? [{ field: 'aeroDrift.windLayers', source: 'Model musim generator (SIMULATION) — bukan data meteorologi resmi', status: 'SIMULATION' as const }]
          : []),
        { field: 'sea', source: 'Model arus/angin generator (SIMULATION) — bukan data oceanografi resmi', status: 'SIMULATION' },
        { field: 'target', source: `Bank aset: ${targetEntry.name} (${targetEntry.verification})`, status: targetEntry.verification === 'VERIFIED' ? 'VERIFIED' : 'SIMULATION' },
        { field: 'sru', source: 'Bank aset + posisi latihan generator (SIMULATION)', status: 'SIMULATION' },
      ],
    },
  };

  // ── Validasi + kelengkapan ──
  const parsed = sarCaseSchema.safeParse(draft);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Generator menghasilkan kasus tidak valid — ${issues}`);
  }

  const planner: CasePlannerInputs = { leewayObjectId: target.leewayObjectId, xNm: 0, yNm: 0 };
  const completeness = checkGeneratedCaseCompleteness(parsed.data, planner);
  if (!completeness.complete) {
    const detail = completeness.issues.map((i) => `${i.field}: ${i.reason}`).join('; ');
    throw new Error(`Kasus generator tidak lengkap — ${detail}`);
  }

  return {
    case: parsed.data,
    completeness,
    appliedTraps: traps,
    skippedTraps,
    warnings,
    params: {
      ...params,
      incidentDateISO: `${incidentDate.year}-${pad2(incidentDate.month)}-${pad2(incidentDate.day)}`,
      sruCount: sruList.length,
    },
  };
}

function difficultyOr<T>(difficulty: GeneratorDifficulty, table: Record<GeneratorDifficulty, T>): T {
  return table[difficulty];
}

/** Deskripsi kapabilitas generator untuk API/UI (form parameter). */
export function describeGeneratorCapabilities() {
  return {
    difficulties: GENERATOR_DIFFICULTIES,
    traps: GENERATOR_TRAPS.map((id) => ({ id, label: TRAP_LABELS[id], minDifficulty: TRAP_MIN_DIFFICULTY[id] })),
    regions: SCENARIO_REGIONS.map((r) => ({
      id: r.id,
      name: r.name,
      timeZone: r.timeZone,
      currentBase: r.currentBase,
      windBaseBySeason: r.windBaseBySeason,
    })),
    incidentTypes: ['aircraft-ditching', 'vessel-sinking'] as const,
    defaultIncidentDateISO: DEFAULT_INCIDENT_DATE,
    bank: {
      sruUsableAssets: SCENARIO_BANK_SEED.filter(isSruUsableAsset).map((e) => ({ id: e.id, name: e.name, category: e.category, verification: e.verification })),
      targetAssets: SCENARIO_BANK_SEED.filter((e) => e.kind === 'asset' && e.specs.lengthM !== undefined && e.specs.cruiseSpeedKts !== undefined).map((e) => ({ id: e.id, name: e.name, category: e.category, verification: e.verification })),
      offices: SCENARIO_BANK_SEED.filter((e) => e.category === 'kantor-sar').map((e) => ({ id: e.id, name: e.name, region: e.specs.region, verification: e.verification })),
    },
  };
}
