export type ClientType = 'business' | 'individual';

export interface Client {
  id: string;
  client_type: ClientType;
  company_name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  phone_secondary: string | null;
  website: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  company_nip: string | null;
  company_regon: string | null;
  category: string;
  status: string;
  tags: string[] | null;
  notes: string | null;
  portal_access: boolean;
  portal_email: string | null;
  allowed_categories: string[] | null;
  custom_price_multiplier: number;
  portal_active_until: string | null;
  total_events: number;
  total_revenue: number;
  last_event_date: string | null;
  created_at: string;
}