/**
 * Maneuvering Board Polar Plotting Helper
 * Standard Form DMAHTC 5090 / Polar Coordinate System
 */

export interface BoardVector {
  id: string;
  label: string;
  dirDeg: number; // 000° to 359° True
  mag: number; // Magnitude (kts, NM, etc.)
  color: string;
  origin?: { x: number; y: number }; // Defaults to center (0, 0)
  dashed?: boolean;
  /** Override badge di papan (arah/nilai), mis. saat mag diskalakan untuk plotting. */
  badge?: string;
}

export interface BoardPoint {
  id: string;
  label: string;
  x: number;
  y: number;
  color: string;
}

/**
 * Konversi sudut derajat maritim (0° = Utara/Atas, 90° = Timur/Kanan, CW)
 * ke koordinat Kartesius relatif terhadap pusat (0,0) dengan jari-jari R.
 * Math convention: 0° = East, CCW.
 * Maritime: angleRad = (dirDeg - 90) * (PI / 180) -> x = r * sin(dir), y = -r * cos(dir)
 */
export function polarToCartesian(
  dirDeg: number,
  magnitude: number,
  scaleUnitsPerRing: number,
  ringPixelSpacing: number
): { x: number; y: number } {
  const rad = (dirDeg * Math.PI) / 180;
  const radiusPixels = (magnitude / Math.max(0.1, scaleUnitsPerRing)) * ringPixelSpacing;
  const x = radiusPixels * Math.sin(rad);
  const y = -radiusPixels * Math.cos(rad);
  return { x, y };
}

/**
 * Skala "cantik" yang lazim di papan manuver (satuan per ring).
 * Daftar lebih rapat agar hasil skala otomatis selalu terasa pas.
 */
export const NICE_SCALES = [
  1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9, 10, 12, 15, 17.5, 20, 25, 30,
  35, 40, 45, 50, 60, 70, 80, 90, 100, 120, 150, 175, 200, 250, 300, 350, 400,
  450, 500, 600, 800, 1000,
];

/** Bulatkan skala ke atas supaya plot tetap muat di dalam lingkaran. */
function roundUpScale(scale: number): number {
  if (scale >= 100) return Math.ceil(scale / 2.5) * 2.5;
  if (scale >= 20) return Math.ceil(scale * 2) / 2; // langkah 0.5
  if (scale >= 1) return Math.ceil(scale * 10) / 10; // langkah 0.1
  return Math.max(0.05, Math.ceil(scale * 20) / 20); // langkah 0.05
}

/**
 * Tentukan skala ring terbaik secara otomatis.
 *
 * Prinsip (permintaan pengguna): gambar TIDAK boleh terlalu kecil dan harus
 * pas di dalam lingkaran plotting → skala dipilih agar jarak terjauh titik
 * terplot memanfaatkan ±9.5 dari 10 ring (margin kecil untuk panah/label).
 * Skala "cantik" dipakai bila selisihnya ≤ 12% dari skala eksak; jika tidak,
 * skala dibulatkan ke atas agar plot tetap muat (tidak pernah keluar ring).
 */
export function autoScaleBoard(magnitudes: number[]): number {
  const maxMag = magnitudes.length ? Math.max(...magnitudes) : 0;
  if (!Number.isFinite(maxMag) || maxMag <= 0) return 1;
  const exactScale = maxMag / 9.5;
  const niceScale = NICE_SCALES.find((scale) => scale >= exactScale);
  if (niceScale && niceScale / exactScale <= 1.12) return niceScale;
  return roundUpScale(exactScale);
}
