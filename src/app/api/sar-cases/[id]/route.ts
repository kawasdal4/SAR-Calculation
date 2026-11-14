import { NextRequest, NextResponse } from 'next/server';
import { db, inMemoryDb, usePrisma } from '@/lib/db';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** GET /api/sar-cases/[id] — fetch a single SAR case (including state JSON). */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (usePrisma && db) {
      const found = await db.sarCase.findUnique({ where: { id } });
      if (!found) {
        return NextResponse.json({ error: 'Case not found' }, { status: 404 });
      }
      return NextResponse.json({ case: found, store: 'prisma' });
    }
    const found = await inMemoryDb.case.findUnique({ where: { id } });
    if (!found) {
      return NextResponse.json({ error: 'Case not found' }, { status: 404 });
    }
    return NextResponse.json({ case: found, store: 'memory' });
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
    const data: Record<string, unknown> = {};
    if (body.title != null) data.title = String(body.title);
    if (body.caseNumber != null) data.caseNumber = body.caseNumber;
    if (body.searchObject != null) data.searchObject = body.searchObject;
    if (body.phase != null) data.phase = body.phase;
    if (body.state != null) {
      data.state = typeof body.state === 'string' ? body.state : JSON.stringify(body.state);
    }
    if (body.notes != null) data.notes = body.notes;

    if (usePrisma && db) {
      const updated = await db.sarCase.update({ where: { id }, data });
      return NextResponse.json({ case: updated, store: 'prisma' });
    }
    const updated = await inMemoryDb.case.update({ where: { id }, data });
    return NextResponse.json({ case: updated, store: 'memory' });
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
    if (usePrisma && db) {
      await db.sarCase.delete({ where: { id } });
      return NextResponse.json({ ok: true, store: 'prisma' });
    }
    await inMemoryDb.case.delete({ where: { id } });
    return NextResponse.json({ ok: true, store: 'memory' });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
