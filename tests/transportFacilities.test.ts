/**
 * Test bank fasilitas transportasi & posisi kantor SAR (layer peta laut + ONC).
 *
 * Invariant utama:
 *  - provenance lengkap per entri (keputusan no. 7): source, updatedRef, units,
 *    verification, approval — tanpa entri kosong.
 *  - 43 KANSAR = daftar nama batas wilayah (kansarBoundaries), dan titik
 *    representatifnya WAJIB jatuh di dalam poligon wilayahnya sendiri
 *    (cek geometri deterministik via pointInKansarPolygon).
 *  - Kantor Pusat Basarnas ada (koordinat resmi JDIH, hasil audit pemilik).
 *
 * Jalankan: bun test tests/transportFacilities.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  allFacilityPoints,
  FACILITY_LAYER_COLORS,
  FACILITY_LAYER_LABELS,
  pointsByCategory,
  SAR_OFFICES,
  TRANSPORT_FACILITIES,
  facilityTooltip,
  type SarOfficeEntry,
  type TransportFacilityEntry,
} from '../src/lib/sar/transportFacilities';
import { KANSAR_NAMES, pointInKansarPolygon } from '../src/lib/sar/kansarBoundaries';

const FACILITY_CATEGORIES = ['bandara', 'pelabuhan', 'terminal-dermaga'] as const;
const OFFICE_CATEGORIES = ['kantor-sar', 'kantor-pusat'] as const;

describe('bank fasilitas transportasi (CSV pemilik → transportFacilities.json)', () => {
  it('jumlah per kategori sesuai CSV sumber', () => {
    expect(TRANSPORT_FACILITIES.length).toBe(170);
    expect(TRANSPORT_FACILITIES.filter((e) => e.category === 'bandara').length).toBe(132);
    expect(TRANSPORT_FACILITIES.filter((e) => e.category === 'pelabuhan').length).toBe(19);
    expect(TRANSPORT_FACILITIES.filter((e) => e.category === 'terminal-dermaga').length).toBe(19);
  });

  it('id unik + struktur & provenance lengkap (keputusan no. 7)', () => {
    const ids = new Set<string>();
    for (const entry of TRANSPORT_FACILITIES) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(entry.kind).toBe('transport-facility');
      expect(FACILITY_CATEGORIES).toContain(entry.category);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(typeof entry.lat).toBe('number');
      expect(typeof entry.lng).toBe('number');
      expect(Number.isFinite(entry.lat) && Number.isFinite(entry.lng)).toBe(true);
      expect(entry.source.length).toBeGreaterThan(0);
      expect(entry.units).toContain('WGS84');
      expect(entry.approval).toBe('DRAFT');
      expect(entry.verification).toBe('VERIFIED');
    }
  });

  it('koordinat di dalam kotak kewilayahan Indonesia (sanity)', () => {
    for (const entry of TRANSPORT_FACILITIES) {
      expect(entry.lat).toBeGreaterThanOrEqual(-12);
      expect(entry.lat).toBeLessThanOrEqual(7);
      expect(entry.lng).toBeGreaterThanOrEqual(93);
      expect(entry.lng).toBeLessThanOrEqual(142);
    }
  });

  it('bandara membawa kode IATA + ICAO 4 huruf (bila ada)', () => {
    for (const entry of TRANSPORT_FACILITIES.filter((e) => e.category === 'bandara')) {
      expect(entry.specs.code?.length).toBe(3);
      if ((entry.specs.secondaryCode ?? '').length > 0) {
        expect(entry.specs.secondaryCode).toMatch(/^[A-Z]{4}$/);
      }
    }
  });

  it('pelabuhan membawa kode UN/LOCODE (awalan ID)', () => {
    for (const entry of TRANSPORT_FACILITIES.filter((e) => e.category === 'pelabuhan')) {
      expect(entry.specs.code).toMatch(/^ID/);
    }
  });
});

describe('posisi kantor SAR & Kantor Pusat Basarnas (sarOffices.json)', () => {
  const offices = SAR_OFFICES.filter((e): e is SarOfficeEntry => e.category === 'kantor-sar');
  const pusat = SAR_OFFICES.filter((e): e is SarOfficeEntry => e.category === 'kantor-pusat');

  it('44 entri = 43 KANSAR + 1 Kantor Pusat', () => {
    expect(SAR_OFFICES.length).toBe(44);
    expect(offices.length).toBe(43);
    expect(pusat.length).toBe(1);
  });

  it('nama 43 KANSAR identik dengan batas wilayah (kansarBoundaries)', () => {
    const officeNames = offices.map((e) => e.specs.kansar ?? '').sort((a, b) => a.localeCompare(b, 'id-ID'));
    expect(officeNames).toEqual([...KANSAR_NAMES].sort((a, b) => a.localeCompare(b, 'id-ID')));
  });

  it('titik representatif setiap KANSAR berada di dalam poligon wilayahnya sendiri', () => {
    for (const office of offices) {
      const kansar = office.specs.kansar ?? '';
      expect(pointInKansarPolygon(office.lng, office.lat)).toBe(kansar);
    }
  });

  it('Kantor Pusat Basarnas: alamat resmi + koordinat resmi JDIH (audit pemilik)', () => {
    expect(pusat[0].name).toBe('Kantor Pusat Basarnas');
    expect(pusat[0].specs.address).toContain('Jl. Angkasa');
    // Basis posisi dari audit pemilik 67a5c70: koordinat resmi JDIH Basarnas.
    expect(pusat[0].specs.positionBasis).toContain('JDIH');
    // Kotak longgar kawasan Kemayoran/Jakarta Pusat — bukan titik eksak.
    expect(pusat[0].lat).toBeGreaterThan(-6.20);
    expect(pusat[0].lat).toBeLessThan(-6.10);
    expect(pusat[0].lng).toBeGreaterThan(106.80);
    expect(pusat[0].lng).toBeLessThan(106.90);
  });

  it('provenance lengkap: UNVERIFIED + DRAFT (posisi representatif/indikatif)', () => {
    for (const office of SAR_OFFICES) {
      expect(OFFICE_CATEGORIES).toContain(office.category);
      expect(office.source.length).toBeGreaterThan(0);
      expect(office.verification).toBe('UNVERIFIED');
      expect(office.approval).toBe('DRAFT');
    }
  });
});

describe('loader layer peta', () => {
  it('allFacilityPoints = fasilitas + kantor (214 titik)', () => {
    expect(allFacilityPoints().length).toBe(214);
    expect(pointsByCategory('bandara').length).toBe(132);
    expect(pointsByCategory('kantor-sar').length).toBe(43);
  });

  it('metadata warna & label lengkap untuk semua kategori layer', () => {
    for (const category of [...FACILITY_CATEGORIES, ...OFFICE_CATEGORIES]) {
      expect(FACILITY_LAYER_COLORS[category]).toMatch(/^#[0-9a-f]{6}$/i);
      expect(FACILITY_LAYER_LABELS[category].length).toBeGreaterThan(0);
    }
  });

  it('tooltip memuat nama + basis audit (kantor) / status verifikasi (fasilitas)', () => {
    const facility = TRANSPORT_FACILITIES[0] as TransportFacilityEntry;
    const office = SAR_OFFICES[0] as SarOfficeEntry;
    expect(facilityTooltip(facility)).toContain(facility.name);
    expect(facilityTooltip(facility)).toContain(facility.verification.toLowerCase());
    // Tooltip kantor menampilkan basis audit pemilik (commit 67a5c70), bukan tag UNVERIFIED.
    expect(facilityTooltip(office)).toContain(office.name);
    expect(facilityTooltip(office)).toContain('hasil audit pemilik');
    expect(facilityTooltip(office)).toContain(office.specs.positionBasis ?? '');
  });
});
