'use client';

/**
 * WorksheetWiring — animasi "kabel/jalur sirkuit" premium di atas bar tab
 * worksheet yang saling berkaitan (ground truth: WORKSHEET_DATA_EDGES pada
 * worksheetDependency.ts).
 *
 * Cara kerja:
 * - Mengukur posisi nyata setiap tab (elemen dengan atribut data-tab-value)
 *   di dalam elemen host, lalu menggambar jejak SVG bezier bergaya PCB dari
 *   tab sumber ke tab penerima.
 * - Jejak dasar (trace) tipis transparan + salinan blur sebagai glow.
 * - Pulsa data mengalir dari PRODUSEN → KONSUMEN memakai animasi
 *   stroke-dashoffset (pathLength=1 sehingga kecepatan seragam untuk semua
 *   panjang kabel).
 * - Node titik ujung berdenyut halus; kabel yang terhubung ke tab aktif
 *   menyala lebih terang dan pulsa lebih cepat.
 * - Overlay pointer-events-none (tab tetap bisa diklik) dan tersembunyi saat
 *   cetak (print:hidden) serta menghormati prefers-reduced-motion.
 *
 * Komponen MURNI presentasi — tidak mengubah state worksheet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type WiringTone = 'sky' | 'blue' | 'amber' | 'emerald' | 'violet' | 'rose';

export interface WorksheetWiringEdge {
  /** Nilai tab sumber (produsen data). */
  from: string;
  /** Nilai tab penerima (konsumen data). */
  to: string;
  /** Palet warna kabel. */
  tone: WiringTone;
  /** Keterangan aliran data (tooltip <title> aksesibel). */
  note?: string;
}

interface WiringNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WiringSegment {
  id: string;
  d: string;
  tone: WiringTone;
  note?: string;
  active: boolean;
  /** Titik node ujung (x1,y1 sumber; x2,y2 penerima) untuk lingkaran endpoint. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const TONE_COLORS: Record<WiringTone, { base: string; pulse: string }> = {
  sky: { base: '#0369a1', pulse: '#38bdf8' },
  blue: { base: '#1e40af', pulse: '#60a5fa' },
  amber: { base: '#b45309', pulse: '#fbbf24' },
  emerald: { base: '#047857', pulse: '#34d399' },
  violet: { base: '#6d28d9', pulse: '#a78bfa' },
  rose: { base: '#be123c', pulse: '#fb7185' },
};

/** Jeda animasi pulsa per-kabel agar aliran tidak serempak (detik). */
const STAGGER_SECONDS = 0.45;

/**
 * Routing jalur PCB: sumber keluar dari tepi horizontal yang menghadap penerima,
 * penerima masuk dari tepi berlawanan — kabel tidak pernah menembus badan tab.
 * Tab sebaris dihubungkan lewat "bus" melengkung di bawah baris.
 */
function buildWiringPath(a: WiringNode, b: WiringNode): { d: string; x1: number; y1: number; x2: number; y2: number } {
  const cx1 = a.x + a.w / 2;
  const cx2 = b.x + b.w / 2;
  const sameRow = Math.abs(b.y - a.y) < 8;

  if (sameRow) {
    const yEdge = a.y + a.h;
    const dip = 7 + Math.min(15, Math.abs(cx2 - cx1) * 0.06);
    const midY = yEdge + dip;
    return {
      d: `M ${cx1} ${yEdge} C ${cx1} ${midY}, ${cx2} ${midY}, ${cx2} ${yEdge}`,
      x1: cx1,
      y1: yEdge,
      x2: cx2,
      y2: yEdge,
    };
  }

  const below = b.y > a.y;
  // Sumber keluar dari sisi bawah (target di bawah) atau sisi atas (target di atas).
  const y1 = below ? a.y + a.h : a.y;
  // Penerima masuk dari sisi atas (ada di bawah) atau sisi bawah (ada di atas).
  const y2 = below ? b.y : b.y + b.h;
  const k = Math.max(12, Math.min(34, Math.abs(y2 - y1) * 0.6));
  const s = below ? k : -k;
  return {
    d: `M ${cx1} ${y1} C ${cx1} ${y1 + s}, ${cx2} ${y2 - s}, ${cx2} ${y2}`,
    x1: cx1,
    y1,
    x2: cx2,
    y2,
  };
}

interface WorksheetWiringProps {
  /** Id elemen host (posisi relatif) yang memuat tab bertanda data-tab-value. */
  hostId: string;
  edges: WorksheetWiringEdge[];
  /** Nilai tab aktif — kabel yang tersambung ke tab aktif menyalah. */
  activeTab?: string;
  className?: string;
}

export default function WorksheetWiring({ hostId, edges, activeTab, className = '' }: WorksheetWiringProps) {
  const [segments, setSegments] = useState<WiringSegment[]>([]);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const host = document.getElementById(hostId);
    if (!host) return;
    const hostRect = host.getBoundingClientRect();
    if (hostRect.width < 2 || hostRect.height < 2) return;

    const nodes = new Map<string, WiringNode>();
    host.querySelectorAll<HTMLElement>('[data-tab-value]').forEach((el) => {
      const value = el.dataset.tabValue;
      if (!value || nodes.has(value)) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      nodes.set(value, {
        x: rect.left - hostRect.left,
        y: rect.top - hostRect.top,
        w: rect.width,
        h: rect.height,
      });
    });

    const next: WiringSegment[] = [];
    edges.forEach((edge, index) => {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      if (!from || !to) return;
      const path = buildWiringPath(from, to);
      next.push({
        id: `${edge.from}=>${edge.to}#${index}`,
        d: path.d,
        tone: edge.tone,
        note: edge.note,
        active: activeTab === edge.from || activeTab === edge.to,
        x1: path.x1,
        y1: path.y1,
        x2: path.x2,
        y2: path.y2,
      });
    });

    setSize({ w: hostRect.width, h: hostRect.height });
    setSegments(next);
  }, [hostId, edges, activeTab]);

  useEffect(() => {
    // Ukur setelah layout stabil (font + wrap selesai), lalu ikuti perubahan
    // ukuran. setState hanya dipanggil dari callback asinkron (rAF /
    // ResizeObserver / fonts.ready) — bukan sinkron di badan effect.
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

  // Belum terukur → jangan render apa pun (aman SSR, tanpa hydration mismatch).
  if (!size || segments.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      className={`worksheet-wiring-svg pointer-events-none absolute inset-0 z-20 print:hidden ${className}`}
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      preserveAspectRatio="none"
    >
      <defs>
        <filter id="wiring-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>

      {segments.map((segment, index) => {
        const colors = TONE_COLORS[segment.tone];
        const delay = `${((index % 8) * STAGGER_SECONDS).toFixed(2)}s`;
        return (
          <g key={segment.id}>
            <title>{segment.note ?? `${segment.id}`}</title>

            {/* Glow lembut di bawah trace */}
            <path
              d={segment.d}
              fill="none"
              stroke={colors.pulse}
              strokeWidth={3.5}
              strokeLinecap="round"
              className="wiring-trace"
              opacity={segment.active ? 0.28 : 0.14}
              filter="url(#wiring-glow)"
            />

            {/* Trace dasar (jejak tembaga) */}
            <path
              d={segment.d}
              fill="none"
              stroke={colors.base}
              strokeWidth={1.25}
              strokeLinecap="round"
              strokeDasharray="none"
              className="wiring-trace"
              opacity={segment.active ? 0.55 : 0.30}
            />

            {/* Pulsa data mengalir sumber → penerima */}
            <path
              d={segment.d}
              fill="none"
              stroke={colors.pulse}
              strokeWidth={segment.active ? 2.1 : 1.5}
              strokeLinecap="round"
              pathLength={1}
              strokeDasharray="0.052 0.108"
              className={`wiring-pulse${segment.active ? ' wiring-pulse--active' : ''}`}
              style={{ animationDelay: delay }}
            />

            {/* Node ujung sumber & penerima */}
            {[segment.x1, segment.x2].map((x, i) => {
              const y = i === 0 ? segment.y1 : segment.y2;
              return (
                <g key={`${segment.id}-node-${i}`} className="wiring-node" style={{ animationDelay: delay }}>
                  <circle cx={x} cy={y} r={4.5} fill={colors.pulse} className="wiring-node-halo" opacity={segment.active ? 0.30 : 0.16} />
                  <circle cx={x} cy={y} r={2} fill={colors.pulse} opacity={segment.active ? 0.95 : 0.6} stroke={colors.base} strokeWidth={0.6} />
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
