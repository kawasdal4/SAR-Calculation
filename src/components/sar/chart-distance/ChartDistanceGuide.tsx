'use client';

/**
 * PHASE 4 — Panel Panduan & Pengukuran Jarak Peta.
 * Pengetahuan + kalkulator jarak di peta laut (Mercator) dan peta udara (ONC)
 * dengan ketentuan aplikasi: 1 menit pada skala peta = 1 nautical mile.
 * Semua math dari lib chartDistance.ts (satu sumber dengan registry).
 */

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Ruler } from 'lucide-react';
import {
  chartDistanceFromMinutes,
  chartDistanceFromPoints,
  chartMeasureGuide,
  CHART_DISTANCE_RULE,
  type ChartKind,
} from '@/lib/sar/chartDistance';

type Mode = 'minutes' | 'points';

const fmt = (v: number, digits = 2) =>
  Number.isFinite(v) ? v.toLocaleString('id-ID', { maximumFractionDigits: digits }) : '-';

export default function ChartDistanceGuide() {
  const [mode, setMode] = useState<Mode>('minutes');
  const [chart, setChart] = useState<ChartKind>('sea');
  const [minutes, setMinutes] = useState('');
  const [p1Lat, setP1Lat] = useState('');
  const [p1Lng, setP1Lng] = useState('');
  const [p2Lat, setP2Lat] = useState('');
  const [p2Lng, setP2Lng] = useState('');

  const guide = useMemo(() => chartMeasureGuide('both'), []);

  const m1 = useMemo(() => {
    const v = Number(minutes.replace(',', '.'));
    return minutes.trim() !== '' && Number.isFinite(v) ? chartDistanceFromMinutes(v, chart) : null;
  }, [minutes, chart]);

  const m2 = useMemo(() => {
    const lat1 = Number(p1Lat.replace(',', '.'));
    const lng1 = Number(p1Lng.replace(',', '.'));
    const lat2 = Number(p2Lat.replace(',', '.'));
    const lng2 = Number(p2Lng.replace(',', '.'));
    const okAll = [lat1, lng1, lat2, lng2].every((v) => Number.isFinite(v)) &&
      Math.abs(lat1) <= 90 && Math.abs(lat2) <= 90 && Math.abs(lng1) <= 180 && Math.abs(lng2) <= 180;
    return okAll ? chartDistanceFromPoints({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 }, chart) : null;
  }, [p1Lat, p1Lng, p2Lat, p2Lng, chart]);

  const result = mode === 'minutes' ? m1 : m2;

  const inputCls =
    'w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="bg-slate-50 border-b border-slate-200 pb-3">
        <CardTitle className="text-base flex flex-wrap items-center gap-2">
          <Ruler className="h-4 w-4 text-slate-600" />
          Mengukur Jarak di Peta Laut &amp; Peta Udara
          <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded px-2 py-0.5">
            1 menit = 1 NM
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {/* Panduan langkah */}
        <div className="grid md:grid-cols-2 gap-3">
          {guide.sections.map((section) => (
            <div key={section.title} className="border border-slate-200 rounded p-3 bg-white">
              <h3 className="text-sm font-bold text-slate-800 mb-2">{section.title}</h3>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700">
                {section.steps.map((s, i) => (
                  <li key={i} className="leading-relaxed">{s}</li>
                ))}
              </ol>
              <ul className="mt-2 space-y-1 text-[11px] text-amber-800">
                {section.notes.map((n, i) => (
                  <li key={i}>⚠ {n}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-500">{CHART_DISTANCE_RULE}</p>

        {/* Kalkulator */}
        <div className="border border-blue-200 rounded bg-blue-50/40 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-700">Kalkulator:</span>
            <button
              type="button"
              onClick={() => setMode('minutes')}
              className={`text-xs font-bold px-2.5 py-1 rounded border transition ${
                mode === 'minutes' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              Dari menit skala
            </button>
            <button
              type="button"
              onClick={() => setMode('points')}
              className={`text-xs font-bold px-2.5 py-1 rounded border transition ${
                mode === 'points' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
              }`}
            >
              Dari dua koordinat
            </button>
            <label className="text-xs text-slate-600 ml-auto flex items-center gap-1.5">
              Jenis peta:
              <select value={chart} onChange={(e) => setChart(e.target.value as ChartKind)} className="border border-slate-300 rounded px-1.5 py-1 text-xs font-semibold bg-white">
                <option value="sea">Peta laut</option>
                <option value="air">Peta udara (ONC)</option>
              </select>
            </label>
          </div>

          {mode === 'minutes' ? (
            <div className="grid sm:grid-cols-3 gap-3 items-end">
              <label className="text-xs text-slate-600 sm:col-span-1">
                Span pada skala lintang (menit)
                <input
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  inputMode="decimal"
                  placeholder="mis. 12,5"
                  className={`mt-1 ${inputCls}`}
                />
              </label>
              <p className="sm:col-span-2 text-xs text-slate-500">
                Buka jangka pada dua titik, pindahkan ke <b>skala lintang</b> di latitude tengah segmen, lalu baca menitnya.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <label className="text-xs text-slate-600">Lintang 1 (°)
                <input value={p1Lat} onChange={(e) => setP1Lat(e.target.value)} inputMode="decimal" placeholder="mis. -6.2" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="text-xs text-slate-600">Bujur 1 (°)
                <input value={p1Lng} onChange={(e) => setP1Lng(e.target.value)} inputMode="decimal" placeholder="mis. 106.8" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="text-xs text-slate-600">Lintang 2 (°)
                <input value={p2Lat} onChange={(e) => setP2Lat(e.target.value)} inputMode="decimal" placeholder="mis. -5.9" className={`mt-1 ${inputCls}`} />
              </label>
              <label className="text-xs text-slate-600">Bujur 2 (°)
                <input value={p2Lng} onChange={(e) => setP2Lng(e.target.value)} inputMode="decimal" placeholder="mis. 107.1" className={`mt-1 ${inputCls}`} />
              </label>
            </div>
          )}

          {result ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="bg-white border border-slate-200 rounded p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">NM</p>
                <p className="text-lg font-bold text-slate-900">{fmt(result.distanceNm)}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Kilometer</p>
                <p className="text-lg font-bold text-slate-900">{fmt(result.distanceKm)}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Meter</p>
                <p className="text-lg font-bold text-slate-900">{fmt(result.distanceM, 0)}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded p-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Δ Lintang</p>
                <p className="text-lg font-bold text-slate-900">{fmt(result.deltaLatMinutes)}′</p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400">Masukkan nilai untuk melihat hasil pengukuran.</p>
          )}

          {result && mode === 'points' && (
            <p className="text-[11px] text-slate-600">
              Δ Bujur {fmt(result.deltaLonMinutes)}′ · skala bujur di latitude tengah ({fmt(result.midLatDeg)}°): 1′ ={' '}
              <b>{fmt(result.lonMinuteNm, 3)} NM</b> — hasil jarak di atas adalah jarak sebenarnya (setara ukur jangka pada skala lintang).
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
