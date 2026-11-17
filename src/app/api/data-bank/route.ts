import { NextRequest, NextResponse } from 'next/server';
import ZAI from 'z-ai-web-dev-sdk';
import { db } from '@/lib/db';
import {
  type DataBankField,
  CASE_FACT_MAP,
  buildExtractionPrompt,
  questionsToPending,
} from '@/lib/sar/dataBank';

export const maxDuration = 300;

const ANALYSIS_SYSTEM_PROMPT = `Kamu adalah analis kasus SAR Badan SAR Nasional. Tugasmu MENGANALISIS Soal Kasus dan mengubahnya menjadi Bank Data terstruktur (fakta per field dengan sumber).
Aturan mutlak dari Panduan Agent RENOPS/Briefing/De-Briefing:
- TIDAK BOLEH mengarang angka, koordinat, waktu, nama personel, frekuensi, atau cuaca. Setiap nilai WAJIB ada di teks soal.
- Salin nilai PERSIS dari sumber; pertahankan satuan, format TW (G/H/I), ejaan resmi lokasi, dan kata "diduga/diperkirakan/belum terkonfirmasi".
- Fakta yang tidak ada di teks TIDAK boleh diisi; masukkan ke daftar questions dengan pertanyaan spesifik berbahasa Indonesia.
- Balas HANYA dengan satu objek JSON valid tanpa markdown fence.`;

function extractJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** GET /api/data-bank — daftar bank data (terbaru dulu). */
export async function GET() {
  try {
    const banks = await db.caseDataBank.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, caseId: true, caseTitle: true, incidentType: true,
        rawText: true, fields: true, createdAt: true, updatedAt: true,
      },
    });
    return NextResponse.json({
      banks: banks.map((b) => ({
        ...b,
        fields: JSON.parse(b.fields) as DataBankField[],
        rawText: b.rawText.length > 400 ? `${b.rawText.slice(0, 400)}…` : b.rawText,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST /api/data-bank — analisis Soal Kasus dengan AI lalu simpan sebagai Bank Data. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rawText: string = String(body.rawText ?? '').trim();
    if (rawText.length < 20) {
      return NextResponse.json(
        { error: 'Teks Soal Kasus terlalu pendek. Tempelkan soal kasus lengkap terlebih dahulu.' },
        { status: 400 },
      );
    }
    const caseId: string | null = body.caseId ?? null;
    const bankId: string | null = body.bankId ?? null; // re-analisis bank yang sama

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: ANALYSIS_SYSTEM_PROMPT },
        { role: 'user', content: buildExtractionPrompt(rawText) },
      ],
      thinking: { type: 'disabled' },
    });
    const content = completion.choices[0]?.message?.content ?? '';
    const parsed = extractJsonObject(content);
    if (!parsed) {
      return NextResponse.json(
        { error: 'AI tidak mengembalikan JSON yang valid. Coba ulangi analisis.' },
        { status: 502 },
      );
    }

    const incidentType = parsed.incidentType === 'DISASTER' ? 'DISASTER' : 'ACCIDENT';
    const caseTitle = typeof parsed.caseTitle === 'string' && parsed.caseTitle.trim()
      ? parsed.caseTitle.trim() : null;

    const incoming = Array.isArray(parsed.fields) ? parsed.fields : [];
    const fields: DataBankField[] = [];
    for (const item of incoming) {
      const rec = item as { key?: unknown; label?: unknown; value?: unknown; unit?: unknown; sourceText?: unknown };
      const key = typeof rec.key === 'string' ? rec.key : '';
      const def = CASE_FACT_MAP[key];
      const value = typeof rec.value === 'string' || typeof rec.value === 'number'
        ? String(rec.value).trim() : '';
      if (!def || !value) continue; // kunci tidak dikenal / nilai kosong → buang
      fields.push({
        key,
        label: def.label,
        value,
        unit: typeof rec.unit === 'string' && rec.unit ? rec.unit : null,
        sourceType: 'case',
        sourceRef: typeof rec.sourceText === 'string' && rec.sourceText
          ? `Soal Kasus: "${rec.sourceText.slice(0, 160)}"` : 'Soal Kasus',
        status: 'READY',
        plannedActual: def.plannedActual,
        updatedAt: new Date().toISOString(),
      });
    }

    // Pertanyaan AI untuk fakta yang hilang → placeholder PENDING ber-kunci kanonik
    // sehingga jawaban pengguna langsung mengisi field (q_ bebas bila tak ada kunci cocok).
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    fields.push(...questionsToPending(questions as never[], fields));

    const data = {
      caseId,
      caseTitle,
      incidentType,
      rawText,
      fields: JSON.stringify(fields),
    };

    const saved = bankId
      ? await db.caseDataBank.update({ where: { id: bankId }, data })
      : await db.caseDataBank.create({ data });

    const ready = fields.filter((f) => f.status === 'READY').length;
    return NextResponse.json({
      bank: { ...saved, fields },
      summary: {
        total: fields.length,
        ready,
        questions: fields.filter((f) => f.status === 'PENDING').length,
      },
      incidentType,
    }, { status: bankId ? 200 : 201 });
  } catch (e) {
    console.error('Data bank analyze error:', (e as Error).message);
    return NextResponse.json(
      { error: `Analisis AI gagal: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
