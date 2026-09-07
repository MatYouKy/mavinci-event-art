'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
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
}: {
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

  const updateItem = (index: number, nextItem: EventAssumptionItem) => {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? nextItem : item)));
  };

  const generateWithAi = async () => {
    try {
      setGenerating(true);
      const { data, error } = await supabase.functions.invoke('assist-inquiry', {
        body: {
          action: 'draft_offer_assumptions',
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
      showSnackbar('AI przygotowało trzy robocze założenia', 'success');
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się przygotować założeń przez AI', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium text-[#e5e4e2]">Trzy najważniejsze założenia biznesowe</p>
          <p className="mt-1 text-xs leading-5 text-[#e5e4e2]/45">
            Wybierz informacje istotne dla tej konkretnej realizacji. Te trzy odpowiedzi pojawią się również w ofercie PDF.
          </p>
        </div>
        <button
          type="button"
          onClick={generateWithAi}
          disabled={generating}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/10 px-3 py-2 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-400/15 disabled:cursor-wait disabled:opacity-60"
        >
          {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {generating ? 'AI przygotowuje…' : 'Zaproponuj z AI'}
        </button>
      </div>

      {value.map((item, index) => {
        const option = getEventAssumptionOption(item.key);
        const selectedKeys = new Set(value.map((entry) => entry.key));
        return (
          <div key={`${index}-${item.key}`} className="rounded-lg border border-[#d3bb73]/15 bg-[#0f1118] p-3">
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
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#161927] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
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
                  className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
                />
              </div>
            )}

            <label className="mb-1.5 block text-xs text-[#d3bb73]">
              Wartość w burgundowym znaczniku <span className="text-[#e5e4e2]/35">(opcjonalnie)</span>
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
                className="w-44 rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2 text-sm uppercase text-[#e5e4e2] placeholder:normal-case placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
              />
              <span className="text-xs leading-5 text-[#e5e4e2]/40">
                Np. „180”, „6 H”, „100%” lub „WOW”. Gdy pole jest puste, pojawi się numer sekcji 0{index + 1}.
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
                className="w-full resize-y rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2 text-sm leading-5 text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
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
                className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#090b13] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/25 focus:border-[#d3bb73]/50 focus:outline-none"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
