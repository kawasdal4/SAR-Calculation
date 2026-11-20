/**
 * PROBE: enrichment Fase C2 terhadap teks PDF asli soal Final Test XL 2026.
 * 1. Ekstrak teks PDF via unpdf (jalur yang sama dengan route parse-case).
 * 2. extractCaseFacts + enrichCaseFromSourceText di atas kasus "model meleset".
 * 3. Lapangkan completeness + applyPlan — bukti tombol Terapkan terbuka.
 * Jalankan: bun scripts/probe_enrich_real_pdf.ts
 */

import { readFileSync } from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';
import { extractCaseFacts, enrichCaseFromSourceText } from '../src/lib/ai/caseTextEnrich';
import { buildCaseExtractionResult, buildApplyPlan } from '../src/lib/ai/parseCase';
import { sarCaseSchema, type SarCaseSchema } from '../src/lib/sar/caseSchema';

const PDF_PATH = 'upload/Pusat Final Test XL 2026 _1711_1200_rev kapten psw.pdf';

async function main(): Promise<void> {
  const buffer = readFileSync(PDF_PATH);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const pdfText = Array.isArray(text) ? text.join('\n') : text;
  console.log('=== TEKS PDF (potongan) ===');
  console.log(pdfText.slice(0, 400).replace(/\n+/g, ' | '));
  console.log(`(panjang total: ${pdfText.length} chars)\n`);

  const facts = extractCaseFacts(pdfText);
  console.log('=== FAKTA DETERMINISTIK DARI PDF ASLI ===');
  console.log('glideSpeedKts      :', facts.glideSpeedKts?.value);
  console.log('glideRatio         :', facts.glideRatio?.value);
  console.log('variation          :', facts.variationDeg?.value);
  console.log('heading            :', facts.headingDeg?.value);
  console.log('flightLevelFt      :', facts.flightLevelFt?.value);
  console.log('lkp.coord lat/lng  :', facts.lkpCoord?.value.lat, facts.lkpCoord?.value.lng);
  console.log('windLayers rows    :', facts.windLayers?.value.length, facts.windLayers?.value[0], '...', facts.windLayers?.value.at(-1));
  console.log('surfaceWindSeries  :', facts.surfaceWindSeries?.value.length, facts.surfaceWindSeries?.value[0]?.obsTime, '...', facts.surfaceWindSeries?.value.at(-1)?.obsTime);
  console.log('current            :', facts.current?.value);
  console.log('datumTime          :', facts.datumTime?.value);
  console.log('sru                :', (facts.sruCandidates?.value ?? []).map((s) => `${s['callsign']}(${s['kind']})`).join(', '));
  console.log('sru[0]             :', JSON.stringify(facts.sruCandidates?.value[0]));
  console.log('sru[2]             :', JSON.stringify(facts.sruCandidates?.value[2]));
  console.log();

  // Kasus = hasil model yang MELESET (persis seperti run pengguna).
  const failedModelCase: SarCaseSchema = sarCaseSchema.parse({
    schemaVersion: 1,
    caseTitle: 'PK-TAL ditching',
    incident: { type: 'aircraft-ditching', callsign: 'PK-TAL', craftType: 'Cessna 208 Caravan', lastContactTime: '18 November 2026 13.50 WIB', reportTime: '18 November 2026 14.10 WIB' },
    meta: { source: 'pdf' },
  });
  const { case: enriched, filled } = enrichCaseFromSourceText(failedModelCase, pdfText);
  console.log('=== FIELD TERISI PASS DETERMINISTIK ===');
  for (const entry of filled) console.log(` - ${entry.field} = ${entry.value}`);

  const result = buildCaseExtractionResult(enriched, {});
  if (!result.ok) {
    console.log('GAGAL VALIDASI:', result.detail);
    process.exit(1);
  }
  const completeness = result.completeness;
  console.log('\n=== COMPLETENESS SETELAH ENRICH ===');
  console.log(`complete=${completeness.complete} missing=${completeness.missingCount} assumed=${completeness.assumedCount}`);
  for (const issue of completeness.issues) console.log(` [${issue.status}] ${issue.field} — ${issue.reason}`);

  const plan = buildApplyPlan(result.case, {});
  console.log('\n=== APPLY PLAN (tombol Terapkan) ===');
  console.log('LANGKAH:', plan.steps.map((step) => `${step.id} [${step.worksheet}]`).join('  →  '));
  console.log('SKIPPED:');
  for (const entry of plan.skipped) console.log(` - [${entry.worksheet}] ${entry.reason}`);
}

main().catch((err) => {
  console.error('PROBE GAGAL:', err);
  process.exit(1);
});
