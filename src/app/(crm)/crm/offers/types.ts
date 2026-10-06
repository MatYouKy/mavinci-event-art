import type { ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';
import type { ProductAddon, OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { IEventCategory } from '../event-categories/types';

export type ContractClauseCategory =
  | 'conditions'
  | 'requirements'
  | 'obligations'
  | 'risks'
  | 'additional_requirements'
  | 'general';
export type ContractClausesByCategory = Partial<Record<ContractClauseCategory, string>>;

export interface IProductVariant {
  id: string;
  product_id?: string;
  name: string;
  short_description?: string | null;
  description?: string | null;
  benefits: string[];
  offer_image_path?: string | null;
  offer_image_alt?: string | null;
  price_net: number;
  price_gross: number;
  service_duration_hours?: number | null;
  extension_price_net_per_hour?: number | null;
  is_recommended: boolean;
  is_active: boolean;
  display_order: number;
  overrides_equipment?: boolean;
  overrides_staff?: boolean;
  overrides_mavinci_live?: boolean;
  overrides_contract_clauses?: boolean;
  recommended_contract_clauses?: string | null;
  recommended_contract_clause_category?: ContractClauseCategory;
}

export interface IProduct {
  related_service_ids?: string[];
  related_service_url?: string | null;
  related_service_label?: string | null;
  sales_packages?: ProductSalesPackage[];
  sales_packages_enabled?: boolean;
  pricing_addons?: ProductAddon[];
  id: string;
  name: string;
  description: string;
  base_price: number;
  unit: string;
  vat_rate?: number | null;
  price_net?: number | null;
  price_gross?: number | null;
  service_duration_hours?: number | null;
  extension_price_net_per_hour?: number | null;
  offer_description?: string | null;
  offer_compact_description?: string | null;
  offer_requirements?: string[] | null;
  offer_additional_requirements?: Array<{
    id: string;
    category:
      | 'power'
      | 'internet'
      | 'access'
      | 'setup'
      | 'surface'
      | 'venue_approval'
      | 'coordination'
      | 'schedule'
      | 'safety'
      | 'technical'
      | 'accommodation'
      | 'backstage'
      | 'hospitality'
      | 'logistics'
      | 'other';
    title: string;
    description: string;
  }> | null;
  pdf_thumbnail_url?: string | null;
  offer_image_path?: string | null;
  product_page_url?: string | null;
  offer_image_position_x?: number | null;
  offer_image_position_y?: number | null;
  offer_image_zoom?: number | null;
  recommended_contract_clauses?: string | null;
  recommended_contract_clause_category?: ContractClauseCategory;
  category?: IEventCategory | null;
  category_id?: string | null;
  variants?: IProductVariant[];
  offer_product_variants?: IProductVariant[];
}

export interface IOfferItem {
  pricing_configuration?: OfferConfiguration | null;
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
  product_variant_id?: string | null;
  offer_page_variant_override?: 'compact' | 'default' | 'visual' | null;
  variant_prices_net?: Record<string, number>;
  show_variant_prices_in_pdf?: boolean;
  show_product_variants_in_pdf?: boolean;
  product_variant?: IProductVariant | null;
  product?: IProduct; // Ominąć
}

export type OfferRequirementEntry = {
  key: string;
  category: string;
  title: string;
  description: string;
  sources: string[];
  origin: 'template' | 'product' | 'manual';
  included: boolean;
  priority: number;
};

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

export type StaffPaymentType = 'invoice_with_vat' | 'invoice_no_vat' | 'cash_no_receipt' | 'cash_documented';

export type ProductStaffRow = {
  id: string;
  product_id: string;
  product_variant_id?: string | null;

  role: string;
  quantity: number;
  hourly_rate: number | null;
  estimated_hours: number | null;

  is_optional: boolean;
  notes: string | null;

  payment_type: StaffPaymentType;
  compensation?: import('@/lib/CRM/Offers/productSalesPackages').PackageStaffCompensation | null;
};

export type ProductEquipmentMode = 'item' | 'kit' | 'rental';

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
  product_variant_id: string | null;
  equipment_item_id: string | null;
  equipment_kit_id: string | null;
  rental_equipment_id: string | null;
  subcontractor_id: string | null;
  is_rental: boolean | null;
  replaced_by_rental_id: string | null;
  quantity: number | null;
  is_optional: boolean | null;
  notes: string | null;
  created_at: string | null;
};

export type CreateOfferProductEquipmentArgs =
  | {
      mode: 'item';
      product_id: string;
      product_variant_id?: string | null;
      equipment_item_id: string;
      quantity?: number;
      is_optional?: boolean;
      notes?: string | null;
    }
  | {
      mode: 'kit';
      product_id: string;
      product_variant_id?: string | null;
      equipment_kit_id: string;
      quantity?: number;
      is_optional?: boolean;
      notes?: string | null;
    };
