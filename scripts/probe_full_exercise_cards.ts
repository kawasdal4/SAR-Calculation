/**
 * PROBE E2E — skenario pengguna (FULL EXERCISE SRX48):
 * model mengisi lastContactTime "03/12/2024 10.50 WIT" + altitude salah →
 * enrich HARUS: mengoreksi altitude (⚠), MENGHAPUS waktu ambigu (bukan
 * koreksi), dan mengirim 2 kartu pilihan waktu — kandidat HANYA tanggal/waktu
 * yang tertulis di soal (4 kandidat datum incl. "esok hari"; waktu data angin
 * & forecast cuaca dikecualikan) TANPA tanggal buatan +1 hari.
 */
import { extractPdfTextFromBase64 } from '../src/lib/ai/pdfText';
import { enrichCaseFromSourceText } from '../src/lib/ai/caseTextEnrich';
import { sarCaseSchema, type SarCaseSchema } from '../src/lib/sar/caseSchema';
import { buildCaseExtractionResult } from '../src/lib/ai/parseCase';

async function main() {
  const fs = await import('node:fs');
  const pdfPath = '/home/z/my-project/upload/FULL EXERCISE.pdf';
  const base64 = fs.readFileSync(pdfPath).toString('base64');
  const text = await extractPdfTextFromBase64(base64);
  console.log('PDF text length:', text.length);

  const modelCase = sarCaseSchema.parse({
    schemaVersion: 1,
    incident: {
      type: 'aircraft-ditching',
      callsign: 'SRX48',
      lastContactTime: '03/12/2024 10.50 WIT',
      altitudeFt: 18000,
      flightLevelFt: 180,
    },
    search: {},
    meta: { source: 'pdf' },
  }) as SarCaseSchema;

  const result = enrichCaseFromSourceText(modelCase, text);
  console.log('\n=== KOREKSI (⚠ Nilai diambil dari TEKS soal) ===');
  for (const c of result.corrections) console.log(`- ${c.field}: "${c.from}" → "${c.to}"`);
  console.log('\n=== CATATAN KARTU WAKTU (warnings) ===');
  for (const note of result.timeClarificationNotes) console.log(`- ${note}`);
  console.log('\n=== KARTU PILIHAN WAKTU ===');
  for (const card of result.timeClarifications) {
    console.log(`\n[${card.kind}] ${card.question.slice(0, 140)}…`);
    console.log(`  baseDate: ${card.baseDateLabel}`);
    for (const candidate of card.candidates) {
      console.log(`  • value="${candidate.value}" | dateLabel=${candidate.dateLabel ?? '-'} | ${candidate.label.slice(0, 90)}`);
    }
  }
  console.log('\n=== STATE KASUS ===');
  console.log('incident.lastContactTime:', JSON.stringify(result.case.incident.lastContactTime));
  console.log('search.datumTime:', JSON.stringify(result.case.search?.datumTime));
  console.log('incident.altitudeFt:', result.case.incident.altitudeFt, '| flightLevelFt:', result.case.incident.flightLevelFt);

  // Kasus harus tetap lolos validasi buildCaseExtractionResult (siap UI).
  const rebuilt = buildCaseExtractionResult(result.case, {}, { model: 'probe', attempts: 1 });
  console.log('\nbuildCaseExtractionResult ok:', rebuilt.ok, '| fieldRows:', rebuilt.ok ? rebuilt.fieldRows.length : rebuilt.detail?.slice(0, 3));
}

main().catch((err) => { console.error(err); process.exit(1); });
