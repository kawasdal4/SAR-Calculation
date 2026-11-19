/**
 * Deklarasi TypeScript untuk dtg.mjs — Format Tanggal-Waktu (DTG / TW).
 */

export interface DtgParsed {
  /** 'TW' = format Basarnas [Bulan][Tanggal] [Jam][Menit] [Zona]; 'DTG' = format militer [Tanggal][Jam][Menit][Zona] [Bulan] [Tahun]. */
  kind: 'TW' | 'DTG';
  /** String input apa adanya. */
  raw: string;
  /** Tanggal (1–31). */
  day: number;
  /** Bulan (1–12). */
  month: number;
  /** Tahun bila disebutkan (format DTG), bila tidak null. */
  year: number | null;
  /** Jam (0–23). */
  hour: number;
  /** Menit (0–59). */
  minute: number;
  /** Zona kanonik. */
  zone: 'UTC' | 'WIB' | 'WITA' | 'WIT';
  /** Huruf zona sesuai zona: Z/G/H/I. */
  zoneLetter: string;
  /** true bila zona tidak dicantumkan di input dan diasumsikan WIB. */
  zoneAssumed: boolean;
  /** Penafsiran lengkap, mis. "17 November 2026 pukul 18.47 WIB (huruf G)". */
  description: string;
}

export interface DtgZoneRow {
  zone: 'UTC' | 'WIB' | 'WITA' | 'WIT';
  letter: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** "1847" (gaya SAR HHMM). */
  hhmm: string;
  /** Pergeseran hari terhadap tanggal sumber: -1, 0, +1. */
  dayShift: number;
  /** "17 Nov 2026 pukul 18.47". */
  label: string;
}

export declare const MONTH_NAMES_ID: string[];
export declare const MONTH_SHORT_ID: string[];
export declare const DTG_ZONE_LETTERS: Array<{
  letter: string;
  zone: 'UTC' | 'WIB' | 'WITA' | 'WIT';
  offset: number;
  name: string;
}>;

/** Parse string tanggal-waktu format TW (Basarnas) atau DTG (militer/NATO); null bila tidak dikenali. */
export declare function parseDtg(input: string): DtgParsed | null;

/** Konversi hasil parse ke keempat zona (UTC/WIB/WITA/WIT) lengkap dengan pergeseran hari. */
export declare function dtgToZones(p: DtgParsed, fallbackYear?: number): DtgZoneRow[];

/** Bentuk ISO 8601 dengan offset zona, mis. "2026-11-17T18:47:00+07:00"; null bila tahun tidak diketahui. */
export declare function dtgToIso(p: DtgParsed): string | null;

/** Bentuk DTG kanonik, mis. "171847G NOV 2026". */
export declare function formatDtg(p: DtgParsed): string;
