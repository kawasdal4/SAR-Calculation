/**
 * Test evalGolden (Fase 6 AI Copilot) — comparator akurasi per field untuk
 * eval golden set. Semua kasus OFFLINE (tanpa panggilan LLM).
 *
 * Jalankan: bun test tests/evalGolden.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  compareGoldenCases,
  formatGoldenEvalReport,
} from '../src/lib/ai/evalGolden';

describe('evalGolden — comparator golden set', () => {
  const golden = {
    caseTitle: 'Final Test PK-TAL',
    examHeader: { title: 'FINAL TEST', year: 2026 },
    incident: { type: 'aircraft-ditching', pob: 5, callsign: 'PK-TAL' },
    lkp: { coord: { lat: -6.879444, lng: 105.261389, dmsLat: '06° 52′ 46″ S' } },
    aeroDrift: {
      windLayers: [
        { altitudeFt: 0, windDirFrom: 45, windSpeedKts: 5 },
        { altitudeFt: 3000, windDirFrom: 55, windSpeedKts: 10 },
        { altitudeFt: 6000, windDirFrom: 65, windSpeedKts: 15 },
      ],
    },
    sea: {
      current: { dirToDeg: 250, speedKts: 0.3 },
      surfaceWindSeries: [
        { obsTime: '18 November 2026 00.00 WIB', windDirFrom: 50, windSpeedKts: 5 },
        { obsTime: '18 November 2026 06.00 WIB', windDirFrom: 69, windSpeedKts: 10 },
      ],
    },
    sru: [
      { callsign: 'HR-3604', enduranceHours: 2, enduranceMinutes: 45, tasSearchKts: 90 },
      { callsign: 'PK-ELS', enduranceHours: 2, enduranceMinutes: 30 },
    ],
    tasksRequested: ['asw', 'wsc-pod', 'asset-allocation'],
    meta: { source: 'pdf', assumptions: [{ field: 'x', reason: 'r' }] },
  };

  it('kasus identik → akurasi 100%, semua MATCH', () => {
    const report = compareGoldenCases(golden, structuredClone(golden));
    expect(report.summary.accuracyPct).toBe(100);
    expect(report.summary.mismatch).toBe(0);
    expect(report.summary.missing).toBe(0);
    expect(report.summary.extra).toBe(0);
    expect(report.rows.every((row) => row.status === 'MATCH')).toBe(true);
  });

  it('meta proses (assumptions) dikecualikan dari skor', () => {
    const actual = structuredClone(golden);
    actual.meta = { source: 'pdf', assumptions: [{ field: 'beda', reason: 'alasan lain' }] };
    const report = compareGoldenCases(golden, actual);
    expect(report.summary.accuracyPct).toBe(100);
    expect(report.rows.some((row) => row.path.startsWith('meta.assumptions'))).toBe(false);
    expect(report.rows.some((row) => row.path === 'meta.source' && row.status === 'MATCH')).toBe(true);
  });

  it('nilai beda → MISMATCH + akurasi turun', () => {
    const actual = structuredClone(golden);
    actual.incident.pob = 7;
    const report = compareGoldenCases(golden, actual);
    expect(report.summary.mismatch).toBe(1);
    expect(report.summary.accuracyPct).toBeLessThan(100);
    const row = report.rows.find((r) => r.path === 'incident.pob');
    expect(row?.status).toBe('MISMATCH');
    expect(row?.expected).toBe('5');
    expect(row?.actual).toBe('7');
  });

  it('angka dalam toleransi → MATCH; di luar → MISMATCH', () => {
    const actual = structuredClone(golden);
    actual.lkp.coord.lat = -6.8794455; // selisih 1.1e-6? → 1.05e-6 (di atas default 1e-6)
    const reportTight = compareGoldenCases(golden, actual);
    const rowTight = reportTight.rows.find((r) => r.path === 'lkp.coord.lat');
    expect(rowTight?.status).toBe('MISMATCH');
    const reportLoose = compareGoldenCases(golden, actual, { numericTolerance: 1e-4 });
    const rowLoose = reportLoose.rows.find((r) => r.path === 'lkp.coord.lat');
    expect(rowLoose?.status).toBe('MATCH');
  });

  it('string dinormalisasi: DMS unicode prime vs ASCII + spasi + kapitalisasi', () => {
    const actual = structuredClone(golden);
    actual.lkp.coord.dmsLat = "06°52'46\" s";
    const report = compareGoldenCases(golden, actual);
    const row = report.rows.find((r) => r.path === 'lkp.coord.dmsLat');
    expect(row?.status).toBe('MATCH');
  });

  it('windLayers dicocokkan per altitudeFt — urutan beda tidak menghukum', () => {
    const actual = structuredClone(golden);
    actual.aeroDrift.windLayers.reverse();
    const report = compareGoldenCases(golden, actual);
    expect(report.summary.accuracyPct).toBe(100);
    const row = report.rows.find((r) => r.path === 'aeroDrift.windLayers[3000].windDirFrom');
    expect(row?.status).toBe('MATCH');
  });

  it('surfaceWindSeries dicocokkan per obsTime (dinormalisasi)', () => {
    const actual = structuredClone(golden);
    actual.sea.surfaceWindSeries.reverse();
    const report = compareGoldenCases(golden, actual);
    const row = report.rows.find((r) => r.path === 'sea.surfaceWindSeries[18november202600.00wib].windSpeedKts');
    expect(row?.status).toBe('MATCH');
    expect(report.summary.accuracyPct).toBe(100);
  });

  it('SRU dicocokkan per callsign; entri hilang → MISSING baris per field', () => {
    const actual = structuredClone(golden);
    actual.sru = actual.sru.slice(0, 1); // PK-ELS hilang
    const report = compareGoldenCases(golden, actual);
    expect(report.rows.some((r) => r.path.startsWith('sru[pk-els]') && r.status === 'MISSING')).toBe(true);
    expect(report.summary.missing).toBeGreaterThan(0);
    expect(report.summary.accuracyPct).toBeLessThan(100);
  });

  it('field hilang di hasil → MISSING; field lebih di hasil → EXTRA (tanpa penalti)', () => {
    const actual = structuredClone(golden);
    delete (actual as { incident?: Record<string, unknown> }).incident.pob;
    (actual as { extraTop?: unknown }).extraTop = 'nilai lebih';
    const report = compareGoldenCases(golden, actual);
    expect(report.rows.some((r) => r.path === 'incident.pob' && r.status === 'MISSING')).toBe(true);
    const extraRow = report.rows.find((r) => r.path === 'extraTop');
    expect(extraRow?.status).toBe('EXTRA');
    // EXTRA tidak menurunkan akurasi (recall dilaporkan terpisah):
    const scored = report.rows.filter((r) => r.status !== 'EXTRA');
    const matched = scored.filter((r) => r.status === 'MATCH').length;
    const expectedPct = Math.round((matched / scored.length) * 1000) / 10;
    expect(report.summary.accuracyPct).toBe(expectedPct);
    expect(report.summary.extra).toBe(1);
  });

  it('tasksRequested dibandingkan sebagai SET (urutan bebas)', () => {
    const actual = structuredClone(golden);
    actual.tasksRequested = ['wsc-pod', 'asset-allocation', 'asw'];
    const report = compareGoldenCases(golden, actual);
    expect(report.rows.find((r) => r.path === 'tasksRequested')?.status).toBe('MATCH');
    const fewer = structuredClone(golden);
    fewer.tasksRequested = ['asw', 'wsc-pod'];
    const reportFewer = compareGoldenCases(golden, fewer);
    expect(reportFewer.rows.find((r) => r.path === 'tasksRequested')?.status).toBe('MISMATCH');
  });

  it('formatGoldenEvalReport: bagian + total + detail masalah', () => {
    const actual = structuredClone(golden);
    actual.incident.pob = 7;
    const report = compareGoldenCases(golden, actual);
    const text = formatGoldenEvalReport(report);
    expect(text).toContain('akurasi per bagian');
    expect(text).toContain('TOTAL:');
    expect(text).toContain('incident.pob');
    expect(text).toContain('MISMATCH');
  });

  it('kasus null/kosong → semua MISSING (akurasi 0%)', () => {
    const report = compareGoldenCases(golden, null);
    expect(report.summary.matched).toBe(0);
    expect(report.summary.accuracyPct).toBe(0);
    expect(report.summary.missing).toBe(report.summary.total);
  });
});
