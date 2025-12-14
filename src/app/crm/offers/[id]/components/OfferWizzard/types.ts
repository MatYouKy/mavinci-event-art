import { IEventCategory } from '@/app/crm/event-categories/types';

export interface Product {
  id: string;
  name: string;
  description: string;
  base_price: number;
  unit: string;
  category?: IEventCategory | null;
  category_id?: string | null;
}

export type EquipmentConflictRow = {
  item_type: 'item' | 'kit';
  item_id: string;
  item_name: string;
  required_qty: number;
  total_qty: number;
  reserved_qty: number;
  available_qty: number;
  shortage_qty: number;
  conflict_until: string | null;
  conflicts: any[];
  alternatives: Array<{
    item_type: 'item' | 'kit';
    item_id: string;
    item_name: string;
    total_qty: number;
    reserved_qty: number;
    available_qty: number;
    warehouse_category_id?: string;
  }>;
};

export interface OfferItem {
  id: string;
  product_id?: string;
  name: string;
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  subtotal: number;
  equipment_ids?: string[];
  subcontractor_id?: string;
  needs_subcontractor?: boolean;
}

export type ClientType = 'individual' | 'business' | '';

export type SelectedAltMap = Record<string, { item_id: string; qty: number }>;