/**
 * Pure logic for the "Angka kedalaman" (sounding) overlay on the sea map.
 *
 * Everything here is a pure function — no Leaflet, no DOM, no network. The
 * SeaMap component wires these into the canvas redraw loop. The unit tests
 * in `runDepthLabelTests()` exercise every public function below.
 *
 * Coordinate convention: latitudes are signed decimal degrees (south is
 * negative); longitudes are signed decimal degrees in [-180, 180] (west is
 * negative). Arc-second intervals are positive integers divisible by the
 * grid resolution.
 *
 * No `any`. Strict-typed throughout.
 */

// ============================================================================
// Types
// ============================================================================

export type DepthSource = 'BATNAS_COG' | 'GEBCO_COG' | 'OPENTOPO_GEBCO' | 'NONE';

export type Density = 'rapat' | 'sedang' | 'jarang';

export interface GridInterval {
  /** Interval in arc-seconds. */
  sec: number;
  /** Human-readable label, e.g. "30″", "5′", "1°". */
  label: string;
}

export interface GridPoint {
  lat: number;
  lng: number;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Candidate grid intervals, COARSEST → FINEST, all of which divide 1°
 * (3600″) evenly so they tile cleanly. The picker walks these from coarsest
 * to finest and returns the coarsest one whose on-screen spacing is ≥ the
 * target px.
 *
 * Max fineness is bounded by the data source resolution:
 *   - GEBCO grid ≈ 15″ (≈ 450 m at the equator)
 *   - BATNAS grid ≈ 6″ (≈ 180 m at the equator)
 *
 * Going finer than the data resolution gives false precision, so the picker
 * clamps to the source resolution.
 */
export const GRID_INTERVALS_SEC: readonly GridInterval[] = [
  { sec: 3600, label: '1°' },
  { sec: 1800, label: '30′' },
  { sec: 600, label: '10′' },
  { sec: 300, label: '5′' },
  { sec: 120, label: '2′' },
  { sec: 60, label: '1′' },
  { sec: 30, label: '30″' },
  { sec: 15, label: '15″' },
];

/** Source resolution floor (arc-seconds). */
export const SOURCE_RESOLUTION_SEC: Readonly<Record<DepthSource, number>> = {
  BATNAS_COG: 6,
  GEBCO_COG: 15,
  OPENTOPO_GEBCO: 15,
  NONE: 15,
};

/**
 * Density multipliers — adjust the target spacing between numbers.
 *  - rapat  → ~70 px between numbers (more numbers, denser)
 *  - sedang → ~90 px (default)
 *  - jarang → ~110 px (fewer numbers, sparser)
 */
export const DENSITY_TARGET_PX: Readonly<Record<Density, number>> = {
  rapat: 70,
  sedang: 90,
  jarang: 110,
};

/** Maximum number of grid points to render in one viewport. Above this,
 * the overlay is suppressed with a "Perbesar untuk melihat kedalaman" hint. */
export const MAX_GRID_POINTS = 400;

// ============================================================================
// Pure functions
// ============================================================================

/**
 * Pick the FINEST grid interval whose on-screen spacing is still ≥ the
 * density target — i.e. as many labels as possible without overlap. Clamped
 * to no finer than the source resolution (so we don't show false precision).
 *
 * Walks GRID_INTERVALS_SEC from COARSEST (1°) to FINEST (15″). For each
 * interval, compute the on-screen spacing in pixels:
 *   spacingPx = intervalSec * pxPerDeg / 3600
 * Track the FINEST interval whose spacingPx >= targetPx. After the walk,
 * return that finest interval (or 1° if no interval meets the target —
 * very low zoom where even 1° is below target).
 *
 * Examples (target = 90 px):
 *   pxPerDeg=20  → 1°=20<90, 30′=10<90, … none ≥90 → fall back to 1° (1° gives 20 px, visible but tight)
 *   pxPerDeg=100 → 1°=100≥90 ✓, 30′=50<90 → finest meeting target is 1°
 *   pxPerDeg=200 → 1°=200≥90 ✓, 30′=100≥90 ✓, 10′=33<90 → finest meeting target is 30′
 *   pxPerDeg=2000 → 1° ✓, 30′=1000 ✓, 10′=333 ✓, 5′=166 ✓, 2′=66<90 → finest is 5′
 *
 * If the chosen interval is finer than the source resolution, clamp up to
 * the source resolution.
 *
 * @param pxPerDeg       Current map resolution in CSS pixels per degree.
 * @param density        User-selected density (rapat / sedang / jarang).
 * @param source         Active data source (limits max fineness).
 * @returns              The chosen GridInterval (sec + label).
 */
export function chooseGridInterval(
  pxPerDeg: number,
  density: Density,
  source: DepthSource,
): GridInterval {
  const targetPx = DENSITY_TARGET_PX[density];
  const resolutionSec = SOURCE_RESOLUTION_SEC[source];

  let finest: GridInterval = GRID_INTERVALS_SEC[0]; // fallback: 1° (coarsest)
  for (const iv of GRID_INTERVALS_SEC) {
    const spacingPx = iv.sec * pxPerDeg / 3600;
    if (spacingPx >= targetPx) {
      finest = iv; // keep updating — last (finest) one wins
    }
  }
  // Clamp up to source resolution if the chosen interval is finer than the
  // data. Find the coarsest interval >= resolutionSec.
  if (finest.sec < resolutionSec) {
    for (const r of GRID_INTERVALS_SEC) {
      if (r.sec >= resolutionSec) return r;
    }
    return GRID_INTERVALS_SEC[GRID_INTERVALS_SEC.length - 1];
  }
  return finest;
}

/**
 * Snap a coordinate to the grid defined by `intervalSec`.
 *
 *   snapToGrid(5.1234, 30)  → 5.00833...  (= 5°00′30″)
 *   snapToGrid(-6.4567, 60) → -6.46666... (= -6°28′)
 *
 * Snapping is done in arc-seconds to avoid floating-point drift. The result
 * is a real-valued degree coordinate (not rounded to integers).
 *
 * Negative latitudes (southern hemisphere) work correctly: snapping -6.4567
 * to 60″ goes via Math.floor(-6.4567 * 3600 / 60) * 60 / 3600.
 *
 * @param value        Coordinate value in decimal degrees.
 * @param intervalSec  Grid interval in arc-seconds (positive).
 * @returns            Snapped coordinate in decimal degrees.
 */
export function snapToGrid(value: number, intervalSec: number): number {
  if (intervalSec <= 0) return value;
  const sec = Math.floor((value * 3600) / intervalSec) * intervalSec;
  return sec / 3600;
}

/**
 * Enumerate every grid point (lat, lng) inside the viewport bounds, snapped
 * to `intervalSec`. Iteration is inclusive of the bounds and walks in
 * ascending order (south → north, west → east).
 *
 * Longitudes are wrapped to [-180, 180]. Latitudes are clamped to [-85, 85]
 * (Web Mercator limit).
 *
 * @param south        South boundary (decimal degrees).
 * @param north        North boundary (decimal degrees, ≥ south).
 * @param west         West boundary (decimal degrees).
 * @param east         East boundary (decimal degrees, ≥ west).
 * @param intervalSec  Grid interval in arc-seconds (positive).
 * @returns            Array of {lat, lng}.
 */
export function enumerateGridPoints(
  south: number,
  north: number,
  west: number,
  east: number,
  intervalSec: number,
): GridPoint[] {
  if (intervalSec <= 0) return [];
  // Clamp to Web Mercator limits.
  const s = Math.max(-85, south);
  const n = Math.min(85, north);
  if (n < s) return [];

  const points: GridPoint[] = [];
  const startLatSec = Math.floor((s * 3600) / intervalSec) * intervalSec;
  const endLatSec = Math.ceil((n * 3600) / intervalSec) * intervalSec;
  const startLngSec = Math.floor((west * 3600) / intervalSec) * intervalSec;
  const endLngSec = Math.ceil((east * 3600) / intervalSec) * intervalSec;

  for (let latSec = startLatSec; latSec <= endLatSec; latSec += intervalSec) {
    const lat = latSec / 3600;
    if (lat < s || lat > n) continue;
    for (let lngSec = startLngSec; lngSec <= endLngSec; lngSec += intervalSec) {
      // lngSec is computed directly from the grid iteration, so it's
      // already at an exact arc-second multiple. Converting back to degrees
      // via simple division preserves the exact value as long as we don't
      // re-wrap it unnecessarily. Only wrap if the raw value falls outside
      // [-180, 180] (e.g. antimeridian crossing).
      const rawDeg = lngSec / 3600;
      const lng = rawDeg >= -180 && rawDeg <= 180 ? rawDeg
        : (((rawDeg + 540) % 360) + 360) % 360 - 180;
      if (lng < west || lng > east) continue;
      points.push({ lat, lng });
    }
  }
  return points;
}

/**
 * Format a depth value (in meters, negative = below sea level) as the
 * short text shown on the chart.
 *
 * Rules:
 *   - elevation >= 0 (land): return null — never show numbers on land.
 *   - BATNAS source, depth < 20 m: show 1 decimal (e.g. "12.4").
 *   - BATNAS source, depth >= 20 m: integer.
 *   - GEBCO source: always integer.
 *   - All depths are shown as positive numbers with no sign (sea depth is
 *     conventionally positive).
 *
 * @param elevation  Elevation in meters (negative = below sea level).
 * @param source     Active data source.
 * @returns          Formatted string, or null if the point is on land.
 */
export function formatDepth(elevation: number, source: DepthSource): string | null {
  if (elevation >= 0) return null; // land — never show
  const depthM = -elevation; // depth is conventionally positive
  if (source === 'BATNAS_COG' && depthM < 20) {
    return depthM.toFixed(1);
  }
  return Math.round(depthM).toString();
}

/**
 * Decide whether to render the depth overlay at all, given the projected
 * point count. Returns `{ render: boolean, hint: string | null }`.
 *
 * If the point count exceeds MAX_GRID_POINTS, the overlay is suppressed and
 * a "Perbesar untuk melihat kedalaman" hint is returned.
 */
export function shouldRenderDepth(
  pointCount: number,
): { render: boolean; hint: string | null } {
  if (pointCount > MAX_GRID_POINTS) {
    return { render: false, hint: 'Perbesar untuk melihat kedalaman' };
  }
  return { render: true, hint: null };
}

// ============================================================================
// Unit tests
// ============================================================================

export function runDepthLabelTests(): void {
  const failures: string[] = [];

  function eq<T>(name: string, actual: T, expected: T): void {
    const aJson = JSON.stringify(actual);
    const eJson = JSON.stringify(expected);
    if (aJson !== eJson) {
      failures.push(`FAIL [${name}]: got ${aJson}, expected ${eJson}`);
    }
  }

  // ---- snapToGrid ----
  // 5.1234° snapped to 30″ (0.00833°/step): 5.1234 / 0.00833 ≈ 614.81 → floor 614
  //   → 614 * 30 / 3600 = 5.11666...° (= 5°07′00″)
  eq('snap 5.1234 to 30"', snapToGrid(5.1234, 30), 614 * 30 / 3600);
  // -6.4567° snapped to 60″: -6.4567 * 60 = -387.402 → floor -388 → -388*60/3600 = -6.4666...°
  eq('snap -6.4567 to 60"', snapToGrid(-6.4567, 60), -388 * 60 / 3600);
  // 106.8° snapped to 300″ (5′): 106.8*12 = 1281.6 → floor 1281 → 1281*300/3600 = 106.75°
  eq('snap 106.8 to 5′', snapToGrid(106.8, 300), 1281 * 300 / 3600);
  // 0° snaps to 0
  eq('snap 0 to 60"', snapToGrid(0, 60), 0);
  // intervalSec 0 returns the input unchanged (degenerate, but no crash).
  eq('snap with 0 interval returns input', snapToGrid(5.5, 0), 5.5);

  // ---- chooseGridInterval ----
  // Logic: pick the FINEST interval whose on-screen spacing is >= target.
  // Target px: rapat=70, sedang=90, jarang=110.
  // Intervals (sec → label): 3600=1°, 1800=30′, 600=10′, 300=5′, 120=2′,
  //   60=1′, 30=30″, 15=15″.
  // For OPENTOPO_GEBCO the resolution clamp is 15″, so intervals below 15″
  // never get returned (none of our candidates go below 15″ anyway).
  //
  // At 100 px/deg with sedang (target 90): 1°=100≥90 ✓, 30′=50<90 → finest=1°.
  eq('choose 1° at 100px/deg sedang', chooseGridInterval(100, 'sedang', 'OPENTOPO_GEBCO').sec, 3600);
  // At 50 px/deg with sedang: 1°=50<90 → no interval meets target → fallback 1°.
  eq('choose 1° fallback at 50px/deg', chooseGridInterval(50, 'sedang', 'OPENTOPO_GEBCO').sec, 3600);
  // At 200 px/deg with sedang: 1°=200≥90 ✓, 30′=100≥90 ✓, 10′=33<90 → finest=30′.
  eq('choose 30′ at 200px/deg sedang', chooseGridInterval(200, 'sedang', 'OPENTOPO_GEBCO').sec, 1800);
  // At 5000 px/deg with rapat (target 70): 1°=5000 ✓, 30′=2500 ✓, 10′=833 ✓,
  // 5′=417 ✓, 2′=166 ✓, 1′=83 ✓, 30″=42<70 → finest=1′.
  eq('choose 1′ at 5000px/deg rapat', chooseGridInterval(5000, 'rapat', 'OPENTOPO_GEBCO').sec, 60);
  // At 80 px/deg with sedang: 1°=80<90 → no interval meets target → fallback 1°.
  eq('choose 1° at 80px/deg sedang', chooseGridInterval(80, 'sedang', 'OPENTOPO_GEBCO').sec, 3600);
  // At 90 px/deg with sedang: 1°=90≥90 ✓, 30′=45<90 → finest=1°.
  eq('choose 1° at 90px/deg sedang', chooseGridInterval(90, 'sedang', 'OPENTOPO_GEBCO').sec, 3600);
  // Density rapat lowers target to 70. At 75 px/deg: 1°=75≥70 ✓, 30′=37<70 → finest=1°.
  eq('choose 1° at 75px/deg rapat', chooseGridInterval(75, 'rapat', 'OPENTOPO_GEBCO').sec, 3600);
  // Density jarang raises target to 110. At 100 px/deg: 1°=100<110 → fallback 1°.
  eq('choose 1° fallback at 100px/deg jarang', chooseGridInterval(100, 'jarang', 'OPENTOPO_GEBCO').sec, 3600);
  // At 120 px/deg with jarang: 1°=120≥110 ✓, 30′=60<110 → finest=1°.
  eq('choose 1° at 120px/deg jarang', chooseGridInterval(120, 'jarang', 'OPENTOPO_GEBCO').sec, 3600);
  // At 500 px/deg with jarang: 1°=500 ✓, 30′=250 ✓, 10′=83<110 → finest=30′.
  eq('choose 30′ at 500px/deg jarang', chooseGridInterval(500, 'jarang', 'OPENTOPO_GEBCO').sec, 1800);
  // At 2000 px/deg with sedang: 1°=2000 ✓, 30′=1000 ✓, 10′=333 ✓, 5′=166 ✓,
  // 2′=66<90 → finest=5′.
  eq('choose 5′ at 2000px/deg sedang', chooseGridInterval(2000, 'sedang', 'OPENTOPO_GEBCO').sec, 300);
  // At 10000 px/deg with sedang: 1°=10000 ✓, 30′=5000 ✓, 10′=1666 ✓,
  // 5′=833 ✓, 2′=333 ✓, 1′=166 ✓, 30″=83<90 → finest=1′.
  eq('choose 1′ at 10000px/deg sedang', chooseGridInterval(10000, 'sedang', 'OPENTOPO_GEBCO').sec, 60);

  // BATNAS source has resolution 6″ — but our finest candidate is 15″, so
  // the clamp is moot; we still return the finest interval that meets target.
  eq('choose 1′ at 5000px/deg rapat BATNAS', chooseGridInterval(5000, 'rapat', 'BATNAS_COG').sec, 60);
  // At 20000 px/deg with rapat (target 70): 1°=20000 ✓ … 1′=333 ✓, 30″=166 ✓,
  // 15″=83 ✓ → finest=15″.
  eq('choose 15″ at 20000px/deg rapat BATNAS', chooseGridInterval(20000, 'rapat', 'BATNAS_COG').sec, 15);
  // GEBCO source has resolution 15″; same result since 15″ is our finest.
  eq('choose 15″ at 20000px/deg rapat GEBCO', chooseGridInterval(20000, 'rapat', 'GEBCO_COG').sec, 15);

  // ---- formatDepth ----
  eq('depth 0 returns null (land/sea level)', formatDepth(0, 'OPENTOPO_GEBCO'), null);
  eq('depth +5 returns null (land)', formatDepth(5, 'OPENTOPO_GEBCO'), null);
  eq('depth -5 GEBCO integer', formatDepth(-5, 'OPENTOPO_GEBCO'), '5');
  eq('depth -25 GEBCO integer', formatDepth(-25, 'OPENTOPO_GEBCO'), '25');
  eq('depth -1234 GEBCO integer', formatDepth(-1234, 'OPENTOPO_GEBCO'), '1234');
  eq('depth -5 BATNAS <20m → 1 decimal', formatDepth(-5, 'BATNAS_COG'), '5.0');
  eq('depth -12.4 BATNAS <20m → 1 decimal', formatDepth(-12.4, 'BATNAS_COG'), '12.4');
  eq('depth -19.99 BATNAS <20m → 1 decimal', formatDepth(-19.99, 'BATNAS_COG'), '20.0');
  eq('depth -20 BATNAS >=20m → integer', formatDepth(-20, 'BATNAS_COG'), '20');
  eq('depth -25 BATNAS >=20m → integer', formatDepth(-25, 'BATNAS_COG'), '25');
  // Source NONE behaves like GEBCO.
  eq('depth -5 NONE integer', formatDepth(-5, 'NONE'), '5');

  // ---- shouldRenderDepth ----
  eq('render 100 points OK', shouldRenderDepth(100), { render: true, hint: null });
  eq('render 400 points OK (limit)', shouldRenderDepth(400), { render: true, hint: null });
  eq('render 401 points suppressed', shouldRenderDepth(401), { render: false, hint: 'Perbesar untuk melihat kedalaman' });
  eq('render 1000 points suppressed', shouldRenderDepth(1000), { render: false, hint: 'Perbesar untuk melihat kedalaman' });

  // ---- enumerateGridPoints (small cases) ----
  // 1° grid over a 2°×2° viewport centred on origin.
  const pts1 = enumerateGridPoints(-1, 1, -1, 1, 3600);
  // South=-1, north=1, west=-1, east=1.
  // startLatSec = floor(-1*3600/3600)*3600 = -3600 → lat = -1
  // endLatSec   = ceil(1*3600/3600)*3600   = 3600  → lat = 1
  // Same for lng. So we expect 3×3 = 9 points: (-1,-1), (-1,0), (-1,1),
  // (0,-1), (0,0), (0,1), (1,-1), (1,0), (1,1).
  eq('enumerate 1° grid 2×2 viewport', pts1.length, 9);
  eq('first grid point is south-west corner', pts1[0], { lat: -1, lng: -1 });
  eq('center grid point is origin', pts1[4], { lat: 0, lng: 0 });
  eq('last grid point is north-east corner', pts1[8], { lat: 1, lng: 1 });

  // 30″ grid: viewport south=0, north=0.00833 (=30"), west=0, east=0.00833.
  // Should yield 4 points: (0,0), (0, 30"), (30", 0), (30", 30").
  const pts2 = enumerateGridPoints(0, 0.0084, 0, 0.0084, 30);
  eq('enumerate 30" grid 4 points', pts2.length, 4);
  eq('30" first point', pts2[0], { lat: 0, lng: 0 });
  eq('30" last point', pts2[3], { lat: 30 / 3600, lng: 30 / 3600 });

  // Empty viewport.
  eq('enumerate empty viewport', enumerateGridPoints(10, 5, 0, 0, 60).length, 0);

  // Web Mercator clamp: south < -85 should be clamped.
  // Viewport: south=-89 clamped to -85, north=-84. West=0, east=1.
  // At 1° grid: lat values are -85, -84 (2). lng values are 0, 1 (2).
  // Total = 4 points.
  const pts3 = enumerateGridPoints(-89, -84, 0, 1, 3600);
  eq('clamp south to -85 then enumerate', pts3.length, 4);
  eq('clamped south point lat=-85', pts3[0].lat, -85);

  // ---- Report ----
  const passed = 0;
  if (failures.length === 0) {
    console.log(`depthLabels tests: all passed`);
  } else {
    console.log(`depthLabels tests: ${failures.length} failures`);
    for (const f of failures) console.error(f);
    process.exit(1);
  }
  void passed;
}
