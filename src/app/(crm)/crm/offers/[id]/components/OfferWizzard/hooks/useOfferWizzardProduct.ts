'use client';

import { createSlice, PayloadAction, nanoid } from '@reduxjs/toolkit';
import type { IOfferItem, IOfferItemDraft } from '@/app/(crm)/crm/offers/types';
import type { SelectedAltMap, EquipmentConflictRow } from '../types';
import { IProduct } from '@/app/(crm)/crm/offers/types';

const calcSubtotal = (qty: number, unitPrice: number, discountPercent: number) => {
  const q = Number.isFinite(qty) ? qty : 1;
  const p = Number.isFinite(unitPrice) ? unitPrice : 0;
  const d = Number.isFinite(discountPercent) ? discountPercent : 0;
  return q * p * (1 - d / 100);
};

export type OfferWizardState = {
  // draft items
  offerItems: IOfferItem[];

  // substitutions selection
  selectedAlt: SelectedAltMap;
  conflicts: EquipmentConflictRow[];

  // UI for custom item
  showCustomItemForm: boolean;
  showEquipmentSelector: boolean;
  showSubcontractorSelector: boolean;

  customItem: IProduct & {
    name: string;
    description: string;
    unit: string;
    unit_price: number;
    quantity: number;
    equipment_ids: string[];
    discount_percent: number;
    subcontractor_id: string;
    needs_subcontractor: boolean;
  };
};

const initialState: OfferWizardState = {
  offerItems: [],
  selectedAlt: {},
  conflicts: [],

  showCustomItemForm: false,
  showEquipmentSelector: false,
  showSubcontractorSelector: false,

  customItem: {
    id: '',
    base_price: 0,
    name: '',
    description: '',
    unit: 'szt',
    unit_price: 0,
    discount_percent: 0,
    quantity: 1,
    equipment_ids: [],
    subcontractor_id: '',
    needs_subcontractor: false,
  },
};

export const offerWizardSlice = createSlice({
  name: 'offerWizard',
  initialState,
  reducers: {
    resetWizard: () => initialState,

    setOfferItems(state, action: PayloadAction<IOfferItemDraft[]>) {
      state.offerItems = action.payload as IOfferItem[];
    },

    addProduct(state, action: PayloadAction<IProduct>) {
      const product = action.payload;
      const existing = state.offerItems.find((i) => i.product_id === product.id);

      if (existing) {
        existing.quantity += 1;
        existing.subtotal = calcSubtotal(
          existing.quantity,
          existing.unit_price,
          existing.discount_percent || 0,
        ); //Ominąć
      } else {
        state.offerItems.push({
          id: nanoid(),
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

    // ===== custom item UI/state
    setShowCustomItemForm(state, action: PayloadAction<boolean>) {
      state.showCustomItemForm = action.payload;
    },
    setShowEquipmentSelector(state, action: PayloadAction<boolean>) {
      state.showEquipmentSelector = action.payload;
    },
    setShowSubcontractorSelector(state, action: PayloadAction<boolean>) {
      state.showSubcontractorSelector = action.payload;
    },
    setCustomItem(state, action: PayloadAction<Partial<OfferWizardState['customItem']>>) {
      state.customItem = { ...state.customItem, ...action.payload };
    },

    addCustomItem(state) {
      const c = state.customItem;

      const newItem: IOfferItem = {
        id: nanoid(),
        product_id: c.id,
        name: c.name,
        description: c.description,
        quantity: c.quantity,
        unit: c.unit,
        unit_price: c.unit_price,
        discount_percent: c.discount_percent,
        subtotal: calcSubtotal(c.quantity, c.unit_price, c.discount_percent),
        equipment_ids: c.equipment_ids,
        subcontractor_id: c.subcontractor_id,
        needs_subcontractor: c.needs_subcontractor,
        discount_amount: 0,
        display_order: 0,
        total: 0,
      };

      state.offerItems.push(newItem as IOfferItem);

      // reset form + UI
      state.customItem = { ...initialState.customItem };
      state.showCustomItemForm = false;
      state.showEquipmentSelector = false;
      state.showSubcontractorSelector = false;
    },

    // ===== conflicts selection (optional, but you already use them in submit)
    setSelectedAlt(state, action: PayloadAction<SelectedAltMap>) {
      state.selectedAlt = action.payload;
    },
    setConflicts(state, action: PayloadAction<EquipmentConflictRow[]>) {
      state.conflicts = action.payload;
    },
  },
});

export const offerWizardActions = offerWizardSlice.actions;
export default offerWizardSlice.reducer;
