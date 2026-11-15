'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Display all IAMSAR Vol II worksheets with filled values from current session.
 * Each worksheet is rendered as a printable card showing the step-by-step
 * calculations with actual numbers.
 */

export interface WorksheetData {
  // From AWA
  awaDirFrom?: number;
  awaSpeed?: number;
  awaObservations?: Array<{ altitudeKft: number; windDirFrom: number; windSpeed: number; contribution: { dir: number; mag: number } }>;

  // From ASW
  aswDirFrom?: number;
  aswSpeed?: number;
  aswObservations?: Array<{ hours: number; windDirFrom: number; windSpeed: number }>;

  // From Datum
  lkp?: { lat: number; lng: number };
  datumLeft?: { lat: number; lng: number };
  datumRight?: { lat: number; lng: number };
  driftDistance?: number;
  divergenceDistance?: number;
  E?: number;
  twcDir?: number;
  twcSpeed?: number;
  lwLeftDir?: number;
  lwRightDir?: number;
  lwSpeed?: number;
  aswdve?: number;
  dve?: number;
  De?: number;
  X?: number;
  Y?: number;

  // From Search Plan
  Zta?: number;
  Ro?: number;
  Ao?: number;
  C?: number;
  fs?: number;
  POD?: number;
  trackSpacing?: number;
  searchAreaLength?: number;
  searchAreaWidth?: number;
  searchAreaCenter?: { lat: number; lng: number };
}

interface WorksheetDisplayProps {
  data: WorksheetData;
}

export default function WorksheetDisplay({ data }: WorksheetDisplayProps) {
  const has = (v: number | undefined) => v !== undefined && v !== null && isFinite(v);

  return (
    <div className="space-y-4 print:space-y-2">
      {/* Aeronautical Drift Worksheet (Appendix K-6) */}
      <WorksheetCard title="Aeronautical Drift" reference="Appendix K-6">
        <Row label="1. Aeronautical Position" value={data.lkp ? `${data.lkp.lat.toFixed(4)}, ${data.lkp.lng.toFixed(4)}` : '—'} />
        <Row label="2. Glide Distance (if aircraft)" value="—" />
        <Row label="3. AWA (from AWA worksheet)" value={has(data.awaDirFrom) ? `${data.awaDirFrom!.toFixed(1)}°T / ${data.awaSpeed?.toFixed(2)} kts` : '—'} />
        <Row label="4. Downwind Displacement" value={has(data.awaDirFrom) ? `${((data.awaDirFrom! + 180) % 360).toFixed(1)}°T` : '—'} />
        <Row label="5. Parachute Drift (if applicable)" value="—" />
        <Row label="6. Landing/Ditching Position" value={data.lkp ? `${data.lkp.lat.toFixed(4)}, ${data.lkp.lng.toFixed(4)}` : '—'} highlight />
      </WorksheetCard>

      {/* Average Wind Aloft (AWA) Worksheet (Appendix K-10) */}
      <WorksheetCard title="Average Wind Aloft (AWA)" reference="Appendix K-10">
        <Row label="1. Average Surface Wind (from ASW)" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '—'} />
        <Row label="2. Downwind Direction" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T` : '—'} />
        <Row label="3. Total Altitude Loss" value={data.awaObservations ? `${data.awaObservations.reduce((s, o) => s + o.altitudeKft, 0).toFixed(2)} kft` : '—'} />
        <Row label="4. AWA Direction" value={has(data.awaDirFrom) ? `${data.awaDirFrom!.toFixed(1)}°T` : '—'} highlight />
        <Row label="5. AWA Speed" value={has(data.awaSpeed) ? `${data.awaSpeed!.toFixed(2)} kts` : '—'} highlight />
        {data.awaObservations && data.awaObservations.length > 0 && (
          <div className="mt-2">
            <div className="text-[9px] uppercase text-slate-500 mb-1">Observations</div>
            {data.awaObservations.map((o, i) => (
              <div key={i} className="text-[10px] font-mono text-slate-600">
                {o.altitudeKft.toFixed(2)} kft · {o.windDirFrom}°T / {o.windSpeed} kts → contribution: {o.contribution.dir.toFixed(0)}°T / {o.contribution.mag.toFixed(1)}
              </div>
            ))}
          </div>
        )}
      </WorksheetCard>

      {/* Average Surface Wind (ASW) Worksheet (Appendix K-19) */}
      <WorksheetCard title="Average Surface Wind (ASW)" reference="Appendix K-19">
        <Row label="1. Total Hours" value={data.aswObservations ? `${data.aswObservations.reduce((s, o) => s + o.hours, 0).toFixed(1)} h` : '—'} />
        <Row label="2. ASW Direction" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T` : '—'} highlight />
        <Row label="3. ASW Speed" value={has(data.aswSpeed) ? `${data.aswSpeed!.toFixed(2)} kts` : '—'} highlight />
        <Row label="4. ASW Error (ASWe)" value="2.00 kts" />
        <Row label="5. ASWDVe" value={has(data.aswdve) ? `${data.aswdve!.toFixed(3)} kts` : '—'} />
        {data.aswObservations && data.aswObservations.length > 0 && (
          <div className="mt-2">
            <div className="text-[9px] uppercase text-slate-500 mb-1">Observations</div>
            {data.aswObservations.map((o, i) => (
              <div key={i} className="text-[10px] font-mono text-slate-600">
                {o.hours}h · {o.windDirFrom}°T / {o.windSpeed} kts → contribution: {((o.windDirFrom + 180) % 360).toFixed(0)}°T / {(o.hours * o.windSpeed).toFixed(1)}
              </div>
            ))}
          </div>
        )}
      </WorksheetCard>

      {/* Wind Current (WC) Worksheet (Appendix K-26) */}
      <WorksheetCard title="Wind Current (WC)" reference="Appendix K-26">
        <Row label="1. ASW" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '—'} />
        <Row label="2. Downwind Direction" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T` : '—'} />
        <Row label="3. WC Drift (3% × ASW)" value={has(data.aswSpeed) ? `${(data.aswSpeed! * 0.03).toFixed(3)} kts` : '—'} />
        <Row label="4. Divergence" value="0° (N hemisphere)" />
        <Row label="5. WC Set" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T` : '—'} highlight />
        <Row label="6. WC Drift" value={has(data.aswSpeed) ? `${(data.aswSpeed! * 0.03).toFixed(3)} kts` : '—'} highlight />
        <Row label="7. WC Error (WCe)" value="0.30 kts" />
      </WorksheetCard>

      {/* Total Water Current (TWC) Worksheet (Appendix K) */}
      <WorksheetCard title="Total Water Current (TWC)" reference="Appendix K">
        <Row label="1. Sea Current Set" value={has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T` : '—'} />
        <Row label="2. Sea Current Drift" value={has(data.twcSpeed) ? `${data.twcSpeed!.toFixed(3)} kts` : '—'} />
        <Row label="3. Wind Current" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T / ${(data.aswSpeed! * 0.03).toFixed(3)} kts` : '—'} />
        <Row label="4. TWC Set" value={has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T` : '—'} highlight />
        <Row label="5. TWC Drift" value={has(data.twcSpeed) ? `${data.twcSpeed!.toFixed(3)} kts` : '—'} highlight />
        <Row label="6. TWC Error (TWCe)" value="0.424 kts" />
      </WorksheetCard>

      {/* Leeway (LW) Worksheet (Appendix K-28) */}
      <WorksheetCard title="Leeway (LW)" reference="Appendix K-28">
        <Row label="1. ASW" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '—'} />
        <Row label="2. Downwind Direction" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T` : '—'} />
        <Row label="3. Leeway Speed" value={has(data.lwSpeed) ? `${data.lwSpeed!.toFixed(3)} kts` : '—'} highlight />
        <Row label="4. Divergence Angle" value="±13°" />
        <Row label="5. Leeway Left" value={has(data.lwLeftDir) ? `${data.lwLeftDir!.toFixed(1)}°T` : '—'} highlight />
        <Row label="5. Leeway Right" value={has(data.lwRightDir) ? `${data.lwRightDir!.toFixed(1)}°T` : '—'} highlight />
        <Row label="6. Leeway Error (LWe)" value="0.120 kts" />
      </WorksheetCard>

      {/* Datum Worksheet (Marine) (Appendix K-13) */}
      <WorksheetCard title="Datum (Marine Environment)" reference="Appendix K-13">
        <Row label="A. Starting Position (LKP)" value={data.lkp ? `${data.lkp.lat.toFixed(4)}, ${data.lkp.lng.toFixed(4)}` : '—'} />
        <Row label="B. Drift Interval" value="6.00 hours" />
        <Row label="C. ASW" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '—'} />
        <Row label="C. ASWDVe" value={has(data.aswdve) ? `${data.aswdve!.toFixed(3)} kts` : '—'} />
        <Row label="D. TWC" value={has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T / ${data.twcSpeed?.toFixed(3)} kts` : '—'} />
        <Row label="D. TWCe" value="0.424 kts" />
        <Row label="E. Leeway Left" value={has(data.lwLeftDir) ? `${data.lwLeftDir!.toFixed(1)}°T / ${data.lwSpeed?.toFixed(3)} kts` : '—'} />
        <Row label="E. Leeway Right" value={has(data.lwRightDir) ? `${data.lwRightDir!.toFixed(1)}°T / ${data.lwSpeed?.toFixed(3)} kts` : '—'} />
        <Row label="E. LWe" value="0.120 kts" />
        <Row label="F. Drift Direction (Left)" value="—" />
        <Row label="F. Drift Direction (Right)" value="—" />
        <Row label="F. Drift Distance" value={has(data.driftDistance) ? `${data.driftDistance!.toFixed(2)} NM` : '—'} highlight />
        <Row label="F. DVe" value={has(data.dve) ? `${data.dve!.toFixed(3)} kts` : '—'} />
        <Row label="G. Datum Left" value={data.datumLeft ? `${data.datumLeft.lat.toFixed(4)}, ${data.datumLeft.lng.toFixed(4)}` : '—'} highlight />
        <Row label="G. Datum Right" value={data.datumRight ? `${data.datumRight.lat.toFixed(4)}, ${data.datumRight.lng.toFixed(4)}` : '—'} highlight />
        <Row label="G. Divergence Distance (DD)" value={has(data.divergenceDistance) ? `${data.divergenceDistance!.toFixed(2)} NM` : '—'} />
        <Row label="H. E²" value={has(data.E) ? `${(data.E! * data.E!).toFixed(2)} NM²` : '—'} />
        <Row label="H. E (Total Probable Error)" value={has(data.E) ? `${data.E!.toFixed(2)} NM` : '—'} highlight />
        <Row label="H. SR (Separation Ratio)" value={has(data.E) && has(data.divergenceDistance) ? `${(data.divergenceDistance! / data.E!).toFixed(2)}` : '—'} />
      </WorksheetCard>

      {/* Total Probable Error of Position (E) Worksheet (Appendix K-31) */}
      <WorksheetCard title="Total Probable Error of Position (E)" reference="Appendix K-31">
        <Row label="A. Navigational Fix Error (X)" value={has(data.X) ? `${data.X!.toFixed(2)} NM` : '—'} />
        <Row label="A. DR Navigational Error" value="—" />
        <Row label="A. Probable Initial Position Error (X)" value={has(data.X) ? `${data.X!.toFixed(2)} NM` : '—'} />
        <Row label="B. Drift Interval" value="6.00 hours" />
        <Row label="B. DVe" value={has(data.dve) ? `${data.dve!.toFixed(3)} kts` : '—'} />
        <Row label="B. Total Probable Drift Error (De)" value={has(data.De) ? `${data.De!.toFixed(2)} NM` : '—'} highlight />
        <Row label="C. Search Facility Position Error (Y)" value={has(data.Y) ? `${data.Y!.toFixed(2)} NM` : '—'} />
        <Row label="D. E² = X² + De² + Y²" value={has(data.E) ? `${(data.E! * data.E!).toFixed(2)} NM²` : '—'} />
        <Row label="D. E = √(X² + De² + Y²)" value={has(data.E) ? `${data.E!.toFixed(2)} NM` : '—'} highlight />
      </WorksheetCard>

      {/* Total Available Search Effort (Zta) Worksheet (Appendix L-1) */}
      <WorksheetCard title="Total Available Search Effort (Zta)" reference="Appendix L-1">
        <Row label="1. Search Sub-area Designation" value="A-1" />
        <Row label="2. Search Facility Assigned" value="SAR Aircraft #1" />
        <Row label="3. Search Speed (V)" value="150 kts" />
        <Row label="4. On-scene Endurance" value="5.00 h" />
        <Row label="5. Daylight Hours Remaining" value="8 h" />
        <Row label="6. Search Endurance (T) = 85% × min(4,5)" value="4.25 h" />
        <Row label="7. Search Altitude" value="1000 ft" />
        <Row label="8. Uncorrected Sweep Width (Wu)" value="4.00 NM" />
        <Row label="9. Weather Correction Factor (fw)" value="1.00" />
        <Row label="10. Velocity Correction Factor (fv)" value="0.90" />
        <Row label="11. Fatigue Correction Factor (ff)" value="1.00" />
        <Row label="12. Corrected Sweep Width (W)" value="3.60 NM" />
        <Row label="13. Search Effort Z = V × T × W" value="2295 NM²" />
        <Row label="14. Total Available Search Effort (Zta)" value={has(data.Zta) ? `${data.Zta!.toFixed(0)} NM²` : '—'} highlight />
      </WorksheetCard>

      {/* Effort Allocation Worksheet (Appendix L-7) */}
      <WorksheetCard title="Effort Allocation" reference="Appendix L-7">
        <Row label="1. Total Available Search Effort (Zta)" value={has(data.Zta) ? `${data.Zta!.toFixed(0)} NM²` : '—'} />
        <Row label="2. Datum Type" value="Leeway Divergence" />
        <Row label="2a. Datum Left" value={data.datumLeft ? `${data.datumLeft.lat.toFixed(4)}, ${data.datumLeft.lng.toFixed(4)}` : '—'} />
        <Row label="2b. Datum Line Length (L) / DD" value={has(data.divergenceDistance) ? `${data.divergenceDistance!.toFixed(2)} NM` : '—'} />
        <Row label="3. Effort Factor (fZ = E²)" value={has(data.E) ? `${(data.E! * data.E!).toFixed(2)}` : '—'} />
        <Row label="4. Relative Effort (Zr = Zta / fZ)" value={has(data.Zta) && has(data.E) ? `${(data.Zta! / (data.E! * data.E!)).toFixed(2)}` : '—'} />
        <Row label="5. Cumulative Relative Effort (Zrc)" value={has(data.Zta) && has(data.E) ? `${(data.Zta! / (data.E! * data.E!)).toFixed(2)}` : '—'} />
        <Row label="6. Optimal Search Factor (fs)" value={has(data.fs) ? `${data.fs!.toFixed(2)}` : '—'} highlight />
        <Row label="7. Optimal Search Radius (Ro = fs × E)" value={has(data.Ro) ? `${data.Ro!.toFixed(2)} NM` : '—'} highlight />
        <Row label="8. Optimal Search Area (Ao)" value={has(data.Ao) ? `${data.Ao!.toFixed(0)} NM²` : '—'} highlight />
        <Row label="9. Optimal Coverage Factor (C = Zta / Ao)" value={has(data.C) ? `${data.C!.toFixed(2)}` : '—'} />
        <Row label="10. Nearest Assignable Track Spacing" value={has(data.trackSpacing) ? `${data.trackSpacing!.toFixed(2)} NM` : '—'} />
        <Row label="11. Adjusted Search Area" value="—" />
        <Row label="12. Total Adjusted Search Area" value="—" />
        <Row label="13. Adjusted Search Radius" value={has(data.Ro) ? `${data.Ro!.toFixed(2)} NM` : '—'} />
        <Row label="14. Search Area Dimensions" value={has(data.searchAreaLength) ? `${data.searchAreaLength!.toFixed(1)} × ${data.searchAreaWidth?.toFixed(1)} NM` : '—'} highlight />
        <Row label="POD" value={has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '—'} highlight />
      </WorksheetCard>

      {/* Search Action Plan Worksheet (Appendix L-23) */}
      <WorksheetCard title="Search Action Plan" reference="Appendix L-23">
        <Row label="1. Situation Summary" value={data.lkp ? `Distress at ${data.lkp.lat.toFixed(4)}, ${data.lkp.lng.toFixed(4)}` : '—'} />
        <Row label="2. Search Object" value="6-person liferaft with canopy" />
        <Row label="3. Search Areas (corner points)" value={data.datumLeft ? `Datum L: ${data.datumLeft.lat.toFixed(2)}, ${data.datumLeft.lng.toFixed(2)}` : '—'} />
        <Row label="4. Execution: SAR Facility / Pattern / CSP" value={has(data.searchAreaLength) ? `Area ${data.searchAreaLength!.toFixed(1)}×${data.searchAreaWidth?.toFixed(1)} NM, PS pattern` : '—'} />
        <Row label="5. SMC / OSC" value="SMC: RCC duty officer" />
        <Row label="6. Communications" value="VHF-AM 123.1 MHz / VHF-FM CH16" />
        <Row label="7. Reports" value="OSC SITREP every 3 hours" />
      </WorksheetCard>

      {/* Search Evaluation Worksheet (Appendix L-28) */}
      <WorksheetCard title="Search Evaluation" reference="Appendix L-28">
        <Row label="1. Cumulative Relative Effort (Zrc)" value={has(data.Zta) && has(data.E) ? `${(data.Zta! / (data.E! * data.E!)).toFixed(2)}` : '—'} />
        <Row label="2. Optimal Search Factor (fs)" value={has(data.fs) ? `${data.fs!.toFixed(2)}` : '—'} />
        <Row label="3. Coverage Factor (C)" value={has(data.C) ? `${data.C!.toFixed(2)}` : '—'} />
        <Row label="4. POD" value={has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '—'} highlight />
        <Row label="5. POC (before search)" value="100.00%" />
        <Row label="6. POS = POC × POD" value={has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '—'} highlight />
        <Row label="7. POC (after search)" value={has(data.POD) ? `${((1 - data.POD!) * 100).toFixed(1)}%` : '—'} />
        <Row label="8. Cumulative POSc" value={has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '—'} highlight />
      </WorksheetCard>
    </div>
  );
}

function WorksheetCard({ title, reference, children }: {
  title: string;
  reference: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-slate-200 shadow-sm print:shadow-none print:border-slate-300">
      <CardHeader className="bg-slate-50 pb-2 print:bg-white">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold">
            {title}
          </CardTitle>
          <span className="text-[9px] text-slate-500 font-mono">{reference}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={cn(
      'flex items-baseline justify-between gap-2 py-0.5 border-b border-slate-100 last:border-0',
    )}>
      <span className="text-[10px] text-slate-500">{label}</span>
      <span className={cn(
        'text-xs font-mono font-semibold',
        highlight ? 'text-emerald-700' : 'text-slate-700',
      )}>
        {value}
      </span>
    </div>
  );
}
