'use client';

import { useState } from 'react';
import { Loader2, Wand2 } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import {
  SHOWCASE_AI_FIELDS, SHOWCASE_AI_LABELS, type ShowcaseAiField, type ShowcaseAiSuggestion, type ShowcaseContent, type ShowcasePoint,
} from '@/lib/showcase/showcaseShared';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import { errorMessage, showcasePost } from './showcaseApi';

/*
 * Asystent AI w edytorze karty (CRM; to samo na Macu): z danych produktów karty (Oferty → Produkty) i opisu od sprzedawcy
 * proponuje hasło, wstęp, korzyści, kroki przygotowania, specyfikację i pytania klientów. Propozycje nie zapisują się same —
 * sprzedawca zaznacza, co wstawić (do szkicu karty), i zapisuje kartę.
 */

type Input = { title: string; tagline: string; productIds: string[]; content: ShowcaseContent };

export default function ShowcaseAssistant({ input, onClose, onApply }: {
  input: Input;
  onClose: () => void;
  onApply: (suggestion: ShowcaseAiSuggestion, fields: ShowcaseAiField[]) => void;
}) {
  const [fields, setFields] = useState<ShowcaseAiField[]>(() => SHOWCASE_AI_FIELDS.filter((field) => {
    if (field === 'tagline') return !input.tagline.trim();
    if (field === 'lead') return input.content.lead.trim().length < 25;
    return true;
  }));
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestion, setSuggestion] = useState<ShowcaseAiSuggestion | null>(null);
  const [chosen, setChosen] = useState<ShowcaseAiField[]>([]);

  const toggle = (list: ShowcaseAiField[], field: ShowcaseAiField) => (list.includes(field) ? list.filter((item) => item !== field) : [...list, field]);

  const ask = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await showcasePost<ShowcaseAiSuggestion>('assist', { ...input, brief, fields });
      setSuggestion(result);
      setChosen(fields.filter((field) => {
        const value = result[field];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
      }));
    } catch (cause) {
      setError(errorMessage(cause, 'Asystent AI nie odpowiedział.'));
    } finally {
      setBusy(false);
    }
  };

  const rows = (points: ShowcasePoint[] | undefined) => (points || []).map((point, index) => (
    <li key={index} className="text-[13px] leading-5"><span className="text-[#e5e4e2]">{point.title}</span>{point.text ? <span className="text-[#e5e4e2]/60"> — {point.text}</span> : null}</li>
  ));

  return (
    <Modal open onClose={onClose} title="Asystent AI" scrollBody>
      {!suggestion ? (
        <div className="space-y-4">
          <p className="text-sm text-[#e5e4e2]/60">Asystent pisze z danych produktów karty (Oferty → Produkty) i Twojego opisu. Nie wymyśla cen ani wymiarów — propozycje sprawdzasz i wstawiasz sam.</p>
          {!input.productIds.length && !input.content.blocks.some((block) => block.productId) && (
            <p className={`${cardClass} p-3 text-sm text-amber-200`}>Karta nie ma produktów z katalogu — dodaj produkt albo opisz poniżej, co pokazujesz.</p>
          )}
          <div className="flex flex-wrap gap-2">
            {SHOWCASE_AI_FIELDS.map((field) => (
              <button key={field} type="button" onClick={() => setFields((list) => toggle(list, field))}
                className={`rounded-full border px-3 py-1.5 text-sm ${fields.includes(field) ? 'border-[#d3bb73] bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#d3bb73]/20 text-[#e5e4e2]/70'}`}>
                {SHOWCASE_AI_LABELS[field]}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="text-xs text-[#e5e4e2]/60">Co podkreślić? (opcjonalnie)</span>
            <textarea value={brief} onChange={(event) => setBrief(event.target.value.slice(0, 2000))} rows={3} className={`${inputClass} resize-y`}
              placeholder="np. klienci to pary młode, ważne: bezpieczeństwo w sali i zdjęcia z pierwszego tańca" />
          </label>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 pt-3">
            <button type="button" className={secondaryButton} onClick={onClose}>Anuluj</button>
            <button type="button" className={primaryButton} disabled={busy || !fields.length} onClick={() => void ask()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}{busy ? 'Asystent pisze…' : 'Zaproponuj treść'}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-[#e5e4e2]/60">Zaznacz, co wstawić. Hasło i wstęp zastąpią obecne, wiersze trafią do bloków karty (brakujący blok powstanie na końcu).</p>
          {fields.map((field) => {
            const value = suggestion[field];
            const empty = Array.isArray(value) ? !value.length : !value;
            return (
              <label key={field} className={`${cardClass} flex cursor-pointer gap-3 p-3 ${empty ? 'opacity-50' : ''}`}>
                <input type="checkbox" disabled={empty} checked={chosen.includes(field)} onChange={() => setChosen((list) => toggle(list, field))} className="mt-1 accent-[#d3bb73]" />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="block text-sm text-[#d3bb73]">{SHOWCASE_AI_LABELS[field]}</span>
                  {empty ? <span className="block text-[13px] text-[#e5e4e2]/50">Brak danych — asystent niczego nie zaproponował.</span>
                    : typeof value === 'string' ? <span className="block whitespace-pre-line text-[13px] leading-5">{value}</span>
                      : <ul className="list-disc space-y-1 pl-4">{rows(value as ShowcasePoint[])}</ul>}
                </span>
              </label>
            );
          })}
          <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 pt-3">
            <button type="button" className={secondaryButton} onClick={() => setSuggestion(null)}>Popraw prośbę</button>
            <button type="button" className={primaryButton} disabled={!chosen.length} onClick={() => onApply(suggestion, chosen)}>Wstaw zaznaczone ({chosen.length})</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
