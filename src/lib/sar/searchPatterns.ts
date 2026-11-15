/**
 * IAMSAR Vol II Chapter 5 & Basarnas Search Patterns Generator
 * Generates exact coordinate waypoints and track segments for:
 * - PS: Parallel Track Search (Pola Paralel)
 * - CS: Creeping Line Search (Pola Merayap)
 * - SS: Expanding Square Search (Pola Kotak Membesar)
 * - VS: Sector Search (Pola Sektor)
 * - TS: Track Line Search (Pola Garis Haluan)
 */

import { type LatLng, project, distanceNm } from './sarCalculations';

export type SearchPatternType = 'PS' | 'CS' | 'SS' | 'VS' | 'TS';

export interface SearchPatternParams {
  type: SearchPatternType;
  center: LatLng;
  lengthNm: number; // Dimension along major orientation
  widthNm: number;  // Dimension perpendicular to major orientation
  orientationDeg: number; // Major axis orientation (0-360)
  trackSpacingNm: number; // S (Track spacing)
  turnDirection?: 'right' | 'left'; // For SS and VS
  tsReturn?: boolean; // For TS: return track?
}

export interface SearchPatternResult {
  type: SearchPatternType;
  name: string;
  code: string;
  csp: LatLng;          // Commence Search Point
  exitPoint: LatLng;    // Exit Point / Titik Akhir Pencarian
  waypoints: LatLng[];  // Sequence of track turns
  segments: { from: LatLng; to: LatLng; legIndex: number; distanceNm: number }[];
  totalDistanceNm: number;
  estimatedHours: number; // Based on SRU speed
  description: string;
}

/**
 * Generate coordinates for Search Patterns
 */
export function generateSearchPattern(
  params: SearchPatternParams,
  sruSpeedKts: number = 15
): SearchPatternResult {
  const S = Math.max(0.1, params.trackSpacingNm || 1.0);
  const L = Math.max(S * 2, params.lengthNm || 10.0);
  const W = Math.max(S * 2, params.widthNm || 8.0);
  const orient = ((params.orientationDeg % 360) + 360) % 360;

  switch (params.type) {
    case 'PS':
      return generateParallelSearch(params.center, L, W, orient, S, sruSpeedKts);
    case 'CS':
      return generateCreepingLineSearch(params.center, L, W, orient, S, sruSpeedKts);
    case 'SS':
      return generateExpandingSquareSearch(params.center, S, orient, params.turnDirection || 'right', sruSpeedKts);
    case 'VS':
      return generateSectorSearch(params.center, Math.max(1, W / 2), orient, params.turnDirection || 'right', sruSpeedKts);
    case 'TS':
      return generateTrackLineSearch(params.center, L, orient, S, params.tsReturn ?? false, sruSpeedKts);
    default:
      return generateParallelSearch(params.center, L, W, orient, S, sruSpeedKts);
  }
}

/**
 * PS: Parallel Track Search
 * Long legs parallel to the major axis (L).
 * Starts at corner (CSP), offset S/2 from the border.
 */
function generateParallelSearch(
  center: LatLng,
  lengthNm: number,
  widthNm: number,
  orientationDeg: number,
  S: number,
  speedKts: number
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const halfL = lengthNm / 2;
  const halfW = widthNm / 2;

  // Directions
  const dirMajor = orientationDeg;
  const dirMajorRev = (dirMajor + 180) % 360;
  const dirCross = (dirMajor + 90) % 360;
  const dirCrossRev = (dirMajor + 270) % 360;

  // Corner reference: start at Top-Left corner of search box
  // Corner = Center projected halfW along dirCrossRev, then halfL along dirMajorRev
  const p1 = project(center, dirCrossRev, halfW - S / 2);
  const csp = project(p1, dirMajorRev, halfL - S / 2);

  let currentPoint = csp;
  waypoints.push(currentPoint);

  const numLegs = Math.max(2, Math.floor(widthNm / S));
  const legDistance = lengthNm - S;

  for (let i = 0; i < numLegs; i++) {
    // Search leg along major axis
    const legDir = i % 2 === 0 ? dirMajor : dirMajorRev;
    const nextPoint = project(currentPoint, legDir, legDistance);
    waypoints.push(nextPoint);
    currentPoint = nextPoint;

    // Cross leg (step S across) if not the last leg
    if (i < numLegs - 1) {
      const crossPoint = project(currentPoint, dirCross, S);
      waypoints.push(crossPoint);
      currentPoint = crossPoint;
    }
  }

  const exitPoint = waypoints[waypoints.length - 1];
  const { segments, totalDistanceNm } = buildSegments(waypoints);

  return {
    type: 'PS',
    name: 'Parallel Track Search',
    code: 'PS (Single Unit)',
    csp,
    exitPoint,
    waypoints,
    segments,
    totalDistanceNm,
    estimatedHours: totalDistanceNm / Math.max(1, speedKts),
    description: `Pola Paralel (PS): ${numLegs} sapuan sejajar sumbu utama (${orientationDeg.toFixed(0)}°), spasi S = ${S.toFixed(1)} NM. Digunakan untuk area pencarian luas berbentuk persegi panjang dengan kemungkinan posisi target tersebar merata.`,
  };
}

/**
 * CS: Creeping Line Search
 * Search legs are along the minor axis (cross-axis W), creeping along the major axis L.
 */
function generateCreepingLineSearch(
  center: LatLng,
  lengthNm: number,
  widthNm: number,
  orientationDeg: number,
  S: number,
  speedKts: number
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const halfL = lengthNm / 2;
  const halfW = widthNm / 2;

  // Directions
  const dirMajor = orientationDeg;
  const dirCross = (dirMajor + 90) % 360;
  const dirCrossRev = (dirMajor + 270) % 360;

  // CSP: Offset S/2 from the starting end of major axis and side of cross axis
  const p1 = project(center, (dirMajor + 180) % 360, halfL - S / 2);
  const csp = project(p1, dirCrossRev, halfW - S / 2);

  let currentPoint = csp;
  waypoints.push(currentPoint);

  const numLegs = Math.max(2, Math.floor(lengthNm / S));
  const legDistance = widthNm - S;

  for (let i = 0; i < numLegs; i++) {
    // Cross leg across width
    const legDir = i % 2 === 0 ? dirCross : dirCrossRev;
    const nextPoint = project(currentPoint, legDir, legDistance);
    waypoints.push(nextPoint);
    currentPoint = nextPoint;

    // Step S along major axis
    if (i < numLegs - 1) {
      const advancePoint = project(currentPoint, dirMajor, S);
      waypoints.push(advancePoint);
      currentPoint = advancePoint;
    }
  }

  const exitPoint = waypoints[waypoints.length - 1];
  const { segments, totalDistanceNm } = buildSegments(waypoints);

  return {
    type: 'CS',
    name: 'Creeping Line Search',
    code: 'CS (Single Unit)',
    csp,
    exitPoint,
    waypoints,
    segments,
    totalDistanceNm,
    estimatedHours: totalDistanceNm / Math.max(1, speedKts),
    description: `Pola Merayap (CS): ${numLegs} sapuan tegak lurus sumbu utama (${orientationDeg.toFixed(0)}°), spasi S = ${S.toFixed(1)} NM. Digunakan bila target kemungkinan besar berada di dekat garis haluan atau datum memanjang dan salah satu ujung area pencarian memiliki prioritas lebih tinggi.`,
  };
}

/**
 * SS: Expanding Square Search
 * Starts at Datum (CSP).
 * Legs: 1S, 1S, 2S, 2S, 3S, 3S, 4S, 4S, 5S, 5S... with 90° turns.
 */
function generateExpandingSquareSearch(
  center: LatLng,
  S: number,
  orientationDeg: number,
  turn: 'right' | 'left',
  speedKts: number
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const csp = center; // Begins directly on Datum
  waypoints.push(csp);

  let currentPoint = csp;
  let currentDir = orientationDeg;
  const turnDeg = turn === 'right' ? 90 : 270;

  // Typically 5-6 rounds (legs 1S, 1S, 2S, 2S, 3S, 3S, 4S, 4S)
  const legMultipliers = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];

  for (let i = 0; i < legMultipliers.length; i++) {
    const legDist = legMultipliers[i] * S;
    const nextPoint = project(currentPoint, currentDir, legDist);
    waypoints.push(nextPoint);
    currentPoint = nextPoint;
    currentDir = (currentDir + turnDeg) % 360;
  }

  const exitPoint = waypoints[waypoints.length - 1];
  const { segments, totalDistanceNm } = buildSegments(waypoints);

  return {
    type: 'SS',
    name: 'Expanding Square Search',
    code: 'SS (Single Unit)',
    csp,
    exitPoint,
    waypoints,
    segments,
    totalDistanceNm,
    estimatedHours: totalDistanceNm / Math.max(1, speedKts),
    description: `Pola Kotak Membesar (SS): Mulai dari Datum/CSP dengan belokan 90° ke ${turn === 'right' ? 'kanan' : 'kiri'}. Panjang kaki: 1S, 1S, 2S, 2S, 3S, 3S... Cocok untuk posisi target yang diketahui secara akurat di area kecil dan probabilitas tinggi di dekat datum.`,
  };
}

/**
 * VS: Sector Search
 * Radius R from Datum.
 * Starts at center, flies/steers to edge distance R, turns 120°, crosses through center,
 * repeats 3 triangles (9 legs total, 60° sectors, 3 passes through datum).
 */
function generateSectorSearch(
  center: LatLng,
  radiusNm: number,
  orientationDeg: number,
  turn: 'right' | 'left',
  speedKts: number
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const csp = center;
  waypoints.push(csp);

  const R = Math.max(0.5, radiusNm);
  const turnAngle = turn === 'right' ? 120 : 240;
  let currentDir = orientationDeg;

  let currentPoint = csp;

  // 3 triangles = 9 legs total
  for (let i = 0; i < 3; i++) {
    // Leg 1: Center to Outer Perimeter (distance R)
    const pOuter1 = project(currentPoint, currentDir, R);
    waypoints.push(pOuter1);

    // Leg 2: Cross track along perimeter chord (distance R, turn 120°)
    const chordDir = (currentDir + turnAngle) % 360;
    const pOuter2 = project(pOuter1, chordDir, R);
    waypoints.push(pOuter2);

    // Leg 3: Back through center (turn 120° again)
    const returnDir = (chordDir + turnAngle) % 360;
    const pCenter = project(pOuter2, returnDir, R);
    waypoints.push(pCenter);
    currentPoint = pCenter;

    // Advance direction by 60° for next triangle pass
    currentDir = (currentDir + (turn === 'right' ? 60 : 300)) % 360;
  }

  const exitPoint = waypoints[waypoints.length - 1];
  const { segments, totalDistanceNm } = buildSegments(waypoints);

  return {
    type: 'VS',
    name: 'Sector Search',
    code: 'VS (Single Unit)',
    csp,
    exitPoint,
    waypoints,
    segments,
    totalDistanceNm,
    estimatedHours: totalDistanceNm / Math.max(1, speedKts),
    description: `Pola Sektor (VS): Radius R = ${R.toFixed(1)} NM dari Datum. Melakukan 3 lintasan melewati datum (total 9 kaki, sudut sektor 60°). Menghasilkan cakupan maksimum (POD sangat tinggi) di titik datum.`,
  };
}

/**
 * TS: Track Line Search
 * Search along a vessel/aircraft planned route.
 * Non-return (TSN) or Return (TSR).
 */
function generateTrackLineSearch(
  center: LatLng,
  lengthNm: number,
  orientationDeg: number,
  S: number,
  tsReturn: boolean,
  speedKts: number
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const halfL = lengthNm / 2;
  const dirRev = (orientationDeg + 180) % 360;
  const dirRight = (orientationDeg + 90) % 360;

  // CSP: start of route
  const csp = project(center, dirRev, halfL);
  waypoints.push(csp);

  // Outbound leg along track
  const endPoint = project(center, orientationDeg, halfL);
  waypoints.push(endPoint);

  if (tsReturn) {
    // Step S across and return
    const offset1 = project(endPoint, dirRight, S);
    const returnEnd = project(csp, dirRight, S);
    waypoints.push(offset1);
    waypoints.push(returnEnd);
  }

  const exitPoint = waypoints[waypoints.length - 1];
  const { segments, totalDistanceNm } = buildSegments(waypoints);

  return {
    type: 'TS',
    name: tsReturn ? 'Track Line Search Return (TSR)' : 'Track Line Search Non-Return (TSN)',
    code: tsReturn ? 'TSR' : 'TSN',
    csp,
    exitPoint,
    waypoints,
    segments,
    totalDistanceNm,
    estimatedHours: totalDistanceNm / Math.max(1, speedKts),
    description: `Pola Garis Haluan (${tsReturn ? 'TSR' : 'TSN'}): Menyusuri jalur penerbangan/pelayaran sepanjang ${lengthNm.toFixed(1)} NM (${orientationDeg.toFixed(0)}°T). Digunakan bila target diasumsikan hilang di sepanjang rute perjalanannya.`,
  };
}

/**
 * Helper to build segments and calculate total distance
 */
function buildSegments(waypoints: LatLng[]): {
  segments: { from: LatLng; to: LatLng; legIndex: number; distanceNm: number }[];
  totalDistanceNm: number;
} {
  const segments: { from: LatLng; to: LatLng; legIndex: number; distanceNm: number }[] = [];
  let totalDistanceNm = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const dist = distanceNm(from, to);
    segments.push({
      from,
      to,
      legIndex: i + 1,
      distanceNm: dist,
    });
    totalDistanceNm += dist;
  }

  return { segments, totalDistanceNm };
}
