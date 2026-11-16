'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';
import { Printer } from 'lucide-react';
import CoordinateInput from '@/components/sar/CoordinateInput';
import { bearingDeg, distanceNm, project, rectangleCorners, type LatLng } from '@/lib/sar/sarCalculations';
import type { MapCircle, MapLine, MapMarker, MapPolygon } from '@/components/sar/SeaMap';

const Worksheet4Map = dynamic(() => import('@/components/sar/SeaMap'), { ssr: false });

export type Worksheet4TrStartMode = 'manual' | 'elapsed-time';
export type Worksheet4TargetNavigation = 'self-contained' | 'other-aircraft' | 'dead-reckoning' | 'custom';
export interface Worksheet4Waypoint {
  name: string;
  lat: number;
  lng: number;
  active: boolean;
}

export interface Worksheet4InitialState {
  caseTitle?: string;
  searchDate?: string;
  callsign?: string;
  searchNo?: string;
  commenceUtc?: string;
  latitude?: number;
  longitude?: number;
  distressTimeUtc?: string;
  trStartMode?: Worksheet4TrStartMode;
  initialTrNm?: number;
  elapsedMinutesSinceLastFix?: number;
  targetTasKts?: number;
  routeLegDistancesNm?: [number, number, number];
  routePoints?: [Worksheet4Waypoint, Worksheet4Waypoint, Worksheet4Waypoint, Worksheet4Waypoint];
  trList?: [number, number, number, number];
  fixErrors?: [number, number, number, number];
  targetNavigationType?: Worksheet4TargetNavigation;
  applyDre?: boolean;
  yNavError?: number;
  safetyFactor?: 1.1 | 1.6 | 2 | 2.3 | 2.5;
}

interface Worksheet4Props {
  searchResults?: SearchPlanResults | null;
  E?: number;
  divergenceDistance?: number;
  readOnly?: boolean;
  initialState?: Worksheet4InitialState;
}

export default function Worksheet4({
  searchResults,
  E = 0,
  divergenceDistance = 0,
  readOnly = false,
  initialState,
}: Worksheet4Props) {
  // Case & Metadata state
  const [caseTitle, setCaseTitle] = useState(initialState?.caseTitle ?? '-');
  const [plannerName, setPlannerName] = useState('-');
  const [searchDate, setSearchDate] = useState(initialState?.searchDate ?? '-');
  const [callsign, setCallsign] = useState(initialState?.callsign ?? '-');
  const [searchNo, setSearchNo] = useState(initialState?.searchNo ?? '0');
  const [commenceUtc, setCommenceUtc] = useState(initialState?.commenceUtc ?? '-');
  const [prevSearchNo, setPrevSearchNo] = useState('-');
  const [prevCommenceUtc, setPrevCommenceUtc] = useState('-');

  // Position fixes / reports
  const [latitude, setLatitude] = useState(initialState?.latitude ?? 0);
  const [longitude, setLongitude] = useState(initialState?.longitude ?? 0);
  const [distressTimeUtc, setDistressTimeUtc] = useState(initialState?.distressTimeUtc ?? '-');
  const [trStartMode, setTrStartMode] = useState<Worksheet4TrStartMode>(initialState?.trStartMode ?? 'manual');
  const [initialTrNm, setInitialTrNm] = useState(initialState?.initialTrNm ?? initialState?.trList?.[0] ?? 0);
  const [elapsedMinutesSinceLastFix, setElapsedMinutesSinceLastFix] = useState(initialState?.elapsedMinutesSinceLastFix ?? 0);
  const [targetTasKts, setTargetTasKts] = useState(initialState?.targetTasKts ?? 0);
  const legacyRouteLegs: [number, number, number] | undefined = initialState?.trList
    ? [initialState.trList[1] - initialState.trList[0], initialState.trList[2] - initialState.trList[1], initialState.trList[3] - initialState.trList[2]]
    : undefined;
  const initialRouteLegs: [number, number, number] = initialState?.routeLegDistancesNm?.some((distance) => distance > 0)
    ? initialState.routeLegDistancesNm
    : legacyRouteLegs ?? initialState?.routeLegDistancesNm ?? [0, 0, 0];
  const [routeLegDistancesNm, setRouteLegDistancesNm] = useState<[number, number, number]>(initialRouteLegs);
  const [routePoints, setRoutePoints] = useState<[Worksheet4Waypoint, Worksheet4Waypoint, Worksheet4Waypoint, Worksheet4Waypoint]>(initialState?.routePoints ?? [
    { name: 'Titik awal / lost contact', lat: 0, lng: 0, active: false },
    { name: 'Last Reported Position', lat: 0, lng: 0, active: false },
    { name: 'Missed Position', lat: 0, lng: 0, active: false },
    { name: 'Next Position / Destination', lat: 0, lng: 0, active: false },
  ]);
  const [fixErrors, setFixErrors] = useState<[number, number, number, number]>(initialState?.fixErrors ?? [0, 0, 0, 0]);
  const [targetNavigationType, setTargetNavigationType] = useState<Worksheet4TargetNavigation | null>(initialState?.targetNavigationType ?? null);
  const [applyDre, setApplyDre] = useState(initialState?.applyDre ?? false);
  const [yNavError, setYNavError] = useState(initialState?.yNavError ?? 0);
  const [safetyFactor, setSafetyFactor] = useState(initialState?.safetyFactor ?? 0);

  const pointDerivedLegs = routePoints.slice(0, 3).map((point, index) => {
    const next = routePoints[index + 1];
    return point.active && next.active ? distanceNm(point, next) : 0;
  }) as [number, number, number];
  const effectiveLegDistances = routeLegDistancesNm.map((distance, index) => distance > 0 ? distance : pointDerivedLegs[index]) as [number, number, number];
  const trA = trStartMode === 'elapsed-time'
    ? Number((targetTasKts * elapsedMinutesSinceLastFix / 60).toFixed(2))
    : initialTrNm;
  const trList: [number, number, number, number] = [
    trA,
    trA + effectiveLegDistances[0],
    trA + effectiveLegDistances[0] + effectiveLegDistances[1],
    trA + effectiveLegDistances[0] + effectiveLegDistances[1] + effectiveLegDistances[2],
  ].map((value) => Number(value.toFixed(2))) as [number, number, number, number];
  const fixBaseline = targetNavigationType === 'self-contained' ? 5 : targetNavigationType === 'other-aircraft' ? 10 : null;
  const xValues = trList.map((tr, i) => {
    const x = fixBaseline ?? (targetNavigationType === 'dead-reckoning' ? fixErrors[i] + 0.1 * tr : targetNavigationType === 'custom' ? fixErrors[i] : 0);
    return Number(x.toFixed(2));
  });
  // e = sqrt(x^2 + y^2)
  const eValues = xValues.map((x) => Number(Math.sqrt(x * x + yNavError * yNavError).toFixed(2)));
  // R = e * fs
  const rValues = eValues.map((e) => Number((e * safetyFactor).toFixed(2)));
  // Rounded up radius
  const roundedRValues = rValues.map((r) => Math.ceil(r));

  const mappedPoints = routePoints.map((point, index) => point.active && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
    ? { point: { lat: point.lat, lng: point.lng }, index, name: point.name }
    : null);
  const activeMappedPoints = mappedPoints.filter((item) => item !== null) as Array<{ point: LatLng; index: number; name: string }>;
  const dreGeometryEnabled = applyDre && targetNavigationType === 'dead-reckoning';
  const mapSpanNm = activeMappedPoints.reduce((maxDistance, item, index) => Math.max(
    maxDistance,
    ...activeMappedPoints.slice(index + 1).map((next) => distanceNm(item.point, next.point)),
  ), 0);
  const mapCenter = activeMappedPoints.length
    ? {
      lat: activeMappedPoints.reduce((sum, item) => sum + item.point.lat, 0) / activeMappedPoints.length,
      lng: activeMappedPoints.reduce((sum, item) => sum + item.point.lng, 0) / activeMappedPoints.length,
    }
    : { lat: latitude, lng: longitude };
  const mapZoom = mapSpanNm <= 45 ? 10 : mapSpanNm <= 180 ? 8 : mapSpanNm <= 500 ? 6 : 4;
  const ws4Markers: MapMarker[] = activeMappedPoints.map(({ point, index, name }) => ({
    position: point, label: `${String.fromCharCode(65 + index)} · ${name}`, showLabel: true,
    color: ['#dc2626', '#ea580c', '#7c3aed', '#2563eb'][index], sequence: index + 1,
  }));
  const ws4Circles: MapCircle[] = activeMappedPoints.filter(({ index }) => roundedRValues[index] > 0).map(({ point, index }) => ({
    center: point, radiusNm: roundedRValues[index], color: ['#dc2626', '#ea580c', '#7c3aed', '#2563eb'][index],
    fillColor: ['#dc2626', '#ea580c', '#7c3aed', '#2563eb'][index], fillOpacity: 0.08,
    label: `${String.fromCharCode(65 + index)} · Rounded Radius ${roundedRValues[index]} NM`,
  }));
  const ws4Lines: MapLine[] = activeMappedPoints.slice(1).map((item, i) => ({
    from: activeMappedPoints[i].point, to: item.point, color: '#334155', label: `Route ${String.fromCharCode(65 + activeMappedPoints[i].index)}–${String.fromCharCode(65 + item.index)}`,
  }));
  const ws4Polygons: MapPolygon[] = useMemo(() => {
    if (activeMappedPoints.length === 1) {
      const { point, index } = activeMappedPoints[0];
      const radius = roundedRValues[index];
      return radius > 0 ? [{ points: rectangleCorners(point, radius * 2, radius * 2, 0), color: '#0f766e', fillColor: '#0f766e', fillOpacity: 0.04, label: `Kemungkinan Area ${String.fromCharCode(65 + index)} · square ${radius * 2} NM` }] : [];
    }
    const polygons: MapPolygon[] = [];
    for (let i = 0; i < activeMappedPoints.length - 1; i++) {
      const a = activeMappedPoints[i];
      const b = activeMappedPoints[i + 1];
      const rA = roundedRValues[a.index];
      const rB = roundedRValues[b.index];
      if (rA <= 0 || rB <= 0) continue;
      const course = bearingDeg(a.point, b.point);
      const centerA = dreGeometryEnabled ? a.point : project(a.point, (course + 180) % 360, rA);
      const centerB = dreGeometryEnabled ? b.point : project(b.point, course, rB);
      const halfWidthA = dreGeometryEnabled ? rA : Math.max(rA, rB);
      const halfWidthB = dreGeometryEnabled ? rB : Math.max(rA, rB);
      polygons.push({
        points: [
          project(centerA, (course + 270) % 360, halfWidthA),
          project(centerB, (course + 270) % 360, halfWidthB),
          project(centerB, (course + 90) % 360, halfWidthB),
          project(centerA, (course + 90) % 360, halfWidthA),
        ],
        color: dreGeometryEnabled ? '#7c3aed' : '#0f766e', fillColor: dreGeometryEnabled ? '#7c3aed' : '#0f766e', fillOpacity: 0.06,
        label: dreGeometryEnabled ? `Trapezium DRe ${String.fromCharCode(65 + a.index)}–${String.fromCharCode(65 + b.index)}` : `Koridor pencarian ${String.fromCharCode(65 + a.index)}–${String.fromCharCode(65 + b.index)}`,
      });
    }
    return polygons;
  }, [activeMappedPoints, dreGeometryEnabled, roundedRValues]);

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
                <span className="text-slate-600">A. Titik awal: </span>
                <span className="font-bold text-blue-900 font-mono text-[10px]">{routePoints[0].name}</span>
              </div>
              <div className="truncate">
                <span className="text-slate-600">B. Last Reported Posn: </span>
                <span className="font-bold text-blue-900 font-mono text-[10px]">{routePoints[1].name}</span>
              </div>
              <div className="truncate">
                <span className="text-slate-600">C. Missed position: </span>
                <span className="font-bold text-blue-900 font-mono text-[10px]">{routePoints[2].name}</span>
              </div>
              <div className="truncate">
                <span className="text-slate-600">D. Next Posn / Destination: </span>
                <span className="font-bold text-blue-900 font-mono text-[10px]">{routePoints[3].name}</span>
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
              <label className="text-[10px] text-slate-600 font-mono mt-1 flex items-center gap-1">
                Nav Error (y):
                <input type="number" min="0" step="0.1" value={yNavError} disabled={readOnly} onChange={(e) => setYNavError(Number(e.target.value) || 0)} className="w-14 border-b border-dotted border-slate-500 bg-white px-1 text-right font-bold text-blue-900" /> NM
              </label>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 border-b-2 border-slate-900 bg-slate-50/50 p-3 text-[11px]">
            <section className="space-y-2">
              <h3 className="font-bold text-slate-800">Perhitungan Tr Kumulatif</h3>
              <label className="flex flex-wrap items-center gap-2">
                <span>Sumber Tr A:</span>
                <select value={trStartMode} disabled={readOnly} onChange={(e) => setTrStartMode(e.target.value as Worksheet4TrStartMode)} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-blue-900">
                  <option value="manual">Jarak langsung sejak Last Positive Fix</option>
                  <option value="elapsed-time">TAS × waktu sejak Last Positive Fix</option>
                </select>
              </label>
              {trStartMode === 'elapsed-time' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label>TAS target (kts) <input type="number" min="0" step="1" value={targetTasKts} disabled={readOnly} onChange={(e) => setTargetTasKts(Number(e.target.value) || 0)} className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right font-mono" /></label>
                  <label>Waktu sejak last fix (menit) <input type="number" min="0" step="1" value={elapsedMinutesSinceLastFix} disabled={readOnly} onChange={(e) => setElapsedMinutesSinceLastFix(Number(e.target.value) || 0)} className="w-16 rounded border border-slate-300 px-1 py-0.5 text-right font-mono" /></label>
                  <span className="font-bold text-blue-900">Tr A = V × T/60 = {trA.toFixed(2)} NM</span>
                </div>
              ) : (
                <label>Tr A (jarak awal) <input type="number" min="0" step="0.1" value={initialTrNm} disabled={readOnly} onChange={(e) => setInitialTrNm(Number(e.target.value) || 0)} className="w-20 rounded border border-slate-300 px-1 py-0.5 text-right font-mono" /> NM <span className="text-slate-500">(lost contact saat baru take off: 0 NM)</span></label>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {([0, 1, 2] as const).map((legIndex) => (
                  <label key={legIndex} className="rounded border border-slate-200 bg-white p-2">
                    Jarak {String.fromCharCode(65 + legIndex)}→{String.fromCharCode(66 + legIndex)} (NM)
                    <input type="number" min="0" step="0.1" value={routeLegDistancesNm[legIndex] > 0 ? routeLegDistancesNm[legIndex] : Number(pointDerivedLegs[legIndex].toFixed(2))} disabled={readOnly} onChange={(e) => setRouteLegDistancesNm((prev) => { const next = [...prev] as [number, number, number]; next[legIndex] = Number(e.target.value) || 0; return next; })} className="mt-1 w-full rounded border border-slate-300 px-1 py-0.5 text-right font-mono" />
                    {routeLegDistancesNm[legIndex] === 0 && pointDerivedLegs[legIndex] > 0 && <span className="text-[9px] text-slate-500">Dihitung dari koordinat waypoint</span>}
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">Tr B = Tr A + jarak A–B; Tr C dan D meneruskan penjumlahan setiap segmen rute.</p>
            </section>

            <section className="space-y-2">
              <h3 className="font-bold text-slate-800">Navigational Error Target (x)</h3>
              <label className="flex flex-wrap items-center gap-2">
                <span>Metode navigasi target:</span>
                <select value={targetNavigationType ?? ''} disabled={readOnly} onChange={(e) => setTargetNavigationType((e.target.value || null) as Worksheet4TargetNavigation | null)} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-blue-900">
                  <option value="">-</option><option value="self-contained">GPS / self-contained (5 NM)</option><option value="other-aircraft">Aircraft other / non-GPS (10 NM)</option><option value="dead-reckoning">Dead Reckoning (base fix + 10% Tr)</option><option value="custom">Nilai custom dari planner</option>
                </select>
              </label>
              {(targetNavigationType === 'dead-reckoning' || targetNavigationType === 'custom') && <div className="text-[10px] text-slate-600">Masukkan base fix error tiap posisi di baris x. Untuk DR, sistem menambahkan 10% dari Tr kumulatif.</div>}
              {targetNavigationType === 'dead-reckoning' && <label className="flex items-center gap-2 text-[10px] text-slate-700"><input type="checkbox" checked={applyDre} disabled={readOnly} onChange={(e) => setApplyDre(e.target.checked)} /> Gunakan geometri trapezium DRe di peta (hanya jika disetujui planner/SOP)</label>}
              <p className="text-[10px] text-slate-500">Baseline 5/10 NM mengikuti klasifikasi target pada Appendix J-2. Error navigasi SRU (y) diisi dari kemampuan navigasinya, bukan angka contoh default.</p>
            </section>
          </div>

          <section className="border-b-2 border-slate-900 p-3">
            <h3 className="mb-2 text-[11px] font-bold text-slate-800">Waypoint / posisi kandidat untuk peta ONC</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
              {routePoints.map((waypoint, index) => (
                <div key={index} className="space-y-1 rounded border border-slate-200 bg-white p-2 text-[10px]">
                  <label className="block font-semibold text-slate-700">Posisi {String.fromCharCode(65 + index)}
                    <input type="text" value={waypoint.name} disabled={readOnly} onChange={(e) => setRoutePoints((prev) => { const next = [...prev] as typeof prev; next[index] = { ...next[index], name: e.target.value, active: true }; return next; })} className="ml-1 w-[70%] border-b border-dotted border-slate-400 px-1 text-blue-900" />
                  </label>
                  <CoordinateInput axis="lat" value={waypoint.lat} disabled={readOnly} aria-label={`Latitude posisi ${String.fromCharCode(65 + index)}`} onChange={(lat) => setRoutePoints((prev) => { const next = [...prev] as typeof prev; next[index] = { ...next[index], lat, active: true }; return next; })} className="w-full border-b border-dotted border-slate-400 px-1 font-mono text-blue-900" />
                  <CoordinateInput axis="lng" value={waypoint.lng} disabled={readOnly} aria-label={`Longitude posisi ${String.fromCharCode(65 + index)}`} onChange={(lng) => setRoutePoints((prev) => { const next = [...prev] as typeof prev; next[index] = { ...next[index], lng, active: true }; return next; })} className="w-full border-b border-dotted border-slate-400 px-1 font-mono text-blue-900" />
                </div>
              ))}
            </div>
          </section>

          {/* Main Calculation Table: Positions A, B, C, D */}
          <table className="w-full border-collapse text-xs table-fixed">
            <thead>
              <tr className="bg-slate-200/90 text-slate-900 font-bold border-b-2 border-slate-800">
                <th className="py-2 px-3 text-left w-[44%] border-r border-slate-300">
                  Position / Parameter
                </th>
                <th className="py-2 px-2 text-center w-[14%] border-r border-slate-300">
                  A (Awal)
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
                    <span className="font-bold text-blue-900">{tr.toFixed(2)}</span>{' '}
                    <span className="text-slate-500 text-[10px]">NM</span>
                  </td>
                ))}
              </tr>

              {/* Row 2: Distress Craft Position Error (Fix+10%Tr) (x) */}
              <tr>
                <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div>Target Navigation Error (x)</div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {targetNavigationType === 'dead-reckoning' ? 'x = base fix error + 0.10 × Tr' : targetNavigationType === 'self-contained' ? 'x = 5 NM (Appendix J-2)' : targetNavigationType === 'other-aircraft' ? 'x = 10 NM (Appendix J-2)' : targetNavigationType === 'custom' ? 'x = planner baseline' : 'Pilih metode navigasi target'}
                  </div>
                </td>
                {xValues.map((x, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    <div>{x.toFixed(1)} <span className="text-[10px] font-normal text-slate-600">NM</span></div>
                    {(targetNavigationType === 'dead-reckoning' || targetNavigationType === 'custom') && <label className="mt-1 flex items-center justify-center gap-1 text-[9px] font-normal text-slate-500">
                      Base Fix Err
                      <input type="number" min="0" step="0.1" value={fixErrors[i]} disabled={readOnly} onChange={(e) => {
                        const value = Number(e.target.value) || 0;
                        setFixErrors((prev) => { const next = [...prev] as [number, number, number, number]; next[i] = value; return next; });
                      }} className="w-12 border-b border-dotted border-slate-500 bg-white px-1 text-center font-mono font-bold text-blue-900" />
                    </label>}
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

          {(!targetNavigationType || yNavError <= 0 || safetyFactor <= 0 || ((targetNavigationType === 'dead-reckoning' || targetNavigationType === 'custom') && fixErrors.some((value) => value <= 0))) && <div role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-[10px] text-amber-900">
            {[
              !targetNavigationType && 'Pilih metode navigasi target.',
              (targetNavigationType === 'dead-reckoning' || targetNavigationType === 'custom') && fixErrors.some((value) => value <= 0) && 'Masukkan base fix error yang diketahui pada setiap posisi DR/custom.',
              yNavError <= 0 && 'Masukkan Search Craft Navigation Error (y) dari data navigasi SRU.',
              safetyFactor <= 0 && 'Pilih Safety Factor sebelum radius dianggap selesai.',
            ].filter(Boolean).join(' ')}
          </div>}

          <section className="border-b-2 border-slate-900 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Peta Worksheet 4 · ONC (Operational Navigation Chart)</h3>
                <p className="text-[10px] text-slate-600">Peta ini berdiri sendiri dan tidak berbagi layer dengan peta Worksheet 1. Lingkaran memakai Rounded up Radius.</p>
              </div>
              {dreGeometryEnabled && <span className="rounded bg-violet-100 px-2 py-1 text-[10px] font-semibold text-violet-900">Geometri DRe aktif atas pilihan planner</span>}
            </div>
            <Worksheet4Map
              center={mapCenter}
              zoom={activeMappedPoints.length ? mapZoom : 4}
              markers={ws4Markers}
              lines={ws4Lines}
              polygons={ws4Polygons}
              circles={ws4Circles}
              height="520px"
              preferenceKey="worksheet4-onc"
              basemap="onc"
            />
            {activeMappedPoints.length === 0 && <p className="mt-2 text-[10px] text-amber-800">Masukkan koordinat waypoint A–D agar radius dan area koridor dapat ditampilkan.</p>}
            <p className="mt-2 text-[10px] text-slate-500">Garis dan jarak segmen dapat ditelusuri dari waypoint. Tanpa DRe, peta menampilkan koridor persegi; trapezium hanya muncul saat DRe diaktifkan planner.</p>
          </section>

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
