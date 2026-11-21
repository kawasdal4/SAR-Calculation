/**
 * Uji self-healing tabel TempMapFile:
 * 1. Hapus tabel (simulasi deployment lama tanpa `prisma db push`).
 * 2. Panggil createTempMapUpload → ensureTempMapTable() harus membuat tabel lagi.
 * 3. loadTempMap harus membaca kembali objeknya.
 * Jalankan: bun scripts/test_tempmap_selfheal.ts
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({ log: ['error'] });

async function main() {
  // 0) Pastikan client generasi SQLite (DATABASE_URL=file:...)
  const url = process.env.DATABASE_URL ?? '';
  console.log('DATABASE_URL =', url);

  // 1) Simulasi tabel hilang (deployment lama)
  await db.$executeRawUnsafe('DROP TABLE IF EXISTS "TempMapFile"');
  console.log('STEP1: tabel TempMapFile DIHAPUS (simulasi deployment lama)');

  // 2) Upload lewat jalur resmi storage (memanggil ensureTempMapTable)
  const { createTempMapUpload, loadTempMap, deleteTempMapById } = await import('../src/lib/sar/tempMapStorage');
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d494844520000000100000001080200000090775' +
    '3de0000000c4944415408d763f8cfc00000030101' + '00' + '18' +
    'ef4a2b0c0000000049454e44ae426082',
    'hex',
  );
  const info = await createTempMapUpload({
    fileName: 'uji-selfheal.png',
    mimeType: 'image/png',
    bytes: png,
  });
  console.log('STEP2: upload OK →', { id: info.id, storage: info.storage, url: info.displayUrl });

  // 3) Baca kembali
  const loaded = await loadTempMap(info.id, 'original');
  console.log('STEP3: load OK →', loaded.ok ? `bytes=${loaded.data.bytes.length} mime=${loaded.data.mimeType}` : loaded.code);

  // 4) Bersihkan
  const deleted = await deleteTempMapById(info.id);
  console.log('STEP4: delete →', deleted);

  const rows = await db.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='TempMapFile'",
  );
  console.log('STEP5: tabel ada kembali =', rows.length === 1);
  await db.$disconnect();
  if (!loaded.ok || rows.length !== 1) process.exit(1);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
