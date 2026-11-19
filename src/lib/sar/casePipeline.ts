/**
 * CASE PIPELINE (Fase 1 AI Copilot) — orkestrasi headless rantai worksheet
 * dari satu `SarCaseSchema`:
 *
 *   ASW → AWA → Aeronautical Drift (ditching) → Datum WS 1 (S→Wc→LW, De, E, R, Ao)
 *      → WS 2/WS 8 per SRU (W, S, C, POD, T) → Search Pattern/CSP
 *      → Alokasi Aset (transit/EST/sweep area vs Ao)
 *
 * ATURAN:
 * - TIDAK ada rumus baru: setiap angka keluar dari fungsi lib yang sama dengan
 *   worksheet (computeASW, computeAWA, calculateAeroDrift, computeDatumWs1,
 *   computeW2Row/computeW8Row, generateSearchPattern, calculateAssetAllocation*).
 * - LLM TIDAK PERNAH menghitung angka SAR — pipeline ini yang dipanggil tool
 *   `run_pipeline`/`run_worksheet` di Fase 2/3.
 * - Aturan antar-worksheet dipertahankan: Hours of drift (a) = Total Hours (D)
 *   ASW; LKP datum = posisi ditching hasil ADW (aturan rantai app);
 *   orientasi pola = bearing LKP → Datum.
 * - Deterministik: input sama → output sama (tanpa waktu/keacakan).
 */

import {
  computeASW,
  computeAWA,
  bearingDeg,
  LEEWAY_OBJECT_TYPES,
  type AWAObservation,
  type ASWObservation,
  type AWAResult,
  type ASWResult,
  type LatLng,
} from './sarCalculations';
import { calculateAeroDrift, type AeroDriftInput, type AeroDriftResult } from './aeroDriftCalculations';
import { computeDatumWs1, type Ws1DatumInput, type Ws1DatumResult } from './datumWs1';
import { buildAswObservationsFromCase } from './aswTime';
import {
  computeW2Row,
  computeW8Row,
  type SearchNumber,
  type W2Target,
  type W8Target,
  type WscPodRowResult,
} from './wscPodTables';
import {
  generateSearchPattern,
  clipSearchPatternToSquare,
  type SearchPatternResult,
  type SearchPatternType,
} from './searchPatterns';
import {
  calculateAssetAllocationSummary,
  type AssetAllocationSummary,
  type SruAssetInput,
} from './assetAllocation';
import {
  buildCaseWorksheetSeeds,
  type CaseAssumptionNote,
  type CasePlannerInputs,
  type CaseWorksheetSeeds,
} from './caseAdapter';
import type { SarCaseSchema } from './caseSchema';

export type PipelineStepStatus = 'ok' | 'skipped' | 'error';

export interface PipelineStep {
  step: string;
  status: PipelineStepStatus;
  detail?: string;
}

export interface CasePipelineOptions extends CasePlannerInputs {
  /** Override track spacing pola (NM); default: S lembar WS 2/WS 8 pertama yang ready. */
  trackSpacingNm?: number;
  /** Kecepatan SRU untuk estimasi jam pola (default: search speed aset pertama, atau 15 kts). */
  sruSpeedKts?: number;
  /** Override orientasi pola (°T); default: bearing LKP → Datum. */
  patternOrientationDeg?: number;
}

export interface CasePipelineOutput {
  ok: boolean;
  steps: PipelineStep[];
  assumptions: CaseAssumptionNote[];
  asw?: ASWResult & { observations: ASWObservation[] };
  awa?: AWAResult;
  aero?: AeroDriftResult;
  datum?: Ws1DatumResult;
  searchArea?: {
    dePercent: number;
    E: number;
    fs: number;
    RUp: number;
    aoSquareNm2: number;
  };
  ws2Rows?: Array<{ sruName?: string; result: WscPodRowResult }>;
  ws8Rows?: Array<{ sruName?: string; result: WscPodRowResult }>;
  pattern?: SearchPatternResult;
  allocation?: AssetAllocationSummary;
}

interface W2SheetData {
  sruName?: string;
  searchPlatform?: 'fixed-wing' | 'helicopter';
  searchTas?: number;
  searchObject?: W2Target;
  visibilityIndex?: number;
  isFatigue?: 'Yes' | 'No';
  piwFlotationKnown?: boolean;
  searchNumber?: SearchNumber;
  selectedHeight?: 500 | 1000 | 1500 | 2000;
  caseWindSpeed?: number;
  caseWaveHeightM?: number;
}

interface W8SheetData {
  sruName?: string;
  searchObject?: W8Target;
  eyeHeight?: '8' | '14' | 'MERSHIP';
  visibilityKm?: string;
  isFatigue?: 'Yes' | 'No';
  searchNumber?: SearchNumber;
  vesselSpeedKts?: number;
  caseWindSpeed?: number;
  caseWaveHeightM?: number;
}

/** Jalankan pipeline lengkap. Tidak pernah melempar — langkah gagal menjadi
 *  step berstatus 'error' dengan detail, output keseluruhan ok=false. */
export function runCasePipeline(
  sarCase: SarCaseSchema,
  options: CasePipelineOptions = {},
): CasePipelineOutput {
  const steps: PipelineStep[] = [];
  const assumptions: CaseAssumptionNote[] = [];
  const output: CasePipelineOutput = { ok: false, steps, assumptions };

  const { seeds, assumptions: seedAssumptions } = buildCaseWorksheetSeeds(sarCase, options);
  assumptions.push(...seedAssumptions);

  const searchNumber: SearchNumber = ((options.searchNumber ?? sarCase.search?.searchNumber ?? 1) as SearchNumber);

  // ── 0. Jenis darat (Fase 5b): pipeline laut tidak berlaku ────────────────
  const isLandIncident = sarCase.incident.type === 'aircraft-land-crash' || sarCase.incident.type === 'missing-person-land';
  if (isLandIncident) {
    steps.push({
      step: 'land-search-ws3',
      status: 'skipped',
      detail: 'Pencarian darat — radius/area dihitung lewat WS 3/WS 4 (landSearchRadius + Tabel I-9/I-10), bukan pipeline laut; lihat kunci jawaban.',
    });
    output.ok = true;
    return output;
  }

  // ── 1. ASW ───────────────────────────────────────────────────────────────
  let aswResult: ASWResult | undefined;
  const aswObservations = (seeds.asw?.windData
    ? buildObservationsFromSeed(seeds.asw)
    : []) as ASWObservation[];
  if (aswObservations.length > 0) {
    aswResult = computeASW(aswObservations);
    output.asw = { ...aswResult, observations: aswObservations };
    steps.push({
      step: 'asw',
      status: aswResult.totalHours > 0 && aswResult.aswSpeed > 0 ? 'ok' : 'error',
      detail: `ASW ${aswResult.aswDirFrom.toFixed(1)}°/${aswResult.aswSpeed.toFixed(2)} kts, total hours ${aswResult.totalHours.toFixed(2)} h`,
    });
  } else {
    steps.push({ step: 'asw', status: 'error', detail: 'Observasi ASW tidak tersedia (waktu/deret angin kurang).' });
  }

  // ── 2. AWA ───────────────────────────────────────────────────────────────
  let awaResult: AWAResult | undefined;
  if (seeds.awa && seeds.awa.observations.length > 0) {
    const awaObservations: AWAObservation[] = seeds.awa.observations.map((obs) => ({
      altObs: obs.altObs,
      windDirFrom: obs.windDirFrom,
      windSpeed: obs.windSpeed,
    }));
    awaResult = computeAWA(awaObservations, seeds.awa.distressAltFt);
    output.awa = awaResult;
    steps.push({
      step: 'awa',
      status: awaResult.isValid ? 'ok' : 'error',
      detail: awaResult.isValid
        ? `AWA ${awaResult.awaDirFrom.toFixed(1)}°/${awaResult.awaSpeed.toFixed(2)} kts`
        : awaResult.errors.join(' '),
    });
  } else {
    const nonDitching = sarCase.incident.type !== 'aircraft-ditching';
    steps.push({
      step: 'awa',
      status: nonDitching ? 'skipped' : 'error',
      detail: nonDitching
        ? 'Tidak berlaku untuk insiden tanpa tabel angin per ketinggian (kapal/MOB).'
        : 'Tabel angin per ketinggian tidak tersedia.',
    });
  }

  // ── 3. Aeronautical Drift (ditching) ─────────────────────────────────────
  let landingPos: LatLng | undefined;
  const isVesselIncident = sarCase.incident.type !== 'aircraft-ditching';
  if (isVesselIncident) {
    // Cabang aditif kapal (Fase 5a): tanpa ADW — LKP (posisi terakhir)
    // dipakai langsung sebagai titik awal datum. Jalur ditching tidak berubah.
    landingPos = seeds.lkp;
      steps.push({
        step: 'aero-drift',
        status: landingPos ? 'skipped' : 'error',
        detail: landingPos
          ? 'Tidak berlaku untuk insiden non-ditching — LKP dipakai sebagai titik awal datum.'
          : 'Koordinat LKP tidak tersedia.',
      });
  } else if (awaResult?.isValid && seeds.aero && seeds.lkp) {
    const seedAero = seeds.aero as unknown as Partial<AeroDriftInput>;
    const aeroInput: AeroDriftInput = {
      caseTitle: seedAero.caseTitle ?? sarCase.caseTitle ?? '',
      caseNumber: seedAero.caseNumber ?? '',
      date: seedAero.date ?? '',
      plannerName: seedAero.plannerName ?? '',
      searchObject: seedAero.searchObject ?? sarCase.incident.craftType ?? '',
      incidentPos: seeds.lkp,
      incidentTime: seedAero.incidentTime ?? sarCase.incident.lastContactTime ?? '',
      useAircraftGlide: seedAero.useAircraftGlide ?? true,
      aircraftAltMaxFt: seedAero.aircraftAltMaxFt ?? 0,
      aircraftAltMinFt: seedAero.aircraftAltMinFt ?? 0,
      aircraftGlideRatio: seedAero.aircraftGlideRatio ?? sarCase.aeroDrift?.glideRatio ?? 0,
      aircraftTASgKts: seedAero.aircraftTASgKts ?? sarCase.aeroDrift?.glideSpeedKts ?? 0,
      aircraftDescentHeadingDeg: seedAero.aircraftDescentHeadingDeg,
      aircraftHeadingReference: seedAero.aircraftHeadingReference ?? 'magnetic',
      magneticVariationDeg: seedAero.magneticVariationDeg ?? sarCase.aeroDrift?.variationDeg,
      magneticVariationDirection: seedAero.magneticVariationDirection ?? sarCase.aeroDrift?.variationDirection ?? 'E',
      aircraftDeviationDeg: seedAero.aircraftDeviationDeg ?? 0,
      aircraftDeviationDirection: seedAero.aircraftDeviationDirection ?? 'E',
      parachuteDeviationDeg: seedAero.parachuteDeviationDeg ?? 0,
      parachuteDeviationDirection: seedAero.parachuteDeviationDirection ?? 'E',
      useParachute: seedAero.useParachute ?? false,
      parachuteType: seedAero.parachuteType ?? 'round-zero-glide',
      parachuteAltMaxFt: seedAero.parachuteAltMaxFt ?? 0,
      parachuteTerrainAltFt: seedAero.parachuteTerrainAltFt ?? 0,
      parachuteRateOfDescentFtMin: seedAero.parachuteRateOfDescentFtMin ?? 0,
      parachuteGlideRatio: seedAero.parachuteGlideRatio,
      parachuteDescentHeadingDeg: seedAero.parachuteDescentHeadingDeg,
      parachuteHeadingReference: seedAero.parachuteHeadingReference ?? 'true',
      awaIsValid: awaResult.isValid,
      awaGlideDirFrom: awaResult.awaDirFrom,
      awaGlideSpeedKts: awaResult.awaSpeed,
      fixErrorXNm: seedAero.fixErrorXNm ?? 0,
      safetyFactorFs: seedAero.safetyFactorFs ?? options.fs ?? 1.1,
    };
    const aeroResult = calculateAeroDrift(aeroInput);
    output.aero = aeroResult;
    landingPos = aeroResult.positionValid ? aeroResult.landingPos : undefined;
    steps.push({
      step: 'aero-drift',
      status: aeroResult.positionValid && landingPos ? 'ok' : 'error',
      detail: aeroResult.positionValid
        ? `Ditching ${aeroResult.landingPos.lat.toFixed(5)}, ${aeroResult.landingPos.lng.toFixed(5)} (drift ${aeroResult.totalDisplacementNm.toFixed(1)} NM)`
        : aeroResult.validationErrors.join(' ') || 'Posisi ditching tidak valid.',
    });
  } else {
    steps.push({ step: 'aero-drift', status: 'error', detail: 'Prasyarat ADW tidak terpenuhi (AWA valid + LKP + data glide).' });
  }

  // ── 4. Datum WS 1 (+ De, E, R, Ao) ───────────────────────────────────────
  let datumResult: Ws1DatumResult | undefined;
  const leewayObjectId = options.leewayObjectId ?? sarCase.target?.leewayObjectId;
  if (aswResult && aswResult.totalHours > 0 && landingPos && seeds.datum) {
    const leeway = leewayObjectId ? LEEWAY_OBJECT_TYPES.find((entry) => entry.id === leewayObjectId) : undefined;
    if (!leeway) {
      steps.push({ step: 'datum-ws1', status: 'error', detail: `Kategori leeway "${leewayObjectId ?? '(kosong)'}" tidak ditemukan di Tabel I-1/I-2 — pilih lewat planner.` });
    } else {
      assumptions.push({
        field: 'datum.leewayObjectId',
        value: leewayObjectId,
        reason: `Kategori leeway planner: ${leeway.label}`,
      });
      const datumInput: Ws1DatumInput = {
        lkp: landingPos,
        hours: aswResult.totalHours,
        seaCurrentDir: seeds.datum.seaCurrentDir ?? 0,
        seaCurrentSpeed: seeds.datum.seaCurrentSpeed ?? 0,
        windFrom: aswResult.aswDirFrom,
        windSpeed: aswResult.aswSpeed,
        leewayRate: leeway.leewayRate,
        leewayModifier: leeway.leewayModifier ?? 0,
        leewayDivergenceDeg: leeway.divergenceAngle,
        x: options.xNm ?? seeds.datum.X ?? 0,
        y: options.yNm ?? seeds.datum.Y ?? 0,
        searchNumber: searchNumber,
        fs: options.fs,
      };
      datumResult = computeDatumWs1(datumInput);
      output.datum = datumResult;
      output.searchArea = {
        dePercent: datumResult.dePercent,
        E: datumResult.E,
        fs: datumResult.fs,
        RUp: datumResult.RUp,
        aoSquareNm2: datumResult.areaSquareNM2,
      };
      steps.push({
        step: 'datum-ws1',
        status: datumResult.areaSquareNM2 > 0 ? 'ok' : 'error',
        detail: `Datum ${datumResult.datumB.lat.toFixed(5)}, ${datumResult.datumB.lng.toFixed(5)}; E=${datumResult.E.toFixed(2)} NM; R=${datumResult.RUp} NM; Ao=${datumResult.areaSquareNM2.toFixed(0)} NM²`,
        warnings: [...datumResult.warnings, ...datumResult.assumptions],
      });
    }
  } else {
    steps.push({ step: 'datum-ws1', status: 'error', detail: 'Prasyarat datum tidak terpenuhi (ASW total hours + posisi ditching + input arus).' });
  }

  const aoSquareNm2 = output.searchArea?.aoSquareNm2 ?? 0;

  // ── 5. WS 2 per lembar SRU udara ─────────────────────────────────────────
  const ws2Rows: Array<{ sruName?: string; result: WscPodRowResult }> = [];
  for (const sheet of seeds.ws2Sheets) {
    const data = sheet.data as W2SheetData;
    const row = computeW2Row({
      platform: data.searchPlatform ?? '',
      target: data.searchObject ?? '',
      heightFt: data.selectedHeight ?? 1000,
      visibilityIndex: data.visibilityIndex ?? -1,
      windKts: aswResult?.aswSpeed ?? 0,
      caseWindKts: data.caseWindSpeed,
      caseWaveHeightM: data.caseWaveHeightM,
      tasKts: data.searchTas ?? 0,
      fatigue: data.isFatigue ?? '',
      searchNumber,
      piwFlotationKnown: data.piwFlotationKnown,
      areaAoNm2: aoSquareNm2,
    });
    ws2Rows.push({ sruName: sheet.sruName ?? data.sruName, result: row });
  }
  if (seeds.ws2Sheets.length > 0) {
    output.ws2Rows = ws2Rows;
    const readyCount = ws2Rows.filter((entry) => entry.result.ready).length;
    steps.push({
      step: 'ws2-wsc-pod',
      status: readyCount > 0 ? 'ok' : 'error',
      detail: `${readyCount}/${ws2Rows.length} lembar siap (W, S, C, POD)`,
    });
  }

  // ── 6. WS 8 per lembar SRU laut ──────────────────────────────────────────
  const ws8Rows: Array<{ sruName?: string; result: WscPodRowResult }> = [];
  for (const sheet of seeds.ws8Sheets) {
    const data = sheet.data as W8SheetData;
    const row = computeW8Row({
      target: data.searchObject ?? '',
      eyeHeight: data.eyeHeight ?? '',
      visibilityKm: data.visibilityKm ?? '',
      windKts: aswResult?.aswSpeed ?? 0,
      caseWindKts: data.caseWindSpeed,
      caseWaveHeightM: data.caseWaveHeightM,
      fatigue: data.isFatigue ?? '',
      searchNumber,
      vesselSpeedKts: data.vesselSpeedKts ?? 0,
      areaAoNm2: aoSquareNm2,
    });
    ws8Rows.push({ sruName: sheet.sruName ?? data.sruName, result: row });
  }
  if (seeds.ws8Sheets.length > 0) {
    output.ws8Rows = ws8Rows;
    const readyCount = ws8Rows.filter((entry) => entry.result.ready).length;
    steps.push({
      step: 'ws8-wsc-pod',
      status: readyCount > 0 ? 'ok' : 'error',
      detail: `${readyCount}/${ws8Rows.length} lembar siap (W, S, C, POD)`,
    });
  }

  // ── 7. Search Pattern / CSP ──────────────────────────────────────────────
  let patternResult: SearchPatternResult | undefined;
  if (datumResult && aoSquareNm2 > 0 && landingPos) {
    const center = { lat: datumResult.datumB.lat, lng: datumResult.datumB.lng };
    const sideNm = Math.sqrt(aoSquareNm2); // sisi persegi = 2R
    const orientationDeg = options.patternOrientationDeg ?? bearingDeg(landingPos, center);
    const firstReadyS = [...ws2Rows, ...ws8Rows].find((entry) => entry.result.ready && entry.result.S > 0)?.result.S;
    let trackSpacingNm = options.trackSpacingNm ?? firstReadyS ?? 0;
    // Guard aditif (Fase 5a): bila S dari lembar worksheet > setengah sisi area,
    // pola PS/CS hanya punya 1 leg dengan panjang leg 0 (degenerate). Kurangi S
    // ke setengah sisi agar pola punya minimal 2 leg — catat sebagai asumsi
    // planner. Override eksplisit planner (options.trackSpacingNm) tetap
    // dihormati tanpa perubahan.
    if (options.trackSpacingNm === undefined && sideNm > 0 && trackSpacingNm > sideNm / 2) {
      assumptions.push({
        field: 'pattern.trackSpacingNm',
        value: (sideNm / 2).toFixed(2),
        reason: `S (${trackSpacingNm.toFixed(2)} NM) dikurangi ke setengah sisi area (${(sideNm / 2).toFixed(2)} NM) agar pola memiliki minimal 2 leg (pilihan planner).`,
      });
      trackSpacingNm = sideNm / 2;
    }
    if (trackSpacingNm <= 0) {
      steps.push({ step: 'search-pattern', status: 'skipped', detail: 'Track spacing (S) belum tersedia dari lembar WS 2/WS 8 — pola tidak dibuat.' });
    } else if (trackSpacingNm * 2 > sideNm) {
      steps.push({ step: 'search-pattern', status: 'error', detail: `S (${trackSpacingNm.toFixed(2)} NM) melebihi setengah sisi area — pola degenerate; atur S manual via planner.` });
    } else {
      const patternType: SearchPatternType = options.patternType ?? seeds.pattern?.patternType ?? 'PS';
      const sruSpeedKts = options.sruSpeedKts ?? seeds.assets.find((asset) => asset.searchSpeedKts > 0)?.searchSpeedKts ?? 15;
      const raw = generateSearchPattern({
        type: patternType,
        center,
        lengthNm: sideNm,
        widthNm: sideNm,
        orientationDeg,
        trackSpacingNm,
        turnDirection: seeds.pattern?.turnDirection ?? 'right',
      }, sruSpeedKts);
      patternResult = clipSearchPatternToSquare(raw, center, sideNm, orientationDeg);
      output.pattern = patternResult;
      assumptions.push({ field: 'pattern.trackSpacingNm', value: String(trackSpacingNm), reason: 'S pola dari lembar WS 2/WS 8 pertama yang ready (aturan worksheet source).' });
      steps.push({
        step: 'search-pattern',
        status: patternResult.totalDistanceNm > 0 ? 'ok' : 'error',
        detail: `${patternResult.code}: CSP ${patternResult.csp.lat.toFixed(5)}, ${patternResult.csp.lng.toFixed(5)}; jarak ${patternResult.totalDistanceNm.toFixed(1)} NM; S=${trackSpacingNm} NM`,
      });
    }
  } else {
    steps.push({ step: 'search-pattern', status: 'skipped', detail: 'Search area (Ao) belum tersedia — pola tidak dibuat.' });
  }

  // ── 8. Alokasi Aset ──────────────────────────────────────────────────────
  if (patternResult && aoSquareNm2 > 0 && seeds.assets.length > 0) {
    const spacingBySru = new Map<string, number>();
    for (const entry of [...ws2Rows, ...ws8Rows]) {
      if (entry.sruName && entry.result.ready && entry.result.S > 0) {
        spacingBySru.set(entry.sruName, entry.result.S);
      }
    }
    const allocationAssets: SruAssetInput[] = seeds.assets.map((asset) => ({
      ...asset,
      sweepWidthNm: spacingBySru.get(asset.name) ?? asset.sweepWidthNm,
    }));
    const allocation = calculateAssetAllocationSummary(allocationAssets, patternResult.csp, patternResult.exitPoint, aoSquareNm2);
    output.allocation = allocation;
    steps.push({
      step: 'asset-allocation',
      status: allocation.perAsset.length > 0 ? 'ok' : 'error',
      detail: `Coverage ${(allocation.coverageRatio * 100).toFixed(0)}% dari Ao ${aoSquareNm2.toFixed(0)} NM²`,
    });
  } else {
    steps.push({ step: 'asset-allocation', status: 'skipped', detail: 'CSP/Ao/aset belum tersedia — alokasi tidak dihitung.' });
  }

  output.ok = steps.every((step) => step.status !== 'error');
  return output;
}

/** Bangun observasi ASW dari seed (payload handleApplyASW) memakai fungsi
 *  `buildAswObservationsFromCase` yang sama dengan worksheet. */
function buildObservationsFromSeed(aswSeed: NonNullable<CaseWorksheetSeeds['asw']>): ASWObservation[] {
  return buildAswObservationsFromCase(
    aswSeed.distressTime,
    aswSeed.datumTime,
    aswSeed.intervalMode,
    aswSeed.windData,
  );
}
