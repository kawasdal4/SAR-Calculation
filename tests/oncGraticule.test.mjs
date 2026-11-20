import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/sar/oncGraticule.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const mod = { exports: {} };
runInNewContext(compiled, { module: mod, exports: mod.exports, require: createRequire(import.meta.url) });
const { buildOncGraticule, selectOncTickInterval } = mod.exports;

const testBounds = { west: 118.5, south: -3.5, east: 119.5, north: -2.5 };

test('selects interval from projected screen spacing at requested zooms', () => {
  assert.equal(selectOncTickInterval(6, -3), 5);
  assert.equal(selectOncTickInterval(8, -3), 1);
  assert.equal(selectOncTickInterval(10, -3), 1);
  assert.equal(selectOncTickInterval(12, -3), 1);
  assert.equal(selectOncTickInterval(4, -3), 0);
});

test('returns an empty collection until the map viewport has nonzero dimensions', () => {
  assert.equal(buildOncGraticule(testBounds, 0, 520, 8).features.length, 0);
  assert.equal(buildOncGraticule(testBounds, 640, 0, 8).features.length, 0);
});

test('creates ticks and minute labels on full degree gridlines', () => {
  const collection = buildOncGraticule(testBounds, 640, 520, 8);
  const ticks = collection.features.filter((feature) => feature.properties.kind === 'tick');
  const labels = collection.features.filter((feature) => feature.properties.kind === 'minute-label');
  assert.ok(ticks.length > 0);
  assert.ok(labels.some((feature) => ['10', '20', '30', '40', '50'].includes(feature.properties.label)));
  assert.ok(labels.some((feature) => feature.properties.label === '30'));
  assert.ok(ticks.some((feature) => feature.properties.tickMinutes === 10 && (
    feature.properties.axis === 'longitude'
      ? Math.abs(Math.round((feature.geometry.coordinates[0][1] + feature.geometry.coordinates[1][1]) * 30)) % 60 === 30
      : Math.abs(Math.round(feature.geometry.coordinates[0][0] * 60)) % 60 === 30
  )));
  assert.ok(ticks.some((feature) => feature.properties.axis === 'longitude' && feature.properties.tickMinutes === 10));
  assert.ok(ticks.some((feature) => feature.properties.axis === 'latitude' && feature.properties.tickMinutes === 5));
});

test('does not create tick marks at 60 minute degree intersections', () => {
  const collection = buildOncGraticule(testBounds, 640, 520, 8);
  const ticks = collection.features.filter((feature) => feature.properties.kind === 'tick');
  for (const feature of ticks) {
    const [[lon1, lat1], [lon2, lat2]] = feature.geometry.coordinates;
    if (feature.properties.axis === 'longitude') {
      const minute = Math.round(((lat1 + lat2) / 2) * 60);
      assert.notEqual(Math.abs(minute) % 60, 0);
      assert.ok(Math.abs(lon2 - lon1) > 0);
    } else {
      const minute = Math.round(lon1 * 60);
      assert.notEqual(Math.abs(minute) % 60, 0);
      assert.equal(lon1, lon2);
    }
  }
});

test('tick geometry scales to the specified 3, 5, and 8 pixel half-lengths', () => {
  const collection = buildOncGraticule(testBounds, 640, 520, 8);
  const ticks = collection.features.filter((feature) => feature.properties.kind === 'tick');
  const ppd = 512 * 2 ** 8 / 360;
  for (const feature of ticks.filter((candidate) => candidate.properties.axis === 'longitude')) {
    const [[lon1], [lon2]] = feature.geometry.coordinates;
    const halfLengthPx = (lon2 - lon1) * ppd / 2;
    const expected = feature.properties.tickMinutes === 10 ? 8 : feature.properties.tickMinutes === 5 ? 5 : 3;
    assert.ok(Math.abs(halfLengthPx - expected) < 0.01);
  }
});
