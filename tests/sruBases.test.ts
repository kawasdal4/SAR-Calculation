/**
 * Test pangkalan SRU Basarnas + pencocokan nama pangkalan → bank data
 * (layer peta laut & ONC).
 *
 * Invariant utama:
 *  - 6 pangkalan preset aplikasi (data pemilik, bukan koordinat karangan);
 *    koordinat di dalam rentang Indonesia (lat -11..6.5, lng 94..141.5).
 *  - matcher konservatif: nama fasilitas/KANSAR yang benar terpetakan, nama
 *    generik/pendek TIDAK dipetakan asal (tanpa kecocokan → null).
 *  - kecocokan fasilitas (VERIFIED) menang atas KANSAR (representatif) saat
 *    skor sama.
 *
 * Jalankan: bun test tests/sruBases.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  matchSruBaseFacility,
  SRU_BASES,
  SRU_BASE_COLOR,
  sruBaseTooltip,
} from '../src/lib/sar/sruBases';
import { SRU_BASE_PRESETS } from '../src/components/sar/AssetAllocationWorksheet';

describe('bank pangkalan SRU Basarnas (preset aplikasi)', () => {
  it('6 pangkalan sesuai SRU_BASE_PRESETS lama — nama & koordinat identik', () => {
    expect(SRU_BASES.length).toBe(6);
    expect(SRU_BASE_PRESETS.length).toBe(6);
    for (const preset of SRU_BASE_PRESETS) {
      const found = SRU_BASES.find((b) => b.name === preset.name);
      expect(found).toBeDefined();
      expect(found?.lat).toBe(preset.pos.lat);
      expect(found?.lng).toBe(preset.pos.lng);
    }
  });

  it('provenance lengkap + koordinat dalam rentang Indonesia', () => {
    for (const base of SRU_BASES) {
      expect(base.kind).toBe('sru-base');
      expect(base.source).toContain('SRU_BASE_PRESETS');
      expect(base.verification).toBe('VERIFIED');
      expect(base.region).not.toBe('');
      expect(base.lat).toBeGreaterThan(-11.5);
      expect(base.lat).toBeLessThan(6.5);
      expect(base.lng).toBeGreaterThan(94);
      expect(base.lng).toBeLessThan(141.5);
    }
  });

  it('tooltip menyebut Pangkalan SRU Basarnas + warna layer konsisten', () => {
    expect(sruBaseTooltip(SRU_BASES[0])).toContain('Pangkalan SRU Basarnas');
    expect(SRU_BASE_COLOR).toMatch(/^#[0-9a-fA-F]{6}$/);
    // Tidak bentrok dengan warna kategori fasilitas/kantor.
    expect(SRU_BASE_COLOR).not.toBe('#dc2626'); // kantor-sar
    expect(SRU_BASE_COLOR).not.toBe('#b45309'); // kantor-pusat
  });
});

describe('matchSruBaseFacility (nama pangkalan → bank data, tanpa mengarang)', () => {
  it('pelabuhan/dermaga terpetakan ke titik CSV pemilik (VERIFIED)', () => {
    const match = matchSruBaseFacility('Pelabuhan Belawan');
    expect(match).not.toBeNull();
    expect(match?.entry.kind).toBe('transport-facility');
    expect(match?.entry.verification).toBe('VERIFIED');
    expect(match?.entry.name).toContain('Belawan');
  });

  it('bandara terpetakan lewat nama/kode IATA', () => {
    const byName = matchSruBaseFacility('Bandara Juanda');
    expect(byName).not.toBeNull();
    expect(byName?.entry.category).toBe('bandara');
    const byCode = matchSruBaseFacility('SUB');
    expect(byCode).not.toBeNull();
    expect(byCode?.entry.name).toContain('Juanda');
  });

  it('KANSAR terpetakan ke titik representatif kantor (fallback setelah fasilitas)', () => {
    const match = matchSruBaseFacility('Kantor SAR Kupang');
    expect(match).not.toBeNull();
    expect(match?.entry.kind).toBe('sar-office');
    expect(match?.entry.name).toContain('Kupang');
  });

  it('nama generik tidak dipetakan bila tidak ada kandidat relevan', () => {
    expect(matchSruBaseFacility('')).toBeNull();
    // Tidak ada titik bernama yang cocok → null (jangan mengarang koordinat).
    expect(matchSruBaseFacility('Pangkalan tidak dikenal di wilayah xzyq')).toBeNull();
    // "Benoa" tidak ada di bank data fasilitas — jangan jatuh ke titik lain.
    expect(matchSruBaseFacility('Dermaga Benoa')).toBeNull();
  });

  it('nama kota tanpa nama spesifik tetap terpetakan ke fasilitas kota itu', () => {
    const match = matchSruBaseFacility('Pelabuhan Jakarta');
    expect(match).not.toBeNull();
    expect(match?.entry.kind).toBe('transport-facility');
    expect(match?.entry.verification).toBe('VERIFIED');
    expect(`${match?.entry.name} ${(match?.entry as { specs?: { cityRegion?: string } }).specs?.cityRegion ?? ''}`.toLowerCase()).toContain('jakarta');
  });

  it('fasilitas VERIFIED menang atas KANSAR UNVERIFIED pada skor sama', () => {
    // "Kupang" ada di terminal-dermaga (Terminal Petikemas Kupang) dan KANSAR
    // Kupang — fasilitas koordinat eksplisit harus dipilih.
    const match = matchSruBaseFacility('Terminal Kupang');
    expect(match).not.toBeNull();
    expect(match?.entry.kind).toBe('transport-facility');
  });
});
