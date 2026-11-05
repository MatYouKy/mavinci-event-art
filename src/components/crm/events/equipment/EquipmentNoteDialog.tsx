'use client';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import EventStepDialog from '../steps/EventStepDialog';
import { equipmentDangerButton, equipmentInputClass, equipmentPrimaryButton } from './equipmentChecklistUi';

export type EquipmentNoteDialogConfig = {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  /** Notatka wymagana — co najmniej `minLength` znaków (te same progi co w bazie). */
  required: boolean;
  minLength: number;
  maxLength: number;
  submitLabel: string;
  danger?: boolean;
  initialNote?: string;
};

/** Okno z notatką / powodem dla czynności checklisty (zgoda, odmowa, potwierdzenie, odblokowanie, cofnięcie). */
export default function EquipmentNoteDialog({
  open,
  config,
  busy,
  error,
  onCancel,
  onSubmit,
  children,
  submitDisabled = false,
}: {
  open: boolean;
  config: EquipmentNoteDialogConfig | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onSubmit: (note: string) => void | Promise<void>;
  children?: ReactNode;
  submitDisabled?: boolean;
}) {
  const id = useId();
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState('');
  const resetKey = open && config ? `${config.title}:${config.initialNote ?? ''}` : '';

  useEffect(() => {
    if (!resetKey) return;
    setNote(config?.initialNote ?? '');
    setLocalError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!open || !config) return null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || submitDisabled) return;
    const trimmed = note.trim();
    if (config.required && trimmed.length < Math.max(1, config.minLength)) {
      setLocalError(`${config.label}: wpisz co najmniej ${Math.max(1, config.minLength)} znaków.`);
      return;
    }
    if (trimmed.length > config.maxLength) {
      setLocalError(`Notatka może mieć najwyżej ${config.maxLength} znaków.`);
      return;
    }
    setLocalError('');
    void onSubmit(trimmed);
  };

  const shownError = localError || error;

  return (
    <EventStepDialog open title={config.title} description={config.description} onClose={onCancel} busy={busy}>
      <form onSubmit={submit} aria-busy={busy} className="space-y-4" noValidate>
        {children}
        <div>
          <label htmlFor={`${id}-note`} className="block text-sm text-[#e5e4e2]/70">
            {config.label}
            {config.required && <span className="text-[#d3bb73]"> *</span>}
          </label>
          <textarea
            id={`${id}-note`}
            data-autofocus
            rows={4}
            maxLength={config.maxLength}
            value={note}
            disabled={busy}
            required={config.required}
            aria-invalid={Boolean(localError)}
            aria-describedby={`${id}-hint`}
            placeholder={config.placeholder}
            onChange={event => {
              setNote(event.target.value);
              if (localError) setLocalError('');
            }}
            className={`mt-1 ${equipmentInputClass}`}
          />
          <p id={`${id}-hint`} className="mt-1 flex justify-between gap-3 text-xs text-[#e5e4e2]/45">
            <span>{config.required ? `Wymagane, co najmniej ${Math.max(1, config.minLength)} znaków.` : 'Opcjonalnie.'}</span>
            <span className="tabular-nums">
              {note.length}/{config.maxLength}
            </span>
          </p>
        </div>

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
          <button type="submit" disabled={busy || submitDisabled} className={config.danger ? equipmentDangerButton : equipmentPrimaryButton}>
            {busy ? 'Zapisywanie…' : config.submitLabel}
          </button>
        </div>
      </form>
    </EventStepDialog>
  );
}
