'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useFullscreen — Fullscreen API dengan fallback vendor (WebKit) untuk Safari lama.
 *
 * Dipakai tombol "Layar Penuh" pada Peta Laut, Peta ONC, MOBO (Maneuvering
 * Board), dan UPS (Universal Plotting Sheet). Elemen target diperoleh lewat
 * `ref`; saat aktif browser menampilkan elemen memenuhi layar (ESC / tombol
 * yang sama untuk keluar).
 *
 * `toggle()` aman dipanggil kapan pun: kalau elemen belum ada di DOM atau
 * browser menolak (mis. iframe tanpa allowfullscreen), error ditelan dan
 * state tetap sinkron dengan event `fullscreenchange`.
 */
export function useFullscreen<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const sync = () => {
      const active = document.fullscreenElement ?? (document as unknown as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null;
      setIsFullscreen(active != null && (active === ref.current || ref.current?.contains(active) === true));
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    sync();
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const el = element as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
    const active = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    try {
      if (active) {
        if (doc.exitFullscreen) void doc.exitFullscreen();
        else doc.webkitExitFullscreen?.();
      } else if (el.requestFullscreen) {
        void el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        void el.webkitRequestFullscreen();
      }
    } catch {
      /* abaikan: browser menolak (mis. tanpa gesture pengguna) — state tetap dari event */
    }
  }, []);

  return { ref, isFullscreen, toggle };
}

export default useFullscreen;
