/**
 * BASELINE REGRESI KALKULATOR (Fase 1 AI Copilot).
 *
 * Nilai di bawah adalah PERILAKU SAAT INI dari fungsi lib (dibangkitkan oleh
 * scripts/gen_case_baseline.ts pada commit Fase 1 dengan input fixture
 * PK-TAL). TUJUANNYA: refactor di belakang hari (dedup ASW, satukan koreksi
 * cuaca, dsb.) TIDAK BOLEH mengubah nilai-nilai ini tanpa keputusan eksplisit.
 *
 * BUKAN kunci jawaban resmi SAR — kebenaran fisis dilindungi test acceptance
 * yang sudah ada (mis. phase10_datumWs1.test.ts) + kunci instruktur di
 * tests/golden (TODO: expected values from instructor key).
 *
 * Jalankan: bun test tests/regressionBaseline.test.ts
 * Regenerasi baseline (hanya bila perilaku sengaja diubah):
 *   bun scripts/gen_case_baseline.ts  → perbarui EXPECTED di file ini.
 */
import { describe, expect, it } from 'bun:test';
import { computeASW, computeAWA, parseAltitudeFt, type ASWObservation } from '../src/lib/sar/sarCalculations';
import { calculateAeroDrift, convertHeadingToTrue, type AeroDriftInput } from '../src/lib/sar/aeroDriftCalculations';
import { computeDatumWs1 } from '../src/lib/sar/datumWs1';
import { computeW2Row, computeW8Row, computePOD } from '../src/lib/sar/wscPodTables';
import { buildAswObservationsFromCase } from '../src/lib/sar/aswTime';

/** Baseline perilaku saat ini (commit Fase 1). JANGAN ubah angkanya manual. */
const EXPECTED = {
  parseAltitudeFt: {
    surface: 0,
    fl200: 20000,
    feet: 3000,
  },
  convertHeadingToTrue: {
    magneticE: 104,
    magneticW: 102,
    true: 103,
  },
  awa: {
    dir: 76.58766341428422,
    speed: 12.627921431433007,
    totalAltKft: 20,
  },
  asw: {
    dir: 94.73558118214856,
    speed: 8.80533453008098,
    totalHours: 17.2,
    rows: 4,
  },
  aero: {
    landingPos: { lat: -6.967129558387526, lng: 105.55005299505297 },
    totalDisplacementNm: 17.992604744149983,
    aircraftRateOfDescentFtMin: 2036.8333333333333,
    aircraftTimeOfDescentMin: 9.819163734555275,
    aircraftGlideDistanceNm: 19.801980198019805,
  },
  datum: {
    datumB: { lat: -6.979581121085076, lng: 105.26300078076076 },
    De: 5.222378412324478,
    E: 5.222378412324478,
    RUp: 11,
    areaSquareNM2: 484,
    areaCircleNM2: 380.1327110843649,
    fs: 2,
    bearingAB: 267.48031158928785,
    distanceAB: 17.12360669174266,
  },
  ws2: { Wu: 2, fw: 0.5, fs: 1, W: 1, S: 1, C: 1, POD: 99.28969999999998, T: 5.377777777777778 },
  ws8: { Wu: 5, fw: 0.5, W: 2.5, S: 2.5, C: 1, POD: 99.28969999999998, T: 12.9 },
  podSample: 0.789479,
  pattern: {
    csp: { lat: -7.208859329615372, lng: 105.35639728466288 },
    exitPoint: { lat: -6.884462895038376, lng: 105.49500202772435 },
    totalDistanceNm: 482.999999999988,
    waypointCount: 44,
  },
};

// ── Input tetap (identik dengan scripts/gen_case_baseline.ts) ─────────────
const awaObs = [
  { altObs: 'Surface', windDirFrom: 45, windSpeed: 5 },
  { altObs: '3000 Feet', windDirFrom: 55, windSpeed: 10 },
  { altObs: '6000 Feet', windDirFrom: 65, windSpeed: 15 },
  { altObs: '9000 Feet', windDirFrom: 75, windSpeed: 20 },
  { altObs: '12000 Feet', windDirFrom: 85, windSpeed: 15 },
  { altObs: '18000 Feet', windDirFrom: 95, windSpeed: 10 },
  { altObs: '24000 Feet', windDirFrom: 105, windSpeed: 20 },
];

const windEntries = [
  { obsTime: '18 November 2026 00.00 WIB', windDirFrom: 50, windSpeed: 5 },
  { obsTime: '18 November 2026 06.00 WIB', windDirFrom: 69, windSpeed: 10 },
  { obsTime: '18 November 2026 12.00 WIB', windDirFrom: 80, windSpeed: 12 },
  { obsTime: '18 November 2026 18.00 WIB', windDirFrom: 96, windSpeed: 10 },
  { obsTime: '19 November 2026 00.00 WIB', windDirFrom: 102, windSpeed: 7 },
  { obsTime: '19 November 2026 06.00 WIB', windDirFrom: 90, windSpeed: 9 },
];

const aeroInput: AeroDriftInput = {
  caseTitle: 'baseline',
  caseNumber: 'PK-TAL',
  date: '19 November 2026',
  plannerName: '',
  searchObject: 'Cessna 208 Caravan',
  incidentPos: { lat: -6.879444, lng: 105.261389 },
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
  awaIsValid: true,
  awaGlideDirFrom: EXPECTED.awa.dir,
  awaGlideSpeedKts: EXPECTED.awa.speed,
  fixErrorXNm: 0,
  safetyFactorFs: 1.1,
};

const close = (actual: number, expected: number, epsilon = 1e-9) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon);

describe('Baseline regresi: konversi & utilitas', () => {
  it('parseAltitudeFt memahami Surface / FL / format ribuan', () => {
    expect(parseAltitudeFt('Surface')).toBe(EXPECTED.parseAltitudeFt.surface);
    expect(parseAltitudeFt('FL200')).toBe(EXPECTED.parseAltitudeFt.fl200);
    expect(parseAltitudeFt('3.000 ft')).toBe(EXPECTED.parseAltitudeFt.feet);
  });

  it('convertHeadingToTrue: variation E ditambah, W dikurangi (konvensi app)', () => {
    expect(convertHeadingToTrue(103, 'magnetic', 1, 'E')).toBe(EXPECTED.convertHeadingToTrue.magneticE);
    expect(convertHeadingToTrue(103, 'magnetic', 1, 'W')).toBe(EXPECTED.convertHeadingToTrue.magneticW);
    expect(convertHeadingToTrue(103, 'true')).toBe(EXPECTED.convertHeadingToTrue.true);
  });
});

describe('Baseline regresi: AWA (K-10)', () => {
  const awa = computeAWA(awaObs, 20000);
  it('arah & kecepatan AWA tidak berubah', () => {
    expect(awa.isValid).toBe(true);
    close(awa.awaDirFrom, EXPECTED.awa.dir);
    close(awa.awaSpeed, EXPECTED.awa.speed);
    close(awa.totalAltLossKft, EXPECTED.awa.totalAltKft);
  });
});

describe('Baseline regresi: ASW (K-19)', () => {
  const observations: ASWObservation[] = buildAswObservationsFromCase(
    '18 November 2026 13.50 WIB',
    '19 November 2026 07.00 WIB',
    '6h',
    windEntries,
  );
  const asw = computeASW(observations);
  it('baris window, total hours (D), arah & kecepatan tidak berubah', () => {
    expect(observations.length).toBe(EXPECTED.asw.rows);
    close(asw.totalHours, EXPECTED.asw.totalHours);
    close(asw.aswDirFrom, EXPECTED.asw.dir);
    close(asw.aswSpeed, EXPECTED.asw.speed);
  });
});

describe('Baseline regresi: Aeronautical Drift (K-6)', () => {
  const awa = computeAWA(awaObs, 20000);
  const input = { ...aeroInput, awaIsValid: awa.isValid, awaGlideDirFrom: awa.awaDirFrom, awaGlideSpeedKts: awa.awaSpeed };
  const aero = calculateAeroDrift(input);
  it('posisi ditching & rantai penerbangan tidak berubah', () => {
    expect(aero.positionValid).toBe(true);
    close(aero.landingPos.lat, EXPECTED.aero.landingPos.lat);
    close(aero.landingPos.lng, EXPECTED.aero.landingPos.lng);
    close(aero.totalDisplacementNm, EXPECTED.aero.totalDisplacementNm);
    close(aero.aircraftRateOfDescentFtMin, EXPECTED.aero.aircraftRateOfDescentFtMin);
    close(aero.aircraftTimeOfDescentMin, EXPECTED.aero.aircraftTimeOfDescentMin);
    close(aero.aircraftGlideDistanceNm, EXPECTED.aero.aircraftGlideDistanceNm);
  });
});

describe('Baseline regresi: Datum WS 1 (De, E, R, Ao)', () => {
  const awa = computeAWA(awaObs, 20000);
  const aero = calculateAeroDrift({ ...aeroInput, awaIsValid: awa.isValid, awaGlideDirFrom: awa.awaDirFrom, awaGlideSpeedKts: awa.awaSpeed });
  const asw = computeASW(buildAswObservationsFromCase('18 November 2026 13.50 WIB', '19 November 2026 07.00 WIB', '6h', windEntries));
  // raft-aviation-46 (Tabel I-1, VERIFIED): rate 0.037, modifier 0.11, divergensi 24°
  const datum = computeDatumWs1({
    lkp: aero.landingPos,
    hours: asw.totalHours,
    seaCurrentDir: 250,
    seaCurrentSpeed: 0.3,
    windFrom: asw.aswDirFrom,
    windSpeed: asw.aswSpeed,
    leewayRate: 0.037,
    leewayModifier: 0.11,
    leewayDivergenceDeg: 24,
    x: 0,
    y: 0,
    searchNumber: 3,
  });
  it('datum, De, E, R, luas persegi & lingkaran tidak berubah', () => {
    close(datum.datumB.lat, EXPECTED.datum.datumB.lat);
    close(datum.datumB.lng, EXPECTED.datum.datumB.lng);
    close(datum.De, EXPECTED.datum.De);
    close(datum.E, EXPECTED.datum.E);
    expect(datum.RUp).toBe(EXPECTED.datum.RUp);
    expect(datum.fs).toBe(EXPECTED.datum.fs);
    close(datum.areaSquareNM2, EXPECTED.datum.areaSquareNM2);
    close(datum.areaCircleNM2, EXPECTED.datum.areaCircleNM2);
    close(datum.bearingAB, EXPECTED.datum.bearingAB);
    close(datum.distanceAB, EXPECTED.datum.distanceAB);
  });
});

describe('Baseline regresi: WS 2 / WS 8 (W, S, C, POD, T)', () => {
  const awa = computeAWA(awaObs, 20000);
  const aero = calculateAeroDrift({ ...aeroInput, awaIsValid: awa.isValid, awaGlideDirFrom: awa.awaDirFrom, awaGlideSpeedKts: awa.awaSpeed });
  const asw = computeASW(buildAswObservationsFromCase('18 November 2026 13.50 WIB', '19 November 2026 07.00 WIB', '6h', windEntries));
  const datum = computeDatumWs1({
    lkp: aero.landingPos,
    hours: asw.totalHours,
    seaCurrentDir: 250,
    seaCurrentSpeed: 0.3,
    windFrom: asw.aswDirFrom,
    windSpeed: asw.aswSpeed,
    leewayRate: 0.037,
    leewayModifier: 0.11,
    leewayDivergenceDeg: 24,
    x: 0,
    y: 0,
    searchNumber: 3,
  });
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

  it('WS 2 helikopter raft6 @1000 ft vis 10 km tidak berubah', () => {
    expect(ws2.ready).toBe(true);
    close(ws2.Wu, EXPECTED.ws2.Wu);
    close(ws2.fw, EXPECTED.ws2.fw);
    close(ws2.fs, EXPECTED.ws2.fs);
    close(ws2.W, EXPECTED.ws2.W);
    close(ws2.S, EXPECTED.ws2.S);
    close(ws2.C, EXPECTED.ws2.C);
    close(ws2.POD, EXPECTED.ws2.POD, 1e-8);
    close(ws2.T, EXPECTED.ws2.T);
  });

  it('WS 8 kapal raft6 eye 14 vis 20 km tidak berubah', () => {
    expect(ws8.ready).toBe(true);
    close(ws8.Wu, EXPECTED.ws8.Wu);
    close(ws8.fw, EXPECTED.ws8.fw);
    close(ws8.W, EXPECTED.ws8.W);
    close(ws8.S, EXPECTED.ws8.S);
    close(ws8.C, EXPECTED.ws8.C);
    close(ws8.POD, EXPECTED.ws8.POD, 1e-8);
    close(ws8.T, EXPECTED.ws8.T);
  });

  it('POD polinomial (C=1, pencarian ke-1) tidak berubah', () => {
    close(computePOD(1.0, 1), EXPECTED.podSample, 1e-12);
  });
});

describe('Baseline regresi: Search Pattern PS + clip area', () => {
  it('CSP, exit point, jumlah waypoint & jarak total tidak berubah', async () => {
    const { generateSearchPattern, clipSearchPatternToSquare } = await import('../src/lib/sar/searchPatterns');
    const center = { lat: EXPECTED.datum.datumB.lat, lng: EXPECTED.datum.datumB.lng };
    const sideNm = Math.sqrt(EXPECTED.datum.areaSquareNM2);
    const raw = generateSearchPattern({
      type: 'PS',
      center,
      lengthNm: sideNm,
      widthNm: sideNm,
      orientationDeg: 293,
      trackSpacingNm: EXPECTED.ws2.S,
      turnDirection: 'right',
    }, 90);
    const clipped = clipSearchPatternToSquare(raw, center, sideNm, 293);
    close(clipped.csp.lat, EXPECTED.pattern.csp.lat);
    close(clipped.csp.lng, EXPECTED.pattern.csp.lng);
    close(clipped.exitPoint.lat, EXPECTED.pattern.exitPoint.lat);
    close(clipped.exitPoint.lng, EXPECTED.pattern.exitPoint.lng);
    close(clipped.totalDistanceNm, EXPECTED.pattern.totalDistanceNm, 1e-6);
    expect(clipped.waypoints.length).toBe(EXPECTED.pattern.waypointCount);
  });
});
