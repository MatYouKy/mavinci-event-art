'use client';

import { useMemo, useState } from 'react';
import {
  FilePlus2,
  Loader,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import type { ContractClauseCategory } from '@/lib/CRM/contracts/contractClauseContent';
import type { EventContractClauseItem } from '@/lib/CRM/contracts/eventContractClauseOverrides';
import type {
  ContractAuditBlock,
  ContractAuditResult,
} from '@/lib/CRM/contracts/contractAudit';
import ContractAuditReviewModal from './ContractAuditReviewModal';

const CATEGORIES: Array<{ value: ContractClauseCategory; label: string }> = [
  { value: 'conditions', label: 'Warunki realizacji' },
  { value: 'requirements', label: 'Wymagania podstawowe' },
  { value: 'obligations', label: 'Obowiązki Zamawiającego' },
  { value: 'risks', label: 'Ryzyka i odpowiedzialność' },
  { value: 'additional_requirements', label: 'Wymagania dodatkowe' },
  { value: 'general', label: 'Postanowienia dodatkowe' },
];

const stripHtml = (value: string) =>
  String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const plainTextToHtml = (value: string) =>
  value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');

const createCustomClauseId = () =>
  `event-custom:${typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

type ClauseAuditReviewState = {
  audit: ContractAuditResult;
  blocks: ContractAuditBlock[];
  blockToClauseId: Record<string, string>;
};

function ClauseContentEditor({
  item,
  onChange,
}: {
  item: EventContractClauseItem;
  onChange: (html: string) => void;
}) {
  return (
    <div
      contentEditable={item.enabled}
      suppressContentEditableWarning
      onBlur={(event) => onChange(event.currentTarget.innerHTML)}
      dangerouslySetInnerHTML={{ __html: item.html }}
      className={`mt-3 min-h-24 rounded-lg border px-3 py-2 text-sm leading-6 outline-none [&_li]:mb-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-6 ${
        item.enabled
          ? 'border-white/10 bg-[#0f1119] text-[#e5e4e2] focus:border-[#d3bb73]/60'
          : 'cursor-not-allowed border-white/5 bg-black/10 text-[#e5e4e2]/35'
      }`}
    />
  );
}

export default function EventContractClausesModal({
  eventId,
  items,
  isSaving,
  onClose,
  onSave,
}: {
  eventId: string;
  items: EventContractClauseItem[];
  isSaving: boolean;
  onClose: () => void;
  onSave: (items: EventContractClauseItem[]) => void | Promise<void>;
}) {
  const initialCategory = CATEGORIES.find(({ value }) =>
    items.some((item) => item.category === value),
  )?.value || 'obligations';
  const [draftItems, setDraftItems] = useState<EventContractClauseItem[]>(
    items.map((item) => ({ ...item })),
  );
  const [activeCategory, setActiveCategory] =
    useState<ContractClauseCategory>(initialCategory);
  const [search, setSearch] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState('Sugestia klienta');
  const [newContent, setNewContent] = useState('');
  const [isAuditingClauses, setIsAuditingClauses] = useState(false);
  const [clauseAuditReview, setClauseAuditReview] =
    useState<ClauseAuditReviewState | null>(null);
  const [clauseAuditMessage, setClauseAuditMessage] = useState('');
  const [clauseAuditError, setClauseAuditError] = useState('');
  const [aiFlaggedClauseIds, setAiFlaggedClauseIds] = useState<Set<string>>(
    () => new Set(),
  );

  const categoryCounts = useMemo(
    () => CATEGORIES.reduce<Record<string, { active: number; total: number }>>(
      (result, category) => {
        const categoryItems = draftItems.filter((item) => item.category === category.value);
        result[category.value] = {
          active: categoryItems.filter((item) => item.enabled).length,
          total: categoryItems.length,
        };
        return result;
      },
      {},
    ),
    [draftItems],
  );

  const visibleItems = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase('pl-PL');
    return draftItems.filter((item) => {
      if (item.category !== activeCategory) return false;
      if (!normalizedSearch) return true;
      return [item.title, item.productName, stripHtml(item.html)]
        .join(' ')
        .toLocaleLowerCase('pl-PL')
        .includes(normalizedSearch);
    });
  }, [activeCategory, draftItems, search]);

  const updateItem = (id: string, update: Partial<EventContractClauseItem>) => {
    setDraftItems((current) => current.map((item) =>
      item.id === id ? { ...item, ...update } : item,
    ));
    setAiFlaggedClauseIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  const handleAddClause = () => {
    const html = plainTextToHtml(newContent);
    if (!html) return;
    const title = newTitle.trim() || 'Sugestia klienta';
    const item: EventContractClauseItem = {
      id: createCustomClauseId(),
      category: activeCategory,
      topic: 'event_custom',
      title,
      productName: 'Ustalenie dla wydarzenia',
      html,
      preview: stripHtml(html).slice(0, 420),
      enabled: true,
      source: 'custom',
      baseHtml: html,
    };
    setDraftItems((current) => [...current, item]);
    setNewTitle('Sugestia klienta');
    setNewContent('');
    setShowAddForm(false);
  };

  const handleStartClauseAudit = async () => {
    const activeItems = draftItems.filter(
      (item) => item.enabled && stripHtml(item.html).length > 0,
    );
    if (activeItems.length < 2) {
      setClauseAuditError('Do porównania potrzebne są co najmniej dwie aktywne klauzule.');
      return;
    }

    const blockToClauseId: Record<string, string> = {};
    const blocks = activeItems.map<ContractAuditBlock>((item, index) => {
      const id = `contract-block-${index + 1}`;
      blockToClauseId[id] = item.id;
      const categoryLabel = CATEGORIES.find(
        (category) => category.value === item.category,
      )?.label || item.category;
      return {
        id,
        tag: 'li',
        text: stripHtml(item.html).slice(0, 2500),
        section: `${categoryLabel} · ${item.title} · źródło: ${item.productName}`.slice(0, 240),
        hasChildren: false,
        protected: false,
      };
    });

    try {
      setIsAuditingClauses(true);
      setClauseAuditError('');
      setClauseAuditMessage('');
      const { data, error } = await supabase.functions.invoke('audit-contract', {
        body: {
          eventId,
          mode: 'clauses',
          blocks: blocks.map(({ protected: _protected, ...block }) => block),
        },
      });
      if (error) {
        throw new Error((data as { error?: string } | null)?.error || error.message);
      }
      const audit = (data as { result?: ContractAuditResult } | null)?.result;
      if (!audit) throw new Error('Asystent nie zwrócił wyniku analizy klauzul.');

      const flaggedBlockIds = new Set([
        ...audit.duplicates.flatMap((duplicate) => [
          duplicate.keepBlockId,
          ...duplicate.removeBlockIds,
        ]),
        ...audit.issues.flatMap((issue) => issue.relatedBlockIds),
      ]);
      setAiFlaggedClauseIds(new Set(
        Array.from(flaggedBlockIds)
          .map((blockId) => blockToClauseId[blockId])
          .filter((clauseId): clauseId is string => Boolean(clauseId)),
      ));
      setClauseAuditReview({ audit, blocks, blockToClauseId });
    } catch (error) {
      console.error('Error auditing event contract clauses:', error);
      setClauseAuditError(
        error instanceof Error
          ? error.message
          : 'Nie udało się przeanalizować klauzul.',
      );
    } finally {
      setIsAuditingClauses(false);
    }
  };

  const handleApplyClauseAudit = (selections: Record<string, string>) => {
    if (!clauseAuditReview) return;
    const { audit, blockToClauseId } = clauseAuditReview;

    setDraftItems((current) => {
      let next = current.map((item) => ({ ...item }));
      const removeClause = (blockId: string) => {
        const clauseId = blockToClauseId[blockId];
        if (!clauseId) return;
        const clause = next.find((item) => item.id === clauseId);
        if (!clause) return;
        if (clause.source === 'custom') {
          next = next.filter((item) => item.id !== clauseId);
        } else {
          next = next.map((item) =>
            item.id === clauseId ? { ...item, enabled: false } : item,
          );
        }
      };
      const replaceClause = (blockId: string, replacementText: string) => {
        const clauseId = blockToClauseId[blockId];
        const html = plainTextToHtml(replacementText);
        if (!clauseId || !html) return;
        next = next.map((item) =>
          item.id === clauseId
            ? { ...item, html, preview: stripHtml(html).slice(0, 420) }
            : item,
        );
      };

      audit.duplicates.forEach((duplicate) => {
        duplicate.removeBlockIds
          .filter((blockId) => blockId !== duplicate.keepBlockId)
          .forEach(removeClause);
      });

      audit.issues.forEach((issue) => {
        const selectedOptionId = selections[issue.id];
        if (!selectedOptionId || selectedOptionId === '__keep_original__') return;
        const option = issue.options.find((candidate) => candidate.id === selectedOptionId);
        option?.operations.forEach((operation) => {
          if (operation.action === 'remove') removeClause(operation.blockId);
          else replaceClause(operation.blockId, operation.replacementText);
        });
      });

      return next;
    });

    setAiFlaggedClauseIds(new Set());
    setClauseAuditReview(null);
    setClauseAuditMessage(
      'Sugestie AI zostały zastosowane do listy. Sprawdź treść i zapisz klauzule umowy.',
    );
  };

  const activeCount = draftItems.filter((item) => item.enabled).length;
  const changedCount = draftItems.filter((item) =>
    item.source === 'custom' || !item.enabled || item.html.replace(/\s+/g, ' ').trim() !== item.baseHtml.replace(/\s+/g, ' ').trim(),
  ).length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm md:p-6">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#d3bb73]/25 bg-[#171928] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-7 md:py-5">
          <div>
            <h2 className="text-xl font-medium text-[#f2eee2]">Klauzule tej umowy</h2>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-[#e5e4e2]/55">
              Zmiany dotyczą wyłącznie tego wydarzenia. Nie zmienią klauzul zapisanych przy produktach ani w ofercie.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Zamknij"
            className="rounded-lg p-2 text-[#e5e4e2]/55 transition-colors hover:bg-white/5 hover:text-[#e5e4e2] disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-white/10 px-5 py-4 md:px-7">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {CATEGORIES.map((category) => {
              const counts = categoryCounts[category.value] || { active: 0, total: 0 };
              const selected = activeCategory === category.value;
              return (
                <button
                  key={category.value}
                  type="button"
                  onClick={() => {
                    setActiveCategory(category.value);
                    setShowAddForm(false);
                  }}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    selected
                      ? 'border-[#d3bb73]/60 bg-[#d3bb73]/15 text-[#f5df9a]'
                      : 'border-white/10 bg-white/[0.025] text-[#e5e4e2]/60 hover:border-white/20'
                  }`}
                >
                  <span className="block font-semibold">{category.label}</span>
                  <span className="mt-0.5 block text-[10px] opacity-70">
                    {counts.active} aktywnych{counts.total > counts.active ? ` · ${counts.total - counts.active} wyłączonych` : ''}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-md">
              <span className="sr-only">Szukaj klauzuli</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Szukaj po treści lub źródle"
                className="w-full rounded-lg border border-white/10 bg-[#0f1119] py-2.5 pl-10 pr-3 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/35 focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => void handleStartClauseAudit()}
                disabled={isAuditingClauses || isSaving}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2.5 text-sm font-semibold text-[#210811] transition-colors hover:bg-[#e0c981] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isAuditingClauses ? (
                  <Loader className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {isAuditingClauses ? 'Analizowanie…' : 'Asystent AI'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm((current) => !current)}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/35 px-3 py-2.5 text-sm font-medium text-[#e7cf86] transition-colors hover:bg-[#d3bb73]/10"
              >
                <Plus className="h-4 w-4" />
                Dodaj klauzulę w tej kategorii
              </button>
            </div>
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7">
          {clauseAuditError && (
            <div className="mb-4 rounded-lg border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-100">
              {clauseAuditError}
            </div>
          )}
          {clauseAuditMessage && (
            <div className="mb-4 rounded-lg border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
              {clauseAuditMessage}
            </div>
          )}
          {showAddForm && (
            <section className="mb-5 rounded-xl border border-[#d3bb73]/30 bg-[#d3bb73]/[0.06] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#e7cf86]">
                <FilePlus2 className="h-4 w-4" />
                Nowe ustalenie dla tego wydarzenia
              </div>
              <div className="mt-3 grid gap-3">
                <label>
                  <span className="mb-1 block text-xs text-[#e5e4e2]/55">Nazwa</span>
                  <input
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-xs text-[#e5e4e2]/55">Treść klauzuli</span>
                  <textarea
                    value={newContent}
                    onChange={(event) => setNewContent(event.target.value)}
                    rows={4}
                    placeholder="Wpisz ustalenie przekazane przez klienta…"
                    className="w-full resize-y rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2 text-sm leading-6 text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/50 focus:outline-none"
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowAddForm(false)}
                    className="rounded-lg border border-white/10 px-3 py-2 text-sm text-[#e5e4e2]/65 hover:bg-white/5"
                  >
                    Anuluj
                  </button>
                  <button
                    type="button"
                    onClick={handleAddClause}
                    disabled={!newContent.trim()}
                    className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-semibold text-[#210811] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Dodaj do umowy
                  </button>
                </div>
              </div>
            </section>
          )}

          <div className="space-y-3">
            {visibleItems.map((item) => {
              const isEdited = item.source === 'automatic' &&
                item.html.replace(/\s+/g, ' ').trim() !== item.baseHtml.replace(/\s+/g, ' ').trim();
              return (
                <article
                  key={item.id}
                  className={`rounded-xl border p-4 ${
                    item.enabled
                      ? 'border-white/10 bg-white/[0.025]'
                      : 'border-white/5 bg-black/10 opacity-75'
                  }`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-[#f2eee2]">{item.title}</h3>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          item.source === 'custom'
                            ? 'bg-blue-400/10 text-blue-200'
                            : 'bg-[#d3bb73]/10 text-[#d3bb73]'
                        }`}>
                          {item.source === 'custom' ? 'Dodana do wydarzenia' : 'Automatyczna'}
                        </span>
                        {isEdited && (
                          <span className="rounded bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                            Zmieniona
                          </span>
                        )}
                        {!item.enabled && (
                          <span className="rounded bg-red-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-200">
                            Wyłączona
                          </span>
                        )}
                        {aiFlaggedClauseIds.has(item.id) && (
                          <span className="inline-flex items-center gap-1 rounded bg-fuchsia-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-200">
                            <Sparkles className="h-3 w-3" />
                            AI: do sprawdzenia
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[#e5e4e2]/45">Źródło: {item.productName}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {isEdited && item.enabled && (
                        <button
                          type="button"
                          onClick={() => updateItem(item.id, { html: item.baseHtml })}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-[#e5e4e2]/65 hover:bg-white/5"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Przywróć oryginał
                        </button>
                      )}
                      {item.source === 'custom' ? (
                        <button
                          type="button"
                          onClick={() => setDraftItems((current) => current.filter((entry) => entry.id !== item.id))}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/20 px-2.5 py-1.5 text-xs text-red-200 hover:bg-red-400/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Usuń
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateItem(item.id, { enabled: !item.enabled })}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${
                            item.enabled
                              ? 'border-red-400/20 text-red-200 hover:bg-red-400/10'
                              : 'border-green-400/20 text-green-200 hover:bg-green-400/10'
                          }`}
                        >
                          {item.enabled ? <Trash2 className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          {item.enabled ? 'Wyłącz w tej umowie' : 'Przywróć'}
                        </button>
                      )}
                    </div>
                  </div>

                  <ClauseContentEditor
                    item={item}
                    onChange={(html) => updateItem(item.id, { html })}
                  />
                  {item.enabled && (
                    <p className="mt-2 text-[11px] text-[#e5e4e2]/35">
                      Kliknij w treść, aby ją zmienić. Numeracja zostanie nadana przez szablon umowy.
                    </p>
                  )}
                </article>
              );
            })}

            {visibleItems.length === 0 && (
              <div className="rounded-xl border border-dashed border-white/10 px-5 py-10 text-center text-sm text-[#e5e4e2]/45">
                {search ? 'Brak klauzul pasujących do wyszukiwania.' : 'W tej kategorii nie ma jeszcze klauzul. Możesz dodać własne ustalenie.'}
              </div>
            )}
          </div>
        </main>

        <footer className="flex flex-col gap-3 border-t border-white/10 bg-[#11131f] px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
          <p className="text-xs text-[#e5e4e2]/50">
            {activeCount} aktywnych klauzul · {changedCount} zmian dla tego wydarzenia
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-[#e5e4e2]/70 hover:bg-white/5 disabled:opacity-40"
            >
              Anuluj
            </button>
            <button
              type="button"
              onClick={() => void onSave(draftItems)}
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-semibold text-[#210811] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving && <Loader className="h-4 w-4 animate-spin" />}
              {isSaving ? 'Zapisywanie…' : 'Zapisz klauzule umowy'}
            </button>
          </div>
        </footer>
      </div>

      {clauseAuditReview && (
        <ContractAuditReviewModal
          audit={clauseAuditReview.audit}
          blocks={clauseAuditReview.blocks}
          isApplying={false}
          onClose={() => setClauseAuditReview(null)}
          onApply={handleApplyClauseAudit}
        />
      )}
    </div>
  );
}
