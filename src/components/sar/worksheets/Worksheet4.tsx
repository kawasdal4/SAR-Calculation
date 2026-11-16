'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';
import { Printer } from 'lucide-react';
import CoordinateInput from '@/components/sar/CoordinateInput';

interface Worksheet4Props {
  searchResults?: SearchPlanResults | null;
  E?: number;
  divergenceDistance?: number;
  readOnly?: boolean;
}

export default function Worksheet4({
  searchResults,
  E = 0,
  divergenceDistance = 0,
  readOnly = false,
}: Worksheet4Props) {
  // Case & Metadata state
  const [caseTitle, setCaseTitle] = useState('-');
  const [plannerName, setPlannerName] = useState('-');
  const [searchDate, setSearchDate] = useState('-');
  const [callsign, setCallsign] = useState('-');
  const [searchNo, setSearchNo] = useState('0');
  const [commenceUtc, setCommenceUtc] = useState('-');
  const [prevSearchNo, setPrevSearchNo] = useState('-');
  const [prevCommenceUtc, setPrevCommenceUtc] = useState('-');

  // Position fixes / reports
  const [latitude, setLatitude] = useState(0);
  const [longitude, setLongitude] = useState(0);
  const [distressTimeUtc, setDistressTimeUtc] = useState('-');
  const [lastFix, setLastFix] = useState('-');
  const [lastReportedPos, setLastReportedPos] = useState('-');
  const [missedPos, setMissedPos] = useState('-');
  const [nextPos, setNextPos] = useState('-');

  // Multi-position Track distances (Positions A, B, C, D)
  // Pos A: Last Positive Fix
  // Pos B: Last Reported Posn
  // Pos C: Missed Posn
  // Pos D: Next Posn
  const [trList, setTrList] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [fixErrors, setFixErrors] = useState<[number, number, number, number]>([0, 0, 0, 0]);
  const [yNavError, setYNavError] = useState(0);
  const [safetyFactor, setSafetyFactor] = useState(0);

  // Calculated values for positions A, B, C, D
  // x = Fix + 10% Tr
  const xValues = trList.map((tr, i) => Number((fixErrors[i] + 0.1 * tr).toFixed(2)));
  // e = sqrt(x^2 + y^2)
  const eValues = xValues.map((x) => Number(Math.sqrt(x * x + yNavError * yNavError).toFixed(2)));
  // R = e * fs
  const rValues = eValues.map((e) => Number((e * safetyFactor).toFixed(2)));
  // Rounded up radius
  const roundedRValues = rValues.map((r) => Math.ceil(r));

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

            {/* Center: Search and Rescue - Worksheet No. 4 (Search Radius) */}
            <div className="col-span-5 p-2.5 text-center flex flex-col items-center justify-center border-r border-slate-800 bg-slate-50/70">
              <div className="text-base font-black tracking-wide text-slate-950 uppercase">
                Search and Rescue
              </div>
              <div className="text-xs font-bold text-slate-800 uppercase mt-0.5">
                Worksheet No. 4 (Search Radius)
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

          {/* Top 4-Column Box: Distress Position & Search Identification */}
          <div className="grid grid-cols-1 md:grid-cols-4 border-b-2 border-slate-900 text-[11px]">
            {/* Box 1: Reported Distress Position */}
            <div className="p-2.5 border-r border-slate-800 space-y-1 bg-slate-50/30">
              <span className="font-bold text-slate-800 block">Reported Distress Position:</span>
              <div className="font-mono">
                <CoordinateInput axis="lat" value={latitude} onChange={setLatitude} disabled={readOnly} aria-label="Latitude distress" className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-500 px-1 w-full" />
              </div>
              <div className="font-mono">
                <CoordinateInput axis="lng" value={longitude} onChange={setLongitude} disabled={readOnly} aria-label="Longitude distress" className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-500 px-1 w-full" />
              </div>
              <div>
                <span className="text-slate-500 font-sans">Time: </span>
                <input
                  type="text"
                  value={distressTimeUtc}
                  disabled={readOnly}
                  suppressHydrationWarning
                  onChange={(e) => setDistressTimeUtc(e.target.value)}
                  className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-500 px-1 w-24 font-mono"
                />
              </div>
            </div>

            {/* Box 2: [or] Fix Positions 1, 2, 3, 4 */}
            <div className="p-2.5 border-r border-slate-800 space-y-1 bg-white">
              <span className="text-[10px] text-slate-500 font-bold block">[ or Positions ]</span>
              <div className="truncate">
                <span className="text-slate-600">1. Last Positive Fix: </span>
                <span className="font-bold text-blue-900 font-mono text-[10px]">{lastFix}</span>
              </div>
              <div className="truncate">
                <span className="text-slate-600">2. Last Reported Posn: </span>
                <span className="font-bold text-blue-900 font-mono text-[10px]">{lastReportedPos}</span>
              </div>
              <div className="truncate">
                <span className="text-slate-600">3. Missed position: </span>
                <span className="font-bold text-blue-900 font-mono text-[10px]">{missedPos}</span>
              </div>
              <div className="truncate">
                <span className="text-slate-600">4. Next Posn or Dest: </span>
                <span className="font-bold text-blue-900 font-mono text-[10px]">{nextPos}</span>
              </div>
            </div>

            {/* Box 3: Search No. & Commencing Times */}
            <div className="p-2.5 border-r border-slate-800 space-y-1 bg-slate-50/30">
              <div>
                <span className="text-slate-600">Search No. </span>
                <input
                  type="text"
                  value={searchNo}
                  disabled={readOnly}
                  suppressHydrationWarning
                  onChange={(e) => setSearchNo(e.target.value)}
                  className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-500 px-1 w-12 text-center"
                />
              </div>
              <div>
                <span className="text-slate-600">Radius Computed: </span>
                <span className="font-bold text-blue-900 font-mono">{roundedRValues[0]} NM</span>
              </div>
              <div>
                <span className="text-slate-600">For Search Commencing: </span>
                <input
                  type="text"
                  value={commenceUtc}
                  disabled={readOnly}
                  suppressHydrationWarning
                  onChange={(e) => setCommenceUtc(e.target.value)}
                  className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-500 px-1 w-20 font-mono"
                />
              </div>
              <div className="text-[10px] text-slate-500 pt-0.5 border-t border-slate-200">
                <span>Prev Search: </span>
                <span className="font-mono">{prevSearchNo} ({prevCommenceUtc})</span>
              </div>
            </div>

            {/* Box 4: Distress Craft Callsign / Identity */}
            <div className="p-2.5 flex flex-col justify-between bg-white">
              <span className="font-bold text-slate-700 block">Distress Craft Callsign / Identity:</span>
              <input
                type="text"
                value={callsign}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setCallsign(e.target.value)}
                className="font-bold text-blue-900 bg-blue-50/60 border border-slate-300 rounded px-2 py-1 text-xs w-full font-mono mt-1"
              />
              <span className="text-[10px] text-slate-400 font-mono mt-1">
                Nav Error (y): {yNavError} NM
              </span>
            </div>
          </div>

          {/* Main Calculation Table: Positions A, B, C, D */}
          <table className="w-full border-collapse text-xs table-fixed">
            <thead>
              <tr className="bg-slate-200/90 text-slate-900 font-bold border-b-2 border-slate-800">
                <th className="py-2 px-3 text-left w-[44%] border-r border-slate-300">
                  Position / Parameter
                </th>
                <th className="py-2 px-2 text-center w-[14%] border-r border-slate-300">
                  A (Fix)
                </th>
                <th className="py-2 px-2 text-center w-[14%] border-r border-slate-300">
                  B (Last Pos)
                </th>
                <th className="py-2 px-2 text-center w-[14%] border-r border-slate-300">
                  C (Missed)
                </th>
                <th className="py-2 px-2 text-center w-[14%] border-r-0">
                  D (Next/Dest)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 text-[11px]">
              {/* Row 1: Track distance since last Positive Fix (Tr) */}
              <tr>
                <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-300">
                  Track distance since last Positive Fix (Tr)
                </td>
                {trList.map((tr, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono">
                    <input
                      type="number"
                      value={tr}
                      disabled={readOnly}
                      suppressHydrationWarning
                      onChange={(e) => {
                        const val = Number(e.target.value) || 0;
                        setTrList((prev) => {
                          const next = [...prev] as [number, number, number, number];
                          next[i] = val;
                          return next;
                        });
                      }}
                      className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-500 w-12 text-center"
                    />{' '}
                    <span className="text-slate-500 text-[10px]">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 2: Distress Craft Position Error (Fix+10%Tr) (x) */}
              <tr>
                <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div>Distress Craft Position Error (Fix + 10% Tr) (x)</div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    x = Fix Error + 0.10 × Tr
                  </div>
                </td>
                {xValues.map((x, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {x.toFixed(1)} <span className="text-[10px] font-normal text-slate-600">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 3: Search Craft Navigation Error (y) */}
              <tr>
                <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-300">
                  Search Craft Navigation Error (y)
                </td>
                {trList.map((_, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {yNavError.toFixed(1)} <span className="text-[10px] font-normal text-slate-600">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 4: Probable Error of Position (e = sqrt(x^2 + y^2)) */}
              <tr className="bg-indigo-50/30">
                <td className="py-2.5 px-3 font-bold text-indigo-950 border-r border-slate-300">
                  <div className="flex items-center gap-2">
                    <span>Probable Error of Position (e)</span>
                    <span className="text-xs font-mono font-bold bg-white px-2 py-0.5 rounded border border-indigo-200">
                      e = √(x² + y²)
                    </span>
                  </div>
                </td>
                {eValues.map((eVal, i) => (
                  <td key={i} className="py-2.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-indigo-900 text-xs">
                    <div>√({xValues[i]}² + {yNavError}²)</div>
                    <div className="text-blue-950 font-black mt-0.5">{eVal.toFixed(2)} NM</div>
                  </td>
                ))}
              </tr>

              {/* Row 5: Safety Factor (fs) */}
              <tr>
                <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-300">
                  Safety Factor for this search (1.1; 1.6; 2.0; 2.3; 2.5) (fs)
                </td>
                {trList.map((_, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0">
                    {i === 0 ? (
                      <select
                        value={safetyFactor}
                        disabled={readOnly}
                        suppressHydrationWarning
                        onChange={(e) => setSafetyFactor(Number(e.target.value) || 1.1)}
                        className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1 py-0.5 text-xs font-mono"
                      >
                      <option value="0">0</option>
                        <option value="1.1">1.1</option>
                        <option value="1.6">1.6</option>
                        <option value="2.0">2.0</option>
                        <option value="2.3">2.3</option>
                        <option value="2.5">2.5</option>
                      </select>
                    ) : (
                      <span className="font-bold text-blue-900 font-mono">{safetyFactor}</span>
                    )}
                  </td>
                ))}
              </tr>

              {/* Row 6: Search Radius (R) = (e) x (fs) */}
              <tr className="bg-emerald-50/50">
                <td className="py-2 px-3 font-bold text-emerald-950 border-r border-slate-300">
                  Search Radius (R) = (e) × (fs) (R)
                </td>
                {rValues.map((r, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-black text-emerald-900 text-xs">
                    {r.toFixed(2)} <span className="text-[10px] font-normal text-slate-600">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 7: Rounded up Radius */}
              <tr className="bg-slate-100 font-bold border-b-2 border-slate-900">
                <td className="py-2 px-3 text-slate-900 border-r border-slate-300">
                  Rounded up Radius
                </td>
                {roundedRValues.map((rr, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-black text-blue-950 text-sm">
                    {rr} <span className="text-[10px] font-normal text-slate-600">NM</span>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>

          {/* Form Footer */}
          <div className="p-2 bg-slate-100 flex items-center justify-between text-[11px] text-slate-600">
            <span className="italic">Appendix K-5</span>
            <span className="font-bold font-mono">K-5</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
