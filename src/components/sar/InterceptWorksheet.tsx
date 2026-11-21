'use client';

import { printActiveWorksheetFit } from '@/lib/sar/printFit';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Compass, MapPinPlus, MousePointer2, Printer, RotateCcw, Ruler, Target, Trash2, Undo2 } from 'lucide-react';
import SeaMapMount from '@/components/sar/SeaMapMount';
import CoordinateInput from '@/components/sar/CoordinateInput';
import type { MapCircle, MapLine, MapMarker } from '@/components/sar/SeaMap';
import { formatDMS } from '@/lib/sar/coordFormat';
import { bearingDeg, distanceNm, type LatLng } from '@/lib/sar/sarCalculations';
import { calculateIntercept, type InterceptInput, type InterceptResult, type InterceptType } from '@/lib/sar/interceptCalculations';

interface InterceptWorksheetProps {
  onResults?: (results: InterceptResult) => void;
  initialInput?: InterceptInput | null;
  /** Mirror input perhitungan terakhir ke induk — dasar save case lengkap
   *  (input intercept ikut tersimpan & dipulihkan saat load kasus). */
  onStateChange?: (input: InterceptInput) => void;
  className?: string;
}

type CoordinateFields = { targetLat: number | null; targetLng: number | null; sruLat: number | null; sruLng: number | null };
type DroppedPoint = { id: string; position: LatLng };
type MapToolMode = 'pan' | 'drop' | 'measure';

const METHOD_DETAILS: Record<InterceptType, { label: string; guidance: string }> = {
  'head-on': {
    label: 'Head-On',
    guidance: 'Pilih jika Target bergerak menuju posisi SRU. Konstruksi memakai garis AB dan gerak saling mendekat.',
  },
  overtaking: {
    label: 'Overtaking',
    guidance: 'Pilih jika Target berada di depan dan bergerak searah; kecepatan SRU wajib lebih tinggi.',
  },
  'beam-on': {
    label: 'Crossing / Beam-On',
    guidance: 'Pilih jika Target tidak langsung menuju atau menjauhi SRU. Heading Target (True Bearing) wajib diisi.',
  },
};

const METHODS: InterceptType[] = ['head-on', 'overtaking', 'beam-on'];

export default function InterceptWorksheet({ onResults, initialInput, onStateChange, className = '' }: InterceptWorksheetProps) {
  const [method, setMethod] = useState<InterceptType>(initialInput?.type ?? 'head-on');
  const [coords, setCoords] = useState<CoordinateFields>(() => initialInput ? {
    // Nilai awal (mis. dari analisa AI) langsung numerik — input memakai
    // CoordinateInput terstruktur (DMS 3 kotak / DM / desimal + hemisfer).
    targetLat: initialInput.target.pos.lat,
    targetLng: initialInput.target.pos.lng,
    sruLat: initialInput.sru.pos.lat,
    sruLng: initialInput.sru.pos.lng,
  } : { targetLat: null, targetLng: null, sruLat: null, sruLng: null });
  const [inputData, setInputData] = useState<InterceptInput>(() => initialInput ? {
    ...initialInput,
    referenceTime: initialInput.referenceTime || '',
    target: { ...initialInput.target, departureTime: initialInput.referenceTime || '' },
    sru: { ...initialInput.sru, departureTime: initialInput.referenceTime || '' },
  } : {
    type: 'head-on',
    referenceTime: '',
    target: { name: '', pos: { lat: 0, lng: 0 }, speedKts: 0, courseDeg: 0 },
    sru: { name: '', pos: { lat: 0, lng: 0 }, speedKts: 0 },
  });
  const [headingText, setHeadingText] = useState(() => initialInput ? String(initialInput.target.courseDeg) : '');
  const [droppedPoints, setDroppedPoints] = useState<DroppedPoint[]>([]);
  const [selectedDroppedPointId, setSelectedDroppedPointId] = useState<string | null>(null);
  const [mapToolMode, setMapToolMode] = useState<MapToolMode>('pan');

  const positionsReady = Object.values(coords).every((value) => value !== null && Number.isFinite(value));
  const heading = headingText.trim() === '' ? null : Number(headingText);
  const headingReady = method !== 'beam-on' || (heading !== null && Number.isFinite(heading) && heading >= 0 && heading < 360);
  const inputReady = Boolean(
    positionsReady &&
    inputData.target.speedKts > 0 && inputData.sru.speedKts > 0 && headingReady,
  );

  const calculationInput = useMemo<InterceptInput>(() => ({
    ...inputData,
    type: method,
    target: {
      ...inputData.target,
      pos: {
        lat: coords.targetLat ?? 0,
        lng: coords.targetLng ?? 0,
      },
      courseDeg: heading ?? 0,
      departureTime: inputData.referenceTime,
    },
    sru: {
      ...inputData.sru,
      pos: {
        lat: coords.sruLat ?? 0,
        lng: coords.sruLng ?? 0,
      },
      departureTime: inputData.referenceTime,
    },
  }), [inputData, method, coords, heading]);

  const results = useMemo<InterceptResult | null>(
    () => inputReady ? calculateIntercept(calculationInput) : null,
    [inputReady, calculationInput],
  );

  // Mirror input perhitungan (termasuk method, koordinat terurai, heading) ke
  // induk tiap perubahan — dipulihkan kembali sebagai initialInput saat remount.
  useEffect(() => {
    onStateChange?.(calculationInput);
  }, [onStateChange, calculationInput]);

  const geometryCheck = useMemo(() => {
    if (!results?.feasible) return null;
    const targetDistance = distanceNm(calculationInput.target.pos, results.interceptPos);
    const sruDistance = distanceNm(calculationInput.sru.pos, results.interceptPos);
    const targetTime = targetDistance / calculationInput.target.speedKts;
    const sruTime = sruDistance / calculationInput.sru.speedKts;
    const distanceError = Math.max(
      Math.abs(targetDistance - results.targetDistanceTravelledNm),
      Math.abs(sruDistance - results.sruDistanceTravelledNm),
    );
    const timeErrorMinutes = Math.abs(targetTime - sruTime) * 60;
    return {
      valid: distanceError <= 0.02 && timeErrorMinutes <= 0.1,
      distanceError,
      timeErrorMinutes,
    };
  }, [results, calculationInput]);

  useEffect(() => {
    if (results && onResults) onResults(results);
  }, [results, onResults]);

  const mapData = useMemo(() => {
    if (!results?.feasible || !geometryCheck?.valid) return null;
    const a = calculationInput.target.pos;
    const b = calculationInput.sru.pos;
    const i = results.interceptPos;
    const points = [a, b, i];
    const center: LatLng = {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    };
    const extent = Math.max(results.initialDistanceNm, results.targetDistanceTravelledNm, results.sruDistanceTravelledNm, 1);
    const zoom = Math.max(3, Math.min(12, Math.round(11 - Math.log2(extent / 10))));
    const markers: MapMarker[] = [
      { position: a, label: `A · Target${calculationInput.target.name ? ` · ${calculationInput.target.name}` : ''}`, color: '#2563eb', isStart: true, showLabel: true, labelDirection: 'left' },
      { position: b, label: `B · SRU${calculationInput.sru.name ? ` · ${calculationInput.sru.name}` : ''}`, color: '#f97316', showLabel: true, labelDirection: 'right' },
      { position: i, label: 'I · Intercept Point', color: '#16a34a', isDatum: true, showLabel: true, labelDirection: 'top' },
    ];
    const lines: MapLine[] = [
      { from: a, to: b, color: '#64748b', dashed: true, label: `AB - ${results.initialDistanceNm.toFixed(1)} NM` },
      { from: a, to: i, color: '#2563eb', arrow: true, label: `Target - ${bearingDeg(a, i).toFixed(0)}°/${results.targetDistanceTravelledNm.toFixed(1)} NM` },
      { from: b, to: i, color: '#f97316', arrow: true, label: `SRU - ${results.interceptCourseDeg.toFixed(0)}°/${results.sruDistanceTravelledNm.toFixed(1)} NM` },
    ];
    const construction = results.constructionPoints;
    if (method === 'head-on' || method === 'overtaking') {
      const c = construction?.pointC;
      const d = construction?.pointD;
      if (c && d) {
        markers.push({ position: c, label: 'C · Construction', color: '#a855f7', showLabel: true, labelDirection: 'top' });
        markers.push({ position: d, label: 'D · Construction', color: '#a855f7', showLabel: true, labelDirection: 'bottom' });
        lines.push(
          { from: a, to: c, color: '#0d9488', dashed: true, label: `AC - ${calculationInput.target.speedKts * 0.5} NM` },
          { from: b, to: d, color: '#8b5cf6', dashed: true, label: `BD - ${calculationInput.sru.speedKts * 0.5} NM` },
          { from: method === 'overtaking' ? d : c, to: method === 'overtaking' ? i : d, color: '#db2777', dashed: true, label: 'CD → I' },
        );
      }
    }
    if (method === 'beam-on') {
      const x = construction?.pointX;
      const y = construction?.pointY;
      const w = construction?.pointW;
      if (x && y && w) {
        markers.push(
          { position: x, label: 'X · Target construction', color: '#0d9488', showLabel: true, labelDirection: 'top' },
          { position: y, label: 'Y · Baseline', color: '#0d9488', showLabel: true, labelDirection: 'left' },
          { position: w, label: 'W · SRU construction', color: '#8b5cf6', showLabel: true, labelDirection: 'right' },
        );
        lines.push(
          { from: a, to: x, color: '#0d9488', dashed: true, arrow: true, label: `AX - ${calculationInput.target.courseDeg.toFixed(0)}°/${calculationInput.target.speedKts * 0.5} NM` },
          { from: x, to: y, color: '#0d9488', dashed: true, label: 'XY ∥ AB' },
          { from: b, to: w, color: '#8b5cf6', dashed: true, arrow: true, label: `BW - ${bearingDeg(b, w).toFixed(0)}°/${calculationInput.sru.speedKts * 0.5} NM` },
        );
      }
    }
    const circles: MapCircle[] = method === 'beam-on'
      ? [{ center: b, radiusNm: calculationInput.sru.speedKts * 0.5, color: '#8b5cf6', fillColor: '#8b5cf6', fillOpacity: 0.025, label: 'SRU 0.5 h construction radius' }]
      : [];
    return { center, zoom, markers, lines, circles };
  }, [results, calculationInput, method, geometryCheck]);

  const eta = useMemo(() => {
    if (!results?.feasible || !inputData.referenceTime) return null;
    const start = new Date(inputData.referenceTime);
    if (!Number.isFinite(start.getTime())) return null;
    const end = new Date(start.getTime() + results.timeToInterceptHours * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('id-ID', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
    }).format(end);
  }, [results, inputData.referenceTime]);

  const updateCoordinate = (key: keyof CoordinateFields, value: number | null) => {
    setCoords((current) => ({ ...current, [key]: value }));
  };

  const reset = () => {
    setMethod('head-on');
    setCoords({ targetLat: null, targetLng: null, sruLat: null, sruLng: null });
    setHeadingText('');
    setDroppedPoints([]);
    setSelectedDroppedPointId(null);
    setMapToolMode('pan');
    setInputData({
      type: 'head-on', referenceTime: '',
      target: { name: '', pos: { lat: 0, lng: 0 }, speedKts: 0, courseDeg: 0 },
      sru: { name: '', pos: { lat: 0, lng: 0 }, speedKts: 0 },
    });
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <Card className="border-slate-200 shadow-sm bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3 px-4 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2 text-slate-800">
            <Target className="h-4 w-4 text-rose-600" /> Intercept Calculator
          </CardTitle>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} className="inline-flex items-center gap-1.5 text-xs rounded border border-slate-300 px-2.5 py-1.5 text-slate-700 hover:bg-white">
              <RotateCcw className="h-3.5 w-3.5" /> Reset
            </button>
            <button type="button" onClick={() => printActiveWorksheetFit()} className="inline-flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium px-2.5 py-1.5 rounded print:hidden">
              <Printer className="h-3.5 w-3.5" /> Cetak
            </button>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Intercept Method</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {METHODS.map((item) => (
                    <button key={item} type="button" onClick={() => setMethod(item)} className={`rounded border px-2 py-2 text-xs font-semibold ${method === item ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-300 bg-white text-slate-700'}`}>
                      {METHOD_DETAILS[item].label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-slate-600">{METHOD_DETAILS[method].guidance}</p>
              </div>
              <label className="block text-xs font-semibold text-slate-700">Reference Time — posisi A dan B harus pada waktu yang sama
                <input type="datetime-local" value={inputData.referenceTime ?? ''} onChange={(event) => setInputData((current) => ({ ...current, referenceTime: event.target.value }))} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 font-normal" />
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2 rounded border border-blue-200 bg-white p-2.5">
                  <h3 className="text-xs font-bold text-blue-800">A · Target Position / Track</h3>
                  <input aria-label="Nama Target" placeholder="Nama / Call Sign Target" value={inputData.target.name} onChange={(event) => setInputData((current) => ({ ...current, target: { ...current.target, name: event.target.value } }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <span className="mb-1 block text-[10px] font-medium text-slate-600">Latitude</span>
                      <CoordinateInput axis="lat" value={coords.targetLat ?? 0} onChange={(value) => updateCoordinate('targetLat', value)} aria-label="Latitude target" />
                    </div>
                    <div>
                      <span className="mb-1 block text-[10px] font-medium text-slate-600">Longitude</span>
                      <CoordinateInput axis="lng" value={coords.targetLng ?? 0} onChange={(value) => updateCoordinate('targetLng', value)} aria-label="Longitude target" />
                    </div>
                  </div>
                  <NumberInput label="Target Speed (kts)" value={inputData.target.speedKts} min={0} onChange={(value) => setInputData((current) => ({ ...current, target: { ...current.target, speedKts: value === '' ? 0 : Number(value) } }))} />
                  {method === 'beam-on' && <NumberInput label="Target Heading · True Bearing (°T)" value={heading ?? ''} min={0} max={359.999} onChange={(value) => { const text = String(value); setHeadingText(text); setInputData((current) => ({ ...current, target: { ...current.target, courseDeg: value === '' ? 0 : Number(value) } })); }} />}
                </div>
                <div className="space-y-2 rounded border border-orange-200 bg-white p-2.5">
                  <h3 className="text-xs font-bold text-orange-800">B · SRU Position</h3>
                  <input aria-label="Nama SRU" placeholder="Nama / Call Sign SRU" value={inputData.sru.name} onChange={(event) => setInputData((current) => ({ ...current, sru: { ...current.sru, name: event.target.value } }))} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <span className="mb-1 block text-[10px] font-medium text-slate-600">Latitude</span>
                      <CoordinateInput axis="lat" value={coords.sruLat ?? 0} onChange={(value) => updateCoordinate('sruLat', value)} aria-label="Latitude SRU" />
                    </div>
                    <div>
                      <span className="mb-1 block text-[10px] font-medium text-slate-600">Longitude</span>
                      <CoordinateInput axis="lng" value={coords.sruLng ?? 0} onChange={(value) => updateCoordinate('sruLng', value)} aria-label="Longitude SRU" />
                    </div>
                  </div>
                  <NumberInput label="SRU Speed (kts)" value={inputData.sru.speedKts} min={0} onChange={(value) => setInputData((current) => ({ ...current, sru: { ...current.sru, speedKts: value === '' ? 0 : Number(value) } }))} />
                </div>
              </div>
              <p className="text-[10px] text-slate-500">Koordinat menerima DD, DM, atau DMS dan disimpan sebagai WGS84. Kecepatan dalam knot; jarak dalam NM. Heading Target diperlukan khusus Crossing / Beam-On.</p>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Compass className="h-4 w-4 text-rose-600" /> Hasil Intercept</div>
                {results && <Badge variant="outline" className={results.feasible && geometryCheck?.valid ? 'border-green-300 bg-green-50 text-green-800' : 'border-rose-300 bg-rose-50 text-rose-800'}>{!results.feasible ? 'NO INTERCEPT' : geometryCheck?.valid ? 'FEASIBLE · VALIDATED' : 'GEOMETRY CHECK FAILED'}</Badge>}
              </div>
              {!inputReady && <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-5 text-center text-xs text-slate-500">Masukkan posisi Target dan SRU, kecepatan, serta Reference Time yang sama untuk menghitung.</div>}
              {results && !results.feasible && <div role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{results.message || 'Intercept tidak dapat dihitung dengan data ini.'}</div>}
              {results?.feasible && geometryCheck && !geometryCheck.valid && <div role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">Validasi geometri gagal: selisih jarak {geometryCheck.distanceError.toFixed(3)} NM; selisih waktu Target/SRU {geometryCheck.timeErrorMinutes.toFixed(2)} menit. Peta hasil tidak ditampilkan.</div>}
              {results?.feasible && <div className="grid grid-cols-2 gap-2 text-xs">
                <Result label="Intercept Point (I)" value={`${formatDMS(results.interceptPos.lat, false)} · ${formatDMS(results.interceptPos.lng, true)}`} wide />
                <Result label="Intercept Method" value={METHOD_DETAILS[method].label} />
                <Result label="Intercept Time" value={`${results.timeToInterceptHours.toFixed(2)} jam · ${results.timeToInterceptMin.toFixed(1)} menit`} />
                <Result label="ETA (${Intl.DateTimeFormat().resolvedOptions().timeZone})" value={eta ?? '—'} />
                <Result label="Target Distance A–I" value={`${results.targetDistanceTravelledNm.toFixed(2)} NM`} />
                <Result label="SRU Distance B–I" value={`${results.sruDistanceTravelledNm.toFixed(2)} NM`} />
                <Result label="SRU Bearing B–I" value={`${results.interceptCourseDeg.toFixed(1)}°T`} />
                <Result label="Initial Distance A–B" value={`${results.initialDistanceNm.toFixed(2)} NM`} />
              </div>}
              {results?.feasible && method !== 'beam-on' && <p className="rounded bg-amber-50 px-3 py-2 text-[11px] text-amber-900">Model {METHOD_DETAILS[method].label} mengikuti asumsi lintasan pada baseline AB sebagaimana konstruksi metode.</p>}
            </section>
          </div>

          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <div><h3 className="text-sm font-bold text-slate-800">Peta Intercept</h3><p className="text-[11px] text-slate-500">Peta ini terpisah dari peta Worksheet 1.</p></div>
              {mapData && <div className="flex flex-wrap gap-2 text-[10px]"><span className="text-blue-700">━━ Target Track</span><span className="text-orange-600">━━ SRU Track</span><span className="text-slate-500">┄┄ AB / konstruksi</span></div>}
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5" aria-label="Alat peta Intercept">
              <span className="mr-1 text-[11px] font-bold text-slate-700">Alat Peta</span>
              <button type="button" disabled={!mapData} onClick={() => setMapToolMode('pan')} aria-pressed={mapToolMode === 'pan'} className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs disabled:opacity-40 ${mapToolMode === 'pan' ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                <MousePointer2 className="h-3.5 w-3.5" /> Geser / pilih
              </button>
              <button type="button" disabled={!mapData} onClick={() => setMapToolMode((mode) => mode === 'drop' ? 'pan' : 'drop')} aria-pressed={mapToolMode === 'drop'} className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs disabled:opacity-40 ${mapToolMode === 'drop' ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                <MapPinPlus className="h-3.5 w-3.5" /> {mapToolMode === 'drop' ? 'Klik peta untuk titik' : 'Taruh titik'}
              </button>
              <button type="button" disabled={!mapData} onClick={() => setMapToolMode((mode) => mode === 'measure' ? 'pan' : 'measure')} aria-pressed={mapToolMode === 'measure'} className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs disabled:opacity-40 ${mapToolMode === 'measure' ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                <Ruler className="h-3.5 w-3.5" /> Ukur jarak
              </button>
              <button type="button" disabled={!selectedDroppedPointId} onClick={() => {
                setDroppedPoints((points) => points.filter((point) => point.id !== selectedDroppedPointId));
                setSelectedDroppedPointId(null);
              }} className="inline-flex items-center gap-1 rounded border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-rose-700 disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" /> Hapus titik terpilih
              </button>
              <button type="button" disabled={droppedPoints.length === 0} onClick={() => {
                const lastPoint = droppedPoints[droppedPoints.length - 1];
                setDroppedPoints((points) => points.slice(0, -1));
                if (selectedDroppedPointId === lastPoint?.id) setSelectedDroppedPointId(null);
              }} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 disabled:opacity-40">
                <Undo2 className="h-3.5 w-3.5" /> Urungkan titik terakhir
              </button>
              <button type="button" disabled={droppedPoints.length === 0} onClick={() => {
                setDroppedPoints([]);
                setSelectedDroppedPointId(null);
              }} className="inline-flex items-center gap-1 rounded border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-rose-700 disabled:opacity-40">
                Bersihkan titik tambahan
              </button>
              <span className="ml-auto text-[10px] text-slate-500">{droppedPoints.length} titik tambahan · {mapToolMode === 'drop' ? 'klik peta untuk menaruh titik' : mapToolMode === 'measure' ? 'klik beberapa titik; klik ganda untuk menghapus garis ukur' : 'mode geser aktif'}</span>
            </div>
            {droppedPoints.length > 0 && <div className="flex flex-wrap gap-1.5">
              {droppedPoints.map((point, index) => (
                <button key={point.id} type="button" onClick={() => setSelectedDroppedPointId(point.id)} aria-pressed={selectedDroppedPointId === point.id} className={`rounded border px-2 py-1 text-[10px] ${selectedDroppedPointId === point.id ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                  Titik {index + 1}: {formatDMS(point.position.lat, false)} · {formatDMS(point.position.lng, true)}
                </button>
              ))}
            </div>}
            {mapData
              ? <SeaMapMount
                  center={mapData.center}
                  zoom={mapData.zoom}
                  markers={[
                    ...mapData.markers,
                    ...droppedPoints.map((point, index): MapMarker => ({
                      position: point.position,
                      label: `Titik tambahan ${index + 1} · ${formatDMS(point.position.lat, false)} · ${formatDMS(point.position.lng, true)}`,
                      color: point.id === selectedDroppedPointId ? '#e11d48' : '#7c3aed',
                      sequence: index + 1,
                      onClick: () => setSelectedDroppedPointId(point.id),
                    })),
                  ]}
                  lines={mapData.lines}
                  circles={mapData.circles}
                  pickMode={mapToolMode === 'drop'}
                  measureMode={mapToolMode === 'measure'}
                  preferenceKey="intercept"
                  onMapClick={(position) => {
                    const id = `map-point-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                    setDroppedPoints((points) => [...points, { id, position }]);
                    setSelectedDroppedPointId(id);
                  }}
                  height="480px"
                />
              : <div className="flex h-[260px] items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">Peta Intercept akan tampil setelah input lengkap dan solusi valid.</div>}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

function NumberInput({ label, value, min, max, onChange }: { label: string; value: number | string; min: number; max?: number; onChange: (value: number | string) => void }) {
  return <label className="block text-[10px] font-medium text-slate-600">{label}
    <input type="number" value={value} min={min} max={max} step="any" onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))} className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800" />
  </label>;
}

function Result({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return <div className={`rounded border border-slate-200 bg-slate-50 p-2 ${wide ? 'col-span-2' : ''}`}>
    <div className="text-[10px] text-slate-500">{label}</div>
    <div className="mt-0.5 break-words font-semibold text-slate-800">{value}</div>
  </div>;
}
