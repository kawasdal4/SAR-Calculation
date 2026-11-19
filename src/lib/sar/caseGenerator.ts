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
  CaseTarget,
  CaseCoord,
  WindLayer,
  SurfaceWindEntry,
} from './caseSchema';
import { sarCaseSchema } from './caseSchema';
import { LEEWAY_OBJECT_TYPES, bearingDeg } from './sarCalculations';
import { pointInKansarPolygon } from './kansarBoundaries';
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

function trapsForCount(difficulty: GeneratorDifficulty, region: ScenarioRegion, rng: Rng, count: number, excludeMidnight = false): GeneratorTrap[] {
  if (count <= 0) return [];
  if (difficulty === 'mudah') return [];
  const pool: GeneratorTrap[] = [];
  if (difficulty === 'sedang') {
    pool.push('heading-magnetic', 'search-number-inference');
    if (!excludeMidnight) pool.push('midnight-crossing');
    if (region.timeZone === 'WITA') pool.push('zona-waktu-wita');
    if (region.timeZone === 'WIT') pool.push('zona-waktu-wit');
  } else {
    pool.push('heading-magnetic', 'variation-west', 'wind-series-3h', 'light-surface-wind', 'wind-shear-rotation', 'search-number-inference');
    if (!excludeMidnight) pool.push('midnight-crossing');
    if (region.timeZone === 'WITA') pool.push('zona-waktu-wita');
    if (region.timeZone === 'WIT') pool.push('zona-waktu-wit');
  }
  return rng.pickMany(pool, Math.min(count, pool.length));
}

function defaultTrapsFor(difficulty: GeneratorDifficulty, region: ScenarioRegion, rng: Rng, trapCountOverride?: number, excludeMidnight = false): GeneratorTrap[] {
  const profile = DIFFICULTY_KNOB_PROFILES[difficulty];
  const count = trapCountOverride ?? rng.int(profile.trapCount[0], profile.trapCount[1]);
  return trapsForCount(difficulty, region, rng, count, excludeMidnight);
}

// ---------------------------------------------------------------------------
// Parameter generate
// ---------------------------------------------------------------------------

/** Versi generator — disimpan di meta agar soal dapat direproduksi dengan
 *  konfigurasi + versi yang sama (requirement Fase 5b no. 7). */
export const GENERATOR_VERSION = '5b';

/** Jenis kejadian yang didukung generator (Fase 5b: 5 jenis). */
export const GENERATOR_INCIDENT_TYPES = [
  'aircraft-ditching',
  'aircraft-land-crash',
  'vessel-sinking',
  'person-overboard',
  'missing-person-land',
] as const;
export type GeneratorIncidentType = (typeof GENERATOR_INCIDENT_TYPES)[number];

export const GENERATOR_INCIDENT_LABELS: Record<GeneratorIncidentType, string> = {
  'aircraft-ditching': 'Aircraft ditching (pesawat mendarat darurat di laut)',
  'aircraft-land-crash': 'Aircraft crash on land (pesawat jatuh di darat)',
  'vessel-sinking': 'Ship sinking (kapal darurat / tenggelam)',
  'person-overboard': 'Man Overboard (orang jatuh ke laut)',
  'missing-person-land': 'Missing person / land search (orang hilang di darat)',
};

/** Knob kesulitan eksplisit (requirement Fase 5b no. 3) — diatur kode, bukan
 *  penilaian LLM. Nilai [min, max] = rentang acak default per kesulitan. */
export interface DifficultyKnobProfile {
  sruCount: number;
  /** Stage pencarian sebelumnya yang sudah nihil. */
  stagesBefore: [number, number];
  /** Jumlah data lingkungan (entri deret angin permukaan). */
  envDataPoints: [number, number];
  /** Jumlah distrik/instansi pendukung yang disebut. */
  districtDataCount: number;
  /** Jumlah jebakan analisis. */
  trapCount: [number, number];
}

export const DIFFICULTY_KNOB_PROFILES: Record<GeneratorDifficulty, DifficultyKnobProfile> = {
  mudah: { sruCount: 2, stagesBefore: [1, 2], envDataPoints: [6, 6], districtDataCount: 0, trapCount: [0, 0] },
  sedang: { sruCount: 3, stagesBefore: [1, 3], envDataPoints: [6, 6], districtDataCount: 0, trapCount: [2, 2] },
  // sruCount sulit tetap 3 = perilaku Fase 5a (knob dapat dinaikkan pengguna).
  sulit: { sruCount: 3, stagesBefore: [1, 3], envDataPoints: [6, 11], districtDataCount: 0, trapCount: [4, 5] },
};

export interface GenerateCaseParams {
  /** Seed deterministik (string apa pun). */
  seed: string;
  incidentType: GeneratorIncidentType;
  regionId: string;
  difficulty: GeneratorDifficulty;
  /** Override jebakan (opsional). Kosong = pilihan default per kesulitan. */
  traps?: GeneratorTrap[];
  /** Jumlah SRU (2-4). Default per kesulitan. */
  sruCount?: number;
  /** Knob Fase 5b — stage pencarian sebelumnya yang sudah nihil (0-4). */
  stagesBefore?: number;
  /** Knob Fase 5b — jumlah data lingkungan (entri deret angin permukaan, 4-12). */
  envDataPoints?: number;
  /** Knob Fase 5b — jumlah distrik/instansi pendukung yang disebut (0-5). */
  districtDataCount?: number;
  /** Knob Fase 5b — jumlah jebakan analisis (0-6) bila traps tidak disetel. */
  trapCount?: number;
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
  /** Nilai knob efektif setelah resolusi profil kesulitan + override. */
  resolvedKnobs: {
    sruCount: number;
    stagesBefore: number;
    envDataPoints: number;
    districtDataCount: number;
    trapCount: number;
  };
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

function pickTargetAsset(params: GenerateCaseParams, rng: Rng): BankEntry | undefined {
  // MOB & missing-person: target = orang (tanpa entri aset pesawat/kapal).
  if (params.incidentType === 'person-overboard' || params.incidentType === 'missing-person-land') {
    return undefined;
  }
  const wantCategory = params.incidentType === 'vessel-sinking' ? 'vessel' : 'fixed-wing';
  const candidates = listScenarioBank('asset').filter((e) =>
    e.category === wantCategory
    && e.specs.lengthM !== undefined
    && e.specs.cruiseSpeedKts !== undefined);
  if (params.targetAssetId) {
    const chosen = candidates.find((e) => e.id === params.targetAssetId);
    if (chosen) return chosen;
  }
  return rng.pick(candidates);
}

function pickSruAssets(params: GenerateCaseParams, rng: Rng, count: number, landOnly = false): BankEntry[] {
  const usable = listScenarioBank('asset').filter(isSruUsableAsset);
  const helis = usable.filter((e) => e.category === 'helicopter');
  const fixedWings = usable.filter((e) => e.category === 'fixed-wing');
  const vessels = usable.filter((e) => e.category === 'vessel');
  const picked: BankEntry[] = [];

  if (params.sruAssetIds && params.sruAssetIds.length > 0) {
    for (const id of params.sruAssetIds.slice(0, count)) {
      const found = usable.find((e) => e.id === id);
      if (found && !picked.includes(found)) picked.push(found);
    }
  }
  if (landOnly) {
    // Pencarian darat: SRU udara saja (helikopter + pesawat) — komposisi campur.
    const air = [...helis, ...fixedWings];
    const needHeli = Math.max(1, Math.min(count - 1, helis.length));
    for (const h of rng.pickMany(helis, needHeli)) {
      if (picked.length < count) picked.push(h);
    }
    for (const f of rng.pickMany(fixedWings, count)) {
      if (picked.length < count && !picked.includes(f)) picked.push(f);
    }
    while (picked.length < count) {
      const rest = air.filter((e) => !picked.includes(e));
      if (rest.length === 0) break;
      picked.push(rng.pick(rest));
    }
    return picked.slice(0, count);
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
// Fase 5b — helper jenis kejadian baru (MOB, darat)
// ---------------------------------------------------------------------------

const MISSING_PERSON_NAMES = ['Supriyadi', 'Marlina', 'Hasan Basri', 'Yulius', 'Rina Wati', 'Bambang Sueb', 'Nurhayati', 'Piter Goni', 'Yohanes Kaka', 'Fredrik S'];

const MISSING_PERSON_ROLES = ['pendaki gunung', 'nelayan', 'pejalan kaki', 'warga desa', 'petani'];

/** Kelas kapal untuk narasi MOB (kapal asal orang jatuh). */
const MOB_SHIP_TYPES = ['kapal nelayan', 'kapal patroli', 'perahu patroli', 'kapal tunda', 'kapal kargo kecil'];

/** Kategori leeway PIW Tabel I-1 yang dipakai kasus MOB (orang di air). */
const PIW_LEEWAY_IDS = ['piw-novice', 'piw-sitting', 'piw-vertical-2', 'piw-lifejacket'] as const;

/** Visibilitas Tabel I-9 pencarian darat (kolom km). */
const LAND_VISIBILITIES_KM = [5, 10, 20, 30, 40] as const;

/** Vegetasi Tabel I-10 default per kesulitan (mudah = jarang → Fv besar). */
export function defaultVegetationFor(difficulty: GeneratorDifficulty, rng: Rng): 'under-15' | '15-60' | '60-85' | 'over-85' {
  if (difficulty === 'mudah') return 'under-15';
  if (difficulty === 'sedang') return rng.pick(['under-15', '15-60'] as const);
  return rng.pick(['60-85', 'over-85', '15-60'] as const);
}

/** Jarak great-circle antar koordinat (NM) — haversine, untuk rute darat WS 4. */
export function haversineNm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R_NM = 3440.065;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Interpolasi linear antar dua koordinat (fraksi 0-1) — posisi terakhir di rute. */
function interpolateCoord(a: { lat: number; lng: number }, b: { lat: number; lng: number }, f: number): { lat: number; lng: number } {
  return {
    lat: Math.round((a.lat + (b.lat - a.lat) * f) * 1e6) / 1e6,
    lng: Math.round((a.lng + (b.lng - a.lng) * f) * 1e6) / 1e6,
  };
}

/** Titik referensi darat di wilayah (bandara → titik referensi → kantor → apa pun berkoordinat). */
function pickLandReference(region: ScenarioRegion, rng: Rng): BankEntry | undefined {
  const withCoord = listScenarioBank('location').filter((e) =>
    e.specs.region === region.bankRegion && e.lat !== undefined && e.lng !== undefined);
  const order = ['bandara', 'titik-referensi', 'kantor-sar', 'helipad', 'pelabuhan'];
  for (const category of order) {
    const pool = withCoord.filter((e) => e.category === category);
    if (pool.length > 0) return rng.pick(pool);
  }
  return withCoord.length > 0 ? rng.pick(withCoord) : undefined;
}

/** Kategori target pencarian darat WS 3 (Tabel I-9/I-10) dari target/insiden.
 *  `targetLike` menerima entri bank ATAU CaseTarget (mtowKg/wingspanM). */
export function landTargetIdFor(
  incidentType: GeneratorIncidentType,
  targetLike?: { mtowKg?: number; wingspanM?: number },
): 'person' | 'vehicle' | 'aircraft-under-5700' | 'aircraft-over-5700' {
  if (incidentType === 'missing-person-land') return 'person';
  if (incidentType === 'aircraft-land-crash') {
    const mtow = targetLike?.mtowKg;
    if (mtow !== undefined) return mtow < 5700 ? 'aircraft-under-5700' : 'aircraft-over-5700';
    // Tanpa MTOW: fallback konservatif kelas kecil (pesawat latihan).
    return 'aircraft-under-5700';
  }
  return 'person';
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

/** Deret angin eksak N entri (knob envDataPoints / jenis kejadian baru Fase 5b).
 *  Kandidat jam sesuai interval (3/6 jam); N entri dipilih merata — entri
 *  PERTAMA dan TERAKHIR selalu dipertahankan agar pengamatan menutupi waktu
 *  kejadian s.d. Datum Time. `maxHour0` membatasi jam hari-0 (MOB datum
 *  hari yang sama). */
function buildSurfaceWindSeriesExact(
  rng: Rng,
  windBase: number,
  day0: { year: number; month: number; day: number },
  day1: { year: number; month: number; day: number } | null,
  timeZone: TimeZoneId,
  intervalHours: 3 | 6,
  count: number,
  speedCeil: number,
  maxHour0?: number,
): SurfaceWindEntry[] {
  const day0Hours = (intervalHours === 3 ? [0, 3, 6, 9, 12, 15, 18, 21] : [0, 6, 12, 18])
    .filter((h) => maxHour0 === undefined || h <= maxHour0);
  const day1Hours = intervalHours === 3 ? [0, 3, 6] : [0, 6];
  const cands: Array<{ day: typeof day0; hour: number }> = [];
  for (const h of day0Hours) cands.push({ day: day0, hour: h });
  if (day1) for (const h of day1Hours) cands.push({ day: day1, hour: h });
  const n = Math.max(2, Math.min(count, cands.length));
  const idxs = new Set<number>([0, cands.length - 1]);
  for (let i = 1; i < n - 1; i++) {
    idxs.add(Math.round((i * (cands.length - 1)) / (n - 1)));
  }
  return [...idxs].sort((a, b) => a - b).map((idx) => {
    const cand = cands[idx];
    return {
      obsTime: `${formatIndoDate(cand.day)} ${timeString(cand.hour, 0)} ${timeZone}`,
      windDirFrom: rng.angle(windBase, 25),
      windSpeedKts: rng.int(3, speedCeil),
    };
  });
}

// ---------------------------------------------------------------------------
// Kelengkapan per jenis insiden
// ---------------------------------------------------------------------------

/** Kelengkapan kasus generator — dispatch per jenis insiden.
 *  aircraft-ditching memakai `checkCaseCompleteness()` Fase 1 (perilaku
 *  existing tidak diubah); jenis lain punya aturan sendiri (Fase 5b: darat
 *  menuntut data WS 3/WS 4, MOB menuntut kategori leeway PIW). */
export function checkGeneratedCaseCompleteness(
  sarCase: SarCaseSchema,
  planner: CasePlannerInputs = {},
): CaseCompleteness {
  const type = sarCase.incident.type;
  if (type === 'aircraft-ditching') {
    return checkCaseCompleteness(sarCase, planner);
  }
  const issues: CaseCompleteness['issues'] = [];
  const push = (field: string, worksheet: string, reason: string) =>
    issues.push({ status: 'MISSING', field, worksheet, reason });

  const isLand = type === 'aircraft-land-crash' || type === 'missing-person-land';
  const isMob = type === 'person-overboard';

  if (!sarCase.incident.lastContactTime) push('incident.lastContactTime', 'ASW', 'Waktu kontak terakhir tidak ada.');
  if (!sarCase.search?.datumTime) push('search.datumTime', 'ASW/Datum', 'Datum Time tidak ada.');
  if (!sarCase.lkp?.coord) push('lkp.coord', isLand ? 'WS 3/WS 4' : 'Datum WS 1', isLand ? 'Koordinat posisi terakhir (darat) tidak ada.' : 'Koordinat LKP (posisi terakhir) tidak ada.');
  if (!isLand) {
    if (!sarCase.sea?.current) push('sea.current', 'Datum WS 1', 'Arus laut tidak ada.');
    const leewayId = planner.leewayObjectId ?? sarCase.target?.leewayObjectId;
    if (!leewayId) push('datum.leewayObjectId', 'Datum WS 1', 'Kategori leeway (Tabel I-1/I-2) tidak ada.');
    else if (!LEEWAY_OBJECT_TYPES.some((entry) => entry.id === leewayId)) {
      push('datum.leewayObjectId', 'Datum WS 1', `Kategori leeway "${leewayId}" tidak terdaftar di Tabel I-1/I-2.`);
    }
  }
  if ((sarCase.sea?.surfaceWindSeries?.length ?? 0) === 0) push('sea.surfaceWindSeries', 'ASW', 'Deret angin permukaan tidak ada.');
  if (sarCase.incident.pob === undefined) push('incident.pob', 'Perencanaan', 'POB tidak ada.');
  if (type === 'vessel-sinking' && sarCase.target?.lengthM === undefined) {
    push('target.lengthM', 'Datum WS 1', 'Panjang target (kategori leeway) tidak ada.');
  }
  if (isLand) {
    if (!sarCase.search?.terrainVegetation) push('search.terrainVegetation', 'WS 3', 'Vegetasi wilayah (Tabel I-10 / Fv) tidak ada.');
    if (!sarCase.search?.landPlatform) push('search.landPlatform', 'WS 3', 'Platform pencari darat tidak ada.');
    if (type === 'aircraft-land-crash') {
      if (!sarCase.search?.routeDestinationCoord) push('search.routeDestinationCoord', 'WS 4', 'Koordinat tujuan rute (Tr WS 4) tidak ada.');
    }
    if (type === 'missing-person-land' && sarCase.search?.lastSeenTrackNm === undefined) {
      push('search.lastSeenTrackNm', 'WS 4', 'Perkiraan jarak tempuh sejak terakhir terlihat (Tr) tidak ada.');
    }
  }
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

  const isDitching = params.incidentType === 'aircraft-ditching';
  const isSinking = params.incidentType === 'vessel-sinking';
  const isMob = params.incidentType === 'person-overboard';
  const isLandCrash = params.incidentType === 'aircraft-land-crash';
  const isMissingLand = params.incidentType === 'missing-person-land';
  const isLand = isLandCrash || isMissingLand;
  const isMaritime = !isLand;
  // Jalur knob eksplisit Fase 5b: jenis baru ATAU ada override knob.
  const isLegacyMarineType = isDitching || isSinking;
  const hasKnobOverrides = params.stagesBefore !== undefined
    || params.envDataPoints !== undefined
    || params.districtDataCount !== undefined
    || params.trapCount !== undefined;
  const useKnobPath = !isLegacyMarineType || hasKnobOverrides;

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
    useKnobPath
      ? `5b|${params.stagesBefore ?? ''}|${params.envDataPoints ?? ''}|${params.districtDataCount ?? ''}|${params.trapCount ?? ''}`
      : '',
  ].join('|'));

  const season = seasonOfMonth(incidentDate.month);
  const windBase = region.windBaseBySeason[season];
  const timeZone = region.timeZone;
  const knobProfile = DIFFICULTY_KNOB_PROFILES[params.difficulty];

  // ── Jebakan ──
  // Midnight-crossing hanya bermakna untuk skenario laut dengan datum esok
  // pagi — MOB (datum hari sama) dan darat memakai rentang waktu siang/pagi.
  const excludeMidnight = isMob || isLand;
  let traps: GeneratorTrap[];
  if (params.traps && params.traps.length > 0) {
    traps = [];
    for (const t of params.traps) {
      if (t === 'midnight-crossing' && excludeMidnight) {
        skippedTraps.push({ trap: t, reason: 'tidak berlaku untuk jenis insiden MOB/darat (datum lintas tengah malam tidak dipakai)' });
        continue;
      }
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
    traps = defaultTrapsFor(params.difficulty, region, rng, useKnobPath ? params.trapCount : undefined, excludeMidnight);
  }
  const trapSet = new Set<GeneratorTrap>(traps);

  // ── Waktu kejadian ──
  const midnight = trapSet.has('midnight-crossing');
  let lastContactHour: number;
  let lastContactMin: number;
  let reportOffsetMin: number;
  if (isMob) {
    // MOB: kejadian pagi/siang, laporan segera, datum hari yang sama.
    lastContactHour = rng.int(8, 11);
    lastContactMin = rng.pick([5, 15, 25, 35]);
    reportOffsetMin = rng.int(8, 20);
  } else if (isLand) {
    // Darat: kejadian pagi-sore, datum pagi hari berikutnya.
    lastContactHour = rng.int(7, 15);
    lastContactMin = rng.pick([0, 10, 20, 30, 50]);
    reportOffsetMin = rng.int(15, 40);
  } else {
    lastContactHour = midnight ? 23 : rng.int(12, 16);
    lastContactMin = midnight ? rng.pick([10, 20, 25, 35]) : rng.pick([0, 10, 20, 30, 50]);
    reportOffsetMin = midnight ? rng.int(10, 25) : rng.int(15, 40);
  }
  let reportHour = lastContactHour;
  let reportMin = lastContactMin + reportOffsetMin;
  if (reportMin >= 60) {
    reportMin -= 60;
    reportHour = (reportHour + 1) % 24;
  }
  const reportRollsOver = reportHour < lastContactHour;
  const reportDate = reportRollsOver ? addDays(incidentDate, 1) : incidentDate;
  const datumDay = isMob ? incidentDate : addDays(incidentDate, 1);
  const datumHour = isMob ? Math.min(20, lastContactHour + rng.int(3, 7)) : rng.int(6, 8);

  const lastContactTime = `${formatIndoDate(incidentDate)} ${timeString(lastContactHour, lastContactMin)} ${timeZone}`;
  const reportTime = `${formatIndoDate(reportDate)} ${timeString(reportHour, reportMin)} ${timeZone}`;
  const datumTime = `${formatIndoDate(datumDay)} ${timeString(datumHour, 0)} ${timeZone}`;

  // ── Lokasi lost contact / LKP ──
  // Laut: offset acak di sekitar pusat wilayah. Darat: titik referensi bank
  // (bandara/titik referensi) + rute tujuan untuk Tr WS 4 (pesawat) atau
  // jarak tempuh sejak terakhir terlihat (orang hilang).
  let lkpCoord: { lat: number; lng: number };
  let routeDestination: string | undefined;
  let routeDestinationCoord: CaseCoord | undefined;
  let lastSeenTrackNm: number | undefined;
  let landCourseDeg: number | undefined;
  if (isLand) {
    const refEntry = pickLandReference(region, rng);
    const base = refEntry?.lat !== undefined && refEntry?.lng !== undefined
      ? { lat: refEntry.lat, lng: refEntry.lng }
      : region.center;
    if (isLandCrash) {
      const otherAirports = listScenarioBank('location').filter((e) =>
        e.category === 'bandara' && e.lat !== undefined && e.lng !== undefined && e.id !== refEntry?.id);
      const destEntry = otherAirports.length > 0 ? rng.pick(otherAirports) : undefined;
      const dest = destEntry?.lat !== undefined && destEntry?.lng !== undefined
        ? { lat: destEntry.lat, lng: destEntry.lng }
        : { lat: base.lat + rng.float(0.5, 1.5, 0.1), lng: base.lng + rng.float(0.5, 1.5, 0.1) };
      lkpCoord = interpolateCoord(base, dest, rng.float(0.45, 0.75, 0.05));
      routeDestination = destEntry?.name ?? 'Bandara tujuan (data latihan)';
      routeDestinationCoord = {
        lat: Math.round(dest.lat * 1e6) / 1e6,
        lng: Math.round(dest.lng * 1e6) / 1e6,
        dmsLat: formatDMS(dest.lat, false),
        dmsLng: formatDMS(dest.lng, true),
      };
      landCourseDeg = Math.round(bearingDeg(base, dest)) % 360;
    } else {
      lkpCoord = {
        lat: Math.round((base.lat + rng.float(-0.15, 0.15, 0.005)) * 1e6) / 1e6,
        lng: Math.round((base.lng + rng.float(-0.15, 0.15, 0.005)) * 1e6) / 1e6,
      };
      lastSeenTrackNm = rng.float(1, 12, 0.5);
    }
  } else {
    lkpCoord = {
      lat: Math.round((region.center.lat + rng.float(-0.45, 0.45, 0.005)) * 1e6) / 1e6,
      lng: Math.round((region.center.lng + rng.float(-0.45, 0.45, 0.005)) * 1e6) / 1e6,
    };
  }

  // ── Target & perlengkapan keselamatan ──
  const targetEntry = pickTargetAsset(params, rng);
  const rafts = listScenarioBank('asset').filter((e) => e.category === 'liferaft' && e.specs.lifeRaftCapacityPerRaft !== undefined);
  let target: CaseTarget;
  let lifeRaftCount: number | undefined;
  let lifeRaftCapacityPerRaft: number | undefined;
  let pob: number;
  if (isMob) {
    const raftEntry = rng.pick(rafts);
    lifeRaftCount = rng.int(1, 2);
    lifeRaftCapacityPerRaft = raftEntry.specs.lifeRaftCapacityPerRaft ?? 6;
    pob = rng.int(4, 12);
    target = {
      category: 'person',
      name: 'Person in Water (PIW)',
      leewayObjectId: rng.pick(PIW_LEEWAY_IDS),
    };
  } else if (isMissingLand) {
    pob = 1;
    target = { category: 'person', name: 'Orang hilang (pencarian darat)' };
  } else {
    if (!targetEntry) {
      throw new Error(`Bank aset tidak memiliki target untuk jenis "${params.incidentType}".`);
    }
    target = bankEntryToCaseTarget(targetEntry);
    const raftEntry = rng.pick(rafts);
    const raftCapacity = raftEntry.specs.lifeRaftCapacityPerRaft ?? 6;
    lifeRaftCount = rng.int(1, 2);
    lifeRaftCapacityPerRaft = raftCapacity;
    const pobMax = raftCapacity * lifeRaftCount;
    const pobUpper = targetEntry.category === 'fixed-wing'
      ? Math.min(pobMax, targetEntry.specs.seatsPax ?? 19)
      : Math.min(pobMax, 22);
    pob = Math.max(2, rng.int(3, Math.max(3, pobUpper)));
    target.leewayObjectId = isDitching
      ? (raftCapacity <= 6 ? 'raft-aviation-46' : 'raft-1520-person')
      : pickLeewayObjectIdForVessel(targetEntry);
    if (isLandCrash) {
      // Pencarian darat tidak memakai kategori leeway laut.
      delete target.leewayObjectId;
      // Land crash tanpa perlengkapan life raft di narasi (tidak relevan).
      lifeRaftCount = undefined;
      lifeRaftCapacityPerRaft = undefined;
    }
  }

  // ── Insiden ──
  const callsignLetters = `${rng.pick(CALLSIGN_LETTERS.split(''))}${rng.pick(CALLSIGN_LETTERS.split(''))}${rng.pick(CALLSIGN_LETTERS.split(''))}`;
  const callsign = isDitching || isLandCrash
    ? `PK-${callsignLetters}`
    : isMissingLand
      ? rng.pick(MISSING_PERSON_NAMES)
      : `${rng.pick(VESSEL_NAME_PREFIX)} ${rng.pick(VESSEL_NAME_BASE)}-${rng.int(1, 99)}`;
  const craftType = isMob
    ? rng.pick(MOB_SHIP_TYPES)
    : isMissingLand
      ? rng.pick(MISSING_PERSON_ROLES)
      : targetEntry?.name ?? 'target';
  const infoSource = pickInfoSource(region, rng);
  // FL ≤ 200: layer angin tertinggi tabel soal 24000 ft — AWA menuntut data
  // angin pada/di atas ketinggian distress (FL250 akan membuat AWA gagal).
  const flightLevel = isDitching || isLandCrash ? rng.pick([100, 150, 200]) : undefined;
  const heading = isMob || isMissingLand
    ? undefined
    : isLandCrash && landCourseDeg !== undefined
      ? landCourseDeg
      : rng.int(45, 315);
  const headingReference = heading === undefined
    ? undefined
    : trapSet.has('heading-magnetic') ? 'magnetic' : 'true';

  // ── Variation ──
  const variationDeg = rng.float(0.5, 3, 0.5);
  const variationDirection = trapSet.has('variation-west') ? 'W' : 'E';

  // ── Kantor SAR + radial ──
  // Prioritas: KANSAR yang wilayahnya memuat LKP (geometri batas KANSAR —
  // deterministik, Fase 5b), lalu kantor-kantor di wilayah latihan yang sama.
  const allOffices = listScenarioBank('location').filter((e) =>
    e.category === 'kantor-sar' && e.lat !== undefined);
  const regionOffices = allOffices.filter((e) => e.specs.region === region.bankRegion);
  const lkpKansarName = pointInKansarPolygon(lkpCoord.lng, lkpCoord.lat);
  const lkpOffice = lkpKansarName
    ? allOffices.find((e) => e.name === `Kantor SAR ${lkpKansarName}`)
    : undefined;
  const officePool: BankEntry[] = [];
  if (lkpOffice) officePool.push(lkpOffice);
  for (const e of regionOffices) {
    if (!officePool.some((x) => x.id === e.id)) officePool.push(e);
  }
  const officeEntry = officePool.length > 0 ? rng.pick(officePool) : undefined;
  const officeName = officeEntry?.name ?? `Kantor SAR wilayah ${region.name}`;
  const radialDeg = rng.int(0, 71) * 5;
  const transitHours = rng.float(1, 5, 0.5);

  // ── Blok laut / lingkungan ──
  const currentCeil = difficultyOr(params.difficulty, {
    mudah: region.currentBase.speedMinKts + 0.2,
    sedang: (region.currentBase.speedMinKts + region.currentBase.speedMaxKts) / 2,
    sulit: region.currentBase.speedMaxKts,
  });
  const currentSpeed = rng.float(region.currentBase.speedMinKts, currentCeil, 0.1);
  const currentDir = rng.angle(region.currentBase.dirToDeg, params.difficulty === 'mudah' ? 15 : 40);
  const waveHeightM = rng.float(0.8, 2.5, 0.1);
  // Deret angin: jumlah entri = knob envDataPoints (default profil kesulitan;
  // perilaku Fase 5a = deret penuh 6h atau 3h sesuai jebakan). MOB memakai
  // interval 3 jam agar ada pengamatan di jendela kejadian→datum hari sama.
  const seriesInterval: 3 | 6 = isMob ? 3 : (trapSet.has('wind-series-3h') ? 3 : 6);
  const speedCeil = params.difficulty === 'sulit' ? 18 : params.difficulty === 'sedang' ? 14 : 10;
  const envCount = params.envDataPoints
    ?? (useKnobPath ? rng.int(knobProfile.envDataPoints[0], knobProfile.envDataPoints[1]) : (seriesInterval === 3 ? 11 : 6));
  // Knob envDataPoints melebihi grid interval saat ini → pakai interval 3 jam
  // agar jumlah pengamatan yang diminta benar-benar tercapai (maks 11 baris).
  const effectiveInterval: 3 | 6 = envCount > (seriesInterval === 3 ? 11 : 6) ? 3 : seriesInterval;
  const surfaceWindSeries = buildSurfaceWindSeriesExact(
    rng,
    windBase,
    incidentDate,
    isMob ? null : datumDay,
    timeZone,
    effectiveInterval,
    envCount,
    speedCeil,
    isMob ? datumHour : undefined,
  );

  // ── Pencarian ──
  const stagesCount = Math.min(4, Math.max(0, params.stagesBefore ?? rng.int(knobProfile.stagesBefore[0], knobProfile.stagesBefore[1])));
  const stagesDone = Array.from({ length: stagesCount }, (_, i) => ({
    stage: i + 1,
    result: 'sudah dilakukan, belum membuahkan hasil',
  }));
  const searchNumber = stagesCount + 1;
  const terrainVegetation = isLand ? defaultVegetationFor(params.difficulty, rng) : undefined;
  const landPlatform = isLand ? rng.pick(['fixed-wing', 'helicopter'] as const) : undefined;

  // ── SRU ──
  const requestedSru = params.sruCount ?? knobProfile.sruCount;
  const sruCount = Math.min(4, Math.max(2, requestedSru));
  if (requestedSru < 2 || requestedSru > 4) {
    warnings.push(`sruCount ${requestedSru} di luar rentang 2-4 — memakai ${sruCount}.`);
  }
  const sruEntries = pickSruAssets(params, rng, sruCount, isLand);
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
      visibilityKm: isLand
        ? rng.pick(LAND_VISIBILITIES_KM)
        : entry.specs.visibilityKm ?? rng.pick([10, 15, 20]),
    });
  });

  // ── Distrik/instansi pendukung (knob districtDataCount) ──
  const districtCount = params.districtDataCount
    ?? (useKnobPath ? knobProfile.districtDataCount : 0);
  let supportingDistricts: Array<{ name: string; note?: string }> | undefined;
  if (districtCount > 0) {
    const offices = listScenarioBank('location').filter((e) =>
      e.category === 'kantor-sar' && e.lat !== undefined && e.name !== officeName);
    const sameRegion = offices.filter((e) => e.specs.region === region.bankRegion);
    const others = offices.filter((e) => e.specs.region !== region.bankRegion);
    const pickedOffices: BankEntry[] = [];
    const pickedNames = new Set<string>();
    for (const e of sameRegion) {
      if (pickedOffices.length < districtCount && !pickedNames.has(e.name)) {
        pickedOffices.push(e);
        pickedNames.add(e.name);
      }
    }
    if (pickedOffices.length < districtCount) {
      for (const e of rng.pickMany(others, districtCount - pickedOffices.length)) {
        if (pickedOffices.length < districtCount && !pickedNames.has(e.name)) {
          pickedOffices.push(e);
          pickedNames.add(e.name);
        }
      }
    }
    supportingDistricts = pickedOffices.slice(0, districtCount).map((e) => ({
      name: e.name,
      note: `distrik pendukung (${e.specs.region ?? 'wilayah lain'})`,
    }));
  }

  // ── Rakit kasus ──
  const examHeader = params.examHeader ?? {};
  const incidentTypeLabel = GENERATOR_INCIDENT_LABELS[params.incidentType];

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
      craftType,
      pob,
      ...(lifeRaftCount !== undefined
        ? { lifeRaftCount, lifeRaftCapacityPerRaft: lifeRaftCapacityPerRaft ?? 6 }
        : {}),
      infoSource,
      reportTime,
      lastContactTime,
      ...(isDitching || isLandCrash
        ? {
            checkpoint: rng.pick(['SIMAB', 'SIMUC', 'SIMID', 'SIMOL', 'SIMUX']),
            flightLevelFt: flightLevel,
            headingDeg: heading,
            headingReference: headingReference as 'magnetic' | 'true' | undefined,
            damageDescription: rng.pick(DAMAGE_OPTIONS),
            ditchingIndication: isDitching ? 'diindikasikan akan ditching' : 'diindikasikan jatuh di darat',
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
    ...(isDitching
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
    sea: isMaritime
      ? {
          current: { dirToDeg: currentDir, speedKts: currentSpeed },
          surfaceWindSeries,
          waveHeightM,
        }
      : {
          // Darat: hanya deret angin (cuaca operasi penerbangan pencarian);
          // arus/gelombang laut tidak berlaku.
          surfaceWindSeries,
        },
    search: {
      datumTime,
      stagesDone,
      visibilityKm: isLand ? rng.pick(LAND_VISIBILITIES_KM) : rng.int(10, 30),
      searchNumber,
      ...(isLand
        ? {
            terrainVegetation,
            landPlatform,
            ...(isLandCrash
              ? { routeDestination, routeDestinationCoord }
              : { lastSeenTrackNm }),
          }
        : {}),
    },
    sru: sruList,
    ...(supportingDistricts && supportingDistricts.length > 0 ? { supportingDistricts } : {}),
    tasksRequested: isDitching
      ? ['aeronautical-drift', 'asw', 'search-area-abcd', 'wsc-pod', 'asset-allocation', 'search-pattern-csp', 'sru-task-assignment']
      : isLand
        ? ['land-search-radius', 'search-pattern-csp', 'asset-allocation', 'sru-task-assignment']
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
          reason: `Seluruh nilai kasus dihasilkan generator Fase ${GENERATOR_VERSION} ber-seed "${params.seed}" (${incidentTypeLabel}) untuk LATIHAN — data berstatus SIMULATION, bukan data cuaca/operasi resmi.`,
        },
        {
          field: 'meta.generatorVersion',
          value: GENERATOR_VERSION,
          reason: `Reproduksi soal: seed "${params.seed}" + konfigurasi + generator versi ${GENERATOR_VERSION} menghasilkan kasus yang sama persis.`,
        },
        isMaritime
          ? {
              field: 'datum.x/y nav aid',
              reason: 'Alat navigasi distress craft & SRU (Tabel J-1) tidak disebut di naskah — default 0 NM sampai planner memilih.',
            }
          : {
              field: 'ws4.x0/y nav',
              reason: 'Fix error dasar x₀ (Tabel J-2 GPS/non-GPS) dan galat SRU y dipilih planner saat mengisi WS 4 — naskah tidak menetapkannya.',
            },
      ],
      fieldSources: [
        { field: 'incident', source: `Generator seed "${params.seed}" (wilayah ${region.name}, kesulitan ${params.difficulty})`, status: 'SIMULATION' },
        ...(isDitching
          ? [{ field: 'aeroDrift.windLayers', source: 'Model musim generator (SIMULATION) — bukan data meteorologi resmi', status: 'SIMULATION' as const }]
          : []),
        ...(isLand
          ? [{ field: 'search.terrainVegetation', source: 'Vegetasi latihan generator (SIMULATION) — Tabel I-10 dipakai pada WS 3', status: 'SIMULATION' as const }]
          : []),
        { field: 'sea', source: isMaritime ? 'Model arus/angin generator (SIMULATION) — bukan data oceanografi resmi' : 'Deret angin latihan generator (SIMULATION) — cuaca operasi pencarian', status: 'SIMULATION' },
        ...(targetEntry
          ? [{ field: 'target', source: `Bank aset: ${targetEntry.name} (${targetEntry.verification})`, status: targetEntry.verification === 'VERIFIED' ? 'VERIFIED' as const : 'SIMULATION' as const }]
          : [{ field: 'target', source: 'Kategori person — generator (SIMULATION)', status: 'SIMULATION' as const }]),
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
    resolvedKnobs: {
      sruCount: sruList.length,
      stagesBefore: stagesCount,
      envDataPoints: surfaceWindSeries.length,
      districtDataCount: supportingDistricts?.length ?? 0,
      trapCount: traps.length,
    },
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

/** Deskripsi kapabilitas generator untuk API/UI (form parameter).
 *  Gaya bahasa narasi tidak diimpor dari caseNarrative (hindari dependensi
 *  melingkar) — route API menggabungkan keduanya. */
export function describeGeneratorCapabilities() {
  return {
    version: GENERATOR_VERSION,
    difficulties: GENERATOR_DIFFICULTIES,
    knobs: {
      sruCount: { min: 2, max: 4, label: 'Jumlah SRU' },
      stagesBefore: { min: 0, max: 4, label: 'Stage pencarian sebelumnya' },
      envDataPoints: { min: 4, max: 12, label: 'Jumlah data lingkungan (deret angin)' },
      districtDataCount: { min: 0, max: 5, label: 'Distrik/instansi pendukung' },
      trapCount: { min: 0, max: 6, label: 'Jumlah jebakan analisis' },
    },
    difficultyProfiles: DIFFICULTY_KNOB_PROFILES,
    traps: GENERATOR_TRAPS.map((id) => ({ id, label: TRAP_LABELS[id], minDifficulty: TRAP_MIN_DIFFICULTY[id] })),
    regions: SCENARIO_REGIONS.map((r) => ({
      id: r.id,
      name: r.name,
      timeZone: r.timeZone,
      currentBase: r.currentBase,
      windBaseBySeason: r.windBaseBySeason,
    })),
    incidentTypes: GENERATOR_INCIDENT_TYPES.map((id) => ({ id, label: GENERATOR_INCIDENT_LABELS[id] })),
    defaultIncidentDateISO: DEFAULT_INCIDENT_DATE,
    bank: {
      sruUsableAssets: SCENARIO_BANK_SEED.filter(isSruUsableAsset).map((e) => ({ id: e.id, name: e.name, category: e.category, verification: e.verification })),
      targetAssets: SCENARIO_BANK_SEED.filter((e) => e.kind === 'asset' && e.specs.lengthM !== undefined && e.specs.cruiseSpeedKts !== undefined).map((e) => ({ id: e.id, name: e.name, category: e.category, verification: e.verification })),
      offices: SCENARIO_BANK_SEED.filter((e) => e.category === 'kantor-sar').map((e) => ({ id: e.id, name: e.name, region: e.specs.region, verification: e.verification })),
    },
  };
}
