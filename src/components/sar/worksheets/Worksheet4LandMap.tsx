'use client';

/**
 * Worksheet4LandMap — peta darat (land map) KHUSUS Worksheet 4.
 *
 * Instance Leaflet sendiri (tidak berbagi apa pun dengan peta ONC/Peta Laut
 * maupun peta embed MapLibre WS4). Komponen hanya dirender di dalam tab
 * Worksheet 4, di bawah peta ONC embed, dan di-remove penuh saat unmount
 * (map.remove()) sehingga tidak ada kebocoran ke worksheet lain.
 *
 * Fitur (permintaan planner):
 *  - Basemap OpenTopoMap (tile.opentopomap.org, maxNativeZoom 17) + atribusi wajib.
 *  - Adapter hasil Worksheet 4 (waypoint, lingkaran radius, rute, trapesium)
 *    via tipe Map* yang sama dengan SeaMap — logika worksheet tidak disentuh.
 *  - Pola darat hasil hitung Worksheet 3 (nilai track spacing S) digambar
 *    dengan warna amber; hasil WS 4 teal — konsisten dengan legenda.
 *  - Layer Kantor SAR (marker + popup nama/koordinat) dan Batas KANSAR
 *    (poligon + label nama, garis tegas, isi transparan) dari
 *    /data/kantor_sar.geojson & /data/batas_kansar.geojson — hanya di peta
 *    darat ini, dikendalikan L.control.layers, default aktif.
 *  - Kontrol skala custom (bukan L.control.scale): SKALA 1:25.000 dengan
 *    batang tiga segmen hitam-putih, mode "Skala cetak" mengunci zoom ke
 *    zoomTarget, mode bebas "SKALA ± 1:N", kalibrasi DPI di localStorage,
 *    cetak memakai mm (1.000 m = 40 mm pada 1:25.000).
 *  - Legenda (kanan-bawah, tidak menimpa skala) + panah utara (kiri-atas)
 *    berlabel "U", sinkron dengan status layer.
 *  - Grid UTM (garis biru tipis, polyline dari titik proyeksi — konvergensi
 *    meridian dihitung via proj4js) + graticule geografis + label tepi di
 *    margin luar bingkai (UTM hitam "380000m.T"/"9206000m.U" + dua digit
 *    tengah; geografis biru "109°54'30\"BT"/"07°10'30\"LS").
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LatLng } from '@/lib/sar/sarCalculations';
import type { MapCircle, MapLine, MapMarker, MapPolygon } from '@/components/sar/SeaMap';
import {
  constantEastingLine,
  constantNorthingLine,
  formatDmsLat,
  formatDmsLon,
  formatUtmFull,
  formatUtmMiddle,
  formatUtmZoneLabel,
  gridValuesBetween,
  latAtNorthing,
  latLonToUtm,
  lonAtEasting,
  metersPerPixelAt,
  pickGraticuleIntervalSec,
  pickUtmIntervalM,
  utmZoneFor,
} from '@/lib/sar/landMapProj';
import {
  buildScaleBar,
  formatThousand,
  meterPerPixelTarget,
  pickBarQuarterM,
  PRINT_SCALE_N,
  readCalibration,
  roundScaleN,
  scaleDenominatorNow,
  writeCalibration,
  zoomTargetForScale,
} from '@/lib/sar/landMapScale';

export interface LandPatternForMap {
  segments: Array<{ from: LatLng; to: LatLng; legIndex: number; distanceNm: number }>;
  patternType: string;
  /** Track spacing S hasil Worksheet 3 (NM). */
  spacingNm: number;
  /** Sumber S, mis. "Worksheet 3 · 500 ft". */
  spacingLabel: string;
  sruName: string;
}

interface Worksheet4LandMapProps {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  lines?: MapLine[];
  polygons?: MapPolygon[];
  circles?: MapCircle[];
  pattern?: LandPatternForMap | null;
  height?: string;
}

// ---- Konstanta warna (konsisten dengan peta lain + legenda) --------------
const WS4_COLOR = '#0f766e';        // hasil Worksheet 4 (teal — sama dgn trapesium peta embed)
const ROUTE_COLOR = '#334155';      // rute A–D (abu — sama dgn peta embed)
const PATTERN_COLOR = '#d97706';    // pola darat WS 3 (amber)
const PATTERN_CONNECTOR = '#f59e0b';
const KANTOR_COLOR = '#7c3aed';     // marker Kantor SAR
const KANSAR_LINE = '#92400e';      // batas KANSAR (sama dgn peta embed WS4)
const KANSAR_FILL = '#f59e0b';
const UTM_GRID_COLOR = '#2563eb';   // grid UTM biru tipis
const GRATICULE_COLOR = '#3b82f6';  // graticule biru putus-putus
const GEO_LABEL_COLOR = '#1d4ed8';  // label geografis biru

const OTM_URL = 'https://tile.opentopomap.org/{z}/{x}/{y}.png';
const OTM_ATTR = '© OpenTopoMap (CC-BY-SA), data © OpenStreetMap contributors';

// ---- Penyedia basemap peta darat ------------------------------------------
// tile.opentopomap.org membatasi laju permintaan per-IP — bila batas terlampaui
// seluruh tile gagal dimuat dan peta hanya menampilkan garis grid UTM biru di
// atas latihan abu-abu. Karena itu penyedia bisa dipilih manual (tombol
// Basemap) dan ada fallback OTOMATIS: bila ≥10 tile gagal dalam 20 detik
// pertama, peta pindah ke penyedia berikutnya dan memberi tahu pengguna.
interface BasemapDef {
  id: string;
  label: string;
  url: string;
  attr: string;
  maxNativeZoom: number;
  subdomains?: string[];
}
const BASEMAPS: BasemapDef[] = [
  {
    id: 'opentopo',
    label: 'OpenTopo',
    url: OTM_URL,
    attr: OTM_ATTR,
    maxNativeZoom: 17,
  },
  {
    id: 'cyclosm',
    label: 'CyclOSM',
    url: 'https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png',
    attr: '© CyclOSM | data © OpenStreetMap contributors',
    maxNativeZoom: 18,
    subdomains: ['a', 'b', 'c'],
  },
  {
    id: 'esri-topo',
    label: 'Esri Topo',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    attr: 'Tiles © Esri — Sumber: Esri, USGS, Garmin',
    maxNativeZoom: 19,
  },
  {
    id: 'esri-imagery',
    label: 'Satelit (Esri)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Tiles © Esri — Sumber: Esri, Maxar, Earthstar Geographics',
    maxNativeZoom: 19,
  },
];
const BASEMAP_KEY = 'landmap:basemap';

function loadBasemapId(): string {
  try {
    if (typeof window === 'undefined') return BASEMAPS[0].id;
    const raw = window.localStorage.getItem(BASEMAP_KEY);
    if (raw && BASEMAPS.some((b) => b.id === raw)) return raw;
  } catch {
    // ignore
  }
  return BASEMAPS[0].id;
}

// ---- Tampilan (view) preferences — parity dengan menu Tampilan Peta Laut ---
// Setiap elemen overlay peta darat bisa disembunyikan lewat menu Tampilan
// (kanan-bawah peta) atau tombol keyboard H (saat kursor berada di atas peta).
// Pilihan disimpan di localStorage; peta yang SEMUA elemennya disembunyikan
// tidak pernah dipulihkan dari storage agar tidak terkesan "rusak".
interface LandViewPrefs {
  layers: boolean;   // panel layer (Hasil WS4, Kantor SAR, KANSAR, grid, …)
  legend: boolean;   // legenda kanan-bawah
  north: boolean;    // panah utara "U"
  scale: boolean;    // kontrol skala 1:25.000
  edge: boolean;     // label tepi UTM/geografis di margin bingkai
}

const DEFAULT_LAND_VIEW_PREFS: LandViewPrefs = {
  layers: true,
  legend: true,
  north: true,
  scale: true,
  edge: true,
};

const LAND_VIEW_PREFS_KEY = 'landmap:viewPrefs:v2';

function allLandHidden(p: LandViewPrefs): boolean {
  return !p.layers && !p.legend && !p.north && !p.scale && !p.edge;
}

function loadLandViewPrefs(): LandViewPrefs {
  try {
    if (typeof window === 'undefined') return { ...DEFAULT_LAND_VIEW_PREFS };
    const raw = window.localStorage.getItem(LAND_VIEW_PREFS_KEY);
    if (!raw) return { ...DEFAULT_LAND_VIEW_PREFS };
    const parsed = JSON.parse(raw) as Partial<LandViewPrefs>;
    const restored: LandViewPrefs = {
      layers: typeof parsed.layers === 'boolean' ? parsed.layers : true,
      legend: typeof parsed.legend === 'boolean' ? parsed.legend : true,
      north: typeof parsed.north === 'boolean' ? parsed.north : true,
      scale: typeof parsed.scale === 'boolean' ? parsed.scale : true,
      edge: typeof parsed.edge === 'boolean' ? parsed.edge : true,
    };
    if (allLandHidden(restored)) return { ...DEFAULT_LAND_VIEW_PREFS };
    return restored;
  } catch {
    return { ...DEFAULT_LAND_VIEW_PREFS };
  }
}

function saveLandViewPrefs(prefs: LandViewPrefs): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAND_VIEW_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore write failures (private mode, sandbox, dll.)
  }
}

const MARGIN_X = 58;  // margin kiri/kanan bingkai (label northing vertikal)
const MARGIN_Y = 48;  // margin atas/bawah (label easting + geografis)

const CSS = `
.land-map-frame { box-sizing: border-box; }
.land-map-frame * { box-sizing: border-box; }
.land-map-canvas { background: #e8e8e8; z-index: 1; }
.land-edge-strip { position: absolute; overflow: hidden; z-index: 5; pointer-events: none; }
.land-edge-strip.is-hidden { display: none; }
.land-edge-label { position: absolute; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; white-space: nowrap; line-height: 1; }
.land-edge-utm { color: #111827; font-weight: 600; }
.land-edge-geo { color: ${GEO_LABEL_COLOR}; font-weight: 500; }
.land-legend { background: rgba(255,255,255,0.96); border: 1px solid #cbd5e1; border-radius: 4px; box-shadow: 0 1px 4px rgba(15,23,42,0.25); padding: 6px 8px; font-size: 10px; line-height: 1.35; color: #0f172a; max-width: 250px; }
.land-legend h4 { margin: 0 0 3px; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
.land-legend .land-legend-zone { font-weight: 600; color: #1e3a8a; margin-bottom: 4px; }
.land-legend-row { display: flex; align-items: center; gap: 5px; margin: 2px 0; transition: opacity .15s; }
.land-legend-row.is-off { opacity: 0.35; }
.land-legend-swatch { flex: 0 0 20px; display: inline-flex; align-items: center; justify-content: center; }
.land-legend-title { font-weight: 700; margin-top: 5px; border-top: 1px solid #e2e8f0; padding-top: 4px; text-transform: uppercase; font-size: 9px; color: #334155; }
.land-legend-note { margin-top: 4px; border-top: 1px solid #e2e8f0; padding-top: 4px; color: #64748b; font-size: 9px; }
.land-north { background: rgba(255,255,255,0.9); border: 1px solid #cbd5e1; border-radius: 4px; padding: 4px 6px 2px; text-align: center; width: 34px; }
.land-north .land-north-u { font-size: 11px; font-weight: 800; color: #0f172a; line-height: 1; }
.land-scale { background: rgba(255,255,255,0.94); border: 1px solid #cbd5e1; border-radius: 4px; padding: 5px 8px 6px; font-size: 10px; color: #0f172a; width: max-content; max-width: 360px; }
.land-scale-title { font-weight: 800; text-transform: uppercase; letter-spacing: 0.03em; margin-bottom: 3px; }
.land-scale-barwrap { position: relative; width: 151px; }
.land-scale-bar { position: relative; height: 9px; border: 1px solid #111827; display: flex; background: #fff; width: 100%; }
.land-scale-seg { height: 100%; }
.land-scale-seg.dark { background: #111827; }
.land-scale-seg.light { background: #ffffff; }
.land-scale-labels { position: relative; height: 12px; margin-top: 1px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 9px; }
.land-scale-labels span { position: absolute; transform: translateX(-50%); white-space: nowrap; }
.land-scale-note { color: #64748b; font-size: 9px; margin-top: 3px; line-height: 1.3; max-width: 250px; }
.land-scale-actions { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
.land-scale-btn { font-size: 9px; font-weight: 700; border: 1px solid #cbd5e1; background: #f8fafc; color: #0f172a; border-radius: 3px; padding: 2px 6px; cursor: pointer; }
.land-scale-btn.active { background: #0f766e; border-color: #0f766e; color: #fff; }
.land-scale-dpi { width: 44px; font-size: 9px; border: 1px solid #cbd5e1; border-radius: 3px; padding: 1px 3px; }
.land-ws4-pin { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px; background: var(--pin, ${WS4_COLOR}); border: 2px solid #fff; color: #fff; font-size: 11px; font-weight: 800; box-shadow: 0 1px 3px rgba(15,23,42,0.45); }
.land-kantor-pin { display: flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 999px; background: ${KANTOR_COLOR}; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(15,23,42,0.45); }
.land-kantor-pin::after { content: ''; width: 4px; height: 4px; border-radius: 999px; background: #fff; }
.land-tooltip { background: rgba(255,255,255,0.95); border: 1px solid #cbd5e1; color: #0f172a; font-size: 10px; padding: 1px 5px; border-radius: 3px; box-shadow: 0 1px 2px rgba(15,23,42,0.2); }
.land-tooltip::before { display: none; }
.land-kansar-label { background: rgba(255,255,255,0.75); border: none; box-shadow: none; color: ${KANSAR_LINE}; font-size: 9px; font-weight: 700; padding: 0 2px; }
.land-kansar-label::before { display: none; }
/* ---- Menu Tampilan (parity Peta Laut) — tombol dipindah ke kiri-bawah agar
 * tidak menutupi legenda & skala di kanan-bawah ---- */
.seamap-tampilan--land { right: auto; left: 10px; bottom: 26px; }
.seamap-tampilan--land .seamap-tampilan-menu { right: auto; left: 0; }
/* ---- Per-element hide classes (dipasang di BINGKAI peta, bukan container
 * Leaflet — className container harus konstan agar tile tidak runtuh) ---- */
.landmap-hide-layers .leaflet-control-layers { display: none !important; }
.landmap-hide-legend .land-legend { display: none !important; }
.landmap-hide-north .land-north { display: none !important; }
.landmap-hide-scale .land-scale { display: none !important; }
.landmap-hide-edge .land-edge-strip { display: none !important; }
@media print {
  .land-map-frame { break-inside: avoid; border-color: #0f172a; }
  .leaflet-control-zoom, .leaflet-control-layers, .land-scale-actions { display: none !important; }
  .seamap-tampilan--land, .land-map-toolbar { display: none !important; }
  .land-scale { background: #fff; border-color: #64748b; }
  /* Cetak memakai mm fisik: lebar batang = jarak/(N/1000) mm — 1.000 m @ 1:25.000 = 40 mm. */
  .land-scale-bar { width: var(--land-scale-mm, 40mm) !important; }
  .land-map-canvas { border-color: #0f172a; }
}
`;

type StripKind = 'top' | 'bottom' | 'left' | 'right';

/** Satu label tepi di margin bingkai (UTM hitam / geografis biru). */
function addEdgeLabel(strip: HTMLElement | null, kind: StripKind, fraction: number, text: string, variant: 'utm' | 'geo'): void {
  if (!strip) return;
  const span = document.createElement('span');
  span.className = `land-edge-label land-edge-${variant}`;
  span.textContent = text;
  // Clamp agar label tak terpotong tepi strip (0,04–0,96).
  const clamped = Math.max(0.04, Math.min(0.96, fraction));
  if (kind === 'top' || kind === 'bottom') {
    // Baris: geografis di tepi luar, UTM dekat bingkai.
    if (kind === 'top') span.style.top = variant === 'utm' ? '30px' : '8px';
    else span.style.top = variant === 'utm' ? '10px' : '32px';
    span.style.left = `${clamped * 100}%`;
    span.style.transform = 'translateX(-50%)';
  } else {
    // Vertikal: kolom UTM dekat bingkai, geografis di tepi luar.
    const isLeft = kind === 'left';
    span.style.top = `${clamped * 100}%`;
    span.style.left = variant === 'utm' ? (isLeft ? '42px' : '16px') : (isLeft ? '16px' : '42px');
    span.style.transform = 'translate(-50%, -50%) rotate(-90deg)';
  }
  strip.appendChild(span);
}

/** Kontrol skala custom — BUKAN L.control.scale. */
function createScaleControl(
  getMode: () => { printMode: boolean; dpi: number; n: number },
  setMode: (next: { printMode: boolean; dpi: number }) => void,
  lockZoom: () => void,
): L.Control {
  const ScaleControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd(map: L.Map) {
      const container = L.DomUtil.create('div', 'land-scale leaflet-control');
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      const title = L.DomUtil.create('div', 'land-scale-title', container);
      const barWrap = L.DomUtil.create('div', 'land-scale-barwrap', container);
      const bar = L.DomUtil.create('div', 'land-scale-bar', barWrap);
      const labels = L.DomUtil.create('div', 'land-scale-labels', barWrap);
      const note = L.DomUtil.create('div', 'land-scale-note', container);
      note.textContent = 'Skala layar bergantung DPI — gunakan mode Skala cetak & kalibrasi DPI agar cetak 1:1.';
      const actions = L.DomUtil.create('div', 'land-scale-actions', container);
      const modeBtn = L.DomUtil.create('button', 'land-scale-btn', actions) as HTMLButtonElement;
      modeBtn.type = 'button';
      const dpiLabel = L.DomUtil.create('span', '', actions);
      dpiLabel.textContent = 'DPI';
      dpiLabel.style.fontWeight = '700';
      const dpiInput = L.DomUtil.create('input', 'land-scale-dpi', actions) as HTMLInputElement;
      dpiInput.type = 'number';
      dpiInput.min = '24';
      dpiInput.max = '480';
      dpiInput.title = 'Kalibrasi DPI layar (disimpan di localStorage)';

      const segDivs = [L.DomUtil.create('div', 'land-scale-seg', bar), L.DomUtil.create('div', 'land-scale-seg', bar), L.DomUtil.create('div', 'land-scale-seg', bar)];
      // Tiga segmen rasio 1:1:2 (segmen ketiga dua kali lebih panjang); lebar
      // batang dikendalikan barwrap → cetak mm tetap proporsional.
      segDivs[0].style.flex = '1 1 0';
      segDivs[1].style.flex = '1 1 0';
      segDivs[2].style.flex = '2 1 0';

      const update = () => {
        const { printMode, dpi, n } = getMode();
        const center = map.getCenter();
        const mppActual = metersPerPixelAt(center.lat, map.getZoom());
        const quarter = printMode ? 250 : pickBarQuarterM(mppActual, false);
        const layout = buildScaleBar(quarter, mppActual, n);
        title.textContent = printMode
          ? `SKALA 1:${formatThousand(n)}`
          : `SKALA ± 1:${formatThousand(roundScaleN(scaleDenominatorNow(center.lat, map.getZoom(), dpi)))}`;
        segDivs.forEach((seg, index) => { seg.className = `land-scale-seg ${layout.segments[index].dark ? 'dark' : 'light'}`; });
        barWrap.style.width = `${Math.max(120, Math.min(320, layout.widthPx))}px`;
        container.style.setProperty('--land-scale-mm', `${layout.widthMm.toFixed(2)}mm`);
        labels.innerHTML = '';
        const barPx = Math.max(120, Math.min(320, layout.widthPx));
        for (const label of layout.labels) {
          // Batang sempit: buang label tengah agar tidak bertumpuk.
          const fraction = label.meters / (quarter * 4);
          if (fraction === 0.25 && barPx < 156) continue;
          if (fraction === 0.5 && barPx < 110) continue;
          const span = L.DomUtil.create('span', '', labels);
          span.style.left = `${fraction * 100}%`;
          span.textContent = label.suffix ? `${formatThousand(label.meters)} M` : formatThousand(label.meters);
        }
        modeBtn.textContent = printMode ? 'Skala cetak: ON' : 'Skala cetak: OFF';
        modeBtn.classList.toggle('active', printMode);
        if (dpiInput.value !== String(dpi)) dpiInput.value = String(dpi);
      };

      modeBtn.addEventListener('click', () => {
        const { printMode, dpi } = getMode();
        const next = { printMode: !printMode, dpi };
        setMode(next);
        if (next.printMode) lockZoom();
        update();
      });
      dpiInput.addEventListener('change', () => {
        const parsed = Number(dpiInput.value);
        const { printMode } = getMode();
        const dpi = Number.isFinite(parsed) && parsed >= 24 && parsed <= 480 ? Math.round(parsed) : 96;
        setMode({ printMode, dpi });
        if (printMode) lockZoom();
        update();
      });

      update();
      map.on('zoomend moveend', update);
      return container;
    },
  });
  return new ScaleControl() as L.Control;
}

export default function Worksheet4LandMap({ center, zoom = 12, markers = [], lines = [], polygons = [], circles = [], pattern = null, height = '520px' }: Worksheet4LandMapProps) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const topStripRef = useRef<HTMLDivElement | null>(null);
  const bottomStripRef = useRef<HTMLDivElement | null>(null);
  const leftStripRef = useRef<HTMLDivElement | null>(null);
  const rightStripRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const ws4LayerRef = useRef<L.LayerGroup | null>(null);
  const patternLayerRef = useRef<L.LayerGroup | null>(null);
  const kantorLayerRef = useRef<L.LayerGroup | null>(null);
  const kansarLayerRef = useRef<L.LayerGroup | null>(null);
  const gridLayerRef = useRef<L.LayerGroup | null>(null);
  const scaleModeRef = useRef({ printMode: true, dpi: 96, n: PRINT_SCALE_N });
  const lockZoomRef = useRef(false);
  const rafRef = useRef(0);
  const updateFnRef = useRef<() => void>(() => {});

  // ---- Basemap aktif + menu Tampilan (parity fitur Peta Laut) ---------------
  const [basemapId, setBasemapId] = useState<string>(() => loadBasemapId());
  const [basemapNotice, setBasemapNotice] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideToast, setHideToast] = useState(false);
  const [viewPrefs, setViewPrefs] = useState<LandViewPrefs>(() => loadLandViewPrefs());
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const autoFellBackRef = useRef(false);
  const hotZoneRef = useRef(false); // kursor di atas peta darat → shortcut H aktif
  const hideToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsRef = useRef<LandViewPrefs>(viewPrefs);
  useEffect(() => { prefsRef.current = viewPrefs; }, [viewPrefs]);
  useEffect(() => { saveLandViewPrefs(viewPrefs); }, [viewPrefs]);
  useEffect(() => {
    try { window.localStorage.setItem(BASEMAP_KEY, basemapId); } catch { /* ignore */ }
  }, [basemapId]);

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

  // Shortcut H: sembunyikan/tampilkan SEMUA elemen overlay. Hanya aktif saat
  // kursor berada di atas peta darat agar tidak bentrok dengan shortcut H
  // peta laut (SeaMap juga memakai H global).
  useEffect(() => {
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return (el as HTMLElement).isContentEditable === true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (!hotZoneRef.current) return;
      if (e.key !== 'h' && e.key !== 'H') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(document.activeElement)) return;
      e.preventDefault();
      const prev = prefsRef.current;
      if (allLandHidden(prev)) {
        setViewPrefs({ ...DEFAULT_LAND_VIEW_PREFS });
        clearHideToast();
      } else {
        setViewPrefs({ layers: false, legend: false, north: false, scale: false, edge: false });
        flashHideToast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flashHideToast, clearHideToast]);

  const everythingHidden = allLandHidden(viewPrefs);
  // Kelas disembunyikan di BINGKAI (elemen React) — container Leaflet tetap
  // konstan sehingga kelas internal Leaflet tidak pernah ditimpa React.
  const frameClassName = [
    'land-map-frame relative bg-white text-slate-900',
    !viewPrefs.layers && 'landmap-hide-layers',
    !viewPrefs.legend && 'landmap-hide-legend',
    !viewPrefs.north && 'landmap-hide-north',
    !viewPrefs.scale && 'landmap-hide-scale',
    !viewPrefs.edge && 'landmap-hide-edge',
  ].filter(Boolean).join(' ');

  const selectBasemap = (id: string) => {
    setBasemapNotice(null);
    setBasemapId(id);
  };

  // ---- Inisialisasi peta (sekali per pasang; hanya di tab WS4) -------------
  useEffect(() => {
    const el = mapElRef.current;
    if (!el || mapRef.current) return;

    const calibration = readCalibration(typeof window !== 'undefined' ? window.localStorage : null);
    scaleModeRef.current.printMode = calibration.printMode ?? true;
    scaleModeRef.current.dpi = calibration.dpi ?? 96;

    const initialZoom = scaleModeRef.current.printMode
      ? Math.max(10.5, Math.min(16.5, zoomTargetForScale(center.lat, PRINT_SCALE_N, scaleModeRef.current.dpi)))
      : Math.max(zoom, 10.5);

    const map = L.map(el, {
      center: [center.lat, center.lng],
      zoom: initialZoom,
      zoomSnap: 0.05,
      zoomDelta: 0.5,
      minZoom: 6,
      maxZoom: 19,
      attributionControl: false,
    });
    mapRef.current = map;

    // Basemap dipasang oleh efek [basemapId] di bawah — mendukung pemilihan
    // penyedia (OpenTopo/CyclOSM/Esri) + fallback otomatis saat tile gagal.
    L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);

    // ---- Layer grup overlay (semua default aktif; dikendalikan layers control) ----
    const ws4Layer = L.layerGroup().addTo(map);
    const patternLayer = L.layerGroup().addTo(map);
    const kantorLayer = L.layerGroup().addTo(map);
    const kansarLayer = L.layerGroup().addTo(map);
    const gridLayer = L.layerGroup().addTo(map);
    ws4LayerRef.current = ws4Layer;
    patternLayerRef.current = patternLayer;
    kantorLayerRef.current = kantorLayer;
    kansarLayerRef.current = kansarLayer;
    gridLayerRef.current = gridLayer;

    L.control.layers(undefined, {
      'Hasil Worksheet 4 (teal)': ws4Layer,
      'Pola darat — S dari WS 3 (amber)': patternLayer,
      'Kantor SAR': kantorLayer,
      'Batas KANSAR': kansarLayer,
      'Grid UTM & graticule': gridLayer,
    }, { position: 'topright', collapsed: false }).addTo(map);

    // Panah utara (kiri-atas) — "U" di atas panah hitam-putih.
    const NorthControl = L.Control.extend({
      options: { position: 'topleft' },
      onAdd() {
        const div = L.DomUtil.create('div', 'land-north leaflet-control');
        div.innerHTML = '<div class="land-north-u">U</div><svg width="26" height="27" viewBox="0 0 26 27" aria-hidden="true"><polygon points="13,1 20,22 13,17" fill="#111827"/><polygon points="13,1 6,22 13,17" fill="#ffffff" stroke="#111827" stroke-width="1.4"/><circle cx="13" cy="24.6" r="1.3" fill="#111827"/></svg>';
        return div;
      },
    });
    new NorthControl().addTo(map);

    // Legenda (kanan-bawah) — ditambahkan SEBELUM kontrol skala sehingga
    // tampil DI ATAS skala (Leaflet menumpuk kontrol satu sudut vertikal).
    const legendContainer = L.DomUtil.create('div', 'land-legend leaflet-control');
    const LegendControl = L.Control.extend({
      options: { position: 'bottomright' },
      onAdd() {
        return legendContainer;
      },
    });
    legendContainer.innerHTML = `
      <h4>Legenda — Peta Darat WS 4</h4>
      <div class="land-legend-zone" data-zone-label></div>
      <div class="land-legend-row" data-layer="kantor"><span class="land-legend-swatch"><span style="width:10px;height:10px;border-radius:999px;background:${KANTOR_COLOR};border:1.5px solid #fff;box-shadow:0 0 0 1px #94a3b8;display:inline-block"></span></span>Kantor SAR (popup: nama, koordinat)</div>
      <div class="land-legend-row" data-layer="kansar"><span class="land-legend-swatch"><svg width="20" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="${KANSAR_LINE}" stroke-width="1.6" stroke-dasharray="4 2"/></svg></span>Batas KANSAR (isi transparan)</div>
      <div class="land-legend-row" data-layer="ws4"><span class="land-legend-swatch"><span style="width:11px;height:11px;border-radius:999px;background:${WS4_COLOR};border:1.5px solid #fff;box-shadow:0 0 0 1px #334155;display:inline-block"></span></span>Waypoint &amp; radius lingkaran WS 4</div>
      <div class="land-legend-row" data-layer="ws4"><span class="land-legend-swatch"><span style="width:14px;height:9px;background:${WS4_COLOR};opacity:0.18;border:1.5px solid ${WS4_COLOR};display:inline-block"></span></span>Area pencarian WS 4 (trapesium)</div>
      <div class="land-legend-row" data-layer="ws4"><span class="land-legend-swatch"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="${ROUTE_COLOR}" stroke-width="2"/></svg></span>Rute waypoint A–D</div>
      <div class="land-legend-row" data-layer="pattern"><span class="land-legend-swatch"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="${PATTERN_COLOR}" stroke-width="2"/></svg></span>Pola darat (leg) — S dari WS 3</div>
      <div class="land-legend-row" data-layer="pattern"><span class="land-legend-swatch"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="${PATTERN_CONNECTOR}" stroke-width="1.5" stroke-dasharray="3 2"/></svg></span>Pola darat (penghubung)</div>
      <div class="land-legend-row" data-layer="grid"><span class="land-legend-swatch"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="${UTM_GRID_COLOR}" stroke-width="1.4"/></svg></span>Grid UTM (1 km @ 1:25.000)</div>
      <div class="land-legend-row" data-layer="grid"><span class="land-legend-swatch"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="${GRATICULE_COLOR}" stroke-width="1.2" stroke-dasharray="3 2"/></svg></span>Graticule geografis (30&Prime; @ 1:25.000)</div>
      <div class="land-legend-title">Elemen OpenTopoMap</div>
      <div class="land-legend-row"><span class="land-legend-swatch"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#a3714b" stroke-width="1.4"/></svg></span>Kontur / garis ketinggian</div>
      <div class="land-legend-row"><span class="land-legend-swatch"><span style="width:12px;height:9px;background:#a8d3a8;border:1px solid #6a994e;display:inline-block"></span></span>Vegetasi / hutan</div>
      <div class="land-legend-row"><span class="land-legend-swatch"><span style="width:12px;height:9px;background:#9ec7e8;border:1px solid #4a90c4;display:inline-block"></span></span>Perairan (sungai/danau)</div>
      <div class="land-legend-row"><span class="land-legend-swatch"><svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke="#e892a2" stroke-width="2.4"/></svg></span>Jalan utama</div>
      <div class="land-legend-row"><span class="land-legend-swatch"><span style="width:12px;height:9px;background:#d9d0c9;border:1px solid #9c9188;display:inline-block"></span></span>Permukiman / bangunan</div>
      <div class="land-legend-note">Skala, grid, dan label tepi akurat pada mode &ldquo;Skala cetak&rdquo;.<br>${OTM_ATTR}</div>
    `;
    new LegendControl().addTo(map);

    // Kontrol skala custom (bukan L.control.scale) — di bawah legenda.
    map.addControl(createScaleControl(
      () => scaleModeRef.current,
      (next) => {
        scaleModeRef.current.printMode = next.printMode;
        scaleModeRef.current.dpi = next.dpi;
        writeCalibration(typeof window !== 'undefined' ? window.localStorage : null, { printMode: next.printMode, dpi: next.dpi });
      },
      () => {
        // Kunci zoom ke zoomTarget — zoom pecahan diizinkan (zoomSnap 0.05).
        const map2 = mapRef.current;
        if (!map2) return;
        map2.setZoom(zoomTargetForScale(map2.getCenter().lat, scaleModeRef.current.n, scaleModeRef.current.dpi));
      },
    ));

    // ---- Sinkron legenda + margin label dengan status layer ----
    const syncLegend = () => {
      const centerNow = map.getCenter();
      const zoneLabel = legendContainer.querySelector('[data-zone-label]');
      if (zoneLabel) zoneLabel.textContent = formatUtmZoneLabel(utmZoneFor(centerNow.lng), centerNow.lat < 0);
      const setRow = (key: string, on: boolean) => {
        legendContainer.querySelectorAll(`[data-layer="${key}"]`).forEach((row) => row.classList.toggle('is-off', !on));
      };
      setRow('ws4', map.hasLayer(ws4Layer));
      setRow('pattern', map.hasLayer(patternLayer));
      setRow('kantor', map.hasLayer(kantorLayer));
      setRow('kansar', map.hasLayer(kansarLayer));
      setRow('grid', map.hasLayer(gridLayer));
      const stripsHidden = !map.hasLayer(gridLayer);
      [topStripRef, bottomStripRef, leftStripRef, rightStripRef].forEach((ref) => {
        ref.current?.classList.toggle('is-hidden', stripsHidden);
      });
    };
    syncLegend();
    map.on('overlayadd overlayremove', syncLegend);
    map.on('moveend', syncLegend);

    // Mode cetak: zoom terkunci ke zoomTarget (snap balik bila pengguna zoom).
    map.on('zoomend', () => {
      if (lockZoomRef.current || !scaleModeRef.current.printMode) return;
      const target = zoomTargetForScale(map.getCenter().lat, scaleModeRef.current.n, scaleModeRef.current.dpi);
      if (Math.abs(map.getZoom() - target) > 0.03) {
        lockZoomRef.current = true;
        map.setZoom(target);
        lockZoomRef.current = false;
      }
    });

    // ---- Data Kantor SAR & Batas KANSAR (hanya peta darat ini) ----
    const abortController = new AbortController();
    fetch('/data/kantor_sar.geojson', { signal: abortController.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((geojson) => {
        L.geoJSON(geojson, {
          pointToLayer: (feature) => {
            const props = feature.properties ?? {};
            const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
            const [lng, lat] = coordinates;
            return L.marker([lat, lng], {
              icon: L.divIcon({ className: '', html: '<div class="land-kantor-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }),
              title: String(props.nama ?? 'Kantor SAR'),
            });
          },
          onEachFeature: (feature, layer) => {
            const props = (feature.properties ?? {}) as Record<string, string>;
            const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
            const [lng, lat] = coordinates;
            layer.bindPopup(`
              <strong>${props.nama ?? 'Kantor SAR'}</strong><br/>
              Kode: ${props.kode ?? '-'}<br/>
              Kategori: ${props.kategori ?? '-'}<br/>
              Koordinat: ${lat.toFixed(6)}, ${lng.toFixed(6)}<br/>
              <span style="font-size:10px;color:#64748b">${props.alamat ?? ''}</span>
            `, { maxWidth: 260 });
          },
        }).addTo(kantorLayer);
      })
      .catch(() => {
        // Data hilang/gagal fetch — layer tetap ada (kosong); jangan crash.
      });
    fetch('/data/batas_kansar.geojson', { signal: abortController.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((geojson) => {
        L.geoJSON(geojson, {
          style: () => ({
            color: KANSAR_LINE,
            weight: 1.6,
            opacity: 0.9,
            dashArray: '5 3',
            fillColor: KANSAR_FILL,
            fillOpacity: 0.07,
          }),
          onEachFeature: (feature, layer) => {
            const props = (feature.properties ?? {}) as Record<string, string>;
            layer.bindTooltip(String(props.nama ?? 'KANSAR'), { permanent: true, direction: 'center', className: 'land-kansar-label' });
            layer.bindPopup(`<strong>KANSAR ${props.nama ?? ''}</strong><br/>Kode: ${props.kode ?? '-'}<br/><span style="font-size:10px;color:#64748b">Referensi latihan — batas KMZ 9 Okt 2021, bukan dokumen operasi resmi.</span>`);
          },
        }).addTo(kansarLayer);
      })
      .catch(() => {
        // Sama seperti di atas — layer kosong, tidak crash.
      });

    // ---- Grid + label tepi (throttle rAF pada tiap move/zoom/resize) ----
    const updateGridAndLabels = () => {
      const gridLayer2 = gridLayerRef.current;
      if (!gridLayer2 || !map.hasLayer(gridLayer2)) return;
      const size = map.getSize();
      if (size.x <= 0 || size.y <= 0) return;
      gridLayer2.clearLayers();
      const bounds = map.getBounds();
      const centerLat = map.getCenter().lat;
      const zone = utmZoneFor(map.getCenter().lng);
      const south = centerLat < 0;
      const { printMode, dpi, n } = scaleModeRef.current;
      const mpp = printMode ? meterPerPixelTarget(n, dpi) : metersPerPixelAt(centerLat, map.getZoom());
      const utmInterval = printMode ? 1000 : pickUtmIntervalM(mpp);
      const gratSec = printMode ? 30 : pickGraticuleIntervalSec(mpp, centerLat);

      // Batas zona: garis UTM hanya digambar di dalam zona pusat peta.
      const zoneLonMin = (zone - 1) * 6 - 180;
      const zoneLonMax = zone * 6 - 180;
      const lonMin = Math.max(bounds.getWest(), zoneLonMin);
      const lonMax = Math.min(bounds.getEast(), zoneLonMax);
      const latMin = bounds.getSouth();
      const latMax = bounds.getNorth();

      const clearStrip = (strip: HTMLElement | null) => {
        if (strip) strip.innerHTML = '';
      };
      clearStrip(topStripRef.current);
      clearStrip(bottomStripRef.current);
      clearStrip(leftStripRef.current);
      clearStrip(rightStripRef.current);

      // De-crowd: jangan taruh dua label per strip lebih rapat dari minPx.
      let lastTopX = -999;
      let lastBottomX = -999;
      let lastLeftY = -999;
      let lastRightY = -999;

      const addEdgeLabelChecked = (
        kind: StripKind, fraction: number, text: string, variant: 'utm' | 'geo', minPx = 34,
      ): boolean => {
        if (kind === 'top' || kind === 'bottom') {
          const x = fraction * 1000;
          const last = kind === 'top' ? lastTopX : lastBottomX;
          if (Math.abs(x - last) * (size.x / 1000) < minPx) return false;
          if (kind === 'top') lastTopX = x;
          else lastBottomX = x;
        } else {
          const y = fraction * 1000;
          const last = kind === 'left' ? lastLeftY : lastRightY;
          if (Math.abs(y - last) * (size.y / 1000) < minPx) return false;
          if (kind === 'left') lastLeftY = y;
          else lastRightY = y;
        }
        addEdgeLabel(
          kind === 'top' ? topStripRef.current : kind === 'bottom' ? bottomStripRef.current : kind === 'left' ? leftStripRef.current : rightStripRef.current,
          kind, fraction, text, variant,
        );
        return true;
      };
      const corners = [
        latLonToUtm(latMin, lonMin),
        latLonToUtm(latMin, lonMax),
        latLonToUtm(latMax, lonMin),
        latLonToUtm(latMax, lonMax),
      ];

      if (lonMax > lonMin) {
        const eastings = corners.map((coord) => coord.easting).filter((value) => Number.isFinite(value));
        const eastingValues = gridValuesBetween(Math.min(...eastings), Math.max(...eastings), utmInterval);
        if (eastingValues.length <= 80) {
          const visible: Array<{ value: number; xTop: number; xBottom: number }> = [];
          for (const easting of eastingValues) {
            const lonTop = lonAtEasting(zone, south, easting, latMax);
            const lonBottom = lonAtEasting(zone, south, easting, latMin);
            if (lonTop < zoneLonMin || lonTop > zoneLonMax) continue;
            const pTop = map.latLngToContainerPoint([latMax, lonTop]);
            if (pTop.x < -12 || pTop.x > size.x + 12) continue;
            visible.push({ value: easting, xTop: pTop.x, xBottom: map.latLngToContainerPoint([latMin, lonBottom]).x });
          }
          visible.forEach((item, index) => {
            const isEdge = index === 0 || index === visible.length - 1;
            gridLayer2.addLayer(L.polyline(
              constantEastingLine(zone, south, item.value, latMin, latMax, 24).map((p) => [p.lat, p.lon] as [number, number]),
              { color: UTM_GRID_COLOR, weight: 1, opacity: 0.75, interactive: false },
            ));
            const text = isEdge ? formatUtmFull(item.value, 'T') : formatUtmMiddle(item.value);
            addEdgeLabelChecked('top', item.xTop / size.x, text, 'utm');
            addEdgeLabelChecked('bottom', item.xBottom / size.x, text, 'utm');
          });
        }

        // Graticule bujur — garis vertikal lurus pada Web Mercator.
        const gratLonValues = gridValuesBetween(bounds.getWest() * 3600, bounds.getEast() * 3600, gratSec).map((sec) => sec / 3600);
        if (gratLonValues.length <= 80) {
          for (const lon of gratLonValues) {
            const p = map.latLngToContainerPoint([centerLat, lon]);
            if (p.x < 0 || p.x > size.x) continue;
            gridLayer2.addLayer(L.polyline([[latMin, lon], [latMax, lon]], { color: GRATICULE_COLOR, weight: 1, opacity: 0.65, dashArray: '4 3', interactive: false }));
            const text = formatDmsLon(lon);
            addEdgeLabelChecked('top', p.x / size.x, text, 'geo');
            addEdgeLabelChecked('bottom', p.x / size.x, text, 'geo');
          }
        }
      }

      // ---- Northing: kiri/kanan, label vertikal ----
      const northings = corners.map((coord) => coord.northing).filter((value) => Number.isFinite(value));
      if (northings.length > 0) {
        const northingValues = gridValuesBetween(Math.min(...northings), Math.max(...northings), utmInterval);
        if (northingValues.length <= 80) {
          const visible: Array<{ value: number; yLeft: number; yRight: number }> = [];
          for (const northing of northingValues) {
            const latLeft = latAtNorthing(zone, south, northing, bounds.getWest());
            const latRight = latAtNorthing(zone, south, northing, bounds.getEast());
            const pLeft = map.latLngToContainerPoint([latLeft, bounds.getWest()]);
            if (pLeft.y < -12 || pLeft.y > size.y + 12) continue;
            visible.push({ value: northing, yLeft: pLeft.y, yRight: map.latLngToContainerPoint([latRight, bounds.getEast()]).y });
          }
          visible.forEach((item, index) => {
            const isEdge = index === 0 || index === visible.length - 1;
            gridLayer2.addLayer(L.polyline(
              constantNorthingLine(zone, south, item.value, Math.max(lonMin, bounds.getWest()), Math.min(lonMax, bounds.getEast()), 24).map((p) => [p.lat, p.lon] as [number, number]),
              { color: UTM_GRID_COLOR, weight: 1, opacity: 0.75, interactive: false },
            ));
            const text = isEdge ? formatUtmFull(item.value, 'U') : formatUtmMiddle(item.value);
            addEdgeLabelChecked('left', item.yLeft / size.y, text, 'utm');
            addEdgeLabelChecked('right', item.yRight / size.y, text, 'utm');
          });
        }
      }

      // Graticule lintang — garis horizontal.
      const gratLatValues = gridValuesBetween(bounds.getSouth() * 3600, bounds.getNorth() * 3600, gratSec).map((sec) => sec / 3600);
      if (gratLatValues.length <= 80) {
        for (const lat of gratLatValues) {
          const p = map.latLngToContainerPoint([lat, map.getCenter().lng]);
          if (p.y < 0 || p.y > size.y) continue;
          gridLayer2.addLayer(L.polyline([[lat, bounds.getWest()], [lat, bounds.getEast()]], { color: GRATICULE_COLOR, weight: 1, opacity: 0.65, dashArray: '4 3', interactive: false }));
          const text = formatDmsLat(lat);
          addEdgeLabelChecked('left', p.y / size.y, text, 'geo');
          addEdgeLabelChecked('right', p.y / size.y, text, 'geo');
        }
      }
    };
    updateFnRef.current = updateGridAndLabels;

    const scheduleUpdate = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        updateFnRef.current();
      });
    };
    map.on('move zoom viewreset resize', scheduleUpdate);

    map.whenReady(() => {
      map.invalidateSize();
      updateFnRef.current();
    });

    const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
      map.invalidateSize();
      scheduleUpdate();
    }) : null;
    resizeObserver?.observe(el);

    return () => {
      abortController.abort();
      resizeObserver?.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      updateFnRef.current = () => {};
      map.off();
      map.remove();
      mapRef.current = null;
      ws4LayerRef.current = null;
      patternLayerRef.current = null;
      kantorLayerRef.current = null;
      kansarLayerRef.current = null;
      gridLayerRef.current = null;
    };
    // center/zoom hanya dipakai saat inisialisasi — dependency disengaja minimal.
  }, []);

  // ---- Adapter hasil Worksheet 4 (tipe Map* — logika worksheet tak disentuh) ----
  useEffect(() => {
    const layer = ws4LayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const polygon of polygons) {
      L.polygon(polygon.points.map((p) => [p.lat, p.lng] as [number, number]), {
        color: polygon.color || WS4_COLOR,
        weight: 1.6,
        fillColor: polygon.fillColor || WS4_COLOR,
        fillOpacity: polygon.fillOpacity ?? 0.12,
      }).bindTooltip(polygon.label ?? 'Area pencarian WS 4', { className: 'land-tooltip', direction: 'top' }).addTo(layer);
    }
    for (const circle of circles) {
      L.circle([circle.center.lat, circle.center.lng], {
        radius: circle.radiusNm * 1852,
        color: WS4_COLOR,
        weight: 1.8,
        fillColor: WS4_COLOR,
        fillOpacity: 0.08,
      }).bindTooltip(circle.label ?? 'Radius', { className: 'land-tooltip', direction: 'top' }).addTo(layer);
    }
    for (const line of lines) {
      L.polyline([[line.from.lat, line.from.lng], [line.to.lat, line.to.lng]], {
        color: line.color || ROUTE_COLOR,
        weight: line.weight ?? 2,
        dashArray: line.dashed ? '6 4' : undefined,
        opacity: line.opacity ?? 0.9,
      }).bindTooltip(line.label ?? 'Rute', { className: 'land-tooltip', direction: 'top' }).addTo(layer);
    }
    for (const marker of markers) {
      const letter = marker.sequence ? String.fromCharCode(64 + marker.sequence) : '·';
      const markerLayer = L.marker([marker.position.lat, marker.position.lng], {
        icon: L.divIcon({
          className: '',
          // Warna WS 4 teal konsisten dengan legenda (peta embed ONC memakai
          // warna per titiknya sendiri — tidak diubah).
          html: `<div class="land-ws4-pin" style="--pin:${WS4_COLOR}">${letter}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        title: marker.label,
      }).addTo(layer);
      if (marker.showLabel !== false) {
        markerLayer.bindTooltip(marker.label, { permanent: true, direction: 'right', offset: [12, 0], className: 'land-tooltip' });
      }
    }
  }, [markers, lines, polygons, circles]);

  // ---- Adapter pola darat WS3 (amber) ----
  useEffect(() => {
    const layer = patternLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!pattern || pattern.segments.length === 0) return;
    const isConnector = (legIndex: number) => pattern.patternType === 'PS' || pattern.patternType === 'CS'
      ? (legIndex - 1) % 2 === 1
      : pattern.patternType === 'TS' && legIndex === 1;
    for (const segment of pattern.segments) {
      const connector = isConnector(segment.legIndex);
      L.polyline([[segment.from.lat, segment.from.lng], [segment.to.lat, segment.to.lng]], {
        color: connector ? PATTERN_CONNECTOR : PATTERN_COLOR,
        weight: connector ? 1.5 : 2.2,
        dashArray: connector ? '5 4' : undefined,
        opacity: connector ? 0.7 : 0.95,
      }).bindTooltip(
        `${connector ? 'Cross' : `Leg ${segment.legIndex}`} · ${segment.distanceNm.toFixed(1)} NM`,
        { className: 'land-tooltip', direction: 'top' },
      ).addTo(layer);
    }
    L.marker([pattern.segments[0].from.lat, pattern.segments[0].from.lng], {
      icon: L.divIcon({ className: '', html: `<div class="land-ws4-pin" style="--pin:${PATTERN_COLOR}">C</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      title: 'CSP pola darat',
    }).bindTooltip(`CSP · ${pattern.sruName}${pattern.spacingNm > 0 ? ` · S ${pattern.spacingNm} NM (${pattern.spacingLabel})` : ''}`, { className: 'land-tooltip', direction: 'top' }).addTo(layer);
  }, [pattern]);

  // ---- Sinkron pusat peta bila waypoint berubah ----
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const current = map.getCenter();
    if (Math.abs(current.lat - center.lat) > 1e-6 || Math.abs(current.lng - center.lng) > 1e-6) {
      map.setView([center.lat, center.lng], map.getZoom(), { animate: false });
    }
  }, [center.lat, center.lng]);

  // ---- Pasang/ganti basemap + fallback otomatis saat tile gagal -------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const def = BASEMAPS.find((b) => b.id === basemapId) ?? BASEMAPS[0];
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
      tileLayerRef.current = null;
    }
    let errorCount = 0;
    const mountedAt = Date.now();
    const layer = L.tileLayer(def.url, {
      attribution: def.attr,
      minZoom: 6,
      maxZoom: 19,
      maxNativeZoom: def.maxNativeZoom,
      subdomains: def.subdomains ?? 'abc',
    });
    layer.on('tileerror', () => {
      errorCount += 1;
      // tile.opentopomap.org (dan penyedia komunitas lain) membatasi laju
      // permintaan per-IP — bila ≥10 tile gagal di awal muat, pindah otomatis
      // ke penyedia berikutnya (sekali per sesi) agar peta tetap tergambar.
      if (errorCount >= 10 && Date.now() - mountedAt < 20000 && !autoFellBackRef.current) {
        autoFellBackRef.current = true;
        const index = BASEMAPS.findIndex((b) => b.id === def.id);
        const next = BASEMAPS[(index + 1) % BASEMAPS.length];
        setBasemapNotice(`${def.label} gagal dimuat (jaringan membatasi tile) — otomatis beralih ke ${next.label}.`);
        setBasemapId(next.id);
      }
    });
    layer.addTo(map);
    tileLayerRef.current = layer;
    return () => {
      layer.off('tileerror');
    };
  }, [basemapId]);

  return (
    <div
      className="land-map-root"
      onMouseEnter={() => { hotZoneRef.current = true; }}
      onMouseLeave={() => { hotZoneRef.current = false; }}
    >
      <style>{CSS}</style>
      {/* Pemilih basemap + pemberitahuan fallback otomatis */}
      <div className="land-map-toolbar mb-1.5 flex flex-wrap items-center gap-1.5 print:hidden" role="group" aria-label="Basemap peta darat">
        <span className="text-[11px] font-bold text-slate-700">Basemap:</span>
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => selectBasemap(b.id)}
            aria-pressed={basemapId === b.id}
            title={`Basemap ${b.label}`}
            className={`px-2 py-0.5 rounded border text-[11px] font-semibold transition-colors ${basemapId === b.id ? 'bg-slate-700 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            {b.label}
          </button>
        ))}
        {basemapNotice && (
          <span className="inline-flex items-center gap-1.5 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900">
            <span>{basemapNotice}</span>
            <button
              type="button"
              onClick={() => setBasemapNotice(null)}
              aria-label="Tutup pemberitahuan"
              className="font-bold text-amber-700 hover:text-amber-900"
            >
              ×
            </button>
          </span>
        )}
      </div>
      <div className={frameClassName} style={{ padding: `${MARGIN_Y}px ${MARGIN_X}px` }}>
        <div ref={topStripRef} className="land-edge-strip" style={{ top: 0, left: MARGIN_X, right: MARGIN_X, height: MARGIN_Y }} />
        <div ref={bottomStripRef} className="land-edge-strip" style={{ bottom: 0, left: MARGIN_X, right: MARGIN_X, height: MARGIN_Y }} />
        <div ref={leftStripRef} className="land-edge-strip" style={{ left: 0, top: MARGIN_Y, bottom: MARGIN_Y, width: MARGIN_X }} />
        <div ref={rightStripRef} className="land-edge-strip" style={{ right: 0, top: MARGIN_Y, bottom: MARGIN_Y, width: MARGIN_X }} />
        <div className="relative" style={{ height }}>
          <div ref={mapElRef} className="land-map-canvas border-2 border-slate-900" style={{ height: '100%' }} />
          {/* Menu Tampilan — parity dengan peta laut: sembunyikan/tampilkan
              panel layer, legenda, panah utara, kontrol skala, dan label tepi
              UTM. Tombol juga pintasan keyboard H. Sibling dari container
              Leaflet sehingga tidak tersapu kelas hide. */}
          <div className={`seamap-tampilan seamap-tampilan--land${everythingHidden ? ' is-collapsed' : ''}${menuOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              className="seamap-tampilan-btn"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? 'Tutup menu Tampilan' : 'Buka menu Tampilan'}
              title="Tampilan — sembunyikan/tampilkan elemen peta darat (H)"
            >
              <svg className="seamap-tampilan-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span className="seamap-tampilan-btn__label">Tampilan</span>
            </button>
            {menuOpen && (
              <div className="seamap-tampilan-menu" role="menu" aria-label="Pilihan tampilan peta darat">
                <label className="seamap-tampilan-row">
                  <input type="checkbox" checked={viewPrefs.layers} onChange={() => { setViewPrefs((p) => ({ ...p, layers: !p.layers })); clearHideToast(); }} suppressHydrationWarning />
                  <span>Panel layer</span>
                </label>
                <label className="seamap-tampilan-row">
                  <input type="checkbox" checked={viewPrefs.legend} onChange={() => { setViewPrefs((p) => ({ ...p, legend: !p.legend })); clearHideToast(); }} suppressHydrationWarning />
                  <span>Legenda</span>
                </label>
                <label className="seamap-tampilan-row">
                  <input type="checkbox" checked={viewPrefs.north} onChange={() => { setViewPrefs((p) => ({ ...p, north: !p.north })); clearHideToast(); }} suppressHydrationWarning />
                  <span>Panah utara</span>
                </label>
                <label className="seamap-tampilan-row">
                  <input type="checkbox" checked={viewPrefs.scale} onChange={() => { setViewPrefs((p) => ({ ...p, scale: !p.scale })); clearHideToast(); }} suppressHydrationWarning />
                  <span>Kontrol skala</span>
                </label>
                <label className="seamap-tampilan-row">
                  <input type="checkbox" checked={viewPrefs.edge} onChange={() => { setViewPrefs((p) => ({ ...p, edge: !p.edge })); clearHideToast(); }} suppressHydrationWarning />
                  <span>Label tepi UTM</span>
                </label>
                <button
                  type="button"
                  className="seamap-tampilan-all"
                  onClick={() => {
                    if (everythingHidden) {
                      setViewPrefs({ ...DEFAULT_LAND_VIEW_PREFS });
                      clearHideToast();
                    } else {
                      setViewPrefs({ layers: false, legend: false, north: false, scale: false, edge: false });
                      setMenuOpen(false);
                      flashHideToast();
                    }
                  }}
                  aria-pressed={everythingHidden}
                  aria-label={everythingHidden ? 'Tampilkan semua' : 'Sembunyikan semua'}
                >
                  {everythingHidden ? 'Tampilkan semua' : 'Sembunyikan semua'}
                </button>
              </div>
            )}
          </div>
          {hideToast && (
            <div className="seamap-hide-toast" role="status">
              Elemen peta darat disembunyikan — klik tombol{' '}
              <strong>Tampilan</strong> di kiri bawah (atau tekan <strong>H</strong>)
              untuk menampilkan kembali.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
