import 'server-only';
import type { NativeContext } from './auth';
import { canFinanceCompany, loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { getInvoicePaymentDueDate } from '@/lib/invoices/paymentTerm';

/*
 * Edycja faktury dla Maca — jak `/crm/invoices/[id]/edit`: tylko szkic albo pro forma (nie faktura końcowa, nie w toku
 * ani po przyjęciu przez KSeF); status dokumentu, firma, typ i numer, korekta (dokument źródłowy, zakres, skutek,
 * przyczyna, nota), nabywca (organizacja albo osoba prywatna), rozliczenie i powiązane wydarzenie, daty i termin,
 * nota płatnicza, sposób płatności i miejsce wystawienia, status płatności, procent zaliczki, pozycje. Serwer sprawdza
 * formularz jak `handleSubmit` strony CRM, dane sprzedawcy i nabywcy bierze z bazy, liczy wartości pozycji i zapisuje
 * funkcją `update_invoice_draft_atomic` (uprawnienia i blokada wystawionych dokumentów w bazie), potem odświeża
 * przypisanie do wydarzeń grupy rozliczeń.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class InvoiceEditError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new InvoiceEditError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const trimmed = (value: unknown) => str(value).trim();
const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const fixed2 = (value: number) => Number(value.toFixed(2));
const day = (value: unknown) => trimmed(value).slice(0, 10);

const ARRANGEMENTS = ['direct', 'hotel', 'agency', 'other'];
const VAT_CODES = ['23', '8', '5', '0', '0 KR', '0 WDT', '0 EX', 'zw', 'np', 'np I', 'np II', 'oo'];
const STATUSES = ['draft', 'proforma', 'issued', 'sent', 'paid', 'overdue'];
/** Stawka liczbowa jak w edytorze CRM: 23 / 8 / 5 / 0 z kodu, pozostałe kody 0. */
const rateOf = (code: string) => (['23', '8', '5', '0'].includes(code) ? Number(code) : 0);

const EVENT_FIELDS = 'id,name,event_date,my_company_id,organization_id,contact_person_id,billing_arrangement,billing_organization_id';
const eventOut = (event: Row) => ({
  id: str(event.id), name: str(event.name), date: day(event.event_date) || null, companyId: str(event.my_company_id),
  organizationId: str(event.organization_id), contactPersonId: str(event.contact_person_id),
  billingArrangement: ARRANGEMENTS.includes(str(event.billing_arrangement)) ? str(event.billing_arrangement) : 'direct',
  billingOrganizationId: str(event.billing_organization_id),
});

/** Dokument chroniony przed edycją (jak `accountingLocked` w CRM i blokada w `update_invoice_draft_atomic`). */
function lockedMessage(invoice: Row): string | null {
  if (invoice.invoice_type === 'final') {
    return 'Fakturę końcową edytuje się wyłącznie w dedykowanym procesie rozliczenia zaliczek. Zwykły edytor mógłby zerwać jej powiązania.';
  }
  if (invoice.ksef_status === 'pending') {
    return 'Poprzednia wysyłka oczekuje na rozstrzygnięcie KSeF. Do tego czasu treść faktury nie może się zmienić.';
  }
  if (invoice.ksef_status === 'accepted' || invoice.ksef_reference_number || !['draft', 'proforma'].includes(str(invoice.status))) {
    return 'Po wystawieniu dokumentu jego treści księgowej nie wolno nadpisywać. Zmiany wykonuje się fakturą korygującą.';
  }
  return null;
}

async function businessClients(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.rpc('get_business_clients');
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error('Nieprawidłowa odpowiedź listy organizacji.');
  return (data as Row[]).map((client) => ({
    id: str(client.id), name: str(client.name), nip: str(client.nip), street: str(client.address),
    postalCode: str(client.postal_code), city: str(client.city), country: str(client.country) || 'PL',
    clientType: str(client.client_type), email: str(client.email), phone: str(client.phone),
  }));
}

/** Działalności do wyboru: z poziomem „Wystawianie faktur” i zawsze działalność tej faktury (baza sprawdza ponownie). */
async function editCompanies(ctx: NativeContext, currentId: string) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const { data, error } = await ctx.supabase.from('my_companies').select('*').eq('is_active', true).order('is_default', { ascending: false });
  if (error) fail('Nie udało się wczytać działalności.', 500);
  return rows(data).filter((company) => String(company.id) === currentId || canFinanceCompany(access, String(company.id), 'invoices_issue'));
}

const SELLER_REQUIRED: Array<[string, string]> = [
  ['legal_name', 'nazwa firmy'], ['nip', 'NIP'], ['street', 'adres (ulica)'], ['postal_code', 'kod pocztowy'], ['city', 'miasto'],
  ['bank_name', 'nazwa banku'], ['bank_account', 'numer konta bankowego'],
];

async function invoiceRow(ctx: NativeContext, idParam: unknown) {
  const id = trimmed(idParam);
  if (!UUID.test(id)) fail('Faktura nie została znaleziona', 404);
  const { data, error } = await ctx.supabase.from('invoices').select('*').eq('id', id).maybeSingle();
  if (error || !data) fail('Faktura nie została znaleziona', 404);
  return data as Row;
}

async function eventRow(ctx: NativeContext, id: string) {
  if (!UUID.test(id)) return null;
  const { data } = await ctx.supabase.from('events').select(EVENT_FIELDS).eq('id', id).maybeSingle();
  return (data as Row | null) || null;
}

async function organizationEvents(ctx: NativeContext, organizationId: string, preservedId: string) {
  if (!UUID.test(organizationId)) return [];
  const { data, error } = await ctx.supabase.from('events').select(EVENT_FIELDS).eq('organization_id', organizationId)
    .order('event_date', { ascending: false });
  if (error) return [];
  const events = rows(data).map(eventOut);
  if (preservedId && !events.some((event) => event.id === preservedId)) {
    const preserved = await eventRow(ctx, preservedId);
    if (preserved) events.unshift(eventOut(preserved));
  }
  return events;
}

/** Okno edycji: stan formularza wczytany jak `fetchData` strony CRM i dane do wyboru. */
export async function invoiceEditSetup(ctx: NativeContext, idParam: unknown) {
  const invoice = await invoiceRow(ctx, idParam);
  const id = str(invoice.id);
  const locked = lockedMessage(invoice);
  const base = {
    id,
    number: str(invoice.invoice_number),
    rawType: str(invoice.invoice_type),
    status: str(invoice.status),
    currency: str(invoice.currency_code) || 'PLN',
    ksef: {
      status: str(invoice.ksef_status), reference: str(invoice.ksef_reference_number),
      sentAt: str(invoice.ksef_sent_at), error: str(invoice.ksef_error),
    },
    locked,
    canCorrect: invoice.invoice_type !== 'proforma' && invoice.invoice_type !== 'final',
  };
  if (locked) return { ...base, form: null };

  const [itemsRes, orderItemsRes, clientsResult, companies, correctableRes, individualsRes] = await Promise.all([
    ctx.supabase.from('invoice_items').select('*').eq('invoice_id', id).order('position_number'),
    ctx.supabase.from('invoice_order_items').select('*').eq('invoice_id', id).order('position_number'),
    businessClients(ctx).then((list) => ({ list, error: null as string | null }))
      .catch(() => ({ list: [] as Awaited<ReturnType<typeof businessClients>>, error: 'Nie udało się pobrać organizacji z CRM.' })),
    editCompanies(ctx, str(invoice.my_company_id)),
    ctx.supabase.from('invoices')
      .select('id, invoice_number, invoice_type, issue_date, total_gross, buyer_name, status, buyer_is_private_person, event_id')
      .neq('id', id).neq('invoice_type', 'corrective').in('status', ['issued', 'sent', 'paid'])
      .order('issue_date', { ascending: false }),
    ctx.supabase.from('contacts').select('id, first_name, last_name, full_name, email, phone, mobile, address, street, postal_code, city')
      .eq('contact_type', 'individual').order('last_name', { ascending: true }),
  ]);

  // Typ i pozycje: zaliczka pokazuje pełne zamówienie, procent wynika z kwoty dokumentu i wartości zamówienia.
  const type = invoice.is_proforma ? 'proforma'
    : ['advance', 'corrective', 'final'].includes(str(invoice.invoice_type)) ? str(invoice.invoice_type) : 'vat';
  const orderItems = rows(orderItemsRes.data);
  const sourceItems = invoice.invoice_type === 'advance' && orderItems.length ? orderItems : rows(itemsRes.data);
  let advancePercent = 30;
  if (invoice.invoice_type === 'advance') {
    const orderGross = Number(invoice.order_total_gross ?? orderItems.reduce((sum, item) => sum + Number(item.value_gross ?? 0), 0));
    const paidGross = Number(invoice.total_gross ?? 0);
    if (orderGross > 0) advancePercent = Number(((paidGross / orderGross) * 100).toFixed(2));
  }
  let paymentDays = 14;
  if (invoice.issue_date && invoice.payment_due_date) {
    const issue = new Date(`${day(invoice.issue_date)}T00:00:00Z`).getTime();
    const due = new Date(`${day(invoice.payment_due_date)}T00:00:00Z`).getTime();
    const days = Math.round((due - issue) / 86_400_000);
    paymentDays = days > 0 ? days : 14;
  }

  // Wydarzenie: odbiorca usługi z wydarzenia, gdy dokument go nie zapisał (jak `fetchEventContext(…, sync)`).
  const eventId = str(invoice.event_id);
  const event = eventId ? await eventRow(ctx, eventId) : null;
  const syncRecipients = !invoice.service_recipient_organization_id && !invoice.service_recipient_contact_id;
  const serviceRecipientOrganizationId = syncRecipients && event ? str(event.organization_id) : str(invoice.service_recipient_organization_id);
  const serviceRecipientContactId = syncRecipients && event ? str(event.contact_person_id) : str(invoice.service_recipient_contact_id);
  const orgEvents = invoice.organization_id ? await organizationEvents(ctx, str(invoice.organization_id), eventId) : [];

  const companyId = str(invoice.my_company_id) || str((companies.find((company) => company.is_default) || companies[0])?.id);
  const selectedCompany = companies.find((company) => String(company.id) === str(invoice.my_company_id))
    || companies.find((company) => company.is_default) || companies[0];
  const [firstName = '', ...lastName] = str(invoice.buyer_name).split(' ');
  const paymentStatus = ['unpaid', 'partially_paid', 'paid'].includes(str(invoice.payment_status))
    ? str(invoice.payment_status) : invoice.status === 'paid' ? 'paid' : 'unpaid';

  return {
    ...base,
    form: {
      number: str(invoice.invoice_number),
      type,
      status: str(invoice.status) || 'draft',
      companyId,
      issueDate: day(invoice.issue_date),
      saleDate: day(invoice.sale_date),
      paymentDays: String(paymentDays),
      paymentMethod: str(invoice.payment_method) || 'Przelew',
      issuePlace: str(invoice.issue_place),
      includeFooter: Boolean(invoice.footer_note),
      footer: str(invoice.footer_note),
      website: str(invoice.website) || (selectedCompany ? str(selectedCompany.website) : 'www.mavinci.pl'),
      privatePerson: invoice.buyer_is_private_person === true,
      privateBuyer: invoice.buyer_is_private_person === true ? {
        firstName, lastName: lastName.join(' '), street: str(invoice.buyer_street), postalCode: str(invoice.buyer_postal_code),
        city: str(invoice.buyer_city), email: str(invoice.buyer_email), phone: str(invoice.buyer_phone),
      } : { firstName: '', lastName: '', street: '', postalCode: '', city: '', email: '', phone: '' },
      individualId: str(invoice.buyer_contact_id),
      organizationId: str(invoice.organization_id),
      eventId,
      billingArrangement: ARRANGEMENTS.includes(str(invoice.billing_arrangement)) ? str(invoice.billing_arrangement) : 'direct',
      serviceRecipientOrganizationId,
      serviceRecipientContactId,
      paymentStatus,
      paidAmount: num(invoice.paid_amount),
      paidDate: str(invoice.paid_at).split('T')[0] || day(invoice.payment_due_date) || day(invoice.issue_date),
      advancePercent,
      correction: {
        relatedId: str(invoice.related_invoice_id),
        reason: str(invoice.correction_reason),
        type: [1, 2, 3].includes(Number(invoice.correction_type)) ? Number(invoice.correction_type) : 2,
        scope: str(invoice.correction_scope) === 'partial' ? 'partial' : 'full',
        number: str(invoice.corrected_invoice_number),
        issueDate: day(invoice.corrected_invoice_issue_date),
        ksefNumber: str(invoice.corrected_invoice_ksef_number),
        wasInKsef: invoice.corrected_invoice_was_in_ksef === true,
      },
      items: sourceItems.map((item) => ({
        position: num(item.position_number),
        name: str(item.name),
        unit: str(item.unit) || 'szt.',
        quantity: Number(item.quantity ?? item.after_quantity ?? 0) || 0,
        priceNet: Number(item.price_net ?? item.after_price_net ?? 0) || 0,
        vatRate: num(item.vat_rate),
        vatCode: str(item.vat_code) || String(item.vat_rate || 23),
        exemption: str(item.vat_exemption_reason),
        beforeQuantity: numOrNull(item.before_quantity),
        beforePriceNet: numOrNull(item.before_price_net),
        beforeNet: numOrNull(item.before_value_net),
        beforeVat: numOrNull(item.before_vat_amount),
      })),
    },
    companies: companies.map((company) => ({
      id: String(company.id), name: str(company.name), legalName: str(company.legal_name), nip: str(company.nip),
      isDefault: company.is_default === true, city: str(company.city), website: str(company.website),
    })),
    organizations: clientsResult.list,
    organizationsError: clientsResult.error,
    individuals: rows(individualsRes.data).map((contact) => ({
      id: str(contact.id), firstName: str(contact.first_name), lastName: str(contact.last_name),
      name: str(contact.full_name) || `${str(contact.first_name)} ${str(contact.last_name)}`.trim(),
      email: str(contact.email), phone: str(contact.phone) || str(contact.mobile), street: str(contact.street) || str(contact.address),
      postalCode: str(contact.postal_code), city: str(contact.city),
    })),
    correctable: rows(correctableRes.data).map((row) => ({
      id: str(row.id), number: str(row.invoice_number), type: str(row.invoice_type), issueDate: day(row.issue_date) || null,
      gross: num(row.total_gross), buyerName: str(row.buyer_name), companyId: '',
    })),
    linkedEvent: event ? eventOut(event) : null,
    organizationEvents: orgEvents,
  };
}

/** Wydarzenia nabywcy do pola „Powiązane wydarzenie” (obecne wydarzenie zostaje na liście). */
export async function invoiceEditEvents(ctx: NativeContext, organizationParam: unknown, keepParam: unknown) {
  return { events: await organizationEvents(ctx, trimmed(organizationParam), trimmed(keepParam)) };
}

type EditItem = {
  position_number: number; name: string; unit: string; quantity: number; price_net: number; vat_rate: number; vat_code: string;
  vat_exemption_reason: string; before_quantity: number | null; before_price_net: number | null;
  before_value_net: number | null; before_vat_amount: number | null;
};

function editItems(value: unknown): EditItem[] {
  return rows(value).slice(0, 500).map((item, index) => {
    const code = str(item.vatCode);
    if (!VAT_CODES.includes(code)) fail('Nieprawidłowa stawka VAT pozycji.');
    const quantity = Number(item.quantity);
    const priceNet = Number(item.priceNet);
    if (!Number.isFinite(quantity) || !Number.isFinite(priceNet)) fail('Nieprawidłowa ilość lub cena pozycji.');
    return {
      position_number: index + 1,
      name: str(item.name).slice(0, 500),
      unit: (str(item.unit) || 'szt.').slice(0, 30),
      quantity,
      price_net: priceNet,
      vat_rate: rateOf(code),
      vat_code: code,
      vat_exemption_reason: str(item.exemption),
      before_quantity: numOrNull(item.beforeQuantity),
      before_price_net: numOrNull(item.beforePriceNet),
      before_value_net: numOrNull(item.beforeNet),
      before_vat_amount: numOrNull(item.beforeVat),
    };
  });
}

/** Wartości pozycji jak `calculateItemValues` edytora CRM (korekta — różnica „po” minus „przed”). */
function itemValues(item: EditItem, corrective: boolean) {
  const afterNet = fixed2(item.quantity * item.price_net);
  const afterVat = fixed2(Math.round(afterNet * item.vat_rate) / 100);
  const afterGross = fixed2(afterNet + afterVat);
  if (corrective) {
    const beforeNet = Number(item.before_value_net ?? Number(item.before_quantity ?? 0) * Number(item.before_price_net ?? 0));
    const beforeVat = Number(item.before_vat_amount ?? Math.round(beforeNet * item.vat_rate) / 100);
    return {
      valueNet: fixed2(afterNet - beforeNet),
      vatAmount: fixed2(afterVat - beforeVat),
      valueGross: fixed2(afterGross - beforeNet - beforeVat),
    };
  }
  return { valueNet: afterNet, vatAmount: afterVat, valueGross: afterGross };
}

function totalsOf(items: EditItem[], corrective: boolean) {
  let totalNet = 0;
  let totalVat = 0;
  let totalGross = 0;
  for (const item of items) {
    const values = itemValues(item, corrective);
    totalNet += values.valueNet;
    totalVat += values.vatAmount;
    totalGross += values.valueGross;
  }
  return { totalNet, totalVat, totalGross };
}

/** „Zapisz zmiany” (`handleSubmit` edytora CRM) → `update_invoice_draft_atomic`, potem przypisanie do grupy rozliczeń. */
export async function invoiceEditSave(ctx: NativeContext, body: Row) {
  const invoice = await invoiceRow(ctx, body.id);
  const id = str(invoice.id);
  if (lockedMessage(invoice)) fail('Tego dokumentu nie można edytować. Wystaw korektę.');
  const form = object(body.form);
  const type = ['vat', 'proforma', 'advance', 'corrective'].includes(str(form.type)) ? str(form.type) : '';
  if (!type) fail('Wybierz typ faktury.');
  const corrective = type === 'corrective';
  const companyId = trimmed(form.companyId);
  if (!companyId) fail('Wybierz firmę wystawiającą fakturę');
  const eventId = trimmed(form.eventId);
  if (eventId && !UUID.test(eventId)) fail('Nieprawidłowe wydarzenie.');
  const billingArrangement = ARRANGEMENTS.includes(str(form.billingArrangement)) ? str(form.billingArrangement) : 'direct';
  const privatePerson = form.privatePerson === true;
  const privateBuyer = object(form.privateBuyer);
  const organizationId = trimmed(form.organizationId);
  const serviceRecipientOrganizationId = trimmed(form.serviceRecipientOrganizationId);
  const serviceRecipientContactId = trimmed(form.serviceRecipientContactId);

  if (eventId && billingArrangement !== 'direct' && privatePerson) fail('Hotel lub pośrednik musi być wybrany jako organizacja.');
  if (privatePerson) {
    if (!trimmed(privateBuyer.firstName) || !trimmed(privateBuyer.lastName) || !trimmed(privateBuyer.street)
      || !trimmed(privateBuyer.postalCode) || !trimmed(privateBuyer.city)) {
      fail('Uzupełnij dane osoby prywatnej: imię, nazwisko, adres, kod pocztowy i miasto.');
    }
  } else if (!organizationId) {
    fail('Wybierz nabywcę');
  }
  const invoiceNumber = str(form.number);
  if (!invoiceNumber) fail('Numer faktury jest wymagany');

  const items = editItems(form.items);
  if (corrective) {
    if (items.some((item) => !item.name)) fail('Wypełnij nazwy wszystkich pozycji faktury');
  } else if (items.some((item) => !item.name || item.price_net <= 0)) {
    fail('Wypełnij wszystkie pozycje faktury');
  }
  if (items.some((item) => item.vat_code === 'zw' && !item.vat_exemption_reason.trim())) {
    fail('Podaj podstawę prawną dla każdej pozycji zwolnionej z VAT.');
  }
  if (items.some((item) => item.vat_code === '0' || item.vat_code === 'np')) {
    fail('Dla 0% wybierz rodzaj transakcji (krajowa, WDT lub eksport), a dla „np.” wybierz np I albo np II.');
  }
  const advancePercent = Number(form.advancePercent);
  if (type === 'advance' && (!Number.isFinite(advancePercent) || advancePercent <= 0 || advancePercent > 100)) {
    fail('Zaliczka musi być większa od 0% i nie może przekraczać 100%.');
  }

  let selectedOrg: Awaited<ReturnType<typeof businessClients>>[number] | null = null;
  if (!privatePerson) {
    const clients = await businessClients(ctx).catch(() => fail('Nie udało się pobrać organizacji z CRM.'));
    selectedOrg = clients.find((client) => client.id === organizationId) || null;
    if (!selectedOrg) fail('Nie znaleziono wybranego nabywcy. Wybierz go ponownie.');
  }
  const companies = await editCompanies(ctx, str(invoice.my_company_id));
  const company = companies.find((candidate) => String(candidate.id) === companyId);
  if (!company) fail('Nie znaleziono wybranej firmy wystawiającej.');

  const issueDate = trimmed(form.issueDate);
  const saleDate = trimmed(form.saleDate);
  if (!DAY.test(issueDate) || !DAY.test(saleDate)) fail('Podaj datę wystawienia i datę sprzedaży.');

  const missingSellerFields = SELLER_REQUIRED.filter(([key]) => !company[key]).map(([, label]) => label);
  if (missingSellerFields.length) {
    fail(`Uzupełnij dane firmy wystawiającej: ${missingSellerFields.join(', ')}. Przejdź do Ustawienia > Moje firmy.`);
  }
  if (!privatePerson && !selectedOrg?.nip) fail('Nabywca nie ma uzupełnionego NIP. Uzupełnij dane kontrahenta.');
  if (eventId && billingArrangement !== 'direct' && organizationId === serviceRecipientOrganizationId) {
    fail('Wybierz hotel lub inną organizację, która będzie nabywcą faktury.');
  }

  const sellerStreet = [company.street, company.building_number, company.apartment_number ? `/${company.apartment_number}` : '']
    .filter(Boolean).join(' ').trim();
  const ratio = advancePercent / 100;
  const orderItems = items;
  const documentItems = type === 'advance'
    ? orderItems.map((item) => ({ ...item, price_net: fixed2(Number(item.price_net) * ratio) }))
    : orderItems;
  const orderTotals = totalsOf(orderItems, corrective);
  const documentTotals = totalsOf(documentItems, corrective);

  const paymentStatus = ['unpaid', 'partially_paid', 'paid'].includes(str(form.paymentStatus)) ? str(form.paymentStatus) : 'unpaid';
  const paidAmount = num(form.paidAmount);
  if (paymentStatus === 'partially_paid' && (paidAmount <= 0 || paidAmount >= documentTotals.totalGross)) {
    fail('Wpłata częściowa musi być większa od zera i mniejsza od kwoty dokumentu.');
  }
  const correction = object(form.correction);
  const relatedId = trimmed(correction.relatedId);
  const correctionReason = str(correction.reason);
  if (corrective && !relatedId) fail('Wybierz fakturę do korekty');
  if (corrective && !correctionReason.trim()) fail('Podaj przyczynę korekty');

  const paidDate = day(form.paidDate);
  if (paymentStatus !== 'unpaid' && paidDate && !DAY.test(paidDate)) fail('Podaj poprawną datę płatności.');
  const dueDate = getInvoicePaymentDueDate(issueDate, str(form.paymentDays));
  if (paymentStatus !== 'paid' && !dueDate) fail('Podaj termin płatności jako liczbę całkowitą dni od 0 oraz poprawną datę wystawienia.');
  const status = STATUSES.includes(str(form.status)) ? str(form.status) : 'draft';
  if (type === 'proforma' && !['draft', 'proforma'].includes(status) && paymentStatus !== 'paid') fail('Wybierz status pro formy.');

  const signatureName = [ctx.employee.name, ctx.employee.surname].map((part) => trimmed(part)).filter(Boolean).join(' ').trim()
    || str(company.signature_name);

  // Nota: korekta — odniesienie do faktury pierwotnej i przyczyna; inne — nota płatnicza, gdy zaznaczona.
  let footerNote: string | null;
  if (corrective) {
    const correctedIssueDate = day(correction.issueDate);
    const issueDateText = correctedIssueDate
      ? new Date(`${correctedIssueDate}T12:00:00Z`).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '-';
    footerNote = `Faktura korygująca odnosi się do faktury ${str(correction.number) || '-'} z dnia ${issueDateText}. Przyczyna korekty: ${correctionReason || '-'}.`;
  } else {
    footerNote = form.includeFooter === true ? (str(form.footer).trim() || null) : null;
  }

  const invoiceData: Row = {
    event_id: eventId || null,
    invoice_number: invoiceNumber,
    invoice_type: type,
    is_proforma: type === 'proforma',
    payment_status: paymentStatus,
    paid_amount: paymentStatus === 'paid' ? documentTotals.totalGross : paymentStatus === 'partially_paid' ? paidAmount : 0,
    paid_at: paymentStatus === 'unpaid' ? null : paidDate || null,
    status: paymentStatus === 'paid' ? 'paid' : status,
    payment_due_date: paymentStatus === 'paid' ? paidDate || issueDate : dueDate,
    issue_date: issueDate,
    sale_date: saleDate,
    footer_note: footerNote,
    signature_name: signatureName,
    website: str(form.website),
    organization_id: privatePerson ? null : organizationId,
    buyer_contact_id: privatePerson ? trimmed(form.individualId) || null : null,
    billing_arrangement: eventId ? billingArrangement : 'direct',
    service_recipient_organization_id: eventId ? serviceRecipientOrganizationId || null : null,
    service_recipient_contact_id: eventId ? serviceRecipientContactId || null : null,
    buyer_name: privatePerson ? `${str(privateBuyer.firstName)} ${str(privateBuyer.lastName)}`.trim() : selectedOrg!.name,
    buyer_nip: privatePerson ? null : selectedOrg!.nip,
    buyer_street: privatePerson ? str(privateBuyer.street) : selectedOrg!.street || '',
    buyer_postal_code: privatePerson ? str(privateBuyer.postalCode) : selectedOrg!.postalCode || '',
    buyer_city: privatePerson ? str(privateBuyer.city) : selectedOrg!.city || '',
    buyer_country: 'Polska',
    buyer_email: privatePerson ? str(privateBuyer.email) || null : selectedOrg!.email || null,
    buyer_phone: privatePerson ? str(privateBuyer.phone) || null : selectedOrg!.phone || null,
    buyer_is_private_person: privatePerson,
    my_company_id: companyId,
    seller_name: company.legal_name,
    seller_nip: company.nip,
    seller_street: sellerStreet,
    seller_postal_code: company.postal_code,
    seller_city: company.city,
    seller_email: company.email,
    seller_phone: company.phone,
    seller_country: 'Polska',
    payment_method: str(form.paymentMethod) || 'Przelew',
    bank_name: company.bank_name || '',
    bank_account: company.bank_account || '',
    bank_swift_code: company.bank_swift_code || null,
    issue_place: str(form.issuePlace) || company.city,
    currency_code: str(invoice.currency_code) || 'PLN',
    order_total_net: type === 'advance' ? orderTotals.totalNet : null,
    order_total_vat: type === 'advance' ? orderTotals.totalVat : null,
    order_total_gross: type === 'advance' ? orderTotals.totalGross : null,
    updated_at: new Date().toISOString(),
  };
  if (corrective) {
    invoiceData.related_invoice_id = relatedId || null;
    invoiceData.correction_reason = correctionReason;
    invoiceData.correction_type = [1, 2, 3].includes(Number(correction.type)) ? Number(correction.type) : 2;
    invoiceData.correction_scope = str(correction.scope) === 'partial' ? 'partial' : 'full';
    invoiceData.corrected_invoice_number = str(correction.number);
    invoiceData.corrected_invoice_issue_date = day(correction.issueDate) || null;
    invoiceData.corrected_invoice_ksef_number = str(correction.ksefNumber) || null;
    invoiceData.corrected_invoice_was_in_ksef = correction.wasInKsef === true;
  } else {
    invoiceData.related_invoice_id = null;
    invoiceData.correction_reason = null;
    invoiceData.correction_scope = null;
    invoiceData.corrected_invoice_number = null;
    invoiceData.corrected_invoice_issue_date = null;
    invoiceData.corrected_invoice_ksef_number = null;
    invoiceData.corrected_invoice_was_in_ksef = false;
  }

  const itemsToInsert = documentItems.map((item) => {
    const { valueNet, vatAmount, valueGross } = itemValues(item, corrective);
    if (corrective) {
      return {
        position_number: item.position_number, name: item.name, unit: item.unit, vat_rate: item.vat_rate, vat_code: item.vat_code,
        vat_exemption_reason: item.vat_exemption_reason.trim() || null,
        before_quantity: Number(item.before_quantity ?? 0), before_price_net: Number(item.before_price_net ?? 0),
        after_quantity: Number(item.quantity ?? 0), after_price_net: Number(item.price_net ?? 0),
      };
    }
    return {
      position_number: item.position_number, name: item.name, unit: item.unit, quantity: item.quantity, price_net: item.price_net,
      vat_rate: item.vat_rate, vat_code: item.vat_code, vat_exemption_reason: item.vat_exemption_reason.trim() || null,
      value_net: valueNet, vat_amount: vatAmount, value_gross: valueGross,
    };
  });
  const orderItemsToInsert = type === 'advance'
    ? orderItems.map((item) => {
      const { valueNet, vatAmount, valueGross } = itemValues(item, false);
      return {
        position_number: item.position_number, name: item.name, unit: item.unit, quantity: item.quantity, price_net: item.price_net,
        vat_rate: item.vat_rate, vat_code: item.vat_code, vat_exemption_reason: item.vat_exemption_reason.trim() || null,
        value_net: valueNet, vat_amount: vatAmount, value_gross: valueGross,
      };
    })
    : [];

  const { error } = await ctx.supabase.rpc('update_invoice_draft_atomic', {
    p_invoice_id: id, p_invoice: invoiceData, p_items: itemsToInsert, p_order_items: orderItemsToInsert,
  });
  if (error) {
    const duplicate = error.code === '23505' || str(error.message).includes('23505');
    fail(duplicate ? 'Faktura o tym numerze już istnieje. Wybierz inny numer.' : error.message || 'Błąd podczas aktualizacji faktury',
      error.code === '42501' ? 403 : 400);
  }
  let warning: string | null = null;
  if (eventId) {
    const { error: linkError } = await ctx.supabase.rpc('link_invoice_to_event_settlement', { p_invoice_id: id, p_source_event_id: eventId });
    if (linkError) warning = 'Faktura została zapisana, ale nie udało się odświeżyć wspólnego rozliczenia';
  }
  return { ok: true, id, message: 'Faktura została zaktualizowana', warning };
}
