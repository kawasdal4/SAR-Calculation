/**
 * Aeronautical Drift Calculations Engine
 * Berdasarkan IAMSAR Manual Volume II Appendix K-5, K-6, K-7
 * (Aeronautical Drift Worksheet & Average Wind Aloft)
 */

import {
  type LatLng,
  type Vector,
  project,
  distanceNm,
  bearingDeg,
  addVectors,
  vectorToUV,
  uvToVector,
} from './sarCalculations';

export interface AeroDriftInput {
  caseTitle: string;
  caseNumber: string;
  date: string;
  plannerName: string;
  searchObject: string;

  // A. Incident / Bailout Position
  incidentPos: LatLng;
  incidentTime: string; // ISO or HH:mm

  // B. Aircraft Glide Displacement
  useAircraftGlide: boolean;
  aircraftAltMaxFt: number; // Incident altitude (ft)
  aircraftAltMinFt: number; // Bailout or terrain altitude (ft)
  aircraftGlideRatio: number; // Horizontal / vertical distance (e.g. 10:1)
  aircraftTASgKts: number; // Glide true air speed (kts)
  aircraftDescentHeadingDeg?: number; // Heading during descent (°T)

  // C. Parachute Glide / Drift Displacement
  useParachute: boolean;
  parachuteType: 'steerable' | 'round-zero-glide';
  parachuteAltMaxFt: number; // Opening altitude (ft)
  parachuteTerrainAltFt: number; // Terrain altitude (ft)
  parachuteGlideRatio?: number; // For steerable (e.g. 3.0)
  parachuteTASgKts?: number; // For steerable (e.g. 15 kts)
  parachuteDescentHeadingDeg?: number;

  // Winds Aloft during glide & descent (from AWA Worksheet Appendix K-10)
  awaGlideDirFrom: number; // °T (from)
  awaGlideSpeedKts: number; // kts

  // D. Fix Errors & Safety Factor
  fixErrorXNm: number; // Nav fix error (X)
  safetyFactorFs: number; // fs factor (1.1, 1.6, 2.0, 2.3, 2.5)
}

export interface AeroDriftResult {
  // Aircraft Glide Results
  aircraftAltLossFt: number;
  aircraftRateOfDescentFtMin: number;
  aircraftTimeOfDescentMin: number;
  aircraftGlideDistanceNm: number;
  aircraftWindDisplacementNm: number;
  aircraftWindDisplacementDir: number; // Downwind
  aircraftGlideDisplacementVector: Vector; // Vector sum of glide + wind
  aircraftEndGlidePos: LatLng;

  // Parachute Results
  parachuteAltLossFt: number;
  parachuteRateOfDescentFtMin: number;
  parachuteTimeOfDescentMin: number;
  parachuteGlideDistanceNm: number;
  parachuteWindDisplacementNm: number;
  parachuteWindDisplacementDir: number;
  parachuteDisplacementVector: Vector;
  landingPos: LatLng;

  // Total Displacement from Incident
  totalDisplacementNm: number;
  totalDisplacementDir: number;

  // Errors & Search Radius
  driftErrorDeNm: number;
  searchRadiusRNm: number;
  searchAreaAoNm2: number;
}

/**
 * Hitung Aeronautical Drift sesuai Appendix K-6 & K-7
 */
export function calculateAeroDrift(input: AeroDriftInput): AeroDriftResult {
  // --- 1. AIRCRAFT GLIDE ---
  let aircraftAltLossFt = 0;
  let aircraftRODFtMin = 1000;
  let aircraftTdMin = 0;
  let aircraftGlideDistNm = 0;
  let aircraftWindDispNm = 0;
  let aircraftWindDispDir = (input.awaGlideDirFrom + 180) % 360; // downwind
  let aircraftDispVector: Vector = { mag: 0, dir: 0 };
  let currentPos = input.incidentPos;

  if (input.useAircraftGlide && input.aircraftAltMaxFt > input.aircraftAltMinFt) {
    aircraftAltLossFt = input.aircraftAltMaxFt - input.aircraftAltMinFt;
    const gr = Math.max(0.1, input.aircraftGlideRatio);
    // Formula B.6: Rate of descent = (TASg * 101) / gr  (ft/min)
    aircraftRODFtMin = (input.aircraftTASgKts * 101) / gr;
    // Formula B.7: Time of descent = AltLoss / ROD (min)
    aircraftTdMin = aircraftAltLossFt / Math.max(1, aircraftRODFtMin);
    // Formula B.8: Glide distance = (TASg * td) / 60 (NM)
    aircraftGlideDistNm = (input.aircraftTASgKts * aircraftTdMin) / 60;

    // Formula B.11: Downwind displacement due to winds aloft = (td * AWA) / 60
    aircraftWindDispNm = (aircraftTdMin * input.awaGlideSpeedKts) / 60;

    // Formula B.12: Vector sum of glide heading (dg) + wind displacement (dd)
    const glideHdg = input.aircraftDescentHeadingDeg ?? aircraftWindDispDir;
    const glideVec: Vector = { mag: aircraftGlideDistNm, dir: glideHdg };
    const windVec: Vector = { mag: aircraftWindDispNm, dir: aircraftWindDispDir };

    aircraftDispVector = addVectors(glideVec, windVec);
    currentPos = project(input.incidentPos, aircraftDispVector.dir, aircraftDispVector.mag);
  }

  const aircraftEndGlidePos = currentPos;

  // --- 2. PARACHUTE DESCENT / DRIFT ---
  let parachuteAltLossFt = 0;
  let parachuteRODFtMin = 1000; // Standar parasut bulat ~1000 ft/min
  let parachuteTdMin = 0;
  let parachuteGlideDistNm = 0;
  let parachuteWindDispNm = 0;
  let parachuteWindDispDir = (input.awaGlideDirFrom + 180) % 360;
  let parachuteDispVector: Vector = { mag: 0, dir: 0 };

  if (input.useParachute && input.parachuteAltMaxFt > input.parachuteTerrainAltFt) {
    parachuteAltLossFt = input.parachuteAltMaxFt - input.parachuteTerrainAltFt;

    if (input.parachuteType === 'steerable' && input.parachuteGlideRatio && input.parachuteTASgKts) {
      // Steerable parachute (part B)
      const gr = Math.max(0.1, input.parachuteGlideRatio);
      parachuteRODFtMin = (input.parachuteTASgKts * 101) / gr;
      parachuteTdMin = parachuteAltLossFt / Math.max(1, parachuteRODFtMin);
      parachuteGlideDistNm = (input.parachuteTASgKts * parachuteTdMin) / 60;
      parachuteWindDispNm = (parachuteTdMin * input.awaGlideSpeedKts) / 60;

      const pGlideHdg = input.parachuteDescentHeadingDeg ?? parachuteWindDispDir;
      const pGlideVec: Vector = { mag: parachuteGlideDistNm, dir: pGlideHdg };
      const pWindVec: Vector = { mag: parachuteWindDispNm, dir: parachuteWindDispDir };
      parachuteDispVector = addVectors(pGlideVec, pWindVec);
    } else {
      // Round parachute zero glide ratio (part C)
      // Standard descent rate ~ 1000 ft/min (16.7 ft/sec)
      parachuteRODFtMin = 1000;
      parachuteTdMin = parachuteAltLossFt / parachuteRODFtMin;
      // Drift is solely downwind displacement:
      parachuteWindDispNm = (parachuteTdMin * input.awaGlideSpeedKts) / 60;
      parachuteDispVector = { mag: parachuteWindDispNm, dir: parachuteWindDispDir };
    }

    currentPos = project(aircraftEndGlidePos, parachuteDispVector.dir, parachuteDispVector.mag);
  }

  const landingPos = currentPos;

  // Total displacement from original incident position
  const totalDisplacementNm = distanceNm(input.incidentPos, landingPos);
  const totalDisplacementDir = bearingDeg(input.incidentPos, landingPos);

  // Drift Error De = sum of drift errors or standard 12.5% to 25% of total displacement
  const driftErrorDeNm = Math.max(1.0, totalDisplacementNm * 0.15);
  // Total probable error E = sqrt(X^2 + De^2)
  const E = Math.sqrt(input.fixErrorXNm * input.fixErrorXNm + driftErrorDeNm * driftErrorDeNm);

  // Search Radius R = fs * E
  const searchRadiusRNm = Math.max(1.0, input.safetyFactorFs * E);
  // Point search area Ao = 4 * R^2
  const searchAreaAoNm2 = 4 * searchRadiusRNm * searchRadiusRNm;

  return {
    aircraftAltLossFt,
    aircraftRateOfDescentFtMin: aircraftRODFtMin,
    aircraftTimeOfDescentMin: aircraftTdMin,
    aircraftGlideDistanceNm: aircraftGlideDistNm,
    aircraftWindDisplacementNm: aircraftWindDispNm,
    aircraftWindDisplacementDir: aircraftWindDispDir,
    aircraftGlideDisplacementVector: aircraftDispVector,
    aircraftEndGlidePos,

    parachuteAltLossFt,
    parachuteRateOfDescentFtMin: parachuteRODFtMin,
    parachuteTimeOfDescentMin: parachuteTdMin,
    parachuteGlideDistanceNm: parachuteGlideDistNm,
    parachuteWindDisplacementNm: parachuteWindDispNm,
    parachuteWindDisplacementDir: parachuteWindDispDir,
    parachuteDisplacementVector: parachuteDispVector,
    landingPos,

    totalDisplacementNm,
    totalDisplacementDir,

    driftErrorDeNm,
    searchRadiusRNm,
    searchAreaAoNm2,
  };
}
