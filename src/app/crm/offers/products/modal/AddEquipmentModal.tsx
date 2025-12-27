import { useEffect, useMemo, useState } from 'react';
import { ProductEquipment } from '../../types';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  EquipmentCatalogItem,
  useEquipmentCatalog,
} from '@/app/crm/equipment/hooks/useEquipmentCatalog';
import { Package, Search, Wrench, X } from 'lucide-react';
import { useManageProduct } from '../hooks/useManageProduct';
import { useKitByIdLazy } from '@/app/crm/equipment/hooks/useKitByIdLazy';
import Popover from '@/components/UI/Tooltip';

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

  // osobne wyszukiwarki (żeby nie mieszać)
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [kitSearchQuery, setKitSearchQuery] = useState('');

  const [loading, setLoading] = useState(false);
  const { showSnackbar } = useSnackbar();

  const { add } = useManageProduct({ productId });

  const { loadKit, kit: selectedKit, loading: kitLoading } = useKitByIdLazy();

  const { items, isLoading, loadMore } = useEquipmentCatalog({
    q: mode === 'kit' ? kitSearchQuery : itemSearchQuery,
    categoryId: null,
    itemType: mode === 'kit' ? 'kits' : 'equipment',
    showCablesOnly: false,
    limit: 50,
    activeOnly: true,
  });

  useEffect(() => {
    loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const existingKitIdSet = useMemo(() => {
    return new Set(
      existingEquipment
        .map((e) => e.equipment_kit_id)
        .filter(Boolean) as string[],
    );
  }, [existingEquipment]);
  
  const kits = useMemo(() => {
    return (items ?? []).filter((x) => x.is_kit === true && !existingKitIdSet.has(x.id));
  }, [items, existingKitIdSet]);


  const existingItemIds = useMemo(
    () => existingEquipment.filter((e) => e.equipment_item_id).map((e) => e.equipment_item_id),
    [existingEquipment],
  );

  const equipmentItems = useMemo(
    () =>
      (items ?? []).filter(
        (x) => x.is_kit === false && !x.is_cable && !existingItemIds.includes(x.id),
      ),
    [items, existingItemIds],
  );

  // po wyborze kitu dociągnij pełne dane (lazy)
  useEffect(() => {
    if (mode === 'kit' && selectedKitId) {
      loadKit(selectedKitId);
    }
  }, [mode, selectedKitId, loadKit]);

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
                onClick={() => {
                  setMode('kit');
                  setSelectedItemId('');
                }}
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
                onClick={() => {
                  setMode('item');
                  setSelectedKitId('');
                }}
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

          {/* KIT selection (NOWA WERSJA: wyszukiwarka + lista) */}
          {mode === 'kit' && (
            <>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wyszukaj pakiet</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
                  <input
                    type="text"
                    value={kitSearchQuery}
                    onChange={(e) => setKitSearchQuery(e.target.value)}
                    placeholder="Szukaj po nazwie pakietu..."
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-9 pr-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Wybierz pakiet * ({kits.length} wyników)
                </label>

                <div className="max-h-60 overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a]">
                  {isLoading ? (
                    <div className="p-4 text-center text-sm text-[#e5e4e2]/60">Ładowanie...</div>
                  ) : kits.length === 0 ? (
                    <div className="p-4 text-center text-sm text-[#e5e4e2]/60">
                      Brak wyników lub wszystkie pakiety już dodane
                    </div>
                  ) : (
                    kits.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        onClick={() => setSelectedKitId(k.id)}
                        className={`w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors ${
                          selectedKitId === k.id ? 'bg-[#d3bb73]/20' : 'hover:bg-[#d3bb73]/10'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Thumb src={k.thumbnail_url} alt={k.name} isKitBadge />
                    
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="truncate font-medium text-[#e5e4e2]">{k.name}</div>
                                {!!k.description && (
                                  <div className="mt-1 line-clamp-2 text-xs text-[#e5e4e2]/60">{k.description}</div>
                                )}
                              </div>
                    
                              <div className="shrink-0 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-0.5 text-[11px] text-[#d3bb73]">
                                KIT
                              </div>
                            </div>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Podgląd zawartości wybranego kitu */}
              {selectedKitId && (
                <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
                  <div className="mb-2 text-sm text-[#e5e4e2]/60">Zawartość pakietu:</div>

                  {kitLoading ? (
                    <div className="text-sm text-[#e5e4e2]/60">Ładowanie zawartości...</div>
                  ) : selectedKit?.equipment_kit_items?.length ? (
                    <div className="space-y-1">
                      {selectedKit.equipment_kit_items.map((it, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-sm text-[#e5e4e2]">
                          <span className="text-[#d3bb73]">•</span>
                          <span>
                            {it.quantity}x{' '}
                            {it.equipment_items?.name || it.cables?.name || 'Nieznany element'}
                          </span>
                          {it.equipment_items?.model && (
                            <span className="text-xs text-[#e5e4e2]/60">
                              ({it.equipment_items.model})
                            </span>
                          )}
                          {it.cables?.length_meters && (
                            <span className="text-xs text-[#e5e4e2]/60">
                              ({it.cables.length_meters}m)
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
            </>
          )}

          {/* Item selection (zostaje jak było) */}
          {mode === 'item' && (
            <>
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wyszukaj sprzęt</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
                  <input
                    type="text"
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                    placeholder="Szukaj po nazwie, marce lub modelu..."
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-9 pr-4 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40"
                  />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                  Wybierz sprzęt * ({equipmentItems.length} wyników)
                </label>

                <div className="max-h-60 overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a]">
                  {isLoading ? (
                    <div className="p-4 text-center text-sm text-[#e5e4e2]/60">Ładowanie...</div>
                  ) : equipmentItems.length === 0 ? (
                    <div className="p-4 text-center text-sm text-[#e5e4e2]/60">
                      Brak wyników wyszukiwania
                    </div>
                  ) : (
                    equipmentItems.map((item) => {
                      const avail = (item as any).available_quantity ?? item.available_quantity ?? 0;
                      const disabled = avail === 0;
                    
                      const badgeClass =
                        avail === 0
                          ? 'bg-red-500/20 text-red-400 border-red-500/30'
                          : avail < 5
                            ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
                            : 'bg-green-500/20 text-green-400 border-green-500/30';
                    
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedItemId(item.id)}
                          disabled={disabled}
                          className={`w-full border-b border-[#d3bb73]/10 px-4 py-3 text-left transition-colors ${
                            selectedItemId === item.id
                              ? 'bg-[#d3bb73]/20'
                              : disabled
                                ? 'cursor-not-allowed opacity-50'
                                : 'hover:bg-[#d3bb73]/10'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Thumb src={item.thumbnail_url} alt={item.name} />
                    
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-[#e5e4e2]">{item.name}</div>
                    
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#e5e4e2]/60">
                                    {(item.brand || item.model) && (
                                      <span className="truncate">
                                        {item.brand ?? ''}{item.model ? ` • ${item.model}` : ''}
                                      </span>
                                    )}
                    
                                    {item.warehouse_categories?.name && (
                                      <span className="truncate">• {item.warehouse_categories.name}</span>
                                    )}
                                  </div>
                                </div>
                    
                                <div className={`shrink-0 rounded border px-2 py-0.5 text-[11px] ${badgeClass}`}>
                                  {avail === 0 ? 'Brak' : `${avail} szt.`}
                                </div>
                              </div>
                    
                              {!!item.description && (
                                <div className="mt-1 line-clamp-2 text-xs text-[#e5e4e2]/50">{item.description}</div>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}

          {/* Quantity */}
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Ilość</label>
            <input
              type="number"
              min="1"
              value={quantity}
              onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2]"
            />
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
    <img src={src} alt={alt} className="h-auto max-w-[320px] rounded-lg object-contain" />
  ) : (
    <div className="flex h-56 w-56 items-center justify-center rounded-lg bg-[#0a0d1a]">
      <Package className="h-10 w-10 text-[#e5e4e2]/30" />
    </div>
  );

  const trigger = (
    <div className="relative h-10 w-10 shrink-0">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="h-10 w-10 cursor-pointer rounded border border-[#d3bb73]/20 object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
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