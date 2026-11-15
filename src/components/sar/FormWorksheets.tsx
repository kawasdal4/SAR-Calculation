'use client';

import { Button } from '@/components/ui/button';
import { Printer } from 'lucide-react';
import FormWorksheet, { type FormSection } from './FormWorksheet';
import type { WorksheetData } from './WorksheetDisplay';

/**
 * All IAMSAR worksheets rendered as authentic-looking blank forms
 * with auto-filled values from current calculation session.
 * Print-ready (A4 portrait).
 */

interface FormWorksheetsProps {
  data: WorksheetData;
}

export default function FormWorksheets({ data }: FormWorksheetsProps) {
  const has = (v: number | undefined) => v !== undefined && v !== null && isFinite(v);
  const f = (v: number | undefined, d = 2) => (has(v) ? v!.toFixed(d) : '');
  const dir = (v: number | undefined) => (has(v) ? `${v!.toFixed(1)}°T` : '');
  const latLng = (p: { lat: number; lng: number } | undefined) =>
    p ? `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` : '';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-2 sticky top-0 bg-white/90 backdrop-blur-sm z-10 py-2 border-b border-slate-200">
        <h2 className="text-sm font-bold text-slate-700">IAMSAR Worksheet Forms</h2>
        <Button onClick={() => window.print()} size="sm">
          <Printer className="h-4 w-4 mr-2" /> Print All Worksheets
        </Button>
      </div>

      {/* Aeronautical Drift Worksheet */}
      <FormWorksheet
        title="Aeronautical Drift Worksheet"
        reference="IAMSAR Vol. II — Appendix K-6"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
          { label: 'Date', value: new Date().toLocaleDateString() },
          { label: 'Planner', value: '' },
        ]}
        sections={[
          {
            title: 'A. Distress Incident / Initial Position',
            fields: [
              { num: '1', label: 'Type of position', value: 'LKP' },
              { num: '2', label: 'Position Date/time', value: '' },
              { num: '3', label: 'Latitude, longitude', value: latLng(data.lkp) },
            ],
          },
          {
            title: 'B. Aircraft Drift (if gliding)',
            fields: [
              { num: '1', label: 'Rate of descent', value: '', unit: 'ft/min' },
              { num: '2', label: 'Glide airspeed', value: '', unit: 'kts' },
              { num: '3', label: 'Altitude at distress', value: '', unit: 'ft' },
              { num: '4', label: 'Time of descent (B.3 ÷ B.1)', value: '', unit: 'min' },
              { num: '5', label: 'Glide distance (B.2 × B.4 ÷ 60)', value: '', unit: 'NM' },
              { num: '6', label: 'Glide heading', value: '', unit: '°T' },
              { num: '7', label: 'Glide direction (B.6 ± 180)', value: '', unit: '°T' },
              { num: '8', label: 'Glide displacement', value: '', unit: '°T / NM' },
              { num: '9', label: 'Aircraft position after glide', value: latLng(data.lkp) },
              { num: '10', label: 'Average wind aloft (AWA)', value: has(data.awaDirFrom) ? `${data.awaDirFrom!.toFixed(1)}°T / ${data.awaSpeed?.toFixed(2)} kts` : '' },
              { num: '11', label: 'Downwind displacement (B.10 × B.4 ÷ 60)', value: '', unit: '°T / NM' },
              { num: '12', label: 'Aircraft landing/ditching position', value: latLng(data.lkp), result: true },
            ],
          },
          {
            title: 'C. Parachute Drift (for zero glide ratio)',
            fields: [
              { num: '1', label: 'Opening altitude', value: '', unit: 'ft' },
              { num: '2', label: 'Rate of descent', value: '', unit: 'ft/min' },
              { num: '3', label: 'Time of descent (C.1 ÷ C.2)', value: '', unit: 'min' },
              { num: '4', label: 'Average wind aloft (AWA)', value: has(data.awaDirFrom) ? `${data.awaDirFrom!.toFixed(1)}°T / ${data.awaSpeed?.toFixed(2)} kts` : '' },
              { num: '5', label: 'Parachute displacement (C.4 × C.3 ÷ 60)', value: '', unit: '°T / NM' },
              { num: '6', label: 'Parachute landing position', value: '', result: true },
            ],
          },
        ]}
      />

      {/* AWA Worksheet */}
      <FormWorksheet
        title="Average Wind Aloft (AWA) Worksheet"
        reference="IAMSAR Vol. II — Appendix K-10"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
          { label: 'Date', value: new Date().toLocaleDateString() },
        ]}
        sections={[
          {
            title: 'Wind Aloft Data & Vector Solution',
            fields: [
              { num: '', label: 'Altitude of observation (low — high)', value: '' },
              { num: '', label: 'Thousands of feet (Δ altitude)', value: data.awaObservations ? `${data.awaObservations.reduce((s, o) => s + o.altitudeKft, 0).toFixed(2)}` : '', unit: 'kft' },
              { num: '', label: 'Wind direction (from, °T)', value: has(data.awaDirFrom) ? `${data.awaDirFrom!.toFixed(1)}` : '', unit: '°T' },
              { num: '', label: 'Wind speed', value: has(data.awaSpeed) ? `${data.awaSpeed!.toFixed(2)}` : '', unit: 'kts' },
              { num: '', label: 'Wind contribution (Δ alt × speed)', value: '', unit: 'kts' },
              { num: '', label: 'Total altitude loss', value: data.awaObservations ? `${data.awaObservations.reduce((s, o) => s + o.altitudeKft, 0).toFixed(2)}` : '', unit: 'kft', result: true },
              { num: '', label: 'Vector sum of contributions', value: '', unit: '°T / kts' },
              { num: '', label: 'Average Wind Aloft (AWA)', value: has(data.awaDirFrom) ? `${data.awaDirFrom!.toFixed(1)}°T / ${data.awaSpeed!.toFixed(2)} kts` : '', result: true },
            ],
          },
        ]}
        footer="Go to line B.10 or C.7 of the Aeronautical drift worksheet."
      >
        {data.awaObservations && data.awaObservations.length > 0 && (
          <table className="iamsar-form-table">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-1 py-0.5 border-r border-slate-300">Alt Low (ft)</th>
                <th className="px-1 py-0.5 border-r border-slate-300">Alt High (ft)</th>
                <th className="px-1 py-0.5 border-r border-slate-300">Δ Alt (kft)</th>
                <th className="px-1 py-0.5 border-r border-slate-300">Wind Dir (°T)</th>
                <th className="px-1 py-0.5 border-r border-slate-300">Wind Spd (kts)</th>
                <th className="px-1 py-0.5">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {data.awaObservations.map((o, i) => (
                <tr key={i} className="border-t border-slate-200">
                  <td className="px-1 py-0.5 border-r border-slate-200 font-mono">{(o.altitudeKft * 1000).toFixed(0)}</td>
                  <td className="px-1 py-0.5 border-r border-slate-200 font-mono">{((o.altitudeKft + 2) * 1000).toFixed(0)}</td>
                  <td className="px-1 py-0.5 border-r border-slate-200 font-mono">{o.altitudeKft.toFixed(2)}</td>
                  <td className="filled">{o.windDirFrom}°T</td>
                  <td className="filled">{o.windSpeed}</td>
                  <td className="filled">{o.contribution.dir.toFixed(0)}°T / {o.contribution.mag.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </FormWorksheet>

      {/* ASW Worksheet */}
      <FormWorksheet
        title="Average Surface Wind (ASW) Worksheet"
        reference="IAMSAR Vol. II — Appendix K-19"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
          { label: 'Date', value: new Date().toLocaleDateString() },
        ]}
        sections={[
          {
            title: 'A. Average Surface Wind',
            fields: [
              { num: '1', label: 'Surface wind data (time, hours, direction, speed)', value: '' },
              { num: '', label: 'Total hours', value: data.aswObservations ? `${data.aswObservations.reduce((s, o) => s + o.hours, 0).toFixed(1)}` : '', unit: 'hours', result: true },
              { num: '', label: 'Vector sum of contributions', value: '', unit: '°T / NM' },
              { num: '2', label: 'Average Surface Wind (ASW)', value: has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed!.toFixed(2)} kts` : '', result: true },
            ],
          },
          {
            title: 'B. Probable Error',
            fields: [
              { num: '1', label: 'Probable error of ASW (ASWe)', value: '2.00', unit: 'kts' },
              { num: '2', label: 'Probable error of drift velocity (ASWDVe)', value: f(data.aswdve, 3), unit: 'kts', result: true },
            ],
          },
        ]}
        footer="Go to part C on the Datum worksheet."
      >
        {data.aswObservations && data.aswObservations.length > 0 && (
          <table className="iamsar-form-table">
            <thead className="bg-slate-100">
              <tr>
                <th className="px-1 py-0.5 border-r border-slate-300">Time Start</th>
                <th className="px-1 py-0.5 border-r border-slate-300">Time End</th>
                <th className="px-1 py-0.5 border-r border-slate-300">Hours</th>
                <th className="px-1 py-0.5 border-r border-slate-300">Wind Dir (°T)</th>
                <th className="px-1 py-0.5 border-r border-slate-300">Wind Spd (kts)</th>
                <th className="px-1 py-0.5">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {data.aswObservations.map((o, i) => (
                <tr key={i} className="border-t border-slate-200">
                  <td className="px-1 py-0.5 border-r border-slate-200">—</td>
                  <td className="px-1 py-0.5 border-r border-slate-200">—</td>
                  <td className="filled">{o.hours}</td>
                  <td className="filled">{o.windDirFrom}°T</td>
                  <td className="filled">{o.windSpeed}</td>
                  <td className="filled">{((o.windDirFrom + 180) % 360).toFixed(0)}°T / {(o.hours * o.windSpeed).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </FormWorksheet>

      {/* Wind Current Worksheet */}
      <FormWorksheet
        title="Wind Current (WC) Worksheet"
        reference="IAMSAR Vol. II — Appendix K-26"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
          { label: 'Date', value: new Date().toLocaleDateString() },
        ]}
        sections={[
          {
            fields: [
              { num: '1', label: 'Average surface wind (ASW)', value: has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '' },
              { num: '2', label: 'Downwind direction (ASW ± 180°)', value: has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}` : '', unit: '°T' },
              { num: '3', label: 'Wind current drift (from fig. N-1)', value: has(data.aswSpeed) ? `${(data.aswSpeed! * 0.03).toFixed(3)}` : '', unit: 'kts' },
              { num: '4', label: 'Divergence of wind current (from fig. N-1)', value: '0', unit: '°' },
              { num: '5', label: 'Wind current set (downwind ± divergence)', value: has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}` : '', unit: '°T', result: true },
              { num: '6', label: 'Wind current (WC) set/drift', value: has(data.aswSpeed) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T / ${(data.aswSpeed! * 0.03).toFixed(3)} kts` : '', result: true },
              { num: '7', label: 'Probable error of wind current (WCe)', value: '0.30', unit: 'kts' },
              { num: '8', label: 'Go to line B.3 on the TWC worksheet', value: '' },
            ],
          },
        ]}
      />

      {/* Leeway Worksheet */}
      <FormWorksheet
        title="Leeway (LW) Worksheet"
        reference="IAMSAR Vol. II — Appendix K-28"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
          { label: 'Search object', value: '' },
        ]}
        sections={[
          {
            fields: [
              { num: '1', label: 'Average surface wind (ASW)', value: has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '' },
              { num: '2', label: 'Downwind direction (ASW ± 180°)', value: has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}` : '', unit: '°T' },
              { num: '3', label: 'Leeway speed (from fig. N-2 or N-3)', value: f(data.lwSpeed, 3), unit: 'kts', result: true },
              { num: '4', label: 'Leeway divergence angle (from fig. N-2 or N-3)', value: '±13', unit: '°' },
              { num: '5a', label: 'Leeway direction — Left of downwind (2 – 4)', value: dir(data.lwLeftDir), unit: '°T', result: true },
              { num: '5b', label: 'Leeway direction — Right of downwind (2 + 4)', value: dir(data.lwRightDir), unit: '°T', result: true },
              { num: '6a', label: 'Leeway (LW) — Left', value: dir(data.lwLeftDir) + (has(data.lwSpeed) ? ` / ${data.lwSpeed!.toFixed(3)} kts` : ''), result: true },
              { num: '6b', label: 'Leeway (LW) — Right', value: dir(data.lwRightDir) + (has(data.lwSpeed) ? ` / ${data.lwSpeed!.toFixed(3)} kts` : ''), result: true },
              { num: '7', label: 'Probable leeway error (LWe)', value: '0.120', unit: 'kts' },
              { num: '8', label: 'Go to Part E on the Datum worksheet', value: '' },
            ],
          },
        ]}
      />

      {/* TWC Worksheet */}
      <FormWorksheet
        title="Total Water Current (TWC) Worksheet"
        reference="IAMSAR Vol. II — Appendix K"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
        ]}
        sections={[
          {
            title: 'A. Observed Total Water Current (if available)',
            fields: [
              { num: '1', label: 'Total water current set', value: '', unit: '°T' },
              { num: '2', label: 'Probable error', value: '', unit: 'kts' },
            ],
          },
          {
            title: 'B. Computed Total Water Current',
            fields: [
              { num: '1', label: 'Sea current set/drift', value: has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T / ${data.twcSpeed?.toFixed(3)} kts` : '', unit: '' },
              { num: '2', label: 'Sea current error (SCe)', value: '0.30', unit: 'kts' },
              { num: '3', label: 'Wind current (from WC worksheet)', value: has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T / ${(data.aswSpeed! * 0.03).toFixed(3)} kts` : '' },
              { num: '3b', label: 'Wind current error (WCe)', value: '0.30', unit: 'kts' },
              { num: '4', label: 'Tidal current set/drift (if applicable)', value: '—', unit: '°T / kts' },
              { num: '4b', label: 'Tidal current error (TCe)', value: '—', unit: 'kts' },
              { num: '5', label: 'Total water current (TWC) set/drift', value: has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T / ${data.twcSpeed!.toFixed(3)} kts` : '', result: true },
              { num: '6', label: 'Probable total water current error (TWCe)', value: '0.424', unit: 'kts', result: true },
            ],
          },
        ]}
        footer="Go to part D on the Datum worksheet."
      />

      {/* Datum Worksheet */}
      <FormWorksheet
        title="Datum Worksheet (Marine Environment)"
        reference="IAMSAR Vol. II — Appendix K-13"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
          { label: 'Planner', value: '' },
          { label: 'Search plan', value: 'A' },
          { label: 'Search object', value: '' },
        ]}
        sections={[
          {
            title: 'A. Starting Position for this Drift Interval',
            fields: [
              { num: '1', label: 'Type of position', value: 'LKP (Last Known Position)' },
              { num: '2', label: 'Position Date/time', value: '' },
              { num: '3', label: 'Latitude, longitude', value: latLng(data.lkp) },
            ],
          },
          {
            title: 'B. Datum Time',
            fields: [
              { num: '1', label: 'Commence search date/time', value: '' },
              { num: '2', label: 'Drift interval', value: '6.00', unit: 'hours' },
            ],
          },
          {
            title: 'C. Average Surface Wind (ASW)',
            fields: [
              { num: '1', label: 'Average surface wind (ASW)', value: has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed!.toFixed(2)} kts` : '', result: true },
              { num: '2', label: 'ASWDVe', value: f(data.aswdve, 3), unit: 'kts' },
            ],
          },
          {
            title: 'D. Total Water Current (TWC)',
            fields: [
              { num: '1', label: 'Total water current (TWC)', value: has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T / ${data.twcSpeed!.toFixed(3)} kts` : '', result: true },
              { num: '2', label: 'Probable total water current error (TWCe)', value: '0.424', unit: 'kts' },
            ],
          },
          {
            title: 'E. Leeway (LW)',
            fields: [
              { num: '1', label: 'Left of downwind', value: dir(data.lwLeftDir) + (has(data.lwSpeed) ? ` / ${data.lwSpeed!.toFixed(3)} kts` : ''), result: true },
              { num: '2', label: 'Right of downwind', value: dir(data.lwRightDir) + (has(data.lwSpeed) ? ` / ${data.lwSpeed!.toFixed(3)} kts` : ''), result: true },
              { num: '3', label: 'Probable leeway error (LWe)', value: '0.120', unit: 'kts' },
            ],
          },
          {
            title: 'F. Total Surface Drift',
            fields: [
              { num: '', label: 'Add TWC + Leeway vectors (left / right of downwind)', header: true },
              { num: '1', label: 'Drift directions (left / right)', value: '', unit: '°T / °T' },
              { num: '2', label: 'Drift speeds', value: '', unit: 'kts' },
              { num: '3', label: 'Drift distances (F.2 × B.2)', value: f(data.driftDistance, 2), unit: 'NM', result: true },
              { num: '4', label: 'Total probable drift velocity error (DVe)', value: f(data.dve, 3), unit: 'kts', result: true },
            ],
          },
          {
            title: 'G. Datum Positions and Divergence Distance',
            fields: [
              { num: '1', label: 'Latitude, longitude (left of downwind)', value: latLng(data.datumLeft), result: true },
              { num: '2', label: 'Latitude, longitude (right of downwind)', value: latLng(data.datumRight), result: true },
              { num: '3', label: 'Divergence distance (DD)', value: f(data.divergenceDistance, 2), unit: 'NM' },
            ],
          },
          {
            title: 'H. Total Probable Error of Position (E) and Separation Ratio (SR)',
            fields: [
              { num: '1', label: 'Total probable error of position squared (E²)', value: has(data.E) ? `${(data.E! * data.E!).toFixed(2)}` : '', unit: 'NM²' },
              { num: '2', label: 'Total probable error of position (E)', value: f(data.E, 2), unit: 'NM', result: true },
              { num: '3', label: 'Separation ratio (SR = DD / E)', value: has(data.E) && has(data.divergenceDistance) ? `${(data.divergenceDistance! / data.E!).toFixed(2)}` : '' },
              { num: '4', label: 'Go to the Total Available Search Effort worksheet', value: '' },
            ],
          },
        ]}
      />

      {/* Total Probable Error of Position (E) Worksheet */}
      <FormWorksheet
        title="Total Probable Error of Position (E) Worksheet"
        reference="IAMSAR Vol. II — Appendix K-31"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
        ]}
        sections={[
          {
            title: 'A. Probable Distress Incident/Initial Position Error (X)',
            fields: [
              { num: '1', label: 'Navigational fix error (from table N-1 or N-2)', value: f(data.X, 2), unit: 'NM' },
              { num: '2', label: 'Dead reckoning (DR) error rate (from table N-3)', value: '', unit: '%' },
              { num: '3', label: 'DR distance since last fix', value: '', unit: 'NM' },
              { num: '4', label: 'DR navigational error (A.2 × A.3)', value: '', unit: 'NM' },
              { num: '5', label: 'Glide distance (if aircraft/parachute, unknown heading)', value: '', unit: 'NM' },
              { num: '6', label: 'Probable initial position error (X)', value: f(data.X, 2), unit: 'NM', result: true },
            ],
          },
          {
            title: 'B. Total Probable Drift Error (De)',
            fields: [
              { num: '1', label: 'Drift interval (from B.2 of Datum)', value: '6.00', unit: 'hours' },
              { num: '2', label: 'Probable drift velocity error (DVe)', value: f(data.dve, 3), unit: 'kts' },
              { num: '3', label: 'Total probable drift error (De = B.1 × B.2)', value: f(data.De, 2), unit: 'NM', result: true },
            ],
          },
          {
            title: 'C. Probable Search Facility Position Error (Y)',
            fields: [
              { num: '1', label: 'Navigational fix error', value: f(data.Y, 2), unit: 'NM' },
              { num: '2', label: 'DR error rate', value: '', unit: '%' },
              { num: '3', label: 'DR distance since last fix', value: '', unit: 'NM' },
              { num: '4', label: 'DR navigational error', value: '', unit: 'NM' },
              { num: '5', label: 'Probable search facility position error (Y)', value: f(data.Y, 2), unit: 'NM', result: true },
            ],
          },
          {
            title: 'D. Total Probable Error of Position (E)',
            fields: [
              { num: '1', label: 'Sum of squared errors (E² = X² + De² + Y²)', value: has(data.E) ? `${(data.E! * data.E!).toFixed(2)}` : '', unit: 'NM²' },
              { num: '2', label: 'Total probable error of position (E = √(X²+De²+Y²))', value: f(data.E, 2), unit: 'NM', result: true },
            ],
          },
        ]}
      />

      {/* Total Available Search Effort (Zta) Worksheet */}
      <FormWorksheet
        title="Total Available Search Effort (Zta) Worksheet"
        reference="IAMSAR Vol. II — Appendix L-1"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
        ]}
        sections={[
          {
            title: 'Per-Facility Search Effort Calculation',
            fields: [
              { num: '1', label: 'Search sub-area designation', value: 'A-1' },
              { num: '2', label: 'Search facility assigned', value: 'SAR Aircraft #1' },
              { num: '3', label: 'Search speed (V)', value: '150', unit: 'kts' },
              { num: '4', label: 'On-scene endurance', value: '5.00', unit: 'hours' },
              { num: '5', label: 'Daylight hours remaining', value: '8', unit: 'hours' },
              { num: '6', label: 'Search endurance (T) = 85% × min(4,5)', value: '4.25', unit: 'hours', result: true },
              { num: '7', label: 'Search altitude', value: '1000', unit: 'ft' },
              { num: '8', label: 'Uncorrected sweep width (Wu)', value: '4.00', unit: 'NM' },
              { num: '9', label: 'Weather correction factor (fw)', value: '1.00' },
              { num: '10', label: 'Velocity correction factor (fv)', value: '0.90' },
              { num: '11', label: 'Fatigue correction factor (ff)', value: '1.00' },
              { num: '12', label: 'Corrected sweep width (W = Wu × fw × fv × ff)', value: '3.60', unit: 'NM', result: true },
              { num: '13', label: 'Search effort (Z = V × T × W)', value: '2295', unit: 'NM²', result: true },
              { num: '14', label: 'Total available search effort (Zta)', value: f(data.Zta, 0), unit: 'NM²', result: true },
              { num: '15', label: 'Separation ratio (SR)', value: has(data.E) && has(data.divergenceDistance) ? `${(data.divergenceDistance! / data.E!).toFixed(2)}` : '' },
            ],
          },
        ]}
      />

      {/* Effort Allocation Worksheet */}
      <FormWorksheet
        title="Effort Allocation Worksheet"
        reference="IAMSAR Vol. II — Appendix L-7"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
        ]}
        sections={[
          {
            title: 'Effort Allocation Computations',
            fields: [
              { num: '1', label: 'Total available search effort (Zta)', value: f(data.Zta, 0), unit: 'NM²' },
              { num: '2a', label: 'Datum (left of downwind)', value: latLng(data.datumLeft) },
              { num: '2b', label: 'Datum line length (L) / Divergence distance (DD)', value: f(data.divergenceDistance, 2), unit: 'NM' },
              { num: '3', label: 'Effort factor (fZ = E²)', value: has(data.E) ? `${(data.E! * data.E!).toFixed(2)}` : '' },
              { num: '4', label: 'Relative effort (Zr = Zta / fZ)', value: has(data.Zta) && has(data.E) ? `${(data.Zta! / (data.E! * data.E!)).toFixed(2)}` : '', result: true },
              { num: '5', label: 'Cumulative relative effort (Zrc)', value: has(data.Zta) && has(data.E) ? `${(data.Zta! / (data.E! * data.E!)).toFixed(2)}` : '', result: true },
              { num: '6', label: 'Optimal search factor (fs) — from fig. N-5/N-6', value: f(data.fs, 2), result: true },
              { num: '7', label: 'Optimal search radius (Ro = fs × E)', value: f(data.Ro, 2), unit: 'NM', result: true },
              { num: '8', label: 'Optimal coverage factor (Co = Zta / Ao)', value: f(data.C, 2) },
              { num: '9', label: 'Optimal track spacing (So = W / Co)', value: f(data.trackSpacing, 2), unit: 'NM' },
              { num: '10', label: 'Nearest assignable track spacing', value: f(data.trackSpacing, 2), unit: 'NM' },
              { num: '11', label: 'Adjusted search area (A = V × T × S)', value: '', unit: 'NM²' },
              { num: '12', label: 'Total adjusted search area (At)', value: '', unit: 'NM²' },
              { num: '13', label: 'Adjusted search radius (R)', value: f(data.Ro, 2), unit: 'NM' },
              { num: '14a', label: 'Length of search area', value: f(data.searchAreaLength, 1), unit: 'NM', result: true },
              { num: '14b', label: 'Width of search area', value: f(data.searchAreaWidth, 1), unit: 'NM', result: true },
            ],
          },
          {
            title: 'Results Summary',
            fields: [
              { num: '', label: 'Optimal search area (Ao)', value: f(data.Ao, 0), unit: 'NM²', result: true },
              { num: '', label: 'Coverage factor (C)', value: f(data.C, 2), result: true },
              { num: '', label: 'POD (probability of detection)', value: has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '', result: true },
            ],
          },
        ]}
      />

      {/* Search Evaluation Worksheet */}
      <FormWorksheet
        title="Search Evaluation Worksheet"
        reference="IAMSAR Vol. II — Appendix L-28"
        meta={[
          { label: 'Case title', value: '' },
          { label: 'Case number', value: '' },
        ]}
        sections={[
          {
            title: 'Search Evaluation',
            fields: [
              { num: '1', label: 'Search sub-area', value: 'A-1' },
              { num: '2', label: 'Search effort (Z)', value: f(data.Zta, 0), unit: 'NM²' },
              { num: '3', label: 'Area searched (A)', value: f(data.Ao, 0), unit: 'NM²' },
              { num: '4', label: 'Coverage factor (C = Z / A)', value: f(data.C, 2), result: true },
              { num: '5', label: 'POD (from fig. N-10)', value: has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '', result: true },
              { num: '6', label: 'POC before search', value: '100.0%' },
              { num: '7', label: 'POS = POC × POD', value: has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '', unit: '', result: true },
              { num: '8', label: 'POC after search = (1 - POD) × POC', value: has(data.POD) ? `${((1 - data.POD!) * 100).toFixed(1)}%` : '' },
              { num: '9', label: 'Cumulative POSc', value: has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '', result: true },
            ],
          },
        ]}
      />
    </div>
  );
}
