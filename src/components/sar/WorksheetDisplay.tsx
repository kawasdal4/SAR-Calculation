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
      {/* Worksheet 1: AWA */}
      <WorksheetCard number="1" title="Average Wind Aloft (AWA)" reference="Appendix K-10">
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

      {/* Worksheet 2: ASW */}
      <WorksheetCard number="2" title="Average Surface Wind (ASW)" reference="Appendix K-19">
        <Row label="1. Total Hours" value={data.aswObservations ? `${data.aswObservations.reduce((s, o) => s + o.hours, 0).toFixed(1)} h` : '—'} />
        <Row label="2. ASW Direction" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T` : '—'} highlight />
        <Row label="3. ASW Speed" value={has(data.aswSpeed) ? `${data.aswSpeed!.toFixed(2)} kts` : '—'} highlight />
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

      {/* Worksheet 3: Wind Current */}
      <WorksheetCard number="3" title="Wind Current (WC)" reference="Appendix K-26">
        <Row label="1. ASW" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '—'} />
        <Row label="2. Downwind Direction" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T` : '—'} />
        <Row label="3. WC Drift (3% × ASW)" value={has(data.aswSpeed) ? `${(data.aswSpeed! * 0.03).toFixed(3)} kts` : '—'} />
        <Row label="4. WC Set" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T` : '—'} highlight />
        <Row label="5. WC Drift" value={has(data.aswSpeed) ? `${(data.aswSpeed! * 0.03).toFixed(3)} kts` : '—'} highlight />
        <Row label="6. WC Error (WCe)" value="0.30 kts" />
      </WorksheetCard>

      {/* Worksheet 4: Leeway */}
      <WorksheetCard number="4" title="Leeway (LW)" reference="Appendix K-28">
        <Row label="1. ASW" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '—'} />
        <Row label="2. Downwind Direction" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T` : '—'} />
        <Row label="3. Leeway Speed" value={has(data.lwSpeed) ? `${data.lwSpeed!.toFixed(3)} kts` : '—'} highlight />
        <Row label="4. Leeway Left" value={has(data.lwLeftDir) ? `${data.lwLeftDir!.toFixed(1)}°T` : '—'} highlight />
        <Row label="5. Leeway Right" value={has(data.lwRightDir) ? `${data.lwRightDir!.toFixed(1)}°T` : '—'} highlight />
        <Row label="6. Leeway Error (LWe)" value="0.120 kts" />
      </WorksheetCard>

      {/* Worksheet 5: Total Water Current */}
      <WorksheetCard number="5" title="Total Water Current (TWC)" reference="Appendix K">
        <Row label="1. Sea Current Set" value={has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T` : '—'} />
        <Row label="2. Sea Current Drift" value={has(data.twcSpeed) ? `${data.twcSpeed!.toFixed(3)} kts` : '—'} />
        <Row label="3. Wind Current" value={has(data.aswDirFrom) ? `${((data.aswDirFrom! + 180) % 360).toFixed(1)}°T / ${(data.aswSpeed! * 0.03).toFixed(3)} kts` : '—'} />
        <Row label="4. TWC Set" value={has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T` : '—'} highlight />
        <Row label="5. TWC Drift" value={has(data.twcSpeed) ? `${data.twcSpeed!.toFixed(3)} kts` : '—'} highlight />
        <Row label="6. TWC Error (TWCe)" value="0.424 kts" />
      </WorksheetCard>

      {/* Worksheet 6: Datum */}
      <WorksheetCard number="6" title="Datum Position (Marine)" reference="Appendix K-13">
        <Row label="A. Starting Position (LKP)" value={data.lkp ? `${data.lkp.lat.toFixed(4)}, ${data.lkp.lng.toFixed(4)}` : '—'} />
        <Row label="B. Drift Interval" value="6.00 hours" />
        <Row label="C. ASW" value={has(data.aswDirFrom) ? `${data.aswDirFrom!.toFixed(1)}°T / ${data.aswSpeed?.toFixed(2)} kts` : '—'} />
        <Row label="D. TWC" value={has(data.twcDir) ? `${data.twcDir!.toFixed(1)}°T / ${data.twcSpeed?.toFixed(3)} kts` : '—'} />
        <Row label="E. Leeway Left" value={has(data.lwLeftDir) ? `${data.lwLeftDir!.toFixed(1)}°T / ${data.lwSpeed?.toFixed(3)} kts` : '—'} />
        <Row label="E. Leeway Right" value={has(data.lwRightDir) ? `${data.lwRightDir!.toFixed(1)}°T / ${data.lwSpeed?.toFixed(3)} kts` : '—'} />
        <Row label="F. Drift Distance" value={has(data.driftDistance) ? `${data.driftDistance!.toFixed(2)} NM` : '—'} highlight />
        <Row label="G. Datum Left" value={data.datumLeft ? `${data.datumLeft.lat.toFixed(4)}, ${data.datumLeft.lng.toFixed(4)}` : '—'} highlight />
        <Row label="G. Datum Right" value={data.datumRight ? `${data.datumRight.lat.toFixed(4)}, ${data.datumRight.lng.toFixed(4)}` : '—'} highlight />
        <Row label="G. Divergence Distance (DD)" value={has(data.divergenceDistance) ? `${data.divergenceDistance!.toFixed(2)} NM` : '—'} />
        <Row label="H. DVe" value={has(data.dve) ? `${data.dve!.toFixed(3)} kts` : '—'} />
        <Row label="H. De" value={has(data.De) ? `${data.De!.toFixed(2)} NM` : '—'} />
        <Row label="H. E (Total Probable Error)" value={has(data.E) ? `${data.E!.toFixed(2)} NM` : '—'} highlight />
      </WorksheetCard>

      {/* Worksheet 7: Total Available Search Effort */}
      <WorksheetCard number="7" title="Total Available Search Effort (Zta)" reference="Appendix L-1">
        <Row label="1. Sweep Width (W)" value="3.60 NM" />
        <Row label="2. Search Endurance (T)" value="4.25 h" />
        <Row label="3. Search Speed (V)" value="150 kts" />
        <Row label="4. Search Effort Z = V × T × W" value="2295 NM²" />
        <Row label="5. Total Zta" value={has(data.Zta) ? `${data.Zta!.toFixed(0)} NM²` : '—'} highlight />
      </WorksheetCard>

      {/* Worksheet 8: Effort Allocation */}
      <WorksheetCard number="8" title="Effort Allocation" reference="Appendix L-7">
        <Row label="1. Effort Factor (fZ = E²)" value={has(data.E) ? `${(data.E! * data.E!).toFixed(2)}` : '—'} />
        <Row label="2. Relative Effort (Zr = Zta/fZ)" value={has(data.Zta) && has(data.E) ? `${(data.Zta! / (data.E! * data.E!)).toFixed(2)}` : '—'} />
        <Row label="3. Cumulative Relative Effort (Zrc)" value={has(data.Zta) && has(data.E) ? `${(data.Zta! / (data.E! * data.E!)).toFixed(2)}` : '—'} />
        <Row label="4. Optimal Search Factor (fs)" value={has(data.fs) ? `${data.fs!.toFixed(2)}` : '—'} />
        <Row label="5. Optimal Search Radius (Ro = fs × E)" value={has(data.Ro) ? `${data.Ro!.toFixed(2)} NM` : '—'} highlight />
        <Row label="6. Optimal Search Area (Ao)" value={has(data.Ao) ? `${data.Ao!.toFixed(0)} NM²` : '—'} highlight />
        <Row label="7. Coverage Factor (C = Zta/Ao)" value={has(data.C) ? `${data.C!.toFixed(2)}` : '—'} />
        <Row label="8. POD" value={has(data.POD) ? `${(data.POD! * 100).toFixed(1)}%` : '—'} highlight />
        <Row label="9. Track Spacing (S = W/C)" value={has(data.trackSpacing) ? `${data.trackSpacing!.toFixed(2)} NM` : '—'} />
        <Row label="10. Search Area Dimensions" value={has(data.searchAreaLength) ? `${data.searchAreaLength!.toFixed(1)} × ${data.searchAreaWidth?.toFixed(1)} NM` : '—'} />
      </WorksheetCard>
    </div>
  );
}

function WorksheetCard({ number, title, reference, children }: {
  number: string;
  title: string;
  reference: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-slate-200 shadow-sm print:shadow-none print:border-slate-300">
      <CardHeader className="bg-slate-50 pb-2 print:bg-white">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-semibold">
            <span className="text-blue-600 mr-2">WS{number}</span>
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
