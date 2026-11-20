// Verifikasi konversi lat/lon ↔ UTM peta darat WS4 (proj4js) dengan:
//   1) Titik referensi terdokumentasi — CN Tower (Wikipedia "Universal
//      Transverse Mercator coordinate system": 43°38'33.24"N 79°23'13.7"W →
//      Zone 17N, 630084 m E, 4833438 m N).
//   2) Implementasi INDEPENDEN rumus UTM USGS Snyder (1982, Professional
//      Paper 1395) ditulis ulang di file ini — dibandingkan dengan proj4js.
//   3) Round-trip forward/inverse.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const requireRef = createRequire(import.meta.url);
const proj4lib = requireRef('proj4');
const proj4shim = Object.assign((...args) => proj4lib(...args), proj4lib, { default: proj4lib });

function compileTs(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  runInNewContext(compiled, { module, exports: module.exports, require: (name) => name === 'proj4' ? proj4shim : requireRef(name) });
  return module.exports;
}

const proj = compileTs('../src/lib/sar/landMapProj.ts');

// ---------------------------------------------------------------------------
// Implementasi independen: rumus Transverse Mercator USGS Snyder (1982) —
// seri klasik UTM (akurasi ~cm di dekat bujur tengah zona), publik.
// ---------------------------------------------------------------------------
function snyderUtmForward(latDeg, lonDeg, zone, south) {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);
  const k0 = 0.9996;
  const rad = Math.PI / 180;
  const phi = latDeg * rad;
  const lam = lonDeg * rad;
  const lam0 = ((zone - 1) * 6 - 180 + 3) * rad;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = ep2 * cosPhi * cosPhi;
  const A = (lam - lam0) * cosPhi;
  const M = a * ((1 - e2 / 4 - (3 * Math.pow(e2, 2)) / 64 - (5 * Math.pow(e2, 3)) / 256) * phi
    - ((3 * e2) / 8 + (3 * Math.pow(e2, 2)) / 32 + (45 * Math.pow(e2, 3)) / 1024) * Math.sin(2 * phi)
    + ((15 * Math.pow(e2, 2)) / 256 + (45 * Math.pow(e2, 3)) / 1024) * Math.sin(4 * phi)
    - ((35 * Math.pow(e2, 3)) / 3072) * Math.sin(6 * phi));
  let easting = k0 * N * (A + ((1 - T + C) * Math.pow(A, 3)) / 6
    + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5)) / 120) + 500000;
  let northing = k0 * (M + N * tanPhi * ((A * A) / 2
    + ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24
    + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6)) / 720));
  if (south) northing += 10000000;
  return { easting, northing };
}

// ---------------------------------------------------------------------------
// 1) Titik terdokumentasi: CN Tower (Wikipedia UTM page).
// ---------------------------------------------------------------------------
const CN_LAT = 43 + 38 / 60 + 33.24 / 3600;
const CN_LON = -(79 + 23 / 60 + 13.7 / 3600);

test('titik referensi terdokumentasi CN Tower → zona 17N 630084 E / 4833438 N', () => {
  const utm = proj.latLonToUtm(CN_LAT, CN_LON);
  assert.equal(utm.zone, 17);
  assert.equal(utm.south, false);
  assert.ok(Math.abs(utm.easting - 630084) <= 2, `easting ${utm.easting} vs 630084`);
  assert.ok(Math.abs(utm.northing - 4833438) <= 2, `northing ${utm.northing} vs 4833438`);
});

// ---------------------------------------------------------------------------
// 2) proj4js ↔ rumus Snyder independen (dua implementasi, beberapa titik).
// ---------------------------------------------------------------------------
const crossPoints = [
  { name: 'Monas Jakarta (48S)', lat: -6.175392, lon: 106.827153, zone: 48, south: true },
  { name: 'Dieng 109°54\'BT 07°10\'LS (49S)', lat: -7.175, lon: 109.908333, zone: 49, south: true },
  { name: 'Bandung (48S)', lat: -6.9175, lon: 107.6191, zone: 48, south: true },
  { name: 'CN Tower (17N)', lat: CN_LAT, lon: CN_LON, zone: 17, south: false },
];

for (const point of crossPoints) {
  test(`proj4js ≈ Snyder independen — ${point.name}`, () => {
    const utm = proj.latLonToUtm(point.lat, point.lon);
    const ref = snyderUtmForward(point.lat, point.lon, point.zone, point.south);
    assert.equal(utm.zone, point.zone);
    assert.equal(utm.south, point.south);
    assert.ok(Math.abs(utm.easting - ref.easting) <= 0.6, `easting ${utm.easting} vs ${ref.easting}`);
    assert.ok(Math.abs(utm.northing - ref.northing) <= 0.6, `northing ${utm.northing} vs ${ref.northing}`);
  });
}

test('northing selatan memuat false northing 10.000.000 m', () => {
  const utm = proj.latLonToUtm(-7.175, 109.908333);
  assert.ok(utm.northing > 9_000_000 && utm.northing < 9_400_000, `northing ${utm.northing}`);
});

// ---------------------------------------------------------------------------
// 3) Round-trip + utilitas garis grid.
// ---------------------------------------------------------------------------
test('round-trip lat/lon → UTM → lat/lon (toleransi 1e-9°)', () => {
  for (const point of crossPoints) {
    const utm = proj.latLonToUtm(point.lat, point.lon);
    const back = proj.utmToLatLon(utm.easting, utm.northing, utm.zone, utm.south);
    assert.ok(Math.abs(back.lat - point.lat) < 1e-9, `${point.name} lat ${back.lat}`);
    assert.ok(Math.abs(back.lon - point.lon) < 1e-9, `${point.name} lon ${back.lon}`);
  }
});

test('garis easting/northing konstan konsisten dengan forward', () => {
  const zone = 49;
  const easting = 580000;
  for (const lat of [-7.0, -7.2, -7.35]) {
    const lon = proj.lonAtEasting(zone, true, easting, lat);
    const forward = proj.latLonToUtm(lat, lon);
    assert.equal(forward.zone, zone);
    // 0,5 m pada grid 1 km = 0,02 mm di skala cetak — tak kasat mata.
    assert.ok(Math.abs(forward.easting - easting) < 0.5, `easting ${forward.easting}`);
  }
  const northing = proj.latLonToUtm(-7.175, 109.9).northing;
  for (const lon of [109.85, 109.908, 109.95]) {
    const lat = proj.latAtNorthing(zone, true, northing, lon);
    const forward = proj.latLonToUtm(lat, lon);
    assert.ok(Math.abs(forward.northing - northing) < 0.5, `northing ${forward.northing}`);
  }
});

test('garis easting konstan melengkung (konvergensi meridian) — bukan garis bujur tetap', () => {
  const zone = 49;
  const lonBottom = proj.lonAtEasting(zone, true, 580000, -7.35);
  const lonTop = proj.lonAtEasting(zone, true, 580000, -7.0);
  // Zona selatan: garis easting condong ke bujur tengah saat naik ke utara.
  // 0,0002° ≈ 22 m — jauh melebihi lebar garis di skala cetak.
  assert.ok(Math.abs(lonTop - lonBottom) > 0.0002, `konvergensi ${lonTop - lonBottom}`);
});

// ---------------------------------------------------------------------------
// 4) Pemilihan interval adaptif & label tepi.
// ---------------------------------------------------------------------------
test('interval UTM adaptif terhadap meter/piksel', () => {
  const mppZ13 = proj.metersPerPixelAt(-7, 13);
  const mppZ12 = proj.metersPerPixelAt(-7, 12);
  const mppZ10 = proj.metersPerPixelAt(-7, 10);
  assert.equal(proj.pickUtmIntervalM(mppZ13), 1000);
  assert.equal(proj.pickUtmIntervalM(mppZ12), 2000);
  assert.equal(proj.pickUtmIntervalM(mppZ10), 10000);
});

test('interval graticule adaptif (jauh → menit, dekat → 30 detik)', () => {
  const mpp25k = proj.metersPerPixelAt(-7, 14.52);
  const mppZ11 = proj.metersPerPixelAt(-7, 11);
  const mppZ8 = proj.metersPerPixelAt(-7, 8);
  assert.ok(proj.pickGraticuleIntervalSec(mpp25k, -7) <= 30, `dekat ${proj.pickGraticuleIntervalSec(mpp25k, -7)}`);
  assert.equal(proj.pickGraticuleIntervalSec(mppZ11, -7), 120);
  assert.equal(proj.pickGraticuleIntervalSec(mppZ8, -7), 1800);
});

test('gridValuesBetween menghasilkan nilai habis dibagi interval', () => {
  const values = proj.gridValuesBetween(579500, 583500, 1000);
  // Array berasal dari realm VM — bandingkan via JSON (nilai primitif identik).
  assert.equal(JSON.stringify(values.map(Number)), JSON.stringify([580000, 581000, 582000, 583000]));
});

test('format label UTM tepi penuh & tengah dua digit', () => {
  assert.equal(proj.formatUtmFull(380000, 'T'), '380000m.T');
  assert.equal(proj.formatUtmFull(9206000, 'U'), '9206000m.U');
  assert.equal(proj.formatUtmMiddle(380000), '80');
  assert.equal(proj.formatUtmMiddle(381000), '81');
  assert.equal(proj.formatUtmMiddle(9205000), '05');
  assert.equal(proj.formatUtmMiddle(9206000), '06');
});

test('format DMS geografis biru (BT/BB, LS/LU, derajat pad 2/3 digit)', () => {
  assert.equal(proj.formatDmsLon(109.908333), '109°54\'30"BT');
  assert.equal(proj.formatDmsLon(-79.387139), '079°23\'14"BB');
  assert.equal(proj.formatDmsLat(-7.175), '07°10\'30"LS');
  assert.equal(proj.formatDmsLat(43.642567), '43°38\'33"LU');
});

test('zona label & deteksi zona tepi', () => {
  assert.equal(proj.formatUtmZoneLabel(49, true), 'Zona UTM 49S, datum WGS84');
  assert.equal(proj.utmZoneFor(106.827), 48);
  assert.equal(proj.utmZoneFor(109.908), 49);
  assert.equal(proj.utmZoneFor(180), 1);
  assert.equal(proj.utmZoneFor(-180), 1);
  assert.equal(proj.utmZoneFor(114.0), 50);
  assert.equal(proj.epsgFor(49, true), 'EPSG:32749');
  assert.equal(proj.epsgFor(17, false), 'EPSG:32617');
});
