/**
 * DOMAIN OPERASI SAR (kelompok tab worksheet) — udara, laut, darat.
 *
 * Tab worksheet Intercept, Alokasi Aset, Hitung Dasar, dan Renops dipisah
 * per domain operasi: setiap domain punya instansi worksheet sendiri dengan
 * state mandiri (dokumen RENOPS udara tidak menimpa RENOPS laut, dst.).
 * Briefing & De-briefing sengaja TIDAK dikelompokkan (dokumen komando
 * sarana bersifat lintas domain).
 */

export type SarDomain = 'udara' | 'laut' | 'darat';

export const SAR_DOMAINS: readonly SarDomain[] = ['udara', 'laut', 'darat'] as const;

export const SAR_DOMAIN_LABELS: Record<SarDomain, string> = {
  udara: 'Udara',
  laut: 'Laut',
  darat: 'Darat',
};

/** Akronim tampilan pada tab (dipakai juga tooltip wiring). */
export const SAR_DOMAIN_SHORT: Record<SarDomain, string> = {
  udara: 'U',
  laut: 'L',
  darat: 'D',
};

export function isSarDomain(value: string | null | undefined): value is SarDomain {
  return value === 'udara' || value === 'laut' || value === 'darat';
}

/** Record berisi nilai awal identik untuk ketiga domain. */
export function emptyDomainRecord<T>(value: T): Record<SarDomain, T> {
  return { udara: value, laut: value, darat: value };
}

/**
 * Domain dari nilai tab aktif. Pola nilai tab varian domain:
 * `intercept-udara`, `asset-allocation-laut`, `basic-calc-darat`, `renops-udara`, dst.
 * Tab tanpa kelompok (briefing-debrief, generator, ...) mengembalikan null.
 */
export function domainFromTabValue(tabValue: string, prefix: string): SarDomain | null {
  if (!tabValue.startsWith(`${prefix}-`)) return null;
  const domain = tabValue.slice(prefix.length + 1);
  return isSarDomain(domain) ? domain : null;
}
