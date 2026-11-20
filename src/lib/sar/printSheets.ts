'use client';

/**
 * Print Mode terpisah untuk lembar plotting (UPS / Maneuvering Board / UPS Digital ADW).
 *
 * Prinsip:
 *  - Screen Mode tetap interaktif (zoom, pan, input) — tidak diubah.
 *  - Saat cetak, komponen target me-render blok cetak khusus ke <body> via portal
 *    (class `portal-print-sheet`); seluruh UI aplikasi disembunyikan oleh CSS print.
 *  - Ukuran kertas diatur lewat @page yang disuntikkan dinamis (A3/A4 Landscape)
 *    sehingga proporsi dan skala plotting tidak berubah, tanpa halaman kosong.
 *  - Tidak ada screenshot/html2canvas: gambar template = scan asli resolusi native
 *    (≥300 DPI pada ukuran kertas), seluruh elemen geometris = SVG vektor.
 */

import { useSyncExternalStore } from 'react';
import { stampPrintFooter } from '@/lib/sar/printFooter';

export type PrintPaper = 'a3' | 'a4';

/** Ukuran kertas landscape dalam mm. */
export const PAPER_LANDSCAPE_MM: Record<PrintPaper, [number, number]> = {
  a3: [420, 297],
  a4: [297, 210],
};

export interface PrintScopeState {
  active: boolean;
  paper: PrintPaper;
  /** ID target lembar, mis. 'ups-plotter' | 'adw-ups' | 'mobo-awa' | 'mobo-asw'. */
  target: string | null;
  /** true bila diaktifkan lewat URL (mode uji/headless) — tanpa memanggil window.print(). */
  frozen: boolean;
}

let state: PrintScopeState = { active: false, paper: 'a4', target: null, frozen: false };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function setState(next: PrintScopeState) {
  state = next;
  emit();
}

export const printScopeStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get(): PrintScopeState {
    return state;
  },
};

const PAGE_STYLE_ID = 'sheet-print-page-style';

function injectPageStyle(paper: PrintPaper) {
  const [w, h] = PAPER_LANDSCAPE_MM[paper];
  let style = document.getElementById(PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    document.head.appendChild(style);
  }
  // Ditulis paling akhir di <head> sehingga menimpa @page bawaan globals.css.
  style.textContent = `@page { size: ${w}mm ${h}mm; margin: 8mm; }`;
}

function removePageStyle() {
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

export function activatePrintScope(paper: PrintPaper, target: string, frozen = false) {
  injectPageStyle(paper);
  // Stempel footer cetak "SAR Calculator App - <tanggal jam>" — jalur headless
  // (?printFreeze) tidak memicu beforeprint, jadi ditempel eksplisit di sini.
  stampPrintFooter();
  // Atribut pada <html> mengaktifkan CSS isolasi cetak (globals.css)
  document.documentElement.dataset.printScope = 'sheet';
  document.documentElement.dataset.printPaper = paper;
  setState({ active: true, paper, target, frozen });
}

export function deactivatePrintScope() {
  removePageStyle();
  delete document.documentElement.dataset.printScope;
  delete document.documentElement.dataset.printPaper;
  setState({ active: false, paper: 'a4', target: null, frozen: false });
}

/**
 * Jalankan cetak untuk satu lembar: aktifkan scope, tunggu portal ter-render,
 * panggil window.print(), lalu bersih-bersih setelah dialog ditutup.
 */
export function printSheet(paper: PrintPaper, target: string, docTitle?: string) {
  if (typeof window === 'undefined') return;
  const previousTitle = document.title;
  activatePrintScope(paper, target);
  if (docTitle) document.title = docTitle;

  // Mode pengujian headless (?printFreeze): aktifkan scope tanpa memanggil
  // window.print() agar keadaan cetak dapat diambil page.pdf().
  if (new URLSearchParams(window.location.search).has('printFreeze')) return;

  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    deactivatePrintScope();
    document.title = previousTitle;
  };
  window.addEventListener('afterprint', cleanup);

  // Beri kesempatan React merender portal blok cetak sebelum dialog print dibuka.
  window.setTimeout(() => window.print(), 60);
}

/**
 * Aktivasi scope dari URL — dipakai untuk pengujian headless dan deep-link,
 * mis. ?printTarget=ups-plotter&printPaper=a3. Tanpa window.print().
 */
export function freezePrintScopeFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const target = params.get('printTarget');
  const paper = (params.get('printPaper') ?? 'a4') as PrintPaper;
  if (!target || !PAPER_LANDSCAPE_MM[paper]) return;
  activatePrintScope(paper, target, true);
}

/** Snapshot store untuk useSyncExternalStore (aman SSR). */
export function usePrintScope(targetId: string): PrintScopeState | null {
  const scope = useSyncExternalStore(
    printScopeStore.subscribe,
    printScopeStore.get,
    () => ({ active: false, paper: 'a4' as PrintPaper, target: null, frozen: false }),
  );
  return scope.active && scope.target === targetId ? scope : null;
}

/** Dimensi konten kertas (mm) setelah margin @page 8 mm di tiap sisi. */
export function paperContentMm(paper: PrintPaper): [number, number] {
  const [w, h] = PAPER_LANDSCAPE_MM[paper];
  return [w - 16, h - 16];
}
