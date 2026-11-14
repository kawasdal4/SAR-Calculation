/**
 * Build the IAMSAR Volume II Appendix L-23 Search Action Plan message
 * from the current worksheet state. Returns a structured object that
 * can be rendered as plain text, PDF, or Excel.
 */

import type { LatLng } from './sarCalculations';
import { rectangleCorners } from './sarCalculations';

export interface SearchActionPlanData {
  /** Date/time group of the message (ISO string). */
  messageDateTime: string;
  /** RCC or RSC responsible for the search. */
  fromRcc: string;
  /** Agencies tasked with conducting the search. */
  toRecipients: string[];
  /** Info-only agencies. */
  infoAgencies: string[];
  /** Emergency phase + identification. */
  emergencyPhase: 'UNCERTAINTY' | 'ALERT' | 'DISTRESS';
  searchObjectId: string;
  flagState: string;
  causeDescription: string;
  generalLocation: string;
  /** Date of search. */
  searchDate: string;
  /** Section 1 — Situation. */
  situationSummary: string;
  descriptionOfCraft: string;
  personsOnBoard: number;
  primarySearchObject: string;
  secondarySearchObject: string;
  /** Section 1.E — On-scene weather. */
  weatherCeiling: string;
  weatherVisibility: string;
  weatherWind: string;
  weatherSeas: string;
  weatherForecastPeriod: string;
  /** Section 2 — Action (per agency). */
  actions: Array<{ agency: string; tasking: string }>;
  /** Section 3 — Search areas (corner points in lat/lon). */
  searchAreas: Array<{
    designation: string;
    cornerPoints: LatLng[];
    sizeNm2?: number;
  }>;
  /** Section 4 — Execution table. */
  execution: Array<{
    area: string;
    facility: string;
    location: string;
    pattern: string;
    creep: string;
    commenceSearchPoint: LatLng;
    altitude: string;
  }>;
  /** Section 5 — Coordination. */
  smc: string;
  osc: string;
  startTime: string;
  trackSpacing: string;
  maxAircraftSpeed: string;
  oscAuthorizations: string;
  otherCoordination: string;
  /** Section 6 — Communications. */
  controlChannelPrimary: string;
  controlChannelSecondary: string;
  onScenePrimary: string;
  onSceneSecondary: string;
  airGroundPrimary: string;
  airGroundSecondary: string;
  airAirPrimary: string;
  airAirSecondary: string;
  /** Section 7 — Reports. */
  oscReportInstructions: string;
  facilityReportInstructions: string;
  parentActivityReports: string;
  /** Worksheet summary. */
  summary: {
    lkp: LatLng;
    datumLeft: LatLng;
    datumRight: LatLng;
    driftDistanceNm: number;
    divergenceDistanceNm: number;
    E_nm: number;
    Zta_nm2: number;
    Ro_nm: number;
    Ao_nm2: number;
    coverageFactor: number;
    POD_pct: number;
    trackSpacing_nm: number;
    searchAreaLength_nm: number;
    searchAreaWidth_nm: number;
    aswDirFrom: number;
    aswSpeedKts: number;
    awaDirFrom: number;
    awaSpeedKts: number;
    twcDir: number;
    twcSpeed: number;
    lwLeftDir: number;
    lwRightDir: number;
    lwSpeed: number;
  };
}

/** Render the Search Action Plan as IAMSAR-style plain text (Appendix L-23 format). */
export function renderSearchActionPlanText(d: SearchActionPlanData): string {
  const lines: string[] = [];
  const fmtLatLng = (p: LatLng) =>
    `${Math.abs(p.lat).toFixed(2)}${p.lat >= 0 ? 'N' : 'S'} ${Math.abs(p.lng).toFixed(2)}${p.lng >= 0 ? 'E' : 'W'}`;

  lines.push('(Precedence and date/time group of the message)');
  lines.push(`MSG DTG: ${d.messageDateTime}`);
  lines.push('');
  lines.push(`FROM: ${d.fromRcc}`);
  lines.push(`TO:   ${d.toRecipients.join('; ')}`);
  if (d.infoAgencies.length) {
    lines.push(`INFO: ${d.infoAgencies.join('; ')}`);
  }
  lines.push('BT');
  lines.push('');
  lines.push(
    `${d.emergencyPhase}, ${d.searchObjectId} (${d.flagState}) ${d.causeDescription}, ${d.generalLocation}`,
  );
  lines.push('');
  lines.push(`SEARCH ACTION PLAN FOR ${d.searchDate}`);
  lines.push('');
  lines.push('A   (References)');
  lines.push('    IAMSAR Manual Vol. II (2016) Appendix L');
  lines.push('');
  lines.push('1   SITUATION:');
  lines.push(`A   SUMMARY: ${d.situationSummary}`);
  lines.push(`B   DESCRIPTION: ${d.descriptionOfCraft}`);
  lines.push(`C   PERSONS ON BOARD: ${d.personsOnBoard}`);
  lines.push('D   SEARCH OBJECTS:');
  lines.push(`        PRIMARY:    ${d.primarySearchObject}`);
  lines.push(`        SECONDARY:  ${d.secondarySearchObject}`);
  lines.push(
    `E   ON-SCENE WEATHER FORECAST ${d.weatherForecastPeriod}: CEILING ${d.weatherCeiling}, VISIBILITY ${d.weatherVisibility}, WIND ${d.weatherWind}, SEAS ${d.weatherSeas}`);
  lines.push('');
  lines.push('2   ACTION:');
  for (const a of d.actions) {
    lines.push(`A   (${a.agency}) ${a.tasking}`);
  }
  lines.push('');
  lines.push('3   SEARCH AREAS (READ IN TWO COLUMNS):');
  lines.push('    AREA           CORNER POINTS');
  for (const area of d.searchAreas) {
    const corners = area.cornerPoints.map(fmtLatLng).join('  ');
    lines.push(`    ${area.designation.padEnd(15)} ${corners}`);
  }
  lines.push('');
  lines.push('4   EXECUTION (ALTITUDES IN FEET):');
  lines.push('    AREA        FACILITY          LOCATION          PATTERN  CREEP   CSP                ALT');
  for (const e of d.execution) {
    lines.push(
      `    ${e.area.padEnd(11)} ${e.facility.padEnd(17)} ${e.location.padEnd(18)} ${e.pattern.padEnd(8)} ${e.creep.padEnd(7)} ${fmtLatLng(e.commenceSearchPoint).padEnd(18)} ${e.altitude}`,
    );
  }
  lines.push('');
  lines.push('5   CO-ORDINATION INSTRUCTIONS:');
  lines.push(`A   SMC: ${d.smc}`);
  lines.push(`B   OSC: ${d.osc}`);
  lines.push(`C   SEARCH COMMENCES: ${d.startTime}`);
  lines.push(`D   TRACK SPACING: ${d.trackSpacing}    MAX AIRCRAFT SPEED: ${d.maxAircraftSpeed}`);
  lines.push(`E   OSC AUTHORIZATIONS: ${d.oscAuthorizations}`);
  if (d.otherCoordination) {
    lines.push(`F   ${d.otherCoordination}`);
  }
  lines.push('');
  lines.push('6   COMMUNICATIONS:');
  lines.push(`A   CONTROL CHANNEL        PRIMARY: ${d.controlChannelPrimary}    SECONDARY: ${d.controlChannelSecondary}`);
  lines.push(`B   ON-SCENE FREQUENCIES   PRIMARY: ${d.onScenePrimary}    SECONDARY: ${d.onSceneSecondary}`);
  lines.push(`C   AIR/GROUND FREQUENCIES PRIMARY: ${d.airGroundPrimary}    SECONDARY: ${d.airGroundSecondary}`);
  lines.push(`D   AIR/AIR FREQUENCIES   PRIMARY: ${d.airAirPrimary}    SECONDARY: ${d.airAirSecondary}`);
  lines.push('');
  lines.push('7   REPORTS:');
  lines.push(`A   (OSC SITREP schedule) ${d.oscReportInstructions}`);
  lines.push(`B   (Facility reporting instructions) ${d.facilityReportInstructions}`);
  lines.push(`C   (Parent activity reports) ${d.parentActivityReports}`);
  lines.push('BT');
  return lines.join('\n');
}

/**
 * Build a SearchActionPlanData object from the current worksheet state.
 * This is the bridge between the in-app worksheet state and the formatted message.
 */
export function buildSearchActionPlanData(input: {
  caseTitle?: string;
  fromRcc?: string;
  emergencyPhase?: 'UNCERTAINTY' | 'ALERT' | 'DISTRESS';
  searchObjectId?: string;
  flagState?: string;
  causeDescription?: string;
  generalLocation?: string;
  personsOnBoard?: number;
  primarySearchObject?: string;
  secondarySearchObject?: string;
  weatherCeiling?: string;
  weatherVisibility?: string;
  weatherWind?: string;
  weatherSeas?: string;
  weatherForecastPeriod?: string;
  lkp: LatLng;
  datumLeft: LatLng;
  datumRight: LatLng;
  driftDistanceNm: number;
  divergenceDistanceNm: number;
  E_nm: number;
  Zta_nm2: number;
  Ro_nm: number;
  Ao_nm2: number;
  coverageFactor: number;
  POD_pct: number;
  trackSpacing_nm: number;
  searchAreaLength_nm: number;
  searchAreaWidth_nm: number;
  searchAreaCenter: LatLng;
  searchAreaOrientationDeg: number;
  aswDirFrom: number;
  aswSpeedKts: number;
  awaDirFrom: number;
  awaSpeedKts: number;
  twcDir: number;
  twcSpeed: number;
  lwLeftDir: number;
  lwRightDir: number;
  lwSpeed: number;
  facilities: Array<{ name: string; speed: number }>;
}): SearchActionPlanData {
  const now = new Date();
  const msgDtg = now.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  const searchDate = now.toISOString().slice(0, 10);

  // Build the search area corner points (rectangle)
  const areaCorners = rectangleCorners(
    input.searchAreaCenter,
    input.searchAreaLength_nm,
    input.searchAreaWidth_nm,
    input.searchAreaOrientationDeg,
  );

  // Build execution table — one row per facility
  const execution: SearchActionPlanData['execution'] = input.facilities.map((f, i) => ({
    area: `A-${i + 1}`,
    facility: f.name,
    location: 'On scene',
    pattern: 'PS',
    creep: `${input.searchAreaOrientationDeg.toFixed(0)}T`,
    commenceSearchPoint: input.lkp,
    altitude: f.speed >= 50 ? '1000' : 'SURFACE',
  }));

  return {
    messageDateTime: msgDtg,
    fromRcc: input.fromRcc ?? 'RCC (responsible)',
    toRecipients: ['All SAR facilities tasked'],
    infoAgencies: [],
    emergencyPhase: input.emergencyPhase ?? 'DISTRESS',
    searchObjectId: input.searchObjectId ?? input.caseTitle ?? 'Search object',
    flagState: input.flagState ?? 'XX',
    causeDescription: input.causeDescription ?? 'OVERDUE',
    generalLocation: input.generalLocation ?? 'Search area',
    searchDate,
    situationSummary:
      `Distress alert received for ${input.searchObjectId ?? 'the search object'} at position ${input.lkp.lat.toFixed(4)}, ${input.lkp.lng.toFixed(4)} on ${msgDtg}. ` +
      `Computed datum positions: left (${input.datumLeft.lat.toFixed(4)}, ${input.datumLeft.lng.toFixed(4)}) and right (${input.datumRight.lat.toFixed(4)}, ${input.datumRight.lng.toFixed(4)}) of downwind. ` +
      `Total probable error of position E = ${input.E_nm.toFixed(2)} NM. Search area dimensions: ${input.searchAreaLength_nm.toFixed(1)} × ${input.searchAreaWidth_nm.toFixed(1)} NM.`,
    descriptionOfCraft: 'See case file',
    personsOnBoard: input.personsOnBoard ?? 0,
    primarySearchObject: input.primarySearchObject ?? '6-person liferaft with canopy',
    secondarySearchObject: input.secondarySearchObject ?? 'Possible survivors in water, wreckage/debris, 121.5 MHz EPIRB',
    weatherCeiling: input.weatherCeiling ?? '8000 OVERCAST',
    weatherVisibility: input.weatherVisibility ?? '10 NM',
    weatherWind: input.weatherWind ?? `${input.aswDirFrom.toFixed(0)}T/${input.aswSpeedKts.toFixed(0)}KTS`,
    weatherSeas: input.weatherSeas ?? '210T/3-6 FEET',
    weatherForecastPeriod: input.weatherForecastPeriod ?? `${msgDtg} +24H`,
    actions: input.facilities.map((f, i) => ({
      agency: f.name,
      tasking: `Search sub-area A-${i + 1}; pattern PS creep ${input.searchAreaOrientationDeg.toFixed(0)}T; commence search point ${input.lkp.lat.toFixed(2)}${input.lkp.lat >= 0 ? 'N' : 'S'} ${input.lkp.lng.toFixed(2)}${input.lkp.lng >= 0 ? 'E' : 'W'}.`,
    })),
    searchAreas: [
      {
        designation: 'A-1',
        cornerPoints: areaCorners,
        sizeNm2: input.searchAreaLength_nm * input.searchAreaWidth_nm,
      },
    ],
    execution,
    smc: 'SMC (RCC duty officer)',
    osc: input.facilities[0]?.name ?? 'OSC (first on scene)',
    startTime: msgDtg,
    trackSpacing: `${input.trackSpacing_nm.toFixed(2)} NM`,
    maxAircraftSpeed: '150 KTS',
    oscAuthorizations:
      'OSC authorized to adjust track spacing and search patterns based on on-scene conditions; deploy datum marker buoys as needed; suspend search if safety of SAR personnel is at risk.',
    otherCoordination:
      'Aircraft entering search area must report to ACO on 123.1 MHz. Maintain 500 ft vertical separation between aircraft sharing a search sub-area boundary.',
    controlChannelPrimary: 'HF: 3023 KHz USB',
    controlChannelSecondary: 'HF: 5680 KHz USB',
    onScenePrimary: 'VHF-AM: 123.1 MHz',
    onSceneSecondary: 'VHF-FM: CH 16',
    airGroundPrimary: 'HF: 3023 KHz',
    airGroundSecondary: 'VHF-FM: CH 06',
    airAirPrimary: 'UHF-AM: 282.8 MHz',
    airAirSecondary: 'UHF-AM: 243.0 MHz',
    oscReportInstructions:
      'OSC to submit SITREPs every 3 hours; include on-scene weather, progress, and POD for completed sub-areas.',
    facilityReportInstructions:
      'Each SAR facility to report on-scene arrival, departure, and any sightings immediately to the OSC.',
    parentActivityReports:
      'Parent agencies to report daily sorties, hours flown, areas searched, and coverage factors at end of daily operations.',
    summary: {
      lkp: input.lkp,
      datumLeft: input.datumLeft,
      datumRight: input.datumRight,
      driftDistanceNm: input.driftDistanceNm,
      divergenceDistanceNm: input.divergenceDistanceNm,
      E_nm: input.E_nm,
      Zta_nm2: input.Zta_nm2,
      Ro_nm: input.Ro_nm,
      Ao_nm2: input.Ao_nm2,
      coverageFactor: input.coverageFactor,
      POD_pct: input.POD_pct,
      trackSpacing_nm: input.trackSpacing_nm,
      searchAreaLength_nm: input.searchAreaLength_nm,
      searchAreaWidth_nm: input.searchAreaWidth_nm,
      aswDirFrom: input.aswDirFrom,
      aswSpeedKts: input.aswSpeedKts,
      awaDirFrom: input.awaDirFrom,
      awaSpeedKts: input.awaSpeedKts,
      twcDir: input.twcDir,
      twcSpeed: input.twcSpeed,
      lwLeftDir: input.lwLeftDir,
      lwRightDir: input.lwRightDir,
      lwSpeed: input.lwSpeed,
    },
  };
}
