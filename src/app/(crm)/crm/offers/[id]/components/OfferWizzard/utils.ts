import { IOfferItem } from '../../../types';
import { EquipmentConflictRow, SelectedAltMap } from './types';

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
  // Filtrujemy tylko te zamiany, które NIE są rental equipment
  // Rental equipment będzie zapisany bezpośrednio w offer_product_equipment
  return rows
    .filter((r) => {
      const key = Object.keys(selectedAlt).find((k) => {
        const sel = selectedAlt[k];
        return sel.item_id === r.to_item_id;
      });
      const alt = key ? selectedAlt[key] : null;
      return !alt?.is_rental;
    })
    .map((r) => ({ ...r, offer_id: offerId }));
};

export const getRentalEquipmentFromSelectedAlt = (selectedAlt: SelectedAltMap) => {
  return Object.entries(selectedAlt)
    .filter(([_, sel]) => sel.is_rental)
    .map(([key, sel]) => {
      const [itemType, itemId] = key.split('|');
      return {
        originalItemType: itemType,
        originalItemId: itemId,
        rentalEquipmentId: sel.rental_equipment_id,
        subcontractorId: sel.subcontractor_id,
        quantity: sel.qty,
      };
    });
};

export const buildConflictPayloadItems = (items: IOfferItem[]) =>
  (items || [])
    .filter((i) => !!i.product_id)
    .map((i) => ({
      product_id: i.product_id!,
      quantity: i.quantity ?? 1, // w DB masz "quantity"
    }));

export const calcTotal = (items: IOfferItem[]) => items.reduce((sum, i) => sum + (i.subtotal || 0), 0);