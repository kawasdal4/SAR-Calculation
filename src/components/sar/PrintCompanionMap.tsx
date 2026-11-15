'use client';

import React from 'react';
import SeaMapMount from '@/components/sar/SeaMapMount';
import { type LatLng } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import type { MapMarker, MapLine, MapPolygon, MapCircle } from '@/components/sar/SeaMap';

interface PrintCompanionMapProps {
  title?: string;
  worksheetRef?: string;
  lkp: LatLng;
  mapCenter: LatLng;
  markers: MapMarker[];
  lines: MapLine[];
  polygons: MapPolygon[];
  circles: MapCircle[];
  searchAreaLength?: number;
  searchAreaWidth?: number;
  searchAreaOrientation?: number;
  ws1Ao?: number;
  driftDistance?: number;
  E?: number;
}

export default function PrintCompanionMap({
  title = 'LAMPIRAN: PETA OPERASI PENCARIAN & PERTOLONGAN (SAR PLOTTING CHART)',
  worksheetRef = 'WORKSHEET 1 & MARITIME PLANNING',
  lkp,
  mapCenter,
  markers,
  lines,
  polygons,
  circles,
  searchAreaLength,
  searchAreaWidth,
  searchAreaOrientation = 0,
  ws1Ao,
  driftDistance,
  E,
}: PrintCompanionMapProps) {
  return (
    <div className="print-companion-map font-sans text-slate-900 bg-white">
      {/* Official Attachment Header */}
      <div className="border-b-2 border-slate-900 pb-2 mb-3">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-700">
          <span>BADAN NASIONAL PENCARIAN DAN PERTOLONGAN (BASARNAS)</span>
          <span className="font-mono text-slate-900">{worksheetRef}</span>
        </div>
        <h2 className="text-base sm:text-lg font-black uppercase tracking-tight text-slate-950 mt-1">
          {title}
        </h2>
        <div className="text-xs text-slate-600 font-mono flex flex-wrap gap-x-4 gap-y-1 mt-1">
          <span>
            <strong>LKP:</strong> {formatDMS(lkp.lat, false)}, {formatDMS(lkp.lng, true)}
          </span>
          {typeof driftDistance === 'number' && (
            <span>
              <strong>Drift:</strong> {driftDistance.toFixed(2)} NM
            </span>
          )}
          {typeof E === 'number' && (
            <span>
              <strong>Galat E:</strong> {E.toFixed(2)} NM
            </span>
          )}
          {typeof ws1Ao === 'number' && (
            <span>
              <strong>Luas Area (Ao):</strong> {ws1Ao.toFixed(0)} NM²
            </span>
          )}
          {typeof searchAreaLength === 'number' && typeof searchAreaWidth === 'number' && (
            <span>
              <strong>Persegi Area:</strong> {searchAreaLength.toFixed(1)} × {searchAreaWidth.toFixed(1)} NM
            </span>
          )}
          <span>
            <strong>Orientasi Drift:</strong> {searchAreaOrientation.toFixed(0)}°T
          </span>
        </div>
      </div>

      {/* Map Container */}
      <div className="border-2 border-slate-800 rounded overflow-hidden shadow-xs mb-3">
        <SeaMapMount
          center={mapCenter}
          zoom={8}
          markers={markers}
          lines={lines}
          polygons={polygons}
          circles={circles}
          height="620px"
        />
      </div>

      {/* Map Legend & Summary Footer */}
      <div className="p-3 bg-slate-50 border border-slate-300 rounded text-xs grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-700">
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Titik Awal (LKP)</span>
          <span className="font-mono font-semibold text-sky-700">
            {formatDMS(lkp.lat, false)}, {formatDMS(lkp.lng, true)}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Arah & Orientasi Drift</span>
          <span className="font-mono font-semibold text-amber-700">
            {searchAreaOrientation.toFixed(0)}°T (Searah LKP ke Datum)
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Bentuk Area Pencarian</span>
          <span className="font-mono font-semibold text-emerald-700">
            Persegi {searchAreaLength ? `${searchAreaLength.toFixed(1)}×${searchAreaWidth?.toFixed(1)} NM` : '√Ao × √Ao'}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-bold text-slate-500 block">Sistem Koordinat</span>
          <span className="font-mono font-semibold text-slate-800">
            WGS 84 / Mercator Proj.
          </span>
        </div>
      </div>
    </div>
  );
}
