import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { parseMT940Description } from '@/lib/bankStatementParsers';
import {
  bankStatementImportFormat,
  normalizeBankStatementAccount,
  resolveBankStatementAccountKinds,
  resolveStatementAccount,
} from '@/lib/bankStatementAccount';

export const BANK_STATEMENT_DEDUPLICATION_COLUMNS =
  'id,my_company_id,statement_month,statement_year,account_type,account_number,import_format,file_type,file_name,transactions_count,opening_balance,closing_balance,currency';

export interface BankStatementDeduplicationMetadata {
  id: string;
  my_company_id?: string | null;
  statement_month?: number | null;
  statement_year?: number | null;
  account_type?: string | null;
  account_number?: string | null;
  import_format?: string | null;
  file_type?: string | null;
  file_name?: string | null;
  transactions_count?: number | null;
  opening_balance?: number | string | null;
  closing_balance?: number | string | null;
  currency?: string | null;
}

export interface BankStatementDeduplicationTransaction {
  id: string;
  statement_id: string;
  transaction_date?: string | null;
  posting_date?: string | null;
  amount?: number | string | null;
  currency?: string | null;
  transaction_type?: string | null;
  counterparty_name?: string | null;
  counterparty_account?: string | null;
  title?: string | null;
  raw_description?: string | null;
  raw_counterparty?: string | null;
  reference_number?: string | null;
  match_status?: string | null;
  allocated_amount?: number | string | null;
  matched_document_count?: number | null;
  matched_invoice_id?: string | null;
  accounting_review_status?: string | null;
  private_transfer_detected?: boolean | null;
  source_index?: number | null;
  source_balance_before?: number | string | null;
  source_balance_after?: number | string | null;
  source_verified?: boolean | null;
}

export type BankStatementMergedField =
  | 'title'
  | 'counterparty_name'
  | 'counterparty_account'
  | 'reference_number'
  | 'posting_date'
  | 'raw_description'
  | 'raw_counterparty';

export interface BankStatementFieldConflict {
  field: BankStatementMergedField;
  values: Array<{ transactionId: string; value: string }>;
}

export interface BankStatementReconciledRecord<T extends BankStatementDeduplicationTransaction> {
  transaction: T;
  /** Original parser records; never changed to match the enriched display row. */
  sources: readonly T[];
  sourceStatementIds: string[];
  /** The original transaction ID supplying each displayed descriptive field. */
  fieldSources: Partial<Record<BankStatementMergedField, string>>;
  conflicts: BankStatementFieldConflict[];
  /** Both source copies have saved allocations; those allocations are not combined. */
  allocationConflict: boolean;
  /** Source files can order the same day's operations differently. */
  sourceOrderDiffers?: boolean;
}

export interface BankStatementReconciliationDiagnostic {
  kind: 'incomplete_source' | 'unresolved_overlap' | 'allocation_conflict' | 'source_order_difference';
  message: string;
  statementIds: string[];
  transactionIds: string[];
  accountNumber: string | null;
  expectedCount?: number;
  canonicalCount?: number;
}

export interface BankStatementReconciliation<T extends BankStatementDeduplicationTransaction> {
  transactions: T[];
  records: BankStatementReconciledRecord<T>[];
  bySourceId: ReadonlyMap<string, BankStatementReconciledRecord<T>>;
  diagnostics: BankStatementReconciliationDiagnostic[];
  summary: {
    rawCount: number;
    canonicalCount: number;
    mergedCount: number;
    allocationConflictCount: number;
    unresolvedOverlapCount: number;
  };
}

/**
 * Read every source row before choosing display copies or filtering statuses.
 * The callback must order by date AND unique id before applying this page range.
 */
export async function loadBankStatementTransactionPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await loadPage(from, from + pageSize - 1);
    if (error) throw error;
    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function normalizeText(value: string) {
  return repairBrokenBankText(value)
    .toUpperCase()
    .replace(/Ł/g, 'L')
    .replace(/ˇ/g, 'A')
    .replace(/¦/g, 'S')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function accountNumber(value?: string | null) {
  return normalizeBankStatementAccount(value) || '';
}

function datesFor(row: BankStatementDeduplicationTransaction) {
  return [...new Set([row.transaction_date, row.posting_date]
    .map((value) => String(value || '').slice(0, 10))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
}

function resolutionPriority(row: BankStatementDeduplicationTransaction) {
  if (row.match_status === 'matched') return 4;
  if (Number(row.allocated_amount || 0) > 0.009 || Number(row.matched_document_count || 0) > 0 || row.matched_invoice_id) return 3;
  if (row.accounting_review_status === 'explained') return 2;
  if (row.private_transfer_detected) return 1;
  return 0;
}

function hasAllocation(row: BankStatementDeduplicationTransaction) {
  return row.match_status === 'matched'
    || Number(row.allocated_amount || 0) > 0.009
    || Number(row.matched_document_count || 0) > 0
    || Boolean(row.matched_invoice_id);
}

const MERGED_FIELDS: readonly BankStatementMergedField[] = [
  'title', 'counterparty_name', 'counterparty_account', 'reference_number',
  'posting_date', 'raw_description', 'raw_counterparty',
];

function isPlaceholder(value: string) {
  const normalized = normalizeText(value);
  return !normalized || /^(NIEZNANYKONTRAHENT|BRAKDANYCH|UNKNOWN|NONREF|OPPRZZEWDO)$/.test(normalized);
}

function textInformation(value: string) {
  const normalized = repairBrokenBankText(value);
  const words = normalized.match(/[\p{L}]{2,}/gu) || [];
  const meaningful = words.filter((word) => !/^(NONREF|PL|REF)$/i.test(word));
  // Long card/terminal identifiers must not outweigh a readable payment title.
  return meaningful.reduce((sum, word) => sum + Math.min(word.length, 24), 0)
    + Math.min((normalized.match(/\d/g) || []).length, 18) / 3
    - (value.match(/\uFFFD/g) || []).length * 8;
}

function chooseFieldSource<T extends BankStatementDeduplicationTransaction>(
  field: BankStatementMergedField,
  preferred: T,
  alternative: T,
): T {
  const before = preferred[field];
  const after = alternative[field];
  if (typeof after !== 'string' || !after.trim()) return preferred;
  if (typeof before !== 'string' || !before.trim()) return alternative;
  if (field === 'posting_date') return preferred;
  if (field === 'counterparty_account') {
    return !accountNumber(before) && accountNumber(after) ? alternative : preferred;
  }
  const beforeNormalized = normalizeText(before);
  const afterNormalized = normalizeText(after);
  if (isPlaceholder(before) && !isPlaceholder(after)) return alternative;
  if (isPlaceholder(after) || beforeNormalized === afterNormalized) return preferred;
  if (afterNormalized.includes(beforeNormalized)) return alternative;
  if (beforeNormalized.includes(afterNormalized)) return preferred;
  if (field === 'title' || field === 'raw_description' || field === 'raw_counterparty') {
    return textInformation(after) > textInformation(before) + 8 ? alternative : preferred;
  }
  // Do not replace conflicting supplier names, account numbers or references
  // merely because another source is longer. Both values remain in provenance.
  return preferred;
}

function enrichedRecord<T extends BankStatementDeduplicationTransaction>(
  canonical: T,
  originals: readonly T[],
): BankStatementReconciledRecord<T> {
  const transaction = { ...canonical };
  const fieldSources: Partial<Record<BankStatementMergedField, string>> = {};
  const conflicts: BankStatementFieldConflict[] = [];
  MERGED_FIELDS.forEach((field) => {
    let selected = canonical;
    originals.forEach((source) => {
      if (source.id !== selected.id) selected = chooseFieldSource(field, selected, source);
    });
    const value = selected[field];
    if (typeof value === 'string' && value.trim()) {
      // Only descriptive fields are enriched. The chosen row's ID, source ID,
      // financial amounts, directions, allocation and review state stay intact.
      (transaction as BankStatementDeduplicationTransaction)[field] = value;
      fieldSources[field] = selected.id;
    }
    if (field === 'raw_description' || field === 'raw_counterparty') return;
    const values = originals.flatMap((source) => {
      const original = source[field];
      return typeof original === 'string' && original.trim() && !isPlaceholder(original)
        ? [{ transactionId: source.id, value: original }] : [];
    });
    if (values.length < 2) return;
    const normalized = values.map((entry) => normalizeText(entry.value));
    const comparable = normalized.every((entry) => entry === normalized[0]
      || (field !== 'posting_date' && (entry.includes(normalized[0]) || normalized[0].includes(entry))));
    if (!comparable) conflicts.push({ field, values });
  });
  return {
    transaction,
    sources: originals,
    sourceStatementIds: [...new Set(originals.map((source) => source.statement_id))],
    fieldSources,
    conflicts,
    allocationConflict: originals.filter(hasAllocation).length > 1,
    sourceOrderDiffers: originals.length > 1 && originals.every((source) => source.source_verified === true)
      && originals.some((source) => cents(source.source_balance_before) !== cents(canonical.source_balance_before)
        || cents(source.source_balance_after) !== cents(canonical.source_balance_after)),
  };
}

function cents(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && Number.isSafeInteger(Math.round(amount * 100))
    ? Math.round(amount * 100) : null;
}

function invoiceReferences(texts: readonly string[]): Set<string> {
  const result = new Set<string>();
  texts.forEach((text) => {
    const clean = repairBrokenBankText(text).toUpperCase()
      // MT940 continuation fields can split a number immediately beside a slash
      // or inside its year. Formatting tags are not part of an invoice number.
      .replace(/\s*\/\s*/g, '/')
      .replace(/\/(20\d|20|2)\s+(\d{1,3})(?!\d)/g, (match, start: string, end: string) =>
        /^20\d{2}$/.test(start + end) ? `/${start}${end}` : match)
      .replace(/\/(?:TXT|VAT|IDC)\//g, ' ');
    // Labelled references may look like a date (4/06/2026), but still identify
    // different invoices. Do not confuse VAT amounts or payment periods with them.
    const labelled = /(?:FAKTUR(?:A|Y|Ę|E)?(?:\s+(?:VAT|NR|NUMER))*|NR\s+FAKTURY\s+LUB\s+OKRES\s+ZBIORCZOŚCI|\bINV)\s*[:/\-]?\s*([A-Z0-9][A-Z0-9/_\-.]{2,})/g;
    for (const match of clean.matchAll(labelled)) {
      if (/\d/.test(match[1]) && /[/\-]/.test(match[1])) result.add(normalizeText(match[1]));
    }
    for (const match of clean.matchAll(/(?:^|\s)((?:FV|FS|FVAT|FU|FE)[\s/\-]*[A-Z0-9]*\d[A-Z0-9/_\-.]*)/g)) {
      const token = match[1];
      if (/[/\-]/.test(token)) result.add(normalizeText(token));
    }
  });
  return result;
}

function bankReferenceScheme(reference: string): string {
  if (/^NONREF\d+$/.test(reference)) return 'bank-reference';
  if (/^\d{4}[A-Z]{2}\d{8,}$/.test(reference)) return 'printed-operation';
  if (/^\d+$/.test(reference)) return 'numeric-reference';
  return reference.replace(/\d+/g, '#');
}

function pkoOperationReferences(row: BankStatementDeduplicationTransaction, year?: number | null): Set<string> {
  const keys = new Set<string>();
  // These are the two observed PKO encodings of the SAME bank operation ID:
  // 6514FE96370013988 <-> NONREF//5140596370013988; MX corresponds to 12.
  // Keep the exact code/day/11-digit suffix, not a loose numeric substring.
  const raw = String(row.raw_description || '').trim();
  const printed = raw.match(/^(\d)(\d{3})(FE|MX)(\d{11})(?=\s|$)/i);
  if (printed && year && printed[1] === String(year).slice(-1)) {
    const operationCode = printed[3].toUpperCase() === 'FE' ? '05' : '12';
    keys.add(`${printed[2]}${operationCode}${printed[4]}`);
  }
  const mt940 = String(row.reference_number || '').trim().match(/^NONREF\/\/(\d{3}(?:05|12)\d{11})$/i);
  if (mt940) keys.add(mt940[1]);
  return keys;
}

/** Maximum-weight one-to-one assignment with a private unmatched option per row. */
function weightedAssignment(weights: readonly (readonly number[])[], forbidden?: readonly [number, number]) {
  const n = weights.length;
  const realColumns = weights[0]?.length || 0;
  const columns = realColumns + n;
  const u = Array(n + 1).fill(0) as number[];
  const v = Array(columns + 1).fill(0) as number[];
  const p = Array(columns + 1).fill(0) as number[];
  const way = Array(columns + 1).fill(0) as number[];
  const weightAt = (i: number, j: number) => j >= realColumns ? 0
    : forbidden?.[0] === i && forbidden[1] === j ? -1_000_000
      : weights[i][j] > 0 ? weights[i][j] : -1_000_000;
  for (let i = 1; i <= n; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minimum = Array(columns + 1).fill(Infinity) as number[];
    const used = Array(columns + 1).fill(false) as boolean[];
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= columns; j += 1) {
        if (used[j]) continue;
        const current = -weightAt(i0 - 1, j - 1) - u[i0] - v[j];
        if (current < minimum[j]) { minimum[j] = current; way[j] = j0; }
        if (minimum[j] < delta) { delta = minimum[j]; j1 = j; }
      }
      for (let j = 0; j <= columns; j += 1) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minimum[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const pairs: Array<[number, number]> = [];
  let score = 0;
  for (let j = 1; j <= realColumns; j += 1) {
    if (!p[j]) continue;
    const i = p[j] - 1;
    if (weightAt(i, j - 1) <= 0) continue;
    pairs.push([i, j - 1]);
    score += weights[i][j - 1];
  }
  return { pairs, score };
}

/**
 * Builds enriched display rows only; never writes, combines allocations or changes source rows.
 * Call with BOTH resolved and unresolved transactions, and filter statuses afterwards.
 * Only evidence-backed PDF/MT940 pairs forced by the whole candidate assignment
 * are combined. Counts alone never establish the identity of transactions.
 */
export function reconcileStatementTransactions<T extends BankStatementDeduplicationTransaction>(
  rows: readonly T[],
  statementMetadata: ReadonlyMap<string, BankStatementDeduplicationMetadata>,
): BankStatementReconciliation<T> {
  const diagnostics: BankStatementReconciliationDiagnostic[] = [];
  const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
  const accountKinds = new Map<string, 'regular' | 'vat' | 'unclassified'>();
  const metadataByCompany = new Map<string, BankStatementDeduplicationMetadata[]>();
  statementMetadata.forEach((statement) => {
    const companyKey = statement.my_company_id || `source:${statement.id}`;
    const companySources = metadataByCompany.get(companyKey) || [];
    companySources.push(statement);
    metadataByCompany.set(companyKey, companySources);
  });
  metadataByCompany.forEach((companySources) => resolveBankStatementAccountKinds(companySources)
    .forEach((kind, id) => accountKinds.set(id, kind)));
  const loadedIdsByStatement = new Map<string, Set<string>>();
  uniqueRows.forEach((row) => {
    const ids = loadedIdsByStatement.get(row.statement_id) || new Set<string>();
    ids.add(row.id);
    loadedIdsByStatement.set(row.statement_id, ids);
  });
  loadedIdsByStatement.forEach((loaded, id) => {
    const statement = statementMetadata.get(id);
    const expected = statement?.transactions_count;
    if (!statement || expected == null || !Number.isInteger(Number(expected)) || Number(expected) !== loaded.size) {
      diagnostics.push({
        kind: 'incomplete_source',
        message: `Plik „${statement?.file_name || 'Bez nazwy'}” nie ma potwierdzonego kompletu odczytów. Jego transakcje pozostają oddzielnie do sprawdzenia.`,
        statementIds: [id], transactionIds: [...loaded],
        accountNumber: statement ? resolveStatementAccount(statement).accountNumber : null,
        ...(expected != null && Number.isFinite(Number(expected)) ? { expectedCount: Number(expected) } : {}),
      });
    }
  });
  const prepared = uniqueRows.flatMap((row) => {
    const statement = statementMetadata.get(row.statement_id);
    if (!statement?.my_company_id || !statement.statement_year || !statement.statement_month) return [];
    // A truncated/status-filtered source cannot prove one-to-one identity.
    const expectedCount = Number(statement.transactions_count);
    if (!Number.isInteger(expectedCount) || expectedCount <= 0
      || loadedIdsByStatement.get(row.statement_id)?.size !== expectedCount) return [];
    const account = resolveStatementAccount(statement).accountNumber;
    const kind = accountKinds.get(statement.id);
    const format = bankStatementImportFormat(statement);
    const dates = datesFor(row);
    const amount = Math.abs(Number(row.amount));
    const currency = String(row.currency || '').trim().toUpperCase();
    if (!account || !format || !kind || kind === 'unclassified'
      || !dates.length || !Number.isFinite(amount) || !currency) return [];
    if (!['credit', 'debit'].includes(String(row.transaction_type))) return [];

    const parsedTitle = row.raw_description ? parseMT940Description(row.raw_description).title : '';
    const rawTexts = [row.reference_number, row.title, parsedTitle, row.counterparty_name]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.split(/Niniejszy dokument jest wydrukiem/i)[0]);
    const texts = rawTexts
      .map((value) => normalizeText(value.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')))
      .filter(Boolean);
    const numericIds = [...new Set(rawTexts.flatMap((value) => value.match(/\d{12,}/g) || []))]
      .filter((value) => !/^0+$/.test(value) && value !== account && value.length !== 26);
    const accounts = new Set([
      accountNumber(row.counterparty_account),
      ...rawTexts.flatMap((value) => Array.from(
        value.matchAll(/(?:^|[^0-9])((?:PL\s*)?\d{2}(?:[\s-]*\d{4}){6})(?=$|[^0-9])/gi),
        (match) => accountNumber(match[1]),
      )),
    ].filter((value) => Boolean(value) && value !== account));
    const before = cents(row.source_balance_before);
    const after = cents(row.source_balance_after);
    const signedAmount = Math.round(amount * 100) * (row.transaction_type === 'debit' ? -1 : 1);
    const verifiedBalances = row.source_verified === true && Number.isInteger(row.source_index)
      && Number(row.source_index) >= 0 && before !== null && after !== null
      && before + signedAmount === after;

    return [{
      row,
      format,
      dates,
      texts,
      numericIds,
      accounts,
      invoiceRefs: invoiceReferences(rawTexts),
      pkoOperationRefs: pkoOperationReferences(row, statement.statement_year),
      hasPkoSourceName: /(?:^|[^A-Z0-9])PKO(?:[^A-Z0-9]|$)/i.test(statement.file_name || ''),
      cardMasks: new Set(rawTexts.flatMap((value) => value.toUpperCase().match(/\d{4,6}[*X]{2,}\d{4}/g) || [])),
      periods: new Set(rawTexts.flatMap((value) => value.match(/\d{2}[./-]\d{2}[./-]\d{4}/g) || [])),
      before,
      after,
      verifiedBalances,
      statement,
      account,
      reference: normalizeText(row.reference_number || ''),
      bucket: JSON.stringify([
        statement.my_company_id, account, kind, statement.statement_year, statement.statement_month,
        row.transaction_type, currency, Math.round(amount * 100),
      ]),
    }];
  });

  type Prepared = (typeof prepared)[number];
  const byStatement = new Map<string, Prepared[]>();
  const buckets = new Map<string, Prepared[]>();
  prepared.forEach((item) => {
    const sourceRows = byStatement.get(item.row.statement_id) || [];
    sourceRows.push(item);
    byStatement.set(item.row.statement_id, sourceRows);
    const bucketRows = buckets.get(item.bucket) || [];
    bucketRows.push(item);
    buckets.set(item.bucket, bucketRows);
  });

  const identifierCounts = new Map<string, number>();
  const operationReferenceCounts = new Map<string, number>();
  const isExclusiveIdentifier = (item: Prepared, identifier: string) => {
    const key = item.row.statement_id + ':' + identifier;
    if (!identifierCounts.has(key)) {
      identifierCounts.set(key, (byStatement.get(item.row.statement_id) || []).filter((candidate) =>
        candidate.numericIds.some((value) => value.includes(identifier)),
      ).length);
    }
    return identifierCounts.get(key) === 1;
  };
  const isExclusiveOperationReference = (item: Prepared, reference: string) => {
    const key = `${item.row.statement_id}:${item.bucket}:${reference}`;
    if (!operationReferenceCounts.has(key)) {
      operationReferenceCounts.set(key, (byStatement.get(item.row.statement_id) || []).filter((candidate) =>
        candidate.bucket === item.bucket && candidate.pkoOperationRefs.has(reference)).length);
    }
    return operationReferenceCounts.get(key) === 1;
  };

  const identityScore = (left: Prepared, right: Prepared) => {
    const bankOperationMatch = (left.hasPkoSourceName || right.hasPkoSourceName)
      && [...left.pkoOperationRefs].some((reference) => right.pkoOperationRefs.has(reference)
        && isExclusiveOperationReference(left, reference) && isExclusiveOperationReference(right, reference));
    const balancesMatch = left.verifiedBalances && right.verifiedBalances
      && left.before === right.before && left.after === right.after;
    const invoiceMatch = [...left.invoiceRefs].some((reference) => right.invoiceRefs.has(reference));
    // A heuristic token extracted from a truncated title is weaker evidence than
    // the verified bank ledger or the exact bank's cross-format operation ID.
    if (left.invoiceRefs.size && right.invoiceRefs.size && !invoiceMatch && !bankOperationMatch && !balancesMatch) return 0;
    let referenceMatch = bankOperationMatch
      || (left.reference.length >= 12 && /\d{8}/.test(left.reference) && left.reference === right.reference);
    for (const leftId of left.numericIds) {
      for (const rightId of right.numericIds) {
        const shorter = leftId.length <= rightId.length ? leftId : rightId;
        const longer = leftId.length <= rightId.length ? rightId : leftId;
        if (longer.includes(shorter) && isExclusiveIdentifier(left, shorter) && isExclusiveIdentifier(right, shorter)) referenceMatch = true;
      }
    }
    // Two different concrete bank references cannot be overridden by an equal
    // amount, date and recipient. Leave such records separate for inspection.
    if (!referenceMatch && left.reference.length >= 12 && right.reference.length >= 12
      && /\d{8}/.test(left.reference) && /\d{8}/.test(right.reference)
      && bankReferenceScheme(left.reference) === bankReferenceScheme(right.reference)
      && !left.reference.includes(right.reference) && !right.reference.includes(left.reference)) return 0;
    const accountMatch = [...left.accounts].some((account) => right.accounts.has(account));
    const sameText = left.texts.some((leftText) => right.texts.some((rightText) => {
      const shorter = leftText.length <= rightText.length ? leftText : rightText;
      const longer = leftText.length <= rightText.length ? rightText : leftText;
      return shorter.length >= 12 && (shorter.match(/[A-Z]/g)?.length || 0) >= 5 && longer.includes(shorter);
    }));
    const cardMatch = [...left.cardMasks].some((mask) => right.cardMasks.has(mask));
    const periodMatch = left.periods.size > 0 && [...left.periods].every((period) => right.periods.has(period));
    // Independently verified file balances are much stronger than textual hints.
    // Same amounts/dates, equal source counts or arbitrary UUID ordering score 0.
    return (balancesMatch ? 100_000 : 0) + (referenceMatch ? 10_000 : 0)
      + (invoiceMatch ? 500 : 0) + (accountMatch ? 50 : 0)
      + (sameText ? 20 : 0) + (cardMatch && periodMatch ? 200 : 0);
  };

  const pairs: Array<[Prepared, Prepared]> = [];
  const ambiguousOverlaps: Array<{ left: Prepared[]; right: Prepared[] }> = [];
  buckets.forEach((items) => {
    const left = items.filter((item) => item.format === 'PDF');
    const right = items.filter((item) => item.format === 'MT940');
    if (!left.length || !right.length) return;
    const datesAgree = (a: Prepared, b: Prepared) => a.dates.some((date) => b.dates.includes(date))
      && (!(a.dates.length === 2 && b.dates.length === 2 && a.dates.join() !== b.dates.join())
        // A verified ledger position can identify the operation despite a legacy
        // posting-year error. Preserve both original dates in field conflicts.
        || (a.verifiedBalances && b.verifiedBalances && a.before === b.before && a.after === b.after));
    const weights = left.map((a) => right.map((b) => datesAgree(a, b) ? identityScore(a, b) : 0));
    const seenLeft = new Set<number>();
    const acceptedLeft = new Set<number>();
    const acceptedRight = new Set<number>();
    // Solve connected evidence components, not a huge month-wide dense matrix.
    for (let seed = 0; seed < left.length; seed += 1) {
      if (seenLeft.has(seed) || !weights[seed].some((score) => score > 0)) continue;
      const componentLeft = new Set<number>([seed]);
      const componentRight = new Set<number>();
      const pending: Array<{ side: 'left' | 'right'; index: number }> = [{ side: 'left', index: seed }];
      while (pending.length) {
        const vertex = pending.pop()!;
        if (vertex.side === 'left') {
          seenLeft.add(vertex.index);
          weights[vertex.index].forEach((score, index) => {
            if (score > 0 && !componentRight.has(index)) {
              componentRight.add(index); pending.push({ side: 'right', index });
            }
          });
        } else {
          weights.forEach((row, index) => {
            if (row[vertex.index] > 0 && !componentLeft.has(index)) {
              componentLeft.add(index); pending.push({ side: 'left', index });
            }
          });
        }
      }
      const leftIndices = [...componentLeft];
      const rightIndices = [...componentRight];
      // An exceptionally large unresolved component is a review case, not
      // permission to lock the browser or arbitrarily zip two lists together.
      if (leftIndices.length > 80 || rightIndices.length > 80) continue;
      const componentWeights = leftIndices.map((i) => rightIndices.map((j) => weights[i][j]));
      const solution = weightedAssignment(componentWeights);
      solution.pairs.forEach(([i, j]) => {
        if (weightedAssignment(componentWeights, [i, j]).score === solution.score) return;
        const leftIndex = leftIndices[i];
        const rightIndex = rightIndices[j];
        acceptedLeft.add(leftIndex); acceptedRight.add(rightIndex);
        pairs.push([left[leftIndex], right[rightIndex]]);
      });
    }
    const remainingLeft = left.filter((item, i) => !acceptedLeft.has(i)
      && right.some((other, j) => !acceptedRight.has(j) && datesAgree(item, other)));
    const remainingRight = right.filter((item, j) => !acceptedRight.has(j)
      && remainingLeft.some((other) => datesAgree(other, item)));
    if (remainingLeft.length && remainingRight.length) ambiguousOverlaps.push({ left: remainingLeft, right: remainingRight });
  });

  const partnersByCanonicalId = new Map<string, T>();
  const hiddenIds = new Set<string>();
  pairs.forEach(([item, partner]) => {
    const priority = resolutionPriority(item.row) - resolutionPriority(partner.row);
    const keepItem = priority > 0 || (priority === 0 && item.format === 'MT940');
    const canonical = keepItem ? item.row : partner.row;
    const source = keepItem ? partner.row : item.row;
    hiddenIds.add(source.id);
    partnersByCanonicalId.set(canonical.id, source);
  });

  const records = uniqueRows.filter((row) => !hiddenIds.has(row.id)).map((canonical) => {
    const partner = partnersByCanonicalId.get(canonical.id);
    return enrichedRecord(canonical, partner ? [canonical, partner] : [canonical]);
  });
  const bySourceId = new Map<string, BankStatementReconciledRecord<T>>();
  records.forEach((record) => record.sources.forEach((source) => bySourceId.set(source.id, record)));
  const allocationConflicts = records.filter((record) => record.allocationConflict);
  allocationConflicts.forEach((record) => diagnostics.push({
    kind: 'allocation_conflict',
    message: 'Jedna operacja ma zapisane rozliczenia w obu odczytach PDF i MT940. Kwotę przelewu liczymy raz; powiązania z dokumentami wymagają kontroli i nie zostały połączone ani usunięte.',
    statementIds: record.sourceStatementIds,
    transactionIds: record.sources.map((source) => source.id),
    accountNumber: resolveStatementAccount(statementMetadata.get(record.transaction.statement_id) || {}).accountNumber,
    canonicalCount: 1,
  }));
  const reorderedByAccount = new Map<string, BankStatementReconciledRecord<T>[]>();
  records.filter((record) => record.sourceOrderDiffers).forEach((record) => {
    const statement = statementMetadata.get(record.transaction.statement_id);
    const key = JSON.stringify([statement?.my_company_id, statement?.statement_year, statement?.statement_month,
      resolveStatementAccount(statement || {}).accountNumber]);
    const accountRecords = reorderedByAccount.get(key) || [];
    accountRecords.push(record);
    reorderedByAccount.set(key, accountRecords);
  });
  reorderedByAccount.forEach((accountRecords) => diagnostics.push({
    kind: 'source_order_difference',
    message: 'Część tych samych operacji ma inną kolejność i salda pośrednie w PDF oraz MT940. Tożsamość potwierdzają identyfikatory bankowe. Oryginalne salda pozostają przy źródłach, a kwoty operacji są liczone raz.',
    statementIds: [...new Set(accountRecords.flatMap((record) => record.sourceStatementIds))],
    transactionIds: accountRecords.flatMap((record) => record.sources.map((source) => source.id)),
    accountNumber: resolveStatementAccount(statementMetadata.get(accountRecords[0].transaction.statement_id) || {}).accountNumber,
    canonicalCount: accountRecords.length,
  }));
  ambiguousOverlaps.forEach((overlap) => {
    const items = [...overlap.left, ...overlap.right];
    diagnostics.push({
      kind: 'unresolved_overlap',
      message: 'PDF i MT940 zawierają nieuzgodnione odczyty o zgodnej kwocie i dacie. Brakuje jednoznacznego dowodu ich tożsamości; nie połączono ich na siłę. Ten fragment listy nie jest jeszcze potwierdzonym zestawieniem unikalnych operacji.',
      statementIds: [...new Set(items.map((item) => item.row.statement_id))],
      transactionIds: items.map((item) => item.row.id),
      accountNumber: items[0].account,
      canonicalCount: items.length,
    });
  });
  return {
    transactions: records.map((record) => record.transaction), records, bySourceId, diagnostics,
    summary: {
      rawCount: uniqueRows.length,
      canonicalCount: records.length,
      mergedCount: uniqueRows.length - records.length,
      allocationConflictCount: allocationConflicts.length,
      unresolvedOverlapCount: ambiguousOverlaps.reduce((sum, overlap) => sum + overlap.left.length, 0),
    },
  };
}

/** Backwards-compatible read model used by matching, analysis and accounting. */
export function deduplicateStatementTransactions<T extends BankStatementDeduplicationTransaction>(
  rows: readonly T[],
  statementMetadata: ReadonlyMap<string, BankStatementDeduplicationMetadata>,
): T[] {
  return reconcileStatementTransactions(rows, statementMetadata).transactions;
}
