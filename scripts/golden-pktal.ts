/** Golden fixture PK-TAL (mini) — data inti sesuai PDF Pusat Final Test XL 2026.
 *  Dipakai test regresi (tests/aiCopilotFase.test.ts) dan uji pipeline
 *  (scripts/test-pipeline-pktal.ts). glideRatio tetap "6:1" untuk menguji
 *  normalisasi Fase C. */
export const PKTAL_GOLDEN = {
  schemaVersion: 1,
  caseTitle: 'PK-TAL ditching',
  incident: {
    type: 'aircraft-ditching',
    callsign: 'PK-TAL',
    craftType: 'Aero Commander 500',
    pob: 3,
    reportTime: '18 November 2026 14.10 WIB',
    lastContactTime: '18 November 2026 13.50 WIB',
    flightLevelFt: 100,
    headingDeg: 90,
    headingReference: 'magnetic',
  },
  target: { category: 'aircraft', name: 'PK-TAL', wingspanM: 14.25, lengthM: 10.89 },
  lkp: { coord: { lat: -6.879444, lng: 105.261389, dmsLat: "06°52'46\"S", dmsLng: "105°15'41\"E" }, source: 'explicit' },
  aeroDrift: {
    glideSpeedKts: 121,
    glideRatio: '6:1',
    glideRatioRaw: '6:1',
    variationDeg: 1,
    variationDirection: 'E',
    windLayers: [
      { altitudeFt: 0, altitudeLabel: 'Surface', windDirFrom: 45, windSpeedKts: 5 },
      { altitudeFt: 3000, altitudeLabel: '3000 ft', windDirFrom: 55, windSpeedKts: 10 },
      { altitudeFt: 6000, altitudeLabel: '6000 ft', windDirFrom: 65, windSpeedKts: 15 },
      { altitudeFt: 9000, altitudeLabel: '9000 ft', windDirFrom: 75, windSpeedKts: 20 },
      { altitudeFt: 12000, altitudeLabel: '12000 ft', windDirFrom: 85, windSpeedKts: 15 },
      { altitudeFt: 18000, altitudeLabel: '18000 ft', windDirFrom: 95, windSpeedKts: 10 },
      { altitudeFt: 24000, altitudeLabel: '24000 ft', windDirFrom: 105, windSpeedKts: 20 },
    ],
  },
  sea: {
    current: { dirToDeg: 250, speedKts: 0.3 },
    surfaceWindSeries: [
      { obsTime: '18 November 2026 09.00 WIB', windDirFrom: 50, windSpeedKts: 8 },
      { obsTime: '18 November 2026 12.00 WIB', windDirFrom: 55, windSpeedKts: 10 },
      { obsTime: '18 November 2026 15.00 WIB', windDirFrom: 60, windSpeedKts: 12 },
      { obsTime: '18 November 2026 18.00 WIB', windDirFrom: 65, windSpeedKts: 14 },
      { obsTime: '18 November 2026 21.00 WIB', windDirFrom: 70, windSpeedKts: 12 },
      { obsTime: '19 November 2026 00.00 WIB', windDirFrom: 75, windSpeedKts: 10 },
    ],
  },
  search: { datumTime: '19 November 2026 07.00 WIB' },
  sru: [
    { callsign: 'HR-3604', kind: 'helicopter', model: 'Eurocopter AS-365 N3+', coord: { lat: -6.1, lng: 106.6 }, enduranceHours: 2, enduranceMinutes: 45, tasMaxKts: 150, tasSearchKts: 90, visibilityKm: 10, windDirFrom: 55, windSpeedKts: 20, observerCondition: 'fresh', taf: 'Inter', frequencies: ['123.1'], captain: 'Joko', navigation: ['GPS'] },
    { callsign: 'PK-ELS', kind: 'helicopter', model: 'Bell 505 Jet Ranger X', coord: { lat: -6.2, lng: 106.7 }, enduranceHours: 2, enduranceMinutes: 30, tasMaxKts: 120, tasSearchKts: 90, visibilityKm: 10, windDirFrom: 55, windSpeedKts: 20, observerCondition: 'fresh', taf: 'Inter', frequencies: ['123.1'], captain: 'Agus', navigation: ['GPS'] },
    { callsign: 'KN SAR Drupada', kind: 'vessel', model: 'Rescue Boat 40 meter', coord: { lat: -5.9, lng: 106.4 }, enduranceHours: 50, tasMaxKts: 20, tasSearchKts: 15, visibilityKm: 20, windDirFrom: 55, windSpeedKts: 20, observerCondition: 'fresh', frequencies: ['Ch.16', '123.1'], captain: 'Budi', navigation: ['GPS'] },
  ],
  meta: { source: 'pdf', fieldSources: [], assumptions: [], missingFields: [] },
} as const;
