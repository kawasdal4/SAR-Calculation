'use client';

/**
 * Registry sisi client untuk berkas peta scan SEMENTARA.
 *
 * Tanggung jawab:
 *  1. Mencatat semua ID peta sementara yang sedang dipakai sesi ini.
 *  2. Saat halaman ditutup/di-refresh (event `pagehide`), kirim
 *     `navigator.sendBeacon('/api/maps/temp/release', { ids })` → berkas di
 *     storage (R2/lokal) dihapus SAAT ITU JUGA.
 *  3. Pengaman kedua: daftar ID ditulis ke sessionStorage sebelum unload;
 *     saat load berikutnya bila beacon gagal, penghapusan dituntaskan via
 *     fetch. SessionStorage bertahan antar refresh pada tab yang sama dan
 *     hilang saat tab ditutup — pas dengan kebijakan "refresh = hapus".
 *
 * Modul ini tidak menyimpan gambar/hasil gambar — hasil gambar worksheet di
 * atas peta hanya hidup di memori React (hilang saat refresh, sesuai permintaan).
 */

const HELD_KEY = 'sar-temp-map-held-ids';
const RELEASE_ENDPOINT = '/api/maps/temp/release';

const heldIds = new Set<string>();
let installed = false;

function readHeldFromSession(): string[] {
  try {
    const raw = sessionStorage.getItem(HELD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeHeldToSession(): void {
  try {
    sessionStorage.setItem(HELD_KEY, JSON.stringify([...heldIds]));
  } catch {
    /* storage penuh / diblokir — abaikan */
  }
}

function handlePageHide(): void {
  writeHeldToSession();
  if (heldIds.size === 0) return;
  try {
    const blob = new Blob([JSON.stringify({ ids: [...heldIds] })], { type: 'application/json' });
    navigator.sendBeacon(RELEASE_ENDPOINT, blob);
  } catch {
    /* beacon gagal — pengaman sessionStorage akan menuntaskan di load */
  }
}

function ensureListeners(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('pagehide', handlePageHide);

  // Pengaman kedua saat halaman baru dimuat (refresh): hapus sisa ID sesi lama.
  const stale = readHeldFromSession();
  if (stale.length > 0) {
    try {
      sessionStorage.removeItem(HELD_KEY);
    } catch { /* abaikan */ }
    fetch(RELEASE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: stale }),
      keepalive: true,
    }).catch(() => undefined);
  }
}

export function acquireTempMap(id: string): void {
  ensureListeners();
  heldIds.add(id);
  writeHeldToSession();
}

export function releaseTempMapClient(id: string): void {
  heldIds.delete(id);
  writeHeldToSession();
  fetch(RELEASE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: [id] }),
    keepalive: true,
  }).catch(() => undefined);
}
