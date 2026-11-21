'use client';

/**
 * Input koordinat TERSTRUKTUR untuk seluruh fungsi yang memerlukan koordinat.
 *
 * Mode format (diberbagi ke SEMUA field koordinat aplikasi — berganti di satu
 * field, semua field ikut; pilihan disimpan di localStorage):
 *  - DMS     : 3 kotak input — derajat (dengan simbol ° di sampingnya),
 *              menit (simbol ′), detik (simbol ″) — sesuai permintaan.
 *  - DM      : 2 kotak — derajat° + menit desimal′.
 *  - Desimal : 1 kotak derajat desimal.
 * Setiap mode menyertakan pilihan HEMISFER: lintang N/S, bujur E/W — tanda
 * negatif tidak perlu diketik sehingga hemisfer tidak bisa terbalik diam-diam.
 * Tombol kecil di samping mengganti format input ke format lain (siklus
 * DMS → DM → Desimal).
 *
 * API komponen TIDAK berubah (axis, value: number, onChange: number) sehingga
 * semua pemakai lama (DatumWorksheet, Worksheet4, UPSPlotter, AssetAllocation,
 * AeronauticalDrift, ScannedChartStudio, InterceptWorksheet) otomatis dapat
 * UI baru. Saat difokus (sedang mengetik), nilai dari luar tidak menimpa
 * ketikan; saat blur, kotak dinormalisasi kembali dari nilai terkini.
 */

import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  joinDmParts,
  joinDmsParts,
  nextCoordInputFormat,
  splitDmParts,
  splitDmsParts,
  type CoordAxis,
  type CoordHemisphere,
  type CoordInputFormat,
} from '@/lib/sar/coordFormat';

export interface CoordinateInputProps {
  /** 'lat' → pilihan hemisfer N/S; 'lng' → E/W. */
  axis: CoordAxis;
  /** Derajat desimal bertanda. */
  value: number;
  onChange: (value: number) => void;
  className?: string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

// ---------------------------------------------------------------------------
// Mode format DIBERBAGI antar semua instance (pub/sub + localStorage)
// ---------------------------------------------------------------------------

const FORMAT_STORE_KEY = 'sar.coordinateInputFormat';
type FormatListener = (format: CoordInputFormat) => void;
const formatListeners = new Set<FormatListener>();
const FORMAT_LABEL: Record<CoordInputFormat, string> = { dms: 'DMS', dm: 'DM', decimal: 'DD' };
const FORMAT_HINT: Record<CoordInputFormat, string> = {
  dms: 'Derajat-Menit-Detik (3 kotak: ° ′ ″)',
  dm: 'Derajat-Menit desimal (2 kotak)',
  decimal: 'Derajat desimal (1 kotak)',
};

function readStoredFormat(): CoordInputFormat {
  if (typeof window === 'undefined') return 'dms';
  try {
    const raw = window.localStorage.getItem(FORMAT_STORE_KEY);
    return raw === 'dm' || raw === 'decimal' ? raw : 'dms';
  } catch {
    return 'dms';
  }
}

function writeStoredFormat(format: CoordInputFormat): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(FORMAT_STORE_KEY, format);
    } catch {
      // Penyimpanan tidak tersedia — mode tetap hidup di memori sesi.
    }
  }
}

function useSharedCoordInputFormat(): [CoordInputFormat, (next: CoordInputFormat) => void] {
  // Nilai awal SELALU 'dms' agar render server & hydrate client identik;
  // pilihan tersimpan dibaca setelah mount (tanpa hydration mismatch).
  const [format, setFormat] = useState<CoordInputFormat>('dms');
  useEffect(() => {
    const listener: FormatListener = (next) => setFormat(next);
    formatListeners.add(listener);
    setFormat(readStoredFormat());
    return () => {
      formatListeners.delete(listener);
    };
  }, []);
  const change = (next: CoordInputFormat) => {
    writeStoredFormat(next);
    setFormat(next);
    for (const listener of formatListeners) listener(next);
  };
  return [format, change];
}

// ---------------------------------------------------------------------------
// Util string kotak input
// ---------------------------------------------------------------------------

function normalizeNumericText(raw: string): string {
  return raw.trim().replace(',', '.');
}

function parseBoxNumber(raw: string): number | null {
  const text = normalizeNumericText(raw);
  if (text === '') return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDecimalBox(value: number): string {
  return String(Math.round(Math.abs(value) * 1e6) / 1e6);
}

interface BoxDrafts {
  dms: [string, string, string];
  dm: [string, string];
  decimal: string;
  hemi: CoordHemisphere;
}

function draftsFromValue(value: number, axis: CoordAxis): BoxDrafts {
  const safe = Number.isFinite(value) ? value : 0;
  const dms = splitDmsParts(safe, axis);
  const dm = splitDmParts(safe, axis);
  return {
    dms: [String(dms.deg), String(dms.min), String(dms.sec)],
    dm: [String(dm.deg), String(dm.min)],
    decimal: formatDecimalBox(safe),
    hemi: dms.hemi,
  };
}

const BOX_CLASS = 'w-11 rounded border px-1 py-1 text-center text-xs text-slate-800 tabular-nums';

export default function CoordinateInput({
  axis,
  value,
  onChange,
  className = '',
  disabled = false,
  id,
  'aria-label': ariaLabel,
}: CoordinateInputProps) {
  const [format, setFormat] = useSharedCoordInputFormat();
  const [draft, setDraft] = useState<BoxDrafts>(() => draftsFromValue(value, axis));
  const [invalid, setInvalid] = useState(false);
  const focusDepth = useRef(0);

  const limit = axis === 'lat' ? 90 : 180;
  const hemiLabels: Record<CoordHemisphere, string> = axis === 'lat' ? { '+': 'N', '-': 'S' } : { '+': 'E', '-': 'W' };
  const hemiLongLabel = axis === 'lat' ? 'Utara/Selatan (N/S)' : 'Timur/Barat (E/W)';
  const baseLabel = ariaLabel ?? (axis === 'lat' ? 'Lintang' : 'Bujur');

  // Sinkron dari nilai luar (pilih di peta, konfirmasi AI, dsb.) — HANYA bila
  // tidak sedang mengetik agar ketikan tidak ditimpa.
  useEffect(() => {
    if (focusDepth.current > 0) return;
    setDraft(draftsFromValue(value, axis));
    setInvalid(false);
  }, [value, format, axis]);

  const beginFocus = () => {
    focusDepth.current += 1;
  };

  const endFocus = () => {
    focusDepth.current = Math.max(0, focusDepth.current - 1);
    if (focusDepth.current === 0) {
      setDraft(draftsFromValue(value, axis));
      setInvalid(false);
    }
  };

  /** Terbitkan nilai dari komponen DMS; batal bila derajat kosong / di luar batas. */
  const emitDms = (rawDeg: string, rawMin: string, rawSec: string, hemi: CoordHemisphere) => {
    const deg = parseBoxNumber(rawDeg);
    if (deg === null) {
      setInvalid(false);
      return;
    }
    const min = parseBoxNumber(rawMin) ?? 0;
    const sec = parseBoxNumber(rawSec) ?? 0;
    const bad =
      !Number.isFinite(deg) || !Number.isFinite(min) || !Number.isFinite(sec) ||
      deg < 0 || deg > limit ||
      min < 0 || min >= 60 ||
      sec < 0 || sec >= 60 ||
      (deg === limit && (min > 0 || sec > 0));
    if (bad) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = joinDmsParts(deg, min, sec, hemi);
    if (Math.abs(next - value) > 1e-9) onChange(next);
  };

  const emitDm = (rawDeg: string, rawMin: string, hemi: CoordHemisphere) => {
    const deg = parseBoxNumber(rawDeg);
    if (deg === null) {
      setInvalid(false);
      return;
    }
    const min = parseBoxNumber(rawMin) ?? 0;
    const bad =
      !Number.isFinite(deg) || !Number.isFinite(min) ||
      deg < 0 || deg > limit ||
      min < 0 || min >= 60 ||
      (deg === limit && min > 0);
    if (bad) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = joinDmParts(deg, min, hemi);
    if (Math.abs(next - value) > 1e-9) onChange(next);
  };

  const emitDecimal = (raw: string, hemi: CoordHemisphere) => {
    const magnitude = parseBoxNumber(raw);
    if (magnitude === null) {
      setInvalid(false);
      return;
    }
    const abs = Math.abs(magnitude);
    if (abs > limit) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    // Angka negatif diketik langsung → hemisfer ikut dibalik otomatis.
    const nextHemi: CoordHemisphere = magnitude < 0 ? (hemi === '-' ? '+' : '-') : hemi;
    const signed = nextHemi === '-' ? -abs : abs;
    if (nextHemi !== hemi) setDraft((current) => ({ ...current, hemi: nextHemi }));
    if (Math.abs(signed - value) > 1e-9) onChange(signed);
  };

  /** Ganti hemisfer: nilai yang sudah ada langsung dibalik tandanya. */
  const applyHemisphere = (hemi: CoordHemisphere) => {
    if (disabled) return;
    setDraft((current) => ({ ...current, hemi }));
    if (format === 'dms') emitDms(draft.dms[0], draft.dms[1], draft.dms[2], hemi);
    else if (format === 'dm') emitDm(draft.dm[0], draft.dm[1], hemi);
    else emitDecimal(draft.decimal, hemi);
    // Magnitude 0 (field kosong): pilihan hemisfer disimpan — berlaku saat
    // angka pertama diketik.
    if (value !== 0 && Number.isFinite(value) && parseBoxNumber(format === 'dms' ? draft.dms[0] : format === 'dm' ? draft.dm[0] : draft.decimal) === null) {
      onChange(-value);
    }
  };

  const boxProps = (key: keyof BoxDrafts & ('dms' | 'dm' | 'decimal')) => ({
    disabled,
    onFocus: beginFocus,
    onBlur: endFocus,
    inputMode: 'decimal' as const,
    autoComplete: 'off' as const,
    className: BOX_CLASS + (invalid ? ' border-rose-400 bg-rose-50' : ''),
  });

  const hemiToggle = (
    <div
      className="flex overflow-hidden rounded border border-slate-300"
      role="group"
      aria-label={`${baseLabel} — pilih hemisfer ${hemiLongLabel}`}
    >
      {(['+', '-'] as const).map((hemi) => (
        <button
          key={hemi}
          type="button"
          disabled={disabled}
          onClick={() => applyHemisphere(hemi)}
          aria-pressed={draft.hemi === hemi}
          title={hemi === '+' ? `Hemisfer ${hemiLabels['+']} (positif)` : `Hemisfer ${hemiLabels['-']} (negatif)`}
          className={`px-1.5 py-1 text-[10px] font-bold leading-none ${draft.hemi === hemi ? 'bg-slate-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'} ${disabled ? 'opacity-50' : ''}`}
        >
          {hemiLabels[hemi]}
        </button>
      ))}
    </div>
  );

  const formatButton = (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setFormat(nextCoordInputFormat(format))}
      title={`Format: ${FORMAT_HINT[format]} — klik untuk ganti format (${FORMAT_LABEL[format]} → ${FORMAT_LABEL[nextCoordInputFormat(format)]})`}
      className="inline-flex items-center gap-0.5 rounded border border-slate-300 bg-white px-1 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100"
      aria-label={`${baseLabel} — ganti format input koordinat (kini ${FORMAT_LABEL[format]})`}
    >
      <RefreshCw className="h-3 w-3" />
      {FORMAT_LABEL[format]}
    </button>
  );

  return (
    <div
      className={`flex flex-wrap items-center gap-1 ${className}`}
      data-coordinate-input={axis}
    >
      {format === 'dms' && (
        <>
          <input
            {...boxProps('dms')}
            id={id}
            value={draft.dms[0]}
            aria-label={`${baseLabel} — derajat`}
            placeholder="0"
            onChange={(event) => {
              const deg = event.target.value;
              setDraft((current) => ({ ...current, dms: [deg, current.dms[1], current.dms[2]] }));
              emitDms(deg, draft.dms[1], draft.dms[2], draft.hemi);
            }}
          />
          <span className="text-xs text-slate-400" aria-hidden>°</span>
          <input
            {...boxProps('dms')}
            value={draft.dms[1]}
            aria-label={`${baseLabel} — menit`}
            placeholder="00"
            onChange={(event) => {
              const min = event.target.value;
              setDraft((current) => ({ ...current, dms: [current.dms[0], min, current.dms[2]] }));
              emitDms(draft.dms[0], min, draft.dms[2], draft.hemi);
            }}
          />
          <span className="text-xs text-slate-400" aria-hidden>′</span>
          <input
            {...boxProps('dms')}
            value={draft.dms[2]}
            aria-label={`${baseLabel} — detik`}
            placeholder="00"
            onChange={(event) => {
              const sec = event.target.value;
              setDraft((current) => ({ ...current, dms: [current.dms[0], current.dms[1], sec] }));
              emitDms(draft.dms[0], draft.dms[1], sec, draft.hemi);
            }}
          />
          <span className="text-xs text-slate-400" aria-hidden>″</span>
        </>
      )}

      {format === 'dm' && (
        <>
          <input
            {...boxProps('dm')}
            id={id}
            value={draft.dm[0]}
            aria-label={`${baseLabel} — derajat`}
            placeholder="0"
            onChange={(event) => {
              const deg = event.target.value;
              setDraft((current) => ({ ...current, dm: [deg, current.dm[1]] }));
              emitDm(deg, draft.dm[1], draft.hemi);
            }}
          />
          <span className="text-xs text-slate-400" aria-hidden>°</span>
          <input
            {...boxProps('dm')}
            value={draft.dm[1]}
            aria-label={`${baseLabel} — menit desimal`}
            placeholder="00.00"
            onChange={(event) => {
              const min = event.target.value;
              setDraft((current) => ({ ...current, dm: [current.dm[0], min] }));
              emitDm(draft.dm[0], min, draft.hemi);
            }}
          />
          <span className="text-xs text-slate-400" aria-hidden>′</span>
        </>
      )}

      {format === 'decimal' && (
        <>
          <input
            {...boxProps('decimal')}
            id={id}
            value={draft.decimal}
            aria-label={`${baseLabel} — derajat desimal`}
            placeholder="6.083333"
            onChange={(event) => {
              setDraft((current) => ({ ...current, decimal: event.target.value }));
              emitDecimal(event.target.value, draft.hemi);
            }}
          />
        </>
      )}

      {hemiToggle}
      {formatButton}
      {invalid && (
        <span className="w-full text-[9px] text-rose-600">
          Di luar rentang (maks {limit}°, menit/detik &lt; 60).
        </span>
      )}
    </div>
  );
}
