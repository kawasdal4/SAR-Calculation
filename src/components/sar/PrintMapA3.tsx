'use client';

import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Printer, CheckSquare, Square, Layers, X } from 'lucide-react';
import { type LatLng, project, rectangleCorners, bearingDeg } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import SeaMapMount from './SeaMapMount';
import type { MapMarker, MapLine, MapPolygon, MapCircle } from './SeaMap';
import type { DatumData, DatumResults } from './DatumWorksheet';
import type { SearchPlanResults } from './SearchPlanWorksheet';

interface PrintMapA3Props {
  isOpen: boolean;
  onClose: () => void;
  lkp: LatLng;
  datumData: DatumData | null;
  datumResults: DatumResults | null;
  searchResults: SearchPlanResults | null;
  searchPatternSegments?: { from: LatLng; to: LatLng; legIndex: number; distanceNm: number }[];
  csp?: LatLng;
  exitPoint?: LatLng;
  sruBase?: LatLng;
  sruName?: string;
  transitGoLine?: MapLine;
  transitBackLine?: MapLine;
  transitLines?: MapLine[];
  caseTitle?: string;
  caseNumber?: string;
}

export default function PrintMapA3({
  isOpen,
  onClose,
  lkp,
  datumData,
  datumResults,
  searchResults,
  searchPatternSegments,
  csp,
  exitPoint,
  sruBase,
  sruName = 'KN SAR',
  transitGoLine,
  transitBackLine,
  transitLines,
  caseTitle = 'OPERASI PENCARIAN DAN PERTOLONGAN (SAR)',
  caseNumber = 'SAR-INA-2026/01',
}: PrintMapA3Props) {
  // Overlay Selection Checklist
  const [overlays, setOverlays] = useState({
    lkp: true,
    drift: true,
    datum: true,
    errorCircle: true,
    searchArea: true,
    searchPattern: true,
    transit: true,
  });

  const toggleAll = (checked: boolean) => {
    setOverlays({
      lkp: checked,
      drift: checked,
      datum: checked,
      errorCircle: checked,
      searchArea: checked,
      searchPattern: checked,
      transit: checked,
    });
  };

  const isAllChecked = Object.values(overlays).every(Boolean);

  const toggleOverlay = (key: keyof typeof overlays) => {
    setOverlays((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Build Map elements based on selected overlays
  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  const circles: MapCircle[] = [];
  const polygons: MapPolygon[] = [];

  // LKP
  if (overlays.lkp) {
    markers.push({
      position: lkp,
      label: `LKP: ${formatDMS(lkp.lat, false)}, ${formatDMS(lkp.lng, true)}`,
      color: '#0ea5e9',
      isStart: true,
    });
  }

  // Drift Vectors (WS 1) — rantai berurutan head-to-tail dari LKP:
  // Sea Current → Wind Current → Leeway (Kiri/Kanan) → Datum. Vektor TWC
  // sengaja TIDAK digambar (permintaan pengguna); ujungnya tetap dipakai
  // sebagai sambungan rantai (TWC = SC + WC) agar leeway mulai tepat di
  // ujung rantai arus.
  if (overlays.drift && datumData && datumResults) {
    const driftHours = Math.max(0, datumData.driftInterval);
    const seaCurrentEnd = project(lkp, datumData.seaCurrent.dir, datumData.seaCurrent.mag * driftHours);
    const waterEnd = project(lkp, datumData.twc.dir, datumData.twc.mag * driftHours);
    lines.push({
      from: lkp,
      to: seaCurrentEnd,
      color: '#2563eb',
      label: `SC: ${datumData.seaCurrent.dir.toFixed(0)}°T / ${(datumData.seaCurrent.mag * driftHours).toFixed(2)} NM`,
    });
    lines.push({
      from: seaCurrentEnd,
      to: waterEnd,
      color: '#f97316',
      label: `WC: ${datumResults.wc.wcSet.toFixed(0)}°T / ${(datumResults.wc.wcDrift * driftHours).toFixed(2)} NM`,
    });
    lines.push({
      from: waterEnd,
      to: datumResults.datumLeft,
      color: '#16a34a',
      label: `Leeway Kiri: ${datumData.lwLeftDir.toFixed(0)}°T / ${(datumData.lwSpeed * driftHours).toFixed(2)} NM`,
    });
    lines.push({
      from: waterEnd,
      to: datumResults.datumRight,
      color: '#db2777',
      label: `Leeway Kanan: ${datumData.lwRightDir.toFixed(0)}°T / ${(datumData.lwSpeed * driftHours).toFixed(2)} NM`,
    });
    lines.push({
      from: lkp,
      to: datumResults.datumLeft,
      color: '#f59e0b',
      dashed: true,
      label: `Drift Kiri (${datumResults.driftDistance.toFixed(1)} NM)`,
    });
    lines.push({
      from: lkp,
      to: datumResults.datumRight,
      color: '#f59e0b',
      dashed: true,
      label: `Drift Kanan (${datumResults.driftDistance.toFixed(1)} NM)`,
    });
  }

  // Datum Left & Right
  if (datumResults && overlays.datum) {
    markers.push({
      position: datumResults.datumLeft,
      label: `Datum Kiri: ${formatDMS(datumResults.datumLeft.lat, false)}, ${formatDMS(datumResults.datumLeft.lng, true)}`,
      color: '#dc2626',
      isDatum: true,
    });
    markers.push({
      position: datumResults.datumRight,
      label: `Datum Kanan: ${formatDMS(datumResults.datumRight.lat, false)}, ${formatDMS(datumResults.datumRight.lng, true)}`,
      color: '#dc2626',
      isDatum: true,
    });
  }

  // Probable Error Circle (E)
  if (overlays.errorCircle && datumResults) {
    circles.push({
      center: datumResults.datumLeft,
      radiusNm: datumResults.E,
      color: '#dc2626',
      fillColor: '#dc2626',
      fillOpacity: 0.05,
      label: `E = ${datumResults.E.toFixed(1)} NM`,
    });
    circles.push({
      center: datumResults.datumRight,
      radiusNm: datumResults.E,
      color: '#dc2626',
      fillColor: '#dc2626',
      fillOpacity: 0.05,
    });
  }

  // Search Area Box (Persegi dengan kemiringan searah drift dari LKP ke Datum)
  if (overlays.searchArea && (searchResults || datumResults)) {
    const center = searchResults?.searchAreaCenter ?? (datumResults ? {
      lat: (datumResults.datumLeft.lat + datumResults.datumRight.lat) / 2,
      lng: (datumResults.datumLeft.lng + datumResults.datumRight.lng) / 2,
    } : lkp);

    const driftBearing = bearingDeg(lkp, center);
    const sideNm = searchResults?.Ao
      ? Math.sqrt(searchResults.Ao)
      : (datumResults ? Math.sqrt(4 * Math.ceil(datumResults.E * 1.6) * Math.ceil(datumResults.E * 1.6)) : 20);

    const corners = rectangleCorners(center, sideNm, sideNm, driftBearing);
    polygons.push({
      points: corners,
      color: '#16a34a',
      fillColor: '#16a34a',
      fillOpacity: 0.15,
      label: `Search Area (Persegi ${sideNm.toFixed(1)} × ${sideNm.toFixed(1)} NM) - Arah Drift ${driftBearing.toFixed(0)}°T`,
    });
  }

  // Search Pattern Tracks
  if (overlays.searchPattern && searchPatternSegments && searchPatternSegments.length > 0) {
    searchPatternSegments.forEach((seg) => {
      lines.push({
        from: seg.from,
        to: seg.to,
        color: '#10b981',
        label: `Leg ${seg.legIndex}`,
      });
    });
    if (csp) {
      markers.push({
        position: csp,
        label: `CSP: ${formatDMS(csp.lat, false)}, ${formatDMS(csp.lng, true)}`,
        color: '#10b981',
      });
    }
    if (exitPoint) {
      markers.push({
        position: exitPoint,
        label: `Exit Point: ${formatDMS(exitPoint.lat, false)}, ${formatDMS(exitPoint.lng, true)}`,
        color: '#f97316',
      });
    }
  }

  // Transit Go & Back
  if (overlays.transit) {
    if (sruBase) {
      markers.push({
        position: sruBase,
        label: `Pangkalan ${sruName}`,
        color: '#8b5cf6',
      });
    }
    if (transitGoLine) lines.push(transitGoLine);
    if (transitBackLine) lines.push(transitBackLine);
    if (transitLines) lines.push(...transitLines);
  }

  const mapCenter: LatLng = datumResults
    ? {
        lat: (lkp.lat + datumResults.datumLeft.lat + datumResults.datumRight.lat) / 3,
        lng: (lkp.lng + datumResults.datumLeft.lng + datumResults.datumRight.lng) / 3,
      }
    : lkp;

  const handlePrint = () => {
    window.print();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 overflow-y-auto">
      {/* Print-specific style for A3 Landscape */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #print-a3-container,
          #print-a3-container * {
            visibility: visible;
          }
          #print-a3-container {
            position: fixed;
            left: 0;
            top: 0;
            width: 100vw;
            height: 100vh;
            margin: 0;
            padding: 10mm;
            background: white !important;
            z-index: 99999;
          }
          .no-print {
            display: none !important;
          }
          @page {
            size: A3 landscape;
            margin: 8mm;
          }
        }
      `}</style>

      <div
        id="print-a3-container"
        className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-300"
      >
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-4 flex items-center justify-between no-print">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="text-base font-bold">Cetak Peta Operasi SAR Ukuran A3 Landscape</h2>
              <p className="text-xs text-slate-400">
                Peta Laut Mercator dengan Pilihan Overlay Seluruh Worksheet, Pola Pencarian & Rute Transit SRU
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs px-4 py-2 rounded-lg shadow transition-colors"
            >
              <Printer className="h-4 w-4" /> Cetak Sekarang (Print A3)
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Overlay Selector Controls (Interactive bar) */}
        <div className="bg-slate-100 border-b border-slate-300 p-3 no-print">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-800">Pilih Overlay Worksheet:</span>
              <button
                type="button"
                onClick={() => toggleAll(!isAllChecked)}
                className="flex items-center gap-1 font-semibold text-blue-700 hover:underline"
              >
                {isAllChecked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                Pilih Semua Layer
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-slate-700">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overlays.lkp}
                  onChange={() => toggleOverlay('lkp')}
                  className="rounded text-sky-600" suppressHydrationWarning
                />
                LKP
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overlays.drift}
                  onChange={() => toggleOverlay('drift')}
                  className="rounded text-amber-600" suppressHydrationWarning
                />
                Vektor Drift
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overlays.datum}
                  onChange={() => toggleOverlay('datum')}
                  className="rounded text-red-600" suppressHydrationWarning
                />
                Datum L/R
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overlays.errorCircle}
                  onChange={() => toggleOverlay('errorCircle')}
                  className="rounded text-red-600" suppressHydrationWarning
                />
                Radius Galat E
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overlays.searchArea}
                  onChange={() => toggleOverlay('searchArea')}
                  className="rounded text-emerald-600" suppressHydrationWarning
                />
                Kotak Area (WS 1 & 2)
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overlays.searchPattern}
                  onChange={() => toggleOverlay('searchPattern')}
                  className="rounded text-emerald-700" suppressHydrationWarning
                />
                Pola Pencarian (Track)
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overlays.transit}
                  onChange={() => toggleOverlay('transit')}
                  className="rounded text-purple-600" suppressHydrationWarning
                />
                Transit Go & Back
              </label>
            </div>
          </div>
        </div>

        {/* Print Layout Container */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {/* Header Title Block for Map */}
          <div className="border border-slate-400 p-3 bg-white flex flex-wrap items-center justify-between text-xs">
            <div>
              <h1 className="text-sm sm:text-base font-extrabold uppercase text-slate-900">
                {caseTitle}
              </h1>
              <p className="text-[11px] text-slate-600 font-mono mt-0.5">
                Nomor Registrasi Operasi: {caseNumber} | Tanggal Cetak: {new Date().toLocaleDateString('id-ID')}
              </p>
            </div>
            <div className="text-right font-mono text-[11px] text-slate-700">
              <div>LKP: {formatDMS(lkp.lat, false)}, {formatDMS(lkp.lng, true)}</div>
              {datumResults && (
                <div>
                  Datum: {formatDMS(datumResults.datumLeft.lat, false)}, {formatDMS(datumResults.datumLeft.lng, true)} (E={datumResults.E.toFixed(1)} NM)
                </div>
              )}
            </div>
          </div>

          {/* Interactive Map Area for Tile Capture */}
          <div className="border-2 border-slate-800 rounded overflow-hidden">
            <SeaMapMount
              center={mapCenter}
              zoom={8}
              markers={markers}
              lines={lines}
              polygons={polygons}
              circles={circles}
              height="580px"
            />
          </div>

          {/* Map Footer: Legend & Coordinates Summary */}
          <div className="border border-slate-400 p-2.5 bg-slate-50 text-[11px] grid grid-cols-1 sm:grid-cols-4 gap-2 text-slate-700">
            <div>
              <span className="font-bold text-slate-900 block mb-0.5">Legenda Simbol:</span>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" /> LKP
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" /> Datum
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-amber-500 inline-block" /> Drift
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-emerald-600 inline-block" /> Area Pencarian
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-purple-600 inline-block" /> Transit Go
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-orange-500 inline-block" /> Transit Back
                </span>
              </div>
            </div>
            <div>
              <span className="font-bold text-slate-900 block mb-0.5">Parameter Galat (E):</span>
              <span className="font-mono">
                {datumResults ? `${datumResults.E.toFixed(2)} NM` : '—'}
              </span>
            </div>
            <div>
              <span className="font-bold text-slate-900 block mb-0.5">Dimensi Area Pencarian:</span>
              <span className="font-mono">
                {searchResults
                  ? `${searchResults.searchAreaLength.toFixed(1)} × ${searchResults.searchAreaWidth.toFixed(1)} NM`
                  : '—'}
              </span>
            </div>
            <div className="text-right">
              <span className="font-bold text-slate-900 block mb-0.5">Proyeksi Peta:</span>
              <span className="font-mono">WGS-84 / Mercator</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
