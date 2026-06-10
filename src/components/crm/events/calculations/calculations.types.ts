export type Category = 'equipment' | 'staff' | 'transport' | 'other';

export interface CalculationRow {
  id: string;
  event_id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  items_count?: number;
  total?: number;
}

export interface CalcItem {
  id?: string;
  calculation_id?: string;
  category: Category;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  unit_price: number;
  days: number;
  source: 'manual' | 'offer' | 'warehouse';
  source_ref?: string | null;
  position: number;
  vat_rate: number;
  editing?: boolean;
}

export interface WarehouseEquipment {
  id: string;
  name: string;
  brand: string | null;
  model: string | null;
  rental_price_per_day: number | null;
}

export interface ImportableItem {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  total: number;
  offerId: string;
  offerName: string;
  categoryName: string | null;
  autoCategory: Category;
  vat_rate: number;
}