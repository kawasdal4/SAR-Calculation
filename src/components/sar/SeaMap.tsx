'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type LatLng, distanceNm } from '@/lib/sar/sarCalculations';
import { formatDegMinSec, type CoordAxis } from '@/lib/sar/coordFormat';
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

function makeColoredIcon(color: string, isStart?: boolean, isDatum?: boolean, sequence?: number) {
  const shape = sequence !== undefined ? String(sequence) : isStart ? '◆' : isDatum ? '◉' : '●';
  return L.divIcon({
    className: 'sar-marker',
    html: `<div style="
      background:${color};
      width:${isStart ? 22 : 18}px;
      height:${isStart ? 22 : 18}px;
      border-radius:50%;
      border: 2px solid #fff;
      box-shadow: 0 0 4px rgba(0,0,0,.6);
      display:flex;align-items:center;justify-content:center;
      color:#fff;font-size:${sequence !== undefined ? 9 : 11}px;font-weight:bold;
    ">${shape}</div>`,
    iconSize: [isStart ? 22 : 18, isStart ? 22 : 18],
    iconAnchor: [isStart ? 11 : 9, isStart ? 11 : 9],
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

    // ---- Nautical chart scale border (canvas-based) ----
    // Style: NO black/white band. Each side is a 1 px outline at the very
    // edge, with short tick marks projecting INTO the map area:
    //   - minor tick: 5 px long, every `minorSec` arc-seconds
    //   - major tick: 10 px long, every 30′ (or coarser at very far zoom)
    // Ticks are dark (#1a1a1a) with a thin white halo (3 px stroke first,
    // then 1 px dark on top) so they read on both the road map and satellite
    // tiles. Labels (every major interval) sit just inside the map, with a
    // white pill background.
    //
    // Label interval adapts to zoom: 5′, 10′, and 20′ appear at close zoom;
    // coarser intervals are selected as the map zooms out.
    //
    // The four sides share one `drawBand` function — no per-side duplication.
    const MAJOR_TICK_PX = 10;
    const MINOR_TICK_PX = 5;
    const LABEL_MIN_PX_LNG = 60;
    const LABEL_MIN_PX_LAT = 30;
    const MINOR_MIN_PX = 5;
    const MINOR_DENSIFY_PX = 60;

    const MAJOR_LABEL_STEPS_SEC = [300, 600, 1200, 1800, 3600, 7200, 18000];

    let scaleBorderCanvas: HTMLCanvasElement | null = null;
    let scaleBorderRAF: number | null = null;

    function chooseMajorInterval(pxPerDeg: number, minLabelPx: number): number {
      for (const step of MAJOR_LABEL_STEPS_SEC) {
        if (step * pxPerDeg / 3600 >= minLabelPx) return step;
      }
      return MAJOR_LABEL_STEPS_SEC[MAJOR_LABEL_STEPS_SEC.length - 1];
    }

    function chooseMinorInterval(majorSec: number, pxPerDeg: number): number {
      const spacing5 = 300 * pxPerDeg / 3600;
      if (spacing5 >= MINOR_MIN_PX) {
        if (spacing5 > MINOR_DENSIFY_PX) {
          for (const c of [30, 60]) {
            if (c * pxPerDeg / 3600 >= MINOR_MIN_PX && c < majorSec) return c;
          }
          return 300;
        }
        return 300;
      }
      for (const c of [600, 900]) {
        if (c < majorSec && c * pxPerDeg / 3600 >= MINOR_MIN_PX) return c;
      }
      return majorSec;
    }

    /**
     * Unified tick-drawing routine used by all four sides of the chart border.
     * Top/bottom iterate along the longitude axis; left/right iterate along
     * the latitude axis. The exact same tick + label rules apply to every
     * side — only the orientation differs.
     *
     * No black/white band fill is drawn — only:
     *   - tick marks (with white halo) projecting INTO the map from the edge,
     *   - labels at major ticks (just inside the map, with black pill bg).
     * The outer 1 px outline is drawn separately in drawScaleBorder().
     *
     * Labels are collected (not drawn immediately) so drawScaleBorder() can
     * run a single bounding-box collision pass over ALL labels of ALL four
     * sides together — a label that overlaps another label, or overlaps the
     * scale/attribution controls, is dropped instead of stacked.
     */
    function drawBand(args: {
      ctx: CanvasRenderingContext2D;
      orientation: 'top' | 'bottom' | 'left' | 'right';
      axis: CoordAxis;
      axisStart: number;
      axisEnd: number;
      majorSec: number;
      minorSec: number;
      w: number;
      h: number;
      toScreenPos: (axisValueDeg: number) => number;
      // Collect a label candidate (returns the bounding box that would be
      // drawn, or null if the label would not fit inside the map area).
      collectLabel: (text: string, x: number, y: number, align: 'center' | 'left' | 'right', baseline: 'top' | 'middle' | 'bottom', side: 'top' | 'bottom' | 'left' | 'right') => void;
    }): void {
      const {
        ctx, orientation, axis, axisStart, axisEnd,
        majorSec, minorSec, w, h,
        toScreenPos, collectLabel,
      } = args;

      const isHorizontal = orientation === 'top' || orientation === 'bottom';
      const viewportSpan = isHorizontal ? w : h;
      const majSec = Math.round(majorSec);
      const minSec = Math.round(minorSec);

      // Iterate in integer arc-seconds to avoid floating-point drift.
      // For latitude, axisStart = south (most negative), axisEnd = north
      // (least negative / positive). startSec ≤ endSec because ceil() of a
      // more-negative number divided by a positive step yields a smaller
      // (more negative) integer.
      const startSec = Math.ceil(axisStart * 3600 / minSec) * minSec;
      const endSec = Math.ceil(axisEnd * 3600 / minSec) * minSec;

      const LABEL_OFFSET = MAJOR_TICK_PX + 4;

      for (let sec = startSec; sec <= endSec; sec += minSec) {
        const axisValue = sec / 3600;
        const wrappedAxisValue = axis === 'lng'
          ? (((axisValue + 540) % 360) + 360) % 360 - 180
          : axisValue;
        const pos = toScreenPos(wrappedAxisValue);

        if (pos < -40 || pos > viewportSpan + 40) continue;

        const isMajor = (sec % majSec) === 0;
        const tickLen = isMajor ? MAJOR_TICK_PX : MINOR_TICK_PX;

        let x0: number, y0: number, x1: number, y1: number;
        if (orientation === 'top') {
          x0 = pos; y0 = 0; x1 = pos; y1 = tickLen;
        } else if (orientation === 'bottom') {
          x0 = pos; y0 = h - tickLen; x1 = pos; y1 = h;
        } else if (orientation === 'left') {
          x0 = 0; y0 = pos; x1 = tickLen; y1 = pos;
        } else {
          x0 = w - tickLen; y0 = pos; x1 = w; y1 = pos;
        }

        // Halo first (white, 3 px, round caps).
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        // Then the dark tick on top (1 px).
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        // Collect label candidate at major ticks. Spacing/collision is
        // resolved later by the caller — here we just collect every
        // candidate whose tick position is inside the visible area (with a
        // 14 px / 20 px margin so the label has room near the corners).
        if (isMajor) {
          const label = formatDegMinSec(wrappedAxisValue, axis, majorSec);
          if (isHorizontal) {
            if (orientation === 'top') {
              if (pos > MAJOR_TICK_PX + 20 && pos < w - MAJOR_TICK_PX - 20) {
                collectLabel(label, pos, LABEL_OFFSET, 'center', 'top', 'top');
              }
            } else {
              if (pos > MAJOR_TICK_PX + 20 && pos < w - MAJOR_TICK_PX - 20) {
                collectLabel(label, pos, h - LABEL_OFFSET, 'center', 'bottom', 'bottom');
              }
            }
          } else {
            if (orientation === 'left') {
              if (pos > MAJOR_TICK_PX + 14 && pos < h - MAJOR_TICK_PX - 14) {
                collectLabel(label, LABEL_OFFSET, pos, 'left', 'middle', 'left');
              }
            } else {
              if (pos > MAJOR_TICK_PX + 14 && pos < h - MAJOR_TICK_PX - 14) {
                collectLabel(label, w - LABEL_OFFSET, pos, 'right', 'middle', 'right');
              }
            }
          }
        }
      }
    }

    // A label candidate collected by drawBand. Bounding box is computed up
    // front so the collision pass doesn't need to re-measure text.
    interface LabelCandidate {
      text: string;
      x: number;          // text anchor x
      y: number;          // text anchor y
      align: 'center' | 'left' | 'right';
      baseline: 'top' | 'middle' | 'bottom';
      side: 'top' | 'bottom' | 'left' | 'right';
      bgX: number;       // background rect left
      bgY: number;       // background rect top
      tw: number;        // background rect width
      th: number;        // background rect height
    }

    function drawScaleBorder() {
      if (!scaleBorderCanvas || !isMapActive()) return;
      const mapEl = map.getContainer();
      const w = mapEl.clientWidth;
      const h = mapEl.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      scaleBorderCanvas.width = w * dpr;
      scaleBorderCanvas.height = h * dpr;
      scaleBorderCanvas.style.width = w + 'px';
      scaleBorderCanvas.style.height = h + 'px';

      const ctx = scaleBorderCanvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const centerPt = map.getCenter();

      const pt1 = map.latLngToContainerPoint(centerPt);
      const pt2Lng = map.latLngToContainerPoint({
        lat: centerPt.lat,
        lng: centerPt.lng + 1,
      } as L.LatLngExpression);
      const pt2Lat = map.latLngToContainerPoint({
        lat: centerPt.lat + 1,
        lng: centerPt.lng,
      } as L.LatLngExpression);
      const pxPerDegLng = Math.abs(pt2Lng.x - pt1.x);
      const pxPerDegLat = Math.abs(pt2Lat.y - pt1.y);

      const lngMajSec = chooseMajorInterval(pxPerDegLng, LABEL_MIN_PX_LNG);
      const lngMinSec = chooseMinorInterval(lngMajSec, pxPerDegLng);
      const latMajSec = chooseMajorInterval(pxPerDegLat, LABEL_MIN_PX_LAT);
      const latMinSec = chooseMinorInterval(latMajSec, pxPerDegLat);

      const bounds = map.getBounds();
      const westLng = bounds.getWest();
      const eastLng = bounds.getEast();
      const southLat = Math.max(-85, bounds.getSouth());
      const northLat = Math.min(85, bounds.getNorth());

      const font = '11px "Courier New", ui-monospace, monospace';
      const padX = 4;   // horizontal padding inside the label pill
      const padY = 2;   // vertical padding inside the label pill
      const th = 14 + padY * 2; // text height + padding = bg height

      // Measure helper: returns bounding rect for a label at (x, y) with the
      // given alignment/baseline. The pill width follows the text width
      // (ctx.measureText) — no fixed width.
      function measureLabel(
        text: string,
        x: number,
        y: number,
        align: 'center' | 'left' | 'right',
        baseline: 'top' | 'middle' | 'bottom',
      ): { bgX: number; bgY: number; tw: number; th: number } {
        if (!ctx) return { bgX: 0, bgY: 0, tw: 0, th: 0 };
        ctx.font = font;
        const tw = ctx.measureText(text).width + padX * 2;
        let bgX = x - tw / 2;
        if (align === 'left') bgX = x - padX;
        if (align === 'right') bgX = x - tw + padX;
        const bgY = baseline === 'top' ? y - padY : baseline === 'middle' ? y - th / 2 : y - th + padY;
        return { bgX, bgY, tw, th };
      }

      // Collect candidates from all four sides first. drawBand pushes into
      // this array via the collectLabel closure.
      const candidates: LabelCandidate[] = [];

      function collectLabel(
        text: string,
        x: number,
        y: number,
        align: 'center' | 'left' | 'right',
        baseline: 'top' | 'middle' | 'bottom',
        side: 'top' | 'bottom' | 'left' | 'right',
      ) {
        const { bgX, bgY, tw, th: ths } = measureLabel(text, x, y, align, baseline);
        // Reject candidates whose bounding box would extend past the map
        // edges (would overlap the perpendicular border).
        if (bgX < 1 || bgX + tw > w - 1 || bgY < 1 || bgY + ths > h - 1) return;
        candidates.push({ text, x, y, align, baseline, side, bgX, bgY, tw, th: ths });
      }

      drawBand({
        ctx, orientation: 'top', axis: 'lng',
        axisStart: westLng, axisEnd: eastLng,
        majorSec: lngMajSec, minorSec: lngMinSec,
        w, h,
        toScreenPos: (lng: number) =>
          map.latLngToContainerPoint({ lat: 0, lng } as L.LatLngExpression).x,
        collectLabel,
      });
      drawBand({
        ctx, orientation: 'bottom', axis: 'lng',
        axisStart: westLng, axisEnd: eastLng,
        majorSec: lngMajSec, minorSec: lngMinSec,
        w, h,
        toScreenPos: (lng: number) =>
          map.latLngToContainerPoint({ lat: 0, lng } as L.LatLngExpression).x,
        collectLabel,
      });
      drawBand({
        ctx, orientation: 'left', axis: 'lat',
        axisStart: southLat, axisEnd: northLat,
        majorSec: latMajSec, minorSec: latMinSec,
        w, h,
        toScreenPos: (lat: number) =>
          map.latLngToContainerPoint({ lat, lng: 0 } as L.LatLngExpression).y,
        collectLabel,
      });
      drawBand({
        ctx, orientation: 'right', axis: 'lat',
        axisStart: southLat, axisEnd: northLat,
        majorSec: latMajSec, minorSec: latMinSec,
        w, h,
        toScreenPos: (lat: number) =>
          map.latLngToContainerPoint({ lat, lng: 0 } as L.LatLngExpression).y,
        collectLabel,
      });

      // ---- Collision resolution ----
      // Reserved rectangles: the Leaflet scale control (bottom-left) and
      // attribution (bottom-right) live inside the map. We don't want labels
      // to overlap them. The actual control sizes vary, so reserve a generous
      // strip in the bottom-left and bottom-right corners.
      const reservedRects: Array<{ x: number; y: number; w: number; h: number }> = [
        // Bottom-left: scale control (metric + nautical ≈ 110×34 px).
        { x: 0, y: h - 40, w: 130, h: 40 },
        // Bottom-right: attribution (text varies; reserve 220×24 px).
        { x: w - 220, y: h - 28, w: 220, h: 28 },
      ];

      // Sort candidates by priority: top/bottom first (they're spread along
      // the longer edge), then left/right. Within a side, keep iteration
      // order (which is ascending latitude for left/right, ascending
      // longitude for top/bottom). Stable sort preserves insertion order
      // for ties.
      const sideOrder: Record<string, number> = { top: 0, bottom: 1, left: 2, right: 3 };
      candidates.sort((a, b) => sideOrder[a.side] - sideOrder[b.side]);

      function rectsOverlap(
        a: { x: number; y: number; w: number; h: number },
        b: { x: number; y: number; w: number; h: number },
      ): boolean {
        return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      }

      const placedRects: Array<{ x: number; y: number; w: number; h: number }> = [...reservedRects];
      const kept: LabelCandidate[] = [];
      for (const cand of candidates) {
        const rect = { x: cand.bgX, y: cand.bgY, w: cand.tw, h: cand.th };
        let collides = false;
        for (const placed of placedRects) {
          if (rectsOverlap(rect, placed)) { collides = true; break; }
        }
        if (collides) continue;
        kept.push(cand);
        placedRects.push(rect);
      }

      // ---- Draw kept labels ----
      // Style: black bg (#000, opacity 0.85), white text, no outline,
      // padding 4 px / 2 px, border-radius 2 px, font 11 px monospace.
      // Sized to text via measureText (already done in measureLabel).
      if (ctx) {
        ctx.font = font;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        for (const cand of kept) {
          // Background pill: black, opacity 0.85.
          ctx.fillStyle = 'rgba(0,0,0,0.85)';
          // Border-radius 2 px is approximated by drawing a rect (canvas v1
          // supports roundRect, but the type defs in older @types/canvas
          // don't — fall back to plain fillRect for portability).
          if (typeof ctx.roundRect === 'function') {
            ctx.beginPath();
            ctx.roundRect(cand.bgX, cand.bgY, cand.tw, cand.th, 2);
            ctx.fill();
          } else {
            ctx.fillRect(cand.bgX, cand.bgY, cand.tw, cand.th);
          }
          // Text: white, no outline. Position by textBaseline=text-top
          // inside the pill.
          ctx.fillStyle = '#ffffff';
          // Place text inside the pill: left edge = bgX + padX, vertical
          // center = bgY + th/2 + ~3 (font ascent correction for 11 px).
          ctx.fillText(cand.text, cand.bgX + padX, cand.bgY + padY + 1);
        }
      }

      // ===== Outer 1 px black outline around the whole map =====
      if (ctx) {
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      }

      ctx?.restore();
    }

    function scheduleScaleBorderRedraw() {
      if (!isMapActive()) return;
      if (scaleBorderRAF !== null) return;
      scaleBorderRAF = requestAnimationFrame(() => {
        scaleBorderRAF = null;
        if (isMapActive()) drawScaleBorder();
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
    setTimeout(() => {
      if (isMapActive()) drawScaleBorder();
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
          if (gridCb.checked) drawScaleBorder();
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

    setTimeout(() => {
      if (isMapActive()) map.invalidateSize();
    }, 200);

    return () => {
      disposed = true;
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
      const color = m.color ?? '#ef4444';
      const marker = L.marker([m.position.lat, m.position.lng], {
        icon: makeColoredIcon(color, m.isStart, m.isDatum, m.sequence),
      }).addTo(layer);
      if (m.showLabel) {
        const tooltip = L.tooltip({
          permanent: true,
          direction: 'center',
          className: 'sar-point-label',
          opacity: 1,
          interactive: false,
        }).setContent(escapeHtml(m.label));
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
    layer.clearLayers();
    lines.forEach((l) => {
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
        const startPx = map.latLngToLayerPoint([l.from.lat, l.from.lng]);
        const endPx = map.latLngToLayerPoint([l.to.lat, l.to.lng]);
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
      if (l.label) {
        const mid = {
          lat: (l.from.lat + l.to.lat) / 2,
          lng: (l.from.lng + l.to.lng) / 2,
        };
        L.tooltip({ permanent: true, direction: 'top', className: l.labelClassName ?? 'sar-label' })
          .setContent(l.label)
          .setLatLng([mid.lat, mid.lng])
          .addTo(layer);
      }
    });
  }, [lines]);

  // ---- Draw polygons (search areas) ----
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.polygons) return;
    const layer = layersRef.current.polygons;
    layer.clearLayers();
    polygons.forEach((p) => {
      const latlngs = p.points.map((pt) => [pt.lat, pt.lng] as [number, number]);
      const poly = L.polygon(latlngs, {
        color: p.color,
        weight: 2,
        fillColor: p.fillColor ?? p.color,
        fillOpacity: p.fillOpacity ?? 0.15,
        dashArray: '4 4',
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
      const radiusMeters = c.radiusNm * 1852;
      const circle = L.circle([c.center.lat, c.center.lng], {
        radius: radiusMeters,
        color: c.color,
        weight: 1.5,
        fillColor: c.fillColor ?? c.color,
        fillOpacity: c.fillOpacity ?? 0.08,
        dashArray: '3 3',
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
