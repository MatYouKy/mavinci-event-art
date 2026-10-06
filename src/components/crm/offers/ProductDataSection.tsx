"use client";
import { useState, type ReactNode } from 'react';
import { Loader2, Pencil, Save } from 'lucide-react';

export default function ProductDataSection<T extends object>({ title, value, fields, canEdit, disabled, renderView, renderEditor, onSave, onEditingChange, onDraftChange }: {
  title: string; value: T; fields: readonly (keyof T)[]; canEdit: boolean; disabled?: boolean;
  renderView: (value: T) => ReactNode; renderEditor: (value: T, onChange: (value: T) => void) => ReactNode;
  onSave: (patch: Partial<T>) => Promise<void>; onEditingChange: (editing: boolean) => void;
  onDraftChange?: (patch: Partial<T> | null) => void;
}) {
  const [draft, setDraft] = useState<Partial<T> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pick = (source: T): Partial<T> => Object.fromEntries(fields.map(key => [key, source[key]])) as Partial<T>;
  const finish = () => { setDraft(null); setError(''); onDraftChange?.(null); onEditingChange(false); };
  const save = async () => {
    if (draft === null || saving || disabled || !canEdit) return;
    setSaving(true); setError('');
    try { await onSave(draft); finish(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać zmian'); }
    finally { setSaving(false); }
  };
  return <section aria-busy={saving} className="min-w-0 rounded-xl bg-[#1c1f33] p-5 sm:p-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-medium text-[#e5e4e2]">{title}</h2>
      {canEdit && <div className="flex gap-2">{draft !== null ? <>
        <button type="button" disabled={disabled || saving} onClick={finish} className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2] disabled:opacity-40">Anuluj</button>
        <button type="button" disabled={disabled || saving} onClick={save} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{saving ? 'Zapisywanie…' : 'Zapisz'}</button>
      </> : <button type="button" disabled={disabled} onClick={() => { setDraft(structuredClone(pick(value))); onEditingChange(true); }} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40"><Pencil className="h-4 w-4" />Edytuj</button>}</div>}
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-red-200">{error}</p>}
    {draft === null ? renderView(value) : <fieldset disabled={disabled || saving || !canEdit} className="min-w-0 disabled:opacity-60">{renderEditor({ ...value, ...draft }, next => { const patch = pick(next); setDraft(patch); onDraftChange?.(patch); })}</fieldset>}
  </section>;
}
