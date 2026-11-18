'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type LatLng, distanceNm, project } from '@/lib/sar/sarCalculations';
import {
  placeAlongLineLabels,
  type LabelPlacement,
} from '@/lib/sar/labelPlacement';
import {
  chooseGridInterval,
  enumerateGridPoints,
  formatDepth,
  shouldRenderDepth,
  type Density,
  type DepthSource,
  type GridInterval,
  type GridPoint,
} from '@/lib/sar/depthLabels';
import {
  fetchDepths,
  getActiveDepthSource,
  getCachedDepth,
  getDepthSourceLabel,
  type DepthStatus,
} from '@/lib/sar/depthSources';

// ============================================================================
// Public types — kept stable with the SeaMap API so callers (page.tsx)
// don't need to change.
// ============================================================================

export interface MapMarker {
  position: LatLng;
  label: string;
  /** Show a compact, permanent label beside the marker. */
  showLabel?: boolean;
  labelDirection?: 'top' | 'right' | 'bottom' | 'left';
  color?: string;
  isStart?: boolean;
  isDatum?: boolean;
  /** Tampilkan sebagai penanda silang (✕) — mis. titik DATUM B (Panduan §5). */
  cross?: boolean;
  sequence?: number;
  onClick?: () => void;
}

export interface MapLine {
  from: LatLng;
  to: LatLng;
  color: string;
  label?: string;
  dashed?: boolean;
  arrow?: boolean;
  weight?: number;
  opacity?: number;
  labelClassName?: string;
}

export interface MapPolygon {
  points: LatLng[];
  color: string;
  fillColor?: string;
  fillOpacity?: number;
  label?: string;
}

export interface MapCircle {
  center: LatLng;
  radiusNm: number;
  color: string;
  fillColor?: string;
  fillOpacity?: number;
  label?: string;
  /** Pola dash SVG; null = garis solid. Default '3 3' (putus-putus tipis). */
  dashArray?: string | null;
  /** Ketebalan garis; default 1.5. */
  weight?: number;
}

export interface SeaMapProps {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  lines?: MapLine[];
  polygons?: MapPolygon[];
  circles?: MapCircle[];
  height?: string;
  onMapClick?: (latlng: LatLng) => void;
  /** When true, clicks set the LKP (calls onMapClick). When false, clicks fetch depth. */
  pickMode?: boolean;
  /** When true, the cursor shows a crosshair and clicks measure distance instead. */
  measureMode?: boolean;
  /** Isolates map controls and persisted view preferences for this map instance. */
  preferenceKey?: string;
  /** Isolated chart style for specialized worksheets. */
  basemap?: 'nautical' | 'onc';
  /** Zoom otomatis (Panduan Datum §5): ketika `key` berubah, peta fit ke
   *  bounds gabungan `points` + lingkaran `radiusNm` di sekitar datum. */
  autoFitTo?: { points: LatLng[]; radiusNm?: number; key: string };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char] ?? char);
}

// ============================================================================
// Marker icon fix (Leaflet default icons break in Next.js bundlers)
// ============================================================================

const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = DefaultIcon;

function makeColoredIcon(color: string, isStart?: boolean, isDatum?: boolean, sequence?: number, cross?: boolean) {
  const shape = sequence !== undefined
    ? String(sequence)
    : cross
      ? '✕'
      : isStart
        ? '◆'
        : isDatum
          ? '◉'
          : '●';
  const size = cross ? 26 : isStart ? 22 : 18;
  return L.divIcon({
    className: 'sar-marker',
    html: `<div style="
      background:${color};
      width:${size}px;
      height:${size}px;
      border-radius:50%;
      border: ${cross ? 3 : 2}px solid #fff;
      box-shadow: 0 0 ${cross ? 7 : 4}px rgba(0,0,0,${cross ? 0.75 : 0.6});
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:${cross ? 14 : sequence !== undefined ? 9 : 11}px;font-weight:bold;
    ">${shape}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -10],
  });
}

// ============================================================================
// Helpers: coordinate formatting (DMS) and distance unit display
// ============================================================================

function formatDMS(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFull = (abs - deg) * 60;
  const min = Math.floor(minFull);
  const sec = ((minFull - min) * 60).toFixed(1);
  const dStr = deg.toString().padStart(isLat ? 2 : 3, '0');
  const mStr = min.toString().padStart(2, '0');
  return `${dStr}°${mStr}′${sec.padStart(4, '0')}″${hemi}`;
}

// ============================================================================
// Constants for the map layers (all client-side; no proxy)
// ============================================================================

const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '© OpenStreetMap contributors';
const OSM_MAX_ZOOM = 19;

const SEAMARK_URL = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
const SEAMARK_ATTR = '© OpenSeaMap';
const SEAMARK_MAX_ZOOM = 18;
const ONC_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Specialty/World_Navigation_Charts/MapServer/tile/{z}/{y}/{x}';
const ONC_ATTR = '© Esri, East View Cartographic';

function mapControlId(scope: string, control: string): string {
  return `seamap-${scope}-${control}`;
}

// ============================================================================
// Tampilan (view) preferences — persisted in localStorage as one object.
// ============================================================================

interface ViewPrefs {
  layers: boolean;
  coord: boolean;
  zoom: boolean;
  disclaimer: boolean;
  depth: boolean; // "Angka kedalaman" overlay (canvas-based soundings)
}

const DEFAULT_VIEW_PREFS: ViewPrefs = {
  layers: true,
  coord: true,
  zoom: true,
  disclaimer: true,
  // depth ON by default — the layer must be visible out of the box. Fetches
  // are debounced, rate-limited and cached (memory + localStorage), so the
  // first paint costs at most a couple of small requests.
  depth: true,
};

// v2: bumped from 'seamap:viewPrefs' so the fixed defaults apply to existing
// visitors too (old stored prefs could keep depth off or a fully-hidden map).
const VIEW_PREFS_KEY = 'seamap:viewPrefs:v2';
const DEPTH_DENSITY_KEY = 'seamap:depthDensity';

function loadViewPrefs(storageKey = VIEW_PREFS_KEY): ViewPrefs {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_VIEW_PREFS };
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { ...DEFAULT_VIEW_PREFS };
    const parsed = JSON.parse(raw) as Partial<ViewPrefs>;
    const restored: ViewPrefs = {
      layers: typeof parsed.layers === 'boolean' ? parsed.layers : true,
      coord: typeof parsed.coord === 'boolean' ? parsed.coord : true,
      zoom: typeof parsed.zoom === 'boolean' ? parsed.zoom : true,
      disclaimer: typeof parsed.disclaimer === 'boolean' ? parsed.disclaimer : true,
      depth: typeof parsed.depth === 'boolean' ? parsed.depth : true,
    };
    // Never restore a fully-hidden map — a map with every overlay hidden
    // reads as "broken" (the user thinks the map disappeared). Hiding is
    // still possible; it just doesn't survive a reload.
    if (allHidden(restored)) return { ...DEFAULT_VIEW_PREFS };
    return restored;
  } catch {
    return { ...DEFAULT_VIEW_PREFS };
  }
}

function saveViewPrefs(prefs: ViewPrefs, storageKey = VIEW_PREFS_KEY): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    // ignore write failures (private mode, sandbox, etc.)
  }
}

function allHidden(p: ViewPrefs): boolean {
  // "Hide all" only hides the in-map overlays (layers/coord/zoom/disclaimer).
  // The depth layer has its own checkbox (Layers panel + Tampilan menu) —
  // it's not affected by the Tampilan "hide all" toggle.
  return !p.layers && !p.coord && !p.zoom && !p.disclaimer;
}

function loadDepthDensity(storageKey = DEPTH_DENSITY_KEY): Density {
  try {
    if (typeof window === 'undefined') return 'sedang';
    const raw = window.localStorage.getItem(storageKey);
    if (raw === 'rapat' || raw === 'sedang' || raw === 'jarang') return raw;
  } catch {
    // ignore
  }
  return 'sedang';
}

function saveDepthDensity(d: Density, storageKey = DEPTH_DENSITY_KEY): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(storageKey, d);
  } catch {
    // ignore
  }
}

// ============================================================================
// Main SeaMap component
// ============================================================================

export default function SeaMap({
  center,
  zoom = 8,
  markers = [],
  lines = [],
  polygons = [],
  circles = [],
  height = '500px',
  onMapClick,
  pickMode = false,
  measureMode = false,
  preferenceKey,
  basemap = 'nautical',
  autoFitTo,
}: SeaMapProps) {
  const mapDisclaimer = basemap === 'onc'
    ? 'Peta ONC referensi; bukan pengganti chart/produk aeronautika resmi.'
    : 'Bukan untuk navigasi pelayaran; akurasi tidak dijamin.';
  const reactMapId = useId();
  const mapScope = (preferenceKey ?? reactMapId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const viewPrefsStorageKey = preferenceKey ? `${VIEW_PREFS_KEY}:${mapScope}` : VIEW_PREFS_KEY;
  const depthDensityStorageKey = preferenceKey ? `${DEPTH_DENSITY_KEY}:${mapScope}` : DEPTH_DENSITY_KEY;
  const depthToggleEvent = `seamap:depth-toggle:${mapScope}`;
  const depthPanelSyncEvent = `seamap:depth-panel-sync:${mapScope}`;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Refs to read latest prop values inside the map's once-bound click handler
  const pickModeRef = useRef<boolean>(pickMode);
  const measureModeRef = useRef<boolean>(measureMode);
  const onMapClickRef = useRef<typeof onMapClick>(onMapClick);

  useEffect(() => {
    pickModeRef.current = pickMode;
    if (mapRef.current) {
      const container = mapRef.current.getContainer();
      if (pickMode) {
        container.style.cursor = 'crosshair';
      } else {
        container.style.cursor = '';
      }
    }
  }, [pickMode]);
  useEffect(() => {
    measureModeRef.current = measureMode;
  }, [measureMode]);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  // Stable refs to layer objects so we can re-render without re-creating the map
  const layersRef = useRef<{
    markers?: L.LayerGroup;
    lines?: L.LayerGroup;
    polygons?: L.LayerGroup;
    circles?: L.LayerGroup;
    pointLabels?: L.Tooltip[];
    measureMarkers?: L.Marker[];
    measureLine?: L.Polyline | null;
  }>({});

  // ---- Tampilan (view) preferences ----
  // Per-element toggles for showing/hiding overlays that cover the map.
  // Default: everything visible. Persisted in localStorage as one object.
  // SeaMap is loaded via next/dynamic with ssr:false, so the lazy initialiser
  // only runs in the browser.
  const [viewPrefs, setViewPrefs] = useState<ViewPrefs>(() => loadViewPrefs(viewPrefsStorageKey));
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideToast, setHideToast] = useState(false);
  // Mirror of viewPrefs so the once-bound keyboard handler can read the
  // latest value without re-binding.
  const viewPrefsRef = useRef(viewPrefs);
  useEffect(() => {
    viewPrefsRef.current = viewPrefs;
  }, [viewPrefs]);

  // Non-blocking toast shown right after the overlays are hidden, telling
  // the user how to bring them back (the #1 recovery path).
  const hideToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashHideToast = useCallback(() => {
    setHideToast(true);
    if (hideToastTimer.current) clearTimeout(hideToastTimer.current);
    hideToastTimer.current = setTimeout(() => {
      setHideToast(false);
      hideToastTimer.current = null;
    }, 6000);
  }, []);
  const clearHideToast = useCallback(() => {
    setHideToast(false);
    if (hideToastTimer.current) {
      clearTimeout(hideToastTimer.current);
      hideToastTimer.current = null;
    }
  }, []);
  useEffect(
    () => () => {
      if (hideToastTimer.current) clearTimeout(hideToastTimer.current);
    },
    [],
  );

  // Persist on change.
  useEffect(() => {
    saveViewPrefs(viewPrefs, viewPrefsStorageKey);
  }, [viewPrefs, viewPrefsStorageKey]);

  // Keyboard shortcut: H toggles ALL elements (hide-all ↔ show-all).
  // Ignores modifier keys (Ctrl/Meta/Alt) and any editable focus target.
  // Note: the depth layer is NOT toggled by H — it has its own checkbox in
  // the Layers panel and in the Tampilan menu.
  useEffect(() => {
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      const ce = (el as HTMLElement).isContentEditable;
      return ce === true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'h' && e.key !== 'H') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(document.activeElement)) return;
      e.preventDefault();
      const prev = viewPrefsRef.current;
      if (allHidden(prev)) {
        setViewPrefs({ ...DEFAULT_VIEW_PREFS, depth: prev.depth });
        clearHideToast();
      } else {
        setViewPrefs({ layers: false, coord: false, zoom: false, disclaimer: false, depth: prev.depth });
        flashHideToast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flashHideToast, clearHideToast]);

  // Build the className applied to the map WRAPPER, based on view prefs.
  // Each class triggers a CSS rule that hides the corresponding Leaflet
  // control with `display: none`. The map's own pan/zoom/click handlers are
  // attached to the map pane, not the control container, so they keep working
  // when controls are hidden.
  // IMPORTANT: these classes must live on the wrapper div, NOT on the
  // Leaflet container itself. Leaflet adds its own classes to the container
  // (`leaflet-container`, `leaflet-fade-anim`, …) after init; if React ever
  // re-writes that div's className (which happens on every toggle), those
  // classes are wiped — `.leaflet-container .leaflet-tile { max-width: none
  // !important }` stops matching, Tailwind's `img { max-width: 100% }`
  // collapses every tile to width 0, and the whole map turns white. That
  // was the "klik hide → peta hilang" bug.
  const mapWrapperClassName = [
    !viewPrefs.layers && 'seamap-hide-layers',
    !viewPrefs.coord && 'seamap-hide-coord',
    !viewPrefs.zoom && 'seamap-hide-zoom',
    !viewPrefs.disclaimer && 'seamap-hide-disclaimer',
  ].filter(Boolean).join(' ');

  // ---- Depth layer state ----
  // Mirrors viewPrefs.depth so we can pass a stable ref into the map's
  // once-bound moveend handler.
  const depthEnabledRef = useRef<boolean>(basemap === 'onc' ? false : viewPrefs.depth);
  const depthDensityRef = useRef<Density>('sedang');
  const [depthDensity, setDepthDensityState] = useState<Density>(() => loadDepthDensity(depthDensityStorageKey));
  const [depthStatus, setDepthStatus] = useState<DepthStatus>('idle');
  const [depthHint, setDepthHint] = useState<string | null>(null);

  useEffect(() => {
    depthEnabledRef.current = basemap === 'onc' ? false : viewPrefs.depth;
    // Trigger an immediate redraw of the depth canvas when toggled on.
    if (mapRef.current) {
      // The map's moveend handler will run scheduleDepthRedraw; but the user
      // just toggled the checkbox, so fire it manually.
      window.dispatchEvent(new Event(depthToggleEvent));
    }
  }, [viewPrefs.depth, depthToggleEvent, basemap]);

  useEffect(() => {
    depthDensityRef.current = depthDensity;
    saveDepthDensity(depthDensity, depthDensityStorageKey);
    // Trigger redraw on density change.
    window.dispatchEvent(new Event(depthToggleEvent));
  }, [depthDensity, depthDensityStorageKey, depthToggleEvent]);

  const setDepthDensity = (d: Density) => setDepthDensityState(d);
  const activeDepthSource: DepthSource = getActiveDepthSource();

  // ---- Initialise the map ONCE ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      scrollWheelZoom: true,
      attributionControl: true,
    });
    let disposed = false;
    const isMapActive = () => {
      const mapPane = (map as L.Map & { _mapPane?: HTMLElement | null })._mapPane;
      return !disposed && mapRef.current === map && Boolean(containerRef.current?.isConnected && mapPane?.isConnected);
    };

    if (basemap === 'onc') {
      L.tileLayer(ONC_URL, { attribution: ONC_ATTR, minZoom: 3, maxZoom: 10 }).addTo(map);
    } else {
      L.tileLayer(OSM_URL, { attribution: OSM_ATTR, maxZoom: OSM_MAX_ZOOM }).addTo(map);
      L.tileLayer(SEAMARK_URL, { attribution: SEAMARK_ATTR, maxZoom: SEAMARK_MAX_ZOOM, tileSize: 256, opacity: 0.9 }).addTo(map);
    }

    // ---- Bingkai skala peta laut (canvas) — replika bingkai peta cetak ----
    // Referensi: Peta No. 149 "Babel" (Dishidros, A3). Struktur diukur dari
    // PDF referensi pada render 300 dpi (kalibrasi 1' = 43.85 px dari jarak
    // label 111° s.d. 111°30'):
    //   • Pita 3 neatline tipis, dua separuh 6 px. Separuh DALAM = sisi peta,
    //     separuh LUAR = sisi margin.
    //   • Separuh luar: blok hitam/putih bergantian per 5'. Hitam MULAI TEPAT
    //     di derajat: 0–5', 10–15', 20–25' hitam; 5–10', 15–20', 25–30' putih
    //     (terverifikasi identik di tepi bawah 111° dan tepi kanan 3°).
    //   • Tick penuh (selebar pita) di setiap batas blok 5'; tick 1' lainnya
    //     pendek (55% lebar pita) mulai dari neatline dalam.
    //   • Label HANYA di kelipatan 30'/derajat, format cetak: derajat penuh
    //     "111°" (tanpa nol di depan), menit "30'" (tanpa detik), TANPA huruf
    //     hemisfer S/T/B/U. Bujur di bawah DAN atas bingkai (rata tengah di
    //     meridian); lintang di kiri DAN kanan (teks tegak; kanan rata kiri,
    //     kiri rata kanan). Tonjolan 6 px dari bingkai ke label.
    //   • Garis kisi 0.6 px menembus peta di setiap posisi label, dari
    //     bingkai ke bingkai.
    //
    // Perilaku zoom: tangga langkah [60, 30, 10, 5, 1, 0.5, 1/6, 1/12, 1/60]
    // menit. Level label = langkah terhalus yang jarak antar-labelnya masih
    // >= LABEL_MIN_PX. Blok = 2 level di bawah label; tick = 3 level di bawahnya.
    // Skala bujur dan lintang dihitung TERPISAH (px/menit berbeda pada
    // proyeksi Web Mercator). Semua langkah tangga membag habis 60', sehingga
    // grid selalu anchor ke derajat penuh — fase blok hitam tetap stabil.
    //
    // Konstanta yang bisa disetel:
    const BAND_W = 12;             // lebar pita bingkai (px) — cetak ≈ 2 mm
    const FRAME_INSET_X = 70;      // ruang label kiri/kanan di luar bingkai (px)
    const FRAME_INSET_Y = 22;      // ruang label atas/bawah di luar bingkai (px)
    const TICK_MINOR_FRAC = 0.55;  // panjang tick 1' = fraksi lebar pita
    const LABEL_PROJ = 6;          // tonjolan garis dari bingkai ke label (px)
    const LABEL_FONT = '12px Georgia, "Times New Roman", serif'; // serif tipis ala cetak
    const LABEL_COLOR = '#1a1a1a';
    const FRAME_COLOR = '#1a1a1a';
    const GRAT_COLOR = 'rgba(26, 26, 26, 0.6)'; // garis kisi lebih redup
    const GRAT_W = 0.6;            // tebal garis kisi (px)
    const LABEL_MIN_PX = 140;      // jarak antar-label minimum (px)
    const LADDER_MIN = [60, 30, 10, 5, 1, 0.5, 1 / 6, 1 / 12, 1 / 60]; // menit
    const BLOCK_LEVELS_BELOW = 2;  // blok = 2 level di bawah label
    const TICK_LEVELS_BELOW = 3;   // tick = 3 level di bawah label

    let scaleBorderCanvas: HTMLCanvasElement | null = null;
    let scaleBorderRAF: number | null = null;
    let frameFullscreenHandler: (() => void) | null = null;
    let frameResizeHandler: (() => void) | null = null;

    // Level label: langkah TERHALUS yang jarak antar-labelnya masih >=
    // LABEL_MIN_PX pada sumbu tsb (px per menit bujur ≠ px per menit
    // lintang di Web Mercator). Konsisten dengan kriteria #1: pada zoom yang
    // menampilkan ±108°–112°BT, label jatuh di kelipatan 30'/derajat.
    // Bila bahkan langkah terkasar (60') pun < 140 px, pakai 60'.
    function chooseLabelLevel(pxPerMin: number): number {
      let lvl = 0;
      for (let i = 1; i < LADDER_MIN.length; i++) {
        if (LADDER_MIN[i] * pxPerMin >= LABEL_MIN_PX) lvl = i; else break;
      }
      return lvl;
    }

    // Label gaya cetak. Input: detik busur (grid anchor derajat, bulat).
    //   derajat penuh -> "111°" / "3°"   (tanpa nol di depan)
    //   menit         -> "30'"            (hanya menit, tanpa detik)
    // Tanpa huruf S/T/B/U; lintang selalu tampil sebagai nilai positif.
    // Bujur dinormalisasi ke [0,360) (praktik BT). Di zoom ekstrem label bisa
    // jatuh di bawah 1 menit — saat itu ditampilkan dalam detik ("10\"")
    // karena cetak juga memakai detik pada skala besar.
    function frameLabel(sec: number, axis: 'lat' | 'lng'): string {
      const minFromDeg = (Math.abs(Math.round(sec)) % 3600) / 60;
      if (minFromDeg === 0) {
        const deg = Math.round(sec / 3600);
        const norm = axis === 'lng' ? (((deg % 360) + 360) % 360) : Math.abs(deg);
        return `${norm}°`;
      }
      if (minFromDeg >= 1) {
        const txt = Number.isInteger(minFromDeg)
          ? `${minFromDeg}`
          : String(parseFloat(minFromDeg.toFixed(3)));
        return `${txt}'`;
      }
      return `${Math.round(minFromDeg * 60)}"`;
    }

    /**
     * Satu rutin untuk KEEMPAT sisi bingkai — pola identik dengan cetak.
     * side menentukan orientasi; axis menentukan sumbu nilai (bujur untuk
     * top/bottom, lintang untuk left/right). Struktur per sisi, dari sisi
     * peta ke margin:
     *   neatline dalam → separuh dalam (tick 1') → neatline tengah →
     *   separuh luar (blok hitam/putih) → neatline luar → tonjolan → label.
     *
     * Grid tick/blok/label semuanya kelipatan bulat detik busur yang membag
     * habis 3600 (derajat), sehingga fase blok hitam tidak pernah bergeser.
     */
    function drawSide(args: {
      side: 'top' | 'bottom' | 'left' | 'right';
      axis: 'lat' | 'lng';
      axisStartSec: number;  // batas sumbu terkecil (detik busur)
      axisEndSec: number;    // batas sumbu terbesar (detik busur)
      labelSec: number;      // langkah label (30'/derajat)
      blockSec: number;      // langkah blok (2 level di bawah label)
      tickSec: number;       // langkah tick (3 level di bawah label)
      toPos: (deg: number) => number; // derajat → x (horizontal) / y (vertikal)
      reserved: Array<{ x: number; y: number; w: number; h: number }>; // area kontrol yang tak boleh tertutup label
    }): void {
      const { side, axis, axisStartSec, axisEndSec, labelSec, blockSec, tickSec, toPos, reserved } = args;
      const isH = side === 'top' || side === 'bottom';
      // Neatline: luar (sisi margin) → tengah → dalam (sisi peta).
      const lineOuter = isH ? (side === 'bottom' ? fy1 : fy0) : (side === 'right' ? fx1 : fx0);
      const s = side === 'bottom' || side === 'right' ? -1 : 1; // arah ke dalam
      const lineMid = lineOuter + (BAND_W / 2) * s;
      const lineInner = lineOuter + BAND_W * s;
      const axisMin = isH ? fx0 : fy0;
      const axisMax = isH ? fx1 : fy1;
      const tickMinor = TICK_MINOR_FRAC * BAND_W;

      // --- Blok hitam/putih di separuh LUAR pita ---
      // Hitam mulai TEPAT di derajat: floor(menit-dari-derajat / blok) genap.
      // (Terukur dari PDF: 0–5', 10–15', 20–25' hitam; 5–10', 15–20',
      // 25–30' putih — sama di keempat sisi.)
      for (let sec = Math.floor(axisStartSec / blockSec) * blockSec; sec <= axisEndSec; sec += blockSec) {
        const mfd = Math.abs(Math.round(sec)) % 3600;
        if (Math.floor(mfd / blockSec) % 2 !== 0) continue; // putih = kosong
        const x0 = toPos(sec / 3600);
        const x1 = toPos((sec + blockSec) / 3600);
        if (x1 < axisMin - 4 || x0 > axisMax + 4) continue;
        const a = Math.max(x0, axisMin);
        const b = Math.min(x1, axisMax);
        if (b - a <= 0.5) continue;
        if (isH) {
          ctx.fillRect(a, Math.min(lineMid, lineOuter), b - a, BAND_W / 2);
        } else {
          ctx.fillRect(Math.min(lineMid, lineOuter), a, BAND_W / 2, b - a);
        }
      }

      // --- Tick: penuh (selebar pita) di batas blok, pendek (55%) selainnya ---
      // Tick MEMOTONG PITA: mulai di neatline dalam, menuju neatline luar
      // (arah -s), persis seperti cetak — bukan menonjol ke dalam peta.
      ctx.beginPath();
      for (let sec = Math.ceil(axisStartSec / tickSec) * tickSec; sec <= axisEndSec; sec += tickSec) {
        const pos = toPos(sec / 3600);
        if (pos < axisMin - 8 || pos > axisMax + 8) continue;
        const isBlockEdge = Math.abs(Math.round(sec)) % blockSec === 0;
        const len = isBlockEdge ? BAND_W : tickMinor;
        if (isH) {
          ctx.moveTo(pos, lineInner);
          ctx.lineTo(pos, lineInner - len * s);
        } else {
          ctx.moveTo(lineInner, pos);
          ctx.lineTo(lineInner - len * s, pos);
        }
      }
      ctx.stroke();

      // --- Tiga neatline tipis ---
      ctx.beginPath();
      if (isH) {
        ctx.moveTo(fx0, lineOuter); ctx.lineTo(fx1, lineOuter);
        ctx.moveTo(fx0, lineMid); ctx.lineTo(fx1, lineMid);
        ctx.moveTo(fx0, lineInner); ctx.lineTo(fx1, lineInner);
      } else {
        ctx.moveTo(lineOuter, fy0); ctx.lineTo(lineOuter, fy1);
        ctx.moveTo(lineMid, fy0); ctx.lineTo(lineMid, fy1);
        ctx.moveTo(lineInner, fy0); ctx.lineTo(lineInner, fy1);
      }
      ctx.stroke();

      // --- Label + tonjolan 6 px, HANYA di kelipatan 30'/derajat ---
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let sec = Math.ceil(axisStartSec / labelSec) * labelSec; sec <= axisEndSec; sec += labelSec) {
        const pos = toPos(sec / 3600);
        // Jauhkan label dari sudut bingkai (hindari bertumpuk dengan pita
        // yang tegak lurus).
        if (pos < axisMin + 16 || pos > axisMax - 16) continue;
        const text = frameLabel(sec, axis);
        const tw = ctx.measureText(text).width;
        if (side === 'bottom') {
          const bx = pos - tw / 2;
          const by = lineOuter + LABEL_PROJ + 2;
          const collides = reserved.some(
            (r) => bx < r.x + r.w && bx + tw > r.x && by < r.y + r.h && by + 14 > r.y,
          );
          if (collides) continue;
        }
        // Tonjolan: garis pendek dari neatline luar ke arah label.
        ctx.beginPath();
        if (side === 'bottom') {
          ctx.moveTo(pos, lineOuter); ctx.lineTo(pos, lineOuter + LABEL_PROJ);
        } else if (side === 'top') {
          ctx.moveTo(pos, lineOuter); ctx.lineTo(pos, lineOuter - LABEL_PROJ);
        } else if (side === 'right') {
          ctx.moveTo(lineOuter, pos); ctx.lineTo(lineOuter + LABEL_PROJ, pos);
        } else {
          ctx.moveTo(lineOuter, pos); ctx.lineTo(lineOuter - LABEL_PROJ, pos);
        }
        ctx.stroke();

        // Teks tegak (tidak diputar), serif tipis 12 px #1a1a1a.
        if (side === 'bottom') {
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(text, pos, lineOuter + LABEL_PROJ + 3);
        } else if (side === 'top') {
          ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
          ctx.fillText(text, pos, lineOuter - LABEL_PROJ - 3);
        } else if (side === 'right') {
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(text, lineOuter + LABEL_PROJ + 3, pos);
        } else {
          ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
          ctx.fillText(text, lineOuter - LABEL_PROJ - 3, pos);
        }
      }
    }

    // Variabel geometri bingkai untuk frame render berjalan — diisi
    // drawChartFrame() sebelum drawSide() dipanggil (drawSide membaca lewat
    // closure; definite assignment karena selalu diset lebih dulu).
    let ctx!: CanvasRenderingContext2D;
    let fx0 = 0;
    let fx1 = 0;
    let fy0 = 0;
    let fy1 = 0;

    function drawChartFrame() {
      if (!scaleBorderCanvas || !isMapActive()) return;
      const mapEl = map.getContainer();
      const w = mapEl.clientWidth;
      const h = mapEl.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      scaleBorderCanvas.width = w * dpr;
      scaleBorderCanvas.height = h * dpr;
      scaleBorderCanvas.style.width = w + 'px';
      scaleBorderCanvas.style.height = h + 'px';

      const ctx2d = scaleBorderCanvas.getContext('2d');
      if (!ctx2d) return;
      ctx2d.save();
      ctx2d.scale(dpr, dpr);
      ctx2d.clearRect(0, 0, w, h);
      ctx = ctx2d;

      // Kontainer kecil (hp): kecilkan inset proporsional agar bingkai tetap
      // muat; kontainer normal memakai konstanta penuh 70/22.
      const insetX = Math.max(24, Math.min(FRAME_INSET_X, (w - 160) / 2));
      const insetY = Math.max(14, Math.min(FRAME_INSET_Y, (h - 120) / 2));
      fx0 = insetX;
      fx1 = w - insetX;
      fy0 = insetY;
      fy1 = h - insetY;

      // px/menit bujur dan lintang dihitung TERPISAH — di Web Mercator
      // px/menit bujur konstan sementara px/menit lintang membesar ke kutub.
      const center = map.getCenter();
      const pC = map.latLngToContainerPoint(center);
      const pLng = map.latLngToContainerPoint({ lat: center.lat, lng: center.lng + 1 } as L.LatLngExpression);
      const pLat = map.latLngToContainerPoint({ lat: center.lat + 1, lng: center.lng } as L.LatLngExpression);
      const pxPerMinLng = Math.abs(pLng.x - pC.x) / 60;
      const pxPerMinLat = Math.abs(pLat.y - pC.y) / 60;

      const lvlLng = chooseLabelLevel(pxPerMinLng);
      const lvlLat = chooseLabelLevel(pxPerMinLat);
      const clampIdx = (i: number) => Math.min(i, LADDER_MIN.length - 1);
      const labelSecLng = Math.round(LADDER_MIN[lvlLng] * 60);
      const labelSecLat = Math.round(LADDER_MIN[lvlLat] * 60);
      const blockSecLng = Math.round(LADDER_MIN[clampIdx(lvlLng + BLOCK_LEVELS_BELOW)] * 60);
      const blockSecLat = Math.round(LADDER_MIN[clampIdx(lvlLat + BLOCK_LEVELS_BELOW)] * 60);
      const tickSecLng = Math.round(LADDER_MIN[clampIdx(lvlLng + TICK_LEVELS_BELOW)] * 60);
      const tickSecLat = Math.round(LADDER_MIN[clampIdx(lvlLat + TICK_LEVELS_BELOW)] * 60);

      const bounds = map.getBounds();
      const westSec = Math.round(bounds.getWest() * 3600);
      const eastSec = Math.round(bounds.getEast() * 3600);
      const southSec = Math.round(Math.max(-85, bounds.getSouth()) * 3600);
      const northSec = Math.round(Math.min(85, bounds.getNorth()) * 3600);

      const toLngX = (deg: number) =>
        map.latLngToContainerPoint({ lat: 0, lng: deg } as L.LatLngExpression).x;
      const toLatY = (deg: number) =>
        map.latLngToContainerPoint({ lat: deg, lng: 0 } as L.LatLngExpression).y;

      // ---- Garis kisi 0.6 px di setiap POSISI LABEL (posisi bujur atas =
      // bawah; lintang kiri = kanan — cukup digambar sekali), dari bingkai
      // ke bingkai. Digambar sebelum pita agar berada di bawahnya.
      ctx.strokeStyle = GRAT_COLOR;
      ctx.lineWidth = GRAT_W;
      ctx.beginPath();
      for (let sec = Math.ceil(westSec / labelSecLng) * labelSecLng; sec <= eastSec; sec += labelSecLng) {
        const x = toLngX(sec / 3600);
        if (x < fx0 + BAND_W || x > fx1 - BAND_W) continue;
        ctx.moveTo(x, fy0 + BAND_W);
        ctx.lineTo(x, fy1 - BAND_W);
      }
      for (let sec = Math.ceil(southSec / labelSecLat) * labelSecLat; sec <= northSec; sec += labelSecLat) {
        const y = toLatY(sec / 3600);
        if (y < fy0 + BAND_W || y > fy1 - BAND_W) continue;
        ctx.moveTo(fx0 + BAND_W, y);
        ctx.lineTo(fx1 - BAND_W, y);
      }
      ctx.stroke();

      // ---- Empat sisi bingkai: pita + tick + label (pola identik).
      ctx.font = LABEL_FONT;
      ctx.strokeStyle = FRAME_COLOR;
      ctx.fillStyle = FRAME_COLOR;
      ctx.lineWidth = 1;

      // Kontrol Leaflet yang tak boleh tertutup label bawah.
      const bottomReserved = [
        { x: 0, y: h - 44, w: 140, h: 44 },        // kontrol skala kiri-bawah
        { x: w - 230, y: h - 30, w: 230, h: 30 },  // atribusi kanan-bawah
      ];

      drawSide({
        side: 'top', axis: 'lng',
        axisStartSec: westSec, axisEndSec: eastSec,
        labelSec: labelSecLng, blockSec: blockSecLng, tickSec: tickSecLng,
        toPos: toLngX, reserved: [],
      });
      drawSide({
        side: 'bottom', axis: 'lng',
        axisStartSec: westSec, axisEndSec: eastSec,
        labelSec: labelSecLng, blockSec: blockSecLng, tickSec: tickSecLng,
        toPos: toLngX, reserved: bottomReserved,
      });
      drawSide({
        side: 'left', axis: 'lat',
        axisStartSec: southSec, axisEndSec: northSec,
        labelSec: labelSecLat, blockSec: blockSecLat, tickSec: tickSecLat,
        toPos: toLatY, reserved: [],
      });
      drawSide({
        side: 'right', axis: 'lat',
        axisStartSec: southSec, axisEndSec: northSec,
        labelSec: labelSecLat, blockSec: blockSecLat, tickSec: tickSecLat,
        toPos: toLatY, reserved: [],
      });

      ctx.restore();
    }

    function scheduleScaleBorderRedraw() {
      if (!isMapActive()) return;
      if (scaleBorderRAF !== null) return;
      scaleBorderRAF = requestAnimationFrame(() => {
        scaleBorderRAF = null;
        if (isMapActive()) drawChartFrame();
      });
    }

    scaleBorderCanvas = document.createElement('canvas');
    scaleBorderCanvas.style.position = 'absolute';
    scaleBorderCanvas.style.top = '0';
    scaleBorderCanvas.style.left = '0';
    scaleBorderCanvas.style.pointerEvents = 'none';
    // ABOVE .leaflet-map-pane (z-index 400) so the chart frame is never
    // buried under the map tiles; still below the controls (800/1000).
    scaleBorderCanvas.style.zIndex = '460';
    scaleBorderCanvas.style.width = '100%';
    scaleBorderCanvas.style.height = '100%';
    map.getContainer().appendChild(scaleBorderCanvas);

    map.on('move zoom moveend zoomend resize viewreset', scheduleScaleBorderRedraw);
    // Toggle layar penuh ("Layar Penuh" / "Keluar layar penuh"): ukuran
    // kontainer berubah di luar event Leaflet — gambar ulang setelah layout
    // fullscreen settle (dua tahap, selaras dengan invalidateSize di atas).
    frameFullscreenHandler = () => {
      setTimeout(() => { if (isMapActive()) drawChartFrame(); }, 150);
      setTimeout(() => { if (isMapActive()) drawChartFrame(); }, 450);
    };
    document.addEventListener('fullscreenchange', frameFullscreenHandler);
    frameResizeHandler = () => scheduleScaleBorderRedraw();
    window.addEventListener('resize', frameResizeHandler);
    setTimeout(() => {
      if (isMapActive()) drawChartFrame();
    }, 100);

    // ---- Depth numbers overlay ("Angka kedalaman") ----
    // A separate canvas that sits ABOVE the tile panes but BELOW the
    // scale-border canvas (so the chart frame is on top of the soundings).
    // Pointer-events: none so the map remains draggable/clickable.
    //
    // The canvas is redrawn on every moveend/zoomend (debounced 400 ms after
    // the map stops moving — see scheduleDepthRedraw below). Each redraw:
    //   1. Computes the grid interval for the current zoom + density.
    //   2. Enumerates grid points inside the viewport.
    //   3. Looks up each point's elevation in the in-memory cache (sync).
    //   4. Draws every cached ocean point as a number with white halo.
    //   5. If the layer is enabled and there are uncached points, kicks off
    //      a fetch (AbortController; supersedes any in-flight one).
    //
    // As fetches resolve, the next redraw picks up the new cached values.
    let depthCanvas: HTMLCanvasElement | null = null;
    let depthRAF: number | null = null;
    let depthDebounce: ReturnType<typeof setTimeout> | null = null;
    let depthFetchAbort: AbortController | null = null;

    function drawDepthOverlay() {
      if (!depthCanvas || !isMapActive()) return;
      // The depth canvas is hidden by CSS when the layer is disabled
      // (`.seamap-hide-depth`), but we also bail here so we don't waste CPU
      // drawing on a hidden canvas.
      if (!depthEnabledRef.current) {
        const ctx0 = depthCanvas.getContext('2d');
        ctx0?.clearRect(0, 0, depthCanvas.width, depthCanvas.height);
        return;
      }
      const mapEl = map.getContainer();
      const w = mapEl.clientWidth;
      const h = mapEl.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      depthCanvas.width = w * dpr;
      depthCanvas.height = h * dpr;
      depthCanvas.style.width = w + 'px';
      depthCanvas.style.height = h + 'px';

      const ctx = depthCanvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      // Compute px-per-degree at the current map centre.
      const center = map.getCenter();
      const pt1 = map.latLngToContainerPoint(center);
      const pt2Lng = map.latLngToContainerPoint({
        lat: center.lat,
        lng: center.lng + 1,
      } as L.LatLngExpression);
      const pt2Lat = map.latLngToContainerPoint({
        lat: center.lat + 1,
        lng: center.lng,
      } as L.LatLngExpression);
      const pxPerDegLng = Math.abs(pt2Lng.x - pt1.x);
      const pxPerDegLat = Math.abs(pt2Lat.y - pt1.y);
      // For interval picking we use the average; the grid is square in degrees
      // anyway, so spacing is roughly the same on both axes near the equator.
      const pxPerDeg = (pxPerDegLng + pxPerDegLat) / 2;

      const source: DepthSource = activeDepthSource;
      const density = depthDensityRef.current;
      const interval: GridInterval = chooseGridInterval(pxPerDeg, density, source);

      const bounds = map.getBounds();
      const west = bounds.getWest();
      const east = bounds.getEast();
      const south = Math.max(-85, bounds.getSouth());
      const north = Math.min(85, bounds.getNorth());

      const points: GridPoint[] = enumerateGridPoints(south, north, west, east, interval.sec);

      // Suppress overlay if there are too many points — show a hint instead.
      const { render, hint } = shouldRenderDepth(points.length);
      setDepthHint(hint);
      if (!render) {
        ctx.restore();
        return;
      }

      // Update the source label so the Layers panel can show it.
      // (We don't need to setState every frame — only when interval changes.)
      // For simplicity we leave the source label static (it depends on env
      // vars, not on zoom).

      // Draw every cached ocean point as a number with white halo.
      ctx.font = '11px "Courier New", ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const EDGE_MARGIN = 14; // px — skip points within 14 px of map edges
      for (const p of points) {
        const elev = getCachedDepth(p.lat, p.lng);
        if (elev === null) continue; // not yet cached — will appear next redraw
        const text = formatDepth(elev, source);
        if (text === null) continue; // land — skip

        const pt = map.latLngToContainerPoint({ lat: p.lat, lng: p.lng } as L.LatLngExpression);
        if (pt.x < EDGE_MARGIN || pt.x > w - EDGE_MARGIN) continue;
        if (pt.y < EDGE_MARGIN || pt.y > h - EDGE_MARGIN) continue;

        // White halo (3 px stroke first), then dark blue-gray text on top.
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 3;
        ctx.strokeText(text, pt.x, pt.y);
        ctx.fillStyle = '#1e3a5f'; // dark blue-gray, reads on road + satellite
        ctx.fillText(text, pt.x, pt.y);
      }
      ctx.restore();
    }

    function scheduleDepthRedraw() {
      if (!isMapActive()) return;
      if (depthDebounce !== null) {
        clearTimeout(depthDebounce);
      }
      // Debounce 400 ms after the map stops moving, then redraw via RAF.
      depthDebounce = setTimeout(() => {
        depthDebounce = null;
        if (!isMapActive()) return;
        if (depthRAF !== null) return;
        depthRAF = requestAnimationFrame(() => {
          depthRAF = null;
          if (!isMapActive()) return;
          drawDepthOverlay();
          // Kick off a fetch for any uncached points in the current viewport.
          // The fetch resolves asynchronously; when it does, we redraw again
          // so the new values appear.
          void maybeFetchDepths();
        });
      }, 400);
    }

    /**
     * Fire a depth fetch for the current viewport if the layer is enabled
     * and there are uncached grid points. Supersedes any in-flight fetch via
     * AbortController. On error/rate-limit, sets `depthStatus` so the UI
     * can show a non-blocking notice and continues using cached values.
     */
    async function maybeFetchDepths(): Promise<void> {
      if (!isMapActive() || !depthEnabledRef.current) return;
      if (activeDepthSource === 'NONE') return;
      // Abort the previous in-flight fetch.
      if (depthFetchAbort) {
        depthFetchAbort.abort();
      }
      const ctrl = new AbortController();
      depthFetchAbort = ctrl;

      // Re-enumerate points (cheap) — the viewport may have shifted during
      // the debounce window.
      const center = map.getCenter();
      const pt1 = map.latLngToContainerPoint(center);
      const pt2Lng = map.latLngToContainerPoint({
        lat: center.lat,
        lng: center.lng + 1,
      } as L.LatLngExpression);
      const pt2Lat = map.latLngToContainerPoint({
        lat: center.lat + 1,
        lng: center.lng,
      } as L.LatLngExpression);
      const pxPerDeg = (Math.abs(pt2Lng.x - pt1.x) + Math.abs(pt2Lat.y - pt1.y)) / 2;
      const interval = chooseGridInterval(pxPerDeg, depthDensityRef.current, activeDepthSource);
      const bounds = map.getBounds();
      const points = enumerateGridPoints(
        Math.max(-85, bounds.getSouth()),
        Math.min(85, bounds.getNorth()),
        bounds.getWest(),
        bounds.getEast(),
        interval.sec,
      );
      if (points.length === 0) return;
      if (points.length > 400) return; // would be suppressed anyway

      setDepthStatus('loading');
      try {
        const result = await fetchDepths(points, ctrl.signal);
        if (ctrl.signal.aborted || !isMapActive()) return;
        setDepthStatus(result.status);
        // Force a redraw so the new values appear.
        if (depthRAF !== null) return;
        depthRAF = requestAnimationFrame(() => {
          depthRAF = null;
          if (isMapActive()) drawDepthOverlay();
        });
      } catch {
        if (!ctrl.signal.aborted && isMapActive()) {
          setDepthStatus('error');
        }
      }
    }

    depthCanvas = document.createElement('canvas');
    depthCanvas.style.position = 'absolute';
    depthCanvas.style.top = '0';
    depthCanvas.style.left = '0';
    depthCanvas.style.pointerEvents = 'none';
    // CRITICAL: this canvas is a SIBLING of .leaflet-map-pane, which Leaflet
    // gives z-index 400. Anything below 400 renders UNDER the (opaque) map
    // tiles and is invisible. 450 sits above the map pane but below the
    // scale-border canvas (460) and the controls (800/1000).
    depthCanvas.style.zIndex = '450';
    depthCanvas.style.width = '100%';
    depthCanvas.style.height = '100%';
    map.getContainer().appendChild(depthCanvas);

    // Redraw on map move (debounced) — same trigger as the scale border.
    map.on('moveend zoomend resize viewreset', scheduleDepthRedraw);

    // Also redraw when the user toggles the layer or changes density.
    const onDepthToggle = () => {
      if (!isMapActive()) return;
      if (depthEnabledRef.current) {
        scheduleDepthRedraw();
      } else {
        // Layer disabled — clear the canvas immediately.
        if (depthCanvas) {
          const ctx = depthCanvas.getContext('2d');
          ctx?.clearRect(0, 0, depthCanvas.width, depthCanvas.height);
        }
        setDepthHint(null);
        setDepthStatus('idle');
        if (depthFetchAbort) depthFetchAbort.abort();
      }
    };
    window.addEventListener(depthToggleEvent, onDepthToggle);

    // Initial draw (after a tick so the canvas has a real size), then kick
    // off the first fetch — without this the depth layer stays empty until
    // the user pans/zooms, because maybeFetchDepths was previously only
    // wired to moveend/zoomend.
    setTimeout(() => {
      if (!isMapActive()) return;
      drawDepthOverlay();
      void maybeFetchDepths();
    }, 200);

    // Layer groups for SAR overlays
    const markersLayer = L.layerGroup().addTo(map);
    const linesLayer = L.layerGroup().addTo(map);
    const polygonsLayer = L.layerGroup().addTo(map);
    const circlesLayer = L.layerGroup().addTo(map);

    // ---- Cursor coordinate readout (top-left) ----
    const CoordControl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'sar-coord-readout');
        div.textContent = '— · —';
        return div;
      },
    });
    const coordCtrl = new CoordControl({ position: 'topleft' });
    coordCtrl.addTo(map);
    const readoutEl = (coordCtrl as unknown as { _container: HTMLDivElement })._container;

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      const lat = e.latlng.lat;
      const lng = ((e.latlng.lng + 540) % 360) - 180;
      readoutEl.textContent = `${formatDMS(lat, true)}  ${formatDMS(lng, false)}`;
    });
    map.on('mouseout', () => {
      readoutEl.textContent = '— · —';
    });

    // ---- Scale control (metric + nautical) ----
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

    // ---- Disclaimer badge (top-right) ----
    const DisclaimerControl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'sar-disclaimer-badge');
        div.textContent = `⚠ ${mapDisclaimer}`;
        div.title = mapDisclaimer;
        return div;
      },
    });
    new DisclaimerControl({ position: 'topright' }).addTo(map);

    // ---- Custom layer-control panel ----
    const LayerPanelControl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'sar-layer-controls');
        const depthSourceLabel = getDepthSourceLabel();
        div.innerHTML = `
          <h4>Map Layers</h4>
          ${basemap === 'onc'
            ? `<div class="layer-row"><label><input type="checkbox" id="${mapControlId(mapScope, 'onc')}" checked /> ONC · World Navigation Charts (1:1.000.000)</label></div>`
            : `<div class="layer-row"><label><input type="checkbox" id="${mapControlId(mapScope, 'osm')}" checked /> OpenStreetMap (base)</label></div>
               <div class="layer-row"><label><input type="checkbox" id="${mapControlId(mapScope, 'seamark')}" checked /> OpenSeaMap (seamark)</label></div>`}
          <div class="layer-row">
            <label><input type="checkbox" id="${mapControlId(mapScope, 'grid')}" checked suppressHydrationWarning /> Bingkai skala</label>
          </div>
          ${basemap !== 'onc' ? `<div class="layer-row">
            <label><input type="checkbox" id="${mapControlId(mapScope, 'depth')}" suppressHydrationWarning /> Angka kedalaman</label>
            <div class="layer-density" id="${mapControlId(mapScope, 'density-wrap')}" style="display:none; margin-top:4px;">
              <label class="layer-density-label">Kepadatan:
                <select id="${mapControlId(mapScope, 'density')}" style="font-size:10px; margin-left:4px;">
                  <option value="rapat">Rapat</option>
                  <option value="sedang" selected>Sedang</option>
                  <option value="jarang">Jarang</option>
                </select>
              </label>
              <div class="layer-source" id="${mapControlId(mapScope, 'depth-source')}">${depthSourceLabel}</div>
              <div class="layer-source-hint">Interpolasi grid; bukan hasil survei. Tidak untuk navigasi.</div>
              <div class="layer-status" id="${mapControlId(mapScope, 'depth-status')}"></div>
              <div class="layer-hint" id="${mapControlId(mapScope, 'depth-hint')}" style="display:none;"></div>
            </div>
          </div>` : ''}
        `;
        return div;
      },
    });
    new LayerPanelControl({ position: 'topright' }).addTo(map);

    // Wire up the layer-control panel after it's added to DOM
    const osmTile = (map as unknown as { _layers: Record<string, { _url?: string }> })._layers;
    setTimeout(() => {
      if (!isMapActive()) return;
      const gridCb = document.getElementById(mapControlId(mapScope, 'grid')) as HTMLInputElement | null;
      if (gridCb && scaleBorderCanvas) {
        gridCb.addEventListener('change', () => {
          scaleBorderCanvas!.style.display = gridCb.checked ? 'block' : 'none';
          if (gridCb.checked) drawChartFrame();
        });
      }
      // Depth checkbox + density dropdown.
      const depthCb = document.getElementById(mapControlId(mapScope, 'depth')) as HTMLInputElement | null;
      const densityWrap = document.getElementById(mapControlId(mapScope, 'density-wrap'));
      const densitySel = document.getElementById(mapControlId(mapScope, 'density')) as HTMLSelectElement | null;
      if (depthCb) {
        // Reflect initial viewPrefs state.
        depthCb.checked = depthEnabledRef.current;
        if (densityWrap) densityWrap.style.display = depthCb.checked ? 'block' : 'none';
        depthCb.addEventListener('change', () => {
          const next = depthCb.checked;
          // Sync React state — this triggers the useEffect that updates
          // depthEnabledRef.current and dispatches the toggle event.
          setViewPrefs((prev) => ({ ...prev, depth: next }));
          if (densityWrap) densityWrap.style.display = next ? 'block' : 'none';
        });
      }
      if (densitySel) {
        densitySel.value = depthDensityRef.current;
        densitySel.addEventListener('change', () => {
          const v = densitySel.value;
          if (v === 'rapat' || v === 'sedang' || v === 'jarang') {
            setDepthDensity(v);
          }
        });
      }
      // osm/seamark toggles: locate the tile layers by URL
      const osmCb = document.getElementById(mapControlId(mapScope, 'osm')) as HTMLInputElement | null;
      const seamarkCb = document.getElementById(mapControlId(mapScope, 'seamark')) as HTMLInputElement | null;
      const oncCb = document.getElementById(mapControlId(mapScope, 'onc')) as HTMLInputElement | null;
      if (osmTile) {
        for (const key of Object.keys(osmTile)) {
          const layer = osmTile[key];
          if (!layer || !layer._url) continue;
          if (layer._url === OSM_URL && osmCb) {
            osmCb.addEventListener('change', () =>
              osmCb.checked ? map.addLayer(layer as unknown as L.Layer) : map.removeLayer(layer as unknown as L.Layer));
          } else if (layer._url === SEAMARK_URL && seamarkCb) {
            seamarkCb.addEventListener('change', () =>
              seamarkCb.checked ? map.addLayer(layer as unknown as L.Layer) : map.removeLayer(layer as unknown as L.Layer));
          }
        }
        if (oncCb) {
          for (const key of Object.keys(osmTile)) {
            const layer = osmTile[key];
            if (layer?._url === ONC_URL) oncCb.addEventListener('change', () => oncCb.checked
              ? map.addLayer(layer as unknown as L.Layer)
              : map.removeLayer(layer as unknown as L.Layer));
          }
        }
      }
      void osmTile;
    }, 50);

    // Sync depth status text + checkbox state from React state → DOM.
    // The Layers panel is built imperatively (Leaflet Control), so we need
    // a side-channel to push state updates into it. The fresh values ride
    // on the event's `detail` — this handler is bound once inside the mount
    // effect, so closure-over state would be permanently stale.
    const syncDepthPanel = (e: Event) => {
      const detail = (e as CustomEvent<{ status?: DepthStatus; hint?: string | null }>).detail;
      const cb = document.getElementById(mapControlId(mapScope, 'depth')) as HTMLInputElement | null;
      if (cb && cb.checked !== depthEnabledRef.current) cb.checked = depthEnabledRef.current;
      const wrap = document.getElementById(mapControlId(mapScope, 'density-wrap'));
      if (wrap) wrap.style.display = depthEnabledRef.current ? 'block' : 'none';
      const sel = document.getElementById(mapControlId(mapScope, 'density')) as HTMLSelectElement | null;
      if (sel && sel.value !== depthDensityRef.current) sel.value = depthDensityRef.current;
      const statusEl = document.getElementById(mapControlId(mapScope, 'depth-status'));
      if (statusEl) {
        const s = detail?.status ?? 'idle';
        const statusText =
          s === 'loading' ? 'Memuat…'
          : s === 'rate-limited' ? 'Rate limit — pakai cache'
          : s === 'error' ? 'Data kedalaman gagal dimuat'
          : '';
        statusEl.textContent = statusText;
        statusEl.style.display = statusText ? 'block' : 'none';
      }
      const hintEl = document.getElementById(mapControlId(mapScope, 'depth-hint'));
      if (hintEl) {
        const hint = detail?.hint ?? null;
        hintEl.textContent = hint ?? '';
        hintEl.style.display = hint ? 'block' : 'none';
      }
    };
    // Subscribe to React state changes — but the panel DOM is owned by Leaflet,
    // so we just re-sync on every render. We do this via a window event the
    // SeaMap component dispatches from a useEffect below.
    window.addEventListener(depthPanelSyncEvent, syncDepthPanel);

    // ---- Map click handler ----
    const measureMarkers: L.Marker[] = [];
    let measureLine: L.Polyline | null = null;

    map.on('click', (e: L.LeafletMouseEvent) => {
      const lat = e.latlng.lat;
      const lng = ((e.latlng.lng + 540) % 360) - 180;
      const latlng: LatLng = { lat, lng };

      // Measure mode: append vertex to a measurement polyline
      if (measureModeRef.current) {
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: 'sar-measure-vertex',
            html: '<div style="width:8px;height:8px;border-radius:50%;background:#dc2626;border:2px solid #fff;"></div>',
            iconSize: [8, 8],
            iconAnchor: [4, 4],
          }),
          interactive: false,
        }).addTo(map);
        measureMarkers.push(marker);

        if (measureMarkers.length >= 2) {
          const pts = measureMarkers.map((m) => m.getLatLng());
          if (measureLine) {
            measureLine.setLatLngs(pts);
          } else {
            measureLine = L.polyline(pts, {
              color: '#dc2626',
              weight: 2,
              dashArray: '4 4',
              interactive: false,
            }).addTo(map);
          }
          let totalNm = 0;
          for (let i = 1; i < pts.length; i++) {
            totalNm += distanceNm(
              { lat: pts[i - 1].lat, lng: pts[i - 1].lng },
              { lat: pts[i].lat, lng: pts[i].lng },
            );
          }
          const totalKm = totalNm * 1.852;
          if (measureLine) {
            measureLine.bindTooltip(
              `${totalNm.toFixed(2)} NM · ${totalKm.toFixed(2)} km (${pts.length} pts)`,
              { permanent: true, direction: 'top', className: 'sar-label' },
            );
          }
        }
        return;
      }

      // Pick-LKP mode: call onMapClick to set LKP
      if (pickModeRef.current && onMapClickRef.current) {
        onMapClickRef.current(latlng);
        return;
      }
    });

    // Double-click clears measurement
    map.on('dblclick', () => {
      for (const m of measureMarkers) map.removeLayer(m);
      measureMarkers.length = 0;
      if (measureLine) {
        map.removeLayer(measureLine);
        measureLine = null;
      }
    });

    layersRef.current = {
      markers: markersLayer,
      lines: linesLayer,
      polygons: polygonsLayer,
      circles: circlesLayer,
      measureMarkers,
      measureLine,
    };

    mapRef.current = map;

    // Layar penuh (tombol "Layar Penuh" kartu Peta Laut): ukuran kontainer
    // berubah saat fullscreenchange. Leaflet meng-cache ukuran internal —
    // tanpa invalidateSize tile hanya tergambar pada area lama. Dua tahap:
    // setelah layout fullscreen settle, lalu sekali lagi untuk aman.
    const onFullscreenChange = () => {
      setTimeout(() => {
        if (isMapActive() && mapRef.current === map) map.invalidateSize();
      }, 150);
      setTimeout(() => {
        if (isMapActive() && mapRef.current === map) map.invalidateSize();
      }, 450);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);

    setTimeout(() => {
      if (isMapActive()) map.invalidateSize();
    }, 200);

    return () => {
      disposed = true;
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (frameFullscreenHandler) {
        document.removeEventListener('fullscreenchange', frameFullscreenHandler);
        frameFullscreenHandler = null;
      }
      if (frameResizeHandler) {
        window.removeEventListener('resize', frameResizeHandler);
        frameResizeHandler = null;
      }
      if (scaleBorderRAF !== null) {
        cancelAnimationFrame(scaleBorderRAF);
        scaleBorderRAF = null;
      }
      if (scaleBorderCanvas && scaleBorderCanvas.parentNode) {
        scaleBorderCanvas.parentNode.removeChild(scaleBorderCanvas);
      }
      // Depth overlay cleanup: abort in-flight fetch, cancel pending RAF,
      // remove canvas + event listener.
      if (depthFetchAbort) {
        depthFetchAbort.abort();
        depthFetchAbort = null;
      }
      if (depthDebounce !== null) {
        clearTimeout(depthDebounce);
        depthDebounce = null;
      }
      if (depthRAF !== null) {
        cancelAnimationFrame(depthRAF);
        depthRAF = null;
      }
      window.removeEventListener(depthToggleEvent, onDepthToggle);
      window.removeEventListener(depthPanelSyncEvent, syncDepthPanel);
      if (depthCanvas && depthCanvas.parentNode) {
        depthCanvas.parentNode.removeChild(depthCanvas);
      }
      map.remove();
      mapRef.current = null;
      layersRef.current = {};
    };
  }, [mapScope, depthToggleEvent, depthPanelSyncEvent, basemap, mapDisclaimer]);

  // ---- Update center/zoom when props change ----
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setView([center.lat, center.lng], zoom);
  }, [center.lat, center.lng, zoom]);

  // ---- Zoom otomatis ke bounds lingkaran radius + titik A (Panduan Datum §5) ----
  const autoFitKey = autoFitTo?.key;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !autoFitTo || !autoFitKey) return;
    const pts = (autoFitTo.points ?? []).filter(
      (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
    if (pts.length === 0) return;
    const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number]));
    const radiusNm = autoFitTo.radiusNm;
    if (radiusNm && radiusNm > 0) {
      // Perluas bounds dengan lingkaran radius (proyeksi geodesik 4 arah).
      const c = pts[pts.length - 1];
      const edge = {
        north: project(c, 0, radiusNm),
        south: project(c, 180, radiusNm),
        east: project(c, 90, radiusNm),
        west: project(c, 270, radiusNm),
      };
      bounds.extend([
        [edge.north.lat, edge.north.lng],
        [edge.south.lat, edge.south.lng],
        [edge.east.lat, edge.east.lng],
        [edge.west.lat, edge.west.lng],
      ]);
    }
    try {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    } catch {
      // bounds tidak valid — abaikan, jangan matikan peta
    }
  }, [autoFitKey]);

  // ---- Toggle measure mode: clear measurement when leaving measure mode ----
  useEffect(() => {
    const layers = layersRef.current;
    if (!mapRef.current || !layers) return;
    if (!measureMode) {
      for (const m of layers.measureMarkers ?? []) mapRef.current.removeLayer(m);
      layers.measureMarkers = [];
      if (layers.measureLine) {
        mapRef.current.removeLayer(layers.measureLine);
        layers.measureLine = null;
      }
    }
  }, [measureMode]);

  // ---- Draw markers ----
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.markers) return;
    const map = mapRef.current;
    const layer = layersRef.current.markers;
    for (const label of layersRef.current.pointLabels ?? []) map.removeLayer(label);
    const pointLabels: L.Tooltip[] = [];
    const labelCandidates: Array<{ marker: L.Marker; tooltip: L.Tooltip; text: string; preferred?: MapMarker['labelDirection'] }> = [];
    layer.clearLayers();
    markers.forEach((m) => {
      // Lewati marker dengan posisi tak valid — satu data rusak tidak boleh
      // mematikan seluruh peta (dulu: Leaflet lempar "reading 'lat'" di dalam
      // project() dan SeaMapErrorBoundary menampilkan "peta gagal dimuat").
      if (!m.position || !Number.isFinite(m.position.lat) || !Number.isFinite(m.position.lng)) return;
      const color = m.color ?? '#ef4444';
      const marker = L.marker([m.position.lat, m.position.lng], {
        icon: makeColoredIcon(color, m.isStart, m.isDatum, m.sequence, m.cross),
      }).addTo(layer);
      if (m.showLabel) {
        const tooltip = L.tooltip({
          permanent: true,
          direction: 'center',
          className: 'sar-point-label',
          opacity: 1,
          interactive: false,
        })
          // Tooltip wajib punya latlng sebelum addTo — tanpa ini DivOverlay
          // memproyeksikan _latlng undefined dan merusak peta.
          .setLatLng(m.position)
          .setContent(escapeHtml(m.label));
        tooltip.addTo(map);
        pointLabels.push(tooltip);
        labelCandidates.push({ marker, tooltip, text: m.label, preferred: m.labelDirection });
      }
      marker.bindPopup(
        `<b>${escapeHtml(m.label)}</b><br/>${formatDMS(m.position.lat, true)}, ${formatDMS(m.position.lng, false)}`,
      );
      marker.on('click', (e) => {
        if (m.onClick) {
          L.DomEvent.stopPropagation(e);
          m.onClick();
          return;
        }
        if (pickModeRef.current && onMapClickRef.current) {
          L.DomEvent.stopPropagation(e);
          onMapClickRef.current(m.position);
        }
      });
    });
    layersRef.current.pointLabels = pointLabels;

    // Keep permanent labels legible at every zoom. Labels are separate map
    // overlays so nearby markers can spread their captions around the point
    // cluster instead of stacking in the same pixel location.
    const placeLabels = () => {
      if (!map.getContainer().isConnected || labelCandidates.length === 0) return;
      const size = map.getSize();
      const placed: Array<{ left: number; top: number; right: number; bottom: number }> = [];
      for (const item of labelCandidates) {
        const point = map.latLngToContainerPoint(item.marker.getLatLng());
        const width = Math.min(size.x - 12, Math.max(44, item.text.length * 6.5 + 18));
        const height = 24;
        const margin = 12;
        const candidates = [
          { direction: 'top' as const, left: point.x - width / 2, top: point.y - height - margin },
          { direction: 'right' as const, left: point.x + margin, top: point.y - height / 2 },
          { direction: 'bottom' as const, left: point.x - width / 2, top: point.y + margin },
          { direction: 'left' as const, left: point.x - width - margin, top: point.y - height / 2 },
          { direction: 'top' as const, left: point.x + 14, top: point.y - height - margin },
          { direction: 'top' as const, left: point.x - width - 14, top: point.y - height - margin },
          { direction: 'bottom' as const, left: point.x + 14, top: point.y + margin },
          { direction: 'bottom' as const, left: point.x - width - 14, top: point.y + margin },
        ];
        let best: typeof candidates[number] | undefined;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
          const rect = { left: candidate.left, top: candidate.top, right: candidate.left + width, bottom: candidate.top + height };
          let score = candidate.direction === item.preferred ? 0 : 28;
          const overflow = Math.max(0, 6 - rect.left) + Math.max(0, rect.right - (size.x - 6))
            + Math.max(0, 6 - rect.top) + Math.max(0, rect.bottom - (size.y - 6));
          score += overflow * 80;
          for (const other of placed) {
            const overlapWidth = Math.max(0, Math.min(rect.right, other.right) - Math.max(rect.left, other.left));
            const overlapHeight = Math.max(0, Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top));
            score += overlapWidth * overlapHeight * 4;
          }
          if (score < bestScore) { best = candidate; bestScore = score; }
        }
        if (!best) continue;
        const rect = { left: best.left, top: best.top, right: best.left + width, bottom: best.top + height };
        placed.push(rect);
        item.tooltip.setLatLng(map.containerPointToLatLng(L.point(rect.left + width / 2, rect.top + height / 2)));
      }
    };
    map.on('zoomend moveend resize', placeLabels);
    requestAnimationFrame(placeLabels);

    return () => {
      map.off('zoomend moveend resize', placeLabels);
      for (const label of pointLabels) map.removeLayer(label);
      if (layersRef.current.pointLabels === pointLabels) layersRef.current.pointLabels = [];
    };
  }, [markers]);

  // ---- Draw lines ----
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.lines) return;
    const map = mapRef.current;
    const layer = layersRef.current.lines;

    // Digambar ulang saat zoom agar rotasi & penempatan label (ruang px layar)
    // tetap akurat — sekaligus memperbaiki panah yang dihitung dalam px layer.
    const drawLines = () => {
      layer.clearLayers();
      const pxSegs = lines
        .filter((l) => Number.isFinite(l.from?.lat) && Number.isFinite(l.from?.lng) && Number.isFinite(l.to?.lat) && Number.isFinite(l.to?.lng))
        .map((l) => ({
          line: l,
          a: map.latLngToLayerPoint([l.from.lat, l.from.lng]),
          b: map.latLngToLayerPoint([l.to.lat, l.to.lng]),
        }));

      // Label garis: dirotasi mengikuti bearing garis di ruang layar; label
      // garis pendek digeser agar tidak menutupi garis/label lain.
      const fontSizeOf = (l: MapLine) => (l.labelClassName === 'sar-pattern-label' ? 10 : 11);
      const placements = new Map<number, LabelPlacement>();
      const labeled = pxSegs
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => !!s.line.label);
      if (labeled.length > 0) {
        const items = labeled.map(({ s, idx }) => ({
          id: String(idx),
          x1: s.a.x,
          y1: s.a.y,
          x2: s.b.x,
          y2: s.b.y,
          label: s.line.label as string,
        }));
        const obstacleSegments = pxSegs.map((s, idx) => ({
          id: String(idx),
          x1: s.a.x,
          y1: s.a.y,
          x2: s.b.x,
          y2: s.b.y,
        }));
        const centerPx = map.latLngToLayerPoint(map.getCenter());
        for (const pl of placeAlongLineLabels(items, {
          fontSize: 11,
          minPad: 3,
          padX: 6,
          obstacleSegments,
          sceneCenter: { x: centerPx.x, y: centerPx.y },
        })) {
          placements.set(Number(pl.id), pl);
        }
      }

      pxSegs.forEach((s, idx) => {
        const l = s.line;
        const polyline = L.polyline(
          [
            [l.from.lat, l.from.lng],
            [l.to.lat, l.to.lng],
          ],
          {
            color: l.color,
            weight: l.weight ?? 2.5,
            opacity: l.opacity ?? 0.85,
            dashArray: l.dashed ? '6 6' : undefined,
          },
        ).addTo(layer);
        if (l.arrow) {
          const startPx = s.a;
          const endPx = s.b;
          const dx = endPx.x - startPx.x;
          const dy = endPx.y - startPx.y;
          const anchorX = startPx.x + dx * 0.68;
          const anchorY = startPx.y + dy * 0.68;
          const angle = Math.atan2(dy, dx);
          const arrowLength = 8;
          const spread = 0.55;
          const left = map.layerPointToLatLng([
            anchorX + arrowLength * Math.cos(angle + Math.PI - spread),
            anchorY + arrowLength * Math.sin(angle + Math.PI - spread),
          ]);
          const anchor = map.layerPointToLatLng([anchorX, anchorY]);
          const right = map.layerPointToLatLng([
            anchorX + arrowLength * Math.cos(angle + Math.PI + spread),
            anchorY + arrowLength * Math.sin(angle + Math.PI + spread),
          ]);
          L.polyline([[left.lat, left.lng], [anchor.lat, anchor.lng], [right.lat, right.lng]], {
            color: l.color,
            weight: l.weight ?? 2.5,
            opacity: l.opacity ?? 0.85,
            interactive: false,
          }).addTo(layer);
        }
        const pl = placements.get(idx);
        if (l.label && pl) {
          const fontSize = fontSizeOf(l);
          const isPattern = l.labelClassName === 'sar-pattern-label';
          const escaped = l.label.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          const centerLL = map.layerPointToLatLng([pl.x, pl.y]);
          const icon = L.divIcon({
            className: 'sar-line-label-rot',
            iconSize: undefined,
            iconAnchor: [0, 0],
            html:
              `<div class="sar-line-label-inner">` +
              `<span class="sar-line-label-text${isPattern ? ' pattern' : ''}" ` +
              `style="transform:rotate(${pl.angleDeg}deg);border-left:3px solid ${l.color};font-size:${fontSize}px">` +
              `${escaped}</span></div>`,
          });
          L.marker(centerLL, { icon, interactive: false, keyboard: false }).addTo(layer);
        }
      });
    };

    drawLines();
    map.on('zoomend', drawLines);
    return () => {
      map.off('zoomend', drawLines);
    };
  }, [lines]);

  // ---- Draw polygons (search areas) ----
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.polygons) return;
    const layer = layersRef.current.polygons;
    layer.clearLayers();
    polygons.forEach((p) => {
      if (!p.points?.length || p.points.some((pt) => !Number.isFinite(pt?.lat) || !Number.isFinite(pt?.lng))) return;
      const latlngs = p.points.map((pt) => [pt.lat, pt.lng] as [number, number]);
      // Garis kotak search area digambar SOLID — putus-putus tidak sesuai
      // penggambaran peta SAR (permintaan pengguna).
      const poly = L.polygon(latlngs, {
        color: p.color,
        weight: 2,
        fillColor: p.fillColor ?? p.color,
        fillOpacity: p.fillOpacity ?? 0.15,
      }).addTo(layer);
      if (p.label) {
        const bounds = L.latLngBounds(latlngs);
        const c = bounds.getCenter();
        L.tooltip({ permanent: true, direction: 'center', className: 'sar-area-label' })
          .setContent(p.label)
          .setLatLng(c)
          .addTo(layer);
      }
    });
  }, [polygons]);

  // ---- Draw circles (search radii, probable error circles) ----
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.circles) return;
    const layer = layersRef.current.circles;
    layer.clearLayers();
    circles.forEach((c) => {
      if (!Number.isFinite(c.center?.lat) || !Number.isFinite(c.center?.lng) || !Number.isFinite(c.radiusNm)) return;
      const radiusMeters = c.radiusNm * 1852;
      const circle = L.circle([c.center.lat, c.center.lng], {
        radius: radiusMeters,
        color: c.color,
        weight: c.weight ?? 1.5,
        fillColor: c.fillColor ?? c.color,
        fillOpacity: c.fillOpacity ?? 0.08,
        dashArray: c.dashArray === null ? undefined : (c.dashArray ?? '3 3'),
      }).addTo(layer);
      if (c.label) {
        L.tooltip({ permanent: false, direction: 'top', className: 'sar-circle-label' })
          .setContent(c.label)
          .setLatLng([c.center.lat, c.center.lng])
          .addTo(layer);
      }
    });
  }, [circles]);

  // ---- Tampilan menu handlers ----
  const togglePref = (key: keyof ViewPrefs) => {
    setViewPrefs((prev) => ({ ...prev, [key]: !prev[key] }));
    clearHideToast();
  };
  const hideAll = () => {
    setViewPrefs((prev) => ({
      layers: false, coord: false, zoom: false, disclaimer: false,
      depth: prev.depth, // depth has its own checkbox — preserved
    }));
    setMenuOpen(false);
    flashHideToast();
  };
  const showAll = () => {
    setViewPrefs((prev) => ({
      ...DEFAULT_VIEW_PREFS,
      depth: prev.depth, // depth has its own checkbox — preserved
    }));
    setMenuOpen(false);
    clearHideToast();
  };

  // Push depth status/hint changes into the imperative Layers panel DOM.
  // Values travel in the event detail — see syncDepthPanel above.
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent(depthPanelSyncEvent, {
        detail: { status: depthStatus, hint: depthHint },
      }),
    );
  }, [depthStatus, depthHint, viewPrefs.depth, depthDensity, depthPanelSyncEvent]);

  const everythingHidden = allHidden(viewPrefs);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height, width: '100%' }}
      role="application"
      aria-label={basemap === 'onc' ? 'Peta ONC udara Worksheet 4 dengan radius pencarian' : 'Interactive sea map showing search and rescue datum, search areas, and bathymetry'}
    >
      <div
        className={mapWrapperClassName}
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
          borderRadius: '0.5rem 0.5rem 0 0',
        }}
      >
        {/* className is a constant so React never re-writes it and Leaflet's
         * own classes (leaflet-container, …) survive every re-render. */}
        <div
          ref={containerRef}
          className="seamap-map"
          style={{ height: '100%', width: '100%' }}
        />

        {/* Tampilan (view) toggle button + menu.
         * Sibling of the map container so it survives the per-element hide
         * classes (which only target Leaflet controls, not this button).
         * Always rendered at full opacity with a text label; when every
         * element is hidden the button turns accent-blue so the recovery
         * path is obvious. */}
        <div
          className={`seamap-tampilan${everythingHidden ? ' is-collapsed' : ''}${menuOpen ? ' is-open' : ''}`}
        >
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="seamap-tampilan-btn"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Tutup menu Tampilan' : 'Buka menu Tampilan'}
            title="Tampilan — sembunyikan/tampilkan elemen peta (H)"
          >
            <svg
              className="seamap-tampilan-btn__icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="seamap-tampilan-btn__label">Tampilan</span>
          </button>

          {menuOpen && (
            <div className="seamap-tampilan-menu" role="menu" aria-label="Pilihan tampilan">
              <label className="seamap-tampilan-row">
                <input
                  type="checkbox"
                  checked={viewPrefs.layers}
                  onChange={() => togglePref('layers')} suppressHydrationWarning
                />
                <span>Panel layer</span>
              </label>
              <label className="seamap-tampilan-row">
                <input
                  type="checkbox"
                  checked={viewPrefs.coord}
                  onChange={() => togglePref('coord')} suppressHydrationWarning
                />
                <span>Koordinat mouse</span>
              </label>
              <label className="seamap-tampilan-row">
                <input
                  type="checkbox"
                  checked={viewPrefs.zoom}
                  onChange={() => togglePref('zoom')} suppressHydrationWarning
                />
                <span>Zoom +/−</span>
              </label>
              <label className="seamap-tampilan-row">
                <input
                  type="checkbox"
                  checked={viewPrefs.disclaimer}
                  onChange={() => togglePref('disclaimer')} suppressHydrationWarning
                />
                <span>Peringatan</span>
              </label>
              {basemap !== 'onc' && (
                <label className="seamap-tampilan-row">
                  <input
                    type="checkbox"
                    checked={viewPrefs.depth}
                    onChange={() => togglePref('depth')} suppressHydrationWarning
                  />
                  <span>Angka kedalaman</span>
                </label>
              )}
              <button
                type="button"
                className="seamap-tampilan-all"
                onClick={everythingHidden ? showAll : hideAll}
                aria-pressed={everythingHidden}
                aria-label={everythingHidden ? 'Tampilkan semua' : 'Sembunyikan semua'}
              >
                {everythingHidden ? 'Tampilkan semua' : 'Sembunyikan semua'}
              </button>
            </div>
          )}
        </div>
        {/* Recovery toast — appears right after the overlays are hidden so
         * the user always knows how to get the map elements back. Anchored
         * inside the relative map wrapper, above the Tampilan button. */}
        {hideToast && (
          <div className="seamap-hide-toast" role="status">
            Elemen peta disembunyikan — klik tombol{' '}
            <strong>Tampilan</strong> di kanan bawah (atau tekan <strong>H</strong>)
            untuk menampilkan kembali.
          </div>
        )}
      </div>

      {/* Disclaimer strip below the map — always visible (even when the
       * top-right badge is hidden), since it lives outside the map area.
       * When the depth layer is active, also show the data-source
       * attribution (GEBCO / BIG) and the "interpolasi grid" note here. */}
      <div className="seamap-disclaimer-strip">
        <strong>⚠ {mapDisclaimer}</strong>
        {basemap !== 'onc' && viewPrefs.depth && (
          <>
            {' '}
            Angka kedalaman hasil interpolasi grid (GEBCO sekitar 450 m / BATNAS sekitar 180 m), bukan hasil survei.
            {activeDepthSource === 'BATNAS_COG' && ' Sumber: BIG Indonesia.'}
            {(activeDepthSource === 'GEBCO_COG' || activeDepthSource === 'OPENTOPO_GEBCO') && ' Sumber: GEBCO Grid.'}
          </>
        )}
      </div>
    </div>
  );
}
