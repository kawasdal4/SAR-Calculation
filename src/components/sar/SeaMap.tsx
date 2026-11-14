'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type LatLng, distanceNm } from '@/lib/sar/sarCalculations';
import { drawGraticule } from '@/lib/sar/latLonGrid';
import {
  getDepthAt,
  getPolygonDepths,
  summariseDepths,
  getDepthSourceInfo,
} from '@/lib/sar/depthSources';

// ============================================================================
// Public types — kept stable with the original SeaMap API so callers (page.tsx)
// don't need to change.
// ============================================================================

export interface MapMarker {
  position: LatLng;
  label: string;
  color?: string;
  isStart?: boolean;
  isDatum?: boolean;
}

export interface MapLine {
  from: LatLng;
  to: LatLng;
  color: string;
  label?: string;
  dashed?: boolean;
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

function makeColoredIcon(color: string, isStart?: boolean, isDatum?: boolean) {
  const shape = isStart ? '◆' : isDatum ? '◉' : '●';
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
      color:#fff;font-size:11px;font-weight:bold;
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
  return `${deg}°${min.toString().padStart(2, '0')}'${sec.padStart(4, '0')}"${hemi}`;
}

function formatDepth(m: number | null): string {
  if (m == null) return 'N/A';
  if (m < 0) return `${Math.abs(m).toFixed(1)} m (depth)`;
  if (m === 0) return '0 m (sea level)';
  return `+${m.toFixed(1)} m (land)`;
}

// ============================================================================
// Constants for the map layers (all client-side; no proxy)
// ============================================================================

// Base + overlay layers (all free, no API key)
const OSM_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTR = '© OpenStreetMap contributors';
const OSM_MAX_ZOOM = 19;

const SEAMARK_URL = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
const SEAMARK_ATTR = '© OpenSeaMap';
const SEAMARK_MAX_ZOOM = 18;

// GEBCO WMS — current URL & layer names verified via GetCapabilities (Nov 2026):
//   https://wms.gebco.net/mapserv?service=WMS&request=GetCapabilities&version=1.3.0
// Layers served:
//   GEBCO_LATEST       — shaded relief image
//   GEBCO_LATEST_2     — flat colour-coded for elevation (this is what we use)
//   GEBCO_LATEST_3     — measured-data-only overlay
const GEBCO_WMS_URL = 'https://wms.gebco.net/mapserv?';
const GEBCO_LAYER = 'GEBCO_LATEST_2';
const GEBCO_ATTR = 'Imagery reproduced from the GEBCO Grid, GEBCO (https://www.gebco.net/)';

// Open-Topo-Data was originally planned for depth lookup, but its public
// endpoint doesn't return CORS headers (`Access-Control-Allow-Origin`),
// so browser-side fetch fails. GEBCO WMS GetFeatureInfo returns `*` CORS
// and uses the same grid as the bathymetry tiles — better fit.
const DEPTH_ATTR = 'Depth: GEBCO WMS GetFeatureInfo';

// ----------------------------------------------------------------------------
// BATNAS (BIG Indonesia) layer — optional, env-var driven.
// If NEXT_PUBLIC_BATNAS_TILES_URL is set, the tile PNG layer + checkbox +
// opacity slider are shown. If NEXT_PUBLIC_BATNAS_COG_URL is set, click-to-depth
// and polygon-depth-sampling use BATNAS COG (via geotiff.js) instead of GEBCO.
// If both are unset, BATNAS is hidden and the app falls back to GEBCO WMS.
// ----------------------------------------------------------------------------
const BATNAS_TILES_URL = process.env.NEXT_PUBLIC_BATNAS_TILES_URL;
const BATNAS_TILES_CONFIGURED = !!BATNAS_TILES_URL;
const BATNAS_ATTR = 'BATNAS: Badan Informasi Geospasial (BIG) Indonesia';
const BATNAS_RESOLUTION_NOTE = 'BATNAS resolusi sekitar 180 m, hanya untuk perkiraan awal.';

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
}: SeaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  // Refs to read latest prop values inside the map's once-bound click handler
  const pickModeRef = useRef<boolean>(pickMode);
  const measureModeRef = useRef<boolean>(measureMode);
  const onMapClickRef = useRef<typeof onMapClick>(onMapClick);

  useEffect(() => {
    pickModeRef.current = pickMode;
  }, [pickMode]);
  useEffect(() => {
    measureModeRef.current = measureMode;
  }, [measureMode]);
  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  // Stable refs to layer objects so we can re-render without re-creating the map
  const layersRef = useRef<{
    osm?: L.TileLayer;
    seamark?: L.TileLayer;
    gebco?: L.TileLayer.WMS;
    graticule?: L.LayerGroup;
    markers?: L.LayerGroup;
    lines?: L.LayerGroup;
    polygons?: L.LayerGroup;
    circles?: L.LayerGroup;
    depthMarkers?: L.LayerGroup;
    measureLine?: L.Polyline | null;
    measureMarkers?: L.Marker[];
    coordReadout?: HTMLDivElement;
    depthSummaryPopup?: L.Popup | null;
  }>({});

  // ---- Initialise the map ONCE ----
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      scrollWheelZoom: true,
      attributionControl: true,
    });

    // Base OSM layer
    const osm = L.tileLayer(OSM_URL, {
      attribution: OSM_ATTR,
      maxZoom: OSM_MAX_ZOOM,
    }).addTo(map);

    // OpenSeaMap seamark overlay
    const seamark = L.tileLayer(SEAMARK_URL, {
      attribution: SEAMARK_ATTR,
      maxZoom: SEAMARK_MAX_ZOOM,
      tileSize: 256,
      opacity: 0.9,
    }).addTo(map);

    // GEBCO bathymetry WMS — added but OFF by default (user can toggle on)
    const gebco = L.tileLayer.wms(GEBCO_WMS_URL, {
      layers: GEBCO_LAYER,
      format: 'image/png',
      transparent: true,
      attribution: GEBCO_ATTR,
      opacity: 0.65,
      maxZoom: 12,
    });

    // BATNAS tiles layer — only created if NEXT_PUBLIC_BATNAS_TILES_URL is set.
    // Off by default; user toggles on. Reads tile PNGs at {z}/{x}/{y}.png from
    // the URL configured in env var.
    const batnas = BATNAS_TILES_CONFIGURED && BATNAS_TILES_URL
      ? L.tileLayer(BATNAS_TILES_URL, {
          attribution: BATNAS_ATTR,
          opacity: 0.7,
          maxZoom: 14,
          tileSize: 256,
          // TMS vs XYZ detection: BIG publishes in XYZ (standard Leaflet) by default.
          // If the host serves TMS, set tms: true here.
        })
      : null;

    // Graticule (lat/lon grid) — built once, redrawn on zoom/move
    const graticule = L.layerGroup().addTo(map);
    const redrawGraticule = () => {
      graticule.clearLayers();
      drawGraticule(map, graticule, {});
    };
    redrawGraticule();
    map.on('zoomend moveend', redrawGraticule);

    // Layer groups for SAR overlays (markers, lines, polygons, circles)
    const markersLayer = L.layerGroup().addTo(map);
    const linesLayer = L.layerGroup().addTo(map);
    const polygonsLayer = L.layerGroup().addTo(map);
    const circlesLayer = L.layerGroup().addTo(map);
    const depthMarkersLayer = L.layerGroup().addTo(map);

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
      const lng = ((e.latlng.lng + 540) % 360) - 180; // normalise to [-180, 180]
      readoutEl.textContent = `${formatDMS(lat, true)}  ${formatDMS(lng, false)}`;
    });
    map.on('mouseout', () => {
      readoutEl.textContent = '— · —';
    });

    // ---- Scale control: metric + nautical ----
    // Leaflet's built-in L.control.scale only shows metric + imperial; we add nautical too.
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);
    addNauticalScale(map);

    // ---- Disclaimer badge (top-right) ----
    const DisclaimerControl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'sar-disclaimer-badge');
        div.textContent = '⚠ Bukan untuk navigasi pelayaran';
        div.title = 'Bukan untuk navigasi pelayaran; akurasi tidak dijamin.';
        return div;
      },
    });
    new DisclaimerControl({ position: 'topright' }).addTo(map);

    // ---- Custom layer-control panel with toggle + opacity slider ----
    const LayerPanelControl = L.Control.extend({
      onAdd: () => {
        const div = L.DomUtil.create('div', 'sar-layer-controls');
        const batnasRow = BATNAS_TILES_CONFIGURED
          ? `
            <div class="layer-row">
              <label><input type="checkbox" id="lyr-batnas" /> BATNAS (BIG)</label>
              <input type="range" id="lyr-batnas-opacity" min="0" max="100" value="70" />
              <div style="font-size:9px;color:#64748b;margin-top:2px;">${BATNAS_RESOLUTION_NOTE}</div>
            </div>
          `
          : '';
        div.innerHTML = `
          <h4>Map Layers</h4>
          <div class="layer-row">
            <label><input type="checkbox" id="lyr-osm" checked /> OpenStreetMap (base)</label>
          </div>
          <div class="layer-row">
            <label><input type="checkbox" id="lyr-seamark" checked /> OpenSeaMap (seamark)</label>
          </div>
          <div class="layer-row">
            <label><input type="checkbox" id="lyr-gebco" /> GEBCO bathymetry</label>
            <input type="range" id="lyr-gebco-opacity" min="0" max="100" value="65" />
          </div>
          ${batnasRow}
          <div class="layer-row">
            <label><input type="checkbox" id="lyr-grid" checked /> Lat/Lon grid</label>
          </div>
        `;
        return div;
      },
    });
    new LayerPanelControl({ position: 'topright' }).addTo(map);

    // Wire up the layer-control panel after it's added to DOM
    setTimeout(() => {
      const osmCb = document.getElementById('lyr-osm') as HTMLInputElement | null;
      const seamarkCb = document.getElementById('lyr-seamark') as HTMLInputElement | null;
      const gebcoCb = document.getElementById('lyr-gebco') as HTMLInputElement | null;
      const gebcoOp = document.getElementById('lyr-gebco-opacity') as HTMLInputElement | null;
      const gridCb = document.getElementById('lyr-grid') as HTMLInputElement | null;
      const batnasCb = document.getElementById('lyr-batnas') as HTMLInputElement | null;
      const batnasOp = document.getElementById('lyr-batnas-opacity') as HTMLInputElement | null;

      if (osmCb) osmCb.addEventListener('change', () => (osmCb.checked ? osm.addTo(map) : map.removeLayer(osm)));
      if (seamarkCb) seamarkCb.addEventListener('change', () => (seamarkCb.checked ? seamark.addTo(map) : map.removeLayer(seamark)));
      if (gebcoCb) gebcoCb.addEventListener('change', () => (gebcoCb.checked ? gebco.addTo(map) : map.removeLayer(gebco)));
      if (gebcoOp) gebcoOp.addEventListener('input', () => gebco.setOpacity(parseInt(gebcoOp.value, 10) / 100));
      if (gridCb) gridCb.addEventListener('change', () => (gridCb.checked ? graticule.addTo(map) : map.removeLayer(graticule)));
      if (batnasCb && batnas) {
        batnasCb.addEventListener('change', () => (batnasCb.checked ? batnas.addTo(map) : map.removeLayer(batnas)));
      }
      if (batnasOp && batnas) {
        batnasOp.addEventListener('input', () => batnas.setOpacity(parseInt(batnasOp.value, 10) / 100));
      }
    }, 50);

    // ---- Map click handler ----
    // Two modes:
    //   - Normal: call onMapClick (used for "Pick LKP" feature)
    //   - Measure: append point to a measurement polyline, show cumulative distance
    const measureMarkers: L.Marker[] = [];
    let measureLine: L.Polyline | null = null;

    map.on('click', (e: L.LeafletMouseEvent) => {
      const lat = e.latlng.lat;
      const lng = ((e.latlng.lng + 540) % 360) - 180;
      const latlng: LatLng = { lat, lng };

      // Measure mode: append vertex to measurement polyline
      if (measureModeRef.current) {
        // Add a vertex to the measurement polyline
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
          // Cumulative distance
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

      // Default: fetch depth at clicked point (GEBCO WMS GetFeatureInfo)
      void showDepthAt(map, depthMarkersLayer, lat, lng);
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

    // Persist refs for later updates
    layersRef.current = {
      osm,
      seamark,
      gebco,
      graticule,
      markers: markersLayer,
      lines: linesLayer,
      polygons: polygonsLayer,
      circles: circlesLayer,
      depthMarkers: depthMarkersLayer,
      measureLine,
      measureMarkers,
      coordReadout: readoutEl,
    };

    mapRef.current = map;

    // Force Leaflet to compute tile layout correctly after mount
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = {};
    };
  }, []);

  // ---- Update center/zoom when props change ----
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setView([center.lat, center.lng], zoom);
  }, [center.lat, center.lng, zoom]);

  // ---- Toggle measure mode: clear measurement when leaving measure mode ----
  useEffect(() => {
    const layers = layersRef.current;
    if (!layers || !mapRef.current) return;
    if (!measureMode) {
      // Clear any in-progress measurement
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
    const layer = layersRef.current.markers;
    layer.clearLayers();
    markers.forEach((m) => {
      const color = m.color ?? '#ef4444';
      const marker = L.marker([m.position.lat, m.position.lng], {
        icon: makeColoredIcon(color, m.isStart, m.isDatum),
      }).addTo(layer);
      marker.bindPopup(
        `<b>${m.label}</b><br/>${m.position.lat.toFixed(4)}, ${m.position.lng.toFixed(4)}`,
      );
    });
  }, [markers]);

  // ---- Draw lines ----
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.lines) return;
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
          weight: 2.5,
          opacity: 0.85,
          dashArray: l.dashed ? '6 6' : undefined,
        },
      ).addTo(layer);
      if (l.label) {
        const mid = {
          lat: (l.from.lat + l.to.lat) / 2,
          lng: (l.from.lng + l.to.lng) / 2,
        };
        L.tooltip({ permanent: true, direction: 'top', className: 'sar-label' })
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
      // Fetch depth summary inside polygon (sample grid up to 100 points)
      // Dispatches to BATNAS COG (if configured) or GEBCO WMS GetFeatureInfo.
      if (p.points.length >= 3) {
        void getPolygonDepths(p.points, 100).then((results) => {
          const summary = summariseDepths(results);
          if (summary.count === 0) return;
          const info = getDepthSourceInfo();
          const sourceLabel = info.source === 'BATNAS'
            ? 'Bathymetri (BATNAS — BIG, ~180 m)'
            : 'Bathymetri (GEBCO Grid)';
          const label = `Depth inside area: min ${formatDepth(summary.min)} · max ${formatDepth(summary.max)} · mean ${formatDepth(summary.mean)} (${summary.count} samples)`;
          L.popup({ className: 'sar-depth-popup', closeButton: false, offset: [0, 0] })
            .setLatLng(L.latLngBounds(latlngs).getCenter())
            .setContent(
              `<div class="depth-label">${sourceLabel}</div>` +
              `<div class="depth-value">${formatDepth(summary.min)} … ${formatDepth(summary.max)}</div>` +
              `<div class="depth-label">mean ${formatDepth(summary.mean)} · ${summary.count} samples</div>`,
            )
            .addTo(layer);
          void label;
        });
      }
    });
  }, [polygons]);

  // ---- Draw circles (search radii, probable error circles) ----
  useEffect(() => {
    if (!mapRef.current || !layersRef.current.circles) return;
    const layer = layersRef.current.circles;
    layer.clearLayers();
    circles.forEach((c) => {
      const radiusMeters = c.radiusNm * 1852; // 1 NM = 1852 m
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

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%', borderRadius: '0.5rem', overflow: 'hidden' }}
      role="application"
      aria-label="Interactive sea map showing search and rescue datum, search areas, and bathymetry"
    />
  );
}

// ============================================================================
// Helper: show depth at a clicked point (single-point query).
// Dispatches to BATNAS COG (if configured) or GEBCO WMS GetFeatureInfo.
// ============================================================================

async function showDepthAt(map: L.Map, layer: L.LayerGroup, lat: number, lng: number): Promise<void> {
  // Show a temporary "loading" marker
  const loadingMarker = L.circleMarker([lat, lng], {
    radius: 5,
    color: '#0369a1',
    fillColor: '#0369a1',
    fillOpacity: 0.6,
    weight: 2,
  }).addTo(layer);
  loadingMarker.bindTooltip('Fetching depth…', { permanent: true, direction: 'top' });

  try {
    const result = await getDepthAt(lat, lng);
    layer.removeLayer(loadingMarker);
    if (!result) {
      L.popup({ className: 'sar-depth-popup', closeButton: true })
        .setLatLng([lat, lng])
        .setContent(
          `<div class="depth-label">Depth unavailable</div>` +
          `<div style="color:#475569;">Tidak ada data kedalaman untuk titik ini.</div>`,
        )
        .addTo(map);
      return;
    }
    // Use the actual dataset from result (may be BATNAS or GEBCO fallback)
    const sourceLabel = result.dataset.startsWith('BATNAS')
      ? 'Depth (BATNAS — BIG Indonesia, ~180 m resolution)'
      : result.dataset.startsWith('GEBCO WMS (fallback)')
      ? 'Depth (GEBCO Grid, WMS GetFeatureInfo — BATNAS fallback)'
      : `Depth (${result.dataset})`;
    const popup = L.popup({ className: 'sar-depth-popup', closeButton: true, autoPan: true })
      .setLatLng([lat, lng])
      .setContent(
        `<div class="depth-label">${sourceLabel}</div>` +
        `<div class="depth-value">${formatDepth(result.elevation)}</div>` +
        `<div class="depth-label">${formatDMS(lat, true)} · ${formatDMS(lng, false)}</div>`,
      )
      .addTo(map);
    void popup;
  } catch (e) {
    layer.removeLayer(loadingMarker);
    const msg = (e as Error).message;
    L.popup({ className: 'sar-depth-popup', closeButton: true })
      .setLatLng([lat, lng])
      .setContent(
        `<div class="depth-label">Depth fetch failed</div>` +
        `<div style="color:#b91c1c;font-weight:600;">${msg}</div>`,
      )
      .addTo(map);
  }
}

// ============================================================================
// Helper: add a nautical scale to the metric Leaflet scale control
// ============================================================================

function addNauticalScale(map: L.Map): void {
  // The Leaflet L.Control.Scale builds its DOM after addTo(). We hook into
  // 'zoomend moveend' to also update a nautical label below it.
  const update = () => {
    const metricEl = document.querySelector('.leaflet-control-scale-line') as HTMLElement | null;
    if (!metricEl) return;
    // Parse "100 m" / "1 km" / "500 km" style
    const text = metricEl.textContent ?? '';
    const match = text.match(/^([\d.]+)\s*(m|km)$/);
    let nm: number | null = null;
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2];
      const meters = unit === 'km' ? value * 1000 : value;
      nm = meters / 1852;
    }
    let nauticalEl = document.querySelector('.leaflet-control-scale-nautical') as HTMLElement | null;
    if (!nauticalEl) {
      nauticalEl = document.createElement('div');
      nauticalEl.className = 'leaflet-control-scale-line leaflet-control-scale-nautical';
      nauticalEl.style.borderTop = 'none';
      nauticalEl.style.paddingTop = '0';
      metricEl.parentElement?.appendChild(nauticalEl);
    }
    nauticalEl.textContent = nm != null ? `${nm.toFixed(nm < 10 ? 2 : 1)} NM` : '';
  };
  map.on('zoomend moveend', update);
  setTimeout(update, 100);
}
