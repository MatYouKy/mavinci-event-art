'use client';

import { useState, useEffect } from 'react';
import { Lock, AlertTriangle, CheckCircle, Package, X, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface EquipmentItem {
  item_type: 'item' | 'kit';
  item_id: string;
  item_name: string;
  required_qty: number;
  total_qty: number;
  reserved_qty: number;
  available_qty: number;
  has_conflict: boolean;
  shortage_qty: number;
}

interface ReserveEquipmentModalProps {
  offerId: string;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ReserveEquipmentModal({
  offerId,
  open,
  onClose,
  onSuccess,
}: ReserveEquipmentModalProps) {
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { showSnackbar } = useSnackbar();

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
      setEquipment(data || []);
    } catch (err: any) {
      console.error('Error loading equipment:', err);
      showSnackbar(err.message || 'Błąd podczas ładowania sprzętu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    try {
      setConfirming(true);
      const { data, error } = await supabase.rpc('confirm_equipment_reservation', {
        p_offer_id: offerId,
      });

      if (error) throw error;

      if (data?.success) {
        showSnackbar('Sprzęt został zarezerwowany pomyślnie', 'success');
        onSuccess();
        onClose();
      } else {
        throw new Error(data?.error || 'Błąd podczas rezerwacji');
      }
    } catch (err: any) {
      console.error('Error confirming reservation:', err);
      showSnackbar(err.message || 'Błąd podczas rezerwacji sprzętu', 'error');
    } finally {
      setConfirming(false);
    }
  };

  const hasConflicts = equipment.some((e) => e.has_conflict);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
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
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#d3bb73]/10">
                        {equipment.map((item, index) => (
                          <tr
                            key={`${item.item_type}-${item.item_id}-${index}`}
                            className="transition-colors hover:bg-[#0f1117]/50"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                {item.item_type === 'kit' && (
                                  <Package className="h-4 w-4 text-[#d3bb73]" />
                                )}
                                <span className="text-sm text-[#e5e4e2]">{item.item_name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm font-medium text-[#e5e4e2]">
                                {item.required_qty}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-sm text-[#e5e4e2]/60">
                                {item.available_qty} / {item.total_qty}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {item.has_conflict ? (
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Komunikaty */}
                  {hasConflicts && (
                    <div className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-400" />
                        <strong className="text-sm text-red-400">Uwaga!</strong>
                      </div>
                      <p className="mb-2 text-sm text-red-400/90">
                        Niektóre elementy są niedostępne. Nie można zarezerwować sprzętu dopóki
                        wszystkie konflikty nie zostaną rozwiązane.
                      </p>
                      <p className="text-sm text-red-400/80">
                        Rozwiąż konflikty w zakładce <strong>Konflikty</strong> oferty poprzez:
                      </p>
                      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-red-400/80">
                        <li>Zamianę na alternatywny sprzęt (substytucję)</li>
                        <li>Oznaczenie jako rental zewnętrzny</li>
                      </ul>
                    </div>
                  )}

                  {!hasConflicts && equipment.length > 0 && (
                    <div className="mt-4 flex items-center gap-2 rounded-lg border border-green-500/20 bg-green-500/10 p-4">
                      <CheckCircle className="h-5 w-5 text-green-400" />
                      <p className="text-sm text-green-400">
                        Cały sprzęt jest dostępny i gotowy do rezerwacji.
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
            disabled={loading || confirming || hasConflicts || equipment.length === 0}
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
  );
}
