import {
  GoogleGenerativeAI,
  type FunctionDeclaration,
  type Part,
  type EnhancedGenerateContentResponse,
  SchemaType,
} from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';
import { processUploadedFile } from '@/lib/sar/fileExtractor';

const SYSTEM_PROMPT = `Kamu adalah Asisten SAR Planner AI untuk Badan SAR Nasional (Basarnas) Indonesia.
Kamu membantu dalam perhitungan dan analisis operasi SAR berdasarkan IAMSAR Manual Volume II (2016) dan Peraturan No. 3 Tahun 2020.

KEMAMPUANMU:
1. Menganalisis file lampiran (PDF soal/skenario, dokumen Word/Office, spreadsheet Excel data angin, presentasi PowerPoint modul SAR, atau foto/gambar soal kasus/peta/papan manuver).
2. Menjawab pertanyaan terkait SAR Planning (ASW, AWA, Datum, Search Area, Intercept, dll).
3. Membuat contoh kasus SAR lengkap dengan data angin, koordinat, dan parameter operasi.
4. Mengisi worksheet secara otomatis melalui function calling.
5. Menjelaskan langkah-langkah perhitungan matematis dan vektor secara jelas.

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

const CANDIDATE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.8-pro',
];

export async function POST(req: NextRequest) {
  try {
    const { messages, apiKey, files } = await req.json();

    if (!apiKey) {
      return NextResponse.json(
        { error: 'API Key Gemini diperlukan. Masukkan di pengaturan chat.' },
        { status: 400 }
      );
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Build chat history
    const history = messages.slice(0, -1).map((msg: { role: string; content: string }) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content || ' ' }],
    }));

    // Build parts for the latest message (including files: PDF, images, Office text)
    const lastMessage = messages[messages.length - 1];
    const incomingFiles: { name: string; type: string; base64: string }[] =
      files || lastMessage.files || [];

    const messageParts: Part[] = [];

    for (const file of incomingFiles) {
      try {
        const processed = await processUploadedFile(file);
        if (processed.type === 'inlineData' && processed.inlineData) {
          messageParts.push({
            inlineData: processed.inlineData,
          });
        } else if (processed.text) {
          messageParts.push({
            text: processed.text,
          });
        }
      } catch (fErr) {
        console.warn(`Error processing file ${file.name}:`, fErr);
      }
    }

    const userPrompt = lastMessage.content?.trim()
      ? lastMessage.content
      : incomingFiles.length > 0
      ? 'Tolong telaah dan analisis dokumen/gambar yang dilampirkan untuk kasus perhitungan SAR.'
      : 'Halo';

    messageParts.push({ text: userPrompt });

    // Try candidate models with automatic fallback
    let lastError: Error | null = null;
    let response: EnhancedGenerateContentResponse | null = null;

    for (const modelName of CANDIDATE_MODELS) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: tools }],
        });

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(messageParts);
        response = result.response;
        if (response) break;
      } catch (err: unknown) {
        const errObj = err instanceof Error ? err : new Error(String(err));
        lastError = errObj;
        console.warn(`Model ${modelName} gagal: ${errObj.message}. Mencoba model berikutnya...`);
        // If temporary 503 spike, wait 1.5s and retry
        if (errObj.message.includes('503')) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const retryChat = genAI.getGenerativeModel({
              model: modelName,
              systemInstruction: SYSTEM_PROMPT,
              tools: [{ functionDeclarations: tools }],
            }).startChat({ history });
            const retryResult = await retryChat.sendMessage(messageParts);
            response = retryResult.response;
            if (response) break;
          } catch {
            // continue
          }
        }
        // If invalid key or other fatal client error, throw directly
        if (errObj.message.includes('API_KEY_INVALID') || errObj.message.includes('401')) {
          throw errObj;
        }
      }
    }

    if (!response) {
      throw lastError || new Error('Gagal menghubungi model Gemini.');
    }

    // Check for function calls
    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      const calls = functionCalls.map((fc) => ({
        name: fc.name,
        args: fc.args,
      }));

      // Get text response too if available
      const textParts = response.candidates?.[0]?.content?.parts?.filter((p) => 'text' in p) || [];
      const text = textParts.map((p) => ('text' in p ? p.text : '')).join('');

      return NextResponse.json({
        text: text || 'Data telah disiapkan. Klik "Terapkan" untuk mengisi worksheet.',
        functionCalls: calls,
      });
    }

    return NextResponse.json({
      text: response.text(),
      functionCalls: null,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Chat API error:', message);
    return NextResponse.json({ error: `Gagal menghubungi Gemini: ${message}` }, { status: 500 });
  }
}
