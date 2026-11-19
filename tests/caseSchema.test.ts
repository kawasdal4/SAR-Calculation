/**
 * Test CaseSchema (Fase 1 AI Copilot) — validasi skema + konvensi data.
 * Jalankan: bun test tests/caseSchema.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  parseSarCase,
  VERIFICATION_STATUSES,
  INCIDENT_TYPES,
} from '../src/lib/sar/caseSchema';
import pkTalJson from './golden/pk-tal.case.json';

const PK_TAL = pkTalJson as unknown;

describe('CaseSchema', () => {
  it('menerima fixture PK-TAL (soal resmi Final Test XL 2026)', () => {
    const result = parseSarCase(PK_TAL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.incident.callsign).toBe('PK-TAL');
      expect(result.data.incident.type).toBe('aircraft-ditching');
      expect(result.data.aeroDrift?.windLayers?.length).toBe(7);
      expect(result.data.sea?.surfaceWindSeries?.length).toBe(6);
      expect(result.data.sru?.length).toBe(3);
      expect(result.data.search?.searchNumber).toBe(3);
    }
  });

  it('menolak jenis insiden yang tidak dikenal', () => {
    const result = parseSarCase({ incident: { type: 'alien-abduction' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it('menolak koordinat di luar rentang', () => {
    const result = parseSarCase({
      incident: { type: 'vessel-sinking' },
      lkp: { coord: { lat: 999, lng: 0 } },
    });
    expect(result.ok).toBe(false);
  });

  it('menolak arah angin di luar 0-360', () => {
    const result = parseSarCase({
      incident: { type: 'aircraft-ditching' },
      aeroDrift: { windLayers: [{ altitudeFt: 0, windDirFrom: 999, windSpeedKts: 5 }] },
    });
    expect(result.ok).toBe(false);
  });

  it('konvensi arah: angin = DARI (windDirFrom), arus = KE (dirToDeg) — field terpisah', () => {
    const result = parseSarCase(PK_TAL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Tabel angin per ketinggian memakai windDirFrom
      expect(Object.keys(result.data.aeroDrift?.windLayers?.[0] ?? {})).toContain('windDirFrom');
      expect(Object.keys(result.data.aeroDrift?.windLayers?.[0] ?? {})).not.toContain('dirToDeg');
      // Arus laut memakai dirToDeg (PK-TAL: 250° / 0,3 kn)
      expect(result.data.sea?.current?.dirToDeg).toBe(250);
      expect(Object.keys(result.data.sea?.current ?? {})).not.toContain('windDirFrom');
    }
  });

  it('status verifikasi hanya empat kategori resmi', () => {
    expect([...VERIFICATION_STATUSES]).toEqual(['VERIFIED', 'UNVERIFIED', 'MISSING', 'SIMULATION']);
  });

  it('jenis insiden yang didukung lengkap', () => {
    expect([...INCIDENT_TYPES]).toContain('aircraft-ditching');
    expect([...INCIDENT_TYPES]).toContain('vessel-sinking');
    expect([...INCIDENT_TYPES]).toContain('person-overboard');
    expect([...INCIDENT_TYPES]).toContain('aircraft-land-crash');
  });

  it('parseSarCase tidak pernah melempar pada input aneh', () => {
    expect(() => parseSarCase(null)).not.toThrow();
    expect(() => parseSarCase('bukan objek')).not.toThrow();
    expect(() => parseSarCase(42)).not.toThrow();
    expect(parseSarCase(42).ok).toBe(false);
  });
});
