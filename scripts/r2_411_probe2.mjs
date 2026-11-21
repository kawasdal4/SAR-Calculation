/**
 * Probe #2 — konfirmasi mekanisme 411 & validasi kandidat perbaikan.
 *
 * X. Reproduksi persis jalur Next patch-fetch: Request object → di-rebuild
 *    dengan body STREAM (reqInput.body) → chunked tanpa Content-Length.
 * Y. Kandidat perbaikan: client.sign() lalu fetch(signed.url, {method,
 *    headers, body: bytes}) — body BYTE via init → patch-fetch memakai
 *    cabang `else if (init)` yang mempertahankan body asli.
 * Z. Belt-and-braces: apakah header content-length eksplisit selamat untuk
 *    body stream (kalau dipakai bersama perbaikan Y)?
 *
 * Jalankan: node scripts/r2_411_probe2.mjs
 */
import http from 'node:http';
import { AwsClient } from 'aws4fetch';

const hits = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    hits.push({
      contentLength: req.headers['content-length'] ?? '(TIDAK ADA)',
      transferEncoding: req.headers['transfer-encoding'] ?? null,
      bodyBytes: Buffer.concat(chunks).length,
    });
    res.writeHead(200);
    res.end('ok');
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}/bucket/key-1.bin`;

const client = new AwsClient({
  accessKeyId: 'AKIA-TEST',
  secretAccessKey: 'secret-test',
  service: 's3',
  region: 'auto',
});
const bytes = new Uint8Array(1024).fill(7);

async function run(label, fn) {
  const before = hits.length;
  try {
    await fn();
    console.log(`${label}\n   → ${JSON.stringify(hits[before])}`);
  } catch (error) {
    console.log(`${label}\n   → ERROR: ${error.message}`);
  }
}

// X. Reproduksi jalur Next patch-fetch (isRequestInput=true): rebuild Request
//    dengan body stream seperti di doOriginalFetch() patch-fetch.js:590.
await run('X. REPRO: Request di-rebuild dengan body stream (jalur Next)', async () => {
  const req = await client.sign(base, {
    method: 'PUT',
    body: bytes,
    headers: { 'content-type': 'image/png' },
  });
  const rebuilt = new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body, // ← Request.body selalu ReadableStream — persis patch-fetch.js:590
    duplex: 'half',
  });
  await fetch(rebuilt);
});

// Y. Kandidat perbaikan: sign() lalu dispatch (url, init) dengan body byte.
await run('Y. FIX: fetch(signed.url, {method, headers, body: bytes})', async () => {
  const signed = await client.sign(base, {
    method: 'PUT',
    body: bytes,
    headers: { 'content-type': 'image/png' },
  });
  await fetch(signed.url, {
    method: signed.method,
    headers: signed.headers,
    body: bytes, // byte body asli — cabang `else if (init)` patch-fetch
  });
});

// Z. Belt-and-braces: signed.headers + content-length eksplisit.
await run('Z. FIX + content-length eksplisit di headers', async () => {
  const signed = await client.sign(base, {
    method: 'PUT',
    body: bytes,
    headers: { 'content-type': 'image/png', 'content-length': String(bytes.byteLength) },
  });
  await fetch(signed.url, {
    method: signed.method,
    headers: signed.headers,
    body: bytes,
  });
});

server.close();
