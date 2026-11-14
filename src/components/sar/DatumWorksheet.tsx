'use client';

import { useState, useMemo, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { WorksheetCard, NumberInput } from './WorksheetCard';
import {
  computeWC,
  computeLW,
  computeTWC,
  computeDatum,
  computeE,
  LEEWAY_OBJECT_TYPES,
  type LeewayObjectType,
  type LatLng,
  type Vector,
  dirToCompass,
} from '@/lib/sar/sarCalculations';
import { cn } from '@/lib/utils';

export interface DatumData {
  start: LatLng;
  driftInterval: number;
  aswDirFrom: number;
  aswSpeed: number;
  aswdve: number;
  twc: Vector;
  twcErr: number;
  lwLeftDir: number;
  lwRightDir: number;
  lwSpeed: number;
  lwErr: number;
}

export interface DatumResults {
  datumLeft: LatLng;
  datumRight: LatLng;
  divergenceDistance: number;
  driftDistance: number;
  dve: number;
  De: number;
  E: number;
  wc: ReturnType<typeof computeWC>;
  lw: ReturnType<typeof computeLW>;
  twc: ReturnType<typeof computeTWC>;
}

interface DatumWorksheetProps {
  aswDirFrom: number;
  aswSpeed: number;
  aswErr: number;
  aswdve: number;
  onResults: (results: DatumResults | null) => void;
  onDataChange: (data: DatumData | null) => void;
}

export default function DatumWorksheet({
  aswDirFrom,
  aswSpeed,
  aswErr,
  aswdve,
  onResults,
  onDataChange,
}: DatumWorksheetProps) {
  const [startLat, setStartLat] = useState<number>(-6.1);
  const [startLng, setStartLng] = useState<number>(106.8);
  const [driftInterval, setDriftInterval] = useState<number>(6);
  const [latitude, setLatitude] = useState<number>(Math.abs(-6.1));
  const [seaCurrentDir, setSeaCurrentDir] = useState<number>(30);
  const [seaCurrentSpeed, setSeaCurrentSpeed] = useState<number>(0.5);
  const [seaCurrentErr, setSeaCurrentErr] = useState<number>(0.3);
  const [leewayObjectId, setLeewayObjectId] = useState<string>('raft-canopy-drogue');
  const [X, setX] = useState<number>(2.0);
  const [Y, setY] = useState<number>(1.5);

  const objectType: LeewayObjectType =
    LEEWAY_OBJECT_TYPES.find((t) => t.id === leewayObjectId) ?? LEEWAY_OBJECT_TYPES[0];

  const wc = useMemo(
    () => computeWC(aswDirFrom, aswSpeed, latitude, 0.3),
    [aswDirFrom, aswSpeed, latitude],
  );
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

  useEffect(() => {
    const data: DatumData = {
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
    };
    onDataChange(data);
    onResults({
      datumLeft: datum.datumLeft,
      datumRight: datum.datumRight,
      divergenceDistance: datum.divergenceDistance,
      driftDistance: datum.driftDistance,
      dve: datum.dve,
      De: datum.De,
      E: e.E,
      wc,
      lw,
      twc,
    });
  }, [start, driftInterval, aswDirFrom, aswSpeed, aswdve, twc, lw, datum, e, wc]);

  return (
    <div className="space-y-4">
      <WorksheetCard
        title="Starting Position & Drift Interval"
        description="Last known position, estimated incident position, or previous datum"
        badge="K-13 A/B"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">Latitude (°)</Label>
            <NumberInput value={startLat} onChange={setStartLat} />
            <p className="text-[10px] text-slate-400 mt-1">N = +, S = −</p>
          </div>
          <div>
            <Label className="text-xs">Longitude (°)</Label>
            <NumberInput value={startLng} onChange={setStartLng} />
            <p className="text-[10px] text-slate-400 mt-1">E = +, W = −</p>
          </div>
          <div>
            <Label className="text-xs">Drift Interval (hours)</Label>
            <NumberInput value={driftInterval} onChange={setDriftInterval} />
            <p className="text-[10px] text-slate-400 mt-1">LKP time → commence search time</p>
          </div>
          <div>
            <Label className="text-xs">|Latitude| for WC divergence (°)</Label>
            <NumberInput value={latitude} onChange={setLatitude} />
            <p className="text-[10px] text-slate-400 mt-1">For figure N-1 divergence lookup</p>
          </div>
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Wind Current (WC)"
        description="Local wind-generated surface current (Appendix K-26, fig N-1)"
        badge="K-26"
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
            <Label className="text-xs">Sea Current Set (°T)</Label>
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
          <StatBox label="Leeway Speed" value={`${lw.leewaySpeed.toFixed(3)} kts`} accent />
          <StatBox label="Divergence Angle" value={`±${lw.divergenceAngle}°`} />
          <StatBox label="Leeway Left" value={`${lw.lwLeftDir.toFixed(1)}°T`} accent />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatBox label="Leeway Right" value={`${lw.lwRightDir.toFixed(1)}°T`} accent />
          <StatBox label="Probable Leeway Error (LWe)" value={`${lw.lwError.toFixed(3)} kts`} />
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Datum Position (Marine Environment)"
        description="Combine TWC + Leeway vectors to compute datum positions (Appendix K-13)"
        badge="K-13"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <StatBox label="Drift Direction (Left)" value={`${datum.driftLeftDir.toFixed(1)}°T`} accent />
          <StatBox label="Drift Direction (Right)" value={`${datum.driftRightDir.toFixed(1)}°T`} accent />
          <StatBox label="Drift Speed" value={`${datum.driftSpeed.toFixed(3)} kts`} />
          <StatBox label="Drift Distance" value={`${datum.driftDistance.toFixed(2)} NM`} accent />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <StatBox label="Datum (Left of Downwind)" value={`${datum.datumLeft.lat.toFixed(4)}, ${datum.datumLeft.lng.toFixed(4)}`} accent />
          <StatBox label="Datum (Right of Downwind)" value={`${datum.datumRight.lat.toFixed(4)}, ${datum.datumRight.lng.toFixed(4)}`} accent />
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
          <StatBox label="Divergence Distance (DD)" value={`${datum.divergenceDistance.toFixed(2)} NM`} />
          <StatBox label="DVe (drift velocity error)" value={`${datum.dve.toFixed(3)} kts`} />
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Total Probable Error of Position (E)"
        description="E = √(X² + De² + Y²)  (Appendix K-31)"
        badge="K-31"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <Label className="text-xs">X — Initial position error (NM)</Label>
            <NumberInput value={X} onChange={setX} />
          </div>
          <div>
            <Label className="text-xs">Y — Search facility position error (NM)</Label>
            <NumberInput value={Y} onChange={setY} />
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

function StatBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn('p-2.5 rounded-md border', accent ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200')}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      <div className="text-sm font-mono font-semibold text-slate-800">{value}</div>
    </div>
  );
}
