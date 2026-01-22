import type { EquipmentUnit } from '@/store/slices/equipmentSlice';

/** =========================
 *  UI
 *  ========================= */
export type EquipmentTabsCarouselType =
  | 'details'
  | 'technical'
  | 'purchase'
  | 'components'
  | 'units'
  | 'gallery'
  | 'history';

/** =========================
 *  Shared / primitives
 *  ========================= */
export type UUID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // timestamptz (string)

export type PGNumeric = number | string; // Supabase numeric bywa string

/** Statusy sprzętu na evencie */
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

/** =========================
 *  DB: equipment_items (Row 1:1)
 *  ========================= */
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

export interface EquipmentItemRow {
  id: UUID;
  name: string;

  brand: string | null;
  model: string | null;
  description: string | null;

  thumbnail_url: string | null;
  user_manual_url: string | null;

  weight_kg: PGNumeric | null; // numeric
  dimensions_cm: DimensionsCm | null; // jsonb

  purchase_date: ISODate | null;
  purchase_price: PGNumeric | null; // numeric
  current_value: PGNumeric | null; // numeric
  warranty_until: ISODate | null;

  serial_number: string | null;
  barcode: string | null;

  notes: string | null;
  is_active: boolean | null;

  cable_specs: CableSpecs | null; // jsonb
  warehouse_category_id: UUID | null;
  cable_stock_quantity: number | null;
  storage_location_id: UUID | null;

  deleted_at: ISODateTime | null;
  created_at: ISODateTime | null;
  updated_at: ISODateTime | null;
}

/** =========================
 *  DB: equipment_kits (Row 1:1)
 *  ========================= */
export interface EquipmentKitRow {
  id: UUID;
  name: string;
  description: string | null;
  thumbnail_url: string | null;

  is_active: boolean; // NOT NULL default true
  created_by: UUID | null;

  created_at: ISODateTime;
  updated_at: ISODateTime;

  warehouse_category_id: UUID | null;
  deleted_at: ISODateTime | null;
}

/** DB: equipment_kit_items (Row 1:1) */
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

/** =========================
 *  DB: event_equipment (Row 1:1)
 *  ========================= */
export interface EventEquipmentRow {
  id: UUID;
  event_id: UUID;

  equipment_id: UUID | null;
  kit_id: UUID | null;
  cable_id: UUID | null;
  offer_id: UUID | null;

  quantity: number | null;
  notes: string | null;

  created_at: ISODateTime | null;
  updated_at: ISODateTime | null;

  status: EventEquipmentStatus;

  auto_added: boolean;
  auto_quantity: number | null;

  is_overridden: boolean;
  removed_from_offer: boolean;

  offer_quantity: number | null;
}

/** =========================
 *  Joins / DTO (to co zwracasz z Supabase .select)
 *  ========================= */

/** Lekki widok kategorii (z Twojego payloadu: equipment.category.name) */
export interface WarehouseCategoryDTO {
  name: string;
}

/**
 * To jest dokładnie to co pokazałeś w payloadzie:
 * equipment: { name, brand, model, category: { name }, cable_specs, thumbnail_url }
 *
 * UWAGA: w DB jest warehouse_category_id, ale Ty zwracasz "category"
 * więc w DTO używamy `category`.
 */
export interface EquipmentItemDTO {
  name: string;
  brand: string | null;
  model: string | null;
  category: WarehouseCategoryDTO | null;
  cable_specs: CableSpecs | null;
  thumbnail_url: string | null;
}

/** Jeżeli kit też ma podobny “view” (na razie minimalnie) */
export interface EquipmentKitDTO {
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  // jeśli zwracasz kategorię dla kita, dodaj:
  category?: WarehouseCategoryDTO | null;
  // jeśli zwracasz elementy kita, dopniemy później:
  equipment_kit_items?: Array<{
    quantity: number;
    equipment?: { name: string; model: string | null } | null;
    cable?: { name: string; length_m?: number | null } | null;
  }>;
}

/**
 * EventEquipment z joinami – dokładnie pod Twoje dane:
 * - equipment: EquipmentItemDTO | null
 * - kit: EquipmentKitDTO | null
 */
export interface EventEquipmentWithJoins extends EventEquipmentRow {
  equipment: EquipmentItemDTO | null;
  kit: EquipmentKitDTO | null;
}

/** =========================
 *  Units / history (zostaje, ale porządniej)
 *  ========================= */
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

  employees: EmployeeLite | null; // join
}

/** =========================
 *  UI: Feed/listing (items + kits razem)
 *  ========================= */
export type EquipmentEntityType = 'item' | 'kit';

export interface EquipmentFeedBase {
  id: UUID;
  type: EquipmentEntityType;
  name: string;

  thumbnail_url: string | null;
  warehouse_category_id: UUID | null;

  description?: string | null;
  created_at?: ISODateTime | null;

  // opcjonalnie dociągane w detalach/listach
  equipment_units?: EquipmentUnit[];
}

export interface EquipmentFeedItem extends EquipmentFeedBase {
  type: 'item';
  brand?: string | null;
  model?: string | null;
}

export interface EquipmentFeedKit extends EquipmentFeedBase {
  type: 'kit';
}

export type EquipmentFeedEntity = EquipmentFeedItem | EquipmentFeedKit;

export const resolveEquipmentType = (row: { is_kit?: boolean }): EquipmentEntityType =>
  row.is_kit ? 'kit' : 'item';

/** =========================
 *  Osobny byt: Stock/Availability (nie mieszamy z Equipment)
 *  ========================= */
export interface EquipmentStockSummary {
  equipment_id: UUID;
  name: string;
  category_name: string | null;

  total_qty: number;
  reserved_qty: number;
  available_qty: number;

  // jeśli masz “cenę dzienną / katalogową” – nazwij to jasno
  unit_price?: PGNumeric | null;
}