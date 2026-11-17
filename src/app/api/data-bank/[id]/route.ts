import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { type DataBankField, CASE_FACT_MAP } from '@/lib/sar/dataBank';

/** GET /api/data-bank/[id] — ambil satu bank data lengkap. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const bank = await db.caseDataBank.findUnique({ where: { id } });
    if (!bank) return NextResponse.json({ error: 'Bank data tidak ditemukan' }, { status: 404 });
    return NextResponse.json({ bank: { ...bank, fields: JSON.parse(bank.fields) as DataBankField[] } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** PATCH /api/data-bank/[id] — perbarui field bank data (edit manual / jawab pertanyaan AI). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const bank = await db.caseDataBank.findUnique({ where: { id } });
    if (!bank) return NextResponse.json({ error: 'Bank data tidak ditemukan' }, { status: 404 });

    const current = JSON.parse(bank.fields) as DataBankField[];
    let fields: DataBankField[] = current;

    // Mode A: ganti seluruh array fields (dari editor UI).
    if (Array.isArray(body.fields)) {
      fields = body.fields as DataBankField[];
    }
    // Mode B: jawab/sunting satu field by key (menandai manual_confirmed).
    else if (body.key) {
      const value: string | null = body.value === null || body.value === undefined || String(body.value).trim() === ''
        ? null : String(body.value).trim();
      const idx = current.findIndex((f) => f.key === body.key);
      const updatedAt = new Date().toISOString();
      if (idx >= 0) {
        const def = CASE_FACT_MAP[current[idx].key];
        fields = current.map((f, i) => i === idx
          ? {
            ...f,
            value,
            status: value ? 'READY' : 'PENDING',
            sourceType: value ? 'manual_confirmed' : f.sourceType,
            sourceRef: value ? `Input manual petugas (${updatedAt})` : f.sourceRef,
            question: value ? null : f.question,
            plannedActual: def?.plannedActual ?? f.plannedActual,
            updatedAt,
          }
          : f);
      } else if (value) {
        const def = CASE_FACT_MAP[String(body.key)];
        fields = [
          ...current,
          {
            key: String(body.key),
            label: def?.label ?? String(body.label ?? body.key),
            value,
            unit: body.unit ?? null,
            sourceType: 'manual_confirmed',
            sourceRef: `Input manual petugas (${updatedAt})`,
            status: 'READY',
            plannedActual: def?.plannedActual,
            updatedAt,
          },
        ];
      }
    } else {
      return NextResponse.json({ error: 'body.fields atau body.key wajib ada' }, { status: 400 });
    }

    const updated = await db.caseDataBank.update({
      where: { id },
      data: { fields: JSON.stringify(fields) },
    });
    return NextResponse.json({ bank: { ...updated, fields } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** DELETE /api/data-bank/[id] — hapus bank data. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await db.caseDataBank.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
