/**
 * Penyimpanan SEMENTARA peta hasil scan (fitur gambar hasil worksheet di atas
 * peta cetak hasil scan).
 *
 * Kebijakan retensi (permintaan pemilik):
 *  - Berkas dihapus otomatis SAAT BROWSER DI-REFRESH/DITUTUP (client kirim
 *    beacon `POST /api/maps/temp/release` pada event pagehide), dan
 *  - paling lambat 6 JAM (kolom expiresAt; sweep dijalankan pada tiap upload
 *    dan tiap GET — objek kedaluwarsa dihapus dari storage + barisnya).
 *
 * Backend:
 *  - Cloudflare R2 (kompatibel S3) bila env R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *    R2_SECRET_ACCESS_KEY, R2_BUCKET terisi — via aws4fetch (SigV4, tanpa
 *    dependensi berat).
 *  - Fallback disk lokal `.uploads/` (dev/sandbox) dengan kebijakan yang sama.
 *
 * Upload PDF: halaman PERTAMA diraster-kan ke PNG (pdftoppm, sisi terpanjang
 * ±4200 px) supaya bisa ditampilkan & dicetak; FILE ASLI TIDAK PERNAH DIUBAH —
 * raster hanya salinan tampilan, bukan regenerasi AI.
 */

import { AwsClient } from 'aws4fetch';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs';
import path from 'path';
import { db } from '@/lib/db';

export const TEMP_MAP_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam
export const TEMP_MAP_MAX_BYTES = 80 * 1024 * 1024; // 80 MB
export const TEMP_MAP_RASTER_MAX_EDGE = 4200; // px sisi terpanjang raster PDF

export const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
] as const;

export interface TempMapInfo {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storage: 'r2' | 'local';
  /** URL tampilan (raster PNG bila PDF, selain itu file asli). */
  displayUrl: string;
  /** URL file asli (tanpa perubahan). */
  originalUrl: string;
  hasRaster: boolean;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Konfigurasi R2 / fallback lokal
// ---------------------------------------------------------------------------

function r2Env() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const prefix = (process.env.R2_PREFIX?.trim() || 'temp-maps').replace(/^\/+|\/+$/g, '');
  const configured = Boolean(accountId && accessKeyId && secretAccessKey && bucket);
  return { accountId, accessKeyId, secretAccessKey, bucket, prefix, configured };
}

export function isR2Configured(): boolean {
  return r2Env().configured;
}

function localUploadDir(): string {
  const dir = path.join(process.cwd(), '.uploads');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function r2Client(): AwsClient {
  const env = r2Env();
  if (!env.configured) throw new Error('R2 belum dikonfigurasi');
  return new AwsClient({
    accessKeyId: env.accessKeyId!,
    secretAccessKey: env.secretAccessKey!,
    service: 's3',
    region: 'auto',
  });
}

function r2ObjectUrl(key: string): string {
  const env = r2Env();
  return `https://${env.accountId}.r2.cloudflarestorage.com/${env.bucket}/${encodeR2Key(key)}`;
}

function encodeR2Key(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

// ---------------------------------------------------------------------------
// Operasi objek (R2 / disk)
// ---------------------------------------------------------------------------

async function putObject(key: string, bytes: Buffer, mimeType: string): Promise<void> {
  if (isR2Configured()) {
    const client = r2Client();
    const res = await client.fetch(r2ObjectUrl(key), {
      method: 'PUT',
      body: new Uint8Array(bytes),
      headers: { 'content-type': mimeType },
    });
    if (!res.ok) throw new Error(`R2 PUT gagal: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
    return;
  }
  writeFileSync(path.join(localUploadDir(), key.replace(/\//g, '__')), bytes);
}

async function getObject(key: string): Promise<Buffer | null> {
  if (isR2Configured()) {
    const client = r2Client();
    const res = await client.fetch(r2ObjectUrl(key), { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET gagal: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const file = path.join(localUploadDir(), key.replace(/\//g, '__'));
  if (!existsSync(file)) return null;
  return readFileSync(file);
}

async function deleteObject(key: string): Promise<void> {
  if (isR2Configured()) {
    const client = r2Client();
    await client.fetch(r2ObjectUrl(key), { method: 'DELETE' });
    return;
  }
  const file = path.join(localUploadDir(), key.replace(/\//g, '__'));
  if (existsSync(file)) rmSync(file, { force: true });
}

// ---------------------------------------------------------------------------
// Rasterisasi PDF → PNG halaman pertama (pdftoppm/poppler)
// ---------------------------------------------------------------------------

export function rasterizePdfFirstPage(pdf: Buffer): { png: Buffer; widthPx: number; heightPx: number } | null {
  const work = path.join('/tmp', `scanchart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    mkdirSync(work, { recursive: true });
    const src = path.join(work, 'in.pdf');
    writeFileSync(src, pdf);
    const outPrefix = path.join(work, 'page');
    const res = spawnSync('pdftoppm', [
      '-png',
      '-f', '1', '-l', '1',
      '-scale-to', String(TEMP_MAP_RASTER_MAX_EDGE),
      '-singlefile',
      src,
      outPrefix,
    ], { timeout: 60_000 });
    if (res.error || res.status !== 0) return null;
    const pngPath = `${outPrefix}.png`;
    if (!existsSync(pngPath)) return null;
    const png = readFileSync(pngPath);
    // Dimensi dibaca dari header PNG (IHDR: lebar di byte 16-19, tinggi 20-23).
    let widthPx = 0;
    let heightPx = 0;
    if (png.length > 24 && png.readUInt32BE(12 + 4) === 0x49484452) {
      widthPx = png.readUInt32BE(16);
      heightPx = png.readUInt32BE(20);
    }
    return { png, widthPx, heightPx };
  } catch {
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Self-healing schema: tabel TempMapFile dibuat OTOMATIS bila belum ada.
// Deployment (Supabase/Vercel) yang belum menjalankan `prisma db push` setelah
// model TempMapFile ditambahkan gagal dengan P2021 ("The table `public.
// TempMapFile` does not exist") — dengan DDL ini upload peta tetap jalan tanpa
// migrasi manual. Aman dipanggil berulang: IF NOT EXISTS + cache per proses.
// ---------------------------------------------------------------------------

let ensureTablePromise: Promise<void> | null = null;

function isSqliteDatabase(): boolean {
  const url = (process.env.DATABASE_URL ?? '').trim().toLowerCase();
  return url.startsWith('file:') || url.startsWith('sqlite:');
}

const TEMP_MAP_TABLE_DDL: Array<{ sqlite: string; postgres: string }> = [
  {
    sqlite: `CREATE TABLE IF NOT EXISTS "TempMapFile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "fileName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "sizeBytes" INTEGER NOT NULL,
      "storage" TEXT NOT NULL,
      "storageKey" TEXT NOT NULL,
      "rasterKey" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" DATETIME NOT NULL
    )`,
    postgres: `CREATE TABLE IF NOT EXISTS "TempMapFile" (
      "id" TEXT NOT NULL,
      "fileName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "sizeBytes" INTEGER NOT NULL,
      "storage" TEXT NOT NULL,
      "storageKey" TEXT NOT NULL,
      "rasterKey" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expiresAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "TempMapFile_pkey" PRIMARY KEY ("id")
    )`,
  },
  {
    sqlite: `CREATE INDEX IF NOT EXISTS "TempMapFile_expiresAt_idx" ON "TempMapFile"("expiresAt")`,
    postgres: `CREATE INDEX IF NOT EXISTS "TempMapFile_expiresAt_idx" ON "TempMapFile"("expiresAt")`,
  },
];

/** Pastikan tabel TempMapFile ada (sekali per proses; gagal → dicoba lagi nanti). */
export function ensureTempMapTable(): Promise<void> {
  if (!ensureTablePromise) {
    const isSqlite = isSqliteDatabase();
    ensureTablePromise = (async () => {
      for (const ddl of TEMP_MAP_TABLE_DDL) {
        await db.$executeRawUnsafe(isSqlite ? ddl.sqlite : ddl.postgres);
      }
    })().catch((error) => {
      // Reset cache agar panggilan berikutnya mencoba lagi (mis. DB baru siap).
      ensureTablePromise = null;
      throw error;
    });
  }
  return ensureTablePromise;
}

// ---------------------------------------------------------------------------
// Sweep kedaluwarsa (6 jam) — hapus objek + baris
// ---------------------------------------------------------------------------

export async function sweepExpiredTempMaps(): Promise<number> {
  await ensureTempMapTable();
  const expired = await db.tempMapFile.findMany({
    where: { expiresAt: { lt: new Date() } },
    select: { id: true, storageKey: true, rasterKey: true },
  });
  for (const row of expired) {
    try { await deleteObject(row.storageKey); } catch { /* biarkan R2 lifecycle */ }
    if (row.rasterKey) {
      try { await deleteObject(row.rasterKey); } catch { /* idem */ }
    }
  }
  if (expired.length > 0) {
    await db.tempMapFile.deleteMany({
      where: { id: { in: expired.map((row) => row.id) } },
    });
  }
  return expired.length;
}

// ---------------------------------------------------------------------------
// Upload / baca / hapus
// ---------------------------------------------------------------------------

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w.\-() ]+/g, '_').slice(0, 120) || 'peta';
}

export async function createTempMapUpload(input: {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<TempMapInfo> {
  // Peluang bersih-bersih: sweep dipanggil di tiap upload (biaya kecil).
  // Sweep memanggil ensureTempMapTable() — tabel dibuat bila belum ada.
  await sweepExpiredTempMaps();

  const id = crypto.randomUUID();
  const safeName = sanitizeFileName(input.fileName);
  const ext = path.extname(safeName) || (input.mimeType === 'application/pdf' ? '.pdf' : '.png');
  const base = safeName.slice(0, safeName.length - ext.length) || 'peta';
  const prefix = isR2Configured() ? r2Env().prefix : 'temp-maps';
  const storage: 'r2' | 'local' = isR2Configured() ? 'r2' : 'local';
  const storageKey = `${prefix}/${id}-${base}${ext}`;

  await putObject(storageKey, input.bytes, input.mimeType);

  let rasterKey: string | null = null;
  if (input.mimeType === 'application/pdf') {
    const raster = rasterizePdfFirstPage(input.bytes);
    if (raster) {
      rasterKey = `${prefix}/${id}-raster.png`;
      await putObject(rasterKey, raster.png, 'image/png');
    }
  }

  const expiresAt = new Date(Date.now() + TEMP_MAP_TTL_MS);
  await db.tempMapFile.create({
    data: {
      id,
      fileName: safeName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      storage,
      storageKey,
      rasterKey,
      expiresAt,
    },
  });

  return {
    id,
    fileName: safeName,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.length,
    storage,
    displayUrl: rasterKey ? `/api/maps/temp/${id}?variant=raster` : `/api/maps/temp/${id}`,
    originalUrl: `/api/maps/temp/${id}`,
    hasRaster: Boolean(rasterKey),
    expiresAt: expiresAt.toISOString(),
  };
}

export interface LoadedTempMap {
  fileName: string;
  mimeType: string;
  bytes: Buffer;
  rasterKey: string | null;
}

/** Baca baris + objek. Kedaluwarsa → hapus & lempar kode 'expired'. */
export async function loadTempMap(id: string, variant: 'original' | 'raster'): Promise<
  { ok: true; data: LoadedTempMap } | { ok: false; code: 'not-found' | 'expired' }
> {
  await ensureTempMapTable();
  const row = await db.tempMapFile.findUnique({ where: { id } });
  if (!row) return { ok: false, code: 'not-found' };
  if (row.expiresAt.getTime() < Date.now()) {
    await deleteTempMapById(id).catch(() => undefined);
    return { ok: false, code: 'expired' };
  }
  const key = variant === 'raster' ? (row.rasterKey ?? row.storageKey) : row.storageKey;
  const bytes = await getObject(key);
  if (!bytes) return { ok: false, code: 'not-found' };
  const mimeType = variant === 'raster' && row.rasterKey ? 'image/png' : row.mimeType;
  return {
    ok: true,
    data: { fileName: row.fileName, mimeType, bytes, rasterKey: row.rasterKey },
  };
}

export async function deleteTempMapById(id: string): Promise<boolean> {
  await ensureTempMapTable();
  const row = await db.tempMapFile.findUnique({ where: { id } });
  if (!row) return false;
  await deleteObject(row.storageKey).catch(() => undefined);
  if (row.rasterKey) await deleteObject(row.rasterKey).catch(() => undefined);
  await db.tempMapFile.delete({ where: { id } }).catch(() => undefined);
  return true;
}

export async function releaseTempMaps(ids: string[]): Promise<number> {
  let deleted = 0;
  for (const id of ids.slice(0, 50)) {
    if (await deleteTempMapById(id)) deleted += 1;
  }
  return deleted;
}

/** Daftar kunci objek lokal yang masih ada di disk (diagnostik dev). */
export function listLocalTempObjects(): string[] {
  if (isR2Configured()) return [];
  const dir = localUploadDir();
  try {
    return readdirSync(dir).filter((name) => !name.startsWith('.'));
  } catch {
    return [];
  }
}
