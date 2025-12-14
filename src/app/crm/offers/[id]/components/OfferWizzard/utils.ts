import { EquipmentConflictRow, OfferItem, SelectedAltMap } from './types';

export const calcSubtotal = (qty: number, unitPrice: number, discountPercent: number) => {
  const disc = (discountPercent || 0) / 100;
  return qty * unitPrice * (1 - disc);
};

export const buildSubstitutionsForRpc = ({
  selectedAlt,
  conflicts,
}: {
  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];
}) => {
  return (conflicts || [])
    .map((c) => {
      const key = `${c.item_type}|${c.item_id}`;
      const pick = selectedAlt?.[key];
      if (!pick?.item_id) return null;

      return {
        from_item_id: c.item_id,
        to_item_id: pick.item_id,
        qty: pick.qty ?? c.shortage_qty ?? 1,
      };
    })
    .filter(Boolean) as Array<{ from_item_id: string; to_item_id: string; qty: number }>;
};

export const buildSubstitutionsForInsert = ({
  offerId,
  selectedAlt,
  conflicts,
}: {
  offerId: string;
  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];
}) => {
  const rows = buildSubstitutionsForRpc({ selectedAlt, conflicts });
  return rows.map((r) => ({ ...r, offer_id: offerId }));
};

export const buildConflictPayloadItems = (items: OfferItem[]) =>
  (items || [])
    .filter((i) => !!i.product_id)
    .map((i) => ({
      product_id: i.product_id!,
      quantity: i.qty ?? 1, // w DB masz "quantity"
    }));

export const calcTotal = (items: OfferItem[]) => items.reduce((sum, i) => sum + (i.subtotal || 0), 0);