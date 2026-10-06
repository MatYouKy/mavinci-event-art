import { loadBankStatementTransactionPages } from '@/lib/bankStatementDeduplication';

type ProtectedTransaction = {
  id: string;
  statement_id: string;
  allocated_amount: number | string | null;
  matched_document_count: number | null;
  matched_invoice_id: string | null;
  match_status: string | null;
  paired_bank_transaction_id: string | null;
  private_transfer_detected: boolean | null;
  accounting_note: string | null;
  accounting_review_status: string | null;
};

const TRANSACTION_FIELDS = [
  'id', 'statement_id', 'allocated_amount', 'matched_document_count', 'matched_invoice_id',
  'match_status', 'paired_bank_transaction_id', 'private_transfer_detected',
  'accounting_note', 'accounting_review_status',
].join(',');

const REFERENCES = [
  { table: 'bank_transaction_invoice_matches', column: 'bank_transaction_id', label: 'dopasowania dokumentów' },
  { table: 'bank_transaction_supporting_documents', column: 'bank_transaction_id', label: 'dokumenty dołączone do płatności' },
  { table: 'accounting_document_followups', column: 'bank_transaction_id', label: 'lista dokumentów do późniejszego dosłania' },
  { table: 'personnel_contract_payments', column: 'bank_transaction_id', label: 'rozliczenia umów i wynagrodzeń' },
  { table: 'bank_counterparty_mapping_templates', column: 'source_transaction_id', label: 'zapisane reguły rozpoznawania kontrahentów' },
  // Check the opposite direction too: a stale local pair column must not let
  // deletion silently clear a link saved on another account's transaction.
  { table: 'bank_transactions', column: 'paired_bank_transaction_id', label: 'transfery powiązane z drugim rachunkiem' },
] as const;

/** Read-only preflight for one explicitly confirmed source-file removal.
 * This is not a database lock: call immediately before deleting the exact ID.
 */
export async function assertBankStatementCanBeRemoved(supabase: any, statementId: string): Promise<void> {
  if (!statementId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(statementId)) {
    throw new Error('Nie wskazano prawidłowego wyciągu do usunięcia.');
  }
  const { data: statement, error: statementError } = await supabase.from('bank_statements')
    .select('id,my_company_id').eq('id', statementId).maybeSingle();
  if (statementError || !statement?.id || !statement.my_company_id) {
    throw new Error('Nie można potwierdzić wyciągu i jego działalności. Niczego nie usunięto.');
  }
  // Statement visibility above is already scoped by the company's RLS policy.
  const { data: canManage, error: manageError } = await supabase.rpc('finance_can_manage');
  if (manageError || canManage !== true) {
    throw new Error('Nie można potwierdzić uprawnień do pełnej kontroli rozliczeń tej działalności. Wyciąg nie został usunięty.');
  }

  let transactions: ProtectedTransaction[];
  try {
    transactions = await loadBankStatementTransactionPages<ProtectedTransaction>((from, to) => supabase
      .from('bank_transactions').select(TRANSACTION_FIELDS).eq('statement_id', statementId)
      .order('id', { ascending: true }).range(from, to));
  } catch {
    throw new Error('Nie udało się odczytać wszystkich operacji wyciągu. Usunięcie zostało wstrzymane.');
  }
  for (const transaction of transactions) {
    const allocated = Number(transaction.allocated_amount ?? 0);
    const documentCount = Number(transaction.matched_document_count ?? 0);
    if (!Number.isFinite(allocated) || !Number.isFinite(documentCount)
      || (transaction.match_status && !['unmatched', 'partial', 'matched'].includes(transaction.match_status))) {
      throw new Error('Nie można jednoznacznie sprawdzić stanu dopasowań. Wyciąg pozostaje bez zmian.');
    }
    if (allocated > 0 || documentCount > 0 || transaction.matched_invoice_id
      || transaction.match_status === 'matched' || transaction.match_status === 'partial'
      || transaction.paired_bank_transaction_id || transaction.private_transfer_detected
      || String(transaction.accounting_note || '').trim() || transaction.accounting_review_status === 'explained') {
      throw new Error('Nie można usunąć tego wyciągu: zawiera dopasowania, opisy, wyjaśnienia, przelewy prywatne lub połączone transfery. Zachowano istniejące rozliczenia.');
    }
  }
  if (!transactions.length) return;

  // RLS can return an empty payroll result without an error. Verify access
  // explicitly rather than interpreting an invisible relation as no relation.
  const { data: canViewPersonnel, error: personnelPermissionError } = await supabase.rpc('can_view_personnel_contracts');
  if (personnelPermissionError || canViewPersonnel !== true) {
    throw new Error('Usunięcie wymaga sprawdzenia powiązań kadrowych. Nie potwierdzono dostępu do tych danych; wyciąg pozostaje bez zmian.');
  }
  const ids = transactions.map((transaction) => transaction.id);
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const results = await Promise.all(REFERENCES.map(async (reference) => {
      try {
        const { count, error } = await supabase.from(reference.table)
          .select('id', { count: 'exact', head: true }).in(reference.column, chunk);
        if (error || typeof count !== 'number' || !Number.isFinite(count)) {
          throw new Error(`Nie udało się sprawdzić powiązań: ${reference.label}. Wyciąg nie został usunięty.`);
        }
        return { label: reference.label, count };
      } catch {
        // Missing tables/columns are also unsafe; never treat them as zero.
        throw new Error(`Nie udało się sprawdzić powiązań: ${reference.label}. Wyciąg nie został usunięty.`);
      }
    }));
    const linked = results.filter((result) => result.count > 0);
    if (linked.length) {
      throw new Error(`Nie można usunąć tego wyciągu, ponieważ istnieją powiązania: ${linked.map((result) => result.label).join(', ')}. Najpierw sprawdź je w CRM.`);
    }
  }
}
