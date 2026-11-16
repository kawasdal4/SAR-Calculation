'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';
import { Printer } from 'lucide-react';

interface Worksheet3Props {
  searchResults?: SearchPlanResults | null;
  E?: number;
  readOnly?: boolean;
}

export default function Worksheet3({
  searchResults,
  E = 0,
  readOnly = false,
}: Worksheet3Props) {
  // Case & Metadata state
  const [caseTitle, setCaseTitle] = useState('-');
  const [plannerName, setPlannerName] = useState('-');
  const [searchDate, setSearchDate] = useState('-');
  const [searchObject, setSearchObject] = useState('-');
  const [visibilityKm, setVisibilityKm] = useState(0);
  const [vegetationType, setVegetationType] = useState<'15-60' | '60-85' | '+85'>('15-60');
  const [isFatigue, setIsFatigue] = useState(false);
  const searchTas = 0;

  // Correction factors for land search (Table I-10)
  const fv = vegetationType === '15-60' ? 0.8 : vegetationType === '60-85' ? 0.6 : 0.4;
  const ff = isFatigue ? 0.9 : 1.0;

  // Uncorrected sweep widths (Wu) for Land (Table I-9)
  const wuList = [1.8, 2.4, 2.8, 3.0];
  const heights = [500, 1000, 1500, 2000];

  // Calculated sweep width factors: W = Wu * Fv * Ff
  const wFactors = wuList.map((wu) => Number((wu * fv * ff).toFixed(2)));

  // Practical track spacing S (NM)
  const trackSpacings = [1.0, 1.5, 2.0, 2.5];

  // Coverage C = W / S
  const coverages = wFactors.map((w, idx) => Number((w / trackSpacings[idx]).toFixed(2)));

  // POD
  const pods = coverages.map((c) => Math.min(99, Math.round((1 - Math.exp(-c)) * 100)));

  // Search Area A (default ~300 NM² or from searchResults)
  const searchAreaA = searchResults?.Ao ? Math.round(searchResults.Ao) : 300;

  // Search Hours T required: T = A / (V * S)
  const hoursRequired = trackSpacings.map((s) =>
    Number((searchAreaA / Math.max(1, searchTas * s)).toFixed(1))
  );

  // Available search hours
  const [hoursAvailable, setHoursAvailable] = useState(0);

  // Selected height for options: 1000 ft (idx 1)
  const selIdx = 1;
  const selW = wFactors[selIdx];
  const selS = trackSpacings[selIdx];
  const selC = coverages[selIdx];
  const selP = pods[selIdx];

  // Option A
  const optA_Area = searchAreaA;
  const optA_S = selS;
  const optA_C = selC;
  const optA_P = selP;

  // Option B
  const optB_Area = Math.round(hoursAvailable * searchTas * selS);
  const optB_S = selS;
  const optB_C = selC;
  const optB_P = selP;

  // Option C
  const optC_S = Number((searchAreaA / Math.max(1, searchTas * hoursAvailable)).toFixed(1));
  const optC_C = Number((selW / Math.max(0.1, optC_S)).toFixed(2));
  const optC_P = Math.min(99, Math.round((1 - Math.exp(-optC_C)) * 100));

  // Option D compromises
  const optD_variations = [
    { sMod: selS * 0.8, name: '(i)' },
    { sMod: selS * 1.0, name: '(ii)' },
    { sMod: selS * 1.2, name: '(iii)' },
    { sMod: selS * 1.5, name: '(iv)' },
  ].map((item) => {
    const s = Number(item.sMod.toFixed(1));
    const a = Math.round(hoursAvailable * searchTas * s);
    const c = Number((selW / Math.max(0.1, s)).toFixed(2));
    const p = Math.min(99, Math.round((1 - Math.exp(-c)) * 100));
    return { name: item.name, a, s, c, p };
  });

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  return (
    <Card className="border-slate-800 shadow-sm bg-white overflow-hidden text-slate-900 font-sans print:border-none">
      <CardContent className="p-4 sm:p-6 space-y-4">
        {/* Printable / Viewable Official Appendix K Header */}
        <div className="flex items-center justify-between border-b-2 border-slate-800 pb-1 text-[11px] font-bold text-slate-700">
          <span>Appendix K – Worksheets</span>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 px-2 py-0.5 rounded border border-slate-300 print:hidden transition-colors"
          >
            <Printer className="h-3 w-3" /> Cetak Lembar Ini
          </button>
        </div>

        {/* Outer Authentic Form Border */}
        <div className="border-2 border-slate-900 rounded bg-white text-xs">
          {/* Top Title Grid */}
          <div className="grid grid-cols-12 border-b-2 border-slate-900">
            {/* Left: Incident Reference */}
            <div className="col-span-3 p-2.5 border-r border-slate-800 flex flex-col justify-between">
              <span className="font-bold text-slate-700 uppercase tracking-wide text-[11px]">
                Incident Reference
              </span>
              <input
                type="text"
                value={caseTitle}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setCaseTitle(e.target.value)}
                className="font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-500 px-1 py-0.5 text-xs w-full mt-1"
              />
            </div>

            {/* Center: Search and Rescue - Worksheet No. 3 (Land) */}
            <div className="col-span-5 p-2.5 text-center flex flex-col items-center justify-center border-r border-slate-800 bg-slate-50/70">
              <div className="text-base font-black tracking-wide text-slate-950 uppercase">
                Search and Rescue
              </div>
              <div className="text-xs font-bold text-slate-800 uppercase mt-0.5">
                Worksheet No. 3 (Land)
              </div>
            </div>

            {/* Right: Compiled By & Date */}
            <div className="col-span-4 p-2.5 flex flex-col justify-between text-[11px] space-y-1">
              <div>
                <span className="text-slate-600">Compiled By: </span>
                <input
                  type="text"
                  value={plannerName}
                  disabled={readOnly}
                  suppressHydrationWarning
                  onChange={(e) => setPlannerName(e.target.value)}
                  className="font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-500 px-1 py-0.5 text-xs w-2/3"
                />
              </div>
              <div>
                <span className="text-slate-600">Date: </span>
                <input
                  type="text"
                  value={searchDate}
                  disabled={readOnly}
                  suppressHydrationWarning
                  onChange={(e) => setSearchDate(e.target.value)}
                  className="font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-500 px-1 py-0.5 text-xs w-2/3 font-mono"
                />
              </div>
            </div>
          </div>

          {/* Subheader Metadata Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-b-2 border-slate-900 p-2.5 bg-slate-50/40 text-[11px] gap-2">
            <div>
              <span className="text-slate-600">Search Object: </span>
              <input
                type="text"
                value={searchObject}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setSearchObject(e.target.value)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-44"
              />
            </div>
            <div>
              <span className="text-slate-600">Fatigue Factor: </span>
              <select
                value={isFatigue ? 'Yes' : 'No'}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setIsFatigue(e.target.value === 'Yes')}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs"
              >
                <option value="No">No (1.0)</option>
                <option value="Yes">Yes (0.9)</option>
              </select>
            </div>
            <div>
              <span className="text-slate-600">MET Visibility: </span>
              <input
                type="number"
                value={visibilityKm}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setVisibilityKm(Number(e.target.value) || 10)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-16 text-right font-mono"
              />{' '}
              <span className="font-semibold text-slate-700">KM</span>
            </div>
            <div>
              <span className="text-slate-600">Vegetation: </span>
              <select
                value={vegetationType}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setVegetationType(e.target.value as any)}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs"
              >
                <option value="15-60">15-60% (Fv 0.8)</option>
                <option value="60-85">60-85% (Fv 0.6)</option>
                <option value="+85">+85% Rapat (Fv 0.4)</option>
              </select>
            </div>
          </div>

          {/* Main Evaluation Table: Multi-Altitude Sweep Width (Land) */}
          <table className="w-full border-collapse text-xs table-fixed">
            <thead>
              <tr className="bg-slate-200/90 text-slate-900 font-bold border-b-2 border-slate-800">
                <th className="py-2 px-3 text-left w-[40%] border-r border-slate-300">
                  Search Height (AGL)
                </th>
                {heights.map((h) => (
                  <th key={h} className="py-2 px-2 text-center w-[15%] border-r border-slate-300 last:border-r-0">
                    {h} ft
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 text-[11px]">
              {/* Row 1: Uncorrected Sweep Width */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div className="font-bold">Uncorrected Sweep Width (Wu) - <span className="font-bold text-blue-700">Table I-9</span></div>
                </td>
                {wuList.map((wu, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0">
                    <span className="font-bold text-blue-900 font-mono">{wu.toFixed(1)}</span>{' '}
                    <span className="text-slate-500 text-[10px]">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 2: Terrain/Vegetation Correction Factor Fv */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div>Searches over land: use Terrain/Vegetation Correction Factor (Fv) - <span className="font-bold text-blue-700">Table I-10</span></div>
                </td>
                {heights.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {fv.toFixed(2)}
                  </td>
                ))}
              </tr>

              {/* Row 3: Fatigue Correction Factor Ff */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div className="font-semibold">Fatigue Correction Factor (Ff)</div>
                  <div className="text-[10px] text-slate-500">
                    if crew will be suffering significant fatigue enter 0.9, Otherwise enter 1.0
                  </div>
                </td>
                {heights.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {ff.toFixed(2)}
                  </td>
                ))}
              </tr>

              {/* Row 4: Sweep Width Factor W = Wu.Fv.Ff */}
              <tr className="bg-blue-50/40">
                <td className="py-1.5 px-3 font-bold text-slate-900 border-r border-slate-300">
                  Sweep Width Factor W = Wu.Fv.Ff
                </td>
                {wFactors.map((w, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-950 text-xs">
                    {w.toFixed(2)} <span className="text-[10px] font-normal text-slate-600">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 5: Practical Track Spacing S */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  Practical Track Spacing S (NM)
                </td>
                {trackSpacings.map((s, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-slate-800">
                    {s.toFixed(1)} <span className="text-[10px] text-slate-500">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 6: Coverage Factor C = W/S */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  Coverage Factor C = W/S
                </td>
                {coverages.map((c, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-indigo-900">
                    {c.toFixed(2)}
                  </td>
                ))}
              </tr>

              {/* Row 7: Probability of Detection (POD) */}
              <tr className="bg-emerald-50/50">
                <td className="py-1.5 px-3 font-bold text-emerald-950 border-r border-slate-300">
                  Probability of Detection (POD)
                </td>
                {pods.map((p, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-black text-emerald-900">
                    {p}%
                  </td>
                ))}
              </tr>

              {/* Row 8: Search Area A */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  Search Area A (SQ NM)
                </td>
                {heights.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-slate-900">
                    {searchAreaA}
                  </td>
                ))}
              </tr>

              {/* Row 9: Search Hours T required */}
              <tr className="bg-slate-100/70 border-b-2 border-slate-900">
                <td className="py-1.5 px-3 font-bold text-slate-900 border-r border-slate-300">
                  <div>Search Hours (T) Required at {searchTas} KTS (V)</div>
                  <div className="text-[10px] text-slate-600 font-mono">T = A/VS</div>
                </td>
                {hoursRequired.map((t, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900 text-xs">
                    {t.toFixed(1)} <span className="text-[10px] font-normal text-slate-600">hrs</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          {/* Section: Total Search Hours Available */}
          <div className="p-2.5 bg-slate-50 border-b-2 border-slate-900 text-xs flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-bold text-slate-800">
                Total Search Hours Available at {searchTas} KTS:
              </span>{' '}
              <input
                type="number"
                step="0.1"
                value={hoursAvailable}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setHoursAvailable(Number(e.target.value) || 4.0)}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-2 py-0.5 w-16 text-right font-mono"
              />{' '}
              <span className="font-medium text-slate-600">hrs — (from Worksheet No. 6)</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono italic">
              Area Search Planning & Trade-offs (Land)
            </span>
          </div>

          {/* Area Options A, B, C, D */}
          <div className="p-3 space-y-2.5 text-xs font-mono">
            {/* Option A */}
            <div className="border border-slate-300 rounded p-2 bg-white">
              <div className="font-sans font-bold text-slate-800 text-[11px] mb-1">
                A. Whole Area Calculated at a Search Height of{' '}
                <span className="text-blue-900 font-bold underline">1000</span> FT{' '}
                <span className="font-normal text-slate-500">(A = TVS, C = W/S, S = W/C)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">A (SQ. NM)</span>
                  <span className="font-bold text-blue-900">{optA_Area}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">S (NM)</span>
                  <span className="font-bold text-blue-900">{optA_S.toFixed(1)}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">C</span>
                  <span className="font-bold text-blue-900">{optA_C.toFixed(2)}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">P (%)</span>
                  <span className="font-bold text-emerald-800">{optA_P}%</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">FOR SEARCH</span>
                  <span className="font-bold text-slate-800">*</span>
                </div>
              </div>
            </div>

            {/* Option B */}
            <div className="border border-slate-300 rounded p-2 bg-white">
              <div className="font-sans font-bold text-slate-800 text-[11px] mb-1">
                B. Modified Area at Calculated Track Spacing in Available Hours
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">A (SQ. NM)</span>
                  <span className="font-bold text-blue-900">{optB_Area}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">S (NM)</span>
                  <span className="font-bold text-blue-900">{optB_S.toFixed(1)}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">C</span>
                  <span className="font-bold text-blue-900">{optB_C.toFixed(2)}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">P (%)</span>
                  <span className="font-bold text-emerald-800">{optB_P}%</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">FOR SEARCH</span>
                  <span className="font-bold text-slate-400">-</span>
                </div>
              </div>
            </div>

            {/* Option C */}
            <div className="border border-slate-300 rounded p-2 bg-white">
              <div className="font-sans font-bold text-slate-800 text-[11px] mb-1">
                C. Whole Area at Modified Track Spacing in Available Hours
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">A (SQ. NM)</span>
                  <span className="font-bold text-blue-900">{searchAreaA}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">S (NM)</span>
                  <span className="font-bold text-blue-900">{optC_S.toFixed(1)}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">C</span>
                  <span className="font-bold text-blue-900">{optC_C.toFixed(2)}</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">P (%)</span>
                  <span className="font-bold text-emerald-800">{optC_P}%</span>
                </div>
                <div className="border border-slate-300 p-1 rounded bg-slate-50">
                  <span className="text-slate-500 block text-[10px]">FOR SEARCH</span>
                  <span className="font-bold text-slate-400">-</span>
                </div>
              </div>
            </div>

            {/* Option D: Compromises */}
            <div className="border border-slate-300 rounded p-2 bg-white">
              <div className="font-sans font-bold text-slate-800 text-[11px] mb-1">
                D. Compromise Area and Modified Practical Track Spacing in Available Hours
              </div>
              <div className="space-y-1 mt-1">
                {optD_variations.map((v) => (
                  <div key={v.name} className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center text-xs">
                    <div className="border border-slate-200 p-0.5 rounded bg-slate-50">
                      <span className="text-slate-600 font-sans text-[10px] mr-1">{v.name} A:</span>
                      <span className="font-bold text-blue-900">{v.a}</span> SQ.NM
                    </div>
                    <div className="border border-slate-200 p-0.5 rounded bg-slate-50">
                      <span className="text-slate-600 font-sans text-[10px] mr-1">S:</span>
                      <span className="font-bold text-blue-900">{v.s}</span> NM
                    </div>
                    <div className="border border-slate-200 p-0.5 rounded bg-slate-50">
                      <span className="text-slate-600 font-sans text-[10px] mr-1">C:</span>
                      <span className="font-bold text-blue-900">{v.c}</span>
                    </div>
                    <div className="border border-slate-200 p-0.5 rounded bg-slate-50">
                      <span className="text-slate-600 font-sans text-[10px] mr-1">P:</span>
                      <span className="font-bold text-emerald-800">{v.p}%</span>
                    </div>
                    <div className="border border-slate-200 p-0.5 rounded bg-slate-50">
                      <span className="font-bold text-slate-400">-</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Form Footer */}
          <div className="p-2 border-t border-slate-800 bg-slate-100 flex items-center justify-between text-[11px] text-slate-600">
            <span className="italic">Mark selected variables with *</span>
            <span className="font-bold font-mono">K-4</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
