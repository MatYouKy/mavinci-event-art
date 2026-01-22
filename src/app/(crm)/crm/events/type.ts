import { ClientType } from '../clients/type';
import { IEventCategory } from '../event-categories/types';
import { ILocation } from '../locations/type';
import { IEmployee } from '../employees/type';
import { IOfferItem } from '../offers/types';

export type SelectedItem = { id: string; quantity: number; notes: string; type: 'item' | 'kit' };

export interface IOffer {
  id: string;
  offer_number: string;
  event_id: string;
  client_id?: string | null;
  created_by?: string | null;
  total_amount?: number;
  valid_until?: string | null;
  status: string;
  pdf_url?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
  organization?: {
    id: string;
    name: string;
  } | null;
  contact?: {
    id: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
  } | null;
  creator?: {
    id: string;
    name: string;
    surname?: string;
  } | null;
}

export interface IEvent {
  location_id: any;
  id: string;
  name: string;
  description?: string;
  event_date: string;
  event_end_date?: string | null;
  location?: ILocation;
  status: string;
  budget?: number;
  final_cost?: number;
  notes?: string;
  category_id?: string | null;
  organization_id?: string | null;
  contact_person_id?: string | null;
  created_by?: string;
  created_at?: string;
  expected_revenue?: number;
  actual_revenue?: number;
  estimated_costs?: number;
  actual_costs?: number;
  client_type: ClientType;
  equipment?: SelectedItem[];
  creator?: IEmployee;
  organization?: {
    id: string;
    name: string;
    alias?: string | null;
  } | null;
  contact_person?: {
    phone: any;
    email: any;
    id: string;
    first_name: string;
    last_name: string;
    full_name: string;
  } | null;
  offer?: IOfferItem | null;
  category?: IEventCategory | null;
  employees?: IEmployee[];
  vehicles?: any[];
  attachments?: IEventAttachment[];
}

export interface IEventAttachment {
  id: string;
  name: string;
  url: string;
  size: number;
  type: string;
  created_at: string;
}