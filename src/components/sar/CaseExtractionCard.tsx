'use client';

/**
 * CASE EXTRACTION CARD (Fase 3 AI Copilot) — panel pratinjau PER-FIELD hasil
 * `/api/ai/parse-case`, menggantikan pratinjau tool-by-tool untuk alur
 * "soal kasus → Ekstrak → Konfirmasi → Terapkan → Hitung → Review".
 *
 * Kontrak (rencana Fase 0 §5 + keputusan no.6 & 10):
 * - Tiap field menampilkan: nilai, status (OK / DIASUMSIKAN / HILANG), dan
 *   sumber di soal (kutipan) — nilai UNVERIFIED/MISSING TIDAK dianggap resmi.
 * - Field HILANG wajib ditindaklanjuti SEBELUM penerapan: diisi pengguna
 *   (divalidasi + di-merge ke kasus oleh parent) ATAU disetujui sebagai
 *   asumsi ("lengkapi manual di worksheet"). Tombol apply mati selama ada
 *   yang belum ditindaklanjuti.
 * - Dua mode penerapan: "Otomatis penuh" (satu batch terkonfirmasi) atau
 *   "Konfirmasi tiap langkah" (satu batch per blok worksheet).
 * - Penerapan TIDAK menulis state sendiri: parent menerapkan payload tiap
 *   langkah lewat handler apply halaman yang SAMA (satu mekanisme update).
 * - Setelah diterapkan: tombol "Hitung & Review dengan AI" (run_pipeline +
 *   validate_plan oleh tool server; AI hanya memberi catatan).
 */

import React, { useMemo, useState } from 'react';
import {
  Check,
  ClipboardList,
  HelpCircle,
  Loader2,
  Play,
  TriangleAlert,
} from 'lucide-react';
import type {
  CaseApplyStep,
  CaseApplyPlan,
  ExtractionFieldRow,
  FieldRowStatus,
} from '@/lib/ai/parseCase';

export interface CaseExtractionData {
  caseTitle?: string;
  incidentType?: string;
  /** Versi kasus yang sudah termasuk koreksi pengguna (path→nilai). */
  fieldRows: ExtractionFieldRow[];
  applyPlan: CaseApplyPlan;
  completeness: { complete: boolean; missingCount: number; assumedCount: number };
  assumptions: Array<{ field: string; value?: string; reason: string }>;
  model?: string;
  attempts?: number;
  warnings?: string[];
}

export interface CaseExtractionCardProps {
  data: CaseExtractionData;
  /** Mode penerapan: 'full' = satu batch semua langkah; 'step' = per blok. */
  mode: 'full' | 'step';
  onModeChange: (mode: 'full' | 'step') => void;
  /** Id langkah yang sudah diterapkan (lintas klik). */
  appliedStepIds: string[];
  appliedAll: boolean;
  /** Field HILANG yang sudah disetujui sebagai asumsi (path). */
  approvedMissingPaths: string[];
  /** Path yang sedang gagal validasi (path → pesan error). */
  fieldErrors: Record<string, string>;
  busyStepId: string | null;
  reviewRequested: boolean;
  onApplyAll: () => void;
  onApplyStep: (step: CaseApplyStep) => void;
  onFieldValue: (field: string, rawValue: string) => void;
  onApproveMissing: (field: string) => void;
  onRunReview: () => void;
}

const STATUS_BADGE: Record<FieldRowStatus, { label: string; className: string }> = {
  OK: { label: 'OK', className: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  DIASUMSIKAN: { label: 'DIASUMSIKAN', className: 'bg-amber-100 text-amber-800 border-amber-300' },
  HILANG: { label: 'HILANG', className: 'bg-rose-100 text-rose-800 border-rose-300' },
};

/** Grup baris pratinjau per blok worksheet (urutan stabil). */
function groupByWorksheet(rows: ExtractionFieldRow[]): Array<{ worksheet: string; rows: ExtractionFieldRow[] }> {
  const groups = new Map<string, ExtractionFieldRow[]>();
  for (const row of rows) {
    const list = groups.get(row.worksheet);
    if (list) list.push(row);
    else groups.set(row.worksheet, [row]);
  }
  return [...groups.entries()].map(([worksheet, groupRows]) => ({ worksheet, rows: groupRows }));
}

export default function CaseExtractionCard({
  data,
  mode,
  onModeChange,
  appliedStepIds,
  appliedAll,
  approvedMissingPaths,
  fieldErrors,
  busyStepId,
  reviewRequested,
  onApplyAll,
  onApplyStep,
  onFieldValue,
  onApproveMissing,
  onRunReview,
}: CaseExtractionCardProps) {
  const [showAllFields, setShowAllFields] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const groups = useMemo(() => groupByWorksheet(data.fieldRows), [data.fieldRows]);
  const missingRows = useMemo(
    () => data.fieldRows.filter((row) => row.status === 'HILANG'),
    [data.fieldRows],
  );
  // Field HILANG yang belum ditindaklanjuti → blokir penerapan (keputusan no.6).
  const blockingMissing = useMemo(
    () => missingRows.filter((row) => !approvedMissingPaths.includes(row.field)),
    [missingRows, approvedMissingPaths],
  );
  const canApply = blockingMissing.length === 0 && data.applyPlan.steps.length > 0;
  const statusCount = useMemo(() => {
    const count = { OK: 0, DIASUMSIKAN: 0, HILANG: 0 } as Record<FieldRowStatus, number>;
    for (const row of data.fieldRows) count[row.status] += 1;
    return count;
  }, [data.fieldRows]);

  const pendingSteps = data.applyPlan.steps.filter((step) => !appliedStepIds.includes(step.id));
  const allStepsApplied = data.applyPlan.steps.length > 0 && pendingSteps.length === 0;

  return (
    <div className="mt-2 rounded-lg border border-emerald-300 bg-white/95 text-slate-900 shadow-xs">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-emerald-100">
        <ClipboardList className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold truncate">
            Hasil ekstraksi soal kasus{data.caseTitle ? ` — ${data.caseTitle}` : ''}
          </p>
          <p className="text-[10px] text-slate-500">
            {data.model ? `Model ${data.model}` : ''}
            {data.model && data.attempts ? ' · ' : ''}
            {data.attempts ? `${data.attempts} percobaan` : ''}
            {statusCount.OK ? ` · ${statusCount.OK} field ok` : ''}
            {statusCount.DIASUMSIKAN ? ` · ${statusCount.DIASUMSIKAN} diasumsikan` : ''}
            {statusCount.HILANG ? ` · ${statusCount.HILANG} hilang` : ''}
          </p>
        </div>
      </div>

      {/* Peringatan ekstraksi */}
      {(data.warnings?.length ?? 0) > 0 && (
        <div className="px-2.5 pt-2 space-y-1">
          {data.warnings!.map((warning, idx) => (
            <p key={idx} className="text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-1.5 py-1">⚠ {warning}</p>
          ))}
        </div>
      )}

      {/* Field HILANG wajib ditindaklanjuti sebelum apply */}
      {missingRows.length > 0 && (
        <div className="mx-2.5 mt-2 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 py-2 space-y-2">
          <p className="text-[11px] font-bold text-rose-800 flex items-center gap-1.5">
            <HelpCircle className="h-3.5 w-3.5" />
            Data hilang — isi nilainya atau setujui sebagai asumsi ({blockingMissing.length} belum ditindaklanjuti)
          </p>
          {missingRows.map((row) => {
            const approved = approvedMissingPaths.includes(row.field);
            const error = fieldErrors[row.field];
            return (
              <div key={row.field} className="rounded border border-rose-200 bg-white px-2 py-1.5 space-y-1">
                <p className="text-[10px] font-mono text-slate-600 truncate" title={row.field}>{row.field}</p>
                {row.source && <p className="text-[10px] text-slate-500 leading-snug">{row.source}</p>}
                {approved ? (
                  <p className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 inline-block">
                    Disetujui sebagai asumsi — lengkapi manual di worksheet
                  </p>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <input
                      value={drafts[row.field] ?? ''}
                      onChange={(event) => setDrafts((prev) => ({ ...prev, [row.field]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && (drafts[row.field] ?? '').trim()) {
                          onFieldValue(row.field, drafts[row.field]);
                        }
                      }}
                      placeholder="isi nilai (mis. 06°52'46&quot;S, 12 kts, 19 November 2026 07.00 WIB)"
                      className="flex-1 min-w-0 text-[11px] border border-slate-300 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                    />
                    <button
                      type="button"
                      disabled={!(drafts[row.field] ?? '').trim() || busyStepId !== null}
                      onClick={() => onFieldValue(row.field, drafts[row.field] ?? '')}
                      className="shrink-0 text-[10px] font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 rounded px-2 py-1"
                      title="Simpan nilai ke kasus lalu hitung ulang rencana penerapan"
                    >
                      Isi
                    </button>
                    <button
                      type="button"
                      disabled={busyStepId !== null}
                      onClick={() => onApproveMissing(row.field)}
                      className="shrink-0 text-[10px] font-bold text-amber-800 bg-white border border-amber-300 hover:bg-amber-50 rounded px-2 py-1"
                      title="Lanjut tanpa nilai ini — field disetujui sebagai asumsi (tetap diisi manual di worksheet)"
                    >
                      Setujui sebagai asumsi
                    </button>
                  </div>
                )}
                {error && <p className="text-[10px] text-rose-700">{error}</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* Toggle mode penerapan */}
      {!appliedAll && (
        <div className="mx-2.5 mt-2 flex items-center gap-1 text-[10px] font-semibold">
          <span className="text-slate-600">Mode penerapan:</span>
          <button
            type="button"
            onClick={() => onModeChange('full')}
            className={`rounded px-1.5 py-0.5 border ${mode === 'full' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
          >
            Otomatis penuh
          </button>
          <button
            type="button"
            onClick={() => onModeChange('step')}
            className={`rounded px-1.5 py-0.5 border ${mode === 'step' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
          >
            Konfirmasi tiap langkah
          </button>
        </div>
      )}

      {/* Tabel per-field dikelompokkan per blok worksheet */}
      <div className="px-2.5 py-2">
        <button
          type="button"
          onClick={() => setShowAllFields((value) => !value)}
          className="text-[10px] font-semibold text-emerald-700 hover:underline"
        >
          {showAllFields ? '▲ Sembunyikan rincian field' : `▼ Rincian field (${data.fieldRows.length})`}
        </button>
        {showAllFields && (
          <div className="mt-1.5 space-y-2 max-h-72 overflow-y-auto pr-1">
            {groups.map((group) => (
              <div key={group.worksheet} className="rounded border border-slate-200 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wide bg-slate-50 text-slate-600 px-2 py-1 border-b border-slate-200">
                  {group.worksheet}
                </p>
                <div className="divide-y divide-slate-100">
                  {group.rows.map((row) => {
                    const badge = STATUS_BADGE[row.status];
                    return (
                      <div key={`${row.worksheet}:${row.field}`} className="px-2 py-1.5 flex items-start gap-1.5">
                        <span className={`shrink-0 text-[9px] font-bold border rounded px-1 py-0.5 ${badge.className}`}>
                          {badge.label}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-mono text-slate-600 truncate" title={row.field}>{row.field}</p>
                          {row.value && <p className="text-[11px] text-slate-900 font-semibold">{row.value}</p>}
                          {row.source && <p className="text-[10px] text-slate-500 leading-snug" title={row.source}>{row.source}</p>}
                          {fieldErrors[row.field] && row.status !== 'HILANG' && (
                            <p className="text-[10px] text-rose-700">{fieldErrors[row.field]}</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Langkah penerapan */}
      {!appliedAll && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {mode === 'full' ? (
            <button
              type="button"
              disabled={!canApply || busyStepId !== null}
              onClick={onApplyAll}
              className="w-full text-[11px] bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold py-1.5 rounded-md flex items-center justify-center gap-1.5 shadow-sm transition-colors"
              title={blockingMissing.length > 0 ? 'Lengkapi/setujui data hilang terlebih dahulu' : 'Terapkan seluruh langkah sebagai SATU batch (bisa di-Undo)'}
            >
              {busyStepId === 'all' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Konfirmasi &amp; Terapkan Semua ({data.applyPlan.steps.length} langkah)
            </button>
          ) : (
            <div className="space-y-1.5">
              {data.applyPlan.steps.map((step) => {
                const applied = appliedStepIds.includes(step.id);
                return (
                  <button
                    key={step.id}
                    type="button"
                    disabled={applied || !canApply || busyStepId !== null}
                    onClick={() => onApplyStep(step)}
                    className={`w-full text-[11px] font-bold py-1.5 rounded-md flex items-center justify-center gap-1.5 border transition-colors ${
                      applied
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-white hover:bg-emerald-50 text-slate-800 border-slate-300 disabled:bg-slate-100 disabled:text-slate-400'
                    }`}
                  >
                    {applied ? <Check className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    {applied ? `✓ ${step.label} (diterapkan)` : step.label}
                  </button>
                );
              })}
            </div>
          )}
          {blockingMissing.length > 0 && (
            <p className="text-[10px] text-rose-700 flex items-start gap-1">
              <TriangleAlert className="h-3 w-3 mt-0.5 shrink-0" />
              Penerapan terkunci: {blockingMissing.length} field hilang belum diisi/disetujui.
            </p>
          )}
          {data.applyPlan.skipped.length > 0 && (
            <div className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
              <p className="text-[10px] font-bold text-slate-600">Tidak dibuat otomatis:</p>
              <ul className="mt-0.5 space-y-0.5">
                {data.applyPlan.skipped.map((entry, idx) => (
                  <li key={idx} className="text-[10px] text-slate-600 leading-snug">• {entry.reason}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Setelah diterapkan → Hitung & Review */}
      {(allStepsApplied || appliedAll) && (
        <div className="px-2.5 pb-2.5 space-y-2">
          <div className="text-[11px] text-emerald-800 font-bold text-center py-1 bg-emerald-50 rounded">
            ✅ {appliedAll ? 'Seluruh langkah' : `${appliedStepIds.length}/${data.applyPlan.steps.length} langkah`} diterapkan ke worksheet (bisa di-Undo per batch)
          </div>
          {!reviewRequested ? (
            <button
              type="button"
              disabled={busyStepId !== null}
              onClick={onRunReview}
              className="w-full text-[11px] bg-blue-600 hover:bg-blue-500 disabled:bg-slate-300 text-white font-bold py-1.5 rounded-md flex items-center justify-center gap-1.5 shadow-sm transition-colors"
              title="Jalankan run_pipeline + validate_plan (engine resmi), lalu AI mereview hasil tanpa mengubah angka"
            >
              <Play className="h-3.5 w-3.5" /> Hitung &amp; Review dengan AI
            </button>
          ) : (
            <p className="text-[10px] text-slate-500 text-center">
              Review diminta — lihat jawaban &amp; hasil tool aplikasi di pesan berikutnya.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
