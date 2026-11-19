'use client';

/**
 * REFERENCE CHOICE CARD (Fase E) — kartu interaktif pemilihan parameter dari
 * Appendix/Table resmi DI KOLOM CHAT (bukan memaksa pengguna pindah worksheet).
 *
 * Alur (Fase E.2–E.5 + arahan planner "AI yakin → langsung terapkan"):
 * 1. Kartu menampilkan rekomendasi AI (reference ID, label, deskripsi, sumber
 *    tabel, alasan) + tindakan: "Gunakan rekomendasi AI", "Pilih kategori
 *    lainnya", "Lihat sumber".
 * 2. **AUTO-APPLY**: bila `choice.autoApply` (AI yakin dari analisis soal),
 *    kartu langsung menerapkan rekomendasi ke worksheet SEKALI saat muncul —
 *    lewat handler apply resmi (set_fields satu batch → change-log + Undo).
 *    Planner tetap bisa mengganti: "Pilih kategori lainnya" → klik → terapkan.
 * 3. Bila tidak yakin (needsUserDecision) → alur konfirmasi klik dulu.
 * Reusable: payload dari tool server `request_reference_choice` ATAU lampiran
 * parse-case (registry REFERENCE_CHOICE_FIELDS) — bukan khusus leeway.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, HelpCircle, ListTree, Zap } from 'lucide-react';
import type { ReferenceChoicePayload } from '@/lib/ai/tools/referenceChoice';

export interface ReferenceSelectionResult {
  fieldPath: string;
  worksheet: string;
  referenceId: string;
  label: string;
  /** 'ai' = menerima rekomendasi AI; 'manual' = memilih dari daftar. */
  selectedBy: 'ai' | 'manual';
  /** Sumber tabel untuk audit (mis. 'I-1/I-2'). */
  sourceTable: string;
  /** True bila penerapan otomatis (AI yakin) — untuk catatan change-log. */
  autoApplied?: boolean;
}

interface ReferenceChoiceCardProps {
  choice: ReferenceChoicePayload;
  busy: boolean;
  /** Dipanggil SETELAH pengguna mengonfirmasi (klik akhir) ATAU saat
   *  auto-apply rekomendasi yang yakin (AI confident). */
  onConfirm: (result: ReferenceSelectionResult) => void;
  onReject?: () => void;
}

export default function ReferenceChoiceCard({ choice, busy, onConfirm, onReject }: ReferenceChoiceCardProps) {
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [selected, setSelected] = useState<{ referenceId: string; label: string; selectedBy: 'ai' | 'manual' } | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [query, setQuery] = useState('');
  // Auto-apply SEKALI per mount: AI yakin → langsung terapkan rekomendasi
  // (arahan planner). Guard ref mencegah double-apply saat re-render.
  const autoApplyRef = useRef(false);
  useEffect(() => {
    if (autoApplyRef.current) return;
    if (choice.autoApply && choice.recommendation && !busy) {
      autoApplyRef.current = true;
      onConfirm({
        fieldPath: choice.fieldPath,
        worksheet: choice.worksheet,
        referenceId: choice.recommendation.referenceId,
        label: choice.recommendation.label,
        selectedBy: 'ai',
        sourceTable: choice.sourceTable.refId,
        autoApplied: true,
      });
    }
  }, [choice, busy, onConfirm]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; label: string; description?: string }>>();
    for (const alt of choice.alternatives) {
      const key = alt.group ?? 'Lainnya';
      const list = groups.get(key) ?? [];
      list.push(alt);
      groups.set(key, list);
    }
    if (!query.trim()) return groups;
    const q = query.trim().toLowerCase();
    const filtered = new Map<string, Array<{ id: string; label: string; description?: string }>>();
    for (const [group, list] of groups) {
      const hit = list.filter((item) => item.label.toLowerCase().includes(q) || item.id.toLowerCase().includes(q));
      if (hit.length > 0) filtered.set(group, hit);
    }
    return filtered;
  }, [choice.alternatives, query]);

  const handleConfirm = (): void => {
    if (!selected || busy) return;
    onConfirm({
      fieldPath: choice.fieldPath,
      worksheet: choice.worksheet,
      referenceId: selected.referenceId,
      label: selected.label,
      selectedBy: selected.selectedBy,
      sourceTable: choice.sourceTable.refId,
    });
  };

  return (
    <div className="mt-2 rounded-lg border border-indigo-300 bg-white/95 text-slate-900 shadow-xs">
      {/* Header */}
      <div className="flex items-start gap-1.5 px-2.5 py-2 border-b border-indigo-100">
        <ListTree className="h-3.5 w-3.5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold leading-snug">{choice.question}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">
            Worksheet: {choice.consumerWorksheetLabel} · Sumber: {choice.sourceTable.label} ({choice.sourceTable.status})
          </p>
        </div>
      </div>

      {/* Rekomendasi AI */}
      {choice.recommendation && !selected && (
        <div className={`mx-2.5 mt-2 rounded-lg border px-2.5 py-2 space-y-1 ${
          choice.autoApply ? 'border-emerald-300 bg-emerald-50/70' : 'border-indigo-200 bg-indigo-50/70'
        }`}>
          <p className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${choice.autoApply ? 'text-emerald-900' : 'text-indigo-900'}`}>
            {choice.autoApply ? <Zap className="h-3 w-3" /> : null}
            {choice.autoApply
              ? 'Rekomendasi AI — SUDAH diterapkan otomatis ke worksheet (bisa diganti/Undo)'
              : 'Rekomendasi AI — menunggu konfirmasi'}
          </p>
          <p className={`text-[11px] font-semibold ${choice.autoApply ? 'text-emerald-950' : 'text-indigo-950'}`}>{choice.recommendation.label}</p>
          <p className="text-[10px] font-mono text-slate-600">referenceId: {choice.recommendation.referenceId}</p>
          <p className="text-[10px] text-slate-700 leading-snug">{choice.recommendation.description}</p>
          <p className="text-[10px] text-slate-600 leading-snug"><span className="font-semibold">Alasan:</span> {choice.recommendation.reason}</p>
          <p className="text-[10px] text-indigo-700 font-medium">Sumber: Appendix/Table {choice.sourceTable.refId} — {choice.sourceTable.version}</p>
        </div>
      )}

      {/* Bila AI tidak cukup yakin */}
      {!choice.recommendation && !selected && (
        <div className="mx-2.5 mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-2 space-y-1">
          <p className="text-[10px] font-bold text-amber-900 flex items-center gap-1">
            <HelpCircle className="h-3 w-3" />
            Informasi kasus belum cukup untuk satu rekomendasi — silakan pilih dari daftar resmi.
          </p>
        </div>
      )}

      {/* Pilihan yang sudah dipilih (menunggu konfirmasi akhir) */}
      {selected && (
        <div className="mx-2.5 mt-2 rounded-lg border border-emerald-300 bg-emerald-50/70 px-2.5 py-2 space-y-1">
          <p className="text-[10px] font-bold text-emerald-900">Dipilih ({selected.selectedBy === 'ai' ? 'rekomendasi AI' : 'pilihan manual'}) — konfirmasi akhir:</p>
          <p className="text-[11px] font-semibold text-emerald-950">{selected.label}</p>
          <p className="text-[10px] font-mono text-slate-600">referenceId: {selected.referenceId} · {choice.fieldPath}</p>
        </div>
      )}

      {/* Daftar alternatif resmi */}
      {showAlternatives && (
        <div className="mx-2.5 mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 space-y-1.5 max-h-60 overflow-y-auto">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="cari kategori… (mis. raft, piw, kapal)"
            className="w-full text-[11px] border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          {[...grouped.entries()].map(([group, list]) => (
            <div key={group}>
              <p className="text-[9px] font-bold uppercase tracking-wide text-slate-500 mt-1">{group}</p>
              <div className="space-y-0.5">
                {list.map((alt) => (
                  <button
                    key={alt.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setSelected({ referenceId: alt.id, label: alt.label, selectedBy: 'manual' })}
                    className={`w-full text-left text-[10px] px-1.5 py-1 rounded border transition-colors ${
                      selected?.referenceId === alt.id
                        ? 'bg-emerald-100 border-emerald-300 text-emerald-900'
                        : 'bg-white border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 text-slate-800'
                    }`}
                    title={alt.description ?? alt.label}
                  >
                    <span className="font-semibold">{alt.label}</span>
                    <span className="ml-1 text-[9px] font-mono text-slate-500">({alt.id})</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sumber Appendix/Table */}
      {showSource && (
        <div className="mx-2.5 mt-2 rounded border border-slate-200 bg-white px-2 py-1.5">
          <p className="text-[10px] text-slate-700 leading-snug">
            {choice.sourceTable.label} ({choice.sourceTable.refId}) — status {choice.sourceTable.status}. {choice.sourceTable.source}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">{choice.sourceTable.version}</p>
        </div>
      )}

      {/* Tindakan */}
      <div className="px-2.5 py-2 flex flex-wrap items-center gap-1.5">
        {choice.recommendation && !selected && !choice.autoApply && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setSelected({ referenceId: choice.recommendation!.referenceId, label: choice.recommendation!.label, selectedBy: 'ai' })}
            className="text-[10px] font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 rounded px-2 py-1"
          >
            Gunakan rekomendasi AI
          </button>
        )}
        {!showAlternatives && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { setShowAlternatives(true); setShowSource(false); }}
            className="text-[10px] font-bold text-slate-800 bg-white border border-slate-300 hover:bg-slate-50 rounded px-2 py-1"
          >
            Pilih kategori lainnya
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => { setShowSource((value) => !value); setShowAlternatives(false); }}
          className="text-[10px] font-bold text-slate-600 bg-white border border-slate-300 hover:bg-slate-50 rounded px-2 py-1 inline-flex items-center gap-1"
        >
          <BookOpen className="h-3 w-3" />
          Lihat sumber Appendix/Table
        </button>
        {selected && (
          <button
            type="button"
            disabled={busy}
            onClick={handleConfirm}
            className="text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 rounded px-2 py-1 inline-flex items-center gap-1"
            title="Terapkan referenceId ke worksheet lewat set_fields (tercatat di change-log, bisa di-Undo)"
          >
            <Check className="h-3 w-3" />
            Konfirmasi &amp; Terapkan ke {choice.consumerWorksheetLabel}
          </button>
        )}
        {onReject && (
          <button
            type="button"
            disabled={busy}
            onClick={onReject}
            className="text-[10px] font-semibold text-slate-500 hover:text-slate-700 rounded px-1.5 py-1"
          >
            Batal
          </button>
        )}
      </div>
    </div>
  );
}
