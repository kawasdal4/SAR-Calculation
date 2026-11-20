// Verifikasi logika kontrol skala peta darat WS4: skala cetak 1:25.000,
// lebar batang, tangga skala bebas, kalibrasi localStorage.
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
  const mod = { exports: {} };
  runInNewContext(compiled, { module: mod, exports: mod.exports, require: (name) => name === 'proj4' ? proj4shim : requireRef(name) });
  return mod.exports;
}

const scale = compileTs('../src/lib/sar/landMapScale.ts');

test('mmPerPx = 25.4/DPI (DPI 96 default)', () => {
  assert.ok(Math.abs(scale.mmPerPx(96) - 0.26458333) < 1e-6);
  assert.ok(Math.abs(scale.mmPerPx() - scale.mmPerPx(96)) < 1e-12);
});

test('meterPerPixelTarget untuk 1:25.000 @96 DPI = 6,614583 m/px', () => {
  const target = scale.meterPerPixelTarget(25000, 96);
  assert.ok(Math.abs(target - 25000 * (25.4 / 96) / 1000) < 1e-9);
});

test('zoomTarget di lintang -7° mengunci skala 1:25.000', () => {
  const zoom = scale.zoomTargetForScale(-7, 25000, 96);
  const denominator = scale.scaleDenominatorNow(-7, zoom, 96);
  assert.ok(Math.abs(denominator - 25000) < 1, `denominasi ${denominator}`);
});

test('batang cetak: a=250 m → tiga segmen hitam-putih-hitam, 1.000 m = 40 mm', () => {
  const bar = scale.buildScaleBar(250, scale.meterPerPixelTarget(25000, 96), 25000);
  assert.equal(bar.quarterM, 250);
  // Realm VM — bandingkan via JSON.
  assert.equal(JSON.stringify(bar.segments.map((s) => `${s.fromM}-${s.toM}:${s.dark ? 'H' : 'P'}`)), JSON.stringify(['0-250:H', '250-500:P', '500-1000:H']));
  assert.ok(Math.abs(bar.widthMm - 40) < 0.01, `widthMm ${bar.widthMm}`);
  // 1.000 m pada meterPerPixelTarget = 1000/6.614583 = 151,18 px layar @96 DPI.
  assert.ok(Math.abs(bar.widthPx - 1000 / (25000 * 25.4 / 96000)) < 1e-6);
  assert.deepEqual(JSON.stringify(bar.labels.map((l) => l.meters)), JSON.stringify([0, 250, 500, 1000]));
  assert.equal(bar.labels[3].suffix, true);
});

test('mode bebas memilih a agar batang 56–160 px', () => {
  const mpp13 = (156543.03392 * Math.cos((-7 * Math.PI) / 180)) / Math.pow(2, 13);
  const quarter = scale.pickBarQuarterM(mpp13, false);
  const px = (quarter * 4) / mpp13;
  assert.ok(px >= 56 && px <= 160, `a=${quarter} → ${px}px`);
  const bar = scale.buildScaleBar(quarter, mpp13);
  assert.ok(bar.segments.length === 3);
});

test('format ribuan Indonesia & tangga skala bebas', () => {
  assert.equal(scale.formatThousand(25000), '25.000');
  assert.equal(scale.formatThousand(1000), '1.000');
  assert.equal(scale.formatThousand(250), '250');
  assert.equal(scale.roundScaleN(24000), 25000);
  assert.equal(scale.roundScaleN(110000), 100000);
  assert.equal(scale.roundScaleN(2600), 2500);
});

test('kalibrasi localStorage aman (tanpa window / JSON rusak)', () => {
  assert.equal(JSON.stringify(scale.readCalibration(null)), '{}');
  const mem = new Map();
  const fake = {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => mem.set(k, v),
  };
  scale.writeCalibration(fake, { dpi: 110, printMode: true });
  assert.equal(JSON.stringify(scale.readCalibration(fake)), JSON.stringify({ dpi: 110, printMode: true }));
  mem.set(scale.CALIBRATION_KEY, '{rusak');
  assert.equal(JSON.stringify(scale.readCalibration(fake)), '{}');
  scale.writeCalibration(fake, { dpi: 9999 });
  assert.equal(JSON.stringify(scale.readCalibration(fake)), '{}');
});
