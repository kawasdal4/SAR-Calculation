/**
 * landMapProj — konversi lat/lon ↔ UTM (WGS84) + utilitas grid peta darat.
 *
 * Dipakai HANYA oleh peta darat Worksheet 4 (Worksheet4LandMap) — tidak
 * menyentuh peta ONC maupun worksheet lain. Konversi memakai proj4js
 * (dependency npm ter-pin, bukan CDN) dengan definisi zona dibuat di sini:
 *   - Zona utara : EPSG:326xx (xx = zona 1..60)
 *   - Zona selatan: EPSG:327xx — mis. 49S → EPSG:32749 (false northing
 *     10.000.000 m otomatis dari parameter +south proj4).
 */
import proj4 from 'proj4';

export const WGS84 = 'EPSG:4326';

export interface UtmCoord {
  easting: number;
  northing: number;
  zone: number;
  south: boolean;
}

export interface LatLon {
  lat: number;
  lon: number;
}

const registeredZones = new Set<string>();

/** Zona UTM dari bujur: floor((lon + 180) / 6) + 1, clamp 1..60. lon 180 → zona 1. */
export function utmZoneFor(lon: number): number {
  if (!Number.isFinite(lon)) return 48;
  const normalized = (((lon + 180) % 360) + 360) % 360;
  return Math.min(60, Math.max(1, Math.floor(normalized / 6) + 1));
}

/** Bujur tengah zona (derajat). Zona 49 → 111°BT. */
export function zoneCentralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

export function epsgFor(zone: number, south: boolean): string {
  const code = south ? 32700 + zone : 32600 + zone;
  return `EPSG:${code}`;
}

/** Daftarkan definisi proj4 zona (idempotent). */
export function ensureUtmProj(zone: number, south: boolean): string {
  const code = epsgFor(zone, south);
  if (!registeredZones.has(code)) {
    proj4.defs(code, `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`);
    registeredZones.add(code);
  }
  return code;
}

/** lat/lon (WGS84) → UTM {easting, northing, zone, south}. */
export function latLonToUtm(lat: number, lon: number, southOverride?: boolean): UtmCoord {
  const zone = utmZoneFor(lon);
  const south = southOverride ?? lat < 0;
  const code = ensureUtmProj(zone, south);
  const [easting, northing] = proj4(WGS84, code, [lon, lat]) as [number, number];
  return { easting, northing, zone, south };
}

/** UTM → lat/lon (WGS84). */
export function utmToLatLon(easting: number, northing: number, zone: number, south: boolean): LatLon {
  const code = ensureUtmProj(zone, south);
  const [lon, lat] = proj4(code, WGS84, [easting, northing]) as [number, number];
  return { lat, lon };
}

// ---------------------------------------------------------------------------
// Garis grid konstan — UTM tidak sejajar sumbu layar (konvergensi meridian),
// jadi tiap garis dihitung sebagai polyline dari banyak titik proyeksi.
// ---------------------------------------------------------------------------

/** Northing pada suatu lintang (dihitung di bujur tengah zona — northing praktis tak bergantung bujur). */
function northingAtLat(zone: number, south: boolean, lat: number): number {
  const cm = zoneCentralMeridian(zone);
  const [, northing] = proj4(WGS84, ensureUtmProj(zone, south), [cm, lat]) as [number, number];
  return northing;
}

/**
 * Bujur tepat pada garis easting konstan untuk satu lintang:
 * inverse(easting, northing(lat)) → lon.
 */
export function lonAtEasting(zone: number, south: boolean, easting: number, lat: number): number {
  const northing = northingAtLat(zone, south, lat);
  const { lon } = utmToLatLon(easting, northing, zone, south);
  return lon;
}

/**
 * Lintang tepat pada garis northing konstan untuk satu bujur:
 * iterasi fixed-point (northing bergantung lintang ~111 km/derajat).
 */
export function latAtNorthing(zone: number, south: boolean, northing: number, lon: number): number {
  const cm = zoneCentralMeridian(zone);
  // Tebakan awal dari inverse di bujur tengah.
  let lat = utmToLatLon(500000, northing, zone, south).lat;
  const code = ensureUtmProj(zone, south);
  for (let i = 0; i < 6; i++) {
    const [, n2] = proj4(WGS84, code, [lon, lat]) as [number, number];
    const dLat = (northing - n2) / 111320;
    lat += dLat;
    if (Math.abs(dLat) < 1e-9) break;
  }
  void cm;
  return lat;
}

/** Polyline lat/lon garis easting konstan dari latMin → latMax (uji penuh proyeksi). */
export function constantEastingLine(zone: number, south: boolean, easting: number, latMin: number, latMax: number, steps = 24): LatLon[] {
  const points: LatLon[] = [];
  const clampedMin = Math.max(-84, Math.min(84, latMin));
  const clampedMax = Math.max(-84, Math.min(84, latMax));
  for (let i = 0; i <= steps; i++) {
    const lat = clampedMin + (clampedMax - clampedMin) * (i / steps);
    points.push({ lat, lon: lonAtEasting(zone, south, easting, lat) });
  }
  return points;
}

/** Polyline lat/lon garis northing konstan dari lonMin → lonMax. */
export function constantNorthingLine(zone: number, south: boolean, northing: number, lonMin: number, lonMax: number, steps = 24): LatLon[] {
  const points: LatLon[] = [];
  for (let i = 0; i <= steps; i++) {
    const lon = lonMin + (lonMax - lonMin) * (i / steps);
    points.push({ lat: latAtNorthing(zone, south, northing, lon), lon });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Pemilihan interval grid — adaptif resolusi zoom (mode bebas); mode skala
// cetak memakai interval tetap (UTM 1.000 m, graticule 30") dari komponen.
// ---------------------------------------------------------------------------

const UTM_INTERVALS_M = [500, 1000, 2000, 5000, 10000, 20000, 50000];
const GRATICULE_INTERVAL_SEC = [5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];

/** Meter per piksel pada Web Mercator untuk zoom tertentu. */
export function metersPerPixelAt(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** Interval UTM (m) terkecil yang jarak layarnya ≥ minPx. */
export function pickUtmIntervalM(metersPerPx: number, minPx = 48): number {
  for (const interval of UTM_INTERVALS_M) {
    if (interval / metersPerPx >= minPx) return interval;
  }
  return UTM_INTERVALS_M[UTM_INTERVALS_M.length - 1];
}

/** Interval graticule (detik busur) terkecil yang jarak layarnya ≥ minPx. */
export function pickGraticuleIntervalSec(metersPerPx: number, lat: number, minPx = 48): number {
  const metersPerSec = (30.92 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  for (const interval of GRATICULE_INTERVAL_SEC) {
    if ((interval * metersPerSec) / metersPerPx >= minPx) return interval;
  }
  return GRATICULE_INTERVAL_SEC[GRATICULE_INTERVAL_SEC.length - 1];
}

/** Easting/northing habis dibagi interval (lintas batas zona: caller yang membatasi). */
export function gridValuesBetween(min: number, max: number, interval: number): number[] {
  const values: number[] = [];
  const start = Math.ceil((min - 1e-6) / interval) * interval;
  for (let value = start; value <= max + 1e-6; value += interval) {
    values.push(Number(value.toFixed(3)));
  }
  return values;
}

// ---------------------------------------------------------------------------
// Format label tepi (margin bingkai) — gaya peta cetak RBI 1:25.000.
//   UTM hitam : "380000m.T" (T = Timur), "9206000m.U" (U = Utara);
//               label tengah dua digit utama: 381000 → "81", 9205000 → "05".
//   Geografis biru: "109°54'30\"BT" (bujur timur/barat), "07°10'30\"LS".
// ---------------------------------------------------------------------------

function pad(value: number, width: number): string {
  return String(Math.abs(value)).padStart(width, '0');
}

/** Label penuh tepi: nilai meter + satuan axis. */
export function formatUtmFull(meters: number, axis: 'T' | 'U'): string {
  return `${Math.round(meters)}m.${axis}`;
}

/** Label tengah dua digit: dua digit terakhir kilometer (381000 → "81"). */
export function formatUtmMiddle(meters: number): string {
  const km = Math.floor(Math.round(meters) / 1000);
  return pad(km % 100, 2);
}

/** Dekonstruksi derajat → d/m/s terbulatkan ke detik terdekat (tanpa rollover 60/60). */
function toDms(degrees: number): { deg: number; min: number; sec: number; negative: boolean } {
  const negative = degrees < 0;
  const absSeconds = Math.round(Math.abs(degrees) * 3600);
  const deg = Math.floor(absSeconds / 3600);
  const min = Math.floor((absSeconds % 3600) / 60);
  const sec = absSeconds % 60;
  return { deg, min, sec, negative };
}

/** Label bujur geografis: "109°54'30\"BT" (BT timur / BB barat), derajat 3 digit. */
export function formatDmsLon(lon: number): string {
  const { deg, min, sec, negative } = toDms(lon);
  return `${pad(deg, 3)}°${pad(min, 2)}'${pad(sec, 2)}"${negative ? 'BB' : 'BT'}`;
}

/** Label lintang geografis: "07°10'30\"LS" (LS selatan / LU utara), derajat 2 digit. */
export function formatDmsLat(lat: number): string {
  const { deg, min, sec, negative } = toDms(lat);
  return `${pad(deg, 2)}°${pad(min, 2)}'${pad(sec, 2)}"${negative ? 'LS' : 'LU'}`;
}

/** "Zona UTM 49S, datum WGS84" untuk legenda/caption. */
export function formatUtmZoneLabel(zone: number, south: boolean): string {
  return `Zona UTM ${zone}${south ? 'S' : 'N'}, datum WGS84`;
}
