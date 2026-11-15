/**
 * Pure coordinate formatting function for nautical chart labels.
 *
 * Rules:
 *   - interval >= 60 arc-seconds (>= 1′): always show degrees + minutes
 *     e.g. "105°30′E", "105°00′E", "6°30′S", "6°00′S"
 *   - interval < 60 arc-seconds (< 1′): show degrees + minutes + seconds
 *     e.g. "106°30′31″E"
 *   - Never drop minutes when interval >= 1′
 *   - Never use degree-only labels like "106°E" (always include minutes)
 *
 * Uses Unicode symbols: ° (U+00B0), ′ (U+2032), ″ (U+2033).
 */

export type CoordAxis = 'lat' | 'lng';

/**
 * Format a coordinate value as a nautical chart label.
 *
 * @param value       The coordinate value (decimal degrees)
 * @param axis        'lat' for latitude (N/S), 'lng' for longitude (E/W)
 * @param intervalSec The major interval size in arc-seconds
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

  // Pad with zeros — latitude 2 digits, longitude 3 digits
  const dStr = d.toString().padStart(axis === 'lat' ? 2 : 3, '0');
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toString().padStart(2, '0');

  if (intervalSec < 60) {
    // Second-level interval: show "106°30′31″E"
    return `${dStr}°${mStr}′${sStr}″${hemi}`;
  }
  // Minute-level or degree-level interval: always show degrees + minutes
  // e.g. "105°30′E", "105°00′E", "6°30′S", "6°00′S"
  return `${dStr}°${mStr}′${hemi}`;
}

// ============================================================================
// Unit tests
// ============================================================================

export function runFormatDegMinSecTests(): void {
  const tests: Array<{ input: [number, CoordAxis, number]; expected: string }> = [
    // Test: 30′ interval
    { input: [105.5, 'lng', 1800], expected: '105°30′E' },
    { input: [105.0, 'lng', 1800], expected: '105°00′E' },
    { input: [-6.5, 'lat', 1800], expected: '06°30′S' },
    { input: [-6.0, 'lat', 1800], expected: '06°00′S' },
    // Test: 1° interval (3600 sec) — should still show minutes
    { input: [107.0, 'lng', 3600], expected: '107°00′E' },
    { input: [106.0, 'lng', 3600], expected: '106°00′E' },
    // Test: 30″ interval (< 60 sec) — should show seconds
    { input: [106.508611, 'lng', 30], expected: '106°30′31″E' },
    { input: [-5.2045, 'lat', 30], expected: '05°12′16″S' },
    // Test: 10′ interval
    { input: [106.16667, 'lng', 600], expected: '106°10′E' },
    // Test: 0 values
    { input: [0, 'lat', 3600], expected: '00°00′N' },
    { input: [0, 'lng', 1800], expected: '000°00′E' },
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
