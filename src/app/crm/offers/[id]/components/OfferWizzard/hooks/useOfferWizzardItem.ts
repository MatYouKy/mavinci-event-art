'use client';

import { useMemo, useState } from 'react';
import { OfferItem, Product } from '../types';
import { calcSubtotal, calcTotal } from '../utils';

export function useOfferWizardItems() {
  const [offerItems, setOfferItems] = useState<OfferItem[]>([]);

  const [showCustomItemForm, setShowCustomItemForm] = useState(false);
  const [showEquipmentSelector, setShowEquipmentSelector] = useState(false);
  const [showSubcontractorSelector, setShowSubcontractorSelector] = useState(false);

  const [customItem, setCustomItem] = useState({
    name: '',
    description: '',
    unit: 'szt',
    unit_price: 0,
    discount_percent: 0,
    qty: 1,
    equipment_ids: [] as string[],
    subcontractor_id: '',
    needs_subcontractor: false,
  });

  const total = useMemo(() => calcTotal(offerItems), [offerItems]);

  const addProduct = (product: Product) => {
    setOfferItems((prev) => {
      const existing = prev.find((i) => i.product_id === product.id);
      if (existing) {
        return prev.map((i) =>
          i.id === existing.id
            ? {
                ...i,
                qty: i.qty + 1,
                subtotal: calcSubtotal(i.qty + 1, i.unit_price, i.discount_percent),
              }
            : i,
        );
      }

      const newItem: OfferItem = {
        id: `temp-${Date.now()}`,
        product_id: product.id,
        name: product.name,
        description: product.description || '',
        qty: 1,
        unit: product.unit,
        unit_price: product.base_price,
        discount_percent: 0,
        subtotal: product.base_price,
      };

      return [...prev, newItem];
    });
  };

  const removeItem = (id: string) => setOfferItems((prev) => prev.filter((i) => i.id !== id));

  const updateItem = (id: string, patch: Partial<OfferItem>) => {
    setOfferItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const updated = { ...i, ...patch };
        updated.subtotal = calcSubtotal(updated.qty, updated.unit_price, updated.discount_percent || 0);
        return updated;
      }),
    );
  };

  const addCustomItem = () => {
    const subtotal = calcSubtotal(customItem.qty, customItem.unit_price, customItem.discount_percent);

    const newItem: OfferItem = {
      id: `temp-${Date.now()}`,
      name: customItem.name,
      description: customItem.description,
      qty: customItem.qty,
      unit: customItem.unit,
      unit_price: customItem.unit_price,
      discount_percent: customItem.discount_percent,
      subtotal,
      equipment_ids: customItem.equipment_ids,
      subcontractor_id: customItem.subcontractor_id,
      needs_subcontractor: customItem.needs_subcontractor,
    };

    setOfferItems((prev) => [...prev, newItem]);

    // reset UI/form
    setCustomItem({
      name: '',
      description: '',
      unit: 'szt',
      unit_price: 0,
      discount_percent: 0,
      qty: 1,
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