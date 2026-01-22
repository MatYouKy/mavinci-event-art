'use client';

import { Plus, Trash2, Wrench, Users } from 'lucide-react';

interface OfferItem {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  description?: string;
}

interface CustomItem {
  name: string;
  description: string;
  quantity: number;
  unit_price: number;
}

interface OfferStep4Props {
  showCustomItemForm: boolean;
  setShowCustomItemForm: (value: boolean) => void;
  showEquipmentSelector: boolean;
  setShowEquipmentSelector: (value: boolean) => void;
  showSubcontractorSelector: boolean;
  setShowSubcontractorSelector: (value: boolean) => void;
  equipmentList: any[];
  subcontractors: any[];
  addCustomItem: () => void;
  updateOfferItem: (itemId: string, field: string, value: any) => void;
  removeOfferItem: (itemId: string) => void;
  calculateTotal: () => number;
  customItem: CustomItem;
  offerItems: OfferItem[];
  setCustomItem: (item: CustomItem) => void;
}

export default function OfferStep4({
  showCustomItemForm,
  setShowCustomItemForm,
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
  customItem,
  offerItems,
  setCustomItem,
}: OfferStep4Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Pozycje oferty</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setShowCustomItemForm(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj pozycję
          </button>
          <button
            onClick={() => setShowEquipmentSelector(true)}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#1c1f33]/80"
          >
            <Wrench className="h-4 w-4" />
            Sprzęt
          </button>
          <button
            onClick={() => setShowSubcontractorSelector(true)}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#1c1f33]/80"
          >
            <Users className="h-4 w-4" />
            Podwykonawcy
          </button>
        </div>
      </div>

      {/* Custom Item Form */}
      {showCustomItemForm && (
        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
          <h4 className="mb-3 text-sm font-medium text-[#e5e4e2]">Nowa pozycja</h4>
          <div className="grid grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Nazwa"
              value={customItem.name}
              onChange={(e) => setCustomItem({ ...customItem, name: e.target.value })}
              className="col-span-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
            <input
              type="text"
              placeholder="Opis"
              value={customItem.description}
              onChange={(e) => setCustomItem({ ...customItem, description: e.target.value })}
              className="col-span-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
            <input
              type="number"
              placeholder="Ilość"
              value={customItem.quantity}
              onChange={(e) =>
                setCustomItem({ ...customItem, quantity: parseFloat(e.target.value) || 0 })
              }
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
            <input
              type="number"
              placeholder="Cena jednostkowa"
              value={customItem.unit_price}
              onChange={(e) =>
                setCustomItem({ ...customItem, unit_price: parseFloat(e.target.value) || 0 })
              }
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              onClick={addCustomItem}
              className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
            >
              Dodaj
            </button>
            <button
              onClick={() => setShowCustomItemForm(false)}
              className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#1c1f33]/80"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      {/* Offer Items List */}
      <div className="space-y-2">
        {offerItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[#d3bb73]/20 bg-[#1c1f33]/50 p-8 text-center">
            <p className="text-[#e5e4e2]/60">Brak pozycji w ofercie. Dodaj pierwszą pozycję.</p>
          </div>
        ) : (
          offerItems.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h4 className="font-medium text-[#e5e4e2]">{item.name}</h4>
                  {item.description && (
                    <p className="mt-1 text-sm text-[#e5e4e2]/60">{item.description}</p>
                  )}
                  <div className="mt-2 flex items-center gap-4 text-sm text-[#e5e4e2]/80">
                    <span>
                      Ilość: {item.quantity} × {item.unit_price.toFixed(2)} zł
                    </span>
                    <span className="font-medium text-[#d3bb73]">
                      = {item.total.toFixed(2)} zł
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => removeOfferItem(item.id)}
                  className="rounded-lg p-2 text-red-400 hover:bg-red-500/10"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Total */}
      {offerItems.length > 0 && (
        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
          <div className="flex items-center justify-between">
            <span className="text-lg font-medium text-[#e5e4e2]">Suma całkowita:</span>
            <span className="text-2xl font-bold text-[#d3bb73]">
              {calculateTotal().toFixed(2)} zł
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
