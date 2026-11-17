import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NativeContext } from './auth';
import { canFinanceCompany, loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { decodeTextEntities } from '@/lib/textEncoding';
import { BANK_STATEMENT_DEDUPLICATION_COLUMNS, deduplicateStatementTransactions, type BankStatementDeduplicationMetadata } from '@/lib/bankStatementDeduplication';
import { externalDocumentKindLabel } from '@/lib/invoices/externalDocumentKinds';
import { hasKsefRegistration, saldeoDocumentExclusionReason } from '@/lib/saldeoDeliveryEligibility';
import {
  buildSaldeoControlReport, buildSaldeoCollectivePaymentCsv, buildSaldeoCollectivePaymentHtml, saldeoCollectivePayments,
  type SaldeoControlReportInput, type SaldeoControlReportFollowup, type SaldeoControlReportPayment,
} from '@/lib/saldeoControlReport';

/*
 * Przekazanie księgowej (Saldeo) dla Maca — jak `SaldeoDeliveryPanel` w CRM (Finanse → Dokumenty i rozliczenia →
 * „Dla księgowej”). Stan miesiąca (`loadSnapshot`), listy, opis dokumentu, „Do dosłania”, plik kontrolny i kontrola przed
 * wysyłką liczone tutaj tą samą logiką co w przeglądarce (kopia funkcji panelu — zmiany wprowadzaj w obu miejscach),
 * klientem pracownika (RLS). Wysyłka jak w CRM: rezerwacja (`claim_accounting_delivery`), dokumenty do Saldeo przez trasę
 * CRM `/bridge/integrations/saldeo` (PIN tylko na serwerze), wyciągi i opisy płatności zbiorczych do księgowej przez
 * `send-email`, potwierdzenie (`complete_accounting_delivery`). Załączniki sprawdzone w pliku kontrolnym trzyma aplikacja
 * i wysyła dokładnie te bajty (kopia PDF z opisem nie jest deterministyczna, więc nie liczymy jej drugi raz).
 */

class SaldeoNativeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new SaldeoNativeError(message, status);
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

type Row = Record<string, any>;
type Source = 'external_invoice' | 'local_invoice' | 'bank_supporting_document' | 'ksef' | 'personnel' | 'bank_transaction';
type SaldeoType = 'FK' | 'DS' | 'P';
type Statement = BankStatementDeduplicationMetadata & { id: string; file_name: string; file_storage_path: string | null; processed: boolean; validation_status: string };
type Bank = Row & {
  id: string; statement_id: string; amount: number; allocated_amount: number; transaction_date: string; currency: string;
  source_index?: number | null;
  source_balance_before?: number | string | null;
  source_balance_after?: number | string | null;
  source_verified?: boolean | null;
};
type Allocation = { id: string; transactionId: string; documentKey: string; amount: number; documentAmount: number | null; currency: string; description: string };
type DocumentFollowup = {
  id: string; my_company_id: string; bank_transaction_id: string; period_month: number; period_year: number;
  active: boolean; acknowledged_by: string; acknowledged_at: string; transaction_snapshot: Row; created_at: string; updated_at: string;
};
type Document = {
  key: string; source: Source; id: string; number: string; kind: string; date: string; dueDate: string;
  direction?: 'income' | 'expense' | 'unknown'; documentKind?: string;
  counterparty: string; amount: number | null; currency: string; note: string; ksefReference: string;
  bucket: string | null; path: string | null; filename: string; saldeoType: SaldeoType;
  sentAt: string | null; linkedBankId?: string; paymentStatus?: string; paymentMethod?: string;
  statementOnly?: boolean;
  noteValue?: string | null; relatedNotes?: { label: string; note: string; source?: Source; id?: string }[];
  previewFile?: { bucket: string; path: string; filename: string };
};
type Snapshot = {
  statements: Statement[]; transactions: Bank[]; allBanks: Map<string, Bank>; statementNames: Map<string, string>;
  documents: Document[]; allocations: Allocation[]; errors: string[]; describedMissing: Bank[]; unresolved: Bank[];
  excludedInvoiceCount: number; hiddenTransactionCount: number; latestHandoff: Row | null;
  followups: DocumentFollowup[]; internalWarnings: string[];
};
type Attachment = { filename: string; content: string; contentType: string; contentDisposition: 'attachment'; size: number; document?: Document };
type EditOrigin = { source: Source; id: string; original: string };
type SourceCheck = { bucket: string; path: string; filename: string; digest: string };

async function pages<T = Row>(makeQuery: () => any): Promise<T[]> {
  const result: T[] = [];
  for (let from = 0; ; from += 200) {
    const { data, error } = await makeQuery().order('id').range(from, from + 199);
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < 200) return result;
  }
}
async function byIds<T = Row>(client: SupabaseClient, table: string, fields: string, column: string, ids: string[]): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const result: T[] = [];
  for (let start = 0; start < unique.length; start += 100) result.push(...await pages<T>(() => client.from(table).select(fields).in(column, unique.slice(start, start + 100))));
  return result;
}

const validDeliveryPeriod = (month: unknown, year: unknown) => typeof month === 'number' && Number.isInteger(month) && month >= 1 && month <= 12
  && typeof year === 'number' && Number.isInteger(year) && year >= 2000 && year <= 2100;
const LABELS: Record<string, string> = {
  automatic_vat_transfer: 'Automatyczny transfer pomiędzy rachunkami bieżącym i VAT', vat7_payment: 'VAT-7 / JPK_V7',
  pit4_payment: 'PIT-4R', zus_payment: 'ZUS', payroll_payment: 'Wynagrodzenie / lista płac', bank_fee: 'Opłata bankowa',
  own_transfer: 'Przelew własny', cash_settlement: 'Rozliczenie gotówkowe', supplier_invoice_missing: 'Opisany brak dokumentu od dostawcy', other: 'Inne wyjaśnienie',
};
const SOURCE_LABELS: Record<Source, string> = { external_invoice: 'Spoza KSeF', local_invoice: 'CRM', bank_supporting_document: 'Dokument do przelewu', ksef: 'KSeF', personnel: 'Kadry', bank_transaction: 'Wyciąg bankowy — analiza CRM' };
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
const csv = (rows: unknown[][]) => '\uFEFF' + rows.map((row) => row.map((value) => {
  const raw = String(value ?? '');
  return `"${(/^[=+\-@]/.test(raw) ? `'${raw}` : raw).replace(/"/g, '""')}"`;
}).join(';')).join('\n');

function uniqueRows(rows: Row[]): Row[] { return [...new Map(rows.map((row) => [row.id, row])).values()]; }
function isStatementOnlyPayment(bank: Bank | undefined) {
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
function paymentDocuments(snapshot: Snapshot, bankId: string) {
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

async function loadSnapshot(client: SupabaseClient, companyId: string, month: number, year: number): Promise<Snapshot> {
  if (!validDeliveryPeriod(month, year)) throw new Error('Wybierz poprawny miesiąc i rok przekazania dokumentów.');
  const periodLabel = `${String(month).padStart(2, '0')}/${year}`;
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const next = new Date(Date.UTC(year, month, 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const periodRows = (table: string, dateField: string) => pages(() => client.from(table).select('*').eq('my_company_id', companyId).gte(dateField, start).lt(dateField, end));
  const [statements, periodExternal, periodCrm, periodKsef, handoffs, followups] = await Promise.all([
    pages<Statement>(() => client.from('bank_statements').select(statementFields).eq('my_company_id', companyId).eq('statement_month', month).eq('statement_year', year)),
    periodRows('external_invoices', 'invoice_date'), periodRows('invoices', 'issue_date'), periodRows('ksef_invoices', 'issue_date'),
    pages(() => client.from('accounting_month_handoffs').select('id,delivered_at,delivered_to,snapshot').eq('my_company_id', companyId).eq('period_month', month).eq('period_year', year)),
    pages<DocumentFollowup>(() => client.from('accounting_document_followups').select('id,my_company_id,bank_transaction_id,period_month,period_year,active,acknowledged_by,acknowledged_at,transaction_snapshot,created_at,updated_at').eq('my_company_id', companyId).eq('period_month', month).eq('period_year', year).eq('active', true)),
  ]);
  const errors: string[] = []; const internalWarnings: string[] = [];
  if (!statements.length) internalWarnings.push(`Brak wyciągu bankowego dla ${periodLabel}. Dokumenty można przekazać osobno; wyciąg pozostaje do uzupełnienia.`);
  const invalidStatements = statements.filter((statement) => !statement.processed || statement.validation_status !== 'valid');
  if (invalidStatements.length) internalWarnings.push(`Dla ${periodLabel} ${invalidStatements.length} wyciągów nie zakończyło poprawnie odczytu. Oryginały pozostają dostępne, ale zestawienie płatności zbiorczych może być niepełne.`);
  const missingStatements = statements.filter((statement) => !statement.file_storage_path);
  if (missingStatements.length) errors.push(`${missingStatements.length} wyciągów nie ma pliku źródłowego.`);
  const rawBanks = await byIds<Bank>(client, 'bank_transactions', bankFields, 'statement_id', statements.map((statement) => statement.id));
  const transactions = deduplicateStatementTransactions(rawBanks, new Map(statements.map((statement) => [statement.id, statement]))).sort((a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.id.localeCompare(b.id));
  if (statements.length && !transactions.length) internalWarnings.push(`Wyciągi dla ${periodLabel} nie zawierają odczytanych transakcji. Sprawdź odczyt przed uznaniem analizy miesiąca za zakończoną.`);
  const monthBankIds = transactions.map((bank) => bank.id);
  const [monthMatches, supporting, personnel] = await Promise.all([
    byIds(client, 'bank_transaction_invoice_matches', ledgerFields, 'bank_transaction_id', monthBankIds),
    byIds(client, 'bank_transaction_supporting_documents', '*', 'bank_transaction_id', monthBankIds),
    byIds(client, 'personnel_contract_payments', 'id,amount,currency,payment_type,payment_date,recipient_name,title,notes,bank_transaction_id,personnel_contracts!personnel_contract_payments_personnel_contract_id_fkey(contract_number,party_name,my_company_id)', 'bank_transaction_id', monthBankIds),
  ]);
  const [linkedExternal, linkedCrm, linkedKsef] = await Promise.all([
    byIds(client, 'external_invoices', '*', 'id', monthMatches.map((match) => match.external_invoice_id)),
    byIds(client, 'invoices', '*', 'id', monthMatches.map((match) => match.invoice_id)),
    byIds(client, 'ksef_invoices', '*', 'id', [...monthMatches.map((match) => match.ksef_invoice_id), ...transactions.map((bank) => bank.matched_invoice_id)]),
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
    byIds(client, 'ksef_invoices', '*', 'id', externalRows.map((invoice) => explicitId(invoice.ksef_invoice_id)).filter(isUuid)),
    byIds(client, 'ksef_invoices', '*', 'ksef_reference_number', externalRows.flatMap(externalKsefReferences)),
  ]);
  // Load the official document even when its issue date is outside this month, then
  // let the existing CRM alias lookup collect its linked CRM copy and allocations too.
  ksefRows = uniqueRows([...ksefRows, ...externalKsefAliasesById, ...externalKsefAliasesByReference]);
  const [crmAliases, ksefAliasesById, ksefAliasesByReference] = await Promise.all([
    byIds(client, 'invoices', '*', 'id', ksefRows.map((invoice) => invoice.invoice_id)),
    byIds(client, 'ksef_invoices', '*', 'invoice_id', crmRows.map((invoice) => invoice.id)),
    byIds(client, 'ksef_invoices', '*', 'ksef_reference_number', crmRows.map((invoice) => invoice.ksef_reference_number)),
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
    byIds(client, 'bank_transaction_invoice_matches', ledgerFields, 'invoice_id', crmRows.map((row) => row.id)),
    byIds(client, 'bank_transaction_invoice_matches', ledgerFields, 'ksef_invoice_id', ksefRows.map((row) => row.id)),
    byIds(client, 'bank_transaction_invoice_matches', ledgerFields, 'external_invoice_id', externalRows.map((row) => row.id)),
  ]);
  const allMatches = uniqueRows([...monthMatches, ...extraMatchGroups.flat()]);
  const extraBanks = await byIds<Bank>(client, 'bank_transactions', bankFields, 'id', allMatches.map((match) => match.bank_transaction_id).filter((id) => !monthBankIds.includes(id)));
  const allBanks = new Map([...transactions, ...extraBanks].map((bank) => [bank.id, bank]));
  const extraStatements = await byIds<Statement>(client, 'bank_statements', statementFields, 'id', extraBanks.map((bank) => bank.statement_id).filter((id) => !statements.some((statement) => statement.id === id)));
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
  const deliveries = await byIds(client, 'saldeo_delivery_log', 'id,source_type,source_id,delivered_at,delivered_to', 'source_id', fileDocuments.map((document) => document.id));
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
async function downloadBlob(client: SupabaseClient, bucket: string, path: string, label: string) {
  let storagePath = path;
  if (/^https?:\/\//.test(path)) {
    const url = new URL(path); const configured = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://invalid.local');
    if (url.origin !== configured.origin || !url.pathname.startsWith('/storage/v1/object/')) throw new Error(`Plik „${label}” ma zewnętrzny adres. Zapisz jego oryginał w CRM przed wysyłką.`);
    const parts = url.pathname.slice('/storage/v1/object/'.length).split('/');
    if (['public', 'sign', 'authenticated'].includes(parts[0])) parts.shift();
    if (parts.shift() !== bucket) throw new Error(`Nieprawidłowy magazyn pliku „${label}”.`);
    storagePath = decodeURIComponent(parts.join('/'));
  }
  const { data, error } = await client.storage.from(bucket).download(storagePath);
  if (error || !data || !data.size) throw new Error(`Nie można odczytać pliku „${label}”. Przygotowanie przerwane przed wysyłką.`);
  return data;
}
function chunks(attachments: Attachment[], maxBytes: number, maxFiles: number) {
  const groups: Attachment[][] = []; let group: Attachment[] = []; let size = 0;
  for (const item of attachments) {
    if (item.size > maxBytes) throw new Error(`Plik „${item.filename}” przekracza bezpieczny rozmiar pojedynczej wiadomości (${Math.round(maxBytes / 1024 / 1024)} MB). Zmniejsz plik przed przekazaniem.`);
    if (group.length && (group.length >= maxFiles || size + item.size > maxBytes)) { groups.push(group); group = []; size = 0; }
    group.push(item); size += item.size;
  }
  if (group.length) groups.push(group); return groups;
}

// MARK: Pliki i skróty (jak w panelu; skróty SHA-256 z `node:crypto` zamiast Web Crypto — te same bajty, ten sam wynik)
async function base64(blob: Blob) { return Buffer.from(await blob.arrayBuffer()).toString('base64'); }
async function sha256(value: string) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
async function blobDigest(blob: Blob) { return createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'); }
async function attachmentDigest(file: Attachment) { return createHash('sha256').update(Buffer.from(file.content, 'base64')).digest('hex'); }
async function attachment(blob: Blob, filename: string, document?: Document): Promise<Attachment> { return { filename, content: await base64(blob), contentType: blob.type || 'application/octet-stream', contentDisposition: 'attachment', size: blob.size, document }; }
const isBlob = (value: unknown): value is Blob => Boolean(value) && typeof (value as Blob).arrayBuffer === 'function'
  && typeof (value as Blob).size === 'number' && typeof (value as Blob).type === 'string';

/** Kopia PDF z istniejącym opisem — jak `annotateSaldeoDocument` (funkcja `annotate-saldeo-document` z tokenem pracownika). */
async function annotateSaldeoDocument(client: SupabaseClient, { original, filename, ...annotation }: {
  original: Blob; filename: string; companyId: string; companyName: string; period: string;
  documentNumber: string; documentKind: string; accountingNote: string; payments: unknown[];
}): Promise<{ blob: Blob; filename: string }> {
  if (!original.size) throw new Error(`Plik ${filename} jest pusty.`);
  if (!annotation.accountingNote?.trim() && !annotation.payments?.length) {
    return { blob: original, filename };
  }
  if (original.size > 12 * 1024 * 1024) {
    throw new Error(`Plik ${filename} przekracza limit 12 MB przygotowania kopii z opisem. Nie został wysłany.`);
  }
  const body = new FormData();
  body.append('file', original, filename);
  body.append('annotation', JSON.stringify(annotation));
  const { data, error } = await client.functions.invoke('annotate-saldeo-document', { body });
  if (error) {
    let message = error.message;
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      try {
        const details = await response.json();
        message = details.error || message;
      } catch { /* Bez odpowiedzi JSON zostaje komunikat transportu. */ }
    }
    throw new Error(`Nie przygotowano dokumentu ${filename}: ${message}`);
  }
  if (!isBlob(data) || !data.size || !data.type.includes('application/pdf')) {
    throw new Error(`Nie otrzymano poprawnej kopii PDF dokumentu ${filename}. Wysyłka została zatrzymana.`);
  }
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[\r\n/\\]/g, '_') || 'dokument';
  return { blob: data, filename: `${stem}-opis-CRM.pdf` };
}

// MARK: Dostęp, działalności, konta nadawcze

/** PIN Saldeo tylko na serwerze — ta sama reguła co w trasie `/bridge/integrations/saldeo`. */
function serverPin() {
  const pin = process.env.PIN_SALDEO?.trim() || '';
  return /^[^\s()\r\n]{4,64}$/.test(pin) ? pin : null;
}
const isSaldeoAdmin = (ctx: NativeContext) => ctx.employee.role === 'admin' || ctx.employee.accessLevel === 'admin';

/** Jak `authorize` w trasie Saldeo: aktywny administrator CRM, zarządzanie finansami, widoczna firma, nie portal sprzedawcy. */
async function authorizeSaldeo(ctx: NativeContext, companyId: string) {
  if (!isSaldeoAdmin(ctx)) fail('Automatyczna autoryzacja Saldeo jest dostępna tylko dla aktywnego administratora CRM.', 403);
  const [manage, company, portal] = await Promise.all([
    ctx.supabase.rpc('finance_can_manage'),
    ctx.supabase.rpc('finance_company_visible', { p_company_id: companyId }),
    ctx.supabase.rpc('current_session_is_seller_portal'),
  ]);
  if (manage.error || company.error || portal.error || manage.data !== true || company.data !== true || portal.data !== false) {
    fail('Nie masz uprawnień do wysyłki dokumentów tej firmy.', 403);
  }
}

async function requireAccess(ctx: NativeContext, companyId: string, level: 'finance_view' | 'finance_manage') {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  if (!canFinanceCompany(access, companyId, level)) {
    fail(level === 'finance_view' ? 'Brak dostępu do finansów tej działalności.' : 'Ta czynność wymaga „Zarządzania finansami” w tej działalności.', 403);
  }
  return access;
}

/** Konta nadawcze jak `loadUnifiedEmailAccounts` (własne i przypisane z prawem wysyłki, bez systemowych). */
async function emailAccounts(ctx: NativeContext): Promise<Row[]> {
  const fields = 'id,email_address,from_name,account_name,account_type,is_default';
  const [personal, assignments] = await Promise.all([
    ctx.supabase.from('employee_email_accounts').select(fields).eq('employee_id', ctx.employee.id).eq('is_active', true)
      .or('account_type.is.null,account_type.neq.system'),
    ctx.supabase.from('employee_email_account_assignments').select('email_account_id').eq('employee_id', ctx.employee.id).eq('can_send', true),
  ]);
  if (personal.error || assignments.error) fail('Nie można pobrać kont pocztowych CRM.', 500);
  const assignedIds = ((assignments.data || []) as Row[]).map((row) => str(row.email_account_id)).filter(Boolean);
  let assigned: Row[] = [];
  if (assignedIds.length) {
    const result = await ctx.supabase.from('employee_email_accounts').select(fields).in('id', assignedIds).eq('is_active', true)
      .or('account_type.is.null,account_type.neq.system');
    if (result.error) fail('Nie można pobrać kont pocztowych CRM.', 500);
    assigned = (result.data || []) as Row[];
  }
  return Array.from(new Map([...((personal.data || []) as Row[]), ...assigned].map((account) => [str(account.id), account])).values())
    .sort((left, right) => {
      if (Boolean(left.is_default) !== Boolean(right.is_default)) return left.is_default ? -1 : 1;
      const leftPersonal = (left.account_type || 'personal') === 'personal';
      const rightPersonal = (right.account_type || 'personal') === 'personal';
      if (leftPersonal !== rightPersonal) return leftPersonal ? -1 : 1;
      return str(left.email_address).localeCompare(str(right.email_address), 'pl');
    });
}

async function companyRow(ctx: NativeContext, companyId: string): Promise<Row> {
  const { data, error } = await ctx.supabase.from('my_companies').select('id,name,saldeo_document_email,accountant_email').eq('id', companyId).maybeSingle();
  if (error || !data) fail('Nie można odczytać działalności.', 404);
  return data as Row;
}

function target(source: Record<string, unknown>) {
  const companyId = str(source.company).trim();
  if (!UUID.test(companyId)) fail('Wybierz działalność.');
  const month = Number(source.month);
  const year = Number(source.year);
  if (!validDeliveryPeriod(month, year)) fail('Wybierz poprawny miesiąc i rok przekazania dokumentów.');
  return { companyId, month, year };
}

function settingsErrors(emailAccountId: string, senderAddress: string, saldeoEmail: string, accountantEmail: string) {
  const errors: string[] = [];
  if (!emailAccountId || !senderAddress) errors.push('Wybierz konto nadawcze CRM.');
  if (!/^[^\s@]+@dok\.saldeo\.pl$/i.test(saldeoEmail.trim())) errors.push('Podaj dedykowany adres firmy w domenie @dok.saldeo.pl.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountantEmail.trim()) || /@dok\.saldeo\.pl$/i.test(accountantEmail.trim())) {
    errors.push('Podaj zwykły adres e-mail księgowej, nie adres dokumentów Saldeo.');
  }
  return errors;
}

/** Pozycja miesiąca po kluczu: dokument (`źródło:id`) albo płatność z wyciągu (`bank_transaction:id`). */
function findItem(snapshot: Snapshot, key: string): Document | undefined {
  if (key.startsWith('bank_transaction:')) {
    const bank = snapshot.allBanks.get(key.slice('bank_transaction:'.length));
    return bank ? paymentItem(snapshot, bank) : undefined;
  }
  return snapshot.documents.find((item) => item.key === key);
}

// MARK: Odczyt

/** Działalności (z NIP i „Podglądem finansów”) z adresami wysyłki oraz konta nadawcze pracownika. */
export async function saldeoSetup(ctx: NativeContext) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const [rows, accounts] = await Promise.all([
    pages<Row>(() => ctx.supabase.from('my_companies').select('id,name,nip,is_default,saldeo_document_email,accountant_email').eq('is_active', true)),
    emailAccounts(ctx),
  ]);
  const companies = rows
    .filter((row) => str(row.nip).trim() !== '' && canFinanceCompany(access, str(row.id), 'finance_view'))
    .sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)) || str(a.name).localeCompare(str(b.name)))
    .map((row) => ({
      id: str(row.id), name: str(row.name), isDefault: row.is_default === true,
      saldeoEmail: str(row.saldeo_document_email), accountantEmail: str(row.accountant_email),
      canManage: canFinanceCompany(access, str(row.id), 'finance_manage'),
    }));
  return {
    companies,
    accounts: accounts.map((account) => ({ id: str(account.id), email: str(account.email_address) })),
    isSaldeoAdmin: isSaldeoAdmin(ctx),
  };
}

/** Stan konfiguracji PIN-u jak „Automatyczny PIN Saldeo” (GET trasy Saldeo) — bez zwracania PIN-u. */
export async function saldeoPin(ctx: NativeContext, companyParam: unknown) {
  const companyId = str(companyParam).trim();
  if (!UUID.test(companyId)) fail('Wybierz firmę przed sprawdzeniem konfiguracji Saldeo.');
  await authorizeSaldeo(ctx, companyId);
  return { configured: Boolean(serverPin()) };
}

/** Miesiąc działalności: kafle, dokumenty spoza KSeF, płatności zbiorcze, braki i „Do dosłania”, blokady. */
export async function saldeoMonth(ctx: NativeContext, query: Record<string, unknown>) {
  const { companyId, month, year } = target(query);
  const access = await requireAccess(ctx, companyId, 'finance_view');
  const snapshot = await loadSnapshot(ctx.supabase, companyId, month, year);
  const fileDocuments = reviewDocuments(snapshot).filter((document) => document.bucket);
  const collective = collectivePaymentDetails(snapshot);
  const unlinked = snapshot.transactions.filter((bank) => !isStatementOnlyPayment(bank) && !bankHasDocumentLink(snapshot, bank));
  return {
    companyId, month, year,
    canManage: canFinanceCompany(access, companyId, 'finance_manage'),
    counts: {
      pending: fileDocuments.filter((document) => !document.sentAt).length,
      sent: fileDocuments.filter((document) => document.sentAt).length,
      statements: snapshot.statements.length,
      collective: collective.length,
      ksef: snapshot.documents.filter((document) => document.source === 'ksef' || document.ksefReference).length,
      statementOnly: snapshot.transactions.filter(isStatementOnlyPayment).length,
      excluded: snapshot.excludedInvoiceCount,
      hidden: snapshot.hiddenTransactionCount,
    },
    documents: reviewDocuments(snapshot).map((item) => {
      const hasLink = documentHasPaymentLink(snapshot, item);
      const origin = existingNoteOrigin(snapshot, item);
      const bankIds = new Set(snapshot.allocations.filter((allocation) => allocation.documentKey === item.key).map((allocation) => allocation.transactionId));
      if (item.linkedBankId && hasLink) bankIds.add(item.linkedBankId);
      if (item.source === 'ksef') for (const bank of snapshot.allBanks.values()) if (bank.matched_invoice_id === item.id) bankIds.add(bank.id);
      return {
        key: item.key, source: item.source, sourceLabel: SOURCE_LABELS[item.source], number: item.number, kind: item.kind,
        counterparty: item.counterparty, date: item.date, amount: item.amount, currency: item.currency,
        state: item.sentAt ? 'sent' : item.bucket ? 'saldeo' : 'report', sentAt: item.sentAt,
        hasLink, note: reviewNote(snapshot, item), editable: Boolean(origin) && !hasLink,
        links: [...bankIds].flatMap((id) => {
          const bank = snapshot.allBanks.get(id);
          if (!bank) return [];
          const group = paymentDocuments(snapshot, id);
          const assigned = snapshot.allocations.filter((allocation) => allocation.transactionId === id && allocation.documentKey === item.key)
            .reduce((sum, allocation) => sum + allocation.amount, 0);
          return [{
            bankId: id, date: bank.transaction_date, amount: Math.abs(Number(bank.amount)), currency: bank.currency, assigned,
            reference: str(bank.reference_number), group: group.length > 1 ? group.map((entry) => entry.number) : [],
          }];
        }),
      };
    }),
    collective: collective.map((payment) => ({
      id: str(payment.id), date: payment.date, amount: payment.bankAmount, currency: payment.bankCurrency, counterparty: payment.counterparty,
      reference: payment.reference, statementName: payment.statementName,
      documents: (payment.linkedDocuments || []).map((document) => ({
        key: str(document.key || document.number), number: document.number, counterparty: document.counterparty, allocated: document.allocatedAmount,
      })),
    })),
    unlinked: unlinked.map((bank) => ({
      id: bank.id, key: `bank_transaction:${bank.id}`, date: bank.transaction_date, credit: bank.transaction_type === 'credit',
      amount: Math.abs(Number(bank.amount)), currency: bank.currency, counterparty: str(bank.counterparty_name), status: status(bank),
      reference: str(bank.reference_number), note: str(bank.accounting_note),
      canAcknowledge: canAcknowledgeMissingDocument(snapshot, bank),
      acknowledged: hasMissingDocumentAcknowledgment(snapshot, bank),
      staleAcknowledgment: snapshot.followups.some((item) => item.active && item.bank_transaction_id === bank.id) && !hasMissingDocumentAcknowledgment(snapshot, bank),
      expected: followupSnapshot(bank),
    })),
    followups: documentFollowupRows(snapshot).map((item) => ({
      id: item.id, bankId: item.bankId, reference: item.reference, date: item.date, amount: item.amount, currency: item.currency,
      counterparty: item.counterparty, note: item.note, acknowledgedAt: item.acknowledgedAt, status: item.status,
    })),
    blockers: deliveryBlockers(snapshot),
    warnings: snapshot.internalWarnings,
    latestHandoff: snapshot.latestHandoff
      ? { deliveredAt: str(snapshot.latestHandoff.delivered_at), deliveredTo: str(snapshot.latestHandoff.delivered_to) }
      : null,
  };
}

/** Szczegóły dokumentu lub płatności jak `SaldeoDocumentDetailsModal` (świeże dane, bez zakładania nowego opisu). */
export async function saldeoDetails(ctx: NativeContext, query: Record<string, unknown>) {
  const { companyId, month, year } = target(query);
  const access = await requireAccess(ctx, companyId, 'finance_view');
  const snapshot = await loadSnapshot(ctx.supabase, companyId, month, year);
  const details = findItem(snapshot, str(query.key));
  if (!details) fail('Pozycja nie jest już dostępna w tym miesiącu. Odśwież listę.', 404);
  if (details.statementOnly) fail('Ta operacja jest wykazywana wyłącznie na wyciągu i w rejestrze. Nie wymaga osobnego dokumentu ani edycji opisu w kontroli Saldeo. Odśwież listę.');
  const origin = existingNoteOrigin(snapshot, details);
  const relations = snapshot.allocations.filter((allocation) => allocation.documentKey === details.key);
  const payment = (bank: Bank, allocation?: Allocation) => ({
    id: allocation?.id || bank.id, date: bank.transaction_date, postingDate: bank.posting_date || '', reference: bank.reference_number || '',
    counterparty: bank.counterparty_name || '', title: bank.title || bank.raw_description || '', currency: bank.currency, documentCurrency: allocation?.currency || details.currency,
    statementName: snapshot.statementNames.get(bank.statement_id) || '', note: bank.accounting_note || '', direction: bank.transaction_type === 'credit' ? 'Wpływ' : 'Wydatek',
    amount: Math.abs(Number(bank.amount)), allocatedAmount: allocation?.amount ?? null, documentAmount: allocation?.documentAmount ?? null,
    collective: paymentDocuments(snapshot, bank.id).length > 1 || Number(bank.matched_document_count) > 1,
    linkedDocuments: paymentDocuments(snapshot, bank.id).map((entry) => ({
      key: entry.key, number: entry.number, counterparty: entry.counterparty, allocatedAmount: entry.allocatedAmount,
      documentAmount: entry.documentAmount, currency: entry.currency,
    })),
  });
  const payments = relations.flatMap((allocation) => { const bank = snapshot.allBanks.get(allocation.transactionId); return bank ? [payment(bank, allocation)] : []; });
  if (details.source === 'ksef') for (const bank of snapshot.allBanks.values()) {
    if (bank.matched_invoice_id === details.id && !relations.some((allocation) => allocation.transactionId === bank.id)) payments.push(payment(bank));
  }
  if (details.linkedBankId && !payments.length) { const bank = snapshot.allBanks.get(details.linkedBankId); if (bank) payments.push(payment(bank)); }
  const hasPaymentLink = documentHasPaymentLink(snapshot, details);
  const canEditNote = !hasPaymentLink && Boolean(origin?.original.trim());
  const hasPreview = Boolean(details.previewFile || (details.bucket && details.path));
  return {
    key: details.key, number: details.number, kind: details.kind, sourceLabel: SOURCE_LABELS[details.source], date: details.date, dueDate: details.dueDate,
    entryType: details.source === 'bank_transaction' ? 'payment' : 'document', hasPaymentLink,
    canEditNote, canManage: canFinanceCompany(access, companyId, 'finance_manage'),
    origin: canEditNote && origin ? { source: origin.source, id: origin.id, original: origin.original } : null,
    counterparty: details.counterparty, amount: details.amount, currency: details.currency, ksefReference: details.ksefReference,
    note: reviewNote(snapshot, details), relatedNotes: hasPaymentLink ? [] : (details.relatedNotes || []).map((item) => ({ label: item.label, note: item.note })),
    payments,
    hasPreview,
    previewMissing: hasPreview ? null : details.source === 'ksef'
      ? 'W CRM nie zapisano kopii PDF tej faktury KSeF. Poniżej dostępne są jej dane i płatności; podgląd nie pobiera faktury ponownie ani nie zmienia jej statusu.'
      : 'Ten rekord nie ma dołączonego pliku do podglądu. Dane dokumentu i zapisane płatności są dostępne w tym oknie.',
    disposition: details.source === 'bank_transaction' ? 'Informacja wewnętrzna CRM — nie jest dokumentem do wysłania do Saldeo.'
      : details.sentAt ? 'Plik wysłano wcześniej — nie ponawiamy wysyłki. Poprawiony opis pozostaje w CRM.'
      : details.bucket ? 'Do Saldeo: dokument spoza KSeF. Opis płatności zbiorczej, jeśli dotyczy, jest osobnym załącznikiem do wyciągów.'
      : 'Pozostaje w CRM — bez osobnej wysyłki do Saldeo.',
  };
}

/** Podgląd pliku pozycji (dokument, kopia CRM / spoza KSeF, wyciąg płatności) — jak „Podgląd” w szczegółach. */
export async function saldeoFile(ctx: NativeContext, query: Record<string, unknown>) {
  const { companyId, month, year } = target(query);
  await requireAccess(ctx, companyId, 'finance_view');
  const snapshot = await loadSnapshot(ctx.supabase, companyId, month, year);
  const details = findItem(snapshot, str(query.key));
  if (!details) fail('Pozycja nie jest już dostępna w tym miesiącu. Odśwież listę.', 404);
  const file = details.previewFile || (details.bucket && details.path ? { bucket: details.bucket, path: details.path, filename: details.filename } : null);
  if (!file) {
    fail(details.source === 'ksef'
      ? 'W CRM nie zapisano kopii PDF tej faktury KSeF. Poniżej dostępne są jej dane i płatności; podgląd nie pobiera faktury ponownie ani nie zmienia jej statusu.'
      : 'Ten rekord nie ma dołączonego pliku do podglądu. Dane dokumentu i zapisane płatności są dostępne w tym oknie.');
  }
  const original = await downloadBlob(ctx.supabase, file.bucket, file.path, file.filename);
  const bytes = Buffer.from(await original.arrayBuffer());
  const prefix = bytes.subarray(0, 1024);
  const text = prefix.toString('latin1');
  const mime = text.includes('%PDF-') ? 'application/pdf'
    : prefix[0] === 137 && prefix[1] === 80 && prefix[2] === 78 && prefix[3] === 71 ? 'image/png'
    : prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255 ? 'image/jpeg'
    : text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP' ? 'image/webp' : 'application/octet-stream';
  return { kind: 'file', name: file.filename, mime, data: bytes.toString('base64') };
}

/** „Pobierz rejestr transakcji CSV” i „Pobierz listę” (dokumenty do dosłania) — te same kolumny co w CRM. */
export async function saldeoCsv(ctx: NativeContext, query: Record<string, unknown>) {
  const { companyId, month, year } = target(query);
  await requireAccess(ctx, companyId, 'finance_view');
  const snapshot = await loadSnapshot(ctx.supabase, companyId, month, year);
  const slug = `${year}-${String(month).padStart(2, '0')}`;
  if (query.kind === 'followups') return { filename: `dokumenty-do-doslania-${slug}.csv`, content: reports(snapshot).followups };
  return { filename: `uzgodnienie-${slug}.csv`, content: reports(snapshot).reconciliation };
}

// MARK: Zmiany

/** Poprawa istniejącego opisu niepowiązanej pozycji — jak `saveDocumentNote` (zapis tylko, gdy opis i powiązania się nie zmieniły). */
export async function saldeoNote(ctx: NativeContext, body: Record<string, unknown>) {
  const { companyId, month, year } = target(body);
  const note = str(body.note).trim();
  const targetOrigin: EditOrigin = { source: str(body.originSource) as Source, id: str(body.originId), original: str(body.original) };
  if (!targetOrigin.original.trim() || !note) fail('Tutaj można tylko poprawić istniejący opis. Nie można dodać nowego ani usunąć wyjaśnienia z analizy.');
  if (note.length > 20000) fail('Opis może mieć maksymalnie 20 000 znaków. Skróć go przed zapisem.');
  if (note === targetOrigin.original.trim()) return { ok: true, message: 'Opis bez zmian.' };
  const [manage, visible, personnel] = await Promise.all([
    ctx.supabase.rpc('finance_can_manage'), ctx.supabase.rpc('finance_company_visible', { p_company_id: companyId }),
    targetOrigin.source === 'personnel' ? ctx.supabase.rpc('can_manage_personnel_contracts') : Promise.resolve({ data: true, error: null }),
  ]);
  if (manage.error || manage.data !== true || visible.error || visible.data !== true || personnel.error || personnel.data !== true) {
    fail('Brak uprawnień do edycji opisu tego dokumentu.', 403);
  }
  const fresh = await loadSnapshot(ctx.supabase, companyId, month, year);
  const current = findItem(fresh, str(body.key));
  if (!current || current.statementOnly || documentHasPaymentLink(fresh, current)) {
    fail('Pozycja ma już powiązanie albo jest operacją wykazywaną tylko na wyciągu. W kontroli Saldeo nie można edytować jej opisu. Zamknij okno i odśwież szczegóły.', 409);
  }
  const currentOrigin = existingNoteOrigin(fresh, current);
  if (!currentOrigin || currentOrigin.id !== targetOrigin.id || currentOrigin.source !== targetOrigin.source || currentOrigin.original !== targetOrigin.original) {
    fail('Opis z analizy zmienił się w międzyczasie. Skopiuj swoją treść i otwórz szczegóły ponownie — niczego nie nadpisano.', 409);
  }
  const { table, field } = noteTarget(currentOrigin.source);
  let query = ctx.supabase.from(table).update({ [field]: note }).eq('id', currentOrigin.id).eq(field, currentOrigin.original);
  if (['ksef', 'local_invoice', 'external_invoice'].includes(currentOrigin.source)) query = query.eq('my_company_id', companyId);
  if (currentOrigin.source === 'bank_transaction') {
    const bank = fresh.allBanks.get(currentOrigin.id)!;
    query = query.is('matched_invoice_id', null);
    query = bank.matched_document_count == null ? query.is('matched_document_count', null) : query.eq('matched_document_count', bank.matched_document_count);
    query = bank.allocated_amount == null ? query.is('allocated_amount', null) : query.eq('allocated_amount', bank.allocated_amount);
    query = bank.accounting_category == null ? query.is('accounting_category', null) : query.eq('accounting_category', bank.accounting_category);
    query = bank.accounting_subtype == null ? query.is('accounting_subtype', null) : query.eq('accounting_subtype', bank.accounting_subtype);
  }
  const { data, error } = await query.select('id');
  if (error) fail('Nie udało się potwierdzić zapisu opisu. Twoja treść pozostaje w edytorze; sprawdź zapis przed ponowieniem.', 500);
  if (data?.length !== 1) fail('Opis zmienił się w międzyczasie lub utracono dostęp. Skopiuj swoją treść i otwórz dokument ponownie — niczego nie nadpisano.', 409);
  return { ok: true, message: 'Istniejący opis z analizy został poprawiony w CRM. Kwoty i powiązania pozostały bez zmian. Przed wysyłką do Saldeo przygotuj nowy plik kontrolny.' };
}

/** Świadomy brak dokumentu („Do dosłania”) albo usunięcie z listy — jak `updateDocumentFollowup`. */
export async function saldeoFollowup(ctx: NativeContext, body: Record<string, unknown>) {
  const { companyId, month, year } = target(body);
  const bankId = str(body.bankId).trim();
  if (!UUID.test(bankId)) fail('Nieprawidłowa płatność.');
  const acknowledged = body.acknowledged === true;
  let expected: Record<string, unknown> | null = null;
  if (acknowledged) {
    const fresh = await loadSnapshot(ctx.supabase, companyId, month, year);
    const bank = fresh.allBanks.get(bankId);
    if (!bank || !canAcknowledgeMissingDocument(fresh, bank)) fail('Tej płatności nie można już oznaczyć jako brak dokumentu. Odśwież listę.', 409);
    // Potwierdzamy stan, który pracownik widział (jak w CRM — migawka z listy); różnicę wychwyci baza.
    const shown = body.expected && typeof body.expected === 'object' && !Array.isArray(body.expected) ? body.expected as Row : null;
    if (!shown) fail('Brak danych potwierdzanej płatności. Odśwież listę.');
    expected = followupSnapshot(shown);
  }
  const { error } = await ctx.supabase.rpc('acknowledge_accounting_document_followup', {
    p_bank_transaction_id: bankId, p_acknowledged: acknowledged, p_expected_snapshot: expected,
  });
  if (error) fail(error.message || 'Nie udało się zapisać potwierdzenia braku. Odśwież listę przed ponowieniem.', 409);
  return {
    ok: true,
    message: acknowledged
      ? 'Brak dokumentu zapisany na liście „Do dosłania”. Możesz przekazać pozostałe dokumenty po przygotowaniu nowego pliku kontrolnego. Wydatek nie został dopasowany ani rozliczony.'
      : 'Pozycja usunięta z listy „Do dosłania”. Stan płatności i jej opis nie zostały zmienione.',
  };
}

// MARK: Plik kontrolny i wysyłka

type DeliverySettings = { emailAccountId: string; senderAddress: string; saldeoEmail: string; accountantEmail: string; companyName: string };

async function deliverySettings(ctx: NativeContext, companyId: string, body: Record<string, unknown>): Promise<DeliverySettings> {
  const [company, accounts] = await Promise.all([companyRow(ctx, companyId), emailAccounts(ctx)]);
  const emailAccountId = str(body.emailAccountId).trim();
  return {
    emailAccountId,
    senderAddress: str(accounts.find((account) => str(account.id) === emailAccountId)?.email_address),
    saldeoEmail: str(body.saldeoEmail), accountantEmail: str(body.accountantEmail),
    companyName: str(company.name) || 'Działalność',
  };
}

/**
 * „1. Pobierz plik kontrolny” — wszystkie pobrania, kopie z opisem, limity i treść raportu przed pierwszą wiadomością
 * (jak `processCompleteMonth('review')`). Zwraca plik kontrolny i dokładne załączniki, które aplikacja wyśle po akceptacji.
 */
export async function saldeoReview(ctx: NativeContext, body: Record<string, unknown>) {
  const { companyId, month, year } = target(body);
  await authorizeSaldeo(ctx, companyId);
  const pinConfigured = Boolean(serverPin());
  const fresh = await loadSnapshot(ctx.supabase, companyId, month, year);
  const { emailAccountId, senderAddress, saldeoEmail, accountantEmail, companyName } = await deliverySettings(ctx, companyId, body);
  const fingerprint = await controlFingerprint(fresh, { companyId, companyName, month, year, emailAccountId, sender: senderAddress,
    saldeoRecipient: saldeoEmail.trim(), accountantRecipient: accountantEmail.trim() });
  const currentBlockers = deliveryBlockers(fresh);
  const toSend = reviewDocuments(fresh).filter((document) => document.bucket && !document.sentAt);
  const period = `${String(month).padStart(2, '0')}/${year}`; const slug = `${year}-${String(month).padStart(2, '0')}`;
  const blockers = [...currentBlockers, ...settingsErrors(emailAccountId, senderAddress, saldeoEmail, accountantEmail)]; const sourceChecks: SourceCheck[] = [];
  if (toSend.length && !pinConfigured) blockers.push('Brak poprawnego PIN_SALDEO w konfiguracji serwera. Przed wysyłką uzupełnij go i przygotuj nową kontrolę.');
  const prepared: Attachment[] = [];
  for (const source of toSend) {
    try {
      if (!source.path) throw new Error('Brak pliku źródłowego.');
      const original = await downloadBlob(ctx.supabase, source.bucket!, source.path!, source.number);
      sourceChecks.push({ bucket: source.bucket!, path: source.path, filename: source.filename, digest: await blobDigest(original) });
      const note = reviewNote(fresh, source);
      const result = note.trim()
        ? await annotateSaldeoDocument(ctx.supabase, { original, filename: source.filename, companyId, companyName, period, documentNumber: source.number, documentKind: source.kind, accountingNote: note, payments: [] })
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
  for (const statement of fresh.statements) {
    try {
      if (!statement.file_storage_path) throw new Error('Brak pliku źródłowego wyciągu.');
      const file = await downloadBlob(ctx.supabase, 'bank-statements', statement.file_storage_path!, statement.file_name);
      const result = await attachment(file, statement.file_name); accountantAttachments.push(result);
      sourceChecks.push({ bucket: 'bank-statements', path: statement.file_storage_path, filename: statement.file_name, digest: await blobDigest(file) });
      statementDigests.push(await sha256(`${statement.id}:${result.content}`));
    } catch (cause: any) { blockers.push(`${statement.file_name}: ${cause?.message || 'Nie można przygotować wyciągu.'}`); }
  }
  // Wszystkie pobrania, adnotacje, limity i treść raportu są gotowe PRZED pierwszą wiadomością.
  let batches: { type: SaldeoType; items: Attachment[] }[] = [];
  try { batches = (['FK', 'DS', 'P'] as SaldeoType[]).flatMap((type) => chunks(prepared.filter((item) => item.document!.saldeoType === type), 7 * 1024 * 1024, 10).map((items) => ({ type, items }))); }
  catch (cause: any) { blockers.push(cause?.message || 'Nie można przygotować paczek dokumentów.'); }
  const accountantBytes = accountantAttachments.reduce((sum, item) => sum + item.size, 0);
  if (accountantBytes > 18 * 1024 * 1024) blockers.push('Raporty i oryginalne wyciągi przekraczają 18 MB. Zmniejsz pliki wyciągów przed przekazaniem.');
  const reportHash = await sha256(JSON.stringify({ version: 6, companyId, period, collectivePayments: groupedCsv, statements: statementDigests }));
  const reportKey = `report:${reportHash}`;
  const unresolvedKeys = [...toSend.map((source) => `file:${source.key}`), reportKey];
  let earlierAttempts: Row[] = [];
  try {
    earlierAttempts = await byIds(ctx.supabase, 'accounting_delivery_attempts', 'id,delivery_key,status,my_company_id,recipient', 'delivery_key', unresolvedKeys);
    if (earlierAttempts.some((attempt) => attempt.my_company_id === companyId && attempt.status !== 'sent')) blockers.push('Istnieje przerwana wysyłka o niepotwierdzonym wyniku. Najpierw sprawdź pocztę i odbiór w Saldeo; nie ponawiamy jej automatycznie.');
  } catch { blockers.push('Nie można odczytać historii prób wysyłki. Przygotowany plan wymaga ponownej kontroli przed przekazaniem.'); }
  const reportAlreadySent = earlierAttempts.some((attempt) => attempt.my_company_id === companyId && attempt.delivery_key === reportKey && attempt.status === 'sent' && String(attempt.recipient).toLowerCase() === accountantEmail.trim().toLowerCase());
  const controlFiles: SaldeoControlReportInput['files'] = [];
  const digests = new Map<Attachment, string>();
  for (const file of [...prepared, ...accountantAttachments]) {
    const digest = await attachmentDigest(file); digests.set(file, digest);
    controlFiles.push({ recipient: file.document ? 'saldeo' : 'accountant', filename: file.filename,
      contentType: file.contentType, size: file.size, content: file.content, sha256: digest,
      description: file.document ? `${file.document.number} — dokument spoza KSeF${reviewNote(fresh, file.document).trim() ? ' z istniejącym opisem' : ' bez dodatkowej adnotacji'}` : 'Oryginalny wyciąg lub opis wyłącznie płatności zbiorczych',
      disposition: !file.document && reportAlreadySent ? 'already_sent' : 'send' });
  }
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
  const uniqueBlockers = [...new Set(blockers)];
  const reportHtml = buildSaldeoControlReport({ companyName, period, createdAt, revision, sender: senderAddress, saldeoRecipient: saldeoEmail.trim(), accountantRecipient: accountantEmail.trim(),
    blockers: uniqueBlockers, warnings, files: controlFiles, followups: documentFollowupRows(fresh), excludedInvoiceCount: fresh.excludedInvoiceCount, hiddenTransactionCount: fresh.hiddenTransactionCount,
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
  return {
    message: uniqueBlockers.length
      ? 'Przygotowano plik kontrolny z listą blokad. Możesz przejrzeć plan i dostępne załączniki; wysyłka pozostaje zablokowana. Niczego nie wysłano.'
      : 'Przygotowano plik kontrolny. Otwórz go, sprawdź opisy i gotowe załączniki, a następnie potwierdź kontrolę tutaj. Niczego nie wysłano.',
    review: {
      fingerprint, revision, createdAt, html: reportHtml, filename: controlFilename, blockers: uniqueBlockers, reportHash, reportAlreadySent,
      emailAccountId, sender: senderAddress, saldeoEmail: saldeoEmail.trim(), accountantEmail: accountantEmail.trim(),
      sourceChecks,
      prepared: prepared.map((file) => ({
        key: file.document!.key, source: file.document!.source, sourceId: file.document!.id, number: file.document!.number, saldeoType: file.document!.saldeoType,
        filename: file.filename, contentType: file.contentType, size: file.size, content: file.content, sha256: digests.get(file)!,
      })),
      accountant: accountantAttachments.map((file) => ({ filename: file.filename, contentType: file.contentType, size: file.size, content: file.content })),
      batches: batches.map((batch) => ({ type: batch.type, keys: batch.items.map((item) => item.document!.key) })),
    },
  };
}

/**
 * Kontrola tuż przed wysyłką (jak początek `processCompleteMonth('send')`): te same dane co w pliku kontrolnym, niezmienione
 * pliki źródłowe, brak przerwanych wysyłek; zapis adresów w działalności. Zwraca rezerwację raportu dla księgowej.
 */
export async function saldeoSendCheck(ctx: NativeContext, body: Record<string, unknown>) {
  const { companyId, month, year } = target(body);
  await authorizeSaldeo(ctx, companyId);
  const pinConfigured = Boolean(serverPin());
  const revision = str(body.revision); const reportHash = str(body.reportHash); const createdAt = str(body.createdAt);
  if (!SHA256.test(revision) || !SHA256.test(reportHash) || !createdAt) fail('Najpierw pobierz plik kontrolny, usuń wskazane blokady i potwierdź sprawdzenie pakietu.');
  const fresh = await loadSnapshot(ctx.supabase, companyId, month, year);
  const { emailAccountId, senderAddress, saldeoEmail, accountantEmail, companyName } = await deliverySettings(ctx, companyId, body);
  const errors = settingsErrors(emailAccountId, senderAddress, saldeoEmail, accountantEmail);
  if (errors.length) fail(errors.join('\n'));
  const fingerprint = await controlFingerprint(fresh, { companyId, companyName, month, year, emailAccountId, sender: senderAddress,
    saldeoRecipient: saldeoEmail.trim(), accountantRecipient: accountantEmail.trim() });
  if (str(body.fingerprint) !== fingerprint) {
    fail('Dokumenty, opisy, dopasowania, historia wysyłek lub odbiorcy zmienili się od pobrania pliku kontrolnego. Pobierz nowy plik i sprawdź go przed wysyłką.', 409);
  }
  const currentBlockers = deliveryBlockers(fresh);
  if (currentBlockers.length) fail(currentBlockers.join('\n'), 409);
  const toSend = reviewDocuments(fresh).filter((document) => document.bucket && !document.sentAt);
  if (toSend.length && !pinConfigured) fail('Brak poprawnego PIN_SALDEO na serwerze. Wysyłka nie została rozpoczęta.', 503);
  const checks = Array.isArray(body.sourceChecks) ? body.sourceChecks as Row[] : [];
  for (const source of checks) {
    const bucket = str(source.bucket); const path = str(source.path); const filename = str(source.filename); const digest = str(source.digest);
    if (!['external-invoices', 'event-files', 'bank-statements'].includes(bucket) || !path || !SHA256.test(digest)) {
      fail('Nieprawidłowy opis pliku z kontroli. Przygotuj nowy plik kontrolny.');
    }
    const current = await downloadBlob(ctx.supabase, bucket, path, filename);
    if (await blobDigest(current) !== digest) fail(`Plik „${filename}” zmienił się po kontroli. Pobierz nowy plik kontrolny przed wysyłką.`, 409);
  }
  const reportKey = `report:${reportHash}`;
  const earlierAttempts = await byIds(ctx.supabase, 'accounting_delivery_attempts', 'id,delivery_key,status,my_company_id,recipient', 'delivery_key', [...toSend.map((source) => `file:${source.key}`), reportKey]);
  if (earlierAttempts.some((attempt) => attempt.my_company_id === companyId && attempt.status !== 'sent')) fail('Istnieje przerwana wysyłka o niepotwierdzonym wyniku. Sprawdź pocztę i Saldeo przed ponowieniem.', 409);
  const { error: settingError } = await ctx.supabase.from('my_companies').update({ saldeo_document_email: saldeoEmail.trim(), accountant_email: accountantEmail.trim() }).eq('id', companyId);
  if (settingError) fail(settingError.message || 'Nie udało się zapisać adresów wysyłki w działalności.');
  const groupedPayments = collectivePaymentDetails(fresh);
  const period = `${String(month).padStart(2, '0')}/${year}`;
  return {
    toSend: toSend.map((document) => document.key),
    companyName, period, statementCount: fresh.statements.length, collectiveCount: groupedPayments.length,
    accountantItem: { key: reportKey, kind: 'accountant_report', metadata: {
      period_month: month, period_year: year, transaction_count: fresh.transactions.length, statement_count: fresh.statements.length,
      matched_relation_count: fresh.allocations.filter((allocation) => fresh.transactions.some((bank) => bank.id === allocation.transactionId)).length,
      saldeo_document_count: reviewDocuments(fresh).filter((document) => document.bucket).length, unresolved_count: new Set([...fresh.describedMissing, ...fresh.unresolved].map((bank) => bank.id)).size,
      snapshot: { source_statements: fresh.statements.map((statement) => statement.file_name), described_missing_document_count: fresh.describedMissing.length, described_missing: fresh.describedMissing.map((bank) => ({ id: bank.id, reference: bank.reference_number, note: bank.accounting_note })), documents_to_follow: documentFollowupRows(fresh), acknowledged_followup_ids: fresh.followups.filter((item) => item.active).map((item) => item.id), payload_hash: reportHash, saldeo_receipt_confirmed: false, control_file_revision: revision, control_file_created_at: createdAt, control_approved_at: new Date().toISOString() },
    } },
  };
}

/** Rezerwacja wysyłki (`claim_accounting_delivery`) — chroni przed duplikatami, jak w CRM. */
export async function saldeoClaim(ctx: NativeContext, body: Record<string, unknown>) {
  const companyId = str(body.company).trim();
  if (!UUID.test(companyId)) fail('Wybierz działalność.');
  const items = body.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) fail('Nieprawidłowy zakres rezerwacji wysyłki.');
  const { data, error } = await ctx.supabase.rpc('claim_accounting_delivery', { p_company_id: companyId, p_recipient: str(body.recipient), p_items: items });
  if (error) fail(error.message || 'Nie można bezpiecznie zarezerwować wysyłki.', 409);
  const claimed = Array.isArray((data as Row | null)?.claimed) ? (data as Row).claimed as Row[] : [];
  return { claimed: claimed.map((claim) => ({ id: str(claim.id), key: str(claim.key) })) };
}

/** Wynik wysyłki (`complete_accounting_delivery`): „sent” albo „uncertain” (bez ponawiania). */
export async function saldeoComplete(ctx: NativeContext, body: Record<string, unknown>) {
  const ids = Array.isArray(body.attemptIds) ? (body.attemptIds as unknown[]).map(str) : [];
  if (!ids.length || ids.length > 50 || ids.some((id) => !UUID.test(id))) fail('Nieprawidłowe rezerwacje wysyłki.');
  const deliveryStatus = body.status === 'sent' ? 'sent' : body.status === 'uncertain' ? 'uncertain' : fail('Nieprawidłowy wynik wysyłki.');
  const messageId = typeof body.messageId === 'string' && body.messageId ? body.messageId : null;
  const { error } = await ctx.supabase.rpc('complete_accounting_delivery', { p_attempt_ids: ids, p_status: deliveryStatus, p_email_message_id: messageId });
  if (error) fail(error.message || 'Nie udało się zapisać wyniku wysyłki.', 409);
  return { ok: true };
}
