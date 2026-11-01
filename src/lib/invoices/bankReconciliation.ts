/**
 * Uzgadnianie wyciągów — typy i etykiety ekranu „Uzgodnienie wyciągów”.
 * Logika jest w bazie (reconcile_bank_month, get_bank_reconciliation_month); tu tylko opis dla ludzi.
 */

export type ReconciliationStatus = 'matched' | 'explained' | 'transfer' | 'proposal' | 'choice' | 'partial' | 'missing';

export interface ReconciliationProposalDocument {
  source: 'ksef' | 'invoice' | 'external';
  id: string;
  number?: string | null;
  party?: string | null;
  amount: number;
  due?: number;
  open?: number;
  manual?: boolean;
  due_date?: string | null;
  issue_date?: string | null;
  evidence?: string | null;
}

export interface ReconciliationProposal {
  id: string;
  kind: 'allocate' | 'choose' | 'hint';
  rule: string;
  reason: string;
  documents: ReconciliationProposalDocument[];
}

export interface ReconciliationAllocation {
  match_id: string;
  source: string;
  document_id: string;
  number: string | null;
  party: string | null;
  amount: number;
  method: 'automatic' | 'manual' | 'legacy' | string;
  reasons: string[] | null;
  created_at: string;
}

export interface ReconciliationTransaction {
  id: string;
  statement_id: string;
  date: string;
  amount: number;
  direction: 'credit' | 'debit';
  currency: string;
  counterparty: string | null;
  counterparty_account: string | null;
  title: string | null;
  source_description: string | null;
  account_kind: 'regular' | 'vat';
  source_confirmation: 'single_source' | 'confirmed' | 'unconfirmed';
  allocated: number;
  remaining: number;
  status: ReconciliationStatus;
  allocations: ReconciliationAllocation[];
  personnel: Array<{ id: string; recipient: string; amount: number; title: string | null }>;
  explanation: { category: string; subtype: string | null; note: string | null; by: string | null } | null;
  proposal: ReconciliationProposal | null;
}

export interface ReconciliationSource {
  id: string;
  kind: 'regular' | 'vat';
  format: string | null;
  file_name: string;
  transactions_count: number;
  opening_balance: number | null;
  closing_balance: number | null;
  confirmed: number;
  unconfirmed: number;
  created_at: string;
}

export interface ReconciliationDocumentRow {
  source: string;
  id: string;
  number: string | null;
  party: string | null;
  side: 'issued' | 'received';
  due: number;
  open: number;
  manual_paid: number;
  payment_date: string | null;
  due_date: string | null;
  issue_date: string | null;
  payment_status?: string | null;
}

export interface ReconciliationMonth {
  company_id: string;
  year: number;
  month: number;
  sources: ReconciliationSource[];
  last_run: { created_at: string; summary: Record<string, unknown> } | null;
  transactions: ReconciliationTransaction[];
  paid_without_statement: ReconciliationDocumentRow[];
  shadow_documents: ReconciliationDocumentRow[];
  unpaid_due: ReconciliationDocumentRow[];
}

export const RECONCILIATION_STATUS_ORDER: ReconciliationStatus[] = [
  'matched', 'explained', 'transfer', 'proposal', 'choice', 'partial', 'missing',
];

export const RECONCILIATION_STATUS_META: Record<ReconciliationStatus, { label: string; chip: string; text: string }> = {
  matched: { label: 'Rozliczona', chip: 'bg-green-500/15 text-green-300', text: 'text-green-300' },
  explained: { label: 'Wyjaśniona bez faktury', chip: 'bg-teal-500/15 text-teal-300', text: 'text-teal-300' },
  transfer: { label: 'Przeniesienie własne', chip: 'bg-slate-500/20 text-slate-300', text: 'text-slate-300' },
  proposal: { label: 'Propozycja', chip: 'bg-amber-500/15 text-amber-300', text: 'text-amber-300' },
  choice: { label: 'Do wyboru', chip: 'bg-orange-500/15 text-orange-300', text: 'text-orange-300' },
  partial: { label: 'Częściowo rozliczona', chip: 'bg-blue-500/15 text-blue-300', text: 'text-blue-300' },
  missing: { label: 'Brak dokumentu', chip: 'bg-red-500/15 text-red-300', text: 'text-red-300' },
};

const PROPOSAL_RULES: Record<string, string> = {
  numer_i_kwota: 'Numer i kwota się zgadzają',
  oplacona_recznie: 'Opłacona ręcznie — wyciąg to potwierdza',
  numer_czesciowa: 'Płatność częściowa lub zaliczka',
  numer_inna_kwota: 'Numer w tytule, inna kwota',
  kilka_numerow: 'Kilka faktur w jednym przelewie',
  kwota_i_kontrahent: 'Zgodna kwota i kontrahent',
  tylko_kwota: 'Zgodna kwota — sprawdź kontrahenta',
  kwota_wiele: 'Kilka dokumentów z tą kwotą',
  platnosc_zbiorcza: 'Płatność zbiorcza (koszyk)',
  brak_dokumentu: 'Brak dokumentu w systemie',
};

export const proposalRuleLabel = (rule: string) => PROPOSAL_RULES[rule] || 'Propozycja';

export const matchMethodLabel = (method: string) =>
  method === 'automatic' ? 'automatycznie' : method === 'legacy' ? 'przeniesione' : 'ręcznie';

const SUBTYPES: Record<string, string> = {
  zus_payment: 'ZUS',
  pit4_payment: 'PIT-4R',
  vat7_payment: 'VAT-7',
  payroll_payment: 'Wynagrodzenie',
  bank_fee: 'Opłata bankowa',
  own_transfer: 'Przelew własny',
  automatic_vat_transfer: 'Transfer rachunek bieżący ↔ VAT',
  cash_settlement: 'Rozliczenie gotówkowe',
  supplier_invoice_missing: 'Brak faktury od dostawcy',
};

const CATEGORIES: Record<string, string> = {
  tax_or_zus: 'Podatek / ZUS',
  bank_fee: 'Opłata bankowa',
  payroll: 'Wynagrodzenie',
  own_transfer: 'Przelew własny',
  cash: 'Gotówka',
  foreign_purchase: 'Brak faktury od dostawcy',
  other: 'Inne wyjaśnienie',
};

export const explanationLabel = (category: string, subtype?: string | null) =>
  (subtype && SUBTYPES[subtype]) || CATEGORIES[category] || 'Wyjaśnienie';

const plural = (n: number, one: string, few: string, many: string) => {
  if (n === 1) return one;
  const lastTwo = n % 100;
  const last = n % 10;
  return last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? few : many;
};

/** „5 rozliczonych automatycznie, 2 potwierdzone płatności ręczne, …” */
export function reconciliationRunSentence(summary: Record<string, unknown> | null | undefined): string {
  if (!summary) return '';
  const n = (key: string) => Number(summary[key] || 0);
  const parts: string[] = [];
  if (n('auto_matched')) parts.push(`${n('auto_matched')} ${plural(n('auto_matched'), 'operacja rozliczona', 'operacje rozliczone', 'operacji rozliczonych')} automatycznie`);
  if (n('auto_confirmed_manual')) parts.push(`${n('auto_confirmed_manual')} ${plural(n('auto_confirmed_manual'), 'ręczna płatność potwierdzona', 'ręczne płatności potwierdzone', 'ręcznych płatności potwierdzonych')} wyciągiem`);
  if (n('auto_explained')) parts.push(`${n('auto_explained')} ${plural(n('auto_explained'), 'wyjaśniona', 'wyjaśnione', 'wyjaśnionych')} regułą (ZUS, podatki, opłaty)`);
  if (n('proposals')) parts.push(`${n('proposals')} ${plural(n('proposals'), 'propozycja', 'propozycje', 'propozycji')} do zatwierdzenia`);
  if (n('choices')) parts.push(`${n('choices')} do wyboru`);
  if (n('stopped_by_guard')) parts.push(`${n('stopped_by_guard')} zatrzymane przez kontrolę podwójnego rozliczenia`);
  const open = n('open_after');
  const head = parts.length ? parts.join(', ') : 'brak nowych dopasowań';
  return `${head}. Do wyjaśnienia zostało: ${open}.`;
}
