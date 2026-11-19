'use client';

import React from 'react';
import { useTableRef, type TableRefRequest } from './TableRefContext';
import { cn } from '@/lib/utils';

interface TableValueProps {
  /** Konteks rujukan tabel appendix (diteruskan ke dialog Manual SAR AUS). */
  request: Omit<TableRefRequest, 'currentValue' | 'currentValueLabel' | 'tableValueLabel'> & {
    currentValue?: number | null;
    currentValueLabel?: string;
    tableValueLabel?: string;
  };
  /** Tampilan nilai (default: currentValue sesuai format worksheet). */
  children?: React.ReactNode;
  className?: string;
  /** Nonaktifkan klik (mis. saat readOnly). */
  disabled?: boolean;
  title?: string;
}

/**
 * Nilai worksheet yang bersumber dari tabel appendix — bisa diklik untuk
 * membuka dialog Manual SAR AUS tepat pada tabel/sel dirujuk. EFEK BLINKING
 * HANYA pada sel tabel rujukan di dialog — nilai di worksheet tampil polos
 * seperti angka lembar kerja biasa (tanpa garis/flash), cukup pointer +
 * tooltip penanda klik. */
export default function TableValue({ request, children, className, disabled, title }: TableValueProps) {
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
      title={title ?? `Klik untuk cek rujukan ${request.tableId} di Appendix & ubah nilai`}
      className={cn(
        'group/refval relative inline-flex items-baseline justify-center rounded-sm px-1 -mx-1',
        'cursor-pointer',
        disabled && 'cursor-default',
        className,
      )}
    >
      {children}
    </button>
  );
}
