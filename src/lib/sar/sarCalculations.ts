/**
 * Search and Rescue calculation engine
 * Implements worksheets from Appendix K (Determining Datum) and Appendix L (Search planning)
 *
 * Calculations follow the referenced SAR planning formulas.
 * Wind directions use meteorological convention (direction FROM which wind blows, in °T).
 * Current/leeway directions use the oceanographic convention (direction TOWARD which current flows).
 */

// ============================================================================
// VECTOR UTILITIES
// ============================================================================

export interface Vector {
  /** Direction toward which the vector points, in degrees True (0-360). */
  dir: number;
  /** Magnitude (speed in knots or distance in NM). */
  mag: number;
}

/** Normalize an angle to the [0, 360) range. */
export function normalizeAngle(deg: number): number {
  let x = deg % 360;
  if (x < 0) x += 360;
  return x;
}

/** Convert a direction/speed vector to (u, v) components where:
 *  u = eastward  (+ east, - west)
 *  v = northward (+ north, - south)
 */
export function vectorToUV(v: Vector): { u: number; v: number } {
  const rad = (v.dir * Math.PI) / 180;
  return {
    u: v.mag * Math.sin(rad),
    v: v.mag * Math.cos(rad),
  };
}

/** Convert (u, v) components back to a direction/magnitude vector. */
export function uvToVector(u: number, v: number): Vector {
  const mag = Math.sqrt(u * u + v * v);
  let dirDeg = (Math.atan2(u, v) * 180) / Math.PI;
  return { dir: normalizeAngle(dirDeg), mag };
}

/** Add two or more vectors (head-to-tail). Returns the resultant vector. */
export function addVectors(...vectors: Vector[]): Vector {
  let u = 0;
  let v = 0;
  for (const vec of vectors) {
    const comp = vectorToUV(vec);
    u += comp.u;
    v += comp.v;
  }
  return uvToVector(u, v);
}

// ============================================================================
// GEOGRAPHIC UTILITIES
// ============================================================================

export interface LatLng {
  lat: number;
  lng: number;
}

/** Distance between two points in nautical miles (Haversine, sphere R=3440.065 NM). */
export function distanceNm(a: LatLng, b: LatLng): number {
  const R = 3440.065;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from point `a` to point `b` in degrees True [0, 360). */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const brng = (Math.atan2(y, x) * 180) / Math.PI;
  return (brng + 360) % 360;
}

/** Project a position from a starting point given a direction (degT) and distance (NM). */
export function project(from: LatLng, dirDeg: number, distanceNm: number): LatLng {
  const R = 3440.065;
  const lat1 = (from.lat * Math.PI) / 180;
  const lng1 = (from.lng * Math.PI) / 180;
  const brng = (dirDeg * Math.PI) / 180;
  const d = distanceNm / R;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    lat: Math.max(-90, Math.min(90, (lat2 * 180) / Math.PI)),
    lng: ((lng2 * 180) / Math.PI + 540) % 360 - 180,
  };
}

/** Compute the four corner points of a search rectangle centered on `center`. */
export function rectangleCorners(
  center: LatLng,
  lengthNm: number,
  widthNm: number,
  orientationDeg: number,
): LatLng[] {
  const halfLen = lengthNm / 2;
  const halfWid = widthNm / 2;
  const fwd = orientationDeg;
  const perpRight = normalizeAngle(orientationDeg + 90);
  const perpLeft = normalizeAngle(orientationDeg - 90);

  const startCenter = project(center, normalizeAngle(fwd + 180), halfLen);
  const c1 = project(startCenter, perpLeft, halfWid);
  const c2 = project(startCenter, perpRight, halfWid);
  const c3 = project(c2, fwd, lengthNm);
  const c4 = project(c1, fwd, lengthNm);
  return [c1, c2, c3, c4];
}

// ============================================================================
// AVERAGE WIND ALOFT (AWA) WORKSHEET - Appendix K-10
// ============================================================================

export interface AWAObservation {
  /** Observation altitude in feet. `altObs` is kept for older saved worksheets. */
  altitudeFt?: number;
  altObs?: string;
  /** Legacy saved fields; when altitudeFt/altObs are missing, altLow is used as the observation level. */
  altLow?: number;
  altHigh?: number;
  windDirFrom: number;
  windSpeed: number;
}

export interface AWAResult {
  totalAltLossKft: number;
  totalWindVector: Vector;
  awaDirFrom: number;
  awaSpeed: number;
  vectorSumKts: number;
  directionDefined: boolean;
  isValid: boolean;
  errors: string[];
  rows: Array<{
    inputIndex: number;
    altitudeFt: number;
    intervalLowFt: number | null;
    intervalHighFt: number | null;
    altitudeKft: number;
    windDirFrom: number;
    windSpeed: number;
    contribution: Vector;
    contributionKts: number;
    eastComponent: number;
    northComponent: number;
  }>;
}

export function computeAWA(observations: AWAObservation[], targetAltitudeFt: number): AWAResult {
  const emptyResult = (errors: string[]): AWAResult => ({
    totalAltLossKft: 0,
    totalWindVector: { dir: 0, mag: 0 },
    awaDirFrom: 0,
    awaSpeed: 0,
    vectorSumKts: 0,
    directionDefined: false,
    isValid: false,
    errors,
    rows: [],
  });
  const errors: string[] = [];

  if (!Number.isFinite(targetAltitudeFt) || targetAltitudeFt <= 0) {
    errors.push('Ketinggian target harus lebih besar dari 0 ft.');
  }
  if (!Array.isArray(observations) || observations.length === 0) {
    errors.push('Tambahkan data pengamatan angin terlebih dahulu.');
    return emptyResult(errors);
  }

  const parsed = observations.map((obs, inputIndex) => {
    const hasAltitudeText = typeof obs.altObs === 'string';
    const altitudeValue = hasAltitudeText
      ? (obs.altObs as string).trim() === '' ? Number.NaN : Number(obs.altObs)
      : Number.isFinite(obs.altitudeFt) ? obs.altitudeFt as number : obs.altLow ?? Number.NaN;
    const altitudeValid = Number.isFinite(altitudeValue) && altitudeValue >= 0;
    const directionValid = Number.isFinite(obs.windDirFrom) && obs.windDirFrom >= 0 && obs.windDirFrom <= 360;
    const speedValid = Number.isFinite(obs.windSpeed) && obs.windSpeed >= 0;

    if (!altitudeValid) errors.push(`Baris ${inputIndex + 1}: altitude harus angka >= 0 ft.`);
    if (!directionValid) errors.push(`Baris ${inputIndex + 1}: arah angin harus 000–360°T.`);
    if (!speedValid) errors.push(`Baris ${inputIndex + 1}: kecepatan angin harus angka >= 0 kts.`);

    return {
      inputIndex,
      altitudeFt: altitudeValid ? altitudeValue : Number.NaN,
      windDirFrom: directionValid ? normalizeAngle(obs.windDirFrom) : Number.NaN,
      windSpeed: speedValid ? obs.windSpeed : Number.NaN,
    };
  });

  const validLevels = parsed.filter((row) => Number.isFinite(row.altitudeFt)).sort((a, b) => a.altitudeFt - b.altitudeFt);
  for (let i = 1; i < validLevels.length; i += 1) {
    if (validLevels[i].altitudeFt === validLevels[i - 1].altitudeFt) {
      errors.push(`Altitude ${validLevels[i].altitudeFt} ft terduplikasi; setiap level harus unik.`);
    }
  }
  if (!validLevels.some((row) => row.altitudeFt === 0)) {
    errors.push('Data harus mencakup pengamatan Surface / 0 ft.');
  }
  if (
    Number.isFinite(targetAltitudeFt) &&
    targetAltitudeFt > 0 &&
    validLevels.length > 0 &&
    validLevels[validLevels.length - 1].altitudeFt < targetAltitudeFt
  ) {
    errors.push(`Data angin tertinggi (${validLevels[validLevels.length - 1].altitudeFt} ft) belum mencapai target ${targetAltitudeFt} ft; tambahkan level di atau di atas target.`);
  }
  if (errors.length > 0) return emptyResult(errors);

  let totalAltKft = 0;
  let eastTotal = 0;
  let northTotal = 0;
  const rows: AWAResult['rows'] = validLevels.map((observation, index) => {
    const previous = validLevels[index - 1];
    const next = validLevels[index + 1];
    const layerLow = index === 0 ? 0 : (previous.altitudeFt + observation.altitudeFt) / 2;
    const layerHigh = Math.min(
      targetAltitudeFt,
      next ? (observation.altitudeFt + next.altitudeFt) / 2 : targetAltitudeFt,
    );
    const hasLayer = layerHigh > layerLow && layerLow < targetAltitudeFt;
    const intervalLowFt = hasLayer ? layerLow : null;
    const intervalHighFt = hasLayer ? layerHigh : null;
    const altitudeKft = hasLayer ? (layerHigh - layerLow) / 1000 : 0;
    const contributionKts = altitudeKft * observation.windSpeed;
    const directionRad = (observation.windDirFrom * Math.PI) / 180;
    const eastComponent = contributionKts * Math.sin(directionRad);
    const northComponent = contributionKts * Math.cos(directionRad);
    totalAltKft += altitudeKft;
    eastTotal += eastComponent;
    northTotal += northComponent;

    return {
      inputIndex: observation.inputIndex,
      altitudeFt: observation.altitudeFt,
      intervalLowFt,
      intervalHighFt,
      altitudeKft,
      windDirFrom: observation.windDirFrom,
      windSpeed: observation.windSpeed,
      contribution: { dir: observation.windDirFrom, mag: contributionKts },
      contributionKts,
      eastComponent,
      northComponent,
    };
  });

  const vectorSumKts = Math.hypot(eastTotal, northTotal);
  const directionDefined = vectorSumKts > 1e-9;
  const awaDirFrom = directionDefined
    ? normalizeAngle((Math.atan2(eastTotal, northTotal) * 180) / Math.PI)
    : 0;
  const awaSpeed = totalAltKft > 0 ? vectorSumKts / totalAltKft : 0;
  if (totalAltKft <= 0) errors.push('Tidak ada lapisan angin dengan ketebalan positif di bawah target.');
  if (!directionDefined) errors.push('Resultan vektor mendekati nol; arah AWA tidak terdefinisi.');

  return {
    totalAltLossKft: totalAltKft,
    totalWindVector: { dir: awaDirFrom, mag: vectorSumKts },
    awaDirFrom,
    awaSpeed,
    vectorSumKts,
    directionDefined,
    isValid: errors.length === 0,
    errors,
    rows,
  };
}

// ============================================================================
// AVERAGE SURFACE WIND (ASW) WORKSHEET - Appendix K-19
// ============================================================================

export interface ASWObservation {
  timeObs?: string;
  timeStart: string;
  timeEnd: string;
  hours: number;
  windDirFrom: number;
  windSpeed: number;
}

export interface ASWResult {
  totalHours: number;
  totalWindVector: Vector;
  aswDirFrom: number;
  aswSpeed: number;
  rows: Array<{
    hours: number;
    windDirFrom: number;
    windSpeed: number;
    contribution: Vector;
  }>;
}

export function computeASW(observations: ASWObservation[]): ASWResult {
  const rows: ASWResult['rows'] = [];
  let totalHours = 0;
  const contributions: Vector[] = [];

  for (const obs of observations) {
    if (obs.hours <= 0) continue;
    const downwindDir = normalizeAngle(obs.windDirFrom + 180);
    const contribution: Vector = { dir: downwindDir, mag: obs.hours * obs.windSpeed };
    rows.push({
      hours: obs.hours,
      windDirFrom: obs.windDirFrom,
      windSpeed: obs.windSpeed,
      contribution,
    });
    totalHours += obs.hours;
    contributions.push(contribution);
  }

  const totalVector = addVectors(...contributions);
  const aswSpeed = totalHours > 0 ? totalVector.mag / totalHours : 0;
  const aswDirFrom = normalizeAngle(totalVector.dir - 180);

  return {
    totalHours,
    totalWindVector: totalVector,
    aswDirFrom,
    aswSpeed,
    rows,
  };
}

// ============================================================================
// WIND CURRENT (WC) WORKSHEET - Appendix K-26 (figure N-1)
// ============================================================================

export function windCurrentDrift(aswSpeed: number): number {
  return 0.03 * aswSpeed;
}

export function windCurrentDivergence(absLat: number): number {
  if (absLat < 10) return 0;
  if (absLat < 25) return 15;
  if (absLat < 45) return 25;
  return 40;
}

export interface WCResult {
  aswDirFrom: number;
  aswSpeed: number;
  downwindDir: number;
  windCurrentDrift: number;
  divergence: number;
  hemisphere: 1 | -1;
  wcSet: number;
  wcDrift: number;
  wcErr: number;
}

export function computeWC(
  aswDirFrom: number,
  aswSpeed: number,
  latitude: number,
  wcErr = 0.3,
): WCResult {
  const downwindDir = normalizeAngle(aswDirFrom + 180);
  const drift = windCurrentDrift(aswSpeed);
  const div = windCurrentDivergence(Math.abs(latitude));
  const hemisphere: 1 | -1 = latitude >= 0 ? 1 : -1;
  const wcSet = normalizeAngle(downwindDir + hemisphere * div);
  return {
    aswDirFrom,
    aswSpeed,
    downwindDir,
    windCurrentDrift: drift,
    divergence: div,
    hemisphere,
    wcSet,
    wcDrift: drift,
    wcErr,
  };
}

// ============================================================================
// LEEWAY (LW) WORKSHEET - Appendix K-28 (figures N-2 / N-3)
// ============================================================================

export interface LeewayObjectType {
  id: string;
  label: string;
  leewayRate: number;
  /** Table I-1/I-2 modifier in knots, added to multiplier × wind speed. */
  leewayModifier?: number;
  divergenceAngle: number;
  probableError: number;
}

export const LEEWAY_OBJECT_TYPES: LeewayObjectType[] = [
  {
    id: 'piw-novice',
    label: 'Person in water (PIW) – general',
    leewayRate: 0.011,
    leewayModifier: 0.07,
    divergenceAngle: 30,
    probableError: 0.07,
  },
  {
    id: 'piw-lifejacket',
    label: 'Person in water (PIW) – horizontal, survival suit',
    leewayRate: 0.014,
    leewayModifier: 0.10,
    divergenceAngle: 30,
    probableError: 0.07,
  },
  {
    id: 'raft-46-person',
    label: '4-6 person liferaft (no canopy, no drogue)',
    leewayRate: 0.057,
    leewayModifier: 0.21,
    divergenceAngle: 24,
    probableError: 0.18,
  },
  {
    id: 'raft-1520-person',
    label: '15-20 person liferaft, no ballast system (general)',
    leewayRate: 0.042,
    leewayModifier: 0.03,
    divergenceAngle: 28,
    probableError: 0.18,
  },
  {
    id: 'raft-canopy-drogue',
    label: 'Liferaft with canopy and drogue',
    leewayRate: 0.030,
    leewayModifier: 0,
    divergenceAngle: 28,
    probableError: 0.12,
  },
  {
    id: 'raft-canopy-no-drogue',
    label: 'Liferaft with canopy, no drogue',
    leewayRate: 0.037,
    leewayModifier: 0.11,
    divergenceAngle: 24,
    probableError: 0.16,
  },
  {
    id: 'dinghy-fibreglass',
    label: 'Maritime life raft – shallow ballast, capsized',
    leewayRate: 0.017,
    leewayModifier: -0.10,
    divergenceAngle: 8,
    probableError: 0.12,
  },
  {
    id: 'dinghy-upright',
    label: 'Maritime life raft – shallow ballast (general)',
    leewayRate: 0.029,
    leewayModifier: 0,
    divergenceAngle: 22,
    probableError: 0.18,
  },
  {
    id: 'small-fishing',
    label: 'Commercial fishing vessel (general)',
    leewayRate: 0.037,
    leewayModifier: 0.02,
    divergenceAngle: 48,
    probableError: 0.15,
  },
  {
    id: 'commercial-fishing',
    label: 'Commercial fishing vessel – side-stern trawler',
    leewayRate: 0.042,
    leewayModifier: 0,
    divergenceAngle: 48,
    probableError: 0.12,
  },
  {
    id: 'sailboat',
    label: 'Sailing vessel – mono-hull, full keel',
    leewayRate: 0.030,
    leewayModifier: 0,
    divergenceAngle: 48,
    probableError: 0.18,
  },
  {
    id: 'merchant-vessel',
    label: 'Coastal freighter',
    leewayRate: 0.028,
    leewayModifier: 0,
    divergenceAngle: 48,
    probableError: 0.10,
  },
];

export function getLeewayObjectById(id: string): LeewayObjectType {
  return LEEWAY_OBJECT_TYPES.find((t) => t.id === id) ?? LEEWAY_OBJECT_TYPES[0];
}

export interface LWResult {
  aswDirFrom: number;
  aswSpeed: number;
  downwindDir: number;
  objectType: LeewayObjectType;
  leewaySpeed: number;
  divergenceAngle: number;
  lwLeftDir: number;
  lwRightDir: number;
  lwError: number;
}

export function computeLW(
  aswDirFrom: number,
  aswSpeed: number,
  objectType: LeewayObjectType,
): LWResult {
  const downwindDir = normalizeAngle(aswDirFrom + 180);
  const leewaySpeed = Math.max(0, aswSpeed * objectType.leewayRate + (objectType.leewayModifier ?? 0));
  const div = objectType.divergenceAngle;
  return {
    aswDirFrom,
    aswSpeed,
    downwindDir,
    objectType,
    leewaySpeed,
    divergenceAngle: div,
    lwLeftDir: normalizeAngle(downwindDir - div),
    lwRightDir: normalizeAngle(downwindDir + div),
    lwError: objectType.probableError,
  };
}

// ============================================================================
// TOTAL WATER CURRENT (TWC) WORKSHEET
// ============================================================================

export interface TWCInput {
  seaCurrent?: Vector;
  seaCurrentErr?: number;
  tidalCurrent?: Vector;
  tidalCurrentErr?: number;
  windCurrent: Vector;
  windCurrentErr: number;
}

export interface TWCResult {
  twc: Vector;
  twcErr: number;
}

export function computeTWC(input: TWCInput): TWCResult {
  const vectors: Vector[] = [];
  const errors: number[] = [];

  if (input.seaCurrent) {
    vectors.push(input.seaCurrent);
    errors.push(input.seaCurrentErr ?? 0.3);
  }
  if (input.tidalCurrent) {
    vectors.push(input.tidalCurrent);
    errors.push(input.tidalCurrentErr ?? 0.3);
  }
  vectors.push(input.windCurrent);
  errors.push(input.windCurrentErr);

  const twc = addVectors(...vectors);
  const twcErr = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0));
  return { twc, twcErr };
}

// ============================================================================
// TOTAL PROBABLE ERROR OF POSITION (E) WORKSHEET - Appendix K-31
// ============================================================================

export interface EInput {
  X: number;
  De: number;
  Y: number;
}

export interface EResult {
  X: number;
  De: number;
  Y: number;
  E2: number;
  E: number;
}

export function computeE(input: EInput): EResult {
  const { X, De, Y } = input;
  const E2 = X * X + De * De + Y * Y;
  const E = Math.sqrt(E2);
  return { X, De, Y, E2, E };
}

// ============================================================================
// DATUM WORKSHEET (MARINE) - Appendix K-13
// ============================================================================

export interface DatumInput {
  start: LatLng;
  driftInterval: number;
  aswDirFrom: number;
  aswSpeed: number;
  aswdve: number;
  twc: Vector;
  twcErr: number;
  lwLeftDir: number;
  lwRightDir: number;
  lwSpeed: number;
  lwErr: number;
}

export interface DatumResult {
  driftInterval: number;
  driftLeftDir: number;
  driftRightDir: number;
  driftSpeed: number;
  driftDistance: number;
  dve: number;
  datumLeft: LatLng;
  datumRight: LatLng;
  divergenceDistance: number;
  De: number;
}

export function computeDatum(input: DatumInput): DatumResult {
  const driftLeftVec = addVectors(
    input.twc,
    { dir: input.lwLeftDir, mag: input.lwSpeed },
  );
  const driftRightVec = addVectors(
    input.twc,
    { dir: input.lwRightDir, mag: input.lwSpeed },
  );
  const driftDistance = driftLeftVec.mag * input.driftInterval;

  const datumLeft = project(input.start, driftLeftVec.dir, driftDistance);
  const datumRight = project(input.start, driftRightVec.dir, driftDistance);

  const dve = Math.sqrt(
    input.aswdve ** 2 + input.twcErr ** 2 + input.lwErr ** 2,
  );
  const De = dve * input.driftInterval;
  const divergenceDistance = distanceNm(datumLeft, datumRight);

  return {
    driftInterval: input.driftInterval,
    driftLeftDir: driftLeftVec.dir,
    driftRightDir: driftRightVec.dir,
    driftSpeed: driftLeftVec.mag,
    driftDistance,
    dve,
    datumLeft,
    datumRight,
    divergenceDistance,
    De,
  };
}

// ============================================================================
// SWEEP WIDTH (W)
// ============================================================================

export type SearchFacilityType =
  | 'merchant-vessel'
  | 'fixed-wing-aircraft'
  | 'helicopter'
  | 'small-vessel'
  | 'lifeboat';

export type SearchObjectCategory =
  | 'person-in-water'
  | 'raft-1-4-person'
  | 'raft-6-person'
  | 'raft-15-25-person'
  | 'small-fishing-vessel'
  | 'merchant-vessel'
  | 'sailboat'
  | 'aircraft-debris';

export interface SweepWidthInput {
  facility: SearchFacilityType;
  object: SearchObjectCategory;
  visibility: number;
  windSpeed: number;
  altitudeFt?: number;
  fw?: number;
  fv?: number;
  ff?: number;
}

const UNCORRECTED_SWEEP_WIDTHS: Record<
  SearchFacilityType,
  Partial<Record<SearchObjectCategory, number>>
> = {
  'merchant-vessel': {
    'person-in-water': 1.0,
    'raft-1-4-person': 2.5,
    'raft-6-person': 3.5,
    'raft-15-25-person': 4.5,
    'small-fishing-vessel': 5.5,
    'merchant-vessel': 9.0,
    sailboat: 5.5,
    'aircraft-debris': 3.5,
  },
  'fixed-wing-aircraft': {
    'person-in-water': 0.8,
    'raft-1-4-person': 2.8,
    'raft-6-person': 4.0,
    'raft-15-25-person': 5.5,
    'small-fishing-vessel': 6.5,
    'merchant-vessel': 11.0,
    sailboat: 6.5,
    'aircraft-debris': 4.0,
  },
  helicopter: {
    'person-in-water': 0.7,
    'raft-1-4-person': 2.5,
    'raft-6-person': 3.8,
    'raft-15-25-person': 5.0,
    'small-fishing-vessel': 6.0,
    'merchant-vessel': 10.0,
    sailboat: 6.0,
    'aircraft-debris': 3.8,
  },
  'small-vessel': {
    'person-in-water': 0.7,
    'raft-1-4-person': 2.0,
    'raft-6-person': 3.0,
    'raft-15-25-person': 4.0,
    'small-fishing-vessel': 5.0,
    'merchant-vessel': 8.0,
    sailboat: 5.0,
    'aircraft-debris': 3.0,
  },
  lifeboat: {
    'person-in-water': 0.6,
    'raft-1-4-person': 1.8,
    'raft-6-person': 2.8,
    'raft-15-25-person': 3.8,
    'small-fishing-vessel': 4.5,
    'merchant-vessel': 7.5,
    sailboat: 4.5,
    'aircraft-debris': 2.8,
  },
};

function weatherCorrection(windSpeed: number, visibility: number): number {
  let fw = 1.0;
  if (windSpeed > 30) fw *= 0.5;
  else if (windSpeed > 25) fw *= 0.7;
  else if (windSpeed > 20) fw *= 0.8;
  else if (windSpeed > 15) fw *= 0.9;
  if (visibility < 3) fw *= 0.5;
  else if (visibility < 5) fw *= 0.7;
  else if (visibility < 10) fw *= 0.85;
  return Math.max(0.3, Math.min(1.0, fw));
}

function velocityCorrection(facility: SearchFacilityType): number {
  switch (facility) {
    case 'fixed-wing-aircraft':
      return 0.9;
    case 'helicopter':
      return 0.95;
    default:
      return 1.0;
  }
}

export interface SweepWidthResult {
  Wu: number;
  fw: number;
  fv: number;
  ff: number;
  W: number;
}

export function computeSweepWidth(input: SweepWidthInput): SweepWidthResult {
  const Wu = UNCORRECTED_SWEEP_WIDTHS[input.facility][input.object] ?? 2.0;
  const fw = input.fw ?? weatherCorrection(input.windSpeed, input.visibility);
  const fv = input.fv ?? velocityCorrection(input.facility);
  const ff = input.ff ?? 1.0;
  const W = Wu * fw * fv * ff;
  return { Wu, fw, fv, ff, W };
}

// ============================================================================
// SEARCH EFFORT (Z)
// ============================================================================

export interface SearchFacilityInput {
  id: string;
  name: string;
  speed: number;
  endurance: number;
  daylightHours: number;
  W: number;
}

export interface SearchEffortResult {
  T: number;
  Z: number;
  facility: SearchFacilityInput;
}

export function computeSearchEffort(facility: SearchFacilityInput): SearchEffortResult {
  const T = 0.85 * Math.min(facility.endurance, facility.daylightHours);
  const Z = facility.speed * T * facility.W;
  return { T, Z, facility };
}

export function computeTotalSearchEffort(
  facilities: SearchFacilityInput[],
): {
  perFacility: SearchEffortResult[];
  Zta: number;
} {
  const perFacility = facilities.map(computeSearchEffort);
  const Zta = perFacility.reduce((sum, r) => sum + r.Z, 0);
  return { perFacility, Zta };
}

// ============================================================================
// EFFORT ALLOCATION
// ============================================================================

export type DatumType = 'point' | 'leeway-divergence' | 'line';

export interface EffortAllocationInput {
  type: DatumType;
  E: number;
  Zta: number;
  L?: number;
  DD?: number;
  previousZr?: number;
}

export interface EffortAllocationResult {
  type: DatumType;
  fZ: number;
  Zr: number;
  Zrc: number;
  fs: number;
  Ro: number;
  Ao: number;
  C: number;
  SR: number | null;
}

function lookupFsPoint(Zrc: number): number {
  if (Zrc < 0.5) return 0.55;
  if (Zrc < 1) return 0.7;
  if (Zrc < 2) return 0.85;
  if (Zrc < 3) return 0.95;
  if (Zrc < 5) return 1.05;
  if (Zrc < 8) return 1.2;
  if (Zrc < 12) return 1.35;
  if (Zrc < 18) return 1.5;
  if (Zrc < 25) return 1.65;
  if (Zrc < 35) return 1.8;
  if (Zrc < 50) return 1.95;
  return 2.1;
}

function lookupFsLine(Zrc: number): number {
  if (Zrc < 0.5) return 0.4;
  if (Zrc < 1) return 0.55;
  if (Zrc < 2) return 0.75;
  if (Zrc < 3) return 0.85;
  if (Zrc < 5) return 1.0;
  if (Zrc < 8) return 1.15;
  if (Zrc < 12) return 1.3;
  if (Zrc < 18) return 1.45;
  if (Zrc < 25) return 1.6;
  if (Zrc < 35) return 1.75;
  return 1.9;
}

export function computeEffortAllocation(
  input: EffortAllocationInput,
): EffortAllocationResult {
  const fZ =
    input.type === 'point' || input.type === 'leeway-divergence'
      ? input.E * input.E
      : input.E * (input.L ?? 1);
  const Zr = input.Zta / Math.max(0.0001, fZ);
  const Zrc = Zr + (input.previousZr ?? 0);

  const fs =
    input.type === 'line' ? lookupFsLine(Zrc) : lookupFsPoint(Zrc);
  const Ro = fs * input.E;
  let Ao: number;
  if (input.type === 'point') {
    Ao = 4 * Ro * Ro;
  } else if (input.type === 'leeway-divergence') {
    Ao = (2 * Ro + (input.DD ?? 0)) * 2 * Ro;
  } else {
    Ao = 2 * Ro * (input.L ?? 1);
  }
  const C = input.Zta / Math.max(0.0001, Ao);
  const SR =
    input.type === 'leeway-divergence'
      ? (input.DD ?? 0) / Math.max(0.0001, input.E)
      : null;

  return {
    type: input.type,
    fZ,
    Zr,
    Zrc,
    fs,
    Ro,
    Ao,
    C,
    SR,
  };
}

// ============================================================================
// POD
// ============================================================================

export type SearchConditions = 'ideal' | 'normal';

export function computePOD(C: number, conditions: SearchConditions): number {
  if (C <= 0) return 0;
  if (conditions === 'ideal') {
    return Math.min(0.99, 1 - Math.exp(-C * 1.6));
  } else {
    return Math.min(0.99, 1 - Math.exp(-C));
  }
}

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

export function formatNumber(n: number, decimals = 2): string {
  if (!isFinite(n)) return '—';
  return n.toFixed(decimals);
}

export function formatLatLng(p: LatLng): string {
  const format = (value: number, axis: 'lat' | 'lng') => {
    const absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    const minuteValue = (absolute - degrees) * 60;
    const minutes = Math.floor(minuteValue);
    const seconds = Math.round((minuteValue - minutes) * 60);
    let d = degrees;
    let m = minutes;
    let s = seconds;
    if (s >= 60) { s -= 60; m += 1; }
    if (m >= 60) { m -= 60; d += 1; }
    const hemisphere = axis === 'lat'
      ? (value >= 0 ? 'N' : 'S')
      : (value >= 0 ? 'E' : 'W');
    return `${String(d).padStart(axis === 'lat' ? 2 : 3, '0')}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″${hemisphere}`;
  };
  return `${format(p.lat, 'lat')} ${format(p.lng, 'lng')}`;
}

export function formatDir(deg: number): string {
  return `${normalizeAngle(deg).toFixed(1)}°T`;
}

export function dirToCompass(deg: number): string {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  const idx = Math.round(normalizeAngle(deg) / 22.5) % 16;
  return dirs[idx];
}
