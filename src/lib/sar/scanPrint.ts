/**
 * Komposisi halaman CETAK/PDF untuk peta hasil scan (A3/A4, margin minimal).
 *
 * Aturan tampilan cetak (permintaan pemilik):
 *  - Luas peta = tampilan asli peta yang diunggah (fit utuh, tidak dipotong,
 *    tidak diregenerasi).
 *  - HANYA peta + text box di POJOK PETA berisi koordinat: LKP, titik A–D,
 *    Datum, CSP tiap SRU, Exit point tiap SRU. Tanpa elemen lain.
 *  - Full page, margin seminimal mungkin (default 3 mm, bisa 0).
 *
 * Fungsi murni (testable tanpa DOM): computeContainRect, buildCornerBoxLines,
 * resolveScanPrintLayout. composeScanPrintPage membutuhkan canvas.
 */

import type { LatLng } from './sarCalculations';
import { formatDMS } from './coordFormat';
import type { ScanTransform } from './scanCalib';
import type { MapCircle, MapLine, MapMarker, MapPolygon } from '@/components/sar/SeaMap';
import { drawScanOverlay } from './scanDraw';

export type ScanPrintPaper = 'a3' | 'a4';

/** Ukuran kertas [lebar, tinggi] mm tanpa orientasi (portrait). */
export const SCAN_PAPER_MM: Record<ScanPrintPaper, [number, number]> = {
  a4: [210, 297],
  a3: [297, 420],
};

export interface ScanPrintBoxData {
  lkp?: LatLng | null;
  datum?: LatLng | null;
  corners?: Array<{ label: string; pos: LatLng }>;
  sruCsp?: Array<{ sru: string; pos: LatLng | null }>;
  sruExit?: Array<{ sru: string; pos: LatLng | null }>;
}

export interface ScanPrintLayout {
  pageWidthMm: number;
  pageHeightMm: number;
  orientation: 'landscape' | 'portrait';
  dpi: number;
  marginMm: number;
}

/** Hitung kotak kontain (fit utuh, proporsi asli) di dalam kotak halaman. */
export function computeContainRect(
  imageWidth: number,
  imageHeight: number,
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number; width: number; height: number } {
  if (imageWidth <= 0 || imageHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) {
    return { x: boxX, y: boxY, width: 0, height: 0 };
  }
  const scale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: boxX + (boxWidth - width) / 2,
    y: boxY + (boxHeight - height) / 2,
    width,
    height,
  };
}

export function formatScanCoord(pos: LatLng): string {
  return `${formatDMS(pos.lat, false)} ${formatDMS(pos.lng, true)}`;
}

export interface CornerBoxLines {
  tl: string[];
  tr: string[];
  bl: string[];
  br: string[];
}

/**
 * Baris text box pojok peta. Grup kosong → kotaknya tidak digambar.
 *  TL: LKP + DATUM   TR: Titik A–D   BL: CSP SRU   BR: Exit Point SRU
 */
export function buildCornerBoxLines(boxes: ScanPrintBoxData): CornerBoxLines {
  const tl: string[] = [];
  if (boxes.lkp) tl.push(`LKP: ${formatScanCoord(boxes.lkp)}`);
  if (boxes.datum) tl.push(`DATUM: ${formatScanCoord(boxes.datum)}`);
  const tr = (boxes.corners ?? []).map((corner) => `${corner.label}: ${formatScanCoord(corner.pos)}`);
  const bl = (boxes.sruCsp ?? []).map((entry) =>
    entry.pos ? `CSP ${entry.sru}: ${formatScanCoord(entry.pos)}` : `CSP ${entry.sru}: —`,
  );
  const br = (boxes.sruExit ?? []).map((entry) =>
    entry.pos ? `EXIT ${entry.sru}: ${formatScanCoord(entry.pos)}` : `EXIT ${entry.sru}: —`,
  );
  return { tl, tr, bl, br };
}

/** Tentukan orientasi kertas: auto mengikuti proporsi gambar. */
export function resolveScanPrintLayout(
  paper: ScanPrintPaper,
  orientation: 'auto' | 'landscape' | 'portrait',
  imageWidth: number,
  imageHeight: number,
  dpi: number,
  marginMm: number,
): ScanPrintLayout {
  const [shortMm, longMm] = SCAN_PAPER_MM[paper];
  let landscape: boolean;
  if (orientation === 'landscape') landscape = true;
  else if (orientation === 'portrait') landscape = false;
  else landscape = imageWidth >= imageHeight;
  return {
    pageWidthMm: landscape ? longMm : shortMm,
    pageHeightMm: landscape ? shortMm : longMm,
    orientation: landscape ? 'landscape' : 'portrait',
    dpi,
    marginMm: Math.max(0, Math.min(marginMm, 12)),
  };
}

export interface ComposeScanPrintOptions {
  /** Sumber gambar peta asli (elemen img/bitmap — bukan hasil AI). */
  image: CanvasImageSource;
  /** Dimensi ASLI gambar (img.naturalWidth/Height atau bitmap) — bukan ukuran CSS. */
  imageWidth: number;
  imageHeight: number;
  transform: ScanTransform;
  markers?: MapMarker[];
  lines?: MapLine[];
  polygons?: MapPolygon[];
  circles?: MapCircle[];
  boxes: ScanPrintBoxData;
  paper: ScanPrintPaper;
  orientation?: 'auto' | 'landscape' | 'portrait';
  dpi?: number;
  marginMm?: number;
}

export interface ComposedScanPrintPage {
  canvas: HTMLCanvasElement;
  layout: ScanPrintLayout;
  fileName: string;
}

/** Susun SATU canvas = satu halaman cetak penuh (identik untuk print & PDF). */
export function composeScanPrintPage(options: ComposeScanPrintOptions): ComposedScanPrintPage {
  const {
    image,
    imageWidth,
    imageHeight,
    transform,
    markers,
    lines,
    polygons,
    circles,
    boxes,
    paper,
    orientation = 'auto',
    dpi = 200,
    marginMm = 3,
  } = options;
  const layout = resolveScanPrintLayout(paper, orientation, imageWidth, imageHeight, dpi, marginMm);
  const mmToPx = (mm: number) => (mm * dpi) / 25.4;
  const pageW = Math.round(mmToPx(layout.pageWidthMm));
  const pageH = Math.round(mmToPx(layout.pageHeightMm));
  const marginPx = mmToPx(layout.marginMm);

  const canvas = document.createElement('canvas');
  canvas.width = pageW;
  canvas.height = pageH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D tidak tersedia');

  // Latar putih penuh.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, pageW, pageH);

  // Gambar peta asli: fit utuh di dalam area konten (margin seminimal).
  const rect = computeContainRect(
    imageWidth,
    imageHeight,
    marginPx,
    marginPx,
    pageW - 2 * marginPx,
    pageH - 2 * marginPx,
  );
  ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);

  // Overlay hasil worksheet pada skala yang sama. Origin gambar di halaman
  // adalah rect (letterbox tengah) — TANPA offset ini overlay tergambar di
  // (0,0) halaman dan bergeser keluar peta sebesar jarak letterbox.
  const overlayScale = rect.width / imageWidth;
  drawScanOverlay({
    ctx,
    transform,
    scale: overlayScale,
    offset: { x: rect.x, y: rect.y },
    markers,
    lines,
    polygons,
    circles,
    lineWidthUnit: dpi / 96,
    fontUnit: dpi / 96,
    showLineLabels: true,
    showMarkerLabels: true,
  });

  // Text box koordinat di 4 POJOK PETA (di dalam area gambar).
  drawCornerBoxes(ctx, buildCornerBoxLines(boxes), rect, layout.dpi);

  const fileName = `peta-scan-${paper}${layout.orientation === 'landscape' ? '-l' : '-p'}.pdf`;
  return { canvas, layout, fileName };
}

/** Gambar keempat text box pojok (putih semi-transparan + garis tepi hitam tipis). */
export function drawCornerBoxes(
  ctx: CanvasRenderingContext2D,
  boxLines: CornerBoxLines,
  imageRect: { x: number; y: number; width: number; height: number },
  dpi: number,
): void {
  const unit = dpi / 96; // skala elemen tipografi relatif layar 96 dpi
  const fontPx = 8 * unit * (dpi / 72) / (dpi / 96); // 8pt pada dpi terkait
  const pad = 4 * unit;
  const inset = 2 * unit;
  const maxWidth = imageRect.width * 0.42;
  const lineHeight = fontPx * 1.45;

  interface BoxSpec {
    lines: string[];
    x: number;
    y: number;
    hAlign: 'left' | 'right';
    vAlign: 'top' | 'bottom';
  }
  const specs: BoxSpec[] = [
    { lines: boxLines.tl, x: imageRect.x + inset, y: imageRect.y + inset, hAlign: 'left', vAlign: 'top' },
    { lines: boxLines.tr, x: imageRect.x + imageRect.width - inset, y: imageRect.y + inset, hAlign: 'right', vAlign: 'top' },
    { lines: boxLines.bl, x: imageRect.x + inset, y: imageRect.y + imageRect.height - inset, hAlign: 'left', vAlign: 'bottom' },
    { lines: boxLines.br, x: imageRect.x + imageRect.width - inset, y: imageRect.y + imageRect.height - inset, hAlign: 'right', vAlign: 'bottom' },
  ];

  ctx.save();
  ctx.font = `500 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  for (const spec of specs) {
    if (spec.lines.length === 0) continue;
    // Bungkus baris terlalu panjang: pecah pada ": " pertama → 2 baris rata.
    const wrapped: string[] = [];
    for (const line of spec.lines) {
      ctx.font = `500 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      if (ctx.measureText(line).width <= maxWidth - 2 * pad || !line.includes(': ')) {
        wrapped.push(line);
      } else {
        const split = line.indexOf(': ');
        wrapped.push(line.slice(0, split + 1));
        wrapped.push(line.slice(split + 2));
      }
    }
    const widest = Math.max(...wrapped.map((line) => {
      ctx.font = `500 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      return ctx.measureText(line).width;
    }));
    const boxWidth = Math.min(widest + 2 * pad, maxWidth);
    const boxHeight = wrapped.length * lineHeight + 2 * pad;
    const x = spec.hAlign === 'left' ? spec.x : spec.x - boxWidth;
    const y = spec.vAlign === 'top' ? spec.y : spec.y - boxHeight;

    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = Math.max(1.2 * unit, 1);
    ctx.strokeRect(x, y, boxWidth, boxHeight);

    ctx.fillStyle = '#0f172a';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    wrapped.forEach((line, index) => {
      ctx.font = `500 ${fontPx}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillText(line, x + pad, y + pad + index * lineHeight);
    });
  }
  ctx.restore();
}
