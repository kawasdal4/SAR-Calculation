'use client';

/**
 * Cetak satu worksheet (tab aktif) dalam satu halaman A4 portrait.
 *
 * Prinsip:
 *  - Ukuran konten tab aktif diukur, lalu dikompres dengan CSS `zoom`
 *    (via variabel --ws-print-zoom pada <html>) sehingga seluruh worksheet
 *    muat pada SATU halaman (fit-to-page).
 *  - Margin kertas minimal diatur @page globals.css (6mm).
 *  - Variabel dibersihkan setelah dialog cetak ditutup (afterprint).
 */

/** Area konten A4 portrait dengan margin @page 6mm (96 dpi). */
const A4_CONTENT_W_PX = Math.round(((210 - 12) * 96) / 25.4);
const A4_CONTENT_H_PX = Math.round(((297 - 12) * 96) / 25.4);

const ZOOM_VAR = '--ws-print-zoom';
const MIN_ZOOM = 0.25;

let cleanupFn: (() => void) | null = null;

function clearZoomVar() {
  window.removeEventListener('afterprint', cleanup);
  document.documentElement.style.removeProperty(ZOOM_VAR);
  cleanupFn = null;
}

function cleanup() {
  cleanupFn?.();
}

/** Zoom = skala terkecil agar konten muat lebar & tinggi satu halaman A4. */
function computeFitZoom(contentW: number, contentH: number): number {
  if (contentW <= 0 || contentH <= 0) return 1;
  const zoom = Math.min(1, A4_CONTENT_W_PX / contentW, A4_CONTENT_H_PX / contentH);
  return Math.max(MIN_ZOOM, Math.min(1, zoom));
}

/**
 * Cetak tab worksheet yang sedang aktif dalam satu halaman.
 * Dipakai tombol "Cetak Lembar Ini" di tiap tab dan tombol cetak
 * pada worksheet mandiri (Intercept, dll).
 *
 * Panel berisi `[data-print-flow]` dicetak ALAMI (multi-halaman mengikuti
 * isi, tanpa zoom) — dipakai Briefing/Renops/De-Briefing yang jumlah
 * halamannya bergantung banyak keterangan.
 */
export function printActiveWorksheetFit() {
  if (typeof window === 'undefined') return;
  if (cleanupFn) cleanupFn();

  const panel = document.querySelector(
    '[role="tabpanel"][data-state="active"]',
  ) as HTMLElement | null;

  let zoom = 1;
  if (panel && !panel.querySelector('[data-print-flow]')) {
    zoom = computeFitZoom(panel.scrollWidth, panel.scrollHeight);
  }
  document.documentElement.style.setProperty(ZOOM_VAR, zoom.toFixed(3));
  window.addEventListener('afterprint', cleanup);
  cleanupFn = clearZoomVar;

  // Beri kesempatan browser menerapkan variabel sebelum dialog cetak dibuka.
  window.setTimeout(() => window.print(), 40);
}
