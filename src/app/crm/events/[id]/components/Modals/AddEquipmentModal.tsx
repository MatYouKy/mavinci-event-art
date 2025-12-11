import { useState } from 'react';
import { X } from 'lucide-react';

export function AddEquipmentModal({
  isOpen,
  onClose,
  onAdd,
  availableEquipment,
  availableKits,
}: {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (
    selectedItems: Array<{ id: string; quantity: number; notes: string; type: 'item' | 'kit' }>,
  ) => void;
  availableEquipment: any[];
  availableKits: any[];
}) {
  const [selectedItems, setSelectedItems] = useState<{
    [key: string]: { checked: boolean; quantity: number; notes: string; type: 'item' | 'kit' };
  }>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [showKits, setShowKits] = useState(true);
  const [showItems, setShowItems] = useState(true);

  if (!isOpen) return null;

  const handleToggle = (id: string, type: 'item' | 'kit') => {
    setSelectedItems((prev) => ({
      ...prev,
      [id]: {
        checked: !prev[id]?.checked,
        quantity: prev[id]?.quantity || 1,
        notes: prev[id]?.notes || '',
        type,
      },
    }));
  };

  const handleQuantityChange = (id: string, quantity: number, maxQuantity?: number) => {
    let finalQuantity = Math.max(1, quantity);
    if (maxQuantity !== undefined) {
      finalQuantity = Math.min(finalQuantity, maxQuantity);
    }

    setSelectedItems((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        quantity: finalQuantity,
      },
    }));
  };

  const handleNotesChange = (id: string, notes: string) => {
    setSelectedItems((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        notes,
      },
    }));
  };

  const handleSubmit = () => {
    const selected = Object.entries(selectedItems)
      .filter(([_, value]) => value.checked)
      .map(([id, value]) => ({
        id,
        quantity: value.quantity,
        notes: value.notes,
        type: value.type,
      }));

    if (selected.length === 0) {
      alert('Zaznacz przynajmniej jedną pozycję');
      return;
    }

    // Walidacja - sprawdź czy nie przekraczamy całkowitej dostępności
    for (const item of selected) {
      if (item.type === 'item') {
        const equipmentItem = availableEquipment.find((eq) => eq.id === item.id);
        if (equipmentItem && item.quantity > equipmentItem.total_quantity) {
          alert(
            `Nie można dodać ${item.quantity} jednostek sprzętu "${equipmentItem.name}". Dostępne są tylko ${equipmentItem.total_quantity} jednostek.`,
          );
          return;
        }
      }
    }

    onAdd(selected);
    setSelectedItems({});
    setSearchTerm('');
  };

  const filteredKits = availableKits.filter((kit) =>
    kit.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const filteredItems = availableEquipment.filter(
    (item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.category?.name?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const selectedCount = Object.values(selectedItems).filter((item) => item.checked).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj sprzęt</h2>
            {selectedCount > 0 && (
              <p className="mt-1 text-sm text-[#d3bb73]">Zaznaczono: {selectedCount}</p>
            )}
          </div>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4">
          <input
            type="text"
            placeholder="Szukaj sprzętu lub zestawu..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
        </div>

        <div className="mb-4 flex gap-4">
          <button
            onClick={() => setShowKits(!showKits)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              showKits ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/60'
            }`}
          >
            Zestawy ({availableKits.length})
          </button>
          <button
            onClick={() => setShowItems(!showItems)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              showItems ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#1c1f33] text-[#e5e4e2]/60'
            }`}
          >
            Pojedynczy sprzęt ({availableEquipment.length})
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto pr-2">
          {showKits && filteredKits.length > 0 && (
            <div>
              <h3 className="sticky top-0 mb-3 bg-[#0f1119] py-2 text-sm font-medium text-[#e5e4e2]/80">
                🎁 Zestawy
              </h3>
              <div className="space-y-2">
                {filteredKits.map((kit) => (
                  <div
                    key={kit.id}
                    className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedItems[kit.id]?.checked || false}
                        onChange={() => handleToggle(kit.id, 'kit')}
                        className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-[#e5e4e2]">{kit.name}</div>
                          {kit.available_count !== undefined && (
                            <div className="text-right text-xs">
                              <div className="font-medium text-[#d3bb73]">
                                {kit.available_count > 0 ? 'Dostępny' : 'Niedostępny'}
                              </div>
                            </div>
                          )}
                        </div>
                        {kit.items && kit.items.length > 0 && (
                          <div className="mt-1 text-xs text-[#e5e4e2]/60">
                            Zawiera:{' '}
                            {kit.items
                              .map((item: any) => `${item.equipment.name} (${item.quantity})`)
                              .join(', ')}
                          </div>
                        )}
                      </div>
                    </label>
                    {selectedItems[kit.id]?.checked && (
                      <div className="ml-7 mt-3 space-y-3">
                        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3">
                          <label className="mb-2 block text-xs text-[#e5e4e2]/60">
                            Ilość zestawów
                          </label>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min="1"
                              max={kit.available_count || 1}
                              value={selectedItems[kit.id]?.quantity || 1}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 1;
                                handleQuantityChange(kit.id, val, kit.available_count || 1);
                              }}
                              placeholder="Ilość zestawów"
                              className={`flex-1 rounded-lg border bg-[#1c1f33] px-4 py-2.5 text-base text-[#e5e4e2] focus:outline-none focus:ring-2 ${
                                kit.available_count &&
                                (selectedItems[kit.id]?.quantity || 1) > kit.available_count
                                  ? 'border-red-500 focus:ring-red-500/50'
                                  : 'border-[#d3bb73]/20 focus:ring-[#d3bb73]/50'
                              }`}
                            />
                            <div className="text-right">
                              <div
                                className={`text-sm font-medium ${
                                  kit.available_count &&
                                  (selectedItems[kit.id]?.quantity || 1) > kit.available_count
                                    ? 'text-red-500'
                                    : 'text-[#d3bb73]'
                                }`}
                              >
                                {selectedItems[kit.id]?.quantity || 1} / {kit.available_count || 1}
                              </div>
                              <div className="text-xs text-[#e5e4e2]/40">dostępne</div>
                            </div>
                          </div>
                          {kit.available_count &&
                            (selectedItems[kit.id]?.quantity || 1) > kit.available_count && (
                              <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
                                <span>⚠️</span>
                                <span>Ten zestaw jest już zarezerwowany w tym terminie!</span>
                              </div>
                            )}
                        </div>
                        <input
                          type="text"
                          value={selectedItems[kit.id]?.notes || ''}
                          onChange={(e) => handleNotesChange(kit.id, e.target.value)}
                          placeholder="Notatki (opcjonalnie)"
                          className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showItems && filteredItems.length > 0 && (
            <div>
              <h3 className="sticky top-0 mb-3 bg-[#0f1119] py-2 text-sm font-medium text-[#e5e4e2]/80">
                📦 Pojedynczy sprzęt
              </h3>
              <div className="space-y-2">
                {filteredItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4"
                  >
                    <label className="flex cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedItems[item.id]?.checked || false}
                        onChange={() => handleToggle(item.id, 'item')}
                        className="mt-1 h-4 w-4 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                          {item.available_count !== undefined && (
                            <div className="text-right text-xs">
                              <div className="font-medium text-[#d3bb73]">
                                {item.available_count} dostępne
                              </div>
                              {item.reserved_quantity > 0 && (
                                <div className="text-[#e5e4e2]/40">
                                  {item.reserved_quantity} zarezerwowane
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-[#e5e4e2]/60">
                          {item.category?.name || 'Brak kategorii'}
                        </div>
                      </div>
                    </label>
                    {selectedItems[item.id]?.checked && (
                      <div className="ml-7 mt-3 space-y-3">
                        <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-3">
                          <label className="mb-2 block text-xs text-[#e5e4e2]/60">
                            Ilość jednostek
                          </label>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              min="1"
                              max={item.available_count || undefined}
                              value={selectedItems[item.id]?.quantity || 1}
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 1;
                                handleQuantityChange(
                                  item.id,
                                  val,
                                  item.total_quantity || item.available_count,
                                );
                              }}
                              placeholder="Ilość"
                              className={`flex-1 rounded-lg border bg-[#1c1f33] px-4 py-2.5 text-base text-[#e5e4e2] focus:outline-none focus:ring-2 ${
                                (selectedItems[item.id]?.quantity || 1) > item.total_quantity
                                  ? 'border-red-500 focus:ring-red-500/50'
                                  : item.available_count &&
                                      (selectedItems[item.id]?.quantity || 1) > item.available_count
                                    ? 'border-orange-500 focus:ring-orange-500/50'
                                    : 'border-[#d3bb73]/20 focus:ring-[#d3bb73]/50'
                              }`}
                            />
                            <div className="text-right">
                              <div
                                className={`text-sm font-medium ${
                                  (selectedItems[item.id]?.quantity || 1) > item.total_quantity
                                    ? 'text-red-500'
                                    : item.available_count &&
                                        (selectedItems[item.id]?.quantity || 1) >
                                          item.available_count
                                      ? 'text-orange-500'
                                      : 'text-[#d3bb73]'
                                }`}
                              >
                                {selectedItems[item.id]?.quantity || 1} /{' '}
                                {item.available_count || 0}
                              </div>
                              <div className="text-xs text-[#e5e4e2]/40">dostępne w terminie</div>
                              {item.total_quantity > 0 && (
                                <div className="mt-0.5 text-xs text-[#e5e4e2]/30">
                                  (Całkowita: {item.total_quantity})
                                </div>
                              )}
                            </div>
                          </div>
                          {(selectedItems[item.id]?.quantity || 1) > item.total_quantity && (
                            <div className="mt-2 flex items-center gap-2 text-xs text-red-500">
                              <span>⚠️</span>
                              <span>
                                Przekroczono całkowitą ilość! Mamy tylko {item.total_quantity}{' '}
                                jednostek tego sprzętu.
                              </span>
                            </div>
                          )}
                          {(selectedItems[item.id]?.quantity || 1) <= item.total_quantity &&
                            item.available_count &&
                            (selectedItems[item.id]?.quantity || 1) > item.available_count && (
                              <div className="mt-2 flex items-center gap-2 text-xs text-orange-500">
                                <span>⚠️</span>
                                <span>
                                  W tym terminie dostępne są tylko {item.available_count} jednostek.{' '}
                                  {item.reserved_quantity} jest zarezerwowanych w innych
                                  wydarzeniach.
                                </span>
                              </div>
                            )}
                          {item.reserved_quantity > 0 && (
                            <div className="mt-2 text-xs text-[#e5e4e2]/40">
                              ℹ️ W tym terminie zarezerwowano już {item.reserved_quantity} jednostek
                              w innych wydarzeniach
                            </div>
                          )}
                        </div>
                        <input
                          type="text"
                          value={selectedItems[item.id]?.notes || ''}
                          onChange={(e) => handleNotesChange(item.id, e.target.value)}
                          placeholder="Notatki (opcjonalnie)"
                          className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2]"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {filteredKits.length === 0 && filteredItems.length === 0 && (
            <div className="py-12 text-center text-[#e5e4e2]/60">Nie znaleziono sprzętu</div>
          )}
        </div>

        <div className="mt-4 flex gap-3 border-t border-[#d3bb73]/10 pt-4">
          <button
            onClick={handleSubmit}
            disabled={selectedCount === 0}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Dodaj zaznaczone ({selectedCount})
          </button>
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33]"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}