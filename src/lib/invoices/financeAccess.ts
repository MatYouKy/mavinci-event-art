import type { SupabaseClient } from '@supabase/supabase-js';

export type InvoiceFinanceAccess = {
  employeeId: string;
  authUserId: string;
  scope: 'sales' | 'company' | 'none';
  canViewOwnInvoices: boolean;
  canIssueInvoices: boolean;
  canViewCompanyFinance: boolean;
  canManageCompanyFinance: boolean;
  managedSellerContactIds: string[];
  managedSellerPartnerIds: string[];
  soldEventIds: string[];
};

/** Always resolve the authenticated session's scope, never a requested employee ID. */
export async function loadInvoiceFinanceAccess(client: SupabaseClient): Promise<InvoiceFinanceAccess> {
  const { data, error } = await client.rpc('get_invoice_finance_access');
  const flags = ['canViewOwnInvoices', 'canIssueInvoices', 'canViewCompanyFinance', 'canManageCompanyFinance'];
  const lists = ['managedSellerContactIds', 'managedSellerPartnerIds', 'soldEventIds'];
  if (error || !data || typeof data !== 'object' || Array.isArray(data)
    || !['sales', 'company', 'none'].includes(data.scope)
    || typeof data.employeeId !== 'string' || typeof data.authUserId !== 'string'
    || flags.some((key) => typeof data[key] !== 'boolean')
    || lists.some((key) => !Array.isArray(data[key]) || data[key].some((id: unknown) => typeof id !== 'string'))) {
    throw new Error('Nie udało się ustalić zakresu dostępu do finansów. Odśwież stronę lub skontaktuj się z administratorem.');
  }
  return data as InvoiceFinanceAccess;
}
