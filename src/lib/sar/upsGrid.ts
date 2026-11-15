/**
 * Universal Plotting Sheet (UPS) Mathematics & Grid Helper
 * Standard VP-OS Universal Plotting Sheet (Mercator mid-latitude projection)
 */

import { type LatLng } from './sarCalculations';

export interface UPSConfig {
  centerLat: number; // Mid-latitude (derajat)
  centerLon: number; // Central meridian (derajat)
  scaleNmPerGrid: number; // Skala NM per grid square (default 1 NM atau 5 NM)
  gridCount: number; // Jumlah grid lines tiap arah (default 10)
}

/**
 * Konversi Latitude/Longitude ke koordinat lokal (x, y) dalam Nautical Miles pada UPS.
 * x: Jarak barat (-) ke timur (+) dalam NM
 * y: Jarak selatan (-) ke utara (+) dalam NM
 */
export function latLonToUPS(
  pos: LatLng,
  centerLat: number,
  centerLon: number
): { xNm: number; yNm: number } {
  const dLatMin = (pos.lat - centerLat) * 60; // 1 menit busur lat = 1 NM
  const midLatRad = (centerLat * Math.PI) / 180;
  const dLonMin = (pos.lng - centerLon) * 60;
  // Pada proyeksi Mercator di lintang tengah Lm: 1 menit busur lon = cos(Lm) NM
  const dLonNm = dLonMin * Math.cos(midLatRad);

  return {
    xNm: dLonNm,
    yNm: dLatMin,
  };
}

/**
 * Konversi koordinat lokal UPS (xNm, yNm) kembali ke Latitude/Longitude
 */
export function upsToLatLon(
  xNm: number,
  yNm: number,
  centerLat: number,
  centerLon: number
): LatLng {
  const lat = centerLat + yNm / 60;
  const midLatRad = (centerLat * Math.PI) / 180;
  const lng = centerLon + xNm / (60 * Math.max(0.01, Math.cos(midLatRad)));
  return { lat, lng };
}
