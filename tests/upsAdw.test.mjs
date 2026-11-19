/**
 * Test Panduan ADW ke UPS Digital — nilai uji Contoh 1 (PD-AES, B777):
 *   Datum X 0°22'S – 98°15'W; dg 161°T / 25,74 NM (B8/B9);
 *   dd 096°T / 1,260 NM (B11); da (B12) = 158,5°T / 26,3 NM;
 *   posisi akhir (B14) = 0°46'28"S, 98°05'22"W;
 *   skala terpilih 12' dengan pusat rose di 0°34'S – 98°15'W.
 * Jalankan: node --test tests/upsAdw.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPS_SHEET_WR,
  UPS_SHEET_HR,
  UPS_MARGIN_R,
  UPS_SCALE_OPTIONS,
  normalizeDeg,
  sumPlanarVectors,
  computeAdwChain,
  selectUpsScale,
  withGridAnchors,
  buildAdwUpsPlot,
  scaleTickInfo,
} from '../src/lib/sar/upsAdw.mjs';

const D = Math.PI / 180;

// Contoh 1 panduan
const datumLat = -(22 / 60); // 0°22'S
const datumLng = -(98 + 15 / 60); // 98°15'W
const dgDir = 161;
const dgNm = 25.74;
const ddDir = 96;
const ddNm = 1.26;

function formatLatDms(deg) {
  const hemi = deg >= 0 ? 'N' : 'S';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minFull = (abs - d) * 60;
  const m = Math.floor(minFull);
  const s = Math.round((minFull - m) * 60);
  return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"${hemi}`;
}

function formatLngDms(deg) {
  const hemi = deg >= 0 ? 'E' : 'W';
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minFull = (abs - d) * 60;
  const m = Math.floor(minFull);
  const s = Math.round((minFull - m) * 60);
  return `${d}°${String(m).padStart(2, '0')}'${String(s).padStart(2, '0')}"${hemi}`;
}

test('parameter kanvas sesuai panduan bagian 5', () => {
  assert.equal(UPS_SHEET_WR, 4.7);
  assert.equal(UPS_SHEET_HR, 3.4);
  assert.equal(UPS_MARGIN_R, 0.2);
  assert.deepEqual(UPS_SCALE_OPTIONS, [3, 6, 12, 18, 30, 60]);
});

test('rantai ADW Contoh 1: da (B12) = 158,5°T / 26,3 NM', () => {
  const chain = computeAdwChain({ datumLat, datumLng, dgDir, dgNm, ddDir, ddNm });
  assert.equal(chain.daNm.toFixed(1), '26.3');
  assert.equal(chain.daDir.toFixed(1), '158.5');
  // N, E panduan: −24,47 NM / +9,63 NM
  assert.equal(chain.northNm.toFixed(2), '-24.47');
  assert.equal(chain.eastNm.toFixed(2), '9.63');
});

test('posisi akhir glide (B14) = 0°46\'28"S, 98°05\'22"W', () => {
  const chain = computeAdwChain({ datumLat, datumLng, dgDir, dgNm, ddDir, ddNm });
  assert.equal(formatLatDms(chain.endLat), "0°46'28\"S");
  assert.equal(formatLngDms(chain.endLng), "98°05'22\"W");
  // φm antara datum dan akhir
  assert.ok(chain.midLat < datumLat && chain.midLat > chain.endLat);
});

test('pemilihan skala Contoh 1 → 12\' dengan pusat rose 0°34\'S – 98°15\'W', () => {
  const chain = computeAdwChain({ datumLat, datumLng, dgDir, dgNm, ddDir, ddNm });
  const points = [
    { xNm: 0, yNm: 0 },
    { xNm: dgNm * Math.sin(dgDir * D), yNm: dgNm * Math.cos(dgDir * D) },
    { xNm: chain.eastNm, yNm: chain.northNm },
  ];
  const scale = withGridAnchors(selectUpsScale({ points, midLat: chain.midLat }), { datumLat, datumLng });
  assert.equal(scale.fits, true);
  assert.equal(scale.scaleMin, 12);
  assert.equal(scale.i, 0);
  assert.equal(scale.j, -1);
  assert.equal(scale.roseCenterNm.yNm, -12);
  // Tabel panduan: simpang maks x 9,6 ≤ 25,8; y 12,5 ≤ 18,0
  assert.equal(scale.maxDevXNm.toFixed(1), '9.6');
  assert.equal(scale.maxDevYNm.toFixed(1), '12.5');
  assert.equal(scale.xLimitNm.toFixed(1), '25.8');
  assert.equal(scale.yLimitNm.toFixed(1), '18.0');
  // φC = φdatum + j·S′ dan λC = λdatum + i·S′
  assert.equal(formatLatDms(scale.latCenterDeg), "0°34'00\"S");
  assert.equal(formatLngDms(scale.lngCenterDeg), "98°15'00\"W");
});

test('tabel pemeriksaan skala panduan: 3\' dan 6\' keluar lembar', () => {
  const chain = computeAdwChain({ datumLat, datumLng, dgDir, dgNm, ddDir, ddNm });
  const points = [
    { xNm: 0, yNm: 0 },
    { xNm: dgNm * Math.sin(dgDir * D), yNm: dgNm * Math.cos(dgDir * D) },
    { xNm: chain.eastNm, yNm: chain.northNm },
  ];
  const s3 = selectUpsScale({ points, midLat: chain.midLat, scales: [3] });
  assert.equal(s3.fits, false);
  assert.equal(s3.maxDevYNm.toFixed(1), '12.5'); // > batas 4,5
  const s6 = selectUpsScale({ points, midLat: chain.midLat, scales: [6] });
  assert.equal(s6.fits, false);
  assert.equal(s6.maxDevYNm.toFixed(1), '12.5'); // > batas 9,0
  assert.equal(s6.maxDevXNm.toFixed(1), '6.0'); // ≤ 12,9 → x aman, y gagal
});

test('skala lebih besar juga memuat (18\', 30\', 60\')', () => {
  const chain = computeAdwChain({ datumLat, datumLng, dgDir, dgNm, ddDir, ddNm });
  const points = [
    { xNm: 0, yNm: 0 },
    { xNm: dgNm * Math.sin(dgDir * D), yNm: dgNm * Math.cos(dgDir * D) },
    { xNm: chain.eastNm, yNm: chain.northNm },
  ];
  for (const S of [18, 30, 60]) {
    const r = selectUpsScale({ points, midLat: chain.midLat, scales: [S] });
    assert.equal(r.fits, true, `skala ${S}' harus lolos`);
  }
  const r18 = selectUpsScale({ points, midLat: chain.midLat, scales: [18] });
  assert.equal(r18.yLimitNm.toFixed(1), '27.0');
  assert.equal(r18.xLimitNm.toFixed(1), '38.7');
});

test('buildAdwUpsPlot Contoh 1: segmen dg/dd/da dan skala 12\'', () => {
  const plot = buildAdwUpsPlot({
    datumLat,
    datumLng,
    dg: { dir: dgDir, nm: dgNm },
    dd: { dir: ddDir, nm: ddNm },
  });
  assert.equal(plot.ready, true);
  assert.deepEqual(plot.segments.map((s) => s.id), ['dg', 'dd']);
  assert.equal(plot.daInfo.nm.toFixed(1), '26.3');
  assert.equal(plot.daInfo.dir.toFixed(1), '158.5');
  assert.equal(formatLatDms(plot.daInfo.endLat), "0°46'28\"S");
  assert.equal(formatLngDms(plot.daInfo.endLng), "98°05'22\"W");
  assert.equal(plot.scale.scaleMin, 12);
  assert.equal(plot.scale.fits, true);
  // Semua titik di dalam lembar: |x−xC| ≤ (4.7/2−0.2)·S, |y−yC| ≤ (3.4/2−0.2)·S
  for (const p of plot.points) {
    assert.ok(Math.abs(p.xNm - plot.scale.roseCenterNm.xNm) <= plot.scale.xLimitNm + 1e-9);
    assert.ok(Math.abs(p.yNm - plot.scale.roseCenterNm.yNm) <= plot.scale.yLimitNm + 1e-9);
  }
});

test('ujung dd dan ujung da berimpit (posisi akhir glide)', () => {
  const plot = buildAdwUpsPlot({
    datumLat,
    datumLng,
    dg: { dir: dgDir, nm: dgNm },
    dd: { dir: ddDir, nm: ddNm },
  });
  const ddSeg = plot.segments.find((s) => s.id === 'dd');
  assert.ok(ddSeg);
  const chain = computeAdwChain({ datumLat, datumLng, dgDir, dgNm, ddDir, ddNm });
  assert.ok(Math.abs(ddSeg.toNm.xNm - chain.eastNm) < 1e-9);
  assert.ok(Math.abs(ddSeg.toNm.yNm - chain.northNm) < 1e-9);
});

test('rantai parasut dilanjutkan dari ujung pesawat dan ikut dicek skala', () => {
  const plot = buildAdwUpsPlot({
    datumLat,
    datumLng,
    dg: { dir: dgDir, nm: dgNm },
    dd: { dir: ddDir, nm: ddNm },
    pg: { dir: 150, nm: 1.5 },
    pw: { dir: 96, nm: 0.8 },
  });
  assert.deepEqual(plot.segments.map((s) => s.id), ['dg', 'dd', 'pg', 'pw']);
  const pg = plot.segments.find((s) => s.id === 'pg');
  const dd = plot.segments.find((s) => s.id === 'dd');
  // pg mulai dari ujung dd
  assert.ok(Math.abs(pg.fromNm.xNm - dd.toNm.xNm) < 1e-9);
  assert.ok(Math.abs(pg.fromNm.yNm - dd.toNm.yNm) < 1e-9);
  // skala harus mengakomodasi titik parasut juga
  for (const p of plot.points) {
    assert.ok(Math.abs(p.xNm - plot.scale.roseCenterNm.xNm) <= plot.scale.xLimitNm + 1e-9);
    assert.ok(Math.abs(p.yNm - plot.scale.roseCenterNm.yNm) <= plot.scale.yLimitNm + 1e-9);
  }
});

test('tanpa vektor → tidak siap digambar', () => {
  const plot = buildAdwUpsPlot({ datumLat, datumLng });
  assert.equal(plot.ready, false);
  assert.ok(plot.reason);
});

test('vektor nol tidak digambar', () => {
  const plot = buildAdwUpsPlot({
    datumLat,
    datumLng,
    dg: { dir: dgDir, nm: 0 },
    dd: { dir: ddDir, nm: ddNm },
  });
  assert.deepEqual(plot.segments.map((s) => s.id), ['dd']);
});

test('sumPlanarVectors dan normalizeDeg', () => {
  assert.equal(normalizeDeg(-200), 160);
  assert.equal(normalizeDeg(720 + 30), 30);
  const r = sumPlanarVectors({ dir: 0, nm: 10 }, { dir: 90, nm: 10 });
  assert.equal(r.northNm.toFixed(2), '10.00');
  assert.equal(r.eastNm.toFixed(2), '10.00');
  assert.equal(r.nm.toFixed(2), '14.14');
  assert.equal(r.dir.toFixed(1), '45.0');
});

test('tabel nilai skala panduan bagian 6', () => {
  assert.deepEqual(scaleTickInfo(60), { majorMin: 10, minorSec: 60 });
  assert.deepEqual(scaleTickInfo(30), { majorMin: 5, minorSec: 30 });
  assert.deepEqual(scaleTickInfo(18), { majorMin: 3, minorSec: 18 });
  assert.deepEqual(scaleTickInfo(12), { majorMin: 2, minorSec: 12 });
  assert.deepEqual(scaleTickInfo(6), { majorMin: 1, minorSec: 6 });
  assert.deepEqual(scaleTickInfo(3), { majorMin: 0.5, minorSec: 3 });
});
