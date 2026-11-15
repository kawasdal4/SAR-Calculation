'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, Printer, Save, RefreshCw } from 'lucide-react';
import { type LatLng } from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import type { DatumResults } from '@/components/sar/DatumWorksheet';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';

interface BriefingFormProps {
  lkp?: LatLng;
  datumResults?: DatumResults | null;
  searchResults?: SearchPlanResults | null;
  aswDirFrom?: number;
  aswSpeed?: number;
  className?: string;
}

export default function BriefingForm({
  lkp = { lat: -6.1, lng: 106.8 },
  datumResults,
  searchResults,
  aswDirFrom = 90,
  aswSpeed = 15,
  className = '',
}: BriefingFormProps) {
  // Auto-filled state
  const [formData, setFormData] = useState({
    opTitle: 'Operasi SAR Kecelakaan Kapal / Pesawat',
    date: new Date().toISOString().split('T')[0],
    sruName: 'KN SAR Yudistira / HR-3601',
    captainPilot: 'Capt. Hendra / Pilot Mayor Pnb Bagus',
    accidentDetails:
      'Kapal nelayan mengalami mati mesin dan hilang kontak di perairan setelah cuaca buruk.',
    targetDetails: 'KM Baruna 02 (Panjang 18m, Kayu Lambung Biru Putih)',
    pobCount: '5 Orang POB (Semua Laki-laki)',
    targetFrequencies: 'VHF Ch. 16 (156.800 MHz) / EPIRB 406 MHz',
    searchAreaDesc: searchResults
      ? `Luas Area: ${searchResults.Ao.toFixed(0)} NM², Dimensi: ${searchResults.searchAreaLength.toFixed(1)} × ${searchResults.searchAreaWidth.toFixed(1)} NM`
      : 'Luas Area: 400 NM²',
    searchAreaCoords: datumResults
      ? `A: ${formatDMS(datumResults.datumLeft.lat + 0.1, false)} - ${formatDMS(datumResults.datumLeft.lng - 0.1, true)}\nB: ${formatDMS(datumResults.datumRight.lat + 0.1, false)} - ${formatDMS(datumResults.datumRight.lng + 0.1, true)}\nC: ${formatDMS(datumResults.datumRight.lat - 0.1, false)} - ${formatDMS(datumResults.datumRight.lng + 0.1, true)}\nD: ${formatDMS(datumResults.datumLeft.lat - 0.1, false)} - ${formatDMS(datumResults.datumLeft.lng - 0.1, true)}`
      : 'A: 06°00\'00"S - 106°40\'00"E\nB: 06°00\'00"S - 107°00\'00"E\nC: 06°20\'00"S - 107°00\'00"E\nD: 06°20\'00"S - 106°40\'00"E',
    searchPattern: 'Parallel Track Search (PS) — Track Spacing 1.5 NM',
    aircraftAltitude: 'Air Asset: 500 - 1000 ft AGL / Maritime: Sea Level',
    weatherData: `Angin: ${aswDirFrom}°T / ${aswSpeed} kts, Cuaca: Berawan, Gelombang: 1.0 - 1.5m, Visibilitas: 5 - 8 NM`,
    cspCoords: searchResults
      ? `CSP: ${formatDMS(searchResults.searchAreaCenter.lat, false)}, ${formatDMS(searchResults.searchAreaCenter.lng, true)}`
      : 'CSP: 06°05\'00"S, 106°45\'00"E',
    commsFreqs:
      'Kansar Primary: HF 5828 kHz / VHF Marine Ch. 16, Working Ch. 68 / Inter-SRU VHF Ch. 72',

    // Debriefing Section
    pointOfDeparture: 'Dermaga Basarnas / Lanud',
    pointOfLanding: 'Dermaga Basarnas / Lanud',
    depTime: '07:00 WIB',
    arrTime: '13:00 WIB',
    fieldObstacles: 'Gelombang laut 1.5m dan arus permukaan cukup kuat.',
    observerCount: '6 Personel Observer + 2 Teropong Binokular',
    victimFoundStatus: 'Korban belum ditemukan / Pencarian dilanjutkan hari berikutnya.',
    otherNotes: 'Ditemukan serpihan jeriken dan pelampung oranye di sektor tenggara sub-area.',
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
            <FileText className="h-5 w-5 text-slate-700" />
            <div>
              <CardTitle className="text-base font-bold text-slate-900">
                FORM BRIEFING & DEBRIEFING SRU
              </CardTitle>
              <p className="text-xs text-slate-500 font-mono">
                Peraturan Badan Nasional Pencarian dan Pertolongan (Perban No. 3 Tahun 2020)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 text-xs bg-slate-900 hover:bg-slate-800 text-white font-semibold px-3 py-1.5 rounded transition-colors"
          >
            <Printer className="h-4 w-4" /> Cetak Form (Print)
          </button>
        </CardHeader>

        <CardContent className="p-6 space-y-6 text-slate-800">
          {/* Header Basarnas */}
          <div className="text-center border-b-2 border-slate-900 pb-3">
            <h2 className="text-base font-bold uppercase tracking-wider text-slate-900">
              BADAN NASIONAL PENCARIAN DAN PERTOLONGAN (BASARNAS)
            </h2>
            <h3 className="text-sm font-semibold uppercase text-slate-700 mt-0.5">
              BRIEFING UNIT PENCARIAN DAN PERTOLONGAN (SRU) OPERASI SAR
            </h3>
            <p className="text-xs text-slate-500 mt-1">Standar Formulir Perban 3/2020</p>
          </div>

          {/* Form Briefing Section */}
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  1. Nama Operasi SAR:
                </label>
                <input
                  type="text"
                  value={formData.opTitle}
                  suppressHydrationWarning onChange={(e) => updateField('opTitle', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">2. Tanggal:</label>
                <input
                  type="text"
                  value={formData.date}
                  onChange={(e) => updateField('date', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  3. Nama Kapal / Pesawat Pencari (SRU):
                </label>
                <input
                  type="text"
                  value={formData.sruName}
                  onChange={(e) => updateField('sruName', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  4. Nama Nahkoda / Pilot in Command:
                </label>
                <input
                  type="text"
                  value={formData.captainPilot}
                  onChange={(e) => updateField('captainPilot', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                5. Informasi Detail Kecelakaan / KMM / Bencana:
              </label>
              <textarea
                rows={2}
                value={formData.accidentDetails}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => updateField('accidentDetails', e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-sans"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  6. Objek yang Dicari:
                </label>
                <input
                  type="text"
                  value={formData.targetDetails}
                  suppressHydrationWarning onChange={(e) => updateField('targetDetails', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium"
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  7. Jumlah POB (Person on Board):
                </label>
                <input
                  type="text"
                  value={formData.pobCount}
                  onChange={(e) => updateField('pobCount', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  8. Frekuensi Objek / EPIRB:
                </label>
                <input
                  type="text"
                  value={formData.targetFrequencies}
                  onChange={(e) => updateField('targetFrequencies', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  9. Area Pencarian (Luas & Dimensi):
                </label>
                <input
                  type="text"
                  value={formData.searchAreaDesc}
                  onChange={(e) => updateField('searchAreaDesc', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  10. Pola Pencarian & Track Spacing:
                </label>
                <input
                  type="text"
                  value={formData.searchPattern}
                  onChange={(e) => updateField('searchPattern', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                11. Koordinat Batas Area Pencarian:
              </label>
              <textarea
                rows={3}
                value={formData.searchAreaCoords}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => updateField('searchAreaCoords', e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-mono text-[11px]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  12. Kondisi Cuaca & Lingkungan:
                </label>
                <input
                  type="text"
                  value={formData.weatherData}
                  onChange={(e) => updateField('weatherData', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="font-bold text-slate-700 block mb-1">
                  13. Titik Mulai (CSP):
                </label>
                <input
                  type="text"
                  value={formData.cspCoords}
                  onChange={(e) => updateField('cspCoords', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
                />
              </div>
            </div>

            <div>
              <label className="font-bold text-slate-700 block mb-1">
                14. Rencana Komunikasi:
              </label>
              <input
                type="text"
                value={formData.commsFreqs}
                onChange={(e) => updateField('commsFreqs', e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-medium" suppressHydrationWarning
              />
            </div>
          </div>

          {/* Debriefing Section */}
          <div className="border-t-2 border-slate-300 pt-4 space-y-4 text-xs">
            <h3 className="text-sm font-bold uppercase text-slate-900 border-b border-slate-200 pb-1">
              DEBRIEFING UNIT PENCARIAN DAN PERTOLONGAN (SETELAH SORTIE)
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-slate-600 block mb-1">Titik Keberangkatan:</label>
                <input
                  type="text"
                  value={formData.pointOfDeparture}
                  onChange={(e) => updateField('pointOfDeparture', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1">Titik Pendaratan:</label>
                <input
                  type="text"
                  value={formData.pointOfLanding}
                  onChange={(e) => updateField('pointOfLanding', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1">Waktu Berangkat:</label>
                <input
                  type="text"
                  value={formData.depTime}
                  onChange={(e) => updateField('depTime', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1">Waktu Tiba:</label>
                <input
                  type="text"
                  value={formData.arrTime}
                  onChange={(e) => updateField('arrTime', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5" suppressHydrationWarning
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-slate-600 block mb-1">Kendala di Lapangan:</label>
                <input
                  type="text"
                  value={formData.fieldObstacles}
                  onChange={(e) => updateField('fieldObstacles', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5" suppressHydrationWarning
                />
              </div>
              <div>
                <label className="text-slate-600 block mb-1">Hasil & Temuan Korban:</label>
                <input
                  type="text"
                  value={formData.victimFoundStatus}
                  onChange={(e) => updateField('victimFoundStatus', e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded p-1.5 font-bold" suppressHydrationWarning
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
