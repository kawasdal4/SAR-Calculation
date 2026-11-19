/**
 * STATE → CASE ADAPTER (Fase 2 AI Copilot) — arah SEBALIKnya dari
 * `buildCaseWorksheetSeeds()`: snapshot state worksheet aplikasi (bentuk yang
 * sama dengan `buildState()` di page.tsx) → `SarCaseSchema` + input planner.
 *
 * TUJUAN: tool server-side (`get_state`, `run_pipeline`, `run_worksheet`,
 * `validate_plan`) membutuhkan gambaran kasus TERKINI. State worksheet tinggal
 * di browser, jadi client mengirim snapshot ini di setiap POST /api/chat dan
 * server memetakannya di sini.
 *
 * ATURAN:
 * - TIDAK ada rumus — murni pemetaan field 1:1 (fungsi deterministik).
 * - Field yang tidak ada di snapshot dibiarkan kosong (skema permisif);
 *   kelengkapan diperiksa `checkCaseCompleteness()`, bukan di sini.
 * - Data lembar WS 2/WS 8 dipetakan VERBATIM ke `sru.sheet` (lihat
 *   caseSchema.ts) sehingga pipeline memakai input worksheet persis seperti
 *   tampil di aplikasi — bukan re-derivation.
 * - Tidak pernah melempar: masalah dipetakan ke `warnings[]`.
 */

import { sarCaseSchema, type SarCaseSchema, type CaseSru, type WindLayer, type SurfaceWindEntry } from './caseSchema';
import type { CasePlannerInputs } from './caseAdapter';
import type { SearchPatternType } from './searchPatterns';
import { LEEWAY_OBJECT_TYPES } from './sarCalculations';

/** Snapshot state aplikasi — struktur longgar (dibangun lintas versi), akses
 *  defensif. Bentuk = isi `buildState().state` di page.tsx. */
export type AppWorksheetStateSnapshot = Record<string, unknown>;

export interface StateToCaseResult {
  ok: boolean;
  sarCase?: SarCaseSchema;
  /** Input planner untuk buildCaseWorksheetSeeds/runCasePipeline. */
  planner: CasePlannerInputs;
  warnings: string[];
}

// ── Helper defensif ──────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}
function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/** "Surface"→0, "FL200"→20000, "3000"/"3000 Feet"→3000; null bila tak terbaca. */
export function parseAltitudeFtLabel(label: string): number | null {
  const text = label.trim();
  if (!text) return null;
  if (/^(surface|permukaan|0)$/i.test(text)) return 0;
  const fl = text.match(/^FL\s*(\d{1,4})$/i);
  if (fl) return parseInt(fl[1], 10) * 100;
  const plain = text.replace(/[\s]*(?:feet|ft|kaki)\.?$/i, '').trim();
  if (/^\d{1,6}([.,]\d+)?$/.test(plain)) {
    const value = parseFloat(plain.replace(',', '.'));
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

const PATTERN_TYPES: readonly SearchPatternType[] = ['PS', 'CS', 'SS', 'VS', 'TS'];

function normalizePatternType(value: unknown): SearchPatternType | undefined {
  const text = str(value)?.toUpperCase();
  return PATTERN_TYPES.find((t) => t === text);
}

/** Koordinat valid (desimal bertanda) dari field snapshot apa pun. */
function coordFrom(value: unknown): { lat: number; lng: number } | undefined {
  const record = asRecord(value);
  const lat = num(record?.lat);
  const lng = num(record?.lng);
  if (lat === undefined || lng === undefined) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return { lat, lng };
}

// ── Pemetaan utama ───────────────────────────────────────────────────────────

/**
 * Petakan snapshot state worksheet → SarCaseSchema + planner inputs.
 * Selalu mengembalikan hasil (ok) sepanjang snapshot objek — bagian kosong
 * dibiarkan kosong; `parseSarCase` di server yang memutuskan valid/tidak.
 */
export function stateToCase(snapshot: AppWorksheetStateSnapshot | undefined | null): StateToCaseResult {
  const warnings: string[] = [];
  const planner: CasePlannerInputs = {};
  const state = asRecord(snapshot);
  if (!state) {
    return { ok: false, planner, warnings: ['Snapshot state worksheet tidak tersedia atau bukan objek.'] };
  }

  const asw = asRecord(state.asw);
  const awa = asRecord(state.awa);
  const aero = asRecord(state.aero);
  const datum = asRecord(state.datum);
  const ws1 = asRecord(state.ws1);
  const lkpCoord = coordFrom(state.lkp);

  // ── caseTitle ──────────────────────────────────────────────────────────────
  const caseTitle = str(asw?.caseTitle) ?? str(awa?.caseTitle) ?? str(aero?.caseTitle);

  // ── incident: jenis + waktu + ketinggian (heuristik, diaudit di warnings) ──
  const aeroPresent = aero !== undefined
    && (bool(aero.useAircraftGlide) === true || bool(aero.useParachute) === true);
  const ws8SheetsRaw = asArray(state.ws8Sheets);
  let incidentType: SarCaseSchema['incident']['type'] = 'other';
  if (aeroPresent) incidentType = 'aircraft-ditching';
  else if (ws8SheetsRaw.length > 0) incidentType = 'vessel-sinking';
  else if (asArray(state.ws2Sheets).length > 0 || asArray(state.ws3Sheets).length > 0) incidentType = 'person-overboard';
  warnings.push(
    incidentType === 'other'
      ? 'Jenis insiden tidak dapat disimpulkan dari state worksheet — dipakai "other".'
      : `Jenis insiden disimpulkan dari blok worksheet yang terisi: "${incidentType}" (heuristik snapshot).`,
  );

  const incident: SarCaseSchema['incident'] = { type: incidentType };
  const distressTime = str(asw?.distressTime);
  if (distressTime) incident.lastContactTime = distressTime;
  const datumTime = str(asw?.datumTime);
  const distressAltFt = num(awa?.distressAltFt);
  if (distressAltFt !== undefined) incident.altitudeFt = distressAltFt;
  const aeroHeading = num(aero?.aircraftDescentHeadingDeg);
  if (aeroHeading !== undefined && aeroHeading >= 0 && aeroHeading <= 360) {
    incident.headingDeg = aeroHeading;
    incident.headingReference = (str(aero?.aircraftHeadingReference) as 'true' | 'magnetic' | 'compass' | undefined) ?? 'magnetic';
  }

  // ── lkp ────────────────────────────────────────────────────────────────────
  const lkp = lkpCoord
    ? { coord: lkpCoord, source: bool(state.adwSyncLkp) === true ? ('adw-landing' as const) : ('explicit' as const) }
    : undefined;

  // ── aeroDrift (glide/parasut/variation) + windLayers dari AWA ──────────────
  const aeroDrift: SarCaseSchema['aeroDrift'] = {};
  const glideRatio = num(aero?.aircraftGlideRatio);
  const glideSpeedKts = num(aero?.aircraftTASgKts);
  if (glideRatio !== undefined) aeroDrift.glideRatio = glideRatio;
  if (glideSpeedKts !== undefined) aeroDrift.glideSpeedKts = glideSpeedKts;
  const variationDeg = num(aero?.magneticVariationDeg);
  if (variationDeg !== undefined) {
    aeroDrift.variationDeg = variationDeg;
    aeroDrift.variationDirection = str(aero?.magneticVariationDirection) === 'W' ? 'W' : 'E';
  }
  const devDeg = num(aero?.aircraftDeviationDeg);
  if (devDeg !== undefined) {
    aeroDrift.deviationDeg = devDeg;
    aeroDrift.deviationDirection = str(aero?.aircraftDeviationDirection) === 'W' ? 'W' : 'E';
  }
  if (bool(aero?.useParachute) === true) {
    aeroDrift.parachute = {
      present: true,
      type: str(aero?.parachuteType) === 'steerable' ? 'steerable' : 'round-zero-glide',
      altMaxFt: num(aero?.parachuteAltMaxFt),
      rateOfDescentFtMin: num(aero?.parachuteRateOfDescentFtMin),
      glideRatio: num(aero?.parachuteGlideRatio),
    };
  }
  const awaObservationsRaw = asArray(awa?.observations);
  const windLayers: WindLayer[] = [];
  for (const raw of awaObservationsRaw) {
    const obs = asRecord(raw);
    const label = str(obs?.altObs);
    const dirFrom = num(obs?.windDirFrom);
    const speed = num(obs?.windSpeed);
    if (!label || dirFrom === undefined || speed === undefined) {
      warnings.push(`Baris AWA dilewati (label/arah/kecepatan tidak terbaca): ${JSON.stringify(raw).slice(0, 80)}`);
      continue;
    }
    const altitudeFt = parseAltitudeFtLabel(label);
    if (altitudeFt === null) {
      warnings.push(`Baris AWA dilewati (label ketinggian tidak terbaca): "${label}"`);
      continue;
    }
    windLayers.push({ altitudeFt, altitudeLabel: label, windDirFrom: dirFrom, windSpeedKts: speed });
  }
  if (windLayers.length > 0) aeroDrift.windLayers = windLayers;
  const aeroDriftFilled = Object.keys(aeroDrift).length > 0 ? aeroDrift : undefined;

  // ── sea: arus (arah KE) + deret angin permukaan ASW ────────────────────────
  const sea: SarCaseSchema['sea'] = {};
  const currentDir = num(datum?.seaCurrentDir);
  const currentSpeed = num(datum?.seaCurrentSpeed);
  if (currentDir !== undefined && currentSpeed !== undefined) {
    sea.current = { dirToDeg: currentDir, speedKts: currentSpeed };
  }
  const aswObservationsRaw = asArray(asw?.observations);
  const surfaceWindSeries: SurfaceWindEntry[] = [];
  for (const raw of aswObservationsRaw) {
    const obs = asRecord(raw);
    const obsTime = str(obs?.timeObs);
    const dirFrom = num(obs?.windDirFrom);
    const speed = num(obs?.windSpeed);
    if (!obsTime || dirFrom === undefined || speed === undefined) {
      warnings.push(`Baris ASW dilewati (waktu/arah/kecepatan tidak terbaca): ${JSON.stringify(raw).slice(0, 80)}`);
      continue;
    }
    surfaceWindSeries.push({ obsTime, windDirFrom: dirFrom, windSpeedKts: speed });
  }
  if (surfaceWindSeries.length > 0) sea.surfaceWindSeries = surfaceWindSeries;
  const seaFilled = Object.keys(sea).length > 0 ? sea : undefined;

  // ── search: datum time + searchNumber lembar pertama ───────────────────────
  const search: SarCaseSchema['search'] = {};
  if (datumTime) search.datumTime = datumTime;
  const sheetSearchNumbers = collectSheetNumbers(state);
  const searchNumber = sheetSearchNumbers[0];
  if (searchNumber !== undefined) search.searchNumber = searchNumber;
  const searchFilled = Object.keys(search).length > 0 ? search : undefined;

  // ── sru: lembar WS 2/WS 8 verbatim + aset alokasi (koordinat/taf) ──────────
  const assetsRaw = asArray(state.assets);
  const sruList: CaseSru[] = [];
  for (const raw of asArray(state.ws2Sheets)) {
    const sheetData = asRecord(raw);
    const data = asRecord(sheetData?.data);
    if (!data) continue;
    const callsign = str(data.sruName) ?? `SRU-Udara-${sruList.length + 1}`;
    const sru: CaseSru = {
      callsign,
      kind: str(data.searchPlatform) === 'helicopter' ? 'helicopter' : 'fixed-wing',
    };
    const tasSearchKts = num(data.searchTas);
    if (tasSearchKts !== undefined) sru.tasSearchKts = tasSearchKts;
    sru.sheet = {
      kind: 'ws2',
      searchPlatform: str(data.searchPlatform) === 'helicopter' ? 'helicopter' : 'fixed-wing',
      searchObject: str(data.searchObject),
      visibilityIndex: num(data.visibilityIndex),
      selectedHeightFt: num(data.selectedHeight),
      isFatigue: str(data.isFatigue) === 'Yes' ? 'Yes' : str(data.isFatigue) === 'No' ? 'No' : undefined,
      piwFlotationKnown: bool(data.piwFlotationKnown),
      searchNumber: num(data.searchNumber),
      hoursAvailable: num(data.hoursAvailable),
      caseWindDirFrom: num(data.caseWindDirFrom),
      caseWindSpeed: num(data.caseWindSpeed),
      caseWaveHeightM: num(data.caseWaveHeightM),
      fwOverride: num(data.fwOverride),
      fsOverride: num(data.fsOverride),
    };
    attachAsset(sru, callsign, assetsRaw);
    sruList.push(sru);
  }
  for (const raw of ws8SheetsRaw) {
    const sheetData = asRecord(raw);
    const data = asRecord(sheetData?.data);
    if (!data) continue;
    const callsign = str(data.sruName) ?? `SRU-Laut-${sruList.length + 1}`;
    const sru: CaseSru = { callsign, kind: 'vessel' };
    const vesselSpeedKts = num(data.vesselSpeedKts);
    if (vesselSpeedKts !== undefined) sru.tasSearchKts = vesselSpeedKts;
    sru.sheet = {
      kind: 'ws8',
      sruType: normalizeWs8SruType(data.sruType),
      eyeHeight: normalizeEyeHeight(data.eyeHeight),
      searchObject: str(data.searchObject),
      visibilityKm: str(data.visibilityKm),
      isFatigue: str(data.isFatigue) === 'Yes' ? 'Yes' : str(data.isFatigue) === 'No' ? 'No' : undefined,
      searchNumber: num(data.searchNumber),
      hoursAvailable: num(data.hoursAvailable),
      vesselSpeedKts,
      caseWindDirFrom: num(data.caseWindDirFrom),
      caseWindSpeed: num(data.caseWindSpeed),
      caseWaveHeightM: num(data.caseWaveHeightM),
      fwOverride: num(data.fwOverride),
    };
    attachAsset(sru, callsign, assetsRaw);
    sruList.push(sru);
  }
  // Aset tanpa lembar WS 2/WS 8 tetap masuk (koordinat dipakai alokasi).
  for (const raw of assetsRaw) {
    const asset = asRecord(raw);
    const name = str(asset?.name);
    if (!name) continue;
    if (sruList.some((entry) => entry.callsign === name)) continue;
    const sru: CaseSru = { callsign: name, kind: 'vessel' };
    attachAsset(sru, name, assetsRaw);
    sruList.push(sru);
  }

  // ── planner inputs dari state (Fs WS 1, galat J-1, leeway, pola) ───────────
  const fs = num(ws1?.fs);
  if (fs !== undefined && fs > 0) planner.fs = fs;
  const xNm = num(datum?.X);
  if (xNm !== undefined) planner.xNm = xNm;
  const yNm = num(datum?.Y);
  if (yNm !== undefined) planner.yNm = yNm;
  const leewayObjectId = str(datum?.leewayObjectId);
  if (leewayObjectId) {
    planner.leewayObjectId = leewayObjectId;
    if (!LEEWAY_OBJECT_TYPES.some((entry) => entry.id === leewayObjectId)) {
      warnings.push(`leewayObjectId "${leewayObjectId}" tidak ada di Tabel I-1/I-2 — datum akan menolak (pilih kategori valid).`);
    }
  }
  const patternType = normalizePatternType(state.patternType);
  if (patternType) planner.patternType = patternType;
  const fatigueSheets = collectSheetFatigue(state);
  if (fatigueSheets.length > 0) planner.fatigue = fatigueSheets.some((f) => f === 'Yes') ? 'Yes' : 'No';

  const sarCase: SarCaseSchema = {
    schemaVersion: 1,
    ...(caseTitle ? { caseTitle } : {}),
    incident,
    ...(lkp ? { lkp } : {}),
    ...(aeroDriftFilled ? { aeroDrift: aeroDriftFilled } : {}),
    ...(seaFilled ? { sea: seaFilled } : {}),
    ...(searchFilled ? { search: searchFilled } : {}),
    ...(sruList.length > 0 ? { sru: sruList } : {}),
    meta: {
      source: 'manual',
      assumptions: warnings.map((warning) => ({ field: 'stateToCase', reason: warning })),
    },
  };

  const parsed = sarCaseSchema.safeParse(sarCase);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return { ok: false, planner, warnings: [...warnings, `Snapshot tidak valid sebagai kasus: ${issues.join('; ')}`] };
  }
  return { ok: true, sarCase: parsed.data, planner, warnings };
}

// ── Helper kecil ─────────────────────────────────────────────────────────────

function collectSheetNumbers(state: Record<string, unknown>): number[] {
  const numbers: number[] = [];
  for (const key of ['ws2Sheets', 'ws8Sheets']) {
    for (const raw of asArray(state[key])) {
      const value = num(asRecord(asRecord(raw)?.data)?.searchNumber);
      if (value !== undefined) numbers.push(value);
    }
  }
  return numbers;
}

function collectSheetFatigue(state: Record<string, unknown>): Array<'Yes' | 'No'> {
  const values: Array<'Yes' | 'No'> = [];
  for (const key of ['ws2Sheets', 'ws8Sheets']) {
    for (const raw of asArray(state[key])) {
      const value = str(asRecord(asRecord(raw)?.data)?.isFatigue);
      if (value === 'Yes' || value === 'No') values.push(value);
    }
  }
  return values;
}

function normalizeWs8SruType(value: unknown): 'rescue-vessel' | 'patrol-boat' | 'rib' | 'sea-rider' | undefined {
  const text = str(value);
  if (text === 'rescue-vessel' || text === 'patrol-boat' || text === 'rib' || text === 'sea-rider') return text;
  return undefined;
}

function normalizeEyeHeight(value: unknown): '8' | '14' | 'MERSHIP' | undefined {
  const text = str(value);
  if (text === '8' || text === '14' || text === 'MERSHIP') return text;
  return undefined;
}

/** Tempel data aset alokasi (koordinat/kecepatan/endurance/TAF) ke sru by name. */
function attachAsset(sru: CaseSru, callsign: string, assetsRaw: unknown[]): void {
  for (const raw of assetsRaw) {
    const asset = asRecord(raw);
    if (str(asset?.name) !== callsign) continue;
    const homePos = coordFrom(asset?.homeBasePos);
    if (homePos) sru.coord = homePos;
    const transit = num(asset?.transitSpeedKts);
    if (transit !== undefined) sru.tasMaxKts = transit;
    if (sru.tasSearchKts === undefined) {
      const searchSpeed = num(asset?.searchSpeedKts);
      if (searchSpeed !== undefined) sru.tasSearchKts = searchSpeed;
    }
    const endurance = num(asset?.enduranceHours);
    if (endurance !== undefined) {
      sru.enduranceHours = Math.floor(endurance);
      sru.enduranceMinutes = Math.round((endurance - Math.floor(endurance)) * 60);
    }
    const engine = str(asset?.airEngineType);
    if (engine === 'turbine' || engine === 'piston') sru.engine = engine;
    const taf = str(asset?.tafCondition);
    if (taf) sru.taf = taf;
    return;
  }
}
