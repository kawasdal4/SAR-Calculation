/**
 * Regresi jaring pengaman rantai worksheet (caseChain).
 * Latar: model cadangan kadang menjawab TANPA teks (daftar "WORKSHEET YANG
 * HARUS DIPAKAI" tidak ada) dan hanya memanggil save_case_data_bank /
 * ask_for_case_data — parseDeclaredWorksheetTools kosong, jadi jaring
 * pengaman parsial perlu di-seed lewat matchWorksheetToolNames dari argumen
 * ask_for_case_data (worksheet: "WS 2", "worksheet ASW", "Datum", dst.).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMissingWorksheetTools,
  matchWorksheetToolNames,
  parseDeclaredWorksheetTools,
} from '../src/lib/sar/caseChain.ts';

test('matchWorksheetToolNames: argumen ask_for_case_data dipetakan ke tool', () => {
  assert.deepEqual(matchWorksheetToolNames('WS 2'), ['set_ws2_case']);
  assert.deepEqual(matchWorksheetToolNames('worksheet ASW'), ['set_asw_case']);
  assert.deepEqual(matchWorksheetToolNames('Datum / Worksheet 1'), ['set_datum_case']);
  assert.deepEqual(
    matchWorksheetToolNames('ASW dan Worksheet 2'),
    ['set_asw_case', 'set_ws2_case'],
  );
});

test('matchWorksheetToolNames: teks kosong/tidak relevan → kosong', () => {
  assert.deepEqual(matchWorksheetToolNames(''), []);
  assert.deepEqual(matchWorksheetToolNames('Intercept Calculator'), ['set_intercept_case']);
  assert.deepEqual(matchWorksheetToolNames('perencanaan pencarian udara'), []);
});

test('parseDeclaredWorksheetTools: jawaban tanpa teks → kosong (kasus model cadangan)', () => {
  assert.deepEqual(parseDeclaredWorksheetTools(''), []);
  assert.deepEqual(parseDeclaredWorksheetTools('Analisis selesai.'), []);
});

test('parseDeclaredWorksheetTools: daftar bernomor dipetakan urut rantai', () => {
  const answer = [
    'WORKSHEET YANG HARUS DIPAKAI',
    '1. Worksheet AWA — untuk angin atas kasus penerbangan',
    '   - data: tabel angin atas tersedia',
    '2. Worksheet ADW — drift pesawat',
    '3. Datum / Worksheet 1 — hitung datum dan search area',
    '',
    'Ringkasan data terlampir.',
  ].join('\n');
  assert.deepEqual(parseDeclaredWorksheetTools(answer), [
    'set_awa_case',
    'set_aero_drift_case',
    'set_datum_case',
  ]);
});

test('computeMissingWorksheetTools: hanya tool yang dinyatakan dan belum dipanggil', () => {
  assert.deepEqual(
    computeMissingWorksheetTools(['set_awa_case', 'set_datum_case'], ['set_awa_case']),
    ['set_datum_case'],
  );
  assert.deepEqual(computeMissingWorksheetTools(['set_ws2_case'], []), ['set_ws2_case']);
  assert.deepEqual(computeMissingWorksheetTools([], ['set_asw_case']), []);
});
