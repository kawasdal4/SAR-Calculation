'use client';

import { printActiveWorksheetFit } from '@/lib/sar/printFit';
import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Anchor,
  Ship,
  Plane,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Compass,
  Printer,
} from 'lucide-react';
import { type LatLng } from '@/lib/sar/sarCalculations';
import CoordinateInput from './CoordinateInput';
import { formatDMS } from '@/lib/sar/coordFormat';
import {
  type SruAssetInput,
  type SruType,
  assetDomain,
  calculateAssetAllocationSummary,
} from '@/lib/sar/assetAllocation';
import WorksheetSheetBar from './worksheets/WorksheetSheetBar';
import AuthenticESTMaritimeWorksheet from './worksheets/AuthenticESTMaritimeWorksheet';
import AuthenticESTAirWorksheet from './worksheets/AuthenticESTAirWorksheet';
import { SRU_BASES } from '@/lib/sar/sruBases';

// Preset Pangkalan Basarnas Populer — data dipindah ke `src/lib/sar/sruBases.ts`
// supaya layer peta laut & ONC memakai bank data yang sama (satu sumber kebenaran).
export const SRU_BASE_PRESETS: { name: string; pos: LatLng }[] = SRU_BASES.map((base) => ({
  name: base.name,
  pos: { lat: base.lat, lng: base.lng },
}));

const SRU_TYPE_LABELS: Record<SruType, string> = {
  'rescue-vessel': 'Kapal Penyelamat (Rescue Vessel)',
  'patrol-boat': 'Kapal Patroli (Patrol Boat / RB)',
  rib: 'Rigid Inflatable Boat (RIB)',
  'sea-rider': 'Sea Rider',
  helicopter: 'Helikopter SAR (Rescue Helicopter)',
  'fixed-wing-aircraft': 'Pesawat Patroli Maritim (Fixed-Wing)',
};

interface AssetAllocationWorksheetProps {
  csp: LatLng;
  exitPoint: LatLng;
  ws1Ao: number;
  assets: SruAssetInput[];
  /** Spacing (S) per assetId dari worksheet sumbernya: udara → WS 2, laut → WS 8. */
  worksheetSpacing?: Record<string, { spacingNm: number; source: 'ws2' | 'ws8' }>;
  onAssetsChange: (assets: SruAssetInput[]) => void;
  /** Domain tab pemanggil: membatasi tombol tambah aset & menegaskan judul
   *  (tab Alokasi Aset Udara hanya mengelola alut udara, dst.). */
  domain?: 'udara' | 'laut' | 'darat';
  className?: string;
}

/**
 * Worksheet Alokasi Aset SRU — 1 alut = 1 lembar (sama dengan Worksheet 2/3/8).
 * Setiap SRU punya lembar sendiri (data identitas + pangkalan + parameter +
 * lembar EST asli Maritim/Udara sesuai klasifikasi alut udara/laut oleh AI
 * asisten), di atasnya rekapitulasi armada (Transit/OSE/EST/Sweep Area).
 * Posisi pangkalan per alut berasal dari soal; bila soal tidak memberi
 * koordinat, AI asisten meresolusi nama bandara/dermaga pada peta ONC dan
 * posisinya dipetakan di peta laut untuk penghitungan Transit Go/Back.
 */
export default function AssetAllocationWorksheet({
  csp,
  exitPoint,
  ws1Ao,
  assets,
  worksheetSpacing,
  onAssetsChange,
  domain,
  className = '',
}: AssetAllocationWorksheetProps) {
  // Lembar aktif = SRU yang sedang diedit; fallback ke lembar pertama.
  const [activeAssetId, setActiveAssetId] = useState<string>('');
  const activeAsset = assets.find((asset) => asset.id === activeAssetId) ?? assets[0];
  // Aset yang Track Spacing S-nya diisi manual pengguna (tidak dioverride
  // otomatis dari WS 2/WS 8 sampai tombol "pakai dari WS" ditekan lagi).
  const [manualSpacingIds, setManualSpacingIds] = useState<ReadonlySet<string>>(new Set());

  // Hitung ringkasan alokasi aset (semua lembar)
  const summary = useMemo(() => {
    return calculateAssetAllocationSummary(assets, csp, exitPoint, ws1Ao);
  }, [assets, csp, exitPoint, ws1Ao]);
  const hasValidAssets = summary.perAsset.some((result) => result.isValid);
  const activeResult = activeAsset
    ? summary.perAsset.find((result) => result.asset.id === activeAsset.id)
    : undefined;
  const activeDomain = activeAsset ? assetDomain(activeAsset.type) : 'laut';

  const addAsset = (type: SruType) => {
    const newAsset: SruAssetInput = {
      id: `sru-${Date.now()}`,
      name: '',
      type,
      homeBaseName: '',
      homeBasePos: { lat: 0, lng: 0 },
      transitSpeedKts: 0,
      searchSpeedKts: 0,
      enduranceHours: 0,
      sweepWidthNm: 0,
      assignedSubArea: '-',
    };
    onAssetsChange([...assets, newAsset]);
    setActiveAssetId(newAsset.id);
  };

  const removeAsset = (id: string) => {
    if (assets.length <= 1) return;
    const remaining = assets.filter((a) => a.id !== id);
    onAssetsChange(remaining);
    if (activeAsset?.id === id) {
      setActiveAssetId(remaining[0]?.id ?? '');
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

  // Sumber S untuk lembar aktif: WS 2 (alat udara) atau WS 8 (alat laut).
  const activeSpacingSource = activeAsset ? worksheetSpacing?.[activeAsset.id] : undefined;
  const activeSpacingIsManual = activeAsset ? manualSpacingIds.has(activeAsset.id) : false;

  // Sinkronkan Track Spacing S otomatis dari worksheet sumbernya (routing
  // Panduan Agent: alat udara → S dari WS 2, alat laut → S dari WS 8) untuk
  // aset yang tidak di-override manual pengguna. Nilai S lembar WS 2/WS 8 per
  // SRU langsung mengisi lembar Alokasi Aset; bila S di lembar sumber berubah,
  // nilai di sini ikut diperbarui.
  useEffect(() => {
    if (!worksheetSpacing) return;
    const needsSync = assets.some((a) => {
      const src = worksheetSpacing[a.id];
      return Boolean(src) && !manualSpacingIds.has(a.id) && a.sweepWidthNm !== src?.spacingNm;
    });
    if (!needsSync) return;
    onAssetsChange(assets.map((a) => {
      const src = worksheetSpacing[a.id];
      if (!src || manualSpacingIds.has(a.id) || a.sweepWidthNm === src.spacingNm) return a;
      return { ...a, sweepWidthNm: src.spacingNm };
    }));
  }, [worksheetSpacing, assets, manualSpacingIds, onAssetsChange]);

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
                  {domain === 'udara' && <span className="ml-2 inline-flex whitespace-nowrap rounded bg-sky-700 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white align-middle">Domain Udara</span>}
                  {domain === 'laut' && <span className="ml-2 inline-flex whitespace-nowrap rounded bg-blue-800 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white align-middle">Domain Laut</span>}
                </CardTitle>
                <p className="text-[11px] text-slate-500 font-mono">
                  Berdasarkan Form Diklat Basarnas (EST Maritime / EST Air Asset) — 1 alut = 1 lembar
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                className={ws1Ao <= 0 || !hasValidAssets ? 'bg-amber-600 hover:bg-amber-700 text-white' : summary.isSufficient ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}
              >
                {ws1Ao <= 0 || !summary.perAsset.some((result) => result.isValid)
                  ? 'Input/Area Belum Lengkap'
                  : summary.isSufficient ? 'Kapasitas Sapuan: MEMENUHI' : 'Kapasitas Sapuan: DEFISIT'}
              </Badge>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-800">
                Total Sweep Area A: {summary.totalSweepAreaNm2.toFixed(2)} NM² / Ao: {ws1Ao.toFixed(2)} NM²
              </span>
              <button
                type="button"
                onClick={() => printActiveWorksheetFit()}
                className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium px-2.5 py-1 rounded shadow-2xs transition-colors print:hidden"
              >
                <Printer className="h-3.5 w-3.5" />
                Cetak Lembar Ini
              </button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-4 space-y-5">
          {/* Top Operational Context Banner */}
          <div className="bg-purple-50/70 border border-purple-200 rounded-lg p-3 text-xs grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <span className="text-purple-900 font-bold block mb-0.5">Target Luas Search Area (Ao):</span>
              <span className="text-base font-extrabold font-mono text-purple-950">
                {ws1Ao.toFixed(2)} NM²
              </span>
              <span className="text-[10px] text-purple-700 block mt-0.5 font-sans">
                Target dari Worksheet 1 (Ao)
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

          {/* Bar pilih lembar: 1 alut/SRU = 1 lembar */}
          <WorksheetSheetBar
            title="Lembar Alokasi Aset SRU"
            sheets={assets.map((asset, index) => ({
              key: asset.id,
              label: asset.name?.trim() || `SRU ${index + 1}`,
              bound: true,
            }))}
            activeKey={activeAsset?.id ?? ''}
            assets={assets.map((asset, index) => ({ id: asset.id, label: asset.name?.trim() || `SRU ${index + 1}` }))}
            boundAssetIds={assets.map((asset) => asset.id)}
            onSelect={setActiveAssetId}
            onAddBlank={() => addAsset('rescue-vessel')}
            onAddAsset={() => undefined}
            onRemove={(key) => removeAsset(key)}
            addControls={
              <span className="flex items-center gap-1.5">
                {/* Tab domain: hanya tampilkan tombol tambah sesuai domain tab.
                    Tanpa domain (pemakaian lama) → kedua tombol tampil. */}
                {(domain === undefined || domain === 'laut') && (
                  <button type="button" onClick={() => addAsset('rescue-vessel')} className="flex items-center gap-1 text-[11px] bg-blue-700 hover:bg-blue-800 text-white font-bold px-2.5 py-1 rounded-full transition">
                    <Plus className="h-3 w-3" /> Alut Laut
                  </button>
                )}
                {(domain === undefined || domain === 'udara') && (
                  <button type="button" onClick={() => addAsset('fixed-wing-aircraft')} className="flex items-center gap-1 text-[11px] bg-sky-700 hover:bg-sky-800 text-white font-bold px-2.5 py-1 rounded-full transition">
                    <Plus className="h-3 w-3" /> Alut Udara
                  </button>
                )}
              </span>
            }
          />

          {/* ================= LEMBAR AKTIF (per SRU) ================= */}
          {activeAsset && (
            <div className="space-y-4 border border-slate-300 rounded-lg p-4 bg-white">
              {/* Identitas lembar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Lembar SRU: {activeAsset.name?.trim() || 'Belum dinamai'}
                  <span className="ml-2 font-normal normal-case text-slate-500">{SRU_TYPE_LABELS[activeAsset.type]}</span>
                </h3>
                <span className="flex items-center gap-2">
                  {activeDomain === 'udara' ? (
                    <Badge className="bg-sky-100 hover:bg-sky-100 text-sky-900 border border-sky-300">
                      <Plane className="h-3 w-3 mr-1" /> ALUT UDARA
                    </Badge>
                  ) : (
                    <Badge className="bg-blue-100 hover:bg-blue-100 text-blue-900 border border-blue-300">
                      <Ship className="h-3 w-3 mr-1" /> ALUT LAUT
                    </Badge>
                  )}
                  {activeResult?.isValid ? (
                    <Badge className="bg-emerald-100 hover:bg-emerald-100 text-emerald-900 border border-emerald-300">Hitungan Valid</Badge>
                  ) : (
                    <Badge className="bg-amber-100 hover:bg-amber-100 text-amber-900 border border-amber-300">Data Belum Lengkap</Badge>
                  )}
                </span>
              </div>

              {/* Input parameter lembar ini */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Nama Aset / Call Sign</label>
                  <input
                    type="text"
                    value={activeAsset.name}
                    onChange={(e) => updateAsset(activeAsset.id, 'name', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 font-bold text-slate-900" suppressHydrationWarning
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Jenis SRU (klasifikasi udara/laut)</label>
                  <select
                    value={activeAsset.type}
                    onChange={(e) => updateAsset(activeAsset.id, 'type', e.target.value as SruType)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5"
                  >
                    <option value="rescue-vessel">Kapal Penyelamat (laut)</option>
                    <option value="patrol-boat">Kapal Patroli / RB (laut)</option>
                    <option value="rib">RIB (laut)</option>
                    <option value="sea-rider">Sea Rider (laut)</option>
                    <option value="helicopter">Helikopter (udara)</option>
                    <option value="fixed-wing-aircraft">Pesawat Patroli Maritim (udara)</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Pangkalan Asal (bandara/dermaga/pelabuhan)</label>
                  <input
                    type="text"
                    value={activeAsset.homeBaseName}
                    onChange={(e) => updateAsset(activeAsset.id, 'homeBaseName', e.target.value)}
                    placeholder="Nama pangkalan dari soal / ONC"
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 font-semibold text-slate-800" suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Preset Pangkalan</label>
                  <select
                    value=""
                    onChange={(e) => {
                      const found = SRU_BASE_PRESETS.find((p) => p.name === e.target.value);
                      if (found) {
                        updateAsset(activeAsset.id, 'homeBaseName', found.name);
                        updateAsset(activeAsset.id, 'homeBasePos', found.pos);
                      }
                    }}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5"
                  >
                    <option value="">Pilih preset Basarnas…</option>
                    {SRU_BASE_PRESETS.map((p) => (
                      <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Latitude Pangkalan (DMS)</label>
                  <CoordinateInput
                    axis="lat"
                    value={activeAsset.homeBasePos.lat}
                    onChange={(lat) => updateAsset(activeAsset.id, 'homeBasePos', { ...activeAsset.homeBasePos, lat })}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-right font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Longitude Pangkalan (DMS)</label>
                  <CoordinateInput
                    axis="lng"
                    value={activeAsset.homeBasePos.lng}
                    onChange={(lng) => updateAsset(activeAsset.id, 'homeBasePos', { ...activeAsset.homeBasePos, lng })}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-right font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">{activeDomain === 'udara' ? 'V_TAS Transit (kt)' : 'V Transit (kt)'}</label>
                  <input
                    type="number" min="0" value={activeAsset.transitSpeedKts || ''}
                    onChange={(e) => updateAsset(activeAsset.id, 'transitSpeedKts', Number(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-right font-mono font-bold" suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">V Cari (kt)</label>
                  <input
                    type="number" min="0" value={activeAsset.searchSpeedKts || ''}
                    onChange={(e) => updateAsset(activeAsset.id, 'searchSpeedKts', Number(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-right font-mono font-bold" suppressHydrationWarning
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Endurance E (jam)</label>
                  <input
                    type="number" step="0.5" min="0" value={activeAsset.enduranceHours || ''}
                    onChange={(e) => updateAsset(activeAsset.id, 'enduranceHours', Number(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-right font-mono font-bold" suppressHydrationWarning
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-1 mb-1">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Track Spacing S (NM)</label>
                    {activeSpacingSource && (
                      activeSpacingIsManual ? (
                        <button
                          type="button"
                          onClick={() => setManualSpacingIds((prev) => {
                            const next = new Set(prev);
                            next.delete(activeAsset.id);
                            return next;
                          })}
                          className="text-[10px] font-semibold text-purple-700 hover:text-purple-900 hover:underline"
                          title={`Ambil lagi S dari ${activeSpacingSource.source === 'ws2' ? 'Worksheet 2' : 'Worksheet 8'}`}
                        >
                          pakai dari {activeSpacingSource.source === 'ws2' ? 'WS 2' : 'WS 8'}
                        </button>
                      ) : (
                        <span
                          className="text-[10px] font-bold text-emerald-700"
                          title={`S otomatis dari ${activeSpacingSource.source === 'ws2' ? 'Worksheet 2 — Practical Track Spacing' : 'Worksheet 8 — Practical Track Spacing'} lembar SRU ini`}
                        >
                          dari {activeSpacingSource.source === 'ws2' ? 'WS 2' : 'WS 8'}
                        </span>
                      )
                    )}
                  </div>
                  <input
                    type="number" step="0.1" min="0" value={activeAsset.sweepWidthNm || ''}
                    onChange={(e) => {
                      setManualSpacingIds((prev) => new Set(prev).add(activeAsset.id));
                      updateAsset(activeAsset.id, 'sweepWidthNm', Number(e.target.value) || 0);
                    }}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5 text-right font-mono font-bold" suppressHydrationWarning
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500 block mb-1">Sub-Area yang Ditugaskan</label>
                  <input
                    type="text"
                    value={activeAsset.assignedSubArea ?? '-'}
                    onChange={(e) => updateAsset(activeAsset.id, 'assignedSubArea', e.target.value)}
                    className="w-full bg-white border border-slate-300 rounded px-2 py-1.5" suppressHydrationWarning
                  />
                </div>
              </div>

              {/* Hasil hitung lembar ini */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[11px]">
                {[
                  { label: 'Transit Go', value: activeResult ? `${activeResult.transitGoDistanceNm.toFixed(1)} NM / ${activeResult.transitGoHours.toFixed(2)} jam` : '—' },
                  { label: 'Transit Back', value: activeResult ? `${activeResult.transitBackDistanceNm.toFixed(1)} NM / ${activeResult.transitBackHours.toFixed(2)} jam` : '—' },
                  { label: 'TSF (min)', value: activeResult?.totalSafetyFuelMinutes?.toFixed(2) ?? '—' },
                  { label: 'OSE (min)', value: activeResult?.onSceneEnduranceMinutes?.toFixed(2) ?? '—' },
                  { label: 'EST (jam)', value: activeResult?.isValid ? activeResult.effectiveSearchHours.toFixed(4) : '—' },
                  { label: 'Sweep Area A (NM²)', value: activeResult?.isValid ? activeResult.sweepAreaNm2.toFixed(2) : '—' },
                ].map((box) => (
                  <div key={box.label} className="rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
                    <span className="block text-[9px] font-bold uppercase tracking-wide text-slate-500">{box.label}</span>
                    <span className="block font-mono font-bold text-slate-900">{box.value}</span>
                  </div>
                ))}
              </div>
              {activeResult && <p className="text-[10px] text-slate-500 font-mono">{activeResult.statusMessage}</p>}
              <p className="text-[10px] text-slate-500">
                Jarak transit dihitung pangkalan → CSP (Go) dan Exit Point → pangkalan (Back); posisi pangkalan diplot di peta laut.
                {activeDomain === 'udara'
                  ? ' Detail TSF udara (variable transit, reserve, TAF) di lembar EST Udara di bawah.'
                  : ' TSF laut = Tr Go + Tr Back (total transit), dihitung otomatis pada lembar EST Maritim di bawah.'}
              </p>

              {/* Lembar EST asli sesuai klasifikasi udara/laut */}
              {activeDomain === 'udara' ? (
                <AuthenticESTAirWorksheet
                  asset={activeAsset}
                  csp={csp}
                  exitPoint={exitPoint}
                  onUpdateAsset={(field, val) => updateAsset(activeAsset.id, field, val)}
                />
              ) : (
                <AuthenticESTMaritimeWorksheet
                  asset={activeAsset}
                  csp={csp}
                  exitPoint={exitPoint}
                  onUpdateAsset={(field, val) => updateAsset(activeAsset.id, field, val)}
                />
              )}
            </div>
          )}

          {/* ================= REKAPITULASI ARMADA ================= */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Compass className="h-4 w-4 text-emerald-700" /> Rekapitulasi: Transit, OSE, EST & Sweep Width Area A (Seluruh Lembar)
            </h3>

            <div className="overflow-x-auto border border-slate-300 rounded shadow-2xs">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-200/80 text-slate-700 font-semibold border-b border-slate-300">
                    <th className="py-2 px-3 text-left">Unit SRU</th>
                    <th className="py-2 px-3 text-right">Transit Go (NM / Jam)</th>
                    <th className="py-2 px-3 text-right">Transit Back (NM / Jam)</th>
                    <th className="py-2 px-3 text-right">TSF (min)</th>
                    <th className="py-2 px-3 text-right bg-blue-50/70 text-blue-950">OSE (min)</th>
                    <th className="py-2 px-3 text-right">EST (jam)</th>
                    <th className="py-2 px-3 text-right">V_search × S</th>
                    <th className="py-2 px-3 text-right bg-emerald-50 text-emerald-950">Sweep Width Area A (NM²)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                  {summary.perAsset.map((res) => (
                    <tr key={res.asset.id} className={`hover:bg-slate-50 ${res.asset.id === activeAsset?.id ? 'bg-purple-50/60' : ''}`}>
                      <td className="py-1.5 px-3 font-sans font-bold text-slate-900">
                        <button type="button" onClick={() => setActiveAssetId(res.asset.id)} className="hover:underline text-left">
                          {res.asset.name || '(tanpa nama)'}
                        </button>
                        <span className="block text-[10px] text-slate-500 font-normal">
                          {assetDomain(res.asset.type) === 'udara' ? 'Alut udara — ' : 'Alut laut — '}{SRU_TYPE_LABELS[res.asset.type]}
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
                        {res.totalSafetyFuelMinutes?.toFixed(2) ?? '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-bold text-blue-900 bg-blue-50/40">
                        {res.onSceneEnduranceMinutes?.toFixed(2) ?? '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        {res.isValid ? res.effectiveSearchHours.toFixed(4) : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right">
                        {res.asset.searchSpeedKts > 0 && res.asset.sweepWidthNm > 0 ? `${res.asset.searchSpeedKts} × ${res.asset.sweepWidthNm}` : '—'}
                      </td>
                      <td className="py-1.5 px-3 text-right font-black text-emerald-900 bg-emerald-50">
                        {res.isValid ? `${res.sweepAreaNm2.toFixed(2)} NM²` : '—'}
                        <span className="block text-[9px] font-sans font-normal text-slate-500">{res.statusMessage}</span>
                      </td>
                    </tr>
                  ))}

                  {/* Summary Row */}
                  <tr className="bg-slate-100 font-bold border-t-2 border-slate-600 text-slate-900">
                    <td colSpan={7} className="py-2.5 px-3 text-right font-sans">TOTAL SWEEP WIDTH AREA (Σ A):</td>
                    <td className="py-2.5 px-3 text-right text-emerald-950 bg-emerald-200 text-xs font-black">{summary.totalSweepAreaNm2.toFixed(2)} NM²</td>
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
                <span className="text-base font-extrabold text-blue-900">{summary.totalSweepAreaNm2.toFixed(2)} NM²</span>
              </div>
              <div className="bg-white p-2.5 rounded border border-slate-200">
                <span className="text-slate-500 font-sans block">Target Luas Search Area (Ao):</span>
                <span className="text-base font-extrabold text-purple-900">{ws1Ao.toFixed(2)} NM²</span>
              </div>
              <div className={`p-2.5 rounded border font-sans font-bold flex items-center gap-2 ${
                ws1Ao <= 0 || !hasValidAssets ? 'bg-amber-100 border-amber-300 text-amber-950' : summary.isSufficient ? 'bg-emerald-100 border-emerald-300 text-emerald-950' : 'bg-rose-100 border-rose-300 text-rose-950'
              }`}>
                {ws1Ao <= 0 || !hasValidAssets ? (
                  <><AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" /><span>Masukkan Search Area Ao dan lengkapi data SRU untuk menilai kapasitas.</span></>
                ) : summary.isSufficient ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-emerald-700 shrink-0" />
                    <span>Kapasitas luas sapuan gabungan memenuhi Search Area (Ao).</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-5 w-5 text-rose-700 shrink-0" />
                    <span>Kapasitas luas sapuan belum memenuhi target; defisit {summary.deficitAreaNm2.toFixed(2)} NM².</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-slate-300 bg-white p-4 space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">Uji Kombinasi SRU</h3>
            <p className="text-[10px] text-slate-600">Total A dibandingkan dengan Ao. Gabungkan aset hanya bila area dan pola pencariannya dikoordinasikan; ini evaluasi kapasitas, bukan keputusan operasi.</p>
            {ws1Ao <= 0 ? <p className="text-xs text-slate-500">Masukkan Ao dari Worksheet 1 sebelum menilai kombinasi.</p> : summary.combinations.length === 0 ? <p className="text-xs text-slate-500">Belum ada aset dengan hitungan valid.</p> : (() => {
              const meets = summary.combinations.filter((combo) => combo.meetsTarget).slice(0, 8);
              const shortfalls = summary.combinations.filter((combo) => !combo.meetsTarget).sort((a, b) => b.coveragePercent - a.coveragePercent).slice(0, 3);
              const displayed = [...meets, ...shortfalls.filter((combo) => !meets.includes(combo))];
              return <div className="overflow-x-auto"><table className="w-full text-xs border-collapse"><thead><tr className="bg-slate-100 text-slate-700"><th className="p-2 text-left">Kombinasi</th><th className="p-2 text-right">Total A (NM²)</th><th className="p-2 text-right">Coverage</th><th className="p-2 text-right">Surplus / Defisit (NM²)</th><th className="p-2 text-left">Status</th></tr></thead><tbody>{displayed.map((combo) => <tr key={combo.assetIds.join('|')} className="border-t border-slate-200"><td className="p-2">{combo.assetNames.join(' + ')}</td><td className="p-2 text-right font-mono">{combo.totalSweepAreaNm2.toFixed(2)}</td><td className="p-2 text-right font-mono">{combo.coveragePercent.toFixed(2)}%</td><td className="p-2 text-right font-mono">{combo.surplusNm2 >= 0 ? '+' : ''}{combo.surplusNm2.toFixed(2)}</td><td className="p-2">{combo.meetsTarget ? 'Memenuhi' : 'Belum memenuhi'}</td></tr>)}</tbody></table></div>;
            })()}
            <p className="text-xs font-semibold text-slate-800">{summary.recommendation}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
