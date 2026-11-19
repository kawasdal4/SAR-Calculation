import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  bankEntrySchema,
  SCENARIO_BANK_SEED,
  type BankEntry,
  type BankEntryApi,
  type BankKind,
} from '@/lib/sar/scenarioBank';

function rowToApi(row: {
  id: string;
  kind: string;
  name: string;
  category: string | null;
  lat: number | null;
  lng: number | null;
  specs: string;
  source: string | null;
  updatedRef: string | null;
  units: string | null;
  verification: string;
  approval: string;
}): BankEntryApi {
  let specs: Record<string, unknown> = {};
  try {
    specs = JSON.parse(row.specs) as Record<string, unknown>;
  } catch {
    specs = {};
  }
  return {
    id: row.id,
    kind: row.kind as BankKind,
    name: row.name,
    category: row.category ?? '',
    ...(row.lat !== null ? { lat: row.lat } : {}),
    ...(row.lng !== null ? { lng: row.lng } : {}),
    specs: specs as BankEntryApi['specs'],
    source: row.source ?? '',
    updatedRef: row.updatedRef ?? '',
    units: row.units ?? '',
    verification: row.verification as BankEntryApi['verification'],
    approval: row.approval as BankEntryApi['approval'],
  };
}

function entryToDbData(entry: BankEntry) {
  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    category: entry.category,
    lat: entry.lat ?? null,
    lng: entry.lng ?? null,
    specs: JSON.stringify(entry.specs),
    source: entry.source,
    updatedRef: entry.updatedRef,
    units: entry.units,
    verification: entry.verification,
    approval: entry.approval,
  };
}

/** GET /api/scenario-bank — daftar entri bank (DB; fallback seed JSON bila DB
 *  kosong/tidak tersedia). Query: ?kind=location|asset&category=... */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') ?? undefined;
  const category = req.nextUrl.searchParams.get('category') ?? undefined;
  try {
    const rows = await db.caseBankItem.findMany({
      where: {
        ...(kind ? { kind } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    if (rows.length === 0) {
      // DB belum di-seed — sajikan seed JSON bawaan agar editor tetap terisi.
      return NextResponse.json({
        source: 'seed',
        entries: SCENARIO_BANK_SEED
          .filter((e) => (kind ? e.kind === kind : true) && (category ? e.category === category : true))
          .map((e) => ({ ...e })),
      });
    }
    return NextResponse.json({ source: 'db', entries: rows.map(rowToApi) });
  } catch {
    return NextResponse.json({
      source: 'seed',
      warning: 'Database tidak tersedia — menampilkan seed JSON bawaan (read-only).',
      entries: SCENARIO_BANK_SEED
        .filter((e) => (kind ? e.kind === kind : true) && (category ? e.category === category : true))
        .map((e) => ({ ...e })),
    });
  }
}

/** POST /api/scenario-bank — buat entri baru, atau ?action=seed untuk mengunggah
 *  seluruh seed JSON ke DB (upsert per id, data DB hasil edit tidak hilang). */
export async function POST(req: NextRequest) {
  const action = req.nextUrl.searchParams.get('action');
  try {
    if (action === 'seed') {
      let upserted = 0;
      for (const entry of SCENARIO_BANK_SEED) {
        await db.caseBankItem.upsert({
          where: { id: entry.id },
          create: entryToDbData(entry),
          update: entryToDbData(entry),
        });
        upserted += 1;
      }
      return NextResponse.json({ ok: true, upserted });
    }
    const body = await req.json();
    const parsed = bankEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Entri tidak valid.', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 400 },
      );
    }
    const created = await db.caseBankItem.upsert({
      where: { id: parsed.data.id },
      create: entryToDbData(parsed.data),
      update: entryToDbData(parsed.data),
    });
    return NextResponse.json({ entry: rowToApi(created) }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
