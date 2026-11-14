'use client';

import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { WorksheetCard, NumberInput } from './WorksheetCard';
import {
  computeSweepWidth,
  computeTotalSearchEffort,
  computeEffortAllocation,
  computePOD,
  type SearchFacilityType,
  type SearchObjectCategory,
  type DatumType,
  type SearchConditions,
  type SearchFacilityInput,
  type LatLng,
  dirToCompass,
} from '@/lib/sar/sarCalculations';
import { cn } from '@/lib/utils';

export interface SearchPlanResults {
  E: number;
  Zta: number;
  Ro: number;
  Ao: number;
  C: number;
  fs: number;
  Zrc: number;
  POD: number;
  searchAreaCenter: LatLng;
  searchAreaLength: number;
  searchAreaWidth: number;
  orientationDeg: number;
  trackSpacing: number;
}

interface SearchPlanWorksheetProps {
  E: number;
  datumLeft: LatLng;
  datumRight: LatLng;
  divergenceDistance: number;
  driftLeftDir: number;
  aswDirFrom: number;
  onResults: (results: SearchPlanResults | null) => void;
}

type FacilityRow = SearchFacilityInput;

const FACILITY_LABELS: Record<SearchFacilityType, string> = {
  'merchant-vessel': 'Merchant vessel',
  'fixed-wing-aircraft': 'Fixed-wing aircraft',
  helicopter: 'Helicopter',
  'small-vessel': 'Small vessel',
  lifeboat: 'Lifeboat / rescue boat',
};

const OBJECT_LABELS: Record<SearchObjectCategory, string> = {
  'person-in-water': 'Person in water (PIW)',
  'raft-1-4-person': '1-4 person liferaft',
  'raft-6-person': '6-person liferaft',
  'raft-15-25-person': '15-25 person liferaft',
  'small-fishing-vessel': 'Small fishing vessel (<15m)',
  'merchant-vessel': 'Merchant vessel',
  sailboat: 'Sailboat',
  'aircraft-debris': 'Aircraft wreckage / debris',
};

export default function SearchPlanWorksheet({
  E,
  datumLeft,
  datumRight,
  divergenceDistance,
  driftLeftDir,
  aswDirFrom,
  onResults,
}: SearchPlanWorksheetProps) {
  const [facilityType, setFacilityType] = useState<SearchFacilityType>('fixed-wing-aircraft');
  const [searchObject, setSearchObject] = useState<SearchObjectCategory>('raft-6-person');
  const [visibility, setVisibility] = useState<number>(10);
  const [windSpeed, setWindSpeed] = useState<number>(15);
  const [altitudeFt, setAltitudeFt] = useState<number>(1000);
  const [conditions, setConditions] = useState<SearchConditions>('normal');
  const [datumType, setDatumType] = useState<DatumType>('leeway-divergence');
  const [facilities, setFacilities] = useState<FacilityRow[]>([
    {
      id: '1',
      name: 'SAR Aircraft #1',
      speed: 150,
      endurance: 5,
      daylightHours: 8,
      W: 0,
    },
    {
      id: '2',
      name: 'SAR Vessel #1',
      speed: 12,
      endurance: 12,
      daylightHours: 8,
      W: 0,
    },
  ]);

  const sweep = useMemo(
    () =>
      computeSweepWidth({
        facility: facilityType,
        object: searchObject,
        visibility,
        windSpeed,
        altitudeFt,
      }),
    [facilityType, searchObject, visibility, windSpeed, altitudeFt],
  );

  // Apply sweep width to all facility rows (simplified: all use same W)
  const facilitiesWithW = useMemo(
    () => facilities.map((f) => ({ ...f, W: sweep.W })),
    [facilities, sweep.W],
  );

  const { perFacility, Zta } = useMemo(
    () => computeTotalSearchEffort(facilitiesWithW),
    [facilitiesWithW],
  );

  const effort = useMemo(
    () =>
      computeEffortAllocation({
        type: datumType,
        E,
        Zta,
        DD: divergenceDistance,
        L: divergenceDistance,
      }),
    [datumType, E, Zta, divergenceDistance],
  );

  const POD = useMemo(() => computePOD(effort.C, conditions), [effort.C, conditions]);

  // Compute search area center: midpoint between left and right datum (leeway-divergence)
  // or just datumLeft (point), or along datum line (line datum)
  const searchAreaCenter: LatLng = useMemo(() => {
    if (datumType === 'point') return datumLeft;
    return {
      lat: (datumLeft.lat + datumRight.lat) / 2,
      lng: (datumLeft.lng + datumRight.lng) / 2,
    };
  }, [datumType, datumLeft, datumRight]);

  const searchAreaLength = useMemo(() => {
    if (datumType === 'point') return 2 * effort.Ro;
    if (datumType === 'leeway-divergence') return 2 * effort.Ro + divergenceDistance;
    return divergenceDistance + 2 * effort.Ro;
  }, [datumType, effort.Ro, divergenceDistance]);

  const searchAreaWidth = 2 * effort.Ro;

  // Orientation: along drift direction (search legs parallel to drift)
  const orientationDeg = driftLeftDir;
  const trackSpacing = sweep.W / Math.max(0.01, effort.C);

  useEffect(() => {
    onResults({
      E,
      Zta,
      Ro: effort.Ro,
      Ao: effort.Ao,
      C: effort.C,
      fs: effort.fs,
      Zrc: effort.Zrc,
      POD,
      searchAreaCenter,
      searchAreaLength,
      searchAreaWidth,
      orientationDeg,
      trackSpacing,
    });
  }, [E, Zta, effort, POD, searchAreaCenter, searchAreaLength, orientationDeg, trackSpacing, onResults]);

  const updateFacility = (idx: number, key: keyof FacilityRow, value: number | string) => {
    setFacilities((prev) => prev.map((f, i) => (i === idx ? { ...f, [key]: value } : f)));
  };

  const addFacility = () => {
    setFacilities((prev) => [
      ...prev,
      {
        id: String(prev.length + 1),
        name: `SAR Unit #${prev.length + 1}`,
        speed: 100,
        endurance: 4,
        daylightHours: 8,
        W: 0,
      },
    ]);
  };

  const removeFacility = (idx: number) => {
    setFacilities((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <WorksheetCard
        title="Sweep Width (W)"
        description="Effective detection width based on facility, search object, and conditions (Appendix N-4..N-8)"
        badge="L-8..12"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <Label className="text-xs">Search Facility Type</Label>
            <Select value={facilityType} onValueChange={(v) => setFacilityType(v as SearchFacilityType)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FACILITY_LABELS) as SearchFacilityType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {FACILITY_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Search Object</Label>
            <Select value={searchObject} onValueChange={(v) => setSearchObject(v as SearchObjectCategory)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(OBJECT_LABELS) as SearchObjectCategory[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {OBJECT_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Meteorological Visibility (NM)</Label>
            <NumberInput value={visibility} onChange={setVisibility} />
          </div>
          <div>
            <Label className="text-xs">Wind Speed (kts)</Label>
            <NumberInput value={windSpeed} onChange={setWindSpeed} />
          </div>
          <div>
            <Label className="text-xs">Search Altitude (ft) — aircraft only</Label>
            <NumberInput value={altitudeFt} onChange={setAltitudeFt} />
          </div>
          <div>
            <Label className="text-xs">Search Conditions</Label>
            <Select value={conditions} onValueChange={(v) => setConditions(v as SearchConditions)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ideal">Ideal (calm, vis &gt; 20NM)</SelectItem>
                <SelectItem value="normal">Normal (any other)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-3 border-t border-slate-200">
          <StatBox label="Wu (uncorrected)" value={`${sweep.Wu.toFixed(2)}`} />
          <StatBox label="fw (weather)" value={sweep.fw.toFixed(2)} />
          <StatBox label="fv (velocity)" value={sweep.fv.toFixed(2)} />
          <StatBox label="ff (fatigue)" value={sweep.ff.toFixed(2)} />
          <StatBox label="W (corrected)" value={`${sweep.W.toFixed(2)} NM`} accent />
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Total Available Search Effort (Zta)"
        description="Sum of search effort Z = V × T × W from all facilities (Appendix L-1)"
        badge="L-1"
      >
        <div className="overflow-x-auto rounded-md border border-slate-200 mb-4">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="text-xs">Facility</TableHead>
                <TableHead className="text-xs">Speed (kts)</TableHead>
                <TableHead className="text-xs">On-scene Endurance (h)</TableHead>
                <TableHead className="text-xs">Daylight (h)</TableHead>
                <TableHead className="text-xs">T (search endurance)</TableHead>
                <TableHead className="text-xs">W (NM)</TableHead>
                <TableHead className="text-xs">Z (NM²)</TableHead>
                <TableHead className="text-xs w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perFacility.map((r, i) => (
                <TableRow key={r.facility.id}>
                  <TableCell>
                    <input
                      type="text"
                      value={r.facility.name}
                      onChange={(e) => updateFacility(i, 'name', e.target.value)}
                      className="h-8 w-full px-2 text-xs rounded border border-slate-200 bg-white"
                    />
                  </TableCell>
                  <TableCell>
                    <NumberInput value={r.facility.speed} onChange={(v) => updateFacility(i, 'speed', v)} />
                  </TableCell>
                  <TableCell>
                    <NumberInput value={r.facility.endurance} onChange={(v) => updateFacility(i, 'endurance', v)} />
                  </TableCell>
                  <TableCell>
                    <NumberInput value={r.facility.daylightHours} onChange={(v) => updateFacility(i, 'daylightHours', v)} />
                  </TableCell>
                  <TableCell className="text-xs font-mono text-slate-600">{r.T.toFixed(2)}</TableCell>
                  <TableCell className="text-xs font-mono text-slate-600">{sweep.W.toFixed(2)}</TableCell>
                  <TableCell className="text-xs font-mono font-semibold text-emerald-700">{r.Z.toFixed(0)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFacility(i)}
                      className="h-7 w-7 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button variant="outline" size="sm" onClick={addFacility} className="mb-3">
          <Plus className="h-4 w-4 mr-1" /> Add Facility
        </Button>

        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
          <StatBox label="Total Available Search Effort (Zta)" value={`${Zta.toFixed(0)} NM²`} accent />
          <StatBox label="Number of Facilities" value={`${perFacility.length}`} />
        </div>
      </WorksheetCard>

      <WorksheetCard
        title="Effort Allocation"
        description="Optimal search area using fs lookup (figures N-5..N-8). Single point / leeway divergence / line datum"
        badge="L-7"
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          <div>
            <Label className="text-xs">Datum Type</Label>
            <Select value={datumType} onValueChange={(v) => setDatumType(v as DatumType)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="point">Single point datum</SelectItem>
                <SelectItem value="leeway-divergence">Leeway divergence (2 datums)</SelectItem>
                <SelectItem value="line">Line datum</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <StatBox label="Effort Factor (fZ)" value={`${effort.fZ.toFixed(2)}`} />
          <StatBox label="Relative Effort (Zr)" value={effort.Zr.toFixed(2)} />
          <StatBox label="Cumulative Rel. Effort (Zrc)" value={effort.Zrc.toFixed(2)} accent />
          <StatBox label="Optimal Search Factor (fs)" value={effort.fs.toFixed(2)} accent />
          <StatBox label="Optimal Search Radius (Ro)" value={`${effort.Ro.toFixed(2)} NM`} accent />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-200">
          <StatBox label="Optimal Area (Ao)" value={`${effort.Ao.toFixed(0)} NM²`} accent />
          <StatBox label="Coverage Factor (C)" value={effort.C.toFixed(2)} />
          <StatBox label="POD (probability of detection)" value={`${(POD * 100).toFixed(1)}%`} accent />
          <StatBox label="Track Spacing (S = W/C)" value={`${trackSpacing.toFixed(2)} NM`} />
        </div>

        {effort.SR !== null && (
          <div className="mt-3 grid grid-cols-1 gap-3 pt-3 border-t border-slate-200">
            <StatBox
              label="Separation Ratio (SR = DD/E)"
              value={`${effort.SR.toFixed(2)} ${effort.SR > 4 ? '(>4 — consider separate point datums)' : '(≤4 — treat as combined)'}`}
            />
          </div>
        )}
      </WorksheetCard>

      <WorksheetCard
        title="Search Area Geometry"
        description="Plotting the adjusted search rectangle on the chart"
        badge="L-13"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
          <StatBox label="Center Latitude" value={searchAreaCenter.lat.toFixed(4)} />
          <StatBox label="Center Longitude" value={searchAreaCenter.lng.toFixed(4)} />
          <StatBox label="Length" value={`${searchAreaLength.toFixed(2)} NM`} accent />
          <StatBox label="Width" value={`${searchAreaWidth.toFixed(2)} NM`} accent />
        </div>
        <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-200">
          <StatBox
            label="Orientation (along drift)"
            value={`${orientationDeg.toFixed(1)}°T (${dirToCompass(orientationDeg)})`}
          />
          <StatBox label="Track Spacing (assignable)" value={`${trackSpacing.toFixed(2)} NM`} />
        </div>
        <p className="text-xs text-slate-500 mt-3 leading-relaxed">
          Search legs harus sejajar dengan arah pergerakan objek selama pencarian
          (lihat IAMSAR Vol II §4.7.7(d) dan §5.9).
        </p>
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
