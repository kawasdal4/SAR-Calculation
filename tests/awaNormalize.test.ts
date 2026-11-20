/**
 * TEST NORMALISASI BARIS ANGIN AWA (bug soal kasus FULL EXERCISE SRX48: isian
 * altitude interval tidak masuk worksheet AWA karena SATU baris rusak membuat
 * computeAWA menolak seluruh perhitungan → semua kolom "—").
 *
 * Diverifikasi:
 * 1. normalizeAwaWindRows — altObs label ("Surface", "3000 FT", FL) → angka;
 *    baris tak valid dibuang; duplikat didedup; urut naik.
 * 2. Integrasi computeAWA — setelah normalisasi, kolom interval (A) terisi
 *    (tidak kosong) untuk tabel angin soal FULL EXERCISE + distress 18000 ft.
 */

import { describe, test, expect } from 'bun:test';
import { computeAWA, normalizeAwaWindRows } from '../src/lib/sar/sarCalculations';

describe('normalizeAwaWindRows', () => {
  test('label ketinggian apa pun → angka feet, urut naik', () => {
    const rows = normalizeAwaWindRows([
      { altObs: '18000 FT', windDirFrom: 120, windSpeed: 26 },
      { altObs: 'Surface', windDirFrom: 200, windSpeed: 20 },
      { altObs: '3.000 ft', windDirFrom: 180, windSpeed: 12 },
      { altObs: 'FL090', windDirFrom: 300, windSpeed: 24 },
    ]);
    expect(rows.map((r) => r.altObs)).toEqual(['0', '3000', '9000', '18000']);
    expect(rows[0]).toEqual({ altObs: '0', windDirFrom: 200, windSpeed: 20 });
  });

  test('baris tak valid dibuang (NaN, arah > 360, kecepatan negatif)', () => {
    const rows = normalizeAwaWindRows([
      { altObs: 'garbage', windDirFrom: 100, windSpeed: 10 },
      { altObs: '3000', windDirFrom: 999, windSpeed: 10 },
      { altObs: '6000', windDirFrom: 100, windSpeed: -1 },
      { altObs: '9000', windDirFrom: 100, windSpeed: 10 },
      null,
      'rusak',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].altObs).toBe('9000');
  });

  test('duplikat altitude didedup (baris ganda model tidak membuat computeAWA gagal)', () => {
    const rows = normalizeAwaWindRows([
      { altObs: '0', windDirFrom: 200, windSpeed: 20 },
      { altObs: 'Surface', windDirFrom: 190, windSpeed: 21 }, // duplikat 0 ft
      { altObs: '3000', windDirFrom: 180, windSpeed: 12 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].altObs).toBe('0');
    expect(rows[0].windDirFrom).toBe(200); // baris pertama yang dipertahankan
  });

  test('alias windSpeedKts/altitudeFt (bentuk seeds/ekstraksi) diterima', () => {
    const rows = normalizeAwaWindRows([
      { altitudeFt: 0, windDirFrom: 200, windSpeedKts: 20 },
      { altitudeFt: 3000, windDirFrom: 180, windSpeedKts: 12 },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({ altObs: '3000', windDirFrom: 180, windSpeed: 12 });
  });

  test('input bukan array → []', () => {
    expect(normalizeAwaWindRows(undefined)).toEqual([]);
    expect(normalizeAwaWindRows('rusak')).toEqual([]);
  });
});

describe('integrasi computeAWA setelah normalisasi (kolom interval terisi)', () => {
  test('tabel angin FULL EXERCISE SRX48 + distress 18000 ft → interval semua baris < target terisi', () => {
    const normalized = normalizeAwaWindRows([
      { altObs: 'Surface', windDirFrom: 200, windSpeed: 20 },
      { altObs: '3000 FT', windDirFrom: 180, windSpeed: 12 },
      { altObs: '6000 FT', windDirFrom: 190, windSpeed: 25 },
      { altObs: '9000 FT', windDirFrom: 300, windSpeed: 24 },
      { altObs: '12000 FT', windDirFrom: 250, windSpeed: 24 },
      { altObs: '18000 FT', windDirFrom: 120, windSpeed: 26 },
      { altObs: '24000 FT', windDirFrom: 330, windSpeed: 40 },
    ]);
    const result = computeAWA(normalized, 18000);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    // Kolom "Altitude interval (A)": baris ≤ target punya interval non-null.
    const withInterval = result.rows.filter((r) => r.intervalLowFt !== null && r.intervalHighFt !== null);
    expect(withInterval.length).toBe(6); // semua kecuali 24000 (di atas target)
    expect(withInterval[0].intervalLowFt).toBe(0);
    // Lapisan terakhir di bawah target menutup sampai target (15.000–18.000).
    const lastBelowTarget = withInterval[withInterval.length - 1];
    expect(lastBelowTarget.intervalHighFt).toBe(18000);
    expect(result.totalAltLossKft).toBeCloseTo(18, 6);
    // Baris 24000 ft: di atas target → interval null (ditampilkan "Di atas target").
    const aboveTarget = result.rows.find((r) => r.altitudeFt === 24000);
    expect(aboveTarget?.intervalLowFt).toBeNull();
    expect(aboveTarget?.intervalHighFt).toBeNull();
  });

  test('SATU baris rusak (mis. altObs "N/A") tidak lagi mengosongkan seluruh worksheet', () => {
    const normalized = normalizeAwaWindRows([
      { altObs: '0', windDirFrom: 200, windSpeed: 20 },
      { altObs: 'N/A', windDirFrom: 180, windSpeed: 12 }, // rusak → dibuang
      { altObs: '6000', windDirFrom: 190, windSpeed: 25 },
      { altObs: '12000', windDirFrom: 250, windSpeed: 24 },
      { altObs: '18000', windDirFrom: 120, windSpeed: 26 },
    ]);
    const result = computeAWA(normalized, 18000);
    expect(result.isValid).toBe(true);
    expect(result.rows.length).toBe(4);
    expect(result.rows.every((r) => Number.isFinite(r.altitudeKft))).toBe(true);
  });
});
