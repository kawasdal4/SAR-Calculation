import { describe, expect, it } from 'bun:test';
import { buildScanTransform, type CalibrationPoint } from '../src/lib/sar/scanCalib';
import { computeContainRect } from '../src/lib/sar/scanPrint';
import { drawScanOverlay } from '../src/lib/sar/scanDraw';
import type { MapLine } from '../components/sar/SeaMap';
import type { ScanTransform } from '../src/lib/sar/scanCalib';

// ---------------------------------------------------------------------------
// Regression: overlay cetak/PDF bergeser keluar peta.
//
// composeScanPrintPage menggambar peta di dalam letterbox (computeContainRect)
// — origin gambar di halaman adalah rect.x/rect.y, BUKAN (0,0) kanvas. Dulu
// overlay digambar di (u*scale, v*scale) tanpa offset sehingga seluruh hasil
// worksheet bergeser sebesar jarak letterbox (bisa > 50 mm) dan jatuh di luar
// peta pada cetak & PDF — berlaku di studio Peta Laut, ONC, dan Peta Darat
// karena ketiganya memakai composeScanPrintPage yang sama.
// Perbaikan: drawScanOverlay menerima `offset` dan scanPrint mengirim
// { x: rect.x, y: rect.y }.
// ---------------------------------------------------------------------------

/** Mock CanvasRenderingContext2D: catat path & transform, no-op lainnya. */
function makeRecordingCtx() {
  const calls: Array<{ op: string; args: number[] }> = [];
  const record = (op: string) => (...args: number[]) => {
    calls.push({ op, args });
  };
  const ctx = {
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    arc: record('arc'),
    translate: record('translate'),
    transform: record('transform'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    setLineDash: record('setLineDash'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** Kalibrasi 2 titik pada peta 4000×2850 px (scan peta laut tipikal). */
function buildTwoPointTransform(): ScanTransform {
  const points: CalibrationPoint[] = [
    { id: 'k1', px: { x: 400, y: 2400 }, pos: { lat: -6.2, lng: 106.7 } },
    { id: 'k2', px: { x: 3600, y: 700 }, pos: { lat: -6.0, lng: 107.0 } },
  ];
  const result = buildScanTransform(points);
  if (!result.transform) throw new Error('transform 2 titik harus valid');
  return result.transform;
}

const IMAGE_W = 4000;
const IMAGE_H = 2850;

/** Garis pola pencarian di tengah peta (px gambar di dalam area peta). */
const patternLine: MapLine = {
  from: { lat: -6.15, lng: 106.8 },
  to: { lat: -6.05, lng: 106.95 },
  color: '#0f172a',
};

function firstSegment(calls: Array<{ op: string; args: number[] }>): number[] {
  const moveTo = calls.find((c) => c.op === 'moveTo');
  const lineTo = calls.find((c) => c.op === 'lineTo');
  if (!moveTo || !lineTo) throw new Error('garis tidak tergambar');
  return [moveTo.args[0], moveTo.args[1], lineTo.args[0], lineTo.args[1]];
}

describe('drawScanOverlay offset — overlay cetak/PDF menempel pada rect gambar', () => {
  const transform = buildTwoPointTransform();

  it('layar (tanpa offset): ujung garis = px gambar × scale', () => {
    const scale = 0.4;
    const { ctx, calls } = makeRecordingCtx();
    drawScanOverlay({ ctx, transform, scale, lines: [patternLine] });
    const [x1, y1] = firstSegment(calls);
    const u = transform.toPixel(patternLine.from);
    expect(x1).toBeCloseTo(u.x * scale, 6);
    expect(y1).toBeCloseTo(u.y * scale, 6);
  });

  it('cetak/PDF (dengan offset rect): ujung garis = rect + px gambar × scale dan jatuh DI DALAM area peta', () => {
    // A3 landscape, dpi 200, margin 3 mm — geometri composeScanPrintPage.
    const dpi = 200;
    const mmToPx = (mm: number) => (mm * dpi) / 25.4;
    const pageW = Math.round(mmToPx(420));
    const pageH = Math.round(mmToPx(297));
    const marginPx = mmToPx(3);
    const rect = computeContainRect(IMAGE_W, IMAGE_H, marginPx, marginPx, pageW - 2 * marginPx, pageH - 2 * marginPx);
    const overlayScale = rect.width / IMAGE_W;

    const { ctx, calls } = makeRecordingCtx();
    drawScanOverlay({
      ctx,
      transform,
      scale: overlayScale,
      offset: { x: rect.x, y: rect.y },
      lines: [patternLine],
    });
    const [x1, y1, x2, y2] = firstSegment(calls);
    const u = transform.toPixel(patternLine.from);
    const v = transform.toPixel(patternLine.to);
    expect(x1).toBeCloseTo(rect.x + u.x * overlayScale, 6);
    expect(y1).toBeCloseTo(rect.y + u.y * overlayScale, 6);
    expect(x2).toBeCloseTo(rect.x + v.x * overlayScale, 6);
    expect(y2).toBeCloseTo(rect.y + v.y * overlayScale, 6);
    // Seluruh garis berada DI DALAM rect peta (tidak keluar ke margin halaman).
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      expect(x).toBeGreaterThanOrEqual(rect.x);
      expect(x).toBeLessThanOrEqual(rect.x + rect.width);
      expect(y).toBeGreaterThanOrEqual(rect.y);
      expect(y).toBeLessThanOrEqual(rect.y + rect.height);
    }
  });

  it('regresi lama: TANPA offset, titik di dekat tepi kiri peta portrait jatuh DI LUAR rect peta (bug yang diperbaiki)', () => {
    // Scan portrait 3000×4000 pada A3 landscape → letterbox horizontal besar;
    // tanpa offset overlay tergambar ~100 mm di kiri peta (di luar peta).
    const dpi = 200;
    const mmToPx = (mm: number) => (mm * dpi) / 25.4;
    const pageW = Math.round(mmToPx(420));
    const pageH = Math.round(mmToPx(297));
    const marginPx = mmToPx(3);
    const rect = computeContainRect(3000, 4000, marginPx, marginPx, pageW - 2 * marginPx, pageH - 2 * marginPx);
    const overlayScale = rect.width / 3000;

    // Titik fitur pada 1/4 kiri-atas gambar (dekat tepi kiri peta).
    const featurePx = { x: 3000 * 0.25, y: 4000 * 0.25 };
    const drawnWithoutOffset = { x: featurePx.x * overlayScale, y: featurePx.y * overlayScale };
    const outsideOld =
      drawnWithoutOffset.x < rect.x || drawnWithoutOffset.y < rect.y;
    expect(outsideOld).toBe(true);

    const drawnWithOffset = {
      x: rect.x + featurePx.x * overlayScale,
      y: rect.y + featurePx.y * overlayScale,
    };
    expect(drawnWithOffset.x).toBeGreaterThanOrEqual(rect.x);
    expect(drawnWithOffset.y).toBeGreaterThanOrEqual(rect.y);
    expect(drawnWithOffset.x).toBeLessThanOrEqual(rect.x + rect.width);
    expect(drawnWithOffset.y).toBeLessThanOrEqual(rect.y + rect.height);
  });

  it('marker & lingkaran ikut digeser oleh offset', () => {
    const scale = 0.5;
    const offset = { x: 889, y: 24 };
    const { ctx, calls } = makeRecordingCtx();
    drawScanOverlay({
      ctx,
      transform,
      scale,
      offset,
      markers: [{ position: patternLine.from, label: 'LKP', showLabel: false }],
      circles: [{ center: patternLine.to, radiusNm: 1, color: '#dc2626' }],
    });
    // Lingkaran digambar sebelum marker; arc lingkaran beradius 1 (unit circle
    // pasca-transform), arc marker beradius 9*fontUnit — ambil yang > 1.5.
    const markerArc = calls.find((c) => c.op === 'arc' && c.args[2] > 1.5);
    if (!markerArc) throw new Error('marker tidak tergambar');
    const u = transform.toPixel(patternLine.from);
    expect(markerArc.args[0]).toBeCloseTo(offset.x + u.x * scale, 6);
    expect(markerArc.args[1]).toBeCloseTo(offset.y + u.y * scale, 6);
    // Lingkaran: pusatnya di-translate ke posisi beroffset.
    const translate = calls.find((c) => c.op === 'translate');
    if (!translate) throw new Error('lingkaran tidak tergambar');
    const v = transform.toPixel(patternLine.to);
    expect(translate.args[0]).toBeCloseTo(offset.x + v.x * scale, 6);
    expect(translate.args[1]).toBeCloseTo(offset.y + v.y * scale, 6);
  });
});
