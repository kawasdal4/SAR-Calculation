'use client';

/**
 * WorksheetMindMap — struktur organisasi (org chart) alur data antar worksheet.
 *
 * Struktur visual — pohon organisasi yang menghubungkan satu node dengan
 * node lain secara hierarkis, dengan garis siku khas bagan organisasi:
 * - AKAR (hub)      : elemen `data-mm-hub` di kiri — inti komando peta.
 * - BATANG (trunk)  : garis dari hub → spine vertikal yang menjangkau
 *   seluruh node grup (`data-mm-badge`). Aliran dash berjalan keluar dari
 *   akar, ke atas dan ke bawah spine.
 * - STUB GRUP       : percabangan spine → tepi kiri badge tiap grup
 *   (gradien indigo → warna domain), dash berjalan menuju grup.
 * - BUS GRUP       : tiap BARIS tab dalam satu grup (tab bisa wrap beberapa
 *   baris) mendapat bus sendiri yang dipasang tepat di gap di bawah baris
 *   itu, lalu menancup ke setiap tab (`data-tab-value`) barisnya — sehingga
 *   TIDAK ADA garis yang melintasi atau menimpa tab lain. Antarpbaris
 *   tersambung rel vertikal di margin kanan grup (di kanan semua tab), dan
 *   bus baris terakhir berada di gap antar grup.
 * - PULSA DATA      : setiap alur WORKSHEET_DATA_FLOWS digambar sebagai
 *   kometa bercahaya yang melaju DI ATAS kawat org chart: tab produsen →
 *   bus grup → badge → spine → hub → spine → badge tujuan → bus → tab
 *   konsumen ("bergerak dari dan ke tab-nya").
 * - PORT TAB        : titik kecil di tepi bawah tab yang dilalui alur data.
 *
 * Catatan teknis:
 * - Semua kawat memakai poliline siku bersudut membulat (roundedElbow) —
 *   gaya bagan organisasi, bukan lengkungan bezier radial.
 * - Kawat grup digugurkan bila badge tidak duduk segaris dengan baris
 *   pertamanya (kontainer terlalu sempit) — geometri bebas-timpa tidak
 *   bisa dijamin, lebih aman tidak menggambar.
 * - pathLength=1 menormalisasi panjang jalur sehingga kecepatan dash/kometa
 *   seragam untuk semua panjang; dashoffset negatif = maju ke ujung path
 *   (arah aliran: akar → grup → tab).
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

const TONES: Record<MindTone, { base: string; pulse: string }> = {
  slate: { base: '#475569', pulse: '#a8b6c8' },
  sky: { base: '#0284c7', pulse: '#7dd3fc' },
  blue: { base: '#1d4ed8', pulse: '#93c5fd' },
  amber: { base: '#d97706', pulse: '#fcd34d' },
  violet: { base: '#7c3aed', pulse: '#c4b5fd' },
  emerald: { base: '#059669', pulse: '#6ee7b7' },
  rose: { base: '#e11d48', pulse: '#fda4af' },
};

/** Warna batang/akar org chart (indigo — satu warna komando di atas semua domain). */
const HUB_COLOR = '#6366f1';
/** Warna dash berjalan pada batang (indigo-300). */
const HUB_PULSE = '#a5b4fc';

/** Warna kawat per grup — mengikuti warna badge grupnya. */
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

/** Buang titik berurutan yang terlalu rapat (segmen nol → sudut rusak). */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || dist(last, p) > 0.6) out.push(p);
  }
  return out;
}

/**
 * Poliline siku khas bagan organisasi dengan sudut membulat: setiap titik
 * tengah dilunakkan kuadratik radius `radius` (mengecil otomatis bila
 * segmen pendek). Menghasilkan path SVG lengkap dengan "M" di depan.
 */
function roundedElbow(points: Pt[], radius = 7): string {
  const pts = dedupe(points);
  if (pts.length < 2) return '';
  let d = `M ${r1(pts[0].x)} ${r1(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1];
    const p = pts[i];
    const b = pts[i + 1];
    const dx1 = p.x - a.x;
    const dy1 = p.y - a.y;
    const dx2 = b.x - p.x;
    const dy2 = b.y - p.y;
    const l1 = Math.hypot(dx1, dy1);
    const l2 = Math.hypot(dx2, dy2);
    const rr = Math.min(radius, l1 / 2, l2 / 2);
    const t1x = p.x - (dx1 / l1) * rr;
    const t1y = p.y - (dy1 / l1) * rr;
    const t2x = p.x + (dx2 / l2) * rr;
    const t2y = p.y + (dy2 / l2) * rr;
    d += ` L ${r1(t1x)} ${r1(t1y)} Q ${r1(p.x)} ${r1(p.y)} ${r1(t2x)} ${r1(t2y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${r1(last.x)} ${r1(last.y)}`;
  return d;
}

/** Titik keluar batang dari tepi kanan lingkaran hub. */
function hubEdge(hub: Box): Pt {
  const c = center(hub);
  const r = Math.min(hub.w, hub.h) / 2;
  return { x: c.x + r + 1.5, y: c.y };
}

/** Titik sambung di tepi bawah tab — bus naik dari bawah. */
function tabBottomAnchor(tab: Box): Pt {
  return { x: tab.x + tab.w / 2, y: tab.y + tab.h };
}

function badgeBottom(badge: Box): Pt {
  return { x: badge.x + badge.w / 2, y: badge.y + badge.h };
}

function badgeLeft(badge: Box): Pt {
  return { x: badge.x, y: badge.y + badge.h / 2 };
}

/** Baris tab di dalam satu grup (kontainer flex-wrap): tab dalam satu
 * flex line segaris (items-center), cukup dikluster menurut tengah
 * vertikal. Tiap baris diurutkan kiri → kanan. */
function clusterRows(tabs: Box[]): Box[][] {
  const sorted = [...tabs].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: Box[][] = [];
  for (const t of sorted) {
    const cur = rows[rows.length - 1];
    if (!cur || Math.abs(t.y + t.h / 2 - (cur[0].y + cur[0].h / 2)) > 7) rows.push([t]);
    else cur.push(t);
  }
  rows.forEach((row) => row.sort((a, b) => a.x - b.x));
  return rows;
}

/** Rute kawat satu grup: bus per baris tab + rel vertikal kanan. */
interface GroupRoute {
  id: string;
  badge: Box;
  /** Tab per baris visual, urut kiri → kanan. */
  rows: Box[][];
  /** Level bus tiap baris — di gap tepat di bawah baris itu. */
  busY: number[];
  /** X rel vertikal penyambung bus antar baris (di kanan semua tab). */
  railX: number;
}

/**
 * Rangkai geometri bus grup yang DIJAMIN tidak melintasi/menimpa tab:
 * - tiap baris tab dapat bus sendiri di gap tepat di bawah barisnya;
 * - antarpbaris disambung rel vertikal di margin kanan grup (di kanan
 *   SEMUA tab, minimum 2 px dari tepi tab terkanan);
 * - bus baris terakhir tetap di gap antar grup, di bawah kotak kontainer.
 * Mengembalikan null bila badge tidak duduk segaris dengan baris pertama
 * (kontainer terlalu sempit sampai badge turun sendirian) — kawat grup
 * digugurkan daripada berisiko menimpa tab.
 */
function buildGroupRoute(
  id: string,
  badge: Box,
  groupBox: Box | undefined,
  tabs: Box[],
  hostH: number,
): GroupRoute | null {
  if (tabs.length === 0) return null;
  const rows = clusterRows(tabs);
  const row0Top = Math.min(...rows[0].map((t) => t.y));
  const row0Bottom = Math.max(...rows[0].map((t) => t.y + t.h));
  const badgeCy = badge.y + badge.h / 2;
  if (badgeCy < row0Top - 8 || badgeCy > row0Bottom + 8) return null;

  const busY = rows.map((row, r) => {
    const bottom = Math.max(...row.map((t) => t.y + t.h), r === 0 ? badge.y + badge.h : 0);
    if (r < rows.length - 1) {
      const nextTop = Math.min(...rows[r + 1].map((t) => t.y));
      const gap = nextTop - bottom;
      return bottom + Math.max(1.3, Math.min(gap / 2, 5));
    }
    const base = Math.max(bottom, groupBox ? groupBox.y + groupBox.h : 0);
    return clamp(base + 3.2, base + 2, hostH - 2);
  });

  const maxRight = Math.max(...tabs.map((t) => t.x + t.w), badge.x + badge.w);
  const railCeil = groupBox ? groupBox.x + groupBox.w - 10 : maxRight + 5;
  const railX = Math.max(maxRight + 2, Math.min(maxRight + 5, railCeil));
  return { id, badge, rows, busY, railX };
}

/**
 * Poliline kawat satu grup, digambar tanpa retracing: kawat baris pertama
 * berangkat dari badge, menyusuri bus baris-0 kiri→kanan sambil menancup
 * ke tiap tabnya, berakhir di puncak rel kanan (grup multi-baris) atau di
 * tab terakhir (grup satu baris). Rel kanan meneruskan aliran turun ke bus
 * tiap baris berikutnya; tiap bus itu mengalir kanan→kiri dan berakhir di
 * tab terkiri barisnya.
 */
function groupWirePaths(g: GroupRoute): string[] {
  const ds: string[] = [];
  const nR = g.rows.length;
  const badgeCx = g.badge.x + g.badge.w / 2;

  const pts0: Pt[] = [badgeBottom(g.badge), { x: badgeCx, y: g.busY[0] }];
  const row0 = g.rows[0];
  row0.forEach((tab, i) => {
    const cx = tab.x + tab.w / 2;
    pts0.push({ x: cx, y: g.busY[0] }, { x: cx, y: tab.y + tab.h });
    if (i < row0.length - 1 || nR > 1) pts0.push({ x: cx, y: g.busY[0] });
  });
  if (nR > 1) pts0.push({ x: g.railX, y: g.busY[0] });
  ds.push(roundedElbow(pts0));

  if (nR > 1) {
    // Rel kanan: satu tarikan vertikal menyambung bus semua baris.
    ds.push(roundedElbow([{ x: g.railX, y: g.busY[0] }, { x: g.railX, y: g.busY[nR - 1] }]));
    // Bus baris kedua dst: dari rel mengalir kanan→kiri menancup ke tiap
    // tab barisnya, berakhir di tab terkiri.
    for (let r = 1; r < nR; r++) {
      const pts: Pt[] = [{ x: g.railX, y: g.busY[r] }];
      const ordered = [...g.rows[r]].reverse();
      ordered.forEach((tab, i) => {
        const cx = tab.x + tab.w / 2;
        pts.push({ x: cx, y: g.busY[r] }, { x: cx, y: tab.y + tab.h });
        if (i < ordered.length - 1) pts.push({ x: cx, y: g.busY[r] });
      });
      ds.push(roundedElbow(pts));
    }
  }
  return ds.filter(Boolean);
}

/** Rute minimal di atas kawat grup: tab → bus barisnya → (rel kanan bila
 * bukan baris pertama) → bus baris-0 → badge. Dipakai kometa data; tidak
 * melintasi tab mana pun. */
function routeTabToBadgePts(tab: Box, g: GroupRoute): Pt[] {
  const r = Math.max(0, g.rows.findIndex((row) => row.includes(tab)));
  const cx = tab.x + tab.w / 2;
  const pts: Pt[] = [tabBottomAnchor(tab), { x: cx, y: g.busY[r] }];
  if (r > 0) pts.push({ x: g.railX, y: g.busY[r] }, { x: g.railX, y: g.busY[0] });
  pts.push({ x: g.badge.x + g.badge.w / 2, y: g.busY[0] }, badgeBottom(g.badge));
  return pts;
}

interface Geo {
  w: number;
  h: number;
  hub: Box | null;
  badges: Array<{ id: string; box: Box }>;
  groups: Map<string, Box>;
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

    const groups = new Map<string, Box>();
    host.querySelectorAll<HTMLElement>('[data-mm-group]').forEach((el) => {
      const id = el.dataset.mmGroup;
      const box = rel(el);
      if (id && box) groups.set(id, box);
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

    setGeo({ w: hostRect.width, h: hostRect.height, hub, badges, groups, tabs });
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
  const spineX = hubC.x + Math.min(hub.w, hub.h) / 2 + 9;
  const rootEdge = hubEdge(hub);
  const badgeById = new Map(geo.badges.map((b) => [b.id, b.box]));
  const activeGroup = activeTab ? geo.tabs.get(activeTab)?.group ?? null : null;

  // Tab per grup, urut kiri → kanan (arah laju bus org chart).
  const tabsByGroup = new Map<string, Box[]>();
  geo.tabs.forEach((t) => {
    if (!t.group) return;
    const list = tabsByGroup.get(t.group) ?? [];
    list.push(t.box);
    tabsByGroup.set(t.group, list);
  });
  tabsByGroup.forEach((list) => list.sort((a, b) => a.x + a.w / 2 - (b.x + b.w / 2)));

  // Rute kawat per grup: bus per baris tab + rel kanan — dijamin tidak
  // melintasi tab mana pun walau tab wrap beberapa baris.
  const routes = new Map<string, GroupRoute & { tone: MindTone; active: boolean; idx: number }>();
  geo.badges.forEach((b, idx) => {
    const route = buildGroupRoute(b.id, b.box, geo.groups.get(b.id), tabsByGroup.get(b.id) ?? [], geo.h);
    if (!route) return;
    routes.set(b.id, { ...route, tone: GROUP_TONES[b.id] ?? 'slate', active: activeGroup === b.id, idx });
  });

  // Kawat bus per grup (base + dash berjalan): beberapa poliline per grup.
  const wires = [...routes.values()].flatMap((g) =>
    groupWirePaths(g).map((d, i) => ({
      key: `wire-${g.id}-${i}`,
      d,
      tone: g.tone,
      active: g.active,
      idx: g.idx,
    })),
  );

  // === BATANG ORG CHART (hub → spine) — aliran keluar akar, ke atas & bawah ===
  const badgeCys = geo.badges.map((b) => b.box.y + b.box.h / 2);
  const trunkDownD = roundedElbow([rootEdge, { x: spineX, y: hubC.y }, { x: spineX, y: Math.max(hubC.y, ...badgeCys) }]);
  const trunkUpD = roundedElbow([
    { x: spineX, y: hubC.y },
    { x: spineX, y: Math.min(hubC.y, ...badgeCys) },
  ]);

  // === STUB GRUP (spine → badge) ===
  const stubs = geo.badges.map((b, idx) => {
    const badge = b.box;
    const bc = center(badge);
    return {
      id: b.id,
      d: roundedElbow([{ x: spineX, y: bc.y }, { x: badge.x - 1.5, y: bc.y }]),
      tone: GROUP_TONES[b.id] ?? 'slate',
      active: activeGroup === b.id,
      idx,
    };
  });

  // === TAB PESERTA ALUR DATA (untuk port ujung) ===
  const flowTabs = new Set<string>();
  flows.forEach((f) => {
    flowTabs.add(f.from);
    flowTabs.add(f.to);
  });

  // === PULSA DATA — kometa melaju di atas kawat org chart:
  // tab sumber → bus barisnya → rel kanan → bus baris-0 → badge → spine →
  // hub → spine → badge tujuan → bus → tab konsumen.
  const STAGGER = 0.55;
  const cometFlows = flows
    .map((f, index) => {
      const fromTab = geo.tabs.get(f.from);
      const toTab = geo.tabs.get(f.to);
      const routeFrom = fromTab?.group ? routes.get(fromTab.group) : undefined;
      const routeTo = toTab?.group ? routes.get(toTab.group) : undefined;
      if (!fromTab || !toTab || !routeFrom || !routeTo) return null;
      const fbC = center(routeFrom.badge);
      const tbC = center(routeTo.badge);
      const pts: Pt[] = [
        ...routeTabToBadgePts(fromTab.box, routeFrom),
        badgeLeft(routeFrom.badge),
        { x: spineX, y: fbC.y },
        { x: spineX, y: hubC.y },
        rootEdge,
        { x: spineX, y: tbC.y },
        badgeLeft(routeTo.badge),
        // Badge → tab tujuan: kebalikan rute tab → badge; titik badgeBottom
        // paling depan dibuang agar tidak terduplikasi setelah badgeLeft.
        ...routeTabToBadgePts(toTab.box, routeTo).reverse().slice(1),
      ];
      return {
        key: `flow-${f.from}-${f.to}-${index}`,
        d: roundedElbow(pts),
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
        {/* Gradien stub grup: indigo di spine → warna domain di badge. */}
        {stubs.map((s) => {
          const badge = badgeById.get(s.id);
          if (!badge) return null;
          const bc = center(badge);
          return (
            <linearGradient
              key={`stubgrad-${s.id}`}
              id={`mm-stubgrad-${s.id}`}
              gradientUnits="userSpaceOnUse"
              x1={r1(spineX)}
              y1={r1(bc.y)}
              x2={r1(badge.x)}
              y2={r1(bc.y)}
            >
              <stop offset="0%" stopColor={HUB_COLOR} />
              <stop offset="100%" stopColor={TONES[s.tone].base} />
            </linearGradient>
          );
        })}
        <filter id="mm-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.7" />
        </filter>
      </defs>

      {/* 1) BATANG ORG CHART — garis inti dari hub + dash berjalan */}
      {trunkDownD && (
        <g>
          <path d={trunkDownD} fill="none" stroke={HUB_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
          <path
            d={trunkDownD}
            fill="none"
            stroke={HUB_PULSE}
            strokeWidth={2.4}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="0.035 0.115"
            className="mm-wire-flow"
            style={{ animationDuration: '5.2s' }}
            opacity={0.6}
          />
        </g>
      )}
      {trunkUpD && (
        <g>
          <path d={trunkUpD} fill="none" stroke={HUB_COLOR} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
          <path
            d={trunkUpD}
            fill="none"
            stroke={HUB_PULSE}
            strokeWidth={2.4}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray="0.035 0.115"
            className="mm-wire-flow"
            style={{ animationDuration: '5.2s' }}
            opacity={0.6}
          />
        </g>
      )}

      {/* 2) STUB GRUP — percabangan spine → badge, dash berjalan keluar akar */}
      {stubs.map((s) => (
        <g key={`stub-${s.id}`}>
          {s.d && (
            <>
              <path
                d={s.d}
                fill="none"
                stroke={`url(#mm-stubgrad-${s.id})`}
                strokeWidth={1.9}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={s.active ? 0.95 : 0.75}
              />
              <path
                d={s.d}
                fill="none"
                stroke={TONES[s.tone].pulse}
                strokeWidth={1.9}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="0.035 0.115"
                className="mm-wire-flow"
                style={{ animationDelay: `${(s.idx * 0.4).toFixed(2)}s`, animationDuration: '2.6s' }}
                opacity={s.active ? 0.85 : 0.5}
              />
            </>
          )}
        </g>
      ))}

      {/* 3) BUS GRUP — bus per baris + rel kanan; tak pernah menimpa tab */}
      {wires.map((c) => (
        <g key={c.key}>
          {c.d && (
            <>
              <path
                d={c.d}
                fill="none"
                stroke={TONES[c.tone].base}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={c.active ? 0.85 : 0.45}
              />
              <path
                d={c.d}
                fill="none"
                stroke={TONES[c.tone].pulse}
                strokeWidth={1.5}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="0.035 0.115"
                className="mm-wire-flow"
                style={{ animationDelay: `${(c.idx * 0.55).toFixed(2)}s`, animationDuration: '3.6s' }}
                opacity={c.active ? 0.8 : 0.45}
              />
            </>
          )}
        </g>
      ))}

      {/* 4) PULSA DATA — kometa bercahaya melaju di atas kawat org chart */}
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

      {/* 5) PORT TAB — titik ujung alur data berdenyut halus */}
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
