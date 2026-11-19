/**
 * PROBE minimal — panggilan Interactions API text-only (tanpa document part)
 * untuk memisahkan error lokasi dari error struktur input.
 * Jalankan: bun run scripts/probe_minimal.ts
 */

import { GoogleGenAI } from '@google/genai';
import { getGeminiApiKey } from '../src/lib/ai/config';

const apiKey = getGeminiApiKey();
if (!apiKey) {
  console.log('GEMINI_API_KEY tidak ada.');
  process.exit(1);
}
const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: 'v1beta' } });
try {
  const interaction = await client.interactions.create({
    model: 'gemini-3.8-flash',
    input: [{ type: 'text', text: 'Balas dengan kata: ok' }],
    generation_config: { temperature: 0.1, max_output_tokens: 32 },
    store: false,
  });
  const record = interaction as unknown as Record<string, unknown>;
  console.log('OK — output_text:', String(record['output_text'] ?? '').slice(0, 60));
} catch (error) {
  const err = error as { status?: number; message?: string };
  console.log(`GAGAL status=${err.status ?? 0}: ${err.message?.slice(0, 200)}`);
}
