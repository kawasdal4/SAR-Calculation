/**
 * Test CaseNaskah (Fase 5a) — template naskah PK-TAL + coverage check.
 * Jalankan: bun test tests/caseNaskah.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  renderCaseNaskah,
  checkNaskahCoverage,
  naskahToPlainText,
  expectedNaskahFields,
  fmtId,
  fmtHeading3,
  formatDmsDecimalMinutes,
  formatDmsSpaced,
  splitCaseTime,
} from '../src/lib/sar/caseNaskah';
import { parseSarCase } from '../src/lib/sar/caseSchema';
import { generateCase } from '../src/lib/sar/caseGenerator';
import pkTalJson from './golden/pk-tal.case.json';

const PK_TAL = pkTalJson as unknown;

describe('Helper format gaya naskah', () => {
  it('fmtId pakai desimal koma Indonesia', () => {
    expect(fmtId(0.3)).toBe('0,3');
    expect(fmtId(1.8)).toBe('1,8');
    expect(fmtId(103)).toBe('103');
    expect(fmtId(2.45)).toBe('2,45');
  });

  it('fmtHeading3 pad 3 digit + derajat', () => {
    expect(fmtHeading3(55)).toBe('055°');
    expect(fmtHeading3(250)).toBe('250°');
    expect(fmtHeading3(360)).toBe('000°');
  });

  it('formatDmsDecimalMinutes gaya tabel SRU PK-TAL', () => {
    expect(formatDmsDecimalMinutes(-6.841667, false)).toBe('6° 50,5′ S');
    expect(formatDmsDecimalMinutes(105.491667, true)).toBe('105° 29,5′ E');
  });

  it('formatDmsSpaced menambah spasi pada DMS padat', () => {
    expect(formatDmsSpaced('06°52′46″S')).toBe('06° 52′ 46″ S');
  });

  it('splitCaseTime memecah tanggal/waktu/zona', () => {
    const parts = splitCaseTime('18 November 2026 13.50 WIB');
    expect(parts.date).toBe('18 November 2026');
    expect(parts.time).toBe('13.50');
    expect(parts.zone).toBe('WIB');
  });
});

describe('renderCaseNaskah — naskah resmi PK-TAL (golden fixture)', () => {
  it('coverage 100% terhadap fixture soal resmi Final Test XL 2026', () => {
    const parsed = parseSarCase(PK_TAL);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const naskah = renderCaseNaskah(parsed.data, { explicitSearchNumber: true });
    const cov = checkNaskahCoverage(parsed.data, naskah, { explicitSearchNumber: true });
    if (!cov.covered) console.error(cov.issues);
    expect(cov.covered).toBe(true);
    expect(cov.coveredCount).toBe(cov.total);
  });

  it('memuat struktur kop + judul + instruksi gaya PK-TAL', () => {
    const parsed = parseSarCase(PK_TAL);
    if (!parsed.ok) return;
    const naskah = renderCaseNaskah(parsed.data, { explicitSearchNumber: true });
    const t = naskah.text;
    expect(t).toContain('FINAL TEST');
    expect(t).toContain('Waktu: 360 Menit');
    expect(t).toContain('Open Book');
    expect(t).toContain('menerima panggilan "MAYDAY"');
    expect(t).toContain('Buatlah Rencana Operasi SAR Kecelakaan Pesawat PK-TAL');
    expect(t).toContain('Data Pesawat PK-TAL');
    expect(t).toContain('Data perhitungan Aeronautical Drift');
    expect(t).toContain('ALTITUDE');
    expect(t).toContain('Tipe');
    expect(t).toContain('Call-Sign');
    expect(t).toContain('TIDAK disertakan dalam naskah');
  });

  it('tabel referensi IAMSAR TIDAK dicetak ke naskah', () => {
    const parsed = parseSarCase(PK_TAL);
    if (!parsed.ok) return;
    const t = renderCaseNaskah(parsed.data).text;
    // Nilai tabel I-1/I-2 (leeway rate) dan Fs tidak boleh muncul
    expect(t).not.toMatch(/0,03|leewayRate|safety factor/i);
    expect(t).not.toContain('Table I-7');
  });

  it('heading magnetik dicetak dengan marker (M)', () => {
    const parsed = parseSarCase(PK_TAL);
    if (!parsed.ok) return;
    const t = renderCaseNaskah(parsed.data).text;
    expect(t).toContain('heading 103°(M)');
  });
});

describe('renderCaseNaskah — kasus generator', () => {
  it('kasus pesawat mudah: nomor pencarian eksplisit', () => {
    const r = generateCase({ seed: 'naskah-m', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'mudah' });
    const naskah = renderCaseNaskah(r.case, { explicitSearchNumber: true });
    expect(naskah.text).toContain(`pencarian ke-${r.case.search?.searchNumber}`);
  });

  it('kasus sulit (jebakan inferensi): nomor pencarian tidak dinyatakan eksplisit', () => {
    const r = generateCase({
      seed: 'naskah-s', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sulit',
      traps: ['search-number-inference'],
    });
    const naskah = renderCaseNaskah(r.case, { explicitSearchNumber: false });
    expect(naskah.text).not.toContain('pencarian ke-');
    // Namun stage tetap dinyatakan agar peserta bisa menyimpulkan
    expect(naskah.text).toMatch(/stage 1/);
  });

  it('kasus kapal: bagian ADW tidak ada, posisi LKP dinyatakan', () => {
    const r = generateCase({ seed: 'naskah-k', incidentType: 'vessel-sinking', regionId: 'selat-makassar', difficulty: 'sedang' });
    const naskah = renderCaseNaskah(r.case);
    expect(naskah.text).not.toContain('Aeronautical Drift');
    expect(naskah.text).toContain('Data Kapal');
    expect(naskah.text).toContain('akan tenggelam pada posisi');
  });

  it('zona waktu wilayah mengikuti region (WITA/WIT)', () => {
    const r = generateCase({ seed: 'naskah-z', incidentType: 'aircraft-ditching', regionId: 'selat-bali', difficulty: 'sedang' });
    const naskah = renderCaseNaskah(r.case);
    expect(naskah.text).toContain('WITA');
  });

  it('rendisi deterministik: render ulang menghasilkan teks sama', () => {
    const r = generateCase({ seed: 'naskah-d', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'sedang' });
    const a = renderCaseNaskah(r.case).text;
    const b = renderCaseNaskah(r.case).text;
    expect(a).toBe(b);
  });
});

describe('checkNaskahCoverage — deteksi field hilang', () => {
  it('menandai field yang hilang bila bagian naskah dibuang (simulasi narasi LLM)', () => {
    const r = generateCase({ seed: 'cov-x', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'mudah' });
    const naskah = renderCaseNaskah(r.case, { explicitSearchNumber: true });
    const lines = naskah.text.split('\n');
    // Buang baris tabel SRU (mulai baris "SRU — ...")
    const idx = lines.findIndex((l) => l.startsWith('SRU'));
    expect(idx).toBeGreaterThan(0);
    const truncated = lines.slice(0, idx).join('\n');
    const cov = checkNaskahCoverage(r.case, { text: truncated }, { explicitSearchNumber: true });
    expect(cov.covered).toBe(false);
    expect(cov.issues.length).toBeGreaterThan(0);
    expect(cov.issues.some((i) => i.field.startsWith('sru['))).toBe(true);
  });

  it('menandai nilai yang diubah angkanya (anti-fabrikasi dasar)', () => {
    const r = generateCase({ seed: 'cov-y', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'mudah' });
    const naskah = renderCaseNaskah(r.case, { explicitSearchNumber: true });
    const glide = r.case.aeroDrift?.glideSpeedKts ?? 0;
    const wrongText = naskah.text.replace(new RegExp(`${fmtId(glide)} Knots`), '999 Knots');
    expect(wrongText).not.toContain(`${fmtId(glide)} Knots`);
    const cov = checkNaskahCoverage(r.case, { text: wrongText }, { explicitSearchNumber: true });
    expect(cov.covered).toBe(false);
    expect(cov.issues.some((i) => i.field === 'aeroDrift.glideSpeedKts')).toBe(true);
  });

  it('expectedNaskahFields memetakan field worksheet inti', () => {
    const r = generateCase({ seed: 'exp-1', incidentType: 'aircraft-ditching', regionId: 'selat-sunda', difficulty: 'mudah' });
    const fields = expectedNaskahFields(r.case).map((f) => f.field);
    expect(fields).toContain('incident.callsign');
    expect(fields).toContain('incident.pob');
    expect(fields).toContain('lkp.coord');
    expect(fields).toContain('aeroDrift.glideSpeedKts');
    expect(fields).toContain('aeroDrift.glideRatio');
    expect(fields).toContain('sea.current');
    expect(fields).toContain('search.datumTime');
    expect(fields.some((f) => f.startsWith('sru['))).toBe(true);
    expect(fields.some((f) => f.startsWith('aeroDrift.windLayers['))).toBe(true);
    expect(fields.some((f) => f.startsWith('sea.surfaceWindSeries['))).toBe(true);
  });
});

describe('naskahToPlainText', () => {
  it('tabel dirender baris "c1 — c2" dan labelValue "label : value"', () => {
    const blocks = [
      { kind: 'labelValue' as const, rows: [{ label: 'Type', value: 'Cessna 208 Caravan' }] },
      { kind: 'table' as const, columns: ['ALTITUDE', 'DIRECTION', 'VELOCITY'], rows: [['Surface', '045°', '5']] },
    ];
    const text = naskahToPlainText(blocks);
    expect(text).toContain('Type : Cessna 208 Caravan');
    expect(text).toContain('ALTITUDE — DIRECTION — VELOCITY');
    expect(text).toContain('Surface — 045° — 5');
  });
});
