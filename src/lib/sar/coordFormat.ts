/**
 * Pure coordinate formatting function for nautical chart labels.
 *
 * Hierarchical labelling:
 *   - At full-degree boundary:   "106°E" or "6°S"
 *   - At minute interval:        "30′" or "15′"
 *   - At second interval:        "30″"
 *   - At minute boundary (when seconds are shown): "06°12′S"
 *
 * Uses Unicode symbols: ° (U+00B0), ′ (U+2032), ″ (U+2033).
 * Never writes seconds with the minute symbol.
 */

export type CoordAxis = 'lat' | 'lng';

/**
 * Format a coordinate value as a hierarchical nautical chart label.
 *
 * @param value   The coordinate value (decimal degrees)
 * @param axis    'lat' for latitude (N/S), 'lng' for longitude (E/W)
 * @param intervalSec  The interval size in seconds (0 = degree, 60 = minute, 3600 = degree)
 * @returns Formatted label string
 */
export function formatDegMinSec(
  value: number,
  axis: CoordAxis,
  intervalSec: number,
): string {
  const hemi = axis === 'lat'
    ? (value >= 0 ? 'N' : 'S')
    : (value >= 0 ? 'E' : 'W');

  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = Math.round((minFull - min) * 60);

  // Handle rounding overflow (e.g., 59.999" → next minute)
  let d = deg;
  let m = min;
  let s = sec;
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }

  // Pad with zeros
  const dStr = d.toString().padStart(axis === 'lat' ? 2 : 3, '0');
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toString().padStart(2, '0');

  // Determine label hierarchy based on interval
  if (intervalSec <= 1) {
    // Second-level interval: show "06°12′30″S"
    return `${dStr}°${mStr}′${sStr}″${hemi}`;
  }
  if (intervalSec <= 60) {
    // Minute-level interval: at full-degree boundary show "106°00′E",
    // at non-zero minutes show "06°12′S"
    return `${dStr}°${mStr}′${hemi}`;
  }
  // Degree-level interval: show "106°E" or "6°S"
  return `${dStr}°${hemi}`;
}

/**
 * Short label for minor intervals (minutes or seconds only).
 * Used between major labels.
 */
export function formatShortLabel(
  value: number,
  axis: CoordAxis,
  intervalSec: number,
): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = Math.round((minFull - min) * 60);

  let m = min;
  let s = sec;
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; }

  if (intervalSec <= 1) {
    // Show seconds at minute boundary, otherwise just seconds
    const mStr = m.toString().padStart(2, '0');
    const sStr = s.toString().padStart(2, '0');
    if (s === 0) {
      return `${mStr}′`;
    }
    return `${sStr}″`;
  }
  // Show minutes only (at non-degree positions)
  if (m === 0 && deg !== Math.floor(abs)) return '';
  const mStr = m.toString().padStart(2, '0');
  return `${mStr}′`;
}

// ============================================================================
// Unit tests (run with: node --test or bun test)
// ============================================================================

/**
 * Test formatDegMinSec function.
 * Expected results:
 *   106.50861, 'lng', 0.1 → "106°30′31″E"
 *   -5.2045,   'lat', 0.1 → "05°12′16″S"
 *   107.0,     'lng', 1   → "107°00′00″E"
 *   106.5,     'lng', 60  → "106°30′E"
 *   -6.0,      'lat', 3600 → "06°S"
 */
export function runFormatDegMinSecTests(): void {
  const tests: Array<{ input: [number, CoordAxis, number]; expected: string }> = [
    { input: [106.50861, 'lng', 0.1], expected: '106°30′31″E' },
    { input: [-5.2045, 'lat', 0.1], expected: '05°12′16″S' },
    { input: [107.0, 'lng', 1], expected: '107°00′00″E' },
    { input: [106.5, 'lng', 60], expected: '106°30′E' },
    { input: [-6.0, 'lat', 3600], expected: '06°S' },
    { input: [0, 'lat', 3600], expected: '00°N' },
    { input: [0, 'lng', 60], expected: '000°00′E' },
    { input: [-0.00833, 'lat', 1], expected: '00°00′30″S' },
  ];

  let passed = 0;
  let failed = 0;
  for (const { input, expected } of tests) {
    const result = formatDegMinSec(...input);
    if (result === expected) {
      passed++;
    } else {
      failed++;
      console.error(`FAIL: formatDegMinSec(${input.join(', ')}) = "${result}", expected "${expected}"`);
    }
  }
  console.log(`formatDegMinSec tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
