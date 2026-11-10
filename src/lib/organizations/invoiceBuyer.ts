import { supabase } from '@/lib/supabase/browser';
import type { OrganizationInvoiceRecipientRole } from '@/components/crm/contacts/organization/organizationValidation';

/**
 * Nabywca na fakturach wskazany w karcie organizacji (np. szkoła → gmina).
 * Klientem wydarzenia i stroną umowy zostaje jednostka; fakturę wystawiamy na nabywcę,
 * a jednostka trafia na nią jako odbiorca (KSeF Podmiot3: rola 8 dla JST, rola 2 dla oddziału).
 */
export type InvoiceBuyerOrganization = {
  id: string;
  name: string;
  alias: string | null;
  nip: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
};

export type InvoiceBuyerLink = {
  unitOrganizationId: string;
  role: OrganizationInvoiceRecipientRole;
  buyer: InvoiceBuyerOrganization;
};

export const invoiceRecipientRoleLabels: Record<OrganizationInvoiceRecipientRole, string> = {
  8: 'Jednostka podrzędna JST (np. szkoła, przedszkole)',
  2: 'Oddział lub jednostka wewnętrzna nabywcy',
};

export const invoiceRecipientRoleShortLabels: Record<OrganizationInvoiceRecipientRole, string> = {
  8: 'JST',
  2: 'jednostka wewnętrzna',
};

const BUYER_COLUMNS = 'id,name,alias,nip,address,postal_code,city';

const isMissingColumn = (error: { code?: string } | null) => error?.code === '42703' || error?.code === 'PGRST204';

/** Nabywca faktur dla organizacji albo null, gdy faktury wystawiamy na nią samą. */
export async function fetchInvoiceBuyerLink(organizationId?: string | null): Promise<InvoiceBuyerLink | null> {
  if (!organizationId) return null;
  const { data: unit, error } = await (supabase.from as any)('organizations')
    .select('id,invoice_buyer_organization_id,invoice_recipient_role')
    .eq('id', organizationId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) return null;
    throw error;
  }
  if (!unit?.invoice_buyer_organization_id) return null;
  const { data: buyer, error: buyerError } = await supabase
    .from('organizations')
    .select(BUYER_COLUMNS)
    .eq('id', unit.invoice_buyer_organization_id)
    .maybeSingle();
  if (buyerError) throw buyerError;
  if (!buyer) return null;
  return {
    unitOrganizationId: unit.id,
    role: unit.invoice_recipient_role === 2 ? 2 : 8,
    buyer: buyer as InvoiceBuyerOrganization,
  };
}

export type InvoiceUnitOrganization = {
  id: string;
  name: string;
  alias: string | null;
  invoice_recipient_role: OrganizationInvoiceRecipientRole | null;
};

/** Jednostki (np. szkoły), których faktury wystawiamy na tę organizację (np. gminę). */
export async function fetchInvoiceUnits(buyerOrganizationId?: string | null): Promise<InvoiceUnitOrganization[]> {
  if (!buyerOrganizationId) return [];
  const { data, error } = await (supabase.from as any)('organizations')
    .select('id,name,alias,invoice_recipient_role')
    .eq('invoice_buyer_organization_id', buyerOrganizationId)
    .order('name');
  if (error) {
    if (isMissingColumn(error)) return [];
    throw error;
  }
  return (data || []) as InvoiceUnitOrganization[];
}
