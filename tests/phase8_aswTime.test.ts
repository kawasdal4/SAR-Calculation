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
  parseDateParts,
  formatBasarnasTime,
  toBasarnasTimeFormat,
  roundHalfUpToMinute,
  addMinutesBasarnas,
  generateAswObservationTimes,
  generateAswObservationWindows,
  buildAswObservationsFromCase,
} from '../src/lib/sar/aswTime';

// ---------------------------------------------------------------------------
// parseSarTimeToHours — format yang mungkin dikirim model / tertulis di soal
// ---------------------------------------------------------------------------

test('parse format Basarnas MMDD.HHMM tetap benar (regresi lama)', () => {
  // 1117.0700 Z = Nov 17, 07:00 UTC
  expect(parseSarTimeToHours('1117.0700 Z')).toEqual({
    hours: 17 * 24 + 7, hasDay: true, day: 17, month: 11,
  });
  // 1122.1600 Z = Nov 22, 16:00 UTC (contoh tombol "Muat Contoh Kasus")
  expect(parseSarTimeToHours('1122.1600 Z')).toEqual({
    hours: 22 * 24 + 16, hasDay: true, day: 22, month: 11,
  });
  // tanpa pemisah, seperti parser lama
  expect(parseSarTimeToHours('11170700')).toEqual({
    hours: 17 * 24 + 7, hasDay: true, day: 17, month: 11,
  });
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
  expect(distress).toEqual({ hours: 17 * 24 + 7, hasDay: true, day: 17, month: 11 });

  const datum = parseSarTimeToHours('18 November 2026 pukul 10.00 WIT (01.00 UTC)');
  expect(datum).toEqual({ hours: 18 * 24 + 1, hasDay: true, day: 18, month: 11 });
});

test('parse tanggal numerik dd/mm', () => {
  expect(parseSarTimeToHours('17/11 0700')).toEqual({
    hours: 17 * 24 + 7, hasDay: true, day: 17, month: 11,
  });
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

// ---------------------------------------------------------------------------
// Pasangkan angin per WAKTU observasi (obsTime) — bukan per urutan array.
// Bug nyata: tabel "Data Angin" dua hari (0000 Z, 0600 Z, 1200 Z, 1800 Z per
// hari) → angin jam 00.00 (127°/14) justru dipakai untuk baris 06.00 karena
// merge lama per indeks.
// ---------------------------------------------------------------------------

// Tabel soal pengguna: dua hari, empat observasi per hari (Z).
const DATA_ANGIN_2_HARI = [
  { obsTime: '17 November 2026 0000 Z', windDirFrom: 127, windSpeed: 14 },
  { obsTime: '17 November 2026 0600 Z', windDirFrom: 162, windSpeed: 15 },
  { obsTime: '17 November 2026 1200 Z', windDirFrom: 150, windSpeed: 18 },
  { obsTime: '17 November 2026 1800 Z', windDirFrom: 170, windSpeed: 15 },
  { obsTime: '18 November 2026 0000 Z', windDirFrom: 162, windSpeed: 20 },
  { obsTime: '18 November 2026 0600 Z', windDirFrom: 154, windSpeed: 15 },
  { obsTime: '18 November 2026 1200 Z', windDirFrom: 162, windSpeed: 15 },
  { obsTime: '18 November 2026 1800 Z', windDirFrom: 153, windSpeed: 20 },
];

test('angin ber-obsTime dua hari dipasangkan per WAKTU: baris 06.00 dapat angin 0600 Z (bukan 0000 Z)', () => {
  const rows = buildAswObservationsFromCase(
    '17 Nov 2026 07.00 UTC',
    '18 November 2026 01.00 UTC',
    '6h',
    DATA_ANGIN_2_HARI,
  );
  expect(rows.map((r) => r.timeObs)).toEqual(['06.00', '12.00', '18.00', '00.00']);
  expect(rows.map((r) => `${r.windDirFrom}°/${r.windSpeed}`)).toEqual([
    '162°/15', // 0600 Z 17 Nov — bukan 127°/14 milik 0000 Z
    '150°/18', // 1200 Z 17 Nov
    '170°/15', // 1800 Z 17 Nov
    '162°/20', // 0000 Z 18 Nov — bukan 170°/15 milik 1800 Z 17 Nov
  ]);
});

test('angin ber-obsTime tanpa tanggal: alignment kronologis melewatkan entri sebelum distress', () => {
  // 0000 Z pertama (sebelum distress 07.00) dilewati; 0000 Z kedua yang
  // dipakai untuk baris 00.00 — urutan kronologis wajib terjaga.
  const rows = buildAswObservationsFromCase('07.00 UTC', '01.00 UTC', '6h', [
    { obsTime: '0000 Z', windDirFrom: 127, windSpeed: 14 },
    { obsTime: '0600 Z', windDirFrom: 162, windSpeed: 15 },
    { obsTime: '1200 Z', windDirFrom: 150, windSpeed: 18 },
    { obsTime: '1800 Z', windDirFrom: 170, windSpeed: 15 },
    { obsTime: '0000 Z', windDirFrom: 162, windSpeed: 20 },
  ]);
  expect(rows.map((r) => `${r.windDirFrom}°/${r.windSpeed}`)).toEqual(['162°/15', '150°/18', '170°/15', '162°/20']);
});

test('angin ber-obsTime 4 baris persis (sudah sesuai jendela) tetap benar', () => {
  const rows = buildAswObservationsFromCase('17 Nov 2026 07.00 UTC', '18 November 2026 01.00 UTC', '6h', [
    { obsTime: '17 November 2026 0600 Z', windDirFrom: 162, windSpeed: 15 },
    { obsTime: '17 November 2026 1200 Z', windDirFrom: 150, windSpeed: 18 },
    { obsTime: '17 November 2026 1800 Z', windDirFrom: 170, windSpeed: 15 },
    { obsTime: '18 November 2026 0000 Z', windDirFrom: 162, windSpeed: 20 },
  ]);
  expect(rows.map((r) => `${r.windDirFrom}°/${r.windSpeed}`)).toEqual(['162°/15', '150°/18', '170°/15', '162°/20']);
});

test('angin hari lain dengan jam sama TIDAK menempel ke baris (0600 Z 18 Nov ≠ baris 06.00 17 Nov)', () => {
  const rows = buildAswObservationsFromCase('17 Nov 2026 07.00 UTC', '18 November 2026 01.00 UTC', '6h', [
    { obsTime: '18 November 2026 0600 Z', windDirFrom: 154, windSpeed: 15 },
    { obsTime: '18 November 2026 1200 Z', windDirFrom: 162, windSpeed: 15 },
  ]);
  // Tidak ada entri 17 Nov → semua baris 0 (bukan mengambil angin hari lain).
  expect(rows.map((r) => r.windSpeed)).toEqual([0, 0, 0, 0]);
});

test('obsTime ada tetapi tidak satu pun terparse → fallback perilaku lama (per indeks)', () => {
  const rows = buildAswObservationsFromCase('17 Nov 2026 07.00 UTC', '18 November 2026 01.00 UTC', '6h', [
    { obsTime: 'n/a', windDirFrom: 90, windSpeed: 18 },
    { obsTime: '??', windDirFrom: 110, windSpeed: 20 },
  ]);
  expect(rows.map((r) => r.windDirFrom)).toEqual([90, 110, 0, 0]);
});

test('generateAswObservationWindows: jam absolut per baris (FAKFAK dua hari)', () => {
  const rows = generateAswObservationWindows('17 Nov 2026 07.00 UTC', '18 November 2026 01.00 UTC', '6h');
  expect(rows.map((r) => [r.absObs, r.absStart, r.absEnd])).toEqual([
    [17 * 24 + 6, 17 * 24 + 7, 17 * 24 + 9],   // obs 06.00 17 Nov, interval 07.00–09.00
    [17 * 24 + 12, 17 * 24 + 9, 17 * 24 + 15], // obs 12.00
    [17 * 24 + 18, 17 * 24 + 15, 17 * 24 + 21], // obs 18.00
    [18 * 24 + 0, 17 * 24 + 21, 18 * 24 + 1],  // obs 00.00 18 Nov (interval lintas tengah malam)
  ]);
  expect(rows.every((r) => r.absAnchored)).toBe(true);
  // Tanpa tanggal di kedua waktu → abs tidak dijangkar (pencocokan per jam saja).
  const dayless = generateAswObservationWindows('07.00 UTC', '01.00 UTC', '6h');
  expect(dayless.every((r) => !r.absAnchored)).toBe(true);
});

// ---------------------------------------------------------------------------
// Konversi ke format Basarnas (permintaan workflow: format soal apa pun
// dikonversi otomatis oleh worksheet)
// ---------------------------------------------------------------------------

test('parseDateParts: ISO dan nama bulan Indonesia/Inggris', () => {
  expect(parseDateParts('2026-11-17')).toEqual({ year: 2026, month: 11, day: 17 });
  expect(parseDateParts('17 Nov 2026')).toEqual({ year: 2026, month: 11, day: 17 });
  expect(parseDateParts('17 November 2026')).toEqual({ year: 2026, month: 11, day: 17 });
  expect(parseDateParts('17 SEPTEMBER 2026')).toEqual({ year: 2026, month: 9, day: 17 });
  expect(parseDateParts('1 Agustus 2026')).toEqual({ year: 2026, month: 8, day: 1 });
  expect(parseDateParts('-')).toBeNull();
});

test('toBasarnasTimeFormat: format soal apa pun → MMDD.HHMM', () => {
  expect(toBasarnasTimeFormat('17 Nov 2026 07.00 UTC')).toBe('1117.0700');
  expect(toBasarnasTimeFormat('18 November 2026 pukul 01.00 UTC')).toBe('1118.0100');
  expect(toBasarnasTimeFormat('17/11 0700')).toBe('1117.0700');
  // idempoten: nilai Basarnas tetap sama
  expect(toBasarnasTimeFormat('1117.0700')).toBe('1117.0700');
  expect(toBasarnasTimeFormat('1117.0700 Z')).toBe('1117.0700');
  // bulan/tanggal diisi dari tanggal worksheet bila string waktu tanpa tanggal
  expect(toBasarnasTimeFormat('07.00 UTC', '2026-11-17')).toBe('1117.0700');
  expect(toBasarnasTimeFormat('01.00 UTC', '17 Nov 2026')).toBe('1117.0100');
  // tanpa tanggal di mana pun → null (worksheet memakai nilai asli)
  expect(toBasarnasTimeFormat('07.00 UTC')).toBeNull();
  expect(toBasarnasTimeFormat('bukan waktu')).toBeNull();
});

test('roundHalfUpToMinute: aturan setengah-ke-atas (contoh dari panduan)', () => {
  expect(roundHalfUpToMinute(8.129)).toBe(8);
  expect(roundHalfUpToMinute(8.5)).toBe(9);
  expect(roundHalfUpToMinute(8.499)).toBe(8);
  // skenario FAKFAK: 12.000 ft ÷ 2.904 ft/min = 4,132 → 4 menit
  expect(roundHalfUpToMinute(12000 / ((230 * 101) / 8))).toBe(4);
});

test('addMinutesBasarnas: tambah menit + penggulungan tanggal/bulan', () => {
  expect(addMinutesBasarnas('1117.0700', 4)).toBe('1117.0704');
  expect(addMinutesBasarnas('17 Nov 2026 07.00 UTC', 4)).toBe('1117.0704');
  // melewati 2400 → tanggal berikutnya
  expect(addMinutesBasarnas('1117.2330', 45)).toBe('1118.0015');
  // melewati akhir bulan → bulan berikutnya (30 Nov + 45 menit → 1 Des)
  expect(addMinutesBasarnas('1130.2330', 45)).toBe('1201.0015');
  // waktu tanpa tanggal diambil dari tanggal worksheet
  expect(addMinutesBasarnas('07.00 UTC', 4, '2026-11-17')).toBe('1117.0704');
  expect(addMinutesBasarnas('bukan waktu', 4)).toBeNull();
});

// ---------------------------------------------------------------------------
// Alur lengkap permintaan workflow: distress ASW = ADW A.1 + B.7 (pembulatan)
// ---------------------------------------------------------------------------

test('skenario FAKFAK: distress ASW = A.1 (07.00 UTC) + B.7 (td 4,13 → 4 menit) = 1117.0704', () => {
  const tdAircraft = 12000 / ((230 * 101) / 8); // B.6 = (TASg × 101)/gr
  const tdRounded = roundHalfUpToMinute(tdAircraft);
  const distress = addMinutesBasarnas('17 Nov 2026 07.00 UTC', tdRounded, '2026-11-17');
  expect(distress).toBe('1117.0704');

  // Worksheet ASW memakai distress turunan: jendela mulai 07.04
  const rows = generateAswObservationTimes(`${distress} Z`, '1118.0100 Z', '6h');
  expect(rows.map((r) => [r.timeStart, r.timeEnd, r.hours])).toEqual([
    ['07.04', '09.00', 1.9],
    ['09.00', '15.00', 6],
    ['15.00', '21.00', 6],
    ['21.00', '01.00', 4],
  ]);
});

test('formatBasarnasTime menolak waktu tanpa bulan/tanggal tanpa fallback', () => {
  expect(formatBasarnasTime(parseSarTimeToHours('07.00 UTC')!)).toBeNull();
  expect(formatBasarnasTime(parseSarTimeToHours('17 Nov 2026 07.00 UTC')!)).toBe('1117.0700');
});

// ---------------------------------------------------------------------------
// Konvensi grid ASW + konversi zona header (aturan pengguna) — header
// distress/datum masuk worksheet dalam Basarnas MMDD.HHMM Z (zona via
// Penghitungan Dasar: WIB +7/WITA +8/WIT +9 → Z); jam angin & baris observasi
// dipasangkan per LABEL JAM (grid BMKG 00/06/12/18), bukan digeser zona.
// Kartu pilihan waktu di kolom chat tetap memakai format asli soal.
// ---------------------------------------------------------------------------

test('header waktu soal → Basarnas UTC (zona via Penghitungan Dasar)', () => {
  expect(toBasarnasTimeFormat('18 November 2026 13.50 WIB')).toBe('1118.0650');
  expect(toBasarnasTimeFormat('19 November 2026 07.00 WIB')).toBe('1119.0000');
  expect(toBasarnasTimeFormat('03 Desember 2024 10.53 WIT')).toBe('1203.0153');
  // Sudah Basarnas/UTC → idempotent.
  expect(toBasarnasTimeFormat('1117.0700 Z')).toBe('1117.0700');
});

test('grid angin: distress/datum UTC + angin berlabel jam soal tetap terpasang per label jam', () => {
  // Jalur handleApplyASW: distress/datum sudah Basarnas UTC; jam angin soal
  // (grid 00/06/12/18) dipasangkan ke baris berlabel jam sama.
  const rows = buildAswObservationsFromCase('1118.0650 Z', '1119.0000 Z', '6h', [
    { obsTime: '18 November 2026 00.00 WIB', windDirFrom: 50, windSpeed: 5 },
    { obsTime: '18 November 2026 06.00 WIB', windDirFrom: 69, windSpeed: 10 },
    { obsTime: '18 November 2026 12.00 WIB', windDirFrom: 80, windSpeed: 12 },
    { obsTime: '18 November 2026 18.00 WIB', windDirFrom: 96, windSpeed: 10 },
    { obsTime: '19 November 2026 00.00 WIB', windDirFrom: 102, windSpeed: 7 },
    { obsTime: '19 November 2026 06.00 WIB', windDirFrom: 90, windSpeed: 9 },
  ]);
  expect(rows.length).toBe(4);
  expect(rows.map((r) => r.timeObs)).toEqual(['06.00', '12.00', '18.00', '00.00']);
  expect(rows.map((r) => r.windDirFrom)).toEqual([69, 80, 96, 102]);
  expect(rows.map((r) => r.windSpeed)).toEqual([10, 12, 10, 7]);
});
