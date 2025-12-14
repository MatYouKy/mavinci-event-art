// useEventEquipment.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useGetEventEquipmentQuery,
  useAddEventEquipmentMutation,
  useUpdateEventEquipmentMutation,
  useRemoveEventEquipmentMutation,
  SelectedEquipment,
} from '@/app/crm/events/store/api/eventsApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase';

type ItemType = 'item' | 'kit';
type AvailKey = `${ItemType}-${string}`;

type AvailabilityRow = {
  item_id: string;
  item_type: ItemType;
  total_quantity: number;
  reserved_quantity: number;
  available_quantity: number; // ✅ pula dostępna w terminie (bez innych eventów)
};

export type AvailabilityUI = {
  total_quantity: number; // max magazyn
  reserved_quantity: number; // rezerwacje inne / wg RPC
  used_by_this_event: number; // ile już dodane do tego eventu

  // ✅ pula dostępna w terminie (z RPC)
  available_in_term: number;

  // ✅ ile możesz JESZCZE dołożyć do TEGO eventu
  max_add: number;

  // ✅ ile maksymalnie możesz USTAWIĆ w evencie (do edycji quantity)
  max_set: number;
};

export type AvailabilityByKey = Record<AvailKey, AvailabilityUI>;

interface EventCore {
  id: string;
  event_date?: string | null;
  event_end_date?: string | null;
}

const keyOf = (type: ItemType, id: string) => `${type}-${id}` as AvailKey;

function buildInEventMap(equipmentRows: any[]) {
  const map = new Map<string, number>();
  for (const row of equipmentRows || []) {
    const qty = Number(row?.quantity ?? 0);

    const eqId = row?.equipment_id ?? row?.equipment?.id ?? row?.equipment?.equipment_id;
    if (eqId) {
      const k = keyOf('item', eqId);
      map.set(k, (map.get(k) ?? 0) + qty);
    }

    const kitId = row?.kit_id ?? row?.kit?.id ?? row?.kit?.kit_id;
    if (kitId) {
      const k = keyOf('kit', kitId);
      map.set(k, (map.get(k) ?? 0) + qty);
    }
  }
  return map;
}

export function useEventEquipment(eventId: string, event?: EventCore) {
  const { showSnackbar } = useSnackbar();

  const {
    data: equipment = [],
    isLoading,
    error,
    refetch,
  } = useGetEventEquipmentQuery(eventId, { skip: !eventId });

  const [addMutation, { isLoading: isAdding }] = useAddEventEquipmentMutation();
  const [updateMutation, { isLoading: isUpdating }] = useUpdateEventEquipmentMutation();
  const [removeMutation, { isLoading: isRemoving }] = useRemoveEventEquipmentMutation();

  const [availableEquipment, setAvailableEquipment] = useState<any[]>([]);
  const [availableKits, setAvailableKits] = useState<any[]>([]);
  const [availabilityByKey, setAvailabilityByKey] = useState<AvailabilityByKey>({});
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);

  const equipmentRef = useRef<any[]>([]);
  useEffect(() => {
    equipmentRef.current = equipment || [];
  }, [equipment]);

  // ✅ request guard – tylko ostatni fetch ma prawo zapisać state
  const fetchSeqRef = useRef(0);

  const fetchAvailableEquipment = useCallback(async () => {
    if (!event?.id) return;

    const seq = ++fetchSeqRef.current;

    try {
      setIsCheckingAvailability(true);

      // 1) bazowa dostępność z RPC jeśli mamy daty
      let baseRows: AvailabilityRow[] = [];

      if (event.event_date && event.event_end_date) {
        const { data, error } = await supabase.rpc('check_equipment_availability_for_event', {
          p_event_id: event.id,
          p_start_date: event.event_date,
          p_end_date: event.event_end_date,
        });
        if (error) throw error;
        baseRows = (data || []) as AvailabilityRow[];
      } else {
        // brak dat -> fallback: traktuj "available_in_term" jako magazyn
        const { data: items } = await supabase.from('equipment_items').select('id, total_quantity');
        baseRows = (items || []).map((it: any) => ({
          item_id: it.id,
          item_type: 'item',
          total_quantity: Number(it.total_quantity ?? 0),
          reserved_quantity: 0,
          available_quantity: Number(it.total_quantity ?? 0),
        }));
      }

      // ✅ policz used_by_this_event z NAJNOWSZEGO equipment
      const usedMap = buildInEventMap(equipmentRef.current);

      const byKey: AvailabilityByKey = {};
      for (const row of baseRows || []) {
        const k = keyOf(row.item_type, row.item_id);
        const used = Number(usedMap.get(k) ?? 0);

        const available_in_term = Math.max(0, Number(row.available_quantity ?? 0));
        const max_add = Math.max(0, available_in_term - used);
        const max_set = used + max_add;

        byKey[k] = {
          total_quantity: Math.max(0, Number(row.total_quantity ?? 0)),
          reserved_quantity: Math.max(0, Number(row.reserved_quantity ?? 0)),
          used_by_this_event: used,
          available_in_term,
          max_add,
          max_set,
        };
      }

      // ✅ JEŚLI w międzyczasie poszedł nowszy fetch – nie nadpisuj stanu
      if (seq !== fetchSeqRef.current) return;

      setAvailabilityByKey(byKey);

      // 3) pobierz katalog itemów + doklej max_add / max_set
      const { data: allItems, error: itemsError } = await supabase
        .from('equipment_items')
        .select(`*, category:warehouse_categories(name)`)
        .order('name');

      if (seq !== fetchSeqRef.current) return;

      if (!itemsError && allItems) {
        const itemsWithAvail = (allItems as any[]).map((it) => {
          const k = keyOf('item', it.id);
          const a = byKey[k];
          return {
            ...it,
            // ✅ do modala / UI: ile możesz DODAĆ teraz
            available_count: a?.max_add ?? 0,

            // info do opisów
            total_quantity: a?.total_quantity ?? 0,
            reserved_quantity: a?.reserved_quantity ?? 0,
            used_by_this_event: a?.used_by_this_event ?? 0,
            available_in_term: a?.available_in_term ?? 0,
            max_add: a?.max_add ?? 0,
            max_set: a?.max_set ?? 0,
          };
        });

        setAvailableEquipment(itemsWithAvail.filter((x) => Number(x.max_add ?? 0) > 0));
      }

      // 4) pobierz zestawy i doklej max_add / max_set
      const { data: kits, error: kitsError } = await supabase
        .from('equipment_kits')
        .select(
          `
          *,
          items:equipment_kit_items(
            equipment_id,
            quantity,
            equipment:equipment_items(id, name, category:warehouse_categories(name))
          )
        `,
        )
        .order('name');

      if (seq !== fetchSeqRef.current) return;

      if (!kitsError && kits) {
        const kitsWithAvail = (kits as any[]).map((kit) => {
          const k = keyOf('kit', kit.id);
          const a = byKey[k];
          return {
            ...kit,
            available_count: a?.max_add ?? 0,
            used_by_this_event: a?.used_by_this_event ?? 0,
            available_in_term: a?.available_in_term ?? 0,
            max_add: a?.max_add ?? 0,
            max_set: a?.max_set ?? 0,
            reserved_quantity: a?.reserved_quantity ?? 0,
            total_quantity: a?.total_quantity ?? 0,
          };
        });

        setAvailableKits(kitsWithAvail.filter((k) => Number(k.max_add ?? 0) > 0));
      }
    } catch (e) {
      console.error('[fetchAvailableEquipment] error', e);
    } finally {
      // ✅ tylko ostatni request może zgasić loader
      if (seq === fetchSeqRef.current) setIsCheckingAvailability(false);
    }
  }, [event?.id, event?.event_date, event?.event_end_date]);

  const addEquipment = useCallback(
    async (items: SelectedEquipment[]) => {
      try {
        await addMutation({ eventId, items }).unwrap();
        showSnackbar('Sprzęt dodany', 'success');

        await refetch();
        await fetchAvailableEquipment();
        return true;
      } catch (err: any) {
        console.error('[addEquipment] error', err);
        showSnackbar(err?.data?.error ?? err?.message ?? 'Nie udało się dodać sprzętu', 'error');
        return false;
      }
    },
    [addMutation, eventId, fetchAvailableEquipment, refetch, showSnackbar],
  );

  const updateEquipment = useCallback(
    async (id: string, data: any) => {
      try {
        await updateMutation({ id, eventId, data }).unwrap();
        showSnackbar('Zaktualizowano', 'success');

        await refetch();
        await fetchAvailableEquipment();
        return true;
      } catch (err: any) {
        showSnackbar(err?.data?.error ?? err?.message ?? 'Nie udało się zaktualizować', 'error');
        return false;
      }
    },
    [eventId, fetchAvailableEquipment, refetch, showSnackbar, updateMutation],
  );

  const removeEquipment = useCallback(
    async (id: string) => {
      try {
        await removeMutation({ id, eventId }).unwrap();
        showSnackbar('Usunięto', 'success');

        await refetch();
        await fetchAvailableEquipment();
        return true;
      } catch (err: any) {
        showSnackbar(err?.data?.error ?? err?.message ?? 'Nie udało się usunąć', 'error');
        return false;
      }
    },
    [eventId, fetchAvailableEquipment, refetch, removeMutation, showSnackbar],
  );

  return {
    equipment,
    isLoading,
    error,
    refetch,

    addEquipment,
    updateEquipment,
    removeEquipment,
    isAdding,
    isUpdating,
    isRemoving,

    availableEquipment,
    availableKits,
    availabilityByKey,
    isCheckingAvailability,
    fetchAvailableEquipment,
  };
}