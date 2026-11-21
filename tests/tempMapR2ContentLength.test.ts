/**
 * Regresi bug "R2 PUT gagal: 411 MissingContentLength" di Vercel.
 *
 * Mekanisme bug: aws4fetch client.fetch() memanggil fetch(Request object);
 * patch fetch milik Next.js (patch-fetch.js → doOriginalFetch, input Request)
 * me-rebuild Request itu dengan `body: request.body` yang berupa
 * ReadableStream tanpa panjang → undici mengirim Transfer-Encoding: chunked
 * TANPA Content-Length → R2 menolak PUT dengan 411 MissingContentLength.
 *
 * Perbaikan (r2SignedFetch): sign() lalu dispatch fetch(url, init) dengan
 * body byte asli — patch-fetch memakai cabang `else if (init)` yang
 * mempertahankan body, sehingga Content-Length tetap terkirim.
 *
 * Tes di bawah memasang wrapper fetch global yang MENIRU patch Next, lalu
 * memastikan Content-Length tetap ada. Implementasi lama (client.fetch) akan
 * GAGAL pada tes ini; implementasi baru wajib lolos.
 * Jalankan: bun test tests/tempMapR2ContentLength.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { r2SignedFetch } from '../src/lib/sar/tempMapStorage';

interface CapturedRequest {
  method: string;
  contentLength: string | null;
  transferEncoding: string | null;
  authorization: string | null;
  xAmzContentSha256: string | null;
  bodyBytes: number;
}

async function withCaptureServer(
  fn: (ctx: { url: string; hits: CapturedRequest[] }) => Promise<void>,
): Promise<void> {
  const hits: CapturedRequest[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const body = await req.arrayBuffer();
      hits.push({
        method: req.method,
        contentLength: req.headers.get('content-length'),
        transferEncoding: req.headers.get('transfer-encoding'),
        authorization: req.headers.get('authorization'),
        xAmzContentSha256: req.headers.get('x-amz-content-sha256'),
        bodyBytes: body.byteLength,
      });
      return new Response('<?xml version="1.0"?><ok/>', { status: 200 });
    },
  });
  try {
    await fn({ url: `http://127.0.0.1:${server.port}/bucket/key-1.bin`, hits });
  } finally {
    server.stop(true);
  }
}

/** Wrapper yang meniru patch-fetch.js Next 16 (doOriginalFetch, isRequestInput):
 * Request object di-rebuild dengan body ReadableStream tanpa panjang. */
function patchFetchNextStyle(original: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request && !init) {
      let rebuilt: Request;
      try {
        rebuilt = new Request(input.url, {
          method: input.method,
          headers: input.headers,
          body: input.body, // ← ReadableStream, tanpa panjang (persis patch-fetch.js:590)
          // @ts-expect-error duplex diperlukan saat membangun Request dari stream
          duplex: 'half',
        } as RequestInit);
      } catch {
        // Runtime tanpa dukungan duplex: lewati simulasi, dispatch apa adanya.
        return original(input);
      }
      return original(rebuilt);
    }
    return original(input, init);
  }) as typeof fetch;
}

const R2_ENV_KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;

function withR2Env(fn: () => Promise<void>): Promise<void> {
  const saved = R2_ENV_KEYS.map((key) => [key, process.env[key]] as const);
  R2_ENV_KEYS.forEach((key) => {
    process.env[key] = key === 'R2_BUCKET' ? 'bucket-test' : 'test';
  });
  return fn().finally(() => {
    saved.forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  });
}

describe('r2SignedFetch — Content-Length tetap terkirim ke R2', () => {
  it('PUT mengirim Content-Length (dan tetap ter-sign SigV4) walau fetch di-patch gaya Next', async () => {
    await withR2Env(() =>
      withCaptureServer(async ({ url, hits }) => {
        const original = globalThis.fetch;
        globalThis.fetch = patchFetchNextStyle(original);
        try {
          const bytes = new Uint8Array(2048).fill(9);
          const res = await r2SignedFetch(url, 'PUT', bytes, 'image/png');
          expect(res.ok).toBe(true);
        } finally {
          globalThis.fetch = original;
        }
        expect(hits.length).toBe(1);
        const hit = hits[0]!;
        expect(hit.method).toBe('PUT');
        expect(hit.contentLength).toBe('2048');
        expect(hit.transferEncoding).toBeNull();
        expect(hit.bodyBytes).toBe(2048);
        // SigV4 tetap lengkap setelah sign() + dispatch ulang:
        expect(hit.authorization?.startsWith('AWS4-HMAC-SHA256')).toBe(true);
        expect(hit.xAmzContentSha256).toBe('UNSIGNED-PAYLOAD');
      }),
    );
  });

  it('PUT tanpa patch pun mengirim Content-Length + body utuh', async () => {
    await withR2Env(() =>
      withCaptureServer(async ({ url, hits }) => {
        const bytes = new Uint8Array(1024).fill(7);
        const res = await r2SignedFetch(url, 'PUT', bytes, 'image/png');
        expect(res.ok).toBe(true);
        expect(hits.length).toBe(1);
        expect(hits[0]!.contentLength).toBe('1024');
        expect(hits[0]!.transferEncoding).toBeNull();
        expect(hits[0]!.bodyBytes).toBe(1024);
      }),
    );
  });

  it('GET tanpa body tidak mengirim Content-Length dan tetap 200', async () => {
    await withR2Env(() =>
      withCaptureServer(async ({ url, hits }) => {
        const res = await r2SignedFetch(url, 'GET', null);
        expect(res.ok).toBe(true);
        expect(hits.length).toBe(1);
        expect(hits[0]!.method).toBe('GET');
        expect(hits[0]!.contentLength).toBeNull();
        expect(hits[0]!.authorization?.startsWith('AWS4-HMAC-SHA256')).toBe(true);
      }),
    );
  });
});
