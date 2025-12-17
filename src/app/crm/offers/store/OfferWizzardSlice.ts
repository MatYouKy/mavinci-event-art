'use client';

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { IOfferItemDraft, IProduct } from '../types';



export type OfferWizardState = {
  offerItems: IOfferItemDraft[];

  customItem:  IOfferItemDraft;

  showCustomItemForm: boolean;
  showEquipmentSelector: boolean;
  showSubcontractorSelector: boolean;
};

const initialState: OfferWizardState = {
  offerItems: [],

  customItem: {
    id: '',
    product_id: '',
    name: '',
    description: '',
    unit: 'szt',
    unit_price: 0,
    discount_percent: 0,
    quantity: 1,
    equipment_ids: [],
    subcontractor_id: '',
    needs_subcontractor: false,
    subtotal: 0,
  },

  showCustomItemForm: false,
  showEquipmentSelector: false,
  showSubcontractorSelector: false,
};

const calcSubtotal = (qty: number, unit_price: number, discount_percent: number) =>
  qty * unit_price * (1 - (discount_percent || 0) / 100);

export const offerWizardSlice = createSlice({
  name: 'offerWizard',
  initialState,
  reducers: {
    setOfferItems(state, action: PayloadAction<IOfferItemDraft[]>) {
      state.offerItems = action.payload;
    },

    addProduct(state, action: PayloadAction<IProduct>) {
      const p = action.payload;
      const existing = state.offerItems.find((i) => i.product_id === p.id);

      if (existing) {
        existing.quantity += 1;
        existing.subtotal = calcSubtotal(existing.quantity, existing.unit_price, existing.discount_percent);  
      } else {
        state.offerItems.push({
          id: `temp-${Date.now()}`,
          product_id: p.id,
          name: p.name,
          description: p.description || '',
          quantity: 1,
          unit: p.unit,
          unit_price: p.base_price,
          discount_percent: 0,
          subtotal: p.base_price,
        });
      }
    },

    removeItem(state, action: PayloadAction<string>) {
      state.offerItems = state.offerItems.filter((i) => i.id !== action.payload);
    },

    updateItem(state, action: PayloadAction<{ id: string; patch: Partial<IOfferItemDraft> }>) {
      const { id, patch } = action.payload;
      const item = state.offerItems.find((i) => i.id === id);
      if (!item) return;

      Object.assign(item, patch);
      item.subtotal = calcSubtotal(item.quantity, item.unit_price, item.discount_percent || 0);
    },

    setCustomItem(state, action: PayloadAction<Partial<IOfferItemDraft>>) {
      state.customItem = { ...state.customItem, ...action.payload };
    },

    setShowCustomItemForm(state, action: PayloadAction<boolean>) {
      state.showCustomItemForm = action.payload;
    },
    setShowEquipmentSelector(state, action: PayloadAction<boolean>) {
      state.showEquipmentSelector = action.payload;
    },
    setShowSubcontractorSelector(state, action: PayloadAction<boolean>) {
      state.showSubcontractorSelector = action.payload;
    },

    resetCustomItemUI(state) {
      state.customItem = initialState.customItem;
      state.showCustomItemForm = false;
      state.showEquipmentSelector = false;
      state.showSubcontractorSelector = false;
    },
  },
});

export const offerWizardActions = offerWizardSlice.actions;
export default offerWizardSlice.reducer;