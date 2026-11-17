export declare const LAND_FS_OPTIONS: number[];
export declare const LAND_X0_NM: { gps: number; nonGps: number };
export declare const LAND_SRU_NAV_OPTIONS: Array<{ id: string; label: string; value: number }>;
export declare function ceilRadiusNm(value: number): number;
export interface LandPointRadiusResult {
  trNm: number;
  xNm: number;
  yNm: number;
  eNm: number;
  rNm: number;
  rRoundedNm: number;
}
export declare function computePointRadius(input: { trNm: number; x0Nm: number; yNm: number; fs: number }): LandPointRadiusResult;
export interface LandLegTrapezoidResult {
  valid: boolean;
  degenerate: boolean;
  wANm: number;
  wBNm: number;
  aNm: number;
  bNm: number;
  hNm: number;
  areaSqNm: number;
}
export declare function computeLegTrapezoid(dNm: number, rANm: number, rBNm: number): LandLegTrapezoidResult;
export declare function possibilityCircleAreaSqNm(rNm: number): number;
