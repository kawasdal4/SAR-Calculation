'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardList, Printer } from 'lucide-react';
import { type LatLng } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import type { DatumResults } from '@/components/sar/DatumWorksheet';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';

interface RenopsFormProps {
  lkp?: LatLng;
  datumResults?: DatumResults | null;
  searchResults?: SearchPlanResults | null;
  className?: string;
}

export default function RenopsForm({
  lkp = { lat: 0, lng: 0 },
  datumResults,
  searchResults,
  className = '',
}: RenopsFormProps) {
  const [formData, setFormData] = useState({
    opDay: '-', accidentType: '-', targetName: '-', kansarName: '-', twInfo: '-',
    infoSource: '-', accidentTime: '-', callSign: '-', route: '-', pobCrew: '0',
    pobPassengers: '0', cause: '-', effortsDone: '-',

    // Section B: Task
    taskMission: '-',

    // Section C: Planning Stage
    searchAreaSize: searchResults ? `${searchResults.Ao.toFixed(0)} NM²` : '0',
    datumPos: datumResults
      ? `Datum Left: ${formatDMS(datumResults.datumLeft.lat, false)}, ${formatDMS(datumResults.datumLeft.lng, true)} | Datum Right: ${formatDMS(datumResults.datumRight.lat, false)}, ${formatDMS(datumResults.datumRight.lng, true)}`
      : '-',
    areaCoords: datumResults
      ? `A: ${formatDMS(datumResults.datumLeft.lat + 0.1, false)} - ${formatDMS(datumResults.datumLeft.lng - 0.1, true)}\nB: ${formatDMS(datumResults.datumRight.lat + 0.1, false)} - ${formatDMS(datumResults.datumRight.lng + 0.1, true)}\nC: ${formatDMS(datumResults.datumRight.lat - 0.1, false)} - ${formatDMS(datumResults.datumRight.lng + 0.1, true)}\nD: ${formatDMS(datumResults.datumLeft.lat - 0.1, false)} - ${formatDMS(datumResults.datumLeft.lng - 0.1, true)}`
      : '-',

    // SRU Resources
    sruAir: '-', sruSea: '-', sruLand: '-', equipment: '-',

    // Section D: Logistik
    logistics: '-',

    // Section E: Komando
    smcName: '-', oscName: '-', commsFreqs: '-',
  });

  const updateField = (key: string, val: string) => {
    setFormData((prev) => ({ ...prev, [key]: val }));
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={`space-y-4 ${className}`}>
      <Card className="border-slate-300 shadow-sm bg-white print:border-none print:shadow-none">
        <CardHeader className="bg-slate-100 border-b border-slate-300 py-3 px-4 flex flex-row items-center justify-between print:hidden">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-slate-700" />
            <div>
              <CardTitle className="text-base font-bold text-slate-900">
                RENCANA OPERASI SAR (RENOPS)
              </CardTitle>
              <p className="text-xs text-slate-500 font-mono">
                Standar Format Operasi Pencarian dan Pertolongan (Perban 3/2020)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-white font-semibold px-3 py-1.5 rounded transition-colors"
          >
            <Printer className="h-4 w-4" /> Cetak Renops (Print)
          </button>
        </CardHeader>

        <CardContent className="p-6 space-y-6 text-slate-800 text-xs">
          {/* Header Renops */}
          <div className="text-center border-b-2 border-slate-900 pb-3">
            <h2 className="text-base font-bold uppercase tracking-wider text-slate-900">
              RENCANA OPERASI PENCARIAN DAN PERTOLONGAN {formData.opDay}
            </h2>
            <h3 className="text-sm font-semibold uppercase text-slate-700 mt-0.5">
              {formData.accidentType} {formData.targetName}
            </h3>
            <p className="text-xs text-slate-500 mt-1">{formData.kansarName}</p>
          </div>

          {/* Section A: SITUASI */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold uppercase text-slate-900 border-b border-slate-200 pb-1">
              A. SITUASI
            </h3>
            <div className="space-y-2">
              <p className="font-semibold text-slate-800">1. Tahap Menyadari (Awareness Stage):</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-4">
                <div>
                  <span className="text-slate-600 block">Waktu Terima Berita:</span>
                  <input
                    type="text"
                    value={formData.twInfo}
                    suppressHydrationWarning onChange={(e) => updateField('twInfo', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1 font-mono"
                  />
                </div>
                <div>
                  <span className="text-slate-600 block">Sumber Informasi:</span>
                  <input
                    type="text"
                    value={formData.infoSource}
                    onChange={(e) => updateField('infoSource', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1" suppressHydrationWarning
                  />
                </div>
                <div>
                  <span className="text-slate-600 block">Nama & Jenis Objek:</span>
                  <input
                    type="text"
                    value={`${formData.accidentType} - ${formData.targetName}`}
                    onChange={(e) => updateField('targetName', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1" suppressHydrationWarning
                  />
                </div>
                <div>
                  <span className="text-slate-600 block">Call Sign / MMSI:</span>
                  <input
                    type="text"
                    value={formData.callSign}
                    onChange={(e) => updateField('callSign', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1 font-mono" suppressHydrationWarning
                  />
                </div>
                <div>
                  <span className="text-slate-600 block">Rute Perjalanan:</span>
                  <input
                    type="text"
                    value={formData.route}
                    onChange={(e) => updateField('route', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1" suppressHydrationWarning
                  />
                </div>
                <div>
                  <span className="text-slate-600 block">Jumlah POB:</span>
                  <input
                    type="text"
                    value={formData.pobCrew}
                    onChange={(e) => updateField('pobCrew', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1 font-bold" suppressHydrationWarning
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <p className="font-semibold text-slate-800">2. Tahap Tindak Awal (Initial Action Stage):</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pl-4">
                <div>
                  <span className="text-slate-600 block">SRU Udara:</span>
                  <input
                    type="text"
                    value={formData.sruAir}
                    onChange={(e) => updateField('sruAir', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1" suppressHydrationWarning
                  />
                </div>
                <div>
                  <span className="text-slate-600 block">SRU Laut:</span>
                  <input
                    type="text"
                    value={formData.sruSea}
                    onChange={(e) => updateField('sruSea', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1" suppressHydrationWarning
                  />
                </div>
                <div>
                  <span className="text-slate-600 block">SRU Darat:</span>
                  <input
                    type="text"
                    value={formData.sruLand}
                    onChange={(e) => updateField('sruLand', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1" suppressHydrationWarning
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Section B: TUGAS */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold uppercase text-slate-900 border-b border-slate-200 pb-1">
              B. TUGAS
            </h3>
            <textarea
              rows={2}
              value={formData.taskMission}
              suppressHydrationWarning
              spellCheck={false}
              data-ms-editor="true"
              onChange={(e) => updateField('taskMission', e.target.value)}
              className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium"
            />
          </div>

          {/* Section C: PELAKSANAAN */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold uppercase text-slate-900 border-b border-slate-200 pb-1">
              C. PELAKSANAAN
            </h3>
            <div className="space-y-2 pl-2">
              <p className="font-semibold text-slate-800">1. Tahap Perencanaan (Planning Stage):</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-4">
                <div>
                  <span className="text-slate-600 block">Luas Area Pencarian:</span>
                  <input
                    type="text"
                    value={formData.searchAreaSize}
                    suppressHydrationWarning onChange={(e) => updateField('searchAreaSize', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1 font-bold text-emerald-800"
                  />
                </div>
                <div>
                  <span className="text-slate-600 block">Posisi Datum:</span>
                  <input
                    type="text"
                    value={formData.datumPos}
                    onChange={(e) => updateField('datumPos', e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded p-1 font-mono text-[11px]" suppressHydrationWarning
                  />
                </div>
              </div>
              <div className="pl-4 pt-1">
                <span className="text-slate-600 block">Koordinat Batas Area Pencarian:</span>
                <textarea
                  rows={3}
                  value={formData.areaCoords}
                  suppressHydrationWarning
                  spellCheck={false}
                  data-ms-editor="true"
                  onChange={(e) => updateField('areaCoords', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-mono text-[11px]"
                />
              </div>
            </div>
          </div>

          {/* Section D & E: LOGISTIK & KOMANDO */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h3 className="text-sm font-bold uppercase text-slate-900 border-b border-slate-200 pb-1">
                D. ADMINISTRASI & LOGISTIK
              </h3>
              <textarea
                rows={3}
                value={formData.logistics}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => updateField('logistics', e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded p-1.5"
              />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold uppercase text-slate-900 border-b border-slate-200 pb-1">
                E. INSTRUKSI KOMANDO & KENDALI
              </h3>
              <div className="space-y-1">
                <input
                  type="text"
                  placeholder="SMC"
                  value={`SMC: ${formData.smcName}`}
                  onChange={(e) => updateField('smcName', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1" suppressHydrationWarning
                />
                <input
                  type="text"
                  placeholder="OSC"
                  value={`OSC: ${formData.oscName}`}
                  onChange={(e) => updateField('oscName', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1" suppressHydrationWarning
                />
                <input
                  type="text"
                  placeholder="Komunikasi"
                  value={formData.commsFreqs}
                  onChange={(e) => updateField('commsFreqs', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1 font-mono" suppressHydrationWarning
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
