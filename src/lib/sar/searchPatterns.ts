/**
 * Basarnas Search Patterns Generator
 * Generates exact coordinate waypoints and track segments for:
 * - PS: Parallel Track Search (Pola Paralel)
 * - CS: Creeping Line Search (Pola Merayap)
 * - SS: Expanding Square Search (Pola Kotak Membesar)
 * - VS: Sector Search (Pola Sektor)
 * - TS: Track Line Search (Pola Garis Haluan)
 */

import { type LatLng, project, distanceNm, bearingDeg, rectangleCorners } from './sarCalculations';

export type SearchPatternType = 'PS' | 'CS' | 'SS' | 'VS' | 'TS';

export interface SearchPatternPlanInitialState {
  patternType: SearchPatternType;
  orientationDeg: number;
  turnDirection?: 'right' | 'left';
  tsReturn?: boolean;
  sectorAngleDeg?: number;
  sectorLegLengthNm?: number;
  sectorLegCount?: number;
  trackLineLengthNm?: number;
  tsReturnOffsetNm?: number;
}

export interface SearchPatternParams {
  type: SearchPatternType;
  center: LatLng;
  lengthNm: number; // Dimension along major orientation
  widthNm: number;  // Dimension perpendicular to major orientation
  orientationDeg: number; // Major axis orientation (0-360)
  trackSpacingNm: number; // S (Track spacing)
  turnDirection?: 'right' | 'left'; // For SS and VS
  tsReturn?: boolean; // For TS: return track?
  startPoint?: LatLng;
  sectorAngleDeg?: number;
  sectorLegLengthNm?: number;
  sectorLegCount?: number;
  trackLineLengthNm?: number;
  tsReturnOffsetNm?: number;
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
  const S = params.trackSpacingNm;
  const L = params.lengthNm;
  const W = params.widthNm;
  const orient = ((params.orientationDeg % 360) + 360) % 360;

  if (!(L > 0) || !(W > 0) || !Number.isFinite(orient)) return emptyPattern(params, 'Search Area persegi belum tersedia.');

  switch (params.type) {
    case 'PS':
      if (!(S > 0)) return emptyPattern(params, 'S belum tersedia dari Worksheet yang sesuai dengan platform SRU.');
      return generateParallelSearch(params.center, L, W, orient, S, sruSpeedKts, params.startPoint);
    case 'CS':
      if (!(S > 0)) return emptyPattern(params, 'S belum tersedia dari Worksheet yang sesuai dengan platform SRU.');
      return generateCreepingLineSearch(params.center, L, W, orient, S, sruSpeedKts, params.startPoint);
    case 'SS':
      if (!(S > 0)) return emptyPattern(params, 'S belum tersedia dari Worksheet yang sesuai dengan platform SRU.');
      return generateExpandingSquareSearch(params.center, S, orient, params.turnDirection || 'right', sruSpeedKts);
    case 'VS':
      if (!(params.sectorAngleDeg && params.sectorAngleDeg > 0 && params.sectorAngleDeg < 360)
        || !(params.sectorLegLengthNm && params.sectorLegLengthNm > 0)
        || !(params.sectorLegCount && Number.isInteger(params.sectorLegCount) && params.sectorLegCount > 0)) {
        return emptyPattern(params, 'Sector angle, panjang leg, dan jumlah leg wajib ditentukan planner.');
      }
      return generateSectorSearch(params.center, params.sectorAngleDeg, params.sectorLegLengthNm, params.sectorLegCount, orient, params.turnDirection || 'right', sruSpeedKts);
    case 'TS':
      if (!(params.trackLineLengthNm && params.trackLineLengthNm > 0)) return emptyPattern(params, 'Panjang Track Line harus berasal dari rencana rute.');
      if (params.tsReturn && !(params.tsReturnOffsetNm && params.tsReturnOffsetNm > 0)) return emptyPattern(params, 'Offset jalur pulang harus ditentukan planner; S tidak digunakan sebagai offset.');
      return generateTrackLineSearch(params.center, params.trackLineLengthNm, orient, params.tsReturn ?? false, params.tsReturnOffsetNm ?? 0, sruSpeedKts);
    default:
      return emptyPattern(params, 'Jenis pola tidak tersedia.');
  }
}

/**
 * PS: Parallel Track Search
 * Long legs parallel to the major axis (L).
 * Starts at the automatically derived CSP and keeps lane centerlines S NM apart.
 */
function generateParallelSearch(
  center: LatLng,
  lengthNm: number,
  widthNm: number,
  orientationDeg: number,
  S: number,
  speedKts: number,
  plannedCsp?: LatLng,
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const halfL = lengthNm / 2;
  const halfW = widthNm / 2;

  // Directions
  const dirMajor = orientationDeg;
  const dirMajorRev = (dirMajor + 180) % 360;
  const dirCross = (dirMajor + 90) % 360;
  const dirCrossRev = (dirMajor + 270) % 360;

  const numLegs = Math.max(1, Math.floor(widthNm / S));
  const crossMargin = numLegs === 1 ? halfW : (widthNm - (numLegs - 1) * S) / 2;
  const alongMargin = crossMargin;
  const p1 = project(center, dirCrossRev, halfW - crossMargin);
  const csp = plannedCsp ?? project(p1, dirMajorRev, halfL - alongMargin);

  let currentPoint = csp;
  waypoints.push(currentPoint);

  const legDistance = Math.max(0, lengthNm - 2 * alongMargin);

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
    estimatedHours: speedKts > 0 ? totalDistanceNm / speedKts : 0,
    description: `Pola Paralel (PS): ${numLegs} search leg sejajar pada heading ${orientationDeg.toFixed(0)}°T; jarak antar-centerline ${S.toFixed(2)} NM. Batas area tetap persegi.`,
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
  speedKts: number,
  plannedCsp?: LatLng,
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const halfL = lengthNm / 2;
  const halfW = widthNm / 2;

  // Directions
  const dirMajor = orientationDeg;
  const dirCross = (dirMajor + 90) % 360;
  const dirCrossRev = (dirMajor + 270) % 360;

  const numLegs = Math.max(1, Math.floor(lengthNm / S));
  const alongMargin = numLegs === 1 ? halfL : (lengthNm - (numLegs - 1) * S) / 2;
  const crossMargin = alongMargin;
  const p1 = project(center, (dirMajor + 180) % 360, halfL - alongMargin);
  const csp = plannedCsp ?? project(p1, dirCrossRev, halfW - crossMargin);

  let currentPoint = csp;
  waypoints.push(currentPoint);

  const legDistance = Math.max(0, widthNm - 2 * crossMargin);

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
    estimatedHours: speedKts > 0 ? totalDistanceNm / speedKts : 0,
    description: `Pola Merayap (CS): ${numLegs} search leg pada heading ${orientationDeg.toFixed(0)}°T; jarak antar-centerline ${S.toFixed(2)} NM. Batas area tetap persegi.`,
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
    estimatedHours: speedKts > 0 ? totalDistanceNm / speedKts : 0,
    description: `Pola Kotak Membesar (SS): Mulai dari Datum/CSP dengan belokan 90° ke ${turn === 'right' ? 'kanan' : 'kiri'}. Panjang kaki: 1S, 1S, 2S, 2S, 3S, 3S... Cocok untuk posisi target yang diketahui secara akurat di area kecil dan probabilitas tinggi di dekat datum.`,
  };
}

/**
 * VS: Sector Search
 * Sector geometry uses planner-supplied sector angle, spoke length, and spoke count.
 */
function generateSectorSearch(
  center: LatLng,
  sectorAngleDeg: number,
  legLengthNm: number,
  legCount: number,
  orientationDeg: number,
  turn: 'right' | 'left',
  speedKts: number
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const csp = center;
  waypoints.push(csp);

  const turnAngle = (turn === 'right' ? 1 : -1) * sectorAngleDeg / 2;
  let currentDir = orientationDeg;
  for (let i = 0; i < legCount; i++) {
    waypoints.push(project(center, currentDir, legLengthNm));
    waypoints.push(center);
    currentDir = (currentDir + turnAngle + 360) % 360;
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
    estimatedHours: speedKts > 0 ? totalDistanceNm / speedKts : 0,
    description: `Pola Sektor (VS): ${legCount} leg dengan sudut sektor ${sectorAngleDeg.toFixed(1)}° dan panjang leg ${legLengthNm.toFixed(1)} NM; rotasi antar-leg 1/2 sudut sektor sesuai rencana planner.`,
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
  tsReturn: boolean,
  returnOffsetNm: number,
  speedKts: number
): SearchPatternResult {
  const waypoints: LatLng[] = [];
  const csp = project(center, (orientationDeg + 180) % 360, lengthNm / 2);
  const dirRight = (orientationDeg + 90) % 360;

  waypoints.push(csp);

  const endPoint = project(center, orientationDeg, lengthNm / 2);
  waypoints.push(endPoint);

  if (tsReturn) {
    // Return-track offset is an explicit planner input, never inferred from S.
    const offset1 = project(endPoint, dirRight, returnOffsetNm);
    const returnEnd = project(csp, dirRight, returnOffsetNm);
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
    estimatedHours: speedKts > 0 ? totalDistanceNm / speedKts : 0,
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

function emptyPattern(params: SearchPatternParams, reason: string): SearchPatternResult {
  return {
    type: params.type,
    name: 'Search Pattern',
    code: params.type,
    csp: params.startPoint ?? params.center,
    exitPoint: params.startPoint ?? params.center,
    waypoints: [],
    segments: [],
    totalDistanceNm: 0,
    estimatedHours: 0,
    description: reason,
  };
}

/** Clip each pattern leg to the existing square boundary without resizing it. */
export function clipSearchPatternToSquare(
  pattern: SearchPatternResult,
  center: LatLng,
  sideNm: number,
  areaOrientationDeg: number,
): SearchPatternResult {
  if (!(sideNm > 0) || pattern.segments.length === 0) return pattern;
  const toLocal = (point: LatLng) => {
    const distance = distanceNm(center, point);
    const bearing = (bearingDeg(center, point) * Math.PI) / 180;
    return { x: distance * Math.sin(bearing), y: distance * Math.cos(bearing) };
  };
  const toGeo = (point: { x: number; y: number }): LatLng => {
    const distance = Math.hypot(point.x, point.y);
    const bearing = (Math.atan2(point.x, point.y) * 180) / Math.PI;
    return project(center, bearing, distance);
  };
  const polygon = rectangleCorners(center, sideNm, sideNm, areaOrientationDeg).map(toLocal);
  const area2 = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  const orientation = area2 >= 0 ? 1 : -1;

  const segments = pattern.segments.flatMap((segment) => {
    const start = toLocal(segment.from);
    const end = toLocal(segment.to);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let tEnter = 0;
    let tExit = 1;
    for (let index = 0; index < polygon.length; index++) {
      const edgeStart = polygon[index];
      const edgeEnd = polygon[(index + 1) % polygon.length];
      const ex = edgeEnd.x - edgeStart.x;
      const ey = edgeEnd.y - edgeStart.y;
      const valueAtStart = orientation * (ex * (start.y - edgeStart.y) - ey * (start.x - edgeStart.x));
      const valueChange = orientation * (ex * dy - ey * dx);
      if (Math.abs(valueChange) < 1e-9) {
        if (valueAtStart < 0) return [];
        continue;
      }
      const crossing = -valueAtStart / valueChange;
      if (valueChange > 0) tEnter = Math.max(tEnter, crossing);
      else tExit = Math.min(tExit, crossing);
      if (tEnter > tExit) return [];
    }
    const from = toGeo({ x: start.x + dx * tEnter, y: start.y + dy * tEnter });
    const to = toGeo({ x: start.x + dx * tExit, y: start.y + dy * tExit });
    const distance = distanceNm(from, to);
    return distance > 0.001 ? [{ ...segment, from, to, distanceNm: distance }] : [];
  });
  const waypoints = segments.length ? [segments[0].from, ...segments.map((segment) => segment.to)] : [];
  return {
    ...pattern,
    csp: segments[0]?.from ?? pattern.csp,
    exitPoint: segments.at(-1)?.to ?? pattern.exitPoint,
    waypoints,
    segments,
    totalDistanceNm: segments.reduce((sum, segment) => sum + segment.distanceNm, 0),
  };
}
