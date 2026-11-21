/**
 * Test pemilih direktori upload lokal (fallback disk storage 'local'):
 * kandidat pertama yang BISA dibuat & ditulis yang menang; kandidat
 * read-only/tidak-createtable dilewati (bug lama: mkdir '/var/task/.uploads'
 * ENOENT di Vercel). Jalankan: bun test tests/tempMapStorageDirs.test.ts
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { resolveLocalUploadDir } from '../src/lib/sar/tempMapStorage';

describe('resolveLocalUploadDir — fallback disk yang bisa ditulis', () => {
  it('kandidat writable langsung dipakai', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'uploads-'));
    expect(resolveLocalUploadDir([dir])).toBe(dir);
  });

  it('kandidat read-only (mis. /var/task, /proc) dilewati → kandidat berikutnya', () => {
    const fallback = mkdtempSync(path.join(tmpdir(), 'uploads-'));
    // /proc: mkdir pasti gagal (procfs) — mensimulasikan cwd read-only serverless.
    const picked = resolveLocalUploadDir(['/proc/.uploads-x', '/var/task/.uploads-x', fallback]);
    expect(picked).toBe(fallback);
  });

  it('semua kandidat gagal → error dengan pesan UPLOAD_DIR/R2', () => {
    let message = '';
    try {
      resolveLocalUploadDir(['/proc/.uploads-x', '/var/task/.uploads-x']);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('UPLOAD_DIR');
    expect(message).toContain('R2');
  });
});
