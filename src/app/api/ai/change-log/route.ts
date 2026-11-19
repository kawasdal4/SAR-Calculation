/**
 * /api/ai/change-log (Fase 2, keputusan no.9 & 10) — audit + undo per-batch.
 *
 * POST : simpan SATU batch (transaksi atomic — semua baris atau tidak sama
 *        sekali). Source: 'ai-apply' (setelah pengguna konfirmasi) atau 'undo'.
 * GET  : ?batchId=... → baris batch; ?caseId=...&limit=20 → ringkasan batch.
 *
 * ATURAN:
 * - Tidak ada API key / dokumen mentah — hanya field terdaftar + nilai JSON.
 * - DB (Supabase Postgres) = sumber audit utama; gagal ditulis → 503 (client
 *   memakai fallback memori untuk undo sesi berjalan).
 */

import { NextRequest, NextResponse } from 'next/server';
import { CHANGE_LOG_WORKSHEETS, type ChangeLogRow } from '@/lib/ai/changeLog';

const MAX_ROWS = 200;
const MAX_VALUE_CHARS = 8000;
const MAX_FIELD_CHARS = 160;

interface IncomingRow {
  worksheet?: unknown;
  field?: unknown;
  valueBefore?: unknown;
  valueAfter?: unknown;
}

function sanitizeRows(raw: unknown): { rows: ChangeLogRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: ChangeLogRow[] = [];
  if (!Array.isArray(raw)) {
    return { rows: [], errors: ['rows wajib array.'] };
  }
  for (const item of raw.slice(0, MAX_ROWS)) {
    const record = item && typeof item === 'object' ? (item as IncomingRow) : {};
    const worksheet = typeof record.worksheet === 'string' ? record.worksheet : '';
    const field = typeof record.field === 'string' ? record.field.trim() : '';
    if (!(CHANGE_LOG_WORKSHEETS as readonly string[]).includes(worksheet)) {
      errors.push(`worksheet "${worksheet}" tidak terdaftar.`);
      continue;
    }
    if (!field || field.length > MAX_FIELD_CHARS) {
      errors.push(`field tidak valid (kosong / > ${MAX_FIELD_CHARS} karakter).`);
      continue;
    }
    const toValue = (value: unknown): string | null | undefined => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') return value.slice(0, MAX_VALUE_CHARS);
      try {
        return JSON.stringify(value).slice(0, MAX_VALUE_CHARS);
      } catch {
        errors.push(`field "${field}": nilai tidak dapat diserialisasi.`);
        return undefined;
      }
    };
    const valueBefore = toValue(record.valueBefore);
    const valueAfter = toValue(record.valueAfter);
    if (valueBefore === undefined || valueAfter === undefined) continue;
    rows.push({ worksheet: worksheet as ChangeLogRow['worksheet'], field, valueBefore, valueAfter });
  }
  return { rows, errors };
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const batchId = typeof body.batchId === 'string' && body.batchId.length > 0 && body.batchId.length <= 64
      ? body.batchId
      : '';
    if (!batchId) {
      return NextResponse.json({ error: 'batchId wajib (maks 64 karakter).' }, { status: 400 });
    }
    const source = body.source === 'undo' ? 'undo' : 'ai-apply';
    const caseId = typeof body.caseId === 'string' && body.caseId.length > 0 && body.caseId.length <= 64 ? body.caseId : null;
    const sessionId = typeof body.sessionId === 'string' && body.sessionId.length > 0 && body.sessionId.length <= 64 ? body.sessionId : null;
    const { rows, errors } = sanitizeRows(body.rows);
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, batchId, count: 0, errors });
    }
    const { db } = await import('@/lib/db');
    // Keputusan no.10: satu batch = satu transaksi atomic.
    const count = await db.$transaction(async (tx) => {
      await tx.caseChangeLog.createMany({
        data: rows.map((row) => ({
          batchId,
          caseId,
          actor: 'ai',
          source,
          worksheet: row.worksheet,
          field: row.field,
          valueBefore: row.valueBefore,
          valueAfter: row.valueAfter,
        })),
      });
      return rows.length;
    });
    return NextResponse.json({ ok: true, batchId, count, ...(errors.length > 0 ? { errors } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal menyimpan change-log.';
    console.error('[change-log] POST gagal:', message);
    return NextResponse.json({ error: 'Database tidak dapat menulis change-log.' }, { status: 503 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const batchId = searchParams.get('batchId');
    const caseId = searchParams.get('caseId');
    const limitParam = Number(searchParams.get('limit') ?? '20');
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.round(limitParam), 100) : 20;
    const { db } = await import('@/lib/db');

    if (batchId) {
      const rows = await db.caseChangeLog.findMany({
        where: { batchId },
        orderBy: { createdAt: 'asc' },
        select: { worksheet: true, field: true, valueBefore: true, valueAfter: true, source: true, createdAt: true, caseId: true },
      });
      return NextResponse.json({ ok: true, batchId, rows });
    }

    const rows = await db.caseChangeLog.findMany({
      where: caseId ? { caseId } : {},
      orderBy: { createdAt: 'desc' },
      take: limit * 20,
      select: { batchId: true, source: true, createdAt: true, worksheet: true },
    });
    // Kelompokkan per batch (ringkasan untuk UI undo).
    const byBatch = new Map<string, { batchId: string; source: string; createdAt: Date; worksheets: Set<string>; count: number }>();
    for (const row of rows) {
      const entry = byBatch.get(row.batchId) ?? {
        batchId: row.batchId,
        source: row.source,
        createdAt: row.createdAt,
        worksheets: new Set<string>(),
        count: 0,
      };
      entry.worksheets.add(row.worksheet);
      entry.count += 1;
      byBatch.set(row.batchId, entry);
    }
    const batches = [...byBatch.values()].slice(0, limit).map((entry) => ({
      batchId: entry.batchId,
      source: entry.source,
      createdAt: entry.createdAt.toISOString(),
      changedCount: entry.count,
      worksheets: [...entry.worksheets].sort(),
    }));
    return NextResponse.json({ ok: true, batches });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Gagal membaca change-log.';
    console.error('[change-log] GET gagal:', message);
    return NextResponse.json({ error: 'Database tidak dapat membaca change-log.' }, { status: 503 });
  }
}
