'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceLine,
  Area,
  AreaChart,
} from 'recharts';

/**
 * POD vs Coverage Factor (figure N-10).
 * Two curves: ideal (inverse cube law) and normal (random search).
 * Marks the current operating point.
 */
function podIdeal(c: number): number {
  if (c <= 0) return 0;
  // Approximate the upper curve from figure N-10
  return Math.min(0.999, 1 - Math.exp(-c * 1.6));
}
function podNormal(c: number): number {
  if (c <= 0) return 0;
  // Random search approximation
  return Math.min(0.999, 1 - Math.exp(-c));
}

interface PodChartProps {
  currentCoverage: number;
  currentPod: number;
  conditions: 'ideal' | 'normal';
}

export function PodChart({ currentCoverage, currentPod, conditions }: PodChartProps) {
  const data = useMemo(() => {
    const points: Array<{ c: number; ideal: number; normal: number }> = [];
    for (let c = 0; c <= 5; c += 0.1) {
      points.push({
        c: Number(c.toFixed(2)),
        ideal: Number((podIdeal(c) * 100).toFixed(1)),
        normal: Number((podNormal(c) * 100).toFixed(1)),
      });
    }
    return points;
  }, []);

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 pb-3">
        <CardTitle className="text-sm">Figure N-10 — POD vs Coverage Factor</CardTitle>
        <CardDescription className="text-xs">
          Probability of detection as a function of coverage factor C = Z / A. Ideal = inverse cube law (Koopman); Normal = random search approximation.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="c"
              type="number"
              domain={[0, 5]}
              tick={{ fontSize: 10, fill: '#64748b' }}
              label={{ value: 'Coverage Factor C', position: 'bottom', offset: 5, fontSize: 11, fill: '#475569' }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: '#64748b' }}
              label={{ value: 'POD (%)', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#475569' }}
            />
            <Tooltip
              formatter={(v: number) => `${v.toFixed(1)}%`}
              labelFormatter={(l) => `C = ${l}`}
              contentStyle={{ fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line
              type="monotone"
              dataKey="ideal"
              stroke="#10b981"
              strokeWidth={2}
              dot={false}
              name="Ideal (calm, vis > 20NM)"
            />
            <Line
              type="monotone"
              dataKey="normal"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
              strokeDasharray="5 3"
              name="Normal (other)"
            />
            {currentCoverage > 0 && currentCoverage <= 5 && (
              <ReferenceLine x={currentCoverage} stroke="#dc2626" strokeWidth={1.5} label={{ value: `C=${currentCoverage.toFixed(2)}`, fontSize: 10, fill: '#dc2626', position: 'top' }} />
            )}
            {currentCoverage > 0 && currentCoverage <= 5 && currentPod > 0 && (
              <ReferenceDot x={currentCoverage} y={currentPod * 100} r={5} fill="#dc2626" stroke="#fff" strokeWidth={2} />
            )}
          </LineChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-500 mt-2 leading-snug">
          Current operating point: <span className="font-semibold text-slate-700">C = {currentCoverage.toFixed(2)}, POD = {(currentPod * 100).toFixed(2)}%</span>{' '}
          ({conditions} conditions).
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * POSc vs Cumulative Relative Effort (figures N-11, N-12).
 * Shows how cumulative probability of success grows as more search effort is applied.
 */
function poscPoint(Zrc: number): number {
  // Approximate upper bound curve from figure N-11 (point datum)
  // Grows logarithmically with diminishing returns.
  if (Zrc <= 0) return 0;
  return Math.min(0.99, 1 - Math.exp(-Zrc * 0.18));
}
function poscLine(Zrc: number): number {
  // Approximate upper bound curve from figure N-12 (line datum)
  if (Zrc <= 0) return 0;
  return Math.min(0.99, 1 - Math.exp(-Zrc * 0.15));
}

interface PoscChartProps {
  currentZrc: number;
  datumType: 'point' | 'line' | 'leeway-divergence';
}

export function PoscChart({ currentZrc, datumType }: PoscChartProps) {
  const data = useMemo(() => {
    const points: Array<{ zrc: number; point: number; line: number }> = [];
    for (let z = 0; z <= 50; z += 0.5) {
      points.push({
        zrc: Number(z.toFixed(2)),
        point: Number((poscPoint(z) * 100).toFixed(1)),
        line: Number((poscLine(z) * 100).toFixed(1)),
      });
    }
    return points;
  }, []);

  const activeLine = datumType === 'line' ? 'line' : 'point';

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 pb-3">
        <CardTitle className="text-sm">Figures N-11 / N-12 — POSc vs Cumulative Relative Effort</CardTitle>
        <CardDescription className="text-xs">
          Cumulative probability of success grows as cumulative relative effort Z<sub>rc</sub> increases. Point datum (N-11) grows faster than line datum (N-12).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={data} margin={{ top: 5, right: 20, bottom: 20, left: 0 }}>
            <defs>
              <linearGradient id="poscGradPoint" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="poscGradLine" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="zrc"
              type="number"
              domain={[0, 50]}
              tick={{ fontSize: 10, fill: '#64748b' }}
              label={{ value: 'Cumulative Relative Effort Zrc', position: 'bottom', offset: 5, fontSize: 11, fill: '#475569' }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: '#64748b' }}
              label={{ value: 'POSc (%)', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#475569' }}
            />
            <Tooltip
              formatter={(v: number) => `${v.toFixed(1)}%`}
              labelFormatter={(l) => `Zrc = ${l}`}
              contentStyle={{ fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area
              type="monotone"
              dataKey="point"
              stroke="#10b981"
              strokeWidth={2}
              fill="url(#poscGradPoint)"
              name="Point datum (N-11)"
            />
            <Area
              type="monotone"
              dataKey="line"
              stroke="#6366f1"
              strokeWidth={2}
              fill="url(#poscGradLine)"
              strokeDasharray="5 3"
              name="Line datum (N-12)"
            />
            {currentZrc > 0 && currentZrc <= 50 && (
              <ReferenceLine x={currentZrc} stroke="#dc2626" strokeWidth={1.5} label={{ value: `Zrc=${currentZrc.toFixed(1)}`, fontSize: 10, fill: '#dc2626', position: 'top' }} />
            )}
          </AreaChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-500 mt-2 leading-snug">
          Current Z<sub>rc</sub> = <span className="font-semibold text-slate-700">{currentZrc.toFixed(2)}</span> ({datumType} datum). Active curve:{' '}
          <span className="font-semibold text-slate-700">{activeLine === 'point' ? 'N-11 point' : 'N-12 line'}</span>.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Probability map visualization for a point datum (Appendix M, figure 4-10).
 * Shows the standard circular normal distribution as a 3x3 grid.
 */
interface ProbMapProps {
  E_nm: number;
}

export function PointDatumProbMap({ E_nm }: ProbMapProps) {
  // Initial probability map for a point datum (figure 4-10)
  const grid = [
    [1.42, 9.08, 1.42],
    [9.08, 57.91, 9.08],
    [1.42, 9.08, 1.42],
  ];
  const cellWidth = 2 * E_nm; // each cell is 2E wide

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 pb-3">
        <CardTitle className="text-sm">Figure 4-10 — Point Datum Probability Map</CardTitle>
        <CardDescription className="text-xs">
          Standard circular normal distribution around the datum point. Center cell (within radius E) contains 50% probability.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-3 gap-1.5 max-w-xs mx-auto">
          {grid.flat().map((pct, i) => {
            const row = Math.floor(i / 3);
            const col = i % 3;
            const isCenter = row === 1 && col === 1;
            // Color intensity proportional to probability
            const intensity = Math.min(1, pct / 60);
            return (
              <div
                key={i}
                className="aspect-square flex flex-col items-center justify-center rounded text-[10px] font-mono font-semibold border border-white"
                style={{
                  background: isCenter
                    ? `rgba(220, 38, 38, ${0.3 + intensity * 0.5})`
                    : `rgba(99, 102, 241, ${0.15 + intensity * 0.4})`,
                  color: isCenter ? '#7f1d1d' : '#312e81',
                }}
                title={`Cell (${row + 1}, ${col + 1}) — ${pct}% probability`}
              >
                <span>{pct.toFixed(2)}%</span>
              </div>
            );
          })}
        </div>
        <div className="text-[10px] text-slate-500 mt-3 space-y-1 max-w-xs mx-auto">
          <p>Each cell is <span className="font-semibold">{cellWidth.toFixed(2)} × {cellWidth.toFixed(2)} NM</span> (i.e. 2E × 2E, where E = {E_nm.toFixed(2)} NM).</p>
          <p>Center cell contains the radius-E circle (50% probability) + 4 corner regions (7.91% combined) = 57.91% total.</p>
          <p>Corner cells × 4 = 4 × 1.42% = 5.68%. Edge cells × 4 = 4 × 9.08% = 36.32%. Total = 100%.</p>
        </div>
      </CardContent>
    </Card>
  );
}
