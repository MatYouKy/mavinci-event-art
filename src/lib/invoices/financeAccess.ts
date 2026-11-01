import type { SupabaseClient } from '@supabase/supabase-js';
import {
  financeLevelAtLeast,
  normalizeFinanceCompanyAccess,
  type FinanceCompanyLevel,
} from '@/lib/financeCompanyAccess';

export type InvoiceFinanceAccess = {
  employeeId: string;
  authUserId: string;
  scope: 'sales' | 'company' | 'none';
  /** sales_lead = sprzedaż z kosztami i marżą własnych wydarzeń, bez wystawiania faktur. */
  tier?: 'sales' | 'sales_lead' | 'company' | 'none';
  canPlanOwnEventCosts?: boolean;
  canViewOwnInvoices: boolean;
  canIssueInvoices: boolean;
  canViewCompanyFinance: boolean;
  canManageCompanyFinance: boolean;
  managedSellerContactIds: string[];
  managedSellerPartnerIds: string[];
  soldEventIds: string[];
  /** Administrator: niejawnie „finance_manage” we wszystkich działalnościach. */
  isAdmin: boolean;
  /** Poziom dostępu do finansów według działalności (bez wpisów „none”). */
  companyLevels: Record<string, FinanceCompanyLevel>;
  /** Działalności z poziomem co najmniej: sales / invoices / invoices_issue / finance_view / finance_manage. */
  salesCompanyIds: string[];
  invoiceViewCompanyIds: string[];
  invoiceIssueCompanyIds: string[];
  financeViewCompanyIds: string[];
  financeManageCompanyIds: string[];
  /** Globalne finances_view / finances_manage — wyłącznie wartości finansowe wydarzeń. */
  canViewEventFinance: boolean;
  canManageEventFinance: boolean;
};

/** Poziom zalogowanego pracownika w działalności (administrator: finance_manage). */
export function financeCompanyLevel(access: InvoiceFinanceAccess | null | undefined, companyId: string | null | undefined): FinanceCompanyLevel {
  if (!access) return 'none';
  if (access.isAdmin) return 'finance_manage';
  if (!companyId) return 'none';
  return access.companyLevels[companyId] ?? 'none';
}

export function canFinanceCompany(
  access: InvoiceFinanceAccess | null | undefined,
  companyId: string | null | undefined,
  required: FinanceCompanyLevel,
): boolean {
  return financeLevelAtLeast(financeCompanyLevel(access, companyId), required);
}

/**
 * Działalności z co najmniej danym poziomem spośród podanych (np. lista z my_companies).
 * Administrator dostaje wszystkie podane działalności.
 */
export function filterFinanceCompanies<T extends { id: string }>(
  access: InvoiceFinanceAccess | null | undefined,
  companies: T[],
  required: FinanceCompanyLevel,
): T[] {
  if (!access) return [];
  return companies.filter((company) => canFinanceCompany(access, company.id, required));
}

/** Always resolve the authenticated session's scope, never a requested employee ID. */
export async function loadInvoiceFinanceAccess(client: SupabaseClient): Promise<InvoiceFinanceAccess> {
  const { data, error } = await client.rpc('get_invoice_finance_access');
  const flags = ['canViewOwnInvoices', 'canIssueInvoices', 'canViewCompanyFinance', 'canManageCompanyFinance',
    'isAdmin', 'canViewEventFinance', 'canManageEventFinance'];
  const lists = ['managedSellerContactIds', 'managedSellerPartnerIds', 'soldEventIds', 'salesCompanyIds',
    'invoiceViewCompanyIds', 'invoiceIssueCompanyIds', 'financeViewCompanyIds', 'financeManageCompanyIds'];
  if (error || !data || typeof data !== 'object' || Array.isArray(data)
    || !['sales', 'company', 'none'].includes(data.scope)
    || typeof data.employeeId !== 'string' || typeof data.authUserId !== 'string'
    || flags.some((key) => typeof data[key] !== 'boolean')
    || lists.some((key) => !Array.isArray(data[key]) || data[key].some((id: unknown) => typeof id !== 'string'))
    || !data.companyLevels || typeof data.companyLevels !== 'object' || Array.isArray(data.companyLevels)) {
    throw new Error('Nie udało się ustalić zakresu dostępu do finansów. Odśwież stronę lub skontaktuj się z administratorem.');
  }
  return { ...data, companyLevels: normalizeFinanceCompanyAccess(data.companyLevels) } as InvoiceFinanceAccess;
}
