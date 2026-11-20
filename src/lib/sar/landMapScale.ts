/**
 * landMapScale — logika murni kontrol skala peta darat Worksheet 4.
 *
 * Skala cetak 1:25.000 (N konfigurabel): 1.000 m di peta = 40 mm tercetak.
 *   mmPerPx            = 25.4 / DPI            (DPI default 96)
 *   meterPerPixelTarget= N · mmPerPx / 1000
 *   zoomTarget         = log2(156543.03392 · cos(lat) / meterPerPixelTarget)
 *   lebar segmen (px)  = jarak / meterPerPixelAktual
 *
 * Kalibrasi layar (DPI) disimpan di localStorage. Mode "Skala cetak" mengunci
 * zoom ke zoomTarget (zoom pecahan diizinkan); mode bebas menampilkan
 * "SKALA ± 1:N" dengan N dibulatkan ke tangga skala lazim.
 */

export const PRINT_SCALE_N = 25000;
export const DEFAULT_DPI = 96;
/** Meter Web Mercator per derajat longitud di ekuator pada zoom 0. */
export const WEB_MERCATOR_M_PER_PX_Z0 = 156543.03392;

export interface LandMapCalibration {
  dpi?: number;
  printMode?: boolean;
}

export const CALIBRATION_KEY = 'sar-land-map-calibration-v1';

/** mm fisik per piksel layar pada DPI tertentu. */
export function mmPerPx(dpi: number = DEFAULT_DPI): number {
  return 25.4 / Math.max(24, dpi);
}

/** Meter nyata per piksel agar skala 1:N tercapai. */
export function meterPerPixelTarget(n: number = PRINT_SCALE_N, dpi: number = DEFAULT_DPI): number {
  return (n * mmPerPx(dpi)) / 1000;
}

/** Zoom Web Mercator (bisa pecahan) tempat skala 1:N tercapai pada lintang. */
export function zoomTargetForScale(lat: number, n: number = PRINT_SCALE_N, dpi: number = DEFAULT_DPI): number {
  const target = meterPerPixelTarget(n, dpi);
  const mPerPxZ0 = WEB_MERCATOR_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180);
  return Math.log2(mPerPxZ0 / target);
}

/** Skala denominasi aktual saat ini (≈ 1:N). */
export function scaleDenominatorNow(lat: number, zoom: number, dpi: number = DEFAULT_DPI): number {
  const mPerPx = (WEB_MERCATOR_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
  return (mPerPx / mmPerPx(dpi)) * 1000;
}

/** Format ribuan Indonesia: 25000 → "25.000". */
export function formatThousand(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const SCALE_N_LADDER = [250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000];

/** N dibulatkan ke tangga skala lazim untuk label "SKALA ± 1:N" (mode bebas). */
export function roundScaleN(denominator: number): number {
  let best = SCALE_N_LADDER[0];
  let bestDiff = Infinity;
  for (const step of SCALE_N_LADDER) {
    const diff = Math.abs(Math.log10(step) - Math.log10(Math.max(1, denominator)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = step;
    }
  }
  return best;
}

const BAR_QUARTER_M_LADDER = [25, 50, 100, 125, 250, 500, 1000, 1250, 2500, 5000];

/**
 * Panjang seperempat batang (m) untuk mode bebas agar batang 4a ≈ 56–160 px.
 * Mode cetak memakai a = 250 m (batang 1.000 m tetap).
 */
export function pickBarQuarterM(metersPerPx: number, printMode: boolean): number {
  if (printMode) return 250;
  let best = BAR_QUARTER_M_LADDER[0];
  let bestDiff = Infinity;
  for (const quarter of BAR_QUARTER_M_LADDER) {
    const px = (quarter * 4) / metersPerPx;
    const diff = Math.abs(px - 100);
    if (px >= 56 && px <= 160 && diff < bestDiff) {
      bestDiff = diff;
      best = quarter;
    }
  }
  if (bestDiff === Infinity) {
    // Di luar rentang: pilih terdekat ke target 100 px.
    let nearest = BAR_QUARTER_M_LADDER[0];
    let nearestDiff = Infinity;
    for (const quarter of BAR_QUARTER_M_LADDER) {
      const diff = Math.abs(((quarter * 4) / metersPerPx) - 100);
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearest = quarter;
      }
    }
    return nearest;
  }
  return best;
}

export interface ScaleSegment {
  fromM: number;
  toM: number;
  dark: boolean;
}

export interface ScaleBarLayout {
  quarterM: number;
  segments: ScaleSegment[];
  labels: Array<{ meters: number; suffix: boolean }>;
  /** Lebar total batang dalam piksel pada metersPerPx aktual. */
  widthPx: number;
  /** Lebar total batang dalam mm pada skala cetak (a=250 m, N=25.000 → 40 mm). */
  widthMm: number;
}

/**
 * Susunan batang tiga segmen hitam-putih: 0–a hitam, a–2a putih, 2a–4a hitam
 * (segmen ketiga dua kali lebih panjang). Label bawah: 0, a, 2a, 4a M.
 */
export function buildScaleBar(quarterM: number, metersPerPx: number, n: number = PRINT_SCALE_N): ScaleBarLayout {
  const q = Math.max(1, quarterM);
  return {
    quarterM: q,
    segments: [
      { fromM: 0, toM: q, dark: true },
      { fromM: q, toM: q * 2, dark: false },
      { fromM: q * 2, toM: q * 4, dark: true },
    ],
    labels: [
      { meters: 0, suffix: false },
      { meters: q, suffix: false },
      { meters: q * 2, suffix: false },
      { meters: q * 4, suffix: true },
    ],
    widthPx: (q * 4) / metersPerPx,
    widthMm: (q * 4) / (n / 1000),
  };
}

// ---------------------------------------------------------------------------
// Kalibrasi localStorage (aman untuk SSR — tanpa window tidak melakukan apa-apa).
// ---------------------------------------------------------------------------

export function readCalibration(storage?: Storage | null): LandMapCalibration {
  if (!storage) return {};
  try {
    const raw = storage.getItem(CALIBRATION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LandMapCalibration;
    return {
      dpi: typeof parsed.dpi === 'number' && parsed.dpi >= 24 && parsed.dpi <= 480 ? parsed.dpi : undefined,
      printMode: typeof parsed.printMode === 'boolean' ? parsed.printMode : undefined,
    };
  } catch {
    return {};
  }
}

export function writeCalibration(storage: Storage | null | undefined, calibration: LandMapCalibration): void {
  if (!storage) return;
  try {
    storage.setItem(CALIBRATION_KEY, JSON.stringify(calibration));
  } catch {
    // storage penuh / diblokir — abaikan.
  }
}
