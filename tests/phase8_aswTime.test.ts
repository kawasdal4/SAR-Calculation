/**
 * PHASE 8 — Parser waktu ASW liberal (aswTime.ts).
 * Kasus lapiran: soal EXE FAKFAK 2026 — worksheet ASW terisi angin tetapi
 * kolom "Time of observation" dan "Time interval" kosong, karena parser lama
 * hanya mengenali format Basarnas MMDD.HHMM ("1117.0700 Z") padahal soal
 * menulis "17 Nov 2026 07.00 UTC (15.56 WIT)" dan datum "18 November 2026
 * pukul 01.00 UTC". handleApplyASW lama juga membuat baris dengan waktu kosong.
 * Jalankan: bun test tests/phase8_aswTime.test.ts
 */
import { test, expect } from 'bun:test';
import {
  parseSarTimeToHours,
  generateAswObservationTimes,
  buildAswObservationsFromCase,
} from '../src/lib/sar/aswTime';

// ---------------------------------------------------------------------------
// parseSarTimeToHours — format yang mungkin dikirim model / tertulis di soal
// ---------------------------------------------------------------------------

test('parse format Basarnas MMDD.HHMM tetap benar (regresi lama)', () => {
  // 1117.0700 Z = Nov 17, 07:00 UTC
  expect(parseSarTimeToHours('1117.0700 Z')).toEqual({ hours: 17 * 24 + 7, hasDay: true });
  // 1122.1600 Z = Nov 22, 16:00 UTC (contoh tombol "Muat Contoh Kasus")
  expect(parseSarTimeToHours('1122.1600 Z')).toEqual({ hours: 22 * 24 + 16, hasDay: true });
  // tanpa pemisah, seperti parser lama
  expect(parseSarTimeToHours('11170700')).toEqual({ hours: 17 * 24 + 7, hasDay: true });
});

test('parse waktu berlabel zona dari soal FAKFAK', () => {
  expect(parseSarTimeToHours('07.00 UTC')).toEqual({ hours: 7, hasDay: false });
  expect(parseSarTimeToHours('01.00 UTC')).toEqual({ hours: 1, hasDay: false });
  expect(parseSarTimeToHours('0700Z')).toEqual({ hours: 7, hasDay: false });
  expect(parseSarTimeToHours('07:00')).toEqual({ hours: 7, hasDay: false });
});

test('parse waktu dengan tanggal lengkap dan pilih waktu UTC bukan WIT', () => {
  // Soal mencantumkan waktu lokal dulu, UTC dalam kurung — parser wajib
  // mengambil yang berlabel UTC/Z.
  const distress = parseSarTimeToHours('17 Nov 2026 07.00 UTC (15.56 WIT)');
  expect(distress).toEqual({ hours: 17 * 24 + 7, hasDay: true });

  const datum = parseSarTimeToHours('18 November 2026 pukul 10.00 WIT (01.00 UTC)');
  expect(datum).toEqual({ hours: 18 * 24 + 1, hasDay: true });
});

test('parse tanggal numerik dd/mm', () => {
  expect(parseSarTimeToHours('17/11 0700')).toEqual({ hours: 17 * 24 + 7, hasDay: true });
});

test('tolak input tanpa jam yang sah', () => {
  expect(parseSarTimeToHours('')).toBeNull();
  expect(parseSarTimeToHours('tidak ada waktu')).toBeNull();
  expect(parseSarTimeToHours('distress')).toBeNull();
});

// ---------------------------------------------------------------------------
// generateAswObservationTimes — jendela observasi BMKG
// ---------------------------------------------------------------------------

// Skenario FAKFAK: distress 17 Nov 07.00 UTC, datum 18 Nov 01.00 UTC → 18 jam.
// Mode 6h: 07.00–09.00 (jendela obs 06), 09.00–15.00 (obs 12), 15.00–21.00
// (obs 18), 21.00–01.00 (obs 00) → total 18 jam.
const FAKFAK_EXPECTED = [
  { timeObs: '06.00', timeStart: '07.00', timeEnd: '09.00', hours: 2 },
  { timeObs: '12.00', timeStart: '09.00', timeEnd: '15.00', hours: 6 },
  { timeObs: '18.00', timeStart: '15.00', timeEnd: '21.00', hours: 6 },
  { timeObs: '00.00', timeStart: '21.00', timeEnd: '01.00', hours: 4 },
];

test('skenario FAKFAK: waktu format soal ("07.00 UTC" → "01.00 UTC", tanpa hari)', () => {
  expect(generateAswObservationTimes('07.00 UTC', '01.00 UTC', '6h')).toEqual(FAKFAK_EXPECTED);
});

test('skenario FAKFAK: waktu dengan tanggal lengkap', () => {
  expect(generateAswObservationTimes(
    '17 Nov 2026 07.00 UTC',
    '18 November 2026 pukul 01.00 UTC',
    '6h',
  )).toEqual(FAKFAK_EXPECTED);
});

test('skenario FAKFAK: format Basarnas memberi hasil identik', () => {
  expect(generateAswObservationTimes('1117.0700 Z', '1118.0100 Z', '6h')).toEqual(FAKFAK_EXPECTED);
});

test('contoh tombol "Muat Contoh Kasus" (1122.1600 Z → 1123.0700 Z) tetap 3 baris', () => {
  const rows = generateAswObservationTimes('1122.1600 Z', '1123.0700 Z', '6h');
  expect(rows.map((r) => [r.timeStart, r.timeEnd, r.hours])).toEqual([
    ['16.00', '21.00', 5],
    ['21.00', '03.00', 6],
    ['03.00', '07.00', 4],
  ]);
});

test('mode 3h memakai jendela 3 jam', () => {
  const rows = generateAswObservationTimes('07.00 UTC', '10.30 UTC', '3h');
  expect(rows.map((r) => [r.timeStart, r.timeEnd, r.hours])).toEqual([
    ['07.00', '07.30', 0.5],
    ['07.30', '10.30', 3],
  ]);
});

test('tolak rentang tidak sah', () => {
  // datum sama dengan distress (tanpa hari) → span nol, tidak ada baris
  expect(generateAswObservationTimes('07.00 UTC', '07.00 UTC', '6h')).toEqual([]);
  // format Basarnas lintas hari → 4 baris (regresi skenario FAKFAK)
  expect(generateAswObservationTimes('1117.0700 Z', '1118.0100 Z', '6h').length).toBe(4);
  // lebih dari 72 jam → ditolak
  expect(generateAswObservationTimes('0101.0000 Z', '0105.0001 Z', '6h')).toEqual([]);
  // waktu tidak bisa diparse → kosong (fallback perilaku lama)
  expect(generateAswObservationTimes('distress?', 'datum?', '6h')).toEqual([]);
});

// ---------------------------------------------------------------------------
// buildAswObservationsFromCase — yang dipakai handleApplyASW (page.tsx)
// ---------------------------------------------------------------------------

test('buildAswObservationsFromCase mengisi waktu + merge angin per indeks (FAKFAK)', () => {
  const rows = buildAswObservationsFromCase(
    '17 Nov 2026 07.00 UTC',
    '18 November 2026 01.00 UTC',
    '6h',
    [
      { windDirFrom: 90, windSpeed: 18 },
      { windDirFrom: 110, windSpeed: 20 },
      { windDirFrom: 100, windSpeed: 19 },
      { windDirFrom: 95, windSpeed: 17 },
    ],
  );
  expect(rows.map((r) => r.timeObs)).toEqual(['06.00', '12.00', '18.00', '00.00']);
  expect(rows.map((r) => `${r.timeStart}–${r.timeEnd}`)).toEqual([
    '07.00–09.00', '09.00–15.00', '15.00–21.00', '21.00–01.00',
  ]);
  expect(rows.map((r) => r.hours)).toEqual([2, 6, 6, 4]);
  expect(rows.map((r) => r.windDirFrom)).toEqual([90, 110, 100, 95]);
  expect(rows.map((r) => r.windSpeed)).toEqual([18, 20, 19, 17]);
  // tidak ada lagi sel waktu kosong
  for (const r of rows) {
    expect(r.timeObs).not.toBe('');
    expect(r.timeStart).not.toBe('');
    expect(r.timeEnd).not.toBe('');
    expect(r.hours).toBeGreaterThan(0);
  }
});

test('buildAswObservationsFromCase: angin kurang → baris sisa angin 0, waktu tetap terisi', () => {
  const rows = buildAswObservationsFromCase('07.00 UTC', '01.00 UTC', '6h', [
    { windDirFrom: 90, windSpeed: 18 },
  ]);
  expect(rows.length).toBe(4);
  expect(rows[0].windSpeed).toBe(18);
  expect(rows[3].windSpeed).toBe(0);
  expect(rows[3].timeObs).toBe('00.00');
});

test('buildAswObservationsFromCase: waktu tidak terparse → fallback baris lama (tanpa waktu)', () => {
  const rows = buildAswObservationsFromCase('?', '?', '6h', [{ windDirFrom: 90, windSpeed: 18 }]);
  expect(rows).toEqual([{ timeObs: '', timeStart: '', timeEnd: '', hours: 0, windDirFrom: 90, windSpeed: 18 }]);
});
