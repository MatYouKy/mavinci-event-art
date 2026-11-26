'use client';

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Layers, Minus, Package, Plus, RefreshCw, Search, Trash2, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  checkRentalAvailability,
  rentalCatalog,
  rentalCatalogFree,
  rentalCatalogMatches,
  rentalCategoryPaths,
  rentalCategoryScope,
  rentalCategoryTree,
  rentalDateTime,
  rentalErrorMessage,
  rentalKitFree,
  rentalLineNet,
  rentalLinesDemand,
  rentalMoney,
  setRentalItems,
  type RentalAvailability,
  type RentalCatalog,
  type RentalCatalogItem,
  type RentalCatalogKit,
  type RentalDetail,
  type RentalItemInput,
} from '@/lib/CRM/rental/rental';
import { RentalError, RentalModal, numberOrNull, rentalButton, rentalInput, rentalPrimaryButton } from './rentalUi';

/*
 * Pozycje wypożyczenia. „Katalog magazynu” — cały sprzęt i zestawy z kategoriami, wyszukiwaniem i liczbą wolnych sztuk w oknie
 * wypożyczenia (`rental_catalog`: od wyjazdu sprzętu — wydanie lub dostawa — do powrotu — zwrot lub odbiór; bez pozycji tego
 * wypożyczenia), wybór ilości wielu pozycji naraz (nie więcej niż wolne). „Wybrane pozycje” — ceny za dobę albo ryczałt, doby,
 * rabaty, wartość odtworzeniowa, usługi (transport, montaż) i konflikty terminu. Zestaw rozpisuje się na składniki przy zapisie.
 * Dostępność ostatecznie liczy baza — przy braku zapis zarezerwowanego wypożyczenia się nie uda.
 */

/** `settled` — sztuki, które już wróciły na stan albo z niego zeszły (nie zajmują magazynu w terminie wypożyczenia). */
type Line = RentalItemInput & { key: string; issued_qty: number; settled: number; kit_name?: string | null };
type Tab = 'catalog' | 'lines';

const lineKey = () => Math.random().toString(36).slice(2);
const isDirect = (line: Line, equipmentId: string) => line.kind === 'equipment' && line.equipment_id === equipmentId && !line.kit_id;
const isNewKit = (line: Line, kitId: string) => line.kind === 'equipment' && line.kit_id === kitId && !line.equipment_id;
const qty = (line: Line) => Math.max(0, Math.floor(Number(line.quantity) || 0));

export default function RentalItemsModal({
  rental,
  startInCatalog = false,
  onClose,
  onSaved,
}: {
  rental: RentalDetail;
  /** Otwórz na katalogu (np. zaraz po utworzeniu wypożyczenia). */
  startInCatalog?: boolean;
  onClose: () => void;
  onSaved: (rental: RentalDetail) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [lines, setLines] = useState<Line[]>(() =>
    rental.items.map((item) => ({
      key: item.id,
      id: item.id,
      kind: item.kind,
      equipment_id: item.equipment_id,
      kit_id: item.kit_id,
      kit_name: item.kit_name,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      price_mode: item.price_mode || 'per_day',
      unit_price: item.unit_price ?? 0,
      days: item.days ?? null,
      discount_percent: item.discount_percent ?? 0,
      replacement_value: item.replacement_value ?? null,
      note: item.note,
      issued_qty: item.issued_qty,
      settled: item.returned_ok_qty + item.damaged_back_qty + item.damaged_out_qty + item.missing_back_qty + item.missing_out_qty,
    })),
  );
  const [tab, setTab] = useState<Tab>(startInCatalog || rental.items.length === 0 ? 'catalog' : 'lines');
  const [catalog, setCatalog] = useState<RentalCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [hideBusy, setHideBusy] = useState(false);
  const [availability, setAvailability] = useState<Record<string, RentalAvailability>>({});
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      setCatalog(await rentalCatalog(supabase, rental.starts_at, rental.ends_at, rental.id));
    } catch (failure) {
      setCatalogError(rentalErrorMessage(failure, 'Nie udało się pobrać katalogu magazynu.'));
    } finally {
      setCatalogLoading(false);
    }
  }, [rental.ends_at, rental.id, rental.starts_at]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const kits = useMemo(() => catalog?.kits || [], [catalog]);
  const itemsById = useMemo(() => new Map((catalog?.items || []).map((item) => [item.id, item])), [catalog]);
  const paths = useMemo(() => rentalCategoryPaths(catalog?.categories || []), [catalog]);
  const tree = useMemo(() => rentalCategoryTree(catalog?.categories || []), [catalog]);
  const scope = useMemo(() => (categoryId && catalog ? rentalCategoryScope(catalog.categories, categoryId) : null), [catalog, categoryId]);
  /** Sztuki sprzętu zajęte przez pozycje formularza (zestawy jeszcze nierozpisane — wg składu z katalogu). */
  const demand = useMemo(() => rentalLinesDemand(lines, kits), [lines, kits]);

  const equipmentDemand = useMemo(() => [...demand].map(([equipment_id, quantity]) => ({ equipment_id, quantity })), [demand]);

  const check = useCallback(async () => {
    if (!equipmentDemand.length) {
      setAvailability({});
      return;
    }
    setChecking(true);
    try {
      const rows = await checkRentalAvailability(supabase, rental.starts_at, rental.ends_at, equipmentDemand, rental.id);
      setAvailability(Object.fromEntries(rows.map((row) => [row.equipment_id, row])));
    } catch (failure) {
      setError(rentalErrorMessage(failure, 'Nie udało się sprawdzić dostępności.'));
    } finally {
      setChecking(false);
    }
  }, [equipmentDemand, rental.ends_at, rental.id, rental.starts_at]);

  useEffect(() => {
    const timer = setTimeout(check, 400);
    return () => clearTimeout(timer);
  }, [check]);

  const update = (key: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  const selectedOf = (equipmentId: string) => lines.filter((line) => isDirect(line, equipmentId)).reduce((sum, line) => sum + qty(line), 0);
  const kitsSelectedOf = (kitId: string) => lines.filter((line) => isNewKit(line, kitId)).reduce((sum, line) => sum + qty(line), 0);

  /** Ilość sprzętu w pozycjach bez zestawu: najwyżej wolne w oknie (minus inne pozycje), najmniej tyle, ile wydano. */
  const setEquipment = (item: RentalCatalogItem, wanted: number) => {
    setLines((current) => {
      const direct = current.filter((line) => isDirect(line, item.id));
      const selected = direct.reduce((sum, line) => sum + qty(line), 0);
      const minimum = direct.reduce((sum, line) => sum + line.issued_qty, 0);
      const others = rentalLinesDemand(current, kits, (line) => isDirect(line, item.id)).get(item.id) || 0;
      const settled = direct.reduce((sum, line) => sum + line.settled, 0);
      const maximum = item.available - others + settled;
      let target = Math.max(0, Math.floor(wanted));
      if (target > selected) target = Math.max(selected, Math.min(target, maximum));
      target = Math.max(target, minimum);
      if (target === selected) return current;
      if (target > selected) {
        const first = direct[0];
        if (first) return current.map((line) => (line.key === first.key ? { ...line, quantity: qty(line) + target - selected } : line));
        return [...current, {
          key: lineKey(), kind: 'equipment', equipment_id: item.id, name: item.name, quantity: target, issued_qty: 0, settled: 0,
          price_mode: 'per_day', unit_price: item.price, discount_percent: 0,
        }];
      }
      let remaining = selected - target;
      const next = new Map<string, number>();
      for (const line of [...direct].reverse()) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, qty(line) - line.issued_qty);
        if (take <= 0) continue;
        next.set(line.key, qty(line) - take);
        remaining -= take;
      }
      return current.flatMap((line) => {
        if (!next.has(line.key)) return [line];
        const quantity = next.get(line.key)!;
        return quantity > 0 ? [{ ...line, quantity }] : [];
      });
    });
  };

  /** Zestawy dodane teraz (rozpiszą się na składniki przy zapisie): najwyżej tyle kompletów, ile pozwalają wolne składniki. */
  const setKit = (kit: RentalCatalogKit, wanted: number) => {
    setLines((current) => {
      const added = current.filter((line) => isNewKit(line, kit.id));
      const selected = added.reduce((sum, line) => sum + qty(line), 0);
      const free = rentalKitFree(kit, itemsById, rentalLinesDemand(current, kits, (line) => isNewKit(line, kit.id)));
      let target = Math.max(0, Math.floor(wanted));
      if (target > selected) target = Math.max(selected, Math.min(target, free));
      if (target === selected) return current;
      const rest = current.filter((line) => !isNewKit(line, kit.id));
      if (target === 0) return rest;
      const first = added[0];
      const line: Line = first
        ? { ...first, quantity: target }
        : { key: lineKey(), kind: 'equipment', kit_id: kit.id, kit_name: kit.name, name: `Zestaw: ${kit.name}`, quantity: target, issued_qty: 0, settled: 0,
            price_mode: 'per_day', unit_price: 0, discount_percent: 0 };
      const index = first ? current.findIndex((item) => item.key === first.key) : -1;
      return index >= 0 ? [...rest.slice(0, index), line, ...rest.slice(index)] : [...rest, line];
    });
  };

  const addService = () => {
    setTab('lines');
    setLines((current) => [...current, { key: lineKey(), kind: 'service', name: '', quantity: 1, unit: 'usł.', issued_qty: 0, settled: 0, price_mode: 'flat', unit_price: 0, discount_percent: 0 }]);
  };

  const visibleItems = useMemo(() => {
    if (!catalog) return [];
    return catalog.items
      .filter((item) => !scope || (item.category_id && scope.has(item.category_id)))
      .filter((item) => rentalCatalogMatches(query, item.name, item.brand, item.model, item.category_id ? paths.get(item.category_id) : null))
      .filter((item) => !hideBusy || item.available > 0 || lines.some((line) => isDirect(line, item.id)))
      .map((item) => ({ item, path: (item.category_id && paths.get(item.category_id)) || 'Bez kategorii' }))
      .sort((a, b) => a.path.localeCompare(b.path, 'pl') || a.item.name.localeCompare(b.item.name, 'pl'));
  }, [catalog, hideBusy, lines, paths, query, scope]);

  const visibleKits = useMemo(() => kits
    .filter((kit) => !scope || (kit.category_id && scope.has(kit.category_id)))
    .filter((kit) => rentalCatalogMatches(query, kit.name, ...kit.components.map((part) => part.name)))
    .filter((kit) => !hideBusy || kit.available > 0 || lines.some((line) => isNewKit(line, kit.id))), [hideBusy, kits, lines, query, scope]);

  const total = lines.reduce((sum, line) => sum + rentalLineNet(line, rental.default_days), 0);
  const shortages = Object.values(availability).filter((row) => row.shortage > 0);
  const blocking = rental.status !== 'draft' && shortages.length > 0;
  const equipmentPieces = lines.filter((line) => line.kind === 'equipment').reduce((sum, line) => sum + qty(line), 0);
  const windowWider = catalog
    ? new Date(catalog.window.starts_at).getTime() < new Date(rental.starts_at).getTime()
      || new Date(catalog.window.ends_at).getTime() > new Date(rental.ends_at).getTime()
    : false;

  const save = async () => {
    setError(null);
    if (lines.some((line) => line.kind === 'service' && !String(line.name || '').trim())) {
      setTab('lines');
      return setError('Podaj nazwę każdej usługi.');
    }
    if (lines.some((line) => !(Number(line.quantity) >= 1))) {
      setTab('lines');
      return setError('Ilość każdej pozycji musi być większa od zera.');
    }
    if (lines.some((line) => line.id && Number(line.quantity) < line.issued_qty)) {
      setTab('lines');
      return setError('Ilość nie może być mniejsza niż już wydana.');
    }
    setSaving(true);
    try {
      const saved = await setRentalItems(supabase, rental.id, lines.map(({ key: _key, issued_qty: _issued, settled: _settled, kit_name: _kit, ...line }) => ({
        ...line,
        name: line.kind === 'service' ? String(line.name || '').trim() : line.kit_id && !line.equipment_id ? undefined : line.name,
      })));
      showSnackbar('Zapisano pozycje wypożyczenia', 'success');
      onSaved(saved);
    } catch (failure) {
      setError(rentalErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  const stepper = (value: number, onChange: (next: number) => void, canAdd: boolean, label: string) => (
    <div className="flex shrink-0 items-center gap-1" role="group" aria-label={`Ilość: ${label}`}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={value <= 0}
        className="rounded-lg border border-white/10 p-1.5 text-[#e5e4e2]/80 hover:bg-white/5 disabled:opacity-30" aria-label={`Mniej: ${label}`}>
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input value={value ? String(value) : ''} placeholder="0" inputMode="numeric" aria-label={`Ilość: ${label}`}
        onChange={(event) => onChange(Math.max(0, Math.floor(numberOrNull(event.target.value) ?? 0)))}
        className={`${rentalInput} w-14 px-2 py-1 text-center`} />
      <button type="button" onClick={() => onChange(value + 1)} disabled={!canAdd}
        className="rounded-lg border border-[#d3bb73]/40 p-1.5 text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-30" aria-label={`Więcej: ${label}`}>
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const catalogTab = (
    <div className="space-y-3">
      {catalog && (
        <p className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs text-[#e5e4e2]/65">
          Wolne sztuki liczone dla czasu, w którym sprzęt jest poza magazynem:{' '}
          <strong className="text-[#e5e4e2]">{rentalDateTime(catalog.window.starts_at)} – {rentalDateTime(catalog.window.ends_at)}</strong>
          {windowWider ? ' (z dostawą, odbiorem albo wcześniejszym wydaniem)' : ''}. Uwzględnia eventy i inne wypożyczenia — bez pozycji tego wypożyczenia.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" aria-hidden />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj sprzętu, dekoracji, zestawu, marki…"
            className={`${rentalInput} pl-9`} aria-label="Szukaj w katalogu" />
        </div>
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className={`${rentalInput} w-auto min-w-48`} aria-label="Kategoria">
          <option value="">Wszystkie kategorie</option>
          {tree.map(({ category, depth }) => (
            <option key={category.id} value={category.id}>{`${'  '.repeat(depth)}${depth ? '› ' : ''}${category.name}`}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
          <input type="checkbox" checked={hideBusy} onChange={(event) => setHideBusy(event.target.checked)} className="accent-[#d3bb73]" />
          Ukryj zajęte
        </label>
        <button type="button" className={rentalButton} onClick={() => void loadCatalog()} disabled={catalogLoading} title="Odśwież dostępność">
          <RefreshCw className={`h-4 w-4 ${catalogLoading ? 'animate-spin' : ''}`} />Odśwież
        </button>
      </div>
      <RentalError message={catalogError} />
      {catalogLoading && !catalog ? (
        <p className="p-6 text-center text-sm text-[#e5e4e2]/60">Wczytywanie katalogu magazynu…</p>
      ) : catalog && !visibleItems.length && !visibleKits.length ? (
        <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-[#e5e4e2]/60">Brak sprzętu dla wybranych filtrów.</p>
      ) : (
        <div className="divide-y divide-white/5 rounded-xl border border-white/10">
          {visibleKits.length > 0 && (
            <div>
              <p className="sticky top-0 z-[1] bg-[#0f1119] px-3 py-2 text-xs uppercase tracking-wide text-[#d3bb73]/80">Zestawy</p>
              {visibleKits.map((kit) => {
                const selected = kitsSelectedOf(kit.id);
                const free = rentalKitFree(kit, itemsById, rentalLinesDemand(lines, kits, (line) => isNewKit(line, kit.id)));
                return (
                  <div key={kit.id} className={`flex items-center gap-3 px-3 py-2 ${kit.available === 0 && !selected ? 'opacity-60' : ''}`}>
                    {kit.thumbnail_url
                      ? <img src={kit.thumbnail_url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" loading="lazy" />
                      : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/5"><Layers className="h-5 w-5 text-[#d3bb73]" /></span>}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[#e5e4e2]">{kit.name}</p>
                      <p className="truncate text-xs text-[#e5e4e2]/50">{kit.components.map((part) => `${part.quantity}× ${part.name}`).join(', ')}</p>
                    </div>
                    <span className={`shrink-0 text-xs ${kit.available > 0 ? 'text-emerald-300' : 'text-amber-200'}`}>
                      {kit.available > 0 ? `Kompletów: ${kit.available}` : 'Zajęte w terminie'}
                    </span>
                    {stepper(selected, (next) => setKit(kit, next), selected < free, kit.name)}
                  </div>
                );
              })}
            </div>
          )}
          {visibleItems.map(({ item, path }, index) => {
            const selected = selectedOf(item.id);
            const used = demand.get(item.id) || 0;
            const inKits = Math.max(0, used - lines.filter((line) => isDirect(line, item.id)).reduce((sum, line) => sum + Math.max(0, qty(line) - line.settled), 0));
            const over = used - item.available;
            const header = index === 0 || visibleItems[index - 1].path !== path;
            return (
              <div key={item.id}>
                {header && <p className="sticky top-0 z-[1] bg-[#0f1119] px-3 py-2 text-xs uppercase tracking-wide text-[#d3bb73]/80">{path}</p>}
                <div className={`flex items-center gap-3 px-3 py-2 ${item.available === 0 && !selected ? 'opacity-60' : ''}`}>
                  {item.thumbnail_url
                    ? <img src={item.thumbnail_url} alt="" className="h-10 w-10 shrink-0 rounded-md object-cover" loading="lazy" />
                    : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/5"><Package className="h-5 w-5 text-[#d3bb73]" /></span>}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-[#e5e4e2]">{item.name}</p>
                    <p className="truncate text-xs text-[#e5e4e2]/50">
                      {[[item.brand, item.model].filter(Boolean).join(' '), item.price != null ? `${rentalMoney(item.price)}/doba` : ''].filter(Boolean).join(' · ') || ' '}
                    </p>
                  </div>
                  <span className="shrink-0 text-right text-xs">
                    <span className={item.available > 0 ? 'text-emerald-300' : 'text-amber-200'}>
                      {item.available > 0 ? `Dostępne ${item.available} z ${item.stock}` : `Zajęte w terminie (stan ${item.stock})`}
                    </span>
                    {inKits > 0 && <span className="block text-[#e5e4e2]/50">w zestawach: {inKits}</span>}
                    {over > 0 && <span className="block text-amber-200">Brakuje {over}</span>}
                  </span>
                  {stepper(selected, (next) => setEquipment(item, next), rentalCatalogFree(item, demand) > 0, item.name)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const linesTab = (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={rentalButton} onClick={() => setTab('catalog')}><Package className="h-4 w-4" />Dodaj z katalogu</button>
        <button type="button" className={rentalButton} onClick={addService}><Wrench className="h-4 w-4" />Dodaj usługę</button>
        <button type="button" className={rentalButton} onClick={check} disabled={checking || !equipmentDemand.length}>
          {checking ? 'Sprawdzanie…' : 'Sprawdź dostępność'}
        </button>
      </div>
      {lines.length === 0 ? (
        <p className="rounded-xl border border-white/10 p-6 text-center text-sm text-[#e5e4e2]/60">Wybierz sprzęt z katalogu magazynu albo dodaj usługę.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[#e5e4e2]/50">
              <tr>
                <th className="py-2 pr-2 font-normal">Pozycja</th>
                <th className="w-20 py-2 pr-2 font-normal">Ilość</th>
                <th className="w-28 py-2 pr-2 font-normal">Cena</th>
                <th className="w-24 py-2 pr-2 font-normal">Za</th>
                <th className="w-20 py-2 pr-2 font-normal">Doby</th>
                <th className="w-20 py-2 pr-2 font-normal">Rabat %</th>
                <th className="w-28 py-2 pr-2 font-normal" title="Wartość odtworzeniowa za sztukę — podpowiedź naliczeń za szkody i braki">Wart. odtw.</th>
                <th className="w-28 py-2 pr-2 text-right font-normal">Netto</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const state = line.equipment_id ? availability[line.equipment_id] : undefined;
                return (
                  <tr key={line.key} className="border-t border-white/5 align-top">
                    <td className="py-2 pr-2">
                      {line.kind === 'service' ? (
                        <input value={line.name || ''} onChange={(event) => update(line.key, { name: event.target.value })} placeholder="Nazwa usługi (np. transport)" className={rentalInput} />
                      ) : (
                        <div className="space-y-1">
                          <p className="font-medium text-[#e5e4e2]">{line.name}</p>
                          {line.kit_name && <p className="text-xs text-[#e5e4e2]/50">{line.equipment_id ? `Z zestawu: ${line.kit_name}` : 'Zestaw zostanie rozpisany na składniki po zapisie'}</p>}
                          {line.issued_qty > 0 && <p className="text-xs text-[#d3bb73]">Wydano {line.issued_qty}</p>}
                          {state && (
                            state.shortage > 0 ? (
                              <details className="text-xs text-amber-200">
                                <summary className="flex cursor-pointer items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Brakuje {state.shortage} (dostępne {state.available} z {state.stock})</summary>
                                <ul className="mt-1 space-y-0.5 text-[#e5e4e2]/60">
                                  {state.conflicts.map((conflict) => (
                                    <li key={`${conflict.type}-${conflict.id}`}>
                                      {conflict.type === 'event' ? 'Event' : 'Wypożyczenie'}: {conflict.name} · {rentalDateTime(conflict.starts_at)}
                                      {conflict.ends_at ? ` – ${rentalDateTime(conflict.ends_at)}` : ' – do zwrotu'} · {conflict.qty} szt.
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            ) : (
                              <p className="flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Dostępne {state.available} z {state.stock}</p>
                            )
                          )}
                        </div>
                      )}
                      <input value={line.note || ''} onChange={(event) => update(line.key, { note: event.target.value })} placeholder="Uwagi do pozycji" className={`${rentalInput} mt-1 py-1 text-xs`} />
                    </td>
                    <td className="py-2 pr-2">
                      <input value={String(line.quantity ?? '')} onChange={(event) => update(line.key, { quantity: Math.max(0, Math.floor(numberOrNull(event.target.value) ?? 0)) })} inputMode="numeric" className={rentalInput} />
                    </td>
                    <td className="py-2 pr-2">
                      <input value={line.unit_price == null ? '' : String(line.unit_price)} onChange={(event) => update(line.key, { unit_price: numberOrNull(event.target.value) })} inputMode="decimal" className={rentalInput} />
                    </td>
                    <td className="py-2 pr-2">
                      <select value={line.price_mode || 'per_day'} onChange={(event) => update(line.key, { price_mode: event.target.value as 'per_day' | 'flat' })} className={rentalInput}>
                        <option value="per_day">dobę</option>
                        <option value="flat">całość</option>
                      </select>
                    </td>
                    <td className="py-2 pr-2">
                      <input value={line.days == null ? '' : String(line.days)} disabled={line.price_mode === 'flat'} placeholder={String(rental.default_days)}
                        onChange={(event) => update(line.key, { days: numberOrNull(event.target.value) })} inputMode="decimal" className={rentalInput} />
                    </td>
                    <td className="py-2 pr-2">
                      <input value={String(line.discount_percent ?? 0)} onChange={(event) => update(line.key, { discount_percent: numberOrNull(event.target.value) ?? 0 })} inputMode="decimal" className={rentalInput} />
                    </td>
                    <td className="py-2 pr-2">
                      {line.kind === 'equipment' ? (
                        <input value={line.replacement_value == null ? '' : String(line.replacement_value)} onChange={(event) => update(line.key, { replacement_value: numberOrNull(event.target.value) })}
                          inputMode="decimal" placeholder="z katalogu" className={rentalInput} />
                      ) : <span className="text-xs text-[#e5e4e2]/40">—</span>}
                    </td>
                    <td className="py-2 pr-2 text-right text-[#e5e4e2]">{rentalMoney(rentalLineNet(line, rental.default_days))}</td>
                    <td className="py-2">
                      <button type="button" onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} disabled={line.issued_qty > 0}
                        className="rounded p-1.5 text-red-300 hover:bg-red-400/10 disabled:opacity-30" aria-label="Usuń pozycję" title={line.issued_qty > 0 ? 'Pozycja została wydana' : 'Usuń pozycję'}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[#e5e4e2]/45">
        Dostępność liczy stan sprawny minus największą liczbę sztuk zajętych naraz przez eventy i inne wypożyczenia, od wyjazdu sprzętu
        (wydanie albo dostawa) do jego powrotu (zwrot albo odbiór). Pusta cena — cena za dobę z katalogu magazynu. Wartość odtworzeniowa
        (domyślnie z katalogu) podpowiada naliczenia za uszkodzenia i braki.
      </p>
    </div>
  );

  return (
    <RentalModal
      wide
      extraWide
      title="Pozycje wypożyczenia"
      subtitle={`${rental.number} · ${rentalDateTime(rental.starts_at)} – ${rentalDateTime(rental.ends_at)} · ${rental.default_days} ${rental.default_days === 1 ? 'doba' : 'dób'}`}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-sm text-[#e5e4e2]/70">Razem netto (przed rabatem na całość): <strong className="text-[#e5e4e2]">{rentalMoney(total)}</strong></span>
          <button type="button" className={rentalButton} onClick={onClose} disabled={saving}>Anuluj</button>
          <button type="button" className={rentalPrimaryButton} onClick={save} disabled={saving || blocking}>{saving ? 'Zapisywanie…' : 'Zapisz pozycje'}</button>
        </>
      }
    >
      <div className="space-y-4">
        <RentalError message={error} />
        {blocking && (
          <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            Wypożyczenie jest zarezerwowane — zmniejsz ilości brakującego sprzętu albo zmień termin, aby zapisać.
          </p>
        )}
        <div className="flex rounded-lg border border-white/10 p-0.5" role="tablist" aria-label="Pozycje wypożyczenia">
          {([['catalog', 'Katalog magazynu'], ['lines', `Wybrane pozycje (${lines.length})`]] as Array<[Tab, string]>).map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm ${tab === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70 hover:bg-white/5'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'catalog' && equipmentPieces > 0 && (
          <p className="text-xs text-[#e5e4e2]/55">
            Wybrano {lines.filter((line) => line.kind === 'equipment').length} pozycji sprzętu ({equipmentPieces} szt.) — ceny, doby i rabaty ustawisz w „Wybrane pozycje”.
          </p>
        )}
        {tab === 'catalog' ? catalogTab : linesTab}
      </div>
    </RentalModal>
  );
}
