// types/fleet.types.ts
export type VehicleStatus = 'active' | 'inactive' | 'in_service' | 'sold' | 'scrapped';
export type VehicleCategory = 'personal_car' | 'van' | 'truck' | 'bus' | 'motorcycle' | 'trailer';
export type VehicleType = 'car' | 'trailer' | 'other'; // dopasuj do swojej kolumny vehicle_type
export type InsuranceStatus = 'active' | 'expired' | 'scheduled' | 'inactive';

export type VehicleAlertType = 'insurance' | 'service' | 'inspection' | 'other'; // dopasuj do DB

export type InUseRow = {
  id: string;
  driver: {
    id: string;
    name: string;
    surname: string;
    avatar_url: string | null;
    avatar_metadata: unknown;
  } | null;
  event: {
    name: string | null;
  } | null;
};

export interface EmployeeLite {
  id: string;
  name: string;
  surname: string;
  avatar_url?: string | null;
  avatar_metadata?: any;
}

export interface VehicleDB {
  id: string;
  vehicle_type: string;
  name: string;
  brand: string;
  model: string;
  year: number | null;
  registration_number: string | null;
  vin: string | null;
  status: VehicleStatus | string;     // jeśli DB ma jeszcze inne
  category: VehicleCategory | string; // jeśli DB ma jeszcze inne
  fuel_type: string | null;
  current_mileage: number | null;
  color?: string | null;
  power_hp?: number | null;
  engine_capacity?: number | null;
  transmission?: string | null;
  ownership_type?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  description?: string | null;
  notes?: string | null;
  created_at: string;
  thumb_url: string | null;
}

export interface VehicleImageDB {
  id: string;
  vehicle_id: string;
  image_url: string;
  title: string | null;
  is_primary: boolean;
  sort_order: number | null;
}

export interface VehicleAssignmentDB {
  vehicle_id: string;
  employee_id: string;
  status: 'active' | 'inactive';
  employees?: EmployeeLite | null; // z join-a
}

export interface VehicleAlertDB {
  id: string;
  vehicle_id: string;
  alert_type: VehicleAlertType;
  is_active: boolean;
  related_id: string | null; // np. insurance_policies.id
  created_at: string;
}

export interface InsurancePolicyDB {
  id: string;
  vehicle_id: string;
  type: string; // OC/AC/NNW itd.
  insurance_company: string;
  policy_number: string;
  start_date: string;
  end_date: string;
  premium_amount: number;
  status: InsuranceStatus | string;
  notes: string | null;
}

export interface FuelEntryDB {
  id: string;
  vehicle_id: string;
  date: string;
  location: string | null;
  odometer_reading: number;
  fuel_type: string | null;
  liters: number;
  price_per_liter: number;
  total_cost: number;
  avg_consumption: number | null;
  distance_since_last: number | null;
  is_full_tank: boolean;
  notes: string | null;
  filled_by: string; // employee_id?
  employees?: Pick<EmployeeLite, 'name' | 'surname'> | null; // z join-a jak u Ciebie
}

// “In use” - wynik z event_vehicles joinowany do driver i event
export interface VehicleInUseInfo {
  id: string;
  is_in_use: boolean;
  pickup_timestamp: string | null;
  driver: EmployeeLite | null;
  event: { id: string; name: string } | null;
}

// ViewModel do listy floty (enriched)
export interface FleetVehicleVM extends VehicleDB {
  primary_image_url: string | null;
  all_images: { id: string; image_url: string; title: string | null }[];

  assigned_to: string | null;
  assigned_employee_name: string | null;
  assigned_employee_surname: string | null;
  assigned_employee_avatar_url: string | null;
  assigned_employee_avatar_metadata: any;

  upcoming_services: number;
  expiring_insurance: number;

  yearly_maintenance_cost: number;
  yearly_fuel_cost: number;
  avg_fuel_consumption_3months: number;

  in_use: boolean;
  in_use_by: string | null;
  in_use_event: string | null;

  in_use_driver_id: string | null;
  in_use_driver_name: string | null;
  in_use_driver_surname: string | null;
  in_use_driver_avatar_url: string | null;
  in_use_driver_avatar_metadata: any;
}

export interface MaintenanceGrouped {
  maintenance: any[];
  inspections: any[];
  oil: any[];
  timing: any[];
  repairs: any[];
}

export type FleetStats = {
  total: number;
  active: number;
  in_service: number;
  totalCost: number;
  averageMileage: number;
};

export interface IVehicle {
  id: string;
  name: string;
  brand: string;
  model: string;
  registration_number: string;
  vin: string;
  year: number;
  status: string;
  ownership_type: string;
  category: string;
  current_mileage: number;
  fuel_type: string;
  primary_image_url: string | null;
  thumb_url: string | null;
  all_images: { id: string; image_url: string; title: string | null }[];
  assigned_to: string | null;
  assigned_employee_name: string | null;
  assigned_employee_surname: string | null;
  assigned_employee_avatar_url: string | null;
  assigned_employee_avatar_metadata: any;
  upcoming_services: number;
  expiring_insurance: number;
  yearly_maintenance_cost: number;
  yearly_fuel_cost: number;
  avg_fuel_consumption_3months: number;
  in_use: boolean;
  in_use_by: string | null;
  in_use_event: string | null;
  in_use_driver_id: string | null;
  in_use_driver_name: string | null;
  in_use_driver_surname: string | null;
  in_use_driver_avatar_url: string | null;
  in_use_driver_avatar_metadata: any;
}