import 'server-only';
import type { NativeContext } from './auth';
import { canFinanceCompany, loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { decodeTextEntities } from '@/lib/textEncoding';
import {
  ksefInvoiceCompany,
  linkKsefCorrectionTransaction,
  loadKsefCorrectionSettlement,
  offsetKsefCorrection,
  undoKsefCorrectionOffset,
  unlinkKsefCorrectionTransaction,
} from '@/lib/invoices/ksefCorrectionSettlement';

/*
 * KSeF dla Maca (jak zakładka CRM „KSeF”, `KSeFIntegrationPanel`): działalności z aktywną konfiguracją KSeF (bez sekretów),
 * faktury pobrane z KSeF (wystawione i otrzymane, z numerem KSeF), rejestr wpłat (`ksef_invoice_payments`), uwagi do
 * płatności (`financial_payment_review_issues`) i dziennik synchronizacji. Czynności jak w CRM: „Oznacz jako opłaconą”
 * (wpłata pozostałej kwoty), „Oznacz jako nieopłaconą” (usunięcie ręcznych wpłat, dopasowania z wyciągów zostają), wpłaty
 * częściowe, termin i data pełnej zapłaty, zamknięcie uwagi, usunięcie z lokalnej bazy (administrator). Synchronizacja
 * z KSeF — trasy CRM `/bridge/ksef/auth/token` i `/bridge/ksef/invoices/issued|received` (token pracownika). Konfiguracja
 * KSeF (certyfikat, token) — w CRM. Rozliczenie korekty „in minus” (zwrot) — jak okno CRM „Rozlicz korektę / zwrot”
 * (`src/lib/invoices/ksefCorrectionSettlement.ts`): faktura korygowana, płatność i zwrot z wyciągu, kompensata.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class KsefError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new KsefError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value));
const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const day = (value: unknown) => strOrNull(value)?.slice(0, 10) ?? null;
const one = (value: unknown): Row | null => (Array.isArray(value) ? (value[0] as Row) || null : value && typeof value === 'object' ? value as Row : null);
const warsawToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Działalności z konfiguracją KSeF (bez sekretów) i dostępem do faktur; marki bez NIP pominięte. */
export async function ksefCompanies(ctx: NativeContext) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const { data, error } = await ctx.supabase.from('ksef_credentials')
    .select(`id, my_company_id, nip, is_test_environment, access_token_valid_until, last_authenticated_at, is_active,
      auto_sync_enabled, auto_sync_last_attempt_at, auto_sync_last_success_at, auto_sync_last_error,
      my_company:my_companies(id, name, nip, is_default, is_active)`)
    .eq('is_active', true);
  if (error) fail('Błąd wczytywania konfiguracji KSeF', 500);
  const companies = ((data || []) as Row[])
    .filter((row) => {
      const company = one(row.my_company);
      return company && str(company.nip).trim() !== '' && canFinanceCompany(access, str(row.my_company_id), 'invoices');
    })
    .map((row) => {
      const company = one(row.my_company) as Row;
      return {
        companyId: str(row.my_company_id),
        name: str(company.name),
        isDefault: company.is_default === true,
        canManage: canFinanceCompany(access, str(row.my_company_id), 'finance_manage'),
        nip: strOrNull(row.nip),
        test: row.is_test_environment === true,
        lastAuthenticatedAt: strOrNull(row.last_authenticated_at),
        accessValidUntil: strOrNull(row.access_token_valid_until),
        autoSync: row.auto_sync_enabled === true,
        autoSyncLastAttemptAt: strOrNull(row.auto_sync_last_attempt_at),
        autoSyncLastSuccessAt: strOrNull(row.auto_sync_last_success_at),
        autoSyncLastError: strOrNull(row.auto_sync_last_error),
      };
    })
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name, 'pl'));
  return { companies, isAdmin: access.isAdmin };
}

/** Faktury KSeF działalności (pobrane, z numerem KSeF) z wpłatami, uwagami i dziennikiem synchronizacji. */
export async function ksefInvoices(ctx: NativeContext, companyParam: unknown) {
  const companyId = str(companyParam).trim();
  if (!UUID.test(companyId)) fail('Nieprawidłowa działalność.');
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  if (!canFinanceCompany(access, companyId, 'invoices')) fail('Brak dostępu do faktur tej działalności.', 403);
  const rows: Row[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await ctx.supabase.from('ksef_invoices')
      .select('id,invoice_id,invoice_number,ksef_reference_number,invoice_type,issue_date,ksef_issued_at,payment_due_date,payment_status,payment_date,payment_method,bank_account_number,seller_name,seller_nip,buyer_name,buyer_nip,net_amount,vat_amount,gross_amount,amount_to_pay_gross,currency,accounting_note,payment_due_source')
      .eq('my_company_id', companyId).eq('sync_status', 'synced')
      .not('ksef_reference_number', 'is', null).neq('ksef_reference_number', '')
      .order('issue_date', { ascending: false, nullsFirst: false }).order('id')
      .range(from, from + 999);
    if (error) fail('Błąd wczytywania faktur z bazy', 500);
    rows.push(...((data || []) as Row[]));
    if ((data || []).length < 1000) break;
  }
  const ids = rows.map((row) => String(row.id));
  const payments: Row[] = [];
  const reviews: Row[] = [];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const chunk = ids.slice(offset, offset + 200);
    const [paymentsRes, reviewRes] = await Promise.all([
      ctx.supabase.from('ksef_invoice_payments').select('id,ksef_invoice_id,amount,payment_date,notes,bank_match_id').in('ksef_invoice_id', chunk).order('payment_date', { ascending: true }),
      ctx.supabase.from('financial_payment_review_issues').select('document_id,issue_code,details').eq('document_source', 'ksef')
        .in('issue_code', ['payment_status_without_ledger', 'manual_match_explanation_required']).is('resolved_at', null).in('document_id', chunk),
    ]);
    payments.push(...((paymentsRes.data || []) as Row[]));
    reviews.push(...((reviewRes.data || []) as Row[]));
  }
  const paymentsBy = new Map<string, Row[]>();
  for (const payment of payments) paymentsBy.set(String(payment.ksef_invoice_id), [...(paymentsBy.get(String(payment.ksef_invoice_id)) || []), payment]);
  const { data: logs } = await ctx.supabase.from('ksef_sync_log').select('*').order('started_at', { ascending: false }).limit(20);
  return {
    companyId,
    canManage: canFinanceCompany(access, companyId, 'finance_manage'),
    isAdmin: access.isAdmin,
    today: warsawToday(),
    invoices: rows.map((row) => {
      const list = paymentsBy.get(String(row.id)) || [];
      const review = reviews.filter((issue) => String(issue.document_id) === String(row.id));
      const manualReview = review.find((issue) => issue.issue_code === 'manual_match_explanation_required');
      return {
        id: str(row.id),
        localInvoiceId: strOrNull(row.invoice_id),
        number: strOrNull(row.invoice_number),
        ksefNumber: str(row.ksef_reference_number),
        side: str(row.invoice_type).toLowerCase() === 'issued' ? 'issued' : 'received',
        issueDate: day(row.issue_date) ?? day(row.ksef_issued_at),
        dueDate: day(row.payment_due_date),
        dueSource: strOrNull(row.payment_due_source),
        paymentStatus: strOrNull(row.payment_status),
        paymentDate: day(row.payment_date),
        paymentMethod: strOrNull(row.payment_method),
        bankAccount: strOrNull(row.bank_account_number),
        sellerName: decodeTextEntities(str(row.seller_name)) || null,
        sellerNip: strOrNull(row.seller_nip),
        buyerName: decodeTextEntities(str(row.buyer_name)) || null,
        buyerNip: strOrNull(row.buyer_nip),
        net: num(row.net_amount),
        vat: num(row.vat_amount),
        gross: num(row.gross_amount),
        toPay: numOrNull(row.amount_to_pay_gross),
        currency: str(row.currency) || 'PLN',
        note: strOrNull(row.accounting_note),
        payments: list.map((payment) => ({
          id: str(payment.id), amount: num(payment.amount), date: day(payment.payment_date), notes: strOrNull(payment.notes), fromBank: Boolean(payment.bank_match_id),
        })),
        paid: Math.round(list.reduce((sum, payment) => sum + num(payment.amount), 0) * 100) / 100,
        statusWithoutLedger: review.some((issue) => issue.issue_code === 'payment_status_without_ledger'),
        manualReviewNote: manualReview ? str(one(manualReview.details)?.note) || '' : null,
      };
    }),
    logs: ((logs || []) as Row[])
      .filter((log) => !log.my_company_id || String(log.my_company_id) === companyId)
      .map((log) => ({
        id: str(log.id),
        startedAt: strOrNull(log.started_at),
        finishedAt: strOrNull(log.completed_at),
        status: strOrNull(log.status),
        kind: strOrNull(log.sync_type),
        count: numOrNull(log.invoices_count),
        error: strOrNull(log.error_message),
      })),
  };
}

async function manageableInvoice(ctx: NativeContext, idParam: unknown) {
  const id = str(idParam).trim();
  if (!UUID.test(id)) fail('Nieprawidłowa faktura.');
  const { data: invoice, error } = await ctx.supabase.from('ksef_invoices')
    .select('id,my_company_id,invoice_number,ksef_reference_number,gross_amount,amount_to_pay_gross,payment_due_date').eq('id', id).maybeSingle();
  if (error || !invoice) fail('Nie znaleziono faktury albo nie masz do niej dostępu.', 404);
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  if (!canFinanceCompany(access, str(invoice.my_company_id), 'finance_manage')) fail('Zmiany płatności wymagają „Zarządzania finansami” w tej działalności.', 403);
  return { id, invoice: invoice as Row, access };
}

const resolveReview = (ctx: NativeContext, id: string, code: string) => ctx.supabase.from('financial_payment_review_issues')
  .update({ resolved_at: new Date().toISOString(), resolved_by: ctx.employee.id })
  .eq('document_source', 'ksef').eq('document_id', id).eq('issue_code', code).is('resolved_at', null);

async function paidSoFar(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('ksef_invoice_payments').select('amount').eq('ksef_invoice_id', id);
  if (error) fail('Nie udało się odczytać wpłat.');
  return ((data || []) as Row[]).reduce((sum, payment) => sum + num(payment.amount), 0);
}

/** „Oznacz jako opłaconą” (korekta „in minus” — „rozliczoną”) — wpłata pozostałej kwoty z dzisiejszą datą (jak w CRM). */
export async function ksefMarkPaid(ctx: NativeContext, body: Row) {
  const { id, invoice } = await manageableInvoice(ctx, body.id);
  const negative = num(invoice.amount_to_pay_gross ?? invoice.gross_amount) < 0;
  const remaining = Math.max(Math.abs(num(invoice.amount_to_pay_gross ?? invoice.gross_amount)) - await paidSoFar(ctx, id), 0);
  if (remaining <= 0.009) return { ok: true, message: 'Faktura jest już rozliczona w rejestrze wpłat' };
  const { error } = await ctx.supabase.from('ksef_invoice_payments').insert({
    ksef_invoice_id: id, amount: Math.round(remaining * 100) / 100, payment_date: warsawToday(),
    notes: negative ? 'Ręczne oznaczenie korekty jako rozliczonej' : 'Ręczne oznaczenie jako opłacona', created_by: ctx.employee.id,
  });
  if (error) fail(error.message || 'Błąd podczas oznaczania faktury');
  return { ok: true, message: negative ? 'Korekta oznaczona jako rozliczona' : 'Faktura oznaczona jako opłacona' };
}

/** „Oznacz jako nieopłaconą” — usunięcie ręcznych wpłat (dopasowania z wyciągów zostają) i zamknięcie uwagi o statusie. */
export async function ksefMarkUnpaid(ctx: NativeContext, body: Row) {
  const { id } = await manageableInvoice(ctx, body.id);
  const { error } = await ctx.supabase.from('ksef_invoice_payments').delete().eq('ksef_invoice_id', id).is('bank_match_id', null);
  if (error) fail(error.message || 'Błąd podczas aktualizacji statusu');
  await resolveReview(ctx, id, 'payment_status_without_ledger');
  return { ok: true, message: 'Usunięto ręczne wpłaty. Dopasowania z wyciągów pozostają zachowane.' };
}

export async function ksefAddPayment(ctx: NativeContext, body: Row) {
  const { id } = await manageableInvoice(ctx, body.id);
  const amount = Number(str(body.amount).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) fail('Podaj poprawną kwotę wpłaty');
  const date = str(body.date).slice(0, 10);
  if (!DAY.test(date)) fail('Podaj datę wpłaty');
  const { error } = await ctx.supabase.from('ksef_invoice_payments').insert({
    ksef_invoice_id: id, amount, payment_date: date, notes: str(body.notes).trim() || null, created_by: ctx.employee.id,
  });
  if (error) fail(error.message || 'Błąd dodawania wpłaty');
  return { ok: true, message: 'Wpłata dodana' };
}

export async function ksefRemovePayment(ctx: NativeContext, body: Row) {
  const paymentId = str(body.paymentId).trim();
  if (!UUID.test(paymentId)) fail('Nieprawidłowa wpłata.');
  const { data: payment, error: readError } = await ctx.supabase.from('ksef_invoice_payments').select('id,ksef_invoice_id,bank_match_id').eq('id', paymentId).maybeSingle();
  if (readError || !payment) fail('Nie znaleziono wpłaty.', 404);
  if (payment.bank_match_id) fail('Wpłatę z wyciągu usuń przez odpięcie dopasowania transakcji');
  await manageableInvoice(ctx, payment.ksef_invoice_id);
  const { error } = await ctx.supabase.from('ksef_invoice_payments').delete().eq('id', paymentId).is('bank_match_id', null);
  if (error) fail(error.message || 'Błąd usuwania wpłaty');
  return { ok: true, message: 'Wpłata usunięta' };
}

/** Termin płatności i — bez zapisanych wpłat — data pełnej zapłaty albo status nieopłacona / po terminie (jak w CRM). */
export async function ksefSavePayment(ctx: NativeContext, body: Row) {
  const { id, invoice } = await manageableInvoice(ctx, body.id);
  const dueDate = str(body.dueDate).slice(0, 10);
  const paymentDate = str(body.paymentDate).slice(0, 10);
  if (dueDate && !DAY.test(dueDate)) fail('Nieprawidłowy termin płatności.');
  if (paymentDate && !DAY.test(paymentDate)) fail('Nieprawidłowa data zapłaty.');
  const updates: Row = { payment_due_date: dueDate || null };
  const { count, error: countError } = await ctx.supabase.from('ksef_invoice_payments').select('id', { count: 'exact', head: true }).eq('ksef_invoice_id', id);
  if (countError) fail('Nie udało się odczytać wpłat.');
  const hasPayments = (count ?? 0) > 0;
  if (!hasPayments) {
    if (paymentDate) {
      const { error } = await ctx.supabase.from('ksef_invoice_payments').insert({
        ksef_invoice_id: id, amount: Math.abs(num(invoice.amount_to_pay_gross ?? invoice.gross_amount)), payment_date: paymentDate,
        notes: 'Ręcznie zarejestrowana pełna płatność', created_by: ctx.employee.id,
      });
      if (error) fail(error.message || 'Błąd podczas aktualizacji');
    } else {
      updates.payment_date = null;
      updates.payment_status = dueDate && dueDate < warsawToday() ? 'overdue' : 'unpaid';
    }
  }
  const { error } = await ctx.supabase.from('ksef_invoices').update(updates).eq('id', id);
  if (error) fail(error.message || 'Błąd podczas aktualizacji');
  if (!hasPayments && !paymentDate) await resolveReview(ctx, id, 'payment_status_without_ledger');
  return { ok: true, message: 'Dane płatności zaktualizowane' };
}

export async function ksefResolveReview(ctx: NativeContext, body: Row) {
  const { id } = await manageableInvoice(ctx, body.id);
  const { data, error } = await resolveReview(ctx, id, 'manual_match_explanation_required').select('id');
  if (error) fail(error.message || 'Nie udało się zamknąć uwagi do faktury.');
  if (!data?.length) fail('Nie znaleziono aktywnej uwagi albo brak uprawnień do jej zamknięcia.');
  return { ok: true, message: 'Faktura została oznaczona jako wyjaśniona.' };
}

/** Usunięcie faktury z lokalnej bazy (nie z KSeF) — tylko administrator, jak w CRM. */
export async function ksefDelete(ctx: NativeContext, body: Row) {
  const { id, access } = await manageableInvoice(ctx, body.id);
  if (!access.isAdmin) fail('Tylko administrator może usunąć fakturę z lokalnej bazy', 403);
  const { data, error } = await ctx.supabase.from('ksef_invoices').delete().eq('id', id).select('id');
  if (error) fail(error.message || 'Błąd podczas usuwania faktury');
  if (!data?.length) fail('Nie usunięto faktury. Rekord nie istnieje albo brak uprawnień RLS do usuwania.');
  return { ok: true, message: 'Faktura została usunięta z lokalnej bazy' };
}

// MARK: Rozliczenie korekty „in minus” (jak `KsefCorrectionSettlementModal` w CRM)

/** Korekta, faktury korygowane z XML, wpłaty, powiązane operacje, operacje do powiązania i kompensata. */
export async function ksefCorrection(ctx: NativeContext, idParam: unknown) {
  const id = str(idParam).trim();
  if (!UUID.test(id)) fail('Nieprawidłowa faktura.');
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const companyId = await ksefInvoiceCompany(ctx.supabase, id);
  if (!canFinanceCompany(access, companyId, 'invoices')) fail('Brak dostępu do faktur tej działalności.', 403);
  const settlement = await loadKsefCorrectionSettlement(ctx.supabase, id);
  return { ...settlement, canManage: canFinanceCompany(access, companyId, 'finance_manage') };
}

const amountOf = (value: unknown) => num(str(value).replace(/\s/g, '').replace(',', '.'));

/** „Powiąż” — operacja z wyciągu jako płatność faktury korygowanej albo zwrot korekty. */
export async function ksefCorrectionLink(ctx: NativeContext, body: Row) {
  const { id } = await manageableInvoice(ctx, body.correctionId);
  const result = await linkKsefCorrectionTransaction(ctx.supabase, {
    correctionId: id, documentId: str(body.documentId), transactionId: str(body.transactionId), amount: amountOf(body.amount),
  });
  return { ok: true, message: `Operacja z wyciągu powiązana z fakturą ${result.number}.` };
}

/** „Odepnij” — cofnięcie powiązania operacji z fakturą korekty albo faktury korygowanej. */
export async function ksefCorrectionUnlink(ctx: NativeContext, body: Row) {
  const { id } = await manageableInvoice(ctx, body.correctionId);
  await unlinkKsefCorrectionTransaction(ctx.supabase, { correctionId: id, transactionId: str(body.transactionId), matchId: str(body.matchId) });
  return { ok: true, message: 'Powiązanie cofnięte. Ta operacja nie zostanie ponownie przypisana automatycznie do tej faktury.' };
}

/** Kompensata korekty z nieopłaconą fakturą korygowaną (wpłata w rejestrze obu faktur). */
export async function ksefCorrectionOffset(ctx: NativeContext, body: Row) {
  const { id } = await manageableInvoice(ctx, body.correctionId);
  await manageableInvoice(ctx, body.originalId);
  const result = await offsetKsefCorrection(ctx.supabase, {
    correctionId: id, originalId: str(body.originalId), amount: amountOf(body.amount), date: str(body.date), employeeId: ctx.employee.id,
  });
  return { ok: true, message: `Korekta ${result.correction} rozliczona kompensatą z fakturą ${result.original}.` };
}

export async function ksefCorrectionOffsetUndo(ctx: NativeContext, body: Row) {
  const { id } = await manageableInvoice(ctx, body.correctionId);
  await manageableInvoice(ctx, body.originalId);
  await undoKsefCorrectionOffset(ctx.supabase, { correctionId: id, originalId: str(body.originalId) });
  return { ok: true, message: 'Kompensata cofnięta — wpłaty usunięte z rejestru obu faktur.' };
}
