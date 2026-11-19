/**
 * Normalisasi argumen tool kasus AI sebelum gate validasi apply.
 *
 * Latar (bug kasus nyata di Vercel): pratinjau menampilkan SEMUA operasi
 * worksheet, tetapi setelah "Terapkan" hanya AWA yang terisi — argumen dari
 * model cadangan berisi angka-string ("140"), varian ejaan enum ("Fixed
 * Wing", "no", "20 km"), dan teks target bebas ("life raft 6 person") yang
 * ditolak gate validasi ketat di AIChatPanel.
 *
 * Jalankan: bun test tests/caseToolNormalize.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  coerceNumber,
  coerceBool,
  normalizeCaseToolArgs,
  normalizeW2Target,
  normalizeW8Target,
  normalizeW2VisibilityIndex,
  normalizeW8Visibility,
  normalizeEyeHeight,
} from '../src/lib/sar/caseToolNormalize';

describe('coerceNumber', () => {
  it('number lolos apa adanya', () => {
    expect(coerceNumber(140)).toBe(140);
    expect(coerceNumber(18.9)).toBe(18.9);
    expect(coerceNumber(Number.NaN)).toBeUndefined();
  });
  it('string berlabel → angka', () => {
    expect(coerceNumber('140')).toBe(140);
    expect(coerceNumber('18.9 kts')).toBe(18.9);
    expect(coerceNumber('070°T')).toBe(70);
    expect(coerceNumber('1000 ft')).toBe(1000);
    expect(coerceNumber('4 hrs')).toBe(4);
    expect(coerceNumber('15 jam')).toBe(15);
    expect(coerceNumber('0.5 NM')).toBe(0.5);
  });
  it('desimal koma gaya Indonesia', () => {
    expect(coerceNumber('1,5')).toBe(1.5);
    expect(coerceNumber('0,036')).toBe(0.036);
    expect(coerceNumber('1.000 ft')).toBe(1000);
  });
  it('nilai bukan angka → undefined', () => {
    expect(coerceNumber('')).toBeUndefined();
    expect(coerceNumber('-')).toBeUndefined();
    expect(coerceNumber('teks')).toBeUndefined();
    expect(coerceNumber(undefined)).toBeUndefined();
    expect(coerceNumber(null)).toBeUndefined();
    expect(coerceNumber(true)).toBeUndefined();
  });
});

describe('coerceBool', () => {
  it('varian yes/ya/no/tidak', () => {
    expect(coerceBool('yes')).toBe(true);
    expect(coerceBool('Ya')).toBe(true);
    expect(coerceBool(true)).toBe(true);
    expect(coerceBool('no')).toBe(false);
    expect(coerceBool('TIDAK')).toBe(false);
    expect(coerceBool(false)).toBe(false);
    expect(coerceBool('mungkin')).toBeUndefined();
  });
});

describe('normalizeW2VisibilityIndex', () => {
  it('index langsung 0-5', () => {
    expect(normalizeW2VisibilityIndex(3, undefined)).toBe(3);
  });
  it('dari km (string "20 km")', () => {
    expect(normalizeW2VisibilityIndex(undefined, 20)).toBe(3);
    expect(normalizeW2VisibilityIndex(undefined, '20 km')).toBe(3);
    expect(normalizeW2VisibilityIndex(undefined, 5)).toBe(1);
    expect(normalizeW2VisibilityIndex(undefined, 50)).toBe(5);
    expect(normalizeW2VisibilityIndex(undefined, 2)).toBe(0);
  });
});

describe('normalizeW8Visibility', () => {
  it('kolom kanonik I-3/I-4', () => {
    expect(normalizeW8Visibility('20 km')).toBe('20');
    expect(normalizeW8Visibility(20)).toBe('20');
    expect(normalizeW8Visibility(26)).toBe('>25');
    expect(normalizeW8Visibility('>25')).toBe('>25');
    expect(normalizeW8Visibility(15)).toBe('15');
    expect(normalizeW8Visibility(3)).toBe('2');
  });
});

describe('normalizeEyeHeight', () => {
  it('angka/string ft → 8/14', () => {
    expect(normalizeEyeHeight('14 ft')).toBe('14');
    expect(normalizeEyeHeight(14)).toBe('14');
    expect(normalizeEyeHeight(8)).toBe('8');
    expect(normalizeEyeHeight('MERSHIP')).toBe('MERSHIP');
  });
  it('default per jenis alut saat kosong', () => {
    expect(normalizeEyeHeight(undefined, 'rib')).toBe('8');
    expect(normalizeEyeHeight(undefined, 'rescue-vessel')).toBe('14');
  });
});

describe('normalizeW2Target', () => {
  it('id kanonik lolos', () => {
    expect(normalizeW2Target('piw')).toBe('piw');
    expect(normalizeW2Target('raft6')).toBe('raft6');
  });
  it('teks bebas → id', () => {
    expect(normalizeW2Target('Person in Water')).toBe('piw');
    expect(normalizeW2Target('life raft 6 person')).toBe('raft6');
    expect(normalizeW2Target(undefined, 'rakit 15 orang')).toBe('raft15');
    expect(normalizeW2Target('power boat 10m')).toBe('boat10');
    expect(normalizeW2Target('sail boat 12m')).toBe('sail12');
    expect(normalizeW2Target('cargo ship 100 m')).toBe('shipOver91');
    expect(normalizeW2Target('kapal 30 m')).toBe('ship27');
  });
  it('target tak dikenal → undefined (gate menolak, jangan mengarang)', () => {
    expect(normalizeW2Target('benda misterius')).toBeUndefined();
  });
});

describe('normalizeW8Target', () => {
  it('teks bebas → id I-3', () => {
    expect(normalizeW8Target('person in water')).toBe('person');
    expect(normalizeW8Target('Raft 4 Person')).toBe('raft4');
    expect(normalizeW8Target(undefined, 'perahu 6 m')).toBe('boat5to8');
  });
});

describe('normalizeCaseToolArgs — set_ws2_case', () => {
  it('angka-string + enum varian → kanonik (kasus gagal-apply asli)', () => {
    const out = normalizeCaseToolArgs('set_ws2_case', {
      caseTitle: 'EXE FAKFAK 2026',
      searchPlatform: 'Fixed Wing',
      searchTas: '140',
      visibilityKm: '20 km',
      isFatigue: 'no',
      selectedHeight: '1000 ft',
      searchNumber: '1',
      searchObject: 'life raft 6 person',
      hoursAvailable: '4',
    });
    expect(out.searchPlatform).toBe('fixed-wing');
    expect(out.searchTas).toBe(140);
    expect(out.visibilityIndex).toBe(3);
    expect(out.isFatigue).toBe('Yes' ? 'No' : out.isFatigue); // 'no' → 'No'
    expect(out.isFatigue).toBe('No');
    expect(out.selectedHeight).toBe(1000);
    expect(out.searchNumber).toBe(1);
    expect(out.searchObject).toBe('raft6');
    expect(out.hoursAvailable).toBe(4);
  });
  it('selectedHeight 1200 → snap 1000; hilang → default 1000', () => {
    expect(normalizeCaseToolArgs('set_ws2_case', { selectedHeight: 1200 }).selectedHeight).toBe(1000);
    expect(normalizeCaseToolArgs('set_ws2_case', {}).selectedHeight).toBe(1000);
  });
  it('searchNumber hilang → default 1', () => {
    expect(normalizeCaseToolArgs('set_ws2_case', {}).searchNumber).toBe(1);
  });
  it('data valid tidak berubah', () => {
    const out = normalizeCaseToolArgs('set_ws2_case', {
      searchPlatform: 'fixed-wing',
      searchTas: 140,
      visibilityIndex: 3,
      isFatigue: 'No',
      selectedHeight: 1000,
      searchObject: 'piw',
    });
    expect(out.searchTas).toBe(140);
    expect(out.visibilityIndex).toBe(3);
    expect(out.searchObject).toBe('piw');
  });
});

describe('normalizeCaseToolArgs — set_datum_case', () => {
  it('angka-string, nav aid teks, leeway deskripsi, latitude dari lkp', () => {
    const out = normalizeCaseToolArgs('set_datum_case', {
      driftInterval: '15',
      seaCurrentDir: '070°',
      seaCurrentSpeed: '0,5',
      lkp: { lat: -5.6, lng: 110.5 },
      latitude: '5.6',
      xNavAid: 'GPS',
      yNavAid: 'radar',
      leewayObjectId: 'unknown-object',
      leewayDescription: 'person in water wearing lifejacket',
      lkpSource: 'explicit',
    });
    expect(out.driftInterval).toBe(15);
    expect(out.seaCurrentDir).toBe(70);
    expect(out.seaCurrentSpeed).toBe(0.5);
    expect(out.latitude).toBe(5.6);
    expect(out.xNavAid).toBe('gps');
    expect(out.yNavAid).toBe('radar');
    expect(out.leewayObjectId).toBe('piw-lifejacket');
  });
  it('latitude hilang → |lat| LKP (divergensi WC)', () => {
    const out = normalizeCaseToolArgs('set_datum_case', {
      lkp: { lat: -5.6, lng: 110.5 },
      driftInterval: 6,
      seaCurrentDir: 90,
      seaCurrentSpeed: 1,
    });
    expect(out.latitude).toBe(5.6);
    expect(out.lkpSource).toBe('explicit');
  });
});

describe('normalizeCaseToolArgs — set_asw_case', () => {
  it('intervalMode hilang → derivasi dari jam observasi', () => {
    const out = normalizeCaseToolArgs('set_asw_case', {
      distressTime: '1117.0700 Z',
      datumTime: '1118.0100 Z',
      windData: [
        { obsTime: '17/07.00', windDirFrom: '090', windSpeed: '10' },
        { obsTime: '17/13.00', windDirFrom: 90, windSpeed: 10 },
      ],
    });
    expect(out.intervalMode).toBe('6h');
    expect(out.windData).toEqual([
      { windDirFrom: 90, windSpeed: 10, obsTime: '17/07.00' },
      { windDirFrom: 90, windSpeed: 10, obsTime: '17/13.00' },
    ]);
  });
  it('observasi 03.00/15.00 → 3h', () => {
    const out = normalizeCaseToolArgs('set_asw_case', {
      distressTime: 'x', datumTime: 'y',
      windData: [{ obsTime: '17/03.00', windDirFrom: 90, windSpeed: 10 }],
    });
    expect(out.intervalMode).toBe('3h');
  });
});

describe('normalizeCaseToolArgs — set_asset_allocation_case', () => {
  it('angka-string + TAF varian + mesin', () => {
    const out = normalizeCaseToolArgs('set_asset_allocation_case', {
      sruType: 'Fixed Wing Aircraft',
      homeBaseName: 'Bandara Ahmad Yani',
      homeBaseLat: '-6.9',
      homeBaseLng: '107,6',
      transitSpeedKts: '160',
      searchSpeedKts: '140',
      enduranceHours: '5',
      sweepWidthNm: '0,5',
      airEngineType: 'Piston',
      tafCondition: 'Cerah',
    });
    expect(out.sruType).toBe('fixed-wing-aircraft');
    expect(out.homeBaseLat).toBe(-6.9);
    expect(out.homeBaseLng).toBe(107.6);
    expect(out.transitSpeedKts).toBe(160);
    expect(out.searchSpeedKts).toBe(140);
    expect(out.enduranceHours).toBe(5);
    expect(out.sweepWidthNm).toBe(0.5);
    expect(out.airEngineType).toBe('piston');
    expect(out.tafCondition).toBe('cerah');
  });
});

describe('normalizeCaseToolArgs — set_ws8_case', () => {
  it('sruType/eyeHeight/visibility/fatigue varian → kanonik', () => {
    const out = normalizeCaseToolArgs('set_ws8_case', {
      sruType: 'Patrol Boat',
      eyeHeight: '14 ft',
      visibilityKm: '20 km',
      isFatigue: 'no',
      vesselSpeedKts: '12',
      searchObject: 'person in water',
    });
    expect(out.sruType).toBe('patrol-boat');
    expect(out.eyeHeight).toBe('14');
    expect(out.visibilityKm).toBe('20');
    expect(out.isFatigue).toBe('No');
    expect(out.vesselSpeedKts).toBe(12);
    expect(out.searchObject).toBe('person');
    expect(out.searchNumber).toBe(1);
  });
});

describe('normalizeCaseToolArgs — set_search_pattern_case / set_intercept_case', () => {
  it('pola PS varian + haluan modulus', () => {
    const out = normalizeCaseToolArgs('set_search_pattern_case', {
      patternType: 'expanding square',
      orientationDeg: '308,7',
      turnDirection: 'kanan',
      datumPos: { lat: '-5.6', lng: 110.5 },
    });
    expect(out.patternType).toBe('PS');
    expect(out.orientationDeg).toBe(308.7);
    expect(out.turnDirection).toBe('right');
    expect(out.datumPos).toEqual({ lat: -5.6, lng: 110.5 });
  });
  it('intercept angka-string + tipe varian', () => {
    const out = normalizeCaseToolArgs('set_intercept_case', {
      type: 'berlawanan arah',
      target: { pos: { lat: '5.6', lng: '110.5' }, speedKts: '10', courseDeg: '090' },
      sru: { pos: { lat: 5.6, lng: 110.5 }, speedKts: 20 },
    });
    expect(out.type).toBe('head-on');
    const target = out.target as { speedKts: number; courseDeg: number; pos: { lat: number } };
    expect(target.speedKts).toBe(10);
    expect(target.courseDeg).toBe(90);
    expect(target.pos.lat).toBe(5.6);
  });
});

describe('normalizeCaseToolArgs — set_aero_drift_case', () => {
  it('angka-string koersiyon + posisi', () => {
    const out = normalizeCaseToolArgs('set_aero_drift_case', {
      incidentPos: { lat: '-4.5', lng: '135.2' },
      useAircraftGlide: 'true',
      aircraftAltMaxFt: '10000',
      aircraftAltMinFt: '0',
      aircraftGlideRatio: '9,5',
      aircraftTASgKts: '120',
      aircraftDescentHeadingDeg: '270°',
    });
    expect(out.incidentPos).toEqual({ lat: -4.5, lng: 135.2 });
    expect(out.useAircraftGlide).toBe(true);
    expect(out.aircraftAltMaxFt).toBe(10000);
    expect(out.aircraftAltMinFt).toBe(0);
    expect(out.aircraftGlideRatio).toBe(9.5);
    expect(out.aircraftTASgKts).toBe(120);
    expect(out.aircraftDescentHeadingDeg).toBe(270);
  });
});

describe('normalizeCaseToolArgs — set_ws3_case / set_ws4_case', () => {
  it('WS3 varian enum → kanonik', () => {
    const out = normalizeCaseToolArgs('set_ws3_case', {
      searchObject: 'orang',
      visibilityKm: '20',
      vegetationType: '60-85 %',
      isFatigue: true,
      searchPlatform: 'heli',
      searchNumber: '2',
    });
    expect(out.searchObject).toBe('person');
    expect(out.visibilityKm).toBe(20);
    expect(out.vegetationType).toBe('60-85');
    expect(out.isFatigue).toBe(true);
    expect(out.searchPlatform).toBe('helicopter');
    expect(out.searchNumber).toBe(2);
  });
  it('WS4 safety factor snap + array angka-string', () => {
    const out = normalizeCaseToolArgs('set_ws4_case', {
      safetyFactor: '1,1',
      routeLegDistancesNm: ['12', '15 nm', 20],
      fixErrors: ['0.1', '0.2', '0.1', '0.3'],
      yNavError: '0,1',
      targetNavigationType: 'GPS',
      trStartMode: 'manual',
      initialTrNm: '5',
    });
    expect(out.safetyFactor).toBe(1.1);
    expect(out.routeLegDistancesNm).toEqual([12, 15, 20]);
    expect(out.fixErrors).toEqual([0.1, 0.2, 0.1, 0.3]);
    expect(out.yNavError).toBe(0.1);
    expect(out.targetNavigationType).toBe('gps');
    expect(out.initialTrNm).toBe(5);
  });
});

describe('normalizeCaseToolArgs — tool tak dikenal', () => {
  it('args diteruskan tanpa perubahan', () => {
    const raw = { foo: '1' };
    expect(normalizeCaseToolArgs('unknown_tool', raw)).toEqual(raw);
  });
});

describe('normalizeCaseToolArgs — set_awa_case alias observations (bug AWA kosong)', () => {
  it('kunci `observations` (bentuk seeds/ekstraksi) dipindahkan ke windData', () => {
    const out = normalizeCaseToolArgs('set_awa_case', {
      distressAltFt: '10000',
      observations: [
        { altitudeLabel: 'Surface', windDirFrom: '45', windSpeedKts: '5' },
        { altitudeLabel: '3000', windDirFrom: 55, windSpeedKts: 10 },
      ],
    }) as { windData?: Array<{ altObs?: string; windDirFrom: number; windSpeed: number }>; distressAltFt?: unknown };
    expect(Array.isArray(out.windData)).toBe(true);
    expect(out.windData!.length).toBe(2);
    expect(out.windData![0].windDirFrom).toBe(45);
    expect(out.windData![0].windSpeed).toBe(5);
  });

  it('windData tetap utama bila ada (tidak ditimpa observations)', () => {
    const out = normalizeCaseToolArgs('set_awa_case', {
      windData: [{ altObs: '0', windDirFrom: 350, windSpeed: 10 }],
      observations: [{ altObs: '0', windDirFrom: 1, windSpeed: 1 }],
    }) as { windData?: Array<{ windDirFrom: number }> };
    expect(out.windData![0].windDirFrom).toBe(350);
  });
});
