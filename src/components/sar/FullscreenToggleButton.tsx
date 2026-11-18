'use client';

import { Maximize2, Minimize2 } from 'lucide-react';

interface FullscreenToggleButtonProps {
  isFullscreen: boolean;
  onToggle: () => void;
  /** Teks label (mode normal). Mode fullscreen selalu "Keluar". */
  label?: string;
  className?: string;
}

/**
 * Tombol "Layar Penuh" yang konsisten untuk Peta Laut, Peta ONC, MOBO, dan UPS.
 * Hanya tampil di layar (disembunyikan saat cetak, sama seperti toolbar lain).
 */
export function FullscreenToggleButton({
  isFullscreen,
  onToggle,
  label = 'Layar Penuh',
  className = '',
}: FullscreenToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={isFullscreen ? 'Keluar layar penuh (Esc)' : 'Tampilkan layar penuh'}
      aria-pressed={isFullscreen}
      aria-label={isFullscreen ? 'Keluar layar penuh' : `Tampilkan ${label}`}
      className={`print:hidden p-1.5 rounded border text-xs font-semibold flex items-center gap-1 transition-colors shadow-2xs ${
        isFullscreen
          ? 'bg-slate-800 text-white border-slate-900 hover:bg-slate-700'
          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
      } ${className}`}
    >
      {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
      <span className="hidden sm:inline">{isFullscreen ? 'Keluar' : label}</span>
    </button>
  );
}

export default FullscreenToggleButton;
