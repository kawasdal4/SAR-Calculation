import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** GET /api/sar-cases — list all saved SAR cases (newest first). */
export async function GET() {
  try {
    const cases = await db.sarCase.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        caseNumber: true,
        searchObject: true,
        phase: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json({ cases });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}

/** POST /api/sar-cases — create a new SAR case. */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.title || !body.state) {
      return NextResponse.json(
        { error: 'title and state are required' },
        { status: 400 },
      );
    }
    const created = await db.sarCase.create({
      data: {
        title: String(body.title),
        caseNumber: body.caseNumber ?? null,
        searchObject: body.searchObject ?? null,
        phase: body.phase ?? 'DISTRESS',
        state: typeof body.state === 'string' ? body.state : JSON.stringify(body.state),
        notes: body.notes ?? null,
      },
    });
    return NextResponse.json({ case: created }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  }
}
