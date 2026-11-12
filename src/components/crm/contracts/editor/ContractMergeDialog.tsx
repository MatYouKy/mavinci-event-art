'use client';

import { useEffect, useState } from 'react';
import { GitMerge, Loader2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { convertLegacyContractTemplate } from '@/lib/CRM/contracts/contractTemplateConverter';
import { isContractDocumentStylesTemplate } from '@/lib/CRM/contracts/contractDocumentStyles';
import { normalizeContractParagraphPlaceholders } from '@/lib/CRM/contracts/contractParagraphs';
import {
  describeContractCondition,
  negateContractCondition,
  type ContractOption,
} from '@/lib/CRM/contracts/contractConditions';
import {
  appendContractVariant,
  mergeContractTemplates,
  type ContractMergeStats,
} from '@/lib/CRM/contracts/contractTemplateMerge';
import { getContractDocumentCss } from '@/components/crm/events/calculations/helpers/getContractCssForPrint';

export interface ContractMergeDialogProps {
  templateId: string;
  /** Aktualna treść edytora (forma zapisu). */
  baseHtml: string;
  options: ContractOption[];
  fieldLabels: Record<string, string>;
  /** Otwiera okno warunku; zwraca wybrany warunek albo `null` (anulowano). */
  pickCondition: (initial: string | null) => Promise<{ condition: string; options: ContractOption[] } | null>;
  onMerge: (html: string, options: ContractOption[]) => void;
  onClose: () => void;
}

type TemplateRow = { id: string; name: string; is_active: boolean };

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * „Scal z innym szablonem”: treść wybranego szablonu (wariantu) trafia do bieżącego jako sekcje warunkowe.
 * Wspólne akapity zostają raz, różnice dostają warunek wariantu albo odwrotny. Nic nie jest zapisywane, dopóki
 * użytkownik nie zapisze szablonu — można cofnąć (⌘Z).
 */
export default function ContractMergeDialog({ templateId, baseHtml, options, fieldLabels, pickCondition, onMerge, onClose }: ContractMergeDialogProps) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [otherId, setOtherId] = useState('');
  const [condition, setCondition] = useState<string | null>(null);
  const [optionList, setOptionList] = useState<ContractOption[]>(options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ merged: string; appended: string; stats: ContractMergeStats; categories: string[] } | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('contract_templates').select('id, name, is_active').neq('id', templateId).order('name');
      setTemplates((data || []) as TemplateRow[]);
    })();
  }, [templateId]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const chooseCondition = async () => {
    const picked = await pickCondition(condition);
    if (!picked) return;
    setCondition(picked.condition);
    setOptionList(picked.options);
    setResult(null);
  };

  const compare = async () => {
    if (!otherId || !condition) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: loadError } = await supabase
        .from('contract_templates')
        .select('id, name, content_html, page_settings')
        .eq('id', otherId)
        .single();
      if (loadError) throw loadError;
      const flow = data?.page_settings?.flowContent || data?.content_html || '';
      // Wariant w starym formacie przechodzi tę samą konwersję co przy „Przekształć szablon”.
      const otherHtml = isContractDocumentStylesTemplate(data?.page_settings)
        ? flow
        : (await convertLegacyContractTemplate(flow, {
            selectedFont: data?.page_settings?.selectedFont,
            lineHeight: data?.page_settings?.lineHeight,
            baseCss: getContractDocumentCss(),
          })).html;
      const base = normalizeContractParagraphPlaceholders(baseHtml);
      const other = normalizeContractParagraphPlaceholders(otherHtml);
      const merged = mergeContractTemplates(base, other, condition);
      const { data: categoryRows } = await supabase.from('event_categories').select('name').eq('contract_template_id', otherId);
      setResult({
        merged: merged.html,
        appended: appendContractVariant(base, other, condition),
        stats: merged.stats,
        categories: (categoryRows || []).map((row: { name: string }) => row.name),
      });
    } catch (caught: any) {
      setError(caught?.message || 'Nie udało się wczytać szablonu');
    } finally {
      setBusy(false);
    }
  };

  const other = templates.find((item) => item.id === otherId);
  const label = condition ? describeContractCondition(condition, { options: optionList, fieldLabels }) : null;
  const baseLabel = condition ? describeContractCondition(negateContractCondition(condition), { options: optionList, fieldLabels }) : null;
  const recommendMerge = (result?.stats.similarity ?? 0) >= 0.3;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contract-merge-title"
        className="w-full max-w-xl rounded-xl border border-white/10 bg-[#1c1f33] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <h2 id="contract-merge-title" className="flex items-center gap-2 text-base font-medium text-[#e5e4e2]"><GitMerge className="h-4 w-4 text-[#d3bb73]" /> Scal z innym szablonem</h2>
            <p className="text-xs text-[#e5e4e2]/50">Różnice między szablonami staną się sekcjami warunkowymi. Zapisujesz dopiero po sprawdzeniu.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="rounded p-1 text-[#e5e4e2]/60 hover:bg-white/10 hover:text-[#e5e4e2]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-[#e5e4e2]/60">1. Szablon do scalenia (wariant)</span>
            <select
              value={otherId}
              onChange={(event) => { setOtherId(event.target.value); setResult(null); }}
              className="w-full rounded border border-white/15 bg-[#0f1119] px-2 py-1.5 text-[#e5e4e2]"
            >
              <option value="">— wybierz —</option>
              {templates.map((item) => <option key={item.id} value={item.id}>{item.name}{item.is_active ? '' : ' (nieaktywny)'}</option>)}
            </select>
          </label>

          <div>
            <span className="mb-1 block text-xs text-[#e5e4e2]/60">2. Kiedy obowiązuje treść wariantu?</span>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-lg border border-[#a083dc]/30 bg-[#a083dc]/10 px-3 py-2 text-[#cdb9f5]">{label || 'Nie wybrano warunku'}</div>
              <button type="button" onClick={() => void chooseCondition()} className="rounded-lg bg-white/10 px-3 py-2 text-[#e5e4e2] hover:bg-white/15">{condition ? 'Zmień' : 'Wybierz'}</button>
            </div>
            {baseLabel && <p className="mt-1 text-xs text-[#e5e4e2]/50">Treść tylko z bieżącego szablonu: {baseLabel}.</p>}
          </div>

          <button
            type="button"
            disabled={!otherId || !condition || busy}
            onClick={() => void compare()}
            className="flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-[#e5e4e2] hover:bg-white/15 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            3. Porównaj
          </button>
          {error && <p className="text-red-300">{error}</p>}

          {result && (
            <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div><div className="text-lg text-[#e5e4e2]">{result.stats.common}</div><div className="text-[11px] text-[#e5e4e2]/50">wspólne</div></div>
                <div><div className="text-lg text-[#e5e4e2]">{result.stats.onlyBase}</div><div className="text-[11px] text-[#e5e4e2]/50">tylko w tym</div></div>
                <div><div className="text-lg text-[#e5e4e2]">{result.stats.onlyOther}</div><div className="text-[11px] text-[#e5e4e2]/50">tylko w „{other?.name}”</div></div>
              </div>
              <p className="text-xs text-[#e5e4e2]/60">
                Podobieństwo: {percent(result.stats.similarity)}.{' '}
                {recommendMerge
                  ? 'Scalanie akapitów zostawi wspólną treść raz.'
                  : 'Szablony są bardzo różne — czytelniej dołączyć wariant jako jedną sekcję.'}
              </p>
              {result.categories.length > 0 && (
                <p className="text-xs text-amber-200/80">
                  Kategorie korzystające z „{other?.name}”: {result.categories.join(', ')}. Po zapisie ustaw w nich ten szablon.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/80 hover:bg-white/10">Anuluj</button>
          {result && (
            <>
              <button
                type="button"
                onClick={() => onMerge(result.appended, optionList)}
                className={`rounded-lg px-4 py-2 text-sm ${recommendMerge ? 'text-[#e5e4e2]/80 hover:bg-white/10' : 'bg-[#d3bb73] font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90'}`}
              >
                Dołącz jako całą sekcję
              </button>
              <button
                type="button"
                onClick={() => onMerge(result.merged, optionList)}
                className={`rounded-lg px-4 py-2 text-sm ${recommendMerge ? 'bg-[#d3bb73] font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90' : 'text-[#e5e4e2]/80 hover:bg-white/10'}`}
              >
                Scal akapity
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
