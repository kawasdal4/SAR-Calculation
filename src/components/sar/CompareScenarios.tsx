'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, Plus, GitCompare } from 'lucide-react';
import {
  type LatLng,
  computeWC,
  computeLW,
  computeTWC,
  computeDatum,
  computeE,
  computeEffortAllocation,
  computePOD,
  LEEWAY_OBJECT_TYPES,
  type LeewayObjectType,
  dirToCompass,
} from '@/lib/sar/sarCalculations';
import { cn } from '@/lib/utils';

interface Scenario {
  id: string;
  name: string;
  /** LKP position. */
  start: LatLng;
  /** Drift interval (hours). */
  driftInterval: number;
  /** ASW direction (°T, from). */
  aswDirFrom: number;
  /** ASW speed (kts). */
  aswSpeed: number;
  /** Sea current set (°T) and drift (kts). */
  seaCurrentDir: number;
  seaCurrentSpeed: number;
  /** Leeway object type ID. */
  leewayObjectId: string;
  /** Available search effort (NM²). */
  Zta: number;
  /** Initial position error X (NM). */
  X: number;
  /** Search facility position error Y (NM). */
  Y: number;
}

interface ComputedScenario extends Scenario {
  datumLeft: LatLng;
  datumRight: LatLng;
  E: number;
  Ro: number;
  Ao: number;
  C: number;
  POD: number;
  driftDistance: number;
  divergenceDistance: number;
}

interface CompareScenariosProps {
  /** Base LKP from the main worksheet (used as default for new scenarios). */
  baseLkp: LatLng;
  /** Base ASW direction/speed (used as default for new scenarios). */
  baseAswDirFrom: number;
  baseAswSpeed: number;
}

const DEFAULT_SCENARIOS: Omit<ComputedScenario, never>[] = [];

let nextScenarioId = 1;

export default function CompareScenarios({
  baseLkp,
  baseAswDirFrom,
  baseAswSpeed,
}: CompareScenariosProps) {
  const [scenarios, setScenarios] = useState<Scenario[]>([
    {
      id: 's1',
      name: 'Scenario A — light wind',
      start: { ...baseLkp },
      driftInterval: 6,
      aswDirFrom: baseAswDirFrom,
      aswSpeed: Math.max(8, baseAswSpeed - 6),
      seaCurrentDir: 30,
      seaCurrentSpeed: 0.4,
      leewayObjectId: 'raft-canopy-drogue',
      Zta: 2000,
      X: 2.0,
      Y: 1.5,
    },
    {
      id: 's2',
      name: 'Scenario B — base case',
      start: { ...baseLkp },
      driftInterval: 6,
      aswDirFrom: baseAswDirFrom,
      aswSpeed: baseAswSpeed,
      seaCurrentDir: 30,
      seaCurrentSpeed: 0.5,
      leewayObjectId: 'raft-canopy-drogue',
      Zta: 2000,
      X: 2.0,
      Y: 1.5,
    },
    {
      id: 's3',
      name: 'Scenario C — strong wind',
      start: { ...baseLkp },
      driftInterval: 6,
      aswDirFrom: baseAswDirFrom,
      aswSpeed: baseAswSpeed + 8,
      seaCurrentDir: 30,
      seaCurrentSpeed: 0.7,
      leewayObjectId: 'raft-canopy-drogue',
      Zta: 2000,
      X: 2.0,
      Y: 1.5,
    },
  ]);

  const computed: ComputedScenario[] = useMemo(() => {
    return scenarios.map((s) => computeScenario(s));
  }, [scenarios]);

  const updateScenario = (id: string, patch: Partial<Scenario>) => {
    setScenarios((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const addScenario = () => {
    const newId = `s${nextScenarioId++}`;
    setScenarios((prev) => [
      ...prev,
      {
        id: newId,
        name: `Scenario ${String.fromCharCode(65 + prev.length + 1)}`,
        start: { ...baseLkp },
        driftInterval: 6,
        aswDirFrom: baseAswDirFrom,
        aswSpeed: baseAswSpeed,
        seaCurrentDir: 30,
        seaCurrentSpeed: 0.5,
        leewayObjectId: 'raft-canopy-drogue',
        Zta: 2000,
        X: 2.0,
        Y: 1.5,
      },
    ]);
  };

  const removeScenario = (id: string) => {
    setScenarios((prev) => prev.filter((s) => s.id !== id));
  };

  // Find the best scenario (highest POD)
  const bestScenario = computed.reduce<ComputedScenario | null>(
    (best, s) => (best === null || s.POD > best.POD ? s : best),
    null,
  );

  return (
    <Card className="border-violet-200 shadow-sm">
      <CardHeader className="bg-violet-50 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-violet-600" /> Compare Scenarios
        </CardTitle>
        <CardDescription className="text-xs">
          Run multiple what-if scenarios side-by-side. Compare POD, search radius, and datum positions for different wind/current/object combinations.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {bestScenario && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3">
            <div className="text-[10px] uppercase tracking-wide text-emerald-700 mb-1">
              Best scenario (highest POD)
            </div>
            <div className="text-sm font-semibold text-emerald-900">
              {bestScenario.name} — POD {(bestScenario.POD * 100).toFixed(1)}%
            </div>
            <div className="text-xs text-emerald-700 mt-1">
              Ro = {bestScenario.Ro.toFixed(2)} NM · Ao = {bestScenario.Ao.toFixed(0)} NM² · C = {bestScenario.C.toFixed(2)}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {computed.map((s) => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              isBest={bestScenario?.id === s.id}
              onUpdate={(patch) => updateScenario(s.id, patch)}
              onRemove={() => removeScenario(s.id)}
            />
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={addScenario}>
          <Plus className="h-4 w-4 mr-1" /> Add Scenario
        </Button>
      </CardContent>
    </Card>
  );
}

function computeScenario(s: Scenario): ComputedScenario {
  const objectType: LeewayObjectType =
    LEEWAY_OBJECT_TYPES.find((t) => t.id === s.leewayObjectId) ?? LEEWAY_OBJECT_TYPES[0];

  const wc = computeWC(s.aswDirFrom, s.aswSpeed, Math.abs(s.start.lat), 0.3);
  const lw = computeLW(s.aswDirFrom, s.aswSpeed, objectType);
  const twc = computeTWC({
    seaCurrent: { dir: s.seaCurrentDir, mag: s.seaCurrentSpeed },
    seaCurrentErr: 0.3,
    windCurrent: { dir: wc.wcSet, mag: wc.wcDrift },
    windCurrentErr: wc.wcErr,
  });

  const aswdve = 0.1; // approx
  const datum = computeDatum({
    start: s.start,
    driftInterval: s.driftInterval,
    aswDirFrom: s.aswDirFrom,
    aswSpeed: s.aswSpeed,
    aswdve,
    twc: twc.twc,
    twcErr: twc.twcErr,
    lwLeftDir: lw.lwLeftDir,
    lwRightDir: lw.lwRightDir,
    lwSpeed: lw.leewaySpeed,
    lwErr: lw.lwError,
  });
  const e = computeE({ X: s.X, De: datum.De, Y: s.Y });
  const effort = computeEffortAllocation({
    type: 'leeway-divergence',
    E: e.E,
    Zta: s.Zta,
    DD: datum.divergenceDistance,
  });
  const pod = computePOD(effort.C, 'normal');

  return {
    ...s,
    datumLeft: datum.datumLeft,
    datumRight: datum.datumRight,
    E: e.E,
    Ro: effort.Ro,
    Ao: effort.Ao,
    C: effort.C,
    POD: pod,
    driftDistance: datum.driftDistance,
    divergenceDistance: datum.divergenceDistance,
  };
}

function ScenarioCard({
  scenario,
  isBest,
  onUpdate,
  onRemove,
}: {
  scenario: ComputedScenario;
  isBest: boolean;
  onUpdate: (patch: Partial<Scenario>) => void;
  onRemove: () => void;
}) {
  const obj = LEEWAY_OBJECT_TYPES.find((t) => t.id === scenario.leewayObjectId);
  return (
    <div
      className={cn(
        'rounded-md border p-3 space-y-2',
        isBest ? 'border-emerald-400 bg-emerald-50/50' : 'border-slate-200 bg-white',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <input
          type="text"
          value={scenario.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          className="text-sm font-semibold text-slate-800 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-violet-400 outline-none flex-1" suppressHydrationWarning
        />
        <button
          type="button"
          onClick={onRemove}
          className="text-slate-400 hover:text-red-500 p-1"
          aria-label="Remove scenario"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Inputs */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <div>
          <Label className="text-[10px]">Drift (h)</Label>
          <Input
            type="number"
            value={scenario.driftInterval}
            onChange={(e) => onUpdate({ driftInterval: parseFloat(e.target.value) || 0 })}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">ASW dir (°T)</Label>
          <Input
            type="number"
            value={scenario.aswDirFrom}
            onChange={(e) => onUpdate({ aswDirFrom: parseFloat(e.target.value) || 0 })}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">ASW spd (kt)</Label>
          <Input
            type="number"
            value={scenario.aswSpeed}
            onChange={(e) => onUpdate({ aswSpeed: parseFloat(e.target.value) || 0 })}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">Sea curr (kt)</Label>
          <Input
            type="number"
            value={scenario.seaCurrentSpeed}
            step="0.1"
            onChange={(e) => onUpdate({ seaCurrentSpeed: parseFloat(e.target.value) || 0 })}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">Zta (NM²)</Label>
          <Input
            type="number"
            value={scenario.Zta}
            onChange={(e) => onUpdate({ Zta: parseFloat(e.target.value) || 0 })}
            className="h-7 text-xs"
          />
        </div>
        <div>
          <Label className="text-[10px]">X (NM)</Label>
          <Input
            type="number"
            value={scenario.X}
            step="0.1"
            onChange={(e) => onUpdate({ X: parseFloat(e.target.value) || 0 })}
            className="h-7 text-xs"
          />
        </div>
      </div>
      <div>
        <Label className="text-[10px]">Search object</Label>
        <Select
          value={scenario.leewayObjectId}
          onValueChange={(v) => onUpdate({ leewayObjectId: v })}
        >
          <SelectTrigger className="h-7 text-xs">
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

      {/* Computed results */}
      <div className="grid grid-cols-2 gap-1.5 pt-2 border-t border-slate-200">
        <Stat label="E (NM)" value={scenario.E.toFixed(2)} />
        <Stat label="Drift (NM)" value={scenario.driftDistance.toFixed(2)} />
        <Stat label="DD (NM)" value={scenario.divergenceDistance.toFixed(2)} />
        <Stat label="Ro (NM)" value={scenario.Ro.toFixed(2)} accent />
        <Stat label="C" value={scenario.C.toFixed(2)} />
        <Stat label="POD" value={`${(scenario.POD * 100).toFixed(1)}%`} accent={isBest} />
      </div>

      <div className="text-[10px] text-slate-500">
        Datum L: {scenario.datumLeft.lat.toFixed(3)}, {scenario.datumLeft.lng.toFixed(3)}
        <br />
        Datum R: {scenario.datumRight.lat.toFixed(3)}, {scenario.datumRight.lng.toFixed(3)}
      </div>
      {obj && (
        <div className="text-[10px] text-violet-600 italic">
          {obj.label}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={cn('p-1.5 rounded border', accent ? 'bg-emerald-100 border-emerald-300' : 'bg-slate-50 border-slate-200')}>
      <div className="text-[9px] uppercase text-slate-500">{label}</div>
      <div className="text-xs font-mono font-semibold text-slate-800">{value}</div>
    </div>
  );
}
