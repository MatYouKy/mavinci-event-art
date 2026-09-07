'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Save, CreditCard as Edit3, Plus, RotateCcw, Trash2 } from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  CONTRACT_CLAUSE_CATEGORY_LABELS,
  CONTRACT_CLAUSE_PRIMARY_CATEGORIES,
  getContractClauseTopicLabel,
  getContractClauseTopicOptions,
  normalizeContractClausePointListHtml,
  parseContractClauseEntries,
  type ContractClauseCategory,
  type ContractClauseEntry,
  type ContractClausePrimaryCategory,
} from '@/lib/CRM/contracts/contractClauseContent';

const ReactQuill = dynamic(() => import('react-quill'), { ssr: false });
import 'react-quill/dist/quill.snow.css';
const ReactQuillWithRef = ReactQuill as React.ComponentType<any>;

const CATEGORY_OPTIONS = CONTRACT_CLAUSE_PRIMARY_CATEGORIES.map((value) => ({
  value,
  label: CONTRACT_CLAUSE_CATEGORY_LABELS[value],
}));

interface Props {
  productId: string;
  productVariantId?: string | null;
  productVariantName?: string | null;
  isInherited?: boolean;
  initialClauses: string | null;
  initialCategory: ContractClauseCategory;
  canEdit: boolean;
  onSave: (entries: ContractClauseEntry[]) => Promise<void>;
  onResetInheritance?: () => Promise<void>;
}

const formats = ['header', 'bold', 'italic', 'underline', 'blockquote', 'list', 'bullet', 'indent', 'align'];
const placeholders = [
  ['{{event_name}}', 'Nazwa wydarzenia'],
  ['{{event_schedule_contract}}', 'Termin wydarzenia'],
  ['{{planned_technical_schedule}}', 'Montaż i demontaż'],
  ['{{location_full}}', 'Lokalizacja'],
  ['{{organization_name}}', 'Organizacja klienta'],
  ['{{primary_contact_full_name}}', 'Osoba kontaktowa'],
  ['{{budget_brutto}}', 'Wartość brutto'],
] as const;

const createId = () => typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `clause-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createEntry = (
  category: ContractClausePrimaryCategory = 'requirements',
): ContractClauseEntry => {
  const topic = getContractClauseTopicOptions(category)[0]?.value || 'technical';
  return { id: createId(), category, topic, title: getContractClauseTopicLabel(topic), content: '' };
};

const hasContent = (value: string) => {
  const content = String(value || '').trim();
  return Boolean(content && content !== '<p><br></p>');
};

export function ProductContractClauses({
  productVariantId,
  productVariantName,
  isInherited = false,
  initialClauses,
  initialCategory,
  canEdit,
  onSave,
  onResetInheritance,
}: Props) {
  const readInitialEntries = () => parseContractClauseEntries(initialClauses, initialCategory);
  const initialEntries = readInitialEntries();
  const [entries, setEntries] = useState<ContractClauseEntry[]>(initialEntries);
  const [selectedId, setSelectedId] = useState(initialEntries[0]?.id || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [cursorPosition, setCursorPosition] = useState<number | null>(null);
  const quillRef = useRef<any>(null);
  const activeEntry = entries.find((entry) => entry.id === selectedId) || null;
  const visibleEntries = useMemo(() => entries.filter((entry) => hasContent(entry.content)), [entries]);

  useEffect(() => {
    const next = readInitialEntries();
    setEntries(next);
    setSelectedId(next[0]?.id || '');
  }, [initialClauses, initialCategory]);

  useEffect(() => {
    if (!activeEntry && entries.length > 0) setSelectedId(entries[0].id);
  }, [activeEntry, entries]);

  const updateEntry = (id: string, patch: Partial<ContractClauseEntry>) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  };

  const addEntry = (category: ContractClausePrimaryCategory = 'requirements') => {
    const entry = createEntry(category);
    setEntries((current) => [...current, entry]);
    setSelectedId(entry.id);
    setIsEditing(true);
  };

  const removeEntry = (id: string) => {
    setEntries((current) => {
      const index = current.findIndex((entry) => entry.id === id);
      const next = current.filter((entry) => entry.id !== id);
      setSelectedId(next[Math.max(0, index - 1)]?.id || next[0]?.id || '');
      return next;
    });
  };

  const startEditing = () => entries.length > 0 ? setIsEditing(true) : addEntry();

  const handleCancel = () => {
    const next = readInitialEntries();
    setEntries(next);
    setSelectedId(next[0]?.id || '');
    setIsEditing(false);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const normalized = entries.flatMap((entry) => {
        const content = normalizeContractClausePointListHtml(entry.content);
        if (!hasContent(content)) return [];
        const topics = getContractClauseTopicOptions(entry.category);
        const topic = topics.some((definition) => definition.value === entry.topic)
          ? entry.topic
          : topics[0]?.value || 'technical';
        return [{ ...entry, topic, title: entry.title.trim() || getContractClauseTopicLabel(topic), content }];
      });
      await onSave(normalized);
      setEntries(normalized);
      setSelectedId(normalized[0]?.id || '');
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const insertText = (text: string) => {
    if (!activeEntry) return;
    const quill = quillRef.current?.getEditor?.();
    if (!quill) {
      updateEntry(activeEntry.id, { content: `${activeEntry.content}<strong>${text}</strong>` });
      return;
    }
    quill.focus();
    const selection = quill.getSelection();
    const position = selection?.index ?? cursorPosition ?? Math.max(0, quill.getLength() - 1);
    quill.insertText(position, text, { bold: true });
    quill.setSelection(position + text.length, 0);
  };

  const formatPoint = (level: 0 | 1 | 2) => {
    const quill = quillRef.current?.getEditor?.();
    if (!quill) return;
    quill.focus();
    const selection = quill.getSelection() || { index: cursorPosition ?? 0, length: 0 };
    quill.formatLine(selection.index, Math.max(1, selection.length), {
      list: 'ordered',
      indent: level === 0 ? false : level,
    }, 'user');
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[#d3bb73]/30 bg-[#351020] shadow-sm">
      <div className="border-b border-[#d3bb73]/25 bg-[#411326] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 p-2"><FileText className="h-5 w-5 text-[#d3bb73]" /></div>
            <div>
              <h3 className="text-lg font-semibold text-[#e5e4e2]">Klauzule produktu</h3>
              <p className="text-sm text-[#e5e4e2]/55">
                {productVariantName
                  ? `${productVariantName}: ${isInherited ? 'dziedziczy klauzule bazowe' : 'ma własne klauzule'}`
                  : 'Osobne wpisy z kategorią i typem wykrywanym w umowie'}
              </p>
            </div>
          </div>
          {canEdit && <div className="flex flex-wrap gap-2">
            {isEditing ? <>
              <button type="button" onClick={handleCancel} className="rounded-lg border border-[#d3bb73]/30 bg-[#210811] px-4 py-2 text-sm text-[#e5e4e2]">Anuluj</button>
              <button type="button" onClick={() => void handleSave()} disabled={isSaving} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811] disabled:opacity-50"><Save className="h-4 w-4" />{isSaving ? 'Zapisywanie…' : 'Zapisz'}</button>
            </> : <>
              {productVariantId && !isInherited && onResetInheritance && <button type="button" onClick={() => void onResetInheritance()} className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#210811] px-4 py-2 text-sm text-[#e5e4e2]"><RotateCcw className="h-4 w-4" />Dziedzicz bazowe</button>}
              <button type="button" onClick={startEditing} className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#210811] px-4 py-2 text-sm text-[#e5e4e2]"><Edit3 className="h-4 w-4" />Edytuj</button>
            </>}
          </div>}
        </div>
      </div>

      <div className="p-4 md:p-6">
        {!isEditing && visibleEntries.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-[#d3bb73]/30 bg-[#2c0b18] p-8 text-center">
            <FileText className="mx-auto h-12 w-12 text-[#d3bb73]/45" />
            <p className="mt-2 text-sm font-medium text-[#e5e4e2]">Brak klauzul produktu</p>
            <p className="mt-1 text-sm text-[#e5e4e2]/50">Dodaj osobno warunki, wymagania, obowiązki i ryzyka.</p>
            {canEdit && <button type="button" onClick={startEditing} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811]"><Plus className="h-4 w-4" />Dodaj klauzulę</button>}
          </div>
        ) : isEditing ? (
          <div className="grid gap-4 xl:grid-cols-[290px_minmax(0,1fr)]">
            <aside className="rounded-xl border border-[#d3bb73]/20 bg-[#210811] p-3">
              <div className="mb-3 flex items-center justify-between">
                <div><div className="text-sm font-semibold text-[#e5e4e2]">Wpisy</div><div className="text-[11px] text-[#e5e4e2]/40">Jedna klauzula = jeden typ</div></div>
                <button type="button" onClick={() => addEntry()} className="rounded-md border border-[#d3bb73]/30 p-2 text-[#d3bb73]"><Plus className="h-4 w-4" /></button>
              </div>
              <div className="max-h-[540px] space-y-2 overflow-y-auto">
                {entries.map((entry) => <button key={entry.id} type="button" onClick={() => setSelectedId(entry.id)} className={`w-full rounded-lg border p-3 text-left ${selectedId === entry.id ? 'border-[#d3bb73]/60 bg-[#d3bb73]/10' : 'border-white/10 bg-white/[0.025]'}`}>
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#d3bb73]">{CONTRACT_CLAUSE_CATEGORY_LABELS[entry.category]}</span>
                  <span className="mt-1 block text-sm text-[#e5e4e2]">{entry.title || getContractClauseTopicLabel(entry.topic)}</span>
                  <span className="mt-1 block text-[11px] text-[#e5e4e2]/40">{getContractClauseTopicLabel(entry.topic)}</span>
                </button>)}
                {entries.length === 0 && <button type="button" onClick={() => addEntry()} className="w-full rounded-lg border border-dashed border-white/10 p-5 text-xs text-[#d3bb73]">Dodaj pierwszą klauzulę</button>}
              </div>
            </aside>

            <div className="contract-clauses-editor min-w-0">
              {activeEntry ? <>
                <div className="mb-3 grid gap-3 rounded-xl border border-[#d3bb73]/20 bg-[#411326] p-4 md:grid-cols-2">
                  <label className="text-xs text-[#e5e4e2]/60">Sekcja
                    <select value={activeEntry.category} onChange={(event) => {
                      const category = event.target.value as ContractClausePrimaryCategory;
                      const topic = getContractClauseTopicOptions(category)[0]?.value || 'technical';
                      updateEntry(activeEntry.id, { category, topic, title: getContractClauseTopicLabel(topic) });
                    }} className="mt-1 w-full rounded-lg border border-[#d3bb73]/25 bg-[#210811] px-3 py-2 text-sm text-[#e5e4e2]">
                      {CATEGORY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-[#e5e4e2]/60">Typ kontrolowany w umowie
                    <select value={activeEntry.topic} onChange={(event) => {
                      const topic = event.target.value;
                      updateEntry(activeEntry.id, { topic, title: getContractClauseTopicLabel(topic) });
                    }} className="mt-1 w-full rounded-lg border border-[#d3bb73]/25 bg-[#210811] px-3 py-2 text-sm text-[#e5e4e2]">
                      {getContractClauseTopicOptions(activeEntry.category).map((topic) => <option key={topic.value} value={topic.value}>{topic.label}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-[#e5e4e2]/60 md:col-span-2">Nazwa robocza
                    <input value={activeEntry.title} onChange={(event) => updateEntry(activeEntry.id, { title: event.target.value })} className="mt-1 w-full rounded-lg border border-[#d3bb73]/25 bg-[#210811] px-3 py-2 text-sm text-[#e5e4e2]" />
                  </label>
                </div>

                <div className="mb-3 flex flex-wrap gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#411326] p-3">
                  <button type="button" onClick={() => insertText('§n')} className="rounded-md border border-[#d3bb73]/35 bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73]">§n</button>
                  <button type="button" onClick={() => formatPoint(0)} title="Punkt główny" className="rounded-md border border-[#d3bb73]/35 bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73]">1. punkt główny</button>
                  <button type="button" onClick={() => formatPoint(1)} title="Podpunkt pierwszego poziomu" className="rounded-md border border-[#d3bb73]/35 bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73]">1.1 podpunkt</button>
                  <button type="button" onClick={() => formatPoint(2)} title="Podpunkt drugiego poziomu" className="rounded-md border border-[#d3bb73]/35 bg-[#d3bb73]/10 px-3 py-1.5 text-xs text-[#d3bb73]">1.1.1 podpunkt</button>
                  <select value="" onChange={(event) => event.target.value && insertText(event.target.value)} className="rounded-md border border-[#d3bb73]/25 bg-[#210811] px-3 py-1.5 text-xs text-[#e5e4e2]"><option value="">Wstaw zmienną…</option>{placeholders.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                  <button type="button" onClick={() => removeEntry(activeEntry.id)} className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-400/20 px-3 py-1.5 text-xs text-red-200"><Trash2 className="h-3.5 w-3.5" />Usuń</button>
                </div>
                <style jsx global>{`
                  .contract-clauses-editor .ql-container { min-height: 300px; border-color: rgba(211,187,115,.45); border-radius: 0 0 8px 8px; background: #fffaf4; font-family: Georgia,serif; }
                  .contract-clauses-editor .ql-toolbar { border-color: rgba(211,187,115,.45); border-radius: 8px 8px 0 0; background: #411326; }
                  .contract-clauses-editor .ql-editor { min-height: 300px; color: #000; font-size: 12pt; line-height: 1.6; }
                  .contract-clauses-editor .ql-editor ol li.ql-indent-1::before { content: counter(list-0) '.' counter(list-1) ' '; }
                  .contract-clauses-editor .ql-editor ol li.ql-indent-2::before { content: counter(list-0) '.' counter(list-1) '.' counter(list-2) ' '; }
                  .contract-clauses-editor .ql-editor ol li.ql-indent-3::before { content: counter(list-0) '.' counter(list-1) '.' counter(list-2) '.' counter(list-3) ' '; }
                  .contract-clauses-editor .ql-toolbar .ql-stroke { stroke: #e5e4e2; }
                  .contract-clauses-editor .ql-toolbar .ql-fill { fill: #e5e4e2; }
                  .contract-clauses-editor .ql-toolbar .ql-picker { color: #e5e4e2; }
                `}</style>
                <ReactQuillWithRef key={activeEntry.id} ref={quillRef} theme="snow" value={activeEntry.content} onChange={(content: string) => updateEntry(activeEntry.id, { content })} onChangeSelection={(range: { index: number } | null) => range && setCursorPosition(range.index)} modules={{ toolbar: [[{ header: [1, 2, 3, false] }], ['bold', 'italic', 'underline'], ['blockquote'], [{ list: 'ordered' }, { list: 'bullet' }], [{ indent: '-1' }, { indent: '+1' }], [{ align: [] }], ['clean']] }} formats={formats} placeholder="Wpisz pojedynczą klauzulę tego typu…" />
                <p className="mt-3 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/10 px-3 py-2 text-xs leading-5 text-[#e5e4e2]/70">Tab tworzy kolejny poziom numeracji, np. 1.1, a Shift+Tab wraca poziom wyżej. Wspólne warunki techniczne, np. zasilanie 230 V, wpisuj w „Wymaganiach produktu” — generator scali je raz dla całej oferty i umowy. W klauzulach pozostawiaj ustalenia specyficzne dla tej usługi, jej obowiązki, ograniczenia i ryzyka.</p>
              </> : <button type="button" onClick={() => addEntry()} className="min-h-[300px] w-full rounded-xl border border-dashed border-[#d3bb73]/25 text-sm text-[#d3bb73]">Dodaj pierwszą klauzulę</button>}
            </div>
          </div>
        ) : (
          <div className="space-y-5 rounded-lg border border-[#d3bb73]/25 bg-white px-6 py-6 text-[#111827]">
            <style jsx global>{`
              .contract-clause-preview ol[data-clause-marker='outline-decimal'] {
                list-style-type: decimal;
              }
              .contract-clause-preview ol[data-clause-marker='outline-decimal'] ol[data-clause-marker='outline-decimal'] > li::marker {
                content: counters(list-item, '.') ' ';
              }
            `}</style>
            {CATEGORY_OPTIONS.map((category) => {
              const categoryEntries = visibleEntries.filter((entry) => entry.category === category.value);
              if (categoryEntries.length === 0) return null;
              return <section key={category.value}>
                <div className="mb-3 border-b border-[#d3bb73]/60 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[#6b213f]">{category.label}</div>
                <div className="space-y-4">{categoryEntries.map((entry) => <article key={entry.id}>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-[#6b213f]"><span>{entry.title || getContractClauseTopicLabel(entry.topic)}</span><span className="rounded bg-[#6b213f]/10 px-1.5 py-0.5 text-[9px] uppercase">{getContractClauseTopicLabel(entry.topic)}</span></div>
                  <div className="contract-clause-preview prose prose-sm max-w-none font-serif text-[12pt] leading-relaxed" dangerouslySetInnerHTML={{ __html: normalizeContractClausePointListHtml(entry.content) }} />
                </article>)}</div>
              </section>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
