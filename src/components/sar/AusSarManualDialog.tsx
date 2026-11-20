'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, FileText, Table2, Crosshair, PencilLine, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  MANUAL_TABLES,
  manualTableCell,
  manualTablePage,
  manualTableRows,
  type ManualDocId,
  type ManualTableDef,
  type ManualTableRow,
} from '@/lib/sar/manualTables';
import type { TableRefRequest } from './TableRefContext';

/**
 * Penampil Australian SAR Manual (National Search and Rescue Manual — AMSA)
 * beserta appendixnya, sebagai referensi pengambilan nilai worksheet:
 * - Combined SAR Manual   : manual lengkap (234 halaman)
 * - Appendix I (AL1/04)   : Tables and Graphs — leeway (I-1/I-2), sweep width
 *                           (I-3/I-4 kapal, I-5 fixed wing, I-6 helikopter),
 *                           Fw cuaca (I-7), Fs kecepatan (I-8), darat (I-9/I-10),
 *                           Figure I-1 (wind current) & I-12 (POD)
 * - Appendix J            : Probable Errors of Position — Table J-1 (fix error,
 *                           GPS 0.1 NM), J-2 (area praktis), J-3 (dead reckoning)
 * - Appendix K (AL2/04)   : Worksheets — lembar kerja perhitungan SAR
 *
 * Panel verifikasi: bila dibuka dari klik nilai worksheet (TableValue), dialog
 * menampilkan tabel appendix versi HTML dengan sel NILAI YANG DIPILIH PADA
 * TABEL RUJUKAN diberi efek blinking (bukan nilai di worksheet) agar planner
 * bisa memeriksa kebenaran nilai, dan bisa langsung mengubah
 * nilai (override) — worksheet terkait otomatis dihitung ulang.
 */

const R2_BASE = 'https://pub-d8c83cfa4b484c65bc116392ce0fc1a0.r2.dev/SAR-Calc/AUS_SAR';

interface ManualDoc {
  id: string;
  label: string;
  file: string;
  title: string;
  detail: string;
}

const MANUAL_DOCS: ManualDoc[] = [
  {
    id: 'combined',
    label: 'Combined SAR Manual',
    file: 'Combined_SAR_Manual.pdf',
    title: 'National Search and Rescue Manual (AMSA — Australian National SAR Council)',
    detail: 'Manual lengkap (234 halaman): prosedur perencanaan pencarian, datum, search area, dsb.',
  },
  {
    id: 'appendix-i',
    label: 'Appendix I (AL1)',
    file: 'Appendix_I_al1.pdf',
    title: 'APPENDIX I — Tables and Graphs',
    detail: 'Table I-1/I-2 leeway · I-3/I-4 Wu kapal · I-5 Wu fixed wing · I-6 Wu helikopter · I-7 Fw cuaca · I-8 Fs kecepatan · I-9/I-10 darat · Figure I-1 wind current & I-12 POD.',
  },
  {
    id: 'appendix-j',
    label: 'Appendix J',
    file: 'Appendix_J.pdf',
    title: 'APPENDIX J — Probable Errors of Position',
    detail: 'Table J-1 fix error navigasi (GPS 0.1 NM) · J-2 fix error area praktis · J-3 dead reckoning (DR) — untuk x (distress craft) & y (search craft).',
  },
  {
    id: 'appendix-k',
    label: 'Appendix K (AL2)',
    file: 'Appendix_K_al2.pdf',
    title: 'APPENDIX K — Worksheets',
    detail: 'Lembar kerja perhitungan SAR (Worksheet 1: Coastal Search Planning, dst.) — contoh pengisian langkah demi langkah.',
  },
];

/** Rujukan tabel per worksheet — sesuai keterangan rujukan pada tiap worksheet aplikasi. */
const WORKSHEET_REFS: { ws: string; refs: string; docIds: string[] }[] = [
  {
    ws: 'WS 1 — Datum & Search Area (Ao)',
    refs: 'Table I-1/I-2 (leeway) · Figure I-1 (wind current) · Table J-1/J-2 (fix error x & y) · Figure I-12 (POD)',
    docIds: ['appendix-i', 'appendix-j'],
  },
  {
    ws: 'WS 2 — Maritime (pesawat udara)',
    refs: 'Table I-5 (1)/(2) (Wu fixed wing) · Table I-7 (Fw cuaca) · Table I-8 (Fs kecepatan) · Figure I-12 (POD)',
    docIds: ['appendix-i'],
  },
  {
    ws: 'WS 8 — Maritime (kapal)',
    refs: 'Table I-3/I-4 (Wu kapal & perahu) · Table I-7 (Fw cuaca) · Figure I-12 (POD)',
    docIds: ['appendix-i'],
  },
  {
    ws: 'WS 3 — Land (darat)',
    refs: 'Table I-9 (Wu visual darat) · Table I-10 (faktor vegetasi & terrain) · Figure I-12 (POD)',
    docIds: ['appendix-i'],
  },
  {
    ws: 'WS 4 — Radius kemungkinan per titik rute',
    refs: 'Table J-1/J-2/J-3 (fix error x₀ per posisi & y navigasi)',
    docIds: ['appendix-j'],
  },
  {
    ws: 'Datum Worksheet (marine K-13)',
    refs: 'Table I-1/I-2 (leeway) · Figure I-1 (wind current) · Table J-1 (fix error x & y)',
    docIds: ['appendix-i', 'appendix-j'],
  },
];

interface AusSarManualDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dokumen yang dipilih saat dialog dibuka (mis. 'appendix-i' untuk Table I-1/I-2 leeway dari Worksheet 1). */
  initialDocId?: string;
  /** Rujukan verifikasi nilai dari klik nilai worksheet (TableValue) — blink hanya pada sel tabel rujukan. */
  initialRef?: TableRefRequest | null;
}

export default function AusSarManualDialog({ open, onOpenChange, initialDocId, initialRef }: AusSarManualDialogProps) {
  const [selectedDocId, setSelectedDocId] = useState<string>('combined');
  const [overrideInput, setOverrideInput] = useState<string>('');
  // Nilai yang baru diterapkan ke worksheet (dari klik sel tabel / tombol
  // Terapkan) — badge umpan balik bahwa nilai bisa terus diubah.
  const [appliedValue, setAppliedValue] = useState<string | null>(null);
  // Sel/baris terakhir yang DIKLIK planner pada tabel rujukan — efek blinking
  // PINDAH ke sini menggantikan sel rujukan awal, sehingga nilai yang baru
  // diklik langsung terlihat sebagai nilai terpakai (bukan blink di sel lama).
  const [selectedCell, setSelectedCell] = useState<{ rowKey: string; colKey: string } | null>(null);
  const [panelHidden, setPanelHidden] = useState(false);
  // Rujukan dari worksheet (mis. tombol "Lihat Table I-1/I-2" Worksheet 1):
  // saat dialog dibuka dengan initialDocId yang dikenal, langsung tampilkan
  // dokumen yang dirujuk; bila tidak, pilihan sebelumnya tetap berlaku.
  useEffect(() => {
    if (open && initialDocId && MANUAL_DOCS.some((doc) => doc.id === initialDocId)) {
      setSelectedDocId(initialDocId);
    }
  }, [open, initialDocId]);

  // Sinkronkan input override + status panel tiap rujukan baru masuk.
  useEffect(() => {
    if (open && initialRef) {
      setOverrideInput(initialRef.currentValue !== null ? String(initialRef.currentValue) : '');
      setAppliedValue(null);
      setSelectedCell(null);
      setPanelHidden(false);
    }
  }, [open, initialRef]);

  const selectedDoc = MANUAL_DOCS.find((doc) => doc.id === selectedDocId) ?? MANUAL_DOCS[0];

  // Lompatan halaman PDF (#page=N) bila dialog dibuka dari klik nilai worksheet.
  const refForDoc = open && initialRef && initialRef.docId === selectedDocId ? initialRef : null;
  const def: ManualTableDef | undefined = refForDoc ? MANUAL_TABLES[refForDoc.tableId] : undefined;
  const pdfPage = useMemo(() => {
    if (!refForDoc || !def) return null;
    return manualTablePage(def, refForDoc.groupKey) || refForDoc.page;
  }, [refForDoc, def]);
  const selectedUrl = refForDoc && pdfPage
    ? `${R2_BASE}/${selectedDoc.file}#page=${pdfPage}`
    : `${R2_BASE}/${selectedDoc.file}`;

  const activeRef = refForDoc && def ? refForDoc : null;

  // Sel yang dipilih pada tabel rujukan (satu-satunya yang blink) + label nilainya.
  // Blink mengikuti sel TERAKHIR yang diklik planner (selectedCell); sebelum ada
  // klik, blink tetap pada sel rujukan awal dari worksheet.
  const cellValue = activeRef ? manualTableCell(def as ManualTableDef, activeRef.rowKey, activeRef.colKey, activeRef.groupKey) : undefined;
  const rows = activeRef ? manualTableRows(def as ManualTableDef, activeRef.groupKey) : [];
  // Link rujukan murni (keterangan tabel yang diklik) tanpa nilai worksheet —
  // panel menampilkan tabel blink TANPA kotak "Nilai terpakai di worksheet".
  const hasRefValue = activeRef !== null && (activeRef.currentValue !== null || !!activeRef.currentValueLabel);
  const blinkRowKey = selectedCell?.rowKey ?? activeRef?.rowKey;
  const blinkColKey = selectedCell?.colKey ?? activeRef?.colKey;
  // Indeks baris blink dihitung per tabel (renderRefTable) karena mode stacked
  // menampilkan beberapa tabel sekaligus; yang global hanya indeks KOLOM.
  const colIndex = blinkColKey && def ? def.colKeys.indexOf(blinkColKey) : -1;
  const groupLabel = activeRef && def?.groups
    ? def.groups.find((g) => g.key === activeRef.groupKey)?.label
    : undefined;

  const handleApplyOverride = () => {
    if (!activeRef?.applyOverride) return;
    const parsed = Number(overrideInput.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    activeRef.applyOverride(parsed);
    setAppliedValue(overrideInput.replace(',', '.'));
  };

  /** Klik sel/baris pada tabel rujukan → nilai LANGSUNG dipakai worksheet
   *  (mode per sel: angka; mode per baris: kunci baris — kategori leeway /
   *  alat navigasi). Blinking pindah ke sel yang diklik dan nilai di worksheet
   *  tetap bisa diubah (klik sel lain, input override, atau Reset). */
  const handleApplyCell = (rowKey: string, colKey: string, raw: unknown) => {
    if (!activeRef?.allowOverride || !activeRef?.applyOverride) return;
    const text = String(raw ?? '').trim();
    if (!text || text === '—') return;
    if (activeRef.applyRowKey) {
      // Mode per baris: sel mana pun pada baris menerapkan baris tersebut.
      activeRef.applyOverride(Number.NaN, rowKey);
      setAppliedValue(text);
    } else {
      const parsed = Number(text.replace(',', '.'));
      if (!Number.isFinite(parsed)) return;
      activeRef.applyOverride(parsed, rowKey);
      setOverrideInput(String(parsed));
      setAppliedValue(text);
    }
    // Efek blinking pindah ke sel yang baru diklik (menggantikan yang lama).
    setSelectedCell({ rowKey, colKey });
  };

  // Mode STACKED (tabel pilihan kategori, mis. leeway Table I-1 + sub-tabel
  // I-2): SEMUA sub-tabel ditampilkan berjajar lengkap sesuai manual — daftar
  // baris tiap tabel persis halaman PDF-nya (termasuk judul seksi kategori
  // seperti "Survival Craft — Aviation Life Rafts"). Baris blink muncul pada
  // tabel yang memuat kategori aktif; klik baris di tabel mana pun menerapkan
  // kategori tersebut.
  const stackedGroups = activeRef && def?.stackGroups && def.groups ? def.groups : null;

  const renderRefTable = (groupRows: ManualTableRow[], groupPage?: number, groupTitle?: string, groupLabelHeader?: string) => {
    if (!def || !activeRef) return null;
    const gRowIndex = blinkRowKey ? groupRows.findIndex((r) => r.key === blinkRowKey) : -1;
    // Kolom label baris: selalu tampil untuk tabel multi-kolom, dan untuk tabel
    // SATU kolom nilai (J-1/J-2/J-3) bila def.rowLabelHeader diisi — tanpa ini
    // label alat navigasi (GPS, Radar, …) hilang dan tabel tampak kosong label.
    const showLabelCol = def.columns.length > 1 || !!def.rowLabelHeader;
    const labelHeader = def.columns.length > 1
      ? (def.id === 'I-7' ? 'Weather: winds (kt) atau seas (m)' : 'Search object')
      : (groupLabelHeader ?? def.rowLabelHeader);
    // Mode per BARIS (kategori leeway I-1/I-2, alat navigasi J-1/J-2): klik pada
    // LABEL baris juga menerapkan baris tersebut — blink tetap di sel nilai.
    const rowModeClickable = !!activeRef.allowOverride && !!activeRef.applyOverride && !!activeRef.applyRowKey;
    return (
      <div key={`grp-${groupTitle ?? 'main'}`}>
        {groupTitle && (
          <div className="mb-1 mt-1.5 flex flex-wrap items-center gap-2 first:mt-0">
            <span className="text-[11px] font-bold text-slate-700">{groupTitle}</span>
            {groupPage && <span className="text-[10px] text-slate-400">(PDF hal. {groupPage})</span>}
          </div>
        )}
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              {showLabelCol && (
                <th className="border border-slate-300 bg-slate-100 px-2 py-1 text-left font-bold text-slate-700 w-[38%]">
                  {labelHeader}
                </th>
              )}
              {def.columns.map((col, ci) => (
                <th
                  key={def.colKeys[ci]}
                  className={cn(
                    'border border-slate-300 px-2 py-1 text-center font-bold text-slate-700',
                    ci === colIndex && 'ref-col-hl',
                  )}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupRows.map((row, ri) => {
              // Baris judul seksi (kategori manual) — full-width, bukan nilai.
              if (row.header) {
                return (
                  <tr key={row.key} className="bg-slate-200/80">
                    <td
                      colSpan={def.columns.length + 1}
                      className="border border-slate-300 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600"
                    >
                      {row.label}
                    </td>
                  </tr>
                );
              }
              return (
                <tr key={row.key} className={cn(ri === gRowIndex && 'ref-row-hl')}>
                  {showLabelCol && (
                    <td
                      onClick={rowModeClickable ? () => handleApplyCell(row.key, def.colKeys[0], row.cells[0] ?? '') : undefined}
                      title={rowModeClickable
                        ? `Klik untuk pakai baris ini (${row.label}) di worksheet — nilai tetap bisa diubah`
                        : undefined}
                      className={cn(
                        'border border-slate-300 px-2 py-1 text-slate-700',
                        rowModeClickable && 'cursor-pointer hover:bg-amber-100 transition-colors',
                      )}
                    >
                      {row.label}
                    </td>
                  )}
                  {row.cells.map((cell, ci) => {
                    const isSelected = ri === gRowIndex && ci === colIndex;
                    const cellText = String(cell ?? '').trim();
                    const cellNum = Number(cellText.replace(',', '.'));
                    const clickable = activeRef.allowOverride && !!activeRef.applyOverride
                      && cellText !== '' && cellText !== '—' && Number.isFinite(cellNum);
                    return (
                      <td
                        key={`${row.key}-${def.colKeys[ci]}`}
                        onClick={clickable ? () => handleApplyCell(row.key, def.colKeys[ci], cellText) : undefined}
                        title={clickable
                          ? (activeRef.applyRowKey
                            ? `Klik untuk pakai baris ini (${row.label}) di worksheet — nilai tetap bisa diubah`
                            : `Klik untuk pakai nilai ${cellText} di worksheet — tetap bisa diubah`)
                          : undefined}
                        className={cn(
                          'border border-slate-300 px-2 py-1 text-center font-mono',
                          clickable && 'cursor-pointer hover:bg-amber-100 transition-colors',
                          // Blinking HANYA pada sel tabel rujukan — animasi 3x
                          // lalu berhenti (menetap sebagai sorotan kuning).
                          isSelected && 'ref-cell-blink',
                        )}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1200px]! w-[95vw]! h-[88vh]! p-4 gap-3 grid grid-rows-[auto_1fr] overflow-hidden">
        <DialogHeader className="space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-emerald-600" /> Manual SAR Australia (AUS SAR) — Referensi Tabel Worksheet
          </DialogTitle>
          <DialogDescription className="text-xs">
            National Search and Rescue Manual (AMSA) + Appendix I/J/K. Keterangan tiap worksheet aplikasi merujuk tabel di bawah — pilih dokumen untuk membacanya.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col md:flex-row gap-3 min-h-0">
          {/* Panel kiri: daftar dokumen + rujukan tabel per worksheet */}
          <div className="md:w-80 shrink-0 flex flex-col gap-3 overflow-y-auto md:pr-1">
            <div className="space-y-1.5">
              {MANUAL_DOCS.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => setSelectedDocId(doc.id)}
                  className={cn(
                    'w-full text-left rounded-lg border px-3 py-2 transition-colors',
                    doc.id === selectedDocId
                      ? 'border-emerald-400 bg-emerald-50'
                      : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40',
                  )}
                >
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                    <FileText className={cn('h-3.5 w-3.5', doc.id === selectedDocId ? 'text-emerald-600' : 'text-slate-400')} />
                    {doc.label}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{doc.detail}</div>
                </button>
              ))}
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                <Table2 className="h-3.5 w-3.5 text-blue-700" /> Rujukan tabel per worksheet
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {WORKSHEET_REFS.map((ref) => (
                  <li key={ref.ws} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                    <div className="text-[11px] font-bold text-slate-800">{ref.ws}</div>
                    <div className="text-[10px] leading-relaxed text-slate-600">{ref.refs}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ref.docIds.map((docId) => {
                        const doc = MANUAL_DOCS.find((d) => d.id === docId);
                        if (!doc) return null;
                        return (
                          <button
                            key={docId}
                            type="button"
                            onClick={() => setSelectedDocId(docId)}
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 transition-colors"
                          >
                            buka {doc.label}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Panel kanan: verifikasi nilai + penampil PDF */}
          <div className="flex-1 min-h-[45vh] md:min-h-0 flex flex-col gap-2 min-w-0">
            {/* PANEL VERIFIKASI NILAI — muncul bila dialog dibuka dari klik nilai worksheet */}
            {activeRef && def && !panelHidden && (
              <div className="rounded-lg border-2 border-amber-300 bg-amber-50/60 overflow-hidden shrink-0 max-h-[45%] flex flex-col">
                <div className="flex items-center justify-between gap-2 bg-amber-400/80 px-3 py-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-950 truncate">
                    <Crosshair className="h-3.5 w-3.5 shrink-0" />
                    Verifikasi nilai — {activeRef.sourceLabel}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPanelHidden(true)}
                    className="text-[10px] font-bold bg-white/80 hover:bg-white text-amber-900 px-2 py-0.5 rounded border border-amber-300 shrink-0"
                  >
                    sembunyikan panel
                  </button>
                </div>
                <div className="overflow-auto p-2.5 space-y-2 text-xs">
                  <div className="font-bold text-slate-800 leading-snug">
                    {groupLabel ? `${groupLabel} — ` : ''}{def.title}
                    <span className="ml-2 font-normal text-slate-500">(PDF hal. {pdfPage})</span>
                  </div>

                  {def.figure ? (
                    <div className="rounded border border-amber-300 bg-white p-2.5">
                      <div className="text-[11px] text-slate-700">{def.note}</div>
                      {hasRefValue && (
                        <div className="mt-2 flex items-center gap-3">
                          <span className="text-slate-600">Nilai terpakai di worksheet:</span>
                          <span className="font-mono font-bold text-blue-900">
                            {activeRef.currentValueLabel ?? String(activeRef.currentValue)}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {activeRef.tableId === 'FIG-I-12' ? 'POD dari C (coverage) — dihitung otomatis, tidak bisa dioverride.' : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : stackedGroups ? (
                    // Tabel pilihan kategori (leeway I-1/I-2): KEDUA tabel
                    // manual ditampilkan berjajar lengkap — Table I-1 dengan
                    // judul seksi kategori (incl. Aviation Life Rafts) +
                    // sub-tabel Table I-2 deep ballast.
                    <div className="space-y-1.5">
                      {stackedGroups.map((g) => renderRefTable(g.rows, g.page, g.label, g.rowLabelHeader))}
                    </div>
                  ) : (
                    renderRefTable(rows)
                  )}

                  {def.note && <div className="text-[10px] leading-relaxed text-slate-600">{def.note}</div>}

                  {/* Nilai terpakai + override (disembunyikan untuk link rujukan tanpa nilai) */}
                  {hasRefValue && (
                    <div className="rounded border border-amber-300 bg-white p-2 flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-slate-600 font-semibold">Nilai terpakai di worksheet:</span>
                      <span className="font-mono font-bold text-blue-900">
                        {activeRef.currentValueLabel ?? String(activeRef.currentValue)}
                      </span>
                      {cellValue !== undefined && cellValue !== '—' && (
                        <span className="text-[10px] text-slate-500">
                          (nilai tabel: <span className="font-mono font-bold">{cellValue}</span>
                          {activeRef.tableValueLabel && activeRef.tableValueLabel !== cellValue ? ` → dipakai: ${activeRef.tableValueLabel}` : ''})
                        </span>
                      )}

                      {appliedValue && (
                        <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded px-1.5 py-0.5">
                          ✓ diterapkan: <span className="font-mono">{appliedValue}</span> — tetap bisa diubah
                        </span>
                      )}

                      {activeRef.allowOverride && activeRef.applyOverride && (
                        <span className="flex items-center gap-1.5 ml-auto">
                          <PencilLine className="h-3.5 w-3.5 text-amber-700" />
                          <input
                            type="number"
                            step="any"
                            value={overrideInput}
                            onChange={(e) => setOverrideInput(e.target.value)}
                            className="w-24 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-mono text-right"
                            aria-label="Ubah nilai"
                          />
                          <button
                            type="button"
                            onClick={handleApplyOverride}
                            className="text-[10px] font-bold px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 text-white transition-colors"
                          >
                            Terapkan
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOverrideInput('');
                              setAppliedValue(null);
                              activeRef.applyOverride?.(0);
                            }}
                            title="Kembalikan ke nilai tabel appendix"
                            className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" /> Reset
                          </button>
                        </span>
                      )}
                    </div>
                  )}
                  {activeRef.allowOverride && (
                    <div className="text-[10px] text-slate-500">
                      Klik langsung nilai pada tabel di atas untuk memakainya, atau ubah angka lalu klik Terapkan — worksheet dan bagian terkait (W, S, C, POD, T) otomatis dihitung ulang. Nilai hasil klik tetap bisa diubah kapan saja. Reset mengembalikan nilai asli tabel.
                    </div>
                  )}
                  {!activeRef.allowOverride && (
                    <div className="text-[10px] text-slate-500">
                      Nilai ini hasil perhitungan atau diubah lewat selektor lain pada worksheet — tidak dioverride dari panel ini.
                    </div>
                  )}
                </div>
              </div>
            )}
            {activeRef && panelHidden && (
              <button
                type="button"
                onClick={() => setPanelHidden(false)}
                className="shrink-0 self-start text-[10px] font-bold px-2 py-1 rounded border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-colors"
              >
                tampilkan panel verifikasi ({activeRef.tableId})
              </button>
            )}

            <div className="flex-1 min-h-[30vh] flex flex-col rounded-lg border border-slate-300 overflow-hidden bg-slate-100">
              <div className="flex items-center justify-between gap-2 bg-slate-800 text-white px-3 py-1.5">
                <div className="text-[11px] font-bold truncate" title={selectedDoc.title}>
                  {selectedDoc.title}
                  {pdfPage ? <span className="ml-2 font-normal text-slate-300">hal. {pdfPage}</span> : null}
                </div>
                <a
                  href={selectedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] font-bold bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded transition-colors shrink-0"
                >
                  <ExternalLink className="h-3 w-3" /> Tab baru
                </a>
              </div>
              <iframe
                key={`${selectedDoc.id}-${pdfPage ?? 0}`}
                src={selectedUrl}
                title={selectedDoc.title}
                className="flex-1 w-full min-h-0 bg-white"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export type { ManualDocId };
