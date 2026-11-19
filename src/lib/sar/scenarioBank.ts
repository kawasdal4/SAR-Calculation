/**
 * SCENARIO BANK (Fase 5a AI Copilot) — bank lokasi & katalog aset untuk
 * generator soal latihan (keputusan implementasi no. 7, 9, 12).
 *
 * Sumber data:
 *  - `src/data/locations.json` : kantor SAR, bandara, pelabuhan, helipad/titik
 *    referensi berkoordinat.
 *  - `src/data/assets.json`    : katalog SRU & target (helikopter, pesawat,
 *    kapal, life raft) lengkap spesifikasi.
 *
 * Aturan mutlak (keputusan no. 7):
 *  - Setiap entri WAJIB punya `source`, `updatedRef` (tanggal), `units`,
 *    `verification` (VERIFIED/UNVERIFIED/MISSING/SIMULATION), dan `approval`
 *    (DRAFT/APPROVED). Data baru selalu DRAFT sampai disetujui.
 *  - DILARANG menebak koordinat/spesifikasi: entri tanpa data meyakinkan
 *    dibiarkan tanpa koordinat dan diberi status MISSING.
 *  - Data sintetis latihan WAJIB berlabel SIMULATION dan tidak bercampur
 *    dengan data resmi (keputusan no. 6).
 *
 * Modul ini murni (tanpa fs/DB) sehingga aman dipakai di client maupun server;
 * data di-bundle lewat import JSON (`resolveJsonModule`). Prisma `CaseBankItem`
 * dipakai untuk penyimpanan hasil edit UI (API `/api/scenario-bank`).
 */

import { z } from 'zod';
import locationSeed from '../../data/locations.json';
import assetSeed from '../../data/assets.json';
import type { CaseSru, CaseTarget, VerificationStatus, DataApprovalStatus } from './caseSchema';

// ---------------------------------------------------------------------------
// Skema
// ---------------------------------------------------------------------------

export const BANK_KINDS = ['location', 'asset'] as const;
export type BankKind = (typeof BANK_KINDS)[number];

/** Kategori entri lokasi. */
export const LOCATION_CATEGORIES = [
  'kantor-sar',       // kantor SAR Basarnas (pelaksana operasi)
  'bandara',          // bandara (basis SRU udara / titik laporan)
  'pelabuhan',        // pelabuhan/pangkalan kapal SAR
  'helipad',          // helipad / apron helikopter
  'titik-referensi',  // titik lokasi khusus (mis. lokasi aset suatu soal)
] as const;
export type LocationCategory = (typeof LOCATION_CATEGORIES)[number];

/** Kategori entri aset. */
export const ASSET_CATEGORIES = [
  'helicopter',
  'fixed-wing',
  'vessel',
  'liferaft',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

/** Spesifikasi entri (semua opsional; kewajiban diisi divalidasi per kategori). */
export const bankSpecsSchema = z.object({
  // Lokasi
  role: z.string().optional(),          // mis. "Kantor SAR pelaksana", "pangkalan SRU udara"
  region: z.string().optional(),        // id wilayah generator (mis. "selat-sunda")
  notes: z.string().optional(),
  // Aset — pemakaian umum
  flag: z.string().optional(),
  engine: z.enum(['turbine', 'piston']).optional(),
  enduranceHours: z.number().optional(),
  enduranceMinutes: z.number().optional(),
  tasMaxKts: z.number().optional(),
  tasSearchKts: z.number().optional(),
  visibilityKm: z.number().optional(),
  frequencies: z.array(z.string()).optional(),
  navigation: z.array(z.string()).optional(),
  phoneSatellite: z.string().optional(),
  // Aset — pemetaan worksheet WS 8 / Alokasi Aset
  sruType: z.enum(['rescue-vessel', 'patrol-boat', 'rib', 'sea-rider']).optional(),
  eyeHeight: z.enum(['8', '14', 'MERSHIP']).optional(),
  // Aset — blok target (pesawat/kapal) "Data Pesawat/Kapal" naskah soal
  lengthM: z.number().optional(),
  wingspanM: z.number().optional(),
  heightM: z.number().optional(),
  wingAreaM2: z.number().optional(),
  cabinHeightM: z.number().optional(),
  cabinWidthM: z.number().optional(),
  cruiseSpeedKts: z.number().optional(),
  cruiseSpeedKmh: z.number().optional(),
  stallSpeedKts: z.number().optional(),
  rangeNm: z.number().optional(),
  serviceCeilingFt: z.number().optional(),
  rateOfClimbFpm: z.number().optional(),
  wingLoadingKgM2: z.number().optional(),
  payload: z.string().optional(),
  // Life raft (perlengkapan keselamatan insiden)
  lifeRaftCount: z.number().int().min(0).optional(),
  lifeRaftCapacityPerRaft: z.number().int().min(1).optional(),
});

export const bankEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(BANK_KINDS),
  name: z.string().min(1),
  category: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  dmsLat: z.string().optional(),
  dmsLng: z.string().optional(),
  specs: bankSpecsSchema.default({}),
  source: z.string().min(1),
  updatedRef: z.string().min(1),
  units: z.string().min(1),
  verification: z.enum(['VERIFIED', 'UNVERIFIED', 'MISSING', 'SIMULATION']).default('UNVERIFIED'),
  approval: z.enum(['DRAFT', 'APPROVED']).default('DRAFT'),
});

export type BankEntry = z.infer<typeof bankEntrySchema>;
export type BankSpecs = z.infer<typeof bankSpecsSchema>;

/** Bentuk yang dikirim/diterima API & editor UI (specs bisa JSON string dari DB). */
export interface BankEntryApi {
  id: string;
  kind: BankKind;
  name: string;
  category: string;
  lat?: number | null;
  lng?: number | null;
  dmsLat?: string | null;
  dmsLng?: string | null;
  specs: BankSpecs;
  source: string;
  updatedRef: string;
  units: string;
  verification: VerificationStatus;
  approval: DataApprovalStatus;
}

// ---------------------------------------------------------------------------
// Loader seed JSON
// ---------------------------------------------------------------------------

const seedLocations = locationSeed as unknown[];
const seedAssets = assetSeed as unknown[];

function parseEntries(raw: unknown[], kind: BankKind): BankEntry[] {
  const entries: BankEntry[] = [];
  const issues: string[] = [];
  for (const item of raw) {
    const parsed = bankEntrySchema.safeParse(item);
    if (parsed.success) entries.push(parsed.data);
    else issues.push(`${kind}: ${(item as { id?: string }).id ?? '(tanpa id)'} — ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  }
  if (issues.length > 0) {
    // Seed bawaan wajib valid — kegagalan = bug data, bukan kondisi runtime.
    throw new Error(`Seed bank tidak valid: ${issues.join(' | ')}`);
  }
  return entries;
}

/** Seluruh entri seed (lokasi + aset), sudah tervalidasi skema. */
export const SCENARIO_BANK_SEED: BankEntry[] = [
  ...parseEntries(seedLocations, 'location'),
  ...parseEntries(seedAssets, 'asset'),
];

export function listScenarioBank(kind?: BankKind, category?: string): BankEntry[] {
  return SCENARIO_BANK_SEED.filter((e) =>
    (kind === undefined || e.kind === kind)
    && (category === undefined || e.category === category));
}

export function findScenarioBankEntry(id: string): BankEntry | undefined {
  return SCENARIO_BANK_SEED.find((e) => e.id === id);
}

/** Pencarian teks sederhana (nama + alias kategori) untuk editor & generator. */
export function searchScenarioBank(query: string, kind?: BankKind): BankEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return listScenarioBank(kind);
  return listScenarioBank(kind).filter((e) =>
    e.name.toLowerCase().includes(q)
    || e.category.toLowerCase().includes(q)
    || (e.specs.role ?? '').toLowerCase().includes(q)
    || (e.specs.region ?? '').toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Validasi kualitas bank (dipakai test + endpoint audit)
// ---------------------------------------------------------------------------

/** Spesifikasi minimum agar entri aset bisa dipakai generator sebagai SRU. */
const SRU_REQUIRED_KEYS = ['enduranceHours', 'tasMaxKts', 'tasSearchKts', 'visibilityKm'] as const;

export interface BankAuditIssue {
  id: string;
  kind: BankKind;
  message: string;
}

/** Entri aset heli/pesawat/kapal dianggap PAKAI SEBAGAI SRU bila punya data
 *  pencarian; entri tanpa satu pun key SRU = kandidat target saja (OK). */
export function isSruUsableAsset(entry: BankEntry): boolean {
  if (entry.kind !== 'asset') return false;
  if (entry.category !== 'helicopter' && entry.category !== 'fixed-wing' && entry.category !== 'vessel') return false;
  return SRU_REQUIRED_KEYS.every((k) => entry.specs[k] !== undefined);
}

export function auditScenarioBank(entries: BankEntry[] = SCENARIO_BANK_SEED): BankAuditIssue[] {
  const issues: BankAuditIssue[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.id)) issues.push({ id: e.id, kind: e.kind, message: 'id duplikat' });
    seen.add(e.id);
    if (!e.source?.trim()) issues.push({ id: e.id, kind: e.kind, message: 'source wajib diisi (provenance)' });
    if (!e.updatedRef?.trim()) issues.push({ id: e.id, kind: e.kind, message: 'updatedRef (tanggal) wajib diisi' });
    if (!e.units?.trim()) issues.push({ id: e.id, kind: e.kind, message: 'units wajib diisi' });
    if (e.kind === 'location' && e.verification !== 'MISSING' && (e.lat === undefined || e.lng === undefined)) {
      issues.push({ id: e.id, kind: e.kind, message: 'lokasi berkoordinat wajib punya lat+lng (selain status MISSING)' });
    }
    if (isSruUsableAsset(e) === false) {
      // Entri dengan SEBAGIAN key SRU (bukan nol, bukan lengkap) = kemungkinan salah input.
      const presentCount = SRU_REQUIRED_KEYS.filter((k) => e.specs[k] !== undefined).length;
      const isSruCategory = e.kind === 'asset' && (e.category === 'helicopter' || e.category === 'fixed-wing' || e.category === 'vessel');
      if (isSruCategory && presentCount > 0 && presentCount < SRU_REQUIRED_KEYS.length) {
        const missing = SRU_REQUIRED_KEYS.filter((k) => e.specs[k] === undefined);
        issues.push({ id: e.id, kind: e.kind, message: `spesifikasi SRU parsial (dipakai sebagai target saja boleh, sebagai SRU kurang: ${missing.join(', ')})` });
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Konversi entri → bentuk CaseSchema (dipakai caseGenerator)
// ---------------------------------------------------------------------------

/** Entri aset → CaseSru (baris tabel SRU soal). `over` menimpa field turunan. */
export function bankEntryToCaseSru(entry: BankEntry, callsign: string, over: Partial<CaseSru> = {}): CaseSru {
  const s = entry.specs;
  const kind: CaseSru['kind'] = entry.category === 'vessel'
    ? 'vessel'
    : entry.category === 'fixed-wing'
      ? 'fixed-wing'
      : 'helicopter';
  const coord = entry.lat !== undefined && entry.lng !== undefined
    ? { lat: entry.lat, lng: entry.lng, dmsLat: entry.dmsLat, dmsLng: entry.dmsLng }
    : undefined;
  return {
    callsign,
    kind,
    model: entry.name,
    ...(coord ? { coord } : {}),
    ...(s.engine ? { engine: s.engine } : {}),
    ...(s.enduranceHours !== undefined ? { enduranceHours: s.enduranceHours } : {}),
    ...(s.enduranceMinutes !== undefined ? { enduranceMinutes: s.enduranceMinutes } : {}),
    ...(s.tasMaxKts !== undefined ? { tasMaxKts: s.tasMaxKts } : {}),
    ...(s.tasSearchKts !== undefined ? { tasSearchKts: s.tasSearchKts } : {}),
    ...(s.visibilityKm !== undefined ? { visibilityKm: s.visibilityKm } : {}),
    ...(s.frequencies ? { frequencies: [...s.frequencies] } : {}),
    ...(s.navigation ? { navigation: [...s.navigation] } : {}),
    ...(s.phoneSatellite ? { phoneSatellite: s.phoneSatellite } : {}),
    ...over,
  };
}

/** Entri aset kategori fixed-wing/vessel → CaseTarget (blok "Data Pesawat/Kapal"). */
export function bankEntryToCaseTarget(entry: BankEntry): CaseTarget {
  const s = entry.specs;
  const category: CaseTarget['category'] = entry.category === 'vessel' ? 'vessel' : 'aircraft';
  return {
    category,
    name: entry.name,
    ...(s.flag ? { flag: s.flag } : {}),
    ...(s.lengthM !== undefined ? { lengthM: s.lengthM } : {}),
    ...(s.wingspanM !== undefined ? { wingspanM: s.wingspanM } : {}),
    ...(s.heightM !== undefined ? { heightM: s.heightM } : {}),
    ...(s.wingAreaM2 !== undefined ? { wingAreaM2: s.wingAreaM2 } : {}),
    ...(s.cabinHeightM !== undefined ? { cabinHeightM: s.cabinHeightM } : {}),
    ...(s.cabinWidthM !== undefined ? { cabinWidthM: s.cabinWidthM } : {}),
    ...(s.cruiseSpeedKts !== undefined ? { cruiseSpeedKts: s.cruiseSpeedKts } : {}),
    ...(s.cruiseSpeedKmh !== undefined ? { cruiseSpeedKmh: s.cruiseSpeedKmh } : {}),
    ...(s.stallSpeedKts !== undefined ? { stallSpeedKts: s.stallSpeedKts } : {}),
    ...(s.rangeNm !== undefined ? { rangeNm: s.rangeNm } : {}),
    ...(s.serviceCeilingFt !== undefined ? { serviceCeilingFt: s.serviceCeilingFt } : {}),
    ...(s.rateOfClimbFpm !== undefined ? { rateOfClimbFpm: s.rateOfClimbFpm } : {}),
    ...(s.wingLoadingKgM2 !== undefined ? { wingLoadingKgM2: s.wingLoadingKgM2 } : {}),
    ...(s.frequencies ? { frequencies: [...s.frequencies] } : {}),
    ...(s.payload ? { payload: s.payload } : {}),
    ...(s.navigation ? { navigation: [...s.navigation] } : {}),
  };
}
