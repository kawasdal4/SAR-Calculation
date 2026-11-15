/**
 * Intercept calculation engine.
 *
 * Implements 3 intercept methods from the IAMSAR/SAR training material:
 *   1. Head-On  — target moves toward SRU
 *   2. Overtaking — SRU chases target from behind
 *   3. Crossing / Beam-On — target moves at angle to SRU
 *
 * Each method uses the "half-hour speed vector" graphical technique:
 *   - Plot target (A) and SRU (B) positions at same time
 *   - Draw half-hour speed vector from A (perpendicular to AB for head-on/overtaking,
 *     or along heading for beam-on)
 *   - Draw half-hour speed vector from B (opposite side for head-on, same side for overtaking,
 *     or intersect with parallel line for beam-on)
 *   - Intersection of vectors gives intercept point I
 *
 * Reference: "INTERCEPT" training material, DIKLAT SAR PLANNING Angkatan XL
 */

import type { LatLng } from './sarCalculations';
import { project, distanceNm, normalizeAngle } from './sarCalculations';

export type InterceptType = 'head-on' | 'overtaking' | 'beam-on';

export interface InterceptInput {
  /** Target (distressed vessel) position at time T0. */
  targetPos: LatLng;
  /** Target speed in knots. */
  targetSpeed: number;
  /** Target heading in degrees True (for beam-on only; head-on/overtaking don't need it). */
  targetHeading?: number;
  /** SRU (rescue unit) position at time T0. */
  sruPos: LatLng;
  /** SRU speed in knots. */
  sruSpeed: number;
  /** Intercept type. */
  type: InterceptType;
  /** Reference time (ISO string or HH:MM label). */
  timeLabel?: string;
}

export interface InterceptResult {
  /** Intercept point coordinates. */
  interceptPoint: LatLng;
  /** Distance from target to intercept point (NM). */
  targetDistance: number;
  /** Distance from SRU to intercept point (NM). */
  sruDistance: number;
  /** Time to intercept from T0 (hours). */
  timeToIntercept: number;
  /** Bearing from target to SRU (degrees True). */
  bearingTargetToSru: number;
  /** Bearing from SRU to target (degrees True). */
  bearingSruToTarget: number;
  /** Half-hour distance for target (NM) = speed × 0.5. */
  targetHalfHourDist: number;
  /** Half-hour distance for SRU (NM) = speed × 0.5. */
  sruHalfHourDist: number;
  /** Vector point C (end of target's half-hour vector). */
  pointC: LatLng;
  /** Vector point D (end of SRU's half-hour vector). */
  pointD: LatLng;
  /** For beam-on: point X (end of target heading vector) and W (intersection). */
  pointX?: LatLng;
  pointW?: LatLng;
  /** Estimated intercept time label. */
  interceptTimeLabel: string;
  /** Type used. */
  type: InterceptType;
}

/** Calculate bearing from point A to point B in degrees True. */
function bearingFromTo(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeAngle((Math.atan2(y, x) * 180) / Math.PI);
}

/** Add hours to a time label like "12:00" → "13:30" for 1.5 hours. */
function addHoursToLabel(label: string, hours: number): string {
  const match = label.match(/(\d{1,2}):(\d{2})/);
  if (!match) return label;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const totalMin = h * 60 + m + Math.round(hours * 60);
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${newH.toString().padStart(2, '0')}:${newM.toString().padStart(2, '0')}`;
}

/**
 * Calculate intercept point using the half-hour speed vector method.
 *
 * Head-On: target and SRU move toward each other.
 *   - Vector AC is perpendicular to AB, on one side
 *   - Vector BD is perpendicular to AB, on opposite side
 *   - Line CD intersects AB at intercept point I
 *
 * Overtaking: SRU chases target (same direction).
 *   - Vector AC is perpendicular to AB, on one side
 *   - Vector BD is perpendicular to AB, on same side
 *   - Line DC extended intersects extended AB at intercept point I
 *
 * Beam-On: target moves at angle to AB.
 *   - Vector AX is along target heading
 *   - Line XY is parallel to AB
 *   - Arc from B with radius = half-hour SRU speed intersects XY at W
 *   - Line BW extended intersects AX extended at intercept point I
 */
export function calculateIntercept(input: InterceptInput): InterceptResult {
  const { targetPos: A, sruPos: B, targetSpeed, sruSpeed, type, timeLabel } = input;

  // Bearing from A to B (and B to A)
  const bearingAB = bearingFromTo(A, B);
  const bearingBA = normalizeAngle(bearingAB + 180);

  // Half-hour distances
  const halfHourTarget = targetSpeed * 0.5; // NM
  const halfHourSRU = sruSpeed * 0.5; // NM

  if (type === 'beam-on') {
    return calculateBeamOn(input, bearingAB, halfHourTarget, halfHourSRU);
  }

  // For Head-On and Overtaking:
  // Vector AC: from A, perpendicular to AB, distance = half-hour target speed
  // Vector BD: from B, perpendicular to AB, distance = half-hour SRU speed
  //
  // Head-On: AC on one side (e.g., left), BD on opposite side (right)
  // Overtaking: AC and BD on same side (e.g., both left)
  //
  // The perpendicular direction: bearingAB + 90 (right) or bearingAB - 90 (left)

  const perpDirAC = type === 'head-on' ? normalizeAngle(bearingAB + 90) : normalizeAngle(bearingAB - 90);
  const perpDirBD = type === 'head-on' ? normalizeAngle(bearingAB - 90) : normalizeAngle(bearingAB - 90);

  // Points C and D
  const C = project(A, perpDirAC, halfHourTarget);
  const D = project(B, perpDirBD, halfHourSRU);

  // Find intersection of line CD with line AB (or its extension)
  const interceptPoint = lineLineIntersection(A, B, C, D);

  if (!interceptPoint) {
    // Fallback: use midpoint if intersection fails (shouldn't happen in practice)
    const midLat = (A.lat + B.lat) / 2;
    const midLng = (A.lng + B.lng) / 2;
    return buildResult(
      { lat: midLat, lng: midLng },
      A, B, targetSpeed, sruSpeed, C, D, bearingAB, bearingBA,
      halfHourTarget, halfHourSRU, type, timeLabel ?? '',
    );
  }

  return buildResult(
    interceptPoint,
    A, B, targetSpeed, sruSpeed, C, D, bearingAB, bearingBA,
    halfHourTarget, halfHourSRU, type, timeLabel ?? '',
  );
}

/**
 * Beam-On intercept calculation.
 * Target moves along its heading; SRU intercepts at an angle.
 */
function calculateBeamOn(
  input: InterceptInput,
  bearingAB: number,
  halfHourTarget: number,
  halfHourSRU: number,
): InterceptResult {
  const { targetPos: A, sruPos: B, targetSpeed, sruSpeed, targetHeading = 0, timeLabel } = input;

  // Point X: from A, along target heading, distance = half-hour target speed
  const X = project(A, targetHeading, halfHourTarget);

  // Line XY: parallel to AB, starting from X
  // We need to find point W on line XY such that distance BW = half-hour SRU speed
  // W is the intersection of: line through X parallel to AB, and circle centered at B with radius halfHourSRU

  // Direction of XY = bearingAB
  // Parametric: W = X + t * (direction AB)
  // |BW| = halfHourSRU
  // Solve quadratic for t

  const dirX = Math.sin((bearingAB * Math.PI) / 180);
  const dirY = Math.cos((bearingAB * Math.PI) / 180);

  // Convert to approximate NM coordinates relative to A
  // Using equirectangular approximation for small distances
  const lat0 = A.lat;
  const bx = (B.lng - A.lng) * Math.cos((lat0 * Math.PI) / 180) * 60; // NM
  const by = (B.lat - A.lat) * 60; // NM
  const xx = (X.lng - A.lng) * Math.cos((lat0 * Math.PI) / 180) * 60;
  const xy = (X.lat - A.lat) * 60;

  // W = (xx + t*dirX, xy + t*dirY)
  // |BW|^2 = (xx + t*dirX - bx)^2 + (xy + t*dirY - by)^2 = halfHourSRU^2
  const dx = xx - bx;
  const dy = xy - by;
  const a = dirX * dirX + dirY * dirY;
  const b = 2 * (dx * dirX + dy * dirY);
  const c = dx * dx + dy * dy - halfHourSRU * halfHourSRU;
  const disc = b * b - 4 * a * c;

  let t: number;
  if (disc < 0) {
    // No solution — use midpoint fallback
    t = 0;
  } else {
    // Two solutions; pick the one closer to B (smaller |t|)
    const t1 = (-b + Math.sqrt(disc)) / (2 * a);
    const t2 = (-b - Math.sqrt(disc)) / (2 * a);
    t = Math.abs(t1) < Math.abs(t2) ? t1 : t2;
  }

  // W in NM relative to A
  const wx = xx + t * dirX;
  const wy = xy + t * dirY;
  // Convert back to lat/lng
  const W: LatLng = {
    lat: A.lat + wy / 60,
    lng: A.lng + wx / (60 * Math.cos((lat0 * Math.PI) / 180)),
  };

  // Intercept point I: intersection of line BW with line AX (extended)
  const I = lineLineIntersection(B, W, A, X);

  if (!I) {
    // Fallback
    return buildResult(
      X, A, B, targetSpeed, sruSpeed, X, W, bearingAB, normalizeAngle(bearingAB + 180),
      halfHourTarget, halfHourSRU, 'beam-on', timeLabel ?? '',
      X, W,
    );
  }

  return buildResult(
    I, A, B, targetSpeed, sruSpeed, X, W, bearingAB, normalizeAngle(bearingAB + 180),
    halfHourTarget, halfHourSRU, 'beam-on', timeLabel ?? '',
    X, W,
  );
}

/**
 * Find intersection of two lines defined by point pairs.
 * Uses parametric line intersection.
 */
function lineLineIntersection(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): LatLng | null {
  // Convert to NM relative coordinates for better accuracy
  const lat0 = (p1.lat + p2.lat + p3.lat + p4.lat) / 4;
  const cosLat = Math.cos((lat0 * Math.PI) / 180);

  const x1 = (p1.lng - 0) * cosLat * 60; // Using p1 as origin
  const y1 = (p1.lat - 0) * 60;
  const x2 = (p2.lng - 0) * cosLat * 60;
  const y2 = (p2.lat - 0) * 60;
  const x3 = (p3.lng - 0) * cosLat * 60;
  const y3 = (p3.lat - 0) * 60;
  const x4 = (p4.lng - 0) * cosLat * 60;
  const y4 = (p4.lat - 0) * 60;

  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 1e-10) return null; // parallel lines

  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;

  // Intersection point in lat/lng (using p1 as origin)
  const intLat = p1.lat + t * (p2.lat - p1.lat);
  const intLng = p1.lng + t * (p2.lng - p1.lng);

  return { lat: intLat, lng: intLng };
}

function buildResult(
  interceptPoint: LatLng,
  A: LatLng,
  B: LatLng,
  targetSpeed: number,
  sruSpeed: number,
  C: LatLng,
  D: LatLng,
  bearingAB: number,
  bearingBA: number,
  halfHourTarget: number,
  halfHourSRU: number,
  type: InterceptType,
  timeLabel: string,
  X?: LatLng,
  W?: LatLng,
): InterceptResult {
  const targetDist = distanceNm(A, interceptPoint);
  const sruDist = distanceNm(B, interceptPoint);
  const timeToIntercept = targetSpeed > 0 ? targetDist / targetSpeed : 0;
  const interceptTimeLabel = timeLabel
    ? addHoursToLabel(timeLabel, timeToIntercept)
    : `${timeToIntercept.toFixed(2)}h`;

  return {
    interceptPoint,
    targetDistance: targetDist,
    sruDistance: sruDist,
    timeToIntercept,
    bearingTargetToSru: bearingAB,
    bearingSruToTarget: bearingBA,
    targetHalfHourDist: halfHourTarget,
    sruHalfHourDist: halfHourSRU,
    pointC: C,
    pointD: D,
    pointX: X,
    pointW: W,
    interceptTimeLabel,
    type,
  };
}
