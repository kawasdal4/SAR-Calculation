'use client';

/**
 * STUDIO PETA HASIL SCAN — gambar hasil penghitungan worksheet, search pattern,
 * dan Transit Go/Back di atas PETA CETAK hasil scan milik pengguna.
 *
 * Alur:
 *  1. Upload peta scan (PNG/JPEG/WEBP/PDF ≤ 80 MB) → penyimpanan SEMENTARA
 *     (R2 bila dikonfigurasi, fallback disk lokal). File asli tidak pernah
 *     diubah/diregenerasi; khusus PDF ditambahkan raster halaman pertama
 *     untuk tampilan. Berkas terhapus otomatis saat refresh/tutup browser
 *     atau maksimum 6 jam.
 *  2. Kalibrasi georeferensi: klik ≥2 titik pada scan + isi koordinatnya
 *     (DMS/DM/desimal) → transformasi gambar↔geografi (similarity/affine).
 *  3. Overlay hasil worksheet digambar otomatis di atas scan (canvas).
 *  4. Cetak A3/A4 full-page margin minimal + text box pojok (LKP, A–D,
 *     Datum, CSP & Exit tiap SRU) dan Simpan PDF — tampilan identik.
 *
 * Semua state (peta, kalibrasi, gambar) SEMENTARA: hanya memori modul —
 * hilang saat refresh; tidak ada penyimpanan permanen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import jsPDF from 'jspdf';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Crosshair,
  FileDown,
  ImageUp,
  Loader2,
  Map as MapIcon,
  Plus,
  Printer,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import CoordinateInput from '@/components/sar/CoordinateInput';
import { formatDMS } from '@/lib/sar/coordFormat';
import { buildScanTransform, imagePointFromClick, type CalibrationPoint } from '@/lib/sar/scanCalib';
import { drawScanOverlay } from '@/lib/sar/scanDraw';
import {
  composeScanPrintPage,
  type ScanPrintBoxData,
  type ScanPrintPaper,
} from '@/lib/sar/scanPrint';
import { acquireTempMap, releaseTempMapClient } from '@/lib/sar/tempMapClient';
import {
  clearScanSession,
  readScanSession,
  writeScanSession,
} from '@/lib/sar/scanStudioSession';
import type { MapCircle, MapLine, MapMarker, MapPolygon } from '@/components/sar/SeaMap';
import type { TempMapInfo } from '@/lib/sar/tempMapStorage';

export interface ScannedChartStudioProps {
  /** Judul kartu, mis. "Peta Laut Hasil Scan". */
  title: string;
  /** Kunci sesi unik per lokasi studio: 'sea' | 'ws4-onc' | 'ws4-land'. */
  instanceKey: string;
  markers?: MapMarker[];
  lines?: MapLine[];
  polygons?: MapPolygon[];
  circles?: MapCircle[];
  legendItems?: Array<{ color: string; label: string; dashed?: boolean; shape?: 'line' | 'dot' }>;
  /** Data text box pojok saat cetak/PDF. */
  printData?: ScanPrintBoxData;
  height?: string;
}

interface PrintPreviewState {
  dataUrl: string;
  paper: ScanPrintPaper;
  orientation: 'landscape' | 'portrait';
  pageWidthMm: number;
  pageHeightMm: number;
  fileName: string;
}

const PAGE_STYLE_ID = 'scan-print-page-style';

// Batas zoom peta scan — dipakai slider DAN roda mouse agar konsisten.
const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
/** Sensitivitas roda mouse: faktor zoom = exp(-deltaY × ini). */
const ZOOM_WHEEL_FACTOR = 0.0022;

function injectPrintPageStyle(pageWidthMm: number, pageHeightMm: number): void {
  let style = document.getElementById(PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = PAGE_STYLE_ID;
    document.head.appendChild(style);
  }
  style.textContent = `@page { size: ${pageWidthMm}mm ${pageHeightMm}mm; margin: 0mm; }`;
}

function removePrintPageStyle(): void {
  document.getElementById(PAGE_STYLE_ID)?.remove();
}

function formatRemaining(expiresAtIso: string, nowMs: number): string {
  const remaining = new Date(expiresAtIso).getTime() - nowMs;
  if (remaining <= 0) return 'kedaluwarsa';
  const minutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours} j ${minutes % 60} m`;
  return `${minutes} menit`;
}

export default function ScannedChartStudio({
  title,
  instanceKey,
  markers,
  lines,
  polygons,
  circles,
  legendItems,
  printData,
  height = '480px',
}: ScannedChartStudioProps) {
  // --- State peta terunggah (sementara, di-hydrate dari sesi modul) -------
  const initialSession = useMemo(() => readScanSession(instanceKey), [instanceKey]);
  const [mapInfo, setMapInfo] = useState<TempMapInfo | null>(initialSession?.mapInfo ?? null);
  const [calibPoints, setCalibPoints] = useState<CalibrationPoint[]>(initialSession?.calibPoints ?? []);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageNatural, setImageNatural] = useState<{ width: number; height: number } | null>(null);

  // --- State kalibrasi -----------------------------------------------------
  const [calibMode, setCalibMode] = useState(false);
  const [pendingPx, setPendingPx] = useState<{ x: number; y: number } | null>(null);
  const [newLat, setNewLat] = useState(0);
  const [newLng, setNewLng] = useState(0);
  const [calibNotice, setCalibNotice] = useState<string | null>(null);

  // --- State tampilan ------------------------------------------------------
  const [zoom, setZoom] = useState(1);
  const [overlayOn, setOverlayOn] = useState(true);
  const [layers, setLayers] = useState({ markers: true, lines: true, polygons: true, circles: true });
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // --- Interaksi mouse: zoom roda + drag/pan (aktif juga saat fullscreen) --
  const [panning, setPanning] = useState(false);
  // Klik yang datang tepat setelah drag/pan bukan pemilihan titik kalibrasi.
  const dragGuardRef = useRef(false);
  // Poros zoom roda mouse: titik gambar di bawah kursor dipertahankan.
  const wheelAnchorRef = useRef<{ pxImg: number; pyImg: number; mx: number; my: number } | null>(null);

  // --- State cetak / PDF ---------------------------------------------------
  const [printOpen, setPrintOpen] = useState(false);
  const [printPaper, setPrintPaper] = useState<ScanPrintPaper>('a3');
  const [printOrientation, setPrintOrientation] = useState<'auto' | 'landscape' | 'portrait'>('auto');
  const [printMargin, setPrintMargin] = useState<'minimal' | 'none'>('minimal');
  const [printComposing, setPrintComposing] = useState(false);
  const [printPreview, setPrintPreview] = useState<PrintPreviewState | null>(null);
  const [printState, setPrintState] = useState<PrintPreviewState | null>(null);
  const [printError, setPrintError] = useState<string | null>(null);

  const transformResult = useMemo(() => buildScanTransform(calibPoints), [calibPoints]);
  const transform = transformResult.transform;

  // Hydrate ulang saat instanceKey berubah (pindah tab / studio lain).
  useEffect(() => {
    const session = readScanSession(instanceKey);
    setMapInfo(session?.mapInfo ?? null);
    setCalibPoints(session?.calibPoints ?? []);
    setImageLoaded(false);
    setImageNatural(null);
  }, [instanceKey]);

  // Simpan sesi (hanya memori modul) tiap perubahan peta/kalibrasi.
  useEffect(() => {
    if (mapInfo) writeScanSession(instanceKey, { mapInfo, calibPoints });
    else clearScanSession(instanceKey);
  }, [instanceKey, mapInfo, calibPoints]);

  // Tick hitung mundur kedaluwarsa (30 detik).
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Ukur lebar kontainer (fit-width).
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mapInfo]);

  // Ukuran tampil gambar (dipakai efek zoom roda mouse & bagian kalibrasi).
  const displayedScale = containerWidth > 0 && imageNatural ? (containerWidth * zoom) / imageNatural.width : 0;
  const displayedWidth = imageNatural ? imageNatural.width * displayedScale : 0;
  const displayedHeight = imageNatural ? imageNatural.height * displayedScale : 0;

  // Zoom dengan roda mouse pada kontainer peta — listener NATIVE non-passive:
  // React onWheel pasif, preventDefault diabaikan, kontainer overflow-auto ikut
  // menggulir sambil zoom. Juga berlaku di mode layar penuh. Zoom berporos di
  // bawah kursor (titik di bawah pointer tetap di bawah pointer).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !imageNatural || displayedScale <= 0) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * Math.exp(-dy * ZOOM_WHEEL_FACTOR)));
      if (next === zoom) return;
      const rect = el.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      wheelAnchorRef.current = {
        pxImg: (mx + el.scrollLeft) / displayedScale,
        pyImg: (my + el.scrollTop) / displayedScale,
        mx,
        my,
      };
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [mapInfo, imageNatural, displayedScale, zoom]);

  // Terapkan poros zoom roda mouse setelah ukuran tampil diperbarui.
  useEffect(() => {
    const el = containerRef.current;
    const anchor = wheelAnchorRef.current;
    if (!el || !anchor || displayedScale <= 0) return;
    wheelAnchorRef.current = null;
    el.scrollLeft = Math.max(0, anchor.pxImg * displayedScale - anchor.mx);
    el.scrollTop = Math.max(0, anchor.pyImg * displayedScale - anchor.my);
  }, [zoom, displayedScale]);

  // ---------------------------------------------------------------------
  // Upload / ganti / hapus peta
  // ---------------------------------------------------------------------
  const handleFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/maps/temp', { method: 'POST', body: form });
      const json = await res.json().catch(() => null) as { map?: TempMapInfo; error?: string } | null;
      if (!res.ok || !json?.map) {
        setUploadError(json?.error ?? `Upload gagal (HTTP ${res.status}).`);
        return;
      }
      if (mapInfo) releaseTempMapClient(mapInfo.id);
      setMapInfo(json.map);
      setCalibPoints([]);
      setImageLoaded(false);
      setImageNatural(null);
      setZoom(1);
      acquireTempMap(json.map.id);
    } catch (error) {
      setUploadError(`Upload gagal: ${(error as Error).message}`);
    } finally {
      setUploading(false);
    }
  }, [mapInfo]);

  const handleReplaceMap = useCallback(async () => {
    if (mapInfo) {
      await fetch(`/api/maps/temp/${mapInfo.id}`, { method: 'DELETE' }).catch(() => undefined);
      releaseTempMapClient(mapInfo.id);
    }
    setMapInfo(null);
    setCalibPoints([]);
    setImageLoaded(false);
    setImageNatural(null);
    setPrintPreview(null);
  }, [mapInfo]);

  const onFileChosen = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = '';
  }, [handleFile]);

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files ?? []).find((f) => /image\/(png|jpeg|webp)|application\/pdf/.test(f.type) || /\.(png|jpe?g|webp|pdf)$/i.test(f.name));
    if (file) void handleFile(file);
  }, [handleFile]);

  // ---------------------------------------------------------------------
  // Kalibrasi
  // ---------------------------------------------------------------------
  const handleMapClickForCalibration = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // Klik yang merupakan akhir dari drag/pan (posisi digeser) bukan pemilihan
    // titik kalibrasi — abaikan sekali lalu kosongkan guard.
    if (dragGuardRef.current) {
      dragGuardRef.current = false;
      return;
    }
    if (!calibMode || !imageNatural || displayedScale <= 0) return;
    const container = event.currentTarget;
    // Pakai rect ELEMEN IMG (bukan rect kontainer + scrollLeft/scrollTop):
    // rect img sudah mencerminkan posisi hasil scroll/zoom sehingga kebal
    // terhadap padding, perataan konten, dan lebar scrollbar kontainer;
    // skala dihitung dari ukuran tampil AKTUAL gambar (bukan murni state)
    // agar titik tidak terekam bergeser saat layout/zoom belum sinkron.
    const img = container.querySelector('img');
    if (!img) return;
    const imgRect = img.getBoundingClientRect();
    if (imgRect.width <= 0 || imgRect.height <= 0) return;
    const point = imagePointFromClick({
      clientX: event.clientX,
      clientY: event.clientY,
      rectLeft: imgRect.left,
      rectTop: imgRect.top,
      scrollLeft: 0,
      scrollTop: 0,
      scale: imgRect.width / imageNatural.width,
    });
    if (point.x < 0 || point.y < 0 || point.x > imageNatural.width || point.y > imageNatural.height) return;
    // Koordinat dialog SELALU kosong untuk titik baru — mewarisi nilai titik
    // sebelumnya membuat dua titik berkoordinat hampir sama → transform rusak.
    setNewLat(0);
    setNewLng(0);
    setCalibNotice(null);
    setPendingPx(point);
    setCalibMode(false);
  }, [calibMode, imageNatural, displayedScale]);

  // Seret (drag) mouse kiri untuk menggeser peta — pengganti scrollbar, aktif
  // juga saat mode kalibrasi dan layar penuh. Geser > 3 px dianggap drag:
  // klik yang mengakhiri drag tidak dihitung sebagai pemilihan titik
  // kalibrasi (guard kadaluarsa otomatis bila klik tidak terjadi).
  const handlePanStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!imageLoaded || event.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    // Abaikan mousedown pada zona scrollbar kontainer (ujung kanan/bawah) —
    // menggeser scrollbar bawaan tidak boleh ikut memicu pan.
    const zone = el.getBoundingClientRect();
    if (event.clientX - zone.left > zone.width - 18 || event.clientY - zone.top > zone.height - 18) return;
    event.preventDefault(); // cegah seleksi teks & drag gambar bawaan browser
    dragGuardRef.current = false;
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = el.scrollLeft;
    const startTop = el.scrollTop;
    let moved = false;
    setPanning(true);
    const onMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 3) moved = true;
      if (!moved) return;
      el.scrollLeft = Math.max(0, startLeft - dx);
      el.scrollTop = Math.max(0, startTop - dy);
    };
    const onEnd = () => {
      window.removeEventListener('mousemove', onMove);
      setPanning(false);
      if (moved) {
        dragGuardRef.current = true;
        window.setTimeout(() => {
          dragGuardRef.current = false;
        }, 250);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd, { once: true });
  }, [imageLoaded]);

  const commitCalibrationPoint = useCallback(() => {
    if (!pendingPx) return;
    const validLat = Math.abs(newLat) <= 90;
    const validLng = Math.abs(newLng) <= 180 && (newLat !== 0 || newLng !== 0);
    if (!validLat || !validLng) return;
    // Tolak koordinat yang sama dengan titik lain (dua titik berimpit geo →
    // transformasi gagal → overlay tidak tergambar sama sekali).
    if (calibPoints.some((pt) => Math.abs(pt.pos.lat - newLat) < 1e-6 && Math.abs(pt.pos.lng - newLng) < 1e-6)) {
      setCalibNotice('Koordinat sama dengan titik kalibrasi lain — pilih titik lain pada peta dan isi koordinatnya.');
      return;
    }
    setCalibPoints((points) => [
      ...points,
      {
        id: `k-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        px: { ...pendingPx },
        pos: { lat: newLat, lng: newLng },
        label: `Titik ${points.length + 1}`,
      },
    ]);
    setPendingPx(null);
    // Alur beruntun: langsung siap klik titik berikutnya (2-4 titik tanpa
    // menekan tombol kalibrasi ulang); keluar lewat tombol "batal".
    setCalibMode(true);
  }, [pendingPx, newLat, newLng, calibPoints]);

  const removeCalibrationPoint = useCallback((id: string) => {
    setCalibPoints((points) => points.filter((point) => point.id !== id));
  }, []);

  // ---------------------------------------------------------------------
  // Gambar overlay layar
  // ---------------------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !transform || displayedWidth <= 0 || displayedHeight <= 0) return;
    canvas.width = Math.max(Math.round(displayedWidth), 1);
    canvas.height = Math.max(Math.round(displayedHeight), 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawScanOverlay({
      ctx,
      transform,
      scale: displayedScale,
      markers,
      lines,
      polygons,
      circles,
      lineWidthUnit: 1,
      fontUnit: 1,
      layers,
    });
  }, [transform, displayedScale, displayedWidth, displayedHeight, markers, lines, polygons, circles, layers, imageLoaded]);

  const hasOverlayData = Boolean(
    (markers && markers.length > 0)
    || (lines && lines.length > 0)
    || (polygons && polygons.length > 0)
    || (circles && circles.length > 0),
  );

  // Diagnostik "overlay tidak muncul": transform valid tapi SEMUA posisi hasil
  // (marker/garis/polygon/lingkaran) tergambar di luar area gambar — hampir
  // pasti koordinat kalibrasi keliru (hemisfer terbalik, titik tertukar) atau
  // titik kalibrasi salah tempat. Tanpa peringatan ini overlay “hilang”
  // diam-diam karena digambar di luar batas kanvas.
  const overlayOutsideImage = useMemo(() => {
    if (!transform || !imageNatural) return false;
    const positions: Array<{ lat: number; lng: number }> = [];
    for (const marker of markers ?? []) positions.push(marker.position);
    for (const line of lines ?? []) positions.push(line.from, line.to);
    for (const polygon of polygons ?? []) positions.push(...polygon.points);
    for (const circle of circles ?? []) positions.push(circle.center);
    if (positions.length === 0) return false;
    const marginX = imageNatural.width * 0.05;
    const marginY = imageNatural.height * 0.05;
    return positions.every((pos) => {
      const px = transform.toPixel(pos);
      return (
        px.x < -marginX
        || px.x > imageNatural.width + marginX
        || px.y < -marginY
        || px.y > imageNatural.height + marginY
      );
    });
  }, [transform, imageNatural, markers, lines, polygons, circles]);

  // ---------------------------------------------------------------------
  // Pratinjau cetak / simpan PDF
  // ---------------------------------------------------------------------
  const composePage = useCallback((): PrintPreviewState | null => {
    if (!transform || !imageNatural || !mapInfo) return null;
    const image = containerRef.current?.querySelector('img') as HTMLImageElement | null;
    if (!image || !image.complete || !image.naturalWidth) return null;
    const composed = composeScanPrintPage({
      image,
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
      transform,
      markers,
      lines,
      polygons,
      circles,
      boxes: printData ?? {},
      paper: printPaper,
      orientation: printOrientation,
      dpi: 200,
      marginMm: printMargin === 'minimal' ? 3 : 0,
    });
    return {
      dataUrl: composed.canvas.toDataURL('image/jpeg', 0.94),
      paper: printPaper,
      orientation: composed.layout.orientation,
      pageWidthMm: composed.layout.pageWidthMm,
      pageHeightMm: composed.layout.pageHeightMm,
      fileName: composed.fileName,
    };
  }, [transform, imageNatural, mapInfo, markers, lines, polygons, circles, printData, printPaper, printOrientation, printMargin]);

  const handleBuildPreview = useCallback(() => {
    setPrintError(null);
    setPrintComposing(true);
    // Beri satu frame agar spinner tampil sebelum komposisi berat.
    window.setTimeout(() => {
      try {
        const preview = composePage();
        if (!preview) {
          setPrintError('Gagal menyusun halaman cetak — pastikan peta sudah termuat dan kalibrasi valid.');
          setPrintPreview(null);
        } else {
          setPrintPreview(preview);
        }
      } catch (error) {
        setPrintError(`Gagal menyusun halaman cetak: ${(error as Error).message}`);
      } finally {
        setPrintComposing(false);
      }
    }, 30);
  }, [composePage]);

  // Portal cetak + @page dinamis; bersih-bersih setelah afterprint.
  useEffect(() => {
    if (!printState) return;
    injectPrintPageStyle(printState.pageWidthMm, printState.pageHeightMm);
    document.documentElement.dataset.printScope = 'sheet';
    const timer = window.setTimeout(() => window.print(), 120);
    const cleanup = () => {
      window.removeEventListener('afterprint', cleanup);
      delete document.documentElement.dataset.printScope;
      removePrintPageStyle();
      setPrintState(null);
    };
    window.addEventListener('afterprint', cleanup);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', cleanup);
    };
  }, [printState]);

  const handleSavePdf = useCallback(() => {
    const preview = printPreview ?? composePage();
    if (!preview) return;
    const pdf = new jsPDF({
      orientation: preview.orientation,
      unit: 'mm',
      format: [preview.pageWidthMm, preview.pageHeightMm],
      compress: true,
    });
    pdf.addImage(preview.dataUrl, 'JPEG', 0, 0, preview.pageWidthMm, preview.pageHeightMm);
    pdf.save(`peta-scan-${instanceKey}-${preview.paper}-${preview.orientation}.pdf`);
  }, [printPreview, composePage, printPaper, instanceKey]);

  const handlePrint = useCallback(() => {
    const preview = printPreview ?? composePage();
    if (preview) setPrintState(preview);
  }, [printPreview, composePage]);

  // =====================================================================
  // Render
  // =====================================================================
  const calibStatus = calibPoints.length < 2
    ? { tone: 'warn' as const, text: `Kalibrasi ${calibPoints.length}/2 titik minimum` }
    : {
      tone: 'ok' as const,
      text: `Kalibrasi OK — ${calibPoints.length} titik (${transform?.kind === 'affine' ? 'affine LSQ' : transform?.kind === 'axis-affine' ? 'affine 2-titik' : 'similarity'})${transformResult.rmsPx != null && calibPoints.length >= 3 ? ` · RMS ${transformResult.rmsPx.toFixed(1)} px` : ''}`,
    };

  return (
    <div className="rounded-md border border-slate-300 bg-white" data-studio={instanceKey}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4 text-slate-700" />
          <div>
            <h4 className="text-sm font-bold text-slate-900">{title}</h4>
            <p className="text-[10px] text-slate-500">
              Upload peta hasil scan (PNG/JPG/WEBP/PDF ≤ 80 MB) → kalibrasi 2+ titik → hasil worksheet tergambar otomatis.
              Peta asli tidak diubah; hasil gambar sementara (hilang saat refresh).
            </p>
          </div>
        </div>
        {mapInfo && (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200" title="Berkas sementara dihapus otomatis saat browser di-refresh/ditutup atau maksimum 6 jam">
              <Clock className="h-3 w-3" />
              Terhapus: {formatRemaining(mapInfo.expiresAt, nowMs)} / refresh
            </span>
            <Button size="sm" variant="outline" onClick={() => void handleReplaceMap()} className="h-7 text-[11px]">
              <Trash2 className="h-3 w-3" /> Ganti peta
            </Button>
          </div>
        )}
      </div>

      {/* Upload */}
      {!mapInfo && (
        <div
          className="m-3 flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 animate-spin text-slate-500" />
          ) : (
            <ImageUp className="h-8 w-8 text-slate-500" />
          )}
          <div className="text-sm text-slate-700">
            {uploading ? 'Mengunggah peta…' : 'Tarik & lepas peta hasil scan di sini, atau'}
          </div>
          <label className="inline-flex">
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" className="sr-only" onChange={onFileChosen} disabled={uploading} />
            <Button size="sm" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
              Pilih berkas
            </Button>
          </label>
          <p className="max-w-md text-[10px] text-slate-500">
            PDF multi halaman: halaman pertama yang ditampilkan (file asli tetap utuh di penyimpanan sementara).
            Penyimpanan sementara otomatis terhapus saat refresh browser atau maksimum 6 jam.
          </p>
          {uploadError && (
            <div className="flex items-center gap-1.5 rounded bg-red-50 px-2 py-1 text-[11px] text-red-700 ring-1 ring-red-200">
              <AlertTriangle className="h-3.5 w-3.5" /> {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Peta + overlay */}
      {mapInfo && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-2">
            <Button
              size="sm"
              variant={calibMode ? 'default' : 'outline'}
              className="h-7 text-[11px]"
              onClick={() => setCalibMode((mode) => !mode)}
            >
              <Crosshair className="h-3 w-3" />
              {calibMode ? 'Klik titik di peta… (batal)' : 'Tambah titik kalibrasi'}
            </Button>
            <Button
              size="sm"
              variant={overlayOn ? 'default' : 'outline'}
              className="h-7 text-[11px]"
              onClick={() => setOverlayOn((value) => !value)}
              disabled={!hasOverlayData}
            >
              {overlayOn ? 'Overlay: aktif' : 'Overlay: nonaktif'}
            </Button>
            {(['markers', 'lines', 'polygons', 'circles'] as const).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={layers[key] ? 'outline' : 'ghost'}
                className="h-7 px-2 text-[10px] text-slate-600"
                onClick={() => setLayers((value) => ({ ...value, [key]: !value[key] }))}
                aria-pressed={layers[key]}
              >
                {key === 'markers' ? 'Titik' : key === 'lines' ? 'Garis/pola' : key === 'polygons' ? 'Area' : 'Lingkaran'}
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500">Zoom</span>
              <input
                type="range"
                min={ZOOM_MIN}
                max={ZOOM_MAX}
                step={0.1}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
                className="h-1.5 w-24 accent-slate-700"
                aria-label="Zoom peta scan"
              />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => setZoom(1)} title="Reset zoom">
                <RotateCcw className="h-3 w-3" />
              </Button>
              <span className="hidden sm:inline text-[10px] text-slate-400" title="Arahkan kursor ke peta lalu gulirkan roda mouse untuk zoom; tekan dan seret untuk menggeser peta">
                scroll = zoom · seret = geser
              </span>
              <Button size="sm" className="h-7 text-[11px]" onClick={() => { setPrintOpen(true); setPrintPreview(null); setPrintError(null); }} disabled={!transform}>
                <Printer className="h-3 w-3" /> Cetak / PDF
              </Button>
            </div>
          </div>

          {!transform && hasOverlayData && !calibMode && (
            <div className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="font-semibold">
                {calibPoints.length === 0
                  ? 'Vektor, search area, dan label siap digambar — kalibrasi dulu 2 titik pada peta: klik titik yang koordinatnya diketahui (mis. perpotongan garis koordinat), lalu isi koordinatnya.'
                  : `Kalibrasi ${calibPoints.length}/2 titik — tambah ${2 - calibPoints.length} titik lagi agar vektor, search area, dan label dapat digambar.`}
              </span>
              <Button size="sm" className="h-7 text-[11px]" onClick={() => setCalibMode(true)}>
                <Crosshair className="h-3 w-3" /> {calibPoints.length === 0 ? 'Mulai kalibrasi' : 'Lanjut kalibrasi'}
              </Button>
            </div>
          )}

          {calibMode && (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-800">
              Mode kalibrasi aktif — klik satu titik pada peta yang koordinatnya diketahui (mis. perpotongan garis
              koordinat/paralel), lalu isi koordinatnya pada dialog yang muncul.
            </div>
          )}

          {calibNotice && (
            <div className="border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-800">
              {calibNotice}
            </div>
          )}

          {!transform && calibPoints.length >= 2 && transformResult.error && (
            <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-700">
              {transformResult.error}
            </div>
          )}

          {transform && overlayOutsideImage && (
            <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-[11px] text-red-800">
              Hasil worksheet tergambar DI LUAR area peta ini — hampir pasti koordinat kalibrasi keliru
              (periksa tanda S/E: lintang selatan Indonesia negatif, bujur timur positif) atau titik tertukar.
              Hapus titik yang keliru pada panel kalibrasi di bawah, lalu kalibrasi ulang.
            </div>
          )}

          <div
            ref={containerRef}
            className={`relative w-full overflow-auto select-none bg-slate-100 ${
              calibMode ? 'cursor-crosshair' : panning ? 'cursor-grabbing' : imageLoaded ? 'cursor-grab' : ''
            }`}
            style={{ height }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            onClick={handleMapClickForCalibration}
            onMouseDown={handlePanStart}
            role="application"
            aria-label={`${title} — peta hasil scan dengan overlay hasil worksheet (gulir roda mouse untuk zoom, tekan dan seret untuk menggeser)`}
          >
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-slate-500" />
              </div>
            )}
            <div className="relative" style={{ width: displayedWidth || undefined, height: displayedHeight || undefined }}>
              <img
                src={mapInfo.displayUrl}
                alt={mapInfo.fileName}
                className="block select-none"
                style={{ width: displayedWidth || 'auto', height: displayedHeight || 'auto' }}
                draggable={false}
                onLoad={(event) => {
                  const img = event.currentTarget;
                  setImageNatural({ width: img.naturalWidth, height: img.naturalHeight });
                  setImageLoaded(true);
                }}
              />
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute left-0 top-0"
                style={{ width: displayedWidth || 0, height: displayedHeight || 0, opacity: overlayOn ? 1 : 0 }}
              />
              {/* Marker kalibrasi */}
              {calibPoints.map((point, index) => (
                <div
                  key={point.id}
                  className="pointer-events-none absolute flex flex-col items-center"
                  style={{ left: point.px.x * displayedScale, top: point.px.y * displayedScale, transform: 'translate(-50%, -50%)' }}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white ring-2 ring-white shadow">
                    {index + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Legenda */}
          {legendItems && legendItems.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-600">
              {legendItems.map((item) => (
                <span key={item.label} className="inline-flex items-center gap-1">
                  {item.shape === 'dot' ? (
                    <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: item.color }} />
                  ) : (
                    <span
                      className="inline-block w-4 border-t-2"
                      style={{ borderColor: item.color, borderTopStyle: item.dashed ? 'dashed' : 'solid' }}
                    />
                  )}
                  {item.label}
                </span>
              ))}
            </div>
          )}

          {/* Panel kalibrasi */}
          <div className="border-t border-slate-200 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-800">Kalibrasi georeferensi</span>
              {calibStatus.tone === 'ok' ? (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <CheckCircle2 className="h-3 w-3" /> {calibStatus.text}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 ring-1 ring-amber-200">
                  <AlertTriangle className="h-3 w-3" /> {calibStatus.text}
                </span>
              )}
              {calibPoints.length > 0 && (
                <span className="text-[10px] text-slate-500">
                  Saran: pilih 2 titik yang diagonal — beda lintang DAN bujur (mis. dua perpotongan graticule di dua sudut); 2 titik segaris pada satu garis graticule tidak bisa menentukan arah utara. Scan miring? Tambah titik ke-3 untuk koreksi affine.
                </span>
              )}
            </div>
            {calibPoints.length === 0 ? (
              <p className="mt-1 text-[10px] text-slate-500">
                Belum ada titik kalibrasi — hasil worksheet belum dapat digambar pada scan. Klik <b>Tambah titik kalibrasi</b> lalu klik titik pada peta.
              </p>
            ) : (
              <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto pr-1">
                {calibPoints.map((point, index) => {
                  const residual = transformResult.residualsPx.find((r) => r.id === point.id);
                  return (
                    <li key={point.id} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 text-[11px] text-slate-700">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[9px] font-bold text-white">{index + 1}</span>
                      <span className="font-medium">{point.label ?? `Titik ${index + 1}`}</span>
                      <span className="font-mono text-slate-600">
                        {formatDMS(point.pos.lat, false)} {formatDMS(point.pos.lng, true)}
                      </span>
                      <span className="ml-auto font-mono text-slate-400">
                        px ({Math.round(point.px.x)}, {Math.round(point.px.y)})
                        {residual && calibPoints.length >= 3 ? ` · Δ${residual.residualPx.toFixed(1)}px` : ''}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCalibrationPoint(point.id)}
                        className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        aria-label={`Hapus ${point.label ?? `Titik ${index + 1}`}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {!hasOverlayData && (
            <div className="border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-500">
              Hasil worksheet belum tersedia untuk digambar — atur LKP/Datum, pola pencarian, dan Transit SRU pada worksheet terkait.
            </div>
          )}
        </>
      )}

      {/* Dialog kalibrasi */}
      <Dialog open={pendingPx !== null} onOpenChange={(open) => { if (!open) setPendingPx(null); }}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="text-sm">Koordinat titik kalibrasi</DialogTitle>
            <DialogDescription className="text-xs">
              Posisi klik: px ({Math.round(pendingPx?.x ?? 0)}, {Math.round(pendingPx?.y ?? 0)}). Masukkan koordinat
              geografis titik tersebut pada peta (terima DMS <code>06°05′00″S</code>, DM, atau desimal <code>-6.083</code>).
              Lintang selatan Indonesia = negatif / akhiran <b>S</b>; bujur timur = positif / akhiran <b>E</b> —
              keliru hemisfer membuat hasil tergambar di luar peta.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="scan-calib-lat" className="text-xs">Lintang</Label>
              <CoordinateInput axis="lat" value={newLat} onChange={setNewLat} id="scan-calib-lat" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="scan-calib-lng" className="text-xs">Bujur</Label>
              <CoordinateInput axis="lng" value={newLng} onChange={setNewLng} id="scan-calib-lng" />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setPendingPx(null)}>Batal</Button>
            <Button size="sm" onClick={commitCalibrationPoint} disabled={newLat === 0 && newLng === 0}>
              <Plus className="h-3.5 w-3.5" /> Simpan titik
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cetak / PDF */}
      <Dialog open={printOpen} onOpenChange={(open) => { setPrintOpen(open); if (!open) setPrintPreview(null); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Cetak / Simpan PDF — {title}</DialogTitle>
            <DialogDescription className="text-xs">
              Halaman penuh A3/A4, margin minimal. Isi: peta asli hasil scan (utuh, sesuai tampilan asli) + text box
              pojok berisi koordinat LKP, titik A–D, Datum, CSP tiap SRU, dan Exit Point tiap SRU. Tanpa elemen lain.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Kertas</Label>
              <Select value={printPaper} onValueChange={(value) => { setPrintPaper(value as ScanPrintPaper); setPrintPreview(null); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">A4</SelectItem>
                  <SelectItem value="a3">A3</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Orientasi</Label>
              <Select value={printOrientation} onValueChange={(value) => { setPrintOrientation(value as 'auto' | 'landscape' | 'portrait'); setPrintPreview(null); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Otomatis (ikuti peta)</SelectItem>
                  <SelectItem value="landscape">Landscape</SelectItem>
                  <SelectItem value="portrait">Portrait</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Margin</Label>
              <Select value={printMargin} onValueChange={(value) => { setPrintMargin(value as 'minimal' | 'none'); setPrintPreview(null); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="minimal">Minimal (3 mm)</SelectItem>
                  <SelectItem value="none">Tanpa margin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleBuildPreview} disabled={!transform || printComposing}>
              {printComposing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
              Buat pratinjau
            </Button>
            {!transform && (
              <span className="text-[11px] text-amber-700">Kalibrasi belum valid (butuh ≥2 titik).</span>
            )}
          </div>

          {printError && (
            <div className="flex items-center gap-1.5 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700 ring-1 ring-red-200">
              <AlertTriangle className="h-3.5 w-3.5" /> {printError}
            </div>
          )}

          {printPreview && (
            <div className="space-y-2">
              <div className="max-h-[46vh] overflow-auto rounded border border-slate-300 bg-slate-100">
                <img src={printPreview.dataUrl} alt={`Pratinjau cetak ${printPreview.paper.toUpperCase()} ${printPreview.orientation}`} className="block w-full" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">
                  {printPreview.paper.toUpperCase()} {printPreview.orientation === 'landscape' ? 'landscape' : 'portrait'} ·
                  {' '}{printPreview.pageWidthMm}×{printPreview.pageHeightMm} mm · tampilan cetak = PDF
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={handleSavePdf}>
                    <FileDown className="h-3.5 w-3.5" /> Simpan PDF
                  </Button>
                  <Button size="sm" onClick={handlePrint}>
                    <Printer className="h-3.5 w-3.5" /> Cetak
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Portal cetak: satu halaman penuh, hanya muncul saat mencetak */}
      {printState && typeof document !== 'undefined' && createPortal(
        <div
          className="portal-print-sheet"
          style={{ width: `${printState.pageWidthMm}mm`, height: `${printState.pageHeightMm}mm`, background: '#ffffff' }}
        >
          <img
            src={printState.dataUrl}
            alt={`Cetak ${title}`}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'fill' }}
          />
        </div>,
        document.body,
      )}
    </div>
  );
}
