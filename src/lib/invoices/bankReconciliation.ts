/**
 * Uzgadnianie wyciągów — typy i etykiety ekranu „Uzgodnienie wyciągów”, rejestru deklaracji, rejestru umów stałych
 * i par „płatność + zwrot”. Logika jest w bazie (reconcile_bank_month, get_bank_reconciliation_month,
 * get_finance_declarations, get_finance_recurring_contracts, get_bank_refund_candidates); tu tylko opis dla ludzi.
 */

export type ReconciliationStatus = 'matched' | 'explained' | 'transfer' | 'proposal' | 'choice' | 'partial' | 'missing';

export interface ReconciliationProposalDocument {
  source: 'ksef' | 'invoice' | 'external' | 'declaration' | 'personnel' | 'contract' | 'refund';
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
  /** Rodzaj faktury: kod KSeF (VAT, ZAL, ROZ, KOR…), typ faktury CRM albo rodzaj dokumentu spoza KSeF. */
  doc_kind?: string | null;
  payment_status?: string | null;
  /** Zapłacono łącznie (wyciąg + oznaczenia ręczne), z wyciągu i ręcznie. */
  paid?: number;
  bank_paid?: number;
  manual_paid?: number;
  manual_date?: string | null;
  /** Podpowiedź przy wyborze spośród kilku dokumentów (np. ręczna płatność z dnia przelewu). */
  suggested?: boolean;
  hint?: string | null;
  /** Umowa stała: okres (period_start — pierwszy dzień, jak przy deklaracji), jego opis, kwota okresu z umowy i rodzaj umowy. */
  period_label?: string;
  contract_amount?: number;
  contract_kind?: RecurringContractKind;
  /** Zwrot płatności (source = refund): id = druga operacja pary, jej rola wobec tej operacji, data, kierunek, kwota,
   *  pozostała kwota i wyciąg. amount = kwota pary. */
  role?: RefundRole;
  date?: string | null;
  direction?: 'credit' | 'debit';
  tx_amount?: number;
  remaining?: number;
  statement_id?: string;
  statement_year?: number;
  statement_month?: number;
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
  doc_kind?: string | null;
  issue_date?: string | null;
  due_date?: string | null;
  /** Stan dokumentu po wszystkich płatnościach: należność, zapłacono, pozostało, status. */
  doc_due?: number;
  doc_paid?: number;
  doc_open?: number;
  doc_manual?: number;
  doc_status?: string | null;
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

/** Płatność umowy stałej przypięta do operacji. */
export interface ReconciliationContractAllocation {
  payment_id: string;
  contract_id: string;
  kind: RecurringContractKind;
  title: string;
  counterparty: string;
  period_start: string;
  period_label: string;
  amount: number;
  method: 'automatic' | 'manual';
  reasons: string[] | null;
  /** Kwota okresu z umowy i ile zapłacono za ten okres łącznie. */
  period_amount: number;
  period_paid: number;
}

/** payment — zwrócona płatność (operacja wcześniejsza), refund — zwrot (operacja późniejsza, przeciwny kierunek). */
export type RefundRole = 'payment' | 'refund';

/** Druga operacja pary „płatność + zwrot”. */
export interface ReconciliationRefundCounterpart {
  id: string;
  statement_id: string;
  date: string;
  amount: number;
  direction: 'credit' | 'debit';
  currency: string;
  /** Sprzedawca z „Lokalizacja: …”, kontrahent albo tytuł. */
  counterparty: string | null;
  title: string | null;
  statement_year: number;
  statement_month: number;
}

/** Para „płatność + zwrot” (bez faktury) przy operacji: rola TEJ operacji i druga operacja pary. */
export interface ReconciliationRefundPair {
  pair_id: string;
  role: RefundRole;
  /** Kwota pary — przy zwrocie częściowym mniejsza niż płatność (reszta płatności nadal czeka na fakturę). */
  amount: number;
  method: 'automatic' | 'manual';
  reasons: string[] | null;
  created_at: string;
  other: ReconciliationRefundCounterpart;
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
  contracts?: ReconciliationContractAllocation[];
  refunds?: ReconciliationRefundPair[];
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

/** Umowa stała obowiązująca w miesiącu uzgodnienia. */
export interface ReconciliationMonthContract {
  id: string;
  kind: RecurringContractKind;
  title: string;
  counterparty: string;
  direction: RecurringContractDirection;
  currency: string;
  amount: number;
  billing_cycle: RecurringContractCycle;
  expects_invoice: boolean;
  /** Okresy zaczynające się w tym miesiącu (opis). */
  periods: string[];
  due: number;
  due_date: string | null;
  paid_for_periods: number;
  paid_this_month: number;
  missing: number;
  status: 'paid' | 'missing' | 'overdue' | 'not_due' | 'invoice';
}

export interface ReconciliationMonth {
  company_id: string;
  year: number;
  month: number;
  sources: ReconciliationSource[];
  last_run: { created_at: string; summary: Record<string, unknown> } | null;
  transactions: ReconciliationTransaction[];
  declarations: ReconciliationMonthDeclaration[];
  contracts?: ReconciliationMonthContract[];
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
  umowa_stala: 'Umowa stała (najem, abonament…)',
  umowa_inna_kwota: 'Umowa stała — inna kwota niż okres',
  umowa_nazwa: 'Umowa stała — kontrahent i kwota',
  umowa_brak_okresu: 'Umowa stała — brak nieopłaconego okresu',
  zwrot_platnosci: 'Zwrot płatności (bez faktury)',
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
  owner_deposit: 'Wpłata własna',
  owner_withdrawal: 'Wypłata własna',
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
  if (n('auto_contracts')) parts.push(`${n('auto_contracts')} ${plural(n('auto_contracts'), 'płatność przypisana', 'płatności przypisane', 'płatności przypisanych')} do umów stałych (najem, abonament…)`);
  if (n('auto_declarations')) parts.push(`${n('auto_declarations')} ${plural(n('auto_declarations'), 'przelew przypisany', 'przelewy przypisane', 'przelewów przypisanych')} do deklaracji ZUS / podatkowych`);
  if (n('auto_explained')) parts.push(`${n('auto_explained')} ${plural(n('auto_explained'), 'wyjaśniona', 'wyjaśnione', 'wyjaśnionych')} regułą (ZUS, podatki, opłaty)`);
  if (n('proposals')) parts.push(`${n('proposals')} ${plural(n('proposals'), 'propozycja', 'propozycje', 'propozycji')} do zatwierdzenia`);
  if (n('choices')) parts.push(`${n('choices')} do wyboru`);
  if (n('refund_proposals')) parts.push(`${n('refund_proposals')} ${plural(n('refund_proposals'), 'operacja', 'operacje', 'operacji')} do zatwierdzenia jako płatność i zwrot (bez faktury)`);
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

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  VAT: 'faktura', ZAL: 'zaliczkowa', ROZ: 'rozliczeniowa (końcowa)', KOR: 'korekta', KOR_ZAL: 'korekta zaliczkowej',
  KOR_ROZ: 'korekta rozliczeniowej', UPR: 'uproszczona',
  vat: 'faktura', advance: 'zaliczkowa', final: 'końcowa', corrective: 'korekta', proforma: 'proforma',
  invoice: 'faktura', insurance_policy: 'polisa',
};

/** Rodzaj dokumentu po polsku (null, gdy nieznany). */
export const documentKindLabel = (kind?: string | null): string | null => (kind ? DOCUMENT_KIND_LABELS[kind] ?? null : null);

// Umowy stałe (najem, leasing, abonament, raty ubezpieczenia, kredyt / pożyczka) --------------------------------------

export type RecurringContractKind = 'rent' | 'lease' | 'subscription' | 'insurance' | 'loan' | 'other';
export type RecurringContractDirection = 'cost' | 'income';
export type RecurringContractCycle = 'monthly' | 'quarterly' | 'yearly';
export type RecurringContractStatus = 'active' | 'ended';
/** paid / overpaid — opłacony; missing — brak płatności, termin jeszcze nie minął; overdue — po terminie;
 *  upcoming — okres przyszły; invoice — umowa rozliczana fakturami kontrahenta. */
export type RecurringPeriodStatus = 'paid' | 'overpaid' | 'missing' | 'overdue' | 'upcoming' | 'invoice';

export interface RecurringContractPeriod {
  period_start: string;
  period_end: string;
  label: string;
  due_date: string;
  amount: number;
  paid: number;
  missing: number;
  status: RecurringPeriodStatus;
}

export interface RecurringContractPayment {
  id: string;
  period_start: string;
  period_label: string;
  transaction_id: string;
  date: string;
  amount: number;
  method: 'automatic' | 'manual';
  reasons: string[] | null;
  title: string | null;
  counterparty: string | null;
  statement_year: number;
  statement_month: number;
}

export interface RecurringContract {
  id: string;
  company_id: string;
  kind: RecurringContractKind;
  direction: RecurringContractDirection;
  title: string;
  counterparty_name: string;
  counterparty_nip: string | null;
  counterparty_account: string | null;
  amount: number;
  currency: string;
  billing_cycle: RecurringContractCycle;
  payment_day: number | null;
  start_date: string;
  end_date: string | null;
  payments_from: string | null;
  status: RecurringContractStatus;
  expects_invoice: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  periods: RecurringContractPeriod[];
  payments: RecurringContractPayment[];
  files: DeclarationFile[];
  summary: {
    periods: number;
    paid: number;
    overdue: number;
    overdue_amount: number;
    missing: number;
    paid_total: number;
    next_due_date: string | null;
  };
}

export const RECURRING_CONTRACT_KIND_LABELS: Record<RecurringContractKind, string> = {
  rent: 'Najem',
  lease: 'Leasing',
  subscription: 'Abonament',
  insurance: 'Raty ubezpieczenia',
  loan: 'Kredyt / pożyczka',
  other: 'Inna umowa',
};

export const RECURRING_CONTRACT_DIRECTION_LABELS: Record<RecurringContractDirection, string> = {
  cost: 'Koszt — płacimy',
  income: 'Przychód — otrzymujemy',
};

export const RECURRING_CONTRACT_CYCLE_LABELS: Record<RecurringContractCycle, string> = {
  monthly: 'co miesiąc',
  quarterly: 'co kwartał',
  yearly: 'co rok',
};

export const RECURRING_PERIOD_STATUS_META: Record<RecurringPeriodStatus, { label: string; chip: string; cell: string }> = {
  paid: { label: 'Opłacony', chip: 'bg-green-500/15 text-green-300', cell: 'border-green-500/30 bg-green-500/20 text-green-200' },
  overpaid: { label: 'Nadpłata', chip: 'bg-blue-500/15 text-blue-300', cell: 'border-blue-500/30 bg-blue-500/20 text-blue-200' },
  missing: { label: 'Brak płatności', chip: 'bg-amber-500/15 text-amber-300', cell: 'border-amber-500/30 bg-amber-500/15 text-amber-200' },
  overdue: { label: 'Po terminie', chip: 'bg-red-500/15 text-red-300', cell: 'border-red-500/40 bg-red-500/20 text-red-200' },
  upcoming: { label: 'Przyszły', chip: 'bg-slate-500/20 text-slate-300', cell: 'border-slate-500/30 bg-slate-500/10 text-slate-300' },
  invoice: { label: 'Rozliczana fakturami', chip: 'bg-slate-500/20 text-slate-300', cell: 'border-slate-500/30 bg-slate-500/10 text-slate-400' },
};

export const RECURRING_MONTH_STATUS_META: Record<ReconciliationMonthContract['status'], { label: string; chip: string }> = {
  paid: { label: 'Opłacona', chip: 'bg-green-500/15 text-green-300' },
  missing: { label: 'Brak płatności', chip: 'bg-amber-500/15 text-amber-300' },
  overdue: { label: 'Po terminie', chip: 'bg-red-500/15 text-red-300' },
  not_due: { label: 'Bez okresu w tym miesiącu', chip: 'bg-slate-500/20 text-slate-300' },
  invoice: { label: 'Rozliczana fakturami', chip: 'bg-slate-500/20 text-slate-300' },
};

/** Rachunek bankowy: same cyfry (jak w bazie). */
export const accountDigits = (value?: string | null) => String(value || '').replace(/\D/g, '');

/** „62 1140 2004 0000 3902 7077 4694” dla polskiego rachunku (26 cyfr); inne — bez zmian. */
export function formatAccount(value?: string | null): string {
  const digits = accountDigits(value);
  if (digits.length !== 26) return digits || '';
  return `${digits.slice(0, 2)} ${digits.slice(2).replace(/(\d{4})(?=\d)/g, '$1 ')}`;
}

/** Tekst do porównań: wielkie litery bez polskich znaków, tylko litery i cyfry rozdzielone spacją (jak private.bank_norm). */
export function normalizeBankText(value?: string | null): string {
  return String(value || '')
    .toUpperCase()
    .replace(/Ł/g, 'L')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const NAME_STOPWORDS = new Set(['SPOLKA', 'SPOLKI', 'FIRMA', 'USLUGI', 'HANDLOWA', 'HANDEL', 'PRZEDSIEBIORSTWO', 'PPHU', 'PHU', 'FHU',
  'GRUPA', 'POLSKA', 'POLSKIE', 'OGRANICZONA', 'ODPOWIEDZIALNOSCIA', 'AKCYJNA', 'KOMANDYTOWA', 'JAWNA', 'CYWILNA', 'ZOO', 'SKA', 'SPK',
  'THE', 'AND', 'LTD', 'GMBH', 'INC', 'PANI', 'PAN']);

/** Nazwa kontrahenta w przelewie — te same zasady co w bazie (pierwsze dwa znaczące słowa nazwy). */
export function counterpartyNameMatches(name: string, bankText: string): boolean {
  const words = normalizeBankText(name).split(' ').filter((w) => w.length >= 3 && !NAME_STOPWORDS.has(w)).slice(0, 2);
  if (words.length === 0) return false;
  const haystack = ` ${normalizeBankText(bankText)} `;
  return words.every((w) => haystack.includes(` ${w} `));
}

/** Najwcześniejszy nieopłacony okres nie późniejszy niż miesiąc po dacie operacji (domyślny okres w bazie). */
export function defaultContractPeriod(contract: Pick<RecurringContract, 'periods'>, transactionDate: string): RecurringContractPeriod | null {
  const date = new Date(`${transactionDate.slice(0, 10)}T12:00:00`);
  const limit = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const limitKey = `${limit.getFullYear()}-${String(limit.getMonth() + 1).padStart(2, '0')}-01`;
  return contract.periods.find((p) => Number(p.paid) < Number(p.amount) - 0.009 && p.period_start <= limitKey) ?? null;
}

/** Jak dobrze umowa pasuje do operacji (podpowiedź w oknie „Przypisz do umowy”). */
export function contractMatchEvidence(
  contract: Pick<RecurringContract, 'counterparty_account' | 'counterparty_name' | 'counterparty_nip' | 'amount'>,
  transaction: { counterparty_account?: string | null; counterparty?: string | null; title?: string | null; remaining: number },
): { account: boolean; name: boolean; amount: boolean; score: number } {
  const txAccount = accountDigits(transaction.counterparty_account);
  const text = `${transaction.counterparty || ''} ${transaction.title || ''}`;
  const account = Boolean(contract.counterparty_account && txAccount && contract.counterparty_account === txAccount);
  const name = counterpartyNameMatches(contract.counterparty_name, text)
    || Boolean(contract.counterparty_nip && accountDigits(text).includes(contract.counterparty_nip));
  const amount = Math.abs(Number(contract.amount) - Number(transaction.remaining)) <= 0.01;
  return { account, name, amount, score: (account ? 4 : 0) + (name ? 2 : 0) + (amount ? 1 : 0) };
}

export const recurringContractSummarySentence = (c: Pick<RecurringContract, 'summary' | 'expects_invoice' | 'currency'>, money: (v: number) => string) => {
  if (c.expects_invoice) return 'Kontrahent wystawia faktury — płatności rozliczasz z fakturami, umowa tylko informuje.';
  const s = c.summary;
  if (!s || s.periods === 0) return 'Brak okresów do rozliczenia.';
  const parts = [`Opłacone ${s.paid} z ${s.periods} ${plural(s.periods, 'okresu', 'okresów', 'okresów')}`];
  if (s.overdue) parts.push(`po terminie: ${s.overdue} (${money(s.overdue_amount)})`);
  if (s.missing) parts.push(`do zapłaty w terminie: ${s.missing}`);
  return `${parts.join(' · ')}.`;
};

// Zwrot płatności: para „płatność + zwrot” bez faktury -------------------------------------------------------------

/** Operacja, którą można powiązać jako drugą stronę pary (okno „Powiąż ze zwrotem”, RPC get_bank_refund_candidates). */
export interface RefundCandidate {
  id: string;
  statement_id: string;
  date: string;
  amount: number;
  remaining: number;
  direction: 'credit' | 'debit';
  currency: string;
  counterparty: string | null;
  title: string | null;
  statement_year: number;
  statement_month: number;
  day_diff: number;
  /** Pozostała kwota równa pozostałej kwocie tej operacji (co do grosza). */
  same_amount: boolean;
  same_account: boolean;
  /** Wspólne wyróżniające słowa w opisie (np. MUSICCENTER). */
  words: string[];
  evidence?: string | null;
  /** Para odrzucona albo cofnięta wcześniej — automat jej nie proponuje, ręcznie można ją powiązać. */
  blocked: boolean;
  explained: boolean;
  score: number;
  /** Rola tej operacji wobec operacji, z której otwarto okno. */
  role: RefundRole;
  suggested_amount: number;
  reasons: string[];
}

export interface RefundCandidatesResult {
  transaction: {
    id: string;
    date: string;
    amount: number;
    remaining: number;
    direction: 'credit' | 'debit';
    currency: string;
    counterparty: string | null;
    title: string | null;
  };
  candidates: RefundCandidate[];
  total: number;
  truncated: boolean;
}

/** Nazwa drugiej operacji pary: „Zwrot” (zwraca tę płatność) albo „Zwrócona płatność” (ta operacja ją zwraca). */
export const refundCounterpartLabel = (otherRole: RefundRole) => (otherRole === 'refund' ? 'Zwrot' : 'Zwrócona płatność');

/** Rola drugiej operacji pary, gdy znamy rolę tej operacji. */
export const refundOtherRole = (ownRole: RefundRole): RefundRole => (ownRole === 'payment' ? 'refund' : 'payment');

/** „+” dla wpływu, „−” dla wydatku. */
export const directionSign = (direction?: string | null) => (direction === 'credit' ? '+' : '−');
