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
  created_at: string;
  updated_at: string;
}