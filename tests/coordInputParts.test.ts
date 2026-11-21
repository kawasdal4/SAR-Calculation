/**
 * Tes helper input koordinat terstruktur (CoordinateInput):
 *  - splitDmsParts/joinDmsParts  — 3 kotak derajat°/menit′/detik″ + hemisfer
 *  - splitDmParts/joinDmParts    — 2 kotak derajat°/menit′ desimal + hemisfer
 *  - nextCoordInputFormat        — siklus tombol pengganti format
 * Jalankan: bun test tests/coordInputParts.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  joinDmParts,
  joinDmsParts,
  nextCoordInputFormat,
  splitDmParts,
  splitDmsParts,
} from '../src/lib/sar/coordFormat';

describe('splitDmsParts — urai derajat desimal → kotak D/M/S + hemisfer', () => {
  it('lintang selatan Indonesia: -6.5 → 6° 30′ 0″ hemisfer S(-)', () => {
    expect(splitDmsParts(-6.5, 'lat')).toEqual({ deg: 6, min: 30, sec: 0, hemi: '-' });
  });

  it('bujur timur Indonesia: 106.75 → 106° 45′ 0″ hemisfer E(+)', () => {
    expect(splitDmsParts(106.75, 'lng')).toEqual({ deg: 106, min: 45, sec: 0, hemi: '+' });
  });

  it('detik pecahan 1 desimal: -5.2045 → 5° 12′ 16.2″ S', () => {
    const parts = splitDmsParts(-5.2045, 'lat');
    expect(parts.deg).toBe(5);
    expect(parts.min).toBe(12);
    expect(parts.sec).toBeCloseTo(16.2, 6);
    expect(parts.hemi).toBe('-');
    // join kembali → nilai asli
    expect(joinDmsParts(parts.deg, parts.min, parts.sec, parts.hemi)).toBeCloseTo(-5.2045, 9);
  });

  it('pembulatan detik mencapai 60″ dinormalisasi → menit naik', () => {
    // 0°00′59.96″ → total 59.96″ dibulatkan 60.0″ → 0°01′00″
    const value = 59.96 / 3600;
    expect(splitDmsParts(value, 'lat')).toEqual({ deg: 0, min: 1, sec: 0, hemi: '+' });
  });

  it('menit mencapai 60′ dinormalisasi → derajat naik', () => {
    // 0°59′59.97″ → 1°00′00″
    const value = (59 * 60 + 59.97) / 3600;
    expect(splitDmsParts(value, 'lat')).toEqual({ deg: 1, min: 0, sec: 0, hemi: '+' });
  });

  it('nol → hemisfer positif', () => {
    expect(splitDmsParts(0, 'lat')).toEqual({ deg: 0, min: 0, sec: 0, hemi: '+' });
  });

  it('batas lintang 90° aman (tidak meluap)', () => {
    const parts = splitDmsParts(90, 'lat');
    expect(parts.deg).toBe(90);
    expect(parts.min).toBe(0);
    expect(parts.sec).toBe(0);
  });
});

describe('joinDmsParts — gabung kotak D/M/S + hemisfer → derajat desimal', () => {
  it('6° 12′ 30″ S = -6.208333…', () => {
    expect(joinDmsParts(6, 12, 30, '-')).toBeCloseTo(-(6 + 12 / 60 + 30 / 3600), 12);
  });

  it('106° 45′ 0″ E = 106.75', () => {
    expect(joinDmsParts(106, 45, 0, '+')).toBeCloseTo(106.75, 12);
  });
});

describe('splitDmParts/joinDmParts — mode DM (menit desimal 2 angka)', () => {
  it('-6.75 → 6° 45.00′ S dan join kembali tepat', () => {
    const parts = splitDmParts(-6.75, 'lat');
    expect(parts).toEqual({ deg: 6, min: 45, hemi: '-' });
    expect(joinDmParts(parts.deg, parts.min, parts.hemi)).toBe(-6.75);
  });

  it('106.755 → 106° 45.30′ E (±2 m presisi)', () => {
    const parts = splitDmParts(106.755, 'lng');
    expect(parts.deg).toBe(106);
    expect(parts.min).toBeCloseTo(45.3, 2);
    expect(joinDmParts(parts.deg, parts.min, parts.hemi)).toBeCloseTo(106.755, 4);
  });

  it('menit 60′ dinormalisasi → derajat naik', () => {
    // 0°59.996′ → 1°00.00′
    const parts = splitDmParts(59.996 / 60, 'lat');
    expect(parts.deg).toBe(1);
    expect(parts.min).toBe(0);
  });
});

describe('nextCoordInputFormat — siklus tombol pengganti format', () => {
  it('DMS → DM → Desimal → DMS', () => {
    expect(nextCoordInputFormat('dms')).toBe('dm');
    expect(nextCoordInputFormat('dm')).toBe('decimal');
    expect(nextCoordInputFormat('decimal')).toBe('dms');
  });
});
