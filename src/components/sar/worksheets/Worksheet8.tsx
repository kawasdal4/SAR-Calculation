'use client';

import { printActiveWorksheetFit } from '@/lib/sar/printFit';
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Printer } from 'lucide-react';
import { computeW8Row, readFigureI12, W8_TARGET_OPTIONS, type W8Target, type SearchNumber } from '@/lib/sar/wscPodTables';

export interface Worksheet8InitialState {
  caseTitle?: string;
  /** Nama SRU/alut pemilik lembar ini (multi-SRU: 1 alut = 1 lembar). Komponen mengabaikannya. */
  sruName?: string;
  sruType?: 'rescue-vessel' | 'patrol-boat' | 'rib' | 'sea-rider';
  eyeHeight?: '8' | '14' | 'MERSHIP';
  searchObject?: W8Target;
  visibilityKm?: string;
  isFatigue?: 'Yes' | 'No';
  searchNumber?: SearchNumber;
  vesselSpeedKts?: number;
}

interface Worksheet8Props {
  ws1Ao?: number;
  initialC?: number;
  initialPod?: number;
  readOnly?: boolean;
  windKts?: number;
  initialState?: Worksheet8InitialState;
  onTrackSpacingChange?: (result: { spacingNm: number; selection: string }) => void;
}

export default function Worksheet8({
  ws1Ao = 0,
  initialC = 0,
  initialPod = 0,
  readOnly = false,
  windKts = 0,
  initialState,
  onTrackSpacingChange,
}: Worksheet8Props) {
  // Case & Metadata state
  const [caseTitle, setCaseTitle] = useState(initialState?.caseTitle ?? '-');
  const [plannerName, setPlannerName] = useState('-');
  const [searchDate, setSearchDate] = useState('-');
  const [searchPlatform, setSearchPlatform] = useState('');
  const [eyeHeight, setEyeHeight] = useState<''|'8'|'14'|'MERSHIP'>(initialState?.eyeHeight ?? '');
  const [searchObject, setSearchObject] = useState<W8Target|''>(initialState?.searchObject ?? '');
  const [visibilityKm, setVisibilityKm] = useState(initialState?.visibilityKm ?? '');
  const [isFatigue, setIsFatigue] = useState<''|'Yes'|'No'>(initialState?.isFatigue ?? '');
  const [searchNumber, setSearchNumber] = useState<SearchNumber | 0>(initialState?.searchNumber ?? 0);
  const [vesselSpeedKts, setVesselSpeedKts] = useState(initialState?.vesselSpeedKts ?? 0); // Vessel search speed (kts)

  // Vessel eye heights: Eye height 8 ft (Small craft), Eye height 14 ft (Patrol boat), MERSHIP (Large ship bridge)
  const columns = ['Eye height 8 ft', 'Eye height 14 ft', 'MERSHIP'];

  // Math diekstraksi ke lib (PHASE 3): computeW8Row — rumus identik dengan versi inline sebelumnya
  // (termasuk pembulatan W/C 2 desimal dan T 1 desimal).
  const heights = ['8','14','MERSHIP'] as const;
  const w8Rows = heights.map((eye) => computeW8Row({
    target: searchObject,
    eyeHeight: eye,
    visibilityKm,
    windKts,
    fatigue: isFatigue,
    searchNumber,
    vesselSpeedKts,
    areaAoNm2: ws1Ao,
  }));
  const wuList = w8Rows.map((r) => r.Wu);
  const fw = w8Rows[0].fw;
  const ff = w8Rows[0].ff;
  const ready = w8Rows[0].ready;
  const wFactors = w8Rows.map((r) => r.W);
  const trackSpacings = w8Rows.map((r) => r.S);
  const coverages = w8Rows.map((r) => r.C);
  const pods = w8Rows.map((r) => r.POD);

  // Search Area A from Worksheet 1 Ao
  const searchAreaA = ws1Ao;

  // Search Hours T required: T = A / (V * S) — dihitung di computeW8Row (lib)
  const hoursRequired = w8Rows.map((r) => r.T);

  // Available search hours from Worksheet No. 7
  const [hoursAvailable, setHoursAvailable] = useState(0);

  // Selected eye-height column for Area A
  const selIdx = heights.indexOf(eyeHeight as typeof heights[number]);
  const selW = selIdx >= 0 ? wFactors[selIdx] : 0;
  const selS = selIdx >= 0 ? trackSpacings[selIdx] : 0;
  const selC = selIdx >= 0 ? coverages[selIdx] : 0;
  const selP = selIdx >= 0 ? pods[selIdx] : 0;

  useEffect(() => {
    onTrackSpacingChange?.({
      spacingNm: selS,
      selection: eyeHeight || 'belum dipilih',
    });
  }, [onTrackSpacingChange, eyeHeight, selS]);

  // Option A
  const optA_Area = searchAreaA;
  const optA_S = selS;
  const optA_C = selC;
  const optA_P = selP;

  // Option B
  const optB_Area = Math.round(hoursAvailable * vesselSpeedKts * selS);
  const optB_S = selS;
  const optB_C = selC;
  const optB_P = selP;

  // Option C
  const optC_S = vesselSpeedKts > 0 && hoursAvailable > 0 ? Number((searchAreaA / (vesselSpeedKts * hoursAvailable)).toFixed(2)) : 0;
  const optC_C = optC_S > 0 ? Number((selW / optC_S).toFixed(2)) : 0;
  const optC_P = ready ? readFigureI12(optC_C, searchNumber || 1) : 0;

  // Option D compromises
  const optD_variations = [
    { sMod: selS * 0.8, name: '(i)' },
    { sMod: selS * 1.0, name: '(ii)' },
    { sMod: selS * 1.2, name: '(iii)' },
    { sMod: selS * 1.5, name: '(iv)' },
  ].map((item) => {
    const s = Number(item.sMod.toFixed(1));
    const a = Math.round(hoursAvailable * vesselSpeedKts * s);
    const c = s > 0 ? Number((selW / s).toFixed(2)) : 0;
    const p = ready ? readFigureI12(c, searchNumber || 1) : 0;
    return { name: item.name, a, s, c, p };
  });

  const handlePrint = () => {
    if (typeof window !== 'undefined') printActiveWorksheetFit();
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

            {/* Center: Search and Rescue - Worksheet No. 8 */}
            <div className="col-span-5 p-2.5 text-center flex flex-col items-center justify-center border-r border-slate-800 bg-slate-50/70">
              <div className="text-base font-black tracking-wide text-slate-950 uppercase">
                Search and Rescue
              </div>
              <div className="text-xs font-bold text-slate-800 uppercase mt-0.5">
                Worksheet No. 8
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
          <div className="grid grid-cols-1 sm:grid-cols-3 border-b-2 border-slate-900 p-2.5 bg-slate-50/40 text-[11px] gap-2">
            <div>
              <span className="text-slate-600">Search Platform: </span>
              <span>Kapal laut (Worksheet 8)</span>
            </div>
            <div>
              <span className="text-slate-600">Kecepatan Kapal (V): </span>
              <input
                type="number"
                value={vesselSpeedKts}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setVesselSpeedKts(Number(e.target.value) || 0)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-14 text-right font-mono"
              />{' '}
              <span className="font-semibold text-slate-700">Kts</span>
            </div>
            <div>
              <span className="text-slate-600">Search Object: </span>
              <select value={searchObject} disabled={readOnly} onChange={(e) => setSearchObject(e.target.value as W8Target|"")} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1 w-48"><option value="">Pilih objek</option>{W8_TARGET_OPTIONS.filter((t) => eyeHeight !== 'MERSHIP' || ['person','raft4','raft6','raft15','raft25','boatUnder5','boat5to8','boat8to12','boat12to20'].includes(t.id)).map((t) => <option key={t.id} value={t.id}>{eyeHeight === 'MERSHIP' && t.id === 'boat5to8' ? 'Power Boat <7m' : eyeHeight === 'MERSHIP' && t.id === 'boat8to12' ? 'Power Boat <12m' : eyeHeight === 'MERSHIP' && t.id === 'boat12to20' ? 'Power Boat <24m' : t.label}</option>)}</select>
            </div>

            <div>
              <span className="text-slate-600">MET Visibility: </span>
              <select value={visibilityKm} disabled={readOnly} onChange={(e) => setVisibilityKm(e.target.value)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1"><option value="">Pilih km</option>{['2','5','10','15','20','>25','30','40'].map((v) => <option key={v} value={v}>{v}</option>)}</select> KM
            </div>
            <div>
              <span className="text-slate-600">Wind: </span>
              <span className="font-bold text-blue-900">{windKts.toFixed(1)} Kts (ASW)</span>
            </div>
            <div>
              <span className="text-slate-600">Fatigue Factor: </span>
              <select
                value={isFatigue}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setIsFatigue(e.target.value as ''|'Yes'|'No')}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs"
              >
                <option value="">Pilih status</option><option value="No">No (1.0)</option>
                <option value="Yes">Yes (0.9)</option>
              </select>
            </div>
          </div>
          <div className="px-3 py-2 bg-white border-b border-slate-300 flex flex-wrap gap-4 items-center text-[11px]">
            <label>Eye height for Area A: <select value={eyeHeight} disabled={readOnly} onChange={(e) => setEyeHeight(e.target.value as ''|'8'|'14'|'MERSHIP')} className="border rounded px-1"><option value="">Pilih</option><option value="8">8 ft</option><option value="14">14 ft</option><option value="MERSHIP">MERSHIP</option></select></label>
            <label>Urutan pencarian (Figure I-12): <select value={searchNumber} disabled={readOnly} onChange={(e) => setSearchNumber(Number(e.target.value) as SearchNumber | 0)} className="border rounded px-1"><option value={0}>-</option>{[1,2,3,4,5].map((n) => <option key={n} value={n}>{['First','Second','Third','Fourth','Fifth'][n-1]}</option>)}</select></label>
            <span className="text-slate-500">Wu: Table {eyeHeight === 'MERSHIP' ? 'I-4' : 'I-3'} · POD: Figure I-12 (rumus polinomial Excel POD.xls)</span>
          </div>

          {/* Main Evaluation Table: Vessel Sweep Width */}
          <table className="w-full border-collapse text-xs table-fixed">
            <thead>
              <tr className="bg-slate-200/90 text-slate-900 font-bold border-b-2 border-slate-800">
                <th className="py-2 px-3 text-left w-[46%] border-r border-slate-300">
                  Search Height (AGL)
                </th>
                {columns.map((col) => (
                  <th key={col} className="py-2 px-2 text-center w-[18%] border-r border-slate-300 last:border-r-0">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 text-[11px]">
              {/* Row 1: Uncorrected Sweep Width */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div className="font-bold">Uncorrected Sweep Width (Wu) - <span className="font-bold text-blue-700">Tables I-3, I-4</span></div>
                </td>
                {wuList.map((wu, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0">
                    <span className="font-bold text-blue-900 font-mono">{wu.toFixed(1)}</span>{' '}
                    <span className="text-slate-500 text-[10px]">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 2: Weather Correction Factor Fw */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div>Maritime: Weather Correction Factor (Fw) - <span className="font-bold text-blue-700">Table I-7</span></div>
                </td>
                {columns.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {fw.toFixed(2)}
                  </td>
                ))}
              </tr>

              {/* Row 3: Fatigue Correction Factor Ff */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div className="font-semibold">Fatigue Correction Factor (Ff)</div>
                  <div className="text-[10px] text-slate-500">
                    if crew will be suffering significant fatigue enter 0.9, otherwise enter 1.0
                  </div>
                </td>
                {columns.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {ff.toFixed(2)}
                  </td>
                ))}
              </tr>

              {/* Row 4: Sweep Width Factor W = Wu.Fw.Ff */}
              <tr className="bg-blue-50/40">
                <td className="py-1.5 px-3 font-bold text-slate-900 border-r border-slate-300">
                  Sweep Width Factor W = Wu.Fw.Ff
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
                    {s.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} <span className="text-[10px] text-slate-500">NM</span>
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
                    {c.toFixed(2)}{c > 0 && c < 0.5 && <span className="block text-[9px] text-amber-700">C &lt; 0.5</span>}
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
                  Search Area A (SQ NM) <span className="text-[10px] text-slate-500 font-mono">(dari Worksheet 1)</span>
                </td>
                {columns.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-slate-900">
                    {searchAreaA}
                  </td>
                ))}
              </tr>

              {/* Row 9: Search Hours T required */}
              <tr className="bg-slate-100/70 border-b-2 border-slate-900">
                <td className="py-1.5 px-3 font-bold text-slate-900 border-r border-slate-300">
                  <div>Search Hours (T) Required at {vesselSpeedKts} KTS (V)</div>
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
                Total Search Hours Available:
              </span>{' '}
              <input
                type="number"
                step="0.1"
                value={hoursAvailable}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setHoursAvailable(Number(e.target.value) || 0)}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-2 py-0.5 w-16 text-right font-mono"
              />{' '}
              <span className="font-medium text-slate-600">hrs — (from Worksheet No. 7)</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono italic">
              Vessel Search Planning & Trade-offs
            </span>
          </div>

          {/* Area Options A, B, C, D */}
          <div className="p-3 space-y-2.5 text-xs font-mono">
            {/* Option A */}
            <div className="border border-slate-300 rounded p-2 bg-white">
              <div className="font-sans font-bold text-slate-800 text-[11px] mb-1">
                A. Whole Area Calculated at a Search Height of{' '}
                <span className="text-blue-900 font-bold underline">{eyeHeight ? eyeHeight === 'MERSHIP' ? 'MERSHIP' : `Eye height ${eyeHeight} ft` : 'pilih eye height'}</span>{' '}
                <span className="font-normal text-slate-500">(A dari Worksheet 1; C = W/S)</span>
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
            <span className="font-bold font-mono">K-9</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
