import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  type DataBankField,
  type DocumentSnapshot,
  type DocType,
  buildDocument,
  pickRenopsType,
} from '@/lib/sar/dataBank';

/** POST /api/documents/generate — susun draft dokumen resmi dari worksheet/peta + Bank Data.
 *
 * Rantai resolusi sumber (Panduan Agent §6-8):
 *   hasil worksheet → geometri peta → Bank Data (soal kasus/input manual) → PENDING + pertanyaan.
 * Deterministik: angka TIDAK dihitung oleh LLM; LLM hanya dipakai saat analisis Soal Kasus.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const snapshot = (body.snapshot ?? null) as DocumentSnapshot | null;
    const bankId: string | null = body.bankId ?? null;
    const selectedAssetId: string | undefined = body.selectedAssetId;

    // Muat Bank Data dari DB bila ada; tanpa bank → generator tetap jalan (field dari worksheet/peta).
    let bank: DataBankField[] = Array.isArray(body.bankFields)
      ? (body.bankFields as DataBankField[])
      : [];
    let incidentHint: string | undefined = typeof body.incidentType === 'string'
      ? body.incidentType : undefined;
    if (bankId) {
      const row = await db.caseDataBank.findUnique({ where: { id: bankId } });
      if (!row) return NextResponse.json({ error: 'Bank data tidak ditemukan' }, { status: 404 });
      bank = JSON.parse(row.fields) as DataBankField[];
      incidentHint = row.incidentType; // hasil analisis AI → otoritatif (Panduan Agent langkah 2)
    }

    // Pilih docType; AUTO mengikuti incident type pada Bank Data (Panduan Agent §3).
    let docType: DocType = (body.docType ?? 'AUTO') as DocType;
    if (docType === 'AUTO') docType = pickRenopsType(bank, incidentHint);
    if (!['RENOPS_I', 'RENOPS_II', 'BRIEFING', 'DEBRIEFING'].includes(docType)) {
      return NextResponse.json({ error: `docType tidak dikenal: ${docType}` }, { status: 400 });
    }

    const document = buildDocument(docType, snapshot, bank, selectedAssetId);

    // Simpan draft (versi riwayat untuk review/approval SMC).
    const draft = await db.documentDraft.create({
      data: {
        caseId: body.caseId ?? null,
        bankId,
        docType,
        status: 'DRAFT',
        payload: JSON.stringify(document),
      },
    });

    return NextResponse.json({
      draftId: draft.id,
      document,
      summary: {
        ready: document.validation.ready,
        pending: document.validation.pending,
        actualRequired: document.validation.actualRequired,
        conflict: document.validation.conflict,
        questions: document.questions.length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Gagal generate dokumen: ${(e as Error).message}` },
      { status: 500 },
    );
  }
}
