import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/sar-cases/[id] — fetch a single SAR case (including state JSON). */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const found = await db.sarCase.findUnique({ where: { id } });
    if (!found) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }
    return NextResponse.json({ case: found });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

/** PUT /api/sar-cases/[id] — update an existing SAR case. */
export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await req.json();
    const updated = await db.sarCase.update({
      where: { id },
      data: {
        ...(body.title != null && { title: String(body.title) }),
        ...(body.caseNumber != null && { caseNumber: body.caseNumber }),
        ...(body.searchObject != null && { searchObject: body.searchObject }),
        ...(body.phase != null && { phase: body.phase }),
        ...(body.state != null && {
          state: typeof body.state === 'string' ? body.state : JSON.stringify(body.state),
        }),
        ...(body.notes != null && { notes: body.notes }),
      },
    });
    return NextResponse.json({ case: updated });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

/** DELETE /api/sar-cases/[id] — remove a SAR case. */
export async function DELETE(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    await db.sarCase.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
