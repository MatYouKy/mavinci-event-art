'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  useGetOfferProductEquipmentByProductIdQuery,
  useAddOfferProductEquipmentMutation,
  useDeleteOfferProductEquipmentMutation,
  useUpdateOfferProductEquipmentMutation,
} from '@/app/(crm)/crm/offers/api/OfferWizzardApi';

// <- ten hook już masz zrobiony wcześniej
import {
  useEquipmentCatalog,
  type EquipmentCatalogItem,
} from '@/app/(crm)/crm/equipment/hooks/useEquipmentCatalog';
import {
  CreateOfferProductEquipmentArgs,
  OfferProductEquipmentRow,
  ProductEquipmentMode,
} from '../../types';

export type ProductEquipmentViewRow = OfferProductEquipmentRow & {
  mode: ProductEquipmentMode;
  // “nazwa/miniatura/opis” wyciągnięte z katalogu
  item?: EquipmentCatalogItem | null;
};

type Params = {
  productId?: string | null;
  /** jeśli chcesz też pokazać kable jako alternatywy w pickerze */
  includeCablesInPicker?: boolean;
  enabled?: boolean;
};

export function useManageProduct({
  productId,
  includeCablesInPicker = false,
  enabled = true,
}: Params) {
  const canRun = !!productId && enabled;
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // 1) sprzęt przypisany do produktu (offer_product_equipment)
  const {
    data: linkedRaw,
    isLoading: isLinkedLoading,
    isFetching: isLinkedFetching,
    isError: isLinkedError,
    error: linkedError,
    refetch: refetchLinked,
  } = useGetOfferProductEquipmentByProductIdQuery(
    { productId: productId as string },
    { skip: !canRun },
  );

  // 2) katalog (żeby móc mapować item_id -> nazwa itd.)
  //    - ustawiamy limit wysoko, bo to ma być picker / enrichment (zależnie od tego ile masz rekordów)
  const catalog = useEquipmentCatalog({
    q: '',
    categoryId: null,
    itemType: 'all',
    showCablesOnly: false,
    limit: 500,
    enabled: enabled,
  });

  // 2b) opcjonalnie kable-only feed jako osobny picker (jeśli chcesz)
  const cablesCatalog = useEquipmentCatalog({
    q: '',
    categoryId: null,
    itemType: 'all',
    showCablesOnly: true,
    limit: 500,
    enabled: enabled && includeCablesInPicker,
  });

  const [addLink, addState] = useAddOfferProductEquipmentMutation();
  const [updateLink, { isLoading: isUpdating }] = useUpdateOfferProductEquipmentMutation();
  const [deleteLink, deleteState] = useDeleteOfferProductEquipmentMutation();

  const linked = (linkedRaw ?? []) as OfferProductEquipmentRow[];

  const catalogMap = useMemo(() => {
    const map = new Map<string, EquipmentCatalogItem>();
    for (const it of catalog.items ?? []) {
      if (it?.id) map.set(it.id, it);
    }
    // jeśli w pickerze chcesz też kable, dorzuć do mapy
    if (includeCablesInPicker) {
      for (const it of cablesCatalog.items ?? []) {
        if (it?.id) map.set(it.id, it);
      }
    }
    return map;
  }, [catalog.items, cablesCatalog.items, includeCablesInPicker]);

  // 3) “widok” linków z dołączonymi danymi z katalogu
  const items: ProductEquipmentViewRow[] = useMemo(() => {
    return linked.map((row) => {
      const mode: ProductEquipmentMode = row.equipment_kit_id ? 'kit' : 'item';
      const idToFind = row.equipment_kit_id || row.equipment_item_id || '';
      return {
        ...row,
        mode,
        item: idToFind ? (catalogMap.get(idToFind) ?? null) : null,
      };
    });
  }, [linked, catalogMap]);

  const linkedById = useMemo(() => {
    const map = new Map<string, OfferProductEquipmentRow>();
    for (const r of linked) map.set(r.id, r);
    return map;
  }, [linked]);

  // 4) akcje

  const add = useCallback(
    async (payload: CreateOfferProductEquipmentArgs) => {
      if (!productId) throw new Error('Brak productId');

      if (payload.mode === 'item') {
        return addLink({
          mode: 'item',
          product_id: payload.product_id,
          equipment_item_id: payload.equipment_item_id,
          quantity: payload.quantity ?? 1,
          is_optional: payload.is_optional ?? false,
          notes: payload.notes ?? null,
        } as any).unwrap();
      }

      return addLink({
        mode: 'kit',
        product_id: payload.product_id,
        equipment_kit_id: payload.equipment_kit_id,
        quantity: payload.quantity ?? 1,
        is_optional: payload.is_optional ?? false,
        notes: payload.notes ?? null,
      } as any).unwrap();
    },
    [addLink, productId],
  );

  /**
   * Update:
   * - dla quantity/is_optional/notes: najlepiej byłoby mieć endpoint update po id
   *   ale jeśli go nie masz, to robimy "replace": delete + add (bez zmiany trybu)
   * - dla zmiany item/kit: też replace
   */
  const update = useCallback(
    async (args: {
      id: string;
      next: { quantity?: number; isOptional?: boolean; notes?: string | null };
    }) => {
      const { id, next } = args;

      if (!productId) throw new Error('Brak productId');

      setUpdatingId(id);
      try {
        return await updateLink({
          id,
          patch: {
            quantity: next.quantity,
            is_optional: next.isOptional,
            notes: next.notes ?? null,
          },
        }).unwrap();
      } finally {
        setUpdatingId(null);
      }
    },
    [productId, updateLink],
  );

  const remove = useCallback(
    async (id: string, productId: string) => {
      if (!productId) throw new Error('Brak productId');
      return deleteLink({ id: id, productId: productId }).unwrap();
    },
    [deleteLink, productId],
  );

  const isMutating = addState.isLoading || deleteState.isLoading || updatingId !== null;

  return {
    // data
    items,
    raw: linked,

    // pickery
    equipmentCatalog: catalog,
    cablesCatalog: includeCablesInPicker ? cablesCatalog : null,

    // status
    isLoading: isLinkedLoading || (canRun && catalog.isLoading),
    isFetching: isLinkedFetching || catalog.isFetching,
    isError: isLinkedError,
    error: linkedError,
    isMutating: isMutating,
    isUpdating,

    // actions
    refetch: refetchLinked,
    add,
    updatingId,
    update,
    remove,
  };
}
