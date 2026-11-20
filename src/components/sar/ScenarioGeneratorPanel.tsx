'use client';

/**
 * SCENARIO GENERATOR PANEL (Fase 5a AI Copilot) — UI instruktur untuk:
 *  1. Generator soal ber-parameter (seed, jenis insiden, wilayah, kesulitan,
 *     jebakan terkontrol) → pratinjau naskah gaya PK-TAL + kelengkapan +
 *     coverage + tombol "Terapkan ke Worksheet" (jalur apply Fase 3 yang ada).
 *  2. Bank lokasi & aset (editor master data DRAFT/APPROVED — keputusan no. 7).
 *
 * Angka pratinjau 100% dari server (deterministik ber-seed, tanpa LLM).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Sparkles, ClipboardCopy, CheckCircle2, AlertTriangle, Wand2, Database, Printer } from 'lucide-react';
import type { CaseApplyStep } from '@/lib/ai/parseCase';
import type { NaskahBlock } from '@/lib/sar/caseNaskah';
import type { BankEntryApi } from '@/lib/sar/scenarioBank';

// ---------------------------------------------------------------------------
// Tipe respons API
// ---------------------------------------------------------------------------

interface Capabilities {
  version?: string;
  difficulties: string[];
  traps: Array<{ id: string; label: string; minDifficulty: string }>;
  knobs?: Record<string, { min: number; max: number; label: string }>;
  regions: Array<{ id: string; name: string; timeZone: string }>;
  incidentTypes: Array<{ id: string; label: string }>;
  narrativeStyles?: Array<{ id: string; label: string }>;
  defaultIncidentDateISO: string;
  bank: {
    sruUsableAssets: Array<{ id: string; name: string; category: string; verification: string }>;
    targetAssets: Array<{ id: string; name: string; category: string; verification: string }>;
    offices: Array<{ id: string; name: string; region?: string; verification: string }>;
  };
}

interface AnswerKeyStageUi {
  no: number;
  worksheet: string;
  title: string;
  inputs: Array<{ label: string; value: string; refTable?: string }>;
  steps: Array<{ label: string; formula?: string; result: string; unit?: string; refTable?: string }>;
  resultSummary: string;
}

interface AnswerKeyUi {
  caseTitle: string;
  incidentType: string;
  generatorVersion: string;
  seed: string;
  stages: AnswerKeyStageUi[];
  references: Array<{ id: string; title: string; usage: string }>;
  rubric: Array<{ item: string; worksheet: string; weight: number; criteria: string }>;
  totalScore: number;
  notes: string[];
}

interface GenerateResponse {
  case: Record<string, unknown>;
  naskah: { caseTitle: string; blocks: NaskahBlock[]; text: string; coveredFields: Record<string, string> };
  narrative?: { style: string; text: string; requestedStyle: string };
  coverage: { covered: boolean; total: number; coveredCount: number; issues: Array<{ field: string; expected: string; reason: string }> };
  completeness: { complete: boolean; missingCount: number; assumedCount: number; issues: Array<{ field: string; worksheet: string; status: string; reason: string }> };
  applyPlan: { steps: CaseApplyStep[]; skipped: Array<{ worksheet: string; reason: string }> };
  planValidation?: { ok: boolean; errorCount: number; warningCount: number; infoCount: number; issues: Array<{ level: string; field: string; message: string }> };
  appliedTraps: string[];
  skippedTraps: Array<{ trap: string; reason: string }>;
  resolvedKnobs?: { sruCount: number; stagesBefore: number; envDataPoints: number; districtDataCount: number; trapCount: number };
  warnings: string[];
  params: { seed: string; incidentType: string; regionId: string; difficulty: string; incidentDateISO: string; sruCount: number };
  answerKey?: AnswerKeyUi | null;
}

const INCIDENT_LABELS: Record<string, string> = {
  'aircraft-ditching': 'Pesawat ditching di laut',
  'aircraft-land-crash': 'Pesawat jatuh di darat',
  'vessel-sinking': 'Kapal darurat / tenggelam',
  'person-overboard': 'Man Overboard (orang jatuh ke laut)',
  'missing-person-land': 'Orang hilang / pencarian darat',
};

const STYLE_LABELS: Record<string, string> = {
  'formal-ujian': 'Formal ujian kedinasan',
  'narasi-operasional': 'Narasi operasional',
  'skenario-simulasi': 'Skenario simulasi kejadian',
  'otomatis': 'Variasi otomatis (dari seed)',
};

const DIFFICULTY_LABELS: Record<string, string> = {
  mudah: 'Mudah — data rapi, tanpa jebakan',
  sedang: 'Sedang — 2 jebakan konversi',
  sulit: 'Sulit — 3-5 jebakan + data menuntut tafsiran',
};

const VERIFICATION_BADGE: Record<string, string> = {
  VERIFIED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  UNVERIFIED: 'bg-amber-100 text-amber-800 border-amber-300',
  MISSING: 'bg-rose-100 text-rose-800 border-rose-300',
  SIMULATION: 'bg-sky-100 text-sky-800 border-sky-300',
};

// ---------------------------------------------------------------------------
// Komponen utama
// ---------------------------------------------------------------------------

export interface ScenarioGeneratorPanelProps {
  /** Handler penerapan langkah kasus ke worksheet (jalur Fase 3 yang ada). */
  onApplyCaseSteps?: (steps: CaseApplyStep[]) => { applied: string[]; failed: string[] };
}

export default function ScenarioGeneratorPanel({ onApplyCaseSteps }: ScenarioGeneratorPanelProps) {
  const [caps, setCaps] = useState<Capabilities | null>(null);

  // ── Form parameter ──
  const [seed, setSeed] = useState('latihan-001');
  const [incidentType, setIncidentType] = useState('aircraft-ditching');
  const [regionId, setRegionId] = useState('selat-sunda');
  const [difficulty, setDifficulty] = useState('sedang');
  const [style, setStyle] = useState('otomatis');
  const [sruCount, setSruCount] = useState('3');
  const [stagesBefore, setStagesBefore] = useState('');
  const [envDataPoints, setEnvDataPoints] = useState('');
  const [districtDataCount, setDistrictDataCount] = useState('');
  const [trapCount, setTrapCount] = useState('');
  const [incidentDate, setIncidentDate] = useState('2026-11-18');
  const [examTitle, setExamTitle] = useState('SOAL LATIHAN');
  const [angkatan, setAngkatan] = useState('');
  const [traps, setTraps] = useState<string[]>([]);

  // ── Hasil ──
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [showAnswerKey, setShowAnswerKey] = useState(false);
  const [llmNarrative, setLlmNarrative] = useState<{ text: string; style: string; fallback?: boolean; detail?: string } | null>(null);
  const [llmLoading, setLlmLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [applyResult, setApplyResult] = useState<string | null>(null);

  // ── Bank editor ──
  const [bankEntries, setBankEntries] = useState<BankEntryApi[]>([]);
  const [bankSource, setBankSource] = useState<string>('');
  const [bankLoading, setBankLoading] = useState(false);
  const [bankKind, setBankKind] = useState<'location' | 'asset'>('location');
  const [editEntry, setEditEntry] = useState<BankEntryApi | null>(null);
  const [bankMessage, setBankMessage] = useState<string | null>(null);

  const loadBank = useCallback((kind: 'location' | 'asset') => {
    setBankLoading(true);
    fetch(`/api/scenario-bank?kind=${kind}`)
      .then((r) => r.json())
      .then((data: { source: string; entries: BankEntryApi[]; warning?: string }) => {
        setBankEntries(data.entries ?? []);
        setBankSource(data.source);
        setBankMessage(data.warning ?? null);
      })
      .catch(() => setBankMessage('Bank data gagal dimuat.'))
      .finally(() => setBankLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/case-generator')
      .then((r) => r.json())
      .then((data: Capabilities) => {
        setCaps(data);
        if (data.defaultIncidentDateISO) setIncidentDate(data.defaultIncidentDateISO);
      })
      .catch(() => setError('Kapabilitas generator tidak dapat dimuat.'));
    loadBank('location');
  }, [loadBank]);

  const handleGenerate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setApplyResult(null);
    setLlmNarrative(null);
    try {
      const res = await fetch('/api/case-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed,
          incidentType,
          regionId,
          difficulty,
          style,
          includeAnswerKey: true,
          sruCount: sruCount === '' ? undefined : Number(sruCount),
          stagesBefore: stagesBefore === '' ? undefined : Number(stagesBefore),
          envDataPoints: envDataPoints === '' ? undefined : Number(envDataPoints),
          districtDataCount: districtDataCount === '' ? undefined : Number(districtDataCount),
          trapCount: trapCount === '' ? undefined : Number(trapCount),
          incidentDateISO: incidentDate,
          traps: traps.length > 0 ? traps : undefined,
          examHeader: {
            title: examTitle || undefined,
            angkatan: angkatan || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Generate gagal.');
      setResult(data as GenerateResponse);
      setShowAnswerKey(false);
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [seed, incidentType, regionId, difficulty, style, sruCount, stagesBefore, envDataPoints, districtDataCount, trapCount, incidentDate, examTitle, angkatan, traps]);

  /** Variasi narasi via LLM (ter-guard: coverage + parse-back + daftar putih
   *  angka; gagal → kembali ke narasi deterministik). */
  const handleLlmNarrative = useCallback(async () => {
    if (!result) return;
    setLlmLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/case-generator/narrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          case: result.case,
          style,
          seed: result.params.seed,
          explicitSearchNumber: !result.appliedTraps.includes('search-number-inference'),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const fallback = data.fallback as { narrative: string; style: string } | undefined;
        setLlmNarrative({
          text: fallback?.narrative ?? '',
          style: fallback?.style ?? style,
          fallback: true,
          detail: data.checks ? `guardrail: ${JSON.stringify(data.checks).slice(0, 220)}` : (data.error ?? 'LLM gagal.'),
        });
        return;
      }
      setLlmNarrative({ text: data.narrative, style: data.style });
    } catch (e) {
      setLlmNarrative({ text: '', style, fallback: true, detail: (e as Error).message });
    } finally {
      setLlmLoading(false);
    }
  }, [result, style]);

  const handleApply = useCallback(() => {
    if (!result || !onApplyCaseSteps) return;
    const { applied, failed } = onApplyCaseSteps(result.applyPlan.steps);
    setApplyResult(`Diterapkan: ${applied.length} langkah${failed.length > 0 ? `; gagal: ${failed.join(', ')}` : ''}.`);
  }, [result, onApplyCaseSteps]);

  const handleCopyJson = useCallback(() => {
    if (!result) return;
    void navigator.clipboard.writeText(JSON.stringify(result.case, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [result]);

  const handleDownloadJson = useCallback(() => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.case, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soal-${result.params.seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const trapOptions = useMemo(() => {
    if (!caps) return [];
    return caps.traps.filter((t) => {
      if (t.minDifficulty === 'mudah') return true;
      if (t.minDifficulty === 'sedang') return difficulty !== 'mudah';
      return difficulty === 'sulit';
    });
  }, [caps, difficulty]);

  const toggleTrap = (id: string) => {
    setTraps((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const randomSeed = () => {
    setSeed(`latihan-${Math.random().toString(36).slice(2, 8)}`);
  };

  // ── Bank editor helpers ──
  const saveBankEntry = async (entry: BankEntryApi) => {
    setBankLoading(true);
    try {
      const res = await fetch(`/api/scenario-bank/${entry.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Simpan gagal.');
      setBankMessage('Entri tersimpan ke database.');
      setEditEntry(null);
      loadBank(bankKind);
    } catch (e) {
      setBankMessage((e as Error).message);
    } finally {
      setBankLoading(false);
    }
  };

  const approveBankEntry = async (entry: BankEntryApi) => {
    await saveBankEntry({ ...entry, approval: entry.approval === 'APPROVED' ? 'DRAFT' : 'APPROVED' });
  };

  const seedBank = async () => {
    setBankLoading(true);
    try {
      const res = await fetch('/api/scenario-bank?action=seed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Seed gagal.');
      setBankMessage(`Seed JSON diunggah ke database (${data.upserted} entri).`);
      loadBank(bankKind);
    } catch (e) {
      setBankMessage((e as Error).message);
    } finally {
      setBankLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* ── Form parameter ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-violet-600" /> Generator Soal Latihan (ber-seed, deterministik)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Seed (kunci soal)</Label>
              <div className="flex gap-1.5">
                <Input value={seed} onChange={(e) => setSeed(e.target.value)} className="h-8 text-xs font-mono" />
                <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={randomSeed}>
                  Acak
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Jenis kejadian</Label>
              <Select value={incidentType} onValueChange={setIncidentType}>
                <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectValue className="truncate" /></SelectTrigger>
                <SelectContent>
                  {(caps?.incidentTypes?.length ? caps.incidentTypes.map((t) => ({ value: t.id, label: t.label })) : Object.entries(INCIDENT_LABELS).map(([value, label]) => ({ value, label }))).map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Gaya bahasa narasi</Label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectValue className="truncate" /></SelectTrigger>
                <SelectContent>
                  {(caps?.narrativeStyles?.length ? caps.narrativeStyles.map((s) => ({ value: s.id, label: s.label })) : Object.entries(STYLE_LABELS).map(([value, label]) => ({ value, label }))).map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Wilayah</Label>
              <Select value={regionId} onValueChange={setRegionId}>
                <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectValue className="truncate" /></SelectTrigger>
                <SelectContent>
                  {(caps?.regions ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name} ({r.timeZone})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tingkat kesulitan</Label>
              <Select value={difficulty} onValueChange={(v) => { setDifficulty(v); setTraps([]); }}>
                <SelectTrigger className="w-full min-w-0 h-8 text-xs"><SelectValue className="truncate" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DIFFICULTY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Jumlah SRU (2-4)</Label>
              <Input type="number" min={2} max={4} value={sruCount} onChange={(e) => setSruCount(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" title="Kosong = default kesulitan">Stage pencarian sebelumnya (0-4)</Label>
              <Input type="number" min={0} max={4} value={stagesBefore} onChange={(e) => setStagesBefore(e.target.value)} placeholder="default" className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" title="Kosong = default kesulitan (grid 6 jam, otomatis ke 3 jam bila > 6)">Data lingkungan (4-12)</Label>
              <Input type="number" min={4} max={12} value={envDataPoints} onChange={(e) => setEnvDataPoints(e.target.value)} placeholder="default" className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" title="Kantor SAR/instansi pendukung yang disebut di naskah">Distrik data (0-5)</Label>
              <Input type="number" min={0} max={5} value={districtDataCount} onChange={(e) => setDistrictDataCount(e.target.value)} placeholder="default" className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs" title="Kosong = default kesulitan; sulit mendukung 4-5">Jumlah jebakan analisis (0-6)</Label>
              <Input type="number" min={0} max={6} value={trapCount} onChange={(e) => setTrapCount(e.target.value)} placeholder="default" className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tanggal kejadian</Label>
              <Input type="date" value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Judul naskah</Label>
              <Input value={examTitle} onChange={(e) => setExamTitle(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Angkatan (opsional)</Label>
              <Input value={angkatan} onChange={(e) => setAngkatan(e.target.value)} placeholder="mis. XI" className="h-8 text-xs" />
            </div>
          </div>

          {/* Jebakan terkontrol */}
          <div className="space-y-2">
            <Label className="text-xs">Jebakan terkontrol (opsional — kosong = otomatis per kesulitan)</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
              {trapOptions.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-xs p-1.5 rounded border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  <Checkbox checked={traps.includes(t.id)} onCheckedChange={() => toggleTrap(t.id)} className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" onClick={handleGenerate} disabled={loading} className="h-8 text-xs bg-violet-600 hover:bg-violet-700 text-white">
              {loading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
              Generate Soal
            </Button>
            {result && (
              <>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleCopyJson}>
                  {copied ? <CheckCircle2 className="h-3.5 w-3.5 mr-1 text-emerald-600" /> : <ClipboardCopy className="h-3.5 w-3.5 mr-1" />}
                  Salin JSON Kasus
                </Button>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={handleDownloadJson}>
                  Unduh JSON
                </Button>
                {onApplyCaseSteps && (
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={handleApply}>
                    Terapkan ke Worksheet ({result.applyPlan.steps.length} langkah)
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => window.print()}>
                  <Printer className="h-3.5 w-3.5 mr-1" /> Cetak Pratinjau
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
                  onClick={handleLlmNarrative}
                  disabled={llmLoading}
                  title="LLM menulis ulang paragraf narasi — nilai dikunci oleh guardrail (coverage + parse-back + daftar putih angka)"
                >
                  {llmLoading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
                  Variasi Narasi LLM
                </Button>
                <Button
                  type="button"
                  variant={showAnswerKey ? 'default' : 'outline'}
                  size="sm"
                  className={`h-8 text-xs ${showAnswerKey ? 'bg-slate-800 text-white' : 'border-slate-300'}`}
                  onClick={() => setShowAnswerKey((v) => !v)}
                >
                  {showAnswerKey ? 'Sembunyikan Kunci Jawaban' : 'Kunci Jawaban Instruktur'}
                </Button>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {applyResult && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">{applyResult}</div>
          )}
        </CardContent>
      </Card>

      {/* ── Hasil generate ── */}
      {result && (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="bg-white">Seed: {result.params.seed}</Badge>
            <Badge variant="outline" className="bg-white">Wilayah: {result.params.regionId}</Badge>
            <Badge variant="outline" className="bg-white">Kesulitan: {result.params.difficulty}</Badge>
            {result.narrative && <Badge variant="outline" className="bg-fuchsia-50 text-fuchsia-800 border-fuchsia-300">gaya: {STYLE_LABELS[result.narrative.style] ?? result.narrative.style}</Badge>}
            {result.resolvedKnobs && (
              <Badge variant="outline" className="bg-white">
                knob: SRU {result.resolvedKnobs.sruCount} · stage {result.resolvedKnobs.stagesBefore} · lingkungan {result.resolvedKnobs.envDataPoints} · distrik {result.resolvedKnobs.districtDataCount} · jebakan {result.resolvedKnobs.trapCount}
              </Badge>
            )}
            <Badge variant="outline" className="bg-white">SRU: {result.params.sruCount}</Badge>
            {result.appliedTraps.length > 0 ? (
              result.appliedTraps.map((t) => (
                <Badge key={t} variant="outline" className="bg-violet-50 text-violet-800 border-violet-300">jebakan: {t}</Badge>
              ))
            ) : (
              <Badge variant="outline" className="bg-white">tanpa jebakan</Badge>
            )}
            <Badge variant="outline" className={result.completeness.complete ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-rose-50 text-rose-800 border-rose-300'}>
              kelengkapan kasus: {result.completeness.complete ? 'LENGKAP' : `kurang ${result.completeness.missingCount}`}
            </Badge>
            <Badge variant="outline" className={result.coverage.covered ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-rose-50 text-rose-800 border-rose-300'}>
              coverage naskah: {result.coverage.coveredCount}/{result.coverage.total}
            </Badge>
            {result.planValidation && (
              <Badge variant="outline" className={result.planValidation.ok ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-rose-50 text-rose-800 border-rose-300'}>
                validate_plan: {result.planValidation.ok ? 'OK' : `${result.planValidation.errorCount} error`}
              </Badge>
            )}
            <Badge variant="outline" className="bg-sky-50 text-sky-800 border-sky-300">SIMULATION — data latihan</Badge>
          </div>

          {(result.warnings.length > 0 || result.skippedTraps.length > 0) && (
            <div className="text-xs space-y-1">
              {result.warnings.map((w, i) => (
                <div key={`w-${i}`} className="text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5">Peringatan: {w}</div>
              ))}
              {result.skippedTraps.map((s) => (
                <div key={`st-${s.trap}`} className="text-amber-700 bg-amber-50 border border-amber-200 rounded p-1.5">
                  Jebakan &quot;{s.trap}&quot; dilewati — {s.reason}.
                </div>
              ))}
            </div>
          )}

          {!result.completeness.complete && (
            <div className="text-xs bg-rose-50 border border-rose-200 rounded p-2 space-y-0.5">
              {result.completeness.issues.filter((i) => i.status === 'MISSING').map((i) => (
                <div key={i.field}><strong>{i.field}</strong> ({i.worksheet}): {i.reason}</div>
              ))}
            </div>
          )}

          {/* Pratinjau naskah gaya PK-TAL */}
          <Card className="print:shadow-none print:border-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Pratinjau Naskah (struktur PK-TAL — tabel referensi tidak dicetak)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="naskah-preview max-h-[520px] overflow-y-auto rounded border border-slate-200 bg-white p-6 space-y-4 text-slate-900">
                {result.naskah.blocks.map((block, idx) => {
                  switch (block.kind) {
                    case 'identity':
                      return (
                        <div key={idx} className="flex justify-between items-start">
                          <div className="border border-slate-400 rounded p-2 text-xs space-y-1 min-w-[220px]">
                            {block.fields.map((f) => (
                              <div key={f} className="flex justify-between gap-6"><span>{f}</span><span>:</span></div>
                            ))}
                          </div>
                          <div className="text-right text-xs space-y-1">
                            {block.openBook && <div className="font-bold italic">Open Book</div>}
                            {block.date && <div className="font-bold italic">{block.date}</div>}
                          </div>
                        </div>
                      );
                    case 'title':
                      return (
                        <div key={idx} className="text-center space-y-0.5">
                          {block.lines.map((l, li) => (
                            <div key={li} className={li === 0 ? 'font-bold text-base' : li === 1 ? 'font-semibold text-sm' : 'font-bold text-sm'}>{l}</div>
                          ))}
                        </div>
                      );
                    case 'paragraph':
                      return (
                        <p key={idx} className={`text-justify text-[13px] leading-relaxed ${block.bold ? 'font-bold' : ''}`}>{block.text}</p>
                      );
                    case 'section':
                      return (
                        <div key={idx} className="font-semibold text-[13px] pt-2">{block.number}. {block.title}</div>
                      );
                    case 'bullets':
                      return (
                        <ul key={idx} className="list-disc pl-6 space-y-1 text-[13px]">
                          {block.items.map((item, li) => <li key={li}>{item}</li>)}
                        </ul>
                      );
                    case 'numbered':
                      return (
                        <ol key={idx} className="list-decimal pl-6 space-y-1 text-[13px]">
                          {block.items.map((item, li) => <li key={li}>{item}</li>)}
                        </ol>
                      );
                    case 'labelValue':
                      return (
                        <div key={idx} className="space-y-0.5 text-[13px]">
                          {block.rows.map((r) => (
                            <div key={r.label} className="flex gap-2">
                              <span className="w-40 shrink-0">{r.label}</span>
                              <span>: {r.value}</span>
                            </div>
                          ))}
                        </div>
                      );
                    case 'table':
                      return (
                        <div key={idx} className="overflow-x-auto">
                          <table className="w-full border-collapse text-[12px]">
                            <thead>
                              <tr>
                                {block.columns.map((c, ci) => (
                                  <th key={`${ci}-${c}`} className="border border-slate-400 px-2 py-1 bg-slate-100 font-bold">{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {block.rows.map((row, ri) => (
                                <tr key={ri}>
                                  {row.map((cell, ci) => (
                                    <td key={ci} className={`border border-slate-400 px-2 py-1 ${ci === 0 ? 'font-semibold' : 'text-center'}`}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    case 'note':
                      return (
                        <div key={idx} className="text-[11px] text-slate-500 italic border-t border-slate-200 pt-2">{block.text}</div>
                      );
                    default:
                      return null;
                  }
                })}
              </div>
              {llmNarrative && (
                <div className={`mt-3 rounded border p-3 text-sm leading-relaxed ${llmNarrative.fallback ? 'border-amber-300 bg-amber-50' : 'border-fuchsia-300 bg-fuchsia-50'}`}>
                  <div className="mb-1.5 text-xs font-semibold text-slate-700">
                    {llmNarrative.fallback
                      ? `Narasi LLM ditolak guardrail — memakai narasi deterministik. ${llmNarrative.detail ?? ''}`
                      : `Narasi LLM (gaya ${STYLE_LABELS[llmNarrative.style] ?? llmNarrative.style}) — lulus guardrail coverage + parse-back + daftar putih angka`}
                  </div>
                  <p className="whitespace-pre-line">{llmNarrative.text}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {!result.coverage.covered && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm text-rose-700">case_completeness_check — field tidak tercetak di naskah</CardTitle></CardHeader>
              <CardContent className="text-xs space-y-1">
                {result.coverage.issues.map((i) => (
                  <div key={i.field}><strong>{i.field}</strong>: {i.reason}</div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Kunci jawaban instruktur */}
          {showAnswerKey && result.answerKey && (
            <Card className="border-slate-400">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-slate-800 text-white text-xs font-bold">K</span>
                  Kunci Jawaban Instruktur — {result.answerKey.stages.length} tahapan, rubrik {result.answerKey.totalScore} poin
                  <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-300">rahasia — untuk instruktur</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                {result.answerKey.notes.map((n, i) => (
                  <div key={`n-${i}`} className="text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5">{n}</div>
                ))}
                {result.answerKey.stages.map((stage) => (
                  <div key={`s-${stage.no}`} className="rounded border border-slate-200 overflow-hidden">
                    <div className="bg-slate-100 px-3 py-1.5 font-semibold text-slate-800">
                      {stage.no}. {stage.worksheet} — {stage.title}
                    </div>
                    <div className="p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                        {stage.inputs.map((inp, ii) => (
                          <div key={`i-${ii}`} className="flex justify-between gap-3 border-b border-dashed border-slate-100 pb-0.5">
                            <span className="text-slate-600">{inp.label}{inp.refTable ? ` (${inp.refTable})` : ''}</span>
                            <span className="font-medium text-right">{inp.value}</span>
                          </div>
                        ))}
                      </div>
                      <div className="space-y-1">
                        {stage.steps.map((st, si) => (
                          <div key={`st-${si}`} className="flex flex-wrap items-baseline gap-x-2">
                            <span className="font-medium text-slate-800">{st.label}</span>
                            {st.formula && <span className="text-slate-500 font-mono">= {st.formula}</span>}
                            <span className="font-bold text-slate-900">{st.result}{st.unit ? ` ${st.unit}` : ''}</span>
                            {st.refTable && <Badge variant="outline" className="h-4 px-1 text-[10px] bg-slate-50">{st.refTable}</Badge>}
                          </div>
                        ))}
                      </div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded px-2 py-1 text-emerald-900 font-medium">{stage.resultSummary}</div>
                    </div>
                  </div>
                ))}
                <div className="rounded border border-slate-200 overflow-hidden">
                  <div className="bg-slate-100 px-3 py-1.5 font-semibold text-slate-800">Sumber referensi tabel</div>
                  <div className="p-3 space-y-1">
                    {result.answerKey.references.map((ref) => (
                      <div key={ref.id}><Badge variant="outline" className="h-4 px-1 text-[10px] bg-slate-50 mr-1">{ref.id}</Badge><span className="font-medium">{ref.title}</span> — {ref.usage}</div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-slate-200 overflow-hidden">
                  <div className="bg-slate-100 px-3 py-1.5 font-semibold text-slate-800">Rubrik penilaian (total {result.answerKey.totalScore})</div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="text-left px-2 py-1 font-semibold">Tugas</th>
                        <th className="text-left px-2 py-1 font-semibold">Worksheet</th>
                        <th className="text-right px-2 py-1 font-semibold w-16">Bobot</th>
                        <th className="text-left px-2 py-1 font-semibold">Kriteria</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.answerKey.rubric.map((r) => (
                        <tr key={r.item} className="border-t border-slate-100">
                          <td className="px-2 py-1 font-mono">{r.item}</td>
                          <td className="px-2 py-1">{r.worksheet}</td>
                          <td className="px-2 py-1 text-right font-bold">{r.weight}</td>
                          <td className="px-2 py-1 text-slate-600">{r.criteria}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── Bank lokasi & aset ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Database className="h-4 w-4 text-sky-600" /> Bank Lokasi &amp; Katalog Aset
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {(['location', 'asset'] as const).map((k) => (
                <Button
                  key={k}
                  type="button"
                  size="sm"
                  variant={bankKind === k ? 'default' : 'outline'}
                  className={`h-7 text-xs ${bankKind === k ? 'bg-sky-600 text-white' : ''}`}
                  onClick={() => { setBankKind(k); loadBank(k); }}
                >
                  {k === 'location' ? 'Lokasi' : 'Aset'}
                </Button>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={seedBank} disabled={bankLoading}>
              Unggah Seed JSON ke DB
            </Button>
            {bankSource && (
              <Badge variant="outline" className={bankSource === 'db' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-amber-50 text-amber-800 border-amber-300'}>
                sumber: {bankSource === 'db' ? 'database' : 'seed JSON (bawaan)'}
              </Badge>
            )}
            <span className="text-xs text-slate-500">{bankEntries.length} entri</span>
          </div>

          {bankMessage && <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded p-1.5">{bankMessage}</div>}

          {bankLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-4"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Memuat…</div>
          ) : (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="text-left px-2 py-1.5 font-semibold">Nama</th>
                    <th className="text-left px-2 py-1.5 font-semibold">Kategori</th>
                    <th className="text-left px-2 py-1.5 font-semibold">Koordinat</th>
                    <th className="text-left px-2 py-1.5 font-semibold">Verifikasi</th>
                    <th className="text-left px-2 py-1.5 font-semibold">Approval</th>
                    <th className="text-left px-2 py-1.5 font-semibold">Sumber</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {bankEntries.map((entry) => (
                    <tr key={entry.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-1.5 font-medium">{entry.name}</td>
                      <td className="px-2 py-1.5">{entry.category}</td>
                      <td className="px-2 py-1.5 font-mono text-[11px]">
                        {entry.lat !== undefined && entry.lat !== null ? `${entry.lat.toFixed(4)}, ${entry.lng?.toFixed(4)}` : '—'}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className={`text-[10px] px-1 py-0 ${VERIFICATION_BADGE[entry.verification] ?? ''}`}>{entry.verification}</Badge>
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className={`text-[10px] px-1 py-0 ${entry.approval === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-slate-100 text-slate-600 border-slate-300'}`}>{entry.approval}</Badge>
                      </td>
                      <td className="px-2 py-1.5 max-w-[220px] truncate" title={entry.source}>{entry.source}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        <Button type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px] mr-1" onClick={() => setEditEntry(entry)}>Edit</Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className={`h-6 px-1.5 text-[10px] ${entry.approval === 'DRAFT' ? 'border-emerald-300 text-emerald-700' : ''}`}
                          onClick={() => approveBankEntry(entry)}
                        >
                          {entry.approval === 'DRAFT' ? 'Setujui' : 'Batalkan'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[11px] text-slate-500">
            Setiap entri wajib memuat sumber, tanggal pembaruan, satuan, dan status verifikasi (keputusan no. 7). Data baru berstatus DRAFT sampai disetujui.
            Entri SIMULATION adalah data sintetis latihan — tidak untuk operasi nyata.
          </p>
        </CardContent>
      </Card>

      {/* ── Dialog edit entri bank ── */}
      <Dialog open={editEntry !== null} onOpenChange={(open) => { if (!open) setEditEntry(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          {editEntry && (
            <>
              <DialogHeader>
                <DialogTitle className="text-sm">Edit Entri Bank — {editEntry.id}</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-xs">
                <div className="space-y-1"><Label>Nama</Label><Input className="h-8" value={editEntry.name} onChange={(e) => setEditEntry({ ...editEntry, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Latitude (desimal, S negatif)</Label>
                    <Input
                      className="h-8 font-mono"
                      type="number" step="0.000001"
                      value={editEntry.lat ?? ''}
                      onChange={(e) => setEditEntry({ ...editEntry, lat: e.target.value === '' ? undefined : Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Longitude (desimal, W negatif)</Label>
                    <Input
                      className="h-8 font-mono"
                      type="number" step="0.000001"
                      value={editEntry.lng ?? ''}
                      onChange={(e) => setEditEntry({ ...editEntry, lng: e.target.value === '' ? undefined : Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Verifikasi</Label>
                    <Select value={editEntry.verification} onValueChange={(v) => setEditEntry({ ...editEntry, verification: v as BankEntryApi['verification'] })}>
                      <SelectTrigger className="w-full min-w-0 h-8"><SelectValue className="truncate" /></SelectTrigger>
                      <SelectContent>
                        {['VERIFIED', 'UNVERIFIED', 'MISSING', 'SIMULATION'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Approval</Label>
                    <Select value={editEntry.approval} onValueChange={(v) => setEditEntry({ ...editEntry, approval: v as BankEntryApi['approval'] })}>
                      <SelectTrigger className="w-full min-w-0 h-8"><SelectValue className="truncate" /></SelectTrigger>
                      <SelectContent>
                        {['DRAFT', 'APPROVED'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1"><Label>Sumber (provenance wajib)</Label><Input className="h-8" value={editEntry.source} onChange={(e) => setEditEntry({ ...editEntry, source: e.target.value })} /></div>
                <div className="space-y-1"><Label>Tanggal pembaruan</Label><Input className="h-8" value={editEntry.updatedRef} onChange={(e) => setEditEntry({ ...editEntry, updatedRef: e.target.value })} /></div>
                <div className="space-y-1"><Label>Satuan</Label><Input className="h-8" value={editEntry.units} onChange={(e) => setEditEntry({ ...editEntry, units: e.target.value })} /></div>
                <div className="space-y-1">
                  <Label>Spesifikasi (JSON)</Label>
                  <textarea
                    className="w-full h-32 font-mono text-[11px] rounded border border-slate-300 p-2 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    value={JSON.stringify(editEntry.specs, null, 2)}
                    onChange={(e) => {
                      try {
                        setEditEntry({ ...editEntry, specs: JSON.parse(e.target.value) });
                      } catch {
                        // biarkan pengguna mengetik JSON utuh; validasi saat simpan
                      }
                    }}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => setEditEntry(null)}>Batal</Button>
                <Button type="button" size="sm" className="h-8 text-xs bg-sky-600 hover:bg-sky-700 text-white" onClick={() => saveBankEntry(editEntry)}>Simpan</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
