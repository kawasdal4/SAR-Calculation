'use client';

import { useEffect } from 'react';

/**
 * Running text pada judul tab browser: "SAR Calculator" berjalan terus.
 * Judul dirotasi per karakter (aman utk emoji/code-point) tiap 300ms.
 * Dipasang sekali di root layout agar aktif di semua halaman.
 */
export default function TabTitleMarquee() {
  useEffect(() => {
    const unit = '🧭 SAR Calculator   ✦   ';
    const chars = Array.from(unit.repeat(4));
    let i = 0;
    const id = setInterval(() => {
      i = (i + 3) % chars.length; // geser 3 karakter per tick -> teks berjalan
      document.title =
        chars.slice(i).join('') + chars.slice(0, i).join('');
    }, 300);
    document.title = unit.repeat(2).trimEnd();
    return () => clearInterval(id);
  }, []);
  return null;
}
