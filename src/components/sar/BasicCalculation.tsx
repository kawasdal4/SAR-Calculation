'use client';

/**
 * Tab "Penghitungan Dasar" — materi Introduction to SAR Calculation
 * (Ipuk Prasetyarin, Diklat SARPLAN Angkatan XL, Jakarta, 26 Oktober 2026).
 *
 * Berisi: konsep S/T/V/A, konverter jarak, konversi waktu desimal ↔ jam-menit-detik,
 * konversi zona waktu (UTC/WIB/WITA/WIT), kalkulator S·V·T + konversi kecepatan,
 * kalkulator A·T·V·S + jumlah unit pencari, dan bank latihan dengan pembahasan.
 */

import { useMemo, useState } from 'react';
import {
  BookOpen,
  Clock,
  Gauge,
  Globe,
  Grid3x3,
  Ruler,
  RotateCcw,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
import { WorksheetCard } from '@/components/sar/WorksheetCard';
import {
  calcSearchers,
  convertCmPerSecond,
  convertDistance,
  convertMeterPerSecond,
  convertSpeed,
  decimalHoursToHms,
  DISTANCE_UNITS,
  DISTANCE_UNIT_ORDER,
  formatDurationDays,
  formatDuration,
  formatHhmm,
  formatId,
  hmsToDecimalHours,
  solveArea,
  solveSvt,
  SPEED_UNITS,
  SPEED_UNIT_ORDER,
  sweptPercentage,
  TIMEZONES,
  TZ_ZONE_ORDER,
  convertTimezone,
  type DistanceUnit,
  type SpeedUnit,
  type TzZone,
} from '@/lib/sar/basicCalculations';

// ---------------------------------------------------------------------------
// Helper kecil
// ---------------------------------------------------------------------------

/** Parse input teks → angka | null (string kosong = belum diisi). */
function parseNum(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function NumField({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  id,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  suffix?: string;
  id?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[11px] font-medium text-slate-600">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step="any"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-9 w-full pr-12"
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

function UnitSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  ariaLabel?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className="w-full shrink-0" aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FormulaBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs text-emerald-700">
      {children}
    </div>
  );
}

function ResultHighlight({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
      <span className="text-xs font-semibold text-emerald-800">{label}</span>
      <span className="font-mono text-sm font-bold text-emerald-900">{value}</span>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
      {text}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Bagian 1 — KONSEP
// ---------------------------------------------------------------------------

const SYMBOL_ROWS: { symbol: string; term: string; meaning: string; units: string }[] = [
  {
    symbol: 'S',
    term: 'Jarak',
    meaning: 'Jarak antara dua tempat yang dinyatakan dalam satuan panjang.',
    units: 'km · m · cm · nm (mil laut) · inch · feet · yard',
  },
  {
    symbol: 'T',
    term: 'Waktu',
    meaning: 'Waktu yang dinyatakan dalam satuan waktu.',
    units: 'jam (hrs) · menit · detik',
  },
  {
    symbol: 'V',
    term: 'Kecepatan',
    meaning: 'Laju perpindahan suatu obyek terhadap waktu — seberapa cepat suatu objek bergerak.',
    units: 'km/jam · m/s · cm/s · nm/jam (knot)',
  },
  {
    symbol: 'A',
    term: 'Area / Luasan',
    meaning: 'Luasan yang disapu dalam satuan luas.',
    units: 'km² · m² · nm²',
  },
];

const LEARNING_GOALS = [
  'Memahami pengertian luasan, waktu, kecepatan dan jarak.',
  'Menyebutkan arti simbol A, T, V dan S.',
  'Menghitung luasan, waktu, kecepatan dan jarak.',
  'Mengkonversi satuan waktu, kecepatan dan jarak.',
  'Mengkonversi waktu berdasarkan perbedaan zona waktu.',
  'Mengubah satuan waktu desimal menjadi satuan hari, jam, menit dan detik, atau sebaliknya.',
];

function ConceptSection() {
  return (
    <div className="space-y-4">
      <WorksheetCard title="Simbol & Pengertian" badge="Sasaran 1–2">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 text-center">Simbol</TableHead>
              <TableHead className="w-32">Istilah</TableHead>
              <TableHead>Pengertian</TableHead>
              <TableHead>Satuan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {SYMBOL_ROWS.map((row) => (
              <TableRow key={row.symbol}>
                <TableCell className="text-center font-mono text-lg font-bold text-emerald-700">
                  {row.symbol}
                </TableCell>
                <TableCell className="font-medium text-slate-800">{row.term}</TableCell>
                <TableCell className="text-xs text-slate-600">{row.meaning}</TableCell>
                <TableCell className="text-xs text-slate-500">{row.units}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </WorksheetCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <WorksheetCard title="Rumus Jarak · Waktu · Kecepatan" badge="S·V·T">
          <div className="space-y-2">
            <FormulaBox>S = V × T</FormulaBox>
            <FormulaBox>T = S / V</FormulaBox>
            <FormulaBox>V = S / T</FormulaBox>
            <p className="text-xs text-slate-500">
              Trik mengingat: tutup variabel yang dicari pada segitiga S-V-T — sisa rumusnya akan
              muncul sendiri.
            </p>
          </div>
        </WorksheetCard>

        <WorksheetCard title="Rumus Area · Waktu · Kecepatan · Spacing" badge="A·T·V·S">
          <div className="space-y-2">
            <FormulaBox>A = T × V × S</FormulaBox>
            <FormulaBox>T = A / (V × S)</FormulaBox>
            <FormulaBox>V = A / (T × S)</FormulaBox>
            <FormulaBox>S = A / (T × V)</FormulaBox>
            <p className="text-xs text-slate-500">
              Jumlah unit pencari: <span className="font-mono">n = A / (T × V × S)</span> — hasil
              dibulatkan ke atas (ceil).
            </p>
          </div>
        </WorksheetCard>
      </div>

      <WorksheetCard title="Sasaran Pembelajaran" badge="6 Sasaran">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600">
          {LEARNING_GOALS.map((goal, i) => (
            <li key={i}>{goal}</li>
          ))}
        </ol>
      </WorksheetCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bagian 2 — KONVERSI JARAK
// ---------------------------------------------------------------------------

function DistanceSection() {
  const [value, setValue] = useState('1');
  const [from, setFrom] = useState<DistanceUnit>('m');
  const num = parseNum(value);
  const results = useMemo(
    () => (num === null ? null : convertDistance(num, from)),
    [num, from],
  );

  return (
    <div className="space-y-4">
      <WorksheetCard title="Konverter Jarak" badge="S">
        <div className="grid grid-cols-[1fr_11rem] items-end gap-2">
          <NumField
            id="dist-value"
            label="Nilai jarak"
            value={value}
            onChange={setValue}
            placeholder="Contoh: 1,5"
          />
          <div className="space-y-1">
            <Label className="text-[11px] font-medium text-slate-600">Satuan asal</Label>
            <UnitSelect
              value={from}
              onChange={setFrom}
              ariaLabel="Satuan jarak asal"
              options={DISTANCE_UNIT_ORDER.map((u) => ({ value: u, label: DISTANCE_UNITS[u].label }))}
            />
          </div>
        </div>

        <div className="mt-4">
          {results ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Satuan</TableHead>
                  <TableHead className="text-right">Hasil konversi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {DISTANCE_UNIT_ORDER.map((unit) => (
                  <TableRow key={unit} className={unit === from ? 'bg-emerald-50/60' : ''}>
                    <TableCell className="text-xs text-slate-600">
                      {DISTANCE_UNITS[unit].label}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-slate-800">
                      {formatId(results[unit], 6)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <EmptyHint text="Masukkan angka jarak untuk melihat hasil konversi ke semua satuan." />
          )}
        </div>
      </WorksheetCard>

      <WorksheetCard title="Konstanta Konversi" badge="Hafalan">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            '1 m = 100 cm',
            '1 km = 1.000 m',
            '1 nm = 1,852 km',
            '1 inch = 2,54 cm',
            '1 yard = 0,9144 m',
            '1 mil ≈ 1,609 km',
          ].map((c) => (
            <FormulaBox key={c}>{c}</FormulaBox>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Contoh dari materi: 1,5 m = 1,5 : 1.000 km = <b>0,0015 km</b>; 2,7 km = 2.700 m ={' '}
          <b>270.000 cm</b>; 5,7 nm = 10,5564 km = <b>10.556,4 m</b>.
        </p>
      </WorksheetCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bagian 3 — KONVERSI WAKTU
// ---------------------------------------------------------------------------

function TimeSection() {
  // Desimal → jam menit detik
  const [dec, setDec] = useState('1,68');
  const decNum = parseNum(dec);
  const hms = decNum !== null ? decimalHoursToHms(decNum) : null;

  // Jam menit detik → desimal
  const [hh, setHh] = useState('3');
  const [mm, setMm] = useState('12');
  const [ss, setSs] = useState('18');
  const decOut = useMemo(() => {
    const h = parseNum(hh) ?? 0;
    const m = parseNum(mm) ?? 0;
    const s = parseNum(ss) ?? 0;
    return hmsToDecimalHours(h, m, s);
  }, [hh, mm, ss]);

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">Konstanta waktu:</span> 1 jam = 60 menit · 1
        menit = 60 detik · 1 jam = (60 × 60) = 3.600 detik. Bentuk penulisan:{' '}
        <i>hh mm ss</i> (mis. 1 jam 30 menit) atau desimal (mis. 1,5 jam).
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorksheetCard title="Desimal → Jam · Menit · Detik" badge="→">
          <NumField
            id="time-dec"
            label="Waktu dalam jam desimal"
            value={dec}
            onChange={setDec}
            placeholder="Contoh: 1,68"
            suffix="jam"
          />
          {hms && decNum !== null ? (
            <div className="mt-3 space-y-2">
              <ResultHighlight
                label="Hasil"
                value={`${formatId(hms.h)} jam ${formatId(hms.m)} menit ${formatId(hms.s)} detik`}
              />
              <div className="rounded-md bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-600">
                <div>
                  = {formatId(Math.floor(decNum))} jam + ({formatId(decNum - Math.floor(decNum), 6)}{' '}
                  × 60) menit
                </div>
                <div>= {formatId(decNum, 6)} jam = {formatDuration(decNum)}</div>
                {decNum >= 24 && <div>= {formatDurationDays(decNum)}</div>}
              </div>
            </div>
          ) : (
            <div className="mt-3">
              <EmptyHint text="Masukkan jam desimal, mis. 5,86." />
            </div>
          )}
        </WorksheetCard>

        <WorksheetCard title="Jam · Menit · Detik → Desimal" badge="←">
          <div className="grid grid-cols-3 gap-2">
            <NumField id="time-h" label="Jam" value={hh} onChange={setHh} placeholder="0" suffix="j" />
            <NumField id="time-m" label="Menit" value={mm} onChange={setMm} placeholder="0" suffix="m" />
            <NumField id="time-s" label="Detik" value={ss} onChange={setSs} placeholder="0" suffix="d" />
          </div>
          <div className="mt-3 space-y-2">
            <ResultHighlight label="Hasil" value={`${formatId(decOut, 6)} jam`} />
            <div className="rounded-md bg-slate-50 p-2 font-mono text-[11px] leading-relaxed text-slate-600">
              <div>
                = {parseNum(hh) ?? 0} + ({parseNum(mm) ?? 0} : 60) + ({parseNum(ss) ?? 0} : 3.600)
              </div>
              <div>= {formatId(decOut, 6)} jam</div>
            </div>
          </div>
        </WorksheetCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bagian 4 — ZONA WAKTU
// ---------------------------------------------------------------------------

function parseHhmm(raw: string): number | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  let h: number;
  let m: number;
  if (digits.length <= 2) {
    h = parseInt(digits, 10);
    m = 0;
  } else {
    h = parseInt(digits.slice(0, digits.length - 2), 10);
    m = parseInt(digits.slice(-2), 10);
  }
  if (h > 23 || m > 59) return null;
  return h + m / 60;
}

function TimezoneSection() {
  const [time, setTime] = useState('0500');
  const [from, setFrom] = useState<TzZone>('UTC');
  const parsed = parseHhmm(time);
  const results = parsed !== null ? convertTimezone(parsed, from) : null;

  return (
    <div className="space-y-4">
      <WorksheetCard title="Konverter Zona Waktu" badge="UTC ↔ Lokal">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <NumField
            id="tz-time"
            label="Waktu (format HHMM — gaya SAR)"
            value={time}
            onChange={setTime}
            placeholder="Contoh: 0500"
          />
          <div className="space-y-1">
            <Label className="text-[11px] font-medium text-slate-600">Zona asal</Label>
            <UnitSelect
              value={from}
              onChange={setFrom}
              ariaLabel="Zona waktu asal"
              options={TZ_ZONE_ORDER.map((z) => ({ value: z, label: TIMEZONES[z].name }))}
            />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="text-[11px] text-slate-400 self-center">Contoh materi:</span>
          {[
            { t: '0500', z: 'UTC' as TzZone, lbl: '0500 Z' },
            { t: '1200', z: 'WITA' as TzZone, lbl: '1200 WITA' },
            { t: '1600', z: 'UTC' as TzZone, lbl: '1600 Z (Kupang)' },
          ].map((ex) => (
            <Button
              key={ex.lbl}
              variant="outline"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setTime(ex.t);
                setFrom(ex.z);
              }}
            >
              {ex.lbl}
            </Button>
          ))}
        </div>

        <div className="mt-4">
          {results && parsed !== null ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Zona</TableHead>
                  <TableHead>Huruf</TableHead>
                  <TableHead className="text-right">Waktu</TableHead>
                  <TableHead className="text-right">Catatan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {TZ_ZONE_ORDER.map((zone) => {
                  const r = results[zone];
                  return (
                    <TableRow key={zone} className={zone === from ? 'bg-emerald-50/60' : ''}>
                      <TableCell className="text-xs font-medium text-slate-700">{zone}</TableCell>
                      <TableCell className="font-mono text-xs text-slate-500">
                        {TIMEZONES[zone].letter}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-bold text-emerald-800">
                        {formatHhmm(r.hours)} {TIMEZONES[zone].letter}
                      </TableCell>
                      <TableCell className="text-right text-[10px] text-slate-500">
                        {r.dayShift === 1 ? '+1 hari (besok)' : r.dayShift === -1 ? '−1 hari (kemarin)' : ''}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <EmptyHint text="Masukkan waktu HHMM yang valid (jam 00–23, menit 00–59)." />
          )}
        </div>
      </WorksheetCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <WorksheetCard title="Konversi UTC → Indonesia" badge="+offset">
          <div className="space-y-2">
            <FormulaBox>UTC → WIB = UTC + 7</FormulaBox>
            <FormulaBox>UTC → WITA = UTC + 8</FormulaBox>
            <FormulaBox>UTC → WIT = UTC + 9</FormulaBox>
            <p className="text-xs text-slate-500">
              Contoh materi: 0500 Z → WITA = (0500 + 0800) = 1300 WITA (1300 H).
            </p>
          </div>
        </WorksheetCard>

        <WorksheetCard title="Konversi Indonesia → UTC" badge="−offset">
          <div className="space-y-2">
            <FormulaBox>WIB → UTC = WIB − 7</FormulaBox>
            <FormulaBox>WITA → UTC = WITA − 8</FormulaBox>
            <FormulaBox>WIT → UTC = WIT − 9</FormulaBox>
            <p className="text-xs text-slate-500">
              Contoh materi: 1200 WITA → UTC = (1200 − 0800) = 0400 UTC (0400 Z).
            </p>
          </div>
        </WorksheetCard>
      </div>

      <WorksheetCard title="Tentang Zona Waktu Dunia" badge="Latar Belakang">
        <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
          <li>
            Dunia dibagi menjadi <b>24 zona waktu</b> yang berbeda-beda sesuai letak daerahnya.
          </li>
          <li>
            Penamaan zona waktu menggunakan <b>alfabet fonetik NATO</b> (huruf A–Z, kecuali &lsquo;J&rsquo;).
            UTC = Zulu (Z), WIB = Golf (G), WITA = Hotel (H), WIT = India (I).
          </li>
          <li>
            Indonesia membentang tiga zona: <b>WIB (UTC+7)</b> — Sumatera, Jawa, Kalimantan
            Barat/Tengah; <b>WITA (UTC+8)</b> — Bali, Nusa Tenggara, Kalimantan Selatan/Timur/Utara,
            Sulawesi; <b>WIT (UTC+9)</b> — Maluku dan Papua.
          </li>
          <li>
            Format ganda empat digit <span className="font-mono">HHMM</span>: mis. 1300 H berarti
            pukul 13:00 waktu WITA.
          </li>
        </ul>
      </WorksheetCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bagian 5 — S·V·T
// ---------------------------------------------------------------------------

function SvtSection() {
  const [s, setS] = useState('');
  const [v, setV] = useState('');
  const [t, setT] = useState('');
  const [sUnit, setSUnit] = useState<'nm' | 'km'>('nm');
  const [vUnit, setVUnit] = useState<SpeedUnit>('kts');

  const sNum = parseNum(s);
  const vNum = parseNum(v);
  const tNum = parseNum(t);

  const solved = useMemo(() => {
    const blanks = [sNum === null, vNum === null, tNum === null].filter(Boolean).length;
    if (blanks !== 1) return null;
    // Normalisasi ke nm & kts (1 kts = 1 nm/jam)
    const sNm = sNum === null ? null : sUnit === 'km' ? sNum / 1.852 : sNum;
    const vKts = vNum === null ? null : vNum * SPEED_UNITS[vUnit].toKts;
    const res = solveSvt({ s: sNm, v: vKts, t: tNum });
    return res;
  }, [sNum, vNum, tNum, sUnit, vUnit]);

  const displayS = (nm: number) => (sUnit === 'km' ? nm * 1.852 : nm);
  const displayV = (kts: number) => kts / SPEED_UNITS[vUnit].toKts;

  const blanks = [sNum === null, vNum === null, tNum === null].filter(Boolean).length;

  const loadPreset = (which: 'lat1' | 'lat2' | 'lat7') => {
    if (which === 'lat1') {
      setS(''); setV('75'); setT('3'); setSUnit('nm'); setVUnit('kts');
    } else if (which === 'lat2') {
      setS('63'); setV('21'); setT(''); setSUnit('nm'); setVUnit('kts');
    } else {
      setS(''); setV('11'); setT('245'); setSUnit('nm'); setVUnit('kts');
    }
  };

  return (
    <div className="space-y-4">
      <WorksheetCard title="Kalkulator Jarak · Kecepatan · Waktu (S·V·T)" badge="S = V × T">
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Isi <b>dua</b> kolom yang diketahui dan kosongkan <b>satu</b> kolom yang ingin dihitung.
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <NumField
              id="svt-s"
              label={sUnit === 'nm' ? 'Jarak S (mil laut)' : 'Jarak S (kilometer)'}
              value={s}
              onChange={setS}
              placeholder={sUnit === 'nm' ? 'Contoh: 63' : 'Contoh: 396'}
            />
            <UnitSelect
              value={sUnit}
              onChange={setSUnit}
              ariaLabel="Satuan jarak"
              options={[
                { value: 'nm', label: 'mil laut (nm)' },
                { value: 'km', label: 'kilometer (km)' },
              ]}
            />
          </div>
          <div className="space-y-1">
            <NumField
              id="svt-v"
              label={`Kecepatan V (${SPEED_UNITS[vUnit].short})`}
              value={v}
              onChange={setV}
              placeholder={
                vUnit === 'kts'
                  ? 'Contoh: 21'
                  : vUnit === 'kmh'
                  ? 'Contoh: 88'
                  : vUnit === 'ms'
                  ? 'Contoh: 1.5'
                  : 'Contoh: 27'
              }
            />
            <UnitSelect
              value={vUnit}
              onChange={setVUnit}
              ariaLabel="Satuan kecepatan"
              options={SPEED_UNIT_ORDER.map((u) => ({
                value: u,
                label: `${SPEED_UNITS[u].label} (${SPEED_UNITS[u].short})`,
              }))}
            />
          </div>
          <div className="space-y-1">
            <NumField id="svt-t" label="Waktu T (jam desimal)" value={t} onChange={setT} placeholder="Contoh: 3" suffix="jam" />
            <div className="text-[10px] text-slate-400">Desimal, mis. 2,5 = 2 jam 30 menit</div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => loadPreset('lat1')}>
            Contoh: Target V=8 kt
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => loadPreset('lat2')}>
            Contoh: Target V=12 kt
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => loadPreset('lat7')}>
            Contoh: MV Pangrango
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => { setS(''); setV(''); setT(''); }}
          >
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {solved ? (
            <>
              {sNum === null && solved.s !== null && (
                <ResultHighlight
                  label={`Jarak S (${sUnit === 'nm' ? 'nm' : 'km'})`}
                  value={formatId(displayS(solved.s), 3)}
                />
              )}
              {vNum === null && solved.v !== null && (
                <ResultHighlight
                  label={`Kecepatan V (${SPEED_UNITS[vUnit].short})`}
                  value={formatId(displayV(solved.v), 3)}
                />
              )}
              {tNum === null && solved.t !== null && (
                <ResultHighlight
                  label="Waktu T"
                  value={`${formatId(solved.t, 3)} jam = ${formatDuration(solved.t)}`}
                />
              )}
            </>
          ) : blanks > 1 ? (
            <EmptyHint text={`Masih ada ${blanks} kolom kosong — isi dua kolom, kosongkan satu saja.`} />
          ) : (
            <EmptyHint text="Semua kolom terisi. Kosongkan satu kolom untuk menghitung nilai tersebut." />
          )}
        </div>
      </WorksheetCard>

      {/* Konverter Khusus m/s & cm/s -> knots & km/jam */}
      <CurrentSpeedConverter />

      {/* Konverter Lengkap Semua Satuan Kecepatan */}
      <WorksheetCard title="Konverter Kecepatan (Semua Satuan)" badge="kts ↔ km/jam ↔ m/s ↔ cm/s">
        <SpeedConverter />
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {[
            '1 nm/jam (kts) = 1,852 km/jam = 51,4444 cm/s',
            '1 m/s = 100 cm/s = 3,6 km/jam = 1,944 kts',
            '1 cm/s = 0,036 km/jam = 0,01944 kts',
            '1 km/jam = 0,54 kts = 0,278 m/s = 27,78 cm/s',
            '1 kts = 0,514444 m/s (1852 m ÷ 3600 s)',
            '27 cm/s = 0,972 km/jam = 0,525 kts',
          ].map((c) => (
            <FormulaBox key={c}>{c}</FormulaBox>
          ))}
        </div>
      </WorksheetCard>
    </div>
  );
}

/**
 * Komponen khusus konversi Meter/Detik dan CM/Detik ke Knots (nm/jam) & KM/jam.
 * Sesuai materi Diklat SARPLAN Angkatan XL (Slide 36–37) & kebutuhan operasional SAR (arus laut BMKG/sensor).
 */
function CurrentSpeedConverter() {
  const [msVal, setMsVal] = useState('1.5');
  const [cmsVal, setCmsVal] = useState('27');

  const numMs = parseNum(msVal);
  const numCms = parseNum(cmsVal);

  const resMs = numMs !== null ? convertMeterPerSecond(numMs) : null;
  const resCms = numCms !== null ? convertCmPerSecond(numCms) : null;

  return (
    <WorksheetCard
      title="Konversi Meter/detik (m/s) & CM/detik (cm/s) → Knots & KM/jam"
      badge="Slide 36–37 · Arus & Angin"
    >
      <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
        Dalam analisis SAR kelautan, data kecepatan arus laut (Sea Current / SC) dan angin dari BMKG / sensor oseanografi sering dilaporkan dalam <b>meter/detik (m/s)</b> atau <b>centimeter/detik (cm/s)</b>. Untuk kalkulasi drift SAR, kecepatan harus diubah ke <b>nm/jam (knots)</b> atau <b>km/jam</b>.
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Kolom 1: Konversi Meter/detik (m/s) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="font-semibold text-xs text-slate-800 flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[11px] font-bold">A</span>
              Meter / Detik (m/s)
            </span>
            <Badge variant="secondary" className="text-[10px]">1 m/s = 1,944 kts = 3,6 km/jam</Badge>
          </div>

          <NumField
            id="current-ms"
            label="Kecepatan / Arus dalam Meter/Detik (m/s)"
            value={msVal}
            onChange={setMsVal}
            placeholder="Contoh: 1.5"
            suffix="m/s"
          />

          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[10px] text-slate-500 mr-1">Contoh:</span>
            {[
              { val: '0.5', lbl: '0,5 m/s' },
              { val: '1', lbl: '1,0 m/s' },
              { val: '1.5', lbl: '1,5 m/s' },
              { val: '2.5', lbl: '2,5 m/s' },
            ].map((p) => (
              <Button
                key={p.val}
                variant="outline"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => setMsVal(p.val)}
              >
                {p.lbl}
              </Button>
            ))}
          </div>

          {resMs ? (
            <div className="space-y-2 pt-1">
              <div className="rounded-md border border-emerald-200 bg-emerald-50/90 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                  Hasil ke Knot (nm/jam)
                </div>
                <div className="font-mono text-base font-bold text-emerald-900">
                  {formatId(resMs.kts, 6)}{' '}
                  <span className="text-xs font-normal text-emerald-700">kts (nm/jam)</span>
                </div>
                <div className="mt-1 text-[11px] text-emerald-800 font-mono">
                  Langkah: {msVal} m/s × 100 ÷ 51,4444 = <b>{formatId(resMs.kts, 4)} kts</b>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <div className="text-[10px] font-medium text-slate-500 uppercase">Kilometer / Jam</div>
                  <div className="font-mono text-sm font-bold text-slate-800">
                    {formatId(resMs.kmh, 4)}{' '}
                    <span className="text-[10px] font-normal text-slate-500">km/jam</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    = {msVal} × 3,6 km/jam
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <div className="text-[10px] font-medium text-slate-500 uppercase">Centimeter / Detik</div>
                  <div className="font-mono text-sm font-bold text-slate-800">
                    {formatId(resMs.cms, 2)}{' '}
                    <span className="text-[10px] font-normal text-slate-500">cm/s</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    = {msVal} × 100 cm/s
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyHint text="Masukkan nilai m/s untuk melihat hasil konversi." />
          )}
        </div>

        {/* Kolom 2: Konversi Centimeter/detik (cm/s) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <span className="font-semibold text-xs text-slate-800 flex items-center gap-1.5">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold">B</span>
              Centimeter / Detik (cm/s)
            </span>
            <Badge variant="secondary" className="text-[10px]">1 cm/s = 0,0194 kts = 0,036 km/jam</Badge>
          </div>

          <NumField
            id="current-cms"
            label="Kecepatan / Arus dalam Centimeter/Detik (cm/s)"
            value={cmsVal}
            onChange={setCmsVal}
            placeholder="Contoh: 27"
            suffix="cm/s"
          />

          <div className="flex flex-wrap gap-1 items-center">
            <span className="text-[10px] text-slate-500 mr-1">Contoh:</span>
            {[
              { val: '20', lbl: '20 cm/s' },
              { val: '27', lbl: '27 cm/s' },
              { val: '50', lbl: '50 cm/s' },
              { val: '100', lbl: '100 cm/s' },
            ].map((p) => (
              <Button
                key={p.val}
                variant="outline"
                size="sm"
                className="h-6 px-1.5 text-[10px]"
                onClick={() => setCmsVal(p.val)}
              >
                {p.lbl}
              </Button>
            ))}
          </div>

          {resCms ? (
            <div className="space-y-2 pt-1">
              <div className="rounded-md border border-emerald-200 bg-emerald-50/90 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                  Hasil ke Knot (nm/jam)
                </div>
                <div className="font-mono text-base font-bold text-emerald-900">
                  {formatId(resCms.kts, 6)}{' '}
                  <span className="text-xs font-normal text-emerald-700">kts (nm/jam)</span>
                </div>
                <div className="mt-1 text-[11px] text-emerald-800 font-mono">
                  Langkah: {cmsVal} ÷ 51,4444 = {cmsVal} × 0,019438444 = <b>{formatId(resCms.kts, 4)} kts</b>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <div className="text-[10px] font-medium text-slate-500 uppercase">Kilometer / Jam</div>
                  <div className="font-mono text-sm font-bold text-slate-800">
                    {formatId(resCms.kmh, 4)}{' '}
                    <span className="text-[10px] font-normal text-slate-500">km/jam</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    = {cmsVal} × 0,036 km/jam
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 bg-white p-2">
                  <div className="text-[10px] font-medium text-slate-500 uppercase">Meter / Detik</div>
                  <div className="font-mono text-sm font-bold text-slate-800">
                    {formatId(resCms.ms, 4)}{' '}
                    <span className="text-[10px] font-normal text-slate-500">m/s</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                    = {cmsVal} ÷ 100 m/s
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyHint text="Masukkan nilai cm/s untuk melihat hasil konversi." />
          )}
        </div>
      </div>
    </WorksheetCard>
  );
}

function SpeedConverter() {
  const [value, setValue] = useState('75');
  const [from, setFrom] = useState<SpeedUnit>('kts');
  const num = parseNum(value);
  const results = num !== null ? convertSpeed(num, from) : null;

  return (
    <>
      <div className="grid grid-cols-[1fr_13rem] items-end gap-2">
        <NumField
          id="speed-value"
          label="Nilai kecepatan"
          value={value}
          onChange={setValue}
          placeholder="Contoh: 75"
        />
        <div className="space-y-1">
          <Label className="text-[11px] font-medium text-slate-600">Satuan asal</Label>
          <UnitSelect
            value={from}
            onChange={setFrom}
            ariaLabel="Satuan kecepatan asal"
            options={SPEED_UNIT_ORDER.map((u) => ({ value: u, label: SPEED_UNITS[u].label }))}
          />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {results ? (
          SPEED_UNIT_ORDER.map((unit) => (
            <div
              key={unit}
              className={`rounded-md border px-3 py-2 ${unit === from ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}
            >
              <div className="text-[10px] uppercase tracking-wide text-slate-500">
                {SPEED_UNITS[unit].label}
              </div>
              <div className="font-mono text-sm font-bold text-slate-800">
                {formatId(results[unit], 6)}{' '}
                <span className="text-[10px] font-normal text-slate-500">{SPEED_UNITS[unit].short}</span>
              </div>
            </div>
          ))
        ) : (
          <div className="sm:col-span-4">
            <EmptyHint text="Masukkan nilai kecepatan untuk konversi." />
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Bagian 6 — AREA (A·T·V·S)
// ---------------------------------------------------------------------------

function AreaSection() {
  // Solver A·T·V·S
  const [a, setA] = useState('');
  const [t, setT] = useState('');
  const [v, setV] = useState('');
  const [s, setS] = useState('');
  const [aUnit, setAUnit] = useState<'nm2' | 'km2'>('nm2');

  const aNum = parseNum(a);
  const tNum = parseNum(t);
  const vNum = parseNum(v);
  const sNum = parseNum(s);
  const blanks = [aNum === null, tNum === null, vNum === null, sNum === null].filter(Boolean).length;

  const solved = useMemo(() => {
    if (blanks !== 1) return null;
    const aNm2 = aNum === null ? null : aUnit === 'km2' ? aNum / 1.852 ** 2 : aNum;
    return solveArea({ a: aNm2, t: tNum, v: vNum, s: sNum });
  }, [aNum, tNum, vNum, sNum, aUnit, blanks]);

  const displayA = (nm2: number) => (aUnit === 'km2' ? nm2 * 1.852 ** 2 : nm2);

  const loadPreset = (which: 'lat1' | 'lat2' | 'lat7' | 'lat13') => {
    if (which === 'lat1') { setA(''); setT('4'); setV('120'); setS('1'); }
    else if (which === 'lat2') { setA('22980'); setT(''); setV('120'); setS('1'); }
    else if (which === 'lat7') { setA('2970'); setT('4.5'); setV('120'); setS(''); }
    else { setA('600'); setT('2'); setV(''); setS('2'); }
    setAUnit('nm2');
  };

  // Kalkulator jumlah pencari
  const [nA, setNA] = useState('2880');
  const [nT, setNT] = useState('3');
  const [nV, setNV] = useState('120');
  const [nS, setNS] = useState('1');
  const nANum = parseNum(nA);
  const nTNum = parseNum(nT);
  const nVNum = parseNum(nV);
  const nSNum = parseNum(nS);
  const searchers =
    nANum !== null && nTNum !== null && nVNum !== null && nSNum !== null
      ? calcSearchers(nANum, nTNum, nVNum, nSNum)
      : null;

  // Persentase area tersapu
  const [pSwept, setPSwept] = useState('10800');
  const [pTotal, setPTotal] = useState('22980');
  const pSweptNum = parseNum(pSwept);
  const pTotalNum = parseNum(pTotal);
  const pct =
    pSweptNum !== null && pTotalNum !== null ? sweptPercentage(pSweptNum, pTotalNum) : null;

  return (
    <div className="space-y-4">
      <WorksheetCard title="Kalkulator Area Pencarian (A·T·V·S)" badge="A = T × V × S">
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Isi <b>tiga</b> variabel yang diketahui dan kosongkan <b>satu</b> variabel yang ingin
          dihitung. V dalam knot, S (track spacing) dalam nm, T dalam jam.
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="space-y-1">
            <NumField
              id="area-a"
              label={aUnit === 'nm2' ? 'Area A (nm²)' : 'Area A (km²)'}
              value={a}
              onChange={setA}
              placeholder="Contoh: 480"
            />
            <UnitSelect
              value={aUnit}
              onChange={setAUnit}
              ariaLabel="Satuan area"
              options={[
                { value: 'nm2', label: 'mil laut² (nm²)' },
                { value: 'km2', label: 'kilometer² (km²)' },
              ]}
            />
          </div>
          <div className="space-y-1">
            <NumField id="area-t" label="Waktu T (jam)" value={t} onChange={setT} placeholder="Contoh: 4" suffix="jam" />
            <div className="text-[10px] text-slate-400">Desimal, mis. 4,5</div>
          </div>
          <NumField id="area-v" label="Kecepatan V (kts)" value={v} onChange={setV} placeholder="Contoh: 120" />
          <NumField id="area-s" label="Track spacing S (nm)" value={s} onChange={setS} placeholder="Contoh: 1" />
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {[
            { k: 'lat1' as const, lbl: 'Contoh: Area 1' },
            { k: 'lat2' as const, lbl: 'Contoh: Area 2' },
            { k: 'lat7' as const, lbl: 'Contoh: Track spacing' },
            { k: 'lat13' as const, lbl: 'Contoh: Kecepatan' },
          ].map((p) => (
            <Button key={p.k} variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => loadPreset(p.k)}>
              {p.lbl}
            </Button>
          ))}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => { setA(''); setT(''); setV(''); setS(''); }}>
            <RotateCcw className="mr-1 h-3 w-3" /> Reset
          </Button>
        </div>

        <div className="mt-4 space-y-2">
          {solved ? (
            <>
              {aNum === null && solved.a !== null && (
                <ResultHighlight
                  label={`Area A (${aUnit === 'nm2' ? 'nm²' : 'km²'})`}
                  value={formatId(displayA(solved.a), 3)}
                />
              )}
              {tNum === null && solved.t !== null && (
                <ResultHighlight
                  label="Waktu T"
                  value={`${formatId(solved.t, 3)} jam = ${formatDuration(solved.t)}`}
                />
              )}
              {vNum === null && solved.v !== null && (
                <ResultHighlight label="Kecepatan V" value={`${formatId(solved.v, 3)} kts`} />
              )}
              {sNum === null && solved.s !== null && (
                <ResultHighlight label="Track spacing S" value={`${formatId(solved.s, 3)} nm`} />
              )}
            </>
          ) : blanks > 1 ? (
            <EmptyHint text={`Masih ada ${blanks} kolom kosong — isi tiga kolom, kosongkan satu saja.`} />
          ) : (
            <EmptyHint text="Semua kolom terisi. Kosongkan satu kolom untuk menghitung nilai tersebut." />
          )}
        </div>
      </WorksheetCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorksheetCard title="Jumlah Unit Pencari (n)" badge="n = A/(T·V·S)">
          <div className="grid grid-cols-2 gap-2">
            <NumField id="n-a" label="Area A (nm²)" value={nA} onChange={setNA} />
            <NumField id="n-t" label="Waktu T (jam)" value={nT} onChange={setNT} />
            <NumField id="n-v" label="Kecepatan V (kts)" value={nV} onChange={setNV} />
            <NumField id="n-s" label="Spacing S (nm)" value={nS} onChange={setNS} />
          </div>
          <div className="mt-3 space-y-2">
            {searchers && Number.isFinite(searchers.exact) ? (
              <>
                <ResultHighlight
                  label="Jumlah unit pencari"
                  value={`${searchers.recommended} unit`}
                />
                <div className="rounded-md bg-slate-50 p-2 font-mono text-[11px] text-slate-600">
                  n = A / (T × V × S) = {formatId(nANum ?? 0)} / ({formatId(nTNum ?? 0)} ×{' '}
                  {formatId(nVNum ?? 0)} × {formatId(nSNum ?? 0)}) = {formatId(searchers.exact, 3)}{' '}
                  → dibulatkan ke atas = {searchers.recommended}
                </div>
              </>
            ) : (
              <EmptyHint text="Lengkapi keempat nilai untuk menghitung jumlah unit pencari." />
            )}
          </div>
        </WorksheetCard>

        <WorksheetCard title="Persentase Area Tersapu" badge="%">
          <div className="grid grid-cols-2 gap-2">
            <NumField id="p-swept" label="Area tersapu (nm²)" value={pSwept} onChange={setPSwept} />
            <NumField id="p-total" label="Area pencarian (nm²)" value={pTotal} onChange={setPTotal} />
          </div>
          <div className="mt-3 space-y-2">
            {pct !== null && Number.isFinite(pct) ? (
              <>
                <ResultHighlight label="Persentase area tersapu" value={`${formatId(pct, 2)}%`} />
                <div className="rounded-md bg-slate-50 p-2 font-mono text-[11px] text-slate-600">
                  % = (tersapu / total) × 100 = ({formatId(pSweptNum ?? 0)} /{' '}
                  {formatId(pTotalNum ?? 0)}) × 100 = {formatId(pct, 2)}%
                </div>
              </>
            ) : (
              <EmptyHint text="Lengkapi kedua nilai untuk menghitung persentase." />
            )}
          </div>
        </WorksheetCard>
      </div>

      <WorksheetCard title="Catatan Area" badge="Tips">
        <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
          <li>Area persegi panjang: <span className="font-mono">A = panjang × lebar</span> (mis. 24 nm × 33 nm = 792 nm²).</li>
          <li>Beberapa pencari dengan kecepatan berbeda: jumlahkan kecepatannya <span className="font-mono">ΣV</span>, lalu <span className="font-mono">A = (ΣV × T) × S</span>.</li>
          <li>Hasil n selalu dibulatkan <b>ke atas</b> — 4,79 berarti butuh 5 pesawat.</li>
          <li>Track spacing (S) adalah jarak antar jalur sapuan paralel pencari.</li>
        </ul>
      </WorksheetCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Komponen utama tab
// ---------------------------------------------------------------------------

const SUB_TABS = [
  { value: 'konsep', label: 'Konsep', icon: BookOpen },
  { value: 'jarak', label: 'Jarak', icon: Ruler },
  { value: 'waktu', label: 'Waktu', icon: Clock },
  { value: 'zona', label: 'Zona Waktu', icon: Globe },
  { value: 'svt', label: 'S·V·T & Kecepatan', icon: Gauge },
  { value: 'area', label: 'Area', icon: Grid3x3 },
];

export default function BasicCalculation() {
  const [subTab, setSubTab] = useState('konsep');

  return (
    <div data-testid="basic-calculation">
      <WorksheetCard
        title="Penghitungan Dasar SAR"
        description="Introduction to SAR Calculation — IAMSAR Manual Volume II"
        badge="SARPLAN"
      >
        <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Materi dasar perhitungan SAR: jarak (S), waktu (T), kecepatan (V) dan luasan (A) —
          lengkap dengan konverter satuan, konversi zona waktu, dan kalkulator rumus operasional.
        </div>

        <Tabs value={subTab} onValueChange={setSubTab}>
          <TabsList className="mb-4 flex h-auto w-full flex-wrap bg-slate-100">
            {SUB_TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="text-xs sm:text-sm">
                <Icon className="mr-1.5 h-3.5 w-3.5" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="konsep" className="mt-0">
            <ConceptSection />
          </TabsContent>
          <TabsContent value="jarak" className="mt-0">
            <DistanceSection />
          </TabsContent>
          <TabsContent value="waktu" className="mt-0">
            <TimeSection />
          </TabsContent>
          <TabsContent value="zona" className="mt-0">
            <TimezoneSection />
          </TabsContent>
          <TabsContent value="svt" className="mt-0">
            <SvtSection />
          </TabsContent>
          <TabsContent value="area" className="mt-0">
            <AreaSection />
          </TabsContent>
        </Tabs>
      </WorksheetCard>
      <Badge variant="outline" className="sr-only">
        Penghitungan Dasar
      </Badge>
    </div>
  );
}
