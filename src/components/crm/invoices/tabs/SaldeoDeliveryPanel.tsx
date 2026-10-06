'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, Eye, FileText, Loader2, Pencil, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { dispatchCrmEmail } from '@/lib/emailScheduling';
import { loadUnifiedEmailAccounts, type UnifiedEmailAccount } from '@/components/crm/UnifiedEmailComposer';
import { decodeTextEntities } from '@/lib/textEncoding';
import { BANK_STATEMENT_DEDUPLICATION_COLUMNS, deduplicateStatementTransactions, type BankStatementDeduplicationMetadata } from '@/lib/bankStatementDeduplication';
import { externalDocumentKindLabel } from '@/lib/invoices/externalDocumentKinds';
import { annotateSaldeoDocument } from '@/lib/saldeoDocumentAnnotation';
import { hasKsefRegistration, saldeoDocumentExclusionReason } from '@/lib/saldeoDeliveryEligibility';
import { buildSaldeoDeliveryBundle } from '@/lib/saldeoDeliveryBundle';
import { buildSaldeoControlReport, buildSaldeoCollectivePaymentCsv, buildSaldeoCollectivePaymentHtml, saldeoCollectivePayments, type SaldeoControlReportInput, type SaldeoControlReportFollowup, type SaldeoControlReportPayment } from '@/lib/saldeoControlReport';
import SaldeoDocumentDetailsModal, { type SaldeoDocumentDetails } from './SaldeoDocumentDetailsModal';

type Row = Record<string, any>;
type Source = 'external_invoice' | 'local_invoice' | 'bank_supporting_document' | 'ksef' | 'personnel' | 'bank_transaction';
type SaldeoType = 'FK' | 'DS' | 'P';
type Company = { id: string; name: string; is_default: boolean | null; saldeo_document_email: string | null; accountant_email: string | null };
export type Statement = BankStatementDeduplicationMetadata & { id: string; file_name: string; file_storage_path: string | null; processed: boolean; validation_status: string };
export type Bank = Row & {
  id: string; statement_id: string; amount: number; allocated_amount: number; transaction_date: string; currency: string;
  source_index?: number | null;
  source_balance_before?: number | string | null;
  source_balance_after?: number | string | null;
  source_verified?: boolean | null;
};
export type Allocation = { id: string; transactionId: string; documentKey: string; amount: number; documentAmount: number | null; currency: string; description: string };
type DocumentFollowup = {
  id: string; my_company_id: string; bank_transaction_id: string; period_month: number; period_year: number;
  active: boolean; acknowledged_by: string; acknowledged_at: string; transaction_snapshot: Row; created_at: string; updated_at: string;
};
export type Document = {
  key: string; source: Source; id: string; number: string; kind: string; date: string; dueDate: string;
  direction?: 'income' | 'expense' | 'unknown'; documentKind?: string;
  counterparty: string; amount: number | null; currency: string; note: string; ksefReference: string;
  bucket: string | null; path: string | null; filename: string; saldeoType: SaldeoType;
  sentAt: string | null; linkedBankId?: string; paymentStatus?: string; paymentMethod?: string;
  statementOnly?: boolean;
  noteValue?: string | null; relatedNotes?: { label: string; note: string; source?: Source; id?: string }[];
  previewFile?: { bucket: string; path: string; filename: string };
};
export type Snapshot = {
  statements: Statement[]; transactions: Bank[]; allBanks: Map<string, Bank>; statementNames: Map<string, string>;
  documents: Document[]; allocations: Allocation[]; errors: string[]; describedMissing: Bank[]; unresolved: Bank[];
  excludedInvoiceCount: number; hiddenTransactionCount: number; latestHandoff: Row | null;
  followups: DocumentFollowup[]; internalWarnings: string[];
};
type Attachment = { filename: string; content: string; contentType: string; contentDisposition: 'attachment'; size: number; document?: Document };
type Claim = { id: string; key: string };
type EditOrigin = { source: Source; id: string; original: string };
type SaldeoAccess = { state: 'checking' | 'ready' | 'missing' | 'error'; message: string };
type SourceCheck = { bucket: string; path: string; filename: string; digest: string };
type ControlReview = {
  fingerprint: string; revision: string; createdAt: string; html: string; filename: string; blockers: string[];
  prepared: Attachment[]; accountantAttachments: Attachment[]; sourceChecks: SourceCheck[];
  batches: { type: SaldeoType; items: Attachment[] }[]; reportHash: string;
};

const MONTHS = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec', 'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const deliveryPeriodKey = (companyId: string) => `crm:saldeo:period:${companyId}`;
const validDeliveryPeriod = (month: unknown, year: unknown) => typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12
  && typeof year === 'number' && Number.isInteger(year) && year >= 2000 && year <= 2100;
const LABELS: Record<string, string> = {
  automatic_vat_transfer: 'Automatyczny transfer pomiędzy rachunkami bieżącym i VAT', vat7_payment: 'VAT-7 / JPK_V7',
  pit4_payment: 'PIT-4R', zus_payment: 'ZUS', payroll_payment: 'Wynagrodzenie / lista płac', bank_fee: 'Opłata bankowa',
  own_transfer: 'Przelew własny', cash_settlement: 'Rozliczenie gotówkowe', supplier_invoice_missing: 'Opisany brak dokumentu od dostawcy', other: 'Inne wyjaśnienie',
};
const SOURCE_LABELS: Record<Source, string> = { external_invoice: 'Spoza KSeF', local_invoice: 'CRM', bank_supporting_document: 'Dokument do przelewu', ksef: 'KSeF', personnel: 'Kadry', bank_transaction: 'Wyciąg bankowy — analiza CRM' };
const inputClass = 'mt-1.5 w-full rounded-lg border border-white/10 bg-[#0a0d1a] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/40 disabled:opacity-50';
const panelClass = 'rounded-xl border border-white/[0.07] bg-[#1c1f33] p-5';
const bankFields = 'id,statement_id,transaction_date,posting_date,amount,currency,transaction_type,counterparty_name,counterparty_account,title,raw_description,reference_number,match_status,allocated_amount,matched_document_count,matched_invoice_id,accounting_review_status,accounting_category,accounting_subtype,accounting_note,private_transfer_detected,paired_bank_transaction_id,source_index,source_balance_before,source_balance_after,source_verified';
const ledgerFields = 'id,bank_transaction_id,document_source,invoice_id,ksef_invoice_id,external_invoice_id,amount,document_amount,document_currency,currency';
const statementFields = `${BANK_STATEMENT_DEDUPLICATION_COLUMNS},file_storage_path,processed,validation_status`;
const noteTarget = (source: Source) => ({
  table: source === 'bank_transaction' ? 'bank_transactions' : source === 'ksef' ? 'ksef_invoices' : source === 'local_invoice' ? 'invoices' : source === 'external_invoice' ? 'external_invoices' : source === 'personnel' ? 'personnel_contract_payments' : 'bank_transaction_supporting_documents',
  field: source === 'personnel' || source === 'bank_supporting_document' ? 'notes' : 'accounting_note',
});
const combinedDocumentNote = (note: string | null | undefined, related: Document['relatedNotes']) => [note || '', ...(related || []).filter((item) => item.note && item.note !== note).map((item) => `${item.label}: ${item.note}`)].filter(Boolean).join('\n');
const remaining = (bank: Bank) => Math.max(0, Math.abs(Number(bank.amount)) - Number(bank.allocated_amount || 0));
const money = (value: number, currency = 'PLN') => `${Number(value).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const safeFilename = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dokument';
const extension = (value: string) => value.split('?')[0].split('/').pop()?.split('.').pop()?.toLowerCase() || 'pdf';
const html = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const csv = (rows: unknown[][]) => '\uFEFF' + rows.map((row) => row.map((value) => {
  const raw = String(value ?? '');
  return `"${(/^[=+\-@]/.test(raw) ? `'${raw}` : raw).replace(/"/g, '""')}"`;
}).join(';')).join('\n');

async function getSaldeoConfiguration(accessToken: string, companyId: string): Promise<boolean> {
  const response = await fetch(`/bridge/integrations/saldeo?companyId=${encodeURIComponent(companyId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: 'no-store',
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success !== true) throw new Error(result.error || 'Nie można potwierdzić uprawnień administratora do wysyłki Saldeo.');
  return result.configured === true;
}
const saldeoConfigurationState = (configured: boolean): SaldeoAccess => configured
  ? { state: 'ready', message: 'Administrator zweryfikowany. PIN jest skonfigurowany na serwerze i zostanie dodany automatycznie podczas wysyłki.' }
  : { state: 'missing', message: 'Brak poprawnego PIN_SALDEO na serwerze. Uzupełnij konfigurację i uruchom serwer ponownie; nie wpisuj PIN-u w przeglądarce.' };

async function pages<T = Row>(makeQuery: () => any): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await makeQuery().order('id').range(from, from + 199);
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < 200) return result;
  }
}
async function byIds<T = Row>(table: string, fields: string, column: string, ids: string[]): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const result: T[] = [];
  for (let start = 0; start < unique.length; start += 100) result.push(...await pages<T>(() => supabase.from(table).select(fields).in(column, unique.slice(start, start + 100))));
  return result;
}
function uniqueRows(rows: Row[]): Row[] { return [...new Map(rows.map((row) => [row.id, row])).values()]; }
export function isStatementOnlyPayment(bank: Bank | undefined) {
  if (!bank) return false;
  // Use saved classification, never "VAT" in a vendor's payment title.
  // A changed category takes precedence over an older, uncleared subtype.
  const category = String(bank.accounting_category || '').trim();
  if (category === 'tax_or_zus') return true;
  if (bank.accounting_subtype === 'automatic_vat_transfer') return !category || category === 'own_transfer';
  return !category && ['vat7_payment', 'pit4_payment', 'zus_payment'].includes(bank.accounting_subtype);
}
const reviewDocuments = (snapshot: Snapshot) => snapshot.documents.filter((document) => !document.statementOnly
  && ['external_invoice', 'local_invoice'].includes(document.source) && !document.ksefReference && document.bucket);
function status(bank: Bank) {
  if (bank.private_transfer_detected) return 'Prywatna';
  if (isStatementOnlyPayment(bank)) return `${LABELS[bank.accounting_subtype] || 'Podatek / ZUS'} — tylko wyciąg, bez osobnego dokumentu do Saldeo`;
  if (bank.accounting_subtype === 'supplier_invoice_missing' && bank.accounting_note?.trim()) return 'Brak dokumentu — opisany, do decyzji księgowej';
  if (bank.accounting_review_status === 'explained') return LABELS[bank.accounting_subtype] || 'Wyjaśniona';
  return remaining(bank) <= 0.01 ? 'Dopasowana' : Number(bank.allocated_amount) > 0 ? 'Częściowo dopasowana' : 'Niewyjaśniona';
}

function bankHasDocumentLink(snapshot: Snapshot, bank: Bank) {
  return snapshot.allocations.some((allocation) => allocation.transactionId === bank.id)
    || Boolean(bank.matched_invoice_id) || Number(bank.matched_document_count || 0) > 0 || Number(bank.allocated_amount || 0) > 0.01;
}
const followupSnapshotFields = ['statement_id', 'amount', 'currency', 'transaction_type', 'transaction_date', 'posting_date', 'allocated_amount', 'matched_document_count', 'matched_invoice_id', 'counterparty_name', 'title', 'raw_description', 'reference_number', 'accounting_note', 'accounting_category', 'accounting_subtype', 'accounting_review_status', 'private_transfer_detected'] as const;
const followupSnapshot = (bank: Row) => Object.fromEntries(followupSnapshotFields.map((field) => [field, bank[field] ?? null]));
function canAcknowledgeMissingDocument(snapshot: Snapshot, bank: Bank) {
  return bank.transaction_type === 'debit' && !bank.private_transfer_detected && !isStatementOnlyPayment(bank)
    && remaining(bank) > 0.01 && !bankHasDocumentLink(snapshot, bank);
}
function hasMissingDocumentAcknowledgment(snapshot: Snapshot, bank: Bank) {
  if (!canAcknowledgeMissingDocument(snapshot, bank)) return false;
  return snapshot.followups.some((item) => item.active && item.bank_transaction_id === bank.id
    && stableJson(followupSnapshot(item.transaction_snapshot)) === stableJson(followupSnapshot(bank)));
}
function deliveryBlockers(snapshot: Snapshot) {
  // Internal reconciliation is work for the CRM, not a prerequisite for sending
  // other complete invoices. File and delivery-integrity errors remain blocking.
  return snapshot.errors;
}
function documentFollowupRows(snapshot: Snapshot): (SaldeoControlReportFollowup & { id: string; bankId: string })[] {
  return snapshot.followups.filter((item) => item.active).map((item) => {
    const bank = snapshot.allBanks.get(item.bank_transaction_id);
    const source = bank || item.transaction_snapshot;
    const linked = bank ? bankHasDocumentLink(snapshot, bank) : false;
    const linkedNumbers = bank ? paymentDocuments(snapshot, bank.id).map((document) => document.number).join(', ') : '';
    const followupStatus = !bank ? 'Pozycja wyciągu zmieniła się — sprawdź w analizie'
      : linked ? `Powiązano dokument${linkedNumbers ? `: ${linkedNumbers}` : ''} — sprawdź dosłanie; samo dopasowanie nie potwierdza wysyłki`
      : isStatementOnlyPayment(bank) || bank.private_transfer_detected ? 'Zmieniono klasyfikację — sprawdź, czy dokument jest nadal wymagany'
      : hasMissingDocumentAcknowledgment(snapshot, bank) ? 'Oczekuje na dokument — świadoma zgoda na przekazanie pozostałych dokumentów'
      : 'Dane płatności zmieniły się — potwierdź brak ponownie przed wysyłką';
    return { id: item.id, bankId: item.bank_transaction_id, reference: source.reference_number || '', date: source.transaction_date || '',
      amount: Math.abs(Number(source.amount || 0)), currency: source.currency || 'PLN', counterparty: source.counterparty_name || '',
      note: source.accounting_note || '', acknowledgedAt: item.acknowledged_at, status: followupStatus };
  });
}
function documentHasPaymentLink(snapshot: Snapshot, source: Document) {
  if (source.source === 'bank_transaction') { const bank = snapshot.allBanks.get(source.id); return !bank || bankHasDocumentLink(snapshot, bank); }
  if (snapshot.allocations.some((allocation) => allocation.documentKey === source.key)) return true;
  if (source.source === 'ksef' && [...snapshot.allBanks.values()].some((bank) => bank.matched_invoice_id === source.id)) return true;
  if (source.linkedBankId) { const bank = snapshot.allBanks.get(source.linkedBankId); return !bank || bankHasDocumentLink(snapshot, bank); }
  return false;
}
function reviewNote(snapshot: Snapshot, source: Document) {
  if (documentHasPaymentLink(snapshot, source)) return '';
  if (source.source === 'bank_supporting_document' && source.linkedBankId) return String(snapshot.allBanks.get(source.linkedBankId)?.accounting_note || '');
  return source.note;
}
function existingNoteOrigin(snapshot: Snapshot, source: Document): EditOrigin | null {
  if (source.statementOnly || documentHasPaymentLink(snapshot, source)) return null;
  if (source.source === 'bank_supporting_document' && source.linkedBankId) {
    const original = String(snapshot.allBanks.get(source.linkedBankId)?.accounting_note || '');
    return original.trim() ? { source: 'bank_transaction', id: source.linkedBankId, original } : null;
  }
  if (source.noteValue?.trim()) return { source: source.source, id: source.id, original: source.noteValue };
  const linked = source.relatedNotes?.find((item) => item.source && item.id && item.note.trim());
  return linked ? { source: linked.source!, id: linked.id!, original: linked.note } : null;
}
export function paymentDocuments(snapshot: Snapshot, bankId: string) {
  const grouped = new Map<string, { key: string; number: string; counterparty: string; allocatedAmount: number; documentAmount: number | null; currency: string }>();
  for (const allocation of snapshot.allocations.filter((item) => item.transactionId === bankId)) {
    const source = snapshot.documents.find((item) => item.key === allocation.documentKey);
    if (!source || !['ksef', 'local_invoice', 'external_invoice'].includes(source.source)) continue;
    const key = source.key; const previous = grouped.get(key);
    grouped.set(key, { key, number: source.number, counterparty: source.counterparty, currency: allocation.currency,
      allocatedAmount: (previous?.allocatedAmount || 0) + allocation.amount,
      documentAmount: allocation.documentAmount == null || (previous && previous.documentAmount == null) ? null : (previous?.documentAmount || 0) + allocation.documentAmount });
  }
  const bank = snapshot.allBanks.get(bankId);
  if (!grouped.size && bank?.matched_invoice_id) {
    const source = snapshot.documents.find((item) => item.source === 'ksef' && item.id === bank.matched_invoice_id);
    if (source) return [{ key: source.key, number: source.number, counterparty: source.counterparty, allocatedAmount: null, documentAmount: null, currency: source.currency }];
  }
  return [...grouped.values()];
}
function collectivePaymentDetails(snapshot: Snapshot): SaldeoControlReportPayment[] {
  return saldeoCollectivePayments(snapshot.transactions.map((bank) => {
    const invoiceKeys = new Set(snapshot.allocations.filter((item) => item.transactionId === bank.id)
      .map((item) => snapshot.documents.find((document) => document.key === item.documentKey))
      .filter((document): document is Document => Boolean(document && ['ksef', 'local_invoice', 'external_invoice'].includes(document.source)))
      .map((document) => document.key));
    const linkedDocuments = paymentDocuments(snapshot, bank.id).filter((document) => invoiceKeys.has(document.key));
    return { id: bank.id, date: bank.transaction_date, postingDate: bank.posting_date || '', reference: bank.reference_number || '',
      counterparty: bank.counterparty_name || '', title: bank.title || bank.raw_description || '', bankAmount: Math.abs(Number(bank.amount)), bankCurrency: bank.currency,
      allocatedAmount: Number(bank.allocated_amount || 0), documentAmount: null, documentCurrency: bank.currency,
      note: '', collective: linkedDocuments.length > 1, linkedDocuments, statementName: snapshot.statementNames.get(bank.statement_id) || '' };
  }));
}
function paymentGroupText(snapshot: Snapshot, bank: Bank) {
  const documents = paymentDocuments(snapshot, bank.id);
  if (!documents.length) return '';
  return `${documents.length > 1 ? 'Jedna płatność za kilka dokumentów' : 'Powiązany dokument'}; numer płatności z wyciągu: ${bank.reference_number || 'nie zapisano'}. ${documents.map((item) => `${item.number} — ${item.counterparty}; przypisano ${item.allocatedAmount == null ? 'brak kwoty alokacji' : money(item.allocatedAmount, bank.currency)}`).join(' | ')}`;
}
function paymentItem(snapshot: Snapshot, bank: Bank): Document {
  const statement = snapshot.statements.find((item) => item.id === bank.statement_id);
  return { key: `bank_transaction:${bank.id}`, id: bank.id, source: 'bank_transaction', number: bank.reference_number || `Przelew ${bank.transaction_date}`,
    kind: LABELS[bank.accounting_subtype] || 'Płatność bez powiązanego dokumentu', date: bank.transaction_date, dueDate: '', counterparty: bank.counterparty_name || '',
    amount: Math.abs(Number(bank.amount)), currency: bank.currency, note: bank.accounting_note || '', noteValue: bank.accounting_note ?? null, ksefReference: '',
    bucket: null, path: null, filename: '', saldeoType: 'P', sentAt: null, linkedBankId: bank.id, statementOnly: isStatementOnlyPayment(bank),
    previewFile: statement?.file_storage_path ? { bucket: 'bank-statements', path: statement.file_storage_path, filename: statement.file_name } : undefined };
}

export async function loadSnapshot(companyId: string, month: number, year: number): Promise<Snapshot> {
  if (!validDeliveryPeriod(month, year)) throw new Error('Wybierz poprawny miesiąc i rok przekazania dokumentów.');
  const periodLabel = `${String(month).padStart(2, '0')}/${year}`;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const periodRows = (table: string, dateField: string) => pages(() => supabase.from(table).select('*').eq('my_company_id', companyId).gte(dateField, start).lt(dateField, end));
  const [statements, periodExternal, periodCrm, periodKsef, handoffs, followups] = await Promise.all([
    pages<Statement>(() => supabase.from('bank_statements').select(statementFields).eq('my_company_id', companyId).eq('statement_month', month).eq('statement_year', year)),
    periodRows('external_invoices', 'invoice_date'), periodRows('invoices', 'issue_date'), periodRows('ksef_invoices', 'issue_date'),
    pages(() => supabase.from('accounting_month_handoffs').select('id,delivered_at,delivered_to,snapshot').eq('my_company_id', companyId).eq('period_month', month).eq('period_year', year)),
    pages<DocumentFollowup>(() => supabase.from('accounting_document_followups').select('id,my_company_id,bank_transaction_id,period_month,period_year,active,acknowledged_by,acknowledged_at,transaction_snapshot,created_at,updated_at').eq('my_company_id', companyId).eq('period_month', month).eq('period_year', year).eq('active', true)),
  ]);
  const errors: string[] = []; const internalWarnings: string[] = [];
  if (!statements.length) internalWarnings.push(`Brak wyciągu bankowego dla ${periodLabel}. Dokumenty można przekazać osobno; wyciąg pozostaje do uzupełnienia.`);
  const invalidStatements = statements.filter((statement) => !statement.processed || statement.validation_status !== 'valid');
  if (invalidStatements.length) internalWarnings.push(`Dla ${periodLabel} ${invalidStatements.length} wyciągów nie zakończyło poprawnie odczytu. Oryginały pozostają dostępne, ale zestawienie płatności zbiorczych może być niepełne.`);
  const missingStatements = statements.filter((statement) => !statement.file_storage_path);
  if (missingStatements.length) errors.push(`${missingStatements.length} wyciągów nie ma pliku źródłowego.`);
  const rawBanks = await byIds<Bank>('bank_transactions', bankFields, 'statement_id', statements.map((statement) => statement.id));
  const transactions = deduplicateStatementTransactions(rawBanks, new Map(statements.map((statement) => [statement.id, statement]))).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.id.localeCompare(b.id));
  if (statements.length && !transactions.length) internalWarnings.push(`Wyciągi dla ${periodLabel} nie zawierają odczytanych transakcji. Sprawdź odczyt przed uznaniem analizy miesiąca za zakończoną.`);
  const monthBankIds = transactions.map((bank) => bank.id);
  const [monthMatches, supporting, personnel] = await Promise.all([
    byIds('bank_transaction_invoice_matches', ledgerFields, 'bank_transaction_id', monthBankIds),
    byIds('bank_transaction_supporting_documents', '*', 'bank_transaction_id', monthBankIds),
    byIds('personnel_contract_payments', 'id,amount,currency,payment_type,payment_date,recipient_name,title,notes,bank_transaction_id,personnel_contracts!personnel_contract_payments_personnel_contract_id_fkey(contract_number,party_name,my_company_id)', 'bank_transaction_id', monthBankIds),
  ]);
  const [linkedExternal, linkedCrm, linkedKsef] = await Promise.all([
    byIds('external_invoices', '*', 'id', monthMatches.map((match) => match.external_invoice_id)),
    byIds('invoices', '*', 'id', monthMatches.map((match) => match.invoice_id)),
    byIds('ksef_invoices', '*', 'id', [...monthMatches.map((match) => match.ksef_invoice_id), ...transactions.map((bank) => bank.matched_invoice_id)]),
  ]);
  let crmRows = uniqueRows([...periodCrm, ...linkedCrm]);
  let ksefRows = uniqueRows([...periodKsef, ...linkedKsef]);
  const externalRows = uniqueRows([...periodExternal, ...linkedExternal]);
  // Only persisted KSeF identifiers establish identity; amounts and invoice numbers do not.
  // Reading optional external fields from select('*') also works before those columns exist.
  const explicitId = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const externalKsefReferences = (row: Row) => [...new Set([
    explicitId(row.ksef_reference_number), explicitId(row.ksef_number),
  ].filter(Boolean))];
  const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const [externalKsefAliasesById, externalKsefAliasesByReference] = await Promise.all([
    byIds('ksef_invoices', '*', 'id', externalRows.map((invoice) => explicitId(invoice.ksef_invoice_id)).filter(isUuid)),
    byIds('ksef_invoices', '*', 'ksef_reference_number', externalRows.flatMap(externalKsefReferences)),
  ]);
  // Load the official document even when its issue date is outside this month, then
  // let the existing CRM alias lookup collect its linked CRM copy and allocations too.
  ksefRows = uniqueRows([...ksefRows, ...externalKsefAliasesById, ...externalKsefAliasesByReference]);
  const [crmAliases, ksefAliasesById, ksefAliasesByReference] = await Promise.all([
    byIds('invoices', '*', 'id', ksefRows.map((invoice) => invoice.invoice_id)),
    byIds('ksef_invoices', '*', 'invoice_id', crmRows.map((invoice) => invoice.id)),
    byIds('ksef_invoices', '*', 'ksef_reference_number', crmRows.map((invoice) => invoice.ksef_reference_number)),
  ]);
  crmRows = uniqueRows([...crmRows, ...crmAliases]);
  ksefRows = uniqueRows([...ksefRows, ...ksefAliasesById, ...ksefAliasesByReference]);
  if ([...externalRows, ...crmRows, ...ksefRows].some((row) => row.my_company_id !== companyId)) throw new Error('Powiązany dokument nie ma potwierdzonej działalności. Uzupełnij firmę przed przekazaniem.');
  const canonical = new Map<string, string>();
  const ksefByInvoice = new Map(ksefRows.filter((row) => row.invoice_id).map((row) => [row.invoice_id, row]));
  const ksefByReference = new Map(ksefRows.filter((row) => row.ksef_reference_number).map((row) => [row.ksef_reference_number, row]));
  const ksefById = new Map(ksefRows.map((row) => [String(row.id).toLowerCase(), row]));
  const ksefReferenceCandidates = new Map<string, Row[]>();
  for (const row of ksefRows) {
    const reference = explicitId(row.ksef_reference_number);
    if (reference) ksefReferenceCandidates.set(reference, [...(ksefReferenceCandidates.get(reference) || []), row]);
  }
  const documents: Document[] = [];
  for (const row of ksefRows) {
    const key = `ksef:${row.id}`; canonical.set(key, key);
    documents.push({ key, source: 'ksef', id: row.id, number: row.invoice_number || 'Bez numeru', kind: row.invoice_type === 'issued' ? 'Sprzedaż KSeF' : 'Zakup KSeF', date: row.issue_date || '', dueDate: row.payment_due_date || '', counterparty: decodeTextEntities(row.invoice_type === 'issued' ? row.buyer_name : row.seller_name), amount: row.gross_amount == null ? null : Number(row.gross_amount), currency: row.currency || 'PLN', note: row.accounting_note || '', ksefReference: row.ksef_reference_number || '', bucket: null, path: null, filename: '', saldeoType: 'FK', sentAt: null });
    documents[documents.length - 1].noteValue = row.accounting_note ?? null;
    documents[documents.length - 1].paymentStatus = row.payment_status;
    documents[documents.length - 1].paymentMethod = row.payment_method;
    documents[documents.length - 1].direction = row.invoice_type === 'issued' ? 'income' : row.invoice_type === 'received' ? 'expense' : 'unknown';
  }
  let excludedInvoiceCount = 0;
  for (const row of crmRows) {
    if (['draft', 'cancelled'].includes(String(row.status || '').toLowerCase()) || String(row.invoice_type).toLowerCase() === 'proforma') { ++excludedInvoiceCount; continue; }
    const alias = ksefByInvoice.get(row.id) || (row.ksef_reference_number ? ksefByReference.get(row.ksef_reference_number) : null);
    if (alias) {
      canonical.set(`local_invoice:${row.id}`, `ksef:${alias.id}`);
      const document = documents.find((item) => item.key === `ksef:${alias.id}`)!;
      if (row.accounting_note) {
        document.relatedNotes = [...(document.relatedNotes || []), { label: `Opis połączonego dokumentu CRM ${row.invoice_number || ''}`.trim(), note: row.accounting_note, source: 'local_invoice', id: row.id }];
        document.note = combinedDocumentNote(document.noteValue, document.relatedNotes);
      }
      if (!document.previewFile && row.pdf_url) document.previewFile = { bucket: 'event-files', path: row.pdf_url, filename: `kopia-CRM-${safeFilename(row.invoice_number || 'faktura')}.pdf` };
      continue;
    }
    const key = `local_invoice:${row.id}`; canonical.set(key, key);
    const hasKsef = Boolean(row.ksef_reference_number?.trim()) || String(row.ksef_status).toLowerCase() === 'accepted';
    documents.push({ key, source: 'local_invoice', id: row.id, number: row.invoice_number || 'Bez numeru', kind: 'Dokument sprzedaży', date: row.issue_date || '', dueDate: row.payment_due_date || '', counterparty: decodeTextEntities(row.buyer_name), amount: row.total_gross == null ? null : Number(row.total_gross), currency: row.currency_code || 'PLN', note: row.accounting_note || '', ksefReference: row.ksef_reference_number || (hasKsef ? 'Przyjęta przez KSeF — numer wymaga uzupełnienia w CRM' : ''), bucket: hasKsef ? null : 'event-files', path: hasKsef ? null : row.pdf_url || null, filename: `${safeFilename(row.invoice_number || 'sprzedaz')}.pdf`, saldeoType: 'DS', sentAt: null });
    documents[documents.length - 1].noteValue = row.accounting_note ?? null;
    documents[documents.length - 1].paymentStatus = row.payment_status || row.status;
    documents[documents.length - 1].paymentMethod = row.payment_method;
    // The CRM invoice register contains documents issued by my_company_id;
    // invoice_type describes their form (VAT, advance, corrective), not direction.
    documents[documents.length - 1].direction = 'income';
    documents[documents.length - 1].documentKind = row.invoice_type || undefined;
    if (row.pdf_url) documents[documents.length - 1].previewFile = { bucket: 'event-files', path: row.pdf_url, filename: `${safeFilename(row.invoice_number || 'sprzedaz')}.pdf` };
  }
  for (const row of externalRows) {
    if (saldeoDocumentExclusionReason('external_invoice', row) && !hasKsefRegistration(row)) { ++excludedInvoiceCount; continue; }
    const linkedKsefId = explicitId(row.ksef_invoice_id);
    const linkedKsefReferences = externalKsefReferences(row);
    if (linkedKsefId || linkedKsefReferences.length) {
      const candidates = new Map<string, Row>();
      let unresolvedIdentity = false;
      if (linkedKsefId) {
        const candidate = isUuid(linkedKsefId) ? ksefById.get(linkedKsefId.toLowerCase()) : undefined;
        if (candidate) candidates.set(candidate.id, candidate);
        else unresolvedIdentity = true;
      }
      for (const reference of linkedKsefReferences) {
        const matching = ksefReferenceCandidates.get(reference) || [];
        if (matching.length === 1) candidates.set(matching[0].id, matching[0]);
        else unresolvedIdentity = true;
      }
      if (!unresolvedIdentity && candidates.size === 1) {
        const alias = [...candidates.values()][0];
        // The shared company check above applies equally to aliases fetched here.
        canonical.set(`external_invoice:${row.id}`, `ksef:${alias.id}`);
        const document = documents.find((item) => item.key === `ksef:${alias.id}`)!;
        if (row.accounting_note) {
          document.relatedNotes = [...(document.relatedNotes || []), {
            label: `Opis połączonego dokumentu spoza KSeF ${row.invoice_number || row.label || ''}`.trim(),
            note: row.accounting_note, source: 'external_invoice', id: row.id,
          }];
        }
        if (row.notes && row.notes !== row.accounting_note) {
          // General notes are read-only here: existingNoteOrigin edits accounting_note,
          // so do not identify this separate notes field as an editable accounting note.
          document.relatedNotes = [...(document.relatedNotes || []), {
            label: `Notatka dokumentu spoza KSeF ${row.invoice_number || row.label || ''}`.trim(), note: row.notes,
          }];
        }
        document.note = combinedDocumentNote(document.noteValue, document.relatedNotes);
        if (!String(document.paymentMethod || '').trim() && row.payment_method) document.paymentMethod = row.payment_method;
        if (!String(document.paymentStatus || '').trim() && row.payment_status) document.paymentStatus = row.payment_status;
        if (!document.dueDate) document.dueDate = row.payment_due_date || row.due_date || '';
        if (!document.previewFile && row.file_url) document.previewFile = {
          bucket: 'external-invoices', path: row.file_url,
          filename: `kopia-spoza-KSeF-${safeFilename(row.invoice_number || row.label || 'dokument')}.${extension(row.file_url)}`,
        };
        continue;
      }
      internalWarnings.push(`Tożsamość dokumentu: nie można jednoznacznie potwierdzić wszystkich wskazań KSeF dokumentu ${row.invoice_number || row.label || 'bez numeru'}. Pozostawiono go osobno; sprawdź zapisane powiązanie.`);
    }
    const key = `external_invoice:${row.id}`; canonical.set(key, key);
    documents.push({ key, source: 'external_invoice', id: row.id, number: row.invoice_number || row.label || 'Bez numeru', kind: externalDocumentKindLabel(row.document_kind), date: row.invoice_date || '', dueDate: row.payment_due_date || row.due_date || '', counterparty: decodeTextEntities(row.seller_name), amount: row.amount_gross == null ? null : Number(row.amount_gross), currency: row.currency || 'PLN', note: row.accounting_note || '', ksefReference: '', bucket: 'external-invoices', path: row.file_url || null, filename: `${safeFilename(row.invoice_number || row.label || 'dokument')}.${extension(row.file_url || 'dokument.pdf')}`, saldeoType: ['insurance_policy', 'contract', 'debit_note', 'other'].includes(row.document_kind) ? 'P' : 'FK', sentAt: null });
    documents[documents.length - 1].noteValue = row.accounting_note ?? null;
    documents[documents.length - 1].paymentStatus = row.payment_status;
    documents[documents.length - 1].paymentMethod = row.payment_method;
    // External documents are the company's purchase/cost register.
    documents[documents.length - 1].direction = 'expense';
    documents[documents.length - 1].documentKind = row.document_kind || undefined;
    const externalKsefReference = row.ksef_reference_number || row.ksef_number || row.ksef_invoice_id;
    if (hasKsefRegistration(row)) {
      documents[documents.length - 1].ksefReference = externalKsefReference || 'Przyjęta przez KSeF';
      documents[documents.length - 1].bucket = null;
      if (row.file_url) documents[documents.length - 1].previewFile = { bucket: 'external-invoices', path: row.file_url, filename: documents[documents.length - 1].filename };
    }
  }
  for (const row of supporting) {
    const key = `bank_supporting_document:${row.id}`;
    documents.push({ key, source: 'bank_supporting_document', id: row.id, number: row.title || row.original_file_name || 'Dokument do przelewu', kind: 'Dokument źródłowy do przelewu', date: '', dueDate: '', counterparty: '', amount: null, currency: 'PLN', note: row.notes || '', noteValue: row.notes ?? null, ksefReference: '', bucket: 'bank-supporting-documents', path: row.storage_path || null, filename: safeFilename(row.original_file_name || 'dokument.pdf'), saldeoType: 'P', sentAt: null, linkedBankId: row.bank_transaction_id });
    documents[documents.length - 1].statementOnly = ['vat7_declaration', 'pit4_declaration', 'zus_declaration'].includes(row.document_type)
      || isStatementOnlyPayment(transactions.find((bank) => bank.id === row.bank_transaction_id));
  }
  for (const row of personnel) {
    const contract = Array.isArray(row.personnel_contracts) ? row.personnel_contracts[0] : row.personnel_contracts;
    if (contract?.my_company_id !== companyId) throw new Error('Nie można potwierdzić działalności powiązanej płatności kadrowej.');
    const key = `personnel:${row.id}`; canonical.set(key, key);
    const paymentTypeLabels: Record<string, string> = { salary: 'Wynagrodzenie — kwota do przelewu', advance: 'Zaliczka', tax: 'Podatek', zus: 'ZUS', reimbursement: 'Zwrot kosztów', other: 'Inna płatność kadrowa' };
    documents.push({ key, source: 'personnel', id: row.id, number: contract?.contract_number || row.title || 'Dokument kadrowy', kind: paymentTypeLabels[row.payment_type] || 'Płatność kadrowa', date: row.payment_date || '', dueDate: row.payment_date || '', counterparty: row.recipient_name || contract?.party_name || '', amount: Number(row.amount), currency: row.currency || 'PLN', note: row.notes || '', ksefReference: '', bucket: null, path: null, filename: '', saldeoType: 'P', sentAt: null });
    documents[documents.length - 1].noteValue = row.notes ?? null;
    documents[documents.length - 1].statementOnly = ['tax', 'zus'].includes(row.payment_type);
  }
  const extraMatchGroups = await Promise.all([
    byIds('bank_transaction_invoice_matches', ledgerFields, 'invoice_id', crmRows.map((row) => row.id)),
    byIds('bank_transaction_invoice_matches', ledgerFields, 'ksef_invoice_id', ksefRows.map((row) => row.id)),
    byIds('bank_transaction_invoice_matches', ledgerFields, 'external_invoice_id', externalRows.map((row) => row.id)),
  ]);
  const allMatches = uniqueRows([...monthMatches, ...extraMatchGroups.flat()]);
  const extraBanks = await byIds<Bank>('bank_transactions', bankFields, 'id', allMatches.map((match) => match.bank_transaction_id).filter((id) => !monthBankIds.includes(id)));
  const allBanks = new Map([...transactions, ...extraBanks].map((bank) => [bank.id, bank]));
  const extraStatements = await byIds<Statement>('bank_statements', statementFields, 'id', extraBanks.map((bank) => bank.statement_id).filter((id) => !statements.some((statement) => statement.id === id)));
  if (extraStatements.some((statement) => statement.my_company_id !== companyId)) throw new Error('Powiązanie dokumentu wskazuje płatność innej działalności.');
  const statementNames = new Map([...statements, ...extraStatements].map((statement) => [statement.id, statement.file_name]));
  if ([...allBanks.values()].some((bank) => !statementNames.has(bank.statement_id))) throw new Error('Nie można odczytać wyciągu powiązanej płatności.');
  const allocations: Allocation[] = [];
  for (const match of allMatches) {
    const sourceKey = match.document_source === 'invoice' ? `local_invoice:${match.invoice_id}` : match.document_source === 'ksef' ? `ksef:${match.ksef_invoice_id}` : `external_invoice:${match.external_invoice_id}`;
    const documentKey = canonical.get(sourceKey);
    if (!documentKey || !allBanks.has(match.bank_transaction_id)) { internalWarnings.push('Powiązanie wskazuje niedostępny, anulowany albo roboczy dokument lub niedostępną płatność.'); continue; }
    const document = documents.find((item) => item.key === documentKey)!;
    const bank = allBanks.get(match.bank_transaction_id)!;
    const bankAmount = Number(match.amount);
    const documentAmount = match.document_amount == null ? (document.currency === bank.currency ? bankAmount : null) : Number(match.document_amount);
    if (!Number.isFinite(bankAmount) || bankAmount <= 0 || (documentAmount != null && (!Number.isFinite(documentAmount) || documentAmount <= 0))) internalWarnings.push(`Nieprawidłowa kwota przypisana do dokumentu ${document.number}.`);
    if (documentAmount == null) internalWarnings.push(`Brak zapisanej kwoty w walucie dokumentu ${document.number} — uzupełnij rozliczenie walutowe.`);
    allocations.push({ id: match.id, transactionId: match.bank_transaction_id, documentKey, amount: bankAmount, documentAmount, currency: match.document_currency || document.currency, description: document.kind });
  }
  for (const payment of personnel) allocations.push({ id: `personnel:${payment.id}`, transactionId: payment.bank_transaction_id, documentKey: `personnel:${payment.id}`, amount: Number(payment.amount), documentAmount: Number(payment.amount), currency: payment.currency || 'PLN', description: documents.find((document) => document.key === `personnel:${payment.id}`)?.kind || 'Kadry' });
  const describedMissing = transactions.filter((bank) => !isStatementOnlyPayment(bank) && remaining(bank) > 0.01 && bank.accounting_subtype === 'supplier_invoice_missing' && bank.accounting_note?.trim());
  const describedIds = new Set(describedMissing.map((bank) => bank.id));
  const unresolved = transactions.filter((bank) => !isStatementOnlyPayment(bank) && !bank.private_transfer_detected && !describedIds.has(bank.id) && remaining(bank) > 0.01 && !(bank.accounting_review_status === 'explained' && bank.accounting_note?.trim()));
  // Missing documents are a separate, explicitly acknowledgeable condition.
  // Structural errors below can never be waived by this acknowledgment.
  for (const bank of transactions) {
    const total = allocations.filter((allocation) => allocation.transactionId === bank.id).reduce((sum, allocation) => sum + allocation.amount, 0);
    const invoiceRelations = allocations.filter((allocation) => allocation.transactionId === bank.id && !allocation.documentKey.startsWith('personnel:'));
    const collective = new Set(invoiceRelations.map((allocation) => allocation.documentKey)).size > 1;
    const issueTarget = collective ? errors : internalWarnings;
    if (!Number.isFinite(Number(bank.amount)) || Math.abs(total - Number(bank.allocated_amount || 0)) > 0.01 || Number(bank.allocated_amount || 0) - Math.abs(Number(bank.amount)) > 0.01) issueTarget.push(`Niespójne kwoty rozliczenia przelewu ${bank.reference_number || bank.transaction_date}.`);
    if (collective && invoiceRelations.some((allocation) => !Number.isFinite(allocation.amount) || allocation.amount <= 0 || allocation.documentAmount == null || !Number.isFinite(allocation.documentAmount))) errors.push(`Płatność zbiorcza ${bank.reference_number || bank.transaction_date} wymaga poprawnego podziału kwot przed wysłaniem opisu.`);
    if (!isStatementOnlyPayment(bank) && bank.match_status === 'matched' && total <= 0.01 && !bank.accounting_note?.trim() && !bank.private_transfer_detected) internalWarnings.push(`Przelew ${bank.reference_number || bank.id} ma status dopasowany, ale brak kwot w rejestrze powiązań.`);
  }
  const fileDocuments = documents.filter((document) => document.bucket && !document.statementOnly && !document.ksefReference && ['external_invoice', 'local_invoice'].includes(document.source));
  const deliveries = await byIds('saldeo_delivery_log', 'id,source_type,source_id,delivered_at,delivered_to', 'source_id', fileDocuments.map((document) => document.id));
  for (const document of fileDocuments) {
    document.sentAt = deliveries.filter((row) => row.source_type === document.source && row.source_id === document.id).sort((a, b) => String(b.delivered_at).localeCompare(String(a.delivered_at)))[0]?.delivered_at || null;
    if (!document.path && !document.sentAt) errors.push(`Brak pliku źródłowego: ${document.number}.`);
  }
  return { statements, transactions, allBanks, statementNames, documents, allocations, errors: [...new Set(errors)], internalWarnings: [...new Set(internalWarnings)], describedMissing, unresolved, followups, excludedInvoiceCount, hiddenTransactionCount: rawBanks.length - transactions.length, latestHandoff: handoffs.sort((a, b) => String(b.delivered_at).localeCompare(String(a.delivered_at)))[0] || null };
}

function reports(snapshot: Snapshot) {
  const documentByKey = new Map(snapshot.documents.map((document) => [document.key, document]));
  const monthIds = new Set(snapshot.transactions.map((bank) => bank.id));
  return {
    reconciliation: csv([
      ['Wyciąg', 'Data płatności', 'Data księgowania', 'Kierunek', 'Kwota przelewu', 'Waluta', 'Kontrahent', 'Tytuł', 'Numer referencyjny', 'Status', 'Przypisano', 'Pozostało', 'Dokumenty', 'Zapisany opis płatności'],
      ...snapshot.transactions.map((bank) => [snapshot.statementNames.get(bank.statement_id), bank.transaction_date, bank.posting_date, bank.transaction_type === 'credit' ? 'Wpływ' : 'Wydatek', Math.abs(Number(bank.amount)).toFixed(2), bank.currency, bank.counterparty_name, bank.title || bank.raw_description, bank.reference_number, status(bank), Number(bank.allocated_amount || 0).toFixed(2), isStatementOnlyPayment(bank) ? 'Nie dotyczy — dokument niewymagany' : remaining(bank).toFixed(2), snapshot.allocations.filter((allocation) => allocation.transactionId === bank.id).map((allocation) => `${documentByKey.get(allocation.documentKey)?.number}: ${money(allocation.amount, bank.currency)}`).join(' | ') || (isStatementOnlyPayment(bank) ? 'Tylko wyciąg / rejestr — bez osobnego dokumentu do Saldeo' : ''), bank.accounting_note]),
    ]),
    mapping: csv([
      ['Wyciąg', 'Data płatności', 'Data księgowania', 'Numer płatności z wyciągu', 'Cała płatność', 'Waluta banku', 'Źródło dokumentu', 'Dokument', 'Numer KSeF', 'Kontrahent dokumentu', 'Data dokumentu', 'Termin', 'Przypisano z przelewu', 'Przypisano w walucie dokumentu', 'Waluta dokumentu', 'Wartość całego dokumentu', 'Zbiorcza płatność', 'Opis niepowiązanego dokumentu', 'Opis przelewu', 'Dokumenty rozliczone tym samym przelewem'],
      ...snapshot.allocations.filter((allocation) => monthIds.has(allocation.transactionId) && !documentByKey.get(allocation.documentKey)?.statementOnly).map((allocation) => {
        const bank = snapshot.allBanks.get(allocation.transactionId)!; const document = documentByKey.get(allocation.documentKey)!;
        return [snapshot.statementNames.get(bank.statement_id), bank.transaction_date, bank.posting_date, bank.reference_number, Math.abs(Number(bank.amount)).toFixed(2), bank.currency, SOURCE_LABELS[document.source], document.number, document.ksefReference, document.counterparty, document.date, document.dueDate, allocation.amount.toFixed(2), allocation.documentAmount?.toFixed(2), allocation.currency, document.amount?.toFixed(2), paymentDocuments(snapshot, bank.id).length > 1 || Number(bank.matched_document_count) > 1 ? 'Tak — jedna płatność za kilka dokumentów' : 'Nie', reviewNote(snapshot, document), bank.accounting_note, paymentGroupText(snapshot, bank)];
      }),
    ]),
    documents: csv([
      ['Źródło', 'Rodzaj', 'Numer', 'Numer KSeF', 'Kontrahent', 'Data', 'Termin', 'Wartość', 'Waluta', 'Opis dokumentu', 'Płatności — również spoza miesiąca', 'Plik do Saldeo'],
      ...reviewDocuments(snapshot).map((document) => [SOURCE_LABELS[document.source], document.kind, document.number, document.ksefReference, document.counterparty, document.date, document.dueDate, document.amount?.toFixed(2), document.currency, reviewNote(snapshot, document),
        snapshot.allocations.filter((allocation) => allocation.documentKey === document.key).map((allocation) => { const bank = snapshot.allBanks.get(allocation.transactionId)!; return `${bank.transaction_date}; nr ${bank.reference_number || 'brak numeru'}; przypisano ${money(allocation.amount, bank.currency)}${allocation.currency !== bank.currency ? ` = ${money(allocation.documentAmount || 0, allocation.currency)}` : ''}; ${bank.accounting_note || ''}`; }).join(' | '),
        document.bucket ? (document.sentAt ? 'Wysłano e-mailem wcześniej; odbiór w Saldeo niepotwierdzony' : document.path ? 'Przygotowany do wysłania z opisem CRM' : 'Brak pliku') : document.source === 'personnel' ? 'Informacja w raporcie; plik źródłowy jako dokument do przelewu' : 'KSeF — bez ponownej wysyłki pliku']),
    ]),
    followups: csv([
      ['Nr płatności z wyciągu', 'Data wydatku', 'Kwota', 'Waluta', 'Kontrahent', 'Opis z analizy', 'Potwierdzono brak', 'Status dokumentu do dosłania'],
      ...documentFollowupRows(snapshot).map((item) => [item.reference, item.date, item.amount.toFixed(2), item.currency, item.counterparty, item.note, item.acknowledgedAt, item.status]),
    ]),
  };
}

async function base64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}
async function sha256(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function blobDigest(blob: Blob) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function attachmentDigest(file: Attachment) {
  const bytes = Uint8Array.from(atob(file.content), (character) => character.charCodeAt(0));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function stableJson(value: any): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}
async function controlFingerprint(snapshot: Snapshot, settings: Record<string, string | number>) {
  const sorted = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  return sha256(stableJson({ version: 6, settings, documents: [...snapshot.documents].sort((a, b) => a.key.localeCompare(b.key)),
    statements: sorted(snapshot.statements), transactions: sorted(snapshot.transactions), allBanks: sorted([...snapshot.allBanks.values()]),
    statementNames: [...snapshot.statementNames.entries()].sort(([a], [b]) => a.localeCompare(b)), allocations: sorted(snapshot.allocations),
    errors: deliveryBlockers(snapshot).sort(), internalWarnings: snapshot.internalWarnings, describedMissing: sorted(snapshot.describedMissing), unresolved: sorted(snapshot.unresolved), followups: sorted(snapshot.followups),
    excludedInvoiceCount: snapshot.excludedInvoiceCount, hiddenTransactionCount: snapshot.hiddenTransactionCount }));
}
function downloadControlHtml(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function downloadBlob(bucket: string, path: string, label: string) {
  let storagePath = path;
  if (/^https?:\/\//.test(path)) {
    const url = new URL(path); const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.local');
    if (url.origin !== configured.origin || !url.pathname.startsWith('/storage/v1/object/')) throw new Error(`Plik „${label}” ma zewnętrzny adres. Zapisz jego oryginał w CRM przed wysyłką.`);
    const parts = url.pathname.slice('/storage/v1/object/'.length).split('/');
    if (['public', 'sign', 'authenticated'].includes(parts[0])) parts.shift();
    if (parts.shift() !== bucket) throw new Error(`Nieprawidłowy magazyn pliku „${label}”.`);
    storagePath = decodeURIComponent(parts.join('/'));
  }
  const { data, error } = await supabase.storage.from(bucket).download(storagePath);
  if (error || !data || !data.size) throw new Error(`Nie można odczytać pliku „${label}”. Przygotowanie przerwane przed wysyłką.`);
  return data;
}
async function attachment(blob: Blob, filename: string, document?: Document): Promise<Attachment> { return { filename, content: await base64(blob), contentType: blob.type || 'application/octet-stream', contentDisposition: 'attachment', size: blob.size, document }; }
function chunks(attachments: Attachment[], maxBytes: number, maxFiles: number) {
  const groups: Attachment[][] = []; let group: Attachment[] = []; let size = 0;
  for (const item of attachments) {
    if (item.size > maxBytes) throw new Error(`Plik „${item.filename}” przekracza bezpieczny rozmiar pojedynczej wiadomości (${Math.round(maxBytes / 1024 / 1024)} MB). Zmniejsz plik przed przekazaniem.`);
    if (group.length && (group.length >= maxFiles || size + item.size > maxBytes)) { groups.push(group); group = []; size = 0; }
    group.push(item); size += item.size;
  }
  if (group.length) groups.push(group); return groups;
}

export default function SaldeoDeliveryPanel({ filterCompanyIds = null, period, companyId: controlledCompanyId }: {
  filterCompanyIds?: string[] | null; period?: { month: number; year: number }; companyId?: string;
}) {
  const [companies, setCompanies] = useState<Company[]>([]); const [selectedCompanyId, setCompanyId] = useState('');
  const [selectedMonth, setMonth] = useState(new Date().getMonth() + 1); const [selectedYear, setYear] = useState(new Date().getFullYear());
  const companyId = controlledCompanyId ?? selectedCompanyId;
  const month = period?.month ?? selectedMonth; const year = period?.year ?? selectedYear;
  const filterCompanyKey = filterCompanyIds?.join(',') || '';
  const [periodCompanyId, setPeriodCompanyId] = useState('');
  const periodReady = Boolean(companyId) && companies.some((company) => company.id === companyId)
    && (Boolean(period) || periodCompanyId === companyId) && validDeliveryPeriod(month, year);
  const [accounts, setAccounts] = useState<UnifiedEmailAccount[]>([]); const [emailAccountId, setEmailAccountId] = useState('');
  const [saldeoEmail, setSaldeoEmail] = useState(''); const [accountantEmail, setAccountantEmail] = useState('');
  const [saldeoAccess, setSaldeoAccess] = useState<SaldeoAccess>({ state: 'checking', message: 'Sprawdzam uprawnienia administratora i konfigurację PIN-u…' });
  const [saldeoCheckKey, setSaldeoCheckKey] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null); const [loading, setLoading] = useState(false); const [sending, setSending] = useState(false);
  const [review, setReview] = useState<ControlReview | null>(null); const [reviewApproved, setReviewApproved] = useState(false);
  const [preparingReview, setPreparingReview] = useState(false);
  const [details, setDetails] = useState<Document | null>(null); const [noteDraft, setNoteDraft] = useState('');
  const [editOrigin, setEditOrigin] = useState<EditOrigin | null>(null);
  const [noteSaving, setNoteSaving] = useState(false); const [noteError, setNoteError] = useState(''); const [openingKey, setOpeningKey] = useState('');
  const [followupSaving, setFollowupSaving] = useState(''); const followupSavingRef = useRef(false);
  const [preview, setPreview] = useState<{ url: string; mimeType: string; filename: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false); const [previewError, setPreviewError] = useState('');
  const previewUrl = useRef<string | null>(null); const previewEpoch = useRef(0); const detailsEpoch = useRef(0); const noteSavingRef = useRef(false);
  const [progress, setProgress] = useState(''); const [error, setError] = useState(''); const [outcome, setOutcome] = useState('');
  const requestId = useRef(0); const sendingRef = useRef(false);
  const senderAddress = accounts.find((account) => account.id === emailAccountId)?.email_address || '';
  const noteDirty = Boolean(editOrigin && noteDraft.trim() !== editOrigin.original.trim());
  const clearPreview = () => {
    ++previewEpoch.current;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null; setPreview(null); setPreviewLoading(false); setPreviewError('');
  };
  useEffect(() => {
    ++detailsEpoch.current; setDetails(null); setEditOrigin(null); setOpeningKey(''); setNoteDraft(''); setNoteError(''); clearPreview();
  }, [companyId, month, year]);
  useEffect(() => () => { ++detailsEpoch.current; ++previewEpoch.current; if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  useEffect(() => { setReview(null); setReviewApproved(false); }, [companyId, month, year, emailAccountId, senderAddress, saldeoEmail, accountantEmail]);
  useEffect(() => {
    let active = true;
    void Promise.all([
      pages<Company>(() => { let query = supabase.from('my_companies').select('id,name,is_default,saldeo_document_email,accountant_email').eq('is_active', true); if (filterCompanyIds?.length) query = query.in('id', filterCompanyIds); return query; }), loadUnifiedEmailAccounts(),
    ]).then(([rows, emailAccounts]) => {
      if (!active) return; rows.sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
      setCompanies(rows); setAccounts(emailAccounts); setCompanyId((current) => rows.some((row) => row.id === current) ? current : rows[0]?.id || '');
      setEmailAccountId((current) => emailAccounts.some((account) => account.id === current) ? current : emailAccounts[0]?.id || '');
    }).catch((cause) => { if (active) setError(cause?.message || 'Nie można pobrać ustawień wysyłki.'); });
    return () => { active = false; };
  }, [filterCompanyKey]);
  useEffect(() => { const company = companies.find((row) => row.id === companyId); setSaldeoEmail(company?.saldeo_document_email || ''); setAccountantEmail(company?.accountant_email || ''); }, [companies, companyId]);
  useEffect(() => {
    if (!companyId) { setPeriodCompanyId(''); return; }
    if (period) { setPeriodCompanyId(companyId); return; }
    const now = new Date();
    let selected = { month: now.getMonth() + 1, year: now.getFullYear() };
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(deliveryPeriodKey(companyId)) || 'null');
      if (saved && validDeliveryPeriod(saved.month, saved.year)) selected = { month: saved.month, year: saved.year };
    } catch { /* Unavailable storage must not prevent selecting a period manually. */ }
    setMonth(selected.month); setYear(selected.year); setPeriodCompanyId(companyId);
  }, [companyId, period?.month, period?.year]);
  useEffect(() => {
    if (!periodReady || period) return;
    // Remember only the chosen period, never a control-file approval or a send decision.
    try { window.sessionStorage.setItem(deliveryPeriodKey(companyId), JSON.stringify({ month, year })); }
    catch { /* The current selection remains usable without browser storage. */ }
  }, [companyId, month, year, periodReady, period]);
  useEffect(() => {
    let active = true;
    setSaldeoAccess({ state: 'checking', message: 'Sprawdzam uprawnienia administratora i konfigurację PIN-u…' });
    if (!companyId) return () => { active = false; };
    void (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error('Zaloguj się ponownie, aby potwierdzić uprawnienia do Saldeo.');
        const configured = await getSaldeoConfiguration(accessToken, companyId);
        if (active) setSaldeoAccess(saldeoConfigurationState(configured));
      } catch (cause: any) {
        if (active) setSaldeoAccess({ state: 'error', message: cause?.message || 'Nie można sprawdzić konfiguracji Saldeo.' });
      }
    })();
    return () => { active = false; };
  }, [companyId, saldeoCheckKey]);
  const refresh = useCallback(async () => {
    const request = ++requestId.current; setError(''); setOutcome(''); setSnapshot(null); setReview(null); setReviewApproved(false);
    if (!companyId || !periodReady) { setLoading(Boolean(companyId) && periodCompanyId !== companyId); return; }
    setLoading(true);
    try { const fresh = await loadSnapshot(companyId, month, year); if (request === requestId.current) setSnapshot(fresh); }
    catch (cause: any) { if (request === requestId.current) setError(cause?.message || 'Nie można odczytać wszystkich danych miesiąca.'); }
    finally { if (request === requestId.current) setLoading(false); }
  }, [companyId, month, year, periodReady, periodCompanyId]);
  useEffect(() => { void refresh(); return () => { ++requestId.current; }; }, [refresh]);
  const fileDocuments = useMemo(() => snapshot ? reviewDocuments(snapshot).filter((document) => document.bucket) : [], [snapshot]);
  const pending = fileDocuments.filter((document) => !document.sentAt); const sent = fileDocuments.filter((document) => document.sentAt);
  const statementOnlyPayments = snapshot?.transactions.filter(isStatementOnlyPayment) || [];
  const unlinkedPayments = snapshot?.transactions.filter((bank) => !isStatementOnlyPayment(bank) && !bankHasDocumentLink(snapshot, bank)) || [];
  const blockingErrors = snapshot ? deliveryBlockers(snapshot) : [];
  const followupRows = snapshot ? documentFollowupRows(snapshot) : [];
  const collectivePayments = snapshot ? collectivePaymentDetails(snapshot) : [];
  const updateDocumentFollowup = async (bankId: string, acknowledged: boolean) => {
    if (!snapshot || sendingRef.current || noteSavingRef.current || followupSavingRef.current || details || openingKey) return;
    const bank = snapshot.allBanks.get(bankId);
    if (acknowledged && (!bank || !canAcknowledgeMissingDocument(snapshot, bank))) return;
    if (!acknowledged && !window.confirm('Usunąć tę pozycję z wewnętrznej listy „Do dosłania”? Nie zmieni to dopasowania ani statusu płatności.')) return;
    followupSavingRef.current = true; setFollowupSaving(bankId); setError(''); setOutcome('');
    setReview(null); setReviewApproved(false);
    try {
      const { error: saveError } = await supabase.rpc('acknowledge_accounting_document_followup', {
        p_bank_transaction_id: bankId, p_acknowledged: acknowledged,
        p_expected_snapshot: acknowledged && bank ? followupSnapshot(bank) : null,
      });
      if (saveError) throw saveError;
      const fresh = await loadSnapshot(companyId, month, year);
      setSnapshot(fresh);
      setOutcome(acknowledged
        ? 'Brak dokumentu zapisany na liście „Do dosłania”. Możesz przekazać pozostałe dokumenty po przygotowaniu nowego pliku kontrolnego. Wydatek nie został dopasowany ani rozliczony.'
        : 'Pozycja usunięta z listy „Do dosłania”. Stan płatności i jej opis nie zostały zmienione.');
    } catch (cause: any) { setError(cause?.message || 'Nie udało się zapisać potwierdzenia braku. Odśwież listę przed ponowieniem.'); }
    finally { followupSavingRef.current = false; setFollowupSaving(''); }
  };
  const downloadFollowups = () => {
    if (!snapshot) return;
    const url = URL.createObjectURL(new Blob([reports(snapshot).followups], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `dokumenty-do-doslania-${year}-${String(month).padStart(2, '0')}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const downloadReport = () => {
    if (!snapshot) return; const url = URL.createObjectURL(new Blob([reports(snapshot).reconciliation], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `uzgodnienie-${year}-${String(month).padStart(2, '0')}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const downloadBundle = async () => {
    if (!review || !reviewApproved || review.blockers.length || sendingRef.current) return;
    try {
      const files = [...review.prepared.map((file, index) => ({ filename: `saldeo/${String(index + 1).padStart(3, '0')}-${safeFilename(file.filename)}`, contentBase64: file.content })),
        ...review.accountantAttachments.map((file, index) => ({ filename: `ksiegowa/${String(index + 1).padStart(3, '0')}-${safeFilename(file.filename)}`, contentBase64: file.content }))];
      const instructions = `PACZKA ZA ${String(month).padStart(2, '0')}/${year}\nWersja kontroli: ${review.revision}\n\nFolder saldeo: wyłącznie nowe dokumenty spoza KSeF, wcześniej niewysłane z CRM.\nFolder ksiegowa: oryginalne wyciągi i wyłącznie opisy płatności zbiorczych.\n\nZIP służy do pobrania i ręcznego przekazania zawartości. Sam ZIP nie jest formatem importu rozrachunków Saldeo.\nPobranie nie wysyła niczego i nie oznacza dokumentów jako wysłane w CRM. Po ręcznym przekazaniu nie ponawiaj automatycznej wysyłki tych samych plików bez sprawdzenia historii i Saldeo.\nPlik kontrolny oraz wewnętrzne braki, kadry i listy uzgodnień nie są częścią tej paczki.\n\nPLIKI:\n${files.map((file) => file.filename).join('\n')}\n`;
      const blob = buildSaldeoDeliveryBundle([...files, { filename: 'PRZECZYTAJ.txt', contentBase64: await base64(new Blob([instructions], { type: 'text/plain;charset=utf-8' })) }]);
      const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url;
      link.download = `saldeo-${year}-${String(month).padStart(2, '0')}-${review.revision.slice(0, 8)}.zip`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setOutcome('Pobrano paczkę sprawdzonych plików. Niczego nie wysłano i nie zmieniono historii wysyłek. Jeśli przekażesz ją ręcznie, nie wysyłaj tych samych plików ponownie z CRM bez kontroli w Saldeo.');
    } catch (cause: any) { setError(cause?.message || 'Nie udało się przygotować paczki ZIP.'); }
  };

  const openDocumentDetails = async (source: Document) => {
    if (sendingRef.current || noteSavingRef.current) return;
    const request = ++detailsEpoch.current; setOpeningKey(source.key); setError(''); setNoteError(''); clearPreview();
    try {
      // Read the same analysis records and actual links; never initialize a new note here.
      const fresh = await loadSnapshot(companyId, month, year);
      const bank = source.source === 'bank_transaction' ? fresh.allBanks.get(source.id) : null;
      const current = bank ? paymentItem(fresh, bank) : fresh.documents.find((item) => item.key === source.key);
      if (!current) throw new Error('Pozycja nie jest już dostępna w tym miesiącu. Odśwież listę.');
      if (current.statementOnly) throw new Error('Ta operacja jest wykazywana wyłącznie na wyciągu i w rejestrze. Nie wymaga osobnego dokumentu ani edycji opisu w kontroli Saldeo. Odśwież listę.');
      const origin = existingNoteOrigin(fresh, current);
      const fingerprint = review ? await controlFingerprint(fresh, { companyId, companyName: companies.find((item) => item.id === companyId)?.name || 'Działalność', month, year, emailAccountId, sender: senderAddress, saldeoRecipient: saldeoEmail.trim(), accountantRecipient: accountantEmail.trim() }) : '';
      if (request !== detailsEpoch.current) return;
      if (review && fingerprint !== review.fingerprint) { setReview(null); setReviewApproved(false); }
      setSnapshot(fresh); setDetails(current); setEditOrigin(origin); setNoteDraft(origin?.original || '');
    } catch (cause: any) { if (request === detailsEpoch.current) setError(cause?.message || 'Nie można otworzyć szczegółów.'); }
    finally { if (request === detailsEpoch.current) setOpeningKey(''); }
  };
  const closeDocumentDetails = () => {
    if (noteSavingRef.current) return;
    if (noteDirty && !window.confirm('Opis ma niezapisane zmiany. Zamknąć okno i je porzucić?')) return;
    ++detailsEpoch.current; setDetails(null); setEditOrigin(null); setNoteDraft(''); setNoteError(''); clearPreview();
  };
  const saveDocumentNote = async () => {
    if (!details || !editOrigin || !snapshot || documentHasPaymentLink(snapshot, details) || noteSavingRef.current || sendingRef.current || !noteDirty) return;
    const source = details; const request = detailsEpoch.current; const note = noteDraft.trim();
    const target = editOrigin;
    if (!target.original.trim() || !note) { setNoteError('Tutaj można tylko poprawić istniejący opis. Nie można dodać nowego ani usunąć wyjaśnienia z analizy.'); return; }
    if (note.length > 20000) { setNoteError('Opis może mieć maksymalnie 20 000 znaków. Skróć go przed zapisem.'); return; }
    noteSavingRef.current = true; setNoteSaving(true); setNoteError('');
    try {
      const [manage, visible, personnel] = await Promise.all([
        supabase.rpc('finance_can_manage'), supabase.rpc('finance_company_visible', { p_company_id: companyId }),
        target.source === 'personnel' ? supabase.rpc('can_manage_personnel_contracts') : Promise.resolve({ data: true, error: null }),
      ]);
      if (manage.error || manage.data !== true || visible.error || visible.data !== true || personnel.error || personnel.data !== true) throw new Error('Brak uprawnień do edycji opisu tego dokumentu.');
      const fresh = await loadSnapshot(companyId, month, year);
      const freshBank = source.source === 'bank_transaction' ? fresh.allBanks.get(source.id) : null;
      const current = freshBank ? paymentItem(fresh, freshBank) : fresh.documents.find((item) => item.key === source.key);
      if (!current || current.statementOnly || documentHasPaymentLink(fresh, current)) throw new Error('Pozycja ma już powiązanie albo jest operacją wykazywaną tylko na wyciągu. W kontroli Saldeo nie można edytować jej opisu. Zamknij okno i odśwież szczegóły.');
      const currentOrigin = existingNoteOrigin(fresh, current);
      if (!currentOrigin || currentOrigin.id !== target.id || currentOrigin.source !== target.source || currentOrigin.original !== target.original) throw new Error('Opis z analizy zmienił się w międzyczasie. Skopiuj swoją treść i otwórz szczegóły ponownie — niczego nie nadpisano.');
      if (request !== detailsEpoch.current) return;
      // The editable original is separate from combined KSeF/CRM presentation notes.
      // Invalidate the reviewed package even if the network loses the write response.
      setReview(null); setReviewApproved(false);
      const { table, field } = noteTarget(target.source);
      let query = supabase.from(table).update({ [field]: note }).eq('id', target.id).eq(field, target.original);
      if (['ksef', 'local_invoice', 'external_invoice'].includes(target.source)) query = query.eq('my_company_id', companyId);
      if (target.source === 'bank_transaction') {
        const bank = fresh.allBanks.get(target.id)!;
        query = query.is('matched_invoice_id', null);
        query = bank.matched_document_count == null ? query.is('matched_document_count', null) : query.eq('matched_document_count', bank.matched_document_count);
        query = bank.allocated_amount == null ? query.is('allocated_amount', null) : query.eq('allocated_amount', bank.allocated_amount);
        query = bank.accounting_category == null ? query.is('accounting_category', null) : query.eq('accounting_category', bank.accounting_category);
        query = bank.accounting_subtype == null ? query.is('accounting_subtype', null) : query.eq('accounting_subtype', bank.accounting_subtype);
      }
      const { data, error: writeError } = await query.select('id');
      if (writeError) throw new Error('Nie udało się potwierdzić zapisu opisu. Twoja treść pozostaje w edytorze; sprawdź zapis przed ponowieniem.');
      if (data?.length !== 1) throw new Error('Opis zmienił się w międzyczasie lub utracono dostęp. Skopiuj swoją treść i otwórz dokument ponownie — niczego nie nadpisano.');
      if (request !== detailsEpoch.current) return;
      const updateBank = (bank: Bank) => target.source === 'bank_transaction' && bank.id === target.id ? { ...bank, accounting_note: note } : bank;
      const updatedSnapshot: Snapshot = { ...fresh, allBanks: new Map([...fresh.allBanks.entries()].map(([id, bank]) => [id, updateBank(bank)])),
        transactions: fresh.transactions.map(updateBank), describedMissing: fresh.describedMissing.map(updateBank), unresolved: fresh.unresolved.map(updateBank),
        documents: fresh.documents.map((item) => {
          const ownNote = item.source === target.source && item.id === target.id ? note : item.noteValue;
          const related = item.relatedNotes?.map((linked) => linked.source === target.source && linked.id === target.id ? { ...linked, note } : linked);
          return { ...item, noteValue: ownNote, relatedNotes: related, note: combinedDocumentNote(ownNote, related) };
        }) };
      const updated = source.source === 'bank_transaction' ? paymentItem(updatedSnapshot, updatedSnapshot.allBanks.get(source.id)!) : updatedSnapshot.documents.find((item) => item.key === source.key)!;
      setDetails(updated); setNoteDraft(note); setEditOrigin({ ...target, original: note }); setSnapshot(updatedSnapshot);
      setOutcome('Istniejący opis z analizy został poprawiony w CRM. Kwoty i powiązania pozostały bez zmian. Przed wysyłką do Saldeo przygotuj nowy plik kontrolny.');
    } catch (cause: any) { if (request === detailsEpoch.current) setNoteError(cause?.message || 'Nie udało się zapisać opisu.'); }
    finally { noteSavingRef.current = false; setNoteSaving(false); }
  };
  const openDocumentPreview = async () => {
    if (!details || previewLoading) return;
    clearPreview(); const request = previewEpoch.current;
    const file = details.previewFile || (details.bucket && details.path ? { bucket: details.bucket, path: details.path, filename: details.filename } : null);
    if (!file) {
      setPreviewError(details.source === 'ksef'
        ? 'W CRM nie zapisano kopii PDF tej faktury KSeF. Poniżej dostępne są jej dane i płatności; podgląd nie pobiera faktury ponownie ani nie zmienia jej statusu.'
        : 'Ten rekord nie ma dołączonego pliku do podglądu. Dane dokumentu i zapisane płatności są dostępne w tym oknie.');
      return;
    }
    setPreviewLoading(true);
    try {
      const original = await downloadBlob(file.bucket, file.path, file.filename);
      const prefix = new Uint8Array(await original.slice(0, 1024).arrayBuffer());
      const text = new TextDecoder().decode(prefix);
      const mimeType = text.includes('%PDF-') ? 'application/pdf'
        : prefix[0] === 137 && prefix[1] === 80 && prefix[2] === 78 && prefix[3] === 71 ? 'image/png'
        : prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 ? 'image/jpeg'
        : text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP' ? 'image/webp' : 'application/octet-stream';
      if (request !== previewEpoch.current) return;
      const url = URL.createObjectURL(new Blob([original], { type: mimeType })); previewUrl.current = url;
      setPreview({ url, mimeType, filename: file.filename });
    } catch (cause: any) { if (request === previewEpoch.current) setPreviewError(cause?.message || 'Nie można otworzyć pliku.'); }
    finally { if (request === previewEpoch.current) setPreviewLoading(false); }
  };
  const detailsModel: SaldeoDocumentDetails | null = details && snapshot ? (() => {
    const relations = snapshot.allocations.filter((allocation) => allocation.documentKey === details.key);
    const payment = (bank: Bank, allocation?: Allocation): SaldeoDocumentDetails['payments'][number] => ({
      id: allocation?.id || bank.id, date: bank.transaction_date, postingDate: bank.posting_date || '', reference: bank.reference_number || '',
      counterparty: bank.counterparty_name || '', title: bank.title || bank.raw_description || '', currency: bank.currency, documentCurrency: allocation?.currency || details.currency,
      statementName: snapshot.statementNames.get(bank.statement_id) || '', note: bank.accounting_note || '', direction: bank.transaction_type === 'credit' ? 'Wpływ' : 'Wydatek',
      amount: Math.abs(Number(bank.amount)), allocatedAmount: allocation?.amount ?? null, documentAmount: allocation?.documentAmount ?? null,
      collective: paymentDocuments(snapshot, bank.id).length > 1 || Number(bank.matched_document_count) > 1, linkedDocuments: paymentDocuments(snapshot, bank.id),
    });
    const payments = relations.flatMap((allocation) => { const bank = snapshot.allBanks.get(allocation.transactionId); return bank ? [payment(bank, allocation)] : []; });
    if (details.source === 'ksef') for (const bank of snapshot.allBanks.values()) {
      if (bank.matched_invoice_id === details.id && !relations.some((allocation) => allocation.transactionId === bank.id)) payments.push(payment(bank));
    }
    if (details.linkedBankId && !payments.length) { const bank = snapshot.allBanks.get(details.linkedBankId); if (bank) payments.push(payment(bank)); }
    const hasPaymentLink = documentHasPaymentLink(snapshot, details);
    return { key: details.key, number: details.number, kind: details.kind, sourceLabel: SOURCE_LABELS[details.source], date: details.date, dueDate: details.dueDate,
      entryType: details.source === 'bank_transaction' ? 'payment' : 'document', hasPaymentLink, canEditNote: !hasPaymentLink && Boolean(editOrigin?.original.trim()),
      counterparty: details.counterparty, amount: details.amount, currency: details.currency, ksefReference: details.ksefReference, note: reviewNote(snapshot, details), relatedNotes: hasPaymentLink ? [] : details.relatedNotes || [], payments,
      disposition: details.source === 'bank_transaction' ? 'Informacja wewnętrzna CRM — nie jest dokumentem do wysłania do Saldeo.'
        : details.sentAt ? 'Plik wysłano wcześniej — nie ponawiamy wysyłki. Poprawiony opis pozostaje w CRM.'
        : details.bucket ? 'Do Saldeo: dokument spoza KSeF. Opis płatności zbiorczej, jeśli dotyczy, jest osobnym załącznikiem do wyciągów.'
        : 'Pozostaje w CRM — bez osobnej wysyłki do Saldeo.' };
  })() : null;

  const processCompleteMonth = async (mode: 'review' | 'send') => {
    if (sendingRef.current || noteSavingRef.current || followupSavingRef.current || openingKey) return;
    if (details) { setNoteError('Najpierw zapisz lub odrzuć zmiany i zamknij szczegóły dokumentu.'); return; }
    setError(''); setOutcome('');
    if (!companyId) { setError('Wybierz działalność.'); return; }
    if (!periodReady) { setError('Poczekaj na przywrócenie okresu i wybierz poprawny miesiąc oraz rok.'); return; }
    const settingsErrors: string[] = [];
    if (!emailAccountId || !senderAddress) settingsErrors.push('Wybierz konto nadawcze CRM.');
    if (!/^[^\s@]+@dok\.saldeo\.pl$/i.test(saldeoEmail.trim())) settingsErrors.push('Podaj dedykowany adres firmy w domenie @dok.saldeo.pl.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountantEmail.trim()) || /@dok\.saldeo\.pl$/i.test(accountantEmail.trim())) settingsErrors.push('Podaj zwykły adres e-mail księgowej, nie adres dokumentów Saldeo.');
    if (mode === 'send' && (!review || !reviewApproved || review.blockers.length)) { setError('Najpierw pobierz plik kontrolny, usuń wskazane blokady i potwierdź sprawdzenie pakietu.'); return; }
    if (mode === 'send' && settingsErrors.length) { setError(settingsErrors.join('\n')); return; }
    if (mode === 'review') { setReview(null); setReviewApproved(false); }
    sendingRef.current = true; setSending(true); setPreparingReview(mode === 'review'); ++requestId.current;
    let smtpStarted = false; let sentFiles = 0; let reportSent = false;
    try {
      setProgress(mode === 'review' ? 'Pobieram dane do pliku kontrolnego — bez wysyłki…' : 'Sprawdzam, czy dane nie zmieniły się od kontroli…');
      const fresh = await loadSnapshot(companyId, month, year); setSnapshot(fresh);
      const companyName = companies.find((company) => company.id === companyId)?.name || 'Działalność';
      const fingerprint = await controlFingerprint(fresh, { companyId, companyName, month, year, emailAccountId, sender: senderAddress,
        saldeoRecipient: saldeoEmail.trim(), accountantRecipient: accountantEmail.trim() });
      if (mode === 'send' && review!.fingerprint !== fingerprint) {
        setReview(null); setReviewApproved(false);
        throw new Error('Dokumenty, opisy, dopasowania, historia wysyłek lub odbiorcy zmienili się od pobrania pliku kontrolnego. Pobierz nowy plik i sprawdź go przed wysyłką.');
      }
      const currentBlockers = deliveryBlockers(fresh);
      if (mode === 'send' && currentBlockers.length) throw new Error(currentBlockers.join('\n'));
      const toSend = reviewDocuments(fresh).filter((document) => document.bucket && !document.sentAt);
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token; if (!accessToken) throw new Error('Brak aktywnej sesji CRM.');
      // Recheck server authorization before any reservation or send. Only a
      // configuration flag returns to the browser, never the PIN or subject.
      const pinConfigured = await getSaldeoConfiguration(accessToken, companyId);
      setSaldeoAccess(saldeoConfigurationState(pinConfigured));
      if (mode === 'send' && toSend.length && !pinConfigured) throw new Error('Brak poprawnego PIN_SALDEO na serwerze. Wysyłka nie została rozpoczęta.');
      const period = `${String(month).padStart(2, '0')}/${year}`; const slug = `${year}-${String(month).padStart(2, '0')}`;
      if (mode === 'review') {
      const blockers = [...currentBlockers, ...settingsErrors]; const sourceChecks: SourceCheck[] = [];
      if (toSend.length && !pinConfigured) blockers.push('Brak poprawnego PIN_SALDEO w konfiguracji serwera. Przed wysyłką uzupełnij go i przygotuj nową kontrolę.');
      const prepared: Attachment[] = [];
      for (const [index, source] of toSend.entries()) {
        setProgress(`Kontrola — przygotowuję dokument ${index + 1}/${toSend.length}: ${source.number}`);
        try {
        if (!source.path) throw new Error('Brak pliku źródłowego.');
        const original = await downloadBlob(source.bucket!, source.path!, source.number);
        sourceChecks.push({ bucket: source.bucket!, path: source.path, filename: source.filename, digest: await blobDigest(original) });
        const note = reviewNote(fresh, source);
        const result = note.trim()
          ? await annotateSaldeoDocument({ original, filename: source.filename, companyId, companyName, period, documentNumber: source.number, documentKind: source.kind, accountingNote: note, payments: [] })
          : { blob: original, filename: source.filename };
        prepared.push(await attachment(result.blob, result.filename, source));
        } catch (cause: any) { blockers.push(`${source.number}: ${cause?.message || 'Nie można przygotować załącznika.'}`); }
      }
      const accountantAttachments: Attachment[] = [];
      const groupedPayments = collectivePaymentDetails(fresh);
      const groupedCsv = buildSaldeoCollectivePaymentCsv(groupedPayments);
      if (groupedPayments.length) {
        accountantAttachments.push(await attachment(new Blob([groupedCsv], { type: 'text/csv;charset=utf-8' }), `platnosci-zbiorcze-${slug}.csv`));
        accountantAttachments.push(await attachment(new Blob([buildSaldeoCollectivePaymentHtml({ companyName, period, payments: groupedPayments })], { type: 'text/html;charset=utf-8' }), `opisy-do-wyciagow-${slug}.html`));
      }
      const statementDigests: string[] = [];
      for (const [index, statement] of fresh.statements.entries()) {
        setProgress(`Kontrola — pobieram wyciąg ${index + 1}/${fresh.statements.length}: ${statement.file_name}`);
        try {
        if (!statement.file_storage_path) throw new Error('Brak pliku źródłowego wyciągu.');
        const file = await downloadBlob('bank-statements', statement.file_storage_path!, statement.file_name);
        const result = await attachment(file, statement.file_name); accountantAttachments.push(result);
        sourceChecks.push({ bucket: 'bank-statements', path: statement.file_storage_path, filename: statement.file_name, digest: await blobDigest(file) });
        statementDigests.push(await sha256(`${statement.id}:${result.content}`));
        } catch (cause: any) { blockers.push(`${statement.file_name}: ${cause?.message || 'Nie można przygotować wyciągu.'}`); }
      }
      // All downloads, annotations, limits and report content are ready BEFORE the first email.
      let batches: ControlReview['batches'] = [];
      try { batches = (['FK', 'DS', 'P'] as SaldeoType[]).flatMap((type) => chunks(prepared.filter((item) => item.document!.saldeoType === type), 7 * 1024 * 1024, 10).map((items) => ({ type, items }))); }
      catch (cause: any) { blockers.push(cause?.message || 'Nie można przygotować paczek dokumentów.'); }
      const accountantBytes = accountantAttachments.reduce((sum, item) => sum + item.size, 0);
      if (accountantBytes > 18 * 1024 * 1024) blockers.push('Raporty i oryginalne wyciągi przekraczają 18 MB. Zmniejsz pliki wyciągów przed przekazaniem.');
      const reportHash = await sha256(JSON.stringify({ version: 6, companyId, period, collectivePayments: groupedCsv, statements: statementDigests }));
      const reportKey = `report:${reportHash}`;
      const unresolvedKeys = [...toSend.map((source) => `file:${source.key}`), reportKey];
      let earlierAttempts: Row[] = [];
      try {
        earlierAttempts = await byIds('accounting_delivery_attempts', 'id,delivery_key,status,my_company_id,recipient', 'delivery_key', unresolvedKeys);
        if (earlierAttempts.some((attempt) => attempt.my_company_id === companyId && attempt.status !== 'sent')) blockers.push('Istnieje przerwana wysyłka o niepotwierdzonym wyniku. Najpierw sprawdź pocztę i odbiór w Saldeo; nie ponawiamy jej automatycznie.');
      } catch { blockers.push('Nie można odczytać historii prób wysyłki. Przygotowany plan wymaga ponownej kontroli przed przekazaniem.'); }
      const reportAlreadySent = earlierAttempts.some((attempt) => attempt.my_company_id === companyId && attempt.delivery_key === reportKey && attempt.status === 'sent' && String(attempt.recipient).toLowerCase() === accountantEmail.trim().toLowerCase());
      const controlFiles: SaldeoControlReportInput['files'] = [];
      for (const file of [...prepared, ...accountantAttachments]) controlFiles.push({ recipient: file.document ? 'saldeo' : 'accountant', filename: file.filename,
        contentType: file.contentType, size: file.size, content: file.content, sha256: await attachmentDigest(file),
        description: file.document ? `${file.document.number} — dokument spoza KSeF${reviewNote(fresh, file.document).trim() ? ' z istniejącym opisem' : ' bez dodatkowej adnotacji'}` : 'Oryginalny wyciąg lub opis wyłącznie płatności zbiorczych',
        disposition: !file.document && reportAlreadySent ? 'already_sent' : 'send' });
      const revision = await sha256(stableJson({ fingerprint, files: controlFiles.map(({ content, ...file }) => file), reportHash }));
      const createdAt = new Date().toISOString(); const controlFilename = `kontrola-przed-wysylka-${safeFilename(companyName)}-${slug}-${revision.slice(0, 8)}.html`;
      const warnings = ['Plik kontrolny służy wyłącznie do Twojej kontroli. Nie jest automatycznie załączany do żadnej wiadomości.',
        'Do Saldeo trafiają wyłącznie dokumenty spoza KSeF. Faktur KSeF i ich połączonych kopii CRM nie wysyłamy ponownie; synchronizacja KSeF w Saldeo nie jest tu potwierdzona.',
        'Do wyciągów dołączamy wyłącznie podział płatności zbiorczych. Zwykłe dopasowania, braki, płace oraz szczegóły podatków pozostają w CRM, nie w dodatkowych raportach dla księgowej.',
        `Operacje VAT / ZUS / PIT: ${fresh.transactions.filter(isStatementOnlyPayment).length}. Są widoczne na oryginalnych wyciągach, bez osobnych dokumentów i opisów do Saldeo.`,
        ...fresh.internalWarnings];
      if (fresh.describedMissing.length) warnings.push(`${fresh.describedMissing.length} opisanych braków dokumentów pozostaje wewnętrznym zadaniem CRM — poza wysyłką.`);
      if (documentFollowupRows(fresh).length) warnings.push(`${documentFollowupRows(fresh).length} pozycji zapisano na trwałej liście „Dokumenty do dosłania”. Świadoma zgoda pozwala wysłać pozostałe dokumenty; nie oznacza dopasowania wydatku ani wysłania brakującej faktury.`);
      if (reportAlreadySent) warnings.push('Identyczny raport z wyciągami był już wysłany do tej księgowej. Jest dostępny do kontroli, ale ponowna wysyłka zostanie pominięta.');
      const paymentDetails = (bank: Bank, allocation?: Allocation) => ({ date: bank.transaction_date, postingDate: bank.posting_date || '', reference: bank.reference_number || '',
        counterparty: bank.counterparty_name || '', title: bank.title || bank.raw_description || '', bankAmount: Math.abs(Number(bank.amount)), bankCurrency: bank.currency,
        allocatedAmount: allocation?.amount ?? 0, documentAmount: allocation?.documentAmount ?? null, documentCurrency: allocation?.currency || bank.currency,
        note: bank.accounting_note || '', collective: paymentDocuments(fresh, bank.id).length > 1 || Number(bank.matched_document_count) > 1,
        linkedDocuments: paymentDocuments(fresh, bank.id), statementName: fresh.statementNames.get(bank.statement_id) || '' });
      const reportHtml = buildSaldeoControlReport({ companyName, period, createdAt, revision, sender: senderAddress, saldeoRecipient: saldeoEmail.trim(), accountantRecipient: accountantEmail.trim(),
        blockers: [...new Set(blockers)], warnings, files: controlFiles, followups: documentFollowupRows(fresh), excludedInvoiceCount: fresh.excludedInvoiceCount, hiddenTransactionCount: fresh.hiddenTransactionCount,
        documents: reviewDocuments(fresh).map((source) => {
          const relations = fresh.allocations.filter((allocation) => allocation.documentKey === source.key);
          const payments = relations.map((allocation) => paymentDetails(fresh.allBanks.get(allocation.transactionId)!, allocation));
          if (source.linkedBankId && !payments.length && fresh.allBanks.has(source.linkedBankId)) payments.push({ ...paymentDetails(fresh.allBanks.get(source.linkedBankId)!), note: [fresh.allBanks.get(source.linkedBankId)!.accounting_note, 'Dokument źródłowy do przelewu — brak alokacji kwoty faktury.'].filter(Boolean).join('\n') });
          return { number: source.number, kind: source.kind, source: SOURCE_LABELS[source.source], date: source.date, dueDate: source.dueDate, counterparty: source.counterparty,
            amount: source.amount, currency: source.currency, note: reviewNote(fresh, source), ksefReference: source.ksefReference, payments, hasPaymentLink: documentHasPaymentLink(fresh, source),
            disposition: source.sentAt ? `Pomijany plik — wysłano wcześniej ${source.sentAt}; nie ponawiamy wysyłki` : prepared.some((file) => file.document?.key === source.key) ? 'Nowy dokument spoza KSeF do Saldeo' : 'BLOKADA — nie przygotowano pliku' };
        }),
        transactions: fresh.transactions.map((bank) => ({ date: bank.transaction_date, postingDate: bank.posting_date || '', reference: bank.reference_number || '', counterparty: bank.counterparty_name || '',
          title: bank.title || bank.raw_description || '', amount: Math.abs(Number(bank.amount)), currency: bank.currency, direction: bank.transaction_type === 'credit' ? 'Wpływ' : 'Wydatek',
          status: status(bank), statementOnly: isStatementOnlyPayment(bank), awaitingDocument: hasMissingDocumentAcknowledgment(fresh, bank), allocatedAmount: Number(bank.allocated_amount || 0), remainingAmount: remaining(bank), note: bank.accounting_note || '', statementName: fresh.statementNames.get(bank.statement_id) || '',
          documents: fresh.allocations.filter((allocation) => allocation.transactionId === bank.id).map((allocation) => `${fresh.documents.find((source) => source.key === allocation.documentKey)?.number || 'Niedostępny dokument'}: ${money(allocation.amount, bank.currency)}`).join(' | ') })) });
      const preparedReview: ControlReview = { fingerprint, revision, createdAt, html: reportHtml, filename: controlFilename, blockers: [...new Set(blockers)], prepared, accountantAttachments, sourceChecks, batches, reportHash };
      downloadControlHtml(reportHtml, controlFilename); setReview(preparedReview); setReviewApproved(false);
      setOutcome(blockers.length ? 'Pobrano plik kontrolny z listą blokad. Możesz przejrzeć plan i dostępne załączniki; wysyłka pozostaje zablokowana. Niczego nie wysłano.' : 'Pobrano plik kontrolny. Otwórz go w przeglądarce, sprawdź opisy i gotowe załączniki, a następnie potwierdź kontrolę tutaj. Niczego nie wysłano.');
      return;
      }
      // Sending uses exactly the prepared attachment bytes contained in the reviewed file.
      const acceptedReview = review!;
      for (const [index, source] of acceptedReview.sourceChecks.entries()) {
        setProgress(`Przed wysyłką sprawdzam niezmienność pliku ${index + 1}/${acceptedReview.sourceChecks.length}: ${source.filename}`);
        const current = await downloadBlob(source.bucket, source.path, source.filename);
        if (await blobDigest(current) !== source.digest) {
          setReview(null); setReviewApproved(false);
          throw new Error(`Plik „${source.filename}” zmienił się po kontroli. Pobierz nowy plik kontrolny przed wysyłką.`);
        }
      }
      const { batches, accountantAttachments, reportHash } = acceptedReview;
      const reportKey = `report:${reportHash}`;
      const earlierAttempts = await byIds('accounting_delivery_attempts', 'id,delivery_key,status,my_company_id,recipient', 'delivery_key', [...toSend.map((source) => `file:${source.key}`), reportKey]);
      if (earlierAttempts.some((attempt) => attempt.my_company_id === companyId && attempt.status !== 'sent')) throw new Error('Istnieje przerwana wysyłka o niepotwierdzonym wyniku. Sprawdź pocztę i Saldeo przed ponowieniem.');
      const { error: settingError } = await supabase.from('my_companies').update({ saldeo_document_email: saldeoEmail.trim(), accountant_email: accountantEmail.trim() }).eq('id', companyId);
      if (settingError) throw settingError;
      const deliver = async (recipient: string, items: Row[], subject: string, body: string, files: Attachment[], saldeoType?: SaldeoType) => {
        const claimItems = saldeoType ? await Promise.all(items.map(async (item) => {
          const file = files.find((candidate) => candidate.document && item.key === `file:${candidate.document.key}`);
          if (!file || !acceptedReview.prepared.some((approved) => approved.document?.key === file.document?.key && approved.content === file.content)) {
            throw new Error('Plik nie należy do zatwierdzonej paczki. Przygotuj nowy plik kontrolny.');
          }
          return { ...item, metadata: { ...item.metadata, reviewed: true, control_revision: acceptedReview.revision,
            email_account_id: emailAccountId, content_sha256: await attachmentDigest(file), mime_type: file.contentType, filename: file.filename } };
        })) : items;
        const { data: reservation, error: claimError } = await supabase.rpc('claim_accounting_delivery', { p_company_id: companyId, p_recipient: recipient, p_items: claimItems });
        if (claimError) throw new Error(claimError.message || 'Nie można bezpiecznie zarezerwować wysyłki.');
        const claims = (reservation?.claimed || []) as Claim[];
        if (!claims.length) return 0;
        const keys = new Set(claims.map((claim) => claim.key));
        const payloadFiles = files.filter((file) => !file.document || keys.has(`file:${file.document.key}`));
        smtpStarted = true;
        let messageId: string | null = null;
        try {
          let result: { messageId?: unknown };
          if (saldeoType) {
            const response = await fetch('/bridge/integrations/saldeo', {
              method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({ companyId, emailAccountId, recipient, periodMonth: month, periodYear: year, documentType: saldeoType,
                controlRevision: acceptedReview.revision, attemptIds: claims.map((claim) => claim.id),
                attachments: payloadFiles.map(({ document, filename, content, contentType, contentDisposition }) => ({
                  attemptId: claims.find((claim) => claim.key === `file:${document?.key}`)?.id, filename, content, contentType, contentDisposition,
                })),
              }),
            });
            const responseBody = await response.json().catch(() => ({}));
            if (!response.ok || responseBody.success !== true) throw new Error('Nie udało się potwierdzić wysyłki do Saldeo.');
            result = responseBody;
          } else {
            result = await dispatchCrmEmail({ accessToken, functionName: 'send-email', payload: { emailAccountId, to: recipient, subject, body, attachments: payloadFiles.map(({ filename, content, contentType, contentDisposition }) => ({ filename, content, contentType, contentDisposition })) } });
          }
          messageId = typeof result.messageId === 'string' ? result.messageId : null;
        } catch (cause) {
          await supabase.rpc('complete_accounting_delivery', { p_attempt_ids: claims.map((claim) => claim.id), p_status: 'uncertain', p_email_message_id: null });
          throw new Error('Wynik wysyłki wiadomości jest niepewny. Przerwano dalsze wysyłki. Sprawdź pocztę i Saldeo przed ponowieniem; rezerwacja chroni przed duplikatami.');
        }
        const { error: logError } = await supabase.rpc('complete_accounting_delivery', { p_attempt_ids: claims.map((claim) => claim.id), p_status: 'sent', p_email_message_id: messageId });
        if (logError) throw new Error('Serwer pocztowy przyjął wiadomość, ale nie udało się potwierdzić historii w CRM. Nie ponawiaj wysyłki: sprawdź pocztę i odbiór w Saldeo. Dalsze wysyłki zostały zatrzymane.');
        return payloadFiles.length;
      };
      for (const [index, batch] of batches.entries()) {
        setProgress(`3/4 — Wysyłam paczkę dokumentów do Saldeo ${index + 1}/${batches.length} (${batch.items.length} plików)…`);
        sentFiles += await deliver(saldeoEmail.trim(), batch.items.map((file) => ({ key: `file:${file.document!.key}`, kind: 'saldeo_document', metadata: { period_month: month, period_year: year, source_type: file.document!.source, source_id: file.document!.id, saldeo_document_type: batch.type, filename: file.filename } })),
          `Dokumenty do Saldeo — ${period}`, '<p>Dokumenty spoza KSeF. Istniejące opisy dokumentów, jeśli są potrzebne, znajdują się na dodatkowej stronie kopii PDF.</p>', batch.items, batch.type);
      }
      setProgress('4/4 — Wysyłam wyciągi i opisy płatności zbiorczych do księgowej…');
      const groupedPayments = collectivePaymentDetails(fresh);
      const body = `<p>Dzień dobry,</p><p>Przekazuję przygotowany w CRM zestaw za <strong>${html(period)}</strong>, <strong>${html(companyName)}</strong>.</p>
        <p>Do Saldeo przekazano w tym przebiegu ${sentFiles} nowych dokumentów spoza KSeF. Nie dołączamy ponownie faktur KSeF ani ich kopii z CRM.</p>
        <p>W załącznikach: ${fresh.statements.length} oryginalnych wyciągów bankowych${groupedPayments.length ? ` oraz zestawienie ${groupedPayments.length} płatności zbiorczych, z numerami referencyjnymi przelewów i podziałem kwot pomiędzy faktury` : '. W tym okresie nie ma zapisanych powiązań wymagających opisu płatności zbiorczej'}.</p>
        <p>Zwykłych płatności, VAT, ZUS i PIT nie opisujemy ponownie — są na wyciągach. Wewnętrzne listy braków i uzgodnień pozostają w CRM.</p>
        <p><strong>Wysłanie e-maila nie potwierdza przyjęcia dokumentów przez Saldeo. Opisy płatności zbiorczych są załącznikiem do wyciągów, nie importem rozrachunków.</strong></p><p>Pozdrawiam</p>`;
      const count = accountantAttachments.length ? await deliver(accountantEmail.trim(), [{ key: reportKey, kind: 'accountant_report', metadata: {
        period_month: month, period_year: year, transaction_count: fresh.transactions.length, statement_count: fresh.statements.length,
        matched_relation_count: fresh.allocations.filter((allocation) => fresh.transactions.some((bank) => bank.id === allocation.transactionId)).length,
        saldeo_document_count: reviewDocuments(fresh).filter((document) => document.bucket).length, unresolved_count: new Set([...fresh.describedMissing, ...fresh.unresolved].map((bank) => bank.id)).size,
        snapshot: { source_statements: fresh.statements.map((statement) => statement.file_name), described_missing_document_count: fresh.describedMissing.length, described_missing: fresh.describedMissing.map((bank) => ({ id: bank.id, reference: bank.reference_number, note: bank.accounting_note })), documents_to_follow: documentFollowupRows(fresh), acknowledged_followup_ids: fresh.followups.filter((item) => item.active).map((item) => item.id), payload_hash: reportHash, saldeo_receipt_confirmed: false, control_file_revision: acceptedReview.revision, control_file_created_at: acceptedReview.createdAt, control_approved_at: new Date().toISOString() },
      } }], `Wyciągi${groupedPayments.length ? ' i płatności zbiorcze' : ''} — ${companyName} — ${period}`, body, accountantAttachments) : 0;
      reportSent = count > 0; setReview(null); setReviewApproved(false);
      setOutcome(`Zakończono przekazanie: ${sentFiles} nowych plików wysłanych e-mailem do Saldeo; ${reportSent ? 'wyciągi i wymagane opisy płatności zbiorczych wysłane do księgowej' : accountantAttachments.length ? 'identyczne wyciągi i opisy były już wysłane — pominięto duplikat' : 'brak wyciągów i opisów do wysłania księgowej'}. Odbiór w Saldeo pozostaje niepotwierdzony. Braki i zadania pozostają w CRM.`);
      setSnapshot({ ...fresh, documents: fresh.documents.map((document) => toSend.some((item) => item.key === document.key) ? { ...document, sentAt: new Date().toISOString() } : document) });
    } catch (cause: any) {
      if (smtpStarted) { setReview(null); setReviewApproved(false); }
      setError(`${cause?.message || (mode === 'review' ? 'Nie udało się przygotować pliku kontrolnego.' : 'Nie udało się przekazać miesiąca.')}${smtpStarted ? `\nZapisanych nowych wysyłek plików: ${sentFiles}. Znanych udanych wysyłek CRM nie powtórzy.` : '\nŻadna wiadomość nie została wysłana w tym przebiegu.'}`);
    } finally { sendingRef.current = false; setSending(false); setPreparingReview(false); setProgress(''); }
  };

  return <div className="space-y-5">
    <div className="rounded-xl bg-blue-500/[0.06] p-5 text-blue-100"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-300" /><div><h3 className="font-medium">Gotowa paczka miesiąca — tylko to, czego potrzebuje księgowa</h3><p className="mt-1 text-sm leading-6 text-blue-100/65">Do Saldeo: wyłącznie dokumenty spoza KSeF. Do księgowej: oryginalne wyciągi oraz opisy płatności zbiorczych, gdy jeden przelew pokrywa kilka faktur. Zwykłych dopasowań, podatków, płac ani wewnętrznych list braków nie wysyłamy jako dodatkowych raportów.</p><p className="mt-2 text-xs leading-5 text-blue-100/55">Sprawdź plik kontrolny, potem pobierz paczkę albo wyślij ją jednym przyciskiem. Nic nie wysyła się automatycznie. E-mail nie tworzy rozrachunków ani nie potwierdza odbioru w Saldeo.</p></div></div></div>
    <fieldset disabled={sending || noteSaving || Boolean(followupSaving) || Boolean(openingKey) || Boolean(details)} className="space-y-5">
      <div className={`${panelClass} grid gap-4 md:grid-cols-3`}>
        <label className="text-xs text-gray-400">Działalność<select value={companyId} disabled={controlledCompanyId !== undefined} onChange={(event) => setCompanyId(event.target.value)} className={inputClass}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
        <label className="text-xs text-gray-400">Miesiąc<select value={month} disabled={Boolean(period) || !companyId || periodCompanyId !== companyId} onChange={(event) => setMonth(Number(event.target.value))} className={inputClass}>{MONTHS.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}</select></label>
        <label className="text-xs text-gray-400">Rok<input type="number" min={2000} max={2100} value={year || ''} disabled={Boolean(period) || !companyId || periodCompanyId !== companyId} onChange={(event) => setYear(Number(event.target.value))} className={inputClass} /></label>
        <p className="text-xs leading-5 text-gray-400 md:col-span-3">{period ? 'Firma i okres odpowiadają otwartemu dashboardowi miesiąca.' : 'Wybrany okres zapamiętujemy osobno dla firmy podczas pracy w tej karcie.'} Niezakończone wewnętrzne dopasowania nie blokują wysyłki gotowych dokumentów i nie oznaczają zakończenia rozliczenia miesiąca.</p>
        {companyId && periodCompanyId === companyId && !periodReady && <p className="text-xs text-amber-200 md:col-span-3">Wybierz miesiąc od 1 do 12 i rok od 2000 do 2100.</p>}
      </div>
      {loading && <div className={`${panelClass} flex items-center gap-2 text-sm text-gray-400`}><Loader2 className="h-5 w-5 animate-spin" /> Pobieram aktualne dokumenty, opisy i powiązania…</div>}
      {snapshot && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Nowe pliki do Saldeo', String(pending.length), `${sent.length} wysłanych wcześniej — bez ponownej wysyłki`], ['Oryginalne wyciągi', String(snapshot.statements.length), 'Załączniki dla księgowej'], ['Płatności zbiorcze', String(collectivePayments.length), 'Tylko te płatności wymagają opisu podziału'], ['KSeF — pomijamy', String(snapshot.documents.filter((document) => document.source === 'ksef' || document.ksefReference).length), 'Bez ponownej wysyłki faktur i kopii CRM']].map(([label, value, detail]) => <div key={label} className={panelClass}><div className="text-xs text-gray-400">{label}</div><div className="mt-2 text-2xl text-gray-100">{value}</div><p className="mt-1 text-xs text-gray-500">{detail}</p></div>)}</div>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
          <div className={panelClass}><div className="flex items-center justify-between gap-3"><h3 className="font-medium text-gray-100">Dokumenty spoza KSeF</h3><button type="button" onClick={() => void refresh()} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-300"><RefreshCw className="h-3.5 w-3.5" /> Odśwież</button></div><p className="mt-2 text-xs leading-5 text-gray-400">To jedyna lista dokumentów przekazywanych do Saldeo. Zapisane powiązania są widoczne do kontroli; zwykłe przelewy nie otrzymują dodatkowych opisów. Istniejący opis niepowiązanego dokumentu możesz poprawić.</p>
            {!fileDocuments.length && <p className="mt-4 rounded-lg bg-green-400/[0.05] p-3 text-sm text-green-200">Brak dokumentów spoza KSeF do przekazania w tym okresie.</p>}
            <div className="mt-4 max-h-[440px] space-y-2 overflow-y-auto pr-1">{reviewDocuments(snapshot).map((item) => {
              const hasLink = documentHasPaymentLink(snapshot, item); const description = reviewNote(snapshot, item);
              const origin = existingNoteOrigin(snapshot, item);
              const bankIds = new Set(snapshot.allocations.filter((allocation) => allocation.documentKey === item.key).map((allocation) => allocation.transactionId));
              if (item.linkedBankId && hasLink) bankIds.add(item.linkedBankId);
              if (item.source === 'ksef') for (const bank of snapshot.allBanks.values()) if (bank.matched_invoice_id === item.id) bankIds.add(bank.id);
              return <div key={item.key} className="rounded-lg bg-black/20 p-3">
                <div className="flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-500" /><div className="min-w-0 flex-1"><p className="break-words text-sm text-gray-100">{item.number} <span className="text-xs text-gray-500">· źródło: {SOURCE_LABELS[item.source]}</span></p><p className="mt-1 text-xs text-gray-400">{item.counterparty}</p></div><span className={`shrink-0 text-xs ${item.sentAt ? 'text-green-300' : 'text-gray-400'}`}>{item.sentAt ? 'E-mail wysłany' : item.bucket ? 'Do Saldeo' : 'W raporcie'}</span></div>
                {hasLink ? <div className="mt-2 space-y-2 text-xs text-green-200"><p>Powiązana z płatnością — bez edycji opisu</p>{[...bankIds].map((id) => {
                  const bank = snapshot.allBanks.get(id); if (!bank) return null;
                  const group = paymentDocuments(snapshot, id); const assigned = snapshot.allocations.filter((allocation) => allocation.transactionId === id && allocation.documentKey === item.key).reduce((sum, allocation) => sum + allocation.amount, 0);
                  return <div key={id} className="rounded-md bg-green-400/[0.04] p-2"><p>{bank.transaction_date} · przelew {money(Math.abs(Number(bank.amount)), bank.currency)}{assigned > 0 ? ` · do tej faktury ${money(assigned, bank.currency)}` : ''}</p><p className="mt-1 break-all text-gray-400">Nr płatności: {bank.reference_number || 'nie zapisano'}</p>{group.length > 1 && <p className="mt-1 text-[#d3bb73]">Jedna płatność za {group.length} dokumentów: {group.map((entry) => entry.number).join(', ')}</p>}</div>;
                })}</div> : description.trim() ? <div className="mt-2 text-xs"><p className="text-green-200">Opisana w analizie — bez powiązanej płatności</p><p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-gray-300">{description}</p></div> : <p className="mt-2 text-xs text-amber-200">Bez powiązanej płatności i bez opisu w analizie. Jeżeli pozycja wymaga wyjaśnienia, uzupełnij je w analizie.</p>}
                <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void openDocumentDetails(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/10">{openingKey === item.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}Zobacz więcej</button>{origin && !hasLink && <button type="button" onClick={() => void openDocumentDetails(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-white/10"><Pencil className="h-3.5 w-3.5" />Edytuj istniejący opis</button>}{!hasLink && !description.trim() && <a href="/crm/invoices?tab=external&section=statements" className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/10">Przejdź do analizy</a>}</div>
              </div>;
            })}</div>
            <section className="mt-6 rounded-xl bg-white/[0.025] p-4"><h3 className="font-medium text-gray-100">Opisy do wyciągów: płatności zbiorcze ({collectivePayments.length})</h3><p className="mt-1 text-xs leading-5 text-gray-400">Jedna płatność — kilka faktur. Księgowa otrzyma numer przelewu, datę, kwotę oraz podział między dokumenty, także faktury KSeF bez ponownego wysyłania ich plików.</p><div className="mt-3 space-y-2">{collectivePayments.length ? collectivePayments.map((payment) => <div key={payment.id} className="rounded-lg bg-black/20 p-3 text-xs"><p className="font-medium text-gray-100">{payment.date} · {money(payment.bankAmount, payment.bankCurrency)} · {payment.counterparty}</p><p className="mt-1 break-all text-gray-400">Nr płatności: {payment.reference || 'nie zapisano'}</p><p className="mt-1 text-gray-500">{payment.statementName}</p><ul className="mt-2 space-y-1 text-[#d3bb73]">{payment.linkedDocuments?.map((document) => <li key={document.key || document.number}>{document.number} · {document.counterparty} — {document.allocatedAmount == null ? 'Brak zapisanej kwoty' : money(document.allocatedAmount, payment.bankCurrency)}</li>)}</ul></div>) : <p className="text-xs text-gray-500">Brak zapisanych płatności za kilka faktur. Nie dołączymy pustego raportu.</p>}</div></section>
            <details className="mt-6 rounded-xl bg-white/[0.025] p-4"><summary className="cursor-pointer text-sm font-medium text-gray-300">Tylko w CRM: braki i dokumenty do dosłania ({unlinkedPayments.length})</summary>
            <h3 className="mt-4 font-medium text-gray-100">Pozostałe płatności bez powiązanego dokumentu ({unlinkedPayments.length})</h3>
            {!!snapshot.internalWarnings.length && <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-amber-200">{snapshot.internalWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
            <p className="mt-1 text-xs leading-5 text-gray-400">To operacje z wyciągu, nie faktury do wysłania. Przy wydatku możesz świadomie pozostawić brak dokumentu do uzupełnienia i przekazać pozostałe dokumenty. Opisy pochodzą z analizy; VAT, ZUS i PIT pozostają tylko na wyciągach.</p>
            {statementOnlyPayments.length > 0 && <p className="mt-2 rounded-lg bg-blue-400/[0.05] p-3 text-xs leading-5 text-blue-200">Tylko na wyciągach i w rejestrze: {statementOnlyPayments.length} operacji VAT / ZUS / PIT. Nie trafiają do brakujących dokumentów ani jako osobne pliki do Saldeo. Ich opisy i dane pozostają w analizie CRM.</p>}
            {!unlinkedPayments.length && <p className="mt-3 text-xs text-green-200">Brak pozostałych płatności bez powiązanego dokumentu.</p>}
            <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">{unlinkedPayments.map((bank) => <div key={bank.id} className="rounded-lg bg-black/20 p-3">
              <p className="text-sm text-gray-100">{bank.transaction_date} · {bank.transaction_type === 'credit' ? 'Wpływ' : 'Wydatek'} {money(Math.abs(Number(bank.amount)), bank.currency)}</p><p className="mt-1 text-xs text-gray-400">{bank.counterparty_name || 'Brak nazwy kontrahenta'} · {status(bank)}</p>
              <p className="mt-1 break-all text-xs text-gray-500">Nr płatności: {bank.reference_number || 'nie zapisano'}</p>
              {bank.accounting_note?.trim() ? <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-xs text-gray-300">Opis z analizy: {bank.accounting_note}</p> : <p className="mt-2 text-xs text-amber-200">Brak opisu w analizie — wróć do analizy, aby go uzupełnić.</p>}
              {canAcknowledgeMissingDocument(snapshot, bank) && <div className="mt-3 rounded-lg bg-amber-400/[0.05] p-3 text-xs leading-5 text-amber-100"><label className="flex cursor-pointer items-start gap-2"><input type="checkbox" checked={hasMissingDocumentAcknowledgment(snapshot, bank)} onChange={(event) => void updateDocumentFollowup(bank.id, event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#d3bb73]" /><span>Świadomie wysyłam pozostałe dokumenty — dokument do tego wydatku doślę później.</span></label>{snapshot.followups.some((item) => item.active && item.bank_transaction_id === bank.id) && !hasMissingDocumentAcknowledgment(snapshot, bank) && <p className="mt-2">Dane lub opis zmieniły się od potwierdzenia. Sprawdź je i zaznacz ponownie.</p>}<p className="mt-1 pl-6 text-amber-100/60">Zapis na liście „Do dosłania” nie zmienia dopasowania ani statusu rozliczenia.</p></div>}
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => void openDocumentDetails(paymentItem(snapshot, bank))} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/10"><Eye className="h-3.5 w-3.5" />Zobacz płatność</button>{bank.accounting_note?.trim() ? <button type="button" onClick={() => void openDocumentDetails(paymentItem(snapshot, bank))} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-white/10"><Pencil className="h-3.5 w-3.5" />Edytuj opis z analizy</button> : <a href="/crm/invoices?tab=external&section=statements" className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-white/10">Przejdź do analizy</a>}</div>
            </div>)}</div>
            <div className="mt-6 rounded-xl bg-white/[0.025] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium text-gray-100">Dokumenty do dosłania — {month}/{year} ({followupRows.length})</h3><button type="button" onClick={downloadFollowups} disabled={!followupRows.length} className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-[#d3bb73] hover:bg-white/10 disabled:opacity-40"><Download className="h-3.5 w-3.5" />Pobierz listę</button></div><p className="mt-2 text-xs leading-5 text-gray-400">Lista zapisuje się w CRM i pozostaje po wysłaniu paczki. Po znalezieniu dokumentu dopasuj go w analizie i uwzględnij w kolejnym przekazaniu. Samo dopasowanie nie usuwa pozycji ani nie oznacza jej wysłania.</p><div className="mt-3 max-h-[320px] space-y-2 overflow-y-auto">{followupRows.length ? followupRows.map((item) => <div key={item.id} className="rounded-lg bg-black/20 p-3 text-xs"><p className="text-gray-100">{item.date} · {money(item.amount, item.currency)} · {item.counterparty || 'Brak nazwy kontrahenta'}</p><p className="mt-1 break-all text-gray-500">Nr płatności: {item.reference || 'nie zapisano'}</p><p className="mt-2 text-amber-200">{item.status}</p>{item.note && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-gray-400">{item.note}</p>}<p className="mt-2 text-gray-500">Potwierdzono: {new Date(item.acknowledgedAt).toLocaleString('pl-PL')}</p><div className="mt-2 flex flex-wrap gap-2"><a href="/crm/invoices?tab=external&section=statements" className="rounded-lg bg-white/5 px-2 py-1.5 text-[#d3bb73]">Przejdź do analizy</a><button type="button" onClick={() => void updateDocumentFollowup(item.bankId, false)} className="rounded-lg bg-white/5 px-2 py-1.5 text-gray-300">Usuń z listy</button></div></div>) : <p className="text-xs text-gray-500">Nie zaznaczono dokumentów do późniejszego dosłania.</p>}</div></div>
            </details>
            {snapshot.excludedInvoiceCount > 0 && <p className="mt-3 text-xs text-gray-500">Pominięto {snapshot.excludedInvoiceCount} proform, dokumentów roboczych lub anulowanych.</p>}
          </div>
          <div className={panelClass}><h3 className="font-medium text-gray-100">Sprawdź pakiet przed wysyłką — {MONTHS[month - 1]} {year}</h3>
            <label className="mt-4 block text-xs text-gray-400">Konto nadawcze CRM<select value={emailAccountId} onChange={(event) => setEmailAccountId(event.target.value)} className={inputClass}><option value="">Wybierz konto</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.email_address}</option>)}</select></label>
            <label className="mt-3 block text-xs text-gray-400">Adres dokumentów Saldeo<input type="email" value={saldeoEmail} onChange={(event) => setSaldeoEmail(event.target.value)} placeholder="firma@dok.saldeo.pl" className={inputClass} /></label>
            <div className={`mt-3 rounded-lg p-3 text-xs leading-5 ${saldeoAccess.state === 'ready' ? 'bg-green-400/[0.05] text-green-200' : 'bg-white/[0.04] text-gray-300'}`}><p className="flex items-center gap-2 font-medium">{saldeoAccess.state === 'checking' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}Automatyczny PIN Saldeo</p><p className="mt-1">{saldeoAccess.message}</p><p className="mt-1 text-gray-500">PIN nie jest zwracany do tego panelu ani zapisywany w pliku kontrolnym. Zatwierdzenie paczki pozostaje wymagane.</p><button type="button" disabled={saldeoAccess.state === 'checking'} onClick={() => setSaldeoCheckKey((value) => value + 1)} className="mt-2 rounded-md bg-white/5 px-2 py-1 text-[#d3bb73] hover:bg-white/10 disabled:opacity-40">Sprawdź ponownie</button></div>
            <label className="mt-3 block text-xs text-gray-400">E-mail księgowej<input type="email" value={accountantEmail} onChange={(event) => setAccountantEmail(event.target.value)} placeholder="ksiegowosc@biuro.pl" className={inputClass} /></label>
            {blockingErrors.length > 0 ? <div className="mt-4 rounded-lg bg-orange-500/10 p-3 text-xs text-orange-200"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Popraw pliki lub dane wymagane w paczce</p><ul className="mt-2 list-disc space-y-1 pl-4">{blockingErrors.map((message) => <li key={message}>{message}</li>)}</ul></div> : <div className="mt-4 rounded-lg bg-green-400/[0.06] p-3 text-xs leading-5 text-green-200"><CheckCircle2 className="mr-1 inline h-4 w-4" /> Możesz przygotować paczkę dokumentów spoza KSeF oraz wyciągów.{followupRows.length > 0 && ` Lista „Do dosłania” (${followupRows.length}) pozostaje wyłącznie w CRM.`} Niewyjaśnione pozycje nie są automatycznie uznawane za rozliczone.</div>}
            <button type="button" onClick={() => void processCompleteMonth('review')} disabled={sending || loading} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/15 px-4 py-3 text-sm font-medium text-[#d3bb73] disabled:cursor-not-allowed disabled:opacity-45">{preparingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{preparingReview ? 'Przygotowuję plik kontrolny…' : review ? 'Przygotuj nowy plik kontrolny' : '1. Pobierz plik kontrolny'}</button>
            <p className="mt-2 text-xs leading-5 text-gray-400">Otrzymasz prywatny plik HTML: dokładny plan wysyłki, gotowe załączniki i osobno informacje wewnętrzne. Ten plik nie trafia do księgowej ani do paczki ZIP. Nie zawiera PIN-u.</p>
            {review && <div className="mt-4 rounded-lg bg-white/[0.04] p-3 text-xs leading-5 text-gray-300">
              <p>Kontrola z {new Date(review.createdAt).toLocaleString('pl-PL')} · wersja {review.revision.slice(0, 8)}</p>
              <button type="button" onClick={() => downloadControlHtml(review.html, review.filename)} className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-white/5 px-2 py-1.5 text-[#d3bb73]"><Download className="h-3.5 w-3.5" /> Pobierz ten sam plik ponownie</button>
              {review.blockers.length > 0 ? <div className="mt-3 text-orange-200"><p>Wysyłka zablokowana — popraw poniższe pozycje i przygotuj nową kontrolę:</p><ul className="mt-1 list-disc space-y-1 pl-4">{review.blockers.map((message) => <li key={message}>{message}</li>)}</ul></div> : <label className="mt-3 flex cursor-pointer items-start gap-2"><input type="checkbox" checked={reviewApproved} onChange={(event) => setReviewApproved(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#d3bb73]" /><span>Sprawdziłem odbiorców, dokumenty spoza KSeF, wyciągi i opisy płatności zbiorczych. Akceptuję tę paczkę. Wewnętrzne braki pozostają do uzupełnienia w CRM.</span></label>}
            </div>}
            <button type="button" onClick={() => void downloadBundle()} disabled={sending || !review || !reviewApproved || review.blockers.length > 0} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-3 text-sm font-medium text-[#d3bb73] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"><Download className="h-4 w-4" />Pobierz sprawdzoną paczkę ZIP</button>
            <p className="mt-2 text-xs leading-5 text-gray-500">ZIP zawiera oddzielne foldery „saldeo” i „ksiegowa”. Pobranie nie wysyła plików i nie oznacza ich jako dostarczone. Nie przekazuj tej samej paczki ręcznie i ponownie przyciskiem wysyłki.</p>
            <button type="button" onClick={() => void processCompleteMonth('send')} disabled={sending || loading || Boolean(followupSaving) || blockingErrors.length > 0 || !review || !reviewApproved || review.blockers.length > 0 || saldeoAccess.state === 'checking' || saldeoAccess.state === 'error' || (pending.length > 0 && saldeoAccess.state !== 'ready')} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-3 text-sm font-medium text-[#0a0d1a] disabled:cursor-not-allowed disabled:opacity-45">{sending && !preparingReview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{sending && !preparingReview ? 'Przekazuję sprawdzony pakiet…' : '2. Wyślij sprawdzony pakiet'}</button><p className="mt-2 text-xs leading-5 text-gray-500">Wysyłamy dokładnie sprawdzone załączniki. Zmiana firmy, miesiąca, odbiorców, opisów, dopasowań lub potwierdzeń braków wymaga ponownej kontroli. Plik kontrolny służy tylko Tobie — nie jest wysyłany księgowej.</p>
            <button type="button" onClick={downloadReport} className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-300"><Download className="h-4 w-4" /> Pobierz rejestr transakcji CSV</button>
            {snapshot.latestHandoff && <p className="mt-3 text-xs leading-5 text-gray-500">Ostatnie przekazanie raportu: {new Date(snapshot.latestHandoff.delivered_at).toLocaleString('pl-PL')} → {snapshot.latestHandoff.delivered_to}.</p>}
          </div>
        </div>
      </>}
    </fieldset>
    {detailsModel && <SaldeoDocumentDetailsModal document={detailsModel} draft={noteDraft} onDraftChange={setNoteDraft} onSave={() => void saveDocumentNote()} onClose={closeDocumentDetails} saving={noteSaving} dirty={noteDirty} error={noteError} preview={preview} previewLoading={previewLoading} previewError={previewError} onPreview={() => void openDocumentPreview()} />}
    {progress && <p role="status" className="rounded-lg bg-[#d3bb73]/10 p-3 text-sm text-[#d3bb73]">{progress}</p>}
    {error && <p role="alert" className="whitespace-pre-wrap rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    {outcome && <p role="status" className="whitespace-pre-wrap rounded-lg bg-green-500/10 p-3 text-sm text-green-200">{outcome}</p>}
  </div>;
}
