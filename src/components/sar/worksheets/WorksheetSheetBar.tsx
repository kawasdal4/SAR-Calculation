'use client';

import { useState } from 'react';
import { Layers, Plus, X } from 'lucide-react';

/**
 * Satu lembar worksheet per-SRU: 1 alut/SRU = 1 lembar (Worksheet 2/3/8).
 * Contoh: kasus dengan 1 pesawat fixed wing + 1 helikopter untuk pencarian
 * di laut → Worksheet 2 berisi 2 lembar, satu per alut.
 */
export type WorksheetSheet<T> = {
  /** Kunci stabil lembar (dipakai untuk track-spacing record & mount key). */
  key: string;
  /** Nama tampil: nama alut/SRU, atau "SRU n" bila bebas/turunan kasus. */
  label: string;
  /** asset.id dari daftar aset bila lembar terikat ke alut tertentu; null bila bebas. */
  assetId: string | null;
  data: T;
};

type WorksheetSheetBarProps = {
  title: string;
  sheets: Array<{ key: string; label: string; bound: boolean }>;
  activeKey: string;
  /** SRU yang memenuhi syarat worksheet ini (udara → WS2/WS3, laut → WS8). */
  assets: Array<{ id: string; label: string }>;
  boundAssetIds: ReadonlyArray<string>;
  onSelect: (key: string) => void;
  onAddBlank: () => void;
  onAddAsset: (assetId: string) => void;
  onRemove: (key: string) => void;
};

/** Bar pilih lembar worksheet: chips per SRU + tambah lembar (kosong / dari daftar aset). */
export default function WorksheetSheetBar({ title, sheets, activeKey, assets, boundAssetIds, onSelect, onAddBlank, onAddAsset, onRemove }: WorksheetSheetBarProps) {
  const [adding, setAdding] = useState(false);
  const unboundAssets = assets.filter((asset) => !boundAssetIds.includes(asset.id));
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          <Layers className="h-3 w-3" />
          {title}
        </span>
        {sheets.map((sheet, index) => (
          <span
            key={sheet.key}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              sheet.key === activeKey ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-300 bg-slate-50 text-slate-600'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelect(sheet.key)}
              className="max-w-[160px] truncate"
              title={sheet.bound ? 'Lembar terikat ke SRU dari daftar aset' : 'Lembar turunan kasus / bebas'}
            >
              {sheet.label || `SRU ${index + 1}`}
            </button>
            {sheet.bound && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />}
            {sheets.length > 1 && (
              <button
                type="button"
                onClick={() => onRemove(sheet.key)}
                className="text-slate-400 hover:text-rose-600"
                aria-label={`Hapus lembar ${sheet.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-400 px-2 py-0.5 text-[11px] font-semibold text-slate-600 hover:border-emerald-600 hover:text-emerald-700"
        >
          <Plus className="h-3 w-3" />
          Tambah lembar
        </button>
      </div>
      {adding && (
        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
          <button
            type="button"
            onClick={() => { onAddBlank(); setAdding(false); }}
            className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:border-emerald-600"
          >
            Lembar kosong
          </button>
          {unboundAssets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              onClick={() => { onAddAsset(asset.id); setAdding(false); }}
              className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:border-emerald-600"
            >
              {asset.label}
            </button>
          ))}
          {unboundAssets.length === 0 && <span className="text-slate-400">Semua SRU di daftar aset sudah punya lembar.</span>}
        </div>
      )}
      <p className="mt-1 text-[10px] leading-snug text-slate-400">
        1 alut/SRU = 1 lembar worksheet. Pilih lembar di atas lalu isi datanya; Track Spacing tiap lembar
        dipakai otomatis untuk SRU yang sama di tab Search Pattern.
      </p>
    </div>
  );
}
