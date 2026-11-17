'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Printer, Plane, CheckCircle2, ArrowRight } from 'lucide-react';
import {
  type HeadingReference,
  type EastWest,
  type AeroDriftInput,
  type AeroDriftResult,
  calculateAeroDrift,
} from '@/lib/sar/aeroDriftCalculations';
import { type LatLng } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import {
  N13_PARACHUTES,
  TABLE_N13_SOURCE,
  getN13Parachute,
  n13RateOfDescent,
} from '@/lib/sar/tableN13.mjs';
import CoordinateInput from './CoordinateInput';

interface AeronauticalDriftWorksheetProps {
  initialLkp?: LatLng;
  awaDirFrom?: number;
  awaSpeedKts?: number;
  awaIsValid?: boolean;
  initialState?: AeroDriftInitialState | null;
  onResults?: (results: AeroDriftResult) => void;
  onStateChange?: (state: AeroDriftInput) => void;
  className?: string;
}

/** Data awal yang bisa diterapkan dari luar (mis. AI assistant) tanpa field AWA (dari props). */
export type AeroDriftInitialState = Omit<Partial<AeroDriftInput>, 'awaIsValid' | 'awaGlideDirFrom' | 'awaGlideSpeedKts'>;

function formatFt(val: number): string {
  return Math.round(val)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

interface HeadingInputProps {
  label: string;
  value?: number;
  convertedHeading?: number | null;
  reference: HeadingReference;
  variation?: number;
  variationDirection: EastWest;
  deviation?: number;
  deviationDirection: EastWest;
  onValueChange: (value?: number) => void;
  onReferenceChange: (value: HeadingReference) => void;
  onVariationChange: (value?: number) => void;
  onVariationDirectionChange: (value: EastWest) => void;
  onDeviationChange: (value?: number) => void;
  onDeviationDirectionChange: (value: EastWest) => void;
}

function HeadingInput({
  label,
  value,
  convertedHeading,
  reference,
  variation,
  variationDirection,
  deviation,
  deviationDirection,
  onValueChange,
  onReferenceChange,
  onVariationChange,
  onVariationDirectionChange,
  onDeviationChange,
  onDeviationDirectionChange,
}: HeadingInputProps) {
  const inputClass = 'min-w-0 w-16 rounded border border-slate-300 bg-white px-1 py-0.5 text-right font-mono';
  const selectClass = 'min-w-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-[10px]';
  const parseOptionalNumber = (raw: string) => raw === '' ? undefined : Number(raw);

  return (
    <div className="w-36 space-y-1">
      <div className="flex items-center gap-1">
        <input
          aria-label={`${label} reported heading`}
          type="number"
          min="0"
          max="359.9"
          step="0.1"
          value={value ?? ''}
          onChange={(event) => onValueChange(parseOptionalNumber(event.target.value))}
          className={inputClass}
        />
        <span>°</span>
        <select
          aria-label={`${label} heading reference`}
          value={reference}
          onChange={(event) => onReferenceChange(event.target.value as HeadingReference)}
          className={selectClass}
        >
          <option value="true">True</option>
          <option value="magnetic">Magnetic</option>
          <option value="compass">Compass</option>
        </select>
      </div>
      {reference !== 'true' && (
        <div className="flex items-center gap-1 text-[10px]">
          <span className="shrink-0">Var</span>
          <input
            aria-label={`${label} magnetic variation`}
            type="number"
            min="0"
            step="0.1"
            value={variation ?? ''}
            onChange={(event) => onVariationChange(parseOptionalNumber(event.target.value))}
            className={inputClass}
          />
          <select
            aria-label="Magnetic variation direction"
            value={variationDirection}
            onChange={(event) => onVariationDirectionChange(event.target.value as EastWest)}
            className={selectClass}
          >
            <option value="E">E</option>
            <option value="W">W</option>
          </select>
        </div>
      )}
      {reference === 'compass' && (
        <div className="flex items-center gap-1 text-[10px]">
          <span className="shrink-0">Dev</span>
          <input
            aria-label={`${label} compass deviation`}
            type="number"
            min="0"
            step="0.1"
            value={deviation ?? ''}
            onChange={(event) => onDeviationChange(parseOptionalNumber(event.target.value))}
            className={inputClass}
          />
          <select
            aria-label={`${label} deviation direction`}
            value={deviationDirection}
            onChange={(event) => onDeviationDirectionChange(event.target.value as EastWest)}
            className={selectClass}
          >
            <option value="E">E</option>
            <option value="W">W</option>
          </select>
        </div>
      )}
      <div className="text-[9px] text-slate-600">B.9 True: {convertedHeading == null ? '-' : `${convertedHeading.toFixed(1)}°T`}</div>
    </div>
  );
}

function formatUtcEnd(dateValue: string, timeValue: string, minutes: number): string | null {
  const dateInput = dateValue.trim();
  let year: number;
  let month: number;
  let day: number;
  const isoMatch = dateInput.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const textMatch = dateInput.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/i);
    if (!textMatch) return null;
    const monthIndex = new Map([
      ['jan', 1], ['january', 1], ['januari', 1], ['feb', 2], ['february', 2], ['februari', 2], ['mar', 3], ['march', 3], ['maret', 3],
      ['april', 4], ['apr', 4], ['may', 5], ['mei', 5], ['june', 6], ['juni', 6], ['july', 7], ['juli', 7],
      ['aug', 8], ['august', 8], ['agustus', 8], ['agu', 8], ['agt', 8], ['sep', 9], ['sept', 9], ['september', 9],
      ['oct', 10], ['october', 10], ['oktober', 10], ['okt', 10],
      ['nov', 11], ['november', 11], ['dec', 12], ['december', 12], ['desember', 12], ['des', 12],
    ]).get(textMatch[2].toLowerCase());
    if (!monthIndex) return null;
    day = Number(textMatch[1]);
    month = monthIndex;
    year = Number(textMatch[3]);
  }
  const timeMatch = timeValue.trim().match(/^(\d{1,2}):?(\d{2})\s*Z?$/i);
  if (!timeMatch) return null;
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    hour > 23 || minute > 59 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  date.setUTCMinutes(date.getUTCMinutes() + Math.round(minutes));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const hhmm = `${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}`;
  const finalDate = `${String(date.getUTCDate()).padStart(2, '0')} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  return `${hhmm} Z, ${finalDate}`;
}

export default function AeronauticalDriftWorksheet({
  initialLkp = { lat: 0, lng: 0 },
  awaDirFrom = 0,
  awaSpeedKts = 0,
  awaIsValid = false,
  initialState,
  onResults,
  onStateChange,
  className = '',
}: AeronauticalDriftWorksheetProps) {
  const [formData, setFormData] = useState<AeroDriftInput>(() => ({
    caseTitle: '-',
    caseNumber: '0',
    date: '-',
    plannerName: '-',
    searchObject: '-',

    incidentPos: initialLkp,
    incidentTime: '-',

    useAircraftGlide: false,
    aircraftAltMaxFt: 0,
    aircraftAltMinFt: 0,
    aircraftGlideRatio: 0,
    aircraftTASgKts: 0,
    aircraftDescentHeadingDeg: undefined,
    aircraftHeadingReference: 'true',

    useParachute: false,
    parachuteType: 'round-zero-glide',
    parachuteAltMaxFt: 0,
    parachuteTerrainAltFt: 0,
    parachuteGlideRatio: 0,
    parachuteTASgKts: 0,
    parachuteRateOfDescentFtMin: 0,
    parachuteDescentHeadingDeg: undefined,
    parachuteHeadingReference: 'true',
    magneticVariationDeg: undefined,
    magneticVariationDirection: 'E',
    aircraftDeviationDeg: undefined,
    aircraftDeviationDirection: 'E',
    parachuteDeviationDeg: undefined,
    parachuteDeviationDirection: 'E',

    fixErrorXNm: 0,
    safetyFactorFs: 0,

    ...initialState,
    // Angin atas selalu berasal dari worksheet AWA yang hidup, bukan dari initialState.
    awaIsValid,
    awaGlideDirFrom: awaDirFrom,
    awaGlideSpeedKts: awaSpeedKts,
  }));

  const [searchPlanOption, setSearchPlanOption] = useState<'A' | 'B' | 'C' | ''>('');
  const [viewMode, setViewMode] = useState<'dual' | 'aircraft' | 'parachute'>('dual');

  // Keep external AWA in sync, including whether it came from a valid worksheet.
  // (Pola resmi React: menyesuaikan state saat render ketika props berubah — tanpa effect.)
  const [prevAwa, setPrevAwa] = useState({ awaIsValid, awaDirFrom, awaSpeedKts });
  if (
    prevAwa.awaIsValid !== awaIsValid ||
    prevAwa.awaDirFrom !== awaDirFrom ||
    prevAwa.awaSpeedKts !== awaSpeedKts
  ) {
    setPrevAwa({ awaIsValid, awaDirFrom, awaSpeedKts });
    setFormData((prev) => ({
      ...prev,
      awaIsValid,
      awaGlideDirFrom: awaDirFrom,
      awaGlideSpeedKts: awaSpeedKts,
    }));
  }

  const results: AeroDriftResult = useMemo(() => {
    return calculateAeroDrift(formData);
  }, [formData]);

  useEffect(() => {
    if (!onResults) return;
    onResults(results);
  }, [results, onResults]);

  const updateField = <K extends keyof AeroDriftInput>(key: K, value: AeroDriftInput[K]) => {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      onStateChange?.(next);
      return next;
    });
  };

  /** Pilih jenis parasut dari Table N-13 → isi ROD (kolom sesuai altitude pembukaan, tanpa interpolasi) + glide ratio. */
  const applyN13Type = (id?: string) => {
    setFormData((prev) => {
      if (!id) {
        const cleared = { ...prev, parachuteN13TypeId: undefined, parachuteN13Column: undefined };
        onStateChange?.(cleared);
        return cleared;
      }
      const sel = n13RateOfDescent(id, prev.parachuteAltMaxFt);
      const row = sel.row;
      if (!row) return prev;
      const next: AeroDriftInput = {
        ...prev,
        parachuteN13TypeId: id,
        parachuteN13Column: sel.column ?? 'manual',
        parachuteRateOfDescentFtMin: sel.rodFtMin ?? prev.parachuteRateOfDescentFtMin,
      };
      if (prev.parachuteType === 'steerable' && row.glideRatio > 0) {
        next.parachuteGlideRatio = row.glideRatio;
      }
      onStateChange?.(next);
      return next;
    });
  };

  const n13Row = formData.parachuteN13TypeId ? getN13Parachute(formData.parachuteN13TypeId) : null;
  const n13Provenance = !n13Row
    ? 'N-13: pilih jenis parasut di atas'
    : `N-13: ${n13Row.label.length > 30 ? `${n13Row.label.slice(0, 30)}…` : n13Row.label} — ${
        formData.parachuteN13Column === '7000ft'
          ? `kolom 7.000 ft: ${n13Row.rod7000FtMin}`
          : formData.parachuteN13Column === 'range'
            ? 'rentang 600–900 ft/min → tentukan manual'
            : formData.parachuteN13Column === 'manual'
              ? 'diubah manual oleh planner'
              : `kolom sea level: ${n13Row.rodSeaLevelFtMin}`
      }`;

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  const downwindDir = (formData.awaGlideDirFrom + 180) % 360;
  const anySegmentActive = formData.useAircraftGlide || formData.useParachute;

  return (
    <div className={`space-y-4 ${className} text-slate-900 font-sans`}>
      {/* Top Header bar with Print & View mode selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-slate-900 pb-1 text-[11px] font-bold text-slate-700">
        <span className="tracking-wide">Appendix K – Determining datum</span>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded border border-slate-300 p-0.5 bg-slate-100 text-[10px] print:hidden">
            <button
              type="button"
              onClick={() => setViewMode('dual')}
              className={`px-2 py-0.5 rounded font-bold transition-colors ${
                viewMode === 'dual' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Dual (Pesawat & Terjun Payung)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('aircraft')}
              className={`px-2 py-0.5 rounded font-bold transition-colors ${
                viewMode === 'aircraft' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lembar Pesawat (da)
            </button>
            <button
              type="button"
              onClick={() => setViewMode('parachute')}
              className={`px-2 py-0.5 rounded font-bold transition-colors ${
                viewMode === 'parachute' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Lembar Terjun Payung (dp)
            </button>
          </div>
          <span className="font-mono text-slate-900">K-6</span>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1 text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-800 px-2 py-0.5 rounded border border-slate-300 print:hidden transition-colors"
          >
            <Printer className="h-3 w-3" /> Cetak Lembar Ini
          </button>
        </div>
      </div>

      {/* Authentic Form Container (Identical to Aeronautical_Drift_Ws.pdf) */}
      <div className="border-2 border-slate-900 rounded bg-white shadow-xs p-5 sm:p-7 space-y-4 text-xs font-sans">
        {/* Document Title */}
        <div className="pb-1">
          <h1 className="text-xl sm:text-2xl font-serif font-black tracking-tight text-slate-950">
            Aeronautical drift worksheet
          </h1>
        </div>

        {/* Metadata Header Block with dotted underline inputs */}
        <div className="space-y-2.5 text-xs text-slate-800 pb-2">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div className="sm:col-span-6 flex items-center gap-2">
              <span className="font-medium text-slate-700 shrink-0">Case title</span>
              <input
                type="text"
                value={formData.caseTitle}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => updateField('caseTitle', e.target.value)}
                className="w-full font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent px-1 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-3 flex items-center gap-2">
              <span className="font-medium text-slate-700 shrink-0">Case number</span>
              <input
                type="text"
                value={formData.caseNumber}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => updateField('caseNumber', e.target.value)}
                className="w-full font-bold text-blue-900 font-mono border-b border-dotted border-slate-700 bg-transparent px-1 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-3 flex items-center gap-2">
              <span className="font-medium text-slate-700 shrink-0">Date (UTC)</span>
              <input
                type="text"
                value={formData.date}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => updateField('date', e.target.value)}
                className="w-full font-bold text-blue-900 font-mono border-b border-dotted border-slate-700 bg-transparent px-1 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div className="sm:col-span-6 flex items-center gap-2">
              <span className="font-medium text-slate-700 shrink-0">Planner’s name</span>
              <input
                type="text"
                value={formData.plannerName}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => updateField('plannerName', e.target.value)}
                className="w-full font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent px-1 focus:outline-none"
              />
            </div>
            <div className="sm:col-span-3 flex items-center gap-2">
              <span className="font-medium text-slate-700 shrink-0">Datum number</span>
              <input
                type="text"
                defaultValue="0"
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                className="w-full font-bold text-blue-900 font-mono border-b border-dotted border-slate-700 bg-transparent px-1 focus:outline-none text-center"
              />
            </div>
            <div className="sm:col-span-3 flex items-center gap-2">
              <span className="font-medium text-slate-700 shrink-0">Search plan</span>
              <div className="flex items-center gap-1.5">
                {(['A', 'B', 'C'] as const).map((plan) => (
                  <button
                    key={plan}
                    type="button"
                    onClick={() => setSearchPlanOption(plan)}
                    className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                      searchPlanOption === plan
                        ? 'border border-slate-900 bg-blue-100 text-blue-900 ring-1 ring-blue-600'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {plan}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-500 italic shrink-0">(Circle one)</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-700 shrink-0">Search object</span>
            <input
              type="text"
              value={formData.searchObject}
              suppressHydrationWarning
              spellCheck={false}
              data-ms-editor="true"
              onChange={(e) => updateField('searchObject', e.target.value)}
              className="w-full font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent px-1 focus:outline-none"
            />
          </div>
        </div>

        {/* SECTION A: Estimated incident/bailout position */}
        <div className="space-y-2 pt-2">
          <div className="font-bold text-sm text-slate-950 flex items-center gap-2">
            <span className="font-serif text-base">A</span>
            <span>Estimated incident/bailout position</span>
          </div>

          <div className="space-y-1.5 pl-6 text-xs text-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-4 font-bold text-slate-900">1</span>
              <span className="w-36 text-slate-700">Date/time (UTC)</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={formData.incidentTime}
                  suppressHydrationWarning
                  spellCheck={false}
                  data-ms-editor="true"
                  onChange={(e) => updateField('incidentTime', e.target.value)}
                  className="font-bold text-blue-900 font-mono border-b border-dotted border-slate-700 bg-transparent px-2 w-28 text-center focus:outline-none"
                />
                <span className="font-bold text-slate-900">Z</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="w-4 font-bold text-slate-900">2</span>
              <span className="w-36 text-slate-700">Latitude, longitude</span>
              <div className="flex flex-wrap items-center gap-2 font-mono">
                <CoordinateInput axis="lat" value={formData.incidentPos.lat} onChange={(lat) => updateField('incidentPos', { ...formData.incidentPos, lat })} aria-label="Incident latitude" className="w-40 bg-transparent text-center font-mono font-bold text-blue-900 border-b border-dotted border-slate-700 px-1 focus:outline-none" />
                <CoordinateInput axis="lng" value={formData.incidentPos.lng} onChange={(lng) => updateField('incidentPos', { ...formData.incidentPos, lng })} aria-label="Incident longitude" className="w-44 bg-transparent text-center font-mono font-bold text-blue-900 border-b border-dotted border-slate-700 px-1 focus:outline-none" />
              </div>
            </div>
          </div>
        </div>

        {/* SECTION B: Aircraft/parachute glide displacement (da/p) */}
        <div className="space-y-2 pt-2">
          <div className="font-bold text-sm text-slate-950 flex items-center gap-2">
            <span className="font-serif text-base">B</span>
            <span>Aircraft/parachute glide displacement (da/p)</span>
          </div>
          <p className="text-[11px] text-slate-600 italic pl-6">
            (For both aircraft and parachute glide, use this part twice; once for the aircraft glide and again for the parachute glide. For parachutes with zero glide ratios, go to part C below.)
          </p>

          <div className="ml-6 flex flex-wrap items-center gap-4 rounded border border-slate-200 bg-slate-50 p-2 text-[11px]">
            <label className="flex items-center gap-1.5 font-semibold text-sky-900">
              <input type="checkbox" checked={formData.useAircraftGlide} onChange={(event) => updateField('useAircraftGlide', event.target.checked)} />
              Hitung glide pesawat
            </label>
            <label className="flex items-center gap-1.5 font-semibold text-amber-900">
              <input type="checkbox" checked={formData.useParachute} onChange={(event) => updateField('useParachute', event.target.checked)} />
              Hitung bagian parasut
            </label>
            {formData.useParachute && (
              <label className="flex items-center gap-2 text-slate-700">
                Jenis parasut
                <select
                  value={formData.parachuteType}
                  onChange={(event) => updateField('parachuteType', event.target.value as AeroDriftInput['parachuteType'])}
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5"
                >
                  <option value="round-zero-glide">Round / zero glide</option>
                  <option value="steerable">Steerable</option>
                </select>
              </label>
            )}
            {formData.useParachute && (
              <label className="flex items-center gap-2 text-slate-700">
                Table N-13
                <select
                  aria-label="Jenis parasut Table N-13"
                  value={formData.parachuteN13TypeId ?? ''}
                  onChange={(event) => applyN13Type(event.target.value || undefined)}
                  className="max-w-56 rounded border border-slate-300 bg-white px-1.5 py-0.5"
                >
                  <option value="">(input manual / tanpa N-13)</option>
                  {N13_PARACHUTES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {anySegmentActive && results.validationErrors.length > 0 && (
            <div role="status" className="ml-6 space-y-1 rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-950">
              <div className="font-bold">Hasil koordinat belum dapat ditetapkan:</div>
              {results.validationErrors.map((error) => <div key={error}>• {error}</div>)}
              {!formatUtcEnd(formData.date, formData.incidentTime, 0) && (
                <div>• B.13: isi tanggal yang valid dan waktu UTC/Z (HHMM atau HH:MM) untuk waktu akhir.</div>
              )}
            </div>
          )}

          {/* Lines 1 through 14 (Exact Replica of K-6 Form with dual or single column) */}
          <div className="space-y-2 pl-6 pt-1 text-xs">
            {/* Header when dual mode is active */}
            {viewMode === 'dual' && (
              <div className="flex items-center justify-between pb-1 border-b border-slate-300 text-[11px] font-bold text-slate-700">
                <span className="w-1/2">Parameter / Deskripsi</span>
                <div className="w-1/2 flex items-center justify-end gap-6 text-center">
                  <span className="w-36 text-sky-900 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                    Aircraft Glide (da)
                  </span>
                  <span className="w-36 text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                    Parachute Glide (dp)
                  </span>
                </div>
              </div>
            )}

            {/* Line 1: Incident or bailout/opening altitude (Altmax) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">1</span>
                <span className="text-slate-800">
                  Incident or bailout/opening altitude as appropriate (Altmax)
                </span>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <input
                      type="number"
                      step="500"
                      value={formData.aircraftAltMaxFt}
                      suppressHydrationWarning
                      spellCheck={false}
                      data-ms-editor="true"
                      onChange={(e) => updateField('aircraftAltMaxFt', Number(e.target.value) || 0)}
                      className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none"
                    />
                    <span className="text-slate-600 font-sans text-xs">ft</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <input
                      type="number"
                      step="500"
                      value={formData.parachuteAltMaxFt}
                      suppressHydrationWarning
                      spellCheck={false}
                      data-ms-editor="true"
                      onChange={(e) => updateField('parachuteAltMaxFt', Number(e.target.value) || 0)}
                      className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none"
                    />
                    <span className="text-slate-600 font-sans text-xs">ft</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 2: Terrain or bailout/opening altitude (Altmin) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">2</span>
                <span className="text-slate-800">
                  Terrain or bailout/opening altitude as appropriate (Altmin)
                </span>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <input
                      type="number"
                      step="500"
                      value={formData.aircraftAltMinFt}
                      suppressHydrationWarning
                      spellCheck={false}
                      data-ms-editor="true"
                      onChange={(e) => updateField('aircraftAltMinFt', Number(e.target.value) || 0)}
                      className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none"
                    />
                    <span className="text-slate-600 font-sans text-xs">ft</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <input
                      type="number"
                      step="100"
                      value={formData.parachuteTerrainAltFt}
                      suppressHydrationWarning
                      spellCheck={false}
                      data-ms-editor="true"
                      onChange={(e) => updateField('parachuteTerrainAltFt', Number(e.target.value) || 0)}
                      className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none"
                    />
                    <span className="text-slate-600 font-sans text-xs">ft</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 3: Altitude loss (Alt loss = Altmax – Altmin) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">3</span>
                <span className="text-slate-800">
                  Altitude loss (Alt loss = Altmax – Altmin)
                </span>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {formatFt(results.aircraftAltLossFt)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">ft</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {formatFt(results.parachuteAltLossFt)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">ft</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 4: Glide ratio (gr = horizontal distance/vertical distance) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">4</span>
                <div>
                  <span className="text-slate-800">
                    Glide ratio (gr = horizontal distance/vertical distance)
                  </span>
                  <div className="text-[10px] text-slate-500 italic">
                    (from flight manual for aircraft or table N-13 for parachutes)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <input
                      type="number"
                      step="0.5"
                      value={formData.aircraftGlideRatio}
                      suppressHydrationWarning
                      spellCheck={false}
                      data-ms-editor="true"
                      onChange={(e) => updateField('aircraftGlideRatio', Number(e.target.value) || 0)}
                      className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none"
                    />
                    <span className="text-slate-400 font-sans text-xs w-4"></span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    {formData.parachuteType === 'steerable' ? (
                      <input type="number" min="0" step="0.1" value={formData.parachuteGlideRatio ?? 0} onChange={(e) => updateField('parachuteGlideRatio', Number(e.target.value) || 0)} className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none" aria-label="Parachute glide ratio" />
                    ) : <span className="w-20 text-right text-slate-500">-</span>}
                    <span className="text-slate-400 font-sans text-xs w-4"></span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 5: Glide true air speed (TASg) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">5</span>
                <span className="text-slate-800">Glide true air speed (TASg)</span>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <input
                      type="number"
                      value={formData.aircraftTASgKts}
                      suppressHydrationWarning
                      spellCheck={false}
                      data-ms-editor="true"
                      onChange={(e) => updateField('aircraftTASgKts', Number(e.target.value) || 0)}
                      className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none"
                    />
                    <span className="text-slate-600 font-sans text-xs">kts</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    {formData.parachuteType === 'steerable' ? (
                      <input type="number" min="0" step="1" value={formData.parachuteTASgKts ?? 0} onChange={(e) => updateField('parachuteTASgKts', Number(e.target.value) || 0)} className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none" aria-label="Parachute glide TAS" />
                    ) : <span className="w-20 text-right text-slate-500">-</span>}
                    <span className="text-slate-600 font-sans text-xs">kts</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 6: Rate of descent (rated) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">6</span>
                <div>
                  <span className="text-slate-800">
                    Rate of descent (rated) ((TASg × 101)/gr for aircraft)
                  </span>
                  <div className="text-[10px] text-slate-500 italic">
                    (aircraft: rumus konstanta 101; parachutes: nilai Table N-13 — pilih jenis di bagian atas, tanpa interpolasi)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {formatFt(results.aircraftRateOfDescentFtMin)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">ft/min</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="w-36">
                    <div className="flex items-center gap-1 font-mono justify-end">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={formData.parachuteRateOfDescentFtMin}
                        onChange={(e) => updateField('parachuteRateOfDescentFtMin', Number(e.target.value) || 0)}
                        className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none"
                        aria-label="Parachute rate of descent from table N-13"
                      />
                      <span className="text-slate-600 font-sans text-xs">ft/min</span>
                    </div>
                    <div className="mt-0.5 text-right text-[9px] leading-tight text-slate-500" title={TABLE_N13_SOURCE}>
                      {n13Provenance}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Line 7: Time of descent (td = Alt Loss/rated) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">7</span>
                <span className="text-slate-800">Time of descent (td = Alt Loss/rated)</span>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {results.aircraftTimeOfDescentMin.toFixed(2)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">min</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {results.parachuteTimeOfDescentMin.toFixed(2)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">min</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 8: Glide distance (dg = (TASg × td)/60) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">8</span>
                <span className="text-slate-800">Glide distance (dg = (TASg × td)/60)</span>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {results.aircraftGlideDistanceNm.toFixed(2)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">NM</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {results.parachuteGlideDistanceNm.toFixed(2)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">NM</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 9: Descent heading (if unknown, leave blank) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">9</span>
                <span className="text-slate-800">Descent heading (if unknown, leave blank)</span>
              </div>
              <div className="flex items-center gap-6">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <HeadingInput
                    label="Aircraft"
                    value={formData.aircraftDescentHeadingDeg}
                    convertedHeading={results.aircraftDescentHeadingTrueDeg}
                    reference={formData.aircraftHeadingReference}
                    variation={formData.magneticVariationDeg}
                    variationDirection={formData.magneticVariationDirection}
                    deviation={formData.aircraftDeviationDeg}
                    deviationDirection={formData.aircraftDeviationDirection}
                    onValueChange={(value) => updateField('aircraftDescentHeadingDeg', value)}
                    onReferenceChange={(value) => updateField('aircraftHeadingReference', value)}
                    onVariationChange={(value) => updateField('magneticVariationDeg', value)}
                    onVariationDirectionChange={(value) => updateField('magneticVariationDirection', value)}
                    onDeviationChange={(value) => updateField('aircraftDeviationDeg', value)}
                    onDeviationDirectionChange={(value) => updateField('aircraftDeviationDirection', value)}
                  />
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  formData.parachuteType === 'steerable' ? (
                    <HeadingInput
                      label="Parachute"
                      value={formData.parachuteDescentHeadingDeg}
                      convertedHeading={results.parachuteDescentHeadingTrueDeg}
                      reference={formData.parachuteHeadingReference}
                      variation={formData.magneticVariationDeg}
                      variationDirection={formData.magneticVariationDirection}
                      deviation={formData.parachuteDeviationDeg}
                      deviationDirection={formData.parachuteDeviationDirection}
                      onValueChange={(value) => updateField('parachuteDescentHeadingDeg', value)}
                      onReferenceChange={(value) => updateField('parachuteHeadingReference', value)}
                      onVariationChange={(value) => updateField('magneticVariationDeg', value)}
                      onVariationDirectionChange={(value) => updateField('magneticVariationDirection', value)}
                      onDeviationChange={(value) => updateField('parachuteDeviationDeg', value)}
                      onDeviationDirectionChange={(value) => updateField('parachuteDeviationDirection', value)}
                    />
                  ) : <div className="w-36 text-right text-slate-500">- (zero glide)</div>
                )}
              </div>
            </div>

            {/* Line 10: Average wind aloft during glide (AWAg) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">10</span>
                <div>
                  <span className="text-slate-800">Average wind aloft during glide (AWAg)</span>
                  <div className="text-[10px] text-slate-500 italic">
                    (attach Average wind aloft worksheet)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6 font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.awaIsValid ? `${formData.awaGlideDirFrom.toString().padStart(3, '0')}°T / ${formData.awaGlideSpeedKts} kts` : '- (AWA belum valid)'}
                    </span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.awaIsValid ? `${formData.awaGlideDirFrom.toString().padStart(3, '0')}°T / ${formData.awaGlideSpeedKts} kts` : '- (AWA belum valid)'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 11: Downwind aircraft/parachute displacement due to average wind aloft */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">11</span>
                <span className="text-slate-800">
                  Downwind aircraft/parachute displacement due to average wind aloft (dd = (td × AWA)/60)
                </span>
              </div>
              <div className="flex items-center gap-6 font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.awaIsValid ? downwindDir.toFixed(0).padStart(3, '0') : '-'}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">°T</span>
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1 ml-1">
                      {formData.awaIsValid ? results.aircraftWindDisplacementNm.toFixed(2) : '-'}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">NM</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.awaIsValid ? downwindDir.toFixed(0).padStart(3, '0') : '-'}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">°T</span>
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1 ml-1">
                      {formData.awaIsValid ? results.parachuteWindDisplacementNm.toFixed(2) : '-'}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">NM</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 12: Aircraft/parachute glide displacement (da = vector sum of dg and dd) */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1 bg-blue-50/30">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">12</span>
                <span className="text-slate-900 font-bold">
                  Aircraft/parachute glide displacement (da = vector sum of dg and dd)
                </span>
              </div>
              <div className="flex items-center gap-6 font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-black text-blue-950 border-b-2 border-slate-900 px-1">
                      {results.positionValid && formData.useAircraftGlide ? results.aircraftGlideDisplacementVector.dir.toFixed(1).padStart(5, '0') : '-'}
                    </span>
                    <span className="text-slate-800 font-sans text-xs">°T</span>
                    <span className="font-black text-blue-950 border-b-2 border-slate-900 px-1 ml-1">
                      {results.positionValid && formData.useAircraftGlide ? results.aircraftGlideDisplacementVector.mag.toFixed(2) : '-'}
                    </span>
                    <span className="text-slate-800 font-sans text-xs">NM</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-black text-blue-950 border-b-2 border-slate-900 px-1">
                      {results.positionValid && formData.useParachute ? results.parachuteDisplacementVector.dir.toFixed(1).padStart(5, '0') : '-'}
                    </span>
                    <span className="text-slate-800 font-sans text-xs">°T</span>
                    <span className="font-black text-blue-950 border-b-2 border-slate-900 px-1 ml-1">
                      {results.positionValid && formData.useParachute ? results.parachuteDisplacementVector.mag.toFixed(2) : '-'}
                    </span>
                    <span className="text-slate-800 font-sans text-xs">NM</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 13: Date/time at end of glide */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">13</span>
                <span className="text-slate-800">
                  Date/time at end of glide (incident date/time + time of descent)
                </span>
                <div className="text-[10px] text-slate-500 italic">
                  (B.8/B.11 memakai td desimal; untuk B.13 td dibulatkan setengah-ke-atas ke menit, suffix Z dipertahankan)
                </div>
              </div>
              <div className="flex items-center gap-6 font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.useAircraftGlide ? formatUtcEnd(formData.date, formData.incidentTime, results.aircraftTimeOfDescentMin) ?? '-' : '-'}
                    </span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.useParachute ? formatUtcEnd(
                        formData.date,
                        formData.incidentTime,
                        (formData.useAircraftGlide ? results.aircraftTimeOfDescentMin : 0) +
                          (formData.useParachute ? results.parachuteTimeOfDescentMin : 0),
                      ) ?? '-' : '-'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 14: Latitude, longitude at end of glide */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-slate-900 py-1.5 bg-sky-50/50">
              <div className="flex items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">14</span>
                <div>
                  <span className="text-slate-950 font-bold">
                    Latitude, longitude at end of glide
                  </span>
                  <div className="text-[10px] text-slate-500 italic max-w-md">
                    (If descent heading is unknown, leave blank and enter the sum of the aircraft and parachute glide distances into the Total probable error of position worksheet at A.5)
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6 font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="text-right w-36">
                    <div className="font-bold text-blue-950 text-[11px]">
                      {results.positionValid && formData.useAircraftGlide ? formatDMS(results.aircraftEndGlidePos.lat, false) : '-'}
                    </div>
                    <div className="font-bold text-blue-950 text-[11px]">
                      {results.positionValid && formData.useAircraftGlide ? formatDMS(results.aircraftEndGlidePos.lng, true) : '-'}
                    </div>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="text-right w-36 bg-emerald-50/80 p-1 rounded border border-emerald-300">
                    <div className="text-[9px] font-bold uppercase text-emerald-800">
                      Hasil geodesik (B.14)
                    </div>
                    <div className="font-black text-emerald-950 text-xs">
                      {results.positionValid ? formatDMS(results.landingPos.lat, false) : '-'}
                    </div>
                    <div className="font-black text-emerald-950 text-xs">
                      {results.positionValid ? formatDMS(results.landingPos.lng, true) : '-'}
                    </div>
                    <div className="text-[9px] text-emerald-800">Pembacaan manual UPS dapat berbeda</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Panduan ADW — asal angka & ketentuan (number provenance) */}
        <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11px]">
          <div className="mb-1 font-bold text-slate-900">Asal angka &amp; ketentuan (Panduan ADW)</div>
          <ul className="list-disc space-y-0.5 pl-4 text-slate-600">
            <li><b>B.1/B.2</b> — Soal Kasus; Altmin jangan di-default 0 bila tidak diketahui; valid: Altmax ≥ Altmin.</li>
            <li><b>B.4</b> — Aircraft: Flight Manual; Parachute: Table N-13 (IAMSAR Vol II, hal. N-20); rasio aircraft tidak boleh disalin ke parasut.</li>
            <li><b>B.5</b> — Glide Speed dari soal/Flight Manual, bukan TAS cruise otomatis.</li>
            <li><b>B.6</b> — Aircraft: (TASg × 101) / gr — konstanta 101 hanya untuk aircraft; Parachute: nilai Table N-13 tanpa interpolasi.</li>
            <li><b>B.7/B.8/B.11</b> — hitung dengan <b>td desimal</b>; hasil B.8 &amp; B.11 dalam NM.</li>
            <li><b>B.9</b> — Magnetic → True: Variation East ditambah, West dikurangi (kebalikan mnemonic T-v-M-d-C); dari Compass, koreksi Deviation dulu (Dev East tambah).</li>
            <li><b>B.10</b> — AWA diambil dari worksheet AWA aplikasi; tidak dihitung ulang dari Wind Forecast dan tidak ditebak.</li>
            <li><b>B.11</b> — arah downwind = AWA − 180°; dd = (td × AWA speed)/60.</li>
            <li><b>B.12</b> — vector sum head-to-tail (geodesik, setara plotting UPS); bukan penjumlahan jarak aritmetika.</li>
            <li><b>B.13</b> — waktu insiden + td; pembulatan setengah-ke-atas (pecahan ≥ 0,5 menit naik); suffix Z dipertahankan; melewati 2400 lanjut tanggal berikutnya.</li>
            <li><b>B.14</b> — koordinat akhir dari hasil geodesik/UPS; bila haluan turun tidak diketahui: kosongkan dan teruskan jumlah glide distance ke worksheet Total probable error of position A.5.</li>
            <li>Parachute glide ratio 0 → Part C (drift angin saja); hasil fase Pesawat &amp; Parasut disimpan terpisah.</li>
          </ul>
          <div className="mt-1 text-[9px] text-slate-400">{TABLE_N13_SOURCE}</div>
        </div>

        {/* Handover & Action Banner */}
        <div className="bg-slate-50 border border-slate-300 rounded p-3 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div>
              <span className="font-bold text-slate-900">{results.positionValid ? 'Posisi akhir hasil hitung geodesik:' : 'Posisi akhir belum tersedia:'}</span>
              <p className="text-slate-600 font-mono text-[11px]">
                {results.positionValid
                  ? `${formatDMS(results.landingPos.lat, false)}, ${formatDMS(results.landingPos.lng, true)} | Pergeseran total ${results.totalDisplacementNm.toFixed(2)} NM pada ${results.totalDisplacementDir.toFixed(1)}°T`
                  : 'Periksa data yang diperlukan; posisi koordinat tidak ditebak dari nilai yang belum tersedia.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={!results.positionValid}
            onClick={() => results.positionValid && onResults?.(results)}
            className="flex items-center gap-1.5 bg-sky-700 hover:bg-sky-800 disabled:bg-slate-300 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-bold px-3 py-1.5 rounded text-xs transition-colors shadow-2xs"
          >
            Terapkan Jadi LKP Operasi <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Running Document Footer (Appendix K-6 Authentic Running Footer) */}
        <div className="pt-3 border-t-2 border-slate-900 flex items-center justify-between text-[11px] font-bold text-slate-800">
          <span className="font-mono">K-6</span>
          <span className="tracking-wide">WORKSHEET AERONAUTICAL DRIFT</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>SAR Planning | Angkatan XXXVIII</span>
          <span>Downloaded by: (dev) Foe &bull; IF961E.indb 6</span>
        </div>
      </div>
    </div>
  );
}
