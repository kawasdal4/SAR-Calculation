/**
 * Test CaseAdapter (Fase 1 AI Copilot) — pemetaan deterministik
 * SarCaseSchema → seed worksheet + completeness check.
 * Jalankan: bun test tests/caseAdapter.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  buildCaseWorksheetSeeds,
  checkCaseCompleteness,
  deriveAswIntervalMode,
  DOWNSTREAM_FIELDS,
  eyeHeightForVessel,
  sruTypeFromCase,
  w2TargetFromRaftCapacity,
  w2VisibilityIndexForKm,
  w8TargetFromRaftCapacity,
  w8VisibilityLabelForKm,
} from '../src/lib/sar/caseAdapter';
import type { SarCaseSchema } from '../src/lib/sar/caseSchema';
import pkTalJson from './golden/pk-tal.case.json';

const PK_TAL = pkTalJson as unknown as SarCaseSchema;

describe('Pemetaan seed worksheet (fixture PK-TAL)', () => {
  const { seeds, assumptions } = buildCaseWorksheetSeeds(PK_TAL);

  it('ASW: distress/datum + baris angin dikonversi ke Basarnas zona UTC (aturan pengguna)', () => {
    // Aturan pengguna: format tanggal/waktu soal → Basarnas MMDD.HHMM Z saat
    // masuk worksheet; zona memakai logika tab Penghitungan Dasar (WIB +7).
    expect(seeds.asw?.distressTime).toBe('1118.0650 Z'); // 18 Nov 13.50 WIB
    expect(seeds.asw?.datumTime).toBe('1119.0000 Z');    // 19 Nov 07.00 WIB
    expect(seeds.asw?.intervalMode).toBe('6h');
    expect(seeds.asw?.windData.length).toBe(6);
    // Konvensi grid ASW: jam angin apa adanya (dipasangkan per label jam),
    // bukan digeser zona — header distress/datum saja yang dikonversi Basarnas.
    expect(seeds.asw?.windData[0]).toMatchObject({ obsTime: '18 November 2026 00.00 WIB', windDirFrom: 50, windSpeed: 5 });
    expect(seeds.asw?.windData[5]).toMatchObject({ obsTime: '19 November 2026 06.00 WIB', windDirFrom: 90, windSpeed: 9 });
  });

  it('AWA: 7 lapis angin, target FL200 → 20000 ft, baris Surface', () => {
    expect(seeds.awa?.distressAltFt).toBe(20000);
    expect(seeds.awa?.observations.length).toBe(7);
    expect(seeds.awa?.observations[0]).toMatchObject({ altObs: 'Surface', windDirFrom: 45, windSpeed: 5 });
    expect(seeds.awa?.observations[6]).toMatchObject({ altObs: '24000 Feet', windDirFrom: 105, windSpeed: 20 });
  });

  it('ADW: LKP desimal, glide 121 kn ratio 6, heading 103°M, variation 1°E, Altmin 0', () => {
    expect(seeds.aero?.incidentPos).toEqual({ lat: -6.879444, lng: 105.261389 });
    // Waktu insiden A.1 masuk worksheet dalam format Basarnas zona UTC.
    expect(seeds.aero?.incidentTime).toBe('1118.0650 Z');
    expect(seeds.aero?.aircraftTASgKts).toBe(121);
    expect(seeds.aero?.aircraftGlideRatio).toBe(6);
    expect(seeds.aero?.aircraftAltMaxFt).toBe(20000);
    expect(seeds.aero?.aircraftAltMinFt).toBe(0);
    expect(seeds.aero?.aircraftDescentHeadingDeg).toBe(103);
    expect(seeds.aero?.aircraftHeadingReference).toBe('magnetic');
    expect(seeds.aero?.magneticVariationDeg).toBe(1);
    expect(seeds.aero?.magneticVariationDirection).toBe('E');
    expect(seeds.aero?.useParachute).toBe(false);
  });

  it('Datum: arus 250°/0,3 kn (arah KE), latitude |lat| LKP, X/Y default 0', () => {
    expect(seeds.datum?.seaCurrentDir).toBe(250);
    expect(seeds.datum?.seaCurrentSpeed).toBe(0.3);
    expect(seeds.datum?.latitude).toBeCloseTo(6.879444, 5);
    expect(seeds.datum?.X).toBe(0);
    expect(seeds.datum?.Y).toBe(0);
    expect(seeds.datum?.lkpSource).toBe('explicit');
    // leeway belum dipilih planner → tidak diisi (dilarang mengarang kategori)
    expect(seeds.datum?.leewayObjectId).toBeUndefined();
  });

  it('WS 2: dua lembar helikopter (1 alut = 1 lembar), target raft6, vis 10 km → indeks 2', () => {
    expect(seeds.ws2Sheets.length).toBe(2);
    const hr = seeds.ws2Sheets[0];
    expect(hr.sruName).toBe('HR-3604');
    expect(hr.data.searchPlatform).toBe('helicopter');
    expect(hr.data.searchObject).toBe('raft6');
    expect(hr.data.visibilityIndex).toBe(2);
    expect(hr.data.searchTas).toBe(90);
    expect(hr.data.isFatigue).toBe('No');
    expect(hr.data.selectedHeight).toBe(1000);
    expect(hr.data.caseWindDirFrom).toBe(55);
    expect(hr.data.caseWindSpeed).toBe(20);
    expect(seeds.ws2Sheets[1].sruName).toBe('PK-ELS');
  });

  it('WS 8: satu lembar kapal rescue, eye height 14, vis 20 km → kolom "20", speed area 15', () => {
    expect(seeds.ws8Sheets.length).toBe(1);
    const drupada = seeds.ws8Sheets[0];
    expect(drupada.sruName).toBe('KN SAR Drupada');
    expect(drupada.data.sruType).toBe('rescue-vessel');
    expect(drupada.data.eyeHeight).toBe('14');
    expect(drupada.data.searchObject).toBe('raft6');
    expect(drupada.data.visibilityKm).toBe('20');
    expect(drupada.data.vesselSpeedKts).toBe(15);
  });

  it('Aset: 3 unit, pangkalan = lokasi aset soal, endurance 2.75/2.5/50 jam, TAF Inter', () => {
    expect(seeds.assets.length).toBe(3);
    const hr = seeds.assets[0];
    expect(hr.name).toBe('HR-3604');
    expect(hr.type).toBe('helicopter');
    expect(hr.enduranceHours).toBeCloseTo(2.75, 6);
    expect(hr.transitSpeedKts).toBe(150);
    expect(hr.searchSpeedKts).toBe(90);
    expect(hr.homeBasePos).toEqual({ lat: -6.841667, lng: 105.491667 });
    expect(hr.tafCondition).toBe('inter');
    expect(hr.airEngineType).toBe('turbine');
    expect(seeds.assets[1].enduranceHours).toBeCloseTo(2.5, 6);
    expect(seeds.assets[2].enduranceHours).toBe(50);
    expect(seeds.assets[2].tafCondition).toBeUndefined(); // kapal: TAF tidak relevan, soal tidak menyebut
  });

  it('Asumsi default tercatat (Altmin 0, fatigue No, height 1000, X/Y 0, searchNumber)', () => {
    const fields = assumptions.map((note) => note.field);
    expect(fields).toContain('aero.aircraftAltMinFt');
    expect(fields).toContain('ws2/ws8.isFatigue');
    expect(fields).toContain('ws2.selectedHeight');
    expect(fields).toContain('datum.X/Y');
    // asumsi ekstraksi ikut dari meta fixture
    expect(assumptions.length).toBeGreaterThan(0);
  });

  it('deterministik: input sama → seed sama persis', () => {
    const again = buildCaseWorksheetSeeds(PK_TAL);
    expect(JSON.stringify(again.seeds)).toBe(JSON.stringify(seeds));
    expect(JSON.stringify(again.assumptions)).toBe(JSON.stringify(assumptions));
  });

  it('planner leeway ikut ke seed datum', () => {
    const { seeds: withPlanner } = buildCaseWorksheetSeeds(PK_TAL, { leewayObjectId: 'raft-aviation-46' });
    expect(withPlanner.datum?.leewayObjectId).toBe('raft-aviation-46');
  });
});

describe('Aturan pemetaan helper', () => {
  it('visibility W2: 10 km → indeks 2 ("10"), 35 km → indeks 4 ("30"), 2 km → 0', () => {
    expect(w2VisibilityIndexForKm(10)).toBe(2);
    expect(w2VisibilityIndexForKm(35)).toBe(4);
    expect(w2VisibilityIndexForKm(2)).toBe(0);
    expect(w2VisibilityIndexForKm(45)).toBe(5);
    expect(w2VisibilityIndexForKm(undefined)).toBe(-1);
  });

  it('visibility W8: 20 km → "20", 30 km → ">25"', () => {
    expect(w8VisibilityLabelForKm(20)).toBe('20');
    expect(w8VisibilityLabelForKm(30)).toBe('>25');
    expect(w8VisibilityLabelForKm(undefined)).toBe('');
  });

  it('target dari kapasitas raft: 6 → raft6, 3 → raft4, >25 → raft25', () => {
    expect(w2TargetFromRaftCapacity(6)).toBe('raft6');
    expect(w2TargetFromRaftCapacity(3)).toBe('raft4');
    expect(w2TargetFromRaftCapacity(30)).toBe('raft25');
    expect(w8TargetFromRaftCapacity(6)).toBe('raft6');
  });

  it('eye height kapal: rescue vessel → "14", RIB → "8", kapal ≥50 m → MERSHIP', () => {
    expect(eyeHeightForVessel({ callsign: 'KN SAR Drupada', kind: 'vessel', model: 'Rescue Boat Kapal 40 m' })).toBe('14');
    expect(eyeHeightForVessel({ callsign: 'RIB 1', kind: 'vessel', model: 'RIB 6 m' })).toBe('8');
    expect(eyeHeightForVessel({ callsign: 'Kapal Besar', kind: 'vessel', model: 'Kapal 60 m' })).toBe('MERSHIP');
  });

  it('tipe SRU alokasi: heli/kapal/patroli', () => {
    expect(sruTypeFromCase({ callsign: 'HR-3604', kind: 'helicopter' })).toBe('helicopter');
    expect(sruTypeFromCase({ callsign: 'X', kind: 'fixed-wing' })).toBe('fixed-wing-aircraft');
    expect(sruTypeFromCase({ callsign: 'KN Patroli', kind: 'vessel', model: 'Kapal Patroli 30 m' })).toBe('patrol-boat');
  });

  it('mode interval ASW: hanya 00/06/12/18 → 6h; ada 03/09/15/21 → 3h', () => {
    expect(deriveAswIntervalMode([
      { obsTime: '18 November 2026 00.00 WIB', windDirFrom: 50, windSpeedKts: 5 },
      { obsTime: '18 November 2026 06.00 WIB', windDirFrom: 69, windSpeedKts: 10 },
    ])).toEqual({ mode: '6h', determined: true });
    expect(deriveAswIntervalMode([
      { obsTime: '03.00', windDirFrom: 10, windSpeedKts: 5 },
      { obsTime: '09.00', windDirFrom: 20, windSpeedKts: 5 },
    ]).mode).toBe('3h');
    expect(deriveAswIntervalMode([{ obsTime: 'tidak ada jam', windDirFrom: 0, windSpeedKts: 0 }])).toEqual({ mode: '6h', determined: false });
  });
});

describe('checkCaseCompleteness (fixture PK-TAL)', () => {
  it('field hilir (glideRatio/waveHeightM/leeway) TIDAK dilaporkan hilang — PK-TAL lengkap', () => {
    const report = checkCaseCompleteness(PK_TAL);
    // Regresi PK-TAL: ketiga field ini dihasilkan/dipilih di worksheet hilir
    // (ADW/Fw I-7/Datum WS 1) — bukan data soal; melaporkannya "hilang"
    // mengunci penerapan tanpa alasan.
    expect(report.issues.some((issue) => DOWNSTREAM_FIELDS.has(issue.field))).toBe(false);
    expect(report.issues.some((issue) => issue.field === 'aeroDrift.glideRatio')).toBe(false);
    expect(report.issues.some((issue) => issue.field === 'sea.waveHeightM')).toBe(false);
    expect(report.issues.some((issue) => issue.field === 'datum.leewayObjectId')).toBe(false);
    const xy = report.issues.find((issue) => issue.field === 'datum.X/Y');
    expect(xy?.status).toBe('ASSUMED'); // info, bukan pemblokir
    expect(report.complete).toBe(true);
    expect(report.missingCount).toBe(0);
  });

  it('dengan planner leeway + x/y: hanya tersisa informasi x/y (tidak ada MISSING)', () => {
    const report = checkCaseCompleteness(PK_TAL, { leewayObjectId: 'raft-aviation-46', xNm: 0.1, yNm: 0.1 });
    expect(report.issues.some((issue) => issue.status === 'MISSING')).toBe(false);
    expect(report.issues.some((issue) => issue.field === 'datum.X/Y')).toBe(false);
    expect(report.missingCount).toBe(0);
  });

  it('meta.missingFields yang menyebut field hilir diabaikan (model boleh salah klaim)', () => {
    const withDownstreamMissing = {
      ...PK_TAL,
      meta: {
        ...(PK_TAL.meta ?? {}),
        missingFields: [
          { field: 'aeroDrift.glideRatio', reason: 'Glide ratio tidak ada di soal.' },
          { field: 'sea.waveHeightM', reason: 'Tinggi gelombang tidak disebut di soal.' },
          { field: 'datum.leewayObjectId', reason: 'Kategori leeway belum dipilih.' },
          { field: 'datum.x/y nav aid', reason: 'Alat navigasi (Tabel J-1) tidak disebut — default 0 NM.' },
          { field: 'incident.pob', reason: 'Jumlah POB tidak disebut.' },
        ],
      },
    } as typeof PK_TAL;
    const report = checkCaseCompleteness(withDownstreamMissing);
    // Hanya field BUKAN-hilir yang dilaporkan.
    expect(report.issues.filter((issue) => issue.worksheet === 'Soal').map((issue) => issue.field)).toEqual(['incident.pob']);
    expect(report.issues.some((issue) => DOWNSTREAM_FIELDS.has(issue.field))).toBe(false);
  });

  it('kasus ditching tanpa koordinat LKP: TIDAK MISSING — alur resmi LKP dari rantai AWA → ADW', () => {
    // Keputusan alur pengguna: lkp.coord bukan prasyarat chat — LKP untuk Datum
    // dihasilkan posisi ditching hasil ADW (lkpSource "adw-landing"); bila soal
    // mencantumkan Koordinat Lost Contact, nilai itu dipakai sebagai titik awal
    // drift. Ketiadaan koordinat hanya info ASSUMED, tidak mengunci penerapan.
    const noLkp = { ...PK_TAL, lkp: undefined } as typeof PK_TAL;
    const report = checkCaseCompleteness(noLkp);
    const lkpIssue = report.issues.find((issue) => issue.field === 'lkp.coord');
    expect(lkpIssue?.status).toBe('ASSUMED');
    expect(lkpIssue?.reason).toContain('AWA');
    expect(report.missingCount).toBe(0);
    expect(report.complete).toBe(true);
  });

  it('klaim model "lkp.coord hilang" diabaikan (field alur ADW, bukan blokir)', () => {
    const withLkpMissing = {
      ...PK_TAL,
      lkp: undefined,
      meta: {
        ...(PK_TAL.meta ?? {}),
        missingFields: [{ field: 'lkp.coord', reason: 'Koordinat LKP tidak ada di soal.' }],
      },
    } as typeof PK_TAL;
    const report = checkCaseCompleteness(withLkpMissing);
    expect(report.issues.some((issue) => issue.field === 'lkp.coord' && issue.status === 'MISSING')).toBe(false);
    expect(report.missingCount).toBe(0);
  });

  it('kasus kosong: banyak MISSING, tidak pernah melempar', () => {
    const empty = { incident: { type: 'aircraft-ditching' } } as unknown as SarCaseSchema;
    const report = checkCaseCompleteness(empty);
    expect(report.complete).toBe(false);
    expect(report.missingCount).toBeGreaterThan(5);
  });
});

describe('Klaim missing spek ukuran target (bug target.lengthM pada kasus pesawat)', () => {
  const aircraftCase: SarCaseSchema = {
    schemaVersion: 1,
    incident: { type: 'aircraft-ditching', callsign: 'PK-XYZ' },
    target: { category: 'aircraft', name: 'PK-XYZ' },
    meta: { source: 'pdf', missingFields: [
      { field: 'target.lengthM', reason: 'Tidak dicantumkan pada naskah soal' },
      { field: 'target.wingspanM', reason: 'Tidak dicantumkan pada naskah soal' },
      { field: 'incident.lastContactTime', reason: 'Waktu MAYDAY tidak ada di soal.' },
    ] },
  } as unknown as SarCaseSchema;

  it('kasus PESAWAT: klaim target.lengthM/wingspanM DIABAIKAN — bukan kekurangan data', () => {
    const result = checkCaseCompleteness(aircraftCase);
    const fields = result.issues.map((issue) => issue.field);
    expect(fields).not.toContain('target.lengthM');
    expect(fields).not.toContain('target.wingspanM');
    // Klaim sah tetap dilaporkan.
    expect(fields).toContain('incident.lastContactTime');
  });

  it('kasus KAPAL (vessel-sinking): klaim target.lengthM tetap dilaporkan (kategori leeway)', () => {
    const vesselCase: SarCaseSchema = {
      ...aircraftCase,
      incident: { type: 'vessel-sinking' },
      target: { category: 'vessel' },
    } as unknown as SarCaseSchema;
    const result = checkCaseCompleteness(vesselCase);
    expect(result.issues.map((issue) => issue.field)).toContain('target.lengthM');
    // wingspan bukan data kapal yang dipakai → tetap diabaikan.
    expect(result.issues.map((issue) => issue.field)).not.toContain('target.wingspanM');
  });
});
