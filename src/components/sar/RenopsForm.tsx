'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * Rencana Operasi Pencarian dan Pertolongan (RENOPS) form.
 * Based on Perban 3 Tahun 2020 format.
 */

export default function RenopsForm() {
  const [data, setData] = useState<Record<string, string>>({});
  const update = (field: string, value: string) => setData((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-4 print:space-y-2">
      <Card className="border-slate-700 shadow-sm">
        <CardHeader className="bg-slate-800 text-white pb-2">
          <CardTitle className="text-sm">RENCANA OPERASI PENCARIAN DAN PERTOLONGAN</CardTitle>
          <CardDescription className="text-xs text-slate-300">Perban 3 Tahun 2020</CardDescription>
        </CardHeader>
        <CardContent className="pt-3 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Hari ke-" value={data.hariKe} onChange={(v) => update('hariKe', v)} />
            <Field label="Kecelakaan Kapal/Pesawat" value={data.kapal} onChange={(v) => update('kapal', v)} />
          </div>

          {/* A. SITUASI */}
          <Section title="A. SITUASI" />
          <SubSection title="1. Tahap Menyadari (Awareness Stage)" />
          <Field label="Pada TW" value={data.tw} onChange={(v) => update('tw', v)} multiline />
          <Field label="Jenis kecelakaan" value={data.jenisKecelakaan} onChange={(v) => update('jenisKecelakaan', v)} multiline />

          {/* Data table */}
          <div className="border border-slate-300 rounded overflow-x-auto">
            <table className="w-full text-[10px]">
              <tbody>
                {[
                  ['Nama Kapal/Pesawat', 'callSign'],
                  ['Lokasi/Posisi Kecelakaan', 'lokasi'],
                  ['Rute Kapal/Pesawat', 'rute'],
                  ['Waktu Kejadian', 'waktuKejadian'],
                  ['Jenis Kapal/Pesawat', 'jenisKapal'],
                  ['Bendera', 'bendera'],
                  ['Penyebab Kecelakaan', 'penyebab'],
                  ['Objek yang Dicari', 'objekDicari'],
                  ['Jumlah Crew', 'crew'],
                  ['Jumlah Penumpang', 'penumpang'],
                  ['Upaya yang Telah Dilakukan', 'upaya'],
                  ['Jumlah Korban dalam Pencarian', 'korban'],
                  ['Muatan', 'muatan'],
                  ['Catatan', 'catatan'],
                ].map(([label, field]) => (
                  <tr key={field} className="border-b border-slate-200 last:border-0">
                    <td className="px-2 py-1 font-medium text-slate-600 w-1/3 bg-slate-50">{label}</td>
                    <td className="px-2 py-1">
                      <input
                        type="text"
                        value={data[field] || ''}
                        onChange={(e) => update(field, e.target.value)}
                        className="w-full text-[10px] outline-none bg-transparent"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Field label="b. Peta Lokasi Kejadian" value={data.petaKejadian} onChange={(v) => update('petaKejadian', v)} />
          <Field label="c. Peta Lokasi Penemuan Objek" value={data.petaPenemuan} onChange={(v) => update('petaPenemuan', v)} />

          <SubSection title="2. Tahap Tindak Awal (Initial Action Stage)" />
          <Field label="a. Upaya sebelumnya" value={data.upayaSebelumnya} onChange={(v) => update('upayaSebelumnya', v)} multiline />
          <Field label="b. Persiapan SRU (Udara/Laut/Darat)" value={data.persiapanSRU} onChange={(v) => update('persiapanSRU', v)} multiline />

          {/* B. TUGAS */}
          <Section title="B. TUGAS" />
          <Field label="Melaksanakan operasi SAR korban" value={data.tugas} onChange={(v) => update('tugas', v)} multiline />

          {/* C. PELAKSANAAN */}
          <Section title="C. PELAKSANAAN" />
          <SubSection title="1. Planning Stage (Tahap Perencanaan)" />
          <Field label="a. Waktu" value={data.waktuPlanning} onChange={(v) => update('waktuPlanning', v)} />
          <SubSection title="b. Area Pencarian" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Luas area pencarian (NM²)" value={data.luasArea} onChange={(v) => update('luasArea', v)} />
            <Field label="Posisi Datum" value={data.posisiDatum} onChange={(v) => update('posisiDatum', v)} />
          </div>
          <Field label="Koordinat area pencarian (A, B, C, D)" value={data.koordinatArea} onChange={(v) => update('koordinatArea', v)} multiline />

          <SubSection title="c. Alokasi Unsur SAR" />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Udara" value={data.alokasiUdara} onChange={(v) => update('alokasiUdara', v)} multiline />
            <Field label="Laut" value={data.alokasiLaut} onChange={(v) => update('alokasiLaut', v)} multiline />
            <Field label="Darat" value={data.alokasiDarat} onChange={(v) => update('alokasiDarat', v)} multiline />
          </div>

          <SubSection title="d. Penugasan Unsur Pencarian" />
          <div className="border border-slate-300 rounded overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-2 py-1 text-left">Unsur</th>
                  <th className="px-2 py-1 text-left">Tugas</th>
                  <th className="px-2 py-1 text-left">Luas Area</th>
                  <th className="px-2 py-1 text-left">Pola</th>
                  <th className="px-2 py-1 text-left">Track Spacing</th>
                </tr>
              </thead>
              <tbody>
                {[1, 2, 3].map((i) => (
                  <tr key={i} className="border-t border-slate-200">
                    {[`penugasanUnsur${i}`, `penugasanTugas${i}`, `penugasanLuas${i}`, `penugasanPola${i}`, `penugasanTrack${i}`].map((field) => (
                      <td key={field} className="px-2 py-1">
                        <input
                          type="text"
                          value={data[field] || ''}
                          onChange={(e) => update(field, e.target.value)}
                          className="w-full text-[10px] outline-none bg-transparent"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Field label="e. Rencana Penyelamatan/Rescue Plan" value={data.rescuePlan} onChange={(v) => update('rescuePlan', v)} multiline />
          <Field label="f. Transportasi Korban" value={data.transportasi} onChange={(v) => update('transportasi', v)} multiline />
          <Field label="g. Briefing and Debriefing" value={data.briefingDebriefing} onChange={(v) => update('briefingDebriefing', v)} multiline />

          <SubSection title="2. Operation Stage (Tahap Operasi)" />
          <Field label="Tahap operasi SAR" value={data.operasiStage} onChange={(v) => update('operasiStage', v)} multiline />

          {/* D. ADMINISTRASI */}
          <Section title="D. ADMINISTRASI DAN LOGISTIK" />
          <Field label="Administrasi" value={data.administrasi} onChange={(v) => update('administrasi', v)} multiline />
          <Field label="Logistik" value={data.logistik} onChange={(v) => update('logistik', v)} multiline />

          {/* E. KOORDINASI */}
          <Section title="E. KOORDINASI, PENGENDALIAN DAN KOMUNIKASI" />
          <Field label="Jaring Komunikasi SAR" value={data.jaringKomunikasi} onChange={(v) => update('jaringKomunikasi', v)} multiline />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-4 border-t border-slate-200">
            <Field label="Tempat, tanggal" value={data.tempatTanggal} onChange={(v) => update('tempatTanggal', v)} />
            <Field label="Koordinator Misi Pencarian" value={data.koordinator} onChange={(v) => update('koordinator', v)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title }: { title: string }) {
  return <div className="text-xs font-bold text-slate-700 pt-2">{title}</div>;
}
function SubSection({ title }: { title: string }) {
  return <div className="text-[11px] font-semibold text-slate-600 pt-1">{title}</div>;
}
function Field({ label, value, onChange, multiline }: { label: string; value: string | undefined; onChange: (v: string) => void; multiline?: boolean }) {
  return (
    <div>
      <Label className="text-[10px] text-slate-500">{label}</Label>
      {multiline ? (
        <Textarea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={2} className="mt-0.5 text-xs min-h-[36px]" />
      ) : (
        <Input value={value || ''} onChange={(e) => onChange(e.target.value)} className="mt-0.5 h-8 text-xs" />
      )}
    </div>
  );
}
