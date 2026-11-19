/**
 * DATUM WORKSHEET 1 (Maritime Planning) — penentuan titik datum.
 *
 * Implementasi persis "Panduan Datum Worksheet 1 (Maritime Planning)" yang
 * mengikuti National SAR Manual Bab 4 §4.7–4.8, Appendix I (tabel leeway,
 * grafik arus angin Fig. I-1), Appendix J (galat posisi) dan Appendix K
 * (Worksheet 1).
 *
 * Urutan langkah (kolom Worksheet 1):
 *   1. Hours of drift (a)
 *   2. Vektor arus laut S      = kecepatan arus × a, arah = arah GERAK arus (°T)
 *   3. Vektor arus angin Wc    = WC_COEF × angin × a, arah = downwind ± divergensi lintang (Fig. I-1)
 *   4. Leeway kiri/kanan LW    = (pengali × angin + modifier) × a, arah = downwind ± sudut divergensi
 *   5. Plot: A → +S → +Wc → +LW(L) dan +LW(R)  → titik L dan R
 *   6. Datum B = titik tengah garis L–R (§4.7.60)
 *   7. Drift error De = [de(L) + de(R) + jarak L–R] / 2, de = persen_de × jarak LKP→titik
 *   8. Galat posisi x (distress craft) dan y (SRU) dari Tabel J-1/J-2/J-3
 *   9. E = √(De² + x² + y²)
 *  10. R = E × fs dibulatkan ke atas; luas lingkaran = π × R²
 *
 * Geodesi (bagian 4 panduan): bola R = 6.371.008,8 m, 1 NM = 1852 m,
 * tiap vektor diterapkan sebagai langkah destination (bukan penjumlahan
 * derajat lintang/bujur), jarak/bearing antar titik memakai haversine /
 * forward azimuth, titik tengah L–R memakai midpoint geodesik.
 */

import { dtgToZones, MONTH_SHORT_ID, parseDtg } from './dtg.mjs';

// ---------------------------------------------------------------------------
// Konstanta (bagian 9 & 10 panduan — mudah diubah, sumber asumsi tercatat)
// ---------------------------------------------------------------------------

/** Radius bola bumi (meter) — sesuai panduan bagian 4. */
export const WS1_R_EARTH_M = 6371008.8;

/** 1 NM = 1852 m. */
export const WS1_NM_M = 1852;

/**
 * Koefisien arus angin dari Figure I-1 (garis lurus dari (0,0):
 * 10 kn → 0,36 kn, 24 kn → 0,87 kn, 34 kn → 1,25 kn ≈ 0,036 × kecepatan angin).
 * ASUMSI yang perlu dikonfirmasi pemilik proyek (bagian 10 no. 1 panduan) —
 * boleh dioverride lewat input `wcCoef`.
 */
export const WS1_WC_COEF = 0.036;

/** Safety factor fs pencarian ke-1..5 (Worksheet 1 / Tabel 4.2, konvensi maritim). */
export const WS1_FS_TABLE = [1.1, 1.6, 2.0, 2.3, 2.5] as const;

/** Persentase de default (§4.7.61); Worksheet 1 menyebut rentang 12,5–33%. */
export const WS1_DE_PERCENT_DEFAULT = 12.5;

/** Batas pita divergensi arus angin Fig. I-1 (±10° lintang). */
export const WS1_DIVERGENCE_LAT_LIMIT = 10;

/** Sudut divergensi arus angin di luar pita ±10° (Fig. I-1). */
export const WS1_WC_DIVERGENCE_DEG = 30;

// ---------------------------------------------------------------------------
// Geodesi (rumus bagian 4 & kerangka kode bagian 9 panduan)
// ---------------------------------------------------------------------------

export interface Ws1LatLng {
  lat: number;
  lng: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

/** Normalisasi bearing ke 0 ≤ b < 360. */
export function ws1NormalizeBearing(b: number): number {
  return ((b % 360) + 360) % 360;
}

/**
 * Langkah destination bola: titik awal + bearing (°T) + jarak (NM) → titik baru.
 * Persis kerangka kode bagian 9 panduan (Rbumi = 6.371.008,8 m).
 */
export function ws1Destination(
  lat: number,
  lon: number,
  brg: number,
  nm: number,
): Ws1LatLng {
  const d = (nm * WS1_NM_M) / WS1_R_EARTH_M;
  const b = rad(ws1NormalizeBearing(brg));
  const p1 = rad(lat);
  const l1 = rad(lon);
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(p1),
      Math.cos(d) - Math.sin(p1) * Math.sin(p2),
    );
  return { lat: deg(p2), lng: ((deg(l2) + 540) % 360) - 180 };
}

/** Jarak haversine dua titik (NM) pada bola R = 6.371.008,8 m. */
export function ws1DistanceNm(a: Ws1LatLng, b: Ws1LatLng): number {
  const dp = rad(b.lat - a.lat);
  const dl = rad(b.lng - a.lng);
  const h =
    Math.sin(dp / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dl / 2) ** 2;
  return (
    2 * Math.asin(Math.min(1, Math.sqrt(h))) * (WS1_R_EARTH_M / WS1_NM_M)
  );
}

/** Forward azimuth (bearing awal) dari a ke b, derajat true [0,360). */
export function ws1BearingDeg(a: Ws1LatLng, b: Ws1LatLng): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ws1NormalizeBearing(deg(Math.atan2(y, x)));
}

/** Titik tengah geodesik (bagian 4 panduan: "midpoint geodesi"). */
export function ws1Midpoint(a: Ws1LatLng, b: Ws1LatLng): Ws1LatLng {
  const p1 = rad(a.lat);
  const l1 = rad(a.lng);
  const p2 = rad(b.lat);
  const dl = rad(b.lng - a.lng);
  const bx = Math.cos(p2) * Math.cos(dl);
  const by = Math.cos(p2) * Math.sin(dl);
  const p3 = Math.atan2(
    Math.sin(p1) + Math.sin(p2),
    Math.hypot(Math.cos(p1) + bx, by),
  );
  return {
    lat: deg(p3),
    lng: ((deg(l1 + Math.atan2(by, Math.cos(p1) + bx)) + 540) % 360) - 180,
  };
}

/**
 * Interpolasi geodesik garis a→b (bagian 5 panduan): dipakai untuk vektor
 * total > ±100 NM agar tidak melenceng pada proyeksi Mercator.
 * Selalu mengembalikan [a, ...titik antara..., b].
 */
export function ws1InterpolateGeodesic(
  a: Ws1LatLng,
  b: Ws1LatLng,
  maxSegmentNm = 100,
): Ws1LatLng[] {
  const total = ws1DistanceNm(a, b);
  if (!Number.isFinite(total) || total <= maxSegmentNm) return [a, b];
  const n = Math.ceil(total / maxSegmentNm);
  const pts: Ws1LatLng[] = [a];
  const bearing = ws1BearingDeg(a, b);
  for (let i = 1; i < n; i++) {
    pts.push(ws1Destination(a.lat, a.lng, bearing, (total * i) / n));
  }
  pts.push(b);
  return pts;
}

/**
 * Divergensi arus angin dari arah downwind menurut lintang LKP (kotak Figure I-1):
 *   > 10°N  → +30° (ke kanan / tambah 30°)
 *   10°N–10°S → 0° (tidak ada divergensi)
 *   < 10°S  → −30° (ke kiri / kurangi 30°)
 */
export function ws1WindCurrentDivergence(lat: number): number {
  if (lat > WS1_DIVERGENCE_LAT_LIMIT) return WS1_WC_DIVERGENCE_DEG;
  if (lat < -WS1_DIVERGENCE_LAT_LIMIT) return -WS1_WC_DIVERGENCE_DEG;
  return 0;
}

// ---------------------------------------------------------------------------
// Input / output utama
// ---------------------------------------------------------------------------

export interface Ws1DatumInput {
  /** LKP titik A (derajat desimal; S/W negatif). */
  lkp: Ws1LatLng;
  /** Hours of drift (a) — jam desimal; waktu datum − waktu LKP. */
  hours: number;
  /** Arus laut/pasut: arah KE mana arus bergerak (°T, konvensi SET) + kecepatan (knot). */
  seaCurrentDir: number;
  seaCurrentSpeed: number;
  /** Angin permukaan: arah DARI mana angin bertiup (°T) + kecepatan (knot). */
  windFrom: number;
  windSpeed: number;
  /** Leeway target (Tabel I-1/I-2): pengali, modifier (boleh negatif), sudut divergensi (°). */
  leewayRate: number;
  leewayModifier: number;
  leewayDivergenceDeg: number;
  /** Galat posisi distress craft x (NM, Tabel J-1/J-2/J-3). */
  x: number;
  /** Galat navigasi SRU y (NM). */
  y: number;
  /** Persen de (default 12,5%, rentang Worksheet 1 12,5–33). */
  dePercent?: number;
  /** Nomor pencarian 1..5 → fs tabel; diabaikan bila `fs` eksplisit diberikan. */
  searchNumber?: number;
  /** Safety factor eksplisit (override nomor pencarian). */
  fs?: number;
  /** Sakelar "abaikan arus angin" (§4.7.44) — default true (arus angin dihitung). */
  useWindCurrent?: boolean;
  /** Override koefisien arus angin Fig. I-1 (default WS1_WC_COEF = 0,036). */
  wcCoef?: number;
}

export interface Ws1VectorResult {
  /** Bearing derajat true. */
  dir: number;
  /** Jarak NM. */
  dist: number;
}

export interface Ws1DatumResult {
  /** Titik A = LKP. */
  A: Ws1LatLng;
  /** P1 = ujung vektor arus laut. */
  P1: Ws1LatLng;
  /** P2 = ujung vektor arus angin (P1 bila arus angin diabaikan). */
  P2: Ws1LatLng;
  /** Titik L = ujung leeway kiri. */
  L: Ws1LatLng;
  /** Titik R = ujung leeway kanan. */
  R: Ws1LatLng;
  /** Datum B = titik tengah garis L–R (§4.7.60). */
  datumB: Ws1LatLng;
  /** Bearing (°T) dan jarak (NM) dari LKP A ke datum B. */
  bearingAB: number;
  distanceAB: number;
  /** Hours of drift (a). */
  hours: number;
  /** Vektor arus laut S (jarak NM, arah °T). */
  seaVector: Ws1VectorResult;
  /** Arus angin: kecepatan (kn), jarak (NM), arah (°T), downwind, divergensi. */
  wcSpeed: number;
  wcVector: Ws1VectorResult;
  wcDownwindDir: number;
  wcDivergence: number;
  /** Leeway: kecepatan (kn), jarak (NM), arah kiri/kanan (°T). */
  lwSpeed: number;
  lwDist: number;
  lwDirLeft: number;
  lwDirRight: number;
  /** true bila kecepatan leeway mentah < 0 dan dijadikan 0 (asumsi bagian 10 no. 6). */
  lwClampedToZero: boolean;
  /** Jarak garis lurus LKP→L dan LKP→R (d(L), d(R) — §3.6). */
  dL: number;
  dR: number;
  /** de(L), de(R) = persen_de × d. */
  deL: number;
  deR: number;
  /** Jarak L–R (NM). */
  LR: number;
  /** De = [de(L) + de(R) + jarak L–R] / 2 (NM). */
  De: number;
  /** Persen de yang dipakai. */
  dePercent: number;
  /** Galat x, y dan total E = √(De² + x² + y²) (NM). */
  x: number;
  y: number;
  E: number;
  E2: number;
  /** Safety factor yang dipakai. */
  fs: number;
  /** R = E × fs (sebelum pembulatan) dan R dibulatkan ke atas ke bilangan bulat NM. */
  RExact: number;
  RUp: number;
  /** Luas lingkaran search area = π × Rbulat² (NM²) — asumsi lingkaran (bagian 10 no. 4). */
  areaCircleNM2: number;
  /** Luas persegi sisinya 2 × Rbulat (NM²) — kompatibilitas Worksheet 2/8/Alokasi Aset. */
  areaSquareNM2: number;
  /** Peringatan validasi (bagian 7 panduan). */
  warnings: string[];
  /** Daftar asumsi yang dipakai agar mudah diaudit (penutup panduan). */
  assumptions: string[];
}

/**
 * Perhitungan titik datum Worksheet 1 — urutan kolom Worksheet 1:
 * A → +S (arus laut) → +Wc (arus angin) → +LW kiri/kanan → L, R →
 * datum B = midpoint geodesik L–R → De, E, R, luas.
 */
export function computeDatumWs1(input: Ws1DatumInput): Ws1DatumResult {
  const warnings: string[] = [];
  const assumptions: string[] = [];

  const hours = input.hours;
  const dePercent =
    input.dePercent !== undefined && Number.isFinite(input.dePercent)
      ? input.dePercent
      : WS1_DE_PERCENT_DEFAULT;
  const useWindCurrent = input.useWindCurrent !== false;
  const wcCoef =
    input.wcCoef !== undefined && Number.isFinite(input.wcCoef)
      ? input.wcCoef
      : WS1_WC_COEF;

  // -- Validasi dasar (bagian 7 panduan) -----------------------------------
  if (!(hours > 0)) {
    warnings.push(
      'Hours of drift (a) ≤ 0 — waktu datum harus lebih lambat daripada waktu LKP.',
    );
  }
  if (input.seaCurrentSpeed < 0 || input.windSpeed < 0) {
    warnings.push('Kecepatan angin atau arus negatif tidak valid.');
  }
  for (const [label, value] of [
    ['arah arus laut', input.seaCurrentDir],
    ['arah angin', input.windFrom],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value >= 360) {
      warnings.push(`${label} di luar rentang 0–360°.`);
    }
  }

  // -- Langkah 2: vektor arus laut S (konvensi SET: arah GERAK) -------------
  const seaVector: Ws1VectorResult = {
    dir: ws1NormalizeBearing(input.seaCurrentDir),
    dist: Math.max(0, input.seaCurrentSpeed) * hours,
  };

  // -- Langkah 3: vektor arus angin Wc (Fig. I-1) ---------------------------
  const downwindDir = ws1NormalizeBearing(input.windFrom + 180);
  const wcDivergence = ws1WindCurrentDivergence(input.lkp.lat);
  const wcSpeed = useWindCurrent ? wcCoef * Math.max(0, input.windSpeed) : 0;
  const wcVector: Ws1VectorResult = {
    dir: ws1NormalizeBearing(downwindDir + wcDivergence),
    dist: wcSpeed * hours,
  };
  if (!useWindCurrent) {
    warnings.push(
      'Arus angin diabaikan (sakelar §4.7.44) — cocok untuk area dekat pantai / angin konsisten.',
    );
  }
  assumptions.push(
    `Koefisien arus angin Fig. I-1 memakai ${wcCoef} × kecepatan angin (grafik manual ≈ 0,036; perlu konfirmasi — bagian 10 no. 1).`,
  );
  assumptions.push(
    `Divergensi arus angin: lintang LKP ${input.lkp.lat >= 0 ? 'N' : 'S'}${Math.abs(input.lkp.lat).toFixed(2)}° → ${wcDivergence === 0 ? '0° (dalam pita 10°N–10°S)' : wcDivergence > 0 ? '+30° (utara 10°N)' : '−30° (selatan 10°S)'}.`,
  );

  // -- Langkah 4: leeway kiri/kanan (Tabel I-1/I-2) -------------------------
  const lwRawSpeed = input.leewayRate * Math.max(0, input.windSpeed) + input.leewayModifier;
  const lwClampedToZero = lwRawSpeed < 0;
  if (lwClampedToZero) {
    warnings.push(
      `Kecepatan leeway hasil hitung ${lwRawSpeed.toFixed(3)} kn < 0 (modifier negatif pada angin lemah) — dijadikan 0 (asumsi bagian 10 no. 6).`,
    );
  }
  const lwSpeed = Math.max(0, lwRawSpeed);
  const lwDist = lwSpeed * hours;
  const lwDirLeft = ws1NormalizeBearing(downwindDir - input.leewayDivergenceDeg);
  const lwDirRight = ws1NormalizeBearing(downwindDir + input.leewayDivergenceDeg);

  // -- Langkah 5: rantai vektor A → P1 → P2 → L/R --------------------------
  const A: Ws1LatLng = { lat: input.lkp.lat, lng: input.lkp.lng };
  const P1 = ws1Destination(A.lat, A.lng, seaVector.dir, seaVector.dist);
  const P2 = ws1Destination(P1.lat, P1.lng, wcVector.dir, wcVector.dist);
  const L = ws1Destination(P2.lat, P2.lng, lwDirLeft, lwDist);
  const R = ws1Destination(P2.lat, P2.lng, lwDirRight, lwDist);

  // -- Langkah 6: datum B = titik tengah L–R -------------------------------
  const datumB = ws1Midpoint(L, R);
  const bearingAB = ws1BearingDeg(A, datumB);
  const distanceAB = ws1DistanceNm(A, datumB);

  // -- Langkah 7: drift error De -------------------------------------------
  const dL = ws1DistanceNm(A, L);
  const dR = ws1DistanceNm(A, R);
  const deL = (dePercent / 100) * dL;
  const deR = (dePercent / 100) * dR;
  const LR = ws1DistanceNm(L, R);
  const De = (deL + deR + LR) / 2;
  assumptions.push(
    `Persen de default ${dePercent}% (§4.7.61 memakai 12,5%; Worksheet 1 menyebut rentang 12,5–33%).`,
  );

  // -- Langkah 8–10: galat x/y, E, fs, R, luas ------------------------------
  const x = Math.max(0, input.x);
  const y = Math.max(0, input.y);
  const E2 = De * De + x * x + y * y;
  const E = Math.sqrt(E2);
  const fs =
    input.fs !== undefined && Number.isFinite(input.fs) && input.fs > 0
      ? input.fs
      : WS1_FS_TABLE[
          Math.min(Math.max(input.searchNumber ?? 1, 1), WS1_FS_TABLE.length) - 1
        ];
  const RExact = E * fs;
  const RUp = Math.ceil(RExact);
  const areaCircleNM2 = Math.PI * RUp * RUp;
  const areaSquareNM2 = 4 * RUp * RUp;
  assumptions.push(
    'Luas search area dianggap lingkaran π × R² dengan R sudah dibulatkan ke atas (asumsi bagian 10 no. 4); nilai persegi (2R)² tetap ditampilkan untuk Worksheet 2/8/Alokasi Aset.',
  );
  assumptions.push(
    'Safety factor maritim Worksheet 1: pencarian ke-1..5 → 1,1 / 1,6 / 2,0 / 2,3 / 2,5 (Tabel 4.2).',
  );
  if (input.x <= 0 || input.y <= 0) {
    warnings.push(
      'Galat x/y = 0 — pilih sarana navigasi distress craft dan SRU (Tabel J-1/J-2) agar E tidak terlalu kecil.',
    );
  }

  // -- Catatan SMC ----------------------------------------------------------
  warnings.push(
    'Jika lingkaran radius pencarian memuat daratan, SMC wajib meninjau area (§4.7.74).',
  );

  return {
    A,
    P1,
    P2,
    L,
    R,
    datumB,
    bearingAB,
    distanceAB,
    hours,
    seaVector,
    wcSpeed,
    wcVector,
    wcDownwindDir: downwindDir,
    wcDivergence,
    lwSpeed,
    lwDist,
    lwDirLeft,
    lwDirRight,
    lwClampedToZero,
    dL,
    dR,
    deL,
    deR,
    LR,
    De,
    dePercent,
    x,
    y,
    E,
    E2,
    fs,
    RExact,
    RUp,
    areaCircleNM2,
    areaSquareNM2,
    warnings,
    assumptions,
  };
}

// ---------------------------------------------------------------------------
// DTG titik datum (penamaan datum §4.7.67: LKP = A, datum berikutnya B, C, …)
// ---------------------------------------------------------------------------

/**
 * DTG (UTC, format DDHHMMZ MON) perkiraan waktu datum = waktu LKP + a jam.
 * Memakai parser DTG/TW Basarnas (src/lib/sar/dtg.mjs); null bila waktu LKP
 * tidak bisa diparse atau tahun tidak diketahui.
 */
export function ws1DatumDtgUtc(
  lkpTime: string | undefined,
  hours: number,
): string | null {
  const p = parseDtg(lkpTime ?? '');
  if (!p) return null;
  const utc = dtgToZones(p).find((z) => z.zone === 'UTC');
  if (!utc) return null;
  const ms =
    Date.UTC(utc.year, utc.month - 1, utc.day, utc.hour, utc.minute) +
    hours * 3600_000;
  const d = new Date(ms);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hhmm = `${String(d.getUTCHours()).padStart(2, '0')}${String(
    d.getUTCMinutes(),
  ).padStart(2, '0')}`;
  const mon = MONTH_SHORT_ID[d.getUTCMonth()]?.toUpperCase() ?? '';
  return `${dd}${hhmm}Z ${mon}`;
}
