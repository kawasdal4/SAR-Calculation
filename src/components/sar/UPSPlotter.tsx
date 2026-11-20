'use client';

/**
 * UPSPlotter — Universal Plotting Sheet (scan asli Celestaire VP-OS, landscape).
 *
 * Template: scan asli 300 DPI dari "Universal Plotting Sheet.pdf" (VP-OS),
 * TIDAK digambar ulang. Kalibrasi diukur langsung dari scan:
 *  - Sumbu skala menit (vertikal): x = 2133
 *  - Garis paralel tengah: y = 1891 (5 garis paralel, jarak 60' tiap garis)
 *  - Radius rose: 900 px = tepat 60 menit busur (60 NM) — rose menyinggung
 *    garis paralel ke-2 dan ke-4
 *  - Pitch tick: 15,0 px per menit busur → 1 tick = 1' = 1 NM (skala asli lembar)
 *
 * Seluruh overlay (vektor, pin, label, area pencarian) = SVG vektor.
 * Print Mode: portal blok cetak + @page A3/A4 Landscape + template resolusi
 * native (≥300 DPI pada kertas) — tanpa screenshot/rasterisasi overlay.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Map as MapIcon,
  Maximize2,
  Minimize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Layers,
  Info,
} from 'lucide-react';
import { type LatLng, type Vector } from '@/lib/sar/sarCalculations';
import { latLonToUPS } from '@/lib/sar/upsGrid';
import { formatDMS } from '@/lib/sar/coordFormat';
import CoordinateInput from './CoordinateInput';
import { upsDirect, upsInverse } from '@/lib/sar/upsGeodesic';
import {
  placeAlongLineLabels,
  type BoxObstacle,
  type LabelPlacement,
} from '@/lib/sar/labelPlacement';
import SheetPrintMenu from './SheetPrintMenu';
import { FullscreenToggleButton } from './FullscreenToggleButton';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { usePrintScope, paperContentMm } from '@/lib/sar/printSheets';

/* ===== Kalibrasi scan asli VP-OS (ukuran px pada scan native 4252x3898) ===== */
const VB_WIDTH = 4252;
const VB_HEIGHT = 3898;
const UPS_CX = 2133;
const UPS_CY = 1891;
const UPS_ROSE_R = 900; // = 60 menit busur = 60 NM
/** Radius rose dalam menit busur — skala asli lembar (1 tick = 1' = 1 NM). */
const UPS_ROSE_SPAN_MIN = 60;

// Cache-busting ?v= agar browser tidak memakai scan lama dari cache.
const TEMPLATE_SCREEN = '/templates/ups_vpos_original_web.jpg?v=2';
const TEMPLATE_PRINT = '/templates/ups_vpos_original_print.jpg?v=2';

/** Preset "rentang skala": menit busur yang dicakup radius rose. 60' = skala asli. */
const UPS_SPAN_PRESETS = [120, 90, 60, 45, 30, 20, 15, 10];
/** Batas zoom tampilan lembar (transform scale) — tombol, roda mouse, dan layar penuh. */
const UPS_ZOOM_MIN = 0.5;
const UPS_ZOOM_MAX = 6;
const UPS_ZOOM_STEP_BUTTON = 0.25;
const UPS_ZOOM_STEP_WHEEL = 0.15;
/** Target isi rose pada auto skala: konten terjauh menempati ≤ 90% radius rose. */
const UPS_FIT_TARGET = 0.9;

/* ---- Tick skala adaptif: pilihan langkah menit agar tick selalu terbaca ---- */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60];
const TICK_MAJOR_STEPS = [5, 10, 15, 30, 60, 120];

/** Langkah tick minor terkecil yang jaraknya ≥ minGapPx pada skala terpakai. */
function pickTickStep(pxPerMin: number, minGapPx: number): number {
  return TICK_STEPS.find((step) => step * pxPerMin >= minGapPx) ?? 120;
}

/** Langkah label (tick major) terkecil > minor yang jaraknya ≥ minGapPx. */
function pickMajorStep(minorStep: number, pxPerMin: number, minGapPx: number): number {
  return TICK_MAJOR_STEPS.find((step) => step > minorStep && step * pxPerMin >= minGapPx) ?? minorStep * 5;
}

/**
 * Auto skala dari analisis soal kasus: preset terkecil yang memuat radius konten
 * pada ≤ UPS_FIT_TARGET radius rose — pas di lembar, tidak overflow, tidak terlalu kecil.
 */
function autoSpanNm(radiusNm: number): number {
  const ascending = [...UPS_SPAN_PRESETS].sort((a, b) => a - b);
  const need = radiusNm / UPS_FIT_TARGET;
  return ascending.find((preset) => preset >= need) ?? ascending[ascending.length - 1];
}

type UserPlotPoint = {
  id: string;
  label: string;
  /** Label pendek untuk ditampilkan di lembar (anti tumpang tindih); label lengkap tetap di daftar. */
  short?: string;
  desc: string;
  pos: LatLng;
  color: string;
  fill: string;
  source: string;
  leg?: { fromId: string; bearingDeg: number; distanceNm: number };
};

/** Segmen garis vektor pada lembar (koordinat geodetik, dipetakan di view). */
interface UpsVectorSeg {
  key: string;
  /** Nama pendek vektor untuk label (contoh: "SC - 50°/60 NM"). */
  name?: string;
  from: LatLng;
  to: LatLng;
  color: string;
  width: number;
  dash?: string;
  marker: string;
  halo?: boolean;
}

interface UpsSearchArea {
  center: LatLng;
  lengthNm: number;
  widthNm: number;
  orientationDeg: number;
}

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
  title = 'Universal Plotting Sheet (Scan Asli VP-OS)',
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
  // Pusat koordinat = titik tengah posisi yang relevan
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

  // Daftar titik terplot (worksheet + manual). `short` = label pendek di lembar.
  const points = useMemo(() => {
    const list: {
      id: string;
      label: string;
      short?: string;
      desc: string;
      pos: LatLng;
      color: string;
      fill: string;
    }[] = [];

    if (aeroIncidentPos) {
      list.push({ id: 'aero-inc', label: 'Posisi Darurat (Incident)', short: 'Incident', desc: 'Titik awal darurat udara', pos: aeroIncidentPos, color: '#9333ea', fill: '#f3e8ff' });
    }
    if (aeroEndGlidePos) {
      list.push({ id: 'aero-glide', label: 'Resultan pesawat (B.12)', short: 'B.12 Pesawat', desc: 'Hasil penjumlahan vektor glide dan drift angin pesawat', pos: aeroEndGlidePos, color: '#2563eb', fill: '#dbeafe' });
    }
    if (aeroPlotPositions.aircraftGlideTip && (aeroAircraftGlideVector?.mag ?? 0) > 0) {
      list.push({ id: 'air-glide-tip', label: 'Ujung glide pesawat (B.8)', short: 'B.8 Pesawat', desc: 'Posisi setelah vektor glide sebelum drift angin', pos: aeroPlotPositions.aircraftGlideTip, color: '#2563eb', fill: '#dbeafe' });
    }
    if (aeroPlotPositions.aircraftWindTip && (aeroAircraftWindVector?.mag ?? 0) > 0) {
      list.push({ id: 'air-wind-tip', label: 'Ujung drift pesawat (B.11)', short: 'B.11 Pesawat', desc: 'Posisi setelah vektor angin selama glide', pos: aeroPlotPositions.aircraftWindTip, color: '#f97316', fill: '#ffedd5' });
    }
    if (aeroPlotPositions.parachuteGlideTip && (aeroParachuteGlideVector?.mag ?? 0) > 0) {
      list.push({ id: 'para-glide-tip', label: 'Ujung glide parasut', short: 'B.8 Parasut', desc: 'Posisi setelah vektor glide parasut', pos: aeroPlotPositions.parachuteGlideTip, color: '#7c3aed', fill: '#ede9fe' });
    }
    if (aeroPlotPositions.parachuteWindTip && (aeroParachuteWindVector?.mag ?? 0) > 0) {
      list.push({ id: 'para-wind-tip', label: 'Ujung drift parasut', short: 'B.11 Parasut', desc: 'Posisi setelah vektor angin saat turun', pos: aeroPlotPositions.parachuteWindTip, color: '#0891b2', fill: '#cffafe' });
    }
    if (aeroPlotPositions.parachuteResult && aeroParachuteResultVector) {
      list.push({ id: 'para-result', label: 'Resultan parasut (B.12)', short: 'B.12 Parasut', desc: 'Hasil penjumlahan vektor glide dan drift parasut', pos: aeroPlotPositions.parachuteResult, color: '#0f766e', fill: '#ccfbf1' });
    }
    if (aeroLandingPos) {
      list.push({ id: 'aero-land', label: 'Posisi Mendarat (LKP SAR)', short: 'LKP SAR', desc: 'Menjadi LKP Operasi Maritim', pos: aeroLandingPos, color: '#0284c7', fill: '#e0f2fe' });
    } else {
      list.push({ id: 'lkp', label: 'LKP (Last Known Position)', short: 'LKP', desc: 'Posisi Terakhir Diketahui', pos: lkp, color: '#0284c7', fill: '#e0f2fe' });
    }

    if (datumLeft) {
      list.push({ id: 'dl', label: 'Datum L (Kiri)', short: 'Datum L', desc: 'Hanyutan Leeway Kiri', pos: datumLeft, color: '#dc2626', fill: '#fee2e2' });
    }
    if (datumRight) {
      list.push({ id: 'dr', label: 'Datum R (Kanan)', short: 'Datum R', desc: 'Hanyutan Leeway Kanan', pos: datumRight, color: '#ea580c', fill: '#ffedd5' });
    }
    if (searchAreaCenter) {
      list.push({ id: 'sac', label: 'Pusat Area Pencarian', short: 'Pusat SA', desc: 'Datum Pusat Search Area', pos: searchAreaCenter, color: '#16a34a', fill: '#dcfce7' });
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

  // Jarak maksimum titik ke pusat (NM) — untuk auto-fit skala & info
  const maxDistanceNm = useMemo(() => {
    let maxD = 8;
    displayPoints.forEach((p) => {
      const { xNm, yNm } = latLonToUPS(p.pos, centerLat, centerLon);
      const d = Math.hypot(xNm, yNm);
      if (d > maxD) maxD = d;
    });
    return maxD;
  }, [displayPoints, centerLat, centerLon]);

  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showCoordsBadge, setShowCoordsBadge] = useState(true);

  // Layar penuh: seluruh kartu UPS (header + lembar + panel titik) memenuhi viewport.
  const { ref: fsRef, isFullscreen, toggle: toggleFullscreen } = useFullscreen<HTMLDivElement>();
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Segmen vektor (geodetik) — dipetakan ke px oleh UpsSheetView sesuai skala
  const vectorSegs = useMemo<UpsVectorSeg[]>(() => {
    const segs: UpsVectorSeg[] = [];
    const lkpBase = aeroLandingPos ?? lkp;

    // ADW: B.8 glide, B.11 wind, B.12 resultants, dan lintasan final ke LKP
    if (aeroIncidentPos) {
      const { aircraftGlideTip, aircraftWindTip, parachuteGlideTip, parachuteWindTip, parachuteResult } = aeroPlotPositions;
      if (aircraftGlideTip && (aeroAircraftGlideVector?.mag ?? 0) > 0) {
        segs.push({ key: 'air-glide', name: 'B.8 Pesawat', from: aeroIncidentPos, to: aircraftGlideTip, color: '#2563eb', width: 5, marker: 'blue' });
      }
      if (aircraftGlideTip && aircraftWindTip && (aeroAircraftWindVector?.mag ?? 0) > 0) {
        segs.push({ key: 'air-wind', name: 'B.11 Pesawat', from: aircraftGlideTip, to: aircraftWindTip, color: '#f97316', width: 5, dash: '12 7', marker: 'wind' });
      }
      if (aeroEndGlidePos) {
        segs.push({ key: 'air-result', name: 'B.12 Pesawat', from: aeroIncidentPos, to: aeroEndGlidePos, color: '#0f766e', width: 4, dash: '4 6', marker: 'result' });
      }
      const parachuteStart = aeroEndGlidePos ?? aeroIncidentPos;
      if (parachuteStart && parachuteGlideTip && (aeroParachuteGlideVector?.mag ?? 0) > 0) {
        segs.push({ key: 'para-glide', name: 'B.8 Parasut', from: parachuteStart, to: parachuteGlideTip, color: '#7c3aed', width: 5, marker: 'para' });
      }
      const driftStart = parachuteGlideTip ?? parachuteStart;
      if (driftStart && parachuteWindTip && (aeroParachuteWindVector?.mag ?? 0) > 0) {
        segs.push({ key: 'para-wind', name: 'B.11 Parasut', from: driftStart, to: parachuteWindTip, color: '#0284c7', width: 5, dash: '6 6', marker: 'cyan' });
      }
      if (parachuteStart && parachuteResult && aeroParachuteResultVector) {
        segs.push({ key: 'para-result', name: 'B.12 Parasut', from: parachuteStart, to: parachuteResult, color: '#0f766e', width: 4, dash: '4 6', marker: 'result' });
      }
      // Lintasan final ke LKP hanya bila berbeda dari kedua resultan (>0,05 NM)
      if (aeroLandingPos) {
        const nearResultant = (ref?: LatLng) => {
          if (!ref) return false;
          const { distanceNm } = upsInverse(aeroLandingPos, ref);
          return distanceNm <= 0.05;
        };
        const sameAsAircraft = nearResultant(aeroEndGlidePos);
        const sameAsParachute = nearResultant(parachuteResult);
        if (!sameAsAircraft && !sameAsParachute) {
          segs.push({ key: 'final-track', name: 'Lintasan', from: aeroIncidentPos, to: aeroLandingPos, color: '#b91c1c', width: 4, dash: '15 8', marker: 'red' });
        }
      }
    }

    // Hanyutan laut: LKP -> Datum L / Datum R
    if (datumLeft && lkpBase) {
      segs.push({ key: 'lkp-dl', name: 'Datum L', from: lkpBase, to: datumLeft, color: '#dc2626', width: 5, marker: 'red', halo: true });
    }
    if (datumRight && lkpBase) {
      segs.push({ key: 'lkp-dr', name: 'Datum R', from: lkpBase, to: datumRight, color: '#ea580c', width: 5, marker: 'red', halo: true });
    }

    // Leg manual (bearing & jarak WGS-84)
    manualPoints.forEach((point) => {
      if (!point.leg) return;
      const from = displayPoints.find((candidate) => candidate.id === point.leg?.fromId);
      if (!from) return;
      segs.push({ key: `route-${point.id}`, name: point.short ?? point.label, from: from.pos, to: point.pos, color: '#0369a1', width: 4, marker: 'cyan' });
    });

    return segs;
  }, [
    lkp, aeroLandingPos, aeroIncidentPos, aeroEndGlidePos, aeroPlotPositions,
    aeroAircraftGlideVector, aeroAircraftWindVector, aeroParachuteGlideVector,
    aeroParachuteWindVector, aeroParachuteResultVector, datumLeft, datumRight,
    manualPoints, displayPoints,
  ]);

  const searchArea = useMemo<UpsSearchArea | null>(() => {
    if (!searchAreaCenter || !searchAreaLength || !searchAreaWidth) return null;
    return {
      center: searchAreaCenter,
      lengthNm: searchAreaLength,
      widthNm: searchAreaWidth,
      orientationDeg: searchAreaOrientation,
    };
  }, [searchAreaCenter, searchAreaLength, searchAreaWidth, searchAreaOrientation]);

  /* ==== Analisis skala dari soal kasus (auto fit pada lembar UPS) ==== */
  // Radius area pencarian dari pusat rose: jarak pusat SA + setengah diagonal rect.
  const searchRadiusNm = useMemo(() => {
    if (!searchArea) return 0;
    const c = latLonToUPS(searchArea.center, centerLat, centerLon);
    return Math.hypot(c.xNm, c.yNm) + Math.hypot(searchArea.lengthNm, searchArea.widthNm) / 2;
  }, [searchArea, centerLat, centerLon]);

  // Radius konten kasus: titik worksheet + area pencarian (titik manual tidak memicu auto).
  const worksheetRadiusNm = useMemo(() => {
    let maxD = 6;
    points.forEach((p) => {
      const { xNm, yNm } = latLonToUPS(p.pos, centerLat, centerLon);
      const d = Math.hypot(xNm, yNm);
      if (d > maxD) maxD = d;
    });
    return Math.max(maxD, searchRadiusNm);
  }, [points, searchRadiusNm, centerLat, centerLon]);

  // Radius seluruh konten (termasuk titik manual) — dipakai tombol Auto & analisis tampilan.
  const contentRadiusNm = useMemo(
    () => Math.max(maxDistanceNm, searchRadiusNm),
    [maxDistanceNm, searchRadiusNm],
  );

  // Skala awal: preset terkecil yang memuat seluruh konten ≤ 90% radius rose (pas di lembar).
  const [spanNm, setSpanNm] = useState<number>(() => autoSpanNm(worksheetRadiusNm));

  // Skala selalu dianalisis ulang dari soal kasus saat data worksheet berubah.
  const worksheetFitSig = useMemo(
    () => `${points.map((p) => `${p.id}:${p.pos.lat.toFixed(5)},${p.pos.lng.toFixed(5)}`).join('|')}#${
      searchArea
        ? `${searchArea.center.lat.toFixed(5)},${searchArea.center.lng.toFixed(5)},${searchArea.lengthNm},${searchArea.widthNm},${searchArea.orientationDeg}`
        : '-'
    }`,
    [points, searchArea],
  );
  useEffect(() => {
    setSpanNm(autoSpanNm(worksheetRadiusNm));
  }, [worksheetFitSig]);

  const applyAutoSpan = () => setSpanNm(autoSpanNm(contentRadiusNm));
  const isAutoSpan = spanNm === autoSpanNm(contentRadiusNm) || spanNm === autoSpanNm(worksheetRadiusNm);

  // Info skala aktif untuk panel samping (padanan perhitungan tick di UpsSheetView).
  const pxPerMinScreen = UPS_ROSE_R / spanNm;
  const pxPerMinLonScreen = pxPerMinScreen * Math.max(0.05, Math.cos((centerLat * Math.PI) / 180));
  const rulerMinorLat = pickTickStep(pxPerMinScreen, 13);
  const rulerMajorLat = pickMajorStep(rulerMinorLat, pxPerMinScreen, 52);
  const rulerMinorLon = pickTickStep(pxPerMinLonScreen, 13);

  // Mouse pan handlers (screen)
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
    setZoom((prev) => Math.min(UPS_ZOOM_MAX, Math.max(UPS_ZOOM_MIN, prev + delta)));
  };

  // Zoom roda mouse langsung di atas lembar. Listener native (bukan React
  // onWheel) karena React memasang wheel sebagai passive — preventDefault
  // akan diabaikan dan halaman ikut tergulir.
  useEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((prev) =>
        Math.min(UPS_ZOOM_MAX, Math.max(UPS_ZOOM_MIN, prev + (event.deltaY < 0 ? UPS_ZOOM_STEP_WHEEL : -UPS_ZOOM_STEP_WHEEL))),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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

  const printScope = usePrintScope('ups-plotter');

  return (
    <>
      <div
        ref={fsRef}
        className={`fs-target ${isFullscreen ? 'flex flex-col' : ''} ${className}`}
      >
      <Card className={`border-slate-300 shadow-sm bg-white overflow-hidden ${isFullscreen ? 'flex-1 min-h-0 py-0 gap-0' : ''}`}>
        <CardHeader className={`bg-slate-100/90 border-b border-slate-300 py-3 px-4 print:hidden ${isFullscreen ? 'hidden' : ''}`}>
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
              {/* Span NM selector + auto fit dari analisis kasus */}
              <div className="flex items-center gap-1.5 bg-white px-2 py-1 rounded border border-slate-300 text-xs shadow-2xs">
                <span className="text-slate-600 font-medium">Radius rose =</span>
                <select
                  value={spanNm}
                  onChange={(e) => setSpanNm(Number(e.target.value))}
                  className="font-bold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
                >
                  {UPS_SPAN_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}′{preset === UPS_ROSE_SPAN_MIN ? ' (skala asli lembar)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={applyAutoSpan}
                title="Skala otomatis: dianalisis dari jarak terjauh soal kasus agar pas di dalam lembar"
                className={`p-1.5 rounded border text-xs flex items-center gap-1 transition-colors ${
                  isAutoSpan
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                }`}
              >
                <Maximize2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Auto</span>
              </button>

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

              <FullscreenToggleButton
                isFullscreen={isFullscreen}
                onToggle={toggleFullscreen}
                label="Layar Penuh"
              />

              <SheetPrintMenu targetId="ups-plotter" docTitle="UPS VP-OS" />
            </div>
          </div>
        </CardHeader>

        <CardContent className={`flex flex-col xl:flex-row items-center gap-6 justify-center ${isFullscreen ? 'flex-1 min-h-0 w-full p-0' : 'p-4'}`}>
          {/* Lembar UPS interaktif (screen) — saat layar penuh memenuhi viewport
              tanpa rasio terkunci; SVG viewBox (xMidYMid meet) menjaga proporsi
              lembar sehingga selalu maksimal dan tidak gepeng. */}
          <div
            ref={sheetRef}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            className={`screen-only relative bg-white overflow-hidden select-none cursor-grab active:cursor-grabbing flex items-center justify-center ${
              isFullscreen
                ? 'w-full h-full flex-1 min-h-0 max-w-none rounded-none'
                : 'rounded-xl border border-slate-400 shadow-inner w-full max-w-[620px]'
            }`}
            style={isFullscreen ? undefined : { aspectRatio: `${VB_WIDTH} / ${VB_HEIGHT}` }}
          >
            <div
              className="sheet-zoom-wrap relative w-full h-full"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
              }}
            >
              <UpsSheetView
                centerLat={centerLat}
                centerLon={centerLon}
                displayPoints={displayPoints}
                vectorSegs={vectorSegs}
                searchArea={searchArea}
                spanNm={spanNm}
                variant="screen"
                showLabels={showCoordsBadge}
                selectedPointId={selectedPointId}
                fit="fill"
              />
            </div>

            {/* Bottom Overlay Badge on Map */}
            <div className="absolute bottom-2 left-2 bg-slate-900/85 backdrop-blur-xs text-white text-[11px] px-2.5 py-1 rounded border border-slate-700 shadow-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse" />
              <span className="font-semibold">Universal Plotting Sheet (VP-OS asli)</span>
              <span className="text-slate-400 font-mono">
                {spanNm === UPS_ROSE_SPAN_MIN ? 'skala asli 1′ = 1 NM' : `radius rose ${spanNm}′`}
              </span>
            </div>

            {/* Kontrol zoom mengambang: zoom in/out langsung di lembar (roda mouse
                juga didukung). Saat layar penuh ditambah Reset + Keluar karena
                header toolbar disembunyikan. */}
            <div className="absolute bottom-2 right-2 print:hidden flex items-center gap-0.5 bg-white/95 border border-slate-300 rounded shadow-sm overflow-hidden">
              <button
                type="button"
                onClick={() => handleZoom(UPS_ZOOM_STEP_BUTTON)}
                title="Perbesar (roda mouse ke atas di atas lembar)"
                aria-label="Perbesar lembar UPS"
                className="p-1.5 text-slate-700 hover:bg-slate-100"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <span className="text-[11px] font-mono px-1.5 text-slate-600 font-semibold select-none">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => handleZoom(-UPS_ZOOM_STEP_BUTTON)}
                title="Perkecil (roda mouse ke bawah di atas lembar)"
                aria-label="Perkecil lembar UPS"
                className="p-1.5 text-slate-700 hover:bg-slate-100"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              {isFullscreen && (
                <>
                  <button
                    type="button"
                    onClick={resetView}
                    title="Reset zoom & geseran"
                    aria-label="Reset tampilan lembar UPS"
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
                </>
              )}
            </div>
          </div>

          {/* Positions List & Coordinates — disembunyikan saat layar penuh:
              hanya lembar UPS beserta vektornya yang tampil. */}
          <div className={`screen-only w-full xl:w-80 space-y-4 ${isFullscreen ? 'hidden' : ''}`}>
            <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-3">
              <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Plot titik dan rute UPS</h4>
              <div className="rounded border border-slate-200 bg-slate-50 p-2">
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>Skala aktif: radius rose {spanNm}′ = {spanNm} NM</span>
                  <span className={isAutoSpan ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700'}>
                    {isAutoSpan ? 'auto · dari kasus' : 'manual'}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                  Analisis soal kasus: konten terjauh <strong>{contentRadiusNm.toFixed(1)} NM</strong> → rose {spanNm}′
                  (terisi {Math.min(999, Math.round((contentRadiusNm / spanNm) * 100))}% radius). Tick kecil: lintang
                  {' '}{rulerMinorLat}′ / bujur {rulerMinorLon}′ · label tiap {rulerMajorLat}′.
                </p>
                <svg
                  viewBox="0 0 240 24"
                  className="mt-1 h-6 w-full"
                  role="img"
                  aria-label={`Ruler skala aktif: tick minor tiap ${rulerMinorLat} menit busur, label tiap ${rulerMajorLat} menit`}
                >
                  <line x1="4" y1="19" x2="236" y2="19" stroke="#334155" strokeWidth="1" />
                  {Array.from({ length: (rulerMajorLat / rulerMinorLat) * 2 + 1 }, (_, index) => {
                    const major = index % (rulerMajorLat / rulerMinorLat) === 0;
                    const x = 4 + index * (232 / ((rulerMajorLat / rulerMinorLat) * 2));
                    return <line key={index} x1={x} y1={major ? 3 : 12} x2={x} y2="20" stroke={major ? '#9d174d' : '#d946ef'} strokeWidth={major ? 1.5 : 0.75} />;
                  })}
                  {[0, 1, 2].map((j) => (
                    <text
                      key={`lbl-${j}`}
                      x={j === 0 ? 4 : j === 2 ? 236 : 120}
                      y="11"
                      fontSize="7"
                      textAnchor={j === 0 ? 'start' : j === 2 ? 'end' : 'middle'}
                      fill="#9d174d"
                      fontWeight="bold"
                    >
                      {j * rulerMajorLat}′
                    </text>
                  ))}
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
              <p className="text-[10px] leading-relaxed text-amber-800">
                Koordinat dihitung pada elipsoid WGS-84. Kalibrasi lembar (pusat rose, radius 60′,
                pitch 1′ = 1 NM) diukur langsung dari scan asli VP-OS sehingga jarak terplot sesuai
                skala cetak lembar.
              </p>
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
                  const { xNm, yNm } = latLonToUPS(p.pos, centerLat, centerLon);
                  const distNm = Math.hypot(xNm, yNm);
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
                <li>Scan asli lembar <strong>VP-OS (Celestaire Universal Plotting Sheet)</strong> — landscape, 300 DPI.</li>
                <li>Skala asli lembar: <strong>1 tick = 1′ = 1 NM</strong>; radius rose mengikuti analisis soal kasus (tombol <strong>Auto</strong>). Tick skala adaptif warna <strong>magenta</strong>: lintang di tepi kiri/kanan lembar, bujur di sepanjang paralel — spacing menyesuaikan skala aktif; fan <strong>Longitude Scale</strong> asli tetap tersedia untuk pembanding.</li>
                <li>Hasil Aeronautical Drift (Glide & Parachute) memplot lintasan ke <strong>LKP</strong>; dari LKP lanjut ke <strong>Datum Left & Right</strong>.</li>
                <li><strong>Drag/geser</strong> untuk memindah lembar, <strong>zoom</strong> untuk detail kompas, <strong>Cetak lembar</strong> untuk PDF vektor A3/A4.</li>
              </ul>
            </div>
          </div>

          {/* Blok cetak fluid (Ctrl+P bawaan): lembar + header ringkas */}
          <div className="print-only print-companion-page w-full">
            <UpsPrintHeader
              title={title}
              spanNm={UPS_ROSE_SPAN_MIN}
              centerLat={centerLat}
              centerLon={centerLon}
            />
            <UpsSheetView
              centerLat={centerLat}
              centerLon={centerLon}
              displayPoints={displayPoints}
              vectorSegs={vectorSegs}
              searchArea={searchArea}
              spanNm={UPS_ROSE_SPAN_MIN}
              variant="print"
              showLabels
              fit="auto"
            />
          </div>
        </CardContent>
      </Card>
      </div>

      {/* Print Mode terpisah (menu Cetak lembar): portal blok cetak ke <body> */}
      {printScope && createPortal(
        <UpsPrintPortalBlock
          paper={printScope.paper}
          title={title}
          centerLat={centerLat}
          centerLon={centerLon}
          displayPoints={displayPoints}
          vectorSegs={vectorSegs}
          searchArea={searchArea}
          maxDistanceNm={maxDistanceNm}
        />,
        document.body,
      )}
    </>
  );
}

/* ==========================================================================
   UpsSheetView — lembar UPS (scan asli + overlay SVG vektor).
   variant 'screen': tampilan interaktif; variant 'print': selalu skala asli
   lembar (radius rose 60' = 1 tick = 1 NM) dengan ukuran label dicetak besar.
   ========================================================================== */

interface UpsSheetViewProps {
  centerLat: number;
  centerLon: number;
  displayPoints: UserPlotPoint[];
  vectorSegs: UpsVectorSeg[];
  searchArea: UpsSearchArea | null;
  spanNm: number;
  variant: 'screen' | 'print';
  showLabels: boolean;
  selectedPointId?: string | null;
  /** fill: isi kotak (aspek sama); height: tinggi penuh lebar otomatis; auto: lebar penuh tinggi otomatis; explicit: ukuran mm eksplisit */
  fit: 'fill' | 'height' | 'auto' | 'explicit';
  /** Ukuran eksplisit (mm) saat fit='explicit' — anti-quirk sizing svg. */
  explicitSizeMm?: { width: number; height: number };
}

function UpsSheetView({
  centerLat,
  centerLon,
  displayPoints,
  vectorSegs,
  searchArea,
  spanNm,
  variant,
  showLabels,
  selectedPointId = null,
  fit,
  explicitSizeMm,
}: UpsSheetViewProps) {
  const isPrint = variant === 'print';
  // Cetak selalu memakai skala asli lembar agar sesuai tick cetak VP-OS.
  const effectiveSpan = isPrint ? UPS_ROSE_SPAN_MIN : spanNm;
  const pxPerNm = UPS_ROSE_R / effectiveSpan; // 1 NM = 1 menit busur
  const k = isPrint ? 2 : 1; // pengali ketebalan/ukuran untuk cetak

  const toPx = (pos: LatLng) => {
    const { xNm, yNm } = latLonToUPS(pos, centerLat, centerLon);
    return { x: UPS_CX + xNm * pxPerNm, y: UPS_CY - yNm * pxPerNm, xNm, yNm };
  };

  const pointPixels = displayPoints.map((p) => ({ ...p, ...toPx(p.pos) }));

  // ---- Label vektor: rotasi mengikuti arah segmen, hindari tabrakan ----
  // Format: "Nama - arah/jarak" (contoh "Datum L - 50°/12.3 NM"), font proporsional
  // agar tidak tumpang tindih; segmen pendek digeser ke samping garisnya.
  const segLabelFont = isPrint ? 40 : 48;
  const segPixels = vectorSegs.map((seg) => ({
    seg,
    a: toPx(seg.from),
    b: toPx(seg.to),
    inv: upsInverse(seg.from, seg.to),
  }));
  const segPlacements: Map<string, LabelPlacement> = new Map();
  const segLabelText: Map<string, string> = new Map();
  if (segPixels.length > 0) {
    const items = segPixels.map(({ seg, a, b, inv }) => {
      const text = `${seg.name ? `${seg.name} - ` : ''}${Math.round(inv.bearingDeg) % 360}°/${inv.distanceNm.toFixed(1)} NM`;
      segLabelText.set(seg.key, text);
      return {
        id: seg.key,
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        label: text,
      };
    });
    const obstacleSegments = segPixels.map(({ seg, a, b }) => ({
      id: seg.key,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
    }));
    // Kotak tetap: label titik (LKP, datum, dsb.) tidak boleh tertutup label vektor.
    const staticObstacles: BoxObstacle[] = pointPixels.map((p) => {
      const shortLabel = p.short ?? p.label;
      if (isPrint) {
        // Cetak: teks halo horizontal, baseline di (p.x, p.y - 26)
        const w = shortLabel.length * 44 * 0.62 + 16;
        return { id: `pt-${p.id}`, x: p.x, y: p.y - 26 - 44 * 0.35, w, h: 44 * 1.3 };
      }
      // Layar: badge di atas pin — translate(p.x, p.y-18), rect y=-74..-10
      const w = Math.max(140, shortLabel.length * 30 + 44);
      return { id: `pt-${p.id}`, x: p.x, y: p.y - 58, w, h: 64 };
    });
    for (const pl of placeAlongLineLabels(items, {
      fontSize: segLabelFont,
      minPad: 10,
      obstacleSegments,
      staticObstacles,
      sceneCenter: { x: UPS_CX, y: UPS_CY },
    })) {
      segPlacements.set(pl.id, pl);
    }
  }

  const searchBox = useMemo(() => {
    if (!searchArea) return null;
    const c = toPx(searchArea.center);
    return {
      ...c,
      halfL: (searchArea.lengthNm / 2) * pxPerNm,
      halfW: (searchArea.widthNm / 2) * pxPerNm,
      angle: searchArea.orientationDeg,
    };
  }, [searchArea, pxPerNm, centerLat, centerLon, toPx]);

  const svgStyle = fit === 'fill'
    ? { width: '100%', height: '100%' }
    : fit === 'explicit'
      ? { width: `${explicitSizeMm?.width ?? 100}mm`, height: `${explicitSizeMm?.height ?? 100}mm` }
      : fit === 'height'
        ? { height: '100%', width: 'auto' }
        : { width: '100%', height: 'auto' };

  /* ---- Tick skala adaptif (magenta): garis kecil-kecil lintang & bujur sesuai skala aktif ----
     Lintang: kolom tick di tepi kiri & kanan lembar (bukan hanya tengah). Bujur: tick di
     sepanjang kelima paralel. Spacing dihitung dari effectiveSpan sehingga selalu cocok
     dengan skala yang dipakai menggambar (hasil analisis soal kasus). */
  const SCALE_TICK = '#be185d';
  const SCALE_LABEL = '#9d174d';
  const SCALE_LABEL_FONT = 36;
  const pxPerMinLat = pxPerNm; // 1' lintang = 1 NM
  const pxPerMinLon = pxPerNm * Math.max(0.05, Math.cos((centerLat * Math.PI) / 180));
  const tickGap = isPrint ? 12 : 13;
  const latMinor = pickTickStep(pxPerMinLat, tickGap);
  const latMajor = pickMajorStep(latMinor, pxPerMinLat, tickGap * 4);
  const lonMinor = pickTickStep(pxPerMinLon, tickGap);
  // Label bujur berjajar horizontal: jarak antarlabel ≥ lebar teks terpanjang (digit terjauh + tanda menit).
  const lonLabelGap = SCALE_LABEL_FONT * 0.62 * (String(Math.round(Math.min(UPS_CX - 90, VB_WIDTH - 90 - UPS_CX) / pxPerMinLon)).length + 1) + 16;
  const lonMajor = pickMajorStep(lonMinor, pxPerMinLon, Math.max(tickGap * 4, lonLabelGap));

  // Lima paralel printed scan (jarak 900 px = 60' skala asli) — dipakai sebagai baris tick bujur.
  const PARALLEL_YS = [UPS_CY - 1800, UPS_CY - 900, UPS_CY, UPS_CY + 900, UPS_CY + 1800];
  const latHalfMin = Math.floor(1800 / pxPerMinLat / latMinor) * latMinor;
  const lonHalfMin = Math.floor(Math.min(UPS_CX - 90, VB_WIDTH - 90 - UPS_CX) / pxPerMinLon / lonMinor) * lonMinor;

  const latTicks: { y: number; min: number; major: boolean }[] = [];
  for (let m = -latHalfMin; m <= latHalfMin; m += latMinor) {
    latTicks.push({ y: UPS_CY - m * pxPerMinLat, min: m, major: m % latMajor === 0 });
  }
  const lonTicks: { x: number; min: number; major: boolean }[] = [];
  for (let m = -lonHalfMin; m <= lonHalfMin; m += lonMinor) {
    lonTicks.push({ x: UPS_CX + m * pxPerMinLon, min: m, major: m % lonMajor === 0 });
  }
  // Zona fan Longitude Scale & barcode scan — tick/label tidak digambar di atasnya.
  const inFanBox = (x: number, y: number) => x > 2850 && y > 2740;
  const inBarcodeBox = (y: number) => y > 3180 && y < 3560;
  const LAT_COLS = [
    { key: 'lat-l', x: 72, labelX: 108, anchor: 'start' as const, skipLabel: inBarcodeBox },
    { key: 'lat-r', x: VB_WIDTH - 72, labelX: VB_WIDTH - 108, anchor: 'end' as const, skipLabel: (y: number) => y > 2740 },
  ];

  return (
    <svg
      viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      style={svgStyle}
      className={fit === 'fill' ? 'absolute inset-0 pointer-events-none' : 'block'}
      role="img"
      aria-label="Universal Plotting Sheet VP-OS asli dengan vektor hasil worksheet"
    >
      <defs>
        <filter id={`ups-glow-${variant}`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="3" floodColor="#000000" floodOpacity="0.35" />
        </filter>
        {[
          ['blue', '#2563eb'],
          ['cyan', '#0284c7'],
          ['red', '#dc2626'],
          ['wind', '#f97316'],
          ['para', '#7c3aed'],
          ['result', '#0f766e'],
        ].map(([id, color]) => (
          <marker
            key={id}
            id={`ups-arrow-${id}-${variant}`}
            viewBox="0 0 10 10"
            refX="7"
            refY="5"
            markerWidth={isPrint ? 8 : 6}
            markerHeight={isPrint ? 8 : 6}
            orient="auto-start-reverse"
          >
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={color} />
          </marker>
        ))}
      </defs>

      {/* Scan asli VP-OS: versi layar & versi cetak (native 300 DPI, tanpa filter) */}
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

      {/* ===== Tick skala adaptif (magenta) — mengikuti skala aktif, bukan skala cetak asli ===== */}
      <g aria-hidden="true">
        {/* Skala lintang: kolom tick di tepi kiri & kanan lembar */}
        {LAT_COLS.map((col) => (
          <g key={col.key}>
            <line x1={col.x} y1={PARALLEL_YS[0]} x2={col.x} y2={PARALLEL_YS[4]} stroke={SCALE_TICK} strokeWidth={1.4 * k} opacity={0.45} />
            {latTicks.map((t) => (
              <line
                key={`${col.key}-t${t.min}`}
                x1={col.x - (t.major ? 24 : 13) * k}
                y1={t.y}
                x2={col.x + (t.major ? 24 : 13) * k}
                y2={t.y}
                stroke={SCALE_TICK}
                strokeWidth={t.major ? 3.2 * k : 2.2 * k}
                opacity={t.major ? 0.95 : 0.6}
              />
            ))}
            {latTicks.filter((t) => t.major && !col.skipLabel(t.y)).map((t) => (
              <text
                key={`${col.key}-l${t.min}`}
                x={col.labelX}
                y={t.y + 10}
                textAnchor={col.anchor}
                fontSize={SCALE_LABEL_FONT}
                fontWeight="bold"
                fill={SCALE_LABEL}
                stroke="#ffffff"
                strokeWidth={7}
                paintOrder="stroke"
                style={{ paintOrder: 'stroke' }}
              >
                {`${Math.abs(t.min)}′`}
              </text>
            ))}
          </g>
        ))}
        {/* Skala bujur: tick di sepanjang kelima paralel */}
        {PARALLEL_YS.map((py) => (
          <g key={`lon-${py}`}>
            {lonTicks.filter((t) => !inFanBox(t.x, py)).map((t) => (
              <line
                key={`lon-${py}-t${t.min}`}
                x1={t.x}
                y1={py - (t.major ? 20 : 11) * k}
                x2={t.x}
                y2={py + (t.major ? 20 : 11) * k}
                stroke={SCALE_TICK}
                strokeWidth={t.major ? 3.2 * k : 2.2 * k}
                opacity={t.major ? 0.95 : 0.6}
              />
            ))}
          </g>
        ))}
        {/* Label menit bujur — hanya pada paralel tengah agar lembar tetap bersih */}
        {lonTicks.filter((t) => t.major && !inFanBox(t.x, UPS_CY)).map((t) => (
          <text
            key={`lon-l${t.min}`}
            x={t.x}
            y={UPS_CY + 50}
            textAnchor="middle"
            fontSize={SCALE_LABEL_FONT}
            fontWeight="bold"
            fill={SCALE_LABEL}
            stroke="#ffffff"
            strokeWidth={7}
            paintOrder="stroke"
            style={{ paintOrder: 'stroke' }}
          >
            {`${Math.abs(t.min)}′`}
          </text>
        ))}
      </g>

      {/* Segmen vektor — tanpa filter saat cetak agar tetap murni vektor di PDF */}
      <g filter={isPrint ? undefined : `url(#ups-glow-${variant})`}>
        {segPixels.map(({ seg, a, b }) => (
          <g key={seg.key}>
            {seg.halo && (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#ffffff" strokeWidth={seg.width * k + 4} opacity={0.9} />
            )}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={seg.color}
              strokeWidth={seg.width * k}
              strokeDasharray={seg.dash}
              markerEnd={`url(#ups-arrow-${seg.marker}-${variant})`}
            />
          </g>
        ))}
      </g>

      {/* Label vektor — dirotasi mengikuti arah segmen; segmen pendek digeser
          ke samping agar tidak menutupi vektor/label lain */}
      <g filter={isPrint ? undefined : `url(#ups-glow-${variant})`}>
        {segPixels.map(({ seg }) => {
          const pl = segPlacements.get(seg.key);
          if (!pl) return null;
          return (
            <g key={`seglbl-${seg.key}`} transform={`translate(${pl.x}, ${pl.y}) rotate(${pl.angleDeg})`}>
              <rect
                x={-pl.widthPx / 2}
                y={-pl.heightPx / 2}
                width={pl.widthPx}
                height={pl.heightPx}
                rx={8 * k}
                fill="#0f172a"
                fillOpacity="0.85"
                stroke={seg.color}
                strokeWidth={2 * k}
              />
              <text
                x="0"
                y={segLabelFont * 0.36}
                textAnchor="middle"
                fill="#ffffff"
                fontSize={segLabelFont}
                fontWeight="bold"
              >
                {segLabelText.get(seg.key) ?? ''}
              </text>
            </g>
          );
        })}
      </g>

      {/* Area pencarian */}
      {searchBox && (
        <g transform={`rotate(${searchBox.angle}, ${searchBox.x}, ${searchBox.y})`} filter={isPrint ? undefined : `url(#ups-glow-${variant})`}>
          <rect
            x={searchBox.x - searchBox.halfL}
            y={searchBox.y - searchBox.halfW}
            width={searchBox.halfL * 2}
            height={searchBox.halfW * 2}
            fill="#10b981"
            fillOpacity="0.12"
            stroke="#059669"
            strokeWidth={5 * k}
            strokeDasharray="16 10"
          />
          <line
            x1={searchBox.x - searchBox.halfL}
            y1={searchBox.y}
            x2={searchBox.x + searchBox.halfL}
            y2={searchBox.y}
            stroke="#059669"
            strokeWidth={2.5 * k}
            strokeDasharray="6 6"
            opacity={0.6}
          />
        </g>
      )}

      {/* Pin posisi & label */}
      {pointPixels.map((p) => (
        <g key={`pin-${p.id}`} filter={isPrint ? undefined : `url(#ups-glow-${variant})`}>
          {selectedPointId === p.id && (
            <circle cx={p.x} cy={p.y} r={15 * k} fill="none" stroke="#facc15" strokeWidth={4 * k} />
          )}
          <circle cx={p.x} cy={p.y} r={9 * k} fill={p.color} stroke="#ffffff" strokeWidth={2.5 * k} />
          <circle cx={p.x} cy={p.y} r={3 * k} fill="#ffffff" />
          {showLabels && (isPrint ? (
            // Cetak: label pendek horizontal di atas pin (terbaca normal pada lembar landscape)
            <text
              x={p.x}
              y={p.y - 26}
              textAnchor="middle"
              fontSize={44}
              fontWeight="bold"
              fill="#0f172a"
              stroke="#ffffff"
              strokeWidth={10}
              paintOrder="stroke"
              style={{ paintOrder: 'stroke' }}
            >
              {p.short ?? p.label}
            </text>
          ) : (
            <g transform={`translate(${p.x}, ${p.y - 18})`}>
              <rect
                x={-Math.max(140, (p.short ?? p.label).length * 30 + 44) / 2}
                y={-74}
                width={Math.max(140, (p.short ?? p.label).length * 30 + 44)}
                height={64}
                rx={10}
                fill="#0f172a"
                fillOpacity="0.9"
                stroke={p.color}
                strokeWidth="3"
              />
              <text x="0" y="-30" textAnchor="middle" fill="#ffffff" fontSize="48" fontWeight="bold">
                {p.short ?? p.label}
              </text>
            </g>
          ))}
        </g>
      ))}

      {/* Crosshair pusat rose */}
      <circle cx={UPS_CX} cy={UPS_CY} r={6 * k} fill="#dc2626" opacity={0.6} />
      <line x1={UPS_CX - 15 * k} y1={UPS_CY} x2={UPS_CX + 15 * k} y2={UPS_CY} stroke="#dc2626" strokeWidth={1.5 * k} />
      <line x1={UPS_CX} y1={UPS_CY - 15 * k} x2={UPS_CX} y2={UPS_CY + 15 * k} stroke="#dc2626" strokeWidth={1.5 * k} />
    </svg>
  );
}

/* ==========================================================================
   Header & blok cetak UPS
   ========================================================================== */

function UpsPrintHeader({
  title,
  spanNm,
  centerLat,
  centerLon,
}: {
  title: string;
  spanNm: number;
  centerLat: number;
  centerLon: number;
}) {
  return (
    <div className="mb-2 border-b-2 border-slate-800 pb-1.5 flex items-end justify-between gap-4">
      <div>
        <p className="text-[13pt] font-bold text-slate-900 leading-tight">{title}</p>
        <p className="text-[8pt] text-slate-600 font-mono">
          Mid-Latitude {formatDMS(centerLat, false)} · Central Meridian {formatDMS(centerLon, true)}
        </p>
      </div>
      <p className="text-[8pt] font-mono text-slate-700 text-right">
        Skala asli lembar: 1 tick = 1′ = 1 NM<br />Radius rose 60 NM · VP-OS Celestaire (scan asli)
      </p>
    </div>
  );
}

interface UpsPrintPortalProps {
  paper: 'a3' | 'a4';
  title: string;
  centerLat: number;
  centerLon: number;
  displayPoints: UserPlotPoint[];
  vectorSegs: UpsVectorSeg[];
  searchArea: UpsSearchArea | null;
  maxDistanceNm: number;
}

function UpsPrintPortalBlock({
  paper,
  centerLat,
  centerLon,
  displayPoints,
  vectorSegs,
  searchArea,
}: UpsPrintPortalProps) {
  const [wmm, hmm] = paperContentMm(paper);
  // Cetak HANYA satu lembar UPS penuh (permintaan pengguna): tanpa header,
  // tabel posisi terplot, atau keterangan lain. Lembar mengisi seluruh area
  // kertas landscape dengan proporsi asli (fit sisi terbatas).
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
      <UpsSheetView
        centerLat={centerLat}
        centerLon={centerLon}
        displayPoints={displayPoints}
        vectorSegs={vectorSegs}
        searchArea={searchArea}
        spanNm={UPS_ROSE_SPAN_MIN}
        variant="print"
        showLabels
        fit="explicit"
        explicitSizeMm={{ width: sheetW, height: sheetH }}
      />
    </div>
  );
}
