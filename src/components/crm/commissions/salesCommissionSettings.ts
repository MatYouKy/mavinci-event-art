import type { CommissionPaymentMethod } from '@/lib/events/settlement/eventSettlement';

/** Wynik get_sales_commission_settings / set_sales_commission_defaults / set_employee_sales_commission_terms. */
export type SalesCommissionEmployeeTerms = {
  employee_id: string;
  name: string;
  is_active: boolean;
  role: string | null;
  enabled: boolean;
  /** Własna stawka pracownika; null = stawka globalna. */
  standard_rate: number | null;
  own_client_rate: number | null;
  payment_method: CommissionPaymentMethod;
  updated_at: string | null;
};

export type SalesCommissionSettings = {
  standard_rate: number;
  own_client_rate: number;
  employer_social_rate: number | null;
  dividend_rate: number | null;
  employees: SalesCommissionEmployeeTerms[];
};

export const PAYMENT_METHODS: CommissionPaymentMethod[] = ['payroll', 'invoice', 'cash_dividend', 'other'];

const numOrNull = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const paymentMethod = (value: unknown): CommissionPaymentMethod =>
  value === 'cash_dividend' || value === 'invoice' || value === 'other' ? value : 'payroll';

export function parseSalesCommissionSettings(data: unknown): SalesCommissionSettings | null {
  if (!data || typeof data !== 'object') return null;
  const raw = data as Record<string, unknown>;
  const employees = Array.isArray(raw.employees) ? (raw.employees as Record<string, unknown>[]) : [];
  return {
    standard_rate: numOrNull(raw.standard_rate) ?? 5,
    own_client_rate: numOrNull(raw.own_client_rate) ?? 10,
    employer_social_rate: numOrNull(raw.employer_social_rate),
    dividend_rate: numOrNull(raw.dividend_rate),
    employees: employees
      .filter(row => row && typeof row === 'object' && typeof row.employee_id === 'string')
      .map(row => ({
        employee_id: String(row.employee_id),
        name: typeof row.name === 'string' && row.name.trim() ? row.name : 'Pracownik',
        is_active: row.is_active !== false,
        role: typeof row.role === 'string' ? row.role : null,
        enabled: row.enabled === true,
        standard_rate: numOrNull(row.standard_rate),
        own_client_rate: numOrNull(row.own_client_rate),
        payment_method: paymentMethod(row.payment_method),
        updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
      })),
  };
}

/** Stawka w polu: „5” / „12,5”; puste = stawka globalna. */
export const rateInputValue = (value: number | null): string => (value == null ? '' : String(value).replace('.', ','));
