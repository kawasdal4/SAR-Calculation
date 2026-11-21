/**
 * Kalibrasi georeferensi peta hasil scan (murni, tanpa dependensi DOM).
 *
 * Pengguna menandai ≥2 titik pada gambar scan dan memasukkan koordinat
 * geografisnya; modul ini membangun transformasi gambar↔geografi:
 *  - 2 titik  : similarity (skala seragam + rotasi + translasi) — cukup untuk
 *               scan yang rapi; rotasi scan kecil ikut teratasi.
 *  - ≥3 titik : affine least-squares (skala, rotasi, shear, translasi) —
 *               mengoreksi scan yang sedikit melar/miring.
 *
 * Kerangka kerja: koordinat geografis dipetakan ke bidang LOKAL (meter,
 * equirectangular pada lintang rata-rata titik kalibrasi) sehingga skala
 * px/meter stabil pada luas satu lembar peta; transformasi mencari peta
 * linear meter→pixel. Rotasi peta (utara ke atas) TIDAK dipaksakan — hasil
 * pola pencarian tetap akurat meski scan miring.
 */

import type { LatLng } from './sarCalculations';

export interface CalibrationPoint {
  id: string;
  /** Posisi klik pada gambar ASLI (px, origin kiri-atas). */
  px: { x: number; y: number };
  pos: LatLng;
  label?: string;
}

// ---------------------------------------------------------------------------
// Lat/lon ⇄ meter lokal (equirectangular pada lintang rata-rata)
// ---------------------------------------------------------------------------

/** Meter per derajat lintang pada φ (derajat). */
export function metersPerDegLat(latDeg: number): number {
  const phi = (latDeg * Math.PI) / 180;
  return 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
}

/** Meter per derajat bujur pada φ (derajat). */
export function metersPerDegLng(latDeg: number): number {
  const phi = (latDeg * Math.PI) / 180;
  return 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi) + 0.118 * Math.cos(5 * phi);
}

export interface LocalOrigin {
  lat: number;
  lng: number;
  mPerDegLat: number;
  mPerDegLng: number;
}

export function localOriginFor(points: LatLng[]): LocalOrigin {
  const lat = points.reduce((s, p) => s + p.lat, 0) / Math.max(points.length, 1);
  return { lat, lng: points.reduce((s, p) => s + p.lng, 0) / Math.max(points.length, 1), mPerDegLat: metersPerDegLat(lat), mPerDegLng: metersPerDegLng(lat) };
}

/** lat/lon → meter lokal (x = timur, y = utara) relatif origin. */
export function geoToLocalMeters(pos: LatLng, origin: LocalOrigin): { x: number; y: number } {
  return {
    x: (pos.lng - origin.lng) * origin.mPerDegLng,
    y: (pos.lat - origin.lat) * origin.mPerDegLat,
  };
}

/** meter lokal → lat/lon. */
export function localMetersToGeo(x: number, y: number, origin: LocalOrigin): LatLng {
  return {
    lat: origin.lat + y / origin.mPerDegLat,
    lng: origin.lng + x / origin.mPerDegLng,
  };
}

// ---------------------------------------------------------------------------
// Transformasi meter lokal → pixel gambar
// ---------------------------------------------------------------------------

export interface LinearMap2D {
  /** px_x = a*m.x + b*m.y + tx ; px_y = c*m.x + d*m.y + ty */
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

function applyLinear(m: LinearMap2D, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.b * y + m.tx, y: m.c * x + m.d * y + m.ty };
}

function invertLinear(m: LinearMap2D): LinearMap2D | null {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-12) return null;
  // Invers matriks 2×2 lalu translasi balik.
  const ia = m.d / det;
  const ib = -m.b / det;
  const ic = -m.c / det;
  const id = m.a / det;
  return { a: ia, b: ib, c: ic, d: id, tx: -(ia * m.tx + ib * m.ty), ty: -(ic * m.tx + id * m.ty) };
}

/** Selesaikan LSQ 3-unknown (β = (XᵀX)⁻¹ Xᵀy) via eliminasi Gauss 3×3. */
function solve3(xtx: number[][], xty: number[]): number[] | null {
  const n = 3;
  const m: number[][] = [
    [xtx[0][0], xtx[0][1], xtx[0][2], xty[0]],
    [xtx[1][0], xtx[1][1], xtx[1][2], xty[1]],
    [xtx[2][0], xtx[2][1], xtx[2][2], xty[2]],
  ];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k++) m[row][k] -= factor * m[col][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

/** Affine least-squares meter→px (≥3 titik, toleransi collinear via LSQ). */
function fitAffine(
  meters: Array<{ x: number; y: number }>,
  pixels: Array<{ x: number; y: number }>,
): LinearMap2D | null {
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sx1 = 0;
  let sy1 = 0;
  let s1 = 0;
  let bxX = 0;
  let bxY = 0;
  let bx1 = 0;
  let byX = 0;
  let byY = 0;
  let by1 = 0;
  for (let i = 0; i < meters.length; i++) {
    const { x, y } = meters[i];
    const { x: px, y: py } = pixels[i];
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sx1 += x;
    sy1 += y;
    s1 += 1;
    bxX += x * px;
    bxY += y * px;
    bx1 += px;
    byX += x * py;
    byY += y * py;
    by1 += py;
  }
  const xtx = [
    [sxx, sxy, sx1],
    [sxy, syy, sy1],
    [sx1, sy1, s1],
  ];
  const betaX = solve3(xtx, [bxX, bxY, bx1]);
  const betaY = solve3(xtx, [byX, byY, by1]);
  if (!betaX || !betaY) return null;
  return { a: betaX[0], b: betaX[1], tx: betaX[2], c: betaY[0], d: betaY[1], ty: betaY[2] };
}

export interface ScanTransform {
  kind: 'similarity' | 'affine';
  /** Peta linear meter lokal → pixel gambar asli. */
  metersToPx: LinearMap2D;
  origin: LocalOrigin;
  /** Skala rata-rata (pixel per meter) — untuk radius lingkaran dsb. */
  pxPerMeter: number;
  toPixel(pos: LatLng): { x: number; y: number };
  toGeo(px: { x: number; y: number }): LatLng;
}

export interface BuildScanTransformResult {
  transform: ScanTransform | null;
  /** Sisa galat tiap titik kalibrasi (px) — tampil di UI sebagai umpan balik. */
  residualsPx: Array<{ id: string; label?: string; residualPx: number }>;
  /** RMS residual (px); null bila transformasi gagal. */
  rmsPx: number | null;
  error: string | null;
}

function finalize(
  metersToPx: LinearMap2D,
  origin: LocalOrigin,
  kind: ScanTransform['kind'],
  points: CalibrationPoint[],
): BuildScanTransformResult {
  const inverse = invertLinear(metersToPx);
  if (!inverse) {
    return { transform: null, residualsPx: [], rmsPx: null, error: 'Titik kalibrasi collinear / berimpit — pilih titik yang tersebar luas.' };
  }
  const pxPerMeter = kind === 'similarity'
    ? Math.sqrt(metersToPx.a ** 2 + metersToPx.c ** 2)
    : (Math.sqrt(metersToPx.a ** 2 + metersToPx.c ** 2) + Math.sqrt(metersToPx.b ** 2 + metersToPx.d ** 2)) / 2;
  const transform: ScanTransform = {
    kind,
    metersToPx,
    origin,
    pxPerMeter,
    toPixel(pos: LatLng) {
      const m = geoToLocalMeters(pos, origin);
      return applyLinear(metersToPx, m.x, m.y);
    },
    toGeo(px: { x: number; y: number }) {
      const local = applyLinear(inverse, px.x, px.y);
      return localMetersToGeo(local.x, local.y, origin);
    },
  };
  const residualsPx = points.map((point) => {
    const projected = transform.toPixel(point.pos);
    return {
      id: point.id,
      label: point.label,
      residualPx: Math.hypot(projected.x - point.px.x, projected.y - point.px.y),
    };
  });
  const rmsPx = Math.sqrt(residualsPx.reduce((s, r) => s + r.residualPx ** 2, 0) / residualsPx.length);
  return { transform, residualsPx, rmsPx, error: null };
}

/**
 * Bangun transformasi dari titik kalibrasi. ≥3 titik → affine LSQ;
 * tepat 2 → similarity. <2 titik → gagal dengan pesan ramah.
 */
export function buildScanTransform(points: CalibrationPoint[]): BuildScanTransformResult {
  if (points.length < 2) {
    return {
      transform: null,
      residualsPx: points.map((point) => ({ id: point.id, label: point.label, residualPx: 0 })),
      rmsPx: null,
      error: 'Kalibrasi minimal 2 titik (pilih dua titik jelas di peta, mis. perpotongan paralel/garisdatar, dan masukkan koordinatnya).',
    };
  }
  const origin = localOriginFor(points.map((p) => p.pos));
  const meters = points.map((p) => geoToLocalMeters(p.pos, origin));
  const pixels = points.map((p) => p.px);

  if (points.length === 2) {
    const [m1, m2] = meters;
    const [p1, p2] = pixels;
    const dxm = m2.x - m1.x;
    const dym = m2.y - m1.y;
    const dxp = p2.x - p1.x;
    const dyp = p2.y - p1.y;
    const geoDistM = Math.hypot(dxm, dym);
    const pxDist = Math.hypot(dxp, dyp);
    if (geoDistM < 500 || pxDist < 10) {
      return { transform: null, residualsPx: [], rmsPx: null, error: 'Dua titik kalibrasi terlalu berdekatan — pilih titik yang berjauhan (mis. dua sudut peta yang jelas).' };
    }
    const det = dxm * dxm + dym * dym;
    if (det < 1) {
      return { transform: null, residualsPx: [], rmsPx: null, error: 'Dua titik kalibrasi terlalu berdekatan secara geografis — pilih titik yang berjauhan (mis. dua sudut peta).' };
    }
    const a = (dxm * dxp + dym * dyp) / det;
    const b = (dxm * dyp - dym * dxp) / det;
    // Similarity: rotasi seragam — pakai bentuk [[a,-b],[b,a]].
    const metersToPx: LinearMap2D = {
      a,
      b: -b,
      c: b,
      d: a,
      tx: p1.x - (a * m1.x - b * m1.y),
      ty: p1.y - (b * m1.x + a * m1.y),
    };
    return finalize(metersToPx, origin, 'similarity', points);
  }

  const metersToPx = fitAffine(meters, pixels);
  if (!metersToPx) {
    return { transform: null, residualsPx: [], rmsPx: null, error: 'Titik kalibrasi hampir segaris — tambah titik di bagian peta lain.' };
  }
  return finalize(metersToPx, origin, 'affine', points);
}

/** Jarak dua titik gambar dalam px (util UI). */
export function pxDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Konversi klik pada kontainer peta scan (overflow-auto + zoom) → pixel gambar
 * ASLI. Wajib menjumlahkan scrollLeft/scrollTop kontainer: posisi klik terhadap
 * rect kontainer hanya mencakup area yang TERLIHAT, sedangkan gambar besar
 * (tinggi scan > tinggi kontainer) digulir — tanpa offset scroll, titik
 * kalibrasi terekam di posisi yang salah (tergeser sebesar scroll), transform
 * memetakan semua overlay ke lokasi yang keliru/keluar kanvas, dan vektor,
 * search area, serta label tampak "tidak muncul".
 */
export function imagePointFromClick(params: {
  clientX: number;
  clientY: number;
  rectLeft: number;
  rectTop: number;
  scrollLeft: number;
  scrollTop: number;
  /** Pixel tampil (CSS) per pixel gambar asli. */
  scale: number;
}): { x: number; y: number } {
  const { clientX, clientY, rectLeft, rectTop, scrollLeft, scrollTop, scale } = params;
  return {
    x: (clientX - rectLeft + scrollLeft) / scale,
    y: (clientY - rectTop + scrollTop) / scale,
  };
}
