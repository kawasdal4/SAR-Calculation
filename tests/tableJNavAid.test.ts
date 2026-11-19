/**
 * Bug yang diperbaiki: Worksheet 1 "Search craft error (y): Worksheet Datum / Table J"
 * tidak menunjukkan 0.1 NM padahal SRU pencari menggunakan GPS (Table J-1, Appendix J
 * — APPENDIX.pdf yang diunggah pengguna: GPS 0.1 NM, Radar 1 NM, Visual fix 1 NM,
 * Celestial fix 2 NM, Marine Radio Beacon 4 NM, LORAN C 1 NM, INS 0.5 NM,
 * VOR/TACAN 0.5 NM).
 *
 * Perbaikan: AI mengirim xNavAid/yNavAid (id Table J-1, mis. 'gps') dan aplikasi
 * memetakan DETERMINISTIK ke fix error NM via mapNavAidToFixError — angka X/Y
 * numerik dari model hanya fallback. Jalankan: bun test tests/tableJNavAid.test.ts
 */
import { test, expect } from 'bun:test';
import {
  getNavAidLabelById,
  mapNavAidToFixError,
  TABLE_J1_NAV_ERRORS,
} from '../src/lib/sar/sarCalculations';

test('Table J-1: yNavAid "gps" (SRU pencari pakai GPS) → y = 0.1 NM', () => {
  expect(mapNavAidToFixError('gps')).toBe(0.1);
  expect(mapNavAidToFixError(' GPS ')).toBe(0.1); // toleran spasi/kapital
  expect(mapNavAidToFixError('GPS')).toBe(0.1);
  expect(getNavAidLabelById('gps')).toBe('GPS');
});

test('Table J-1: seluruh baris sesuai APPENDIX.pdf yang diunggah', () => {
  const expectNm = (id: string, nm: number) => expect(mapNavAidToFixError(id)).toBe(nm);
  expectNm('radar', 1.0);
  expectNm('visual', 1.0);
  expectNm('celestial', 2.0);
  expectNm('marine-radio-beacon', 4.0);
  expectNm('loran-c', 1.0);
  expectNm('ins', 0.5);
  expectNm('vor-tacan', 0.5);
  // Konsistensi konstanta tabel ↔ nilai PDF
  expect(TABLE_J1_NAV_ERRORS.find((e) => e.id === 'gps')?.errorNm).toBe(0.1);
});

test('Table J-2 (area praktis): kapal 5, pesawat mandiri 5, pesawat lain 10, kapal kecil 15', () => {
  expect(mapNavAidToFixError('j2-ship')).toBe(5.0);
  expect(mapNavAidToFixError('j2-aircraft-self')).toBe(5.0);
  expect(mapNavAidToFixError('j2-aircraft-other')).toBe(10.0);
  expect(mapNavAidToFixError('j2-small-craft')).toBe(15.0);
});

test('id tidak dikenal / kosong → undefined (fallback ke X/Y numerik AI)', () => {
  expect(mapNavAidToFixError('garmin-terbaru')).toBeUndefined();
  expect(mapNavAidToFixError('')).toBeUndefined();
  expect(mapNavAidToFixError(undefined)).toBeUndefined();
  expect(mapNavAidToFixError(null)).toBeUndefined();
});
