'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import { setWorkerUrl } from 'maplibre-gl';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { project, type LatLng } from '@/lib/sar/sarCalculations';
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
  const [basemap, setBasemap] = useState<BasemapChoice>('osm');
  const [airportsVisible, setAirportsVisible] = useState(true);
  const [styleReady, setStyleReady] = useState(0);
  const [cursor, setCursor] = useState('');
  const [tileError, setTileError] = useState('');

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
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.on('style.load', () => {
      addAirportLayers(map, airportsVisible);
      setStyleReady((current) => current + 1);
    });
    map.on('mousemove', (event) => {
      setCursor(`${event.lngLat.lat.toFixed(5)}, ${event.lngLat.lng.toFixed(5)} · ${toDDM(event.lngLat.lat, 'lat')}, ${toDDM(event.lngLat.lng, 'lng')}`);
    });
    map.on('mouseout', () => setCursor(''));
    map.on('error', (event) => {
      const detail = event as unknown as { sourceId?: string; error?: Error; url?: string; request?: { url?: string } };
      const message = [detail.error?.message, detail.url, detail.request?.url].filter(Boolean).join(' ');
      if (detail.sourceId !== AIRPORT_SOURCE_ID && !message.includes('/api/tiles/openaip/')) return;
      setTileError(/429|rate/i.test(message)
        ? 'OpenAIP membatasi permintaan tile. Coba lagi beberapa saat.'
        : 'Layer bandara OpenAIP gagal dimuat. Periksa konfigurasi OPENAIP_API_KEY dan koneksi.');
    });
    map.on('click', (event) => {
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
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // The map instance is created once; updated map settings use dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(rasterStyle(basemap));
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) map.easeTo({ center: [center.lng, center.lat], zoom, duration: 350 });
  }, [center.lat, center.lng, zoom]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleReady) return;
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const layerId of [AIRPORT_LAYER_ID, AIRPORT_LABEL_ID]) {
      if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', airportsVisible ? 'visible' : 'none');
    }
  }, [airportsVisible, styleReady]);

  return (
    <div className="relative overflow-hidden rounded-md border border-slate-300" style={{ height, width: '100%' }}>
      <div ref={containerRef} className="absolute inset-0" role="application" aria-label="Peta Worksheet 4 dengan layer bandara OpenAIP" />
      <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-1 rounded bg-white/95 p-1.5 shadow">
        <label className="sr-only" htmlFor="worksheet4-basemap">Basemap</label>
        <select id="worksheet4-basemap" value={basemap} onChange={(event) => setBasemap(event.target.value as BasemapChoice)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs">
          <option value="osm">OpenStreetMap</option>
          <option value="opentopomap">OpenTopoMap</option>
        </select>
        <label className="flex items-center gap-1 px-1 text-xs text-slate-800">
          <input type="checkbox" checked={airportsVisible} onChange={(event) => setAirportsVisible(event.target.checked)} />
          Bandara OpenAIP
        </label>
      </div>
      {cursor && <div className="absolute left-2 bottom-11 z-10 max-w-[calc(100%-1rem)] rounded bg-white/95 px-2 py-1 font-mono text-[10px] text-slate-800 shadow" aria-live="polite">{cursor}</div>}
      {tileError && <div role="status" className="absolute right-2 top-14 z-10 max-w-xs rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 shadow">{tileError}</div>}
    </div>
  );
}
