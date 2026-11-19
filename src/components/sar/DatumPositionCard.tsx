'use client';

import { formatDMS } from '@/lib/sar/coordFormat';
import { Info } from 'lucide-react';
import type { DatumResults } from './DatumWorksheet';
import type { Ws1Derived } from './worksheets/Worksheet1';
import type { LatLng } from '@/lib/sar/sarCalculations';

/**
 * PENJABARAN HITUNGAN DI LUAR WORKSHEET 1 —
 * Datum Position dan Search Area lingkaran (π × R²) tidak ada di form asli
 * Worksheet 1 (Appendix K-2). Perhitungannya berjalan di belakang layar untuk
 * menentukan titik datum & lingkaran pencarian di peta laut; penjabarannya
 * ditampilkan terpisah di bagian bawah, di luar lembar worksheet.
 */

/** Format derajat-menit (Panduan bagian 5: posisi datum dalam derajat-menit dan desimal). */
function formatDM(value: number, isLat: boolean): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const d = Math.floor(abs);
  const m = (abs - d) * 60;
  return `${d}°${m.toFixed(1).padStart(4, '0')}′${hemi}`;
}

function fmtPt(pt: LatLng | undefined | null): string {
  if (!pt || typeof pt.lat !== 'number' || typeof pt.lng !== 'number' || !isFinite(pt.lat) || !isFinite(pt.lng)) return '—';
  return `${formatDM(pt.lat, true)} ${formatDM(pt.lng, false)} (${pt.lat.toFixed(5)}, ${pt.lng.toFixed(5)})`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-1.5 border-b border-orange-200/60 last:border-b-0">
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
      <span className="text-xs font-semibold font-mono text-slate-800">{value}</span>
    </div>
  );
}

function Block({ title, badge, note, children }: { title: string; badge?: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-orange-200 bg-white/80 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <h4 className="text-sm font-bold text-slate-800">{title}</h4>
        {badge && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-white">{badge}</span>
        )}
      </div>
      {children}
      {note && <p className="mt-1.5 text-[10px] italic text-slate-500">{note}</p>}
    </div>
  );
}

export default function DatumPositionCard({
  datum,
  derived,
}: {
  datum: DatumResults | null;
  derived: Ws1Derived | null;
}) {
  const f = (x: number | undefined | null, digits: number, suffix = '') =>
    typeof x === 'number' && isFinite(x) ? `${x.toFixed(digits)}${suffix}` : '—';

  return (
    <div className="rounded-xl border-2 border-dashed border-orange-400/70 bg-orange-50/50 p-3 sm:p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-orange-600 mb-2">
        <Info className="h-3.5 w-3.5" />
        Di luar lembar Worksheet 1 — penjabaran hitungan pendukung peta laut
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Block
          title="Datum Position — plot titik datum"
          badge="Panduan §4.7.60/§4.7.67"
          note="Tidak ada di form Worksheet 1 asli — hasilnya menentukan titik Datum yang digambar di peta laut. Penamaan datum §4.7.67: LKP = A, datum berikutnya B, C, D, …"
        >
          <Row
            label="Drift Direction (Left / Right)"
            value={`${f(datum?.driftLeftDir, 1, '°T')} / ${f(datum?.driftRightDir, 1, '°T')}`}
          />
          <Row
            label="Drift Speed / Drift Distance"
            value={`${f(datum?.driftSpeed, 3, ' kts')} / ${f(datum?.driftDistance, 2, ' NM')}`}
          />
          <Row label="Titik ujung rantai — P1 (arus laut)" value={fmtPt(derived?.P1)} />
          <Row label="Titik ujung rantai — P2 (arus angin)" value={fmtPt(derived?.P2)} />
          <Row label="Titik L (leeway kiri)" value={fmtPt(derived?.L)} />
          <Row label="Titik R (leeway kanan)" value={fmtPt(derived?.R)} />
          <Row label="DATUM B (titik tengah garis L–R)" value={fmtPt(derived?.datumB)} />
          <Row
            label="Bearing & jarak LKP (A) → datum (B)"
            value={`${f(derived?.bearingAB, 1, '°(T)')} / ${f(derived?.distanceAB, 2, ' NM')}`}
          />
          <Row
            label="Datum (Left of Downwind)"
            value={datum ? `${formatDMS(datum.datumLeft.lat, false)}, ${formatDMS(datum.datumLeft.lng, true)}` : '—'}
          />
          <Row
            label="Datum (Right of Downwind)"
            value={datum ? `${formatDMS(datum.datumRight.lat, false)}, ${formatDMS(datum.datumRight.lng, true)}` : '—'}
          />
          <Row label="DTG datum (perkiraan)" value={derived?.datumDtg ?? '—'} />
          <Row
            label="Divergence Distance (DD) / DVe"
            value={`${f(datum?.divergenceDistance, 2, ' NM')} / ${f(datum?.dve, 3, ' kts')}`}
          />
        </Block>

        <Block
          title="Search Area — Lingkaran π × R²"
          badge="Panduan §3.8"
          note="Tidak ada di form Worksheet 1 asli — lingkaran radius R digambar di peta laut dengan pusat di Datum B."
        >
          <Row label="Search radius rounded up (R)" value={f(derived?.RUp, 0, ' NM')} />
          <Row
            label="Luas lingkaran (π × R²)"
            value={
              derived
                ? `π × ${f(derived.RUp, 0, '')}² = ${derived.areaCircleNM2.toLocaleString(undefined, { maximumFractionDigits: 2 })} NM²`
                : '—'
            }
          />
          <Row
            label="Pusat lingkaran (Datum B)"
            value={derived ? `${formatDMS(derived.datumB.lat, false)}, ${formatDMS(derived.datumB.lng, true)}` : '—'}
          />
        </Block>
      </div>
    </div>
  );
}
