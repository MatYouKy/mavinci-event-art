'use client';

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';

/**
 * „Edytuj” na karcie eventu: zmiana nazwy. Zapisuje wyłącznie nazwę — termin, lokalizację, klienta, firmę realizującą,
 * kategorię i status zmienia się przy polach w „Szczegółach”, więc okno niczego innego nie nadpisuje.
 * Ten sam zakres na Macu (`EventEditSheet`) i w telefonie (nagłówek karty eventu).
 */
export const EVENT_NAME_MAX = 500;

export default function EventRenameModal({
  isOpen,
  name,
  onClose,
  onSave,
}: {
  isOpen: boolean;
  name: string;
  onClose: () => void;
  /** Zapis nazwy; `true` — zapisano (okno się zamyka). */
  onSave: (name: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setValue(name);
    setError(null);
  }, [isOpen, name]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, saving, onClose]);

  if (!isOpen) return null;

  const trimmed = value.trim();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    if (!trimmed) {
      setError('Nazwa eventu jest wymagana');
      return;
    }
    if (trimmed.length > EVENT_NAME_MAX) {
      setError(`Nazwa eventu może mieć najwyżej ${EVENT_NAME_MAX} znaków`);
      return;
    }
    if (trimmed === name.trim()) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    const saved = await onSave(trimmed);
    setSaving(false);
    if (saved) onClose();
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" onClick={() => { if (!saving) onClose(); }}>
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6"
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-light uppercase tracking-wide text-[#e5e4e2]">Zmień nazwę eventu</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#e5e4e2] disabled:opacity-50"
            aria-label="Zamknij"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <label htmlFor="event-rename" className="mb-2 block text-sm text-[#e5e4e2]/60">
          Nazwa eventu
        </label>
        <input
          id="event-rename"
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          maxLength={EVENT_NAME_MAX}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          placeholder="np. Studniówka 2027 LO II"
        />
        {error ? (
          <p className="mt-2 text-sm text-red-400">{error}</p>
        ) : (
          <p className="mt-2 text-xs text-[#e5e4e2]/45">
            Zmienia się tylko nazwa. Termin, lokalizację, klienta, firmę realizującą, kategorię i status zmienisz przy polach
            w zakładce „Szczegóły”.
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/70 hover:bg-[#1c1f33] disabled:opacity-50"
          >
            Anuluj
          </button>
          <button
            type="submit"
            disabled={saving || !trimmed}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Zapisz nazwę
          </button>
        </div>
      </form>
    </div>
  );
}
