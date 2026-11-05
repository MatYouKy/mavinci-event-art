import type { CommissionPaymentMethod, CommissionStatus } from './eventCommission';

export type CommissionSettlementMode = 'crm' | 'seller';
export type CommissionSettlementAccountType = 'contact' | 'partner' | 'employee' | 'organization';

export type CommissionSettlementPayment = {
  id: string;
  commission_id: string;
  amount: number;
  payment_date: string | null;
  recorded_at: string | null;
  reference: string | null;
  /** Internal CRM note; always null in the seller response. */
  note: string | null;
  source: 'ledger' | 'legacy' | 'offset';
  /** Potrącenie nadpłaty (rozliczenie bez przelewu). */
  is_offset?: boolean;
};

export type CommissionSettlement = {
  id: string;
  event_id: string;
  event_name: string;
  event_date: string | null;
  my_company_id: string | null;
  company_name: string | null;
  can_manage: boolean;
  beneficiary_name: string;
  /** Nominal recipient amount in PLN, not the company's grossed-up cost. */
  amount: number;
  /** Internal economic cost; always null in the seller response. */
  company_cost_amount: number | null;
  status: CommissionStatus;
  automatic_waiting_for_offer: boolean;
  created_at: string;
  due_date: string | null;
  payment_method: CommissionPaymentMethod;
  paid_amount: number;
  remaining_amount: number;
  payments: CommissionSettlementPayment[];
  /** Pola podsumowania wydarzenia (migracja 20261105130000) — w starszej bazie ich nie ma. */
  base_amount?: number | null;
  rate?: number | null;
  base_description?: string | null;
  rate_reason?: string | null;
  /** accrual = naliczenie, correction = dopłata, deduction = do potrącenia. */
  entry_kind?: 'accrual' | 'correction' | 'deduction' | null;
  corrects_commission_id?: string | null;
  automatic_source?: string | null;
  share_percent?: number | null;
  client_owned?: boolean | null;
  settlement_revision?: number | null;
  /** Potrącenie: ile jeszcze do potrącenia (remaining_amount potrącenia = 0). */
  to_offset?: number | null;
  /** Kwota ze znakiem (ujemna dla potrącenia). */
  signed_amount?: number | null;
  /** Ile rozliczono potrąceniem (paid_amount = przelewy i potrącenia razem). */
  offset_amount?: number | null;
};

/** Źródła prowizji liczonych z podsumowania wydarzenia (to samo co private.commission_auto_sources w bazie). */
export const AUTOMATIC_COMMISSION_SOURCES: readonly string[] = [
  'sales_share',
  'billing_contact',
  'event_referral',
  'partner_arrangement',
  'seller_portal',
  'manual_partner',
];

/** Wpis z podsumowania (także dopłata i potrącenie): nie zatwierdza się go ręcznie, kwotę ustala podsumowanie. */
export function isAutomaticCommission(row: { automatic_source?: string | null; entry_kind?: string | null }): boolean {
  return (row.entry_kind != null && row.entry_kind !== 'accrual') || AUTOMATIC_COMMISSION_SOURCES.includes(row.automatic_source ?? '');
}

export const AUTOMATIC_COMMISSION_HINT = 'Do wypłaty po zatwierdzeniu podsumowania wydarzenia';

export type CommissionSettlementsResponse = {
  mode: CommissionSettlementMode;
  accountType: CommissionSettlementAccountType;
  accountId: string;
  canManage: boolean;
  /** The existing commission model is denominated in PLN; no FX is inferred. */
  currency: 'PLN';
  commissions: CommissionSettlement[];
};
