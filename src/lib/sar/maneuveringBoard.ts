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
  // Target: maxMag harus muat dalam ~8 dari 10 ring
  const idealPerRing = maxMag / 8;
  if (idealPerRing <= 1) return 1;
  if (idealPerRing <= 2) return 2;
  if (idealPerRing <= 3) return 3;
  if (idealPerRing <= 5) return 5;
  if (idealPerRing <= 10) return 10;
  if (idealPerRing <= 20) return 20;
  return Math.ceil(idealPerRing / 10) * 10;
}
