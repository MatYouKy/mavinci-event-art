'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  buildOfferRequirements,
  getOfferRequirementLabel,
  getOfferRequirementPriority,
  type OfferRequirementEntry,
} from '@/lib/CRM/Offers/offerRequirements';

type Props = {
  offer: any;
  canEdit: boolean;
  onSaved: () => void;
};

const parseStoredRequirements = (value: unknown): OfferRequirementEntry[] => {
  if (Array.isArray(value)) return value as OfferRequirementEntry[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

export default function OfferRequirementsEditor({ offer, canEdit, onSaved }: Props) {
  const { showSnackbar } = useSnackbar();
  const [requirements, setRequirements] = useState<OfferRequirementEntry[]>([]);
  const [templateRequirements, setTemplateRequirements] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const offerItems = useMemo(() => offer.offer_items || [], [offer.offer_items]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const categoryTemplateId = offer.event?.category?.default_offer_template_category_id || null;
      let query = supabase
        .from('offer_template_categories')
        .select('id, design_config')
        .limit(1);
      query = categoryTemplateId
        ? query.eq('id', categoryTemplateId)
        : query.eq('is_default', true);
      const { data } = await query.maybeSingle();
      if (cancelled) return;
      const baseText = String((data?.design_config as any)?.technical_requirements_text || '');
      setTemplateRequirements(baseText);
      setRequirements(buildOfferRequirements({
        templateRequirements: baseText,
        items: offerItems,
        storedRequirements: parseStoredRequirements(offer.offer_requirements),
        refreshAutomaticSources: offer.status === 'draft',
      }));
      setDirty(false);
      setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [offer.id, offer.offer_requirements, offer.status, offer.event?.category?.default_offer_template_category_id, offerItems]);

  const updateRequirement = (key: string, patch: Partial<OfferRequirementEntry>) => {
    setRequirements((current) => current.map((item) => {
      if (item.key !== key) return item;
      const next = { ...item, ...patch };
      return { ...next, priority: getOfferRequirementPriority(next.category, next.description) };
    }));
    setDirty(true);
  };

  const addRequirement = () => {
    setRequirements((current) => [
      ...current,
      {
        key: `manual:${Date.now()}`,
        category: 'other',
        title: 'WŁASNE WYMAGANIE',
        description: '',
        sources: ['Ustalenie w ofercie'],
        origin: 'manual',
        included: true,
        priority: 0,
      },
    ]);
    setDirty(true);
  };

  const removeRequirement = (entry: OfferRequirementEntry) => {
    if (entry.origin === 'manual') {
      setRequirements((current) => current.filter((item) => item.key !== entry.key));
    } else {
      updateRequirement(entry.key, { included: false });
    }
    setDirty(true);
  };

  const restoreAutomatic = () => {
    setRequirements(buildOfferRequirements({ templateRequirements, items: offerItems, storedRequirements: [] }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const normalized = requirements
        .filter((item) => item.description.trim())
        .map((item) => ({
          ...item,
          title: item.title.trim() || getOfferRequirementLabel(item.category),
          description: item.description.trim(),
          priority: getOfferRequirementPriority(item.category, item.description),
        }));
      const { error } = await supabase.from('offers').update({ offer_requirements: normalized }).eq('id', offer.id);
      if (error) throw error;
      setRequirements(normalized);
      setDirty(false);
      showSnackbar('Wymagania oferty zostały zapisane', 'success');
      onSaved();
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się zapisać wymagań', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 md:p-6">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-start justify-between gap-4 text-left"
        aria-expanded={isOpen}
      >
        <div className="min-w-0">
          <h2 className="text-lg font-light text-[#e5e4e2]">Wymagania techniczne oferty</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#e5e4e2]/50">
            Sekcja jest budowana z szablonu głównego, kategorii i dodanych produktów. Powtórzenia są scalane automatycznie, a mocniejszy warunek ma pierwszeństwo — np. zasilanie 400 V / trójfazowe zastępuje 230 V.
          </p>
          {!loading && (
            <p className="mt-2 text-[11px] font-medium text-[#d3bb73]/75">
              {requirements.filter((entry) => entry.included).length} uwzględnionych wymagań · {isOpen ? 'Zwiń sekcję' : 'Otwórz i zweryfikuj'}
            </p>
          )}
        </div>
        <span className="mt-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[#d3bb73]/15 text-[#d3bb73]">
          <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>

      {isOpen && canEdit && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-[#d3bb73]/10 pt-4">
          <button type="button" onClick={restoreAutomatic} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">
            <RotateCcw className="h-3.5 w-3.5" /> Odśwież automatycznie
          </button>
          <button type="button" onClick={addRequirement} className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10">
            <Plus className="h-3.5 w-3.5" /> Dodaj wymaganie
          </button>
          <button type="button" onClick={save} disabled={saving || !dirty} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#1c1f33] disabled:cursor-not-allowed disabled:opacity-40">
            <Save className="h-3.5 w-3.5" /> {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
        </div>
      )}

      {isOpen && (
        <>
          {loading ? (
            <div className="mt-5 rounded-lg border border-dashed border-[#d3bb73]/15 px-4 py-8 text-center text-sm text-[#e5e4e2]/45">Scalanie wymagań…</div>
          ) : requirements.length === 0 ? (
            <div className="mt-5 rounded-lg border border-dashed border-[#d3bb73]/15 px-4 py-8 text-center text-sm text-[#e5e4e2]/45">Brak wymagań dla aktualnego zakresu.</div>
          ) : (
            <div className="mt-5 space-y-3">
              {requirements.map((entry) => (
                <div key={entry.key} className={`rounded-xl border p-4 transition-colors ${entry.included ? 'border-[#d3bb73]/15 bg-[#0d0f1a]' : 'border-white/5 bg-[#0d0f1a]/45 opacity-55'}`}>
                  <div className="flex items-start gap-3">
                    <button type="button" disabled={!canEdit} onClick={() => updateRequirement(entry.key, { included: !entry.included })} className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${entry.included ? 'border-[#d3bb73] bg-[#d3bb73] text-[#1c1f33]' : 'border-white/20 text-transparent'}`} title={entry.included ? 'Uwzględniane w PDF' : 'Pominięte w PDF'}>
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center">
                        {canEdit ? (
                          <input value={entry.title} onChange={(event) => updateRequirement(entry.key, { title: event.target.value })} className="min-w-0 flex-1 rounded-md border border-[#d3bb73]/10 bg-[#121625] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#d3bb73] outline-none focus:border-[#d3bb73]/45" />
                        ) : (
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-[#d3bb73]">{entry.title}</h3>
                        )}
                        <span className="text-[10px] uppercase tracking-wide text-[#e5e4e2]/35">{getOfferRequirementLabel(entry.category)}</span>
                      </div>
                      {canEdit ? (
                        <textarea rows={2} value={entry.description} onChange={(event) => updateRequirement(entry.key, { description: event.target.value })} className="mt-2 w-full resize-y rounded-md border border-[#d3bb73]/10 bg-[#121625] px-3 py-2 text-sm leading-relaxed text-[#e5e4e2] outline-none focus:border-[#d3bb73]/45" />
                      ) : (
                        <p className="mt-2 text-sm leading-relaxed text-[#e5e4e2]/75">{entry.description}</p>
                      )}
                      <p className="mt-2 text-[10px] text-[#e5e4e2]/35">Źródło: {entry.sources.join(' · ') || 'Ustalenie w ofercie'}</p>
                    </div>
                    {canEdit && <button type="button" onClick={() => removeRequirement(entry)} className="rounded-md p-1.5 text-red-300/60 hover:bg-red-500/10 hover:text-red-300" title={entry.origin === 'manual' ? 'Usuń' : 'Pomiń w PDF'}><Trash2 className="h-4 w-4" /></button>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
