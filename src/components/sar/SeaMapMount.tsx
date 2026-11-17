'use client';

import { Component, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { AlertTriangle, RefreshCw } from 'lucide-react';

// Leaflet must be loaded only in the browser
const SeaMapDynamic = dynamic(() => import('@/components/sar/SeaMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] w-full bg-slate-100 rounded-lg flex flex-col items-center justify-center gap-2 text-slate-500">
      <div className="h-5 w-5 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
      <span className="text-xs">Memuat peta laut…</span>
    </div>
  ),
});

interface BoundaryProps {
  children: ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Error boundary khusus untuk peta.
 *
 * Kenapa perlu: di dev, ketika server Next.js restart (mis. setelah
 * .env/next.config berubah), hash chunk Turbopack berubah. Tab browser yang
 * lama masih memegang URL chunk lama → dynamic import `SeaMap` gagal (404) →
 * tanpa boundary, halaman diam-diam gagal hydrate dan pengguna melihat
 * "loading" abadi (baik peta maupun panel cuaca, karena keduanya butuh
 * hydrate untuk berinteraksi).
 *
 * Dengan boundary ini kegagalan jadi terlihat + ada tombol pemulihan yang
 * me-reload halaman (ambil HTML & chunk baru).
 */
class SeaMapErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-[500px] w-full bg-rose-50 border border-rose-200 rounded-lg flex flex-col items-center justify-center gap-3 text-rose-700 px-6 text-center">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          <div className="text-sm font-medium">Peta gagal dimuat</div>
          <p className="text-xs text-rose-600 max-w-md break-words">
            {this.state.error.message ||
              'Chunk halaman tidak ditemukan — kemungkinan server dev baru saja restart.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium bg-rose-600 text-white hover:bg-rose-700"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Muat ulang halaman
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function SeaMapMount(props: React.ComponentProps<typeof SeaMapDynamic>) {
  return (
    <SeaMapErrorBoundary>
      <SeaMapDynamic {...props} />
    </SeaMapErrorBoundary>
  );
}
