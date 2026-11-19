/**
 * UJI AKTUAL GEMINI (bukan mock):
 * 1. Function calling dengan deklarasi tool bermiripan app (17 tool, index 15
 *    seperti set_lkp) — pembuktian fix `type: 'function'` (sebelumnya HTTP 400
 *    "The 'type' parameter is required at 'tools[15]'").
 * 2. Structured output response_format top-level + schema kecil.
 * 3. Ekstraksi PDF PK-TAL nyata via CASE_EXTRACTION_JSON_SCHEMA resmi.
 *
 * Jalankan: bun scripts/test-gemini-aktual.ts [pdf-path]
 */
import { readFileSync } from 'node:fs';
import { callGeminiInteraction, buildInteractionRequest, validateInteractionTools } from '../src/lib/ai/geminiClient';
import { CASE_EXTRACTION_JSON_SCHEMA, EXTRACTION_SYSTEM_INSTRUCTION, extractJsonCandidate, buildCaseExtractionResult } from '../src/lib/ai/parseCase';

function pass(name: string, detail?: string): void {
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name: string, detail: string): void {
  console.error(`FAIL  ${name} — ${detail}`);
  process.exitCode = 1;
}

/** 17 deklarasi mirip /api/chat (index 15 = tool ke-16, luka tools[15] lama). */
function makeToolsLikeApp(): Array<Record<string, unknown>> {
  const small = (name: string, extra?: Record<string, unknown>): Record<string, unknown> => ({
    name,
    description: `Tool uji ${name}.`,
    parameters: {
      type: 'OBJECT', // gaya lama UPPERCASE — builder harus normalisasi ke lowercase
      properties: {
        lat: { type: 'NUMBER', description: 'Latitude desimal' },
        lng: { type: 'NUMBER', description: 'Longitude desimal' },
        ...(extra ?? {}),
      },
      required: ['lat', 'lng'],
    },
    // TANPA type — builder wajib menambahkan type:'function' otomatis.
  });
  const names = [
    'set_asw_case', 'set_awa_case', 'set_aero_drift_case', 'set_intercept_case',
    'set_datum_case', 'ask_for_case_data', 'clarify_datum_time', 'clarify_incident_time',
    'save_case_data_bank', 'set_ws4_case', 'set_ws3_case', 'set_ws2_case',
    'set_search_pattern_case', 'set_ws8_case', 'set_asset_allocation_case',
    'set_lkp', // ← index 15
    'set_fields',
  ];
  return names.map((name) => small(name));
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    fail('env', 'GEMINI_API_KEY tidak ada di .env');
    return;
  }
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  console.log(`Model: ${model}; SDK @google/genai 3.6.1; apiVersion v1beta (geminiClient)\n`);

  // ── 0. Builder + validator (offline) ────────────────────────────────────────
  const tools = makeToolsLikeApp();
  const payload = buildInteractionRequest({
    model,
    input: [{ type: 'text', text: 'uji' }],
    tools: tools as Array<Record<string, unknown>>,
    timeoutMs: 1000,
  });
  const payloadTools = payload['tools'] as Array<Record<string, unknown>>;
  const tool15 = payloadTools[15];
  if (tool15['type'] === 'function') pass('builder: tools[15] membawa type:"function" (fix tools[15])');
  else fail('builder: tools[15] type', JSON.stringify(tool15).slice(0, 120));
  const normalizedType = (tool15['parameters'] as Record<string, unknown>)['type'];
  if (normalizedType === 'object') pass('builder: schema UPPERCASE dinormalisasi ke lowercase');
  else fail('builder: normalisasi schema', String(normalizedType));
  const issues = validateInteractionTools(payloadTools);
  if (issues.length === 0) pass('validator: 17 tool lolos validasi (nama/duplikat/description/schema)');
  else fail('validator', JSON.stringify(issues));
  // Validator menolak tool cacat:
  try {
    buildInteractionRequest({ model, input: 'x', tools: [{ name: 'bad name!', description: '', parameters: { type: 'object', properties: {} } }], timeoutMs: 10 });
    fail('validator: tool cacat', 'seharusnya melempar');
  } catch (err) {
    pass('validator: tool cacat ditolak dini', (err as Error).message.slice(0, 100));
  }

  // ── 1. Function calling AKTUAL dengan 17 tool ──────────────────────────────
  const fcResult = await callGeminiInteraction({
    model,
    input: [{ type: 'text', text: "Gunakan tool set_lkp untuk mengatur LKP pada koordinat latitude -6.879 dan longitude 105.261. Panggil tool-nya sekarang." }],
    systemInstruction: 'Kamu agen SAR. Selalu panggil tool yang diminta pengguna sebelum menjawab.',
    tools: tools,
    generationConfig: { max_output_tokens: 2048 },
    store: false,
    timeoutMs: 120_000,
  });
  if (!fcResult.ok) {
    fail('function calling aktual', `HTTP ${fcResult.status}: ${fcResult.errorMessage?.slice(0, 200)}`);
  } else {
    const fcCall = fcResult.steps.find((step) => step.type === 'function_call');
    if (fcCall && fcCall.name === 'set_lkp') {
      pass('function calling aktual', `model=${fcResult.model}, tool=${fcCall.name}, args=${JSON.stringify(fcCall.arguments).slice(0, 120)}`);
    } else {
      fail('function calling aktual', `tidak ada function_call set_lkp; steps=${fcResult.steps.map((s) => s.type).join(',')}`);
    }
  }

  // ── 2. Structured output (response_format top-level) AKTUAL ────────────────
  const soResult = await callGeminiInteraction({
    model,
    input: [{ type: 'text', text: 'Kasus: pesawat ditching di 06°52\'S 105°15\'E pada 13.50 WIB. Keluarkan JSON sesuai skema (isi incident.type=aircraft-ditching, lkp.coord, incident.lastContactTime).' }],
    systemInstruction: 'Keluarkan HANYA JSON sesuai skema.',
    responseFormat: { type: 'text', mime_type: 'application/json', schema: CASE_EXTRACTION_JSON_SCHEMA },
    generationConfig: { temperature: 0.1, max_output_tokens: 2048 },
    store: false,
    timeoutMs: 120_000,
  });
  if (!soResult.ok) {
    fail('structured output aktual', `HTTP ${soResult.status}: ${soResult.errorMessage?.slice(0, 200)}`);
  } else {
    const cand = extractJsonCandidate(soResult.text);
    if (cand.ok && cand.data && typeof cand.data === 'object' && 'incident' in (cand.data as Record<string, unknown>)) {
      pass('structured output aktual', `incident.type=${(cand.data as Record<string, unknown>)['incident'] ? JSON.parse(JSON.stringify((cand.data as Record<string, unknown>)['incident']))['type'] : '?'}`);
    } else {
      fail('structured output aktual', `JSON tidak sesuai: ${soResult.text.slice(0, 160)}`);
    }
  }

  // ── 3. Ekstraksi PDF PK-TAL AKTUAL (golden fixture) ─────────────────────────
  const pdfPath = process.argv[2] ?? '../upload/Pusat Final Test XL 2026 _1711_1200_rev kapten psw.pdf';
  try {
    const base64 = readFileSync(pdfPath, 'base64');
    console.log(`\nPDF: ${pdfPath} (${Math.round(base64.length * 3 / 4 / 1024)} KB)`);
    const pdfResult = await callGeminiInteraction({
      model,
      input: [{ type: 'document', data: base64, mime_type: 'application/pdf' }],
      systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
      responseFormat: { type: 'text', mime_type: 'application/json', schema: CASE_EXTRACTION_JSON_SCHEMA },
      generationConfig: { temperature: 0.1, max_output_tokens: 32768 },
      store: false,
      timeoutMs: 240_000,
    });
    if (!pdfResult.ok) {
      fail('ekstraksi PDF PK-TAL', `HTTP ${pdfResult.status}: ${pdfResult.errorMessage?.slice(0, 200)}`);
    } else {
      const cand = extractJsonCandidate(pdfResult.text);
      if (!cand.ok) {
        fail('ekstraksi PDF PK-TAL (JSON)', cand.error ?? '?');
      } else {
        const extraction = buildCaseExtractionResult(cand.data, {}, { model, attempts: 1 });
        if (!extraction.ok) {
          fail('ekstraksi PDF PK-TAL (validasi Zod)', (extraction.detail ?? [extraction.error]).slice(0, 4).join(' | ').slice(0, 400));
        } else {
          const c = extraction.case!;
          const ad = c.aeroDrift;
          const windLayers = ad?.windLayers?.length ?? 0;
          const surface = c.sea?.surfaceWindSeries?.length ?? 0;
          const sruCount = c.sru?.length ?? 0;
          console.log(`  glideRatio=${ad?.glideRatio} glideSpeed=${ad?.glideSpeedKts} variation=${ad?.variationDeg}°${ad?.variationDirection} windLayers=${windLayers} surfaceWind=${surface} arus=${c.sea?.current?.dirToDeg}/${c.sea?.current?.speedKts} sru=${sruCount}`);
          if (ad?.glideRatio === 6) pass('PK-TAL: glideRatio=6 (dari "Glide Ratio: 6:1")'); else fail('PK-TAL glideRatio', String(ad?.glideRatio));
          if (ad?.glideSpeedKts === 121) pass('PK-TAL: glideSpeed=121 kts'); else fail('PK-TAL glideSpeed', String(ad?.glideSpeedKts));
          if (ad?.variationDeg === 1 && ad?.variationDirection === 'E') pass('PK-TAL: variation 1°E'); else fail('PK-TAL variation', `${ad?.variationDeg}${ad?.variationDirection}`);
          if (windLayers === 7) pass('PK-TAL: 7 lapisan angin'); else fail('PK-TAL windLayers', String(windLayers));
          if (surface === 6) pass('PK-TAL: 6 pengamatan angin permukaan'); else fail('PK-TAL surfaceWind', String(surface));
          if (c.sea?.current?.dirToDeg === 250 && c.sea?.current?.speedKts === 0.3) pass('PK-TAL: arus 250°/0.3 kt'); else fail('PK-TAL arus', `${c.sea?.current?.dirToDeg}/${c.sea?.current?.speedKts}`);
          if (sruCount >= 3) pass(`PK-TAL: ${sruCount} SRU terekstrak`); else fail('PK-TAL sru', String(sruCount));
          const callsigns = (c.sru ?? []).map((s) => s.callsign).join(', ');
          console.log(`  SRU: ${callsigns}`);
        }
      }
    }
  } catch (err) {
    fail('ekstraksi PDF PK-TAL', err instanceof Error ? err.message : String(err));
  }
}

await main();
