'use client';
import { useEffect, useId, useState, type FormEvent } from 'react';
import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import {
  eventStepActionLabel,
  eventStepNeedsOrderFields,
  eventStepNoteRule,
  eventStepQuantityLabel,
} from '@/lib/events/steps/eventSteps';
import EventStepDialog from './EventStepDialog';
import { EVENT_STEP_DEFAULT_TIME, isoToLocalParts, localPartsToIso, stepInputClass } from './stepUi';
import type { EventStepActionInput, EventStepActionRequest } from './useEventStepActions';

const NOTE_LIMIT = 2000;

export default function EventStepActionDialog({
  request,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  request: EventStepActionRequest | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (input: EventStepActionInput) => void | Promise<void>;
}) {
  const id = useId();
  const [note, setNote] = useState('');
  const [supplier, setSupplier] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [deliveryDateValid, setDeliveryDateValid] = useState(true);
  const [localError, setLocalError] = useState('');

  const step = request?.step ?? null;
  const action = request?.action ?? null;
  const requestKey = step && action ? `${step.id}:${action}` : '';

  useEffect(() => {
    if (!step) return;
    const parts = isoToLocalParts(step.expected_at);
    setNote('');
    setSupplier(step.supplier ?? '');
    setDeliveryDate(parts.date);
    setDeliveryTime(parts.time || EVENT_STEP_DEFAULT_TIME);
    setDeliveryDateValid(true);
    setLocalError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  if (!step || !action) return null;

  const rule = eventStepNoteRule(step, action);
  const orderFields = eventStepNeedsOrderFields(step, action);
  const label = eventStepActionLabel(step, action);
  const quantity = eventStepQuantityLabel(step);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = note.trim();
    if (rule?.required && trimmed.length < Math.max(1, rule.minLength)) {
      setLocalError(
        rule.minLength > 1
          ? `${rule.label}: wpisz co najmniej ${rule.minLength} znaków.`
          : `Uzupełnij pole „${rule.label}”.`,
      );
      return;
    }
    if (trimmed.length > NOTE_LIMIT) {
      setLocalError(`Notatka może mieć najwyżej ${NOTE_LIMIT} znaków.`);
      return;
    }
    const payload: Record<string, unknown> = {};
    if (orderFields) {
      if (!deliveryDateValid) {
        setLocalError('Wpisz poprawną datę dostawy w formacie DD.MM.RRRR.');
        return;
      }
      if (deliveryDate) {
        const expected = localPartsToIso(deliveryDate, deliveryTime);
        if (!expected) {
          setLocalError('Wpisz poprawną datę i godzinę dostawy.');
          return;
        }
        payload.expected_at = expected;
      }
      if (supplier.trim()) payload.supplier = supplier.trim().slice(0, 300);
    }
    setLocalError('');
    void onSubmit({ note: trimmed, payload });
  };

  const shownError = localError || error;

  return (
    <EventStepDialog open title={label} description={step.title} onClose={onCancel} busy={busy}>
      <form onSubmit={submit} aria-busy={busy} className="space-y-4" noValidate>
        {(quantity || step.supplier) && (
          <p className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#e5e4e2]/75">
            {[quantity && `Ilość: ${quantity}`, step.supplier && `Dostawca: ${step.supplier}`].filter(Boolean).join(' · ')}
          </p>
        )}
        {action === 'skip' && (
          <p className="text-sm text-[#e5e4e2]/65">Powód pominięcia będzie widoczny w historii kroku.</p>
        )}
        {action === 'problem' && (
          <p className="text-sm text-[#e5e4e2]/65">
            Kierownik realizacji i prowadzący wydarzenie dostaną powiadomienie, a krok zostanie oznaczony na czerwono.
          </p>
        )}

        {orderFields && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-[#e5e4e2]/70 sm:col-span-2">
              Dostawca
              <input
                data-autofocus
                value={supplier}
                maxLength={300}
                disabled={busy}
                onChange={event => setSupplier(event.target.value)}
                placeholder="Np. Linde"
                className={stepInputClass}
              />
            </label>
            <SellerDatePicker
              label="Planowana dostawa — data"
              value={deliveryDate}
              onChange={setDeliveryDate}
              onValidityChange={setDeliveryDateValid}
            />
            <label className="block text-xs text-[#e5e4e2]/50">
              Godzina dostawy
              <input
                type="time"
                step={300}
                value={deliveryTime}
                disabled={busy || !deliveryDate}
                onChange={event => setDeliveryTime(event.target.value)}
                className={`${stepInputClass} h-11`}
              />
            </label>
          </div>
        )}

        {rule && (
          <div>
            <label htmlFor={`${id}-note`} className="block text-sm text-[#e5e4e2]/70">
              {rule.label}
              {rule.required && <span className="text-[#d3bb73]"> *</span>}
            </label>
            <textarea
              id={`${id}-note`}
              data-autofocus={orderFields ? undefined : true}
              rows={4}
              maxLength={NOTE_LIMIT}
              value={note}
              disabled={busy}
              required={rule.required}
              aria-invalid={Boolean(localError) && rule.required}
              aria-describedby={`${id}-note-hint`}
              placeholder={rule.placeholder}
              onChange={event => {
                setNote(event.target.value);
                if (localError) setLocalError('');
              }}
              className={stepInputClass}
            />
            <p id={`${id}-note-hint`} className="mt-1 flex justify-between gap-3 text-xs text-[#e5e4e2]/45">
              <span>
                {rule.required
                  ? rule.minLength > 1
                    ? `Wymagane, co najmniej ${rule.minLength} znaków.`
                    : 'Wymagane.'
                  : rule.minLength > 0
                    ? `Opcjonalnie — przy rozbieżnościach co najmniej ${rule.minLength} znaków.`
                    : 'Opcjonalnie.'}
              </span>
              <span className="tabular-nums">
                {note.length}/{NOTE_LIMIT}
              </span>
            </p>
          </div>
        )}

        {shownError && (
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {shownError}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-lg bg-white/5 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-white/10 disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
              action === 'problem'
                ? 'bg-red-500/80 text-white hover:bg-red-500'
                : 'bg-[#d3bb73] text-[#210811] hover:bg-[#d3bb73]/90'
            }`}
          >
            {busy ? 'Zapisywanie…' : label}
          </button>
        </div>
      </form>
    </EventStepDialog>
  );
}
