/**
 * Test B.13 worksheet ADW — formatUtcEnd (AeronauticalDriftWorksheet).
 * Rumus: B.13 = A.1 + (hasil pembulatan setengah-ke-atas B.7).
 * Kasus kunci: B.13 harus MUNCUL walau field tanggal header kosong/'-',
 * selama A.1 bisa diparse (Basarnas MMDD.HHMM Z maupun narasi ber-tanggal).
 */
import { describe, expect, test } from 'bun:test';
import { formatUtcEnd } from '../src/components/sar/AeronauticalDriftWorksheet';
import { roundHalfUpToMinute, toBasarnasTimeFormat } from '../src/lib/sar/aswTime';

describe('ADW B.13 — formatUtcEnd', () => {
  test('muncul walau field tanggal "-" — tanggal dari A.1 Basarnas', () => {
    // A.1 hasil normalisasi caseAdapter: "1118.0650 Z" (18 Nov 06:50 UTC)
    expect(formatUtcEnd('-', '1118.0650 Z', 26)).toBe('1118.0716 Z, 18 Nov');
  });

  test('muncul dengan field tanggal lengkap (tahun ikut tampil)', () => {
    expect(formatUtcEnd('19 November 2026', '1118.0650 Z', 26)).toBe('1118.0716 Z, 18 Nov 2026');
    expect(formatUtcEnd('2026-11-17', '1117.0700 Z', 8)).toBe('1117.0708 Z, 17 Nov 2026');
  });

  test('field tanggal dd/mm/yyyy gaya Indonesia diterima', () => {
    expect(formatUtcEnd('18/11/2026', '1118.0650 Z', 0)).toBe('1118.0650 Z, 18 Nov 2026');
  });

  test('tahun diambil dari string A.1 bila field tanggal kosong', () => {
    expect(formatUtcEnd('', '18 November 2026 07.00 UTC', 8)).toBe('1118.0708 Z, 18 Nov 2026');
  });

  test('narasi zona WIB dikonversi dulu ke UTC (disimpan ternormalisasi)', () => {
    // 18 Nov 2026 13.50 WIB → 18 Nov 06.50 UTC → 1118.0650
    const a1 = toBasarnasTimeFormat('18 November 2026 13.50 WIB', '19 November 2026');
    expect(a1).toBe('1118.0650');
    expect(formatUtcEnd('19 November 2026', `${a1} Z`, 0)).toBe('1118.0650 Z, 18 Nov 2026');
  });

  test('melewati 2400 lanjut ke tanggal berikutnya', () => {
    // 23.58 + 8 menit → 00.06 besoknya
    expect(formatUtcEnd('2 November 2026', '1102.2358 Z', 8)).toBe('1103.0006 Z, 03 Nov 2026');
  });

  test('pembulatan B.7: 8.129 → 8; 8.5 → 9; 8.499 → 8', () => {
    expect(roundHalfUpToMinute(8.129)).toBe(8);
    expect(roundHalfUpToMinute(8.5)).toBe(9);
    expect(roundHalfUpToMinute(8.499)).toBe(8);
    // contoh panduan: 0123 Z + rounded 8 min = 0131 Z (nama bulan tampil Inggris, gaya form)
    expect(formatUtcEnd('2 Oktober 2017', '1002.0123 Z', roundHalfUpToMinute(8.129))).toBe(
      '1002.0131 Z, 02 Oct 2017',
    );
  });

  test('tetap null bila A.1 tidak bisa diparse atau tanggal tidak diketahui', () => {
    expect(formatUtcEnd('-', '-', 8)).toBeNull();
    expect(formatUtcEnd('', '07.00', 8)).toBeNull(); // jam polos tanpa tanggal di mana pun
  });
});
