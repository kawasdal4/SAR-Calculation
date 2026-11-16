'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Grid, Clock, Plane, Ship } from 'lucide-react';

interface Worksheet6Props {
  initialSweepWidth?: number;
  initialCoverage?: number;
  readOnly?: boolean;
}

export default function Worksheet6({
  initialSweepWidth = 2.0,
  initialCoverage = 1.0,
  readOnly = false,
}: Worksheet6Props) {
  const [pattern, setPattern] = useState<string>('PS'); // Parallel Track
  const [assetType, setAssetType] = useState<'air' | 'marine'>('air');
  const [W, setW] = useState<number>(initialSweepWidth);
  const [C, setC] = useState<number>(initialCoverage);

  // OSE & EST Inputs (sesuai format EST Formula_s.xlsx Basarnas)
  const [enduranceMins, setEnduranceMins] = useState<number>(240); // 4 jam
  const [tasKts, setTasKts] = useState<number>(150);
  const [searchSpeedKts, setSearchSpeedKts] = useState<number>(120);
  const [distGoNm, setDistGoNm] = useState<number>(45);
  const [distBackNm, setDistBackNm] = useState<number>(45);
  const [reserveMins, setReserveMins] = useState<number>(45);

  // Calculations
  const S_opt = W / Math.max(0.1, C);
  // Nearest assignable track spacing (e.g. rounded to 0.5 or 1 NM)
  const S_assign = Math.max(0.5, Math.round(S_opt * 2) / 2);

  const trGoMins = (distGoNm / Math.max(1, tasKts)) * 60;
  const trBackMins = (distBackNm / Math.max(1, tasKts)) * 60;
  const tsfMins = trGoMins + trBackMins + reserveMins;
  const estMins = Math.max(0, enduranceMins - tsfMins);
  const estHours = estMins / 60;

  // Search area capability A = Vsearch * S_assign * EST_hours
  const areaCapabilityNm2 = searchSpeedKts * S_assign * estHours;

  return (
    <Card className="border-slate-300 shadow-sm bg-white overflow-hidden text-slate-800">
      <CardHeader className="bg-slate-100 border-b border-slate-300 py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Grid className="h-5 w-5 text-cyan-700" />
            <div>
              <CardTitle className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                WORKSHEET 6 — TRACK SPACING, SEARCH AREA & EST (OSE)
              </CardTitle>
              <p className="text-[11px] text-slate-500 font-mono">
                Appendix L-16 & Formula Standar Basarnas
              </p>
            </div>
          </div>
          <span className="text-xs bg-cyan-100 text-cyan-800 font-bold px-2.5 py-1 rounded border border-cyan-300">
            Track Spacing (S): {S_assign.toFixed(1)} NM | EST: {estMins.toFixed(0)} Menit
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        <div className="overflow-x-auto border border-slate-300 rounded shadow-2xs">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-200/80 text-slate-700 font-semibold border-b border-slate-300">
                <th className="py-2 px-3 text-left w-1/4">Langkah Perhitungan</th>
                <th className="py-2 px-3 text-left w-1/3">Deskripsi & Rumus</th>
                <th className="py-2 px-3 text-left w-1/6">Satuan</th>
                <th className="py-2 px-3 text-right w-1/4">Hasil / Penetapan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
              {/* PART 1 */}
              <tr className="bg-slate-50 font-sans font-bold text-slate-900">
                <td colSpan={4} className="py-1.5 px-3 bg-cyan-50/60 text-cyan-950">
                  1. PENENTUAN POLA PENCARIAN & TRACK SPACING
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Pola Pencarian (Search Pattern)</td>
                <td className="py-1.5 px-3 text-slate-600">
                  {pattern === 'PS' && 'Parallel Track Search (PS) — pencarian jalur sejajar'}
                  {pattern === 'CS' && 'Creeping Line Search (CS) — menyusuri sumbu sempit'}
                  {pattern === 'SS' && 'Expanding Square Search (SS) — kotak membesar dari titik datum'}
                  {pattern === 'VS' && 'Sector Search (VS) — sektor lingkaran radial'}
                </td>
                <td className="py-1.5 px-3 text-slate-500">Pola</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{pattern} Pattern</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Sweep Width Terkoreksi (W)</td>
                <td className="py-1.5 px-3 text-slate-600">Lebar sapuan sensor/visual (Tabel N-4 s.d. N-6)</td>
                <td className="py-1.5 px-3 text-slate-500">NM</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{W.toFixed(1)} NM</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Coverage Factor Sasaran (C)</td>
                <td className="py-1.5 px-3 text-slate-600">Faktor liputan yang diinginkan (standar C = 1.0)</td>
                <td className="py-1.5 px-3 text-slate-500">Rasio</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{C.toFixed(2)}</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Optimal Track Spacing (S)</td>
                <td className="py-1.5 px-3 text-slate-600">S = W / C = {W.toFixed(1)} / {C.toFixed(2)}</td>
                <td className="py-1.5 px-3 text-slate-500">NM</td>
                <td className="py-1.5 px-3 text-right font-bold text-cyan-800">{S_opt.toFixed(2)} NM</td>
              </tr>
              <tr className="bg-cyan-50/40">
                <td className="py-2 px-3 font-sans text-slate-900 font-bold">Spasi Jalur Ditetapkan (Sa)</td>
                <td className="py-2 px-3 text-slate-700 font-sans">
                  Pembulatan ke nilai spasi yang bisa dinavigasikan oleh kru SRU
                </td>
                <td className="py-2 px-3 text-slate-600 font-bold">NM</td>
                <td className="py-2 px-3 text-right font-bold text-base text-cyan-900">
                  {S_assign.toFixed(1)} NM
                </td>
              </tr>

              {/* PART 2 */}
              <tr className="bg-slate-50 font-sans font-bold text-slate-900">
                <td colSpan={4} className="py-1.5 px-3 bg-cyan-50/60 text-cyan-950">
                  2. ON SCENE ENDURANCE (OSE) & EFFECTIVE SEARCH TIME (EST)
                </td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Total Endurance Aset (E)</td>
                <td className="py-1.5 px-3 text-slate-600">Ketahanan bahan bakar penuh di udara/laut</td>
                <td className="py-1.5 px-3 text-slate-500">Menit</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-900">{enduranceMins} Mins ({(enduranceMins / 60).toFixed(1)} Jam)</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Transit Berangkat (Tr Go)</td>
                <td className="py-1.5 px-3 text-slate-600">
                  (Jarak {distGoNm} NM / TAS {tasKts} kts) × 60
                </td>
                <td className="py-1.5 px-3 text-slate-500">Menit</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-800">{trGoMins.toFixed(1)} Mins</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Transit Kembali (Tr Back)</td>
                <td className="py-1.5 px-3 text-slate-600">
                  (Jarak {distBackNm} NM / TAS {tasKts} kts) × 60
                </td>
                <td className="py-1.5 px-3 text-slate-500">Menit</td>
                <td className="py-1.5 px-3 text-right font-bold text-slate-800">{trBackMins.toFixed(1)} Mins</td>
              </tr>
              <tr>
                <td className="py-1.5 px-3 font-sans text-slate-700 font-medium">Total Safety Fuel (TSF)</td>
                <td className="py-1.5 px-3 text-slate-600">
                  Tr Go ({trGoMins.toFixed(0)}) + Tr Back ({trBackMins.toFixed(0)}) + Cadangan ({reserveMins})
                </td>
                <td className="py-1.5 px-3 text-slate-500">Menit</td>
                <td className="py-1.5 px-3 text-right font-bold text-amber-800">{tsfMins.toFixed(1)} Mins</td>
              </tr>
              <tr className="bg-emerald-50/50">
                <td className="py-2 px-3 font-sans text-slate-900 font-bold">Effective Search Time (EST)</td>
                <td className="py-2 px-3 text-slate-700 font-sans">
                  EST = Endurance ({enduranceMins}) - TSF ({tsfMins.toFixed(0)})
                </td>
                <td className="py-2 px-3 text-slate-600 font-bold">Menit (Jam)</td>
                <td className="py-2 px-3 text-right font-bold text-base text-emerald-800">
                  {estMins.toFixed(0)} Mins ({estHours.toFixed(2)} Jam)
                </td>
              </tr>
              <tr className="bg-emerald-50/50">
                <td className="py-2 px-3 font-sans text-slate-900 font-bold">Kemampuan Luas Area (A)</td>
                <td className="py-2 px-3 text-slate-700 font-sans">
                  A = Kecepatan ({searchSpeedKts} kts) × Spasi ({S_assign} NM) × EST ({estHours.toFixed(2)} Jam)
                </td>
                <td className="py-2 px-3 text-slate-600 font-bold">NM²</td>
                <td className="py-2 px-3 text-right font-bold text-base text-emerald-800">
                  {areaCapabilityNm2.toFixed(1)} NM²
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
