const SUPER = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

/** Round the maximum elevation upward to the next 100-foot MEF step. */
export function calculateMefFeet(maxElevationFeet) {
  if (!Number.isFinite(maxElevationFeet)) {
    throw new TypeError('Maximum elevation must be a finite number.');
  }
  // DEM values at or below sea level are represented as 0⁰ in the ONC label.
  if (maxElevationFeet <= 0) return 0;
  return Math.ceil(maxElevationFeet / 100) * 100;
}

/** Split an MEF value into ONC-style large thousands and superscript hundreds. */
export function formatMefFeet(mefFeet) {
  if (!Number.isInteger(mefFeet) || mefFeet < 0 || mefFeet % 100 !== 0) {
    throw new RangeError('MEF must be a non-negative number of feet in 100-foot increments.');
  }
  const large = String(Math.floor(mefFeet / 1000));
  const hundreds = Math.floor((mefFeet % 1000) / 100);
  const superscript = SUPER[hundreds];
  return { large, hundreds, superscript, label: `${large}${superscript}` };
}

export function deriveMefFromMeters(maxElevationMeters) {
  if (!Number.isFinite(maxElevationMeters)) {
    throw new TypeError('Maximum elevation must be a finite number.');
  }
  const maximumFeet = maxElevationMeters * 3.280839895;
  const mefFeet = calculateMefFeet(maximumFeet);
  return { maximumFeet, mefFeet, ...formatMefFeet(mefFeet) };
}
