'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/components/ui/card';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';
import { Printer } from 'lucide-react';
import CoordinateInput from '@/components/sar/CoordinateInput';
import { bearingDeg, distanceNm, project, type LatLng } from '@/lib/sar/sarCalculations';
import type { MapCircle, MapLine, MapMarker, MapPolygon } from '@/components/sar/SeaMap';
import {
  LAND_FS_OPTIONS,
  LAND_SRU_NAV_OPTIONS,
  LAND_X0_NM,
  computeLegTrapezoid,
  computePointRadius,
  possibilityCircleAreaSqNm,
} from '@/lib/sar/landSearchRadius.mjs';

const Worksheet4Map = dynamic(() => import('@/components/sar/worksheets/Worksheet4MapLibre'), { ssr: false });

export type Worksheet4TrStartMode = 'manual' | 'elapsed-time';
// Panduan Land Search: navigasi pesawat target hanya GPS (x₀ 5 NM) atau non-GPS
// (x₀ 10 NM) dari Tabel J-2; 'custom' disediakan untuk kebijakan SMC (Appendix J
// menyebut nilai minimum boleh dinaikkan). Nilai lama dipetakan otomatis:
// self-contained → gps, other-aircraft/dead-reckoning → non-gps.
export type Worksheet4TargetNavigation = 'gps' | 'non-gps' | 'custom' | 'self-contained' | 'other-aircraft' | 'dead-reckoning';

const LEGACY_TARGET_NAV: Partial<Record<Worksheet4TargetNavigation, Worksheet4TargetNavigation>> = {
  'self-contained': 'gps',
  'other-aircraft': 'non-gps',
  'dead-reckoning': 'non-gps',
};

function normalizeTargetNavigation(value: Worksheet4TargetNavigation | null | undefined): Worksheet4TargetNavigation | null {
  if (!value) return null;
  return LEGACY_TARGET_NAV[value] ?? value;
}

function normalizeSafetyFactor(value: number | undefined): number {
  if (!value || value <= 0) return 0;
  if (LAND_FS_OPTIONS.includes(value)) return value;
  // Nilai lama 1.6/2.5 dipetakan ke daftar fs panduan terdekat.
  const legacyMap: Record<number, number> = { 1.6: 1.8, 2.5: 2.6 };
  if (legacyMap[value]) return legacyMap[value];
  return LAND_FS_OPTIONS.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best), LAND_FS_OPTIONS[0]);
}
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
  yNavError?: number;
  /** fs pencarian ke-1..5 sesuai panduan: 1.1 / 1.8 / 2.0 / 2.3 / 2.6. Nilai lama dipetakan otomatis. */
  safetyFactor?: number;
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
  const [targetNavigationType, setTargetNavigationType] = useState<Worksheet4TargetNavigation | null>(normalizeTargetNavigation(initialState?.targetNavigationType));
  const [yNavError, setYNavError] = useState(initialState?.yNavError ?? 0);
  const [ySource, setYSource] = useState(() => LAND_SRU_NAV_OPTIONS.find((option) => option.value === (initialState?.yNavError ?? 0))?.id ?? 'custom');
  const [safetyFactor, setSafetyFactor] = useState(normalizeSafetyFactor(initialState?.safetyFactor));

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
  // Worksheet No. 4 per titik (panduan Land Search):
  // x = x₀ + 0.1 × Tr (Tabel J-2 + DR 10% Tabel J-3), y dari Tabel J-1,
  // e = √(x² + y²), R = e × fs, dibulatkan ke atas ke bilangan bulat NM.
  const pointResults = trList.map((tr, i) => {
    if (targetNavigationType === 'gps' || targetNavigationType === 'non-gps') {
      return computePointRadius({ trNm: tr, x0Nm: LAND_X0_NM[targetNavigationType], yNm: yNavError, fs: safetyFactor || 0 });
    }
    if (targetNavigationType === 'custom') {
      return computePointRadius({ trNm: 0, x0Nm: fixErrors[i], yNm: yNavError, fs: safetyFactor || 0 });
    }
    return null;
  });
  const xValues = pointResults.map((result) => result?.xNm ?? 0);
  const eValues = pointResults.map((result) => result?.eNm ?? 0);
  const rValues = pointResults.map((result) => result?.rNm ?? 0);
  const roundedRValues = pointResults.map((result) => result?.rRoundedNm ?? 0);

  const mappedPoints = routePoints.map((point, index) => point.active && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
    ? { point: { lat: point.lat, lng: point.lng }, index, name: point.name }
    : null);
  const activeMappedPoints = mappedPoints.filter((item) => item !== null) as Array<{ point: LatLng; index: number; name: string }>;
  const mapSpanNm = activeMappedPoints.reduce((maxDistance, item, index) => Math.max(
    maxDistance,
    ...activeMappedPoints.slice(index + 1).map((next) => distanceNm(item.point, next.point)),
  ), 0);
  const mapCenter = activeMappedPoints.length
    ? {
      lat: activeMappedPoints.reduce((sum, item) => sum + item.point.lat, 0) / activeMappedPoints.length,
      lng: activeMappedPoints.reduce((sum, item) => sum + item.point.lng, 0) / activeMappedPoints.length,
    }
    : { lat: -2.5, lng: 118 };
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
  // Search area per leg (panduan slide 9/13): dua garis singgung luar lingkaran
  // A(R_A) dan B(R_B) + dua garis penutup tegak lurus garis rute yang menyinggung
  // sisi luar lingkaran. Radius memakai nilai R bulat worksheet.
  interface LegGeometry {
    labelA: string;
    labelB: string;
    dNm: number;
    rANm: number;
    rBNm: number;
    trap: ReturnType<typeof computeLegTrapezoid>;
    aPoint: LatLng;
    bPoint: LatLng;
  }
  const legGeometries: LegGeometry[] = [];
  for (let i = 0; i < activeMappedPoints.length - 1; i++) {
    const a = activeMappedPoints[i];
    const b = activeMappedPoints[i + 1];
    const rA = roundedRValues[a.index];
    const rB = roundedRValues[b.index];
    if (rA <= 0 || rB <= 0) continue;
    legGeometries.push({
      labelA: String.fromCharCode(65 + a.index),
      labelB: String.fromCharCode(65 + b.index),
      dNm: distanceNm(a.point, b.point),
      rANm: rA,
      rBNm: rB,
      trap: computeLegTrapezoid(distanceNm(a.point, b.point), rA, rB),
      aPoint: a.point,
      bPoint: b.point,
    });
  }
  const singlePointIndex = activeMappedPoints.length === 1 ? activeMappedPoints[0].index : null;
  const totalSearchAreaSqNm = singlePointIndex !== null
    ? possibilityCircleAreaSqNm(roundedRValues[singlePointIndex])
    : legGeometries.reduce((sum, leg) => sum + (leg.trap.valid ? leg.trap.areaSqNm : 0), 0);
  const ws4Polygons: MapPolygon[] = (() => {
    const polygons: MapPolygon[] = [];
    for (const leg of legGeometries) {
      if (!leg.trap.valid) continue;
      const course = bearingDeg(leg.aPoint, leg.bPoint);
      const baseA = project(leg.aPoint, (course + 180) % 360, leg.rANm);
      const baseB = project(leg.bPoint, course, leg.rBNm);
      const left = (course + 270) % 360;
      const right = (course + 90) % 360;
      polygons.push({
        points: [
          project(baseA, left, leg.trap.wANm),
          project(baseB, left, leg.trap.wBNm),
          project(baseB, right, leg.trap.wBNm),
          project(baseA, right, leg.trap.wANm),
        ],
        color: '#0f766e', fillColor: '#0f766e', fillOpacity: 0.06,
        label: `Search Area ${leg.labelA}–${leg.labelB} · trapesium ${leg.trap.areaSqNm.toFixed(2)} NM²`,
      });
    }
    return polygons;
  })();

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
                <select
                  value={ySource}
                  disabled={readOnly}
                  onChange={(e) => {
                    const id = e.target.value;
                    setYSource(id);
                    if (id !== 'custom') {
                      const option = LAND_SRU_NAV_OPTIONS.find((item) => item.id === id);
                      if (option) setYNavError(option.value);
                    }
                  }}
                  className="border-b border-dotted border-slate-500 bg-white px-1 text-right font-bold text-blue-900"
                >
                  {LAND_SRU_NAV_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                  <option value="custom">Custom (SMC)…</option>
                </select>
                {ySource === 'custom' && (
                  <input type="number" min="0" step="0.1" value={yNavError} disabled={readOnly} onChange={(e) => setYNavError(Number(e.target.value) || 0)} className="w-14 border-b border-dotted border-slate-500 bg-white px-1 text-right font-bold text-blue-900" />
                )}
                NM
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
              <h3 className="font-bold text-slate-800">Navigational Error Target (x) — Tabel J-2 + J-3</h3>
              <label className="flex flex-wrap items-center gap-2">
                <span>Navigasi pesawat target:</span>
                <select value={targetNavigationType ?? ''} disabled={readOnly} onChange={(e) => setTargetNavigationType((e.target.value || null) as Worksheet4TargetNavigation | null)} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-blue-900">
                  <option value="">-</option>
                  <option value="gps">GPS → x₀ = 5 NM (Tabel J-2)</option>
                  <option value="non-gps">Non-GPS → x₀ = 10 NM (Tabel J-2)</option>
                  <option value="custom">Nilai x₀ manual planner (SMC)</option>
                </select>
              </label>
              {targetNavigationType === 'custom' && <div className="text-[10px] text-slate-600">Masukkan x₀ tiap posisi di baris x (Appendix J: nilai minimum boleh dinaikkan SMC). DR 10% × Tr tidak ditambahkan otomatis pada mode ini.</div>}
              {targetNavigationType === 'gps' && <p className="text-[10px] text-slate-600">x = 5 NM + 10% × Tr (DR Tabel J-3 pesawat, tetap diterapkan).</p>}
              {targetNavigationType === 'non-gps' && <p className="text-[10px] text-slate-600">x = 10 NM + 10% × Tr (DR Tabel J-3 pesawat, tetap diterapkan).</p>}
              <p className="text-[10px] text-slate-500">x₀ mengikuti Tabel J-2 (pesawat): GPS/self-contained 5 NM, non-GPS 10 NM. Error navigasi SRU (y) diisi dari Tabel J-1.</p>
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

              {/* Row 2: Distress Craft Position Error (x₀ + 10%Tr) (x) */}
              <tr>
                <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div>Target Navigation Error (x)</div>
                  <div className="text-[10px] text-slate-500 font-mono">
                    {targetNavigationType === 'gps' ? 'x = 5 NM + 0.10 × Tr (Tabel J-2 + J-3)' : targetNavigationType === 'non-gps' ? 'x = 10 NM + 0.10 × Tr (Tabel J-2 + J-3)' : targetNavigationType === 'custom' ? 'x = x₀ manual planner (SMC)' : 'Pilih navigasi pesawat target'}
                  </div>
                </td>
                {xValues.map((x, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0 font-mono font-bold text-blue-900">
                    <div>{x.toFixed(1)} <span className="text-[10px] font-normal text-slate-600">NM</span></div>
                    {targetNavigationType === 'custom' && <label className="mt-1 flex items-center justify-center gap-1 text-[9px] font-normal text-slate-500">
                      x₀
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

              {/* Row 5: Safety Factor (fs) — pencarian ke-n */}
              <tr>
                <td className="py-2 px-3 font-medium text-slate-800 border-r border-slate-300">
                  <div>Safety Factor for this search (fs)</div>
                  <div className="text-[10px] text-slate-500 font-mono">Pencarian ke-1…ke-5: 1.1; 1.8; 2.0; 2.3; 2.6</div>
                </td>
                {trList.map((_, i) => (
                  <td key={i} className="py-2 px-2 text-center border-r border-slate-300 last:border-r-0">
                    {i === 0 ? (
                      <select
                        value={safetyFactor}
                        disabled={readOnly}
                        suppressHydrationWarning
                        onChange={(e) => setSafetyFactor(Number(e.target.value) || 0)}
                        className="font-bold text-blue-900 bg-white border border-slate-300 rounded px-1 py-0.5 text-xs font-mono"
                      >
                        <option value="0">-</option>
                        {LAND_FS_OPTIONS.map((option, index) => (
                          <option key={option} value={option}>ke-{index + 1} (fs {option.toFixed(1)})</option>
                        ))}
                      </select>
                    ) : (
                      <span className="font-bold text-blue-900 font-mono">{safetyFactor || '-'}</span>
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

          {(!targetNavigationType || yNavError <= 0 || safetyFactor <= 0 || (targetNavigationType === 'custom' && fixErrors.some((value) => value <= 0))) && <div role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-[10px] text-amber-900">
            {[
              !targetNavigationType && 'Pilih navigasi pesawat target (Tabel J-2).',
              targetNavigationType === 'custom' && fixErrors.some((value) => value <= 0) && 'Masukkan x₀ manual pada setiap posisi untuk mode SMC.',
              yNavError <= 0 && 'Pilih sarana navigasi SRU (y) dari Tabel J-1 atau isi nilai custom.',
              safetyFactor <= 0 && 'Pilih nomor pencarian (fs) sebelum radius dianggap selesai.',
            ].filter(Boolean).join(' ')}
          </div>}

          <section className="border-b-2 border-slate-900 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Bentuk &amp; Luas Search Area (Trapesium)</h3>
                <p className="text-[10px] text-slate-600">Possibility area: lingkaran R di tiap titik. Search area: trapesium dari dua garis singgung luar + dua garis penutup tegak lurus rute (slide 9 &amp; 13), bukan persegi 2R.</p>
              </div>
              <div className="rounded bg-teal-50 border border-teal-200 px-3 py-1.5 text-right">
                <div className="text-[10px] font-semibold text-teal-800 uppercase tracking-wide">Total luas search area</div>
                <div className="text-sm font-black font-mono text-teal-900">{totalSearchAreaSqNm.toFixed(2)} NM²</div>
              </div>
            </div>
            {singlePointIndex !== null && roundedRValues[singlePointIndex] > 0 && (
              <p className="text-[11px] text-slate-700">Satu titik aktif ({String.fromCharCode(65 + singlePointIndex)}): possibility area = lingkaran R = {roundedRValues[singlePointIndex]} NM, luas = πR² = {possibilityCircleAreaSqNm(roundedRValues[singlePointIndex]).toFixed(2)} NM².</p>
            )}
            {legGeometries.length > 0 && (
              <table className="w-full border-collapse text-[11px] mt-1">
                <thead>
                  <tr className="bg-slate-100 text-slate-700">
                    <th className="border border-slate-300 px-2 py-1 text-left">Leg</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">d (NM)</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">R_A (NM)</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">R_B (NM)</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">a (NM)</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">b (NM)</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">h (NM)</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">L = (a+b)×h/2 (NM²)</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {legGeometries.map((leg, i) => (
                    <tr key={`${leg.labelA}-${leg.labelB}`} className={i % 2 === 1 ? 'bg-slate-50' : ''}>
                      <td className="border border-slate-300 px-2 py-1 font-bold">{leg.labelA}–{leg.labelB}{leg.trap.degenerate && <span className="ml-1 text-[9px] text-amber-700">(degenerate)</span>}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{leg.dNm.toFixed(2)}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{leg.rANm}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{leg.rBNm}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{leg.trap.valid ? leg.trap.aNm.toFixed(2) : '-'}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{leg.trap.valid ? leg.trap.bNm.toFixed(2) : '-'}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{leg.trap.valid ? leg.trap.hNm.toFixed(2) : '-'}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right font-bold">{leg.trap.valid ? leg.trap.areaSqNm.toFixed(2) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[10px] text-slate-500">a, b, dan h dihitung dari geometri trapesium eksak (setara pengukuran trapesium di peta dengan skala sesuai langkah gambar 1–7 panduan), bukan dari 2R. Rute lebih dari dua titik: luas tiap trapesium dihitung terpisah lalu dijumlahkan.</p>
          </section>

          <section className="border-b-2 border-slate-900 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Peta udara Worksheet 4 · OpenAIP</h3>
                <p className="text-[10px] text-slate-600">Peta ini berdiri sendiri dan tidak berbagi layer dengan peta Worksheet 1. Lingkaran memakai Rounded up Radius; trapesium search area digambar dari garis singgung luar kedua lingkaran.</p>
              </div>
            </div>
            <Worksheet4Map
              center={mapCenter}
              zoom={activeMappedPoints.length ? mapZoom : 4}
              markers={ws4Markers}
              lines={ws4Lines}
              polygons={ws4Polygons}
              circles={ws4Circles}
              height="520px"
            />
            {activeMappedPoints.length === 0 && <p className="mt-2 text-[10px] text-amber-800">Masukkan koordinat waypoint A–D agar radius dan area koridor dapat ditampilkan.</p>}
            <p className="mt-2 text-[10px] text-slate-500">Garis dan jarak segmen dapat ditelusuri dari waypoint. Trapesium search area (hijau) dibentuk dari dua garis singgung luar lingkaran possibility area dan dua garis penutup tegak lurus garis rute.</p>
            <p className="mt-1 text-[10px] text-amber-800">OpenAIP dikelola komunitas. Verifikasi data dengan AIP Indonesia; peta ini alat bantu dan tidak menggantikan penilaian SAR Mission Coordinator maupun prosedur resmi.</p>
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
