'use client';

/**
 * BANK DATA & GENERATOR DOKUMEN RESMI (Perban 3/2020)
 *
 * Alur sesuai Panduan Agent:
 *  1. Soal Kasus dianalisis AI → Bank Data (fakta + provenance + pertanyaan data yang hilang).
 *  2. Draft RENOPS (Format I/II) / Briefing / De-Briefing dibangun dari:
 *     hasil worksheet → geometri peta → Bank Data → PENDING (AI meminta data ke pengguna).
 *  3. Pengguna menjawab pertanyaan → field tersimpan (manual_confirmed) → dokumen dapat diregenerasi.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Database, FileText, Loader2, Printer, RefreshCw, Sparkles,
  ClipboardCheck, AlertTriangle, MessageCircleQuestion, Save, Trash2, History,
} from 'lucide-react';
import { toast } from 'sonner';
import type { LatLng } from '@/lib/sar/sarCalculations';
import type { DatumResults } from '@/components/sar/DatumWorksheet';
import type { SearchPlanResults } from '@/components/sar/SearchPlanWorksheet';
import type { SruAssetInput } from '@/lib/sar/assetAllocation';
import {
  type DataBankField,
  type DocumentSnapshot,
  type DocType,
  type GeneratedDocument,
  type FieldStatus,
  type SourceType,
  PENDING_TEXT,
} from '@/lib/sar/dataBank';

interface DocumentWorkbenchProps {
  lkp: LatLng;
  isLkpSet: boolean;
  datumResults: DatumResults | null;
  searchResults: SearchPlanResults | null;
  asw: { aswDirFrom: number; aswSpeed: number };
  awa: { aswDirFrom: number; aswSpeed: number; isValid?: boolean };
  ws2TrackSpacingNm: number | null;
  ws3TrackSpacingNm: number | null;
  ws8TrackSpacingNm: number | null;
  assets: SruAssetInput[];
  pattern: {
    type: string;
    orientation: string;
    environment: '' | 'water' | 'land';
    worksheetSource: '' | 'ws2' | 'ws3' | 'ws8';
    trackLineLengthText: string;
  };
  worksheet1Fs: number;
}

interface BankRecord {
  id: string;
  caseTitle: string | null;
  incidentType: string;
  rawText: string;
  fields: DataBankField[];
  updatedAt: string;
}

// Bank Data lokal (fallback serverless/Vercel — DB read-only).
const LOCAL_BANKS_KEY = 'sar-data-bank-local';
const AI_KEY_STORAGE = 'sar-ai-api-key';
const isLocalBank = (id: string | null) => !!id && id.startsWith('local_');

function readLocalBanks(): BankRecord[] {
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_BANKS_KEY) ?? '[]');
    return Array.isArray(arr) ? arr.filter((b) => b && typeof b.id === 'string' && Array.isArray(b.fields)) : [];
  } catch { return []; }
}

function writeLocalBanks(banks: BankRecord[]) {
  try { localStorage.setItem(LOCAL_BANKS_KEY, JSON.stringify(banks.slice(0, 50))); } catch { /* penuh/privat */ }
}

function upsertLocalBank(bank: BankRecord): BankRecord[] {
  const current = readLocalBanks();
  const idx = current.findIndex((b) => b.id === bank.id);
  const next = idx >= 0 ? current.map((b, i) => (i === idx ? bank : b)) : [bank, ...current];
  writeLocalBanks(next);
  return next;
}

function removeLocalBank(id: string): BankRecord[] {
  const next = readLocalBanks().filter((b) => b.id !== id);
  writeLocalBanks(next);
  return next;
}

/** Terapkan jawaban satu field di sisi klien (cermin logika PATCH /api/data-bank/[id]). */
function applyFieldAnswer(
  fields: DataBankField[],
  key: string,
  label: string,
  value: string,
  nowIso: string,
): DataBankField[] {
  const clean = value === null || value === undefined || String(value).trim() === '' ? null : String(value).trim();
  const idx = fields.findIndex((f) => f.key === key);
  if (idx >= 0) {
    return fields.map((f, i) => (i === idx
      ? {
        ...f,
        value: clean,
        status: clean ? 'READY' : 'PENDING',
        sourceType: clean ? 'manual_confirmed' : f.sourceType,
        sourceRef: clean ? `Input manual petugas (${nowIso})` : f.sourceRef,
        question: clean ? null : f.question,
        updatedAt: nowIso,
      }
      : f));
  }
  if (!clean) return fields;
  return [...fields, {
    key,
    label,
    value: clean,
    unit: null,
    sourceType: 'manual_confirmed',
    sourceRef: `Input manual petugas (${nowIso})`,
    status: 'READY',
    updatedAt: nowIso,
  }];
}

const SOURCE_LABEL: Record<SourceType, string> = {
  case: 'Soal Kasus',
  worksheet: 'Worksheet',
  map: 'Peta',
  asset: 'Alokasi Aset',
  personnel: 'Personel',
  communications: 'Komunikasi',
  actual_report: 'Laporan Aktual',
  manual_confirmed: 'Input Manual',
  unknown: '—',
};

const STATUS_STYLE: Record<FieldStatus, string> = {
  READY: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  PENDING: 'bg-amber-100 text-amber-800 border-amber-300',
  CONFLICT: 'bg-red-100 text-red-800 border-red-300',
  STALE: 'bg-slate-200 text-slate-700 border-slate-300',
  ACTUAL_REQUIRED: 'bg-violet-100 text-violet-800 border-violet-300',
};

export default function DocumentWorkbench(props: DocumentWorkbenchProps) {
  const [rawText, setRawText] = useState('');
  const [bankId, setBankId] = useState<string | null>(null);
  const [bankFields, setBankFields] = useState<DataBankField[]>([]);
  const [bankIncidentType, setBankIncidentType] = useState<string | null>(null);
  const [banks, setBanks] = useState<BankRecord[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [docType, setDocType] = useState<string>('AUTO');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [generating, setGenerating] = useState(false);
  const [document, setDocument] = useState<GeneratedDocument | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const snapshot: DocumentSnapshot = useMemo(() => ({
    lkp: props.isLkpSet ? props.lkp : null,
    lkpSet: props.isLkpSet,
    datum: props.datumResults ? {
      datumLeft: props.datumResults.datumLeft,
      datumRight: props.datumResults.datumRight,
      driftDistanceNm: props.datumResults.driftDistance,
      totalDriftErrorNm: props.datumResults.E,
    } : null,
    searchArea: props.searchResults ? {
      center: props.searchResults.searchAreaCenter,
      lengthNm: props.searchResults.searchAreaLength,
      widthNm: props.searchResults.searchAreaWidth,
      orientationDeg: props.searchResults.orientationDeg,
      areaSqNm: props.searchResults.Ao,
      trackSpacingNm: props.searchResults.trackSpacing,
      safetyFactor: props.searchResults.fs,
      podPercent: props.searchResults.POD,
    } : null,
    asw: props.asw.aswSpeed ? { dirFrom: props.asw.aswDirFrom, speedKts: props.asw.aswSpeed } : null,
    awa: props.awa.isValid ? { dirFrom: props.awa.aswDirFrom, speedKts: props.awa.aswSpeed } : null,
    trackSpacing: {
      ws2Nm: props.ws2TrackSpacingNm,
      ws3Nm: props.ws3TrackSpacingNm,
      ws8Nm: props.ws8TrackSpacingNm,
    },
    pattern: props.pattern,
    assets: props.assets.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      homeBaseName: a.homeBaseName,
      transitSpeedKts: a.transitSpeedKts,
      searchSpeedKts: a.searchSpeedKts,
      enduranceHours: a.enduranceHours,
      sweepWidthNm: a.sweepWidthNm,
      assignedSubArea: a.assignedSubArea,
    })),
    mapPoints: [],
  }), [props]);

  const fetchBanks = useCallback(async () => {
    // Gabungkan bank dari database + bank lokal browser (fallback serverless).
    const local = readLocalBanks();
    try {
      const res = await fetch('/api/data-bank', { cache: 'no-store' });
      const data = await res.json();
      setBanks([...local, ...(data.banks ?? [])]);
    } catch {
      setBanks(local);
    }
  }, []);

  useEffect(() => { void fetchBanks(); }, [fetchBanks]);

  const loadBank = (id: string) => {
    const found = banks.find((b) => b.id === id);
    if (!found) return;
    setBankId(found.id);
    setBankFields(found.fields);
    setBankIncidentType(found.incidentType);
    setRawText(found.rawText);
    setDocument(null);
    setDraftId(null);
  };

  const handleAnalyze = async () => {
    if (rawText.trim().length < 20) {
      toast.error('Tempelkan Soal Kasus terlebih dahulu (minimal 20 karakter).');
      return;
    }
    setAnalyzing(true);
    try {
      // Key Gemini (bila diisi di panel AI Asisten) → analisis tetap jalan di serverless.
      let apiKey: string | undefined;
      try { apiKey = localStorage.getItem(AI_KEY_STORAGE) ?? undefined; } catch { /* abaikan */ }
      const res = await fetch('/api/data-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText, bankId: isLocalBank(bankId) ? null : bankId, apiKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      let newBank = data.bank as BankRecord;
      if (data.persisted === false) {
        // Server tak bisa menulis DB (serverless) → simpan sebagai bank lokal.
        if (!newBank.id || !newBank.id.startsWith('local_')) {
          newBank = { ...newBank, id: `local_${Date.now().toString(36)}` };
        }
        upsertLocalBank(newBank);
      }
      setBankId(newBank.id);
      setBankFields(newBank.fields ?? []);
      setBankIncidentType(newBank.incidentType);
      void fetchBanks();
      toast.success(`Analisis selesai: ${data.summary.ready} fakta tersimpan, ${data.summary.questions} pertanyaan untuk Anda.`, {
        description: data.persisted === false ? 'Server tidak dapat menyimpan ke database — Bank Data disimpan di browser Anda (lokal).' : undefined,
      });
    } catch (e) {
      toast.error('Analisis Bank Data gagal', { description: (e as Error).message });
    } finally {
      setAnalyzing(false);
    }
  };

  const patchField = async (key: string, label: string, value: string) => {
    if (!bankId) return;
    // Bank lokal → perbarui langsung di localStorage (tanpa server).
    if (isLocalBank(bankId)) {
      const nowIso = new Date().toISOString();
      const updatedFields = applyFieldAnswer(bankFields, key, label, value, nowIso);
      const rec = { id: bankId, caseTitle: null, incidentType: bankIncidentType ?? 'ACCIDENT', rawText, fields: updatedFields, updatedAt: nowIso };
      upsertLocalBank(rec);
      setBankFields(updatedFields);
      setAnswers((prev) => ({ ...prev, [key]: '' }));
      toast.success('Jawaban tersimpan ke Bank Data lokal (browser).');
      return;
    }
    try {
      const res = await fetch(`/api/data-bank/${bankId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, label, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBankFields(data.bank.fields);
      setAnswers((prev) => ({ ...prev, [key]: '' }));
      toast.success('Jawaban tersimpan ke Bank Data (input manual).');
    } catch (e) {
      // DB read-only (serverless) → konversi bank ini menjadi bank lokal dengan jawaban.
      const nowIso = new Date().toISOString();
      const updatedFields = applyFieldAnswer(bankFields, key, label, value, nowIso);
      const localId = `local_${Date.now().toString(36)}`;
      upsertLocalBank({ id: localId, caseTitle: null, incidentType: bankIncidentType ?? 'ACCIDENT', rawText, fields: updatedFields, updatedAt: nowIso });
      setBankId(localId);
      setBankFields(updatedFields);
      setAnswers((prev) => ({ ...prev, [key]: '' }));
      toast.success('Database server tidak dapat ditulis — jawaban disimpan ke Bank Data lokal (browser).', {
        description: (e as Error).message,
      });
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      // Bank lokal → kirim fields + incidentType inline (tanpa akses DB).
      const isLocal = isLocalBank(bankId);
      const res = await fetch('/api/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docType,
          bankId: isLocal ? null : bankId,
          ...(isLocal ? { bankFields: bankFields, incidentType: bankIncidentType ?? undefined } : {}),
          snapshot,
          selectedAssetId: selectedAssetId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDocument(data.document);
      setDraftId(data.draftId);
      toast.success(`Draft ${data.document.title} dibuat — ${data.summary.ready} field READY, ${data.summary.pending + data.summary.actualRequired} perlu data, ${data.summary.questions} pertanyaan.`);
    } catch (e) {
      toast.error('Gagal generate dokumen', { description: (e as Error).message });
    } finally {
      setGenerating(false);
    }
  };

  const bankQuestions = bankFields.filter((f) => f.status === 'PENDING' && f.question);
  const docQuestions = document?.questions ?? [];

  return (
    <div className="space-y-4">
      {/* ================= CARD 1: BANK DATA ================= */}
      <Card className="border-slate-300 shadow-sm bg-white">
        <CardHeader className="bg-slate-100 border-b border-slate-300 py-3 px-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database className="h-5 w-5 text-emerald-700" />
              <div>
                <CardTitle className="text-base font-bold text-slate-900">
                  Bank Data Kasus — Analisis Soal Kasus oleh AI
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Panduan Agent: soal kasus → bank data → pelengkap dokumen bila worksheet/peta belum menyediakan datanya.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => void fetchBanks()} title="Muat ulang daftar bank data">
                <History className="h-4 w-4" /> Riwayat
              </Button>
              {bankId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={async () => {
                    if (isLocalBank(bankId)) {
                      removeLocalBank(bankId);
                      setBankId(null); setBankFields([]); setDocument(null); setDraftId(null);
                      void fetchBanks();
                      toast.success('Bank data lokal dihapus.');
                      return;
                    }
                    try {
                      await fetch(`/api/data-bank/${bankId}`, { method: 'DELETE' });
                      setBankId(null); setBankFields([]); setDocument(null); setDraftId(null);
                      void fetchBanks();
                      toast.success('Bank data dihapus.');
                    } catch { toast.error('Gagal menghapus bank data.'); }
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Hapus
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3 print:hidden">
          {banks.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 shrink-0">Muat bank data tersimpan:</span>
              <Select onValueChange={loadBank} value="">
                <SelectTrigger className="h-8 text-xs w-72"><SelectValue placeholder="Pilih bank data…" /></SelectTrigger>
                <SelectContent>
                  {banks.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {isLocalBank(b.id) ? '💾 ' : ''}{b.caseTitle ?? 'Tanpa judul'} · {b.incidentType}{isLocalBank(b.id) ? ' · lokal' : ''} · {new Date(b.updatedAt).toLocaleString('id-ID')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <textarea
            rows={6}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Tempelkan Soal Kasus SAR di sini (narasi kejadian, waktu TW, koordinat LKP, objek, korban/POB, SRU, cuaca, dst.)…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-mono"
          />
          <div className="flex items-center gap-3">
            <Button onClick={handleAnalyze} disabled={analyzing} className="bg-emerald-700 hover:bg-emerald-800 text-white">
              {analyzing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {analyzing ? 'AI menganalisis…' : 'Analisis Soal Kasus → Bank Data'}
            </Button>
            {bankId && (
              <span className="text-xs text-slate-500">
                Bank aktif: <span className="font-mono">{bankId.slice(0, 10)}…</span>
                {bankIncidentType && <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">{bankIncidentType === 'ACCIDENT' ? 'Format I — Kecelakaan Kapal/Pesawat' : 'Format II — Bencana/KKM'}</span>}
              </span>
            )}
          </div>

          {/* Fakta bank data */}
          {bankFields.length > 0 && (
            <div className="border rounded-md max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Fakta</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Nilai (persis sumber)</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Sumber</th>
                    <th className="text-left px-2 py-1.5 font-semibold text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bankFields.filter((f) => f.status === 'READY').map((f) => (
                    <tr key={f.key} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 text-slate-700">{f.label}</td>
                      <td className="px-2 py-1.5 font-mono text-slate-900" title={f.sourceRef ?? ''}>{f.value}</td>
                      <td className="px-2 py-1.5"><span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{SOURCE_LABEL[f.sourceType]}</span></td>
                      <td className="px-2 py-1.5"><span className={`px-1.5 py-0.5 rounded border ${STATUS_STYLE[f.status]}`}>{f.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pertanyaan AI — AI meminta data ke pengguna */}
          {bankQuestions.length > 0 && (
            <div className="border border-amber-300 bg-amber-50 rounded-md p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <MessageCircleQuestion className="h-4 w-4" />
                AI meminta data berikut (jawab untuk melengkapi Bank Data):
              </div>
              <ul className="space-y-2">
                {bankQuestions.map((q) => (
                  <li key={q.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-xs text-amber-900 sm:w-1/2">• {q.question}</span>
                    <div className="flex gap-1.5 sm:w-1/2">
                      <Input
                        className="h-8 text-xs"
                        placeholder="Jawaban Anda…"
                        value={answers[q.key] ?? ''}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        className="h-8 bg-amber-700 hover:bg-amber-800 text-white"
                        disabled={!(answers[q.key] ?? '').trim()}
                        onClick={() => void patchField(q.key, q.label, answers[q.key] ?? '')}
                      >
                        <Save className="h-3.5 w-3.5" /> Simpan
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================= CARD 2: GENERATOR DOKUMEN ================= */}
      <Card className="border-slate-300 shadow-sm bg-white">
        <CardHeader className="bg-slate-100 border-b border-slate-300 py-3 px-4 print:hidden">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-700" />
            <div>
              <CardTitle className="text-base font-bold text-slate-900">
                Generator Dokumen RENOPS / Briefing / De-Briefing (Perban 3/2020)
              </CardTitle>
              <p className="text-xs text-slate-500">
                Sumber angka: worksheet aplikasi → geometri peta → Bank Data → ditanyakan ke Anda. Agent tidak mengarang nilai.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3 print:hidden">
            <div>
              <label className="text-xs text-slate-500 block mb-1">Dokumen</label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="h-9 text-xs w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="AUTO">RENOPS Otomatis (ikuti jenis kejadian)</SelectItem>
                  <SelectItem value="RENOPS_I">RENOPS Format I — Kecelakaan Kapal/Pesawat</SelectItem>
                  <SelectItem value="RENOPS_II">RENOPS Format II — Bencana/KKM</SelectItem>
                  <SelectItem value="BRIEFING">Briefing Unit Pencarian (Lamp. II B)</SelectItem>
                  <SelectItem value="DEBRIEFING">De-Briefing Unit Pencarian (Lamp. II C)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(docType === 'BRIEFING' || docType === 'DEBRIEFING') && props.assets.length > 0 && (
              <div>
                <label className="text-xs text-slate-500 block mb-1">SRU (untuk briefing per-SRU)</label>
                <Select value={selectedAssetId} onValueChange={setSelectedAssetId}>
                  <SelectTrigger className="h-9 text-xs w-56"><SelectValue placeholder="Pilih SRU…" /></SelectTrigger>
                  <SelectContent>
                    {props.assets.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}{a.assignedSubArea ? ` — ${a.assignedSubArea}` : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button onClick={handleGenerate} disabled={generating} className="bg-slate-900 hover:bg-slate-800 text-white">
              {generating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ClipboardCheck className="h-4 w-4 mr-1" />}
              Generate Draft Dokumen
            </Button>
            {document && (
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1" /> Cetak
              </Button>
            )}
          </div>

          {/* Validasi ringkas */}
          {document && (
            <div className="flex flex-wrap gap-2 text-xs print:hidden">
              <span className="px-2 py-1 rounded border bg-emerald-100 text-emerald-800 border-emerald-300">READY: {document.validation.ready}</span>
              <span className="px-2 py-1 rounded border bg-amber-100 text-amber-800 border-amber-300">PENDING: {document.validation.pending}</span>
              {document.validation.actualRequired > 0 && (
                <span className="px-2 py-1 rounded border bg-violet-100 text-violet-800 border-violet-300">ACTUAL_REQUIRED: {document.validation.actualRequired}</span>
              )}
              {document.validation.conflict > 0 && (
                <span className="px-2 py-1 rounded border bg-red-100 text-red-800 border-red-300">CONFLICT: {document.validation.conflict}</span>
              )}
              {draftId && <span className="px-2 py-1 rounded border bg-slate-100 text-slate-600">Draft ID: {draftId.slice(0, 12)}… (riwayat untuk approval SMC)</span>}
            </div>
          )}

          {/* Pertanyaan dokumen */}
          {docQuestions.length > 0 && (
            <div className="border border-amber-300 bg-amber-50 rounded-md p-3 space-y-2 print:hidden">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" />
                Data belum tersedia — AI meminta kepada Anda:
              </div>
              <ul className="space-y-2">
                {docQuestions.map((q) => (
                  <li key={q.key} className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-xs text-amber-900 sm:w-1/2">• {q.question}</span>
                    <div className="flex gap-1.5 sm:w-1/2">
                      <Input
                        className="h-8 text-xs"
                        placeholder="Jawaban Anda…"
                        value={answers[q.key] ?? ''}
                        onChange={(e) => setAnswers((prev) => ({ ...prev, [q.key]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        className="h-8 bg-amber-700 hover:bg-amber-800 text-white"
                        disabled={!(answers[q.key] ?? '').trim() || !bankId}
                        title={bankId ? 'Simpan ke Bank Data lalu regenerate' : 'Analisis Soal Kasus dulu untuk mengaktifkan penyimpanan'}
                        onClick={async () => {
                          await patchField(q.key, q.label, answers[q.key] ?? '');
                          await handleGenerate();
                        }}
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Simpan &amp; Regenerate
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Render dokumen resmi */}
          {document && (
            <div className="border-2 border-slate-800 rounded-md p-6 space-y-5 bg-white text-slate-800 text-xs print:border-none">
              <div className="text-center border-b-2 border-slate-900 pb-3">
                <h2 className="text-base font-bold uppercase tracking-wider">{document.title}</h2>
                <h3 className="text-sm font-semibold uppercase mt-1">{document.subtitle}</h3>
                <p className="text-[10px] text-slate-500 mt-1">Format resmi Perban No. 3 Tahun 2020 — draft otomatis, wajib review/approval SMC</p>
              </div>

              {document.sections.map((section) => (
                <div key={section.id} className="space-y-2">
                  <h4 className="text-sm font-bold uppercase border-b border-slate-300 pb-1">{section.title}</h4>
                  {section.narrative?.map((p, i) => (
                    <p key={i} className="leading-relaxed text-slate-800 text-justify">{p}</p>
                  ))}
                  {section.fields && section.fields.length > 0 && (
                    <table className="w-full border border-slate-400 text-[11px]">
                      <tbody>
                        {section.fields.map((f) => (
                          <tr key={f.key} className="border-t first:border-t-0 border-slate-200">
                            <td className="px-2 py-1 w-2/5 bg-slate-50 align-top font-medium text-slate-700">{f.label}{f.unit ? ` (${f.unit})` : ''}</td>
                            <td className={`px-2 py-1 align-top ${f.value === PENDING_TEXT ? 'text-amber-700 italic' : 'font-mono'}`} title={`Sumber: ${SOURCE_LABEL[f.sourceType]}${f.sourceRef ? ` — ${f.sourceRef}` : ''}`}>
                              {f.value}
                              <span className="ml-1 text-[9px] text-slate-400">[{SOURCE_LABEL[f.sourceType]}{f.status !== 'READY' && f.status !== 'ACTUAL_REQUIRED' ? '' : ` · ${f.status}`}]</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {section.tables?.map((t, ti) => (
                    <div key={ti} className="space-y-1">
                      {t.title && <p className="font-semibold text-slate-700">{t.title}</p>}
                      <table className="w-full border border-slate-400 text-[11px]">
                        <thead>
                          <tr className="bg-slate-100">
                            {t.columns.map((c) => (
                              <th key={c} className="border border-slate-300 px-2 py-1 text-left font-semibold">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {t.rows.map((row, ri) => (
                            <tr key={ri}>
                              {row.map((cell, ci) => (
                                <td key={ci} className={`border border-slate-300 px-2 py-1 align-top ${cell === PENDING_TEXT ? 'text-amber-700 italic' : ''}`}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {t.provenance && t.provenance.length > 0 && (
                        <ul className="text-[10px] text-slate-500 list-disc pl-4">
                          {t.provenance.map((p, pi) => <li key={pi}>{p}</li>)}
                        </ul>
                      )}
                    </div>
                  ))}
                  {section.note && (
                    <p className="text-[10px] italic text-slate-500">Catatan: {section.note}</p>
                  )}
                </div>
              ))}

              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-300">
                <div className="text-center">
                  <p>Tempat, tanggal</p>
                  <div className="mt-10 border-t border-slate-400 w-48 mx-auto" />
                  <p className="mt-1 text-[10px] text-slate-500">Koordinator Misi Pencarian dan Pertolongan</p>
                  <p className="text-[10px] text-slate-500">Nama / Golongan-Jabatan-NIP (diisi pejabat berwenang)</p>
                </div>
                <div className="text-center">
                  <p>Verifikasi draft</p>
                  <div className="mt-10 border-t border-slate-400 w-48 mx-auto" />
                  <p className="mt-1 text-[10px] text-slate-500">SMC / Pejabat Berwenang (tanda tangan &amp; persetujuan)</p>
                </div>
              </div>
            </div>
          )}

          {!document && (
            <div className="text-center py-6 text-slate-400 text-sm print:hidden">
              Belum ada draft. Analisis Soal Kasus → lengkapi worksheet/peta → tekan <span className="font-semibold">Generate Draft Dokumen</span>.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
