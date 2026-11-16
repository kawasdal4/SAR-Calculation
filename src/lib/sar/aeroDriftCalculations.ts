/** Aeronautical drift calculations for worksheet appendices K-6/K-7. */

import {
  type LatLng,
  type Vector,
  project,
  addVectors,
} from './sarCalculations';

export type HeadingReference = 'true' | 'magnetic' | 'compass';
export type EastWest = 'E' | 'W';

export interface AeroDriftInput {
  caseTitle: string;
  caseNumber: string;
  date: string;
  plannerName: string;
  searchObject: string;
  incidentPos: LatLng;
  incidentTime: string;
  useAircraftGlide: boolean;
  aircraftAltMaxFt: number;
  aircraftAltMinFt: number;
  aircraftGlideRatio: number;
  aircraftTASgKts: number;
  aircraftDescentHeadingDeg?: number;
  aircraftHeadingReference: HeadingReference;
  useParachute: boolean;
  parachuteType: 'steerable' | 'round-zero-glide';
  parachuteAltMaxFt: number;
  parachuteTerrainAltFt: number;
  parachuteGlideRatio?: number;
  parachuteTASgKts?: number;
  parachuteRateOfDescentFtMin: number;
  parachuteDescentHeadingDeg?: number;
  parachuteHeadingReference: HeadingReference;
  magneticVariationDeg?: number;
  magneticVariationDirection: EastWest;
  aircraftDeviationDeg?: number;
  aircraftDeviationDirection: EastWest;
  parachuteDeviationDeg?: number;
  parachuteDeviationDirection: EastWest;
  awaIsValid: boolean;
  awaGlideDirFrom: number;
  awaGlideSpeedKts: number;
  fixErrorXNm: number;
  safetyFactorFs: number;
}

export interface AeroDriftResult {
  incidentPos: LatLng;
  aircraftActive: boolean;
  parachuteActive: boolean;
  positionValid: boolean;
  validationErrors: string[];
  aircraftDescentHeadingTrueDeg: number | null;
  parachuteDescentHeadingTrueDeg: number | null;
  aircraftAltLossFt: number;
  aircraftRateOfDescentFtMin: number;
  aircraftTimeOfDescentMin: number;
  aircraftGlideDistanceNm: number;
  aircraftGlideVector: Vector;
  aircraftWindVector: Vector;
  aircraftWindDisplacementNm: number;
  aircraftWindDisplacementDir: number;
  aircraftGlideDisplacementVector: Vector;
  aircraftEndGlidePos: LatLng;
  parachuteAltLossFt: number;
  parachuteRateOfDescentFtMin: number;
  parachuteTimeOfDescentMin: number;
  parachuteGlideDistanceNm: number;
  parachuteGlideVector: Vector;
  parachuteWindVector: Vector;
  parachuteWindDisplacementNm: number;
  parachuteWindDisplacementDir: number;
  parachuteDisplacementVector: Vector;
  landingPos: LatLng;
  totalDisplacementNm: number;
  totalDisplacementDir: number;
  /** Uncertainty belongs to the separate A.5 worksheet. */
  driftErrorDeNm: number | null;
  searchRadiusRNm: number | null;
  searchAreaAoNm2: number | null;
}

export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Convert a reported heading to True. East variation/deviation is positive. */
export function convertHeadingToTrue(
  headingDeg: number | undefined,
  reference: HeadingReference,
  variationDeg?: number,
  variationDirection: EastWest = 'E',
  deviationDeg?: number,
  deviationDirection: EastWest = 'E',
): number | null {
  if (headingDeg === undefined || !Number.isFinite(headingDeg)) return null;
  if (reference === 'true') return normalizeHeading(headingDeg);
  if (variationDeg === undefined || !Number.isFinite(variationDeg)) return null;

  const variation = variationDeg * (variationDirection === 'E' ? 1 : -1);
  if (reference === 'magnetic') return normalizeHeading(headingDeg + variation);
  if (deviationDeg === undefined || !Number.isFinite(deviationDeg)) return null;

  const deviation = deviationDeg * (deviationDirection === 'E' ? 1 : -1);
  return normalizeHeading(headingDeg + deviation + variation);
}

/** Calculate drift and geodesic resultant. No assumed heading or parachute ROD is used. */
export function calculateAeroDrift(input: AeroDriftInput): AeroDriftResult {
  const errors: string[] = [];
  const windToDeg = normalizeHeading(input.awaGlideDirFrom + 180);
  const awaReady = input.awaIsValid && Number.isFinite(input.awaGlideSpeedKts) &&
    input.awaGlideSpeedKts >= 0 && Number.isFinite(input.awaGlideDirFrom);
  if (!input.awaIsValid) errors.push('AWA belum tersedia atau belum valid.');
  else if (!awaReady) errors.push('AWA tidak valid: arah harus numerik dan kecepatan tidak boleh negatif.');

  let aircraftAltLossFt = 0;
  let aircraftRODFtMin = 0;
  let aircraftTdMin = 0;
  let aircraftGlideDistNm = 0;
  let aircraftWindDispNm = 0;
  let aircraftGlideVector: Vector = { mag: 0, dir: 0 };
  let aircraftWindVector: Vector = { mag: 0, dir: windToDeg };
  let aircraftVector: Vector = { mag: 0, dir: 0 };
  let aircraftEndGlidePos = input.incidentPos;
  let aircraftReady = !input.useAircraftGlide;
  let aircraftHeadingTrue: number | null = null;

  if (input.useAircraftGlide) {
    const altitudeValid = input.aircraftAltMaxFt > input.aircraftAltMinFt && input.aircraftAltMinFt >= 0;
    const glideValid = input.aircraftGlideRatio > 0 && input.aircraftTASgKts > 0;
    if (!altitudeValid) errors.push('Validasi B.1-B.3 pesawat: Altmax harus lebih besar dari Altmin.');
    if (input.aircraftGlideRatio <= 0) errors.push('Validasi B.4 pesawat: glide ratio harus lebih besar dari 0.');
    if (input.aircraftTASgKts <= 0) errors.push('Validasi B.5 pesawat: Glide TAS harus lebih besar dari 0 kts.');

    aircraftHeadingTrue = convertHeadingToTrue(
      input.aircraftDescentHeadingDeg,
      input.aircraftHeadingReference,
      input.magneticVariationDeg,
      input.magneticVariationDirection,
      input.aircraftDeviationDeg,
      input.aircraftDeviationDirection,
    );
    if (aircraftHeadingTrue === null) {
      errors.push(input.aircraftDescentHeadingDeg === undefined
        ? 'B.9 pesawat belum diketahui; posisi akhir tidak dapat dipastikan.'
        : 'B.9 pesawat belum dapat dikonversi ke True; periksa variasi dan deviasi.');
    }
    if (altitudeValid && glideValid) {
      aircraftAltLossFt = input.aircraftAltMaxFt - input.aircraftAltMinFt;
      aircraftRODFtMin = (input.aircraftTASgKts * 101) / input.aircraftGlideRatio;
      aircraftTdMin = aircraftAltLossFt / aircraftRODFtMin;
      aircraftGlideDistNm = (input.aircraftTASgKts * aircraftTdMin) / 60;
      if (awaReady) aircraftWindDispNm = (aircraftTdMin * input.awaGlideSpeedKts) / 60;
      if (aircraftHeadingTrue !== null) aircraftGlideVector = { mag: aircraftGlideDistNm, dir: aircraftHeadingTrue };
      if (awaReady) aircraftWindVector = { mag: aircraftWindDispNm, dir: windToDeg };
    }
    aircraftReady = altitudeValid && glideValid && awaReady && aircraftHeadingTrue !== null;
    if (aircraftReady) {
      aircraftVector = addVectors(aircraftGlideVector, aircraftWindVector);
      aircraftEndGlidePos = project(input.incidentPos, aircraftVector.dir, aircraftVector.mag);
    }
  }

  let parachuteAltLossFt = 0;
  let parachuteRODFtMin = 0;
  let parachuteTdMin = 0;
  let parachuteGlideDistNm = 0;
  let parachuteWindDispNm = 0;
  let parachuteGlideVector: Vector = { mag: 0, dir: 0 };
  let parachuteWindVector: Vector = { mag: 0, dir: windToDeg };
  let parachuteVector: Vector = { mag: 0, dir: 0 };
  let parachuteHeadingTrue: number | null = null;
  let parachuteReady = !input.useParachute;

  if (input.useParachute) {
    const altitudeValid = input.parachuteAltMaxFt > input.parachuteTerrainAltFt && input.parachuteTerrainAltFt >= 0;
    const rateValid = input.parachuteRateOfDescentFtMin > 0;
    if (!altitudeValid) errors.push('Validasi B.1-B.3 parasut: Altmax harus lebih besar dari ketinggian terrain.');
    if (!rateValid) errors.push('B.6 parasut: masukkan laju turun dari tabel N-13; nilai tidak diasumsikan.');

    let glideValid = true;
    if (input.parachuteType === 'steerable') {
      glideValid = (input.parachuteGlideRatio ?? 0) > 0 && (input.parachuteTASgKts ?? 0) > 0;
      if ((input.parachuteGlideRatio ?? 0) <= 0) errors.push('B.4 parasut steerable: glide ratio harus lebih besar dari 0.');
      if ((input.parachuteTASgKts ?? 0) <= 0) errors.push('B.5 parasut steerable: Glide TAS harus lebih besar dari 0 kts.');
      parachuteHeadingTrue = convertHeadingToTrue(
        input.parachuteDescentHeadingDeg,
        input.parachuteHeadingReference,
        input.magneticVariationDeg,
        input.magneticVariationDirection,
        input.parachuteDeviationDeg,
        input.parachuteDeviationDirection,
      );
      if (parachuteHeadingTrue === null) {
        errors.push(input.parachuteDescentHeadingDeg === undefined
          ? 'B.9 parasut steerable belum diketahui; posisi akhir tidak dapat dipastikan.'
          : 'B.9 parasut steerable belum dapat dikonversi ke True; periksa variasi dan deviasi.');
      }
    }

    if (altitudeValid && rateValid && glideValid) {
      parachuteAltLossFt = input.parachuteAltMaxFt - input.parachuteTerrainAltFt;
      parachuteRODFtMin = input.parachuteRateOfDescentFtMin;
      parachuteTdMin = parachuteAltLossFt / parachuteRODFtMin;
      if (input.parachuteType === 'steerable') {
        parachuteGlideDistNm = ((input.parachuteTASgKts ?? 0) * parachuteTdMin) / 60;
        if (parachuteHeadingTrue !== null) {
          parachuteGlideVector = { mag: parachuteGlideDistNm, dir: parachuteHeadingTrue };
        }
      }
      if (awaReady) parachuteWindDispNm = (parachuteTdMin * input.awaGlideSpeedKts) / 60;
      if (awaReady) parachuteWindVector = { mag: parachuteWindDispNm, dir: windToDeg };
    }

    parachuteReady = altitudeValid && rateValid && glideValid && awaReady &&
      (input.parachuteType === 'round-zero-glide' || parachuteHeadingTrue !== null);
    if (parachuteReady) {
      parachuteVector = input.parachuteType === 'steerable'
        ? addVectors(parachuteGlideVector, parachuteWindVector)
        : parachuteWindVector;
    }
  }

  const hasSegment = input.useAircraftGlide || input.useParachute;
  if (!hasSegment) errors.push('Pilih segmen pesawat dan/atau parasut untuk mulai menghitung.');
  const positionValid = hasSegment && aircraftReady && parachuteReady;
  const resultantVector = positionValid
    ? addVectors(
      input.useAircraftGlide ? aircraftVector : { mag: 0, dir: 0 },
      input.useParachute ? parachuteVector : { mag: 0, dir: 0 },
    )
    : { mag: 0, dir: 0 };
  const landingPos = positionValid
    ? project(input.incidentPos, resultantVector.dir, resultantVector.mag)
    : input.incidentPos;

  const totalDisplacementNm = positionValid ? resultantVector.mag : 0;
  const totalDisplacementDir = positionValid ? resultantVector.dir : 0;

  return {
    incidentPos: input.incidentPos,
    aircraftActive: input.useAircraftGlide,
    parachuteActive: input.useParachute,
    positionValid,
    validationErrors: [...new Set(errors)],
    aircraftDescentHeadingTrueDeg: aircraftHeadingTrue,
    parachuteDescentHeadingTrueDeg: parachuteHeadingTrue,
    aircraftAltLossFt,
    aircraftRateOfDescentFtMin: aircraftRODFtMin,
    aircraftTimeOfDescentMin: aircraftTdMin,
    aircraftGlideDistanceNm: aircraftGlideDistNm,
    aircraftGlideVector,
    aircraftWindVector,
    aircraftWindDisplacementNm: aircraftWindDispNm,
    aircraftWindDisplacementDir: windToDeg,
    aircraftGlideDisplacementVector: aircraftVector,
    aircraftEndGlidePos,
    parachuteAltLossFt,
    parachuteRateOfDescentFtMin: parachuteRODFtMin,
    parachuteTimeOfDescentMin: parachuteTdMin,
    parachuteGlideDistanceNm: parachuteGlideDistNm,
    parachuteGlideVector,
    parachuteWindVector,
    parachuteWindDisplacementNm: parachuteWindDispNm,
    parachuteWindDisplacementDir: windToDeg,
    parachuteDisplacementVector: parachuteVector,
    landingPos,
    totalDisplacementNm,
    totalDisplacementDir,
    driftErrorDeNm: null,
    searchRadiusRNm: null,
    searchAreaAoNm2: null,
  };
}
