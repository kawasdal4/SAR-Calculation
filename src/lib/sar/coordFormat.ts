/**
 * Pure coordinate formatting function for nautical chart labels.
 *
 * Label-interval contract (see SeaMap.tsx scale border):
 *   - The label major interval is locked to multiples of 30′
 *     (1800″, 3600″, 7200″, 18000″ — i.e. 30′, 1°, 2°, 5°).
 *   - When the major interval is ≥ 60″ (≥ 1′), the label always shows
 *     degrees + minutes, e.g. "105°30′E", "105°00′E", "6°30′S".
 *   - When the major interval is < 60″ (< 1′ — only used for very close
 *     zoom minor ticks, never for labels), the label would include seconds.
 *     In practice labels are never drawn at sub-minute intervals, but the
 *     formatting rule is kept here for completeness.
 *   - Never drop minutes when interval ≥ 1′.
 *   - Never use degree-only labels like "106°E" (always include minutes).
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
  const tests: Array<{ name: string; input: [number, CoordAxis, number]; expected: string }> = [
    // ---- 30′ interval (1800″) — the default label interval ----
    { name: '30′ lng +30′',  input: [105.5, 'lng', 1800], expected: '105°30′E' },
    { name: '30′ lng +00′',  input: [105.0, 'lng', 1800], expected: '105°00′E' },
    { name: '30′ lat -30′',  input: [-6.5,  'lat', 1800], expected: '06°30′S' },
    { name: '30′ lat -00′',  input: [-6.0,  'lat', 1800], expected: '06°00′S' },
    { name: '30′ lat -5°00′', input: [-5.0, 'lat', 1800], expected: '05°00′S' },
    { name: '30′ lat -5°30′', input: [-5.5, 'lat', 1800], expected: '05°30′S' },
    { name: '30′ lng round up minutes', input: [106.4999, 'lng', 1800], expected: '106°30′E' },

    // ---- 1° interval (3600″) — far zoom fallback. Still shows minutes. ----
    { name: '1° lng +00′',  input: [107.0, 'lng', 3600], expected: '107°00′E' },
    { name: '1° lng round', input: [106.0, 'lng', 3600], expected: '106°00′E' },
    { name: '1° lat -00′',  input: [-6.0,  'lat', 3600], expected: '06°00′S' },

    // ---- 2° interval (7200″) — very far zoom. Still shows minutes. ----
    { name: '2° lng +00′',  input: [108.0, 'lng', 7200], expected: '108°00′E' },
    { name: '2° lng +00′ (smaller)', input: [106.0, 'lng', 7200], expected: '106°00′E' },

    // ---- 5° interval (18000″) — world view. Still shows minutes. ----
    { name: '5° lng +00′',  input: [110.0, 'lng', 18000], expected: '110°00′E' },
    { name: '5° lng +00′ (smaller)', input: [105.0, 'lng', 18000], expected: '105°00′E' },

    // ---- 5′ interval (300″) — minor tick, never used for labels but tested. ----
    { name: '5′ lng +10′',  input: [106.16667, 'lng', 300], expected: '106°10′E' },

    // ---- 30″ interval (< 60″) — would show seconds (only for very close zoom minor ticks) ----
    { name: '30″ lng +31″', input: [106.508611, 'lng', 30], expected: '106°30′31″E' },
    { name: '30″ lat +12″', input: [-5.2045,    'lat', 30], expected: '05°12′16″S' },

    // ---- Zero values ----
    { name: 'zero lat',  input: [0, 'lat', 3600],  expected: '00°00′N' },
    { name: 'zero lng',  input: [0, 'lng', 1800],  expected: '000°00′E' },
    { name: 'zero lng 5°', input: [0, 'lng', 18000], expected: '000°00′E' },

    // ---- Negative longitude / latitude rounding ----
    { name: 'neg lng -30′', input: [-106.5, 'lng', 1800], expected: '106°30′W' },
    { name: 'neg lat +30′', input: [6.5,    'lat', 1800], expected: '06°30′N' },
  ];

  let passed = 0;
  let failed = 0;
  for (const { name, input, expected } of tests) {
    const result = formatDegMinSec(...input);
    if (result === expected) {
      passed++;
    } else {
      failed++;
      console.error(`FAIL [${name}]: formatDegMinSec(${input.join(', ')}) = "${result}", expected "${expected}"`);
    }
  }
  console.log(`formatDegMinSec tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}
