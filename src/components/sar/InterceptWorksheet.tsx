'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type LatLng,
  type Vector,
  project,
  distanceNm,
  dirToCompass,
  normalizeAngle,
} from '@/lib/sar/sarCalculations';
import { calculateIntercept, type InterceptType, type InterceptResult } from '@/lib/sar/interceptCalculations';

export default function InterceptWorksheet() {
  const [type, setType] = useState<InterceptType>('head-on');
  const [targetLat, setTargetLat] = useState(-4.75);
  const [targetLng, setTargetLng] = useState(123.75);
  const [targetSpeed, setTargetSpeed] = useState(16);
  const [targetHeading, setTargetHeading] = useState(27);
  const [sruLat, setSruLat] = useState(-5.4);
  const [sruLng, setSruLng] = useState(123.5583);
  const [sruSpeed, setSruSpeed] = useState(30);
  const [timeLabel, setTimeLabel] = useState('09:00');

  const result = useMemo<InterceptResult | null>(() => {
    try {
      return calculateIntercept({
        targetPos: { lat: targetLat, lng: targetLng },
        targetSpeed,
        targetHeading,
        sruPos: { lat: sruLat, lng: sruLng },
        sruSpeed,
        type,
        timeLabel,
      });
    } catch {
      return null;
    }
  }, [targetLat, targetLng, targetSpeed, targetHeading, sruLat, sruLng, sruSpeed, type, timeLabel]);

  // Build SVG diagram
  const diagram = useMemo(() => {
    if (!result) return null;
    return buildInterceptDiagram(result, { lat: targetLat, lng: targetLng }, { lat: sruLat, lng: sruLng }, type);
  }, [result, targetLat, targetLng, sruLat, sruLng, type]);

  return (
    <div className="space-y-4">
      <Card className="border-blue-200 shadow-sm">
        <CardHeader className="bg-blue-50 pb-3">
          <CardTitle className="text-base">Intercept Calculation</CardTitle>
          <CardDescription className="text-xs">
            Hitung titik intercept untuk 3 metode: Head-On, Overtaking, dan Beam-On (Crossing)
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {/* Intercept type */}
          <div>
            <Label className="text-xs">Jenis Intercept</Label>
            <Select value={type} onValueChange={(v) => setType(v as InterceptType)}>
              <SelectTrigger className="mt-1 h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="head-on">Head-On (target menuju SRU)</SelectItem>
                <SelectItem value="overtaking">Overtaking (SRU mengejar target)</SelectItem>
                <SelectItem value="beam-on">Beam-On / Crossing (target menyilang)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Target inputs */}
            <Card className="border-slate-200">
              <CardHeader className="bg-slate-50 pb-2">
                <CardTitle className="text-sm">Target (A) — Kapal Distress</CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px]">Latitude (°)</Label>
                    <Input type="number" step="0.0001" value={targetLat} onChange={(e) => setTargetLat(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-[10px]">Longitude (°)</Label>
                    <Input type="number" step="0.0001" value={targetLng} onChange={(e) => setTargetLng(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px]">Kecepatan (kts)</Label>
                  <Input type="number" step="0.1" value={targetSpeed} onChange={(e) => setTargetSpeed(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                </div>
                {type === 'beam-on' && (
                  <div>
                    <Label className="text-[10px]">Heading (°T)</Label>
                    <Input type="number" step="1" value={targetHeading} onChange={(e) => setTargetHeading(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* SRU inputs */}
            <Card className="border-slate-200">
              <CardHeader className="bg-slate-50 pb-2">
                <CardTitle className="text-sm">SRU (B) — Kapal Penolong</CardTitle>
              </CardHeader>
              <CardContent className="pt-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px]">Latitude (°)</Label>
                    <Input type="number" step="0.0001" value={sruLat} onChange={(e) => setSruLat(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-[10px]">Longitude (°)</Label>
                    <Input type="number" step="0.0001" value={sruLng} onChange={(e) => setSruLng(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                  </div>
                </div>
                <div>
                  <Label className="text-[10px]">Kecepatan (kts)</Label>
                  <Input type="number" step="0.1" value={sruSpeed} onChange={(e) => setSruSpeed(parseFloat(e.target.value) || 0)} className="h-8 text-xs" />
                </div>
                <div>
                  <Label className="text-[10px]">Waktu mulai (HH:MM)</Label>
                  <Input type="text" value={timeLabel} onChange={(e) => setTimeLabel(e.target.value)} className="h-8 text-xs" placeholder="09:00" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Results */}
          {result && (
            <Card className="border-emerald-200 bg-emerald-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-emerald-800">Hasil Intercept</CardTitle>
              </CardHeader>
              <CardContent className="pt-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Titik Intercept (I)" value={`${result.interceptPoint.lat.toFixed(4)}, ${result.interceptPoint.lng.toFixed(4)}`} accent />
                <Stat label="Waktu Intercept" value={result.interceptTimeLabel} accent />
                <Stat label="Jarak Target → I" value={`${result.targetDistance.toFixed(2)} NM`} />
                <Stat label="Jarak SRU → I" value={`${result.sruDistance.toFixed(2)} NM`} />
                <Stat label="Waktu tempuh" value={`${result.timeToIntercept.toFixed(2)} jam`} />
                <Stat label="Bearing A→B" value={`${result.bearingTargetToSru.toFixed(1)}°T`} />
                <Stat label="½ jam kec Target" value={`${result.targetHalfHourDist.toFixed(1)} NM`} />
                <Stat label="½ jam kec SRU" value={`${result.sruHalfHourDist.toFixed(1)} NM`} />
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>

      {/* Visual diagram */}
      {diagram && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="bg-slate-50 pb-3">
            <CardTitle className="text-sm">Diagram Vektor Intercept</CardTitle>
            <CardDescription className="text-xs">
              Visualisasi metode {type} — titik A (target), B (SRU), C/D (vektor ½ jam), I (intercept)
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <svg viewBox={diagram.viewBox} className="w-full" style={{ maxWidth: '600px', margin: '0 auto', display: 'block' }}>
                {diagram.elements}
              </svg>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`p-2.5 rounded-md border ${accent ? 'bg-emerald-100 border-emerald-300' : 'bg-white border-slate-200'}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className={`text-xs font-mono font-semibold ${accent ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

// ============================================================================
// SVG Diagram builder
// ============================================================================

function buildInterceptDiagram(
  result: InterceptResult,
  A: LatLng,
  B: LatLng,
  type: InterceptType,
): { viewBox: string; elements: React.ReactNode[] } {
  // Collect all points
  const points: Array<{ pos: LatLng; label: string; color: string }> = [
    { pos: A, label: 'A (Target)', color: '#dc2626' },
    { pos: B, label: 'B (SRU)', color: '#2563eb' },
    { pos: result.pointC, label: 'C', color: '#f59e0b' },
    { pos: result.pointD, label: 'D', color: '#f59e0b' },
    { pos: result.interceptPoint, label: 'I (Intercept)', color: '#16a34a' },
  ];
  if (result.pointX) points.push({ pos: result.pointX, label: 'X', color: '#f59e0b' });
  if (result.pointW) points.push({ pos: result.pointW, label: 'W', color: '#f59e0b' });

  // Calculate bounds
  const lats = points.map((p) => p.pos.lat);
  const lngs = points.map((p) => p.pos.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latRange = Math.max(0.1, maxLat - minLat);
  const lngRange = Math.max(0.1, maxLng - minLng);
  const padLat = latRange * 0.2;
  const padLng = lngRange * 0.2;

  // SVG coordinate system: x = longitude (left→right), y = latitude (bottom→top, inverted)
  const width = 500;
  const height = 400;
  const xScale = (lng: number) =>
    ((lng - minLng + padLng) / (lngRange + 2 * padLng)) * width;
  const yScale = (lat: number) =>
    height - ((lat - minLat + padLat) / (latRange + 2 * padLat)) * height;

  const elements: React.ReactNode[] = [];

  // Line AB
  elements.push(
    <line key="AB" x1={xScale(A.lng)} y1={yScale(A.lat)} x2={xScale(B.lng)} y2={yScale(B.lat)} stroke="#64748b" strokeWidth="1.5" strokeDasharray="4 4" />,
  );

  // Line CD (for head-on/overtaking) or BW (for beam-on)
  if (type !== 'beam-on') {
    elements.push(
      <line key="CD" x1={xScale(result.pointC.lng)} y1={yScale(result.pointC.lat)} x2={xScale(result.pointD.lng)} y2={yScale(result.pointD.lat)} stroke="#f59e0b" strokeWidth="2" />,
    );
    // Vector arrows AC and BD
    elements.push(
      <line key="AC" x1={xScale(A.lng)} y1={yScale(A.lat)} x2={xScale(result.pointC.lng)} y2={yScale(result.pointC.lat)} stroke="#dc2626" strokeWidth="2" markerEnd="url(#arrow-red)" />,
      <line key="BD" x1={xScale(B.lng)} y1={yScale(B.lat)} x2={xScale(result.pointD.lng)} y2={yScale(result.pointD.lat)} stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow-blue)" />,
    );
  } else if (result.pointX && result.pointW) {
    elements.push(
      <line key="AX" x1={xScale(A.lng)} y1={yScale(A.lat)} x2={xScale(result.pointX.lng)} y2={yScale(result.pointX.lat)} stroke="#dc2626" strokeWidth="2" markerEnd="url(#arrow-red)" />,
      <line key="BW" x1={xScale(B.lng)} y1={yScale(B.lat)} x2={xScale(result.pointW.lng)} y2={yScale(result.pointW.lat)} stroke="#2563eb" strokeWidth="2" markerEnd="url(#arrow-blue)" />,
    );
  }

  // Points with labels
  for (const p of points) {
    const x = xScale(p.pos.lng);
    const y = yScale(p.pos.lat);
    elements.push(
      <g key={p.label}>
        <circle cx={x} cy={y} r="5" fill={p.color} stroke="#fff" strokeWidth="2" />
        <text x={x + 8} y={y - 4} fontSize="11" fontFamily="monospace" fill={p.color} fontWeight="bold">
          {p.label}
        </text>
      </g>,
    );
  }

  // Speed annotations
  elements.push(
    <text key="speedA" x={xScale(A.lng) + 8} y={yScale(A.lat) + 14} fontSize="9" fontFamily="monospace" fill="#dc2626">
      {result.targetHalfHourDist.toFixed(1)} NM
    </text>,
    <text key="speedB" x={xScale(B.lng) + 8} y={yScale(B.lat) + 14} fontSize="9" fontFamily="monospace" fill="#2563eb">
      {result.sruHalfHourDist.toFixed(1)} NM
    </text>,
  );

  const viewBox = `0 0 ${width} ${height}`;
  return { viewBox, elements };
}
