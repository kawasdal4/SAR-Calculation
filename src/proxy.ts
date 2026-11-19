import { NextRequest, NextResponse } from 'next/server';

/**
 * Proteksi seluruh aplikasi (Next 16: proxy.ts, pengganti middleware.ts).
 * Cookie sesi `sar_session` ditandatangani HMAC-SHA256 oleh /api/auth/login.
 * Verifikasi di sini memakai Web Crypto (kompatibel edge runtime).
 */

const COOKIE_NAME = 'sar_session';

interface SessionPayload {
  u: string;
  r: string;
  exp: number;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getSession(
  req: NextRequest,
): Promise<SessionPayload | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const secret = process.env.SAR_AUTH_SECRET;
  if (!token || !secret) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlToBytes(sig),
      enc.encode(payload),
    );
    if (!valid) return null;

    const data = JSON.parse(
      new TextDecoder().decode(b64urlToBytes(payload)),
    ) as SessionPayload;
    if (!data.exp || Date.now() >= data.exp * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export default async function proxy(req: NextRequest) {
  const session = await getSession(req);
  if (session) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // Permintaan API (di luar /api/auth/*) → 401 JSON, bukan redirect HTML.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Bebaskan: halaman login, API auth, favicon/icon, aset statis & build Next.
  matcher: [
    '/((?!login|api/auth|_next|images|icon|foe.jpg|logo-sar.png|favicon.ico).*)',
  ],
};
