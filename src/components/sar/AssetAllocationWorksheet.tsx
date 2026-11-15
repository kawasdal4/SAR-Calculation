'use client';

import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Anchor,
  Ship,
  Plane,
  Plus,
  Trash2,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Navigation,
  Compass,
  ArrowRight,
  Printer,
} from 'lucide-react';
import { type LatLng } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import {
  type SruAssetInput,
  type SruType,
  calculateAssetAllocationSummary,
} from '@/lib/sar/assetAllocation';
import AuthenticESTMaritimeWorksheet from './worksheets/AuthenticESTMaritimeWorksheet';
import AuthenticESTAirWorksheet from './worksheets/AuthenticESTAirWorksheet';

// Preset Pangkalan Basarnas Populer
export const SRU_BASE_PRESETS: { name: string; pos: LatLng }[] = [
  { name: 'Pangkalan Tanjung Priok (Jakarta)', pos: { lat: -6.095, lng: 106.885 } },
  { name: 'Pangkalan Muara Baru (Jakarta)', pos: { lat: -6.115, lng: 106.802 } },
  { name: 'Pangkalan Merak (Banten)', pos: { lat: -5.932, lng: 105.996 } },
  { name: 'Pangkalan Benoa (Bali)', pos: { lat: -8.752, lng: 115.215 } },
  { name: 'Pangkalan Makassar (Sulsel)', pos: { lat: -5.122, lng: 119.412 } },
  { name: 'Pangkalan Sorong (Papua)', pos: { lat: -0.875, lng: 131.255 } },
];

const SRU_TYPE_LABELS: Record<SruType, string> = {
  'rescue-vessel': 'Kapal Penyelamat (Rescue Vessel)',
  'patrol-boat': 'Kapal Patroli (Patrol Boat / RB)',
  rib: 'Rigid Inflatable Boat (RIB)',
  helicopter: 'Helikopter SAR (Rescue Helicopter)',
  'fixed-wing-aircraft': 'Pesawat Patroli Maritim (Fixed-Wing)',
};

interface AssetAllocationWorksheetProps {
  csp: LatLng;
  exitPoint: LatLng;
  ws1Ao: number;
  assets: SruAssetInput[];
  onAssetsChange: (assets: SruAssetInput[]) => void;
  className?: string;
}

export default function AssetAllocationWorksheet({
  csp,
  exitPoint,
  ws1Ao,
  assets,
  onAssetsChange,
  className = '',
}: AssetAllocationWorksheetProps) {
  // Active view: summary matrix vs authentic maritime EST vs authentic air EST
  const [activeSubTab, setActiveSubTab] = useState<'summary' | 'est-mar' | 'est-air'>('summary');
  const [selectedAssetId, setSelectedAssetId] = useState<string>(assets[0]?.id ?? '');

  // Active asset for individual worksheet
  const currentAsset = useMemo(() => {
    return assets.find((a) => a.id === selectedAssetId) ?? assets[0];
  }, [assets, selectedAssetId]);

  // Hitung ringkasan alokasi aset
  const summary = useMemo(() => {
    return calculateAssetAllocationSummary(assets, csp, exitPoint, ws1Ao);
  }, [assets, csp, exitPoint, ws1Ao]);

  const addAsset = () => {
    const nextIdx = assets.length + 1;
    const isAir = nextIdx % 2 === 0;
    const newAsset: SruAssetInput = {
      id: `sru-${Date.now()}`,
      name: isAir ? `HR-15${nextIdx}` : `KN SAR 24${nextIdx}`,
      type: isAir ? 'fixed-wing-aircraft' : 'rescue-vessel',
      homeBaseName: 'Pangkalan Tanjung Priok (Jakarta)',
      homeBasePos: { lat: -6.095, lng: 106.885 },
      transitSpeedKts: isAir ? 180 : 18,
      searchSpeedKts: isAir ? 120 : 12,
      enduranceHours: isAir ? 4 : 8,
      daylightHours: 10,
      fuelReservePct: 15,
      sweepWidthNm: isAir ? 1.0 : 2.0,
      targetCoverage: 1.0,
      assignedSubArea: `Sub-Area ${nextIdx}`,
    };
    onAssetsChange([...assets, newAsset]);
    setSelectedAssetId(newAsset.id);
  };

  const removeAsset = (id: string) => {
    if (assets.length <= 1) return;
    const remaining = assets.filter((a) => a.id !== id);
    onAssetsChange(remaining);
    if (selectedAssetId === id) {
      setSelectedAssetId(remaining[0].id);
    }
  };

  const updateAsset = <K extends keyof SruAssetInput>(id: string, field: K, val: SruAssetInput[K]) => {
    onAssetsChange(
      assets.map((a) => {
        if (a.id !== id) return a;
        return { ...a, [field]: val };
      })
    );
  };

  return (
    <div className={`space-y-5 ${className}`}>
      {/* Main Container Card */}
      <Card className="border-slate-300 shadow-sm bg-white overflow-hidden text-slate-800">
        <CardHeader className="bg-slate-100 border-b border-slate-300 py-3.5 px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Anchor className="h-5 w-5 text-purple-700" />
              <div>
                <CardTitle className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                  PENGHITUNGAN ALOKASI ASET SRU & LEMBAR KERJA OSE/EST ASLI
                </CardTitle>
                <p className="text-[11px] text-slate-500 font-mono">
                  Berdasarkan Form Asli Diklat Basarnas (EST Maritime / EST Air Asset / IAMSAR Manual Vol II)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                className={
                  summary.isSufficient
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-rose-600 hover:bg-rose-700 text-white'
                }
              >
                {summary.isSufficient ? 'Kapasitas Armada: MEMADAI' : 'Kapasitas Armada: DEFISIT'}
              </Badge>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-800">
                Total Ai: {summary.totalAllocatedAreaNm2.toFixed(0)} NM² / Target Ao: {ws1Ao.toFixed(0)} NM²
              </span>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium px-2.5 py-1 rounded shadow-2xs transition-colors print:hidden"
              >
                <Printer className="h-3.5 w-3.5" />
                Cetak Lembar Ini
              </button>
            </div>
          </div>

          {/* Sub-Tabs: Summary vs EST Maritim vs EST Udara */}
          <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-lg bg-slate-200 p-1 gap-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveSubTab('summary')}
                className={`px-3 py-1.5 rounded-md transition-all ${
                  activeSubTab === 'summary'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                1. Matriks Alokasi Armada Seluruh SRU
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab('est-mar')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  activeSubTab === 'est-mar'
                    ? 'bg-white text-blue-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Ship className="h-3.5 w-3.5 text-blue-700" />
                2. Lembar EST Maritim (Asli)
              </button>
              <button
                type="button"
                onClick={() => setActiveSubTab('est-air')}
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1.5 ${
                  activeSubTab === 'est-air'
                    ? 'bg-white text-sky-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Plane className="h-3.5 w-3.5 text-sky-700" />
                3. Lembar EST Udara (Asli)
              </button>
            </div>

            {/* SRU Selector when viewing individual EST sheets */}
            {activeSubTab !== 'summary' && (
              <div className="flex items-center gap-2 bg-white px-2.5 py-1 rounded border border-slate-300 text-xs">
                <span className="text-slate-600 font-semibold">Pilih Unit SRU:</span>
                <select
                  value={selectedAssetId}
                  onChange={(e) => setSelectedAssetId(e.target.value)}
                  className="font-bold text-slate-900 bg-transparent focus:outline-none cursor-pointer"
                >
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.type.includes('aircraft') || a.type.includes('helicopter') ? 'Udara' : 'Laut'})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-5">
          {/* Top Operational Context Banner */}
          <div className="bg-purple-50/70 border border-purple-200 rounded-lg p-3 text-xs grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <span className="text-purple-900 font-bold block mb-0.5">Target Luas Search Area (Ao):</span>
              <span className="text-base font-extrabold font-mono text-purple-950">
                {ws1Ao.toFixed(0)} NM²
              </span>
              <span className="text-[10px] text-purple-700 block mt-0.5 font-sans">
                (Dihasilkan dari Worksheet 1 Marine Datum Planning)
              </span>
            </div>
            <div>
              <span className="text-purple-900 font-bold block mb-0.5">Titik Awal Mulai Pencarian (CSP):</span>
              <span className="font-mono text-slate-800 font-semibold">
                {formatDMS(csp.lat, false)}, {formatDMS(csp.lng, true)}
              </span>
              <span className="text-[10px] text-purple-700 block mt-0.5 font-sans">
                (Tujuan rute Transit Go seluruh SRU)
              </span>
            </div>
            <div>
              <span className="text-purple-900 font-bold block mb-0.5">Titik Keluar Area Pencarian (Exit Point):</span>
              <span className="font-mono text-slate-800 font-semibold">
                {formatDMS(exitPoint.lat, false)}, {formatDMS(exitPoint.lng, true)}
              </span>
              <span className="text-[10px] text-purple-700 block mt-0.5 font-sans">
                (Titik awal rute Transit Back ke Pangkalan Asal)
              </span>
            </div>
          </div>

          {/* VIEW 1: FLEET ALLOCATION SUMMARY MATRIX */}
          {activeSubTab === 'summary' && (
            <div className="space-y-5">
              {/* Table: SRU Asset Inputs */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Ship className="h-4 w-4 text-purple-700" /> A. Daftar Fasilitas SRU & Parameter Armada
                  </h3>
                  <button
                    type="button"
                    onClick={addAsset}
                    className="flex items-center gap-1 text-xs bg-purple-600 hover:bg-purple-700 text-white font-bold px-3 py-1.5 rounded-lg shadow-2xs transition"
                  >
                    <Plus className="h-3.5 w-3.5" /> Tambah Aset SRU
                  </button>
                </div>

                <div className="overflow-x-auto border border-slate-300 rounded shadow-2xs">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-200/80 text-slate-700 font-semibold border-b border-slate-300">
                        <th className="py-2 px-3 text-left">Nama Aset / Call Sign</th>
                        <th className="py-2 px-3 text-left">Jenis SRU</th>
                        <th className="py-2 px-3 text-left">Pangkalan Asal</th>
                        <th className="py-2 px-3 text-right">V Transit (kt)</th>
                        <th className="py-2 px-3 text-right">V Cari (kt)</th>
                        <th className="py-2 px-3 text-right">Endurance Te (j)</th>
                        <th className="py-2 px-3 text-right">Cadangan (%)</th>
                        <th className="py-2 px-3 text-right">Track Spacing S (NM)</th>
                        <th className="py-2 px-3 text-center w-12">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                      {assets.map((asset) => (
                        <tr key={asset.id} className="hover:bg-slate-50">
                          <td className="py-1.5 px-3 font-sans">
                            <input
                              type="text"
                              value={asset.name}
                              onChange={(e) => updateAsset(asset.id, 'name', e.target.value)}
                              className="w-32 bg-white border border-slate-300 rounded px-1.5 py-0.5 font-bold text-slate-900" suppressHydrationWarning
                            />
                          </td>
                          <td className="py-1.5 px-3 font-sans">
                            <select
                              value={asset.type}
                              onChange={(e) => updateAsset(asset.id, 'type', e.target.value as SruType)}
                              className="w-36 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[11px]"
                            >
                              <option value="rescue-vessel">Kapal Penyelamat</option>
                              <option value="patrol-boat">Kapal Patroli / RB</option>
                              <option value="rib">RIB</option>
                              <option value="helicopter">Helikopter</option>
                              <option value="fixed-wing-aircraft">Pesawat Patroli</option>
                            </select>
                          </td>
                          <td className="py-1.5 px-3 font-sans">
                            <select
                              value={asset.homeBaseName}
                              onChange={(e) => {
                                const found = SRU_BASE_PRESETS.find((p) => p.name === e.target.value);
                                if (found) {
                                  updateAsset(asset.id, 'homeBaseName', found.name);
                                  updateAsset(asset.id, 'homeBasePos', found.pos);
                                }
                              }}
                              className="w-44 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-[11px]"
                            >
                              {SRU_BASE_PRESETS.map((p) => (
                                <option key={p.name} value={p.name}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <input
                              type="number"
                              min="5"
                              max="300"
                              value={asset.transitSpeedKts}
                              onChange={(e) => updateAsset(asset.id, 'transitSpeedKts', Number(e.target.value))}
                              className="w-16 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right font-bold" suppressHydrationWarning
                            />
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <input
                              type="number"
                              min="3"
                              max="200"
                              value={asset.searchSpeedKts}
                              onChange={(e) => updateAsset(asset.id, 'searchSpeedKts', Number(e.target.value))}
                              className="w-16 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right font-bold" suppressHydrationWarning
                            />
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <input
                              type="number"
                              step="0.5"
                              min="1"
                              max="48"
                              value={asset.enduranceHours}
                              onChange={(e) => updateAsset(asset.id, 'enduranceHours', Number(e.target.value))}
                              className="w-16 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right font-bold text-purple-900" suppressHydrationWarning
                            />
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <input
                              type="number"
                              min="5"
                              max="30"
                              value={asset.fuelReservePct}
                              onChange={(e) => updateAsset(asset.id, 'fuelReservePct', Number(e.target.value))}
                              className="w-14 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right font-bold" suppressHydrationWarning
                            />
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              max="10"
                              value={asset.sweepWidthNm}
                              onChange={(e) => updateAsset(asset.id, 'sweepWidthNm', Number(e.target.value))}
                              className="w-16 bg-white border border-slate-300 rounded px-1.5 py-0.5 text-right font-bold text-blue-900" suppressHydrationWarning
                            />
                          </td>
                          <td className="py-1.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => removeAsset(asset.id)}
                              disabled={assets.length <= 1}
                              className="text-slate-400 hover:text-rose-600 disabled:opacity-30 transition"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table: Calculated Effort & Transit Go/Back */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <Compass className="h-4 w-4 text-emerald-700" /> B. Hasil Perhitungan Rute Transit & Alokasi Luas Area (Ai)
                </h3>

                <div className="overflow-x-auto border border-slate-300 rounded shadow-2xs">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-200/80 text-slate-700 font-semibold border-b border-slate-300">
                        <th className="py-2 px-3 text-left">Unit SRU</th>
                        <th className="py-2 px-3 text-right">Transit Go (NM / Jam)</th>
                        <th className="py-2 px-3 text-right">Transit Back (NM / Jam)</th>
                        <th className="py-2 px-3 text-right">Cadangan (Jam)</th>
                        <th className="py-2 px-3 text-right bg-blue-50/70 text-blue-950">Waktu di Lokasi Tos (Jam)</th>
                        <th className="py-2 px-3 text-right">Panjang Track (NM)</th>
                        <th className="py-2 px-3 text-right bg-emerald-50 text-emerald-950">Kemampuan Sapuan Zi (NM²)</th>
                        <th className="py-2 px-3 text-right bg-purple-100 text-purple-950 font-bold">Alokasi Luas Ai (NM²)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                      {summary.perAsset.map((res) => (
                        <tr key={res.asset.id} className="hover:bg-slate-50">
                          <td className="py-1.5 px-3 font-sans font-bold text-slate-900">
                            {res.asset.name}
                            <span className="block text-[10px] text-slate-500 font-normal">
                              {SRU_TYPE_LABELS[res.asset.type]}
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {res.transitGoDistanceNm.toFixed(1)} NM
                            <span className="block text-[10px] text-slate-500 font-sans">
                              ({res.transitGoHours.toFixed(2)} jam)
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {res.transitBackDistanceNm.toFixed(1)} NM
                            <span className="block text-[10px] text-slate-500 font-sans">
                              ({res.transitBackHours.toFixed(2)} jam)
                            </span>
                          </td>
                          <td className="py-1.5 px-3 text-right text-slate-600">
                            {res.fuelReserveHours.toFixed(2)} jam
                          </td>
                          <td className="py-1.5 px-3 text-right font-bold text-blue-900 bg-blue-50/40">
                            {res.onSceneSearchHours.toFixed(2)} jam
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            {res.searchTrackLengthNm.toFixed(1)} NM
                          </td>
                          <td className="py-1.5 px-3 text-right font-bold text-emerald-800 bg-emerald-50/40">
                            {res.searchEffortZiNm2.toFixed(1)} NM²
                          </td>
                          <td className="py-1.5 px-3 text-right font-black text-purple-900 bg-purple-50">
                            {res.allocatedAreaNm2.toFixed(1)} NM²
                          </td>
                        </tr>
                      ))}

                      {/* Summary Row */}
                      <tr className="bg-slate-100 font-bold border-t-2 border-slate-600 text-slate-900">
                        <td colSpan={6} className="py-2.5 px-3 text-right font-sans">
                          TOTAL KEMAMPUAN SELURUH ARMADA SRU (SUM Ai):
                        </td>
                        <td className="py-2.5 px-3 text-right text-emerald-900 bg-emerald-100">
                          {summary.totalAllocatedAreaNm2.toFixed(1)} NM²
                        </td>
                        <td className="py-2.5 px-3 text-right text-purple-950 bg-purple-200 text-xs font-black">
                          {summary.totalAllocatedAreaNm2.toFixed(1)} NM²
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary Decision Matrix (slide 19/25 in Alokasi Aset - FOE.pptx) */}
              <div className="p-4 rounded-lg border-2 border-slate-300 bg-slate-50 space-y-3">
                <div className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                  Kesimpulan Alokasi Armada (Sesuai Kurikulum Pelatihan Basarnas):
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 font-mono text-xs">
                  <div className="bg-white p-2.5 rounded border border-slate-200">
                    <span className="text-slate-500 font-sans block">Total Kemampuan Seluruh SRU:</span>
                    <span className="text-base font-extrabold text-blue-900">{summary.totalAllocatedAreaNm2.toFixed(1)} NM²</span>
                  </div>
                  <div className="bg-white p-2.5 rounded border border-slate-200">
                    <span className="text-slate-500 font-sans block">Target Luas Search Area (Ao):</span>
                    <span className="text-base font-extrabold text-purple-900">{ws1Ao.toFixed(1)} NM²</span>
                  </div>
                  <div className={`p-2.5 rounded border font-sans font-bold flex items-center gap-2 ${
                    summary.isSufficient ? 'bg-emerald-100 border-emerald-300 text-emerald-950' : 'bg-rose-100 border-rose-300 text-rose-950'
                  }`}>
                    {summary.isSufficient ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0" />
                        <span>Seluruh armada MAMPU menyapu seluruh area pencarian.</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-5 w-5 text-rose-700 shrink-0" />
                        <span>Armada TIDAK CUKUP menyapu seluruh area ({Math.abs(summary.deficitAreaNm2).toFixed(1)} NM² defisit).</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: AUTHENTIC EST MARITIME WORKSHEET */}
          {activeSubTab === 'est-mar' && currentAsset && (
            <div className="space-y-4">
              <AuthenticESTMaritimeWorksheet
                asset={currentAsset}
                csp={csp}
                exitPoint={exitPoint}
                onUpdateAsset={(field, val) => updateAsset(currentAsset.id, field, val)}
              />
            </div>
          )}

          {/* VIEW 3: AUTHENTIC EST AIR WORKSHEET */}
          {activeSubTab === 'est-air' && currentAsset && (
            <div className="space-y-4">
              <AuthenticESTAirWorksheet
                asset={currentAsset}
                csp={csp}
                exitPoint={exitPoint}
                onUpdateAsset={(field, val) => updateAsset(currentAsset.id, field, val)}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
