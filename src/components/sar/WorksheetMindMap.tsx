'use client';

/**
 * WorksheetMindMap — peta pikiran (mind map) alur data antar worksheet.
 *
 * Struktur visual:
 * - NODE PUSAT (hub)  : elemen bertanda `data-mm-hub` — inti komando peta.
 * - CABANG UTAMA      : hub → badge grup (`data-mm-badge`) — lengkungan
 *   bergradien dengan denyut cahaya mengalir keluar dari pusat.
 * - PULSA DATA        : setiap alur WORKSHEET_DATA_FLOWS digambar sebagai
 *   kometa bercahaya yang bergerak dari tab produsen → jalur bus di bawah
 *   baris tab (di dalam padding kontainer grup, tidak menimpa chip mana
 *   pun) → node grup → pusat → node grup tujuan → bus → tab konsumen
 *   ("bergerak dari dan ke tab-nya"). Semua alur melalui pusat — peta
 *   tetap rapi, tidak ada garis menyilang antar tab.
 * - PORT TAB          : titik kecil di tepi bawah tab yang dilalui alur data.
 *
 * Catatan teknis:
 * - pathLength=1 menormalisasi panjang jalur sehingga kecepatan kometa
 *   seragam untuk semua panjang; dashoffset negatif = maju ke ujung path.
 * - Badge grup diberi z-30 (di atas SVG z-20) sehingga kometa tampak
 *   "terserap" ke dalam badge saat menyeberang, bukan menimpa teksnya.
 * - Overlay pointer-events-none (klik tab tidak terganggu), print:hidden,
 *   dan menghormati prefers-reduced-motion. Di layar < md hub disembunyikan
 *   (display:none) sehingga peta otomatis tidak dirender — tab tetap bersih.
 *
 * Komponen MURNI presentasi — tidak mengubah state worksheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type MindTone = 'slate' | 'sky' | 'blue' | 'amber' | 'violet' | 'emerald' | 'rose';

export interface WorksheetDataFlow {
  /** Nilai tab sumber (produsen data). */
  from: string;
  /** Nilai tab penerima (konsumen data). */
  to: string;
  /** Palet warna pulsa data. */
  tone: MindTone;
  /** Keterangan aliran data (tooltip aksesibel). */
  note?: string;
}

interface Pt {
  x: number;
  y: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Segmen kurva bezier kubik: mulai dari titik sebelumnya (atau `start`). */
interface Seg {
  c1: Pt;
  c2: Pt;
  to: Pt;
}

interface Cubic {
  start: Pt;
  segs: Seg[];
}

const TONES: Record<MindTone, { base: string; pulse: string }> = {
  slate: { base: '#475569', pulse: '#a8b6c8' },
  sky: { base: '#0284c7', pulse: '#7dd3fc' },
  blue: { base: '#1d4ed8', pulse: '#93c5fd' },
  amber: { base: '#d97706', pulse: '#fcd34d' },
  violet: { base: '#7c3aed', pulse: '#c4b5fd' },
  emerald: { base: '#059669', pulse: '#6ee7b7' },
  rose: { base: '#e11d48', pulse: '#fda4af' },
};

/** Warna inti node pusat (indigo — satu warna komando di atas semua domain). */
const HUB_COLOR = '#6366f1';

/** Warna cabang utama per grup — mengikuti warna badge grupnya. */
const GROUP_TONES: Record<string, MindTone> = {
  umum: 'slate',
  udara: 'sky',
  laut: 'blue',
  darat: 'amber',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r1 = (v: number) => Math.round(v * 10) / 10;
const center = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

function cubicToString(c: Cubic): string {
  let d = `M ${r1(c.start.x)} ${r1(c.start.y)}`;
  for (const s of c.segs) {
    d += ` C ${r1(s.c1.x)} ${r1(s.c1.y)}, ${r1(s.c2.x)} ${r1(s.c2.y)}, ${r1(s.to.x)} ${r1(s.to.y)}`;
  }
  return d;
}

/** Balik arah kurva (tab → badge = kebalikan urat badge → tab). */
function reverseCubic(c: Cubic): Cubic {
  const pts = [c.start, ...c.segs.map((s) => s.to)];
  const segs: Seg[] = [];
  for (let i = c.segs.length - 1; i >= 0; i--) {
    segs.push({ c1: c.segs[i].c2, c2: c.segs[i].c1, to: pts[i] });
  }
  return { start: pts[pts.length - 1], segs };
}

/** Sambungkan kurva-kurva yang ujungnya bertemu menjadi satu path. */
function joinCurves(curves: Cubic[]): string {
  let d = '';
  curves.forEach((c, i) => {
    const s = cubicToString(c);
    d += i === 0 ? s : s.slice(s.indexOf(' C'));
  });
  return d;
}

/**
 * Cabang utama mind map: keluar radial dari lingkaran hub, datang horizontal
 * ke tepi kiri badge grup — lengkungan kipas khas peta pikiran.
 */
function branchCurve(hub: Box, badge: Box): Cubic {
  const hc = center(hub);
  const target = { x: badge.x, y: badge.y + badge.h / 2 };
  const dx = target.x - hc.x;
  const dy = target.y - hc.y;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = dx / len;
  const ny = dy / len;
  const r = Math.min(hub.w, hub.h) / 2;
  const k = clamp(len * 0.55, 26, 84);
  return {
    start: { x: hc.x + nx * (r + 1.5), y: hc.y + ny * (r + 1.5) },
    segs: [
      {
        c1: { x: hc.x + nx * (r + k), y: hc.y + ny * (r + k) },
        c2: { x: target.x - k, y: target.y },
        to: target,
      },
    ],
  };
}

/** Titik sambung di tepi bawah tab — bus alur data naik dari bawah,
 *  sehingga tidak ada garis yang melintasi teks tab lain. */
function tabBottomAnchor(tab: Box): Pt {
  return { x: tab.x + tab.w / 2, y: tab.y + tab.h };
}

/** Segmen pendek "menembus" badge (tersembunyi di balik chip badge z-30):
 *  kometa tampak terserap ke node grup lalu diteruskan di sisi lain. */
function badgeCrossCurve(from: Pt, to: Pt): Cubic {
  if (dist(from, to) <= 1.5) return { start: from, segs: [] };
  const k = 8;
  return {
    start: from,
    segs: [{ c1: { x: from.x - k, y: from.y }, c2: { x: to.x + k, y: to.y }, to }],
  };
}

/** Titik bawah badge (tempat bus baris tab naik masuk) & tepi kiri badge
 *  (tempat cabang utama dari hub menempel). */
function badgeBottom(badge: Box): Pt {
  return { x: badge.x + badge.w / 2, y: badge.y + badge.h };
}

function badgeLeft(badge: Box): Pt {
  return { x: badge.x, y: badge.y + badge.h / 2 };
}

/** Titik bus di bawah baris tab: di dalam padding bawah kontainer grup,
 *  tidak menimpa chip tab mana pun. */
function busLevel(tab: Box, badge: Box, dip: number): number {
  return Math.max(tab.y + tab.h, badge.y + badge.h) + dip;
}

/** Bus baris tab: tepi bawah tab → turun ke jalur bus → lari horizontal di
 *  bawah chip → naik masuk ke tepi bawah badge grup. */
function busCurve(badge: Box, tab: Box, dip: number): Cubic {
  const from = { x: tab.x + tab.w / 2, y: tab.y + tab.h };
  const to = badgeBottom(badge);
  const busY = busLevel(tab, badge, dip);
  return {
    start: from,
    segs: [
      {
        c1: { x: from.x, y: busY },
        c2: { x: to.x, y: busY },
        to,
      },
    ],
  };
}

/** Path lengkap satu pulsa data: tepi bawah tab sumber → bus baris tab →
 *  badge grup → pusat (hub) → badge tujuan → bus baris tujuan → tepi bawah
 *  tab penerima. Semua alur melalui pusat agar peta tetap rapi (tidak ada
 *  garis menyilang antar tab). */
function buildFlowPath(opts: {
  hub: Box;
  tabFrom: Box;
  badgeFrom: Box;
  tabTo: Box;
  badgeTo: Box;
  dip: number;
}): string {
  const busFrom = busCurve(opts.badgeFrom, opts.tabFrom, opts.dip);
  const busTo = busCurve(opts.badgeTo, opts.tabTo, opts.dip);

  const branchFrom = branchCurve(opts.hub, opts.badgeFrom);
  const branchTo = branchCurve(opts.hub, opts.badgeTo);

  return joinCurves([
    reverseCubic(busFrom),
    badgeCrossCurve(badgeBottom(opts.badgeFrom), badgeLeft(opts.badgeFrom)),
    reverseCubic(branchFrom),
    branchTo,
    badgeCrossCurve(badgeLeft(opts.badgeTo), badgeBottom(opts.badgeTo)),
    busTo,
  ]);
}

interface Geo {
  w: number;
  h: number;
  hub: Box | null;
  badges: Array<{ id: string; box: Box }>;
  tabs: Map<string, { box: Box; group: string | null }>;
}

interface WorksheetMindMapProps {
  /** Id elemen host (posisi relative) yang memuat hub, badge, dan tab. */
  hostId: string;
  flows: WorksheetDataFlow[];
  /** Nilai tab aktif — cabang/urat/pulsa yang tersambung menyalah. */
  activeTab?: string;
  className?: string;
}

export default function WorksheetMindMap({ hostId, flows, activeTab, className = '' }: WorksheetMindMapProps) {
  const [geo, setGeo] = useState<Geo | null>(null);
  const rafRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const host = document.getElementById(hostId);
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width < 2 || hostRect.height < 2) return;

    const rel = (el: Element): Box | null => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return { x: r.left - hostRect.left, y: r.top - hostRect.top, w: r.width, h: r.height };
    };

    const hubEl = host.querySelector('[data-mm-hub]');
    const hub = hubEl ? rel(hubEl) : null;

    const badges: Array<{ id: string; box: Box }> = [];
    host.querySelectorAll<HTMLElement>('[data-mm-badge]').forEach((el) => {
      const id = el.dataset.mmBadge;
      const box = rel(el);
      if (id && box) badges.push({ id, box });
    });

    const tabs = new Map<string, { box: Box; group: string | null }>();
    host.querySelectorAll<HTMLElement>('[data-tab-value]').forEach((el) => {
      const value = el.dataset.tabValue;
      if (!value || tabs.has(value)) return;
      const box = rel(el);
      if (!box) return;
      const group = el.closest('[data-mm-group]')?.getAttribute('data-mm-group') ?? null;
      tabs.set(value, { box, group });
    });

    setGeo({ w: hostRect.width, h: hostRect.height, hub, badges, tabs });
  }, [hostId]);

  useEffect(() => {
    // Ukur setelah layout stabil (font + wrap selesai), lalu ikuti perubahan
    // ukuran. setState hanya dari callback asinkron (rAF / ResizeObserver /
    // fonts.ready) — bukan sinkron di badan effect.
    const raf = requestAnimationFrame(measure);
    rafRef.current = raf;

    const host = document.getElementById(hostId);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => measure());
      if (host) observer.observe(host);
      const list = host?.querySelector('[role="tablist"]');
      if (list) observer.observe(list);
    }
    window.addEventListener('resize', measure);
    if (typeof document !== 'undefined' && 'fonts' in document) {
      (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(() => measure()).catch(() => undefined);
    }

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, hostId]);

  // Belum terukur, hub tersembunyi (layar kecil), atau badge tidak ada →
  // jangan render apa pun (aman SSR, tanpa hydration mismatch).
  if (!geo || !geo.hub || geo.hub.w < 12 || geo.badges.length === 0) return null;

  const hub = geo.hub;
  const hubC = center(hub);
  const badgeById = new Map(geo.badges.map((b) => [b.id, b.box]));
  const activeGroup = activeTab ? geo.tabs.get(activeTab)?.group ?? null : null;

  // === CABANG UTAMA (hub → badge grup) ===
  const branches = geo.badges.map((b, idx) => ({
    id: b.id,
    d: cubicToString(branchCurve(hub, b.box)),
    tone: GROUP_TONES[b.id] ?? 'slate',
    active: activeGroup === b.id,
    idx,
  }));

  // === TAB PESERTA ALUR DATA (untuk port ujung) ===
  const flowTabs = new Set<string>();
  flows.forEach((f) => {
    flowTabs.add(f.from);
    flowTabs.add(f.to);
  });

  // === PULSA DATA (kometa produsen → pusat → konsumen) ===
  const STAGGER = 0.55;
  const cometFlows = flows
    .map((f, index) => {
      const fromTab = geo.tabs.get(f.from);
      const toTab = geo.tabs.get(f.to);
      const badgeFrom = fromTab?.group ? badgeById.get(fromTab.group) : undefined;
      const badgeTo = toTab?.group ? badgeById.get(toTab.group) : undefined;
      if (!fromTab || !toTab || !badgeFrom || !badgeTo) return null;
      // Kedalaman bus bertingkat agar aliran sejajar tidak menumpuk di satu
      // garis — membentuk "lajur" berlapis di bawah baris tab.
      const dip = 2.5 + (index % 3) * 1.5;
      return {
        key: `flow-${f.from}-${f.to}-${index}`,
        d: buildFlowPath({ hub, tabFrom: fromTab.box, badgeFrom, tabTo: toTab.box, badgeTo, dip }),
        tone: f.tone,
        note: f.note,
        active: activeTab === f.from || activeTab === f.to,
        delay: `${((index % 6) * STAGGER).toFixed(2)}s`,
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  // === PORT TAB (titik ujung alur data berdenyut, di tepi bawah tab) ===
  const ports: Array<{ key: string; pt: Pt; tone: MindTone; active: boolean; delay: string }> = [];
  let portIdx = 0;
  geo.tabs.forEach((t, value) => {
    if (!flowTabs.has(value) || !t.group) return;
    ports.push({
      key: `port-${value}`,
      pt: tabBottomAnchor(t.box),
      tone: GROUP_TONES[t.group] ?? 'slate',
      active: value === activeTab,
      delay: `${((portIdx++ % 5) * 0.6).toFixed(2)}s`,
    });
  });

  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-20 print:hidden ${className}`}
      width={geo.w}
      height={geo.h}
      viewBox={`0 0 ${geo.w} ${geo.h}`}
    >
      <defs>
        {/* Gradien cabang: indigo di pusat → warna domain di badge. */}
        {branches.map((b) => {
          const badge = badgeById.get(b.id);
          if (!badge) return null;
          const bc = center(badge);
          return (
            <linearGradient
              key={`grad-${b.id}`}
              id={`mm-grad-${b.id}`}
              gradientUnits="userSpaceOnUse"
              x1={r1(hubC.x)}
              y1={r1(hubC.y)}
              x2={r1(badge.x)}
              y2={r1(bc.y)}
            >
              <stop offset="0%" stopColor={HUB_COLOR} />
              <stop offset="100%" stopColor={TONES[b.tone].base} />
            </linearGradient>
          );
        })}
        <filter id="mm-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.7" />
        </filter>
      </defs>

      {/* 1) CABANG UTAMA — glow + gradien + denyut mengalir keluar pusat */}
      {branches.map((b) => (
        <g key={`branch-${b.id}`}>
          <path
            d={b.d}
            fill="none"
            stroke={TONES[b.tone].pulse}
            strokeWidth={6.5}
            strokeLinecap="round"
            opacity={b.active ? 0.28 : 0.15}
            filter="url(#mm-glow)"
          />
          <path
            d={b.d}
            fill="none"
            stroke={`url(#mm-grad-${b.id})`}
            strokeWidth={2.4}
            strokeLinecap="round"
            opacity={b.active ? 0.95 : 0.72}
          />
          <path
            d={b.d}
            fill="none"
            stroke={TONES[b.tone].pulse}
            strokeWidth={1.3}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="0.04 0.11"
            className="mm-branch-flow"
            style={{ animationDelay: `${(b.idx * 0.7).toFixed(2)}s` }}
            opacity={b.active ? 0.8 : 0.5}
          />
        </g>
      ))}

      {/* 2) PULSA DATA — kometa bercahaya bergerak dari tab sumber ke tujuan */}
      {cometFlows.map((f) => (
        <g key={f.key}>
          <title>{f.note ?? f.key}</title>
          <path
            d={f.d}
            fill="none"
            stroke={TONES[f.tone].pulse}
            strokeWidth={5}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="0.055 0.945"
            className={`mm-comet-glow${f.active ? ' mm-comet--active' : ''}`}
            style={{ animationDelay: f.delay }}
            opacity={f.active ? 0.55 : 0.3}
            filter="url(#mm-glow)"
          />
          <path
            d={f.d}
            fill="none"
            stroke={TONES[f.tone].pulse}
            strokeWidth={f.active ? 2.7 : 2.1}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="0.055 0.945"
            className={`mm-comet${f.active ? ' mm-comet--active' : ''}`}
            style={{ animationDelay: f.delay }}
            opacity={0.95}
          />
        </g>
      ))}

      {/* 3) PORT TAB — titik ujung alur data berdenyut halus */}
      {ports.map((p) => (
        <g key={p.key}>
          <circle
            cx={r1(p.pt.x)}
            cy={r1(p.pt.y)}
            r={5.5}
            fill={TONES[p.tone].pulse}
            className="mm-port-halo"
            style={{ animationDelay: p.delay }}
            opacity={p.active ? 0.34 : 0.2}
          />
          <circle
            cx={r1(p.pt.x)}
            cy={r1(p.pt.y)}
            r={2.1}
            fill={TONES[p.tone].pulse}
            stroke={TONES[p.tone].base}
            strokeWidth={0.7}
            opacity={p.active ? 1 : 0.75}
          />
        </g>
      ))}

    </svg>
  );
}
