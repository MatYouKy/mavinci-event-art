'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Archive, ArrowUpRight, CheckCircle2, Copy, Loader2, Percent, Plus, RotateCcw, Save, Search, Tags, Trash2, Wand2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { priceListSeason, priceListStatusLabels, type PriceListStatus } from '@/lib/CRM/Offers/seasonPrices';
import {
  loadPriceListAttention,
  PRICE_LIST_ATTENTION_HINT,
  priceListAttentionGapText,
  priceListAttentionOfferText,
  priceListAttentionOfferTitle,
  type PriceListAttention,
} from '@/lib/CRM/Offers/priceListAttention';
import {
  PRICE_ROUNDING_STEPS,
  parsePriceInput,
  PRICE_LIST_PRODUCT_SELECT,
  PRICE_LIST_PRODUCT_SELECT_LEGACY,
  priceListRows,
  priceWithPercent,
  type PriceListCatalogProduct,
  type PriceListEntryRow,
} from '@/lib/CRM/Offers/priceListRows';

/*
 * Oferty → Cenniki: cenniki sezonowe marek (migracja `20261129100000_season_price_lists.sql`). Lista cenników według marek,
 * edytor cen produktów i wariantów (cena katalogowa obok ceny w cenniku), nowy cennik (z cenami z katalogu), kopia na kolejny
 * sezon z podwyżką, zmiana wszystkich cen o %, aktywacja i archiwum. Cennik aktywny podpowiada ceny ofert eventów marki
 * z datą w sezonie; oferty pamiętają swój cennik (gwarancja ceny), więc zmiany cennika nie ruszają wysłanych ofert.
 * Zarządzanie — admin albo `offers_manage` (jak RLS); pozostali widzą ceny bez edycji. „Do sprawdzenia” (`priceListAttention.ts`):
 * oferty w toku z cennikiem innym niż sezon terminu, szkice bez cennika i lata z eventami marki bez aktywnego cennika.
 */

type Company = { id: string; name: string };
type Category = { id: string; name: string };
type PriceList = {
  id: string;
  my_company_id: string;
  name: string;
  season_from: string;
  season_to: string;
  status: PriceListStatus;
  notes: string;
  updated_at: string;
};

const inputClass = 'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/40 disabled:opacity-50';
const buttonClass = 'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40';
const money = (value: number) => Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nextYear = new Date().getFullYear() + 1;
const statusTone: Record<PriceListStatus, string> = {
  draft: 'bg-white/5 text-white/60',
  active: 'bg-emerald-400/15 text-emerald-200',
  archived: 'bg-white/5 text-white/40',
};
const dbMessage = (error: unknown, fallback: string) => {
  const raw = error as { message?: string; code?: string } | null;
  if (raw?.code === '23503') return 'Cennik jest użyty w ofertach — zarchiwizuj go zamiast usuwać.';
  if (raw?.code === '23505') return 'Ta pozycja jest już w cenniku.';
  return raw?.message || fallback;
};

export default function PriceListsManager() {
  const searchParams = useSearchParams();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canManageModule } = useCurrentEmployee();
  const canManage = canManageModule('offers');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [lists, setLists] = useState<PriceList[]>([]);
  const [entryCounts, setEntryCounts] = useState<Record<string, number>>({});
  const [offerCounts, setOfferCounts] = useState<Record<string, number>>({});
  const [attention, setAttention] = useState<PriceListAttention | null>(null);
  const [products, setProducts] = useState<PriceListCatalogProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('list'));
  const [entries, setEntries] = useState<PriceListEntryRow[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<{ name: string; season_from: string; season_to: string; notes: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [onlyInList, setOnlyInList] = useState(false);
  const [dialog, setDialog] = useState<null | 'create' | 'duplicate' | 'fill' | 'percent'>(null);

  const selected = lists.find((list) => list.id === selectedId) || null;
  const categoryNames = useMemo(() => Object.fromEntries(categories.map((row) => [row.id, row.name])), [categories]);
  const companyName = useCallback((id: string) => companies.find((company) => company.id === id)?.name || 'Marka', [companies]);

  const loadLists = useCallback(async () => {
    // Liczba cen i ofert (widocznych dla pracownika) przy każdym cenniku — liczone w bazie; „Do sprawdzenia” odświeżane razem z listą
    // (nowy, skopiowany albo aktywowany cennik zmienia sezony ofert). Przed migracją `price_list_attention` — bez tej sekcji.
    const [{ data, error }, nextAttention] = await Promise.all([
      supabase.from('price_lists')
        .select('id, my_company_id, name, season_from, season_to, status, notes, updated_at, entries:price_list_entries(count), offers(count)')
        .order('season_from', { ascending: false }),
      loadPriceListAttention(supabase),
    ]);
    if (error) throw error;
    setAttention(nextAttention);
    type Counted = PriceList & { entries?: { count: number }[] | null; offers?: { count: number }[] | null };
    const rows = (data || []) as unknown as Counted[];
    setLists(rows.map((row) => ({
      id: row.id, my_company_id: row.my_company_id, name: row.name, season_from: row.season_from, season_to: row.season_to,
      status: row.status, notes: row.notes || '', updated_at: row.updated_at,
    })));
    setEntryCounts(Object.fromEntries(rows.map((row) => [row.id, Number(row.entries?.[0]?.count) || 0])));
    setOfferCounts(Object.fromEntries(rows.map((row) => [row.id, Number(row.offers?.[0]?.count) || 0])));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [companyResult, categoryResult, firstProducts] = await Promise.all([
        supabase.from('my_companies').select('id, name').eq('is_active', true).order('name'),
        supabase.from('event_categories').select('id, name').order('name'),
        supabase.from('offer_products').select(PRICE_LIST_PRODUCT_SELECT).order('name'),
      ]);
      // Bez migracji kategorii dodatkowych (kolumny jeszcze nie ma) — produkty bez nich.
      const productResult = firstProducts.error?.code === '42703'
        ? await supabase.from('offer_products').select(PRICE_LIST_PRODUCT_SELECT_LEGACY).order('name')
        : firstProducts;
      if (companyResult.error || productResult.error) throw companyResult.error || productResult.error;
      setCompanies((companyResult.data || []) as Company[]);
      setCategories((categoryResult.data || []) as Category[]);
      setProducts((productResult.data || []) as PriceListCatalogProduct[]);
      await loadLists();
    } catch (error) {
      // Bez migracji cenników tabeli nie ma — informacja zamiast pustej strony.
      setLoadError(dbMessage(error, 'Nie udało się wczytać cenników.'));
    } finally {
      setLoading(false);
    }
  }, [loadLists]);

  const loadEntries = useCallback(async (id: string) => {
    setEntriesLoading(true);
    const { data, error } = await supabase.from('price_list_entries').select('id, product_id, product_variant_id, price_net').eq('price_list_id', id);
    setEntriesLoading(false);
    if (error) { showSnackbar(dbMessage(error, 'Nie udało się wczytać cen cennika.'), 'error'); return; }
    setEntries(((data || []) as PriceListEntryRow[]).map((row) => ({ ...row, price_net: Number(row.price_net) })));
  }, [showSnackbar]);

  useEffect(() => { void loadAll(); }, [loadAll]);
  useEffect(() => {
    if (!selectedId && lists.length) setSelectedId((lists.find((list) => list.status === 'active') || lists[0]).id);
  }, [lists, selectedId]);
  useEffect(() => {
    setEdits({});
    if (selectedId) void loadEntries(selectedId); else setEntries([]);
  }, [selectedId, loadEntries]);
  useEffect(() => {
    setSettings(selected ? { name: selected.name, season_from: selected.season_from, season_to: selected.season_to, notes: selected.notes || '' } : null);
  }, [selected]);

  const rows = useMemo(() => priceListRows(products, entries, categoryNames), [products, entries, categoryNames]);
  const visibleRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('pl');
    return rows.filter((row) => (category === 'all' || row.categoryIds.includes(category))
      && (!onlyInList || row.entryId || edits[row.key])
      && (!query || `${row.productName} ${row.label}`.toLocaleLowerCase('pl').includes(query)));
  }, [rows, search, category, onlyInList, edits]);

  const pending = useMemo(() => {
    const changes: { row: (typeof rows)[number]; price: number | null }[] = [];
    const invalid: string[] = [];
    for (const row of rows) {
      if (!(row.key in edits)) continue;
      const parsed = parsePriceInput(edits[row.key]);
      if (parsed === undefined) { invalid.push(`${row.productName} — ${row.label}`); continue; }
      if (parsed === row.price) continue;
      changes.push({ row, price: parsed });
    }
    return { changes, invalid };
  }, [rows, edits]);

  const reloadSelected = async () => {
    await loadLists();
    if (selectedId) await loadEntries(selectedId);
    setEdits({});
  };

  const run = async (label: string, action: () => Promise<string | void>) => {
    if (busy) return;
    setBusy(true);
    try {
      const message = await action();
      if (message) showSnackbar(message, 'success');
    } catch (error) {
      showSnackbar(dbMessage(error, `${label}: nie udało się zapisać.`), 'error');
    } finally {
      setBusy(false);
    }
  };

  const savePrices = () => run('Ceny', async () => {
    if (!selected) return;
    if (pending.invalid.length) throw new Error(`Popraw ceny: ${pending.invalid.slice(0, 3).join(', ')}${pending.invalid.length > 3 ? '…' : ''}`);
    const inserts = pending.changes.filter((change) => !change.row.entryId && change.price !== null).map((change) => ({
      price_list_id: selected.id, product_id: change.row.productId, product_variant_id: change.row.variantId, price_net: change.price,
    }));
    const updates = pending.changes.filter((change) => change.row.entryId && change.price !== null).map((change) => ({
      id: change.row.entryId as string, price_list_id: selected.id, product_id: change.row.productId,
      product_variant_id: change.row.variantId, price_net: change.price,
    }));
    const removals = pending.changes.filter((change) => change.row.entryId && change.price === null).map((change) => change.row.entryId as string);
    if (inserts.length) { const { error } = await supabase.from('price_list_entries').insert(inserts); if (error) throw error; }
    if (updates.length) { const { error } = await supabase.from('price_list_entries').upsert(updates, { onConflict: 'id' }); if (error) throw error; }
    if (removals.length) { const { error } = await supabase.from('price_list_entries').delete().in('id', removals); if (error) throw error; }
    await reloadSelected();
    return `Zapisano ceny w cenniku „${selected.name}” (${pending.changes.length}).`;
  });

  const saveSettings = () => run('Cennik', async () => {
    if (!selected || !settings) return;
    if (!settings.name.trim()) throw new Error('Podaj nazwę cennika.');
    if (!settings.season_from || !settings.season_to || settings.season_to < settings.season_from) throw new Error('Podaj poprawny sezon (od – do).');
    const { error } = await supabase.from('price_lists').update({
      name: settings.name.trim(), season_from: settings.season_from, season_to: settings.season_to, notes: settings.notes.trim(),
    }).eq('id', selected.id);
    if (error) throw error;
    await loadLists();
    return 'Zapisano ustawienia cennika.';
  });

  const setStatus = (status: PriceListStatus) => run('Status', async () => {
    if (!selected) return;
    if (status === 'active' && !(entryCounts[selected.id] > 0)
      && !await showConfirm({ title: 'Aktywować pusty cennik?', message: 'Cennik nie ma jeszcze cen — oferty eventów z tego sezonu dostaną ceny z katalogu.', confirmText: 'Aktywuj', cancelText: 'Anuluj' })) return;
    const { error } = await supabase.from('price_lists').update({ status }).eq('id', selected.id);
    if (error) throw error;
    await loadLists();
    return status === 'active' ? `Cennik „${selected.name}” jest aktywny — nowe oferty eventów z sezonu ${priceListSeason(selected)} dostają jego ceny.`
      : status === 'archived' ? `Cennik „${selected.name}” przeniesiony do archiwum.` : `Cennik „${selected.name}” jest szkicem.`;
  });

  const removeList = () => run('Usuwanie', async () => {
    if (!selected) return;
    if (offerCounts[selected.id]) throw new Error('Cennik jest użyty w ofertach — zarchiwizuj go zamiast usuwać.');
    if (!await showConfirm({ title: `Usunąć cennik „${selected.name}”?`, message: 'Usunięte zostaną też wszystkie ceny tego cennika. Tej operacji nie można cofnąć.', confirmText: 'Usuń cennik', cancelText: 'Anuluj' })) return;
    const { error } = await supabase.from('price_lists').delete().eq('id', selected.id);
    if (error) throw error;
    setSelectedId(null);
    await loadLists();
    return 'Cennik usunięty.';
  });

  if (loading) return <p role="status" className="flex items-center gap-2 p-6 text-sm text-white/60"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie cenników…</p>;
  if (loadError) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-6 text-sm text-[#e5e4e2]/70">
        <p role="alert">{loadError}</p>
        <p className="mt-2 text-xs text-white/45">Cenniki sezonowe wymagają migracji <code>20261129100000_season_price_lists.sql</code>.</p>
        <button type="button" onClick={() => void loadAll()} className={`${buttonClass} mt-4 bg-[#d3bb73]/15 text-[#d3bb73]`}><RotateCcw className="h-4 w-4" />Spróbuj ponownie</button>
      </div>
    );
  }

  const grouped = companies
    .map((company) => ({ company, lists: lists.filter((list) => list.my_company_id === company.id) }))
    .filter((group) => group.lists.length > 0);
  const orphans = lists.filter((list) => !companies.some((company) => company.id === list.my_company_id));

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-4 lg:self-start">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]"><Tags className="h-4 w-4 text-[#d3bb73]" />Cenniki sezonowe</h2>
          {canManage && <button type="button" onClick={() => setDialog('create')} className={`${buttonClass} bg-[#d3bb73] px-2.5 py-1.5 text-xs font-medium text-[#1c1f33]`}><Plus className="h-3.5 w-3.5" />Nowy</button>}
        </div>
        <p className="text-xs text-white/45">Cena oferty zależy od marki i roku eventu. Aktywny cennik podpowiada ceny ofert eventów z datą w sezonie; zapisane oferty trzymają swoje ceny.</p>
        {lists.length === 0 && <p className="rounded-lg bg-white/[0.03] p-3 text-xs text-white/55">Nie ma jeszcze cenników. {canManage ? 'Utwórz pierwszy — np. „Wesela 2027” dla Event Rulers — z cenami z katalogu.' : ''}</p>}
        {[...grouped, ...(orphans.length ? [{ company: { id: '', name: 'Inne marki' }, lists: orphans }] : [])].map((group) => (
          <div key={group.company.id || 'other'} className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-white/40">{group.company.name}</p>
            {group.lists.map((list) => (
              <button key={list.id} type="button" onClick={() => setSelectedId(list.id)} aria-current={list.id === selectedId}
                className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${list.id === selectedId ? 'border-[#d3bb73]/40 bg-[#d3bb73]/10' : 'border-transparent hover:bg-white/5'}`}>
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-[#e5e4e2]">{list.name}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${statusTone[list.status]}`}>{priceListStatusLabels[list.status]}</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-white/45">
                  {priceListSeason(list)} · {entryCounts[list.id] || 0} cen{offerCounts[list.id] ? ` · ofert: ${offerCounts[list.id]}` : ''}
                </span>
              </button>
            ))}
          </div>
        ))}
        {attention && (attention.offers.length > 0 || attention.missing.length > 0) && (
          <div className="space-y-2 border-t border-white/10 pt-4">
            <h3 className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
              <AlertTriangle className="h-4 w-4 text-amber-300" />Do sprawdzenia
              <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] text-amber-200">{attention.offers.length + attention.missing.length}</span>
            </h3>
            {attention.missing.map((gap) => (
              <p key={`${gap.companyId}-${gap.year}`} className="rounded-lg bg-amber-400/[0.06] px-3 py-2 text-xs text-amber-100/80">{priceListAttentionGapText(gap)}</p>
            ))}
            {attention.offers.map((offer) => (
              <Link key={offer.offerId} href={`/crm/offers/${offer.offerId}`} className="group block rounded-lg px-3 py-2 transition-colors hover:bg-white/5">
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-[#e5e4e2]">{priceListAttentionOfferTitle(offer)}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-white/35 group-hover:text-[#d3bb73]" />
                </span>
                <span className="mt-0.5 block text-[11px] text-white/50">{priceListAttentionOfferText(offer)}</span>
              </Link>
            ))}
            <p className="text-[11px] text-white/40">{PRICE_LIST_ATTENTION_HINT}</p>
          </div>
        )}
      </aside>

      <section className="min-w-0 space-y-4">
        {!selected || !settings ? (
          <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-10 text-center text-sm text-white/50">Wybierz cennik z listy{canManage ? ' albo utwórz nowy' : ''}.</div>
        ) : (
          <>
            <div className="space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-white/45">{companyName(selected.my_company_id)}</p>
                  <h2 className="text-xl font-light text-[#e5e4e2]">{selected.name}</h2>
                  <p className="mt-0.5 text-xs text-white/45">Sezon {priceListSeason(selected)} · {priceListStatusLabels[selected.status]}{offerCounts[selected.id] ? ` · użyty w ofertach: ${offerCounts[selected.id]}` : ''}</p>
                </div>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {selected.status !== 'active' && <button type="button" disabled={busy} onClick={() => void setStatus('active')} className={`${buttonClass} bg-emerald-400/15 text-emerald-200`}><CheckCircle2 className="h-4 w-4" />Aktywuj</button>}
                    {selected.status === 'active' && <button type="button" disabled={busy} onClick={() => void setStatus('archived')} className={`${buttonClass} bg-white/5 text-white/70`}><Archive className="h-4 w-4" />Do archiwum</button>}
                    {selected.status === 'archived' && <button type="button" disabled={busy} onClick={() => void setStatus('draft')} className={`${buttonClass} bg-white/5 text-white/70`}><RotateCcw className="h-4 w-4" />Przywróć jako szkic</button>}
                    <button type="button" disabled={busy} onClick={() => setDialog('duplicate')} className={`${buttonClass} bg-[#d3bb73]/15 text-[#d3bb73]`}><Copy className="h-4 w-4" />Kopiuj na kolejny sezon…</button>
                    {!offerCounts[selected.id] && <button type="button" disabled={busy} onClick={() => void removeList()} className={`${buttonClass} text-red-300 hover:bg-red-500/10`} aria-label="Usuń cennik"><Trash2 className="h-4 w-4" /></button>}
                  </div>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_160px]">
                <label className="text-xs text-white/55">Nazwa
                  <input value={settings.name} disabled={!canManage} maxLength={120} onChange={(event) => setSettings({ ...settings, name: event.target.value })} className={`${inputClass} mt-1`} />
                </label>
                <label className="text-xs text-white/55">Sezon od (data eventu)
                  <input type="date" value={settings.season_from} disabled={!canManage} onChange={(event) => setSettings({ ...settings, season_from: event.target.value })} className={`${inputClass} mt-1`} />
                </label>
                <label className="text-xs text-white/55">Sezon do
                  <input type="date" value={settings.season_to} disabled={!canManage} onChange={(event) => setSettings({ ...settings, season_to: event.target.value })} className={`${inputClass} mt-1`} />
                </label>
              </div>
              <label className="block text-xs text-white/55">Notatki (dla zespołu)
                <textarea value={settings.notes} disabled={!canManage} maxLength={2000} rows={2} onChange={(event) => setSettings({ ...settings, notes: event.target.value })} className={`${inputClass} mt-1`} />
              </label>
              {canManage && (settings.name !== selected.name || settings.season_from !== selected.season_from || settings.season_to !== selected.season_to || settings.notes !== (selected.notes || '')) && (
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setSettings({ name: selected.name, season_from: selected.season_from, season_to: selected.season_to, notes: selected.notes || '' })} className={`${buttonClass} text-white/60 hover:bg-white/5`}>Odrzuć</button>
                  <button type="button" disabled={busy} onClick={() => void saveSettings()} className={`${buttonClass} bg-[#d3bb73] font-medium text-[#1c1f33]`}><Save className="h-4 w-4" />Zapisz ustawienia</button>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj produktu lub wariantu…" aria-label="Szukaj produktu" className={`${inputClass} pl-9`} />
                </div>
                <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Kategoria" className={`${inputClass} w-auto`}>
                  <option value="all">Wszystkie kategorie</option>
                  {categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
                <label className="flex items-center gap-2 text-xs text-white/60">
                  <input type="checkbox" checked={onlyInList} onChange={(event) => setOnlyInList(event.target.checked)} className="accent-[#d3bb73]" />Tylko pozycje w cenniku
                </label>
                {canManage && (
                  <>
                    <button type="button" disabled={busy} onClick={() => setDialog('fill')} className={`${buttonClass} bg-white/5 text-[#d3bb73]`}><Wand2 className="h-4 w-4" />Uzupełnij z katalogu…</button>
                    <button type="button" disabled={busy || !entries.length} onClick={() => setDialog('percent')} className={`${buttonClass} bg-white/5 text-[#d3bb73]`}><Percent className="h-4 w-4" />Zmień ceny o %…</button>
                  </>
                )}
              </div>

              {entriesLoading ? <p role="status" className="py-6 text-sm text-white/50">Wczytywanie cen…</p> : (
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-white/[0.03] text-xs text-white/50">
                      <tr>
                        <th className="px-3 py-2 font-normal">Produkt / wariant</th>
                        <th className="px-3 py-2 text-right font-normal">Cena katalogowa netto</th>
                        <th className="px-3 py-2 text-right font-normal">Cena w cenniku netto</th>
                        <th className="px-3 py-2 text-right font-normal">Różnica</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {visibleRows.map((row, index) => {
                        const value = row.key in edits ? edits[row.key] : row.price === null ? '' : String(row.price).replace('.', ',');
                        const parsed = parsePriceInput(value);
                        const changed = row.key in edits && parsed !== row.price;
                        const effective = parsed === undefined ? null : parsed;
                        const diff = effective !== null && row.catalogPrice > 0 ? (effective / row.catalogPrice - 1) * 100 : null;
                        const firstOfProduct = index === 0 || visibleRows[index - 1].productId !== row.productId;
                        return (
                          <tr key={row.key} className={row.inactive ? 'opacity-60' : ''}>
                            <td className="px-3 py-1.5">
                              {firstOfProduct && <span className="block text-[#e5e4e2]">{row.productName}{row.inactive ? <span className="ml-2 text-[10px] text-amber-200/70">nieaktywny w katalogu</span> : null}</span>}
                              <span className="block text-xs text-white/45">{row.label}</span>
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-white/55">{money(row.catalogPrice)} zł</td>
                            <td className="px-3 py-1.5 text-right">
                              <input value={value} disabled={!canManage || busy} inputMode="decimal" placeholder="—"
                                aria-label={`Cena w cenniku: ${row.productName} — ${row.label}`}
                                onChange={(event) => setEdits({ ...edits, [row.key]: event.target.value })}
                                className={`w-32 rounded-md border bg-[#0f1119] px-2 py-1 text-right tabular-nums text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50 ${parsed === undefined ? 'border-red-400/60' : changed ? 'border-[#d3bb73]/60' : 'border-white/10'}`} />
                            </td>
                            <td className={`px-3 py-1.5 text-right text-xs tabular-nums ${diff === null ? 'text-white/25' : diff > 0 ? 'text-amber-200/80' : diff < 0 ? 'text-emerald-200/80' : 'text-white/45'}`}>
                              {diff === null ? '—' : `${diff > 0 ? '+' : ''}${diff.toFixed(1).replace('.', ',')}%`}
                            </td>
                          </tr>
                        );
                      })}
                      {visibleRows.length === 0 && <tr><td colSpan={4} className="px-3 py-8 text-center text-xs text-white/40">Brak produktów spełniających filtry.</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
              {canManage && (pending.changes.length > 0 || pending.invalid.length > 0) && (
                <div className="sticky bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#0f1119]/95 px-4 py-2 text-sm">
                  <span className="text-white/70">{pending.invalid.length ? `Nieprawidłowe ceny: ${pending.invalid.length}. ` : ''}Zmiany do zapisu: {pending.changes.length} (puste pole usuwa produkt z cennika).</span>
                  <span className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => setEdits({})} className={`${buttonClass} text-white/60 hover:bg-white/5`}><X className="h-4 w-4" />Odrzuć</button>
                    <button type="button" disabled={busy || pending.invalid.length > 0 || !pending.changes.length} onClick={() => void savePrices()} className={`${buttonClass} bg-[#d3bb73] font-medium text-[#1c1f33]`}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Zapisz ceny
                    </button>
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {dialog === 'create' && (
        <CreatePriceListDialog companies={companies} categories={categories} busy={busy} onClose={() => setDialog(null)}
          onCreate={(form) => run('Nowy cennik', async () => {
            const { data, error } = await supabase.from('price_lists').insert({
              my_company_id: form.companyId, name: form.name.trim(), season_from: form.seasonFrom, season_to: form.seasonTo, status: 'draft', notes: '',
            }).select('id').single();
            if (error || !data) throw error || new Error('Nie udało się utworzyć cennika.');
            let added = 0;
            if (form.fill) {
              const fill = await supabase.rpc('price_list_fill_from_catalog', { p_price_list_id: data.id, p_category_id: form.categoryId || null, p_percent: form.percent, p_rounding: form.rounding });
              if (fill.error) throw fill.error;
              added = Number(fill.data) || 0;
            }
            setDialog(null);
            await loadLists();
            setSelectedId(String(data.id));
            return `Utworzono cennik „${form.name.trim()}” (szkic)${form.fill ? ` z cenami z katalogu: ${added}` : ''}. Sprawdź ceny i aktywuj cennik.`;
          })} />
      )}
      {dialog === 'duplicate' && selected && (
        <DuplicatePriceListDialog source={selected} busy={busy} onClose={() => setDialog(null)}
          onDuplicate={(form) => run('Kopia cennika', async () => {
            const { data, error } = await supabase.rpc('price_list_duplicate', {
              p_source_id: selected.id, p_name: form.name.trim(), p_season_from: form.seasonFrom, p_season_to: form.seasonTo, p_percent: form.percent, p_rounding: form.rounding,
            });
            if (error || !data) throw error || new Error('Nie udało się skopiować cennika.');
            setDialog(null);
            await loadLists();
            setSelectedId(String(data));
            return `Utworzono szkic „${form.name.trim()}” z cenami ${form.percent >= 0 ? '+' : ''}${form.percent}%. Sprawdź ceny i aktywuj cennik.`;
          })} />
      )}
      {dialog === 'fill' && selected && (
        <PercentDialog title="Uzupełnij z katalogu" busy={busy} withCategory categories={categories} confirm="Uzupełnij"
          description="Dodaje do cennika aktywne produkty i warianty, których jeszcze w nim nie ma, z ceną katalogową zmienioną o podany procent. Istniejące ceny zostają."
          onClose={() => setDialog(null)}
          onConfirm={(form) => run('Uzupełnianie', async () => {
            const { data, error } = await supabase.rpc('price_list_fill_from_catalog', { p_price_list_id: selected.id, p_category_id: form.categoryId || null, p_percent: form.percent, p_rounding: form.rounding });
            if (error) throw error;
            setDialog(null);
            await reloadSelected();
            return `Dodano ceny z katalogu: ${Number(data) || 0}.`;
          })} />
      )}
      {dialog === 'percent' && selected && (
        <PercentDialog title="Zmień wszystkie ceny o %" busy={busy} confirm="Zmień ceny"
          description={`Zmienia wszystkie ceny w cenniku „${selected.name}” (${entries.length}) o podany procent i zaokrągla. Zapisane oferty zachowują swoje ceny.`}
          onClose={() => setDialog(null)}
          onConfirm={(form) => run('Zmiana cen', async () => {
            const updates = entries.map((entry) => ({ ...entry, price_list_id: selected.id, price_net: priceWithPercent(entry.price_net, form.percent, form.rounding) }));
            const { error } = await supabase.from('price_list_entries').upsert(updates, { onConflict: 'id' });
            if (error) throw error;
            setDialog(null);
            await reloadSelected();
            return `Zmieniono ceny (${updates.length}) o ${form.percent >= 0 ? '+' : ''}${form.percent}%.`;
          })} />
      )}
    </div>
  );
}

// MARK: Okna

function Dialog({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="w-full max-w-lg space-y-4 rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-light text-[#e5e4e2]">{title}</h3>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Zamknij" className="rounded-lg p-1.5 text-white/60 hover:bg-white/5"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PercentFields({ percent, rounding, onChange }: { percent: string; rounding: number; onChange: (next: { percent?: string; rounding?: number }) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs text-white/55">Zmiana cen (%)
        <input value={percent} inputMode="decimal" onChange={(event) => onChange({ percent: event.target.value })} className={`${inputClass} mt-1`} placeholder="np. 8" />
      </label>
      <label className="text-xs text-white/55">Zaokrąglenie
        <select value={rounding} onChange={(event) => onChange({ rounding: Number(event.target.value) })} className={`${inputClass} mt-1`}>
          {PRICE_ROUNDING_STEPS.map((step) => <option key={step} value={step}>{step === 0.01 ? 'do grosza' : `do ${step} zł`}</option>)}
        </select>
      </label>
    </div>
  );
}

const percentOf = (text: string) => {
  const value = Number(text.replace(',', '.').trim() || '0');
  return Number.isFinite(value) && value >= -50 && value <= 200 ? value : null;
};

function CreatePriceListDialog({ companies, categories, busy, onClose, onCreate }: {
  companies: Company[];
  categories: Category[];
  busy: boolean;
  onClose: () => void;
  onCreate: (form: { companyId: string; name: string; seasonFrom: string; seasonTo: string; fill: boolean; categoryId: string; percent: number; rounding: number }) => void;
}) {
  const preferred = companies.find((company) => /event\s*rulers/i.test(company.name)) || companies[0];
  const [companyId, setCompanyId] = useState(preferred?.id || '');
  const [name, setName] = useState('');
  const [seasonFrom, setSeasonFrom] = useState(`${nextYear}-01-01`);
  const [seasonTo, setSeasonTo] = useState(`${nextYear}-12-31`);
  const [fill, setFill] = useState(true);
  const [categoryId, setCategoryId] = useState('');
  const [percent, setPercent] = useState('0');
  const [rounding, setRounding] = useState(1);
  const percentValue = percentOf(percent);
  const valid = companyId && name.trim() && seasonFrom && seasonTo && seasonTo >= seasonFrom && (!fill || percentValue !== null);
  return (
    <Dialog title="Nowy cennik sezonowy" onClose={onClose} busy={busy}>
      <label className="block text-xs text-white/55">Marka realizująca
        <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className={`${inputClass} mt-1`}>
          {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
        </select>
      </label>
      <label className="block text-xs text-white/55">Nazwa
        <input value={name} maxLength={120} autoFocus onChange={(event) => setName(event.target.value)} placeholder={`np. Wesela ${nextYear}`} className={`${inputClass} mt-1`} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-white/55">Sezon od (data eventu)<input type="date" value={seasonFrom} onChange={(event) => setSeasonFrom(event.target.value)} className={`${inputClass} mt-1`} /></label>
        <label className="text-xs text-white/55">Sezon do<input type="date" value={seasonTo} onChange={(event) => setSeasonTo(event.target.value)} className={`${inputClass} mt-1`} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm text-white/75"><input type="checkbox" checked={fill} onChange={(event) => setFill(event.target.checked)} className="accent-[#d3bb73]" />Wypełnij cenami z katalogu</label>
      {fill && (
        <>
          <label className="block text-xs text-white/55">Produkty z kategorii
            <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={`${inputClass} mt-1`}>
              <option value="">Wszystkie aktywne produkty</option>
              {categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <PercentFields percent={percent} rounding={rounding} onChange={(next) => { if (next.percent !== undefined) setPercent(next.percent); if (next.rounding !== undefined) setRounding(next.rounding); }} />
        </>
      )}
      <p className="text-xs text-white/45">Nowy cennik jest szkicem — sprawdź ceny i aktywuj go. Aktywne cenniki jednej marki nie mogą obejmować tych samych dat.</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className={`${buttonClass} text-white/60 hover:bg-white/5`}>Anuluj</button>
        <button type="button" disabled={!valid || busy} onClick={() => onCreate({ companyId, name, seasonFrom, seasonTo, fill, categoryId, percent: percentValue ?? 0, rounding })}
          className={`${buttonClass} bg-[#d3bb73] font-medium text-[#1c1f33]`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Utwórz cennik</button>
      </div>
    </Dialog>
  );
}

function DuplicatePriceListDialog({ source, busy, onClose, onDuplicate }: {
  source: PriceList;
  busy: boolean;
  onClose: () => void;
  onDuplicate: (form: { name: string; seasonFrom: string; seasonTo: string; percent: number; rounding: number }) => void;
}) {
  const shift = (date: string) => {
    const [year, rest] = [Number(date.slice(0, 4)), date.slice(4)];
    return Number.isFinite(year) ? `${year + 1}${rest}` : date;
  };
  const nextName = source.name.replace(/(\d{4})/, (year) => String(Number(year) + 1));
  const [name, setName] = useState(nextName === source.name ? `${source.name} (kopia)` : nextName);
  const [seasonFrom, setSeasonFrom] = useState(shift(source.season_from));
  const [seasonTo, setSeasonTo] = useState(shift(source.season_to));
  const [percent, setPercent] = useState('8');
  const [rounding, setRounding] = useState(10);
  const percentValue = percentOf(percent);
  const valid = name.trim() && seasonFrom && seasonTo && seasonTo >= seasonFrom && percentValue !== null;
  return (
    <Dialog title="Kopiuj na kolejny sezon" onClose={onClose} busy={busy}>
      <p className="text-xs text-white/55">Nowy szkic z cenami z „{source.name}” zmienionymi o podany procent (np. inflacja na kolejny rok).</p>
      <label className="block text-xs text-white/55">Nazwa<input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} className={`${inputClass} mt-1`} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-white/55">Sezon od<input type="date" value={seasonFrom} onChange={(event) => setSeasonFrom(event.target.value)} className={`${inputClass} mt-1`} /></label>
        <label className="text-xs text-white/55">Sezon do<input type="date" value={seasonTo} onChange={(event) => setSeasonTo(event.target.value)} className={`${inputClass} mt-1`} /></label>
      </div>
      <PercentFields percent={percent} rounding={rounding} onChange={(next) => { if (next.percent !== undefined) setPercent(next.percent); if (next.rounding !== undefined) setRounding(next.rounding); }} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className={`${buttonClass} text-white/60 hover:bg-white/5`}>Anuluj</button>
        <button type="button" disabled={!valid || busy} onClick={() => onDuplicate({ name, seasonFrom, seasonTo, percent: percentValue ?? 0, rounding })}
          className={`${buttonClass} bg-[#d3bb73] font-medium text-[#1c1f33]`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Utwórz kopię</button>
      </div>
    </Dialog>
  );
}

function PercentDialog({ title, description, confirm, busy, withCategory, categories = [], onClose, onConfirm }: {
  title: string;
  description: string;
  confirm: string;
  busy: boolean;
  withCategory?: boolean;
  categories?: Category[];
  onClose: () => void;
  onConfirm: (form: { categoryId: string; percent: number; rounding: number }) => void;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [percent, setPercent] = useState('0');
  const [rounding, setRounding] = useState(1);
  const percentValue = percentOf(percent);
  return (
    <Dialog title={title} onClose={onClose} busy={busy}>
      <p className="text-xs text-white/55">{description}</p>
      {withCategory && (
        <label className="block text-xs text-white/55">Produkty z kategorii
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={`${inputClass} mt-1`}>
            <option value="">Wszystkie aktywne produkty</option>
            {categories.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
      )}
      <PercentFields percent={percent} rounding={rounding} onChange={(next) => { if (next.percent !== undefined) setPercent(next.percent); if (next.rounding !== undefined) setRounding(next.rounding); }} />
      {percentValue === null && <p className="text-xs text-red-300">Podaj procent od -50 do 200.</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={busy} className={`${buttonClass} text-white/60 hover:bg-white/5`}>Anuluj</button>
        <button type="button" disabled={percentValue === null || busy} onClick={() => onConfirm({ categoryId, percent: percentValue ?? 0, rounding })}
          className={`${buttonClass} bg-[#d3bb73] font-medium text-[#1c1f33]`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{confirm}</button>
      </div>
    </Dialog>
  );
}
