'use client';

/**
 * Menu cetak lembar plotting: pilihan kertas A3/A4 Landscape + controller scope.
 * Semua lembar (UPS, Mobo, UPS Digital ADW) memakai komponen ini agar perilaku
 * cetak seragam: portal blok cetak ke <body>, @page dinamis, UI disembunyikan.
 */

import { useEffect, useState } from 'react';
import { Printer, ChevronDown } from 'lucide-react';
import { printSheet, PAPER_LANDSCAPE_MM, freezePrintScopeFromUrl, type PrintPaper } from '@/lib/sar/printSheets';

interface SheetPrintMenuProps {
  /** ID target scope, mis. 'ups-plotter' | 'adw-ups' | 'mobo-awa' | 'mobo-asw'. */
  targetId: string;
  /** Judul dokumen saat dialog cetak (menjadi nama file PDF). */
  docTitle?: string;
  className?: string;
}

export default function SheetPrintMenu({ targetId, docTitle, className = '' }: SheetPrintMenuProps) {
  const [open, setOpen] = useState(false);

  const run = (paper: PrintPaper) => {
    setOpen(false);
    printSheet(paper, targetId, docTitle ? `${docTitle} (${paper.toUpperCase()} Landscape)` : undefined);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Cetak lembar sebagai PDF vektor (A3/A4 Landscape)"
        className="flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium px-2.5 py-1.5 rounded shadow-2xs transition-colors"
      >
        <Printer className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Cetak lembar</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-slate-200 bg-white shadow-lg py-1">
            <p className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
              PDF vektor — pilih ukuran kertas
            </p>
            {(Object.keys(PAPER_LANDSCAPE_MM) as PrintPaper[]).map((paper) => {
              const [w, h] = PAPER_LANDSCAPE_MM[paper];
              return (
                <button
                  key={paper}
                  type="button"
                  onClick={() => run(paper)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-slate-800 hover:bg-slate-100"
                >
                  <span className="font-semibold uppercase">{paper} Landscape</span>
                  <span className="font-mono text-[10px] text-slate-500">
                    {w}×{h} mm
                  </span>
                </button>
              );
            })}
            <p className="px-3 py-1.5 text-[10px] leading-relaxed text-slate-500 border-t border-slate-100">
              Pada dialog cetak pilih <strong>Save as PDF</strong> dan margin <strong>Default</strong> —
              ukuran & orientasi sudah diatur otomatis via @page.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Dipasang sekali di page.tsx: mendukung aktivasi scope lewat URL untuk
 * pengujian headless / deep-link, mis. ?printTarget=ups-plotter&printPaper=a3
 */
export function PrintScopeController() {
  useEffect(() => {
    freezePrintScopeFromUrl();
  }, []);
  return null;
}
