import type { SupabaseClient } from '@supabase/supabase-js';
import {
  reconcileStatementTransactions,
  loadBankStatementTransactionPages,
  type BankStatementDeduplicationMetadata,
  type BankStatementDeduplicationTransaction,
  type BankStatementReconciledRecord,
  type BankStatementReconciliation,
} from '@/lib/bankStatementDeduplication';
import { resolveStatementAccount, resolveBankStatementAccountKinds } from '@/lib/bankStatementAccount';
import { findVatTransferPairs } from '@/lib/CRM/bankVatTransfers';
import { buildBankStatementCompleteness, type BankStatementCompleteness } from './bankStatementCompleteness';

export interface ParserStatement extends BankStatementDeduplicationMetadata {
  file_name: string | null;
  processed: boolean | null;
  validation_status: string | null;
  validation_message: string | null;
  parser_version: number | string | null;
  created_at: string | null;
  currency?: string | null;
  opening_balance?: number | string | null;
  closing_balance?: number | string | null;
}

export interface ParserTransaction extends BankStatementDeduplicationTransaction {
  raw_counterparty: string | null;
  balance_after?: number | string | null;
  accounting_category?: string | null;
  accounting_subtype?: string | null;
  accounting_note?: string | null;
  match_confidence?: number | string | null;
  manual_match?: boolean | null;
  private_transfer_owner?: string | null;
  paired_bank_transaction_id?: string | null;
  created_at?: string | null;
  source_index?: number | null;
  source_balance_before?: number | string | null;
  source_balance_after?: number | string | null;
  source_verified?: boolean | null;
}

export interface ParserPreviewRow {
  transaction: ParserTransaction;
  statement: ParserStatement;
  hiddenAsDuplicate: boolean;
  reconciled: BankStatementReconciledRecord<ParserTransaction>;
  sourceStatements: ParserStatement[];
  vatTransfer: { counterpartId: string; kind: 'detected' | 'saved'; reason: string } | null;
}

export interface ParserAccountGroup {
  key: string;
  label: string;
  accountNumber: string | null;
  kind: 'regular' | 'vat' | 'unclassified';
  statements: ParserStatement[];
  rows: ParserPreviewRow[];
}

export interface BankStatementParserPreview {
  statements: ParserStatement[];
  groups: ParserAccountGroup[];
  warnings: string[];
  completeness: BankStatementCompleteness;
  reconciliationSummary: BankStatementReconciliation<ParserTransaction>['summary'];
  diagnostics: BankStatementReconciliation<ParserTransaction>['diagnostics'];
}

type CompanyAccounts = {
  bank_account: string | null;
  vat_bank_account: string | null;
};

const STATEMENT_FIELDS = [
  'id', 'my_company_id', 'statement_month', 'statement_year', 'account_type',
  'account_number', 'import_format', 'file_type', 'file_name', 'transactions_count',
  'processed', 'validation_status', 'validation_message', 'parser_version',
  'created_at', 'currency', 'opening_balance', 'closing_balance',
].join(',');

function groupLabel(kind: ParserAccountGroup['kind']) {
  if (kind === 'vat') return 'Rachunek VAT';
  if (kind === 'regular') return 'Rachunek bieżący';
  return 'Rachunek do identyfikacji';
}

/**
 * Diagnostic read model: every saved parser row is retained, including records
 * belonging to pending/rejected sources. Opening this view never runs a parser,
 * updates reconciliation or changes a statement's processing status.
 */
export async function loadBankStatementParserPreview(
  client: SupabaseClient,
  { companyId, month, year }: { companyId: string; month: number; year: number },
): Promise<BankStatementParserPreview> {
  if (!companyId?.trim() || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('Wybierz firmę oraz poprawny miesiąc i rok wyciągów.');
  }

  const warnings: string[] = [];
  const [loadedStatements, companyResult] = await Promise.all([
    loadBankStatementTransactionPages<ParserStatement>((from, to) => client
      .from('bank_statements')
      .select(STATEMENT_FIELDS)
      .eq('my_company_id', companyId)
      .eq('statement_month', month)
      .eq('statement_year', year)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
      .returns<ParserStatement[]>()),
    client.from('my_companies')
      .select('bank_account,vat_bank_account')
      .eq('id', companyId)
      .maybeSingle<CompanyAccounts>()
      .then((result) => result, () => ({ data: null, error: true })),
  ]);
  const statements = [...new Map(loadedStatements.map((statement) => [statement.id, statement])).values()];
  if (companyResult.error || !companyResult.data) {
    warnings.push('Nie udało się odczytać konfiguracji rachunków firmy. Zachowujemy rodzaj konta wybrany przy wgrywaniu; pliki MT940 przypisujemy na podstawie numerów rachunków pozostałych wyciągów.');
  }

  const accountKinds = resolveBankStatementAccountKinds(statements, companyResult.data || undefined);

  const groupsByKey = new Map<string, ParserAccountGroup>();
  const groupsByStatement = new Map<string, ParserAccountGroup>();
  statements.forEach((statement) => {
    const { accountNumber, warning } = resolveStatementAccount(statement);
    const kind = accountKinds.get(statement.id) || 'unclassified';
    const fileLabel = statement.file_name || 'Bez nazwy';
    if (warning) warnings.push(`Plik „${fileLabel}”: ${warning}`);
    if (kind === 'unclassified') {
      const reason = !accountNumber
        ? 'nie zapisano rozpoznawalnego numeru rachunku ani wyboru „Konto bieżące” / „Konto VAT”'
        : 'numer rachunku nie ma jednoznacznego oznaczenia konta bieżącego lub VAT w wyciągach ani ustawieniach firmy';
      warnings.push(`Plik „${fileLabel}”: ${reason}. Sam format MT940 nie określa rodzaju konta — tylko ten plik wymaga identyfikacji.`);
    }
    // Never combine unidentified accounts simply because both sources are MT940
    // or both contain the word VAT in a transaction description.
    const key = kind !== 'unclassified' && accountNumber
      ? `${kind}:${accountNumber}` : `${kind}:source:${statement.id}`;
    const group: ParserAccountGroup = groupsByKey.get(key) || {
      key,
      label: groupLabel(kind),
      accountNumber,
      kind,
      statements: [],
      rows: [],
    };
    group.statements.push(statement);
    groupsByKey.set(key, group);
    groupsByStatement.set(statement.id, group);
  });

  const transactionMap = new Map<string, ParserTransaction>();
  const statementIds = statements.map((statement) => statement.id);
  for (let batch = 0; batch < statementIds.length; batch += 80) {
    const rows = await loadBankStatementTransactionPages<ParserTransaction>((from, to) => client
      .from('bank_transactions')
      .select('*')
      .in('statement_id', statementIds.slice(batch, batch + 80))
      .order('transaction_date', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
      .returns<ParserTransaction[]>());
    rows.forEach((row) => transactionMap.set(row.id, row));
  }

  const rows = [...transactionMap.values()].sort((left, right) =>
    String(right.transaction_date || '').localeCompare(String(left.transaction_date || ''))
      || left.id.localeCompare(right.id));
  const statementsById = new Map(statements.map((statement) => [statement.id, statement]));
  const sourceRowCounts = new Map<string, number>();
  // Only complete, accepted sources with an identified account participate in
  // display deduplication. Rejected/parser-debug records always stay visible.
  const eligibleByGroup = new Map<string, ParserTransaction[]>();
  rows.forEach((row) => {
    const statement = statementsById.get(row.statement_id);
    const group = groupsByStatement.get(row.statement_id);
    if (statement?.processed !== true || statement.validation_status !== 'valid'
      || !group?.accountNumber || group.kind === 'unclassified') return;
    const groupRows = eligibleByGroup.get(group.key) || [];
    groupRows.push(row);
    eligibleByGroup.set(group.key, groupRows);
  });
  const reconciledBySource = new Map<string, BankStatementReconciledRecord<ParserTransaction>>();
  const diagnostics: BankStatementReconciliation<ParserTransaction>['diagnostics'] = [];
  let allocationConflictCount = 0;
  let unresolvedOverlapCount = 0;
  // Never hide a row by comparing it with another account kind, even if source
  // metadata happens to contain the same number for current and VAT accounts.
  eligibleByGroup.forEach((groupRows) => {
    const result = reconcileStatementTransactions(groupRows, statementsById);
    result.bySourceId
      .forEach((record, sourceId) => reconciledBySource.set(sourceId, record));
    diagnostics.push(...result.diagnostics);
    allocationConflictCount += result.summary.allocationConflictCount;
    unresolvedOverlapCount += result.summary.unresolvedOverlapCount;
  });
  const canonicalTransactions = rows.filter((row) => {
    const record = reconciledBySource.get(row.id);
    return !record || record.transaction.id === row.id;
  }).map((row) => reconciledBySource.get(row.id)?.transaction || row);
  // Pair only accepted sources, after combining PDF/MT940. This diagnostic read
  // never saves links; importing/analysing uses the same rules to persist them.
  const validCanonical = canonicalTransactions.filter((row) => {
    const source = statementsById.get(row.statement_id);
    return source?.processed === true && source.validation_status === 'valid';
  });
  const companyAccounts = companyResult.data ? new Map([[companyId, companyResult.data]]) : undefined;
  const vatPairs = findVatTransferPairs(validCanonical, statementsById, companyAccounts);
  const validRawRows = rows.filter((row) => {
    const statement = statementsById.get(row.statement_id);
    return statement?.processed === true && statement.validation_status === 'valid';
  });
  const rawRowsById = new Map(validRawRows.map((row) => [row.id, row]));
  const canonicalIds = new Set(validCanonical.map((row) => row.id));
  const rawVatPairs = findVatTransferPairs(validRawRows, statementsById, companyAccounts);
  const savedAliases = new Map<string, Set<string>>();
  const aliasesWithSavedLink = new Set<string>();
  const canonicalIdFor = (id: string) => reconciledBySource.get(id)?.transaction.id || id;
  const hasProtectedResolution = (id: string) => {
    const record = reconciledBySource.get(id);
    const sources = record?.sources || (rawRowsById.has(id) ? [rawRowsById.get(id)!] : []);
    return Boolean(record?.allocationConflict) || !sources.length || sources.some((source) =>
      source.match_status === 'matched' || source.match_status === 'partial'
      || Boolean(source.matched_invoice_id) || Number(source.allocated_amount || 0) > 0.009
      || Number(source.matched_document_count || 0) > 0 || source.private_transfer_detected);
  };
  validRawRows.forEach((row) => {
    if (row.paired_bank_transaction_id) aliasesWithSavedLink.add(canonicalIdFor(row.id));
  });
  // Saved links refer to immutable source IDs. A different PDF/MT940 display
  // copy must not make a reciprocal link disappear or create another new pair.
  rawVatPairs.forEach((pair, sourceId) => {
    if (pair.kind !== 'saved' || hasProtectedResolution(sourceId)
      || hasProtectedResolution(pair.counterpartId)) return;
    const id = canonicalIdFor(sourceId);
    const counterpartId = canonicalIdFor(pair.counterpartId);
    if (id === counterpartId || !canonicalIds.has(id) || !canonicalIds.has(counterpartId)) return;
    const partners = savedAliases.get(id) || new Set<string>();
    partners.add(counterpartId);
    savedAliases.set(id, partners);
  });
  vatPairs.forEach((pair, id) => {
    if (aliasesWithSavedLink.has(id) || aliasesWithSavedLink.has(pair.counterpartId)) vatPairs.delete(id);
  });
  savedAliases.forEach((partners, id) => {
    if (partners.size !== 1) return;
    const counterpartId = [...partners][0];
    const reverse = savedAliases.get(counterpartId);
    if (reverse?.size !== 1 || !reverse.has(id)) return;
    vatPairs.set(id, {
      counterpartId,
      kind: 'saved',
      reason: 'Zapisane powiązanie dwóch stron transferu własnego. Zachowano je również po połączeniu odczytów PDF i MT940.',
    });
  });
  if ([...aliasesWithSavedLink].some((id) => !vatPairs.has(id))) {
    warnings.push('Niektóre zapisane powiązania transferów wymagają kontroli: brakuje jednoznacznego drugiego odczytu albo operacja ma inne rozliczenie. Zachowano źródła i dotychczasowe powiązania.');
  }
  rows.forEach((transaction) => {
    const statement = statementsById.get(transaction.statement_id);
    const group = groupsByStatement.get(transaction.statement_id);
    if (!statement || !group) return;
    sourceRowCounts.set(statement.id, (sourceRowCounts.get(statement.id) || 0) + 1);
    const reconciled = reconciledBySource.get(transaction.id) || {
      transaction,
      sources: [transaction],
      sourceStatementIds: [statement.id],
      fieldSources: {},
      conflicts: [],
      allocationConflict: false,
    };
    group.rows.push({
      transaction,
      statement,
      hiddenAsDuplicate: reconciled.transaction.id !== transaction.id,
      reconciled,
      sourceStatements: reconciled.sourceStatementIds.map((id) => statementsById.get(id))
        .filter((source): source is ParserStatement => Boolean(source)),
      vatTransfer: vatPairs.get(reconciled.transaction.id) || null,
    });
  });

  statements.forEach((statement) => {
    const count = sourceRowCounts.get(statement.id) || 0;
    const expected = statement.transactions_count == null ? null : Number(statement.transactions_count);
    if (expected != null && Number.isInteger(expected) && expected >= 0 && expected !== count) {
      warnings.push(`Plik „${statement.file_name || 'Bez nazwy'}”: zapisany licznik wynosi ${expected}, a dostępnych rekordów parsera jest ${count}.`);
    }
  });
  const groups = [...groupsByKey.values()];
  const kindOrder = { regular: 0, vat: 1, unclassified: 2 };
  groups.sort((left, right) => kindOrder[left.kind] - kindOrder[right.kind]
    || String(left.accountNumber || '').localeCompare(String(right.accountNumber || ''))
    || left.key.localeCompare(right.key));

  const completeness = buildBankStatementCompleteness(statements, {
    companyAccounts: companyResult.data,
    configurationAvailable: !companyResult.error && Boolean(companyResult.data),
    sourceRowCounts,
  });
  const reconciliationSummary = {
    rawCount: rows.length,
    canonicalCount: canonicalTransactions.length,
    mergedCount: rows.length - canonicalTransactions.length,
    allocationConflictCount,
    unresolvedOverlapCount,
  };
  return { statements, groups, warnings, completeness, reconciliationSummary, diagnostics };
}
