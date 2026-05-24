'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Search, Package, Zap } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { CalcItem, Category } from './EventCalculationsTab';
import { DEFAULT_VAT } from '../helpers/calculations/calculations.helper';

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
  category_name?: string | null;
}

interface Props {
  category: Category;
  existingCount: number;
  onAdd: (item: CalcItem) => void;
  onClose: () => void;
}

export function AddCalculationItemModal({ category, existingCount, onAdd, onClose }: Props) {
  const [mode, setMode] = useState<'warehouse' | 'manual'>(
    category === 'equipment' ? 'warehouse' : 'manual',
  );
  const [search, setSearch] = useState('');
  const [equipmentList, setEquipmentList] = useState<EquipmentOption[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentOption | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState(
    category === 'staff' ? 'h' : category === 'transport' ? 'km' : 'szt.',
  );
  const [days, setDays] = useState(1);
  const [unitPrice, setUnitPrice] = useState(0);
  const [vatRate, setVatRate] = useState(DEFAULT_VAT);
  const [powerWatts, setPowerWatts] = useState<number | null>(null);

  const loadEquipment = useCallback(async () => {
    if (equipmentList.length > 0) return;
    setLoadingEquipment(true);
    const { data } = await supabase
      .from('equipment_items')
      .select(
        'id, name, brand, model, thumbnail_url, rental_price_per_day, power_specs, warehouse_categories(name)',
      )
      .order('name');

    const mapped: EquipmentOption[] = (data ?? []).map((item: any) => ({
      id: item.id,
      name: item.name,
      brand: item.brand,
      model: item.model,
      thumbnail_url: item.thumbnail_url,
      rental_price_per_day: item.rental_price_per_day,
      power_specs: item.power_specs,
      category_name: item.warehouse_categories?.name ?? null,
    }));

    setEquipmentList(mapped);
    setLoadingEquipment(false);
  }, [equipmentList.length]);

  useEffect(() => {
    if (mode === 'warehouse') {
      loadEquipment();
    }
  }, [mode, loadEquipment]);

  const filteredEquipment = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return equipmentList.slice(0, 50);
    return equipmentList
      .filter((e) => {
        const full =
          `${e.name} ${e.brand ?? ''} ${e.model ?? ''} ${e.category_name ?? ''}`.toLowerCase();
        return full.includes(q);
      })
      .slice(0, 50);
  }, [equipmentList, search]);

  const handleSelectEquipment = (eq: EquipmentOption) => {
    setSelectedEquipment(eq);
    const fullName = [eq.brand, eq.model, eq.name].filter(Boolean).join(' ') || eq.name;
    setName(fullName);
    if (eq.rental_price_per_day && Number(eq.rental_price_per_day) > 0) {
      setUnitPrice(Number(eq.rental_price_per_day));
    }
    if (eq.power_specs?.power_watts) {
      setPowerWatts(eq.power_specs.power_watts);
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) return;

    const item: CalcItem = {
      category,
      name: name.trim(),
      description: description.trim(),
      unit,
      quantity,
      unit_price: unitPrice,
      days,
      source: selectedEquipment ? 'warehouse' : 'manual',
      source_ref: selectedEquipment?.id ?? null,
      position: existingCount,
      vat_rate: vatRate,
      editing: false,
      power_watts: powerWatts,
      power_source_ref: selectedEquipment?.id ?? null,
      equipment_item_id: selectedEquipment?.id ?? null,
    };

    onAdd(item);
    onClose();
  };

  const netTotal = quantity * unitPrice * (days || 1);
  const grossTotal = netTotal * (1 + vatRate / 100);

  const inputClass =
    'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-6 py-4">
          <h3 className="text-lg font-medium text-[#e5e4e2]">Dodaj pozycję</h3>
          <button onClick={onClose} className="p-1 text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Mode Toggle for equipment category */}
          {category === 'equipment' && (
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => {
                  setMode('warehouse');
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
                  setMode('manual');
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
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2.5 pl-10 pr-4 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="max-h-64 overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a]">
                {loadingEquipment ? (
                  <div className="py-8 text-center text-sm text-[#e5e4e2]/50">Wczytywanie...</div>
                ) : filteredEquipment.length === 0 ? (
                  <div className="py-8 text-center text-sm text-[#e5e4e2]/50">Brak wyników</div>
                ) : (
                  filteredEquipment.map((eq) => (
                    <button
                      key={eq.id}
                      type="button"
                      onClick={() => handleSelectEquipment(eq)}
                      className="flex w-full items-center gap-3 border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-[#d3bb73]/10"
                    >
                      {eq.thumbnail_url ? (
                        <img
                          src={eq.thumbnail_url}
                          alt={eq.name}
                          className="h-10 w-10 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] text-xs text-[#e5e4e2]/30">
                          <Package className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[#e5e4e2]">
                          {[eq.brand, eq.model].filter(Boolean).join(' ') || eq.name}
                        </div>
                        <div className="flex items-center gap-2">
                          {(eq.brand || eq.model) && (
                            <span className="truncate text-xs text-[#e5e4e2]/50">{eq.name}</span>
                          )}
                          {eq.category_name && (
                            <span className="rounded-full bg-[#d3bb73]/10 px-2 py-0.5 text-[10px] text-[#d3bb73]/80">
                              {eq.category_name}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        {eq.power_specs?.power_watts ? (
                          <div className="flex items-center gap-1 text-xs text-amber-400/80">
                            <Zap className="h-3 w-3" />
                            {eq.power_specs.power_watts}W
                          </div>
                        ) : null}
                        {eq.rental_price_per_day ? (
                          <div className="text-xs text-[#d3bb73]">
                            {Number(eq.rental_price_per_day).toFixed(0)} zl/dzien
                          </div>
                        ) : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Selected equipment preview */}
          {mode === 'warehouse' && selectedEquipment && (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-[#d3bb73]/30 bg-[#0a0d1a] p-3">
              {selectedEquipment.thumbnail_url ? (
                <img
                  src={selectedEquipment.thumbnail_url}
                  alt={selectedEquipment.name}
                  className="h-12 w-12 rounded-lg object-cover"
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
          {(mode === 'manual' || selectedEquipment) && (
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
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Opcjonalny opis..."
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">Ilosc</label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value) || 1)}
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
                  <label className="mb-1.5 block text-sm text-[#e5e4e2]/60">Dni</label>
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value) || 1)}
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
                    Cena jednostkowa (netto)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(Number(e.target.value))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-sm text-[#e5e4e2]/60">
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    Pobor mocy (W)
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={powerWatts ?? ''}
                    onChange={(e) =>
                      setPowerWatts(e.target.value ? Number(e.target.value) : null)
                    }
                    placeholder="np. 575"
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Summary preview */}
              {unitPrice > 0 && (
                <div className="flex items-center justify-between rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3">
                  <div className="text-sm text-[#e5e4e2]/60">
                    {quantity} x {unitPrice.toFixed(2)} x {days} dni
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/10 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#1c1f33] disabled:opacity-40 hover:bg-[#d3bb73]/90"
          >
            Dodaj pozycje
          </button>
        </div>
      </div>
    </div>
  );
}
