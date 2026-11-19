'use client';

/**
 * ManeuveringBoard — Papan Manuver scan asli DMAHTC 5090.
 *
 * Template: scan asli dari "Maneuvering Board.pdf" (DMA 5090, 300 DPI),
 * TIDAK digambar ulang. Kalibrasi terfit pada scan asli (grid-search coverage 360°):
 *  - Pusat lingkaran plotting: (1209.2, 1128.6)
 *  - Radius ring-10: 919.2 px → tiap ring = 91.92 px
 * Untuk cetak dipakai scan native 3898x4252 (aspek identik) sehingga efektif
 * >500 DPI di kertas A3/A4 — seluruh overlay tetap SVG vektor.
 *
 * Print Mode: portal blok cetak + @page A3/A4 Landscape, UI disembunyikan,
 * tanpa screenshot/rasterisasi.
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Compass,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Info,
  Minimize2,
  Play,
  Pause,
  SkipForward,
  Link as LinkIcon,
  Wand2,
} from 'lucide-react';
import {
  type BoardVector,
  polarToCartesian,
  autoScaleBoard,
  NICE_SCALES,
} from '@/lib/sar/maneuveringBoard';
import {
  placeAlongLineLabels,
  splitLabelLines,
  type BoxObstacle,
  type LabelPlacement,
} from '@/lib/sar/labelPlacement';
import SheetPrintMenu from './SheetPrintMenu';
import { FullscreenToggleButton } from './FullscreenToggleButton';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { usePrintScope, paperContentMm } from '@/lib/sar/printSheets';

export interface ManeuveringBoardProps {
  title?: string;
  subtitle?: string;
  vectors: BoardVector[];
  defaultScale?: number; // kts/units per ring
  unitLabel?: string; // 'kts', 'NM', etc.
  chainVectors?: boolean; // If true, observations are drawn head-to-tail (saling nyambung)
  autoFitOrigin?: boolean; // Translate titik O to keep a long vector chain inside the plotting circle.
  /** ID target cetak (scope), unik per instance: 'mobo-awa' | 'mobo-asw' | ... */
  printTargetId?: string;
  width?: number;
  height?: number;
  className?: string;
}

const VB_WIDTH = 2400;
const VB_HEIGHT = 2618;
/** Rentang zoom papan (layar normal & layar penuh): 50%–600%. */
const MOBO_ZOOM_MIN = 0.5;
const MOBO_ZOOM_MAX = 6;
const MOBO_ZOOM_STEP_BUTTON = 0.25;
const MOBO_ZOOM_STEP_WHEEL = 0.15;
/** Scan asli PDF "Maneuvering Board" (DMA 5090) — versi layar & versi cetak native.
 *  Cache-busting ?v= agar browser tidak memakai template lama dari cache. */
const TEMPLATE_SCREEN = '/templates/mobo5090_original_web.jpg?v=2';
const TEMPLATE_PRINT = '/templates/mobo5090_original_print.jpg?v=2';
/** Kalibrasi lingkaran plotting scan asli (hasil fit sudut 360°): pusat & radius ring-10. */
const MOBO_CX = 1209.2;
const MOBO_CY = 1128.6;
const MOBO_R10 = 919.2;

export default function ManeuveringBoard({
  title = 'Maneuvering Board (Papan Manuver Asli DMAHTC 5090)',
  subtitle = 'Form Asli DMAHTC 5090 / Plotting Vektor Polar Maritim Diklat Basarnas',
  vectors,
  defaultScale,
  unitLabel = 'kts',
  chainVectors = true,
  autoFitOrigin = false,
  printTargetId = 'mobo',
  className = '',
}: ManeuveringBoardProps) {
  const cx = MOBO_CX;
  // Kalibrasi terhadap lingkaran plotting dan ruler samping pada scan asli.
  const cy = MOBO_CY;
  const ring10Radius = MOBO_R10; // Radius luar area plotting 10 ring
  const ringSpacing = ring10Radius / 10;
  const [isChainedMode, setIsChainedMode] = useState(chainVectors);

  const chainGeometry = useMemo(() => {
    const pathVectors = vectors.filter((vector) => !vector.id.includes('result') && !vector.id.includes('twc'));
    let x = 0;
    let y = 0;
    const pathPoints = [{ x, y }];
    for (const vector of pathVectors) {
      const radians = (vector.dirDeg * Math.PI) / 180;
      const dx = vector.mag * Math.sin(radians);
      const dy = -vector.mag * Math.cos(radians);
      if (isChainedMode) { x += dx; y += dy; }
      else { x = dx; y = dy; }
      pathPoints.push({ x, y });
    }
    const points = [...pathPoints];
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
    // Pick an actual plotted vertex for O (0), choosing the one nearest the
    // plot bounds' center to keep the full chain compact around that vertex.
    const anchorIndex = autoOrigin
      ? pathPoints.reduce((bestIndex, point, index) => {
          const best = pathPoints[bestIndex];
          return Math.hypot(point.x - center.x, point.y - center.y) < Math.hypot(best.x - center.x, best.y - center.y)
            ? index
            : bestIndex;
        }, 0)
      : 0;
    const fitCenter = autoOrigin ? pathPoints[anchorIndex] : { x: 0, y: 0 };
    const extent = Math.max(...points.map((point) => Math.hypot(point.x - fitCenter.x, point.y - fitCenter.y)), 1);
    // Jarak terjauh titik terplot dari pusat PAPAN setelah penempatan final.
    // Saat O digeser (autoFitOrigin), pusat papan = pusat bbox rantai, bukan O —
    // inilah dasar pemilihan skala agar plot pas di dalam lingkaran.
    const radiusCenter = autoOrigin ? center : fitCenter;
    const boardRadius = Math.max(
      ...points.map((point) => Math.hypot(point.x - radiusCenter.x, point.y - radiusCenter.y)),
      1,
    );
    const originOffset = autoOrigin ? { x: -center.x, y: -center.y } : { x: 0, y: 0 };
    const zeroOffset = autoOrigin ? fitCenter : { x: 0, y: 0 };
    return { extent, boardRadius, originOffset, zeroOffset, anchorIndex, autoOrigin };
  }, [vectors, autoFitOrigin, isChainedMode]);

  const calculatedAutoScale = useMemo(
    () => autoScaleBoard([chainGeometry.boardRadius]),
    [chainGeometry.boardRadius],
  );
  const scaleChoices = useMemo(
    () => [...new Set([...NICE_SCALES, calculatedAutoScale])].sort((a, b) => a - b),
    [calculatedAutoScale],
  );

  // Skala = derived state: pilihan manual pengguna > defaultScale prop > auto.
  // Mode auto selalu mengikuti data terbaru (calculatedAutoScale) sehingga plot
  // tetap pas di dalam lingkaran setiap vektor berubah — tanpa useEffect.
  const [manualScale, setManualScale] = useState<number | null>(null);
  const scale = manualScale ?? defaultScale ?? calculatedAutoScale;
  const isAutoScale = manualScale == null;
  const plotOrigin = {
    x: cx + (chainGeometry.originOffset.x / scale) * ringSpacing,
    y: cy + (chainGeometry.originOffset.y / scale) * ringSpacing,
  };
  const zeroPoint = {
    x: plotOrigin.x + (chainGeometry.zeroOffset.x / scale) * ringSpacing,
    y: plotOrigin.y + (chainGeometry.zeroOffset.y / scale) * ringSpacing,
  };
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Layar penuh: hanya papan + vektor yang tampil (header, toolbar, dan panel
  // penghitungan disembunyikan — lihat kelas `isFullscreen` di bawah), dengan
  // kontrol zoom/pan/keluar mengambang di atas papan.
  const { ref: fsRef, isFullscreen, toggle: toggleFullscreen } = useFullscreen<HTMLDivElement>();


  // Animation states (like in presentation PPT)
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeStep, setActiveStep] = useState<number>(vectors.length);

  const containerRef = useRef<HTMLDivElement>(null);

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
      let pointLabelStart = chainGeometry.anchorIndex === 0 ? 'O (0)' : 'P0 (Awal)';

      if (isChainedMode) {
        startX = currentX;
        startY = currentY;
        pointLabelStart = idx === chainGeometry.anchorIndex
          ? 'O (0)'
          : idx === 0
            ? 'P0 (Awal)'
            : `P${idx}`;
      } else if (vec.origin) {
        startX = plotOrigin.x + (vec.origin.x / scale) * ringSpacing;
        startY = plotOrigin.y + (vec.origin.y / scale) * ringSpacing;
      }

      const endX = startX + dx;
      const endY = startY + dy;
      const pointLabelEnd = idx + 1 === chainGeometry.anchorIndex ? 'O (0)' : `P${idx + 1}`;

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
        resultList.push({
          ...vec,
          startX: plotOrigin.x,
          startY: plotOrigin.y,
          endX: currentX,
          endY: currentY,
          stepIndex: regularVecs.length + 1,
          pointLabelStart: chainGeometry.anchorIndex === 0 ? 'O (0)' : 'P0 (Awal)',
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
  }, [vectors, scale, ringSpacing, cx, cy, isChainedMode, chainGeometry.anchorIndex, plotOrigin.x, plotOrigin.y]);

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
    setManualScale(null);
  };

  const handleZoom = (delta: number) => {
    setZoom((prev) => Math.min(MOBO_ZOOM_MAX, Math.max(MOBO_ZOOM_MIN, prev + delta)));
  };

  // Zoom roda mouse langsung di atas papan. Listener native (bukan React
  // onWheel) karena React memasang wheel sebagai passive — preventDefault
  // akan diabaikan dan halaman ikut tergulir.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((prev) =>
        Math.min(MOBO_ZOOM_MAX, Math.max(MOBO_ZOOM_MIN, prev + (event.deltaY < 0 ? MOBO_ZOOM_STEP_WHEEL : -MOBO_ZOOM_STEP_WHEEL))),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const startAnimation = () => {
    setActiveStep(1);
    setIsPlaying(true);
  };

  const printScope = usePrintScope(printTargetId);

  return (
    <>
      <div
        ref={fsRef}
        className={`fs-target ${isFullscreen ? 'flex flex-col' : ''} ${className}`}
      >
      <Card className={`border-slate-300 shadow-sm bg-white overflow-hidden ${isFullscreen ? 'flex-1 min-h-0 py-0 gap-0' : ''}`}>
        {/* Header Bar — disembunyikan saat layar penuh (hanya papan yang tampil) */}
        <CardHeader className={`bg-slate-100/95 border-b border-slate-300 py-3 px-4 print:hidden ${isFullscreen ? 'hidden' : ''}`}>
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
                <span className="text-slate-600 font-medium">Skala Mobo =</span>
                <select
                  value={scale}
                  onChange={(e) => setManualScale(Number(e.target.value))}
                  className="font-bold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
                >
                  {scaleChoices.map((choice) => (
                    <option key={choice} value={choice}>{choice}:1 ({choice} {unitLabel}/ring)</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setManualScale(null)}
                  title="Skala otomatis: gambar pas di dalam lingkaran, tidak terlalu kecil"
                  className={`ml-0.5 flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-bold transition-colors ${
                    isAutoScale
                      ? 'bg-emerald-700 text-white border-emerald-800 shadow-2xs'
                      : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-100'
                  }`}
                >
                  <Wand2 className="h-3 w-3" />
                  Auto
                </button>
              </div>

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

              <FullscreenToggleButton
                isFullscreen={isFullscreen}
                onToggle={toggleFullscreen}
                label="Layar Penuh"
              />

              <SheetPrintMenu targetId={printTargetId} docTitle="Maneuvering Board DMA 5090" />
            </div>
          </div>
        </CardHeader>

        <CardContent className={`flex flex-col xl:flex-row items-center gap-6 justify-center ${isFullscreen ? 'flex-1 min-h-0 w-full p-0' : 'p-3 sm:p-5'}`}>
          {/* Maneuvering Board interaktif (screen) — saat layar penuh memenuhi
              viewport tanpa rasio terkunci; SVG viewBox (xMidYMid meet) yang
              menjaga proporsi papan sehingga selalu maksimal dan tidak gepeng. */}
          <div
            ref={containerRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`screen-only relative bg-white overflow-hidden select-none cursor-grab active:cursor-grabbing flex items-center justify-center ${
              isFullscreen
                ? 'w-full h-full flex-1 min-h-0 max-w-none rounded-none'
                : 'rounded-xl border border-slate-400 shadow-inner w-full max-w-[640px]'
            }`}
            style={isFullscreen ? undefined : { aspectRatio: `${VB_WIDTH} / ${VB_HEIGHT}` }}
          >
            <div
              className="sheet-zoom-wrap relative w-full h-full bg-white"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              }}
            >
              <MoboBoardView
                plottedVectors={plottedVectors}
                zeroPoint={zeroPoint}
                activeStep={activeStep}
                variant="screen"
                fit="fill"
                unitLabel={unitLabel}
              />
            </div>

            {/* Bottom Overlay Badge on Map */}
            <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] bg-slate-900/90 backdrop-blur-xs text-white text-[11px] px-2.5 py-1.5 rounded border border-slate-700 shadow-sm flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold">DMAHTC 5090 Original Sheet</span>
              <span className="text-slate-200 font-mono font-bold">
                Skala: {scale}:1 · 1 ring = {scale} {unitLabel}{isAutoScale ? ' (Auto)' : ''}
              </span>
              <span className="text-slate-400 font-mono">
                {isChainedMode ? 'Mode: Head-to-Tail' : 'Mode: Radial'}{chainGeometry.autoOrigin ? ' · O (0) pada titik vektor agar plot muat' : ''}
              </span>
            </div>

            {/* Kontrol mengambang layar penuh: zoom in/out, reset, dan keluar
                (header toolbar disembunyikan saat layar penuh). */}
            {isFullscreen && (
              <div className="absolute bottom-2 right-2 z-20 print:hidden flex items-center gap-0.5 bg-white/95 border border-slate-300 rounded shadow-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleZoom(MOBO_ZOOM_STEP_BUTTON)}
                  title="Perbesar (roda mouse ke atas di atas papan)"
                  aria-label="Perbesar papan manuver"
                  className="p-1.5 text-slate-700 hover:bg-slate-100"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
                <span className="text-[11px] font-mono px-1.5 text-slate-600 font-semibold select-none">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => handleZoom(-MOBO_ZOOM_STEP_BUTTON)}
                  title="Perkecil (roda mouse ke bawah di atas papan)"
                  aria-label="Perkecil papan manuver"
                  className="p-1.5 text-slate-700 hover:bg-slate-100"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={resetView}
                  title="Reset zoom & geseran"
                  aria-label="Reset tampilan papan"
                  className="p-1.5 text-slate-700 hover:bg-slate-100 border-l border-slate-200"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  title="Keluar layar penuh (Esc)"
                  aria-label="Keluar layar penuh"
                  className="p-1.5 text-slate-700 hover:bg-slate-100 border-l border-slate-200 flex items-center gap-1 text-xs font-semibold"
                >
                  <Minimize2 className="h-3.5 w-3.5" /> Keluar
                </button>
              </div>
            )}

            {/* Step Indicator during Animation */}
            {activeStep < vectors.length && (
              <div className="absolute top-2 left-2 bg-emerald-950/90 text-emerald-200 text-xs px-3 py-1 rounded-full border border-emerald-500 shadow-md flex items-center gap-1.5 font-bold animate-pulse">
                <span>Langkah Animasi: {activeStep} / {vectors.length} Vektor</span>
              </div>
            )}
          </div>

          {/* Vector Table & Legend (Responsive, no horizontal scroll needed) —
              disembunyikan saat layar penuh: hanya papan yang tampil. */}
          <div className={`screen-only w-full xl:w-80 space-y-4 ${isFullscreen ? 'hidden' : ''}`}>
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
                  {plottedVectors.map((vec) => (
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
                <li>Gunakan <strong>Cetak lembar</strong> untuk PDF vektor A3/A4 Landscape dengan scan asli DMA 5090.</li>
              </ul>
            </div>
          </div>

          {/* Blok cetak fluid (Ctrl+P bawaan) */}
          <div className="print-only print-companion-page w-full">
            <MoboPrintHeader title={title} scale={scale} unitLabel={unitLabel} chained={isChainedMode} />
            <MoboBoardView
              plottedVectors={plottedVectors}
              zeroPoint={zeroPoint}
              activeStep={vectors.length}
              variant="print"
              fit="auto"
              unitLabel={unitLabel}
            />
            <MoboVectorTable plottedVectors={plottedVectors} unitLabel={unitLabel} compact />
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Print Mode terpisah: portal ke <body> */}
      {printScope && createPortal(
        <MoboPrintPortalBlock
          paper={printScope.paper}
          title={title}
          scale={scale}
          unitLabel={unitLabel}
          chained={isChainedMode}
          plottedVectors={plottedVectors}
          zeroPoint={zeroPoint}
        />,
        document.body,
      )}
    </>
  );
}

/* ==========================================================================
   MoboBoardView — papan manuver (scan asli + overlay SVG vektor)
   ========================================================================== */

interface MoboPlottedVector extends BoardVector {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  stepIndex: number;
  pointLabelStart: string;
  pointLabelEnd: string;
}

interface MoboBoardViewProps {
  plottedVectors: MoboPlottedVector[];
  zeroPoint: { x: number; y: number };
  activeStep: number;
  variant: 'screen' | 'print';
  /** fill: isi kotak (aspek sama); height: tinggi penuh lebar otomatis; auto: lebar penuh tinggi otomatis; explicit: ukuran mm eksplisit */
  fit: 'fill' | 'height' | 'auto' | 'explicit';
  /** Ukuran eksplisit (mm) saat fit='explicit' — anti-quirk sizing svg. */
  explicitSizeMm?: { width: number; height: number };
  /** Satuan magnitudo untuk badge vektor di papan ('kts' → 'kt', 'NM', dsb.). */
  unitLabel: string;
}

function MoboBoardView({
  plottedVectors,
  zeroPoint,
  activeStep,
  variant,
  fit,
  explicitSizeMm,
  unitLabel,
}: MoboBoardViewProps) {
  const isPrint = variant === 'print';
  const k = isPrint ? 2 : 1; // pengali ukuran cetak

  // ---- Badge vektor: format arah/jarak (contoh 50°/60 nm) ----
  // Nama lengkap vektor tetap tampil di tabel "Daftar Vektor" di samping papan.
  const badgeUnit = unitLabel === 'kts' ? 'kt' : unitLabel.toLowerCase();
  const fmtBadgeMag = (m: number) => (Math.abs(m - Math.round(m)) < 0.05 ? String(Math.round(m)) : m.toFixed(1));
  const badgeOf = (v: MoboPlottedVector) =>
    v.badge ?? `${Math.round(v.dirDeg) % 360}°/${fmtBadgeMag(v.mag)} ${badgeUnit}`;

  // ---- Penempatan label vektor: rotasi mengikuti vektor, hindari tabrakan ----
  // Font besar agar terbaca di layar & kertas; label panjang dipecah 2 baris.
  const labelFont = isPrint ? 34 : 32;
  const visibleVectors = plottedVectors.filter((v) => v.stepIndex <= activeStep);
  const labelPlacements: Map<string, LabelPlacement> = new Map();
  if (visibleVectors.length > 0) {
    const items = visibleVectors.map((v) => ({
      id: v.id,
      x1: v.startX,
      y1: v.startY,
      x2: v.endX,
      y2: v.endY,
      label: badgeOf(v),
      lines: splitLabelLines(badgeOf(v)),
    }));
    const obstacleSegments = plottedVectors.map((v) => ({
      id: v.id,
      x1: v.startX,
      y1: v.startY,
      x2: v.endX,
      y2: v.endY,
    }));
    // Kotak tetap: label verteks (P1..) & penanda O (0) tidak boleh tertutup.
    const vertexFont = isPrint ? 30 : 15;
    const staticObstacles: BoxObstacle[] = visibleVectors.map((v) => {
      const w = v.pointLabelEnd.length * vertexFont * 0.62 + 10;
      const h = vertexFont * 1.3;
      return { id: `vertex-${v.id}`, x: v.endX + 12 + w / 2, y: v.endY + 6 * k - h * 0.35, w, h };
    });
    const oFont = isPrint ? 34 : 18;
    staticObstacles.push({
      id: 'zero-marker',
      x: zeroPoint.x - 30 + ('O (0)'.length * oFont * 0.62) / 2,
      y: zeroPoint.y - 14 * k - oFont * 0.35,
      w: 'O (0)'.length * oFont * 0.62 + 8,
      h: oFont * 1.3,
    });
    for (const pl of placeAlongLineLabels(items, {
      fontSize: labelFont,
      minPad: 6,
      obstacleSegments,
      staticObstacles,
      sceneCenter: zeroPoint,
    })) {
      labelPlacements.set(pl.id, pl);
    }
  }

  const svgStyle = fit === 'fill'
    ? { width: '100%', height: '100%' }
    : fit === 'explicit'
      ? { width: `${explicitSizeMm?.width ?? 100}mm`, height: `${explicitSizeMm?.height ?? 100}mm` }
      : fit === 'height'
        ? { height: '100%', width: 'auto' }
        : { width: '100%', height: 'auto' };

  return (
    <svg
      viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      style={svgStyle}
      className={fit === 'fill' ? 'absolute inset-0 pointer-events-none' : 'block'}
      role="img"
      aria-label="Maneuvering Board DMAHTC 5090 asli dengan vektor plotting"
    >
      <defs>
        {plottedVectors.map((v) => (
          <marker
            key={`marker-${v.id}-${variant}`}
            id={`arrow-mobo-${v.id}-${variant}`}
            viewBox="0 0 14 14"
            refX="10"
            refY="7"
            markerWidth={isPrint ? 9 : 8}
            markerHeight={isPrint ? 9 : 8}
            orient="auto-start-reverse"
          >
            <path d="M 1 2 L 13 7 L 1 12 z" fill={v.color} stroke="#ffffff" strokeWidth="1.5" />
          </marker>
        ))}
        <filter id={`vector-glow-${variant}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="#000000" floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Scan asli DMA 5090: layar & cetak (native >=300 DPI, tanpa filter) */}
      <image
        href={TEMPLATE_SCREEN}
        className="sheet-img-screen"
        x="0"
        y="0"
        width={VB_WIDTH}
        height={VB_HEIGHT}
        preserveAspectRatio="none"
      />
      <image
        href={TEMPLATE_PRINT}
        className="sheet-img-print"
        x="0"
        y="0"
        width={VB_WIDTH}
        height={VB_HEIGHT}
        preserveAspectRatio="none"
      />

      {/* The zero marker is attached to a real vertex in the plotted chain. */}
      <circle cx={zeroPoint.x} cy={zeroPoint.y} r={9 * k} fill="#ef4444" stroke="#ffffff" strokeWidth={3 * k} />
      <circle cx={zeroPoint.x} cy={zeroPoint.y} r={3 * k} fill="#ffffff" />
      <text
        x={zeroPoint.x - 30}
        y={zeroPoint.y - 14 * k}
        fill="#ef4444"
        fontSize={isPrint ? 34 : 18}
        fontWeight="black"
        stroke={isPrint ? '#ffffff' : undefined}
        strokeWidth={isPrint ? 8 : undefined}
        paintOrder={isPrint ? 'stroke' : undefined}
      >
        O (0)
      </text>

      {/* Plotted Vectors (Chained or Radial, filtered by active animation step) */}
      {visibleVectors.map((v) => {
        const isResultant = v.id.includes('result');
        const pl = labelPlacements.get(v.id);
        const labelLines = splitLabelLines(badgeOf(v));

        return (
            <g key={`plotted-${v.id}-${variant}`} filter={isPrint ? undefined : `url(#vector-glow-${variant})`}>
              {/* White border shadow for high contrast */}
              <line
                x1={v.startX}
                y1={v.startY}
                x2={v.endX}
                y2={v.endY}
                stroke="#ffffff"
                strokeWidth={(isResultant ? 10 : 8) * k}
                strokeLinecap="round"
                opacity={0.85}
              />

              {/* Main Vector Line — selalu solid (permintaan: tanpa garis putus-putus) */}
              <line
                x1={v.startX}
                y1={v.startY}
                x2={v.endX}
                y2={v.endY}
                stroke={v.color}
                strokeWidth={(isResultant ? 6 : 5) * k}
                strokeLinecap="round"
                markerEnd={`url(#arrow-mobo-${v.id}-${variant})`}
              />

              {/* Start joint circle */}
              <circle
                cx={v.startX}
                cy={v.startY}
                r={(isResultant ? 7 : 5) * k}
                fill={v.color}
                stroke="#ffffff"
                strokeWidth={2 * k}
              />

              {/* End point vertex mark */}
              <circle
                cx={v.endX}
                cy={v.endY}
                r={(isResultant ? 8 : 6) * k}
                fill={isResultant ? '#ef4444' : v.color}
                stroke="#ffffff"
                strokeWidth={2 * k}
              />

              {/* Vertex Label (e.g. P1, P2, P3) */}
              <text
                x={v.endX + 12}
                y={v.endY + 6 * k}
                fill="#0f172a"
                stroke="#ffffff"
                strokeWidth={4 * k}
                paintOrder="stroke"
                fontSize={isPrint ? 30 : 15}
                fontWeight="black"
                style={{ paintOrder: 'stroke' }}
              >
                {v.pointLabelEnd}
              </text>

              {/* Vector Label Badge — dirotasi mengikuti arah vektor, digeser
                  bila vektor pendek agar tidak menutupi vektor/label lain */}
              {pl && (() => {
                const lineH = labelFont * 1.15;
                return (
                  <g transform={`translate(${pl.x}, ${pl.y}) rotate(${pl.angleDeg})`}>
                    <rect
                      x={-pl.widthPx / 2}
                      y={-pl.heightPx / 2}
                      width={pl.widthPx}
                      height={pl.heightPx}
                      rx={6 * k}
                      fill={isResultant ? '#991b1b' : '#0f172a'}
                      fillOpacity="0.88"
                      stroke={v.color}
                      strokeWidth={1.5 * k}
                    />
                    {labelLines.map((line, i) => (
                      <text
                        key={`${v.id}-lbl-${i}`}
                        x="0"
                        y={(i - (labelLines.length - 1) / 2) * lineH + labelFont * 0.36}
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize={labelFont}
                        fontWeight="bold"
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                );
              })()}
            </g>
          );
        })}
    </svg>
  );
}

/* ==========================================================================
   Header, tabel vektor & blok cetak Mobo
   ========================================================================== */

function MoboPrintHeader({
  title,
  scale,
  unitLabel,
  chained,
}: {
  title: string;
  scale: number;
  unitLabel: string;
  chained: boolean;
}) {
  return (
    <div className="mb-2 border-b-2 border-slate-800 pb-1.5 flex items-end justify-between gap-4">
      <div>
        <p className="text-[13pt] font-bold text-slate-900 leading-tight">{title}</p>
        <p className="text-[8pt] text-slate-600">Form Asli DMAHTC 5090 — scan native 300 DPI</p>
      </div>
      <p className="text-[8pt] font-mono text-slate-700 text-right">
        Skala {scale}:1 · 1 ring = {scale} {unitLabel}<br />
        Mode {chained ? 'Head-to-Tail' : 'Radial'} · Bearing 000–360°T
      </p>
    </div>
  );
}

function MoboVectorTable({
  plottedVectors,
  unitLabel,
  compact = false,
}: {
  plottedVectors: MoboPlottedVector[];
  unitLabel: string;
  compact?: boolean;
}) {
  if (plottedVectors.length === 0) return null;
  return (
    <table className={`w-full border-collapse ${compact ? 'mt-2' : ''}`}>
      <thead>
        <tr className="border-b border-slate-400 text-left">
          <th className="py-1 pr-2 font-semibold">Vektor</th>
          <th className="py-1 pr-2 font-semibold">Arah</th>
          <th className="py-1 pr-2 font-semibold">Nilai</th>
          <th className="py-1 font-semibold">Dari ➔ Ke</th>
        </tr>
      </thead>
      <tbody>
        {plottedVectors.map((vec) => (
          <tr key={vec.id} className="border-b border-slate-200">
            <td className={`py-1 pr-2 ${compact ? 'text-[7.5pt]' : 'text-[8.5pt]'}`}>
              <span
                className="inline-block w-[8px] h-[8px] rounded-full mr-1.5 align-middle border border-white"
                style={{ backgroundColor: vec.color }}
              />
              {vec.label}
            </td>
            <td className={`py-1 pr-2 font-mono ${compact ? 'text-[7.5pt]' : 'text-[8.5pt]'}`}>
              {vec.dirDeg.toFixed(0).padStart(3, '0')}°T
            </td>
            <td className={`py-1 pr-2 font-mono ${compact ? 'text-[7.5pt]' : 'text-[8.5pt]'}`}>
              {vec.mag.toFixed(1)} {unitLabel}
            </td>
            <td className={`py-1 font-mono ${compact ? 'text-[7.5pt]' : 'text-[8.5pt]'}`}>
              {vec.pointLabelStart} ➔ {vec.pointLabelEnd}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface MoboPrintPortalProps {
  paper: 'a3' | 'a4';
  title: string;
  scale: number;
  unitLabel: string;
  chained: boolean;
  plottedVectors: MoboPlottedVector[];
  zeroPoint: { x: number; y: number };
}

function MoboPrintPortalBlock({
  paper,
  unitLabel,
  plottedVectors,
  zeroPoint,
}: MoboPrintPortalProps) {
  const [wmm, hmm] = paperContentMm(paper);
  // Cetak HANYA lembar MOBO penuh beserta vektornya (permintaan pengguna):
  // tanpa header, tabel vektor, atau keterangan lain. Lembar mengisi seluruh
  // area kertas landscape dengan proporsi asli (fit sisi terbatas).
  const PAD_MM = 4;
  const innerW = wmm - PAD_MM * 2;
  const innerH = hmm - PAD_MM * 2;
  const aspect = VB_WIDTH / VB_HEIGHT;
  let sheetH = innerH;
  let sheetW = sheetH * aspect;
  if (sheetW > innerW) {
    sheetW = innerW;
    sheetH = sheetW / aspect;
  }

  return (
    <div
      className="portal-print-sheet print-avoid-break bg-white text-slate-900 flex items-center justify-center"
      style={{ width: `${wmm}mm`, height: `${hmm}mm`, padding: `${PAD_MM}mm`, overflow: 'hidden' }}
    >
      <MoboBoardView
        plottedVectors={plottedVectors}
        zeroPoint={zeroPoint}
        activeStep={Number.MAX_SAFE_INTEGER}
        variant="print"
        fit="explicit"
        explicitSizeMm={{ width: sheetW, height: sheetH }}
        unitLabel={unitLabel}
      />
    </div>
  );
}
