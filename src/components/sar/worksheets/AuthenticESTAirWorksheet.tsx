'use client';

import React, { useState } from 'react';
import { type SruAssetInput } from '@/lib/sar/assetAllocation';
import { type LatLng, distanceNm } from '@/lib/sar/sarCalculations';

interface AuthenticESTAirWorksheetProps {
  asset: SruAssetInput;
  csp: LatLng;
  exitPoint: LatLng;
  onUpdateAsset?: <K extends keyof SruAssetInput>(field: K, val: SruAssetInput[K]) => void;
  readOnly?: boolean;
}

export default function AuthenticESTAirWorksheet({
  asset,
  csp,
  exitPoint,
  onUpdateAsset,
  readOnly = false,
}: AuthenticESTAirWorksheetProps) {
  // Engine type state (piston vs turbin vs helicopter)
  const [engineType, setEngineType] = useState<'piston' | 'turbine' | 'helicopter'>('piston');
  // TAF Weather state (cerah 0' vs inter 30' vs tempo 60')
  const [tafCondition, setTafCondition] = useState<'cerah' | 'inter' | 'tempo'>('cerah');

  // Transit distances
  const sGoNm = Number(distanceNm(asset.homeBasePos, csp).toFixed(1));
  const sBackNm = Number(distanceNm(exitPoint, asset.homeBasePos).toFixed(1));

  const enduranceMins = asset.enduranceHours * 60;
  const vTas = asset.transitSpeedKts;
  const vSearch = asset.searchSpeedKts;
  const spacingS = asset.sweepWidthNm;

  // Transit calculations
  const trGoMins = Number(((sGoNm / vTas) * 60).toFixed(2));
  const trBackMins = Number(((sBackNm / vTas) * 60).toFixed(2));
  const totalTrMins = Number((trGoMins + trBackMins).toFixed(2));

  // Variable Transit: Piston = 15%, Turbine/Helicopter = 10%
  const varRate = engineType === 'piston' ? 0.15 : 0.10;
  const varTransitMins = Number((varRate * totalTrMins).toFixed(2));

  // Reserve: Piston = 45 mins, Turbine = 30 mins, Helicopter = 30 mins
  const reserveMins = engineType === 'piston' ? 45 : 30;

  // TAF: Cerah = 0 mins, Inter = 30 mins, Tempo = 60 mins
  const tafMins = tafCondition === 'cerah' ? 0 : tafCondition === 'inter' ? 30 : 60;

  // Extra fuel
  const extraFuelMins = 0;

  // Total Safety Fuel (TSF)
  const tsfMins = Number((totalTrMins + varTransitMins + reserveMins + tafMins + extraFuelMins).toFixed(2));

  // On Scene Endurance (OSE)
  const oseMins = Math.max(0, Number((enduranceMins - tsfMins).toFixed(2)));
  const oseHrs = Number((oseMins / 60).toFixed(4));

  // Effective Search Time (EST) = 0.85 x OSE
  const estHrs = Number((0.85 * oseHrs).toFixed(4));

  // Sweep Width Area (A) = EST x V search x S
  const areaA = Number((estHrs * vSearch * spacingS).toFixed(2));

  return (
    <div className="border-2 border-slate-800 rounded bg-white shadow-2xs font-sans text-xs overflow-x-auto ">
      {/* Header Banner */}
      <div className="bg-[#0f284e] text-white p-3 text-center border-b-2 border-slate-800">
        <div className="text-sm font-black tracking-wider uppercase">
          ON SCENE ENDURANCE (OSE) & EFFECTIVE SEARCH TIME (EST)
        </div>
        <div className="text-xs font-bold text-sky-300 uppercase mt-0.5">
          WORKSHEET FOR AIR ASSET (PESAWAT PATROLI UDARA / HELIKOPTER SAR)
        </div>
        <div className="text-[11px] text-slate-300 font-mono mt-1">
          Berdasarkan Kurikulum Diklat SAR Spesialis SAR Planning Basarnas (EST Air Asset / EST Formula_s.xlsx)
        </div>
      </div>

      {/* Asset Identification & Aircraft Configuration */}
      <div className="p-3 bg-slate-50 border-b-2 border-slate-700 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
        <div>
          <span className="text-slate-600 font-sans font-semibold block">SRU NAME:</span>
          <span className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-2 py-0.5 block mt-0.5">
            {asset.name}
          </span>
        </div>
        <div>
          <span className="text-slate-600 font-sans font-semibold block">CAPTAIN / PIC:</span>
          <span className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-2 py-0.5 block mt-0.5">
            PILOT {asset.name}
          </span>
        </div>
        <div>
          <span className="text-slate-600 font-sans font-semibold block">TIPE MESIN PESAWAT:</span>
          <select
            value={engineType}
            disabled={readOnly}
            onChange={(e) => setEngineType(e.target.value as any)}
            className="w-full font-bold text-blue-900 bg-white border border-slate-300 rounded px-2 py-0.5 mt-0.5 text-xs"
          >
            <option value="piston">Piston (Var 15%, Res 45&apos;)</option>
            <option value="turbine">Turbin (Var 10%, Res 30&apos;)</option>
            <option value="helicopter">Helikopter (Var 10%, Res 30&apos;)</option>
          </select>
        </div>
        <div>
          <span className="text-slate-600 font-sans font-semibold block">PRAKIRAAN CUACA (TAF):</span>
          <select
            value={tafCondition}
            disabled={readOnly}
            onChange={(e) => setTafCondition(e.target.value as any)}
            className="w-full font-bold text-blue-900 bg-white border border-slate-300 rounded px-2 py-0.5 mt-0.5 text-xs"
          >
            <option value="cerah">Cerah (0&apos;)</option>
            <option value="inter">INTER / Intermittent (30&apos;)</option>
            <option value="tempo">TEMPO / Temporary (60&apos;)</option>
          </select>
        </div>
      </div>

      {/* Base Parameters */}
      <table className="w-full border-collapse">
        <tbody>
          <tr className="border-b border-slate-300 bg-white font-mono">
            <td className="py-2 px-3 font-sans font-semibold text-slate-700 w-1/3 border-r border-slate-300">
              ENDURANCE (E)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                {enduranceMins}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>{' '}
              <span className="text-slate-400 font-sans text-[11px] ml-2">
                ({asset.enduranceHours} Jam)
              </span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 bg-white font-mono">
            <td className="py-2 px-3 font-sans font-semibold text-slate-700 border-r border-slate-300">
              SPEED (V TAS)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                {vTas}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Kts</span>
            </td>
          </tr>
          <tr className="border-b-2 border-slate-700 bg-white font-mono">
            <td className="py-2 px-3 font-sans font-semibold text-slate-700 border-r border-slate-300">
              SEARCH SPEED (V search) & SPACING (S)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans">V search =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {vSearch}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Kts |</span>{' '}
              <span className="text-slate-600 font-sans ml-3">SPACING (S) =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {spacingS}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Nm</span>
            </td>
          </tr>

          {/* SECTION A: TOTAL SAFETY FUEL (TSF) */}
          <tr className="bg-slate-200 border-b-2 border-slate-700">
            <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 uppercase">
              A. TOTAL SAFETY FUEL (TSF)
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              Transit Go (Tr Go) = S go / V TAS × 60
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans">Jarak ke CSP:</span>{' '}
              <span className="font-bold text-slate-900">{sGoNm} Nm</span>{' '}
              <span className="text-slate-600 font-sans">/ {vTas} kts × 60 =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {trGoMins.toFixed(1)}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              Transit Back (Tr Back) = S back / V TAS × 60
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans">Jarak Exit ke Pangkalan:</span>{' '}
              <span className="font-bold text-slate-900">{sBackNm} Nm</span>{' '}
              <span className="text-slate-600 font-sans">/ {vTas} kts × 60 =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {trBackMins.toFixed(1)}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              1. Total Transit (Total Tr)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans">Tr Go + Tr Back = {trGoMins.toFixed(1)} + {trBackMins.toFixed(1)} =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {totalTrMins.toFixed(1)}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              2. Variable Transit ({engineType === 'piston' ? 'Piston 15%' : 'Turbin/Heli 10%'})
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans">{varRate} × {totalTrMins.toFixed(1)} =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {varTransitMins.toFixed(1)}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              3. Reserve ({engineType === 'piston' ? "Piston 45'" : "Turbin/Heli 30'"})
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                {reserveMins}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              4. Terminal Aerodrome Forecast (TAF)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans font-medium capitalize">{tafCondition} =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {tafMins}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              5. Extra Fuel (On Scene Weather)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="font-bold text-slate-900">{extraFuelMins}</span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>
            </td>
          </tr>
          <tr className="border-b-2 border-slate-700 bg-slate-50 font-mono">
            <td className="py-2 px-3 font-sans font-bold text-slate-800 border-r border-slate-300">
              TOTAL SAFETY FUEL (TSF) [1 + 2 + 3 + 4 + 5]
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans text-xs">
                {totalTrMins.toFixed(1)} + {varTransitMins.toFixed(1)} + {reserveMins} + {tafMins} =
              </span>{' '}
              <span className="font-bold text-indigo-950 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-200 ml-1">
                {tsfMins.toFixed(1)} Mins
              </span>{' '}
              <span className="text-slate-500 font-sans text-[11px] ml-2">
                ({(tsfMins / 60).toFixed(2)} jam)
              </span>
            </td>
          </tr>

          {/* SECTION B: ON SCENE ENDURANCE (OSE) */}
          <tr className="bg-slate-200 border-b-2 border-slate-700">
            <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 uppercase">
              B. ON SCENE ENDURANCE (OSE)
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              1. Endurance (E)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="font-bold text-slate-900">{enduranceMins}</span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>
            </td>
          </tr>
          <tr className="border-b-2 border-slate-700 font-mono bg-blue-50/30">
            <td className="py-2.5 px-3 font-sans font-bold text-slate-800 border-r border-slate-300">
              On Scene Endurance (OSE) = E - TSF
            </td>
            <td className="py-2.5 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans font-mono">{enduranceMins} - {tsfMins.toFixed(1)} =</span>{' '}
              <span className="font-bold text-blue-950 bg-blue-100 px-2.5 py-0.5 rounded border border-blue-300 ml-1">
                {oseMins.toFixed(1)} Mins
              </span>{' '}
              <span className="text-slate-600 font-sans font-bold ml-3">=</span>{' '}
              <span className="font-black text-blue-900 bg-blue-100 px-2.5 py-0.5 rounded border border-blue-300 ml-1">
                {oseHrs.toFixed(2)} Jam (Hrs)
              </span>
            </td>
          </tr>

          {/* SECTION C: EFFECTIVE SEARCH TIME (EST) */}
          <tr className="bg-slate-200 border-b-2 border-slate-700">
            <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 uppercase">
              C. EFFECTIVE SEARCH TIME (EST)
            </td>
          </tr>
          <tr className="border-b-2 border-slate-700 font-mono bg-amber-50/40">
            <td className="py-2.5 px-3 font-sans font-bold text-slate-800 border-r border-slate-300">
              EFFECTIVE SEARCH TIME (EST) = 0.85 × OSE
            </td>
            <td className="py-2.5 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans font-mono">0.85 × {oseHrs.toFixed(2)} Jam =</span>{' '}
              <span className="font-black text-amber-950 bg-amber-100 text-sm px-3 py-1 rounded border-2 border-amber-400 ml-2">
                {estHrs.toFixed(2)} Jam (Hours)
              </span>
              <span className="text-slate-500 font-sans text-[11px] ml-3 italic">
                (85% waktu produktif pencarian, 15% manuver & pencarian tanda korban)
              </span>
            </td>
          </tr>

          {/* SECTION D: SWEEP WIDTH AREA (A) OR SEARCH EFFORT (Z) */}
          <tr className="bg-slate-200 border-b-2 border-slate-700">
            <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 uppercase">
              D. SWEEP WIDTH AREA (A) or SEARCH EFFORT (Z)
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              1. Search Speed (V search)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="font-bold text-slate-900">{vSearch}</span>{' '}
              <span className="text-slate-600 font-sans font-medium">Kts</span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              2. Spacing (S)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="font-bold text-slate-900">{spacingS}</span>{' '}
              <span className="text-slate-600 font-sans font-medium">Nm</span>
            </td>
          </tr>
          <tr className="bg-emerald-50/60 font-mono">
            <td className="py-3 px-3 font-sans font-bold text-emerald-950 border-r border-slate-300 text-sm">
              Sweep Width Area (A) = EST × V search × S
            </td>
            <td className="py-3 px-3" colSpan={3}>
              <span className="text-slate-700 font-sans">{estHrs.toFixed(2)} × {vSearch} × {spacingS} =</span>{' '}
              <span className="font-black text-emerald-950 bg-emerald-100 text-base px-3.5 py-1 rounded border-2 border-emerald-500 shadow-2xs ml-2">
                {areaA.toFixed(2)} Nm²
              </span>
              <span className="text-slate-600 font-sans text-[11px] ml-3 italic">
                (Kapasitas cakupan sapuan unit {asset.name})
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
