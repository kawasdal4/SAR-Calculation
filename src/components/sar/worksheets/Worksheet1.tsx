'use client';

import { printActiveWorksheetFit } from '@/lib/sar/printFit';
import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardCopy, FileSpreadsheet, Printer } from 'lucide-react';
import {
  type LatLng,
  computeWs1SearchArea,
  WS1_FS_OPTIONS,
  WS1_DEFAULT_DRIFT_ERROR_PERCENT,
} from '@/lib/sar/sarCalculations';
import {
  computeDatumWs1,
  type Ws1DatumResult,
  ws1DatumDtgUtc,
} from '@/lib/sar/datumWs1';
import { formatDMS } from '@/lib/sar/coordFormat';
import type { DatumData, DatumResults } from '@/components/sar/DatumWorksheet';

/** Mirror pengukuran peta Worksheet 1 untuk hitungan gambar di sisi halaman. */
export interface Ws1Measured {
  /** Jarak terukur LKP → datum kiri (NM); '' = pakai estimasi analitik. */
  left: string;
  /** Jarak terukur LKP → datum kanan (NM). */
  right: string;
  /** Jarak terukur antara datum kiri dan kanan (NM). */
  leftRight: string;
  /** Persentase drift error (§4.7.61, default 12.5%). */
  driftErrorPercent: number;
}

/** Hasil turunan Worksheet 1 yang dilaporkan ke peta (titik datum, galat, radius). */
export interface Ws1Derived {
  /** Titik ujung rantai: arus laut → arus angin → leeway kiri/kanan. */
  P1: LatLng;
  P2: LatLng;
  L: LatLng;
  R: LatLng;
  /** Datum B = titik tengah garis L–R (midpoint geodesik). */
  datumB: LatLng;
  bearingAB: number;
  distanceAB: number;
  /** Jarak garis lurus LKP→L / LKP→R (d(L), d(R)) dan L–R. */
  dL: number;
  dR: number;
  LR: number;
  /** de(L)/de(R) efektif (memperhitungkan hasil ukur peta bila diisi). */
  deL: number;
  deR: number;
  De: number;
  E: number;
  fs: number;
  /** Search radius R = E × fs dibulatkan ke atas (NM). */
  RUp: number;
  /** Luas lingkaran π × R² (NM²) dan persegi (2R)² (NM²). */
  areaCircleNM2: number;
  areaSquareNM2: number;
  hours: number;
  datumDtg: string | null;
  useWindCurrent: boolean;
  lwClampedToZero: boolean;
  warnings: string[];
  assumptions: string[];
}

interface Worksheet1Props {
  lkp: LatLng;
  datumData: DatumData | null;
  datumResults: DatumResults | null;
  aswDirFrom: number;
  aswSpeed: number;
  /** Waktu distress dari worksheet ASW (format Basarnas, zona UTC) untuk baris @ Time (UTC). */
  aswDistressTime?: string;
  /** Total Hours (D) worksheet ASW — Hours of drift (a) wajib sama dengan nilai ini. */
  aswTotalHours?: number;
  readOnly?: boolean;
  onAoChange?: (ao: number) => void;
  selectedFs?: number;
  onFsChange?: (fs: number) => void;
  /** Mirror pengukuran peta (jarak L/R terukur + persen de) ke halaman agar
   *  hitungan gambar peta di sisi halaman memakai nilai yang sama selagi
   *  tab ini terpasang; null saat unmount. */
  onMeasuredChange?: (measured: Ws1Measured | null) => void;
  /** Buka Appendix I (Table I-1/I-2 leeway) di dialog Manual SAR AUS pada
   *  halaman — rujukan nilai Multiplier/Modifier/Divergence. */
  onOpenManualAppendix?: () => void;
}

/** Format derajat-menit (Panduan bagian 5: posisi datum dalam derajat-menit dan desimal). */
function formatDM(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const m = (abs - d) * 60;
  return `${d}°${m.toFixed(1).padStart(4, '0')}′${hemi}`;
}

export default function Worksheet1({
  lkp,
  datumData,
  datumResults,
  aswDirFrom,
  aswSpeed,
  aswDistressTime,
  aswTotalHours,
  readOnly = false,
  onAoChange,
  onMeasuredChange,
  selectedFs,
  onFsChange,
  onOpenManualAppendix,
}: Worksheet1Props) {
  const [localFs, setLocalFs] = useState(1.1);
  const fsSelected = selectedFs ?? localFs;
  const [driftErrorPercent, setDriftErrorPercent] = useState<number>(WS1_DEFAULT_DRIFT_ERROR_PERCENT);
  const [measuredDistances, setMeasuredDistances] = useState({ left: '', right: '', leftRight: '' });
  const [copied, setCopied] = useState(false);

  // Calculations & parameters with safe defaults.
  // Ketentuan: Hours of drift (a) = Total Hours (D) worksheet ASW; fallback ke
  // drift interval DatumWorksheet bila ASW belum terisi.
  const hours = aswTotalHours && aswTotalHours > 0
    ? aswTotalHours
    : (datumData?.driftInterval ?? 0);
  // Baris @ Time (UTC): distress time dalam format Basarnas zona waktu UTC.
  const distressTimeUtc = aswDistressTime?.trim()
    ? (/^\d{4}\.\d{4}$/.test(aswDistressTime.trim()) ? `${aswDistressTime.trim()} Z` : aswDistressTime.trim())
    : '-';
  const targetDesc = datumResults?.lw?.objectType?.label ?? '-';
  const lkpStr = `${formatDMS(lkp.lat, false)} - ${formatDMS(lkp.lng, true)}`;

  // Sea Current (SC) — konvensi SET: arah KE mana arus bergerak (°T).
  const scDir = datumData?.seaCurrent.dir ?? 0;
  const scSpeed = datumData?.seaCurrent.mag ?? 0;

  // Surface Wind (ASW) — konvensi meteorologi: arah DARI mana angin bertiup (°T).
  const windDir = aswSpeed > 0 ? aswDirFrom : 0;
  const windSpeed = aswSpeed;

  // Leeway (LW) — Tabel I-1/I-2 dari DatumWorksheet.
  const lwDivAngle = datumResults?.lw?.divergenceAngle ?? 0;
  const lwMult = datumResults?.lw?.objectType?.leewayRate ?? 0;
  const lwMod = datumResults?.lw?.objectType?.leewayModifier ?? 0;
  const useWindCurrent = datumData?.useWindCurrent !== false;

  // ==========================================================================
  // Rantai titik datum Worksheet 1 (Panduan Datum bagian 3 & 9):
  // A → P1 (arus laut) → P2 (arus angin) → L / R (leeway) → datum B (midpoint).
  // ==========================================================================
  const ws1: Ws1DatumResult = useMemo(
    () =>
      computeDatumWs1({
        lkp,
        hours,
        seaCurrentDir: scDir,
        seaCurrentSpeed: scSpeed,
        windFrom: windDir,
        windSpeed,
        leewayRate: lwMult,
        leewayModifier: lwMod,
        leewayDivergenceDeg: lwDivAngle,
        x: datumResults?.X ?? 0,
        y: datumResults?.Y ?? 0,
        dePercent: driftErrorPercent,
        fs: fsSelected > 0 ? fsSelected : undefined,
        searchNumber: 1,
        useWindCurrent,
      }),
    [lkp, hours, scDir, scSpeed, windDir, windSpeed, lwMult, lwMod, lwDivAngle, datumResults?.X, datumResults?.Y, driftErrorPercent, fsSelected, useWindCurrent],
  );

  // Baris @ Time (UTC) & WC/LW tampilan mengikuti hasil DatumWorksheet bila ada
  // (kompatibel dengan sheet lama), selain itu pakai rantai panduan.
  const windRecip = windSpeed > 0 ? (windDir + 180) % 360 : 0;
  const wcSpeed = useWindCurrent
    ? (datumResults?.wc?.wcDrift ?? ws1.wcSpeed)
    : 0;
  const wcDir = datumResults?.wc?.wcSet ?? ws1.wcVector.dir;
  const wcDist = wcSpeed * hours;
  const wcDivergence = datumResults?.wc?.divergence ?? ws1.wcDivergence;
  const wcHemisphere = datumResults?.wc?.hemisphere ?? (ws1.wcDivergence > 0 ? 1 : -1);
  const lwDirL = (windRecip - lwDivAngle + 360) % 360;
  const lwDirR = (windRecip + lwDivAngle) % 360;
  const lwSpeed = datumResults?.lw?.leewaySpeed ?? ws1.lwSpeed;
  const lwDist = lwSpeed * hours;

  // Drift error (Worksheet 1): gunakan hasil ukur peta bila diisi, selain itu
  // estimasi analitik d(L)/d(R)/L–R dari rantai titik datum panduan.
  const numericOverride = (value: string, fallback: number) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback;
  const distL = numericOverride(measuredDistances.left, ws1.dL);
  const distR = numericOverride(measuredDistances.right, ws1.dR);
  const distLR = numericOverride(measuredDistances.leftRight, ws1.LR);
  const deL = distL * driftErrorPercent / 100;
  const deR = distR * driftErrorPercent / 100;
  const De = (deL + deR + distLR) / 2;

  // Fix Error
  const distressCraftX = datumResults?.X ?? 0;
  const searchCraftY = datumResults?.Y ?? 0;

  // Total Errors (E) + Search Area — math diekstraksi ke lib:
  // computeWs1SearchArea = computeE + R = ⌈E × fs⌉ + Ao = 4R² (kompatibilitas
  // Worksheet 2/8/Alokasi Aset). Panduan bagian 3.8: luas lingkaran π × R².
  const fsOptions: readonly number[] = WS1_FS_OPTIONS;
  const { E, E2: E_squared, R: R_round, Ao } = computeWs1SearchArea({
    De,
    X: distressCraftX,
    Y: searchCraftY,
    fs: fsSelected,
  });
  const R_exact = E * fsSelected; // tampilan E × fs sebelum pembulatan
  const areaCircle = Math.PI * R_round * R_round; // Panduan bagian 3.8

  // DTG perkiraan waktu datum = waktu LKP + a jam (§4.7.67: LKP = A, datum = B).
  const datumDtg = useMemo(() => ws1DatumDtgUtc(aswDistressTime, hours), [aswDistressTime, hours]);

  // Peringatan tambahan yang hanya diketahui di level Worksheet 1.
  const extraWarnings = useMemo(() => {
    const list: string[] = [];
    if (hours <= 0) {
      list.push('Hours of drift (a) = 0 — isi Total Hours (D) di worksheet ASW atau Drift Interval di Worksheet Datum.');
    }
    if (useWindCurrent && windSpeed > 0 && wcSpeed === 0) {
      list.push('Arus angin (WC) = 0 — cek worksheet ASW.');
    }
    return list;
  }, [hours, useWindCurrent, windSpeed, wcSpeed]);
  const allWarnings = useMemo(
    () => [...ws1.warnings.filter((w) => !w.startsWith('Jika lingkaran radius')), ...extraWarnings],
    [ws1.warnings, extraWarnings],
  );

  const handlePrint = () => {
    printActiveWorksheetFit();
  };

  // Teks ringkas hasil untuk tombol salin (Panduan bagian 5: tombol salin).
  const resultText = () => {
    const L = (label: string, value: string | number) => `${label}: ${value}`;
    return [
      'WORKSHEET 1 — MARITIME PLANNING (MARINE DATUM)',
      L('Search target', targetDesc),
      L('LKP (A)', `${lkpStr}  (${lkp.lat.toFixed(5)}, ${lkp.lng.toFixed(5)})`),
      L('@ Time (UTC)', distressTimeUtc),
      L('Hours of drift (a)', `${hours} hrs`),
      '',
      L('Arus laut S', `${ws1.seaVector.dist.toFixed(2)} NM / ${ws1.seaVector.dir.toFixed(0)}°T`),
      L('Arus angin Wc', useWindCurrent ? `${ws1.wcVector.dist.toFixed(2)} NM / ${ws1.wcVector.dir.toFixed(0)}°T (${ws1.wcSpeed.toFixed(2)} kn)` : 'diabaikan (§4.7.44)'),
      L('Leeway', `${ws1.lwDist.toFixed(2)} NM (${ws1.lwSpeed.toFixed(3)} kn); kiri ${ws1.lwDirLeft.toFixed(0)}°T, kanan ${ws1.lwDirRight.toFixed(0)}°T`),
      '',
      L('P1 (arus laut)', `${formatDM(ws1.P1.lat, true)} ${formatDM(ws1.P1.lng, false)} (${ws1.P1.lat.toFixed(5)}, ${ws1.P1.lng.toFixed(5)})`),
      L('P2 (arus angin)', `${formatDM(ws1.P2.lat, true)} ${formatDM(ws1.P2.lng, false)} (${ws1.P2.lat.toFixed(5)}, ${ws1.P2.lng.toFixed(5)})`),
      L('Titik L', `${formatDM(ws1.L.lat, true)} ${formatDM(ws1.L.lng, false)} (${ws1.L.lat.toFixed(5)}, ${ws1.L.lng.toFixed(5)})`),
      L('Titik R', `${formatDM(ws1.R.lat, true)} ${formatDM(ws1.R.lng, false)} (${ws1.R.lat.toFixed(5)}, ${ws1.R.lng.toFixed(5)})`),
      L('DATUM B', `${formatDM(ws1.datumB.lat, true)} ${formatDM(ws1.datumB.lng, false)} (${ws1.datumB.lat.toFixed(5)}, ${ws1.datumB.lng.toFixed(5)})`),
      datumDtg ? L('DTG datum (perkiraan)', `${datumDtg}`) : null,
      L('Bearing & jarak A→B', `${ws1.bearingAB.toFixed(1)}°T / ${ws1.distanceAB.toFixed(2)} NM`),
      '',
      L('d(L) / d(R)', `${distL.toFixed(2)} / ${distR.toFixed(2)} NM`),
      L('de(L) / de(R)', `${deL.toFixed(3)} / ${deR.toFixed(3)} NM (de ${driftErrorPercent}%)`),
      L('Jarak L–R', `${distLR.toFixed(2)} NM`),
      L('De', `${De.toFixed(3)} NM`),
      L('x / y', `${distressCraftX.toFixed(1)} / ${searchCraftY.toFixed(1)} NM`),
      L('E', `${E.toFixed(3)} NM`),
      L('fs', `${fsSelected}`),
      L('R (E×fs)', `${R_exact.toFixed(2)} NM`),
      L('R bulat', `${R_round} NM`),
      L('Luas lingkaran', `${areaCircle.toFixed(2)} NM² (π × ${R_round}²)`),
      L('Luas persegi (2R)²', `${Ao.toLocaleString()} NM²`),
      '',
      allWarnings.length ? `PERINGATAN:\n- ${allWarnings.join('\n- ')}` : '',
      `ASUMSI:\n- ${ws1.assumptions.join('\n- ')}`,
    ].filter((line) => line !== null).join('\n');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(resultText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  // Lapor Ao (persegi, kompatibilitas downstream) + mirror pengukuran peta ke
  // halaman: hitungan gambar peta di sisi halaman (ws1Computed) memakai nilai
  // yang sama selagi tab terpasang, dan kembali analitik saat unmount.
  useEffect(() => { onAoChange?.(Ao); }, [Ao, onAoChange]);
  useEffect(() => {
    onMeasuredChange?.({
      left: measuredDistances.left,
      right: measuredDistances.right,
      leftRight: measuredDistances.leftRight,
      driftErrorPercent,
    });
    return () => onMeasuredChange?.(null);
  }, [measuredDistances, driftErrorPercent, onMeasuredChange]);

  return (
    <Card className="border-slate-400 shadow-md bg-white overflow-hidden text-slate-900 print:shadow-none print:border-none">
      {/* Official Sheet Header */}
      <CardHeader className="bg-[#1e293b] text-white py-3 px-4 print:bg-white print:text-black print:border-b-2 print:border-black">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-6 w-6 text-emerald-400 print:hidden" />
            <div>
              <CardTitle className="text-base sm:text-lg font-black tracking-wide font-sans">
                WORKSHEET 1 MARITIME PLANNING (MARINE DATUM)
              </CardTitle>
              <p className="text-xs text-slate-300 font-mono print:text-slate-600">
                Form Diklat Basarnas / Appendix K · Panduan Datum Worksheet 1 (NSM §4.7–4.8)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-white px-3 py-1.5 rounded border border-slate-500 font-medium transition-colors"
            >
              <Printer className="h-3.5 w-3.5" /> Cetak Lembar Ini
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1.5 rounded border border-emerald-500 font-medium transition-colors"
            >
              <ClipboardCopy className="h-3.5 w-3.5" /> {copied ? 'Tersalin!' : 'Salin Hasil'}
            </button>
            <span className="text-xs bg-emerald-600/90 text-white font-bold px-3 py-1 rounded border border-emerald-400">
              R = {R_round} NM
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 sm:p-6 overflow-x-auto">
        {/* Authentic Spreadsheet Form Container */}
        <div className="border-2 border-slate-800 rounded bg-white shadow-2xs font-sans text-xs">
          {/* Main Title Row */}
          <div className="bg-slate-800 text-white font-bold text-center py-2 text-sm tracking-wider uppercase border-b-2 border-slate-800">
            Worksheet 1 Maritime Planning
          </div>

          <table className="w-full border-collapse">
            <tbody>
              {/* SECTION: INCIDENT */}
              <tr className="bg-slate-200 border-t-2 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  INCIDENT
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 w-1/3 border-r border-slate-300">
                  Search target (description)
                </td>
                <td colSpan={3} className="py-2 px-3">
                  <span className="font-bold font-mono text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 inline-block ">
                    {targetDesc}
                  </span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  LKP (lat/long) — titik A
                </td>
                <td colSpan={3} className="py-2 px-3">
                  <span className="font-bold font-mono text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 inline-block ">
                    {lkpStr}
                  </span>
                  <span className="text-[10px] text-slate-500 ml-2 font-mono">
                    ({lkp.lat.toFixed(5)}, {lkp.lng.toFixed(5)})
                  </span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  @ Time (UTC)
                </td>
                <td colSpan={3} className="py-2 px-3">
                  <span className="font-bold font-mono text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 inline-block ">
                    {distressTimeUtc}
                  </span>
                  <span className="text-[10px] text-slate-500 ml-2">Waktu LKP — format Basarnas zona waktu UTC (dari worksheet ASW)</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Hours of drift (a)
                </td>
                <td colSpan={3} className="py-2 px-3">
                  <span className="font-bold font-mono text-blue-900 bg-blue-50/80 px-2.5 py-0.5 rounded border border-blue-200">
                    {hours}
                  </span>{' '}
                  <span className="text-slate-600 font-medium">hrs</span>
                  <span className="text-[10px] text-slate-500 ml-2">
                    = waktu datum − waktu LKP {aswTotalHours && aswTotalHours > 0 ? '(= Total Hours (D) worksheet ASW)' : ''}
                  </span>
                </td>
              </tr>

              {/* SECTION: SEA CURRENT */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  SEA CURRENT
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Sea / tidal <span className="text-[10px] text-slate-500">(arus KE mana bergerak — konvensi SET)</span>
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {scDir.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-2">
                    {scSpeed.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Vektor arus laut S: A → P1
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {ws1.seaVector.dir.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {scSpeed.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots ×</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {hours}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">(a) hrs =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-300 ml-1">
                    {ws1.seaVector.dist.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>

              {/* SECTION: SURFACE WIND and CALCULATION OF WIND CURRENT */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  SURFACE WIND and CALCULATION OF WIND CURRENT
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Surface winds/knots <span className="text-[10px] text-slate-500">(angin DARI mana bertiup — dari ASW)</span>
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {windDir.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-2">
                    {windSpeed.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Reciprocal of Surface Winds/Knots (b)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {windRecip.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-2">
                    {windSpeed.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">knots</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Vektor arus angin Wc: P1 → P2 (use reciprocal bearing and divergence) (Figure I-1)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  {useWindCurrent ? (
                    <>
                      <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                        {hours}
                      </span>{' '}
                      <span className="text-slate-600 font-sans">(a) hours ×</span>{' '}
                      <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                        {wcSpeed.toFixed(2)}
                      </span>{' '}
                      <span className="text-slate-600 font-sans">knots (Fig I-1: 0,036 × ASW {windSpeed.toFixed(1)})</span>{' '}
                      ={' '}
                      <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                        {wcDir.toFixed(0)}
                      </span>{' '}
                      <span className="text-slate-600 font-sans">°(T)</span>{' '}
                      <span className="font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-300 ml-1">
                        {wcDist.toFixed(2)}
                      </span>{' '}
                      <span className="text-slate-600 font-sans">nm</span>
                      <div className="mt-1 text-[10px] text-slate-500">
                        Reciprocal {windRecip.toFixed(0)}°(T) ± divergensi Fig I-1 ({wcDivergence}°
                        {wcDivergence === 0
                          ? ' — dalam pita 10°N–10°S (lintang LKP)'
                          : wcHemisphere > 0
                            ? ' — 30° ke kanan, utara 10°N'
                            : ' — 30° ke kiri, selatan 10°S'}
                        ) = {wcDir.toFixed(0)}°(T)
                      </div>
                    </>
                  ) : (
                    <span className="text-amber-800 bg-amber-50 border border-amber-300 px-2 py-1 rounded font-sans">
                      Arus angin DIABAIKAN (sakelar §4.7.44 di Worksheet Datum) — vektor Wc = 0, P2 = P1.
                    </span>
                  )}
                </td>
              </tr>

              {/* SECTION: TARGET LEEWAY */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  TARGET LEEWAY
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Leeway angles (divergence) (Table I-1 or I.2)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">Reciprocal Surface Wind (b)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {windRecip.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T) ±</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200 ml-1">
                    {lwDivAngle.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Leeway vector: (LW) — P2 → L / P2 → R
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans font-bold">LW (L) -</span>{' '}
                  <span className="font-bold text-red-900 bg-red-50 px-2 py-0.5 rounded border border-red-200 ml-1">
                    {lwDirL.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>{' '}
                  <span className="text-slate-600 font-sans font-bold ml-4">LW ( R ) +</span>{' '}
                  <span className="font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 ml-1">
                    {lwDirR.toFixed(0)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">°(T)</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Leeway speed: (knots) = (Multiplier × Wind Speed) ± Modifier
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">[</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200">
                    {lwMult.toFixed(3)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">Multiplier ×</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200">
                    {windSpeed.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">Wind Speed =</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200">
                    {(lwMult * windSpeed).toFixed(3)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">] ±</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-1.5 py-0.5 rounded border border-blue-200">
                    {lwMod.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">Modifier =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-300">
                    {lwSpeed.toFixed(3)} kts
                  </span>
                  {ws1.lwClampedToZero && (
                    <div className="mt-1 text-[10px] text-amber-800">
                      Peringatan: hasil hitung leeway negatif pada angin lemah — dijadikan 0 (asumsi panduan bagian 10 no. 6).
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-slate-500 font-sans">
                      Multiplier, Modifier &amp; Divergence {lwDivAngle}° dari Table I-1/I-2 (Appendix I — Leeway tables) baris “{targetDesc}” sesuai Search target (description).
                    </span>
                    {onOpenManualAppendix && (
                      <button
                        type="button"
                        onClick={onOpenManualAppendix}
                        className="text-[10px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded px-1.5 py-0.5 transition-colors"
                      >
                        Lihat Table I-1/I-2
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Leeway distance:
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">Leeway speed</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {lwSpeed.toFixed(3)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">× (a)</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {hours}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">hrs =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-300">
                    {lwDist.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>

              {/* SECTION: DRIFT ERROR */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  DRIFT ERROR
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Distance (L/R), ukur di peta atau pakai estimasi
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">L:</span>{' '}
                  <input aria-label="Pengukuran jarak drift kiri dari peta NM" type="number" min="0" step="0.1" value={measuredDistances.left} onChange={(event) => setMeasuredDistances((current) => ({ ...current, left: event.target.value }))} disabled={readOnly} placeholder={ws1.dL.toFixed(1)} className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs" />{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {distL.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm |</span>{' '}
                  <span className="text-slate-600 font-sans ml-2">R:</span>{' '}
                  <input aria-label="Pengukuran jarak drift kanan dari peta NM" type="number" min="0" step="0.1" value={measuredDistances.right} onChange={(event) => setMeasuredDistances((current) => ({ ...current, right: event.target.value }))} disabled={readOnly} placeholder={ws1.dR.toFixed(1)} className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs" />{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {distR.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                  <div className="mt-1 text-[10px] text-slate-500">d(L), d(R) = jarak garis lurus LKP → titik L/R ujung vektor leeway (Panduan §3.6). Kosong = pakai estimasi analitik; isi angka untuk mengganti dengan hasil ukur peta.</div>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">Persentase drift error (de)</td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <input aria-label="Persentase drift error" type="number" min="12.5" max="33" step="0.5" value={driftErrorPercent} onChange={(event) => { const value = Number(event.target.value); setDriftErrorPercent(Math.min(33, Math.max(12.5, Number.isFinite(value) && value > 0 ? value : 12.5))); }} disabled={readOnly} className="w-24 rounded border border-slate-300 bg-white px-2 py-1 text-xs" />{' '}
                  <span className="text-[10px] text-slate-500">% (default 12.5%, rentang 12.5–33 — §4.7.61)</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  de (L) & de ( R ) (Distance × de)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">de (L):</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {deL.toFixed(4)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm |</span>{' '}
                  <span className="text-slate-600 font-sans ml-2">de ( R ):</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {deR.toFixed(4)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Distance L/R & Total Drift Error (De)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="text-slate-600 font-sans">Jarak L/R:</span>{' '}
                  <input aria-label="Pengukuran jarak antara datum kiri dan kanan NM" type="number" min="0" step="0.1" value={measuredDistances.leftRight} onChange={(event) => setMeasuredDistances((current) => ({ ...current, leftRight: event.target.value }))} disabled={readOnly} placeholder={ws1.LR.toFixed(1)} className="w-20 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs" />{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {distLR.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm |</span>{' '}
                  <span className="text-slate-600 font-sans ml-2">De = [de(L) + de(R) + Distance L/R] / 2 =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-300">
                    {De.toFixed(4)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                  <div className="mt-1 text-[10px] text-slate-500">Distance L/R = jarak titik L ke titik R (ujung kedua vektor leeway, Panduan §3.6); estimasi analitik dari rantai titik datum.</div>
                </td>
              </tr>

              {/* SECTION: FIX ERROR */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  FIX ERROR (Tabel J-1/J-2 — diisi di Worksheet Datum)
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Distress craft error (x): Worksheet Datum / Table J
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {distressCraftX.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Search craft error (y): Worksheet Datum / Table J
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {searchCraftY.toFixed(1)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">nm</span>
                </td>
              </tr>

              {/* SECTION: TOTAL ERRORS (E) */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  TOTAL ERRORS (E)
                </td>
              </tr>
              <tr className="border-b-2 border-slate-700 bg-slate-50/50">
                <td className="py-2.5 px-3 font-bold text-slate-800 border-r border-slate-300">
                  Total problem error (E): E = √(De² + x² + y²)
                </td>
                <td colSpan={3} className="py-2.5 px-3 font-mono">
                  <span className="text-slate-600 font-sans">E² =</span>{' '}
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {E_squared.toFixed(4)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans font-bold ml-2">⟹ E =</span>{' '}
                  <span className="font-bold text-emerald-900 bg-emerald-100 text-sm px-3 py-1 rounded border border-emerald-400">
                    {E.toFixed(2)} NM
                  </span>
                </td>
              </tr>

              {/* SECTION: SEARCH AREA */}
              <tr className="bg-slate-200 border-b-2 border-slate-700">
                <td colSpan={4} className="py-1.5 px-3 font-bold text-slate-900 tracking-wide uppercase">
                  SEARCH AREA
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Safety factor (circle) (fs)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <div className="flex flex-wrap items-center gap-2">
                    {fsOptions.map((opt) => (
                      <button
                        type="button"
                        disabled={readOnly}
                        onClick={() => { setLocalFs(opt); onFsChange?.(opt); }}
                        key={opt}
                        aria-pressed={opt === fsSelected}
                        className={`px-2.5 py-0.5 rounded border text-xs disabled:cursor-not-allowed ${
                          opt === fsSelected
                            ? 'bg-blue-600 text-white font-bold border-blue-700 shadow-2xs'
                            : 'bg-slate-100 text-slate-600 border-slate-300'
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                    <span className="text-slate-500 font-sans text-[11px] ml-2">
                      Pencarian ke-{fsOptions.indexOf(fsSelected) + 1}: pertama 1.1, kedua 1.6, ketiga 2.0, keempat 2.3, kelima 2.5 — pilih sesuai skenario soal.
                    </span>
                  </div>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Search radius (E × fs)
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200">
                    {R_exact.toFixed(2)}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">NM</span>
                </td>
              </tr>
              <tr className="border-b border-slate-300">
                <td className="py-2 px-3 font-medium text-slate-700 border-r border-slate-300">
                  Search radius rounded up to whole figure:
                </td>
                <td colSpan={3} className="py-2 px-3 font-mono">
                  <span className="font-bold text-blue-900 bg-blue-50/80 px-2.5 py-0.5 rounded border border-blue-200 text-xs">
                    {R_round}
                  </span>{' '}
                  <span className="text-slate-600 font-sans">NM (Radius R)</span>
                </td>
              </tr>
              <tr className="bg-slate-50/50">
                <td className="py-2.5 px-3 font-bold text-slate-700 border-r border-slate-300">
                  Search Area (Ao = (2R)²) — persegi sisi 2R
                </td>
                <td colSpan={3} className="py-2.5 px-3 font-mono">
                  <span className="text-slate-700 font-sans">(2 × {R_round})² =</span>{' '}
                  <span className="font-bold text-slate-900 bg-slate-100 px-3 py-0.5 rounded border border-slate-400">
                    {Ao.toLocaleString()} NM²
                  </span>
                  <span className="text-slate-600 font-sans text-[11px] ml-3 italic">
                    (Nilai Ao ini diteruskan ke Worksheet 2, 8, dan Alokasi Aset)
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Catatan & asumsi (Panduan bagian 7 & 10) */}
        <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3 print:break-inside-avoid">
          <div className="border border-amber-300 bg-amber-50 rounded p-3">
            <div className="text-[11px] font-bold text-amber-900 uppercase tracking-wide mb-1.5">
              Peringatan (Panduan bagian 7)
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-amber-900">
              {allWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
          <div className="border border-slate-300 bg-slate-50 rounded p-3">
            <div className="text-[11px] font-bold text-slate-700 uppercase tracking-wide mb-1.5">
              Asumsi yang dipakai (audit — Panduan bagian 10)
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
              {ws1.assumptions.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
              <li>Geodesi bola R = 6.371.008,8 m, 1 NM = 1852 m; tiap vektor = langkah destination; datum = midpoint geodesik L–R.</li>
              <li>Perhitungan SAR adalah pedoman perencanaan; SMC berwenang menyesuaikan (§4.7.69).</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
