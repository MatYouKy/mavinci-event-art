import 'server-only';
import type { NativeContext } from './auth';
import {
  createEmptyInvoiceRecipientDraft,
  invoiceRecipientPayload,
  recipientDraftFromInvoice,
  type InvoiceRecipientDraft,
} from '@/lib/invoices/ksefRecipient';
import { DEFAULT_INVOICE_PAYMENT_TERM_DAYS, getInvoicePaymentDueDate } from '@/lib/invoices/paymentTerm';

/*
 * „Faktura z pro formy” dla Maca — jak `ConvertProformaModal` i `convertProformaToInvoice` w CRM: cała pro forma jako
 * faktura VAT (szkic) albo opłacona faktura zaliczkowa (100% pro formy, wpłata potwierdzona przy pro formie albo przez
 * pracownika z rzeczywistą datą), numer automatyczny albo własny, daty i termin płatności, poprawione dane nabywcy
 * i odbiorca KSeF. Zapis — ta sama funkcja bazy co w przeglądarce (`convert_proforma_with_payment_atomic`: uprawnienie
 * `can_manage_invoice`, zachowanie sprzedawcy, płatnika, wydarzenia i waluty, jedna faktura na pro formę, wpłata,
 * powiązania i historia), tokenem pracownika.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class ProformaError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new ProformaError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const trimmed = (value: unknown) => str(value).trim();
const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const round2 = (value: number) => Number(value.toFixed(2));
/** Dzisiejsza data jak w CRM (`new Date().toISOString()`), zgodna z kontrolą daty wpłaty w bazie. */
const today = () => new Date().toISOString().split('T')[0];

/** Data wpłaty: „DD.MM.RRRR” albo „RRRR-MM-DD” (kopia `parseProformaPaymentDate` z `convertProformaToInvoice.ts`). */
function parseProformaPaymentDate(value: string): string | null {
  const input = value.trim();
  const polish = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input);
  const iso = polish ? `${polish[3]}-${polish[2]}-${polish[1]}` : input;
  if (!DAY.test(iso)) return null;
  const parsed = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Wpłata zapisana przy pro formie (kopia `getRecordedProformaPaymentDate`): pełna kwota i data nie późniejsza niż dziś. */
function getRecordedProformaPaymentDate(proforma: Row, issueDate: string, todayDate: string): string | null {
  const total = Number(proforma.total_gross);
  const received = Number(proforma.manual_paid_amount ?? 0);
  const date = parseProformaPaymentDate(proforma.paid_date || str(proforma.paid_at).split('T')[0] || '');
  return total > 0 && Number.isFinite(received) && received >= total - 0.01
    && date && date <= todayDate && date <= issueDate ? date : null;
}

async function proformaRow(ctx: NativeContext, idParam: unknown, select: string) {
  const id = trimmed(idParam);
  if (!UUID.test(id)) fail('Nie znaleziono proformy', 404);
  const { data, error } = await ctx.supabase.from('invoices').select(select).eq('id', id).maybeSingle();
  if (error || !data) fail('Nie znaleziono proformy', 404);
  const proforma = data as unknown as Row;
  if (!proforma.is_proforma) fail('To nie jest faktura proforma');
  return proforma;
}

/** Okno „Wystaw fakturę na podstawie proformy”: dane pro formy, nabywca, odbiorca zapisany w dokumencie, wpłata. */
export async function proformaSetup(ctx: NativeContext, idParam: unknown) {
  const proforma = await proformaRow(ctx, idParam, '*, invoice_items(*)');
  let recipient: InvoiceRecipientDraft = createEmptyInvoiceRecipientDraft();
  let recipientError: string | null = null;
  try {
    recipient = recipientDraftFromInvoice(proforma);
  } catch (error) {
    recipientError = error instanceof Error ? error.message : 'Sprawdź i wybierz ponownie odbiorcę faktury.';
  }
  const items = [...((proforma.invoice_items || []) as Row[])].sort((a, b) => num(a.position_number) - num(b.position_number));
  return {
    id: str(proforma.id),
    number: str(proforma.invoice_number),
    status: str(proforma.status),
    companyId: str(proforma.my_company_id),
    convertedTo: str(proforma.proforma_converted_to_invoice_id),
    currency: str(proforma.currency_code) || 'PLN',
    totals: { net: num(proforma.total_net), vat: num(proforma.total_vat), gross: num(proforma.total_gross) },
    seller: { name: str(proforma.seller_name), nip: str(proforma.seller_nip) },
    buyer: {
      name: str(proforma.buyer_name), nip: str(proforma.buyer_nip), email: str(proforma.buyer_email),
      street: str(proforma.buyer_street), postalCode: str(proforma.buyer_postal_code), city: str(proforma.buyer_city),
    },
    items: items.map((item) => ({
      name: str(item.name), unit: str(item.unit), quantity: num(item.quantity), priceNet: num(item.price_net),
      vatRate: num(item.vat_rate), gross: num(item.value_gross),
    })),
    // Wpłata zapisana przy pro formie — aplikacja sprawdza ją względem daty wystawienia jak CRM.
    manualPaidAmount: num(proforma.manual_paid_amount),
    paidDate: str(proforma.paid_date) || str(proforma.paid_at).split('T')[0] || '',
    recipient,
    recipientError,
  };
}

/** Podgląd następnego numeru (jak `fetchNextNumber` w oknie CRM): ZAL dla zaliczki, prefiks działalności, numer i rok. */
export async function proformaNumber(ctx: NativeContext, idParam: unknown, typeParam: unknown) {
  const proforma = await proformaRow(ctx, idParam, 'id, is_proforma, my_company_id');
  if (!proforma.my_company_id) return { number: '' };
  const { data, error } = await ctx.supabase.from('my_companies')
    .select('invoice_prefix, last_invoice_number, last_advance_number, invoice_numbering_year')
    .eq('id', proforma.my_company_id).maybeSingle();
  if (error || !data) fail('Nie udało się odczytać numeracji');
  const company = data as Row;
  const advance = str(typeParam) === 'advance';
  const year = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Warsaw', year: 'numeric' }).format(new Date()));
  const numberingYear = company.invoice_numbering_year === year ? company.invoice_numbering_year : year;
  const lastNumber = advance ? company.last_advance_number || 0 : company.last_invoice_number || 0;
  const nextNumber = company.invoice_numbering_year === year ? lastNumber + 1 : 1;
  const parts: string[] = [];
  if (advance) parts.push('ZAL');
  if (company.invoice_prefix) parts.push(str(company.invoice_prefix));
  parts.push(String(nextNumber));
  parts.push(String(numberingYear));
  return { number: parts.join('/') };
}

function draftOf(value: unknown): InvoiceRecipientDraft {
  const draft = object(value);
  const data = object(draft.data);
  const mode = ['same_as_buyer', 'organization', 'manual'].includes(str(draft.mode)) ? str(draft.mode) as InvoiceRecipientDraft['mode'] : 'same_as_buyer';
  return {
    mode, organizationId: str(draft.organizationId),
    data: {
      name: str(data.name), nip: str(data.nip), internalId: str(data.internalId), street: str(data.street), postalCode: str(data.postalCode),
      city: str(data.city), countryCode: str(data.countryCode), role: data.role === 8 || data.role === '8' ? 8 : 2,
    },
  };
}

type PreparedInvoiceLine = {
  position_number: number; name: string; unit: string; quantity: number; price_net: number; vat_rate: number; vat_code: string;
  vat_exemption_reason: string | null; value_net: number; vat_amount: number; value_gross: number;
};

/**
 * „Wystaw fakturę” z okna pro formy — sprawdzenia okna (`goToPreview`) i `convertProformaToInvoice`, potem
 * `convert_proforma_with_payment_atomic`. Odpowiedź: identyfikator nowej faktury i komunikat jak w CRM.
 */
export async function proformaConvert(ctx: NativeContext, body: Row) {
  const form = object(body.form);
  const targetType: 'vat' | 'advance' = form.targetType === 'advance' ? 'advance' : 'vat';
  const proforma = await proformaRow(ctx, body.id, '*, invoice_items(*), invoice_order_items(*)');
  const proformaId = str(proforma.id);
  const todayDate = today();
  const issueDate = trimmed(form.issueDate) || todayDate;
  const saleDate = trimmed(form.saleDate) || todayDate;
  if (!DAY.test(issueDate) || !parseProformaPaymentDate(issueDate)) fail('Podaj poprawną datę wystawienia.');
  if (!DAY.test(saleDate) || !parseProformaPaymentDate(saleDate)) fail('Podaj poprawną datę sprzedaży.');

  // Odbiorca: zapisany w pro formie (z ewentualną poprawką) — musi być kompletny; IDWew musi zawierać NIP nabywcy.
  if (body.recipientUnreadable === true) {
    fail(str(body.recipientError) || 'Sprawdź i wybierz ponownie odbiorcę faktury.');
  }
  const recipientDraft = draftOf(form.recipient);
  let recipientPayload: ReturnType<typeof invoiceRecipientPayload>;
  try {
    recipientPayload = invoiceRecipientPayload(recipientDraft);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Sprawdź dane odbiorcy.');
  }
  const buyer = object(form.buyer);
  const buyerNip = str(buyer.nip) || null;
  if (recipientDraft.mode !== 'same_as_buyer' && recipientDraft.data.internalId.trim()) {
    const normalizedBuyerNip = str(buyerNip).replace(/^PL/i, '').replace(/[\s-]/g, '');
    if (recipientDraft.data.internalId.trim().split('-')[0] !== normalizedBuyerNip) {
      fail('NIP w numerze wewnętrznym odbiorcy musi odpowiadać NIP nabywcy. Sprawdź obie strony przed wystawieniem faktury.');
    }
  }

  const paymentDueDate = getInvoicePaymentDueDate(issueDate, str(form.paymentTermDays));
  if (targetType !== 'advance' && !paymentDueDate) {
    fail('Podaj termin płatności jako liczbę całkowitą dni od 0 oraz poprawną datę wystawienia.');
  }
  const manualNumber = form.numberingMode === 'manual';
  const customNumber = trimmed(form.customNumber);
  if (manualNumber && !customNumber) fail('Podaj numer faktury');

  if (targetType === 'vat' && proforma.proforma_converted_to_invoice_id) {
    fail('Faktura VAT została już wystawiona dla tej proformy');
  }

  let invoiceNumber = '';
  if (manualNumber) {
    const { data: existing } = await ctx.supabase.from('invoices').select('id')
      .eq('invoice_number', customNumber).eq('my_company_id', proforma.my_company_id).maybeSingle();
    if (existing) fail('Faktura o tym numerze już istnieje');
    invoiceNumber = customNumber;
  }

  const name = trimmed(ctx.employee.name);
  const surname = trimmed(ctx.employee.surname);
  if (!name || !surname) {
    fail('Uzupełnij imię i nazwisko w swoim profilu pracownika. Te dane są wymagane jako podpis osoby upoważnionej do wystawienia faktury.');
  }

  if (!Array.isArray(proforma.invoice_items) || proforma.invoice_items.length === 0) fail('Proforma nie zawiera pozycji');

  const receivedPaymentConfirmed = form.receivedPaymentConfirmed === true;
  const recordedPaymentDate = getRecordedProformaPaymentDate(proforma, issueDate, todayDate);
  const paymentDate = recordedPaymentDate || parseProformaPaymentDate(str(form.receivedPaymentDate));
  if (targetType === 'advance') {
    if ((!recordedPaymentDate && !receivedPaymentConfirmed) || !paymentDate) {
      fail('Potwierdź otrzymanie całej kwoty pro formy i podaj rzeczywistą datę wpłaty.');
    }
    if (paymentDate > todayDate || paymentDate > issueDate) {
      fail('Data wpłaty nie może być w przyszłości ani po dacie wystawienia zaliczki.');
    }
  }

  const prepareLine = (item: Row, index: number): PreparedInvoiceLine => {
    const quantity = Number(item.quantity ?? 0);
    const priceNet = Number(item.price_net ?? 0);
    const vatRate = Number(item.vat_rate ?? 0);
    const valueNet = round2(quantity * priceNet);
    const vatAmount = round2((valueNet * vatRate) / 100);
    return {
      position_number: Number(item.position_number ?? index + 1),
      name: item.name,
      unit: item.unit || 'szt.',
      quantity,
      price_net: priceNet,
      vat_rate: vatRate,
      vat_code: item.vat_code || String(vatRate),
      vat_exemption_reason: item.vat_exemption_reason || null,
      value_net: valueNet,
      vat_amount: vatAmount,
      value_gross: round2(valueNet + vatAmount),
    };
  };
  // Pro forma określa już żądaną kwotę — bez ponownego procentowania.
  const documentItems = (proforma.invoice_items as Row[]).map(prepareLine);
  const orderItems = ((Array.isArray(proforma.invoice_order_items) && proforma.invoice_order_items.length > 0
    ? proforma.invoice_order_items : proforma.invoice_items) as Row[]).map(prepareLine);
  const orderTotals = orderItems.reduce(
    (sum, item) => ({ net: round2(sum.net + item.value_net), vat: round2(sum.vat + item.vat_amount), gross: round2(sum.gross + item.value_gross) }),
    { net: 0, vat: 0, gross: 0 },
  );
  const defaultDue = getInvoicePaymentDueDate(issueDate, DEFAULT_INVOICE_PAYMENT_TERM_DAYS);

  const invoiceData = {
    invoice_number: invoiceNumber,
    auto_number: !manualNumber,
    is_proforma: false,
    status: 'draft',
    payment_status: 'unpaid',
    paid_amount: 0,
    // Funkcja bazy zapisuje potwierdzoną wpłatę po zapisaniu pozycji, w tej samej transakcji.
    received_payment_confirmed: targetType === 'advance' && receivedPaymentConfirmed,
    received_payment_date: targetType === 'advance' ? paymentDate : null,
    related_invoice_id: proformaId,
    issue_date: issueDate,
    sale_date: saleDate,
    payment_due_date: (targetType === 'advance' ? null : paymentDueDate) || defaultDue,
    created_by: ctx.employee.id,
    invoice_type: targetType,
    my_company_id: proforma.my_company_id,
    event_id: proforma.event_id,
    organization_id: proforma.organization_id,
    contact_person_id: proforma.contact_person_id,
    buyer_is_private_person: proforma.buyer_is_private_person ?? false,
    buyer_contact_id: proforma.buyer_contact_id || null,
    billing_arrangement: proforma.billing_arrangement || 'direct',
    ...recipientPayload,
    service_recipient_contact_id: proforma.service_recipient_contact_id || null,
    seller_name: proforma.seller_name,
    seller_nip: proforma.seller_nip,
    seller_street: proforma.seller_street,
    seller_postal_code: proforma.seller_postal_code,
    seller_city: proforma.seller_city,
    seller_country: proforma.seller_country,
    seller_email: proforma.seller_email,
    seller_phone: proforma.seller_phone,
    buyer_name: str(buyer.name),
    buyer_nip: buyerNip,
    buyer_street: str(buyer.street),
    buyer_postal_code: str(buyer.postalCode),
    buyer_city: str(buyer.city),
    buyer_country: proforma.buyer_country,
    buyer_email: str(buyer.email) || null,
    buyer_phone: proforma.buyer_phone,
    buyer_contact_person: proforma.buyer_contact_person,
    payment_method: proforma.payment_method,
    bank_account: proforma.bank_account,
    bank_name: proforma.bank_name,
    bank_swift_code: proforma.bank_swift_code,
    issue_place: proforma.issue_place,
    company_logo_url: proforma.company_logo_url || null,
    footer_note: proforma.footer_note,
    signature_name: `${name} ${surname}`,
    website: proforma.website,
    currency_code: proforma.currency_code || 'PLN',
    order_total_net: targetType === 'advance' ? orderTotals.net : null,
    order_total_vat: targetType === 'advance' ? orderTotals.vat : null,
    order_total_gross: targetType === 'advance' ? orderTotals.gross : null,
    notes: proforma.notes,
    internal_notes: proforma.internal_notes
      ? `${proforma.internal_notes}\n\nWystawiona na podstawie proformy ${proforma.invoice_number}`
      : `Wystawiona na podstawie proformy ${proforma.invoice_number}`,
  };

  const { data: invoiceId, error } = await ctx.supabase.rpc('convert_proforma_with_payment_atomic', {
    p_proforma_id: proformaId,
    p_invoice: invoiceData,
    p_items: documentItems,
    p_order_items: targetType === 'advance' ? orderItems : [],
  });
  if (error || !invoiceId) {
    fail(
      error?.code === 'PGRST202'
        ? 'Nowy sposób rozliczania pro form wymaga aktualizacji bazy. Dokument nie został utworzony.'
        : error?.message || 'Błąd podczas tworzenia dokumentu z proformy',
      error?.code === '42501' ? 403 : 400,
    );
  }
  return {
    ok: true,
    id: str(invoiceId),
    message: targetType === 'advance'
      ? 'Wystawiono opłaconą zaliczkę i oznaczono pro formę jako opłaconą'
      : 'Faktura została utworzona (szkic)',
  };
}
