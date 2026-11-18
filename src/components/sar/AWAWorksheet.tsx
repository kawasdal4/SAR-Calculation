'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Printer, CheckCircle2, Plane } from 'lucide-react';
import { computeAWA, parseAltitudeFt, type AWAObservation, type AWAResult } from '@/lib/sar/sarCalculations';

export type { AWAObservation };

export interface AWAData {
  aswDirFrom: number;
  aswSpeed: number;
  vectorSumKts?: number;
  totalAltLossKft?: number;
  directionDefined?: boolean;
  isValid?: boolean;
  rows?: AWAResult['rows'];
}

export interface AWAInitialState {
  observations?: AWAObservation[];
  distressAltFt?: number;
  caseTitle?: string;
  forecastSource?: string;
  forecastValidTime?: string;
}

interface AWAWorksheetProps {
  onDataChange: (data: AWAData) => void;
  onObservationsChange?: (observations: AWAObservation[]) => void;
  onContextChange?: (context: Pick<AWAInitialState, 'distressAltFt' | 'forecastSource' | 'forecastValidTime'>) => void;
  initialState?: AWAInitialState | null;
  readOnly?: boolean;
  className?: string;
}

const AWA_OBSERVATION_LEVELS_FT = [0, 3000, 6000, 9000, 12000, 18000, 24000, 30000] as const;

function getObservationAltitude(observation: AWAObservation): number {
  return typeof observation.altObs === 'string'
    ? parseAltitudeFt(observation.altObs)
    : observation.altitudeFt ?? observation.altLow ?? Number.NaN;
}

export default function AWAWorksheet({
  onDataChange,
  onObservationsChange,
  onContextChange,
  initialState,
  readOnly = false,
  className = '',
}: AWAWorksheetProps) {
  // CONTOH 1 (Slide Basarnas I Kadek Dedi K.: Pesawat tempur PD-ABC bail out 10.000 ft)
  const defaultObsEx1: AWAObservation[] = [
    { altObs: '0', windDirFrom: 70, windSpeed: 5 },
    { altObs: '3000', windDirFrom: 120, windSpeed: 10 },
    { altObs: '6000', windDirFrom: 10, windSpeed: 15 },
    { altObs: '9000', windDirFrom: 260, windSpeed: 22 },
    { altObs: '12000', windDirFrom: 215, windSpeed: 34 },
  ];

  // LATIHAN 1 (Slide Basarnas: B737 PD-DEF trouble engine FL 260 / 26.000 ft)
  const defaultObsLat1: AWAObservation[] = [
    { altObs: '0', windDirFrom: 350, windSpeed: 10 },
    { altObs: '3000', windDirFrom: 35, windSpeed: 40 },
    { altObs: '6000', windDirFrom: 120, windSpeed: 15 },
    { altObs: '9000', windDirFrom: 90, windSpeed: 20 },
    { altObs: '12000', windDirFrom: 200, windSpeed: 15 },
    { altObs: '18000', windDirFrom: 240, windSpeed: 25 },
    { altObs: '24000', windDirFrom: 260, windSpeed: 35 },
    { altObs: '30000', windDirFrom: 300, windSpeed: 45 },
  ];

  // LATIHAN 2 (Slide Basarnas: C130 FL 160 / 16.000 ft)
  const defaultObsLat2: AWAObservation[] = [
    { altObs: '0', windDirFrom: 290, windSpeed: 7 },
    { altObs: '3000', windDirFrom: 330, windSpeed: 21 },
    { altObs: '6000', windDirFrom: 355, windSpeed: 21 },
    { altObs: '9000', windDirFrom: 25, windSpeed: 26 },
    { altObs: '12000', windDirFrom: 30, windSpeed: 32 },
    { altObs: '16000', windDirFrom: 65, windSpeed: 36 },
  ];

  const [observations, setObservations] = useState<AWAObservation[]>(
    () => initialState?.observations ?? []
  );
  const [distressAltFt, setDistressAltFt] = useState<number>(() => {
    // initialState bisa berasal dari argumen AI (distressAltFt kadang string
    // "10000") — koerce agar computeAWA dan input number menerima angka.
    const parsed = parseAltitudeFt(initialState?.distressAltFt);
    return Number.isFinite(parsed) ? parsed : 0;
  });
  const [forecastSource, setForecastSource] = useState(initialState?.forecastSource ?? '');
  const [forecastValidTime, setForecastValidTime] = useState(initialState?.forecastValidTime ?? '');

  const [caseTitle, setCaseTitle] = useState(initialState?.caseTitle ?? '-');
  const [caseNumber, setCaseNumber] = useState('0');
  const [searchDate, setSearchDate] = useState('-');
  const [plannerName, setPlannerName] = useState('-');
  const [datumNumber, setDatumNumber] = useState('0');
  const [searchPlan, setSearchPlan] = useState<'A' | 'B' | 'C' | ''>('');

  useEffect(() => {
    onObservationsChange?.(observations);
  }, [observations, onObservationsChange]);

  const summary = useMemo(() => computeAWA(observations, distressAltFt), [observations, distressAltFt]);
  const detailedRows = useMemo(() => {
    const layersByInput = new Map<number, AWAResult['rows'][number]>(
      summary.rows.map((row) => [row.inputIndex, row] as const),
    );
    const rows = observations
      .map((observation, inputIndex) => {
        const calculated = layersByInput.get(inputIndex);
        const altitudeText = typeof observation.altObs === 'string'
          ? observation.altObs
          : String(observation.altitudeFt ?? observation.altLow ?? '');
        const parsedAltitude = parseAltitudeFt(altitudeText);
        return {
          ...observation,
          inputIndex,
          altitudeFt: calculated?.altitudeFt ?? parsedAltitude,
          intervalLowFt: calculated?.intervalLowFt ?? null,
          intervalHighFt: calculated?.intervalHighFt ?? null,
          kft: calculated?.altitudeKft ?? 0,
          contrib: calculated?.contributionKts ?? 0,
          windDirFrom: observation.windDirFrom,
          windSpeed: observation.windSpeed,
        };
      });
    if (summary.rows.length === 0) return rows;
    return rows.sort((a, b) => {
      if (!Number.isFinite(a.altitudeFt) && !Number.isFinite(b.altitudeFt)) return 0;
      if (!Number.isFinite(a.altitudeFt)) return 1;
      if (!Number.isFinite(b.altitudeFt)) return -1;
      return a.altitudeFt - b.altitudeFt;
    });
  }, [observations, summary.rows]);

  useEffect(() => {
    onDataChange({
      aswDirFrom: summary.isValid ? summary.awaDirFrom : 0,
      aswSpeed: summary.isValid ? summary.awaSpeed : 0,
      vectorSumKts: summary.vectorSumKts,
      totalAltLossKft: summary.totalAltLossKft,
      directionDefined: summary.directionDefined,
      isValid: summary.isValid,
      rows: summary.rows,
    });
  }, [summary, onDataChange]);

  useEffect(() => {
    onContextChange?.({ distressAltFt, forecastSource, forecastValidTime });
  }, [distressAltFt, forecastSource, forecastValidTime, onContextChange]);

  const update = (idx: number, key: keyof AWAObservation, value: any) => {
    const next = observations.map((o, i) => (i === idx ? { ...o, [key]: value } : o));
    setObservations(next);
  };

  const addRow = () => {
    const levels = new Set(observations.map(getObservationAltitude).filter(Number.isFinite));
    const newAltitude = AWA_OBSERVATION_LEVELS_FT.find((altitude) => !levels.has(altitude));
    if (newAltitude === undefined) return;
    const next = [...observations, { altObs: String(newAltitude), windDirFrom: 0, windSpeed: 0 }]
      .sort((a, b) => getObservationAltitude(a) - getObservationAltitude(b));
    setObservations(next);
  };

  const hasAvailableObservationLevel = AWA_OBSERVATION_LEVELS_FT.some((altitude) =>
    !observations.some((observation) => getObservationAltitude(observation) === altitude),
  );

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
    setForecastSource('');
    setForecastValidTime('');
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
          <span className="font-mono text-slate-900">K-10</span>
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
              Perhitungan Angin Atas / Average Wind Aloft
            </p>
          </div>
          <span className="text-xs bg-sky-100 text-sky-950 font-bold px-3 py-1 rounded border border-sky-300 font-mono">
            AWA: {summary.isValid ? `${summary.awaDirFrom.toFixed(1)}°T / ${summary.awaSpeed.toFixed(2)} kts` : 'belum valid'}
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
            Target memotong lapisan; masukkan level Surface/0 ft dan level pengamatan di atau di atas target.
          </div>
        </div>
        <p className="-mt-2 text-[11px] text-slate-600">
          Arah angin pada kolom B adalah bearing True dan dipakai langsung untuk vektor; aplikasi tidak menambahkan 180°. Kecepatan harus dalam knots.
        </p>

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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-1.5">
              <span className="text-slate-700 font-semibold shrink-0">Forecast source:</span>
              <input
                type="text"
                value={forecastSource}
                disabled={readOnly}
                onChange={(e) => setForecastSource(e.target.value)}
                placeholder="Contoh: BMKG Aviation"
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-full"
              />
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-slate-700 font-semibold shrink-0">Forecast valid time:</span>
              <input
                type="text"
                value={forecastValidTime}
                disabled={readOnly}
                onChange={(e) => setForecastValidTime(e.target.value)}
                placeholder="Waktu UTC yang sama untuk semua level"
                className="font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 w-full font-mono"
              />
            </label>
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
                onClick={() => loadPreset(defaultObsEx1, 'EXAMPLE 1 (K-10)', 'Contoh', 10000)}
                className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold px-2 py-0.5 rounded border border-slate-300 transition-colors"
              >
                Contoh
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setObservations([]);
                }}
                className="text-[11px] bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold px-2.5 py-1 rounded border border-rose-300 flex items-center gap-1 shadow-2xs transition-colors"
                title="Kosongkan seluruh baris pengamatan di tab AWA"
              >
                <Trash2 className="h-3 w-3 text-rose-600" /> Kosongkan Baris (Clear)
              </button>
              <button
                type="button"
                onClick={addRow}
                disabled={!hasAvailableObservationLevel}
                title={hasAvailableObservationLevel ? 'Tambah level berikutnya: Surface, 3000, 6000, 9000, 12000, 18000, 24000, 30000 ft' : 'Semua level ketinggian pengamatan yang tersedia sudah ditambahkan'}
                className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold px-2.5 py-1 rounded border border-slate-400 flex items-center gap-1 shadow-2xs transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3 w-3 text-emerald-600" /> {hasAvailableObservationLevel ? 'Tambah Ketinggian Pengamatan' : 'Semua Ketinggian Ditambahkan'}
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
                {/* Kolom 2: Altitude interval derived from adjacent observation midpoints */}
                <th className="py-2 px-2 text-center w-[20%] border-r border-slate-400">
                  <div>Altitude</div>
                  <div>interval (A)</div>
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
                detailedRows.map((row) => (
                <tr key={row.inputIndex} className="hover:bg-slate-50">
                  {/* Altitude of observation (HANYA SATU KETINGGIAN: 0, 3000, 6000, dst.) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-slate-900">
                    {readOnly ? (
                      <span>{Number.isFinite(row.altitudeFt) && row.altitudeFt === 0 ? 'Surface' : row.altObs ?? (Number.isFinite(row.altitudeFt) ? row.altitudeFt : '—')}</span>
                    ) : (
                      <input
                        type="text"
                        value={row.altObs ?? (Number.isFinite(row.altitudeFt) ? String(row.altitudeFt) : '')}
                        suppressHydrationWarning
                        spellCheck={false}
                        data-ms-editor="true"
                        onChange={(e) => update(row.inputIndex, 'altObs', e.target.value)}
                        placeholder="3000"
                        className="w-16 text-center font-bold text-blue-900 bg-white border-b border-dotted border-slate-600 px-1 font-mono"
                      />
                    )}
                  </td>

                  {/* Altitude interval derived from midpoints and clipped to target */}
                  <td className="py-2 px-2 text-center border-r border-slate-300">
                    {row.intervalLowFt !== null && row.intervalHighFt !== null ? (
                      <span className="font-bold text-slate-800">
                        {(row.intervalLowFt / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 })} – {(row.intervalHighFt / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 })}
                      </span>
                    ) : (
                      <span className="text-slate-400">
                        {summary.rows.length > 0 && row.altitudeFt > distressAltFt ? 'Di atas target' : '—'}
                      </span>
                    )}
                  </td>

                  {/* Thousands of feet (A) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-slate-900">
                    {summary.rows.length > 0 ? row.kft.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}
                  </td>

                  {/* Wind direction (B) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300">
                    {readOnly ? (
                      <span className="font-bold text-blue-900">{Number.isFinite(row.windDirFrom) ? `${String(row.windDirFrom).padStart(3, '0')}°T` : '—'}</span>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max="360"
                          value={Number.isFinite(row.windDirFrom) ? row.windDirFrom : ''}
                          suppressHydrationWarning
                          spellCheck={false}
                          data-ms-editor="true"
                          onChange={(e) => update(row.inputIndex, 'windDirFrom', e.target.value === '' ? Number.NaN : Number(e.target.value))}
                          className="w-14 text-center font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-600"
                        />
                        <span className="text-slate-600 font-sans">°T</span>
                      </div>
                    )}
                  </td>

                  {/* Wind speed (C) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300">
                    {readOnly ? (
                      <span className="font-bold text-blue-900">{Number.isFinite(row.windSpeed) ? `${row.windSpeed} kts` : '—'}</span>
                    ) : (
                      <div className="flex items-center justify-center gap-1">
                        <input
                          type="number"
                          min="0"
                          value={Number.isFinite(row.windSpeed) ? row.windSpeed : ''}
                          suppressHydrationWarning
                          spellCheck={false}
                          data-ms-editor="true"
                          onChange={(e) => update(row.inputIndex, 'windSpeed', e.target.value === '' ? Number.NaN : Number(e.target.value))}
                          className="w-12 text-center font-bold text-blue-900 bg-blue-50/50 border-b border-dotted border-slate-600"
                        />
                        <span className="text-slate-600 font-sans">kts</span>
                      </div>
                    )}
                  </td>

                  {/* Wind contribution (A x C) */}
                  <td className="py-2 px-2 text-center border-r border-slate-300 font-bold text-blue-950 bg-blue-50/40">
                    {summary.rows.length > 0 ? row.contrib.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'} <span className="font-normal text-slate-500 text-[10px]">kts</span>
                  </td>

                  {/* Aksi */}
                  {!readOnly && (
                    <td className="py-2 px-1 text-center print:hidden">
                      <button
                        type="button"
                        onClick={() => removeRow(row.inputIndex)}
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
                  {summary.rows.length > 0 ? `${summary.totalAltLossKft.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} (D)` : '—'}
                </td>
                <td colSpan={2} className="py-2.5 px-2 text-right border-r border-slate-300 font-sans">
                  Vector sum of contributions (E) °T & (F) kts:
                </td>
                <td className="py-2.5 px-2 text-center border-r border-slate-300 text-blue-950 text-xs bg-blue-100/60">
                  <div>{summary.directionDefined ? `${summary.awaDirFrom.toFixed(1)}°T (E)` : '— (E)'}</div>
                  <div>{summary.rows.length > 0 ? `${summary.vectorSumKts.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kts (F)` : '— (F)'}</div>
                </td>
                {!readOnly && <td className="print:hidden" />}
              </tr>

              {/* Final AWA Result Line */}
              <tr className="bg-sky-50 font-black border-t border-slate-800 text-xs">
                <td colSpan={3} className="py-2.5 px-3 font-sans text-slate-900 uppercase">
                  Average wind aloft [(E)°T (F/D) kts]
                </td>
                <td colSpan={readOnly ? 3 : 4} className="py-2.5 px-3 text-right font-mono text-sm text-blue-950">
                  AWA = <span className="text-sky-900 underline">{summary.isValid ? `${summary.awaDirFrom.toFixed(1)}°T` : '—'}</span> /{' '}
                  <span className="text-sky-900 underline">{summary.isValid ? `${summary.awaSpeed.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kts` : '—'}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {observations.length > 0 && summary.errors.length > 0 && (
          <div className="p-3 bg-amber-50 border border-amber-300 rounded text-xs text-amber-950">
            <div className="font-bold mb-1">Perlu perbaikan data AWA</div>
            <ul className="list-disc pl-5 space-y-0.5">
              {summary.errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
            </ul>
          </div>
        )}
        {observations.length > 0 && (!forecastSource.trim() || !forecastValidTime.trim()) && (
          <div className="p-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-600">
            Catat sumber forecast dan waktu valid yang sama untuk semua level agar input dapat ditelusuri.
          </div>
        )}

        {/* Handover Banner to Aeronautical Drift Worksheet */}
        {observations.length > 0 && <div className={`p-3 rounded text-xs flex items-center justify-between gap-2 ${summary.isValid ? 'bg-emerald-50 border border-emerald-300' : 'bg-slate-50 border border-slate-200'}`}>
          <div className="flex items-center gap-2">
            <CheckCircle2 className={`h-4 w-4 shrink-0 ${summary.isValid ? 'text-emerald-700' : 'text-slate-400'}`} />
            <span className={`${summary.isValid ? 'text-emerald-950' : 'text-slate-700'} font-medium`}>
              {summary.isValid ? (
                <>Hasil AWA (<span className="font-bold">{summary.awaDirFrom.toFixed(1)}°T / {summary.awaSpeed.toFixed(2)} kts</span>) diteruskan ke ADW dan dipetakan pada Maneuvering Board.</>
              ) : 'Nilai AWA belum diteruskan karena input atau cakupan altitude belum valid.'}
            </span>
          </div>
          <span className="text-[10px] font-mono font-bold bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-700 shrink-0">
            Appendix K-10
          </span>
        </div>}

        {/* Form Running Footer */}
        <div className="pt-2 border-t-2 border-slate-900 flex items-center justify-between text-[11px] font-bold text-slate-800">
          <span className="font-mono">K-10</span>
          <span className="tracking-wide">AVERAGE WIND ALOFT</span>
        </div>
      </div>
    </div>
  );
}
