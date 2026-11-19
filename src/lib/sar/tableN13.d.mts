/**
 * Deklarasi TypeScript untuk tableN13.mjs — Table N-13 & N-14 IAMSAR Vol II.
 */

export interface N13Parachute {
  id: string;
  label: string;
  /** Rate of descent di permukaan laut (ft/min); null bila tabel memberi rentang. */
  rodSeaLevelFtMin: number | null;
  /** Rate of descent di 7.000 ft (ft/min); null bila tidak dicantumkan di tabel. */
  rod7000FtMin: number | null;
  /** Rentang ROD untuk baris eksperimental. */
  rodRangeFtMin: [number, number] | null;
  /** Rasio glide horizontal/vertikal (0 = zero glide). */
  glideRatio: number;
  experimental: boolean;
}

export interface N13RodSelection {
  rodFtMin: number | null;
  column: 'sea-level' | '7000ft' | 'range' | null;
  row: N13Parachute | null;
}

export declare const TABLE_N13_SOURCE: string;
export declare const TABLE_N14_SOURCE: string;
export declare const N13_PARACHUTES: N13Parachute[];
export declare function getN13Parachute(id: string): N13Parachute | null;
export declare function n13RateOfDescent(id: string, openingAltFt: number): N13RodSelection;

export declare const N14_OPENING_ALTS_FT: number[];
export declare const N14_WINDS_KT: number[];
export declare const N14_DRIFT_DISTANCE_MILES: Record<number, number[]>;
export declare function n14DriftDistanceMiles(
  openingAltFt: number,
  windKts: number,
): { miles: number | null; altRowFt: number | null; windColKt: number | null };
