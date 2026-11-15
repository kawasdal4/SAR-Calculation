// Re-implement depthLabels logic and run the tests.
function snapToGrid(value, intervalSec) {
  if (intervalSec <= 0) return value;
  const sec = Math.floor((value * 3600) / intervalSec) * intervalSec;
  return sec / 3600;
}
function chooseGridInterval(pxPerDeg, density, source) {
  const DENSITY_TARGET_PX = { rapat: 70, sedang: 90, jarang: 110 };
  const SOURCE_RESOLUTION_SEC = { BATNAS_COG: 6, GEBCO_COG: 15, OPENTOPO_GEBCO: 15, NONE: 15 };
  const GRID_INTERVALS_SEC = [
    { sec: 3600, label: '1°' }, { sec: 1800, label: '30′' },
    { sec: 600, label: '10′' }, { sec: 300, label: '5′' },
    { sec: 120, label: '2′' }, { sec: 60, label: '1′' },
    { sec: 30, label: '30″' }, { sec: 15, label: '15″' },
  ];
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
function formatDepth(elevation, source) {
  if (elevation >= 0) return null;
  const depthM = -elevation;
  if (source === 'BATNAS_COG' && depthM < 20) return depthM.toFixed(1);
  return Math.round(depthM).toString();
}
function shouldRenderDepth(pointCount) {
  if (pointCount > 400) return { render: false, hint: 'Perbesar untuk melihat kedalaman' };
  return { render: true, hint: null };
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

const failures = [];
function eq(name, actual, expected) {
  const aJson = JSON.stringify(actual);
  const eJson = JSON.stringify(expected);
  if (aJson !== eJson) failures.push(`FAIL [${name}]: got ${aJson}, expected ${eJson}`);
}

eq('snap 5.1234 to 30"', snapToGrid(5.1234, 30), 614 * 30 / 3600);
eq('snap -6.4567 to 60"', snapToGrid(-6.4567, 60), -388 * 60 / 3600);
eq('snap 106.8 to 5′', snapToGrid(106.8, 300), 1281 * 300 / 3600);
eq('snap 0 to 60"', snapToGrid(0, 60), 0);
eq('snap with 0 interval returns input', snapToGrid(5.5, 0), 5.5);

eq('choose 1° at 100px/deg sedang', chooseGridInterval(100, 'sedang', 'OPENTOPO_GEBCO').sec, 3600);
eq('choose 1° fallback at 50px/deg', chooseGridInterval(50, 'sedang', 'OPENTOPO_GEBCO').sec, 3600);
eq('choose 30′ at 200px/deg sedang', chooseGridInterval(200, 'sedang', 'OPENTOPO_GEBCO').sec, 1800);
eq('choose 1′ at 5000px/deg rapat', chooseGridInterval(5000, 'rapat', 'OPENTOPO_GEBCO').sec, 60);
eq('choose 1° at 80px/deg sedang', chooseGridInterval(80, 'sedang', 'OPENTOPO_GEBCO').sec, 3600);
eq('choose 1° at 90px/deg sedang', chooseGridInterval(90, 'sedang', 'OPENTOPO_GEBCO').sec, 3600);
eq('choose 1° at 75px/deg rapat', chooseGridInterval(75, 'rapat', 'OPENTOPO_GEBCO').sec, 3600);
eq('choose 1° fallback at 100px/deg jarang', chooseGridInterval(100, 'jarang', 'OPENTOPO_GEBCO').sec, 3600);
eq('choose 1° at 120px/deg jarang', chooseGridInterval(120, 'jarang', 'OPENTOPO_GEBCO').sec, 3600);
eq('choose 30′ at 500px/deg jarang', chooseGridInterval(500, 'jarang', 'OPENTOPO_GEBCO').sec, 1800);
eq('choose 5′ at 2000px/deg sedang', chooseGridInterval(2000, 'sedang', 'OPENTOPO_GEBCO').sec, 300);
eq('choose 1′ at 10000px/deg sedang', chooseGridInterval(10000, 'sedang', 'OPENTOPO_GEBCO').sec, 60);
eq('choose 15″ at 20000px/deg rapat BATNAS', chooseGridInterval(20000, 'rapat', 'BATNAS_COG').sec, 15);
eq('choose 15″ at 20000px/deg rapat GEBCO', chooseGridInterval(20000, 'rapat', 'GEBCO_COG').sec, 15);
eq('choose 1′ at 5000px/deg rapat BATNAS', chooseGridInterval(5000, 'rapat', 'BATNAS_COG').sec, 60);

eq('depth 0 returns null', formatDepth(0, 'OPENTOPO_GEBCO'), null);
eq('depth +5 returns null', formatDepth(5, 'OPENTOPO_GEBCO'), null);
eq('depth -5 GEBCO integer', formatDepth(-5, 'OPENTOPO_GEBCO'), '5');
eq('depth -25 GEBCO integer', formatDepth(-25, 'OPENTOPO_GEBCO'), '25');
eq('depth -1234 GEBCO integer', formatDepth(-1234, 'OPENTOPO_GEBCO'), '1234');
eq('depth -5 BATNAS <20m → 1 decimal', formatDepth(-5, 'BATNAS_COG'), '5.0');
eq('depth -12.4 BATNAS <20m → 1 decimal', formatDepth(-12.4, 'BATNAS_COG'), '12.4');
eq('depth -19.99 BATNAS <20m → 1 decimal', formatDepth(-19.99, 'BATNAS_COG'), '20.0');
eq('depth -20 BATNAS >=20m → integer', formatDepth(-20, 'BATNAS_COG'), '20');
eq('depth -25 BATNAS >=20m → integer', formatDepth(-25, 'BATNAS_COG'), '25');
eq('depth -5 NONE integer', formatDepth(-5, 'NONE'), '5');

eq('render 100 points OK', shouldRenderDepth(100), { render: true, hint: null });
eq('render 400 points OK', shouldRenderDepth(400), { render: true, hint: null });
eq('render 401 points suppressed', shouldRenderDepth(401), { render: false, hint: 'Perbesar untuk melihat kedalaman' });
eq('render 1000 points suppressed', shouldRenderDepth(1000), { render: false, hint: 'Perbesar untuk melihat kedalaman' });

const pts1 = enumerateGridPoints(-1, 1, -1, 1, 3600);
eq('enumerate 1° grid 2×2 viewport', pts1.length, 9);
eq('first grid point is south-west corner', pts1[0], { lat: -1, lng: -1 });
eq('center grid point is origin', pts1[4], { lat: 0, lng: 0 });
eq('last grid point is north-east corner', pts1[8], { lat: 1, lng: 1 });

const pts2 = enumerateGridPoints(0, 0.0084, 0, 0.0084, 30);
eq('enumerate 30" grid 4 points', pts2.length, 4);
eq('30" first point', pts2[0], { lat: 0, lng: 0 });
eq('30" last point', pts2[3], { lat: 30 / 3600, lng: 30 / 3600 });

eq('enumerate empty viewport', enumerateGridPoints(10, 5, 0, 0, 60).length, 0);

const pts3 = enumerateGridPoints(-89, -84, 0, 1, 3600);
eq('clamp south to -85 then enumerate', pts3.length, 4);
eq('clamped south point lat=-85', pts3[0].lat, -85);

if (failures.length === 0) {
  console.log(`depthLabels tests: all passed (36 cases)`);
} else {
  console.log(`depthLabels tests: ${failures.length} failures`);
  for (const f of failures) console.error(f);
  process.exit(1);
}
