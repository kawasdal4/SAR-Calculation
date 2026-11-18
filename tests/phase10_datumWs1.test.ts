/**
 * PHASE 10 — Datum Worksheet 1 (Maritime Planning) sesuai
 * "Panduan Datum Worksheet 1 (Maritime Planning)" yang diunggah pengguna.
 *
 * Sumber: National SAR Manual Bab 4 §4.7–4.8 · Appendix I · Appendix J ·
 * Appendix K Worksheet 1.
 *
 * Bagian 6 panduan = acceptance test resmi (contoh rekaan, bukan insiden
 * nyata). Toleransi: jarak ±0,01 NM, koordinat ±0,0001°, bearing ±0,1°.
 */
import { describe, test, expect } from 'bun:test';
import {
  computeDatumWs1,
  ws1Destination,
  ws1DistanceNm,
  ws1Midpoint,
  ws1BearingDeg,
  ws1InterpolateGeodesic,
  ws1WindCurrentDivergence,
  ws1DatumDtgUtc,
  WS1_WC_COEF,
  WS1_FS_TABLE,
  WS1_DE_PERCENT_DEFAULT,
} from '../src/lib/sar/datumWs1';

// ---------------------------------------------------------------------------
// Acceptance test bagian 6 panduan
// ---------------------------------------------------------------------------
// Input:
//   LKP 5°30,0′S 106°00,0′E (−5,5000; 106,0000)
//   a = 6,0 jam; arus laut 0,5 kn @ 045°T; angin DARI 270°T, 15 kn
//   Target penyelam scuba: pengali 0,007; modifier 0,08; divergensi 30°
//   x = y = 0,1 NM (GPS); de 12,5%; fs 1,1 (pencarian ke-1)
const ACCEPTANCE = {
  lkp: { lat: -5.5, lng: 106.0 },
  hours: 6.0,
  seaCurrentDir: 45,
  seaCurrentSpeed: 0.5,
  windFrom: 270,
  windSpeed: 15,
  leewayRate: 0.007,
  leewayModifier: 0.08,
  leewayDivergenceDeg: 30,
  x: 0.1,
  y: 0.1,
  dePercent: 12.5,
  searchNumber: 1,
} as const;

const result = computeDatumWs1(ACCEPTANCE);

describe('Panduan §6 — acceptance test titik datum Worksheet 1', () => {
  test('Vektor arus laut 3,00 NM / 045°T', () => {
    expect(result.seaVector.dist).toBeCloseTo(3.0, 2);
    expect(result.seaVector.dir).toBeCloseTo(45, 1);
  });

  test('Divergensi arus angin 0° (lintang 5,5°S di pita 10°N–10°S)', () => {
    expect(result.wcDivergence).toBe(0);
    expect(ws1WindCurrentDivergence(-5.5)).toBe(0);
  });

  test('Arus angin 0,036 × 15 = 0,54 kn → 3,24 NM / 090°T', () => {
    expect(WS1_WC_COEF).toBeCloseTo(0.036, 10);
    expect(result.wcSpeed).toBeCloseTo(0.54, 3);
    expect(result.wcVector.dist).toBeCloseTo(3.24, 2);
    expect(result.wcVector.dir).toBeCloseTo(90, 1);
  });

  test('Kecepatan leeway 0,007 × 15 + 0,08 = 0,185 kn → 1,11 NM', () => {
    expect(result.lwSpeed).toBeCloseTo(0.185, 4);
    expect(result.lwDist).toBeCloseTo(1.11, 2);
  });

  test('Arah leeway kiri 060°T, kanan 120°T', () => {
    expect(result.lwDirLeft).toBeCloseTo(60, 1);
    expect(result.lwDirRight).toBeCloseTo(120, 1);
  });

  test('P1 (setelah arus laut) −5,46467; 106,03549 (±0,0001°)', () => {
    expect(result.P1.lat).toBeCloseTo(-5.46467, 4);
    expect(result.P1.lng).toBeCloseTo(106.03549, 4);
  });

  test('P2 (setelah arus angin) −5,46467; 106,08970', () => {
    expect(result.P2.lat).toBeCloseTo(-5.46467, 4);
    expect(result.P2.lng).toBeCloseTo(106.0897, 4);
  });

  test('Titik L −5,45542; 106,10579 dan titik R −5,47391; 106,10579', () => {
    expect(result.L.lat).toBeCloseTo(-5.45542, 4);
    expect(result.L.lng).toBeCloseTo(106.10579, 4);
    expect(result.R.lat).toBeCloseTo(-5.47391, 4);
    expect(result.R.lng).toBeCloseTo(106.10579, 4);
  });

  test('d(L) = 6,866 NM dan d(R) = 6,514 NM (±0,01 NM)', () => {
    expect(result.dL).toBeCloseTo(6.866, 2);
    expect(result.dR).toBeCloseTo(6.514, 2);
  });

  test('de(L) = 0,858 NM dan de(R) = 0,814 NM (12,5% × d)', () => {
    expect(result.deL).toBeCloseTo(0.858, 2);
    expect(result.deR).toBeCloseTo(0.814, 2);
  });

  test('Jarak L–R = 1,110 NM', () => {
    expect(result.LR).toBeCloseTo(1.11, 2);
  });

  test('De = (0,858 + 0,814 + 1,110) / 2 = 1,391 NM', () => {
    expect(result.De).toBeCloseTo(1.391, 2);
  });

  test('Datum B −5,46466; 106,10579 (±0,0001°) — midpoint geodesik L–R', () => {
    expect(result.datumB.lat).toBeCloseTo(-5.46466, 4);
    expect(result.datumB.lng).toBeCloseTo(106.10579, 4);
  });

  test('Bearing & jarak A→B konsisten dengan koordinat datum', () => {
    expect(result.bearingAB).toBeCloseTo(ws1BearingDeg(result.A, result.datumB), 6);
    expect(result.distanceAB).toBeCloseTo(ws1DistanceNm(result.A, result.datumB), 6);
    // Datum timur laut LKP: Δlat ≈ +2,12 NM (utara), Δlon ≈ +6,33 NM (timur)
    // → bearing ≈ 71,5°T, jarak ≈ 6,67 NM
    expect(result.bearingAB).toBeCloseTo(71.5, 1);
    expect(result.distanceAB).toBeGreaterThan(6.0);
    expect(result.distanceAB).toBeLessThan(7.0);
  });

  test('E = √(1,391² + 0,1² + 0,1²) = 1,398 NM', () => {
    expect(result.E).toBeCloseTo(1.398, 2);
    expect(result.E2).toBeCloseTo(result.E * result.E, 10);
  });

  test('R = E × fs = 1,538 NM → dibulatkan ke atas 2 NM (fs 1,1)', () => {
    expect(result.fs).toBe(1.1);
    expect(result.RExact).toBeCloseTo(1.538, 2);
    expect(result.RUp).toBe(2);
  });

  test('Luas lingkaran π × 2² = 12,57 NM² (pakai R yang sudah dibulatkan)', () => {
    expect(result.areaCircleNM2).toBeCloseTo(12.57, 2);
    // Nilai persegi (2R)² untuk kompatibilitas Worksheet 2/8:
    expect(result.areaSquareNM2).toBeCloseTo(16, 6);
  });

  test('Posisi datum ditampilkan juga dalam derajat-menit: ≈ 5°27,9′S 106°06,3′E', () => {
    const dmLat = `${Math.floor(Math.abs(result.datumB.lat))}°${(
      (Math.abs(result.datumB.lat) % 1) * 60
    ).toFixed(1)}′S`;
    const dmLng = `${Math.floor(result.datumB.lng)}°${(
      (result.datumB.lng % 1) * 60
    ).toFixed(1)}′E`;
    expect(dmLat).toBe('5°27.9′S');
    expect(dmLng).toBe('106°6.3′E');
  });

  test('Asumsi dan peringatan tercatat di hasil (audit bagian 10)', () => {
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.assumptions.length).toBeGreaterThan(0);
    expect(result.assumptions.join(' ')).toContain('0,036');
    expect(result.warnings.join(' ')).toContain('SMC');
  });
});

// ---------------------------------------------------------------------------
// Aturan pendukung lain dari panduan
// ---------------------------------------------------------------------------

describe('Divergensi arus angin menurut lintang LKP (kotak Fig. I-1)', () => {
  test('Utara 10°N → +30° (ke kanan)', () => {
    expect(ws1WindCurrentDivergence(10.5)).toBe(30);
    expect(ws1WindCurrentDivergence(45)).toBe(30);
  });

  test('Pita 10°N–10°S → 0°', () => {
    expect(ws1WindCurrentDivergence(10)).toBe(0);
    expect(ws1WindCurrentDivergence(0)).toBe(0);
    expect(ws1WindCurrentDivergence(-10)).toBe(0);
    expect(ws1WindCurrentDivergence(5.5)).toBe(0);
  });

  test('Selatan 10°S → −30° (ke kiri)', () => {
    expect(ws1WindCurrentDivergence(-10.5)).toBe(-30);
    expect(ws1WindCurrentDivergence(-45)).toBe(-30);
  });

  test('Arah arus angin = downwind + divergensi; downwind = arah angin + 180°', () => {
    // Angin DARI 090 di 20°N → downwind 270, divergensi +30 → 300
    const r = computeDatumWs1({
      ...ACCEPTANCE,
      lkp: { lat: 20, lng: 106 },
      windFrom: 90,
      seaCurrentSpeed: 0,
    });
    expect(r.wcDownwindDir).toBe(270);
    expect(r.wcDivergence).toBe(30);
    expect(r.wcVector.dir).toBe(300);
    // Angin DARI 090 di 20°S → downwind 270, divergensi −30 → 240
    const s = computeDatumWs1({
      ...ACCEPTANCE,
      lkp: { lat: -20, lng: 106 },
      windFrom: 90,
      seaCurrentSpeed: 0,
    });
    expect(s.wcVector.dir).toBe(240);
  });
});

describe('Leeway (Tabel I-1/I-2)', () => {
  test('Contoh verifikasi manual §4.7.53: scuba, angin dari 270° 15 kn → 0,185 kn; kanan 120°T, kiri 060°T', () => {
    // sudah dicover acceptance test; diulang di sini sebagai kontrak terpisah
    expect(result.lwSpeed).toBeCloseTo(0.185, 4);
    expect(result.lwDirRight).toBe(120);
    expect(result.lwDirLeft).toBe(60);
  });

  test('Leeway negatif → 0 dengan peringatan (asumsi no. 6)', () => {
    const r = computeDatumWs1({
      ...ACCEPTANCE,
      leewayRate: 0.044,
      leewayModifier: -0.2, // raft no ballast w/ drogue
      windSpeed: 5, // 0.044×5 − 0.2 = 0.02 → tidak clamp; pakai angin lebih lemah
    });
    // 0.044×5 = 0.22 − 0.2 = 0.02 > 0 → masih positif
    expect(r.lwSpeed).toBeCloseTo(0.02, 3);
    const clamped = computeDatumWs1({
      ...ACCEPTANCE,
      leewayRate: 0.044,
      leewayModifier: -0.2,
      windSpeed: 2, // 0.088 − 0.2 = −0.112 → clamp ke 0
    });
    expect(clamped.lwSpeed).toBe(0);
    expect(clamped.lwClampedToZero).toBe(true);
    expect(clamped.lwDist).toBe(0);
    expect(clamped.warnings.join(' ')).toContain('leeway');
    expect(clamped.L.lat).toBeCloseTo(clamped.P2.lat, 9);
    expect(clamped.L.lng).toBeCloseTo(clamped.P2.lng, 9);
  });
});

describe('Sakelar "abaikan arus angin" (§4.7.44)', () => {
  test('useWindCurrent=false → Wc 0, P2 = P1, peringatan muncul', () => {
    const r = computeDatumWs1({ ...ACCEPTANCE, useWindCurrent: false });
    expect(r.wcSpeed).toBe(0);
    expect(r.wcVector.dist).toBe(0);
    expect(r.P2.lat).toBeCloseTo(r.P1.lat, 9);
    expect(r.P2.lng).toBeCloseTo(r.P1.lng, 9);
    expect(r.warnings.join(' ').toLowerCase()).toContain('diabaikan');
  });
});

describe('Safety factor & nomor pencarian (Tabel 4.2)', () => {
  test('pencarian ke-1..5 → 1,1 / 1,6 / 2,0 / 2,3 / 2,5', () => {
    expect([...WS1_FS_TABLE]).toEqual([1.1, 1.6, 2.0, 2.3, 2.5]);
    for (let n = 1; n <= 5; n++) {
      const r = computeDatumWs1({ ...ACCEPTANCE, searchNumber: n });
      expect(r.fs).toBe(WS1_FS_TABLE[n - 1]);
    }
  });

  test('fs eksplisit mengoverride nomor pencarian; de di luar default juga bekerja', () => {
    const r = computeDatumWs1({ ...ACCEPTANCE, fs: 2.0, searchNumber: 3 });
    expect(r.fs).toBe(2.0);
    const r33 = computeDatumWs1({ ...ACCEPTANCE, dePercent: 33 });
    expect(r33.dePercent).toBe(33);
    expect(r33.De).toBeCloseTo((0.33 * (result.dL + result.dR) + result.LR) / 2, 6);
    expect(WS1_DE_PERCENT_DEFAULT).toBe(12.5);
  });
});

describe('Geodesi (bagian 4 panduan)', () => {
  test('destination bola: 0,5 kn × 6 jam @045° dari LKP menghasilkan P1 panduan', () => {
    const p = ws1Destination(-5.5, 106.0, 45, 3.0);
    expect(p.lat).toBeCloseTo(-5.46467, 4);
    expect(p.lng).toBeCloseTo(106.03549, 4);
  });

  test('haversine: jarak LKP→L = 6,866 NM', () => {
    expect(ws1DistanceNm({ lat: -5.5, lng: 106 }, result.L)).toBeCloseTo(6.866, 2);
  });

  test('midpoint geodesik = datum B panduan', () => {
    const m = ws1Midpoint(result.L, result.R);
    expect(m.lat).toBeCloseTo(-5.46466, 4);
    expect(m.lng).toBeCloseTo(106.10579, 4);
  });

  test('normalisasi bujur −180…180 & bearing 0–360', () => {
    const p = ws1Destination(0, 179.9, 90, 20); // melewati antimeridian
    expect(p.lng).toBeLessThan(-179);
    const b = ws1BearingDeg({ lat: 0, lng: 179.9 }, { lat: 0, lng: -179.9 });
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(360);
  });

  test('interpolasi geodesik: vektor ≤ 100 NM tanpa titik antara; > 100 NM dipecah', () => {
    const short = ws1InterpolateGeodesic({ lat: 0, lng: 0 }, { lat: 0, lng: 0.5 });
    expect(short.length).toBe(2);
    const long = ws1InterpolateGeodesic(
      { lat: 0, lng: 0 },
      ws1Destination(0, 0, 45, 250),
      100,
    );
    // n = ⌈250/100⌉ = 3 segmen → 4 titik (A + 2 antara + B), tiap segmen ≈ 83,3 NM
    expect(long.length).toBe(4);
    expect(long[0].lat).toBeCloseTo(0, 9);
    const mid = long[1];
    expect(ws1DistanceNm(long[0], mid)).toBeCloseTo(250 / 3, 6);
    const end = long[long.length - 1];
    expect(ws1DistanceNm({ lat: 0, lng: 0 }, end)).toBeCloseTo(250, 6);
  });
});

describe('DTG perkiraan waktu datum (penamaan §4.7.67)', () => {
  test('LKP 17 Nov 19.00Z + 6 jam → 180100Z NOV', () => {
    expect(ws1DatumDtgUtc('1117.1900 Z', 6)).toBe('180100Z NOV');
  });

  test('waktu tidak valid → null (tidak menebak)', () => {
    expect(ws1DatumDtgUtc('', 6)).toBeNull();
    expect(ws1DatumDtgUtc(undefined, 6)).toBeNull();
    expect(ws1DatumDtgUtc('abc', 6)).toBeNull();
  });

  test('konversi zona: TW 1117 1900 G (WIB) + 6 jam → 171800Z NOV', () => {
    // 19.00 WIB = 12.00Z; +6 jam = 18.00Z tanggal 17 → 171800Z NOV
    expect(ws1DatumDtgUtc('TW 1117 1900 G', 6)).toBe('171800Z NOV');
  });
});

describe('Validasi dasar (bagian 7 panduan)', () => {
  test('a ≤ 0 menghasilkan peringatan waktu datum', () => {
    const r = computeDatumWs1({ ...ACCEPTANCE, hours: 0 });
    expect(r.warnings.join(' ')).toContain('Hours of drift');
  });

  test('kecepatan negatif & arah di luar 0–360 menghasilkan peringatan', () => {
    const r = computeDatumWs1({
      ...ACCEPTANCE,
      seaCurrentSpeed: -1,
      windFrom: 370,
    });
    const w = r.warnings.join(' ');
    expect(w).toContain('negatif');
    expect(w).toContain('0–360');
  });

  test('x/y = 0 → peringatan pilih Tabel J', () => {
    const r = computeDatumWs1({ ...ACCEPTANCE, x: 0, y: 0 });
    expect(r.warnings.join(' ')).toContain('Tabel J');
  });
});
