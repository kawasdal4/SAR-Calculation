/**
 * PHASE 4 — Uji pengukuran jarak peta (1 menit = 1 NM), kontrak preview
 * seragam MAP_OPERATION, dan delegasi registry ke lib chartDistance.
 * Jalankan: bun test tests/phase4_chartDistance.test.ts
 */
import { test, expect } from 'bun:test';
import {
  minutesToNm,
  minutesToMeters,
  lonMinutesToNm,
  cmToNmAtScale,
  nmToMeters,
  chartDistanceFromMinutes,
  chartDistanceFromPoints,
  chartMeasureGuide,
  CHART_DISTANCE_RULE,
  ONC_SCALE,
} from '../src/lib/sar/chartDistance';
import { getCapability } from '../src/lib/sar/capabilityRegistry';

// ---------------------------------------------------------------------------
// Aturan dasar: 1 menit skala = 1 NM = 1852 m
// ---------------------------------------------------------------------------

test('aturan dasar: 1 menit = 1 NM; 60 menit = 60 NM; 1 NM = 1852 m', () => {
  expect(minutesToNm(1)).toBe(1);
  expect(minutesToNm(60)).toBe(60);
  expect(nmToMeters(1)).toBe(1852);
  expect(minutesToMeters(1)).toBe(1852);
  expect(CHART_DISTANCE_RULE).toContain('1 menit');
});

test('konversi menit → NM/km/m: 12,5 menit = 12,5 NM = 23,15 km', () => {
  const r = chartDistanceFromMinutes(12.5);
  expect(r.method).toBe('lat-minutes');
  expect(r.distanceNm).toBe(12.5);
  expect(r.distanceKm).toBeCloseTo(12.5 * 1.852, 10);
  expect(r.distanceM).toBeCloseTo(12.5 * 1852, 10);
  expect(chartDistanceFromMinutes(-12.5).distanceNm).toBe(12.5); // span selalu positif
});

test('skala bujur: 1\' bujur = cos(lat) NM — ekuator 1, di 60° menjadi 0,5', () => {
  expect(lonMinutesToNm(60, 0)).toBeCloseTo(60, 10);
  expect(lonMinutesToNm(60, 60)).toBeCloseTo(30, 10);
});

test('skala nominal ONC: 1 cm pada 1:1.000.000 ≈ 5,40 NM', () => {
  expect(cmToNmAtScale(ONC_SCALE)).toBeCloseTo(1_000_000 / 100 / 1852, 10); // 10000/1852 = 5,3996
  expect(cmToNmAtScale(ONC_SCALE)).toBeCloseTo(5.3996, 3);
  expect(cmToNmAtScale(ONC_SCALE)).toBeCloseTo(5.40, 2);
});

// ---------------------------------------------------------------------------
// Mode dua koordinat — setara ukur jangka di skala lintang
// ---------------------------------------------------------------------------

test('dua koordinat 1° lintang ≈ 60 NM, Δlat = 60 menit, faktor bujur ≈ 1 di dekat ekuator', () => {
  const r = chartDistanceFromPoints({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  expect(r.method).toBe('points');
  expect(r.deltaLatMinutes).toBeCloseTo(60, 6);
  expect(r.distanceNm).toBeGreaterThan(59.9);
  expect(r.distanceNm).toBeLessThan(60.1);
  // midLat = 0,5° → 1' bujur = cos(0,5°) ≈ 0,99996 NM (sedikit di bawah 1)
  expect(r.lonMinuteNm).toBeCloseTo(Math.cos((0.5 * Math.PI) / 180), 10);
  expect(r.lonMinuteNm).toBeGreaterThan(0.9999);
  expect(r.greatCircleNm).toBe(r.distanceNm);
});

test('arah timur–barat di ekuator 1° bujur ≈ 60 NM, di 60° ≈ 30 NM', () => {
  const eq = chartDistanceFromPoints({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
  const high = chartDistanceFromPoints({ lat: 60, lng: 0 }, { lat: 60, lng: 1 });
  expect(eq.distanceNm).toBeGreaterThan(59.9);
  expect(eq.distanceNm).toBeLessThan(60.1);
  expect(high.distanceNm).toBeGreaterThan(29.8);
  expect(high.distanceNm).toBeLessThan(30.2);
});

// ---------------------------------------------------------------------------
// Pengetahuan (kb-chart-distance-guide)
// ---------------------------------------------------------------------------

test('panduan: peta laut 5 langkah + peta udara 5 langkah + tabel konversi 1\'=1 NM', () => {
  const both = chartMeasureGuide('both');
  expect(both.sections).toHaveLength(2);
  expect(both.sections[0].title).toContain('Peta Laut');
  expect(both.sections[0].steps.length).toBeGreaterThanOrEqual(5);
  expect(both.sections[1].title).toContain('Peta Udara');
  const oneCm = both.conversionTable.find((c) => c.unit.includes('1 cm'));
  expect(oneCm?.valueNm).toBeCloseTo(5.40, 2);
  const guide = getCapability('kb-chart-distance-guide')!;
  const out = guide.execute?.({ chart: 'sea' }) as { sections: unknown[]; rule: string };
  expect(out.sections).toHaveLength(1);
  expect(out.rule).toBe(CHART_DISTANCE_RULE);
  expect(guide.execute?.({}) as { sections: unknown[] }).toHaveProperty('sections');
});

// ---------------------------------------------------------------------------
// Registry: delegasi ke lib (bukan duplikasi)
// ---------------------------------------------------------------------------

test('registry measure-chart-distance execute == lib langsung (dua mode)', () => {
  const cap = getCapability('measure-chart-distance')!;
  expect(cap.executionMode).toBe('lib');
  expect(cap.execute?.({ deltaLatMinutes: 12.5 })).toEqual(chartDistanceFromMinutes(12.5));
  expect(cap.execute?.({ deltaLatMinutes: 8, chart: 'air' })).toEqual(chartDistanceFromMinutes(8, 'air'));
  const p1 = { lat: -6.2, lng: 106.8 };
  const p2 = { lat: -5.9, lng: 107.1 };
  expect(cap.execute?.({ p1, p2 })).toEqual(chartDistanceFromPoints(p1, p2));
});

test('registry measure-chart-distance: validasi menolak input kosong & koordinat tak valid', () => {
  const cap = getCapability('measure-chart-distance')!;
  expect(cap.validateInput?.({}).valid).toBe(false);
  expect(cap.validateInput?.({ deltaLatMinutes: 5 }).valid).toBe(true);
  expect(cap.validateInput?.({ p1: { lat: 999, lng: 0 }, p2: { lat: 0, lng: 0 } }).valid).toBe(false);
  expect(cap.validateInput?.({ deltaLatMinutes: 5, chart: 'space' }).valid).toBe(false);
});

// ---------------------------------------------------------------------------
// PHASE 4: kontrak preview/konfirmasi seragam MAP_OPERATION
// ---------------------------------------------------------------------------

test('map-sea-render: preview menampilkan jumlah fitur + konfirmasi wajib', () => {
  const cap = getCapability('map-sea-render')!;
  const p = cap.preview!({
    features: [
      { kind: 'marker', label: 'LKP', lat: -6.2, lng: 106.8 },
      { kind: 'circle', label: 'Search area', lat: -6.2, lng: 106.8, radiusNm: 6 },
      { kind: 'polygon', label: 'Trapesium' },
    ],
  });
  expect(p.operation).toBe('map-sea-render');
  expect(p.target).toBe('sea-map');
  expect(p.summary).toContain('3 fitur');
  expect(p.summary).toContain('1 marker');
  expect(p.summary).toContain('1 circle');
  expect(p.summary).toContain('1 polygon');
  expect(p.requiresUserConfirmation).toBe(true);
  expect(p.reversible).toBe(true);
  expect(p.features.length).toBe(3);
  expect(p.features[0].label).toBe('LKP');
  // Tanpa fitur → ringkasan netral, tetap kontrak valid
  const empty = cap.preview!({ features: [] });
  expect(empty.summary).toContain('Tidak ada fitur');
  expect(empty.requiresUserConfirmation).toBe(true);
});

test('map-ws4-plot: preview merangkum marker/lingkaran/trapesium ke peta ONC', () => {
  const cap = getCapability('map-ws4-plot')!;
  const p = cap.preview!({ markers: [{}, {}], circles: [{}], polygons: [] });
  expect(p.operation).toBe('map-ws4-plot');
  expect(p.target).toBe('onc-map');
  expect(p.summary).toContain('2 marker rute');
  expect(p.summary).toContain('1 lingkaran radius');
  expect(p.requiresUserConfirmation).toBe(true);
  expect(p.warnings?.length).toBeGreaterThan(0);
});

test('map-ups-plot: preview merangkum chain ADW + leg manual, konfirmasi tidak wajib (deterministik)', () => {
  const cap = getCapability('map-ups-plot')!;
  const p = cap.preview!({ aeroResults: {}, datumResults: {}, manualLegs: [{}, {}] });
  expect(p.operation).toBe('map-ups-plot');
  expect(p.target).toBe('ups-plotter');
  expect(p.summary).toContain('rantai vektor ADW');
  expect(p.summary).toContain('2 leg manual');
  expect(p.requiresUserConfirmation).toBe(false);
  const empty = cap.preview!({});
  expect(empty.summary).toContain('kosong');
});
