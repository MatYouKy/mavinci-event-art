'use client';

import { supabase } from '@/lib/supabase/browser';
import type { SellerAddressParts } from '@/lib/seller/contactAddress';

export type SellerContactKind = 'person' | 'organization';
export type SellerContactFilter = 'all' | 'individual' | 'business' | 'organizations' | 'persons';
export type SellerContact = {
  id: string;
  my_company_id: string;
  kind: SellerContactKind;
  organization_id: string | null;
  organization_name: string | null;
  name: string;
  company: string;
  email: string;
  phone: string;
  position: string;
  tax_id: string;
  address: string;
  address_parts?: SellerAddressParts | null;
  website: string;
  revision: number;
  people_count: number;
};
export type SellerContactOrganization = { id: string; company: string; my_company_id: string };
export const sellerContactName = (contact: SellerContact) => contact.kind === 'organization' ? contact.company : contact.name;
export const sellerContactTypeLabel = (contact: SellerContact) => contact.kind === 'organization'
  ? 'Organizacja' : contact.organization_id || contact.company ? 'Kontakt firmowy' : 'Kontakt indywidualny';

export function sellerContactError(cause: unknown, fallback: string) {
  const error = cause as { code?: string; message?: string } | null;
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST204'].includes(error?.code || '')) {
    return 'Kontakty wymagają aktualizacji bazy: „seller_contacts_and_organizations” oraz „seller_organization_address_parts”. Poproś administratora o wdrożenie migracji.';
  }
  if (['42501', 'PGRST301', 'PGRST303'].includes(error?.code || '')) {
    return 'Brak dostępu do tej bazy klientów lub sesja wygasła. Zaloguj się ponownie i spróbuj jeszcze raz.';
  }
  if (['P0001', '40001'].includes(error?.code || '') && error?.message) return error.message;
  if (error?.code === '23505') return 'Kontakt z tymi danymi już istnieje. Otwórz jego edycję.';
  return fallback;
}

export async function loadSellerContacts(options: {
  companyId?: string; query?: string; kind?: SellerContactFilter;
  organizationId?: string; limit?: number; offset?: number; signal?: AbortSignal;
} = {}): Promise<{ items: SellerContact[]; total: number }> {
  let request = supabase.rpc('get_seller_portal_contacts', {
    p_company_id: options.companyId || null,
    p_query: options.query || '',
    p_kind: options.kind || 'all',
    p_organization: options.organizationId || null,
    p_limit: options.limit ?? 25,
    p_offset: options.offset ?? 0,
  });
  if (options.signal) request = request.abortSignal(options.signal);
  const { data, error } = await request;
  if (error) throw error;
  if (!data || !Array.isArray(data.items) || !Number.isFinite(Number(data.total))) throw new Error('Invalid contacts response');
  return { items: data.items as SellerContact[], total: Number(data.total) };
}
