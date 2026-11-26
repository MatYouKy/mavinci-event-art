import { matchBankTransactionToDocuments } from '@/lib/bankTransactionMatching';
import { repairBrokenBankText } from '@/lib/bankTextEncoding';
import { decodeTextEntities } from '@/lib/textEncoding';

/*
 * Rozliczenie faktury korygującej KSeF „in minus” (zwrot) — wspólne dla CRM (`KsefCorrectionSettlementModal`, klient
 * przeglądarki) i Maca (`/bridge/native/v1/finance`, op=ksefCorrection…, klient z tokenem pracownika):
 *  - faktura korygowana z XML korekty (`DaneFaKorygowanej`: `NrKSeFFaKorygowanej`, a bez niego `NrFaKorygowanej` + NIP
 *    kontrahenta), ta sama działalność i strona (otrzymane / wystawione);
 *  - jej płatność z wyciągu: powiązane operacje i operacje do powiązania (kierunek płatności, ±okno dat, pozostała kwota);
 *    faktura oznaczona jako opłacona bez operacji (np. „Zapłacono” w XML — karta przy zakupie) też może dostać operację —
 *    `match_bank_transaction_to_documents` zamienia wtedy oznaczenie na powiązanie z wyciągiem;
 *  - zwrot korekty z wyciągu: operacja przeciwnego kierunku (dla kosztowej — wpływ) powiązana z korektą;
 *  - kompensata: gdy faktura korygowana nie była jeszcze opłacona, korekta pomniejsza kwotę do zapłaty — po jednej wpłacie
 *    w rejestrze obu faktur (`ksef_invoice_payments`, opis „Kompensata …”), bez operacji bankowej.
 * Uprawnienia sprawdza baza (RLS, `finance_manage` w RPC dopasowań) — tu tylko spójność danych.
 */

type Row = Record<string, any>;
// Klient Supabase (przeglądarka albo serwer z tokenem pracownika) — bez typów wygenerowanych z bazy, jak w dopasowaniach.
type Client = any;

export type CorrectionDirection = 'credit' | 'debit';

export interface CorrectionPayment {
  id: string;
  amount: number;
  date: string | null;
  notes: string | null;
  fromBank: boolean;
  /** Wpłata z kompensaty korekty z fakturą korygowaną. */
  offset: boolean;
}

export interface CorrectionTransaction {
  id: string;
  statementId: string;
  /** Dopasowanie do tej faktury (operacje powiązane); `null` — operacja do powiązania. */
  matchId: string | null;
  date: string;
  /** Kwota operacji (bez znaku); kierunek w `direction`. */
  amount: number;
  direction: CorrectionDirection;
  currency: string;
  /** Kwota operacji jeszcze nierozliczona (faktury, wypłaty, deklaracje, umowy, pary zwrotu). */
  remaining: number;
  /** Kwota powiązana z tą fakturą (operacje powiązane). */
  linkedAmount: number | null;
  /** Kwota, którą zapisze „Powiąż” (mniejsza z pozostałej operacji i pozostałej faktury). */
  linkAmount: number;
  party: string | null;
  title: string | null;
  statementYear: number | null;
  statementMonth: number | null;
  explained: boolean;
  score: number;
  reasons: string[];
}

export interface CorrectionOffset {
  /** Kwota już rozliczona kompensatą z tą fakturą korygowaną. */
  amount: number;
  date: string | null;
  /** Ile jeszcze można rozliczyć kompensatą. */
  available: number;
  /** Dlaczego kompensata nie jest możliwa (gdy `available` = 0). */
  blocked: string | null;
}

export interface CorrectionDocument {
  id: string;
  number: string | null;
  ksefNumber: string;
  side: 'issued' | 'received';
  issueDate: string | null;
  party: string | null;
  partyNip: string | null;
  /** Kwota do zapłaty ze znakiem (korekta „in minus” — ujemna). */
  gross: number;
  /** Kwota do rozliczenia bez znaku. */
  due: number;
  /** Suma wpłat w rejestrze (ręcznych, z wyciągu i kompensat). */
  paid: number;
  /** Pozostało do rozliczenia (0 dla faktury oznaczonej jako opłacona). */
  open: number;
  /** Ile można jeszcze powiązać z wyciągiem. */
  bankOpen: number;
  /** Suma powiązań z wyciągiem. */
  bankLinked: number;
  paymentStatus: string | null;
  paymentDate: string | null;
  currency: string;
  /** Kierunek operacji, która rozlicza dokument (jak `get_bank_match_candidates`). */
  direction: CorrectionDirection;
  /** Dlaczego nie można teraz powiązać operacji z wyciągu (np. faktura rozliczona kompensatą i wpłatą ręczną). */
  linkBlocked: string | null;
  payments: CorrectionPayment[];
  transactions: CorrectionTransaction[];
  candidates: CorrectionTransaction[];
  /** Tylko faktura korygowana korekty „in minus”. */
  offset: CorrectionOffset | null;
}

export interface CorrectionReference {
  number: string | null;
  ksefNumber: string | null;
  /** Id faktury korygowanej znalezionej w KSeF tej działalności. */
  documentId: string | null;
}

export interface KsefCorrectionSettlement {
  companyId: string;
  /** `RodzajFaktury` z XML (KOR, KOR_ZAL, KOR_ROZ…). */
  kind: string | null;
  today: string;
  correction: CorrectionDocument;
  references: CorrectionReference[];
  originals: CorrectionDocument[];
}

export class CorrectionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DOC_SELECT = 'id,my_company_id,invoice_type,invoice_number,ksef_reference_number,issue_date,ksef_issued_at,seller_name,seller_nip,buyer_name,buyer_nip,gross_amount,amount_to_pay_gross,currency,payment_status,payment_date,sync_status';
const TX_SELECT = 'id,statement_id,transaction_date,amount,currency,transaction_type,counterparty_name,raw_counterparty,title,raw_description,allocated_amount,private_transfer_detected,paired_bank_transaction_id,canonical_transaction_id,accounting_review_status,accounting_category,bank_statements!inner(my_company_id,processed,validation_status,statement_year,statement_month)';
const CORRECTION_KINDS = ['KOR', 'KOR_ZAL', 'KOR_ROZ'];
/** Słowa nazwy kontrahenta, które nie wyróżniają go w opisie operacji (formy prawne, kraj). */
const PARTY_GENERIC = new Set(['SPOLKA', 'OGRANICZONA', 'ODPOWIEDZIALNOSCIA', 'AKCYJNA', 'KOMANDYTOWA', 'KOMANDYTOWOAKCYJNA', 'JAWNA', 'CYWILNA', 'PARTNERSKA', 'SPZOO', 'POLSKA', 'POLAND']);
/** Najwięcej operacji do powiązania zwracanych dla jednej faktury (najlepiej pasujące). */
const CANDIDATE_LIMIT = 200;

const num = (value: unknown) => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const round2 = (value: number) => Math.round(value * 100) / 100;
const str = (value: unknown) => (value === null || value === undefined ? '' : String(value));
const strOrNull = (value: unknown) => {
  const text = str(value).trim();
  return text ? text : null;
};
const day = (value: unknown) => strOrNull(value)?.slice(0, 10) ?? null;
const digits = (value: unknown) => str(value).replace(/\D/g, '');
const normalize = (value: unknown) => str(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const one = (value: unknown): Row | null => (Array.isArray(value) ? (value[0] as Row) || null : value && typeof value === 'object' ? value as Row : null);
const money = (value: number, currency = 'PLN') =>
  `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`;
const warsawToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function shiftDay(value: string, days: number) {
  const [year, month, date] = value.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + days));
  return shifted.toISOString().slice(0, 10);
}
function dayDistance(a: string, b: string) {
  const parse = (value: string) => {
    const [year, month, date] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, date);
  };
  return Math.round(Math.abs(parse(a) - parse(b)) / 86_400_000);
}

/** Wartości elementu XML (z prefiksem przestrzeni nazw albo bez) — surowa treść, bez dekodowania. */
function xmlBlocks(xml: string, name: string): string[] {
  const pattern = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${name}>`, 'g');
  return Array.from(xml.matchAll(pattern), (match) => match[1]);
}
function xmlValue(xml: string, name: string): string | null {
  const raw = xmlBlocks(xml, name)[0];
  return raw === undefined ? null : strOrNull(decodeTextEntities(raw.replace(/<[^>]*>/g, '')));
}

/** Rodzaj faktury i wskazane w XML faktury korygowane (numer i numer KSeF). */
export function parseCorrectionXml(xml: string | null | undefined) {
  const content = str(xml);
  const references = xmlBlocks(content, 'DaneFaKorygowanej')
    .map((block) => ({ number: xmlValue(block, 'NrFaKorygowanej'), ksefNumber: xmlValue(block, 'NrKSeFFaKorygowanej') }))
    .filter((reference) => reference.number || reference.ksefNumber);
  return { kind: xmlValue(content, 'RodzajFaktury'), references };
}

export const isCorrectionKind = (kind: string | null | undefined) => CORRECTION_KINDS.includes(str(kind).toUpperCase());

/** Opisy wpłat kompensaty w rejestrze obu faktur (po nich kompensata jest rozpoznawana i cofana). */
export function correctionOffsetNotes(correctionLabel: string, originalLabel: string) {
  return {
    correction: `Kompensata z fakturą korygowaną ${originalLabel}`,
    original: `Kompensata korektą ${correctionLabel}`,
  };
}
const isOffsetNote = (notes: unknown) => /^Kompensata (z fakturą korygowaną|korektą) /.test(str(notes));
const docLabel = (row: Row) => strOrNull(row.invoice_number) || str(row.ksef_reference_number);

/** Kwota do zapłaty ze znakiem (jak `bank_document_due_amount`, ale ze znakiem). */
const signedDue = (row: Row) => num(row.amount_to_pay_gross ?? row.gross_amount);
const sideOf = (row: Row): 'issued' | 'received' => (str(row.invoice_type).toLowerCase() === 'issued' ? 'issued' : 'received');
function directionOf(row: Row): CorrectionDirection {
  const positive = signedDue(row) >= 0;
  return sideOf(row) === 'issued' ? (positive ? 'credit' : 'debit') : (positive ? 'debit' : 'credit');
}
const partyName = (row: Row) => strOrNull(decodeTextEntities(sideOf(row) === 'issued' ? row.buyer_name : row.seller_name));
const partyNip = (row: Row) => strOrNull(sideOf(row) === 'issued' ? row.buyer_nip : row.seller_nip);

function transactionOf(row: Row, extra: { matchId?: string | null; linkedAmount?: number | null; linkAmount?: number; score?: number; reasons?: string[] } = {}): CorrectionTransaction {
  const statement = one(row.bank_statements);
  const amount = round2(Math.abs(num(row.amount)));
  return {
    id: str(row.id),
    statementId: str(row.statement_id),
    matchId: extra.matchId ?? null,
    date: str(row.transaction_date).slice(0, 10),
    amount,
    direction: str(row.transaction_type) === 'credit' ? 'credit' : 'debit',
    currency: str(row.currency).toUpperCase() || 'PLN',
    remaining: round2(Math.max(amount - num(row.allocated_amount), 0)),
    linkedAmount: extra.linkedAmount ?? null,
    linkAmount: extra.linkAmount ?? 0,
    party: strOrNull(repairBrokenBankText(strOrNull(row.counterparty_name) || strOrNull(row.raw_counterparty))),
    title: strOrNull(repairBrokenBankText(row.title)),
    statementYear: statement ? num(statement.statement_year) || null : null,
    statementMonth: statement ? num(statement.statement_month) || null : null,
    explained: str(row.accounting_review_status) === 'explained',
    score: extra.score ?? 0,
    reasons: extra.reasons ?? [],
  };
}

/** Operacje główne działalności w kierunku i oknie dat (bez kopii z drugiego wyciągu, przeniesień własnych i par VAT). */
async function windowTransactions(client: Client, companyId: string, direction: CorrectionDirection, currency: string, from: string, to: string) {
  const rows: Row[] = [];
  for (let start = 0; start < 3000; start += 1000) {
    const { data, error } = await client.from('bank_transactions').select(TX_SELECT)
      .eq('bank_statements.my_company_id', companyId)
      .eq('bank_statements.processed', true)
      .eq('bank_statements.validation_status', 'valid')
      .eq('transaction_type', direction)
      .is('canonical_transaction_id', null)
      .is('paired_bank_transaction_id', null)
      .gte('transaction_date', from)
      .lte('transaction_date', to)
      .order('transaction_date', { ascending: false })
      .order('id', { ascending: true })
      .range(start, start + 999);
    if (error) throw new CorrectionError('Nie udało się wczytać operacji z wyciągów.', 500);
    rows.push(...((data || []) as Row[]));
    if ((data || []).length < 1000) break;
  }
  return rows.filter((row) =>
    (str(row.currency).toUpperCase() || 'PLN') === currency
    && row.private_transfer_detected !== true
    && !(str(row.accounting_review_status) === 'explained' && str(row.accounting_category) === 'own_transfer'));
}

/** Ocena operacji jako płatności / zwrotu dokumentu: kwota, numer i NIP w opisie, kontrahent, data. */
function scoreCandidate(row: Row, input: { open: number; due: number; numbers: string[]; party: string | null; nip: string | null; baseDay: string }) {
  const reasons: string[] = [];
  let score = 0;
  const amount = round2(Math.abs(num(row.amount)));
  const remaining = round2(Math.max(amount - num(row.allocated_amount), 0));
  if (Math.abs(remaining - input.open) <= 0.01) {
    score += 5;
    reasons.push('Kwota zgodna');
  } else if (Math.abs(amount - input.due) <= 0.01) {
    score += 3;
    reasons.push('Kwota jak na fakturze');
  }
  const text = normalize([row.title, row.raw_description, row.counterparty_name, row.raw_counterparty].map((value) => repairBrokenBankText(str(value))).join(' '));
  if (input.numbers.some((value) => value.length >= 4 && text.includes(value))) {
    score += 4;
    reasons.push('Numer faktury w opisie');
  }
  if (input.nip && input.nip.length === 10 && digits([row.title, row.raw_description, row.counterparty_name, row.raw_counterparty].join(' ')).includes(input.nip)) {
    score += 2;
    reasons.push('NIP kontrahenta w opisie');
  }
  // Pierwsze wyróżniające słowa nazwy kontrahenta (bez formy prawnej) w opisie operacji.
  const partyWords = str(input.party).split(/[\s,.;:()\-\/"'„”]+/).map(normalize)
    .filter((word) => word.length >= 4 && !PARTY_GENERIC.has(word)).slice(0, 2);
  if (partyWords.some((word) => text.includes(word))) {
    score += 2;
    reasons.push('Kontrahent pasuje');
  }
  const distance = dayDistance(str(row.transaction_date).slice(0, 10), input.baseDay);
  if (distance <= 7) {
    score += 2;
    reasons.push('Bliska data');
  } else if (distance <= 30) {
    score += 1;
  }
  if (str(row.accounting_review_status) === 'explained') reasons.push('Ma już wyjaśnienie bez faktury');
  return { score, reasons, distance, remaining };
}

interface LoadedDocument {
  row: Row;
  payments: Row[];
  matches: Row[];
}

function documentOf(loaded: LoadedDocument, linked: Map<string, Row>): CorrectionDocument {
  const { row, payments, matches } = loaded;
  const due = round2(Math.abs(signedDue(row)));
  const paid = round2(payments.reduce((sum, payment) => sum + num(payment.amount), 0));
  const bankLinked = round2(matches.reduce((sum, match) => sum + num(match.amount), 0));
  const offsetPaid = round2(payments.filter((payment) => !payment.bank_match_id && isOffsetNote(payment.notes)).reduce((sum, payment) => sum + num(payment.amount), 0));
  const status = strOrNull(row.payment_status);
  const isPaid = status === 'paid';
  // Faktura „opłacona” (status): operacja z wyciągu zastępuje oznaczenie ręczne (`reconcile_paid_ksef_invoice_with_bank_transaction`
  // usuwa najnowsze wpłaty ręczne). Wpłata z kompensaty nie może zniknąć bez drugiej strony — przy kompensacie i innej wpłacie
  // ręcznej trzeba najpierw usunąć tę wpłatę ręczną (faktura wróci do „częściowo opłaconej” i operacja dopisze się normalnie).
  const paidRoom = round2(Math.max(due - bankLinked - offsetPaid, 0));
  const linkBlocked = isPaid && offsetPaid > 0.009 && paidRoom > 0.009
    ? 'Faktura jest rozliczona kompensatą i wpłatą ręczną — aby powiązać operację z wyciągu, usuń najpierw wpłatę ręczną (Płatność i termin).'
    : null;
  const bankOpen = linkBlocked ? 0 : (isPaid ? paidRoom : round2(Math.max(due - paid, 0)));
  return {
    id: str(row.id),
    number: strOrNull(row.invoice_number),
    ksefNumber: str(row.ksef_reference_number),
    side: sideOf(row),
    issueDate: day(row.issue_date) ?? day(row.ksef_issued_at),
    party: partyName(row),
    partyNip: partyNip(row),
    gross: round2(signedDue(row)),
    due,
    paid,
    open: isPaid ? 0 : round2(Math.max(due - paid, 0)),
    bankOpen,
    bankLinked,
    paymentStatus: status,
    paymentDate: day(row.payment_date),
    currency: str(row.currency).toUpperCase() || 'PLN',
    direction: directionOf(row),
    linkBlocked,
    payments: payments.map((payment) => ({
      id: str(payment.id),
      amount: round2(num(payment.amount)),
      date: day(payment.payment_date),
      notes: strOrNull(payment.notes),
      fromBank: Boolean(payment.bank_match_id),
      offset: !payment.bank_match_id && isOffsetNote(payment.notes),
    })),
    transactions: matches
      .map((match) => {
        const tx = linked.get(str(match.bank_transaction_id));
        return tx ? transactionOf(tx, { matchId: str(match.id), linkedAmount: round2(num(match.amount)) }) : null;
      })
      .filter((tx): tx is CorrectionTransaction => Boolean(tx))
      .sort((a, b) => a.date.localeCompare(b.date)),
    candidates: [],
    offset: null,
  };
}

async function loadCandidates(client: Client, companyId: string, doc: CorrectionDocument, input: { from: string; to: string; baseDay: string; numbers: string[] }) {
  if (doc.bankOpen <= 0.009) return [];
  const rows = await windowTransactions(client, companyId, doc.direction, doc.currency, input.from, input.to);
  const linkedIds = new Set(doc.transactions.map((tx) => tx.id));
  return rows
    .filter((row) => !linkedIds.has(str(row.id)))
    .map((row) => {
      const scored = scoreCandidate(row, { open: doc.bankOpen, due: doc.due, numbers: input.numbers, party: doc.party, nip: digits(doc.partyNip) || null, baseDay: input.baseDay });
      return { row, ...scored };
    })
    .filter((item) => item.remaining > 0.009)
    .sort((a, b) => b.score - a.score || a.distance - b.distance || str(b.row.transaction_date).localeCompare(str(a.row.transaction_date)))
    .slice(0, CANDIDATE_LIMIT)
    .map((item) => transactionOf(item.row, {
      linkAmount: round2(Math.min(item.remaining, doc.bankOpen)),
      score: item.score,
      reasons: item.reasons,
    }));
}

/**
 * Stan rozliczenia korekty: korekta, faktury korygowane (z XML), wpłaty, powiązane operacje, operacje do powiązania
 * (`candidates: false` — bez nich, np. przed zapisem kompensaty) i możliwa kompensata.
 */
export async function loadKsefCorrectionSettlement(client: Client, correctionId: string, options: { candidates?: boolean } = {}): Promise<KsefCorrectionSettlement> {
  if (!UUID.test(correctionId)) throw new CorrectionError('Nieprawidłowa faktura.');
  const { data: correctionRow, error: correctionError } = await client.from('ksef_invoices')
    .select(`${DOC_SELECT},xml_content`).eq('id', correctionId).maybeSingle();
  if (correctionError) throw new CorrectionError('Nie udało się wczytać faktury.', 500);
  if (!correctionRow) throw new CorrectionError('Nie znaleziono faktury albo nie masz do niej dostępu.', 404);
  const correction = correctionRow as Row;
  const companyId = str(correction.my_company_id);
  if (!companyId) throw new CorrectionError('Faktura nie ma przypisanej działalności.');
  const { kind, references: xmlReferences } = parseCorrectionXml(correction.xml_content);

  // Faktury korygowane: najpierw numer KSeF, potem numer faktury z tym samym NIP kontrahenta (ta sama działalność i strona).
  const ksefNumbers = Array.from(new Set(xmlReferences.map((reference) => reference.ksefNumber).filter((value): value is string => Boolean(value))));
  const numbers = Array.from(new Set(xmlReferences.map((reference) => reference.number).filter((value): value is string => Boolean(value))));
  const found: Row[] = [];
  if (ksefNumbers.length) {
    const { data, error } = await client.from('ksef_invoices').select(DOC_SELECT)
      .eq('my_company_id', companyId).in('ksef_reference_number', ksefNumbers);
    if (error) throw new CorrectionError('Nie udało się wczytać faktury korygowanej.', 500);
    found.push(...((data || []) as Row[]));
  }
  if (numbers.length) {
    const { data, error } = await client.from('ksef_invoices').select(DOC_SELECT)
      .eq('my_company_id', companyId).eq('invoice_type', correction.invoice_type).in('invoice_number', numbers);
    if (error) throw new CorrectionError('Nie udało się wczytać faktury korygowanej.', 500);
    found.push(...((data || []) as Row[]));
  }
  const correctionNip = digits(partyNip(correction));
  const references: CorrectionReference[] = [];
  const originalRows: Row[] = [];
  for (const reference of xmlReferences) {
    const usable = (row: Row) => str(row.id) !== correctionId && sideOf(row) === sideOf(correction) && str(row.sync_status) !== 'error';
    let match = reference.ksefNumber ? found.find((row) => usable(row) && str(row.ksef_reference_number) === reference.ksefNumber) : undefined;
    if (!match && reference.number) {
      match = found
        .filter((row) => usable(row) && str(row.invoice_number) === reference.number)
        .filter((row) => !correctionNip || !digits(partyNip(row)) || digits(partyNip(row)) === correctionNip)
        .sort((a, b) => str(b.issue_date).localeCompare(str(a.issue_date)))[0];
    }
    references.push({ number: reference.number, ksefNumber: reference.ksefNumber, documentId: match ? str(match.id) : null });
    if (match && !originalRows.some((row) => str(row.id) === str(match?.id))) originalRows.push(match);
  }

  // Wpłaty i dopasowania z wyciągów obu stron.
  const ids = [correctionId, ...originalRows.map((row) => str(row.id))];
  const [paymentsRes, matchesRes] = await Promise.all([
    client.from('ksef_invoice_payments').select('id,ksef_invoice_id,amount,payment_date,notes,bank_match_id').in('ksef_invoice_id', ids)
      .order('payment_date', { ascending: true }),
    client.from('bank_transaction_invoice_matches').select('id,bank_transaction_id,ksef_invoice_id,amount').in('ksef_invoice_id', ids),
  ]);
  if (paymentsRes.error || matchesRes.error) throw new CorrectionError('Nie udało się wczytać wpłat faktur.', 500);
  const payments = (paymentsRes.data || []) as Row[];
  const matches = (matchesRes.data || []) as Row[];
  const txIds = Array.from(new Set(matches.map((match) => str(match.bank_transaction_id))));
  const linked = new Map<string, Row>();
  if (txIds.length) {
    const { data, error } = await client.from('bank_transactions').select(TX_SELECT).in('id', txIds);
    if (error) throw new CorrectionError('Nie udało się wczytać operacji z wyciągów.', 500);
    for (const row of (data || []) as Row[]) linked.set(str(row.id), row);
  }
  const load = (row: Row): LoadedDocument => ({
    row,
    payments: payments.filter((payment) => str(payment.ksef_invoice_id) === str(row.id)),
    matches: matches.filter((match) => str(match.ksef_invoice_id) === str(row.id)),
  });
  const correctionDoc = documentOf(load(correction), linked);
  const originals = originalRows.map((row) => documentOf(load(row), linked));

  // Kompensata: korekta „in minus” i dodatnia, jeszcze nieopłacona faktura korygowana w tej samej walucie.
  const correctionLabel = docLabel(correction);
  for (const original of originals) {
    if (!(correctionDoc.gross < 0 && original.gross > 0)) continue;
    const notes = correctionOffsetNotes(correctionLabel, original.number || original.ksefNumber);
    const done = correctionDoc.payments.filter((payment) => payment.offset && payment.notes === notes.correction);
    const amount = round2(done.reduce((sum, payment) => sum + payment.amount, 0));
    let blocked: string | null = null;
    if (original.currency !== correctionDoc.currency) blocked = 'Faktura korygowana jest w innej walucie.';
    else if (correctionDoc.open <= 0.009) blocked = null;
    else if (original.paymentStatus === 'paid' || original.open <= 0.009) {
      blocked = 'Faktura korygowana jest już zapłacona — pieniądze wracają zwrotem: powiąż wpływ z wyciągu z korektą.';
    }
    const available = blocked ? 0 : round2(Math.max(Math.min(correctionDoc.open, original.open), 0));
    original.offset = {
      amount,
      date: done.map((payment) => payment.date).filter((value): value is string => Boolean(value)).sort().pop() ?? null,
      available,
      blocked,
    };
  }

  if (options.candidates !== false) {
    const today = warsawToday();
    const correctionDay = correctionDoc.issueDate || today;
    const originalNumbers = originals.flatMap((doc) => [normalize(doc.number), normalize(doc.ksefNumber)]);
    for (const original of originals) {
      const base = original.issueDate || correctionDay;
      original.candidates = await loadCandidates(client, companyId, original, {
        from: shiftDay(base, -60), to: shiftDay(base, 180), baseDay: base,
        numbers: [normalize(original.number), normalize(original.ksefNumber)],
      });
    }
    const earliest = [correctionDay, ...originals.map((doc) => doc.issueDate).filter((value): value is string => Boolean(value))].sort()[0];
    correctionDoc.candidates = await loadCandidates(client, companyId, correctionDoc, {
      from: shiftDay(earliest, -14), to: shiftDay(correctionDay, 180), baseDay: correctionDay,
      numbers: [normalize(correctionDoc.number), normalize(correctionDoc.ksefNumber), ...originalNumbers],
    });
  }

  return { companyId, kind, today: warsawToday(), correction: correctionDoc, references, originals };
}

/** Działalność faktury KSeF (do sprawdzenia uprawnień przed wczytaniem rozliczenia). */
export async function ksefInvoiceCompany(client: Client, id: string) {
  if (!UUID.test(id)) throw new CorrectionError('Nieprawidłowa faktura.');
  const { data, error } = await client.from('ksef_invoices').select('id,my_company_id').eq('id', id).maybeSingle();
  if (error) throw new CorrectionError('Nie udało się wczytać faktury.', 500);
  if (!data) throw new CorrectionError('Nie znaleziono faktury albo nie masz do niej dostępu.', 404);
  return str((data as Row).my_company_id);
}

/** Dokument tej korekty (korekta albo jedna z faktur korygowanych) — z aktualnego stanu. */
function settlementDocument(settlement: KsefCorrectionSettlement, documentId: string) {
  if (settlement.correction.id === documentId) return settlement.correction;
  const original = settlement.originals.find((doc) => doc.id === documentId);
  if (!original) throw new CorrectionError('Ta faktura nie jest korektą ani fakturą korygowaną z tej korekty.');
  return original;
}

/** „Powiąż” — operacja z wyciągu jako płatność faktury korygowanej albo zwrot korekty. */
export async function linkKsefCorrectionTransaction(client: Client, input: { correctionId: string; documentId: string; transactionId: string; amount: number }) {
  if (!UUID.test(input.transactionId)) throw new CorrectionError('Nieprawidłowa operacja.');
  if (!UUID.test(input.documentId)) throw new CorrectionError('Nieprawidłowa faktura.');
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new CorrectionError('Kwota powiązania musi być większa od zera.');
  const settlement = await loadKsefCorrectionSettlement(client, input.correctionId, { candidates: false });
  const doc = settlementDocument(settlement, input.documentId);
  if (doc.linkBlocked) throw new CorrectionError(doc.linkBlocked);
  if (amount > doc.bankOpen + 0.005) {
    throw new CorrectionError(`Kwota powiązania nie może przekroczyć ${money(doc.bankOpen, doc.currency)} (pozostało do powiązania z wyciągiem).`);
  }
  if (doc.transactions.some((tx) => tx.id === input.transactionId)) throw new CorrectionError('Ta operacja jest już powiązana z tą fakturą.');
  try {
    await matchBankTransactionToDocuments(client, {
      transactionId: input.transactionId,
      documents: [{ documentSource: 'ksef', documentId: doc.id, amount }],
    });
  } catch (error) {
    throw new CorrectionError((error as { message?: string })?.message || 'Nie udało się powiązać operacji.');
  }
  return { number: doc.number || doc.ksefNumber, amount, currency: doc.currency };
}

/** „Odepnij” — cofnięcie powiązania operacji z fakturą (`undo_bank_match`: automat nie przypisze jej ponownie). */
export async function unlinkKsefCorrectionTransaction(client: Client, input: { correctionId: string; transactionId: string; matchId: string }) {
  if (!UUID.test(input.transactionId) || !UUID.test(input.matchId)) throw new CorrectionError('Nieprawidłowe powiązanie.');
  const settlement = await loadKsefCorrectionSettlement(client, input.correctionId, { candidates: false });
  const owned = [settlement.correction, ...settlement.originals]
    .some((doc) => doc.transactions.some((tx) => tx.id === input.transactionId && tx.matchId === input.matchId));
  if (!owned) throw new CorrectionError('Tego powiązania już nie ma. Odśwież okno.');
  const { error } = await client.rpc('undo_bank_match', { p_transaction_id: input.transactionId, p_match_id: input.matchId });
  if (error) throw new CorrectionError(error.message || 'Nie udało się cofnąć powiązania.');
}

/** Kompensata: wpłata w rejestrze korekty i faktury korygowanej (ta sama kwota i data), bez operacji bankowej. */
export async function offsetKsefCorrection(client: Client, input: { correctionId: string; originalId: string; amount: number; date: string; employeeId: string | null }) {
  const amount = round2(num(input.amount));
  if (!(amount > 0)) throw new CorrectionError('Kwota kompensaty musi być większa od zera.');
  const date = str(input.date).slice(0, 10);
  if (!DAY.test(date)) throw new CorrectionError('Podaj datę kompensaty.');
  const settlement = await loadKsefCorrectionSettlement(client, input.correctionId, { candidates: false });
  const original = settlement.originals.find((doc) => doc.id === input.originalId);
  if (!original) throw new CorrectionError('Ta faktura nie jest fakturą korygowaną z tej korekty.');
  const offset = original.offset;
  if (!offset || offset.available <= 0.009) throw new CorrectionError(offset?.blocked || 'Nie ma kwoty do rozliczenia kompensatą.');
  if (amount > offset.available + 0.005) throw new CorrectionError(`Kwota kompensaty nie może przekroczyć ${money(offset.available, original.currency)}.`);
  const correctionLabel = settlement.correction.number || settlement.correction.ksefNumber;
  const notes = correctionOffsetNotes(correctionLabel, original.number || original.ksefNumber);
  const { data: first, error: firstError } = await client.from('ksef_invoice_payments').insert({
    ksef_invoice_id: settlement.correction.id, amount, payment_date: date, notes: notes.correction, created_by: input.employeeId,
  }).select('id').single();
  if (firstError || !first) throw new CorrectionError(firstError?.message || 'Nie udało się zapisać kompensaty.');
  const { error: secondError } = await client.from('ksef_invoice_payments').insert({
    ksef_invoice_id: original.id, amount, payment_date: date, notes: notes.original, created_by: input.employeeId,
  });
  if (secondError) {
    // Bez drugiej strony kompensata nie ma sensu — wycofanie wpłaty na korekcie.
    await client.from('ksef_invoice_payments').delete().eq('id', str((first as Row).id)).is('bank_match_id', null);
    throw new CorrectionError(secondError.message || 'Nie udało się zapisać kompensaty.');
  }
  return { correction: correctionLabel, original: original.number || original.ksefNumber, amount, currency: original.currency };
}

/** Cofnięcie kompensaty — usunięcie jej wpłat w rejestrze obu faktur. */
export async function undoKsefCorrectionOffset(client: Client, input: { correctionId: string; originalId: string }) {
  const settlement = await loadKsefCorrectionSettlement(client, input.correctionId, { candidates: false });
  const original = settlement.originals.find((doc) => doc.id === input.originalId);
  if (!original) throw new CorrectionError('Ta faktura nie jest fakturą korygowaną z tej korekty.');
  const notes = correctionOffsetNotes(settlement.correction.number || settlement.correction.ksefNumber, original.number || original.ksefNumber);
  const correctionIds = settlement.correction.payments.filter((payment) => payment.offset && payment.notes === notes.correction).map((payment) => payment.id);
  const originalIds = original.payments.filter((payment) => payment.offset && payment.notes === notes.original).map((payment) => payment.id);
  if (!correctionIds.length && !originalIds.length) throw new CorrectionError('Nie znaleziono kompensaty. Odśwież okno.');
  for (const [invoiceId, paymentIds] of [[settlement.correction.id, correctionIds], [original.id, originalIds]] as const) {
    if (!paymentIds.length) continue;
    const { error } = await client.from('ksef_invoice_payments').delete()
      .eq('ksef_invoice_id', invoiceId).in('id', paymentIds).is('bank_match_id', null);
    if (error) throw new CorrectionError(error.message || 'Nie udało się cofnąć kompensaty.');
  }
}
