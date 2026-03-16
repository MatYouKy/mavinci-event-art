'use client';

import { useState, useEffect, useRef } from 'react';
import { Lock, AlertTriangle, CheckCircle, Package, X, Loader2, MoreVertical } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDispatch } from 'react-redux';
import { eventsApi } from '@/app/(crm)/crm/events/store/api/eventsApi';

interface EquipmentItem {
  warehouse_category_id: any;
  item_type: 'item' | 'kit';
  item_id: string;
  item_name: string;
  required_qty: number;
  total_qty: number;
  reserved_qty: number;
  available_qty: number;
  has_conflict: boolean;
  shortage_qty: number;
  category_id?: string;
}

interface ReserveEquipmentModalProps {
  offerId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface SubstitutionItem {
  id: string;
  name: string;
  available_qty: number;
  brand?: string;
  model?: string;
}

const buildItemKey = (itemType: 'item' | 'kit', itemId: string) => `${itemType}-${itemId}`;

const parseItemKey = (key: string) => {
  const separatorIndex = key.indexOf('-');
  return {
    item_type: key.slice(0, separatorIndex) as 'item' | 'kit',
    item_id: key.slice(separatorIndex + 1),
  };
};

// Mini dropdown component for actions
function ActionsDropdown({
  itemKey,
  item,
  onAcceptShortage,
  onResolveConflict,
}: {
  itemKey: string;
  item: EquipmentItem;
  onAcceptShortage: (key: string) => void;
  onResolveConflict: (item: EquipmentItem) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded p-1 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
          <button
            onClick={() => {
              onAcceptShortage(itemKey);
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/10"
          >
            <AlertTriangle className="h-4 w-4" />
            Zaakceptuj brak
          </button>
          <button
            onClick={() => {
              onResolveConflict(item);
              setIsOpen(false);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/10"
          >
            <Package className="h-4 w-4" />
            Rozwiąż konflikt
          </button>
        </div>
      )}
    </div>
  );
}

export default function ReserveEquipmentModal({
  offerId,
  open,
  onClose,
  onSuccess,
}: ReserveEquipmentModalProps) {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [acceptedShortages, setAcceptedShortages] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showSubstitutionModal, setShowSubstitutionModal] = useState(false);
  const [currentConflictItem, setCurrentConflictItem] = useState<EquipmentItem | null>(null);
  const [substitutions, setSubstitutions] = useState<SubstitutionItem[]>([]);
  const [loadingSubstitutions, setLoadingSubstitutions] = useState(false);
  const { showSnackbar } = useSnackbar();
  const dispatch = useDispatch();

  useEffect(() => {
    if (open && offerId) {
      loadEquipment();
    }
  }, [open, offerId]);

  const loadEquipment = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('get_offer_equipment_for_reservation', {
        p_offer_id: offerId,
      });

      if (error) throw error;
      const items = data || [];
      setEquipment(items);

      // Domyślnie zaznacz wszystkie dostępne
      const availableIds = items
        .filter((item: EquipmentItem) => !item.has_conflict)
        .map((item: EquipmentItem) => `${item.item_type}-${item.item_id}`);
      setSelectedItems(new Set(availableIds));
    } catch (err: any) {
      console.error('Error loading equipment:', err);
      showSnackbar(err.message || 'Błąd podczas ładowania sprzętu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadSubstitutions = async (item: EquipmentItem) => {
    try {
      setLoadingSubstitutions(true);
  
      let warehouseCategoryId = item.warehouse_category_id;
  
      if (!warehouseCategoryId && item.item_type === 'item') {
        const { data: itemData, error: itemError } = await supabase
          .from('equipment_items')
          .select('warehouse_category_id')
          .eq('id', item.item_id)
          .single();
  
        if (itemError) throw itemError;
        warehouseCategoryId = itemData?.warehouse_category_id;
      }
  
      if (!warehouseCategoryId) {
        setSubstitutions([]);
        return;
      }
  
      const { data, error } = await supabase
        .from('equipment_items')
        .select('id, name, brand, model, warehouse_category_id')
        .eq('warehouse_category_id', warehouseCategoryId)
        .neq('id', item.item_id)
        .limit(10);
  
      if (error) throw error;
  
      const itemsWithAvailability = await Promise.all(
        (data || []).map(async (substitute) => {
          const { count, error: countError } = await supabase
            .from('equipment_units')
            .select('*', { count: 'exact', head: true })
            .eq('equipment_id', substitute.id)
            .eq('status', 'available');
  
          if (countError) throw countError;
  
          return {
            ...substitute,
            available_qty: count || 0,
          };
        })
      );
  
      const available = itemsWithAvailability.filter(
        (sub) => sub.available_qty >= item.required_qty
      );
  
      setSubstitutions(available);
    } catch (err: any) {
      console.error('Error loading substitutions:', err);
      showSnackbar(err.message || 'Błąd podczas ładowania alternatyw', 'error');
    } finally {
      setLoadingSubstitutions(false);
    }
  };
  const handleToggleItem = (itemKey: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemKey)) {
      newSelected.delete(itemKey);
    } else {
      newSelected.add(itemKey);
    }
    setSelectedItems(newSelected);
  };

  const handleAcceptShortage = (itemKey: string) => {
    const newAccepted = new Set(acceptedShortages);
    newAccepted.add(itemKey);
    setAcceptedShortages(newAccepted);
    showSnackbar('Brak sprzętu został zaakceptowany. Zostanie oznaczony w zakładce Sprzęt.', 'info');
  };

  const handleResolveConflict = async (item: EquipmentItem) => {
    setCurrentConflictItem(item);
    setShowSubstitutionModal(true);
    await loadSubstitutions(item);
  };

  const handleSelectSubstitution = async (substitutionId: string) => {
    if (!currentConflictItem) return;
  
    try {
      const { error: deleteError } = await supabase
        .from('offer_equipment_substitutions')
        .delete()
        .eq('offer_id', offerId)
        .eq('from_item_id', currentConflictItem.item_id);
  
      if (deleteError) throw deleteError;
  
      const { error } = await supabase
        .from('offer_equipment_substitutions')
        .insert({
          offer_id: offerId,
          from_item_id: currentConflictItem.item_id,
          to_item_id: substitutionId,
          qty: currentConflictItem.required_qty,
        });
  
      if (error) throw error;
  
      showSnackbar('Substytucja została zapisana', 'success');
      setShowSubstitutionModal(false);
      setCurrentConflictItem(null);
      await loadEquipment();
    } catch (err: any) {
      console.error('Error saving substitution:', err);
      showSnackbar(err.message || 'Błąd podczas zapisywania substytucji', 'error');
    }
  };

  const handleConfirm = async () => {
    try {
      setConfirming(true);

      // Pobierz event_id z oferty
      const { data: offer } = await supabase
        .from('offers')
        .select('event_id')
        .eq('id', offerId)
        .single();

      if (!offer?.event_id) {
        throw new Error('Nie znaleziono eventu dla tej oferty');
      }

      const eventId = offer.event_id;

      // Rezerwuj tylko zaznaczone
      const itemsToReserve = equipment
        .filter((item) => {
          const itemKey = `${item.item_type}-${item.item_id}`;
          return selectedItems.has(itemKey) && !item.has_conflict;
        })
        .map((item) => ({
          item_type: item.item_type,
          item_id: item.item_id,
          qty: item.required_qty,
        }));

      // Zapisz zaakceptowane braki
      const acceptedShortageItems = Array.from(acceptedShortages).map((key) => {
        const { item_type, item_id } = parseItemKey(key);
        const item = equipment.find((e) => buildItemKey(e.item_type, e.item_id) === key);
      
        return {
          item_type,
          item_id,
          shortage_qty: item?.shortage_qty || 0,
        };
      });

      // Wywołaj funkcję rezerwacji (automatycznie odrzuci inne oferty i ustawi flagę braków)
      const { data, error } = await supabase.rpc('reserve_selected_equipment', {
        p_offer_id: offerId,
        p_items: itemsToReserve,
        p_accepted_shortages: acceptedShortageItems,
      });

      if (error) throw error;

      // Invaliduj cache RTK Query
      dispatch(eventsApi.util.invalidateTags([
        { type: 'EventEquipment', id: eventId },
        { type: 'EventOffers', id: `${eventId}_LIST` },
        { type: 'EventDetails', id: eventId },
        { type: 'Events', id: eventId },
      ]));

      const result = data as { success: boolean; reserved_count: number; shortage_count: number; rejected_offers_count: number };

      if (result.rejected_offers_count > 0) {
        showSnackbar(
          `Sprzęt zarezerwowany pomyślnie. Odrzucono ${result.rejected_offers_count} pozostałych ofert.`,
          'success'
        );
      } else {
        showSnackbar('Sprzęt został zarezerwowany pomyślnie', 'success');
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error confirming reservation:', err);
      showSnackbar(err.message || 'Błąd podczas rezerwacji sprzętu', 'error');
    } finally {
      setConfirming(false);
    }
  };

  const hasUnresolvedConflicts =
    equipment.some((e) => e.has_conflict) && acceptedShortages.size === 0;
  const canConfirm = selectedItems.size > 0 || acceptedShortages.size > 0;

  if (!open) return null;

  return (
    <>
      {/* Main Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="relative w-full max-w-4xl rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-green-500/10 p-2">
                <Lock className="h-5 w-5 text-green-400" />
              </div>
              <h2 className="text-xl font-light text-[#e5e4e2]">Zarezerwuj Sprzęt</h2>
            </div>
            <button
              onClick={onClose}
              disabled={confirming}
              className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2] disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-[70vh] overflow-y-auto p-6">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="mb-4 h-12 w-12 animate-spin text-[#d3bb73]" />
                <p className="text-sm text-[#e5e4e2]/60">Ładowanie sprzętu...</p>
              </div>
            ) : (
              <>
                <p className="mb-6 text-sm text-[#e5e4e2]/60">
                  Poniższy sprzęt zostanie wstępnie zarezerwowany dla tego eventu. Status oferty
                  zmieni się na <span className="font-medium text-green-400">Zaakceptowana</span>.
                </p>

                {equipment.length === 0 ? (
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-4 text-sm text-blue-400">
                    Brak sprzętu do rezerwacji
                  </div>
                ) : (
                  <>
                    {/* Tabela sprzętu */}
                    <div className="overflow-hidden rounded-lg border border-[#d3bb73]/10">
                      <table className="w-full">
                        <thead className="bg-[#0f1117]">
                          <tr>
                            <th className="w-10 px-4 py-3"></th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                              Sprzęt
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-[#e5e4e2]/60">
                              Wymagane
                            </th>
                            <th className="px-4 py-3 text-right text-xs font-medium text-[#e5e4e2]/60">
                              Dostępne
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-medium text-[#e5e4e2]/60">
                              Status
                            </th>
                            <th className="w-10 px-4 py-3"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#d3bb73]/10">
                          {equipment.map((item, index) => {
                            const itemKey = `${item.item_type}-${item.item_id}`;
                            const isSelected = selectedItems.has(itemKey);
                            const isAcceptedShortage = acceptedShortages.has(itemKey);

                            return (
                              <tr
                                key={`${item.item_type}-${item.item_id}-${index}`}
                                className={`transition-colors hover:bg-[#0f1117]/50 ${
                                  isAcceptedShortage ? 'opacity-60' : ''
                                }`}
                              >
                                {/* Checkbox */}
                                <td className="px-4 py-3">
                                  {!item.has_conflict && !isAcceptedShortage && (
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => handleToggleItem(itemKey)}
                                      className="h-4 w-4 rounded border-[#d3bb73]/30 bg-[#0f1117] text-green-500 focus:ring-2 focus:ring-green-500/50"
                                    />
                                  )}
                                </td>

                                {/* Nazwa */}
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    {item.item_type === 'kit' && (
                                      <Package className="h-4 w-4 text-[#d3bb73]" />
                                    )}
                                    <span className="text-sm text-[#e5e4e2]">{item.item_name}</span>
                                  </div>
                                </td>

                                {/* Wymagane */}
                                <td className="px-4 py-3 text-right">
                                  <span className="text-sm font-medium text-[#e5e4e2]">
                                    {item.required_qty}
                                  </span>
                                </td>

                                {/* Dostępne */}
                                <td className="px-4 py-3 text-right">
                                  <span className="text-sm text-[#e5e4e2]/60">
                                    {item.available_qty} / {item.total_qty}
                                  </span>
                                </td>

                                {/* Status */}
                                <td className="px-4 py-3">
                                  {isAcceptedShortage ? (
                                    <div className="inline-flex items-center gap-1.5 rounded border border-yellow-500/30 bg-yellow-500/20 px-2 py-1 text-xs text-yellow-400">
                                      <AlertTriangle className="h-3 w-3" />
                                      Zaakceptowany brak
                                    </div>
                                  ) : item.has_conflict ? (
                                    <div className="inline-flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/20 px-2 py-1 text-xs text-red-400">
                                      <AlertTriangle className="h-3 w-3" />
                                      Brak {item.shortage_qty}
                                    </div>
                                  ) : (
                                    <div className="inline-flex items-center gap-1.5 rounded border border-green-500/30 bg-green-500/20 px-2 py-1 text-xs text-green-400">
                                      <CheckCircle className="h-3 w-3" />
                                      Dostępne
                                    </div>
                                  )}
                                </td>

                                {/* Actions */}
                                <td className="px-4 py-3">
                                  {item.has_conflict && !isAcceptedShortage && (
                                    <ActionsDropdown
                                      itemKey={itemKey}
                                      item={item}
                                      onAcceptShortage={handleAcceptShortage}
                                      onResolveConflict={handleResolveConflict}
                                    />
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Komunikaty */}
                    {acceptedShortages.size > 0 && (
                      <div className="mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
                        <div className="mb-2 flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-yellow-400" />
                          <strong className="text-sm text-yellow-400">Zaakceptowane braki</strong>
                        </div>
                        <p className="text-sm text-yellow-400/90">
                          Zaakceptowano {acceptedShortages.size} pozycji z brakami. Pozostaną one
                          oznaczone w zakładce Sprzęt do dalszego rozwiązania.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
            <button
              onClick={onClose}
              disabled={confirming}
              className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2] disabled:opacity-50"
            >
              Anuluj
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading || confirming || !canConfirm}
              className="flex items-center gap-2 rounded-lg bg-green-500/20 px-4 py-2 text-sm text-green-400 transition-colors hover:bg-green-500/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {confirming ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Rezerwuję...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Potwierdź Rezerwację
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Substitution Modal */}
      {showSubstitutionModal && currentConflictItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="relative w-full max-w-2xl rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-500/10 p-2">
                  <Package className="h-5 w-5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xl font-light text-[#e5e4e2]">Rozwiąż konflikt</h2>
                  <p className="text-sm text-[#e5e4e2]/60">{currentConflictItem.item_name}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowSubstitutionModal(false);
                  setCurrentConflictItem(null);
                }}
                className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Content */}
            <div className="max-h-[60vh] overflow-y-auto p-6">
              {loadingSubstitutions ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Loader2 className="mb-4 h-12 w-12 animate-spin text-[#d3bb73]" />
                  <p className="text-sm text-[#e5e4e2]/60">Szukam alternatyw...</p>
                </div>
              ) : substitutions.length === 0 ? (
                <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-4">
                  <p className="text-sm text-yellow-400">
                    Nie znaleziono dostępnych zamienników w tej kategorii.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="mb-4 text-sm text-[#e5e4e2]/60">
                    Wybierz alternatywny sprzęt z tej samej kategorii:
                  </p>
                  {substitutions.map((sub) => (
                    <button
                      key={sub.id}
                      onClick={() => handleSelectSubstitution(sub.id)}
                      className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1117] p-4 text-left transition-colors hover:border-[#d3bb73]/30 hover:bg-[#0f1117]/80"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-[#e5e4e2]">{sub.name}</div>
                          {(sub.brand || sub.model) && (
                            <div className="mt-1 text-xs text-[#e5e4e2]/50">
                              {sub.brand} {sub.model}
                            </div>
                          )}
                        </div>
                        <div className="text-sm text-green-400">
                          Dostępne: {sub.available_qty}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end border-t border-[#d3bb73]/10 p-6">
              <button
                onClick={() => {
                  setShowSubstitutionModal(false);
                  setCurrentConflictItem(null);
                }}
                className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/60 transition-colors hover:bg-[#e5e4e2]/10 hover:text-[#e5e4e2]"
              >
                Powrót
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
