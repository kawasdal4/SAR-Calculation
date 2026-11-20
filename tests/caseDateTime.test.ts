/**
 * TEST TANGGAL & WAKTU KEJADIAN A.1 (aturan pengguna soal kasus FULL EXERCISE
 * SRX48 Ternate → Merauke):
 * 1. Tanggal angka berslash "03/12/2024" AMBIGU (DD/MM vs MM/DD) — keduanya
 *    kandidat; "17/11/2026" tidak ambigu (DD/MM tunggal).
 * 2. Kalimat DETRESFA → waktu kejadian A.1 = tanggal awal soal + jam DETRESFA
 *    ("pukul 1053 WIT" tanpa pemisah = 10.53).
 * 3. enrichCaseFromSourceText mengisi incident.lastContactTime (kosong → isi;
 *    model isi salah → koreksi) + catatan DIASUMSIKAN untuk tanggal ambigu.
 * 4. Anchor chat: argumen set_awa_case siap pakai + anchor tanggal/waktu/LKP.
 * 5. Regresi PK-TAL (fixture lama): tanpa DETRESFA → lastContactTime tidak
 *    disentuh pass deterministik.
 */

import { describe, test, expect } from 'bun:test';
import {
  findSlashDates,
  findCaseOpeningDate,
  parseDetresfaTime,
  extractCaseFacts,
  enrichCaseFromSourceText,
  formatAwaCaseDataAnchor,
  formatIncidentDateTimeAnchor,
  formatAswDatumTimeAnchor,
  findDatumTimeCandidates,
  type SarCaseSchema,
} from '../src/lib/ai/caseTextEnrich';

const SOAL_FULL_EXERCISE = `FULL EXERCISE
DIKLAT PERENCANAAN OPERASI SAR
• 03/12/2024, pesawat SRX48 berangkat dari Ternate menuju Merauke dengan
6 POB (2 crews & 4 passengers).
• Pada pukul 1050 WIT Pesawat melaporkan kerusakan pada kedua mesin dan
melaporkan kepada ATC di ketinggian 18000 feet dengan heading 134⁰(M).
• ATC melakukan panggilan dan tidak ada respon.
• ATC declare DETRESFA pada pukul 1053 WIT dengan LKP pada koordinat
4°59'00"S -133°53'48"E.
• Kantor SAR Ambon menerima informasi dari ATC pukul 1105 WIT via telephone.

Appendix 3. Meteorological Information
KETINGGIAN ALTITUDE ARAH DIRECTON KECEPATAN SPEED
Surface 200⁰ 20
3000 FT 180⁰ 12
6000 FT 190⁰ 25
9000 FT 300⁰ 24
12000 FT 250⁰ 24
18000 FT 120⁰ 26
24000 FT 330⁰ 40

Arus laut di lokasi : 25⁰ / 1.3kts`;

describe('findSlashDates / findCaseOpeningDate (ambiguitas DD/MM vs MM/DD)', () => {
  test('"03/12/2024" ambigu: kandidat 3 Desember (DD/MM) dan 12 Maret (MM/DD)', () => {
    const dates = findSlashDates(SOAL_FULL_EXERCISE);
    expect(dates.length).toBeGreaterThan(0);
    const first = dates[0];
    expect(first.raw).toBe('03/12/2024');
    expect(first.ambiguous).toBe(true);
    expect(first.dayFirst).toEqual({ day: 3, month: 12, year: 2024 });
    expect(first.monthFirst).toEqual({ day: 12, month: 3, year: 2024 });
  });

  test('tanggal tidak ambigu (komponen > 12) → bacaan tunggal', () => {
    const fact = findCaseOpeningDate('Pencarian pada 17/11/2026 dilakukan pukul 07.00.');
    expect(fact).not.toBeNull();
    expect(fact!.ambiguous).toBe(false);
    expect(fact!.reading).toEqual({ day: 17, month: 11, year: 2026 });
    expect(fact!.readings).toHaveLength(1);
    expect(fact!.readings[0].label).toBe('17 November 2026');
  });

  test('angka bukan tanggal ("155⁰ / 12kts") tidak dianggap tanggal', () => {
    expect(findSlashDates('00.00 155⁰ / 12kts dan 06.00 260⁰ / 14 kts')).toHaveLength(0);
  });

  test('findCaseOpeningDate pada soal FULL EXERCISE → tanggal pertama ambigu dengan 2 kandidat berlabel', () => {
    const fact = findCaseOpeningDate(SOAL_FULL_EXERCISE);
    expect(fact).not.toBeNull();
    expect(fact!.raw).toBe('03/12/2024');
    expect(fact!.ambiguous).toBe(true);
    expect(fact!.readings).toHaveLength(2);
    expect(fact!.readings[0].label).toBe('03 Desember 2024');
    expect(fact!.readings[1].label).toBe('12 Maret 2024');
  });

  test('nama bulan lebih dulu dipilih daripada tanggal berslash (tidak ambigu)', () => {
    const fact = findCaseOpeningDate('Pada 12 Maret 2024 pesawat berangkat. Data 03/12/2024 tersedia.');
    expect(fact).not.toBeNull();
    expect(fact!.ambiguous).toBe(false);
    expect(fact!.readings[0].label).toBe('12 Maret 2024');
  });
});

describe('parseDetresfaTime (waktu kejadian A.1)', () => {
  test('"ATC declare DETRESFA pada pukul 1053 WIT" → 10.53 WIT (jam 4 digit tanpa pemisah)', () => {
    const fact = parseDetresfaTime(SOAL_FULL_EXERCISE);
    expect(fact).not.toBeNull();
    expect(fact!.hour).toBe(10);
    expect(fact!.minute).toBe(53);
    expect(fact!.zone).toBe('WIT');
  });

  test('varian dengan pemisah dan bahasa Inggris', () => {
    const dotted = parseDetresfaTime('ATC declared DETRESFA at 10.53 WIT dengan LKP jelas.');
    expect(dotted?.hour).toBe(10);
    expect(dotted?.minute).toBe(53);
    expect(dotted?.zone).toBe('WIT');
    const utc = parseDetresfaTime('RCC declare DETRESFA at 0153Z');
    expect(utc?.hour).toBe(1);
    expect(utc?.minute).toBe(53);
    expect(utc?.zone).toBe('Z');
  });

  test('soal tanpa DETRESFA → null', () => {
    expect(parseDetresfaTime('JATSC menerima panggilan MAYDAY pukul 13.50 WIB.')).toBeNull();
  });
});

describe('extractCaseFacts — fact baru', () => {
  test('soal FULL EXERCISE: caseDate ambigu + detresfaTime + lkpCoord "LKP pada koordinat"', () => {
    const facts = extractCaseFacts(SOAL_FULL_EXERCISE);
    expect(facts.caseDate?.ambiguous).toBe(true);
    expect(facts.detresfaTime?.value.hour).toBe(10);
    expect(facts.detresfaTime?.value.minute).toBe(53);
    // Varian label "LKP pada koordinat" (kalimat DETRESFA) kini tertangkap.
    expect(facts.lkpCoord?.value.lat).toBeCloseTo(-4.983333, 4);
    expect(facts.lkpCoord?.value.lng).toBeCloseTo(133.896667, 4);
    expect(facts.lkpCoord?.value.dmsLat).toBe('4°59\'00"S');
    // Arus "1.3kts" → 1.3 kts (bukan 13 kts).
    expect(facts.current?.value.speedKts).toBeCloseTo(1.3, 6);
  });
});

function baseCase(overrides: Partial<SarCaseSchema['incident']> = {}): SarCaseSchema {
  return {
    schemaVersion: 1,
    incident: { type: 'aircraft-ditching', ...overrides },
    target: {},
    sarOffice: {},
    lkp: { source: 'explicit' },
    aeroDrift: {},
    sea: {},
    search: {},
    sru: [],
    meta: { source: 'pdf' },
  } as unknown as SarCaseSchema;
}

describe('enrichCaseFromSourceText — tanggal & waktu kejadian A.1', () => {
  test('field kosong → diisi tanggal awal soal + jam DETRESFA + catatan ambigu (UNVERIFIED)', () => {
    const result = enrichCaseFromSourceText(baseCase(), SOAL_FULL_EXERCISE);
    expect(result.case.incident.lastContactTime).toBe('03 Desember 2024 10.53 WIT');
    const assumption = result.case.meta?.assumptions?.find((a) => a.field === 'incident.lastContactTime');
    expect(assumption).toBeDefined();
    expect(assumption?.reason).toContain('AMBIGU');
    expect(assumption?.reason).toContain('12 Maret 2024');
    const source = result.case.meta?.fieldSources?.find((s) => s.field === 'incident.lastContactTime');
    expect(source?.status).toBe('UNVERIFIED');
    expect(result.filled.some((f) => f.field === 'incident.lastContactTime')).toBe(true);
  });

  test('model mengisi waktu salah (10.50) → DIKOREKSI ke jam DETRESFA (10.53)', () => {
    const result = enrichCaseFromSourceText(
      baseCase({ lastContactTime: '12 Maret 2024 10.50 WIT' }),
      SOAL_FULL_EXERCISE,
    );
    expect(result.case.incident.lastContactTime).toBe('03 Desember 2024 10.53 WIT');
    expect(result.corrections.some((c) => c.field === 'incident.lastContactTime' && c.from.includes('10.50'))).toBe(true);
  });

  test('model sudah memakai jam DETRESFA → tidak ditimpa', () => {
    const result = enrichCaseFromSourceText(
      baseCase({ lastContactTime: '12 Maret 2024 10.53 WIT' }),
      SOAL_FULL_EXERCISE,
    );
    expect(result.case.incident.lastContactTime).toBe('12 Maret 2024 10.53 WIT');
    expect(result.corrections.filter((c) => c.field === 'incident.lastContactTime')).toHaveLength(0);
  });

  test('soal tanpa DETRESFA (PK-TAL) → lastContactTime tidak disentuh', () => {
    const soal = 'Pada 18 November 2026 pukul 14.10 WIB Kantor SAR menerima informasi bahwa pada pukul 13.50 WIB JATSC menerima panggilan MAYDAY dari pesawat PK-TAL.';
    const result = enrichCaseFromSourceText(
      baseCase({ lastContactTime: '18 November 2026 13.50 WIB' }),
      soal,
    );
    expect(result.case.incident.lastContactTime).toBe('18 November 2026 13.50 WIB');
    expect(result.corrections).toHaveLength(0);
  });

  test('tanggal tidak ambigu (nama bulan) → status VERIFIED tanpa asumsi ambigu', () => {
    const soal = `12 Maret 2024, pesawat berangkat.
ATC declare DETRESFA pada pukul 1053 WIT dengan LKP pada koordinat 4°59'00"S -133°53'48"E.`;
    const result = enrichCaseFromSourceText(baseCase(), soal);
    expect(result.case.incident.lastContactTime).toBe('12 Maret 2024 10.53 WIT');
    const source = result.case.meta?.fieldSources?.find((s) => s.field === 'incident.lastContactTime');
    expect(source?.status).toBe('VERIFIED');
    expect(result.case.meta?.assumptions?.some((a) => a.field === 'incident.lastContactTime')).toBe(false);
  });
});

describe('anchor chat AI (set_awa_case siap pakai + tanggal/waktu/LKP)', () => {
  test('formatAwaCaseDataAnchor menghasilkan JSON baris angin persis', () => {
    const facts = extractCaseFacts(SOAL_FULL_EXERCISE);
    const anchor = formatAwaCaseDataAnchor(facts.windLayers!.value, 18000);
    expect(anchor).toContain('distressAltFt: 18000');
    expect(anchor).toContain('{"altObs":"0","windDirFrom":200,"windSpeed":20}');
    expect(anchor).toContain('{"altObs":"24000","windDirFrom":330,"windSpeed":40}');
    expect(anchor).toContain('altObs "0" = Surface');
  });

  test('formatIncidentDateTimeAnchor: tanggal ambigu → perintah konfirmasi clarify_incident_time', () => {
    const facts = extractCaseFacts(SOAL_FULL_EXERCISE);
    const anchor = formatIncidentDateTimeAnchor({
      caseDate: facts.caseDate,
      detresfaTime: facts.detresfaTime,
      lkpCoord: facts.lkpCoord,
    });
    expect(anchor).toContain('AMBIGU');
    expect(anchor).toContain('clarify_incident_time');
    expect(anchor).toContain('WAKTU KEJADIAN A.1 ADW = WAKTU DEKLARASI DETRESFA: pukul 10.53 WIT');
    expect(anchor).toContain("4°59'00\"S");
    expect(anchor).toContain('133°53\'48"E');
  });

  test('formatIncidentDateTimeAnchor: tanggal jelas (nama bulan) → tanpa perintah konfirmasi', () => {
    const anchor = formatIncidentDateTimeAnchor({
      caseDate: findCaseOpeningDate('Pada 19 November 2026 pesawat berangkat.')!,
    });
    expect(anchor).toContain('TANGGAL AWAL SOAL: 19 November 2026');
    expect(anchor).not.toContain('AMBIGU');
  });

  test('formatIncidentDateTimeAnchor tanpa input → null', () => {
    expect(formatIncidentDateTimeAnchor({})).toBeNull();
  });
});

// ── Kartu pemilihan Datum Time (aturan pengguna: banyak tanggal/waktu di soal) ──

const SOAL_BANYAK_WAKTU = `Pada 18 November 2026 pesawat PK-ABC berangkat dari Fakta pukul 06.00 WIT.
Pada pukul 07.15 WIT ATC menerima panggilan MAYDAY dari pilot.
Kantor SAR Ambon menerima informasi dari ATC pukul 07.30 WIT via telephone.
ATC declare DETRESFA pada pukul 0720 WIT dengan LKP pada koordinat 4°59'00"S.
Pencarian pertama dilakukan pukul 01.00 UTC.
Pencarian kedua akan dilakukan pukul 03.00 UTC.`;

describe('findDatumTimeCandidates (kandidat waktu naratif untuk kartu Datum Time)', () => {
  test('soal banyak waktu → ≥4 kandidat berlabel + nilai + kutipan', () => {
    const candidates = findDatumTimeCandidates(SOAL_BANYAK_WAKTU);
    expect(candidates.length).toBeGreaterThanOrEqual(5);
    const values = candidates.map((c) => c.value);
    expect(values).toContain('18 November 2026 06.00 WIT'); // berangkat
    expect(values).toContain('18 November 2026 07.15 WIT'); // MAYDAY
    expect(values).toContain('18 November 2026 07.30 WIT'); // informasi diterima
    expect(values).toContain('18 November 2026 07.20 WIT'); // DETRESFA ("0720" = 07.20)
    expect(values).toContain('18 November 2026 01.00 UTC'); // pencarian pertama
    expect(values).toContain('18 November 2026 03.00 UTC'); // pencarian kedua
    for (const c of candidates) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.source.length).toBeGreaterThan(0);
      expect(c.label).toContain('—');
    }
    const labels = candidates.map((c) => c.label).join(' | ');
    expect(labels).toContain('Waktu MAYDAY diterima');
    expect(labels).toContain('Waktu deklarasi DETRESFA');
    expect(labels).toContain('Waktu Kantor SAR/RCC menerima informasi');
    expect(labels).toContain('Waktu pencarian pertama');
    expect(labels).toContain('Waktu pencarian kedua');
  });

  test('label pencarian kedua/pertama terdeteksi dari frasa', () => {
    const candidates = findDatumTimeCandidates('Pencarian kedua akan dilakukan pukul 03.00 UTC pada 19 November 2026.');
    expect(candidates.length).toBe(1);
    expect(candidates[0].label).toContain('Waktu pencarian kedua');
    expect(candidates[0].value).toBe('19 November 2026 03.00 UTC');
  });

  test('waktu sama disebut dua frasa → dicatat sekali (dedupe)', () => {
    const candidates = findDatumTimeCandidates(
      'Pencarian dilakukan pukul 03.00 UTC. SRU tiba di lokasi pukul 03.00 UTC pada 19 November 2026.',
    );
    expect(candidates.length).toBe(1);
  });

  test('soal satu waktu pencarian tunggal → tepat 1 kandidat', () => {
    const candidates = findDatumTimeCandidates('SRU tiba di lokasi pukul 06.30 WIT pada 19 November 2026.');
    expect(candidates.length).toBe(1);
    expect(candidates[0].value).toBe('19 November 2026 06.30 WIT');
    expect(candidates[0].label).toContain('SRU/unit tiba di lokasi');
  });

  test('tabel deret angin (tanpa kata pukul) tidak ikut jadi kandidat', () => {
    const candidates = findDatumTimeCandidates(
      'Data angin dari tanggal 18 November 2026:\n07.00 180°/10 kts\n10.00 190°/12 kts\n13.00 200°/14 kts\nSRU tiba di lokasi pukul 06.30 WIT.',
    );
    expect(candidates.length).toBe(1);
  });

  test('teks kosong → tanpa kandidat', () => {
    expect(findDatumTimeCandidates('')).toEqual([]);
  });
});

describe('formatAswDatumTimeAnchor (kartu pemilihan Datum Time + mode interval ASW)', () => {
  test('≥2 kandidat → perintah WAJIB kartu clarify_datum_time dengan semua kandidat', () => {
    const facts = extractCaseFacts(SOAL_BANYAK_WAKTU);
    const anchor = formatAswDatumTimeAnchor(facts);
    expect(anchor).not.toBeNull();
    expect(anchor).toContain('KANDIDAT TANGGAL/WAKTU');
    expect(anchor).toContain('WAJIB tampilkan KARTU PEMILIHAN WAKTU');
    expect(anchor).toContain('clarify_datum_time');
    expect(anchor).toContain('JANGAN memilih sendiri');
    expect(anchor).toContain('Waktu pencarian kedua');
    expect(anchor).toContain('03.00 UTC');
    expect(anchor).toContain('Waktu deklarasi DETRESFA');
  });

  test('tepat 1 kandidat → instruksi pakai langsung, TANPA perintah kartu', () => {
    const facts = extractCaseFacts('SRU tiba di lokasi pukul 06.30 WIT pada 19 November 2026.');
    const anchor = formatAswDatumTimeAnchor(facts);
    expect(anchor).not.toBeNull();
    expect(anchor).toContain('Pakai PERSIS sebagai datumTime');
    expect(anchor).not.toContain('KARTU PEMILIHAN');
  });

  test('mode interval 3 jam → intervalMode "3h" di anchor', () => {
    const soal = 'Data angin dari tanggal 18 November 2026:\n07.00 180°/10 kts\n10.00 190°/12 kts\n13.00 200°/14 kts';
    const facts = extractCaseFacts(soal);
    const anchor = formatAswDatumTimeAnchor(facts);
    expect(anchor).toContain('MODE INTERVAL OBSERVASI ASW');
    expect(anchor).toContain('"3h"');
    expect(anchor).toContain('3 jam');
  });

  test('mode interval 6 jam → intervalMode "6h" di anchor', () => {
    const soal = 'Data angin dari tanggal 18 November 2026:\n00.00 180°/10 kts\n06.00 190°/12 kts\n12.00 200°/14 kts\n18.00 210°/16 kts';
    const facts = extractCaseFacts(soal);
    const anchor = formatAswDatumTimeAnchor(facts);
    expect(anchor).toContain('"6h"');
  });

  test('tanpa kandidat & tanpa deret angin → null', () => {
    expect(formatAswDatumTimeAnchor(extractCaseFacts('Koordinat LKP 4°59\'00"S -133°53\'48"E.'))).toBeNull();
  });
});
