'use client';

import { useMemo, useState } from 'react';
import { calcSubtotal, calcTotal } from '../utils';
import { IOfferItem, IOfferWizardCustomItem, IProduct } from '@/app/crm/offers/types';

export function useOfferWizardItems() {
  const [offerItems, setOfferItems] = useState<IOfferItem[]>([]);

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

  const addProduct = (product: IProduct) => {
    setOfferItems((prev: IOfferItem[]) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
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
      }

      // Ensure the new item has IOfferItem fields, not IOfferWizardCustomItem
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

      return [...prev, newItem];
    });
  };

  const removeItem = (id: string) => setOfferItems((prev) => prev.filter((i) => i.id !== id));

  const updateItem = (id: string, patch: Partial<IOfferItem>) => {
    setOfferItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const updated = { ...i, ...patch };
        updated.subtotal = calcSubtotal(updated.quantity, updated.unit_price, updated.discount_percent || 0);
        return updated;
      }),
    );
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

    setOfferItems((prev: IOfferItem[]) => [...prev, newItem as IOfferItem]);

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
    });
    setShowCustomItemForm(false);
    setShowEquipmentSelector(false);
    setShowSubcontractorSelector(false);
  };

  return {
    offerItems,
    setOfferItems,

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