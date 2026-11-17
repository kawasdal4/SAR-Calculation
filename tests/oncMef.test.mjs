import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMefFeet, deriveMefFromMeters, formatMefFeet } from '../src/lib/sar/oncMef.mjs';

test('rounds maximum elevation upward to the next hundred feet', () => {
  assert.equal(calculateMefFeet(6549), 6600);
  assert.equal(calculateMefFeet(6600), 6600);
  assert.equal(calculateMefFeet(6600.01), 6700);
  assert.equal(calculateMefFeet(0), 0);
  assert.equal(calculateMefFeet(-12), 0);
});

test('formats ONC-style thousands and superscript hundreds', () => {
  assert.equal(formatMefFeet(6600).label, '6⁶');
  assert.equal(formatMefFeet(300).label, '0³');
  assert.equal(formatMefFeet(1000).label, '1⁰');
  assert.equal(formatMefFeet(0).label, '0⁰');
});

test('positive elevations below 100 feet round to 100 feet (0¹)', () => {
  assert.equal(calculateMefFeet(0.01), 100);
  assert.equal(formatMefFeet(calculateMefFeet(99.99)).label, '0¹');
});

test('converts metres to feet before rounding MEF', () => {
  const result = deriveMefFromMeters(1996.7352);
  assert.equal(result.mefFeet, 6600);
  assert.equal(result.label, '6⁶');
});

test('rejects invalid values and non-hundred MEF formatting inputs', () => {
  assert.throws(() => calculateMefFeet(Number.NaN), TypeError);
  assert.throws(() => formatMefFeet(-100), RangeError);
  assert.throws(() => formatMefFeet(350), RangeError);
});
