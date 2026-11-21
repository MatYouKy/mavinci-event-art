'use client';

import { useEffect, useState } from 'react';
import { Award, Check, Package, Search } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { formatShowcasePrice } from '@/lib/showcase/showcaseShared';
import { inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import { errorMessage, showcaseGet, type ShowcaseProductOption, type ShowcaseRealizationOption } from './showcaseApi';

/*
 * Wybór produktów z katalogu (Oferty → Produkty) albo realizacji ze strony do karty prezentacji. Już dodane są zaznaczone
 * i pomijane. `single` — jeden produkt („Utwórz z produktu”).
 */

type Option = { id: string; title: string; subtitle: string; thumbnailUrl: string | null };

export default function ShowcaseListPicker({ mode, exclude = [], single = false, title, confirmText, onClose, onPick }: {
  mode: 'products' | 'realizations';
  exclude?: string[];
  single?: boolean;
  title: string;
  confirmText?: string;
  onClose: () => void;
  onPick: (options: Array<{ id: string; title: string; thumbnailUrl: string | null }>) => void;
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [problem, setProblem] = useState('');
  const [selected, setSelected] = useState<Option[]>([]);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        if (mode === 'products') {
          const data = await showcaseGet<{ products: ShowcaseProductOption[] }>('products', { q: query });
          if (!active) return;
          setOptions(data.products.map((item) => ({
            id: item.id, title: item.name, thumbnailUrl: item.thumbnailUrl,
            subtitle: [item.category, item.priceNet != null ? `${formatShowcasePrice(item.priceNet)}${item.unit ? ` / ${item.unit}` : ''}` : ''].filter(Boolean).join(' · '),
          })));
        } else {
          const data = await showcaseGet<{ realizations: ShowcaseRealizationOption[] }>('realizations', { q: query });
          if (!active) return;
          setOptions(data.realizations.map((item) => ({
            id: item.id, title: item.title, thumbnailUrl: item.thumbnailUrl,
            subtitle: [item.location, item.date?.slice(0, 10), `${item.photos} zdj.`].filter(Boolean).join(' · '),
          })));
        }
        setProblem('');
      } catch (cause) {
        if (active) { setOptions([]); setProblem(errorMessage(cause, 'Nie udało się pobrać listy.')); }
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mode, query]);

  const toggle = (option: Option) => setSelected((current) => {
    if (single) return current[0]?.id === option.id ? [] : [option];
    return current.some((item) => item.id === option.id) ? current.filter((item) => item.id !== option.id) : [...current, option];
  });
  const Icon = mode === 'products' ? Package : Award;

  return (
    <Modal open onClose={onClose} title={title} scrollBody>
      <div className="space-y-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#e5e4e2]/40" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} autoFocus className={`${inputClass} pl-8`}
            placeholder={mode === 'products' ? 'Szukaj produktu w katalogu' : 'Szukaj realizacji'} />
        </label>
        <div className="max-h-[52vh] space-y-1 overflow-y-auto">
          {options.map((option) => {
            const added = exclude.includes(option.id);
            const active = selected.some((item) => item.id === option.id);
            return (
              <button key={option.id} type="button" disabled={added} onClick={() => toggle(option)}
                className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm ${active ? 'bg-[#d3bb73]/15' : 'hover:bg-[#d3bb73]/10'} disabled:opacity-40`}>
                {option.thumbnailUrl ? <img src={option.thumbnailUrl} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
                  : <span className="flex h-10 w-14 shrink-0 items-center justify-center rounded bg-[#0f1119]"><Icon className="h-4 w-4 text-[#d3bb73]/40" /></span>}
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.title}</span>
                  <span className="block truncate text-xs text-[#e5e4e2]/45">{added ? 'Już w karcie' : option.subtitle}</span>
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-[#d3bb73]" />}
              </button>
            );
          })}
          {!options.length && <p className="p-3 text-sm text-[#e5e4e2]/45">{problem || 'Brak wyników.'}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 pt-3">
          <button type="button" className={secondaryButton} onClick={onClose}>Anuluj</button>
          <button type="button" className={primaryButton} disabled={!selected.length} onClick={() => onPick(selected.map((item) => ({ id: item.id, title: item.title, thumbnailUrl: item.thumbnailUrl })))}>
            {confirmText || (single ? 'Wybierz' : `Dodaj (${selected.length})`)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
