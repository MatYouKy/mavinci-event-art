'use client';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  EVENT_STEP_KIND_LABELS,
  EVENT_STEP_ROLE_LABELS,
  MANUAL_EVENT_STEP_KINDS,
  MANUAL_EVENT_STEP_ROLES,
  eventStepErrorMessage,
  type EventStepsSnapshot,
  type ManualEventStepKind,
  type ManualEventStepRole,
} from '@/lib/events/steps/eventSteps';
import EventStepDialog from './EventStepDialog';
import { EVENT_STEP_DEFAULT_TIME, localPartsToIso, stepInputClass } from './stepUi';

/** Role, dla których krok może blokować „Gotowe do wydania” (te same co w bazie). */
const BLOCKING_ROLES: ManualEventStepRole[] = ['warehouse', 'sales', 'manager'];

type Draft = {
  title: string;
  kind: ManualEventStepKind;
  ownerRole: ManualEventStepRole;
  dueDate: string;
  dueTime: string;
  details: string;
  blocksReady: boolean;
};

const EMPTY_DRAFT: Draft = {
  title: '',
  kind: 'task',
  ownerRole: 'warehouse',
  dueDate: '',
  dueTime: EVENT_STEP_DEFAULT_TIME,
  details: '',
  blocksReady: false,
};

export default function AddEventStepDialog({
  open,
  eventId,
  onClose,
  onAdded,
}: {
  open: boolean;
  eventId: string;
  onClose: () => void;
  onAdded: (snapshot: EventStepsSnapshot) => void;
}) {
  const id = useId();
  const { showSnackbar } = useSnackbar();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [dateValid, setDateValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    setDraft(EMPTY_DRAFT);
    setDateValid(true);
    setError('');
  }, [open]);

  const canBlock = BLOCKING_ROLES.includes(draft.ownerRole);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const title = draft.title.trim();
    if (title.length < 3 || title.length > 200) {
      setError('Podaj nazwę kroku (3–200 znaków).');
      return;
    }
    if (!dateValid) {
      setError('Wpisz poprawną datę terminu w formacie DD.MM.RRRR.');
      return;
    }
    if (!draft.dueDate) {
      setError('Podaj termin kroku — właściciel dostanie przypomnienie.');
      return;
    }
    const dueAt = localPartsToIso(draft.dueDate, draft.dueTime);
    if (!dueAt) {
      setError('Wpisz poprawną datę i godzinę terminu.');
      return;
    }
    if (new Date(dueAt).getTime() < Date.now() - 60_000) {
      setError('Termin nie może być w przeszłości.');
      return;
    }
    if (draft.details.length > 2000) {
      setError('Opis może mieć najwyżej 2000 znaków.');
      return;
    }
    submittingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const { data, error: rpcError } = await supabase.rpc('add_event_step', {
        p_event_id: eventId,
        p_title: title,
        p_kind: draft.kind,
        p_owner_role: draft.ownerRole,
        p_due_at: dueAt,
        p_details: draft.details.trim() || null,
        p_blocks_ready: canBlock && draft.blocksReady,
      });
      if (rpcError) throw rpcError;
      onAdded(data as EventStepsSnapshot);
      showSnackbar('Dodano krok.', 'success');
      onClose();
    } catch (caught) {
      setError(eventStepErrorMessage(caught));
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <EventStepDialog
      open={open}
      onClose={onClose}
      busy={saving}
      title="Dodaj krok"
      description="Dodatkowe ustalenie, zamówienie albo sprawdzenie. Właściciel kroku dostanie przypomnienie przed terminem."
    >
      <form onSubmit={submit} noValidate aria-busy={saving} className="space-y-4">
        <fieldset disabled={saving} className="space-y-4 disabled:opacity-70">
          <legend className="sr-only">Nowy krok</legend>
          <label className="block text-sm text-[#e5e4e2]/70">
            Nazwa kroku <span className="text-[#d3bb73]">*</span>
            <input
              data-autofocus
              value={draft.title}
              maxLength={200}
              required
              onChange={event => setDraft({ ...draft, title: event.target.value })}
              placeholder="Np. Potwierdź godzinę wjazdu z obiektem"
              className={stepInputClass}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-[#e5e4e2]/70">
              Rodzaj
              <select
                value={draft.kind}
                onChange={event => setDraft({ ...draft, kind: event.target.value as ManualEventStepKind })}
                className={stepInputClass}
              >
                {MANUAL_EVENT_STEP_KINDS.map(kind => (
                  <option key={kind} value={kind} className="bg-[#1c1f33]">
                    {EVENT_STEP_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-[#e5e4e2]/70">
              Kto odpowiada
              <select
                value={draft.ownerRole}
                onChange={event => setDraft({ ...draft, ownerRole: event.target.value as ManualEventStepRole })}
                className={stepInputClass}
              >
                {MANUAL_EVENT_STEP_ROLES.map(role => (
                  <option key={role} value={role} className="bg-[#1c1f33]">
                    {EVENT_STEP_ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SellerDatePicker
              label="Termin — data *"
              value={draft.dueDate}
              onChange={dueDate => setDraft(previous => ({ ...previous, dueDate }))}
              onValidityChange={setDateValid}
            />
            <label className="block text-xs text-[#e5e4e2]/50">
              Godzina
              <input
                type="time"
                step={300}
                value={draft.dueTime}
                onChange={event => setDraft({ ...draft, dueTime: event.target.value })}
                className={`${stepInputClass} h-11`}
              />
            </label>
          </div>
          <label className="block text-sm text-[#e5e4e2]/70">
            Opis (opcjonalnie)
            <textarea
              rows={3}
              maxLength={2000}
              value={draft.details}
              onChange={event => setDraft({ ...draft, details: event.target.value })}
              placeholder="Co dokładnie zrobić, z kim się kontaktować"
              className={stepInputClass}
            />
            <span className="mt-1 block text-right text-xs tabular-nums text-[#e5e4e2]/40">{draft.details.length}/2000</span>
          </label>
          <div>
            <label className={`flex items-start gap-2 text-sm ${canBlock ? 'text-[#e5e4e2]' : 'text-[#e5e4e2]/45'}`}>
              <input
                type="checkbox"
                checked={canBlock && draft.blocksReady}
                disabled={!canBlock}
                aria-describedby={`${id}-blocks-hint`}
                onChange={event => setDraft({ ...draft, blocksReady: event.target.checked })}
                className="mt-0.5 accent-[#d3bb73]"
              />
              Wymagane przed gotowością magazynu
            </label>
            <p id={`${id}-blocks-hint`} className="mt-1 pl-6 text-xs text-[#e5e4e2]/45">
              {canBlock
                ? 'Magazyn nie oznaczy „Gotowe do wydania”, dopóki ten krok nie zostanie zamknięty.'
                : 'Dostępne dla kroków magazynu, sprzedawcy i kierownika realizacji.'}
            </p>
          </div>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-lg bg-white/5 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-white/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie…' : 'Dodaj krok'}
          </button>
        </div>
      </form>
    </EventStepDialog>
  );
}
