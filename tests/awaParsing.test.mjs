/**
 * Regresi worksheet AWA kosong (laporan pengguna: baris angin terisi tapi
 * seluruh kolom hasil "—"). Penyebab: AI mengirim altObs "Surface" (bukan
 * angka) dan/atau distressAltFt sebagai string — Number("Surface") → NaN
 * membuat computeAWA menolak SELURUH perhitungan. parseAltitudeFt kini
 * menoleransi bentuk tersebut.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeAWA, parseAltitudeFt } from '../src/lib/sar/sarCalculations.ts';

const OBS_SURFACE_TEXT = [
  { altObs: 'Surface', windDirFrom: 155, windSpeed: 12 },
  { altObs: '3000', windDirFrom: 130, windSpeed: 15 },
  { altObs: '6000', windDirFrom: 165, windSpeed: 12 },
  { altObs: '9000', windDirFrom: 155, windSpeed: 16 },
  { altObs: '12000', windDirFrom: 150, windSpeed: 20 },
  { altObs: '18000', windDirFrom: 145, windSpeed: 26 },
  { altObs: '24000', windDirFrom: 190, windSpeed: 23 },
];

test('parseAltitudeFt: bentuk teks dari soal/AI dikenali', () => {
  assert.equal(parseAltitudeFt('Surface'), 0);
  assert.equal(parseAltitudeFt('surface laut'), 0);
  assert.equal(parseAltitudeFt('0'), 0);
  assert.equal(parseAltitudeFt(5000), 5000);
  assert.equal(parseAltitudeFt('3000'), 3000);
  assert.equal(parseAltitudeFt('3.000 ft'), 3000);
  assert.equal(parseAltitudeFt('3,000 feet'), 3000);
  assert.equal(parseAltitudeFt('FL090'), 9000);
  assert.ok(Number.isNaN(parseAltitudeFt('')));
  assert.ok(Number.isNaN(parseAltitudeFt('abc')));
  assert.ok(Number.isNaN(parseAltitudeFt(undefined)));
});

test('computeAWA: altObs "Surface" tidak lagi mengosongkan seluruh hasil', () => {
  const result = computeAWA(OBS_SURFACE_TEXT, 10000);
  assert.deepEqual(result.errors, []);
  assert.equal(result.isValid, true);
  assert.equal(result.rows.length, 7);
  // Total altitude loss = target (10.000 ft) dalam ribuan feet.
  assert.equal(result.totalAltLossKft, 10);
  assert.equal(result.directionDefined, true);
  assert.ok(result.awaSpeed > 0);
});

test('computeAWA: distressAltFt string "10000" setara angka 10000', () => {
  const asString = computeAWA(OBS_SURFACE_TEXT, '10000');
  const asNumber = computeAWA(OBS_SURFACE_TEXT, 10000);
  assert.equal(asString.isValid, true);
  assert.equal(asString.awaDirFrom, asNumber.awaDirFrom);
  assert.equal(asString.awaSpeed, asNumber.awaSpeed);
});

test('computeAWA: target 0 tetap ditolak (guard regresi)', () => {
  const result = computeAWA(OBS_SURFACE_TEXT, 0);
  assert.equal(result.isValid, false);
  assert.deepEqual(result.rows, []);
  assert.ok(result.errors.some((e) => e.includes('target')));
});

test('computeAWA: level tertinggi di bawah target tetap terdeteksi', () => {
  const result = computeAWA(OBS_SURFACE_TEXT.slice(0, 4), 20000);
  assert.equal(result.isValid, false);
  assert.ok(result.errors.some((e) => e.includes('belum mencapai target')));
});
