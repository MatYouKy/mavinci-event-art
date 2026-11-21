'use client';

import { useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { portfolioWithAlts, portfolioWithTitle, type PortfolioContent } from '@/lib/portfolio/portfolioShared';
import { cardClass, inputClass, secondaryButton } from '../social/socialUi';
import { portfolioPost, type PortfolioAiResult } from './portfolioApi';

/*
 * Asystent AI realizacji (CRM; to samo na Macu i w telefonie): z notatki (wspólnej z przyciskami AI przy sekcjach) i danych
 * realizacji przygotowuje naraz kilka pól — tytuł, opisy, opis w Google, słowa kluczowe, elementy realizacji i opisy zdjęć.
 * Propozycje nie zmieniają realizacji, dopóki ich nie użyjesz.
 */

type Field = 'title' | 'description' | 'detailedDescription' | 'metaDescription' | 'keywords' | 'features' | 'alts';
const FIELDS: Array<[Field, string]> = [
  ['title', 'Tytuł'], ['description', 'Krótki opis'], ['detailedDescription', 'Szczegółowy opis'], ['metaDescription', 'Opis w Google'],
  ['keywords', 'Słowa kluczowe'], ['features', 'Elementy realizacji'], ['alts', 'Opisy zdjęć (alt)'],
];
type Run = <T>(title: string, action: () => Promise<T>, success?: string, description?: string) => Promise<T | null>;

export default function PortfolioAssistant({ itemId, content, eventId, onSite, brief, onBrief, run, onApply }: {
  itemId: string;
  content: PortfolioContent;
  eventId: string | null;
  /** Realizacja na stronie — adres strony nie idzie za nowym tytułem. */
  onSite: boolean;
  brief: string;
  onBrief: (value: string) => void;
  run: Run;
  onApply: (patch: Partial<PortfolioContent>) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [fields, setFields] = useState<Field[]>(['description', 'detailedDescription', 'metaDescription', 'keywords']);
  const [usePhotos, setUsePhotos] = useState(false);
  const [result, setResult] = useState<PortfolioAiResult | null>(null);
  const photos = (content.image ? 1 : 0) + content.gallery.length;

  const ask = async () => {
    const data = await run('Asystent AI pisze', () => portfolioPost<PortfolioAiResult>('assist', {
      id: itemId, content, eventId, brief, fields, usePhotos: usePhotos && photos > 0,
    }), undefined, 'Teksty realizacji na stronę i do Google…');
    if (data) setResult(data);
  };

  const patchFor = (field: Field, value: PortfolioAiResult): Partial<PortfolioContent> | null => {
    switch (field) {
      case 'title': return value.title ? portfolioWithTitle(content, value.title, onSite) : null;
      case 'description': return value.description ? { description: value.description } : null;
      case 'detailedDescription': return value.detailedDescription ? { detailedDescription: value.detailedDescription } : null;
      case 'metaDescription': return value.metaDescription ? { metaDescription: value.metaDescription } : null;
      case 'keywords': return value.keywords?.length ? { keywords: value.keywords } : null;
      case 'features': return value.features?.length ? { features: value.features } : null;
      case 'alts': return value.alts?.length ? portfolioWithAlts(content, value.alts, true).patch : null;
      default: return null;
    }
  };

  const use = (field: Field) => {
    if (!result) return;
    const patch = patchFor(field, result);
    if (patch) { onApply(patch); showSnackbar('Wstawiono propozycję — zapisz realizację', 'success'); }
  };

  const useAll = () => {
    if (!result) return;
    const patch = FIELDS.reduce<Partial<PortfolioContent>>((all, [field]) => ({ ...all, ...(patchFor(field, result) || {}) }), {});
    onApply(patch);
    showSnackbar('Wstawiono wszystkie propozycje — zapisz realizację', 'success');
  };

  const preview = (field: Field): string => {
    if (!result) return '';
    switch (field) {
      case 'keywords': return (result.keywords || []).join(', ');
      case 'features': return (result.features || []).map((item) => `${item.title}${item.description ? ` — ${item.description}` : ''}`).join('\n');
      case 'alts': return `${result.alts?.length || 0} opisów zdjęć`;
      default: return String(result[field] || '');
    }
  };

  return (
    <section className={`${cardClass} space-y-3 p-4`}>
      <h3 className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4 text-[#d3bb73]" />Asystent AI</h3>
      <p className="text-[11px] text-[#e5e4e2]/45">Kilka pól naraz. Pojedyncze sekcje — przyciski AI przy tytule, opisach, elementach, SEO i zdjęciach.</p>
      <textarea value={brief} onChange={(event) => onBrief(event.target.value)} rows={3} maxLength={1500} className={inputClass}
        placeholder="Notatka dla asystenta (ta sama co w „Podstawach”): dla kogo, co przygotowaliśmy (scena, technika, program), co było wyjątkowe." />
      <div className="flex flex-wrap gap-1.5">
        {FIELDS.map(([field, label]) => {
          const active = fields.includes(field);
          return (
            <button key={field} type="button" onClick={() => setFields((current) => (active ? current.filter((item) => item !== field) : [...current, field]))}
              className={`rounded-full border px-2.5 py-1 text-xs ${active ? 'border-[#d3bb73]/70 bg-[#d3bb73]/20 text-[#d3bb73]' : 'border-[#d3bb73]/15 text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
              {active && <Check className="mr-0.5 inline h-3 w-3" />}{label}
            </button>
          );
        })}
      </div>
      <label className={`flex items-center gap-2 text-xs ${photos ? 'text-[#e5e4e2]/70' : 'text-[#e5e4e2]/30'}`}>
        <input type="checkbox" checked={usePhotos && photos > 0} disabled={!photos} onChange={(event) => setUsePhotos(event.target.checked)} />
        Uwzględnij zdjęcia (opis tego, co na nich widać; przy opisach zdjęć — zawsze)
      </label>
      <button type="button" className={secondaryButton} disabled={!fields.length} onClick={() => void ask()}><Sparkles className="h-4 w-4" />Przygotuj teksty</button>
      {result && (
        <div className="space-y-2 border-t border-[#d3bb73]/10 pt-3">
          <div className="flex items-center justify-between text-xs text-[#e5e4e2]/50">
            <span>Propozycje{result.usedPhotos ? ' (ze zdjęciami)' : ''}</span>
            <button type="button" className="text-[#d3bb73] hover:underline" onClick={useAll}>Użyj wszystkich</button>
          </div>
          {FIELDS.filter(([field]) => preview(field)).map(([field, label]) => (
            <div key={field} className="rounded-lg bg-[#0f1119]/70 p-2 text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[#d3bb73]">{label}</span>
                <button type="button" className="text-[#d3bb73] hover:underline" onClick={() => use(field)}>Użyj</button>
              </div>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[#e5e4e2]/80">{preview(field)}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-[#e5e4e2]/40">Do AI trafia treść realizacji, rodzaj, miejsce i data wydarzenia oraz — gdy zaznaczysz — zdjęcia ze strony. Bez danych osobowych.</p>
    </section>
  );
}
