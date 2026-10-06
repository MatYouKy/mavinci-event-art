import { externalDocumentKindLabel } from '@/lib/invoices/externalDocumentKinds';
import { loadExternalDocumentKinds } from '@/lib/invoices/loadExternalDocumentKinds';
import { loadPersonnelPaymentBreakdowns, salaryPaymentNeedsNetConfirmation } from '@/lib/personnel/payrollMatching';
import { isConfirmedInternalVatTransfer } from '@/lib/CRM/bankVatTransfers';

export type BankMatchDocumentSource = 'invoice' | 'ksef' | 'external' | 'personnel';

export interface BankMatchCandidateRow {
  document_source: BankMatchDocumentSource;
  document_id: string;
  document_number: string | null;
  ksef_reference_number: string | null;
  gross_amount: number | string;
  outstanding_amount: number | string;
  issue_date: string | null;
  due_date: string | null;
  counterparty_name: string | null;
  counterparty_nip: string | null;
  currency: string;
  expected_direction: 'credit' | 'debit';
  document_kind?: string | null;
}

export interface BankMatchCandidate {
  documentSource: BankMatchDocumentSource;
  documentId: string;
  invoiceId: string;
  invoiceNumber: string;
  ksefReferenceNumber: string | null;
  amount: number;
  outstandingAmount: number;
  dueDate: string;
  issueDate: string;
  buyerName: string;
  currency: string;
  confidence: number;
  matchReason: string[];
  externalDocumentKind?: string;
}

interface StoredBankTransaction {
  id: string;
  statement_id: string;
  transaction_date: string;
  amount: number | string;
  currency: string | null;
  transaction_type: 'credit' | 'debit';
  counterparty_name: string | null;
  title: string | null;
  raw_description?: string | null;
  raw_counterparty?: string | null;
  allocated_amount?: number | string | null;
  private_transfer_detected?: boolean | null;
  paired_bank_transaction_id?: string | null;
  accounting_category?: string | null;
  accounting_subtype?: string | null;
  accounting_review_status?: string | null;
  source_index?: number | null;
  source_balance_before?: number | string | null;
  source_balance_after?: number | string | null;
  source_verified?: boolean | null;
}

export async function assertBankTransactionCanMatchDocuments(supabase: any, transactionId: string) {
  const { data, error } = await supabase.from('bank_transactions')
    .select('id,statement_id,paired_bank_transaction_id,accounting_category,accounting_subtype,accounting_review_status')
    .eq('id', transactionId).single();
  if (error) throw error;
  if (data?.paired_bank_transaction_id || (data && isConfirmedInternalVatTransfer(data))) {
    throw new Error('To powiązany transfer między rachunkiem bieżącym i VAT, a nie płatność faktury. Pozostaje widoczny na wyciągach.');
  }
}

interface BankCounterpartyMapping {
  my_company_id: string | null;
  alias_pattern: string;
  normalized_alias: string;
  counterparty_name: string;
  counterparty_nip: string | null;
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isBankStatementMatchablePaymentMethod(
  paymentMethod?: string | null,
  source?: BankMatchDocumentSource,
) {
  const normalized = normalizeText(paymentMethod);
  if (!normalized) return true;

  // KSeF FA(2)/FA(3): code 1 means cash. Other codes can either appear on a
  // bank statement (transfer/card) or need a manual decision, so they stay visible.
  if (source === 'ksef' && normalized === '1') return false;

  return normalized !== 'CASH'
    && normalized !== 'CASHONDELIVERY'
    && normalized !== 'PAYMENTINCASH'
    && !normalized.startsWith('GOTOWK');
}

function onlyDigits(value?: string | null) {
  return String(value || '').replace(/\D/g, '');
}

function differenceInDays(left?: string | null, right?: string | null) {
  if (!left || !right) return null;
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) return null;
  return Math.abs(leftDate.getTime() - rightDate.getTime()) / 86_400_000;
}

function scoreCandidate(
  transaction: StoredBankTransaction,
  row: BankMatchCandidateRow,
  mapping?: BankCounterpartyMapping | null,
) {
  const reasons: string[] = [];
  let confidence = 0;

  const transactionAmount = Math.max(
    Math.abs(Number(transaction.amount || 0)) - Number(transaction.allocated_amount || 0),
    0,
  );
  const outstanding = Number(row.outstanding_amount || 0);
  const gross = Number(row.gross_amount || 0);
  if (transactionAmount <= 0 || outstanding <= 0) return null;

  const amountDifference = Math.abs(transactionAmount - outstanding);
  const amountRatio = amountDifference / Math.max(outstanding, 0.01);
  if (amountDifference <= 0.01) {
    confidence += 0.45;
    reasons.push('Dokładna pozostała kwota');
  } else if (amountDifference <= 1) {
    confidence += 0.34;
    reasons.push('Pozostała kwota różni się maksymalnie o 1 zł');
  } else if (transactionAmount < outstanding) {
    confidence += 0.16;
    reasons.push('Możliwa płatność częściowa');
  } else if (amountRatio <= 0.03) {
    confidence += 0.18;
    reasons.push('Kwota zbliżona');
  } else if (transactionAmount > outstanding) {
    confidence += 0.06;
    reasons.push('Możliwy przelew za kilka dokumentów');
  }

  const title = normalizeText(transaction.title || transaction.raw_description);
  const documentNumber = normalizeText(row.document_number);
  const ksefNumber = normalizeText(row.ksef_reference_number);
  if (title && documentNumber && title.includes(documentNumber)) {
    confidence += 0.42;
    reasons.push('Dokładny numer dokumentu w tytule');
  } else if (title && documentNumber.length >= 6 && title.includes(documentNumber.slice(-6))) {
    confidence += 0.18;
    reasons.push('Końcówka numeru dokumentu w tytule');
  }
  if (title && ksefNumber && title.includes(ksefNumber)) {
    confidence += 0.48;
    reasons.push('Dokładny numer KSeF w tytule');
  }

  const searchableTransaction = normalizeText(
    `${transaction.counterparty_name || transaction.raw_counterparty || ''} ${transaction.title || ''} ${mapping?.counterparty_name || ''}`,
  );
  const counterparty = normalizeText(row.counterparty_name);
  if (
    searchableTransaction &&
    counterparty.length >= 6 &&
    (searchableTransaction.includes(counterparty) ||
      searchableTransaction.includes(counterparty.slice(0, Math.min(counterparty.length, 12))))
  ) {
    confidence += 0.18;
    reasons.push('Kontrahent pasuje');
  }

  const mappedCounterparty = normalizeText(mapping?.counterparty_name);
  if (
    mappedCounterparty
    && counterparty
    && (mappedCounterparty.includes(counterparty) || counterparty.includes(mappedCounterparty))
  ) {
    confidence += 0.38;
    reasons.push(`Szablon mapowania: ${mapping?.alias_pattern}`);
  }

  const nip = onlyDigits(row.counterparty_nip);
  const transactionDigits = onlyDigits(
    `${transaction.counterparty_name || ''} ${transaction.title || ''} ${transaction.raw_description || ''}`,
  );
  if (nip.length === 10 && transactionDigits.includes(nip)) {
    confidence += 0.28;
    reasons.push('NIP kontrahenta pasuje');
  }
  if (nip.length === 10 && nip === onlyDigits(mapping?.counterparty_nip)) {
    confidence += 0.34;
    reasons.push('NIP ze szablonu mapowania pasuje');
  }

  const dueDays = differenceInDays(transaction.transaction_date, row.due_date);
  if (dueDays != null && dueDays <= 3) {
    confidence += 0.1;
    reasons.push('Data bliska terminowi płatności');
  } else if (dueDays != null && dueDays <= 14) {
    confidence += 0.05;
    reasons.push('Data w pobliżu terminu płatności');
  }

  const issueDays = differenceInDays(transaction.transaction_date, row.issue_date);
  if (issueDays != null && issueDays <= 7) {
    confidence += 0.04;
    reasons.push('Data bliska wystawieniu');
  }

  confidence = Math.min(Number(confidence.toFixed(3)), 1);
  if (confidence < 0.28) return null;

  return {
    documentSource: row.document_source,
    documentId: row.document_id,
    invoiceId: row.document_id,
    invoiceNumber: row.document_number || row.ksef_reference_number || 'Dokument bez numeru',
    ksefReferenceNumber: row.ksef_reference_number,
    amount: gross,
    outstandingAmount: outstanding,
    dueDate: row.due_date || row.issue_date || '',
    issueDate: row.issue_date || '',
    buyerName: row.counterparty_name || 'Nieznany kontrahent',
    currency: row.currency || 'PLN',
    confidence,
    matchReason: [...new Set(reasons)],
    externalDocumentKind: row.document_source === 'external' ? row.document_kind || 'invoice' : undefined,
  } satisfies BankMatchCandidate;
}

export function getBankMatchSourceLabel(source: BankMatchDocumentSource, externalDocumentKind?: string | null) {
  if (source === 'ksef') return 'KSeF';
  if (source === 'external') return externalDocumentKind
    ? `${externalDocumentKindLabel(externalDocumentKind)} · poza KSeF`
    : 'Poza KSeF';
  if (source === 'personnel') return 'Kadry';
  return 'CRM';
}

export async function findBankTransactionMatchCandidates(
  supabase: any,
  transactionId: string,
  options?: { useCounterpartyMappings?: boolean },
) {
  const [{ data: transaction, error: transactionError }, { data: rows, error: candidatesError }] =
    await Promise.all([
      supabase
        .from('bank_transactions')
        .select(
          'id,statement_id,transaction_date,amount,currency,transaction_type,counterparty_name,title,raw_description,raw_counterparty,allocated_amount,private_transfer_detected,paired_bank_transaction_id,accounting_category,accounting_subtype,accounting_review_status,source_index,source_balance_before,source_balance_after,source_verified',
        )
        .eq('id', transactionId)
        .single(),
      supabase.rpc('get_bank_match_candidates', { p_transaction_id: transactionId }),
    ]);

  if (transactionError) throw transactionError;
  if (candidatesError) throw candidatesError;

  const storedTransaction = transaction as StoredBankTransaction;
  if (storedTransaction.private_transfer_detected || storedTransaction.paired_bank_transaction_id
    || isConfirmedInternalVatTransfer(storedTransaction)) return [];

  const candidateRows = (rows || []) as BankMatchCandidateRow[];
  const externalKinds = await loadExternalDocumentKinds(
    supabase,
    candidateRows.filter((row) => row.document_source === 'external').map((row) => row.document_id),
  );
  const personnelPayments = await loadPersonnelPaymentBreakdowns(
    supabase,
    candidateRows.filter((row) => row.document_source === 'personnel').map((row) => row.document_id),
  );
  const ksefCandidateIds = candidateRows
    .filter((row) => row.document_source === 'ksef')
    .map((row) => row.document_id);
  const ksefPaymentMethods = ksefCandidateIds.length > 0
    ? await supabase
      .from('ksef_invoices')
      .select('id,payment_method')
      .in('id', ksefCandidateIds)
    : { data: [], error: null };
  if (ksefPaymentMethods.error) throw ksefPaymentMethods.error;
  const cashKsefIds = new Set(
    (ksefPaymentMethods.data || [])
      .filter((invoice: { payment_method?: string | null }) => (
        !isBankStatementMatchablePaymentMethod(invoice.payment_method, 'ksef')
      ))
      .map((invoice: { id: string }) => invoice.id),
  );

  const { data: statement } = await supabase
    .from('bank_statements')
    .select('my_company_id')
    .eq('id', storedTransaction.statement_id)
    .maybeSingle();
  let mappingRows: BankCounterpartyMapping[] = [];
  if (options?.useCounterpartyMappings !== false) {
    let mappingsQuery = supabase
      .from('bank_counterparty_mapping_templates')
      .select('my_company_id,alias_pattern,normalized_alias,counterparty_name,counterparty_nip')
      .eq('is_active', true);
    mappingsQuery = statement?.my_company_id
      ? mappingsQuery.or(`my_company_id.eq.${statement.my_company_id},my_company_id.is.null`)
      : mappingsQuery.is('my_company_id', null);
    const mappingsResult = await mappingsQuery;
    mappingRows = (mappingsResult.data || []) as BankCounterpartyMapping[];
  }
  const transactionText = normalizeText(
    `${storedTransaction.counterparty_name || storedTransaction.raw_counterparty || ''} ${storedTransaction.title || ''} ${storedTransaction.raw_description || ''}`,
  );
  const mapping = mappingRows
    .filter((item) => transactionText.includes(item.normalized_alias || normalizeText(item.alias_pattern)))
    .sort((left, right) => {
      const companyDifference = Number(Boolean(right.my_company_id)) - Number(Boolean(left.my_company_id));
      if (companyDifference !== 0) return companyDifference;
      return right.normalized_alias.length - left.normalized_alias.length;
    })[0] || null;

  return candidateRows
    .filter((row) => row.document_source !== 'ksef' || !cashKsefIds.has(row.document_id))
    .filter((row) => {
      if (row.document_source !== 'personnel') return true;
      const payment = personnelPayments.get(row.document_id);
      return Boolean(payment && !payment.linkedTransactionId && !salaryPaymentNeedsNetConfirmation(payment));
    })
    .map((row) => {
      const payment = row.document_source === 'personnel' ? personnelPayments.get(row.document_id) : null;
      return payment ? { ...row, gross_amount: payment.amount, outstanding_amount: payment.amount } : row;
    })
    .map((row) => scoreCandidate(storedTransaction, row.document_source === 'external'
      ? { ...row, document_kind: externalKinds.get(row.document_id) || 'invoice' }
      : row, mapping))
    .filter((candidate): candidate is BankMatchCandidate => Boolean(candidate))
    .sort((left, right) => right.confidence - left.confidence);
}

export async function applyBankTransactionMatch(
  supabase: any,
  input: {
    transactionId: string;
    candidate: BankMatchCandidate;
    amount?: number | null;
    method?: 'automatic' | 'manual';
  },
) {
  return applyBankTransactionMatchToDocument(supabase, {
    transactionId: input.transactionId,
    documentSource: input.candidate.documentSource,
    documentId: input.candidate.documentId,
    amount: input.amount,
    confidence: input.candidate.confidence,
    method: input.method,
    reasons: input.candidate.matchReason,
  });
}

export async function applyBankTransactionMatchToDocument(
  supabase: any,
  input: {
    transactionId: string;
    documentSource: BankMatchDocumentSource;
    documentId: string;
    amount?: number | null;
    confidence?: number | null;
    method?: 'automatic' | 'manual';
    reasons?: string[];
  },
) {
  await assertBankTransactionCanMatchDocuments(supabase, input.transactionId);
  const { data, error } = await supabase.rpc('match_bank_transaction_to_document', {
    p_transaction_id: input.transactionId,
    p_document_source: input.documentSource,
    p_document_id: input.documentId,
    p_amount: input.amount ?? null,
    p_confidence: input.confidence ?? null,
    p_match_method: input.method || 'manual',
    p_match_reasons: input.reasons || [],
  });
  if (error) throw error;
  return data;
}

export async function reconcilePaidKsefInvoiceWithBankTransaction(
  supabase: any,
  input: {
    transactionId: string;
    ksefInvoiceId: string;
    amount: number;
    confidence?: number | null;
    reasons?: string[];
  },
) {
  await assertBankTransactionCanMatchDocuments(supabase, input.transactionId);
  const { data, error } = await supabase.rpc('reconcile_paid_ksef_invoice_with_bank_transaction', {
    p_transaction_id: input.transactionId,
    p_ksef_invoice_id: input.ksefInvoiceId,
    p_amount: input.amount,
    p_confidence: input.confidence ?? null,
    p_match_reasons: input.reasons || [],
  });
  if (error) throw error;
  return data;
}

export async function reconcileExternalInvoiceWithBankTransaction(
  supabase: any,
  input: {
    transactionId: string;
    externalInvoiceId: string;
    transactionAmount: number;
    documentAmount: number;
    confidence?: number | null;
    reasons?: string[];
    reviewNote?: string | null;
  },
) {
  await assertBankTransactionCanMatchDocuments(supabase, input.transactionId);
  const reviewNote = input.reviewNote?.trim() || null;
  const functionName = reviewNote
    ? 'reconcile_external_invoice_with_bank_transaction_with_review'
    : 'reconcile_external_invoice_with_bank_transaction';
  const { data, error } = await supabase.rpc(functionName, {
    p_transaction_id: input.transactionId,
    p_external_invoice_id: input.externalInvoiceId,
    p_transaction_amount: input.transactionAmount,
    p_document_amount: input.documentAmount,
    p_confidence: input.confidence ?? null,
    p_match_reasons: input.reasons || [],
    ...(reviewNote ? { p_review_note: reviewNote } : {}),
  });
  if (error) {
    if (reviewNote && error.code === 'PGRST202') {
      throw new Error('Zapisywanie uwag do dopasowania wymaga migracji 20260904131000 w Supabase.');
    }
    throw error;
  }
  return data;
}

export async function reconcilePersonnelPaymentWithBankTransaction(
  supabase: any,
  input: {
    transactionId: string;
    personnelPaymentId: string;
    amount: number;
    confidence?: number | null;
    reasons?: string[];
  },
) {
  await assertBankTransactionCanMatchDocuments(supabase, input.transactionId);
  const payments = await loadPersonnelPaymentBreakdowns(supabase, [input.personnelPaymentId]);
  const payment = payments.get(input.personnelPaymentId);
  if (!payment) throw new Error('Nie można odczytać aktualnej płatności kadrowej. Otwórz dokument ponownie.');
  if (salaryPaymentNeedsNetConfirmation(payment)) {
    throw new Error('Najpierw potwierdź kwotę netto na konto w Umowy personelu → Otwórz umowę → Uzupełnij netto. Łączna kwota umowy nie jest wypłatą dla pracownika.');
  }
  if (Math.abs(payment.amount - input.amount) > 0.01) {
    throw new Error('Kwota wypłaty zmieniła się od czasu analizy. Otwórz ponownie wybór dokumentu, aby pobrać aktualną kwotę netto.');
  }
  const { data, error } = await supabase.rpc('reconcile_personnel_payment_with_bank_transaction', {
    p_transaction_id: input.transactionId,
    p_personnel_payment_id: input.personnelPaymentId,
    p_amount: input.amount,
    p_confidence: input.confidence ?? null,
    p_match_reasons: input.reasons || [],
  });
  if (error) {
    if (error.code === 'PGRST202') {
      throw new Error('Dopasowanie wynagrodzeń wymaga migracji 20260903213000 w Supabase.');
    }
    throw error;
  }
  return data;
}

export async function matchBankTransactionToDocuments(
  supabase: any,
  input: {
    transactionId: string;
    documents: Array<{
      documentSource: BankMatchDocumentSource;
      documentId: string;
      amount: number;
    }>;
    reviewNote?: string | null;
  },
) {
  await assertBankTransactionCanMatchDocuments(supabase, input.transactionId);
  const reviewNote = input.reviewNote?.trim() || null;
  const functionName = reviewNote
    ? 'match_bank_transaction_to_documents_with_review'
    : 'match_bank_transaction_to_documents';
  const { data, error } = await supabase.rpc(functionName, {
    p_transaction_id: input.transactionId,
    p_documents: input.documents.map((document) => ({
      source: document.documentSource,
      documentId: document.documentId,
      amount: document.amount,
    })),
    ...(reviewNote ? { p_review_note: reviewNote } : {}),
  });
  if (error) {
    if (reviewNote && error.code === 'PGRST202') {
      throw new Error('Zapisywanie uwag do dopasowania wymaga migracji 20260904131000 w Supabase.');
    }
    throw error;
  }
  return data || [];
}

export async function removeBankTransactionMatch(
  supabase: any,
  transactionId: string,
  matchId?: string | null,
) {
  const { data, error } = await supabase.rpc('unmatch_bank_transaction', {
    p_transaction_id: transactionId,
    p_match_id: matchId || null,
  });
  if (error) throw error;
  return Number(data || 0);
}

export async function tryAutomaticBankTransactionMatch(
  supabase: any,
  transactionId: string,
  options?: { useCounterpartyMappings?: boolean },
) {
  const candidates = await findBankTransactionMatchCandidates(supabase, transactionId, options);
  const best = candidates[0];
  const second = candidates[1];
  if (!best) return { matched: false, candidates };

  const hasExactDocumentIdentifier = best.matchReason.some((reason) =>
    ['Dokładny numer dokumentu w tytule', 'Dokładny numer KSeF w tytule'].includes(reason),
  );
  const hasSafeMargin = !second || best.confidence - second.confidence >= 0.15;
  if (best.confidence < 0.92 || !hasExactDocumentIdentifier || !hasSafeMargin) {
    return { matched: false, candidates };
  }

  await applyBankTransactionMatch(supabase, {
    transactionId,
    candidate: best,
    method: 'automatic',
  });
  const { data: transactionState, error: stateError } = await supabase
    .from('bank_transactions')
    .select('match_status')
    .eq('id', transactionId)
    .single();
  if (stateError) throw stateError;
  return {
    matched: transactionState?.match_status === 'matched',
    applied: true,
    candidates,
  };
}
