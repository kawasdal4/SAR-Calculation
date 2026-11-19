/**
 * Test tool `lookup_table` (Fase 2, keputusan no.6):
 * - Nilai tabel dari lib resmi (bukan karangan) + STATUS verifikasi disertakan.
 * - UNVERIFIED (Fig I-1) & MISSING (N-4..N-8) tidak memberi nilai final.
 * - Argumen salah → ok:false dengan pesan jelas (tidak melempar).
 * Jalankan: bun test tests/lookupTableTool.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { executeLookupTable, LOOKUP_TABLE_NAMES } from '../src/lib/ai/tools/lookupTable';
import { LEEWAY_OBJECT_TYPES } from '../src/lib/sar/sarCalculations';

describe('lookup_table — katalog & validasi argumen', () => {
  it('tanpa argumen → daftar tabel + status verifikasi', () => {
    const result = executeLookupTable({});
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(Array.isArray(parsed.tables)).toBe(true);
    expect(parsed.tables.length).toBeGreaterThanOrEqual(12);
    expect(parsed.tables.some((t: { id: string; status: string }) => t.id === 'I-7' && t.status === 'VERIFIED')).toBe(true);
  });

  it('nama tabel tak dikenal → ok:false + katalog', () => {
    const result = executeLookupTable({ table: 'tabel-rahasia' });
    expect(result.ok).toBe(false);
    const parsed = JSON.parse(result.json);
    expect(Array.isArray(parsed.tables)).toBe(true);
  });

  it('semua nama tabel dikenal', () => {
    expect(LOOKUP_TABLE_NAMES.length).toBe(14);
    for (const name of LOOKUP_TABLE_NAMES) {
      expect(typeof name).toBe('string');
    }
  });
});

describe('lookup_table — leeway (I-1/I-2, VERIFIED)', () => {
  it('q bahasa Indonesia memakai resolver deskripsi yang sama dengan worksheet', () => {
    const result = executeLookupTable({ table: 'leeway', q: 'life raft canopy dengan drogue' });
    const parsed = JSON.parse(result.json);
    expect(parsed.status).toBe('VERIFIED');
    expect(parsed.rows.length).toBeGreaterThan(0);
    // Resolver deskripsi: hasil harus id kategori leeway yang benar-benar ada.
    for (const row of parsed.rows) {
      expect(LEEWAY_OBJECT_TYPES.some((entry) => entry.id === row.id)).toBe(true);
    }
  });

  it('id langsung cocok; leewayRate ikut', () => {
    const result = executeLookupTable({ table: 'leeway', q: 'piw-novice' });
    const parsed = JSON.parse(result.json);
    expect(parsed.rows.some((row: { id: string }) => row.id === 'piw-novice')).toBe(true);
    expect(parsed.rows[0].leewayRate).toBe(0.011);
  });

  it('q tak cocok → ok:false dengan pesan', () => {
    const result = executeLookupTable({ table: 'leeway', q: 'kereta api' });
    expect(result.ok).toBe(false);
  });
});

describe('lookup_table — Wu udara/laut (I-3..I-6, VERIFIED)', () => {
  it('Wu udara raft25 fixed-wing 1000 ft vis kolom 2', () => {
    const result = executeLookupTable({ table: 'wu-air', platform: 'fixed-wing', target: 'raft25', altitudeFt: 1000, visibilityColumn: 2 });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(parsed.status).toBe('VERIFIED');
    expect(parsed.wuNm).toBeGreaterThan(0);
  });

  it('Wu udara: kombinasi salah → ok:false', () => {
    const result = executeLookupTable({ table: 'wu-air', platform: 'fixed-wing', target: 'raft25', altitudeFt: 777, visibilityColumn: 2 });
    expect(result.ok).toBe(false);
  });

  it('Wu laut person eye 14 vis 10', () => {
    const result = executeLookupTable({ table: 'wu-sea', target: 'person', eye: '14', visibility: '10' });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(parsed.wuNm).toBeGreaterThan(0);
  });
});

describe('lookup_table — Fw I-7 & Fs I-8 (VERIFIED)', () => {
  it('Fw dari angin 10 kts group small → baris 1', () => {
    const result = executeLookupTable({ table: 'fw-weather', windKts: 10, group: 'small' });
    const parsed = JSON.parse(result.json);
    expect(parsed.status).toBe('VERIFIED');
    expect(parsed.fwRow).toBe(1);
    expect(parsed.fw).toBe(1);
  });

  it('Fw dari angin 15 kts group other → baris 2 (0.8)', () => {
    const result = executeLookupTable({ table: 'fw-weather', windKts: 15, group: 'other' });
    const parsed = JSON.parse(result.json);
    expect(parsed.fwRow).toBe(2);
    expect(parsed.fw).toBe(0.8);
  });

  it('Fw: angin 25 kts + gelombang 3 m → baris TERBURUK (max)', () => {
    const result = executeLookupTable({ table: 'fw-weather', windKts: 25, waveHeightM: 3, group: 'other' });
    const parsed = JSON.parse(result.json);
    expect(parsed.fwRow).toBe(3);
    expect(parsed.note).toContain('terburuk');
  });

  it('Fs kecepatan raft25 fixed-wing 150 kts → 1.1', () => {
    const result = executeLookupTable({ table: 'fs-speed', target: 'raft25', platform: 'fixed-wing', tas: 150 });
    const parsed = JSON.parse(result.json);
    expect(parsed.fs).toBe(1.1);
  });

  it('fs pencarian ke-2 → 1.6', () => {
    const result = executeLookupTable({ table: 'fs-search', searchNumber: 2 });
    const parsed = JSON.parse(result.json);
    expect(parsed.fs).toBe(1.6);
    expect(parsed.status).toBe('VERIFIED');
  });
});

describe('lookup_table — darat & navigasi (I-9/I-10/J)', () => {
  it('Wu darat person 500 ft vis 5 km', () => {
    const result = executeLookupTable({ table: 'land-wu', target: 'person', heightFt: 500, visibilityKm: 5 });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.json);
    expect(parsed.wuNm).toBeGreaterThan(0);
  });

  it('Fv darat person under-15', () => {
    const result = executeLookupTable({ table: 'land-fv', target: 'person', vegetation: 'under-15' });
    const parsed = JSON.parse(result.json);
    expect(parsed.fv).toBeGreaterThan(0);
  });

  it('galat navigasi J-1: gps', () => {
    const result = executeLookupTable({ table: 'nav-error', table2: 'J-1', q: 'gps' });
    const parsed = JSON.parse(result.json);
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.some((row: { id: string }) => row.id === 'gps')).toBe(true);
  });
});

describe('lookup_table — N-13/N-14/POD (VERIFIED)', () => {
  it('N-13 C-9 escape @0 ft → 1176 ft/min (sea level)', () => {
    const result = executeLookupTable({ table: 'n13-parachute', id: 'c9-escape', openingAltFt: 0 });
    const parsed = JSON.parse(result.json);
    expect(parsed.selection.rodFtMin).toBe(1176);
    expect(parsed.selection.column).toBe('sea-level');
  });

  it('N-13 tanpa id → daftar jenis', () => {
    const result = executeLookupTable({ table: 'n13-parachute' });
    const parsed = JSON.parse(result.json);
    expect(parsed.rows.length).toBeGreaterThan(10);
  });

  it('N-14 drift: kombinasi valid → NM', () => {
    const result = executeLookupTable({ table: 'n14-drift', openingAltFt: 10000, windKts: 20 });
    const parsed = JSON.parse(result.json);
    expect(parsed.driftNm).toBeGreaterThan(0);
    expect(parsed.status).toBe('VERIFIED');
  });

  it('POD C=1 pencarian ke-1 antara 60-80%', () => {
    const result = executeLookupTable({ table: 'pod-curve', coverage: 1, searchNumber: 1 });
    const parsed = JSON.parse(result.json);
    expect(parsed.podPercent).toBeGreaterThan(60);
    expect(parsed.podPercent).toBeLessThan(80);
  });
});

describe('lookup_table — nilai TIDAK resmi diberi status eksplisit', () => {
  it('Fig I-1 arus angin → UNVERIFIED + peringatan tidak final', () => {
    const result = executeLookupTable({ table: 'wind-current-fig-i1', windKts: 10 });
    const parsed = JSON.parse(result.json);
    expect(parsed.status).toBe('UNVERIFIED');
    expect(parsed.windCurrentKts).toBeCloseTo(0.36, 10);
    expect(parsed.warning).toContain('TIDAK FINAL');
    expect(result.summary).toContain('UNVERIFIED');
  });

  it('N-4..N-8 sweep width → MISSING, tanpa nilai (dilarang mengarang)', () => {
    const result = executeLookupTable({ table: 'sweep-width-n4-n8' });
    expect(result.ok).toBe(false);
    const parsed = JSON.parse(result.json);
    expect(parsed.status).toBe('MISSING');
    expect(parsed.error).toContain('BELUM TERDIGITISASI');
    expect(parsed.rows).toBeUndefined();
  });
});
