import { IStorageLocation } from '../../../types/equipment.types';

export type UnitStatus = 'available' | 'in_use' | 'service' | 'lost' | 'retired';

export type UnitEventType = 'damage' | 'repair' | 'service' | 'status_change' | 'note' | 'inspection' | 'sold';

export interface IEquipmentUnitHistory {
  type: UnitEventType;
  description?: string;
  image_url?: string | null;
  at: string; 
  old_status?: UnitStatus | null;
  new_status?: UnitStatus | null;
}

export interface IEquipmentUnit {          
  _id?: string;
  unit_serial_number?: string | null;
  evidence_number?: string | null;
  status: UnitStatus;
  location_id?: string | null;
  thumbnail_url?: string | null;
  storage_location?: IStorageLocation;
  purchase_date?: string | null;
  purchase_price?: number | null;
  invoice_number?: string | null;

  last_service_date?: string | null;
  service_cost?: number | null;

  device_history?: IEquipmentUnitHistory[];
}

export interface ICableSpecs {
  length_meters: number;
  connector_in: string;
  connector_out: string;
  storage_location: IStorageLocation;
  total_quantity: number;
}