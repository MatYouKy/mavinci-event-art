import { createElement, type ChangeEvent } from 'react';
import type { useDialog } from '@/contexts/DialogContext';
import { supabase } from '@/lib/supabase/browser';

/** The database decides using all relations, including records hidden by document scopes. */
export async function confirmAndRemoveInquiry(
  inquiryId: string,
  showConfirm: ReturnType<typeof useDialog>['showConfirm'],
): Promise<'deleted' | 'archived' | null> {
  const preview = await supabase.rpc('remove_inquiry', { p_inquiry: inquiryId });
  if (preview.error) throw preview.error;
  const mode = preview.data;
  if (mode !== 'deleted' && mode !== 'archived') throw new Error('Nie udało się sprawdzić powiązań zapytania.');
  let reason = '';
  let reasonInput: HTMLTextAreaElement | null = null;
  const confirmed = await showConfirm(mode === 'deleted' ? {
    title: 'Usuń zapytanie',
    message: 'Zapytanie nie ma zadań, ofert, kalkulacji ani powiązanego wydarzenia. Zostanie trwale usunięte wraz z historią. Tej operacji nie można cofnąć.',
    confirmText: 'Usuń trwale',
    cancelText: 'Anuluj',
  } : {
    title: 'Archiwizuj zapytanie',
    message: createElement('div', { className: 'space-y-4 text-left' },
      createElement('p', null, 'Zapytanie ma powiązane dane, dlatego zostanie zarchiwizowane. Historia i dokumenty pozostaną.'),
      createElement('label', { className: 'block' },
        createElement('span', { className: 'mb-2 block' }, 'Powód archiwizacji'),
        createElement('textarea', {
          ref: (element: HTMLTextAreaElement | null) => { reasonInput = element; },
          required: true,
          rows: 3,
          maxLength: 2000,
          autoFocus: true,
          className: 'w-full rounded-lg border border-[#d3bb73]/10 bg-black/20 p-3 text-[#e5e4e2]',
          onChange: (event: ChangeEvent<HTMLTextAreaElement>) => {
            reason = event.target.value;
            event.target.setCustomValidity('');
          },
        }),
      ),
    ),
    validate: () => {
      reasonInput?.setCustomValidity(reason.trim() ? '' : 'Podaj powód archiwizacji.');
      return Boolean(reasonInput?.reportValidity() && reason.trim());
    },
    confirmText: 'Archiwizuj',
    cancelText: 'Anuluj',
  });
  if (!confirmed) return null;
  const result = await supabase.rpc('remove_inquiry', { p_inquiry: inquiryId, p_mode: mode, p_reason: reason.trim() || null });
  if (result.error) throw result.error;
  return mode;
}
