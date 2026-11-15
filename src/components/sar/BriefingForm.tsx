'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

/**
 * Briefing & Debriefing SRU form — based on Perban 3 Tahun 2020 format.
 * Editable form with fields for operational SAR briefing and debriefing.
 */

interface BriefingData {
  operasiSar: string;
  tanggal: string;
  namaKapal: string;
  namaNahkoda: string;
  infoKecelakaan: string;
  dataKapal: string;
  jumlahPOB: string;
  frekuensi: string;
  areaLuas: string;
  areaKoordinat: string;
  polaPencarian: string;
  ketinggian: string;
  dataCuaca: string;
  csp: string;
  komunikasi: string;
  // Debriefing fields
  titikBerangkat: string;
  pointLanding: string;
  waktuBerangkat: string;
  waktuTiba: string;
  posisiArea: string;
  kendala: string;
  jumlahObserver: string;
  kondisiCuaca: string;
  objekPencarian: string;
  jumlahKorban: string;
  infoLain: string;
  komunikasiDebrief: string;
  halLain: string;
  nama: string;
}

export default function BriefingForm() {
  const [data, setData] = useState<BriefingData>({
    operasiSar: '',
    tanggal: '',
    namaKapal: '',
    namaNahkoda: '',
    infoKecelakaan: '',
    dataKapal: '',
    jumlahPOB: '',
    frekuensi: '',
    areaLuas: '',
    areaKoordinat: '',
    polaPencarian: '',
    ketinggian: '',
    dataCuaca: '',
    csp: '',
    komunikasi: '',
    titikBerangkat: '',
    pointLanding: '',
    waktuBerangkat: '',
    waktuTiba: '',
    posisiArea: '',
    kendala: '',
    jumlahObserver: '',
    kondisiCuaca: '',
    objekPencarian: '',
    jumlahKorban: '',
    infoLain: '',
    komunikasiDebrief: '',
    halLain: '',
    nama: '',
  });

  const update = (field: keyof BriefingData, value: string) => {
    setData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-4 print:space-y-2">
      {/* BRIEFING */}
      <Card className="border-blue-200 shadow-sm">
        <CardHeader className="bg-blue-50 pb-2">
          <CardTitle className="text-sm">Briefing Unit Pencarian dan Pertolongan</CardTitle>
          <CardDescription className="text-xs">Format Perban 3 Tahun 2020</CardDescription>
        </CardHeader>
        <CardContent className="pt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Operasi SAR" value={data.operasiSar} onChange={(v) => update('operasiSar', v)} />
            <FormField label="Tanggal" value={data.tanggal} onChange={(v) => update('tanggal', v)} />
            <FormField label="Nama kapal/pesawat pencari" value={data.namaKapal} onChange={(v) => update('namaKapal', v)} />
            <FormField label="Nama Nahkoda/Pilot" value={data.namaNahkoda} onChange={(v) => update('namaNahkoda', v)} />
          </div>
          <FormField label="Informasi kecelakaan" value={data.infoKecelakaan} onChange={(v) => update('infoKecelakaan', v)} multiline />
          <FormField label="Data kapal/pesawat yang dicari" value={data.dataKapal} onChange={(v) => update('dataKapal', v)} multiline />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Jumlah POB" value={data.jumlahPOB} onChange={(v) => update('jumlahPOB', v)} />
            <FormField label="Frekuensi objek yang dicari" value={data.frekuensi} onChange={(v) => update('frekuensi', v)} />
          </div>
          <FormField label="Luas/lokasi area pencarian" value={data.areaLuas} onChange={(v) => update('areaLuas', v)} multiline />
          <FormField label="Koordinat area pencarian" value={data.areaKoordinat} onChange={(v) => update('areaKoordinat', v)} multiline />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Pola pencarian" value={data.polaPencarian} onChange={(v) => update('polaPencarian', v)} />
            <FormField label="Ketinggian pesawat" value={data.ketinggian} onChange={(v) => update('ketinggian', v)} />
          </div>
          <FormField label="Data cuaca" value={data.dataCuaca} onChange={(v) => update('dataCuaca', v)} multiline />
          <FormField label="Koordinat CSP (Commence Search Point)" value={data.csp} onChange={(v) => update('csp', v)} />
          <FormField label="Komunikasi" value={data.komunikasi} onChange={(v) => update('komunikasi', v)} multiline />
        </CardContent>
      </Card>

      {/* DEBRIEFING */}
      <Card className="border-amber-200 shadow-sm">
        <CardHeader className="bg-amber-50 pb-2">
          <CardTitle className="text-sm">Debriefing Unit Pencarian dan Pertolongan</CardTitle>
        </CardHeader>
        <CardContent className="pt-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Titik keberangkatan" value={data.titikBerangkat} onChange={(v) => update('titikBerangkat', v)} />
            <FormField label="Point of landing" value={data.pointLanding} onChange={(v) => update('pointLanding', v)} />
            <FormField label="Waktu berangkat" value={data.waktuBerangkat} onChange={(v) => update('waktuBerangkat', v)} />
            <FormField label="Waktu tiba" value={data.waktuTiba} onChange={(v) => update('waktuTiba', v)} />
          </div>
          <FormField label="Posisi/Koordinat/Area pencarian" value={data.posisiArea} onChange={(v) => update('posisiArea', v)} multiline />
          <FormField label="Pola pencarian" value={data.polaPencarian} onChange={(v) => update('polaPencarian', v)} />
          <FormField label="Kendala di lapangan" value={data.kendala} onChange={(v) => update('kendala', v)} multiline />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormField label="Jumlah observer" value={data.jumlahObserver} onChange={(v) => update('jumlahObserver', v)} />
            <FormField label="Kondisi cuaca (angin, jarak pandang)" value={data.kondisiCuaca} onChange={(v) => update('kondisiCuaca', v)} />
          </div>
          <FormField label="Objek pencarian" value={data.objekPencarian} onChange={(v) => update('objekPencarian', v)} multiline />
          <FormField label="Jumlah dan kondisi korban" value={data.jumlahKorban} onChange={(v) => update('jumlahKorban', v)} multiline />
          <FormField label="Informasi lain yang didapat" value={data.infoLain} onChange={(v) => update('infoLain', v)} multiline />
          <FormField label="Komunikasi (frekuensi, alat)" value={data.komunikasiDebrief} onChange={(v) => update('komunikasiDebrief', v)} multiline />
          <FormField label="Hal-hal lain yang perlu disampaikan" value={data.halLain} onChange={(v) => update('halLain', v)} multiline />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
            <FormField label="Tanggal" value={data.tanggal} onChange={(v) => update('tanggal', v)} />
            <FormField label="Nama" value={data.nama} onChange={(v) => update('nama', v)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FormField({ label, value, onChange, multiline }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return (
    <div>
      <Label className="text-[10px] text-slate-500">{label}</Label>
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="mt-0.5 text-xs min-h-[40px]"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-0.5 h-8 text-xs"
        />
      )}
    </div>
  );
}
