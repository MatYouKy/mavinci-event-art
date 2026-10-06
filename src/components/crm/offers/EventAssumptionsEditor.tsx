'use client';

import { useId, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import { Loader2, Sparkles, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  EVENT_ASSUMPTION_OPTIONS,
  EVENT_ASSUMPTION_VALUE_MAX_LENGTH,
  EventAssumptionItem,
  EventAssumptionKey,
  getEventAssumptionOption,
} from '@/lib/CRM/Offers/eventAssumptions';

export function EventAssumptionsEditor({
  value,
  onChange,
  aiContext,
  showAiAction = true,
}: {
  showAiAction?: boolean;
  value: EventAssumptionItem[];
  onChange: (items: EventAssumptionItem[]) => void;
  aiContext?: {
    inquiryId?: string;
    eventCategory?: string;
    productNames?: string[];
  };
}) {
  const { showSnackbar } = useSnackbar();
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [showAiDialog, setShowAiDialog] = useState(false);
  const [aiInstructions, setAiInstructions] = useState('');
  const dialogTitleId = useId();
  const instructionsId = useId();

  const updateItem = (index: number, nextItem: EventAssumptionItem) => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? nextItem : item)));
  };

  const generateWithAi = async () => {
    if (generatingRef.current) return;
    generatingRef.current = true;
    try {
      setGenerating(true);
      const { data, error } = await supabase.functions.invoke('assist-inquiry', {
        body: {
          action: 'draft_offer_assumptions',
          ...(aiInstructions.trim() ? { additionalInstructions: aiInstructions.trim() } : {}),
          inquiryId: aiContext?.inquiryId || undefined,
          context: {
            event_category: String(aiContext?.eventCategory || '').slice(0, 100),
            product_names: (aiContext?.productNames || [])
              .map((name) => String(name).slice(0, 120))
              .filter(Boolean)
              .slice(0, 30),
          },
        },
      });
      if (error) {
        let errorMessage = error.message;
        const response = (error as any).context;
        if (response instanceof Response) {
          const payload = await response.clone().json().catch(() => null);
          if (payload?.error) errorMessage = payload.error;
        }
        throw new Error(errorMessage);
      }

      const candidates = Array.isArray(data?.result?.assumptions)
        ? data.result.assumptions
        : [];
      const allowedKeys = new Set(EVENT_ASSUMPTION_OPTIONS.map((option) => option.key));
      const usedKeys = new Set<EventAssumptionKey>();
      const assumptions = candidates.reduce<EventAssumptionItem[]>((result, candidate) => {
        const key = String(candidate?.key || '') as EventAssumptionKey;
        if (!allowedKeys.has(key) || (key !== 'custom' && usedKeys.has(key))) return result;
        if (key !== 'custom') usedKeys.add(key);
        const option = getEventAssumptionOption(key);
        const itemValue = String(candidate?.value || '').trim();
        if (!itemValue) return result;
        result.push({
          key,
          label: key === 'custom'
            ? String(candidate?.label || option.label).trim().slice(0, 80)
            : option.label,
          value: itemValue.slice(0, EVENT_ASSUMPTION_VALUE_MAX_LENGTH),
          badge_value: String(candidate?.badge_value || '').trim().slice(0, 7),
        });
        return result;
      }, []).slice(0, 3);

      if (assumptions.length !== 3) {
        throw new Error('AI nie przygotowało trzech kompletnych założeń. Spróbuj ponownie.');
      }
      onChange(assumptions);
      setShowAiDialog(false);
      showSnackbar('AI przygotowało trzy robocze założenia', 'success');
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się przygotować założeń przez AI', 'error');
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[#e5e4e2]">Założenia realizacji — trzy najważniejsze informacje</p>
          <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">
            Jedno miejsce na założenia i informacje o realizacji. Te same trzy karty oraz ich liczbowe znaczniki trafią do oferty PDF.
          </p>
        </div>
        {showAiAction && <button
          type="button"
          onClick={() => setShowAiDialog(true)}
          disabled={generating}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/10 px-3 py-2 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-400/15 disabled:cursor-wait disabled:opacity-60"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {generating ? 'AI przygotowuje…' : 'Zaproponuj z AI'}
        </button>}
      </div>

      <Dialog
        open={showAiDialog}
        onClose={() => { if (!generating) setShowAiDialog(false); }}
        aria-labelledby={dialogTitleId}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { backgroundColor: '#30101f', color: '#e5e4e2', borderRadius: '16px', border: '1px solid rgba(211,187,115,0.2)' } }}
      >
        <div className="brand-theme p-6">
          <div className="flex items-start justify-between gap-4">
            <h2 id={dialogTitleId} className="text-lg uppercase text-[#e5e4e2]">Zaproponuj założenia z AI</h2>
            <button type="button" aria-label="Zamknij" disabled={generating} onClick={() => setShowAiDialog(false)} className="text-[#e5e4e2]/60 hover:text-[#d3bb73] disabled:opacity-30"><X className="h-5 w-5" /></button>
          </div>
          <div className="mt-5 rounded-lg border border-[#d3bb73]/15 bg-[#1b0710] p-4">
            <p className="text-sm font-medium text-[#d3bb73]">Podstawa propozycji</p>
            <p className="mt-2 text-sm leading-6 text-[#e5e4e2]/65">AI przygotuje trzy konkretne założenia biznesowe na podstawie zapytania, rodzaju wydarzenia i wybranych produktów. Opisze korzyści i priorytety realizacji, bez dopowiadania nieznanych faktów.</p>
          </div>
          <label htmlFor={instructionsId} className="mb-2 mt-5 block text-sm text-[#e5e4e2]">Co chcesz osiągnąć? <span className="text-[#e5e4e2]/45">(opcjonalnie)</span></label>
          <textarea
            id={instructionsId}
            autoFocus
            rows={5}
            maxLength={2000}
            value={aiInstructions}
            disabled={generating}
            onChange={(event) => setAiInstructions(event.target.value)}
            placeholder="Np. podkreśl prestiż wydarzenia, komfort prelegentów i widoczność prezentacji. Chcę przekonać organizatora, że zadbamy o każdy szczegół. Ton profesjonalny, bez przesadnych sloganów."
            className="w-full resize-y rounded-lg border border-[#d3bb73]/20 bg-[#15070d] px-3 py-3 text-sm leading-6 text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/50 focus:outline-none disabled:opacity-60"
          />
          <div className="mt-1 flex justify-between gap-3 text-xs text-[#e5e4e2]/45"><span>Puste pole = propozycja według bazowej instrukcji.</span><span>{aiInstructions.length}/2000</span></div>
          <p className="mt-4 text-xs leading-5 text-[#e5e4e2]/50">Propozycja zastąpi trzy założenia w edytorze. Przed zapisaniem oferty możesz je jeszcze poprawić.</p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" disabled={generating} onClick={() => setShowAiDialog(false)} className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 disabled:opacity-40">Anuluj</button>
            <button type="button" disabled={generating} onClick={generateWithAi} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1b0710] disabled:cursor-wait disabled:opacity-60">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? 'AI przygotowuje…' : 'Przygotuj propozycję'}
            </button>
          </div>
        </div>
      </Dialog>

      {value.map((item, index) => {
        const option = getEventAssumptionOption(item.key);
        const selectedKeys = new Set(value.map((entry) => entry.key));
        return (
          <div key={`${index}-${item.key}`} className="rounded-lg border border-[#d3bb73]/15 bg-[#1b0710] p-3">
            <div className="mb-2 flex items-center gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#d3bb73]/15 text-xs font-semibold text-[#d3bb73]">
                {index + 1}
              </span>
              <select
                value={item.key}
                onChange={(event) => {
                  const key = event.target.value as EventAssumptionKey;
                  const nextOption = getEventAssumptionOption(key);
                  updateItem(index, {
                    key,
                    label: key === 'custom' ? '' : nextOption.label,
                    value: nextOption.defaultValue || '',
                    badge_value: nextOption.defaultBadgeValue || '',
                  });
                }}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#30101f] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              >
                {EVENT_ASSUMPTION_OPTIONS.map((candidate) => (
                  <option
                    key={candidate.key}
                    value={candidate.key}
                    disabled={candidate.key !== 'custom'
                      && candidate.key !== item.key
                      && selectedKeys.has(candidate.key)}
                  >
                    {candidate.label}
                  </option>
                ))}
              </select>
            </div>

            {item.key === 'custom' && (
              <div className="mb-3">
                <label className="mb-1.5 block text-xs text-[#d3bb73]">
                  Własny tytuł założenia
                </label>
                <input
                  value={item.label === option.label ? '' : item.label}
                  onChange={(event) => updateItem(index, {
                    ...item,
                    label: event.target.value.slice(0, 80),
                  })}
                  maxLength={80}
                  placeholder="np. Energia na parkiecie"
                  className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#15070d] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>
            )}

            <label className="mb-1.5 block text-xs text-[#d3bb73]">
              Wartość liczbowa w burgundowym znaczniku
            </label>
            <div className="mb-3 flex items-center gap-3">
              <input
                value={item.badge_value || ''}
                onChange={(event) => updateItem(index, {
                  ...item,
                  badge_value: event.target.value.toLocaleUpperCase('pl-PL').slice(0, 7),
                })}
                maxLength={7}
                placeholder={`Puste pole = 0${index + 1}`}
                className="w-44 rounded-lg border border-[#d3bb73]/15 bg-[#15070d] px-3 py-2 text-sm uppercase text-[#e5e4e2] placeholder:normal-case placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
              />
              <span className="text-xs leading-5 text-[#e5e4e2]/40">
                Np. „180”, „6 H” lub „2 SALE” — tylko gdy wynika to z ustaleń. Bez danych zostaw puste pole: PDF pokaże numer 0{index + 1}.
              </span>
            </div>

            <div className="mb-1.5 flex items-end justify-between gap-3">
              <label className="block text-xs text-[#d3bb73]">{option.question}</label>
              <span className={`shrink-0 text-[10px] ${item.value.length >= EVENT_ASSUMPTION_VALUE_MAX_LENGTH ? 'text-amber-300' : 'text-[#e5e4e2]/30'}`}>
                {item.value.length}/{EVENT_ASSUMPTION_VALUE_MAX_LENGTH}
              </span>
            </div>
            {option.multiline ? (
              <textarea
                value={item.value}
                onChange={(event) => updateItem(index, {
                  ...item,
                  value: event.target.value.slice(0, EVENT_ASSUMPTION_VALUE_MAX_LENGTH),
                })}
                maxLength={EVENT_ASSUMPTION_VALUE_MAX_LENGTH}
                rows={3}
                placeholder={option.placeholder}
                className="w-full resize-y rounded-lg border border-[#d3bb73]/15 bg-[#15070d] px-3 py-2 text-sm leading-5 text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
              />
            ) : (
              <input
                value={item.value}
                onChange={(event) => updateItem(index, {
                  ...item,
                  value: event.target.value.slice(0, EVENT_ASSUMPTION_VALUE_MAX_LENGTH),
                })}
                maxLength={EVENT_ASSUMPTION_VALUE_MAX_LENGTH}
                placeholder={option.placeholder}
                className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#15070d] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
