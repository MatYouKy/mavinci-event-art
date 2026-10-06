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
  source: 'ledger' | 'legacy';
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
};

export type CommissionSettlementsResponse = {
  mode: CommissionSettlementMode;
  accountType: CommissionSettlementAccountType;
  accountId: string;
  canManage: boolean;
  /** The existing commission model is denominated in PLN; no FX is inferred. */
  currency: 'PLN';
  commissions: CommissionSettlement[];
};
