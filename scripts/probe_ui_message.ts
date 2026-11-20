/**
 * Probe UI: bangun payload pesan chat sintetis (kasus SRX48 hasil "ekstraksi"
 * dengan kartu pilihan waktu) untuk diinjeksikan ke localStorage browser —
 * verifikasi interaktif handleExtractionTimeChoice di panel AI.
 * Output: /tmp/ui-message.json (array 2 pesan: user + assistant).
 */
import { sarCaseSchema } from '../src/lib/sar/caseSchema';
import { buildCaseExtractionResult } from '../src/lib/ai/parseCase';
import { enrichCaseFromSourceText } from '../src/lib/ai/caseTextEnrich';
import { extractPdfTextFromBase64 } from '../src/lib/ai/pdfText';

async function main() {
  const fs = await import('node:fs');
  const pdfBase64 = fs.readFileSync('/home/z/my-project/upload/FULL EXERCISE.pdf').toString('base64');
  const soalText = await extractPdfTextFromBase64(pdfBase64);

  const modelCase = sarCaseSchema.parse({
    schemaVersion: 1,
    incident: { type: 'aircraft-ditching', callsign: 'SRX48', lastContactTime: '03/12/2024 10.50 WIT', altitudeFt: 18000 },
    meta: { source: 'pdf' },
  });
  const enriched = enrichCaseFromSourceText(modelCase, soalText);
  const rebuilt = buildCaseExtractionResult(enriched.case, {}, { model: 'probe-ui', attempts: 1 });
  if (!rebuilt.ok) throw new Error(JSON.stringify(rebuilt.detail));

  const assistantMsg = {
    role: 'assistant',
    content: '📋 Ekstraksi soal kasus selesai (model probe-ui, 1 percobaan). Tinjau data per field di bawah.\n\n⏰ Tanggal/waktu soal punya beberapa kandidat (termasuk kemungkinan terbalik bulan/tanggal) — AI TIDAK memilih sendiri: pilih tanggal & waktu yang benar di kartu Klarifikasi Waktu di bawah sebelum menerapkan.',
    caseExtraction: {
      caseTitle: rebuilt.case.caseTitle,
      incidentType: rebuilt.case.incident.type,
      fieldRows: rebuilt.fieldRows,
      applyPlan: rebuilt.applyPlan,
      completeness: rebuilt.completeness,
      assumptions: rebuilt.assumptions,
      warnings: [...enriched.timeClarificationNotes],
      rawCase: enriched.case,
    },
    timeClarifications: enriched.timeClarifications,
    extractionAppliedStepIds: [],
    extractionAppliedAll: false,
    extractionMode: 'full',
    extractionApprovedMissing: [],
    extractionFieldErrors: {},
  };
  const messages = [
    { role: 'user', content: 'FULL EXERCISE SRX48 (probe UI)' },
    assistantMsg,
  ];
  fs.writeFileSync('/tmp/ui-message.json', JSON.stringify(messages));
  console.log('written /tmp/ui-message.json —', JSON.stringify(messages).length, 'bytes;',
    'cards:', enriched.timeClarifications.map((c) => c.kind).join('+'));
}

main().catch((err) => { console.error(err); process.exit(1); });
