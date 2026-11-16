// 'use client'
import React, { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Target, Compass, Printer } from 'lucide-react';
import { calculateIntercept, type InterceptInput, type InterceptResult } from '@/lib/sar/interceptCalculations';

interface InterceptWorksheetProps {
  onResults?: (results: InterceptResult) => void;
  className?: string;
}

export default function InterceptWorksheet({ onResults, className = '' }: InterceptWorksheetProps) {
  // Minimal default input matching the new InterceptInput shape
  const [inputData, setInputData] = useState<InterceptInput>({
    type: 'head-on',
    target: {
      name: '-',
      pos: { lat: 0, lng: 0 },
      speedKts: 0,
      courseDeg: 0,
    },
    sru: {
      name: '-',
      pos: { lat: 0, lng: 0 },
      speedKts: 0,
    },
  });

  const results: InterceptResult = useMemo(() => calculateIntercept(inputData), [inputData]);

  useEffect(() => {
    if (onResults && inputData.target.speedKts > 0 && inputData.sru.speedKts > 0) onResults(results);
  }, [results, onResults]);

  // Simple method selector UI (head‑on / overtaking / beam‑on)
  const methods = [
    { type: 'head-on' as const, label: 'Head‑On' },
    { type: 'overtaking' as const, label: 'Over‑taking' },
    { type: 'beam-on' as const, label: 'Beam‑On' },
  ];

  return (
    <div className={`space-y-4 ${className}`}>
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2 text-slate-800">
            <Target className="h-4 w-4 text-rose-600" /> Intercept Calculator (IAMSAR Vol II)
          </CardTitle>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium px-2.5 py-1 rounded shadow-2xs transition-colors print:hidden"
          >
            <Printer className="h-3.5 w-3.5" />
            Cetak Lembar Ini
          </button>
        </CardHeader>
        <CardContent className="p-4">
          {/* Method selector */}
          <div className="flex gap-2 mb-4">
            {methods.map((m) => (
              <button
                key={m.type}
                type="button"
                onClick={() => setInputData((prev) => ({ ...prev, type: m.type }))}
                className={`px-3 py-1 rounded ${inputData.type === m.type ? 'bg-rose-100' : 'bg-slate-100'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          {/* Simple result display */}
          {inputData.target.speedKts > 0 && inputData.sru.speedKts > 0 && <div className="text-sm">
            <p>Feasible: {results.feasible ? 'Yes' : 'No'}</p>
            {results.message && <p>Message: {results.message}</p>}
            <p>Intercept Course: {results.interceptCourseDeg?.toFixed(1)}°T</p>
            <p>Time to Intercept: {results.timeToInterceptMin?.toFixed(0)} min</p>
          </div>}
        </CardContent>
      </Card>
    </div>
  );
}
