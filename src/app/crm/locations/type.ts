export interface ILocation {
  id: string;
  name: string;
  address?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  nip?: string;
  contact_person_name?: string;
  contact_phone?: string;
  contact_email?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  google_maps_url?: string;
  google_place_id?: string;
  formatted_address?: string;
  created_at: string;
}