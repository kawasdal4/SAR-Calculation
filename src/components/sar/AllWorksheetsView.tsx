'use client';

import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Printer, FileCheck, ArrowRight } from 'lucide-react';
import Worksheet1 from './worksheets/Worksheet1';
import Worksheet2 from './worksheets/Worksheet2';
import Worksheet3 from './worksheets/Worksheet3';
import Worksheet4 from './worksheets/Worksheet4';
import Worksheet8 from './worksheets/Worksheet8';
import AWAWorksheet from './AWAWorksheet';
import ASWWorksheet from './ASWWorksheet';
import AeronauticalDriftWorksheet from './AeronauticalDriftWorksheet';
import InterceptWorksheet from './InterceptWorksheet';
import BriefingForm from './BriefingForm';
import RenopsForm from './RenopsForm';
import AssetAllocationWorksheet from './AssetAllocationWorksheet';
import { type SruAssetInput } from '@/lib/sar/assetAllocation';
import { type LatLng } from '@/lib/sar/sarCalculations';
import type { DatumData, DatumResults } from '@/components/sar/DatumWorksheet';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';

interface AllWorksheetsViewProps {
  lkp: LatLng;
  datumData: DatumData | null;
  datumResults: DatumResults | null;
  searchResults: SearchPlanResults | null;
  aswDirFrom: number;
  aswSpeed: number;
  awaDirFrom: number;
  awaSpeed: number;
  csp?: LatLng;
  exitPoint?: LatLng;
  assets?: SruAssetInput[];
  onAssetsChange?: (assets: SruAssetInput[]) => void;
  className?: string;
}

export default function AllWorksheetsView({
  lkp,
  datumData,
  datumResults,
  searchResults,
  aswDirFrom,
  aswSpeed,
  awaDirFrom,
  awaSpeed,
  csp = { lat: -6.05, lng: 106.85 },
  exitPoint = { lat: -6.15, lng: 106.95 },
  assets = [
    {
      id: 'sru-1',
      name: 'KN SAR 246',
      type: 'rescue-vessel',
      homeBaseName: 'Pangkalan Tanjung Priok (Jakarta)',
      homeBasePos: { lat: -6.095, lng: 106.885 },
      transitSpeedKts: 18,
      searchSpeedKts: 12,
      enduranceHours: 12,
      daylightHours: 10,
      fuelReservePct: 15,
      sweepWidthNm: 2.5,
      targetCoverage: 1.0,
      assignedSubArea: 'Sub-Area 1',
    },
  ],
  onAssetsChange = () => {},
  className = '',
}: AllWorksheetsViewProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handlePrintAll = () => {
    window.print();
  };

  const ws1Ao = searchResults?.Ao ?? (datumResults ? 4 * Math.ceil(datumResults.E * 1.6) * Math.ceil(datumResults.E * 1.6) : 320);

  if (!mounted) {
    return (
      <div className="p-8 text-center text-slate-500 font-sans text-xs bg-white rounded-lg border border-slate-200">
        Memuat seluruh formulir lembar kerja operasi SAR...
      </div>
    );
  }

  const sections = [
    { id: 'sec-awa', label: '1. AWA (Winds Aloft)' },
    { id: 'sec-aero', label: '2. ADW (Aero Drift -> LKP)' },
    { id: 'sec-asw', label: '3. ASW (Surface Wind)' },
    { id: 'sec-ws1', label: '4. WS 1 (Maritime Planning)' },
    { id: 'sec-ws2', label: '5. WS 2 (Search Height)' },
    { id: 'sec-ws8', label: '6. WS 8 (Vessel Sweep Width)' },
    { id: 'sec-assets', label: '7. Alokasi Aset SRU' },
    { id: 'sec-ws3', label: '8. WS 3 (Land Search - Mandiri)' },
    { id: 'sec-ws4', label: '9. WS 4 (Search Radius - Mandiri)' },
    { id: 'sec-intercept', label: '10. Intercept' },
    { id: 'sec-briefing', label: '11. Briefing SAR' },
    { id: 'sec-renops', label: '12. Renops' },
  ];

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Top Banner & Quick Navigation */}
      <Card className="border-slate-300 shadow-sm bg-slate-50 print:hidden">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileCheck className="h-5 w-5 text-emerald-600" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Dokumentasi Lengkap Seluruh Lembar Kerja Operasi SAR (IAMSAR Manual Volume II)
              </h2>
              <p className="text-xs text-slate-600">
                Alur Berurutan: AWA → ADW (menghasilkan LKP) → ASW → Worksheet 1 (menghasilkan Ao) → Worksheet 2 & 8 → Worksheet 3 & 4 (mandiri).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handlePrintAll}
            className="flex items-center gap-2 text-xs bg-slate-900 hover:bg-slate-800 text-white font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
          >
            <Printer className="h-4 w-4" /> Cetak Seluruh Worksheet
          </button>
        </CardContent>

        {/* Workflow Chain Visualizer */}
        <div className="px-4 py-2.5 bg-emerald-50/70 border-t border-b border-emerald-200 text-[11px] text-emerald-950 flex flex-wrap items-center gap-1.5 font-medium">
          <span className="font-bold text-emerald-900">Alur Data Operasi SAR:</span>
          <span className="bg-white px-2 py-0.5 rounded border border-emerald-300 shadow-2xs">AWA (Mobo)</span>
          <ArrowRight className="h-3 w-3 text-emerald-600" />
          <span className="bg-white px-2 py-0.5 rounded border border-emerald-300 shadow-2xs">ADW (UPS) → LKP</span>
          <ArrowRight className="h-3 w-3 text-emerald-600" />
          <span className="bg-white px-2 py-0.5 rounded border border-emerald-300 shadow-2xs">ASW (Mobo)</span>
          <ArrowRight className="h-3 w-3 text-emerald-600" />
          <span className="bg-white px-2 py-0.5 rounded border border-emerald-300 shadow-2xs">WS 1 (WC, Datum, Ao)</span>
          <ArrowRight className="h-3 w-3 text-emerald-600" />
          <span className="bg-white px-2 py-0.5 rounded border border-emerald-300 shadow-2xs">WS 2 & WS 8 (menggunakan Ao)</span>
        </div>

        {/* Quick Jump Buttons */}
        <div className="px-4 py-2.5 flex flex-wrap gap-1.5">
          <span className="text-xs text-slate-500 font-semibold mr-1 self-center">
            Lompat ke:
          </span>
          {sections.map((sec) => (
            <button
              key={sec.id}
              type="button"
              onClick={() => scrollToSection(sec.id)}
              className="text-[11px] px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-200 transition-colors"
            >
              {sec.label}
            </button>
          ))}
        </div>
      </Card>

      {/* Render worksheets sequentially */}
      <div className="space-y-8">
        {/* 1. AVERAGE WIND ALOFT (AWA) WORKSHEET */}
        <section id="sec-awa" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-800 bg-sky-100 px-2 py-1 rounded">
              Langkah 1: Average Wind Aloft (AWA) Worksheet — Appendix K-10
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Menghitung rata-rata vektor angin atas berlapis untuk pergeseran parasut/pesawat yang diteruskan ke ADW.
            </p>
          </div>
          <AWAWorksheet
            onDataChange={() => {}}
            readOnly
          />
        </section>

        {/* 2. AERONAUTICAL DRIFT WORKSHEET (ADW -> LKP) */}
        <section id="sec-aero" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-sky-800 bg-sky-100 px-2 py-1 rounded">
              Langkah 2: Aeronautical Drift Worksheet (ADW) — Appendix K-6
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Hasil pendaratan parasut/pesawat (Landing Position) menetapkan titik koordinat <strong>LKP</strong> untuk operasi SAR berikutnya.
            </p>
          </div>
          <AeronauticalDriftWorksheet
            initialLkp={lkp}
            awaDirFrom={awaDirFrom}
            awaSpeedKts={awaSpeed}
          />
        </section>

        {/* 3. AVERAGE SURFACE WIND (ASW) WORKSHEET */}
        <section id="sec-asw" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-800 bg-blue-100 px-2 py-1 rounded">
              Langkah 3: Average Surface Wind (ASW) Worksheet — Appendix K-19
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Menghitung rata-rata vektor angin permukaan berdasarkan interval observasi untuk perhitungan Wind Current (WC) di Worksheet 1.
            </p>
          </div>
          <ASWWorksheet
            onDataChange={() => {}}
            readOnly
          />
        </section>

        {/* 4. WORKSHEET 1 (MARINE DATUM & SEARCH AREA AO) */}
        <section id="sec-ws1" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-800 bg-blue-100 px-2 py-1 rounded">
              Langkah 4: Worksheet 1 (Marine Datum Planning) — Appendix K-2
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Menggunakan ASW dari observasi angin permukaan untuk menghitung Wind Current (WC), Total Water Current (TWC), Leeway, Posisi Datum, dan Luas Search Area (Ao).
            </p>
          </div>
          <Worksheet1
            lkp={lkp}
            datumData={datumData}
            datumResults={datumResults}
            aswDirFrom={aswDirFrom}
            aswSpeed={aswSpeed}
            readOnly
          />
        </section>

        {/* 5. WORKSHEET 2 (MARITIME EVALUATION & SUB-AREA DECISION USING AO) */}
        <section id="sec-ws2" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-800 bg-indigo-100 px-2 py-1 rounded">
              Langkah 5: Worksheet No. 2 (Maritime) — Appendix K-3
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Evaluasi lebar sapuan multi-ketinggian (500, 1000, 1500, 2000 ft), coverage C, POD, dan alokasi luas pencarian (Ao) dari Worksheet 1.
            </p>
          </div>
          <Worksheet2
            lkp={lkp}
            datumData={datumData}
            datumResults={datumResults}
            aswDirFrom={aswDirFrom}
            ws1Ao={ws1Ao}
            readOnly
          />
        </section>

        {/* 6. WORKSHEET 8 (VESSEL SWEEP WIDTH EVALUATION USING AO) */}
        <section id="sec-ws8" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100 px-2 py-1 rounded">
              Langkah 6: Worksheet No. 8 — Appendix K-9
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Evaluasi sapuan kapal laut (Eye height 8 ft, 14 ft, MERSHIP), coverage C, POD, dan alokasi luas pencarian (Ao) dari Worksheet 1.
            </p>
          </div>
          <Worksheet8
            ws1Ao={ws1Ao}
            initialC={searchResults?.C ?? 1.0}
            initialPod={searchResults?.POD ?? 0.63}
            readOnly
          />
        </section>

        {/* 7. ALOKASI ASET SRU & KAPABILITAS UPAYA CARI (IAMSAR L-7) */}
        <section id="sec-assets" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-800 bg-purple-100 px-2 py-1 rounded">
              Langkah 7: Penghitungan Alokasi Aset SRU & Rute Transit
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Perhitungan waktu transit (Go & Back), ketahanan di lokasi (Tos), panjang lintasan, kemampuan sapuan (Zi), dan alokasi luas pencarian (Ai) tiap unit SRU terhadap target luas area Worksheet 1.
            </p>
          </div>
          <AssetAllocationWorksheet
            csp={csp}
            exitPoint={exitPoint}
            ws1Ao={ws1Ao}
            assets={assets}
            onAssetsChange={onAssetsChange}
          />
        </section>

        {/* 6. WORKSHEET 3 (LAND SEARCH - STANDALONE) */}
        <section id="sec-ws3" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 bg-slate-200 px-2 py-1 rounded">
              Worksheet No. 3 (Land) — Appendix K-4 (Mandiri)
            </span>
          </div>
          <Worksheet3
            searchResults={searchResults}
            E={datumResults?.E ?? 5.0}
            readOnly
          />
        </section>

        {/* 7. WORKSHEET 4 (SEARCH RADIUS - STANDALONE) */}
        <section id="sec-ws4" className="scroll-mt-6 print:break-after-page">
          <div className="mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 bg-slate-200 px-2 py-1 rounded">
              Worksheet No. 4 (Search Radius) — Appendix K-5 (Mandiri)
            </span>
          </div>
          <Worksheet4
            searchResults={searchResults}
            E={datumResults?.E ?? 5.0}
            divergenceDistance={datumResults?.divergenceDistance ?? 7.8}
            readOnly
          />
        </section>

        {/* 7. INTERCEPT CALCULATOR */}
        <section id="sec-intercept" className="scroll-mt-6 print:break-after-page">
          <InterceptWorksheet />
        </section>

        {/* 8. BRIEFING FORM (PERBAN 3/2020) */}
        <section id="sec-briefing" className="scroll-mt-6 print:break-after-page">
          <BriefingForm
            lkp={lkp}
            datumResults={datumResults}
            searchResults={searchResults}
            aswDirFrom={aswDirFrom}
            aswSpeed={aswSpeed}
          />
        </section>

        {/* 9. RENOPS FORM (RENCANA OPERASI SAR) */}
        <section id="sec-renops" className="scroll-mt-6 print:break-after-page">
          <RenopsForm
            lkp={lkp}
            datumResults={datumResults}
            searchResults={searchResults}
          />
        </section>
      </div>
    </div>
  );
}
