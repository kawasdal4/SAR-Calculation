/**
 * Test tool `set_fields` (Fase 2, keputusan no.5):
 * - Hanya field terdaftar yang lolos; JSON bebas/arbitrary path ditolak.
 * - Tipe, enum, dan koersi angka berformat divalidasi.
 * - value_* tepat satu; deterministik.
 * Jalankan: bun test tests/setFields.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  parseSetFieldsArgs,
  setFieldsToolDescription,
  setFieldsToolParameters,
  SET_FIELDS_REGISTRY,
  SET_FIELDS_WORKSHEETS,
} from '../src/lib/ai/tools/setFields';

describe('parseSetFieldsArgs — jalur valid', () => {
  it('datum: dua field number (arus arah KE)', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'datum',
      fields: [
        { name: 'seaCurrentDir', value_number: 250 },
        { name: 'seaCurrentSpeed', value_string: '0,3 kn' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applied.worksheet).toBe('datum');
      expect(result.applied.values['seaCurrentDir']).toBe(250);
      expect(result.applied.values['seaCurrentSpeed']).toBeCloseTo(0.3, 6);
    }
  });

  it('ws2 per-SRU dengan sruName + enum valid', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'WS2', // huruf besar dinormalisasi
      sruName: 'HR-3604',
      fields: [
        { name: 'searchPlatform', value_string: 'Helicopter' },
        { name: 'selectedHeight', value_number: 1000 },
        { name: 'isFatigue', value_string: 'no' },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applied.sruName).toBe('HR-3604');
      expect(result.applied.values['searchPlatform']).toBe('helicopter');
      expect(result.applied.values['selectedHeight']).toBe(1000);
      expect(result.applied.values['isFatigue']).toBe('No');
    }
  });

  it('asw: field json observations diparse', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'asw',
      fields: [{
        name: 'observations',
        value_json: JSON.stringify([{ timeObs: '18.00', timeStart: '13.50', timeEnd: '18.00', hours: 4.1667, windDirFrom: 96, windSpeed: 10 }]),
      }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const obs = result.applied.values['observations'] as Array<Record<string, unknown>>;
      expect(obs.length).toBe(1);
      expect(obs[0]['windSpeed']).toBe(10);
    }
  });

  it('lkp: dua angka', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'lkp',
      fields: [{ name: 'lat', value_number: -6.879444 }, { name: 'lng', value_number: 105.261389 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.applied.values['lat']).toBe(-6.879444);
      expect(result.applied.values['lng']).toBe(105.261389);
    }
  });

  it('briefing/renops: form string bebas diterima', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'renops',
      fields: [{ name: 'taskMission', value_string: 'Mencari dan menolong korban PK-TAL' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.applied.values['taskMission']).toContain('PK-TAL');
  });
});

describe('parseSetFieldsArgs — penolakan (dilarang mengarang/menebak)', () => {
  it('worksheet tidak dikenal ditolak', () => {
    const result = parseSetFieldsArgs({ worksheet: 'worksheet_rahasia', fields: [{ name: 'x', value_number: 1 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('tidak dikenal');
  });

  it('field TIDAK terdaftar ditolak (tanpa arbitrary path)', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'datum',
      fields: [{ name: 'state.asw.observations[0].windSpeed', value_number: 99 }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('tidak terdaftar');
  });

  it('enum tidak cocok ditolak', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'ws2',
      fields: [{ name: 'searchPlatform', value_string: 'drone' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('tidak ada dalam nilai');
  });

  it('lebih dari satu value_* ditolak', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'datum',
      fields: [{ name: 'seaCurrentSpeed', value_number: 0.3, value_string: '0,3' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('TEPAT SATU');
  });

  it('value_json tidak valid ditolak', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'asw',
      fields: [{ name: 'observations', value_json: '{bukan json' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain('bukan JSON valid');
  });

  it('fields kosong ditolak', () => {
    expect(parseSetFieldsArgs({ worksheet: 'datum', fields: [] }).ok).toBe(false);
    expect(parseSetFieldsArgs({ worksheet: 'datum' }).ok).toBe(false);
  });

  it('angka tak terbaca ditolak (tidak diisi 0 diam-diam)', () => {
    const result = parseSetFieldsArgs({
      worksheet: 'ws2',
      fields: [{ name: 'searchTas', value_string: 'cepat sekali' }],
    });
    expect(result.ok).toBe(false);
  });
});

describe('Deklarasi tool (registry-driven)', () => {
  it('description & parameters dibangkitkan dari registry (tanpa nama karangan)', () => {
    const description = setFieldsToolDescription();
    for (const sheet of SET_FIELDS_WORKSHEETS) {
      expect(description).toContain(sheet);
    }
    const parameters = setFieldsToolParameters() as Record<string, unknown>;
    const properties = parameters['properties'] as Record<string, unknown>;
    const fields = properties['fields'] as Record<string, unknown>;
    expect(String((parameters['type'] as string)).toLowerCase()).toBe('object');
    expect(Array.isArray((properties['worksheet'] as Record<string, unknown>)['enum'])).toBe(true);
    expect(fields).toBeDefined();
    // Semua field registry muncul di description parameter (per worksheet)
    const fieldsDescription = String((fields as Record<string, unknown>)['description']);
    expect(fieldsDescription).toContain('datum:');
    expect(fieldsDescription).toContain('seaCurrentDir');
    expect(fieldsDescription).toContain('aero:');
    expect(fieldsDescription).toContain('aircraftGlideRatio');
  });

  it('registry: setiap worksheet punya minimal satu field & tipe valid', () => {
    for (const [sheet, fields] of Object.entries(SET_FIELDS_REGISTRY)) {
      expect(Object.keys(fields).length).toBeGreaterThan(0);
      for (const [name, def] of Object.entries(fields)) {
        expect(['number', 'string', 'boolean', 'json'].includes(def.type)).toBe(true);
        expect(name.length).toBeGreaterThan(0);
      }
    }
  });
});
