'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Printer, CheckCircle2, Plane, Compass } from 'lucide-react';
import { type AWAObservation } from '@/lib/sar/sarCalculations';

export type { AWAObservation };

export interface AWAData {
  aswDirFrom: number;
  aswSpeed: number;
}

export interface AWAInitialState {
  observations?: AWAObservation[];
  distressAltFt?: number;
  caseTitle?: string;
}

interface AWAWorksheetProps {
  onDataChange: (data: AWAData) => void;
  onObservationsChange?: (observations: AWAObservation[]) => void;
  initialState?: AWAInitialState | null;
  readOnly?: boolean;
  className?: string;
}

export default function AWAWorksheet({
  onDataChange,
  onObservationsChange,
  initialState,
  readOnly = false,
  className = '',
}: AWAWorksheetProps) {
  // CONTOH 1 (Slide Basarnas I Kadek Dedi K.: Pesawat tempur PD-ABC bail out 10.000 ft)
  const defaultObsEx1: AWAObservation[] = [
    { altObs: '0', altLow: 0, altHigh: 1500, windDirFrom: 70, windSpeed: 5 },
    { altObs: '3000', altLow: 1500, altHigh: 4500, windDirFrom: 120, windSpeed: 10 },
    { altObs: '6000', altLow: 4500, altHigh: 7500, windDirFrom: 10, windSpeed: 15 },
    { altObs: '9000', altLow: 7500, altHigh: 10000, windDirFrom: 260, windSpeed: 22 },
  ];

  // LATIHAN 1 (Slide Basarnas: B737 PD-DEF trouble engine FL 260 / 26.000 ft)
  const defaultObsLat1: AWAObservation[] = [
    { altObs: '0', altLow: 0, altHigh: 1500, windDirFrom: 350, windSpeed: 10 },
    { altObs: '3000', altLow: 1500, altHigh: 4500, windDirFrom: 35, windSpeed: 40 },
    { altObs: '6000', altLow: 4500, altHigh: 7500, windDirFrom: 120, windSpeed: 15 },
    { altObs: '9000', altLow: 7500, altHigh: 10500, windDirFrom: 90, windSpeed: 20 },
    { altObs: '12000', altLow: 10500, altHigh: 15000, windDirFrom: 200, windSpeed: 15 },
    { altObs: '18000', altLow: 15000, altHigh: 21000, windDirFrom: 240, windSpeed: 25 },
    { altObs: '24000', altLow: 21000, altHigh: 26000, windDirFrom: 260, windSpeed: 35 },
  ];

  // LATIHAN 2 (Slide Basarnas: C130 FL 160 / 16.000 ft)
  const defaultObsLat2: AWAObservation[] = [
    { altObs: '0', altLow: 0, altHigh: 1500, windDirFrom: 290, windSpeed: 7 },
    { altObs: '3000', altLow: 1500, altHigh: 4500, windDirFrom: 330, windSpeed: 21 },
    { altObs: '6000', altLow: 4500, altHigh: 7500, windDirFrom: 355, windSpeed: 21 },
    { altObs: '9000', altLow: 7500, altHigh: 10500, windDirFrom: 25, windSpeed: 26 },
    { altObs: '12000', altLow: 10500, altHigh: 14000, windDirFrom: 30, windSpeed: 32 },
    { altObs: '16000', altLow: 14000, altHigh: 16000, windDirFrom: 65, windSpeed: 36 },
  ];

  // Official IAMSAR Manual Volume II Appendix K-10 / Figure K-1 authentic data
  const defaultObsFigK1: AWAObservation[] = [
    { altObs: '8000', altLow: 7000, altHigh: 8000, windDirFrom: 270, windSpeed: 30 },
    { altObs: '6000', altLow: 5000, altHigh: 7000, windDirFrom: 300, windSpeed: 25 },
    { altObs: '4000', altLow: 3000, altHigh: 5000, windDirFrom: 300, windSpeed: 25 },
    { altObs: '2000', altLow: 1000, altHigh: 3000, windDirFrom: 0, windSpeed: 23 },
    { altObs: '0', altLow: 0, altHigh: 1000, windDirFrom: 45, windSpeed: 44 },
  ];

  const [observations, setObservations] = useState<AWAObservation[]>(
    () => initialState?.observations ?? []
  );
  const [distressAltFt, setDistressAltFt] = useState<number>(initialState?.distressAltFt ?? 10000);

  const [caseTitle, setCaseTitle] = useState(initialState?.caseTitle ?? 'OPERASI SAR PESAWAT UDARA');
  const [caseNumber, setCaseNumber] = useState('SAR-01');
  const [searchDate, setSearchDate] = useState('15 Nov 2026');
  const [plannerName, setPlannerName] = useState('SAR Planner Basarnas');
  const [datumNumber, setDatumNumber] = useState('01');
  const [searchPlan, setSearchPlan] = useState<'A' | 'B' | 'C'>('A');

  useEffect(() => {
    onObservationsChange?.(observations);
  }, [observations, onObservationsChange]);

  // Vector calculation matching Maneuvering Board in slide deck
  const detailedRows = useMemo(() => {
    return observations.map((obs) => {
      const kft = Number((Math.max(0, obs.altHigh - obs.altLow) / 1000).toFixed(1));
      const contrib = Number((kft * obs.windSpeed).toFixed(1));
      const rad = (obs.windDirFrom * Math.PI) / 180;
      const sinQ = Math.sin(rad);
      const cosQ = Math.cos(rad);
      const aSinQ = contrib * sinQ;
      const aCosQ = contrib * cosQ;

      return {
        ...obs,
        kft,
        contrib,
        rad,
        sinQ,
        cosQ,
        aSinQ,
        aCosQ,
      };
    });
  }, [observations]);

  // Totals & Resultant Vector matching Basarnas presentation
  const summary = useMemo(() => {
    const totalAltLossD = detailedRows.reduce((sum, r) => sum + r.kft, 0);
    const sumASinQ = detailedRows.reduce((sum, r) => sum + r.aSinQ, 0);
    const sumACosQ = detailedRows.reduce((sum, r) => sum + r.aCosQ, 0);

    const Rx = sumACosQ;
    const Ry = sumASinQ;
    const vectorSumF = Math.sqrt(Rx * Rx + Ry * Ry);

    let resultantDeg = Math.round((Math.atan2(Ry, Rx) * 180) / Math.PI);
    if (resultantDeg < 0) resultantDeg += 360;

    const awaSpeed = totalAltLossD > 0 ? Number((vectorSumF / totalAltLossD).toFixed(2)) : 0;
    const awaDirFrom = resultantDeg;

    return {
      totalAltLossD: Math.round(totalAltLossD * 10) / 10,
      vectorSumF: Math.round(vectorSumF * 10) / 10,
      awaDirFrom,
      awaSpeed,
    };
  }, [detailedRows]);

  const emit = (dir: number, spd: number) => {
    onDataChange({ aswDirFrom: dir, aswSpeed: spd });
  };

  useEffect(() => {
    emit(summary.awaDirFrom, summary.awaSpeed);
  }, [summary.awaDirFrom, summary.awaSpeed]);

  const update = (idx: number, key: keyof AWAObservation, value: any) => {
    const next = observations.map((o, i) => (i === idx ? { ...o, [key]: value } : o));
    setObservations(next);
  };

  const addRow = () => {
    const first = observations[0];
    const newHigh = first ? first.altHigh + 3000 : 9000;
    const newLow = first ? first.altHigh : 6000;
    const next = [
      ...observations,
      {
        altObs: String(newHigh),
        altLow: newLow,
        altHigh: newHigh,
        windDirFrom: 280,
        windSpeed: 20,
      },
    ];
    setObservations(next);
  };

  const removeRow = (idx: number) => {
    if (observations.length <= 1) return;
    setObservations(observations.filter((_, i) => i !== idx));
  };

  const loadPreset = (
    preset: AWAObservation[],
    title: string,
    planner: string,
    altFt: number
  ) => {
    setObservations(preset);
    setCaseTitle(title);
    setPlannerName(planner);
    setDistressAltFt(altFt);
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  return (
    <div className={`space-y-4 ${className} text-slate-900 font-sans`}>
      {/* Printable / Viewable Official Appendix K Header */}
      <div className="flex items-center justify-between border-b-2 border-slate-900 pb-1 text-[11px] font-bold text-slate-700">
        <span className="tracking-wide">Appendix K – Determining datum</span>
        <div className="flex items-center gap-3">
          <span className="font-mono text-slate-900">K-10 IAMSAR MANUAL VOLUME II</span>
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
        {/* Document Title (Appendix K-10 Authentic Title) */}
        <div className="border-b-2 border-slate-900 pb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base sm:text-lg font-black tracking-tight uppercase text-slate-950 font-serif">
              Average wind aloft (AWA) worksheet
            </h1>
            <p className="text-[11px] text-slate-500 font-mono">
              Formulir Asli IAMSAR Manual Volume II Appendix K-10 (Perhitungan Angin Atas / Average Wind Aloft)
            </p>
          </div>
          <span className="text-xs bg-sky-100 text-sky-950 font-bold px-3 py-1 rounded border border-sky-300 font-mono">
            AWA: {summary.awaDirFrom}°T / {summary.awaSpeed} kts
          </span>
        </div>

        {/* Operational Context: Aircraft Distress / Bailout Altitude */}
        <div className="bg-sky-50/70 border border-sky-300 rounded p-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Plane className="h-4 w-4 text-sky-800" />
            <span className="font-bold text-sky-950">Ketinggian Bail Out / Mesin Mati:</span>
            <div className="flex items-center gap-1 font-mono">
              <input
                type="number"
                step="1000"
                value={distressAltFt}
                disabled={readOnly}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setDistressAltFt(Number(e.target.value) || 0)}
                className="w-24 text-center font-bold text-blue-900 bg-white border border-sky-300 rounded px-1.5 py-0.5 shadow-2xs"
              />
              <span className="font-sans text-sky-900 font-semibold">feet</span>
            </div>
          </div>
          <div className="text-[11px] text-sky-800 italic">
            Rumus Titik Tengah Interval: (AltAtas + AltBawah) / 2 per slide Diklat hal. 13-14
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
                  className={`w-6 h-6 rounded-full font-bold flex items-center justify-center transition-colors ${
                    searchPlan === plan
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

        {/* Action Buttons */}
        {!readOnly && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 print:hidden">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-500 font-medium">Contoh Soal:</span>
              <button
                type="button"
                onClick={() => loadPreset(defaultObsLat1, 'LATIHAN 1 (B737 FL 260)', 'Instruktur Basarnas', 26000)}
                className="text-[10px] bg-sky-50 hover:bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded border border-sky-300 transition-colors"
              >
                Latihan 1 (FL 260)
              </button>
              <button
                type="button"
                onClick={() => loadPreset(defaultObsLat2, 'LATIHAN 2 (C130 FL 160)', 'Instruktur Basarnas', 16000)}
                className="text-[10px] bg-sky-50 hover:bg-sky-100 text-sky-800 font-semibold px-2 py-0.5 rounded border border-sky-300 transition-colors"
              >
                Latihan 2 (FL 160)
              </button>
              <button
                type="button"
                onClick={() => loadPreset(defaultObsEx1, 'EXAMPLE 1 (IAMSAR K-10)', 'IAMSAR Manual', 10000)}
                className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded border border-slate-300 transition-colors"
              >
                Contoh IAMSAR
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setObservations([]);
                  onDataChange({ aswDirFrom: 0, aswSpeed: 0 });
                }}
                className="text-[11px] bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-2.5 py-1 rounded border border-rose-300 flex items-center gap-1 shadow-2xs transition-colors"
                title="Kosongkan seluruh baris pengamatan di tab AWA"
              >
                <Trash2 className="h-3 w-3 text-rose-600" /> Kosongkan Baris (Clear)
              </button>
              <button
                type="button"
                onClick={addRow}
                className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-2.5 py-1 rounded border border-slate-400 flex items-center gap-1 shadow-2xs transition-colors"
              >
                <Plus className="h-3 w-3 text-emerald-600" /> Tambah Ketinggian Pengamatan
              </button>
            </div>
          </div>
        )}

        {/* Authentic Appendix K-10 Main Table */}
        <div className="border border-slate-800 rounded overflow-hidden">
          <table className="w-full border-collapse text-xs table-fixed">
            <thead>
              <tr className="bg-slate-200/90 text-slate-950 font-bold border-b-2 border-slate-800 text-[11px]">
                {/* Kolom 1: Altitude of observation - HANYA SATU NILAI KETINGGIAN */}
                <th className="py-2 px-2 text-center w-[18%] border-r border-slate-400">
                  <div>Altitude of</div>
                  <div>observation</div>
                </th>
                {/* Kolom 2: Altitude interval (–) */}
                <th className="py-2 px-2 text-center w-[20%] border-r border-slate-400">
                  <div>Altitude</div>
                  <div>interval (–)</div>
                </th>
                {/* Kolom 3: Thousands of feet (A) */}
                <th className="py-2 px-2 text-center w-[14%] border-r border-slate-400">
                  <div>Thousands</div>
                  <div>of feet (A)</div>
                </th>
                {/* Kolom 4: Wind direction (B) */}
                <th className="py-2 px-2 text-center w-[16%] border-r border-slate-400">
                  <div>Wind</div>
                  <div>direction (B)</div>
                </th>
                {/* Kolom 5: Wind speed (C) */}
                <th className="py-2 px-2 text-center w-[14%] border-r border-slate-400">
                  <div>Wind</div>
                  <div>speed (C)</div>
                </th>
                {/* Kolom 6: Wind contribution (A x C) */}
                <th className="py-2 px-2 text-center w-[18%] bg-blue-50/70 border-r border-slate-400">
                  <div>Wind</div>
                  <div>contribution (A × C)</div>
                </th>
                {!readOnly && <th className="py-2 px-1 text-center w-[8%] print:hidden">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-300 text-[11px] font-mono">
              {detailedRows.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 6 : 7} className="py-6 text-center text-slate-500 font-sans text-xs bg-slate-50">
                    Belum ada baris pengamatan angin. Klik <strong>"+ Tambah Ketinggian Pengamatan"</strong> atau pilih <strong>Contoh Soal</strong> di atas untuk mulai mengisi data.
                  </td>
                </tr>
              ) : (
                detailedRows.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  {/* Altitude of observation (HANYA SATU KETINGGIAN: 0, 3000, 6000, dst.) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-slate-900">
                    {readOnly ? (
                      <span>{row.altObs ?? row.altLow}</span>
                    ) : (
                      <input
                        type="text"
                        value={row.altObs ?? (row.altLow === 0 ? '0' : String(row.altLow))}
                        suppressHydrationWarning
                        spellCheck={false}
                        data-ms-editor="true"
                        onChange={(e) => update(i, 'altObs', e.target.value)}
                        placeholder="3000"
                        className="w-16 text-center font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 font-mono"
                      />
                    )}
                  </td>

                  {/* Altitude interval (–) e.g. 0 - 1.5, 1.5 - 4.5 */}
                  <td className="py-2 px-2 text-center border-r border-slate-300">
                    {readOnly ? (
                      <span className="font-bold text-slate-800">
                        {(row.altLow / 1000).toString().replace('.', ',')} – {(row.altHigh / 1000).toString().replace('.', ',')}
                      </span>
                    ) : (
                      <div className="flex items-center justify-center gap-1 font-mono">
                        <input
                          type="number"
                          step="500"
                          value={row.altLow}
                          suppressHydrationWarning
                          spellCheck={false}
                          data-ms-editor="true"
                          onChange={(e) => update(i, 'altLow', Number(e.target.value) || 0)}
                          className="w-14 text-center font-bold text-blue-900 bg-white border-b border-dotted border-slate-600"
                        />
                        <span>–</span>
                        <input
                          type="number"
                          step="500"
                          value={row.altHigh}
                          suppressHydrationWarning
                          spellCheck={false}
                          data-ms-editor="true"
                          onChange={(e) => update(i, 'altHigh', Number(e.target.value) || 0)}
                          className="w-14 text-center font-bold text-blue-900 bg-white border-b border-dotted border-slate-600"
                        />
                      </div>
                    )}
                  </td>

                  {/* Thousands of feet (A) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-slate-900">
                    {row.kft.toString().replace('.', ',')}
                  </td>

                  {/* Wind direction (B) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300">
                    {readOnly ? (
                      <span className="font-bold text-blue-900">{String(row.windDirFrom).padStart(3, '0')}°T</span>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="359"
                          value={row.windDirFrom}
                          suppressHydrationWarning
                          spellCheck={false}
                          data-ms-editor="true"
                          onChange={(e) => update(i, 'windDirFrom', Number(e.target.value) || 0)}
                          className="w-14 text-center font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-600"
                        />
                        <span className="text-slate-600 font-sans">°T</span>
                      </div>
                    )}
                  </td>

                  {/* Wind speed (C) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300">
                    {readOnly ? (
                      <span className="font-bold text-blue-900">{row.windSpeed} kts</span>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="number"
                          min="0"
                          value={row.windSpeed}
                          suppressHydrationWarning
                          spellCheck={false}
                          data-ms-editor="true"
                          onChange={(e) => update(i, 'windSpeed', Number(e.target.value) || 0)}
                          className="w-12 text-center font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-600"
                        />
                        <span className="text-slate-600 font-sans">kts</span>
                      </div>
                    )}
                  </td>

                  {/* Wind contribution (A x C) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-blue-950 bg-blue-50/40">
                    {row.contrib.toString().replace('.', ',')} <span className="font-normal text-slate-500 text-[10px]">kts</span>
                  </td>

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

              {/* Total Altitude Loss & Vector Sum of Contributions Row */}
              <tr className="bg-slate-100 font-bold border-t-2 border-slate-800 text-slate-900">
                <td colSpan={2} className="py-2.5 px-3 text-right border-r border-slate-300 font-sans">
                  Total altitude loss (thousands of feet) (D):
                </td>
                <td className="py-2.5 px-2 text-center border-r border-slate-300 text-blue-950 text-xs">
                  {summary.totalAltLossD.toString().replace('.', ',')} (D)
                </td>
                <td colSpan={2} className="py-2.5 px-2 text-right border-r border-slate-300 font-sans">
                  Vector sum of contributions (E) °T & (F) kts:
                </td>
                <td className="py-2.5 px-2 text-center border-r border-slate-300 text-blue-950 text-xs bg-blue-100/60">
                  <div>{summary.awaDirFrom}°T (E)</div>
                  <div>{summary.vectorSumF.toString().replace('.', ',')} kts (F)</div>
                </td>
                {!readOnly && <td className="print:hidden" />}
              </tr>

              {/* Final AWA Result Line */}
              <tr className="bg-sky-50 font-black border-t border-slate-800 text-xs">
                <td colSpan={3} className="py-2.5 px-3 font-sans text-slate-900 uppercase">
                  Average wind aloft [(E)°T (F/D) kts]
                </td>
                <td colSpan={readOnly ? 3 : 4} className="py-2.5 px-3 text-right font-mono text-sm text-blue-950">
                  AWA = <span className="text-sky-900 underline">{summary.awaDirFrom}°T</span> /{' '}
                  <span className="text-sky-900 underline">{summary.awaSpeed.toString().replace('.', ',')} kts</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Handover Banner to Aeronautical Drift Worksheet */}
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded text-xs flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
            <span className="text-emerald-950 font-medium">
              Hasil nilai AWA (<span className="font-bold">{summary.awaDirFrom}°T / {summary.awaSpeed} kts</span>) otomatis diteruskan ke baris B.10 Aeronautical Drift Worksheet (ADW) dan divisualisasikan pada Maneuvering Board (Mobo) di tab sebelah.
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold bg-white px-2 py-0.5 rounded border border-emerald-200 text-emerald-800 shrink-0">
            IAMSAR App K-10
          </span>
        </div>

        {/* Form Running Footer */}
        <div className="pt-2 border-t-2 border-slate-900 flex items-center justify-between text-[11px] font-bold text-slate-800">
          <span className="font-mono">K-10</span>
          <span className="tracking-wide">IAMSAR MANUAL VOLUME II</span>
        </div>
      </div>
    </div>
  );
}
