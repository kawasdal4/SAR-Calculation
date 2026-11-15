'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Layers, Plus, Trash2 } from 'lucide-react';

interface SubAreaRow {
  id: string;
  subAreaName: string;
  facilityName: string;
  areaNm2: number;
  sweepWidthNm: number;
  trackSpacingNm: number;
}

interface Worksheet7Props {
  readOnly?: boolean;
}

export default function Worksheet7({ readOnly = false }: Worksheet7Props) {
  const [rows, setRows] = useState<SubAreaRow[]>([
    {
      id: '1',
      subAreaName: 'A-1',
      facilityName: 'KN SAR Yudistira (Maritime)',
      areaNm2: 120,
      sweepWidthNm: 1.5,
      trackSpacingNm: 1.5,
    },
    {
      id: '2',
      subAreaName: 'A-2',
      facilityName: 'Heli Dauphin HR-3601 (Air)',
      areaNm2: 180,
      sweepWidthNm: 2.5,
      trackSpacingNm: 2.0,
    },
    {
      id: '3',
      subAreaName: 'A-3',
      facilityName: 'RIB 01 Kansar (Maritime)',
      areaNm2: 60,
      sweepWidthNm: 1.0,
      trackSpacingNm: 1.0,
    },
  ]);

  const addRow = () => {
    const nextIdx = rows.length + 1;
    setRows([
      ...rows,
      {
        id: String(Date.now()),
        subAreaName: `A-${nextIdx}`,
        facilityName: `SRU ${nextIdx}`,
        areaNm2: 100,
        sweepWidthNm: 2.0,
        trackSpacingNm: 2.0,
      },
    ]);
  };

  const removeRow = (id: string) => {
    if (rows.length <= 1) return;
    setRows(rows.filter((r) => r.id !== id));
  };

  const updateRow = (id: string, field: keyof SubAreaRow, val: any) => {
    setRows(
      rows.map((r) => (r.id === id ? { ...r, [field]: val } : r))
    );
  };

  // Calculations
  const calculatedRows = rows.map((r) => {
    const C = r.sweepWidthNm / Math.max(0.1, r.trackSpacingNm);
    const POD = 1 - Math.exp(-C);
    return {
      ...r,
      C,
      POD,
    };
  });

  const totalArea = calculatedRows.reduce((acc, r) => acc + r.areaNm2, 0);
  const weightedCoverage =
    totalArea > 0
      ? calculatedRows.reduce((acc, r) => acc + r.areaNm2 * r.C, 0) / totalArea
      : 0;
  const compositePOD =
    totalArea > 0
      ? calculatedRows.reduce((acc, r) => acc + r.areaNm2 * r.POD, 0) / totalArea
      : 0;

  // Overlapping cumulative POD if all searched the same area
  const cumulativeOverlapPOD =
    1 - calculatedRows.reduce((acc, r) => acc * (1 - r.POD), 1);

  return (
    <Card className="border-slate-300 shadow-sm bg-white overflow-hidden text-slate-800">
      <CardHeader className="bg-slate-100 border-b border-slate-300 py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-indigo-700" />
            <div>
              <CardTitle className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                WORKSHEET 7 — COMPOSITE POD (PROBABILITY OF DETECTION GABUNGAN)
              </CardTitle>
              <p className="text-[11px] text-slate-500 font-mono">
                IAMSAR Manual Volume II Appendix L-20 (Evaluasi Hasil Pencarian Multi-Aset)
              </p>
            </div>
          </div>
          <span className="text-xs bg-indigo-100 text-indigo-800 font-bold px-2.5 py-1 rounded border border-indigo-300">
            Composite POD: {(compositePOD * 100).toFixed(1)}% | Luas Total: {totalArea.toFixed(0)} NM²
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        <div className="overflow-x-auto border border-slate-300 rounded shadow-2xs">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-200/80 text-slate-700 font-semibold border-b border-slate-300">
                <th className="py-2 px-3 text-left">Sub-Area</th>
                <th className="py-2 px-3 text-left">Nama Fasilitas / SRU</th>
                <th className="py-2 px-3 text-right">Luas (NM²)</th>
                <th className="py-2 px-3 text-right">Sweep Width W (NM)</th>
                <th className="py-2 px-3 text-right">Spasi S (NM)</th>
                <th className="py-2 px-3 text-right">Coverage (C=W/S)</th>
                <th className="py-2 px-3 text-right">POD Sub-Area</th>
                {!readOnly && <th className="py-2 px-3 text-center">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
              {calculatedRows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-1.5 px-3 font-sans font-bold text-slate-800">
                    {!readOnly ? (
                      <input
                        type="text"
                        value={r.subAreaName}
                        onChange={(e) => updateRow(r.id, 'subAreaName', e.target.value)}
                        className="w-16 bg-white border border-slate-300 rounded px-1.5 py-0.5 font-bold" suppressHydrationWarning
                      />
                    ) : (
                      r.subAreaName
                    )}
                  </td>
                  <td className="py-1.5 px-3 font-sans text-slate-700">
                    {!readOnly ? (
                      <input
                        type="text"
                        value={r.facilityName}
                        onChange={(e) => updateRow(r.id, 'facilityName', e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded px-1.5 py-0.5" suppressHydrationWarning
                      />
                    ) : (
                      r.facilityName
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {!readOnly ? (
                      <input
                        type="number"
                        value={r.areaNm2}
                        onChange={(e) =>
                          updateRow(r.id, 'areaNm2', parseFloat(e.target.value) || 0)
                        }
                        className="w-20 text-right bg-white border border-slate-300 rounded px-1.5 py-0.5" suppressHydrationWarning
                      />
                    ) : (
                      `${r.areaNm2} NM²`
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {!readOnly ? (
                      <input
                        type="number"
                        step="0.1"
                        value={r.sweepWidthNm}
                        onChange={(e) =>
                          updateRow(r.id, 'sweepWidthNm', parseFloat(e.target.value) || 0)
                        }
                        className="w-16 text-right bg-white border border-slate-300 rounded px-1.5 py-0.5" suppressHydrationWarning
                      />
                    ) : (
                      `${r.sweepWidthNm} NM`
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-right">
                    {!readOnly ? (
                      <input
                        type="number"
                        step="0.1"
                        value={r.trackSpacingNm}
                        onChange={(e) =>
                          updateRow(r.id, 'trackSpacingNm', parseFloat(e.target.value) || 0)
                        }
                        className="w-16 text-right bg-white border border-slate-300 rounded px-1.5 py-0.5" suppressHydrationWarning
                      />
                    ) : (
                      `${r.trackSpacingNm} NM`
                    )}
                  </td>
                  <td className="py-1.5 px-3 text-right font-bold text-blue-700">
                    {r.C.toFixed(2)}
                  </td>
                  <td className="py-1.5 px-3 text-right font-bold text-emerald-700">
                    {(r.POD * 100).toFixed(1)}%
                  </td>
                  {!readOnly && (
                    <td className="py-1.5 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => removeRow(r.id)}
                        className="text-slate-400 hover:text-rose-600 transition-colors"
                        title="Hapus baris"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}

              {/* Total & Composite Summary Row */}
              <tr className="bg-indigo-50/70 font-sans font-bold text-indigo-950 border-t-2 border-indigo-200">
                <td colSpan={2} className="py-2 px-3">
                  TOTAL / COMPOSITE OVERALL
                </td>
                <td className="py-2 px-3 text-right font-mono">{totalArea.toFixed(0)} NM²</td>
                <td colSpan={2} className="py-2 px-3 text-right font-sans text-slate-600 text-[10px]">
                  Rata-rata tertimbang
                </td>
                <td className="py-2 px-3 text-right font-mono text-blue-900">
                  {weightedCoverage.toFixed(2)}
                </td>
                <td className="py-2 px-3 text-right font-mono text-base text-emerald-800">
                  {(compositePOD * 100).toFixed(1)}%
                </td>
                {!readOnly && <td />}
              </tr>
            </tbody>
          </table>
        </div>

        {!readOnly && (
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={addRow}
              className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold border border-slate-300 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Tambah Sub-Area / SRU
            </button>
            <div className="text-[11px] text-slate-500 font-mono">
              Jika mencari area yang sama tumpang-tindih (Overlapping): Cumulative POD ={' '}
              <span className="font-bold text-emerald-700">
                {(cumulativeOverlapPOD * 100).toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
