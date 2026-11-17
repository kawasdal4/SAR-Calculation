'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { setWorkerUrl } from 'maplibre-gl';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { project, type LatLng } from '@/lib/sar/sarCalculations';
import { buildOncGraticule } from '@/lib/sar/oncGraticule';
import { formatMefFeet } from '@/lib/sar/oncMef.mjs';
import type { MapCircle, MapLine, MapMarker, MapPolygon } from '@/components/sar/SeaMap';

// MapLibre GL JS v6 needs an explicit worker URL with Next.js/Turbopack.
setWorkerUrl(new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).toString());

type BasemapChoice = 'osm' | 'opentopomap';
type OverlayProperties = {
  kind: 'marker' | 'line' | 'polygon' | 'circle-label';
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
  label?: string;
  showLabel?: boolean;
  sequence?: number;
};
interface Worksheet4MapLibreProps {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  lines?: MapLine[];
  polygons?: MapPolygon[];
  circles?: MapCircle[];
  height?: string;
}

const AIRPORT_SOURCE_ID = 'openaip-airports';
const AIRPORT_LAYER_ID = 'openaip-airports-points';
const AIRPORT_LABEL_ID = 'openaip-airports-labels';
const OVERLAY_SOURCE_ID = 'worksheet4-overlays';
const GRATICULE_SOURCE_ID = 'worksheet4-onc-graticule';
const MEF_SOURCE_ID = 'worksheet4-mef';
const SCAN_SOURCE_ID = 'worksheet4-onc-scan';
const SCAN_LAYER_ID = 'worksheet4-onc-scan-raster';
const GRATICULE_LAYER_IDS = [
  'worksheet4-graticule-minor',
  'worksheet4-graticule-major',
  'worksheet4-graticule-ticks',
  'worksheet4-graticule-degree-lon',
  'worksheet4-graticule-degree-lat',
  'worksheet4-graticule-minute-horizontal',
  'worksheet4-graticule-minute-vertical',
] as const;
const MEF_LAYER_IDS = ['worksheet4-mef-fill', 'worksheet4-mef-outline', 'worksheet4-mef-labels'] as const;
const ONC_SCAN_TILE_URL = process.env.NEXT_PUBLIC_ONC_SCAN_TILE_URL?.trim() ?? '';
const MEF_WARNING = 'MEF turunan DEM, bukan angka resmi ONC. Jangan dijadikan satu-satunya acuan keselamatan penerbangan.';
type MefGridSize = '1deg' | '30min' | '15min';
type MefDocument = FeatureCollection<Geometry, GeoJsonProperties> & {
  metadata?: { cell_arcmin?: number; source?: string; generated_at?: string; disclaimer?: string };
};

const EMPTY_GEOJSON: FeatureCollection<Geometry, GeoJsonProperties> = { type: 'FeatureCollection', features: [] };
const GRID_ARCMIN: Record<MefGridSize, number> = { '1deg': 60, '30min': 30, '15min': 15 };
const SUPER_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

function normalizeMefDocument(document: MefDocument, gridSize: MefGridSize): FeatureCollection<Geometry, GeoJsonProperties> {
  const cellArcmin = document.metadata?.cell_arcmin ?? GRID_ARCMIN[gridSize];
  return {
    ...document,
    features: document.features.map((feature) => {
      const properties = (feature.properties ?? {}) as Record<string, unknown>;
      const mefFeet = Number(properties.mef_ft ?? 0);
      const formatted = formatMefFeet(mefFeet);
      const [west, south, east, north] = feature.geometry.type === 'Polygon'
        ? [
            feature.geometry.coordinates[0]?.[0]?.[0],
            feature.geometry.coordinates[0]?.[0]?.[1],
            feature.geometry.coordinates[0]?.[2]?.[0],
            feature.geometry.coordinates[0]?.[2]?.[1],
          ]
        : [undefined, undefined, undefined, undefined];
      return {
        ...feature,
        properties: {
          ...properties,
          max_elev_m: properties.max_elev_m ?? properties.max_m,
          max_elev_ft: properties.max_elev_ft ?? properties.max_ft,
          mef_large: properties.mef_large ?? properties.thousands ?? formatted.large,
          mef_hundreds_superscript: properties.mef_hundreds_superscript
            ?? SUPER_DIGITS[Number(properties.hundreds ?? formatted.hundreds)],
          mef_label: properties.mef_label ?? properties.label ?? formatted.label,
          grid_size_deg: properties.grid_size_deg ?? cellArcmin / 60,
          west: properties.west ?? west,
          south: properties.south ?? south,
          east: properties.east ?? east,
          north: properties.north ?? north,
          dem_source: properties.dem_source ?? properties.source ?? document.metadata?.source,
          dem_date: properties.dem_date ?? document.metadata?.generated_at,
        },
      };
    }),
  };
}

function rasterStyle(choice: BasemapChoice): maplibregl.StyleSpecification {
  const isTopo = choice === 'opentopomap';
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        // MapLibre does not expand Leaflet's `{a-c}` subdomain shorthand.
        // List each tile host explicitly so requests are distributed correctly.
        tiles: isTopo
          ? [
              'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
              'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
              'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
            ]
          : ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: isTopo
          ? 'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)'
          : '© OpenStreetMap contributors',
        maxzoom: 17,
      },
    },
    // MapLibre GL JS 5.11+ can use local fonts when `glyphs` is omitted.
    // Avoid the demo glyph endpoint, which currently returns 404 for these ranges.
    layers: [{ id: 'basemap-raster', type: 'raster', source: 'basemap' }],
  };
}

function toDDM(value: number, axis: 'lat' | 'lng'): string {
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutes = ((absolute - degrees) * 60).toFixed(3).padStart(6, '0');
  const hemisphere = axis === 'lat'
    ? value < 0 ? 'S' : 'N'
    : value < 0 ? 'W' : 'E';
  return `${String(degrees).padStart(axis === 'lat' ? 2 : 3, '0')}° ${minutes}′ ${hemisphere}`;
}

function airportDescription(properties: Record<string, unknown>, position: maplibregl.LngLat): HTMLElement {
  const root = document.createElement('div');
  root.className = 'w-64 space-y-1 text-xs text-slate-800';
  const title = document.createElement('strong');
  title.className = 'block text-sm text-slate-950';
  title.textContent = String(properties.name ?? properties.name_label_full ?? properties.name_label ?? 'Bandara');
  root.appendChild(title);

  const rawElevation = properties.elevation;
  const elevationLabel = typeof properties.elevation_ft === 'number'
    ? `${properties.elevation_ft} ft`
    : typeof rawElevation === 'number'
      ? `${rawElevation} m`
      : typeof rawElevation === 'object' && rawElevation !== null && 'value' in rawElevation
        ? `${String(rawElevation.value)} ${'unit' in rawElevation ? String(rawElevation.unit) : 'm'}`
        : undefined;
  const rows: Array<[string, unknown]> = [
    ['ICAO', properties.icao_code ?? properties.icaoCode],
    ['IATA', properties.iata_code ?? properties.iataCode],
    ['Tipe', properties.type],
    ['Koordinat', `${position.lat.toFixed(6)}, ${position.lng.toFixed(6)} · ${toDDM(position.lat, 'lat')}, ${toDDM(position.lng, 'lng')}`],
    ['Elevasi', elevationLabel],
  ];
  for (const [label, value] of rows) {
    if (value === undefined || value === null || value === '') continue;
    const row = document.createElement('div');
    row.textContent = `${label}: ${String(value)}`;
    root.appendChild(row);
  }
  return root;
}

function overlaysToGeoJSON(
  markers: MapMarker[], lines: MapLine[], polygons: MapPolygon[], circles: MapCircle[],
): FeatureCollection<Geometry, OverlayProperties> {
  const features: Array<Feature<Geometry, OverlayProperties>> = [];
  for (const polygon of polygons) {
    const coordinates = polygon.points.map(({ lat, lng }) => [lng, lat] as [number, number]);
    if (coordinates.length >= 3) {
      coordinates.push(coordinates[0]);
      features.push({ type: 'Feature', properties: { kind: 'polygon', color: polygon.color, fillColor: polygon.fillColor ?? polygon.color, fillOpacity: polygon.fillOpacity ?? 0.08, label: polygon.label }, geometry: { type: 'Polygon', coordinates: [coordinates] } });
    }
  }
  for (const circle of circles) {
    const ring = Array.from({ length: 73 }, (_, index) => {
      const point = project(circle.center, index * 5, circle.radiusNm);
      return [point.lng, point.lat] as [number, number];
    });
    features.push({ type: 'Feature', properties: { kind: 'polygon', color: circle.color, fillColor: circle.fillColor ?? circle.color, fillOpacity: circle.fillOpacity ?? 0.08 }, geometry: { type: 'Polygon', coordinates: [ring] } });
    if (circle.label) features.push({ type: 'Feature', properties: { kind: 'circle-label', color: circle.color, label: circle.label, showLabel: true }, geometry: { type: 'Point', coordinates: [circle.center.lng, circle.center.lat] } });
  }
  for (const line of lines) {
    features.push({ type: 'Feature', properties: { kind: 'line', color: line.color, label: line.label }, geometry: { type: 'LineString', coordinates: [[line.from.lng, line.from.lat], [line.to.lng, line.to.lat]] } });
  }
  for (const marker of markers) {
    features.push({ type: 'Feature', properties: { kind: 'marker', color: marker.color ?? '#0f172a', label: marker.label, showLabel: marker.showLabel, sequence: marker.sequence }, geometry: { type: 'Point', coordinates: [marker.position.lng, marker.position.lat] } });
  }
  return { type: 'FeatureCollection', features };
}

function addAirportLayers(map: maplibregl.Map, visible: boolean): void {
  if (!map.getSource(AIRPORT_SOURCE_ID)) {
    map.addSource(AIRPORT_SOURCE_ID, {
      type: 'vector',
      tiles: ['/api/tiles/openaip/{z}/{x}/{y}.pbf'],
      minzoom: 2,
      maxzoom: 14,
      attribution: '© OpenAIP',
    });
  }
  const visibility = visible ? 'visible' : 'none';
  if (!map.getLayer(AIRPORT_LAYER_ID)) {
    map.addLayer({
      id: AIRPORT_LAYER_ID,
      type: 'circle',
      source: AIRPORT_SOURCE_ID,
      'source-layer': 'airports',
      minzoom: 3,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 2, 8, 4, 13, 6],
        'circle-color': ['match', ['get', 'type'],
          'heli_civil', '#7c3aed', 'heli_mil', '#6d28d9',
          'intl_apt', '#dc2626', 'mil_apt', '#b91c1c',
          'airstrip', '#d97706', 'gliding', '#0f766e', '#2563eb'],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 1.25,
        'circle-opacity': 0.95,
      },
      layout: { visibility },
    });
  }
  if (!map.getLayer(AIRPORT_LABEL_ID)) {
    map.addLayer({
      id: AIRPORT_LABEL_ID,
      type: 'symbol',
      source: AIRPORT_SOURCE_ID,
      'source-layer': 'airports',
      minzoom: 7,
      layout: {
        'text-field': ['coalesce', ['get', 'icao_code'], ['get', 'name_label'], ['get', 'name']],
        'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 12, 12],
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-max-width': 14,
        'text-optional': true,
        'symbol-sort-key': ['to-number', ['coalesce', ['get', 'importance'], 0]],
        visibility,
      },
      paint: { 'text-color': '#111827', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
    });
  }
}

function addScanLayer(map: maplibregl.Map, visible: boolean, opacity: number): void {
  if (!ONC_SCAN_TILE_URL) return;
  if (!map.getSource(SCAN_SOURCE_ID)) {
    map.addSource(SCAN_SOURCE_ID, {
      type: 'raster',
      tiles: [ONC_SCAN_TILE_URL],
      tileSize: 256,
      attribution: 'Scan ONC georeferensi pengguna',
    });
  }
  if (!map.getLayer(SCAN_LAYER_ID)) {
    map.addLayer({
      id: SCAN_LAYER_ID,
      type: 'raster',
      source: SCAN_SOURCE_ID,
      paint: { 'raster-opacity': opacity },
      layout: { visibility: visible ? 'visible' : 'none' },
    });
  }
}

function addGraticuleLayers(map: maplibregl.Map, visible: boolean): void {
  if (!map.getSource(GRATICULE_SOURCE_ID)) {
    map.addSource(GRATICULE_SOURCE_ID, { type: 'geojson', data: EMPTY_GEOJSON });
  }
  const visibility = visible ? 'visible' : 'none';
  if (!map.getLayer('worksheet4-graticule-minor')) {
    map.addLayer({
      id: 'worksheet4-graticule-minor', type: 'line', source: GRATICULE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'minor'],
      paint: { 'line-color': '#315574', 'line-width': 0.65, 'line-opacity': 0.4 },
      layout: { visibility },
    });
  }
  if (!map.getLayer('worksheet4-graticule-major')) {
    map.addLayer({
      id: 'worksheet4-graticule-major', type: 'line', source: GRATICULE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'major'],
      paint: { 'line-color': '#254866', 'line-width': 1.2, 'line-opacity': 0.65 },
      layout: { visibility },
    });
  }
  if (!map.getLayer('worksheet4-graticule-ticks')) {
    map.addLayer({
      id: 'worksheet4-graticule-ticks', type: 'line', source: GRATICULE_SOURCE_ID,
      filter: ['==', ['get', 'kind'], 'tick'],
      paint: {
        'line-color': '#254866',
        'line-width': ['match', ['get', 'tickMinutes'], 10, 1.4, 5, 1.1, 0.8],
        'line-opacity': 0.8,
      },
      layout: { visibility },
    });
  }
  const addLabelLayer = (
    id: string,
    filter: maplibregl.FilterSpecification,
    anchor: 'top' | 'left' | 'center',
    size: number,
  ) => {
    if (map.getLayer(id)) return;
    map.addLayer({
      id, type: 'symbol', source: GRATICULE_SOURCE_ID, filter,
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Open Sans Regular'],
        'text-size': size,
        'text-anchor': anchor,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 2,
        visibility,
      },
      paint: { 'text-color': '#294e6b', 'text-halo-color': '#fff', 'text-halo-width': 2, 'text-opacity': 0.95 },
    });
  };
  addLabelLayer('worksheet4-graticule-degree-lon', ['all', ['==', ['get', 'kind'], 'degree-label'], ['==', ['get', 'axis'], 'longitude']], 'center', 10);
  addLabelLayer('worksheet4-graticule-degree-lat', ['all', ['==', ['get', 'kind'], 'degree-label'], ['==', ['get', 'axis'], 'latitude']], 'center', 10);
  addLabelLayer('worksheet4-graticule-minute-horizontal', ['all', ['==', ['get', 'kind'], 'minute-label'], ['==', ['get', 'axis'], 'longitude']], 'center', 8);
  addLabelLayer('worksheet4-graticule-minute-vertical', ['all', ['==', ['get', 'kind'], 'minute-label'], ['==', ['get', 'axis'], 'latitude']], 'center', 8);
}

function addMefLayers(map: maplibregl.Map, visible: boolean): void {
  if (!map.getSource(MEF_SOURCE_ID)) {
    map.addSource(MEF_SOURCE_ID, { type: 'geojson', data: EMPTY_GEOJSON });
  }
  const visibility = visible ? 'visible' : 'none';
  if (!map.getLayer('worksheet4-mef-fill')) {
    map.addLayer({
      id: 'worksheet4-mef-fill', type: 'fill', source: MEF_SOURCE_ID,
      paint: { 'fill-color': '#66839a', 'fill-opacity': 0.025 },
      layout: { visibility },
    });
  }
  if (!map.getLayer('worksheet4-mef-outline')) {
    map.addLayer({
      id: 'worksheet4-mef-outline', type: 'line', source: MEF_SOURCE_ID,
      paint: { 'line-color': '#4e6e86', 'line-width': 0.55, 'line-opacity': 0.28 },
      layout: { visibility },
    });
  }
  if (!map.getLayer('worksheet4-mef-labels')) {
    map.addLayer({
      id: 'worksheet4-mef-labels', type: 'symbol', source: MEF_SOURCE_ID,
      layout: {
        'text-field': [
          'format',
          ['get', 'mef_large'], { 'font-scale': 1.3 },
          ['get', 'mef_hundreds_superscript'], { 'font-scale': 0.72 },
        ],
        'text-font': ['Open Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, 12, 8, 18, 12, 22],
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 1,
        visibility,
      },
      paint: { 'text-color': '#4c6274', 'text-halo-color': '#fff', 'text-halo-width': 1.8, 'text-opacity': 0.78 },
    });
  }
}

function mefDescription(properties: Record<string, unknown>): HTMLElement {
  const root = document.createElement('div');
  root.className = 'w-72 space-y-1 text-xs text-slate-800';
  const title = document.createElement('strong');
  title.className = 'block text-sm text-slate-950';
  title.textContent = `MEF turunan DEM · ${String(properties.mef_label ?? '-')}`;
  root.appendChild(title);
  const rows: Array<[string, unknown]> = [
    ['Elevasi maksimum', `${String(properties.max_elev_m ?? '-')} m / ${String(properties.max_elev_ft ?? '-')} ft`],
    ['MEF (dibulatkan ke atas)', `${String(properties.mef_ft ?? '-')} ft`],
    ['Grid', `${String(properties.grid_size_deg ?? '-')}°`],
    ['Batas (W, S, E, N)', `${String(properties.west ?? '-')}, ${String(properties.south ?? '-')}, ${String(properties.east ?? '-')}, ${String(properties.north ?? '-')}`],
    ['Sumber DEM', properties.dem_source],
    ['Tanggal data', properties.dem_date],
  ];
  for (const [label, value] of rows) {
    const row = document.createElement('div');
    row.textContent = `${label}: ${String(value ?? '-')}`;
    root.appendChild(row);
  }
  const warning = document.createElement('p');
  warning.className = 'mt-2 border-t border-amber-300 pt-2 font-semibold text-amber-900';
  warning.textContent = MEF_WARNING;
  root.appendChild(warning);
  return root;
}

export default function Worksheet4MapLibre({
  center = { lat: -2.5, lng: 118 },
  zoom = 4,
  markers = [],
  lines = [],
  polygons = [],
  circles = [],
  height = '520px',
}: Worksheet4MapLibreProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const appliedBasemapRef = useRef<BasemapChoice>('osm');
  const [basemap, setBasemap] = useState<BasemapChoice>('osm');
  const desiredBasemapRef = useRef<BasemapChoice>(basemap);
  const [airportsVisible, setAirportsVisible] = useState(true);
  const [styleReady, setStyleReady] = useState(0);
  const [graticuleVisible, setGraticuleVisible] = useState(true);
  const [mefVisible, setMefVisible] = useState(false);
  const [mefGridSize, setMefGridSize] = useState<MefGridSize>('1deg');
  const [mefData, setMefData] = useState<FeatureCollection<Geometry, GeoJsonProperties> | null>(null);
  const [mefStatus, setMefStatus] = useState('');
  const [scanVisible, setScanVisible] = useState(false);
  const [scanOpacity, setScanOpacity] = useState(0.55);
  const [hideAll, setHideAll] = useState(false);
  const mefVisibleRef = useRef(mefVisible);
  const [cursor, setCursor] = useState('');
  const [tileError, setTileError] = useState('');

  useEffect(() => {
    desiredBasemapRef.current = basemap;
  }, [basemap]);

  useEffect(() => {
    mefVisibleRef.current = mefVisible;
  }, [mefVisible]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'h' || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches('input, textarea, select, button'))) return;
      event.preventDefault();
      setHideAll((current) => !current);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: rasterStyle(basemap),
      center: [center.lng, center.lat],
      zoom,
      attributionControl: false,
      cooperativeGestures: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 140, unit: 'nautical' }), 'bottom-left');
    map.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-right');
    let gridTimer: ReturnType<typeof setTimeout> | undefined;
    const updateGraticule = () => {
      if (gridTimer) clearTimeout(gridTimer);
      gridTimer = setTimeout(() => {
        const source = map.getSource(GRATICULE_SOURCE_ID);
        if (!source || source.type !== 'geojson' || !map.isStyleLoaded()) return;
        const bounds = map.getBounds();
        (source as maplibregl.GeoJSONSource).setData(buildOncGraticule({
          west: bounds.getWest(), east: bounds.getEast(), south: bounds.getSouth(), north: bounds.getNorth(),
        }, containerRef.current?.clientWidth ?? 0, containerRef.current?.clientHeight ?? 0, map.getZoom()));
      }, 120);
    };
    map.on('style.load', () => {
      addScanLayer(map, scanVisible, scanOpacity);
      addGraticuleLayers(map, graticuleVisible);
      addMefLayers(map, mefVisible);
      addAirportLayers(map, airportsVisible);
      setStyleReady((current) => current + 1);
      updateGraticule();
    });
    map.on('load', updateGraticule);
    map.on('moveend', updateGraticule);
    map.on('zoomend', updateGraticule);
    map.on('resize', updateGraticule);
    map.on('mousemove', (event) => {
      setCursor(`${event.lngLat.lat.toFixed(5)}, ${event.lngLat.lng.toFixed(5)} · ${toDDM(event.lngLat.lat, 'lat')}, ${toDDM(event.lngLat.lng, 'lng')}`);
    });
    map.on('mouseout', () => setCursor(''));
    map.on('error', (event) => {
      const detail = event as unknown as { sourceId?: string; error?: Error; url?: string; request?: { url?: string } };
      const message = [detail.error?.message, detail.url, detail.request?.url].filter(Boolean).join(' ');
      // Glyph/font failures can carry the airport source id too; only report actual proxy tile failures.
      if (!message.includes('/api/tiles/openaip/')) return;
      setTileError(/429|rate/i.test(message)
        ? 'OpenAIP membatasi permintaan tile. Coba lagi beberapa saat.'
        : 'Layer bandara OpenAIP gagal dimuat. Periksa konfigurasi OPENAIP_API_KEY dan koneksi.');
    });
    map.on('click', (event) => {
      if (mefVisibleRef.current && map.getLayer('worksheet4-mef-labels')) {
        const mefFeature = map.queryRenderedFeatures(event.point, { layers: ['worksheet4-mef-labels'] })[0];
        if (mefFeature) {
          new maplibregl.Popup({ closeButton: true, maxWidth: '340px' })
            .setLngLat(event.lngLat)
            .setDOMContent(mefDescription((mefFeature.properties ?? {}) as Record<string, unknown>))
            .addTo(map);
          return;
        }
      }
      if (!map.getLayer(AIRPORT_LAYER_ID)) return;
      const feature = map.queryRenderedFeatures(event.point, { layers: [AIRPORT_LAYER_ID] })[0];
      if (!feature) return;
      const coordinates = event.lngLat;
      const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' })
        .setLngLat(coordinates)
        .setDOMContent(airportDescription((feature.properties ?? {}) as Record<string, unknown>, coordinates))
        .addTo(map);
    });
    map.on('mousemove', (event) => {
      const airport = Boolean(map.getLayer(AIRPORT_LAYER_ID)
        && map.queryRenderedFeatures(event.point, { layers: [AIRPORT_LAYER_ID] }).length > 0);
      map.getCanvas().style.cursor = airport ? 'pointer' : '';
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    return () => {
      if (gridTimer) clearTimeout(gridTimer);
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map instance is created once; updated map settings use dedicated effects below.
  }, []);

  useEffect(() => {
    if (!mefVisible) return;
    const controller = new AbortController();
    const fileName = `/data/mef_${GRID_ARCMIN[mefGridSize]}min.geojson`;
    console.info(`[Worksheet 4 MEF] Meminta dataset: ${fileName}`);
    fetch(fileName, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const error = new Error(`HTTP ${response.status} untuk ${fileName}`);
          Object.assign(error, { status: response.status });
          throw error;
        }
        return response.json() as Promise<MefDocument>;
      })
      .then((document) => {
        if (document.type !== 'FeatureCollection' || !Array.isArray(document.features)) throw new Error(`Format GeoJSON tidak valid: ${fileName}`);
        const collection = normalizeMefDocument(document, mefGridSize);
        setMefData(collection);
        setMefStatus(collection.features.length
          ? `${collection.features.length.toLocaleString('id-ID')} sel MEF dimuat dari ${fileName}.`
          : `File ${fileName} tersedia, tetapi belum berisi sel daratan.`);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMefData(null);
        const detail = error instanceof Error ? error.message : 'kesalahan tidak diketahui';
        const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
        setMefStatus(status === 404
          ? `Dataset MEF belum tersedia: ${fileName}. Buat dengan: python build_mef.py --bbox 117 -4 120 0 --out public/data`
          : `Gagal memuat ${fileName}: ${detail}`);
      });
    return () => controller.abort();
  }, [mefGridSize, mefVisible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !map.isStyleLoaded()) return;
    const source = map.getSource(MEF_SOURCE_ID);
    if (source?.type === 'geojson') (source as maplibregl.GeoJSONSource).setData(mefData ?? EMPTY_GEOJSON);
  }, [mefData, styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !map.isStyleLoaded()) return;
    for (const layerId of GRATICULE_LAYER_IDS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', graticuleVisible ? 'visible' : 'none');
    }
    for (const layerId of MEF_LAYER_IDS) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', mefVisible ? 'visible' : 'none');
    }
    if (map.getLayer(SCAN_LAYER_ID)) {
      map.setLayoutProperty(SCAN_LAYER_ID, 'visibility', scanVisible ? 'visible' : 'none');
      map.setPaintProperty(SCAN_LAYER_ID, 'raster-opacity', scanOpacity);
    }
    for (const layerId of [AIRPORT_LAYER_ID, AIRPORT_LABEL_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', airportsVisible ? 'visible' : 'none');
    }
    const minZoom = mefGridSize === '1deg' ? 2 : mefGridSize === '30min' ? 4 : 6;
    if (map.getLayer('worksheet4-mef-labels')) map.setLayerZoomRange('worksheet4-mef-labels', minZoom, 24);
  }, [airportsVisible, graticuleVisible, mefGridSize, mefVisible, scanOpacity, scanVisible, styleReady]);

  useEffect(() => {
    const map = mapRef.current;
    // The initial map already uses OSM. Calling setStyle on the first render
    // races the initial style load and makes MapLibre rebuild the style.
    if (!map || appliedBasemapRef.current === basemap) return;

    const applyBasemap = () => {
      const desiredBasemap = desiredBasemapRef.current;
      if (appliedBasemapRef.current === desiredBasemap) return;
      appliedBasemapRef.current = desiredBasemap;
      map.setStyle(rasterStyle(desiredBasemap));
    };

    if (map.isStyleLoaded()) applyBasemap();
    else map.once('load', applyBasemap);
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const applyCamera = () => {
      if (mapRef.current === map && map.isStyleLoaded()) {
        map.easeTo({ center: [center.lng, center.lat], zoom, duration: 350 });
      }
    };
    if (map.isStyleLoaded()) applyCamera();
    else map.once('load', applyCamera);
    return () => {
      map.off('load', applyCamera);
    };
  }, [center.lat, center.lng, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady || !map.isStyleLoaded()) return;
    const collection = overlaysToGeoJSON(markers, lines, polygons, circles);
    if (map.getLayer('worksheet4-fill')) map.removeLayer('worksheet4-fill');
    if (map.getLayer('worksheet4-outline')) map.removeLayer('worksheet4-outline');
    if (map.getLayer('worksheet4-lines')) map.removeLayer('worksheet4-lines');
    if (map.getLayer('worksheet4-points')) map.removeLayer('worksheet4-points');
    if (map.getLayer('worksheet4-labels')) map.removeLayer('worksheet4-labels');
    if (map.getSource(OVERLAY_SOURCE_ID)) map.removeSource(OVERLAY_SOURCE_ID);
    map.addSource(OVERLAY_SOURCE_ID, { type: 'geojson', data: collection as FeatureCollection<Geometry, GeoJsonProperties> });
    map.addLayer({ id: 'worksheet4-fill', type: 'fill', source: OVERLAY_SOURCE_ID, filter: ['==', ['get', 'kind'], 'polygon'], paint: { 'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'] } });
    map.addLayer({ id: 'worksheet4-outline', type: 'line', source: OVERLAY_SOURCE_ID, filter: ['==', ['get', 'kind'], 'polygon'], paint: { 'line-color': ['get', 'color'], 'line-width': 2 } });
    map.addLayer({ id: 'worksheet4-lines', type: 'line', source: OVERLAY_SOURCE_ID, filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': ['get', 'color'], 'line-width': 2.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'worksheet4-points', type: 'circle', source: OVERLAY_SOURCE_ID, filter: ['==', ['get', 'kind'], 'marker'], paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'worksheet4-labels', type: 'symbol', source: OVERLAY_SOURCE_ID, filter: ['any', ['all', ['==', ['get', 'kind'], 'marker'], ['==', ['get', 'showLabel'], true]], ['==', ['get', 'kind'], 'circle-label']], layout: { 'text-field': ['coalesce', ['get', 'label'], ''], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': false }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
    addAirportLayers(map, airportsVisible);
  }, [styleReady, markers, lines, polygons, circles, airportsVisible]);

  return (
    <div className={`w-full ${hideAll ? 'worksheet4-map-hide-all' : ''}`}>
    <div className="relative overflow-hidden rounded-md border border-slate-300" style={{ height, width: '100%' }}>
      <div ref={containerRef} className="h-full w-full" style={{ height: '100%', width: '100%' }} role="application" aria-label="Peta Worksheet 4 dengan overlay graticule ONC dan MEF turunan DEM" />
      <div className={`worksheet4-overlay-panel absolute left-2 top-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded bg-white/95 p-1.5 shadow transition-opacity duration-200 ${hideAll ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
        <label className="sr-only" htmlFor="worksheet4-basemap">Basemap</label>
        <select id="worksheet4-basemap" value={basemap} onChange={(event) => setBasemap(event.target.value as BasemapChoice)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
          <option value="osm">OpenStreetMap</option>
          <option value="opentopomap">OpenTopoMap</option>
        </select>
        <label className="flex items-center gap-1 px-1 text-xs text-slate-800">
          <input type="checkbox" checked={airportsVisible} onChange={(event) => setAirportsVisible(event.target.checked)} />
          Bandara OpenAIP
        </label>
        <label className="flex items-center gap-1 px-1 text-xs text-slate-800">
          <input type="checkbox" checked={graticuleVisible} onChange={(event) => setGraticuleVisible(event.target.checked)} />
          Graticule ONC
        </label>
        <label className="flex items-center gap-1 px-1 text-xs text-slate-800">
          <input type="checkbox" checked={mefVisible} onChange={(event) => { setMefVisible(event.target.checked); setMefStatus(''); }} />
          MEF DEM
        </label>
        <label className="sr-only" htmlFor="worksheet4-mef-grid">Ukuran kotak MEF</label>
        <select id="worksheet4-mef-grid" value={mefGridSize} onChange={(event) => { setMefData(null); setMefStatus(''); setMefGridSize(event.target.value as MefGridSize); }} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs" disabled={!mefVisible}>
          <option value="1deg">MEF 1°</option>
          <option value="30min">MEF 30′</option>
          <option value="15min">MEF 15′</option>
        </select>
        {ONC_SCAN_TILE_URL ? <>
          <label className="flex items-center gap-1 px-1 text-xs text-slate-800">
            <input type="checkbox" checked={scanVisible} onChange={(event) => setScanVisible(event.target.checked)} />
            Scan ONC
          </label>
          <label className="flex items-center gap-1 px-1 text-[10px] text-slate-700" title="Transparansi scan ONC">
            Opasitas <input aria-label="Transparansi scan ONC" type="range" min="0" max="1" step="0.05" value={scanOpacity} onChange={(event) => setScanOpacity(Number(event.target.value))} className="w-16" />
          </label>
        </> : null}
      </div>
      <div className={`worksheet4-overlay-panel pointer-events-none absolute bottom-8 right-2 z-10 rounded border border-slate-400 bg-white/95 px-2 py-1 text-right font-mono text-[9px] leading-tight text-slate-900 shadow transition-opacity duration-200 ${hideAll ? 'opacity-0' : 'opacity-100'}`}>
        <div className="font-bold">ONC 1:1.000.000</div>
        <div>1 cm = 10 km · rasio cetak</div>
      </div>
      {cursor && !hideAll && <div className="absolute left-2 bottom-11 z-10 max-w-[calc(100%-1rem)] rounded bg-white/95 px-2 py-1 font-mono text-[10px] text-slate-800 shadow" aria-live="polite">{cursor}</div>}
      {tileError && !hideAll && <div role="status" className="absolute right-2 top-14 z-10 max-w-xs rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 shadow">{tileError}</div>}
      <button
        type="button"
        onClick={() => setHideAll((current) => !current)}
        aria-pressed={hideAll}
        aria-label={hideAll ? 'Tampilkan semua panel peta' : 'Sembunyikan semua panel peta'}
        title={`${hideAll ? 'Tampilkan' : 'Sembunyikan'} semua panel (H)`}
        className={`absolute right-2 z-20 flex h-9 w-9 items-center justify-center rounded-md border border-slate-400 bg-white/95 text-slate-800 shadow transition-all duration-200 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${hideAll ? 'top-2' : 'top-[100px]'}`}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          {hideAll ? <><path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></> : <><path d="M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6.2 0 9.5 6 9.5 6a15 15 0 0 1-3.1 3.6M6.2 6.3C3.8 7.9 2.5 12 2.5 12s3.3 6 9.5 6a9.7 9.7 0 0 0 3-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></>}
        </svg>
      </button>
    </div>
    {mefVisible && !hideAll && <div role="status" className="mt-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700">{mefStatus || 'Memuat data MEF…'} {mefStatus && <span className="font-medium text-amber-900">{MEF_WARNING}</span>}</div>}
    {!hideAll && <p className="mt-1 text-[10px] leading-snug text-amber-800">{MEF_WARNING}</p>}
    <style jsx global>{`
      .worksheet4-map-hide-all .maplibregl-ctrl-top-right,
      .worksheet4-map-hide-all .maplibregl-ctrl-bottom-left {
        opacity: 0;
        pointer-events: none;
        transition: opacity 180ms ease;
      }
      .maplibregl-ctrl-top-right,
      .maplibregl-ctrl-bottom-left {
        transition: opacity 180ms ease;
      }
      .maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib {
        max-width: min(72vw, 520px);
        padding: 2px 5px;
        background: rgba(255, 255, 255, .88);
        font-size: 9px;
        line-height: 1.2;
      }
    `}</style>
    </div>
  );
}
