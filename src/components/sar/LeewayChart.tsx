'use client';

import { useMemo, useState } from 'react';
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
  ReferenceLine,
  ReferenceDot,
} from 'recharts';
import { LEEWAY_OBJECT_TYPES, type LeewayObjectType } from '@/lib/sar/sarCalculations';

interface LeewayChartProps {
  /** Current wind speed (kts) — used to draw the operating point. */
  currentWindSpeed: number;
  /** Currently selected object type ID — highlighted in the chart. */
  selectedObjectId: string;
  /** Currently computed leeway speed (kts) — for reference line. */
  currentLeewaySpeed: number;
}

/**
 * Interactive Leeway graph (figures N-2/N-3).
 * Plots leeway speed (kts) as a function of wind speed (kts) for all
 * search object types, highlighting the currently selected one.
 */
export function LeewayChart({
  currentWindSpeed,
  selectedObjectId,
  currentLeewaySpeed,
}: LeewayChartProps) {
  const [showAllCurves, setShowAllCurves] = useState<boolean>(true);

  const data = useMemo(() => {
    const points: Array<Record<string, number>> = [];
    for (let ws = 0; ws <= 50; ws += 1) {
      const row: Record<string, number> = { wind: ws };
      for (const t of LEEWAY_OBJECT_TYPES) {
        row[t.id] = Number((ws * t.leewayRate).toFixed(3));
      }
      points.push(row);
    }
    return points;
  }, []);

  // Build a colour palette for the curves
  const palette = useMemo(() => {
    const colors = [
      '#10b981', '#6366f1', '#f59e0b', '#dc2626', '#8b5cf6',
      '#06b6d4', '#84cc16', '#ec4899', '#f97316', '#14b8a6',
      '#a855f7', '#64748b',
    ];
    return LEEWAY_OBJECT_TYPES.reduce<Record<string, string>>((acc, t, i) => {
      acc[t.id] = colors[i % colors.length];
      return acc;
    }, {});
  }, []);

  const typesToShow = showAllCurves
    ? LEEWAY_OBJECT_TYPES
    : LEEWAY_OBJECT_TYPES.filter((t) => t.id === selectedObjectId);

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle className="text-sm">
              Figures N-2 / N-3 — Leeway Speed vs Wind Speed
            </CardTitle>
            <CardDescription className="text-xs">
              Leeway rate (slope) for each search object type. Selected type is drawn thicker.
            </CardDescription>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showAllCurves}
              onChange={(e) => setShowAllCurves(e.target.checked)}
              className="rounded" suppressHydrationWarning
            />
            Show all object types
          </label>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data} margin={{ top: 5, right: 20, bottom: 25, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="wind"
              type="number"
              domain={[0, 50]}
              tick={{ fontSize: 10, fill: '#64748b' }}
              label={{
                value: 'Wind speed (kts)',
                position: 'bottom',
                offset: 8,
                fontSize: 11,
                fill: '#475569',
              }}
            />
            <YAxis
              domain={[0, 'auto']}
              tick={{ fontSize: 10, fill: '#64748b' }}
              label={{
                value: 'Leeway speed (kts)',
                angle: -90,
                position: 'insideLeft',
                fontSize: 11,
                fill: '#475569',
              }}
            />
            <Tooltip
              formatter={(v: number, name: string) => {
                const obj = LEEWAY_OBJECT_TYPES.find((t) => t.id === name);
                return [`${v.toFixed(3)} kts`, obj?.label ?? name];
              }}
              labelFormatter={(l) => `Wind ${l} kts`}
              contentStyle={{ fontSize: 11 }}
            />
            <Legend
              formatter={(value: string) => {
                const obj = LEEWAY_OBJECT_TYPES.find((t) => t.id === value);
                return obj?.label ?? value;
              }}
              wrapperStyle={{ fontSize: 10, maxHeight: 60, overflowY: 'auto' }}
            />
            {typesToShow.map((t) => (
              <Line
                key={t.id}
                type="linear"
                dataKey={t.id}
                stroke={palette[t.id]}
                strokeWidth={t.id === selectedObjectId ? 3 : 1.2}
                strokeOpacity={t.id === selectedObjectId ? 1 : 0.55}
                dot={false}
                name={t.id}
              />
            ))}
            {currentWindSpeed > 0 && currentWindSpeed <= 50 && (
              <ReferenceLine
                x={currentWindSpeed}
                stroke="#dc2626"
                strokeWidth={1.5}
                label={{
                  value: `ASW ${currentWindSpeed.toFixed(0)}kt`,
                  fontSize: 10,
                  fill: '#dc2626',
                  position: 'top',
                }}
              />
            )}
            {currentLeewaySpeed > 0 && (
              <ReferenceDot
                x={currentWindSpeed}
                y={currentLeewaySpeed}
                r={5}
                fill="#dc2626"
                stroke="#fff"
                strokeWidth={2}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
        <p className="text-[10px] text-slate-500 mt-2 leading-snug">
          Selected: <span className="font-semibold text-slate-700">
            {LEEWAY_OBJECT_TYPES.find((t) => t.id === selectedObjectId)?.label ?? '—'}
          </span>{' '}
          · leeway rate {LEEWAY_OBJECT_TYPES.find((t) => t.id === selectedObjectId)?.leewayRate.toFixed(3)} × wind speed
          · divergence ±{LEEWAY_OBJECT_TYPES.find((t) => t.id === selectedObjectId)?.divergenceAngle}°
          · probable error {LEEWAY_OBJECT_TYPES.find((t) => t.id === selectedObjectId)?.probableError.toFixed(3)} kts.
        </p>
      </CardContent>
    </Card>
  );
}
