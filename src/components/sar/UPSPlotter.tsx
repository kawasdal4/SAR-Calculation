'use client';

import React, { useMemo, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Map as MapIcon,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Layers,
  Info,
  Navigation,
  Printer,
} from 'lucide-react';
import { type LatLng } from '@/lib/sar/sarCalculations';
import { latLonToUPS } from '@/lib/sar/upsGrid';
import { formatDMS } from '@/lib/sar/coordFormat';

interface UPSPlotterProps {
  title?: string;
  lkp?: LatLng;
  datumLeft?: LatLng;
  datumRight?: LatLng;
  searchAreaCenter?: LatLng;
  searchAreaLength?: number;
  searchAreaWidth?: number;
  searchAreaOrientation?: number;
  aeroIncidentPos?: LatLng;
  aeroEndGlidePos?: LatLng;
  aeroLandingPos?: LatLng;
  width?: number;
  height?: number;
  className?: string;
}

export default function UPSPlotter({
  title = 'Universal Plotting Sheet (UPS Asli Form VP-OS)',
  lkp = { lat: -6.1, lng: 106.8 },
  datumLeft,
  datumRight,
  searchAreaCenter,
  searchAreaLength,
  searchAreaWidth,
  searchAreaOrientation = 0,
  aeroIncidentPos,
  aeroEndGlidePos,
  aeroLandingPos,
  className = '',
}: UPSPlotterProps) {
  // Dimensions of template image (universal_plotting_sheet_web.jpg is 2400 x 2618)
  const VB_WIDTH = 2400;
  const VB_HEIGHT = 2618;
  const cx = 1200;
  const cy = 1309;
  const roseRadius = 480; // Radius of central compass rose

  // Center coordinate is midpoint of relevant points
  const centerLat = useMemo(() => {
    if (aeroIncidentPos && aeroLandingPos) {
      return (aeroIncidentPos.lat + aeroLandingPos.lat) / 2;
    }
    if (datumLeft && datumRight) {
      return (lkp.lat + datumLeft.lat + datumRight.lat) / 3;
    }
    return lkp.lat;
  }, [lkp, datumLeft, datumRight, aeroIncidentPos, aeroLandingPos]);

  const centerLon = useMemo(() => {
    if (aeroIncidentPos && aeroLandingPos) {
      return (aeroIncidentPos.lng + aeroLandingPos.lng) / 2;
    }
    if (datumLeft && datumRight) {
      return (lkp.lng + datumLeft.lng + datumRight.lng) / 3;
    }
    return lkp.lng;
  }, [lkp, datumLeft, datumRight, aeroIncidentPos, aeroLandingPos]);

  // Points list
  const points = useMemo(() => {
    const list: {
      id: string;
      label: string;
      desc: string;
      pos: LatLng;
      color: string;
      fill: string;
    }[] = [];

    if (aeroIncidentPos) {
      list.push({
        id: 'aero-inc',
        label: 'Posisi Darurat (Incident)',
        desc: 'Titik awal darurat udara',
        pos: aeroIncidentPos,
        color: '#9333ea',
        fill: '#f3e8ff',
      });
    }
    if (aeroEndGlidePos) {
      list.push({
        id: 'aero-glide',
        label: 'Akhir Glide (End Glide / Bailout)',
        desc: 'Titik pelepasan parasut',
        pos: aeroEndGlidePos,
        color: '#2563eb',
        fill: '#dbeafe',
      });
    }
    if (aeroLandingPos) {
      list.push({
        id: 'aero-land',
        label: 'Posisi Mendarat (LKP SAR)',
        desc: 'Menjadi LKP Operasi Maritim',
        pos: aeroLandingPos,
        color: '#0284c7',
        fill: '#e0f2fe',
      });
    } else {
      list.push({
        id: 'lkp',
        label: 'LKP (Last Known Position)',
        desc: 'Posisi Terakhir Diketahui',
        pos: lkp,
        color: '#0284c7',
        fill: '#e0f2fe',
      });
    }

    if (datumLeft) {
      list.push({
        id: 'dl',
        label: 'Datum L (Kiri)',
        desc: 'Hanyutan Leeway Kiri',
        pos: datumLeft,
        color: '#dc2626',
        fill: '#fee2e2',
      });
    }
    if (datumRight) {
      list.push({
        id: 'dr',
        label: 'Datum R (Kanan)',
        desc: 'Hanyutan Leeway Kanan',
        pos: datumRight,
        color: '#ea580c',
        fill: '#ffedd5',
      });
    }
    if (searchAreaCenter) {
      list.push({
        id: 'sac',
        label: 'Pusat Area Pencarian',
        desc: 'Datum Pusat Search Area',
        pos: searchAreaCenter,
        color: '#16a34a',
        fill: '#dcfce7',
      });
    }
    return list;
  }, [lkp, datumLeft, datumRight, searchAreaCenter, aeroIncidentPos, aeroEndGlidePos, aeroLandingPos]);

  // Max distance in NM
  const maxDistanceNm = useMemo(() => {
    let maxD = 8;
    points.forEach((p) => {
      const { xNm, yNm } = latLonToUPS(p.pos, centerLat, centerLon);
      const d = Math.hypot(xNm, yNm);
      if (d > maxD) maxD = d;
    });
    return Math.ceil(maxD * 1.4);
  }, [points, centerLat, centerLon]);

  const [spanNm, setSpanNm] = useState<number>(() => {
    if (maxDistanceNm <= 10) return 15;
    if (maxDistanceNm <= 25) return 30;
    if (maxDistanceNm <= 50) return 60;
    return 100;
  });

  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showCoordsBadge, setShowCoordsBadge] = useState(true);

  // Conversion: nautical miles to pixel in the 2400x2618 sheet
  const pxPerNm = (roseRadius * 1.8) / spanNm;

  const nmToPixel = (xNm: number, yNm: number) => {
    return {
      x: cx + xNm * pxPerNm,
      y: cy - yNm * pxPerNm,
    };
  };

  const pointPixels = useMemo(() => {
    return points.map((p) => {
      const { xNm, yNm } = latLonToUPS(p.pos, centerLat, centerLon);
      const { x, y } = nmToPixel(xNm, yNm);
      return {
        ...p,
        xNm,
        yNm,
        pixelX: x,
        pixelY: y,
      };
    });
  }, [points, centerLat, centerLon, pxPerNm]);

  // Search Area Box coordinates
  const searchBox = useMemo(() => {
    if (!searchAreaCenter || !searchAreaLength || !searchAreaWidth) return null;
    const { xNm: cX, yNm: cY } = latLonToUPS(searchAreaCenter, centerLat, centerLon);
    const { x: centerPx, y: centerPy } = nmToPixel(cX, cY);

    const halfL = (searchAreaLength / 2) * pxPerNm;
    const halfW = (searchAreaWidth / 2) * pxPerNm;

    return {
      centerPx,
      centerPy,
      halfL,
      halfW,
      angle: searchAreaOrientation,
    };
  }, [searchAreaCenter, searchAreaLength, searchAreaWidth, searchAreaOrientation, centerLat, centerLon, pxPerNm]);

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.min(3, Math.max(0.6, prev + delta)));
  };

  return (
    <Card className={`border-slate-300 shadow-sm bg-white overflow-hidden ${className}`}>
      <CardHeader className="bg-slate-100/90 border-b border-slate-300 py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-slate-900">
              <MapIcon className="h-4 w-4 text-sky-700" /> {title}
            </CardTitle>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Mid-Latitude: {formatDMS(centerLat, false)} | Central Meridian: {formatDMS(centerLon, true)}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Span NM selector */}
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded border border-slate-300 text-xs shadow-2xs">
              <span className="text-slate-600 font-medium">Rentang Skala:</span>
              <select
                value={spanNm}
                onChange={(e) => setSpanNm(Number(e.target.value))}
                className="font-bold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
              >
                <option value={10}>10 NM (Detail)</option>
                <option value={15}>15 NM</option>
                <option value={30}>30 NM</option>
                <option value={60}>60 NM (1 Derajat)</option>
                <option value={100}>100 NM</option>
              </select>
            </div>

            {/* Toggle badges */}
            <button
              type="button"
              onClick={() => setShowCoordsBadge(!showCoordsBadge)}
              className={`p-1.5 rounded border text-xs flex items-center gap-1 transition-colors ${
                showCoordsBadge
                  ? 'bg-sky-600 text-white border-sky-700'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Label Posisi</span>
            </button>

            {/* Zoom Controls */}
            <div className="flex items-center border border-slate-300 rounded bg-white shadow-2xs overflow-hidden">
              <button
                type="button"
                onClick={() => handleZoom(0.25)}
                title="Perbesar"
                className="p-1.5 text-slate-700 hover:bg-slate-100 border-r border-slate-200"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <span className="text-[11px] font-mono px-2 text-slate-600 font-semibold">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => handleZoom(-0.25)}
                title="Perkecil"
                className="p-1.5 text-slate-700 hover:bg-slate-100 border-l border-slate-200"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={resetView}
              title="Reset Tampilan"
              className="p-1.5 text-slate-700 hover:bg-slate-100 border border-slate-300 rounded bg-white shadow-2xs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              title="Cetak UPS Plotter (Print)"
              className="flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium px-2.5 py-1 rounded shadow-2xs transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Cetak</span>
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 flex flex-col xl:flex-row items-center gap-6 justify-center">
        {/* UPS Plotter Canvas Container */}
        <div
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="relative w-full max-w-[620px] aspect-[2400/2618] bg-[#fbf9f4] rounded-xl overflow-hidden border border-slate-400 shadow-inner select-none cursor-grab active:cursor-grabbing flex items-center justify-center"
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
            className="relative w-full h-full"
          >
            {/* Authentic Scanned VP-OS Universal Plotting Sheet */}
            <img
              src="/templates/universal_plotting_sheet_web.jpg"
              alt="Universal Plotting Sheet VP-OS Asli"
              className="w-full h-full object-contain pointer-events-none"
              draggable={false}
            />

            {/* SVG Plotting Overlay */}
            <svg
              viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              <defs>
                <filter id="ups-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="#000000" floodOpacity="0.4" />
                </filter>
                <marker
                  id="ups-arrow-blue"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#2563eb" />
                </marker>
                <marker
                  id="ups-arrow-cyan"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7" />
                </marker>
                <marker
                  id="ups-arrow-red"
                  viewBox="0 0 10 10"
                  refX="6"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#dc2626" />
                </marker>
              </defs>

              {/* Aeronautical Drift Track (Incident -> End Glide -> Landing/LKP) */}
              {aeroIncidentPos && aeroEndGlidePos && (
                (() => {
                  const pInc = pointPixels.find((p) => p.id === 'aero-inc');
                  const pGlide = pointPixels.find((p) => p.id === 'aero-glide');
                  if (!pInc || !pGlide) return null;
                  return (
                    <g key="aero-glide-track" filter="url(#ups-glow)">
                      <line
                        x1={pInc.pixelX}
                        y1={pInc.pixelY}
                        x2={pGlide.pixelX}
                        y2={pGlide.pixelY}
                        stroke="#ffffff"
                        strokeWidth="7"
                      />
                      <line
                        x1={pInc.pixelX}
                        y1={pInc.pixelY}
                        x2={pGlide.pixelX}
                        y2={pGlide.pixelY}
                        stroke="#2563eb"
                        strokeWidth="4"
                        strokeDasharray="8 6"
                        markerEnd="url(#ups-arrow-blue)"
                      />
                    </g>
                  );
                })()
              )}

              {aeroEndGlidePos && (aeroLandingPos || lkp) && (
                (() => {
                  const pGlide = pointPixels.find((p) => p.id === 'aero-glide');
                  const pLand = pointPixels.find((p) => p.id === 'aero-land' || p.id === 'lkp');
                  if (!pGlide || !pLand) return null;
                  return (
                    <g key="aero-parachute-track" filter="url(#ups-glow)">
                      <line
                        x1={pGlide.pixelX}
                        y1={pGlide.pixelY}
                        x2={pLand.pixelX}
                        y2={pLand.pixelY}
                        stroke="#ffffff"
                        strokeWidth="7"
                      />
                      <line
                        x1={pGlide.pixelX}
                        y1={pGlide.pixelY}
                        x2={pLand.pixelX}
                        y2={pLand.pixelY}
                        stroke="#0284c7"
                        strokeWidth="4"
                        strokeDasharray="4 4"
                        markerEnd="url(#ups-arrow-cyan)"
                      />
                    </g>
                  );
                })()
              )}

              {/* Marine Drift Track from LKP to Datum L & Datum R */}
              {datumLeft && (
                (() => {
                  const pLkp = pointPixels.find((p) => p.id === 'aero-land' || p.id === 'lkp');
                  const pDl = pointPixels.find((p) => p.id === 'dl');
                  if (!pLkp || !pDl) return null;
                  return (
                    <g key="lkp-datum-l-track" filter="url(#ups-glow)">
                      <line
                        x1={pLkp.pixelX}
                        y1={pLkp.pixelY}
                        x2={pDl.pixelX}
                        y2={pDl.pixelY}
                        stroke="#ffffff"
                        strokeWidth="6"
                      />
                      <line
                        x1={pLkp.pixelX}
                        y1={pLkp.pixelY}
                        x2={pDl.pixelX}
                        y2={pDl.pixelY}
                        stroke="#dc2626"
                        strokeWidth="3.5"
                        markerEnd="url(#ups-arrow-red)"
                      />
                    </g>
                  );
                })()
              )}

              {datumRight && (
                (() => {
                  const pLkp = pointPixels.find((p) => p.id === 'aero-land' || p.id === 'lkp');
                  const pDr = pointPixels.find((p) => p.id === 'dr');
                  if (!pLkp || !pDr) return null;
                  return (
                    <g key="lkp-datum-r-track" filter="url(#ups-glow)">
                      <line
                        x1={pLkp.pixelX}
                        y1={pLkp.pixelY}
                        x2={pDr.pixelX}
                        y2={pDr.pixelY}
                        stroke="#ffffff"
                        strokeWidth="6"
                      />
                      <line
                        x1={pLkp.pixelX}
                        y1={pLkp.pixelY}
                        x2={pDr.pixelX}
                        y2={pDr.pixelY}
                        stroke="#ea580c"
                        strokeWidth="3.5"
                        markerEnd="url(#ups-arrow-red)"
                      />
                    </g>
                  );
                })()
              )}

              {/* Search Area Box on UPS */}
              {searchBox && (
                <g
                  transform={`rotate(${searchBox.angle}, ${searchBox.centerPx}, ${searchBox.centerPy})`}
                  filter="url(#ups-glow)"
                >
                  <rect
                    x={searchBox.centerPx - searchBox.halfL}
                    y={searchBox.centerPy - searchBox.halfW}
                    width={searchBox.halfL * 2}
                    height={searchBox.halfW * 2}
                    fill="#10b981"
                    fillOpacity="0.12"
                    stroke="#059669"
                    strokeWidth="4"
                    strokeDasharray="10 6"
                  />
                  <line
                    x1={searchBox.centerPx - searchBox.halfL}
                    y1={searchBox.centerPy}
                    x2={searchBox.centerPx + searchBox.halfL}
                    y2={searchBox.centerPy}
                    stroke="#059669"
                    strokeWidth="2"
                    strokeDasharray="4 4"
                    opacity={0.6}
                  />
                </g>
              )}

              {/* Plotted Position Pins & Labels */}
              {pointPixels.map((p) => (
                <g key={`pin-${p.id}`} filter="url(#ups-glow)">
                  {/* Outer circle */}
                  <circle
                    cx={p.pixelX}
                    cy={p.pixelY}
                    r={9}
                    fill={p.color}
                    stroke="#ffffff"
                    strokeWidth="2.5"
                  />
                  <circle cx={p.pixelX} cy={p.pixelY} r={3} fill="#ffffff" />

                  {/* Text Badge */}
                  {showCoordsBadge && (
                    <g transform={`translate(${p.pixelX}, ${p.pixelY - 18})`}>
                      <rect
                        x="-70"
                        y="-22"
                        width="140"
                        height="24"
                        rx="4"
                        fill="#0f172a"
                        fillOpacity="0.9"
                        stroke={p.color}
                        strokeWidth="1.5"
                      />
                      <text
                        x="0"
                        y="-6"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="11"
                        fontWeight="bold"
                      >
                        {p.label}
                      </text>
                    </g>
                  )}
                </g>
              ))}

              {/* Center Crosshair of UPS Sheet */}
              <circle cx={cx} cy={cy} r={6} fill="#dc2626" opacity={0.6} />
              <line x1={cx - 15} y1={cy} x2={cx + 15} y2={cy} stroke="#dc2626" strokeWidth="1.5" />
              <line x1={cx} y1={cy - 15} x2={cx} y2={cy + 15} stroke="#dc2626" strokeWidth="1.5" />
            </svg>
          </div>

          {/* Bottom Overlay Badge on Map */}
          <div className="absolute bottom-2 left-2 bg-slate-900/85 backdrop-blur-xs text-white text-[11px] px-2.5 py-1 rounded border border-slate-700 shadow-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-semibold">Universal Plotting Sheet (VP-OS)</span>
            <span className="text-slate-400 font-mono">Skala Rentang: {spanNm} NM</span>
          </div>
        </div>

        {/* Positions List & Coordinates */}
        <div className="w-full xl:w-80 space-y-4">
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span>Posisi Terplot di UPS</span>
              <span className="text-[10px] font-normal text-slate-500 font-mono">
                {points.length} Titik
              </span>
            </h4>

            <div className="space-y-2">
              {points.map((p) => {
                const pPx = pointPixels.find((item) => item.id === p.id);
                const distNm = pPx ? Math.hypot(pPx.xNm, pPx.yNm) : 0;
                return (
                  <div
                    key={p.id}
                    className="p-2 rounded bg-white border border-slate-200 shadow-2xs text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-full inline-block shrink-0 shadow-xs border border-white"
                        style={{ backgroundColor: p.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-900 truncate">{p.label}</div>
                        <div className="text-[10px] text-slate-500">{p.desc}</div>
                      </div>
                    </div>
                    <div className="mt-1.5 pt-1.5 border-t border-slate-100 flex items-center justify-between font-mono text-[11px] text-slate-700">
                      <span>{formatDMS(p.pos.lat, false)}</span>
                      <span>{formatDMS(p.pos.lng, true)}</span>
                    </div>
                    {distNm > 0 && (
                      <div className="mt-0.5 text-right font-mono text-[10px] text-slate-400">
                        Jarak ke Pusat: {distNm.toFixed(1)} NM
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Instructions */}
          <div className="text-[11px] text-slate-600 leading-relaxed bg-sky-50/70 p-3 rounded-lg border border-sky-200">
            <div className="flex items-center gap-1.5 font-bold text-sky-900 mb-1">
              <Info className="h-3.5 w-3.5 text-sky-700" />
              <span>Petunjuk Template Universal Plotting Sheet:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>Template lembar asli <strong>VP-OS (Universal Plotting Sheet)</strong> standar IAMSAR.</li>
              <li>Hasil Aeronautical Drift (Glide & Parachute) memplot lintasan ke <strong>LKP</strong>.</li>
              <li>Dari LKP, vektor drift laut berlanjut ke <strong>Datum Left</strong> & <strong>Datum Right</strong>.</li>
              <li>Gunakan <strong>drag/geser</strong> untuk menggeser sheet dan <strong>zoom</strong> untuk detail kompas.</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
