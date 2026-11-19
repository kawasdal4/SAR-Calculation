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

/**
 * Parse ketinggian (feet) dari angka atau teks bebas — AI kadang mengirim
 * altObs "Surface" (bukan "0") atau distressAltFt sebagai string "10000";
 * sebelumnya Number("Surface") → NaN membuat computeAWA menolak SELURUH
 * perhitungan (semua kolom worksheet jadi "—"). Bentuk yang dikenali:
 * 0/"Surface"/"permukaan" → 0, "FL090" → 9000, "3.000 ft"/"3,000 feet" → 3000,
 * "3000" → 3000. Selain itu NaN.
 */
export function parseAltitudeFt(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== 'string') return Number.NaN;
  const text = value.trim().toLowerCase();
  if (!text) return Number.NaN;
  if (/^(surface|permukaan|sea level|mds)(\s|$)/.test(text)) return 0;
  const flMatch = text.match(/^fl\s*0*(\d{1,3})$/);
  if (flMatch) return Number(flMatch[1]) * 100;
  // Buang satuan lalu pemisah ribuan ("3.000 ft" → 3000); ketinggian pengamatan
  // selalu bilangan bulat feet, jadi pemisah desimal tidak dipakai di sini.
  const cleaned = text.replace(/ft|feet|kaki/g, '').replace(/[.\s,]/g, '');
  return /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
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

  // Target bisa datang sebagai string dari state tersimpan/argumen AI — koerce
  // di sini agar satu titik masuk menoleransi bentuk apa pun.
  const targetAltitude = parseAltitudeFt(targetAltitudeFt);
  if (!Number.isFinite(targetAltitude) || targetAltitude <= 0) {
    errors.push('Ketinggian target harus lebih besar dari 0 ft.');
  }
  if (!Array.isArray(observations) || observations.length === 0) {
    errors.push('Tambahkan data pengamatan angin terlebih dahulu.');
    return emptyResult(errors);
  }

  const parsed = observations.map((obs, inputIndex) => {
    const hasAltitudeText = typeof obs.altObs === 'string';
    const altitudeValue = hasAltitudeText
      ? parseAltitudeFt(obs.altObs)
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
    Number.isFinite(targetAltitude) &&
    targetAltitude > 0 &&
    validLevels.length > 0 &&
    validLevels[validLevels.length - 1].altitudeFt < targetAltitude
  ) {
    errors.push(`Data angin tertinggi (${validLevels[validLevels.length - 1].altitudeFt} ft) belum mencapai target ${targetAltitude} ft; tambahkan level di atau di atas target.`);
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
      targetAltitude,
      next ? (observation.altitudeFt + next.altitudeFt) / 2 : targetAltitude,
    );
    const hasLayer = layerHigh > layerLow && layerLow < targetAltitude;
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

// WIND CURRENT (WC) WORKSHEET — Figure I-1 (Appendix I, AL1/04)
// Ketentuan Worksheet 1 (Panduan Datum Worksheet 1, bagian 3.3): kecepatan
// wind current = WC_COEF × kecepatan angin (garis lurus Fig. I-1: 10 kn → 0,36,
// 24 kn → 0,87, 34 kn → 1,25 kn ≈ 0,036 × angin), divergensi dari downwind
// mengikuti kotak Figure I-1: 10°N–10°S → 0°, di utara 10°N → 30° ke kanan,
// di selatan 10°S → 30° ke kiri (sisi kiri/kanan ditangani hemisphere di
// computeWC). Koefisien adalah ASUMSI yang mudah diubah (bagian 10 no. 1
// panduan) — implementasi lengkap rantai datum ada di src/lib/sar/datumWs1.ts.

/** Koefisien arus angin Figure I-1 (≈ 0,036 × kecepatan angin) — mudah diubah. */
export const WC_COEF = 0.036;

export function windCurrentDrift(aswSpeed: number): number {
  return aswSpeed * WC_COEF;
}

export function windCurrentDivergence(absLat: number): number {
  return absLat <= 10 ? 0 : 30;
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

// Nilai multiplier/modifier/divergence didigitasi langsung dari Table I-1 dan
// Table I-2 (Appendix I AL1/04) — dipilih berdasarkan keterangan
// 'Search target (description)' pada Worksheet 1. probableError mengikuti
// nilai kelompok yang sudah ada sebelumnya pada tiap kategori.
export const LEEWAY_OBJECT_TYPES: LeewayObjectType[] = [
  // ── PIW (Persons In Water) — Table I-1 ──
  {
    id: 'piw-novice',
    label: 'PIW – Umum / general (Table I-1)',
    leewayRate: 0.011,
    leewayModifier: 0.07,
    divergenceAngle: 30,
    probableError: 0.07,
  },
  {
    id: 'piw-sitting',
    label: 'PIW – Sitting (posisi fetal)',
    leewayRate: 0.012,
    leewayModifier: 0.00,
    divergenceAngle: 18,
    probableError: 0.07,
  },
  {
    id: 'piw-vertical-2',
    label: 'PIW – Vertical',
    leewayRate: 0.005,
    leewayModifier: 0.07,
    divergenceAngle: 18,
    probableError: 0.07,
  },
  {
    id: 'piw-lifejacket',
    label: 'PIW – Horizontal, Survival Suit',
    leewayRate: 0.014,
    leewayModifier: 0.10,
    divergenceAngle: 30,
    probableError: 0.07,
  },
  {
    id: 'piw-scuba',
    label: 'PIW – Horizontal, Scuba Suit',
    leewayRate: 0.007,
    leewayModifier: 0.08,
    divergenceAngle: 30,
    probableError: 0.07,
  },
  {
    id: 'piw-deceased',
    label: 'PIW – Horizontal, Deceased',
    leewayRate: 0.015,
    leewayModifier: 0.08,
    divergenceAngle: 30,
    probableError: 0.07,
  },
  // ── Survival Craft: Maritime Life Rafts, No Ballast Systems — Table I-1 ──
  {
    id: 'raft-1520-person',
    label: 'Maritime life raft – Umum / avg (Table I-1)',
    leewayRate: 0.042,
    leewayModifier: 0.03,
    divergenceAngle: 28,
    probableError: 0.18,
  },
  {
    id: 'raft-46-person',
    label: 'Liferaft no ballast systems, no canopy, no drogue',
    leewayRate: 0.057,
    leewayModifier: 0.21,
    divergenceAngle: 24,
    probableError: 0.18,
  },
  {
    id: 'raft-noballast-drogue',
    label: 'Liferaft no ballast, no canopy, with drogue',
    // Table I-1: No Ballast Systems — no canopy, w/ drogue.
    leewayRate: 0.044,
    leewayModifier: -0.2,
    divergenceAngle: 28,
    probableError: 0.18,
  },
  {
    id: 'raft-canopy-no-drogue',
    label: 'Liferaft no ballast, canopy, no drogue',
    leewayRate: 0.037,
    leewayModifier: 0.11,
    divergenceAngle: 24,
    probableError: 0.16,
  },
  {
    id: 'raft-canopy-drogue',
    label: 'Liferaft no ballast, canopy, with drogue',
    leewayRate: 0.030,
    leewayModifier: 0,
    divergenceAngle: 28,
    probableError: 0.12,
  },
  // ── Survival Craft: Shallow Ballast Systems and Canopy — Table I-1 ──
  {
    id: 'dinghy-upright',
    label: 'Maritime life raft – Shallow ballast & canopy (general)',
    leewayRate: 0.029,
    leewayModifier: 0,
    divergenceAngle: 22,
    probableError: 0.18,
  },
  {
    id: 'raft-shallow-ballast-nodrogue',
    label: 'Shallow ballast & canopy, no drogue',
    leewayRate: 0.032,
    leewayModifier: -0.02,
    divergenceAngle: 22,
    probableError: 0.18,
  },
  {
    id: 'raft-shallow-ballast-drogue',
    label: 'Shallow ballast & canopy, with drogue',
    leewayRate: 0.025,
    leewayModifier: 0.01,
    divergenceAngle: 22,
    probableError: 0.18,
  },
  {
    id: 'dinghy-fibreglass',
    label: 'Maritime life raft – Shallow ballast, capsized',
    leewayRate: 0.017,
    leewayModifier: -0.10,
    divergenceAngle: 8,
    probableError: 0.12,
  },
  // ── Survival Craft: Deep Ballast — Table I-1 / Table I-2 ──
  {
    id: 'raft-deep-ballast',
    label: 'Deep ballast systems & canopies (general, Table I-1)',
    leewayRate: 0.030,
    leewayModifier: 0.02,
    divergenceAngle: 13,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-raft-default',
    label: 'Deep ballast life raft (Table I-2 default)',
    leewayRate: 0.029,
    leewayModifier: 0.04,
    divergenceAngle: 15,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-46-wodrogue-light',
    label: 'Deep ballast 4-6 person, w/o drogue, light loading',
    leewayRate: 0.038,
    leewayModifier: -0.04,
    divergenceAngle: 15,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-46-wodrogue-heavy',
    label: 'Deep ballast 4-6 person, w/o drogue, heavy loading',
    leewayRate: 0.036,
    leewayModifier: -0.03,
    divergenceAngle: 15,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-46-drogue-light',
    label: 'Deep ballast 4-6 person, with drogue, light loading',
    leewayRate: 0.016,
    leewayModifier: 0.05,
    divergenceAngle: 24,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-46-drogue-heavy',
    label: 'Deep ballast 4-6 person, with drogue, heavy loading',
    leewayRate: 0.021,
    leewayModifier: 0.00,
    divergenceAngle: 20,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-1525-default',
    label: 'Deep ballast 15-25 person (default)',
    leewayRate: 0.036,
    leewayModifier: -0.09,
    divergenceAngle: 10,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-1525-wodrogue-light',
    label: 'Deep ballast 15-25 person, w/o drogue, light loading',
    leewayRate: 0.039,
    leewayModifier: -0.06,
    divergenceAngle: 9,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-1525-drogue',
    label: 'Deep ballast 15-25 person, with drogue (heavy loading)',
    leewayRate: 0.031,
    leewayModifier: -0.07,
    divergenceAngle: 9,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-capsized',
    label: 'Deep ballast life raft, capsized',
    leewayRate: 0.009,
    leewayModifier: 0.00,
    divergenceAngle: 12,
    probableError: 0.12,
  },
  {
    id: 'deep-ballast-swamped',
    label: 'Deep ballast life raft, swamped',
    leewayRate: 0.010,
    leewayModifier: -0.04,
    divergenceAngle: 8,
    probableError: 0.12,
  },
  // ── Other Maritime Survival Craft / Aviation Life Rafts — Table I-1 ──
  {
    id: 'life-capsule',
    label: 'Life capsule',
    leewayRate: 0.038,
    leewayModifier: -0.08,
    divergenceAngle: 22,
    probableError: 0.12,
  },
  {
    id: 'uscg-sea-rescue-kit',
    label: 'USCG Sea Rescue Kit',
    leewayRate: 0.025,
    leewayModifier: -0.04,
    divergenceAngle: 7,
    probableError: 0.12,
  },
  {
    id: 'raft-aviation-46',
    label: 'Aviation life raft, no ballast w/ canopy, 4-6 person w/o drogue',
    leewayRate: 0.037,
    leewayModifier: 0.11,
    divergenceAngle: 24,
    probableError: 0.18,
  },
  {
    id: 'raft-evac-slide',
    label: 'Aviation life raft – Evac/Slide, 46-person',
    leewayRate: 0.028,
    leewayModifier: -0.01,
    divergenceAngle: 15,
    probableError: 0.18,
  },
  // ── Person-Powered Craft — Table I-1 ──
  {
    id: 'sea-kayak',
    label: 'Sea kayak (w/ person on aft deck)',
    leewayRate: 0.011,
    leewayModifier: 0.24,
    divergenceAngle: 15,
    probableError: 0.18,
  },
  {
    id: 'surf-board',
    label: 'Surf board (w/ person)',
    leewayRate: 0.020,
    leewayModifier: 0.00,
    divergenceAngle: 15,
    probableError: 0.18,
  },
  {
    id: 'windsurfer',
    label: 'Windsurfer (w/ person and mast & sail in water)',
    leewayRate: 0.023,
    leewayModifier: 0.10,
    divergenceAngle: 12,
    probableError: 0.18,
  },
  // ── Sailing Vessels (Mono-hull) — Table I-1 ──
  {
    id: 'sailboat',
    label: 'Sailing vessel – Mono-hull, Full Keel (deep draft)',
    leewayRate: 0.030,
    leewayModifier: 0,
    divergenceAngle: 48,
    probableError: 0.18,
  },
  {
    id: 'sailboat-fin-keel',
    label: 'Sailing vessel – Mono-hull, Fin Keel (shoal draft)',
    leewayRate: 0.040,
    leewayModifier: 0.00,
    divergenceAngle: 48,
    probableError: 0.18,
  },
  // ── Power Vessels: Skiffs / Sport Boats / Sport Fisher — Table I-1 ──
  {
    id: 'skiff-flat-bottom',
    label: 'Skiff, Flat Bottom (Boston whaler)',
    leewayRate: 0.034,
    leewayModifier: 0.04,
    divergenceAngle: 22,
    probableError: 0.18,
  },
  {
    id: 'skiff-v-hull',
    label: 'Skiff, V-hull (std. configuration)',
    leewayRate: 0.030,
    leewayModifier: 0.08,
    divergenceAngle: 15,
    probableError: 0.18,
  },
  {
    id: 'skiff-swamped',
    label: 'Skiff, swamped',
    leewayRate: 0.017,
    leewayModifier: 0.00,
    divergenceAngle: 15,
    probableError: 0.18,
  },
  {
    id: 'sport-boat-cuddy',
    label: 'Sport boat, Cuddy Cabin (modified V-hull)',
    leewayRate: 0.069,
    leewayModifier: -0.08,
    divergenceAngle: 19,
    probableError: 0.18,
  },
  {
    id: 'sport-fisher-center-console',
    label: 'Sport fisher, Center Console (open cockpit)',
    leewayRate: 0.060,
    leewayModifier: -0.09,
    divergenceAngle: 22,
    probableError: 0.18,
  },
  // ── Power Vessels: Commercial Fishing Vessels — Table I-1 ──
  {
    id: 'small-fishing',
    label: 'Commercial fishing vessel (general)',
    leewayRate: 0.037,
    leewayModifier: 0.02,
    divergenceAngle: 48,
    probableError: 0.15,
  },
  {
    id: 'fishing-sampans',
    label: 'Commercial fishing – Sampans',
    leewayRate: 0.040,
    leewayModifier: 0.00,
    divergenceAngle: 48,
    probableError: 0.15,
  },
  {
    id: 'commercial-fishing',
    label: 'Commercial fishing – Side-stern Trawler',
    leewayRate: 0.042,
    leewayModifier: 0,
    divergenceAngle: 48,
    probableError: 0.12,
  },
  {
    id: 'fishing-longliners',
    label: 'Commercial fishing – Longliners',
    leewayRate: 0.037,
    leewayModifier: 0.00,
    divergenceAngle: 48,
    probableError: 0.15,
  },
  {
    id: 'fishing-junk',
    label: 'Commercial fishing – Junk',
    leewayRate: 0.027,
    leewayModifier: 0.10,
    divergenceAngle: 48,
    probableError: 0.15,
  },
  {
    id: 'fishing-gill-netter',
    label: 'Commercial fishing – Gill-netter (w/ rear reel)',
    leewayRate: 0.040,
    leewayModifier: 0.01,
    divergenceAngle: 33,
    probableError: 0.15,
  },
  // ── Coastal Freighter — Table I-1 ──
  {
    id: 'merchant-vessel',
    label: 'Coastal freighter',
    leewayRate: 0.028,
    leewayModifier: 0,
    divergenceAngle: 48,
    probableError: 0.10,
  },
  // ── Boating Debris — Table I-1 ──
  {
    id: 'debris-fv',
    label: 'Boating debris – F/V debris',
    leewayRate: 0.020,
    leewayModifier: 0.00,
    divergenceAngle: 10,
    probableError: 0.10,
  },
  {
    id: 'debris-bait-box',
    label: 'Bait/wharf box, cubic meter of ice (general)',
    leewayRate: 0.013,
    leewayModifier: 0.27,
    divergenceAngle: 31,
    probableError: 0.10,
  },
  {
    id: 'debris-bait-box-light',
    label: 'Bait/wharf box, lightly loaded (~200 lbs)',
    leewayRate: 0.026,
    leewayModifier: 0.18,
    divergenceAngle: 15,
    probableError: 0.10,
  },
  {
    id: 'debris-bait-box-full',
    label: 'Bait/wharf box, fully loaded (~800 lbs)',
    leewayRate: 0.016,
    leewayModifier: 0.16,
    divergenceAngle: 33,
    probableError: 0.10,
  },
];

export function getLeewayObjectById(id: string): LeewayObjectType {
  return LEEWAY_OBJECT_TYPES.find((t) => t.id === id) ?? LEEWAY_OBJECT_TYPES[0];
}

/**
 * Kata kunci 'Search target (description)' per baris Table I-1/I-2 (Appendix I).
 * Skor kecocokan = total panjang kata kunci yang ditemukan pada deskripsi
 * (kata kunci lebih panjang = lebih spesifik = skor lebih besar), sehingga
 * frasa gabungan (mis. 'no canopy no drogue') selalu mengalahkan kata umum
 * (mis. 'raft'). Terdiri atas istilah Table I-1 asli + padanan bahasa
 * Indonesia yang lazim dipakai pada soal kasus Basarnas.
 */
const LEEWAY_DESC_KEYWORDS: Record<string, string[]> = {
  // ── PIW (Table I-1) ──
  'piw-novice': ['piw', 'person in water', 'orang di air', 'man overboard', 'non-swimmer'],
  'piw-vertical-2': ['piw vertical', 'piw tegak', 'vertical', 'tegak'],
  'piw-sitting': ['piw sitting', 'sitting', 'duduk', 'fetal'],
  'piw-lifejacket': ['wearing lifejacket', 'wearing life jacket', 'mengenakan pelampung', 'survival suit', 'life jacket', 'lifejacket', 'pelampung', 'piw horizontal'],
  'piw-scuba': ['scuba', 'wetsuit'],
  'piw-deceased': ['deceased', 'meninggal', 'jenazah', 'korban jiwa', 'tewas'],
  // ── Maritime life rafts (Table I-1) ──
  'raft-1520-person': ['life raft', 'liferaft', 'rakit penyelamat', 'rakit', 'raft'],
  'raft-46-person': ['no canopy, no drogue', 'no canopy no drogue', 'tanpa canopy tanpa drogue', 'tanpa kanopi tanpa drogue', 'no canopy', 'tanpa canopy', 'tanpa kanopi'],
  'raft-noballast-drogue': ['no canopy, w/ drogue', 'no canopy with drogue', 'no canopy drogue', 'tanpa canopy dengan drogue', 'with drogue', 'dengan drogue', 'drogue'],
  'raft-canopy-no-drogue': ['canopy, no drogue', 'canopy no drogue', 'canopy without drogue', 'canopy tanpa drogue', 'kanopi tanpa drogue', 'canopy', 'kanopi'],
  'raft-canopy-drogue': ['canopy, w/ drogue', 'canopy with drogue', 'canopy drogue', 'canopy and drogue', 'canopy dan drogue', 'canopy dengan drogue', 'kanopi dengan drogue', 'kanopi dan drogue', 'kanopi drogue', 'canopy', 'kanopi'],
  'dinghy-upright': ['shallow ballast', 'ballast dangkal'],
  'raft-shallow-ballast-nodrogue': ['shallow ballast no drogue', 'shallow ballast, no drogue', 'shallow ballast without drogue', 'ballast dangkal tanpa drogue', 'ballast dangkal, tanpa drogue'],
  'raft-shallow-ballast-drogue': ['shallow ballast with drogue', 'shallow ballast, with drogue', 'shallow ballast drogue', 'ballast dangkal dengan drogue', 'ballast dangkal, dengan drogue'],
  'dinghy-fibreglass': ['shallow ballast capsized', 'shallow ballast terbalik', 'rakit terbalik', 'capsized', 'terbalik'],
  'raft-deep-ballast': ['deep ballast life raft', 'deep ballast', 'ballast dalam'],
  'deep-ballast-raft-default': ['deep ballast default', 'deep ballast umum'],
  'deep-ballast-46-wodrogue-light': ['4-6 person without drogue light', '4-6 orang tanpa drogue ringan', '4-6 person', '4-6 orang', '4-6'],
  'deep-ballast-46-wodrogue-heavy': ['4-6 person without drogue heavy', '4-6 orang tanpa drogue berat', 'without drogue heavy', 'tanpa drogue berat'],
  'deep-ballast-46-drogue-light': ['4-6 person with drogue light', '4-6 orang dengan drogue ringan', 'with drogue light', 'dengan drogue ringan'],
  'deep-ballast-46-drogue-heavy': ['4-6 person with drogue heavy', '4-6 orang dengan drogue berat', 'with drogue heavy', 'dengan drogue berat'],
  'deep-ballast-1525-default': ['15-25 person', '15-25 orang', '15-25'],
  'deep-ballast-1525-wodrogue-light': ['15-25 person w/o drogue light', '15-25 w/o drogue', '15-25 tanpa drogue ringan', '15-25 person', '15-25', 'w/o drogue'],
  'deep-ballast-1525-drogue': ['15-25 person with drogue', '15-25 dengan drogue', '15-25 person', '15-25', 'with drogue'],
  'deep-ballast-capsized': ['deep ballast capsized', 'deep ballast terbalik'],
  'deep-ballast-swamped': ['deep ballast swamped', 'deep ballast terisi air'],
  // ── Other maritime survival craft & aviation rafts (Table I-1) ──
  'life-capsule': ['capsule', 'kapsul'],
  'uscg-sea-rescue-kit': ['uscg', 'sea rescue kit'],
  'raft-aviation-46': ['aviation', 'raft pesawat', 'no ballast w/ canopy', 'aircraft raft'],
  'raft-evac-slide': ['evac', 'evacuation slide', 'slide raft', '46-person', '46 person'],
  // ── Person-powered craft (Table I-1) ──
  'sea-kayak': ['kayak'],
  'surf-board': ['surf board', 'surfboard', 'papan selancar'],
  'windsurfer': ['windsurfer', 'sailboard'],
  // ── Sailing vessels (Table I-1) ──
  'sailboat': ['full keel', 'mono-hull', 'monohull', 'sailing', 'yacht', 'kapal layar', 'layar'],
  'sailboat-fin-keel': ['fin keel'],
  // ── Power vessels (Table I-1) ──
  'skiff-flat-bottom': ['flat bottom', 'boston whaler', 'whaler'],
  'skiff-v-hull': ['v-hull', 'v hull', 'skiff'],
  'skiff-swamped': ['skiff swamped', 'perahu swamped', 'swamped', 'terisi air'],
  'sport-boat-cuddy': ['cuddy', 'sport boat'],
  'sport-fisher-center-console': ['center console', 'sport fisher', 'sportfisher'],
  'small-fishing': ['fishing vessel', 'kapal nelayan', 'kapal ikan', 'fishing'],
  'fishing-sampans': ['sampan'],
  'commercial-fishing': ['side-stern', 'side stern', 'trawler', 'pukat'],
  'fishing-longliners': ['longliner', 'longline'],
  'fishing-junk': ['junk', 'junco'],
  'fishing-gill-netter': ['gill-netter', 'gillnetter', 'gill netter', 'rear reel', 'gill'],
  'merchant-vessel': ['coastal freighter', 'freighter', 'merchant'],
  // ── Boating debris (Table I-1) ──
  'debris-fv': ['fishing vessel debris', 'f/v debris', 'fv debris', 'debris kapal nelayan', 'debris', 'puing'],
  'debris-bait-box': ['bait/wharf', 'bait box', 'kotak umpan', 'bait', 'wharf'],
  'debris-bait-box-light': ['bait box lightly', 'lightly loaded', 'beban ringan', 'bait/wharf', 'bait', 'wharf'],
  'debris-bait-box-full': ['bait box fully', 'fully loaded', 'beban penuh', 'bait/wharf', 'bait', 'wharf'],
};

/**
 * Hasil resolusi deskripsi 'Search target (description)' ke baris Table I-1/I-2.
 */
export interface LeewayDescriptionMatch {
  object: LeewayObjectType;
  score: number;
  matchedTerms: string[];
}

/**
 * Pilih baris Table I-1/I-2 (Appendix I) untuk Worksheet 1 dari keterangan
 * 'Search target (description)' — nilai Leeway speed = (Multiplier × Wind
 * Speed) ± Modifier WAJIB mengikuti baris ini. Pencocokan kata kunci
 * deterministik (tanpa AI): skor = total panjang kata kunci yang cocok;
 * bila tidak ada kata kunci yang cocok → undefined (pemilihan manual di
 * DatumWorksheet tetap berlaku; tidak mengarang baris Table I-1).
 */
export function resolveLeewayObjectFromDescription(description?: string | null): LeewayDescriptionMatch | undefined {
  const text = typeof description === 'string' ? description.toLowerCase() : '';
  if (text.trim() === '') return undefined;
  let best: { id: string; score: number; matched: string[] } | null = null;
  for (const entry of LEEWAY_OBJECT_TYPES) {
    const terms = LEEWAY_DESC_KEYWORDS[entry.id];
    if (!terms) continue;
    let score = 0;
    const matched: string[] = [];
    for (const term of terms) {
      if (text.includes(term)) {
        score += term.length;
        matched.push(term);
      }
    }
    if (score <= 0) continue;
    if (!best || score > best.score) best = { id: entry.id, score, matched };
  }
  if (!best) return undefined;
  return { object: getLeewayObjectById(best.id), score: best.score, matchedTerms: best.matched };
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
// WORKSHEET 1 - SEARCH AREA (PHASE 3 ekstraksi, rumus Worksheet1.tsx)
// ============================================================================

export interface Ws1SearchAreaInput {
  De: number;   // Total drift error (NM) — dari pengukuran peta atau estimasi datum
  X: number;    // Fix error distress craft (Table J)
  Y: number;    // Fix error SRU (Table J)
  fs: number;   // Safety factor (opsi Worksheet1: 1.1/1.6/2.0/2.3/2.5)
}

export interface Ws1SearchAreaResult {
  E: number;    // Total probable error E = √(De² + X² + Y²)
  E2: number;   // E² (ditampilkan Worksheet 1)
  R: number;    // Search radius R = ⌈E × fs⌉ (NM)
  Ao: number;   // Search area Ao = 4R² (NM²), persegi sisi 2R
}

/** Rumus Worksheet 1: E dari computeE existing, R dibulatkan ke atas, Ao = 4R². */
export function computeWs1SearchArea(input: Ws1SearchAreaInput): Ws1SearchAreaResult {
  const { E, E2 } = computeE({ X: input.X, De: input.De, Y: input.Y });
  const R = Math.ceil(E * input.fs);
  return { E, E2, R, Ao: 4 * R * R };
}

// ============================================================================
// WORKSHEET 1 - SAFETY FACTOR & TABLE J-1 (nav fix errors)
// ============================================================================

/**
 * Safety factor (circle) fs menurut urutan pencarian (ketentuan Basarnas):
 * pencarian pertama → 1.1, kedua → 1.6, ketiga → 2.0, keempat → 2.3, kelima → 2.5.
 */
export const WS1_FS_OPTIONS = [1.1, 1.6, 2.0, 2.3, 2.5] as const;

/** Persentase drift error (de) default Worksheet 1. */
export const WS1_DEFAULT_DRIFT_ERROR_PERCENT = 12.5;

export interface TableJ1Entry {
  id: string;
  label: string;
  /** Estimated navigational fix error in NM (Table J-1, Appendix J). */
  errorNm: number;
}

/**
 * Table J-1 (Appendix J): estimated navigational position errors.
 * Dipakai untuk x (distress craft error) dan y (search craft error) Worksheet 1
 * sesuai alat navigasi yang disebut dalam soal kasus.
 * (Panduan Datum Worksheet 1 bagian 3.7 — Tabel J-1.)
 */
export const TABLE_J1_NAV_ERRORS: TableJ1Entry[] = [
  { id: 'gps', label: 'GPS', errorNm: 0.1 },
  { id: 'radar', label: 'Radar', errorNm: 1.0 },
  { id: 'visual', label: 'Visual fix (3 garis)', errorNm: 1.0 },
  { id: 'celestial', label: 'Celestial fix (3 garis)', errorNm: 2.0 },
  { id: 'marine-radio-beacon', label: 'Marine Radio Beacon (fix 3 beacon)', errorNm: 4.0 },
  { id: 'loran-c', label: 'LORAN C', errorNm: 1.0 },
  { id: 'ins', label: 'INS (0,5 NM per jam tanpa update)', errorNm: 0.5 },
  { id: 'vor-tacan', label: 'VOR/TACAN (min radius 0,5 NM)', errorNm: 0.5 },
];

/**
 * Table J-2 (Appendix J): galat posisi bila navigasi tidak diketahui /
 * untuk area praktis (Panduan Datum Worksheet 1 bagian 3.7).
 */
export const TABLE_J2_NAV_ERRORS: TableJ1Entry[] = [
  { id: 'j2-ship', label: 'J-2: Kapal / kapal selam militer', errorNm: 5.0 },
  { id: 'j2-aircraft-self', label: 'J-2: Pesawat dgn sistem navigasi mandiri', errorNm: 5.0 },
  { id: 'j2-aircraft-other', label: 'J-2: Pesawat (lainnya)', errorNm: 10.0 },
  { id: 'j2-small-craft', label: 'J-2: Kapal kecil / submersible', errorNm: 15.0 },
];

/**
 * Table J-3 (Appendix J): galat dead reckoning (DRe) — galat fix positif
 * terakhir + persentase jarak dari fix tersebut. Nilai `errorNm` di sini
 * adalah persentase jarak (%), bukan NM, karena DRe tergantung jarak DR.
 */
export const TABLE_J3_DR_ERRORS: TableJ1Entry[] = [
  { id: 'j3-ship', label: 'J-3 DR: Kapal / kapal selam militer (+5% jarak)', errorNm: 5.0 },
  { id: 'j3-aircraft', label: 'J-3 DR: Pesawat (+10% jarak)', errorNm: 10.0 },
  { id: 'j3-small-craft', label: 'J-3 DR: Kapal kecil / submersible (+15% jarak)', errorNm: 15.0 },
];

/** Gabungan Tabel J-1 + J-2 untuk pemilih x/y di UI (area praktis: J-2). */
export const TABLE_J_ALL_NAV_ERRORS: TableJ1Entry[] = [
  ...TABLE_J1_NAV_ERRORS,
  ...TABLE_J2_NAV_ERRORS,
];

export function getTableJ1ErrorById(id: string): number | undefined {
  return TABLE_J1_NAV_ERRORS.find((e) => e.id === id)?.errorNm;
}

/** Label alat navigasi Table J-1/J-2 untuk tampilan (mis. 'gps' → 'GPS'). */
export function getNavAidLabelById(id: string): string | undefined {
  return TABLE_J_ALL_NAV_ERRORS.find((e) => e.id === id)?.label;
}

/**
 * Pemetaan deterministik id alat navigasi (Table J-1/J-2, Appendix J) → fix error NM.
 * Dipakai AIChatPanel untuk mengonversi xNavAid/yNavAid dari AI (mis. 'gps' → 0.1 NM)
 * sehingga fix error search/distress craft SELALU berasal dari Table J — bukan
 * angka yang dikira-kira model. ID tidak dikenal → undefined (fallback ke X/Y numerik).
 */
export function mapNavAidToFixError(id?: string | null): number | undefined {
  if (!id) return undefined;
  const normalized = String(id).toLowerCase().trim();
  return TABLE_J_ALL_NAV_ERRORS.find((e) => e.id === normalized)?.errorNm;
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

// computePOD pindah ke wscPodTables.ts (berdampingan dengan readFigureI12,
// rumus polinomial Excel POD.xls) agar berkas ini tetap bebas dependensi
// internal dan aman diimpor langsung oleh node --test tests/*.test.mjs.

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
