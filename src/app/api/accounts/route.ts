import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import {
  hashPassword,
  requireDeveloper,
} from '@/lib/auth';

/**
 * Manajemen akun portal — KHUSUS role developer.
 * GET  /api/accounts  — daftar akun (tanpa hash password).
 * POST /api/accounts  — tambah akun baru {identifier, name?, role?}.
 *   - identifier: Email ATAU NIP (unik).
 *   - password awal: SAR_ACCOUNT_DEFAULT_PASSWORD (default "SAR115").
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NIP_RE = /^\d{8,20}$/;
const ROLES = new Set(['developer', 'operator']);

export async function GET(req: NextRequest) {
  const { error } = requireDeveloper(req);
  if (error) return error;

  const accounts = await db.account.findMany({
    select: {
      id: true,
      identifier: true,
      name: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return Response.json({ accounts });
}

export async function POST(req: NextRequest) {
  const { error } = requireDeveloper(req);
  if (error) return error;

  let body: { identifier?: string; name?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Body tidak valid' }, { status: 400 });
  }

  const identifier = (body.identifier ?? '').trim();
  const name = (body.name ?? '').trim() || null;
  const role = body.role && ROLES.has(body.role) ? body.role : 'operator';

  if (!EMAIL_RE.test(identifier) && !NIP_RE.test(identifier)) {
    return Response.json(
      { error: 'Identifier harus Email yang valid ATAU NIP (8-20 digit angka).' },
      { status: 400 },
    );
  }

  const exists = await db.account.findUnique({ where: { identifier } });
  if (exists) {
    return Response.json(
      { error: 'Email/NIP tersebut sudah terdaftar.' },
      { status: 409 },
    );
  }

  const defaultPassword =
    process.env.SAR_ACCOUNT_DEFAULT_PASSWORD || 'SAR115';

  const account = await db.account.create({
    data: {
      identifier,
      name,
      role,
      passwordHash: hashPassword(defaultPassword),
    },
    select: {
      id: true,
      identifier: true,
      name: true,
      role: true,
      createdAt: true,
    },
  });

  return Response.json({ ok: true, account, defaultPassword }, { status: 201 });
}
