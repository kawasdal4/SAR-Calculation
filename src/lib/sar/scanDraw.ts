/**
 * Menggambar hasil worksheet (marker/garis/polygon/lingkaran) di atas peta
 * hasil scan pada sebuah canvas 2D. Dipakai BERSAMA oleh overlay layar
 * (ScannedChartStudio) dan komposisi cetak/PDF (scanPrint.ts) supaya tampilan
 * layar, cetak, dan PDF identik.
 *
 * Sistem koordinat:
 *  - `transform.toPixel(pos)` menghasilkan pixel pada GAMBAR ASLI.
 *  - `scale` mengonversi pixel gambar → pixel canvas (ukuran tampil / dpi cetak).
 *  - Ketebalan garis & huruf memakai `lineWidthUnit` (px canvas pada 96 dpi
 *    ekuivalen) sehingga proporsi layar ≡ cetak.
 */

import type { MapCircle, MapLine, MapMarker, MapPolygon } from '@/components/sar/SeaMap';
import type { ScanTransform } from './scanCalib';

export interface DrawScanOverlayOptions {
  ctx: CanvasRenderingContext2D;
  transform: ScanTransform;
  /** Pixel canvas per pixel gambar asli. */
  scale: number;
  /**
   * Offset canvas px yang ditambahkan SETELAH skala — origin rect gambar pada
   * kanvas. Dipakai komposisi cetak/PDF: peta digambar di dalam letterbox
   * (computeContainRect), jadi origin gambar TIDAK di (0,0) kanvas halaman.
   * Tanpa offset ini seluruh overlay tergeser sebesar jarak letterbox dan
   * jatuh di luar peta (di margin/pojok halaman) pada cetak & PDF.
   */
  offset?: { x: number; y: number };
  markers?: MapMarker[];
  lines?: MapLine[];
  polygons?: MapPolygon[];
  circles?: MapCircle[];
  /** Penyalinan warna/label mengikuti konvensi Peta Laut (page.tsx). */
  lineWidthUnit?: number;
  fontUnit?: number;
  showLineLabels?: boolean;
  showMarkerLabels?: boolean;
  /** Tampilkan hanya subset (toggle layer di UI). */
  layers?: { markers?: boolean; lines?: boolean; polygons?: boolean; circles?: boolean };
}

function parseDash(dashArray: string | null | undefined, unit: number): number[] | null {
  if (!dashArray) return null;
  const parts = dashArray.split(/[\s,]+/).map((v) => parseFloat(v)).filter((v) => Number.isFinite(v) && v >= 0);
  if (parts.length === 0) return null;
  return parts.map((v) => Math.max(v * unit, 0.5));
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const wing = 0.45;
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - wing), to.y - size * Math.sin(angle - wing));
  ctx.lineTo(to.x - size * Math.cos(angle + wing), to.y - size * Math.sin(angle + wing));
  ctx.closePath();
  ctx.fill();
}

function haloText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontPx: number,
  color = '#0f172a',
  align: CanvasTextAlign = 'center',
): void {
  ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = Math.max(fontPx * 0.28, 2);
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Gambar overlay hasil worksheet pada canvas (urutan: polygon → lingkaran → garis → marker). */
export function drawScanOverlay(options: DrawScanOverlayOptions): void {
  const {
    ctx,
    transform,
    scale,
    offset,
    markers,
    lines,
    polygons,
    circles,
    lineWidthUnit = 1,
    fontUnit = lineWidthUnit,
    showLineLabels = true,
    showMarkerLabels = true,
    layers,
  } = options;
  // Offset origin gambar pada kanvas halaman cetak (0,0 pada overlay layar).
  const ox = offset?.x ?? 0;
  const oy = offset?.y ?? 0;
  const showLines = layers?.lines !== false;
  const showMarkers = layers?.markers !== false;
  const showPolygons = layers?.polygons !== false;
  const showCircles = layers?.circles !== false;

  const toCtx = (pos: { lat: number; lng: number }): { x: number; y: number } => {
    const p = transform.toPixel(pos);
    return { x: p.x * scale + ox, y: p.y * scale + oy };
  };

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // 1) Polygon area pencarian (isi + garis tepi)
  if (showPolygons) {
    for (const polygon of polygons ?? []) {
      if (!polygon.points || polygon.points.length < 2) continue;
      ctx.beginPath();
      polygon.points.forEach((point, index) => {
        const p = toCtx(point);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      if (polygon.fillColor) {
        ctx.fillStyle = polygon.fillColor;
        ctx.globalAlpha = polygon.fillOpacity ?? 0.15;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = polygon.color ?? '#0f172a';
      ctx.lineWidth = Math.max(1.6 * lineWidthUnit, 1);
      ctx.stroke();
    }
  }

  // 2) Lingkaran (de, De, R) — radius NM → meter → px via matriks transformasi
  if (showCircles) {
    for (const circle of circles ?? []) {
      if (!(circle.radiusNm > 0)) continue;
      const center = toCtx(circle.center);
      const radiusMeters = circle.radiusNm * 1852;
      const m = transform.metersToPx;
      // offset px untuk offset meter (mx,my) = (a*mx + b*my, c*mx + d*my) —
      // lingkaran meter → elips px; ctx.transform menangani skala + shear.
      const r = radiusMeters * scale;
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.transform(r * m.a, r * m.c, r * m.b, r * m.d, 0, 0);
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.restore();
      const dash = parseDash(circle.dashArray ?? '3 3', lineWidthUnit);
      ctx.setLineDash(dash ?? []);
      ctx.strokeStyle = circle.color ?? '#dc2626';
      ctx.lineWidth = Math.max((circle.weight ?? 1.5) * lineWidthUnit, 0.8);
      ctx.stroke();
      ctx.setLineDash([]);
      if (circle.fillColor) {
        ctx.fillStyle = circle.fillColor;
        ctx.globalAlpha = circle.fillOpacity ?? 0.08;
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.transform(r * m.a, r * m.c, r * m.b, r * m.d, 0, 0);
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.restore();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (circle.label) {
        haloText(ctx, circle.label, center.x, center.y, 10 * fontUnit, circle.color ?? '#0f172a');
      }
    }
  }

  // 3) Garis: pola pencarian, vektor WS1, Transit Go/Back
  if (showLines) {
    for (const line of lines ?? []) {
      const from = toCtx(line.from);
      const to = toCtx(line.to);
      const dash = line.dashed ? [7 * lineWidthUnit, 5 * lineWidthUnit] : parseDash(null, lineWidthUnit);
      ctx.setLineDash(dash ?? []);
      ctx.strokeStyle = line.color ?? '#0f172a';
      ctx.lineWidth = Math.max((line.weight ?? 1.8) * lineWidthUnit, 1);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (line.arrow) {
        ctx.fillStyle = line.color ?? '#0f172a';
        drawArrowHead(ctx, from, to, 8 * lineWidthUnit);
      }
      if (showLineLabels && line.label) {
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        let angle = Math.atan2(to.y - from.y, to.x - from.x);
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        ctx.save();
        ctx.translate(mid.x, mid.y);
        ctx.rotate(angle);
        haloText(ctx, line.label, 0, -8 * fontUnit, 10 * fontUnit);
        ctx.restore();
      }
    }
  }

  // 4) Marker titik (LKP, Datum, A–D, CSP/Exit, waypoint) — gaya Peta Laut
  if (showMarkers) {
    for (const marker of markers ?? []) {
      const p = toCtx(marker.position);
      const color = marker.color ?? '#e11d48';
      const cross = marker.cross === true;
      const isStart = marker.isStart === true;
      const radius = (cross ? 13 : isStart ? 11 : 9) * fontUnit;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = Math.max(2 * lineWidthUnit, 1.2);
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      const glyph = marker.sequence !== undefined
        ? String(marker.sequence)
        : cross
          ? '✕'
          : isStart
            ? '◆'
            : marker.isDatum
              ? '◉'
              : '';
      if (glyph) {
        ctx.font = `bold ${Math.round(radius * (marker.sequence !== undefined ? 1 : 1.15))}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(glyph, p.x, p.y + radius * 0.04);
      }
      if (showMarkerLabels && (marker.showLabel || marker.sequence !== undefined) && marker.label) {
        haloText(ctx, marker.label, p.x + radius + 6 * fontUnit, p.y - radius - 2 * fontUnit, 11 * fontUnit, '#0f172a', 'left');
      }
    }
  }

  ctx.restore();
}
