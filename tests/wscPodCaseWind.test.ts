/**
 * Fallback angin kasus (AI asisten) untuk penentu Fw Table I-7.
 * Bug yang diperbaiki: Worksheet 2 (W = Wu.Fw.Fs.Ff tidak dihitung) dan
 * Worksheet 8 (Fw Table I-7 kosong) ketika angin ASW = 0 padahal soal kasus
 * menyebut angin permukaan (dikirim AI asisten sebagai caseWindSpeed).
 * Jalankan: bun test tests/wscPodCaseWind.test.ts
 */
import { test, expect } from 'bun:test';
import { computeW2Row, computeW8Row } from '../src/lib/sar/wscPodTables';

// ---------------------------------------------------------------------------
// Worksheet 2 (pesawat udara di laut)
// ---------------------------------------------------------------------------
const w2Base = {
  platform: 'fixed-wing' as const,
  target: 'raft6' as const,
  heightFt: 1000 as const,
  visibilityIndex: 2, // kolom 10 km
  windKts: 0,         // ASW belum dihitung
  tasKts: 180,
  fatigue: 'No' as const,
  searchNumber: 1 as const,
};

test('W2: ASW=0 + angin kasus 20 kt (small) → Fw=0.5 dan W = Wu.Fw.Fs.Ff terhitung', () => {
  const r = computeW2Row({ ...w2Base, caseWindKts: 20 });
  expect(r.windSource).toBe('Kasus');
  expect(r.windUsed).toBe(20);
  expect(r.fw).toBe(0.5);
  expect(r.ready).toBe(true);
  // Wu Table I-5 (1000 ft, raft6, 10 km) = 1.6; fs=1.0 (TAS 180); ff=1.0
  expect(r.Wu).toBe(1.6);
  expect(r.W).toBeCloseTo(1.6 * 0.5 * 1.0 * 1.0, 10);
  expect(r.S).toBeGreaterThan(0);
  expect(r.C).toBeGreaterThan(0);
  expect(r.POD).toBeGreaterThan(0);
});

test('W2: angin ASW tetap prioritas — ASW 13.3 kt dipakai meski angin kasus ada', () => {
  const r = computeW2Row({ ...w2Base, windKts: 13.3, caseWindKts: 30 });
  expect(r.windSource).toBe('ASW');
  expect(r.windUsed).toBe(13.3);
  expect(r.fw).toBe(1); // < 15 kt → Fw 1.0
});

test('W2: angin kasus > 25 kt (small) → Fw=0.25 sesuai Table I-7', () => {
  const r = computeW2Row({ ...w2Base, caseWindKts: 30 });
  expect(r.windSource).toBe('Kasus');
  expect(r.fw).toBe(0.25);
  expect(r.W).toBeCloseTo(1.6 * 0.25 * 1.0 * 1.0, 10);
});

test('W2: tanpa angin ASW maupun kasus → Fw=0, W=0, ready=false (perilaku lama)', () => {
  const r = computeW2Row(w2Base);
  expect(r.windSource).toBe('-');
  expect(r.windUsed).toBe(0);
  expect(r.fw).toBe(0);
  expect(r.ready).toBe(false);
  expect(r.W).toBe(0);
});

// ---------------------------------------------------------------------------
// Worksheet 8 (kapal permukaan)
// ---------------------------------------------------------------------------
const w8Base = {
  target: 'boat8to12' as const,
  eyeHeight: '14' as const,
  visibilityKm: '10',
  windKts: 0, // ASW belum dihitung
  fatigue: 'No' as const,
  searchNumber: 1 as const,
  vesselSpeedKts: 10,
};

test('W8: ASW=0 + angin kasus 20 kt (other) → Fw=0.8 dan W = Wu.Fw.Ff terhitung', () => {
  const r = computeW8Row({ ...w8Base, caseWindKts: 20 });
  expect(r.windSource).toBe('Kasus');
  expect(r.windUsed).toBe(20);
  expect(r.fw).toBe(0.8);
  expect(r.ready).toBe(true);
  // Wu Table I-3 (eye 14 ft, boat 8-12m, vis 10 km) = 4.0; ff=1.0
  expect(r.Wu).toBe(4);
  expect(r.W).toBeCloseTo(4 * 0.8 * 1.0, 10);
  expect(r.S).toBeGreaterThan(0);
  expect(r.POD).toBeGreaterThan(0);
});

test('W8: target kecil (person) + angin kasus 30 kt → Fw=0.25 sesuai Table I-7', () => {
  const r = computeW8Row({
    ...w8Base,
    target: 'person',
    eyeHeight: '8',
    visibilityKm: '5',
    caseWindKts: 30,
  });
  expect(r.windSource).toBe('Kasus');
  expect(r.fw).toBe(0.25);
  // Wu Table I-3 (eye 8 ft, person, vis 5 km) = 0.2
  expect(r.W).toBeCloseTo(0.2 * 0.25 * 1.0, 10);
});

test('W8: tanpa angin ASW maupun kasus → Fw=0, W=0 (Fw Table I-7 tidak ada nilainya)', () => {
  const r = computeW8Row(w8Base);
  expect(r.windSource).toBe('-');
  expect(r.fw).toBe(0);
  expect(r.ready).toBe(false);
  expect(r.W).toBe(0);
});

test('W8: ASW tetap prioritas — ASW 28 kt dipakai meski angin kasus ada', () => {
  const r = computeW8Row({ ...w8Base, windKts: 28, caseWindKts: 5 });
  expect(r.windSource).toBe('ASW');
  expect(r.windUsed).toBe(28);
  expect(r.fw).toBe(0.5); // other group, > 25 kt → 0.5 sesuai Table I-7
});

// ---------------------------------------------------------------------------
// Table I-7: baris cuaca dari ANGIN ATAU GELOMBANG (seas) — data kasus AI asisten
// ---------------------------------------------------------------------------
import { fwRowFromWind, fwRowFromWave, lookupFwByRow, formatFwBasis } from '../src/lib/sar/wscPodTables';

test('I-7 baris: angin (<15 / 15-25 / >25 kt) dan gelombang (<=1 / <=1.5 / >1.5 m)', () => {
  expect(fwRowFromWind(14.9)).toBe(1);
  expect(fwRowFromWind(15)).toBe(2);
  expect(fwRowFromWind(25)).toBe(2);
  expect(fwRowFromWind(25.1)).toBe(3);
  expect(fwRowFromWave(0)).toBe(1);
  expect(fwRowFromWave(1)).toBe(1);
  expect(fwRowFromWave(1.1)).toBe(2);
  expect(fwRowFromWave(1.5)).toBe(2);
  expect(fwRowFromWave(1.6)).toBe(3);
  expect(lookupFwByRow(2, 'small')).toBe(0.5);
  expect(lookupFwByRow(2, 'other')).toBe(0.8);
  expect(lookupFwByRow(3, 'small')).toBe(0.25);
  expect(lookupFwByRow(3, 'other')).toBe(0.5);
});

test('W2: tanpa angin, gelombang kasus 1.2 m (small) → Fw=0.5 dan W terhitung', () => {
  const r = computeW2Row({ ...w2Base, caseWaveHeightM: 1.2 });
  expect(r.fwBasis).toBe('wave-case');
  expect(r.windSource).toBe('-');
  expect(r.waveUsedM).toBe(1.2);
  expect(r.fwRow).toBe(2);
  expect(r.fw).toBe(0.5);
  expect(r.ready).toBe(true);
  expect(r.W).toBeCloseTo(1.6 * 0.5 * 1.0 * 1.0, 10);
  expect(r.POD).toBeGreaterThan(0);
});

test('W2: gelombang kasus 2 m (small) → baris 3 → Fw=0.25', () => {
  const r = computeW2Row({ ...w2Base, caseWaveHeightM: 2 });
  expect(r.fwRow).toBe(3);
  expect(r.fw).toBe(0.25);
  expect(r.W).toBeCloseTo(1.6 * 0.25 * 1.0 * 1.0, 10);
});

test('W2: gelombang kasus 0.5 m → baris 1 → Fw=1.0', () => {
  const r = computeW2Row({ ...w2Base, caseWaveHeightM: 0.5 });
  expect(r.fwRow).toBe(1);
  expect(r.fw).toBe(1);
});

test('W2: angin kasus 10 kt (baris 1) + gelombang 1.8 m (baris 3) → TERBURUK baris 3', () => {
  const r = computeW2Row({ ...w2Base, caseWindKts: 10, caseWaveHeightM: 1.8 });
  expect(r.fwBasis).toBe('wind-case+wave-case');
  expect(r.fwRow).toBe(3);
  expect(r.fw).toBe(0.25);
});

test('W2: angin ASW 12 kt (baris 1) + gelombang kasus 1.8 m (baris 3) → terburuk, basis ASW+gelombang', () => {
  const r = computeW2Row({ ...w2Base, windKts: 12, caseWaveHeightM: 1.8 });
  expect(r.fwBasis).toBe('wind-asw+wave-case');
  expect(r.windSource).toBe('ASW');
  expect(r.fwRow).toBe(3);
  expect(r.fw).toBe(0.25);
});

test('W8: tanpa angin, gelombang kasus 1.3 m (other) → Fw=0.8 dan W terhitung', () => {
  const r = computeW8Row({ ...w8Base, caseWaveHeightM: 1.3 });
  expect(r.fwBasis).toBe('wave-case');
  expect(r.fwRow).toBe(2);
  expect(r.fw).toBe(0.8);
  expect(r.ready).toBe(true);
  expect(r.W).toBeCloseTo(4 * 0.8 * 1.0, 10);
  expect(r.S).toBeGreaterThan(0);
});

test('formatFwBasis: label penentu Fw sesuai basis', () => {
  expect(formatFwBasis({ fwBasis: 'wind-asw', windUsed: 15, waveUsedM: 0 })).toBe('penentu: angin ASW 15.0 kt');
  expect(formatFwBasis({ fwBasis: 'wind-case', windUsed: 20, waveUsedM: 0 })).toBe('penentu: angin kasus (AI asisten) 20.0 kt');
  expect(formatFwBasis({ fwBasis: 'wave-case', windUsed: 0, waveUsedM: 1.2 })).toBe('penentu: gelombang kasus (AI asisten) 1.2 m');
  expect(formatFwBasis({ fwBasis: 'wind-case+wave-case', windUsed: 10, waveUsedM: 1.8 })).toBe('penentu: angin kasus 10.0 kt + gelombang kasus 1.8 m (terburuk)');
  expect(formatFwBasis({ fwBasis: 'none', windUsed: 0, waveUsedM: 0 })).toBe('penentu: angin/gelombang belum tersedia (ASW / kasus AI)');
});
