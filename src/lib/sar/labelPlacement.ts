/**
 * labelPlacement — penempatan label vektor yang mengikuti rotasi vektornya.
 *
 * Aturan (permintaan pengguna):
 *  1. Rotasi label mengikuti sudut vektor terkait (teks sejajar garis, tidak
 *     pernah terbaca terbalik — otomatis dibalik 180° bila menghadap bawah).
 *  2. Ukuran font cukup besar agar terbaca (ditentukan pemanggil per medium).
 *  3. Vektor pendek: label digeser ke samping garis (tegak lurus, menjauhi
 *     pusat scene) sehingga tidak menutupi vektor lain maupun label lain.
 *     Kandidat posisi diuji tabrakan (OBB vs OBB, OBB vs garis) secara
 *     berurutan; kandidat pertama yang bebas tabrakan dipakai.
 *
 * Semua fungsi murni (pure) — aman untuk SSR dan mudah diuji.
 */

export interface LabelSegmentInput {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  /** Baris label opsional (2 baris untuk label panjang) — dipakai untuk estimasi kotak. */
  lines?: string[];
}

export interface LabelPlacement {
  id: string;
  /** Pusat kotak label (px ruang koordinat SVG/peta). */
  x: number;
  y: number;
  /** Sudut rotasi teks dalam derajat — sejajar vektor, selalu mudah dibaca. */
  angleDeg: number;
  /** Estimasi lebar & tinggi kotak label (px). */
  widthPx: number;
  heightPx: number;
  /** true bila label muat di atas garisnya sendiri (vektor cukup panjang). */
  fitsOnLine: boolean;
}

export interface SegmentObstacle {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  id?: string;
}

export interface BoxObstacle {
  x: number;
  y: number;
  w: number;
  h: number;
  angleDeg?: number;
  id?: string;
}

interface Obb {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angleRad: number;
}

/** Perkiraan lebar rata-rata karakter untuk teks sans bold (fraksi fontSize). */
const AVG_CHAR_W = 0.62;

function normalizeAngleDeg(deg: number): number {
  let a = ((deg + 180) % 360 + 360) % 360 - 180;
  if (a === -180) a = 180;
  return a;
}

/** Sudut segmen dalam derajat, dibalik bila teks akan terbaca terbalik. */
export function readableAngleDeg(x1: number, y1: number, x2: number, y2: number): number {
  const deg = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  const flipped = deg > 90 || deg <= -90 ? deg + 180 : deg;
  return normalizeAngleDeg(flipped);
}

function obbCorners(o: Obb): Array<[number, number]> {
  const cos = Math.cos(o.angleRad);
  const sin = Math.sin(o.angleRad);
  const hw = o.w / 2;
  const hh = o.h / 2;
  return [
    [o.cx + cos * hw - sin * hh, o.cy + sin * hw + cos * hh],
    [o.cx + cos * hw + sin * hh, o.cy + sin * hw - cos * hh],
    [o.cx - cos * hw + sin * hh, o.cy - sin * hw - cos * hh],
    [o.cx - cos * hw - sin * hh, o.cy - sin * hw + cos * hh],
  ];
}

function projectCorners(corners: Array<[number, number]>, ax: number, ay: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of corners) {
    const p = x * ax + y * ay;
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

/** SAT overlap test untuk dua kotak berrotasi (OBB). */
function obbOverlap(a: Obb, b: Obb): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes: Array<[number, number]> = [];
  for (const [pa, pb] of [
    [ca[0], ca[1]],
    [ca[1], ca[2]],
    [cb[0], cb[1]],
    [cb[1], cb[2]],
  ]) {
    const ax = -(pb[1] - pa[1]);
    const ay = pb[0] - pa[0];
    const len = Math.hypot(ax, ay) || 1;
    axes.push([ax / len, ay / len]);
  }
  for (const [ax, ay] of axes) {
    const [amin, amax] = projectCorners(ca, ax, ay);
    const [bmin, bmax] = projectCorners(cb, ax, ay);
    if (amax < bmin || bmax < amin) return false;
  }
  return true;
}

function pointInObb(o: Obb, px: number, py: number): boolean {
  const cos = Math.cos(-o.angleRad);
  const sin = Math.sin(-o.angleRad);
  const dx = px - o.cx;
  const dy = py - o.cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return Math.abs(lx) <= o.w / 2 && Math.abs(ly) <= o.h / 2;
}

function segmentHitsObb(seg: SegmentObstacle, o: Obb, step: number): boolean {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const len = Math.hypot(dx, dy);
  const n = Math.max(2, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (pointInObb(o, seg.x1 + dx * t, seg.y1 + dy * t)) return true;
  }
  return false;
}

export interface PlaceOptions {
  fontSize: number;
  /** Jarak minimum label dari garisnya sendiri saat digeser ke samping (px). */
  minPad?: number;
  /** Padding horizontal dalam kotak label (px). */
  padX?: number;
  /** Garis-garis vektor lain yang tidak boleh tertutup label (px). */
  obstacleSegments?: SegmentObstacle[];
  /** Kotak tetap yang tidak boleh tertutup (mis. label titik) (px). */
  staticObstacles?: BoxObstacle[];
  /** Pusat scene — sisi geser label dipilih menjauhi titik ini. */
  sceneCenter?: { x: number; y: number };
}

/**
 * Hitung penempatan label untuk seluruh segmen. Diproses berurutan; label yang
 * sudah ditempatkan menjadi penghalang bagi label berikutnya.
 */
export function placeAlongLineLabels(
  items: LabelSegmentInput[],
  opts: PlaceOptions,
): LabelPlacement[] {
  const { fontSize, minPad = 4, padX = 8 } = opts;
  const placed: Obb[] = [];
  const result: LabelPlacement[] = [];

  for (const item of items) {
    const dx = item.x2 - item.x1;
    const dy = item.y2 - item.y1;
    const len = Math.hypot(dx, dy);
    const angle = readableAngleDeg(item.x1, item.y1, item.x2, item.y2);
    const angleRad = (angle * Math.PI) / 180;
    const lines = item.lines?.length ? item.lines : [item.label];
    const maxLineLen = Math.max(...lines.map((line) => line.length));
    const widthPx = maxLineLen * fontSize * AVG_CHAR_W + padX * 2;
    const heightPx = lines.length * fontSize * 1.42 + (lines.length - 1) * fontSize * 0.3;
    const midX = (item.x1 + item.x2) / 2;
    const midY = (item.y1 + item.y2) / 2;
    const fitsOnLine = len >= widthPx + fontSize * 0.8 && len > 0;

    // Vektor satuan arah & tegak lurusnya.
    const ux = len > 0 ? dx / len : 1;
    const uy = len > 0 ? dy / len : 0;
    const px = -uy;
    const py = ux;

    // Sisi geser awal: menjauhi pusat scene (atau default ke atas).
    let side = 1;
    if (opts.sceneCenter) {
      const toMidX = midX - opts.sceneCenter.x;
      const toMidY = midY - opts.sceneCenter.y;
      side = toMidX * px + toMidY * py >= 0 ? 1 : -1;
    } else {
      side = py < 0 ? 1 : -1; // default: lebih dekat ke atas layar
    }

    // Kandidat posisi: di garis (bila muat) → samping prefer → samping
    // oposisi → offset lebih jauh → digeser sepanjang garis.
    const offsets: number[] = fitsOnLine
      ? [0, side * (heightPx / 2 + minPad), -side * (heightPx / 2 + minPad),
         side * (heightPx * 1.1 + minPad), -side * (heightPx * 1.1 + minPad)]
      : [side * (heightPx / 2 + minPad), -side * (heightPx / 2 + minPad),
         side * (heightPx * 1.1 + minPad), -side * (heightPx * 1.1 + minPad),
         side * (heightPx * 1.9 + minPad)];
    const alongShifts = fitsOnLine ? [0] : [0, len * 0.45, -len * 0.45];

    let chosen: Obb | null = null;
    let fallback: Obb | null = null;
    outer:
    for (const along of alongShifts) {
      for (const off of offsets) {
        const cx = midX + ux * along + px * off;
        const cy = midY + uy * along + py * off;
        const obb: Obb = { cx, cy, w: widthPx, h: heightPx, angleRad };
        if (!fallback) fallback = obb;
        // Tabrakan dengan label yang sudah dipasang?
        const hitsLabel = placed.some((o) => obbOverlap(obb, o));
        if (hitsLabel) continue;
        // Tabrakan dengan garis vektor lain?
        const others = (opts.obstacleSegments ?? []).filter((s) => s.id !== item.id);
        const hitsLine = others.some((s) => segmentHitsObb(s, obb, 8));
        if (hitsLine) continue;
        // Tabrakan dengan kotak tetap (label titik dsb.)?
        const hitsStatic = (opts.staticObstacles ?? []).some((b) =>
          obbOverlap(obb, {
            cx: b.x,
            cy: b.y,
            w: b.w,
            h: b.h,
            angleRad: ((b.angleDeg ?? 0) * Math.PI) / 180,
          }));
        if (hitsStatic) continue;
        chosen = obb;
        break outer;
      }
    }

    const finalObb = chosen ?? fallback ?? { cx: midX, cy: midY, w: widthPx, h: heightPx, angleRad };
    placed.push(finalObb);
    result.push({
      id: item.id,
      x: finalObb.cx,
      y: finalObb.cy,
      angleDeg: angle,
      widthPx,
      heightPx,
      fitsOnLine,
    });
  }

  return result;
}

/**
 * Pecah label panjang menjadi maksimal 2 baris agar lencana rotated tetap
 * proporsional di atas vektor. Label pendek dikembalikan apa adanya.
 */
export function splitLabelLines(label: string, maxChars = 26): string[] {
  if (label.length <= maxChars) return [label];
  const parenIdx = label.indexOf(' (');
  if (parenIdx > 4) {
    const head = label.slice(0, parenIdx);
    const tail = label.slice(parenIdx + 2).replace(/\)$/, '');
    if (head.length <= maxChars + 6 && tail.length <= maxChars + 6) return [head, tail];
  }
  const mid = Math.floor(label.length / 2);
  let best = -1;
  for (let i = 0; i < label.length; i++) {
    if (',/ '.includes(label[i]) && i > 3 && i < label.length - 3) {
      if (best === -1 || Math.abs(i - mid) < Math.abs(best - mid)) best = i;
    }
  }
  if (best > 0) return [label.slice(0, best).trimEnd(), label.slice(best + 1).trimStart()];
  return [label];
}
