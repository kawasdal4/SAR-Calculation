/**
 * Penentu Fw Table I-7 dari angin/gelombang kasus (AI asisten).
 * Aturan (rujukan Table I-7 di dialog Manual SAR AUS web app — Appendix_I_al1.pdf
 * hal. I-16): ANGIN penentu = angin HEADER worksheet — angin kasus bila ada,
 * fallback angin ASW. GELOMBANG (seas) kasus juga penentu baris; bila angin dan
 * gelombang keduanya ada, dipakai baris TERBURUK (paling konservatif).
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

test('W2: angin header = angin kasus — kasus 30 kt menang atas ASW 13.3 kt (small → Fw=0.25)', () => {
  const r = computeW2Row({ ...w2Base, windKts: 13.3, caseWindKts: 30 });
  expect(r.windSource).toBe('Kasus');
  expect(r.windUsed).toBe(30);
  expect(r.fw).toBe(0.25); // angin kasus 30 kt > 25 kt → baris 3, small
});

test('W2: angin kasus > 25 kt (small) → Fw=0.25 sesuai Table I-7', () => {
  const r = computeW2Row({ ...w2Base, caseWindKts: 30 });
  expect(r.windSource).toBe('Kasus');
  expect(r.fw).toBe(0.25);
  expect(r.W).toBeCloseTo(1.6 * 0.25 * 1.0 * 1.0, 10);
});

test('W2: tanpa angin kasus → angin header fallback ke ASW (ASW 13.3 kt → Fw=1.0)', () => {
  const r = computeW2Row({ ...w2Base, windKts: 13.3 });
  expect(r.windSource).toBe('ASW');
  expect(r.windUsed).toBe(13.3);
  expect(r.fw).toBe(1); // < 15 kt → Fw 1.0
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

test('W8: angin header = angin kasus — kasus 5 kt menang atas ASW 28 kt (other → Fw=1.0)', () => {
  const r = computeW8Row({ ...w8Base, windKts: 28, caseWindKts: 5 });
  expect(r.windSource).toBe('Kasus');
  expect(r.windUsed).toBe(5);
  expect(r.fw).toBe(1); // angin kasus 5 kt < 15 kt → baris 1
});

// ---------------------------------------------------------------------------
// Table I-7: baris cuaca dari ANGIN ATAU GELOMBANG (seas) — data kasus AI asisten
// ---------------------------------------------------------------------------
import { fwRowFromWind, fwRowFromWave, lookupFwByRow } from '../src/lib/sar/wscPodTables';

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

test('W8: gelombang kasus 1.3 m (other) + angin kasus 5 kt (baris 1) → TERBURUK baris 2 → Fw=0.8', () => {
  const r = computeW8Row({ ...w8Base, caseWindKts: 5, caseWaveHeightM: 1.3 });
  expect(r.fwBasis).toBe('wind-case+wave-case');
  expect(r.fwRow).toBe(2);
  expect(r.fw).toBe(0.8);
  expect(r.ready).toBe(true);
  expect(r.W).toBeCloseTo(4 * 0.8 * 1.0, 10);
  expect(r.S).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Override nilai tabel appendix (klik nilai worksheet → panel verifikasi → Terapkan)
// ---------------------------------------------------------------------------
test('W2: override fw/fs/Wu dipakai langsung & mengalir ke W/S/C/POD/T', () => {
  // Wu tabel (1000 ft, raft6, 10 km) = 1.6 → override 2.4; fw tabel 0.5 → override 0.4; fs 1.0 → override 0.9
  const r = computeW2Row({ ...w2Base, caseWindKts: 20, overrides: { Wu: 2.4, fw: 0.4, fs: 0.9 } });
  expect(r.Wu).toBe(2.4);
  expect(r.fw).toBe(0.4);
  expect(r.fs).toBe(0.9);
  expect(r.W).toBeCloseTo(2.4 * 0.4 * 0.9 * 1.0, 10);
  expect(r.S).toBeGreaterThan(0);
  expect(r.C).toBeGreaterThan(0);
  expect(r.POD).toBeGreaterThan(0);
});

test('W2: override fw tetap ready walau angin tidak tersedia (fwRow null)', () => {
  const r = computeW2Row({ ...w2Base, overrides: { fw: 0.8 } });
  expect(r.fw).toBe(0.8);
  expect(r.ready).toBe(true);
  expect(r.W).toBeCloseTo(1.6 * 0.8 * 1.0 * 1.0, 10);
});

test('W2: override 0/undefined → kembali ke nilai tabel', () => {
  const withOverride = computeW2Row({ ...w2Base, caseWindKts: 20, overrides: { fw: 0.4, Wu: 2.4 } });
  const reset = computeW2Row({ ...w2Base, caseWindKts: 20, overrides: { fw: 0, Wu: 0 } });
  const plain = computeW2Row({ ...w2Base, caseWindKts: 20 });
  expect(reset.fw).toBe(plain.fw);
  expect(reset.Wu).toBe(plain.Wu);
  expect(reset.W).toBeCloseTo(plain.W, 10);
  expect(withOverride.fw).toBe(0.4);
});

test('W8: override fw/Wu dipakai langsung (W = Wu.fw.ff)', () => {
  const r = computeW8Row({ ...w8Base, caseWindKts: 20, overrides: { Wu: 5, fw: 0.5 } });
  expect(r.Wu).toBe(5);
  expect(r.fw).toBe(0.5);
  expect(r.W).toBeCloseTo(Number((5 * 0.5 * 1.0).toFixed(2)), 10);
  expect(r.ready).toBe(true);
});
