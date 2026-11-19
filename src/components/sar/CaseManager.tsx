'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Save, FolderOpen, Trash2, Download, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { filterSarCases } from '@/lib/sar/stateSync';

export interface SarCaseSummary {
  id: string;
  title: string;
  caseNumber: string | null;
  searchObject: string | null;
  phase: string;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SarStatePayload {
  title?: string;
  caseNumber?: string;
  searchObject?: string;
  phase?: string;
  notes?: string;
  state: Record<string, unknown>;
}

interface CaseManagerProps {
  /** Build the current worksheet state to save. */
  buildState: () => SarStatePayload | null;
  /** Apply a loaded state back to the worksheets. */
  applyState: (state: Record<string, unknown>) => void;
  /** SAR Workflow Memory: workspace aktif berubah (save/load/delete). */
  onActiveCaseChange?: (c: { id: string; title: string } | null) => void;
  /** Id kasus aktif saat ini — untuk proteksi: hapus kasus aktif → workspace kosong. */
  activeCaseId?: string | null;
}

export default function CaseManager({ buildState, applyState, onActiveCaseChange, activeCaseId }: CaseManagerProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [searchObject, setSearchObject] = useState('');
  const [phase, setPhase] = useState('DISTRESS');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [cases, setCases] = useState<SarCaseSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SarCaseSummary | null>(null);
  const [loadTarget, setLoadTarget] = useState<SarCaseSummary | null>(null);
  // Pencarian kasus tersimpan pada dialog Open Case (title, nomor kasus,
  // objek pencarian, notes, fase) — filter klien atas daftar lengkap.
  const [caseSearch, setCaseSearch] = useState('');
  const filteredCases = filterSarCases(cases, caseSearch);

  const fetchCases = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/sar-cases', { cache: 'no-store' });
      const data = await res.json();
      setCases(data.cases ?? []);
    } catch (e) {
      toast.error('Failed to load cases', { description: (e as Error).message });
    } finally {
      setLoadingList(false);
    }
  }, []);

  // Refresh case list whenever load dialog opens
  useEffect(() => {
    if (loadOpen) void fetchCases();
  }, [loadOpen, fetchCases]);

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const payload = buildState();
      if (!payload) {
        toast.error('No state to save');
        return;
      }
      const res = await fetch('/api/sar-cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          caseNumber: caseNumber.trim() || null,
          searchObject: searchObject.trim() || null,
          phase,
          notes: notes.trim() || null,
          state: payload.state,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // SAR Workflow Memory: kasus baru = workspace aktif.
      if (data?.case?.id) onActiveCaseChange?.({ id: data.case.id, title: title.trim() });
      toast.success(`Saved case "${title}"`);
      setSaveOpen(false);
      setTitle('');
      setCaseNumber('');
      setSearchObject('');
      setNotes('');
    } catch (e) {
      toast.error('Save failed', { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const handleLoad = async (id: string) => {
    try {
      const res = await fetch(`/api/sar-cases/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const state =
        typeof data.case.state === 'string'
          ? JSON.parse(data.case.state)
          : data.case.state;
      applyState(state);
      // Also bring in case-level metadata
      if (data.case.title) setTitle(data.case.title);
      if (data.case.caseNumber) setCaseNumber(data.case.caseNumber);
      if (data.case.searchObject) setSearchObject(data.case.searchObject);
      if (data.case.phase) setPhase(data.case.phase);
      if (data.case.notes) setNotes(data.case.notes);
      toast.success(`Loaded case "${data.case.title}"`);
      // SAR Workflow Memory: workspace aktif berpindah ke kasus yang dimuat.
      onActiveCaseChange?.({ id: data.case.id, title: String(data.case.title ?? '') });
      setLoadOpen(false);
      setLoadTarget(null);
    } catch (e) {
      toast.error('Load failed', { description: (e as Error).message });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/sar-cases/${deleteTarget.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(`Deleted "${deleteTarget.title}"`);
      // SAR Workflow Memory: hapus kasus aktif → workspace aktif dikosongkan
      // (proteksi antar-workspace: konteks tidak menggantung).
      if (deleteTarget.id === activeCaseId) onActiveCaseChange?.(null);
      setCases((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    } catch (e) {
      toast.error('Delete failed', { description: (e as Error).message });
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-white/10 text-slate-100 hover:bg-white/20 transition-colors border border-white/15"
          >
            <Save className="h-3.5 w-3.5" /> Save Case
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save SAR Case</DialogTitle>
            <DialogDescription>
              Save the current worksheet inputs to the local case database. You can reload them later.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label htmlFor="title" className="text-xs">Case Title *</Label>
              <Input
                id="title"
                value={title}
                suppressHydrationWarning onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., M/V NEVERSEEN — Java Sea"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="caseNumber" className="text-xs">Case Number</Label>
                <Input
                  id="caseNumber"
                  value={caseNumber}
                  onChange={(e) => setCaseNumber(e.target.value)}
                  placeholder="RCC-2026-0142"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Emergency Phase</Label>
                <Select value={phase} onValueChange={setPhase}>
                  <SelectTrigger className="mt-1 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNCERTAINTY">Uncertainty</SelectItem>
                    <SelectItem value="ALERT">Alert</SelectItem>
                    <SelectItem value="DISTRESS">Distress</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="searchObject" className="text-xs">Search Object</Label>
              <Input
                id="searchObject"
                value={searchObject}
                onChange={(e) => setSearchObject(e.target.value)}
                placeholder="e.g., 6-person orange liferaft with canopy"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="notes" className="text-xs">Notes (optional)</Label>
              <textarea
                id="notes"
                value={notes}
                suppressHydrationWarning
                spellCheck={false}
                data-ms-editor="true"
                onChange={(e) => setNotes(e.target.value)}
                placeholder="SMC comments, weather, vessel traffic considerations…"
                rows={3}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !title.trim()}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save Case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Load dialog */}
      <Dialog open={loadOpen} onOpenChange={setLoadOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium bg-white/10 text-slate-100 hover:bg-white/20 transition-colors border border-white/15"
          >
            <FolderOpen className="h-3.5 w-3.5" /> Open Case
          </button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Open SAR Case</DialogTitle>
            <DialogDescription>
              Pick a previously saved case. Loading will overwrite the current worksheet inputs.
            </DialogDescription>
          </DialogHeader>
          {/* Pencarian kasus: cocokkan judul / nomor kasus / objek pencarian / notes / fase */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              value={caseSearch}
              suppressHydrationWarning
              onChange={(e) => setCaseSearch(e.target.value)}
              placeholder="Cari kasus… (judul, nomor kasus, objek pencarian, notes)"
              className="pl-8 h-9"
            />
          </div>
          {!loadingList && cases.length > 0 && (
            <div className="text-[11px] text-slate-500 -mt-1">
              {filteredCases.length} dari {cases.length} kasus
            </div>
          )}
          <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
            {loadingList ? (
              <div className="flex items-center justify-center py-8 text-slate-500 text-sm">
                <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading…
              </div>
            ) : cases.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                No saved cases yet. Click <span className="font-semibold">Save Case</span> to create one.
              </div>
            ) : filteredCases.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                Tidak ada kasus yang cocok dengan <span className="font-semibold">"{caseSearch.trim()}"</span>.
              </div>
            ) : (
              <ul className="space-y-1.5">
                {filteredCases.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 p-2 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                  >
                    <button
                      type="button"
                      onClick={() => setLoadTarget(c)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800 truncate">{c.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {c.phase}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {c.caseNumber ? `${c.caseNumber} · ` : ''}
                        {c.searchObject ?? 'No search object'} ·{' '}
                        {new Date(c.updatedAt).toLocaleString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(c)}
                      className="text-slate-400 hover:text-red-500 p-1"
                      aria-label={`Delete ${c.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Load confirm */}
      <AlertDialog open={!!loadTarget} onOpenChange={(open) => !open && setLoadTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Load this case?</AlertDialogTitle>
            <AlertDialogDescription>
              This will replace the current worksheet inputs with the values from{' '}
              <span className="font-semibold text-slate-700">{loadTarget?.title}</span>.
              Any unsaved changes will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => loadTarget && handleLoad(loadTarget.id)}>
              <Download className="h-4 w-4 mr-1" /> Load Case
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this case?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete <span className="font-semibold text-slate-700">{deleteTarget?.title}</span>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
