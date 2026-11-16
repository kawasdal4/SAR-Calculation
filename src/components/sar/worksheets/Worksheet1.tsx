'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileSpreadsheet, Printer } from 'lucide-react';
import { type LatLng, distanceNm } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import type { DatumData, DatumResults } from '@/components/sar/DatumWorksheet';

interface Worksheet1Props {
  lkp: LatLng;
  datumData: DatumData | null;
  datumResults: DatumResults | null;
  aswDirFrom: number;
  aswSpeed: number;
  readOnly?: boolean;
  onAoChange?: (ao: number) => void;
  selectedFs?: number;
  onFsChange?: (fs: number) => void;
}

export default function Worksheet1({
  lkp,
  datumData,
  datumResults,
  aswDirFrom,
  aswSpeed,
  readOnly = false,
  onAoChange,
  selectedFs,
  onFsChange,
}: Worksheet1Props) {
  const [localFs, setLocalFs] = useState(1.1);
  const fsSelected = selectedFs ?? localFs;
  const [driftErrorPercent, setDriftErrorPercent] = useState(12.5);
  const [measuredDistances, setMeasuredDistances] = useState({ left: '', right: '', leftRight: '' });
  // Calculations & parameters with safe defaults
  const hours = datumData?.driftInterval ?? 0;
  const targetDesc = datumResults?.lw?.objectType?.label ?? '-';
  const lkpStr = `${formatDMS(lkp.lat, false)} - ${formatDMS(lkp.lng, true)}`;

  // Sea Current (SC)
  const scDir = datumData?.seaCurrent.dir ?? 0;
  const scSpeed = datumData?.seaCurrent.mag ?? 0;
  const scDist = scSpeed * hours;

  // Surface Wind (ASW)
  const windDir = aswSpeed > 0 ? aswDirFrom : 0;
  const windSpeed = aswSpeed;
  const windRecip = windSpeed > 0 ? (windDir + 180) % 360 : 0;

  // Wind Current (WC)
  const wcSpeed = datumResults?.wc?.wcDrift ?? 0;
  const wcDir = datumResults?.wc?.wcSet ?? windRecip;
  const wcDist = wcSpeed * hours;

  // Leeway (LW)
  const lwDivAngle = datumResults?.lw?.divergenceAngle ?? 0;
  const lwDirL = (windRecip - lwDivAngle + 360) % 360;
  const lwDirR = (windRecip + lwDivAngle) % 360;
  const lwMult = datumResults?.lw?.objectType?.leewayRate ?? 0;
  const lwMod = datumResults?.lw?.objectType?.leewayModifier ?? 0;
  const lwSpeed = datumResults?.lw?.leewaySpeed ?? 0;
  const lwDist = (datumResults?.lw?.leewaySpeed ?? lwSpeed) * hours;

  // Drift error (Worksheet 1): use optional map measurements, otherwise show analytical estimates.
  const estimatedDistL = datumResults ? distanceNm(lkp, datumResults.datumLeft) : 0;
  const estimatedDistR = datumResults ? distanceNm(lkp, datumResults.datumRight) : 0;
  const estimatedDistLR = datumResults ? distanceNm(datumResults.datumLeft, datumResults.datumRight) : 0;
  const numericOverride = (value: string, fallback: number) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  const distL = numericOverride(measuredDistances.left, estimatedDistL);
  const distR = numericOverride(measuredDistances.right, estimatedDistR);
  const distLR = numericOverride(measuredDistances.leftRight, estimatedDistLR);
  const deL = distL * driftErrorPercent / 100;
  const deR = distR * driftErrorPercent / 100;
  const De = datumResults ? (deL + deR + distLR) / 2 : 0;

  // Fix Error
  const distressCraftX = datumResults?.X ?? 0;
  const searchCraftY = datumResults?.Y ?? 0;

  // Total Errors (E)
  const E_squared = De * De + distressCraftX * distressCraftX + searchCraftY * searchCraftY;
  const E = Math.sqrt(E_squared);

  // Search Area
  const fsOptions = [1.1, 1.6, 2.0, 2.3, 2.5];
  const R_exact = E * fsSelected;
  const R_round = Math.ceil(R_exact);
  const Ao = 4 * R_round * R_round;

  const handlePrint = () => {
    window.print();
  };

  useEffect(() => { onAoChange?.(Ao); }, [Ao, onAoChange]);

  return (
    <Card className="border-slate-400 shadow-md bg-white overflow-hidden text-slate-900 print:shadow-none print:border-none">
      {/* Official Sheet Header */}
      <CardHeader className="bg-[#1e293b] text-white py-3 px-4 print:bg-white print:text-black print:border-b-2 print:border-black">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-6 w-6 text-emerald-400 print:hidden" />
            <div>
              <CardTitle className="text-base sm:text-lg font-black tracking-wide font-sans">
                WORKSHEET 1 MARITIME PLANNING (MARINE DATUM)
              </CardTitle>
              <p className="text-xs text-slate-300 font-mono print:text-slate-600">
                Form Diklat Basarnas / Appendix K
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded border border-slate-500 font-medium transition-colors"
            >
              <Printer className="h-3.5 w-3.5" /> Cetak Lembar Ini
            </button>
            <span className="text-xs bg-emerald-600/90 text-white font-bold px-3 py-1 rounded border border-emerald-400">
              Ao = {Ao.toLocaleString()} NM²
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6 overflow-x-auto">
        {/* Authentic Spreadsheet Form Container */}
        <div className="border-2 border-slate-800 rounded bg-white shadow-2xs font-sans text-xs">
          {/* Main Title Row */}
          <div className="bg-slate-800 text-white font-bold text-center py-2 text-sm tracking-wider uppercase border-b-2 border-slate-800">
            Worksheet 1 Maritime Planning
          </div>

          <table className="w-full border-collapse">
            <tbody>
              {/* SECTION: INCIDENT */}
              <tr className="bg-slate-200 border-t-2 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  INCIDENT
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 w-1/3 border-r border-slate-300">
                  Search target (description)
                </td>
                <td colSpan={3} className="py-2 px-3">
                  <span className="font-bold font-mono text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 inline-block ">
                    {targetDesc}
                  </span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  LKP (lat/long)
                </td>
                <td colSpan={3} className="py-2 px-3">
                  <span className="font-bold font-mono text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 inline-block ">
                    {lkpStr}
                  </span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  @ Time (UTC)
                </td>
                <td colSpan={3} className="py-2 px-3">
                  <span className="font-bold font-mono text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 inline-block ">
                    -
                  </span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Hours of drift (a)
                </td>
                <td colSpan={3} className="py-2 px-3">
                  <span className="font-bold font-mono text-blue-900 bg-blue-50/80 px-2.5 py-0.5 rounded border border-blue-200">
                    {hours}
                  </span>{' '}
                  <span className="text-slate-600 font-medium">hrs</span>
                </td>
              </tr>

              {/* SECTION: SEA CURRENT */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  SEA CURRENT
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Sea / tidal
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {scDir.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-2">
                    {scSpeed.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Sea current vector/ distance
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {scDir.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {scSpeed.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots ×</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {hours}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">(a) hrs =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-300 ml-1">
                    {scDist.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>

              {/* SECTION: SURFACE WIND and CALCULATION OF WIND CURRENT */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  SURFACE WIND and CALCULATION OF WIND CURRENT
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Surface winds/knots (dari ASW)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {windDir.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-2">
                    {windSpeed.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Reciprocal of Surface Winds/Knots (b)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {windRecip.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-2">
                    {windSpeed.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Wind current vector: (use reciprocal bearing and divergence) (Figure I-1)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {hours}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">(a) hours ×</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {wcSpeed.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots (Fig I-1) =</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {wcDir.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-300 ml-1">
                    {wcDist.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>

              {/* SECTION: TARGET LEEWAY */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  TARGET LEEWAY
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Leeway angles (divergence) (Table I-1 or I.2)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">Reciprocal Surface Wind (b)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {windRecip.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T) ±</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {lwDivAngle.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Leeway vector: (LW)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans font-bold">LW (L) -</span>{' '}
                  <span className="font-bold text-red-900 bg-red-50 px-2 py-0.5 rounded border border-red-200 ml-1">
                    {lwDirL.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="text-slate-600 font-sans font-bold ml-4">LW ( R ) +</span>{' '}
                  <span className="font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 ml-1">
                    {lwDirR.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Leeway speed: (knots) = (Multiplier × Wind Speed) ± Modifier
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">[</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200">
                    {lwMult.toFixed(3)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">Multiplier ×</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200">
                    {windSpeed.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">Wind Speed =</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200">
                    {(lwMult * windSpeed).toFixed(3)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">] ±</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200">
                    {lwMod.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">Modifier =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                    {lwSpeed.toFixed(3)} kts
                  </span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Leeway distance:
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">Leeway speed</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {lwSpeed.toFixed(3)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">× (a)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {hours}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">hrs =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-300">
                    {lwDist.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>

              {/* SECTION: DRIFT ERROR */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  DRIFT ERROR
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Distance (L/R), ukur di peta atau pakai estimasi
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">L:</span>{' '}
                  <input aria-label="Pengukuran jarak drift kiri dari peta NM" type="number" min="0" step="0.1" value={measuredDistances.left} onChange={(event) => setMeasuredDistances((current) => ({ ...current, left: event.target.value }))} disabled={readOnly} placeholder={estimatedDistL.toFixed(1)} className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs" />{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {distL.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm |</span>{' '}
                  <span className="text-slate-600 font-sans ml-2">R:</span>{' '}
                  <input aria-label="Pengukuran jarak drift kanan dari peta NM" type="number" min="0" step="0.1" value={measuredDistances.right} onChange={(event) => setMeasuredDistances((current) => ({ ...current, right: event.target.value }))} disabled={readOnly} placeholder={estimatedDistR.toFixed(1)} className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs" />{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {distR.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                  <div className="mt-1 text-[10px] text-slate-500">Kosong = estimasi analitik dari posisi Datum; isi untuk mengganti dengan hasil ukur skala lintang.</div>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">Persentase drift error (de)</td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <input aria-label="Persentase drift error" type="number" min="12.5" max="33" step="0.5" value={driftErrorPercent} onChange={(event) => setDriftErrorPercent(Math.min(33, Math.max(12.5, Number(event.target.value) || 12.5)))} disabled={readOnly} className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-xs" />{' '}
                  <span className="text-[10px] text-slate-500">% (12.5–33, ikuti instruksi kasus; contoh panduan: 12.5%)</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  de (L) & de ( R ) (12.5% to 33% of Distance)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">de (L):</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {deL.toFixed(4)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm |</span>{' '}
                  <span className="text-slate-600 font-sans ml-2">de ( R ):</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {deR.toFixed(4)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Distance L/R & Total Drift Error (De)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">Jarak L/R:</span>{' '}
                  <input aria-label="Pengukuran jarak antara datum kiri dan kanan NM" type="number" min="0" step="0.1" value={measuredDistances.leftRight} onChange={(event) => setMeasuredDistances((current) => ({ ...current, leftRight: event.target.value }))} disabled={readOnly} placeholder={estimatedDistLR.toFixed(1)} className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs" />{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {distLR.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm |</span>{' '}
                  <span className="text-slate-600 font-sans ml-2">De = [de(L) + de(R) + Distance L/R] / 2 =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-300">
                    {De.toFixed(4)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>

              {/* SECTION: FIX ERROR */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  FIX ERROR
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Distress craft error (x): Worksheet Datum / Table J
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {distressCraftX.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Search craft error (y): Worksheet Datum / Table J
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {searchCraftY.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>

              {/* SECTION: TOTAL ERRORS (E) */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  TOTAL ERRORS (E)
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700 bg-slate-50/50">
                <td className="py-2.5 px-3 font-bold text-slate-800 border-r border-slate-300">
                  Total problem error (E): E = √(De² + x² + y²)
                </td>
                <td colSpan={3} className="py-2.5 px-3 font-mono">
                  <span className="text-slate-600 font-sans">E² =</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {E_squared.toFixed(4)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans font-bold ml-2">⟹ E =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-100 text-sm px-3 py-1 rounded border border-emerald-400">
                    {E.toFixed(2)} NM
                  </span>
                </td>
              </tr>

              {/* SECTION: SEARCH AREA */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  SEARCH AREA
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Safety factor (circle) (fs)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <div className="flex flex-wrap items-center gap-2">
                    {fsOptions.map((opt) => (
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => { setLocalFs(opt); onFsChange?.(opt); }}
                        key={opt}
                        aria-pressed={opt === fsSelected}
                        className={`px-2.5 py-0.5 rounded border text-xs disabled:cursor-not-allowed ${
                          opt === fsSelected
                            ? 'bg-blue-600 text-white font-bold border-blue-700 shadow-2xs'
                            : 'bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                    <span className="text-slate-500 font-sans text-[11px] ml-2">Safety factor pencarian ke-{fsOptions.indexOf(fsSelected) + 1}; pilih sesuai skenario.</span>
                  </div>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Search radius (E × fs)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {R_exact.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">NM</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Search radius rounded up to whole figure:
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2.5 py-0.5 rounded border border-blue-200 text-xs">
                    {R_round}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">NM (Radius R)</span>
                </td>
              </tr>
              <tr className="bg-emerald-50/50">
                <td className="py-3 px-3 font-bold text-emerald-950 border-r border-slate-300 text-sm">
                  Search Area (Ao = (2R)²)
                </td>
                <td colSpan={3} className="py-3 px-3 font-mono">
                  <span className="text-slate-700 font-sans">(2 × {R_round})² =</span>{' '}
                  <span className="font-black text-emerald-900 bg-emerald-100 text-base px-3.5 py-1 rounded border-2 border-emerald-500 shadow-2xs">
                    {Ao.toLocaleString()} NM²
                  </span>
                  <span className="text-slate-600 font-sans text-[11px] ml-3 italic">
                    (Nilai Ao ini diteruskan ke Worksheet 2, 8, dan Alokasi Aset)
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
