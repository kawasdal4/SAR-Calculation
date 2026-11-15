'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Route, Calculator } from 'lucide-react';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';

interface Worksheet5Props {
  trackLengthNm?: number;
  E?: number;
  availableEffortZta?: number;
  readOnly?: boolean;
}

export default function Worksheet5({
  trackLengthNm = 60,
  E = 8.0,
  availableEffortZta = 320,
  readOnly = false,
}: Worksheet5Props) {
  const L = trackLengthNm;
  const fZ = 2 * E * L;
  const Zr = availableEffortZta / Math.max(1, fZ);
  const fs = 1.3;
  const Ro = fs * E; // Half-width
  const corridorWidth = 2 * Ro; // Total width
  const corridorLength = L + 2 * Ro; // Length with end buffers
  const Ao = corridorLength * corridorWidth;
  const C = availableEffortZta / Math.max(1, Ao);
  const POD = 1 - Math.exp(-C);

  return (
    <Card className="border-slate-300 shadow-sm bg-white overflow-hidden text-slate-800">
      <CardHeader className="bg-slate-100 border-b border-slate-300 py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Route className="h-5 w-5 text-teal-700" />
            <div>
              <CardTitle className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                WORKSHEET 5 — EFFORT ALLOCATION (LINE / TRACKLINE DATUM)
              </CardTitle>
              <p className="text-[11px] text-slate-500 font-mono">
                IAMSAR Manual Volume II Appendix L-13 (Alokasi Upaya Datum Garis / Rute Jalur)
              </p>
            </div>
          </div>
          <span className="text-xs bg-teal-100 text-teal-800 font-bold px-2.5 py-1 rounded border border-teal-300">
            Lebar Koridor (W): {corridorWidth.toFixed(1)} NM | Coverage: {C.toFixed(2)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        <div className="overflow-x-auto border border-slate-300 rounded shadow-2xs">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-200/80 text-slate-700 font-semibold border-b border-slate-300">
                <th className="py-2 px-3 text-left w-1/4">Parameter Garis</th>
                <th className="py-2 px-3 text-left w-1/3">Deskripsi & Rumus IAMSAR</th>
                <th className="py-2 px-3 text-left w-1/6">Satuan</th>
                <th className="py-2 px-3 text-right w-1/4">Nilai Perhitungan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
              <tr className="bg-slate-50 font-sans font-bold text-slate-900">
                <td colSpan={4} className="py-1.5 px-3 bg-teal-50/60 text-teal-950">
                  1. DATA JALUR RUTE & GALAT LATERAL (LINE DATUM)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Panjang Rute Jalur (L)</td>
                <td className="py-1.5 px-3 text-slate-600">Jarak rute lintasan antara titik keberangkatan dan tujuan</td>
                <td className="py-1.5 px-3 text-slate-500">NM</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{L.toFixed(1)} NM</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Lateral Probable Error (E)</td>
                <td className="py-1.5 px-3 text-slate-600">Galat lateral posisi dari jalur rute kapal/pesawat</td>
                <td className="py-1.5 px-3 text-slate-500">NM</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{E.toFixed(1)} NM</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Line Effort Factor (fZ)</td>
                <td className="py-1.5 px-3 text-slate-600">
                  fZ = 2 × E × L = 2 × {E.toFixed(1)} × {L.toFixed(1)}
                </td>
                <td className="py-1.5 px-3 text-slate-500">NM²</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-800">{fZ.toFixed(1)} NM²</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Relative Effort (Zr)</td>
                <td className="py-1.5 px-3 text-slate-600">
                  Zr = Zta / fZ = {availableEffortZta.toFixed(0)} / {fZ.toFixed(1)}
                </td>
                <td className="py-1.5 px-3 text-slate-500">Faktor</td>
                <td className="py-1.5 px-3 text-right font-bold text-teal-700">{Zr.toFixed(2)}</td>
              </tr>

              <tr className="bg-slate-50 font-sans font-bold text-slate-900">
                <td colSpan={4} className="py-1.5 px-3 bg-teal-50/60 text-teal-950">
                  2. DIMENSI KORIDOR PENCARIAN & CAKUPAN
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Half-Width Koridor (Ro)</td>
                <td className="py-1.5 px-3 text-slate-600">
                  Ro = fs × E = {fs} × {E.toFixed(1)} NM (jarak ke kiri & kanan rute)
                </td>
                <td className="py-1.5 px-3 text-slate-500">NM</td>
                <td className="py-1.5 px-3 text-right font-bold text-teal-800">{Ro.toFixed(1)} NM</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Total Lebar Koridor (W)</td>
                <td className="py-1.5 px-3 text-slate-600">W = 2 × Ro = 2 × {Ro.toFixed(1)} NM</td>
                <td className="py-1.5 px-3 text-slate-500">NM</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{corridorWidth.toFixed(1)} NM</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Total Panjang Koridor (L + 2Ro)</td>
                <td className="py-1.5 px-3 text-slate-600">Termasuk buffer ujung: {L.toFixed(1)} + {(2 * Ro).toFixed(1)}</td>
                <td className="py-1.5 px-3 text-slate-500">NM</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{corridorLength.toFixed(1)} NM</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Luas Area Pencarian (Ao)</td>
                <td className="py-1.5 px-3 text-slate-600">
                  Ao = Panjang × Lebar = {corridorLength.toFixed(1)} × {corridorWidth.toFixed(1)}
                </td>
                <td className="py-1.5 px-3 text-slate-500">NM²</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{Ao.toFixed(0)} NM²</td>
              </tr>
              <tr className="bg-teal-50/50">
                <td className="py-2 px-3 font-sans text-slate-900 font-bold">Coverage & POD</td>
                <td className="py-2 px-3 text-slate-700 font-sans">
                  C = Zta / Ao = {availableEffortZta} / {Ao.toFixed(0)} | POD kurva N-10
                </td>
                <td className="py-2 px-3 text-slate-600 font-bold">Rasio / %</td>
                <td className="py-2 px-3 text-right font-bold text-base text-teal-900">
                  C = {C.toFixed(2)} | POD = {(POD * 100).toFixed(0)}%
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
