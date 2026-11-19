'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { User, Lock, Eye, EyeOff, LogIn, GraduationCap } from 'lucide-react';
import CopyrightFooter from '@/components/sar/CopyrightFooter';

/**
 * Portal login — meniru desain "Portal Login SAR Basarnas Modern":
 * panel hero kiri (scene SAR Basarnas) + kartu putih kanan.
 * Layout compact: seluruh portal muat dalam satu viewport tanpa scroll
 * (h-dvh + overflow terkunci di desktop; konten dipadatkan di mobile).
 */
export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      });
      if (res.ok) {
        router.replace('/');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Gagal masuk. Coba lagi.');
    } catch {
      setError('Tidak dapat menghubungi server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-slate-100 lg:h-dvh lg:flex-row lg:overflow-hidden">
      {/* Panel hero kiri — penuh di desktop, strip ramping di mobile */}
      <div className="relative h-24 w-full shrink-0 sm:h-32 lg:h-auto lg:w-[46%]">
        <Image
          src="/images/login-hero.jpg"
          alt="BASARNAS — Diklat SAR Planning"
          fill
          priority
          className="object-cover object-top"
          sizes="(max-width: 1024px) 100vw, 46vw"
        />
      </div>

      {/* Panel kanan — kartu login + copyright, scroll internal hanya cadangan */}
      <div className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto bg-gradient-to-br from-[#dcebfa] via-[#f2f7fd] to-[#cbe0f5] px-4 py-3 sm:px-8 sm:py-4">
        {/* Pita oranye sudut kanan-atas */}
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-28 rotate-[38deg] bg-gradient-to-b from-orange-500 to-orange-400 shadow-lg" />
        <div className="pointer-events-none absolute -left-14 bottom-6 h-40 w-24 -rotate-[38deg] bg-slate-800 opacity-90" />
        <div className="pointer-events-none absolute -left-6 bottom-16 h-44 w-16 -rotate-[38deg] bg-gradient-to-b from-orange-500 to-orange-400 shadow-lg" />

        <div className="relative z-10 my-auto flex w-full flex-col items-center">
          <div className="w-full max-w-md rounded-3xl bg-white/95 px-6 py-4 shadow-2xl ring-1 ring-slate-900/5 sm:px-10 sm:py-6">
            {/* Logo + judul */}
            <div className="flex justify-center">
              <Image
                src="/images/sar-calculator-logo.png"
                alt="SAR Calculator"
                width={330}
                height={122}
                priority
                className="h-auto w-44 sm:w-60"
              />
            </div>
            <p className="mt-2 text-center text-xs font-semibold leading-snug text-slate-700 sm:text-sm">
              Portal Aplikasi Penghitungan
              <br />
              Operasi Pencarian dan Pertolongan
            </p>

            {/* Form */}
            <form onSubmit={handleSubmit} className="mt-3.5 space-y-2.5 sm:mt-4 sm:space-y-3">
              <div className="relative">
                <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 sm:h-5 sm:w-5" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Username / Email / NIP"
                  autoComplete="username"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-11 pr-4 text-sm text-slate-800 placeholder-slate-400 shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200 sm:py-3"
                />
              </div>

              <div className="relative">
                <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 sm:h-5 sm:w-5" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                  required
                  className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-11 pr-11 text-sm text-slate-800 placeholder-slate-400 shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200 sm:py-3"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:p-1.5"
                >
                  {showPass ? (
                    <Eye className="h-4 w-4 sm:h-5 sm:w-5" />
                  ) : (
                    <EyeOff className="h-4 w-4 sm:h-5 sm:w-5" />
                  )}
                </button>
              </div>

              {error && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-xs font-medium text-red-600 ring-1 ring-red-200">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 py-2.5 text-sm font-bold text-white shadow-md shadow-orange-500/30 transition hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-70 sm:py-3 sm:text-base"
              >
                <LogIn className="h-4 w-4 sm:h-5 sm:w-5" />
                {loading ? 'Memproses...' : 'Masuk'}
              </button>
            </form>

            {/* Pembatas bertuliskan Diklat */}
            <div className="mt-3.5 flex items-center gap-2.5 sm:mt-4 sm:gap-3">
              <span className="h-1 w-8 rounded-full bg-gradient-to-r from-transparent to-orange-500 sm:w-12" />
              <span className="whitespace-nowrap text-sm font-bold text-slate-800 sm:text-base">
                Diklat SAR Planning
              </span>
              <span className="h-1 flex-1 rounded-full bg-gradient-to-l from-transparent to-orange-500" />
            </div>

            {/* Footer kartu */}
            <div className="mt-3.5 flex items-center justify-center gap-2.5 border-t border-slate-200 pt-2.5 text-left sm:mt-4 sm:gap-3 sm:pt-3">
              <GraduationCap className="h-5 w-5 shrink-0 text-slate-700 sm:h-6 sm:w-6" strokeWidth={1.75} />
              <p className="text-[11px] font-medium leading-snug text-slate-600 sm:text-xs">
                Media Pembelajaran &amp; Alat Bantu Penghitungan
                <br />
                SAR Planning
              </p>
            </div>
          </div>

          {/* Copyright di bawah kartu login */}
          <CopyrightFooter align="center" className="mt-1" />
        </div>
      </div>
    </div>
  );
}
