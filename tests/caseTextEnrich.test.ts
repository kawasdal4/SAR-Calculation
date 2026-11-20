/**
 * TEST CASE TEXT ENRICH (Fase C2) — ekstraksi DETERMINISTIK dari teks soal.
 *
 * Fixture = teks soal FINAL TEST Diklat SAR Planning Angk. XL 2026 (PK-TAL)
 * apa adanya dari PDF (termasuk superscript ⁰, prime ′/″, koma desimal).
 * Nilai yang diharapkan = tests/golden/pk-tal.case.json (baseline resmi).
 *
 * Diverifikasi:
 * 1. extractCaseFacts — semua field kunci terbaca dari teks mentah.
 * 2. enrichCaseFromSourceText — mengisi kasus KOSONG (nilai model hilang semua)
 *    persis golden; TIDAK menimpa nilai model yang sudah ada.
 * 3. setelah enrich → checkCaseCompleteness.tanpa issue MISSING kunci.
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCaseFacts, enrichCaseFromSourceText } from '../src/lib/ai/caseTextEnrich';
import { sarCaseSchema, type SarCaseSchema } from '../src/lib/sar/caseSchema';
import { checkCaseCompleteness } from '../src/lib/sar/caseAdapter';

// Teks soal apa adanya (urutan & karakter persis seperti PDF Final Test XL 2026).
const SOAL_PK_TAL = `FINAL TEST
Diklat SAR Tingkat Spesialis SAR Planning Angk. XL Tahun 2026
Waktu: 360 Menit

Pada tanggal 18 November 2026 pukul 14.10 WIB Kantor SAR Banten menerima
informasi dari Jakarta Air Traffic Service (JATSC), bahwa pada pukul 13.50 WIB JATSC
menerima panggilan “MAYDAY” dari pesawat dengan callsign PK-TAL setelah cek point
ENSIB di ketinggian FL200 dengan heading 103⁰(M). Dilaporkan bahwa PK-TAL
mengalami kerusakan mesin dan diindikasikan akan ditching. Berdasarkan data flight
plan, perlengkapan keselamatan yang tersedia di PK-TAL adalah 1 buah life raft kapasitas
6 orang dan POB PK-TAL sebanyak 5 orang. Radial LKP dari Kantor SAR Banten adalah
205⁰ dan waktu tempuh ke LKP ± 4 jam. Berdasarkan perhitungan Aeronautical Drift,
dihasilkan koordinat perkiraan ditching PK-TAL. Dan pencarian stage 1 & 2 sudah
dilakukan namun belum membuahkan hasil. Pencarian selanjutnya akan dimulai pada
19 November 2026 pukul 07.00 WIB (Datum Time).

Buatlah Rencana Operasi SAR Kecelakaan Pesawat PK – TAL yang meliputi :
Perhitungan Aeronautical Drift, ASW, Search Area (Gambar Search Area lengkap
koordinat A B C D, koordinat Datum Point). W, S, C, POD, Perhitungan alokasi Aset ,
Search Pattern (CSP & gambar) dan pembagian tugas SRU di Lokasi dengan data-
data sebagai berikut:

1. Data Pesawat PK – TAL

Type : Cessna 208 Caravan
Bendera : Indonesia
Length : 37 ft 7 in (11.46 m)
Wingspan : 52 ft 1 in (15.88 m)
Height : 14 ft 11 in (4.55 m)
Wing area : 279 sq ft (25.9 m2)
Cabin height : 54 in (1.37 m)
Cabin width : 64 in (1.63 m)
Cruise speed : 214 mph; 186 kn (344 km/h) true air speed
Stall speed : 70 mph; 61 kn (113 km/h) calibrated air speed
Range : 1,232 mi; 1,070 nmi (1,982 km)
Service ceiling : 25,000 ft (7,600 m)
Rate of climb : 1,234 ft/min (6.27 m/s)
Wing loading : 28.674 lb/sq ft (140.00 kg/m2)
Frequencies Radio : 121.5 Mhz
Muatan : Logistik
Navigasi Equioment : GPS

2. Data perhitungan Aeronautical Drift :
• Koordinat Lost Contact : 06° 52′ 46″ S – 105° 15′ 41″ E
• Glide Speed : 121 Knots
• Glide Ratio : 6:1
• Variation : 1⁰ E

ALTITUDE DIRECTION VELOCITY
Surface 45⁰ 5
3000 Feet 55⁰ 10
6000 Feet 65⁰ 15
9000 Feet 75⁰ 20
12000 Feet 85⁰ 15
18000 Feet 95⁰ 10
24000 Feet 105⁰ 20

3. Data arus, angin, dan asset SRU :
 Arus laut di lokasi : 250⁰ / 0,3 knots
 Data angin dari tanggal 18 November 2026:
1) 00.00 50⁰ / 5 kts
2) 06.00 69⁰ / 10 kts
3) 12.00 80⁰ / 12 kts
4) 18.00 96⁰ / 10 kts
5) 00.00 102⁰ / 7 kts
6) 06.00 90⁰ / 9 kts

SRU Helikopter Helikopter Rescue Boat
Tipe Eurocopter AS-365 N3+ (Turbin) Bell 505 Jet Ranger X (Turbin) Kapal 40 m
Koordinat lokasi aset 6° 50,5' S – 105° 29,5' E 6° 50,5' S – 105° 29,5' E 6° 50,75' S - 105° 16' E
Endurance 2 jam 45 menit 2 jam 30 menit 50 Jam
Call-Sign HR-3604 PK-ELS KN SAR Drupada
TAS / Speed Max 150 kts 120 kts 20 kts
TAS / Speed di area pencarian 90 kts 90 kts 15 kts
Visibility 10 km 10 km 20 km
Wind 055⁰ / 20 kts 055⁰ / 20 kts 055⁰ / 20 kts
Kondisi Observer fresh fresh fresh
TAF Inter Inter
Radio Frequencies 123.1 123.1 Ch.16 and 123.1
Captain Joko Agus Budi
HP Satelite 870529828 870525252 870490183
Navigation Equipment GPS GPS GPS`;

const GOLDEN: SarCaseSchema = JSON.parse(
  readFileSync(join(import.meta.dir, 'golden', 'pk-tal.case.json'), 'utf8'),
);

describe('extractCaseFacts (deterministik)', () => {
  const facts = extractCaseFacts(SOAL_PK_TAL);

  test('glide speed + glide ratio + variation', () => {
    expect(facts.glideSpeedKts?.value).toBe(121);
    expect(facts.glideRatio?.value.ratio).toBe(6);
    expect(facts.glideRatio?.value.raw).toBe('6:1');
    expect(facts.variationDeg?.value).toEqual({ deg: 1, dir: 'E' });
  });

  test('heading magnetic + FL200', () => {
    expect(facts.headingDeg?.value.deg).toBe(103);
    expect(facts.headingDeg?.value.ref).toBe('magnetic');
    expect(facts.flightLevelFt?.value).toBe(200);
  });

  test('Koordinat Lost Contact → lkp.coord DMS', () => {
    expect(facts.lkpCoord?.value.lat).toBeCloseTo(-6.879444, 5);
    expect(facts.lkpCoord?.value.lng).toBeCloseTo(105.261389, 5);
    expect(facts.lkpCoord?.value.dmsLat).toContain('S');
    expect(facts.lkpCoord?.value.dmsLng).toContain('E');
  });

  test('tabel angin per ketinggian → 7 baris (Surface 0 ft s/d 24000 ft)', () => {
    const rows = facts.windLayers?.value ?? [];
    expect(rows.length).toBe(7);
    expect(rows[0]).toMatchObject({ altitudeFt: 0, windDirFrom: 45, windSpeedKts: 5 });
    expect(rows[1]).toMatchObject({ altitudeFt: 3000, windDirFrom: 55, windSpeedKts: 10 });
    expect(rows[6]).toMatchObject({ altitudeFt: 24000, windDirFrom: 105, windSpeedKts: 20 });
  });

  test('deret angin permukaan → 6 entri, rollover tanggal 19 November', () => {
    const series = facts.surfaceWindSeries?.value ?? [];
    expect(series.length).toBe(6);
    expect(series[0]).toMatchObject({ obsTime: '18 November 2026 00.00 WIB', windDirFrom: 50, windSpeedKts: 5 });
    expect(series[3]).toMatchObject({ obsTime: '18 November 2026 18.00 WIB', windDirFrom: 96, windSpeedKts: 10 });
    expect(series[4]).toMatchObject({ obsTime: '19 November 2026 00.00 WIB', windDirFrom: 102, windSpeedKts: 7 });
    expect(series[5]).toMatchObject({ obsTime: '19 November 2026 06.00 WIB', windDirFrom: 90, windSpeedKts: 9 });
  });

  test('arus laut 250° / 0,3 knots → dirTo KE', () => {
    expect(facts.current?.value).toEqual({ dirToDeg: 250, speedKts: 0.3 });
  });

  test('Datum Time dari kalimat "Pencarian selanjutnya akan dimulai pada ... (Datum Time)"', () => {
    expect(facts.datumTime?.value).toBe('19 November 2026 07.00 WIB');
  });

  test('Datum Time "SRU tiba di lokasi pukul …" — jam SETELAH frasa (jam kalimat sebelumnya tidak terambat)', () => {
    const text = 'Kontak terakhir pukul 13.50 WIB tanggal 18 November 2026. SRU tiba di lokasi pukul 06.30 pada 20 November 2026.';
    expect(extractCaseFacts(text).datumTime?.value).toBe('20 November 2026 06.30 WIB');
  });

  test('Datum Time "Pencarian akan dilakukan pukul …" dan "Pencarian pertama dilakukan pukul …"', () => {
    const a = extractCaseFacts('Pencarian akan dilakukan pukul 07.00 WIB tanggal 19 November 2026.');
    expect(a.datumTime?.value).toBe('19 November 2026 07.00 WIB');
    const b = extractCaseFacts('Pencarian pertama dilakukan pukul 08.15 pada 19 November 2026.');
    expect(b.datumTime?.value).toBe('19 November 2026 08.15 WIB');
  });

  test('prioritas kalimat awal pencarian: "Pencarian pertama dilakukan pukul 07.00" menang atas "SRU tiba … pukul 06.30"', () => {
    const text = 'SRU tiba di lokasi pukul 06.30 pada 19 November 2026. Pencarian pertama dilakukan pukul 07.00 WIB pada hari yang sama.';
    expect(extractCaseFacts(text).datumTime?.value).toBe('19 November 2026 07.00 WIB');
  });

  test('tabel SRU → 3 alut lengkap sesuai kolom soal', () => {
    const sru = facts.sruCandidates?.value ?? [];
    expect(sru.length).toBe(3);
    const [heli1, heli2, vessel] = sru as Array<Record<string, unknown>>;
    expect(heli1['callsign']).toBe('HR-3604');
    expect(heli1['kind']).toBe('helicopter');
    expect(heli1['model']).toBe('Eurocopter AS-365 N3+ (Turbin)');
    expect(heli1['enduranceHours']).toBe(2);
    expect(heli1['enduranceMinutes']).toBe(45);
    expect(heli1['tasMaxKts']).toBe(150);
    expect(heli1['tasSearchKts']).toBe(90);
    expect(heli1['visibilityKm']).toBe(10);
    expect(heli1['windDirFrom']).toBe(55);
    expect(heli1['observerCondition']).toBe('fresh');
    expect(heli1['taf']).toBe('Inter');
    expect(heli1['captain']).toBe('Joko');
    expect(heli1['phoneSatellite']).toBe('870529828');
    expect(heli2['callsign']).toBe('PK-ELS');
    expect(heli2['enduranceMinutes']).toBe(30);
    expect(heli2['captain']).toBe('Agus');
    expect(vessel['callsign']).toBe('KN SAR Drupada');
    expect(vessel['kind']).toBe('vessel');
    expect(vessel['enduranceHours']).toBe(50);
    expect(vessel['tasMaxKts']).toBe(20);
    expect(vessel['captain']).toBe('Budi');
    const coord = vessel['coord'] as { lat: number; lng: number } | undefined;
    expect(coord?.lat).toBeCloseTo(-6.845833, 4);
    expect(coord?.lng).toBeCloseTo(105.266667, 4);
    expect(vessel['frequencies']).toEqual(['Ch.16', '123.1']);
  });
});

describe('enrichCaseFromSourceText', () => {
  test('kasus kosong (model meleset semua) → terisi persis golden PK-TAL', () => {
    const empty: SarCaseSchema = sarCaseSchema.parse({
      schemaVersion: 1,
      incident: { type: 'aircraft-ditching' },
      meta: { source: 'pdf' },
    });
    const { case: enriched, filled } = enrichCaseFromSourceText(empty, SOAL_PK_TAL);

    // Semua field yang sebelumnya MISSING dari run model kini terisi.
    const fields = new Set(filled.map((entry) => entry.field));
    for (const field of [
      'aeroDrift.glideSpeedKts', 'aeroDrift.glideRatio', 'aeroDrift.variation',
      'incident.headingDeg', 'incident.flightLevelFt', 'lkp.coord',
      'aeroDrift.windLayers', 'sea.current', 'sea.surfaceWindSeries', 'search.datumTime', 'sru',
    ]) {
      expect(fields.has(field)).toBe(true);
    }

    expect(enriched.aeroDrift?.glideSpeedKts).toBe(GOLDEN.aeroDrift?.glideSpeedKts);
    expect(enriched.aeroDrift?.glideRatio).toBe(GOLDEN.aeroDrift?.glideRatio);
    expect(enriched.aeroDrift?.variationDeg).toBe(GOLDEN.aeroDrift?.variationDeg);
    expect(enriched.aeroDrift?.variationDirection).toBe('E');
    expect(enriched.aeroDrift?.windLayers).toEqual(GOLDEN.aeroDrift?.windLayers);
    expect(enriched.incident?.headingDeg).toBe(103);
    expect(enriched.incident?.headingReference).toBe('magnetic');
    expect(enriched.incident?.flightLevelFt).toBe(200);
    expect(enriched.lkp?.coord?.lat).toBeCloseTo(GOLDEN.lkp?.coord?.lat ?? 0, 5);
    expect(enriched.lkp?.coord?.lng).toBeCloseTo(GOLDEN.lkp?.coord?.lng ?? 0, 5);
    expect(enriched.lkp?.source).toBe('explicit');
    expect(enriched.sea?.current).toEqual(GOLDEN.sea?.current);
    expect(enriched.sea?.surfaceWindSeries).toEqual(GOLDEN.sea?.surfaceWindSeries);
    expect(enriched.search?.datumTime).toBe(GOLDEN.search?.datumTime);
    expect(enriched.sru?.length).toBe(3);
    expect(enriched.sru?.[0].callsign).toBe('HR-3604');
    expect(enriched.sru?.[2].tasSearchKts).toBe(15);

    // Provenance: setiap isian dicatat VERIFIED dengan kutipan soal.
    const lkpSource = enriched.meta?.fieldSources?.find((entry) => entry.field === 'lkp.coord');
    expect(lkpSource?.status).toBe('VERIFIED');
    expect(lkpSource?.source).toContain('Koordinat Lost Contact');

    // Setelah enrich → completeness TIDAK lagi MENAHAN field kunci.
    const completeness = checkCaseCompleteness(enriched, {});
    const missingFields = completeness.issues.filter((issue) => issue.status === 'MISSING').map((issue) => issue.field);
    for (const field of [
      'lkp.coord', 'aeroDrift.glideSpeedKts', 'aeroDrift.variation', 'incident.headingDeg',
      'incident.flightLevelFt', 'aeroDrift.windLayers', 'sea.current', 'sea.surfaceWindSeries',
      'search.datumTime',
    ]) {
      expect(missingFields).not.toContain(field);
    }
  });

  test('nilai model TIDAK ditimpa oleh enrichment', () => {
    const withModelValues: SarCaseSchema = sarCaseSchema.parse({
      schemaVersion: 1,
      incident: { type: 'aircraft-ditching', headingDeg: 250, flightLevelFt: 150 },
      aeroDrift: { glideSpeedKts: 999, variationDeg: 3, variationDirection: 'W' },
      sea: { current: { dirToDeg: 90, speedKts: 1.5 } },
      search: { datumTime: '19 November 2026 08.00 WIB' },
      lkp: { coord: { lat: -6.5, lng: 105.5 } },
      meta: { source: 'pdf' },
    });
    const { case: enriched, filled } = enrichCaseFromSourceText(withModelValues, SOAL_PK_TAL);
    expect(enriched.aeroDrift?.glideSpeedKts).toBe(999);
    expect(enriched.aeroDrift?.variationDeg).toBe(3);
    expect(enriched.incident?.headingDeg).toBe(250);
    expect(enriched.sea?.current).toEqual({ dirToDeg: 90, speedKts: 1.5 });
    expect(enriched.search?.datumTime).toBe('19 November 2026 08.00 WIB');
    expect(enriched.lkp?.coord?.lat).toBe(-6.5);
    // Field yang memang kosong tetap diisi.
    const fields = new Set(filled.map((entry) => entry.field));
    expect(fields.has('aeroDrift.glideRatio')).toBe(true);
    expect(fields.has('aeroDrift.windLayers')).toBe(true);
    expect(fields.has('sea.surfaceWindSeries')).toBe(true);
    expect(fields.has('sru')).toBe(true);
  });

  test('SRU model parsial → nilai kosongnya dilengkapi, tanpa duplikat callsign', () => {
    const partial: SarCaseSchema = sarCaseSchema.parse({
      schemaVersion: 1,
      incident: { type: 'aircraft-ditching' },
      sru: [{ callsign: 'HR-3604', kind: 'helicopter', tasSearchKts: 88 }],
      meta: { source: 'pdf' },
    });
    const { case: enriched } = enrichCaseFromSourceText(partial, SOAL_PK_TAL);
    expect(enriched.sru?.length).toBe(3);
    const hr = enriched.sru?.find((entry) => entry.callsign === 'HR-3604');
    expect(hr?.tasSearchKts).toBe(88); // nilai model dipertahankan
    expect(hr?.visibilityKm).toBe(10); // dilengkapi dari teks
    expect(enriched.sru?.filter((entry) => entry.callsign === 'HR-3604').length).toBe(1);
  });

  test('teks tanpa data soal → tidak ada isian (dilarang mengarang)', () => {
    const empty: SarCaseSchema = sarCaseSchema.parse({
      incident: { type: 'aircraft-ditching' },
      meta: { source: 'text' },
    });
    const { case: enriched, filled } = enrichCaseFromSourceText(empty, 'Tidak ada data apa pun di teks ini.');
    expect(filled).toHaveLength(0);
    expect(enriched.aeroDrift?.glideSpeedKts).toBeUndefined();
    expect(enriched.lkp?.coord).toBeUndefined();
    expect(enriched.sea?.current).toBeUndefined();
  });

  test('varian header FULL EXERCISE (KETINGGIAN/ALTITUDE — ARAH DIRECTON — KECEPATAN SPEED) terbaca', () => {
    // Persis FULL EXERCISE.pdf (SRX48 Ternate→Merauke): "DIRECTON" typo dan
    // "SPEED" (bukan VELOCITY) — regex lama mentok di sini sehingga tabel
    // angin altitude TIDAK terbaca dan bacaan salah model lolos ke AWA.
    const soal = `Appendix 3. Meteorological Information
KETINGGIAN
ALTITUDE
ARAH
DIRECTON
KECEPATAN
SPEED
Surface 200⁰ 20
3000 FT 180⁰ 12
6000 FT 190⁰ 25
9000 FT 300⁰ 24
12000 FT 250⁰ 24
18000 FT 120⁰ 26
24000 FT 330⁰ 40`;
    const facts = extractCaseFacts(soal);
    const rows = facts.windLayers?.value ?? [];
    expect(rows.length).toBe(7);
    expect(rows[0]).toMatchObject({ altitudeFt: 0, windDirFrom: 200, windSpeedKts: 20 });
    expect(rows[1]).toMatchObject({ altitudeFt: 3000, windDirFrom: 180, windSpeedKts: 12 });
    expect(rows[4]).toMatchObject({ altitudeFt: 12000, windDirFrom: 250, windSpeedKts: 24 });
    expect(rows[5]).toMatchObject({ altitudeFt: 18000, windDirFrom: 120, windSpeedKts: 26 });
    expect(rows[6]).toMatchObject({ altitudeFt: 24000, windDirFrom: 330, windSpeedKts: 40 });
  });

  test('fallback tanpa header: ≥3 baris berurutan alt menaik tetap terbaca', () => {
    const soal = `Data pengamatan angin atas:
Surface 10⁰ 5
3000 40⁰ 10
6000 120⁰ 15
9000 90⁰ 20`;
    const facts = extractCaseFacts(soal);
    const rows = facts.windLayers?.value ?? [];
    expect(rows.length).toBe(4);
    expect(rows[2]).toMatchObject({ altitudeFt: 6000, windDirFrom: 120, windSpeedKts: 15 });
  });

  test('deret angin permukaan (jam HH.MM) TIDAK keliru terbaca sebagai tabel ketinggian', () => {
    const facts = extractCaseFacts('Data angin:\n00.00 155⁰ / 12kts\n06.00 260⁰ / 14 kts\n12.00 285⁰ / 13 kts\n18.00 310⁰ / 10 kts');
    expect(facts.windLayers).toBeUndefined();
    expect(facts.surfaceWindSeries?.value.length).toBe(4);
  });
});

describe('koreksi deterministik tabel angin (bug FULL EXERCISE AWA)', () => {
  const SOAL_SRX48 = `Pada pukul 1050 WIT Pesawat melaporkan kerusakan pada kedua mesin dan
melaporkan kepada ATC di ketinggian 18000 feet dengan heading 134⁰(M).
Appendix 3. Meteorological Information
KETINGGIAN
ALTITUDE
ARAH
DIRECTON
KECEPATAN
SPEED
Surface 200⁰ 20
3000 FT 180⁰ 12
6000 FT 190⁰ 25
9000 FT 300⁰ 24
12000 FT 250⁰ 24
18000 FT 120⁰ 26
24000 FT 330⁰ 40`;

  test('bacaan model salah (angin karangan + altitude 12000) → DITIMPA nilai teks + corrections', () => {
    // Nilai model persis seperti state kasus rusak di production: angin yang
    // TIDAK ada di tabel soal dan ketinggian distress salah (12000).
    const brokenModel: SarCaseSchema = sarCaseSchema.parse({
      schemaVersion: 1,
      incident: { type: 'aircraft-ditching', altitudeFt: 12000 },
      aeroDrift: {
        windLayers: [
          { altitudeFt: 0, windDirFrom: 155, windSpeedKts: 12 },
          { altitudeFt: 3000, windDirFrom: 130, windSpeedKts: 15 },
          { altitudeFt: 6000, windDirFrom: 165, windSpeedKts: 12 },
          { altitudeFt: 9000, windDirFrom: 155, windSpeedKts: 16 },
          { altitudeFt: 12000, windDirFrom: 150, windSpeedKts: 20 },
          { altitudeFt: 18000, windDirFrom: 145, windSpeedKts: 26 },
          { altitudeFt: 24000, windDirFrom: 190, windSpeedKts: 23 },
        ],
      },
      meta: { source: 'pdf' },
    });
    const { case: enriched, corrections } = enrichCaseFromSourceText(brokenModel, SOAL_SRX48);
    // Tabel angin = persis nilai soal (sumber kolom "Altitude interval (A)" AWA).
    const rows = enriched.aeroDrift?.windLayers ?? [];
    expect(rows.length).toBe(7);
    expect(rows[0]).toMatchObject({ altitudeFt: 0, windDirFrom: 200, windSpeedKts: 20 });
    expect(rows[3]).toMatchObject({ altitudeFt: 9000, windDirFrom: 300, windSpeedKts: 24 });
    expect(rows[5]).toMatchObject({ altitudeFt: 18000, windDirFrom: 120, windSpeedKts: 26 });
    // Ketinggian distress dikoreksi ke nilai teks (18000 ft).
    expect(enriched.incident?.altitudeFt).toBe(18000);
    expect(enriched.incident?.flightLevelFt).toBeUndefined();
    // Dua koreksi tercatat dan dilaporkan.
    const fields = corrections.map((entry) => entry.field);
    expect(fields).toContain('aeroDrift.windLayers');
    expect(fields).toContain('incident.altitudeFt');
    const awaCorrection = corrections.find((entry) => entry.field === 'aeroDrift.windLayers');
    expect(awaCorrection?.to).toContain('7 baris: 0ft 200°/20kt, 3000ft 180°/12kt');
  });

  test('bacaan model SAMA dengan teks → tidak ada koreksi (nilai model dipertahankan)', () => {
    const correctModel: SarCaseSchema = sarCaseSchema.parse({
      schemaVersion: 1,
      incident: { type: 'aircraft-ditching', altitudeFt: 18000 },
      aeroDrift: {
        windLayers: [
          { altitudeFt: 0, altitudeLabel: 'Surface', windDirFrom: 200, windSpeedKts: 20 },
          { altitudeFt: 3000, windDirFrom: 180, windSpeedKts: 12 },
          { altitudeFt: 6000, windDirFrom: 190, windSpeedKts: 25 },
          { altitudeFt: 9000, windDirFrom: 300, windSpeedKts: 24 },
          { altitudeFt: 12000, windDirFrom: 250, windSpeedKts: 24 },
          { altitudeFt: 18000, windDirFrom: 120, windSpeedKts: 26 },
          { altitudeFt: 24000, windDirFrom: 330, windSpeedKts: 40 },
        ],
      },
      meta: { source: 'pdf' },
    });
    const { case: enriched, corrections } = enrichCaseFromSourceText(correctModel, SOAL_SRX48);
    expect(corrections).toHaveLength(0);
    expect(enriched.incident?.altitudeFt).toBe(18000);
    expect(enriched.aeroDrift?.windLayers?.[0]).toMatchObject({ altitudeLabel: 'Surface', windDirFrom: 200 });
  });

  test('FL model yang didukung teks (FL200) TIDAK dikoreksi oleh parser altitude', () => {
    const soalFl = 'kontak terakhir di ketinggian FL200 dengan heading 103⁰(M).';
    const modelFl: SarCaseSchema = sarCaseSchema.parse({
      schemaVersion: 1,
      incident: { type: 'aircraft-ditching', flightLevelFt: 200 },
      meta: { source: 'pdf' },
    });
    const { case: enriched, corrections } = enrichCaseFromSourceText(modelFl, soalFl);
    expect(corrections).toHaveLength(0);
    expect(enriched.incident?.flightLevelFt).toBe(200);
  });
});
