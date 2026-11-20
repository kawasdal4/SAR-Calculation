'use client';

import React from 'react';
import { type SruAssetInput } from '@/lib/sar/assetAllocation';
import { type LatLng, distanceNm } from '@/lib/sar/sarCalculations';

interface AuthenticESTMaritimeWorksheetProps {
  asset: SruAssetInput;
  csp: LatLng;
  exitPoint: LatLng;
  /** Tidak dipakai lagi (TSF laut dihitung otomatis dari Tr Go + Tr Back);
   *  dipertahankan demi kompatibilitas pemanggil lama. */
  onUpdateAsset?: <K extends keyof SruAssetInput>(field: K, val: SruAssetInput[K]) => void;
  readOnly?: boolean;
}

export default function AuthenticESTMaritimeWorksheet({
  asset,
  csp,
  exitPoint,
}: AuthenticESTMaritimeWorksheetProps) {
  // Transit distances
  const sGoNm = distanceNm(asset.homeBasePos, csp);
  const sBackNm = distanceNm(exitPoint, asset.homeBasePos);

  const enduranceMins = asset.enduranceHours * 60;
  const transitSpeed = asset.transitSpeedKts;
  const searchSpeed = asset.searchSpeedKts;
  const spacingS = asset.sweepWidthNm; // Spacing S (Nm)

  // Calculations matching EST Mar in EST Formula_s.xlsx
  const trGoMins = transitSpeed > 0 ? (sGoNm / transitSpeed) * 60 : 0;
  const trBackMins = transitSpeed > 0 ? (sBackNm / transitSpeed) * 60 : 0;
  // TSF (Total Safety Fuel) = Tr Go + Tr Back (total transit) — dihitung otomatis.
  const tsfMins = trGoMins + trBackMins;

  // On Scene Endurance
  const oseMins = tsfMins === null ? null : enduranceMins - tsfMins;
  const oseHrs = oseMins !== null && oseMins > 0 ? oseMins / 60 : null;

  // Effective Search Time (EST) = 0.85 x OSE
  const estHrs = oseHrs !== null ? 0.85 * oseHrs : null;

  // Sweep Width Area (A) = EST x V search x S
  const validInputs = enduranceMins > 0 && transitSpeed > 0 && searchSpeed > 0 && spacingS > 0 && tsfMins !== null;
  const validCalculation = validInputs && estHrs !== null;
  const areaA = validCalculation && estHrs !== null ? estHrs * searchSpeed * spacingS : null;

  return (
    <div className="border-2 border-slate-800 rounded bg-white shadow-2xs font-sans text-xs overflow-x-auto ">
      {/* Header Banner */}
      <div className="bg-[#1e3a5f] text-white p-3 text-center border-b-2 border-slate-800">
        <div className="text-sm font-black tracking-wider uppercase">
          ON SCENE ENDURANCE (OSE) & EFFECTIVE SEARCH TIME (EST)
        </div>
        <div className="text-xs font-bold text-sky-200 uppercase mt-0.5">
          WORKSHEET FOR MARITIME ASSET (KAPAL / RIB / SEA RIDER)
        </div>
        <div className="text-[11px] text-slate-300 font-mono mt-1">
          Berdasarkan Kurikulum Diklat SAR Spesialis SAR Planning Basarnas (EST Formula_s.xlsx)
        </div>
      </div>

      {/* Asset Identification Section */}
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
            NAHKODA {asset.name}
          </span>
        </div>
        <div>
          <span className="text-slate-600 font-sans font-semibold block">PANGKALAN ASAL:</span>
          <span className="text-[11px] font-medium text-slate-800 truncate block mt-0.5" title={asset.homeBaseName}>
            {asset.homeBaseName}
          </span>
        </div>
        <div>
          <span className="text-slate-600 font-sans font-semibold block">SUB-AREA PENUGASAN:</span>
          <span className="font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded px-2 py-0.5 block mt-0.5">
            {asset.assignedSubArea}
          </span>
        </div>
      </div>
      {!validInputs && <div className="mx-3 mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">{'Lengkapi Endurance (E), Speed (V), Search Speed, dan Spacing (S); TSF laut dihitung otomatis dari Tr Go + Tr Back.'} Perhitungan kapasitas belum tersedia hingga data wajib terisi.</div>}
      {validInputs && oseMins !== null && oseMins <= 0 && <div className="mx-3 mt-3 rounded border border-rose-300 bg-rose-50 p-2 text-[11px] font-semibold text-rose-900">OSE = {oseMins.toFixed(2)} menit. OSE harus positif; Sweep Width Area tidak dihitung.</div>}

      {/* Base Parameters (Endurance, Speeds) */}
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
              SPEED (V Transit)
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                {transitSpeed}
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
                {searchSpeed}
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
              Transit Go (Tr Go) = S go / V × 60
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans">Jarak ke CSP (S go):</span>{' '}
              <span className="font-bold text-slate-900">{sGoNm} Nm</span>{' '}
              <span className="text-slate-600 font-sans">/ {transitSpeed} kts × 60 =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {trGoMins.toFixed(2)}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>{' '}
              <span className="text-slate-500 font-sans text-[11px] ml-2">
                ({(trGoMins / 60).toFixed(2)} jam)
              </span>
            </td>
          </tr>
          <tr className="border-b border-slate-300 font-mono">
            <td className="py-2 px-3 font-sans font-medium text-slate-700 border-r border-slate-300">
              Transit Back (Tr Back) = S back / V × 60
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans">Jarak Exit ke Pangkalan (S back):</span>{' '}
              <span className="font-bold text-slate-900">{sBackNm} Nm</span>{' '}
              <span className="text-slate-600 font-sans">/ {transitSpeed} kts × 60 =</span>{' '}
              <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                {trBackMins.toFixed(2)}
              </span>{' '}
              <span className="text-slate-600 font-sans font-medium">Mins</span>{' '}
              <span className="text-slate-500 font-sans text-[11px] ml-2">
                ({(trBackMins / 60).toFixed(2)} jam)
              </span>
            </td>
          </tr>
          <tr className="border-b-2 border-slate-700 bg-slate-50 font-mono">
            <td className="py-2 px-3 font-sans font-bold text-slate-800 border-r border-slate-300">
              TOTAL SAFETY FUEL (TSF) = Tr Go + Tr Back
            </td>
            <td className="py-2 px-3" colSpan={3}>
              <span className="text-slate-600 font-sans font-mono">{trGoMins.toFixed(2)} + {trBackMins.toFixed(2)} =</span>{' '}
              <span className="font-bold text-indigo-900 bg-indigo-50 px-2.5 py-0.5 rounded border border-indigo-200">
                {tsfMins.toFixed(2)} Mins
              </span>{' '}
              <span className="text-slate-500 font-sans text-[11px] ml-2">
                ({(tsfMins / 60).toFixed(4)} jam)
              </span>
              <span className="block mt-1 text-[10px] text-slate-600 font-sans">TSF laut adalah total transit (Tr Go + Tr Back); tidak diinput manual.</span>
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
              <span className="text-slate-600 font-sans font-mono">{enduranceMins} - {tsfMins?.toFixed(2) ?? '—'} =</span>{' '}
              <span className="font-bold text-blue-950 bg-blue-100 px-2.5 py-0.5 rounded border border-blue-300 ml-1">
                {oseMins?.toFixed(2) ?? '—'} Mins
              </span>{' '}
              <span className="text-slate-600 font-sans font-bold ml-3">=</span>{' '}
              <span className="font-black text-blue-900 bg-blue-100 px-2.5 py-0.5 rounded border border-blue-300 ml-1">
                {oseHrs?.toFixed(4) ?? '—'} Jam (Hrs)
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
              <span className="text-slate-600 font-sans font-mono">0.85 × {oseHrs?.toFixed(4) ?? '—'} Jam =</span>{' '}
              <span className="font-black text-amber-950 bg-amber-100 text-sm px-3 py-1 rounded border-2 border-amber-400 ml-2">
                {estHrs?.toFixed(4) ?? '—'} Jam (Hours)
              </span>
              <span className="text-slate-500 font-sans text-[11px] ml-3 italic">
                (85% waktu efektif pencarian di lokasi, 15% manuver & navigasi)
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
              <span className="font-bold text-slate-900">{searchSpeed}</span>{' '}
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
              <span className="text-slate-700 font-sans">{estHrs?.toFixed(4) ?? '—'} × {searchSpeed} × {spacingS} =</span>{' '}
              <span className="font-black text-emerald-950 bg-emerald-100 text-base px-3.5 py-1 rounded border-2 border-emerald-500 shadow-2xs ml-2">
                {areaA?.toFixed(2) ?? '—'} Nm²
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
