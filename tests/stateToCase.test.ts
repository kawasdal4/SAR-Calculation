/**
 * Test stateToCase (Fase 2): snapshot worksheet → SarCaseSchema + planner.
 * - Pemetaan 1:1 (observasi ASW/AWA, datum, lembar WS 2/WS 8 verbatim, aset).
 * - Lembar live (sru.sheet) MENANG atas derivation di buildCaseWorksheetSeeds.
 * - Deterministik & tidak melempar.
 * Jalankan: bun test tests/stateToCase.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { stateToCase, parseAltitudeFtLabel } from '../src/lib/sar/stateToCase';
import { buildCaseWorksheetSeeds } from '../src/lib/sar/caseAdapter';
import { parseSarCase } from '../src/lib/sar/caseSchema';
import { runCasePipeline } from '../src/lib/sar/casePipeline';

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
    aswErr: 15,
    caseTitle: 'Latihan Snapshot',
  },
  awa: {
    observations: [
      { altObs: 'Surface', windDirFrom: 80, windSpeed: 10 },
      { altObs: '2000', windDirFrom: 85, windSpeed: 14 },
      { altObs: 'FL200', windDirFrom: 95, windSpeed: 30 },
    ],
    distressAltFt: 12000,
    caseTitle: 'Latihan Snapshot',
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
    caseTitle: 'Latihan Snapshot',
  },
  datum: {
    driftInterval: 15,
    latitude: 1.5,
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
    {
      key: 's1',
      label: 'SRU Udara',
      data: {
        sruName: 'BASARNAS 3',
        searchPlatform: 'fixed-wing',
        searchTas: 150,
        searchObject: 'raft25',
        visibilityIndex: 2,
        isFatigue: 'No',
        piwFlotationKnown: false,
        searchNumber: 2,
        selectedHeight: 1000,
        caseWindDirFrom: 85,
        caseWindSpeed: 12,
        caseWaveHeightM: 1.5,
      },
    },
  ],
  ws8Sheets: [
    {
      key: 's2',
      label: 'SRU Laut',
      data: {
        sruName: 'KN SAR DRUPADA',
        sruType: 'rescue-vessel',
        eyeHeight: '14',
        searchObject: 'raft20',
        visibilityKm: '10',
        isFatigue: 'Yes',
        searchNumber: 2,
        vesselSpeedKts: 12,
      },
    },
  ],
  assets: [
    {
      id: 'asset-1',
      name: 'BASARNAS 3',
      type: 'fixed-wing-aircraft',
      homeBaseName: 'Lokasi aset BASARNAS 3',
      homeBasePos: { lat: -1.2, lng: 130.0 },
      transitSpeedKts: 180,
      searchSpeedKts: 150,
      enduranceHours: 5.5,
      sweepWidthNm: 0,
      airEngineType: 'turbine',
    },
    {
      id: 'asset-2',
      name: 'KN SAR DRUPADA',
      type: 'rescue-vessel',
      homeBaseName: 'Lokasi aset KN SAR DRUPADA',
      homeBasePos: { lat: -1.3, lng: 130.1 },
      transitSpeedKts: 14,
      searchSpeedKts: 12,
      enduranceHours: 20,
      sweepWidthNm: 0,
    },
  ],
  patternType: 'PS',
  adwSyncLkp: true,
};

describe('stateToCase — pemetaan snapshot → SarCaseSchema', () => {
  const result = stateToCase(SNAPSHOT);
  const sarCase = result.sarCase;

  it('ok + parseSarCase lolos', () => {
    expect(result.ok).toBe(true);
    expect(sarCase).toBeDefined();
    const parsed = parseSarCase(sarCase);
    expect(parsed.ok).toBe(true);
  });

  it('incident: waktu/ketinggian/heading + jenis disimpulkan (aero → aircraft-ditching)', () => {
    expect(sarCase?.incident.type).toBe('aircraft-ditching');
    expect(sarCase?.incident.lastContactTime).toBe('17 Nov 2026 15.56 WIT');
    expect(sarCase?.incident.altitudeFt).toBe(12000);
    expect(sarCase?.incident.headingDeg).toBe(250);
    expect(sarCase?.incident.headingReference).toBe('magnetic');
  });

  it('lkp: koordinat + sumber adw-landing (adwSyncLkp true)', () => {
    expect(sarCase?.lkp?.coord).toEqual({ lat: -1.5, lng: 130.2 });
    expect(sarCase?.lkp?.source).toBe('adw-landing');
  });

  it('aeroDrift: glide/variation + windLayers dari AWA (Surface=0, FL200=20000)', () => {
    expect(sarCase?.aeroDrift?.glideRatio).toBe(9);
    expect(sarCase?.aeroDrift?.glideSpeedKts).toBe(120);
    expect(sarCase?.aeroDrift?.variationDeg).toBe(2);
    expect(sarCase?.aeroDrift?.variationDirection).toBe('E');
    const layers = sarCase?.aeroDrift?.windLayers ?? [];
    expect(layers.map((layer) => layer.altitudeFt)).toEqual([0, 2000, 20000]);
    expect(layers[2].altitudeLabel).toBe('FL200');
    expect(layers[2].windSpeedKts).toBe(30);
  });

  it('sea: arus (arah KE) + deret angin permukaan ASW', () => {
    expect(sarCase?.sea?.current).toEqual({ dirToDeg: 250, speedKts: 0.5 });
    expect(sarCase?.sea?.surfaceWindSeries?.length).toBe(3);
    expect(sarCase?.sea?.surfaceWindSeries?.[0]).toEqual({
      obsTime: '17 November 2026 18.00 WIT',
      windDirFrom: 80,
      windSpeedKts: 10,
    });
  });

  it('search: datumTime + searchNumber dari lembar pertama', () => {
    expect(sarCase?.search?.datumTime).toBe('18 Nov 2026 07.00 WIT');
    expect(sarCase?.search?.searchNumber).toBe(2);
  });

  it('sru: dua lembar verbatim + aset (koordinat/taf/endurance) menempel', () => {
    const sruList = sarCase?.sru ?? [];
    expect(sruList.length).toBe(2);
    const air = sruList[0];
    expect(air.callsign).toBe('BASARNAS 3');
    expect(air.kind).toBe('fixed-wing');
    expect(air.tasSearchKts).toBe(150);
    expect(air.sheet?.kind).toBe('ws2');
    expect(air.sheet?.searchObject).toBe('raft25');
    expect(air.sheet?.visibilityIndex).toBe(2);
    expect(air.sheet?.selectedHeightFt).toBe(1000);
    expect(air.sheet?.caseWindSpeed).toBe(12);
    expect(air.sheet?.caseWaveHeightM).toBe(1.5);
    expect(air.coord).toEqual({ lat: -1.2, lng: 130.0 });
    expect(air.enduranceHours).toBe(5);
    expect(air.enduranceMinutes).toBe(30);
    expect(air.tasMaxKts).toBe(180);
    const sea = sruList[1];
    expect(sea.kind).toBe('vessel');
    expect(sea.sheet?.kind).toBe('ws8');
    expect(sea.sheet?.eyeHeight).toBe('14');
    expect(sea.sheet?.isFatigue).toBe('Yes');
    expect(sea.sheet?.visibilityKm).toBe('10');
  });

  it('planner: fs dari WS 1, X/Y & leeway dari datum, pola PS', () => {
    expect(result.planner.fs).toBe(1.6);
    expect(result.planner.xNm).toBe(1);
    expect(result.planner.yNm).toBe(0.8);
    expect(result.planner.leewayObjectId).toBe('raft-aviation-46');
    expect(result.planner.patternType).toBe('PS');
    expect(result.planner.fatigue).toBe('Yes');
  });
});

describe('sru.sheet MENANG atas derivation (buildCaseWorksheetSeeds)', () => {
  it('lembar WS 2 memakai nilai sheet, bukan derivation', () => {
    const { seeds } = buildCaseWorksheetSeeds(stateToCase(SNAPSHOT).sarCase!);
    expect(seeds.ws2Sheets.length).toBe(1);
    const data = seeds.ws2Sheets[0].data as Record<string, unknown>;
    expect(data.searchObject).toBe('raft25');
    expect(data.visibilityIndex).toBe(2);
    expect(data.selectedHeight).toBe(1000);
    expect(data.searchNumber).toBe(2);
    expect(data.isFatigue).toBe('No');
    expect(data.caseWindSpeed).toBe(12);
    expect(data.caseWaveHeightM).toBe(1.5);
    const ws8 = seeds.ws8Sheets[0].data as Record<string, unknown>;
    expect(ws8.eyeHeight).toBe('14');
    expect(ws8.isFatigue).toBe('Yes');
    expect(ws8.searchObject).toBe('raft20');
  });

  it('tanpa sheet: derivation lama dipakai (perilaku Fase 1 tidak berubah)', () => {
    const withoutSheet = {
      schemaVersion: 1,
      incident: { type: 'aircraft-ditching' as const, pob: 12, lifeRaftCapacityPerRaft: 25 },
      sru: [
        {
          callsign: 'SRU-X',
          kind: 'fixed-wing' as const,
          visibilityKm: 10,
          tasSearchKts: 150,
        },
      ],
    };
    const parsed = parseSarCase(withoutSheet);
    expect(parsed.ok).toBe(true);
    const { seeds } = buildCaseWorksheetSeeds(parsed.ok ? parsed.data : undefined!);
    const data = seeds.ws2Sheets[0].data as Record<string, unknown>;
    // searchObject dari kapasitas raft (derivation), bukan dari sheet.
    expect(typeof data.searchObject).toBe('string');
    expect(data.searchPlatform).toBe('fixed-wing');
    expect(data.selectedHeight).toBe(1000);
  });
});

describe('runCasePipeline atas snapshot state', () => {
  it('pipeline jalan & deterministik (ok dengan data lengkap)', () => {
    const mapped = stateToCase(SNAPSHOT);
    const parsed = parseSarCase(mapped.sarCase!);
    expect(parsed.ok).toBe(true);
    const output1 = runCasePipeline((parsed as { ok: true; data: Parameters<typeof runCasePipeline>[0] }).data, mapped.planner);
    const output2 = runCasePipeline((parsed as { ok: true; data: Parameters<typeof runCasePipeline>[0] }).data, mapped.planner);
    expect(output1.ok).toBe(true);
    expect(output2.ok).toBe(true);
    expect(output1.asw?.aswSpeed).toBeCloseTo(output2.asw?.aswSpeed ?? 0, 10);
    expect(output1.asw?.aswSpeed).toBeGreaterThan(0);
    expect(output1.datum).toBeDefined();
    expect(output1.ws2Rows?.length).toBe(1);
    expect(output1.ws8Rows?.length).toBe(1);
    expect(output1.ws2Rows?.[0].result.ready).toBe(true);
  });
});

describe('ketahanan stateToCase', () => {
  it('snapshot kosong/tidak objek → ok:false tanpa melempar', () => {
    expect(stateToCase(null).ok).toBe(false);
    expect(stateToCase(undefined).ok).toBe(false);
    expect(stateToCase('bukan objek' as unknown as Record<string, unknown>).ok).toBe(false);
  });

  it('nilai tak valid dilewati dengan warning (baris AWA label aneh)', () => {
    const result = stateToCase({
      awa: { observations: [{ altObs: 'ketinggian rahasia', windDirFrom: 90, windSpeed: 5 }] },
    });
    expect(result.ok).toBe(true);
    expect(result.sarCase?.aeroDrift?.windLayers?.length ?? 0).toBe(0);
    expect(result.warnings.some((warning) => warning.includes('ketinggian tidak terbaca'))).toBe(true);
  });

  it('leewayObjectId tak dikenal → warning (tidak diam-diam)', () => {
    const result = stateToCase({
      datum: { seaCurrentDir: 100, seaCurrentSpeed: 0.4, leewayObjectId: 'objek-karangan' },
    });
    expect(result.warnings.some((warning) => warning.includes('objek-karangan'))).toBe(true);
  });
});

describe('parseAltitudeFtLabel', () => {
  it('Surface/permukaan → 0; FL200 → 20000; "3000 Feet" → 3000', () => {
    expect(parseAltitudeFtLabel('Surface')).toBe(0);
    expect(parseAltitudeFtLabel('permukaan')).toBe(0);
    expect(parseAltitudeFtLabel('FL200')).toBe(20000);
    expect(parseAltitudeFtLabel('3000')).toBe(3000);
    expect(parseAltitudeFtLabel('3000 Feet')).toBe(3000);
    expect(parseAltitudeFtLabel('tinggi tidak jelas')).toBeNull();
  });
});
