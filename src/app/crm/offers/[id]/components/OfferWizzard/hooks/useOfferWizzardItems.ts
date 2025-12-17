'use client';

import { useMemo, useRef, useState } from 'react';
import { calcSubtotal, calcTotal } from '../utils';
import { IOfferItem, IOfferWizardCustomItem, IProduct } from '@/app/crm/offers/types';

export function useOfferWizardItems() {
  const [offerItems, setOfferItems] = useState<IOfferItem[]>([]);
  const offerItemsRef = useRef<IOfferItem[]>([]);
  // trzymamy ref w sync z realnym stanem
  if (offerItemsRef.current !== offerItems) offerItemsRef.current = offerItems;

  const [showCustomItemForm, setShowCustomItemForm] = useState(false);
  const [showEquipmentSelector, setShowEquipmentSelector] = useState(false);
  const [showSubcontractorSelector, setShowSubcontractorSelector] = useState(false);

  const [customItem, setCustomItem] = useState<IOfferWizardCustomItem>({
    name: '',
    description: '',
    unit: 'szt',
    unit_price: 0,
    discount_percent: 0,
    quantity: 1,
    equipment_ids: [] as string[],
    subcontractor_id: '',
    needs_subcontractor: false,
    subtotal: 0,
  });

  const total = useMemo(() => calcTotal(offerItems), [offerItems]);

  // ✅ helper żeby zawsze ustawiać i ref, i state
  const setOfferItemsSafe = (next: IOfferItem[]) => {
    offerItemsRef.current = next;
    setOfferItems(next);
  };

  // ✅ teraz addProduct zwraca nextItems
  const addProduct = (product: IProduct) => {
    const prev = offerItemsRef.current;

    const existing = prev.find((i) => i.product_id === product.id);
    let next: IOfferItem[];

    if (existing) {
      next = prev.map((i) =>
        i.id === existing.id
          ? {
              ...i,
              quantity: i.quantity + 1,
              subtotal: calcSubtotal(i.quantity + 1, i.unit_price, i.discount_percent),
              discount_amount: 0,
              total: 0,
              display_order: 0,
            }
          : i,
      );
    } else {
      const newItem: IOfferItem = {
        id: `temp-${Date.now()}`,
        product_id: product.id,
        name: product.name,
        description: product.description || '',
        quantity: 1,
        unit: product.unit,
        unit_price: product.base_price,
        discount_percent: 0,
        subtotal: product.base_price,
        discount_amount: 0,
        total: 0,
        display_order: 0,
      };

      next = [...prev, newItem];
    }

    setOfferItemsSafe(next);
    return next;
  };

  // ✅ remove zwraca next
  const removeItem = (id: string) => {
    const prev = offerItemsRef.current;
    const next = prev.filter((i) => i.id !== id);
    setOfferItemsSafe(next);
    return next;
  };

  // ✅ update zwraca next
  const updateItem = (id: string, patch: Partial<IOfferItem>) => {
    const prev = offerItemsRef.current;

    const next = prev.map((i) => {
      if (i.id !== id) return i;
      const updated: any = { ...i, ...patch };
      updated.subtotal = calcSubtotal(
        updated.quantity,
        updated.unit_price,
        updated.discount_percent || 0,
      );
      return updated;
    });

    setOfferItemsSafe(next);
    return next;
  };

  const addCustomItem = () => {
    const subtotal = calcSubtotal(customItem.quantity, customItem.unit_price, customItem.discount_percent);

    const newItem: IOfferWizardCustomItem = {
      id: `temp-${Date.now()}`,
      name: customItem.name,
      description: customItem.description,
      quantity: customItem.quantity,
      unit: customItem.unit,
      unit_price: customItem.unit_price,
      discount_percent: customItem.discount_percent,
      subtotal,
      equipment_ids: customItem.equipment_ids,
      subcontractor_id: customItem.subcontractor_id,
      needs_subcontractor: customItem.needs_subcontractor,
    };

    const prev = offerItemsRef.current;
    const next = [...prev, newItem as IOfferItem];
    setOfferItemsSafe(next);

    // reset UI/form
    setCustomItem({
      name: '',
      description: '',
      unit: 'szt',
      unit_price: 0,
      discount_percent: 0,
      quantity: 1,
      equipment_ids: [],
      subcontractor_id: '',
      needs_subcontractor: false,
    } as any);

    setShowCustomItemForm(false);
    setShowEquipmentSelector(false);
    setShowSubcontractorSelector(false);

    return next;
  };

  return {
    offerItems,
    setOfferItems: setOfferItemsSafe, // ✅ dalej masz setter, ale bez rozjazdu z ref

    total,

    addProduct,
    removeItem,
    updateItem,

    // custom form UI
    showCustomItemForm,
    setShowCustomItemForm,
    customItem,
    setCustomItem,

    showEquipmentSelector,
    setShowEquipmentSelector,
    showSubcontractorSelector,
    setShowSubcontractorSelector,

    addCustomItem,
  };
}