'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  type Vector,
  vectorToUV,
  uvToVector,
  addVectors,
  normalizeAngle,
  dirToCompass,
} from '@/lib/sar/sarCalculations';

/**
 * Maneuvering Board — visual vector diagram for averaging wind/current vectors.
 *
 * Displays a polar grid (concentric circles + radial lines) where vectors
 * are plotted as arrows. Used for:
 *   - AWA: averaging wind vectors at different altitudes
 *   - ASW: averaging surface wind vectors over time
 *   - Drift: combining TWC + Leeway vectors
 *
 * The user can add/remove vectors, and the resultant (average) is computed
 * and displayed as a bold arrow.
 */

interface BoardVector {
  id: string;
  dir: number; // degrees True (toward)
  mag: number; // magnitude (kts or kft×kts for AWA)
  label: string;
  color: string;
}

const COLORS = ['#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#8b5cf6', '#06b6d4'];

export default function ManeuveringBoard({
  title = 'Maneuvering Board',
  description = 'Visual vector diagram for averaging wind/current vectors',
  vectors: externalVectors,
  onVectorsChange,
}: {
  title?: string;
  description?: string;
  vectors?: BoardVector[];
  onVectorsChange?: (v: BoardVector[]) => void;
}) {
  const [internalVectors, setInternalVectors] = useState<BoardVector[]>([
    { id: '1', dir: 225, mag: 30, label: 'V1', color: COLORS[0] },
    { id: '2', dir: 230, mag: 36, label: 'V2', color: COLORS[1] },
  ]);
  const vectors = externalVectors ?? internalVectors;
  const setVectors = onVectorsChange ?? setInternalVectors;

  // Compute resultant vector
  const resultant = useMemo(() => {
    if (vectors.length === 0) return null;
    const uvVectors = vectors.map((v) => vectorToUV({ dir: v.dir, mag: v.mag }));
    let u = 0, vComp = 0;
    for (const uv of uvVectors) { u += uv.u; vComp += uv.v; }
    return uvToVector(u, vComp);
  }, [vectors]);

  const addVector = () => {
    const id = String(Date.now());
    const color = COLORS[vectors.length % COLORS.length];
    setVectors([...vectors, { id, dir: 0, mag: 10, label: `V${vectors.length + 1}`, color }]);
  };

  const updateVector = (id: string, field: 'dir' | 'mag' | 'label', value: number | string) => {
    setVectors(vectors.map((v) => (v.id === id ? { ...v, [field]: value } : v)));
  };

  const removeVector = (id: string) => {
    setVectors(vectors.filter((v) => v.id !== id));
  };

  // SVG dimensions
  const size = 320;
  const center = size / 2;
  const maxRadius = size / 2 - 30;
  const maxMag = Math.max(...vectors.map((v) => v.mag), 10);

  // Scale factor
  const scale = maxRadius / (maxMag * 1.2);

  // Convert direction+mag to SVG coordinates
  // Round to 2 decimals to prevent SSR hydration mismatch (floating-point
  // precision differs between server and client V8 engines).
  const r2 = (n: number) => Math.round(n * 100) / 100;

  const toXY = (dir: number, mag: number) => {
    const rad = (dir * Math.PI) / 180;
    return {
      x: r2(center + mag * scale * Math.sin(rad)),
      y: r2(center - mag * scale * Math.cos(rad)),
    };
  };

  // Build SVG grid
  const circles = [0.25, 0.5, 0.75, 1.0].map((f) => (
    <circle key={f} cx={center} cy={center} r={r2(maxRadius * f)} fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
  ));
  const radials: React.ReactNode[] = [];
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg * Math.PI) / 180;
    const x2 = r2(center + maxRadius * Math.sin(rad));
    const y2 = r2(center - maxRadius * Math.cos(rad));
    radials.push(
      <line
        key={deg}
        x1={center}
        y1={center}
        x2={x2}
        y2={y2}
        stroke="#f1f5f9"
        strokeWidth="0.5"
      />,
    );
    // Direction labels
    const labelR = maxRadius + 12;
    radials.push(
      <text
        key={`label-${deg}`}
        x={r2(center + labelR * Math.sin(rad))}
        y={r2(center - labelR * Math.cos(rad) + 3)}
        fontSize="8"
        fontFamily="monospace"
        fill="#94a3b8"
        textAnchor="middle"
      >
        {deg}
      </text>,
    );
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 pb-3">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* SVG diagram */}
          <div className="flex justify-center">
            <svg viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: '320px', width: '100%' }}>
              {/* Grid */}
              {circles}
              {radials}
              {/* Center point */}
              <circle cx={center} cy={center} r="3" fill="#475569" />

              {/* Individual vectors */}
              {vectors.map((v) => {
                const end = toXY(v.dir, v.mag);
                return (
                  <g key={v.id}>
                    <line
                      x1={center}
                      y1={center}
                      x2={end.x}
                      y2={end.y}
                      stroke={v.color}
                      strokeWidth="2"
                      markerEnd="url(#arrow)"
                    />
                    <text
                      x={end.x + 4}
                      y={end.y - 4}
                      fontSize="9"
                      fontFamily="monospace"
                      fill={v.color}
                      fontWeight="bold"
                    >
                      {v.label}
                    </text>
                  </g>
                );
              })}

              {/* Resultant vector */}
              {resultant && (
                <g>
                  <line
                    x1={center}
                    y1={center}
                    x2={toXY(resultant.dir, resultant.mag).x}
                    y2={toXY(resultant.dir, resultant.mag).y}
                    stroke="#0f172a"
                    strokeWidth="3"
                    markerEnd="url(#arrow-bold)"
                  />
                  <text
                    x={toXY(resultant.dir, resultant.mag).x + 4}
                    y={toXY(resultant.dir, resultant.mag).y + 12}
                    fontSize="10"
                    fontFamily="monospace"
                    fill="#0f172a"
                    fontWeight="bold"
                  >
                    R: {resultant.dir.toFixed(1)}°T / {resultant.mag.toFixed(1)}
                  </text>
                </g>
              )}

              {/* Arrow markers */}
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="currentColor" />
                </marker>
                <marker id="arrow-bold" markerWidth="10" markerHeight="10" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L7,4 L0,8 Z" fill="#0f172a" />
                </marker>
              </defs>
            </svg>
          </div>

          {/* Vector table */}
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">Vectors</div>
            {vectors.map((v) => (
              <div key={v.id} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: v.color }} />
                <input
                  type="text"
                  value={v.label}
                  onChange={(e) => updateVector(v.id, 'label', e.target.value)}
                  className="w-12 h-7 text-xs px-1 rounded border border-slate-200"
                />
                <input
                  type="number"
                  value={v.dir}
                  onChange={(e) => updateVector(v.id, 'dir', parseFloat(e.target.value) || 0)}
                  className="w-16 h-7 text-xs px-1 rounded border border-slate-200"
                  placeholder="dir"
                />
                <span className="text-[10px] text-slate-400">°T</span>
                <input
                  type="number"
                  value={v.mag}
                  onChange={(e) => updateVector(v.id, 'mag', parseFloat(e.target.value) || 0)}
                  className="w-16 h-7 text-xs px-1 rounded border border-slate-200"
                  placeholder="mag"
                />
                <button
                  onClick={() => removeVector(v.id)}
                  className="text-slate-400 hover:text-red-500 text-xs px-1"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={addVector}
              className="text-xs text-blue-600 hover:underline"
            >
              + Add vector
            </button>

            {/* Resultant display */}
            {resultant && (
              <div className="mt-3 p-3 bg-slate-900 text-white rounded-md">
                <div className="text-[10px] uppercase text-slate-400">Resultant (R)</div>
                <div className="text-lg font-mono font-bold">
                  {resultant.dir.toFixed(1)}°T ({dirToCompass(resultant.dir)}) / {resultant.mag.toFixed(1)}
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
