'use client';

import { printActiveWorksheetFit } from '@/lib/sar/printFit';
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Plus, Trash2, Printer, CheckCircle2, ChevronDown, ChevronRight, Clock, Compass } from 'lucide-react';
import { type ASWObservation } from '@/lib/sar/sarCalculations';
import { generateAswObservationTimes, toBasarnasTimeFormat } from '@/lib/sar/aswTime';

export type { ASWObservation };

export interface ASWData {
  aswDirFrom: number;
  aswSpeed: number;
  aswErr: number;
  aswdve: number;
  /** Total Hours (D) worksheet ASW — sumber wajib Hours of drift (a) Worksheet 1. */
  totalHours: number;
  /** Waktu distress dalam format Basarnas (mis. "1118.0700 Z") untuk baris @ Time (UTC). */
  distressTime: string;
}

export interface ASWInitialState {
  observations?: ASWObservation[];
  aswErr?: number;
  distressTime?: string;
  datumTime?: string;
  obsIntervalMode?: '6h' | '3h';
  caseTitle?: string;
}

interface ASWWorksheetProps {
  onDataChange: (data: ASWData) => void;
  onStateChange?: (state: { observations: ASWObservation[]; aswErr: number }) => void;
  windOverride?: { dirFrom: number; speed: number; hours: number; ts: number } | null;
  initialState?: ASWInitialState | null;
  /**
   * Waktu distress turunan dari worksheet ADW (A.1 waktu insiden + B.7 menit
   * turun dibulatkan, format Basarnas MMDD.HHMM). Menimpa nilai distressTime
   * lain bila tersedia — aturan workflow: distress ASW = ADW A.1 + B.7.
   */
  derivedDistressTime?: string | null;
  readOnly?: boolean;
  className?: string;
}

// ─── Basarnas Time Format Helpers ─────────────────────────────────────────
// Parser waktu liberal + generator jendela observasi pindah ke lib bersama
// src/lib/sar/aswTime.ts (dipakai juga oleh handleApplyASW di page.tsx agar
// baris hasil AI terisi waktu meski format soal bukan MMDD.HHMM, mis.
// "07.00 UTC" pada soal EXE FAKFAK 2026).

export default function ASWWorksheet({
  onDataChange,
  onStateChange,
  windOverride,
  initialState,
  derivedDistressTime,
  readOnly = false,
  className = '',
}: ASWWorksheetProps) {
  const [observations, setObservations] = useState<ASWObservation[]>(
    () => initialState?.observations ?? []
  );
  const [distressTime, setDistressTime] = useState<string>(
    () => (derivedDistressTime ? `${derivedDistressTime} Z` : initialState?.distressTime ?? '')
  );
  const [datumTime, setDatumTime] = useState<string>(initialState?.datumTime ?? '');
  const [obsIntervalMode, setObsIntervalMode] = useState<'6h' | '3h'>(initialState?.obsIntervalMode ?? '6h');
  const [aswErr, setAswErr] = useState<number>(initialState?.aswErr ?? 0);

  // Sinkron waktu distress turunan ADW (A.1 + B.7): bila worksheet ADW selesai
  // dihitung (atau berubah), distress ASW otomatis mengikuti.
  useEffect(() => {
    if (!derivedDistressTime) return;
    setDistressTime((prev) => (prev === `${derivedDistressTime} Z` ? prev : `${derivedDistressTime} Z`));
  }, [derivedDistressTime]);

  // Auto-generate observation rows when distress/datum time or interval mode changes
  const regenerateObs = useCallback(() => {
    if (!distressTime.trim() || !datumTime.trim()) {
      return;
    }
    const generated = generateAswObservationTimes(distressTime, datumTime, obsIntervalMode);
    if (generated.length > 0) {
      // Preserve existing wind data
      setObservations(prev => {
        return generated.map((g, i) => ({
          timeObs: g.timeObs,
          timeStart: g.timeStart,
          timeEnd: g.timeEnd,
          hours: g.hours,
          windDirFrom: prev[i]?.windDirFrom ?? 0,
          windSpeed: prev[i]?.windSpeed ?? 0,
        }));
      });
    }
  }, [distressTime, datumTime, obsIntervalMode]);

  // Generate initial observations on mount, and when times/mode change
  useEffect(() => {
    regenerateObs();
  }, [regenerateObs]);
  const [showTrigColumns, setShowTrigColumns] = useState<boolean>(false);

  const [caseTitle, setCaseTitle] = useState(initialState?.caseTitle ?? '-');
  const [caseNumber, setCaseNumber] = useState('0');
  const [searchDate, setSearchDate] = useState('-');
  const [plannerName, setPlannerName] = useState('-');
  const [datumNumber, setDatumNumber] = useState('0');
  const [searchPlan, setSearchPlan] = useState<'A' | 'B' | 'C' | ''>('');

  // Handle external wind override if active
  useEffect(() => {
    if (windOverride) {
      setObservations([
        {
          timeObs: 'Live',
          timeStart: 'Live',
          timeEnd: 'Station',
          hours: windOverride.hours,
          windDirFrom: windOverride.dirFrom,
          windSpeed: windOverride.speed,
        },
      ]);
    }
  }, [windOverride]);

  useEffect(() => {
    onStateChange?.({ observations, aswErr });
  }, [observations, aswErr, onStateChange]);

  // Compute mathematical vector components matching ASW dan POD.xls
  const detailedRows = useMemo(() => {
    return observations.map((obs) => {
      const hoursA = obs.hours;
      const dirB = obs.windDirFrom;
      const speedC = obs.windSpeed;
      const contribD = hoursA * speedC; // Contribution in NM

      // Convert maritime direction to radians (000° is North, 090° is East)
      const rad = (dirB * Math.PI) / 180;
      const sinQ = Math.sin(rad);
      const cosQ = Math.cos(rad);
      const aSinQ = contribD * sinQ; // East-West component
      const aCosQ = contribD * cosQ; // North-South component

      return {
        ...obs,
        hoursA,
        dirB,
        speedC,
        contribD,
        rad,
        sinQ,
        cosQ,
        aSinQ,
        aCosQ,
      };
    });
  }, [observations]);

  // Totals & Resultant Vector matching Excel ASW sheet & Basarnas slides
  const summary = useMemo(() => {
    const totalHours = detailedRows.reduce((acc, r) => acc + r.hoursA, 0);
    const sumASinQ = detailedRows.reduce((acc, r) => acc + r.aSinQ, 0);
    const sumACosQ = detailedRows.reduce((acc, r) => acc + r.aCosQ, 0);

    const Rx = sumACosQ; // North-South
    const Ry = sumASinQ; // East-West
    const Rx2 = Rx * Rx;
    const Ry2 = Ry * Ry;
    const vectorSumF = Math.sqrt(Rx2 + Ry2); // Vector sum of contribution in NM

    // Resultant direction in degrees True (000° to 359°)
    let resultantDeg = Math.round((Math.atan2(Ry, Rx) * 180) / Math.PI);
    if (resultantDeg < 0) resultantDeg += 360;

    // Average Surface Wind Speed = Vector Sum / Total Hours
    const aswSpeed = totalHours > 0 ? Number((vectorSumF / totalHours).toFixed(2)) : 0;
    const aswDirFrom = resultantDeg;

    return {
      totalHours,
      sumASinQ,
      sumACosQ,
      Rx,
      Ry,
      Rx2,
      Ry2,
      vectorSumF: Math.round(vectorSumF * 10) / 10,
      aswDirFrom,
      aswSpeed,
    };
  }, [detailedRows]);

  // Probable error of drift velocity due to ASW error (ASWDVe = ASWe * 0.08)
  const aswdve = Number((aswErr * 0.08).toFixed(2));

  // Emit data to parent
  useEffect(() => {
    onDataChange({
      aswDirFrom: summary.aswDirFrom,
      aswSpeed: summary.aswSpeed,
      aswErr,
      aswdve,
      totalHours: summary.totalHours,
      distressTime,
    });
  }, [summary.aswDirFrom, summary.aswSpeed, summary.totalHours, aswErr, aswdve, distressTime, onDataChange]);

  const updateRow = (index: number, field: keyof ASWObservation, value: any) => {
    const next = [...observations];
    next[index] = { ...next[index], [field]: value };
    setObservations(next);
  };

  const addRow = () => {
    const last = observations[observations.length - 1];
    const newObs = last ? last.timeEnd : '-';
    setObservations([
      ...observations,
      {
        timeObs: newObs,
        timeStart: newObs,
        timeEnd: '-',
        hours: 0,
        windDirFrom: 0,
        windSpeed: 0,
      },
    ]);
  };

  const removeRow = (index: number) => {
    if (observations.length <= 1) return;
    setObservations(observations.filter((_, i) => i !== index));
  };

  const loadPreset = (
    _preset: ASWObservation[],
    title: string,
    planner: string,
    dt: string,
    dm: string,
    mode: '6h' | '3h'
  ) => {
    setCaseTitle(title);
    setPlannerName(planner);
    setDistressTime(dt);
    setDatumTime(dm);
    setObsIntervalMode(mode);
    // observations will auto-regenerate from distress/datum/mode
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') printActiveWorksheetFit();
  };

  return (
    <div className={`space-y-4 ${className} text-slate-900 font-sans`}>
      {/* Printable / Viewable Official Appendix K Header */}
      <div className="flex items-center justify-between border-b-2 border-slate-900 pb-1 text-[11px] font-bold text-slate-700">
        <span className="tracking-wide">Appendix K – Determining datum</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-slate-900">K-19</span>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 px-2 py-0.5 rounded border border-slate-300 print:hidden transition-colors"
          >
            <Printer className="h-3 w-3" /> Cetak Lembar Ini
          </button>
        </div>
      </div>

      {/* Main Authentic Document Sheet Container */}
      <div className="border-2 border-slate-900 rounded bg-white shadow-xs p-4 sm:p-6 space-y-4 text-xs">
        {/* Document Title (Appendix K-19 Authentic Title) */}
        <div className="border-b-2 border-slate-900 pb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base sm:text-lg font-black tracking-tight uppercase text-slate-950 font-serif">
              Average surface wind (ASW) worksheet
            </h1>
            <p className="text-[11px] text-slate-500 font-mono">
              Perhitungan Angin Permukaan / Average Surface Wind
            </p>
          </div>
          <span className="text-xs bg-sky-100 text-sky-950 font-bold px-3 py-1 rounded border border-sky-300 font-mono">
            ASW: {summary.aswDirFrom}°T / {summary.aswSpeed} kts
          </span>
        </div>

        {/* Operational Context: Distress Time & Datum Time Banner */}
        <div className="bg-amber-50/70 border border-amber-300 rounded p-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-amber-800" />
              <span className="font-bold text-amber-950">Distress Time:</span>
              <input
                type="text"
                value={distressTime}
                disabled={readOnly}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setDistressTime(e.target.value)}
                onBlur={() => {
                  const norm = toBasarnasTimeFormat(distressTime);
                  if (norm && norm !== distressTime) setDistressTime(`${norm} Z`);
                }}
                placeholder="MMDD.HHMM Z"
                title="Format bebas dari soal (mis. '17 Nov 2026 07.00 UTC'); dikonversi otomatis ke Basarnas MMDD.HHMM Z"
                className="w-28 text-center font-bold text-blue-900 bg-white border border-amber-300 rounded px-1.5 py-0.5 font-mono shadow-2xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5 text-amber-800" />
              <span className="font-bold text-amber-950">Datum Time:</span>
              <input
                type="text"
                value={datumTime}
                disabled={readOnly}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setDatumTime(e.target.value)}
                onBlur={() => {
                  const norm = toBasarnasTimeFormat(datumTime);
                  if (norm && norm !== datumTime) setDatumTime(`${norm} Z`);
                }}
                placeholder="MMDD.HHMM Z"
                title="Format bebas dari soal (mis. '18 Nov 2026 01.00 UTC'); dikonversi otomatis ke Basarnas MMDD.HHMM Z"
                className="w-28 text-center font-bold text-blue-900 bg-white border border-amber-300 rounded px-1.5 py-0.5 font-mono shadow-2xs"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] font-medium text-amber-900">
            <span>Interval BMKG:</span>
            {readOnly ? (
              <span className="font-bold bg-white px-2 py-0.5 rounded border border-amber-300 text-amber-950">
                {obsIntervalMode === '6h' ? 'Per 6 Jam (00, 06, 12, 18)' : 'Per 3 Jam (00, 03, 06, 09, 12, 15, 18, 21)'}
              </span>
            ) : (
              <select
                value={obsIntervalMode}
                onChange={(e) => setObsIntervalMode(e.target.value as '6h' | '3h')}
                className="font-bold bg-white px-2 py-0.5 rounded border border-amber-300 text-amber-950 cursor-pointer"
              >
                <option value="6h">Per 6 Jam (00, 06, 12, 18)</option>
                <option value="3h">Per 3 Jam (00, 03, 06, 09, 12, 15, 18, 21)</option>
              </select>
            )}
          </div>
        </div>

        {/* Metadata Block: Case title, Case number, Date, Planner, Datum, Search plan */}
        <div className="space-y-2 border-b-2 border-slate-900 pb-3 text-[11px]">
          {/* Row 1 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-700 font-semibold shrink-0">Case title:</span>
              <input
                type="text"
                value={caseTitle}
                disabled={readOnly}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setCaseTitle(e.target.value)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-full"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-700 font-semibold shrink-0">Case number:</span>
              <input
                type="text"
                value={caseNumber}
                disabled={readOnly}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setCaseNumber(e.target.value)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-full font-mono"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-700 font-semibold shrink-0">Date:</span>
              <input
                type="text"
                value={searchDate}
                disabled={readOnly}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setSearchDate(e.target.value)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-full font-mono"
              />
            </div>
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-700 font-semibold shrink-0">Planner’s name:</span>
              <input
                type="text"
                value={plannerName}
                disabled={readOnly}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setPlannerName(e.target.value)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-full"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-700 font-semibold shrink-0">Datum number:</span>
              <input
                type="text"
                value={datumNumber}
                disabled={readOnly}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setDatumNumber(e.target.value)}
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-16 text-center font-mono"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-700 font-semibold shrink-0">Search plan:</span>
              {(['A', 'B', 'C'] as const).map((plan) => (
                <button
                  key={plan}
                  type="button"
                  disabled={readOnly}
                  onClick={() => setSearchPlan(plan)}
                  className={`w-6 h-6 rounded-full font-bold flex items-center justify-center transition-colors ${searchPlan === plan
                    ? 'border-2 border-slate-900 bg-blue-100 text-blue-900 ring-2 ring-blue-500'
                    : 'border border-slate-400 text-slate-600 hover:bg-slate-100'
                    }`}
                >
                  {plan}
                </button>
              ))}
              <span className="text-[10px] text-slate-500 italic">(Circle one)</span>
            </div>
          </div>
        </div>

        {/* Section A: Average surface wind */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-400 pb-1">
            <div className="font-bold text-slate-900 text-sm">
              <span className="mr-2">A</span> Average surface wind
            </div>
            <div className="text-xs text-slate-600 font-medium">
              1 Surface wind data
            </div>
          </div>

          {/* Action Buttons */}
          {!readOnly && (
            <div className="space-y-1.5 print:hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTrigColumns(!showTrigColumns)}
                    className="text-[10px] text-slate-600 hover:text-slate-900 flex items-center gap-0.5 transition-colors"
                  >
                    {showTrigColumns ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {showTrigColumns ? 'Sembunyikan Sin/Cos' : 'Tampilkan Sin/Cos'}
                  </button>
                  <span className="text-[10px] text-slate-400">|</span>
                  <span className="text-[10px] text-slate-500 font-medium">Contoh:</span>
                  <button
                    type="button"
                    onClick={() => {
                      setDistressTime('1122.1600 Z');
                      setDatumTime('1123.0700 Z');
                      setObsIntervalMode('6h');
                      setObservations([
                        { timeObs: '18:00', timeStart: '16:00', timeEnd: '21:00', hours: 5, windDirFrom: 90, windSpeed: 18 },
                        { timeObs: '00:00', timeStart: '21:00', timeEnd: '03:00', hours: 6, windDirFrom: 110, windSpeed: 20 },
                        { timeObs: '06:00', timeStart: '03:00', timeEnd: '07:00', hours: 4, windDirFrom: 100, windSpeed: 19 },
                      ]);
                    }}
                    className="text-[10px] bg-sky-50 hover:bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded border border-sky-300 transition-colors"
                  >
                    Muat Contoh Kasus (1122.1600 Z)
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDistressTime('');
                      setDatumTime('');
                      setObservations([]);
                      onDataChange({ aswDirFrom: 0, aswSpeed: 0, aswErr: 0, aswdve: 0, totalHours: 0, distressTime: '' });
                    }}
                    className="text-[11px] bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-2.5 py-1 rounded border border-rose-300 flex items-center gap-1 shadow-2xs transition-colors"
                    title="Kosongkan seluruh baris pengamatan di tab ASW"
                  >
                    <Trash2 className="h-3 w-3 text-rose-600" /> Kosongkan Baris (Clear)
                  </button>
                  <button
                    type="button"
                    onClick={addRow}
                    className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-2.5 py-1 rounded border border-slate-400 flex items-center gap-1 shadow-2xs transition-colors"
                  >
                    <Plus className="h-3 w-3 text-emerald-600" /> Tambah Observasi Angin
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Authentic Appendix K-19 Surface Wind Table */}
          <div className="border border-slate-800 rounded overflow-hidden">
            <table className="w-full border-collapse text-xs table-fixed">
              <thead>
                <tr className="bg-slate-200/90 text-slate-950 font-bold border-b-2 border-slate-800 text-[11px]">
                  {/* Kolom 1: Time of observation - HANYA SATU WAKTU */}
                  <th className="py-2 px-2 text-center w-[16%] border-r border-slate-400">
                    <div>Time of</div>
                    <div>observation</div>
                  </th>
                  {/* Kolom 2: Time interval (–) */}
                  <th className="py-2 px-2 text-center w-[18%] border-r border-slate-400">
                    <div>Time</div>
                    <div>interval (–)</div>
                  </th>
                  {/* Kolom 3: Number of hours (A) */}
                  <th className="py-2 px-2 text-center w-[12%] border-r border-slate-400">
                    <div>Number</div>
                    <div>of hours (A)</div>
                  </th>
                  {/* Kolom 4: Wind direction (B) */}
                  <th className="py-2 px-2 text-center w-[14%] border-r border-slate-400">
                    <div>Wind</div>
                    <div>direction (B)</div>
                  </th>
                  {/* Kolom 5: Wind speed (C) */}
                  <th className="py-2 px-2 text-center w-[12%] border-r border-slate-400">
                    <div>Wind</div>
                    <div>speed (C)</div>
                  </th>
                  {/* Kolom 6: Wind contribution (A x C) */}
                  <th className="py-2 px-2 text-center w-[16%] bg-blue-50/70 border-r border-slate-400">
                    <div>Wind</div>
                    <div>contribution (A × C)</div>
                  </th>
                  {showTrigColumns && (
                    <>
                      <th className="py-2 px-1 text-center w-[10%] bg-amber-50/70 border-r border-slate-400 text-[10px]">
                        <div>A sin θ</div>
                        <div>(East/West)</div>
                      </th>
                      <th className="py-2 px-1 text-center w-[10%] bg-amber-50/70 border-r border-slate-400 text-[10px]">
                        <div>A cos θ</div>
                        <div>(North/South)</div>
                      </th>
                    </>
                  )}
                  {!readOnly && <th className="py-2 px-1 text-center w-[8%] print:hidden">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300 text-[11px] font-mono">
                {detailedRows.length === 0 ? (
                  <tr>
                    <td colSpan={readOnly ? (showTrigColumns ? 8 : 6) : (showTrigColumns ? 9 : 7)} className="py-6 text-center text-slate-500 font-sans text-xs bg-slate-50">
                      Belum ada data pengamatan angin permukaan. Masukkan <strong>Waktu Kejadian & Waktu Datum</strong> di atas, atau klik <strong>"Muat Contoh Kasus"</strong> / gunakan <strong>AI Assistant</strong>.
                    </td>
                  </tr>
                ) : (
                  detailedRows.map((row, i) => (
                  <tr key={i} className="hover:bg-slate-50">
                    {/* Time of observation (auto-calculated from BMKG observation window) */}
                    <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-slate-900 bg-slate-50/50">
                      <span className="font-mono">{row.timeObs || row.timeStart}</span>
                    </td>

                    {/* Time interval (auto-calculated from distress/datum time) */}
                    <td className="py-2 px-2 text-center border-r border-slate-300 bg-slate-50/50">
                      <span className="font-bold text-slate-800 font-mono">
                        {row.timeStart} – {row.timeEnd}
                      </span>
                    </td>

                    {/* Number of hours (A) — auto-calculated */}
                    <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-slate-900 bg-slate-50/50">
                      <span className="font-mono">{row.hoursA}</span>
                    </td>

                    {/* Wind direction (B) */}
                    <td className="py-2 px-2 text-center border-r border-slate-300">
                      {readOnly ? (
                        <span className="font-bold text-blue-900">{row.dirB}°T</span>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            min="0"
                            max="359"
                            value={row.dirB}
                            suppressHydrationWarning
                            spellCheck={false}
                            data-ms-editor="true"
                            onChange={(e) => updateRow(i, 'windDirFrom', Number(e.target.value) || 0)}
                            className="w-12 text-center font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-600"
                          />
                          <span className="text-slate-600 font-sans">°T</span>
                        </div>
                      )}
                    </td>

                    {/* Wind speed (C) */}
                    <td className="py-2 px-2 text-center border-r border-slate-300">
                      {readOnly ? (
                        <span className="font-bold text-blue-900">{row.speedC} kts</span>
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            min="0"
                            value={row.speedC}
                            suppressHydrationWarning
                            spellCheck={false}
                            data-ms-editor="true"
                            onChange={(e) => updateRow(i, 'windSpeed', Number(e.target.value) || 0)}
                            className="w-12 text-center font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-600"
                          />
                          <span className="text-slate-600 font-sans">kts</span>
                        </div>
                      )}
                    </td>

                    {/* Wind contribution (A x C) */}
                    <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-blue-950 bg-blue-50/40">
                      {row.contribD.toFixed(1)} <span className="font-normal text-slate-500 text-[10px]">NM</span>
                    </td>

                    {/* Optional Trig Columns */}
                    {showTrigColumns && (
                      <>
                        <td className="py-2 px-1 text-center border-r border-slate-300 text-slate-700 bg-amber-50/30 text-[10px]">
                          {row.aSinQ.toFixed(2)}
                        </td>
                        <td className="py-2 px-1 text-center border-r border-slate-300 text-slate-700 bg-amber-50/30 text-[10px]">
                          {row.aCosQ.toFixed(2)}
                        </td>
                      </>
                    )}

                    {/* Aksi */}
                    {!readOnly && (
                      <td className="py-2 px-1 text-center print:hidden">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          className="text-slate-400 hover:text-rose-600 transition-colors"
                          title="Hapus baris"
                        >
                          <Trash2 className="h-3.5 w-3.5 mx-auto" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}

                {/* Total Hours & Vector Sum of Contributions Row */}
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-800 text-slate-900">
                  <td colSpan={2} className="py-2.5 px-3 text-right border-r border-slate-300 font-sans">
                    Total hours (D):
                  </td>
                  <td className="py-2.5 px-2 text-center border-r border-slate-300 text-blue-950 text-xs">
                    {summary.totalHours.toFixed(1)}
                  </td>
                  <td colSpan={2} className="py-2.5 px-2 text-right border-r border-slate-300 font-sans">
                    Vector sum of contributions (E) °T & (F) NM:
                  </td>
                  <td className="py-2.5 px-2 text-center border-r border-slate-300 text-blue-950 text-xs bg-blue-100/60">
                    <div>{summary.aswDirFrom}°T (E)</div>
                    <div>{summary.vectorSumF} NM (F)</div>
                  </td>
                  {showTrigColumns && (
                    <>
                      <td className="py-2.5 px-1 text-center border-r border-slate-300 text-slate-800 text-[10px] bg-amber-100/50">
                        Ry: {summary.Ry.toFixed(1)}
                      </td>
                      <td className="py-2.5 px-1 text-center border-r border-slate-300 text-slate-800 text-[10px] bg-amber-100/50">
                        Rx: {summary.Rx.toFixed(1)}
                      </td>
                    </>
                  )}
                  {!readOnly && <td className="print:hidden" />}
                </tr>

                {/* Line A.2: Average Surface Wind */}
                <tr className="bg-sky-50 font-black border-t border-slate-800 text-xs">
                  <td colSpan={3} className="py-2.5 px-3 font-sans text-slate-900">
                    2 Average surface wind (ASW) [(E)°T (F/D) kts]
                  </td>
                  <td colSpan={showTrigColumns ? (readOnly ? 5 : 6) : (readOnly ? 3 : 4)} className="py-2.5 px-3 text-right font-mono text-sm text-blue-950">
                    ASW = <span className="text-sky-900 underline">{summary.aswDirFrom}°T</span> /{' '}
                    <span className="text-sky-900 underline">{summary.aswSpeed} kts</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Section B: Probable error */}
        <div className="space-y-3 pt-2 border-t border-slate-300">
          <div className="font-bold text-slate-900 text-sm">
            <span className="mr-2">B</span> Probable error
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-3 rounded border border-slate-300 text-xs">
            {/* B.1 */}
            <div className="flex items-center justify-between gap-2 border-b md:border-b-0 md:border-r border-slate-300 pb-2 md:pb-0 md:pr-4">
              <div>
                <span className="font-bold text-slate-900 mr-2">1</span>
                <span>Probable error of the average surface wind (ASWe):</span>
                <p className="text-[10px] text-slate-500 italic mt-0.5">
                  (5 kts untuk angin observasi / 8 kts untuk angin prakiraan)
                </p>
              </div>
              <div className="flex items-center gap-1 font-mono">
                {readOnly ? (
                  <span className="font-bold text-blue-900">{aswErr.toFixed(1)}</span>
                ) : (
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={aswErr}
                    suppressHydrationWarning
                    spellCheck={false}
                    data-ms-editor="true"
                    onChange={(e) => setAswErr(Number(e.target.value) || 0)}
                    className="w-14 text-center font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1"
                  />
                )}
                <span className="font-sans text-slate-600">kts</span>
              </div>
            </div>

            {/* B.2 */}
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="font-bold text-slate-900 mr-2">2</span>
                <span>Probable error of drift velocity due to ASW error (ASWDVe):</span>
                <p className="text-[10px] text-slate-500 italic mt-0.5">
                  (Rumus: ASWe × 0.08 = {aswErr.toFixed(1)} × 0.08)
                </p>
              </div>
              <div className="flex items-center gap-1 font-mono">
                <span className="font-bold text-blue-900 bg-white px-2 py-0.5 rounded border border-slate-300">
                  {aswdve.toFixed(2)}
                </span>
                <span className="font-sans text-slate-600">kts</span>
              </div>
            </div>
          </div>
        </div>

        {/* Handover Banner to Worksheet 1 (Datum Worksheet) */}
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
            <span className="text-emerald-950 font-medium">
              Go to part C on Worksheet 1 (Line C.1 & C.2). Hasil nilai ASW (<span className="font-bold">{summary.aswDirFrom}°T / {summary.aswSpeed} kts</span>) otomatis diteruskan untuk perhitungan Wind Current (WC) dan di-plot pada Maneuvering Board (Mobo).
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-200 text-emerald-800 shrink-0">
            Appendix K-19
          </span>
        </div>

        {/* Form Running Footer */}
        <div className="pt-2 border-t-2 border-slate-900 flex items-center justify-between text-[11px] font-bold text-slate-800">
          <span className="tracking-wide">AVERAGE SURFACE WIND</span>
          <span className="font-mono">K-19</span>
        </div>
      </div>
    </div>
  );
}
