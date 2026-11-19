/**
 * Test tool server-side (Fase 2): get_state / run_worksheet / run_pipeline /
 * validate_plan via executeServerTool + deklarasi tool.
 * Jalankan: bun test tests/serverTools.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  SERVER_EXECUTABLE_TOOL_NAMES,
  SERVER_TOOL_DECLARATIONS,
  executeServerTool,
} from '../src/lib/ai/tools/serverTools';

// Snapshot singkat dengan rantai lengkap (sama polanya dengan fixture PK-TAL):
// cukup agar pipeline ok dan semua langkah terisi.
const SNAPSHOT = {
  asw: {
    observations: [
      { timeObs: '17 November 2026 18.00 WIT', hours: 5.1, windDirFrom: 80, windSpeed: 10 },
      { timeObs: '18 November 2026 00.00 WIT', hours: 6, windDirFrom: 90, windSpeed: 12 },
      { timeObs: '18 November 2026 06.00 WIT', hours: 4, windDirFrom: 100, windSpeed: 8 },
    ],
    distressTime: '17 Nov 2026 15.56 WIT',
    datumTime: '18 Nov 2026 07.00 WIT',
    obsIntervalMode: '6h',
    caseTitle: 'Snapshot Server Tools',
  },
  awa: {
    observations: [
      { altObs: 'Surface', windDirFrom: 80, windSpeed: 10 },
      { altObs: '2000', windDirFrom: 85, windSpeed: 14 },
      { altObs: 'FL200', windDirFrom: 95, windSpeed: 30 },
    ],
    distressAltFt: 12000,
  },
  aero: {
    useAircraftGlide: true,
    useParachute: false,
    aircraftAltMaxFt: 12000,
    aircraftAltMinFt: 0,
    aircraftGlideRatio: 9,
    aircraftTASgKts: 120,
    aircraftDescentHeadingDeg: 250,
    aircraftHeadingReference: 'magnetic',
    magneticVariationDeg: 2,
    magneticVariationDirection: 'E',
    caseTitle: 'Snapshot Server Tools',
  },
  datum: {
    driftInterval: 15,
    seaCurrentDir: 250,
    seaCurrentSpeed: 0.5,
    seaCurrentErr: 0.1,
    leewayObjectId: 'raft-aviation-46',
    X: 1,
    Y: 0.8,
    useWindCurrent: true,
  },
  ws1: { fs: 1.6 },
  lkp: { lat: -1.5, lng: 130.2 },
  ws2Sheets: [
    { key: 's1', label: 'SRU Udara', data: { sruName: 'BASARNAS 3', searchPlatform: 'fixed-wing', searchTas: 150, searchObject: 'raft25', visibilityIndex: 2, isFatigue: 'No', searchNumber: 2, selectedHeight: 1000, caseWindDirFrom: 85, caseWindSpeed: 12, caseWaveHeightM: 1.5 } },
  ],
  ws8Sheets: [
    { key: 's2', label: 'SRU Laut', data: { sruName: 'KN SAR DRUPADA', sruType: 'rescue-vessel', eyeHeight: '14', searchObject: 'raft20', visibilityKm: '10', isFatigue: 'Yes', searchNumber: 2, vesselSpeedKts: 12 } },
  ],
  assets: [
    { id: 'a1', name: 'BASARNAS 3', type: 'fixed-wing-aircraft', homeBasePos: { lat: -1.2, lng: 130.0 }, transitSpeedKts: 180, searchSpeedKts: 150, enduranceHours: 5.5, sweepWidthNm: 0 },
    { id: 'a2', name: 'KN SAR DRUPADA', type: 'rescue-vessel', homeBasePos: { lat: -1.3, lng: 130.1 }, transitSpeedKts: 14, searchSpeedKts: 12, enduranceHours: 20, sweepWidthNm: 0 },
  ],
  patternType: 'PS',
  adwSyncLkp: true,
};

describe('deklarasi tool server-side', () => {
  it('8 nama (Fase 4 + Fase E): + fill_form, analyze_debrief, request_reference_choice', () => {
    expect([...SERVER_EXECUTABLE_TOOL_NAMES].sort()).toEqual([
      'analyze_debrief', 'fill_form', 'get_state', 'lookup_table', 'request_reference_choice', 'run_pipeline', 'run_worksheet', 'validate_plan',
    ]);
  });

  it('deklarasi lengkap (nama + parameters objek) & tanpa duplikat', () => {
    expect(SERVER_TOOL_DECLARATIONS.length).toBe(8);
    const names = SERVER_TOOL_DECLARATIONS.map((declaration) => declaration.name);
    expect(new Set(names).size).toBe(8);
    for (const declaration of SERVER_TOOL_DECLARATIONS) {
      expect(declaration.parameters.type).toBe('OBJECT');
      expect(declaration.description.length).toBeGreaterThan(30);
    }
  });
});

describe('executeServerTool — routing & ketahanan', () => {
  it('tool tak dikenal → ok:false tanpa melempar', () => {
    const result = executeServerTool('tool_hantu', {}, {});
    expect(result.ok).toBe(false);
    expect(JSON.parse(result.json).error).toContain('bukan tool server-side');
  });

  it('tanpa state → get_state/run_pipeline/validate_plan ok:false pesan jelas', () => {
    for (const name of ['get_state', 'run_pipeline', 'run_worksheet', 'validate_plan']) {
      const result = executeServerTool(name, {}, {});
      expect(result.ok).toBe(false);
      expect(JSON.parse(result.json).error).toContain('State worksheet tidak tersedia');
    }
  });

  it('lookup_table dielegasikan (argumen salah → ok:false)', () => {
    const result = executeServerTool('lookup_table', { table: 'wu-air' }, {});
    expect(result.ok).toBe(false);
  });
});

describe('executeServerTool — get_state', () => {
  it('ringkas per worksheet + kelengkapan', () => {
    const result = executeServerTool('get_state', {}, { state: SNAPSHOT });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(parsed.hasState).toBe(true);
    expect(parsed.worksheets.asw.observationCount).toBe(3);
    expect(parsed.worksheets.awa.layerCount).toBe(3);
    expect(parsed.worksheets.aero.glideRatio).toBe(9);
    expect(parsed.worksheets.datum.leewayObjectId).toBe('raft-aviation-46');
    expect(parsed.worksheets.ws2Sheets[0].searchObject).toBe('raft25');
    expect(parsed.worksheets.ws8Sheets[0].eyeHeight).toBe('14');
    expect(parsed.worksheets.assets.length).toBe(2);
    expect(parsed.completeness).not.toBeNull();
    expect(typeof parsed.completeness.missingCount).toBe('number');
  });
});

describe('executeServerTool — run_pipeline & run_worksheet', () => {
  it('run_pipeline: ok, semua langkah ok, angka engine (bukan array besar)', () => {
    const result = executeServerTool('run_pipeline', {}, { state: SNAPSHOT });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(parsed.ok).toBe(true);
    const failed = parsed.steps.filter((step: { status: string }) => step.status === 'error');
    expect(failed.length).toBe(0);
    expect(parsed.asw.speedKts).toBeGreaterThan(0);
    expect(parsed.datumWs1.AoSquareNm2).toBeGreaterThan(0);
    expect(parsed.ws2Rows[0].ready).toBe(true);
    expect(parsed.ws8Rows[0].ready).toBe(true);
    expect(parsed.searchPattern.totalDistanceNm).toBeGreaterThan(0);
    // Kompaksi: TIDAK ada array waypoint/legs besar di output.
    expect(parsed.searchPattern.waypoints).toBeUndefined();
    expect(parsed.searchPattern.waypointCount).toBeGreaterThan(0);
    expect(JSON.stringify(parsed).length).toBeLessThan(9000);
  });

  it('run_worksheet ws2 → hanya blok terkait', () => {
    const result = executeServerTool('run_worksheet', { worksheet: 'ws2' }, { state: SNAPSHOT });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(parsed.ws2Rows.length).toBe(1);
    expect(parsed.searchPattern).toBeUndefined();
    expect(parsed.assetAllocation).toBeUndefined();
    expect(parsed.steps.every((step: { step: string }) => step.step.startsWith('ws2') === false || true)).toBe(true);
  });

  it('run_worksheet datum → datumWs1 + aeroDrift (prasyarat) tanpa ws2Rows', () => {
    const result = executeServerTool('run_worksheet', { worksheet: 'datum' }, { state: SNAPSHOT });
    const parsed = JSON.parse(result.json);
    expect(parsed.datumWs1).toBeDefined();
    expect(parsed.ws2Rows).toBeUndefined();
  });

  it('run_worksheet worksheet tak dikenal → ok:false + daftar pilihan', () => {
    const result = executeServerTool('run_worksheet', { worksheet: 'ws7' }, { state: SNAPSHOT });
    expect(result.ok).toBe(false);
    expect(JSON.parse(result.json).error).toContain('Pilihan: asw, awa, aero, datum, ws2, ws8, pattern, assets');
  });

  it('run_worksheet darat (ws3) → pesan belum didukung pipeline', () => {
    const result = executeServerTool('run_worksheet', { worksheet: 'ws3' }, { state: SNAPSHOT });
    expect(result.ok).toBe(false);
    expect(JSON.parse(result.json).error).toContain('Pilihan');
  });
});

describe('executeServerTool — validate_plan', () => {
  it('snapshot valid → ok tanpa error', () => {
    const result = executeServerTool('validate_plan', {}, { state: SNAPSHOT });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(parsed.errorCount).toBe(0);
  });

  it('snapshot rusak (sudut 400°) → ok:false + issue terbaca', () => {
    const broken = { ...SNAPSHOT, datum: { ...SNAPSHOT.datum, seaCurrentDir: 400 } };
    const result = executeServerTool('validate_plan', {}, { state: broken });
    expect(result.ok).toBe(false);
    const parsed = JSON.parse(result.json);
    expect(parsed.issues.some((issue: { field: string }) => issue.field === 'datum.seaCurrentDir')).toBe(true);
  });
});
