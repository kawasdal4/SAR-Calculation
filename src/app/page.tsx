'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Ship, Wind, Map as MapIcon, Compass, Calculator, FileText } from 'lucide-react';
import AWAWorksheet, {
  type AWAData,
  type AWAInitialState,
} from '@/components/sar/AWAWorksheet';
import ASWWorksheet, {
  type ASWData,
  type ASWInitialState,
} from '@/components/sar/ASWWorksheet';
import { type AWAObservation } from '@/lib/sar/sarCalculations';
import { type ASWObservation } from '@/lib/sar/sarCalculations';
import DatumWorksheet, {
  type DatumData,
  type DatumResults,
  type DatumInitialState,
} from '@/components/sar/DatumWorksheet';
import SearchPlanWorksheet, {
  type SearchPlanResults,
  type SearchPlanInitialState,
} from '@/components/sar/SearchPlanWorksheet';
import CaseManager from '@/components/sar/CaseManager';
import ExportButtons from '@/components/sar/ExportButtons';
import { PodChart, PoscChart, PointDatumProbMap } from '@/components/sar/PodCharts';
import { LeewayChart } from '@/components/sar/LeewayChart';
import CompareScenarios from '@/components/sar/CompareScenarios';
import WeatherPanel from '@/components/sar/WeatherPanel';
import { buildSearchActionPlanData } from '@/lib/sar/searchActionPlan';
import {
  type LatLng,
  type Vector,
  project,
  rectangleCorners,
  distanceNm,
  dirToCompass,
} from '@/lib/sar/sarCalculations';
import type { MapMarker, MapLine, MapPolygon, MapCircle } from '@/components/sar/SeaMap';

// Leaflet must be loaded only in the browser
const SeaMap = dynamic(() => import('@/components/sar/SeaMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] w-full bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
      Loading sea chart...
    </div>
  ),
});

const DEFAULT_CENTER: LatLng = { lat: -6.1, lng: 106.8 }; // Jakarta area

export default function Home() {
  // AWA result feeds into aeronautical drift (currently shown as reference; not directly used in marine datum)
  const [awa, setAwa] = useState<AWAData>({ aswDirFrom: 0, aswSpeed: 0 });
  const [asw, setAsw] = useState<ASWData>({
    aswDirFrom: 90,
    aswSpeed: 18,
    aswErr: 2.0,
    aswdve: 0.1,
  });
  const [datumData, setDatumData] = useState<DatumData | null>(null);
  const [datumResults, setDatumResults] = useState<DatumResults | null>(null);
  const [searchResults, setSearchResults] = useState<SearchPlanResults | null>(null);

  // Controlled LKP — set by Datum worksheet inputs OR by clicking on the map
  // Default: Laut Jawa bagian barat (off Jakarta/Kepulauan Seribu) — falls inside BMKG coverage
  const [lkp, setLkp] = useState<LatLng>({ lat: -5.8, lng: 106.9 });
  const [pickMode, setPickMode] = useState<boolean>(false);
  const [measureMode, setMeasureMode] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('awa');

  // Raw state snapshots — captured by parent from each worksheet for save/load
  const [awaObservations, setAwaObservations] = useState<AWAObservation[]>([]);
  const [aswState, setAswState] = useState<{ observations: ASWObservation[]; aswErr: number }>({
    observations: [],
    aswErr: 2.0,
  });
  const [datumState, setDatumState] = useState<DatumInitialState | null>(null);
  const [searchState, setSearchState] = useState<SearchPlanInitialState | null>(null);

  // Initial state used to rehydrate child components after loading a case.
  // Bumping `caseVersion` forces React to remount child worksheets (via `key`)
  // so they read the new initialState fresh from useState initializers.
  const [loadedInitialState, setLoadedInitialState] = useState<{
    awa?: AWAInitialState;
    asw?: ASWInitialState;
    datum?: DatumInitialState;
    search?: SearchPlanInitialState;
    lkp?: LatLng;
  } | null>(null);
  const [caseVersion, setCaseVersion] = useState<number>(0);

  // Override signals from WeatherPanel → pushed down to worksheets
  const [windOverride, setWindOverride] = useState<{ dirFrom: number; speed: number; hours: number; ts: number } | null>(null);
  const [seaCurrentOverride, setSeaCurrentOverride] = useState<{ dir: number; speed: number; ts: number } | null>(null);
  const [visibilityOverride, setVisibilityOverride] = useState<{ nm: number; ts: number } | null>(null);
  const [driftIntervalForWeather, setDriftIntervalForWeather] = useState<number>(6);

  /** Build the full state payload to persist to the database. */
  const buildState = useCallback(() => {
    return {
      title: '',
      state: {
        awa: { observations: awaObservations },
        asw: { observations: aswState.observations, aswErr: aswState.aswErr },
        datum: datumState ?? {},
        search: searchState ?? {},
        lkp,
      },
    };
  }, [awaObservations, aswState, datumState, searchState, lkp]);

  /** Apply a loaded state back to the worksheets by rehydrating initialState + bumping key. */
  const applyState = useCallback(
    (state: Record<string, unknown>) => {
      const awa = (state.awa ?? {}) as AWAInitialState;
      const asw = (state.asw ?? {}) as ASWInitialState;
      const datum = (state.datum ?? {}) as DatumInitialState;
      const search = (state.search ?? {}) as SearchPlanInitialState;
      const lkpLoaded = state.lkp as LatLng | undefined;
      setLoadedInitialState({ awa, asw, datum, search, lkp: lkpLoaded });
      if (lkpLoaded) setLkp(lkpLoaded);
      setCaseVersion((v) => v + 1);
    },
    [],
  );

  // Keep driftIntervalForWeather synced with Datum worksheet state (for WeatherPanel averaging window)
  useEffect(() => {
    if (datumState?.driftInterval) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDriftIntervalForWeather(datumState.driftInterval);
    }
  }, [datumState?.driftInterval]);

  // Map view center — defaults to LKP; updates when datum computed
  const mapCenter: LatLng = useMemo(() => {
    if (datumData && datumResults) {
      return {
        lat: (datumData.start.lat + datumResults.datumLeft.lat + datumResults.datumRight.lat) / 3,
        lng: (datumData.start.lng + datumResults.datumLeft.lng + datumResults.datumRight.lng) / 3,
      };
    }
    return lkp;
  }, [datumData, datumResults, lkp]);

  // Click on map → set LKP (only when in pick mode)
  const handleMapClick = useCallback(
    (latlng: LatLng) => {
      if (pickMode) {
        setLkp(latlng);
        setPickMode(false);
      }
    },
    [pickMode],
  );

  // Build map markers from datum + start
  const markers: MapMarker[] = useMemo(() => {
    if (!datumData) {
      return [
        {
          position: DEFAULT_CENTER,
          label: 'Default location (set LKP)',
          color: '#94a3b8',
          isStart: true,
        },
      ];
    }
    const list: MapMarker[] = [
      {
        position: datumData.start,
        label: 'LKP — Last Known Position',
        color: '#0ea5e9',
        isStart: true,
      },
    ];
    if (datumResults) {
      list.push({
        position: datumResults.datumLeft,
        label: 'Datum (Left of Downwind)',
        color: '#dc2626',
        isDatum: true,
      });
      list.push({
        position: datumResults.datumRight,
        label: 'Datum (Right of Downwind)',
        color: '#dc2626',
        isDatum: true,
      });
    }
    return list;
  }, [datumData, datumResults]);

  // Drift arrows
  const lines: MapLine[] = useMemo(() => {
    if (!datumData || !datumResults) return [];
    return [
      {
        from: datumData.start,
        to: datumResults.datumLeft,
        color: '#f59e0b',
        label: `Drift L: ${datumResults.driftDistance.toFixed(1)} NM`,
      },
      {
        from: datumData.start,
        to: datumResults.datumRight,
        color: '#f59e0b',
        label: `Drift R: ${datumResults.driftDistance.toFixed(1)} NM`,
      },
    ];
  }, [datumData, datumResults]);

  // Total water current + wind arrows (info overlays)
  const envLines: MapLine[] = useMemo(() => {
    if (!datumData) return [];
    const lines: MapLine[] = [];
    // TWC vector — scale up for visibility (10 NM per kt)
    const twcEnd = project(
      datumData.start,
      datumData.twc.dir,
      Math.max(1, datumData.twc.mag * 10),
    );
    lines.push({
      from: datumData.start,
      to: twcEnd,
      color: '#3b82f6',
      label: `TWC ${datumData.twc.dir.toFixed(0)}°T/${datumData.twc.mag.toFixed(2)}kt`,
      dashed: true,
    });
    return lines;
  }, [datumData]);

  // Probable error circle(s) around each datum
  const circles: MapCircle[] = useMemo(() => {
    if (!datumResults) return [];
    const list: MapCircle[] = [];
    list.push({
      center: datumResults.datumLeft,
      radiusNm: datumResults.E,
      color: '#dc2626',
      fillColor: '#dc2626',
      fillOpacity: 0.05,
      label: `E = ${datumResults.E.toFixed(1)} NM`,
    });
    if (
      distanceNm(datumResults.datumLeft, datumResults.datumRight) > 0.001
    ) {
      list.push({
        center: datumResults.datumRight,
        radiusNm: datumResults.E,
        color: '#dc2626',
        fillColor: '#dc2626',
        fillOpacity: 0.05,
      });
    }
    return list;
  }, [datumResults]);

  // Search area polygon
  const polygons: MapPolygon[] = useMemo(() => {
    if (!searchResults || !searchResults.searchAreaLength) return [];
    const corners = rectangleCorners(
      searchResults.searchAreaCenter,
      searchResults.searchAreaLength,
      searchResults.searchAreaWidth,
      searchResults.orientationDeg,
    );
    return [
      {
        points: corners,
        color: '#16a34a',
        fillColor: '#16a34a',
        fillOpacity: 0.12,
        label: `Search Area\n${searchResults.searchAreaLength.toFixed(1)}×${searchResults.searchAreaWidth.toFixed(1)} NM\nPOD=${(searchResults.POD * 100).toFixed(0)}%`,
      },
    ];
  }, [searchResults]);

  const mapZoom = 8;

  // Build the Search Action Plan payload (Appendix L-23) from the current state.
  const searchActionPlanData = useMemo(() => {
    if (!datumResults || !searchResults || !datumData) return null;
    return buildSearchActionPlanData({
      caseTitle: 'SAR Search Action Plan',
      lkp,
      datumLeft: datumResults.datumLeft,
      datumRight: datumResults.datumRight,
      driftDistanceNm: datumResults.driftDistance,
      divergenceDistanceNm: datumResults.divergenceDistance,
      E_nm: datumResults.E,
      Zta_nm2: searchResults.Zta,
      Ro_nm: searchResults.Ro,
      Ao_nm2: searchResults.Ao,
      coverageFactor: searchResults.C,
      POD_pct: searchResults.POD * 100,
      trackSpacing_nm: searchResults.trackSpacing,
      searchAreaLength_nm: searchResults.searchAreaLength,
      searchAreaWidth_nm: searchResults.searchAreaWidth,
      searchAreaCenter: searchResults.searchAreaCenter,
      searchAreaOrientationDeg: searchResults.orientationDeg,
      aswDirFrom: asw.aswDirFrom,
      aswSpeedKts: asw.aswSpeed,
      awaDirFrom: awa.aswDirFrom,
      awaSpeedKts: awa.aswSpeed,
      twcDir: datumResults.twc.twc.dir,
      twcSpeed: datumResults.twc.twc.mag,
      lwLeftDir: datumResults.lw.lwLeftDir,
      lwRightDir: datumResults.lw.lwRightDir,
      lwSpeed: datumResults.lw.leewaySpeed,
      facilities: searchState?.facilities?.map((f) => ({ name: f.name, speed: f.speed })) ?? [
        { name: 'SAR Aircraft #1', speed: 150 },
      ],
    });
  }, [datumResults, searchResults, datumData, lkp, asw, awa, searchState]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:py-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-emerald-500 flex items-center justify-center">
                <Compass className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                  IAMSAR Mission Co-ordinator Workbench
                </h1>
                <p className="text-xs text-slate-300">
                  Search and Rescue worksheet calculator with online sea chart — based on IAMSAR Manual Volume II (2016)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <CaseManager buildState={buildState} applyState={applyState} />
              <ExportButtons data={searchActionPlanData} caseTitle="SAR_Search_Action_Plan" />
              <Badge variant="secondary" className="bg-slate-800 text-slate-200 border-slate-700">
                Volume II
              </Badge>
              <Badge variant="secondary" className="bg-emerald-700 text-emerald-100 border-emerald-600">
                Appendix K & L
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: worksheets */}
        <section className="lg:col-span-3 space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid grid-cols-2 sm:grid-cols-4 mb-4 bg-slate-100">
              <TabsTrigger value="awa" className="text-xs sm:text-sm">
                <Wind className="h-4 w-4 mr-1.5" /> AWA
              </TabsTrigger>
              <TabsTrigger value="asw" className="text-xs sm:text-sm">
                <Wind className="h-4 w-4 mr-1.5" /> ASW
              </TabsTrigger>
              <TabsTrigger value="datum" className="text-xs sm:text-sm">
                <Ship className="h-4 w-4 mr-1.5" /> Datum
              </TabsTrigger>
              <TabsTrigger value="search" className="text-xs sm:text-sm">
                <Calculator className="h-4 w-4 mr-1.5" /> Search
              </TabsTrigger>
            </TabsList>

            <TabsContent value="awa" className="mt-0">
              <AWAWorksheet
                key={`awa-${caseVersion}`}
                onDataChange={setAwa}
                onObservationsChange={setAwaObservations}
                initialState={loadedInitialState?.awa}
              />
              <ReferenceCard
                title="Average Wind Aloft (AWA)"
                description="Appendix K-10"
                formula="AWA = Σ(Wind × ΔAltitude) / Σ(ΔAltitude)"
                notes={[
                  'Setiap observasi angin diberi bobot oleh interval ketinggian (ribuan kaki).',
                  'Vektor kontribusi = wind speed × Δaltitude (kft), arah = downwind.',
                  'Total altitude loss harus sama dengan keturunan ketinggian dari B.3 atau C.6 di Aeronautical drift worksheet.',
                  'Output: AWA direction (°T, from) dan AWA speed (kts) — dipakai di Aeronautical drift worksheet.',
                ]}
              />
            </TabsContent>

            <TabsContent value="asw" className="mt-0">
              <ASWWorksheet
                key={`asw-${caseVersion}`}
                onDataChange={setAsw}
                onStateChange={setAswState}
                windOverride={windOverride}
                initialState={loadedInitialState?.asw}
              />
              <ReferenceCard
                title="Average Surface Wind (ASW)"
                description="Appendix K-19"
                formula="ASW = Σ(Wind × Hours) / Σ(Hours)"
                notes={[
                  'Bobot observasi = jumlah jam berlaku.',
                  'ASWDVe ≈ ASWe × sensitivitas drift (0.05) — faktor turunan wind current + leeway.',
                  'Output: ASW direction (°T, from) dan ASW speed (kts) — dipakai di Datum worksheet bagian C.',
                ]}
              />
            </TabsContent>

            <TabsContent value="datum" className="mt-0">
              <DatumWorksheet
                aswDirFrom={asw.aswDirFrom}
                aswSpeed={asw.aswSpeed}
                aswErr={asw.aswErr}
                aswdve={asw.aswdve}
                startLat={lkp.lat}
                startLng={lkp.lng}
                onLKPChange={(lat, lng) => setLkp({ lat, lng })}
                onRequestMapPick={() => {
                  setPickMode(true);
                  setActiveTab('datum');
                }}
                pickMode={pickMode}
                seaCurrentOverride={seaCurrentOverride}
                onResults={setDatumResults}
                onDataChange={setDatumData}
                onStateChange={setDatumState}
                initialState={loadedInitialState?.datum}
                key={`datum-${caseVersion}`}
              />
              <ReferenceCard
                title="Datum Worksheet (Marine)"
                description="Appendix K-13"
                formula="Datum = Start + (TWC + Leeway) × drift_interval"
                notes={[
                  'DVe = √(ASWDVe² + TWCe² + LWe²) — total probable drift velocity error.',
                  'De = DVe × drift_interval — total probable drift error.',
                  'E = √(X² + De² + Y²) — total probable error of position.',
                  'SR (Separation Ratio) = DD / E. Jika SR > 4, gunakan dua datum terpisah.',
                ]}
              />
              {datumResults && (
                <div className="mt-4">
                  <LeewayChart
                    currentWindSpeed={asw.aswSpeed}
                    selectedObjectId={datumResults.lw.objectType.id}
                    currentLeewaySpeed={datumResults.lw.leewaySpeed}
                  />
                </div>
              )}
            </TabsContent>

            <TabsContent value="search" className="mt-0">
              {datumResults ? (
                <>
                  <SearchPlanWorksheet
                    E={datumResults.E}
                    datumLeft={datumResults.datumLeft}
                    datumRight={datumResults.datumRight}
                    divergenceDistance={datumResults.divergenceDistance}
                    driftLeftDir={datumResults ? datumData?.aswDirFrom ?? 0 : 0}
                    aswDirFrom={asw.aswDirFrom}
                    onResults={setSearchResults}
                    onStateChange={setSearchState}
                    visibilityOverride={visibilityOverride}
                    initialState={loadedInitialState?.search}
                    key={`search-${caseVersion}`}
                  />
                  <ReferenceCard
                    title="Effort Allocation Worksheet"
                    description="Appendix L-7"
                    formula="Ro = fs × E   |   Ao = 4×Ro² (point) atau (2Ro+DD)×2Ro (divergence)"
                    notes={[
                      'Zr = Zta / fZ — relative effort.',
                      'Zrc = Σ previous Zr + current Zr — cumulative relative effort (figures N-5..N-8 lookup).',
                      'fs = optimal search factor (dari kurva).',
                      'C = Zta / Ao — coverage factor. POD dari figure N-10.',
                      'Track spacing S = W / C. Search legs harus sejajar arah drift.',
                    ]}
                  />
                  {searchResults && datumResults && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                      <PodChart
                        currentCoverage={searchResults.C}
                        currentPod={searchResults.POD}
                        conditions={searchState?.conditions ?? 'normal'}
                      />
                      <PoscChart
                        currentZrc={searchResults.Zrc}
                        datumType={searchState?.datumType ?? 'leeway-divergence'}
                      />
                    </div>
                  )}
                  {datumResults && (
                    <div className="mt-4">
                      <PointDatumProbMap E_nm={datumResults.E} />
                    </div>
                  )}
                  <div className="mt-4">
                    <CompareScenarios
                      baseLkp={lkp}
                      baseAswDirFrom={asw.aswDirFrom}
                      baseAswSpeed={asw.aswSpeed}
                    />
                  </div>
                </>
              ) : (
                <Card className="border-amber-200 bg-amber-50">
                  <CardContent className="pt-6 pb-6 text-center">
                    <p className="text-sm text-amber-800">
                      Complete the Datum worksheet first to compute total probable error (E).
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </section>

        {/* Right: live sea map + results summary */}
        <aside className="lg:col-span-2 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <WeatherPanel
            lkp={lkp}
            driftIntervalHours={driftIntervalForWeather}
            onApplyAsw={(dirFrom, speed) =>
              setWindOverride({ dirFrom, speed, hours: driftIntervalForWeather, ts: Date.now() })
            }
            onApplyVisibility={(nm) =>
              setVisibilityOverride({ nm, ts: Date.now() })
            }
            onApplySeaCurrent={(dir, speed) =>
              setSeaCurrentOverride({ dir, speed, ts: Date.now() })
            }
          />
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="bg-slate-50 pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapIcon className="h-4 w-4 text-slate-600" /> Live Sea Chart
                </CardTitle>
                <span className="text-[10px] text-slate-500 font-mono">
                  OSM + OpenSeaMap + GEBCO
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {pickMode && (
                <div className="px-3 py-2 bg-emerald-600 text-white text-xs font-medium flex items-center justify-between">
                  <span>◉ Pick mode active — click anywhere on the chart to set the LKP</span>
                  <button
                    type="button"
                    onClick={() => setPickMode(false)}
                    className="text-emerald-100 hover:text-white underline"
                  >
                    Cancel
                  </button>
                </div>
              )}
              <div className={pickMode ? 'ring-2 ring-emerald-500 ring-inset' : ''}>
                <SeaMap
                  center={mapCenter}
                  zoom={mapZoom}
                  markers={markers}
                  lines={[...lines, ...envLines]}
                  polygons={polygons}
                  circles={circles}
                  height="460px"
                  onMapClick={handleMapClick}
                  pickMode={pickMode}
                  measureMode={measureMode}
                />
              </div>
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-600 flex flex-wrap items-center gap-2 justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">Legend:</span>{' '}
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" /> LKP
                  </span>{' '}
                  ·{' '}
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" /> Datum
                  </span>{' '}
                  ·{' '}
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 bg-amber-500 inline-block" /> Drift
                  </span>{' '}
                  ·{' '}
                  <span className="inline-flex items-center gap-1">
                    <span className="w-2.5 h-2.5 bg-emerald-600 inline-block" /> Search area
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMeasureMode(!measureMode)}
                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    measureMode
                      ? 'bg-red-600 text-white border-red-600'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                  }`}
                  title="Klik untuk mulai mengukur jarak. Klik ganda untuk reset."
                >
                  {measureMode ? '◉ Measure: ON (double-click to reset)' : '📏 Measure distance'}
                </button>
              </div>
              <div className="px-3 py-2 bg-amber-50 border-t border-amber-200 text-[10px] text-amber-800">
                ⚠ <strong>Bukan untuk navigasi pelayaran</strong>; akurasi tidak dijamin. Sumber data: OpenStreetMap, OpenSeaMap, GEBCO (batimetri &amp; kedalaman titik). Aktifkan layer "GEBCO bathymetry" dari panel Layers di kanan atas peta untuk melihat batimetetri berwarna. Klik peta (di luar mode Pick LKP) untuk menampilkan kedalaman titik.
              </div>
            </CardContent>
          </Card>

          {/* Summary panel */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="bg-slate-50 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-600" /> Mission Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 grid grid-cols-2 gap-2 text-xs">
              <SummaryItem label="ASW" value={asw.aswSpeed > 0 ? `${asw.aswDirFrom.toFixed(0)}°T / ${asw.aswSpeed.toFixed(1)} kt` : '—'} />
              <SummaryItem label="AWA (ref)" value={awa.aswSpeed > 0 ? `${awa.aswDirFrom.toFixed(0)}°T / ${awa.aswSpeed.toFixed(1)} kt` : '—'} />
              <SummaryItem
                label="Datum (left)"
                value={datumResults ? `${datumResults.datumLeft.lat.toFixed(3)}, ${datumResults.datumLeft.lng.toFixed(3)}` : '—'}
              />
              <SummaryItem
                label="Datum (right)"
                value={datumResults ? `${datumResults.datumRight.lat.toFixed(3)}, ${datumResults.datumRight.lng.toFixed(3)}` : '—'}
              />
              <SummaryItem label="Drift Dist" value={datumResults ? `${datumResults.driftDistance.toFixed(2)} NM` : '—'} />
              <SummaryItem label="DD (divergence)" value={datumResults ? `${datumResults.divergenceDistance.toFixed(2)} NM` : '—'} />
              <SummaryItem label="E (prob. error)" value={datumResults ? `${datumResults.E.toFixed(2)} NM` : '—'} />
              <SummaryItem label="Zta" value={searchResults ? `${searchResults.Zta.toFixed(0)} NM²` : '—'} />
              <SummaryItem label="Ro (radius)" value={searchResults ? `${searchResults.Ro.toFixed(2)} NM` : '—'} />
              <SummaryItem label="Coverage C" value={searchResults ? searchResults.C.toFixed(2) : '—'} />
              <SummaryItem label="POD" value={searchResults ? `${(searchResults.POD * 100).toFixed(1)}%` : '—'} accent />
              <SummaryItem label="Search Area" value={searchResults ? `${searchResults.searchAreaLength.toFixed(1)}×${searchResults.searchAreaWidth.toFixed(1)} NM` : '—'} accent />
            </CardContent>
          </Card>
        </aside>
      </main>

      <footer className="mt-auto bg-slate-900 text-slate-400 text-xs">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <p>
            Implementasi worksheet IAMSAR Manual Volume II (2016) — Appendix K (Determining Datum) & Appendix L (Search Planning).{' '}
            <span className="text-slate-300">
              Wind/current models, sweep-width tables, dan fs lookup graphs menggunakan pendekatan numerik sesuai manual.
            </span>
          </p>
        </div>
      </footer>
    </div>
  );
}

function ReferenceCard({
  title,
  description,
  formula,
  notes,
}: {
  title: string;
  description: string;
  formula: string;
  notes: string[];
}) {
  return (
    <Card className="mt-4 border-slate-200 bg-slate-50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="h-3.5 w-3.5" />
          {title}{' '}
          <span className="text-[10px] text-slate-500 font-normal">— {description}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="bg-white border border-slate-200 rounded p-2 mb-2 font-mono text-xs text-emerald-700">
          {formula}
        </div>
        <ul className="text-xs text-slate-600 space-y-1 list-disc pl-4">
          {notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SummaryItem({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`p-2 rounded border ${accent ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
      <div className="text-[9px] uppercase tracking-wide text-slate-500 mb-0.5">{label}</div>
      <div className={`text-xs font-mono font-semibold ${accent ? 'text-emerald-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}
