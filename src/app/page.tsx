'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Ship,
  Wind,
  Map as MapIcon,
  Compass,
  Calculator,
  FileText,
  Printer,
  Target,
  Plane,
  Layers,
  FileCheck,
  Split,
  Route,
  ClipboardList,
  Navigation,
  ArrowRight,
  Anchor,
  Clock,
  Sparkles,
  Trash2,
  MapPinPlus,
  MousePointer2,
  Ruler,
  Undo2,
} from 'lucide-react';
import AWAWorksheet, {
  type AWAData,
  type AWAInitialState,
  type AWAObservation,
} from '@/components/sar/AWAWorksheet';
import ASWWorksheet, {
  type ASWData,
  type ASWInitialState,
  type ASWObservation,
} from '@/components/sar/ASWWorksheet';
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
import WeatherPanel from '@/components/sar/WeatherPanel';
import { toast } from 'sonner';
import { buildSearchActionPlanData } from '@/lib/sar/searchActionPlan';
import {
  type LatLng,
  type Vector,
  project,
  rectangleCorners,
  distanceNm,
  bearingDeg,
} from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import type { MapMarker, MapLine, MapPolygon, MapCircle } from '@/components/sar/SeaMap';
import BasicCalculation from '@/components/sar/BasicCalculation';
import SeaMapMount from '@/components/sar/SeaMapMount';

// Worksheet navigation and training tools
import ManeuveringBoard from '@/components/sar/ManeuveringBoard';
import type { BoardVector } from '@/lib/sar/maneuveringBoard';
import UPSPlotter from '@/components/sar/UPSPlotter';
import AeronauticalDriftWorksheet from '@/components/sar/AeronauticalDriftWorksheet';
import type { AeroDriftResult } from '@/lib/sar/aeroDriftCalculations';
import InterceptWorksheet from '@/components/sar/InterceptWorksheet';
import type { InterceptInput } from '@/lib/sar/interceptCalculations';
import Worksheet1 from '@/components/sar/worksheets/Worksheet1';
import Worksheet2, { type Worksheet2InitialState } from '@/components/sar/worksheets/Worksheet2';
import Worksheet3, { type Worksheet3InitialState } from '@/components/sar/worksheets/Worksheet3';
import Worksheet4, { type Worksheet4InitialState } from '@/components/sar/worksheets/Worksheet4';
import Worksheet8, { type Worksheet8InitialState } from '@/components/sar/worksheets/Worksheet8';
import BriefingForm from '@/components/sar/BriefingForm';
import RenopsForm from '@/components/sar/RenopsForm';
import DocumentWorkbench from '@/components/sar/DocumentWorkbench';
import AllWorksheetsView from '@/components/sar/AllWorksheetsView';
import PrintMapA3 from '@/components/sar/PrintMapA3';
import PrintCompanionMap from '@/components/sar/PrintCompanionMap';
import AIChatPanel from '@/components/sar/AIChatPanel';
import {
  generateSearchPattern,
  clipSearchPatternToSquare,
  type SearchPatternType,
  type SearchPatternResult,
  type SearchPatternPlanInitialState,
} from '@/lib/sar/searchPatterns';
import AssetAllocationWorksheet, {
  SRU_BASE_PRESETS,
} from '@/components/sar/AssetAllocationWorksheet';
import {
  type SruAssetInput,
  calculateAssetAllocationSummary,
} from '@/lib/sar/assetAllocation';

const DEFAULT_CENTER: LatLng = { lat: 0, lng: 0 };
const SEARCH_PATTERN_COLORS: Record<SearchPatternType, string> = {
  PS: '#9a3412',
  CS: '#c026d3',
  SS: '#0d9488',
  VS: '#65a30d',
  TS: '#475569',
};
const SEARCH_CONNECTOR_COLOR = '#a16207';

export default function Home() {
  // AWA & ASW states
  const [awa, setAwa] = useState<AWAData>({ aswDirFrom: 0, aswSpeed: 0, isValid: false });
  const [asw, setAsw] = useState<ASWData>({
    aswDirFrom: 0,
    aswSpeed: 0,
    aswErr: 0,
    aswdve: 0,
  });

  // Marine Datum & Search results
  const [datumData, setDatumData] = useState<DatumData | null>(null);
  const [datumResults, setDatumResults] = useState<DatumResults | null>(null);
  const [searchResults, setSearchResults] = useState<SearchPlanResults | null>(null);
  const [worksheet1Ao, setWorksheet1Ao] = useState(0);
  const [worksheet1Fs, setWorksheet1Fs] = useState(1.1);
  const [ws2TrackSpacing, setWs2TrackSpacing] = useState<{ platform: 'fixed-wing' | 'helicopter' | null; spacingNm: number; selection: string } | null>(null);
  const [ws3TrackSpacing, setWs3TrackSpacing] = useState<{ platform: 'fixed-wing' | 'helicopter' | null; heights: readonly number[]; spacingByHeight: Array<number | null> } | null>(null);
  const [ws8TrackSpacing, setWs8TrackSpacing] = useState<{ spacingNm: number; selection: string } | null>(null);

  // Controlled LKP
  const [lkp, setLkp] = useState<LatLng>({ lat: 0, lng: 0 });
  const [isLkpSet, setIsLkpSet] = useState(false);
  const [pickMode, setPickMode] = useState<boolean>(false);
  const [pickSruMode, setPickSruMode] = useState<boolean>(false);
  const [mainMapToolMode, setMainMapToolMode] = useState<'pan' | 'drop' | 'measure'>('pan');
  const [mainMapDroppedPoints, setMainMapDroppedPoints] = useState<Array<{ id: string; position: LatLng }>>([]);
  const [selectedMainMapPointId, setSelectedMainMapPointId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all-worksheets');
  const [tabClearVersions, setTabClearVersions] = useState<Record<string, number>>({});
  const [isPrintA3Open, setIsPrintA3Open] = useState<boolean>(false);
  const [isAiChatOpen, setIsAiChatOpen] = useState<boolean>(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState<boolean>(false);
  const [aiInterceptInput, setAiInterceptInput] = useState<InterceptInput | null>(null);
  const [interceptCaseVersion, setInterceptCaseVersion] = useState(0);

  // Aeronautical Drift State & auto-sync to LKP
  const [aeroResults, setAeroResults] = useState<AeroDriftResult | null>(null);
  const [adwSyncLkp, setAdwSyncLkp] = useState<boolean>(true);

  // SRU Asset Allocation State (Multi-Asset Fleet)
  const [assets, setAssets] = useState<SruAssetInput[]>([]);

  // Primary SRU for quick controls
  const primarySru = assets[0] || {
    name: '-',
    homeBasePos: { lat: 0, lng: 0 },
    transitSpeedKts: 0,
  };

  // Search Pattern Settings
  const [patternType, setPatternType] = useState<SearchPatternType>('PS');
  const [patternAssetId, setPatternAssetId] = useState('');
  const [patternTurn, setPatternTurn] = useState<'right' | 'left'>('right');
  const [tsReturn, setTsReturn] = useState<boolean>(false);
  const [patternOrientationText, setPatternOrientationText] = useState('');
  const [patternEnvironment, setPatternEnvironment] = useState<'' | 'water' | 'land'>('');
  const [patternWorksheetSource, setPatternWorksheetSource] = useState<'' | 'ws2' | 'ws3' | 'ws8'>('');
  const [patternLandHeight, setPatternLandHeight] = useState<number | null>(null);
  const [sectorAngleText, setSectorAngleText] = useState('');
  const [sectorLegLengthText, setSectorLegLengthText] = useState('');
  const [sectorLegCountText, setSectorLegCountText] = useState('');
  const [trackLineLengthText, setTrackLineLengthText] = useState('');
  const [tsReturnOffsetText, setTsReturnOffsetText] = useState('');

  // Raw state snapshots for saving cases
  const [awaObservations, setAwaObservations] = useState<AWAObservation[]>([]);
  const [awaContext, setAwaContext] = useState<Pick<AWAInitialState, 'distressAltFt' | 'forecastSource' | 'forecastValidTime'>>({ distressAltFt: 0 });
  const [aswState, setAswState] = useState<{ observations: ASWObservation[]; aswErr: number }>({
    observations: [],
    aswErr: 0,
  });
  const [datumState, setDatumState] = useState<DatumInitialState | null>(null);
  const [searchState, setSearchState] = useState<SearchPlanInitialState | null>(null);

  const [loadedInitialState, setLoadedInitialState] = useState<{
    awa?: AWAInitialState;
    asw?: ASWInitialState;
    datum?: DatumInitialState;
    search?: SearchPlanInitialState;
    ws2?: Worksheet2InitialState;
    ws8?: Worksheet8InitialState;
    ws3?: Worksheet3InitialState;
    ws4?: Worksheet4InitialState;
    lkp?: LatLng;
  } | null>(null);
  const [caseVersion, setCaseVersion] = useState<number>(0);

  // Overrides from WeatherPanel
  const [windOverride, setWindOverride] = useState<{ dirFrom: number; speed: number; hours: number; ts: number } | null>(null);
  const [seaCurrentOverride, setSeaCurrentOverride] = useState<{ dir: number; speed: number; ts: number } | null>(null);
  const [visibilityOverride, setVisibilityOverride] = useState<{ nm: number; ts: number } | null>(null);
  const [driftIntervalForWeather, setDriftIntervalForWeather] = useState<number>(6);

  // Auto-sync ADW landing pos to LKP when enabled
  useEffect(() => {
    if (aeroResults && adwSyncLkp) {
      const nextLkp = aeroResults.positionValid ? aeroResults.landingPos : aeroResults.incidentPos;
      setLkp((prev) => {
        if (
          Math.abs(prev.lat - nextLkp.lat) < 1e-6 &&
          Math.abs(prev.lng - nextLkp.lng) < 1e-6
        ) {
          return prev;
        }
        return nextLkp;
      });
    }
  }, [aeroResults, adwSyncLkp]);

  /** Build state for saving */
  const buildState = useCallback(() => {
    return {
      title: '',
      state: {
        awa: { observations: awaObservations, ...awaContext },
        asw: { observations: aswState.observations, aswErr: aswState.aswErr },
        datum: datumState ?? {},
        search: searchState ?? {},
        lkp,
        assets,
        patternType,
        patternAssetId,
        patternOrientationText,
        patternEnvironment,
        patternWorksheetSource,
        patternLandHeight,
        sectorAngleText,
        sectorLegLengthText,
        sectorLegCountText,
        trackLineLengthText,
        tsReturnOffsetText,
      },
    };
  }, [awaObservations, awaContext, aswState, datumState, searchState, lkp, assets, patternType, patternAssetId, patternOrientationText, patternEnvironment, patternWorksheetSource, patternLandHeight, sectorAngleText, sectorLegLengthText, sectorLegCountText, trackLineLengthText, tsReturnOffsetText]);

  /** Apply loaded state */
  const applyState = useCallback((state: Record<string, unknown>) => {
    const awa = (state.awa ?? {}) as AWAInitialState;
    const asw = (state.asw ?? {}) as ASWInitialState;
    const datum = (state.datum ?? {}) as DatumInitialState;
    const search = (state.search ?? {}) as SearchPlanInitialState;
    const lkpLoaded = state.lkp as LatLng | undefined;
    const assetsLoaded = state.assets as SruAssetInput[] | undefined;
    if (state.patternType) setPatternType(state.patternType as SearchPatternType);
    if (typeof state.patternAssetId === 'string') setPatternAssetId(state.patternAssetId);
    if (typeof state.patternOrientationText === 'string') setPatternOrientationText(state.patternOrientationText);
    if (state.patternEnvironment === 'land' || state.patternEnvironment === 'water') setPatternEnvironment(state.patternEnvironment);
    if (state.patternWorksheetSource === 'ws2' || state.patternWorksheetSource === 'ws3' || state.patternWorksheetSource === 'ws8') setPatternWorksheetSource(state.patternWorksheetSource);
    if (typeof state.patternLandHeight === 'number') setPatternLandHeight(state.patternLandHeight);
    if (typeof state.sectorAngleText === 'string') setSectorAngleText(state.sectorAngleText);
    if (typeof state.sectorLegLengthText === 'string') setSectorLegLengthText(state.sectorLegLengthText);
    if (typeof state.sectorLegCountText === 'string') setSectorLegCountText(state.sectorLegCountText);
    if (typeof state.trackLineLengthText === 'string') setTrackLineLengthText(state.trackLineLengthText);
    if (typeof state.tsReturnOffsetText === 'string') setTsReturnOffsetText(state.tsReturnOffsetText);
    setWorksheet1Ao(0);
    setWorksheet1Fs(1.1);
    if (assetsLoaded && Array.isArray(assetsLoaded)) setAssets(assetsLoaded);

    setLoadedInitialState({ awa, asw, datum, search, lkp: lkpLoaded });
    setAwaContext({ distressAltFt: awa.distressAltFt, forecastSource: awa.forecastSource, forecastValidTime: awa.forecastValidTime });
    if (lkpLoaded) setLkp(lkpLoaded);
    setCaseVersion((v) => v + 1);
  }, []);

  /** Clear all worksheets and reset entire state to clean initial condition */
  const handleClearAll = useCallback(() => {
    // Reset AWA & ASW
    setAwa({ aswDirFrom: 0, aswSpeed: 0 });
    setAsw({ aswDirFrom: 0, aswSpeed: 0, aswErr: 0, aswdve: 0 });
    setAwaObservations([]);
    setAwaContext({ distressAltFt: 0 });
    setAswState({ observations: [], aswErr: 0 });

    // Reset Datum & Search
    setDatumData(null);
    setDatumResults(null);
    setSearchResults(null);
    setWorksheet1Ao(0);
    setWorksheet1Fs(0);
    setWs2TrackSpacing(null);
    setWs3TrackSpacing(null);
    setWs8TrackSpacing(null);
    setDatumState(null);
    setSearchState(null);

    // Reset Coordinates to default
    setLkp(DEFAULT_CENTER);
    setIsLkpSet(false);
    setAeroResults(null);
    setAdwSyncLkp(true);
    setPickMode(false);
    setPickSruMode(false);
    setMainMapToolMode('pan');
    setMainMapDroppedPoints([]);
    setSelectedMainMapPointId(null);

    // Reset overrides
    setWindOverride(null);
    setSeaCurrentOverride(null);
    setVisibilityOverride(null);
    setDriftIntervalForWeather(0);

    // Explicitly set clean empty initialState so worksheets won't fall back to example datasets!
    setLoadedInitialState({
      awa: { observations: [], distressAltFt: 0, caseTitle: '-' },
      asw: { observations: [], distressTime: '', datumTime: '', caseTitle: '-', aswErr: 0 },
      datum: {},
      search: {},
      ws3: { caseTitle: '-', searchObject: '-', visibilityKm: 0, vegetationType: '-', isFatigue: null, searchTas: 0, hoursAvailable: 0, searchAreaNm2: 0 },
      lkp: DEFAULT_CENTER,
    });

    // Reset Pattern & Assets
    setPatternType('PS');
    setPatternAssetId('');
    setPatternTurn('right');
    setTsReturn(false);
    setPatternOrientationText('');
    setPatternEnvironment('');
    setPatternWorksheetSource('');
    setPatternLandHeight(null);
    setSectorAngleText('');
    setSectorLegLengthText('');
    setSectorLegCountText('');
    setTrackLineLengthText('');
    setTsReturnOffsetText('');
    setAssets([]);
    setAiInterceptInput(null);

    // Increment caseVersion to force re-mount of all keyed worksheets
    setCaseVersion((v) => v + 1);
    setIsClearConfirmOpen(false);
    toast.success('Seluruh lembar kerja berhasil dikosongkan!');
  }, []);

  const handleClearActiveTab = useCallback(() => {
    if (activeTab === 'all-worksheets') {
      setIsClearConfirmOpen(true);
      return;
    }

    switch (activeTab) {
      case 'awa':
        setAwa({ aswDirFrom: 0, aswSpeed: 0, isValid: false });
        setAwaObservations([]);
        setAwaContext({ distressAltFt: 0 });
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), awa: { observations: [], distressAltFt: 0, caseTitle: '-' } }));
        break;
      case 'aero':
        setAeroResults(null);
        setLkp({ lat: 0, lng: 0 });
        setIsLkpSet(false);
        break;
      case 'ups':
        setLkp({ lat: 0, lng: 0 });
        setIsLkpSet(false);
        break;
      case 'asw':
        setAsw({ aswDirFrom: 0, aswSpeed: 0, aswErr: 0, aswdve: 0 });
        setAswState({ observations: [], aswErr: 0 });
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), asw: { observations: [], distressTime: '', datumTime: '', caseTitle: '-', aswErr: 0 } }));
        break;
      case 'ws1':
        setDatumData(null);
        setDatumResults(null);
        setSearchResults(null);
        setWorksheet1Ao(0);
        setWorksheet1Fs(0);
        setDatumState(null);
        setSearchState(null);
        setLkp({ lat: 0, lng: 0 });
        setIsLkpSet(false);
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), datum: {}, search: {}, lkp: { lat: 0, lng: 0 } }));
        break;
      case 'ws2':
        setWs2TrackSpacing(null);
        setPatternWorksheetSource((source) => source === 'ws2' ? '' : source);
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), ws2: { caseTitle: '-', searchTas: 0, visibilityIndex: -1 } }));
        break;
      case 'ws8':
        setWs8TrackSpacing(null);
        setPatternWorksheetSource((source) => source === 'ws8' ? '' : source);
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), ws8: { caseTitle: '-', visibilityKm: '', vesselSpeedKts: 0 } }));
        break;
      case 'asset-allocation':
        setAssets([]);
        break;
      case 'search-pattern':
        setPatternType('PS');
        setPatternAssetId('');
        setPatternTurn('right');
        setTsReturn(false);
        setPatternOrientationText('');
        setPatternEnvironment('');
        setPatternWorksheetSource('');
        setPatternLandHeight(null);
        setSectorAngleText('');
        setSectorLegLengthText('');
        setSectorLegCountText('');
        setTrackLineLengthText('');
        setTsReturnOffsetText('');
        break;
      case 'ws3':
        setWs3TrackSpacing(null);
        setPatternWorksheetSource((source) => source === 'ws3' ? '' : source);
        setLoadedInitialState((prev) => ({
          ...(prev ?? {}),
          ws3: { caseTitle: '-', searchObject: '-', visibilityKm: 0, vegetationType: '-', isFatigue: null, searchTas: 0, hoursAvailable: 0, searchAreaNm2: 0 },
        }));
        break;
      case 'ws4':
        setLoadedInitialState((prev) => ({
          ...(prev ?? {}),
          ws4: { caseTitle: '-', searchDate: '-', callsign: '-', searchNo: '0', commenceUtc: '-', latitude: 0, longitude: 0, distressTimeUtc: '-', trList: [0, 0, 0, 0], fixErrors: [0, 0, 0, 0], yNavError: 0 },
        }));
        break;
      case 'intercept':
        setAiInterceptInput(null);
        setInterceptCaseVersion((version) => version + 1);
        break;
      case 'briefing-renops':
      case 'basic-calc':
        break;
      default:
        break;
    }

    setTabClearVersions((versions) => ({ ...versions, [activeTab]: (versions[activeTab] ?? 0) + 1 }));
    toast.success('Input pada tab aktif berhasil dibersihkan.');
  }, [activeTab]);

  // AI Assistant Callbacks
  const handleApplyASW = useCallback((data: {
    distressTime: string;
    datumTime: string;
    intervalMode: '6h' | '3h';
    windData: { windDirFrom: number; windSpeed: number }[];
    caseTitle?: string;
  }) => {
    const obsWithWind = data.windData?.map((w) => ({
      timeObs: '',
      timeStart: '',
      timeEnd: '',
      hours: 0,
      windDirFrom: w.windDirFrom,
      windSpeed: w.windSpeed,
    })) || [];

    setLoadedInitialState((prev) => ({
      ...prev,
      asw: {
        distressTime: data.distressTime,
        datumTime: data.datumTime,
        obsIntervalMode: data.intervalMode,
        observations: obsWithWind,
        caseTitle: data.caseTitle,
      },
    }));
    setCaseVersion((v) => v + 1);
    setActiveTab('asw');
  }, []);

  const handleApplyAWA = useCallback((data: {
    distressAltFt: number;
    windData: { altObs: string; windDirFrom: number; windSpeed: number }[];
    caseTitle?: string;
  }) => {
    setLoadedInitialState((prev) => ({
      ...prev,
      awa: {
        distressAltFt: data.distressAltFt,
        observations: data.windData,
        caseTitle: data.caseTitle,
      },
    }));
    setAwaContext({ distressAltFt: data.distressAltFt, forecastSource: '', forecastValidTime: '' });
    setCaseVersion((v) => v + 1);
    setActiveTab('awa');
  }, []);

  const handleApplyLKP = useCallback((data: { lat: number; lng: number }) => {
    setLkp(data);
    setIsLkpSet(true);
  }, []);

  const handleApplyDatum = useCallback((data: {
    latitude: number;
    lkp: LatLng;
    driftInterval: number;
    seaCurrentDir: number;
    seaCurrentSpeed: number;
    seaCurrentErr?: number;
    leewayObjectId?: string;
    X?: number;
    Y?: number;
  }) => {
    setLkp(data.lkp);
    setIsLkpSet(true);
    setLoadedInitialState((prev) => ({
      ...prev,
      datum: {
        latitude: data.latitude,
        driftInterval: data.driftInterval,
        seaCurrentDir: data.seaCurrentDir,
        seaCurrentSpeed: data.seaCurrentSpeed,
        seaCurrentErr: data.seaCurrentErr ?? 0,
        ...(data.leewayObjectId ? { leewayObjectId: data.leewayObjectId } : {}),
        X: data.X ?? 0,
        Y: data.Y ?? 0,
      },
    }));
    setCaseVersion((version) => version + 1);
    setActiveTab('ws1');
  }, []);

  const handleApplyWS2 = useCallback((data: Worksheet2InitialState) => {
    setLoadedInitialState((prev) => ({ ...prev, ws2: data }));
    setPatternEnvironment('water');
    setPatternWorksheetSource('ws2');
    const requiredAssetType = data.searchPlatform === 'helicopter' ? 'helicopter' : 'fixed-wing-aircraft';
    const matchingAsset = assets.find((asset) => asset.type === requiredAssetType);
    setPatternAssetId(matchingAsset?.id ?? '__case-derived__');
    setCaseVersion((version) => version + 1);
    setActiveTab('ws2');
  }, [assets]);

  const handleApplyWS3 = useCallback((data: Worksheet3InitialState) => {
    setLoadedInitialState((prev) => ({ ...prev, ws3: data }));
    setPatternEnvironment('land');
    setPatternWorksheetSource('ws3');
    const requiredAssetType = data.searchPlatform === 'helicopter' ? 'helicopter' : 'fixed-wing-aircraft';
    const matchingAsset = assets.find((asset) => asset.type === requiredAssetType);
    setPatternAssetId(matchingAsset?.id ?? '__case-derived__');
    setCaseVersion((version) => version + 1);
    setActiveTab('ws3');
  }, [assets]);

  const handleApplyWS4 = useCallback((data: Worksheet4InitialState) => {
    setLoadedInitialState((prev) => ({ ...prev, ws4: data }));
    setCaseVersion((version) => version + 1);
    setActiveTab('ws4');
  }, []);

  const handleApplyWS8 = useCallback((data: Worksheet8InitialState) => {
    setLoadedInitialState((prev) => ({ ...prev, ws8: data }));
    setPatternEnvironment('');
    setPatternWorksheetSource('ws8');
    const matchingAsset = assets.find((asset) => asset.type === data.sruType);
    setPatternAssetId(matchingAsset?.id ?? '__case-derived__');
    setCaseVersion((version) => version + 1);
    setActiveTab('ws8');
  }, [assets]);

  const handleApplySearchPattern = useCallback((data: SearchPatternPlanInitialState) => {
    setPatternType(data.patternType);
    setPatternOrientationText(String(data.orientationDeg));
    if (data.turnDirection) setPatternTurn(data.turnDirection);
    if (data.sectorAngleDeg !== undefined) setSectorAngleText(String(data.sectorAngleDeg));
    if (data.sectorLegLengthNm !== undefined) setSectorLegLengthText(String(data.sectorLegLengthNm));
    if (data.sectorLegCount !== undefined) setSectorLegCountText(String(data.sectorLegCount));
    if (data.trackLineLengthNm !== undefined) setTrackLineLengthText(String(data.trackLineLengthNm));
    if (data.tsReturn !== undefined) setTsReturn(data.tsReturn);
    if (data.tsReturnOffsetNm !== undefined) setTsReturnOffsetText(String(data.tsReturnOffsetNm));
    setActiveTab('search-pattern');
    setIsAiChatOpen(false);
    toast.success('Rencana search pattern dari analisis kasus telah dimasukkan ke peta.');
  }, []);

  const handleWS2TrackSpacingChange = useCallback((result: { platform: 'fixed-wing' | 'helicopter' | null; spacingNm: number; selection: string }) => {
    setWs2TrackSpacing(result);
  }, []);
  const handleWS3TrackSpacingChange = useCallback((result: { platform: 'fixed-wing' | 'helicopter' | null; heights: readonly number[]; spacingByHeight: Array<number | null> }) => {
    setWs3TrackSpacing(result);
  }, []);
  const handleWS8TrackSpacingChange = useCallback((result: { spacingNm: number; selection: string }) => {
    setWs8TrackSpacing(result);
  }, []);

  const handleApplyIntercept = useCallback((data: InterceptInput) => {
    setAiInterceptInput(data);
    setInterceptCaseVersion((version) => version + 1);
    setActiveTab('intercept');
    setIsAiChatOpen(false);
    toast.success('Data kasus otomatis dimasukkan ke worksheet Intercept.');
    return true;
  }, []);

  useEffect(() => {
    if (datumState?.driftInterval) {
      setDriftIntervalForWeather(datumState.driftInterval);
    }
  }, [datumState?.driftInterval]);

  // Luas Search Area dari Worksheet 1 (Ao)
  const ws1Ao = worksheet1Ao;

  // Titik Datum (Pusat Search Area): Midpoint antara Datum Left & Right
  const datumCenterPoint: LatLng = useMemo(() => {
    if (!datumResults) return lkp;
    return {
      lat: (datumResults.datumLeft.lat + datumResults.datumRight.lat) / 2,
      lng: (datumResults.datumLeft.lng + datumResults.datumRight.lng) / 2,
    };
  }, [datumResults, lkp]);

  // Arah drift dari LKP ke titik Datum (°T)
  const driftOrientationDeg = useMemo(() => {
    if (!datumResults) return 90;
    const dist = distanceNm(lkp, datumCenterPoint);
    if (dist < 0.01) return 90;
    return bearingDeg(lkp, datumCenterPoint);
  }, [lkp, datumCenterPoint, datumResults]);

  // Ukuran sisi Search Area berbentuk persegi (Square: Panjang = Lebar = Sisi S)
  const searchSquareSide = useMemo(() => {
    if (searchResults?.Ao && searchResults.Ao > 0) {
      return Number(Math.sqrt(searchResults.Ao).toFixed(2));
    }
    if (searchResults?.searchAreaLength && searchResults?.searchAreaWidth) {
      return Number(Math.max(searchResults.searchAreaLength, searchResults.searchAreaWidth).toFixed(2));
    }
    return Number(Math.sqrt(ws1Ao).toFixed(2));
  }, [searchResults, ws1Ao]);

  // Search Area parameters (Persegi dengan kemiringan searah drift dari LKP ke Datum)
  const searchAreaCenter = searchResults?.searchAreaCenter ?? datumCenterPoint;
  const searchAreaLength = searchSquareSide;
  const searchAreaWidth = searchSquareSide;
  const searchAreaOrientation = driftOrientationDeg;
  const patternSruRecord = patternAssetId === '__case-derived__' ? undefined : assets.find((asset) => asset.id === patternAssetId) ?? assets[0];
  const caseDerivedSruType = patternWorksheetSource === 'ws8'
    ? loadedInitialState?.ws8?.sruType
    : patternWorksheetSource === 'ws2'
      ? loadedInitialState?.ws2?.searchPlatform === 'helicopter' ? 'helicopter' : loadedInitialState?.ws2?.searchPlatform === 'fixed-wing' ? 'fixed-wing-aircraft' : undefined
      : patternWorksheetSource === 'ws3'
        ? loadedInitialState?.ws3?.searchPlatform === 'helicopter' ? 'helicopter' : loadedInitialState?.ws3?.searchPlatform === 'fixed-wing' ? 'fixed-wing-aircraft' : undefined
        : undefined;
  const patternSruType = patternSruRecord?.type ?? caseDerivedSruType;
  const patternAssetIsAir = patternSruType === 'helicopter' || patternSruType === 'fixed-wing-aircraft';
  const selectedPatternSource = patternSruRecord
    ? patternAssetIsAir
      ? patternEnvironment === 'land' ? 'ws3' : patternEnvironment === 'water' ? 'ws2' : patternWorksheetSource === 'ws2' || patternWorksheetSource === 'ws3' ? patternWorksheetSource : ''
      : 'ws8'
    : patternWorksheetSource;
  const primaryIsAir = selectedPatternSource === 'ws2' || selectedPatternSource === 'ws3' || (!selectedPatternSource && patternAssetIsAir);
  const primaryWorksheetPlatform = patternSruType === 'helicopter' ? 'helicopter'
    : patternSruType === 'fixed-wing-aircraft' ? 'fixed-wing'
      : selectedPatternSource === 'ws2' ? ws2TrackSpacing?.platform ?? null
        : selectedPatternSource === 'ws3' ? ws3TrackSpacing?.platform ?? null : null;
  const ws3HeightIndex = ws3TrackSpacing?.heights.indexOf(patternLandHeight ?? -1) ?? -1;
  const ws3SelectedSpacing = ws3HeightIndex >= 0 ? ws3TrackSpacing?.spacingByHeight[ws3HeightIndex] ?? null : null;
  const wsPlatformMatches = (worksheetPlatform: 'fixed-wing' | 'helicopter' | null | undefined) => !patternSruRecord || (patternAssetIsAir && worksheetPlatform === primaryWorksheetPlatform);
  const trackSpacing = selectedPatternSource === 'ws2' && wsPlatformMatches(ws2TrackSpacing?.platform)
    ? ws2TrackSpacing?.spacingNm ?? 0
    : selectedPatternSource === 'ws3' && wsPlatformMatches(ws3TrackSpacing?.platform)
      ? ws3SelectedSpacing ?? 0
      : selectedPatternSource === 'ws8' && (!patternSruRecord || !patternAssetIsAir)
        ? ws8TrackSpacing?.spacingNm ?? 0
        : 0;
  const patternSpacingSource = trackSpacing > 0
    ? selectedPatternSource === 'ws2' ? `Worksheet 2 · ${ws2TrackSpacing?.selection ?? ''}`
      : selectedPatternSource === 'ws3' ? `Worksheet 3 · ${patternLandHeight ?? ''} ft`
        : selectedPatternSource === 'ws8' ? `Worksheet 8 · ${ws8TrackSpacing?.selection ?? ''}` : ''
    : '';
  const caseSruTypeName: Record<string, string> = {
    'fixed-wing-aircraft': 'Pesawat fixed wing', helicopter: 'Helikopter',
    'rescue-vessel': 'Kapal SAR', 'patrol-boat': 'Kapal patroli', rib: 'RIB', 'sea-rider': 'Sea Rider',
  };
  const patternSruName = patternSruRecord?.name ?? (patternSruType ? caseSruTypeName[patternSruType] ?? 'SRU dari analisis kasus' : 'SRU dari analisis kasus');
  const patternSpeedKts = patternSruRecord?.transitSpeedKts ?? 0;
  const patternOrientation = patternOrientationText.trim() === '' ? null : Number(patternOrientationText);

  // Search Pattern generation
  const searchPatternResult: SearchPatternResult = useMemo(() => {
    if (!(searchSquareSide > 0)) {
      return {
        type: patternType,
        name: '-',
        code: '-',
        csp: searchAreaCenter,
        exitPoint: searchAreaCenter,
        waypoints: [],
        segments: [],
        totalDistanceNm: 0,
        estimatedHours: 0,
        description: 'Search Area persegi belum tersedia dari Worksheet 1.',
      };
    }
    if (patternOrientation === null || !Number.isFinite(patternOrientation) || patternOrientation < 0 || patternOrientation >= 360) {
      return {
        type: patternType, name: 'Search Pattern', code: patternType, csp: searchAreaCenter, exitPoint: searchAreaCenter,
        waypoints: [], segments: [], totalDistanceNm: 0, estimatedHours: 0,
        description: 'Masukkan heading True pola dari rencana planner (0° sampai kurang dari 360°).',
      };
    }
    const generated = generateSearchPattern(
      {
        type: patternType,
        center: searchAreaCenter,
        lengthNm: searchAreaLength,
        widthNm: searchAreaWidth,
        orientationDeg: patternOrientation,
        trackSpacingNm: trackSpacing,
        turnDirection: patternTurn,
        tsReturn,
        sectorAngleDeg: Number(sectorAngleText) || undefined,
        sectorLegLengthNm: Number(sectorLegLengthText) || undefined,
        sectorLegCount: Number(sectorLegCountText) || undefined,
        trackLineLengthNm: Number(trackLineLengthText) || undefined,
        tsReturnOffsetNm: Number(tsReturnOffsetText) || undefined,
      },
      patternSpeedKts
    );
    const clipped = clipSearchPatternToSquare(generated, searchAreaCenter, searchSquareSide, searchAreaOrientation);
    return clipped.segments.length > 0
      ? {
        ...clipped,
        description: `${clipped.description} CSP: ${formatDMS(clipped.csp.lat, false)}, ${formatDMS(clipped.csp.lng, true)}. Exit Point: ${formatDMS(clipped.exitPoint.lat, false)}, ${formatDMS(clipped.exitPoint.lng, true)}.`,
      }
      : { ...clipped, description: `${generated.description} Tidak ada segmen lintasan yang berada di dalam Search Area persegi.` };
  }, [
    patternType,
    searchAreaCenter,
    searchAreaLength,
    searchAreaWidth,
    searchSquareSide,
    searchAreaOrientation,
    patternOrientation,
    trackSpacing,
    patternTurn,
    tsReturn,
    sectorAngleText,
    sectorLegLengthText,
    sectorLegCountText,
    trackLineLengthText,
    tsReturnOffsetText,
    patternSpeedKts,
  ]);

  const csp = searchPatternResult.csp;
  const exitPoint = searchPatternResult.exitPoint;

  // Complete Asset Allocation Summary
  const assetSummary = useMemo(() => {
    return calculateAssetAllocationSummary(assets, csp, exitPoint, ws1Ao);
  }, [assets, csp, exitPoint, ws1Ao]);

  // Map view center
  const mapCenter: LatLng = useMemo(() => {
    if (datumData && datumResults) {
      return {
        lat: (datumData.start.lat + datumResults.datumLeft.lat + datumResults.datumRight.lat) / 3,
        lng: (datumData.start.lng + datumResults.datumLeft.lng + datumResults.datumRight.lng) / 3,
      };
    }
    return lkp;
  }, [datumData, datumResults, lkp]);

  // Click on map to set LKP or SRU Base
  const handleMapClick = useCallback(
    (latlng: LatLng) => {
      if (pickMode) {
        setLkp(latlng);
        setIsLkpSet(true);
        setPickMode(false);
      } else if (pickSruMode) {
        // Update home base of primary SRU
        setAssets((prev) =>
          prev.map((a, i) => (i === 0 ? { ...a, homeBasePos: latlng } : a))
        );
        setPickSruMode(false);
      }
    },
    [pickMode, pickSruMode]
  );

  const handleInteractiveMapClick = useCallback((latlng: LatLng) => {
    if (mainMapToolMode === 'drop') {
      const id = `worksheet-map-point-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setMainMapDroppedPoints((points) => [...points, { id, position: latlng }]);
      setSelectedMainMapPointId(id);
      return;
    }
    handleMapClick(latlng);
  }, [mainMapToolMode, handleMapClick]);

  // Map markers: LKP, Datums, CSP, Exit Point, and SRU Home Bases
  const markers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [
      {
        position: lkp,
        label: `LKP: ${formatDMS(lkp.lat, false)}, ${formatDMS(lkp.lng, true)}`,
        color: '#0ea5e9',
        isStart: true,
      },
    ];

    if (datumResults) {
      list.push({
        position: datumResults.datumLeft,
        label: `Datum Kiri (Left): ${formatDMS(datumResults.datumLeft.lat, false)}, ${formatDMS(datumResults.datumLeft.lng, true)}`,
        color: '#dc2626',
        isDatum: true,
      });
      list.push({
        position: datumResults.datumRight,
        label: `Datum Kanan (Right): ${formatDMS(datumResults.datumRight.lat, false)}, ${formatDMS(datumResults.datumRight.lng, true)}`,
        color: '#dc2626',
        isDatum: true,
      });
    }

    // SRU Home Bases
    assets.forEach((asset, idx) => {
      list.push({
        position: asset.homeBasePos,
        label: `Pangkalan ${asset.name}: ${formatDMS(asset.homeBasePos.lat, false)}, ${formatDMS(asset.homeBasePos.lng, true)}`,
        color: idx === 0 ? '#8b5cf6' : '#0284c7',
      });
    });

    if (searchPatternResult.segments.length > 0) {
      list.push({
        position: csp,
        label: `CSP: ${formatDMS(csp.lat, false)}, ${formatDMS(csp.lng, true)}`,
        color: '#10b981',
        showLabel: true,
      });
      list.push({
        position: exitPoint,
        label: `Exit Point: ${formatDMS(exitPoint.lat, false)}, ${formatDMS(exitPoint.lng, true)}`,
        color: '#f97316',
        showLabel: true,
      });
      searchPatternResult.waypoints.forEach((position, index) => {
        list.push({
          position,
          label: `Waypoint ${index + 1}: ${formatDMS(position.lat, false)}, ${formatDMS(position.lng, true)}`,
          color: SEARCH_PATTERN_COLORS[patternType],
          sequence: index + 1,
        });
      });
    }

    return list;
  }, [lkp, datumResults, assets, csp, exitPoint, searchPatternResult.waypoints, searchPatternResult.segments.length, patternType]);

  const interactiveMapMarkers: MapMarker[] = useMemo(() => [
    ...markers,
    ...mainMapDroppedPoints.map((point, index): MapMarker => ({
      position: point.position,
      label: `Titik tambahan ${index + 1}: ${formatDMS(point.position.lat, false)}, ${formatDMS(point.position.lng, true)}`,
      color: point.id === selectedMainMapPointId ? '#e11d48' : '#7c3aed',
      sequence: index + 1,
      onClick: () => setSelectedMainMapPointId(point.id),
    })),
  ], [markers, mainMapDroppedPoints, selectedMainMapPointId]);

  // Asset Transit Lines
  const assetTransitLines: MapLine[] = useMemo(() => {
    const list: MapLine[] = [];
    const palette = ['#8b5cf6', '#0284c7', '#0d9488', '#d97706'];

    assetSummary.perAsset.forEach((calc, idx) => {
      const col = palette[idx % palette.length];
      // Transit Go: Base -> CSP
      list.push({
        from: calc.asset.homeBasePos,
        to: csp,
        color: col,
        label: `${calc.asset.name} Go: ${calc.transitGoDistanceNm.toFixed(1)} NM (${(calc.transitGoHours * 60).toFixed(0)}m)`,
      });
      // Transit Back: Exit Point -> Base
      list.push({
        from: exitPoint,
        to: calc.asset.homeBasePos,
        color: col,
        dashed: true,
        label: `${calc.asset.name} Back: ${calc.transitBackDistanceNm.toFixed(1)} NM (${(calc.transitBackHours * 60).toFixed(0)}m)`,
      });
    });
    return list;
  }, [assetSummary.perAsset, csp, exitPoint]);

  // Map lines: Drift, TWC, Search Pattern Tracks, Transit Go & Transit Back
  const lines: MapLine[] = useMemo(() => {
    const list: MapLine[] = [];

    // Draw the pattern first; Worksheet 1 vectors are appended above it so they
    // retain visual priority where the two geometries cross.
    searchPatternResult.segments.forEach((seg) => {
      const segmentIndex = seg.legIndex - 1;
      const isConnector = patternType === 'PS' || patternType === 'CS'
        ? segmentIndex % 2 === 1
        : patternType === 'TS' && segmentIndex === 1;
      const color = isConnector ? SEARCH_CONNECTOR_COLOR : SEARCH_PATTERN_COLORS[patternType];
      const bearing = bearingDeg(seg.from, seg.to);
      const spacingLabel = !isConnector && trackSpacing > 0 && (patternType === 'PS' || patternType === 'CS')
        ? ` · S ${trackSpacing.toFixed(2)} NM`
        : patternType === 'SS' && trackSpacing > 0
          ? ` · ${(seg.distanceNm / trackSpacing).toFixed(0)}S`
          : '';
      list.push({
        from: seg.from,
        to: seg.to,
        color,
        arrow: true,
        dashed: isConnector,
        weight: isConnector ? 1.5 : 2,
        opacity: 0.58,
        labelClassName: 'sar-pattern-label',
        label: `${patternSruName} · ${isConnector ? 'Cross leg / turn' : `Search leg ${seg.legIndex}`} · ${bearing.toFixed(0)}°T · ${seg.distanceNm.toFixed(1)} NM${spacingLabel}${patternSpacingSource ? ` · ${patternSpacingSource}` : ''}`,
      });
    });

    // Worksheet 1 vector components, each plotted in a distinct color.
    if (datumData && datumResults) {
      const lkpPoint = datumData.start;
      const driftHours = Math.max(0, datumData.driftInterval);
      const seaCurrentEnd = project(
        lkpPoint,
        datumData.seaCurrent.dir,
        datumData.seaCurrent.mag * driftHours,
      );
      const downwindDir = (datumData.aswDirFrom + 180) % 360;
      const surfaceWindEnd = project(
        lkpPoint,
        downwindDir,
        datumData.aswSpeed * driftHours,
      );
      const windCurrentEnd = project(
        lkpPoint,
        datumResults.wc.wcSet,
        datumResults.wc.wcDrift * driftHours,
      );
      const twcEnd = project(
        lkpPoint,
        datumData.twc.dir,
        datumData.twc.mag * driftHours,
      );

      list.push({
        from: lkpPoint,
        to: seaCurrentEnd,
        color: '#2563eb',
        label: `Worksheet 1 · Sea Current: ${datumData.seaCurrent.dir.toFixed(0)}°T / ${(datumData.seaCurrent.mag * driftHours).toFixed(2)} NM`,
      });
      list.push({
        from: lkpPoint,
        to: surfaceWindEnd,
        color: '#0ea5e9',
        dashed: true,
        label: `Worksheet 1 · Surface Wind reciprocal: ${downwindDir.toFixed(0)}°T / ${(datumData.aswSpeed * driftHours).toFixed(2)} NM`,
      });
      list.push({
        from: lkpPoint,
        to: windCurrentEnd,
        color: '#f97316',
        label: `Worksheet 1 · Wind Current: ${datumResults.wc.wcSet.toFixed(0)}°T / ${(datumResults.wc.wcDrift * driftHours).toFixed(2)} NM`,
      });
      list.push({
        from: lkpPoint,
        to: twcEnd,
        color: '#7c3aed',
        dashed: true,
        label: `Worksheet 1 · TWC resultant: ${datumData.twc.dir.toFixed(0)}°T / ${(datumData.twc.mag * driftHours).toFixed(2)} NM`,
      });
      list.push({
        from: twcEnd,
        to: datumResults.datumLeft,
        color: '#16a34a',
        label: `Worksheet 1 · Leeway Left: ${datumData.lwLeftDir.toFixed(0)}°T / ${(datumData.lwSpeed * driftHours).toFixed(2)} NM`,
      });
      list.push({
        from: twcEnd,
        to: datumResults.datumRight,
        color: '#db2777',
        label: `Worksheet 1 · Leeway Right: ${datumData.lwRightDir.toFixed(0)}°T / ${(datumData.lwSpeed * driftHours).toFixed(2)} NM`,
      });
      list.push({
        from: lkpPoint,
        to: datumResults.datumLeft,
        color: '#111827',
        dashed: true,
        label: `Worksheet 1 · Total Drift Left: ${datumResults.driftDistance.toFixed(2)} NM`,
      });
      list.push({
        from: lkpPoint,
        to: datumResults.datumRight,
        color: '#64748b',
        dashed: true,
        label: `Worksheet 1 · Total Drift Right: ${datumResults.driftDistance.toFixed(2)} NM`,
      });
    }

    // TWC vector
    if (datumData) {
      const twcEnd = project(datumData.start, datumData.twc.dir, Math.max(1, datumData.twc.mag * 8));
      list.push({
        from: datumData.start,
        to: twcEnd,
        color: '#3b82f6',
        label: `TWC ${datumData.twc.dir.toFixed(0)}°T / ${datumData.twc.mag.toFixed(2)} kt`,
        dashed: true,
      });
    }

    // Add all SRU Transit Go & Back lines
    list.push(...assetTransitLines);

    return list;
  }, [
    datumData,
    datumResults,
    searchPatternResult.segments,
    patternType,
    trackSpacing,
    patternSruName,
    patternSpacingSource,
    assetTransitLines,
  ]);

  // Circles
  const circles: MapCircle[] = useMemo(() => {
    if (!datumResults) return [];
    const list: MapCircle[] = [
      {
        center: datumResults.datumLeft,
        radiusNm: datumResults.E,
        color: '#dc2626',
        fillColor: '#dc2626',
        fillOpacity: 0.05,
        label: `E = ${datumResults.E.toFixed(1)} NM`,
      },
    ];
    if (datumResults.De > 0) {
      list.push({
        center: datumResults.datumLeft,
        radiusNm: datumResults.De,
        color: '#d97706',
        fillColor: '#d97706',
        fillOpacity: 0.015,
        label: `Worksheet 1 Drift Error De = ${datumResults.De.toFixed(2)} NM`,
      });
      list.push({
        center: datumResults.datumRight,
        radiusNm: datumResults.De,
        color: '#d97706',
        fillColor: '#d97706',
        fillOpacity: 0.015,
      });
    }
    const fixErrorRadius = Math.hypot(datumResults.X, datumResults.Y);
    if (fixErrorRadius > 0) {
      list.push({
        center: datumCenterPoint,
        radiusNm: fixErrorRadius,
        color: '#7c3aed',
        fillColor: '#7c3aed',
        fillOpacity: 0.015,
        label: `Worksheet 1 Fix Error √(X² + Y²) = ${fixErrorRadius.toFixed(2)} NM`,
      });
    }
    if (distanceNm(datumResults.datumLeft, datumResults.datumRight) > 0.001) {
      list.push({
        center: datumResults.datumRight,
        radiusNm: datumResults.E,
        color: '#dc2626',
        fillColor: '#dc2626',
        fillOpacity: 0.05,
      });
    }
    return list;
  }, [datumResults, datumCenterPoint]);

  // Worksheet 1 area and the separate Worksheet 3 planning area are both squares,
  // oriented along the bearing from LKP to the datum midpoint.
  const polygons: MapPolygon[] = useMemo(() => {
    const list: MapPolygon[] = [];
    if (datumResults && ws1Ao > 0) {
      const side = Math.sqrt(ws1Ao);
      list.push({
        points: rectangleCorners(datumCenterPoint, side, side, driftOrientationDeg),
        color: '#16a34a',
        fillColor: '#16a34a',
        fillOpacity: 0.12,
        label: `Worksheet 1 Search Area · persegi ${side.toFixed(2)} × ${side.toFixed(2)} NM\nAo = ${ws1Ao.toFixed(2)} NM² | Arah LKP → Datum = ${driftOrientationDeg.toFixed(1)}°T`,
      });
    }
    if (searchResults?.Ao && searchResults.Ao > 0) {
      const side = Math.sqrt(searchResults.Ao);
      const sameAsWorksheet1 = ws1Ao > 0 && Math.abs(searchResults.Ao - ws1Ao) < 0.01;
      if (!sameAsWorksheet1) {
        list.push({
          points: rectangleCorners(searchResults.searchAreaCenter ?? datumCenterPoint, side, side, driftOrientationDeg),
          color: '#0891b2',
          fillColor: '#0891b2',
          fillOpacity: 0.08,
          label: `Worksheet 3 Search Area · persegi ${side.toFixed(2)} × ${side.toFixed(2)} NM\nAo = ${searchResults.Ao.toFixed(2)} NM² | Arah LKP → Datum = ${driftOrientationDeg.toFixed(1)}°T\nPOD = ${(searchResults.POD * 100).toFixed(0)}%`,
        });
      }
    }
    return list;
  }, [
    datumResults,
    searchResults,
    datumCenterPoint,
    driftOrientationDeg,
    ws1Ao,
  ]);

  const searchAreaCornerMarkers: MapMarker[] = useMemo(() => polygons.flatMap((area, areaIndex) => {
    if (area.points.length !== 4) return [];
    const center = {
      lat: area.points.reduce((sum, point) => sum + point.lat, 0) / 4,
      lng: area.points.reduce((sum, point) => sum + point.lng, 0) / 4,
    };
    const clockwise = area.points.map((position) => {
      const distance = distanceNm(center, position);
      const bearing = (bearingDeg(center, position) * Math.PI) / 180;
      const x = distance * Math.sin(bearing);
      const y = distance * Math.cos(bearing);
      return { position, x, y, angle: (Math.atan2(x, y) * 180 / Math.PI + 360) % 360 };
    }).sort((a, b) => a.angle - b.angle);
    const startIndex = clockwise.reduce((best, point, index, points) => {
      const score = point.y - point.x;
      const bestScore = points[best].y - points[best].x;
      return score > bestScore ? index : best;
    }, 0);
    const cornerOrder = [...clockwise.slice(startIndex), ...clockwise.slice(0, startIndex)];
    const areaName = area.label?.startsWith('Worksheet 1') ? 'WS1' : area.label?.startsWith('Worksheet 3') ? 'WS3' : `Area ${areaIndex + 1}`;
    return cornerOrder.map(({ position }, index): MapMarker => ({
      position,
      label: `${String.fromCharCode(65 + index)} · ${areaName}`,
      color: '#0f172a',
      showLabel: true,
    }));
  }), [polygons]);

  const searchAreaCornerDescriptions = useMemo(() => {
    const groups = new Map<string, MapMarker[]>();
    searchAreaCornerMarkers.forEach((marker) => {
      const areaName = marker.label.split(' · ')[1] ?? 'Search Area';
      groups.set(areaName, [...(groups.get(areaName) ?? []), marker]);
    });
    return [...groups.entries()].map(([areaName, corners]) => `${areaName}: ${corners.map((corner) => {
      const letter = corner.label.split(' · ')[0];
      return `${letter}: (${formatDMS(corner.position.lat, false)}, ${formatDMS(corner.position.lng, true)})`;
    }).join('; ')}`);
  }, [searchAreaCornerMarkers]);

  const mainMapMarkers = useMemo(
    () => [...interactiveMapMarkers, ...searchAreaCornerMarkers],
    [interactiveMapMarkers, searchAreaCornerMarkers],
  );

  // Vectors for Maneuvering Board in AWA tab (sesuai materi slide I Kadek Dedi K.)
  const awaBoardVectors: BoardVector[] = useMemo(() => {
    const rows = awa.rows ?? [];
    const list: BoardVector[] = rows
      .filter((row) => row.contributionKts > 0)
      .map((row, index) => ({
        id: `awa-obs-${row.inputIndex}`,
        label: `W${index + 1} (${(row.altitudeFt / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })}k, ${row.contributionKts.toFixed(1)} kts)`,
        dirDeg: row.windDirFrom,
        mag: row.contributionKts,
        color: '#38bdf8',
      }));
    if (awa.isValid && awa.vectorSumKts && awa.vectorSumKts > 0) {
      list.push({
        id: 'awa-result',
        label: `Vector Sum (${awa.aswDirFrom.toFixed(1)}°T / ${awa.vectorSumKts.toFixed(2)} kts, AWA: ${awa.aswSpeed.toFixed(2)} kts)`,
        dirDeg: awa.aswDirFrom,
        mag: awa.vectorSumKts,
        color: '#ef4444',
      });
    }
    return list;
  }, [awa]);

  // Vectors for Maneuvering Board in ASW tab (sesuai materi slide M. Fuadunnas)
  const aswBoardVectors: BoardVector[] = useMemo(() => {
    const list: BoardVector[] = [];
    let totalHours = 0;
    aswState.observations.forEach((obs, idx) => {
      totalHours += obs.hours;
      const contrib = obs.hours * obs.windSpeed;
      list.push({
        id: `asw-obs-${idx}`,
        label: `Obs ${idx + 1} (${obs.timeObs ?? obs.timeStart}, ${contrib.toFixed(1)} NM)`,
        dirDeg: obs.windDirFrom, // Plotting wind direction (°T) per documentation
        mag: contrib,
        color: '#0284c7',
      });
    });
    const vectorSumNm = totalHours > 0 ? Number((asw.aswSpeed * totalHours).toFixed(1)) : asw.aswSpeed;
    if (vectorSumNm > 0) {
      list.push({
        id: 'asw-result',
        label: `Vector Sum (${asw.aswDirFrom}°T / ${vectorSumNm} NM, ASW: ${asw.aswSpeed} kts)`,
        dirDeg: asw.aswDirFrom,
        mag: vectorSumNm,
        color: '#059669',
      });
    }
    if (datumResults?.twc) {
      list.push({
        id: 'asw-twc',
        label: 'TWC (Total Current)',
        dirDeg: datumResults.twc.twc.dir,
        mag: datumResults.twc.twc.mag * 5,
        color: '#dc2626',
      });
    }
    return list;
  }, [aswState.observations, asw, datumResults]);

  // Search Action Plan payload
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
      twcDir: datumData.twc.dir,
      twcSpeed: datumData.twc.mag,
      lwLeftDir: datumData.lwLeftDir,
      lwRightDir: datumData.lwRightDir,
      lwSpeed: datumData.lwSpeed,
      facilities: assets.map((a) => ({
        name: a.name,
        speed: a.searchSpeedKts,
      })),
    });
  }, [datumResults, searchResults, datumData, lkp, asw, awa, assets, assetSummary]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Header */}
      <header className="bg-slate-900 text-white shadow-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-emerald-500 flex items-center justify-center shadow">
                <Compass className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-bold tracking-tight">
                  Sistem Kalkulasi & Operasional SAR Terpadu
                </h1>
                <p className="text-xs text-slate-300">
                  Alur: AWA → ADW (LKP) → ASW → WS 1 (Ao) → WS 2 & 8 → Alokasi Aset SRU & Pola Pencarian
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Tombol AI Assistant */}
              <button
                type="button"
                onClick={() => setIsAiChatOpen((prev) => !prev)}
                className="flex items-center gap-1.5 text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold px-3 py-1.5 rounded-lg shadow transition-all border border-emerald-400/30"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-200" /> AI Assistant
              </button>
              {/* Tombol Cetak Peta A3 */}
              <button
                type="button"
                onClick={() => setIsPrintA3Open(true)}
                className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg shadow transition-colors"
              >
                <Printer className="h-3.5 w-3.5" /> Cetak Peta A3
              </button>
              {/* Tombol Bersihkan Semua / Clear All */}
              <button
                type="button"
                onClick={() => setIsClearConfirmOpen(true)}
                className="flex items-center gap-1.5 text-xs bg-rose-700 hover:bg-rose-600 text-white font-bold px-3 py-1.5 rounded-lg shadow transition-colors border border-rose-500/40"
                title="Bersihkan semua data di seluruh tab untuk memulai kasus soal baru"
              >
                <Trash2 className="h-3.5 w-3.5" /> Bersihkan Semua
              </button>
              <button
                type="button"
                onClick={handleClearActiveTab}
                className="flex items-center gap-1.5 text-xs bg-amber-600 hover:bg-amber-500 text-white font-bold px-3 py-1.5 rounded-lg shadow transition-colors border border-amber-400/40"
                title="Bersihkan input pada tab yang sedang dibuka"
              >
                <Trash2 className="h-3.5 w-3.5" /> Bersihkan Tab Ini
              </button>
              <CaseManager buildState={buildState} applyState={applyState} />
              <ExportButtons data={searchActionPlanData} caseTitle="SAR_Search_Action_Plan" />
              <Badge variant="secondary" className="bg-slate-800 text-slate-200 border-slate-700">
                SAR Planning
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-5 grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left Column: Worksheets & Tools */}
        <section className="lg:col-span-3 space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            {/* Scrollable Navigation Tabs List with Strict Logical Order */}
            <div className="overflow-x-auto pb-1 mb-3">
              <TabsList className="inline-flex h-auto p-1 bg-slate-200/80 rounded-lg gap-1 min-w-full sm:min-w-0">
                <TabsTrigger
                  value="all-worksheets"
                  className="text-xs px-2.5 py-1.5 font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
                >
                  <FileCheck className="h-3.5 w-3.5 mr-1 text-emerald-300" /> Semua Worksheet
                </TabsTrigger>
                <TabsTrigger value="awa" className="text-xs px-2 py-1.5">
                  <Wind className="h-3.5 w-3.5 mr-1" /> 1. AWA + MoBo
                </TabsTrigger>
                <TabsTrigger value="aero" className="text-xs px-2 py-1.5 data-[state=active]:bg-sky-600 data-[state=active]:text-white font-semibold">
                  <Plane className="h-3.5 w-3.5 mr-1" /> 2. Aero Drift (ADW)
                </TabsTrigger>
                <TabsTrigger value="ups" className="text-xs px-2 py-1.5">
                  <MapIcon className="h-3.5 w-3.5 mr-1" /> UPS Plotter
                </TabsTrigger>
                <TabsTrigger value="asw" className="text-xs px-2 py-1.5">
                  <Wind className="h-3.5 w-3.5 mr-1" /> 3. ASW + MoBo
                </TabsTrigger>
                <TabsTrigger value="ws1" className="text-xs px-2 py-1.5 font-semibold">
                  <Ship className="h-3.5 w-3.5 mr-1" /> 4. WS 1 (Datum)
                </TabsTrigger>
                <TabsTrigger value="ws2" className="text-xs px-2 py-1.5">
                  <Split className="h-3.5 w-3.5 mr-1" /> 5. WS 2 (Maritime)
                </TabsTrigger>
                <TabsTrigger value="ws8" className="text-xs px-2 py-1.5">
                  <Layers className="h-3.5 w-3.5 mr-1" /> 6. WS 8 (Kapal)
                </TabsTrigger>
                <TabsTrigger
                  value="asset-allocation"
                  className="text-xs px-2.5 py-1.5 font-bold data-[state=active]:bg-purple-700 data-[state=active]:text-white"
                >
                  <Anchor className="h-3.5 w-3.5 mr-1 text-purple-200" /> 7. Alokasi Aset SRU
                </TabsTrigger>
                <TabsTrigger value="search-pattern" className="text-xs px-2.5 py-1.5 font-bold data-[state=active]:bg-emerald-700 data-[state=active]:text-white">
                  <Navigation className="h-3.5 w-3.5 mr-1 text-emerald-200" /> 8. Pola & Rute
                </TabsTrigger>
                <TabsTrigger value="ws3" className="text-xs px-2 py-1.5">
                  <Calculator className="h-3.5 w-3.5 mr-1" /> WS 3 (Land)
                </TabsTrigger>
                <TabsTrigger value="ws4" className="text-xs px-2 py-1.5">
                  <Calculator className="h-3.5 w-3.5 mr-1" /> WS 4 (Radius)
                </TabsTrigger>
                <TabsTrigger value="intercept" className="text-xs px-2.5 py-1.5 data-[state=active]:bg-rose-600 data-[state=active]:text-white font-bold">
                  <Target className="h-3.5 w-3.5 mr-1 text-rose-300" /> Intercept
                </TabsTrigger>
                <TabsTrigger value="briefing-renops" className="text-xs px-2 py-1.5">
                  <ClipboardList className="h-3.5 w-3.5 mr-1" /> Briefing/Renops
                </TabsTrigger>
                <TabsTrigger value="basic-calc" className="text-xs px-2 py-1.5">
                  <Calculator className="h-3.5 w-3.5 mr-1" /> Hitung Dasar
                </TabsTrigger>
              </TabsList>
            </div>

            {/* TAB: SEMUA WORKSHEET (SUMMARY VIEW) */}
            <TabsContent value="all-worksheets" key={`all-tab-${caseVersion}-${tabClearVersions['all-worksheets'] ?? 0}`} className="mt-0">
              <AllWorksheetsView
                key={`all-${caseVersion}`}
                lkp={lkp}
                datumData={datumData}
                datumResults={datumResults}
                searchResults={searchResults}
                ws1Ao={ws1Ao}
                onWorksheet1AoChange={setWorksheet1Ao}
                selectedFs={worksheet1Fs}
                aswDirFrom={asw.aswDirFrom}
                aswSpeed={asw.aswSpeed}
                awaDirFrom={awa.aswDirFrom}
                awaSpeed={awa.aswSpeed}
                csp={csp}
                exitPoint={exitPoint}
                assets={assets}
                onAssetsChange={setAssets}
              />
            </TabsContent>

            {/* TAB 1: AWA + MANEUVERING BOARD */}
            <TabsContent value="awa" key={`awa-tab-${caseVersion}-${tabClearVersions.awa ?? 0}`} className="mt-0 space-y-4">
              <AWAWorksheet
                key={`awa-${caseVersion}`}
                onDataChange={setAwa}
                onObservationsChange={setAwaObservations}
                onContextChange={setAwaContext}
                initialState={loadedInitialState?.awa}
              />
              <div className="print-companion-page">
                <ManeuveringBoard
                  key={`awa-mobo-${caseVersion}`}
                  title="Papan Manuver Angin Atas (AWA Maneuvering Board)"
                  subtitle="Plotting Vektor Angin pada Berbagai Ketinggian & Hasil Resultan AWA (Appendix K-10)"
                  vectors={awaBoardVectors}
                  unitLabel="kts"
                  autoFitOrigin
                />
              </div>
            </TabsContent>

            {/* TAB 2: AERONAUTICAL DRIFT WORKSHEET (ADW) -> PRODUCES LKP */}
            <TabsContent value="aero" key={`aero-tab-${caseVersion}-${tabClearVersions.aero ?? 0}`} className="mt-0 space-y-4">
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-xs flex flex-wrap items-center justify-between gap-2 print:hidden">
                <div className="flex items-center gap-2">
                  <Plane className="h-5 w-5 text-sky-700" />
                  <div>
                    <span className="font-bold text-sky-950">Integrasi Alur Operasional Basarnas:</span>
                    <p className="text-sky-800 text-[11px]">
                      Input Angin Atas diambil otomatis dari <strong>AWA</strong> ({awa.isValid ? `${awa.aswDirFrom.toFixed(1)}°T / ${awa.aswSpeed.toFixed(2)} kts` : 'belum tersedia; lengkapi data AWA terlebih dahulu'}).
                      Hasil koordinat pendaratan (Landing Position) digunakan sebagai <strong>LKP</strong> operasi selanjutnya.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-sky-900 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={adwSyncLkp}
                      onChange={(e) => setAdwSyncLkp(e.target.checked)}
                      className="rounded text-sky-600" suppressHydrationWarning
                    />
                    Sinkron Otomatis ke LKP
                  </label>
                  {aeroResults?.positionValid && (
                    <button
                      type="button"
                      onClick={() => setLkp(aeroResults.landingPos)}
                      className="bg-sky-600 hover:bg-sky-700 text-white font-bold px-2.5 py-1 rounded text-xs transition"
                    >
                      Terapkan Jadi LKP
                    </button>
                  )}
                </div>
              </div>

              <AeronauticalDriftWorksheet
                key={`aero-${caseVersion}`}
                initialLkp={lkp}
                awaDirFrom={awa.aswDirFrom}
                awaSpeedKts={awa.aswSpeed}
                awaIsValid={awa.isValid}
                onResults={setAeroResults}
              />
              <PrintCompanionMap
                title="LAMPIRAN: PETA PLOTTING AERONAUTICAL DRIFT & LKP"
                worksheetRef="ADW (AERONAUTICAL DRIFT)"
                lkp={lkp}
                mapCenter={mapCenter}
                markers={markers}
                lines={lines}
                polygons={polygons}
                circles={circles}
                searchAreaLength={searchAreaLength}
                searchAreaWidth={searchAreaWidth}
                searchAreaOrientation={searchAreaOrientation}
                ws1Ao={ws1Ao}
              />
            </TabsContent>

            {/* TAB: UNIVERSAL PLOTTING SHEET (UPS) */}
            <TabsContent value="ups" key={`ups-tab-${caseVersion}-${tabClearVersions.ups ?? 0}`} className="mt-0">
              <UPSPlotter
                key={`ups-${caseVersion}`}
                lkp={lkp}
                aeroIncidentPos={aeroResults?.positionValid ? aeroResults.incidentPos : undefined}
                aeroEndGlidePos={aeroResults?.positionValid && aeroResults.aircraftActive ? aeroResults.aircraftEndGlidePos : undefined}
                aeroLandingPos={aeroResults?.positionValid ? aeroResults.landingPos : undefined}
                aeroAircraftGlideVector={aeroResults?.positionValid && aeroResults.aircraftActive ? aeroResults.aircraftGlideVector : undefined}
                aeroAircraftWindVector={aeroResults?.positionValid && aeroResults.aircraftActive ? aeroResults.aircraftWindVector : undefined}
                aeroParachuteGlideVector={aeroResults?.positionValid && aeroResults.parachuteActive ? aeroResults.parachuteGlideVector : undefined}
                aeroParachuteWindVector={aeroResults?.positionValid && aeroResults.parachuteActive ? aeroResults.parachuteWindVector : undefined}
                aeroParachuteResultVector={aeroResults?.positionValid && aeroResults.parachuteActive ? aeroResults.parachuteDisplacementVector : undefined}
                datumLeft={datumResults?.datumLeft}
                datumRight={datumResults?.datumRight}
                searchAreaCenter={searchResults?.searchAreaCenter}
                searchAreaLength={searchResults?.searchAreaLength}
                searchAreaWidth={searchResults?.searchAreaWidth}
                searchAreaOrientation={searchResults?.orientationDeg}
              />
            </TabsContent>

            {/* TAB 3: ASW + VECTOR MANEUVERING BOARD */}
            <TabsContent value="asw" key={`asw-tab-${caseVersion}-${tabClearVersions.asw ?? 0}`} className="mt-0 space-y-4">
              <ASWWorksheet
                key={`asw-${caseVersion}`}
                onDataChange={setAsw}
                onStateChange={setAswState}
                windOverride={windOverride}
                initialState={loadedInitialState?.asw}
              />
              <div className="print-companion-page">
                <ManeuveringBoard
                  key={`asw-mobo-${caseVersion}`}
                  title="Papan Manuver Vektor Permukaan (ASW & Water Current)"
                  subtitle="Plotting Vektor Angin Permukaan (ASW), Arus Laut (SC), dan Vektor Arus Total (TWC)"
                  vectors={aswBoardVectors}
                  unitLabel="NM"
                  autoFitOrigin
                />
              </div>
            </TabsContent>

            {/* TAB 4: WORKSHEET 1 (MARINE DATUM & SEARCH AREA AO) */}
            <TabsContent value="ws1" key={`ws1-tab-${caseVersion}-${tabClearVersions.ws1 ?? 0}`} className="mt-0 space-y-4">
              <Worksheet1
                key={`ws1-${caseVersion}`}
                lkp={lkp}
                datumData={datumData}
                datumResults={datumResults}
                aswDirFrom={asw.aswDirFrom}
                aswSpeed={asw.aswSpeed}
                onAoChange={setWorksheet1Ao}
                selectedFs={worksheet1Fs}
                onFsChange={setWorksheet1Fs}
              />
              <DatumWorksheet
                aswDirFrom={asw.aswDirFrom}
                aswSpeed={asw.aswSpeed}
                aswErr={asw.aswErr}
                aswdve={asw.aswdve}
                startLat={lkp.lat}
                startLng={lkp.lng}
                onLKPChange={(lat, lng) => {
                  setLkp({ lat, lng });
                  setIsLkpSet(true);
                }}
                onRequestMapPick={() => {
                  setPickMode(true);
                  setActiveTab('ws1');
                }}
                pickMode={pickMode}
                seaCurrentOverride={seaCurrentOverride}
                onResults={setDatumResults}
                onDataChange={setDatumData}
                onStateChange={setDatumState}
                initialState={loadedInitialState?.datum}
                key={`datum-${caseVersion}`}
              />
              <PrintCompanionMap
                title="LAMPIRAN: PETA OPERASI SAR — WORKSHEET 1 (MARINE DATUM & SEARCH AREA)"
                worksheetRef="WORKSHEET 1 (MARINE DATUM)"
                lkp={lkp}
                mapCenter={mapCenter}
                markers={markers}
                lines={lines}
                polygons={polygons}
                circles={circles}
                searchAreaLength={searchAreaLength}
                searchAreaWidth={searchAreaWidth}
                searchAreaOrientation={searchAreaOrientation}
                ws1Ao={ws1Ao}
                driftDistance={datumResults?.driftDistance}
                E={datumResults?.E}
              />
            </TabsContent>

            {/* TAB 5: WORKSHEET 2 (LEEWAY DIVERGENCE & SUB-AREA DECISION USING AO) */}
            <TabsContent value="ws2" key={`ws2-tab-${caseVersion}-${tabClearVersions.ws2 ?? 0}`} className="mt-0 space-y-4">
              <Worksheet2
                key={`ws2-${caseVersion}`}
                lkp={lkp}
                datumData={datumData}
                datumResults={datumResults}
                aswDirFrom={asw.aswDirFrom}
                ws1Ao={ws1Ao}
                initialState={loadedInitialState?.ws2}
                onTrackSpacingChange={handleWS2TrackSpacingChange}
              />
              <PrintCompanionMap
                title="LAMPIRAN: PETA OPERASI SAR — WORKSHEET 2 (SUB-AREA & LEEWAY DIVERGENCE)"
                worksheetRef="WORKSHEET 2 (SUB-AREA PLANNING)"
                lkp={lkp}
                mapCenter={mapCenter}
                markers={markers}
                lines={lines}
                polygons={polygons}
                circles={circles}
                searchAreaLength={searchAreaLength}
                searchAreaWidth={searchAreaWidth}
                searchAreaOrientation={searchAreaOrientation}
                ws1Ao={ws1Ao}
                driftDistance={datumResults?.driftDistance}
                E={datumResults?.E}
              />
            </TabsContent>

            {/* TAB 6: WORKSHEET 8 (CUMULATIVE POSC USING AO) */}
            <TabsContent value="ws8" key={`ws8-tab-${caseVersion}-${tabClearVersions.ws8 ?? 0}`} className="mt-0">
              <Worksheet8
                key={`ws8-${caseVersion}`}
                ws1Ao={ws1Ao}
                windKts={datumData?.aswSpeed ?? 0}
                initialC={searchResults?.C ?? 0}
                initialPod={searchResults?.POD ?? 0}
                initialState={loadedInitialState?.ws8}
                onTrackSpacingChange={handleWS8TrackSpacingChange}
              />
            </TabsContent>

            {/* TAB 7: PENGHITUNGAN ALOKASI ASET SRU */}
            <TabsContent value="asset-allocation" key={`assets-tab-${caseVersion}-${tabClearVersions['asset-allocation'] ?? 0}`} className="mt-0 space-y-4">
              <AssetAllocationWorksheet
                key={`assets-${caseVersion}`}
                csp={csp}
                exitPoint={exitPoint}
                ws1Ao={ws1Ao}
                assets={assets}
                onAssetsChange={setAssets}
              />
              <PrintCompanionMap
                title="LAMPIRAN: PETA ALOKASI ASET SRU & RUTE TRANSIT"
                worksheetRef="ALOKASI ASET SRU"
                lkp={lkp}
                mapCenter={mapCenter}
                markers={markers}
                lines={lines}
                polygons={polygons}
                circles={circles}
                searchAreaLength={searchAreaLength}
                searchAreaWidth={searchAreaWidth}
                searchAreaOrientation={searchAreaOrientation}
                ws1Ao={ws1Ao}
                driftDistance={datumResults?.driftDistance}
                E={datumResults?.E}
              />
            </TabsContent>

            {/* TAB 8: POLA PENCARIAN & TRANSIT ASET SRU */}
            <TabsContent value="search-pattern" key={`search-pattern-tab-${caseVersion}-${tabClearVersions['search-pattern'] ?? 0}`} className="mt-0 space-y-4">
              <Card className="border-slate-300 shadow-sm bg-white overflow-hidden">
                <CardHeader className="bg-slate-100 border-b border-slate-300 py-3 px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Navigation className="h-5 w-5 text-emerald-700" />
                      <div>
                        <CardTitle className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                          POLA PENCARIAN (SEARCH PATTERN) & LINTASAN KAKI TRACK
                        </CardTitle>
                        <p className="text-[11px] text-slate-500 font-mono">
                          Berdasarkan Materi Diklat Basarnas dan panduan perencanaan SAR
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-white font-medium px-2.5 py-1 rounded shadow-2xs transition-colors print:hidden"
                      >
                        <Printer className="h-3.5 w-3.5" /> Cetak Lembar Ini
                      </button>
                      <Badge variant="outline" className="bg-emerald-50 text-emerald-800 border-emerald-300 font-bold">
                        {searchPatternResult.code}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="p-4 space-y-4">
                  {/* Pattern Selection Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Left: Search Pattern Type */}
                    <div className="space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                        <Route className="h-4 w-4 text-emerald-600" /> 1. Konfigurasi Pola Pencarian
                      </h3>

                      {assets.length > 0 && (
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">SRU / asset yang polanya ditampilkan</label>
                          <select value={patternSruRecord?.id ?? (patternWorksheetSource ? '__case-derived__' : '')} onChange={(e) => setPatternAssetId(e.target.value)} className="w-full text-xs bg-white border border-slate-300 rounded p-1.5">
                            {patternWorksheetSource && !patternSruRecord && <option value="__case-derived__">{patternSruName} · dipilih dari analisis AI</option>}
                            {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {asset.type}</option>)}
                          </select>
                          {assets.length > 1 && <p className="mt-1 text-[10px] text-amber-800">Pilih satu SRU per tampilan. Geometri sub-area terpisah per SRU belum ditentukan, jadi lintasan tidak digandakan pada batas area yang sama.</p>}
                        </div>
                      )}

                      <div>
                        <label className="text-xs font-semibold text-slate-700 block mb-1">
                          Jenis Pola Pencarian (Search Pattern):
                        </label>
                        <select
                          value={patternType}
                          onChange={(e) => setPatternType(e.target.value as SearchPatternType)}
                          className="w-full text-xs bg-white border border-slate-300 rounded p-1.5 font-semibold text-slate-800"
                        >
                          <option value="PS">Parallel Track Search (PS) — Sapuan Sejajar Sumbu Utama</option>
                          <option value="CS">Creeping Line Search (CS) — Sapuan Tegak Lurus (Merayap)</option>
                          <option value="SS">Expanding Square Search (SS) — Kotak Membesar</option>
                          <option value="VS">Sector Search (VS) — Pola Sektor 3 Segitiga</option>
                          <option value="TS">Track Line Search (TS) — Garis Haluan / Rute Perjalanan</option>
                        </select>
                      </div>

                      {primaryIsAir && (
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">Konteks pencarian SRU udara</label>
                          <select value={patternEnvironment} onChange={(e) => {
                            const value = e.target.value as '' | 'water' | 'land';
                            setPatternEnvironment(value);
                            setPatternWorksheetSource(value === 'water' ? 'ws2' : value === 'land' ? 'ws3' : '');
                          }} className="w-full text-xs bg-white border border-slate-300 rounded p-1.5">
                            <option value="">Pilih area pencarian</option>
                            <option value="water">Di laut — gunakan Worksheet 2</option>
                            <option value="land">Di darat — gunakan Worksheet 3</option>
                          </select>
                        </div>
                      )}
                      {primaryIsAir && patternEnvironment === 'land' && (
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">Ketinggian observasi dari Worksheet 3</label>
                          <select value={patternLandHeight ?? ''} onChange={(e) => setPatternLandHeight(e.target.value ? Number(e.target.value) : null)} className="w-full text-xs bg-white border border-slate-300 rounded p-1.5">
                            <option value="">Pilih kolom ketinggian Worksheet 3</option>
                            {ws3TrackSpacing?.heights.map((height) => <option key={height} value={height}>{height.toLocaleString('id-ID')} ft</option>)}
                          </select>
                        </div>
                      )}

                      <div className="rounded border border-slate-200 bg-white p-2 text-[11px]">
                        <div className="font-semibold text-slate-700">Track Spacing S untuk {patternSruName}</div>
                        <div className={trackSpacing > 0 && patternSpacingSource ? 'font-mono font-bold text-emerald-800' : 'text-amber-800'}>
                          {trackSpacing > 0 && patternSpacingSource ? `${trackSpacing.toFixed(2)} NM · ${patternSpacingSource}` : 'Belum tersedia. Lengkapi worksheet sumber dan pilih konteks pencarian.'}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] font-semibold text-slate-700">Heading pola (°T)
                          <input type="number" min="0" max="359.999" step="0.1" value={patternOrientationText} onChange={(e) => setPatternOrientationText(e.target.value)} placeholder="Dari planner" className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono" />
                        </label>
                      </div>

                      {patternType === 'VS' && (
                        <div className="grid grid-cols-3 gap-2">
                          <label className="text-[11px] font-semibold text-slate-700">Sector angle (°)<input type="number" min="0" max="359.9" value={sectorAngleText} onChange={(e) => setSectorAngleText(e.target.value)} placeholder="Planner" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>
                          <label className="text-[11px] font-semibold text-slate-700">Panjang leg (NM)<input type="number" min="0" value={sectorLegLengthText} onChange={(e) => setSectorLegLengthText(e.target.value)} placeholder="Planner" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>
                          <label className="text-[11px] font-semibold text-slate-700">Jumlah leg<input type="number" min="1" step="1" value={sectorLegCountText} onChange={(e) => setSectorLegCountText(e.target.value)} placeholder="Planner" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>
                        </div>
                      )}

                      {patternType === 'TS' && (
                        <div className="grid grid-cols-2 gap-2">
                          <label className="text-[11px] font-semibold text-slate-700">Panjang Track Line (NM)<input type="number" min="0" value={trackLineLengthText} onChange={(e) => setTrackLineLengthText(e.target.value)} placeholder="Dari rencana rute" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>
                          {tsReturn && <label className="text-[11px] font-semibold text-slate-700">Offset jalur pulang (NM)<input type="number" min="0" value={tsReturnOffsetText} onChange={(e) => setTsReturnOffsetText(e.target.value)} placeholder="Dari planner" className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>}
                        </div>
                      )}

                      {(patternType === 'SS' || patternType === 'VS') && (
                        <div>
                          <label className="text-xs font-semibold text-slate-700 block mb-1">
                            Arah Belokan (Turn Direction):
                          </label>
                          <select
                            value={patternTurn}
                            onChange={(e) => setPatternTurn(e.target.value as 'right' | 'left')}
                            className="w-full text-xs bg-white border border-slate-300 rounded p-1.5 font-medium"
                          >
                            <option value="right">Belok Kanan (Starboard / Right Turn)</option>
                            <option value="left">Belok Kiri (Port / Left Turn)</option>
                          </select>
                        </div>
                      )}

                      {patternType === 'TS' && (
                        <div className="flex items-center gap-2 pt-1">
                          <input
                            type="checkbox"
                            id="tsReturnCb"
                            checked={tsReturn}
                            onChange={(e) => setTsReturn(e.target.checked)}
                            className="rounded text-emerald-600" suppressHydrationWarning
                          />
                          <label htmlFor="tsReturnCb" className="text-xs font-semibold text-slate-700 cursor-pointer">
                            Jalur Pulang-Pergi (Return Track / TSR)
                          </label>
                        </div>
                      )}

                      <div className="text-[11px] text-slate-600 bg-white p-2 rounded border border-slate-200">
                        {searchPatternResult.description}
                      </div>
                    </div>

                    {/* Right: Primary SRU Status */}
                    <div className="space-y-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                          <Anchor className="h-4 w-4 text-purple-600" /> 2. SRU Terpilih ({patternSruName})
                        </h3>
                        <button
                          type="button"
                          onClick={() => {
                            setMainMapToolMode('pan');
                            setPickSruMode(!pickSruMode);
                            setPickMode(false);
                          }}
                          className={`text-[10px] px-2 py-0.5 rounded font-bold transition ${
                            pickSruMode
                              ? 'bg-purple-600 text-white'
                              : 'bg-white border border-purple-300 text-purple-700 hover:bg-purple-100'
                          }`}
                        >
                          {pickSruMode ? 'Klik di Peta...' : 'Pilih Posisi di Peta'}
                        </button>
                      </div>

                      <div className="text-xs space-y-1.5 text-slate-700">
                        <div>
                          Pangkalan Asal: <strong>{patternSruRecord?.homeBaseName ?? '-'}</strong>
                        </div>
                        <div className="font-mono text-[11px] text-slate-600">
                          {patternSruRecord ? `${formatDMS(patternSruRecord.homeBasePos.lat, false)}, ${formatDMS(patternSruRecord.homeBasePos.lng, true)}` : '—'}
                        </div>
                        <div className="flex justify-between pt-1 text-[11px]">
                          <span>Kecepatan Transit: <strong>{patternSpeedKts || '—'} kts</strong></span>
                          <span>Kecepatan Cari: <strong>{patternSruRecord?.searchSpeedKts ?? 0} kts</strong></span>
                        </div>
                      </div>

                      <div className="bg-purple-50 p-2 rounded border border-purple-200 text-[11px] text-purple-900">
                        Sweep Width Area SRU Terpilih: <strong>{assetSummary.perAsset.find((result) => result.asset.id === patternSruRecord?.id)?.sweepAreaNm2.toFixed(2) || 0} NM²</strong>
                      </div>
                    </div>
                  </div>

                  {/* Summary of Total Sortie */}
                  <div className="p-3 bg-slate-900 text-white rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase tracking-wider">
                        Total Lintasan Pola Pencarian:
                      </span>
                      <span className="text-base font-mono font-bold text-emerald-400">
                        {searchPatternResult.totalDistanceNm.toFixed(1)} NM ({searchPatternResult.segments.length} Kaki Sapuan)
                      </span>
                    </div>
                    <div className="text-right text-[11px] font-mono text-slate-300">
                      {searchPatternResult.segments.length > 0 ? <>
                        <div>CSP: {formatDMS(csp.lat, false)}, {formatDMS(csp.lng, true)}</div>
                        <div>Exit: {formatDMS(exitPoint.lat, false)}, {formatDMS(exitPoint.lng, true)}</div>
                        <div>Heading: {patternOrientation?.toFixed(1)}°T</div>
                        <div>S: {trackSpacing > 0 ? `${trackSpacing.toFixed(2)} NM · ${patternSpacingSource}` : 'tidak dipakai'}</div>
                      </> : <div>Lengkapi input planner dan worksheet sumber untuk menggambar pola.</div>}
                    </div>
                  </div>
                </CardContent>
              </Card>
              <PrintCompanionMap
                title={`LAMPIRAN: PETA POLA PENCARIAN & TRACK (${searchPatternResult.name})`}
                worksheetRef={`POLA PENCARIAN (${searchPatternResult.code})`}
                lkp={lkp}
                mapCenter={mapCenter}
                markers={markers}
                lines={lines}
                polygons={polygons}
                circles={circles}
                searchAreaLength={searchAreaLength}
                searchAreaWidth={searchAreaWidth}
                searchAreaOrientation={searchAreaOrientation}
                ws1Ao={ws1Ao}
                driftDistance={datumResults?.driftDistance}
                E={datumResults?.E}
              />
            </TabsContent>

            {/* TAB: WORKSHEET 3 (POINT DATUM EFFORT ALLOCATION - STANDALONE) */}
            <TabsContent value="ws3" key={`ws3-tab-${caseVersion}-${tabClearVersions.ws3 ?? 0}`} className="mt-0 space-y-4">
              <Worksheet3
                key={`ws3-${caseVersion}`}
                searchResults={searchResults}
                E={datumResults?.E ?? 5.0}
                initialState={loadedInitialState?.ws3}
                onTrackSpacingChange={handleWS3TrackSpacingChange}
              />
              {datumResults && (
                <SearchPlanWorksheet
                  E={datumResults.E}
                  datumLeft={datumResults.datumLeft}
                  datumRight={datumResults.datumRight}
                  divergenceDistance={datumResults.divergenceDistance}
                  driftLeftDir={driftOrientationDeg}
                  aswDirFrom={asw.aswDirFrom}
                  onResults={setSearchResults}
                  onStateChange={setSearchState}
                  visibilityOverride={visibilityOverride}
                  initialState={loadedInitialState?.search}
                  key={`search-${caseVersion}`}
                />
              )}
            </TabsContent>

            {/* TAB: WORKSHEET 4 (LEEWAY DIVERGENCE EFFORT ALLOCATION - STANDALONE) */}
            <TabsContent value="ws4" key={`ws4-tab-${caseVersion}-${tabClearVersions.ws4 ?? 0}`} className="mt-0">
              <Worksheet4
                key={`ws4-${caseVersion}`}
                searchResults={searchResults}
                E={datumResults?.E ?? 5.0}
                divergenceDistance={datumResults?.divergenceDistance ?? 7.8}
                initialState={loadedInitialState?.ws4}
              />
            </TabsContent>

            {/* TAB: INTERCEPT CALCULATOR */}
            <TabsContent value="intercept" key={`intercept-tab-${caseVersion}-${tabClearVersions.intercept ?? 0}`} className="mt-0">
              <InterceptWorksheet
                key={`intercept-${caseVersion}-${interceptCaseVersion}`}
                initialInput={aiInterceptInput}
              />
            </TabsContent>

            {/* TAB: BRIEFING & RENOPS (PERBAN 3/2020) */}
            <TabsContent value="briefing-renops" key={`briefing-tab-${caseVersion}-${tabClearVersions['briefing-renops'] ?? 0}`} className="mt-0 space-y-6">
              {/* BANK DATA & GENERATOR DOKUMEN — Panduan Agent RENOPS/Briefing/De-Briefing */}
              <DocumentWorkbench
                lkp={lkp}
                isLkpSet={isLkpSet}
                datumResults={datumResults}
                searchResults={searchResults}
                asw={asw}
                awa={awa}
                ws2TrackSpacingNm={ws2TrackSpacing?.spacingNm ?? null}
                ws3TrackSpacingNm={
                  ws3TrackSpacing
                    ? (patternLandHeight !== null && ws3TrackSpacing.heights.includes(patternLandHeight)
                      ? ws3TrackSpacing.spacingByHeight[ws3TrackSpacing.heights.indexOf(patternLandHeight)]
                      : ws3TrackSpacing.spacingByHeight.find((s) => s !== null) ?? null)
                    : null
                }
                ws8TrackSpacingNm={ws8TrackSpacing?.spacingNm ?? null}
                assets={assets}
                pattern={{
                  type: patternType,
                  orientation: patternOrientationText,
                  environment: patternEnvironment,
                  worksheetSource: patternWorksheetSource,
                  trackLineLengthText: trackLineLengthText,
                }}
                worksheet1Fs={worksheet1Fs}
              />
              <BriefingForm
                key={`briefing-${caseVersion}`}
                lkp={lkp}
                datumResults={datumResults}
                searchResults={searchResults}
                aswDirFrom={asw.aswDirFrom}
                aswSpeed={asw.aswSpeed}
              />
              <div className="print-page-break">
                <RenopsForm
                  key={`renops-${caseVersion}`}
                  lkp={lkp}
                  datumResults={datumResults}
                  searchResults={searchResults}
                />
              </div>
              <PrintCompanionMap
                title="LAMPIRAN: PETA OPERASI SAR (BRIEFING & RENOPS)"
                worksheetRef="PERBAN 3/2020 BASARNAS"
                lkp={lkp}
                mapCenter={mapCenter}
                markers={markers}
                lines={lines}
                polygons={polygons}
                circles={circles}
                searchAreaLength={searchAreaLength}
                searchAreaWidth={searchAreaWidth}
                searchAreaOrientation={searchAreaOrientation}
                ws1Ao={ws1Ao}
                driftDistance={datumResults?.driftDistance}
                E={datumResults?.E}
              />
            </TabsContent>

            {/* TAB: HITUNG DASAR */}
            <TabsContent value="basic-calc" key={`basic-tab-${caseVersion}-${tabClearVersions['basic-calc'] ?? 0}`} className="mt-0">
              <BasicCalculation key={`calc-${caseVersion}`} />
            </TabsContent>
          </Tabs>
        </section>

        {/* Right Column: Interactive Map & Weather Panel & Mission Summary */}
        <aside className="lg:col-span-2 space-y-4 lg:sticky lg:top-4 lg:self-start print:hidden">
          {isLkpSet && <WeatherPanel
            lkp={lkp}
            driftIntervalHours={driftIntervalForWeather}
            onApplyAsw={(dirFrom, speed) =>
              setWindOverride({ dirFrom, speed, hours: driftIntervalForWeather, ts: Date.now() })
            }
            onApplyVisibility={(nm) => setVisibilityOverride({ nm, ts: Date.now() })}
            onApplySeaCurrent={(dir, speed) =>
              setSeaCurrentOverride({ dir, speed, ts: Date.now() })
            }
          />}

          {/* Interactive Sea Chart Card */}
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <CardHeader className="bg-slate-50 pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapIcon className="h-4 w-4 text-slate-600" /> Peta Laut & Alokasi Vektor
                </CardTitle>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMainMapToolMode('pan');
                      setPickMode((p) => !p);
                      setPickSruMode(false);
                    }}
                    className={`text-xs font-bold px-2.5 py-1 rounded shadow-2xs transition flex items-center gap-1 ${
                      pickMode
                        ? 'bg-emerald-600 text-white animate-pulse'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100'
                    }`}
                  >
                    <Compass className="h-3.5 w-3.5" />
                    {pickMode ? '◉ Klik Peta...' : 'Pilih LKP di Peta'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPrintA3Open(true)}
                    className="text-xs text-emerald-700 font-bold hover:underline flex items-center gap-1"
                  >
                    <Printer className="h-3 w-3" /> Cetak A3
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-2.5" aria-label="Alat peta Worksheet 1">
                <span className="mr-1 text-[11px] font-bold text-slate-700">Alat Peta Worksheet 1</span>
                <button type="button" disabled={pickMode || pickSruMode} onClick={() => setMainMapToolMode('pan')} aria-pressed={mainMapToolMode === 'pan'} className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs disabled:opacity-40 ${mainMapToolMode === 'pan' ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                  <MousePointer2 className="h-3.5 w-3.5" /> Geser / pilih
                </button>
                <button type="button" disabled={pickMode || pickSruMode} onClick={() => setMainMapToolMode((mode) => mode === 'drop' ? 'pan' : 'drop')} aria-pressed={mainMapToolMode === 'drop'} className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs disabled:opacity-40 ${mainMapToolMode === 'drop' ? 'border-rose-600 bg-rose-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                  <MapPinPlus className="h-3.5 w-3.5" /> {mainMapToolMode === 'drop' ? 'Klik peta untuk titik' : 'Taruh titik'}
                </button>
                <button type="button" disabled={pickMode || pickSruMode} onClick={() => setMainMapToolMode((mode) => mode === 'measure' ? 'pan' : 'measure')} aria-pressed={mainMapToolMode === 'measure'} className={`inline-flex items-center gap-1 rounded border px-2.5 py-1.5 text-xs disabled:opacity-40 ${mainMapToolMode === 'measure' ? 'border-red-600 bg-red-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                  <Ruler className="h-3.5 w-3.5" /> Ukur jarak
                </button>
                <button type="button" disabled={!selectedMainMapPointId} onClick={() => {
                  setMainMapDroppedPoints((points) => points.filter((point) => point.id !== selectedMainMapPointId));
                  setSelectedMainMapPointId(null);
                }} className="inline-flex items-center gap-1 rounded border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-rose-700 disabled:opacity-40">
                  <Trash2 className="h-3.5 w-3.5" /> Hapus titik terpilih
                </button>
                <button type="button" disabled={mainMapDroppedPoints.length === 0} onClick={() => {
                  const lastPoint = mainMapDroppedPoints[mainMapDroppedPoints.length - 1];
                  setMainMapDroppedPoints((points) => points.slice(0, -1));
                  if (selectedMainMapPointId === lastPoint?.id) setSelectedMainMapPointId(null);
                }} className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 disabled:opacity-40">
                  <Undo2 className="h-3.5 w-3.5" /> Urungkan titik terakhir
                </button>
                <button type="button" disabled={mainMapDroppedPoints.length === 0} onClick={() => {
                  setMainMapDroppedPoints([]);
                  setSelectedMainMapPointId(null);
                }} className="rounded border border-rose-300 bg-white px-2.5 py-1.5 text-xs text-rose-700 disabled:opacity-40">Bersihkan titik tambahan</button>
                <span className="ml-auto text-[10px] text-slate-500">{mainMapDroppedPoints.length} titik tambahan · {pickMode ? 'pilih LKP' : pickSruMode ? 'pilih pangkalan SRU' : mainMapToolMode === 'drop' ? 'klik peta untuk menaruh titik' : mainMapToolMode === 'measure' ? 'klik titik; klik ganda untuk hapus pengukuran' : 'mode geser aktif'}</span>
              </div>
              {mainMapDroppedPoints.length > 0 && <div className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-2.5 py-2">
                {mainMapDroppedPoints.map((point, index) => (
                  <button key={point.id} type="button" onClick={() => setSelectedMainMapPointId(point.id)} aria-pressed={selectedMainMapPointId === point.id} className={`rounded border px-2 py-1 text-[10px] ${selectedMainMapPointId === point.id ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                    Titik {index + 1}: {formatDMS(point.position.lat, false)} · {formatDMS(point.position.lng, true)}
                  </button>
                ))}
              </div>}
              {pickMode && (
                <div className="px-3 py-2 bg-emerald-600 text-white text-xs font-medium flex items-center justify-between">
                  <span>◉ Mode pilih LKP aktif — klik pada peta laut untuk menetapkan titik LKP</span>
                  <button
                    type="button"
                    onClick={() => { setPickMode(false); setMainMapToolMode('pan'); }}
                    className="text-emerald-100 hover:text-white underline"
                  >
                    Batal
                  </button>
                </div>
              )}
              {pickSruMode && (
                <div className="px-3 py-2 bg-purple-600 text-white text-xs font-medium flex items-center justify-between">
                  <span>◉ Mode pilih Pangkalan SRU — klik pada peta untuk menetapkan posisi pangkalan</span>
                  <button
                    type="button"
                    onClick={() => { setPickSruMode(false); setMainMapToolMode('pan'); }}
                    className="text-purple-100 hover:text-white underline"
                  >
                    Batal
                  </button>
                </div>
              )}

              <div className={pickMode ? 'ring-2 ring-emerald-500 ring-inset' : pickSruMode ? 'ring-2 ring-purple-500 ring-inset' : ''}>
                <SeaMapMount
                  center={mapCenter}
                  zoom={8}
                  markers={mainMapMarkers}
                  lines={lines}
                  polygons={polygons}
                  circles={circles}
                  height="460px"
                  pickMode={pickMode || pickSruMode || mainMapToolMode === 'drop'}
                  measureMode={mainMapToolMode === 'measure'}
                  preferenceKey="worksheet-main"
                  onMapClick={handleInteractiveMapClick}
                />
              </div>

              {/* Map Legend */}
              <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-semibold text-slate-800">Legenda:</span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" /> LKP
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block" /> Datum
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-amber-500 inline-block" /> Drift
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-emerald-600 inline-block" /> Search Area
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-4 border-t-2 inline-block" style={{ borderColor: SEARCH_PATTERN_COLORS[patternType] }} />
                  Search Pattern {searchPatternResult.segments.length ? `(${patternSruName})` : ''}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-purple-600 inline-block" /> Transit Go
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 bg-orange-500 inline-block" /> Transit Back
                </span>
              </div>
              {searchAreaCornerDescriptions.length > 0 && (
                <div className="px-3 py-2 bg-white border-t border-slate-200 text-[10px] leading-relaxed text-slate-700">
                  <strong className="text-slate-900">Koordinat sudut Search Area (A → B → C → D searah jarum jam):</strong>
                  {searchAreaCornerDescriptions.map((description) => <div key={description} className="font-mono">{description}</div>)}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Mission Summary Panel */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="bg-slate-50 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-600" /> Ringkasan Misi & Alokasi SAR
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-3 grid grid-cols-2 gap-2 text-xs">
              <SummaryItem
                label="AWA Aloft"
                value={awa.aswSpeed > 0 ? `${awa.aswDirFrom.toFixed(0)}°T / ${awa.aswSpeed.toFixed(1)} kt` : '—'}
              />
              <SummaryItem
                label="ASW Permukaan"
                value={asw.aswSpeed > 0 ? `${asw.aswDirFrom.toFixed(0)}°T / ${asw.aswSpeed.toFixed(1)} kt` : '—'}
              />
              <SummaryItem
                label="LKP Aktif"
                value={`${formatDMS(lkp.lat, false)}, ${formatDMS(lkp.lng, true)}`}
                accent
              />
              <SummaryItem
                label="Datum Kiri"
                value={datumResults ? `${formatDMS(datumResults.datumLeft.lat, false)}, ${formatDMS(datumResults.datumLeft.lng, true)}` : '—'}
              />
              <SummaryItem
                label="Jarak Drift"
                value={datumResults ? `${datumResults.driftDistance.toFixed(2)} NM` : '—'}
              />
              <SummaryItem
                label="Galat E"
                value={datumResults ? `${datumResults.E.toFixed(2)} NM` : '—'}
                accent
              />
              <SummaryItem
                label="Target Area Ao (WS 1)"
                value={`${ws1Ao.toFixed(0)} NM²`}
                accent
              />
              <SummaryItem
                label="Kapasitas Aset (Σ Ai)"
                value={`${assetSummary.totalSweepAreaNm2.toFixed(2)} NM²`}
                accent
              />
              <SummaryItem
                label="Status Kapasitas Sapuan"
                value={assets.length === 0 || !assetSummary.perAsset.some((result) => result.isValid) || ws1Ao <= 0 ? 'INPUT BELUM LENGKAP' : assetSummary.isSufficient ? 'MEMENUHI' : `DEFISIT (-${assetSummary.deficitAreaNm2.toFixed(2)} NM²)`}
                accent
              />
              <SummaryItem
                label="Coverage Kapasitas (Σ A / Ao)"
                value={assets.length === 0 || ws1Ao <= 0 ? '-' : `${(assetSummary.coverageRatio * 100).toFixed(2)}%`}
              />
            </CardContent>
          </Card>
        </aside>
      </main>

      {/* Print Map A3 Modal */}
      <PrintMapA3
        isOpen={isPrintA3Open}
        onClose={() => setIsPrintA3Open(false)}
        lkp={lkp}
        datumData={datumData}
        datumResults={datumResults}
        searchResults={searchResults}
        searchPatternSegments={searchPatternResult.segments}
        csp={csp}
        exitPoint={exitPoint}
        sruBase={primarySru.homeBasePos}
        sruName={primarySru.name}
        transitLines={assetTransitLines}
      />

      {/* Dialog Konfirmasi Bersihkan Semua Lembar Kerja */}
      {isClearConfirmOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 space-y-4 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center shrink-0">
                <Trash2 className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Bersihkan Seluruh Lembar Kerja?
                </h3>
                <p className="text-xs text-slate-500">
                  Reset data ke kondisi awal untuk soal/kasus baru
                </p>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
              Tindakan ini akan mengosongkan seluruh data kalkulasi di <strong>semua tab</strong> (AWA, ADW/LKP, ASW, Worksheet 1 Datum, WS 2, WS 8, Alokasi Aset SRU, Pola Pencarian, Briefing, Renops, dll.) sehingga lembar kerja siap dan bersih untuk menyelesaikan soal latihan berikutnya.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsClearConfirmOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition"
              >
                Ya, Bersihkan Semua Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Chat Panel */}
      <AIChatPanel
        isOpen={isAiChatOpen}
        onToggle={setIsAiChatOpen}
        onApplyASW={handleApplyASW}
        onApplyAWA={handleApplyAWA}
        onApplyLKP={handleApplyLKP}
        onApplyDatum={handleApplyDatum}
        onApplyWS2={handleApplyWS2}
        onApplyWS3={handleApplyWS3}
        onApplyWS4={handleApplyWS4}
        onApplyWS8={handleApplyWS8}
        onApplySearchPattern={handleApplySearchPattern}
        onApplyIntercept={handleApplyIntercept}
        onFocusWorksheet={(worksheet) => setActiveTab(worksheet === 'datum' ? 'ws1' : worksheet)}
      />

      <footer className="mt-auto bg-slate-900 text-slate-400 text-xs">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <p>
            Platform Operasional & Kalkulasi SAR Terpadu — Berdasarkan panduan operasi SAR & Peraturan No. 3 Tahun 2020.{' '}
            <span className="text-slate-300">
              Dilengkapi Worksheet 1, 2, 3, 4, 8, Papan Manuver Polar, Universal Plotting Sheet (UPS), Intercept Solver, Pola Pencarian & Penghitungan Alokasi Aset SRU.
            </span>
          </p>
        </div>
      </footer>
    </div>
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
