/**
 * Uzgadnianie wyciągów — typy i etykiety ekranu „Uzgodnienie wyciągów” oraz rejestru deklaracji.
 * Logika jest w bazie (reconcile_bank_month, get_bank_reconciliation_month, get_finance_declarations);
 * tu tylko opis dla ludzi.
 */

export type ReconciliationStatus = 'matched' | 'explained' | 'transfer' | 'proposal' | 'choice' | 'partial' | 'missing';

export interface ReconciliationProposalDocument {
  source: 'ksef' | 'invoice' | 'external' | 'declaration' | 'personnel';
  id?: string;
  number?: string | null;
  party?: string | null;
  amount: number;
  due?: number;
  open?: number;
  manual?: boolean;
  due_date?: string | null;
  issue_date?: string | null;
  evidence?: string | null;
  /** Dokument w walucie: kwota w walucie dokumentu i kurs banku. */
  document_amount?: number;
  document_currency?: string;
  rate?: number;
  /** Deklaracja (gdy brak id — zostanie założona przy zatwierdzeniu). */
  kind?: string;
  form?: string;
  period_kind?: string;
  period_start?: string;
  /** Wypłata: zatwierdzenie potwierdzi kwotę netto na konto. */
  confirm_net?: boolean;
  title?: string | null;
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
  document_amount?: number;
  document_currency?: string;
  exchange_rate?: number;
}

export interface ReconciliationPersonnelAllocation {
  id: string;
  recipient: string;
  amount: number;
  title: string | null;
  payment_type?: string;
  payment_date?: string | null;
  contract_id?: string | null;
  contract_number?: string | null;
  contract_kind?: string | null;
  method?: string;
  reasons?: string[] | null;
}

export interface ReconciliationDeclarationAllocation {
  payment_id: string;
  declaration_id: string;
  kind: DeclarationKind;
  form: string;
  label: string;
  amount: number;
  method: 'automatic' | 'manual';
  reasons: string[] | null;
  amount_due: number | null;
  status: DeclarationStatus;
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
  personnel: ReconciliationPersonnelAllocation[];
  declarations: ReconciliationDeclarationAllocation[];
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
  currency?: string | null;
}

export interface ReconciliationMonthDeclaration {
  id: string;
  kind: DeclarationKind;
  form: string;
  label: string;
  amount_due: number | null;
  paid: number;
  paid_this_month: number;
  status: DeclarationStatus;
}

export interface ReconciliationMonth {
  company_id: string;
  year: number;
  month: number;
  sources: ReconciliationSource[];
  last_run: { created_at: string; summary: Record<string, unknown> } | null;
  transactions: ReconciliationTransaction[];
  declarations: ReconciliationMonthDeclaration[];
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
  karta_waluta: 'Płatność kartą w walucie',
  karta_brak_dokumentu: 'Płatność kartą w walucie — brak dokumentu',
  waluta_kurs: 'Dokument w walucie — przeliczenie kursem',
  deklaracja: 'Deklaracja ZUS / podatkowa',
  deklaracja_okres: 'Wybierz okres deklaracji',
  deklaracja_nadplata: 'Przelew większy niż kwota deklaracji',
  wynagrodzenie: 'Wypłata z umowy',
  wynagrodzenie_bez_wyplaty: 'Wynagrodzenie bez zapisanej wypłaty',
  cofniete: 'Cofnięte przez użytkownika',
};

export const proposalRuleLabel = (rule: string) => PROPOSAL_RULES[rule] || 'Propozycja';

export const matchMethodLabel = (method?: string | null) =>
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
  if (n('auto_fx')) parts.push(`${n('auto_fx')} ${plural(n('auto_fx'), 'płatność walutowa przypisana', 'płatności walutowe przypisane', 'płatności walutowych przypisanych')} do faktur`);
  if (n('auto_personnel')) parts.push(`${n('auto_personnel')} ${plural(n('auto_personnel'), 'wypłata powiązana', 'wypłaty powiązane', 'wypłat powiązanych')} z umowami`);
  if (n('auto_declarations')) parts.push(`${n('auto_declarations')} ${plural(n('auto_declarations'), 'przelew przypisany', 'przelewy przypisane', 'przelewów przypisanych')} do deklaracji ZUS / podatkowych`);
  if (n('auto_explained')) parts.push(`${n('auto_explained')} ${plural(n('auto_explained'), 'wyjaśniona', 'wyjaśnione', 'wyjaśnionych')} regułą (ZUS, podatki, opłaty)`);
  if (n('proposals')) parts.push(`${n('proposals')} ${plural(n('proposals'), 'propozycja', 'propozycje', 'propozycji')} do zatwierdzenia`);
  if (n('choices')) parts.push(`${n('choices')} do wyboru`);
  if (n('stopped_by_guard')) parts.push(`${n('stopped_by_guard')} zatrzymane przez kontrolę podwójnego rozliczenia`);
  const open = n('open_after');
  const head = parts.length ? parts.join(', ') : 'brak nowych dopasowań';
  return `${head}. Do wyjaśnienia zostało: ${open}.`;
}

// Deklaracje ZUS i podatkowe ------------------------------------------------------------------------

export type DeclarationKind = 'zus' | 'pit' | 'vat' | 'cit' | 'other';
export type DeclarationPeriodKind = 'month' | 'quarter' | 'year';
export type DeclarationStatus = 'paid' | 'underpaid' | 'overpaid' | 'unpaid' | 'amount_missing' | 'draft' | 'nothing_due';

export interface DeclarationPayment {
  id: string;
  transaction_id: string;
  date: string;
  amount: number;
  method: 'automatic' | 'manual';
  reasons: string[] | null;
  title: string | null;
  statement_year: number;
  statement_month: number;
}

export interface DeclarationFile {
  id: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
}

export interface DeclarationLine {
  id: string;
  contract_id: string | null;
  contract_number: string | null;
  contract_kind: string | null;
  person_name: string;
  social_insured: number;
  social_payer: number;
  health: number;
  funds: number;
  pit: number;
  amount: number;
  notes: string | null;
}

export interface FinanceDeclaration {
  id: string;
  company_id: string;
  kind: DeclarationKind;
  form: string;
  label: string;
  period_kind: DeclarationPeriodKind;
  period_start: string;
  period_end: string;
  amount_due: number | null;
  due_date: string | null;
  notes: string | null;
  created_from: 'manual' | 'payment' | 'import';
  paid: number;
  status: DeclarationStatus;
  payments: DeclarationPayment[];
  files: DeclarationFile[];
  lines: DeclarationLine[];
  lines_total: number;
}

export const DECLARATION_KIND_LABELS: Record<DeclarationKind, string> = {
  zus: 'ZUS',
  pit: 'PIT (zaliczki od wynagrodzeń, ryczałt)',
  vat: 'VAT',
  cit: 'CIT',
  other: 'Inne',
};

/** Typowe formularze — lista podpowiedzi, symbol można wpisać dowolny. */
export const DECLARATION_FORMS: Array<{ kind: DeclarationKind; form: string; periodKind: DeclarationPeriodKind; hint: string }> = [
  { kind: 'zus', form: 'DRA', periodKind: 'month', hint: 'Deklaracja rozliczeniowa ZUS (z raportami RCA)' },
  { kind: 'pit', form: 'PIT-4R', periodKind: 'month', hint: 'Zaliczki na PIT od wynagrodzeń i umów' },
  { kind: 'pit', form: 'PIT-8AR', periodKind: 'month', hint: 'Zryczałtowany podatek (np. umowy do 200 zł)' },
  { kind: 'vat', form: 'VAT-7', periodKind: 'month', hint: 'JPK_V7M — VAT miesięczny' },
  { kind: 'vat', form: 'VAT-7K', periodKind: 'quarter', hint: 'JPK_V7K — VAT kwartalny' },
  { kind: 'cit', form: 'CIT-8', periodKind: 'month', hint: 'Zaliczka CIT za miesiąc albo rozliczenie roczne' },
];

export const DECLARATION_STATUS_META: Record<DeclarationStatus, { label: string; chip: string }> = {
  paid: { label: 'Zapłacona', chip: 'bg-green-500/15 text-green-300' },
  underpaid: { label: 'Niedopłata', chip: 'bg-red-500/15 text-red-300' },
  overpaid: { label: 'Nadpłata', chip: 'bg-blue-500/15 text-blue-300' },
  unpaid: { label: 'Brak płatności', chip: 'bg-red-500/15 text-red-300' },
  amount_missing: { label: 'Brak kwoty z deklaracji', chip: 'bg-amber-500/15 text-amber-300' },
  draft: { label: 'Bez kwoty i płatności', chip: 'bg-slate-500/20 text-slate-300' },
  nothing_due: { label: 'Do zapłaty 0 zł', chip: 'bg-slate-500/20 text-slate-300' },
};

export const declarationStatusSentence = (d: Pick<FinanceDeclaration, 'status' | 'amount_due' | 'paid'>, money: (v: number) => string) => {
  switch (d.status) {
    case 'paid': return `Zapłacono ${money(d.paid)} — zgodnie z deklaracją.`;
    case 'underpaid': return `Zapłacono ${money(d.paid)} z ${money(d.amount_due || 0)} — brakuje ${money((d.amount_due || 0) - d.paid)}.`;
    case 'overpaid': return `Zapłacono ${money(d.paid)}, a deklaracja wykazuje ${money(d.amount_due || 0)} — nadpłata ${money(d.paid - (d.amount_due || 0))}.`;
    case 'unpaid': return `Do zapłaty ${money(d.amount_due || 0)} — w wyciągach nie ma przelewu.`;
    case 'amount_missing': return `Zapłacono ${money(d.paid)}. Wpisz kwotę z deklaracji, żeby sprawdzić zgodność.`;
    case 'nothing_due': return 'Deklaracja nie wykazuje kwoty do zapłaty.';
    default: return 'Wpisz kwotę z deklaracji i dodaj plik.';
  }
};
