// Pengujian landSearchRadius.mjs terhadap vektor uji Panduan Penghitungan
// Search Radius — Land Search (bagian 4 "Contoh uji" dan bagian 5 trapesium).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAND_FS_OPTIONS,
  LAND_X0_NM,
  LAND_SRU_NAV_OPTIONS,
  ceilRadiusNm,
  computePointRadius,
  computeLegTrapezoid,
  possibilityCircleAreaSqNm,
} from '../src/lib/sar/landSearchRadius.mjs';

// Semua latihan memakai GPS (x₀ = 5, y = 0,1) dan pencarian pertama (fs = 1,1).
const GPS = LAND_X0_NM.gps;
const Y_GPS = 0.1;
const FS1 = 1.1;

// Vektor uji panduan: [nama, Tr, x, R bulat yang diharapkan]
const cases = [
  ['Latihan 1 · A (Elelim)', 0, 5.0, 6],
  ['Latihan 1 · B (Tinggipura)', 62.8, 11.28, 13],
  ['Latihan 2 · A (LKP 20 NM dari Palu)', 20, 7.0, 8],
  ['Latihan 2 · B (Tentena)', 91, 14.10, 16],
  ['Latihan 3 · A (Wamena)', 0, 5.0, 6],
  ['Latihan 3 · B', 33, 8.30, 10],
  ['Latihan 3 · C', 58, 10.80, 12],
];

for (const [name, tr, expectedX, expectedR] of cases) {
  test(`radius ${name}: x = ${expectedX}, R bulat = ${expectedR}`, () => {
    const result = computePointRadius({ trNm: tr, x0Nm: GPS, yNm: Y_GPS, fs: FS1 });
    assert.equal(result.xNm, expectedX);
    // e mendekati nilai panduan (panduan mencetak 4 desimal)
    const expectedE = Math.sqrt(expectedX * expectedX + Y_GPS * Y_GPS);
    assert.ok(Math.abs(result.eNm - expectedE) < 5e-4, `e=${result.eNm} vs ${expectedE}`);
    // R = e × fs tepat, lalu dibulatkan ke atas
    assert.ok(Math.abs(result.rNm - expectedE * FS1) < 5e-4);
    assert.equal(result.rRoundedNm, expectedR);
  });
}

test('fs pencarian ke-1..5 sesuai daftar panduan', () => {
  assert.deepEqual(LAND_FS_OPTIONS, [1.1, 1.8, 2.0, 2.3, 2.6]);
});

test('pembulatan ke atas tahan artefak floating point', () => {
  // Panduan: hindari artefak floating point, mis. 10,0000001 tidak boleh menjadi 11.
  assert.equal(ceilRadiusNm(10.000000000000002), 10);
  assert.equal(ceilRadiusNm(10.0000001), 10);
  assert.equal(ceilRadiusNm(11), 11);
  assert.equal(ceilRadiusNm(12.000000000000004), 12);
  // Nilai pecahan sungguhan tetap dibulatkan ke atas.
  assert.equal(ceilRadiusNm(10.5), 11);
  assert.equal(ceilRadiusNm(5.5011), 6);
});

test('trapesium radius sama: a = b = 2R (garis singgung sejajar rute)', () => {
  const result = computeLegTrapezoid(50, 5, 5);
  assert.equal(result.valid, true);
  assert.equal(result.degenerate, false);
  assert.equal(result.aNm, 10);
  assert.equal(result.bNm, 10);
  assert.equal(result.hNm, 60);
  assert.equal(result.areaSqNm, 600); // (10+10)*60/2
});

test('trapesium Latihan 1 (R_A=6, R_B=13, d=62,8 NM) — geometri tangent eksak', () => {
  const d = 62.8;
  const rA = 6;
  const rB = 13;
  const result = computeLegTrapezoid(d, rA, rB);
  const delta = rB - rA;
  const root = Math.sqrt(d * d - delta * delta);
  const expectedWA = (rA * d) / root - ((delta / root) * rA);
  const expectedWB = (delta / root) * (d + rB) + (rA * d) / root;
  assert.ok(Math.abs(result.wANm - expectedWA) < 1e-3);
  assert.ok(Math.abs(result.wBNm - expectedWB) < 1e-3);
  // lingkaran A tetap berada di dalam trapesium: setengah-lebar di A menutupi rA
  assert.ok(result.wANm > 0 && result.wBNm > rB);
  assert.equal(result.hNm, d + rA + rB); // 81.8 NM
  assert.ok(Math.abs(result.areaSqNm - ((2 * result.wANm + 2 * result.wBNm) * result.hNm) / 2) < 0.02);
});

test('trapesium simetris saat radius A dan B dipertukarkan', () => {
  const ab = computeLegTrapezoid(62.8, 6, 13);
  const ba = computeLegTrapezoid(62.8, 13, 6);
  assert.ok(Math.abs(ab.wANm - ba.wBNm) < 1e-3);
  assert.ok(Math.abs(ab.wBNm - ba.wANm) < 1e-3);
  assert.ok(Math.abs(ab.areaSqNm - ba.areaSqNm) < 0.02);
});

test('kasus degenerate d ≤ |Δ| memakai lebar seragam', () => {
  const result = computeLegTrapezoid(3, 2, 10);
  assert.equal(result.degenerate, true);
  assert.equal(result.aNm, 20);
  assert.equal(result.bNm, 20);
  assert.equal(result.hNm, 15);
});

test('input tidak valid menghasilkan trapesium tidak valid', () => {
  assert.equal(computeLegTrapezoid(0, 5, 5).valid, false);
  assert.equal(computeLegTrapezoid(50, 0, 5).valid, false);
  assert.equal(computeLegTrapezoid(-1, 5, 5).valid, false);
});

test('luas possibility area satu titik = lingkaran πR²', () => {
  assert.equal(possibilityCircleAreaSqNm(6), 113.1); // π·36
  assert.equal(possibilityCircleAreaSqNm(0), 0);
});

test('opsi y Tabel J-1 (subset app) memuat nilai yang benar', () => {
  const byId = Object.fromEntries(LAND_SRU_NAV_OPTIONS.map((option) => [option.id, option.value]));
  assert.equal(byId.gps, 0.1);
  assert.equal(byId.radar, 1);
  assert.equal(byId.visual, 1);
  assert.equal(byId.celestial, 2);
  assert.equal(byId['marine-radio-beacon'], 4);
  assert.equal(byId['loran-c'], 1);
  // INS, VOR, TACAN tidak dipakai di app
  assert.ok(!('ins' in byId) && !('vor' in byId) && !('tacan' in byId));
});
