'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WorksheetCard, NumberInput } from './WorksheetCard';
import { computeASW, type ASWObservation, dirToCompass } from '@/lib/sar/sarCalculations';
import { cn } from '@/lib/utils';

export interface ASWData {
  aswDirFrom: number;
  aswSpeed: number;
  aswErr: number;
  aswdve: number;
}

export interface ASWInitialState {
  observations?: ASWObservation[];
  aswErr?: number;
}

interface ASWWorksheetProps {
  onDataChange: (data: ASWData) => void;
  /** Fired whenever observations or aswErr changes — used by parent to save state. */
  onStateChange?: (state: { observations: ASWObservation[]; aswErr: number }) => void;
  initialState?: ASWInitialState | null;
}

export default function ASWWorksheet({ onDataChange, onStateChange, initialState }: ASWWorksheetProps) {
  const [observations, setObservations] = useState<ASWObservation[]>(
    () =>
      initialState?.observations ?? [
        { timeStart: '', timeEnd: '', hours: 6, windDirFrom: 90, windSpeed: 18 },
        { timeStart: '', timeEnd: '', hours: 4, windDirFrom: 110, windSpeed: 22 },
      ],
  );
  const [aswErr, setAswErr] = useState<number>(initialState?.aswErr ?? 2.0);

  // Emit full state up to parent for saving
  useEffect(() => {
    onStateChange?.({ observations, aswErr });
  }, [observations, aswErr, onStateChange]);

  const result = useMemo(() => computeASW(observations), [observations]);

  // ASWDVe = ASWe × dV/dW (approximate the derivative of wind current + leeway)
  // For practical purposes: ASWDVe ≈ ASWe × 0.05 (combined wind-current + leeway sensitivity)
  const aswdve = aswErr * 0.05;

  useEffect(() => {
    onDataChange({
      aswDirFrom: result.aswDirFrom,
      aswSpeed: result.aswSpeed,
      aswErr,
      aswdve,
    });
  }, [result, aswErr, aswdve]);

  const update = (idx: number, key: keyof ASWObservation, value: number | string) => {
    setObservations((prev) => prev.map((o, i) => (i === idx ? { ...o, [key]: value } : o)));
  };

  const addRow = () => {
    setObservations((prev) => [...prev, { timeStart: '', timeEnd: '', hours: 2, windDirFrom: 0, windSpeed: 10 }]);
  };

  const removeRow = (idx: number) => {
    setObservations((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <WorksheetCard
      title="Average Surface Wind (ASW)"
      description="Weighted average of surface wind observations over time (Appendix K-19)"
      badge="K-19"
    >
      <p className="text-xs text-slate-600 mb-3 leading-relaxed">
        Setiap observasi angin permukaan diberi bobot oleh jumlah jam berlaku. Kontribusi vektor
        (jam × kecepatan) dijumlahkan dan dibagi total jam untuk mendapatkan kecepatan ASW.
      </p>

      <div className="overflow-x-auto rounded-md border border-slate-200 mb-4">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="text-xs">Time Start</TableHead>
              <TableHead className="text-xs">Time End</TableHead>
              <TableHead className="text-xs">Hours</TableHead>
              <TableHead className="text-xs">Wind From (°T)</TableHead>
              <TableHead className="text-xs">Speed (kts)</TableHead>
              <TableHead className="text-xs">Contribution</TableHead>
              <TableHead className="text-xs w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {observations.map((obs, i) => {
              const r = result.rows[i];
              return (
                <TableRow key={i}>
                  <TableCell>
                    <input
                      type="text"
                      value={obs.timeStart}
                      onChange={(e) => update(i, 'timeStart', e.target.value)}
                      placeholder="06:00Z"
                      className="h-8 w-full px-2 text-xs rounded border border-slate-200 bg-white"
                    />
                  </TableCell>
                  <TableCell>
                    <input
                      type="text"
                      value={obs.timeEnd}
                      onChange={(e) => update(i, 'timeEnd', e.target.value)}
                      placeholder="12:00Z"
                      className="h-8 w-full px-2 text-xs rounded border border-slate-200 bg-white"
                    />
                  </TableCell>
                  <TableCell>
                    <NumberInput value={obs.hours} onChange={(v) => update(i, 'hours', v)} />
                  </TableCell>
                  <TableCell>
                    <NumberInput value={obs.windDirFrom} onChange={(v) => update(i, 'windDirFrom', v)} />
                  </TableCell>
                  <TableCell>
                    <NumberInput value={obs.windSpeed} onChange={(v) => update(i, 'windSpeed', v)} />
                  </TableCell>
                  <TableCell className="text-xs font-mono text-slate-600">
                    {r ? `${r.contribution.dir.toFixed(0)}°T / ${r.contribution.mag.toFixed(1)}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeRow(i)}
                      className="h-7 w-7 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Button variant="outline" size="sm" onClick={addRow} className="mb-4">
        <Plus className="h-4 w-4 mr-1" /> Add Surface Wind Observation
      </Button>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-slate-200 mb-3">
        <StatBox label="Total Hours" value={`${result.totalHours.toFixed(1)} h`} />
        <StatBox label="ASW Direction" value={`${result.aswDirFrom.toFixed(1)}°T (${dirToCompass(result.aswDirFrom)})`} accent />
        <StatBox label="ASW Speed" value={`${result.aswSpeed.toFixed(2)} kts`} accent />
      </div>

      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
        <div>
          <label className="text-[10px] uppercase tracking-wide text-slate-500 block mb-1">
            Probable error of ASW (ASWe, kts)
          </label>
          <NumberInput value={aswErr} onChange={setAswErr} />
        </div>
        <StatBox
          label="ASWDVe (drift vel error due to ASW)"
          value={`${aswdve.toFixed(3)} kts`}
          accent
        />
      </div>
    </WorksheetCard>
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
