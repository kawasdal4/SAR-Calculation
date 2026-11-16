import { type FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { processUploadedFile } from '@/lib/sar/fileExtractor';

const SYSTEM_PROMPT = `Kamu adalah Asisten SAR Planner AI untuk Badan SAR Nasional (Basarnas) Indonesia.
Kamu membantu dalam perhitungan dan analisis operasi SAR berdasarkan panduan operasi SAR dan Peraturan No. 3 Tahun 2020.

KEMAMPUANMU:
1. Menganalisis file lampiran (PDF soal/skenario, dokumen Word/Office, spreadsheet Excel data angin, presentasi PowerPoint modul SAR, atau foto/gambar soal kasus/peta/papan manuver).
2. Menjawab pertanyaan terkait SAR Planning (ASW, AWA, Datum, Search Area, Intercept, dll).
3. Membuat contoh kasus SAR lengkap dengan data angin, koordinat, dan parameter operasi.
4. Mengisi worksheet secara otomatis melalui function calling.
5. Menjelaskan langkah-langkah perhitungan matematis dan vektor secara jelas.

ATURAN KASUS INTERCEPT:
- Jika soal meminta perhitungan/intercept atau medevac dan memuat posisi, kecepatan, serta haluan target/SRU, WAJIB panggil set_intercept_case dengan data yang ditemukan.
- Koordinat harus berupa derajat desimal; lintang selatan dan bujur barat bernilai negatif.
- Pilih beam-on untuk SRU yang berangkat dari pangkalan menuju target yang bergerak pada haluan tertentu. Head-on hanya untuk gerak saling mendekat di baseline; overtaking hanya untuk lintasan searah.
- Jangan memilih expanding square sebagai metode intercept. Jangan menghitung atau mengarang hasil waktu, jarak, bearing, ETA, atau koordinat intercept di jawaban. Aplikasi akan menghitungnya dan menggambar vektor/peta.
- Jika tanggal tidak tersedia, jangan mengarang tanggal; waktu intercept dan koordinat tetap dapat dihitung, sedangkan ETA ditampilkan bila waktu referensi tersedia.

JIKA PENGGUNA MELAMPIRKAN FILE/GAMBAR:
- Bacalah isi dokumen atau amati gambar dengan teliti.
- Ekstrak data operasional: Distress Time, Datum Time, Data Angin BMKG (waktu, arah °T, kecepatan kts), ketinggian, LKP, jenis musibah.
- Gunakan function calling (set_asw_case / set_awa_case / set_lkp) untuk mengisi worksheet secara langsung.
- Berikan ringkasan analisis dan hasil kalkulasi kepada pengguna.

FORMAT WAKTU BASARNAS: [Bulan][Tanggal] [Jam][Menit] [Zona Waktu]
Contoh: "1122 1600 Z" = 22 November pukul 16:00 UTC

WORKSHEET YANG TERSEDIA:
- ASW (Average Surface Wind): Menghitung rata-rata angin permukaan. Observasi per 3 atau 6 jam dari BMKG.
- AWA (Average Wind Aloft): Menghitung rata-rata angin atas untuk kasus penerbangan.
- ADW (Aeronautical Drift Worksheet): Menghitung drift pesawat udara.
- WS 1 (Datum Worksheet): Menghitung posisi datum dan search area.
- WS 2 (Maritime Search Planning): Perencanaan pencarian maritim.
- WS 8 (Search Facility): Data fasilitas pencarian.
- Intercept Calculator: Kalkulasi intersep (Head-On, Overtaking, Beam-On).

ATURAN OBSERVASI ASW:
Per 6 Jam: 00.00 (21–03), 06.00 (03–09), 12.00 (09–15), 18.00 (15–21)
Per 3 Jam: 00.00 (22.30–01.30), 03.00 (01.30–04.30), 06.00 (04.30–07.30), 09.00 (07.30–10.30), 12.00 (10.30–13.30), 15.00 (13.30–16.30), 18.00 (16.30–19.30), 21.00 (19.30–22.30)

Distress Time = awal interval pertama, Datum Time = akhir interval terakhir.

Jawab selalu dalam Bahasa Indonesia yang profesional dan lugas.`;

const tools: FunctionDeclaration[] = [
  {
    name: 'set_asw_case',
    description: 'Mengisi worksheet ASW dengan data kasus lengkap termasuk distress time, datum time, mode interval, dan data angin per observasi. Gunakan ini saat user meminta membuat kasus ASW atau mengisi data angin.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        distressTime: {
          type: SchemaType.STRING,
          description: 'Waktu distress dalam format Basarnas, contoh: "1122.1600 Z"',
        },
        datumTime: {
          type: SchemaType.STRING,
          description: 'Waktu datum dalam format Basarnas, contoh: "1123.0700 Z"',
        },
        intervalMode: {
          type: SchemaType.STRING,
          description: 'Mode interval observasi: "6h" atau "3h"',
        },
        windData: {
          type: SchemaType.ARRAY,
          description: 'Data angin per observasi, urut dari observasi pertama',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              windDirFrom: {
                type: SchemaType.NUMBER,
                description: 'Arah angin dari (derajat True, 0-359)',
              },
              windSpeed: {
                type: SchemaType.NUMBER,
                description: 'Kecepatan angin (knots)',
              },
            },
            required: ['windDirFrom', 'windSpeed'],
          },
        },
        caseTitle: {
          type: SchemaType.STRING,
          description: 'Judul kasus, contoh: "SAR KM Baruna Jaya"',
        },
      },
      required: ['distressTime', 'datumTime', 'intervalMode', 'windData'],
    },
  },
  {
    name: 'set_awa_case',
    description: 'Mengisi worksheet AWA dengan data level pengamatan angin. Sertakan level 0 ft dan minimal satu level pada atau di atas target; interval lapisan dihitung otomatis dari midpoint.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        distressAltFt: {
          type: SchemaType.NUMBER,
          description: 'Ketinggian distress dalam feet',
        },
        windData: {
          type: SchemaType.ARRAY,
          description: 'Data angin per ketinggian observasi',
          items: {
            type: SchemaType.OBJECT,
            properties: {
              altObs: {
                type: SchemaType.STRING,
                description: 'Altitude observasi dalam feet, contoh: "0" untuk Surface atau "3000"',
              },
              windDirFrom: {
                type: SchemaType.NUMBER,
                description: 'Arah angin dari (derajat True)',
              },
              windSpeed: {
                type: SchemaType.NUMBER,
                description: 'Kecepatan angin (knots)',
              },
            },
            required: ['altObs', 'windDirFrom', 'windSpeed'],
          },
        },
        caseTitle: {
          type: SchemaType.STRING,
          description: 'Judul kasus penerbangan',
        },
      },
      required: ['distressAltFt', 'windData'],
    },
  },
  {
    name: 'set_intercept_case',
    description: 'Mengekstrak data kasus Intercept dari soal lalu mengisi worksheet Intercept agar aplikasi menghitung hasil dan menggambar vektor/peta. WAJIB gunakan untuk soal perhitungan Intercept lengkap. Koordinat desimal; selatan/barat negatif. Jika tanggal referensi tidak disebutkan, hilangkan referenceTime.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        type: {
          type: SchemaType.STRING,
          description: 'Metode worksheet: beam-on untuk target bergerak pada haluan tertentu dan SRU berangkat dari pangkalan; head-on untuk saling mendekat pada baseline; overtaking untuk mengejar pada lintasan searah.',
        },
        referenceTime: {
          type: SchemaType.STRING,
          description: 'Tanggal/waktu lokal format YYYY-MM-DDTHH:mm hanya jika tanggal dan waktu tersedia dari soal. Jangan mengarang tanggal.',
        },
        target: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: 'Nama kapal/target.' },
            pos: {
              type: SchemaType.OBJECT,
              properties: {
                lat: { type: SchemaType.NUMBER, description: 'Lintang target dalam derajat desimal; selatan negatif.' },
                lng: { type: SchemaType.NUMBER, description: 'Bujur target dalam derajat desimal; barat negatif.' },
              },
              required: ['lat', 'lng'],
            },
            speedKts: { type: SchemaType.NUMBER, description: 'Kecepatan target dalam knot.' },
            courseDeg: { type: SchemaType.NUMBER, description: 'Haluan target derajat True, 0 sampai kurang dari 360.' },
          },
          required: ['name', 'pos', 'speedKts', 'courseDeg'],
        },
        sru: {
          type: SchemaType.OBJECT,
          properties: {
            name: { type: SchemaType.STRING, description: 'Nama/unit SRU.' },
            pos: {
              type: SchemaType.OBJECT,
              properties: {
                lat: { type: SchemaType.NUMBER, description: 'Lintang posisi SRU/pangkalan dalam derajat desimal; selatan negatif.' },
                lng: { type: SchemaType.NUMBER, description: 'Bujur posisi SRU/pangkalan dalam derajat desimal; barat negatif.' },
              },
              required: ['lat', 'lng'],
            },
            speedKts: { type: SchemaType.NUMBER, description: 'Kecepatan SRU dalam knot.' },
          },
          required: ['name', 'pos', 'speedKts'],
        },
      },
      required: ['type', 'target', 'sru'],
    },
  },
  {
    name: 'set_lkp',
    description: 'Mengatur posisi LKP (Last Known Position) untuk operasi SAR.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        lat: {
          type: SchemaType.NUMBER,
          description: 'Latitude dalam desimal (negatif untuk selatan)',
        },
        lng: {
          type: SchemaType.NUMBER,
          description: 'Longitude dalam desimal',
        },
      },
      required: ['lat', 'lng'],
    },
  },
];

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'] as const;
const MAX_RETRIES_PER_MODEL = 1;
const GEMINI_REQUEST_TIMEOUT_MS = 45_000;

// This Vercel project supports 300-second functions; complex SAR case analysis
// and document understanding can exceed the shorter 60-second default.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { messages, apiKey, files } = await req.json();

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key Gemini diperlukan. Masukkan di pengaturan chat.' },
        { status: 400 }
      );
    }

    // Interactions API accepts multimodal content directly and is the supported
    // API for current Gemini models.
    const lastMessage = messages[messages.length - 1];
    const incomingFiles: { name: string; type: string; base64: string }[] =
      files || lastMessage.files || [];

    const input: Array<Record<string, string>> = [];

    for (const file of incomingFiles) {
      try {
        const processed = await processUploadedFile(file);
        if (processed.type === 'inlineData' && processed.inlineData) {
          const mimeType = processed.inlineData.mimeType;
          input.push({
            type: mimeType === 'application/pdf' ? 'document' : 'image',
            data: processed.inlineData.data,
            mime_type: mimeType,
          });
        } else if (processed.text) {
          input.push({ type: 'text', text: `Isi lampiran ${file.name}:\n${processed.text}` });
        }
      } catch (fErr) {
        console.warn(`Error processing file ${file.name}:`, fErr);
      }
    }

    const userPrompt = lastMessage.content?.trim() || (incomingFiles.length > 0
      ? 'Tolong telaah dan analisis dokumen/gambar yang dilampirkan untuk kasus perhitungan SAR.'
      : 'Halo');
    // Keep the context useful without resending a long chat history (which can
    // make the model call slow, especially after repeated failed attempts).
    const conversation = messages.slice(-13, -1)
      .filter((msg: { role: string; content: string }) =>
        !(msg.role !== 'user' && msg.content?.startsWith('❌ Error:'))
      )
      .map((msg: { role: string; content: string }) =>
        `${msg.role === 'user' ? 'Pengguna' : 'Asisten'}: ${(msg.content || '').slice(0, 6000)}`
      )
      .join('\n');
    const extractedFileText = input
      .filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .join('\n');
    input.unshift({
      type: 'text',
      text: `${conversation ? `Riwayat percakapan:\n${conversation}\n\n` : ''}${userPrompt}`,
    });

    const interceptSourceText = `${userPrompt}\n${extractedFileText}`;
    const speedMentions = [...interceptSourceText.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:knots?|kts?|kt)\b/gi)];
    const interceptCaseDetected = /\b(intercept|intersep|pintasan|medevac)\b/i.test(interceptSourceText)
      && speedMentions.length >= 2;

    // Interactions API uses lowercase JSON Schema types for function tools.
    const normalizeSchema = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalizeSchema);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        key === 'type' && typeof child === 'string' ? child.toLowerCase() : normalizeSchema(child),
      ]));
    };
    const geminiStartedAt = Date.now();
    let result: Record<string, unknown> | undefined;
    let lastError: Error | undefined;
    let usedModel: (typeof GEMINI_MODELS)[number] = GEMINI_MODELS[0];
    for (const model of GEMINI_MODELS) {
      for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
        console.info(`[AI chat] Gemini request started (model=${model}, attempt=${attempt + 1}, files=${incomingFiles.length}).`);
        try {
          const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
            signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              model,
              input,
              system_instruction: SYSTEM_PROMPT,
              generation_config: {
                max_output_tokens: 8192,
                thinking_level: model === 'gemini-3.5-flash-lite' ? 'minimal' : 'low',
                ...(interceptCaseDetected ? {
                  tool_choice: {
                    allowed_tools: { mode: 'any', tools: ['set_intercept_case'] },
                  },
                } : {}),
              },
              tools: tools.map((tool) => ({
                type: 'function',
                name: tool.name,
                description: tool.description,
                parameters: normalizeSchema(tool.parameters),
              })),
              store: false,
            }),
          });
          console.info(`[AI chat] Gemini response received (model=${model}, status=${response.status}, durationMs=${Date.now() - geminiStartedAt}).`);
          const payload = await response.json().catch(() => ({}));
          if (response.ok) {
            result = payload as Record<string, unknown>;
            usedModel = model;
            break;
          }

          const detail = (payload as { error?: { message?: string } })?.error?.message || `Gemini API returned HTTP ${response.status}`;
          lastError = new Error(`${detail} (model: ${model}, Interactions API)`);
          const transient = response.status === 429 || response.status >= 500;
          if (!transient) throw lastError;
        } catch (requestError) {
          if (requestError instanceof Error && requestError.message.includes('(model:')) throw requestError;
          if (requestError instanceof Error && (requestError.name === 'TimeoutError' || requestError.name === 'AbortError')) {
            lastError = new Error(`Gemini ${model} tidak merespons dalam ${GEMINI_REQUEST_TIMEOUT_MS / 1000} detik.`);
            console.warn(`[AI chat] Gemini request timed out (model=${model}, timeoutMs=${GEMINI_REQUEST_TIMEOUT_MS}).`);
            break;
          }
          lastError = requestError instanceof Error ? requestError : new Error('Koneksi ke Gemini gagal.');
        }

        if (attempt < MAX_RETRIES_PER_MODEL) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** attempt)));
        }
      }
      if (result) break;
      console.warn(`[AI chat] Model ${model} gagal; mencoba fallback berikutnya jika tersedia.`);
    }
    if (!result) {
      throw new Error(lastError?.message || 'Gemini sedang sibuk. Silakan coba lagi beberapa saat lagi.');
    }

    if (!Array.isArray(result.steps)) {
      throw new Error('Format respons Gemini tidak berisi langkah jawaban yang dapat diproses.');
    }

    const steps = Array.isArray(result.steps) ? result.steps as Array<{ type?: string; name?: string; arguments?: unknown; content?: Array<{ type?: string; text?: string }> }> : [];
    const functionCalls = steps.filter((step): step is typeof step & { name: string } =>
      step.type === 'function_call' && typeof step.name === 'string'
    );
    if (functionCalls.length > 0) {
      const calls = functionCalls.map((fc: { name: string; arguments?: unknown }) => ({
        name: fc.name,
        args: fc.arguments || {},
      }));
      const text = steps
        .filter((step: { type?: string }) => step.type === 'model_output')
        .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
        .filter((part: { type?: string }) => part.type === 'text')
        .map((part: { text?: string }) => part.text || '')
        .join('');

      const interceptCall = calls.find((call) => call.name === 'set_intercept_case');
      if (interceptCaseDetected && !interceptCall) {
        return NextResponse.json({
          text: 'Soal Intercept terdeteksi, tetapi datanya belum berhasil dipetakan ke worksheet. Hasil angka tidak ditampilkan agar tidak mengarang perhitungan. Periksa kelengkapan posisi, haluan, dan kecepatan target serta SRU, lalu kirim ulang.',
          functionCalls: null,
        });
      }
      const responseText = interceptCall
        ? 'Data kasus Intercept berhasil dianalisis. Saya memasukkan data ke worksheet Intercept; hasil hitung dan vektornya akan dibuat oleh kalkulator aplikasi.'
        : text || 'Data telah disiapkan. Klik "Terapkan" untuk mengisi worksheet.';
      return NextResponse.json({
        text: `${usedModel !== GEMINI_MODELS[0] ? 'Model utama sedang sibuk; jawaban diproses dengan model cadangan.\n\n' : ''}${responseText}`,
        functionCalls: calls,
      });
    }

    if (interceptCaseDetected) {
      return NextResponse.json({
        text: 'Soal Intercept terdeteksi, tetapi data tidak berhasil dipetakan ke worksheet. Hasil angka tidak ditampilkan agar tidak mengarang perhitungan. Periksa kelengkapan posisi, haluan, dan kecepatan target serta SRU, lalu kirim ulang.',
        functionCalls: null,
      });
    }

    const responseText = steps
      .filter((step: { type?: string }) => step.type === 'model_output')
      .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
      .filter((part: { type?: string }) => part.type === 'text')
      .map((part: { text?: string }) => part.text || '')
      .join('');
    return NextResponse.json({
      text: `${usedModel !== GEMINI_MODELS[0] ? 'Model utama sedang sibuk; jawaban diproses dengan model cadangan.\n\n' : ''}${responseText || 'Model Gemini tidak mengembalikan teks jawaban.'}`,
      functionCalls: null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Chat API error:', message);
    return NextResponse.json({ error: `Gagal menghubungi Gemini: ${message}` }, { status: 500 });
  }
}

