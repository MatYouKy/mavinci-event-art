import 'server-only';
import type { NativeContext } from './auth';
import { canFinanceCompany, loadInvoiceFinanceAccess, type InvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { getInvoiceKsefRecipient } from '@/lib/invoices/ksefRecipient';
import { getInvoicePartyDataCorrection } from '@/lib/invoices/partyDataCorrection';

/*
 * Faktury (rejestr sprzedaży) dla Maca — jak zakładka CRM „Lokalne faktury” (`/crm/invoices`) i karta faktury
 * (`/crm/invoices/[id]`): lista faktur, pro form i szkiców działalności z dostępem (RLS i `get_invoice_finance_access`),
 * zapłata z wyciągu przez dokument KSeF (jak `loadCanonicalBankPaymentDisplay`), karta z pozycjami i powiązanymi
 * dokumentami oraz czynności z karty: „Oznacz jako wysłaną”, „Oznacz jako opłaconą” (data pełnej zapłaty, kwota po
 * zaliczkach dla faktury końcowej, zapis tylko gdy faktura się nie zmieniła), anulowanie (`cancel_local_invoice`) i
 * usunięcie szkicu / pro formy (`delete_local_invoice_and_repair_numbering`). Wystawianie i korekta —
 * `financeInvoiceForm.ts`; PDF, e-mail i UPO — `finance.ts`; wysyłka do KSeF — trasa CRM `/bridge/ksef/invoices/send`
 * (token aplikacji). Marki bez NIP są pominięte jak w pozostałych częściach Finansów.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class InvoiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new InvoiceError(message, status);
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

type BankPayment = { amount: number; currency: string; latestPaymentDate: string; matchCount: number };

/** Zapłata z wyciągu przypisana do dokumentu KSeF faktury (kopia `loadCanonicalBankPaymentDisplay` z klientem pracownika). */
async function bankPayments(ctx: NativeContext, invoices: Row[]): Promise<Record<string, BankPayment>> {
  const result: Record<string, BankPayment> = {};
  const locals = new Map(invoices.filter((invoice) => invoice.my_company_id).map((invoice) => [String(invoice.id), invoice]));
  const ids = Array.from(locals.keys());
  const pageSize = 500;
  for (let offset = 0; offset < ids.length; offset += 80) {
    const linked: Row[] = [];
    for (let page = 0; ; page += pageSize) {
      const { data, error } = await ctx.supabase.from('ksef_invoices')
        .select('id, invoice_id, my_company_id, currency, ksef_reference_number, sync_status')
        .in('invoice_id', ids.slice(offset, offset + 80))
        .not('ksef_reference_number', 'is', null)
        .order('id')
        .range(page, page + pageSize - 1);
      if (error) throw error;
      linked.push(...((data || []) as Row[]));
      if ((data || []).length < pageSize) break;
    }
    const eligible = linked.filter((row) => {
      const local = locals.get(String(row.invoice_id));
      return local && row.my_company_id === local.my_company_id
        && str(row.ksef_reference_number).trim() && row.sync_status !== 'error'
        && str(row.currency || 'PLN').toUpperCase() === str(local.currency_code || 'PLN').toUpperCase()
        && (!local.ksef_reference_number || local.ksef_reference_number === row.ksef_reference_number);
    });
    const linkCounts = new Map<string, number>();
    for (const row of eligible) linkCounts.set(String(row.invoice_id), (linkCounts.get(String(row.invoice_id)) || 0) + 1);
    const documents = new Map(eligible.filter((row) => linkCounts.get(String(row.invoice_id)) === 1).map((row) => [String(row.id), row]));
    const documentIds = Array.from(documents.keys());
    const seen = new Set<string>();
    for (let batch = 0; batch < documentIds.length; batch += 80) {
      for (let page = 0; ; page += pageSize) {
        const { data, error } = await ctx.supabase.from('bank_transaction_invoice_matches')
          .select('id, ksef_invoice_id, amount, currency, document_amount, document_currency, bank_transactions!inner(transaction_date, bank_statements!inner(my_company_id))')
          .in('ksef_invoice_id', documentIds.slice(batch, batch + 80))
          .order('id')
          .range(page, page + pageSize - 1);
        if (error) throw error;
        for (const match of (data || []) as Row[]) {
          const document = documents.get(String(match.ksef_invoice_id));
          const transaction = one(match.bank_transactions);
          const statement = one(transaction?.bank_statements);
          const currency = str(match.document_currency || match.currency).toUpperCase();
          const amount = Number(match.document_amount ?? match.amount);
          const date = str(transaction?.transaction_date);
          if (!document || seen.has(String(match.id)) || statement?.my_company_id !== document.my_company_id
            || currency !== str(document.currency || 'PLN').toUpperCase()
            || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          seen.add(String(match.id));
          const key = String(document.invoice_id);
          const previous = result[key];
          result[key] = {
            amount: Math.round(((previous?.amount || 0) + amount) * 100) / 100,
            currency,
            latestPaymentDate: previous && previous.latestPaymentDate > date ? previous.latestPaymentDate : date,
            matchCount: (previous?.matchCount || 0) + 1,
          };
        }
        if ((data || []).length < pageSize) break;
      }
    }
  }
  return result;
}

const isProforma = (invoice: Row) => invoice.is_proforma === true || invoice.invoice_type === 'proforma';
const isPaidProforma = (invoice: Row) => isProforma(invoice) && invoice.status !== 'draft' && invoice.status !== 'cancelled' && invoice.payment_status === 'paid';
const isFinal = (invoice: Row) => invoice.invoice_type === 'final' || str(invoice.invoice_number).startsWith('FKO/');

/** Uprawnienia czynności karty (jak warunki w `/crm/invoices/[id]`), z poziomem w działalności faktury. */
function actionsOf(access: InvoiceFinanceAccess, invoice: Row, payment: BankPayment | undefined) {
  const companyId = strOrNull(invoice.my_company_id);
  const canChange = canFinanceCompany(access, companyId, 'invoices_issue');
  const paymentStatus = str(invoice.payment_status) || (invoice.status === 'paid' ? 'paid' : 'unpaid');
  const proforma = isProforma(invoice);
  const refund = invoice.invoice_type === 'corrective' && num(invoice.total_gross) < 0;
  const summary = invoice.settlement_summary && typeof invoice.settlement_summary === 'object' ? invoice.settlement_summary as Row : null;
  const final = isFinal(invoice);
  const hasPaymentBasis = !final || (summary != null && Number.isFinite(Number(summary.remainingGross)));
  const amountToPay = final ? Number(summary?.remainingGross ?? invoice.total_gross ?? 0) : Number(invoice.total_gross ?? 0);
  const paymentBase = refund ? Math.abs(amountToPay) : amountToPay;
  const paidAmount = num(invoice.paid_amount);
  const ksefStatus = str(invoice.ksef_status).trim().toLowerCase();
  const deletable = invoice.status === 'draft' || invoice.status === 'proforma' || proforma;
  // „Wyślij do KSeF” jak na karcie CRM: wystawianie faktur, nie pro forma, nie anulowana, nie osoba prywatna, bez wysyłki
  // w toku ani numeru KSeF (odrzuconą można wysłać ponownie).
  const ksefInProgressOrDone = ['pending', 'sent', 'accepted'].includes(ksefStatus) || Boolean(invoice.ksef_reference_number);
  return {
    canEdit: invoice.status !== 'cancelled',
    canEmail: invoice.status !== 'cancelled',
    canSendKsef: canChange && !proforma && invoice.status !== 'cancelled' && invoice.buyer_is_private_person !== true && !ksefInProgressOrDone,
    ksefResend: ksefStatus === 'rejected',
    canUpo: ksefStatus === 'accepted' && Boolean(invoice.ksef_reference_number),
    canConvertProforma: invoice.is_proforma === true && invoice.status !== 'cancelled' && !invoice.proforma_converted_to_invoice_id,
    paymentStatus,
    paymentBase: Number.isFinite(paymentBase) ? paymentBase : 0,
    canMarkPaid: canChange && invoice.correction_kind !== 'party_data'
      && ['issued', 'sent', 'overdue', 'paid'].includes(str(invoice.status))
      && ['unpaid', 'overdue', 'partially_paid'].includes(paymentStatus)
      && !proforma && !refund && hasPaymentBasis && Number.isFinite(paymentBase) && paymentBase > 0,
    canMarkSent: canChange && invoice.status === 'issued',
    canCancel: canChange
      && (proforma ? invoice.status !== 'cancelled' : ['draft', 'issued', 'overdue'].includes(str(invoice.status)))
      && !['paid', 'partially_paid', 'partially_refunded', 'refunded'].includes(paymentStatus)
      && paidAmount === 0 && !payment
      && !invoice.ksef_reference_number && !['pending', 'sent', 'accepted'].includes(ksefStatus),
    needsNotDelivered: !proforma && invoice.status !== 'draft',
    // Usunięcie szkicu / pro formy — „Zarządzanie finansami” działalności (baza sprawdza ponownie).
    canDelete: deletable && ksefStatus !== 'accepted' && canFinanceCompany(access, companyId, 'finance_manage'),
    deletable,
  };
}

function invoiceOf(invoice: Row, payment: BankPayment | undefined) {
  const event = one(invoice.event);
  const organization = one(invoice.organization);
  const company = one(invoice.my_company);
  return {
    id: str(invoice.id),
    number: str(invoice.invoice_number),
    type: str(invoice.invoice_type) || 'vat',
    status: isPaidProforma(invoice) ? 'paid' : str(invoice.status) || 'draft',
    rawStatus: str(invoice.status) || 'draft',
    paymentStatus: strOrNull(invoice.payment_status),
    correctionKind: strOrNull(invoice.correction_kind),
    proforma: isProforma(invoice),
    isFinal: isFinal(invoice),
    issueDate: day(invoice.issue_date),
    saleDate: day(invoice.sale_date),
    dueDate: day(invoice.payment_due_date),
    paidDate: day(invoice.paid_date),
    buyerName: str(invoice.buyer_name),
    buyerNip: strOrNull(invoice.buyer_nip),
    net: num(invoice.total_net),
    vat: num(invoice.total_vat),
    gross: num(invoice.total_gross),
    paidAmount: num(invoice.paid_amount),
    currency: str(invoice.currency_code) || 'PLN',
    companyId: strOrNull(invoice.my_company_id),
    companyName: company ? strOrNull(company.name) : null,
    eventName: event ? strOrNull(event.name) : null,
    organizationName: organization ? strOrNull(organization.name) : null,
    ksefStatus: strOrNull(invoice.ksef_status),
    ksefReference: strOrNull(invoice.ksef_reference_number),
    hasPdf: Boolean(invoice.pdf_url),
    pdfGeneratedAt: strOrNull(invoice.pdf_generated_at),
    createdAt: strOrNull(invoice.created_at),
    bankPayment: payment ?? null,
  };
}

async function entityCompanies(ctx: NativeContext, access: InvoiceFinanceAccess) {
  const { data, error } = await ctx.supabase.from('my_companies').select('id,name,nip,is_default').eq('is_active', true).order('name');
  if (error) fail('Nie udało się wczytać firm.', 500);
  const allowed = access.isAdmin ? null : new Set(access.salesCompanyIds);
  return ((data || []) as Row[])
    .filter((company) => str(company.nip).trim() !== '' && (!allowed || allowed.has(String(company.id))))
    .map((company) => ({
      id: String(company.id),
      name: str(company.name),
      isDefault: company.is_default === true,
      canIssue: canFinanceCompany(access, String(company.id), 'invoices_issue'),
      canManage: canFinanceCompany(access, String(company.id), 'finance_manage'),
    }));
}

const LIST_SELECT = `*,
  event:events!invoices_event_id_fkey(name),
  organization:organizations!invoices_organization_id_fkey(name),
  my_company:my_companies(id, name)`;

/** Rejestr sprzedaży: faktury działalności (bez marek bez NIP), najnowsze według daty wystawienia. */
export async function invoicesList(ctx: NativeContext) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  if (access.scope === 'none') fail('Brak dostępu do faktur i wyników sprzedaży.', 403);
  const companies = await entityCompanies(ctx, access);
  const ids = companies.map((company) => company.id);
  if (ids.length === 0) return { companies, invoices: [], salesView: access.scope === 'sales', financeView: access.canViewCompanyFinance };
  const rows: Row[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await ctx.supabase.from('invoices').select(LIST_SELECT)
      .in('my_company_id', ids)
      .order('issue_date', { ascending: false }).order('id', { ascending: true })
      .range(from, from + 999);
    if (error) fail('Nie udało się pobrać lokalnych faktur i proform.', 500);
    rows.push(...((data || []) as Row[]));
    if ((data || []).length < 1000) break;
  }
  let payments: Record<string, BankPayment> = {};
  let paymentsError: string | null = null;
  if (access.canViewCompanyFinance && rows.length) {
    try {
      payments = await bankPayments(ctx, rows);
    } catch {
      paymentsError = 'Nie udało się odczytać zapłat z wyciągów — statusy płatności są z faktur.';
    }
  }
  return {
    companies,
    salesView: access.scope === 'sales',
    financeView: access.canViewCompanyFinance,
    paymentsError,
    invoices: rows.map((row) => ({ ...invoiceOf(row, payments[String(row.id)]), actions: actionsOf(access, row, payments[String(row.id)]) })),
  };
}

/** `get_related_invoices`: dokument wskazujący tę fakturę (korekta, rozliczenie) albo dokument wskazany przez nią. */
const RELATION_LABELS: Record<string, string> = {
  corrects_this: 'odnosi się do tej faktury',
  corrected_by_this: 'ta faktura odnosi się do niego',
};

/** Karta faktury: dane, pozycje, powiązane dokumenty, zapłata z wyciągu i dostępne czynności. */
export async function invoiceDetail(ctx: NativeContext, idParam: unknown) {
  const id = str(idParam).trim();
  if (!UUID.test(id)) fail('Nieprawidłowa faktura.');
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const { data: invoice, error } = await ctx.supabase.from('invoices').select(LIST_SELECT).eq('id', id).maybeSingle();
  if (error || !invoice) fail('Nie znaleziono faktury albo nie masz do niej dostępu.', 404);
  const [itemsRes, relatedRes] = await Promise.all([
    ctx.supabase.from('invoice_items').select('id,position_number,name,unit,quantity,price_net,vat_rate,vat_code,value_net,vat_amount,value_gross,description').eq('invoice_id', id).order('position_number'),
    ctx.supabase.rpc('get_related_invoices', { p_invoice_id: id }),
  ]);
  let payment: BankPayment | undefined;
  if (access.canViewCompanyFinance) {
    try { payment = (await bankPayments(ctx, [invoice as Row]))[id]; } catch { payment = undefined; }
  }
  const row = invoice as Row;
  // Odbiorca KSeF i dane sprzed korekty zapisane na fakturze — błąd jak na karcie CRM (blokuje też „Generuj PDF”).
  let recipientError: string | null = null;
  try {
    getInvoiceKsefRecipient(row);
    getInvoicePartyDataCorrection(row);
  } catch (recipientProblem) {
    recipientError = recipientProblem instanceof Error ? recipientProblem.message : 'Nie można odczytać danych odbiorcy zapisanych na fakturze.';
  }
  return {
    invoice: invoiceOf(row, payment),
    recipientError,
    proformaConvertedTo: strOrNull(row.proforma_converted_to_invoice_id),
    actions: actionsOf(access, row, payment),
    seller: {
      name: strOrNull(row.seller_name), nip: strOrNull(row.seller_nip),
      address: [row.seller_street, [row.seller_postal_code, row.seller_city].filter(Boolean).join(' '), row.seller_country].filter(Boolean).join(', ') || null,
    },
    buyer: {
      name: strOrNull(row.buyer_name), nip: strOrNull(row.buyer_nip),
      address: [row.buyer_street, [row.buyer_postal_code, row.buyer_city].filter(Boolean).join(' '), row.buyer_country].filter(Boolean).join(', ') || null,
      email: strOrNull(row.buyer_email), privatePerson: row.buyer_is_private_person === true,
    },
    paymentMethod: strOrNull(row.payment_method),
    bankAccount: strOrNull(row.bank_account),
    issuePlace: strOrNull(row.issue_place),
    notes: strOrNull(row.notes),
    ksefError: strOrNull(row.ksef_error),
    ksefSentAt: strOrNull(row.ksef_sent_at),
    cancellationReason: strOrNull(row.cancellation_reason),
    correctionReason: strOrNull(row.correction_reason),
    correctedNumber: strOrNull(row.corrected_invoice_number) ?? strOrNull(row.original_invoice_number),
    remainingGross: isFinal(row) && row.settlement_summary && typeof row.settlement_summary === 'object'
      ? numOrNull((row.settlement_summary as Row).remainingGross) : null,
    items: ((itemsRes.data || []) as Row[]).map((item) => ({
      id: str(item.id),
      name: str(item.name),
      description: strOrNull(item.description),
      unit: strOrNull(item.unit),
      quantity: numOrNull(item.quantity),
      priceNet: numOrNull(item.price_net),
      vatRate: item.vat_code ? str(item.vat_code) : item.vat_rate == null ? null : `${num(item.vat_rate)}%`,
      net: numOrNull(item.value_net),
      vat: numOrNull(item.vat_amount),
      gross: numOrNull(item.value_gross),
    })),
    related: ((relatedRes.data || []) as Row[]).map((r) => ({
      id: str(r.id),
      number: str(r.invoice_number),
      type: str(r.invoice_type),
      status: str(r.status),
      issueDate: day(r.issue_date),
      gross: num(r.total_gross),
      relation: RELATION_LABELS[str(r.relation_type)] || str(r.relation_type),
    })),
  };
}

async function editableInvoice(ctx: NativeContext, idParam: unknown) {
  const id = str(idParam).trim();
  if (!UUID.test(id)) fail('Nieprawidłowa faktura.');
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const { data: invoice, error } = await ctx.supabase.from('invoices').select('*').eq('id', id).maybeSingle();
  if (error || !invoice) fail('Nie znaleziono faktury albo nie masz do niej dostępu.', 404);
  let payment: BankPayment | undefined;
  if (access.canViewCompanyFinance) {
    try { payment = (await bankPayments(ctx, [invoice as Row]))[id]; } catch { payment = undefined; }
  }
  return { id, access, invoice: invoice as Row, payment, actions: actionsOf(access, invoice as Row, payment) };
}

/** „Oznacz jako wysłaną” / „Oznacz jako opłaconą” — zapis tylko, gdy status i płatność faktury się nie zmieniły. */
export async function invoiceStatus(ctx: NativeContext, body: Row) {
  const { id, invoice, actions } = await editableInvoice(ctx, body.id);
  const next = str(body.status);
  if (next !== 'paid' && next !== 'sent') fail('Nieznany status.');
  if (next === 'paid' && !actions.canMarkPaid) fail('Tej faktury nie można oznaczyć jako opłaconej.', 403);
  if (next === 'sent' && !actions.canMarkSent) fail('Tej faktury nie można oznaczyć jako wysłanej.', 403);
  const update: Record<string, string | number | null> = { status: next };
  if (next === 'paid') {
    const paidDate = str(body.paidDate).slice(0, 10);
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const parsed = new Date(`${paidDate}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidDate) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== paidDate || paidDate > today) {
      fail('Podaj rzeczywistą datę zapłaty, nie późniejszą niż dzisiaj.');
    }
    // Docelowa łączna zapłata (po zaliczkach dla faktury końcowej), nie kolejna wpłata.
    const summary = invoice.settlement_summary && typeof invoice.settlement_summary === 'object' ? invoice.settlement_summary as Row : null;
    update.payment_status = 'paid';
    update.paid_amount = Number(isFinal(invoice) ? summary?.remainingGross : invoice.total_gross);
    update.paid_at = new Date(`${paidDate}T12:00:00`).toISOString();
    update.paid_date = paidDate;
  }
  let query = ctx.supabase.from('invoices').update(update).eq('id', id).eq('status', invoice.status);
  query = invoice.payment_status == null ? query.is('payment_status', null) : query.eq('payment_status', invoice.payment_status);
  query = invoice.paid_amount == null ? query.is('paid_amount', null) : query.eq('paid_amount', invoice.paid_amount);
  const { data, error } = await query.select('id').maybeSingle();
  if (error) fail('Nie udało się zmienić statusu. Sprawdź płatności i powiązania faktury przed ponowną próbą.');
  if (!data) {
    return { ok: false, tone: 'warning', message: 'Nie zapisano zmiany. Dane mogły się zmienić lub nie masz uprawnień. Sprawdź odświeżoną fakturę.' };
  }
  return {
    ok: true,
    message: next === 'paid' ? 'Potwierdzono zapłatę. Rozliczenie powiązanego wydarzenia przeliczono automatycznie.' : 'Status faktury został zmieniony',
  };
}

/** Anulowanie (`cancel_local_invoice`): numer zostaje, powód i potwierdzenie „nie trafiła do nabywcy” — w historii. */
export async function invoiceCancel(ctx: NativeContext, body: Row) {
  const { id, invoice, actions } = await editableInvoice(ctx, body.id);
  if (!actions.canCancel) fail('Tej faktury nie można anulować — jeśli trafiła do nabywcy, wystaw korektę.', 403);
  const reason = str(body.reason).trim();
  if (reason.length < 5) fail('Podaj powód anulowania (co najmniej 5 znaków).');
  const notDelivered = body.notDelivered === true;
  if (actions.needsNotDelivered && !notDelivered) fail('Potwierdź, że faktura nie trafiła do nabywcy. Jeśli ją otrzymał — wystaw korektę.');
  const { error } = await ctx.supabase.rpc('cancel_local_invoice', { p_invoice_id: id, p_reason: reason.slice(0, 500), p_not_delivered: notDelivered });
  if (error) fail(error.message || 'Nie udało się anulować faktury.', error.code === '42501' ? 403 : 400);
  return { ok: true, message: `Faktura ${str(invoice.invoice_number)} została anulowana.` };
}

/** Usunięcie szkicu / pro formy z naprawą numeracji (wystawioną fakturę anuluje się albo koryguje). */
export async function invoiceDelete(ctx: NativeContext, body: Row) {
  const { id, invoice, actions } = await editableInvoice(ctx, body.id);
  if (!actions.deletable) {
    fail(`Wystawionej faktury ${str(invoice.invoice_number)} nie usuwa się — anuluj ją na karcie faktury (jeśli nie trafiła do nabywcy) albo wystaw korektę.`);
  }
  if (str(invoice.ksef_status) === 'accepted') fail(`Nie można usunąć faktury ${str(invoice.invoice_number)}, ponieważ została już wysłana do KSeF.`);
  if (!actions.canDelete) fail('Usunięcie wymaga poziomu „Zarządzanie finansami” w działalności faktury.', 403);
  const { error } = await ctx.supabase.rpc('delete_local_invoice_and_repair_numbering', { p_invoice_id: id });
  if (error) fail(error.message || 'Błąd podczas usuwania faktury', error.code === '42501' ? 403 : 400);
  return { ok: true, message: 'Faktura została usunięta' };
}
