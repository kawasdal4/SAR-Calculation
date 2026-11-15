// Simulate the depth overlay grid point count + chosen interval at
// zoom 8, 10, 12, 14 for the SeaMap viewport. Mirrors the depthLabels.ts
// chooseGridInterval + enumerateGridPoints logic.

const GRID_INTERVALS_SEC = [
  { sec: 3600, label: '1°' }, { sec: 1800, label: '30′' },
  { sec: 600, label: '10′' }, { sec: 300, label: '5′' },
  { sec: 120, label: '2′' }, { sec: 60, label: '1′' },
  { sec: 30, label: '30″' }, { sec: 15, label: '15″' },
];
const SOURCE_RESOLUTION_SEC = { BATNAS_COG: 6, GEBCO_COG: 15, OPENTOPO_GEBCO: 15, NONE: 15 };
const DENSITY_TARGET_PX = { rapat: 70, sedang: 90, jarang: 110 };
const MAX_GRID_POINTS = 400;

function chooseGridInterval(pxPerDeg, density, source) {
  const targetPx = DENSITY_TARGET_PX[density];
  const resolutionSec = SOURCE_RESOLUTION_SEC[source];
  let finest = GRID_INTERVALS_SEC[0];
  for (const iv of GRID_INTERVALS_SEC) {
    const spacingPx = iv.sec * pxPerDeg / 3600;
    if (spacingPx >= targetPx) finest = iv;
  }
  if (finest.sec < resolutionSec) {
    for (const r of GRID_INTERVALS_SEC) {
      if (r.sec >= resolutionSec) return r;
    }
    return GRID_INTERVALS_SEC[GRID_INTERVALS_SEC.length - 1];
  }
  return finest;
}

function enumerateGridPoints(south, north, west, east, intervalSec) {
  if (intervalSec <= 0) return [];
  const s = Math.max(-85, south);
  const n = Math.min(85, north);
  if (n < s) return [];
  const points = [];
  const startLatSec = Math.floor((s * 3600) / intervalSec) * intervalSec;
  const endLatSec = Math.ceil((n * 3600) / intervalSec) * intervalSec;
  const startLngSec = Math.floor((west * 3600) / intervalSec) * intervalSec;
  const endLngSec = Math.ceil((east * 3600) / intervalSec) * intervalSec;
  for (let latSec = startLatSec; latSec <= endLatSec; latSec += intervalSec) {
    const lat = latSec / 3600;
    if (lat < s || lat > n) continue;
    for (let lngSec = startLngSec; lngSec <= endLngSec; lngSec += intervalSec) {
      const rawDeg = lngSec / 3600;
      const lng = rawDeg >= -180 && rawDeg <= 180 ? rawDeg : (((rawDeg + 540) % 360) + 360) % 360 - 180;
      if (lng < west || lng > east) continue;
      points.push({ lat, lng });
    }
  }
  return points;
}

// Web Mercator meters-per-pixel.
const R = 6378137;
function metersPerPixel(zoom, lat) {
  return (2 * Math.PI * R * Math.cos(lat * Math.PI / 180)) / (256 * Math.pow(2, zoom));
}
const M_PER_DEG_LAT = 111320;
function mPerDegLng(lat) { return 111320 * Math.cos(lat * Math.PI / 180); }

const W = 800, H = 460;
const CENTER_LAT = -6.1, CENTER_LNG = 106.8;

function simulate(zoom, source, density) {
  const mpp = metersPerPixel(zoom, CENTER_LAT);
  const pxPerDegLng = mPerDegLng(CENTER_LAT) / mpp;
  const pxPerDegLat = M_PER_DEG_LAT / mpp;
  const pxPerDeg = (pxPerDegLng + pxPerDegLat) / 2;
  const interval = chooseGridInterval(pxPerDeg, density, source);
  const halfDegLng = (W / 2) / pxPerDegLng;
  const halfDegLat = (H / 2) / pxPerDegLat;
  const west = CENTER_LNG - halfDegLng;
  const east = CENTER_LNG + halfDegLng;
  const south = CENTER_LAT - halfDegLat;
  const north = CENTER_LAT + halfDegLat;
  const points = enumerateGridPoints(south, north, west, east, interval.sec);
  const render = points.length <= MAX_GRID_POINTS;
  return {
    zoom, source, density,
    pxPerDegLng: pxPerDegLng.toFixed(1),
    pxPerDegLat: pxPerDegLat.toFixed(1),
    intervalLabel: interval.label,
    intervalSec: interval.sec,
    pointCount: points.length,
    render,
    hint: render ? null : 'Perbesar untuk melihat kedalaman',
  };
}

console.log('Sumber aktif: OPENTOPO_GEBCO (default — tanpa env var)\n');
for (const z of [8, 10, 12, 14]) {
  for (const density of ['sedang', 'rapat', 'jarang']) {
    const r = simulate(z, 'OPENTOPO_GEBCO', density);
    console.log(
      `z${r.zoom} ${r.density.padEnd(6)}: px/deg=${r.pxPerDegLng}/${r.pxPerDegLat}, ` +
      `interval=${r.intervalLabel.padEnd(4)} (${r.intervalSec}s), ` +
      `points=${r.pointCount.toString().padStart(4)}, ` +
      `render=${r.render}${r.hint ? ' — ' + r.hint : ''}`,
    );
  }
  console.log('');
}

console.log('\nSumber aktif: BATNAS_COG (resolusi ~6″)\n');
for (const z of [8, 10, 12, 14]) {
  const r = simulate(z, 'BATNAS_COG', 'sedang');
  console.log(
    `z${r.zoom} sedang: px/deg=${r.pxPerDegLng}/${r.pxPerDegLat}, ` +
    `interval=${r.intervalLabel}, points=${r.pointCount}, render=${r.render}`,
  );
}
