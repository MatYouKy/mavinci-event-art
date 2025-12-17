'use client';

import { useEffect, useMemo, useState } from 'react';
import { Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { ProductStaffRow } from '../../types';
import { AddStaffModal } from '../modal/AddStuffModal';

type DraftStaff = Omit<ProductStaffRow, 'id' | 'product_id'> & { tempId: string };

function makeTempId() {
  return `tmp_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export function ProductStaffSection({
  productId,          // null jeśli "new"
  canEdit,
  draftStaff,
  setDraftStaff,
}: {
  productId: string | null;
  canEdit: boolean;
  draftStaff: DraftStaff[];
  setDraftStaff: (next: DraftStaff[]) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [staff, setStaff] = useState<ProductStaffRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);

  const isNew = !productId;

  const list = useMemo(() => {
    if (isNew) return draftStaff;
    return staff;
  }, [isNew, draftStaff, staff]);

  useEffect(() => {
    if (!productId) return;
    fetchStaff(productId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const fetchStaff = async (pid: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('offer_product_staff')
        .select('*')
        .eq('product_id', pid)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setStaff((data ?? []) as ProductStaffRow[]);
    } catch (e: any) {
      showSnackbar(e?.message || 'Błąd pobierania wymagań kadrowych', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (payload: Omit<ProductStaffRow, 'id' | 'product_id'>) => {
    if (!canEdit) return;

    // NEW: zapis do draft
    if (!productId) {
      setDraftStaff([{ ...payload, tempId: makeTempId() }, ...draftStaff]);
      showSnackbar('Dodano rolę (wersja robocza). Zapisz produkt, aby utrwalić.', 'success');
      return;
    }

    // EXISTING: zapis do bazy
    try {
      setLoading(true);
      const { error } = await supabase.from('offer_product_staff').insert({
        product_id: productId,
        ...payload,
      });
      if (error) throw error;

      showSnackbar('Rola dodana', 'success');
      await fetchStaff(productId);
    } catch (e: any) {
      showSnackbar(e?.message || 'Błąd podczas dodawania roli', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (idOrTempId: string) => {
    if (!canEdit) return;

    if (!productId) {
      setDraftStaff(draftStaff.filter((x) => x.tempId !== idOrTempId));
      showSnackbar('Usunięto rolę z wersji roboczej', 'success');
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase.from('offer_product_staff').delete().eq('id', idOrTempId);
      if (error) throw error;

      showSnackbar('Rola usunięta', 'success');
      await fetchStaff(productId);
    } catch (e: any) {
      showSnackbar(e?.message || 'Błąd podczas usuwania roli', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-[#d3bb73]" />
          <h2 className="text-lg font-medium text-[#e5e4e2]">Wymagani pracownicy</h2>
          {isNew && (
            <span className="ml-2 rounded bg-[#d3bb73]/15 px-2 py-0.5 text-xs text-[#d3bb73]">
              draft
            </span>
          )}
        </div>

        {canEdit && (
          <button
            onClick={() => setShowAddStaffModal(true)}
            className="rounded-lg bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/30"
          >
            + Dodaj rolę
          </button>
        )}
      </div>

      {loading ? (
        <p className="py-8 text-center text-sm text-[#e5e4e2]/60">Ładowanie…</p>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#e5e4e2]/60">Brak wymagań kadrowych</p>
      ) : (
        <div className="space-y-2">
          {list.map((item: any) => {
            const key = productId ? item.id : item.tempId;

            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg bg-[#0a0d1a] p-3"
              >
                <div>
                  <div className="font-medium text-[#e5e4e2]">{item.role}</div>

                  <div className="mt-1 text-xs text-[#e5e4e2]/60">
                    {item.notes ? item.notes : '—'}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm">
                  <span className="text-[#e5e4e2]/80">Ilość: {item.quantity}</span>

                  {item.hourly_rate != null && (
                    <span className="text-[#e5e4e2]/80">{item.hourly_rate} zł/h</span>
                  )}
                  {item.estimated_hours != null && (
                    <span className="text-[#e5e4e2]/80">~{item.estimated_hours}h</span>
                  )}

                  {item.is_optional && (
                    <span className="rounded bg-blue-500/20 px-2 py-1 text-xs text-blue-400">
                      Opcjonalny
                    </span>
                  )}

                  {canEdit && (
                    <button
                      onClick={() => handleDelete(key)}
                      className="rounded p-1 text-[#e5e4e2]/50 hover:bg-white/5 hover:text-red-400"
                      title="Usuń"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddStaffModal && (
        <AddStaffModal
          productId={productId as string}
          onClose={() => setShowAddStaffModal(false)}
          onSubmit={async (payload) => {
            await handleAdd(payload);
            setShowAddStaffModal(false);
          }}
        />
      )}
    </div>
  );
}