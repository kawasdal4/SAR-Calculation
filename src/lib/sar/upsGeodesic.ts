import type { LatLng } from './sarCalculations';

const A = 6378137;
const F = 1 / 298.257223563;
const B = (1 - F) * A;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const NM = 1852;

/** WGS-84 Vincenty direct solution; bearing is true clockwise from north. */
export function upsDirect(start: LatLng, bearingDeg: number, distanceNm: number): LatLng {
  const alpha1 = bearingDeg * RAD;
  const phi1 = start.lat * RAD;
  const lambda1 = start.lng * RAD;
  const tanU1 = (1 - F) * Math.tan(phi1);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, Math.cos(alpha1));
  const sinAlpha = cosU1 * Math.sin(alpha1);
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = cosSqAlpha * (A * A - B * B) / (B * B);
  const coeffA = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const coeffB = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const distance = distanceNm * NM;
  const baseSigma = distance / (B * coeffA);
  let sigma = baseSigma;
  let deltaSigma = 0;
  for (let i = 0; i < 100; i++) {
    const twoSigmaM = 2 * sigma1 + sigma;
    const sinSigma = Math.sin(sigma);
    const cosSigma = Math.cos(sigma);
    const cosTwoSigmaM = Math.cos(twoSigmaM);
    deltaSigma = coeffB * sinSigma * (cosTwoSigmaM + coeffB / 4 * (cosSigma * (-1 + 2 * cosTwoSigmaM ** 2) - coeffB / 6 * cosTwoSigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cosTwoSigmaM ** 2)));
    const next = baseSigma + deltaSigma;
    if (Math.abs(next - sigma) < 1e-12) { sigma = next; break; }
    sigma = next;
  }
  const sinSigma = Math.sin(sigma);
  const cosSigma = Math.cos(sigma);
  const twoSigmaM = 2 * sigma1 + sigma;
  const tmp = sinU1 * sinSigma - cosU1 * cosSigma * Math.cos(alpha1);
  const phi2 = Math.atan2(sinU1 * cosSigma + cosU1 * sinSigma * Math.cos(alpha1), (1 - F) * Math.sqrt(sinAlpha ** 2 + tmp ** 2));
  const lambda = Math.atan2(sinSigma * Math.sin(alpha1), cosU1 * cosSigma - sinU1 * sinSigma * Math.cos(alpha1));
  const C = F / 16 * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
  const L = lambda - (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (Math.cos(twoSigmaM) + C * cosSigma * (-1 + 2 * Math.cos(twoSigmaM) ** 2)));
  return { lat: phi2 * DEG, lng: ((lambda1 + L + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * DEG };
}

/** Vincenty inverse solution: true initial bearing and ellipsoidal distance. */
export function upsInverse(from: LatLng, to: LatLng): { bearingDeg: number; distanceNm: number } {
  const phi1 = from.lat * RAD, phi2 = to.lat * RAD;
  const L = (to.lng - from.lng) * RAD;
  const U1 = Math.atan((1 - F) * Math.tan(phi1)), U2 = Math.atan((1 - F) * Math.tan(phi2));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L, sinSigma = 0, cosSigma = 1, sigma = 0, sinAlpha = 0, cosSqAlpha = 1, cos2SigmaM = 0;
  let converged = false;
  for (let i = 0; i < 200; i++) {
    const sinLambda = Math.sin(lambda), cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2);
    if (sinSigma === 0) return { bearingDeg: 0, distanceNm: 0 };
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma;
    cosSqAlpha = 1 - sinAlpha ** 2;
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha;
    const C = F / 16 * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
    const next = L + (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(next - lambda) < 1e-12) { lambda = next; converged = true; break; }
    lambda = next;
  }
  if (!converged) throw new Error('Perhitungan balik WGS-84 tidak konvergen untuk kedua titik ini.');
  const uSq = cosSqAlpha * (A * A - B * B) / (B * B);
  const coeffA = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const coeffB = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma = coeffB * sinSigma * (cos2SigmaM + coeffB / 4 * (cosSigma * (-1 + 2 * cos2SigmaM ** 2) - coeffB / 6 * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
  const distanceNm = B * coeffA * (sigma - deltaSigma) / NM;
  const bearingDeg = (Math.atan2(cosU2 * Math.sin(lambda), cosU1 * sinU2 - sinU1 * cosU2 * Math.cos(lambda)) * DEG + 360) % 360;
  return { bearingDeg, distanceNm };
}
