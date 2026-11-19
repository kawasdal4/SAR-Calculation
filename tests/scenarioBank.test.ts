/**
 * Test ScenarioBank (Fase 5a) — seed JSON bank lokasi & aset.
 * Jalankan: bun test tests/scenarioBank.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  SCENARIO_BANK_SEED,
  auditScenarioBank,
  listScenarioBank,
  findScenarioBankEntry,
  searchScenarioBank,
  isSruUsableAsset,
  bankEntryToCaseSru,
  bankEntryToCaseTarget,
} from '../src/lib/sar/scenarioBank';
import { sarCaseSchema } from '../src/lib/sar/caseSchema';

describe('ScenarioBank — seed JSON', () => {
  it('memuat entri lokasi dan aset (seed bawaan)', () => {
    const locations = listScenarioBank('location');
    const assets = listScenarioBank('asset');
    expect(locations.length).toBeGreaterThanOrEqual(20);
    expect(assets.length).toBeGreaterThanOrEqual(10);
  });

  it('id unik di seluruh bank', () => {
    const ids = SCENARIO_BANK_SEED.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('audit bersih — semua entri punya sumber/tanggal/satuan dan koordinat valid', () => {
    const issues = auditScenarioBank();
    expect(issues).toEqual([]);
  });

  it('setiap entri punya provenance lengkap (keputusan no. 7)', () => {
    for (const e of SCENARIO_BANK_SEED) {
      expect(e.source.trim().length).toBeGreaterThan(0);
      expect(e.updatedRef).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.units.trim().length).toBeGreaterThan(0);
      expect(['VERIFIED', 'UNVERIFIED', 'MISSING', 'SIMULATION']).toContain(e.verification);
      expect(['DRAFT', 'APPROVED']).toContain(e.approval);
    }
  });

  it('data sintetis latihan berlabel SIMULATION dan tidak disetujui otomatis', () => {
    const sims = SCENARIO_BANK_SEED.filter((e) => e.name.includes('SIMULASI'));
    expect(sims.length).toBeGreaterThanOrEqual(5);
    for (const e of sims) {
      expect(e.verification).toBe('SIMULATION');
      expect(e.approval).toBe('DRAFT');
    }
  });

  it('entri verifikasi VERIFIED punya sumber dokumen resmi/soal', () => {
    for (const e of SCENARIO_BANK_SEED.filter((x) => x.verification === 'VERIFIED')) {
      expect(e.source.toLowerCase()).toMatch(/pdf|soal|aplikasi|preset/);
    }
  });

  it('aset PK-TAL tersedia dengan spesifikasi soal (VERIFIED)', () => {
    const as365 = findScenarioBankEntry('asset-heli-as365');
    expect(as365?.specs.tasMaxKts).toBe(150);
    expect(as365?.specs.tasSearchKts).toBe(90);
    expect(as365?.specs.enduranceHours).toBe(2);
    expect(as365?.specs.enduranceMinutes).toBe(45);
    const cessna = findScenarioBankEntry('asset-pesawat-cessna208');
    expect(cessna?.specs.wingspanM).toBe(15.88);
    expect(cessna?.specs.cruiseSpeedKts).toBe(186);
  });

  it('6 pangkalan SRU_BASE_PRESETS aplikasi masuk sebagai pelabuhan', () => {
    const pelabuhan = listScenarioBank('location', 'pelabuhan');
    expect(pelabuhan.length).toBe(6);
    const merak = pelabuhan.find((e) => e.id === 'loc-pelabuhan-merak');
    expect(merak?.lat).toBeCloseTo(-5.932);
    expect(merak?.lng).toBeCloseTo(105.996);
  });
});

describe('ScenarioBank — pencarian & konversi', () => {
  it('searchScenarioBank menemukan entri berdasarkan nama', () => {
    const found = searchScenarioBank('AS-365', 'asset');
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].id).toBe('asset-heli-as365');
  });

  it('isSruUsableAsset: entri SRU lengkap vs kandidat target saja', () => {
    expect(isSruUsableAsset(findScenarioBankEntry('asset-heli-as365')!)).toBe(true);
    // Kapal kargo SIMULASI hanya target (tanpa data pencarian SRU)
    expect(isSruUsableAsset(findScenarioBankEntry('sim-kapal-kargo-60m')!)).toBe(false);
    // Life raft bukan SRU
    expect(isSruUsableAsset(findScenarioBankEntry('asset-raft-6p')!)).toBe(false);
  });

  it('bankEntryToCaseSru menghasilkan CaseSru valid', () => {
    const entry = findScenarioBankEntry('asset-heli-as365')!;
    const sru = bankEntryToCaseSru(entry, 'HR-9999', { captain: 'Uji Coba' });
    expect(sru.callsign).toBe('HR-9999');
    expect(sru.kind).toBe('helicopter');
    expect(sru.model).toBe(entry.name);
    expect(sru.tasSearchKts).toBe(90);
    expect(sru.captain).toBe('Uji Coba');
  });

  it('bankEntryToCaseTarget menghasilkan target valid untuk schema kasus', () => {
    const entry = findScenarioBankEntry('asset-pesawat-cessna208')!;
    const target = bankEntryToCaseTarget(entry);
    expect(target.category).toBe('aircraft');
    expect(target.wingspanM).toBe(15.88);
    const parsed = sarCaseSchema.safeParse({
      incident: { type: 'aircraft-ditching' },
      target,
    });
    expect(parsed.success).toBe(true);
  });
});
