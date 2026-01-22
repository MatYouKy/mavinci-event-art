export type UUID = string;

export type ClientEntityType = 'organization' | 'contact' | 'individual';
export type ClientsTab = 'all' | 'subcontractors' | 'clients';

export type ContactType = 'contact' | 'individual'; // masz to jako text w DB
export type OrganizationType = 'client' | 'subcontractor'; // u Ciebie USER-DEFINED

export interface ContactRow {
  business_phone: ReactNode;
  id: UUID;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;

  email: string | null;
  phone: string | null;
  mobile: string | null;

  position: string | null;
  city: string | null;
  address: string | null;
  postal_code: string | null;
  country: string | null;

  avatar_url: string | null;
  avatar_metadata: any | null;

  tags: string[] | null;
  languages: string[] | null;

  status: string | null;
  rating: number | null;

  notes: string | null;
  created_at: string;
  updated_at: string;

  created_by: UUID | null;

  contact_type: ContactType;

  // masz w tabeli, zostawiam jako opcjonalne:
  nip?: string | null;
  company_name?: string | null;
  bank_account?: string | null;

  // wrażliwe – w kodzie możesz je od razu ukryć w UI
  pesel?: string | null;
  id_number?: string | null;
}

export interface OrganizationRow {
  id: UUID;

  organization_type: OrganizationType; // user-defined
  business_type: string | null;        // user-defined u Ciebie
  status: string | null;               // user-defined u Ciebie

  name: string;
  alias: string | null;
  nip: string | null;

  email: string | null;
  phone: string | null;
  website: string | null;

  address: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;

  tags: string[] | null;
  specialization: string[] | null;

  notes: string | null;
  rating: number | null;

  bank_account: string | null;

  google_maps_url: string | null;
  latitude: number | null;
  longitude: number | null;
  location_notes: string | null;
  location_id: UUID | null;

  hourly_rate: number | null;
  payment_terms: string | null;

  created_at: string;
  updated_at: string;
}

export interface ContactOrganizationRow {
  id: UUID;
  contact_id: UUID;
  organization_id: UUID;

  position: string | null;
  department: string | null;

  started_at: string | null;
  ended_at: string | null;

  is_current: boolean | null;
  is_primary: boolean | null;
  is_decision_maker: boolean | null;

  notes: string | null;

  created_at: string;
  updated_at: string;
}

/**
 * Unified list item dla UI (to jest to, co robiłeś w fetchAllContacts)
 */
export interface UnifiedClient {
  id: UUID;
  entityType: ClientEntityType;

  name: string;            // alias||name albo full_name
  email: string | null;
  phone: string | null;
  mobile?: string | null;

  city: string | null;

  status: string | null;
  rating: number | null;

  avatar_url?: string | null;
  tags?: string[] | null;

  created_at: string;

  // liczniki do UI:
  contacts_count?: number;        // dla organizacji
  organizations_count?: number;   // dla kontaktu

  // źródło i raw (opcjonalnie do edycji bez dodatkowych fetchy)
  source: 'organizations' | 'contacts';
  raw: OrganizationRow | ContactRow;
}

export type CreateOrganizationPayload = Partial<OrganizationRow> & {
  name: string;
  organization_type: OrganizationType;
};

export type UpdateOrganizationPayload = Partial<OrganizationRow>;

export type CreateContactPayload = Partial<ContactRow> & {
  contact_type: ContactType;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
};

export type UpdateContactPayload = Partial<ContactRow>;