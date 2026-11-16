'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  MessageCircle,
  Send,
  X,
  Settings,
  Trash2,
  Bot,
  User,
  Loader2,
  Zap,
  Paperclip,
  FileText,
  Image as ImageIcon,
  FileSpreadsheet,
  File,
  UploadCloud,
} from 'lucide-react';
import { formatDMS } from '@/lib/sar/coordFormat';
import type { InterceptInput } from '@/lib/sar/interceptCalculations';
import type { Worksheet2InitialState } from '@/components/sar/worksheets/Worksheet2';
import type { Worksheet3InitialState } from '@/components/sar/worksheets/Worksheet3';
import type { Worksheet4InitialState } from '@/components/sar/worksheets/Worksheet4';
import type { Worksheet8InitialState } from '@/components/sar/worksheets/Worksheet8';
import { W2_TARGET_OPTIONS, W8_TARGET_OPTIONS } from '@/lib/sar/wscPodTables';

interface UploadedAttachment {
  name: string;
  type: string;
  size: number;
  base64: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  files?: { name: string; type: string; size?: number }[];
  functionCalls?: { name: string; args: Record<string, unknown> }[] | null;
  applied?: boolean;
}

interface AIChatPanelProps {
  onApplyASW?: (data: {
    distressTime: string;
    datumTime: string;
    intervalMode: '6h' | '3h';
    windData: { windDirFrom: number; windSpeed: number }[];
    caseTitle?: string;
  }) => void;
  onApplyAWA?: (data: {
    distressAltFt: number;
    windData: { altObs: string; windDirFrom: number; windSpeed: number }[];
    caseTitle?: string;
  }) => void;
  onApplyLKP?: (data: { lat: number; lng: number }) => void;
  onApplyDatum?: (data: {
    latitude: number;
    lkp: { lat: number; lng: number };
    driftInterval: number;
    seaCurrentDir: number;
    seaCurrentSpeed: number;
    seaCurrentErr?: number;
    leewayObjectId?: string;
    X?: number;
    Y?: number;
  }) => void;
  onApplyWS2?: (data: Worksheet2InitialState) => void;
  onApplyWS3?: (data: Worksheet3InitialState) => void;
  onApplyWS4?: (data: Worksheet4InitialState) => void;
  onApplyWS8?: (data: Worksheet8InitialState) => void;
  onApplyIntercept?: (data: InterceptInput) => boolean;
  onFocusWorksheet?: (worksheet: string) => void;
  isOpen?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
}

const STORAGE_KEY = 'sar-ai-api-key';
const CHAT_HISTORY_KEY = 'sar-ai-chat-history';

const QUICK_PROMPTS = [
  {
    label: 'Buat Kasus ASW',
    prompt:
      'Buatkan contoh kasus SAR maritim lengkap dengan data ASW. Gunakan distress time hari ini, datum time 15 jam kemudian, dengan data angin dari BMKG per 6 jam.',
  },
  {
    label: 'Buat Kasus AWA',
    prompt:
      'Buatkan contoh kasus SAR penerbangan pesawat kecil yang mengalami engine failure pada ketinggian 12.000 feet. Lengkap dengan data angin atas per ketinggian.',
  },
  {
    label: 'Upload Soal / Kasus',
    prompt:
      'Saya akan melampirkan dokumen/gambar soal kasus SAR. Tolong telaah isinya, ekstrak data operasi, dan siapkan input ke worksheet.',
  },
  {
    label: 'Jelaskan ASW & Mobo',
    prompt:
      'Jelaskan cara menentukan arah dan kecepatan Average Surface Wind (ASW) menggunakan Maneuvering Board.',
  },
];

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const commaIdx = res.indexOf(',');
      resolve(commaIdx !== -1 ? res.substring(commaIdx + 1) : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getFileIcon(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return <FileText className="h-3.5 w-3.5 text-rose-500" />;
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp')
  )
    return <ImageIcon className="h-3.5 w-3.5 text-sky-500" />;
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv'))
    return <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />;
  if (lower.endsWith('.docx') || lower.endsWith('.doc'))
    return <FileText className="h-3.5 w-3.5 text-blue-500" />;
  if (lower.endsWith('.pptx') || lower.endsWith('.ppt'))
    return <FileText className="h-3.5 w-3.5 text-amber-500" />;
  return <File className="h-3.5 w-3.5 text-slate-500" />;
}

function formatFileSize(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AIChatPanel({
  onApplyASW,
  onApplyAWA,
  onApplyLKP,
  onApplyDatum,
  onApplyWS2,
  onApplyWS3,
  onApplyWS4,
  onApplyWS8,
  onApplyIntercept,
  onFocusWorksheet,
  isOpen: controlledIsOpen,
  onToggle,
  className = '',
}: AIChatPanelProps) {
  const [internalIsOpen, setInternalIsOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalIsOpen;
  const setIsOpen = (open: boolean) => {
    if (onToggle) onToggle(open);
    else setInternalIsOpen(open);
  };

  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<UploadedAttachment[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const applyFunctionCalls = useCallback((calls: ChatMessage['functionCalls']) => {
    if (!calls?.length) return { applied: false, invalidIntercept: false, preferredWorksheet: '' };
    let applied = false;
    let invalidIntercept = false;
    const appliedWorksheets: string[] = [];
    for (const call of calls) {
      const args = call.args;
      switch (call.name) {
        case 'set_asw_case': {
          const data = args as Parameters<NonNullable<typeof onApplyASW>>[0];
          if (data.windData?.length && data.distressTime && data.datumTime && ['3h', '6h'].includes(data.intervalMode)) {
            onApplyASW?.(data);
            applied = true;
            appliedWorksheets.push('asw');
          }
          break;
        }
        case 'set_awa_case': {
          const data = args as Parameters<NonNullable<typeof onApplyAWA>>[0];
          if (data.distressAltFt > 0 && data.windData?.length >= 2) {
            onApplyAWA?.(data);
            applied = true;
            appliedWorksheets.push('awa');
          }
          break;
        }
        case 'set_lkp': {
          const data = args as { lat: number; lng: number };
          if (Number.isFinite(data.lat) && Math.abs(data.lat) <= 90 && Number.isFinite(data.lng) && Math.abs(data.lng) <= 180) {
            onApplyLKP?.(data);
            applied = true;
            appliedWorksheets.push('datum');
          }
          break;
        }
        case 'set_datum_case': {
          const data = args as Parameters<NonNullable<typeof onApplyDatum>>[0];
          const leewayIds = ['piw-novice', 'piw-lifejacket', 'raft-46-person', 'raft-1520-person', 'raft-canopy-drogue', 'raft-canopy-no-drogue', 'dinghy-fibreglass', 'dinghy-upright', 'small-fishing', 'commercial-fishing', 'sailboat', 'merchant-vessel'];
          if (Number.isFinite(data.latitude) && data.latitude >= 0 && data.latitude <= 90
            && Number.isFinite(data.lkp?.lat) && Math.abs(data.lkp.lat) <= 90
            && Number.isFinite(data.lkp?.lng) && Math.abs(data.lkp.lng) <= 180
            && Number.isFinite(data.driftInterval) && data.driftInterval > 0
            && Number.isFinite(data.seaCurrentDir) && data.seaCurrentDir >= 0 && data.seaCurrentDir < 360
            && Number.isFinite(data.seaCurrentSpeed) && data.seaCurrentSpeed >= 0
            && leewayIds.includes(data.leewayObjectId ?? '')) {
            onApplyDatum?.(data);
            applied = true;
            appliedWorksheets.push('datum');
          }
          break;
        }
        case 'set_ws2_case': {
          const data = args as Worksheet2InitialState;
          if (['fixed-wing', 'helicopter'].includes(data.searchPlatform ?? '')
            && Number.isFinite(data.searchTas) && (data.searchTas ?? 0) > 0
            && Number.isInteger(data.visibilityIndex) && (data.visibilityIndex ?? -1) >= 0 && (data.visibilityIndex ?? 6) <= 5
            && ['Yes', 'No'].includes(data.isFatigue ?? '')
            && (data.searchNumber === undefined || [1, 2, 3, 4, 5].includes(data.searchNumber))
            && [500, 1000, 1500, 2000].includes(data.selectedHeight ?? 0)
            && W2_TARGET_OPTIONS.some((target) => target.id === data.searchObject)) {
            onApplyWS2?.(data);
            applied = true;
            appliedWorksheets.push('ws2');
          }
          break;
        }
        case 'set_ws3_case': {
          const data = args as Worksheet3InitialState;
          if (['person', 'vehicle', 'aircraft-under-5700', 'aircraft-over-5700'].includes(data.searchObject ?? '')
            && [5, 10, 20, 30, 40].includes(data.visibilityKm ?? 0)
            && ['under-15', '15-60', '60-85', 'over-85'].includes(data.vegetationType ?? '')
            && typeof data.isFatigue === 'boolean'
            && ['fixed-wing', 'helicopter'].includes(data.searchPlatform ?? '')
            && [1, 2, 3, 4, 5].includes(data.searchNumber ?? 0)
            && (data.searchSpeedKts === undefined || (Number.isFinite(data.searchSpeedKts) && data.searchSpeedKts >= 0))
            && (data.searchTas === undefined || (Number.isFinite(data.searchTas) && data.searchTas >= 0))
            && (data.searchAreaNm2 === undefined || (Number.isFinite(data.searchAreaNm2) && data.searchAreaNm2 >= 0))) {
            onApplyWS3?.(data);
            applied = true;
            appliedWorksheets.push('ws3');
          }
          break;
        }
        case 'set_ws4_case': {
          const data = args as Worksheet4InitialState;
          const validFactors = [1.1, 1.6, 2, 2.3, 2.5];
          const validLegs = Array.isArray(data.routeLegDistancesNm) && data.routeLegDistancesNm.length === 3 && data.routeLegDistancesNm.every((value) => Number.isFinite(value) && value >= 0);
          const validLegacyTr = Array.isArray(data.trList) && data.trList.length === 4 && data.trList.every((value) => Number.isFinite(value) && value >= 0);
          const validStart = data.trStartMode === 'manual'
            ? Number.isFinite(data.initialTrNm) && (data.initialTrNm ?? -1) >= 0
            : data.trStartMode === 'elapsed-time'
              && Number.isFinite(data.targetTasKts) && (data.targetTasKts ?? 0) > 0
              && Number.isFinite(data.elapsedMinutesSinceLastFix) && (data.elapsedMinutesSinceLastFix ?? -1) >= 0;
          const validTargetNav = ['self-contained', 'other-aircraft', 'dead-reckoning', 'custom'].includes(data.targetNavigationType ?? '');
          const requiresBaseErrors = data.targetNavigationType === 'dead-reckoning' || data.targetNavigationType === 'custom';
          const validFixErrors = !requiresBaseErrors || (Array.isArray(data.fixErrors) && data.fixErrors.length === 4 && data.fixErrors.every((value) => Number.isFinite(value) && value >= 0));
          const validWaypoints = data.routePoints === undefined || (Array.isArray(data.routePoints) && data.routePoints.length === 4 && data.routePoints.every((point) => point !== null && typeof point === 'object' && typeof point.name === 'string'
            && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180
            && typeof point.active === 'boolean'));
          if ((validStart && (validLegs || validWaypoints) || validLegacyTr)
            && validTargetNav && validFixErrors && validWaypoints
            && Number.isFinite(data.yNavError) && (data.yNavError ?? -1) >= 0
            && validFactors.includes(data.safetyFactor ?? 0)) {
            onApplyWS4?.(data);
            applied = true;
            appliedWorksheets.push('ws4');
          }
          break;
        }
        case 'set_ws8_case': {
          const data = args as Worksheet8InitialState;
          const validVisibility = data.eyeHeight === 'MERSHIP'
            ? ['5', '10', '20', '30', '40'].includes(data.visibilityKm ?? '')
            : ['2', '5', '10', '15', '20', '>25'].includes(data.visibilityKm ?? '');
          if (['8', '14', 'MERSHIP'].includes(data.eyeHeight ?? '')
            && validVisibility
            && ['Yes', 'No'].includes(data.isFatigue ?? '')
            && (data.searchNumber === undefined || [1, 2, 3, 4, 5].includes(data.searchNumber))
            && (data.vesselSpeedKts === undefined || (Number.isFinite(data.vesselSpeedKts) && data.vesselSpeedKts >= 0))
            && W8_TARGET_OPTIONS.some((target) => target.id === data.searchObject)) {
            onApplyWS8?.(data);
            applied = true;
            appliedWorksheets.push('ws8');
          }
          break;
        }
        case 'set_intercept_case': {
          const data = args as unknown as InterceptInput;
          const target = data.target;
          const sru = data.sru;
          const valid = ['head-on', 'overtaking', 'beam-on'].includes(data.type)
            && [target?.pos?.lat, target?.pos?.lng, sru?.pos?.lat, sru?.pos?.lng].every(Number.isFinite)
            && [target?.speedKts, sru?.speedKts].every((value) => Number.isFinite(value) && value > 0)
            && Number.isFinite(target?.courseDeg) && target.courseDeg >= 0 && target.courseDeg < 360
            && Math.abs(target.pos.lat) <= 90 && Math.abs(sru.pos.lat) <= 90
            && Math.abs(target.pos.lng) <= 180 && Math.abs(sru.pos.lng) <= 180;
          if (valid && onApplyIntercept?.(data)) {
            applied = true;
            appliedWorksheets.push('intercept');
          } else invalidIntercept = true;
          break;
        }
      }
    }
    const preferredWorksheet = appliedWorksheets.includes('intercept') ? 'intercept'
      : appliedWorksheets.includes('ws3') ? 'ws3'
        : appliedWorksheets.includes('ws4') ? 'ws4'
        : appliedWorksheets.includes('ws2') ? 'ws2'
        : appliedWorksheets.includes('ws8') ? 'ws8'
      : appliedWorksheets.includes('datum') ? 'datum'
        : appliedWorksheets.includes('awa') ? 'awa'
          : appliedWorksheets.includes('asw') ? 'asw' : '';
    if (preferredWorksheet) onFocusWorksheet?.(preferredWorksheet);
    return { applied, invalidIntercept, preferredWorksheet };
  }, [onApplyASW, onApplyAWA, onApplyLKP, onApplyDatum, onApplyWS2, onApplyWS3, onApplyWS4, onApplyWS8, onApplyIntercept, onFocusWorksheet]);

  // Load API key and chat history from localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setApiKey(saved);
      const history = localStorage.getItem(CHAT_HISTORY_KEY);
      if (history) {
        try {
          setMessages(JSON.parse(history));
        } catch {
          /* ignore */
        }
      }
    }
  }, []);

  // Save chat history (without base64 payloads to save storage quota)
  useEffect(() => {
    if (typeof window !== 'undefined' && messages.length > 0) {
      const sanitized = messages.slice(-50).map((m) => ({
        role: m.role,
        content: m.content,
        files: m.files,
        functionCalls: m.functionCalls,
        applied: m.applied,
      }));
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sanitized));
    }
  }, [messages]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const saveApiKey = useCallback((key: string) => {
    setApiKey(key);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, key);
    }
    setShowSettings(false);
  }, []);

  const handleFiles = async (filesList: FileList | File[]) => {
    const newFiles: UploadedAttachment[] = [];
    for (let i = 0; i < filesList.length; i++) {
      const file = filesList[i];
      if (file.size > 20 * 1024 * 1024) {
        alert(`File "${file.name}" melebihi batas ukuran 20MB.`);
        continue;
      }
      try {
        const base64 = await readFileAsBase64(file);
        newFiles.push({
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          base64,
        });
      } catch (err) {
        console.error(`Gagal membaca file ${file.name}:`, err);
      }
    }
    setAttachedFiles((prev) => [...prev, ...newFiles]);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachedFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if ((!trimmed && attachedFiles.length === 0) || isLoading) return;
      if (!apiKey) {
        setShowSettings(true);
        return;
      }

      const filesToSend = [...attachedFiles];
      const userMsg: ChatMessage = {
        role: 'user',
        content: trimmed || (filesToSend.length > 0 ? 'Mohon telaah dan analisis file terlampir untuk kasus operasi SAR.' : ''),
        files: filesToSend.map((f) => ({ name: f.name, type: f.type, size: f.size })),
      };

      const newMessages = [...messages, userMsg];
      setMessages(newMessages);
      setInput('');
      setAttachedFiles([]);
      setIsLoading(true);

      try {
        const requestPayload = {
          messages: newMessages.map((m) => ({ role: m.role, content: m.content })),
          apiKey,
          files: filesToSend.map((f) => ({ name: f.name, type: f.type, base64: f.base64 })),
        };
        const requestBody = JSON.stringify(requestPayload);
        // Vercel Functions reject request bodies above 4.5 MB before this route runs.
        // Leave headroom for platform/proxy overhead and give users a useful error.
        if (new Blob([requestBody]).size > 4 * 1024 * 1024) {
          throw new Error(
            'Ukuran lampiran dan riwayat chat melewati batas upload Vercel (4,5 MB). Kompres file atau kirim file yang lebih kecil (sekitar 3 MB atau kurang).'
          );
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody,
        });

        const responseBody = await res.text();
        let data: {
          error?: string;
          text?: string;
          functionCalls?: ChatMessage['functionCalls'];
        };
        try {
          data = JSON.parse(responseBody);
        } catch {
          const detail = responseBody.trim().slice(0, 600);
          throw new Error(
            `Server mengembalikan respons non-JSON (HTTP ${res.status}). ${detail || 'Isi respons kosong.'}`
          );
        }

        if (!res.ok) {
          throw new Error(data.error || 'API Error');
        }

        const { applied, invalidIntercept } = applyFunctionCalls(data.functionCalls);

        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: data.text || 'Server tidak mengirim teks jawaban.',
          functionCalls: data.functionCalls,
          applied,
        };
        if (invalidIntercept) {
          assistantMsg.content += '\n\nAgar saya bisa mengisi Intercept dengan benar, mohon lengkapi posisi awal target dan SRU/pangkalan, kecepatan target dan SRU, serta haluan target. Waktu referensi hanya diperlukan jika ETA ingin dihitung.';
        }
        if (applied) assistantMsg.content += '\n\nData worksheet yang berhasil diekstrak sudah diterapkan otomatis ke aplikasi. Periksa input dan lengkapi bagian yang ditandai masih kurang.';
        setMessages([...newMessages, assistantMsg]);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setMessages([
          ...newMessages,
          { role: 'assistant', content: `❌ Error: ${errMsg}` },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [apiKey, attachedFiles, isLoading, messages, applyFunctionCalls]
  );

  const handleApply = useCallback(
    (msg: ChatMessage, idx: number) => {
      if (!msg.functionCalls) return;
      const result = applyFunctionCalls(msg.functionCalls);
      if (result.applied) {
        setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, applied: true } : m)));
      }
    },
    [applyFunctionCalls]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(CHAT_HISTORY_KEY);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const getFunctionCallSummary = (fc: { name: string; args: Record<string, unknown> }) => {
    switch (fc.name) {
      case 'set_asw_case': {
        const a = fc.args as {
          distressTime?: string;
          datumTime?: string;
          intervalMode?: string;
          windData?: unknown[];
          caseTitle?: string;
        };
        return `📋 ASW: ${a.caseTitle || 'Kasus Baru'}\nDistress: ${a.distressTime} → Datum: ${a.datumTime}\nInterval: ${a.intervalMode}, ${a.windData?.length || 0} observasi`;
      }
      case 'set_awa_case': {
        const a = fc.args as {
          distressAltFt?: number;
          windData?: unknown[];
          caseTitle?: string;
        };
        return `✈️ AWA: ${a.caseTitle || 'Kasus Penerbangan'}\nAltitude: ${a.distressAltFt} ft, ${a.windData?.length || 0} lapisan angin`;
      }
      case 'set_lkp': {
        const a = fc.args as { lat?: number; lng?: number };
        return `📍 LKP: ${formatDMS(a.lat ?? 0, false)}, ${formatDMS(a.lng ?? 0, true)}`;
      }
      case 'set_datum_case': {
        const a = fc.args as { driftInterval?: number; seaCurrentDir?: number; seaCurrentSpeed?: number; leewayObjectId?: string };
        return `🧭 Datum / WS 1: drift ${a.driftInterval ?? 0} jam · arus ${a.seaCurrentDir ?? 0}°T / ${a.seaCurrentSpeed ?? 0} kt${a.leewayObjectId ? ` · objek ${a.leewayObjectId}` : ''}`;
      }
      case 'set_ws2_case': {
        const a = fc.args as Worksheet2InitialState;
        return `✈️ WS 2: ${a.searchPlatform ?? 'platform?'} · ${a.searchObject ?? 'objek?'} · visibilitas kolom ${a.visibilityIndex ?? '?'} · ${a.selectedHeight ?? '?'} ft`;
      }
      case 'set_ws3_case': {
        const a = fc.args as Worksheet3InitialState;
        return `🌲 WS 3 (Land): ${a.searchObject ?? 'objek?'} · ${a.searchPlatform ?? 'platform?'} · visibilitas ${a.visibilityKm ?? '?'} km · search no. ${a.searchNumber ?? '?'} · V ${a.searchSpeedKts ?? a.searchTas ?? '?'} kt · area ${a.searchAreaNm2 ?? 'dari WS 1'} NM²`;
      }
      case 'set_ws4_case': {
        const a = fc.args as Worksheet4InitialState;
        return `📐 WS 4 (mandiri): Tr A ${a.trStartMode === 'elapsed-time' ? `${a.targetTasKts} kt × ${a.elapsedMinutesSinceLastFix} menit` : `${a.initialTrNm ?? a.trList?.[0] ?? '?'} NM`} · route legs ${(a.routeLegDistancesNm ?? []).join('/')} NM · nav target ${a.targetNavigationType ?? '?'} · y ${a.yNavError ?? '?'} NM · Fs ${a.safetyFactor ?? '?'}`;
      }
      case 'set_ws8_case': {
        const a = fc.args as Worksheet8InitialState;
        return `🚢 WS 8: ${a.searchObject ?? 'objek?'} · mata ${a.eyeHeight ?? '?'} ft · visibilitas ${a.visibilityKm ?? '?'} km`;
      }
      case 'set_intercept_case': {
        const a = fc.args as unknown as InterceptInput;
        return `🎯 Intercept: ${a.target?.name || 'Target'} → ${a.sru?.name || 'SRU'}\nMetode: ${a.type}\nTarget: ${formatDMS(a.target?.pos?.lat ?? 0, false)}, ${formatDMS(a.target?.pos?.lng ?? 0, true)} · ${a.target?.speedKts ?? 0} kt · haluan ${a.target?.courseDeg ?? 0}°T\nSRU: ${formatDMS(a.sru?.pos?.lat ?? 0, false)}, ${formatDMS(a.sru?.pos?.lng ?? 0, true)} · ${a.sru?.speedKts ?? 0} kt`;
      }
      default:
        return `🔧 ${fc.name}`;
    }
  };

  return (
    <>
      {/* Floating Chat Button */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg flex items-center justify-center transition-all hover:scale-110 print:hidden"
          title="SAR AI Assistant"
        >
          <MessageCircle className="h-6 w-6" />
        </button>
      )}

      {/* Chat Panel */}
      {isOpen && (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`fixed bottom-4 right-4 z-50 w-[440px] max-w-[calc(100vw-2rem)] h-[620px] max-h-[calc(100vh-2rem)] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col print:hidden ${
            isDragging ? 'ring-2 ring-emerald-500 bg-emerald-50/20' : ''
          } ${className}`}
        >
          {/* Header */}
          <div className="bg-emerald-600 text-white rounded-t-xl px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <div>
                <h3 className="font-bold text-sm">SAR AI Assistant</h3>
                <p className="text-[10px] text-emerald-100">
                  Multimodal: PDF • Office • Gambar • Gemini AI
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className="p-1.5 hover:bg-emerald-500 rounded-lg transition-colors"
                title="Pengaturan"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={clearHistory}
                className="p-1.5 hover:bg-emerald-500 rounded-lg transition-colors"
                title="Hapus Riwayat"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-emerald-500 rounded-lg transition-colors"
                title="Tutup"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="p-3 bg-slate-50 border-b border-slate-200 space-y-2 shrink-0">
              <label className="text-xs font-bold text-slate-700 block">Gemini API Key</label>
              <p className="text-[10px] text-slate-500">
                Dapatkan gratis dari{' '}
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener"
                  className="text-emerald-600 underline font-semibold"
                >
                  Google AI Studio
                </a>
                . Key disimpan aman di local storage browser Anda.
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex-1 text-xs border border-slate-300 rounded-lg px-2.5 py-1.5 font-mono"
                />
                <button
                  type="button"
                  onClick={() => saveApiKey(apiKey)}
                  className="text-xs bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-emerald-500"
                >
                  Simpan
                </button>
              </div>
            </div>
          )}

          {/* Drag Overlay Notice */}
          {isDragging && (
            <div className="absolute inset-0 z-20 bg-emerald-600/90 rounded-xl flex flex-col items-center justify-center text-white space-y-2 backdrop-blur-xs">
              <UploadCloud className="h-12 w-12 animate-bounce" />
              <p className="font-bold text-sm">Lepaskan file di sini</p>
              <p className="text-xs text-emerald-100">
                Mendukung PDF, Word (.docx), PowerPoint (.pptx), Excel (.xlsx), atau Gambar
              </p>
            </div>
          )}

          {/* Messages List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-6 space-y-3">
                <Bot className="h-12 w-12 text-slate-300 mx-auto" />
                <div>
                  <p className="text-sm font-bold text-slate-700">Halo, SAR Planner! 👋</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Upload soal latihan/kasus (PDF, Office, Gambar) atau ketik pertanyaan SAR.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 px-1 text-left">
                  {QUICK_PROMPTS.map((qp) => (
                    <button
                      key={qp.label}
                      type="button"
                      onClick={() => sendMessage(qp.prompt)}
                      className="text-left text-[11px] p-2 bg-slate-50 hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 rounded-lg transition-colors"
                    >
                      <span className="font-bold text-slate-800 block mb-0.5">{qp.label}</span>
                      <span className="text-[10px] text-slate-500 line-clamp-1">{qp.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="h-3.5 w-3.5 text-emerald-700" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed space-y-1.5 ${
                    msg.role === 'user'
                      ? 'bg-emerald-600 text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                  }`}
                >
                  {/* File Badges in Message */}
                  {msg.files && msg.files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pb-1">
                      {msg.files.map((f, fi) => (
                        <span
                          key={fi}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono ${
                            msg.role === 'user'
                              ? 'bg-emerald-700/80 text-white border border-emerald-500'
                              : 'bg-white text-slate-700 border border-slate-300 shadow-2xs'
                          }`}
                        >
                          {getFileIcon(f.name)}
                          <span className="truncate max-w-[150px]">{f.name}</span>
                          {f.size && <span className="opacity-70">({formatFileSize(f.size)})</span>}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="whitespace-pre-wrap">{msg.content}</div>

                  {/* Function Call / Action Card */}
                  {msg.functionCalls && msg.functionCalls.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {msg.functionCalls.map((fc, fi) => (
                        <div
                          key={fi}
                          className="bg-white/95 border border-emerald-300 rounded-lg p-2.5 shadow-xs text-slate-900"
                        >
                          <pre className="text-[10px] text-slate-700 whitespace-pre-wrap font-mono font-medium">
                            {getFunctionCallSummary(fc)}
                          </pre>
                          {!msg.applied ? (
                            <button
                              type="button"
                              onClick={() => handleApply(msg, idx)}
                              className="mt-2 w-full text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-1.5 rounded-md flex items-center justify-center gap-1.5 shadow-sm transition-colors"
                            >
                              <Zap className="h-3.5 w-3.5" /> Terapkan ke Worksheet
                            </button>
                          ) : (
                            <div className="mt-2 text-[11px] text-emerald-800 font-bold text-center py-1 bg-emerald-50 rounded">
                              {msg.functionCalls?.some((call) => call.name === 'set_intercept_case')
                                ? '✅ Data otomatis diterapkan; hasil dihitung dan dipetakan di tab Intercept'
                                : '✅ Data sudah diterapkan ke Worksheet'}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-1">
                    <User className="h-3.5 w-3.5 text-slate-600" />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-2 justify-start">
                <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                  <Bot className="h-3.5 w-3.5 text-emerald-700" />
                </div>
                <div className="bg-slate-100 rounded-xl px-3 py-2 text-xs text-slate-600 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                  Membaca dokumen & menganalisis kasus...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Attached Files Chips Bar */}
          {attachedFiles.length > 0 && (
            <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto shrink-0">
              {attachedFiles.map((f, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 bg-white border border-slate-300 rounded px-2 py-0.5 text-[11px] font-mono shadow-2xs text-slate-800"
                >
                  {getFileIcon(f.name)}
                  <span className="truncate max-w-[130px] font-medium">{f.name}</span>
                  <span className="text-[9px] text-slate-500">({formatFileSize(f.size)})</span>
                  <button
                    type="button"
                    onClick={() => removeAttachedFile(i)}
                    className="text-slate-400 hover:text-rose-600 ml-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Input & Action Bar */}
          <div className="p-3 border-t border-slate-200 shrink-0 bg-white rounded-b-xl">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.pptx,.xlsx,.xls,.txt,.csv"
              className="hidden"
            />
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                className="w-9 h-9 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-600 hover:text-slate-900 flex items-center justify-center transition-colors shrink-0"
                title="Lampirkan File (PDF, Word, Excel, PowerPoint, Gambar)"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  attachedFiles.length > 0
                    ? 'Tulis instruksi untuk file terlampir...'
                    : 'Tanya SAR atau lampirkan PDF/Office/gambar...'
                }
                rows={1}
                className="flex-1 text-xs border border-slate-300 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent max-h-24"
                disabled={isLoading}
              />
              <button
                type="button"
                onClick={() => sendMessage(input)}
                disabled={isLoading || (!input.trim() && attachedFiles.length === 0)}
                className="w-9 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white flex items-center justify-center transition-colors shrink-0 shadow-xs"
                title="Kirim"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400 px-0.5">
              <span>Bisa drag & drop PDF/Office/Gambar ke panel chat</span>
              <span>Shift + Enter untuk baris baru</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
