import 'server-only';
import { randomUUID } from 'crypto';
import type { NativeContext } from './auth';
import { canFinanceCompany, loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import {
  contractMatchEvidence,
  defaultContractPeriod,
  documentKindLabel,
  explanationLabel,
  matchMethodLabel,
  proposalRuleLabel,
  reconciliationRunSentence,
  recurringContractSummarySentence,
  type RecurringContract,
} from '@/lib/invoices/bankReconciliation';
import { readBankTextFile, repairBrokenBankText } from '@/lib/bankTextEncoding';
import { comparisonSummary, proposalComparison } from '@/lib/invoices/proposalComparison';
import {
  applyBankTransactionMatchToDocument,
  assertBankTransactionCanMatchDocuments,
  isBankStatementMatchablePaymentMethod,
  loadPaymentRemainderSuggestion,
  reconcileExternalInvoiceWithBankTransaction,
  reconcilePaidKsefInvoiceWithBankTransaction,
  reconcilePersonnelPaymentWithBankTransaction,
} from '@/lib/bankTransactionMatching';
import {
  pickerBankMatched,
  pickerBankOpen,
  pickerIsPaid,
  pickerIsPartiallyPaid,
  pickerKnowsBankPart,
  pickerManualPaid,
  pickerMatchedBlockingReason,
  pickerPlannedAllocation,
} from '@/lib/bankPickerAllocation';
import { loadExternalDocumentKinds } from '@/lib/invoices/loadExternalDocumentKinds';
import { externalDocumentKindLabel } from '@/lib/invoices/externalDocumentKinds';
import { REGISTER_STATE_LABELS, registerState, warsawToday } from '@/lib/invoices/documentRegister';
import {
  loadPersonnelPaymentBreakdowns,
  salaryPaymentNeedsNetConfirmation,
  type PersonnelPaymentBreakdown,
} from '@/lib/personnel/payrollMatching';
import { parseMT940 } from '@/lib/bankStatementParsers';
import { bankStatementPdfErrorMessage, parseBankStatementPdf } from '@/lib/bank/pdfStatementParser.server';
import { bankStatementImportFormat, resolveStatementAccount } from '@/lib/bankStatementAccount';
import { selectBankStatementsForUpload, validateBankStatementUploadAccount } from '@/lib/bankStatementUploadScope';
import { assertBankStatementCanBeRemoved } from '@/lib/CRM/bankStatementRemovalGuard';
import { linkDetectedVatTransfersForPeriod } from '@/lib/CRM/bankVatTransfers';
import { buildInvoicePrintDocument, INVOICE_PRINT_SELECT, renderInvoicePdf } from '@/lib/invoices/print/renderInvoicePdf.server';
import { invoicePdfFileName, isProformaInvoiceRow } from '@/lib/invoices/print/invoicePrintData';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';

/*
 * Bank na Macu (`/crm/invoices`: „Wyciągi i płatności”, „Uzgodnienie wyciągów”, „ZUS i podatki — deklaracje”, „Umowy stałe”) — te same
 * funkcje bazy co panele CRM (`BankReconciliationPanel`, `KSeFFinancialDashboard`, `FinanceDeclarationsPanel`, okna wyboru
 * dokumentu, wyjaśnienia, deklaracji, umowy stałej i zwrotu), klientem z tokenem pracownika: uprawnienia, RLS i ochrona
 * przed podwójnym rozliczeniem zostają w bazie. Logika wyboru dokumentu (płatność częściowa, gotówka na fakturze KSeF,
 * wypłaty z niepotwierdzonym netto) i import wyciągu (PDF — wspólny parser z trasą CRM, MT940 — `parseMT940`, kontrola
 * rachunku i okresu, transfery VAT, uzgodnienie po imporcie) — 1:1 z przeglądarką, wspólnymi modułami `src/lib`.
 * Odpowiedź ma stały kształt (camelCase, liczby i null) i gotowe opisy (etykiety reguł, metody, rodzaje dokumentów).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BankError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new BankError(message, status);
}
/** Błąd funkcji bazy → komunikat dla pracownika; 42501 (brak uprawnień) → 403. */
function rpcFail(error: { message?: string; code?: string } | null, fallback: string): never {
  fail(error?.message || fallback, error?.code === '42501' ? 403 : 400);
}

const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value));
const day = (value: unknown): string | null => {
  const text = strOrNull(value);
  return text ? text.slice(0, 10) : null;
};
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item) => item !== null && item !== undefined).map(String) : []);
const uuid = (value: unknown, message: string) => {
  const text = str(value).trim();
  if (!UUID.test(text)) fail(message);
  return text;
};
const intIn = (value: unknown, min: number, max: number, message: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) fail(message);
  return parsed;
};
/** Liczba z formularza („2 829,86”) jak `num` w panelach CRM. */
const amountInput = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};
/** Tekst z wyciągu: naprawa kodowania i spacji (jak `text` w `BankReconciliationPanel`). */
const bankText = (value: unknown) => repairBrokenBankText(strOrNull(value)).replace(/[˙]+/g, ' ').replace(/\s+/g, ' ').trim();
const bankTextOrNull = (value: unknown) => bankText(value) || null;

const money = (value: unknown, currency = 'PLN') =>
  `${Number(value || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const plDate = (value?: string | null) => (value ? new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString('pl-PL') : '—');

// MARK: Dostęp

async function companyAccess(ctx: NativeContext, companyId: string) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const canView = canFinanceCompany(access, companyId, 'finance_view');
  if (!canView) fail('Brak dostępu do finansów tej działalności.', 403);
  return { canManage: canFinanceCompany(access, companyId, 'finance_manage') };
}

async function requireManage(ctx: NativeContext, companyId: string) {
  const { canManage } = await companyAccess(ctx, companyId);
  if (!canManage) fail('Zmiany wymagają poziomu „Zarządzanie finansami” w tej działalności.', 403);
}

/** Działalność operacji (wyciąg → firma), żeby sprawdzić poziom dostępu przed zmianą. */
async function transactionCompany(ctx: NativeContext, transactionId: string) {
  const { data: tx, error } = await ctx.supabase.from('bank_transactions')
    .select('id,statement_id,transaction_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,allocated_amount')
    .eq('id', transactionId).maybeSingle();
  if (error || !tx) fail('Nie znaleziono operacji albo nie masz do niej dostępu.', 404);
  const { data: statement, error: statementError } = await ctx.supabase.from('bank_statements')
    .select('id,my_company_id,statement_year,statement_month').eq('id', tx.statement_id).maybeSingle();
  if (statementError || !statement?.my_company_id) fail('Nie można potwierdzić wyciągu i działalności tej operacji.', 404);
  return { tx: tx as Row, statement: statement as Row, companyId: String(statement.my_company_id) };
}

async function manageTransaction(ctx: NativeContext, transactionId: unknown) {
  const id = uuid(transactionId, 'Nieprawidłowa operacja.');
  const found = await transactionCompany(ctx, id);
  await requireManage(ctx, found.companyId);
  return { id, ...found };
}

// MARK: Okresy uzgodnienia (wyciągi przetworzone i poprawne)

export async function bankPeriods(ctx: NativeContext) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const { data, error } = await ctx.supabase.from('bank_statements')
    .select('my_company_id,statement_year,statement_month')
    .eq('processed', true).eq('validation_status', 'valid')
    .order('statement_year', { ascending: false }).order('statement_month', { ascending: false })
    .range(0, 4999);
  if (error) fail('Nie udało się wczytać listy wyciągów.', 500);
  const seen = new Set<string>();
  const periods: Array<{ companyId: string; year: number; month: number }> = [];
  for (const row of rows(data)) {
    const companyId = str(row.my_company_id);
    const key = `${companyId}:${row.statement_year}:${row.statement_month}`;
    if (!companyId || seen.has(key) || !canFinanceCompany(access, companyId, 'finance_view')) continue;
    seen.add(key);
    periods.push({ companyId, year: num(row.statement_year), month: num(row.statement_month) });
  }
  return { periods };
}

// MARK: Uzgodnienie miesiąca

/** Rodzaj, daty i stan płatności dokumentu (jak `documentFacts` w CRM). */
function documentFacts(doc: {
  kind?: string | null; issueDate?: string | null; dueDate?: string | null; status?: string | null;
  due?: number | null; paid?: number | null; manualPaid?: number | null; manualDate?: string | null;
}, currency: string): string {
  const parts: string[] = [];
  const kind = documentKindLabel(doc.kind);
  if (kind) parts.push(kind);
  if (doc.issueDate) parts.push(`wystawiona ${plDate(doc.issueDate)}`);
  if (doc.dueDate) parts.push(`termin ${plDate(doc.dueDate)}`);
  const due = Number(doc.due || 0);
  const paid = Number(doc.paid || 0);
  if (doc.status === 'partially_paid' || (paid > 0.009 && due - paid > 0.009)) {
    parts.push(`częściowo opłacona: ${money(paid, currency)} z ${money(due, currency)}, pozostało ${money(Math.max(due - paid, 0), currency)}`);
  } else if (Number(doc.manualPaid || 0) > 0.009) {
    parts.push(`oznaczona ręcznie jako opłacona${doc.manualDate ? ` ${plDate(doc.manualDate)}` : ''}`);
  }
  return parts.join(' · ');
}

/** Druga operacja w propozycji „zwrot płatności” (jak `refundFacts` w CRM). */
function refundFacts(doc: Row, currency: string, period: { year: number; month: number }): string {
  const parts: string[] = [];
  if (doc.evidence) parts.push(`dowód: ${doc.evidence}`);
  if (doc.tx_amount != null && doc.remaining != null && Number(doc.remaining) < Number(doc.tx_amount) - 0.009) {
    parts.push(`pozostało do rozliczenia ${money(doc.remaining, currency)} z ${money(doc.tx_amount, currency)}`);
  }
  if (doc.statement_year && doc.statement_month
      && (Number(doc.statement_year) !== period.year || Number(doc.statement_month) !== period.month)) {
    parts.push(`wyciąg ${String(doc.statement_month).padStart(2, '0')}/${doc.statement_year}`);
  }
  if (Number(doc.amount) < Number(doc.tx_amount || 0) - 0.009) parts.push(`zwrot częściowy — para ${money(doc.amount, currency)}`);
  return parts.join(' · ');
}

const SOURCE_LABELS: Record<string, string> = {
  ksef: 'KSeF', external: 'Spoza KSeF', invoice: 'CRM', declaration: 'Deklaracja', personnel: 'Wypłata', contract: 'Umowa stała', refund: 'Zwrot płatności',
};
const sourceLabel = (source: string) => SOURCE_LABELS[source] || source;
const previewable = (source: string) => source === 'ksef' || source === 'invoice' || source === 'external';

/** Płatność i reguła propozycji — do porównania „co do czego pasuje” (`proposalComparison`). */
type ProposalContext = { tx: Row; rule: string; share: boolean };

function proposalDocument(doc: Row, currency: string, period: { year: number; month: number }, context: ProposalContext) {
  const source = str(doc.source);
  const comparison = proposalComparison({
    rule: context.rule,
    share: context.share,
    tx: {
      date: day(context.tx.date) || '', amount: num(context.tx.amount), remaining: num(context.tx.remaining), currency,
      counterparty: bankTextOrNull(context.tx.counterparty), counterpartyAccount: strOrNull(context.tx.counterparty_account),
      title: bankTextOrNull(context.tx.title), description: bankTextOrNull(context.tx.source_description),
    },
    doc: {
      source, number: strOrNull(doc.number), party: bankTextOrNull(doc.party), amount: num(doc.amount), due: numOrNull(doc.due),
      open: numOrNull(doc.open), manual: doc.manual === true, issueDate: day(doc.issue_date), dueDate: day(doc.due_date),
      evidence: strOrNull(doc.evidence), documentAmount: numOrNull(doc.document_amount), documentCurrency: strOrNull(doc.document_currency),
      rate: numOrNull(doc.rate), manualPaid: numOrNull(doc.manual_paid), manualDate: day(doc.manual_date),
    },
  });
  const facts = source === 'refund'
    ? refundFacts(doc, currency, period)
    : documentFacts({
      kind: strOrNull(doc.doc_kind), issueDate: day(doc.issue_date), dueDate: day(doc.due_date), status: strOrNull(doc.payment_status),
      due: numOrNull(doc.due), paid: numOrNull(doc.paid), manualPaid: numOrNull(doc.manual_paid), manualDate: day(doc.manual_date),
    }, currency);
  return {
    source,
    sourceLabel: sourceLabel(source),
    id: strOrNull(doc.id),
    number: strOrNull(doc.number),
    party: bankTextOrNull(doc.party),
    amount: num(doc.amount),
    documentAmount: numOrNull(doc.document_amount),
    documentCurrency: strOrNull(doc.document_currency),
    rate: numOrNull(doc.rate),
    manual: doc.manual === true,
    /** Deklaracja zostanie założona przy zatwierdzeniu. */
    createsDeclaration: source === 'declaration' && !doc.id,
    periodLabel: strOrNull(doc.period_label),
    contractAmount: numOrNull(doc.contract_amount),
    confirmNet: doc.confirm_net === true,
    suggested: doc.suggested === true,
    hint: strOrNull(doc.hint),
    facts: facts || null,
    statementId: strOrNull(doc.statement_id),
    previewable: previewable(source) && Boolean(doc.id),
    /** Wiersze porównania płatności z dokumentem (kwota, kontrahent, numer w tytule, data, oznaczenie ręczne). */
    comparison,
    comparisonSummary: comparisonSummary(comparison) || null,
  };
}

function transactionOf(t: Row, period: { year: number; month: number }) {
  const currency = str(t.currency) || 'PLN';
  const proposal = t.proposal ? object(t.proposal) : null;
  const explanation = t.explanation ? object(t.explanation) : null;
  return {
    id: str(t.id),
    statementId: str(t.statement_id),
    date: day(t.date) || '',
    amount: num(t.amount),
    direction: t.direction === 'credit' ? 'credit' : 'debit',
    currency,
    counterparty: bankTextOrNull(t.counterparty),
    counterpartyAccount: strOrNull(t.counterparty_account),
    title: bankTextOrNull(t.title),
    sourceDescription: bankTextOrNull(t.source_description),
    accountKind: t.account_kind === 'vat' ? 'vat' : 'regular',
    unconfirmed: t.source_confirmation === 'unconfirmed',
    allocated: num(t.allocated),
    remaining: num(t.remaining),
    status: str(t.status) || 'missing',
    allocations: rows(t.allocations).map((a) => ({
      matchId: str(a.match_id),
      source: str(a.source),
      sourceLabel: sourceLabel(str(a.source)),
      documentId: strOrNull(a.document_id),
      number: strOrNull(a.number),
      party: bankTextOrNull(a.party),
      amount: num(a.amount),
      documentAmount: numOrNull(a.document_amount),
      documentCurrency: strOrNull(a.document_currency),
      rate: numOrNull(a.exchange_rate),
      method: matchMethodLabel(strOrNull(a.method)),
      reasons: strings(a.reasons),
      open: num(a.doc_open),
      facts: documentFacts({
        kind: strOrNull(a.doc_kind), issueDate: day(a.issue_date), dueDate: day(a.due_date), status: strOrNull(a.doc_status),
        due: numOrNull(a.doc_due), paid: numOrNull(a.doc_paid), manualPaid: numOrNull(a.doc_manual),
      }, currency) || null,
      previewable: previewable(str(a.source)) && Boolean(a.document_id),
    })),
    personnel: rows(t.personnel).map((p) => ({
      id: str(p.id),
      recipient: str(p.recipient),
      amount: num(p.amount),
      contractNumber: strOrNull(p.contract_number),
      method: matchMethodLabel(strOrNull(p.method)),
      reasons: strings(p.reasons),
    })),
    declarations: rows(t.declarations).map((d) => ({
      paymentId: str(d.payment_id),
      declarationId: str(d.declaration_id),
      label: str(d.label),
      amount: num(d.amount),
      method: matchMethodLabel(strOrNull(d.method)),
      reasons: strings(d.reasons),
      status: str(d.status),
    })),
    contracts: rows(t.contracts).map((c) => ({
      paymentId: str(c.payment_id),
      contractId: str(c.contract_id),
      title: str(c.title),
      periodLabel: str(c.period_label),
      amount: num(c.amount),
      method: matchMethodLabel(strOrNull(c.method)),
      reasons: strings(c.reasons),
      periodAmount: num(c.period_amount),
      periodPaid: num(c.period_paid),
    })),
    refunds: rows(t.refunds).map((r) => {
      const other = object(r.other);
      return {
        pairId: str(r.pair_id),
        role: r.role === 'refund' ? 'refund' : 'payment',
        amount: num(r.amount),
        method: matchMethodLabel(strOrNull(r.method)),
        reasons: strings(r.reasons),
        other: {
          id: str(other.id),
          statementId: str(other.statement_id),
          date: day(other.date) || '',
          amount: num(other.amount),
          direction: other.direction === 'credit' ? 'credit' : 'debit',
          currency: str(other.currency) || 'PLN',
          counterparty: bankTextOrNull(other.counterparty),
          title: bankTextOrNull(other.title),
        },
      };
    }),
    explanation: explanation ? {
      category: str(explanation.category),
      label: explanationLabel(str(explanation.category), strOrNull(explanation.subtype)),
      note: strOrNull(explanation.note),
      automatic: str(explanation.by).startsWith('rule:'),
    } : null,
    proposal: proposal ? {
      id: str(proposal.id),
      kind: proposal.kind === 'choose' ? 'choose' : proposal.kind === 'hint' ? 'hint' : 'allocate',
      rule: str(proposal.rule),
      ruleLabel: proposalRuleLabel(str(proposal.rule)),
      reason: str(proposal.reason),
      documents: rows(proposal.documents).map((doc, _index, all) => proposalDocument(doc, currency, period, {
        tx: t, rule: str(proposal.rule), share: proposal.kind !== 'choose' && proposal.kind !== 'hint' && all.length > 1,
      })),
    } : null,
  };
}

function documentRow(d: Row) {
  return {
    source: str(d.source),
    sourceLabel: sourceLabel(str(d.source)),
    id: str(d.id),
    number: strOrNull(d.number),
    party: bankTextOrNull(d.party),
    side: d.side === 'issued' ? 'issued' : 'received',
    due: num(d.due),
    open: num(d.open),
    manualPaid: num(d.manual_paid),
    paymentDate: day(d.payment_date),
    dueDate: day(d.due_date),
    issueDate: day(d.issue_date),
    currency: str(d.currency) || 'PLN',
  };
}

export async function bankMonth(ctx: NativeContext, companyParam: unknown, yearParam: unknown, monthParam: unknown) {
  const companyId = uuid(companyParam, 'Nieprawidłowa działalność.');
  const year = intIn(yearParam, 2000, 2100, 'Nieprawidłowy rok.');
  const month = intIn(monthParam, 1, 12, 'Nieprawidłowy miesiąc.');
  const { canManage } = await companyAccess(ctx, companyId);
  const { data, error } = await ctx.supabase.rpc('get_bank_reconciliation_month', { p_company_id: companyId, p_year: year, p_month: month });
  if (error) rpcFail(error, 'Nie udało się wczytać uzgodnienia.');
  const raw = object(data);
  const period = { year, month };
  const lastRun = raw.last_run ? object(raw.last_run) : null;
  // Operacja z datą spoza miesiąca wyciągu (np. karta 29.09 zaksięgowana 01.10 — na wyciągu za październik): data księgowania
  // obok daty operacji, żeby było widać, czemu jest w tym miesiącu.
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const outside = rows(raw.transactions).filter((t) => { const value = day(t.date); return Boolean(value) && !String(value).startsWith(monthPrefix); })
    .map((t) => str(t.id)).filter(Boolean);
  const booked = new Map<string, string>();
  if (outside.length) {
    const { data: postings } = await ctx.supabase.from('bank_transactions').select('id,posting_date').in('id', outside.slice(0, 500));
    for (const row of rows(postings)) {
      const value = day(row.posting_date);
      if (value) booked.set(str(row.id), value);
    }
  }
  return {
    companyId,
    year,
    month,
    canManage,
    loadedAt: new Date().toISOString(),
    lastRun: lastRun ? { at: str(lastRun.created_at), sentence: reconciliationRunSentence(object(lastRun.summary)) } : null,
    sources: rows(raw.sources).map((s) => ({
      id: str(s.id),
      kind: s.kind === 'vat' ? 'vat' : 'regular',
      format: strOrNull(s.format)?.toUpperCase() ?? null,
      fileName: str(s.file_name),
      count: num(s.transactions_count),
      opening: numOrNull(s.opening_balance),
      closing: numOrNull(s.closing_balance),
      confirmed: num(s.confirmed),
      unconfirmed: num(s.unconfirmed),
    })),
    transactions: rows(raw.transactions).map((t) => {
      const bookedDate = booked.get(str(t.id));
      return { ...transactionOf(t, period), bookedDate: bookedDate && bookedDate !== day(t.date) ? bookedDate : null };
    }),
    declarations: rows(raw.declarations).map((d) => ({
      id: str(d.id),
      label: str(d.label),
      amountDue: numOrNull(d.amount_due),
      paid: num(d.paid),
      status: str(d.status),
    })),
    contracts: rows(raw.contracts).map((c) => ({
      id: str(c.id),
      title: str(c.title),
      currency: str(c.currency) || 'PLN',
      periods: strings(c.periods),
      due: num(c.due),
      paidForPeriods: num(c.paid_for_periods),
      missing: num(c.missing),
      status: str(c.status),
    })),
    paidWithoutStatement: rows(raw.paid_without_statement).map(documentRow),
    unpaidDue: rows(raw.unpaid_due).map(documentRow),
    shadowDocuments: rows(raw.shadow_documents).map(documentRow),
  };
}

// MARK: Czynności uzgodnienia

export async function runReconciliation(ctx: NativeContext, body: Row) {
  const companyId = uuid(body.companyId, 'Nieprawidłowa działalność.');
  const year = intIn(body.year, 2000, 2100, 'Nieprawidłowy rok.');
  const month = intIn(body.month, 1, 12, 'Nieprawidłowy miesiąc.');
  await requireManage(ctx, companyId);
  const { data, error } = await ctx.supabase.rpc('reconcile_bank_month', { p_company_id: companyId, p_year: year, p_month: month });
  if (error) rpcFail(error, 'Uzgodnienie nie powiodło się.');
  return { ok: true, message: reconciliationRunSentence(object(data)) };
}

async function proposalCompany(ctx: NativeContext, body: Row) {
  // Propozycja należy do operacji — dostęp sprawdzamy po działalności operacji (funkcja bazy sprawdza ponownie).
  const { companyId } = await manageTransaction(ctx, body.transactionId);
  return { proposalId: uuid(body.proposalId, 'Nieprawidłowa propozycja.'), companyId };
}

export async function acceptProposal(ctx: NativeContext, body: Row) {
  const { proposalId } = await proposalCompany(ctx, body);
  const index = body.index === null || body.index === undefined ? null : intIn(body.index, 0, 1000, 'Wybierz jeden dokument z listy.');
  const { error } = await ctx.supabase.rpc('accept_bank_reconciliation_proposal', { p_proposal_id: proposalId, p_document_index: index });
  if (error) rpcFail(error, 'Operacja nie powiodła się.');
  return {
    ok: true,
    message: body.rule === 'zwrot_platnosci' ? 'Płatność i zwrot powiązane — obie operacje są rozliczone bez faktury.' : 'Płatność rozliczona.',
  };
}

export async function rejectProposal(ctx: NativeContext, body: Row) {
  const { proposalId } = await proposalCompany(ctx, body);
  const { error } = await ctx.supabase.rpc('reject_bank_reconciliation_proposal', { p_proposal_id: proposalId });
  if (error) rpcFail(error, 'Operacja nie powiodła się.');
  return {
    ok: true,
    message: body.rule === 'zwrot_platnosci'
      ? 'Propozycja odrzucona. Ta para płatność + zwrot nie wróci — ani przy tej operacji, ani przy drugiej.'
      : 'Propozycja odrzucona. Ten dokument nie wróci do tej płatności; dla innych płatności nadal czeka na dopasowanie.',
  };
}

/** Cofnięcie rozliczenia operacji: dopasowanie dokumentu, wypłata, deklaracja, umowa stała, para zwrotu, wyjaśnienie. */
export async function undoLink(ctx: NativeContext, body: Row) {
  const { id: transactionId } = await manageTransaction(ctx, body.transactionId);
  const kind = str(body.kind);
  let result: { error: { message?: string; code?: string } | null };
  let message: string;
  switch (kind) {
    case 'match':
      result = await ctx.supabase.rpc('undo_bank_match', { p_transaction_id: transactionId, p_match_id: uuid(body.id, 'Nieprawidłowe dopasowanie.') });
      message = 'Dopasowanie cofnięte. Ten dokument nie zostanie ponownie przypisany automatycznie.';
      break;
    case 'personnel':
      result = await ctx.supabase.rpc('undo_bank_personnel_payment', { p_transaction_id: transactionId, p_payment_id: uuid(body.id, 'Nieprawidłowa wypłata.') });
      message = 'Wypłata odpięta. Nie zostanie powiązana ponownie automatycznie.';
      break;
    case 'declaration':
      result = await ctx.supabase.rpc('undo_bank_declaration_payment', { p_payment_id: uuid(body.id, 'Nieprawidłowa płatność deklaracji.') });
      message = 'Przelew odpięty od deklaracji. Nie zostanie przypięty ponownie automatycznie.';
      break;
    case 'contract':
      result = await ctx.supabase.rpc('undo_bank_recurring_contract_payment', { p_payment_id: uuid(body.id, 'Nieprawidłowa płatność umowy.') });
      message = 'Przelew odpięty od umowy. Nie zostanie przypięty ponownie automatycznie.';
      break;
    case 'refund':
      result = await ctx.supabase.rpc('undo_bank_refund_pair', { p_pair_id: uuid(body.id, 'Nieprawidłowa para.') });
      message = 'Powiązanie cofnięte. Obie operacje wracają do rozliczenia, a ta para nie zostanie zaproponowana ponownie.';
      break;
    case 'explanation':
      result = await ctx.supabase.rpc('clear_bank_transaction_explanation', { p_transaction_id: transactionId });
      message = 'Wyjaśnienie cofnięte.';
      break;
    default:
      fail('Nieznana operacja.');
  }
  if (result.error) rpcFail(result.error, 'Operacja nie powiodła się.');
  return { ok: true, message };
}

// MARK: Wybór dokumentu do płatności (`BankTransactionDocumentPickerModal`)

type PickerRow = {
  document_source: 'invoice' | 'ksef' | 'external' | 'personnel';
  document_id: string;
  document_number: string;
  gross_amount: number | string;
  outstanding_amount: number | string;
  issue_date: string | null;
  due_date: string | null;
  counterparty_name: string | null;
  currency: string;
  payment_status: string;
  payment_method: string | null;
  is_matched: boolean;
  is_matchable: boolean;
  /** Migracja 20261202180000: część potwierdzona przelewami z wyciągu i część oznaczona ręcznie. */
  bank_matched_amount?: number | string | null;
  manual_paid_amount?: number | string | null;
  document_kind?: string;
  payroll?: PersonnelPaymentBreakdown;
};

const PICKER_SOURCE_LABELS: Record<string, string> = { invoice: 'CRM', ksef: 'KSeF', external: 'Spoza KSeF', personnel: 'Kadrowe' };

const pickerPaid = (document: PickerRow) => pickerIsPaid(document);

async function pickerRows(ctx: NativeContext, transactionId: string): Promise<PickerRow[]> {
  await assertBankTransactionCanMatchDocuments(ctx.supabase, transactionId);
  const found: PickerRow[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 50_000; offset += pageSize) {
    const { data, error } = await ctx.supabase
      .rpc('get_bank_transaction_document_picker_items', { p_transaction_id: transactionId })
      .order('document_source', { ascending: true })
      .order('document_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) rpcFail(error, 'Nie udało się pobrać dokumentów.');
    const page = (data || []) as PickerRow[];
    found.push(...page);
    if (page.length < pageSize) break;
  }
  const [kinds, payroll] = await Promise.all([
    loadExternalDocumentKinds(ctx.supabase, found.filter((d) => d.document_source === 'external').map((d) => d.document_id)),
    loadPersonnelPaymentBreakdowns(ctx.supabase, found.filter((d) => d.document_source === 'personnel').map((d) => d.document_id)),
  ]);
  return found.map((document) => {
    if (document.document_source === 'external') return { ...document, document_kind: kinds.get(document.document_id) || 'invoice' };
    if (document.document_source !== 'personnel') return document;
    const payment = payroll.get(document.document_id);
    if (!payment) return { ...document, is_matchable: false };
    return {
      ...document,
      payroll: payment,
      gross_amount: payment.amount,
      outstanding_amount: payment.linkedTransactionId ? 0 : payment.amount,
      is_matched: Boolean(payment.linkedTransactionId),
      is_matchable: document.is_matchable && !salaryPaymentNeedsNetConfirmation(payment),
    };
  });
}

type PickerTransaction = { amount: number; currency: string; allocated: number };

const pickerRemaining = (tx: PickerTransaction) => Math.max(Math.abs(Number(tx.amount || 0)) - Number(tx.allocated || 0), 0);
const sameCurrency = (document: PickerRow, tx: PickerTransaction) =>
  String(document.currency || 'PLN').toUpperCase() === String(tx.currency || 'PLN').toUpperCase();
const cashConflict = (document: PickerRow) => !isBankStatementMatchablePaymentMethod(document.payment_method, document.document_source);

/** Ile ta płatność rozliczy w dokumencie (mniej niż brakuje — płatność częściowa; `bankPickerAllocation.ts`). */
const plannedAllocation = (document: PickerRow, tx: PickerTransaction) => pickerPlannedAllocation(document, pickerRemaining(tx), tx.currency);

function blockingReason(document: PickerRow, tx: PickerTransaction, allowKsefCashException = false): string | null {
  const remainingAmount = pickerRemaining(tx);
  const matched = pickerMatchedBlockingReason(document);
  if (matched) return matched;
  if (remainingAmount <= 0.009) return 'Ta płatność jest już w całości rozliczona.';
  if (document.payroll && salaryPaymentNeedsNetConfirmation(document.payroll)) return 'Najpierw potwierdź kwotę netto w umowie personelu.';
  if (!document.is_matchable) return 'Brak dostępnej kwoty do dopasowania lub dokument nie spełnia warunków rozliczenia.';
  if (!Number.isFinite(Number(document.gross_amount)) || Math.abs(Number(document.gross_amount)) <= 0.009) return 'Dokument nie ma dodatniej kwoty do rozliczenia.';
  const same = sameCurrency(document, tx);
  if (!same && document.document_source !== 'external') return 'Waluta dokumentu różni się od waluty płatności.';
  if (document.document_source === 'personnel') {
    if (!document.payroll) return 'Nie odczytano danych płatności kadrowej.';
    if (!same || Number(document.gross_amount) > remainingAmount + 0.01) return 'Kwota wypłaty kadrowej przekracza pozostałą kwotę płatności lub ma inną walutę.';
  }
  if (cashConflict(document) && !(allowKsefCashException && document.document_source === 'ksef')) {
    return document.document_source === 'ksef'
      ? 'Faktura wskazuje gotówkę. Powiązanie z wyciągiem wymaga świadomego potwierdzenia wyjątku.'
      : 'Dokument wskazuje gotówkę. Zweryfikuj sposób zapłaty przed dopasowaniem do wyciągu.';
  }
  return null;
}

const canConfirmCashException = (document: PickerRow, tx: PickerTransaction) => document.document_source === 'ksef'
  && cashConflict(document) && blockingReason(document, tx, true) === null;

async function pickerTransaction(ctx: NativeContext, transactionId: unknown, allocated: unknown) {
  const id = uuid(transactionId, 'Nieprawidłowa operacja.');
  const { tx, companyId } = await transactionCompany(ctx, id);
  // Rozliczona część jak w oknie CRM: kwota rozliczona z listy uzgodnienia (gdy podana) albo zapisana przy operacji.
  const allocatedAmount = allocated === null || allocated === undefined || allocated === '' ? num(tx.allocated_amount) : num(allocated);
  return {
    id,
    companyId,
    row: tx,
    tx: { amount: num(tx.amount), currency: str(tx.currency) || 'PLN', allocated: allocatedAmount } as PickerTransaction,
  };
}

export async function pickerDocuments(ctx: NativeContext, transactionId: unknown, allocated: unknown) {
  const found = await pickerTransaction(ctx, transactionId, allocated);
  const { canManage } = await companyAccess(ctx, found.companyId);
  const documents = await pickerRows(ctx, found.id);
  const remaining = pickerRemaining(found.tx);
  return {
    canManage,
    transaction: {
      id: found.id,
      date: day(found.row.transaction_date) || '',
      amount: num(found.row.amount),
      currency: found.tx.currency,
      direction: found.row.transaction_type === 'credit' ? 'credit' : 'debit',
      counterparty: bankTextOrNull(found.row.counterparty_name),
      title: bankTextOrNull(found.row.title),
      remaining,
    },
    documents: documents.map((document) => {
      const planned = plannedAllocation(document, found.tx);
      return {
        source: document.document_source,
        id: document.document_id,
        number: str(document.document_number),
        kindLabel: document.document_source === 'external'
          ? externalDocumentKindLabel(document.document_kind)
          : PICKER_SOURCE_LABELS[document.document_source] || document.document_source,
        sourceLabel: PICKER_SOURCE_LABELS[document.document_source] || document.document_source,
        gross: num(document.gross_amount),
        outstanding: num(document.outstanding_amount),
        issueDate: day(document.issue_date),
        dueDate: day(document.due_date),
        counterparty: bankTextOrNull(document.counterparty_name),
        currency: str(document.currency) || 'PLN',
        paymentStatus: strOrNull(document.payment_status),
        paid: pickerPaid(document),
        partiallyPaid: pickerIsPartiallyPaid(document),
        // Część potwierdzona przelewami, część oznaczona ręcznie i ile może jeszcze rozliczyć przelew (null — baza bez migracji).
        bankMatched: pickerKnowsBankPart(document) ? pickerBankMatched(document) : null,
        manualPaid: pickerKnowsBankPart(document) ? pickerManualPaid(document) : null,
        bankOpen: pickerKnowsBankPart(document) ? pickerBankOpen(document) : null,
        blocking: blockingReason(document, found.tx),
        cashException: canConfirmCashException(document, found.tx),
        plannedAmount: planned.amount,
        plannedPartial: planned.partial,
        plannedLeft: planned.left,
        previewable: previewable(document.document_source),
      };
    }),
  };
}

/** „Dopasuj” w oknie wyboru dokumentu — ponowny odczyt dokumentu i te same warunki co w CRM (także wyjątek gotówki KSeF). */
export async function matchDocument(ctx: NativeContext, body: Row) {
  const found = await pickerTransaction(ctx, body.transactionId, body.allocated);
  await requireManage(ctx, found.companyId);
  const source = str(body.source);
  const documentId = uuid(body.documentId, 'Nieprawidłowy dokument.');
  const documents = await pickerRows(ctx, found.id);
  const document = documents.find((d) => d.document_source === source && d.document_id === documentId);
  if (!document) fail('Dokument nie jest już dostępny do dopasowania. Odśwież listę.');
  const reviewNote = str(body.cashNote).trim();
  const cashException = reviewNote.length > 0 && canConfirmCashException(document, found.tx);
  const blocked = blockingReason(document, found.tx, cashException);
  if (blocked) fail(blocked);
  if (cashConflict(document) && (!cashException || reviewNote.length < 3)) {
    fail('Wpisz uzasadnienie wyjątku (co najmniej 3 znaki) i potwierdź, że płatność była przelewem.');
  }
  const grossAmount = Math.abs(Number(document.gross_amount || 0));
  const { amount: allocationAmount, documentAmount, sameCurrency: same, partial, left } = plannedAllocation(document, found.tx);
  const exceptionReasons = cashException ? [
    'Świadomie potwierdzono ręczne dopasowanie do wyciągu mimo oznaczenia gotówki na fakturze KSeF. Oryginalny sposób płatności i XML pozostają bez zmian.',
    `Uzasadnienie użytkownika: ${reviewNote}`,
  ] : [];
  try {
    if (document.document_source === 'personnel') {
      await reconcilePersonnelPaymentWithBankTransaction(ctx.supabase, {
        transactionId: found.id, personnelPaymentId: document.document_id, amount: grossAmount, confidence: 1,
        reasons: ['Dokument kadrowy wybrany ręcznie ze szczegółowej analizy wyciągu'],
      });
    } else if (document.document_source === 'external') {
      await reconcileExternalInvoiceWithBankTransaction(ctx.supabase, {
        transactionId: found.id, externalInvoiceId: document.document_id, transactionAmount: allocationAmount,
        documentAmount: same ? allocationAmount : documentAmount, confidence: 1,
        reasons: ['Dokument spoza KSeF wybrany ręcznie ze szczegółowej analizy wyciągu'],
      });
    } else if (document.document_source === 'ksef' && pickerPaid(document) && !pickerKnowsBankPart(document)) {
      // Baza bez migracji 20261202180000 — faktura „opłacona” przyjmuje przelew tylko w miejsce ręcznego oznaczenia.
      await reconcilePaidKsefInvoiceWithBankTransaction(ctx.supabase, {
        transactionId: found.id, ksefInvoiceId: document.document_id, amount: allocationAmount, confidence: 1,
        reasons: ['Opłacony dokument KSeF wybrany ręcznie ze szczegółowej analizy wyciągu', ...exceptionReasons],
      });
    } else {
      await applyBankTransactionMatchToDocument(ctx.supabase, {
        transactionId: found.id, documentSource: document.document_source, documentId: document.document_id,
        amount: allocationAmount, confidence: 1, method: 'manual',
        reasons: ['Dokument wybrany ręcznie ze szczegółowej analizy wyciągu', ...exceptionReasons],
      });
    }
  } catch (error) {
    const value = error as { message?: string; code?: string };
    rpcFail(value, 'Nie udało się dopasować dokumentu.');
  }
  const number = document.document_number || 'dokumentu';
  let message: string;
  if (partial && pickerKnowsBankPart(document)) {
    message = `Dopasowano ${money(allocationAmount, document.currency)} do ${number}. Wyciąg potwierdza ${money(pickerBankMatched(document) + allocationAmount, document.currency)} z ${money(grossAmount, document.currency)} — brakuje ${money(left, document.currency)}.`;
  } else if (partial) {
    message = `Dopasowano część płatności do ${number}. Faktura jest częściowo opłacona — pozostało ${money(left, document.currency)}.`;
  } else {
    message = `Dopasowano ${document.document_number || 'wybrany dokument'}.`;
  }
  // Baza po częściowym powiązaniu szuka płatności tego kontrahenta na brakującą kwotę (propozycja `reszta_platnosci`).
  const suggestion = partial && document.document_source !== 'personnel'
    ? await loadPaymentRemainderSuggestion(ctx.supabase, document.document_id)
    : null;
  if (suggestion) {
    message += ` Proponowana druga część: płatność z ${plDate(suggestion.date)} na ${money(suggestion.amount, suggestion.currency)} — zatwierdź ją w uzgodnieniu.`;
  }
  return {
    ok: true,
    message,
    suggestion: suggestion ? { transactionId: suggestion.transactionId, date: suggestion.date, amount: suggestion.amount } : null,
  };
}

// MARK: Wyjaśnienie bez faktury (`BankTransactionAccountingModal`)

type ExplainAction = {
  subtype: string;
  label: string;
  category: string;
  defaultNote: string;
  documentType?: string;
  documentLabel?: string;
  resolvesWithoutDocument?: boolean;
  alwaysPending?: boolean;
  direction?: 'credit' | 'debit';
};

/** Lista jak `BANK_ACCOUNTING_ACTIONS` w CRM (kolejność, opisy, dokumenty, kierunek). */
const EXPLAIN_ACTIONS: ExplainAction[] = [
  { subtype: 'automatic_vat_transfer', label: 'Automatyczny transfer: rachunek bieżący ↔ VAT', category: 'own_transfer', defaultNote: 'Automatyczny transfer środków pomiędzy własnym rachunkiem bieżącym a rachunkiem VAT — nie wymaga dokumentu.', resolvesWithoutDocument: true },
  { subtype: 'vat7_payment', label: 'Płatność VAT-7 / JPK_V7 do urzędu', category: 'tax_or_zus', defaultNote: 'Rozliczenie podatku VAT. Podstawą jest deklaracja VAT-7 lub JPK_V7.', documentType: 'vat7_declaration', documentLabel: 'deklarację VAT-7 / JPK_V7' },
  { subtype: 'pit4_payment', label: 'Płatność PIT-4R', category: 'tax_or_zus', defaultNote: 'Rozliczenie zaliczek PIT od wynagrodzeń. Podstawą jest PIT-4R lub zestawienie księgowe.', documentType: 'pit4_declaration', documentLabel: 'deklarację PIT-4R' },
  { subtype: 'zus_payment', label: 'Płatność ZUS', category: 'tax_or_zus', defaultNote: 'Rozliczenie składek ZUS. Podstawą jest deklaracja DRA lub potwierdzenie rozliczenia.', documentType: 'zus_declaration', documentLabel: 'deklarację ZUS DRA' },
  { subtype: 'payroll_payment', label: 'Wynagrodzenie / lista płac', category: 'payroll', defaultNote: 'Wypłata wynagrodzenia na podstawie listy płac.', documentType: 'payroll_list', documentLabel: 'listę płac' },
  { subtype: 'bank_fee', label: 'Opłata lub prowizja bankowa', category: 'bank_fee', defaultNote: 'Opłata bankowa udokumentowana na wyciągu bankowym.', resolvesWithoutDocument: true },
  { subtype: 'own_transfer', label: 'Przelew między własnymi kontami', category: 'own_transfer', defaultNote: 'Przelew pomiędzy własnymi rachunkami — nie wymaga faktury.', resolvesWithoutDocument: true },
  { subtype: 'cash_settlement', label: 'Rozliczenie gotówkowe', category: 'cash', defaultNote: 'Operacja związana z rozliczeniem gotówkowym — nie jest płatnością faktury z tego rachunku.', resolvesWithoutDocument: true },
  { subtype: 'owner_deposit', label: 'Wpłata własna (środki właściciela, np. gotówka we wpłatomacie)', category: 'own_transfer', defaultNote: 'Wpłata własnych środków właściciela na rachunek firmy (np. gotówka we wpłatomacie). Nie jest przychodem i nie wymaga faktury.', resolvesWithoutDocument: true, direction: 'credit' },
  { subtype: 'owner_withdrawal', label: 'Wypłata własna (pobranie środków przez właściciela)', category: 'own_transfer', defaultNote: 'Wypłata środków z rachunku firmy na potrzeby własne właściciela (np. gotówka z bankomatu). Nie jest kosztem i nie wymaga faktury.', resolvesWithoutDocument: true, direction: 'debit' },
  { subtype: 'supplier_invoice_missing', label: 'Brak faktury od dostawcy', category: 'foreign_purchase', defaultNote: 'Dostawca nie wystawił faktury na właściwą działalność. Dokument pozostaje do pozyskania.', alwaysPending: true },
  { subtype: 'other', label: 'Inne wyjaśnienie', category: 'other', defaultNote: '' },
];

const SUPPORTING_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function safeFileName(name: string) {
  const parts = name.split('.');
  const extension = parts.length > 1 ? `.${parts.pop()}` : '';
  const base = parts.join('.').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return `${base.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'dokument'}${extension.toLowerCase().replace(/[^a-z0-9.]/g, '')}`;
}

/** Opcje okna „Wyjaśnij płatność” dla operacji i — przy transferze VAT / VAT-7 — operacje z drugiego rachunku. */
export async function explainSetup(ctx: NativeContext, transactionId: unknown) {
  const id = uuid(transactionId, 'Nieprawidłowa operacja.');
  const { tx, statement, companyId } = await transactionCompany(ctx, id);
  const { canManage } = await companyAccess(ctx, companyId);
  const direction = tx.transaction_type === 'credit' ? 'credit' : 'debit';
  const [statementResult, candidatesResult, noteResult] = await Promise.all([
    ctx.supabase.from('bank_statements').select('account_type,account_number,file_name').eq('id', statement.id).maybeSingle(),
    ctx.supabase.rpc('get_vat_transfer_candidates', { p_transaction_id: id }),
    ctx.supabase.from('bank_transactions').select('accounting_note').eq('id', id).maybeSingle(),
  ]);
  const migrationMissing = candidatesResult.error && ['PGRST202', '42703'].includes(String(candidatesResult.error.code || ''));
  return {
    canManage,
    direction,
    note: strOrNull(noteResult.data?.accounting_note),
    actions: EXPLAIN_ACTIONS.filter((action) => !action.direction || action.direction === direction).map((action) => ({
      subtype: action.subtype,
      label: action.label,
      defaultNote: action.defaultNote,
      documentLabel: action.documentLabel ?? null,
      requiresDocument: Boolean(action.documentType),
      resolvesWithoutDocument: action.resolvesWithoutDocument === true,
      alwaysPending: action.alwaysPending === true,
    })),
    statement: statementResult.data ? {
      accountType: str(statementResult.data.account_type) === 'vat' ? 'vat' : 'regular',
      accountSuffix: accountSuffix(statementResult.data.account_number),
      fileName: strOrNull(statementResult.data.file_name),
    } : null,
    vatCandidates: rows(candidatesResult.data).map((c) => ({
      id: str(c.transaction_id),
      date: day(c.transaction_date) || '',
      amount: num(c.amount),
      currency: str(c.currency) || 'PLN',
      direction: c.transaction_type === 'credit' ? 'credit' : 'debit',
      counterparty: bankTextOrNull(c.counterparty_name) || strOrNull(c.title),
      accountType: str(c.account_type) === 'vat' ? 'vat' : 'regular',
      accountSuffix: accountSuffix(c.account_number),
      fileName: strOrNull(c.statement_file_name),
      dayDistance: num(c.day_distance),
    })),
    vatCandidatesError: candidatesResult.error
      ? migrationMissing ? 'Parowanie rachunku VAT wymaga migracji 20260904140000 w Supabase.' : candidatesResult.error.message || 'Nie udało się pobrać operacji z drugiego rachunku.'
      : null,
  };
}

function accountSuffix(value: unknown) {
  const digits = str(value).replace(/\D/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
}

/**
 * Zapis wyjaśnienia (jak `save` w `BankTransactionAccountingModal`): transfer VAT — połączenie obu stron; pozostałe —
 * opis księgowy, kategoria i stan (wyjaśniona / do kontroli), z opcjonalnym dokumentem źródłowym w magazynie.
 */
export async function explainTransaction(ctx: NativeContext, body: Row, file: File | null) {
  const { id, tx, companyId } = await manageTransaction(ctx, body.transactionId);
  const direction = tx.transaction_type === 'credit' ? 'credit' : 'debit';
  const action = EXPLAIN_ACTIONS.find((item) => item.subtype === str(body.subtype) && (!item.direction || item.direction === direction));
  if (!action) fail('Wybierz rodzaj wyjaśnienia.');
  const note = str(body.note).trim();
  if (!note) fail('Dodaj krótki opis księgowy.');

  if (action.subtype === 'automatic_vat_transfer') {
    const counterpart = uuid(body.counterpartId, 'Wybierz przeciwną operację z drugiego rachunku.');
    const { error } = await ctx.supabase.rpc('link_vat_account_transactions', { p_transaction_id: id, p_counterpart_transaction_id: counterpart, p_note: note });
    if (error) {
      if (['PGRST202', '42703'].includes(String(error.code || ''))) fail('Brakuje migracji parowania rachunku VAT. Uruchom migrację 20260904140000 i spróbuj ponownie.');
      rpcFail(error, 'Nie udało się zapisać wyjaśnienia.');
    }
    return { ok: true, resolved: true, tone: 'success', message: 'Połączono obie strony transferu. Nie jest wymagany dokument.' };
  }

  if (file) {
    if (!SUPPORTING_MIME.includes(file.type)) fail('Dołącz PDF, JPG, PNG albo WEBP.');
    if (file.size > 15 * 1024 * 1024) fail('Plik może mieć maksymalnie 15 MB.');
  }
  const requiresDocument = Boolean(action.documentType);
  const resolved = action.alwaysPending ? false : action.resolvesWithoutDocument ? true : requiresDocument ? Boolean(file) : false;

  let storagePath: string | null = null;
  let supportingDocumentId: string | null = null;
  try {
    if (file) {
      storagePath = `${companyId}/${id}/${randomUUID()}-${safeFileName(file.name)}`;
      const { error: uploadError } = await ctx.supabase.storage.from('bank-supporting-documents')
        .upload(storagePath, new Uint8Array(await file.arrayBuffer()), { cacheControl: '3600', upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;
      const transactionDate = day(tx.transaction_date) || '';
      const { data: document, error: documentError } = await ctx.supabase.from('bank_transaction_supporting_documents').insert({
        bank_transaction_id: id,
        document_type: action.documentType || 'other',
        title: `${action.label} — ${new Date(transactionDate).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' })}`,
        document_date: transactionDate,
        amount: Math.abs(num(tx.amount)),
        currency: str(tx.currency) || 'PLN',
        storage_path: storagePath,
        original_file_name: file.name,
        mime_type: file.type || null,
        file_size: file.size,
        notes: note,
      }).select('id').single();
      if (documentError) throw documentError;
      supportingDocumentId = String(document.id);
    }
    const { error: updateError } = await ctx.supabase.from('bank_transactions').update({
      accounting_category: action.category,
      accounting_subtype: action.subtype,
      accounting_note: note,
      accounting_review_status: resolved ? 'explained' : 'pending',
      accounting_reviewed_at: resolved ? new Date().toISOString() : null,
    }).eq('id', id);
    if (updateError) throw updateError;
  } catch (error) {
    if (supportingDocumentId) await ctx.supabase.from('bank_transaction_supporting_documents').delete().eq('id', supportingDocumentId);
    if (storagePath) await ctx.supabase.storage.from('bank-supporting-documents').remove([storagePath]);
    const value = error as { message?: string; code?: string };
    if (['PGRST204', 'PGRST205', '42P01'].includes(String(value?.code || ''))) {
      fail('Brakuje migracji dokumentów bankowych. Uruchom migrację 20260903214000 i spróbuj ponownie.');
    }
    rpcFail(value, 'Nie udało się zapisać wyjaśnienia.');
  }
  if (resolved) return { ok: true, resolved, tone: 'success', message: 'Płatność została opisana i oznaczona jako wyjaśniona.' };
  if (requiresDocument && !file) {
    return { ok: true, resolved, tone: 'warning', message: `Opis zapisany. Dołącz ${action.documentLabel || 'dokument'}, aby zamknąć kontrolę.` };
  }
  return { ok: true, resolved, tone: 'warning', message: 'Opis zapisany. Płatność pozostaje do kontroli.' };
}

// MARK: Szczegóły operacji (`BankTransactionDetailsModal`)

const SUPPORTING_TYPES: Record<string, string> = {
  payroll_list: 'Lista płac', vat7_declaration: 'Deklaracja VAT-7', pit4_declaration: 'Deklaracja PIT-4R',
  zus_declaration: 'Deklaracja ZUS', bank_confirmation: 'Potwierdzenie bankowe', other: 'Dokument',
};

export async function transactionDetails(ctx: NativeContext, transactionId: unknown) {
  const id = uuid(transactionId, 'Nieprawidłowa operacja.');
  const { data: row, error } = await ctx.supabase.from('bank_transactions')
    .select('id,statement_id,transaction_date,posting_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,reference_number,raw_description,raw_counterparty,accounting_note,accounting_category,accounting_subtype,accounting_review_status,paired_bank_transaction_id,source_verified,created_at')
    .eq('id', id).maybeSingle();
  if (error || !row) fail('Nie udało się pobrać aktualnej transakcji. Mogła zostać usunięta albo Twoje konto nie ma dostępu.', 404);
  const [statementResult, supportingResult] = await Promise.all([
    ctx.supabase.from('bank_statements').select('id,my_company_id,file_name,import_format,file_type,account_type,account_number,statement_month,statement_year').eq('id', row.statement_id).maybeSingle(),
    ctx.supabase.from('bank_transaction_supporting_documents').select('id,title,document_type,document_date,amount,currency,original_file_name,notes,storage_path').eq('bank_transaction_id', id).order('created_at', { ascending: true }),
  ]);
  const statement = statementResult.data as Row | null;
  if (!statement?.my_company_id) fail('Nie można potwierdzić źródłowego wyciągu i działalności.', 404);
  await companyAccess(ctx, String(statement.my_company_id));
  let paired: Row | null = null;
  if (row.paired_bank_transaction_id) {
    const { data: pair } = await ctx.supabase.from('bank_transactions')
      .select('id,statement_id,transaction_date,amount,currency,transaction_type,counterparty_name,title')
      .eq('id', row.paired_bank_transaction_id).maybeSingle();
    if (pair) {
      const { data: pairStatement } = await ctx.supabase.from('bank_statements').select('account_type,account_number,file_name,my_company_id').eq('id', pair.statement_id).maybeSingle();
      if (pairStatement && pairStatement.my_company_id === statement.my_company_id) {
        paired = {
          id: str(pair.id),
          date: day(pair.transaction_date) || '',
          amount: num(pair.amount),
          currency: str(pair.currency) || 'PLN',
          direction: pair.transaction_type === 'credit' ? 'credit' : 'debit',
          counterparty: bankTextOrNull(pair.counterparty_name) || bankTextOrNull(pair.title),
          accountType: str(pairStatement.account_type) === 'vat' ? 'vat' : 'regular',
          accountSuffix: accountSuffix(pairStatement.account_number),
          fileName: strOrNull(pairStatement.file_name),
        };
      }
    }
  }
  return {
    id,
    date: day(row.transaction_date) || '',
    postingDate: day(row.posting_date),
    amount: num(row.amount),
    currency: str(row.currency) || 'PLN',
    direction: row.transaction_type === 'credit' ? 'credit' : 'debit',
    counterparty: bankTextOrNull(row.counterparty_name),
    counterpartyAccount: strOrNull(row.counterparty_account),
    title: bankTextOrNull(row.title),
    reference: strOrNull(row.reference_number),
    rawDescription: bankTextOrNull(row.raw_description),
    rawCounterparty: bankTextOrNull(row.raw_counterparty),
    accountingNote: strOrNull(row.accounting_note),
    reviewStatus: strOrNull(row.accounting_review_status),
    explanation: row.accounting_category ? explanationLabel(str(row.accounting_category), strOrNull(row.accounting_subtype)) : null,
    sourceVerified: row.source_verified === true,
    statement: {
      fileName: strOrNull(statement.file_name),
      format: bankStatementImportFormat(statement as any),
      accountType: str(statement.account_type) === 'vat' ? 'vat' : 'regular',
      account: resolveStatementAccount(statement as any).accountNumber || null,
      year: num(statement.statement_year),
      month: num(statement.statement_month),
    },
    supporting: rows(supportingResult.data).map((doc) => ({
      id: str(doc.id),
      title: str(doc.title),
      type: SUPPORTING_TYPES[str(doc.document_type)] || 'Dokument',
      date: day(doc.document_date),
      amount: numOrNull(doc.amount),
      currency: str(doc.currency) || 'PLN',
      fileName: strOrNull(doc.original_file_name),
      notes: strOrNull(doc.notes),
      hasFile: Boolean(doc.storage_path),
    })),
    paired,
  };
}

// MARK: Deklaracje ZUS i podatkowe (`FinanceDeclarationsPanel`)

const DECLARATIONS_BUCKET = 'finance-declarations';

function declarationOf(d: Row) {
  return {
    id: str(d.id),
    companyId: str(d.company_id),
    kind: str(d.kind) || 'other',
    form: str(d.form),
    label: str(d.label),
    periodKind: str(d.period_kind) || 'month',
    periodStart: day(d.period_start) || '',
    periodEnd: day(d.period_end) || '',
    amountDue: numOrNull(d.amount_due),
    dueDate: day(d.due_date),
    notes: strOrNull(d.notes),
    createdFrom: str(d.created_from) || 'manual',
    paid: num(d.paid),
    status: str(d.status) || 'draft',
    payments: rows(d.payments).map((p) => ({
      id: str(p.id),
      transactionId: str(p.transaction_id),
      date: day(p.date) || '',
      amount: num(p.amount),
      method: matchMethodLabel(strOrNull(p.method)),
      reasons: strings(p.reasons),
      title: bankTextOrNull(p.title),
      statementYear: num(p.statement_year),
      statementMonth: num(p.statement_month),
    })),
    files: rows(d.files).map((f) => ({
      id: str(f.id),
      path: str(f.storage_path),
      name: str(f.file_name),
      size: numOrNull(f.file_size),
      createdAt: strOrNull(f.created_at),
    })),
    lines: rows(d.lines).map((l) => ({
      id: str(l.id),
      contractId: strOrNull(l.contract_id),
      contractNumber: strOrNull(l.contract_number),
      personName: str(l.person_name),
      socialInsured: num(l.social_insured),
      socialPayer: num(l.social_payer),
      health: num(l.health),
      funds: num(l.funds),
      pit: num(l.pit),
      amount: num(l.amount),
      notes: strOrNull(l.notes),
    })),
    linesTotal: num(d.lines_total),
  };
}

export async function declarations(ctx: NativeContext, companyParam: unknown, yearsParam: unknown) {
  const companyId = uuid(companyParam, 'Nieprawidłowa działalność.');
  const years = Array.from(new Set(str(yearsParam).split(',').map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value >= 2000 && value <= 2100))).slice(0, 3);
  if (years.length === 0) fail('Nieprawidłowy rok.');
  const { canManage } = await companyAccess(ctx, companyId);
  const results = await Promise.all(years.map((year) => ctx.supabase.rpc('get_finance_declarations', { p_company_id: companyId, p_year: year })));
  const failed = results.find((result) => result.error);
  if (failed?.error) rpcFail(failed.error, 'Nie udało się wczytać deklaracji.');
  return { companyId, years, canManage, declarations: results.flatMap((result) => rows(result.data).map(declarationOf)) };
}

const DECLARATION_KINDS = new Set(['zus', 'pit', 'vat', 'cit', 'other']);
const PERIOD_KINDS = new Set(['month', 'quarter', 'year']);

export async function saveDeclaration(ctx: NativeContext, body: Row) {
  const companyId = uuid(body.companyId, 'Nieprawidłowa działalność.');
  await requireManage(ctx, companyId);
  const id = body.id ? uuid(body.id, 'Nieprawidłowa deklaracja.') : null;
  const kind = str(body.kind);
  const periodKind = str(body.periodKind);
  if (!DECLARATION_KINDS.has(kind)) fail('Wybierz rodzaj deklaracji.');
  if (!PERIOD_KINDS.has(periodKind)) fail('Wybierz okres deklaracji.');
  const form = str(body.form).trim();
  if (!form) fail('Podaj symbol deklaracji.');
  const periodStart = day(body.periodStart);
  if (!periodStart || !/^\d{4}-\d{2}-01$/.test(periodStart)) fail('Podaj okres deklaracji.');
  const amountText = str(body.amountDue).trim();
  const dueDate = day(body.dueDate);
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) fail('Nieprawidłowy termin płatności.');
  const { data, error } = await ctx.supabase.rpc('save_finance_declaration', {
    p_id: id, p_company_id: companyId, p_kind: kind, p_form: form, p_period_kind: periodKind, p_period_start: periodStart,
    p_amount_due: amountText === '' ? null : amountInput(amountText), p_due_date: dueDate || null, p_notes: str(body.notes).trim() || null,
  });
  if (error) rpcFail(error, 'Nie udało się zapisać deklaracji.');
  return { ok: true, id: str(data), message: 'Deklaracja zapisana.' };
}

async function declarationCompany(ctx: NativeContext, declarationId: string) {
  const { data, error } = await ctx.supabase.from('finance_declarations').select('id,company_id').eq('id', declarationId).maybeSingle();
  if (error || !data?.company_id) fail('Nie znaleziono deklaracji albo nie masz do niej dostępu.', 404);
  return String(data.company_id);
}

export async function deleteDeclaration(ctx: NativeContext, body: Row) {
  const id = uuid(body.id, 'Nieprawidłowa deklaracja.');
  await requireManage(ctx, await declarationCompany(ctx, id));
  const { data, error } = await ctx.supabase.rpc('delete_finance_declaration', { p_id: id });
  if (error) rpcFail(error, 'Nie udało się usunąć deklaracji.');
  const paths = strings(data);
  if (paths.length) await ctx.supabase.storage.from(DECLARATIONS_BUCKET).remove(paths);
  return { ok: true, message: 'Deklaracja usunięta.' };
}

export async function saveDeclarationLine(ctx: NativeContext, body: Row) {
  const declarationId = uuid(body.declarationId, 'Nieprawidłowa deklaracja.');
  await requireManage(ctx, await declarationCompany(ctx, declarationId));
  const person = str(body.personName).trim();
  if (!person) fail('Podaj imię i nazwisko.');
  const { error } = await ctx.supabase.rpc('save_finance_declaration_line', {
    p_id: body.id ? uuid(body.id, 'Nieprawidłowa pozycja.') : null,
    p_declaration_id: declarationId,
    p_contract_id: body.contractId ? uuid(body.contractId, 'Nieprawidłowa umowa.') : null,
    p_person_name: person,
    p_social_insured: amountInput(body.socialInsured),
    p_social_payer: amountInput(body.socialPayer),
    p_health: amountInput(body.health),
    p_funds: amountInput(body.funds),
    p_pit: amountInput(body.pit),
    p_notes: str(body.notes).trim() || null,
  });
  if (error) rpcFail(error, 'Operacja nie powiodła się.');
  return { ok: true, message: 'Pozycja zapisana.' };
}

export async function deleteDeclarationLine(ctx: NativeContext, body: Row) {
  const declarationId = uuid(body.declarationId, 'Nieprawidłowa deklaracja.');
  await requireManage(ctx, await declarationCompany(ctx, declarationId));
  const { error } = await ctx.supabase.rpc('delete_finance_declaration_line', { p_id: uuid(body.id, 'Nieprawidłowa pozycja.') });
  if (error) rpcFail(error, 'Operacja nie powiodła się.');
  return { ok: true, message: 'Pozycja usunięta.' };
}

export async function prefillDeclarationLines(ctx: NativeContext, body: Row) {
  const declarationId = uuid(body.declarationId, 'Nieprawidłowa deklaracja.');
  await requireManage(ctx, await declarationCompany(ctx, declarationId));
  const { error } = await ctx.supabase.rpc('prefill_finance_declaration_lines', { p_declaration_id: declarationId });
  if (error) rpcFail(error, 'Operacja nie powiodła się.');
  return { ok: true, message: 'Dodano osoby z umów obowiązujących w tym okresie.' };
}

export async function addDeclarationFile(ctx: NativeContext, declarationParam: unknown, file: File) {
  const declarationId = uuid(declarationParam, 'Nieprawidłowa deklaracja.');
  const companyId = await declarationCompany(ctx, declarationId);
  await requireManage(ctx, companyId);
  if (file.size > 20 * 1024 * 1024) fail('Plik jest większy niż 20 MB.');
  const safe = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'plik';
  const path = `${companyId}/${declarationId}/${Date.now()}-${safe}`;
  const { error: uploadError } = await ctx.supabase.storage.from(DECLARATIONS_BUCKET)
    .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false });
  if (uploadError) fail(uploadError.message || 'Nie udało się wgrać pliku.');
  const { error } = await ctx.supabase.rpc('add_finance_declaration_file', {
    p_declaration_id: declarationId, p_storage_path: path, p_file_name: file.name, p_mime_type: file.type || null, p_file_size: file.size,
  });
  if (error) {
    await ctx.supabase.storage.from(DECLARATIONS_BUCKET).remove([path]);
    rpcFail(error, 'Nie udało się zapisać pliku.');
  }
  return { ok: true, message: 'Plik deklaracji dodany.' };
}

export async function removeDeclarationFile(ctx: NativeContext, body: Row) {
  const declarationId = uuid(body.declarationId, 'Nieprawidłowa deklaracja.');
  await requireManage(ctx, await declarationCompany(ctx, declarationId));
  const { data, error } = await ctx.supabase.rpc('remove_finance_declaration_file', { p_file_id: uuid(body.id, 'Nieprawidłowy plik.') });
  if (error) rpcFail(error, 'Nie udało się usunąć pliku.');
  if (data) await ctx.supabase.storage.from(DECLARATIONS_BUCKET).remove([String(data)]);
  return { ok: true, message: 'Plik usunięty.' };
}

export async function linkDeclaration(ctx: NativeContext, body: Row) {
  const { id } = await manageTransaction(ctx, body.transactionId);
  const amountText = str(body.amount).trim();
  const { error } = await ctx.supabase.rpc('link_bank_transaction_to_declaration', {
    p_transaction_id: id, p_declaration_id: uuid(body.declarationId, 'Nieprawidłowa deklaracja.'),
    p_amount: amountText === '' ? null : amountInput(amountText),
  });
  if (error) rpcFail(error, 'Nie udało się przypisać przelewu.');
  return { ok: true, message: 'Przelew przypisany do deklaracji.' };
}

// MARK: Umowy stałe — przypisanie przelewu (`RecurringContractLinkModal`) i nowa umowa z płatności

export async function contractCandidates(ctx: NativeContext, transactionParam: unknown, remainingParam: unknown) {
  const id = uuid(transactionParam, 'Nieprawidłowa operacja.');
  const { tx, companyId } = await transactionCompany(ctx, id);
  const { canManage } = await companyAccess(ctx, companyId);
  const remaining = remainingParam === null || remainingParam === undefined || remainingParam === ''
    ? Math.max(Math.abs(num(tx.amount)) - num(tx.allocated_amount), 0) : num(remainingParam);
  const { data, error } = await ctx.supabase.rpc('get_finance_recurring_contracts', { p_company_id: companyId });
  if (error) rpcFail(error, 'Nie udało się wczytać umów stałych.');
  const direction = tx.transaction_type === 'credit' ? 'income' : 'cost';
  const currency = str(tx.currency) || 'PLN';
  const transaction = {
    counterparty_account: strOrNull(tx.counterparty_account),
    counterparty: bankText(tx.counterparty_name),
    title: bankText(tx.title),
    remaining,
  };
  const date = day(tx.transaction_date) || '';
  const contracts = (rows(data) as RecurringContract[])
    .filter((c) => c.direction === direction && c.currency === currency)
    .map((contract) => ({ contract, evidence: contractMatchEvidence(contract, transaction) }))
    .sort((a, b) => Number(b.contract.status === 'active') - Number(a.contract.status === 'active')
      || b.evidence.score - a.evidence.score || str(a.contract.title).localeCompare(str(b.contract.title), 'pl'));
  const best = contracts.find((c) => !c.contract.expects_invoice && c.evidence.score >= 3) || null;
  return {
    canManage,
    companyId,
    transaction: {
      id, date, amount: Math.abs(num(tx.amount)), remaining, currency, direction: tx.transaction_type === 'credit' ? 'credit' : 'debit',
      counterparty: transaction.counterparty || null, counterpartyAccount: transaction.counterparty_account, title: transaction.title || null,
    },
    bestId: best ? str(best.contract.id) : null,
    contracts: contracts.map(({ contract: c, evidence }) => {
      const suggested = defaultContractPeriod(c, date);
      const open = suggested ? Number(suggested.missing) : Number(c.amount);
      return {
        id: str(c.id),
        title: str(c.title),
        counterparty: str(c.counterparty_name),
        amount: num(c.amount),
        currency: str(c.currency) || 'PLN',
        cycle: str(c.billing_cycle) || 'monthly',
        ended: c.status === 'ended',
        expectsInvoice: c.expects_invoice === true,
        evidence: { account: evidence.account, name: evidence.name, amount: evidence.amount },
        suggestedPeriod: suggested?.period_start ?? null,
        suggestedAmount: Math.round(Math.min(remaining, open > 0.009 ? open : remaining) * 100) / 100,
        periods: (c.periods || []).map((p) => ({
          start: day(p.period_start) || '',
          label: str(p.label),
          amount: num(p.amount),
          paid: num(p.paid),
          missing: num(p.missing),
          status: str(p.status),
        })),
      };
    }),
  };
}

export async function linkContract(ctx: NativeContext, body: Row) {
  const { id } = await manageTransaction(ctx, body.transactionId);
  const periodStart = day(body.periodStart);
  const amountText = str(body.amount).trim();
  const { error } = await ctx.supabase.rpc('link_bank_transaction_to_recurring_contract', {
    p_transaction_id: id, p_contract_id: uuid(body.contractId, 'Nieprawidłowa umowa.'),
    p_period_start: periodStart || null, p_amount: amountText === '' ? null : amountInput(amountText),
  });
  if (error) rpcFail(error, 'Nie udało się przypisać przelewu.');
  return { ok: true, message: 'Przelew przypisany do umowy.' };
}

const CONTRACT_KINDS = new Set(['rent', 'lease', 'subscription', 'insurance', 'loan', 'other']);
const CONTRACT_CYCLES = new Set(['monthly', 'quarterly', 'yearly']);
const digits = (value: unknown) => str(value).replace(/\D/g, '');

/** Nowa umowa („Umowy stałe”, „Nowa umowa z tej płatności”) albo zmiana istniejącej (`id`, `status`) — walidacja jak
 *  `RecurringContractFormModal` w CRM. */
export async function saveContract(ctx: NativeContext, body: Row) {
  const companyId = uuid(body.companyId, 'Nieprawidłowa działalność.');
  await requireManage(ctx, companyId);
  const id = body.id ? uuid(body.id, 'Nieprawidłowa umowa.') : null;
  if (id && await contractCompany(ctx, id) !== companyId) fail('Umowa należy do innej działalności.');
  const status = id && body.status === 'ended' ? 'ended' : 'active';
  const kind = str(body.kind);
  const direction = str(body.direction);
  const cycle = str(body.cycle);
  if (!CONTRACT_KINDS.has(kind)) fail('Wybierz rodzaj umowy.');
  if (direction !== 'cost' && direction !== 'income') fail('Wybierz kierunek umowy.');
  if (!CONTRACT_CYCLES.has(cycle)) fail('Wybierz cykl płatności.');
  const title = str(body.title).trim();
  const counterparty = str(body.counterparty).trim();
  const nip = digits(body.nip);
  const account = digits(body.account);
  const amount = amountInput(body.amount);
  const currency = str(body.currency).trim().toUpperCase() || 'PLN';
  const startDate = day(body.startDate);
  const endDate = day(body.endDate);
  if (title.length < 2) fail('Podaj tytuł umowy.');
  if (counterparty.length < 2) fail('Podaj nazwę kontrahenta.');
  if (nip && nip.length !== 10) fail(nip.length === 11 ? 'To wygląda na PESEL — nie zapisujemy go. Przy osobie prywatnej zostaw NIP pusty.' : 'NIP ma 10 cyfr.');
  if (account && (account.length < 10 || account.length > 34)) fail('Nieprawidłowy numer rachunku.');
  if (amount <= 0) fail('Podaj kwotę brutto na okres.');
  if (!startDate) fail('Podaj datę początku umowy.');
  if (endDate && endDate < startDate) fail('Data końca nie może być wcześniejsza niż początek.');
  const dayText = str(body.paymentDay).trim();
  const paymentDay = dayText === '' ? null : Math.round(amountInput(dayText));
  if (paymentDay !== null && (paymentDay < 1 || paymentDay > 31)) fail('Dzień płatności to liczba od 1 do 31.');
  const paymentsFrom = /^\d{4}-\d{2}$/.test(str(body.paymentsFrom)) ? `${str(body.paymentsFrom)}-01` : null;
  const { data, error } = await ctx.supabase.rpc('save_finance_recurring_contract', {
    p_id: id, p_company_id: companyId, p_kind: kind, p_direction: direction, p_title: title.slice(0, 200),
    p_counterparty_name: counterparty.slice(0, 200), p_counterparty_nip: nip || null, p_counterparty_account: account || null,
    p_amount: amount, p_currency: currency, p_billing_cycle: cycle, p_payment_day: paymentDay,
    p_start_date: startDate, p_end_date: endDate || null, p_payments_from: paymentsFrom,
    p_status: status, p_expects_invoice: body.expectsInvoice === true, p_notes: str(body.notes).trim().slice(0, 2000) || null,
  });
  if (error) rpcFail(error, 'Nie udało się zapisać umowy.');
  return { ok: true, id: str(data), message: 'Umowa zapisana.' };
}

// MARK: Umowy stałe — rejestr (Mac: Finanse → „Umowy stałe”; CRM: `RecurringContractsPanel`)

const CONTRACTS_BUCKET = 'finance-contracts';

/** Działalność umowy (odczyt przez RLS — „Podgląd finansów” działalności). */
async function contractCompany(ctx: NativeContext, contractId: string) {
  const { data, error } = await ctx.supabase.from('finance_recurring_contracts').select('id,my_company_id').eq('id', contractId).maybeSingle();
  if (error || !data?.my_company_id) fail('Nie znaleziono umowy albo nie masz do niej dostępu.', 404);
  return String(data.my_company_id);
}

function contractOf(c: Row) {
  const currency = str(c.currency) || 'PLN';
  const summary = object(c.summary);
  return {
    id: str(c.id),
    companyId: str(c.company_id),
    kind: str(c.kind) || 'other',
    direction: c.direction === 'income' ? 'income' : 'cost',
    title: str(c.title),
    counterparty: str(c.counterparty_name),
    nip: strOrNull(c.counterparty_nip),
    account: strOrNull(c.counterparty_account),
    amount: num(c.amount),
    currency,
    cycle: str(c.billing_cycle) || 'monthly',
    paymentDay: numOrNull(c.payment_day),
    startDate: day(c.start_date) || '',
    endDate: day(c.end_date),
    paymentsFrom: day(c.payments_from),
    status: c.status === 'ended' ? 'ended' : 'active',
    expectsInvoice: c.expects_invoice === true,
    notes: strOrNull(c.notes),
    summary: recurringContractSummarySentence(c as RecurringContract, (value) => money(value, currency)),
    overdue: num(summary.overdue),
    overdueAmount: num(summary.overdue_amount),
    nextDueDate: day(summary.next_due_date),
    periods: rows(c.periods).map((p) => ({
      start: day(p.period_start) || '',
      label: str(p.label),
      dueDate: day(p.due_date),
      amount: num(p.amount),
      paid: num(p.paid),
      missing: num(p.missing),
      status: str(p.status) || 'upcoming',
    })),
    payments: rows(c.payments).map((p) => ({
      id: str(p.id),
      transactionId: str(p.transaction_id),
      periodLabel: str(p.period_label),
      date: day(p.date) || '',
      amount: num(p.amount),
      method: matchMethodLabel(strOrNull(p.method)),
      reasons: strings(p.reasons),
      title: bankTextOrNull(p.title),
      counterparty: bankTextOrNull(p.counterparty),
      statementYear: num(p.statement_year),
      statementMonth: num(p.statement_month),
    })),
    files: rows(c.files).map((f) => ({
      id: str(f.id),
      name: str(f.file_name),
      size: numOrNull(f.file_size),
      createdAt: strOrNull(f.created_at),
    })),
  };
}

/** Rejestr umów stałych działalności: okresy (opłacone, brak, po terminie, przyszłe), przelewy z wyciągów i pliki. */
export async function recurringContracts(ctx: NativeContext, companyParam: unknown) {
  const companyId = uuid(companyParam, 'Nieprawidłowa działalność.');
  const { canManage } = await companyAccess(ctx, companyId);
  const { data, error } = await ctx.supabase.rpc('get_finance_recurring_contracts', { p_company_id: companyId });
  if (error) rpcFail(error, 'Nie udało się wczytać umów stałych.');
  return { companyId, canManage, contracts: rows(data).map(contractOf) };
}

/** Usunięcie umowy bez płatności (z plikami); umowa z płatnościami zostaje zakończona i zostaje w historii. */
export async function deleteContract(ctx: NativeContext, body: Row) {
  const id = uuid(body.id, 'Nieprawidłowa umowa.');
  await requireManage(ctx, await contractCompany(ctx, id));
  const { data, error } = await ctx.supabase.rpc('delete_finance_recurring_contract', { p_id: id });
  if (error) rpcFail(error, 'Nie udało się usunąć umowy.');
  const result = object(data);
  const paths = strings(result.paths);
  if (paths.length) await ctx.supabase.storage.from(CONTRACTS_BUCKET).remove(paths);
  const deleted = result.deleted === true;
  return { ok: true, deleted, message: deleted ? 'Umowa usunięta.' : 'Umowa zakończona — zostaje w historii z płatnościami.' };
}

/** Plik umowy lub aneksu (także skan kilku stron połączony w PDF na Macu); `fileName` — nazwa do pokazania (polskie znaki). */
export async function addContractFile(ctx: NativeContext, contractParam: unknown, file: File, nameParam: unknown) {
  const contractId = uuid(contractParam, 'Nieprawidłowa umowa.');
  const companyId = await contractCompany(ctx, contractId);
  await requireManage(ctx, companyId);
  if (file.size > 20 * 1024 * 1024) fail('Plik jest większy niż 20 MB.');
  const fileName = (str(nameParam).trim() || file.name || 'plik').slice(0, 255);
  const safe = fileName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'plik';
  const path = `${companyId}/${contractId}/${Date.now()}-${safe}`;
  const { error: uploadError } = await ctx.supabase.storage.from(CONTRACTS_BUCKET)
    .upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false });
  if (uploadError) fail(uploadError.message || 'Nie udało się wgrać pliku.');
  const { error } = await ctx.supabase.rpc('add_finance_recurring_contract_file', {
    p_contract_id: contractId, p_storage_path: path, p_file_name: fileName, p_mime_type: file.type || null, p_file_size: file.size,
  });
  if (error) {
    await ctx.supabase.storage.from(CONTRACTS_BUCKET).remove([path]);
    rpcFail(error, 'Nie udało się zapisać pliku.');
  }
  return { ok: true, message: 'Plik umowy dodany.' };
}

export async function removeContractFile(ctx: NativeContext, body: Row) {
  const contractId = uuid(body.contractId, 'Nieprawidłowa umowa.');
  await requireManage(ctx, await contractCompany(ctx, contractId));
  const { data, error } = await ctx.supabase.rpc('remove_finance_recurring_contract_file', { p_file_id: uuid(body.id, 'Nieprawidłowy plik.') });
  if (error) rpcFail(error, 'Nie udało się usunąć pliku.');
  if (data) await ctx.supabase.storage.from(CONTRACTS_BUCKET).remove([String(data)]);
  return { ok: true, message: 'Plik usunięty.' };
}

// MARK: Para „płatność + zwrot” (`BankRefundPairModal`)

export async function refundCandidates(ctx: NativeContext, transactionParam: unknown, searchParam: unknown) {
  const id = uuid(transactionParam, 'Nieprawidłowa operacja.');
  const { companyId } = await transactionCompany(ctx, id);
  const { canManage } = await companyAccess(ctx, companyId);
  const search = str(searchParam).trim().slice(0, 120);
  const { data, error } = await ctx.supabase.rpc('get_bank_refund_candidates', { p_transaction_id: id, p_search: search || null });
  if (error) rpcFail(error, 'Nie udało się wczytać operacji do powiązania.');
  const raw = object(data);
  const tx = object(raw.transaction);
  return {
    canManage,
    transaction: {
      id: str(tx.id) || id,
      date: day(tx.date) || '',
      amount: num(tx.amount),
      remaining: num(tx.remaining),
      direction: tx.direction === 'credit' ? 'credit' : 'debit',
      currency: str(tx.currency) || 'PLN',
      counterparty: bankTextOrNull(tx.counterparty),
      title: bankTextOrNull(tx.title),
    },
    total: num(raw.total),
    truncated: raw.truncated === true,
    candidates: rows(raw.candidates).map((c) => ({
      id: str(c.id),
      statementId: str(c.statement_id),
      date: day(c.date) || '',
      amount: num(c.amount),
      remaining: num(c.remaining),
      direction: c.direction === 'credit' ? 'credit' : 'debit',
      currency: str(c.currency) || 'PLN',
      counterparty: bankTextOrNull(c.counterparty),
      title: bankTextOrNull(c.title),
      statementYear: num(c.statement_year),
      statementMonth: num(c.statement_month),
      dayDiff: num(c.day_diff),
      sameAmount: c.same_amount === true,
      sameAccount: c.same_account === true,
      words: strings(c.words),
      evidence: strOrNull(c.evidence),
      blocked: c.blocked === true,
      explained: c.explained === true,
      role: c.role === 'refund' ? 'refund' : 'payment',
      suggestedAmount: num(c.suggested_amount),
      reasons: strings(c.reasons),
    })),
  };
}

export async function linkRefund(ctx: NativeContext, body: Row) {
  const { id } = await manageTransaction(ctx, body.transactionId);
  const amountText = str(body.amount).trim();
  const amount = amountText === '' ? null : amountInput(amountText);
  if (amount !== null && amount <= 0) fail('Kwota pary musi być większa od zera.');
  const { error } = await ctx.supabase.rpc('link_bank_refund_pair', {
    p_transaction_id: id, p_other_transaction_id: uuid(body.otherId, 'Nieprawidłowa operacja.'), p_amount: amount,
  });
  if (error) rpcFail(error, 'Nie udało się powiązać operacji.');
  return { ok: true, message: 'Płatność i zwrot powiązane — obie operacje są rozliczone bez faktury (dowodem jest wyciąg).' };
}

// MARK: Wyciągi (`KSeFFinancialDashboard`: lista plików, import, pobranie, zmiana nazwy, usunięcie)

const STATEMENTS_BUCKET = 'bank-statements';

export async function statements(ctx: NativeContext, companyParam: unknown, yearParam: unknown) {
  const companyId = uuid(companyParam, 'Nieprawidłowa działalność.');
  const year = intIn(yearParam, 2000, 2100, 'Nieprawidłowy rok.');
  const { canManage } = await companyAccess(ctx, companyId);
  const { data, error } = await ctx.supabase.from('bank_statements')
    .select('id,file_name,account_type,account_number,import_format,file_type,statement_month,statement_year,file_storage_path,transactions_count,processed,validation_status,validation_message,opening_balance,closing_balance,currency,created_at')
    .eq('my_company_id', companyId).eq('statement_year', year)
    .order('statement_month', { ascending: false }).order('created_at', { ascending: false });
  if (error) fail('Nie udało się wczytać wyciągów.', 500);
  return {
    companyId,
    year,
    canManage,
    statements: rows(data).map((s) => ({
      id: str(s.id),
      fileName: str(s.file_name),
      accountType: str(s.account_type) === 'vat' ? 'vat' : 'regular',
      account: resolveStatementAccount(s as any).accountNumber || null,
      format: bankStatementImportFormat(s as any),
      month: num(s.statement_month),
      year: num(s.statement_year),
      hasFile: Boolean(s.file_storage_path),
      count: num(s.transactions_count),
      processed: s.processed === true,
      validation: str(s.validation_status) || 'pending',
      validationMessage: strOrNull(s.validation_message),
      opening: numOrNull(s.opening_balance),
      closing: numOrNull(s.closing_balance),
      currency: str(s.currency) || 'PLN',
      createdAt: strOrNull(s.created_at),
    })),
  };
}

async function statementRow(ctx: NativeContext, statementId: unknown) {
  const id = uuid(statementId, 'Nieprawidłowy wyciąg.');
  const { data, error } = await ctx.supabase.from('bank_statements')
    .select('id,file_name,file_storage_path,my_company_id,statement_month,statement_year,account_type,account_number,import_format,file_type')
    .eq('id', id).maybeSingle();
  if (error || !data?.my_company_id) fail('Nie znaleziono wyciągu albo nie masz do niego dostępu.', 404);
  return { id, row: data as Row, companyId: String(data.my_company_id) };
}

export async function renameStatement(ctx: NativeContext, body: Row) {
  const { id, companyId } = await statementRow(ctx, body.id);
  await requireManage(ctx, companyId);
  const name = str(body.name).trim();
  if (!name) fail('Nazwa pliku nie może być pusta.');
  const { error } = await ctx.supabase.from('bank_statements').update({ file_name: name.slice(0, 255) }).eq('id', id);
  if (error) fail(error.message || 'Błąd zmiany nazwy.');
  return { ok: true, message: 'Nazwa wyciągu została zmieniona.' };
}

/** Sprawdzenie przed potwierdzeniem usunięcia (jak w CRM: powiązania, opisy, uprawnienia) i treść pytania. */
export async function checkStatementRemoval(ctx: NativeContext, body: Row) {
  const { id, row, companyId } = await statementRow(ctx, body.id);
  await requireManage(ctx, companyId);
  try {
    await assertBankStatementCanBeRemoved(ctx.supabase, id);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Nie można usunąć tego wyciągu.');
  }
  const accountNumber = resolveStatementAccount(row as any).accountNumber;
  return {
    ok: true,
    question: `Usunąć „${row.file_name}” (${bankStatementImportFormat(row as any)}, rachunek ${accountNumber || 'nierozpoznany'}, ${row.statement_month}/${row.statement_year}) i jego niepowiązane odczyty transakcji? Drugi format oraz pliki innych rachunków pozostaną bez zmian. Po usunięciu możesz wgrać nowy plik.`,
  };
}

export async function deleteStatement(ctx: NativeContext, body: Row) {
  const { id, row: stmt, companyId } = await statementRow(ctx, body.id);
  await requireManage(ctx, companyId);
  try {
    // Ponowne sprawdzenie powiązań tuż przed usunięciem dokładnie tego pliku.
    await assertBankStatementCanBeRemoved(ctx.supabase, id);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Nie można usunąć tego wyciągu.');
  }
  let deleteQuery = ctx.supabase.from('bank_statements').delete()
    .eq('id', id).eq('my_company_id', stmt.my_company_id)
    .eq('statement_month', stmt.statement_month).eq('statement_year', stmt.statement_year)
    .eq('file_name', stmt.file_name).eq('account_type', stmt.account_type);
  deleteQuery = stmt.file_storage_path ? deleteQuery.eq('file_storage_path', stmt.file_storage_path) : deleteQuery.is('file_storage_path', null);
  const { data: deleted, error } = await deleteQuery.select('id');
  if (error) fail(error.message || 'Błąd usuwania wyciągu.');
  if ((deleted || []).length !== 1) fail('Plik zmienił się w trakcie operacji. Odśwież listę i spróbuj ponownie.');
  // Oryginał zostaje, gdy magazyn odmówi usunięcia (wpis już usunięty).
  let retainedOriginal = false;
  if (stmt.file_storage_path) {
    const { error: storageError } = await ctx.supabase.storage.from(STATEMENTS_BUCKET).remove([stmt.file_storage_path]);
    retainedOriginal = Boolean(storageError);
  }
  await markAnalysesStale(ctx, companyId);
  return {
    ok: true,
    tone: retainedOriginal ? 'warning' : 'success',
    message: retainedOriginal
      ? 'Usunięto wpis i niepowiązane odczyty. Oryginał pozostał w magazynie, ponieważ jego usunięcie się nie powiodło.'
      : 'Usunięto wskazany plik i jego niepowiązane odczyty. Możesz teraz wgrać nowy plik.',
  };
}

async function markAnalysesStale(ctx: NativeContext, companyId: string) {
  const { error } = await ctx.supabase.from('bank_ai_reconciliation_reports').update({ is_stale: true })
    .or(`my_company_id.eq.${companyId},my_company_id.is.null`);
  if (error && !['PGRST205', '42P01'].includes(String(error.code || ''))) {
    console.warn('[native-finance-bank] Nie udało się oznaczyć zapisanej analizy jako nieaktualnej:', error.message);
  }
}

/**
 * Import wyciągu (jak `handleFileUpload` w CRM): PDF — wspólny parser (okres, operacje spoza miesiąca, ciągłość salda),
 * MT940 — Windows-1250/UTF-8 i `parseMT940`; kontrola rachunku (bieżący / VAT), zakaz drugiego pliku tego samego formatu
 * i rachunku, zapis w magazynie i bazie, operacje, transfery VAT, oznaczenie analizy AI jako nieaktualnej, uzgodnienie.
 * Gdy numer rachunku wymaga potwierdzenia — odpowiedź `needsConfirmation` (aplikacja pyta i wysyła ponownie z `confirmAccount`).
 */
export async function importStatement(ctx: NativeContext, fields: { companyId: unknown; year: unknown; month: unknown; accountType: unknown; format: unknown; confirmAccount: unknown }, file: File) {
  const companyId = uuid(fields.companyId, 'Najpierw wybierz działalność.');
  const year = intIn(fields.year, 2000, 2100, 'Nieprawidłowy rok wyciągu.');
  const month = intIn(fields.month, 1, 12, 'Nieprawidłowy miesiąc wyciągu.');
  const accountType = str(fields.accountType) === 'vat' ? 'vat' : 'regular';
  const isMt940 = str(fields.format) === 'MT940';
  await requireManage(ctx, companyId);
  const lowerName = file.name.toLowerCase();
  if (isMt940) {
    if (!/\.(txt|sta|mt940)$/.test(lowerName)) fail('Dla MT940 wybierz plik TXT, STA lub MT940');
  } else if (!lowerName.endsWith('.pdf')) {
    fail('Obsługiwane są wyłącznie pliki PDF');
  }
  if (file.size > 10 * 1024 * 1024) fail(isMt940 ? 'Plik MT940 jest zbyt duży. Maksymalny rozmiar to 10 MB.' : 'Plik PDF jest zbyt duży. Maksymalny rozmiar to 10 MB.');
  const fileType: 'MT940' | 'PDF' = isMt940 ? 'MT940' : 'PDF';
  const accountLabel = accountType === 'vat' ? 'konta VAT' : 'konta bieżącego';

  let parsed: any;
  let fileContent = '';
  if (isMt940) {
    fileContent = await readBankTextFile(file);
    try {
      parsed = parseMT940(fileContent);
    } catch (error) {
      fail(error instanceof Error && error.message ? error.message : 'Nie udało się odczytać pliku MT940.');
    }
  } else {
    try {
      parsed = await parseBankStatementPdf(Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      fail(bankStatementPdfErrorMessage(error));
    }
    fileContent = parsed?.rawText || '[PDF parsed]';
    const expectedPeriod = `${year}-${String(month).padStart(2, '0')}`;
    const parsedPeriod = String(parsed?.periodFrom || '').slice(0, 7);
    if (!parsedPeriod || parsedPeriod !== expectedPeriod) {
      fail(`Wyciąg dotyczy okresu ${parsedPeriod || 'nierozpoznanego'}, a wybrano ${expectedPeriod}. Import został zatrzymany.`);
    }
    const outOfPeriod = (parsed?.transactions || []).filter((t: any) => !String(t.transactionDate || '').startsWith(expectedPeriod));
    if (outOfPeriod.length > 0) fail(`Wyciąg zawiera ${outOfPeriod.length} operacji spoza wybranego miesiąca. Import został zatrzymany.`);
    if (parsed?.integrity?.failedTransitions > 0) fail('Kontrola ciągłości salda wykryła nieprawidłowe kwoty. Import został zatrzymany.');
  }
  const transactions: any[] = parsed?.transactions || [];

  const [statementsResult, companyResult] = await Promise.all([
    ctx.supabase.from('bank_statements')
      .select('id,file_storage_path,file_name,account_type,account_number,import_format,file_type,transactions_count,processed,validation_status')
      .eq('statement_month', month).eq('statement_year', year).eq('my_company_id', companyId),
    ctx.supabase.from('my_companies').select('bank_account,vat_bank_account').eq('id', companyId).single(),
  ]);
  if (statementsResult.error) fail(statementsResult.error.message || 'Nie udało się sprawdzić poprzedniego importu.');
  if (companyResult.error) fail(companyResult.error.message || 'Nie udało się odczytać rachunków działalności.');
  const statementsForMonth = rows(statementsResult.data);
  const resolvedAccount = resolveStatementAccount({ account_number: parsed?.accountNumber, file_name: file.name });
  const importedAccountNumber = resolvedAccount.accountNumber;
  const accountError = validateBankStatementUploadAccount({
    accountType, accountNumber: importedAccountNumber, statements: statementsForMonth as any, companyAccounts: companyResult.data,
  });
  if (accountError) fail(accountError);
  if (resolvedAccount.warning && fields.confirmAccount !== true && str(fields.confirmAccount) !== 'true') {
    return {
      ok: false,
      needsConfirmation: true,
      title: 'Sprawdź numer rachunku',
      question: `${resolvedAccount.warning} Rachunek z treści: ${importedAccountNumber}. Czy zaimportować plik do ${accountType === 'vat' ? 'konta VAT' : 'konta bieżącego'}?`,
      confirm: 'Użyj rachunku z treści',
    };
  }
  const existing = selectBankStatementsForUpload(statementsForMonth as any, accountType, fileType, companyResult.data)
    .filter((statement: any) => resolveStatementAccount(statement).accountNumber === importedAccountNumber);
  if (existing.length > 0) {
    const names = existing.map((statement: any) => `„${statement.file_name}”`).join(', ');
    fail(`${fileType} dla ${accountType === 'vat' ? 'konta VAT' : 'konta bieżącego'} ${importedAccountNumber} za ${month}/${year} jest już zapisany: ${names}. Jeśli chcesz wgrać nową wersję, najpierw użyj „Usuń ten plik” przy właściwym pliku na liście. Nie usuwaj drugiego formatu ani wyciągu innego konta.`);
  }

  const extension = isMt940 ? 'txt' : 'pdf';
  const contentType = isMt940 ? 'text/plain' : 'application/pdf';
  const storagePath = `${companyId}/${year}/${month}_${accountType}_${fileType.toLowerCase()}_${Date.now()}.${extension}`;
  const { error: storageError } = await ctx.supabase.storage.from(STATEMENTS_BUCKET)
    .upload(storagePath, new Uint8Array(await file.arrayBuffer()), { contentType, upsert: true });
  if (storageError) fail(storageError.message || 'Nie udało się przesłać pliku do magazynu.');

  const { data: statement, error: statementError } = await ctx.supabase.from('bank_statements').insert({
    file_name: file.name,
    file_type: fileType,
    file_content: fileContent,
    statement_month: month,
    statement_year: year,
    my_company_id: companyId,
    account_type: accountType,
    file_storage_path: storagePath,
    account_number: importedAccountNumber || parsed?.accountNumber || null,
    opening_balance: parsed?.openingBalance ?? null,
    closing_balance: parsed?.closingBalance ?? null,
    currency: parsed?.currency || 'PLN',
    transactions_count: transactions.length,
    import_format: fileType,
    parser_version: isMt940 ? 4 : Number(parsed?.parserVersion || 2),
    validation_status: 'pending',
    validation_message: null,
    uploaded_by: ctx.employee.authUserId,
    processed: false,
  }).select().single();
  if (statementError) {
    // Usuwamy tylko świeżo przesłany obiekt, nigdy istniejący plik źródłowy.
    await ctx.supabase.storage.from(STATEMENTS_BUCKET).remove([storagePath]);
    if (statementError.code === '23505') {
      fail('Baza zablokowała zapis. Odśwież listę, aby sprawdzić, czy ten sam plik nie został już dodany. Jeżeli zapisany jest tylko drugi format (PDF/MT940), potrzebna jest aktualizacja ograniczenia w bazie. Nie usuwaj drugiego formatu ani wyciągu innego rachunku — dotychczasowe pliki pozostały bez zmian.');
    }
    fail(statementError.message || 'Nie udało się zapisać wyciągu.');
  }

  // Operacje po kolei, jak w CRM (wyzwalacze bazy widzą wcześniejsze operacje tego wyciągu).
  for (const transaction of transactions) {
    const { error: insertError } = await ctx.supabase.from('bank_transactions').insert({
      statement_id: statement.id,
      transaction_date: transaction.transactionDate,
      posting_date: transaction.postingDate ?? null,
      amount: transaction.amount,
      currency: transaction.currency || 'PLN',
      transaction_type: transaction.type,
      counterparty_name: repairBrokenBankText(transaction.counterpartyName) || null,
      counterparty_account: transaction.counterpartyAccount ?? null,
      title: repairBrokenBankText(transaction.title) || null,
      reference_number: transaction.referenceNumber ?? null,
      raw_description: repairBrokenBankText(transaction.rawDescription) || null,
      raw_counterparty: repairBrokenBankText(transaction.rawCounterparty) || null,
      source_index: transaction.sourceIndex ?? null,
      source_balance_before: transaction.balanceBefore ?? null,
      source_balance_after: transaction.balanceAfter ?? null,
      source_verified: transaction.sourceVerified === true,
    });
    if (insertError) fail(`Wyciąg zapisano tylko częściowo (${insertError.message}). Usuń ten plik na liście wyciągów i wgraj go ponownie.`);
  }

  const { error: finalizeError } = await ctx.supabase.from('bank_statements').update({
    processed: true, processed_at: new Date().toISOString(), validation_status: 'valid', validation_message: null,
  }).eq('id', statement.id);
  if (finalizeError) fail(`Nie udało się zakończyć importu: ${finalizeError.message}`);

  let vatPairingWarning = '';
  try {
    const pairing = await linkDetectedVatTransfersForPeriod(ctx.supabase, { companyId, month, year });
    vatPairingWarning = pairing.warnings?.join(' ') || '';
  } catch (error) {
    console.warn('[native-finance-bank] Wyciąg zapisano, ale nie udało się powiązać transferów między kontami VAT.', error);
    vatPairingWarning = 'Automatyczne powiązanie transferów VAT wymaga ponowienia w analizie miesiąca.';
  }
  await markAnalysesStale(ctx, companyId);

  let reconciliationMessage: string;
  const { data: reconciliation, error: reconciliationError } = await ctx.supabase.rpc('reconcile_bank_month', {
    p_company_id: companyId, p_year: year, p_month: month,
  });
  if (reconciliationError) {
    console.warn('[native-finance-bank] Wyciąg zapisano, ale uzgodnienie nie powiodło się.', reconciliationError.message);
    reconciliationMessage = 'Uzgodnienie uruchom ręcznie w „Uzgodnieniu wyciągów”.';
  } else {
    reconciliationMessage = `Uzgodnienie: ${reconciliationRunSentence(object(reconciliation))}`;
  }
  return {
    ok: true,
    tone: vatPairingWarning || reconciliationError ? 'warning' : 'success',
    message: `${fileType} dla ${accountLabel} został dodany. Transakcji: ${transactions.length}. ${vatPairingWarning ? `${vatPairingWarning} ` : ''}${reconciliationMessage}`,
  };
}

// MARK: Pliki do podglądu i pobrania (wyciąg, plik deklaracji, dokument wyjaśnienia, dokument rozliczenia)

/** Rodzaj pliku po zawartości (jak `fileMime` w podglądzie CRM): PDF, PNG, JPEG, WEBP; inne — do pobrania. */
function sniffMime(bytes: ArrayBuffer): string {
  const head = new Uint8Array(bytes.slice(0, 1024));
  const text = new TextDecoder('ascii').decode(head);
  if (/^%PDF-\d\.\d/.test(text)) return 'application/pdf';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => head[index] === value)) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (text.slice(0, 4) === 'RIFF' && text.slice(8, 12) === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}

const asFile = (name: string, mime: string, bytes: ArrayBuffer) => ({
  kind: 'file' as const, name, mime, data: Buffer.from(bytes).toString('base64'),
});

async function download(ctx: NativeContext, bucket: string, path: string) {
  const { data, error } = await ctx.supabase.storage.from(bucket).download(path);
  if (error || !data) fail('Nie udało się pobrać pliku.', 404);
  return { bytes: await data.arrayBuffer(), mime: data.type || 'application/octet-stream' };
}

export async function fileContent(ctx: NativeContext, kind: unknown, idParam: unknown) {
  switch (str(kind)) {
    case 'statement': {
      const { row, companyId } = await statementRow(ctx, idParam);
      await companyAccess(ctx, companyId);
      if (!row.file_storage_path) fail('Oryginalny plik wyciągu nie jest zapisany w magazynie.', 404);
      const file = await download(ctx, STATEMENTS_BUCKET, String(row.file_storage_path));
      const mime = bankStatementImportFormat(row as any) === 'MT940' ? 'text/plain' : 'application/pdf';
      return asFile(str(row.file_name) || 'wyciag', mime, file.bytes);
    }
    case 'declaration': {
      const id = uuid(idParam, 'Nieprawidłowy plik.');
      const { data, error } = await ctx.supabase.from('finance_declaration_files')
        .select('id,declaration_id,storage_path,file_name,mime_type').eq('id', id).maybeSingle();
      if (error || !data) fail('Nie znaleziono pliku deklaracji.', 404);
      await companyAccess(ctx, await declarationCompany(ctx, String(data.declaration_id)));
      const file = await download(ctx, DECLARATIONS_BUCKET, String(data.storage_path));
      return asFile(str(data.file_name) || 'deklaracja', str(data.mime_type) || file.mime, file.bytes);
    }
    case 'contract': {
      const id = uuid(idParam, 'Nieprawidłowy plik.');
      const { data, error } = await ctx.supabase.from('finance_recurring_contract_files')
        .select('id,contract_id,storage_path,file_name,mime_type').eq('id', id).maybeSingle();
      if (error || !data) fail('Nie znaleziono pliku umowy.', 404);
      await companyAccess(ctx, await contractCompany(ctx, String(data.contract_id)));
      const file = await download(ctx, CONTRACTS_BUCKET, String(data.storage_path));
      return asFile(str(data.file_name) || 'umowa', str(data.mime_type) || file.mime, file.bytes);
    }
    case 'supporting': {
      const id = uuid(idParam, 'Nieprawidłowy dokument.');
      const { data, error } = await ctx.supabase.from('bank_transaction_supporting_documents')
        .select('id,bank_transaction_id,storage_path,original_file_name,mime_type').eq('id', id).maybeSingle();
      if (error || !data?.storage_path) fail('Nie znaleziono dokumentu.', 404);
      const { companyId } = await transactionCompany(ctx, String(data.bank_transaction_id));
      await companyAccess(ctx, companyId);
      const file = await download(ctx, 'bank-supporting-documents', String(data.storage_path));
      return asFile(str(data.original_file_name) || 'dokument', str(data.mime_type) || file.mime, file.bytes);
    }
    default:
      fail('Nieznany rodzaj pliku.');
  }
}

/**
 * Podgląd dokumentu rozliczenia (jak `useDocumentPreview` w CRM): faktura CRM — wydruk PDF z danych faktury (dostęp jak
 * do faktury, RLS), dokument spoza KSeF — wgrany plik, faktura KSeF — dane z zapisanego XML (strony, kwoty, pozycje).
 */
// MARK: Wszystkie dokumenty (Mac: Finanse → „Wszystkie dokumenty”; CRM: Dokumenty i rozliczenia → „Wszystkie dokumenty”)

/*
 * Jeden rejestr faktur i dokumentów kosztowych działalności za zakres dat: faktury z KSeF (wystawione i otrzymane), faktury
 * CRM (bez tych, które są już w KSeF pod tym samym numerem — jak w CRM) i dokumenty spoza KSeF (faktury zagraniczne,
 * paragony, polisy, noty…). Każda pozycja ma źródło, stronę (koszt / sprzedaż) i jeden stan zapłaty, więc na Macu da się je
 * filtrować w jednym miejscu. Odczyt klientem z tokenem pracownika (RLS) po sprawdzeniu „Podglądu finansów” działalności.
 */
const REGISTER_LIMIT = 2000;
const REGISTER_DAY = /^\d{4}-\d{2}-\d{2}$/;

function registerRange(fromParam: unknown, toParam: unknown) {
  const today = warsawToday();
  const to = REGISTER_DAY.test(str(toParam)) ? str(toParam) : today;
  let from = str(fromParam);
  if (!REGISTER_DAY.test(from)) {
    const start = new Date(`${to}T12:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() - 2, 1);
    from = start.toISOString().slice(0, 10);
  }
  if (from > to) fail('Data „od” jest późniejsza niż „do”.');
  const span = (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) / 86_400_000;
  if (span > 731) fail('Wybierz zakres najwyżej dwóch lat.');
  return { from, to, today };
}

export async function documentRegister(ctx: NativeContext, companyParam: unknown, fromParam: unknown, toParam: unknown) {
  const companyId = uuid(companyParam, 'Nieprawidłowa działalność.');
  const { canManage } = await companyAccess(ctx, companyId);
  const { from, to, today } = registerRange(fromParam, toParam);

  const [ksef, local, external] = await Promise.all([
    ctx.supabase.from('ksef_invoices')
      .select('id,invoice_number,ksef_reference_number,invoice_type,issue_date,ksef_issued_at,payment_due_date,payment_status,seller_name,seller_nip,buyer_name,buyer_nip,gross_amount,amount_to_pay_gross,currency')
      .eq('my_company_id', companyId).eq('sync_status', 'synced')
      .not('ksef_reference_number', 'is', null).neq('ksef_reference_number', '')
      .gte('issue_date', from).lte('issue_date', to)
      .order('issue_date', { ascending: false }).limit(REGISTER_LIMIT),
    ctx.supabase.from('invoices')
      .select('id,invoice_number,invoice_type,status,issue_date,payment_due_date,payment_status,buyer_name,buyer_nip,total_gross,ksef_status')
      .eq('my_company_id', companyId)
      .gte('issue_date', from).lte('issue_date', to)
      .order('issue_date', { ascending: false }).limit(REGISTER_LIMIT),
    ctx.supabase.from('external_invoices')
      .select('id,document_kind,invoice_number,label,invoice_date,seller_name,seller_nip,amount_gross,currency,payment_status,file_url')
      .eq('my_company_id', companyId)
      .gte('invoice_date', from).lte('invoice_date', to)
      .order('invoice_date', { ascending: false }).limit(REGISTER_LIMIT),
  ]);
  for (const result of [ksef, local, external]) {
    if (result.error) rpcFail(result.error, 'Nie udało się pobrać dokumentów.');
  }
  const ksefRows = rows(ksef.data);
  const localRows = rows(local.data);
  const externalRows = rows(external.data);
  // Faktura CRM przyjęta w KSeF jest już na liście jako faktura KSeF (ten sam numer) — bez dublowania, jak w CRM.
  const issuedInKsef = new Set(ksefRows.filter((row) => str(row.invoice_type).toLowerCase() === 'issued')
    .map((row) => str(row.invoice_number).trim()).filter(Boolean));

  const documents = [
    ...ksefRows.map((row) => {
      const received = str(row.invoice_type).toLowerCase() === 'received';
      const dueDate = day(row.payment_due_date);
      const state = registerState(row.payment_status, dueDate, today);
      return {
        source: 'ksef',
        id: str(row.id),
        number: str(row.invoice_number) || str(row.ksef_reference_number),
        reference: strOrNull(row.ksef_reference_number),
        kindLabel: received ? 'Faktura zakupowa' : 'Faktura sprzedażowa',
        side: received ? 'cost' : 'sales',
        counterparty: bankTextOrNull(received ? row.seller_name : row.buyer_name),
        nip: strOrNull(received ? row.seller_nip : row.buyer_nip),
        issueDate: day(row.issue_date) || day(row.ksef_issued_at),
        dueDate,
        gross: num(row.amount_to_pay_gross ?? row.gross_amount),
        currency: str(row.currency) || 'PLN',
        state,
        stateLabel: REGISTER_STATE_LABELS[state],
        previewable: true,
        href: '/crm/invoices?tab=ksef',
      };
    }),
    ...localRows
      .filter((row) => !(str(row.ksef_status) === 'accepted' && issuedInKsef.has(str(row.invoice_number).trim())))
      .map((row) => {
        const dueDate = day(row.payment_due_date);
        const state = registerState(row.payment_status, dueDate, today, row.status);
        const proforma = str(row.invoice_type).toLowerCase() === 'proforma';
        return {
          source: 'invoice',
          id: str(row.id),
          number: str(row.invoice_number) || (proforma ? 'Proforma bez numeru' : 'Faktura bez numeru'),
          reference: null as string | null,
          kindLabel: proforma ? 'Proforma' : 'Faktura sprzedażowa',
          side: 'sales',
          counterparty: strOrNull(row.buyer_name),
          nip: strOrNull(row.buyer_nip),
          issueDate: day(row.issue_date),
          dueDate,
          gross: num(row.total_gross),
          currency: 'PLN',
          state,
          stateLabel: REGISTER_STATE_LABELS[state],
          previewable: true,
          href: `/crm/invoices/${str(row.id)}`,
        };
      }),
    ...externalRows.map((row) => {
      const state = registerState(row.payment_status, null, today);
      return {
        source: 'external',
        id: str(row.id),
        number: str(row.invoice_number) || 'bez numeru',
        reference: strOrNull(row.label),
        kindLabel: externalDocumentKindLabel(row.document_kind),
        side: 'cost',
        counterparty: strOrNull(row.seller_name),
        nip: strOrNull(row.seller_nip),
        issueDate: day(row.invoice_date),
        dueDate: null as string | null,
        gross: num(row.amount_gross),
        currency: str(row.currency) || 'PLN',
        state,
        stateLabel: REGISTER_STATE_LABELS[state],
        previewable: Boolean(strOrNull(row.file_url)),
        href: '/crm/invoices?tab=external&section=external',
      };
    }),
  ].sort((left, right) => (right.issueDate || '').localeCompare(left.issueDate || '') || left.number.localeCompare(right.number, 'pl'));

  return {
    companyId,
    from,
    to,
    today,
    canManage,
    truncated: [ksefRows, localRows, externalRows].some((list) => list.length >= REGISTER_LIMIT),
    documents,
  };
}

export async function documentPreview(ctx: NativeContext, sourceParam: unknown, idParam: unknown) {
  const id = uuid(idParam, 'Nieprawidłowy dokument.');
  const source = str(sourceParam);
  if (source === 'invoice') {
    const { data: visible, error: visibleError } = await ctx.supabase.from('invoices').select('id').eq('id', id).maybeSingle();
    if (visibleError || !visible) fail('Nie znaleziono faktury albo nie masz do niej dostępu.', 404);
    const admin = createSupabaseAdminClient();
    const { data: invoice, error } = await admin.from('invoices').select(INVOICE_PRINT_SELECT).eq('id', id).maybeSingle();
    if (error || !invoice) fail('Nie znaleziono faktury.', 404);
    const document = await buildInvoicePrintDocument(admin, invoice as any);
    const { pdf } = await renderInvoicePdf(document);
    const name = invoicePdfFileName((invoice as Row).invoice_number, isProformaInvoiceRow(invoice as any));
    return { kind: 'file' as const, name, mime: 'application/pdf', data: Buffer.from(pdf).toString('base64') };
  }
  if (source === 'external') {
    const { data, error } = await ctx.supabase.from('external_invoices').select('invoice_number,file_url').eq('id', id).maybeSingle();
    if (error || !data) fail('Nie udało się odczytać dokumentu.', 404);
    if (!data.file_url) fail('Do tego dokumentu nie wgrano pliku.');
    const raw = String(data.file_url);
    let path = raw;
    // Starsze wpisy mają pełny adres magazynu — tylko adres tego projektu i zasobnika dokumentów spoza KSeF.
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
      if (url.origin !== origin || !url.pathname.startsWith('/storage/v1/object/')) fail('Plik nie znajduje się w autoryzowanym magazynie CRM.');
      const parts = url.pathname.slice('/storage/v1/object/'.length).split('/');
      if (['public', 'sign', 'authenticated'].includes(parts[0])) parts.shift();
      if (parts.shift() !== 'external-invoices') fail('Nieprawidłowy magazyn pliku źródłowego.');
      path = decodeURIComponent(parts.join('/'));
    }
    const file = await download(ctx, 'external-invoices', path);
    if (!file.bytes.byteLength) fail('Nie można odczytać zapisanego pliku źródłowego.');
    const mime = sniffMime(file.bytes);
    const extension = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '';
    return asFile(`${str(data.invoice_number) || 'dokument'}${extension}`, mime, file.bytes);
  }
  if (source === 'ksef') {
    const { data, error } = await ctx.supabase.from('ksef_invoices')
      .select('id,invoice_number,ksef_reference_number,invoice_type,issue_date,payment_due_date,payment_status,payment_method,bank_account_number,seller_name,seller_nip,seller_address,buyer_name,buyer_nip,buyer_address,net_amount,vat_amount,gross_amount,amount_to_pay_gross,currency,invoice_items')
      .eq('id', id).maybeSingle();
    if (error || !data) fail('Nie znaleziono faktury KSeF albo nie masz do niej dostępu.', 404);
    const items = rows(data.invoice_items).map((item) => ({
      name: str(item.name),
      quantity: numOrNull(item.quantity),
      unit: strOrNull(item.unit),
      unitPrice: numOrNull(item.price_net),
      net: numOrNull(item.value_net),
      gross: numOrNull(item.value_gross),
      vatRate: strOrNull(item.vat_rate),
    }));
    return {
      kind: 'ksef' as const,
      invoice: {
        id: str(data.id),
        number: strOrNull(data.invoice_number),
        ksefNumber: strOrNull(data.ksef_reference_number),
        side: str(data.invoice_type) === 'issued' ? 'issued' : 'received',
        issueDate: day(data.issue_date),
        dueDate: day(data.payment_due_date),
        paymentStatus: strOrNull(data.payment_status),
        paymentMethod: strOrNull(data.payment_method),
        bankAccount: strOrNull(data.bank_account_number),
        seller: { name: strOrNull(data.seller_name), nip: strOrNull(data.seller_nip), address: strOrNull(data.seller_address) },
        buyer: { name: strOrNull(data.buyer_name), nip: strOrNull(data.buyer_nip), address: strOrNull(data.buyer_address) },
        net: numOrNull(data.net_amount),
        vat: numOrNull(data.vat_amount),
        gross: numOrNull(data.gross_amount),
        toPay: numOrNull(data.amount_to_pay_gross),
        currency: str(data.currency) || 'PLN',
        items,
      },
    };
  }
  fail('Ten dokument nie ma podglądu.');
}
