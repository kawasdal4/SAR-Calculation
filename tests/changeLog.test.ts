/**
 * Test change-log batch AI (Fase 2, keputusan no.9 & 10):
 * - diff field terdaftar (termasuk lembar per-SRU `field@nama`).
 * - planUndo: hanya baris yang nilai saat ini == valueAfter yang bisa di-rollback;
 *   perubahan manual → skippedManual (TIDAK ditimpa).
 * - undoRowsToSetFieldsValues: payload SetFieldsApplied (satu mekanisme apply).
 * - invertRows: batch undo tercatat (before/after dibalik).
 * Jalankan: bun test tests/changeLog.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  buildChangeRows,
  planUndo,
  undoRowsToSetFieldsValues,
  invertRows,
  readChangeRowValue,
  stableStringify,
  CHANGE_LOG_WORKSHEETS,
} from '../src/lib/ai/changeLog';

const BEFORE = {
  asw: { observations: [{ timeObs: '1117.1800', hours: 5.1, windDirFrom: 80, windSpeed: 10 }], aswErr: 15, distressTime: 'A', datumTime: 'B', obsIntervalMode: '6h' },
  datum: { seaCurrentDir: 250, seaCurrentSpeed: 0.5, leewayObjectId: 'raft-canopy-drogue', X: 1, Y: 0.8, useWindCurrent: true },
  lkp: { lat: -1.5, lng: 130.2 },
  ws1: { fs: 1.1, measured: { distanceNm: 3.2 } },
  ws2Sheets: [{ key: 's1', label: 'SRU-A', data: { sruName: 'SRU-A', searchPlatform: 'fixed-wing', searchTas: 150, visibilityIndex: 2, selectedHeight: 1000, isFatigue: 'No' } }],
  assets: [{ name: 'KN-X', type: 'rescue-vessel', transitSpeedKts: 14, searchSpeedKts: 12, enduranceHours: 20 }],
  patternType: 'PS',
  patternTurn: 'right',
  briefing: { opTitle: 'RENOPS A' },
};

const AFTER = {
  ...BEFORE,
  asw: { ...BEFORE.asw, aswErr: 20, datumTime: 'C' },
  datum: { ...BEFORE.datum, seaCurrentSpeed: 0.7 },
  lkp: { lat: -1.7, lng: 130.9 },
  ws1: { fs: 1.1, measured: { distanceNm: 3.2 } },
  ws2Sheets: [{ key: 's1', label: 'SRU-A', data: { sruName: 'SRU-A', searchPlatform: 'fixed-wing', searchTas: 180, visibilityIndex: 2, selectedHeight: 1000, isFatigue: 'Yes' } }],
  assets: [{ name: 'KN-X', type: 'rescue-vessel', transitSpeedKts: 14, searchSpeedKts: 11, enduranceHours: 20 }],
  patternType: 'PS',
  patternTurn: 'right',
  briefing: { opTitle: 'RENOPS B' },
};

describe('buildChangeRows — diff field terdaftar', () => {
  it('hanya field yang berubah; field sama tidak dicatat', () => {
    const rows = buildChangeRows(BEFORE, AFTER, ['asw', 'datum', 'lkp', 'ws1', 'pattern']);
    const keys = rows.map((row) => `${row.worksheet}.${row.field}`);
    expect(keys).toContain('asw.aswErr');
    expect(keys).toContain('asw.datumTime');
    expect(keys).toContain('datum.seaCurrentSpeed');
    expect(keys).toContain('lkp.lat');
    expect(keys).toContain('lkp.lng');
    expect(keys).not.toContain('asw.distressTime');
    expect(keys).not.toContain('datum.seaCurrentDir');
    expect(keys).not.toContain('ws1.fs');
    expect(rows.every((row) => row.valueBefore !== row.valueAfter)).toBe(true);
  });

  it('lembar per-SRU: field berkualifikasi @nama (ws2 & assets)', () => {
    const rows = buildChangeRows(BEFORE, AFTER, ['ws2', 'assets']);
    const keys = rows.map((row) => `${row.worksheet}.${row.field}`);
    expect(keys).toContain('ws2.searchTas@SRU-A');
    expect(keys).toContain('ws2.isFatigue@SRU-A');
    expect(keys).not.toContain('ws2.visibilityIndex@SRU-A');
    expect(keys).toContain('assets.searchSpeedKts@KN-X');
    expect(rows.find((row) => row.field === 'searchTas@SRU-A')?.valueBefore).toBe('150');
    expect(rows.find((row) => row.field === 'searchTas@SRU-A')?.valueAfter).toBe('180');
  });

  it('observasi (json) berubah → satu baris json', () => {
    const modified = { ...AFTER, asw: { ...AFTER.asw, observations: [{ timeObs: '1117.1800', hours: 5.1, windDirFrom: 95, windSpeed: 11 }] } };
    const rows = buildChangeRows(BEFORE, modified, ['asw']);
    expect(rows.some((row) => row.field === 'observations')).toBe(true);
    const row = rows.find((entry) => entry.field === 'observations');
    expect(row?.valueBefore).toContain('"windDirFrom":80');
    expect(row?.valueAfter).toContain('"windDirFrom":95');
  });

  it('form briefing (free string): diff kunci form', () => {
    const rows = buildChangeRows(BEFORE, AFTER, ['briefing']);
    expect(rows).toEqual([{ worksheet: 'briefing', field: 'opTitle', valueBefore: '"RENOPS A"', valueAfter: '"RENOPS B"' }]);
  });

  it('filter worksheets membatasi target diff', () => {
    const rows = buildChangeRows(BEFORE, AFTER, ['asw']);
    expect(rows.every((row) => row.worksheet === 'asw')).toBe(true);
  });

  it('cap 200 baris per batch', () => {
    const bigBefore = { briefing: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, `v${i}`])) };
    const bigAfter = { briefing: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`f${i}`, `w${i}`])) };
    const rows = buildChangeRows(bigBefore, bigAfter);
    expect(rows.length).toBe(200);
  });
});

describe('readChangeRowValue & planUndo — guard perubahan manual', () => {
  const rows = buildChangeRows(BEFORE, AFTER, ['asw', 'datum', 'ws2']);

  it('nilai saat ini == valueAfter → undoable', () => {
    const plan = planUndo(rows, AFTER);
    expect(plan.undoable.length).toBeGreaterThan(0);
    expect(plan.skippedManual.length).toBe(0);
    expect(plan.ok).toBe(true);
  });

  it('field yang sudah diubah MANUAL setelah batch → skippedManual (tidak ditimpa)', () => {
    const manualState = {
      ...AFTER,
      datum: { ...AFTER.datum, seaCurrentSpeed: 0.9 }, // manual edit setelah batch
    };
    const plan = planUndo(rows, manualState);
    expect(plan.skippedManual.length).toBe(1);
    expect(plan.skippedManual[0].field).toBe('seaCurrentSpeed');
    expect(plan.skippedManual[0].currentValue).toBe('0.9');
    // sisanya tetap bisa di-undo
    expect(plan.undoable.some((row) => row.field === 'aswErr')).toBe(true);
  });

  it('state kosong → semua skippedManual (tidak ada yang ditimpa diam-diam)', () => {
    const plan = planUndo(rows, {});
    expect(plan.undoable.length).toBe(0);
    expect(plan.skippedManual.length).toBe(rows.length);
  });
});

describe('undoRowsToSetFieldsValues — payload satu mekanisme apply', () => {
  it('angka/string/json dipetakan sesuai tipe registry; sruName dari kualifikasi', () => {
    const rows = buildChangeRows(BEFORE, AFTER, ['asw', 'ws2', 'datum']);
    const plan = planUndo(rows, AFTER);
    const batches = undoRowsToSetFieldsValues(plan.undoable);
    const asw = batches.find((batch) => batch.worksheet === 'asw');
    expect(asw?.values['aswErr']).toBe(15);
    expect(asw?.values['datumTime']).toBe('B');
    const ws2 = batches.find((batch) => batch.worksheet === 'ws2');
    expect(ws2?.sruName).toBe('SRU-A');
    expect(ws2?.values['searchTas']).toBe(150);
    expect(ws2?.values['isFatigue']).toBe('No');
    // Field json: nilai sebelum di-parse kembali menjadi objek/array asli.
    const jsonRows = buildChangeRows(
      { asw: { observations: [{ timeObs: 'x', hours: 1, windDirFrom: 80, windSpeed: 10 }] } },
      { asw: { observations: [{ timeObs: 'x', hours: 1, windDirFrom: 90, windSpeed: 10 }] } },
      ['asw'],
    );
    const jsonPlan = planUndo(jsonRows, { asw: { observations: [{ timeObs: 'x', hours: 1, windDirFrom: 90, windSpeed: 10 }] } });
    const jsonBatches = undoRowsToSetFieldsValues(jsonPlan.undoable);
    expect(Array.isArray(jsonBatches[0]?.values['observations'])).toBe(true);
    expect((jsonBatches[0]?.values['observations'] as Array<{ windDirFrom: number }>)[0].windDirFrom).toBe(80);
  });

  it('baris valueBefore null dilewati (pengosongan bukan bagian undo v1)', () => {
    const batches = undoRowsToSetFieldsValues([
      { worksheet: 'datum', field: 'seaCurrentErr', valueBefore: null, valueAfter: '0.1' },
      { worksheet: 'datum', field: 'seaCurrentErr2', valueBefore: null, valueAfter: 'x' },
    ]);
    expect(batches.length).toBe(0);
  });

  it('field tak terdaftar → tidak masuk payload', () => {
    const batches = undoRowsToSetFieldsValues([
      { worksheet: 'datum', field: 'fieldKarangan', valueBefore: '"x"', valueAfter: '"y"' },
    ]);
    expect(batches.length).toBe(0);
  });
});

describe('invertRows & util kecil', () => {
  it('before/after dibalik untuk batch undo', () => {
    const inverted = invertRows([{ worksheet: 'datum', field: 'seaCurrentSpeed', valueBefore: '0.5', valueAfter: '0.7' }]);
    expect(inverted[0].valueBefore).toBe('0.7');
    expect(inverted[0].valueAfter).toBe('0.5');
  });

  it('CHANGE_LOG_WORKSHEETS = registry set_fields + ws1', () => {
    expect(CHANGE_LOG_WORKSHEETS).toContain('asw');
    expect(CHANGE_LOG_WORKSHEETS).toContain('ws1');
    expect(CHANGE_LOG_WORKSHEETS.length).toBe(15);
  });

  it('stableStringify: kunci terurut + undefined → null', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify(undefined)).toBeNull();
    expect(stableStringify({ x: undefined })).toBe('{"x":null}');
  });

  it('readChangeRowValue membaca field lembar & ws1.measured', () => {
    expect(readChangeRowValue(AFTER, { worksheet: 'ws2', field: 'searchTas@SRU-A' })).toBe(180);
    expect(readChangeRowValue(AFTER, { worksheet: 'ws1', field: 'measured.distanceNm' })).toBe(3.2);
    expect(readChangeRowValue(AFTER, { worksheet: 'lkp', field: 'lat' })).toBe(-1.7);
  });
});
