'use client';

/**
 * Footer stempel untuk SELURUH hasil print aplikasi (aturan pengguna):
 *   "SAR Calculator App - <Tanggal Jam>"
 *
 * Mekanisme:
 *  - Sebuah <div class="sar-print-footer"> ditempel ke <body>. Di layar ia
 *    disembunyikan; saat print CSS `@media print` menampilkannya di bawah
 *    TENGAH tiap halaman (position: fixed diulang di semua halaman cetak).
 *  - Waktu diperbarui otomatis pada event `beforeprint` (mencakup semua jalur
 *    window.print: worksheet fit, portal lembar UPS/MoBo, dokumen, peta A3,
 *    studio peta scan, Ctrl+P browser).
 *  - Jalur headless (?printFreeze, page.pdf() tidak memicu beforeprint)
 *    dicover oleh stampPrintFooter() eksplisit di printSheets/printFit.
 */

const FOOTER_ID = 'sar-print-footer';

/** Teks stempel: "SAR Calculator App - 21 November 2026 09.30" (locale id-ID). */
export function formatPrintStamp(now: Date = new Date()): string {
  const date = now.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const time = now.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `SAR Calculator App - ${date} ${time}`;
}

/** Pastikan footer cetak ada di <body> dan berisi waktu cetak terkini. */
export function stampPrintFooter(now: Date = new Date()): void {
  if (typeof document === 'undefined') return;
  let el = document.getElementById(FOOTER_ID) as HTMLDivElement | null;
  if (!el) {
    el = document.createElement('div');
    el.id = FOOTER_ID;
    el.className = 'sar-print-footer';
    el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(el);
  }
  el.textContent = formatPrintStamp(now);
}

/**
 * Pasang listener global sekali di root aplikasi: setiap pencetakan
 * memperbarui stempel waktu footer. Mengembalikan fungsi pembersih.
 */
export function installPrintFooterListener(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onBeforePrint = () => stampPrintFooter();
  window.addEventListener('beforeprint', onBeforePrint);
  stampPrintFooter();
  return () => window.removeEventListener('beforeprint', onBeforePrint);
}
