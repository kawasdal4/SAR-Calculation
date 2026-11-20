'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorksheetCard, NumberInput } from './WorksheetCard';
import CoordinateInput from './CoordinateInput';
import TableValue from './TableValue';
import TableRefText from './TableRefText';
import { leewayTableGroupKey } from '@/lib/sar/manualTables';
import {
  computeWC,
  computeLW,
  computeTWC,
  computeDatum,
  computeE,
  LEEWAY_OBJECT_TYPES,
  TABLE_J1_NAV_ERRORS,
  TABLE_J2_NAV_ERRORS,
  type LeewayObjectType,
  type LatLng,
  type Vector,
  dirToCompass,
} from '@/lib/sar/sarCalculations';
import { cn } from '@/lib/utils';

export interface DatumData {
  start: LatLng;
  driftInterval: number;
  seaCurrent: Vector;
  aswDirFrom: number;
  aswSpeed: number;
  aswdve: number;
  twc: Vector;
  twcErr: number;
  lwLeftDir: number;
  lwRightDir: number;
  lwSpeed: number;
  lwErr: number;
  /** Sakelar "abaikan arus angin" (§4.7.44) — true = arus angin dihitung. */
  useWindCurrent: boolean;
}

export interface DatumResults {
  datumLeft: LatLng;
  datumRight: LatLng;
  divergenceDistance: number;
  driftDistance: number;
  /** Arah & laju drift total (TWC + Leeway) — utk tampilan kartu Datum. */
  driftLeftDir: number;
  driftRightDir: number;
  driftSpeed: number;
  dve: number;
  De: number;
  E: number;
  X: number;
  Y: number;
  wc: ReturnType<typeof computeWC>;
  lw: ReturnType<typeof computeLW>;
  twc: ReturnType<typeof computeTWC>;
}

export interface DatumInitialState {
  driftInterval?: number;
  latitude?: number;
  seaCurrentDir?: number;
  seaCurrentSpeed?: number;
  seaCurrentErr?: number;
  leewayObjectId?: string;
  X?: number;
  Y?: number;
  /** Sakelar "abaikan arus angin" (§4.7.44). */
  useWindCurrent?: boolean;
}

interface DatumWorksheetProps {
  aswDirFrom: number;
  aswSpeed: number;
  aswErr: number;
  aswdve: number;
  /** Total Hours (D) dari worksheet ASW — drift interval otomatis mengikuti nilai ini (ketentuan: Hours of drift (a) = Total Hours (D) ASW). */
  aswTotalHours?: number;
  /** Controlled LKP position — set by parent (which can be updated from map clicks). */
  startLat: number;
  startLng: number;
  onLKPChange: (lat: number, lng: number) => void;
  /** Triggered when user clicks the "Pick on map" button. */
  onRequestMapPick?: () => void;
  /** True when parent is waiting for a map click to set LKP. */
  pickMode?: boolean;
  /** External override for sea current (e.g. from WeatherPanel "Apply Sea Current"). */
  seaCurrentOverride?: { dir: number; speed: number; ts: number } | null;
  onResults: (results: DatumResults | null) => void;
  /** Hasil internal untuk TAMPILAN kartu Datum di luar worksheet —
   *  selalu terisi (tidak terpengaruh status bersih aswSpeed=0). */
  onDisplayResults?: (results: DatumResults) => void;
  onDataChange: (data: DatumData | null) => void;
  /** Fired whenever any internal state changes — used by parent to save state. */
  onStateChange?: (state: DatumInitialState) => void;
  initialState?: DatumInitialState | null;
  /** Perintah perubahan seleksi dari LUAR worksheet (mis. klik rujukan tabel
   *  pada Worksheet 1 yang mengubah kategori leeway / nilai x / nilai y).
   *  Dikenali lewat `ts` monoton agar perintah yang sama bisa dikirim ulang. */
  externalSelection?: { ts: number; leewayObjectId?: string; X?: number; Y?: number } | null;
}

export default function DatumWorksheet({
  aswDirFrom,
  aswSpeed,
  aswErr,
  aswdve,
  aswTotalHours,
  startLat,
  startLng,
  onLKPChange,
  onRequestMapPick,
  pickMode,
  seaCurrentOverride,
  onResults,
  onDisplayResults,
  onDataChange,
  onStateChange,
  initialState,
  externalSelection,
}: DatumWorksheetProps) {
  const [driftInterval, setDriftInterval] = useState<number>(initialState?.driftInterval ?? 0);
  const [latitude, setLatitude] = useState<number>(initialState?.latitude ?? Math.abs(startLat));
  const [seaCurrentDir, setSeaCurrentDir] = useState<number>(initialState?.seaCurrentDir ?? 0);
  const [seaCurrentSpeed, setSeaCurrentSpeed] = useState<number>(initialState?.seaCurrentSpeed ?? 0);
  const [seaCurrentErr, setSeaCurrentErr] = useState<number>(initialState?.seaCurrentErr ?? 0);
  const [leewayObjectId, setLeewayObjectId] = useState<string>(initialState?.leewayObjectId ?? '');
  const [X, setX] = useState<number>(initialState?.X ?? 0);
  const [Y, setY] = useState<number>(initialState?.Y ?? 0);
  /** Sakelar "abaikan arus angin" (§4.7.44, Panduan Datum bagian 3.3). */
  const [useWindCurrent, setUseWindCurrent] = useState<boolean>(initialState?.useWindCurrent !== false);

  // Terapkan perintah seleksi dari luar (klik rujukan tabel Worksheet 1):
  // ganti kategori leeway / nilai x / nilai y. Guard ts mencegah efek dijalankan
  // ulang untuk perintah yang sama (render ulang tanpa perintah baru).
  const appliedExternalTs = useRef<number | null>(null);
  useEffect(() => {
    if (!externalSelection || externalSelection.ts === appliedExternalTs.current) return;
    appliedExternalTs.current = externalSelection.ts;
    if (
      externalSelection.leewayObjectId !== undefined &&
      LEEWAY_OBJECT_TYPES.some((t) => t.id === externalSelection.leewayObjectId)
    ) {
      setLeewayObjectId(externalSelection.leewayObjectId);
    }
    if (externalSelection.X !== undefined) setX(externalSelection.X);
    if (externalSelection.Y !== undefined) setY(externalSelection.Y);
  }, [externalSelection]);

  // Keep |latitude| (used for wind current divergence) synced with startLat
  useEffect(() => {
    setLatitude(Math.abs(startLat));
  }, [startLat]);

  // Ketentuan Worksheet 1: Hours of drift (a) = Total Hours (D) worksheet ASW.
  // Drift interval otomatis mengikuti ASW setiap total hours berubah.
  useEffect(() => {
    if (aswTotalHours && aswTotalHours > 0) {
      setDriftInterval((prev) => (prev === aswTotalHours ? prev : aswTotalHours));
    }
  }, [aswTotalHours]);

  // Apply sea current override (e.g. from WeatherPanel)
  useEffect(() => {
    if (seaCurrentOverride) {
       
      setSeaCurrentDir(seaCurrentOverride.dir);
       
      setSeaCurrentSpeed(seaCurrentOverride.speed);
    }
  }, [seaCurrentOverride]);

  const objectType: LeewayObjectType =
    LEEWAY_OBJECT_TYPES.find((t) => t.id === leewayObjectId) ?? LEEWAY_OBJECT_TYPES[0];

  // Sakelar §4.7.44: bila diaktifkan, kecepatan arus angin dijadikan 0
  // (arah tetap downwind agar tampilan konsisten) dan TWC hanya berisi
  // arus laut + arus pasang.
  const wc = useMemo(() => {
    const base = computeWC(aswDirFrom, aswSpeed, latitude, 0.3);
    if (useWindCurrent) return base;
    return { ...base, wcDrift: 0, windCurrentDrift: 0, wcErr: 0 };
  }, [aswDirFrom, aswSpeed, latitude, useWindCurrent]);
  const lw = useMemo(
    () => computeLW(aswDirFrom, aswSpeed, objectType),
    [aswDirFrom, aswSpeed, objectType],
  );
  const twc = useMemo(
    () =>
      computeTWC({
        seaCurrent: { dir: seaCurrentDir, mag: seaCurrentSpeed },
        seaCurrentErr,
        windCurrent: { dir: wc.wcSet, mag: wc.wcDrift },
        windCurrentErr: wc.wcErr,
      }),
    [seaCurrentDir, seaCurrentSpeed, seaCurrentErr, wc],
  );

  const start: LatLng = useMemo(() => ({ lat: startLat, lng: startLng }), [startLat, startLng]);
  const datum = useMemo(
    () =>
      computeDatum({
        start,
        driftInterval,
        aswDirFrom,
        aswSpeed,
        aswdve,
        twc: twc.twc,
        twcErr: twc.twcErr,
        lwLeftDir: lw.lwLeftDir,
        lwRightDir: lw.lwRightDir,
        lwSpeed: lw.leewaySpeed,
        lwErr: lw.lwError,
      }),
    [start, driftInterval, aswDirFrom, aswSpeed, aswdve, twc, lw],
  );

  const e = useMemo(
    () => computeE({ X, De: datum.De, Y }),
    [X, datum.De, Y],
  );

  const buildResults = (): DatumResults => ({
    datumLeft: datum.datumLeft,
    datumRight: datum.datumRight,
    divergenceDistance: datum.divergenceDistance,
    driftDistance: datum.driftDistance,
    driftLeftDir: datum.driftLeftDir,
    driftRightDir: datum.driftRightDir,
    driftSpeed: datum.driftSpeed,
    dve: datum.dve,
    De: datum.De,
    E: e.E,
    X: e.X,
    Y: e.Y,
    wc,
    lw,
    twc,
  });

  useEffect(() => {
    // If ASW speed is 0 and no initial state, datum calculation is in clean/reset state
    if (aswSpeed === 0 && (!initialState || Object.keys(initialState).length === 0)) {
      onDataChange(null);
      onResults(null);
      return;
    }

    const data: DatumData = {
      start,
      driftInterval,
      seaCurrent: { dir: seaCurrentDir, mag: seaCurrentSpeed },
      aswDirFrom,
      aswSpeed,
      aswdve,
      twc: twc.twc,
      twcErr: twc.twcErr,
      lwLeftDir: lw.lwLeftDir,
      lwRightDir: lw.lwRightDir,
      lwSpeed: lw.leewaySpeed,
      lwErr: lw.lwError,
      useWindCurrent,
    };
    onDataChange(data);
    onResults(buildResults());
  }, [start, driftInterval, aswDirFrom, aswSpeed, aswdve, twc, lw, datum, e, wc, useWindCurrent, initialState]);

  // Selalu laporkan hasil internal untuk tampilan kartu Datum di luar worksheet —
  // tidak terpengaruh status bersih (aswSpeed=0) yang memanggil onResults(null).
  useEffect(() => {
    onDisplayResults?.(buildResults());
  }, [datum, e, wc, lw, twc, onDisplayResults]);

  // Emit DatumInitialState snapshot up to parent for state-saving
  useEffect(() => {
    onStateChange?.({
      driftInterval,
      latitude,
      seaCurrentDir,
      seaCurrentSpeed,
      seaCurrentErr,
      leewayObjectId,
      X,
      Y,
      useWindCurrent,
    });
  }, [
    driftInterval,
    latitude,
    seaCurrentDir,
    seaCurrentSpeed,
    seaCurrentErr,
    leewayObjectId,
    X,
    Y,
    useWindCurrent,
    onStateChange,
  ]);

  return (
    <div className="space-y-4">
      <WorksheetCard
        title="Starting Position & Drift Interval"
        description="Last known position, estimated incident position, or previous datum"
        badge="K-13 A/B"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Latitude (DMS)</Label>
            <CoordinateInput axis="lat" value={startLat} onChange={(v) => onLKPChange(v, startLng)} aria-label="Latitude LKP" />
          </div>
          <div>
            <Label className="text-xs">Longitude (DMS)</Label>
            <CoordinateInput axis="lng" value={startLng} onChange={(v) => onLKPChange(startLat, v)} aria-label="Longitude LKP" />
          </div>
          <div>
            <Label className="text-xs">Drift Interval (hours)</Label>
            <NumberInput value={driftInterval} onChange={setDriftInterval} />
            <p className="text-[10px] text-slate-400 mt-1">Otomatis = Total Hours (D) worksheet ASW; LKP time → commence search time</p>
          </div>
          <div>
            <Label className="text-xs">|Latitude| for WC divergence (°)</Label>
            <NumberInput value={latitude} onChange={setLatitude} />
            <p className="text-[10px] text-slate-400 mt-1">
              <TableRefText
                request={{
                  docId: 'appendix-i',
                  page: 2,
                  tableId: 'FIG-I-1',
                  sourceLabel: 'Worksheet Datum — |Latitude| untuk divergensi WC (Figure I-1)',
                  currentValueLabel: `divergensi ${latitude <= 10 ? 0 : 30}° pada |lintang| ${latitude.toFixed(1)}°`,
                }}
              >
                Figure I-1
              </TableRefText>
              : 10°N–10°S → 0°, di luarnya → 30°
            </p>
          </div>
          {onRequestMapPick && (
            <div className="sm:col-span-1 col-span-2 flex items-end">
              <button
                type="button"
                onClick={onRequestMapPick}
                className={`w-full h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                  pickMode
                    ? 'bg-emerald-600 text-white border-emerald-600 animate-pulse'
                    : 'bg-white text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                }`}
              >
                {pickMode ? '◉ Click on map to set LKP…' : '📍 Pick LKP on map'}
              </button>
            </div>
          )}
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Wind Current (WC)"
        description="Local wind-generated surface current — drift = 0,036 × ASW, divergensi menurut zona lintang (rujukan pada kartu di atas)"
        badge="Fig I-1"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <StatBox label="ASW Direction" value={`${aswDirFrom.toFixed(1)}°T (${dirToCompass(aswDirFrom)})`} />
          <StatBox label="ASW Speed" value={`${aswSpeed.toFixed(2)} kts`} />
          <StatBox label="Downwind Direction" value={`${wc.downwindDir.toFixed(1)}°T`} />
          <StatBox label="Wind Current Drift" value={`${wc.windCurrentDrift.toFixed(3)} kts`} accent />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox label="Divergence" value={`${wc.divergence}° (${wc.hemisphere > 0 ? 'N' : 'S'})`} />
          <StatBox label="Wind Current Set" value={`${wc.wcSet.toFixed(1)}°T (${dirToCompass(wc.wcSet)})`} accent />
          <StatBox label="Wind Current Drift" value={`${wc.wcDrift.toFixed(3)} kts`} accent />
          <StatBox label="Probable Error (WCe)" value={`${wc.wcErr.toFixed(2)} kts`} />
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Total Water Current (TWC)"
        description="Vector sum of sea current + tidal current + wind current (Appendix K)"
        badge="K-TWC"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <div>
            <Label className="text-xs">Sea Current Set (°T) — arah KE mana arus bergerak</Label>
            <NumberInput value={seaCurrentDir} onChange={setSeaCurrentDir} />
          </div>
          <div>
            <Label className="text-xs">Sea Current Drift (kts)</Label>
            <NumberInput value={seaCurrentSpeed} onChange={setSeaCurrentSpeed} />
          </div>
          <div>
            <Label className="text-xs">Sea Current Error (kts)</Label>
            <NumberInput value={seaCurrentErr} onChange={setSeaCurrentErr} />
          </div>
          <StatBox
            label="TWC Set/Drift"
            value={`${twc.twc.dir.toFixed(1)}°T / ${twc.twc.mag.toFixed(3)} kts`}
            accent
          />
        </div>
        <label className="flex items-start gap-2 mb-3 text-xs text-slate-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={useWindCurrent}
            onChange={(e) => setUseWindCurrent(e.target.checked)}
            className="mt-0.5 rounded text-emerald-600"
            suppressHydrationWarning
          />
          <span>
            <span className="font-semibold">Hitung arus angin (WC)</span> — hapus centang untuk{' '}
            <span className="font-semibold">mengabaikan arus angin</span> (§4.7.44: area dekat pantai
            atau angin yang konsisten).
          </span>
        </label>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
          <StatBox label="TWC Direction" value={`${twc.twc.dir.toFixed(1)}°T (${dirToCompass(twc.twc.dir)})`} accent />
          <StatBox label="TWC Probable Error (TWCe)" value={`${twc.twcErr.toFixed(3)} kts`} />
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Leeway (LW)"
        description="Movement of search object through water caused by wind (Appendix K-28, fig N-2/N-3)"
        badge="K-28"
      >
        <div className="mb-3">
          <Label className="text-xs">Search Object Type (Figure N-2/N-3)</Label>
          <Select value={leewayObjectId} onValueChange={setLeewayObjectId}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEEWAY_OBJECT_TYPES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatBox label="Downwind Direction" value={`${lw.downwindDir.toFixed(1)}°T`} />
          <StatBox
            label="Leeway Speed"
            value={`${lw.leewaySpeed.toFixed(3)} kts`}
            accent
            valueNode={(
              <TableValue
                request={{
                  docId: 'appendix-i',
                  page: leewayTableGroupKey(objectType) === 'I-2' ? 4 : 3,
                  tableId: 'I-1',
                  groupKey: leewayTableGroupKey(objectType),
                  rowKey: objectType.id,
                  colKey: 'multiplier',
                  sourceLabel: 'Worksheet Datum — Leeway (Table I-1/I-2)',
                  currentValue: objectType.leewayRate,
                  currentValueLabel: `${objectType.label} — multiplier ${objectType.leewayRate}`,
                  allowOverride: true,
                  applyRowKey: true,
                  applyOverride: (_value, rowKey) => {
                    // Klik baris kategori pada Table I-1/I-2 → kategori leeway
                    // worksheet berganti (multiplier/modifier/divergensi ikut).
                    if (rowKey && LEEWAY_OBJECT_TYPES.some((t) => t.id === rowKey)) {
                      setLeewayObjectId(rowKey);
                    }
                  },
                }}
                title="Klik untuk buka Table I-1/I-2 — baris kategori aktif berkedip; klik baris lain untuk mengganti kategori"
              >
                {lw.leewaySpeed.toFixed(3)}
              </TableValue>
            )}
          />
          <StatBox
            label="Divergence Angle"
            value={`±${lw.divergenceAngle}°`}
            valueNode={(
              <TableValue
                request={{
                  docId: 'appendix-i',
                  page: leewayTableGroupKey(objectType) === 'I-2' ? 4 : 3,
                  tableId: 'I-1',
                  groupKey: leewayTableGroupKey(objectType),
                  rowKey: objectType.id,
                  colKey: 'divergence',
                  sourceLabel: 'Worksheet Datum — Divergence (Table I-1/I-2)',
                  currentValue: lw.divergenceAngle,
                  currentValueLabel: `±${lw.divergenceAngle}° — ${objectType.label}`,
                  allowOverride: false,
                }}
                title="Klik untuk buka Table I-1/I-2 — baris kategori leeway aktif berkedip (divergence)"
              >
                {`±${lw.divergenceAngle}°`}
              </TableValue>
            )}
          />
          <StatBox label="Leeway Left" value={`${lw.lwLeftDir.toFixed(1)}°T`} accent />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatBox label="Leeway Right" value={`${lw.lwRightDir.toFixed(1)}°T`} accent />
          <StatBox label="Probable Leeway Error (LWe)" value={`${lw.lwError.toFixed(3)} kts`} />
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Total Probable Error of Position (E)"
        description="E = √(X² + De² + Y²)  (Appendix K-31)"
        badge="K-31"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <Label className="text-xs">
              X — Distress craft fix error (NM),{'\u200b'}
              <TableRefText
                request={{
                  docId: 'appendix-j',
                  page: 1,
                  tableId: TABLE_J1_NAV_ERRORS.some((e) => e.errorNm === X) ? 'J-1' : 'J-2',
                  rowKey: [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.errorNm === X)?.id,
                  colKey: 'error',
                  sourceLabel: 'Worksheet Datum — X (Table J-1/J-2)',
                  currentValueLabel: `${X} NM`,
                }}
              >
                Table J-1/J-2
              </TableRefText>
            </Label>
            <Select value="" onValueChange={(id) => { const err = [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.id === id)?.errorNm; if (err !== undefined) setX(err); }}>
              <SelectTrigger className="h-8 mt-1">
                <SelectValue placeholder="Pilih alat navigasi distress craft…" />
              </SelectTrigger>
              <SelectContent>
                {TABLE_J1_NAV_ERRORS.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    J-1 · {e.label} — {e.errorNm} NM
                  </SelectItem>
                ))}
                {TABLE_J2_NAV_ERRORS.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label} — {e.errorNm} NM
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 mt-1">
              <NumberInput value={X} onChange={setX} />
              <TableValue
                request={{
                  docId: 'appendix-j',
                  page: 1,
                  tableId: TABLE_J1_NAV_ERRORS.some((e) => e.errorNm === X) ? 'J-1' : 'J-2',
                  rowKey: [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.errorNm === X)?.id,
                  colKey: 'error',
                  sourceLabel: 'Worksheet Datum — X (fix error distress craft, Table J-1/J-2)',
                  currentValue: X,
                  currentValueLabel: `${X} NM`,
                  allowOverride: true,
                  applyRowKey: true,
                  applyOverride: (_value, rowKey) => {
                    // Klik baris alat navigasi pada Table J-1/J-2 → nilai X dipakai.
                    const entry = [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.id === rowKey);
                    if (entry) setX(entry.errorNm);
                  },
                }}
                title="Klik untuk buka Table J-1/J-2 — klik baris alat navigasi untuk memakai nilainya"
              >
                <span className="text-[10px] font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 whitespace-nowrap">J-1/J-2 ↗</span>
              </TableValue>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">Nilai dari{'\u200b'} <TableRefText request={{ docId: 'appendix-j', page: 1, tableId: 'J-1', rowKey: [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.errorNm === X)?.id, colKey: 'error', sourceLabel: 'Worksheet Datum — X (Table J-1)' , currentValueLabel: `${X} NM`}}>Table J-1</TableRefText> sesuai alat navigasi objek yang disebut soal (mis. GPS → 0.1);{'\u200b'} <TableRefText request={{ docId: 'appendix-j', page: 1, tableId: 'J-2', colKey: 'error', sourceLabel: 'Worksheet Datum — X (Table J-2)' }}>J-2</TableRefText> untuk navigasi tidak diketahui / area praktis (Appendix J). AI mengisi otomatis dari analisis kalimat soal.</p>
          </div>
          <div>
            <Label className="text-xs">
              Y — Search craft fix error (NM),{'\u200b'}
              <TableRefText
                request={{
                  docId: 'appendix-j',
                  page: 1,
                  tableId: TABLE_J1_NAV_ERRORS.some((e) => e.errorNm === Y) ? 'J-1' : 'J-2',
                  rowKey: [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.errorNm === Y)?.id,
                  colKey: 'error',
                  sourceLabel: 'Worksheet Datum — Y (Table J-1/J-2)',
                  currentValueLabel: `${Y} NM`,
                }}
              >
                Table J-1/J-2
              </TableRefText>
            </Label>
            <Select value="" onValueChange={(id) => { const err = [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.id === id)?.errorNm; if (err !== undefined) setY(err); }}>
              <SelectTrigger className="h-8 mt-1">
                <SelectValue placeholder="Pilih alat navigasi SRU…" />
              </SelectTrigger>
              <SelectContent>
                {TABLE_J1_NAV_ERRORS.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    J-1 · {e.label} — {e.errorNm} NM
                  </SelectItem>
                ))}
                {TABLE_J2_NAV_ERRORS.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label} — {e.errorNm} NM
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2 mt-1">
              <NumberInput value={Y} onChange={setY} />
              <TableValue
                request={{
                  docId: 'appendix-j',
                  page: 1,
                  tableId: TABLE_J1_NAV_ERRORS.some((e) => e.errorNm === Y) ? 'J-1' : 'J-2',
                  rowKey: [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.errorNm === Y)?.id,
                  colKey: 'error',
                  sourceLabel: 'Worksheet Datum — Y (fix error search craft, Table J-1/J-2)',
                  currentValue: Y,
                  currentValueLabel: `${Y} NM`,
                  allowOverride: true,
                  applyRowKey: true,
                  applyOverride: (_value, rowKey) => {
                    // Klik baris alat navigasi pada Table J-1/J-2 → nilai Y dipakai.
                    const entry = [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.id === rowKey);
                    if (entry) setY(entry.errorNm);
                  },
                }}
                title="Klik untuk buka Table J-1/J-2 — klik baris alat navigasi untuk memakai nilainya"
              >
                <span className="text-[10px] font-bold text-blue-800 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5 whitespace-nowrap">J-1/J-2 ↗</span>
              </TableValue>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-slate-500">Nilai dari{'\u200b'} <TableRefText request={{ docId: 'appendix-j', page: 1, tableId: 'J-1', rowKey: [...TABLE_J1_NAV_ERRORS, ...TABLE_J2_NAV_ERRORS].find((e) => e.errorNm === Y)?.id, colKey: 'error', sourceLabel: 'Worksheet Datum — Y (Table J-1)', currentValueLabel: `${Y} NM`}}>Table J-1</TableRefText> sesuai alat navigasi SRU pencari yang disebut soal (mis. GPS → 0.1);{'\u200b'} <TableRefText request={{ docId: 'appendix-j', page: 1, tableId: 'J-2', colKey: 'error', sourceLabel: 'Worksheet Datum — Y (Table J-2)' }}>J-2</TableRefText> untuk navigasi tidak diketahui / area praktis (Appendix J). AI mengisi otomatis dari analisis kalimat soal.</p>
          </div>
          <StatBox label="De — Drift Error" value={`${datum.De.toFixed(2)} NM`} />
        </div>
        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200">
          <StatBox label="E² (sum of squared errors)" value={`${e.E2.toFixed(2)} NM²`} />
          <StatBox label="E — Total probable error" value={`${e.E.toFixed(2)} NM`} accent />
          <StatBox label="Separation Ratio (SR)" value={`${(datum.divergenceDistance / Math.max(0.01, e.E)).toFixed(2)}`} />
        </div>
      </WorksheetCard>
    </div>
  );
}

function StatBox({ label, value, accent, valueNode }: { label: string; value: string; accent?: boolean; valueNode?: ReactNode }) {
  return (
    <div className={cn('p-2.5 rounded-md border', accent ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200')}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className="text-sm font-mono font-semibold text-slate-800">{valueNode ?? value}</div>
    </div>
  );
}
