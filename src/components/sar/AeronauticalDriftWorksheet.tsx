'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Printer, Plane, CheckCircle2, ArrowRight } from 'lucide-react';
import {
  type AeroDriftInput,
  type AeroDriftResult,
  calculateAeroDrift,
} from '@/lib/sar/aeroDriftCalculations';
import { type LatLng } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';

interface AeronauticalDriftWorksheetProps {
  initialLkp?: LatLng;
  awaDirFrom?: number;
  awaSpeedKts?: number;
  onResults?: (results: AeroDriftResult) => void;
  onStateChange?: (state: AeroDriftInput) => void;
  className?: string;
}

function formatFt(val: number): string {
  return Math.round(val)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export default function AeronauticalDriftWorksheet({
  initialLkp = { lat: -6.1, lng: 106.8 },
  awaDirFrom = 45,
  awaSpeedKts = 25,
  onResults,
  onStateChange,
  className = '',
}: AeronauticalDriftWorksheetProps) {
  const [formData, setFormData] = useState<AeroDriftInput>({
    caseTitle: 'Operasi SAR Pesawat Udara',
    caseNumber: 'SAR-AERO-01',
    date: '15 / 11 / 2026',
    plannerName: 'SAR Planner Basarnas',
    searchObject: 'Cessna 172 / Pilot with Parachute',

    incidentPos: initialLkp,
    incidentTime: '10:00',

    useAircraftGlide: true,
    aircraftAltMaxFt: 10000,
    aircraftAltMinFt: 3000,
    aircraftGlideRatio: 9.0, // Standard 9:1 for light aircraft
    aircraftTASgKts: 70,
    aircraftDescentHeadingDeg: 120,

    useParachute: true,
    parachuteType: 'round-zero-glide',
    parachuteAltMaxFt: 3000,
    parachuteTerrainAltFt: 0,
    parachuteGlideRatio: 0,
    parachuteTASgKts: 0,

    awaGlideDirFrom: awaDirFrom,
    awaGlideSpeedKts: awaSpeedKts,

    fixErrorXNm: 2.0,
    safetyFactorFs: 1.6,
  });

  const [searchPlanOption, setSearchPlanOption] = useState<'A' | 'B' | 'C'>('A');
  const [viewMode, setViewMode] = useState<'dual' | 'aircraft' | 'parachute'>('dual');

  // Keep external AWA in sync
  useEffect(() => {
    setFormData((prev) => {
      if (prev.awaGlideDirFrom === awaDirFrom && prev.awaGlideSpeedKts === awaSpeedKts) {
        return prev;
      }
      return {
        ...prev,
        awaGlideDirFrom: awaDirFrom,
        awaGlideSpeedKts: awaSpeedKts,
      };
    });
  }, [awaDirFrom, awaSpeedKts]);

  const results: AeroDriftResult = useMemo(() => {
    return calculateAeroDrift(formData);
  }, [formData]);

  const prevLandingPosRef = useRef<LatLng | null>(null);

  useEffect(() => {
    if (!onResults) return;
    const prev = prevLandingPosRef.current;
    if (
      !prev ||
      Math.abs(prev.lat - results.landingPos.lat) > 1e-6 ||
      Math.abs(prev.lng - results.landingPos.lng) > 1e-6
    ) {
      prevLandingPosRef.current = results.landingPos;
      onResults(results);
    }
  }, [results, onResults]);

  const updateField = <K extends keyof AeroDriftInput>(key: K, value: AeroDriftInput[K]) => {
    setFormData((prev) => {
      const next = { ...prev, [key]: value };
      onStateChange?.(next);
      return next;
    });
  };

  const handlePrint = () => {
    if (typeof window !== 'undefined') window.print();
  };

  const downwindDir = (formData.awaGlideDirFrom + 180) % 360;

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
          <span className="font-mono text-slate-900">K-6 IAMSAR MANUAL VOLUME II</span>
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
              <span className="font-medium text-slate-700 shrink-0">Date</span>
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
                defaultValue="01"
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
              <span className="w-36 text-slate-700">Date/time</span>
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
                <input
                  type="number"
                  step="0.0001"
                  value={formData.incidentPos.lat}
                  suppressHydrationWarning
                  spellCheck={false}
                  data-ms-editor="true"
                  onChange={(e) =>
                    updateField('incidentPos', {
                      ...formData.incidentPos,
                      lat: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent px-1 w-24 text-center focus:outline-none"
                />
                <span className="font-bold text-slate-900">
                  {formData.incidentPos.lat < 0 ? 'S' : 'N'}
                </span>
                <span className="text-[10px] text-slate-500 mr-2">
                  ({formatDMS(formData.incidentPos.lat, false)})
                </span>

                <input
                  type="number"
                  step="0.0001"
                  value={formData.incidentPos.lng}
                  suppressHydrationWarning
                  spellCheck={false}
                  data-ms-editor="true"
                  onChange={(e) =>
                    updateField('incidentPos', {
                      ...formData.incidentPos,
                      lng: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent px-1 w-28 text-center focus:outline-none"
                />
                <span className="font-bold text-slate-900">
                  {formData.incidentPos.lng < 0 ? 'W' : 'E'}
                </span>
                <span className="text-[10px] text-slate-500">
                  ({formatDMS(formData.incidentPos.lng, true)})
                </span>
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

          {/* Lines 1 through 14 (Exact Replica of K-6 Form with dual or single column) */}
          <div className="space-y-2 pl-6 pt-1 text-xs">
            {/* Header when dual mode is active */}
            {viewMode === 'dual' && (
              <div className="flex items-center justify-between pb-1 border-b border-slate-300 text-[11px] font-bold text-slate-700">
                <span className="w-1/2">Parameter / Deskripsi IAMSAR</span>
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
                    <span className="w-20 font-bold text-slate-500 border-b border-dotted border-slate-700 text-right pr-1">
                      0
                    </span>
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
                    <span className="w-20 font-bold text-slate-400 border-b border-dotted border-slate-700 text-right pr-1">
                      0
                    </span>
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
                    (for parachutes, enter value from table N-13)
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
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {formatFt(results.parachuteRateOfDescentFtMin)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">ft/min</span>
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
                    <span className="w-20 font-bold text-slate-400 border-b border-dotted border-slate-700 text-right pr-1">
                      0.00
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
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <input
                      type="number"
                      value={formData.aircraftDescentHeadingDeg ?? 120}
                      suppressHydrationWarning
                      spellCheck={false}
                      data-ms-editor="true"
                      onChange={(e) =>
                        updateField('aircraftDescentHeadingDeg', Number(e.target.value) || 0)
                      }
                      className="w-20 font-bold text-blue-900 border-b border-dotted border-slate-700 bg-transparent text-right pr-1 focus:outline-none"
                    />
                    <span className="text-slate-600 font-sans text-xs">°T</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-slate-400 border-b border-dotted border-slate-700 text-right pr-1">
                      -
                    </span>
                    <span className="text-slate-400 font-sans text-xs">°T</span>
                  </div>
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
                      {formData.awaGlideDirFrom.toString().padStart(3, '0')}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">°T</span>
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1 ml-1">
                      {formData.awaGlideSpeedKts}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">kts</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.awaGlideDirFrom.toString().padStart(3, '0')}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">°T</span>
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1 ml-1">
                      {formData.awaGlideSpeedKts}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">kts</span>
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
                      {downwindDir.toFixed(0).padStart(3, '0')}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">°T</span>
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1 ml-1">
                      {results.aircraftWindDisplacementNm.toFixed(2)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">NM</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {downwindDir.toFixed(0).padStart(3, '0')}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">°T</span>
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1 ml-1">
                      {results.parachuteWindDisplacementNm.toFixed(2)}
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
                      {results.aircraftGlideDisplacementVector.dir.toFixed(0).padStart(3, '0')}
                    </span>
                    <span className="text-slate-800 font-sans text-xs">°T</span>
                    <span className="font-black text-blue-950 border-b-2 border-slate-900 px-1 ml-1">
                      {results.aircraftGlideDisplacementVector.mag.toFixed(2)}
                    </span>
                    <span className="text-slate-800 font-sans text-xs">NM</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-black text-blue-950 border-b-2 border-slate-900 px-1">
                      {results.parachuteDisplacementVector.dir.toFixed(0).padStart(3, '0')}
                    </span>
                    <span className="text-slate-800 font-sans text-xs">°T</span>
                    <span className="font-black text-blue-950 border-b-2 border-slate-900 px-1 ml-1">
                      {results.parachuteDisplacementVector.mag.toFixed(2)}
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
              </div>
              <div className="flex items-center gap-6 font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.incidentTime} + {Math.round(results.aircraftTimeOfDescentMin)}m
                    </span>
                    <span className="text-slate-800 font-sans text-xs font-bold">Z</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 w-36 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.incidentTime} + {Math.round(results.aircraftTimeOfDescentMin + results.parachuteTimeOfDescentMin)}m
                    </span>
                    <span className="text-slate-800 font-sans text-xs font-bold">Z</span>
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
                      {formatDMS(results.aircraftEndGlidePos.lat, false)}
                    </div>
                    <div className="font-bold text-blue-950 text-[11px]">
                      {formatDMS(results.aircraftEndGlidePos.lng, true)}
                    </div>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="text-right w-36 bg-emerald-50/80 p-1 rounded border border-emerald-300">
                    <div className="text-[9px] font-bold uppercase text-emerald-800">
                      Final LKP Pendaratan
                    </div>
                    <div className="font-black text-emerald-950 text-xs">
                      {formatDMS(results.landingPos.lat, false)}
                    </div>
                    <div className="font-black text-emerald-950 text-xs">
                      {formatDMS(results.landingPos.lng, true)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Handover & Action Banner */}
        <div className="bg-slate-50 border border-slate-300 rounded p-3 flex flex-wrap items-center justify-between gap-3 text-xs print:hidden">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <div>
              <span className="font-bold text-slate-900">Titik Akhir Pendaratan (LKP Terjun / Jatuh):</span>
              <p className="text-slate-600 font-mono text-[11px]">
                {formatDMS(results.landingPos.lat, false)}, {formatDMS(results.landingPos.lng, true)} | Pergeseran Total: {results.totalDisplacementNm.toFixed(2)} NM ({results.totalDisplacementDir.toFixed(0)}°T)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onResults?.(results)}
            className="flex items-center gap-1.5 bg-sky-700 hover:bg-sky-800 text-white font-bold px-3 py-1.5 rounded text-xs transition-colors shadow-2xs"
          >
            Terapkan Jadi LKP Operasi <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Running Document Footer (Appendix K-6 Authentic Running Footer) */}
        <div className="pt-3 border-t-2 border-slate-900 flex items-center justify-between text-[11px] font-bold text-slate-800">
          <span className="font-mono">K-6</span>
          <span className="tracking-wide">IAMSAR MANUAL VOLUME II</span>
        </div>
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span>SAR Planning | Angkatan XXXVIII</span>
          <span>Downloaded by: (dev) Foe &bull; IF961E.indb 6</span>
        </div>
      </div>
    </div>
  );
}
