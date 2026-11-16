'use client';

import React, { useMemo, useState } from 'react';
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
import { type LatLng, type Vector } from '@/lib/sar/sarCalculations';
import { latLonToUPS } from '@/lib/sar/upsGrid';
import { formatDMS } from '@/lib/sar/coordFormat';
import CoordinateInput from './CoordinateInput';
import { upsDirect, upsInverse } from '@/lib/sar/upsGeodesic';

type UserPlotPoint = { id: string; label: string; desc: string; pos: LatLng; color: string; fill: string; source: string; leg?: { fromId: string; bearingDeg: number; distanceNm: number } };

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
  aeroAircraftGlideVector?: Vector;
  aeroAircraftWindVector?: Vector;
  aeroParachuteGlideVector?: Vector;
  aeroParachuteWindVector?: Vector;
  aeroParachuteResultVector?: Vector;
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
  aeroAircraftGlideVector,
  aeroAircraftWindVector,
  aeroParachuteGlideVector,
  aeroParachuteWindVector,
  aeroParachuteResultVector,
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

  const aeroPlotPositions = useMemo(() => {
    const aircraftGlideTip = aeroIncidentPos && aeroAircraftGlideVector
      ? upsDirect(aeroIncidentPos, aeroAircraftGlideVector.dir, aeroAircraftGlideVector.mag)
      : undefined;
    const aircraftWindTip = aircraftGlideTip && aeroAircraftWindVector
      ? upsDirect(aircraftGlideTip, aeroAircraftWindVector.dir, aeroAircraftWindVector.mag)
      : undefined;
    const parachuteStart = aeroEndGlidePos ?? aeroIncidentPos;
    const parachuteGlideTip = parachuteStart && aeroParachuteGlideVector
      ? upsDirect(parachuteStart, aeroParachuteGlideVector.dir, aeroParachuteGlideVector.mag)
      : undefined;
    const parachuteWindTip = parachuteGlideTip && aeroParachuteWindVector
      ? upsDirect(parachuteGlideTip, aeroParachuteWindVector.dir, aeroParachuteWindVector.mag)
      : undefined;
    const parachuteResult = parachuteStart && aeroParachuteResultVector
      ? upsDirect(parachuteStart, aeroParachuteResultVector.dir, aeroParachuteResultVector.mag)
      : undefined;
    return { aircraftGlideTip, aircraftWindTip, parachuteGlideTip, parachuteWindTip, parachuteResult };
  }, [
    aeroIncidentPos,
    aeroEndGlidePos,
    aeroAircraftGlideVector,
    aeroAircraftWindVector,
    aeroParachuteGlideVector,
    aeroParachuteWindVector,
    aeroParachuteResultVector,
  ]);

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
        label: 'Resultan pesawat (B.12)',
        desc: 'Hasil penjumlahan vektor glide dan drift angin pesawat',
        pos: aeroEndGlidePos,
        color: '#2563eb',
        fill: '#dbeafe',
      });
    }
    if (aeroPlotPositions.aircraftGlideTip && (aeroAircraftGlideVector?.mag ?? 0) > 0) {
      list.push({
        id: 'air-glide-tip',
        label: 'Ujung glide pesawat (B.8)',
        desc: 'Posisi setelah vektor glide sebelum drift angin',
        pos: aeroPlotPositions.aircraftGlideTip,
        color: '#2563eb',
        fill: '#dbeafe',
      });
    }
    if (aeroPlotPositions.aircraftWindTip && (aeroAircraftWindVector?.mag ?? 0) > 0) {
      list.push({
        id: 'air-wind-tip',
        label: 'Ujung drift pesawat (B.11)',
        desc: 'Posisi setelah vektor angin selama glide',
        pos: aeroPlotPositions.aircraftWindTip,
        color: '#f97316',
        fill: '#ffedd5',
      });
    }
    if (aeroPlotPositions.parachuteGlideTip && (aeroParachuteGlideVector?.mag ?? 0) > 0) {
      list.push({
        id: 'para-glide-tip',
        label: 'Ujung glide parasut',
        desc: 'Posisi setelah vektor glide parasut',
        pos: aeroPlotPositions.parachuteGlideTip,
        color: '#7c3aed',
        fill: '#ede9fe',
      });
    }
    if (aeroPlotPositions.parachuteWindTip && (aeroParachuteWindVector?.mag ?? 0) > 0) {
      list.push({
        id: 'para-wind-tip',
        label: 'Ujung drift parasut',
        desc: 'Posisi setelah vektor angin saat turun',
        pos: aeroPlotPositions.parachuteWindTip,
        color: '#0891b2',
        fill: '#cffafe',
      });
    }
    if (aeroPlotPositions.parachuteResult && aeroParachuteResultVector) {
      list.push({
        id: 'para-result',
        label: 'Resultan parasut (B.12)',
        desc: 'Hasil penjumlahan vektor glide dan drift parasut',
        pos: aeroPlotPositions.parachuteResult,
        color: '#0f766e',
        fill: '#ccfbf1',
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
  }, [
    lkp, datumLeft, datumRight, searchAreaCenter, aeroIncidentPos, aeroEndGlidePos,
    aeroLandingPos, aeroPlotPositions, aeroAircraftGlideVector, aeroAircraftWindVector,
    aeroParachuteGlideVector, aeroParachuteWindVector, aeroParachuteResultVector,
  ]);

  const [manualPoints, setManualPoints] = useState<UserPlotPoint[]>([]);
  const [startLat, setStartLat] = useState(lkp.lat);
  const [startLng, setStartLng] = useState(lkp.lng);
  const [bearingInput, setBearingInput] = useState('0');
  const [distanceInput, setDistanceInput] = useState('0');
  const [legFromId, setLegFromId] = useState('');
  const [measureFromId, setMeasureFromId] = useState('');
  const [measureToId, setMeasureToId] = useState('');
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [measureResult, setMeasureResult] = useState<string | null>(null);
  const [plotError, setPlotError] = useState<string | null>(null);
  const displayPoints = useMemo(() => [
    ...points.map((point) => ({ ...point, source: 'Worksheet', leg: undefined as UserPlotPoint['leg'] })),
    ...manualPoints,
  ], [points, manualPoints]);

  // Max distance in NM
  const maxDistanceNm = useMemo(() => {
    let maxD = 8;
    displayPoints.forEach((p) => {
      const { xNm, yNm } = latLonToUPS(p.pos, centerLat, centerLon);
      const d = Math.hypot(xNm, yNm);
      if (d > maxD) maxD = d;
    });
    return Math.ceil(maxD * 1.4);
  }, [displayPoints, centerLat, centerLon]);

  const [spanNm, setSpanNm] = useState<number>(() => {
    if (maxDistanceNm <= 4) return 6;
    if (maxDistanceNm <= 8) return 12;
    if (maxDistanceNm <= 12) return 18;
    if (maxDistanceNm <= 20) return 30;
    return 60;
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
    return displayPoints.map((p) => {
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
  }, [displayPoints, centerLat, centerLon, pxPerNm]);

  const plotStart = () => {
    const point: UserPlotPoint = { id: `ups-${Date.now()}`, label: `Titik ${manualPoints.length + 1}`, desc: 'Titik awal manual', pos: { lat: startLat, lng: startLng }, color: '#b91c1c', fill: '#fee2e2', source: 'Koordinat manual' };
    setManualPoints((current) => [...current, point]); setLegFromId(point.id); setPlotError(null);
  };

  const plotLeg = () => {
    const from = displayPoints.find((point) => point.id === legFromId) ?? manualPoints.at(-1);
    const bearing = Number(bearingInput), distance = Number(distanceInput);
    if (!from || !Number.isFinite(bearing) || bearing < 0 || bearing > 360 || !Number.isFinite(distance) || distance <= 0) { setPlotError('Pilih titik asal, bearing 0–360°T, dan jarak lebih dari 0 NM.'); return; }
    try {
      const pos = upsDirect(from.pos, bearing % 360, distance);
      const point: UserPlotPoint = { id: `ups-${Date.now()}`, label: `Titik ${manualPoints.length + 1}`, desc: `Dari ${from.label} • ${String(Math.round(bearing) % 360).padStart(3, '0')}°T • ${distance} NM`, pos, color: '#0369a1', fill: '#e0f2fe', source: 'Hasil bearing dan jarak WGS-84', leg: { fromId: from.id, bearingDeg: bearing % 360, distanceNm: distance } };
      setManualPoints((current) => [...current, point]); setLegFromId(point.id); setPlotError(null);
    } catch (error) { setPlotError(error instanceof Error ? error.message : 'Gagal menghitung titik tujuan.'); }
  };

  const measurePoints = () => {
    const from = displayPoints.find((point) => point.id === measureFromId), to = displayPoints.find((point) => point.id === measureToId);
    if (!from || !to) { setMeasureResult('Pilih kedua titik.'); return; }
    const result = upsInverse(from.pos, to.pos);
    setMeasureResult(`${String(Math.round(result.bearingDeg) % 360).padStart(3, '0')}°T • ${result.distanceNm.toFixed(2)} NM`);
  };

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
                <option value={60}>60′</option>
                <option value={30}>30′</option>
                <option value={18}>18′</option>
                <option value={12}>12′</option>
                <option value={6}>6′</option>
                <option value={3}>3′</option>
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
          className="relative w-full max-w-[620px] aspect-[2618/2400] bg-white rounded-xl overflow-hidden border border-slate-400 shadow-inner select-none cursor-grab active:cursor-grabbing flex items-center justify-center"
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
            className="relative w-full h-full"
          >
            {/* SVG Plotting Overlay */}
            <svg
              viewBox={`0 0 ${VB_HEIGHT} ${VB_WIDTH}`}
              className="absolute inset-0 w-full h-full pointer-events-none"
              role="img"
              aria-label="Universal Plotting Sheet VP-OS diputar 90 derajat ke kiri"
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
                <marker id="ups-arrow-wind" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#f97316" />
                </marker>
                <marker id="ups-arrow-para" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#7c3aed" />
                </marker>
                <marker id="ups-arrow-result" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0f766e" />
                </marker>
              </defs>

              <g transform={`translate(0, ${VB_WIDTH}) rotate(-90)`}>
                <image
                  href="/templates/universal_plotting_sheet_web.jpg"
                  x="0"
                  y="0"
                  width={VB_WIDTH}
                  height={VB_HEIGHT}
                  preserveAspectRatio="none"
                  style={{ filter: 'invert(1) hue-rotate(180deg)' }}
                />

              {/* ADW components: B.8 glide, B.11 wind drift, B.12 resultants, and final landing. */}
              {aeroIncidentPos && (() => {
                const pInc = pointPixels.find((p) => p.id === 'aero-inc');
                const pAircraftGlide = pointPixels.find((p) => p.id === 'air-glide-tip');
                const pAircraftWind = pointPixels.find((p) => p.id === 'air-wind-tip');
                const pAircraftResult = pointPixels.find((p) => p.id === 'aero-glide');
                const pParachuteStart = pAircraftResult ?? pInc;
                const pParachuteGlide = pointPixels.find((p) => p.id === 'para-glide-tip');
                const pParachuteDriftStart = pParachuteGlide ?? pParachuteStart;
                const pParachuteWind = pointPixels.find((p) => p.id === 'para-wind-tip');
                const pParachuteResult = pointPixels.find((p) => p.id === 'para-result');
                const pFinal = pointPixels.find((p) => p.id === 'aero-land');
                if (!pInc) return null;
                return (
                  <g key="adw-vector-plots" filter="url(#ups-glow)">
                    {pAircraftGlide && (
                      <line x1={pInc.pixelX} y1={pInc.pixelY} x2={pAircraftGlide.pixelX} y2={pAircraftGlide.pixelY} stroke="#2563eb" strokeWidth="4" markerEnd="url(#ups-arrow-blue)" />
                    )}
                    {pAircraftGlide && pAircraftWind && (
                      <line x1={pAircraftGlide.pixelX} y1={pAircraftGlide.pixelY} x2={pAircraftWind.pixelX} y2={pAircraftWind.pixelY} stroke="#f97316" strokeWidth="4" strokeDasharray="8 5" markerEnd="url(#ups-arrow-wind)" />
                    )}
                    {pAircraftResult && (
                      <line x1={pInc.pixelX} y1={pInc.pixelY} x2={pAircraftResult.pixelX} y2={pAircraftResult.pixelY} stroke="#0f766e" strokeWidth="3" strokeDasharray="3 4" markerEnd="url(#ups-arrow-result)" />
                    )}
                    {pParachuteStart && pParachuteGlide && (
                      <line x1={pParachuteStart.pixelX} y1={pParachuteStart.pixelY} x2={pParachuteGlide.pixelX} y2={pParachuteGlide.pixelY} stroke="#7c3aed" strokeWidth="4" markerEnd="url(#ups-arrow-para)" />
                    )}
                    {pParachuteDriftStart && pParachuteWind && (
                      <line x1={pParachuteDriftStart.pixelX} y1={pParachuteDriftStart.pixelY} x2={pParachuteWind.pixelX} y2={pParachuteWind.pixelY} stroke="#0284c7" strokeWidth="4" strokeDasharray="4 4" markerEnd="url(#ups-arrow-cyan)" />
                    )}
                    {pParachuteStart && pParachuteResult && (
                      <line x1={pParachuteStart.pixelX} y1={pParachuteStart.pixelY} x2={pParachuteResult.pixelX} y2={pParachuteResult.pixelY} stroke="#0f766e" strokeWidth="3" strokeDasharray="3 4" markerEnd="url(#ups-arrow-result)" />
                    )}
                    {pFinal &&
                      (!pAircraftResult || Math.hypot(pFinal.pixelX - pAircraftResult.pixelX, pFinal.pixelY - pAircraftResult.pixelY) > 0.5) &&
                      (!pParachuteResult || Math.hypot(pFinal.pixelX - pParachuteResult.pixelX, pFinal.pixelY - pParachuteResult.pixelY) > 0.5) && (
                      <line x1={pInc.pixelX} y1={pInc.pixelY} x2={pFinal.pixelX} y2={pFinal.pixelY} stroke="#b91c1c" strokeWidth="2.5" strokeDasharray="10 5" markerEnd="url(#ups-arrow-red)" />
                    )}
                  </g>
                );
              })()}

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

              {manualPoints.map((point) => {
                if (!point.leg) return null;
                const from = pointPixels.find((candidate) => candidate.id === point.leg?.fromId);
                const to = pointPixels.find((candidate) => candidate.id === point.id);
                return from && to ? <line key={`route-${point.id}`} x1={from.pixelX} y1={from.pixelY} x2={to.pixelX} y2={to.pixelY} stroke="#0369a1" strokeWidth="3" markerEnd="url(#ups-arrow-cyan)" /> : null;
              })}

              {/* Plotted Position Pins & Labels */}
              {pointPixels.map((p) => (
                <g key={`pin-${p.id}`} filter="url(#ups-glow)">
                  {selectedPointId === p.id && <circle cx={p.pixelX} cy={p.pixelY} r={15} fill="none" stroke="#facc15" strokeWidth="4" />}
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
                    <g transform={`rotate(90, ${p.pixelX}, ${p.pixelY - 18}) translate(${p.pixelX}, ${p.pixelY - 18})`}>
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
              </g>
            </svg>
          </div>

          {/* Bottom Overlay Badge on Map */}
          <div className="absolute bottom-2 left-2 bg-slate-900/85 backdrop-blur-xs text-white text-[11px] px-2.5 py-1 rounded border border-slate-700 shadow-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
            <span className="font-semibold">Universal Plotting Sheet (VP-OS)</span>
            <span className="text-slate-400 font-mono">Rentang {spanNm}′ • mayor {spanNm / 6}′ • minor {spanNm / 60}′</span>
          </div>
        </div>

        {/* Positions List & Coordinates */}
        <div className="w-full xl:w-80 space-y-4">
          <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-3">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Plot titik dan rute UPS</h4>
            <div className="rounded border border-slate-200 bg-slate-50 p-2">
              <div className="flex justify-between text-[10px] text-slate-600"><span>Skala {spanNm}′ total</span><span>Mayor {spanNm / 6}′ • strip minor {spanNm / 60}′</span></div>
              <svg viewBox="0 0 240 24" className="mt-1 h-6 w-full" role="img" aria-label={`Ruler skala ${spanNm} menit busur`}>
                <line x1="4" y1="19" x2="236" y2="19" stroke="#334155" strokeWidth="1" />
                {Array.from({ length: 61 }, (_, index) => {
                  const major = index % 10 === 0;
                  return <line key={index} x1={4 + index * (232 / 60)} y1={major ? 3 : 12} x2={4 + index * (232 / 60)} y2="20" stroke={major ? '#0f172a' : '#94a3b8'} strokeWidth={major ? 1.5 : 0.75} />;
                })}
              </svg>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CoordinateInput axis="lat" value={startLat} onChange={setStartLat} aria-label="Koordinat lintang titik awal" />
              <CoordinateInput axis="lng" value={startLng} onChange={setStartLng} aria-label="Koordinat bujur titik awal" />
            </div>
            <button type="button" onClick={plotStart} className="w-full rounded bg-red-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-red-800">Plot Titik Awal</button>
            <label className="block text-[10px] text-slate-600">Titik asal leg
              <select value={legFromId} onChange={(event) => setLegFromId(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-1.5 text-xs">
                <option value="">Pilih titik asal</option>{displayPoints.map((point) => <option key={point.id} value={point.id}>{point.label}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[10px] text-slate-600">Bearing °T<input type="number" min="0" max="360" value={bearingInput} onChange={(event) => setBearingInput(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs" /></label>
              <label className="text-[10px] text-slate-600">Jarak NM<input type="number" min="0" step="0.1" value={distanceInput} onChange={(event) => setDistanceInput(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-1.5 text-xs" /></label>
            </div>
            <button type="button" onClick={plotLeg} className="w-full rounded bg-sky-700 px-2 py-1.5 text-xs font-semibold text-white hover:bg-sky-800">Plot Leg / Titik Tujuan</button>
            {plotError && <p role="alert" className="text-[11px] text-red-700">{plotError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Titik awal pengukuran" value={measureFromId} onChange={(event) => setMeasureFromId(event.target.value)} className="rounded border border-slate-300 p-1.5 text-[10px]"><option value="">Dari titik</option>{displayPoints.map((point) => <option key={point.id} value={point.id}>{point.label}</option>)}</select>
              <select aria-label="Titik akhir pengukuran" value={measureToId} onChange={(event) => setMeasureToId(event.target.value)} className="rounded border border-slate-300 p-1.5 text-[10px]"><option value="">Ke titik</option>{displayPoints.map((point) => <option key={point.id} value={point.id}>{point.label}</option>)}</select>
            </div>
            <button type="button" onClick={measurePoints} className="w-full rounded border border-slate-300 bg-slate-50 px-2 py-1.5 text-xs font-medium text-slate-700">Ukur bearing dan jarak WGS-84</button>
            {measureResult && <p className="text-center font-mono text-xs text-slate-800">{measureResult}</p>}
            <button type="button" disabled={!manualPoints.length} onClick={() => { if (window.confirm('Hapus semua titik dan leg manual UPS?')) setManualPoints([]); }} className="w-full rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 disabled:opacity-40">Bersihkan plot manual</button>
            <p className="text-[10px] leading-relaxed text-amber-800">Koordinat dihitung pada elipsoid WGS‑84. Grid dan skala cetak pada gambar VP‑OS belum memiliki titik kalibrasi terverifikasi; posisi relatif di pratinjau bersifat perkiraan.</p>
          </div>
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span>Posisi Terplot di UPS</span>
              <span className="text-[10px] font-normal text-slate-500 font-mono">
                {displayPoints.length} Titik
              </span>
            </h4>

            <div className="space-y-2">
              {displayPoints.map((p) => {
                const pPx = pointPixels.find((item) => item.id === p.id);
                const distNm = pPx ? Math.hypot(pPx.xNm, pPx.yNm) : 0;
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedPointId(p.id)}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setSelectedPointId(p.id); }}
                    className={`p-2 rounded bg-white border shadow-2xs text-xs cursor-pointer ${selectedPointId === p.id ? 'border-amber-400 ring-1 ring-amber-300' : 'border-slate-200'}`}
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
                    {p.source && <div className="mt-1 text-[10px] text-slate-500">Sumber: {p.source}</div>}
                    {p.leg && <div className="mt-1 text-[10px] text-slate-600">Leg {String(Math.round(p.leg.bearingDeg) % 360).padStart(3, '0')}°T / {p.leg.distanceNm} NM</div>}
                    {manualPoints.some((item) => item.id === p.id) && <button type="button" onClick={() => { if (window.confirm(`Hapus ${p.label} beserta leg terkait?`)) setManualPoints((current) => current.filter((item) => item.id !== p.id && item.leg?.fromId !== p.id)); }} className="mt-1 text-[10px] text-red-700 underline">Hapus titik</button>}
                  </div>
                );
              })}
            </div>
            {selectedPointId && (() => {
              const selected = displayPoints.find((point) => point.id === selectedPointId);
              if (!selected) return null;
              return <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[10px] text-slate-700"><strong>{selected.label}</strong><div>{formatDMS(selected.pos.lat, false)} {formatDMS(selected.pos.lng, true)}</div><div>Sumber: {selected.source ?? 'Worksheet'}</div>{selected.leg && <div>Leg dari {displayPoints.find((point) => point.id === selected.leg?.fromId)?.label}: {String(Math.round(selected.leg.bearingDeg) % 360).padStart(3, '0')}°T / {selected.leg.distanceNm} NM</div>}</div>;
            })()}
            {aeroIncidentPos && (
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t border-slate-200 pt-2 text-[10px] text-slate-700">
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-blue-600" /> Glide pesawat (B.8)</div>
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-orange-500" /> Drift angin (B.11)</div>
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dotted border-teal-700" /> Resultan (B.12)</div>
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-violet-600" /> Glide parasut</div>
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-cyan-600" /> Drift parasut</div>
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-red-700" /> Resultan total (B.14, bila berbeda)</div>
              </div>
            )}
          </div>

          {/* Instructions */}
          <div className="text-[11px] text-slate-600 leading-relaxed bg-sky-50/70 p-3 rounded-lg border border-sky-200">
            <div className="flex items-center gap-1.5 font-bold text-sky-900 mb-1">
              <Info className="h-3.5 w-3.5 text-sky-700" />
              <span>Petunjuk Template Universal Plotting Sheet:</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>Template lembar <strong>VP-OS (Universal Plotting Sheet)</strong>.</li>
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
