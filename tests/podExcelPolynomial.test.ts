/**
 * Rumus POD polinomial Excel POD.xls (permintaan pengguna: POD WS 2/3/8 memakai
 * rumus Excel terlampir). Nilai eksak = evaluasi sheet "POD" pada C = 1.068
 * (sel T33–T37), konstanta kolom V–AB baris 33–37.
 * Jalankan: bun test tests/podExcelPolynomial.test.ts
 */
import { test, expect } from 'bun:test';
import { readFigureI12, computeW2Row, computePOD } from '../src/lib/sar/wscPodTables';

test('readFigureI12: nilai eksak Excel pada C = 1.068 (T33–T37)', () => {
  expect(readFigureI12(1.068, 1)).toBeCloseTo(81.9592570565795, 9);
  expect(readFigureI12(1.068, 2)).toBeCloseTo(96.9635037348582, 9);
  expect(readFigureI12(1.068, 3)).toBeCloseTo(99.5712595964259, 9);
  expect(readFigureI12(1.068, 4)).toBe(100);
  expect(readFigureI12(1.068, 5)).toBe(100);
});

test('readFigureI12: tepi domain — C ≤ 0/NaN → 0, C ≥ 2 di-clamp ke ujung kurva', () => {
  expect(readFigureI12(0, 1)).toBe(0);
  expect(readFigureI12(-0.5, 3)).toBe(0);
  expect(readFigureI12(NaN, 2)).toBe(0);
  // Polinomial di C = 2 (ujung domain): Search 1–2 di bawah cap, 3–5 kena cap 99.7→100
  expect(readFigureI12(2, 1)).toBeCloseTo(98.9088, 6);
  expect(readFigureI12(2, 2)).toBeCloseTo(99.6368, 6);
  expect(readFigureI12(2, 3)).toBe(100);
  expect(readFigureI12(2, 4)).toBe(100);
  expect(readFigureI12(2, 5)).toBe(100);
  // Di luar domain: clamp (bukan ekstrapolasi polinomial)
  expect(readFigureI12(2.5, 1)).toBe(readFigureI12(2, 1));
  expect(readFigureI12(3.7, 5)).toBe(100);
});

test('readFigureI12: hasil selalu 0–100 dan cap > 99.7 → 100 (aturan IF Excel)', () => {
  for (const n of [1, 2, 3, 4, 5] as const) {
    for (let c = 0.01; c <= 2.0001; c += 0.05) {
      const pod = readFigureI12(c, n);
      expect(pod).toBeGreaterThanOrEqual(0);
      expect(pod).toBeLessThanOrEqual(100);
    }
  }
});

test('readFigureI12: mendekati tabel kurva Excel (Search 1–4, selisih ≤ 3 poin)', () => {
  const table: Array<[number, number[]]> = [
    [0.5, [47, 72, 85, 92]], [1, [79, 95.5, 99, 100]], [1.3, [90, 99, 100, 100]],
    [1.5, [95, 100, 100, 100]], [1.8, [98, 100, 100, 100]],
  ];
  for (const [c, ys] of table) {
    ys.forEach((y, i) => {
      expect(Math.abs(readFigureI12(c, (i + 1) as 1) - y)).toBeLessThanOrEqual(3);
    });
  }
});

test('computeW2Row memakai rumus Excel: baris siap → POD sesuai polinomial C baris itu', () => {
  const row = computeW2Row({
    platform: 'fixed-wing', target: 'raft15', heightFt: 1000, visibilityIndex: 2,
    windKts: 10, tasKts: 180, fatigue: 'No', searchNumber: 1, areaAoNm2: 100,
  });
  expect(row.ready).toBe(true);
  expect(row.C).toBeGreaterThan(0);
  expect(row.POD).toBeCloseTo(readFigureI12(row.C, 1), 9);
});

test('computePOD (Search Plan): fraksi 0–1 dari polinomial Excel sesuai urutan pencarian kasus', () => {
  // Eksak Excel C=1.068 dibagi 100: First 0.819592570565795 / Second 0.969635037348582 / Third 0.995712595964259
  expect(computePOD(1.068, 1)).toBeCloseTo(0.819592570565795, 9);
  expect(computePOD(1.068, 2)).toBeCloseTo(0.969635037348582, 9);
  expect(computePOD(1.068, 3)).toBeCloseTo(0.995712595964259, 9);
  expect(computePOD(1.068, 4)).toBe(1);
  expect(computePOD(1.068, 5)).toBe(1);
  // Default = pencarian pertama (1)
  expect(computePOD(1.068)).toBe(computePOD(1.068, 1));
  // Tepi domain
  expect(computePOD(0)).toBe(0);
  expect(computePOD(-0.5, 2)).toBe(0);
  expect(computePOD(2, 3)).toBe(1);
  expect(computePOD(2.5, 1)).toBe(computePOD(2, 1));
  // Selalu 0–1 pada domain
  for (let c = 0.01; c <= 2.0001; c += 0.1) {
    expect(computePOD(c, 1)).toBeGreaterThanOrEqual(0);
    expect(computePOD(c, 1)).toBeLessThanOrEqual(1);
  }
});
