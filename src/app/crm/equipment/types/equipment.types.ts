
export  type  EquipmentTabsCarouselType = 'details' | 'technical' | 'purchase' | 'components' | 'units' | 'gallery' | 'history'
export type UnitEventType = 'damage' | 'repair' | 'service' | 'status_change' | 'note' | 'inspection' | 'sold';

export interface Equipment {
  id: string;
  name: string;
  category: string;
  quantity: number;
  available_quantity: number;
  unit_price: number;
  status: string;
}

export interface UnitEvent {
  id: string;
  unit_id: string;
  event_type: 'damage' | 'repair' | 'service' | 'status_change' | 'note' | 'inspection' | 'sold';
  description: string;
  image_url: string | null;
  old_status: string | null;
  new_status: string | null;
  employee_id: string | null;
  created_at: string;
  employees: { name: string; surname: string } | null;
}