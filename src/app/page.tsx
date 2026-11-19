'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import Image from 'next/image';
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
  BookOpen,
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
  LogOut,
  Users,
  Trash2,
  MapPinPlus,
  MousePointer2,
  Ruler,
  Undo2,
  Maximize2,
  Minimize2,
  RefreshCw,
} from 'lucide-react';
import AWAWorksheet, {
  type AWAData,
  type AWAInitialState,
  type AWAObservation,
} from '@/components/sar/AWAWorksheet';
import type { AeroDriftInitialState } from '@/components/sar/AeronauticalDriftWorksheet';
import ASWWorksheet, {
  type ASWData,
  type ASWInitialState,
  type ASWObservation,
} from '@/components/sar/ASWWorksheet';
import { buildAswObservationsFromCase, toBasarnasTimeFormat } from '@/lib/sar/aswTime';
import DatumWorksheet, {
  type DatumData,
  type DatumResults,
  type DatumInitialState,
} from '@/components/sar/DatumWorksheet';
import DatumPositionCard from '@/components/sar/DatumPositionCard';
import SearchPlanWorksheet, {
  type SearchPlanResults,
  type SearchPlanInitialState,
} from '@/components/sar/SearchPlanWorksheet';
import type { Ws1Derived, Ws1Measured } from '@/components/sar/worksheets/Worksheet1';
import CaseManager from '@/components/sar/CaseManager';
import AusSarManualDialog from '@/components/sar/AusSarManualDialog';
import { TableRefContext, type TableRefRequest } from '@/components/sar/TableRefContext';
import ExportButtons from '@/components/sar/ExportButtons';
import CopyrightFooter from '@/components/sar/CopyrightFooter';
import WeatherPanel from '@/components/sar/WeatherPanel';
import { toast } from 'sonner';
import { buildSearchActionPlanData } from '@/lib/sar/searchActionPlan';
import {
  type LatLng,
  type Vector,
  computeAWA,
  computeASW,
  rectangleCorners,
  distanceNm,
  bearingDeg,
  computeWs1SearchArea,
  WS1_FS_OPTIONS,
  WS1_DEFAULT_DRIFT_ERROR_PERCENT,
} from '@/lib/sar/sarCalculations';
import { formatDMS } from '@/lib/sar/coordFormat';
import { computeDatumWs1, ws1DatumDtgUtc } from '@/lib/sar/datumWs1';
import type { MapMarker, MapLine, MapPolygon, MapCircle } from '@/components/sar/SeaMap';
import BasicCalculation from '@/components/sar/BasicCalculation';
import ChartDistanceGuide from '@/components/sar/chart-distance/ChartDistanceGuide';
import { selectiveWorkspaceContext, workflowPlanText, type ContextEntry } from '@/lib/sar/workspaceContext';
import SeaMapMount from '@/components/sar/SeaMapMount';
import { FullscreenToggleButton } from '@/components/sar/FullscreenToggleButton';
import { useFullscreen } from '@/hooks/use-fullscreen';

// Worksheet navigation and training tools
import ManeuveringBoard from '@/components/sar/ManeuveringBoard';
import type { BoardVector } from '@/lib/sar/maneuveringBoard';
import UPSPlotter from '@/components/sar/UPSPlotter';
import AdwUpsSheet from '@/components/sar/AdwUpsSheet';
import { PrintScopeController } from '@/components/sar/SheetPrintMenu';
import AeronauticalDriftWorksheet from '@/components/sar/AeronauticalDriftWorksheet';
import type { AeroDriftResult } from '@/lib/sar/aeroDriftCalculations';
import type { SetFieldsApplied } from '@/lib/ai/tools/setFields';
import InterceptWorksheet from '@/components/sar/InterceptWorksheet';
import type { InterceptInput } from '@/lib/sar/interceptCalculations';
import Worksheet1 from '@/components/sar/worksheets/Worksheet1';
import Worksheet2, { type Worksheet2InitialState } from '@/components/sar/worksheets/Worksheet2';
import Worksheet3, { type Worksheet3InitialState } from '@/components/sar/worksheets/Worksheet3';
import Worksheet4, { type Worksheet4InitialState } from '@/components/sar/worksheets/Worksheet4';
import Worksheet8, { type Worksheet8InitialState } from '@/components/sar/worksheets/Worksheet8';
import WorksheetSheetBar, { type WorksheetSheet } from '@/components/sar/worksheets/WorksheetSheetBar';
import BriefingForm from '@/components/sar/BriefingForm';
import RenopsForm from '@/components/sar/RenopsForm';
import DocumentWorkbench from '@/components/sar/DocumentWorkbench';
import AllWorksheetsView from '@/components/sar/AllWorksheetsView';
import PrintMapA3 from '@/components/sar/PrintMapA3';
import PrintCompanionMap from '@/components/sar/PrintCompanionMap';
import { printActiveWorksheetFit } from '@/lib/sar/printFit';
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
  type AssetAllocationCaseInput,
  assetDomain,
  calculateAssetAllocationSummary,
} from '@/lib/sar/assetAllocation';
import { deepEqualValue, firstFilledSnapshot, mergeAswSnapshot, hasFilledValue, describeRestoredCaseSections } from '@/lib/sar/stateSync';

const DEFAULT_CENTER: LatLng = { lat: 0, lng: 0 };

// === Lembar worksheet per-SRU (WS 2/3/8): 1 alut/SRU = 1 lembar ===

/** Normalisasi lembar worksheet yang dimuat dari kasus tersimpan (validasi bentuk).
 *  Kasus lama (satu objek ws2/ws3/ws8) dimigrasi menjadi satu lembar default. */
function normalizeLoadedSheets<T>(value: unknown, legacy: T | undefined): Array<WorksheetSheet<T>> {
  const raw = Array.isArray(value) ? value : [];
  const sheets = raw
    .filter((entry): entry is WorksheetSheet<T> =>
      !!entry && typeof entry === 'object'
      && typeof (entry as WorksheetSheet<T>).key === 'string'
      && typeof (entry as WorksheetSheet<T>).data === 'object' && (entry as WorksheetSheet<T>).data !== null)
    .map((entry) => ({
      key: entry.key,
      label: typeof entry.label === 'string' && entry.label.trim() !== '' ? entry.label : 'SRU',
      assetId: typeof entry.assetId === 'string' ? entry.assetId : null,
      data: entry.data ?? ({} as T),
    }));
  if (sheets.length > 0) return sheets;
  return [{ key: 'default', label: 'SRU 1', assetId: null, data: (legacy ?? {}) as T }];
}

/** Lembar baru: label dari nama aset bila terikat ke SRU, atau "SRU n" bila bebas. */
function appendWorksheetSheet<T>(prev: Array<WorksheetSheet<T>>, assetId: string | undefined, assets: SruAssetInput[]): Array<WorksheetSheet<T>> {
  const asset = assetId ? assets.find((a) => a.id === assetId) : undefined;
  const label = asset?.name?.trim() || `SRU ${prev.length + 1}`;
  return [...prev, {
    key: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    assetId: asset?.id ?? null,
    data: {} as T,
  }];
}
const SEARCH_PATTERN_COLORS: Record<SearchPatternType, string> = {
  PS: '#9a3412',
  CS: '#c026d3',
  SS: '#0d9488',
  VS: '#65a30d',
  TS: '#475569',
};
const SEARCH_CONNECTOR_COLOR = '#a16207';

export default function Home() {
  // Layar penuh kartu Peta Laut & Alokasi Vektor (kolom kanan).
  const { ref: petaLautFsRef, isFullscreen: petaLautFullscreen, toggle: togglePetaLautFullscreen } = useFullscreen<HTMLDivElement>();
  // AWA & ASW states
  // Data AWA yang di-report worksheet saat tab AWA aktif (authoritative saat user mengedit).
  const [awaWorksheet, setAwaWorksheet] = useState<AWAData>({ aswDirFrom: 0, aswSpeed: 0, isValid: false });
  const [aswLive, setAswLive] = useState<ASWData>({
    aswDirFrom: 0,
    aswSpeed: 0,
    aswErr: 0,
    aswdve: 0,
    totalHours: 0,
    distressTime: '',
  });

  const [aswState, setAswState] = useState<{
    observations: ASWObservation[];
    aswErr: number;
    distressTime?: string;
    datumTime?: string;
    obsIntervalMode?: '6h' | '3h';
    caseTitle?: string;
  }>({ observations: [], aswErr: 0 });
  const [datumState, setDatumState] = useState<DatumInitialState | null>(null);
  const [searchState, setSearchState] = useState<SearchPlanInitialState | null>(null);
  /** Draf edit manual worksheet ADW — dipertahankan antar remount tab agar hitungan tidak hilang. */
  const [aeroDraft, setAeroDraft] = useState<AeroDriftInitialState | null>(null);

  const [loadedInitialState, setLoadedInitialState] = useState<{
    awa?: AWAInitialState;
    aero?: AeroDriftInitialState;
    asw?: ASWInitialState;
    datum?: DatumInitialState;
    search?: SearchPlanInitialState;
    ws2?: Worksheet2InitialState;
    ws8?: Worksheet8InitialState;
    ws3?: Worksheet3InitialState;
    lkp?: LatLng;
  } | null>(null);

  // === Ringkasan ASW EFEKTIF (saling berkesinambungan antar worksheet) ===
  // TabsContent meng-unmount tab non-aktif: bila tab ASW belum pernah dibuka
  // setelah load kasus / apply AI, `aswLive` (hasil onDataChange worksheet)
  // masih nol dan Datum WS 1 menghitung arus angin dari angin 0 — salah.
  // Ringkasan ASW murni turunan observasi (computeASW, satu sumber rumus dengan
  // worksheet), jadi hitung ulang di level page dari mirror aswState yang
  // di-seed saat load kasus / apply AI dan diperbarui live oleh worksheet.
  // Hasilnya: perubahan observasi angin di ASW langsung mengalir ke Datum WS 1,
  // panduan pencarian, peta, dan panel cuaca tanpa harus membuka tab ASW.
  const asw = useMemo<ASWData>(() => {
    const obs = aswState.observations;
    if (obs.length === 0) return aswLive;
    const err = aswState.aswErr || aswLive.aswErr;
    const summary = computeASW(obs);
    return {
      aswDirFrom: summary.aswDirFrom,
      aswSpeed: Number(summary.aswSpeed.toFixed(2)),
      aswErr: err,
      aswdve: Number((err * 0.08).toFixed(2)),
      totalHours: summary.totalHours,
      distressTime: aswState.distressTime || aswLive.distressTime,
    };
  }, [aswLive, aswState]);


  // Marine Datum & Search results
  const [datumData, setDatumData] = useState<DatumData | null>(null);
  const [datumResults, setDatumResults] = useState<DatumResults | null>(null);
  /** Hasil internal DatumWorksheet untuk tampilan kartu Datum di luar worksheet. */
  const [datumDisplay, setDatumDisplay] = useState<DatumResults | null>(null);
  const [searchResults, setSearchResults] = useState<SearchPlanResults | null>(null);
  const [worksheet1Ao, setWorksheet1Ao] = useState(0);
  const [worksheet1Fs, setWorksheet1Fs] = useState(1.1);
  // Mirror pengukuran peta dari Worksheet 1 (jarak L/R terukur + persen de).
  // Dilaporkan Worksheet1 selagi tabnya terpasang; null saat unmount — nilai
  // lokal Worksheet 1 memang hilang dan kembali dihitung analitik.
  const [ws1Measured, setWs1Measured] = useState<Ws1Measured | null>(null);
  // === Lembar worksheet per-SRU (WS 2/3/8): 1 alut/SRU = 1 lembar.
  // Kasus dengan 1 fixed wing + 1 helikopter → Worksheet 2 berisi 2 lembar. ===
  const [ws2Sheets, setWs2Sheets] = useState<Array<WorksheetSheet<Worksheet2InitialState>>>([]);
  const [ws3Sheets, setWs3Sheets] = useState<Array<WorksheetSheet<Worksheet3InitialState>>>([]);
  const [ws8Sheets, setWs8Sheets] = useState<Array<WorksheetSheet<Worksheet8InitialState>>>([]);
  const [activeWs2Key, setActiveWs2Key] = useState('');
  const [activeWs3Key, setActiveWs3Key] = useState('');
  const [activeWs8Key, setActiveWs8Key] = useState('');
  // Track spacing hasil tiap lembar, dikunci ke key lembar pemiliknya.
  const [ws2TrackSpacings, setWs2TrackSpacings] = useState<Record<string, { platform: 'fixed-wing' | 'helicopter' | null; spacingNm: number; selection: string }>>({});
  const [ws3TrackSpacings, setWs3TrackSpacings] = useState<Record<string, { platform: 'fixed-wing' | 'helicopter' | null; heights: readonly number[]; spacingByHeight: Array<number | null> }>>({});
  const [ws8TrackSpacings, setWs8TrackSpacings] = useState<Record<string, { spacingNm: number; selection: string }>>({});

  // Controlled LKP
  const [lkp, setLkp] = useState<LatLng>({ lat: 0, lng: 0 });
  const [isLkpSet, setIsLkpSet] = useState(false);

  // SATU SUMBER gambar peta untuk rantai Worksheet 1: hitung rantai Panduan
  // langsung dari state halaman — SELALU segar, dari tab mana pun. Sebelumnya
  // ws1Map = ws1Derived ?? ws1Computed: ws1Derived hanya diperbarui selagi tab
  // WS 1 terpasang lalu MBEKU setelah tab ditutup (Radix unmount), sehingga
  // perubahan Fs dari tool AI (setWorksheet1Fs) maupun data ASW/Datum yang
  // baru tidak pernah menggambar ulang lingkaran R & kotak Ao di peta laut.
  const ws1Computed = useMemo<Ws1Derived>(() => {
    const hours = asw.totalHours && asw.totalHours > 0 ? asw.totalHours : (datumData?.driftInterval ?? 0);
    const r = computeDatumWs1({
      lkp,
      hours,
      seaCurrentDir: datumData?.seaCurrent.dir ?? 0,
      seaCurrentSpeed: datumData?.seaCurrent.mag ?? 0,
      windFrom: asw.aswSpeed > 0 ? asw.aswDirFrom : 0,
      windSpeed: asw.aswSpeed,
      leewayRate: datumResults?.lw?.objectType?.leewayRate ?? 0,
      leewayModifier: datumResults?.lw?.objectType?.leewayModifier ?? 0,
      leewayDivergenceDeg: datumResults?.lw?.divergenceAngle ?? 0,
      x: datumResults?.X ?? 0,
      y: datumResults?.Y ?? 0,
      fs: worksheet1Fs > 0 ? worksheet1Fs : undefined,
      searchNumber: 1,
      useWindCurrent: datumData?.useWindCurrent !== false,
    });
    // Override hasil ukur peta — logika identik Worksheet 1 (§4.7.61): bila
    // jarak terukur diisi di Worksheet 1, de(L)/de(R)/L–R mengikuti ukuran itu.
    const numericOverride = (value: string | undefined, fallback: number) =>
      value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
        ? Number(value)
        : fallback;
    const distL = numericOverride(ws1Measured?.left, r.dL);
    const distR = numericOverride(ws1Measured?.right, r.dR);
    const distLR = numericOverride(ws1Measured?.leftRight, r.LR);
    const dePercent = ws1Measured?.driftErrorPercent ?? WS1_DEFAULT_DRIFT_ERROR_PERCENT;
    const deL = distL * dePercent / 100;
    const deR = distR * dePercent / 100;
    const De = (deL + deR + distLR) / 2;
    const { E, R: RUp, Ao } = computeWs1SearchArea({
      De,
      X: datumResults?.X ?? 0,
      Y: datumResults?.Y ?? 0,
      fs: worksheet1Fs,
    });
    const useWindCurrent = datumData?.useWindCurrent !== false;
    const extraWarnings: string[] = [];
    if (hours <= 0) {
      extraWarnings.push('Hours of drift (a) = 0 — isi Total Hours (D) di worksheet ASW atau Drift Interval di Worksheet Datum.');
    }
    if (useWindCurrent && asw.aswSpeed > 0 && r.wcSpeed === 0) {
      extraWarnings.push('Arus angin (WC) = 0 — cek worksheet ASW.');
    }
    return {
      P1: r.P1,
      P2: r.P2,
      L: r.L,
      R: r.R,
      datumB: r.datumB,
      bearingAB: r.bearingAB,
      distanceAB: r.distanceAB,
      dL: r.dL,
      dR: r.dR,
      LR: r.LR,
      deL,
      deR,
      De,
      E,
      fs: worksheet1Fs,
      RUp,
      areaCircleNM2: Math.PI * RUp * RUp,
      areaSquareNM2: Ao,
      hours,
      datumDtg: ws1DatumDtgUtc(asw.distressTime, hours),
      useWindCurrent,
      lwClampedToZero: r.lwClampedToZero,
      warnings: [...r.warnings.filter((w) => !w.startsWith('Jika lingkaran radius')), ...extraWarnings],
      assumptions: r.assumptions,
    };
  }, [lkp, asw, datumData, datumResults, worksheet1Fs, ws1Measured]);
  const ws1Map: Ws1Derived = ws1Computed;
  const [pickMode, setPickMode] = useState<boolean>(false);
  const [pickSruMode, setPickSruMode] = useState<boolean>(false);
  const [mainMapToolMode, setMainMapToolMode] = useState<'pan' | 'drop' | 'measure'>('pan');
  const [mainMapDroppedPoints, setMainMapDroppedPoints] = useState<Array<{ id: string; position: LatLng }>>([]);
  const [selectedMainMapPointId, setSelectedMainMapPointId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('all-worksheets');
  // Deep-link pengujian/deep-link cetak: ?printTarget=...&printTab=ups
  // (di useEffect agar SSR & render pertama klien identik — bebas hydration mismatch)
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('printTab');
    if (requested) setActiveTab(requested);
  }, []);
  const [tabClearVersions, setTabClearVersions] = useState<Record<string, number>>({});
  const [isPrintA3Open, setIsPrintA3Open] = useState<boolean>(false);
  const [isAusSarManualOpen, setIsAusSarManualOpen] = useState<boolean>(false);
  /** Dokumen yang ditampilkan saat dialog Manual SAR AUS dibuka dari rujukan
   *  worksheet (mis. Table I-1/I-2 leeway di Worksheet 1 → 'appendix-i'). */
  const [ausSarManualInitialDoc, setAusSarManualInitialDoc] = useState<string | undefined>(undefined);
  /** Verifikasi nilai: klik nilai worksheet yang bersumber dari tabel appendix
   *  → dialog Manual terbuka pada tabel dirujuk (sel blinking) + override nilai. */
  const [tableRefRequest, setTableRefRequest] = useState<TableRefRequest | null>(null);
  const openTableRef = useCallback((req: TableRefRequest) => {
    setTableRefRequest(req);
    setAusSarManualInitialDoc(req.docId);
    setIsAusSarManualOpen(true);
  }, []);
  const handleAusSarManualOpenChange = useCallback((open: boolean) => {
    setIsAusSarManualOpen(open);
    if (!open) setTableRefRequest(null);
  }, []);
  const [isAiChatOpen, setIsAiChatOpen] = useState<boolean>(false);
  const [isClearConfirmOpen, setIsClearConfirmOpen] = useState<boolean>(false);

  // Role pengguna portal (dari cookie sesi, via /api/auth/me)
  const [userRole, setUserRole] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUserRole(d?.r ?? null))
      .catch(() => setUserRole(null));
  }, []);
  const [aiInterceptInput, setAiInterceptInput] = useState<InterceptInput | null>(null);
  const [interceptCaseVersion, setInterceptCaseVersion] = useState(0);

  // Aeronautical Drift State & auto-sync to LKP
  const [aeroResults, setAeroResults] = useState<AeroDriftResult | null>(null);
  const [adwSyncLkp, setAdwSyncLkp] = useState<boolean>(true);
  // Waktu distress turunan ADW (A.1 + B.7, format Basarnas) — otomatis mengisi
  // Distress Time worksheet ASW (aturan workflow: distress ASW = ADW A.1 + B.7).
  const [adwDerivedDistressTime, setAdwDerivedDistressTime] = useState<string | null>(null);
  // Bila true: saat hasil ADW valid, otomatis pindah ke tab UPS untuk melihat hasil gambaran.
  const [focusUpsOnAeroValid, setFocusUpsOnAeroValid] = useState<boolean>(false);

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

  // AWA hasil perhitungan langsung dari observasi. TabsContent meng-unmount tab non-aktif,
  // jadi pada alur AI beruntun (AWA → ADW → UPS) worksheet AWA bisa tidak sempat dirender;
  // dengan perhitungan di level page, angin AWA tetap mengalir ke ADW tanpa harus membuka tab AWA.
  const awaComputed = useMemo(() => {
    const summary = computeAWA(awaObservations, awaContext.distressAltFt ?? 0);
    return {
      aswDirFrom: summary.isValid ? summary.awaDirFrom : 0,
      aswSpeed: summary.isValid ? summary.awaSpeed : 0,
      vectorSumKts: summary.vectorSumKts,
      totalAltLossKft: summary.totalAltLossKft,
      directionDefined: summary.directionDefined,
      isValid: summary.isValid,
      rows: summary.rows,
    } satisfies AWAData;
  }, [awaObservations, awaContext.distressAltFt]);
  const awa = awaWorksheet.isValid ? awaWorksheet : awaComputed;
  const [caseVersion, setCaseVersion] = useState<number>(0);

  // === Persistence input manual worksheet (save case lengkap + recalculate) ===
  // Setiap worksheet melaporkan input-nya ke halaman via onStateChange; nilai
  // TERAKHIR dipulihkan sebagai initialState saat remount (pindah tab, bump
  // caseVersion, load kasus) sehingga editan manual tidak pernah hilang dan
  // worksheet terkait selalu menghitung ulang dari nilai terbaru.
  const [ws4State, setWs4State] = useState<Worksheet4InitialState | null>(null);
  const [interceptState, setInterceptState] = useState<InterceptInput | null>(null);
  const [briefingState, setBriefingState] = useState<Record<string, string> | null>(null);
  const [renopsState, setRenopsState] = useState<Record<string, string> | null>(null);

  // === SAR Workflow Memory & Context Manager ===
  // Workspace aktif = SarCase yang dimuat/di-save (CaseManager) — bukan entitas baru.
  const [activeSarCase, setActiveSarCase] = useState<{ id: string; title: string } | null>(null);
  const [wsContextEntries, setWsContextEntries] = useState<ContextEntry[]>([]);

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

  // Alur beruntun AWA → ADW → UPS: saat penghitungan ADW selesai (valid) dan permintaan
  // berasal dari AI, otomatis tampilkan tab UPS tempat hasil digambar.
  useEffect(() => {
    if (focusUpsOnAeroValid && aeroResults?.positionValid) {
      setFocusUpsOnAeroValid(false);
      setActiveTab('ups');
    }
  }, [focusUpsOnAeroValid, aeroResults]);

  /** Build state for saving — snapshot LENGKAP seluruh worksheet bernilai:
   *  input manual tiap worksheet (AWA/ADW/ASW/WS1/Datum/Search/WS2/WS3/WS8/WS4/
   *  Intercept/Briefing/Renops), aset, pola pencarian, overrides cuaca. */
  const buildState = useCallback(() => {
    return {
      title: '',
      state: {
        awa: { observations: awaObservations, ...awaContext },
        // ASW digabung per-bidang: mirror (worksheet terpasang) menang bila
        // berisi, bagian kosong diisi data awal (AI/kasus) — waktu distress/
        // datum sebelumnya hilang karena hanya ada di state lokal worksheet.
        asw: mergeAswSnapshot(aswState, loadedInitialState?.asw),
        // PHASE 3: draf input Aero Drift (ADW) ikut disimpan agar rantai
        // penerbangan ditching tidak hilang saat kasus dimuat ulang
        // (hasil dihitung ulang dari draf saat tab ADW dibuka — pola yang
        // sama dengan observasi AWA/ASW). Fallback ke data awal AI/kasus
        // bila tab ADW belum pernah dibuka (mirror draf masih kosong).
        aero: aeroDraft ?? loadedInitialState?.aero ?? undefined,
        // Datum/Search: mirror tab terpasang menang; bila tab belum pernah
        // dibuka, pakai data awal (AI/kasus) agar tidak tersimpan kosong.
        datum: firstFilledSnapshot(datumState, loadedInitialState?.datum) ?? {},
        search: firstFilledSnapshot(searchState, loadedInitialState?.search) ?? {},
        // Worksheet 1: Fs, drift error %, jarak terukur peta (input manual).
        ws1: { fs: worksheet1Fs, measured: ws1Measured ?? undefined },
        lkp,
        assets,
        patternType,
        patternAssetId,
        patternTurn,
        tsReturn,
        patternOrientationText,
        patternEnvironment,
        patternWorksheetSource,
        patternLandHeight,
        sectorAngleText,
        sectorLegLengthText,
        sectorLegCountText,
        trackLineLengthText,
        tsReturnOffsetText,
        // Overrides cuaca (WeatherPanel) + interval drift — memengaruhi hitungan
        // Datum/Search, wajib ikut tersimpan agar kasus termuat identik.
        weather: {
          windOverride,
          seaCurrentOverride,
          visibilityOverride,
          driftIntervalHours: driftIntervalForWeather,
        },
        adwSyncLkp,
        // Lembar worksheet per-SRU (1 alut = 1 lembar): sheet.data kini selalu
        // segar dari mirror onStateChange (input manual ikut tersimpan) +
        // hasil track spacing per lembar.
        ws2Sheets,
        ws3Sheets,
        ws8Sheets,
        ws2TrackSpacings,
        ws3TrackSpacings,
        ws8TrackSpacings,
        // Worksheet mandiri & dokumen: input lengkap ikut disimpan.
        ws4: ws4State ?? undefined,
        intercept: interceptState ?? (aiInterceptInput ?? undefined),
        briefing: briefingState ?? undefined,
        renops: renopsState ?? undefined,
      },
    };
  }, [awaObservations, awaContext, aswState, loadedInitialState, aeroDraft, datumState, searchState, worksheet1Fs, ws1Measured, lkp, assets, patternType, patternAssetId, patternTurn, tsReturn, patternOrientationText, patternEnvironment, patternWorksheetSource, patternLandHeight, sectorAngleText, sectorLegLengthText, sectorLegCountText, trackLineLengthText, tsReturnOffsetText, windOverride, seaCurrentOverride, visibilityOverride, driftIntervalForWeather, adwSyncLkp, ws2Sheets, ws3Sheets, ws8Sheets, ws2TrackSpacings, ws3TrackSpacings, ws8TrackSpacings, ws4State, interceptState, aiInterceptInput, briefingState, renopsState]);

  // Fase 2 AI Copilot: snapshot state untuk tool server-side (get_state /
  // run_pipeline / validate_plan). Stabil per perubahan state — identitas
  // objek hanya berubah bila salah satu dependensi buildState berubah.
  const aiStateSnapshot = useMemo(() => buildState().state, [buildState]);

  /** Apply loaded state */
  const applyState = useCallback((state: Record<string, unknown>) => {
    const awa = (state.awa ?? {}) as AWAInitialState;
    const asw = (state.asw ?? {}) as ASWInitialState;
    // PHASE 3: pulihkan draf ADW (aero) — hasil dihitung ulang saat tab dibuka.
    const aeroLoaded = (state.aero ?? undefined) as AeroDriftInitialState | undefined;
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
    if (state.patternTurn === 'right' || state.patternTurn === 'left') setPatternTurn(state.patternTurn);
    if (typeof state.tsReturn === 'boolean') setTsReturn(state.tsReturn);

    // Worksheet 1: pulihkan Fs + drift error % + jarak terukur (input manual);
    // tanpa nilai tersimpan kembali ke default (1.1 / null).
    const ws1Saved = (state.ws1 ?? {}) as { fs?: unknown; measured?: Ws1Measured | null };
    setWorksheet1Ao(0);
    setWorksheet1Fs(typeof ws1Saved.fs === 'number' && Number.isFinite(ws1Saved.fs) && ws1Saved.fs > 0 ? ws1Saved.fs : 1.1);
    const measuredSaved = ws1Saved.measured;
    setWs1Measured(
      measuredSaved && typeof measuredSaved === 'object'
      && typeof measuredSaved.left === 'string' && typeof measuredSaved.right === 'string'
      && typeof measuredSaved.leftRight === 'string' && typeof measuredSaved.driftErrorPercent === 'number'
        ? { left: measuredSaved.left, right: measuredSaved.right, leftRight: measuredSaved.leftRight, driftErrorPercent: measuredSaved.driftErrorPercent }
        : null,
    );
    if (assetsLoaded && Array.isArray(assetsLoaded)) setAssets(assetsLoaded);

    // Overrides cuaca + interval drift + sinkronisasi ADW→LKP (ikut kasus).
    const weatherSaved = (state.weather ?? {}) as {
      windOverride?: { dirFrom: number; speed: number; hours: number; ts: number } | null;
      seaCurrentOverride?: { dir: number; speed: number; ts: number } | null;
      visibilityOverride?: { nm: number; ts: number } | null;
      driftIntervalHours?: number;
    };
    setWindOverride(weatherSaved.windOverride ?? null);
    setSeaCurrentOverride(weatherSaved.seaCurrentOverride ?? null);
    setVisibilityOverride(weatherSaved.visibilityOverride ?? null);
    setDriftIntervalForWeather(typeof weatherSaved.driftIntervalHours === 'number' && Number.isFinite(weatherSaved.driftIntervalHours) ? weatherSaved.driftIntervalHours : 6);
    if (typeof state.adwSyncLkp === 'boolean') setAdwSyncLkp(state.adwSyncLkp);

    // Lembar worksheet per-SRU: muat array lembar tersimpan; kasus lama (satu
    // objek ws2/ws3/ws8) dimigrasi menjadi satu lembar default.
    const ws2SheetsLoaded = normalizeLoadedSheets<Worksheet2InitialState>(state.ws2Sheets, state.ws2 as Worksheet2InitialState | undefined);
    const ws3SheetsLoaded = normalizeLoadedSheets<Worksheet3InitialState>(state.ws3Sheets, state.ws3 as Worksheet3InitialState | undefined);
    const ws8SheetsLoaded = normalizeLoadedSheets<Worksheet8InitialState>(state.ws8Sheets, state.ws8 as Worksheet8InitialState | undefined);
    setWs2Sheets(ws2SheetsLoaded);
    setWs3Sheets(ws3SheetsLoaded);
    setWs8Sheets(ws8SheetsLoaded);
    setActiveWs2Key(ws2SheetsLoaded[0]?.key ?? '');
    setActiveWs3Key(ws3SheetsLoaded[0]?.key ?? '');
    setActiveWs8Key(ws8SheetsLoaded[0]?.key ?? '');
    setWs2TrackSpacings((state.ws2TrackSpacings && typeof state.ws2TrackSpacings === 'object' ? state.ws2TrackSpacings : {}) as Record<string, { platform: 'fixed-wing' | 'helicopter' | null; spacingNm: number; selection: string }>);
    setWs3TrackSpacings((state.ws3TrackSpacings && typeof state.ws3TrackSpacings === 'object' ? state.ws3TrackSpacings : {}) as Record<string, { platform: 'fixed-wing' | 'helicopter' | null; heights: readonly number[]; spacingByHeight: Array<number | null> }>);
    setWs8TrackSpacings((state.ws8TrackSpacings && typeof state.ws8TrackSpacings === 'object' ? state.ws8TrackSpacings : {}) as Record<string, { spacingNm: number; selection: string }>);

    // ADW: muat draf dari kasus, atau bersihkan bila kasus tidak memilikinya
    // (hindari kebocoran data antarkasus). Hasil lama tidak dibawa — dihitung
    // ulang dari draf oleh worksheet saat tab ADW dibuka.
    if (aeroLoaded && typeof aeroLoaded === 'object') {
      setAeroDraft(aeroLoaded);
      setAeroResults(null);
    } else {
      setAeroDraft(null);
      setAeroResults(null);
    }

    setLoadedInitialState({ awa, asw, aero: aeroLoaded, datum, search, lkp: lkpLoaded });
    setAwaContext({ distressAltFt: awa.distressAltFt, forecastSource: awa.forecastSource, forecastValidTime: awa.forecastValidTime });
    if (lkpLoaded) setLkp(lkpLoaded);

    // Seed mirror page-level dari snapshot kasus. TabsContent meng-unmount tab
    // non-aktif — tanpa seed ini, simpan ulang kasus yang baru dimuat (tanpa
    // membuka setiap tab) mengosongkan worksheet yang tidak pernah terpasang,
    // dan worksheet hilir (Datum WS 1) menghitung dari angin/observasi nol.
    setAwaObservations(Array.isArray(awa.observations) ? awa.observations : []);
    setAswState({
      observations: Array.isArray(asw.observations) ? asw.observations : [],
      aswErr: typeof asw.aswErr === 'number' ? asw.aswErr : 0,
      distressTime: asw.distressTime,
      datumTime: asw.datumTime,
      obsIntervalMode: asw.obsIntervalMode,
      caseTitle: asw.caseTitle,
    });
    setDatumState(hasFilledValue(datum) ? datum : null);
    setSearchState(hasFilledValue(search) ? search : null);

    // Worksheet mandiri & dokumen: pulihkan input tersimpan (null bila kasus
    // tidak memilikinya — hindari kebocoran data antarkasus).
    const ws4Saved = state.ws4 as Worksheet4InitialState | undefined;
    setWs4State(ws4Saved && typeof ws4Saved === 'object' ? ws4Saved : null);
    const interceptSaved = state.intercept as InterceptInput | undefined;
    setInterceptState(
      interceptSaved && typeof interceptSaved === 'object' && interceptSaved.target && interceptSaved.sru
        ? interceptSaved
        : null,
    );
    setAiInterceptInput(null);
    const briefingSaved = state.briefing as Record<string, string> | undefined;
    setBriefingState(briefingSaved && typeof briefingSaved === 'object' ? briefingSaved : null);
    const renopsSaved = state.renops as Record<string, string> | undefined;
    setRenopsState(renopsSaved && typeof renopsSaved === 'object' ? renopsSaved : null);

    // Info kelengkapan kasus: kasus versi lama (sebelum save-case lengkap)
    // hanya menyimpan sebagian worksheet — beri tahu pengguna bagian mana
    // yang berisi dan mana yang tidak ada di kasus, agar tidak bingung saat
    // membuka tab yang tetap kosong.
    const restored = describeRestoredCaseSections(state);
    if (restored.filled.length === 0) {
      toast.warning('Kasus dimuat tanpa data worksheet (kasus lama/kosong) — semua lembar tetap kosong.');
    } else if (restored.empty.length > 0) {
      toast.info(
        `Kasus dimuat — bagian berisi: ${restored.filled.join(', ')}. Tidak tersimpan di kasus ini: ${restored.empty.join(', ')}.`,
        { duration: 8000 },
      );
    }

    setCaseVersion((v) => v + 1);
  }, []);

  // Lembar worksheet per-SRU selalu minimal satu: seed lembar default dari data
  // kasus yang dimuat (atau kosong) agar tab WS 2/3/8 tidak pernah tanpa lembar.
  useEffect(() => {
    setWs2Sheets((prev) => prev.length > 0 ? prev : [{ key: 'default', label: 'SRU 1', assetId: null, data: loadedInitialState?.ws2 ?? {} }]);
    setWs3Sheets((prev) => prev.length > 0 ? prev : [{ key: 'default', label: 'SRU 1', assetId: null, data: loadedInitialState?.ws3 ?? {} }]);
    setWs8Sheets((prev) => prev.length > 0 ? prev : [{ key: 'default', label: 'SRU 1', assetId: null, data: loadedInitialState?.ws8 ?? {} }]);
  }, [loadedInitialState]);

  // --- SAR Workflow Memory: muat konteks, snapshot, catat percakapan ---
  // Konteks workspace dimuat saat workspace aktif berpindah (isolasi antar workspace).
  useEffect(() => {
    if (!activeSarCase) { setWsContextEntries([]); return; }
    let cancelled = false;
    fetch(`/api/workspace-context?caseId=${encodeURIComponent(activeSarCase.id)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d) => { if (!cancelled) setWsContextEntries((d.entries ?? []) as ContextEntry[]); })
      .catch(() => { /* konteks opsional — jangan blokir aplikasi */ });
    return () => { cancelled = true; };
  }, [activeSarCase]);

  // Blok konteks selektif untuk AI: prioritas entry terstruktur CURRENT,
  // STALE hanya peringatan + rencana tahapan (bukan seluruh DB/riwayat).
  const workspaceContextBlock = useMemo(() => {
    if (!activeSarCase) return undefined;
    const retrieval = selectiveWorkspaceContext(wsContextEntries, activeSarCase.id);
    const plan = workflowPlanText(wsContextEntries, activeSarCase.id);
    const warn = retrieval.staleWarnings.length ? `\n\n${retrieval.staleWarnings.join('\n')}` : '';
    return `${retrieval.block}\n\n${plan}${warn}`;
  }, [activeSarCase, wsContextEntries]);

  // Simpan snapshot state aplikasi → konteks workspace (versi baru hanya bila input berubah).
  const handleSaveWorkspaceSnapshot = useCallback(async (): Promise<boolean> => {
    if (!activeSarCase) return false;
    try {
      const payload = buildState();
      if (!payload) return false;
      const res = await fetch('/api/workspace-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId: activeSarCase.id, action: 'snapshot', state: payload.state }),
      });
      if (!res.ok) return false;
      const d = await res.json();
      setWsContextEntries((d.entries ?? []) as ContextEntry[]);
      return true;
    } catch {
      return false;
    }
  }, [activeSarCase, buildState]);

  // Catat keputusan/koreksi/konfirmasi pengguna ke konteks (category E — bukan sumber nilai).
  const handleLogConversation = useCallback((kind: 'decision' | 'correction' | 'pending-question' | 'approved-action' | 'note', text: string) => {
    if (!activeSarCase) return;
    fetch('/api/workspace-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: activeSarCase.id, action: 'conversation', kind, text }),
    }).catch(() => { /* pencatatan percakapan opsional */ });
  }, [activeSarCase]);

  /** Clear all worksheets and reset entire state to clean initial condition */
  const handleClearAll = useCallback(() => {
    // Reset AWA & ASW
    setAwaWorksheet({ aswDirFrom: 0, aswSpeed: 0 });
    setAswLive({ aswDirFrom: 0, aswSpeed: 0, aswErr: 0, aswdve: 0, totalHours: 0, distressTime: '' });
    setAswState({ observations: [], aswErr: 0 });
    setAwaObservations([]);
    setAwaContext({ distressAltFt: 0 });
    setAswState({ observations: [], aswErr: 0 });

    // Reset Datum & Search
    setDatumData(null);
    setDatumResults(null);
    setSearchResults(null);
    setWorksheet1Ao(0);
    setWorksheet1Fs(0);
    setWs1Measured(null);
    // Lembar per-SRU kembali ke satu lembar default kosong
    setWs2Sheets([{ key: 'default', label: 'SRU 1', assetId: null, data: {} }]);
    setWs3Sheets([{ key: 'default', label: 'SRU 1', assetId: null, data: {} }]);
    setWs8Sheets([{ key: 'default', label: 'SRU 1', assetId: null, data: {} }]);
    setActiveWs2Key('default');
    setActiveWs3Key('default');
    setActiveWs8Key('default');
    setWs2TrackSpacings({});
    setWs3TrackSpacings({});
    setWs8TrackSpacings({});
    setDatumState(null);
    setSearchState(null);

    // Reset persistence worksheet mandiri & dokumen (save case lengkap)
    setWs4State(null);
    setInterceptState(null);
    setBriefingState(null);
    setRenopsState(null);
    setLkp(DEFAULT_CENTER);
    setIsLkpSet(false);
    setAeroResults(null);
    setAeroDraft(null); // PHASE 3: bersihkan draf ADW juga
    setAdwSyncLkp(true);
    setFocusUpsOnAeroValid(false);
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
        setAwaWorksheet({ aswDirFrom: 0, aswSpeed: 0, isValid: false });
        setAwaObservations([]);
        setAwaContext({ distressAltFt: 0 });
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), awa: { observations: [], distressAltFt: 0, caseTitle: '-' } }));
        break;
      case 'aero':
        setAeroResults(null);
        setFocusUpsOnAeroValid(false);
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), aero: {} }));
        setLkp({ lat: 0, lng: 0 });
        setIsLkpSet(false);
        break;
      case 'ups':
        setLkp({ lat: 0, lng: 0 });
        setIsLkpSet(false);
        break;
      case 'asw':
        setAswLive({ aswDirFrom: 0, aswSpeed: 0, aswErr: 0, aswdve: 0, totalHours: 0, distressTime: '' });
    setAswState({ observations: [], aswErr: 0 });
        setAswState({ observations: [], aswErr: 0 });
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), asw: { observations: [], distressTime: '', datumTime: '', caseTitle: '-', aswErr: 0 } }));
        break;
      case 'ws1':
        setDatumData(null);
        setDatumResults(null);
        setSearchResults(null);
        setWorksheet1Ao(0);
        setWorksheet1Fs(0);
        setWs1Measured(null);
        setDatumState(null);
        setSearchState(null);
        setLkp({ lat: 0, lng: 0 });
        setIsLkpSet(false);
        setLoadedInitialState((prev) => ({ ...(prev ?? {}), datum: {}, search: {}, lkp: { lat: 0, lng: 0 } }));
        break;
      case 'ws2':
        setWs2TrackSpacings({});
        setPatternWorksheetSource((source) => source === 'ws2' ? '' : source);
        setWs2Sheets([{ key: 'default', label: 'SRU 1', assetId: null, data: { caseTitle: '-', searchTas: 0, visibilityIndex: -1 } }]);
        setActiveWs2Key('default');
        break;
      case 'ws8':
        setWs8TrackSpacings({});
        setPatternWorksheetSource((source) => source === 'ws8' ? '' : source);
        setWs8Sheets([{ key: 'default', label: 'SRU 1', assetId: null, data: { caseTitle: '-', visibilityKm: '', vesselSpeedKts: 0 } }]);
        setActiveWs8Key('default');
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
        setWs3TrackSpacings({});
        setPatternWorksheetSource((source) => source === 'ws3' ? '' : source);
        setWs3Sheets([{ key: 'default', label: 'SRU 1', assetId: null, data: { caseTitle: '-', searchObject: '-', visibilityKm: 0, vegetationType: '-', isFatigue: null, searchTas: 0, hoursAvailable: 0, searchAreaNm2: 0 } }]);
        setActiveWs3Key('default');
        break;
      case 'ws4':
        setWs4State({ caseTitle: '-', searchDate: '-', callsign: '-', searchNo: '0', commenceUtc: '-', latitude: 0, longitude: 0, distressTimeUtc: '-', trList: [0, 0, 0, 0], fixErrors: [0, 0, 0, 0], yNavError: 0 });
        break;
      case 'intercept':
        setAiInterceptInput(null);
        setInterceptState(null);
        setInterceptCaseVersion((version) => version + 1);
        break;
      case 'briefing-renops':
        setBriefingState(null);
        setRenopsState(null);
        break;
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
    windData: { obsTime?: string; windDirFrom: number; windSpeed: number }[];
    caseTitle?: string;
  }) => {
    // Konversi format tanggal/waktu apa pun dari soal → Basarnas MMDD.HHMM Z
    // (aturan workflow); bila tidak bisa diparse, pakai nilai asli.
    const distressBasarnas = toBasarnasTimeFormat(data.distressTime);
    const datumBasarnas = toBasarnasTimeFormat(data.datumTime);
    const distressTime = distressBasarnas ? `${distressBasarnas} Z` : data.distressTime;
    const datumTime = datumBasarnas ? `${datumBasarnas} Z` : data.datumTime;

    // Waktu baris dihitung langsung di sini (parser liberal: "07.00 UTC",
    // "17 Nov 2026 07.00 UTC", "1117.0700 Z", ...). Jangan mengandalkan
    // regenerasi worksheet saja — kolom waktu ASW read-only, kalau kosong
    // pengguna tidak bisa memperbaikinya manual (bug kasus EXE FAKFAK 2026).
    const obsWithWind = buildAswObservationsFromCase(
      distressTime,
      datumTime,
      data.intervalMode,
      data.windData,
    );

    setLoadedInitialState((prev) => ({
      ...prev,
      asw: {
        distressTime,
        datumTime,
        obsIntervalMode: data.intervalMode,
        observations: obsWithWind,
        caseTitle: data.caseTitle,
      },
    }));
    // Seed mirror ASW dari data AI: tab ASW mungkin belum pernah dibuka saat
    // kasus disimpan — tanpa seed ini observasi + waktu ASW hilang di snapshot.
    // aswErr/aswdve manual pengguna dipertahankan (AI tidak mengirim nilai itu).
    setAswState((prev) => ({
      observations: obsWithWind,
      aswErr: prev.aswErr,
      distressTime,
      datumTime,
      obsIntervalMode: data.intervalMode,
      caseTitle: data.caseTitle,
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
    // Observasi & konteks langsung ke state page agar alur beruntun AI (AWA → ADW → UPS)
    // tetap mengalir walau tab AWA tidak sempat dirender (TabsContent meng-unmount tab non-aktif).
    setAwaObservations(data.windData ?? []);
    setAwaContext({ distressAltFt: data.distressAltFt, forecastSource: '', forecastValidTime: '' });
    setCaseVersion((v) => v + 1);
    setActiveTab('awa');
  }, []);

  const handleApplyLKP = useCallback((data: { lat: number; lng: number }) => {
    setLkp(data);
    setIsLkpSet(true);
  }, []);

  // AI menerapkan data ADW: worksheet ADW dihitung sampai selesai (angin AWA otomatis),
  // landing position menjadi LKP (sinkron otomatis), lalu hasil digambar di UPS.
  const handleApplyAeroDrift = useCallback((data: AeroDriftInitialState) => {
    setLoadedInitialState((prev) => ({ ...prev, aero: data }));
    // Draf ikut diisi dari data AI: bila tab ADW belum pernah dibuka saat
    // kasus disimpan, draf ADW tetap masuk snapshot (aeroDraft ?? aero awal).
    setAeroDraft(data);
    if (data.incidentPos && Number.isFinite(data.incidentPos.lat) && Number.isFinite(data.incidentPos.lng)) {
      setLkp({ lat: data.incidentPos.lat, lng: data.incidentPos.lng });
      setIsLkpSet(true);
    }
    setFocusUpsOnAeroValid(true);
    setCaseVersion((v) => v + 1);
    setActiveTab('aero');
  }, []);

  const handleApplyDatum = useCallback((data: {
    latitude?: number;
    lkp?: LatLng;
    lkpSource?: 'adw-landing' | 'explicit';
    driftInterval: number;
    seaCurrentDir: number;
    seaCurrentSpeed: number;
    seaCurrentErr?: number;
    leewayObjectId?: string;
    /** ID alat navigasi distress craft (Table J-1, mis. 'gps') — sudah dipetakan ke X oleh AIChatPanel. */
    xNavAid?: string;
    X?: number;
    /** ID alat navigasi SRU pencari (Table J-1, mis. 'gps') — sudah dipetakan ke Y oleh AIChatPanel. */
    yNavAid?: string;
    Y?: number;
    /** Safety factor (circle) hasil analisis soal: pencarian ke-1 → 1.1, ke-2 → 1.6, dst. */
    fs?: number;
  }) => {
    // Rantai penerbangan (ADW → Datum): bila LKP otomatis dari posisi ditching
    // hasil ADW, jangan timpa LKP di sini — sinkronisasi ADW (adwSyncLkp) yang
    // mengisinya setelah worksheet ADW selesai dihitung.
    if (data.lkpSource !== 'adw-landing' && data.lkp && Number.isFinite(data.lkp.lat) && Number.isFinite(data.lkp.lng)) {
      setLkp(data.lkp);
      setIsLkpSet(true);
    }
    if (data.fs !== undefined && (WS1_FS_OPTIONS as readonly number[]).includes(data.fs)) {
      setWorksheet1Fs(data.fs);
    }
    const datumInit: DatumInitialState = {
      ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
      driftInterval: data.driftInterval,
      seaCurrentDir: data.seaCurrentDir,
      seaCurrentSpeed: data.seaCurrentSpeed,
      seaCurrentErr: data.seaCurrentErr ?? 0,
      ...(data.leewayObjectId ? { leewayObjectId: data.leewayObjectId } : {}),
      X: data.X ?? 0,
      Y: data.Y ?? 0,
    };
    setLoadedInitialState((prev) => ({
      ...prev,
      datum: datumInit,
    }));
    // Seed mirror Datum: bila tab WS 1 belum pernah dibuka saat kasus
    // disimpan, input arus/leeway dari AI ikut tersimpan di snapshot.
    setDatumState(datumInit);
    setCaseVersion((version) => version + 1);
    setActiveTab('ws1');
  }, []);

  const handleApplyWS2 = useCallback((data: Worksheet2InitialState) => {
    // 1 alut = 1 lembar: perbarui lembar milik sruName bila sudah ada, selain
    // itu tambah lembar baru (terikat ke SRU daftar aset dengan platform cocok
    // yang belum punya lembar). Lembar SRU lain tidak tersentuh.
    const sruName = (data.sruName ?? '').trim();
    const existing = sruName !== ''
      ? ws2Sheets.find((sheet) => sheet.label.trim().toLowerCase() === sruName.toLowerCase())
      : undefined;
    const requiredAssetType = data.searchPlatform === 'helicopter' ? 'helicopter' : 'fixed-wing-aircraft';
    let focusAssetId: string | null = null;
    if (existing) {
      setWs2Sheets((prev) => prev.map((sheet) => (sheet.key === existing.key ? { ...sheet, data } : sheet)));
      setActiveWs2Key(existing.key);
      focusAssetId = existing.assetId;
    } else {
      const boundIds = new Set(ws2Sheets.map((sheet) => sheet.assetId).filter((id): id is string => id !== null));
      const asset = assets.find((a) => a.type === requiredAssetType && !boundIds.has(a.id));
      const newSheet: WorksheetSheet<Worksheet2InitialState> = {
        key: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: sruName || asset?.name?.trim() || `SRU ${ws2Sheets.length + 1}`,
        assetId: asset?.id ?? null,
        data,
      };
      focusAssetId = newSheet.assetId;
      setWs2Sheets((prev) => [...prev, newSheet]);
      setActiveWs2Key(newSheet.key);
    }
    setPatternEnvironment('water');
    setPatternWorksheetSource('ws2');
    const matchingAsset = (focusAssetId ? assets.find((asset) => asset.id === focusAssetId) : undefined)
      ?? assets.find((asset) => asset.type === requiredAssetType);
    setPatternAssetId(matchingAsset?.id ?? '__case-derived__');
    setCaseVersion((version) => version + 1);
    setActiveTab('ws2');
  }, [assets, ws2Sheets]);

  const handleApplyWS3 = useCallback((data: Worksheet3InitialState) => {
    // 1 alut = 1 lembar (lihat handleApplyWS2).
    const sruName = (data.sruName ?? '').trim();
    const existing = sruName !== ''
      ? ws3Sheets.find((sheet) => sheet.label.trim().toLowerCase() === sruName.toLowerCase())
      : undefined;
    const requiredAssetType = data.searchPlatform === 'helicopter' ? 'helicopter' : 'fixed-wing-aircraft';
    let focusAssetId: string | null = null;
    if (existing) {
      setWs3Sheets((prev) => prev.map((sheet) => (sheet.key === existing.key ? { ...sheet, data } : sheet)));
      setActiveWs3Key(existing.key);
      focusAssetId = existing.assetId;
    } else {
      const boundIds = new Set(ws3Sheets.map((sheet) => sheet.assetId).filter((id): id is string => id !== null));
      const asset = assets.find((a) => a.type === requiredAssetType && !boundIds.has(a.id));
      const newSheet: WorksheetSheet<Worksheet3InitialState> = {
        key: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: sruName || asset?.name?.trim() || `SRU ${ws3Sheets.length + 1}`,
        assetId: asset?.id ?? null,
        data,
      };
      focusAssetId = newSheet.assetId;
      setWs3Sheets((prev) => [...prev, newSheet]);
      setActiveWs3Key(newSheet.key);
    }
    setPatternEnvironment('land');
    setPatternWorksheetSource('ws3');
    const matchingAsset = (focusAssetId ? assets.find((asset) => asset.id === focusAssetId) : undefined)
      ?? assets.find((asset) => asset.type === requiredAssetType);
    setPatternAssetId(matchingAsset?.id ?? '__case-derived__');
    setCaseVersion((version) => version + 1);
    setActiveTab('ws3');
  }, [assets, ws3Sheets]);

  const handleApplyWS4 = useCallback((data: Worksheet4InitialState) => {
    setWs4State(data);
    setCaseVersion((version) => version + 1);
    setActiveTab('ws4');
  }, []);

  const handleApplyWS8 = useCallback((data: Worksheet8InitialState) => {
    // 1 alut = 1 lembar (lihat handleApplyWS2).
    const sruName = (data.sruName ?? '').trim();
    const existing = sruName !== ''
      ? ws8Sheets.find((sheet) => sheet.label.trim().toLowerCase() === sruName.toLowerCase())
      : undefined;
    let focusAssetId: string | null = null;
    if (existing) {
      setWs8Sheets((prev) => prev.map((sheet) => (sheet.key === existing.key ? { ...sheet, data } : sheet)));
      setActiveWs8Key(existing.key);
      focusAssetId = existing.assetId;
    } else {
      const boundIds = new Set(ws8Sheets.map((sheet) => sheet.assetId).filter((id): id is string => id !== null));
      const asset = assets.find((a) => a.type === data.sruType && !boundIds.has(a.id));
      const newSheet: WorksheetSheet<Worksheet8InitialState> = {
        key: `sheet-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: sruName || asset?.name?.trim() || `SRU ${ws8Sheets.length + 1}`,
        assetId: asset?.id ?? null,
        data,
      };
      focusAssetId = newSheet.assetId;
      setWs8Sheets((prev) => [...prev, newSheet]);
      setActiveWs8Key(newSheet.key);
    }
    setPatternEnvironment('');
    setPatternWorksheetSource('ws8');
    const matchingAsset = (focusAssetId ? assets.find((asset) => asset.id === focusAssetId) : undefined)
      ?? assets.find((asset) => asset.type === data.sruType);
    setPatternAssetId(matchingAsset?.id ?? '__case-derived__');
    setCaseVersion((version) => version + 1);
    setActiveTab('ws8');
  }, [assets, ws8Sheets]);

  const handleApplyAssetAllocation = useCallback((data: AssetAllocationCaseInput) => {
    // Worksheet Alokasi Aset: 1 alut = 1 lembar — tambahkan/perbarui aset milik
    // sruName saja; lembar SRU lain tidak tersentuh. AI mengklasifikasi udara/
    // laut lewat sruType dan menentukan pangkalan dari soal; bila soal tidak
    // memberi koordinat, AI meresolusi nama bandara/dermaga pada peta ONC dan
    // mengirim homeBaseLat/homeBaseLng hasil pembacaan chart (asumsi).
    const sruName = (data.sruName ?? '').trim();
    const isAir = assetDomain(data.sruType) === 'udara';
    const hasCoords = Number.isFinite(data.homeBaseLat) && Number.isFinite(data.homeBaseLng)
      && (data.homeBaseLat !== 0 || data.homeBaseLng !== 0);
    const preset = SRU_BASE_PRESETS.find((p) => p.name.toLowerCase() === data.homeBaseName.trim().toLowerCase());
    setAssets((prev) => {
      const existing = sruName !== ''
        ? prev.find((asset) => asset.name.trim().toLowerCase() === sruName.toLowerCase())
        : undefined;
      const next: SruAssetInput = {
        id: existing?.id ?? `sru-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: sruName || existing?.name?.trim() || 'SRU',
        type: data.sruType,
        homeBaseName: data.homeBaseName.trim(),
        homeBasePos: hasCoords
          ? { lat: data.homeBaseLat ?? 0, lng: data.homeBaseLng ?? 0 }
          : existing?.homeBasePos ?? preset?.pos ?? { lat: 0, lng: 0 },
        transitSpeedKts: data.transitSpeedKts ?? existing?.transitSpeedKts ?? 0,
        searchSpeedKts: data.searchSpeedKts ?? existing?.searchSpeedKts ?? 0,
        enduranceHours: data.enduranceHours ?? existing?.enduranceHours ?? 0,
        sweepWidthNm: data.sweepWidthNm ?? existing?.sweepWidthNm ?? 0,
        assignedSubArea: data.assignedSubArea ?? existing?.assignedSubArea ?? '-',
        airEngineType: isAir ? data.airEngineType ?? existing?.airEngineType : undefined,
        tafCondition: isAir ? data.tafCondition ?? existing?.tafCondition : undefined,
        maritimeTsfMins: !isAir ? data.maritimeTsfMins ?? existing?.maritimeTsfMins : undefined,
      };
      return existing
        ? prev.map((asset) => (asset.id === existing.id ? next : asset))
        : [...prev, next];
    });
    setCaseVersion((version) => version + 1);
    setActiveTab('asset-allocation');
  }, []);

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

  // === Operasi lembar worksheet per-SRU: tambah / hapus lembar ===
  const addWs2Sheet = useCallback((assetId?: string) => setWs2Sheets((prev) => appendWorksheetSheet(prev, assetId, assets)), [assets]);
  const addWs3Sheet = useCallback((assetId?: string) => setWs3Sheets((prev) => appendWorksheetSheet(prev, assetId, assets)), [assets]);
  const addWs8Sheet = useCallback((assetId?: string) => setWs8Sheets((prev) => appendWorksheetSheet(prev, assetId, assets)), [assets]);
  const removeWs2Sheet = useCallback((key: string) => {
    setWs2Sheets((prev) => (prev.length <= 1 ? prev : prev.filter((sheet) => sheet.key !== key)));
    setWs2TrackSpacings((prev) => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    setActiveWs2Key((prev) => (prev === key ? '' : prev));
  }, []);
  const removeWs3Sheet = useCallback((key: string) => {
    setWs3Sheets((prev) => (prev.length <= 1 ? prev : prev.filter((sheet) => sheet.key !== key)));
    setWs3TrackSpacings((prev) => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    setActiveWs3Key((prev) => (prev === key ? '' : prev));
  }, []);
  const removeWs8Sheet = useCallback((key: string) => {
    setWs8Sheets((prev) => (prev.length <= 1 ? prev : prev.filter((sheet) => sheet.key !== key)));
    setWs8TrackSpacings((prev) => { if (!(key in prev)) return prev; const next = { ...prev }; delete next[key]; return next; });
    setActiveWs8Key((prev) => (prev === key ? '' : prev));
  }, []);

  // Hasil Track Spacing dicatat per lembar pemiliknya (bukan satu slot global).
  const handleWS2TrackSpacingChange = useCallback((sheetKey: string, result: { platform: 'fixed-wing' | 'helicopter' | null; spacingNm: number; selection: string }) => {
    setWs2TrackSpacings((prev) => {
      const current = prev[sheetKey];
      // Bail out bila nilainya sama: prop onTrackSpacingChange adalah arrow
      // inline (identitas baru tiap render), tanpa guard ini effect worksheet
      // menembak ulang setiap render → loop update tak berhingga (React #185)
      // saat lembar dimuat dari kasus tersimpan.
      if (current && current.platform === result.platform && current.spacingNm === result.spacingNm && current.selection === result.selection) {
        return prev;
      }
      return { ...prev, [sheetKey]: result };
    });
  }, []);
  const handleWS3TrackSpacingChange = useCallback((sheetKey: string, result: { platform: 'fixed-wing' | 'helicopter' | null; heights: readonly number[]; spacingByHeight: Array<number | null> }) => {
    setWs3TrackSpacings((prev) => {
      const current = prev[sheetKey];
      const sameHeights = current
        && current.heights.length === result.heights.length
        && result.heights.every((value, index) => value === current.heights[index]);
      const sameSpacing = current
        && current.spacingByHeight.length === result.spacingByHeight.length
        && result.spacingByHeight.every((value, index) => value === current.spacingByHeight[index]);
      if (current && sameHeights && sameSpacing && current.platform === result.platform) {
        return prev;
      }
      return { ...prev, [sheetKey]: result };
    });
  }, []);
  const handleWS8TrackSpacingChange = useCallback((sheetKey: string, result: { spacingNm: number; selection: string }) => {
    setWs8TrackSpacings((prev) => {
      const current = prev[sheetKey];
      if (current && current.spacingNm === result.spacingNm && current.selection === result.selection) {
        return prev;
      }
      return { ...prev, [sheetKey]: result };
    });
  }, []);

  // === Mirror input manual lembar WS 2/3/8 → sheet.data ===
  // Worksheet melaporkan seluruh input-nya tiap perubahan (onStateChange);
  // tulis hanya bila isinya berubah (deepEqual) agar tidak loop re-render
  // (pola guard sama dengan handler Track Spacing di atas). sheet.data yang
  // selalu segar inilah yang disimpan buildState & dipulihkan saat load kasus.
  // Mirror state lengkap worksheet ASW → aswState (guard deepEqual mencegah
  // loop re-render karena identitas objek baru tiap laporan; pola sama dengan
  // mirror sheet WS 2/3/8 di bawah). Snapshot save case & ringkasan ASW efektif
  // (memo `asw`) membaca mirror ini.
  const handleAswMirror = useCallback((data: {
    observations: ASWObservation[];
    aswErr: number;
    distressTime?: string;
    datumTime?: string;
    obsIntervalMode?: '6h' | '3h';
    caseTitle?: string;
  }) => {
    setAswState((prev) => (deepEqualValue(prev as unknown as Record<string, unknown>, data as unknown as Record<string, unknown>)
      ? prev
      : {
        observations: data.observations,
        aswErr: data.aswErr,
        distressTime: data.distressTime,
        datumTime: data.datumTime,
        obsIntervalMode: data.obsIntervalMode,
        caseTitle: data.caseTitle,
      }));
  }, []);

  const handleWS2SheetData = useCallback((sheetKey: string, data: Worksheet2InitialState) => {
    setWs2Sheets((prev) => {
      const current = prev.find((sheet) => sheet.key === sheetKey);
      if (current && deepEqualValue(current.data as Record<string, unknown>, data as Record<string, unknown>)) {
        return prev;
      }
      return prev.map((sheet) => (sheet.key === sheetKey ? { ...sheet, data } : sheet));
    });
  }, []);
  const handleWS3SheetData = useCallback((sheetKey: string, data: Worksheet3InitialState) => {
    setWs3Sheets((prev) => {
      const current = prev.find((sheet) => sheet.key === sheetKey);
      if (current && deepEqualValue(current.data as Record<string, unknown>, data as Record<string, unknown>)) {
        return prev;
      }
      return prev.map((sheet) => (sheet.key === sheetKey ? { ...sheet, data } : sheet));
    });
  }, []);
  const handleWS8SheetData = useCallback((sheetKey: string, data: Worksheet8InitialState) => {
    setWs8Sheets((prev) => {
      const current = prev.find((sheet) => sheet.key === sheetKey);
      if (current && deepEqualValue(current.data as Record<string, unknown>, data as Record<string, unknown>)) {
        return prev;
      }
      return prev.map((sheet) => (sheet.key === sheetKey ? { ...sheet, data } : sheet));
    });
  }, []);

  // Recalculate manual: remount seluruh worksheet (bump caseVersion) sehingga
  // semua lembar menghitung ulang dari nilai input terbaru (manual maupun dari
  // worksheet lain). Nilai antar worksheet yang saling terhubung (angin ASW,
  // arus laut, Ao, Fs, track spacing, aset) sudah mengalir otomatis via props.
  const handleRecalculateAll = useCallback(() => {
    setCaseVersion((version) => version + 1);
    toast.success('Semua worksheet dihitung ulang dari nilai input terbaru.');
  }, []);

  const handleApplyIntercept = useCallback((data: InterceptInput) => {
    setAiInterceptInput(data);
    setInterceptCaseVersion((version) => version + 1);
    setActiveTab('intercept');
    setIsAiChatOpen(false);
    toast.success('Data kasus otomatis dimasukkan ke worksheet Intercept.');
    return true;
  }, []);

  // === Fase 2: tool `set_fields` (keputusan no.5) ============================
  // Isi beberapa field TERDAFTAR sekaligus. Satu mekanisme update: merge lewat
  // setter state yang SAMA dengan handler apply AI lain (tidak ada jalur kedua).
  // Validasi nama field/tipe/enum sudah dilakukan parseSetFieldsArgs di client
  // (registry src/lib/ai/tools/setFields.ts); di sini cukup merge + guard tipis.
  const handleApplySetFields = useCallback((applied: SetFieldsApplied): boolean => {
    const { worksheet, sruName, values } = applied;
    if (!values || Object.keys(values).length === 0) return false;
    const count = Object.keys(values).length;
    switch (worksheet) {
      case 'asw': {
        setLoadedInitialState((prev) => ({ ...prev, asw: { ...(prev?.asw ?? {}), ...values } }));
        setAswState((prev) => ({ ...prev, ...values } as typeof prev));
        break;
      }
      case 'awa': {
        setLoadedInitialState((prev) => ({ ...prev, awa: { ...(prev?.awa ?? {}), ...values } }));
        if (Array.isArray(values['observations'])) setAwaObservations(values['observations'] as AWAObservation[]);
        if (typeof values['distressAltFt'] === 'number' || typeof values['forecastSource'] === 'string' || typeof values['forecastValidTime'] === 'string') {
          setAwaContext((prev) => ({
            distressAltFt: typeof values['distressAltFt'] === 'number' ? values['distressAltFt'] as number : prev.distressAltFt,
            forecastSource: typeof values['forecastSource'] === 'string' ? values['forecastSource'] as string : prev.forecastSource,
            forecastValidTime: typeof values['forecastValidTime'] === 'string' ? values['forecastValidTime'] as string : prev.forecastValidTime,
          }));
        }
        break;
      }
      case 'aero': {
        setAeroDraft((prev) => ({ ...(prev ?? {}), ...values } as AeroDriftInitialState));
        setLoadedInitialState((prev) => ({ ...prev, aero: { ...(prev?.aero ?? {}), ...values } } as typeof prev));
        const pos = values['incidentPos'] as { lat?: number; lng?: number } | undefined;
        if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng)) {
          setLkp({ lat: pos.lat as number, lng: pos.lng as number });
          setIsLkpSet(true);
        }
        break;
      }
      case 'datum': {
        setDatumState((prev) => ({ ...(prev ?? {}), ...values } as DatumInitialState));
        setLoadedInitialState((prev) => ({ ...prev, datum: { ...(prev?.datum ?? {}), ...values } } as typeof prev));
        break;
      }
      case 'ws2':
      case 'ws3':
      case 'ws8': {
        const setter = worksheet === 'ws2' ? setWs2Sheets : worksheet === 'ws3' ? setWs3Sheets : setWs8Sheets;
        setter((prev) => {
          if (prev.length === 0) return prev;
          const needle = (sruName ?? (typeof values['sruName'] === 'string' ? values['sruName'] as string : '')).toLowerCase();
          const idx = needle
            ? prev.findIndex((sheet) => sheet.label.trim().toLowerCase() === needle
              || (typeof sheet.data.sruName === 'string' && sheet.data.sruName.toLowerCase() === needle))
            : 0;
          const target = idx >= 0 ? idx : 0;
          return prev.map((sheet, i) => i === target ? { ...sheet, data: { ...sheet.data, ...values } } : sheet);
        });
        break;
      }
      case 'ws4': {
        setWs4State((prev) => ({ ...(prev ?? {}), ...values } as Worksheet4InitialState));
        break;
      }
      case 'assets': {
        setAssets((prev) => {
          const name = (sruName ?? (typeof values['name'] === 'string' ? values['name'] as string : '')).toLowerCase();
          if (!name) return prev;
          return prev.map((asset) => asset.name.toLowerCase() === name.toLowerCase() ? { ...asset, ...values } : asset);
        });
        break;
      }
      case 'pattern': {
        for (const [key, value] of Object.entries(values)) {
          if (key === 'patternType' && typeof value === 'string') setPatternType(value as SearchPatternType);
          else if (key === 'patternTurn' && (value === 'right' || value === 'left')) setPatternTurn(value);
          else if (key === 'tsReturn' && typeof value === 'boolean') setTsReturn(value);
          else if (key === 'patternLandHeight' && typeof value === 'number') setPatternLandHeight(value);
          else if (key === 'patternOrientationText' && typeof value === 'string') setPatternOrientationText(value);
          else if (key === 'patternEnvironment' && (value === 'water' || value === 'land')) setPatternEnvironment(value);
          else if (key === 'sectorAngleText' && typeof value === 'string') setSectorAngleText(value);
          else if (key === 'sectorLegLengthText' && typeof value === 'string') setSectorLegLengthText(value);
          else if (key === 'sectorLegCountText' && typeof value === 'string') setSectorLegCountText(value);
          else if (key === 'trackLineLengthText' && typeof value === 'string') setTrackLineLengthText(value);
          else if (key === 'tsReturnOffsetText' && typeof value === 'string') setTsReturnOffsetText(value);
        }
        break;
      }
      case 'intercept': {
        setInterceptState((prev) => {
          const merged = { ...(prev ?? {}), ...values } as InterceptInput;
          return merged.target && merged.sru ? merged : prev;
        });
        setAiInterceptInput(null);
        break;
      }
      case 'lkp': {
        const lat = typeof values['lat'] === 'number' ? values['lat'] as number : Number.NaN;
        const lng = typeof values['lng'] === 'number' ? values['lng'] as number : Number.NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
        setLkp({ lat, lng });
        setIsLkpSet(true);
        break;
      }
      case 'briefing': {
        setBriefingState((prev) => ({ ...(prev ?? {}), ...values } as Record<string, string>));
        break;
      }
      case 'renops': {
        setRenopsState((prev) => ({ ...(prev ?? {}), ...values } as Record<string, string>));
        break;
      }
      default:
        return false;
    }
    setCaseVersion((v) => v + 1);
    toast.success(`AI mengisi ${count} field pada ${worksheet.toUpperCase()}${sruName ? ` (${sruName})` : ''}.`);
    return true;
  }, []);


  useEffect(() => {
    if (datumState?.driftInterval) {
      setDriftIntervalForWeather(datumState.driftInterval);
    }
  }, [datumState?.driftInterval]);

  // Luas Search Area dari Worksheet 1 (Ao) — diambil dari ws1Computed (satu
  // sumber gambar peta) agar SELALU segar: state worksheet1Ao hanya diperbarui
  // selagi tab WS 1 terpasang, jadi Ao/kotak hijau/pola akan beku bila Fs atau
  // data datum berubah dari jalur lain (tool AI, tab lain).
  const ws1Ao = ws1Computed.areaSquareNM2;

  // Titik Datum B (Panduan Datum Worksheet 1 §4.7.60): midpoint geodesik garis
  // L–R dari Worksheet 1; fallback ke rata-rata Datum Left/Right (K-13).
  const datumCenterPoint: LatLng = useMemo(() => {
    if (ws1Map) return ws1Map.datumB;
    if (!datumResults) return lkp;
    return {
      lat: (datumResults.datumLeft.lat + datumResults.datumRight.lat) / 2,
      lng: (datumResults.datumLeft.lng + datumResults.datumRight.lng) / 2,
    };
  }, [datumResults, lkp, ws1Map]);

  // Arah drift dari LKP ke titik Datum (°T)
  const driftOrientationDeg = useMemo(() => {
    if (!datumResults) return 90;
    const dist = distanceNm(lkp, datumCenterPoint);
    if (dist < 0.01) return 90;
    return bearingDeg(lkp, datumCenterPoint);
  }, [lkp, datumCenterPoint, datumResults]);

  // Heading pola (°T) otomatis disamakan dengan kemiringan kotak Search Area
  // (searah drift LKP → Datum) — pengguna tidak perlu menyalin manual dari
  // planner; setiap perubahan arah drift langsung mengikuti ke field ini.
  // Field tetap bisa diisi manual, tapi akan tersinkron ulang saat drift berubah.
  useEffect(() => {
    setPatternOrientationText(driftOrientationDeg.toFixed(1));
  }, [driftOrientationDeg]);

  // Ukuran sisi Search Area berbentuk persegi (Square: Panjang = Lebar = Sisi S).
  // Ao Worksheet 1 adalah sumber kanonik (dipakai WS 2/WS 8/Alokasi Aset) —
  // perubahan Fs di WS 1 langsung mengubah ukuran pola di peta laut. Ao WS 3
  // hanya fallback bila WS 1 belum menghitung (ws1Ao = 0).
  const searchSquareSide = useMemo(() => {
    if (ws1Ao > 0) {
      return Number(Math.sqrt(ws1Ao).toFixed(2));
    }
    if (searchResults?.Ao && searchResults.Ao > 0) {
      return Number(Math.sqrt(searchResults.Ao).toFixed(2));
    }
    if (searchResults?.searchAreaLength && searchResults?.searchAreaWidth) {
      return Number(Math.max(searchResults.searchAreaLength, searchResults.searchAreaWidth).toFixed(2));
    }
    return 0;
  }, [searchResults, ws1Ao]);

  // Search Area parameters (Persegi dengan kemiringan searah drift dari LKP ke Datum)
  const searchAreaCenter = ws1Ao > 0 ? datumCenterPoint : (searchResults?.searchAreaCenter ?? datumCenterPoint);
  const searchAreaLength = searchSquareSide;
  const searchAreaWidth = searchSquareSide;
  const searchAreaOrientation = driftOrientationDeg;
  const patternSruRecord = patternAssetId === '__case-derived__' ? undefined : assets.find((asset) => asset.id === patternAssetId) ?? assets[0];
  // Lembar aktif per worksheet (tampilan tab): lembar terpilih pengguna, atau lembar pertama.
  const shownWs2Key = ws2Sheets.some((sheet) => sheet.key === activeWs2Key) ? activeWs2Key : ws2Sheets[0]?.key ?? '';
  const shownWs3Key = ws3Sheets.some((sheet) => sheet.key === activeWs3Key) ? activeWs3Key : ws3Sheets[0]?.key ?? '';
  const shownWs8Key = ws8Sheets.some((sheet) => sheet.key === activeWs8Key) ? activeWs8Key : ws8Sheets[0]?.key ?? '';
  // Data lembar aktif WS 2/3/8 untuk salinan read-only di AllWorksheetsView
  // (tab default) — agar hasil apply AI terlihat sama dengan tab aslinya.
  const activeWs2Data = ws2Sheets.find((sheet) => sheet.key === shownWs2Key)?.data ?? null;
  const activeWs3Data = ws3Sheets.find((sheet) => sheet.key === shownWs3Key)?.data ?? null;
  const activeWs8Data = ws8Sheets.find((sheet) => sheet.key === shownWs8Key)?.data ?? null;
  // === Resolusi lembar per-SRU untuk tab Search Pattern ===
  // Pilih lembar yang cocok dengan SRU terpilih: ikatan assetId langsung
  // terlebih dahulu, lalu kecocokan jenis/platform, lalu lembar pertama
  // (turunan kasus). 1 alut = 1 lembar — tiap SRU memakai S dari lembar sendiri.
  const patternWs2Sheet = patternSruRecord
    ? ws2Sheets.find((sheet) => sheet.assetId === patternSruRecord.id)
      ?? ws2Sheets.find((sheet) => (sheet.data.searchPlatform === 'helicopter' ? 'helicopter' : sheet.data.searchPlatform === 'fixed-wing' ? 'fixed-wing-aircraft' : undefined) === patternSruRecord.type)
      ?? ws2Sheets[0]
    : ws2Sheets[0];
  const patternWs3Sheet = patternSruRecord
    ? ws3Sheets.find((sheet) => sheet.assetId === patternSruRecord.id)
      ?? ws3Sheets.find((sheet) => (sheet.data.searchPlatform === 'helicopter' ? 'helicopter' : sheet.data.searchPlatform === 'fixed-wing' ? 'fixed-wing-aircraft' : undefined) === patternSruRecord.type)
      ?? ws3Sheets[0]
    : ws3Sheets[0];
  const patternWs8Sheet = patternSruRecord
    ? ws8Sheets.find((sheet) => sheet.assetId === patternSruRecord.id)
      ?? ws8Sheets.find((sheet) => sheet.data.sruType === patternSruRecord.type)
      ?? ws8Sheets[0]
    : ws8Sheets[0];
  // Nilai track spacing efektif per worksheet — diambil dari lembar SRU terpilih.
  const ws2TrackSpacing = patternWs2Sheet ? ws2TrackSpacings[patternWs2Sheet.key] ?? null : null;
  const ws3TrackSpacing = patternWs3Sheet ? ws3TrackSpacings[patternWs3Sheet.key] ?? null : null;
  const ws8TrackSpacing = patternWs8Sheet ? ws8TrackSpacings[patternWs8Sheet.key] ?? null : null;
  // Spacing (S) per aset dari worksheet sumbernya sesuai routing Panduan Agent:
  // alat udara (fixed-wing/helikopter) → lembar WS 2, alat laut (kapal/RIB/Sea
  // Rider) → lembar WS 8. Dipakai Worksheet Alokasi Aset untuk mengisi Track
  // Spacing S per SRU otomatis. Urutan pencocokan lembar: (1) terikat assetId,
  // (2) platform/jenis alut sama, (3) bila domain itu punya tepat 1 lembar dan
  // tepat 1 aset (kasus tunggal, lembar default "SRU 1" tak terikat).
  const assetWorksheetSpacing = useMemo<Record<string, { spacingNm: number; source: 'ws2' | 'ws8' }>>(() => {
    const map: Record<string, { spacingNm: number; source: 'ws2' | 'ws8' }> = {};
    const countByDomain = (domain: 'udara' | 'laut') => assets.filter((a) => assetDomain(a.type) === domain).length;
    for (const asset of assets) {
      const isAir = assetDomain(asset.type) === 'udara';
      // Cabang WS 2 (udara) dan WS 8 (laut) dipisah agar tipe data lembar tetap
      // tepat (Worksheet2InitialState / Worksheet8InitialState).
      const sheet = isAir
        ? ws2Sheets.find((s) => s.assetId === asset.id)
          ?? ws2Sheets.find((s) => (s.data.searchPlatform === 'helicopter' ? 'helicopter' : s.data.searchPlatform === 'fixed-wing' ? 'fixed-wing-aircraft' : undefined) === asset.type)
          ?? (ws2Sheets.length === 1 && countByDomain('udara') === 1 ? ws2Sheets[0] : undefined)
        : ws8Sheets.find((s) => s.assetId === asset.id)
          ?? ws8Sheets.find((s) => s.data.sruType === asset.type)
          ?? (ws8Sheets.length === 1 && countByDomain('laut') === 1 ? ws8Sheets[0] : undefined);
      if (!sheet) continue;
      const ts = isAir ? ws2TrackSpacings[sheet.key] : ws8TrackSpacings[sheet.key];
      if (ts && ts.spacingNm > 0) {
        map[asset.id] = { spacingNm: ts.spacingNm, source: isAir ? 'ws2' : 'ws8' };
      }
    }
    return map;
  }, [assets, ws2Sheets, ws8Sheets, ws2TrackSpacings, ws8TrackSpacings]);
  const caseDerivedSruType = patternWorksheetSource === 'ws8'
    ? patternWs8Sheet?.data.sruType
    : patternWorksheetSource === 'ws2'
      ? patternWs2Sheet?.data.searchPlatform === 'helicopter' ? 'helicopter' : patternWs2Sheet?.data.searchPlatform === 'fixed-wing' ? 'fixed-wing-aircraft' : undefined
      : patternWorksheetSource === 'ws3'
        ? patternWs3Sheet?.data.searchPlatform === 'helicopter' ? 'helicopter' : patternWs3Sheet?.data.searchPlatform === 'fixed-wing' ? 'fixed-wing-aircraft' : undefined
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
  // Opsi SRU untuk bar lembar worksheet: udara → WS 2/WS 3, kapal/perahu → WS 8.
  const airAssetOptions = assets
    .filter((asset) => asset.type === 'helicopter' || asset.type === 'fixed-wing-aircraft')
    .map((asset) => ({ id: asset.id, label: asset.name?.trim() || caseSruTypeName[asset.type] || asset.type }));
  const vesselAssetOptions = assets
    .filter((asset) => asset.type === 'rescue-vessel' || asset.type === 'patrol-boat' || asset.type === 'rib' || asset.type === 'sea-rider')
    .map((asset) => ({ id: asset.id, label: asset.name?.trim() || caseSruTypeName[asset.type] || asset.type }));
  const patternSruName = patternSruRecord?.name ?? (patternSruType ? caseSruTypeName[patternSruType] ?? 'SRU dari analisis kasus' : 'SRU dari analisis kasus');
  const patternSpeedKts = patternSruRecord?.transitSpeedKts ?? 0;
  // Field kosong (mis. setelah reset kasus tanpa perubahan drift) tetap
  // mengikuti kemiringan kotak search area — konsisten dengan sinkronisasi
  // otomatis di atas.
  const patternOrientation = patternOrientationText.trim() === '' ? driftOrientationDeg : Number(patternOrientationText);

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
        lat: (datumData.start.lat + datumCenterPoint.lat * 2) / 3,
        lng: (datumData.start.lng + datumCenterPoint.lng * 2) / 3,
      };
    }
    return lkp;
  }, [datumData, datumResults, lkp, datumCenterPoint]);

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

  // Map markers: LKP, Titik L/R, Datum B, CSP, Exit Point, dan SRU Home Bases.
  // Label permanen dibuat singkat (permintaan pengguna); rincian koordinat
  // tetap tersedia pada tooltip hover & kotak koordinat cetak peta A3.
  const markers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = [
      {
        position: lkp,
        label: 'LKP',
        color: '#0ea5e9',
        isStart: true,
      },
    ];

    if (datumResults) {
      list.push({
        position: datumResults.datumLeft,
        label: 'L',
        color: '#f97316',
        isDatum: true,
      });
      list.push({
        position: datumResults.datumRight,
        label: 'R',
        color: '#f97316',
        isDatum: true,
      });
    }

    // Datum B — penanda silang merah menonjol di titik tengah garis L–R.
    // Label permanen di peta cukup "Datum" (permintaan pengguna); rincian
    // koordinat tetap tersedia pada tooltip saat hover.
    if (ws1Map) {
      list.push({
        position: ws1Map.datumB,
        label: 'Datum',
        color: '#dc2626',
        isDatum: true,
        cross: true,
        showLabel: true,
      });
    }

    // SRU Home Bases — dilewati bila posisi pangkalan belum valid (0,0):
    // pangkalan dari AI (bandara/dermaga via ONC) atau preset dipetakan di sini.
    assets.forEach((asset) => {
      if (asset.homeBasePos.lat === 0 && asset.homeBasePos.lng === 0) return;
      list.push({
        position: asset.homeBasePos,
        label: asset.name,
        color: assetDomain(asset.type) === 'udara' ? '#7c3aed' : '#0284c7',
      });
    });

    if (searchPatternResult.segments.length > 0) {
      list.push({
        position: csp,
        label: 'CSP',
        color: '#10b981',
        showLabel: true,
      });
      list.push({
        position: exitPoint,
        label: 'EXIT',
        color: '#f97316',
        showLabel: true,
      });
      searchPatternResult.waypoints.forEach((position, index) => {
        list.push({
          position,
          label: `WP ${index + 1}`,
          color: SEARCH_PATTERN_COLORS[patternType],
          sequence: index + 1,
        });
      });
    }

    return list;
  }, [lkp, datumResults, ws1Map, assets, csp, exitPoint, searchPatternResult.waypoints, searchPatternResult.segments.length, patternType]);

  const interactiveMapMarkers: MapMarker[] = useMemo(() => [
    ...markers,
    ...mainMapDroppedPoints.map((point, index): MapMarker => ({
      position: point.position,
      label: `T${index + 1}`,
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
      // Lembar tanpa pangkalan valid (0,0) belum punya rute transit.
      if (calc.asset.homeBasePos.lat === 0 && calc.asset.homeBasePos.lng === 0) return;
      const hasCsp = csp.lat !== 0 || csp.lng !== 0;
      const hasExit = exitPoint.lat !== 0 || exitPoint.lng !== 0;
      const col = palette[idx % palette.length];
      // Transit Go: Base -> CSP
      if (hasCsp) {
        list.push({
          from: calc.asset.homeBasePos,
          to: csp,
          color: col,
          label: `${calc.asset.name} Go - ${calc.transitGoDistanceNm.toFixed(1)} nm`,
        });
      }
      // Transit Back: Exit Point -> Base
      if (hasExit) {
        list.push({
          from: exitPoint,
          to: calc.asset.homeBasePos,
          color: col,
          dashed: true,
          label: `${calc.asset.name} Back - ${calc.transitBackDistanceNm.toFixed(1)} nm`,
        });
      }
    });
    return list;
  }, [assetSummary.perAsset, csp, exitPoint]);

  // Map lines: Drift, TWC, Search Pattern Tracks, Transit Go & Transit Back
  // Label vektor dibuat singkat (permintaan pengguna), contoh: "SC - 27°/25 nm".
  // Jarak dibulatkan: 25.0 → 25, 12.34 → 12.3.
  const fmtMapNm = (v: number) => {
    const rounded = Math.round(v * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };
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
      list.push({
        from: seg.from,
        to: seg.to,
        color,
        arrow: true,
        dashed: isConnector,
        weight: isConnector ? 1.5 : 2,
        opacity: 0.58,
        labelClassName: 'sar-pattern-label',
        label: `${isConnector ? 'Cross' : `Leg ${seg.legIndex}`} - ${bearing.toFixed(0)}°/${fmtMapNm(seg.distanceNm)} nm`,
      });
    });

    // Worksheet 1 vector components, each plotted in a distinct color. The
    // drift chain is drawn head-to-tail IN SEQUENCE from LKP: sea current →
    // wind current → leeway (L/R) → datum. The TWC resultant is intentionally
    // NOT drawn (permintaan pengguna) — its endpoint is still used as the
    // chain junction (TWC = SC + WC) so leeway starts exactly where the
    // water-current chain ends.
    if (datumData && datumResults) {
      const lkpPoint = datumData.start;
      const driftHours = Math.max(0, datumData.driftInterval);
      // Rantai Panduan Datum Worksheet 1 (bagian 5): A → P1 (arus laut, biru,
      // tebal) → P2 (arus angin, hijau, tebal) → L / R (leeway, oranye,
      // berpanah) + garis L–R (abu-abu) + d(L)/d(R) dari LKP (putus-putus).
      const downwindDir = (datumData.aswDirFrom + 180) % 360;
      // Titik rantai resmi dari Worksheet 1 (Panduan) bila tersedia.
      // Garis bantu ASW (downwind) dari LKP sengaja TIDAK digambar — bukan
      // bagian dari penggambaran peta (permintaan pengguna).
      const p1 = ws1Map.P1;
      const p2 = ws1Map.P2;
      const pointL = ws1Map.L;
      const pointR = ws1Map.R;

      list.push({
        from: lkpPoint,
        to: p1,
        color: '#2563eb',
        weight: 3,
        arrow: true,
        label: `SC - ${datumData.seaCurrent.dir.toFixed(0)}°/${fmtMapNm(datumData.seaCurrent.mag * driftHours)} nm`,
      });
      list.push({
        from: p1,
        to: p2,
        color: '#16a34a',
        weight: 3,
        arrow: true,
        label: `WC - ${(datumData.useWindCurrent === false ? downwindDir : datumResults.wc.wcSet).toFixed(0)}°/${fmtMapNm(ws1Map ? distanceNm(ws1Map.P1, ws1Map.P2) : datumResults.wc.wcDrift * driftHours)} nm`,
      });
      list.push({
        from: p2,
        to: pointL,
        color: '#f97316',
        weight: 3,
        arrow: true,
        label: `LWL - ${datumData.lwLeftDir.toFixed(0)}°/${fmtMapNm(datumData.lwSpeed * driftHours)} nm`,
      });
      list.push({
        from: p2,
        to: pointR,
        color: '#ea580c',
        weight: 3,
        arrow: true,
        label: `LWR - ${datumData.lwRightDir.toFixed(0)}°/${fmtMapNm(datumData.lwSpeed * driftHours)} nm`,
      });
      list.push({
        from: pointL,
        to: pointR,
        color: '#64748b',
        dashed: true,
        weight: 2,
        label: `L-R - ${fmtMapNm(distanceNm(pointL, pointR))} nm`,
      });
      list.push({
        from: lkpPoint,
        to: pointL,
        color: '#111827',
        dashed: true,
        label: `d(L) - ${bearingDeg(lkpPoint, pointL).toFixed(0)}°/${fmtMapNm(distanceNm(lkpPoint, pointL))} nm`,
      });
      list.push({
        from: lkpPoint,
        to: pointR,
        color: '#64748b',
        dashed: true,
        label: `d(R) - ${bearingDeg(lkpPoint, pointR).toFixed(0)}°/${fmtMapNm(distanceNm(lkpPoint, pointR))} nm`,
      });
    }

    // Add all SRU Transit Go & Back lines
    list.push(...assetTransitLines);

    return list;
  }, [
    datumData,
    datumResults,
    ws1Map,
    searchPatternResult.segments,
    patternType,
    trackSpacing,
    patternSruName,
    patternSpacingSource,
    assetTransitLines,
  ]);

  // Circles — sesuai tabel elemen Panduan Datum Worksheet 1 (bagian 5):
  //   • lingkaran de(L) & de(R) di titik L/R, radius de(L)/de(R) — oranye
  //     putus-putus, tipis (tooltip)
  //   • lingkaran De di datum B, radius De — abu titik-titik (tooltip)
  //   • lingkaran radius pencarian di datum B, radius R bulat — merah solid,
  //     isi transparan ±10%, label singkat "R - n nm"
  const circles: MapCircle[] = useMemo(() => {
    if (!datumResults) return [];
    const list: MapCircle[] = [];

    if (ws1Map) {
      const { L, R, datumB, deL, deR, De, RUp } = ws1Map;
      if (deL > 0) {
        list.push({
          center: L,
          radiusNm: deL,
          color: '#f97316',
          fillColor: '#f97316',
          fillOpacity: 0.02,
          weight: 1,
          dashArray: '6 5',
          label: `de(L) - ${fmtMapNm(deL)} nm`,
        });
      }
      if (deR > 0) {
        list.push({
          center: R,
          radiusNm: deR,
          color: '#f97316',
          fillColor: '#f97316',
          fillOpacity: 0.02,
          weight: 1,
          dashArray: '6 5',
          label: `de(R) - ${fmtMapNm(deR)} nm`,
        });
      }
      if (De > 0) {
        list.push({
          center: datumB,
          radiusNm: De,
          color: '#6b7280',
          fillColor: '#6b7280',
          fillOpacity: 0.015,
          weight: 1.5,
          dashArray: '1.5 5',
          label: `De - ${fmtMapNm(De)} nm`,
        });
      }
      if (RUp > 0) {
        list.push({
          center: datumB,
          radiusNm: RUp,
          color: '#dc2626',
          fillColor: '#dc2626',
          fillOpacity: 0.1,
          weight: 2.5,
          dashArray: null,
          label: `R - ${fmtMapNm(RUp)} nm`,
        });
      }
    }
    return list;
  }, [datumResults, ws1Map]);

  // Worksheet 1 area and the separate Worksheet 3 planning area are both squares,
  // oriented along the bearing from LKP to the datum midpoint.
  const polygons: MapPolygon[] = useMemo(() => {
    const list: MapPolygon[] = [];
    if (datumResults && ws1Ao > 0) {
      const side = Math.sqrt(ws1Ao);
      // Label teks "Worksheet 1 Search Area …" di tengah kotak dihapus
      // (permintaan pengguna) — kotaknya tetap digambar.
      list.push({
        points: rectangleCorners(datumCenterPoint, side, side, driftOrientationDeg),
        color: '#16a34a',
        fillColor: '#16a34a',
        fillOpacity: 0.12,
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
          label: `Worksheet 3 Search Area · persegi ${side.toFixed(2)} × ${side.toFixed(2)} NM\nAo = ${searchResults.Ao.toFixed(2)} NM² | Arah LKP → Datum = ${driftOrientationDeg.toFixed(1)}°T\nPOD = ${(searchResults.POD * 100).toFixed(2)}%`,
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
    // Nama area diambil dari warna garis karena label teks polygon WS1
    // sudah dihapus (permintaan pengguna): hijau = WS1, cyan = WS3.
    const areaName = area.color === '#16a34a' ? 'WS1' : area.color === '#0891b2' ? 'WS3' : `Area ${areaIndex + 1}`;
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
        // mag di papan diskalakan 5× agar muat di ring; badge memakai nilai asli (kt)
        badge: `${Math.round(datumResults.twc.twc.dir) % 360}°/${datumResults.twc.twc.mag} kt`,
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
    <TableRefContext.Provider value={openTableRef}>
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Header */}
      <header className="bg-slate-900 text-white shadow-md border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Image
                src="/images/logo-sar-basarnas.png"
                alt="Logo SAR Calculator Basarnas"
                width={72}
                height={72}
                className="w-18 h-18 object-contain logo-glow-pulse"
              />
              <div>
                <h1 className="text-base sm:text-lg font-bold tracking-tight">
                  Sistem Kalkulasi Search Area - SAR Planning
                </h1>
                <p className="text-xs text-slate-300">
                  Alur: AWA → ADW (LKP) → ASW → WS 1 (Ao) → WS 2 & 8 → Alokasi Aset SRU & Pola Pencarian
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Tombol Kelola Akun (khusus role developer) */}
              {userRole === 'developer' && (
                <a
                  href="/akun"
                  title="Tambah / kelola akun portal"
                  className="flex items-center gap-1.5 text-xs bg-orange-500/15 text-orange-300 hover:bg-orange-500/30 hover:text-orange-200 font-bold px-3 py-1.5 rounded-lg shadow transition-all border border-orange-400/30"
                >
                  <Users className="h-3.5 w-3.5" /> Kelola Akun
                </a>
              )}
              {/* Badge role pengguna (portal login) */}
              <span
                title="Masuk sebagai developer"
                className="flex items-center gap-1.5 text-xs bg-emerald-500/10 text-emerald-300 font-bold px-2.5 py-1.5 rounded-lg border border-emerald-400/30"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Developer
              </span>
              {/* Tombol Keluar (logout) */}
              <button
                type="button"
                onClick={async () => {
                  await fetch('/api/auth/logout', { method: 'POST' });
                  window.location.href = '/login';
                }}
                title="Keluar dari portal"
                className="flex items-center gap-1.5 text-xs bg-slate-700/60 hover:bg-red-600 text-slate-200 hover:text-white font-bold px-3 py-1.5 rounded-lg shadow transition-all border border-slate-500/40"
              >
                <LogOut className="h-3.5 w-3.5" /> Keluar
              </button>
              {/* Tombol AI Assistant */}
              <button
                type="button"
                onClick={() => setIsAiChatOpen((prev) => !prev)}
                className="flex items-center gap-1.5 text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold px-3 py-1.5 rounded-lg shadow transition-all border border-emerald-400/30"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-200" /> AI Assistant
              </button>
              {/* Tombol Manual SAR Australia (Combined + Appendix I/J/K — referensi tabel worksheet) */}
              <button
                type="button"
                onClick={() => setIsAusSarManualOpen(true)}
                title="Buka Australian SAR Manual (Combined + Appendix I Tables & Graphs, Appendix J Errors of Position, Appendix K Worksheets) — referensi nilai tabel untuk worksheet"
                className="flex items-center gap-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white font-bold px-3 py-1.5 rounded-lg shadow transition-colors border border-blue-400/40"
              >
                <BookOpen className="h-3.5 w-3.5" /> Manual SAR AUS
              </button>
              {/* Tombol Cetak Peta A3 */}
              <button
                type="button"
                onClick={() => setIsPrintA3Open(true)}
                className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-3 py-1.5 rounded-lg shadow transition-colors"
              >
                <Printer className="h-3.5 w-3.5" /> Cetak Peta A3
              </button>
              {/* Tombol Recalculate: hitung ulang seluruh worksheet dari nilai
                  input terbaru — nilai antar worksheet yang saling bersambung
                  (angin ASW, arus laut, Ao, Fs, track spacing, aset) sudah
                  diperbarui otomatis; tombol ini memaksa remount penuh. */}
              <button
                type="button"
                onClick={handleRecalculateAll}
                title="Hitung ulang seluruh worksheet dari nilai input terbaru (perubahan manual di satu worksheet otomatis diteruskan ke worksheet terkait)"
                className="flex items-center gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-1.5 rounded-lg shadow transition-colors border border-indigo-400/40"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Recalculate
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
              <CaseManager
                buildState={buildState}
                applyState={applyState}
                onActiveCaseChange={setActiveSarCase}
                activeCaseId={activeSarCase?.id ?? null}
              />
              <ExportButtons data={searchActionPlanData} caseTitle="SAR_Search_Action_Plan" />
              {/* Copyright pojok kanan bawah header (klik → modal hak cipta) */}
              <CopyrightFooter align="right" className="ml-auto py-0" />
            </div>
          </div>
        </div>
      </header>

      {/* Controller Print Mode lembar plotting (dukungan deep-link ?printTarget=...) */}
      <PrintScopeController />

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
                onOpenManualAppendix={() => {
                  setAusSarManualInitialDoc('appendix-i');
                  setIsAusSarManualOpen(true);
                }}
                searchResults={searchResults}
                ws1Ao={ws1Ao}
                onWorksheet1AoChange={setWorksheet1Ao}
                selectedFs={worksheet1Fs}
                aswDirFrom={asw.aswDirFrom}
                aswSpeed={asw.aswSpeed}
                aswDistressTime={asw.distressTime}
                aswTotalHours={asw.totalHours}
                awaDirFrom={awa.aswDirFrom}
                awaSpeed={awa.aswSpeed}
                csp={csp}
                exitPoint={exitPoint}
                assets={assets}
                onAssetsChange={setAssets}
                ws2Initial={activeWs2Data}
                ws3Initial={activeWs3Data}
                ws8Initial={activeWs8Data}
                /* Data live untuk lembar AWA/ASW/ADW di summary view + deteksi
                   "worksheet terpakai" agar cetak keseluruhan melewatkan lembar kosong. */
                awaState={{
                  observations: awaObservations,
                  distressAltFt: awaContext.distressAltFt,
                  forecastSource: awaContext.forecastSource,
                  forecastValidTime: awaContext.forecastValidTime,
                }}
                aswState={{ observations: aswState.observations, aswErr: aswState.aswErr }}
                aeroState={aeroDraft ?? loadedInitialState?.aero ?? null}
                aeroHasResults={aeroResults != null}
                ws1Measured={ws1Measured}
              />
            </TabsContent>

            {/* TAB 1: AWA + MANEUVERING BOARD */}
            <TabsContent value="awa" key={`awa-tab-${caseVersion}-${tabClearVersions.awa ?? 0}`} className="mt-0 space-y-4">
              <AWAWorksheet
                key={`awa-${caseVersion}`}
                onDataChange={setAwaWorksheet}
                onObservationsChange={setAwaObservations}
                onContextChange={setAwaContext}
                initialState={loadedInitialState?.awa}
              />
              <div className="print-companion-page">
                <ManeuveringBoard
                  key={`awa-mobo-${caseVersion}`}
                  printTargetId="mobo-awa"
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
                initialState={aeroDraft ?? loadedInitialState?.aero}
                onResults={setAeroResults}
                onStateChange={(s) => setAeroDraft(s)}
                onDerivedDistressTime={setAdwDerivedDistressTime}
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
            <TabsContent value="ups" key={`ups-tab-${caseVersion}-${tabClearVersions.ups ?? 0}`} className="mt-0 space-y-4">
              {aeroResults?.positionValid && (aeroResults.aircraftActive || aeroResults.parachuteActive) && (
                <div className="print-companion-page">
                  <AdwUpsSheet
                    datum={aeroResults.incidentPos}
                    dg={aeroResults.aircraftActive ? aeroResults.aircraftGlideVector : undefined}
                    dd={aeroResults.aircraftActive ? aeroResults.aircraftWindVector : undefined}
                    pg={aeroResults.parachuteActive ? aeroResults.parachuteGlideVector : undefined}
                    pw={aeroResults.parachuteActive ? aeroResults.parachuteWindVector : undefined}
                    pp={aeroResults.parachuteActive ? aeroResults.parachuteDisplacementVector : undefined}
                  />
                </div>
              )}
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
                onDataChange={setAswLive}
                onStateChange={handleAswMirror}
                windOverride={windOverride}
                initialState={loadedInitialState?.asw}
                derivedDistressTime={adwDerivedDistressTime}
              />
              <div className="print-companion-page">
                <ManeuveringBoard
                  key={`asw-mobo-${caseVersion}`}
                  printTargetId="mobo-asw"
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
                aswDistressTime={asw.distressTime}
                aswTotalHours={asw.totalHours}
                onAoChange={setWorksheet1Ao}
                onMeasuredChange={setWs1Measured}
                initialMeasured={ws1Measured}
                selectedFs={worksheet1Fs}
                onFsChange={setWorksheet1Fs}
                onOpenManualAppendix={() => {
                  setAusSarManualInitialDoc('appendix-i');
                  setIsAusSarManualOpen(true);
                }}
              />
              <DatumWorksheet
                aswDirFrom={asw.aswDirFrom}
                aswSpeed={asw.aswSpeed}
                aswErr={asw.aswErr}
                aswdve={asw.aswdve}
                aswTotalHours={asw.totalHours}
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
                onDisplayResults={setDatumDisplay}
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
              {/* Penjabaran hitungan Datum Position & Search Area lingkaran (π × R²) —
                  DIKELUARKAN dari worksheet (form asli tidak memuatnya); hitungan
                  berjalan di belakang layar untuk peta laut, penjabaran di bawah ini. */}
              <DatumPositionCard datum={datumResults ?? datumDisplay} derived={ws1Map} />
            </TabsContent>

            {/* TAB 5: WORKSHEET 2 (LEEWAY DIVERGENCE & SUB-AREA DECISION USING AO) */}
            <TabsContent value="ws2" key={`ws2-tab-${caseVersion}-${tabClearVersions.ws2 ?? 0}`} className="mt-0 space-y-4">
              <WorksheetSheetBar
                title="Lembar WS 2 — 1 SRU = 1 lembar"
                sheets={ws2Sheets.map((sheet, index) => ({ key: sheet.key, label: sheet.label || `SRU ${index + 1}`, bound: sheet.assetId !== null }))}
                activeKey={shownWs2Key}
                assets={airAssetOptions}
                boundAssetIds={ws2Sheets.map((sheet) => sheet.assetId).filter((id): id is string => id !== null)}
                onSelect={setActiveWs2Key}
                onAddBlank={() => addWs2Sheet()}
                onAddAsset={(assetId) => addWs2Sheet(assetId)}
                onRemove={removeWs2Sheet}
              />
              {ws2Sheets.map((sheet) => (
                <div key={sheet.key} className={sheet.key === shownWs2Key ? '' : 'hidden'}>
                  <Worksheet2
                    key={`ws2-${caseVersion}-${sheet.key}`}
                    lkp={lkp}
                    datumData={datumData}
                    datumResults={datumResults}
                    aswDirFrom={asw.aswDirFrom}
                    aswSpeedKts={asw.aswSpeed}
                    ws1Ao={ws1Ao}
                    initialState={sheet.data}
                    onTrackSpacingChange={(result) => handleWS2TrackSpacingChange(sheet.key, result)}
                    onStateChange={(data) => handleWS2SheetData(sheet.key, data)}
                  />
                </div>
              ))}
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
            <TabsContent value="ws8" key={`ws8-tab-${caseVersion}-${tabClearVersions.ws8 ?? 0}`} className="mt-0 space-y-4">
              <WorksheetSheetBar
                title="Lembar WS 8 — 1 SRU = 1 lembar"
                sheets={ws8Sheets.map((sheet, index) => ({ key: sheet.key, label: sheet.label || `SRU ${index + 1}`, bound: sheet.assetId !== null }))}
                activeKey={shownWs8Key}
                assets={vesselAssetOptions}
                boundAssetIds={ws8Sheets.map((sheet) => sheet.assetId).filter((id): id is string => id !== null)}
                onSelect={setActiveWs8Key}
                onAddBlank={() => addWs8Sheet()}
                onAddAsset={(assetId) => addWs8Sheet(assetId)}
                onRemove={removeWs8Sheet}
              />
              {ws8Sheets.map((sheet) => (
                <div key={sheet.key} className={sheet.key === shownWs8Key ? '' : 'hidden'}>
                  <Worksheet8
                    key={`ws8-${caseVersion}-${sheet.key}`}
                    ws1Ao={ws1Ao}
                    windKts={asw.aswSpeed || (datumData?.aswSpeed ?? 0)}
                    initialC={searchResults?.C ?? 0}
                    initialPod={searchResults?.POD ?? 0}
                    initialState={sheet.data}
                    onTrackSpacingChange={(result) => handleWS8TrackSpacingChange(sheet.key, result)}
                    onStateChange={(data) => handleWS8SheetData(sheet.key, data)}
                  />
                </div>
              ))}
            </TabsContent>

            {/* TAB 7: PENGHITUNGAN ALOKASI ASET SRU */}
            <TabsContent value="asset-allocation" key={`assets-tab-${caseVersion}-${tabClearVersions['asset-allocation'] ?? 0}`} className="mt-0 space-y-4">
              <AssetAllocationWorksheet
                key={`assets-${caseVersion}`}
                csp={csp}
                exitPoint={exitPoint}
                ws1Ao={ws1Ao}
                assets={assets}
                worksheetSpacing={assetWorksheetSpacing}
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
                        onClick={printActiveWorksheetFit}
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
                          <input type="number" min="0" max="359.999" step="0.1" value={patternOrientationText} onChange={(e) => setPatternOrientationText(e.target.value)} placeholder="Mengikuti kemiringan search area" className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 font-mono" />
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
              <WorksheetSheetBar
                title="Lembar WS 3 — 1 SRU = 1 lembar"
                sheets={ws3Sheets.map((sheet, index) => ({ key: sheet.key, label: sheet.label || `SRU ${index + 1}`, bound: sheet.assetId !== null }))}
                activeKey={shownWs3Key}
                assets={airAssetOptions}
                boundAssetIds={ws3Sheets.map((sheet) => sheet.assetId).filter((id): id is string => id !== null)}
                onSelect={setActiveWs3Key}
                onAddBlank={() => addWs3Sheet()}
                onAddAsset={(assetId) => addWs3Sheet(assetId)}
                onRemove={removeWs3Sheet}
              />
              {ws3Sheets.map((sheet) => (
                <div key={sheet.key} className={sheet.key === shownWs3Key ? '' : 'hidden'}>
                  <Worksheet3
                    key={`ws3-${caseVersion}-${sheet.key}`}
                    searchResults={searchResults}
                    E={datumResults?.E ?? 5.0}
                    initialState={sheet.data}
                    onTrackSpacingChange={(result) => handleWS3TrackSpacingChange(sheet.key, result)}
                    onStateChange={(data) => handleWS3SheetData(sheet.key, data)}
                  />
                </div>
              ))}
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
                initialState={ws4State ?? undefined}
                onStateChange={setWs4State}
              />
            </TabsContent>

            {/* TAB: INTERCEPT CALCULATOR */}
            <TabsContent value="intercept" key={`intercept-tab-${caseVersion}-${tabClearVersions.intercept ?? 0}`} className="mt-0">
              <InterceptWorksheet
                key={`intercept-${caseVersion}-${interceptCaseVersion}`}
                initialInput={aiInterceptInput ?? interceptState}
                onStateChange={setInterceptState}
              />
            </TabsContent>

            {/* TAB: BRIEFING & RENOPS (PERBAN 3/2020) — cetak alami multi-halaman
                (data-print-flow): jumlah halaman mengikuti banyak keterangan */}
            <TabsContent value="briefing-renops" key={`briefing-tab-${caseVersion}-${tabClearVersions['briefing-renops'] ?? 0}`} className="mt-0 space-y-6" data-print-flow>
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
                initialState={briefingState}
                onStateChange={setBriefingState}
              />
              <div className="print-page-break">
                <RenopsForm
                  key={`renops-${caseVersion}`}
                  lkp={lkp}
                  datumResults={datumResults}
                  searchResults={searchResults}
                  initialState={renopsState}
                  onStateChange={setRenopsState}
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
            <TabsContent value="basic-calc" key={`basic-tab-${caseVersion}-${tabClearVersions['basic-calc'] ?? 0}`} className="mt-0 space-y-4">
              <BasicCalculation key={`calc-${caseVersion}`} />
              {/* PHASE 4: panduan + kalkulator jarak peta laut & peta udara (1 menit = 1 NM) */}
              <ChartDistanceGuide key={`chart-dist-${caseVersion}`} />
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

          {/* Interactive Sea Chart Card — layar penuh hanya menampilkan peta
              beserta fitur & vektornya (header, alat, chip titik, banner mode,
              legenda, dan koordinat sudut disembunyikan). */}
          <div
            ref={petaLautFsRef}
            className={`fs-target ${petaLautFullscreen ? 'flex flex-col' : ''}`}
          >
          <Card className={`overflow-hidden border-slate-200 shadow-sm ${petaLautFullscreen ? 'flex-1 min-h-0 py-0 gap-0' : ''}`}>
            <CardHeader className={`bg-slate-50 pb-3 ${petaLautFullscreen ? 'hidden' : ''}`}>
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
                  <FullscreenToggleButton
                    isFullscreen={petaLautFullscreen}
                    onToggle={togglePetaLautFullscreen}
                    label="Layar Penuh"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className={`p-0 ${petaLautFullscreen ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
              <div className={`flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-2.5 ${petaLautFullscreen ? 'hidden' : ''}`} aria-label="Alat peta Worksheet 1">
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
              {mainMapDroppedPoints.length > 0 && <div className={`flex flex-wrap gap-1.5 border-b border-slate-200 bg-white px-2.5 py-2 ${petaLautFullscreen ? 'hidden' : ''}`}>
                {mainMapDroppedPoints.map((point, index) => (
                  <button key={point.id} type="button" onClick={() => setSelectedMainMapPointId(point.id)} aria-pressed={selectedMainMapPointId === point.id} className={`rounded border px-2 py-1 text-[10px] ${selectedMainMapPointId === point.id ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                    Titik {index + 1}: {formatDMS(point.position.lat, false)} · {formatDMS(point.position.lng, true)}
                  </button>
                ))}
              </div>}
              {pickMode && (
                <div className={`px-3 py-2 bg-emerald-600 text-white text-xs font-medium flex items-center justify-between ${petaLautFullscreen ? 'hidden' : ''}`}>
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
                <div className={`px-3 py-2 bg-purple-600 text-white text-xs font-medium flex items-center justify-between ${petaLautFullscreen ? 'hidden' : ''}`}>
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

              <div className={`relative ${pickMode ? 'ring-2 ring-emerald-500 ring-inset' : pickSruMode ? 'ring-2 ring-purple-500 ring-inset' : ''} ${petaLautFullscreen ? 'flex-1 min-h-0' : ''}`}>
                {/* Tombol layar penuh melayang di atas peta (tengah atas) —
                    selalu terlihat, tidak bertabrakan dengan kontrol Leaflet
                    (layer kanan-atas, koordinat kiri-atas, Tampilan kanan-bawah).
                    Saat layar penuh menjadi tombol "Keluar". */}
                <button
                  type="button"
                  onClick={togglePetaLautFullscreen}
                  title={petaLautFullscreen ? 'Keluar layar penuh (Esc)' : 'Tampilkan layar penuh'}
                  aria-pressed={petaLautFullscreen}
                  className="absolute left-1/2 top-2 z-[1300] -translate-x-1/2 print:hidden inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-md hover:bg-slate-100"
                >
                  {petaLautFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  {petaLautFullscreen ? 'Keluar layar penuh' : 'Layar Penuh'}
                </button>
                <SeaMapMount
                  center={mapCenter}
                  zoom={8}
                  markers={mainMapMarkers}
                  lines={lines}
                  polygons={polygons}
                  circles={circles}
                  height={petaLautFullscreen ? '100%' : '460px'}
                  pickMode={pickMode || pickSruMode || mainMapToolMode === 'drop'}
                  measureMode={mainMapToolMode === 'measure'}
                  preferenceKey="worksheet-main"
                  onMapClick={handleInteractiveMapClick}
                  autoFitTo={{
                    points: [lkp, ws1Map.datumB],
                    radiusNm: ws1Map.RUp,
                    key: `${ws1Map.datumB.lat.toFixed(5)},${ws1Map.datumB.lng.toFixed(5)},${ws1Map.RUp}`,
                  }}
                />
              </div>

              {/* Map Legend — disembunyikan saat layar penuh (hanya peta) */}
              <div className={`px-3 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-1 ${petaLautFullscreen ? 'hidden' : ''}`}>
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
                <div className={`px-3 py-2 bg-white border-t border-slate-200 text-[10px] leading-relaxed text-slate-700 ${petaLautFullscreen ? 'hidden' : ''}`}>
                  <strong className="text-slate-900">Koordinat sudut Search Area (A → B → C → D searah jarum jam):</strong>
                  {searchAreaCornerDescriptions.map((description) => <div key={description} className="font-mono">{description}</div>)}
                </div>
              )}
            </CardContent>
          </Card>
          </div>

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

      {/* Manual SAR Australia (Combined + Appendix I/J/K) — referensi tabel worksheet */}
      <AusSarManualDialog open={isAusSarManualOpen} onOpenChange={handleAusSarManualOpenChange} initialDocId={ausSarManualInitialDoc} initialRef={tableRefRequest} />

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
        onApplyAeroDrift={handleApplyAeroDrift}
        onApplyLKP={handleApplyLKP}
        onApplyDatum={handleApplyDatum}
        onApplyWS2={handleApplyWS2}
        onApplyWS3={handleApplyWS3}
        onApplyWS4={handleApplyWS4}
        onApplyWS8={handleApplyWS8}
        onApplyAssetAllocation={handleApplyAssetAllocation}
        onApplySearchPattern={handleApplySearchPattern}
        onApplyIntercept={handleApplyIntercept}
        onApplySetFields={handleApplySetFields}
        stateSnapshot={aiStateSnapshot}
        onFocusWorksheet={(worksheet) => setActiveTab(worksheet === 'datum' ? 'ws1' : worksheet)}
        activeWorkspace={activeSarCase}
        workspaceEntries={wsContextEntries}
        workspaceContextBlock={workspaceContextBlock}
        onSaveWorkspaceSnapshot={handleSaveWorkspaceSnapshot}
        onLogConversation={handleLogConversation}
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
    </TableRefContext.Provider>
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
