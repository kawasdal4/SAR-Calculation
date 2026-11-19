/**
 * SAR CAPABILITY REGISTRY (PHASE 2 — ADDENDUM MASTER PROMPT)
 * ==========================================================
 * Registry tunggal yang mendata seluruh kemampuan sistem (worksheet,
 * kalkulasi dasar, konversi, peta, pola pencarian, aset, transit, intercept,
 * dokumen operasional, pengetahuan) — bukan hanya worksheet.
 *
 * ATURAN PENTING:
 * - Registry TIDAK menduplikasi fungsi asli. `execute` hanya delegasi tipis ke
 *   fungsi lib existing, atau komposisi 1:1 dari formula worksheet yang sudah
 *   ada di komponen (disebut di `notes`).
 * - Capability yang belum tersedia diberi `status: 'unavailable'` — TIDAK
 *   dibuatkan formula/workflow baru untuk menutup gap.
 * - `implementation` memuat pointer file#export agar setiap hasil dapat
 *   dilacak ke sumbernya (traceability).
 */

import {
  computeAWA,
  computeASW,
  computeWC,
  computeLW,
  computeTWC,
  computeDatum,
  computeE,
  computeSweepWidth,
  computeTotalSearchEffort,
  computeEffortAllocation,
  distanceNm,
  computeWs1SearchArea,
  getLeewayObjectById,
  type DatumType,
  type LatLng,
  type SearchFacilityType,
  type SearchObjectCategory,
} from './sarCalculations';
import { calculateAeroDrift, type AeroDriftInput } from './aeroDriftCalculations';
import {
  generateSearchPattern,
  clipSearchPatternToSquare,
  type SearchPatternParams,
  type SearchPatternResult,
} from './searchPatterns';
import { calculateIntercept, type InterceptInput } from './interceptCalculations';
import {
  calculateAssetAllocationSummary,
  calculateSruAsset,
  type SruAssetInput,
} from './assetAllocation';
import {
  convertDistance,
  convertSpeed,
  convertTimezone,
  decimalHoursToHms,
  hmsToDecimalHours,
  solveSvt,
  solveArea,
  calcSearchers,
  sweptPercentage,
  formatDuration,
  type DistanceUnit,
  type SpeedUnit,
  type TzZone,
} from './basicCalculations';
import { parseDtg, dtgToZones, dtgToIso, formatDtg } from './dtg.mjs';
import { computePointRadius, computeLegTrapezoid } from './landSearchRadius.mjs';
import { calculateMefFeet } from './oncMef.mjs';
import { formatDMS, parseCoordinate } from './coordFormat';
import {
  chartDistanceFromMinutes,
  chartDistanceFromPoints,
  chartMeasureGuide,
  CHART_DISTANCE_RULE,
  type ChartKind,
} from './chartDistance';
import {
  computeW2Row,
  computeW8Row,
  readFigureI12,
  computePOD,
  type SearchNumber,
  type W2Target,
  type W8Target,
} from './wscPodTables';
import {
  lookupLandWu,
  lookupLandFv,
  nearestLandTrackSpacing,
  type LandSearchTarget,
  type LandSearchHeight,
  type LandVegetation,
  type LandSearchPlatform,
} from './landSearchTables';
import { buildDocument, type DocType, type DocumentSnapshot, type DataBankField, type GeneratedDocument } from './dataBank';

// ============================================================================
// Tipe registry
// ============================================================================

export type SARCapabilityCategory =
  | 'WORKSHEET_CALCULATION'
  | 'BASIC_CALCULATION'
  | 'UNIT_CONVERSION'
  | 'MAP_OPERATION'
  | 'SEARCH_PATTERN'
  | 'ASSET_ALLOCATION'
  | 'TRANSIT_CALCULATION'
  | 'INTERCEPT'
  | 'OPERATIONAL_DOCUMENT'
  | 'KNOWLEDGE_RETRIEVAL';

export type CapabilityStatus = 'available' | 'partial' | 'unavailable';

/** Bagaimana capability dieksekusi saat ini (hasil audit PHASE 1). */
export type ExecutionMode =
  | 'lib'          // fungsi deterministik di src/lib/sar — dapat dipanggil headless
  | 'component'    // logika di komponen UI — dieksekusi lewat worksheet/tab
  | 'route'        // lewat API route (/api/…)
  | 'none';        // belum tersedia

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

/** PHASE 4: fitur yang akan dirender peta oleh satu operasi. */
export interface MapPreviewFeature {
  kind: 'marker' | 'line' | 'polygon' | 'circle' | 'pattern' | 'vector' | 'label';
  label?: string;
  coord?: LatLng;
  coords?: LatLng[];
  radiusNm?: number;
}

/**
 * PHASE 4 — kontrak preview/konfirmasi seragam untuk capability yang mengubah
 * peta/state (Peta Laut, ONC WS4, UPS). `preview()` WAJIB dipanggil SEBELUM
 * eksekusi; UI/AI menampilkan kontrak ini dan meminta konfirmasi pengguna bila
 * `requiresUserConfirmation`. Tanpa workflow baru — hanya formalisasi aturan
 * yang sudah tertulis di notes map-sea-render.
 */
export interface MapPreviewContract {
  operation: string;          // id capability sumber
  summary: string;            // ringkasan satu kalimat apa yang akan dirender
  target: 'sea-map' | 'onc-map' | 'ups-plotter' | 'document' | 'state';
  features: MapPreviewFeature[];
  requiresUserConfirmation: boolean;
  reversible: boolean;        // bisa dibatalkan lewat clear/reset yang sudah ada
  warnings?: string[];
}

export interface SARCapability {
  id: string;
  name: string;
  category: SARCapabilityCategory;
  description: string;
  version: string;
  status: CapabilityStatus;
  executionMode: ExecutionMode;
  /** Pointer implementasi existing: "path#export" atau "path#komponen". */
  implementation: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  validateInput?: (input: unknown) => ValidationResult;
  execute?: (input: unknown) => Promise<unknown> | unknown;
  /** true bila eksekusi (khususnya oleh AI) mengubah peta/state/dokumen. */
  requiresConfirmation: boolean;
  /** PHASE 4: kontrak preview seragam — dipanggil sebelum eksekusi operasi peta/state. */
  preview?: (input: unknown) => MapPreviewContract;
  dependencies?: string[];
  notes?: string;
}

// ============================================================================
// Helper schema & validasi
// ============================================================================

const f = (type: string, description: string, extra?: Record<string, unknown>) =>
  ({ type, description, ...extra });
const schema = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: 'object', properties, required });

const ok = (): ValidationResult => ({ valid: true, errors: [] });
const err = (...errors: string[]): ValidationResult => ({ valid: false, errors });

const num = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const latLngOk = (v: unknown): v is LatLng =>
  typeof v === 'object' && v !== null &&
  num((v as LatLng).lat) && Math.abs((v as LatLng).lat) <= 90 &&
  num((v as LatLng).lng) && Math.abs((v as LatLng).lng) <= 180;

/** PHASE 4: pembangun kontrak preview seragam untuk operasi yang mengubah peta. */
const mapPreview = (
  operation: string,
  summary: string,
  target: MapPreviewContract['target'],
  features: MapPreviewFeature[],
  opts?: { warnings?: string[]; reversible?: boolean },
): MapPreviewContract => ({
  operation,
  summary,
  target,
  features,
  requiresUserConfirmation: true,
  reversible: opts?.reversible ?? true,
  warnings: opts?.warnings,
});

// ============================================================================
// Registry — daftar capability lengkap + dependency
// ============================================================================

export const SAR_CAPABILITY_REGISTRY: SARCapability[] = [
  // ------------------------------------------------------------------
  // WORKSHEET_CALCULATION — Lingkungan & Drift (A)
  // ------------------------------------------------------------------
  {
    id: 'env-awa',
    name: 'Worksheet AWA (Average Wind Aloft)',
    category: 'WORKSHEET_CALCULATION',
    description: 'Rata-rata vektor angin atas berlapis sampai ketinggian distress (IAMSAR App. K-10). Hasil menjadi angin glide ADW.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/sarCalculations.ts#computeAWA', 'src/components/sar/AWAWorksheet.tsx'],
    inputSchema: schema({
      observations: f('array', 'Lapisan angin {altObs, windDirFrom (0–360°T), windSpeed (kts)}; wajib ada baris 0 ft dan level teratas mencapai target.', { items: f('object', 'Observasi angin per ketinggian') }),
      targetAltitudeFt: f('number', 'Ketinggian distress (ft)', { unit: 'ft' }),
    }, ['observations', 'targetAltitudeFt']),
    outputSchema: schema({
      awaDirFrom: f('number', 'Arah AWA (FROM, °T)'),
      awaSpeed: f('number', 'Kecepatan AWA', { unit: 'kts' }),
      vectorSumKts: f('number', 'Besar jumlah vektor (ΣA·C)'),
      rows: f('array', 'Kontribusi tiap lapisan (untuk MoBo)'),
    }),
    validateInput: (input) => {
      const i = input as { observations?: unknown[]; targetAltitudeFt?: number };
      if (!Array.isArray(i.observations) || i.observations.length === 0) return err('Observasi angin atas kosong.');
      if (!num(i.targetAltitudeFt) || i.targetAltitudeFt <= 0) return err('Ketinggian target harus > 0 ft.');
      return ok();
    },
    execute: (input) => {
      const i = input as { observations: never[]; targetAltitudeFt: number };
      return computeAWA(i.observations, i.targetAltitudeFt);
    },
    requiresConfirmation: false,
    dependencies: [],
    notes: 'Validasi lib: wajib baris 0 ft; level teratas harus mencapai target. MoBo tab AWA memplot kontribusi per lapisan.',
  },
  {
    id: 'env-asw',
    name: 'Worksheet ASW (Average Surface Wind)',
    category: 'WORKSHEET_CALCULATION',
    description: 'Rata-rata vektor angin permukaan berbobot jam antara distress time dan datum time (App. K-19) + aswdve = 8% × aswErr.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/sarCalculations.ts#computeASW', 'src/components/sar/ASWWorksheet.tsx'],
    inputSchema: schema({
      observations: f('array', 'Baris {timeStart, timeEnd, hours, windDirFrom (0–360°T), windSpeed (kts)}'),
    }, ['observations']),
    outputSchema: schema({
      aswDirFrom: f('number', 'Arah ASW (FROM, °T)'),
      aswSpeed: f('number', 'Kecepatan ASW', { unit: 'kts' }),
      totalHours: f('number', 'Total jam interval', { unit: 'h' }),
      rows: f('array', 'Kontribusi tiap observasi'),
    }),
    validateInput: (input) => {
      const i = input as { observations?: unknown[] };
      if (!Array.isArray(i.observations) || i.observations.length === 0) return err('Observasi angin permukaan kosong.');
      return ok();
    },
    execute: (input) => computeASW((input as { observations: never[] }).observations),
    requiresConfirmation: false,
    dependencies: [],
    notes: 'Perhatian audit: komponen ASWWorksheet masih mengimplementasikan ulang rumus yang sama secara inline — lib computeASW adalah sumber tunggal yang dipakai registry.',
  },
  {
    id: 'env-adw',
    name: 'Worksheet ADW (Aeronautical Drift) + posisi ditching',
    category: 'WORKSHEET_CALCULATION',
    description: 'Drift glide pesawat dan/atau parasut dari titik insiden memakai angin AWA; menghasilkan posisi ditching (landing) yang menjadi LKP baru.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/aeroDriftCalculations.ts#calculateAeroDrift', 'src/components/sar/AeronauticalDriftWorksheet.tsx'],
    inputSchema: schema({
      incidentPos: f('object', 'Posisi insiden {lat, lng} desimal (S/B negatif)'),
      useAircraftGlide: f('boolean', 'Segmen glide pesawat aktif'),
      aircraftAltMaxFt: f('number', 'Altmax (ft)', { unit: 'ft' }),
      aircraftAltMinFt: f('number', 'Altmin (ft); ditching laut = 0 (asumsi standar)', { unit: 'ft' }),
      aircraftGlideRatio: f('number', 'Glide ratio (mis. 8 = 8:1)'),
      aircraftTASgKts: f('number', 'Glide TAS (bukan cruise)', { unit: 'kts' }),
      aircraftDescentHeadingDeg: f('number', 'Haluan turun (derajat True)'),
      useParachute: f('boolean', 'Segmen parasut aktif'),
      awaIsValid: f('boolean', 'AWA valid (dependency env-awa)'),
      awaGlideDirFrom: f('number', 'Arah AWA (FROM, °T)'),
      awaGlideSpeedKts: f('number', 'Kecepatan AWA', { unit: 'kts' }),
      parachuteType: f('string', "'steerable' | 'round-zero-glide'"),
      parachuteRateOfDescentFtMin: f('number', 'ROD parasut dari Table N-13', { unit: 'ft/min' }),
      fixErrorXNm: f('number', 'Error posisi target X (NM)'),
      safetyFactorFs: f('number', 'Faktor keselamatan fs'),
    }, ['incidentPos', 'awaIsValid', 'awaGlideDirFrom', 'awaGlideSpeedKts']),
    outputSchema: schema({
      landingPos: f('object', 'Posisi ditching {lat, lng} — menjadi LKP baru'),
      aircraftGlideDistanceNm: f('number', 'B.8 jarak glide', { unit: 'NM' }),
      aircraftRateOfDescentFtMin: f('number', 'B.6 ROD', { unit: 'ft/min' }),
      aircraftTimeOfDescentMin: f('number', 'B.7 waktu turun', { unit: 'min' }),
      totalDisplacementNm: f('number', 'B.12 pergeseran total', { unit: 'NM' }),
      validationErrors: f('array', 'Daftar error validasi B.1–B.12'),
    }),
    validateInput: (input) => {
      const i = input as AeroDriftInput;
      if (!latLngOk(i.incidentPos)) return err('Posisi insiden tidak valid.');
      const anySegment = i.useAircraftGlide === true || i.useParachute === true;
      if (!anySegment) return err('Minimal satu segmen (pesawat/parasut) harus aktif.');
      if (i.useAircraftGlide && (!num(i.aircraftGlideRatio) || i.aircraftGlideRatio <= 0)) return err('Glide ratio harus > 0.');
      if (i.useAircraftGlide && (!num(i.aircraftTASgKts) || i.aircraftTASgKts <= 0)) return err('Glide TAS harus > 0 kts.');
      if (i.useAircraftGlide && (!num(i.aircraftAltMaxFt) || i.aircraftAltMaxFt <= 0)) return err('Altmax harus > 0 ft.');
      if (i.useAircraftGlide && num(i.aircraftAltMaxFt) && num(i.aircraftAltMinFt) && i.aircraftAltMinFt > i.aircraftAltMaxFt) return err('Altmin melebihi Altmax.');
      return ok();
    },
    execute: (input) => calculateAeroDrift(input as AeroDriftInput),
    requiresConfirmation: false,
    dependencies: ['env-awa'],
    notes: 'Hasil landingPos disinkronkan otomatis ke LKP lewat efek adwSyncLkp (page.tsx). De/R/Ao pada hasil ADW masih stub null — search area dihitung di ws1/ws-search-plan.',
  },
  {
    id: 'env-mobo',
    name: 'Maneuvering Board (MoBo) AWA & ASW',
    category: 'WORKSHEET_CALCULATION',
    description: 'Papan manuver visual: vektor kontribusi angin per lapisan/observasi, vektor resultan, dan TWC (×5) — alat bantu plotting, bukan kalkulator.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/ManeuveringBoard.tsx', 'src/lib/sar/maneuveringBoard.ts'],
    inputSchema: schema({
      tab: f('string', "'awa' | 'asw' — data vektor diambil dari state worksheet terkait"),
    }, []),
    outputSchema: schema({ plot: f('string', 'Gambar MoBo pada tab terkait (visual saja)') }),
    requiresConfirmation: false,
    dependencies: ['env-awa', 'env-asw', 'ws1-datum'],
    notes: 'Vektor kontribusi digambar arah FROM (fisikanya menunjuk downwind) — catatan audit, tidak mengubah perhitungan.',
  },

  // ------------------------------------------------------------------
  // WORKSHEET_CALCULATION — Perencanaan SAR (B)
  // ------------------------------------------------------------------
  {
    id: 'ws1-datum',
    name: 'Worksheet 1 — Datum (WC/TWC/LW/Datum/E)',
    category: 'WORKSHEET_CALCULATION',
    description: 'Rantai datum maritim dari LKP: wind current, total water current, leeway (kiri/kanan), posisi datum L/R, De, dan E = √(X²+De²+Y²).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: [
      'src/lib/sar/sarCalculations.ts#computeWC', 'src/lib/sar/sarCalculations.ts#computeTWC',
      'src/lib/sar/sarCalculations.ts#computeLW', 'src/lib/sar/sarCalculations.ts#computeDatum',
      'src/lib/sar/sarCalculations.ts#computeE', 'src/components/sar/DatumWorksheet.tsx',
    ],
    inputSchema: schema({
      start: f('object', 'LKP {lat, lng} — untuk kasus penerbangan = posisi ditching hasil env-adw'),
      driftInterval: f('number', 'Lama drift', { unit: 'h' }),
      aswDirFrom: f('number', 'Arah ASW (FROM, °T) — dari env-asw'),
      aswSpeed: f('number', 'Kecepatan ASW', { unit: 'kts' }),
      aswdve: f('number', 'Error ASW (default 8% × aswErr)', { unit: 'kts' }),
      latitude: f('number', 'Lintang absolut (untuk divergensi WC)'),
      seaCurrentDir: f('number', 'Arah arus laut (SET, °T)'),
      seaCurrentSpeed: f('number', 'Kecepatan arus laut', { unit: 'kts' }),
      leewayObjectId: f('string', 'ID objek Table I-1 (13 jenis, mis. raft-noballast-drogue)'),
      X: f('number', 'Error posisi target (NM, Table J-1 — GPS 0.1, Radar/Visual/LORAN C 1.0, Celestial 2.0, MRB 4.0, INS/VOR-TACAN 0.5)'),
      Y: f('number', 'Error posisi SRU (NM, Table J-1 — SRU pencari pakai GPS → 0.1, Radar/Visual/LORAN C 1.0, Celestial 2.0, MRB 4.0, INS/VOR-TACAN 0.5)'),
    }, ['start', 'driftInterval', 'aswDirFrom', 'aswSpeed', 'seaCurrentDir', 'seaCurrentSpeed', 'leewayObjectId']),
    outputSchema: schema({
      datumLeft: f('object', 'Datum kiri {lat, lng}'),
      datumRight: f('object', 'Datum kanan {lat, lng}'),
      driftDistance: f('number', 'Jarak drift', { unit: 'NM' }),
      De: f('number', 'Total probable drift error', { unit: 'NM' }),
      E: f('number', 'Total probable error E', { unit: 'NM' }),
      divergenceDistance: f('number', 'Jarak divergensi datum L–R', { unit: 'NM' }),
      twc: f('object', 'Vektor TWC {dir, mag}'),
    }),
    validateInput: (input) => {
      const i = input as Record<string, unknown>;
      if (!latLngOk(i.start)) return err('LKP tidak valid.');
      if (!num(i.driftInterval) || (i.driftInterval as number) <= 0) return err('Drift interval harus > 0 jam.');
      if (!num(i.aswSpeed) || (i.aswSpeed as number) <= 0) return err('ASW speed harus > 0 kts.');
      if (!getLeewayObjectById(String(i.leewayObjectId ?? ''))) return err('leewayObjectId tidak dikenal (Table I-1).');
      return ok();
    },
    execute: (input) => {
      const i = input as {
        start: LatLng; driftInterval: number; aswDirFrom: number; aswSpeed: number;
        aswdve?: number; latitude?: number; seaCurrentDir: number; seaCurrentSpeed: number;
        seaCurrentErr?: number; leewayObjectId: string; X?: number; Y?: number;
      };
      const latitude = num(i.latitude) ? i.latitude : Math.abs(i.start.lat);
      const wc = computeWC(i.aswDirFrom, i.aswSpeed, latitude, 0.3);
      const objectType = getLeewayObjectById(i.leewayObjectId);
      const lw = computeLW(i.aswDirFrom, i.aswSpeed, objectType);
      const twc = computeTWC({
        seaCurrent: { dir: i.seaCurrentDir, mag: i.seaCurrentSpeed },
        seaCurrentErr: i.seaCurrentErr ?? 0,
        windCurrent: { dir: wc.wcSet, mag: wc.wcDrift },
        windCurrentErr: wc.wcErr,
      });
      const datum = computeDatum({
        start: i.start,
        driftInterval: i.driftInterval,
        aswDirFrom: i.aswDirFrom,
        aswSpeed: i.aswSpeed,
        aswdve: i.aswdve ?? i.aswSpeed * 0.08,
        twc: twc.twc,
        twcErr: twc.twcErr,
        lwLeftDir: lw.lwLeftDir,
        lwRightDir: lw.lwRightDir,
        lwSpeed: lw.leewaySpeed,
        lwErr: lw.lwError,
      });
      const e = computeE({ X: i.X ?? 0, De: datum.De, Y: i.Y ?? 0 });
      return { ...datum, E: e.E, wcSet: wc.wcSet, wcDrift: wc.wcDrift, leewaySpeed: lw.leewaySpeed };
    },
    requiresConfirmation: false,
    dependencies: ['env-asw'],
    notes: 'Komposisi 1:1 rantai DatumWorksheet (wcErr 0.3 kt, aswdve default 8% × aswErr — konstanta existing). Arus pasang (tidal) didukung computeTWC tapi belum diekspos UI.',
  },
  {
    id: 'ws1-search-area',
    name: 'Worksheet 1 — Search Area (Ao)',
    category: 'WORKSHEET_CALCULATION',
    description: 'Luas area pencarian awal: E = √(De²+X²+Y²), R = ⌈E × fs⌉ dan Ao = 4R² (persegi sisi 2R di sekitar datum, orientasi LKP→datum).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/sarCalculations.ts#computeWs1SearchArea', 'src/lib/sar/sarCalculations.ts#computeE', 'src/components/sar/worksheets/Worksheet1.tsx'],
    inputSchema: schema({
      De: f('number', 'Total drift error (NM) — alternatif memberi E langsung', { unit: 'NM' }),
      X: f('number', 'Fix error distress craft (Table J-1 — GPS 0.1, Radar/Visual/LORAN C 1.0, Celestial 2.0, MRB 4.0, INS/VOR-TACAN 0.5)', { unit: 'NM' }),
      Y: f('number', 'Fix error SRU (Table J-1 — SRU pencari pakai GPS → 0.1, Radar/Visual/LORAN C 1.0, Celestial 2.0, MRB 4.0, INS/VOR-TACAN 0.5)', { unit: 'NM' }),
      E: f('number', 'Total probable error langsung (NM); bila diberikan, De/X/Y diabaikan', { unit: 'NM' }),
      fs: f('number', 'Faktor keselamatan (opsi worksheet: 1.1/1.6/2.0/2.3/2.5)'),
    }, ['fs']),
    outputSchema: schema({
      E: f('number', 'Total probable error E', { unit: 'NM' }),
      R: f('number', 'Radius pencarian (NM, dibulatkan ke atas)', { unit: 'NM' }),
      Ao: f('number', 'Luas area pencarian', { unit: 'NM²' }),
    }),
    validateInput: (input) => {
      const i = input as { E?: number; De?: number; fs?: number };
      const eGiven = num(i.E) && i.E > 0;
      const deGiven = num(i.De) && i.De > 0;
      if (!eGiven && !deGiven) return err('Berikan E > 0 ATAU De > 0 (dengan X/Y).');
      if (![1.1, 1.6, 2.0, 2.3, 2.5].includes(i.fs as number)) return err('fs harus salah satu dari 1.1/1.6/2.0/2.3/2.5.');
      return ok();
    },
    execute: (input) => {
      const i = input as { De?: number; X?: number; Y?: number; E?: number; fs: number };
      if (num(i.E) && i.E > 0) {
        // Jalur E langsung: formula yang sama (R = ⌈E×fs⌉, Ao = 4R²) tanpa computeE.
        const R = Math.ceil(i.E * i.fs);
        return { E: i.E, R, Ao: 4 * R * R };
      }
      return computeWs1SearchArea({ De: i.De ?? 0, X: i.X ?? 0, Y: i.Y ?? 0, fs: i.fs });
    },
    requiresConfirmation: false,
    dependencies: ['ws1-datum'],
    notes: 'PHASE 3: logika Worksheet1.tsx kini diekstraksi ke computeWs1SearchArea (komponen memakai fungsi ini). Audit: rantai Ao paralel (Worksheet1 vs SearchPlanWorksheet) tetap dipertahankan.',
  },
  {
    id: 'ws2-maritime-wsc-pod',
    name: 'Worksheet 2 — Maritime W/S/C/POD (udara di laut)',
    category: 'WORKSHEET_CALCULATION',
    description: 'Sweep width terkoreksi W = Wu×fw×fs×ff, S pembulatan 0.5/0.25 NM, C = W/S, POD dari kurva Figure I-12 (rumus polinomial Excel POD.xls); T = A/(TAS×S). Tabel I-5/I-6/I-7/I-8, kasus PIW ×4 @500 ft.',
    version: '1.1.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/wscPodTables.ts#computeW2Row', 'src/components/sar/worksheets/Worksheet2.tsx'],
    inputSchema: schema({
      platform: f('string', "'fixed-wing' | 'helicopter'"),
      target: f('string', 'ID objek W2Target (22 opsi, mis. raft6)'),
      heightFt: f('number', '500/1000/1500/2000 ft', { unit: 'ft' }),
      visibilityIndex: f('number', 'Indeks kolom visibilitas (0–5 → 2/5/10/20/30/>40 km)'),
      windKts: f('number', 'Kecepatan ASW', { unit: 'kts' }),
      caseWindKts: f('number', 'Opsional: angin permukaan sesuai soal kasus (AI asisten) — fallback penentu Fw Table I-7 bila ASW kosong', { unit: 'kts' }),
      caseWaveHeightM: f('number', 'Opsional: tinggi gelombang laut (seas) sesuai soal kasus (AI asisten) — penentu baris Fw Table I-7 bersama angin, terburuk bila keduanya ada', { unit: 'm' }),
      tasKts: f('number', 'TAS SRU', { unit: 'kts' }),
      fatigue: f('string', "'Yes' | 'No' (boolean juga diterima)"),
      searchNumber: f('number', 'Pencarian ke-1..5'),
      piwFlotationKnown: f('boolean', 'Khusus target PIW: flotation known → Wu 500 ft ×4'),
      areaAoNm2: f('number', 'Luas area (dari ws1-search-area)', { unit: 'NM²' }),
    }, ['platform', 'target', 'heightFt', 'visibilityIndex', 'windKts', 'tasKts', 'fatigue', 'searchNumber']),
    outputSchema: schema({
      ready: f('boolean', 'Gerbang faktor lengkap'),
      Wu: f('number', 'Uncorrected sweep width (Table I-5/I-6)', { unit: 'NM' }),
      fw: f('number', 'Weather correction'), fs: f('number', 'Speed correction (Table I-8)'), ff: f('number', 'Fatigue factor'),
      W: f('number', 'Sweep width terkoreksi', { unit: 'NM' }),
      S: f('number', 'Track spacing', { unit: 'NM' }),
      C: f('number', 'Coverage factor'), POD: f('number', 'POD dari kurva Figure I-12 — polinomial Excel POD.xls (persen 0–100)'),
      T: f('number', 'Waktu pencarian', { unit: 'h' }),
    }),
    validateInput: (input) => {
      const i = input as { platform?: string; target?: string; heightFt?: number; visibilityIndex?: number; windKts?: number; caseWindKts?: number; caseWaveHeightM?: number; tasKts?: number; fatigue?: unknown; searchNumber?: number };
      if (i.platform !== 'fixed-wing' && i.platform !== 'helicopter') return err('Platform harus fixed-wing atau helicopter.');
      if (!str(i.target)) return err('Target objek wajib diisi.');
      if (![500, 1000, 1500, 2000].includes(i.heightFt as number)) return err('Tinggi harus 500/1000/1500/2000 ft.');
      if (!num(i.visibilityIndex) || (i.visibilityIndex as number) < 0 || (i.visibilityIndex as number) > 5) return err('Indeks visibilitas harus 0–5.');
      // Penentu Fw Table I-7: angin ASW ATAU angin/gelombang kasus (AI asisten) — minimal satu harus tersedia.
      const aswOk = num(i.windKts) && (i.windKts as number) > 0;
      const caseOk = num(i.caseWindKts) && (i.caseWindKts as number) > 0;
      const waveOk = num(i.caseWaveHeightM) && (i.caseWaveHeightM as number) > 0;
      if (!aswOk && !caseOk && !waveOk) return err('ASW speed harus > 0 kts, atau sertakan caseWindKts (angin kasus) dan/atau caseWaveHeightM (gelombang kasus) bila ASW belum dihitung.');
      if (!num(i.tasKts) || i.tasKts <= 0) return err('TAS harus > 0 kts.');
      const fat = i.fatigue === true || i.fatigue === 'Yes' || i.fatigue === 'No' || i.fatigue === false;
      if (!fat) return err("fatigue harus 'Yes' | 'No' (atau boolean).");
      if (![1, 2, 3, 4, 5].includes(i.searchNumber as number)) return err('Search number harus 1–5.');
      return ok();
    },
    execute: (input) => {
      const i = input as {
        platform: 'fixed-wing' | 'helicopter'; target: W2Target; heightFt: 500 | 1000 | 1500 | 2000;
        visibilityIndex: number; windKts: number; caseWindKts?: number; caseWaveHeightM?: number; tasKts: number;
        fatigue: boolean | 'Yes' | 'No'; searchNumber: 1 | 2 | 3 | 4 | 5;
        piwFlotationKnown?: boolean; areaAoNm2?: number;
      };
      return computeW2Row({
        platform: i.platform,
        target: i.target,
        heightFt: i.heightFt,
        visibilityIndex: i.visibilityIndex,
        windKts: i.windKts,
        caseWindKts: i.caseWindKts,
        caseWaveHeightM: i.caseWaveHeightM,
        tasKts: i.tasKts,
        fatigue: i.fatigue === true ? 'Yes' : i.fatigue === false ? 'No' : i.fatigue,
        searchNumber: i.searchNumber,
        piwFlotationKnown: i.piwFlotationKnown,
        areaAoNm2: i.areaAoNm2,
      });
    },
    requiresConfirmation: false,
    dependencies: ['ws1-search-area', 'env-asw'],
    notes: 'PHASE 3: math komponen diekstraksi ke computeW2Row (satu sumber untuk UI dan AI). PIW 500 ft ×4 bila flotation known; fs null bila TAS di luar kolom Table I-8 → ready=false. Fw Table I-7: baris dari angin ASW ATAU angin/gelombang kasus (caseWindKts/caseWaveHeightM) bila ASW kosong — terburuk bila keduanya ada; kolom dari search object (PIW/raft/boat <10 m → small).',
  },
  {
    id: 'ws3-land-wsc-pod',
    name: 'Worksheet 3 — Land W/S/C/POD',
    category: 'WORKSHEET_CALCULATION',
    description: 'Pencarian darat: W = Wu×Fv×Ff (Tabel I-9/I-10), S pembulatan 0.5/0.25 NM, C, POD dari kurva Figure I-12 (rumus polinomial Excel POD.xls), T = A/(V×S).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/landSearchTables.ts#lookupLandWu', 'src/lib/sar/landSearchTables.ts#lookupLandFv', 'src/components/sar/worksheets/Worksheet3.tsx'],
    inputSchema: schema({
      target: f('string', "'person' | 'vehicle' | 'aircraft-under-5700' | 'aircraft-over-5700'"),
      altitudeFt: f('number', 'Tinggi AGL 500–2000 ft', { unit: 'ft' }),
      visibilityKm: f('number', '5/10/20/30/40 km'),
      vegetation: f('string', "Vegetasi Table I-10: 'under-15' | '15-60' | '60-85' | 'over-85' (% kanopi)"),
      windKts: f('number', 'Kecepatan ASW', { unit: 'kts' }),
      fatigue: f('boolean', 'Faktor 0.9 bila ya'),
      platform: f('string', "'fixed-wing' | 'helicopter'"),
      searchNumber: f('number', 'Pencarian ke-1..5'),
      searchSpeedKts: f('number', 'V pencarian', { unit: 'kts' }),
      areaAoNm2: f('number', 'Luas area (dari ws-search-plan)', { unit: 'NM²' }),
    }, ['target', 'altitudeFt', 'visibilityKm', 'vegetationIndex', 'platform', 'searchNumber', 'searchSpeedKts']),
    outputSchema: schema({
      Wu: f('number', 'Uncorrected sweep width (Table I-9)', { unit: 'NM' }),
      Fv: f('number', 'Vegetation factor (Table I-10)'),
      W: f('number', 'Sweep width terkoreksi', { unit: 'NM' }),
      S: f('number', 'Track spacing', { unit: 'NM' }),
      C: f('number', 'Coverage factor'), POD: f('number', 'POD dari kurva Figure I-12 — polinomial Excel POD.xls (persen 0–100)'),
      T: f('number', 'Waktu pencarian', { unit: 'h' }),
    }),
    execute: (input) => {
      // Komposisi formula existing Worksheet3.tsx (W=Wu×Fv×Ff, S, C, POD, T).
      const i = input as {
        target: LandSearchTarget; altitudeFt: LandSearchHeight; visibilityKm: number;
        vegetation: LandVegetation; windKts: number; fatigue: boolean; platform: LandSearchPlatform;
        searchNumber: 1 | 2 | 3 | 4 | 5; searchSpeedKts: number; areaAoNm2?: number;
      };
      const Wu = lookupLandWu(i.target, i.altitudeFt, i.visibilityKm);
      if (Wu === null) return { valid: false, message: 'Kombinasi target/tinggi/visibilitas tidak ada di Table I-9 (person N/A ≥1500 ft).' };
      const Fv = lookupLandFv(i.target, i.vegetation);
      if (Fv === null) return { valid: false, message: 'Vegetasi tidak dikenal pada Table I-10.' };
      const Ff = i.fatigue ? 0.9 : 1;
      const W = Wu * Fv * Ff;
      const S = nearestLandTrackSpacing(W, i.platform);
      const C = S > 0 ? W / S : 0;
      const POD = readFigureI12(C, i.searchNumber);
      const T = num(i.areaAoNm2) && i.areaAoNm2 > 0 ? i.areaAoNm2 / (i.searchSpeedKts * S) : null;
      return { Wu, Fv, Ff, W, S, C, POD, T };
    },
    requiresConfirmation: false,
    dependencies: ['ws-search-plan', 'ws1-search-area'],
    notes: 'hoursAvailable hanya tampilan; Options A–D belum dihitung (gap audit).',
  },
  {
    id: 'ws4-land-radius',
    name: 'Worksheet 4 — Radius rute darat/udara + trapesium',
    category: 'WORKSHEET_CALCULATION',
    description: 'Radius kemungkinan per titik rute: x = x₀ + 0.1×Tr (Table J-2/J-3), e = √(x²+y²), R = e×fs (dibulatkan ke atas); trapesium antar-leg.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/landSearchRadius.mjs#computePointRadius', 'src/lib/sar/landSearchRadius.mjs#computeLegTrapezoid', 'src/components/sar/worksheets/Worksheet4.tsx'],
    inputSchema: schema({
      points: f('array', 'Titik rute {lat, lng, trNm, x0Nm (gps 5/non-gps 10/custom), yNm, fs}'),
      legs: f('array', 'Jarak antar titik {dNm, rANm, rBNm} untuk trapesium'),
    }, ['points']),
    outputSchema: schema({
      perPoint: f('array', '{trNm, xNm, eNm, rNm, rRoundedNm}'),
      perLeg: f('array', 'Trapesium {aNm, bNm, hNm, areaSqNm, degenerate}'),
      totalAreaSqNm: f('number', 'Total luas kemungkinan', { unit: 'NM²' }),
    }),
    validateInput: (input) => {
      const i = input as { points?: unknown[] };
      if (!Array.isArray(i.points) || i.points.length === 0) return err('Titik rute kosong.');
      return ok();
    },
    execute: (input) => {
      const i = input as {
        points: Array<{ trNm: number; x0Nm: number; yNm: number; fs: number }>;
        legs?: Array<{ dNm: number; rANm: number; rBNm: number }>;
      };
      const perPoint = i.points.map((p) => computePointRadius(p));
      const perLeg = (i.legs ?? []).map((l) => computeLegTrapezoid(l.dNm, l.rANm, l.rBNm));
      const totalAreaSqNm = perLeg.length > 0
        ? perLeg.reduce((s, l) => s + (l.valid && !l.degenerate ? l.areaSqNm : 0), 0)
        : null;
      return { perPoint, perLeg, totalAreaSqNm };
    },
    requiresConfirmation: false,
    dependencies: [],
    notes: 'Capability mandiri (tidak bergantung datum). Peta: Worksheet4MapLibre (MapLibre) dengan graticule ONC — berbeda dari Peta Laut Leaflet.',
  },
  {
    id: 'ws8-vessel-wsc-pod',
    name: 'Worksheet 8 — Kapal W/S/C/POD',
    category: 'WORKSHEET_CALCULATION',
    description: 'SRU kapal permukaan: Wu dari Table I-3/I-4 berdasar tinggi mata (8/14 ft/MERSHIP), W = Wu×fw×ff, S pembulatan 0.25 NM, C, POD, T = A/(V×S).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/wscPodTables.ts#computeW8Row', 'src/components/sar/worksheets/Worksheet8.tsx'],
    inputSchema: schema({
      target: f('string', 'ID objek W8Target (22 opsi)'),
      eyeHeight: f('string', "'8' | '14' | 'MERSHIP'"),
      visibility: f('string', 'Label kolom visibilitas (2/5/10/15/20/>25 km)'),
      windKts: f('number', 'Kecepatan ASW', { unit: 'kts' }),
      caseWindKts: f('number', 'Opsional: angin permukaan sesuai soal kasus (AI asisten) — fallback penentu Fw Table I-7 bila ASW kosong', { unit: 'kts' }),
      caseWaveHeightM: f('number', 'Opsional: tinggi gelombang laut (seas) sesuai soal kasus (AI asisten) — penentu baris Fw Table I-7 bersama angin, terburuk bila keduanya ada', { unit: 'm' }),
      fatigue: f('string', "'Yes' | 'No' (boolean juga diterima)"),
      searchNumber: f('number', 'Pencarian ke-1..5'),
      vesselSpeedKts: f('number', 'Kecepatan kapal', { unit: 'kts' }),
      areaAoNm2: f('number', 'Luas area (dari ws1-search-area)', { unit: 'NM²' }),
    }, ['target', 'eyeHeight', 'visibility', 'windKts', 'fatigue', 'searchNumber', 'vesselSpeedKts']),
    outputSchema: schema({
      ready: f('boolean', 'Gerbang faktor lengkap'),
      Wu: f('number', 'Uncorrected sweep width (Table I-3/I-4)', { unit: 'NM' }),
      fw: f('number', 'Weather correction'), ff: f('number', 'Fatigue factor'),
      W: f('number', 'Sweep width terkoreksi (pembulatan 2 desimal)', { unit: 'NM' }),
      S: f('number', 'Track spacing', { unit: 'NM' }),
      C: f('number', 'Coverage (pembulatan 2 desimal)'), POD: f('number', 'POD dari kurva Figure I-12 — polinomial Excel POD.xls (persen 0–100)'),
      T: f('number', 'Waktu pencarian (pembulatan 1 desimal)', { unit: 'h' }),
    }),
    validateInput: (input) => {
      const i = input as { target?: string; eyeHeight?: string; visibility?: string; windKts?: number; caseWindKts?: number; caseWaveHeightM?: number; fatigue?: unknown; searchNumber?: number; vesselSpeedKts?: number };
      if (!str(i.target)) return err('Target objek wajib diisi.');
      if (!['8', '14', 'MERSHIP'].includes(i.eyeHeight as string)) return err("Eye height harus '8', '14', atau 'MERSHIP'.");
      if (!str(i.visibility)) return err('Kolom visibilitas wajib diisi.');
      // Penentu Fw Table I-7: angin ASW ATAU angin/gelombang kasus (AI asisten) — minimal satu harus tersedia.
      const aswOk = num(i.windKts) && (i.windKts as number) > 0;
      const caseOk = num(i.caseWindKts) && (i.caseWindKts as number) > 0;
      const waveOk = num(i.caseWaveHeightM) && (i.caseWaveHeightM as number) > 0;
      if (!aswOk && !caseOk && !waveOk) return err('ASW speed harus > 0 kts, atau sertakan caseWindKts (angin kasus) dan/atau caseWaveHeightM (gelombang kasus) bila ASW belum dihitung.');
      if (!(i.fatigue === true || i.fatigue === 'Yes' || i.fatigue === 'No' || i.fatigue === false)) return err("fatigue harus 'Yes' | 'No' (atau boolean).");
      if (![1, 2, 3, 4, 5].includes(i.searchNumber as number)) return err('Search number harus 1–5.');
      if (!num(i.vesselSpeedKts) || i.vesselSpeedKts <= 0) return err('Kecepatan kapal harus > 0 kts.');
      return ok();
    },
    execute: (input) => {
      const i = input as {
        target: W8Target; eyeHeight: '8' | '14' | 'MERSHIP'; visibility: string; windKts: number; caseWindKts?: number; caseWaveHeightM?: number;
        fatigue: boolean | 'Yes' | 'No'; searchNumber: 1 | 2 | 3 | 4 | 5;
        vesselSpeedKts: number; areaAoNm2?: number;
      };
      return computeW8Row({
        target: i.target,
        eyeHeight: i.eyeHeight,
        visibilityKm: i.visibility,
        windKts: i.windKts,
        caseWindKts: i.caseWindKts,
        caseWaveHeightM: i.caseWaveHeightM,
        fatigue: i.fatigue === true ? 'Yes' : i.fatigue === false ? 'No' : i.fatigue,
        searchNumber: i.searchNumber,
        vesselSpeedKts: i.vesselSpeedKts,
        areaAoNm2: i.areaAoNm2,
      });
    },
    requiresConfirmation: false,
    dependencies: ['ws1-search-area', 'env-asw'],
    notes: 'PHASE 3: math komponen diekstraksi ke computeW8Row (pembulatan W/C 2 desimal, T 1 desimal — identik Worksheet8). Gap audit: koreksi kecepatan kapal (fv) belum diterapkan di sistem. Fw Table I-7: baris dari angin ASW ATAU angin/gelombang kasus (caseWindKts/caseWaveHeightM) bila ASW kosong — terburuk bila keduanya ada; kolom dari search object (PIW/raft/boat <10 m → small).',
  },
  {
    id: 'ws-search-plan',
    name: 'Search Plan Worksheet (App. L — Zta, alokasi effort, C, POD, Ao)',
    category: 'WORKSHEET_CALCULATION',
    description: 'Mesin Appendix L: sweep width per fasilitas (matrix Wu × koreksi cuaca/kecepatan), effort Z = V×T×W, alokasi fZ (fs dari figure N-5..N-8), Ro, Ao, C, POD.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: [
      'src/lib/sar/sarCalculations.ts#computeSweepWidth', 'src/lib/sar/sarCalculations.ts#computeTotalSearchEffort',
      'src/lib/sar/sarCalculations.ts#computeEffortAllocation', 'src/lib/sar/wscPodTables.ts#computePOD',
      'src/components/sar/SearchPlanWorksheet.tsx',
    ],
    inputSchema: schema({
      facility: f('string', "'merchant-vessel'|'fixed-wing-aircraft'|'helicopter'|'small-vessel'|'lifeboat'"),
      object: f('string', 'Kategori objek (8 kategori)'),
      visibility: f('number', 'Visibilitas', { unit: 'NM' }),
      windSpeed: f('number', 'Kecepatan angin', { unit: 'kts' }),
      facilities: f('array', 'Fasilitas SRU {id, name, speed, endurance, daylightHours, W}'),
      datumType: f('string', "'point' | 'leeway-divergence' | 'line'"),
      E: f('number', 'Total error (dari ws1-datum)', { unit: 'NM' }),
      L: f('number', 'Panjang datum line (untuk type line)', { unit: 'NM' }),
      DD: f('number', 'Divergensi datum (untuk SR)', { unit: 'NM' }),
      previousZr: f('number', 'Zr kumulatif pencarian sebelumnya'),
      searchNumber: f('number', 'Urutan pencarian dari kasus: pencarian pertama → 1, kedua → 2, dst.; bila tidak dikirim dipakai 1'),
    }, ['facility', 'object', 'visibility', 'windSpeed', 'facilities', 'datumType', 'E']),
    outputSchema: schema({
      perFacility: f('array', 'Effort per fasilitas {T, Z}'),
      Zta: f('number', 'Total search effort'),
      fs: f('number', 'Faktor keselamatan dari figure N-5..N-8'),
      Ro: f('number', 'Radius pencarian', { unit: 'NM' }),
      Ao: f('number', 'Luas area hasil alokasi', { unit: 'NM²' }),
      C: f('number', 'Coverage factor'), POD: f('number', 'POD fraksi 0–1 (polinomial Excel POD.xls pada kurva Figure I-12, sesuai searchNumber)'),
    }),
    validateInput: (input) => {
      const i = input as { facilities?: unknown[]; E?: number };
      if (!Array.isArray(i.facilities) || i.facilities.length === 0) return err('Daftar fasilitas SRU kosong.');
      if (!num(i.E) || i.E <= 0) return err('E dari worksheet Datum harus > 0 NM.');
      return ok();
    },
    execute: (input) => {
      const i = input as {
        facility: SearchFacilityType; object: SearchObjectCategory; visibility: number; windSpeed: number;
        altitudeFt?: number; facilities: Array<{ id: string; name: string; speed: number; endurance: number; daylightHours: number; W: number }>;
        datumType: DatumType; E: number; L?: number; DD?: number; previousZr?: number; searchNumber?: number;
      };
      const sw = computeSweepWidth({ facility: i.facility, object: i.object, visibility: i.visibility, windSpeed: i.windSpeed, altitudeFt: i.altitudeFt });
      const effort = computeTotalSearchEffort(i.facilities);
      const alloc = computeEffortAllocation({
        type: i.datumType, E: i.E, Zta: effort.Zta, L: i.L, DD: i.DD, previousZr: i.previousZr,
      });
      const POD = computePOD(alloc.C, (i.searchNumber ?? 1) as SearchNumber);
      return { sweepWidth: sw, ...effort, ...alloc, POD };
    },
    requiresConfirmation: false,
    dependencies: ['ws1-datum'],
    notes: 'Audit: semua fasilitas dipaksa memakai W yang sama di komponen; datum line memakai divergensi sebagai proxy L.',
  },

  // ------------------------------------------------------------------
  // BASIC_CALCULATION (G)
  // ------------------------------------------------------------------
  {
    id: 'calc-svt',
    name: 'Penghitungan dasar S·V·T',
    category: 'BASIC_CALCULATION',
    description: 'Solver S = V×T: isi satu dari {jarak, kecepatan, waktu} dari dua yang diketahui.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/basicCalculations.ts#solveSvt'],
    inputSchema: schema({ s: f('number', 'Jarak (NM)'), v: f('number', 'Kecepatan (kts)'), t: f('number', 'Waktu (h)') }, []),
    outputSchema: schema({ s: f('number', 'Jarak'), v: f('number', 'Kecepatan'), t: f('number', 'Waktu') }),
    validateInput: (input) => {
      const i = input as { s?: number; v?: number; t?: number };
      const filled = [i.s, i.v, i.t].filter(num).length;
      if (filled < 2) return err('Isi minimal dua dari S, V, T.');
      return ok();
    },
    execute: (input) => solveSvt(input as Parameters<typeof solveSvt>[0]),
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'calc-area-solver',
    name: 'Penghitungan dasar Area A = T×V×S + jumlah pencari',
    category: 'BASIC_CALCULATION',
    description: 'Solver A = T×V×S, jumlah pencari n = A/(T×V×S), dan persentase area tersapu.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/basicCalculations.ts#solveArea', 'src/lib/sar/basicCalculations.ts#calcSearchers', 'src/lib/sar/basicCalculations.ts#sweptPercentage'],
    inputSchema: schema({ a: f('number', 'Luas (NM²)'), t: f('number', 'Waktu (h)'), v: f('number', 'Kecepatan (kts)'), s: f('number', 'Track spacing (NM)') }, []),
    outputSchema: schema({ a: f('number', 'Luas'), searchers: f('number', 'Jumlah pencari'), sweptPercent: f('number', 'Persentase tersapu') }),
    validateInput: (input) => {
      const i = input as { a?: number; t?: number; v?: number; s?: number };
      const filled = [i.a, i.t, i.v, i.s].filter(num).length;
      if (filled < 3) return err('Isi minimal tiga dari A, T, V, S.');
      return ok();
    },
    execute: (input) => {
      const i = input as { a?: number; t?: number; v?: number; s?: number };
      const solved = solveArea(i as Parameters<typeof solveArea>[0]);
      const searchers = num(i.a) && num(i.t) && num(i.v) && num(i.s) ? calcSearchers(i.a, i.t, i.v, i.s) : null;
      return { ...solved, searchers };
    },
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'calc-duration-format',
    name: 'Konversi waktu desimal ↔ HMS + format durasi',
    category: 'BASIC_CALCULATION',
    description: 'decimalHoursToHms / hmsToDecimalHours / formatDuration (jam-menit-detik, hari bila ≥24 h).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/basicCalculations.ts#decimalHoursToHms', 'src/lib/sar/basicCalculations.ts#hmsToDecimalHours', 'src/lib/sar/basicCalculations.ts#formatDuration'],
    inputSchema: schema({
      hours: f('number', 'Jam desimal → HMS'),
      hms: f('object', '{h, m, s} → jam desimal'),
    }, []),
    outputSchema: schema({ hms: f('object', '{h, m, s}'), hours: f('number', 'Jam desimal'), label: f('string', 'Durasi terformat') }),
    execute: (input) => {
      const i = input as { hours?: number; hms?: { h: number; m: number; s: number } };
      if (num(i.hours)) return { hms: decimalHoursToHms(i.hours), label: formatDuration(i.hours) };
      if (i.hms && num(i.hms.h) && num(i.hms.m) && num(i.hms.s)) {
        const hours = hmsToDecimalHours(i.hms.h, i.hms.m, i.hms.s);
        return { hours, label: formatDuration(hours) };
      }
      return { valid: false, message: 'Sediakan hours ATAU hms.' };
    },
    requiresConfirmation: false,
    dependencies: [],
  },

  // ------------------------------------------------------------------
  // UNIT_CONVERSION (G)
  // ------------------------------------------------------------------
  {
    id: 'conv-distance',
    name: 'Konversi satuan jarak',
    category: 'UNIT_CONVERSION',
    description: 'km/m/cm/nm/inch/ft/yd/mil via meter (1 NM = 1852 m). Mengembalikan hasil di semua satuan.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/basicCalculations.ts#convertDistance'],
    inputSchema: schema({ value: f('number', 'Nilai'), from: f('string', "Satuan asal: 'km'|'m'|'cm'|'nm'|'inch'|'ft'|'yd'|'mil'") }, ['value', 'from']),
    outputSchema: schema({ results: f('object', 'Nilai dalam semua satuan DistanceUnit') }),
    validateInput: (input) => {
      const i = input as { value?: number; from?: DistanceUnit };
      if (!num(i.value)) return err('Nilai harus angka.');
      if (!(i.from && i.from in ({ km: 1, m: 1, cm: 1, nm: 1, inch: 1, ft: 1, yd: 1, mil: 1 }))) return err('Satuan tidak dikenal.');
      return ok();
    },
    execute: (input) => {
      const i = input as { value: number; from: DistanceUnit };
      return { from: i.from, value: i.value, results: convertDistance(i.value, i.from) };
    },
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'conv-speed',
    name: 'Konversi satuan kecepatan',
    category: 'UNIT_CONVERSION',
    description: 'kts/kmh/ms/cms via knot (1 kts = 1.852 km/h; ms→kts = 100/51.4444).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/basicCalculations.ts#convertSpeed', 'src/lib/sar/basicCalculations.ts#convertMeterPerSecond', 'src/lib/sar/basicCalculations.ts#convertCmPerSecond'],
    inputSchema: schema({ value: f('number', 'Nilai'), from: f('string', "'kts'|'kmh'|'ms'|'cms'") }, ['value', 'from']),
    outputSchema: schema({ results: f('object', 'Nilai dalam semua satuan SpeedUnit') }),
    validateInput: (input) => {
      const i = input as { value?: number; from?: SpeedUnit };
      if (!num(i.value)) return err('Nilai harus angka.');
      if (!(i.from && i.from in ({ kts: 1, kmh: 1, ms: 1, cms: 1 }))) return err('Satuan tidak dikenal.');
      return ok();
    },
    execute: (input) => {
      const i = input as { value: number; from: SpeedUnit };
      return { from: i.from, value: i.value, results: convertSpeed(i.value, i.from) };
    },
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'conv-timezone',
    name: 'Konversi zona waktu WIB/WITA/WIT/UTC',
    category: 'UNIT_CONVERSION',
    description: 'UTC ↔ zona Indonesia. Konvensi soal yang berlaku: G = UTC+7, H = UTC+8, I = UTC+9, Z = UTC. Membungkus 24 h dengan dayShift.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/basicCalculations.ts#convertTimezone'],
    inputSchema: schema({
      hour: f('number', 'Jam dalam desimal (0–24) atau {h, m}'),
      minute: f('number', 'Menit'),
      from: f('string', "'UTC'|'WIB'|'WITA'|'WIT'"),
    }, ['hour', 'from']),
    outputSchema: schema({ results: f('object', 'Jam pada tiap zona {hhmm, dayShift, letter}') }),
    validateInput: (input) => {
      const i = input as { hour?: number; from?: TzZone };
      if (!num(i.hour) || i.hour < 0 || i.hour >= 25) return err('Jam harus 0–24.');
      if (!['UTC', 'WIB', 'WITA', 'WIT'].includes(i.from as string)) return err('Zona tidak dikenal.');
      return ok();
    },
    execute: (input) => {
      const i = input as { hour: number; minute?: number; from: TzZone };
      const h = i.hour + (num(i.minute) ? i.minute / 60 : 0);
      return { from: i.from, results: convertTimezone(h, i.from) };
    },
    requiresConfirmation: false,
    dependencies: ['conv-dtg'],
    notes: 'Aturan zona tidak boleh diganti dengan asumsi baru (kebijakan sistem).',
  },
  {
    id: 'conv-dtg',
    name: 'Parser & konversi DTG/TW',
    category: 'UNIT_CONVERSION',
    description: 'Parsir format Basarnas TW (MMDD HHMM zona, mis. "TW 1117 1900 G") dan NATO DTG ("171847G NOV 2026"); konversi ke 4 zona, ISO, format kanonik.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/dtg.mjs#parseDtg', 'src/lib/sar/dtg.mjs#dtgToZones', 'src/lib/sar/dtg.mjs#dtgToIso', 'src/lib/sar/dtg.mjs#formatDtg'],
    inputSchema: schema({ dtg: f('string', 'String TW/DTG'), year: f('number', 'Tahun default bila DTG tanpa tahun') }, ['dtg']),
    outputSchema: schema({ parsed: f('object', 'Hasil parse {kind, zone, ...}'), zones: f('object', 'Waktu pada 4 zona'), iso: f('string', 'ISO 8601'), formatted: f('string', 'Format DTG kanonik') }),
    validateInput: (input) => (str((input as { dtg?: string }).dtg) ? ok() : err('String DTG/TW kosong.')),
    execute: (input) => {
      const i = input as { dtg: string; year?: number };
      const parsed = parseDtg(i.dtg);
      return {
        parsed,
        zones: parsed ? dtgToZones(parsed, num(i.year) ? i.year : undefined) : null,
        iso: parsed ? dtgToIso(parsed) : null,
        formatted: parsed ? formatDtg(parsed) : null,
      };
    },
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'conv-coordinate-format',
    name: 'Konversi format koordinat (DMS ↔ desimal)',
    category: 'UNIT_CONVERSION',
    description: 'parseCoordinate (D/DM/DMS, hemisfer, koma desimal) dan formatDMS/formatDegMinSec untuk label chart.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/coordFormat.ts#parseCoordinate', 'src/lib/sar/coordFormat.ts#formatDMS'],
    inputSchema: schema({
      input: f('string', 'Koordinat teks, mis. "4°03\'00\\"S" atau "-4.05"'),
      axis: f('string', "'lat' | 'lng'"),
      toFormat: f('string', "'decimal' | 'dms'"),
    }, ['input', 'axis']),
    outputSchema: schema({ decimal: f('number', 'Derajat desimal (S/B negatif)'), dms: f('string', 'Label DMS') }),
    validateInput: (input) => {
      const i = input as { input?: string; axis?: string };
      if (!str(i.input)) return err('Input koordinat kosong.');
      if (!['lat', 'lng'].includes(i.axis as string)) return err('Axis harus lat atau lng.');
      return ok();
    },
    execute: (input) => {
      const i = input as { input: string; axis: 'lat' | 'lng' };
      const decimal = parseCoordinate(i.input, i.axis);
      if (decimal === null) return { valid: false, message: 'Format koordinat tidak dikenali.' };
      return { decimal, dms: formatDMS(decimal, i.axis === 'lng') };
    },
    requiresConfirmation: false,
    dependencies: [],
  },

  // ------------------------------------------------------------------
  // MAP_OPERATION (E)
  // ------------------------------------------------------------------
  {
    id: 'map-sea-render',
    name: 'Peta Laut — render fitur (marker/garis/poligon/lingkaran)',
    category: 'MAP_OPERATION',
    description: 'Peta laut utama (Leaflet 1.9.4, WGS84/Web Mercator, tile OSM + OpenSeaMap seamark; mode ONC pakai tile Esri). Fitur dirender dari props state aplikasi.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/SeaMap.tsx', 'src/components/sar/SeaMapMount.tsx'],
    inputSchema: schema({
      features: f('array', 'MapMarker/MapLine/MapPolygon/MapCircle (lat/lng WGS84, radius NM untuk lingkaran)'),
    }, []),
    outputSchema: schema({ render: f('string', 'Tampilan peta dengan layer markers/lines/polygons/circles') }),
    requiresConfirmation: true,
    preview: (input) => {
      const i = input as { features?: unknown };
      const feats = Array.isArray(i.features) ? i.features : [];
      const counts: Record<string, number> = {};
      const mapped: MapPreviewFeature[] = [];
      for (const ft of feats) {
        const o = (ft ?? {}) as Record<string, unknown>;
        const kind = str(o.kind) ? (o.kind as MapPreviewFeature['kind']) : 'marker';
        counts[kind] = (counts[kind] ?? 0) + 1;
        if (mapped.length < 12) {
          mapped.push({
            kind,
            label: str(o.label) ? (o.label as string) : str(o.id) ? String(o.id) : undefined,
            coord: latLngOk(o) ? { lat: o.lat as number, lng: o.lng as number } : undefined,
            radiusNm: num(o.radiusNm) ? o.radiusNm as number : undefined,
          });
        }
      }
      const summary = feats.length === 0
        ? 'Tidak ada fitur untuk dirender (peta tetap seperti sekarang).'
        : `Merender ${feats.length} fitur ke Peta Laut (${Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ')}).`;
      return mapPreview('map-sea-render', summary, 'sea-map', mapped);
    },
    dependencies: [],
    notes: 'PHASE 4: preview() menyediakan kontrak seragam — AI yang menambah fitur WAJIB preview + konfirmasi pengguna. Tanpa konversi datum (mengasumsikan WGS84); garis Mercator rhumb, bukan geodesik.',
  },
  {
    id: 'map-sea-lkp-pick',
    name: 'Peta Laut — pilih LKP / drop point / measure',
    category: 'MAP_OPERATION',
    description: 'Mode interaksi peta laut: klik untuk LKP atau titik SRU/base, mode ukur jarak polyline (NM/km), double-click untuk hapus ukuran.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/SeaMap.tsx#handleMapClick', 'src/app/page.tsx#pickMode'],
    inputSchema: schema({ mode: f('string', "'lkp' | 'base' | 'drop' | 'measure'") }, ['mode']),
    outputSchema: schema({ lat: f('number', 'Lintang WGS84'), lng: f('number', 'Bujur WGS84') }),
    requiresConfirmation: false,
    dependencies: ['map-sea-render'],
    notes: 'Aksi pengguna langsung di peta — AI hanya bisa meminta pengguna memilih, tidak boleh mengarang koordinat.',
  },
  {
    id: 'map-sea-edit',
    name: 'Peta Laut — pengeditan fitur di peta',
    category: 'MAP_OPERATION',
    description: 'Edit fitur terplot langsung di peta (drag vertex, hapus feature, rename layer).',
    version: '1.0.0',
    status: 'unavailable',
    executionMode: 'none',
    implementation: [],
    inputSchema: schema({ featureId: f('string', 'ID fitur') }, ['featureId']),
    outputSchema: schema({}),
    requiresConfirmation: true,
    dependencies: ['map-sea-render'],
    notes: 'Belum ada di sistem: fitur dirender ulang dari state aplikasi; perubahan dilakukan lewat worksheet/form, bukan di peta. TIDAK dibuatkan workflow baru.',
  },
  {
    id: 'map-sea-depth-overlay',
    name: 'Peta Laut — overlay kedalaman (BATNAS/GEBCO)',
    category: 'MAP_OPERATION',
    description: 'Angka kedalaman: sumber COG BATNAS (~180 m) → GEBCO (~450 m) → proxy /api/depth (opentopodata GEBCO 2020, elevasi meter, negatif di bawah laut).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'route',
    implementation: ['src/lib/sar/depthSources.ts', 'src/lib/sar/depthLabels.ts', 'src/app/api/depth/route.ts'],
    inputSchema: schema({
      locs: f('array', 'Daftar {lat, lng} (maks 100 per request proxy)'),
      gridInterval: f('string', "Interval label: '1d'|'30m'|'15m'|'10m'|'5m'|'1m'|'30s'|'15s'"),
    }, ['locs']),
    outputSchema: schema({ elevationM: f('number', 'Elevasi meter (negatif = di bawah permukaan)') }),
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'map-onc-graticule',
    name: 'Peta ONC — graticule & tick',
    category: 'MAP_OPERATION',
    description: 'Grid GeoJSON ONC: garis mayor 1° / minor 30′, tick 1′/5′/10′, label derajat; interval tick adaptif terhadap zoom.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/oncGraticule.ts#buildOncGraticule'],
    inputSchema: schema({ bounds: f('object', 'Batas viewport'), widthPx: f('number', 'Lebar px'), heightPx: f('number', 'Tinggi px'), zoom: f('number', 'Zoom') }, []),
    outputSchema: schema({ geojson: f('object', 'GeoJSON grid + label') }),
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'map-onc-mef',
    name: 'Peta ONC — MEF (Maximum Elevation Figure)',
    category: 'MAP_OPERATION',
    description: 'MEF kaki dibulatkan ke atas ke ratusan (calculateMefFeet) dari data DEM statis /data/mef_{60|30|15}min.geojson.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/oncMef.mjs#calculateMefFeet', 'src/lib/sar/oncMef.mjs#deriveMefFromMeters'],
    inputSchema: schema({ maxElevationFeet: f('number', 'Elevasi maksimum (ft)'), maxElevationMeters: f('number', 'Alternatif input meter') }, []),
    outputSchema: schema({ mefFeet: f('number', 'MEF (ft, ceil ke ratusan)'), label: f('string', 'Label besar + superscript') }),
    execute: (input) => {
      const i = input as { maxElevationFeet?: number };
      if (!num(i.maxElevationFeet) || i.maxElevationFeet < 0) return { valid: false, message: 'Elevasi harus angka ≥ 0.' };
      return { mefFeet: calculateMefFeet(i.maxElevationFeet) };
    },
    requiresConfirmation: false,
    dependencies: [],
    notes: 'MEF dari DEM — label "bukan official" tampil di UI.',
  },
  {
    id: 'map-ws4-plot',
    name: 'Peta ONC — plotting Worksheet 4 (rute, radius, trapesium)',
    category: 'MAP_OPERATION',
    description: 'Peta MapLibre khusus Worksheet 4: marker rute, garis leg, lingkaran radius, poligon trapesium, graticule ONC, layer openaip airports (proxy tile).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/worksheets/Worksheet4MapLibre.tsx', 'src/app/api/tiles/openaip/[z]/[x]/[y]/route.ts'],
    inputSchema: schema({
      markers: f('array', 'Titik rute WGS84'), circles: f('array', 'Radius per titik (NM)'),
      polygons: f('array', 'Trapesium per leg'),
    }, []),
    outputSchema: schema({ render: f('string', 'Peta ONC Worksheet 4') }),
    requiresConfirmation: true,
    preview: (input) => {
      const i = input as { markers?: unknown; circles?: unknown; polygons?: unknown };
      const markers = Array.isArray(i.markers) ? i.markers.length : 0;
      const circles = Array.isArray(i.circles) ? i.circles.length : 0;
      const polygons = Array.isArray(i.polygons) ? i.polygons.length : 0;
      const parts: string[] = [];
      if (markers) parts.push(`${markers} marker rute`);
      if (circles) parts.push(`${circles} lingkaran radius`);
      if (polygons) parts.push(`${polygons} trapesium leg`);
      return mapPreview(
        'map-ws4-plot',
        parts.length ? `Merender ke peta ONC Worksheet 4: ${parts.join(', ')}.` : 'Merender peta ONC Worksheet 4 tanpa fitur tambahan.',
        'onc-map',
        [],
        { warnings: ['Koordinat MapLibre ONC berbeda sistem dari Peta Laut (raster scan Esri).'] },
      );
    },
    dependencies: ['ws4-land-radius', 'map-onc-graticule'],
    notes: 'PHASE 4: preview() tersedia (kontrak seragam) — konfirmasi pengguna wajib sebelum render. Sistem koordinat berbeda dari Peta Laut: MapLibre + raster ONC Esri/scan (env NEXT_PUBLIC_ONC_SCAN_TILE_URL).',
  },
  {
    id: 'map-ups-plot',
    name: 'UPS Plotter — sheet plotting VP-OS',
    category: 'MAP_OPERATION',
    description: 'Universal plotting sheet: chain vektor ADW (insiden→glide→angin→landing), track LKP→datum L/R, kotak search area, leg manual bearing/jarak (Vincenty WGS-84).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/UPSPlotter.tsx', 'src/lib/sar/upsGrid.ts#latLonToUPS', 'src/lib/sar/upsGeodesic.ts#upsDirect', 'src/lib/sar/upsGeodesic.ts#upsInverse'],
    inputSchema: schema({
      aeroResults: f('object', 'Hasil env-adw (vektor + posisi)'),
      datumResults: f('object', 'Datum L/R dari ws1-datum'),
      manualLegs: f('array', 'Leg {bearingDeg, distanceNm} dari titik asal'),
    }, []),
    outputSchema: schema({ plot: f('string', 'Gambar SVG di sheet VP-OS + daftar titik DMS') }),
    requiresConfirmation: false,
    preview: (input) => {
      const i = input as { aeroResults?: unknown; datumResults?: unknown; manualLegs?: unknown };
      const legs = Array.isArray(i.manualLegs) ? i.manualLegs.length : 0;
      const hasAero = i.aeroResults !== undefined && i.aeroResults !== null;
      const hasDatum = i.datumResults !== undefined && i.datumResults !== null;
      const parts: string[] = [];
      if (hasAero) parts.push('rantai vektor ADW (insiden→glide→angin→landing)');
      if (hasDatum) parts.push('track LKP→datum L/R + kotak search area');
      if (legs) parts.push(`${legs} leg manual`);
      return {
        operation: 'map-ups-plot',
        summary: parts.length ? `Merender sheet VP-OS: ${parts.join(', ')}.` : 'Merender sheet VP-OS kosong (tanpa data chain).',
        target: 'ups-plotter' as const,
        features: [],
        requiresUserConfirmation: false,
        reversible: true,
        warnings: ['Proyeksi layar equirectangular lokal — posisi relatif perkiraan (belum polar stereografik).'],
      };
    },
    dependencies: ['env-adw', 'ws1-datum'],
    notes: 'PHASE 4: preview() tersedia; plotting deterministik dari hasil worksheet sehingga konfirmasi tidak wajib. Audit: proyeksi layar = equirectangular lokal (bukan polar stereografik); grid citra sheet belum terkalibrasi — posisi relatif perkiraan.',
  },
  {
    id: 'map-sea-print-export',
    name: 'Ekspor peta/dokumen (print A3 & companion)',
    category: 'MAP_OPERATION',
    description: 'PrintMapA3 (landscape A3 via CSS @page, checklist overlay) + PrintCompanionMap per tab; window.print().',
    version: '1.0.0',
    status: 'partial',
    executionMode: 'component',
    implementation: ['src/components/sar/PrintMapA3.tsx', 'src/components/sar/PrintCompanionMap.tsx'],
    inputSchema: schema({ overlays: f('array', 'Checklist overlay: lkp/twc/drift/datum/errorCircle/searchArea/searchPattern/transit') }, []),
    outputSchema: schema({ print: f('string', 'Halaman cetak browser') }),
    requiresConfirmation: false,
    dependencies: ['map-sea-render'],
    notes: 'Status partial: hanya print browser — belum ada ekspor berkas PNG/PDF.',
  },

  // ------------------------------------------------------------------
  // SEARCH_PATTERN (C)
  // ------------------------------------------------------------------
  {
    id: 'pattern-generate',
    name: 'Pembangkitan Search Pattern (PS/CS/SS/VS/TS)',
    category: 'SEARCH_PATTERN',
    description: 'Koordinat pola pencarian: parallel track, creeping line, expanding square, sector, track line return — CSP, exit point, waypoints, segmen, total jarak, estimasi jam.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/searchPatterns.ts#generateSearchPattern'],
    inputSchema: schema({
      type: f('string', "'PS'|'CS'|'SS'|'VS'|'TS'"),
      center: f('object', 'Titik pusat {lat, lng}'),
      lengthNm: f('number', 'Dimensi sumbu mayor', { unit: 'NM' }),
      widthNm: f('number', 'Dimensi tegak lurus', { unit: 'NM' }),
      orientationDeg: f('number', 'Orientasi sumbu mayor (°T)'),
      trackSpacingNm: f('number', 'S dari WS2/WS3/WS8', { unit: 'NM' }),
      turnDirection: f('string', "'right' | 'left' (SS/VS)"),
      sectorAngleDeg: f('number', 'Sudut sektor (VS)'), sectorLegLengthNm: f('number', 'Panjang leg (VS)'), sectorLegCount: f('number', 'Jumlah leg (VS)'),
      trackLineLengthNm: f('number', 'Panjang track line (TS)'), tsReturnOffsetNm: f('number', 'Offset return (TS)'),
      sruSpeedKts: f('number', 'Kecepatan SRU (default 15)', { unit: 'kts' }),
    }, ['type', 'center', 'orientationDeg', 'trackSpacingNm']),
    outputSchema: schema({
      csp: f('object', 'Commence Search Point {lat, lng}'),
      exitPoint: f('object', 'Exit point {lat, lng}'),
      waypoints: f('array', 'Urutan titik belok'),
      segments: f('array', 'Leg {from, to, legIndex, distanceNm}'),
      totalDistanceNm: f('number', 'Total jarak', { unit: 'NM' }),
      estimatedHours: f('number', 'Estimasi waktu', { unit: 'h' }),
    }),
    validateInput: (input) => {
      const i = input as SearchPatternParams;
      if (!['PS', 'CS', 'SS', 'VS', 'TS'].includes(i.type)) return err('Tipe pola tidak dikenal.');
      if (!latLngOk(i.center)) return err('Titik pusat tidak valid.');
      if (!num(i.trackSpacingNm) || i.trackSpacingNm <= 0) return err('Track spacing S harus > 0 NM untuk PS/CS/SS.');
      return ok();
    },
    execute: (input) => generateSearchPattern(input as SearchPatternParams, (input as { sruSpeedKts?: number }).sruSpeedKts ?? 15),
    requiresConfirmation: false,
    dependencies: ['ws1-search-area', 'ws2-maritime-wsc-pod', 'ws3-land-wsc-pod', 'ws8-vessel-wsc-pod'],
    notes: 'S dipilih dari worksheet sesuai platform SRU (patternWorksheetSource di page.tsx); pola diklip ke persegi search area.',
  },
  {
    id: 'pattern-clip-square',
    name: 'Klip pola ke persegi search area',
    category: 'SEARCH_PATTERN',
    description: 'clipSearchPatternToSquare: memotong tiap leg ke poligon persegi terorientasi, menghitung ulang CSP/exit/total jarak.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/searchPatterns.ts#clipSearchPatternToSquare'],
    inputSchema: schema({
      pattern: f('object', 'Hasil pattern-generate'),
      center: f('object', 'Pusat persegi {lat, lng}'),
      sideNm: f('number', 'Sisi persegi (√Ao)', { unit: 'NM' }),
      areaOrientationDeg: f('number', 'Orientasi persegi (°T)'),
    }, ['pattern', 'center', 'sideNm', 'areaOrientationDeg']),
    outputSchema: schema({ pattern: f('object', 'SearchPatternResult terklip') }),
    execute: (input) => {
      const i = input as { pattern: SearchPatternResult; center: LatLng; sideNm: number; areaOrientationDeg: number };
      return clipSearchPatternToSquare(i.pattern, i.center, i.sideNm, i.areaOrientationDeg);
    },
    requiresConfirmation: false,
    dependencies: ['pattern-generate'],
  },
  {
    id: 'pattern-plot-seamap',
    name: 'Plot pola pencarian di Peta Laut',
    category: 'SEARCH_PATTERN',
    description: 'Render segmen pola (warna per tipe), connector CSP/exit, label per leg (bearing, panjang, nS, sumber S) pada SeaMap + PrintCompanionMap.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/app/page.tsx#searchPatternResult', 'src/app/page.tsx#lines', 'src/components/sar/SeaMap.tsx'],
    inputSchema: schema({ pattern: f('object', 'Hasil pattern-generate terklip') }, ['pattern']),
    outputSchema: schema({ render: f('string', 'Layer garis pola di Peta Laut') }),
    requiresConfirmation: true,
    dependencies: ['pattern-generate', 'pattern-clip-square', 'map-sea-render'],
    notes: 'Menulis layer peta — AI WAJIB preview + konfirmasi pengguna sebelum menyimpan. Penyimpanan: state aplikasi (buildState → SarCase), bukan DB geometri.',
  },
  {
    id: 'pattern-action-plan',
    name: 'Search Action Plan (format App. L-23)',
    category: 'SEARCH_PATTERN',
    description: 'renderSearchActionPlanText / buildSearchActionPlanData: pesan rencana pencarian tekstual dengan sudut persegi via rectangleCorners.',
    version: '1.0.0',
    status: 'partial',
    executionMode: 'lib',
    implementation: ['src/lib/sar/searchActionPlan.ts#renderSearchActionPlanText', 'src/lib/sar/searchActionPlan.ts#buildSearchActionPlanData'],
    inputSchema: schema({ data: f('object', 'Data rencana (SAR action plan fields)') }, ['data']),
    outputSchema: schema({ text: f('string', 'Pesan APP L-23') }),
    requiresConfirmation: false,
    dependencies: ['pattern-generate'],
    notes: 'Status partial: pola di-hardcode "PS" dan CSP = LKP (keterbatasan audit) — belum mengikuti pola terpilih.',
  },

  // ------------------------------------------------------------------
  // ASSET_ALLOCATION (D)
  // ------------------------------------------------------------------
  {
    id: 'asset-allocate',
    name: 'Alokasi Aset SRU + coverage vs Ao',
    category: 'ASSET_ALLOCATION',
    description: 'Alokasi armada SRU vs target area (1 alut = 1 lembar di UI): ΣA per aset, coverage = ΣA/Ao, defisit, rekomendasi, kombinasi subset brute-force (≤12 aset). Klasifikasi alut udara/laut mengikuti type (fixed-wing-aircraft/helicopter = udara); homeBasePos dari koordinat soal atau resolusi nama bandara/dermaga pada peta ONC oleh AI asisten (set_asset_allocation_case).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/assetAllocation.ts#calculateAssetAllocationSummary'],
    inputSchema: schema({
      assets: f('array', 'SruAssetInput {id, name, type (klasifikasi udara/laut), homeBaseName, homeBasePos (dari soal atau ONC), transitSpeedKts, searchSpeedKts, enduranceHours, sweepWidthNm, airEngineType?, tafCondition?, maritimeTsfMins?}'),
      csp: f('object', 'CSP {lat, lng} — dari pattern-generate'),
      exitPoint: f('object', 'Exit point {lat, lng}'),
      requiredAreaAoNm2: f('number', 'Ao target', { unit: 'NM²' }),
    }, ['assets', 'csp', 'exitPoint', 'requiredAreaAoNm2']),
    outputSchema: schema({
      perAsset: f('array', 'Hasil per aset (transit, OSE, EST, sweep area)'),
      coverageRatio: f('number', 'ΣA/Ao'), isSufficient: f('boolean', 'Cukup?'),
      deficitAreaNm2: f('number', 'Kekurangan', { unit: 'NM²' }),
      recommendation: f('string', 'Rekomendasi teks'),
      combinations: f('array', 'Kombinasi subset yang memenuhi'),
    }),
    validateInput: (input) => {
      const i = input as { assets?: unknown[]; requiredAreaAoNm2?: number };
      if (!Array.isArray(i.assets) || i.assets.length === 0) return err('Daftar aset kosong.');
      if (!num(i.requiredAreaAoNm2) || (i.requiredAreaAoNm2 as number) <= 0) return err('Ao harus > 0 NM².');
      return ok();
    },
    execute: (input) => {
      const i = input as { assets: SruAssetInput[]; csp: LatLng; exitPoint: LatLng; requiredAreaAoNm2: number };
      return calculateAssetAllocationSummary(i.assets, i.csp, i.exitPoint, i.requiredAreaAoNm2);
    },
    requiresConfirmation: false,
    dependencies: ['pattern-generate', 'ws1-search-area'],
    notes: 'Rumus alokasi = implementasi existing (calculateSruAsset), bukan asumsi baru. Jarak great-circle sphere R=3440.065 NM. Worksheet Alokasi Aset menampilkan 1 lembar per alut (WorksheetSheetBar); pangkalan 0,0 (belum ada posisi) tidak diplot ke peta.',
  },
  {
    id: 'asset-est-maritime',
    name: 'EST Sheet Maritim per SRU (OSE/EST)',
    category: 'ASSET_ALLOCATION',
    description: 'OSE = endurance − TSF (instruksi menit); EST = 0.85 × OSE; A = EST × V_search × S.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/worksheets/AuthenticESTMaritimeWorksheet.tsx'],
    inputSchema: schema({ asset: f('object', 'Data aset + maritimeTsfMins'), csp: f('object', 'CSP'), exitPoint: f('object', 'Exit point') }, []),
    outputSchema: schema({ OSE: f('number', 'On-scene endurance', { unit: 'min' }), EST: f('number', 'Effective search time', { unit: 'h' }), A: f('number', 'Luas sapuan', { unit: 'NM²' }) }),
    requiresConfirmation: false,
    dependencies: ['asset-allocate', 'pattern-generate'],
  },
  {
    id: 'asset-est-air',
    name: 'EST Sheet Udara per SRU (TSF variabel + reserve + TAF)',
    category: 'ASSET_ALLOCATION',
    description: 'TSF udara = transit×(piston 15%/turbine 10%) + reserve (45/30 menit) + TAF (cerah 0/inter 30/tempo 60); EST = 0.85 × OSE; A = EST × V × S.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/worksheets/AuthenticESTAirWorksheet.tsx'],
    inputSchema: schema({ asset: f('object', 'Data aset + airEngineType + tafCondition'), csp: f('object', 'CSP'), exitPoint: f('object', 'Exit point') }, []),
    outputSchema: schema({ TSF: f('number', 'Total serviceable fuel', { unit: 'min' }), OSE: f('number', 'OSE', { unit: 'min' }), EST: f('number', 'EST', { unit: 'h' }), A: f('number', 'Luas sapuan', { unit: 'NM²' }) }),
    requiresConfirmation: false,
    dependencies: ['asset-allocate', 'pattern-generate'],
  },

  // ------------------------------------------------------------------
  // TRANSIT_CALCULATION (D)
  // ------------------------------------------------------------------
  {
    id: 'transit-go',
    name: 'Transit Go (base → CSP)',
    category: 'TRANSIT_CALCULATION',
    description: 'Jarak great-circle base→CSP dan waktu = jarak / kecepatan transit (implementasi calculateSruAsset).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/assetAllocation.ts#calculateSruAsset', 'src/lib/sar/sarCalculations.ts#distanceNm'],
    inputSchema: schema({
      from: f('object', 'Posisi base {lat, lng}'),
      to: f('object', 'Posisi tujuan (CSP) {lat, lng}'),
      transitSpeedKts: f('number', 'Kecepatan transit', { unit: 'kts' }),
    }, ['from', 'to', 'transitSpeedKts']),
    outputSchema: schema({ distanceNm: f('number', 'Jarak', { unit: 'NM' }), hours: f('number', 'Waktu', { unit: 'h' }) }),
    validateInput: (input) => {
      const i = input as { from?: LatLng; to?: LatLng; transitSpeedKts?: number };
      if (!latLngOk(i.from) || !latLngOk(i.to)) return err('Koordinat base/tujuan tidak valid.');
      if (!num(i.transitSpeedKts) || (i.transitSpeedKts as number) <= 0) return err('Kecepatan transit harus > 0 kts.');
      return ok();
    },
    execute: (input) => {
      const i = input as { from: LatLng; to: LatLng; transitSpeedKts: number };
      const d = distanceNm(i.from, i.to);
      return { distanceNm: d, hours: d / i.transitSpeedKts };
    },
    requiresConfirmation: false,
    dependencies: ['asset-allocate'],
    notes: 'Hasil kumulatif per aset tersedia di asset-allocate.perAsset.transitGo*.',
  },
  {
    id: 'transit-back',
    name: 'Transit Back (exit point → base)',
    category: 'TRANSIT_CALCULATION',
    description: 'Jarak exit point→base dan waktu = jarak / kecepatan transit (implementasi calculateSruAsset).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/assetAllocation.ts#calculateSruAsset', 'src/lib/sar/sarCalculations.ts#distanceNm'],
    inputSchema: schema({
      from: f('object', 'Exit point {lat, lng}'),
      to: f('object', 'Posisi base {lat, lng}'),
      transitSpeedKts: f('number', 'Kecepatan transit', { unit: 'kts' }),
    }, ['from', 'to', 'transitSpeedKts']),
    outputSchema: schema({ distanceNm: f('number', 'Jarak', { unit: 'NM' }), hours: f('number', 'Waktu', { unit: 'h' }) }),
    validateInput: (input) => {
      const i = input as { from?: LatLng; to?: LatLng; transitSpeedKts?: number };
      if (!latLngOk(i.from) || !latLngOk(i.to)) return err('Koordinat exit/base tidak valid.');
      if (!num(i.transitSpeedKts) || (i.transitSpeedKts as number) <= 0) return err('Kecepatan transit harus > 0 kts.');
      return ok();
    },
    execute: (input) => {
      const i = input as { from: LatLng; to: LatLng; transitSpeedKts: number };
      const d = distanceNm(i.from, i.to);
      return { distanceNm: d, hours: d / i.transitSpeedKts };
    },
    requiresConfirmation: false,
    dependencies: ['asset-allocate'],
  },
  {
    id: 'transit-plot',
    name: 'Plot rute transit di Peta Laut',
    category: 'TRANSIT_CALCULATION',
    description: 'assetTransitLines: base→CSP (solid) dan exit→base (dashed) dengan label NM + menit; ikut ke PrintMapA3.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/app/page.tsx#assetTransitLines', 'src/components/sar/SeaMap.tsx', 'src/components/sar/PrintMapA3.tsx'],
    inputSchema: schema({ transitLines: f('array', 'Garis transit per aset dari asset-allocate') }, ['transitLines']),
    outputSchema: schema({ render: f('string', 'Layer rute transit di Peta Laut') }),
    requiresConfirmation: true,
    dependencies: ['transit-go', 'transit-back', 'map-sea-render'],
    notes: 'Catatan audit: garis dirender rhumb Mercator sedangkan jarak dihitung great-circle — visual vs angka bisa sedikit berbeda.',
  },

  // ------------------------------------------------------------------
  // INTERCEPT (E)
  // ------------------------------------------------------------------
  {
    id: 'intercept-calculate',
    name: 'Penghitungan Intercept (head-on/overtaking/beam-on)',
    category: 'INTERCEPT',
    description: 'Konstruksi intercept Diklat Basarnas: waktu & titik intercept, haluan SRU, titik konstruksi C/D atau X/Y/W (0.5 jam).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/interceptCalculations.ts#calculateIntercept'],
    inputSchema: schema({
      type: f('string', "'head-on' | 'overtaking' | 'beam-on'"),
      target: f('object', '{name, pos {lat,lng}, speedKts, courseDeg, departureTime?}'),
      sru: f('object', '{name, pos {lat,lng}, speedKts, departureTime?, enduranceHours?}'),
      referenceTime: f('string', 'Waktu acuan bersama'),
    }, ['type', 'target', 'sru']),
    outputSchema: schema({
      feasible: f('boolean', 'Intercept mungkin?'),
      interceptCourseDeg: f('number', 'Haluan SRU ke titik intercept (°T)'),
      timeToInterceptHours: f('number', 'Waktu ke intercept', { unit: 'h' }),
      interceptPos: f('object', 'Titik intercept {lat, lng}'),
      constructionPoints: f('object', 'Titik C/D atau X/Y/W untuk konstruksi'),
    }),
    validateInput: (input) => {
      const i = input as InterceptInput;
      if (!['head-on', 'overtaking', 'beam-on'].includes(i.type)) return err('Tipe intercept tidak dikenal.');
      if (!latLngOk(i.target?.pos) || !latLngOk(i.sru?.pos)) return err('Posisi target/SRU tidak valid.');
      if (!num(i.target?.speedKts) || (i.target.speedKts as number) <= 0) return err('Kecepatan target harus > 0 kts.');
      if (!num(i.sru?.speedKts) || (i.sru.speedKts as number) <= 0) return err('Kecepatan SRU harus > 0 kts.');
      if (i.type === 'overtaking' && (i.sru.speedKts as number) <= (i.target.speedKts as number)) return err('Overtaking tidak mungkin bila kecepatan SRU ≤ target.');
      if (i.type === 'beam-on' && !num(i.target?.courseDeg)) return err('Beam-on memerlukan course target (°T).');
      return ok();
    },
    execute: (input) => calculateIntercept(input as InterceptInput),
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'intercept-plot',
    name: 'Plot hasil intercept di Peta Laut',
    category: 'INTERCEPT',
    description: 'Peta terpisah (SeaMapMount preferenceKey "intercept"): marker A/B/I + konstruksi, garis track target/SRU berlabel °T dan NM; hanya tampil bila geometri lolos cek internal (≤0.02 NM, ≤0.1 min).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/InterceptWorksheet.tsx#mapData', 'src/components/sar/SeaMapMount.tsx'],
    inputSchema: schema({ result: f('object', 'Hasil intercept-calculate + input') }, ['result']),
    outputSchema: schema({ render: f('string', 'Peta intercept') }),
    requiresConfirmation: true,
    dependencies: ['intercept-calculate', 'map-sea-render'],
  },

  // ------------------------------------------------------------------
  // OPERATIONAL_DOCUMENT (F)
  // ------------------------------------------------------------------
  {
    id: 'doc-bank-data',
    name: 'Bank Data Kasus (fakta terverifikasi + PENDING)',
    category: 'OPERATIONAL_DOCUMENT',
    description: 'Analisis naratif soal → fakta kasus (~60 kunci) dengan status READY/PENDING/CONFLICT/STALE/ACTUAL_REQUIRED + pertanyaan pelengkap; disimpan di CaseDataBank.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'route',
    implementation: ['src/lib/sar/dataBank.ts#CASE_FACT_DEFS', 'src/app/api/data-bank/route.ts', 'src/components/sar/DocumentWorkbench.tsx'],
    inputSchema: schema({ rawText: f('string', 'Narasi soal kasus (≥20 karakter)') }, ['rawText']),
    outputSchema: schema({
      fields: f('array', 'DataBankField {key, value, status, source}'),
      summary: f('object', 'Ringkasan kesiapan dokumen'),
      questions: f('array', 'Pertanyaan untuk fakta PENDING'),
    }),
    requiresConfirmation: true,
    dependencies: [],
    notes: 'AI dilarang mengarang fakta: nilai tidak tersedia = PENDING, bukan tebakan.',
  },
  {
    id: 'doc-renops',
    name: 'Rencana Operasi SAR (RENOPS Format I/II)',
    category: 'OPERATIONAL_DOCUMENT',
    description: 'Draft RENOPS dari snapshot worksheet + bank data; AUTO memilih Format I (ACCIDENT) / II (DISASTER) via pickRenopsType; status DRAFT.',
    version: '1.0.0',
    status: 'partial',
    executionMode: 'route',
    implementation: ['src/lib/sar/dataBank.ts#buildRenops', 'src/lib/sar/dataBank.ts#pickRenopsType', 'src/app/api/documents/generate/route.ts'],
    inputSchema: schema({
      docType: f('string', "'AUTO' | 'RENOPS_I' | 'RENOPS_II'"),
      snapshot: f('object', 'DocumentSnapshot (hasil worksheet/map/bank)'),
      bankId: f('string', 'ID CaseDataBank (opsional)'),
    }, ['snapshot']),
    outputSchema: schema({ document: f('object', 'GeneratedDocument {sections, fields, tables} + status field READY/PENDING') }),
    validateInput: (input) => {
      const i = input as { snapshot?: unknown };
      if (i.snapshot === undefined || i.snapshot === null) return err('Snapshot dokumen kosong.');
      return ok();
    },
    execute: (input) => {
      const i = input as { docType?: DocType; snapshot: DocumentSnapshot | null; bank?: DataBankField[]; selectedAssetId?: string };
      return buildDocument(i.docType ?? 'RENOPS_I', i.snapshot, i.bank ?? [], i.selectedAssetId);
    },
    requiresConfirmation: true,
    dependencies: ['doc-bank-data', 'ws1-datum', 'ws1-search-area', 'pattern-generate', 'asset-allocate'],
    notes: 'Status partial: keluaran HTML print (bukan berkas docx/pdf); tidak ada endpoint APPROVED.',
  },
  {
    id: 'doc-briefing',
    name: 'Form Briefing (Lamp. II B Perban 3/2020)',
    category: 'OPERATIONAL_DOCUMENT',
    description: 'Draft briefing dari snapshot + bank + aset SRU terpilih; field kosong = PENDING; status DRAFT; tanda tangan SMC pada cetak.',
    version: '1.0.0',
    status: 'partial',
    executionMode: 'route',
    implementation: ['src/lib/sar/dataBank.ts#buildBriefing', 'src/app/api/documents/generate/route.ts'],
    inputSchema: schema({
      snapshot: f('object', 'DocumentSnapshot'), bankId: f('string', 'ID bank'), selectedAssetId: f('string', 'Aset SRU untuk briefing'),
    }, ['snapshot']),
    outputSchema: schema({ document: f('object', 'GeneratedDocument briefing (14 field)') }),
    execute: (input) => {
      const i = input as { snapshot: DocumentSnapshot | null; bank?: DataBankField[]; selectedAssetId?: string };
      return buildDocument('BRIEFING', i.snapshot, i.bank ?? [], i.selectedAssetId);
    },
    requiresConfirmation: true,
    dependencies: ['doc-bank-data', 'asset-allocate'],
    notes: 'Status partial (print HTML, belum docx/pdf).',
  },
  {
    id: 'doc-debriefing',
    name: 'Form De-Briefing (Lamp. II C Perban 3/2020)',
    category: 'OPERATIONAL_DOCUMENT',
    description: 'Draft de-briefing dengan penegakan ACTUAL_REQUIRED: hasil pelaksanaan aktual wajib dari pengguna — AI tidak boleh mengisi dari prediksi.',
    version: '1.0.0',
    status: 'partial',
    executionMode: 'route',
    implementation: ['src/lib/sar/dataBank.ts#buildDebriefing', 'src/app/api/documents/generate/route.ts'],
    inputSchema: schema({
      snapshot: f('object', 'DocumentSnapshot'), bankId: f('string', 'ID bank (berisi jawaban aktual)'),
      selectedAssetId: f('string', 'Aset SRU'),
    }, ['snapshot']),
    outputSchema: schema({ document: f('object', 'GeneratedDocument de-briefing + field ACTUAL_REQUIRED') }),
    execute: (input) => {
      const i = input as { snapshot: DocumentSnapshot | null; bank?: DataBankField[]; selectedAssetId?: string };
      return buildDocument('DEBRIEFING', i.snapshot, i.bank ?? [], i.selectedAssetId);
    },
    requiresConfirmation: true,
    dependencies: ['doc-bank-data'],
    notes: 'Rencana vs hasil aktual dipisahkan; tanpa data aktual field tetap PENDING.',
  },
  {
    id: 'doc-approval',
    name: 'Approval & penerbitan dokumen (per role)',
    category: 'OPERATIONAL_DOCUMENT',
    description: 'Alur approval berbasis role (SMC/instruktur): set status APPROVED, penerbitan final.',
    version: '1.0.0',
    status: 'unavailable',
    executionMode: 'none',
    implementation: ['prisma/schema.prisma#DocumentDraft'],
    inputSchema: schema({ draftId: f('string', 'ID DocumentDraft'), role: f('string', 'Role penyetuju') }, ['draftId']),
    outputSchema: schema({ status: f('string', 'APPROVED') }),
    requiresConfirmation: true,
    dependencies: ['doc-renops'],
    notes: 'Belum tersedia: model DocumentDraft punya status DRAFT|APPROVED tapi tidak ada endpoint yang menyetujui; approval saat ini = tanda tangan manual saat print.',
  },

  // ------------------------------------------------------------------
  // KNOWLEDGE_RETRIEVAL (G)
  // ------------------------------------------------------------------
  {
    id: 'kb-exercises',
    name: 'Bank latihan penghitungan dasar (statis)',
    category: 'KNOWLEDGE_RETRIEVAL',
    description: '±35 soal latihan terverifikasi (konversi waktu, zona, TW/DTG, kecepatan, S·V·T, A·T·V·S) dengan langkah + jawaban.',
    version: '1.0.0',
    status: 'available',
    executionMode: 'component',
    implementation: ['src/components/sar/basic-calc/Exercises.tsx', 'scripts/verify_sar_exercises.py'],
    inputSchema: schema({ group: f('string', 'Grup latihan') }, []),
    outputSchema: schema({ problems: f('array', 'Soal + langkah + jawaban') }),
    requiresConfirmation: false,
    dependencies: [],
  },
  {
    id: 'kb-iamsar-retrieval',
    name: 'Retrieval pengetahuan IAMSAR/Perban (RAG)',
    category: 'KNOWLEDGE_RETRIEVAL',
    description: 'Pencarian/pengutipan isi IAMSAR 2022 Vol 1–3, APPENDIX, dan Perban 3/2020 dari upload/.',
    version: '1.0.0',
    status: 'unavailable',
    executionMode: 'none',
    implementation: ['upload/iamsar 2022 vol 1.pdf', 'upload/iamsar 2022 vol 2.pdf', 'upload/iamsar 2022 vol 3.pdf'],
    inputSchema: schema({ query: f('string', 'Pertanyaan') }, ['query']),
    outputSchema: schema({ citation: f('string', 'Kutipan + halaman') }),
    requiresConfirmation: false,
    dependencies: [],
    notes: 'Belum tersedia: dokumen ada di upload/ tetapi belum diindeks (tanpa RAG/KB). Jangan mengutip halaman dari ingatan LLM.',
  },
  {
    id: 'kb-question-generation',
    name: 'Pembangkit soal dinamis (Question Generator)',
    category: 'KNOWLEDGE_RETRIEVAL',
    description: 'Pembangkitan soal latihan baru parameter acak + kunci jawaban terverifikasi kalkulasi.',
    version: '1.0.0',
    status: 'unavailable',
    executionMode: 'none',
    implementation: [],
    inputSchema: schema({ topic: f('string', 'Topik'), difficulty: f('string', 'Tingkat') }, []),
    outputSchema: schema({ problems: f('array', 'Soal baru + kunci') }),
    requiresConfirmation: true,
    dependencies: [],
    notes: 'Belum tersedia; latihan saat ini statis (kb-exercises).',
  },
  {
    id: 'kb-chart-distance-guide',
    name: 'Pengetahuan cara mengukur jarak di peta laut & peta udara',
    category: 'KNOWLEDGE_RETRIEVAL',
    description: 'Panduan langkah mengukur jarak dengan aturan 1 menit skala peta = 1 NM: skala lintang Mercator untuk peta laut, graticule ONC untuk peta udara, faktor bujur cos(lat), tabel konversi (1\'=1 NM, 1°=60 NM, 1 cm ONC ≈ 5,40 NM).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/chartDistance.ts#chartMeasureGuide', 'src/lib/sar/chartDistance.ts#CHART_MEASURE_GUIDE'],
    inputSchema: schema({
      chart: f('string', "'sea' | 'air' | 'both' (default both)"),
    }, []),
    outputSchema: schema({
      rule: f('string', 'Aturan dasar 1 menit = 1 NM'),
      sections: f('array', 'Langkah per jenis peta {title, steps, notes}'),
      conversionTable: f('array', 'Tabel konversi {unit, valueNm}'),
    }),
    validateInput: (input) => {
      const i = input as { chart?: string };
      if (i.chart !== undefined && !['sea', 'air', 'both'].includes(i.chart)) return err("chart harus 'sea' | 'air' | 'both'.");
      return ok();
    },
    execute: (input) => {
      const i = input as { chart?: 'sea' | 'air' | 'both' };
      return chartMeasureGuide(i.chart ?? 'both');
    },
    requiresConfirmation: false,
    dependencies: [],
    notes: 'Sumber: aturan navigasi standar (1 menit lintang = 1 NM = 1852 m; graticule ONC 1° = 60 NM). Tampil juga sebagai panel interaktif di tab Kalkulator (ChartDistanceGuide).',
  },
  {
    id: 'measure-chart-distance',
    name: 'Pengukuran jarak di peta laut/peta udara (1 menit = 1 NM)',
    category: 'BASIC_CALCULATION',
    description: 'Konversi span pengukuran peta → jarak: (a) dari menit skala lintang (1\' = 1 NM = 1852 m), atau (b) dari dua koordinat WGS84 (Δlat/Δlon menit, faktor bujur cos(lat), jarak haversine lib existing sebagai hasil ukur jangka).',
    version: '1.0.0',
    status: 'available',
    executionMode: 'lib',
    implementation: ['src/lib/sar/chartDistance.ts#chartDistanceFromMinutes', 'src/lib/sar/chartDistance.ts#chartDistanceFromPoints', 'src/lib/sar/sarCalculations.ts#distanceNm'],
    inputSchema: schema({
      deltaLatMinutes: f('number', 'Mode 1: span yang dibaca di skala LINTANG peta (menit)', { unit: "menit" }),
      p1: f('object', 'Mode 2: titik pertama {lat, lng} WGS84'),
      p2: f('object', 'Mode 2: titik kedua {lat, lng} WGS84'),
      chart: f('string', "'sea' | 'air' (default 'sea') — melabeli metode"),
    }, []),
    outputSchema: schema({
      method: f('string', "'lat-minutes' | 'points'"),
      deltaLatMinutes: f('number', 'Komponen utara–selatan (menit)'),
      deltaLonMinutes: f('number', 'Komponen timur–barat (menit)'),
      lonMinuteNm: f('number', "Nilai 1' bujur pada latitude tengah = cos(lat) NM"),
      distanceNm: f('number', 'Jarak hasil ukur', { unit: 'NM' }),
      distanceKm: f('number', 'Jarak', { unit: 'km' }),
      distanceM: f('number', 'Jarak', { unit: 'm' }),
      greatCircleNm: f('number', 'Jarak sebenarnya (haversine) bila mode titik', { unit: 'NM' }),
    }),
    validateInput: (input) => {
      const i = input as { deltaLatMinutes?: number; p1?: LatLng; p2?: LatLng; chart?: string };
      if (i.chart !== undefined && !['sea', 'air'].includes(i.chart)) return err("chart harus 'sea' atau 'air'.");
      const hasMinutes = num(i.deltaLatMinutes);
      const hasPoints = i.p1 !== undefined || i.p2 !== undefined;
      if (hasPoints && !(latLngOk(i.p1) && latLngOk(i.p2))) return err('Mode titik: p1 dan p2 harus {lat, lng} valid (lat ≤ 90, lng ≤ 180).');
      if (!hasMinutes && !hasPoints) return err('Berikan deltaLatMinutes (menit skala lintang) ATAU pasangan koordinat p1 & p2.');
      return ok();
    },
    execute: (input) => {
      const i = input as { deltaLatMinutes?: number; p1?: LatLng; p2?: LatLng; chart?: ChartKind };
      const kind: ChartKind = i.chart === 'air' ? 'air' : 'sea';
      if (i.p1 !== undefined && i.p2 !== undefined) return chartDistanceFromPoints(i.p1, i.p2, kind);
      return chartDistanceFromMinutes(i.deltaLatMinutes ?? 0, kind);
    },
    requiresConfirmation: false,
    dependencies: ['kb-chart-distance-guide'],
    notes: 'Ketentuan aplikasi: 1 menit skala peta = 1 NM. Skala bujur mengecil ke kutub (1\' bujur = cos(lat) NM) — jangan dibaca langsung sebagai NM.',
  },
];

// ============================================================================
// Akses registry
// ============================================================================

export const CAPABILITY_CATEGORIES: SARCapabilityCategory[] = [
  'WORKSHEET_CALCULATION',
  'BASIC_CALCULATION',
  'UNIT_CONVERSION',
  'MAP_OPERATION',
  'SEARCH_PATTERN',
  'ASSET_ALLOCATION',
  'TRANSIT_CALCULATION',
  'INTERCEPT',
  'OPERATIONAL_DOCUMENT',
  'KNOWLEDGE_RETRIEVAL',
];

export function getCapability(id: string): SARCapability | undefined {
  return SAR_CAPABILITY_REGISTRY.find((c) => c.id === id);
}

export function listCapabilities(filter?: {
  category?: SARCapabilityCategory;
  status?: CapabilityStatus;
}): SARCapability[] {
  return SAR_CAPABILITY_REGISTRY.filter((c) =>
    (!filter?.category || c.category === filter.category) &&
    (!filter?.status || c.status === filter.status),
  );
}

/** Ringkasan registry untuk /api/capabilities dan audit. */
export function summarizeRegistry(): {
  total: number;
  byCategory: Record<string, number>;
  byStatus: Record<string, number>;
} {
  const byCategory: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const c of SAR_CAPABILITY_REGISTRY) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  }
  return { total: SAR_CAPABILITY_REGISTRY.length, byCategory, byStatus };
}
