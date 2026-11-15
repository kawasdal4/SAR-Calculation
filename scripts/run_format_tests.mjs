// Re-implement formatDegMinSec and run the test list from coordFormat.ts
function formatDegMinSec(value, axis, intervalSec) {
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = Math.round((minFull - min) * 60);
  let d = deg, m = min, s = sec;
  if (s >= 60) { s -= 60; m += 1; }
  if (m >= 60) { m -= 60; d += 1; }
  const dStr = d.toString().padStart(axis === 'lat' ? 2 : 3, '0');
  const mStr = m.toString().padStart(2, '0');
  const sStr = s.toString().padStart(2, '0');
  if (intervalSec < 60) return `${dStr}°${mStr}′${sStr}″${hemi}`;
  return `${dStr}°${mStr}′${hemi}`;
}

const tests = [
  { name: '30′ lng +30′',  input: [105.5, 'lng', 1800], expected: '105°30′E' },
  { name: '30′ lng +00′',  input: [105.0, 'lng', 1800], expected: '105°00′E' },
  { name: '30′ lat -30′',  input: [-6.5,  'lat', 1800], expected: '06°30′S' },
  { name: '30′ lat -00′',  input: [-6.0,  'lat', 1800], expected: '06°00′S' },
  { name: '30′ lat -5°00′', input: [-5.0, 'lat', 1800], expected: '05°00′S' },
  { name: '30′ lat -5°30′', input: [-5.5, 'lat', 1800], expected: '05°30′S' },
  { name: '30′ lng round up minutes', input: [106.4999, 'lng', 1800], expected: '106°30′E' },
  { name: '1° lng +00′',  input: [107.0, 'lng', 3600], expected: '107°00′E' },
  { name: '1° lng round', input: [106.0, 'lng', 3600], expected: '106°00′E' },
  { name: '1° lat -00′',  input: [-6.0,  'lat', 3600], expected: '06°00′S' },
  { name: '2° lng +00′',  input: [108.0, 'lng', 7200], expected: '108°00′E' },
  { name: '2° lng +00′ (smaller)', input: [106.0, 'lng', 7200], expected: '106°00′E' },
  { name: '5° lng +00′',  input: [110.0, 'lng', 18000], expected: '110°00′E' },
  { name: '5° lng +00′ (smaller)', input: [105.0, 'lng', 18000], expected: '105°00′E' },
  { name: '5′ lng +10′',  input: [106.16667, 'lng', 300], expected: '106°10′E' },
  { name: '30″ lng +31″', input: [106.508611, 'lng', 30], expected: '106°30′31″E' },
  { name: '30″ lat +12″', input: [-5.2045,    'lat', 30], expected: '05°12′16″S' },
  { name: 'zero lat',  input: [0, 'lat', 3600],  expected: '00°00′N' },
  { name: 'zero lng',  input: [0, 'lng', 1800],  expected: '000°00′E' },
  { name: 'zero lng 5°', input: [0, 'lng', 18000], expected: '000°00′E' },
  { name: 'neg lng -30′', input: [-106.5, 'lng', 1800], expected: '106°30′W' },
  { name: 'neg lat +30′', input: [6.5,    'lat', 1800], expected: '06°30′N' },
];

let passed = 0, failed = 0;
for (const t of tests) {
  const result = formatDegMinSec(...t.input);
  if (result === t.expected) { passed++; }
  else { failed++; console.error(`FAIL [${t.name}]: got "${result}", expected "${t.expected}"`); }
}
console.log(`formatDegMinSec tests: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
