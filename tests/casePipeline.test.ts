/**
 * Test CasePipeline (Fase 1 AI Copilot) — orkestrasi headless rantai worksheet
 * dari fixture PK-TAL. Nilai expected resmi (kunci instruktur) BELUM diisi:
 * TODO: expected values from instructor key. Test ini memverifikasi ALUR,
 * DETERMINISME, dan rentang kewajaran (sanity) — bukan angka final.
 * Jalankan: bun test tests/casePipeline.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { runCasePipeline } from '../src/lib/sar/casePipeline';
import type { SarCaseSchema } from '../src/lib/sar/caseSchema';
import pkTalJson from './golden/pk-tal.case.json';

const PK_TAL = pkTalJson as unknown as SarCaseSchema;

// Kategori leeway dipilih planner (soal tidak merinci ballast/canopy/drogue).
// 'raft-aviation-46' = Aviation life raft, no ballast w/ canopy, 4-6 person
// (Tabel I-1, VERIFIED) — pilihan planner, BUKAN nilai yang dikarang.
const PLANNER = { leewayObjectId: 'raft-aviation-46' };

describe('runCasePipeline — fixture PK-TAL (ditching laut)', () => {
  const result = runCasePipeline(PK_TAL, PLANNER);

  it('seluruh langkah inti berhasil dalam urutan rantai worksheet', () => {
    expect(result.steps.map((step) => step.step)).toEqual([
      'asw',
      'awa',
      'aero-drift',
      'datum-ws1',
      'ws2-wsc-pod',
      'ws8-wsc-pod',
      'search-pattern',
      'asset-allocation',
    ]);
    expect(result.ok).toBe(true);
  });

  it('ASW: total hours (D) wajar untuk 18 Nov 13.50 → 19 Nov 07.00 (±17 jam)', () => {
    expect(result.asw).toBeDefined();
    expect(result.asw!.totalHours).toBeGreaterThan(16);
    expect(result.asw!.totalHours).toBeLessThan(18.5);
    expect(result.asw!.aswSpeed).toBeGreaterThan(0);
    expect(result.asw!.observations.length).toBeGreaterThan(2);
  });

  it('AWA: valid dengan 7 lapis angin', () => {
    expect(result.awa?.isValid).toBe(true);
    expect(result.awa?.rows.length).toBe(7);
    expect(result.awa?.awaSpeed).toBeGreaterThan(0);
    expect(result.awa?.awaSpeed).toBeLessThan(30);
  });

  it('ADW: posisi ditching valid & wajar (drift < 100 NM dari LKP)', () => {
    expect(result.aero?.positionValid).toBe(true);
    expect(result.aero?.totalDisplacementNm).toBeGreaterThan(1);
    expect(result.aero?.totalDisplacementNm).toBeLessThan(100);
    // Posisi ditching ≠ LKP (ada drift)
    expect(result.aero?.landingPos).not.toEqual({ lat: -6.879444, lng: 105.261389 });
  });

  it('Datum WS 1: E, R, Ao wajar (aturan a = Total Hours ASW, LKP = posisi ditching)', () => {
    expect(result.datum).toBeDefined();
    expect(result.searchArea?.aoSquareNm2).toBeGreaterThan(0);
    expect(result.searchArea?.aoSquareNm2).toBeLessThan(100000);
    expect(result.searchArea?.RUp).toBeGreaterThanOrEqual(1);
    expect(result.searchArea?.E).toBeGreaterThan(0);
    // hours of drift = ASW total hours (aturan worksheet)
    expect(result.datum!.hours).toBeCloseTo(result.asw!.totalHours, 6);
  });

  it('WS 2: dua lembar helikopter ready (W, S, C, POD terisi)', () => {
    expect(result.ws2Rows?.length).toBe(2);
    for (const entry of result.ws2Rows ?? []) {
      expect(entry.result.ready).toBe(true);
      expect(entry.result.S).toBeGreaterThan(0);
      expect(entry.result.W).toBeGreaterThan(0);
      expect(entry.result.POD).toBeGreaterThanOrEqual(0);
      expect(entry.result.POD).toBeLessThanOrEqual(100);
    }
  });

  it('WS 8: lembar kapal ready', () => {
    expect(result.ws8Rows?.length).toBe(1);
    expect(result.ws8Rows![0].result.ready).toBe(true);
    expect(result.ws8Rows![0].result.S).toBeGreaterThan(0);
  });

  it('Search Pattern: CSP & jarak wajar, S dari lembar worksheet', () => {
    expect(result.pattern).toBeDefined();
    expect(result.pattern!.totalDistanceNm).toBeGreaterThan(0);
    expect(Number.isFinite(result.pattern!.csp.lat)).toBe(true);
    expect(Number.isFinite(result.pattern!.csp.lng)).toBe(true);
    // track spacing pola = S lembar pertama yang ready (tercatat di asumsi)
    expect(result.assumptions.some((note) => note.field === 'pattern.trackSpacingNm')).toBe(true);
  });

  it('Alokasi Aset: 3 unit dihitung, coverage ≥ 0', () => {
    expect(result.allocation?.perAsset.length).toBe(3);
    expect(result.allocation!.coverageRatio).toBeGreaterThanOrEqual(0);
    expect(result.allocation!.requiredAreaAoNm2).toBeCloseTo(result.searchArea!.aoSquareNm2, 6);
  });

  it('deterministik: hasil dua kali jalan identik', () => {
    const again = runCasePipeline(PK_TAL, PLANNER);
    expect(JSON.stringify(again)).toBe(JSON.stringify(result));
  });

  it('tanpa pilihan leeway: langkah datum ERROR dan ok=false (tidak mengarang kategori)', () => {
    const noLeeway = runCasePipeline(PK_TAL, {});
    const datumStep = noLeeway.steps.find((step) => step.step === 'datum-ws1');
    expect(datumStep?.status).toBe('error');
    expect(noLeeway.ok).toBe(false);
  });
});
