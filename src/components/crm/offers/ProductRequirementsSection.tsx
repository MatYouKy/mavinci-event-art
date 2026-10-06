"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { Eye, Loader2, Pencil, Plus, Save, Trash2, X, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { getOfferRequirementLabel } from '@/lib/CRM/Offers/offerRequirements';

export type OfferAdditionalRequirement = {
  id: string;
  category:
    | 'people'
    | 'resources'
    | 'place'
    | 'time'
    | 'power'
    | 'internet'
    | 'access'
    | 'setup'
    | 'surface'
    | 'venue_approval'
    | 'coordination'
    | 'schedule'
    | 'safety'
    | 'technical'
    | 'accommodation'
    | 'backstage'
    | 'hospitality'
    | 'logistics'
    | 'other';
  title: string;
  description: string;
};

const PRODUCT_REQUIREMENT_CATEGORIES: Array<{
  value: OfferAdditionalRequirement['category'];
  label: string;
}> = [
  { value: 'people', label: 'Ludzie i obsada' },
  { value: 'resources', label: 'Sprzęt i zasoby' },
  { value: 'place', label: 'Miejsce realizacji' },
  { value: 'time', label: 'Czas i harmonogram' },
  { value: 'power', label: 'Zasilanie' },
  { value: 'internet', label: 'Łącze internetowe' },
  { value: 'access', label: 'Dostęp i rozładunek' },
  { value: 'setup', label: 'Montaż i próba' },
  { value: 'surface', label: 'Miejsce realizacji' },
  { value: 'venue_approval', label: 'Zgoda obiektu' },
  { value: 'coordination', label: 'Koordynacja z obiektem' },
  { value: 'schedule', label: 'Harmonogram i materiały' },
  { value: 'safety', label: 'Bezpieczeństwo' },
  { value: 'technical', label: 'Inny warunek techniczny' },
  { value: 'accommodation', label: 'Zakwaterowanie' },
  { value: 'backstage', label: 'Zaplecze / garderoba' },
  { value: 'hospitality', label: 'Gościnność / catering' },
  { value: 'logistics', label: 'Logistyka' },
  { value: 'other', label: 'Inne' },
];




type Props = {
  value: OfferAdditionalRequirement[];
  canEdit: boolean;
  disabled?: boolean;
  saving: boolean;
  onSave: (value: OfferAdditionalRequirement[]) => Promise<void>;
  onEditingChange: (editing: boolean) => void;
};
const requirementLabel = (item: OfferAdditionalRequirement) => PRODUCT_REQUIREMENT_CATEGORIES.find(category => category.value === item.category)?.label || getOfferRequirementLabel(item.category);
const validateRequirements = (items: OfferAdditionalRequirement[]) => {
  if (items.some(item => !item.title.trim() && !item.description.trim())) return 'Podaj nazwę i warunki realizacji wymagania.';
  if (items.some(item => !PRODUCT_REQUIREMENT_CATEGORIES.some(category => category.value === item.category))) return 'Wybierz kategorię wymagania.';
  return null;
};

export default function ProductRequirementsSection({ value, canEdit, disabled, saving, onSave, onEditingChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const submitting = useRef(false);
  const [active, setActive] = useState<OfferAdditionalRequirement | null>(null);
  const [draft, setDraft] = useState<OfferAdditionalRequirement | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [orderError, setOrderError] = useState('');
  const [pendingOrder, setPendingOrder] = useState<OfferAdditionalRequirement[] | null>(null);
  const displayedAddons = pendingOrder ?? value;
  const busy = Boolean(disabled || saving || pending);

  useEffect(() => {
    if (!active) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [active?.id]);

  const finish = () => {
    setActive(null); setDraft(null); setCreating(false); setDeleting(false); setError('');
    onEditingChange(false);
  };
  const close = () => { if (!submitting.current && !busy) finish(); };
  const preview = (addon: OfferAdditionalRequirement, mode: 'preview' | 'edit' | 'delete' = 'preview') => {
    if (busy || submitting.current || (mode !== 'preview' && !canEdit)) return;
    setActive(structuredClone(addon));
    setDraft(mode === 'edit' ? structuredClone(addon) : null);
    setCreating(false); setDeleting(mode === 'delete'); setError('');
    onEditingChange(mode !== 'preview');
  };
  const add = () => {
    if (!canEdit || busy) return;
    const addon: OfferAdditionalRequirement = { id: crypto.randomUUID(), category: 'other', title: '', description: '' };
    setActive(addon); setDraft(addon); setCreating(true); setDeleting(false); setError(''); onEditingChange(true);
  };
  const cancelEdit = () => {
    if (busy || submitting.current) return;
    if (creating) { finish(); return; }
    setDraft(null); setDeleting(false); setError(''); onEditingChange(false);
  };
  const persist = async (remove = false) => {
    if (!active || !canEdit || busy || submitting.current || (!remove && !draft)) return;
    if (!creating && !value.some(addon => addon.id === active.id)) {
      setError('To wymaganie zostało zmienione lub usunięte. Zamknij podgląd i otwórz go ponownie.'); return;
    }
    if (draft && !remove && (!draft.title.trim() || !draft.description.trim())) { setError('Podaj nazwę i warunki realizacji wymagania.'); return; }
    const normalized = draft ? { ...draft, title: draft.title.trim(), description: draft.description.trim() } : null;
    const next = remove ? value.filter(addon => addon.id !== active.id)
      : creating ? [...value, normalized!] : value.map(addon => addon.id === active.id ? normalized! : addon);
    const validation = validateRequirements(next);
    if (validation) { setError(validation); return; }
    submitting.current = true; setPending(true); setError('');
    try { await onSave(next); finish(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać wymagania. Spróbuj ponownie.'); }
    finally { submitting.current = false; setPending(false); }
  };

  const moveAddon = async (from: number, to: number) => {
    if (!canEdit || busy || submitting.current || active || from === to || from < 0 || to < 0 || from >= value.length || to >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    submitting.current = true; setPending(true); setPendingOrder(next); setOrderError(''); onEditingChange(true);
    try { await onSave(next); }
    catch (error) { setOrderError(error instanceof Error ? error.message : 'Nie udało się zapisać kolejności. Przywrócono poprzedni układ.'); }
    finally { setPendingOrder(null); submitting.current = false; setPending(false); onEditingChange(false); }
  };
  const onDragEnd = ({ source, destination }: DropResult) => {
    if (destination) void moveAddon(source.index, destination.index);
  };

  return <section aria-busy={saving || pending} className="rounded-xl bg-[#d3bb73]/5 p-5 sm:p-6">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-medium text-[#e5e4e2]">Wymagania produktu</h2>
      {canEdit && <button type="button" disabled={busy} onClick={add} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40"><Plus className="h-4 w-4" />Dodaj wymaganie</button>}
    </div>
    {orderError && <p role="alert" className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{orderError}</p>}
    {!displayedAddons.length ? <p className="text-sm text-[#e5e4e2]/55">Brak wymagań produktu.</p> :
      <DragDropContext onDragEnd={onDragEnd}><Droppable droppableId="product-requirements">{provided => <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
        {displayedAddons.map((addon, index) => <Draggable key={addon.id} draggableId={addon.id} index={index} isDragDisabled={!canEdit || busy || Boolean(active)}>{drag =>
          <article ref={drag.innerRef} {...drag.draggableProps} className="flex items-center gap-3 rounded-lg bg-black/15 px-3 py-2.5">
            {canEdit && <span {...drag.dragHandleProps} aria-label={`Przenieś wymaganie: ${addon.title}`} className="shrink-0 text-[#e5e4e2]/35"><GripVertical className="h-4 w-4" /></span>}
            <span className="text-xs tabular-nums text-[#d3bb73]">{String(index + 1).padStart(2, '0')}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h3 className="min-w-0 break-words text-sm font-medium text-[#e5e4e2]">{addon.title}</h3>
              <span className="text-sm text-[#d3bb73]">{requirementLabel(addon)}</span>
            </div>
            <ResponsiveActionBar alwaysDropdown compact actions={[
              { label: 'Podgląd', icon: <Eye className="h-4 w-4" />, onClick: () => preview(addon), disabled: busy },
              { label: 'Edytuj', icon: <Pencil className="h-4 w-4" />, onClick: () => preview(addon, 'edit'), show: canEdit, disabled: busy },
              { label: 'Przenieś wyżej', icon: <ArrowUp className="h-4 w-4" />, onClick: () => void moveAddon(index, index - 1), show: canEdit, disabled: busy || index === 0 },
              { label: 'Przenieś niżej', icon: <ArrowDown className="h-4 w-4" />, onClick: () => void moveAddon(index, index + 1), show: canEdit, disabled: busy || index === displayedAddons.length - 1 },
              { label: 'Usuń', icon: <Trash2 className="h-4 w-4" />, onClick: () => preview(addon, 'delete'), variant: 'danger', show: canEdit, disabled: busy },
            ]} />
          </article>
        }</Draggable>)}
        {provided.placeholder}
      </div>}</Droppable></DragDropContext>}
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-hidden rounded-2xl bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65">
      {active && <div className="flex max-h-[85dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-3 bg-[#1c1f33] px-5 py-4">
          <h2 id={titleId} className="min-w-0 break-words text-lg font-medium">{creating ? 'Dodaj wymaganie' : draft ? 'Edytuj wymaganie' : active.title}</h2>
          <button type="button" disabled={busy} onClick={close} aria-label="Zamknij podgląd wymagania" className="shrink-0 rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5">
          {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          {deleting ? <p className="text-sm text-[#e5e4e2]/75">Usunąć wymaganie „{active.title}” z produktu? Wymaganie przestanie być pobierane z tego produktu do nowych PDF-ów.</p>
            : draft ? <fieldset disabled={!canEdit || busy} className="space-y-4 disabled:opacity-60">
              <legend className="sr-only">Edytuj wymaganie</legend>
              <label className="block text-xs text-[#e5e4e2]/70">Kategoria
                <select value={draft.category} onChange={event => {
                  const category = event.target.value as OfferAdditionalRequirement['category'];
                  setDraft({ ...draft, category, title: !draft.title || draft.title === getOfferRequirementLabel(draft.category) ? getOfferRequirementLabel(category) : draft.title });
                }} className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm">
                  {PRODUCT_REQUIREMENT_CATEGORIES.map(category => <option key={category.value} value={category.value} className="bg-[#1c1f33]">{category.label}</option>)}
                </select>
              </label>
              <label className="block text-xs text-[#e5e4e2]/70">Nazwa wymagania<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="Np. Pokój dwuosobowy" className="mt-1 w-full rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm" /></label>
              <label className="block text-xs text-[#e5e4e2]/70">Warunki realizacji<textarea rows={5} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} placeholder="Dla kogo, kiedy i na jakich warunkach należy zapewnić ten element?" className="mt-1 w-full resize-y rounded-lg border border-white/10 bg-black/15 px-3 py-2 text-sm" /></label>
            </fieldset> : <>
              <p className="text-sm text-[#d3bb73]">{requirementLabel(active)}</p>
              <div><p className="mb-1 text-xs text-[#e5e4e2]/50">Warunki realizacji</p><p className="whitespace-pre-line text-sm leading-relaxed text-[#e5e4e2]/75">{active.description || 'Brak opisu warunków.'}</p></div>
            </>}

        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 bg-[#1c1f33] px-5 py-4">
          {deleting ? <>
            <button type="button" disabled={busy} onClick={cancelEdit} className="rounded-lg bg-white/5 px-3 py-2 text-sm disabled:opacity-40">Anuluj</button>
            <button type="button" disabled={busy || !canEdit} onClick={() => void persist(true)} className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 disabled:opacity-40">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Usuń wymaganie</button>
          </> : draft ? <>
            <button type="button" disabled={busy} onClick={cancelEdit} className="rounded-lg bg-white/5 px-3 py-2 text-sm disabled:opacity-40">Anuluj</button>
            <button type="button" disabled={busy || !canEdit} onClick={() => void persist()} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{pending ? 'Zapisywanie…' : 'Zapisz wymaganie'}</button>
          </> : <>
            {canEdit && <button type="button" disabled={busy} onClick={() => { setDeleting(true); onEditingChange(true); }} className="mr-auto rounded-lg p-2 text-red-200/70 hover:bg-white/5 disabled:opacity-40" aria-label="Usuń wymaganie"><Trash2 className="h-4 w-4" /></button>}
            <button type="button" disabled={busy} onClick={close} className="rounded-lg bg-white/5 px-3 py-2 text-sm disabled:opacity-40">Zamknij</button>
            {canEdit && <button type="button" disabled={busy} onClick={() => { setDraft(structuredClone(active)); setError(''); onEditingChange(true); }} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40"><Pencil className="h-4 w-4" />Edytuj</button>}
          </>}
        </footer>
      </div>}
    </dialog>
  </section>;
}
