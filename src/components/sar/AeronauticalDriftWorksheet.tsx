'use client';

import { printActiveWorksheetFit } from '@/lib/sar/printFit';
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
  addMinutesBasarnas,
  describeBasarnasUtcConversion,
  parseDateParts,
  parseSarTimeToHours,
  roundHalfUpToMinute,
  toBasarnasTimeFormat,
  type SarDateParts,
} from '@/lib/sar/aswTime';
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
  /** Waktu distress hasil A.1 + B.7 (menit turun dibulatkan) dalam format Basarnas MMDD.HHMM, untuk worksheet ASW. */
  onDerivedDistressTime?: (basarnasTime: string | null) => void;
  className?: string;
  /** Search plan (A/B/C) bersama satu kasus — sinkron otomatis antar worksheet
   *  AWA/ADW/ASW. Default 'A' (pencarian pertama) sesuai konvensi worksheet. */
  searchPlan?: 'A' | 'B' | 'C';
  /** Laporkan pilihan Search plan ke halaman agar worksheet lain mengikuti. */
  onSearchPlanChange?: (plan: 'A' | 'B' | 'C') => void;
}

/** Data awal yang bisa diterapkan dari luar (mis. AI assistant) tanpa field AWA (dari props). */
export type AeroDriftInitialState = Omit<Partial<AeroDriftInput>, 'awaIsValid' | 'awaGlideDirFrom' | 'awaGlideSpeedKts'>;

function formatFt(val: number): string {
  return Math.round(val)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Angka hasil hitung dengan maksimal 4 desimal — bila koma pendek tampil
 * apa adanya, bila koma panjang dibulatkan ke 4 desimal dan nol di akhir
 * dipangkas: 4797.5 → "4797.5", 8.128999… → "8.129", 25.743333… → "25.7433".
 * Dipakai B.6, B.7, B.8, dan B.10 sesuai panduan worksheet.
 */
function formatNum4(val: number): string {
  if (!Number.isFinite(val)) return '-';
  return val
    .toFixed(4)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
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

/**
 * B.13 — Date/time at end of glide: A.1 (waktu insiden) + B.7 yang SUDAH
 * dibulatkan setengah-ke-atas ke menit utuh (panduan: 8.129 → 8; 8.5 → 9).
 * Hasil tampil selama A.1 bisa diparse DAN bulan/tanggalnya diketahui —
 * bulan/tanggal boleh diambil dari string A.1 itu sendiri (termasuk format
 * Basarnas MMDD.HHMM yang sudah ternormalisasi) atau dari field tanggal
 * header; tahun bersifat opsional (dicari di field tanggal atau angka 20xx
 * pada string A.1) sehingga B.13 tetap muncul walau field tanggal kosong.
 * Output format Basarnas "MMDD.HHMM Z, DD MMM[ YYYY]"; melewati 2400 lanjut
 * tanggal berikutnya (penggulungan bulan ditangani Date UTC).
 * Diekspor untuk pengujian (tests/adwB13.test.ts).
 */
export function formatUtcEnd(dateValue: string, timeValue: string, roundedMinutes: number): string | null {
  const parsedTime = parseSarTimeToHours(timeValue);
  if (!parsedTime) return null;
  // Fallback tanggal dari field header: format ISO ("2026-11-17") atau
  // "17 Nov 2026" via parseDateParts; tambahan format "17/11/2026"
  // (dd/mm gaya Indonesia) ditangani di sini.
  let dateParts = parseDateParts(dateValue);
  if (!dateParts) {
    const dmy = /^(0?[1-9]|[12]\d|3[01])[\/\-.](0?[1-9]|1[0-2])[\/\-.](\d{4})$/.exec(dateValue.trim());
    if (dmy) {
      dateParts = { year: parseInt(dmy[3], 10), month: parseInt(dmy[2], 10), day: parseInt(dmy[1], 10) };
    }
  }
  const month = parsedTime.month ?? dateParts?.month;
  const day = (parsedTime.hasDay ? parsedTime.day : undefined) ?? dateParts?.day;
  if (!month || !day) return null;
  const yearMatch = /\b(20\d{2})\b/.exec(timeValue);
  const year = dateParts?.year ?? (yearMatch ? parseInt(yearMatch[1], 10) : undefined);
  const minutesOfDay = Math.round((parsedTime.hours % 24) * 60);
  const base = new Date(Date.UTC(year ?? 2000, month - 1, day, 0, minutesOfDay));
  if (
    Number.isNaN(base.getTime()) ||
    base.getUTCMonth() !== month - 1 ||
    base.getUTCDate() !== day
  ) return null;
  base.setUTCMinutes(base.getUTCMinutes() + Math.round(roundedMinutes));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const basarnas = `${String(base.getUTCMonth() + 1).padStart(2, '0')}${String(base.getUTCDate()).padStart(2, '0')}.${String(base.getUTCHours()).padStart(2, '0')}${String(base.getUTCMinutes()).padStart(2, '0')} Z`;
  const human = `${String(base.getUTCDate()).padStart(2, '0')} ${months[base.getUTCMonth()]}${year ? ` ${year}` : ''}`;
  return `${basarnas}, ${human}`;
}

export default function AeronauticalDriftWorksheet({
  initialLkp = { lat: 0, lng: 0 },
  awaDirFrom = 0,
  awaSpeedKts = 0,
  awaIsValid = false,
  initialState,
  onResults,
  onStateChange,
  onDerivedDistressTime,
  className = '',
  searchPlan,
  onSearchPlanChange,
}: AeronauticalDriftWorksheetProps) {
  const [formData, setFormData] = useState<AeroDriftInput>(() => {
  const base: AeroDriftInput = {
    caseTitle: '-',
    caseNumber: '0',
    date: '-',
    plannerName: '-',
    searchObject: '-',

    incidentPos: initialLkp,
    // Format tanggal/waktu apa pun dari soal (mis. "17 Nov 2026 07.00 UTC")
    // dikonversi otomatis ke format Basarnas MMDD.HHMM (aturan workflow SAR);
    // normalisasi diterapkan SETELAH spread initialState di bawah.
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
  };
  // Normalisasi format waktu insiden (setelah spread initialState): format
  // tanggal/waktu apa pun dari soal → Basarnas MMDD.HHMM.
  if (base.incidentTime && base.incidentTime !== '-') {
    base.incidentTime = toBasarnasTimeFormat(base.incidentTime, base.date) ?? base.incidentTime;
  }
  return base;
});

  // Search plan default 'A' (pencarian pertama) — sinkron antar AWA/ADW/ASW.
  const [searchPlanLocal, setSearchPlanLocal] = useState<'A' | 'B' | 'C' | ''>('A');
  const searchPlanActive = searchPlan ?? searchPlanLocal;
  // Default tampilan: Lembar Pesawat (da) — alur kerja worksheet dimulai dari glide pesawat.
  const [viewMode, setViewMode] = useState<'dual' | 'aircraft' | 'parachute'>('aircraft');

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

  // Waktu distress untuk worksheet ASW: A.1 (waktu insiden) + B.7 (menit turun
  // seluruh segmen aktif — pesawat dan/atau parasut — dibulatkan setengah-ke-atas
  // ke menit utuh, aturan sama dengan B.13). Format Basarnas MMDD.HHMM; null
  // bila waktu insiden belum bisa diparse atau tidak ada segmen aktif.
  const derivedDistressTime = useMemo(() => {
    if (!formData.useAircraftGlide && !formData.useParachute) return null;
    const tdSum =
      (formData.useAircraftGlide ? results.aircraftTimeOfDescentMin : 0) +
      (formData.useParachute ? results.parachuteTimeOfDescentMin : 0);
    if (!(tdSum > 0)) return null;
    return addMinutesBasarnas(formData.incidentTime, roundHalfUpToMinute(tdSum), formData.date);
  }, [
    formData.useAircraftGlide,
    formData.useParachute,
    formData.incidentTime,
    formData.date,
    results.aircraftTimeOfDescentMin,
    results.parachuteTimeOfDescentMin,
  ]);

  // Pratinjau langsung konversi zona A.1 → UTC (Z) selagi pengguna mengetik:
  // bila soal masih memakai zona lain (WIB/WITA/WIT, huruf G/H/I, "UTC+9"),
  // konversi otomatis memakai logika tab Penghitungan Dasar. Hanya ditampilkan
  // saat konversi benar-benar terjadi (zona non-UTC terdeteksi).
  const a1UtcInfo = useMemo(
    () => describeBasarnasUtcConversion(formData.incidentTime, formData.date),
    [formData.incidentTime, formData.date],
  );

  useEffect(() => {
    onDerivedDistressTime?.(derivedDistressTime);
  }, [derivedDistressTime, onDerivedDistressTime]);

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
    if (typeof window !== 'undefined') printActiveWorksheetFit();
  };

  const downwindDir = (formData.awaGlideDirFrom + 180) % 360;
  const anySegmentActive = formData.useAircraftGlide || formData.useParachute;
  // B.10 — arah & kecepatan AWA tampil maksimal 4 desimal; arah bulat tetap
  // bergaya 3 digit pad ("070"), arah pecahan pakai formatNum4 ("329.1812").
  const awaDirLabel = Number.isInteger(formData.awaGlideDirFrom)
    ? formData.awaGlideDirFrom.toString().padStart(3, '0')
    : formatNum4(formData.awaGlideDirFrom);

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
                    onClick={() => { setSearchPlanLocal(plan); onSearchPlanChange?.(plan); }}
                    title={`Search plan ${plan} — pilihan ini disinkronkan ke worksheet AWA & ASW`}
                    className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center transition-all ${
                      searchPlanActive === plan
                        ? 'border border-slate-900 bg-blue-100 text-blue-900 ring-1 ring-blue-600'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {plan}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-500 italic shrink-0">(Circle one — tersinkron AWA/ASW/ADW)</span>
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
              <div className="w-36 text-slate-700">
                Date/time (UTC)
                <div className="text-[9px] text-slate-500 italic">
                  format &amp; zona apa pun → Basarnas MMDD.HHMM Z (UTC)
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={formData.incidentTime}
                  suppressHydrationWarning
                  spellCheck={false}
                  data-ms-editor="true"
                  onChange={(e) => updateField('incidentTime', e.target.value)}
                  onBlur={() => {
                    setFormData((prev) => {
                      const norm = toBasarnasTimeFormat(prev.incidentTime, prev.date);
                      return norm && norm !== prev.incidentTime ? { ...prev, incidentTime: norm } : prev;
                    });
                  }}
                  title="Format bebas, zona apa pun (mis. '17 Nov 2026 15.56 WIT', '17 Nov 2026 07.00 UTC', '171847G NOV 2026'); dikonversi otomatis ke UTC lalu diformat Basarnas MMDD.HHMM (15.56 WIT → 06.56 Z)"
                  className="font-bold text-blue-900 font-mono border-b border-dotted border-slate-700 bg-transparent px-2 w-28 text-center focus:outline-none"
                />
                <span className="font-bold text-slate-900">Z</span>
              </div>
            </div>
            {a1UtcInfo?.converted && (
              <div className="pl-6 text-[9px] italic text-emerald-700">
                Konversi otomatis (tab Penghitungan Dasar): {a1UtcInfo.localTimeText}{' '}
                {a1UtcInfo.fromZone} = UTC+
                {a1UtcInfo.offsetHours} → {a1UtcInfo.utcTimeText} Z — disimpan{' '}
                <span className="font-mono font-bold">{a1UtcInfo.value} Z</span>
                {typeof a1UtcInfo.dayShift === 'number' && a1UtcInfo.dayShift !== 0 && (
                  <span>
                    {' '}(tanggal menyesuaikan {a1UtcInfo.dayShift > 0 ? '+' : '-'}
                    {Math.abs(a1UtcInfo.dayShift)} hari)
                  </span>
                )}
              </div>
            )}

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
              <div className="flex items-center justify-between gap-2 pb-1 border-b border-slate-300 text-[11px] font-bold text-slate-700">
                <span className="min-w-0 flex-1">Parameter / Deskripsi</span>
                <div className="flex shrink-0 items-center justify-end gap-6 text-center">
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
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">1</span>
                <span className="text-slate-800">
                  Incident or bailout/opening altitude as appropriate (Altmax)
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap">
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
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">2</span>
                <span className="text-slate-800">
                  Terrain or bailout/opening altitude as appropriate (Altmin)
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap">
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
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">3</span>
                <span className="text-slate-800">
                  Altitude loss (Alt loss = Altmax – Altmin)
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap">
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
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">4</span>
                <div className="min-w-0">
                  <span className="text-slate-800">
                    Glide ratio (gr = horizontal distance/vertical distance)
                  </span>
                  <div className="text-[10px] text-slate-500 italic">
                    (from flight manual for aircraft or table N-13 for parachutes)
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap">
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
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">5</span>
                <span className="text-slate-800">Glide true air speed (TASg)</span>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap">
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
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">6</span>
                <div className="min-w-0">
                  <span className="text-slate-800">
                    Rate of descent (rated) ((TASg × 101)/gr for aircraft)
                  </span>
                  <div className="text-[10px] text-slate-500 italic">
                    (aircraft: rumus konstanta 101; parachutes: nilai Table N-13 — pilih jenis di bagian atas, tanpa interpolasi)
                  </div>
                  {/* Catatan sumber N-13 pindah ke sisi kiri agar kolom nilai kanan tetap satu baris. */}
                  {(viewMode === 'dual' || viewMode === 'parachute') && (
                    <div className="text-[9px] leading-tight text-slate-500" title={TABLE_N13_SOURCE}>
                      {n13Provenance}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {formatNum4(results.aircraftRateOfDescentFtMin)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">ft/min</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
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
                )}
              </div>
            </div>

            {/* Line 7: Time of descent (td = Alt Loss/rated) — hitungan kanan wajib satu baris */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 shrink-0 font-bold text-slate-900">7</span>
                <div className="min-w-0">
                  <span className="text-slate-800">Time of descent (td = Alt Loss/rated)</span>
                  <div className="text-[10px] text-slate-500 italic">
                    (hasil desimal; dibulatkan SETENGAH-KE-ATAS ke menit utuh — nilai bulat dipakai B.13 dan waktu distress worksheet ASW)
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center justify-end gap-1">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 pr-1">
                      {formatNum4(results.aircraftTimeOfDescentMin)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">min</span>
                    {/* Hitungan pembulatan inline — satu baris dengan nilai */}
                    {formData.useAircraftGlide && results.aircraftRateOfDescentFtMin > 0 && (
                      <span className="ml-1 text-[9px] leading-none text-slate-600">
                        ({formatFt(results.aircraftAltLossFt)} ÷ {formatNum4(results.aircraftRateOfDescentFtMin)} → <b>{roundHalfUpToMinute(results.aircraftTimeOfDescentMin)} min</b>)
                      </span>
                    )}
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center justify-end gap-1">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 pr-1">
                      {formatNum4(results.parachuteTimeOfDescentMin)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">min</span>
                    {formData.useParachute && results.parachuteRateOfDescentFtMin > 0 && (
                      <span className="ml-1 text-[9px] leading-none text-slate-600">
                        ({formatFt(results.parachuteAltLossFt)} ÷ {formatNum4(results.parachuteRateOfDescentFtMin)} → <b>{roundHalfUpToMinute(results.parachuteTimeOfDescentMin)} min</b>)
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Line 8: Glide distance (dg = (TASg × td)/60) */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">8</span>
                <span className="text-slate-800">Glide distance (dg = (TASg × td)/60)</span>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {formatNum4(results.aircraftGlideDistanceNm)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">NM</span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 font-mono w-36 justify-end">
                    <span className="w-20 font-bold text-blue-950 border-b border-dotted border-slate-700 text-right pr-1">
                      {formatNum4(results.parachuteGlideDistanceNm)}
                    </span>
                    <span className="text-slate-600 font-sans text-xs">NM</span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 9: Descent heading (if unknown, leave blank) */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 font-bold text-slate-900">9</span>
                <span className="text-slate-800">Descent heading (if unknown, leave blank)</span>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap">
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

            {/* Line 10: Average wind aloft during glide (AWAg) — kanan wajib satu baris */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 shrink-0 font-bold text-slate-900">10</span>
                <div className="min-w-0">
                  <span className="text-slate-800">Average wind aloft during glide (AWAg)</span>
                  <div className="text-[10px] text-slate-500 italic">
                    (attach Average wind aloft worksheet)
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.awaIsValid ? `${awaDirLabel}°T / ${formatNum4(formData.awaGlideSpeedKts)} kts` : '- (AWA belum valid)'}
                    </span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.awaIsValid ? `${awaDirLabel}°T / ${formatNum4(formData.awaGlideSpeedKts)} kts` : '- (AWA belum valid)'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 11: Downwind aircraft/parachute displacement due to average wind aloft — hitungan kanan wajib satu baris */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 shrink-0 font-bold text-slate-900">11</span>
                <span className="min-w-0 text-slate-800">
                  Downwind aircraft/parachute displacement due to average wind aloft (dd = (td × AWA)/60)
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 justify-end">
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
                  <div className="flex items-center gap-1 justify-end">
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

            {/* Line 12: Aircraft/parachute glide displacement (da = vector sum of dg and dd) — hitungan kanan wajib satu baris */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1 bg-blue-50/30">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 shrink-0 font-bold text-slate-900">12</span>
                <span className="min-w-0 text-slate-900 font-bold">
                  Aircraft/parachute glide displacement (da = vector sum of dg and dd)
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 justify-end">
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
                  <div className="flex items-center gap-1 justify-end">
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

            {/* Line 13: Date/time at end of glide — A.1 + B.7 dibulatkan; kanan wajib satu baris */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 shrink-0 font-bold text-slate-900">13</span>
                <span className="min-w-0 text-slate-800">
                  Date/time at end of glide (incident date/time + time of descent)
                </span>
                <div className="min-w-0 text-[10px] text-slate-500 italic">
                  (rumus: A.1 + hasil pembulatan B.7 — td desimal dibulatkan setengah-ke-atas ke menit, suffix Z dipertahankan)
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="flex items-center gap-1 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.useAircraftGlide
                        ? formatUtcEnd(formData.date, formData.incidentTime, roundHalfUpToMinute(results.aircraftTimeOfDescentMin)) ?? '-'
                        : '-'}
                    </span>
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div className="flex items-center gap-1 justify-end">
                    <span className="font-bold text-blue-950 border-b border-dotted border-slate-700 px-1">
                      {formData.useParachute
                        ? formatUtcEnd(
                          formData.date,
                          formData.incidentTime,
                          roundHalfUpToMinute(
                            (formData.useAircraftGlide ? results.aircraftTimeOfDescentMin : 0) +
                              (formData.useParachute ? results.parachuteTimeOfDescentMin : 0),
                          ),
                        ) ?? '-'
                        : '-'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Line 14: Latitude, longitude at end of glide — koordinat kanan wajib satu baris */}
            <div className="flex items-center justify-between gap-2 border-b-2 border-slate-900 py-1.5 bg-sky-50/50">
              <div className="flex min-w-0 flex-1 items-baseline gap-2">
                <span className="w-4 shrink-0 font-bold text-slate-900">14</span>
                <div className="min-w-0">
                  <span className="text-slate-950 font-bold">
                    Latitude, longitude at end of glide
                  </span>
                  <div className="text-[10px] text-slate-500 italic max-w-md">
                    (If descent heading is unknown, leave blank and enter the sum of the aircraft and parachute glide distances into the Total probable error of position worksheet at A.5)
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-6 whitespace-nowrap font-mono">
                {(viewMode === 'dual' || viewMode === 'aircraft') && (
                  <div className="text-right text-[11px] font-bold text-blue-950">
                    {results.positionValid && formData.useAircraftGlide
                      ? `${formatDMS(results.aircraftEndGlidePos.lat, false)}, ${formatDMS(results.aircraftEndGlidePos.lng, true)}`
                      : '-'}
                  </div>
                )}
                {(viewMode === 'dual' || viewMode === 'parachute') && (
                  <div
                    className="rounded border border-emerald-300 bg-emerald-50/80 px-1 py-0.5 text-right text-[11px]"
                    title="Hasil geodesik (B.14) — pembacaan manual UPS dapat berbeda"
                  >
                    <span className="text-[9px] font-bold uppercase text-emerald-800">geodesik:</span>{' '}
                    <span className="font-black text-emerald-950">
                      {results.positionValid
                        ? `${formatDMS(results.landingPos.lat, false)}, ${formatDMS(results.landingPos.lng, true)}`
                        : '-'}
                    </span>
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
            <li><b>B.6</b> — Aircraft: (TASg × 101) / gr — konstanta 101 hanya untuk aircraft; Parachute: nilai Table N-13 tanpa interpolasi. Hasil B.6, B.7, B.8, dan B.10 ditampilkan maksimal 4 desimal (koma panjang dibulatkan ke 4, nol akhir dipangkas).</li>
            <li><b>B.7/B.8/B.11</b> — hitung dengan <b>td desimal</b>; hasil B.8 &amp; B.11 dalam NM.</li>
            <li><b>B.9</b> — Magnetic → True: Variation East ditambah, West dikurangi (kebalikan mnemonic T-v-M-d-C); dari Compass, koreksi Deviation dulu (Dev East tambah).</li>
            <li><b>B.10</b> — AWA diambil dari worksheet AWA aplikasi; tidak dihitung ulang dari Wind Forecast dan tidak ditebak.</li>
            <li><b>B.11</b> — arah downwind = AWA − 180°; dd = (td × AWA speed)/60.</li>
            <li><b>B.12</b> — vector sum head-to-tail (geodesik, setara plotting UPS); bukan penjumlahan jarak aritmetika.</li>
            <li><b>B.13</b> — rumus: A.1 + (hasil pembulatan B.7 setengah-ke-atas); melewati 2400 lanjut tanggal berikutnya; suffix Z dipertahankan. Bulan/tanggal diambil dari A.1 (format apa pun) atau field tanggal; tahun opsional — B.13 tetap tampil walau field tanggal kosong. Ditampilkan format Basarnas MMDD.HHMM Z.</li>
            <li><b>A.1 + B.7 → ASW</b> — waktu distress worksheet ASW diambil otomatis dari A.1 (waktu insiden) + B.7 (menit turun seluruh segmen aktif, dibulatkan setengah-ke-atas), format Basarnas MMDD.HHMM.</li>
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
