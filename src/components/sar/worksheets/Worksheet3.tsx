'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';
import { Printer } from 'lucide-react';
import { readFigureI12, type SearchNumber } from '@/lib/sar/wscPodTables';
import {
  LAND_SEARCH_HEIGHTS,
  LAND_SEARCH_TARGETS,
  LAND_SEARCH_VISIBILITIES,
  lookupLandFv,
  lookupLandWu,
  nearestLandTrackSpacing,
  type LandSearchPlatform,
  type LandSearchTarget,
  type LandVegetation,
} from '@/lib/sar/landSearchTables';

export interface Worksheet3InitialState {
  caseTitle?: string;
  searchObject?: string;
  visibilityKm?: number;
  vegetationType?: LandVegetation | '15-60' | '60-85' | '+85' | '-';
  isFatigue?: boolean | null;
  searchPlatform?: LandSearchPlatform;
  searchNumber?: SearchNumber;
  searchSpeedKts?: number;
  /** Legacy AI field; used only to initialize Search Speed (V). */
  searchTas?: number;
  hoursAvailable?: number;
  searchAreaNm2?: number;
}

interface Worksheet3Props {
  searchResults?: SearchPlanResults | null;
  E?: number;
  readOnly?: boolean;
  initialState?: Worksheet3InitialState;
  onTrackSpacingChange?: (result: { platform: LandSearchPlatform | null; heights: readonly number[]; spacingByHeight: Array<number | null> }) => void;
}

function asLandTarget(value?: string): LandSearchTarget | null {
  if (LAND_SEARCH_TARGETS.some((target) => target.id === value)) return value as LandSearchTarget;
  const normalized = value?.toLowerCase().trim();
  if (normalized === 'aircraft <5700kg' || normalized === 'aircraft < 5700 kg') return 'aircraft-under-5700';
  if (normalized === 'aircraft >5700kg' || normalized === 'aircraft > 5700 kg') return 'aircraft-over-5700';
  return null;
}

function asVegetation(value?: Worksheet3InitialState['vegetationType']): LandVegetation | null {
  if (value === 'under-15' || value === '15-60' || value === '60-85' || value === 'over-85') return value;
  if (value === '+85') return 'over-85';
  return null;
}

export default function Worksheet3({ searchResults, readOnly = false, initialState, onTrackSpacingChange }: Worksheet3Props) {
  const [caseTitle, setCaseTitle] = useState(initialState?.caseTitle ?? '-');
  const [plannerName, setPlannerName] = useState('-');
  const [searchDate, setSearchDate] = useState('-');
  const [searchObject, setSearchObject] = useState<LandSearchTarget | null>(asLandTarget(initialState?.searchObject));
  const [visibilityKm, setVisibilityKm] = useState(initialState?.visibilityKm ?? 0);
  const [vegetationType, setVegetationType] = useState<LandVegetation | null>(asVegetation(initialState?.vegetationType));
  const [isFatigue, setIsFatigue] = useState<boolean | null>(initialState?.isFatigue ?? null);
  const [searchPlatform, setSearchPlatform] = useState<LandSearchPlatform | null>(initialState?.searchPlatform ?? null);
  const [searchNumber, setSearchNumber] = useState<SearchNumber | null>(initialState?.searchNumber ?? null);
  const [searchSpeed, setSearchSpeed] = useState(initialState?.searchSpeedKts ?? initialState?.searchTas ?? 0);
  const [hoursAvailable, setHoursAvailable] = useState(initialState?.hoursAvailable ?? 0);

  const heights = LAND_SEARCH_HEIGHTS;
  const fv = lookupLandFv(searchObject, vegetationType);
  const ff = isFatigue === null ? null : isFatigue ? 0.9 : 1.0;
  const wuList = heights.map((height) => lookupLandWu(searchObject, height, visibilityKm));
  const wFactors = wuList.map((wu) => wu !== null && fv !== null && ff !== null ? Number((wu * fv * ff).toFixed(2)) : null);
  // Worksheet 3 has its own practical-spacing rule. It is intentionally independent of Worksheet 2.
  const trackSpacings = wFactors.map((width) => width !== null && searchPlatform ? nearestLandTrackSpacing(width, searchPlatform) : null);
  const trackSpacingSignature = trackSpacings.map((spacing) => spacing ?? '').join(',');
  useEffect(() => {
    onTrackSpacingChange?.({
      platform: searchPlatform,
      heights,
      spacingByHeight: trackSpacingSignature ? trackSpacingSignature.split(',').map((spacing) => spacing === '' ? null : Number(spacing)) : [],
    });
  }, [onTrackSpacingChange, searchPlatform, trackSpacingSignature]);
  const coverages = wFactors.map((width, index) => width !== null && trackSpacings[index] ? width / trackSpacings[index]! : null);
  const pods = coverages.map((coverage) => coverage !== null && searchNumber !== null ? readFigureI12(coverage, searchNumber) : null);
  const hasSearchArea = (searchResults?.Ao ?? initialState?.searchAreaNm2 ?? 0) > 0;
  const searchAreaA = searchResults?.Ao !== undefined && searchResults.Ao !== null
    ? searchResults.Ao
    : initialState?.searchAreaNm2 ?? 0;
  const hoursRequired = trackSpacings.map((spacing) => spacing && searchSpeed > 0 && hasSearchArea
    ? Number((searchAreaA / (searchSpeed * spacing)).toFixed(1))
    : null);
  const hasBaseInputs = searchObject !== null && visibilityKm > 0 && vegetationType !== null && isFatigue !== null;
  const isCalculationReady = hasBaseInputs && searchPlatform !== null;
  const hasLowCoverage = coverages.some((coverage) => coverage !== null && coverage < 0.5);
  const print = () => { if (typeof window !== 'undefined') window.print(); };

  const renderValue = (value: number | null, digits = 2, unit?: string) => (
    <>
      <span>{value === null ? (hasBaseInputs ? '—' : '0') : value.toFixed(digits)}</span>
      {unit && <span className="ml-1 text-[10px] font-normal text-slate-500">{unit}</span>}
    </>
  );

  return (
    <Card className="border-slate-800 shadow-sm bg-white overflow-hidden text-slate-900 font-sans print:border-none">
      <CardContent className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between border-b-2 border-slate-800 pb-1 text-[11px] font-bold text-slate-700">
          <span>Appendix K – Worksheets</span>
          <button type="button" onClick={print} className="flex items-center gap-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 px-2 py-0.5 rounded border border-slate-300 print:hidden transition-colors">
            <Printer className="h-3 w-3" /> Cetak Lembar Ini
          </button>
        </div>

        <div className="border-2 border-slate-900 rounded bg-white text-xs">
          <div className="grid grid-cols-12 border-b-2 border-slate-900">
            <div className="col-span-3 p-2.5 border-r border-slate-800 flex flex-col justify-between">
              <span className="font-bold text-slate-700 uppercase tracking-wide text-[11px]">Incident Reference</span>
              <input type="text" value={caseTitle} disabled={readOnly} onChange={(e) => setCaseTitle(e.target.value)} className="font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-500 px-1 py-0.5 text-xs w-full mt-1" />
            </div>
            <div className="col-span-5 p-2.5 text-center flex flex-col items-center justify-center border-r border-slate-800 bg-slate-50/70">
              <div className="text-base font-black tracking-wide text-slate-950 uppercase">Search and Rescue</div>
              <div className="text-xs font-bold text-slate-800 uppercase mt-0.5">Worksheet No. 3 (Land)</div>
            </div>
            <div className="col-span-4 p-2.5 flex flex-col justify-between text-[11px] space-y-1">
              <label><span className="text-slate-600">Compiled By: </span><input type="text" value={plannerName} disabled={readOnly} onChange={(e) => setPlannerName(e.target.value)} className="font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-500 px-1 py-0.5 text-xs w-2/3" /></label>
              <label><span className="text-slate-600">Date: </span><input type="text" value={searchDate} disabled={readOnly} onChange={(e) => setSearchDate(e.target.value)} className="font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-500 px-1 py-0.5 text-xs w-2/3 font-mono" /></label>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border-b-2 border-slate-900 p-2.5 bg-slate-50/40 text-[11px] gap-2">
            <label><span className="text-slate-600">Search Object: </span>
              <select value={searchObject ?? ''} disabled={readOnly} onChange={(e) => setSearchObject((e.target.value || null) as LandSearchTarget | null)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs">
                <option value="">-</option>{LAND_SEARCH_TARGETS.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
              </select>
            </label>
            <label><span className="text-slate-600">MET Visibility: </span>
              <select value={visibilityKm || ''} disabled={readOnly} onChange={(e) => setVisibilityKm(Number(e.target.value) || 0)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs">
                <option value="">-</option>{LAND_SEARCH_VISIBILITIES.map((km) => <option key={km} value={km}>{km} km</option>)}
              </select>
            </label>
            <label><span className="text-slate-600">Vegetation: </span>
              <select value={vegetationType ?? ''} disabled={readOnly} onChange={(e) => setVegetationType((e.target.value || null) as LandVegetation | null)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs">
                <option value="">-</option><option value="under-15">&lt;15% open/scattered timber</option><option value="15-60">15–60% medium forest/scrub</option><option value="60-85">60–85% dense forest/scrub</option><option value="over-85">&gt;85% rain forest</option>
              </select>
            </label>
            <label><span className="text-slate-600">Fatigue: </span>
              <select value={isFatigue === null ? '' : isFatigue ? 'Yes' : 'No'} disabled={readOnly} onChange={(e) => setIsFatigue(e.target.value === 'Yes' ? true : e.target.value === 'No' ? false : null)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs">
                <option value="">-</option><option value="No">No (Ff 1.0)</option><option value="Yes">Yes (Ff 0.9)</option>
              </select>
            </label>
            <label><span className="text-slate-600">Search Platform: </span>
              <select value={searchPlatform ?? ''} disabled={readOnly} onChange={(e) => setSearchPlatform((e.target.value || null) as LandSearchPlatform | null)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs">
                <option value="">-</option><option value="fixed-wing">Fixed Wing (S interval 0.5 NM)</option><option value="helicopter">Helicopter (S interval 0.25 NM)</option>
              </select>
            </label>
            <label><span className="text-slate-600">Search Number: </span>
              <select value={searchNumber ?? ''} disabled={readOnly} onChange={(e) => setSearchNumber(e.target.value ? Number(e.target.value) as SearchNumber : null)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-xs">
                <option value="">-</option>{([1, 2, 3, 4, 5] as const).map((number) => <option key={number} value={number}>{number}{number === 1 ? 'st' : number === 2 ? 'nd' : number === 3 ? 'rd' : 'th'} Search</option>)}
              </select>
            </label>
            <label><span className="text-slate-600">Search Speed V: </span><input type="number" min="0" value={searchSpeed} disabled={readOnly} onChange={(e) => setSearchSpeed(Number(e.target.value) || 0)} className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-16 text-right font-mono" /> <span className="font-semibold text-slate-700">Kts</span></label>
          </div>

          <table className="w-full border-collapse text-xs table-fixed">
            <thead><tr className="bg-slate-200/90 text-slate-900 font-bold border-b-2 border-slate-800">
              <th className="py-2 px-3 text-left w-[40%] border-r border-slate-300">Search Height (AGL)</th>
              {heights.map((height) => <th key={height} className="py-2 px-2 text-center w-[15%] border-r border-slate-300 last:border-r-0">{height} ft</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-300 text-[11px]">
              <tr><td className="py-1.5 px-3 font-medium border-r border-slate-300">Uncorrected Sweep Width Wu — Table I-9</td>{wuList.map((wu, i) => <td key={heights[i]} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-bold text-blue-900 font-mono">{wu === null ? (searchObject === 'person' && heights[i] >= 1500 ? 'N/A' : '0') : wu.toFixed(1)}{wu !== null && <span className="ml-1 text-[10px] font-normal text-slate-500">NM</span>}</td>)}</tr>
              <tr><td className="py-1.5 px-3 border-r border-slate-300">Vegetation/Terrain Factor Fv — Table I-10</td>{heights.map((height) => <td key={height} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">{fv === null ? '0' : fv.toFixed(2)}</td>)}</tr>
              <tr><td className="py-1.5 px-3 border-r border-slate-300">Fatigue Factor Ff</td>{heights.map((height) => <td key={height} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">{ff === null ? '0' : ff.toFixed(2)}</td>)}</tr>
              <tr className="bg-blue-50/40"><td className="py-1.5 px-3 font-bold border-r border-slate-300">Corrected Sweep Width W = Wu × Fv × Ff</td>{wFactors.map((width, i) => <td key={heights[i]} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-950">{renderValue(width, 2, width === null ? undefined : 'NM')}</td>)}</tr>
              <tr><td className="py-1.5 px-3 border-r border-slate-300">Practical Track Spacing S (Worksheet 3 rule)</td>{trackSpacings.map((spacing, i) => <td key={heights[i]} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-slate-800">{renderValue(spacing, 2, spacing === null ? undefined : 'NM')}</td>)}</tr>
              <tr><td className="py-1.5 px-3 border-r border-slate-300">Coverage Factor C = W/S</td>{coverages.map((coverage, i) => <td key={heights[i]} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-indigo-900">{renderValue(coverage)}</td>)}</tr>
              <tr className="bg-emerald-50/50"><td className="py-1.5 px-3 font-bold text-emerald-950 border-r border-slate-300">Probability of Detection (POD) — Figure I-12</td>{pods.map((pod, i) => <td key={heights[i]} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-black text-emerald-900">{pod === null ? (hasBaseInputs ? '—' : '0') : `${Math.round(pod)}%`}</td>)}</tr>
              <tr><td className="py-1.5 px-3 border-r border-slate-300">Search Area A (from Worksheet 1) — NM²</td>{heights.map((height) => <td key={height} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-slate-900">{hasSearchArea ? searchAreaA.toFixed(2) : hasBaseInputs ? '—' : 0}</td>)}</tr>
              <tr className="bg-slate-100/70 border-b-2 border-slate-900"><td className="py-1.5 px-3 font-bold border-r border-slate-300"><div>Search Hours T Required</div><div className="text-[10px] text-slate-600 font-mono">T = A/(V × S)</div></td>{hoursRequired.map((hours, i) => <td key={heights[i]} className="py-1.5 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">{hours === null ? (hasBaseInputs ? '—' : '0') : hours.toFixed(1)}{hours !== null && <span className="ml-1 text-[10px] font-normal text-slate-600">hrs</span>}</td>)}</tr>
            </tbody>
          </table>

          {hasLowCoverage && <div role="alert" className="mx-3 mt-2 rounded border border-amber-400 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900">Coverage C &lt; 0.5 pada satu atau lebih ketinggian. Panduan menyatakan pencarian di bawah C = 0.5 tidak memuaskan dan tidak direkomendasikan.</div>}
          {hasBaseInputs && !searchPlatform && <div className="mx-3 mt-2 text-[11px] text-amber-800">Pilih platform untuk menghitung S dengan aturan Worksheet 3.</div>}
          {isCalculationReady && searchNumber === null && <div className="mx-3 mt-2 text-[11px] text-amber-800">Pilih Search Number untuk membaca POD dari Figure I-12.</div>}

          <div className="p-2.5 bg-slate-50 border-b-2 border-slate-900 text-xs flex flex-wrap items-center justify-between gap-2">
            <div><span className="font-bold text-slate-800">Total Search Hours Available:</span>{' '}<input type="number" step="0.1" value={hoursAvailable} disabled={readOnly} onChange={(e) => setHoursAvailable(Number(e.target.value) || 0)} className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-2 py-0.5 w-16 text-right font-mono" />{' '}<span className="font-medium text-slate-600">hrs — input terpisah; tidak digunakan pada rumus di atas</span></div>
            <span className="text-[10px] text-slate-500 font-mono italic">Land Search Worksheet</span>
          </div>
          <div className="px-3 py-2 text-[11px] text-slate-500 italic">Opsi A–D tidak dihitung pada Worksheet 3. T dihitung hanya jika Search Area A dan Search Speed V tersedia.</div>
          <div className="p-2 border-t border-slate-800 bg-slate-100 flex items-center justify-between text-[11px] text-slate-600"><span className="italic">Land Search Worksheet</span><span className="font-bold font-mono">K-4</span></div>
        </div>
      </CardContent>
    </Card>
  );
}
