'use client';

import { IOfferItem, IOfferWizardCustomItem } from '@/app/crm/offers/types';
import {
  Plus,
  Trash2,
  ShoppingCart,
  AlertTriangle,
  Wrench,
  Users,
  ChevronDown,
  ChevronRight,
  Package,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface EquipmentItem {
  id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
}

interface Subcontractor {
  id: string;
  contact_person?: string | null;
  company_name?: string | null;
  specialization?: string[] | null;
}

interface ProductEquipment {
  equipment_item_id?: string;
  kit_id?: string;
  quantity: number;
  is_optional?: boolean;
  equipment_items?: {
    id: string;
    name: string;
    brand?: string;
    model?: string;
    thumbnail_url?: string;
  };
  cables?: {
    id: string;
    name: string;
    length_meters?: number;
    thumbnail_url?: string;
  };
  equipment_kits?: {
    id: string;
    name: string;
    thumbnail_url?: string;
  };
}

interface OfferStep4Props {
  offerItems: IOfferItem[];

  showCustomItemForm: boolean;
  setShowCustomItemForm: (v: boolean) => void;

  customItem: IOfferWizardCustomItem;
  setCustomItem: (v: IOfferWizardCustomItem) => void;

  showEquipmentSelector: boolean;
  setShowEquipmentSelector: (v: boolean) => void;

  showSubcontractorSelector: boolean;
  setShowSubcontractorSelector: (v: boolean) => void;

  equipmentList: EquipmentItem[];
  subcontractors: Subcontractor[];

  addCustomItem: () => void;
  updateOfferItem: (id: string, updates: Partial<IOfferItem>) => void;
  removeOfferItem: (id: string) => void;

  calculateTotal: () => number;
} 

export default function OfferStep4({
  offerItems,
  showCustomItemForm,
  setShowCustomItemForm,
  customItem,
  setCustomItem,
  showEquipmentSelector,
  setShowEquipmentSelector,
  showSubcontractorSelector,
  setShowSubcontractorSelector,
  equipmentList,
  subcontractors,
  addCustomItem,
  updateOfferItem,
  removeOfferItem,
  calculateTotal,
}: OfferStep4Props) {
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const [productEquipment, setProductEquipment] = useState<Record<string, ProductEquipment[]>>({});

  useEffect(() => {
    const fetchProductEquipment = async () => {
      const productIds = offerItems
        .filter((item) => item.product_id)
        .map((item) => item.product_id);

      if (productIds.length === 0) return;

      const { data, error } = await supabase
        .from('offer_product_equipment')
        .select(
          `
          equipment_item_id,
          kit_id,
          quantity,
          is_optional,
          product_id,
          equipment_items:equipment_item_id(id, name, brand, model, thumbnail_url),
          equipment_kits:kit_id(id, name, thumbnail_url)
        `
        )
        .in('product_id', productIds);

      if (error) {
        console.error('Error fetching product equipment:', error);
        return;
      }

      const equipmentByProduct: Record<string, ProductEquipment[]> = {};
      data?.forEach((eq: any) => {
        if (!equipmentByProduct[eq.product_id]) {
          equipmentByProduct[eq.product_id] = [];
        }
        equipmentByProduct[eq.product_id].push(eq);
      });

      setProductEquipment(equipmentByProduct);
    };

    fetchProductEquipment();
  }, [offerItems]);

  const toggleExpand = (itemId: string) => {
    setExpandedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Pozycje oferty</h3>
        <button
          onClick={() => setShowCustomItemForm(true)}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
        >
          <Plus className="h-4 w-4" />
          <span>Dodaj niestandardową pozycję</span>
        </button>
      </div>

      {/* Custom Item Form */}
      {showCustomItemForm && (
        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
          <h4 className="mb-4 text-sm font-medium text-[#e5e4e2]">
            Niestandardowa pozycja
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa *</label>
              <input
                type="text"
                value={customItem.name}
                onChange={(e) => setCustomItem({ ...customItem, name: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder="np. Pokaz iskier"
              />
            </div>
            <div className="col-span-2">
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
              <textarea
                value={customItem.description}
                onChange={(e) => setCustomItem({ ...customItem, description: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                rows={2}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ilość *</label>
              <input
                type="number"
                value={customItem.quantity}
                onChange={(e) =>
                  setCustomItem({ ...customItem, quantity: parseInt(e.target.value) || 1 })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                min="1"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Jednostka</label>
              <input
                type="text"
                value={customItem.unit}
                onChange={(e) => setCustomItem({ ...customItem, unit: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                Cena jedn. (zł) *
              </label>
              <input
                type="number"
                value={customItem.unit_price}
                onChange={(e) =>
                  setCustomItem({
                    ...customItem,
                    unit_price: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                min="0"
                step="0.01"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Rabat (%)</label>
              <input
                type="number"
                value={customItem.discount_percent}
                onChange={(e) =>
                  setCustomItem({
                    ...customItem,
                    discount_percent: parseFloat(e.target.value) || 0,
                  })
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                min="0"
                max="100"
                step="0.01"
              />
            </div>
          </div>

          {/* Equipment and Subcontractor Selection */}
          <div className="mt-4 space-y-3 border-t border-[#d3bb73]/20 pt-4">
            <div className="flex items-center justify-between">
              <h5 className="text-sm font-medium text-[#e5e4e2]">Realizacja</h5>
            </div>

            {/* Equipment Selector Button */}
            <button
              type="button"
              onClick={() => setShowEquipmentSelector(!showEquipmentSelector)}
              className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 transition-colors ${
                customItem.equipment_ids.length > 0
                  ? 'border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                  : 'border-[#d3bb73]/20 text-[#e5e4e2]/60 hover:border-[#d3bb73]/40'
              }`}
            >
              <Wrench className="h-4 w-4" />
              <span className="text-sm">
                Sprzęt{' '}
                {customItem.equipment_ids.length > 0 && `(${customItem.equipment_ids.length})`}
              </span>
            </button>

            {/* Subcontractor Checkbox */}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={customItem.needs_subcontractor}
                onChange={(e) => {
                  setCustomItem({
                    ...customItem,
                    needs_subcontractor: e.target.checked,
                    subcontractor_id: e.target.checked ? customItem.subcontractor_id : '',
                  });
                  if (!e.target.checked) {
                    setShowSubcontractorSelector(false);
                  }
                }}
                className="rounded border-[#d3bb73]/20"
              />
              <span className="text-sm text-[#e5e4e2]">Wymaga podwykonawcy</span>
              {customItem.needs_subcontractor && !customItem.subcontractor_id && (
                <div className="ml-auto flex items-center gap-1 text-xs text-orange-400">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Niekompletne</span>
                </div>
              )}
            </label>

            {/* Subcontractor Selector - only show if checkbox is checked */}
            {customItem.needs_subcontractor && (
              <button
                type="button"
                onClick={() => setShowSubcontractorSelector(!showSubcontractorSelector)}
                className={`flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2 transition-colors ${
                  customItem.subcontractor_id
                    ? 'border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                    : 'border-[#d3bb73]/20 text-[#e5e4e2]/60 hover:border-[#d3bb73]/40'
                }`}
              >
                <Users className="h-4 w-4" />
                <span className="text-sm">
                  {customItem.subcontractor_id ? 'Zmień podwykonawcę' : 'Wybierz podwykonawcę'}
                </span>
              </button>
            )}

            {/* Equipment Selector */}
            {showEquipmentSelector && (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3">
                {equipmentList.length === 0 ? (
                  <div className="py-4 text-center text-sm text-[#e5e4e2]/40">
                    Brak dostępnego sprzętu
                  </div>
                ) : (
                  <div className="space-y-2">
                    {equipmentList.map((equipment) => (
                      <label
                        key={equipment.id}
                        className="flex cursor-pointer items-center gap-2 rounded p-2 hover:bg-[#1c1f33]"
                      >
                        <input
                          type="checkbox"
                          checked={customItem.equipment_ids.includes(equipment.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setCustomItem({
                                ...customItem,
                                equipment_ids: [...customItem.equipment_ids, equipment.id],
                              });
                            } else {
                              setCustomItem({
                                ...customItem,
                                equipment_ids: customItem.equipment_ids.filter((id) => id !== equipment.id),
                              });
                            }
                          }}
                          className="rounded border-[#d3bb73]/20"
                        />
                        <div className="flex flex-col">
                          <span className="text-sm text-[#e5e4e2]">{equipment.name}</span>
                          <div className="text-xs text-[#e5e4e2]/40">
                            {equipment.brand && <span>{equipment.brand}</span>}
                            {equipment.brand && equipment.model && <span> • </span>}
                            {equipment.model && <span>{equipment.model}</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Subcontractor Selector */}
            {showSubcontractorSelector && (
              <div className="space-y-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3">
                {subcontractors.length === 0 ? (
                  <div className="py-4 text-center text-sm text-[#e5e4e2]/40">
                    Brak dostępnych podwykonawców
                  </div>
                ) : (
                  <>
                    {/* Option to clear selection */}
                    {customItem.subcontractor_id && (
                      <label className="flex cursor-pointer items-start gap-2 rounded border-b border-[#d3bb73]/10 p-2 hover:bg-[#1c1f33]">
                        <input
                          type="radio"
                          name="subcontractor"
                          checked={!customItem.subcontractor_id}
                          onChange={() => {
                            setCustomItem({
                              ...customItem,
                              subcontractor_id: '',
                              needs_subcontractor: true,
                            });
                          }}
                          className="mt-1"
                        />
                        <div>
                          <div className="text-sm italic text-[#e5e4e2]/60">Brak (uzupełnij później)</div>
                        </div>
                      </label>
                    )}

                    {subcontractors.map((sub) => (
                      <label
                        key={sub.id}
                        className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-[#1c1f33]"
                      >
                        <input
                          type="radio"
                          name="subcontractor"
                          checked={customItem.subcontractor_id === sub.id}
                          onChange={() => {
                            setCustomItem({
                              ...customItem,
                              subcontractor_id: sub.id,
                              needs_subcontractor: false,
                            });
                          }}
                          className="mt-1"
                        />
                        <div>
                          <div className="text-sm text-[#e5e4e2]">
                            {sub.company_name || sub.contact_person}
                          </div>
                          {sub.contact_person && sub.company_name && (
                            <div className="text-xs text-[#e5e4e2]/60">{sub.contact_person}</div>
                          )}
                          {sub.specialization &&
                            Array.isArray(sub.specialization) &&
                            sub.specialization.length > 0 && (
                              <div className="text-xs text-[#d3bb73]/60">
                                {sub.specialization.join(', ')}
                              </div>
                            )}
                        </div>
                      </label>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={addCustomItem}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={() => {
                setShowCustomItemForm(false);
                setShowEquipmentSelector(false);
                setShowSubcontractorSelector(false);
              }}
              className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Offer Items Table */}
      <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33]">
        <table className="w-full">
          <thead className="bg-[#0f1119]">
            <tr>
              <th className="px-4 py-3 text-left text-sm text-[#e5e4e2]/60">Nazwa</th>
              <th className="px-4 py-3 text-center text-sm text-[#e5e4e2]/60">Ilość</th>
              <th className="px-4 py-3 text-center text-sm text-[#e5e4e2]/60">Jedn.</th>
              <th className="px-4 py-3 text-right text-sm text-[#e5e4e2]/60">Cena jedn.</th>
              <th className="px-4 py-3 text-right text-sm text-[#e5e4e2]/60">Rabat</th>
              <th className="px-4 py-3 text-right text-sm text-[#e5e4e2]/60">Wartość</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {offerItems.map((item) => {
              const hasProductEquipment =
                item.product_id && productEquipment[item.product_id]?.length > 0;
              const isExpanded = expandedItems[item.id];

              return (
                <>
                  <tr key={item.id} className="border-t border-[#d3bb73]/10">
                    <td className="px-4 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          {hasProductEquipment && (
                            <button
                              onClick={() => toggleExpand(item.id)}
                              className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          )}
                          <span className="font-medium text-[#e5e4e2]">{item.name}</span>
                          {item.needs_subcontractor && (
                            <div
                              className="flex items-center gap-1 rounded bg-orange-500/20 px-2 py-0.5 text-xs text-orange-400"
                              title="Wymaga uzupełnienia podwykonawcy"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              <span>Niekompletne</span>
                            </div>
                          )}
                          {hasProductEquipment && (
                            <div
                              className="flex items-center gap-1 text-xs text-[#d3bb73]"
                              title="Ma przypisany sprzęt z produktu"
                            >
                              <Wrench className="h-3 w-3" />
                              <span>
                                {productEquipment[item.product_id].length} poz.
                              </span>
                            </div>
                          )}
                          {item.equipment_ids && item.equipment_ids.length > 0 && !hasProductEquipment && (
                            <div
                              className="flex items-center gap-1 text-xs text-[#d3bb73]/60"
                              title="Ma przypisany sprzęt"
                            >
                              <Wrench className="h-3 w-3" />
                            </div>
                          )}
                          {item.subcontractor_id && (
                            <div
                              className="flex items-center gap-1 text-xs text-blue-400/60"
                              title="Ma przypisanego podwykonawcę"
                            >
                              <Users className="h-3 w-3" />
                            </div>
                          )}
                        </div>
                        {item.description && (
                          <div className="text-xs text-[#e5e4e2]/60">{item.description}</div>
                        )}
                      </div>
                    </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={item.quantity}
                    onChange={(e) =>
                      updateOfferItem(item.id, { quantity: parseInt(e.target.value) || 1 })
                    }
                    className="w-20 rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-center text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    min="1"
                  />
                </td>
                <td className="px-4 py-3 text-center text-[#e5e4e2]/60">{item.unit}</td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={item.unit_price}
                    onChange={(e) =>
                      updateOfferItem(item.id, {
                        unit_price: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-24 rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-right text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    min="0"
                    step="0.01"
                  />
                </td>
                <td className="px-4 py-3">
                  <input
                    type="number"
                    value={item.discount_percent}
                    onChange={(e) =>
                      updateOfferItem(item.id, {
                        discount_percent: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-20 rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-right text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    min="0"
                    max="100"
                    step="0.01"
                  />
                </td>
                    <td className="px-4 py-3 text-right font-medium text-[#d3bb73]">
                      {item.subtotal.toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => removeOfferItem(item.id)}
                        className="rounded p-1 text-red-400 hover:bg-red-500/20"
                        title="Usuń"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>

                  {/* Equipment Details Row */}
                  {isExpanded && hasProductEquipment && (
                    <tr className="bg-[#0f1119]">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="ml-8 space-y-2">
                          <div className="mb-2 text-sm font-medium text-[#e5e4e2]/80">
                            Sprzęt przypisany do produktu:
                          </div>
                          <div className="space-y-2">
                            {productEquipment[item.product_id].map((eq, idx) => {
                              const equipment = eq.equipment_items;
                              const cable = eq.cables;
                              const kit = eq.equipment_kits;
                              const displayItem = equipment || cable || kit;

                              return (
                                <div
                                  key={idx}
                                  className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3"
                                >
                                  {displayItem?.thumbnail_url ? (
                                    <img
                                      src={displayItem.thumbnail_url}
                                      alt={displayItem.name}
                                      className="h-10 w-10 rounded object-cover"
                                    />
                                  ) : (
                                    <div className="flex h-10 w-10 items-center justify-center rounded bg-[#0f1119]">
                                      <Package className="h-5 w-5 text-[#e5e4e2]/40" />
                                    </div>
                                  )}
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-[#e5e4e2]">
                                        {displayItem?.name || 'Nieznany element'}
                                      </span>
                                      {cable && (
                                        <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                                          Przewód
                                        </span>
                                      )}
                                      {kit && (
                                        <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                                          Zestaw
                                        </span>
                                      )}
                                      {eq.is_optional && (
                                        <span className="rounded bg-orange-500/20 px-2 py-0.5 text-xs text-orange-400">
                                          Opcjonalny
                                        </span>
                                      )}
                                    </div>
                                    {equipment?.brand && (
                                      <div className="text-xs text-[#e5e4e2]/60">
                                        {equipment.brand}
                                        {equipment.model && ` ${equipment.model}`}
                                      </div>
                                    )}
                                    {cable?.length_meters && (
                                      <div className="text-xs text-[#e5e4e2]/60">
                                        {cable.length_meters}m
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <div className="text-sm font-medium text-[#d3bb73]">
                                      x{eq.quantity * item.quantity}
                                    </div>
                                    <div className="text-xs text-[#e5e4e2]/40">
                                      {eq.quantity} na jednostkę
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-[#d3bb73]/30 bg-[#0f1119]">
            <tr>
              <td colSpan={5} className="px-4 py-4 text-right font-medium text-[#e5e4e2]">
                Razem:
              </td>
              <td className="px-4 py-4 text-right text-xl font-medium text-[#d3bb73]">
                {calculateTotal().toLocaleString('pl-PL', { minimumFractionDigits: 2 })} zł
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {offerItems.length === 0 && (
        <div className="py-12 text-center">
          <ShoppingCart className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="text-[#e5e4e2]/60">
            Brak pozycji w ofercie. Wróć do kroku 2 aby dodać produkty z katalogu.
          </p>
        </div>
      )}
    </div>
  );
}