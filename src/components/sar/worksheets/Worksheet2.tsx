'use client';

import { printActiveWorksheetFit } from '@/lib/sar/printFit';
import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { type LatLng } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import type { DatumData, DatumResults } from '@/components/sar/DatumWorksheet';
import { Printer } from 'lucide-react';
import { computeW2Row, readFigureI12, W2_TARGET_OPTIONS, W2_VISIBILITY_LABELS, type W2Target, type SearchNumber } from '@/lib/sar/wscPodTables';

export interface Worksheet2InitialState {
  caseTitle?: string;
  /** Nama SRU/alut pemilik lembar ini (multi-SRU: 1 alut = 1 lembar). Komponen mengabaikannya. */
  sruName?: string;
  searchPlatform?: 'fixed-wing' | 'helicopter';
  searchTas?: number;
  searchObject?: W2Target;
  visibilityIndex?: number;
  isFatigue?: 'Yes' | 'No';
  piwFlotationKnown?: boolean;
  searchNumber?: SearchNumber;
  selectedHeight?: 500 | 1000 | 1500 | 2000;
  /** Angin permukaan SESUAI SOAL KASUS (analisa AI Asisten) untuk header.
   *  Bila ada, header menampilkan nilai ini (label "Kasus"); bila tidak,
   *  header fallback ke angin ASW. Kalkulasi WSC/POD tetap memakai ASW. */
  caseWindDirFrom?: number;
  caseWindSpeed?: number;
}

interface Worksheet2Props {
  lkp: LatLng;
  datumData: DatumData | null;
  datumResults: DatumResults | null;
  aswDirFrom: number;
  ws1Ao?: number;
  readOnly?: boolean;
  initialState?: Worksheet2InitialState;
  onTrackSpacingChange?: (result: { platform: 'fixed-wing' | 'helicopter' | null; spacingNm: number; selection: string }) => void;
}

export default function Worksheet2({
  lkp,
  datumData,
  datumResults,
  aswDirFrom,
  ws1Ao = 0,
  readOnly = false,
  initialState,
  onTrackSpacingChange,
}: Worksheet2Props) {
  // Case & Metadata state
  const [caseTitle, setCaseTitle] = useState(initialState?.caseTitle ?? '-');
  const [plannerName, setPlannerName] = useState('-');
  const [searchDate, setSearchDate] = useState('-');
  const [searchPlatform, setSearchPlatform] = useState<'' | 'fixed-wing' | 'helicopter'>(initialState?.searchPlatform ?? '');
  const [searchTas, setSearchTas] = useState(initialState?.searchTas ?? 0);
  const [searchObject, setSearchObject] = useState<W2Target | ''>(initialState?.searchObject ?? '');
  const [visibilityIndex, setVisibilityIndex] = useState(initialState?.visibilityIndex ?? -1);
  const [isFatigue, setIsFatigue] = useState<'' | 'Yes' | 'No'>(initialState?.isFatigue ?? '');
  const [piwFlotationKnown, setPiwFlotationKnown] = useState(initialState?.piwFlotationKnown ?? false);
  const [searchNumber, setSearchNumber] = useState<SearchNumber | 0>(initialState?.searchNumber ?? 0);
  const [selectedHeight, setSelectedHeight] = useState<500 | 1000 | 1500 | 2000 | 0>(initialState?.selectedHeight ?? 0);
  const windKts = datumData?.aswSpeed ?? 0;
  // Header wind: prioritas angin dari soal kasus (analisa AI Asisten),
  // fallback ke angin ASW bila kasus tidak menyebut angin permukaan.
  const caseWindDirFrom = initialState?.caseWindDirFrom;
  const caseWindSpeed = initialState?.caseWindSpeed;
  const hasCaseWind = caseWindDirFrom !== undefined || caseWindSpeed !== undefined;
  const headerWindDir = hasCaseWind ? (caseWindDirFrom ?? aswDirFrom) : aswDirFrom;
  const headerWindKts = hasCaseWind ? (caseWindSpeed ?? windKts) : windKts;
  const heights = [500, 1000, 1500, 2000];
  const targetMeta = W2_TARGET_OPTIONS.find((target) => target.id === searchObject); // UI: ceklis PIW
  // Math diekstraksi ke lib (PHASE 3): computeW2Row — rumus identik dengan versi inline sebelumnya.
  const w2Rows = heights.map((height) => computeW2Row({
    platform: searchPlatform,
    target: searchObject,
    heightFt: height as 500 | 1000 | 1500 | 2000,
    visibilityIndex,
    windKts,
    tasKts: searchTas,
    fatigue: isFatigue,
    searchNumber,
    piwFlotationKnown,
    areaAoNm2: ws1Ao,
  }));
  const fw = w2Rows[0].fw;
  const fs = w2Rows[0].fs;
  const ff = w2Rows[0].ff;
  const wuList = w2Rows.map((r) => r.Wu);
  const factorsReady = w2Rows[0].ready;
  const wFactors = w2Rows.map((r) => r.W);
  const trackSpacings = w2Rows.map((r) => r.S);
  const coverages = w2Rows.map((r) => r.C);
  const pods = w2Rows.map((r) => r.POD);

  // Search Area A from Worksheet 1 Ao
  const searchAreaAo = ws1Ao;

  // Search Hours T required: T = A / (V * S) — dihitung di computeW2Row (lib)
  const hoursRequired = w2Rows.map((r) => r.T);

  // Available search hours (e.g. from 2 sorties of 2.5 hrs = 5.0 hrs)
  const [hoursAvailable, setHoursAvailable] = useState(0);

  // Sections A, B, C, D calculations based on chosen height (1000 ft -> idx 1)
  const selIdx = heights.indexOf(selectedHeight);
  const selW = selIdx >= 0 ? wFactors[selIdx] : 0;
  const selS = selIdx >= 0 ? trackSpacings[selIdx] : 0;
  const selC = selIdx >= 0 ? coverages[selIdx] : 0;
  const selP = selIdx >= 0 ? pods[selIdx] : 0;

  useEffect(() => {
    onTrackSpacingChange?.({
      platform: searchPlatform || null,
      spacingNm: selS,
      selection: selectedHeight ? `${selectedHeight} ft` : 'belum dipilih',
    });
  }, [onTrackSpacingChange, searchPlatform, selectedHeight, selS]);

  // Option A: Whole Area at chosen height
  const optA_Area = searchAreaAo;
  const optA_S = selS;
  const optA_C = selC;
  const optA_P = selP;

  // Option B: Modified Area at Calculated Spacing in Available Hours (A = T * V * S)
  const optB_Area = hoursAvailable * searchTas * selS;
  const optB_S = selS;
  const optB_C = selC;
  const optB_P = selP;

  // Option C: Whole Area at Modified Track Spacing in Available Hours (S = A / (V * T))
  const optC_S = searchTas > 0 && hoursAvailable > 0 ? searchAreaAo / (searchTas * hoursAvailable) : 0;
  const optC_C = optC_S > 0 ? selW / optC_S : 0;
  const optC_P = factorsReady ? readFigureI12(optC_C, searchNumber || 1) : 0;

  // Option D compromises
  const optD_variations = [
    { sMod: selS * 0.8, name: '(i)' },
    { sMod: selS * 1.0, name: '(ii)' },
    { sMod: selS * 1.2, name: '(iii)' },
    { sMod: selS * 1.5, name: '(iv)' },
  ].map((item) => {
    const s = Number(item.sMod.toFixed(1));
    const a = hoursAvailable * searchTas * s;
    const c = s > 0 ? selW / s : 0;
    const p = factorsReady ? readFigureI12(c, searchNumber || 1) : 0;
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

            {/* Center: Search and Rescue - Worksheet No. 2 (Maritime) */}
            <div className="col-span-5 p-2.5 text-center flex flex-col items-center justify-center border-r border-slate-800 bg-slate-50/70">
              <div className="text-base font-black tracking-wide text-slate-950 uppercase">
                Search and Rescue
              </div>
              <div className="text-xs font-bold text-slate-800 uppercase mt-0.5">
                Worksheet No. 2 (Maritime)
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
              <select
                value={searchPlatform}
                disabled={readOnly}
                onChange={(e) => setSearchPlatform(e.target.value as '' | 'fixed-wing' | 'helicopter')}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1 w-44"
              ><option value="">Pilih platform</option><option value="fixed-wing">Fixed Wing</option><option value="helicopter">Helicopter</option></select>
            </div>
            <div>
              <span className="text-slate-600">Search Platform TAS: </span>
              <input
                type="number"
                value={searchTas}
                disabled={readOnly}
                suppressHydrationWarning
                onChange={(e) => setSearchTas(Number(e.target.value) || 0)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-16 text-right font-mono"
              />{' '}
              <span className="font-semibold text-slate-700">Kts</span>
            </div>
            <div>
              <span className="text-slate-600">Search Object: </span>
              <select
                value={searchObject}
                disabled={readOnly}
                onChange={(e) => setSearchObject(e.target.value as W2Target | '')}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1 w-48"
              ><option value="">Pilih Search Object</option>{W2_TARGET_OPTIONS.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select>
            </div>

            <div>
              <span className="text-slate-600">MET Visibility: </span>
              <select
                value={visibilityIndex}
                disabled={readOnly}
                onChange={(e) => setVisibilityIndex(Number(e.target.value))}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1 w-20"
              ><option value={-1}>Pilih km</option>{W2_VISIBILITY_LABELS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select>
              <span className="font-semibold text-slate-700">KM</span>
            </div>
            <div>
              <span className="text-slate-600">Wind: </span>
              <span className="font-bold text-blue-900 font-mono px-1">
                {headerWindDir.toString().padStart(3, '0')}°
              </span>{' '}
              / <span className="font-bold text-blue-900 font-mono">{headerWindKts.toFixed(1)}</span> <span className="font-semibold text-slate-700">Kts ({hasCaseWind ? 'Kasus' : 'ASW'})</span>
            </div>
            <div>
              <span className="text-slate-600">Fatigue Factor: </span>
              <select
                value={isFatigue}
                disabled={readOnly}
                onChange={(e) => setIsFatigue(e.target.value as '' | 'Yes' | 'No')}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs"
              >
                <option value="">Pilih status</option>
                <option value="No">No (1.0)</option>
                <option value="Yes">Yes (0.9)</option>
              </select>
            </div>
              <div><span className="text-slate-600">Figure I-12 Search: </span><select value={searchNumber} disabled={readOnly} onChange={(e) => setSearchNumber(Number(e.target.value) as SearchNumber | 0)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5"><option value={0}>-</option><option value={1}>First</option><option value={2}>Second</option><option value={3}>Third</option><option value={4}>Fourth</option><option value={5}>Fifth</option></select></div>
            <div><span className="text-slate-600">Height for Area A: </span><select value={selectedHeight} disabled={readOnly} onChange={(e) => setSelectedHeight(Number(e.target.value) as 0 | 500 | 1000 | 1500 | 2000)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5"><option value={0}>Pilih ft</option>{heights.map((height) => <option key={height} value={height}>{height} ft</option>)}</select></div>
            {targetMeta?.isPiw && <label className="flex items-center gap-1 text-slate-700"><input type="checkbox" checked={piwFlotationKnown} disabled={readOnly} onChange={(e) => setPiwFlotationKnown(e.target.checked)} /> PIW menggunakan flotation device (Table I-5/I-6 note; hanya 500 ft)</label>}
            {searchPlatform && searchTas > 0 && fs === 0 && <p className="text-[10px] text-amber-800">TAS tidak cocok dengan kolom Table I-8 untuk platform ini; perlukan keputusan planner, tidak dilakukan interpolasi.</p>}
            <span className="text-[10px] text-slate-500">POD dari kurva Figure I-12 — dihitung dengan rumus polinomial Excel POD.xls (bukan lagi estimasi pembacaan kurva digital).</span>
          </div>

          {/* Main Evaluation Table: Multi-Altitude Sweep Width */}
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
                  <div className="font-bold">Uncorrected Sweep Width (Wu)</div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    -Tables I-3, I-4, I-5 (1), I-5 (2), I-6 (1), I-6 (2)
                  </div>
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
                {heights.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {fw.toFixed(2)}
                  </td>
                ))}
              </tr>

              {/* Row 3: Speed Correction Factor Fs */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div className="font-semibold">Speed Correction Factor (Fs)</div>
                  <div className="text-[10px] text-slate-500">
                    a) Aircraft searching over water use Fs from Table I-8
                    <br />
                    b) Searches by vessels enter 1.0
                  </div>
                </td>
                {heights.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {fs.toFixed(2)}
                  </td>
                ))}
              </tr>

              {/* Row 4: Fatigue Correction Factor Ff */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div className="font-semibold">Fatigue Correction Factor (Ff)</div>
                  <div className="text-[10px] text-slate-500">
                    if crew will be suffering significant fatigue enter 0.9, otherwise enter 1.0
                  </div>
                </td>
                {heights.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    {ff.toFixed(2)}
                  </td>
                ))}
              </tr>

              {/* Row 5: Sweep Width Factor W */}
              <tr className="bg-blue-50/40">
                <td className="py-1.5 px-3 font-bold text-slate-900 border-r border-slate-300">
                  Sweep Width Factor W = Wu.Fw.Fs.Ff
                </td>
                {wFactors.map((w, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-950 text-xs">
                    {w.toFixed(2)} <span className="text-[10px] font-normal text-slate-600">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 6: Practical Track Spacing S */}
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

              {/* Row 7: Coverage Factor C */}
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

              {/* Row 8: Probability of Detection (POD) */}
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

              {/* Row 9: Search Area A */}
              <tr>
                <td className="py-1.5 px-3 font-medium text-slate-800 border-r border-slate-300">
                  Search Area A (SQ NM) <span className="text-[10px] text-slate-500 font-mono">(dari Worksheet 1)</span>
                </td>
                {heights.map((_, i) => (
                  <td key={i} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-slate-900">
                    {searchAreaAo}
                  </td>
                ))}
              </tr>

              {/* Row 10: Search Hours (T) Required at 120 KTS */}
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
                onChange={(e) => setHoursAvailable(Number(e.target.value) || 0)}
                className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-2 py-0.5 w-16 text-right font-mono"
              />{' '}
              <span className="font-medium text-slate-600">hrs — (from Worksheet No. 6)</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono italic">
              Area Search Planning & Trade-offs
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
                  <span className="font-bold text-blue-900">{searchAreaAo}</span>
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
            <span className="font-bold font-mono">K-3</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
