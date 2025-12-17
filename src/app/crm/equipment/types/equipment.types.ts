import type { EquipmentUnit } from '@/store/slices/equipmentSlice';

/** ============ UI ============ */
export type EquipmentTabsCarouselType =
  | 'details'
  | 'technical'
  | 'purchase'
  | 'components'
  | 'units'
  | 'gallery'
  | 'history';

/** ============ Shared ============ */
export type UUID = string;
export type ISODate = string;      // YYYY-MM-DD
export type ISODateTime = string;  // timestamptz

/** Statusy sprzętu na evencie (Twoje) */
export type EventEquipmentStatus =
  | 'draft'
  | 'reserved'
  | 'in_use'
  | 'returned'
  | 'cancelled';

/** Zdarzenia na sztuce */
export type UnitEventType =
  | 'damage'
  | 'repair'
  | 'service'
  | 'status_change'
  | 'note'
  | 'inspection'
  | 'sold';

/** ============ Domain: Equipment Item (equipment_items) ============ */
export interface DimensionsCm {
  width?: number;
  height?: number;
  depth?: number;
}

export interface CableSpecs {
  type?: string;
  length_m?: number;
  connector_a?: string;
  connector_b?: string;
}

/**
 * 1:1 z tabelą equipment_items (row z bazy)
 * - trzymamy null dla pól opcjonalnych (tak zwraca Postgres/Supabase)
 * - is_active w DB masz nullable z default true -> w TS najbezpieczniej boolean | null
 */
export interface EquipmentItemRow {
  id: UUID;
  name: string;

  brand: string | null;
  model: string | null;
  description: string | null;

  thumbnail_url: string | null;
  user_manual_url: string | null;

  weight_kg: number | null;
  dimensions_cm: DimensionsCm | null;

  purchase_date: ISODate | null;
  purchase_price: number | null;
  current_value: number | null;
  warranty_until: ISODate | null;

  serial_number: string | null;
  barcode: string | null;

  notes: string | null;

  is_active: boolean | null;

  cable_specs: CableSpecs | null;
  warehouse_category_id: UUID | null;
  cable_stock_quantity: number | null;
  storage_location_id: UUID | null;

  deleted_at: ISODateTime | null;
  created_at: ISODateTime | null;
  updated_at: ISODateTime | null;
}

/** ============ Domain: Equipment Kit (equipment_kits) ============ */
export interface EquipmentKitRow {
  id: UUID;
  name: string;
  description: string | null;
  thumbnail_url: string | null;

  is_active: boolean; // u Ciebie NOT NULL default true
  created_by: UUID | null;

  created_at: ISODateTime;
  updated_at: ISODateTime;

  warehouse_category_id: UUID | null;
  deleted_at: ISODateTime | null;
}

/**
 * Pozycja w kicie (equipment_kit_items)
 * Uwaga: u Ciebie jest equipment_id OR cable_id (a nie oba)
 */
export interface EquipmentKitItemRow {
  id: UUID;
  kit_id: UUID;
  equipment_id: UUID | null;
  cable_id: UUID | null;

  quantity: number;
  notes: string | null;
  order_index: number;

  created_at: ISODateTime;
}

/** ============ Relacje / joiny (opcjonalne) ============ */
export interface EmployeeLite {
  name: string;
  surname: string;
}

export interface UnitEventRow {
  id: UUID;
  unit_id: UUID;
  event_type: UnitEventType;
  description: string;
  image_url: string | null;
  old_status: string | null;
  new_status: string | null;
  employee_id: UUID | null;
  created_at: ISODateTime;

  // join: employees(name, surname)
  employees: EmployeeLite | null;
}

/** ============ Unified DTO: “Equipment” do feed/listingu ============ */
/**
 * To jest typ, który możesz używać w feedzie (items + kits w jednym widoku).
 * Minimalne pola + flagi.
 */
export type EquipmentEntityType = 'item' | 'kit';

export interface EquipmentFeedItemBase {
  id: UUID;
  type: EquipmentEntityType;

  name: string;
  warehouse_category_id: UUID | null;
  thumbnail_url: string | null;

  description?: string | null;
  created_at?: ISODateTime | null;

  // tylko dla listingu (nie zawsze dociągasz)
  equipment_units?: EquipmentUnit[];
}

export interface EquipmentFeedItem extends EquipmentFeedItemBase {
  type: 'item';
  brand?: string | null;
  model?: string | null;
}

export interface EquipmentFeedKit extends EquipmentFeedItemBase {
  type: 'kit';
  // kity nie mają brand/model — zostawiamy undefined
}

export type EquipmentFeedEntity = EquipmentFeedItem | EquipmentFeedKit;

/** Helper: mapowanie z Twojego obecnego is_kit na type */
export const resolveEquipmentType = (row: { is_kit?: boolean }): EquipmentEntityType =>
  row.is_kit ? 'kit' : 'item';

/** ============ (Opcjonalnie) stary typ “Equipment” — do wywalenia ============ */
/**
 * Ten interface był mylący (category/quantity/available_quantity/unit_price/status).
 * Jeśli to jest pod "marketplace" albo "stock", nazwij to jasno:
 */
export interface EquipmentStockSummary {
  id: UUID;
  name: string;
  category: string;            // jeśli to nazwa kategorii (string), OK
  quantity: number;            // total
  available_quantity: number;  // available
  unit_price: number;          // np. purchase_price albo inna logika
  status: string;
}