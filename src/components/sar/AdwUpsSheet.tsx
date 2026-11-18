'use client';

/**
 * Lembar UPS Digital untuk hasil Aeronautical Drift Worksheet (ADW).
 *
 * Implementasi Panduan ADW ke UPS Digital (bagian 5–7):
 *  - Pemilihan skala otomatis: skala terkecil (3′–60′) yang memuat semua titik
 *    di dalam lembar (lebar 4,7 R, tinggi 3,4 R, margin 0,2 R) sehingga vektor
 *    dg/dd/da tidak keluar batas lembar UPS.
 *  - Tata letak lembar: rose 000°–360° (°T), garis lintang tiap S′ (jarak R),
 *    garis bujur tiap S′ (jarak cos φm × R) berlabel derajat–menit–detik.
 *  - Skala garis kecil-kecil: sumbu vertikal (skala lintang) dan sumbu
 *    horizontal (skala bujur) melalui pusat rose, dari tepi ke tepi lembar;
 *    satu interval grid dibagi 6 garis besar (S/6 … S) dan tiap garis besar
 *    dibagi 10 garis kecil (S/60) — seperti skala pada peta.
 *  - Vektor: dg hijau dari datum X, dd merah dari ujung dg, da biru dari X ke
 *    ujung dd; ujung da/d d diberi label koordinat akhir glide (B14).
 */

import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Compass, AlertTriangle, CheckCircle2, Ruler } from 'lucide-react';
import { type LatLng, type Vector } from '@/lib/sar/sarCalculations';
import {
  buildAdwUpsPlot,
  scaleTickInfo,
  UPS_SHEET_WR,
  UPS_SHEET_HR,
} from '@/lib/sar/upsAdw.mjs';
import { formatDMS } from '@/lib/sar/coordFormat';

interface AdwUpsSheetProps {
  /** Datum X — posisi insiden (A2 ADW). */
  datum?: LatLng;
  /** Vektor glide pesawat: arah B9 (°T), jarak B8 (NM). */
  dg?: Vector;
  /** Vektor downwind: arah B11 (°T), jarak B11 (NM). */
  dd?: Vector;
  /** Vektor glide parasut (lanjutan dari ujung pesawat bila ada). */
  pg?: Vector;
  /** Vektor drift angin parasut. */
  pw?: Vector;
  /** Resultan parasut. */
  pp?: Vector;
  className?: string;
}

const SHEET_W = 1180;
const SHEET_H = (SHEET_W * UPS_SHEET_HR) / UPS_SHEET_WR;
const ROSE_R = SHEET_W / UPS_SHEET_WR; // jari-jari rose = S menit lintang, konstan di semua skala

const COLORS: Record<string, string> = {
  dg: '#16a34a',
  dd: '#dc2626',
  da: '#2563eb',
  pg: '#7c3aed',
  pw: '#0891b2',
  pp: '#0f766e',
};

const SEG_LABEL: Record<string, string> = {
  dg: 'd_g — glide tanpa angin (B.8/B.9)',
  dd: 'd_d — downwind (B.11)',
  da: 'd_a — resultan glide (B.12)',
  pg: 'd_pg — glide parasut',
  pw: 'd_pw — drift angin parasut',
  pp: 'd_pp — resultan parasut',
};

/** Desimal gaya Indonesia: 25.74 → "25,74". */
function fmtNm(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

/** Arah gaya panduan: 096° bila bulat, 158,5° bila tidak. */
function fmtDir(dir: number): string {
  const rounded = Math.round(dir * 10) / 10;
  if (Number.isInteger(rounded)) return `${String(rounded).padStart(3, '0')}°`;
  return `${rounded.toFixed(1).replace('.', ',')}°`;
}

/** Label garis besar skala dalam menit busur: 2′, 30″, 1′30″, dst. */
function fmtMajorTick(minutes: number): string {
  const totalSec = Math.round(minutes * 60);
  if (totalSec % 60 === 0) return `${totalSec / 60}′`;
  if (totalSec < 60) return `${totalSec}″`;
  return `${Math.floor(totalSec / 60)}′30″`;
}

/** Label nilai vektor: "161° / 25,74 NM" (arah tanpa pad bila ada desimal). */
function fmtVectorValue(dir: number, nm: number): string {
  return `${fmtDir(dir)} / ${fmtNm(nm)} NM`;
}

export default function AdwUpsSheet({
  datum,
  dg,
  dd,
  pg,
  pw,
  pp,
  className = '',
}: AdwUpsSheetProps) {
  const plot = useMemo(
    () =>
      datum
        ? buildAdwUpsPlot({
            datumLat: datum.lat,
            datumLng: datum.lng,
            dg: dg && dg.mag > 0 ? { dir: dg.dir, nm: dg.mag } : null,
            dd: dd && dd.mag > 0 ? { dir: dd.dir, nm: dd.mag } : null,
            pg: pg && pg.mag > 0 ? { dir: pg.dir, nm: pg.mag } : null,
            pw: pw && pw.mag > 0 ? { dir: pw.dir, nm: pw.mag } : null,
            pp: pp && pp.mag > 0 ? { dir: pp.dir, nm: pp.mag } : null,
          })
        : null,
    [datum, dg, dd, pg, pw, pp],
  );

  if (!datum || !plot?.ready) {
    return (
      <Card className={`border-slate-300 shadow-sm bg-white ${className}`}>
        <CardHeader className="bg-slate-100/90 border-b border-slate-300 py-3 px-4">
          <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-slate-900">
            <Compass className="h-4 w-4 text-emerald-700" />
            UPS Digital — Hasil ADW
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <p className="text-sm text-slate-500">
            Belum ada hasil Aeronautical Drift Worksheet. Lengkapi dan hitung worksheet ADW terlebih
            dahulu — vektor dg (B.8/B.9), dd (B.11), dan da (B.12) akan digambar otomatis ke lembar UPS
            dengan skala yang menjamin semua vektor berada di dalam lembar.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!plot.scale.fits) {
    const s60 = plot.scale;
    return (
      <Card className={`border-amber-300 shadow-sm bg-white ${className}`}>
        <CardHeader className="bg-amber-50 border-b border-amber-300 py-3 px-4">
          <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            UPS Digital — Skala Tidak Memuat
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-2">
          <p className="text-sm font-semibold text-amber-900">
            Tidak ada skala dalam daftar (3′–60′) yang memuat seluruh vektor ADW di dalam lembar UPS —
            sesuai panduan, vektor tidak digambar.
          </p>
          <p className="text-xs text-slate-700 font-mono">
            Diagnostik pada skala terbesar 60′: simpang maksimum x{' '}
            {fmtNm(s60.maxDevXNm)} NM (batas {fmtNm(s60.xLimitNm)} NM), y{' '}
            {fmtNm(s60.maxDevYNm)} NM (batas {fmtNm(s60.yLimitNm)} NM).
          </p>
          <p className="text-xs text-slate-500">
            Perkecil jangkauan vektor (ketinggian glide, kecepatan angin) atau pecah kasus ke lembar
            yang berbeda.
          </p>
        </CardContent>
      </Card>
    );
  }

  const scale = plot.scale;
  const S = scale.scaleMin; // menit busur
  const pxPerNm = ROSE_R / S; // 1 menit lintang = 1 NM
  const cosM = scale.cosMidLat;
  const cx = SHEET_W / 2;
  const cy = SHEET_H / 2;
  const xC = scale.roseCenterNm.xNm;
  const yC = scale.roseCenterNm.yNm;

  /** Titik NM relatif datum → piksel lembar. */
  const toPx = (xNm: number, yNm: number) => ({
    x: cx + (xNm - xC) * pxPerNm,
    y: cy - (yNm - yC) * pxPerNm,
  });

  const datumPx = toPx(0, 0);

  // ---- Grid: garis lintang (horizontal) tiap S′ dan garis bujur (vertikal) tiap S′ ----
  const latLines: { m: number; y: number }[] = [];
  const latHalf = SHEET_H / (2 * pxPerNm); // tinggi setengah lembar dalam NM = 1,7·S
  for (let m = Math.floor((yC - latHalf) / S); m <= Math.ceil((yC + latHalf) / S); m++) {
    const yNm = m * S;
    const y = cy - (yNm - yC) * pxPerNm;
    if (y >= -40 && y <= SHEET_H + 40) latLines.push({ m, y });
  }
  const lngHalf = SHEET_W / (2 * pxPerNm); // lebar setengah lembar dalam NM = 2,35·S
  const lngLines: { m: number; x: number }[] = [];
  for (let m = Math.floor((xC - lngHalf) / (S * cosM)); m <= Math.ceil((xC + lngHalf) / (S * cosM)); m++) {
    const xNm = m * S * cosM;
    const x = cx + (xNm - xC) * pxPerNm;
    if (x >= -40 && x <= SHEET_W + 40) lngLines.push({ m, x });
  }

  const latCenterDeg = scale.latCenterDeg!;
  const lngCenterDeg = scale.lngCenterDeg!;

  // ---- Karva graticule: garis kecil-kecil di sepanjang SEMUA garis lintang & bujur ----
  // Seperti lembar UPS asli: setiap garis lintang diukir tick subdivisi menit bujur
  // (garis besar tiap S/6′, garis kecil tiap S/60′), dan setiap garis bujur diukir
  // tick subdivisi menit lintang (garis besar tiap S/6 NM, garis kecil tiap S/60 NM).
  // Dua sumbu skala utama melalui C dilewati karena sudah diukir + berlabel.
  const graticuleTicks = (() => {
    const latMinor: string[] = [];
    const latMajor: string[] = [];
    const lngMinor: string[] = [];
    const lngMajor: string[] = [];
    // Tick sepanjang garis lintang (horizontal): subdivisi menit bujur
    for (const line of latLines) {
      if (Math.abs(line.y - cy) < 0.5) continue; // sumbu skala bujur utama
      for (let k = Math.floor((xC - lngHalf) / (S * cosM)); k <= Math.ceil((xC + lngHalf) / (S * cosM)); k++) {
        for (let q = 0; q <= 60; q++) {
          const xNm = k * S * cosM + (q * S * cosM) / 60;
          const x = cx + (xNm - xC) * pxPerNm;
          if (x < 10 || x > SHEET_W - 10) continue;
          const major = q % 10 === 0;
          const half = major ? 11 : 4;
          (major ? latMajor : latMinor).push(`M ${x.toFixed(1)} ${(line.y - half).toFixed(1)} L ${x.toFixed(1)} ${(line.y + half).toFixed(1)}`);
        }
      }
    }
    // Tick sepanjang garis bujur (vertikal): subdivisi menit lintang
    for (const line of lngLines) {
      if (Math.abs(line.x - cx) < 0.5) continue; // sumbu skala lintang utama
      for (let m2 = Math.floor((yC - latHalf) / S); m2 <= Math.ceil((yC + latHalf) / S); m2++) {
        for (let q = 0; q <= 60; q++) {
          const yNm = m2 * S + (q * S) / 60;
          const y = cy - (yNm - yC) * pxPerNm;
          if (y < 10 || y > SHEET_H - 10) continue;
          const major = q % 10 === 0;
          const half = major ? 11 : 4;
          (major ? lngMajor : lngMinor).push(`M ${(line.x - half).toFixed(1)} ${y.toFixed(1)} L ${(line.x + half).toFixed(1)} ${y.toFixed(1)}`);
        }
      }
    }
    return {
      latMinor: latMinor.join(' '),
      latMajor: latMajor.join(' '),
      lngMinor: lngMinor.join(' '),
      lngMajor: lngMajor.join(' '),
    };
  })();

  // ---- Skala lintang: sumbu vertikal melalui C, dari tepi ke tepi lembar ----
  // Satu interval grid (S′) dibagi 6 garis besar (S/6 … S), tiap garis besar
  // dibagi 10 garis kecil (S/60). Panjang interval = R (S NM).
  const latTicks: { y: number; major: boolean; label?: string }[] = [];
  const majorMin = scaleTickInfo(S).majorMin;
  for (let m = Math.floor((yC - latHalf) / S) - 1; m <= Math.ceil((yC + latHalf) / S); m++) {
    for (let q = 0; q <= 60; q++) {
      const yNm = m * S + (q * S) / 60;
      const y = cy - (yNm - yC) * pxPerNm;
      if (y < 0 || y > SHEET_H) continue;
      const major = q % 10 === 0 && q > 0;
      latTicks.push({ y, major, label: major ? fmtMajorTick((q / 10) * majorMin) : undefined });
    }
  }

  // ---- Skala bujur: sumbu horizontal melalui C, dari tepi ke tepi lembar ----
  // Panjang interval = cos φm × R, karena 1′ bujur = cos φm NM.
  const lngTicks: { x: number; major: boolean; label?: string }[] = [];
  const lngIntervalNm = S * cosM;
  for (let m = Math.floor((xC - lngHalf) / lngIntervalNm) - 1; m <= Math.ceil((xC + lngHalf) / lngIntervalNm); m++) {
    for (let q = 0; q <= 60; q++) {
      const xNm = m * lngIntervalNm + (q * lngIntervalNm) / 60;
      const x = cx + (xNm - xC) * pxPerNm;
      if (x < 0 || x > SHEET_W) continue;
      const major = q % 10 === 0 && q > 0;
      lngTicks.push({ x, major, label: major ? fmtMajorTick((q / 10) * majorMin) : undefined });
    }
  }

  // ---- Rose 000°–360° ----
  const roseTicks: { d: number; len: number }[] = [];
  for (let d = 0; d < 360; d++) {
    roseTicks.push({ d, len: d % 30 === 0 ? 34 : d % 10 === 0 ? 22 : 12 });
  }
  const roseLabels = Array.from({ length: 12 }, (_, idx) => idx * 30);

  const polar = (degBearing: number, radiusPx: number) => ({
    x: cx + radiusPx * Math.sin(degBearing * (Math.PI / 180)),
    y: cy - radiusPx * Math.cos(degBearing * (Math.PI / 180)),
  });

  // ---- Vektor ----
  const daTip = plot.segments.find((s) => s.id === 'dd')?.toNm ?? null;
  const hasDa = Boolean(plot.daInfo && plot.daInfo.nm > 0 && daTip);
  const parachuteEnd = plot.parachute?.pwTip ?? null;

  const segMid = (seg: (typeof plot.segments)[number], t: number, off: number, side: 1 | -1) => {
    const a = toPx(seg.fromNm.xNm, seg.fromNm.yNm);
    const b = toPx(seg.toNm.xNm, seg.toNm.yNm);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    // Normal satuan, diputar menghadap sisi yang dituju
    const nx = (-dy / len) * side;
    const ny = (dx / len) * side;
    return { x: px + nx * off, y: py + ny * off };
  };

  return (
    <Card className={`border-slate-300 shadow-sm bg-white overflow-hidden ${className}`}>
      <CardHeader className="bg-slate-100/90 border-b border-slate-300 py-3 px-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-sm sm:text-base font-bold flex items-center gap-2 text-slate-900">
              <Compass className="h-4 w-4 text-emerald-700" />
              UPS Digital — Penggambaran Hasil Worksheet ADW
            </CardTitle>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Pusat rose: {formatDMS(latCenterDeg, false)}{' '}
              {formatDMS(lngCenterDeg, true)} | Datum X:{' '}
              {formatDMS(datum.lat, false)} {formatDMS(datum.lng, true)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-900">
              <Ruler className="h-3.5 w-3.5" />
              Skala: {S}′ · garis besar {majorMin % 1 === 0 ? `${majorMin}′` : fmtMajorTick(majorMin)} ·
              garis kecil {scaleTickInfo(S).minorSec}″
            </span>
            <span className="inline-flex items-center gap-1.5 rounded border border-emerald-300 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Vektor aman di lembar
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 flex flex-col xl:flex-row items-center gap-6 justify-center">
        {/* Lembar UPS digital */}
        <div className="relative w-full max-w-[720px] overflow-hidden rounded-xl border border-slate-400 shadow-inner bg-white">
          <svg
            viewBox={`0 0 ${SHEET_W} ${SHEET_H}`}
            className="w-full h-auto"
            role="img"
            aria-label={`Lembar UPS digital skala ${S} menit dengan vektor ADW dg, dd, dan da`}
          >
            <defs>
              {Object.entries(COLORS).map(([key, color]) => (
                <marker
                  key={key}
                  id={`adw-arrow-${key}`}
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill={color} />
                </marker>
              ))}
            </defs>

            {/* Bingkai lembar */}
            <rect x="1" y="1" width={SHEET_W - 2} height={SHEET_H - 2} fill="#ffffff" stroke="#0f172a" strokeWidth="2.5" />
            <rect x="10" y="10" width={SHEET_W - 20} height={SHEET_H - 20} fill="none" stroke="#94a3b8" strokeWidth="1" />

            {/* Garis lintang (horizontal) */}
            {latLines.map(({ m, y }) => (
              <g key={`lat-${m}`}>
                <line x1="0" y1={y} x2={SHEET_W} y2={y} stroke="#2563eb" strokeWidth="1.2" opacity="0.75" />
                <text x="14" y={y - 6} fontSize="18" fontWeight="600" fill="#1d4ed8" paintOrder="stroke" stroke="#ffffff" strokeWidth="4" style={{ paintOrder: 'stroke' }}>
                  {formatDMS(datum.lat + (m * S) / 60, false)}
                </text>
                <text x={SHEET_W - 14} y={y - 6} fontSize="15" fill="#64748b" textAnchor="end" paintOrder="stroke" stroke="#ffffff" strokeWidth="4" style={{ paintOrder: 'stroke' }}>
                  {formatDMS(datum.lat + (m * S) / 60, false)}
                </text>
              </g>
            ))}

            {/* Garis bujur (vertikal) */}
            {lngLines.map(({ m, x }) => (
              <g key={`lng-${m}`}>
                <line x1={x} y1="0" x2={x} y2={SHEET_H} stroke="#2563eb" strokeWidth="1.2" opacity="0.75" />
                <text x={x + 5} y="32" fontSize="18" fontWeight="600" fill="#1d4ed8" paintOrder="stroke" stroke="#ffffff" strokeWidth="4" style={{ paintOrder: 'stroke' }}>
                  {formatDMS(datum.lng + (m * S) / 60, true)}
                </text>
                <text x={x + 5} y={SHEET_H - 12} fontSize="15" fill="#64748b" paintOrder="stroke" stroke="#ffffff" strokeWidth="4" style={{ paintOrder: 'stroke' }}>
                  {formatDMS(datum.lng + (m * S) / 60, true)}
                </text>
              </g>
            ))}

            {/* Karva graticule: tick garis kecil-kecil di sepanjang semua garis */}
            <path d={graticuleTicks.latMinor} stroke="#64748b" strokeWidth="0.9" fill="none" opacity="0.9" />
            <path d={graticuleTicks.latMajor} stroke="#334155" strokeWidth="1.8" fill="none" />
            <path d={graticuleTicks.lngMinor} stroke="#64748b" strokeWidth="0.9" fill="none" opacity="0.9" />
            <path d={graticuleTicks.lngMajor} stroke="#334155" strokeWidth="1.8" fill="none" />

            {/* Rose kompas: lingkaran, graduasi 000°–360°, utara di atas */}
            <circle cx={cx} cy={cy} r={ROSE_R} fill="none" stroke="#0f172a" strokeWidth="2.5" />
            <circle cx={cx} cy={cy} r={ROSE_R / 2} fill="none" stroke="#0f172a" strokeWidth="1.2" />
            <circle cx={cx} cy={cy} r={ROSE_R / 6} fill="none" stroke="#94a3b8" strokeWidth="1" />
            {roseTicks.map(({ d, len }) => {
              const outer = polar(d, ROSE_R);
              const inner = polar(d, ROSE_R - len);
              return (
                <line
                  key={`rose-${d}`}
                  x1={inner.x}
                  y1={inner.y}
                  x2={outer.x}
                  y2={outer.y}
                  stroke={d % 30 === 0 ? '#0f172a' : d % 10 === 0 ? '#334155' : '#94a3b8'}
                  strokeWidth={d % 30 === 0 ? 2 : 1}
                />
              );
            })}
            {roseLabels.map((d) => {
              const p = polar(d, ROSE_R + 20);
              return (
                <text
                  key={`rose-lbl-${d}`}
                  x={p.x}
                  y={p.y + 6}
                  fontSize="19"
                  fontWeight="700"
                  fill="#0f172a"
                  textAnchor="middle"
                >
                  {String(d).padStart(3, '0')}
                </text>
              );
            })}
            {/* Panah utara */}
            <path
              d={`M ${cx} ${cy - ROSE_R / 2 - 16} L ${cx - 9} ${cy - ROSE_R / 2 + 8} L ${cx} ${cy - ROSE_R / 2 + 2} L ${cx + 9} ${cy - ROSE_R / 2 + 8} z`}
              fill="#0f172a"
            />

            {/* Skala lintang: sumbu vertikal melalui C, dari tepi ke tepi lembar */}
            <line x1={cx} y1="0" x2={cx} y2={SHEET_H} stroke="#0f172a" strokeWidth="1.4" />
            {latTicks.map(({ y, major, label }, idx) => (
              <g key={`latscale-${idx}`}>
                <line
                  x1={cx - (major ? 14 : 5)}
                  y1={y}
                  x2={cx + (major ? 14 : 5)}
                  y2={y}
                  stroke={major ? '#0f172a' : '#64748b'}
                  strokeWidth={major ? 1.8 : 0.8}
                />
                {label && (
                  <text
                    x={cx - 20}
                    y={y + 5}
                    fontSize="15"
                    fontWeight="600"
                    fill="#0f172a"
                    textAnchor="end"
                  >
                    {label}
                  </text>
                )}
              </g>
            ))}

            {/* Skala bujur: sumbu horizontal melalui C, dari tepi ke tepi lembar */}
            <line x1="0" y1={cy} x2={SHEET_W} y2={cy} stroke="#0f172a" strokeWidth="1.4" />
            {lngTicks.map(({ x, major, label }, idx) => (
              <g key={`lngscale-${idx}`}>
                <line
                  x1={x}
                  y1={cy - (major ? 14 : 5)}
                  x2={x}
                  y2={cy + (major ? 14 : 5)}
                  stroke={major ? '#0f172a' : '#64748b'}
                  strokeWidth={major ? 1.8 : 0.8}
                />
                {label && (
                  <text
                    x={x}
                    y={cy + 30}
                    fontSize="15"
                    fontWeight="600"
                    fill="#0f172a"
                    textAnchor="middle"
                  >
                    {label}
                  </text>
                )}
              </g>
            ))}

            {/* Teks skala lembar */}
            <text x="24" y={SHEET_H - 24} fontSize="20" fontWeight="700" fill="#0f172a">
              Skala: {S}′
            </text>

            {/* Vektor ADW sesuai panduan bagian 7 */}
            <g>
              {plot.segments.map((seg) => {
                const a = toPx(seg.fromNm.xNm, seg.fromNm.yNm);
                const b = toPx(seg.toNm.xNm, seg.toNm.yNm);
                return (
                  <line
                    key={`seg-${seg.id}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={COLORS[seg.id]}
                    strokeWidth={seg.id === 'dg' || seg.id === 'da' || seg.id === 'pp' ? 4.5 : 4}
                    markerEnd={`url(#adw-arrow-${seg.id})`}
                  />
                );
              })}

              {/* da: garis biru dari datum X ke ujung dd */}
              {hasDa && daTip && (() => {
                const a = toPx(0, 0);
                const b = toPx(daTip.xNm, daTip.yNm);
                return (
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={COLORS.da}
                    strokeWidth="4.5"
                    markerEnd="url(#adw-arrow-da)"
                  />
                );
              })()}

              {/* Label vektor: d_g, d_d, d_a (subscript gaya panduan) */}
              {plot.segments.filter((s) => ['dg', 'dd', 'pg', 'pw'].includes(s.id)).map((seg) => {
                const t = seg.id === 'dd' || seg.id === 'pw' ? 0.4 : 0.42;
                const side = seg.id === 'dg' || seg.id === 'pg' ? -1 : 1;
                const pos = segMid(seg, t, seg.id === 'dd' || seg.id === 'pw' ? 24 : 18, side);
                const sub = seg.id.slice(-1);
                return (
                  <text
                    key={`lbl-${seg.id}`}
                    x={pos.x}
                    y={pos.y}
                    fontSize="19"
                    fontWeight="700"
                    fill={COLORS[seg.id]}
                    textAnchor="middle"
                    paintOrder="stroke"
                    stroke="#ffffff"
                    strokeWidth="5"
                    style={{ paintOrder: 'stroke' }}
                  >
                    d
                    <tspan dy="5" fontSize="14">
                      {sub}
                    </tspan>
                    <tspan dy="-5">
                      {' '}
                      {fmtVectorValue(seg.dir, seg.nm)}
                    </tspan>
                  </text>
                );
              })}
              {hasDa && plot.daInfo && daTip && (() => {
                const mid = segMid(
                  { id: 'da', fromNm: { xNm: 0, yNm: 0 }, toNm: daTip, dir: plot.daInfo.dir, nm: plot.daInfo.nm, tipNm: daTip },
                  0.62,
                  20,
                  1,
                );
                return (
                  <text
                    x={mid.x}
                    y={mid.y}
                    fontSize="19"
                    fontWeight="700"
                    fill={COLORS.da}
                    textAnchor="middle"
                    paintOrder="stroke"
                    stroke="#ffffff"
                    strokeWidth="5"
                    style={{ paintOrder: 'stroke' }}
                  >
                    d
                    <tspan dy="5" fontSize="14">a</tspan>
                    <tspan dy="-5"> {fmtVectorValue(plot.daInfo.dir, plot.daInfo.nm)}</tspan>
                  </text>
                );
              })()}

              {/* Titik ujung resultan + koordinat akhir (B14) */}
              {hasDa && daTip && (() => {
                const p = toPx(daTip.xNm, daTip.yNm);
                return (
                  <g>
                    <circle cx={p.x} cy={p.y} r="6" fill={COLORS.da} stroke="#ffffff" strokeWidth="2" />
                    <text
                      x={p.x + 16}
                      y={p.y + 32}
                      fontSize="17"
                      fontWeight="700"
                      fill="#1d4ed8"
                      paintOrder="stroke"
                      stroke="#ffffff"
                      strokeWidth="5"
                      style={{ paintOrder: 'stroke' }}
                    >
                      {formatDMS(plot.daInfo!.endLat, false)} {formatDMS(plot.daInfo!.endLng, true)}
                    </text>
                  </g>
                );
              })()}
              {parachuteEnd && plot.parachute && (() => {
                const p = toPx(parachuteEnd.xNm, parachuteEnd.yNm);
                const same = daTip && Math.hypot(daTip.xNm - parachuteEnd.xNm, daTip.yNm - parachuteEnd.yNm) < 1e-9;
                if (same) return null;
                return (
                  <g>
                    <circle cx={p.x} cy={p.y} r="6" fill={COLORS.pp} stroke="#ffffff" strokeWidth="2" />
                    <text
                      x={p.x + 12}
                      y={p.y - 12}
                      fontSize="17"
                      fontWeight="700"
                      fill={COLORS.pp}
                      paintOrder="stroke"
                      stroke="#ffffff"
                      strokeWidth="5"
                      style={{ paintOrder: 'stroke' }}
                    >
                      {formatDMS(plot.parachute.endLat, false)} {formatDMS(plot.parachute.endLng, true)}
                    </text>
                  </g>
                );
              })()}

              {/* Datum X: tanda silang hijau + label koordinat */}
              <g>
                <line x1={datumPx.x - 14} y1={datumPx.y - 14} x2={datumPx.x + 14} y2={datumPx.y + 14} stroke={COLORS.dg} strokeWidth="3.5" />
                <line x1={datumPx.x - 14} y1={datumPx.y + 14} x2={datumPx.x + 14} y2={datumPx.y - 14} stroke={COLORS.dg} strokeWidth="3.5" />
                <text
                  x={datumPx.x - 16}
                  y={datumPx.y - 18}
                  fontSize="18"
                  fontWeight="700"
                  fill="#166534"
                  textAnchor="end"
                  paintOrder="stroke"
                  stroke="#ffffff"
                  strokeWidth="5"
                  style={{ paintOrder: 'stroke' }}
                >
                  X {formatDMS(datum.lat, false)} {formatDMS(datum.lng, true)}
                </text>
              </g>
            </g>
          </svg>
        </div>

        {/* Panel nilai dan legenda */}
        <div className="w-full xl:w-80 space-y-4">
          <div className="bg-white p-3.5 rounded-lg border border-slate-200 space-y-2">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Nilai yang digambar (panduan bagian 3)</h4>
            <dl className="space-y-1.5 text-xs">
              {plot.segments.some((s) => s.id === 'dg') && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 font-semibold" style={{ color: COLORS.dg }}>d_g (B8/B9)</dt>
                  <dd className="font-mono text-slate-900">
                    {(() => { const s = plot.segments.find((x) => x.id === 'dg')!; return `${fmtDir(s.dir)}T / ${fmtNm(s.nm)} NM`; })()}
                  </dd>
                </div>
              )}
              {plot.segments.some((s) => s.id === 'dd') && (
                <div className="flex justify-between gap-2">
                  <dt className="font-semibold" style={{ color: COLORS.dd }}>d_d (B11)</dt>
                  <dd className="font-mono text-slate-900">
                    {(() => { const s = plot.segments.find((x) => x.id === 'dd')!; return `${fmtDir(s.dir)}T / ${fmtNm(s.nm, 3)} NM`; })()}
                  </dd>
                </div>
              )}
              {plot.daInfo && (
                <div className="flex justify-between gap-2">
                  <dt className="font-semibold" style={{ color: COLORS.da }}>d_a (B12)</dt>
                  <dd className="font-mono text-slate-900">{fmtDir(plot.daInfo.dir)}T / {fmtNm(plot.daInfo.nm, 1)} NM</dd>
                </div>
              )}
              {plot.daInfo && (
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-600 font-semibold">B14 — akhir glide</dt>
                  <dd className="font-mono text-slate-900 text-right">
                    {formatDMS(plot.daInfo.endLat, false)}<br />
                    {formatDMS(plot.daInfo.endLng, true)}
                  </dd>
                </div>
              )}
            </dl>
            <p className="text-[10px] leading-relaxed text-slate-500 border-t border-slate-100 pt-2">
              Ujung d_d dan ujung d_a berimpit — titik itu adalah posisi akhir glide. Vektor angin AWA
              tidak digambar di UPS; AWA digambar di Maneuvering Board (Average Wind Aloft).
            </p>
          </div>

          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Skala lembar (panduan bagian 5)</h4>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-slate-700">
              <span>Skala S</span>
              <span className="text-right font-bold">{S}′</span>
              <span>Garis besar (S/6)</span>
              <span className="text-right">{fmtMajorTick(majorMin)}</span>
              <span>Garis kecil (S/60)</span>
              <span className="text-right">{scaleTickInfo(S).minorSec}″</span>
              <span>Pusat rose φC</span>
              <span className="text-right">{formatDMS(latCenterDeg, false)}</span>
              <span>Pusat rose λC</span>
              <span className="text-right">{formatDMS(lngCenterDeg, true)}</span>
              <span>Jarak antar garis bujur</span>
              <span className="text-right">{fmtNm(S * cosM, 2)} NM</span>
            </div>
            <div className="border-t border-slate-200 pt-2 text-[11px] font-mono text-slate-700 space-y-1">
              <div className="flex justify-between">
                <span>Simpang maks x / batas</span>
                <span className={scale.maxDevXNm <= scale.xLimitNm ? 'text-emerald-700' : 'text-red-700'}>
                  {fmtNm(scale.maxDevXNm, 1)} / {fmtNm(scale.xLimitNm, 1)} NM
                </span>
              </div>
              <div className="flex justify-between">
                <span>Simpang maks y / batas</span>
                <span className={scale.maxDevYNm <= scale.yLimitNm ? 'text-emerald-700' : 'text-red-700'}>
                  {fmtNm(scale.maxDevYNm, 1)} / {fmtNm(scale.yLimitNm, 1)} NM
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-sans">
                Skala terkecil yang memuat semua titik dipilih otomatis, sehingga tidak ada vektor ADW
                yang keluar batas lembar (lebar 4,7 R · tinggi 3,4 R · margin 0,2 R).
              </p>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-lg border border-slate-200">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">Legenda vektor</h4>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] text-slate-700">
              {plot.segments.some((s) => s.id === 'dg') && (
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-4" style={{ borderColor: COLORS.dg }} /> d_g glide (B.8)</div>
              )}
              {plot.segments.some((s) => s.id === 'dd') && (
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-4" style={{ borderColor: COLORS.dd }} /> d_d downwind (B.11)</div>
              )}
              {plot.daInfo && (
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-4" style={{ borderColor: COLORS.da }} /> d_a resultan (B.12)</div>
              )}
              {plot.segments.some((s) => s.id === 'pg') && (
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-4" style={{ borderColor: COLORS.pg }} /> d_pg glide parasut</div>
              )}
              {plot.segments.some((s) => s.id === 'pw') && (
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-4" style={{ borderColor: COLORS.pw }} /> d_pw drift parasut</div>
              )}
              {plot.segments.some((s) => s.id === 'pp') && (
                <div className="flex items-center gap-1.5"><span className="w-4 border-t-4" style={{ borderColor: COLORS.pp }} /> d_pp resultan parasut</div>
              )}
              <div className="flex items-center gap-1.5"><span className="text-emerald-700 font-bold">✕</span> Datum X (A2)</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
