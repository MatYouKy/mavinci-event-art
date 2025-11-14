import { ISingleImage } from '@/types/image';
import { ICableSpecs, IEquipmentDetails, IEquipmentTechnical, IEquipmentUnit, IStockHistoryEntry } from '../types/equipment.types';

export type QuantityTrackingMode = 'aggregate' | 'unitized';

export type UnitStatus = 'available' | 'damaged' | 'in_service' | 'retired';

export interface NewEquipmentQuantity {
  tracking: 'aggregate' | 'unitized';
  cable: ICableSpecs | null;              // wypełnione dla kabli
  units: IEquipmentUnit[] | null;         // wypełnione dla reszty
  available_quantity: number;             // wygodny cache dla list/kolorystyki
  storage_location: string | null;        // id lokacji (globalnie)
}
