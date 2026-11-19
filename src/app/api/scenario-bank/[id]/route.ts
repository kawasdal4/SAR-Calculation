import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { bankEntrySchema } from '@/lib/sar/scenarioBank';

/** PUT /api/scenario-bank/[id] — ubah entri (termasuk status approval
 *  DRAFT → APPROVED oleh pengembangan/admin, keputusan no. 7 & 12). */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const parsed = bankEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Entri tidak valid.', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 },
      );
    }
    if (parsed.data.id !== id) {
      return NextResponse.json({ error: 'id pada URL dan body tidak cocok.' }, { status: 400 });
    }
    const updated = await db.caseBankItem.update({
      where: { id },
      data: {
        kind: parsed.data.kind,
        name: parsed.data.name,
        category: parsed.data.category,
        lat: parsed.data.lat ?? null,
        lng: parsed.data.lng ?? null,
        specs: JSON.stringify(parsed.data.specs),
        source: parsed.data.source,
        updatedRef: parsed.data.updatedRef,
        units: parsed.data.units,
        verification: parsed.data.verification,
        approval: parsed.data.approval,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** DELETE /api/scenario-bank/[id] — hapus entri. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await db.caseBankItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
