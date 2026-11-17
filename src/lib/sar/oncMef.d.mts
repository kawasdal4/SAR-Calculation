export function calculateMefFeet(maxElevationFeet: number): number;
export function formatMefFeet(mefFeet: number): {
  large: string;
  hundreds: number;
  superscript: string;
  label: string;
};
export function deriveMefFromMeters(maxElevationMeters: number): {
  maximumFeet: number;
  mefFeet: number;
  large: string;
  hundreds: number;
  superscript: string;
  label: string;
};
