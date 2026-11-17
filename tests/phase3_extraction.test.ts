/**
 * PHASE 3 — Uji ekstraksi math worksheet ke lib.
 * Memastikan fungsi lib baru (computeW2Row, computeW8Row, computeWs1SearchArea)
 * menghasilkan angka yang SAMA dengan rumus inline komponen sebelumnya, dan
 * registry execute == pemanggilan lib langsung.
 * Jalankan: bun test tests/phase3_extraction.test.ts
 */
import { test, expect } from 'bun:test';
import {
  computeW2Row,
  computeW8Row,
  w8TargetGroup,
  lookupW2Wu,
  lookupFw,
  lookupFs,
  W2_TARGET_OPTIONS,
  type W2Target,
} from '../src/lib/sar/wscPodTables';
import { computeWs1SearchArea, computeE } from '../src/lib/sar/sarCalculations';
import { getCapability } from '../src/lib/sar/capabilityRegistry';

// ---------------------------------------------------------------------------
// computeW2Row == rumus inline Worksheet2.tsx sebelum ekstraksi
// ---------------------------------------------------------------------------

const w2BaseInput = {
  platform: 'fixed-wing' as const,
  target: 'raft6' as W2Target,
  heightFt: 1000 as const,
  visibilityIndex: 2,
  windKts: 13.3,
  tasKts: 150,
  fatigue: 'No' as const,
  searchNumber: 1 as const,
  areaAoNm2: 6421,
};

test('computeW2Row: W = Wu×fw×fs×ff, S pembulatan 0.5, C, POD, T — identik rumus lama', () => {
  const r = computeW2Row(w2BaseInput);
  // Rumus inline lama di Worksheet2.tsx:
  const targetMeta = W2_TARGET_OPTIONS.find((t) => t.id === 'raft6')!;
  const fwOld = lookupFw(13.3, targetMeta.fwGroup);
  const fsOld = lookupFs('raft6', 'fixed-wing', 150) ?? 0;
  const ffOld = 1; // fatigue 'No'
  const wuOld = lookupW2Wu('fixed-wing', 'raft6', 1000, 2) ?? 0;
  const wOld = wuOld * fwOld * fsOld * ffOld;
  const sOld = Math.max(0.5, Math.round(wOld / 0.5) * 0.5);
  expect(r.ready).toBe(true);
  expect(r.Wu).toBe(wuOld);
  expect(r.fw).toBe(fwOld);
  expect(r.fs).toBe(fsOld);
  expect(r.W).toBeCloseTo(wOld, 12);
  expect(r.S).toBe(sOld);
  expect(r.C).toBeCloseTo(wOld / sOld, 12);
  expect(r.POD).toBeGreaterThan(0);
  expect(r.POD).toBeLessThanOrEqual(100);
  expect(r.T).toBeCloseTo(6421 / (150 * sOld), 12);
});

test('computeW2Row: kasus PIW flotation known → Wu 500 ft ×4 (rumus lama)', () => {
  const base = { ...w2BaseInput, platform: 'helicopter' as const, target: 'piw' as W2Target, heightFt: 500 as const, tasKts: 60, fatigue: 'Yes' as const };
  const r = computeW2Row({ ...base, piwFlotationKnown: true });
  const wuNoFloat = computeW2Row({ ...base, piwFlotationKnown: false });
  expect(r.Wu).toBeCloseTo(wuNoFloat.Wu * 4, 12);
  // Hanya berlaku di 500 ft; di 1000 ft tidak ada pengali
  const r1000 = computeW2Row({ ...base, piwFlotationKnown: true, heightFt: 1000 as const });
  const r1000b = computeW2Row({ ...base, piwFlotationKnown: false, heightFt: 1000 as const });
  expect(r1000.Wu).toBeCloseTo(r1000b.Wu, 12);
});

test('computeW2Row: TAS di luar Table I-8 → fs=0 → ready=false dan W=0 (gerbang lama)', () => {
  const r = computeW2Row({ ...w2BaseInput, tasKts: 999 });
  expect(r.fs).toBe(0);
  expect(r.ready).toBe(false);
  expect(r.W).toBe(0);
  expect(r.POD).toBe(0);
});

test('computeW2Row: input belum lengkap → semua nol (baris kosong worksheet)', () => {
  const r = computeW2Row({ ...w2BaseInput, platform: '', target: '', visibilityIndex: -1, fatigue: '', searchNumber: 0, windKts: 0 });
  expect(r.Wu).toBe(0);
  expect(r.W).toBe(0);
  expect(r.S).toBe(0);
  expect(r.C).toBe(0);
  expect(r.POD).toBe(0);
  expect(r.T).toBe(0);
});

// ---------------------------------------------------------------------------
// computeW8Row == rumus inline Worksheet8.tsx (termasuk pembulatan)
// ---------------------------------------------------------------------------

test('computeW8Row: W & C dibulatkan 2 desimal, S 0.25, T 1 desimal — identik rumus lama', () => {
  const r = computeW8Row({
    target: 'raft6', eyeHeight: '14', visibilityKm: '10', windKts: 13.3,
    fatigue: 'No', searchNumber: 1, vesselSpeedKts: 10, areaAoNm2: 6421,
  });
  const fwOld = lookupFw(13.3, w8TargetGroup('raft6'));
  expect(r.ready).toBe(true);
  expect(r.fw).toBe(fwOld);
  expect(r.W).toBe(Number((r.Wu * fwOld * 1).toFixed(2))); // ff=1
  expect(r.S).toBe(Math.max(0.25, Math.round(r.W / 0.25) * 0.25));
  expect(r.C).toBe(Number((r.W / r.S).toFixed(2)));
  expect(r.T).toBe(Number((6421 / (10 * r.S)).toFixed(1)));
  expect(r.POD).toBeGreaterThanOrEqual(0);
  expect(r.POD).toBeLessThanOrEqual(100);
});

test('computeW8Row: target kecil (raft/person/boat≤8) masuk grup "small" (Table I-7 lama)', () => {
  expect(w8TargetGroup('person')).toBe('small');
  expect(w8TargetGroup('raft4')).toBe('small');
  expect(w8TargetGroup('boatUnder5')).toBe('small');
  expect(w8TargetGroup('boat5to8')).toBe('small');
  expect(w8TargetGroup('raft15')).toBe('small'); // startsWith('raft')
  expect(w8TargetGroup('boat12to20')).toBe('other');
  expect(w8TargetGroup('ship27')).toBe('other');
});

// ---------------------------------------------------------------------------
// computeWs1SearchArea == rumus inline Worksheet1.tsx
// ---------------------------------------------------------------------------

test('computeWs1SearchArea: E = √(De²+X²+Y²), R = ⌈E×fs⌉, Ao = 4R² — identik rumus lama', () => {
  const De = 5, X = 0.1, Y = 0.1, fs = 1.1;
  const r = computeWs1SearchArea({ De, X, Y, fs });
  const eOld = Math.sqrt(De * De + X * X + Y * Y);
  const rOld = Math.ceil(eOld * fs);
  expect(r.E).toBeCloseTo(eOld, 12);
  expect(r.R).toBe(rOld);
  expect(r.Ao).toBe(4 * rOld * rOld);
  // computeE existing tetap sumber E
  expect(r.E).toBe(computeE({ X, De, Y }).E);
});

// ---------------------------------------------------------------------------
// Registry == lib langsung (delegasi, bukan duplikasi)
// ---------------------------------------------------------------------------

test('registry ws2/ws8/ws1-search-area execute == pemanggilan lib langsung', () => {
  const r2 = getCapability('ws2-maritime-wsc-pod')!.execute?.(w2BaseInput);
  expect(r2).toEqual(computeW2Row(w2BaseInput));

  const w8Input = {
    target: 'raft6' as const, eyeHeight: '14' as const, visibility: '10', windKts: 13.3,
    fatigue: 'No' as const, searchNumber: 1 as const, vesselSpeedKts: 10, areaAoNm2: 6421,
  };
  const r8 = getCapability('ws8-vessel-wsc-pod')!.execute?.(w8Input);
  expect(r8).toEqual(computeW8Row({
    target: w8Input.target, eyeHeight: w8Input.eyeHeight, visibilityKm: w8Input.visibility,
    windKts: w8Input.windKts, fatigue: w8Input.fatigue, searchNumber: w8Input.searchNumber,
    vesselSpeedKts: w8Input.vesselSpeedKts, areaAoNm2: w8Input.areaAoNm2,
  }));

  const rAo = getCapability('ws1-search-area')!.execute?.({ De: 5, X: 0.1, Y: 0.1, fs: 1.1 });
  expect(rAo).toEqual(computeWs1SearchArea({ De: 5, X: 0.1, Y: 0.1, fs: 1.1 }));

  const rAoE = getCapability('ws1-search-area')!.execute?.({ E: 5.0014, fs: 1.1 });
  expect(rAoE).toEqual({ E: 5.0014, R: Math.ceil(5.0014 * 1.1), Ao: 4 * Math.ceil(5.0014 * 1.1) ** 2 });
});

test('registry ws1-search-area: tolak input tanpa E/De dan fs di luar opsi', () => {
  const cap = getCapability('ws1-search-area')!;
  expect(cap.validateInput?.({ fs: 1.1 }).valid).toBe(false);
  expect(cap.validateInput?.({ E: 5, fs: 1.3 }).valid).toBe(false);
  expect(cap.validateInput?.({ De: 5, fs: 2.0 }).valid).toBe(true);
});
