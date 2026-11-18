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
 * Tentukan skala ring terbaik secara otomatis agar seluruh vektor muat di dalam 10 ring
 */
export function autoScaleBoard(magnitudes: number[]): number {
  const maxMag = Math.max(1, ...magnitudes);
  // Keep the plotted extent inside roughly 8 of the board's 10 rings.
  const idealPerRing = maxMag / 8;
  const preferredScales = [1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 1000];
  const fitScale = preferredScales.find((scale) => scale >= idealPerRing);
  return fitScale ?? Math.ceil(idealPerRing / 100) * 100;
}
