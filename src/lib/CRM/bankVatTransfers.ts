import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBankStatementAccount, resolveBankStatementAccountKinds, resolveStatementAccount } from '@/lib/bankStatementAccount';
import {
  BANK_STATEMENT_DEDUPLICATION_COLUMNS,
  reconcileStatementTransactions,
  loadBankStatementTransactionPages,
  type BankStatementDeduplicationMetadata,
  type BankStatementDeduplicationTransaction,
} from '@/lib/bankStatementDeduplication';

export interface VatTransferTransaction extends BankStatementDeduplicationTransaction {
  accounting_note?: string | null;
  accounting_category?: string | null;
  accounting_subtype?: string | null;
  paired_bank_transaction_id?: string | null;
}

export interface VatTransferPair {
  counterpartId: string;
  kind: 'detected' | 'saved';
  reason: string;
}

export type VatTransferCompanyAccounts = ReadonlyMap<string, {
  bank_account?: string | null;
  vat_bank_account?: string | null;
}>;

export function isConfirmedInternalVatTransfer(transaction: VatTransferTransaction): boolean {
  return Boolean(transaction.paired_bank_transaction_id)
    && transaction.accounting_category === 'own_transfer'
    && transaction.accounting_subtype === 'automatic_vat_transfer'
    && transaction.accounting_review_status === 'explained';
}

function hasDocumentAllocation(transaction: VatTransferTransaction) {
  return transaction.match_status === 'matched'
    || Boolean(transaction.matched_invoice_id)
    || Number(transaction.allocated_amount || 0) > 0.009
    || Number(transaction.matched_document_count || 0) > 0;
}

/** Canonical, enriched input only. No inference from the word VAT or company name. */
export function findVatTransferPairs<T extends VatTransferTransaction>(
  transactions: readonly T[],
  statements: ReadonlyMap<string, BankStatementDeduplicationMetadata>,
  companyAccounts?: VatTransferCompanyAccounts,
): Map<string, VatTransferPair> {
  const result = new Map<string, VatTransferPair>();
  const kinds = new Map<string, 'regular' | 'vat' | 'unclassified'>();
  const companyIds = new Set([...statements.values()].map((statement) => statement.my_company_id).filter(Boolean));
  for (const companyId of companyIds) {
    const companyStatements = [...statements.values()].filter((statement) => statement.my_company_id === companyId);
    for (const [id, kind] of resolveBankStatementAccountKinds(companyStatements, companyAccounts?.get(companyId!))) kinds.set(id, kind);
  }
  const rows = transactions.flatMap((transaction) => {
    const statement = statements.get(transaction.statement_id);
    const kind = kinds.get(transaction.statement_id);
    const account = statement ? resolveStatementAccount(statement).accountNumber : null;
    const amount = Math.abs(Number(transaction.amount));
    const date = String(transaction.transaction_date || '').slice(0, 10);
    const currency = String(transaction.currency || '').trim().toUpperCase();
    if (!statement?.my_company_id
      || !Number.isFinite(amount) || amount <= 0 || !currency || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !['credit', 'debit'].includes(String(transaction.transaction_type))
      || hasDocumentAllocation(transaction) || transaction.private_transfer_detected) return [];
    return [{ transaction, companyId: statement.my_company_id, kind, account, cents: Math.round(amount * 100), date, currency }];
  });
  const candidates = new Map<string, string[]>();
  for (const left of rows) {
    for (const right of rows) {
      if (left.transaction.id >= right.transaction.id || left.companyId !== right.companyId
        || left.transaction.transaction_type === right.transaction.transaction_type
        || left.cents !== right.cents || left.currency !== right.currency || left.date !== right.date) continue;
      const saved = isConfirmedInternalVatTransfer(left.transaction) && isConfirmedInternalVatTransfer(right.transaction)
        && left.transaction.paired_bank_transaction_id === right.transaction.id
        && right.transaction.paired_bank_transaction_id === left.transaction.id;
      if (saved) {
        result.set(left.transaction.id, { counterpartId: right.transaction.id, kind: 'saved', reason: 'Zapisane powiązanie dwóch stron transferu własnego.' });
        result.set(right.transaction.id, { counterpartId: left.transaction.id, kind: 'saved', reason: 'Zapisane powiązanie dwóch stron transferu własnego.' });
        continue;
      }
      // A reciprocal, already saved pair is authoritative even when an old
      // MT940 statement has no separate account-kind field. Only discovery of
      // NEW pairs needs the source-account classification and account proof.
      if (!left.kind || !right.kind || left.kind === 'unclassified' || right.kind === 'unclassified'
        || left.kind === right.kind || !left.account || !right.account || left.account === right.account) continue;
      if (left.transaction.paired_bank_transaction_id || right.transaction.paired_bank_transaction_id
        || left.transaction.accounting_review_status === 'explained' || right.transaction.accounting_review_status === 'explained') continue;
      // At least one bank-provided counterparty account must explicitly identify
      // the other own account. An equal supplier split payment is insufficient.
      if (normalizeBankStatementAccount(left.transaction.counterparty_account) !== right.account
        && normalizeBankStatementAccount(right.transaction.counterparty_account) !== left.account) continue;
      candidates.set(left.transaction.id, [...(candidates.get(left.transaction.id) || []), right.transaction.id]);
      candidates.set(right.transaction.id, [...(candidates.get(right.transaction.id) || []), left.transaction.id]);
    }
  }
  for (const [id, matches] of candidates) {
    if (matches.length !== 1 || candidates.get(matches[0])?.length !== 1 || result.has(id)) continue;
    result.set(id, {
      counterpartId: matches[0], kind: 'detected',
      reason: 'Jednoznaczne przeciwne operacje własnych rachunków bieżącego i VAT: zgodny rachunek kontrahenta, data, kwota i waluta.',
    });
  }
  return result;
}

/** Called after a successful import or before AI, never by the read-only preview. */
export async function linkDetectedVatTransfersForPeriod(
  client: SupabaseClient,
  { companyId, month, year }: { companyId?: string | null; month: number; year: number },
): Promise<{ linkedPairs: number; warnings: string[] }> {
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year)) throw new Error('Nieprawidłowy okres wyciągu.');
  const statements = await loadBankStatementTransactionPages<BankStatementDeduplicationMetadata>((from, to) => {
    let query = client.from('bank_statements').select(BANK_STATEMENT_DEDUPLICATION_COLUMNS)
      .eq('statement_month', month).eq('statement_year', year).eq('processed', true).eq('validation_status', 'valid');
    if (companyId) query = query.eq('my_company_id', companyId);
    return query.order('id').range(from, to).returns<BankStatementDeduplicationMetadata[]>();
  });
  if (!statements.length) return { linkedPairs: 0, warnings: [] };
  const companyIds = [...new Set(statements.map((statement) => statement.my_company_id).filter((id): id is string => Boolean(id)))];
  const { data: companies, error: companyError } = await client.from('my_companies')
    .select('id,bank_account,vat_bank_account').in('id', companyIds);
  if (companyError) throw companyError;
  const companyAccounts: VatTransferCompanyAccounts = new Map((companies || []).map((company) => [company.id, company]));
  const transactions: VatTransferTransaction[] = [];
  for (let offset = 0; offset < statements.length; offset += 80) {
    transactions.push(...await loadBankStatementTransactionPages<VatTransferTransaction>((from, to) => client.from('bank_transactions')
      .select('*').in('statement_id', statements.slice(offset, offset + 80).map((statement) => statement.id))
      .order('transaction_date').order('id').range(from, to).returns<VatTransferTransaction[]>()));
  }
  const statementMap = new Map(statements.map((statement) => [statement.id, statement]));
  const reconciled = reconcileStatementTransactions(transactions, statementMap);
  const canonicalRows = reconciled.transactions;
  const pairs = findVatTransferPairs(canonicalRows, statementMap, companyAccounts);
  const transactionMap = new Map(canonicalRows.map((transaction) => [transaction.id, transaction]));
  let linkedPairs = 0;
  const warnings: string[] = [];
  for (const [id, pair] of pairs) {
    if (pair.kind !== 'detected' || id >= pair.counterpartId) continue;
    const left = transactionMap.get(id)!;
    const right = transactionMap.get(pair.counterpartId)!;
    const sourceIds = [...new Set([
      ...(reconciled.bySourceId.get(id)?.sources || [left]),
      ...(reconciled.bySourceId.get(pair.counterpartId)?.sources || [right]),
    ].map((transaction) => transaction.id))];
    const { data: freshRows, error: freshError } = await client.from('bank_transactions')
      .select('*').in('id', sourceIds).returns<VatTransferTransaction[]>();
    if (freshError) throw freshError;
    if (!freshRows || freshRows.length !== sourceIds.length) {
      warnings.push('Nie zapisano transferu VAT: zmienił się zestaw operacji źródłowych. Odśwież wyciągi.');
      continue;
    }
    // Notes belong to their original records, not only to the chosen display
    // copy. Never discard a note hidden behind an enriched PDF/MT940 row.
    if (freshRows.some((transaction) => String(transaction.accounting_note || '').trim())) {
      warnings.push('Rozpoznano transfer VAT, ale pozostawiono go do potwierdzenia: co najmniej jedna operacja PDF/MT940 ma zapisany opis, którego automat nie nadpisuje.');
      continue;
    }
    if (freshRows.some((transaction) => hasDocumentAllocation(transaction) || transaction.private_transfer_detected
      || transaction.paired_bank_transaction_id || transaction.accounting_review_status === 'explained')) {
      warnings.push('Nie zapisano transferu VAT: operacja źródłowa ma już powiązanie lub wyjaśnienie. Zachowano dotychczasowe rozliczenie.');
      continue;
    }
    const freshById = new Map(freshRows.map((transaction) => [transaction.id, transaction]));
    const refreshedCanonical = reconcileStatementTransactions(
      transactions.map((transaction) => freshById.get(transaction.id) || transaction), statementMap,
    ).transactions;
    const freshPair = findVatTransferPairs(refreshedCanonical, statementMap, companyAccounts).get(id);
    if (freshPair?.kind !== 'detected' || freshPair.counterpartId !== pair.counterpartId) {
      warnings.push('Nie zapisano transferu VAT: po ponownym odczycie para nie jest już jednoznaczna.');
      continue;
    }
    const leftType = statementMap.get(left.statement_id)?.account_type;
    const rightType = statementMap.get(right.statement_id)?.account_type;
    // The existing atomic RPC requires one explicit VAT statement. A legacy
    // VAT MT940 record must not be silently relabelled merely to satisfy it.
    if ((leftType === 'vat') === (rightType === 'vat')) {
      warnings.push('Rozpoznano transfer VAT ze starego importu MT940, ale nie zapisano pary: najpierw przypisz temu wyciągowi rodzaj rachunku VAT.');
      continue;
    }
    const { error } = await client.rpc('link_vat_account_transactions', {
      p_transaction_id: id,
      p_counterpart_transaction_id: pair.counterpartId,
      p_note: `Automatyczny transfer między rachunkiem bieżącym i VAT. ${pair.reason} Nie jest dodatkową płatnością faktury.`,
    });
    if (error) {
      warnings.push(`Nie zapisano pary transferu VAT — pozostaje do kontroli: ${error.message || 'zmienił się stan powiązań'}.`);
      continue;
    }
    linkedPairs += 1;
  }
  return { linkedPairs, warnings: [...new Set(warnings)] };
}
