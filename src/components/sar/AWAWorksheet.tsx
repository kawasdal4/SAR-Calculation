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
import { computeAWA, type AWAObservation, dirToCompass } from '@/lib/sar/sarCalculations';
import { cn } from '@/lib/utils';

export interface AWAData {
  aswDirFrom: number;
  aswSpeed: number;
}

export interface AWAInitialState {
  observations?: AWAObservation[];
}

interface AWAWorksheetProps {
  onDataChange: (data: AWAData) => void;
  /** Fired whenever observations array changes — used by parent to save state. */
  onObservationsChange?: (observations: AWAObservation[]) => void;
  initialState?: AWAInitialState | null;
}

export default function AWAWorksheet({ onDataChange, onObservationsChange, initialState }: AWAWorksheetProps) {
  const [observations, setObservations] = useState<AWAObservation[]>(
    () =>
      initialState?.observations ?? [
        { altLow: 0, altHigh: 2000, windDirFrom: 45, windSpeed: 15 },
        { altLow: 2000, altHigh: 4000, windDirFrom: 50, windSpeed: 18 },
        { altLow: 4000, altHigh: 6000, windDirFrom: 60, windSpeed: 22 },
      ],
  );

  // Emit observations up to parent for state-saving
  useEffect(() => {
    onObservationsChange?.(observations);
  }, [observations, onObservationsChange]);

  const result = useMemo(() => computeAWA(observations), [observations]);

  const emit = (obs: AWAObservation[]) => {
    const r = computeAWA(obs);
    onDataChange({ aswDirFrom: r.awaDirFrom, aswSpeed: r.awaSpeed });
  };

  const update = (idx: number, key: keyof AWAObservation, value: number) => {
    const next = observations.map((o, i) => (i === idx ? { ...o, [key]: value } : o));
    setObservations(next);
    emit(next);
  };

  const addRow = () => {
    const last = observations[observations.length - 1];
    const newLow = last ? last.altHigh : 0;
    const next = [...observations, { altLow: newLow, altHigh: newLow + 2000, windDirFrom: 0, windSpeed: 10 }];
    setObservations(next);
    emit(next);
  };

  const removeRow = (idx: number) => {
    const next = observations.filter((_, i) => i !== idx);
    setObservations(next);
    emit(next);
  };

  return (
    <WorksheetCard
      title="Average Wind Aloft (AWA)"
      description="Weighted average of wind velocity vectors across altitude intervals (Appendix K-10)"
      badge="K-10"
    >
      <p className="text-xs text-slate-600 mb-3 leading-relaxed">
        Setiap observasi angin diberi bobot berdasarkan interval ketinggian (dalam ribuan kaki).
        Vektor kontribusi (kecepatan × ribuan kaki) dijumlahkan dan dibagi dengan total altitude loss
        untuk mendapatkan kecepatan AWA. Arah adalah rata-rata arah vektor resultan.
      </p>

      <div className="overflow-x-auto rounded-md border border-slate-200 mb-4">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="text-xs">Altitude Low (ft)</TableHead>
              <TableHead className="text-xs">Altitude High (ft)</TableHead>
              <TableHead className="text-xs">Δ Alt (kft)</TableHead>
              <TableHead className="text-xs">Wind From (°T)</TableHead>
              <TableHead className="text-xs">Wind Speed (kts)</TableHead>
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
                    <NumberInput value={obs.altLow} onChange={(v) => update(i, 'altLow', v)} />
                  </TableCell>
                  <TableCell>
                    <NumberInput value={obs.altHigh} onChange={(v) => update(i, 'altHigh', v)} />
                  </TableCell>
                  <TableCell className="text-xs font-mono text-slate-600">
                    {r ? r.altitudeKft.toFixed(2) : '—'}
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
        <Plus className="h-4 w-4 mr-1" /> Add Wind Observation
      </Button>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-200">
        <StatBox label="Total Alt Loss" value={`${result.totalAltLossKft.toFixed(2)} kft`} />
        <StatBox label="Total Wind Vector" value={`${result.totalWindVector.dir.toFixed(1)}°T / ${result.totalWindVector.mag.toFixed(1)}`} accent />
        <StatBox label="AWA Direction" value={`${result.awaDirFrom.toFixed(1)}°T (${dirToCompass(result.awaDirFrom)})`} accent />
        <StatBox label="AWA Speed" value={`${result.awaSpeed.toFixed(2)} kts`} accent />
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
