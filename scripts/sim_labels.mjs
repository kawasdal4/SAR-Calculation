// Simulate the SeaMap scale-border label logic at zoom 6, 7, 9, 12.
// Mirrors the SeaMap.tsx chooseMajorInterval + chooseMinorInterval + drawBand
// + bounding-box collision resolution to verify which labels actually appear.

const MAJOR_STEPS_SEC = [1800, 3600, 7200, 18000];
const LABEL_MIN_PX_LNG = 60;
const LABEL_MIN_PX_LAT = 30;
const MINOR_MIN_PX = 5;
const MINOR_DENSIFY_PX = 60;
const MAJOR_TICK_PX = 10;

function chooseMajor(pxPerDeg, minLabelPx) {
  for (const s of MAJOR_STEPS_SEC) {
    if (s * pxPerDeg / 3600 >= minLabelPx) return s;
  }
  return MAJOR_STEPS_SEC[MAJOR_STEPS_SEC.length - 1];
}
function chooseMinor(majorSec, pxPerDeg) {
  const sp5 = 300 * pxPerDeg / 3600;
  if (sp5 >= MINOR_MIN_PX) {
    if (sp5 > MINOR_DENSIFY_PX) {
      for (const c of [30, 60]) {
        if (c * pxPerDeg / 3600 >= MINOR_MIN_PX && c < majorSec) return c;
      }
      return 300;
    }
    return 300;
  }
  for (const c of [600, 900]) {
    if (c < majorSec && c * pxPerDeg / 3600 >= MINOR_MIN_PX) return c;
  }
  return majorSec;
}

function fmt(value, axis, intervalSec) {
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

// Approx text width for 11px monospace: 6.6 px per char + 8 px padding.
function textWidth(text) {
  return text.length * 6.6 + 8;
}

const R = 6378137;
function metersPerPixel(zoom, lat) {
  return (2 * Math.PI * R * Math.cos(lat * Math.PI / 180)) / (256 * Math.pow(2, zoom));
}
const M_PER_DEG_LAT = 111320;
function mPerDegLng(lat) { return 111320 * Math.cos(lat * Math.PI / 180); }

// Viewport 800 × 460. Centered on Jakarta.
const W = 800, H = 460;
const CENTER_LAT = -6.1, CENTER_LNG = 106.8; // Jakarta

function simulate(zoom) {
  const mpp = metersPerPixel(zoom, CENTER_LAT);
  const pxPerDegLng = mPerDegLng(CENTER_LAT) / mpp;
  const pxPerDegLat = M_PER_DEG_LAT / mpp;
  const lngMajSec = chooseMajor(pxPerDegLng, LABEL_MIN_PX_LNG);
  const lngMinSec = chooseMinor(lngMajSec, pxPerDegLng);
  const latMajSec = chooseMajor(pxPerDegLat, LABEL_MIN_PX_LAT);
  const latMinSec = chooseMinor(latMajSec, pxPerDegLat);

  const halfDegLng = (W / 2) / pxPerDegLng;
  const west = CENTER_LNG - halfDegLng;
  const east = CENTER_LNG + halfDegLng;
  const halfDegLat = (H / 2) / pxPerDegLat;
  const south = CENTER_LAT - halfDegLat;
  const north = CENTER_LAT + halfDegLat;

  // Reserved rects (scale bottom-left, attribution bottom-right).
  const reserved = [
    { x: 0, y: H - 40, w: 130, h: 40 },
    { x: W - 220, y: H - 28, w: 220, h: 28 },
  ];

  // ---- Collect candidates ----
  const candidates = [];
  const LABEL_OFFSET = MAJOR_TICK_PX + 4;

  // Longitude: top & bottom
  {
    const majSec = Math.round(lngMajSec);
    const minSec = Math.round(lngMinSec);
    const startSec = Math.ceil(west * 3600 / minSec) * minSec;
    const endSec = Math.ceil(east * 3600 / minSec) * minSec;
    for (let sec = startSec; sec <= endSec; sec += minSec) {
      if (sec % majSec !== 0) continue;
      const lng = (((sec / 3600) + 540) % 360 + 360) % 360 - 180;
      // Approx x via linear (good enough for collision check):
      const x = ((lng - west) / (east - west)) * W;
      if (x <= MAJOR_TICK_PX + 20 || x >= W - MAJOR_TICK_PX - 20) continue;
      const label = fmt(lng, 'lng', lngMajSec);
      const tw = textWidth(label);
      // top
      {
        const bgX = x - tw / 2;
        const bgY = LABEL_OFFSET - 2;
        if (bgX < 1 || bgX + tw > W - 1 || bgY < 1 || bgY + 14 + 4 > H - 1) {} else {
          candidates.push({ side: 'top', label, rect: { x: bgX, y: bgY, w: tw, h: 18 } });
        }
      }
      // bottom
      {
        const bgX = x - tw / 2;
        const bgY = H - LABEL_OFFSET - 18 + 2;
        if (bgX < 1 || bgX + tw > W - 1 || bgY < 1 || bgY + 18 > H - 1) {} else {
          candidates.push({ side: 'bottom', label, rect: { x: bgX, y: bgY, w: tw, h: 18 } });
        }
      }
    }
  }
  // Latitude: left & right
  {
    const majSec = Math.round(latMajSec);
    const minSec = Math.round(latMinSec);
    const startSec = Math.ceil(south * 3600 / minSec) * minSec;
    const endSec = Math.ceil(north * 3600 / minSec) * minSec;
    for (let sec = startSec; sec <= endSec; sec += minSec) {
      if (sec % majSec !== 0) continue;
      const lat = sec / 3600;
      // y(lat): north=0, south=H. y = (north - lat) / (north - south) * H
      const y = ((north - lat) / (north - south)) * H;
      if (y <= MAJOR_TICK_PX + 14 || y >= H - MAJOR_TICK_PX - 14) continue;
      const label = fmt(lat, 'lat', latMajSec);
      const tw = textWidth(label);
      // left
      {
        const bgX = LABEL_OFFSET - 4;
        const bgY = y - 9;
        if (bgX < 1 || bgX + tw > W - 1 || bgY < 1 || bgY + 18 > H - 1) {} else {
          candidates.push({ side: 'left', label, rect: { x: bgX, y: bgY, w: tw, h: 18 } });
        }
      }
      // right
      {
        const bgX = W - LABEL_OFFSET - tw + 4;
        const bgY = y - 9;
        if (bgX < 1 || bgX + tw > W - 1 || bgY < 1 || bgY + 18 > H - 1) {} else {
          candidates.push({ side: 'right', label, rect: { x: bgX, y: bgY, w: tw, h: 18 } });
        }
      }
    }
  }

  // ---- Sort: top, bottom, left, right (priority order) ----
  const sideOrder = { top: 0, bottom: 1, left: 2, right: 3 };
  candidates.sort((a, b) => sideOrder[a.side] - sideOrder[b.side]);

  // ---- Collision resolution ----
  function overlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  const placed = [...reserved];
  const kept = [];
  for (const c of candidates) {
    let collides = false;
    for (const p of placed) {
      if (overlap(c.rect, p)) { collides = true; break; }
    }
    if (collides) continue;
    kept.push(c);
    placed.push(c.rect);
  }

  return {
    zoom,
    pxPerDegLng: pxPerDegLng.toFixed(1),
    pxPerDegLat: pxPerDegLat.toFixed(1),
    lngMajSec, lngMinSec, latMajSec, latMinSec,
    lngMajLabel: `${lngMajSec / 60}′`,
    lngMinLabel: `${lngMinSec / 60}′`,
    latMajLabel: `${latMajSec / 60}′`,
    latMinLabel: `${latMinSec / 60}′`,
    topLabels: kept.filter(c => c.side === 'top').map(c => c.label),
    bottomLabels: kept.filter(c => c.side === 'bottom').map(c => c.label),
    leftLabels: kept.filter(c => c.side === 'left').map(c => c.label),
    rightLabels: kept.filter(c => c.side === 'right').map(c => c.label),
    totalCandidates: candidates.length,
    totalKept: kept.length,
  };
}

for (const z of [6, 7, 9, 12]) {
  const r = simulate(z);
  console.log(`\n=== Zoom ${r.zoom} ===`);
  console.log(`  px/deg: lng=${r.pxPerDegLng}  lat=${r.pxPerDegLat}`);
  console.log(`  major: lng=${r.lngMajLabel} (${r.lngMajSec}s)  lat=${r.latMajLabel} (${r.latMajSec}s)`);
  console.log(`  minor: lng=${r.lngMinLabel} (${r.lngMinSec}s)  lat=${r.latMinLabel} (${r.latMinSec}s)`);
  console.log(`  candidates=${r.totalCandidates}  kept=${r.totalKept}`);
  console.log(`  TOP    labels (${r.topLabels.length}): ${r.topLabels.join('   ')}`);
  console.log(`  BOTTOM labels (${r.bottomLabels.length}): ${r.bottomLabels.join('   ')}`);
  console.log(`  LEFT   labels (${r.leftLabels.length}): ${r.leftLabels.join('   ')}`);
  console.log(`  RIGHT  labels (${r.rightLabels.length}): ${r.rightLabels.join('   ')}`);
}
