import { IContractTemplate } from '../contract-templates/type';

export interface ICustomIcon {
  id: string;
  name: string;
  svg_code: string;
  preview_color?: string;
}

export interface IEventCategory {
  id: string;
  name: string;
  color: string;
  description: string | null;
  is_active: boolean;
  icon_id: string | null;
  icon?: ICustomIcon;
  contract_template_id: string | null;
  contract_template?: IContractTemplate;
  /** Domyślna marka realizująca nowych eventów (po migracji cenników sezonowych; wcześniej brak kolumny). */
  default_my_company_id?: string | null;
  /** Marka obowiązkowa — nowy event tej kategorii zawsze ją dostaje (np. Wesele → Event Rulers). */
  company_locked?: boolean;
  created_at: string;
  updated_at: string;
}