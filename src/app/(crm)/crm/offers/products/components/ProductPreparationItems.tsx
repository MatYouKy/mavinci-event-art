'use client';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import EventStepDialog from '@/components/crm/events/steps/EventStepDialog';
import { stepInputClass } from '@/components/crm/events/steps/stepUi';
import {
  EVENT_STEP_ANCHOR_LABELS,
  EVENT_STEP_KIND_LABELS,
  EVENT_STEP_ROLE_LABELS,
} from '@/lib/events/steps/eventSteps';

type PreparationKind = 'order' | 'stock_check' | 'venue_confirmation' | 'task';
type PreparationAnchor = 'event' | 'loading';
type PreparationRole = 'warehouse' | 'sales' | 'manager';

export type ProductPreparationItem = {
  id: string;
  product_id: string;
  kind: PreparationKind;
  title: string;
  details: string | null;
  lead_days: number;
  anchor: PreparationAnchor;
  owner_role: PreparationRole;
  supplier: string | null;
  quantity_per_unit: number | string | null;
  unit: string | null;
  blocks_ready: boolean;
  order_index: number;
  is_active: boolean;
};

type Draft = {
  id: string | null;
  kind: PreparationKind;
  title: string;
  details: string;
  leadDays: string;
  anchor: PreparationAnchor;
  ownerRole: PreparationRole;
  supplier: string;
  quantity: string;
  unit: string;
  blocksReady: boolean;
  isActive: boolean;
};

const KINDS: PreparationKind[] = ['order', 'stock_check', 'venue_confirmation', 'task'];
const ROLES: PreparationRole[] = ['warehouse', 'sales', 'manager'];
const ANCHORS: PreparationAnchor[] = ['event', 'loading'];
const COLUMNS =
  'id,product_id,kind,title,details,lead_days,anchor,owner_role,supplier,quantity_per_unit,unit,blocks_ready,order_index,is_active';
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205']);

const EMPTY_DRAFT: Draft = {
  id: null,
  kind: 'order',
  title: '',
  details: '',
  leadDays: '4',
  anchor: 'event',
  ownerRole: 'warehouse',
  supplier: '',
  quantity: '',
  unit: '',
  blocksReady: true,
  isActive: true,
};

const toDraft = (item: ProductPreparationItem): Draft => ({
  id: item.id,
  kind: item.kind,
  title: item.title,
  details: item.details ?? '',
  leadDays: String(item.lead_days ?? 0),
  anchor: item.anchor,
  ownerRole: item.owner_role,
  supplier: item.supplier ?? '',
  quantity: item.quantity_per_unit == null ? '' : String(item.quantity_per_unit).replace('.', ','),
  unit: item.unit ?? '',
  blocksReady: item.blocks_ready,
  isActive: item.is_active,
});

const parseQuantity = (value: string): number | null | 'invalid' => {
  const text = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number <= 0 || number >= 1e10) return 'invalid';
  return Math.round(number * 100) / 100;
};

const formatQuantity = (value: number | string | null, unit: string | null) => {
  if (value == null || value === '') return '';
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const text = number.toLocaleString('pl-PL', { maximumFractionDigits: 2 });
  return unit ? `${text} ${unit}` : text;
};

/** „Każde wydarzenie z tą usługą dostanie krok: … — 4 dni przed wydarzeniem, odpowiada magazyn.” */
export function preparationPreview(item: {
  title: string;
  leadDays: number | string;
  anchor: PreparationAnchor;
  ownerRole: PreparationRole;
}) {
  const title = item.title.trim() || '…';
  const days = String(item.leadDays).trim() === '' ? Number.NaN : Number(item.leadDays);
  const when = !Number.isInteger(days) || days < 0 || days > 90
    ? '…'
    : days === 0
      ? item.anchor === 'loading'
        ? 'w dniu załadunku'
        : 'w dniu wydarzenia'
      : `${days} ${days === 1 ? 'dzień' : 'dni'} ${EVENT_STEP_ANCHOR_LABELS[item.anchor]}`;
  const role = EVENT_STEP_ROLE_LABELS[item.ownerRole].toLocaleLowerCase('pl-PL');
  return `Każde wydarzenie z tą usługą dostanie krok: ${title} — ${when}, odpowiada ${role}.`;
}

/** Konfiguracja „Przygotowanie i zamówienia” usługi: z niej powstają kroki realizacji każdego wydarzenia z tą usługą. */
/** Komunikat po polsku zamiast surowego błędu bazy. */
function preparationErrorMessage(error: unknown, fallback: string): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === '42501') return 'Brak uprawnień do zmiany kroków przygotowania (administrator, oferty lub magazyn).';
  if (code === '23514' || code === '23502' || code === '22P02') return 'Sprawdź pola: nazwa 2–200 znaków, dni 0–90, ilość większa od zera.';
  if (code === 'PGRST205' || code === '42P01') return 'Funkcja nie jest jeszcze włączona w bazie (brak migracji kroków realizacji).';
  return fallback;
}

export default function ProductPreparationItems({ productId }: { productId: string }) {
  const id = useId();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [items, setItems] = useState<ProductPreparationItem[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, permission] = await Promise.all([
      supabase
        .from('offer_product_preparation_items')
        .select(COLUMNS)
        .eq('product_id', productId)
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: true }),
      supabase.rpc('can_manage_product_preparation'),
    ]);
    if (list.error) {
      if (MISSING_TABLE_CODES.has(list.error.code ?? '')) setUnavailable(true);
      else setLoadError('Nie udało się wczytać przygotowania i zamówień.');
    } else {
      setItems((list.data ?? []) as ProductPreparationItem[]);
      setLoadError('');
    }
    setCanManage(!permission.error && permission.data === true);
    setLoading(false);
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (unavailable) return null;

  const openNew = () => {
    setFormError('');
    setDraft({ ...EMPTY_DRAFT });
  };
  const openEdit = (item: ProductPreparationItem) => {
    setFormError('');
    setDraft(toDraft(item));
  };
  const closeForm = () => {
    if (saving) return;
    setDraft(null);
    setFormError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || saving || !canManage) return;
    const title = draft.title.trim();
    const leadDays = Number(draft.leadDays);
    const quantity = parseQuantity(draft.quantity);
    if (title.length < 2 || title.length > 200) return setFormError('Podaj nazwę kroku (2–200 znaków).');
    if (draft.leadDays.trim() === '' || !Number.isInteger(leadDays) || leadDays < 0 || leadDays > 90)
      return setFormError('Liczba dni wyprzedzenia musi być liczbą całkowitą od 0 do 90.');
    if (quantity === 'invalid') return setFormError('Ilość na sztukę usługi musi być liczbą większą od zera.');
    if (draft.supplier.trim().length > 300) return setFormError('Nazwa dostawcy może mieć najwyżej 300 znaków.');
    if (draft.unit.trim().length > 30) return setFormError('Jednostka może mieć najwyżej 30 znaków.');
    if (draft.details.length > 2000) return setFormError('Opis może mieć najwyżej 2000 znaków.');
    const row = {
      kind: draft.kind,
      title,
      details: draft.details.trim() || null,
      lead_days: leadDays,
      anchor: draft.anchor,
      owner_role: draft.ownerRole,
      supplier: draft.supplier.trim() || null,
      quantity_per_unit: quantity,
      unit: draft.unit.trim() || null,
      blocks_ready: draft.blocksReady,
      is_active: draft.isActive,
    };
    setSaving(true);
    setFormError('');
    try {
      const nextIndex = items.reduce((max, item) => Math.max(max, item.order_index ?? 0), -1) + 1;
      const { data: saved, error } = draft.id
        ? await supabase.from('offer_product_preparation_items').update(row).eq('id', draft.id).select('id')
        : await supabase
            .from('offer_product_preparation_items')
            .insert({ ...row, product_id: productId, order_index: nextIndex })
            .select('id');
      if (error) throw error;
      if (!saved?.length) throw { code: '42501' };
      showSnackbar(draft.id ? 'Zapisano krok przygotowania.' : 'Dodano krok przygotowania.', 'success');
      setDraft(null);
      await load();
    } catch (error) {
      setFormError(preparationErrorMessage(error, 'Nie udało się zapisać. Spróbuj ponownie.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (item: ProductPreparationItem) => {
    if (!canManage || busyId) return;
    setBusyId(item.id);
    try {
      const { data: saved, error } = await supabase
        .from('offer_product_preparation_items')
        .update({ is_active: !item.is_active })
        .eq('id', item.id)
        .select('id');
      if (error) throw error;
      if (!saved?.length) throw { code: '42501' };
      showSnackbar(
        item.is_active
          ? 'Krok wyłączony — nie pojawi się w wydarzeniach (otwarte kroki z tej usługi zostaną zarchiwizowane).'
          : 'Krok włączony — pojawi się w bieżących wydarzeniach z tą usługą.',
        'success',
      );
      await load();
    } catch (error) {
      showSnackbar(preparationErrorMessage(error, 'Nie udało się zmienić stanu kroku.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: ProductPreparationItem) => {
    if (!canManage || busyId) return;
    const confirmed = await showConfirm({
      title: 'Usuń krok przygotowania',
      message: `Usunąć „${item.title}”? Wydarzenia z tą usługą przestaną dostawać ten krok. Aby tylko wstrzymać krok, użyj „Wyłącz”.`,
      confirmText: 'Usuń',
      cancelText: 'Anuluj',
    });
    if (!confirmed) return;
    setBusyId(item.id);
    try {
      const { data: removed, error } = await supabase
        .from('offer_product_preparation_items')
        .delete()
        .eq('id', item.id)
        .select('id');
      if (error) throw error;
      if (!removed?.length) throw { code: '42501' };
      showSnackbar('Usunięto krok przygotowania.', 'success');
      await load();
    } catch (error) {
      showSnackbar(preparationErrorMessage(error, 'Nie udało się usunąć kroku.'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3" aria-busy={loading || saving || Boolean(busyId)}>
      <p className="text-sm text-[#e5e4e2]/60">
        Co trzeba zamówić, sprawdzić lub potwierdzić przed każdym wydarzeniem z tą usługą. Kroki pojawią się na wydarzeniu
        po akceptacji oferty, z terminem i osobą odpowiedzialną. Zmiany przeliczają kroki zaplanowanych wydarzeń automatycznie.
      </p>
      {!canManage && !loading && (
        <p className="rounded-lg bg-white/[0.04] px-3 py-2 text-xs text-[#e5e4e2]/55">
          Podgląd. Konfigurację zmienia administrator albo osoba z uprawnieniem do zarządzania ofertami lub magazynem.
        </p>
      )}
      {loading && <p className="text-sm text-[#e5e4e2]/55">Wczytywanie…</p>}
      {loadError && (
        <p role="alert" className="text-sm text-red-300">
          {loadError}{' '}
          <button type="button" onClick={() => void load()} className="underline">
            Spróbuj ponownie
          </button>
        </p>
      )}
      {!loading && !loadError && !items.length && (
        <p className="text-sm text-[#e5e4e2]/55">Brak kroków przygotowania dla tej usługi.</p>
      )}

      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map(item => {
            const quantity = formatQuantity(item.quantity_per_unit, item.unit);
            const busy = busyId === item.id;
            return (
              <li
                key={item.id}
                className={`rounded-lg px-3 py-3 ${item.is_active ? 'bg-black/15' : 'bg-white/[0.02] opacity-70'}`}
                aria-busy={busy}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-[#d3bb73]/10 px-2.5 py-0.5 text-[11px] text-[#d3bb73]">
                        {EVENT_STEP_KIND_LABELS[item.kind]}
                      </span>
                      {!item.is_active && (
                        <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-[#e5e4e2]/60">Wyłączony</span>
                      )}
                      {item.blocks_ready && (
                        <span className="text-xs text-[#e5e4e2]/45">wymagane przed gotowością magazynu</span>
                      )}
                    </div>
                    <h3 className="mt-1.5 break-words text-sm font-medium text-[#e5e4e2]">{item.title}</h3>
                    <p className="mt-1 text-xs text-[#e5e4e2]/60">
                      {preparationPreview({
                        title: item.title,
                        leadDays: item.lead_days,
                        anchor: item.anchor,
                        ownerRole: item.owner_role,
                      })}
                    </p>
                    {(item.supplier || quantity) && (
                      <p className="mt-1 text-xs text-[#e5e4e2]/55">
                        {[item.supplier && `Dostawca: ${item.supplier}`, quantity && `Ilość: ${quantity} na sztukę usługi`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    )}
                    {item.details && (
                      <p className="mt-1 whitespace-pre-wrap break-words text-xs text-[#e5e4e2]/50">{item.details}</p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex shrink-0 flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={busy || saving}
                        onClick={() => openEdit(item)}
                        aria-label={`Edytuj: ${item.title}`}
                        title="Edytuj"
                        className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#d3bb73] disabled:opacity-40"
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={busy || saving}
                        onClick={() => void toggleActive(item)}
                        aria-label={`${item.is_active ? 'Wyłącz' : 'Włącz'}: ${item.title}`}
                        title={item.is_active ? 'Wyłącz' : 'Włącz'}
                        className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-white/5 hover:text-[#d3bb73] disabled:opacity-40"
                      >
                        <Power className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        type="button"
                        disabled={busy || saving}
                        onClick={() => void remove(item)}
                        aria-label={`Usuń: ${item.title}`}
                        title="Usuń"
                        className="rounded-lg p-2 text-red-300/70 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <button
          type="button"
          onClick={openNew}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/20 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Dodaj krok przygotowania
        </button>
      )}

      <EventStepDialog
        open={Boolean(draft)}
        onClose={closeForm}
        busy={saving}
        title={draft?.id ? 'Edytuj krok przygotowania' : 'Dodaj krok przygotowania'}
        description="Krok powstanie na każdym wydarzeniu z tą usługą po akceptacji oferty."
        wide
      >
        {draft && (
          <form onSubmit={save} noValidate aria-busy={saving} className="space-y-4">
            <fieldset disabled={saving} className="space-y-4 disabled:opacity-70">
              <legend className="sr-only">Krok przygotowania</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-[#e5e4e2]/70">
                  Rodzaj
                  <select
                    value={draft.kind}
                    onChange={event => setDraft({ ...draft, kind: event.target.value as PreparationKind })}
                    className={stepInputClass}
                  >
                    {KINDS.map(kind => (
                      <option key={kind} value={kind} className="bg-[#1c1f33]">
                        {EVENT_STEP_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm text-[#e5e4e2]/70">
                  Kto odpowiada
                  <select
                    value={draft.ownerRole}
                    onChange={event => setDraft({ ...draft, ownerRole: event.target.value as PreparationRole })}
                    className={stepInputClass}
                  >
                    {ROLES.map(role => (
                      <option key={role} value={role} className="bg-[#1c1f33]">
                        {EVENT_STEP_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-sm text-[#e5e4e2]/70">
                Nazwa kroku <span className="text-[#d3bb73]">*</span>
                <input
                  data-autofocus
                  value={draft.title}
                  maxLength={200}
                  required
                  onChange={event => setDraft({ ...draft, title: event.target.value })}
                  placeholder="Np. Zamów suchy lód"
                  className={stepInputClass}
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm text-[#e5e4e2]/70">
                  Ile dni wcześniej
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={90}
                    step={1}
                    value={draft.leadDays}
                    onChange={event => setDraft({ ...draft, leadDays: event.target.value })}
                    placeholder="4"
                    className={stepInputClass}
                  />
                </label>
                <label className="block text-sm text-[#e5e4e2]/70">
                  Licząc od
                  <select
                    value={draft.anchor}
                    onChange={event => setDraft({ ...draft, anchor: event.target.value as PreparationAnchor })}
                    className={stepInputClass}
                  >
                    {ANCHORS.map(anchor => (
                      <option key={anchor} value={anchor} className="bg-[#1c1f33]">
                        {EVENT_STEP_ANCHOR_LABELS[anchor]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block text-sm text-[#e5e4e2]/70 sm:col-span-1">
                  Dostawca
                  <input
                    value={draft.supplier}
                    maxLength={300}
                    onChange={event => setDraft({ ...draft, supplier: event.target.value })}
                    placeholder="Np. Linde"
                    className={stepInputClass}
                  />
                </label>
                <label className="block text-sm text-[#e5e4e2]/70">
                  Ilość na sztukę usługi
                  <input
                    inputMode="decimal"
                    value={draft.quantity}
                    onChange={event => setDraft({ ...draft, quantity: event.target.value })}
                    placeholder="Np. 10"
                    className={stepInputClass}
                  />
                </label>
                <label className="block text-sm text-[#e5e4e2]/70">
                  Jednostka
                  <input
                    value={draft.unit}
                    maxLength={30}
                    onChange={event => setDraft({ ...draft, unit: event.target.value })}
                    placeholder="Np. kg"
                    className={stepInputClass}
                  />
                </label>
              </div>
              <p className="-mt-2 text-xs text-[#e5e4e2]/45">
                Ilość na wydarzeniu = ilość na sztukę × liczba sztuk usługi w zaakceptowanej ofercie.
              </p>
              <label className="block text-sm text-[#e5e4e2]/70">
                Opis / instrukcja (opcjonalnie)
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={draft.details}
                  onChange={event => setDraft({ ...draft, details: event.target.value })}
                  placeholder="Np. zamówienie telefonicznie, odbiór w magazynie dostawcy, termobox z magazynu"
                  className={stepInputClass}
                />
              </label>
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm text-[#e5e4e2]">
                  <input
                    type="checkbox"
                    checked={draft.blocksReady}
                    aria-describedby={`${id}-blocks`}
                    onChange={event => setDraft({ ...draft, blocksReady: event.target.checked })}
                    className="mt-0.5 accent-[#d3bb73]"
                  />
                  Wymagane przed gotowością magazynu
                </label>
                <p id={`${id}-blocks`} className="pl-6 text-xs text-[#e5e4e2]/45">
                  Magazyn nie oznaczy „Gotowe do wydania”, dopóki ten krok nie zostanie zamknięty.
                </p>
                {draft.id && (
                  <label className="flex items-start gap-2 text-sm text-[#e5e4e2]">
                    <input
                      type="checkbox"
                      checked={draft.isActive}
                      onChange={event => setDraft({ ...draft, isActive: event.target.checked })}
                      className="mt-0.5 accent-[#d3bb73]"
                    />
                    Aktywny — dodawaj ten krok do wydarzeń
                  </label>
                )}
              </div>
            </fieldset>

            <p className="rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#e5e4e2]/85" aria-live="polite">
              {preparationPreview({
                title: draft.title,
                leadDays: draft.leadDays,
                anchor: draft.anchor,
                ownerRole: draft.ownerRole,
              })}
            </p>

            {formError && (
              <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {formError}
              </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={closeForm}
                className="rounded-lg bg-white/5 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-white/10 disabled:opacity-50"
              >
                Anuluj
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#210811] hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {saving ? 'Zapisywanie…' : draft.id ? 'Zapisz' : 'Dodaj krok'}
              </button>
            </div>
          </form>
        )}
      </EventStepDialog>
    </div>
  );
}
