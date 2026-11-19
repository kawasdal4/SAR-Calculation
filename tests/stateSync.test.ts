/**
 * Sinkronisasi state antar worksheet & manajemen kasus (save/load).
 *
 * Latar (perbaikan save case):
 * 1. Save case hanya memuat sebagian data (AWA + lembar hasil apply AI) —
 *    input manual WS 2/3/8/WS1/WS4/Intercept/Briefing/Renops hilang.
 * 2. Dialog Open Case tanpa pencarian — sulit menemukan kasus di antara
 *    banyak kasus tersimpan.
 *
 * Utilitas di stateSync.ts dipakai page.tsx (guard anti-loop mirror
 * onStateChange → sheet.data) dan CaseManager.tsx (filter daftar kasus).
 * Jalankan: bun test tests/stateSync.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { deepEqualValue, filterSarCases, shallowEqualRecord, hasFilledValue, firstFilledSnapshot, mergeAswSnapshot, describeRestoredCaseSections } from '../src/lib/sar/stateSync';

describe('deepEqualValue', () => {
  it('primitif identik → true', () => {
    expect(deepEqualValue(1, 1)).toBe(true);
    expect(deepEqualValue('a', 'a')).toBe(true);
    expect(deepEqualValue(null, null)).toBe(true);
    expect(deepEqualValue(undefined, undefined)).toBe(true);
  });

  it('primitif berbeda → false', () => {
    expect(deepEqualValue(1, 2)).toBe(false);
    expect(deepEqualValue('a', 'b')).toBe(false);
    expect(deepEqualValue(1, '1')).toBe(false);
    expect(deepEqualValue(null, 0)).toBe(false);
    expect(deepEqualValue(undefined, null)).toBe(false);
  });

  it('array dengan isi sama (referensi beda) → true', () => {
    expect(deepEqualValue([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqualValue([1, [2, { a: 3 }]], [1, [2, { a: 3 }]])).toBe(true);
  });

  it('array beda panjang / isi → false', () => {
    expect(deepEqualValue([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqualValue([0, 0, 0, 0], [0, 0, 0, 1])).toBe(false);
  });

  it('objek polir sama (referensi beda) → true', () => {
    expect(deepEqualValue({ a: 1, b: 'x' }, { b: 'x', a: 1 })).toBe(true);
  });

  it('objek nested (waypoint tuple) sama → true', () => {
    const points = () => [
      { name: 'A', lat: 1, lng: 2 },
      { name: 'B', lat: 3, lng: 4 },
    ];
    expect(deepEqualValue({ routePoints: points() }, { routePoints: points() })).toBe(true);
    expect(
      deepEqualValue({ routePoints: points() }, { routePoints: [{ name: 'A', lat: 1, lng: 2 }, { name: 'B', lat: 3, lng: 5 }] }),
    ).toBe(false);
  });
});

describe('shallowEqualRecord', () => {
  it('undefined diperlakukan sama dengan objek kosong', () => {
    expect(shallowEqualRecord(undefined, {})).toBe(true);
    expect(shallowEqualRecord({ a: 1 }, undefined)).toBe(false);
  });

  it('referensi sama → true tanpa inspeksi', () => {
    const obj = { a: 1 };
    expect(shallowEqualRecord(obj, obj)).toBe(true);
  });

  it('isi sama referensi beda → true (guard anti loop)', () => {
    expect(shallowEqualRecord({ fs: 1.1, fixErrors: [0, 0, 0, 0] }, { fs: 1.1, fixErrors: [0, 0, 0, 0] })).toBe(true);
    expect(shallowEqualRecord({ fs: 1.1 }, { fs: 1.6 })).toBe(false);
  });
});

describe('filterSarCases — pencarian pada dialog Open Case', () => {
  const cases = [
    { id: '1', title: 'M/V NEVERSEEN — Java Sea', caseNumber: 'RCC-2026-0142', searchObject: '6-person orange liferaft', notes: 'angin 15 kts', phase: 'DISTRESS' },
    { id: '2', title: 'KM Sinar Jaya', caseNumber: null, searchObject: 'fishing vessel', notes: null, phase: 'ALERT' },
    { id: '3', title: 'Pesawat PK-ABC ditching', caseNumber: 'RCC-2026-0200', searchObject: null, notes: 'parasut 3 orang', phase: 'DISTRESS' },
  ];

  it('query kosong → seluruh daftar', () => {
    expect(filterSarCases(cases, '')).toHaveLength(3);
    expect(filterSarCases(cases, '   ')).toHaveLength(3);
  });

  it('pencarian judul tidak peka kapitalisasi', () => {
    expect(filterSarCases(cases, 'neverseen').map((c) => c.id)).toEqual(['1']);
  });

  it('pencarian nomor kasus', () => {
    expect(filterSarCases(cases, '0142').map((c) => c.id)).toEqual(['1']);
  });

  it('pencarian objek pencarian & notes', () => {
    expect(filterSarCases(cases, 'liferaft').map((c) => c.id)).toEqual(['1']);
    expect(filterSarCases(cases, 'parasut').map((c) => c.id)).toEqual(['3']);
  });

  it('pencarian fase', () => {
    expect(filterSarCases(cases, 'alert').map((c) => c.id)).toEqual(['2']);
  });

  it('multi kata: semua token harus cocok (AND)', () => {
    expect(filterSarCases(cases, 'sinar jaya').map((c) => c.id)).toEqual(['2']);
    expect(filterSarCases(cases, 'sinar xyz')).toEqual([]);
    expect(filterSarCases(cases, 'distress parasut').map((c) => c.id)).toEqual(['3']);
  });
});

describe('hasFilledValue — deteksi nilai berisi', () => {
  it('primitif', () => {
    expect(hasFilledValue(0)).toBe(false);
    expect(hasFilledValue(6)).toBe(true);
    expect(hasFilledValue('x')).toBe(true);
    expect(hasFilledValue('')).toBe(false);
    expect(hasFilledValue(false)).toBe(false);
    expect(hasFilledValue(true)).toBe(true);
    expect(hasFilledValue(null)).toBe(false);
    expect(hasFilledValue(undefined)).toBe(false);
    expect(hasFilledValue(Number.NaN)).toBe(false);
  });
  it('array & objek rekursif', () => {
    expect(hasFilledValue([])).toBe(false);
    expect(hasFilledValue([{ a: 1 }])).toBe(true);
    expect(hasFilledValue({ a: null, b: undefined, c: '' })).toBe(false);
    expect(hasFilledValue({ a: { b: { c: 0 } } })).toBe(false);
    expect(hasFilledValue({ a: { b: { c: 15 } } })).toBe(true);
  });
});

describe('firstFilledSnapshot — pilih snapshot terisi (mirror vs data awal)', () => {
  it('mirror berisi → menang', () => {
    expect(firstFilledSnapshot({ driftInterval: 15 }, { driftInterval: 6 })).toEqual({ driftInterval: 15 });
  });
  it('mirror kosong/null → fallback data awal (AI/kasus)', () => {
    expect(firstFilledSnapshot(null, { driftInterval: 6 })).toEqual({ driftInterval: 6 });
    expect(firstFilledSnapshot({ X: 0, Y: 0 }, { driftInterval: 6, X: 0, Y: 0 })).toEqual({ driftInterval: 6, X: 0, Y: 0 });
  });
  it('keduanya kosong → undefined', () => {
    expect(firstFilledSnapshot({}, undefined)).toBeUndefined();
    expect(firstFilledSnapshot({ X: 0, Y: 0 }, { seaCurrentDir: 0, seaCurrentSpeed: 0 })).toBeUndefined();
  });
});

describe('mergeAswSnapshot — gabungan per-bidang ASW', () => {
  it('mirror kosong → seluruh data dari fallback (AI/kasus)', () => {
    const merged = mergeAswSnapshot(
      { observations: [], aswErr: 0 },
      { observations: [{ windDirFrom: 90 }], aswErr: 2, distressTime: '1117.0700 Z', datumTime: '1118.0100 Z', obsIntervalMode: '6h', caseTitle: 'EXE' },
    );
    expect(merged.observations).toHaveLength(1);
    expect(merged.aswErr).toBe(2);
    expect(merged.distressTime).toBe('1117.0700 Z');
    expect(merged.datumTime).toBe('1118.0100 Z');
    expect(merged.obsIntervalMode).toBe('6h');
    expect(merged.caseTitle).toBe('EXE');
  });
  it('mirror berisi → observasi & waktu mirror menang, bagian kosong diisi fallback', () => {
    const merged = mergeAswSnapshot(
      { observations: [{ windDirFrom: 45 }], aswErr: 3, distressTime: '1117.0800 Z' },
      { observations: [{ windDirFrom: 90 }], aswErr: 0, distressTime: '1117.0700 Z', datumTime: '1118.0100 Z' },
    );
    expect(merged.observations).toEqual([{ windDirFrom: 45 }]);
    expect(merged.aswErr).toBe(3);
    expect(merged.distressTime).toBe('1117.0800 Z');
    expect(merged.datumTime).toBe('1118.0100 Z');
  });
  it('keduanya kosong → hasil kosong dengan default interval 6h', () => {
    const merged = mergeAswSnapshot({ observations: [], aswErr: 0 }, {});
    expect(merged.observations).toEqual([]);
    expect(merged.obsIntervalMode).toBe('6h');
  });
});

describe('describeRestoredCaseSections — info kelengkapan kasus saat load', () => {
  it('kasus lengkap: semua bagian berisi', () => {
    const state = {
      awa: { observations: [{ windDirFrom: 1 }] },
      asw: { observations: [{ windDirFrom: 2 }] },
      datum: { driftInterval: 6, seaCurrentDir: 90, seaCurrentSpeed: 1 },
      lkp: { lat: 1, lng: 2 },
      assets: [{ id: 'a' }],
      ws2Sheets: [{ key: 'default', data: { searchTas: 140 } }],
      patternType: 'PS',
      patternOrientationText: '308',
    };
    const { filled, empty } = describeRestoredCaseSections(state);
    expect(filled).toContain('AWA');
    expect(filled).toContain('ASW');
    expect(filled).toContain('WS 1 (Datum)');
    expect(filled).toContain('LKP');
    expect(filled).toContain('Aset SRU');
    expect(filled).toContain('WS 2');
    expect(filled).toContain('Pola Pencarian');
    expect(empty).not.toContain('AWA');
  });
  it('kasus versi lama (hanya AWA): bagian lain dilaporkan kosong', () => {
    const state = { awa: { observations: [{ windDirFrom: 1 }] } };
    const { filled, empty } = describeRestoredCaseSections(state);
    expect(filled).toEqual(['AWA']);
    expect(empty).toContain('ASW');
    expect(empty).toContain('WS 1 (Datum)');
    expect(empty).toContain('WS 2');
    expect(empty).toContain('Aset SRU');
  });
  it('snapshot null/kosong → semua kosong', () => {
    const { filled, empty } = describeRestoredCaseSections(null);
    expect(filled).toEqual([]);
    expect(empty.length).toBeGreaterThan(10);
  });
});
