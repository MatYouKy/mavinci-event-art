import { useEffect, useMemo, useState } from 'react';
import { ProductEquipment } from '../../types';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  EquipmentCatalogItem,
  useEquipmentCatalog,
} from '@/app/crm/equipment/hooks/useEquipmentCatalog';
import { Package, Wrench, X } from 'lucide-react';
import { useManageProduct } from '../hooks/useManageProduct';

export function AddEquipmentModal({
  productId,
  existingEquipment,
  onClose,
  onSuccess,
}: {
  productId: string;
  existingEquipment: ProductEquipment[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState<'item' | 'kit'>('kit');
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedKitId, setSelectedKitId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [isOptional, setIsOptional] = useState(false);
  const [notes, setNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [kitDetails, setKitDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { showSnackbar } = useSnackbar();

  const { items, isLoading, isFetching, hasMore, loadMore } = useEquipmentCatalog({
    q: searchQuery,
    categoryId: null,
    itemType: mode === 'kit' ? 'kits' : 'equipment',
    showCablesOnly: false,
    limit: 50,
    activeOnly: true,
  });

  const { add } = useManageProduct({ productId });

  const kits = useMemo(() => (items ?? []).filter((x) => x.is_kit === true), [items]);

  const equipmentItems = useMemo(
    () => (items ?? []).filter((x) => x.is_kit === false && !x.is_cable),
    [items],
  );

  useEffect(() => {
    loadMore();
  }, []);

  // const fetchEquipmentItems = async () => {
  //   const { data } = await supabase
  //     .from('equipment_items')
  //     .select('id, name, brand, model, warehouse_categories(name)')
  //     .eq('is_active', true)
  //     .order('name');

  //   if (data) {
  //     const existingItemIds = existingEquipment
  //       .filter((e) => e.equipment_item_id)
  //       .map((e) => e.equipment_item_id);

  //     const availableItems = data.filter((item) => !existingItemIds.includes(item.id));

  //     const itemsWithAvailability = await Promise.all(
  //       availableItems.map(async (item) => {
  //         const { data: availData } = await supabase.rpc('get_available_equipment_quantity', {
  //           p_equipment_id: item.id,
  //         });
  //         return {
  //           ...item,
  //           available_quantity: availData || 0,
  //         };
  //       }),
  //     );
  //     setEquipmentItems(itemsWithAvailability);
  //     setFilteredItems(itemsWithAvailability);
  //   }
  // };

  // const fetchKits = async () => {
  //   const { data } = await supabase
  //     .from('equipment_kits')
  //     .select('id, name, description')
  //     .eq('is_active', true)
  //     .order('name');

  //   if (data) {
  //     const existingKitIds = existingEquipment
  //       .filter((e) => e.equipment_kit_id)
  //       .map((e) => e.equipment_kit_id);

  //     const availableKits = data.filter((kit) => !existingKitIds.includes(kit.id));
  //     setKits(availableKits);
  //   }
  // };

  // const fetchKitDetails = async (kitId: string) => {
  //   const { data } = await supabase
  //     .from('equipment_kit_items')
  //     .select(
  //       `
  //       quantity,
  //       equipment:equipment_items(name, brand, model)
  //     `,
  //     )
  //     .eq('kit_id', kitId)
  //     .order('order_index');
  //   if (data) setKitDetails(data);
  // };

  const handleSubmit = async () => {
    if (mode === 'item' && !selectedItemId) {
      showSnackbar('Wybierz sprzęt', 'error');
      return;
    }
    if (mode === 'kit' && !selectedKitId) {
      showSnackbar('Wybierz pakiet', 'error');
      return;
    }

    setLoading(true);
    try {
      await add(
        mode === 'item'
          ? {
              mode: 'item',
              product_id: productId,
              equipment_item_id: selectedItemId,
              quantity,
              is_optional: isOptional,
              notes: notes || null,
            }
          : {
              mode: 'kit',
              product_id: productId,
              equipment_kit_id: selectedKitId,
              quantity,
              is_optional: isOptional,
              notes: notes || null,
            },
      );

      showSnackbar(mode === 'kit' ? 'Pakiet dodany' : 'Sprzęt dodany', 'success');
      onSuccess();
    } catch (error) {
      console.error('Error adding equipment:', error);
      showSnackbar('Błąd podczas dodawania', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Dodaj sprzęt do produktu</h3>
          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          {/* Mode selection */}
          <div>
            <label className="mb-3 block text-sm text-[#e5e4e2]/60">Wybierz typ</label>
            <div className="flex gap-3">
              <button
                onClick={() => setMode('kit')}
                className={`flex-1 rounded-lg border px-4 py-3 transition-colors ${
                  mode === 'kit'
                    ? 'border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                    : 'border-[#d3bb73]/10 bg-[#0a0d1a] text-[#e5e4e2]/60 hover:border-[#d3bb73]/30'
                }`}
              >
                <Package className="mx-auto mb-1 h-5 w-5" />
                <div className="text-sm font-medium">Pakiet sprzętu</div>
                <div className="text-xs opacity-60">Zestaw gotowych itemów</div>
              </button>
              <button
                onClick={() => setMode('item')}
                className={`flex-1 rounded-lg border px-4 py-3 transition-colors ${
                  mode === 'item'
                    ? 'border-[#d3bb73] bg-[#d3bb73]/20 text-[#d3bb73]'
                    : 'border-[#d3bb73]/10 bg-[#0a0d1a] text-[#e5e4e2]/60 hover:border-[#d3bb73]/30'
                }`}
              >
                <Wrench className="mx-auto mb-1 h-5 w-5" />
                <div className="text-sm font-medium">Pojedynczy sprzęt</div>
                <div className="text-xs opacity-60">Wybierz jeden item</div>
              </button>
            </div>
          </div>

          {/* Kit selection */}
          {mode === 'kit' && (
            <>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wybierz pakiet *</label>
                <select
                  value={selectedKitId}
                  onChange={(e) => setSelectedKitId(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
                >
                  <option value="">-- Wybierz pakiet --</option>
                  {kits.map((kit) => (
                    <option key={kit.id} value={kit.id}>
                      {kit.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Kit details preview */}
              {kitDetails && kitDetails.length > 0 && (
                <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
                  <div className="mb-2 text-sm text-[#e5e4e2]/60">Zawartość pakietu:</div>
                  <div className="space-y-1">
                    {kitDetails.map((item: any, idx: number) => (
                      <div key={idx} className="flex items-center gap-2 text-sm text-[#e5e4e2]">
                        <span className="text-[#d3bb73]">•</span>
                        <span>
                          {item.quantity}x {item.equipment?.name}
                        </span>
                        {item.equipment?.model && (
                          <span className="text-xs text-[#e5e4e2]/60">
                            ({item.equipment.model})
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Item selection */}
          {mode === 'item' && (
            <>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wyszukaj sprzęt</label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Szukaj po nazwie, marce lub modelu..."
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Wybierz sprzęt * ({equipmentItems.length} wyników)
                </label>
                <div className="max-h-60 overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a]">
                  {isLoading ? (
                    <div className="p-4 text-center text-sm text-[#e5e4e2]/60">
                      Ładowanie...
                    </div>
                  ) : equipmentItems.length === 0 ? (
                    <div className="p-4 text-center text-sm text-[#e5e4e2]/60">
                      Brak wyników wyszukiwania
                    </div>
                  ) : (
                    equipmentItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedItemId(item.id)}
                        disabled={(item as any).available_quantity === 0}
                        className={`w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors ${
                          selectedItemId === item.id
                            ? 'bg-[#d3bb73]/20'
                            : (item as any).available_quantity === 0
                              ? 'cursor-not-allowed opacity-50'
                              : 'hover:bg-[#d3bb73]/10'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-medium text-[#e5e4e2]">{item.name}</div>
                          <div
                            className={`rounded px-2 py-0.5 text-xs ${
                              (item as any).available_quantity === 0
                                ? 'bg-red-500/20 text-red-400'
                                : (item.available_quantity as any) < 5
                                  ? 'bg-yellow-500/20 text-yellow-400'
                                  : 'bg-green-500/20 text-green-400'
                            }`}
                          >
                            {(item as any).available_quantity === 0
                              ? 'Brak'
                              : `${item.available_quantity} szt.`}
                          </div>
                        </div>
                        <div className="mt-1 text-xs text-[#e5e4e2]/60">
                          {item.brand && <span>{item.brand} </span>}
                          {item.model && <span>• {item.model} </span>}
                          {item.warehouse_categories?.name && (
                            <span>• {item.warehouse_categories.name}</span>
                          )}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>
          )}

          {/* Quantity */}
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Ilość
              {mode === 'item' &&
                selectedItemId &&
                (() => {
                  const selected = equipmentItems.find((item) => item.id === selectedItemId);
                  return (
                    selected && (
                      <span className="ml-2 text-xs">
                        (dostępne:{' '}
                        <span
                          className={
                            selected.available_quantity < 5 ? 'text-yellow-400' : 'text-green-400'
                          }
                        >
                          {selected.available_quantity} szt.
                        </span>
                        )
                      </span>
                    )
                  );
                })()}
            </label>
            <input
              type="number"
              min="1"
              max={
                mode === 'item' && selectedItemId
                  ? equipmentItems.find((item) => item.id === selectedItemId)?.available_quantity
                  : undefined
              }
              value={quantity}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 1;
                if (mode === 'item' && selectedItemId) {
                  const selected = equipmentItems.find((item) => item.id === selectedItemId);
                  if (selected) {
                    setQuantity(Math.min(val, selected.available_quantity));
                  } else {
                    setQuantity(val);
                  }
                } else {
                  setQuantity(val);
                }
              }}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
            {mode === 'item' &&
              selectedItemId &&
              (() => {
                const selected = equipmentItems.find((item) => item.id === selectedItemId);
                return (
                  selected &&
                  selected.available_quantity < 10 && (
                    <p className="mt-1 text-xs text-yellow-400">
                      ⚠️ Niska dostępność - dostępne tylko {selected.available_quantity} szt.
                    </p>
                  )
                );
              })()}
          </div>

          {/* Optional */}
          <div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isOptional}
                onChange={(e) => setIsOptional(e.target.checked)}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Opcjonalny (można usunąć z oferty)</span>
            </label>
          </div>

          {/* Notes */}
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki (opcjonalnie)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Dodatkowe informacje..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <button
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || (mode === 'item' ? !selectedItemId : !selectedKitId)}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Dodawanie...' : 'Dodaj'}
          </button>
        </div>
      </div>
    </div>
  );
}
