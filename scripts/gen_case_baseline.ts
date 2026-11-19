/**
 * Generator nilai baseline regresi (Fase 1) — menjalankan fungsi kalkulasi
 * lib dengan input tetap (dari fixture PK-TAL) dan mencetak hasil untuk
 * ditempel ke tests/regressionBaseline.test.ts.
 *
 * PENTING: nilai yang dicetak adalah PERILAKU SAAT INI (baseline), bukan kunci
 * jawaban resmi. Tujuannya menjaga refactor (mis. dedup ASW, satukan koreksi
 * cuaca) tidak mengubah hasil — bukan memvalidasi kebenaran SAR.
 * Jalankan: bun scripts/gen_case_baseline.ts
 */
import {
  computeASW,
  computeAWA,
  parseAltitudeFt,
} from '../src/lib/sar/sarCalculations';
import { calculateAeroDrift, convertHeadingToTrue, type AeroDriftInput } from '../src/lib/sar/aeroDriftCalculations';
import { computeDatumWs1 } from '../src/lib/sar/datumWs1';
import { computeW2Row, computeW8Row, computePOD } from '../src/lib/sar/wscPodTables';
import { buildAswObservationsFromCase } from '../src/lib/sar/aswTime';
import { generateSearchPattern, clipSearchPatternToSquare } from '../src/lib/sar/searchPatterns';
import pkTalJson from '../tests/golden/pk-tal.case.json';

type CaseJson = typeof pkTalJson;
const kasus = pkTalJson as CaseJson;

const LEEWAY_RATE = 0.037;      // raft-aviation-46 (Tabel I-1, VERIFIED)
const LEEWAY_MODIFIER = 0.11;
const LEEWAY_DIVERGENCE = 24;

// ── AWA ──
const awaObs = (kasus.aeroDrift.windLayers ?? []).map((layer) => ({
  altObs: layer.altitudeLabel ?? String(layer.altitudeFt),
  windDirFrom: layer.windDirFrom,
  windSpeed: layer.windSpeedKts,
}));
const awa = computeAWA(awaObs.map((o) => ({ altObs: o.altObs, windDirFrom: o.windDirFrom, windSpeed: o.windSpeed })), 20000);

// ── ASW ──
const windEntries = (kasus.sea.surfaceWindSeries ?? []).map((entry) => ({
  obsTime: entry.obsTime,
  windDirFrom: entry.windDirFrom,
  windSpeed: entry.windSpeedKts,
}));
const aswObservations = buildAswObservationsFromCase(
  kasus.incident.lastContactTime ?? '',
  kasus.search.datumTime ?? '',
  '6h',
  windEntries,
);
const asw = computeASW(aswObservations);

// ── ADW (ditching) ──
const lkp = kasus.lkp.coord;
const aeroInput: AeroDriftInput = {
  caseTitle: 'baseline',
  caseNumber: 'PK-TAL',
  date: '19 November 2026',
  plannerName: '',
  searchObject: 'Cessna 208 Caravan',
  incidentPos: { lat: lkp.lat, lng: lkp.lng },
  incidentTime: '18 November 2026 13.50 WIB',
  useAircraftGlide: true,
  aircraftAltMaxFt: 20000,
  aircraftAltMinFt: 0,
  aircraftGlideRatio: 6,
  aircraftTASgKts: 121,
  aircraftDescentHeadingDeg: 103,
  aircraftHeadingReference: 'magnetic',
  magneticVariationDeg: 1,
  magneticVariationDirection: 'E',
  aircraftDeviationDeg: 0,
  aircraftDeviationDirection: 'E',
  parachuteDeviationDeg: 0,
  parachuteDeviationDirection: 'E',
  useParachute: false,
  parachuteType: 'round-zero-glide',
  parachuteAltMaxFt: 0,
  parachuteTerrainAltFt: 0,
  parachuteRateOfDescentFtMin: 0,
  parachuteHeadingReference: 'true',
  awaIsValid: awa.isValid,
  awaGlideDirFrom: awa.awaDirFrom,
  awaGlideSpeedKts: awa.awaSpeed,
  fixErrorXNm: 0,
  safetyFactorFs: 1.1,
};
const aero = calculateAeroDrift(aeroInput);

// ── Datum WS 1 ──
const datum = computeDatumWs1({
  lkp: aero.landingPos,
  hours: asw.totalHours,
  seaCurrentDir: 250,
  seaCurrentSpeed: 0.3,
  windFrom: asw.aswDirFrom,
  windSpeed: asw.aswSpeed,
  leewayRate: LEEWAY_RATE,
  leewayModifier: LEEWAY_MODIFIER,
  leewayDivergenceDeg: LEEWAY_DIVERGENCE,
  x: 0,
  y: 0,
  searchNumber: 3,
});

// ── WS 2 (HR-3604) & WS 8 (Drupada) ──
const ws2 = computeW2Row({
  platform: 'helicopter',
  target: 'raft6',
  heightFt: 1000,
  visibilityIndex: 2,
  windKts: asw.aswSpeed,
  caseWindKts: 20,
  tasKts: 90,
  fatigue: 'No',
  searchNumber: 3,
  areaAoNm2: datum.areaSquareNM2,
});
const ws8 = computeW8Row({
  target: 'raft6',
  eyeHeight: '14',
  visibilityKm: '20',
  windKts: asw.aswSpeed,
  caseWindKts: 20,
  fatigue: 'No',
  searchNumber: 3,
  vesselSpeedKts: 15,
  areaAoNm2: datum.areaSquareNM2,
});

// ── Search Pattern PS tetap ──
const rawPattern = generateSearchPattern({
  type: 'PS',
  center: { lat: datum.datumB.lat, lng: datum.datumB.lng },
  lengthNm: Math.sqrt(datum.areaSquareNM2),
  widthNm: Math.sqrt(datum.areaSquareNM2),
  orientationDeg: 293,
  trackSpacingNm: ws2.S,
  turnDirection: 'right',
}, 90);
const pattern = clipSearchPatternToSquare(rawPattern, { lat: datum.datumB.lat, lng: datum.datumB.lng }, Math.sqrt(datum.areaSquareNM2), 293);

const EXPECTED = {
  parseAltitudeFt: {
    surface: parseAltitudeFt('Surface'),
    fl200: parseAltitudeFt('FL200'),
    feet: parseAltitudeFt('3.000 ft'),
  },
  convertHeadingToTrue: {
    magneticE: convertHeadingToTrue(103, 'magnetic', 1, 'E'),
    magneticW: convertHeadingToTrue(103, 'magnetic', 1, 'W'),
    true: convertHeadingToTrue(103, 'true'),
  },
  awa: { dir: awa.awaDirFrom, speed: awa.awaSpeed, valid: awa.isValid, totalAltKft: awa.totalAltLossKft },
  asw: { dir: asw.aswDirFrom, speed: asw.aswSpeed, totalHours: asw.totalHours, rows: aswObservations.length },
  aero: {
    landingPos: { lat: aero.landingPos.lat, lng: aero.landingPos.lng },
    totalDisplacementNm: aero.totalDisplacementNm,
    aircraftRateOfDescentFtMin: aero.aircraftRateOfDescentFtMin,
    aircraftTimeOfDescentMin: aero.aircraftTimeOfDescentMin,
    aircraftGlideDistanceNm: aero.aircraftGlideDistanceNm,
  },
  datum: {
    datumB: { lat: datum.datumB.lat, lng: datum.datumB.lng },
    De: datum.De,
    E: datum.E,
    RUp: datum.RUp,
    areaSquareNM2: datum.areaSquareNM2,
    areaCircleNM2: datum.areaCircleNM2,
    fs: datum.fs,
    bearingAB: datum.bearingAB,
    distanceAB: datum.distanceAB,
  },
  ws2: { Wu: ws2.Wu, fw: ws2.fw, fs: ws2.fs, W: ws2.W, S: ws2.S, C: ws2.C, POD: ws2.POD, T: ws2.T },
  ws8: { Wu: ws8.Wu, fw: ws8.fw, W: ws8.W, S: ws8.S, C: ws8.C, POD: ws8.POD, T: ws8.T },
  podSample: computePOD(1.0, 1),
  pattern: {
    csp: { lat: pattern.csp.lat, lng: pattern.csp.lng },
    exitPoint: { lat: pattern.exitPoint.lat, lng: pattern.exitPoint.lng },
    totalDistanceNm: pattern.totalDistanceNm,
    waypointCount: pattern.waypoints.length,
  },
};

console.log(JSON.stringify(EXPECTED, null, 2));
