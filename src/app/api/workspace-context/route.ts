import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  buildWorkspaceSnapshot,
  buildConversationEntry,
  recomputeEntry,
  rowToEntry,
  entryToRow,
  invalidateDependents,
  type ContextEntry,
  type ContextStatus,
} from '@/lib/sar/workspaceContext';

/**
 * SAR Workflow Memory — API konteks workspace (SarCase existing = workspace).
 * Append-only: versi baru ditambahkan, hasil lama di-ARCHIVED (tidak dihapus).
 * Isolasi workspace: semua operasi wajib menyertakan caseId.
 */

/** GET /api/workspace-context?caseId=… — semua entry konteks (semua versi). */
export async function GET(req: NextRequest) {
  const caseId = req.nextUrl.searchParams.get('caseId');
  if (!caseId) return NextResponse.json({ error: 'caseId wajib — isolasi workspace.' }, { status: 400 });
  try {
    const rows = await db.workspaceContext.findMany({
      where: { caseId },
      orderBy: [{ entryKey: 'asc' }, { version: 'asc' }],
    });
    return NextResponse.json({ entries: rows.map(rowToEntry) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/workspace-context
 * - action 'snapshot'    : simpan snapshot state aplikasi (hash → versi baru
 *                           hanya bila input berubah; dependen lama STALE).
 * - action 'conversation': simpan keputusan/koreksi/pertanyaan (category E).
 * - action 'recompute'   : hitung ulang satu slot setelah persetujuan pengguna.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      caseId?: string;
      action?: 'snapshot' | 'conversation' | 'recompute';
      state?: Record<string, unknown>;
      extras?: Record<string, Record<string, unknown>>;
      kind?: string;
      text?: string;
      entryKey?: string;
      data?: Record<string, unknown>;
    };
    const caseId = body.caseId;
    if (!caseId) return NextResponse.json({ error: 'caseId wajib — isolasi workspace.' }, { status: 400 });
    const caseExists = await db.sarCase.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!caseExists) return NextResponse.json({ error: 'Workspace (SarCase) tidak ditemukan.' }, { status: 404 });

    const existingRows = await db.workspaceContext.findMany({ where: { caseId } });
    const existing = existingRows.map(rowToEntry);
    const action = body.action ?? 'snapshot';

    if (action === 'conversation') {
      if (!body.text) return NextResponse.json({ error: 'text wajib untuk conversation.' }, { status: 400 });
      const kind = ['decision', 'correction', 'pending-question', 'approved-action', 'note'].includes(body.kind ?? '')
        ? (body.kind as 'decision' | 'correction' | 'pending-question' | 'approved-action' | 'note')
        : 'note';
      const entry = buildConversationEntry(caseId, kind, body.text);
      await db.workspaceContext.create({ data: { ...entryToRow(entry), createdAt: entry.createdAt, updatedAt: entry.updatedAt } });
      return NextResponse.json({ entry }, { status: 201 });
    }

    if (action === 'recompute') {
      if (!body.entryKey || !body.data) {
        return NextResponse.json({ error: 'entryKey dan data wajib untuk recompute.' }, { status: 400 });
      }
      const entry = recomputeEntry(body.entryKey, caseId, body.data, existing);
      // Versi lama slot ini → ARCHIVED (histori dipertahankan).
      for (const old of existing.filter((e) => e.entryKey === body.entryKey && e.id !== entry.id && e.status !== 'ARCHIVED')) {
        await db.workspaceContext.update({
          where: { id: old.id },
          data: { status: 'ARCHIVED', supersededBy: entry.entryKey, updatedAt: new Date() },
        });
      }
      await db.workspaceContext.create({ data: { ...entryToRow(entry), createdAt: entry.createdAt, updatedAt: entry.updatedAt } });
      const rows = await db.workspaceContext.findMany({ where: { caseId }, orderBy: [{ entryKey: 'asc' }, { version: 'asc' }] });
      return NextResponse.json({ entries: rows.map(rowToEntry) }, { status: 201 });
    }

    // action 'snapshot'
    if (!body.state) return NextResponse.json({ error: 'state wajib untuk snapshot.' }, { status: 400 });
    const { entries: fresh, history } = buildWorkspaceSnapshot(caseId, body.state, existing, body.extras ?? {});
    // Invalidation graph: input yang berubah versi → dependen STALE.
    const changedKeys = fresh
      .filter((e) => !existing.some((o) => o.entryKey === e.entryKey && o.inputsHash === e.inputsHash))
      .map((e) => e.entryKey);
    const all = invalidateDependents([...existing, ...fresh, ...history], changedKeys);

    // Tulis: entry baru (versi baru) + histori archived + entry STALE yang berubah status.
    for (const e of all) {
      const exists = existingRows.some((r) => r.id === e.id);
      if (!exists) {
        await db.workspaceContext.create({ data: { ...entryToRow(e), createdAt: new Date(e.createdAt), updatedAt: new Date(e.updatedAt) } });
      } else {
        const oldRow = existingRows.find((r) => r.id === e.id)!;
        if (oldRow.status !== e.status || oldRow.summary !== e.summary) {
          await db.workspaceContext.update({ where: { id: e.id }, data: { status: e.status, summary: e.summary, updatedAt: new Date(e.updatedAt) } });
        }
      }
    }

    const rows = await db.workspaceContext.findMany({ where: { caseId }, orderBy: [{ entryKey: 'asc' }, { version: 'asc' }] });
    return NextResponse.json({ changedKeys, entries: rows.map(rowToEntry) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** PATCH — ubah status satu entry (mis. INVALID, NEEDS_REVIEW → CURRENT setelah review). */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { caseId?: string; entryId?: string; status?: ContextStatus };
    if (!body.caseId || !body.entryId || !body.status) {
      return NextResponse.json({ error: 'caseId, entryId, status wajib.' }, { status: 400 });
    }
    const allowed: ContextStatus[] = ['CURRENT', 'STALE', 'PENDING', 'NEEDS_REVIEW', 'INVALID', 'ARCHIVED'];
    if (!allowed.includes(body.status)) return NextResponse.json({ error: 'Status tidak dikenal.' }, { status: 400 });
    const row = await db.workspaceContext.findUnique({ where: { id: body.entryId } });
    if (!row || row.caseId !== body.caseId) {
      return NextResponse.json({ error: 'Entry tidak ditemukan di workspace ini (proteksi antar-workspace).' }, { status: 404 });
    }
    await db.workspaceContext.update({ where: { id: body.entryId }, data: { status: body.status, updatedAt: new Date() } });
    const rows = await db.workspaceContext.findMany({ where: { caseId: body.caseId }, orderBy: [{ entryKey: 'asc' }, { version: 'asc' }] });
    return NextResponse.json({ entries: rows.map(rowToEntry) as ContextEntry[] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
