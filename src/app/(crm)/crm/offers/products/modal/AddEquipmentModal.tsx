import { useEffect, useMemo, useState } from 'react';
import { ProductEquipment } from '../../types';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  EquipmentCatalogItem,
  useEquipmentCatalog,
} from '@/app/(crm)/crm/equipment/hooks/useEquipmentCatalog';
import { Package, Search, Wrench, X } from 'lucide-react';
import { useManageProduct } from '../hooks/useManageProduct';
import { useKitByIdLazy } from '@/app/(crm)/crm/equipment/hooks/useKitByIdLazy';
import Popover from '@/components/UI/Tooltip';
import Image from 'next/image';

type EquipmentType = 'item' | 'kit';

type SelectedEquipment = {
  id: string;
  type: EquipmentType;
};

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
  const [showItems, setShowItems] = useState(true);
  const [showKits, setShowKits] = useState(true);
  const [selected, setSelected] = useState<SelectedEquipment | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [isOptional, setIsOptional] = useState(false);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const { showSnackbar } = useSnackbar();
  const { add } = useManageProduct({ productId });
  const { loadKit, kit: selectedKit, loading: kitLoading } = useKitByIdLazy();

  const { items, isLoading, loadMore } = useEquipmentCatalog({
    q: searchQuery,
    categoryId: null,
    itemType: 'all',
    showCablesOnly: false,
    limit: 500,
    activeOnly: true,
  });

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existingKitIds = useMemo(
    () =>
      new Set(
        existingEquipment
          .map((entry) => entry.equipment_kit_id)
          .filter((id): id is string => Boolean(id)),
      ),
    [existingEquipment],
  );

  const existingItemIds = useMemo(
    () =>
      new Set(
        existingEquipment
          .map((entry) => entry.equipment_item_id)
          .filter((id): id is string => Boolean(id)),
      ),
    [existingEquipment],
  );

  const selectableEquipment = useMemo<EquipmentCatalogItem[]>(() => {
    return (items ?? []).filter((entry) => {
      if (entry.is_cable) return false;

      if (entry.is_kit) {
        return !existingKitIds.has(entry.id);
      }

      return !existingItemIds.has(entry.id);
    });
  }, [items, existingItemIds, existingKitIds]);

  const itemCount = useMemo(
    () => selectableEquipment.filter((entry) => !entry.is_kit).length,
    [selectableEquipment],
  );

  const kitCount = useMemo(
    () => selectableEquipment.filter((entry) => entry.is_kit).length,
    [selectableEquipment],
  );

  const visibleEquipment = useMemo(() => {
    return selectableEquipment
      .filter((entry) => (entry.is_kit ? showKits : showItems))
      .sort((first, second) => {
        if (Boolean(first.is_kit) !== Boolean(second.is_kit)) {
          return first.is_kit ? 1 : -1;
        }
        return first.name.localeCompare(second.name, 'pl');
      });
  }, [selectableEquipment, showItems, showKits]);

  const selectedEquipment = useMemo(
    () => visibleEquipment.find((entry) => entry.id === selected?.id) ?? null,
    [visibleEquipment, selected],
  );

  useEffect(() => {
    if (selected?.type === 'kit') {
      loadKit(selected.id);
    }
  }, [selected, loadKit]);

  const handleItemsFilter = (checked: boolean) => {
    setShowItems(checked);
    if (!checked && selected?.type === 'item') {
      setSelected(null);
    }
  };

  const handleKitsFilter = (checked: boolean) => {
    setShowKits(checked);
    if (!checked && selected?.type === 'kit') {
      setSelected(null);
    }
  };

  const handleSubmit = async () => {
    if (!selected || !selectedEquipment) {
      showSnackbar('Wybierz sprzęt lub zestaw', 'error');
      return;
    }

    setLoading(true);
    try {
      if (selected.type === 'item') {
        await add({
          mode: 'item',
          product_id: productId,
          equipment_item_id: selected.id,
          quantity,
          is_optional: isOptional,
          notes: notes || null,
        });
      } else {
        await add({
          mode: 'kit',
          product_id: productId,
          equipment_kit_id: selected.id,
          quantity,
          is_optional: isOptional,
          notes: notes || null,
        });
      }

      showSnackbar(selected.type === 'kit' ? 'Zestaw dodany' : 'Sprzęt dodany', 'success');
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
          <button
            type="button"
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div>
            <label className="mb-3 block text-sm text-[#e5e4e2]/60">Pokaż w katalogu</label>
            <div className="flex flex-wrap gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-4 py-2.5 text-sm text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/30">
                <input
                  type="checkbox"
                  checked={showItems}
                  onChange={(event) => handleItemsFilter(event.target.checked)}
                  className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]"
                />
                <Wrench className="h-4 w-4 text-[#d3bb73]" />
                <span>Pojedynczy sprzęt ({itemCount})</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73]/15 bg-[#0a0d1a] px-4 py-2.5 text-sm text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/30">
                <input
                  type="checkbox"
                  checked={showKits}
                  onChange={(event) => handleKitsFilter(event.target.checked)}
                  className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]"
                />
                <Package className="h-4 w-4 text-[#d3bb73]" />
                <span>Zestawy ({kitCount})</span>
              </label>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wyszukaj sprzęt</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSelected(null);
                }}
                placeholder="Szukaj po nazwie, marce lub modelu..."
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-9 pr-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Wybierz sprzęt lub zestaw * ({visibleEquipment.length} wyników)
            </label>

            <div className="max-h-72 overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a]">
              {isLoading ? (
                <div className="p-4 text-center text-sm text-[#e5e4e2]/60">Ładowanie...</div>
              ) : !showItems && !showKits ? (
                <div className="p-4 text-center text-sm text-[#e5e4e2]/60">
                  Zaznacz przynajmniej jeden typ sprzętu
                </div>
              ) : visibleEquipment.length === 0 ? (
                <div className="p-4 text-center text-sm text-[#e5e4e2]/60">
                  Brak wyników lub wszystkie elementy są już dodane
                </div>
              ) : (
                visibleEquipment.map((entry) => {
                  const type: EquipmentType = entry.is_kit ? 'kit' : 'item';
                  const isSelected = selected?.id === entry.id && selected.type === type;
                  const availableQuantity = entry.available_quantity ?? 0;
                  const isUnavailable = !entry.is_kit && availableQuantity === 0;

                  const availabilityClass =
                    availableQuantity === 0
                      ? 'border-red-500/30 bg-red-500/20 text-red-400'
                      : availableQuantity < 5
                        ? 'border-yellow-500/30 bg-yellow-500/20 text-yellow-400'
                        : 'border-green-500/30 bg-green-500/20 text-green-400';

                  return (
                    <button
                      key={`${type}-${entry.id}`}
                      type="button"
                      onClick={() => setSelected({ id: entry.id, type })}
                      disabled={isUnavailable}
                      className={`w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors last:border-b-0 ${
                        isSelected
                          ? 'bg-[#d3bb73]/20'
                          : isUnavailable
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:bg-[#d3bb73]/10'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Thumb
                          src={entry.thumbnail_url}
                          alt={entry.name}
                          isKitBadge={Boolean(entry.is_kit)}
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[#e5e4e2]">{entry.name}</div>

                              {!entry.is_kit && (
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#e5e4e2]/60">
                                  {(entry.brand || entry.model) && (
                                    <span className="truncate">
                                      {entry.brand ?? ''}
                                      {entry.model ? ` • ${entry.model}` : ''}
                                    </span>
                                  )}
                                  {entry.warehouse_categories?.name && (
                                    <span className="truncate">
                                      • {entry.warehouse_categories.name}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {entry.is_kit ? (
                              <div className="shrink-0 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-0.5 text-[11px] text-[#d3bb73]">
                                ZESTAW
                              </div>
                            ) : (
                              <div
                                className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${availabilityClass}`}
                              >
                                {availableQuantity === 0 ? 'Brak' : `${availableQuantity} szt.`}
                              </div>
                            )}
                          </div>

                          {!!entry.description && (
                            <div className="mt-1 line-clamp-2 text-xs text-[#e5e4e2]/50">
                              {entry.description}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {selected?.type === 'kit' && (
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
              <div className="mb-2 text-sm text-[#e5e4e2]/60">Zawartość zestawu:</div>

              {kitLoading ? (
                <div className="text-sm text-[#e5e4e2]/60">Ładowanie zawartości...</div>
              ) : selectedKit?.equipment_kit_items?.length ? (
                <div className="space-y-1">
                  {selectedKit.equipment_kit_items.map((kitItem, index) => (
                    <div
                      key={`${selected.id}-${index}`}
                      className="flex items-center gap-2 text-sm text-[#e5e4e2]"
                    >
                      <span className="text-[#d3bb73]">•</span>
                      <span>
                        {kitItem.quantity}x{' '}
                        {kitItem.equipment_items?.name ||
                          kitItem.cables?.name ||
                          'Nieznany element'}
                      </span>
                      {kitItem.equipment_items?.model && (
                        <span className="text-xs text-[#e5e4e2]/60">
                          ({kitItem.equipment_items.model})
                        </span>
                      )}
                      {kitItem.cables?.length_meters && (
                        <span className="text-xs text-[#e5e4e2]/60">
                          ({kitItem.cables.length_meters}m)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-[#e5e4e2]/60">Brak danych o zawartości.</div>
              )}
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ilość</label>
            <input
              type="number"
              min={1}
              value={quantity}
              onChange={(event) => {
                const nextQuantity = Number(event.target.value);
                setQuantity(Number.isFinite(nextQuantity) && nextQuantity >= 1 ? nextQuantity : 1);
              }}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          <div>
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={isOptional}
                onChange={(event) => setIsOptional(event.target.checked)}
                className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0a0d1a] text-[#d3bb73] focus:ring-[#d3bb73]"
              />
              <span className="text-sm text-[#e5e4e2]">Opcjonalny (można usunąć z oferty)</span>
            </label>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Notatki (opcjonalnie)</label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Dodatkowe informacje..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
          >
            Anuluj
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !selectedEquipment}
            className="rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Dodawanie...' : 'Dodaj'}
          </button>
        </div>
      </div>
    </div>
  );
}

const Thumb = ({
  src,
  alt,
  isKitBadge = false,
}: {
  src?: string | null;
  alt: string;
  isKitBadge?: boolean;
}) => {
  const content = src ? (
    <Image
      src={src}
      alt={alt}
      className="h-auto max-w-[320px] rounded-lg object-contain"
      width={320}
      height={320}
    />
  ) : (
    <div className="flex h-56 w-56 items-center justify-center rounded-lg bg-[#0a0d1a]">
      <Package className="h-10 w-10 text-[#e5e4e2]/30" />
    </div>
  );

  const trigger = (
    <div className="relative h-10 w-10 shrink-0">
      {src ? (
        <Image
          src={src}
          alt={alt}
          className="h-10 w-10 cursor-pointer rounded border border-[#d3bb73]/20 object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
          width={40}
          height={40}
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
          <Package className="h-5 w-5 text-[#e5e4e2]/40" />
        </div>
      )}

      {isKitBadge && (
        <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
          <Package className="h-3 w-3 text-[#1c1f33]" />
        </div>
      )}
    </div>
  );

  return <Popover trigger={trigger} content={content} openOn="hover" />;
};
