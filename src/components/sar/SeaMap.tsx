'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type LatLng } from '@/lib/sar/sarCalculations';

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
}

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

export default function SeaMap({
  center,
  zoom = 8,
  markers = [],
  lines = [],
  polygons = [],
  circles = [],
  height = '500px',
  onMapClick,
}: SeaMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      scrollWheelZoom: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      attribution: '© OpenSeaMap',
      maxZoom: 19,
      tileSize: 256,
    }).addTo(map);

    if (onMapClick) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
    }

    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setView([center.lat, center.lng], zoom);
  }, [center.lat, center.lng, zoom]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const layer = L.layerGroup().addTo(map);

    markers.forEach((m) => {
      const color = m.color ?? '#ef4444';
      const marker = L.marker([m.position.lat, m.position.lng], {
        icon: makeColoredIcon(color, m.isStart, m.isDatum),
      }).addTo(layer);
      marker.bindPopup(
        `<b>${m.label}</b><br/>${m.position.lat.toFixed(4)}, ${m.position.lng.toFixed(4)}`,
      );
    });

    return () => {
      map.removeLayer(layer);
    };
  }, [markers]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const layer = L.layerGroup().addTo(map);

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

    return () => {
      map.removeLayer(layer);
    };
  }, [lines]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const layer = L.layerGroup().addTo(map);

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

    return () => {
      map.removeLayer(layer);
    };
  }, [polygons]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const layer = L.layerGroup().addTo(map);

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

    return () => {
      map.removeLayer(layer);
    };
  }, [circles]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: '100%', borderRadius: '0.5rem', overflow: 'hidden' }}
      role="application"
      aria-label="Interactive sea map showing search and rescue datum and search areas"
    />
  );
}
