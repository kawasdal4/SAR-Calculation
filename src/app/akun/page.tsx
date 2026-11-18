'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  UserPlus,
  Mail,
  IdCard,
  ArrowLeft,
  Trash2,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';

/**
 * Halaman kelola akun (khusus role developer).
 * Developer menambah akun baru dengan Email ATAU NIP;
 * password awal akun baru: SAR115 (dari SAR_ACCOUNT_DEFAULT_PASSWORD).
 */

interface AccountRow {
  id: string;
  identifier: string;
  name: string | null;
  role: string;
  createdAt: string;
}

export default function KelolaAkunPage() {
  const [role, setRole] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [newRole, setNewRole] = useState('operator');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<
    { type: 'ok' | 'err'; text: string } | null
  >(null);

  const [accounts, setAccounts] = useState<AccountRow[]>([]);

  const loadAccounts = useCallback(async () => {
    const res = await fetch('/api/accounts');
    if (res.ok) {
      const data = await res.json();
      setAccounts(data.accounts ?? []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const data = await res.json();
          setRole(data.r);
          if (data.r === 'developer') await loadAccounts();
        }
      } finally {
        setChecked(true);
      }
    })();
  }, [loadAccounts]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, name, role: newRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNotice({
          type: 'ok',
          text: `Akun ${data.account.identifier} dibuat — password awal: ${data.defaultPassword}`,
        });
        setIdentifier('');
        setName('');
        setNewRole('operator');
        await loadAccounts();
      } else {
        setNotice({ type: 'err', text: data.error ?? 'Gagal menambah akun.' });
      }
    } catch {
      setNotice({ type: 'err', text: 'Tidak dapat menghubungi server.' });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, identifier: string) {
    if (!confirm(`Hapus akun ${identifier}?`)) return;
    const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setNotice({ type: 'ok', text: `Akun ${identifier} dihapus.` });
      await loadAccounts();
    } else {
      const data = await res.json().catch(() => ({}));
      setNotice({ type: 'err', text: data.error ?? 'Gagal menghapus akun.' });
    }
  }

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (role !== 'developer') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg ring-1 ring-slate-900/5">
          <ShieldCheck className="mx-auto h-10 w-10 text-red-500" />
          <h1 className="mt-4 text-lg font-bold text-slate-800">
            Akses Ditolak
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Halaman kelola akun hanya dapat diakses oleh akun dengan role{' '}
            <span className="font-semibold text-slate-700">developer</span>.
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Kembali ke aplikasi
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Header halaman */}
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-slate-800">
              Kelola Akun Portal
            </h1>
            <p className="text-sm text-slate-500">
              Tambah akun dengan Email atau NIP — password awal:{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-bold text-slate-700">
                SAR115
              </code>
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Kembali
          </Link>
        </div>

        {/* Form tambah akun */}
        <form
          onSubmit={handleAdd}
          className="rounded-2xl bg-white p-6 shadow-lg ring-1 ring-slate-900/5"
        >
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
            <UserPlus className="h-5 w-5 text-orange-500" /> Tambah Akun Baru
          </h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div className="relative sm:col-span-2">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Email atau NIP (mis. 198703152010121001)"
                required
                className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
              />
            </div>
            <div className="relative">
              <IdCard className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nama lengkap (opsional)"
                className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
              />
            </div>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-4 pr-10 text-sm text-slate-800 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200"
            >
              <option value="operator">Role: Operator</option>
              <option value="developer">Role: Developer</option>
            </select>
          </div>

          {notice && (
            <p
              className={`mt-4 flex items-start gap-2 rounded-lg px-3 py-2 text-xs font-medium ring-1 ${
                notice.type === 'ok'
                  ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                  : 'bg-red-50 text-red-600 ring-red-200'
              }`}
            >
              {notice.type === 'ok' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              {notice.text}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-orange-500 to-orange-600 py-3 text-sm font-bold text-white shadow-md shadow-orange-500/30 transition hover:from-orange-600 hover:to-orange-700 disabled:cursor-not-allowed disabled:opacity-70 sm:w-auto sm:px-8"
          >
            {busy ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
            ) : (
              <UserPlus className="h-4.5 w-4.5" />
            )}
            {busy ? 'Menyimpan...' : 'Tambah Akun'}
          </button>
        </form>

        {/* Daftar akun */}
        <div className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-900/5">
          <div className="border-b border-slate-100 px-6 py-4">
            <h2 className="text-base font-bold text-slate-800">
              Akun Terdaftar{' '}
              <span className="text-sm font-medium text-slate-400">
                ({accounts.length})
              </span>
            </h2>
          </div>
          {accounts.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-slate-400">
              Belum ada akun di database. Akun developer utama berasal dari
              konfigurasi .env.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Email / NIP</th>
                    <th className="px-6 py-3 font-semibold">Nama</th>
                    <th className="px-6 py-3 font-semibold">Role</th>
                    <th className="px-6 py-3 font-semibold">Dibuat</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map((a) => (
                    <tr key={a.id} className="text-slate-700">
                      <td className="max-w-[220px] truncate px-6 py-3.5 font-medium">
                        {a.identifier}
                      </td>
                      <td className="px-6 py-3.5">{a.name ?? '—'}</td>
                      <td className="px-6 py-3.5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            a.role === 'developer'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-sky-100 text-sky-700'
                          }`}
                        >
                          {a.role}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-3.5 text-xs text-slate-400">
                        {new Date(a.createdAt).toLocaleDateString('id-ID', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleDelete(a.id, a.identifier)}
                          title={`Hapus akun ${a.identifier}`}
                          className="rounded-lg p-2 text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
