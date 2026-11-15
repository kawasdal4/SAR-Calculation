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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Plus, Trash2, Plane, Ship, CheckCircle2, XCircle, Award } from 'lucide-react';
import {
  type SruInput,
  type AssetType,
  type EngineType,
  type TafType,
  calculateAllSrus,
  findOptimalCombinations,
  totalSweepArea,
  type SruCalculation,
} from '@/lib/sar/assetAllocation';
import { cn } from '@/lib/utils';

const DEFAULT_SRUS: SruInput[] = [
  {
    id: 'A',
    name: 'SRU A',
    callSign: 'C/S SRU 1',
    assetType: 'air',
    engineType: 'piston',
    enduranceMin: 240,
    speedTas: 150,
    searchSpeed: 120,
    transitGoNm: 40,
    transitBackNm: 55,
    trackSpacing: 2,
    tafType: 'cerah',
  },
  {
    id: 'B',
    name: 'SRU B',
    callSign: 'C/S SRU 2',
    assetType: 'air',
    engineType: 'piston',
    enduranceMin: 240,
    speedTas: 150,
    searchSpeed: 120,
    transitGoNm: 60,
    transitBackNm: 85,
    trackSpacing: 2,
    tafType: 'cerah',
  },
  {
    id: 'C',
    name: 'SRU C',
    callSign: 'C/S SRU 3',
    assetType: 'air',
    engineType: 'piston',
    enduranceMin: 280,
    speedTas: 180,
    searchSpeed: 120,
    transitGoNm: 75,
    transitBackNm: 115,
    trackSpacing: 2,
    tafType: 'cerah',
  },
  {
    id: 'H',
    name: 'SRU H',
    callSign: 'Heli',
    assetType: 'air',
    engineType: 'turbine',
    enduranceMin: 360,
    speedTas: 180,
    searchSpeed: 90,
    transitGoNm: 40,
    transitBackNm: 70,
    trackSpacing: 2,
    tafType: 'cerah',
  },
];

export default function AssetAllocationWorksheet() {
  const [srus, setSrus] = useState<SruInput[]>(DEFAULT_SRUS);
  const [areaLength, setAreaLength] = useState(80);
  const [areaWidth, setAreaWidth] = useState(20);
  const [targetArea, setTargetArea] = useState(1600);
  const [useDimensions, setUseDimensions] = useState(true);

  // Auto-calculate target area from dimensions
  const effectiveTargetArea = useDimensions ? areaLength * areaWidth : targetArea;

  // Calculate all SRUs
  const calculations = useMemo(() => calculateAllSrus(srus), [srus]);

  // Total capacity
  const totalCapacity = useMemo(() => totalSweepArea(calculations), [calculations]);

  // Find optimal combinations
  const combinations = useMemo(
    () => findOptimalCombinations(calculations, effectiveTargetArea, 1, srus.length),
    [calculations, effectiveTargetArea, srus.length],
  );

  // Recommendation
  const recommendation = combinations.find((c) => c.isSufficient) ?? null;
  const allSufficient = combinations.filter((c) => c.isSufficient);

  const updateSru = (id: string, field: keyof SruInput, value: string | number) => {
    setSrus((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, [field]: value } : s,
      ),
    );
  };

  const addSru = () => {
    const id = String.fromCharCode(65 + srus.length); // A, B, C, ...
    setSrus([
      ...srus,
      {
        id,
        name: `SRU ${id}`,
        callSign: '',
        assetType: 'air',
        engineType: 'piston',
        enduranceMin: 240,
        speedTas: 150,
        searchSpeed: 120,
        transitGoNm: 50,
        transitBackNm: 50,
        trackSpacing: 2,
        tafType: 'cerah',
      },
    ]);
  };

  const removeSru = (id: string) => {
    setSrus((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="space-y-4">
      {/* Search Area Input */}
      <Card className="border-violet-200 shadow-sm">
        <CardHeader className="bg-violet-50 pb-3">
          <CardTitle className="text-base">SAR Assets Allocation — Target Area</CardTitle>
          <CardDescription className="text-xs">
            Hitung luas area pencarian dan bandingkan dengan kapasitas sweep area SRU
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-[10px]">Mode</Label>
              <div className="flex gap-1 mt-1">
                <Button
                  size="sm"
                  variant={useDimensions ? 'default' : 'outline'}
                  onClick={() => setUseDimensions(true)}
                  className="h-7 text-xs"
                >
                  L × W
                </Button>
                <Button
                  size="sm"
                  variant={!useDimensions ? 'default' : 'outline'}
                  onClick={() => setUseDimensions(false)}
                  className="h-7 text-xs"
                >
                  Direct NM²
                </Button>
              </div>
            </div>
            {useDimensions ? (
              <>
                <div>
                  <Label className="text-[10px]">Panjang Area (NM)</Label>
                  <Input
                    type="number"
                    value={areaLength}
                    onChange={(e) => setAreaLength(parseFloat(e.target.value) || 0)}
                    className="h-8 w-24 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px]">Lebar Area (NM)</Label>
                  <Input
                    type="number"
                    value={areaWidth}
                    onChange={(e) => setAreaWidth(parseFloat(e.target.value) || 0)}
                    className="h-8 w-24 text-xs"
                  />
                </div>
                <div className="text-xs text-slate-600">
                  = <span className="font-mono font-bold text-violet-700">{effectiveTargetArea.toFixed(0)} NM²</span>
                </div>
              </>
            ) : (
              <div>
                <Label className="text-[10px]">Target Area (NM²)</Label>
                <Input
                  type="number"
                  value={targetArea}
                  onChange={(e) => setTargetArea(parseFloat(e.target.value) || 0)}
                  className="h-8 w-32 text-xs"
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* SRU Table */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50 pb-3">
          <CardTitle className="text-sm">SRU Data Input</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-[10px]">SRU</TableHead>
                  <TableHead className="text-[10px]">Tipe</TableHead>
                  <TableHead className="text-[10px]">Mesin</TableHead>
                  <TableHead className="text-[10px]">E (min)</TableHead>
                  <TableHead className="text-[10px]">V TAS (kts)</TableHead>
                  <TableHead className="text-[10px]">V search (kts)</TableHead>
                  <TableHead className="text-[10px]">Tr Go (NM)</TableHead>
                  <TableHead className="text-[10px]">Tr Back (NM)</TableHead>
                  <TableHead className="text-[10px]">S (NM)</TableHead>
                  <TableHead className="text-[10px]">TAF</TableHead>
                  <TableHead className="text-[10px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {srus.map((sru) => (
                  <TableRow key={sru.id}>
                    <TableCell>
                      <Input
                        type="text"
                        value={sru.name}
                        onChange={(e) => updateSru(sru.id, 'name', e.target.value)}
                        className="h-7 w-20 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={sru.assetType}
                        onValueChange={(v) => updateSru(sru.id, 'assetType', v as AssetType)}
                      >
                        <SelectTrigger className="h-7 w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="air">
                            <span className="flex items-center gap-1"><Plane className="h-3 w-3" /> Air</span>
                          </SelectItem>
                          <SelectItem value="maritime">
                            <span className="flex items-center gap-1"><Ship className="h-3 w-3" /> Maritime</span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={sru.engineType}
                        onValueChange={(v) => updateSru(sru.id, 'engineType', v as EngineType)}
                        disabled={sru.assetType === 'maritime'}
                      >
                        <SelectTrigger className="h-7 w-24 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="piston">Piston</SelectItem>
                          <SelectItem value="turbine">Turbine</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={sru.enduranceMin} onChange={(e) => updateSru(sru.id, 'enduranceMin', parseFloat(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={sru.speedTas} onChange={(e) => updateSru(sru.id, 'speedTas', parseFloat(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={sru.searchSpeed} onChange={(e) => updateSru(sru.id, 'searchSpeed', parseFloat(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={sru.transitGoNm} onChange={(e) => updateSru(sru.id, 'transitGoNm', parseFloat(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={sru.transitBackNm} onChange={(e) => updateSru(sru.id, 'transitBackNm', parseFloat(e.target.value) || 0)} className="h-7 w-16 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input type="number" value={sru.trackSpacing} onChange={(e) => updateSru(sru.id, 'trackSpacing', parseFloat(e.target.value) || 0)} className="h-7 w-14 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={sru.tafType}
                        onValueChange={(v) => updateSru(sru.id, 'tafType', v as TafType)}
                        disabled={sru.assetType === 'maritime'}
                      >
                        <SelectTrigger className="h-7 w-20 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cerah">Cerah (0')</SelectItem>
                          <SelectItem value="inter">INTER (30')</SelectItem>
                          <SelectItem value="tempo">TEMPO (60')</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeSru(sru.id)} className="h-7 w-7 text-slate-400 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button variant="outline" size="sm" onClick={addSru} className="mt-3">
            <Plus className="h-4 w-4 mr-1" /> Add SRU
          </Button>
        </CardContent>
      </Card>

      {/* Per-SRU Calculation Results */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="bg-slate-50 pb-3">
          <CardTitle className="text-sm">Per-SRU Calculation (EST Worksheet)</CardTitle>
          <CardDescription className="text-xs">
            TSF → OSE → EST → Sweep Area untuk setiap SRU
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-[10px]">SRU</TableHead>
                  <TableHead className="text-[10px]">Tr Go (min)</TableHead>
                  <TableHead className="text-[10px]">Tr Back (min)</TableHead>
                  <TableHead className="text-[10px]">Total Tr</TableHead>
                  <TableHead className="text-[10px]">Var Transit</TableHead>
                  <TableHead className="text-[10px]">Reserve</TableHead>
                  <TableHead className="text-[10px]">TAF</TableHead>
                  <TableHead className="text-[10px] font-bold">TSF (min)</TableHead>
                  <TableHead className="text-[10px]">OSE (min)</TableHead>
                  <TableHead className="text-[10px]">OSE (hrs)</TableHead>
                  <TableHead className="text-[10px] font-bold">EST (hrs)</TableHead>
                  <TableHead className="text-[10px]">Sweep Area (NM²)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calculations.map((calc) => (
                  <TableRow key={calc.input.id}>
                    <TableCell className="text-xs font-semibold">{calc.input.name}</TableCell>
                    <TableCell className="text-xs font-mono">{calc.transitGoMin.toFixed(2)}</TableCell>
                    <TableCell className="text-xs font-mono">{calc.transitBackMin.toFixed(2)}</TableCell>
                    <TableCell className="text-xs font-mono">{calc.totalTransitMin.toFixed(2)}</TableCell>
                    <TableCell className="text-xs font-mono">{calc.variableTransitMin.toFixed(2)}</TableCell>
                    <TableCell className="text-xs font-mono">{calc.reserveMin.toFixed(0)}</TableCell>
                    <TableCell className="text-xs font-mono">{calc.tafMin.toFixed(0)}</TableCell>
                    <TableCell className="text-xs font-mono font-bold text-amber-700">{calc.tsfMin.toFixed(2)}</TableCell>
                    <TableCell className="text-xs font-mono">{calc.oseMin.toFixed(2)}</TableCell>
                    <TableCell className="text-xs font-mono">{calc.oseHrs.toFixed(4)}</TableCell>
                    <TableCell className="text-xs font-mono font-bold text-blue-700">{calc.estHrs.toFixed(4)}</TableCell>
                    <TableCell className="text-xs font-mono font-bold text-emerald-700">{calc.sweepAreaNm2.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-slate-300 bg-slate-50">
                  <TableCell colSpan={11} className="text-xs font-bold text-right">TOTAL KAPASITAS:</TableCell>
                  <TableCell className="text-xs font-mono font-bold text-emerald-700">{totalCapacity.toFixed(2)} NM²</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Summary Comparison */}
      <Card className={cn(
        'shadow-sm',
        totalCapacity >= effectiveTargetArea ? 'border-emerald-300' : 'border-red-300',
      )}>
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-md border bg-white border-slate-200">
              <div className="text-[10px] uppercase text-slate-500">Total Kapasitas SRU</div>
              <div className="text-lg font-mono font-bold text-slate-800">{totalCapacity.toFixed(2)} NM²</div>
            </div>
            <div className="p-3 rounded-md border bg-white border-slate-200">
              <div className="text-[10px] uppercase text-slate-500">Luas Area Pencarian</div>
              <div className="text-lg font-mono font-bold text-violet-700">{effectiveTargetArea.toFixed(0)} NM²</div>
            </div>
            <div className={cn('p-3 rounded-md border', totalCapacity >= effectiveTargetArea ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300')}>
              <div className="text-[10px] uppercase text-slate-500">Cakupan</div>
              <div className={cn('text-lg font-mono font-bold', totalCapacity >= effectiveTargetArea ? 'text-emerald-700' : 'text-red-700')}>
                {effectiveTargetArea > 0 ? ((totalCapacity / effectiveTargetArea) * 100).toFixed(1) : 0}%
              </div>
            </div>
            <div className={cn('p-3 rounded-md border flex items-center gap-2', totalCapacity >= effectiveTargetArea ? 'bg-emerald-50 border-emerald-300' : 'bg-red-50 border-red-300')}>
              {totalCapacity >= effectiveTargetArea ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600" />
              )}
              <div className={cn('text-sm font-bold', totalCapacity >= effectiveTargetArea ? 'text-emerald-700' : 'text-red-700')}>
                {totalCapacity >= effectiveTargetArea ? 'MEMENUHI' : 'TIDAK CUKUP'}
              </div>
            </div>
          </div>
          {totalCapacity < effectiveTargetArea && (
            <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              Kekurangan: {(effectiveTargetArea - totalCapacity).toFixed(2)} NM² — perlu tambahan SRU atau kurangi area pencarian.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Combination Optimizer */}
      <Card className="border-indigo-200 shadow-sm">
        <CardHeader className="bg-indigo-50 pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Award className="h-4 w-4 text-indigo-600" /> Combination Optimizer
          </CardTitle>
          <CardDescription className="text-xs">
            Semua kombinasi SRU yang memenuhi kebutuhan area, diurutkan berdasarkan efisiensi (surplus terkecil)
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {allSufficient.length === 0 ? (
            <div className="text-center py-6 text-sm text-red-600">
              <XCircle className="h-8 w-8 mx-auto mb-2 text-red-400" />
              Tidak ada kombinasi SRU yang memenuhi luas area {effectiveTargetArea.toFixed(0)} NM².
              <br />
              Total kapasitas semua SRU: {totalCapacity.toFixed(2)} NM²
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="text-[10px]">#</TableHead>
                    <TableHead className="text-[10px]">Kombinasi</TableHead>
                    <TableHead className="text-[10px]">Kapasitas (NM²)</TableHead>
                    <TableHead className="text-[10px]">Surplus (NM²)</TableHead>
                    <TableHead className="text-[10px]">Cakupan</TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allSufficient.slice(0, 10).map((combo, idx) => (
                    <TableRow
                      key={idx}
                      className={idx === 0 ? 'bg-emerald-50' : ''}
                    >
                      <TableCell className="text-xs font-mono">
                        {idx === 0 && <Award className="h-3 w-3 inline text-emerald-600 mr-1" />}
                        {idx + 1}
                      </TableCell>
                      <TableCell className="text-xs font-semibold">
                        {combo.labels.join(' + ')}
                        <span className="text-slate-400 ml-1">({combo.srus.length} SRU)</span>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{combo.totalSweepArea.toFixed(2)}</TableCell>
                      <TableCell className="text-xs font-mono text-emerald-700">+{combo.surplus.toFixed(2)}</TableCell>
                      <TableCell className="text-xs font-mono">{combo.coveragePct.toFixed(1)}%</TableCell>
                      <TableCell className="text-xs">
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCircle2 className="h-3 w-3" /> MEMENUHI
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {recommendation && (
                <div className="mt-3 p-3 bg-emerald-50 border border-emerald-300 rounded-md">
                  <div className="flex items-center gap-2">
                    <Award className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-bold text-emerald-800">
                      Rekomendasi: {recommendation.labels.join(' + ')}
                    </span>
                  </div>
                  <div className="text-xs text-emerald-700 mt-1">
                    Kapasitas {recommendation.totalSweepArea.toFixed(2)} NM² — surplus {recommendation.surplus.toFixed(2)} NM² ({recommendation.coveragePct.toFixed(1)}% cakupan).
                    Kombinasi paling efisien (surplus terkecil) yang memenuhi kebutuhan area.
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
