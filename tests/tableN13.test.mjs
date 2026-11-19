/**
 * Test Table N-13 & N-14 (IAMSAR Vol II 2022, Appendix N, hal. N-20).
 * Jalankan: npm run test:n13
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  N13_PARACHUTES,
  getN13Parachute,
  n13RateOfDescent,
  n14DriftDistanceMiles,
  N14_DRIFT_DISTANCE_MILES,
  TABLE_N13_SOURCE,
} from '../src/lib/sar/tableN13.mjs';

test('Table N-13 memuat 13 jenis parasut sesuai IAMSAR Vol II N-20', () => {
  assert.equal(N13_PARACHUTES.length, 13);
  assert.match(TABLE_N13_SOURCE, /IAMSAR/);
});

test('Nilai kunci Table N-13 sesuai tabel cetak', () => {
  const c9 = getN13Parachute('c9-escape');
  assert.equal(c9.rodSeaLevelFtMin, 1176);
  assert.equal(c9.rod7000FtMin, 1284);
  assert.equal(c9.glideRatio, 0);

  const c9r = getN13Parachute('c9-4slr');
  assert.equal(c9r.rodSeaLevelFtMin, 1146);
  assert.equal(c9r.rod7000FtMin, 1260);
  assert.equal(c9r.glideRatio, 0.4);

  const t10 = getN13Parachute('t10-army');
  assert.equal(t10.rodSeaLevelFtMin, 918);
  assert.equal(t10.rod7000FtMin, 1008);
  assert.equal(t10.glideRatio, 0);

  const halo = getN13Parachute('halo-35');
  assert.equal(halo.rodSeaLevelFtMin, 960);
  assert.equal(halo.rod7000FtMin, 1038);
  assert.equal(halo.glideRatio, 0.35);

  const pc = getN13Parachute('paracommander');
  assert.equal(pc.rodSeaLevelFtMin, 1080);
  assert.equal(pc.rod7000FtMin, 482);
  assert.equal(pc.glideRatio, 1.16);

  const mb = getN13Parachute('martin-baker');
  assert.equal(mb.rodSeaLevelFtMin, 1440);
  assert.equal(mb.rod7000FtMin, null); // kolom 7.000 ft kosong di tabel

  const ap2 = getN13Parachute('apollo-2');
  assert.equal(ap2.rodSeaLevelFtMin, 2100);
  assert.equal(ap2.rod7000FtMin, 2232);
  assert.equal(ap2.glideRatio, 0);
});

test('Baris eksperimental: ROD berupa rentang 600-900, glide ratio 2.7-3.0', () => {
  for (const id of ['parawing', 'parafoil', 'parasail']) {
    const row = getN13Parachute(id);
    assert.ok(row.experimental, id);
    assert.deepEqual(row.rodRangeFtMin, [600, 900]);
    assert.ok(row.glideRatio >= 2.7 && row.glideRatio <= 3.0, id);
  }
});

test('n13RateOfDescent memilih kolom tanpa interpolasi (<=3500 ft → sea level)', () => {
  const sel0 = n13RateOfDescent('c9-escape', 0);
  assert.equal(sel0.rodFtMin, 1176);
  assert.equal(sel0.column, 'sea-level');
  const sel3500 = n13RateOfDescent('c9-escape', 3500);
  assert.equal(sel3500.rodFtMin, 1176);
  const sel3501 = n13RateOfDescent('c9-escape', 3501);
  assert.equal(sel3501.rodFtMin, 1284);
  assert.equal(sel3501.column, '7000ft');
  const sel7000 = n13RateOfDescent('t10-army', 7000);
  assert.equal(sel7000.rodFtMin, 1008);
});

test('n13RateOfDescent: kolom 7000 ft kosong (Martin-Baker) → kembali ke sea level', () => {
  const sel = n13RateOfDescent('martin-baker', 10000);
  assert.equal(sel.rodFtMin, 1440);
  assert.equal(sel.column, 'sea-level');
});

test('n13RateOfDescent: baris eksperimental selalu minta nilai planner (null)', () => {
  const sel = n13RateOfDescent('parafoil', 5000);
  assert.equal(sel.rodFtMin, null);
  assert.equal(sel.column, 'range');
});

test('n13RateOfDescent: id tidak dikenal → null', () => {
  const sel = n13RateOfDescent('tidak-ada', 5000);
  assert.equal(sel.rodFtMin, null);
  assert.equal(sel.row, null);
  assert.equal(getN13Parachute(''), null);
  assert.equal(getN13Parachute(undefined), null);
});

test('Table N-14: nilai kunci drift distance (statute miles)', () => {
  assert.equal(N14_DRIFT_DISTANCE_MILES[30000][6], 25.8); // wind 70 kt
  assert.equal(N14_DRIFT_DISTANCE_MILES[20000][0], 2.7); // wind 10 kt
  assert.equal(N14_DRIFT_DISTANCE_MILES[2000][6], 2.1);
});

test('n14DriftDistanceMiles memilih baris & kolom terdekat tanpa interpolasi', () => {
  const r = n14DriftDistanceMiles(21000, 25);
  assert.equal(r.altRowFt, 20000);
  assert.equal(r.windColKt, 20);
  assert.equal(r.miles, 5.3);
  const r2 = n14DriftDistanceMiles(20000, 20);
  assert.equal(r2.miles, 5.3);
  const bad = n14DriftDistanceMiles(NaN, 20);
  assert.equal(bad.miles, null);
});
