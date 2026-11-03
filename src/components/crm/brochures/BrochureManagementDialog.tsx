'use client';

import { useRef, useState } from 'react';
import { ArchiveRestore, Loader2, Pencil, Trash2 } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';

export type BrochureManagementAction = 'rename' | 'remove' | 'restore';
export type BrochureManagementRecord = {
  id: string;
  name: string;
  status: 'draft' | 'ready' | 'archived';
  updated_at: string;
  current_pdf_version: number;
  modified_after_generation: boolean;
};

export default function BrochureManagementDialog({
  action, brochure, canManage, hasUnsavedChanges = false, onClose, onSuccess,
}: {
  action: BrochureManagementAction;
  brochure: BrochureManagementRecord;
  canManage: boolean;
  hasUnsavedChanges?: boolean;
  onClose: () => void;
  onSuccess: (brochure: BrochureManagementRecord) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [name, setName] = useState(brochure.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingLock = useRef(false);
  const title = action === 'rename' ? 'Zmień nazwę broszury'
    : action === 'remove' ? 'Usuń broszurę' : 'Przywróć broszurę';
  const close = () => { if (!savingLock.current) onClose(); };

  const submit = async () => {
    if (savingLock.current || !canManage) return;
    const trimmedName = name.trim();
    if (action === 'rename' && (!trimmedName || trimmedName.length > 200)) {
      setError('Wpisz nazwę broszury — od 1 do 200 znaków.');
      return;
    }
    savingLock.current = true;
    setSaving(true);
    setError('');
    try {
      // Archive the editable source, never cascade-delete immutable client PDFs,
      // delivery history or demo attribution. RLS remains the authority for writes.
      const patch = action === 'rename' ? { name: trimmedName } : {
        status: action === 'remove' ? 'archived' : brochure.current_pdf_version > 0 ? 'ready' : 'draft',
      };
      let request = supabase.from('sales_brochures').update(patch)
        .eq('id', brochure.id).eq('updated_at', brochure.updated_at);
      request = action === 'restore'
        ? request.eq('status', 'archived') : request.neq('status', 'archived');
      const { data, error: saveError } = await request
        .select('id,name,status,updated_at,current_pdf_version,modified_after_generation').maybeSingle();
      if (saveError) throw saveError;
      if (!data) {
        setError('Broszura została zmieniona w innym oknie albo nie masz już dostępu do jej edycji. Zamknij okno i odśwież stronę przed kolejną próbą.');
        return;
      }
      showSnackbar(action === 'rename' ? 'Zmieniono nazwę broszury.'
        : action === 'remove' ? 'Przeniesiono broszurę do archiwum. Zapisane PDF-y zachowano.'
          : 'Przywrócono broszurę na aktywną listę.', 'success');
      onSuccess(data as BrochureManagementRecord);
    } catch (failure) {
      setError((failure as { code?: string })?.code === '42501'
        ? 'Nie masz uprawnień do zarządzania tą broszurą.'
        : 'Nie udało się potwierdzić zmiany. Zamknij okno i odśwież stronę, aby sprawdzić aktualny stan broszury.');
    } finally {
      savingLock.current = false;
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={close} title={title.toLocaleUpperCase('pl-PL')}>
      <form aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }} className="space-y-5 text-[#e5e4e2]">
        {action === 'rename' ? <>
          <label className="block text-sm">
            Nazwa robocza broszury
            <input autoFocus required maxLength={200} value={name} disabled={saving || !canManage}
              onChange={(event) => { setName(event.target.value); setError(''); }}
              className="mt-2 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 outline-none focus:border-[#d3bb73]/30 disabled:opacity-50" />
          </label>
          <p className="text-sm leading-6 text-white/60">To nazwa na liście i w edytorze CRM. Tytuł okładki oraz nazwy i treść już zapisanych PDF-ów nie zmienią się.</p>
          {hasUnsavedChanges && <p className="text-sm text-amber-200">Zapiszemy tylko nazwę. Pozostałe niezapisane zmiany pozostaną w edytorze.</p>}
        </> : <>
          <p className="break-words text-lg font-medium">{brochure.name}</p>
          <p className="text-sm leading-6 text-white/70">{action === 'remove'
            ? 'Broszura zniknie z aktywnej listy i trafi do archiwum. Możesz ją później przywrócić. Zapisane wersje PDF przypisane klientom, powiązania i historia wysyłek pozostaną bez zmian.'
            : 'Broszura wróci na aktywną listę. Ponownie będzie można ją edytować i generować kolejne wersje PDF.'}</p>
          {action === 'remove' && <p className="text-xs leading-5 text-white/50">Archiwizacja wyłącza nowe wejścia do demo tej broszury. Nie wycofuje wcześniej wysłanych plików ani nie zatrzymuje zaplanowanych wysyłek.</p>}
          {action === 'remove' && hasUnsavedChanges && <p className="rounded-lg bg-amber-400/10 p-3 text-sm text-amber-200">Niezapisane zmiany w edytorze nie zostaną zachowane.</p>}
        </>}
        {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" disabled={saving} onClick={close} className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-50">Anuluj</button>
          <button type="submit" disabled={saving || !canManage || (action === 'rename' && !name.trim())}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${action === 'remove' ? 'bg-red-500/15 text-red-200 hover:bg-red-500/25' : 'bg-[#d3bb73] text-[#1c1f33] hover:bg-[#d3bb73]/90'}`}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : action === 'rename' ? <Pencil className="h-4 w-4" /> : action === 'remove' ? <Trash2 className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
            {saving ? 'Zapisywanie…' : action === 'rename' ? 'Zapisz nazwę' : action === 'remove' ? 'Usuń z listy — do archiwum' : 'Przywróć broszurę'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
