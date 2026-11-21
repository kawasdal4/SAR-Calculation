import { describe, expect, it } from 'bun:test';
import {
  buildScanTransform,
  geoToLocalMeters,
  imagePointFromClick,
  localMetersToGeo,
  localOriginFor,
  metersPerDegLat,
  metersPerDegLng,
  type CalibrationPoint,
} from '../src/lib/sar/scanCalib';

const JKT = { lat: -6.1, lng: 106.75 };

describe('meters per degree', () => {
  it('nilai wajar di lintang Indonesia', () => {
    expect(metersPerDegLat(-6.1)).toBeGreaterThan(110_000);
    expect(metersPerDegLat(-6.1)).toBeLessThan(111_400);
    expect(metersPerDegLng(-6.1)).toBeGreaterThan(110_000);
    expect(metersPerDegLng(-6.1)).toBeLessThan(111_500);
  });
});

describe('round-trip meter lokal ⇄ lat/lon', () => {
  it('kembali ke titik awal', () => {
    const origin = localOriginFor([JKT, { lat: -5.9, lng: 107.2 }]);
    const pos = { lat: -6.05, lng: 106.9 };
    const m = geoToLocalMeters(pos, origin);
    const back = localMetersToGeo(m.x, m.y, origin);
    expect(Math.abs(back.lat - pos.lat)).toBeLessThan(1e-9);
    expect(Math.abs(back.lng - pos.lng)).toBeLessThan(1e-9);
  });
});

describe('similarity (2 titik) — rotasi + skala + translasi', () => {
  it('toPixel/toGeo round-trip pada scan yang diputar 5°', () => {
    // Peta "asli": transformasi bumi→gambar yang diketahui (putar 5°, skala 1.6 px/m, geser).
    const theta = (5 * Math.PI) / 180;
    const s = 1.6;
    const a = s * Math.cos(theta);
    const bTrue = s * Math.sin(theta);
    const tx = 320;
    const ty = 140;
    const toPx = (pos: { lat: number; lng: number }) => {
      const origin = localOriginFor([JKT]);
      const m = geoToLocalMeters(pos, origin);
      return { x: a * m.x - bTrue * m.y + tx, y: bTrue * m.x + a * m.y + ty };
    };
    const p1 = { lat: -6.2, lng: 106.6 };
    const p2 = { lat: -6.0, lng: 107.1 };
    const points: CalibrationPoint[] = [
      { id: 'k1', px: toPx(p1), pos: p1, label: 'K1' },
      { id: 'k2', px: toPx(p2), pos: p2, label: 'K2' },
    ];
    const result = buildScanTransform(points);
    expect(result.error).toBeNull();
    expect(result.transform).not.toBeNull();
    expect(result.transform!.kind).toBe('similarity');
    // Titik kalibrasi diproyeksikan tepat ke pixel sumber.
    for (const point of points) {
      const projected = result.transform!.toPixel(point.pos);
      expect(Math.abs(projected.x - point.px.x)).toBeLessThan(1e-6);
      expect(Math.abs(projected.y - point.px.y)).toBeLessThan(1e-6);
      const back = result.transform!.toGeo(point.px);
      expect(Math.abs(back.lat - point.pos.lat)).toBeLessThan(1e-9);
      expect(Math.abs(back.lng - point.pos.lng)).toBeLessThan(1e-9);
    }
    // Titik lain di luar sampel tetap konsisten dengan transformasi asli.
    const probe = { lat: -6.08, lng: 106.95 };
    const want = toPx(probe);
    const got = result.transform!.toPixel(probe);
    expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(0.01);
    // Residual nol karena 2 titik pas 4 parameter.
    expect(result.rmsPx).toBeCloseTo(0, 6);
  });

  it('gagal ramah untuk titik berdekatan', () => {
    const points: CalibrationPoint[] = [
      { id: 'a', px: { x: 10, y: 10 }, pos: { lat: -6.1, lng: 106.75 } },
      { id: 'b', px: { x: 12, y: 11 }, pos: { lat: -6.10001, lng: 106.75001 } },
    ];
    const result = buildScanTransform(points);
    expect(result.transform).toBeNull();
    expect(result.error).toContain('berdekatan');
  });
});

describe('affine LSQ (≥3 titik) — mengoreksi shear scan', () => {
  it('residual ~0 untuk 4 titik pada transformasi affine + shear', () => {
    const A = { a: 1.4, b: 0.12, c: -0.05, d: 1.7, tx: 90, ty: -40 };
    const origin = localOriginFor([JKT]);
    const toPx = (pos: { lat: number; lng: number }) => {
      const m = geoToLocalMeters(pos, origin);
      return { x: A.a * m.x + A.b * m.y + A.tx, y: A.c * m.x + A.d * m.y + A.ty };
    };
    const geo: Array<{ lat: number; lng: number }> = [
      { lat: -6.3, lng: 106.5 },
      { lat: -6.3, lng: 107.3 },
      { lat: -5.8, lng: 107.3 },
      { lat: -5.8, lng: 106.5 },
    ];
    const points: CalibrationPoint[] = geo.map((pos, i) => ({
      id: `k${i + 1}`,
      px: toPx(pos),
      pos,
      label: `K${i + 1}`,
    }));
    const result = buildScanTransform(points);
    expect(result.error).toBeNull();
    expect(result.transform!.kind).toBe('affine');
    expect(result.rmsPx!).toBeLessThan(1e-6);
    const probe = { lat: -6.02, lng: 106.88 };
    const want = toPx(probe);
    const got = result.transform!.toPixel(probe);
    expect(Math.hypot(got.x - want.x, got.y - want.y)).toBeLessThan(0.05);
  });

  it('terdeteksi untuk 3 titik segaris', () => {
    // Tiga titik pada satu garis lintang → matriks singular.
    const points: CalibrationPoint[] = [
      { id: 'a', px: { x: 0, y: 100 }, pos: { lat: -6.1, lng: 106.5 } },
      { id: 'b', px: { x: 100, y: 100 }, pos: { lat: -6.1, lng: 106.9 } },
      { id: 'c', px: { x: 200, y: 100 }, pos: { lat: -6.1, lng: 107.3 } },
    ];
    const result = buildScanTransform(points);
    expect(result.transform).toBeNull();
    expect(result.error).not.toBeNull();
  });
});

describe('kekurangan titik', () => {
  it('<2 titik → pesan minimum 2 titik', () => {
    const result = buildScanTransform([{ id: 'a', px: { x: 1, y: 2 }, pos: JKT }]);
    expect(result.transform).toBeNull();
    expect(result.error).toContain('minimal 2 titik');
    expect(buildScanTransform([]).error).toContain('minimal 2 titik');
  });
});

describe('imagePointFromClick — klik kontainer scan (scroll + zoom)', () => {
  const base = { rectLeft: 40, rectTop: 20 };

  it('tanpa scroll: posisi klik relatif kontainer ÷ skala', () => {
    const p = imagePointFromClick({
      ...base,
      clientX: 100,
      clientY: 50,
      scrollLeft: 0,
      scrollTop: 0,
      scale: 0.4,
    });
    expect(p.x).toBeCloseTo(150, 9);
    expect(p.y).toBeCloseTo(75, 9);
  });

  it('dengan scroll: offset scrollLeft/scrollTop WAJIB dihitung (bug lama: titik ternoda sebesar scroll)', () => {
    // Kontainer 460px menampilkan gambar 1200px — digulir 300 CSS px ke bawah.
    const p = imagePointFromClick({
      ...base,
      clientX: 100,
      clientY: 50,
      scrollLeft: 120,
      scrollTop: 300,
      scale: 0.4,
    });
    // Tanpa koreksi scroll hasilnya (150, 75) — SALAH; yang benar:
    expect(p.x).toBeCloseTo((100 - 40 + 120) / 0.4, 9);
    expect(p.y).toBeCloseTo((50 - 20 + 300) / 0.4, 9);
    expect(p.y).toBeGreaterThan(750); // jelas berbeda jauh dari (75) versi lama
  });

  it('skala zoom diperhitungkan (zoom 1.5 pada lebar kontainer 800 → scale 1.5)', () => {
    const p = imagePointFromClick({
      ...base,
      clientX: 220,
      clientY: 170,
      scrollLeft: 0,
      scrollTop: 0,
      scale: 1.5,
    });
    expect(p.x).toBeCloseTo(120, 9);
    expect(p.y).toBeCloseTo(100, 9);
  });

  it('titik klik tetap konsisten: px sama → toGeo sama, terlepas dari scroll', () => {
    // Titik gambar (900, 1100) diklik lewat scroll berbeda menghasilkan px sama.
    const viaScroll = imagePointFromClick({
      rectLeft: 0,
      rectTop: 0,
      clientX: 360,
      clientY: 440,
      scrollLeft: 0,
      scrollTop: 0,
      scale: 0.4,
    });
    const viaNoScroll = imagePointFromClick({
      rectLeft: 0,
      rectTop: 0,
      clientX: 360,
      clientY: 50,
      scrollLeft: 0,
      scrollTop: 390,
      scale: 0.4,
    });
    expect(viaScroll.x).toBeCloseTo(viaNoScroll.x, 9);
    expect(viaScroll.y).toBeCloseTo(viaNoScroll.y, 9);
    expect(viaScroll.x).toBeCloseTo(900, 9);
    expect(viaScroll.y).toBeCloseTo(1100, 9);
  });
});
