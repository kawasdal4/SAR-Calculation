/**
 * TAF Worksheet Alokasi Aset (WS7) dari analisa kasus AI asisten.
 * Diperbaiki: (1) variasi tulisan TAF dari soal ("Cerah"/"CLEAR"/"INTER"/
 * "intermittent"/"temporary") ditolak validator sehingga seluruh lembar
 * alokasi gagal diterapkan; (2) instruksi tool set_asset_allocation_case
 * diperkuat agar TAF selalu dibaca dari prakiraan cuaca pada soal.
 * Jalankan: bun test tests/assetAllocationTaf.test.ts
 */
import { test, expect } from 'bun:test';
import {
  normalizeTafCondition,
  calculateSruAsset,
  type SruAssetInput,
} from '../src/lib/sar/assetAllocation';

// ---------------------------------------------------------------------------
// normalizeTafCondition — pemetaan kata kunci soal → nilai worksheet
// ---------------------------------------------------------------------------
test('TAF cerah: cerah/CLEAR/CAVOK/clear', () => {
  expect(normalizeTafCondition('cerah')).toBe('cerah');
  expect(normalizeTafCondition('Cerah')).toBe('cerah');
  expect(normalizeTafCondition('CLEAR')).toBe('cerah');
  expect(normalizeTafCondition('CAVOK')).toBe('cerah');
  expect(normalizeTafCondition('clear sky')).toBe('cerah');
});

test('TAF inter: INTER/intermittent (menang atas kata lain)', () => {
  expect(normalizeTafCondition('INTER')).toBe('inter');
  expect(normalizeTafCondition('inter')).toBe('inter');
  expect(normalizeTafCondition('intermittent')).toBe('inter');
  expect(normalizeTafCondition("INTER 30'")).toBe('inter');
  expect(normalizeTafCondition('TAF inter period')).toBe('inter');
});

test('TAF tempo: TEMPO/temporary/shower', () => {
  expect(normalizeTafCondition('TEMPO')).toBe('tempo');
  expect(normalizeTafCondition('tempo')).toBe('tempo');
  expect(normalizeTafCondition('temporary')).toBe('tempo');
  expect(normalizeTafCondition("TEMPO 60'")).toBe('tempo');
  expect(normalizeTafCondition('rain shower')).toBe('tempo');
});

test('TAF tidak dikenal / kosong / bukan string → undefined (tidak mengarang)', () => {
  expect(normalizeTafCondition('')).toBeUndefined();
  expect(normalizeTafCondition('mendung pekat')).toBeUndefined();
  expect(normalizeTafCondition('30')).toBeUndefined();
  expect(normalizeTafCondition(undefined)).toBeUndefined();
  expect(normalizeTafCondition(null)).toBeUndefined();
  expect(normalizeTafCondition(30 as unknown as string)).toBeUndefined();
});

// ---------------------------------------------------------------------------
// TAF → tafMinutes (cerah 0 / inter 30 / tempo 60) dan efeknya ke TSF/OSE
// ---------------------------------------------------------------------------
const CSP = { lat: 1.0, lng: 104.0 };
const EXIT = { lat: 1.2, lng: 104.2 };

function airAsset(taf?: SruAssetInput['tafCondition']): SruAssetInput {
  return {
    id: 'sru-1',
    name: 'SRX 48',
    type: 'fixed-wing-aircraft',
    homeBaseName: 'Bandara Hang Nadim',
    homeBasePos: { lat: 1.043, lng: 104.115 },
    transitSpeedKts: 180,
    searchSpeedKts: 140,
    enduranceHours: 5,
    sweepWidthNm: 2,
    airEngineType: 'turbine',
    tafCondition: taf,
  };
}

function calc(taf?: SruAssetInput['tafCondition']) {
  return calculateSruAsset(airAsset(taf), CSP, EXIT);
}

test('tafMinutes alut udara: cerah 0 / inter 30 / tempo 60', () => {
  expect(calc('cerah').tafMinutes).toBe(0);
  expect(calc('inter').tafMinutes).toBe(30);
  expect(calc('tempo').tafMinutes).toBe(60);
  expect(calc(undefined).tafMinutes).toBeNull();
});

test('TAF menambah TSF dan mengurangi OSE tepat 60 menit (tempo vs cerah)', () => {
  const cerah = calc('cerah');
  const tempo = calc('tempo');
  expect(cerah.totalSafetyFuelMinutes).not.toBeNull();
  expect(tempo.totalSafetyFuelMinutes! - cerah.totalSafetyFuelMinutes!).toBe(60);
  expect(cerah.onSceneEnduranceMinutes).not.toBeNull();
  expect(cerah.onSceneEnduranceMinutes! - tempo.onSceneEnduranceMinutes!).toBe(60);
});

test('alut laut mengabaikan TAF (tafMinutes null, TSF dari maritimeTsfMins)', () => {
  const vessel = calculateSruAsset(
    {
      id: 'sru-2',
      name: 'KN SAR 115',
      type: 'rescue-vessel',
      homeBaseName: 'Dermaga Batu Ampar',
      homeBasePos: { lat: 1.068, lng: 104.0 },
      transitSpeedKts: 15,
      searchSpeedKts: 10,
      enduranceHours: 8,
      sweepWidthNm: 2,
      maritimeTsfMins: 30,
      tafCondition: 'tempo',
    },
    CSP,
    EXIT,
  );
  expect(vessel.tafMinutes).toBeNull();
  expect(vessel.totalSafetyFuelMinutes).toBe(30);
});
