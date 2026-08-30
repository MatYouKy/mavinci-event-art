export type BankMatchDocumentSource = 'invoice' | 'ksef' | 'external';

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
}

interface StoredBankTransaction {
  id: string;
  transaction_date: string;
  amount: number | string;
  currency: string | null;
  transaction_type: 'credit' | 'debit';
  counterparty_name: string | null;
  title: string | null;
  raw_description?: string | null;
  raw_counterparty?: string | null;
  allocated_amount?: number | string | null;
}

function normalizeText(value?: string | null) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
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

function scoreCandidate(transaction: StoredBankTransaction, row: BankMatchCandidateRow) {
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
    `${transaction.counterparty_name || transaction.raw_counterparty || ''} ${transaction.title || ''}`,
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

  const nip = onlyDigits(row.counterparty_nip);
  const transactionDigits = onlyDigits(
    `${transaction.counterparty_name || ''} ${transaction.title || ''} ${transaction.raw_description || ''}`,
  );
  if (nip.length === 10 && transactionDigits.includes(nip)) {
    confidence += 0.28;
    reasons.push('NIP kontrahenta pasuje');
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
  } satisfies BankMatchCandidate;
}

export function getBankMatchSourceLabel(source: BankMatchDocumentSource) {
  if (source === 'ksef') return 'KSeF';
  if (source === 'external') return 'Poza KSeF';
  return 'CRM';
}

export async function findBankTransactionMatchCandidates(supabase: any, transactionId: string) {
  const [{ data: transaction, error: transactionError }, { data: rows, error: candidatesError }] =
    await Promise.all([
      supabase
        .from('bank_transactions')
        .select(
          'id,transaction_date,amount,currency,transaction_type,counterparty_name,title,raw_description,raw_counterparty,allocated_amount',
        )
        .eq('id', transactionId)
        .single(),
      supabase.rpc('get_bank_match_candidates', { p_transaction_id: transactionId }),
    ]);

  if (transactionError) throw transactionError;
  if (candidatesError) throw candidatesError;

  return ((rows || []) as BankMatchCandidateRow[])
    .map((row) => scoreCandidate(transaction as StoredBankTransaction, row))
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

export async function tryAutomaticBankTransactionMatch(supabase: any, transactionId: string) {
  const candidates = await findBankTransactionMatchCandidates(supabase, transactionId);
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
