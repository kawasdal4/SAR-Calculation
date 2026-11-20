import { describe, expect, it } from 'bun:test';
import {
  buildCornerBoxLines,
  computeContainRect,
  resolveScanPrintLayout,
} from '../src/lib/sar/scanPrint';

describe('computeContainRect — fit utuh (tampilan asli, tidak dipotong)', () => {
  it('gambar landscape di kertas landscape → memenuhi lebar, center vertikal', () => {
    const rect = computeContainRect(4000, 2000, 0, 0, 3000, 1500);
    expect(rect.width).toBeCloseTo(3000);
    expect(rect.height).toBeCloseTo(1500);
    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
  });

  it('gambar lebih panjang → letterbox rata tengah', () => {
    const rect = computeContainRect(2000, 4000, 100, 50, 1000, 1000);
    expect(rect.width).toBeCloseTo(500);
    expect(rect.height).toBeCloseTo(1000);
    expect(rect.x).toBeCloseTo(100 + 250);
    expect(rect.y).toBeCloseTo(50);
  });
});

describe('resolveScanPrintLayout — orientasi auto & margin', () => {
  it('A3 landscape untuk gambar melebar', () => {
    const layout = resolveScanPrintLayout('a3', 'auto', 4200, 2000, 200, 3);
    expect(layout.orientation).toBe('landscape');
    expect(layout.pageWidthMm).toBe(420);
    expect(layout.pageHeightMm).toBe(297);
  });

  it('A4 portrait untuk gambar tegak', () => {
    const layout = resolveScanPrintLayout('a4', 'auto', 1500, 2600, 200, 3);
    expect(layout.orientation).toBe('portrait');
    expect(layout.pageWidthMm).toBe(210);
    expect(layout.pageHeightMm).toBe(297);
  });

  it('margin dipatok 0–12 mm', () => {
    expect(resolveScanPrintLayout('a4', 'portrait', 100, 100, 200, -5).marginMm).toBe(0);
    expect(resolveScanPrintLayout('a4', 'portrait', 100, 100, 200, 50).marginMm).toBe(12);
  });
});

describe('buildCornerBoxLines — isi text box pojok (hanya koordinat yang diminta)', () => {
  it('kelompok kosong → baris kosong (kotak tidak digambar)', () => {
    const lines = buildCornerBoxLines({});
    expect(lines.tl).toEqual([]);
    expect(lines.tr).toEqual([]);
    expect(lines.bl).toEqual([]);
    expect(lines.br).toEqual([]);
  });

  it('LKP/Datum/A–D/CSP/Exit terformat DMS dengan label SRU', () => {
    const lkp = { lat: -6.0833333, lng: 106.75 };
    const datum = { lat: -6.2, lng: 106.9 };
    const lines = buildCornerBoxLines({
      lkp,
      datum,
      corners: [
        { label: 'A · WS1', pos: { lat: -6.1, lng: 106.7 } },
        { label: 'B · WS1', pos: { lat: -6.1, lng: 106.8 } },
      ],
      sruCsp: [
        { sru: 'KN. TOBA 01', pos: { lat: -6.15, lng: 106.78 } },
        { sru: 'BASARNAS 02', pos: null },
      ],
      sruExit: [{ sru: 'KN. TOBA 01', pos: { lat: -6.18, lng: 106.82 } }],
    });
    expect(lines.tl).toHaveLength(2);
    expect(lines.tl[0]).toMatch(/^LKP: \d/);
    expect(lines.tl[1]).toMatch(/^DATUM: \d/);
    expect(lines.tr[0]).toMatch(/^A · WS1: \d/);
    expect(lines.bl[0]).toContain('CSP KN. TOBA 01:');
    expect(lines.bl[1]).toBe('CSP BASARNAS 02: —');
    expect(lines.br[0]).toContain('EXIT KN. TOBA 01:');
  });
});
