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
import { deepEqualValue, filterSarCases, shallowEqualRecord } from '../src/lib/sar/stateSync';

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
