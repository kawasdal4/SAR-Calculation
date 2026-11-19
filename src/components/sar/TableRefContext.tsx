'use client';

import { createContext, useContext } from 'react';
import type { ManualDocId } from '@/lib/sar/manualTables';

/**
 * Permintaan verifikasi nilai: klik nilai pada worksheet yang bersumber dari
 * appendix/table → dialog Manual SAR AUS terbuka pada dokumen + halaman PDF
 * yang dirujuk, sel tabel yang dirujuk diberi efek blinking, dan (bila
 * diizinkan) planner bisa mengubah nilai → worksheet terkait otomatis
 * dihitung ulang lewat callback `applyOverride`.
 */
export interface TableRefRequest {
  docId: ManualDocId;
  /** Halaman PDF tempat tabel/figure berada (dipakai untuk lompatan #page=). */
  page: number;
  tableId: string;
  /** Sub-tabel (mis. ketinggian '1000' pada Table I-5/I-6/I-9). */
  groupKey?: string;
  rowKey?: string;
  colKey?: string;
  /** Asal klik (untuk keterangan panel), mis. 'Worksheet 2 — Fw'. */
  sourceLabel: string;
  /** Nilai yang sedang dipakai worksheet. */
  currentValue: number | null;
  /** Formatter tampilan nilai worksheet (mis. '0.50'). */
  currentValueLabel?: string;
  /** Terapkan nilai ubahan planner ke worksheet (0/undefined = kembali ke tabel).
   *  `rowKey` = kunci baris tabel tempat klik terjadi (mis. kategori leeway
   *  Table I-1/I-2 atau alat navigasi Table J-1) — dipakai mode per baris. */
  applyOverride?: (value: number, rowKey?: string) => void;
  /** Mode terapan per BARIS: klik sel mana pun pada baris tabel menerapkan
   *  baris tersebut (applyOverride menerima rowKey; value = NaN) — untuk tabel
   *  kategori (leeway I-1/I-2, fix error J-1/J-2) yang barisnya menentukan
   *  nilai worksheet, bukan sel per sel. */
  applyRowKey?: boolean;
  /** Nilai asli pada tabel appendix (bila berbeda dari nilai terpakai, mis. Wu PIW ×4). */
  tableValueLabel?: string;
  /** False untuk nilai hasil perhitungan (POD) atau yang diubah lewat selektor lain. */
  allowOverride?: boolean;
}

export type OpenTableRef = (request: TableRefRequest) => void;

export const TableRefContext = createContext<OpenTableRef>(() => {});

export function useTableRef(): OpenTableRef {
  return useContext(TableRefContext);
}
