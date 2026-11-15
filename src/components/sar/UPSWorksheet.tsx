'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  type LatLng,
  project,
  distanceNm,
  normalizeAngle,
  dirToCompass,
} from '@/lib/sar/sarCalculations';

/**
 * Universal Plotting Sheet (UPS) — digital version.
 *
 * Features:
 *   - Selectable scale (60', 30', 12', 6', 3' — each divisible by 6)
 *   - Plot points by lat/lon coordinates
 *   - Plot points by bearing + distance from a reference
 *   - Measure distance and bearing between two points
 *   - Visual SVG with lat/lon grid lines
 */

interface UpsPoint {
  id: string;
  pos: LatLng;
  label: string;
  color: string;
}

const COLORS = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6'];
const SCALES = [
  { value: 60, label: "60' (1° = 60 NM)" },
  { value: 30, label: "30' (30 NM)" },
  { value: 12, label: "12' (12 NM)" },
  { value: 6, label: "6' (6 NM)" },
  { value: 3, label: "3' (3 NM)" },
];

export default function UPSWorksheet({
  centerLat = -6,
  centerLng = 107,
}: {
  centerLat?: number;
  centerLng?: number;
}) {
  const [scale, setScale] = useState(60);
  const [center, setCenter] = useState<LatLng>({ lat: centerLat, lng: centerLng });
  const [points, setPoints] = useState<UpsPoint[]>([
    { id: '1', pos: { lat: centerLat, lng: centerLng }, label: 'A', color: COLORS[0] },
  ]);
  const [newLat, setNewLat] = useState(centerLat + 0.1);
  const [newLng, setNewLng] = useState(centerLng + 0.1);
  const [newLabel, setNewLabel] = useState('B');

  // SVG parameters
  const size = 400;
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = size / 2 - 40;
  // 1 degree latitude = 60 NM; scale is in minutes → scale/60 degrees
  const latRange = (scale / 60) * 2; // total lat range visible (±scale from center)
  const lngRange = latRange * Math.cos((center.lat * Math.PI) / 180);

  // Round to 2 decimals to prevent SSR hydration mismatch
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const toX = (lng: number) => r2(cx + ((lng - center.lng) / (lngRange / 2)) * maxRadius);
  const toY = (lat: number) => r2(cy - ((lat - center.lat) / (latRange / 2)) * maxRadius);

  // Distance + bearing between first two points
  const measurement = useMemo(() => {
    if (points.length < 2) return null;
    const dist = distanceNm(points[0].pos, points[1].pos);
    const bearing = bearingFromTo(points[0].pos, points[1].pos);
    return { dist, bearing };
  }, [points]);

  const addPoint = () => {
    const id = String(Date.now());
    const color = COLORS[points.length % COLORS.length];
    setPoints([...points, { id, pos: { lat: newLat, lng: newLng }, label: newLabel || `P${points.length + 1}`, color }]);
    setNewLabel(String.fromCharCode(66 + points.length)); // B, C, D...
  };

  const removePoint = (id: string) => {
    setPoints(points.filter((p) => p.id !== id));
  };

  return (
    <Card className="border-indigo-200 shadow-sm">
      <CardHeader className="bg-indigo-50 pb-3">
        <CardTitle className="text-sm">Universal Plotting Sheet (UPS)</CardTitle>
        <CardDescription className="text-xs">
          Plotting sheet digital dengan skala {scale}' — untuk menentukan koordinat, mengukur jarak dan arah
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* SVG Plotting Sheet */}
          <div className="flex justify-center">
            <svg viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: '400px', width: '100%' }}>
              {/* Outer circle (UPS is circular) */}
              <circle cx={cx} cy={cy} r={maxRadius} fill="#f8fafc" stroke="#475569" strokeWidth="1.5" />

              {/* Latitude lines (horizontal arcs) */}
              {[-0.5, -0.25, 0, 0.25, 0.5].map((f) => {
                const lat = center.lat + f * latRange / 2;
                const y = toY(lat);
                const halfWidth = r2(Math.sqrt(Math.max(0, maxRadius * maxRadius - (y - cy) * (y - cy))));
                return (
                  <line key={`lat-${f}`} x1={r2(cx - halfWidth)} y1={y} x2={r2(cx + halfWidth)} y2={y} stroke="#e2e8f0" strokeWidth="0.5" />
                );
              })}

              {/* Longitude lines (vertical) */}
              {[-0.5, -0.25, 0, 0.25, 0.5].map((f) => {
                const lng = center.lng + f * lngRange / 2;
                const x = toX(lng);
                const halfHeight = r2(Math.sqrt(Math.max(0, maxRadius * maxRadius - (x - cx) * (x - cx))));
                return (
                  <line key={`lng-${f}`} x1={x} y1={r2(cy - halfHeight)} x2={x} y2={r2(cy + halfHeight)} stroke="#e2e8f0" strokeWidth="0.5" />
                );
              })}

              {/* Scale ticks on left edge (latitude scale) */}
              {Array.from({ length: 7 }, (_, i) => {
                const f = -0.5 + i / 6;
                const y = toY(center.lat + f * latRange / 2);
                const tickLat = center.lat + f * latRange / 2;
                return (
                  <g key={`tick-${i}`}>
                    <line x1={cx - maxRadius} y1={y} x2={cx - maxRadius + 5} y2={y} stroke="#475569" strokeWidth="0.5" />
                    <text x={cx - maxRadius - 8} y={y + 3} fontSize="7" fontFamily="monospace" fill="#64748b" textAnchor="end">
                      {tickLat.toFixed(1)}°
                    </text>
                  </g>
                );
              })}

              {/* Points */}
              {points.map((p) => {
                const x = toX(p.pos.lng);
                const y = toY(p.pos.lat);
                return (
                  <g key={p.id}>
                    <circle cx={x} cy={y} r="5" fill={p.color} stroke="#fff" strokeWidth="2" />
                    <text x={x + 8} y={y - 4} fontSize="11" fontFamily="monospace" fill={p.color} fontWeight="bold">
                      {p.label}
                    </text>
                  </g>
                );
              })}

              {/* Line between first two points */}
              {points.length >= 2 && (
                <>
                  <line
                    x1={toX(points[0].pos.lng)}
                    y1={toY(points[0].pos.lat)}
                    x2={toX(points[1].pos.lng)}
                    y2={toY(points[1].pos.lat)}
                    stroke="#475569"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                  {measurement && (
                    <text
                      x={(toX(points[0].pos.lng) + toX(points[1].pos.lng)) / 2}
                      y={(toY(points[0].pos.lat) + toY(points[1].pos.lat)) / 2 - 5}
                      fontSize="9"
                      fontFamily="monospace"
                      fill="#475569"
                      textAnchor="middle"
                    >
                      {measurement.dist.toFixed(1)} NM {measurement.bearing.toFixed(0)}°T
                    </text>
                  )}
                </>
              )}

              {/* Center crosshair */}
              <line x1={cx - 5} y1={cy} x2={cx + 5} y2={cy} stroke="#94a3b8" strokeWidth="0.5" />
              <line x1={cx} y1={cy - 5} x2={cx} y2={cy + 5} stroke="#94a3b8" strokeWidth="0.5" />
            </svg>
          </div>

          {/* Controls */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Skala</Label>
              <Select value={String(scale)} onValueChange={(v) => setScale(parseInt(v))}>
                <SelectTrigger className="mt-1 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCALES.map((s) => (
                    <SelectItem key={s.value} value={String(s.value)}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px]">Center Latitude (°)</Label>
                <Input type="number" step="0.1" value={center.lat} onChange={(e) => setCenter({ ...center, lat: parseFloat(e.target.value) || 0 })} className="h-7 text-xs" />
              </div>
              <div>
                <Label className="text-[10px]">Center Longitude (°)</Label>
                <Input type="number" step="0.1" value={center.lng} onChange={(e) => setCenter({ ...center, lng: parseFloat(e.target.value) || 0 })} className="h-7 text-xs" />
              </div>
            </div>

            {/* Existing points */}
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Points</div>
            {points.map((p) => (
              <div key={p.id} className="flex items-center gap-2 text-xs">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: p.color }} />
                <span className="font-mono font-semibold w-6">{p.label}</span>
                <span className="font-mono text-slate-600 flex-1">
                  {p.pos.lat.toFixed(4)}, {p.pos.lng.toFixed(4)}
                </span>
                <button onClick={() => removePoint(p.id)} className="text-slate-400 hover:text-red-500">✕</button>
              </div>
            ))}

            {/* Add new point */}
            <div className="border-t border-slate-200 pt-2 space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Tambah Titik</div>
              <div className="grid grid-cols-3 gap-1">
                <Input type="number" step="0.0001" value={newLat} onChange={(e) => setNewLat(parseFloat(e.target.value) || 0)} className="h-7 text-xs" placeholder="Lat" />
                <Input type="number" step="0.0001" value={newLng} onChange={(e) => setNewLng(parseFloat(e.target.value) || 0)} className="h-7 text-xs" placeholder="Lng" />
                <Input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} className="h-7 text-xs" placeholder="Label" />
              </div>
              <button onClick={addPoint} className="text-xs text-blue-600 hover:underline">+ Add point</button>
            </div>

            {/* Measurement */}
            {measurement && (
              <div className="p-2 bg-slate-900 text-white rounded-md text-xs">
                <div className="text-[9px] uppercase text-slate-400">A → B</div>
                <div className="font-mono font-bold">
                  {measurement.dist.toFixed(2)} NM · {measurement.bearing.toFixed(1)}°T ({dirToCompass(measurement.bearing)})
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function bearingFromTo(a: LatLng, b: LatLng): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return normalizeAngle((Math.atan2(y, x) * 180) / Math.PI);
}
