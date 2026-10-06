'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Package, Zap, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { CalcItem, Category } from './EventCalculationsTab';
import { DEFAULT_VAT } from '../helpers/calculations/calculations.helper';
import NextImage from 'next/image';
import Popover from '@/components/UI/Tooltip';
interface EquipmentOption {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  thumbnail_url: string | null;
  rental_price_per_day: number | null;
  power_specs: {
    power_watts?: number | null;
    current_amps?: number | null;
    voltage_volts?: number | null;
  } | null;
  weight_kg: number | null;
  category_name?: string | null;
  stock_quantity: number;
}

interface Props {
  category: Category;
  existingCount: number;
  existingItems: CalcItem[];
  initialItem?: CalcItem;
  onAdd: (item: CalcItem) => Promise<void>;
  onClose: () => void;
}

export function AddCalculationItemModal({
  category,
  existingCount,
  existingItems,
  onAdd,
  initialItem,
  onClose,
}: Props) {
  const [mode, setMode] = useState<'warehouse' | 'manual' | 'product' | 'vehicle'>(
    initialItem ? (['warehouse', 'product', 'vehicle'].includes(initialItem.source) ? initialItem.source as 'warehouse' | 'product' | 'vehicle' : 'manual')
      : category === 'equipment' ? 'warehouse' : 'manual',
  );
  type CatalogOption = { id: string; label: string; name: string; description: string; price: number; unit: string; vat: number };
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogOption | null>(initialItem && ['product', 'vehicle'].includes(initialItem.source) && initialItem.source_ref ? {
    id: initialItem.source_ref, label: initialItem.source_label || initialItem.name, name: initialItem.name,
    description: initialItem.description, price: initialItem.unit_price, unit: initialItem.unit, vat: initialItem.vat_rate,
  } : null);
  const [sourceChanged, setSourceChanged] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const close = () => { if (!submitLock.current) onClose(); };

  useEffect(() => {
    if (mode !== 'product' && mode !== 'vehicle') return;
    let active = true;
    setCatalogLoading(true); setError(''); setCatalog([]);
    const load = async () => {
      try {
        const options: CatalogOption[] = [];
        for (let offset = 0; ; offset += 500) {
          const result = mode === 'product'
            ? await supabase.from('offer_products').select('id,name,description,price_net,base_price,unit,vat_rate').eq('is_active', true).eq('is_personnel_service', true).order('id').range(offset, offset + 499)
            : await supabase.from('vehicles').select('id,name,brand,model,registration_number,category,status').not('status', 'in', '(sold,scrapped,inactive)').order('id').range(offset, offset + 499);
          if (result.error) throw result.error;
          for (const row of (result.data || []) as any[]) {
            const transportName = ['personal_car', 'bus', 'motorcycle'].includes(row.category) ? 'Transport osobowy' : 'Transport ciężarowy';
            options.push(mode === 'product' ? { id: row.id, label: row.name, name: row.name, description: row.description || '', price: Number(row.price_net ?? row.base_price ?? 0), unit: row.unit || 'h', vat: Number(row.vat_rate ?? DEFAULT_VAT) }
              : { id: row.id, label: [row.name || [row.brand, row.model].filter(Boolean).join(' '), row.registration_number].filter(Boolean).join(' · '), name: transportName, description: '', price: 0, unit: 'auto', vat: DEFAULT_VAT });
          }
          if ((result.data || []).length < 500) break;
        }
        if (active) setCatalog(options.sort((a, b) => a.label.localeCompare(b.label, 'pl')));
      } catch { if (active) setError('Nie udało się pobrać katalogu. Zamknij formularz i spróbuj ponownie.'); }
      finally { if (active) setCatalogLoading(false); }
    };
    void load();
    return () => { active = false; };
  }, [mode]);

  const isTransport = category === 'transport';
  const [unit, setUnit] = useState(
    initialItem?.unit || (category === 'staff' ? 'h' : category === 'transport' ? 'auto' : 'szt.'),
  );

  const PAGE_SIZE = 30;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [equipmentList, setEquipmentList] = useState<EquipmentOption[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentOption | null>(initialItem?.source === 'warehouse' && initialItem.source_ref ? {
    id: initialItem.source_ref, name: initialItem.name, brand: null, model: null,
    thumbnail_url: initialItem.thumbnail_url || null, rental_price_per_day: initialItem.unit_price,
    power_specs: { power_watts: initialItem.power_watts }, weight_kg: initialItem.weight_kg ?? null,
    stock_quantity: initialItem.stock_quantity ?? 0,
  } : null);

  const [name, setName] = useState(initialItem?.name ?? '');
  const [description, setDescription] = useState(initialItem?.description ?? '');
  const [quantity, setQuantity] = useState(initialItem?.quantity ?? 1);
  const [days, setDays] = useState(initialItem?.days ?? 1);
  const [unitPrice, setUnitPrice] = useState(initialItem?.unit_price ?? 0);
  const [vatRate, setVatRate] = useState(initialItem?.vat_rate ?? DEFAULT_VAT);
  const [powerWatts, setPowerWatts] = useState<number | null>(initialItem?.power_watts ?? null);

  const loadEquipment = useCallback(async () => {
    if (equipmentList.length > 0) return;
    setLoadingEquipment(true);

    const { data, error } = await supabase
      .from('equipment_items')
      .select(
        `
      id,
      name,
      brand,
      model,
      thumbnail_url,
      rental_price_per_day,
      power_specs,
      weight_kg,
      cable_stock_quantity,
      warehouse_category_id,
      warehouse_categories:warehouse_category_id (
        id,
        name,
        special_properties
      )
    `,
      )
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name');

    if (error) {
      console.error(error);
      setLoadingEquipment(false);
      return;
    }

    const itemIds = data
      .filter((d: any) => {
        const usesSimple =
          d.warehouse_categories?.special_properties?.some(
            (p: any) => p.name === 'uses_simple_quantity' && p.value === true,
          ) ?? false;

        return !usesSimple;
      })
      .map((d: any) => d.id);

    let unitCounts: Record<string, number> = {};
    if (itemIds.length > 0) {
      const { data: units } = await supabase
        .from('equipment_units')
        .select('equipment_id')
        .in('equipment_id', itemIds)
        .eq('status', 'available');

      if (units) {
        for (const u of units) {
          unitCounts[u.equipment_id] = (unitCounts[u.equipment_id] || 0) + 1;
        }
      }
    }

    const mapped: EquipmentOption[] = data.map((item: any) => {
      const usesSimple =
        item.warehouse_categories?.special_properties?.some(
          (p: any) => p.name === 'uses_simple_quantity' && p.value === true,
        ) ?? false;
      const stock = usesSimple
        ? Number(item.cable_stock_quantity ?? 0)
        : (unitCounts[item.id] ?? 0);

      return {
        id: item.id,
        name: item.name,
        brand: item.brand,
        model: item.model,
        thumbnail_url: item.thumbnail_url,
        rental_price_per_day: item.rental_price_per_day,
        power_specs: item.power_specs,
        weight_kg: item.weight_kg != null ? Number(item.weight_kg) : null,
        category_name: item.warehouse_categories?.name ?? null,
        stock_quantity: stock,
      };
    });

    setEquipmentList(mapped);
    setLoadingEquipment(false);
  }, [equipmentList.length]);

  useEffect(() => {
    if (mode === 'warehouse') {
      loadEquipment();
    }
  }, [mode, loadEquipment]);

  const getAlreadyAddedQuantity = (equipmentId: string) =>
    existingItems
      .filter((item) => (!initialItem || item.id !== initialItem.id) && item.source === 'warehouse' && item.source_ref === equipmentId)
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  const getRemainingStock = (eq: EquipmentOption) => {
    const alreadyAdded = getAlreadyAddedQuantity(eq.id);
    return Math.max(eq.stock_quantity - alreadyAdded, 0);
  };

  const filteredEquipmentAll = useMemo(() => {
    const q = search.trim().toLowerCase();

    return equipmentList.filter((e) => {
      const remaining = getRemainingStock(e);

      if (remaining <= 0) return false;

      if (!q) return true;

      const full =
        `${e.name} ${e.brand ?? ''} ${e.model ?? ''} ${e.category_name ?? ''}`.toLowerCase();

      return full.includes(q);
    });
  }, [equipmentList, search, existingItems]);

  const filteredEquipment = useMemo(() => {
    return filteredEquipmentAll.slice(0, visibleCount);
  }, [filteredEquipmentAll, visibleCount]);

  const handleSelectEquipment = (eq: EquipmentOption) => {
    setSelectedEquipment(eq);
    setSourceChanged(true);
    const fullName = [eq.brand, eq.model, eq.name].filter(Boolean).join(' ') || eq.name;
    setName(fullName);
    setUnitPrice(Number(eq.rental_price_per_day ?? 0));
    setPowerWatts(eq.power_specs?.power_watts ?? null);
  };

  const stockExceeded = selectedEquipment != null && quantity > selectedEquipment.stock_quantity;

  const handleSubmit = async () => {
    if (submitLock.current || !name.trim()) return;
    if (![quantity, days, unitPrice, vatRate].every(Number.isFinite) || quantity <= 0 || days <= 0 || unitPrice < 0 || vatRate < 0 || vatRate > 100 || !unit.trim()) {
      setError('Uzupełnij poprawną ilość, jednostkę, dni / kilometry, cenę i VAT.'); return;
    }
    if ((mode === 'warehouse' && !selectedEquipment) || (['product', 'vehicle'].includes(mode) && !selectedCatalog)) return;
    submitLock.current = true; setSubmitting(true); setError('');

    const item: CalcItem = {
      ...initialItem,
      category,
      name: name.trim(),
      description: description.trim(),
      unit,
      quantity,
      unit_price: unitPrice,
      days,
      source: selectedEquipment ? 'warehouse' : selectedCatalog ? mode as 'product' | 'vehicle' : !sourceChanged && initialItem ? initialItem.source : 'manual',
      source_ref: selectedEquipment?.id ?? selectedCatalog?.id ?? (!sourceChanged ? initialItem?.source_ref : null) ?? null,
      source_label: selectedCatalog?.label || null,
      position: initialItem?.position ?? existingCount,
      vat_rate: vatRate,
      editing: false,
      power_watts: powerWatts,
      power_source_ref: selectedEquipment?.id ?? (!sourceChanged ? initialItem?.power_source_ref : null) ?? null,
      weight_kg: selectedEquipment?.weight_kg ?? (!sourceChanged ? initialItem?.weight_kg : null) ?? null,
      thumbnail_url: selectedEquipment?.thumbnail_url ?? (!sourceChanged ? initialItem?.thumbnail_url : null) ?? null,
      stock_quantity: selectedEquipment?.stock_quantity ?? (!sourceChanged ? initialItem?.stock_quantity : null) ?? null,
    };

    try { await onAdd(item); onClose(); }
    catch (e) { setError((e as Error).message || 'Nie udało się zapisać pozycji.'); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search]);

  const currentlyVisible = Math.min(visibleCount, filteredEquipmentAll.length);

  const netTotal = quantity * unitPrice * (days || 1);
  const grossTotal = netTotal * (1 + vatRate / 100);

  const inputClass =
    'w-full rounded-lg border border-white/10 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-white/20 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#1c1f33]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-6 py-4">
          <h3 className="text-lg font-medium text-[#e5e4e2]">{initialItem ? 'Edytuj pozycję' : 'Dodaj pozycję'}</h3>
          <button onClick={close} className="p-1 text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <fieldset disabled={submitting} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {/* Mode Toggle for equipment category */}
          {category === 'equipment' && (
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => {
                  setMode('warehouse'); setSourceChanged(true); setDescription('');
                  setSelectedEquipment(null);
                  setName('');
                }}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors ${
                  mode === 'warehouse'
                    ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                    : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10'
                }`}
              >
                <Package className="h-4 w-4" />Z magazynu
              </button>
              <button
                onClick={() => {
                  setMode('manual'); setSourceChanged(true); setPowerWatts(null);
                  setSelectedEquipment(null);
                  setName('');
                }}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors ${
                  mode === 'manual'
                    ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                    : 'text-[#e5e4e2]/60 hover:bg-[#d3bb73]/10'
                }`}
              >
                Ręcznie
              </button>
            </div>
          )}

          {(category === 'staff' || category === 'transport') && <div className="mb-4 space-y-3">
            <div className="flex gap-2">{(['manual', category === 'staff' ? 'product' : 'vehicle'] as const).map(option => <button key={option} type="button" onClick={() => {
              setMode(option); setSourceChanged(true); setSelectedCatalog(null); setName(''); setDescription(''); setUnitPrice(0); setPowerWatts(null); setSearch('');
            }} className={`rounded-lg px-4 py-2 text-sm ${mode === option ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'bg-white/5 text-white/60'}`}>
              {option === 'manual' ? 'Ręcznie' : option === 'product' ? 'Usługi personelu z katalogu' : 'Pojazdy z bazy'}
            </button>)}</div>
            {mode !== 'manual' && !selectedCatalog && <>
              <input aria-label="Szukaj w katalogu" value={search} onChange={e => setSearch(e.target.value)} placeholder={mode === 'product' ? 'Szukaj usługi personelu…' : 'Szukaj pojazdu…'} className={inputClass} />
              <div className="max-h-64 overflow-y-auto rounded-lg bg-black/15">
                {catalogLoading ? <p className="p-4 text-sm text-white/50">Wczytuję…</p> : !catalog.length ? <p className="p-4 text-sm text-white/50">{mode === 'product' ? 'Brak usług. W karcie produktu zaznacz „Usługa personelu — bez sprzętu”.' : 'Brak dostępnych pojazdów.'}</p> : catalog.filter(option => option.label.toLocaleLowerCase('pl').includes(search.toLocaleLowerCase('pl'))).map(option => <button key={option.id} type="button" className="block w-full p-3 text-left text-sm text-white/80 hover:bg-white/5" onClick={() => {
                  setSelectedCatalog(option); setSourceChanged(true); setName(option.name); setDescription(option.description); setUnitPrice(option.price); setUnit(option.unit); setVatRate(option.vat); setPowerWatts(null);
                }}>{option.label}{mode === 'product' && <span className="ml-2 text-[#d3bb73]">{option.price.toFixed(2)} zł / {option.unit}</span>}</button>)}
              </div>
            </>}
            {selectedCatalog && <div className="rounded-lg bg-black/15 p-3 text-sm text-white/65">
              <p>{mode === 'vehicle' ? 'Pojazd — informacja wewnętrzna: ' : 'Usługa z katalogu: '}{selectedCatalog.label}</p>
              {mode === 'vehicle' && <p className="mt-1 text-xs text-white/45">W kalkulacji dla klienta pojawią się wyłącznie nazwa i opis pozycji poniżej. Wybór pojazdu nie rezerwuje go.</p>}
              <button type="button" className="mt-2 text-[#d3bb73]" onClick={() => { setSelectedCatalog(null); setName(''); }}>Zmień</button>
            </div>}
          </div>}

          {/* Equipment Search (warehouse mode) */}
          {mode === 'warehouse' && !selectedEquipment && (
            <div className="mb-4">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Szukaj sprzętu..."
                  className="w-full rounded-lg border border-white/10 bg-[#0a0d1a] py-2.5 pl-10 pr-4 text-sm text-[#e5e4e2] focus:border-white/20 focus:outline-none"
                />
              </div>

              <div className="max-h-[420px] overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
                {loadingEquipment ? (
                  <div className="py-8 text-center text-sm text-[#e5e4e2]/50">Wczytywanie...</div>
                ) : filteredEquipmentAll.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[#e5e4e2]/50">Brak wyników</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 z-10 bg-[#111827] text-xs uppercase tracking-wider text-[#e5e4e2]/50">
                      <tr>
                        <th className="w-16 px-3 py-3 text-left">Thumb</th>
                        <th className="px-3 py-3 text-left">Nazwa / marka / model</th>
                        <th className="w-32 px-3 py-3 text-right">Cena rentalna</th>
                        <th className="w-32 px-3 py-3 text-right">Pobór prądu</th>
                        <th className="w-32 px-3 py-3 text-right">Stan</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-[#d3bb73]/10">
                      {filteredEquipment.map((eq) => {
                        const alreadyAdded = getAlreadyAddedQuantity(eq.id);
                        const remainingStock = getRemainingStock(eq);

                        return (
                          <tr
                            key={eq.id}
                            onClick={() =>
                              handleSelectEquipment({ ...eq, stock_quantity: remainingStock })
                            }
                            className="cursor-pointer transition-colors hover:bg-[#d3bb73]/10"
                          >
                            <td className="px-3 py-3">
                              {eq.thumbnail_url ? (
                                <Popover
                                  trigger={
                                    <NextImage
                                      src={eq.thumbnail_url}
                                      alt={eq.name}
                                      width={48}
                                      height={48}
                                      className="h-12 w-12 rounded-lg object-cover"
                                    />
                                  }
                                  content={
                                    <NextImage
                                      src={eq.thumbnail_url}
                                      alt={eq.name}
                                      width={300}
                                      height={300}
                                      className="h-auto w-full rounded-lg object-cover"
                                    />
                                  }
                                  openOn="hover"
                                />
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] text-[#e5e4e2]/30">
                                  <Package className="h-4 w-4" />
                                </div>
                              )}
                            </td>

                            <td className="min-w-0 px-3 py-3">
                              <div className="font-medium text-[#e5e4e2]">{eq.name}</div>

                              <div className="mt-0.5 text-xs text-[#e5e4e2]/50">
                                {[eq.brand, eq.model].filter(Boolean).join(' ') || '—'}
                              </div>

                              {eq.category_name && (
                                <div className="mt-1 inline-flex rounded-full bg-[#d3bb73]/10 px-2 py-0.5 text-[10px] text-[#d3bb73]/80">
                                  {eq.category_name}
                                </div>
                              )}
                            </td>

                            <td className="px-3 py-3 text-right text-[#d3bb73]">
                              {eq.rental_price_per_day
                                ? `${Number(eq.rental_price_per_day).toFixed(2)} zł`
                                : '—'}
                            </td>

                            <td className="px-3 py-3 text-right">
                              {eq.power_specs?.power_watts ? (
                                <span className="inline-flex items-center justify-end gap-1 text-amber-400/90">
                                  <Zap className="h-3.5 w-3.5" />
                                  {eq.power_specs.power_watts >= 1000
                                    ? `${(eq.power_specs.power_watts / 1000).toFixed(2)} kW`
                                    : `${eq.power_specs.power_watts} W`}
                                </span>
                              ) : (
                                <span className="text-[#e5e4e2]/40">—</span>
                              )}
                            </td>

                            <td className="px-3 py-3 text-right">
                              <div className="text-xs text-[#e5e4e2]/50">
                                Stan:{' '}
                                <span
                                  className={
                                    eq.stock_quantity > 0 ? 'text-emerald-400' : 'text-red-400'
                                  }
                                >
                                  {eq.stock_quantity}
                                </span>
                              </div>

                              <div className="text-xs text-[#e5e4e2]/50">
                                Pozostało:{' '}
                                <span
                                  className={
                                    remainingStock > 0 ? 'text-emerald-400' : 'text-red-400'
                                  }
                                >
                                  {remainingStock}
                                </span>
                              </div>

                              {alreadyAdded > 0 && (
                                <div className="text-[10px] text-[#d3bb73]">
                                  Dodano: {alreadyAdded}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                {visibleCount < filteredEquipmentAll.length && (
                  <div className="border-t border-[#d3bb73]/10 p-3 text-center">
                    <button data-crm-action="secondary"
                      type="button"
                      onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
                      className="rounded-lg border border-white/10 px-4 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    >
                      Pokaż więcej ({currentlyVisible} / {filteredEquipmentAll.length})
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Selected equipment preview */}
          {mode === 'warehouse' && selectedEquipment && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-white/10 bg-[#0a0d1a] p-3">
              {selectedEquipment.thumbnail_url ? (
                <NextImage
                  src={selectedEquipment.thumbnail_url}
                  alt={selectedEquipment.name}
                  className="h-12 w-12 rounded-lg object-cover"
                  width={48}
                  height={48}
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
                  <Package className="h-5 w-5 text-[#e5e4e2]/30" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[#e5e4e2]">
                  {[selectedEquipment.brand, selectedEquipment.model].filter(Boolean).join(' ') ||
                    selectedEquipment.name}
                </div>
                <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                  {selectedEquipment.name}
                  {selectedEquipment.power_specs?.power_watts && (
                    <span className="flex items-center gap-0.5 text-amber-400/80">
                      <Zap className="h-3 w-3" />
                      {selectedEquipment.power_specs.power_watts}W
                    </span>
                  )}
                  <span className="text-[#e5e4e2]/40">
                    Stan: {selectedEquipment.stock_quantity}
                  </span>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedEquipment(null);
                  setName('');
                  setPowerWatts(null);
                  setUnitPrice(0);
                }}
                className="text-xs text-[#d3bb73] hover:underline"
              >
                Zmien
              </button>
            </div>
          )}

          {/* Form fields */}
          {(mode === 'manual' || selectedEquipment || selectedCatalog) && (
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">Nazwa</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nazwa pozycji..."
                  className={inputClass}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">Opis</label>
                <textarea
                  rows={5}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Opcjonalny opis..."
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">
                    {isTransport ? 'Ilość aut' : 'Ilość'}
                  </label>
                  {stockExceeded && (
                    <div className="mb-1.5 flex items-center gap-1.5 rounded-md bg-orange-500/10 px-2 py-1 text-xs text-orange-400">
                      <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                      Przekroczono stan ({selectedEquipment!.stock_quantity} dostępne)
                    </div>
                  )}
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">Jednostka</label>
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">
                    {isTransport ? 'Odległość (km)' : 'Dni'}
                  </label>
                  <input
                    type="number"
                    step={isTransport ? '1' : '0.5'}
                    min={isTransport ? '0' : '0.5'}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">VAT %</label>
                  <input
                    type="number"
                    step="1"
                    value={vatRate}
                    onChange={(e) => setVatRate(Number(e.target.value))}
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">
                    {isTransport ? 'Stawka za km (netto)' : 'Cena jednostkowa (netto)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    className={inputClass}
                  />
                </div>
                {(category === 'equipment' || category === 'other') && <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm text-[#e5e4e2]/60">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    Pobor mocy (W)
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={powerWatts ?? ''}
                    onChange={(e) => setPowerWatts(e.target.value ? Number(e.target.value) : null)}
                    placeholder="np. 575"
                    className={inputClass}
                  />
                </div>}
              </div>

              {/* Summary preview */}
              {unitPrice > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-[#0a0d1a] px-4 py-3">
                  <div className="text-sm text-[#e5e4e2]/60">
                    {isTransport
                      ? `${quantity} aut x ${unitPrice.toFixed(2)} zł/km x ${days} km`
                      : `${quantity} x ${unitPrice.toFixed(2)} x ${days} dni`}
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-[#e5e4e2]">
                      {netTotal.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN netto
                    </div>
                    <div className="text-xs text-[#d3bb73]">
                      {grossTotal.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} PLN brutto
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </fieldset>

        {error && <p role="alert" className="px-6 py-2 text-sm text-amber-200">{error}</p>}
        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/10 px-6 py-4">
          <button
            onClick={close}
            className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim() || (mode === 'warehouse' && !selectedEquipment) || (['product', 'vehicle'].includes(mode) && !selectedCatalog)}
            className="rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-40"
          >
            {submitting ? 'Zapisuję…' : initialItem ? 'Zapisz zmiany' : 'Dodaj pozycję'}
          </button>
        </div>
      </div>
    </div>
  );
}
