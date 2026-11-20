'use client';

import React from 'react';
import { useTableRef, type TableRefRequest } from './TableRefContext';
import { cn } from '@/lib/utils';

interface TableRefTextProps {
  /** Rujukan tabel appendix — klik teks keterangan → dialog Manual SAR AUS
   *  terbuka tepat pada halaman PDF tabel yang dirujuk (sel/baris terkait
   *  diberi efek blinking bila rowKey/colKey dikirim). */
  request: Omit<TableRefRequest, 'currentValue' | 'currentValueLabel' | 'tableValueLabel'> & {
    currentValue?: number | null;
    currentValueLabel?: string;
    tableValueLabel?: string;
  };
  /** Teks keterangan yang tampil (mis. "Table I-1/I-2", "Figure I-12"). */
  children: React.ReactNode;
  className?: string;
  /** Nonaktifkan klik (mis. saat readOnly / salinan cetak). */
  disabled?: boolean;
  title?: string;
}

/**
 * Teks keterangan rujukan tabel appendix pada worksheet (mis. "… dari Table I-7
 * bersama winds", "POD — Figure I-12") yang BISA DIKLIK: dialog Manual SAR AUS
 * terbuka langsung pada tabel dirujuk (lompatan halaman PDF) dan sel/baris yang
 * sedang dipakai worksheet diberi efek blinking. Gaya tampil seperti tautan
 * halus (garis putus-putus) agar keterangan tetap terbaca sebagai teks worksheet.
 */
export default function TableRefText({ request, children, className, disabled, title }: TableRefTextProps) {
  const openTableRef = useTableRef();
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    openTableRef({
      ...request,
      currentValue: request.currentValue ?? null,
    } as TableRefRequest);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={title ?? `Buka ${request.tableId} pada Appendix (Manual SAR AUS)`}
      className={cn(
        'inline-flex items-baseline gap-0.5 rounded-sm px-0.5 -mx-0.5 underline decoration-dotted underline-offset-2',
        'font-semibold text-emerald-700 hover:text-emerald-600 hover:bg-emerald-50 transition-colors',
        'cursor-pointer',
        disabled && 'cursor-default text-slate-400 decoration-slate-300 hover:bg-transparent hover:text-slate-400',
        className,
      )}
    >
      {children}
    </button>
  );
}
