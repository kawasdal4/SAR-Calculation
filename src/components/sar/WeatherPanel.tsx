'use client';

import { useState, useCallback, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Wind, Waves, RefreshCw, Loader2, Download, Cloud } from 'lucide-react';
import { toast } from 'sonner';
import { type LatLng, dirToCompass } from '@/lib/sar/sarCalculations';

interface MarineData {
  windSpeedKts: number;
  windDirFromDeg: number;
  visibilityNm: number;
  waveHeightM: number;
  waveDirectionDeg: number;
  wavePeriodS: number;
  swellHeightM: number;
  /** Ocean surface current velocity (m/s). */
  oceanCurrentMs: number;
  /** Ocean surface current direction (°T, toward which current flows). */
  oceanCurrentDirDeg: number;
  /** Sea surface temperature (°C). */
  sstC: number;
  fetchTime: string;
  hourly: Array<{
    time: string;
    windSpeedKts: number;
    windDirFromDeg: number;
    waveHeightM: number;
    waveDirDeg: number;
  }>;
}

interface WeatherPanelProps {
  lkp: LatLng;
  driftIntervalHours: number;
  /** Called when user clicks "Apply to ASW worksheet". */
  onApplyAsw?: (windDirFrom: number, windSpeedKts: number) => void;
  /** Called when user clicks "Apply visibility to Search worksheet". */
  onApplyVisibility?: (visibilityNm: number) => void;
  /** Called when user clicks "Apply sea current to Datum worksheet". */
  onApplySeaCurrent?: (setDeg: number, driftKts: number) => void;
}

export default function WeatherPanel({ lkp, driftIntervalHours, onApplyAsw, onApplyVisibility, onApplySeaCurrent }: WeatherPanelProps) {
  const [data, setData] = useState<MarineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = useCallback(
    async (lat: number, lng: number) => {
      setLoading(true);
      setError(null);
      try {
        // 1) Wind + visibility from Open-Meteo forecast API (no API key required)
        const windUrl =
          `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
          `&hourly=wind_speed_10m,wind_direction_10m,visibility&wind_speed_unit=kn&timezone=UTC&forecast_days=2`;
        // 2) Wave data + ocean current + SST from Open-Meteo marine API (no API key required)
        //    Note: marine variables live on the marine-api subdomain, not api.open-meteo.com
        const marineUrl =
          `https://marine-api.open-meteo.com/v1/marine?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
          `&hourly=wave_height,wave_direction,wave_period,swell_wave_height,ocean_current_velocity,ocean_current_direction,sea_surface_temperature&timezone=UTC&forecast_days=2`;

        const [windRes, marineRes] = await Promise.all([
          fetch(windUrl),
          fetch(marineUrl),
        ]);

        if (!windRes.ok) throw new Error(`Wind API HTTP ${windRes.status}`);
        if (!marineRes.ok) throw new Error(`Marine API HTTP ${marineRes.status}`);

        const windJson = await windRes.json();
        const marineJson = await marineRes.json();

        const windSpeeds: (number | null)[] = windJson.hourly?.wind_speed_10m ?? [];
        const windDirs: (number | null)[] = windJson.hourly?.wind_direction_10m ?? [];
        const visibilities: (number | null)[] = windJson.hourly?.visibility ?? [];
        const waveHeights: (number | null)[] = marineJson.hourly?.wave_height ?? [];
        const waveDirs: (number | null)[] = marineJson.hourly?.wave_direction ?? [];
        const wavePeriods: (number | null)[] = marineJson.hourly?.wave_period ?? [];
        const swellHeights: (number | null)[] = marineJson.hourly?.swell_wave_height ?? [];
        const oceanCurrents: (number | null)[] = marineJson.hourly?.ocean_current_velocity ?? [];
        const oceanCurrentDirs: (number | null)[] = marineJson.hourly?.ocean_current_direction ?? [];
        const ssts: (number | null)[] = marineJson.hourly?.sea_surface_temperature ?? [];
        const times: string[] = windJson.hourly?.time ?? [];

        if (times.length === 0) throw new Error('No hourly data returned');

        // Average the wind over the drift interval (in hours) starting from "now"
        const now = new Date();
        const startIdx = times.findIndex((t) => new Date(t + 'Z') >= now);
        const fromIdx = startIdx >= 0 ? startIdx : 0;
        const endIdx = Math.min(times.length - 1, fromIdx + Math.max(1, Math.ceil(driftIntervalHours)));

        // Vector-average the wind (downwind = wind direction + 180)
        let u = 0;
        let v = 0;
        let countWind = 0;
        let visSum = 0;
        let visCount = 0;
        for (let i = fromIdx; i <= endIdx; i++) {
          const ws = windSpeeds[i];
          const wd = windDirs[i];
          if (typeof ws === 'number' && typeof wd === 'number' && ws >= 0) {
            const rad = ((wd + 180) * Math.PI) / 180; // downwind vector
            u += ws * Math.sin(rad);
            v += ws * Math.cos(rad);
            countWind++;
          }
          const vis = visibilities[i];
          if (typeof vis === 'number' && vis >= 0) {
            // Open-Meteo returns visibility in meters; convert to NM
            visSum += vis / 1852;
            visCount++;
          }
        }
        // avgWindDirFrom: the wind direction FROM which the average wind blows.
        // We vector-averaged the DOWNWIND vector (dir + 180). So downwind direction
        // = atan2(u, v). The "from" direction = downwind - 180.
        const downwindDirRad = Math.atan2(u, v);
        const downwindDirDeg = ((downwindDirRad * 180) / Math.PI + 360) % 360;
        const avgWindDirFrom = countWind > 0 ? (downwindDirDeg + 180) % 360 : 0;
        const avgWindSpeed = countWind > 0
          ? Math.sqrt(u * u + v * v) / countWind
          : 0;
        const avgVisibility = visCount > 0 ? visSum / visCount : 10;

        // Average wave data over the drift interval
        let waveSum = 0, waveCount = 0;
        let waveDirSum = 0, waveDirCount = 0;
        let wavePeriodSum = 0, wavePeriodCount = 0;
        let swellSum = 0, swellCount = 0;
        // Ocean current — vector average (set = direction TOWARD which current flows)
        let ocU = 0, ocV = 0, ocCount = 0;
        let sstSum = 0, sstCount = 0;
        for (let i = fromIdx; i <= endIdx; i++) {
          const wh = waveHeights[i];
          const wd = waveDirs[i];
          const wp = wavePeriods[i];
          const sh = swellHeights[i];
          const oc = oceanCurrents[i];
          const ocD = oceanCurrentDirs[i];
          const sst = ssts[i];
          if (typeof wh === 'number') { waveSum += wh; waveCount++; }
          if (typeof wd === 'number') { waveDirSum += wd; waveDirCount++; }
          if (typeof wp === 'number') { wavePeriodSum += wp; wavePeriodCount++; }
          if (typeof sh === 'number') { swellSum += sh; swellCount++; }
          if (typeof oc === 'number' && typeof ocD === 'number') {
            const rad = (ocD * Math.PI) / 180;
            // API returns km/h; convert to m/s for internal storage (1 km/h = 0.277778 m/s)
            const ocMs = oc * 0.277778;
            ocU += ocMs * Math.sin(rad);
            ocV += ocMs * Math.cos(rad);
            ocCount++;
          }
          if (typeof sst === 'number') { sstSum += sst; sstCount++; }
        }
        const avgWaveH = waveCount > 0 ? waveSum / waveCount : 0;
        const avgWaveDir = waveDirCount > 0 ? waveDirSum / waveDirCount : 0;
        const avgWavePeriod = wavePeriodCount > 0 ? wavePeriodSum / wavePeriodCount : 0;
        const avgSwellH = swellCount > 0 ? swellSum / swellCount : 0;
        const ocMag = ocCount > 0 ? Math.sqrt(ocU * ocU + ocV * ocV) / ocCount : 0;
        const ocDir = ocCount > 0 ? (Math.atan2(ocU, ocV) * 180) / Math.PI : 0;
        const ocDirNorm = (ocDir + 360) % 360;
        const avgSst = sstCount > 0 ? sstSum / sstCount : 0;
        // Convert m/s to knots (1 m/s ≈ 1.94384 kts)
        const ocMagKts = ocMag * 1.94384;

        // Build hourly summary (next 12 hours)
        const hourly: MarineData['hourly'] = [];
        for (let i = fromIdx; i < Math.min(times.length, fromIdx + 12); i++) {
          hourly.push({
            time: times[i],
            windSpeedKts: typeof windSpeeds[i] === 'number' ? windSpeeds[i] as number : 0,
            windDirFromDeg: typeof windDirs[i] === 'number' ? windDirs[i] as number : 0,
            waveHeightM: typeof waveHeights[i] === 'number' ? waveHeights[i] as number : 0,
            waveDirDeg: typeof waveDirs[i] === 'number' ? waveDirs[i] as number : 0,
          });
        }

        setData({
          windSpeedKts: avgWindSpeed,
          windDirFromDeg: avgWindDirFrom,
          visibilityNm: avgVisibility,
          waveHeightM: avgWaveH,
          waveDirectionDeg: avgWaveDir,
          wavePeriodS: avgWavePeriod,
          swellHeightM: avgSwellH,
          oceanCurrentMs: ocMag,
          oceanCurrentDirDeg: ocDirNorm,
          sstC: avgSst,
          fetchTime: now.toISOString(),
          hourly,
        });
        toast.success(`Fetched live weather at ${lat.toFixed(3)}, ${lng.toFixed(3)}`);
      } catch (e) {
        const msg = (e as Error).message;
        setError(msg);
        toast.error('Weather fetch failed', { description: msg });
      } finally {
        setLoading(false);
      }
    },
    [driftIntervalHours],
  );

  // Auto-fetch on first mount and whenever LKP changes significantly
  useEffect(() => {
    void fetchWeather(lkp.lat, lkp.lng);
     
  }, [lkp.lat, lkp.lng]);

  const handleApplyAsw = () => {
    if (!data) return;
    onApplyAsw?.(data.windDirFromDeg, data.windSpeedKts);
    toast.success(
      `Applied to ASW worksheet: ${data.windDirFromDeg.toFixed(0)}°T / ${data.windSpeedKts.toFixed(1)} kts`,
    );
  };

  const handleApplyVisibility = () => {
    if (!data) return;
    onApplyVisibility?.(data.visibilityNm);
    toast.success(`Applied visibility ${data.visibilityNm.toFixed(1)} NM to Search worksheet`);
  };

  const handleApplySeaCurrent = () => {
    if (!data) return;
    const driftKts = data.oceanCurrentMs * 1.94384; // m/s → kts
    onApplySeaCurrent?.(data.oceanCurrentDirDeg, driftKts);
    toast.success(
      `Applied sea current ${data.oceanCurrentDirDeg.toFixed(0)}°T / ${driftKts.toFixed(2)} kts to Datum worksheet`,
    );
  };

  return (
    <Card className="border-sky-200 shadow-sm">
      <CardHeader className="bg-sky-50 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Cloud className="h-4 w-4 text-sky-600" /> Live Weather at LKP
            </CardTitle>
            <CardDescription className="text-xs">
              Open-Meteo forecast • wind + waves averaged over {driftIntervalHours}h drift interval
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchWeather(lkp.lat, lkp.lng)}
            disabled={loading}
            className="h-7 text-xs"
          >
            {loading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-3">
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 mb-3">
            {error}
          </div>
        )}
        {data ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Stat
                icon={<Wind className="h-3 w-3 text-sky-600" />}
                label="Avg Wind"
                value={`${data.windDirFromDeg.toFixed(0)}°T (${dirToCompass(data.windDirFromDeg)}) / ${data.windSpeedKts.toFixed(1)} kts`}
                accent
              />
              <Stat
                icon={<Cloud className="h-3 w-3 text-sky-600" />}
                label="Visibility"
                value={`${data.visibilityNm.toFixed(1)} NM`}
              />
              <Stat
                icon={<Waves className="h-3 w-3 text-sky-600" />}
                label="Wave Height"
                value={`${data.waveHeightM.toFixed(2)} m`}
              />
              <Stat
                icon={<Waves className="h-3 w-3 text-sky-600" />}
                label="Wave Dir/Period"
                value={`${data.waveDirectionDeg.toFixed(0)}°T / ${data.wavePeriodS.toFixed(1)} s`}
              />
              <Stat
                icon={<Waves className="h-3 w-3 text-cyan-600" />}
                label="Ocean Current"
                value={`${data.oceanCurrentDirDeg.toFixed(0)}°T / ${(data.oceanCurrentMs * 1.94384).toFixed(2)} kts`}
                accent
              />
              <Stat
                icon={<Cloud className="h-3 w-3 text-amber-600" />}
                label="Sea Surface Temp"
                value={`${data.sstC.toFixed(1)} °C`}
              />
            </div>
            <div className="text-[10px] text-slate-500">
              Fetched: {new Date(data.fetchTime).toLocaleTimeString()} • Source: Open-Meteo (no API key)
            </div>
            <div className="flex flex-wrap gap-2">
              {onApplyAsw && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleApplyAsw}
                  className="h-7 text-xs"
                >
                  <Download className="h-3 w-3 mr-1" /> Apply to ASW
                </Button>
              )}
              {onApplyVisibility && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleApplyVisibility}
                  className="h-7 text-xs"
                >
                  <Download className="h-3 w-3 mr-1" /> Apply Visibility
                </Button>
              )}
              {onApplySeaCurrent && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleApplySeaCurrent}
                  className="h-7 text-xs"
                >
                  <Download className="h-3 w-3 mr-1" /> Apply Sea Current
                </Button>
              )}
            </div>
          </div>
        ) : (
          !error && (
            <div className="text-xs text-slate-500 flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Fetching weather data…
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`p-2.5 rounded-md border ${
        accent ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'
      }`}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 mb-1">
        {icon}
        {label}
      </div>
      <div className={`text-xs font-mono font-semibold ${accent ? 'text-emerald-700' : 'text-slate-800'}`}>
        {value}
      </div>
    </div>
  );
}
