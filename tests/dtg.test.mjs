/**
 * Test parser Format Tanggal-Waktu (DTG / TW).
 * Jalankan: npm run test:dtg
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDtg,
  dtgToZones,
  dtgToIso,
  formatDtg,
  DTG_ZONE_LETTERS,
} from '../src/lib/sar/dtg.mjs';

// ---------------------------------------------------------------------------
// FORMAT TW (Basarnas): [Bulan][Tanggal] [Jam][Menit] [Zona]
// ---------------------------------------------------------------------------

test('TW 1117 1900 G = 17 November pukul 19.00 WIB', () => {
  const p = parseDtg('TW 1117 1900 G');
  assert.ok(p, 'harus ter-parse');
  assert.equal(p.kind, 'TW');
  assert.equal(p.month, 11);
  assert.equal(p.day, 17);
  assert.equal(p.hour, 19);
  assert.equal(p.minute, 0);
  assert.equal(p.year, null);
  assert.equal(p.zone, 'WIB');
  assert.equal(p.zoneLetter, 'G');
  assert.equal(p.zoneAssumed, false);
  assert.equal(p.description, '17 November pukul 19.00 WIB (huruf G)');
});

test('Format materi "1122.1600 Z" = 22 November pukul 16.00 UTC', () => {
  const p = parseDtg('1122.1600 Z');
  assert.ok(p);
  assert.equal(p.kind, 'TW');
  assert.equal(p.month, 11);
  assert.equal(p.day, 22);
  assert.equal(p.hour, 16);
  assert.equal(p.minute, 0);
  assert.equal(p.zone, 'UTC');
  assert.equal(p.zoneLetter, 'Z');
});

test('TW tanpa prefiks & zona H: "0510 1430 H" = 10 Mei pukul 14.30 WITA', () => {
  const p = parseDtg('0510 1430 H');
  assert.ok(p);
  assert.equal(p.month, 5);
  assert.equal(p.day, 10);
  assert.equal(p.hour, 14);
  assert.equal(p.minute, 30);
  assert.equal(p.zone, 'WITA');
  assert.equal(p.zoneLetter, 'H');
});

test('TW zona I: "0207 0905 I" = 7 Februari pukul 09.05 WIT', () => {
  const p = parseDtg('0207 0905 I');
  assert.ok(p);
  assert.equal(p.month, 2);
  assert.equal(p.day, 7);
  assert.equal(p.hour, 9);
  assert.equal(p.minute, 5);
  assert.equal(p.zone, 'WIT');
});

// ---------------------------------------------------------------------------
// FORMAT DTG (militer/NATO): [Tanggal][Jam][Menit][Zona] [Bulan] [Tahun]
// ---------------------------------------------------------------------------

test('171847G NOV 2026 = 17 November 2026 pukul 18.47 WIB', () => {
  const p = parseDtg('171847G NOV 2026');
  assert.ok(p, 'harus ter-parse');
  assert.equal(p.kind, 'DTG');
  assert.equal(p.day, 17);
  assert.equal(p.month, 11);
  assert.equal(p.year, 2026);
  assert.equal(p.hour, 18);
  assert.equal(p.minute, 47);
  assert.equal(p.zone, 'WIB');
  assert.equal(p.zoneLetter, 'G');
  assert.equal(p.description, '17 November 2026 pukul 18.47 WIB (huruf G)');
  assert.equal(dtgToIso(p), '2026-11-17T18:47:00+07:00');
  assert.equal(formatDtg(p), '171847G NOV 2026');
});

test('Varian 2-digit tahun & Zulu: "171847Z NOV 26" → 2026, UTC', () => {
  const p = parseDtg('171847Z NOV 26');
  assert.ok(p);
  assert.equal(p.kind, 'DTG');
  assert.equal(p.day, 17);
  assert.equal(p.month, 11);
  assert.equal(p.year, 2026);
  assert.equal(p.hour, 18);
  assert.equal(p.minute, 47);
  assert.equal(p.zone, 'UTC');
  assert.equal(dtgToIso(p), '2026-11-17T18:47:00+00:00');
});

test('Huruf kecil & spasi: "171847g nov 2026" tetap ter-parse', () => {
  const p = parseDtg('171847g nov 2026');
  assert.ok(p);
  assert.equal(p.kind, 'DTG');
  assert.equal(p.day, 17);
  assert.equal(p.month, 11);
  assert.equal(p.year, 2026);
  assert.equal(p.zone, 'WIB');
});

test('Zona terpisah spasi: "051014Z SEP 25" = 5 September 2025 pukul 10.14 UTC', () => {
  const p = parseDtg('051014Z SEP 25');
  assert.ok(p);
  assert.equal(p.day, 5);
  assert.equal(p.month, 9);
  assert.equal(p.year, 2025);
  assert.equal(p.hour, 10);
  assert.equal(p.minute, 14);
  assert.equal(p.zone, 'UTC');
});

test('Tanpa tahun: "171847G NOV" → year null', () => {
  const p = parseDtg('171847G NOV');
  assert.ok(p);
  assert.equal(p.kind, 'DTG');
  assert.equal(p.year, null);
  assert.equal(p.month, 11);
  assert.equal(p.day, 17);
});

test('Tanpa huruf zona → asumsi WIB (zoneAssumed true)', () => {
  const p = parseDtg('171847 NOV 2026');
  assert.ok(p);
  assert.equal(p.zone, 'WIB');
  assert.equal(p.zoneLetter, 'G');
  assert.equal(p.zoneAssumed, true);
});

test('Bulan Inggris: "220830H AUG 2025" = 22 Agustus pukul 08.30 WITA', () => {
  const p = parseDtg('220830H AUG 2025');
  assert.ok(p);
  assert.equal(p.day, 22);
  assert.equal(p.month, 8);
  assert.equal(p.hour, 8);
  assert.equal(p.minute, 30);
  assert.equal(p.zone, 'WITA');
});

// ---------------------------------------------------------------------------
// Konversi zona (dtgToZones)
// ---------------------------------------------------------------------------

test('dtgToZones: 19.00 WIB → UTC 12.00, WITA 20.00, WIT 21.00 (17 Nov)', () => {
  const p = parseDtg('TW 1117 1900 G');
  assert.ok(p);
  const rows = dtgToZones(p);
  const by = Object.fromEntries(rows.map((r) => [r.zone, r]));
  assert.equal(by.UTC.hhmm, '1200');
  assert.equal(by.UTC.dayShift, 0);
  assert.equal(by.WIB.hhmm, '1900');
  assert.equal(by.WITA.hhmm, '2000');
  assert.equal(by.WITA.dayShift, 0);
  assert.equal(by.WIT.hhmm, '2100');
  assert.equal(rows.length, 4);
});

test('dtgToZones: 16.00 UTC (22 Nov) → WIB 23.00 hari sama, WITA 00.00 +1 hari', () => {
  const p = parseDtg('1122.1600 Z');
  assert.ok(p);
  const rows = dtgToZones(p);
  const by = Object.fromEntries(rows.map((r) => [r.zone, r]));
  assert.equal(by.WIB.hhmm, '2300');
  assert.equal(by.WIB.day, 22);
  assert.equal(by.WIB.dayShift, 0);
  assert.equal(by.WITA.hhmm, '0000');
  assert.equal(by.WITA.day, 23);
  assert.equal(by.WITA.dayShift, 1);
  assert.equal(by.WIT.hhmm, '0100');
  assert.equal(by.WIT.day, 23);
});

test('dtgToZones lintas tahun (fallbackYear): 1 Jan 00.30 WITA → UTC 31 Des tahun sebelumnya', () => {
  const p = parseDtg('0101 0030 H');
  assert.ok(p);
  const rows = dtgToZones(p, 2026);
  const by = Object.fromEntries(rows.map((r) => [r.zone, r]));
  assert.equal(by.UTC.hhmm, '1630');
  assert.equal(by.UTC.day, 31);
  assert.equal(by.UTC.month, 12);
  assert.equal(by.UTC.year, 2025);
  assert.equal(by.UTC.dayShift, -1);
});

test('dtgToZones memakai tahun dari parse: 171847G NOV 2026 → label memuat 2026', () => {
  const p = parseDtg('171847G NOV 2026');
  assert.ok(p);
  const rows = dtgToZones(p);
  const wib = rows.find((r) => r.zone === 'WIB');
  assert.equal(wib.label, '17 Nov 2026 pukul 18.47');
  assert.equal(wib.year, 2026);
});

// ---------------------------------------------------------------------------
// Input tidak valid
// ---------------------------------------------------------------------------

test('Input tidak valid mengembalikan null', () => {
  assert.equal(parseDtg(''), null);
  assert.equal(parseDtg('   '), null);
  assert.equal(parseDtg('0500 Z'), null); // hanya jam — untuk Konverter Zona Waktu biasa
  assert.equal(parseDtg('9913 1900 G'), null); // bulan 99
  assert.equal(parseDtg('1132 1900 G'), null); // tanggal 32
  assert.equal(parseDtg('171847G XYZ 2026'), null); // bulan tidak dikenal
  assert.equal(parseDtg('abc'), null);
  assert.equal(parseDtg('172547G NOV 2026'), null); // jam 25
  assert.equal(parseDtg('176147G NOV 2026'), null); // menit 61
  assert.equal(parseDtg('1131 1900 G'), null); // 31 November → tidak ada tanggal itu
  assert.equal(parseDtg('0200 1900 G'), null); // hari 00
});

test('Tanggal valid 31 Januari diterima, 31 Februari ditolak', () => {
  assert.ok(parseDtg('0131 1900 G'));
  assert.equal(parseDtg('0231 1900 G'), null); // 31 Februari
  assert.equal(parseDtg('290230H FEB 2025'), null); // 29 Feb 2025 bukan kabisat
  assert.ok(parseDtg('290230H FEB 2024')); // 2024 kabisat
});

// ---------------------------------------------------------------------------
// Konsistensi tabel zona huruf
// ---------------------------------------------------------------------------

test('DTG_ZONE_LETTERS: G=WIB+7, H=WITA+8, I=WIT+9, Z=UTC+0', () => {
  const map = Object.fromEntries(DTG_ZONE_LETTERS.map((z) => [z.letter, z]));
  assert.equal(map.G.zone, 'WIB');
  assert.equal(map.G.offset, 7);
  assert.equal(map.H.zone, 'WITA');
  assert.equal(map.H.offset, 8);
  assert.equal(map.I.zone, 'WIT');
  assert.equal(map.I.offset, 9);
  assert.equal(map.Z.zone, 'UTC');
  assert.equal(map.Z.offset, 0);
});
