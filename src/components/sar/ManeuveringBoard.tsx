'use client';

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Compass,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Layers,
  Info,
  Play,
  Pause,
  SkipForward,
  Link as LinkIcon,
  Crosshair,
  Printer,
} from 'lucide-react';
import {
  type BoardVector,
  polarToCartesian,
  autoScaleBoard,
} from '@/lib/sar/maneuveringBoard';

export interface ManeuveringBoardProps {
  title?: string;
  subtitle?: string;
  vectors: BoardVector[];
  defaultScale?: number; // kts/units per ring
  unitLabel?: string; // 'kts', 'NM', etc.
  chainVectors?: boolean; // If true, observations are drawn head-to-tail (saling nyambung)
  autoFitOrigin?: boolean; // Translate titik O to keep a long vector chain inside the plotting circle.
  width?: number;
  height?: number;
  className?: string;
}

export default function ManeuveringBoard({
  title = 'Maneuvering Board (Papan Manuver Asli DMAHTC 5090)',
  subtitle = 'Form Asli DMAHTC 5090 / Plotting Vektor Polar Maritim Diklat Basarnas',
  vectors,
  defaultScale,
  unitLabel = 'kts',
  chainVectors = true,
  autoFitOrigin = false,
  className = '',
}: ManeuveringBoardProps) {
  // Dimensions of template image (maneuvering_board_web.jpg is 2400 x 2618)
  const VB_WIDTH = 2400;
  const VB_HEIGHT = 2618;
  const cx = 1200;
  const cy = 1309;
  const ring10Radius = 960.5; // Radius of Ring 10 on template
  const ringSpacing = ring10Radius / 10; // 96.05 px per ring
  const [isChainedMode, setIsChainedMode] = useState(chainVectors);

  const chainGeometry = useMemo(() => {
    const pathVectors = vectors.filter((vector) => !vector.id.includes('result') && !vector.id.includes('twc'));
    let x = 0;
    let y = 0;
    const points = [{ x, y }];
    for (const vector of pathVectors) {
      const radians = (vector.dirDeg * Math.PI) / 180;
      const dx = vector.mag * Math.sin(radians);
      const dy = -vector.mag * Math.cos(radians);
      if (isChainedMode) { x += dx; y += dy; }
      else { x = dx; y = dy; }
      points.push({ x, y });
    }
    for (const vector of vectors.filter((item) => item.id.includes('twc') || (!isChainedMode && item.id.includes('result')))) {
      const radians = (vector.dirDeg * Math.PI) / 180;
      points.push({ x: vector.mag * Math.sin(radians), y: -vector.mag * Math.cos(radians) });
    }
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const autoOrigin = autoFitOrigin && isChainedMode;
    const fitCenter = autoOrigin ? center : { x: 0, y: 0 };
    const extent = Math.max(...points.map((point) => Math.hypot(point.x - fitCenter.x, point.y - fitCenter.y)), 1);
    const originOffset = autoOrigin ? { x: -center.x, y: -center.y } : { x: 0, y: 0 };
    return { extent, originOffset, autoOrigin };
  }, [vectors, autoFitOrigin, isChainedMode]);

  const calculatedAutoScale = useMemo(() => autoScaleBoard([chainGeometry.extent]), [chainGeometry.extent]);
  const scaleChoices = useMemo(() => {
    const presets = [1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 80, 100, 150, 200, 300, 400, 500, 1000];
    const available = autoFitOrigin ? presets.filter((value) => value >= calculatedAutoScale) : presets;
    return [...new Set([...(available.length ? available : [calculatedAutoScale]), calculatedAutoScale])].sort((a, b) => a - b);
  }, [autoFitOrigin, calculatedAutoScale]);

  const [scale, setScale] = useState<number>(defaultScale ?? calculatedAutoScale);
  const plotOrigin = {
    x: cx + (chainGeometry.originOffset.x / scale) * ringSpacing,
    y: cy + (chainGeometry.originOffset.y / scale) * ringSpacing,
  };
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  // When O moves, show a fresh set of scale rings around the actual origin.
  const [showRingsGuide, setShowRingsGuide] = useState(autoFitOrigin);

  // Animation states (like in presentation PPT)
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState<number>(vectors.length);

  // Container ref for the board canvas div
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync if defaultScale or vectors change
  useEffect(() => {
    if (defaultScale) {
      setScale(defaultScale);
    } else {
      setScale(calculatedAutoScale);
    }
  }, [defaultScale, calculatedAutoScale]);

  useEffect(() => {
    setActiveStep(vectors.length);
  }, [vectors.length]);

  // Animation timer
  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      setActiveStep((prev) => {
        if (prev >= vectors.length) {
          setIsPlaying(false);
          return vectors.length;
        }
        return prev + 1;
      });
    }, 1200);
    return () => clearInterval(timer);
  }, [isPlaying, vectors.length]);

  // Compute Plotted Vectors (supporting Head-to-Tail Chaining)
  const plottedVectors = useMemo(() => {
    // Separate regular observation vectors from the final resultant vector
    const regularVecs = vectors.filter((v) => !v.id.includes('result') && !v.id.includes('twc'));
    const specialVecs = vectors.filter((v) => v.id.includes('result') || v.id.includes('twc'));

    let currentX = plotOrigin.x;
    let currentY = plotOrigin.y;

    const resultList: Array<
      BoardVector & {
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        stepIndex: number;
        pointLabelStart: string;
        pointLabelEnd: string;
      }
    > = [];

    regularVecs.forEach((vec, idx) => {
      const { x: dx, y: dy } = polarToCartesian(vec.dirDeg, vec.mag, scale, ringSpacing);

      let startX = plotOrigin.x;
      let startY = plotOrigin.y;
      let pointLabelStart = 'O';

      if (isChainedMode) {
        startX = currentX;
        startY = currentY;
        pointLabelStart = idx === 0 ? 'O' : `P${idx}`;
      } else if (vec.origin) {
        startX = plotOrigin.x + (vec.origin.x / scale) * ringSpacing;
        startY = plotOrigin.y + (vec.origin.y / scale) * ringSpacing;
      }

      const endX = startX + dx;
      const endY = startY + dy;
      const pointLabelEnd = `P${idx + 1}`;

      resultList.push({
        ...vec,
        startX,
        startY,
        endX,
        endY,
        stepIndex: idx + 1,
        pointLabelStart,
        pointLabelEnd,
      });

      if (isChainedMode) {
        currentX = endX;
        currentY = endY;
      }
    });

    // Final closing Resultant vector connects the translated O to the chain tip.
    specialVecs.forEach((vec) => {
      if (vec.id.includes('result') && isChainedMode && regularVecs.length > 0) {
        // Resultant vector closes the chain directly from O to the final tip.
        resultList.push({
          ...vec,
          startX: plotOrigin.x,
          startY: plotOrigin.y,
          endX: currentX,
          endY: currentY,
          stepIndex: regularVecs.length + 1,
          pointLabelStart: 'O (Origin)',
          pointLabelEnd: `P${regularVecs.length} (Resultant)`,
        });
      } else {
        const { x: dx, y: dy } = polarToCartesian(vec.dirDeg, vec.mag, scale, ringSpacing);
        resultList.push({
          ...vec,
          startX: plotOrigin.x,
          startY: plotOrigin.y,
          endX: plotOrigin.x + dx,
          endY: plotOrigin.y + dy,
          stepIndex: regularVecs.length + 1,
          pointLabelStart: 'O',
          pointLabelEnd: 'R',
        });
      }
    });

    return resultList;
  }, [vectors, scale, ringSpacing, cx, cy, isChainedMode, plotOrigin.x, plotOrigin.y]);

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
    setScale(calculatedAutoScale);
  };

  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.min(3, Math.max(0.6, prev + delta)));
  };

  const startAnimation = () => {
    setActiveStep(1);
    setIsPlaying(true);
  };

  return (
    <Card className={`border-slate-300 shadow-sm bg-white overflow-hidden ${className}`}>
      {/* Header Bar */}
      <CardHeader className="bg-slate-100/95 border-b border-slate-300 py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-slate-900">
              <Compass className="h-4 w-4 text-emerald-700" /> {title}
            </CardTitle>
            <p className="text-xs text-slate-500 font-mono mt-0.5">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Chained Mode Toggle (Head-to-tail vs Radial) */}
            <button
              type="button"
              onClick={() => setIsChainedMode(!isChainedMode)}
              className={`p-1.5 rounded border text-xs flex items-center gap-1.5 transition-colors font-semibold ${
                isChainedMode
                  ? 'bg-purple-700 text-white border-purple-800 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
              title="Aktifkan penggambaran vektor saling menyambung (Head-to-Tail)"
            >
              <LinkIcon className="h-3.5 w-3.5" />
              <span>{isChainedMode ? 'Vektor Tersambung (Chained)' : 'Vektor Radial'}</span>
            </button>

            {/* Animation Player Button */}
            <div className="flex items-center border border-slate-300 rounded bg-white shadow-2xs overflow-hidden">
              <button
                type="button"
                onClick={isPlaying ? () => setIsPlaying(false) : startAnimation}
                className="p-1.5 text-slate-700 hover:bg-slate-100 border-r border-slate-200 flex items-center gap-1 text-xs"
                title={isPlaying ? 'Jeda Animasi' : 'Putar Animasi Vektor (Sesuai PPT)'}
              >
                {isPlaying ? <Pause className="h-3.5 w-3.5 text-amber-600" /> : <Play className="h-3.5 w-3.5 text-emerald-600" />}
                <span className="hidden sm:inline font-semibold">{isPlaying ? 'Jeda' : 'Animasi'}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveStep(vectors.length)}
                className="p-1.5 text-slate-600 hover:bg-slate-100 text-xs font-semibold"
                title="Tampilkan Seluruh Vektor Lengkap"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Scale ring selector */}
            <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded border border-slate-300 text-xs shadow-2xs">
              <span className="text-slate-600 font-medium">1 Ring =</span>
              <select
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="font-bold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
              >
                {scaleChoices.map((choice) => (
                  <option key={choice} value={choice}>{choice} {unitLabel} per ring</option>
                ))}
              </select>
            </div>

            {autoFitOrigin && (
              <button
                type="button"
                onClick={() => setShowRingsGuide((visible) => !visible)}
                aria-pressed={showRingsGuide}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-semibold shadow-2xs ${
                  showRingsGuide
                    ? 'bg-blue-50 border-blue-300 text-blue-800'
                    : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-100'
                }`}
                title="Tampilkan atau sembunyikan lingkaran skala yang berpusat pada O"
              >
                <Layers className="h-3.5 w-3.5" />
                Ring skala
              </button>
            )}

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
              title="Cetak Papan Manuver (Print)"
              className="flex items-center gap-1 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium px-2.5 py-1 rounded shadow-2xs transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Cetak</span>
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-3 sm:p-5 flex flex-col xl:flex-row items-center gap-6 justify-center">
        {/* Maneuvering Board Canvas Container */}
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="relative w-full max-w-[640px] aspect-[2400/2618] bg-white rounded-xl overflow-hidden border border-slate-400 shadow-inner select-none cursor-grab active:cursor-grabbing flex items-center justify-center"
        >
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            }}
            className="relative w-full h-full bg-white"
          >
            {/* The Authentic Template Image (scanned DMAHTC 5090) */}
            <img
              src="/templates/maneuvering_board_web.jpg"
              alt="Authentic Maneuvering Board DMAHTC 5090"
              className="w-full h-full object-contain pointer-events-none"
              style={{ filter: 'invert(1) hue-rotate(180deg)' }}
              draggable={false}
            />

            {/* SVG Overlay for Plotted Vectors */}
            <svg
              viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
              className="absolute inset-0 w-full h-full pointer-events-none"
            >
              <defs>
                {/* Arrow markers for each vector */}
                {vectors.map((v) => (
                  <marker
                    key={`marker-${v.id}`}
                    id={`arrow-mobo-${v.id}`}
                    viewBox="0 0 14 14"
                    refX="10"
                    refY="7"
                    markerWidth="8"
                    markerHeight="8"
                    orient="auto-start-reverse"
                  >
                    <path
                      d="M 1 2 L 13 7 L 1 12 z"
                      fill={v.color}
                      stroke="#ffffff"
                      strokeWidth="1.5"
                    />
                  </marker>
                ))}
                <filter id="vector-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="#000000" floodOpacity="0.4" />
                </filter>
              </defs>

              {/* Optional Ring Value Guides */}
              {showRingsGuide &&
                Array.from({ length: 10 }).map((_, i) => {
                  const r = (i + 1) * ringSpacing;
                  const val = (i + 1) * scale;
                  return (
                    <g key={`ring-guide-${i}`}>
                      <circle
                        cx={plotOrigin.x}
                        cy={plotOrigin.y}
                        r={r}
                        fill="none"
                        stroke="#2563eb"
                        strokeWidth="1.5"
                        strokeDasharray="6 6"
                        opacity={0.4}
                      />
                      <rect
                        x={plotOrigin.x + r - 16}
                        y={plotOrigin.y - 14}
                        width="32"
                        height="18"
                        rx="3"
                        fill="#1e293b"
                        fillOpacity="0.85"
                      />
                      <text
                        x={plotOrigin.x + r}
                        y={plotOrigin.y - 1}
                        fill="#38bdf8"
                        fontSize="14"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {val}
                      </text>
                    </g>
                  );
                })}

              {/* Plot origin may move to make a long head-to-tail plot fit. */}
              <circle cx={plotOrigin.x} cy={plotOrigin.y} r={9} fill="#ef4444" stroke="#ffffff" strokeWidth="3" />
              <circle cx={plotOrigin.x} cy={plotOrigin.y} r={3} fill="#ffffff" />
              <text x={plotOrigin.x - 30} y={plotOrigin.y - 14} fill="#ef4444" fontSize="18" fontWeight="black">
                O (0)
              </text>

              {/* Plotted Vectors (Chained or Radial, filtered by active animation step) */}
              {plottedVectors
                .filter((v) => v.stepIndex <= activeStep)
                .map((v) => {
                  const midX = (v.startX + v.endX) / 2;
                  const midY = (v.startY + v.endY) / 2;
                  const isResultant = v.id.includes('result');

                  return (
                    <g key={`plotted-${v.id}`} filter="url(#vector-glow)">
                      {/* White border shadow for high contrast */}
                      <line
                        x1={v.startX}
                        y1={v.startY}
                        x2={v.endX}
                        y2={v.endY}
                        stroke="#ffffff"
                        strokeWidth={isResultant ? '10' : '8'}
                        strokeLinecap="round"
                        opacity={0.85}
                      />

                      {/* Main Vector Line */}
                      <line
                        x1={v.startX}
                        y1={v.startY}
                        x2={v.endX}
                        y2={v.endY}
                        stroke={v.color}
                        strokeWidth={isResultant ? '6' : '5'}
                        strokeLinecap="round"
                        strokeDasharray={v.dashed ? '12 8' : undefined}
                        markerEnd={`url(#arrow-mobo-${v.id})`}
                      />

                      {/* Start joint circle */}
                      <circle
                        cx={v.startX}
                        cy={v.startY}
                        r={isResultant ? 7 : 5}
                        fill={v.color}
                        stroke="#ffffff"
                        strokeWidth="2"
                      />

                      {/* End point vertex mark */}
                      <circle
                        cx={v.endX}
                        cy={v.endY}
                        r={isResultant ? 8 : 6}
                        fill={isResultant ? '#ef4444' : v.color}
                        stroke="#ffffff"
                        strokeWidth="2"
                      />

                      {/* Vertex Label (e.g. P1, P2, P3) */}
                      <text
                        x={v.endX + 12}
                        y={v.endY + 6}
                        fill="#0f172a"
                        stroke="#ffffff"
                        strokeWidth="4"
                        paintOrder="stroke"
                        fontSize="15"
                        fontWeight="black"
                      >
                        {v.pointLabelEnd}
                      </text>

                      {/* Vector Label Badge */}
                      <g transform={`translate(${midX}, ${midY})`}>
                        <rect
                          x="-70"
                          y="-22"
                          width="140"
                          height="26"
                          rx="5"
                          fill={isResultant ? '#991b1b' : '#0f172a'}
                          fillOpacity="0.92"
                          stroke={v.color}
                          strokeWidth="2"
                        />
                        <text
                          x="0"
                          y="-4"
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize="13"
                          fontWeight="bold"
                        >
                          {v.label}
                        </text>
                      </g>
                    </g>
                  );
                })}
            </svg>
          </div>

          {/* Bottom Overlay Badge on Map */}
          <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] bg-slate-900/90 backdrop-blur-xs text-white text-[11px] px-2.5 py-1.5 rounded border border-slate-700 shadow-sm flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-semibold">DMAHTC 5090 Original Sheet</span>
            <span className="text-slate-200 font-mono font-bold">
              Skala: 1 : {scale} {unitLabel}
            </span>
            <span className="text-slate-400 font-mono">
              {isChainedMode ? 'Mode: Head-to-Tail' : 'Mode: Radial'}{chainGeometry.autoOrigin ? ' · O otomatis digeser agar seluruh plot muat' : ''}
            </span>
          </div>

          {/* Step Indicator during Animation */}
          {activeStep < vectors.length && (
            <div className="absolute top-2 left-2 bg-emerald-950/90 text-emerald-200 text-xs px-3 py-1 rounded-full border border-emerald-500 shadow-md flex items-center gap-1.5 font-bold animate-pulse">
              <span>Langkah Animasi: {activeStep} / {vectors.length} Vektor</span>
            </div>
          )}
        </div>

        {/* Vector Table & Legend (Responsive, no horizontal scroll needed) */}
        <div className="w-full xl:w-80 space-y-4">
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center justify-between">
              <span>Daftar Vektor (Saling Nyambung)</span>
              <span className="text-[10px] font-normal text-slate-500 font-mono">
                {plottedVectors.length} Vektor
              </span>
            </h4>

            {plottedVectors.length === 0 ? (
              <p className="text-xs text-slate-400 italic">Belum ada vektor yang diinput.</p>
            ) : (
              <div className="space-y-2">
                {plottedVectors.map((vec, idx) => (
                  <div
                    key={vec.id}
                    className={`p-2 rounded border shadow-2xs text-xs transition-all ${
                      vec.id.includes('result')
                        ? 'bg-amber-50/80 border-amber-300'
                        : 'bg-white border-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-3.5 h-3.5 rounded-full inline-block shrink-0 shadow-xs border border-white"
                          style={{ backgroundColor: vec.color }}
                        />
                        <span className="font-bold text-slate-900">{vec.label}</span>
                      </div>
                      <span className="font-mono font-bold text-slate-800">
                        {vec.mag.toFixed(1)} {unitLabel}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                      <span>Arah True: {vec.dirDeg.toFixed(0).padStart(3, '0')}°T</span>
                      <span className="text-purple-700 font-semibold">
                        {vec.pointLabelStart} ➔ {vec.pointLabelEnd}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Authentic DMAHTC Instructions & Tips */}
          <div className="text-[11px] text-slate-600 leading-relaxed bg-amber-50/70 p-3 rounded-lg border border-amber-200">
            <div className="flex items-center gap-1.5 font-bold text-amber-900 mb-1">
              <Info className="h-3.5 w-3.5 text-amber-700" />
              <span>Petunjuk Vektor Menyambung (Head-to-Tail):</span>
            </div>
            <ul className="list-disc list-inside space-y-1 text-slate-700">
              <li>Sesuai materi animasi Diklat Basarnas, vektor observasi digambar <strong>saling menyambung</strong> dari titik ujung vektor sebelumnya ($O \rightarrow P_1 \rightarrow P_2 \dots$).</li>
              <li>Vektor penutup dari pusat $O$ menuju titik akhir $P_n$ adalah <strong>Vektor Resultan</strong>.</li>
              <li>Klik tombol <strong>Animasi</strong> untuk memutar animasi langkah demi langkah penarikan vektor di papan manuver.</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
