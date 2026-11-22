'use client';

import { useCallback, useEffect, useState } from 'react';
import { HardDrive, Loader2, RefreshCw, X } from 'lucide-react';
import {
  DRIVE_GB, driveStorageLevel, formatDriveBytes, formatDriveShare, type DriveStorageUsage,
} from '@/lib/drive/driveShared';
import { errorMessage, ghostButton, inputClass, primaryButton, secondaryButton } from '../materials/materialsUi';
import { driveGet, drivePost } from './driveApi';

/*
 * Dysk → „Miejsce na Dysku” — tylko administrator (`root.storage`). Na dole paska bocznego: pasek zajętości plików względem
 * zakupionego pakietu i „zostało …”; kliknięcie — okno z pakietem, plikami według rodzaju, bazą danych i „Zmień pakiet…”.
 * To samo na Macu (`DriveStorageViews.swift`) i w telefonie. Dane: `op=storage`, zmiana pakietu — `op=storagePlan`
 * (`crm_storage_usage()` / `crm_set_storage_plan()`, migracja 20261126120000).
 */

type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;

const LEVEL_BAR: Record<ReturnType<typeof driveStorageLevel>, string> = {
  ok: 'bg-[#d3bb73]',
  warning: 'bg-orange-400',
  critical: 'bg-red-500',
};

const gbText = (bytes: number) => String(Math.round((bytes / DRIVE_GB) * 10) / 10).replace('.', ',');
const gbValue = (text: string) => {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value >= 1 && value <= 100_000 ? value : null;
};
const filesLabel = (count: number) => {
  const text = count.toLocaleString('pl-PL');
  if (count === 1) return `${text} plik`;
  const unit = count % 10;
  const tens = count % 100;
  return `${text} ${unit >= 2 && unit <= 4 && (tens < 12 || tens > 14) ? 'pliki' : 'plików'}`;
};

function UsageBar({ used, quota, height = 'h-1.5' }: { used: number; quota: number; height?: string }) {
  const share = quota > 0 ? Math.min(1, Math.max(0, used / quota)) : 0;
  return (
    <div className={`${height} w-full overflow-hidden rounded-full bg-[#e5e4e2]/10`} role="meter" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)} aria-label={`Zajęte ${formatDriveShare(used, quota)}`}>
      <div className={`h-full rounded-full ${LEVEL_BAR[driveStorageLevel(used, quota)]}`} style={{ width: `${used > 0 ? Math.max(1.5, share * 100) : 0}%` }} />
    </div>
  );
}

function UsageBlock({ title, used, quota, detail }: { title: string; used: number; quota: number; detail?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-[#e5e4e2]">{title}</span>
        <span className="tabular-nums text-[#e5e4e2]/80">{formatDriveBytes(used)} z {formatDriveBytes(quota)}</span>
      </div>
      <UsageBar used={used} quota={quota} height="h-2" />
      <div className="flex justify-between gap-3 text-xs text-[#e5e4e2]/50">
        <span>Zajęte {formatDriveShare(used, quota)} · zostało {formatDriveBytes(Math.max(0, quota - used))}</span>
        {detail && <span>{detail}</span>}
      </div>
    </div>
  );
}

export default function DriveStorageMeter({ notify, compact = false }: { notify: Notify; compact?: boolean }) {
  const [usage, setUsage] = useState<DriveStorageUsage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', files: '', database: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setUsage(await driveGet<DriveStorageUsage>('storage'));
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Nie udało się odczytać zajętości miejsca.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const show = () => {
    setOpen(true);
    setEditing(false);
    void load();
  };

  const startEdit = () => {
    if (!usage) return;
    setForm({ name: usage.plan.name, files: gbText(usage.files.quota), database: gbText(usage.database.quota) });
    setEditing(true);
  };

  const save = async () => {
    const files = gbValue(form.files);
    const database = gbValue(form.database);
    if (files === null || database === null || saving) return;
    setSaving(true);
    try {
      setUsage(await drivePost<DriveStorageUsage>('storagePlan', { name: form.name.trim() || 'Pakiet', filesGb: files, databaseGb: database }));
      setEditing(false);
      notify('Zapisano pakiet miejsca na Dysku', 'success');
    } catch (cause) {
      notify(errorMessage(cause, 'Nie udało się zapisać pakietu.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const remaining = usage ? Math.max(0, usage.files.quota - usage.files.used) : 0;

  return (
    <>
      {compact ? (
        <button type="button" onClick={show} title="Miejsce na Dysku (widzi tylko administrator)"
          className="inline-flex items-center gap-1.5 rounded-full border border-[#d3bb73]/15 px-3 py-1.5 text-xs text-[#e5e4e2]/70">
          <HardDrive className="h-3.5 w-3.5 text-[#d3bb73]" />
          {usage ? `${formatDriveBytes(usage.files.used)} z ${formatDriveBytes(usage.files.quota)}` : 'Miejsce na Dysku'}
        </button>
      ) : (
        <button type="button" onClick={show} title="Miejsce na Dysku — szczegóły i pakiet (widzi tylko administrator)"
          className="mt-2 block w-full space-y-1.5 rounded-lg bg-[#e5e4e2]/[0.04] px-2.5 py-2 text-left hover:bg-[#e5e4e2]/[0.07]">
          <span className="flex items-center gap-1.5 text-xs font-medium text-[#e5e4e2]/80">
            <HardDrive className="h-3.5 w-3.5 text-[#d3bb73]" />Miejsce na Dysku
            {loading && !usage && <Loader2 className="ml-auto h-3 w-3 animate-spin text-[#d3bb73]" />}
          </span>
          {usage ? (
            <>
              <UsageBar used={usage.files.used} quota={usage.files.quota} />
              <span className="block truncate text-[11px] text-[#e5e4e2]/50">
                {formatDriveBytes(usage.files.used)} z {formatDriveBytes(usage.files.quota)} · zostało {formatDriveBytes(remaining)}
              </span>
            </>
          ) : error ? (
            <span className="block text-[11px] text-[#e5e4e2]/50">{error}</span>
          ) : null}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" aria-label="Miejsce na Dysku" onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md space-y-4 rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-5 text-[#e5e4e2] shadow-2xl">
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-[#d3bb73]" />
              <h2 className="flex-1 text-lg font-light">Miejsce na Dysku</h2>
              <button type="button" className={ghostButton} onClick={() => void load()} disabled={loading} title="Odśwież" aria-label="Odśwież">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button type="button" className={ghostButton} onClick={() => setOpen(false)} title="Zamknij" aria-label="Zamknij"><X className="h-4 w-4" /></button>
            </div>

            {usage ? (
              <>
                <p className="text-sm text-[#e5e4e2]/60">Pakiet: {usage.plan.name}</p>
                <UsageBlock title="Pliki" used={usage.files.used} quota={usage.files.quota} detail={filesLabel(usage.files.objects)} />
                {!!usage.groups.length && (
                  <ul className="space-y-1">
                    {usage.groups.map((group, index) => (
                      <li key={group.key} className="flex items-center gap-2 text-xs">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[#d3bb73]" style={{ opacity: Math.max(0.2, 1 - index * 0.11) }} />
                        <span className="min-w-0 flex-1 truncate text-[#e5e4e2]/80">{group.label}</span>
                        <span className="tabular-nums text-[#e5e4e2]/80">{formatDriveBytes(group.bytes)}</span>
                        <span className="w-11 text-right tabular-nums text-[#e5e4e2]/40">{formatDriveShare(group.bytes, Math.max(1, usage.files.used))}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-[#d3bb73]/10 pt-4">
                  <UsageBlock title="Baza danych" used={usage.database.used} quota={usage.database.quota} />
                </div>
                <div className="border-t border-[#d3bb73]/10 pt-4">
                  {editing ? (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Zakupiony pakiet</p>
                      <input className={`${inputClass} w-full`} value={form.name} maxLength={80} placeholder="Nazwa pakietu (np. Supabase Pro)"
                        onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} aria-label="Nazwa pakietu" />
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1 text-xs text-[#e5e4e2]/60">
                          <span>Pliki (GB)</span>
                          <input className={`${inputClass} w-full`} inputMode="decimal" value={form.files} placeholder="100"
                            onChange={(event) => setForm((current) => ({ ...current, files: event.target.value }))} />
                        </label>
                        <label className="space-y-1 text-xs text-[#e5e4e2]/60">
                          <span>Baza danych (GB)</span>
                          <input className={`${inputClass} w-full`} inputMode="decimal" value={form.database} placeholder="8"
                            onChange={(event) => setForm((current) => ({ ...current, database: event.target.value }))} />
                        </label>
                      </div>
                      <div className="flex justify-end gap-2">
                        <button type="button" className={secondaryButton} onClick={() => setEditing(false)} disabled={saving}>Anuluj</button>
                        <button type="button" className={primaryButton} onClick={() => void save()}
                          disabled={saving || gbValue(form.files) === null || gbValue(form.database) === null}>
                          {saving && <Loader2 className="h-4 w-4 animate-spin" />}Zapisz pakiet
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className={secondaryButton} onClick={startEdit}>Zmień pakiet…</button>
                  )}
                </div>
              </>
            ) : error ? (
              <p className="text-sm text-[#e5e4e2]/70">{error}</p>
            ) : (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[#d3bb73]" /></div>
            )}
            <p className="text-xs text-[#e5e4e2]/40">
              Widzi tylko administrator. Pliki to cały magazyn CRM (także załączniki e-mail, czat, strona), nie tylko Dysk.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
