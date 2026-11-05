'use client';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import EventStepDialog from '../steps/EventStepDialog';
import { primaryButtonClass, secondaryButtonClass, settlementInputClass } from './settlementUi';

const NOTE_LIMIT = 2000;

export type SettlementConfirmRequest = {
  /** Klucz żądania — zmiana czyści wpisaną notatkę. */
  key: string;
  title: string;
  description?: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  /** Pole notatki: brak = bez notatki. */
  note?: { label: string; required: boolean; placeholder?: string; initial?: string };
  /** Dodatkowy wybór (pole wyboru) przekazywany razem z notatką. */
  option?: { label: string; hint?: string };
};

/** Okno potwierdzenia operacji podsumowania (z opcjonalną albo wymaganą notatką). */
export default function SettlementConfirmDialog({
  request,
  busy,
  onCancel,
  onConfirm,
}: {
  request: SettlementConfirmRequest | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (note: string, option: boolean) => void | Promise<void>;
}) {
  const id = useId();
  const [note, setNote] = useState('');
  const [option, setOption] = useState(false);
  const [error, setError] = useState('');
  const requestKey = request?.key ?? '';

  useEffect(() => {
    setNote(request?.note?.initial ?? '');
    setOption(false);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  if (!request) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = note.trim();
    if (request.note?.required && !trimmed) {
      setError(`Uzupełnij pole „${request.note.label}”.`);
      return;
    }
    if (trimmed.length > NOTE_LIMIT) {
      setError(`Notatka może mieć najwyżej ${NOTE_LIMIT} znaków.`);
      return;
    }
    setError('');
    void onConfirm(trimmed, Boolean(request.option) && option);
  };

  return (
    <EventStepDialog open title={request.title} description={request.description} onClose={onCancel} busy={busy}>
      <form onSubmit={submit} className="space-y-4" noValidate aria-busy={busy}>
        {request.body}
        {request.note && (
          <div>
            <label htmlFor={`${id}-note`} className="block text-sm text-[#e5e4e2]/70">
              {request.note.label}
              {request.note.required ? <span className="text-[#d3bb73]"> *</span> : <span className="text-[#e5e4e2]/40"> (opcjonalnie)</span>}
            </label>
            <textarea
              id={`${id}-note`}
              data-autofocus
              rows={4}
              maxLength={NOTE_LIMIT}
              value={note}
              disabled={busy}
              placeholder={request.note.placeholder}
              aria-invalid={Boolean(error)}
              onChange={event => {
                setNote(event.target.value);
                if (error) setError('');
              }}
              className={`${settlementInputClass} mt-1`}
            />
            <p className="mt-1 text-right text-xs tabular-nums text-[#e5e4e2]/40">
              {note.length}/{NOTE_LIMIT}
            </p>
          </div>
        )}
        {request.option && (
          <label htmlFor={`${id}-option`} className="flex cursor-pointer items-start gap-3 rounded-lg bg-white/[0.04] px-3 py-2.5">
            <input
              id={`${id}-option`}
              type="checkbox"
              checked={option}
              disabled={busy}
              onChange={event => setOption(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[#d3bb73]"
            />
            <span className="min-w-0">
              <span className="block text-sm text-[#e5e4e2]">{request.option.label}</span>
              {request.option.hint && <span className="mt-0.5 block text-xs text-[#e5e4e2]/55">{request.option.hint}</span>}
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button type="button" disabled={busy} onClick={onCancel} className={secondaryButtonClass}>
            Anuluj
          </button>
          <button
            type="submit"
            disabled={busy}
            data-autofocus={request.note ? undefined : true}
            className={
              request.tone === 'danger'
                ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-red-500/80 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50'
                : primaryButtonClass
            }
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? 'Zapisywanie…' : request.confirmLabel}
          </button>
        </div>
      </form>
    </EventStepDialog>
  );
}
