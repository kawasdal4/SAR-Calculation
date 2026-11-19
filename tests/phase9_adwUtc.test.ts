/**
 * PHASE 9 — Konversi zona waktu otomatis ke UTC (Z) untuk point A.1 ADW.
 * Kasus: soal PK-XYZ menulis "17 Nov 2026 15.56 WIT" (WIT = UTC+9) — point
 * A.1 worksheet ADW wajib ditampilkan dalam format Basarnas MMDD.HHMM pada
 * zona UTC (Z): 1117.0656 Z. Konversi memakai konstanta zona tab Penghitungan
 * Dasar (basicCalculations.TIMEZONES) + parser TW/DTG (dtg.mjs).
 * Jalankan: bun test tests/phase9_adwUtc.test.ts
 */
import { test, expect } from 'bun:test';
import {
  describeBasarnasUtcConversion,
  detectSourceZone,
  toBasarnasTimeFormat,
  addMinutesBasarnas,
} from '../src/lib/sar/aswTime';

// ---------------------------------------------------------------------------
// detectSourceZone — token zona sumber
// ---------------------------------------------------------------------------

test('detectSourceZone: kata zona Indonesia + huruf TW/DTG + offset numerik', () => {
  expect(detectSourceZone('15.56 WIT')).toMatchObject({ zone: 'WIT', offsetHours: 9 });
  expect(detectSourceZone('19.00 WIB')).toMatchObject({ zone: 'WIB', offsetHours: 7 });
  expect(detectSourceZone('19.00 WITA')).toMatchObject({ zone: 'WITA', offsetHours: 8 });
  expect(detectSourceZone('1900 G')).toMatchObject({ zone: 'WIB', offsetHours: 7 });
  expect(detectSourceZone('171847I NOV 2026')).toMatchObject({ zone: 'WIT', offsetHours: 9 });
  expect(detectSourceZone('07.00 UTC')).toMatchObject({ zone: 'UTC', offsetHours: 0 });
  expect(detectSourceZone('1122.1600 Z')).toMatchObject({ zone: 'UTC', offsetHours: 0 });
  expect(detectSourceZone('17 Nov 2026 15.56 UTC+9')).toMatchObject({ zone: 'UTC', offsetHours: 9 });
  expect(detectSourceZone('17 Nov 2026 07.00')).toBeNull();
});

// ---------------------------------------------------------------------------
// toBasarnasTimeFormat — kasus PK-XYZ (WIT) dan zona Indonesia lain
// ---------------------------------------------------------------------------

test('kasus PK-XYZ: 15.56 WIT → 1117.0656 Z (konversi otomatis -9 jam)', () => {
  expect(toBasarnasTimeFormat('17 Nov 2026 15.56 WIT')).toBe('1117.0656');
  expect(toBasarnasTimeFormat('17 Nov 2026 16.05 WIT')).toBe('1117.0705');
});

test('WIT tanpa tanggal pada input → pakai fallbackDate worksheet', () => {
  expect(toBasarnasTimeFormat('15.56 WIT', '2026-11-17')).toBe('1117.0656');
  expect(toBasarnasTimeFormat('01.00 WIT', '18 Nov 2026')).toBe('1117.1600');
});

test('pergantian hari ke belakang: 18 Nov 01.00 WIT → 17 Nov 16.00 Z', () => {
  expect(toBasarnasTimeFormat('18 Nov 2026 01.00 WIT')).toBe('1117.1600');
});

test('WIB -7 dan WITA -8', () => {
  expect(toBasarnasTimeFormat('17 Nov 2026 19.00 WIB')).toBe('1117.1200');
  expect(toBasarnasTimeFormat('17 Nov 2026 19.00 WITA')).toBe('1117.1100');
});

test('offset numerik "UTC+9" ikut dikonversi (bukan dianggap sudah UTC)', () => {
  expect(toBasarnasTimeFormat('17 Nov 2026 15.56 UTC+9')).toBe('1117.0656');
});

test('penggulungan bulan: 1 Des 00.30 WIT → 30 Nov 15.30 Z', () => {
  expect(toBasarnasTimeFormat('1 Des 2026 00.30 WIT')).toBe('1130.1530');
});

test('huruf zona TW/DTG lewat parser tab Penghitungan Dasar (dtg.mjs)', () => {
  // 171847G = 17 Nov 18.47 WIB → 11.47 Z
  expect(toBasarnasTimeFormat('171847G NOV 2026')).toBe('1117.1147');
  // 171847I = 17 Nov 18.47 WIT → 09.47 Z
  expect(toBasarnasTimeFormat('171847I NOV 2026')).toBe('1117.0947');
  // TW 1117 1900 G = 17 Nov 19.00 WIB → 12.00 Z
  expect(toBasarnasTimeFormat('TW 1117 1900 G')).toBe('1117.1200');
});

// ---------------------------------------------------------------------------
// Perilaku lama tetap: sudah UTC / tanpa zona / pasangan lokal + UTC
// ---------------------------------------------------------------------------

test('pasangan lokal + UTC eksplisit: nilai UTC yang dipakai, tanpa konversi ulang', () => {
  expect(toBasarnasTimeFormat('17 Nov 2026 07.00 UTC (15.56 WIT)')).toBe('1117.0700');
  expect(toBasarnasTimeFormat('18 Nov 2026 10.00 WIT (03.00 UTC)')).toBe('1118.0300');
});

test('tanpa zona dianggap sudah UTC (regresi perilaku lama)', () => {
  expect(toBasarnasTimeFormat('17/11 0700')).toBe('1117.0700');
  expect(toBasarnasTimeFormat('1117.0700')).toBe('1117.0700');
  expect(toBasarnasTimeFormat('1117.0700 Z')).toBe('1117.0700');
  expect(toBasarnasTimeFormat('17 Nov 2026 07.00 UTC')).toBe('1117.0700');
});

test('input tidak sah tetap null', () => {
  expect(toBasarnasTimeFormat('bukan waktu')).toBeNull();
  expect(toBasarnasTimeFormat('07.00 UTC')).toBeNull(); // tanpa tanggal
  expect(toBasarnasTimeFormat('15.56 WIT')).toBeNull(); // tanpa tanggal & fallback
});

// ---------------------------------------------------------------------------
// Metadata konversi untuk hint UI worksheet ADW
// ---------------------------------------------------------------------------

test('describeBasarnasUtcConversion: metadata lengkap 15.56 WIT → 06.56 Z', () => {
  const info = describeBasarnasUtcConversion('17 Nov 2026 15.56 WIT');
  expect(info).toEqual({
    value: '1117.0656',
    converted: true,
    fromZone: 'WIT',
    offsetHours: 9,
    localTimeText: '15.56',
    utcTimeText: '06.56',
    dayShift: 0,
  });
});

test('describeBasarnasUtcConversion: dayShift -1 saat UTC mundur satu hari', () => {
  const info = describeBasarnasUtcConversion('18 Nov 2026 01.00 WIT');
  expect(info?.dayShift).toBe(-1);
  expect(info?.value).toBe('1117.1600');
});

test('describeBasarnasUtcConversion: tanpa zona → converted false', () => {
  const info = describeBasarnasUtcConversion('17 Nov 2026 07.00 UTC');
  expect(info?.converted).toBe(false);
  expect(info?.value).toBe('1117.0700');
});

// ---------------------------------------------------------------------------
// Rantai A.1 + B.7 → waktu distress ASW tetap berjalan di nilai UTC
// ---------------------------------------------------------------------------

test('A.1 hasil konversi bisa langsung dipakai addMinutesBasarnas (B.7)', () => {
  expect(addMinutesBasarnas(toBasarnasTimeFormat('17 Nov 2026 15.56 WIT') ?? '', 4)).toBe(
    '1117.0700',
  );
});
