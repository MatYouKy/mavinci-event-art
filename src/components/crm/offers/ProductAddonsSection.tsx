"use client";

import { useEffect, useId, useRef, useState } from 'react';
import { Eye, Loader2, Pencil, Plus, Save, Trash2, X, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import ProductAddonsEditor from './ProductAddonsEditor';
import { addonLabels, addonQuantity, validateAddons, type ProductAddon } from '@/lib/CRM/Offers/offerAddons';

type Props = {
  value: ProductAddon[];
  canEdit: boolean;
  disabled?: boolean;
  saving: boolean;
  onSave: (value: ProductAddon[]) => Promise<void>;
  onEditingChange: (editing: boolean) => void;
};
const money = (value: number) => value.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
const amount = (value: number) => value.toLocaleString('pl-PL');
const rate = (addon: ProductAddon) => addon.price_on_request && addon.unit_price <= 0
  ? 'Wycena indywidualna' : `${money(addon.unit_price)} netto${addon.kind === 'optional' ? '' : ` / ${addon.unit}`}`;

export default function ProductAddonsSection({ value, canEdit, disabled, saving, onSave, onEditingChange }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const submitting = useRef(false);
  const [active, setActive] = useState<ProductAddon | null>(null);
  const [draft, setDraft] = useState<ProductAddon | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [orderError, setOrderError] = useState('');
  const [pendingOrder, setPendingOrder] = useState<ProductAddon[] | null>(null);
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
  const preview = (addon: ProductAddon, mode: 'preview' | 'edit' | 'delete' = 'preview') => {
    if (busy || submitting.current || (mode !== 'preview' && !canEdit)) return;
    setActive(structuredClone(addon));
    setDraft(mode === 'edit' ? structuredClone(addon) : null);
    setCreating(false); setDeleting(mode === 'delete'); setError('');
    onEditingChange(mode !== 'preview');
  };
  const add = () => {
    if (!canEdit || busy || value.length >= 40) return;
    const addon: ProductAddon = { id: crypto.randomUUID(), name: '', description: '', kind: 'quantity', unit: 'szt.', included_quantity: 0, quantity: 0, unit_price: 0, enabled: false };
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
      setError('Ten dodatek został zmieniony lub usunięty. Zamknij podgląd i otwórz go ponownie.'); return;
    }
    const normalized = draft ? { ...draft, name: draft.name.trim(), unit: draft.unit.trim(), description: draft.description.trim() } : null;
    const next = remove ? value.filter(addon => addon.id !== active.id)
      : creating ? [...value, normalized!] : value.map(addon => addon.id === active.id ? normalized! : addon);
    const validation = validateAddons(next);
    if (validation) { setError(validation); return; }
    submitting.current = true; setPending(true); setError('');
    try { await onSave(next); finish(); }
    catch (error) { setError(error instanceof Error ? error.message : 'Nie udało się zapisać dodatku. Spróbuj ponownie.'); }
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
      <h2 className="text-lg font-medium text-[#e5e4e2]">Dodatki i limity pakietu</h2>
      {canEdit && <button type="button" disabled={busy || value.length >= 40} onClick={add} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40"><Plus className="h-4 w-4" />Dodaj dodatek</button>}
    </div>
    {orderError && <p role="alert" className="mb-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{orderError}</p>}
    {!displayedAddons.length ? <p className="text-sm text-[#e5e4e2]/55">Brak dodatków i limitów.</p> :
      <DragDropContext onDragEnd={onDragEnd}><Droppable droppableId="product-addons">{provided => <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-2">
        {displayedAddons.map((addon, index) => <Draggable key={addon.id} draggableId={addon.id} index={index} isDragDisabled={!canEdit || busy || Boolean(active)}>{drag =>
          <article ref={drag.innerRef} {...drag.draggableProps} className="flex items-center gap-3 rounded-lg bg-black/15 px-3 py-2.5">
            {canEdit && <span {...drag.dragHandleProps} aria-label={`Przenieś dodatek: ${addon.name}`} className="shrink-0 text-[#e5e4e2]/35"><GripVertical className="h-4 w-4" /></span>}
            <span className="text-xs tabular-nums text-[#d3bb73]">{String(index + 1).padStart(2, '0')}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h3 className="min-w-0 break-words text-sm font-medium text-[#e5e4e2]">{addon.name}</h3>
              <span className="text-sm text-[#d3bb73]">{rate(addon)}</span>
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
          <h2 id={titleId} className="min-w-0 break-words text-lg font-medium">{creating ? 'Dodaj dodatek' : draft ? 'Edytuj dodatek' : active.name}</h2>
          <button type="button" disabled={busy} onClick={close} aria-label="Zamknij podgląd dodatku" className="shrink-0 rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 pb-5">
          {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
          {deleting ? <p className="text-sm text-[#e5e4e2]/75">Usunąć dodatek „{active.name}” z produktu? Istniejące oferty zachowają swoje ustawienia.</p>
            : draft ? <ProductAddonsEditor catalog hideHeading singleItem value={[draft]} onChange={items => { if (items[0]) setDraft(items[0]); }} disabled={!canEdit || busy} />
            : <>
              <p className="text-lg font-medium text-[#d3bb73]">{rate(active)}</p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <dt className="text-[#e5e4e2]/50">Sposób naliczania</dt><dd>{addonLabels[active.kind]}</dd>
                {active.kind === 'over_limit' && <><dt className="text-[#e5e4e2]/50">W cenie pakietu</dt><dd>{amount(active.included_quantity)} {active.unit}</dd></>}
                <dt className="text-[#e5e4e2]/50">Ustawienie domyślne</dt><dd>{active.kind === 'optional' ? active.enabled ? 'Wybrany' : 'Do wyboru w ofercie' : `${amount(active.quantity)} ${active.unit}`}</dd>
                <dt className="text-[#e5e4e2]/50">Domyślnie doliczane</dt><dd>{active.price_on_request && active.unit_price <= 0 && addonQuantity(active) > 0 ? 'Do indywidualnej wyceny' : `${money(Math.round(addonQuantity(active) * active.unit_price * 100) / 100)} netto / pakiet`}</dd>
                {active.price_on_request && <><dt className="text-[#e5e4e2]/50">Wycena indywidualna</dt><dd>Wymagana po wybraniu dodatku</dd></>}
              </dl>
              {active.description && <div><p className="mb-1 text-xs text-[#e5e4e2]/50">Zakres i warunki</p><p className="whitespace-pre-line text-sm leading-relaxed text-[#e5e4e2]/75">{active.description}</p></div>}
            </>}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 bg-[#1c1f33] px-5 py-4">
          {deleting ? <>
            <button type="button" disabled={busy} onClick={cancelEdit} className="rounded-lg bg-white/5 px-3 py-2 text-sm disabled:opacity-40">Anuluj</button>
            <button type="button" disabled={busy || !canEdit} onClick={() => void persist(true)} className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200 disabled:opacity-40">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Usuń dodatek</button>
          </> : draft ? <>
            <button type="button" disabled={busy} onClick={cancelEdit} className="rounded-lg bg-white/5 px-3 py-2 text-sm disabled:opacity-40">Anuluj</button>
            <button type="button" disabled={busy || !canEdit} onClick={() => void persist()} className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] disabled:opacity-40">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{pending ? 'Zapisywanie…' : 'Zapisz dodatek'}</button>
          </> : <>
            {canEdit && <button type="button" disabled={busy} onClick={() => { setDeleting(true); onEditingChange(true); }} className="mr-auto rounded-lg p-2 text-red-200/70 hover:bg-white/5 disabled:opacity-40" aria-label="Usuń dodatek"><Trash2 className="h-4 w-4" /></button>}
            <button type="button" disabled={busy} onClick={close} className="rounded-lg bg-white/5 px-3 py-2 text-sm disabled:opacity-40">Zamknij</button>
            {canEdit && <button type="button" disabled={busy} onClick={() => { setDraft(structuredClone(active)); setError(''); onEditingChange(true); }} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] disabled:opacity-40"><Pencil className="h-4 w-4" />Edytuj</button>}
          </>}
        </footer>
      </div>}
    </dialog>
  </section>;
}
