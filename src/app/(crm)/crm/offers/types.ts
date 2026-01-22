import { IEventCategory } from '../event-categories/types';

export interface IProduct {
  id: string;
  name: string;
  description: string;
  base_price: number;
  unit: string;
  category?: IEventCategory | null;
  category_id?: string | null;
}

export interface IOfferItem {
  id: string;
  product_id: string;
  name: string;
  description?: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  discount_percent: number; //Ominąć
  discount_amount: number;
  subtotal: number;
  total: number; //Ominąć
  equipment_ids?: string[];
  display_order: number; //Ominąć
  subcontractor_id?: string;
  needs_subcontractor?: boolean;
  product?: IProduct; // Ominąć
}

export interface IOfferItemDraft
  extends Omit<IOfferItem, 'discount_amount' | 'total' | 'product' | 'display_order'> {
  unit: string; // dodać
}

export type IOfferWizardCustomItem = {
  id?: string;
  product_id?: string;
  name: string;
  description: string;
  unit: string;
  unit_price: number;
  discount_percent: number;
  quantity: number;
  equipment_ids: string[];
  subcontractor_id: string;
  needs_subcontractor: boolean;
  subtotal?: number;
};

export type StaffPaymentType = 'invoice_with_vat' | 'invoice_no_vat' | 'cash_no_receipt';

export type ProductStaffRow = {
  id: string;
  product_id: string;

  role: string;
  quantity: number;
  hourly_rate: number | null;
  estimated_hours: number | null;

  is_optional: boolean;
  notes: string | null;

  payment_type: StaffPaymentType;
};

export type ProductEquipmentMode = 'item' | 'kit';

export interface ProductEquipment {
  id: string;
  equipment_item_id: string | null;
  equipment_kit_id: string | null;
  quantity: number;
  is_optional: boolean;
  notes: string;
  equipment_item?: {
    id: string;
    name: string;
    warehouse_category?: {
      name: string;
    };
  };
  equipment_kit?: {
    id: string;
    name: string;
    description: string | null;
  };
}

export type OfferProductEquipmentRow = {
  id: string;
  product_id: string | null;
  equipment_item_id: string | null;
  equipment_kit_id: string | null;
  quantity: number | null;
  is_optional: boolean | null;
  notes: string | null;
  created_at: string | null;
};

export type CreateOfferProductEquipmentArgs =
  | {
      mode: 'item';
      product_id: string;
      equipment_item_id: string;
      quantity?: number;
      is_optional?: boolean;
      notes?: string | null;
    }
  | {
      mode: 'kit';
      product_id: string;
      equipment_kit_id: string;
      quantity?: number;
      is_optional?: boolean;
      notes?: string | null;
    };