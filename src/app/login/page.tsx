'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { User, Lock, Eye, EyeOff, LogIn, GraduationCap } from 'lucide-react';
import CopyrightFooter from '@/components/sar/CopyrightFooter';

/**
 * Portal login — meniru desain "Portal Login SAR Basarnas Modern":
 * panel hero kiri (scene SAR Basarnas) + kartu putih kanan.
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
    <div className="flex min-h-screen flex-col bg-slate-100 lg:flex-row">
      {/* Panel hero kiri — penuh di desktop, strip atas di mobile */}
      <div className="relative h-44 w-full shrink-0 sm:h-56 lg:h-auto lg:w-[46%]">
        <Image
          src="/images/login-hero.jpg"
          alt="BASARNAS — Diklat SAR Planning"
          fill
          priority
          className="object-cover object-top"
          sizes="(max-width: 1024px) 100vw, 46vw"
        />
      </div>

      {/* Panel kanan — kartu login + copyright */}
      <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-gradient-to-br from-[#dcebfa] via-[#f2f7fd] to-[#cbe0f5] px-4 py-8 sm:px-8">
        {/* Pita oranye sudut kanan-atas */}
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-28 rotate-[38deg] bg-gradient-to-b from-orange-500 to-orange-400 shadow-lg" />
        <div className="pointer-events-none absolute -left-14 bottom-6 h-40 w-24 -rotate-[38deg] bg-slate-800 opacity-90" />
        <div className="pointer-events-none absolute -left-6 bottom-16 h-44 w-16 -rotate-[38deg] bg-gradient-to-b from-orange-500 to-orange-400 shadow-lg" />

        <div className="relative z-10 w-full max-w-md rounded-3xl bg-white/95 px-6 py-8 shadow-2xl ring-1 ring-slate-900/5 sm:px-10 sm:py-10">
          {/* Logo + judul */}
          <div className="flex justify-center">
            <Image
              src="/images/sar-calculator-logo.png"
              alt="SAR Calculator"
              width={330}
              height={122}
              priority
              className="h-auto w-64 sm:w-72"
            />
          </div>
          <p className="mt-3 text-center text-sm font-semibold leading-snug text-slate-700 sm:text-base">
            Portal Aplikasi Penghitungan
            <br />
            Operasi Pencarian dan Pertolongan
          </p>

          {/* Form */}
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="relative">
              <User className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Username / Email / NIP"
                autoComplete="username"
                required
                className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-12 pr-4 text-sm text-slate-800 placeholder-slate-400 shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
              />
            </div>

            <div className="relative">
              <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                autoComplete="current-password"
                required
                className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-12 pr-12 text-sm text-slate-800 placeholder-slate-400 shadow-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                aria-label={showPass ? 'Sembunyikan password' : 'Tampilkan password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
              >
                {showPass ? (
                  <Eye className="h-5 w-5" />
                ) : (
                  <EyeOff className="h-5 w-5" />
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 py-3.5 text-base font-bold text-white shadow-md shadow-orange-500/30 transition hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <LogIn className="h-5 w-5" />
              {loading ? 'Memproses...' : 'Masuk'}
            </button>
          </form>

          {/* Pembatas bertuliskan Diklat */}
          <div className="mt-7 flex items-center gap-3">
            <span className="h-1 w-10 rounded-full bg-gradient-to-r from-transparent to-orange-500 sm:w-14" />
            <span className="whitespace-nowrap text-base font-bold text-slate-800 sm:text-lg">
              Diklat SAR Planning
            </span>
            <span className="h-1 flex-1 rounded-full bg-gradient-to-l from-transparent to-orange-500" />
          </div>

          {/* Footer kartu */}
          <div className="mt-7 flex items-center justify-center gap-3 border-t border-slate-200 pt-5 text-left">
            <GraduationCap className="h-7 w-7 shrink-0 text-slate-700" strokeWidth={1.75} />
            <p className="text-xs font-medium leading-snug text-slate-600 sm:text-sm">
              Media Pembelajaran &amp; Alat Bantu Penghitungan
              <br />
              SAR Planning
            </p>
          </div>
        </div>

        {/* Copyright di bawah kartu login */}
        <CopyrightFooter align="center" className="mt-2" />
      </div>
    </div>
  );
}
