/**
 * Deklarasi TypeScript untuk upsAdw.mjs — Panduan ADW ke UPS Digital.
 * Matematika rantai vektor ADW, pemilihan skala, dan jangkar grid UPS.
 */

/** Vektor planar sederhana: arah derajat True (000° di atas), jarak NM. */
export interface UpsAdwVector {
  dir: number;
  nm: number;
}

/** Parameter kanvas lembar UPS (panduan bagian 5), dalam satuan jari-jari rose R. */
export declare const UPS_SHEET_WR: number;
export declare const UPS_SHEET_HR: number;
export declare const UPS_MARGIN_R: number;
/** Kandidat skala menit busur yang tersedia: 3, 6, 12, 18, 30, 60. */
export declare const UPS_SCALE_OPTIONS: number[];

export declare function normalizeDeg(deg: number): number;

/** Penjumlahan dua vektor planar (rumus N/E panduan bagian 7). */
export declare function sumPlanarVectors(
  v1: UpsAdwVector,
  v2: UpsAdwVector,
): { northNm: number; eastNm: number; nm: number; dir: number };

export interface AdwChainResult {
  northNm: number;
  eastNm: number;
  /** Jarak da (B12) dalam NM. */
  daNm: number;
  /** Arah da (B12) derajat True. */
  daDir: number;
  /** Lintang akhir glide (B14), derajat desimal. */
  endLat: number;
  /** Bujur akhir glide (B14), derajat desimal. */
  endLng: number;
  /** Lintang tengah φm = (φdatum + φakhir)/2. */
  midLat: number;
  cosMidLat: number;
}

/** Rantai ADW pesawat: dg (B8/B9) + dd (B11) → da (B12) dan posisi akhir (B14). */
export declare function computeAdwChain(args: {
  datumLat: number;
  datumLng: number;
  dgDir: number;
  dgNm: number;
  ddDir: number;
  ddNm: number;
}): AdwChainResult;

export interface UpsScaleResult {
  /** Skala terpilih (menit busur), null bila tidak ada yang lolos. */
  scaleMin: number;
  fits: boolean;
  /** Indeks grid bujur/lintang pusat rose terhadap datum. */
  i: number;
  j: number;
  /** Pusat rose C relatif datum (NM, x timur +, y utara +). */
  roseCenterNm: { xNm: number; yNm: number };
  /** Simetri simpang terjauh dan batasnya (NM) untuk pemeriksaan skala. */
  maxDevXNm: number;
  maxDevYNm: number;
  xLimitNm: number;
  yLimitNm: number;
  cosMidLat: number;
  midLat: number;
}

/**
 * Pilih skala terkecil yang memuat semua titik di dalam lembar
 * (WR/2 − m)·S dan (HR/2 − m)·S dari pusat rose C terdekat ke tengah kotak
 * pembatas titik (panduan bagian 5).
 */
export declare function selectUpsScale(args: {
  points: Array<{ xNm: number; yNm: number }>;
  midLat: number;
  scales?: number[];
}): UpsScaleResult;

/** Tambahkan φC = φdatum + j·S′ dan λC = λdatum + i·S′ ke hasil skala. */
export declare function withGridAnchors(
  scaleResult: UpsScaleResult,
  args: { datumLat: number; datumLng: number },
): UpsScaleResult & { latCenterDeg: number; lngCenterDeg: number };

export interface AdwUpsSegment {
  /** 'dg' | 'dd' | 'pg' | 'pw' | 'pp' */
  id: string;
  fromNm: { xNm: number; yNm: number };
  toNm: { xNm: number; yNm: number };
  dir: number;
  nm: number;
  tipNm: { xNm: number; yNm: number };
}

export interface AdwUpsPlot {
  ready: boolean;
  reason?: string;
  datum: { lat: number; lng: number };
  /** Semua vektor yang digambar (pesawat + parasut). */
  segments: AdwUpsSegment[];
  /** Semua titik yang harus muat di lembar (datum + ujung vektor). */
  points: Array<{ xNm: number; yNm: number }>;
  /** Ringkasan rantai pesawat: da (B12) dan koordinat akhir (B14). */
  daInfo: { nm: number; dir: number; endLat: number; endLng: number } | null;
  /** Ringkasan rantai parasut bila aktif. */
  parachute: {
    startNm: { xNm: number; yNm: number };
    pgTip: { xNm: number; yNm: number };
    pwTip: { xNm: number; yNm: number };
    resultNm: number;
    resultDir: number;
    endLat: number;
    endLng: number;
  } | null;
  /** Hasil pemilihan skala + φC/λC pusat rose. */
  scale: UpsScaleResult & { latCenterDeg?: number; lngCenterDeg?: number };
  midLat: number;
}

/** Rencana gambar lengkap ADW → UPS (semua titik diikutkan dalam cek skala). */
export declare function buildAdwUpsPlot(p: {
  datumLat: number;
  datumLng: number;
  dg?: UpsAdwVector | null;
  dd?: UpsAdwVector | null;
  pg?: UpsAdwVector | null;
  pw?: UpsAdwVector | null;
  pp?: UpsAdwVector | null;
}): AdwUpsPlot;

/** Label garis besar (menit) dan garis kecil (detik) skala untuk skala S. */
export declare function scaleTickInfo(scaleMin: number): { majorMin: number; minorSec: number };
