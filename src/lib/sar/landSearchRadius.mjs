// Panduan Penghitungan Search Radius — Land Search (Worksheet No. 4)
// Sumber: Worksheet No. 4 (Search Radius), Appendix J Tabel J-1/J-2/J-3,
// Land_Search FOE slide 8, 9, 12, 16, 20, 22.
// Satuan: NM. Kasus: pesawat (x₀ dari Tabel J-2), DR 10% × Tr tetap (Tabel J-3).
// INS, VOR, TACAN tidak dipakai; craft kecil/kapal tidak dicakup.

// fs pencarian ke-1 .. ke-5 (Worksheet No. 4).
export const LAND_FS_OPTIONS = [1.1, 1.8, 2.0, 2.3, 2.6];

// Tabel J-2: fix error dasar pesawat (x₀).
// GPS = self contained navigation system → 5 NM; non-GPS = aircraft other → 10 NM.
export const LAND_X0_NM = { gps: 5, nonGps: 10 };

// Tabel J-1 (subset yang dipakai app): fix error navigasi SRU (y).
// INS (0.5 NM/flight hour), VOR, dan TACAN tidak dipakai di app.
export const LAND_SRU_NAV_OPTIONS = [
  { id: 'gps', label: 'GPS — 0.1 NM', value: 0.1 },
  { id: 'radar', label: 'Radar — 1 NM', value: 1 },
  { id: 'visual', label: 'Visual fix (3 lines) — 1 NM', value: 1 },
  { id: 'celestial', label: 'Celestial fix (3 lines) — 2 NM', value: 2 },
  { id: 'marine-radio-beacon', label: 'Marine Radio Beacon (3 beacon fix) — 4 NM', value: 4 },
  { id: 'loran-c', label: 'LORAN C — 1 NM', value: 1 },
];

const roundTo = (value, decimals) => Number(value.toFixed(decimals));

// R dibulatkan ke atas ke bilangan bulat NM (semua kasus).
// Bulatkan dulu ke 6 desimal agar artefak floating point (mis. 10,0000001 → 11) tidak terjadi.
export function ceilRadiusNm(value) {
  return Math.ceil(roundTo(value, 6));
}

// Satu kolom Worksheet No. 4:
//   x = x₀ + 0.1 × Tr   (x₀ dari Tabel J-2; DR 10% dari Tr, Tabel J-3 pesawat)
//   e = √(x² + y²)
//   R = e × fs          (fs pencarian ke-1..5)
//   R dibulatkan ke atas ke bilangan bulat NM.
export function computePointRadius({ trNm, x0Nm, yNm, fs }) {
  const x = x0Nm + 0.1 * trNm;
  const e = Math.sqrt(x * x + yNm * yNm);
  const r = e * fs;
  return {
    trNm,
    xNm: roundTo(x, 2),
    yNm,
    eNm: roundTo(e, 4),
    rNm: roundTo(r, 3),
    rRoundedNm: ceilRadiusNm(r),
  };
}

// Trapesium search area di sekitar dua possibility area lingkaran (garis singgung
// luar dua lingkaran + dua garis penutup tegak lurus garis rute yang menyinggung
// sisi luar lingkaran A dan B — slide 9 & 13). Radius memakai nilai R bulat dari
// worksheet. a dan b adalah sisi penutup di A dan B, h jarak antar keduanya;
// L = (a + b) × h / 2 (slide 22). Sisi TIDAK dihitung dari 2R: garis singgung
// luar radius berbeda membuat a ≠ 2R_A dan b ≠ 2R_B.
//
// Konstruksi eksak di modul ini setara dengan mengukur a, b, h dari trapesium
// yang digambar di peta dengan skala (langkah gambar 1-7 panduan).
export function computeLegTrapezoid(dNm, rANm, rBNm) {
  if (!(dNm > 0) || !(rANm > 0) || !(rBNm > 0)) {
    return { valid: false, degenerate: false, wANm: 0, wBNm: 0, aNm: 0, bNm: 0, hNm: 0, areaSqNm: 0 };
  }
  const delta = rBNm - rANm;
  // Untuk d ≤ |Δ| garis singgung luar tidak terbentuk (satu lingkaran tertutup
  // siluet yang lain); fallback: lebar seragam = radius terbesar.
  if (dNm <= Math.abs(delta)) {
    const w = Math.max(rANm, rBNm);
    const a = 2 * w;
    const h = dNm + rANm + rBNm;
    return {
      valid: true,
      degenerate: true,
      wANm: w,
      wBNm: w,
      aNm: roundTo(a, 2),
      bNm: roundTo(a, 2),
      hNm: roundTo(h, 2),
      areaSqNm: roundTo(((a + a) * h) / 2, 2),
    };
  }
  const root = Math.sqrt(dNm * dNm - delta * delta);
  const m = delta / root;             // gradien garis singgung atas terhadap sumbu rute
  const c = (rANm * dNm) / root;      // intercept garis singgung atas di titik A
  const wA = c - m * rANm;            // setengah-lebar di garis penutup A (x = −R_A)
  const wB = m * (dNm + rBNm) + c;    // setengah-lebar di garis penutup B (x = d + R_B)
  const a = 2 * wA;
  const b = 2 * wB;
  const h = dNm + rANm + rBNm;
  return {
    valid: true,
    degenerate: false,
    wANm: roundTo(wA, 4),
    wBNm: roundTo(wB, 4),
    aNm: roundTo(a, 2),
    bNm: roundTo(b, 2),
    hNm: roundTo(h, 2),
    areaSqNm: roundTo(((a + b) * h) / 2, 2),
  };
}

// Luas possibility area satu titik = lingkaran berjari-jari R (slide 9/13).
export function possibilityCircleAreaSqNm(rNm) {
  if (!(rNm > 0)) return 0;
  return roundTo(Math.PI * rNm * rNm, 2);
}
