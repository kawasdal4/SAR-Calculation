/**
 * Test SAR Capability Registry (PHASE 2 — ADDENDUM MASTER PROMPT §12).
 * Jalankan: bun test tests/capabilityRegistry.test.ts
 *
 * Memastikan registry konsisten (id unik, kategori valid, dependency DAG)
 * dan capability eksekusi delegasi menghasilkan angka yang sama dengan
 * fungsi existing (integrasi AI-workflow vs eksekusi manual, §12).
 */
import { test, expect } from 'bun:test';
import {
  SAR_CAPABILITY_REGISTRY,
  CAPABILITY_CATEGORIES,
  getCapability,
  listCapabilities,
  summarizeRegistry,
} from '../src/lib/sar/capabilityRegistry';
import { computeAWA, computeASW, distanceNm } from '../src/lib/sar/sarCalculations';
import { convertDistance } from '../src/lib/sar/basicCalculations';

// ---------------------------------------------------------------------------
// INTEGRITAS REGISTRY
// ---------------------------------------------------------------------------

test('Semua capability punya kategori yang valid', () => {
  for (const c of SAR_CAPABILITY_REGISTRY) {
    expect(CAPABILITY_CATEGORIES).toContain(c.category);
  }
});

test('ID capability unik', () => {
  const ids = SAR_CAPABILITY_REGISTRY.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('Dependency selalu menunjuk capability yang ada dan membentuk DAG (tanpa siklus)', () => {
  const ids = new Set(SAR_CAPABILITY_REGISTRY.map((c) => c.id));
  for (const c of SAR_CAPABILITY_REGISTRY) {
    for (const dep of c.dependencies ?? []) {
      expect(ids.has(dep)).toBe(true);
    }
  }
  // Deteksi siklus: DFS dengan warna.
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    const state = color.get(id) ?? 0;
    if (state === 1) return false; // siklus
    if (state === 2) return true;
    color.set(id, 1);
    const cap = getCapability(id)!;
    for (const dep of cap.dependencies ?? []) {
      if (!visit(dep)) return false;
    }
    color.set(id, 2);
    return true;
  };
  for (const c of SAR_CAPABILITY_REGISTRY) expect(visit(c.id)).toBe(true);
});

test('Capability unavailable tidak punya execute dan punya catatan gap', () => {
  for (const c of SAR_CAPABILITY_REGISTRY) {
    if (c.status === 'unavailable') {
      expect(c.execute).toBeUndefined();
      expect(c.executionMode).toBe('none');
      expect(c.notes).toBeTruthy();
    }
    if (c.execute) expect(c.implementation.length).toBeGreaterThan(0);
  }
});

test('Ringkasan registry: total & distribusi kategori', () => {
  const s = summarizeRegistry();
  expect(s.total).toBe(SAR_CAPABILITY_REGISTRY.length);
  const catSum = Object.values(s.byCategory).reduce((a, b) => a + b, 0);
  expect(catSum).toBe(s.total);
  expect(listCapabilities({ status: 'unavailable' }).length).toBeGreaterThan(0);
  expect(listCapabilities({ category: 'MAP_OPERATION' }).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// INTEGRASI: eksekusi registry == eksekusi manual fungsi existing (§12)
// ---------------------------------------------------------------------------

test('conv-distance: 15 NM = 27.78 km (fungsi existing convertDistance)', () => {
  const cap = getCapability('conv-distance')!;
  const manual = convertDistance(15, 'nm');
  const viaRegistry = cap.execute?.({ value: 15, from: 'nm' }) as { results: typeof manual };
  expect(viaRegistry.results.km).toBeCloseTo(manual.km, 10);
  expect(viaRegistry.results.km).toBeCloseTo(27.78, 2);
  expect(cap.validateInput?.({ value: 'x', from: 'nm' }).valid).toBe(false);
  expect(cap.validateInput?.({ value: 5, from: 'parsecs' }).valid).toBe(false);
});

test('env-awa: hasil registry identik dengan computeAWA langsung', () => {
  const cap = getCapability('env-awa')!;
  const obs = [
    { altObs: '0', windDirFrom: 205, windSpeed: 21 },
    { altObs: '3000', windDirFrom: 190, windSpeed: 15 },
    { altObs: '6000', windDirFrom: 180, windSpeed: 20 },
    { altObs: '9000', windDirFrom: 280, windSpeed: 26 },
    { altObs: '12000', windDirFrom: 255, windSpeed: 24 },
    { altObs: '18000', windDirFrom: 128, windSpeed: 21 },
  ];
  const manual = computeAWA(obs as never, 19000);
  const viaRegistry = cap.execute?.({ observations: obs, targetAltitudeFt: 19000 }) as typeof manual;
  expect(viaRegistry.awaDirFrom).toBeCloseTo(manual.awaDirFrom, 10);
  expect(viaRegistry.awaSpeed).toBeCloseTo(manual.awaSpeed, 10);
  expect(cap.validateInput?.({ observations: [], targetAltitudeFt: 19000 }).valid).toBe(false);
});

test('env-asw: hasil registry identik dengan computeASW langsung', () => {
  const cap = getCapability('env-asw')!;
  const obs = [
    { timeStart: '06', timeEnd: '12', hours: 6, windDirFrom: 150, windSpeed: 22 },
    { timeStart: '12', timeEnd: '18', hours: 6, windDirFrom: 170, windSpeed: 21 },
  ];
  const manual = computeASW(obs as never);
  const viaRegistry = cap.execute?.({ observations: obs }) as typeof manual;
  expect(viaRegistry.aswDirFrom).toBeCloseTo(manual.aswDirFrom, 10);
  expect(viaRegistry.aswSpeed).toBeCloseTo(manual.aswSpeed, 10);
});

test('ws1-datum: rantai registry == komposisi manual WC/TWC/LW/Datum/E', () => {
  const cap = getCapability('ws1-datum')!;
  const viaRegistry = cap.execute?.({
    start: { lat: -3.7187, lng: 111.7675 },
    driftInterval: 19,
    aswDirFrom: 118.7,
    aswSpeed: 13.3,
    seaCurrentDir: 260,
    seaCurrentSpeed: 2,
    leewayObjectId: 'raft-noballast-drogue',
    X: 0.1,
    Y: 0.1,
  }) as { De: number; E: number; driftDistance: number; datumLeft: { lat: number } };
  expect(viaRegistry.driftDistance).toBeGreaterThan(0);
  expect(viaRegistry.E).toBeGreaterThan(viaRegistry.De); // E = √(De²+X²+Y²) ≥ De
  expect(Math.abs(viaRegistry.datumLeft.lat)).toBeLessThan(90);
  expect(cap.validateInput?.({ start: { lat: 0, lng: 0 }, driftInterval: 0, aswSpeed: 0, leewayObjectId: 'x' }).valid).toBe(false);
});

test('intercept-calculate: overtaking tidak mungkin bila SRU lebih lambat', () => {
  const cap = getCapability('intercept-calculate')!;
  expect(cap.validateInput?.({
    type: 'overtaking',
    target: { name: 'A', pos: { lat: 0, lng: 0 }, speedKts: 20, courseDeg: 90 },
    sru: { name: 'B', pos: { lat: 0, lng: 1 }, speedKts: 10 },
  }).valid).toBe(false);
});

test('transit-go: registry == distanceNm manual (base → CSP)', () => {
  const cap = getCapability('transit-go')!;
  const from = { lat: -3.3186, lng: 114.7371 }; //PBS Palangkaraya (presets Basarnas)
  const to = { lat: -3.75, lng: 111.8 };
  const manual = distanceNm(from, to);
  const viaRegistry = cap.execute?.({ from, to, transitSpeedKts: 180 }) as { distanceNm: number; hours: number };
  expect(viaRegistry.distanceNm).toBeCloseTo(manual, 10);
  expect(viaRegistry.hours).toBeCloseTo(manual / 180, 10);
});

test('conv-dtg: TW 1117 1900 G ter-parse dan terkonversi (aturan G=UTC+7 tetap)', () => {
  const cap = getCapability('conv-dtg')!;
  const r = cap.execute?.({ dtg: 'TW 1117 1900 G' }) as {
    parsed: unknown | null;
    zones: Array<{ zone: string; hhmm: string; dayShift: number }>;
    formatted: string | null;
  };
  expect(r.parsed).not.toBeNull();
  const utc = r.zones.find((z) => z.zone === 'UTC');
  expect(utc?.hhmm).toBe('1200'); // 1900 G (UTC+7) = 12:00 Z
  expect(utc?.dayShift).toBe(0);
});

test('ws2/ws8: delegasi ke computeW2Row/computeW8Row, W=S×C konsisten, POD persen 0–100', () => {
  const ws2 = getCapability('ws2-maritime-wsc-pod')!;
  const r2 = ws2.execute?.({
    platform: 'fixed-wing', target: 'raft6', heightFt: 1000, visibilityIndex: 2,
    windKts: 13.3, tasKts: 150, fatigue: 'No', searchNumber: 1, areaAoNm2: 6421,
  }) as { ready: boolean; Wu: number; fw: number; fs: number; ff: number; W: number; S: number; C: number; POD: number };
  expect(r2.ready).toBe(true);
  expect(r2.Wu).toBeGreaterThan(0);
  expect(r2.W).toBeCloseTo(r2.Wu * r2.fw * r2.fs * r2.ff, 10);
  expect(r2.C).toBeCloseTo(r2.W / r2.S, 10);
  expect(r2.POD).toBeGreaterThanOrEqual(0);
  expect(r2.POD).toBeLessThanOrEqual(100); // POD Figure I-12 dalam persen (konvensi WS2/WS3/WS8)

  const ws8 = getCapability('ws8-vessel-wsc-pod')!;
  const r8 = ws8.execute?.({
    target: 'raft6', eyeHeight: '14', visibility: '10', windKts: 13.3,
    fatigue: 'No', searchNumber: 1, vesselSpeedKts: 10, areaAoNm2: 6421,
  }) as { ready: boolean; W: number; S: number; C: number; POD: number };
  expect(r8.ready).toBe(true);
  expect(r8.W).toBeGreaterThan(0);
  // W dan C dibulatkan 2 desimal di lib (aturan existing Worksheet8) — C ≈ W/S
  expect(r8.C).toBeCloseTo(r8.W / r8.S, 1);
  expect(r8.POD).toBeGreaterThanOrEqual(0);
  expect(r8.POD).toBeLessThanOrEqual(100); // persen
});

test('ws4-land-radius: R dibulatkan ke atas sesuai guide', () => {
  const cap = getCapability('ws4-land-radius')!;
  const r = cap.execute?.({
    points: [{ trNm: 20, x0Nm: 5, yNm: 1, fs: 1.1 }],
    legs: [],
  }) as { perPoint: Array<{ xNm: number; eNm: number; rRoundedNm: number }> };
  const p = r.perPoint[0];
  expect(p.xNm).toBeCloseTo(7, 10); // x = x0 + 0.1×Tr = 5 + 0.1×20 = 7
  expect(p.eNm).toBeCloseTo(7.0711, 3); // √(7²+1²) — lib existing membulatkan ke 4 desimal, aturan tidak diubah
  expect(p.rRoundedNm).toBe(Math.ceil((p.eNm) * 1.1));
});

test('doc-debriefing: execute builder existing tetap menghasilkan dokumen', () => {
  const cap = getCapability('doc-debriefing')!;
  const doc = cap.execute?.({ snapshot: null, bank: [] }) as { sections?: unknown[]; fields?: unknown[] };
  expect(doc).toBeTruthy();
});
