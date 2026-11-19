/**
 * CASE SCHEMA — single source of truth data soal kasus SAR (Fase 1 AI Copilot).
 *
 * Field-nya memetakan 1:1 ke INPUT worksheet aplikasi (AWA, ADW, ASW, Datum WS 1,
 * WS 2/3/8, Alokasi Aset, Search Pattern) sehingga kasus bisa diterapkan ke
 * worksheet tanpa translate manual. Skema sengaja PERMISIF (hampir semua field
 * opsional): ekstraksi soal yang belum lengkap tetap valid — kelengkapan
 * diperiksa oleh `checkCaseCompleteness()` di caseAdapter.ts, bukan di sini.
 *
 * ── KONVENSI EKSPLISIT (WAJIB dipatuhi semua modul AI) ─────────────────────
 * 1. ANGIN    : arah DARI mana angin bertiup (windDirFrom, 0–360°, knots).
 * 2. ARUS/DRIFT : arah KE mana air bergerak (dirToDeg / seaCurrentDir °T).
 * 3. TRUE vs MAGNETIC : true = magnetic + variation (E ditambah, W dikurangi)
 *    — identik dengan `convertHeadingToTrue()` (aeroDriftCalculations.ts).
 * 4. WAKTU    : disimpan sebagai string apa adanya dari soal (mis.
 *    "18 November 2026 13.50 WIB"); zona disebut eksplisit di teks
 *    (WIB = UTC+7). Konversi ke format Basarnas MMDD.HHMM Z dilakukan oleh
 *    `toBasarnasTimeFormat()` (aswTime.ts) — satu sumber konversi waktu.
 * 5. KOORDINAT: derajat desimal bertanda (lat: N+/S−, lng: E+/W−); string DMS
 *    asli dari soal disimpan berdampingan (dmsLat/dmsLng) untuk verifikasi.
 * 6. SATUAN   : jarak NM, kecepatan knots, ketinggian feet, gelombang meter,
 *    visibility kilometer — sebagaimana worksheet. Tidak ada konversi diam-diam.
 * 7. NILAI REFERENSI: status VERIFIED / UNVERIFIED / MISSING / SIMULATION
 *    (lihat referenceTables.ts); UNVERIFIED/MISSING tidak boleh dianggap resmi.
 */

import { z } from 'zod';

/** Status verifikasi sebuah nilai/data (keputusan implementasi no. 6 & 7). */
export const VERIFICATION_STATUSES = ['VERIFIED', 'UNVERIFIED', 'MISSING', 'SIMULATION'] as const;
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** Status persetujuan master data (bank lokasi/aset, keputusan no. 7). */
export const DATA_APPROVAL_STATUSES = ['DRAFT', 'APPROVED'] as const;
export type DataApprovalStatus = (typeof DATA_APPROVAL_STATUSES)[number];

/** Jenis insiden — menentukan blok data yang wajib (keputusan no. 13). */
export const INCIDENT_TYPES = [
  'aircraft-ditching',     // pesawat ditching di laut (contoh: PK-TAL)
  'aircraft-land-crash',   // pesawat jatuh di darat (WS 3/WS 4)
  'vessel-sinking',        // kapal tenggelam (tanpa tabel angin per ketinggian; pakai kategori leeway)
  'person-overboard',      // MOB / PIW
  'other',
] as const;
export const incidentTypeSchema = z.enum(INCIDENT_TYPES);
export type IncidentType = (typeof INCIDENT_TYPES)[number];

/** Koordinat: desimal bertanda + DMS asli dari soal bila ada. */
export const coordSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  /** DMS asli dari soal, mis. "06° 52′ 46″ S" — hanya untuk verifikasi manusia. */
  dmsLat: z.string().optional(),
  dmsLng: z.string().optional(),
});
export type CaseCoord = z.infer<typeof coordSchema>;

/** Satu lapis angin per ketinggian (AWA / tabel angin soal). altitudeFt 0 = Surface. */
export const windLayerSchema = z.object({
  altitudeFt: z.number().min(0),
  /** Label asli dari soal, mis. "Surface", "3000 Feet", "FL200". */
  altitudeLabel: z.string().optional(),
  windDirFrom: z.number().min(0).max(360),
  windSpeedKts: z.number().min(0),
});
export type WindLayer = z.infer<typeof windLayerSchema>;

/** Satu baris deret angin permukaan berwaktu (ASW). obsTime disimpan apa adanya. */
export const surfaceWindEntrySchema = z.object({
  obsTime: z.string(),
  windDirFrom: z.number().min(0).max(360),
  windSpeedKts: z.number().min(0),
});
export type SurfaceWindEntry = z.infer<typeof surfaceWindEntrySchema>;

/** Arus laut/pasut — arah KE mana arus bergerak (konvensi no. 2). */
export const seaCurrentSchema = z.object({
  dirToDeg: z.number().min(0).max(360),
  speedKts: z.number().min(0),
});

export const examHeaderSchema = z.object({
  title: z.string().optional(),           // mis. "FINAL TEST"
  trainingName: z.string().optional(),    // mis. "Diklat SAR Tingkat Spesialis SAR Planning"
  angkatan: z.string().optional(),        // mis. "XL"
  year: z.number().int().optional(),
  durationMinutes: z.number().int().positive().optional(),
  isOpenBook: z.boolean().optional(),
  examDate: z.string().optional(),        // mis. "19 November 2026"
});
export type ExamHeader = z.infer<typeof examHeaderSchema>;

export const incidentSchema = z.object({
  type: incidentTypeSchema,
  callsign: z.string().optional(),        // mis. "PK-TAL"
  craftType: z.string().optional(),       // mis. "Cessna 208 Caravan"
  pob: z.number().int().min(0).optional(),
  /** Perlengkapan keselamatan — life raft: jumlah & kapasitas per unit. */
  lifeRaftCount: z.number().int().min(0).optional(),
  lifeRaftCapacityPerRaft: z.number().int().min(1).optional(),
  otherSafetyEquipment: z.string().optional(),
  infoSource: z.string().optional(),      // mis. "JATSC"
  /** Waktu laporan diterima kantor SAR (string asli soal, zona di dalam teks). */
  reportTime: z.string().optional(),
  /** Waktu MAYDAY / kontak terakhir — jadi distress time worksheet ASW/ADW. */
  lastContactTime: z.string().optional(),
  checkpoint: z.string().optional(),      // mis. "ENSIB"
  /** FL200 → flightLevelFt 200. flightLevelFt × 100 = feet. */
  flightLevelFt: z.number().optional(),
  altitudeFt: z.number().optional(),      // ketinggian non-FL (mis. 1200 ft)
  headingDeg: z.number().min(0).max(360).optional(),
  headingReference: z.enum(['true', 'magnetic', 'compass']).optional(),
  damageDescription: z.string().optional(), // mis. "kerusakan mesin"
  ditchingIndication: z.string().optional(),
});
export type CaseIncident = z.infer<typeof incidentSchema>;

/** Spesifikasi target/pesawat/kapal — memetakan blok "Data Pesawat" soal. */
export const targetSchema = z.object({
  category: z.enum(['aircraft', 'vessel', 'liferaft', 'person', 'other']),
  name: z.string().optional(),
  flag: z.string().optional(),
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
  frequencies: z.array(z.string()).optional(),  // mis. ["121.5 MHz"]
  payload: z.string().optional(),
  navigation: z.array(z.string()).optional(),   // mis. ["GPS"]
  /** Id kategori leeway Tabel I-1/I-2 bila target adalah objek drift laut. */
  leewayObjectId: z.string().optional(),
});
export type CaseTarget = z.infer<typeof targetSchema>;

export const sarOfficeSchema = z.object({
  name: z.string().optional(),                 // mis. "Kantor SAR Banten"
  coord: coordSchema.optional(),
  /** Radial LKP dari kantor (derajat, bearing dari kantor ke LKP). */
  radialDegToLkp: z.number().min(0).max(360).optional(),
  transitHoursToLkp: z.number().optional(),
});

export const lkpSchema = z.object({
  coord: coordSchema.optional(),
  /** 'explicit' = koordinat diberikan soal; 'adw-landing' = dipakai posisi
   *  ditching hasil ADW (aturan rantai worksheet, lihat caseChain.ts). */
  source: z.enum(['explicit', 'adw-landing']).optional(),
});

/** Blok Aeronautical Drift (worksheet ADW + tabel angin per ketinggian AWA). */
export const aeroDriftSchema = z.object({
  glideSpeedKts: z.number().positive().optional(),
  glideRatio: z.number().positive().optional(),      // 6 = 6:1
  variationDeg: z.number().optional(),
  variationDirection: z.enum(['E', 'W']).optional(),
  /** Deviation kompas pesawat bila disebut (biasanya tidak). */
  deviationDeg: z.number().optional(),
  deviationDirection: z.enum(['E', 'W']).optional(),
  /** Tabel angin per ketinggian (dipakai AWA; surface = altitudeFt 0). */
  windLayers: z.array(windLayerSchema).optional(),
  /** Data parasut bila soal menyebut (pesawat transport). */
  parachute: z.object({
    present: z.boolean(),
    type: z.enum(['steerable', 'round-zero-glide']).optional(),
    altMaxFt: z.number().optional(),
    rateOfDescentFtMin: z.number().optional(),
    glideRatio: z.number().optional(),
  }).optional(),
});
export type CaseAeroDrift = z.infer<typeof aeroDriftSchema>;

/** Blok cuaca laut: arus (arah KE) + deret angin permukaan berwaktu + gelombang. */
export const seaSchema = z.object({
  current: seaCurrentSchema.optional(),
  surfaceWindSeries: z.array(surfaceWindEntrySchema).optional(),
  /** Tinggi gelombang (seas) meter bila disebut soal — penentu baris Fw Table I-7. */
  waveHeightM: z.number().optional(),
});
export type CaseSea = z.infer<typeof seaSchema>;

/** Blok pencarian: datum time + stage yang sudah dilakukan + kondisi. */
export const searchSchema = z.object({
  /** Datum Time (string asli soal, mis. "19 November 2026 07.00 WIB"). */
  datumTime: z.string().optional(),
  /** Stage pencarian yang sudah dilakukan beserta hasilnya (mis. stage 1 & 2 nihil). */
  stagesDone: z.array(z.object({
    stage: z.number().int().min(1),
    result: z.string().optional(),
  })).optional(),
  visibilityKm: z.number().optional(),
  weatherNotes: z.string().optional(),
  /** Nomor pencarian berikutnya (1 = pencarian pertama) — penentu kurva POD & fs. */
  searchNumber: z.number().int().min(1).max(5).optional(),
});
export type CaseSearch = z.infer<typeof searchSchema>;

/** Data lembar worksheet live (WS 2 udara / WS 8 laut) yang menyertai SRU.
 *  Dipetakan VERBATIM dari state worksheet oleh `stateToCase()` (Fase 2) agar
 *  `run_pipeline`/`run_worksheet` memakai input worksheet PERSIS seperti yang
 *  tampil di aplikasi — bukan re-derivation dari data soal. Semua field
 *  opsional; `buildCaseWorksheetSeeds()` memakai nilai ini bila ada dan
 *  kembali ke derivation lama bila tidak (perilaku fixture Fase 1 tak berubah). */
export const sruSheetSchema = z.object({
  /** Jenis lembar worksheet asal data. */
  kind: z.enum(['ws2', 'ws8']).optional(),
  /** WS 8: jenis kapal (mata gambar/label Tabel I-3/I-4). */
  sruType: z.enum(['rescue-vessel', 'patrol-boat', 'rib', 'sea-rider']).optional(),
  /** WS 2: platform pencari udara. */
  searchPlatform: z.enum(['fixed-wing', 'helicopter']).optional(),
  /** Id objek pencarian Tabel I-3..I-6 (mis. raft6, piw, ship27). */
  searchObject: z.string().optional(),
  /** WS 2: indeks kolom visibility (0=2 km … 5=>40 km). */
  visibilityIndex: z.number().int().min(0).max(5).optional(),
  /** WS 8: label visibility (mis. "10", ">25"). */
  visibilityKm: z.string().optional(),
  /** WS 2: ketinggian terpilih (ft). */
  selectedHeightFt: z.number().optional(),
  isFatigue: z.enum(['Yes', 'No']).optional(),
  /** WS 2: flotation PIW diketahui (Wu ×4 @500 ft). */
  piwFlotationKnown: z.boolean().optional(),
  /** Nomor pencarian 1–5. */
  searchNumber: z.number().int().min(1).max(5).optional(),
  hoursAvailable: z.number().min(0).optional(),
  /** WS 8: eye height (8=Small craft, 14=Patrol boat, MERSHIP). */
  eyeHeight: z.enum(['8', '14', 'MERSHIP']).optional(),
  vesselSpeedKts: z.number().min(0).optional(),
  /** Angin kasus header (arah DARI, °T) — penentu baris Fw Table I-7. */
  caseWindDirFrom: z.number().min(0).max(360).optional(),
  caseWindSpeed: z.number().min(0).optional(),
  /** Tinggi gelombang kasus (m) — penentu baris Fw. */
  caseWaveHeightM: z.number().min(0).optional(),
  /** Override planner atas nilai tabel (0 = kembali ke tabel). */
  fwOverride: z.number().min(0).optional(),
  fsOverride: z.number().min(0).optional(),
});
export type CaseSruSheet = z.infer<typeof sruSheetSchema>;

/** Satu SRU/alut — memetakan baris tabel "Data asset SRU" soal. */
export const sruSchema = z.object({
  callsign: z.string(),
  kind: z.enum(['helicopter', 'fixed-wing', 'vessel']),
  model: z.string().optional(),          // mis. "Eurocopter AS-365 N3+ (Turbin)"
  /** Koordinat LOKASI ASET saat ini (bukan pangkalan home base). */
  coord: coordSchema.optional(),
  engine: z.enum(['turbine', 'piston']).optional(),
  enduranceHours: z.number().optional(),
  enduranceMinutes: z.number().optional(),   // sisa menit (2j45m → 2 jam + 45 menit)
  tasMaxKts: z.number().optional(),
  tasSearchKts: z.number().optional(),       // TAS/speed di area pencarian
  visibilityKm: z.number().optional(),
  windDirFrom: z.number().min(0).max(360).optional(),
  windSpeedKts: z.number().optional(),
  observerCondition: z.string().optional(),  // mis. "fresh"
  taf: z.string().optional(),                // mis. "Inter" → dinormalisasi normalizeTafCondition
  frequencies: z.array(z.string()).optional(),
  captain: z.string().optional(),
  phoneSatellite: z.string().optional(),
  navigation: z.array(z.string()).optional(),
  /** Data lembar worksheet live (WS 2/WS 8) bila kasus berasal dari snapshot
   *  aplikasi — dipakai verbatim oleh seeds/pipeline (lihat sruSheetSchema). */
  sheet: sruSheetSchema.optional(),
});
export type CaseSru = z.infer<typeof sruSchema>;

/** Daftar output yang diminta dari peserta/planner. */
export const TASK_REQUESTS = [
  'aeronautical-drift',
  'asw',
  'search-area-abcd',
  'wsc-pod',
  'asset-allocation',
  'search-pattern-csp',
  'sru-task-assignment',
  'renops',
  'briefing',
  'debriefing',
] as const;

export const metaSchema = z.object({
  /** Asumsi yang dipakai saat ekstraksi/generate (field + alasannya). */
  assumptions: z.array(z.object({
    field: z.string(),
    value: z.string().optional(),
    reason: z.string(),
  })).optional(),
  /** Field soal yang hilang/tidak disebut — wajib ditanya ke pengguna. */
  missingFields: z.array(z.object({
    field: z.string(),
    reason: z.string(),
  })).optional(),
  /** Fase 3 (keputusan no.6): provenance per-field dari ekstraksi — teks
   *  sumber di soal + status verifikasi. HANYA nilai yang MEMANG tertulis
   *  di soal yang boleh berstatus VERIFIED; hasil tafsiran/penurunan model
   *  WAJIB UNVERIFIED (tidak boleh dianggap resmi/final). */
  fieldSources: z.array(z.object({
    field: z.string(),
    source: z.string(),
    status: verificationStatusSchema.optional(),
  })).optional(),
  source: z.enum(['pdf', 'text', 'generator', 'manual', 'unknown']).optional(),
  /** Seed generator soal (kosong/acak untuk soal manual). */
  seed: z.string().optional(),
  modelVersion: z.string().optional(),
  extractedAt: z.string().optional(),
  approval: z.enum(DATA_APPROVAL_STATUSES).optional(),
});
export type CaseMeta = z.infer<typeof metaSchema>;

/** SKEMA KASUS UTAMA. Permisif: bagian yang tidak relevan untuk jenis insiden
 *  tertentu boleh kosong (mis. vessel-sinking tanpa windLayers). */
export const sarCaseSchema = z.object({
  schemaVersion: z.number().int().min(1).default(1),
  caseTitle: z.string().optional(),
  examHeader: examHeaderSchema.optional(),
  incident: incidentSchema,
  target: targetSchema.optional(),
  sarOffice: sarOfficeSchema.optional(),
  lkp: lkpSchema.optional(),
  aeroDrift: aeroDriftSchema.optional(),
  sea: seaSchema.optional(),
  search: searchSchema.optional(),
  sru: z.array(sruSchema).optional(),
  tasksRequested: z.array(z.string()).optional(),
  meta: metaSchema.optional(),
});
export type SarCaseSchema = z.infer<typeof sarCaseSchema>;

/** Parse + validasi input kasus apa pun (JSON dari ekstraksi AI / generator / file).
 *  Mengembalikan null + issues bila tidak valid — TIDAK pernah melempar. */
export function parseSarCase(data: unknown): { ok: true; data: SarCaseSchema } | { ok: false; issues: string[] } {
  const result = sarCaseSchema.safeParse(data);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues.map((issue) =>
    `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`,
  );
  return { ok: false, issues };
}
