/**
 * TEST TANGGAL & WAKTU KEJADIAN A.1 (aturan pengguna soal kasus FULL EXERCISE
 * SRX48 Ternate → Merauke):
 * 1. Tanggal angka berslash "03/12/2024" AMBIGU (DD/MM vs MM/DD) — keduanya
 *    kandidat; "17/11/2026" tidak ambigu (DD/MM tunggal).
 * 2. Kalimat DETRESFA → waktu kejadian A.1 = tanggal awal soal + jam DETRESFA
 *    ("pukul 1053 WIT" tanpa pemisah = 10.53).
 * 3. GERBANG KARTU WAKTU (aturan pengguna, 2026-11): tanggal ambigu / ≥2
 *    kandidat waktu kejadian → enrich TIDAK mengisi/mengoreksi waktu otomatis;
 *    kartu pilihan (kombinasi DD/MM×MM/DD × jam kejadian) + catatan dikirim,
 *    bacaan model yang tidak didukung kandidat DIHAPUS.
 * 4. Anchor chat: argumen set_awa_case siap pakai + anchor tanggal/waktu/LKP.
 * 5. Regresi PK-TAL (fixture lama): tanpa DETRESFA → lastContactTime tidak
 *    disentuh pass deterministik (bacaan model = kandidat soal persis).
 */

import { describe, test, expect } from 'bun:test';
import {
  findSlashDates,
  findCaseOpeningDate,
  parseDetresfaTime,
  extractCaseFacts,
  enrichCaseFromSourceText,
  buildTimeClarificationCards,
  parseLeadingIndoDateLabel,
  resolveDatumTimeValue,
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
• Direncanakan pencarian akan dilanjutkan esok hari pukul 0600 WIT.

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

describe('enrichCaseFromSourceText — gerbang kartu waktu (tanggal ambigu / banyak kandidat)', () => {
  test('tanggal ambigu + 2 waktu kejadian → TIDAK diisi otomatis; kartu kombinasi DD/MM×MM/DD × jam dikirim', () => {
    const result = enrichCaseFromSourceText(baseCase(), SOAL_FULL_EXERCISE);
    // Nilai waktu TIDAK diisi otomatis (tidak ada asumsi diam-diam AI).
    expect(result.case.incident.lastContactTime).toBeUndefined();
    expect(result.case.search?.datumTime).toBeUndefined();
    // Dua kartu: Waktu Kejadian (ADW A.1) dulu, lalu Datum Time (ASW).
    expect(result.timeClarifications.map((card) => card.kind)).toEqual(['incident', 'datum']);
    const incidentCard = result.timeClarifications[0];
    // Kombinasi 2 bacaan tanggal × 2 waktu kejadian (10.50 kerusakan & 10.53 DETRESFA).
    expect(incidentCard.candidates).toHaveLength(4);
    const values = incidentCard.candidates.map((candidate) => candidate.value);
    expect(values).toContain('03 Desember 2024 10.50 WIT');
    expect(values).toContain('03 Desember 2024 10.53 WIT');
    expect(values).toContain('12 Maret 2024 10.50 WIT');
    expect(values).toContain('12 Maret 2024 10.53 WIT');
    // Label menjelaskan bacaan tanggal + makna waktu + rekomendasi DETRESFA.
    expect(incidentCard.candidates.some((candidate) => candidate.label.includes('DD/MM'))).toBe(true);
    expect(incidentCard.candidates.some((candidate) => candidate.label.includes('MM/DD'))).toBe(true);
    expect(incidentCard.candidates.some((candidate) => candidate.label.includes('DETRESFA') && candidate.label.includes('umumnya dipakai'))).toBe(true);
    // Waktu Kantor SAR menerima informasi (11.05) BUKAN kandidat waktu kejadian.
    expect(values.some((value) => value.includes('11.05'))).toBe(false);
    // Catatan penjelas (bukan koreksi ⚠ "diambil dari TEKS soal").
    expect(result.timeClarificationNotes.some((note) => note.includes('incident.lastContactTime') && note.includes('tidak diisi otomatis'))).toBe(true);
    expect(result.corrections.filter((correction) => correction.field === 'incident.lastContactTime')).toHaveLength(0);
    // Kartu datum: kandidat tanpa tanggal + tanggal dasar bacaan DD/MM —
    // TANPA tanggal buatan +1 hari (aturan pengguna).
    const datumCard = result.timeClarifications[1];
    expect(datumCard.candidates.length).toBeGreaterThanOrEqual(3);
    expect(datumCard.candidates.some((candidate) => candidate.value.includes('10.53 WIT'))).toBe(true);
    expect(datumCard.candidates.some((candidate) => candidate.label.includes('esok hari'))).toBe(true);
    expect(datumCard.baseDateLabel).toBe('03 Desember 2024');
    expect(datumCard.baseDateNextDayLabel).toBeUndefined();
  });

  test('bacaan model TIDAK didukung kandidat ("12 Maret 2024 10.50 WIT") → DIHAPUS + kartu (bukan koreksi ⚠)', () => {
    const result = enrichCaseFromSourceText(
      baseCase({ lastContactTime: '12 Maret 2024 10.50 WIT' }),
      SOAL_FULL_EXERCISE,
    );
    expect(result.case.incident.lastContactTime).toBeUndefined();
    expect(result.timeClarifications.some((card) => card.kind === 'incident')).toBe(true);
    expect(result.timeClarificationNotes.some((note) => note.includes('DIHAPUS') && note.includes('12 Maret 2024 10.50 WIT'))).toBe(true);
    expect(result.corrections.filter((correction) => correction.field === 'incident.lastContactTime')).toHaveLength(0);
  });

  test('bacaan model = kandidat soal persis → DIPERTAHANKAN, kartu tetap tampil untuk konfirmasi', () => {
    const soalJelas = `12 Maret 2024, pesawat berangkat.
Pada pukul 1050 WIT pesawat melaporkan kerusakan pada kedua mesin.
ATC declare DETRESFA pada pukul 1053 WIT dengan LKP pada koordinat 4°59'00"S -133°53'48"E.`;
    const result = enrichCaseFromSourceText(
      baseCase({ lastContactTime: '12 Maret 2024 10.53 WIT' }),
      soalJelas,
    );
    expect(result.case.incident.lastContactTime).toBe('12 Maret 2024 10.53 WIT');
    expect(result.timeClarificationNotes.some((note) => note.includes('salah satu kandidat') && note.includes('KONFIRMASI'))).toBe(true);
    // Kartu waktu kejadian tetap wajib (2 kandidat jam kejadian: 10.50 vs 10.53).
    const incidentCard = result.timeClarifications.find((card) => card.kind === 'incident');
    expect(incidentCard).toBeDefined();
    expect(incidentCard!.candidates).toHaveLength(2);
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

  test('tanggal tidak ambigu (nama bulan) + DETRESFA tunggal → deterministik VERIFIED tanpa kartu waktu', () => {
    const soal = `12 Maret 2024, pesawat berangkat.
ATC declare DETRESFA pada pukul 1053 WIT dengan LKP pada koordinat 4°59'00"S -133°53'48"E.`;
    const result = enrichCaseFromSourceText(baseCase(), soal);
    expect(result.case.incident.lastContactTime).toBe('12 Maret 2024 10.53 WIT');
    const source = result.case.meta?.fieldSources?.find((s) => s.field === 'incident.lastContactTime');
    expect(source?.status).toBe('VERIFIED');
    expect(result.timeClarifications).toHaveLength(0);
    expect(result.case.meta?.assumptions?.some((a) => a.field === 'incident.lastContactTime')).toBe(false);
  });

  test('buildTimeClarificationCards: kartu datum punya tanggal dasar — kandidat esok/besok digabung tanggal soal +1 hari', () => {
    const facts = extractCaseFacts(SOAL_FULL_EXERCISE);
    const cards = buildTimeClarificationCards(facts);
    expect(cards.map((card) => card.kind)).toEqual(['incident', 'datum']);
    const datumCard = cards[1];
    expect(datumCard.question).toContain('digabung dengan tanggal');
    expect(datumCard.question).toContain('+1 hari');
    expect(datumCard.baseDateLabel).toBe('03 Desember 2024');
    // Kartu kejadian: kandidat sudah memuat tanggal (dateLabel terisi).
    expect(cards[0].candidates.every((candidate) => typeof candidate.dateLabel === 'string' && candidate.dateLabel.length > 0)).toBe(true);
  });
});

describe('helper penggabungan tanggal kandidat datum (resolveDatumTimeValue)', () => {
  test('parseLeadingIndoDateLabel: "03 Desember 2024 10.53 WIT" → "03 Desember 2024"', () => {
    expect(parseLeadingIndoDateLabel('03 Desember 2024 10.53 WIT')).toBe('03 Desember 2024');
    expect(parseLeadingIndoDateLabel('10.53 WIT')).toBeNull();
  });

  test('resolveDatumTimeValue: kandidat tanpa tanggal digabung tanggal soal; kandidat esok/besok digabung tanggal soal +1 hari (aturan pengguna)', () => {
    const base = '03 Desember 2024';
    expect(resolveDatumTimeValue({ value: '10.53 WIT' }, base)).toBe('03 Desember 2024 10.53 WIT');
    // Aturan esok/besok: kandidat dengan dayOffset=1 (frasa "esok"/"besok" di
    // soal) adalah HARI BERIKUTNYA — digabung tanggal soal +1 HARI.
    expect(
      resolveDatumTimeValue(
        { value: '06.00 WIT', source: 'Direncanakan pencarian akan dilanjutkan esok hari pukul 0600 WIT.', dayOffset: 1 },
        base,
      ),
    ).toBe('04 Desember 2024 06.00 WIT');
    // Kandidat bertanggal tidak disentuh; tanpa tanggal dasar juga apa adanya.
    expect(resolveDatumTimeValue({ value: '19 November 2026 07.00 WIB' }, base)).toBe('19 November 2026 07.00 WIB');
    expect(resolveDatumTimeValue({ value: '10.53 WIT' })).toBe('10.53 WIT');
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

// ── Aturan pengguna: SELURUH tanggal/waktu soal tampil di kartu, MINUS data
//    angin (ASW) & forecast cuaca; aturan esok/besok: tanggal kandidat =
//    tanggal soal +1 hari ──────────

const SOAL_ASW_ANGIN_FORECAST = `Pada 18 November 2026 pesawat PK-XYZ berangkat pukul 09.00 WIT.
ATC declare DETRESFA pada pukul 09.20 WIT dengan LKP pada koordinat 4°59'00"S.
SRU tiba di lokasi 13.30 WIT.
Data angin:
00.00 WIB 155⁰ / 12kts
06.00 WIB 260⁰ / 14 kts
12.00 WIB 285⁰ / 13 kts
18.00 WIB 310⁰ / 10 kts
00.00 WIB 155⁰ / 12 kts
Prakiraan cuaca tanggal 19 November 2026 pukul 03.00 UTC:
Wind 150°/10 kts, Wave 1.5 m, Weather shower.
Appendix 4. SRUs Details
Direncanakan pencarian akan dilanjutkan esok hari pukul 0600 WIT.`;

describe('kandidat waktu = seluruh soal MINUS data angin & forecast (aturan pengguna)', () => {
  test('waktu berzona TANPA "pukul" ikut jadi kandidat ("SRU tiba di lokasi 13.30 WIT")', () => {
    const candidates = findDatumTimeCandidates('SRU tiba di lokasi 06.30 WIT pada 19 November 2026.');
    expect(candidates.length).toBe(1);
    expect(candidates[0].value).toBe('19 November 2026 06.30 WIT');
  });

  test('baris deret angin (jika berzona) & waktu forecast cuaca BUKAN kandidat', () => {
    const candidates = findDatumTimeCandidates(SOAL_ASW_ANGIN_FORECAST);
    const values = candidates.map((c) => c.value);
    // Seluruh waktu narasi soal tampil.
    expect(values).toContain('18 November 2026 09.00 WIT'); // berangkat
    expect(values).toContain('18 November 2026 09.20 WIT'); // DETRESFA
    expect(values).toContain('18 November 2026 13.30 WIT'); // SRU tiba (tanpa "pukul")
    expect(values).toContain('19 November 2026 06.00 WIT'); // pencarian dilanjutkan esok hari → tanggal soal 18 Nov +1 hari
    // Waktu data angin (deret angin ASW) dikecualikan.
    expect(values.some((v) => v.includes('WIB'))).toBe(false);
    expect(values.some((v) => /00\.00 WIB|12\.00 WIB|18\.00 WIB/.test(v))).toBe(false);
    // Waktu forecast cuaca dikecualikan (19 November 2026 03.00 UTC) — satu-
    // satunya kandidat 19 November adalah hasil aturan esok (06.00 WIT),
    // bukan bocoran jam/tanggal forecast.
    expect(values.some((v) => v.includes('03.00 UTC'))).toBe(false);
    expect(values.filter((v) => v.includes('19 November 2026'))).toEqual(['19 November 2026 06.00 WIT']);
  });

  test('label "esok hari" jelas (Waktu pencarian dilanjutkan) — tanggal narasi +1 hari, bukan tanggal forecast', () => {
    const candidates = findDatumTimeCandidates(SOAL_ASW_ANGIN_FORECAST);
    const esok = candidates.find((c) => c.label.includes('Waktu pencarian dilanjutkan'));
    expect(esok).toBeDefined();
    expect(esok!.label).toContain('esok hari');
    expect(esok!.label).toContain('tanggal soal +1 hari');
    expect(esok!.dayOffset).toBe(1);
    // Aturan esok/besok: tanggal kandidat = tanggal NARASI soal (18 November)
    // +1 hari = 19 November — bukan penyerapan tanggal/jam forecast (19 Nov
    // 03.00 UTC); jam tetap 06.00 WIT dari soal.
    expect(esok!.value).toBe('19 November 2026 06.00 WIT');
  });

  test('tanggal blok data angin tidak menempel ke kandidat narasi sesudahnya', () => {
    const soal = `Pada 18 November 2026 pesawat berangkat pukul 05.00 WIT.
Data angin dari tanggal 20 November 2026:
1) 00.00 50⁰ / 5 kts
2) 06.00 69⁰ / 10 kts
3) 12.00 80⁰ / 12 kts
4) 18.00 96⁰ / 10 kts
5) 00.00 102⁰ / 7 kts
6) 06.00 90⁰ / 9 kts
Pencarian kedua akan dilakukan pukul 14.00 WIT.`;
    const candidates = findDatumTimeCandidates(soal);
    const second = candidates.find((c) => c.label.includes('Waktu pencarian kedua'));
    expect(second).toBeDefined();
    // Tanggal dasar deret angin (di dalam blok, 20 November) TIDAK dijadikan
    // tanggal kandidat narasi — tanggal kandidat = tanggal narasi soal.
    expect(second!.value).toBe('18 November 2026 14.00 WIT');
    expect(second!.value).not.toContain('20 November 2026');
  });

  test('DTG "1118.0100 Z" tidak pecah menjadi kandidat palsu "00.00 Z"', () => {
    const candidates = findDatumTimeCandidates('Datum time ditetapkan 1118.0100 Z pada area pencarian.');
    expect(candidates.every((c) => c.value !== '00.00 Z')).toBe(true);
    expect(candidates.every((c) => c.value !== '18.01 Z')).toBe(true);
  });

  test('FULL EXERCISE SRX48: kartu datum memuat 4 waktu narasi (incl. esok hari), tanpa waktu deret angin', () => {
    const facts = extractCaseFacts(SOAL_FULL_EXERCISE);
    const candidates = facts.datumTimeCandidates?.value ?? [];
    const values = candidates.map((c) => c.value);
    expect(values).toContain('10.50 WIT'); // kerusakan (tanpa tanggal — tanggal berslash ambigu)
    expect(values).toContain('10.53 WIT'); // DETRESFA
    expect(values).toContain('11.05 WIT'); // informasi diterima
    expect(values.some((c) => c.includes('06.00 WIT'))).toBe(true); // esok hari
    expect(candidates.some((c) => c.label.includes('Waktu pencarian dilanjutkan (esok hari)'))).toBe(true);
    // Tidak ada waktu dari deret angin soal (00.00/06.00/12.00/18.00 tanpa zona
    // dan tanpa "pukul") maupun tanggal buatan.
    expect(values.every((v) => !v.startsWith('00.00') && !v.includes('12.00'))).toBe(true);
    expect(values.every((v) => !v.includes('04 Desember 2024'))).toBe(true);
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
