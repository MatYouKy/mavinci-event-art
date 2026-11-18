import 'server-only';
import type { NativeContext } from './auth';
import { filterFinanceCompanies, loadInvoiceFinanceAccess, type InvoiceFinanceAccess } from '@/lib/invoices/financeAccess';
import { getAcceptedCalculationInvoicePrefill, getAcceptedOfferInvoicePrefill } from '@/lib/invoices/acceptedOfferPrefill';
import {
  createEmptyInvoiceRecipientDraft,
  invoiceRecipientPayload,
  recipientDraftFromInvoice,
  validateInvoiceRecipientDraft,
  type InvoiceRecipientDraft,
} from '@/lib/invoices/ksefRecipient';
import { getInvoicePaymentDueDate } from '@/lib/invoices/paymentTerm';

/*
 * Wystawianie faktury z Maca — jak `/crm/invoices/new` (faktura VAT, pro forma, zaliczkowa, kolejna zaliczka, korekta kwot
 * i korekta danych nabywcy / odbiorcy). Dane formularza (działalności z poziomem „Wystawianie faktur”, nabywcy, osoby
 * prywatne, faktury do korekty, kontekst wydarzenia, grupa rozliczeń, źródła pozycji z zaakceptowanej kalkulacji lub oferty,
 * dane odbiorcy KSeF) i zapis tą samą funkcją bazy (`create_invoice_atomic`, `link_invoice_to_event_settlement`), tokenem
 * pracownika. Serwer sprawdza formularz w tej samej kolejności i tymi samymi komunikatami co przeglądarka; firmę, nabywcę
 * organizację, wydarzenie, dokument korygowany i zamówienie zaliczki odczytuje z bazy, a nie z danych aplikacji.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class InvoiceFormError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new InvoiceFormError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const trimmed = (value: unknown) => str(value).trim();
const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const round2 = (value: number) => Number(value.toFixed(2));
const money = (value: number) => Math.round(value * 100) / 100;
const day = (value: unknown) => trimmed(value).slice(0, 10);
const plDate = (value: string) => new Date(value).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' });

export type InvoiceType = 'vat' | 'proforma' | 'advance' | 'corrective';
const INVOICE_TYPES: InvoiceType[] = ['vat', 'proforma', 'advance', 'corrective'];
const VAT_CODES = ['23', '8', '5', '0', '0 KR', '0 WDT', '0 EX', 'zw', 'np', 'np I', 'np II', 'oo'];
const PAYMENT_METHODS = ['Przelew', 'Gotówka', 'Karta', 'BLIK'];
const ARRANGEMENTS = ['direct', 'hotel', 'agency', 'other'];
/** Stawka liczbowa jak w formularzu CRM: 23 / 8 / 5 dla stawek procentowych, 0 dla pozostałych kodów. */
const rateOf = (code: string) => (['23', '8', '5'].includes(code) ? Number(code) : 0);

// MARK: Dostęp

async function issueAccess(ctx: NativeContext) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  if (!access.canIssueInvoices) fail('Brak uprawnień do wystawienia faktury.', 403);
  return access;
}
const canUseEvent = (access: InvoiceFinanceAccess, id: string) =>
  !id || access.scope === 'company' || access.soldEventIds.includes(id);

/** Pola sprzedawcy wymagane przy wystawieniu (komunikat jak w CRM). */
const SELLER_REQUIRED: Array<[string, string]> = [
  ['legal_name', 'nazwa firmy'], ['nip', 'NIP'], ['street', 'adres (ulica)'], ['postal_code', 'kod pocztowy'], ['city', 'miasto'],
  ['bank_name', 'nazwa banku'], ['bank_account', 'numer konta bankowego'], ['email', 'email'], ['phone', 'telefon'],
];

/** Działalności aktywne z poziomem co najmniej „Wystawianie faktur” (administrator — wszystkie), domyślna pierwsza. */
async function issueCompanies(ctx: NativeContext, access: InvoiceFinanceAccess): Promise<Row[]> {
  const { data, error } = await ctx.supabase.from('my_companies').select('*').eq('is_active', true).order('is_default', { ascending: false });
  if (error) fail('Nie udało się wczytać działalności dostępnych do wystawienia faktury.', 500);
  const list = ((data || []) as Row[]).map((company) => ({ ...company, id: String(company.id) }));
  return filterFinanceCompanies(access, list, 'invoices_issue');
}
const companyOut = (company: Row) => ({
  id: String(company.id),
  name: str(company.name),
  legalName: str(company.legal_name),
  nip: str(company.nip),
  isDefault: company.is_default === true,
  footer: str(company.invoice_footer_text),
  missing: SELLER_REQUIRED.filter(([key]) => !company[key]).map(([, label]) => label),
});

// MARK: Nabywcy, osoby prywatne, odbiorcy

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
type BusinessClient = Awaited<ReturnType<typeof businessClients>>[number];

/** Nabywca faktur z karty organizacji (np. szkoła → gmina), jak `fetchInvoiceBuyerLink`. */
async function buyerLinkOf(ctx: NativeContext, organizationId: string) {
  if (!UUID.test(organizationId)) return null;
  const { data: unit, error } = await ctx.supabase.from('organizations')
    .select('id,invoice_buyer_organization_id,invoice_recipient_role').eq('id', organizationId).maybeSingle();
  if (error) {
    if (error.code === '42703' || error.code === 'PGRST204') return null;
    throw error;
  }
  const row = unit as Row | null;
  if (!row?.invoice_buyer_organization_id) return null;
  const { data: buyer, error: buyerError } = await ctx.supabase.from('organizations')
    .select('id,name,alias,nip,address,postal_code,city').eq('id', row.invoice_buyer_organization_id).maybeSingle();
  if (buyerError) throw buyerError;
  if (!buyer) return null;
  const b = buyer as Row;
  return {
    unitOrganizationId: str(row.id),
    role: row.invoice_recipient_role === 2 ? 2 : 8,
    buyer: { id: str(b.id), name: str(b.name), alias: str(b.alias), nip: str(b.nip), address: str(b.address), postalCode: str(b.postal_code), city: str(b.city) },
  };
}
type BuyerLink = NonNullable<Awaited<ReturnType<typeof buyerLinkOf>>>;

const COUNTRIES: Record<string, string> = { POLSKA: 'PL', POLAND: 'PL', NIEMCY: 'DE', GERMANY: 'DE', CZECHY: 'CZ', SŁOWACJA: 'SK', 'WIELKA BRYTANIA': 'GB' };
const recipientCountry = (value: unknown) => {
  const country = trimmed(value).toUpperCase();
  return COUNTRIES[country] || country || 'PL';
};

/** Dane odbiorcy z organizacji CRM (jak „Pobierz aktualne dane z CRM”): JST (rola 8) — własny NIP, bez IDWew. */
export async function recipientOrganization(ctx: NativeContext, idParam: unknown) {
  await issueAccess(ctx);
  const id = trimmed(idParam);
  if (!UUID.test(id)) fail('Wybierz organizację odbiorcy.');
  const { data, error } = await ctx.supabase.from('organizations')
    .select('id,name,nip,address,postal_code,city,country,ksef_internal_id,invoice_recipient_role').eq('id', id).maybeSingle();
  if (error || !data) fail('Nie udało się odczytać danych odbiorcy. Wybierz organizację ponownie albo wpisz dane ręcznie.');
  const row = data as Row;
  const role = row.invoice_recipient_role === 8 ? 8 : 2;
  return {
    mode: 'organization', organizationId: id,
    data: {
      name: str(row.name), nip: role === 8 ? str(row.nip).replace(/\D/g, '') : str(row.nip),
      internalId: role === 8 ? '' : str(row.ksef_internal_id), street: str(row.address), postalCode: str(row.postal_code),
      city: str(row.city), countryCode: recipientCountry(row.country), role,
    },
  };
}

/** Organizacje do wyboru odbiorcy (nazwa, NIP, miejscowość). */
export async function recipientOrganizations(ctx: NativeContext) {
  await issueAccess(ctx);
  const { data, error } = await ctx.supabase.from('organizations').select('id,name,nip,city').order('name');
  if (error) fail('Nie udało się wczytać organizacji. Możesz wprowadzić dane odbiorcy ręcznie.', 500);
  return { organizations: ((data || []) as Row[]).map((row) => ({ id: str(row.id), name: str(row.name), nip: str(row.nip), city: str(row.city) })) };
}

export async function invoiceBuyerLink(ctx: NativeContext, organizationId: unknown) {
  await issueAccess(ctx);
  return { link: await buyerLinkOf(ctx, trimmed(organizationId)).catch(() => null) };
}

// MARK: Wydarzenie, grupa rozliczeń, źródła pozycji

const EVENT_FIELDS = 'id,name,event_date,my_company_id,organization_id,contact_person_id,billing_arrangement,billing_organization_id';
const eventOut = (event: Row) => ({
  id: str(event.id), name: str(event.name), date: day(event.event_date) || null, companyId: str(event.my_company_id),
  organizationId: str(event.organization_id), contactPersonId: str(event.contact_person_id),
  billingArrangement: ARRANGEMENTS.includes(str(event.billing_arrangement)) ? str(event.billing_arrangement) : 'direct',
  billingOrganizationId: str(event.billing_organization_id),
});

async function eventRow(ctx: NativeContext, access: InvoiceFinanceAccess, id: string): Promise<Row | null> {
  if (!UUID.test(id) || !canUseEvent(access, id)) return null;
  const { data, error } = await ctx.supabase.from('events').select(EVENT_FIELDS).eq('id', id).maybeSingle();
  if (error) return null;
  return (data as Row | null) || null;
}

/** Wydarzenia rozliczane wspólnie z tym wydarzeniem (aktywna grupa rozliczeń), widoczne dla pracownika. */
async function settlementGroupOf(ctx: NativeContext, access: InvoiceFinanceAccess, eventId: string) {
  if (!UUID.test(eventId) || !canUseEvent(access, eventId)) return null;
  const { data: membership, error } = await ctx.supabase.from('event_settlement_group_members').select('group_id').eq('event_id', eventId).maybeSingle();
  if (error || !(membership as Row | null)?.group_id) return null;
  const groupId = str((membership as Row).group_id);
  const [groupResult, membersResult] = await Promise.all([
    ctx.supabase.from('event_settlement_groups').select('id,name,primary_event_id').eq('id', groupId).eq('status', 'active').maybeSingle(),
    ctx.supabase.from('event_settlement_group_members').select('event_id').eq('group_id', groupId),
  ]);
  const group = groupResult.data as Row | null;
  const members = (membersResult.data || []) as Row[];
  if (!group || !members.length) return null;
  const memberIds = members.map((member) => str(member.event_id)).filter((id) => canUseEvent(access, id));
  if (!memberIds.length) return null;
  const { data: events } = await ctx.supabase.from('events').select('id,name,event_date').in('id', memberIds).order('event_date', { ascending: true });
  return {
    id: str(group.id), name: str(group.name), primaryEventId: str(group.primary_event_id),
    events: ((events || []) as Row[]).map((event) => ({ id: str(event.id), name: str(event.name), date: day(event.event_date) || null })),
  };
}

type PrefillItem = { position_number: number; name: string; unit: string; quantity: number; price_net: number; vat_rate: number; vat_code: string };
const itemOut = (item: Row) => ({
  name: str(item.name), unit: str(item.unit) || 'szt.', quantity: num(item.quantity), priceNet: num(item.price_net),
  vatRate: num(item.vat_rate), vatCode: str(item.vat_code) || String(num(item.vat_rate)), exemption: str(item.vat_exemption_reason),
});

/** Źródła pozycji (`loadInvoiceItemSourceChoices`): tylko zaakceptowana kalkulacja lub oferta wydarzenia, bez cen katalogowych. */
async function itemSourcesOf(ctx: NativeContext, eventId: string) {
  const [eventResult, financialResult] = await Promise.all([
    ctx.supabase.from('events').select('name,financial_source,accepted_calculation_id').eq('id', eventId).single(),
    ctx.supabase.rpc('get_event_financial_info', { p_event_id: eventId }),
  ]);
  if (eventResult.error || financialResult.error) {
    throw new Error('Nie udało się odczytać zaakceptowanych źródeł tego wydarzenia. Nie podstawiono cen.');
  }
  const event = eventResult.data as Row;
  const financial = (Array.isArray(financialResult.data) ? financialResult.data[0] : null) as Row | null;
  const preferredId = event.financial_source === 'calculation' ? 'calculation' : 'offer';
  const results = await Promise.allSettled([
    (async () => {
      if (!event.accepted_calculation_id) return null;
      const { data, error } = await ctx.supabase.from('event_calculations')
        .select('name,is_accepted,event_calculation_items(name,quantity,unit,unit_price,days,vat_rate,position)')
        .eq('id', event.accepted_calculation_id).eq('event_id', eventId).eq('is_accepted', true).maybeSingle();
      if (error || !data) throw new Error('Nie można odczytać zaakceptowanej kalkulacji.');
      const calculation = data as Row;
      const prepared = getAcceptedCalculationInvoicePrefill(calculation as never);
      return { id: 'calculation', label: `Kalkulacja: ${str(calculation.name)}`, items: prepared.items.map(itemOut),
        net: prepared.totals.net, gross: prepared.totals.gross, discount: 0, notice: prepared.notice };
    })(),
    (async () => {
      if (!financial?.accepted_offer_id) return null;
      const { data, error } = await ctx.supabase.from('offers')
        .select('status,offer_number,subtotal,discount_amount,discount_percent,tax_percent,tax_amount,total_amount,offer_items(name,quantity,unit,unit_price,discount_percent,total,display_order)')
        .eq('id', financial.accepted_offer_id).eq('event_id', eventId).eq('status', 'accepted').maybeSingle();
      if (error || !data) throw new Error('Nie można odczytać zaakceptowanej oferty.');
      const offer = data as Row;
      const prepared = getAcceptedOfferInvoicePrefill(offer as never, str(event.name));
      return { id: 'offer', label: `Oferta ${str(offer.offer_number) || str(financial.accepted_offer_number)}`.trim(), items: prepared.items.map(itemOut),
        net: prepared.totals.net, gross: prepared.totals.gross, discount: prepared.totals.discountAmount, notice: prepared.notice };
    })(),
  ]);
  const choices: Array<{ id: string; label: string; items: ReturnType<typeof itemOut>[]; net: number; gross: number; discount: number; notice: string }> = [];
  const warnings: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) choices.push(result.value);
    if (result.status === 'rejected') warnings.push(result.reason instanceof Error ? result.reason.message : 'Nie udało się odczytać źródła pozycji.');
  }
  if (!choices.some((choice) => choice.id === preferredId)) {
    warnings.push('Brak dostępnego zaakceptowanego źródła finansowego wydarzenia. Wybierz świadomie inne dostępne źródło albo wprowadź pozycje ręcznie.');
  }
  return { choices, preferredId, warning: warnings.join(' '), eventName: str(event.name) };
}

/** Komunikat o firmie wystawiającej przypisanej do wydarzenia (`applyEventCompany`). */
function eventCompany(event: Row | null, companies: Row[]) {
  const companyId = str(event?.my_company_id);
  const available = companies.some((company) => company.id === companyId);
  return {
    companyId: available ? companyId : '',
    message: !event
      ? 'Nie udało się odczytać działalności wydarzenia. Sprawdź dane wydarzenia przed wyborem firmy wystawiającej.'
      : !companyId
        ? 'Wydarzenie nie ma przypisanej działalności. Wybierz firmę wystawiającą fakturę.'
        : !available
          ? 'Działalność przypisana do wydarzenia jest nieaktywna lub nie masz uprawnień do wystawiania jej faktur. Nie wybrano innej firmy automatycznie.'
          : null,
  };
}

/** Strony wynikające z wydarzenia (`fetchEventContext` z uzupełnieniem stron): nabywca, rozliczenie, odbiorca. */
async function eventParties(ctx: NativeContext, event: Row, link: BuyerLink | null) {
  const arrangement = ARRANGEMENTS.includes(str(event.billing_arrangement)) ? str(event.billing_arrangement) : 'direct';
  const buyerId = arrangement !== 'direct' ? str(event.billing_organization_id) : link?.buyer.id || str(event.organization_id);
  let recipient: InvoiceRecipientDraft | Row = createEmptyInvoiceRecipientDraft();
  let recipientError: string | null = null;
  const organizationId = str(event.organization_id);
  if (organizationId && organizationId !== buyerId) {
    // Szkoła rozliczana na gminę: nabywca = gmina, odbiorca = szkoła (dane z karty, jak automatyczne wczytanie w CRM).
    try {
      recipient = await recipientOrganization(ctx, organizationId);
    } catch (error) {
      const empty = createEmptyInvoiceRecipientDraft();
      recipient = { ...empty, mode: 'organization', organizationId, data: { ...empty.data, role: link && link.buyer.id === buyerId ? link.role : 2 } };
      recipientError = error instanceof Error ? error.message : 'Nie udało się odczytać odbiorcy.';
    }
  }
  return {
    billingArrangement: arrangement, buyerId,
    serviceRecipientOrganizationId: organizationId, serviceRecipientContactId: str(event.contact_person_id),
    recipient, recipientError,
  };
}

/**
 * Kontekst wydarzenia formularza. `mode`: `new` — nowa faktura (firma z wydarzenia, strony, źródła pozycji), `keep` — wydarzenie
 * dokumentu źródłowego (korekta, kolejna zaliczka): bez nadpisywania stron i pozycji.
 */
export async function invoiceEvent(ctx: NativeContext, idParam: unknown, modeParam: unknown) {
  const access = await issueAccess(ctx);
  const id = trimmed(idParam);
  if (!UUID.test(id)) fail('Nieprawidłowe wydarzenie.');
  if (!canUseEvent(access, id)) fail('Nie masz uprawnień do wystawienia faktury dla tego wydarzenia.', 403);
  const mode = trimmed(modeParam) === 'keep' ? 'keep' : 'new';
  const event = await eventRow(ctx, access, id);
  let link: BuyerLink | null = null;
  if (event?.organization_id && (str(event.billing_arrangement) || 'direct') === 'direct') {
    link = await buyerLinkOf(ctx, str(event.organization_id)).catch(() => null);
  }
  const settlementGroup = await settlementGroupOf(ctx, access, id).catch(() => null);
  if (mode === 'keep') return { event: event ? eventOut(event) : null, buyerLink: link, settlementGroup, parties: null, company: null, itemSources: null };
  const companies = await issueCompanies(ctx, access);
  let itemSources: Awaited<ReturnType<typeof itemSourcesOf>> | null = null;
  let itemSourcesError: string | null = null;
  try {
    itemSources = await itemSourcesOf(ctx, id);
  } catch (error) {
    itemSourcesError = error instanceof Error ? error.message : 'Nie udało się odczytać źródła pozycji.';
  }
  return {
    event: event ? eventOut(event) : null,
    buyerLink: link,
    settlementGroup,
    parties: event ? await eventParties(ctx, event, link) : null,
    company: eventCompany(event, companies),
    itemSources,
    itemSourcesError,
  };
}

/** Wydarzenia nabywcy (pole „Powiązane wydarzenie”); sprzedawca — tylko swoje sprzedane wydarzenia. */
export async function invoiceOrganizationEvents(ctx: NativeContext, organizationParam: unknown, keepParam: unknown) {
  const access = await issueAccess(ctx);
  const organizationId = trimmed(organizationParam);
  if (!UUID.test(organizationId)) return { events: [] };
  if (access.scope === 'sales' && !access.soldEventIds.length) return { events: [] };
  let query = ctx.supabase.from('events').select(EVENT_FIELDS).eq('organization_id', organizationId).order('event_date', { ascending: false });
  if (access.scope === 'sales') query = query.in('id', access.soldEventIds);
  const { data, error } = await query;
  if (error) fail('Nie udało się pobrać wydarzeń nabywcy.', 500);
  const events = ((data || []) as Row[]).map(eventOut);
  const keep = trimmed(keepParam);
  if (keep && !events.some((event) => event.id === keep)) {
    const preserved = await eventRow(ctx, access, keep);
    if (preserved) events.unshift(eventOut(preserved));
  }
  return { events };
}

// MARK: Numer

export async function invoiceNumberPeek(ctx: NativeContext, typeParam: unknown, companyParam: unknown) {
  const access = await issueAccess(ctx);
  const type = trimmed(typeParam) as InvoiceType;
  const companyId = trimmed(companyParam);
  if (!INVOICE_TYPES.includes(type) || !UUID.test(companyId)) fail('Wybierz firmę i typ dokumentu.');
  if (!filterFinanceCompanies(access, [{ id: companyId }], 'invoices_issue').length) fail('Brak uprawnień do wystawiania faktur tej działalności.', 403);
  const { data, error } = await ctx.supabase.rpc('peek_next_invoice_number', { p_invoice_type: type, p_my_company_id: companyId });
  if (error) fail(error.message || 'Nie udało się wygenerować numeru faktury.');
  return { number: str(data) };
}

export async function invoiceNumberCheck(ctx: NativeContext, companyParam: unknown, numberParam: unknown) {
  await issueAccess(ctx);
  const companyId = trimmed(companyParam);
  const number = trimmed(numberParam);
  if (!UUID.test(companyId) || !number) return { exists: false };
  const { data, error } = await ctx.supabase.from('invoices').select('id').eq('my_company_id', companyId).eq('invoice_number', number).maybeSingle();
  if (error) return { exists: false };
  return { exists: Boolean(data) };
}

// MARK: Kolejna zaliczka (`getNextAdvanceContext`)

async function nextAdvanceContext(ctx: NativeContext, sourceId: string) {
  const readInvoice = async (id: string) => {
    const { data, error } = await ctx.supabase.from('invoices').select('*, invoice_order_items(*)').eq('id', id).single();
    if (error || !data) fail('Nie udało się odczytać dokumentu źródłowego zaliczki.');
    return data as Row;
  };
  if (!UUID.test(sourceId)) fail('Nie udało się odczytać dokumentu źródłowego zaliczki.');
  const source = await readInvoice(sourceId);
  if (source.invoice_type !== 'advance' || ['draft', 'cancelled', 'proforma'].includes(str(source.status))) {
    fail('Kolejną zaliczkę można przygotować na podstawie wystawionej faktury zaliczkowej.');
  }
  const ancestors = [source];
  const visited = new Set<string>([str(source.id)]);
  let root = source;
  while (root.related_invoice_id) {
    if (visited.has(str(root.related_invoice_id)) || ancestors.length >= 100) fail('Nie można jednoznacznie ustalić powiązań zamówienia.');
    const parent = await readInvoice(str(root.related_invoice_id));
    if (!['advance', 'proforma'].includes(str(parent.invoice_type))) break;
    visited.add(str(parent.id));
    ancestors.push(parent);
    root = parent;
  }
  // Pozycje faktury zaliczkowej to sama zaliczka — pełne zamówienie jest w `invoice_order_items`.
  const orderSource = ancestors.find((invoice) => Array.isArray(invoice.invoice_order_items) && invoice.invoice_order_items.length > 0);
  if (!orderSource) fail('Brak zapisanych pozycji pełnego zamówienia. Uzupełnij zamówienie przed przygotowaniem kolejnej zaliczki.');
  const orderItems = [...(orderSource.invoice_order_items as Row[])]
    .sort((a, b) => num(a.position_number) - num(b.position_number))
    .map((item, index) => ({
      position_number: index + 1,
      name: item.name,
      unit: item.unit || 'szt.',
      quantity: Number(item.quantity),
      price_net: Number(item.price_net),
      vat_rate: Number(item.vat_rate),
      vat_code: item.vat_code || String(item.vat_rate),
      vat_exemption_reason: item.vat_exemption_reason || undefined,
    }));
  if (orderItems.some((item) => !item.name || !Number.isFinite(item.quantity) || item.quantity <= 0
    || !Number.isFinite(item.price_net) || item.price_net < 0 || !Number.isFinite(item.vat_rate))) {
    fail('Zapisane zamówienie zawiera niepełne pozycje. Uzupełnij je przed przygotowaniem zaliczki.');
  }
  const orderGross = money(orderItems.reduce((sum, item) => {
    const net = money(item.quantity * item.price_net);
    return sum + net + money(net * item.vat_rate / 100);
  }, 0));
  if (orderGross <= 0) fail('Pełna wartość zamówienia musi być większa od zera.');

  const chain = new Map<string, Row>([[str(root.id), root]]);
  let frontier = [str(root.id)];
  while (frontier.length > 0) {
    const { data, error } = await ctx.supabase.from('invoices')
      .select('id,invoice_type,status,related_invoice_id,my_company_id,organization_id,buyer_contact_id,buyer_name,buyer_nip,buyer_is_private_person,currency_code,total_gross')
      .in('related_invoice_id', frontier);
    if (error) fail('Nie udało się sprawdzić wcześniejszych zaliczek tego zamówienia.');
    frontier = [];
    for (const invoice of (data || []) as Row[]) {
      if (chain.has(str(invoice.id))) continue;
      chain.set(str(invoice.id), invoice);
      frontier.push(str(invoice.id));
    }
    if (chain.size > 500) fail('Zbyt wiele powiązań dokumentów. Nie można bezpiecznie ustalić salda zamówienia.');
  }
  const advances = [...chain.values()].filter((invoice) => invoice.invoice_type === 'advance' && invoice.status !== 'cancelled');
  const currency = source.currency_code || 'PLN';
  const incompatible = advances.some((invoice) => invoice.my_company_id !== source.my_company_id
    || (invoice.currency_code || 'PLN') !== currency
    || (invoice.organization_id || null) !== (source.organization_id || null)
    || Boolean(invoice.buyer_is_private_person) !== Boolean(source.buyer_is_private_person)
    || (source.buyer_is_private_person
      ? (invoice.buyer_contact_id || invoice.buyer_name) !== (source.buyer_contact_id || source.buyer_name)
      : (invoice.buyer_nip || '') !== (source.buyer_nip || '')));
  if (incompatible) fail('Powiązane zaliczki mają różne dane nabywcy, sprzedawcy lub walutę. Sprawdź powiązania zamówienia.');
  const { data: settlements, error: settlementsError } = await ctx.supabase.from('invoice_settlements')
    .select('advance_invoice_id').in('advance_invoice_id', advances.map((invoice) => str(invoice.id))).limit(1);
  if (settlementsError) fail('Nie udało się sprawdzić rozliczenia wcześniejszych zaliczek.');
  if ((settlements || []).length || [...chain.values()].some((invoice) => invoice.invoice_type === 'vat' && invoice.status !== 'cancelled')) {
    fail('To zamówienie ma już fakturę końcową. Otwórz jego powiązane dokumenty.');
  }
  const advanceIds = new Set(advances.map((invoice) => str(invoice.id)));
  const corrections = [...chain.values()].filter((invoice) => invoice.invoice_type === 'corrective'
    && advanceIds.has(str(invoice.related_invoice_id)) && !['draft', 'cancelled'].includes(str(invoice.status)));
  const reservedGross = money([...advances, ...corrections].reduce((sum, invoice) => sum + Number(invoice.total_gross || 0), 0));
  if (!Number.isFinite(reservedGross) || reservedGross < 0) fail('Nie można ustalić salda wcześniejszych zaliczek.');
  return { source, orderItems, orderGross, reservedGross, remainingGross: money(Math.max(0, orderGross - reservedGross)) };
}
type AdvanceContext = Awaited<ReturnType<typeof nextAdvanceContext>>;

const splitName = (value: unknown) => {
  const [firstName = '', ...lastName] = str(value).split(' ');
  return { firstName, lastName: lastName.join(' ') };
};
const privateFromInvoice = (invoice: Row) => ({
  ...splitName(invoice.buyer_name), street: str(invoice.buyer_street), postalCode: str(invoice.buyer_postal_code), city: str(invoice.buyer_city),
  email: str(invoice.buyer_email), phone: str(invoice.buyer_phone),
});
const buyerFromInvoice = (invoice: Row) => ({
  organizationId: str(invoice.organization_id), name: str(invoice.buyer_name), nip: str(invoice.buyer_nip), street: str(invoice.buyer_street),
  postalCode: str(invoice.buyer_postal_code), city: str(invoice.buyer_city), country: str(invoice.buyer_country) || 'PL',
  email: str(invoice.buyer_email), phone: str(invoice.buyer_phone), privatePerson: invoice.buyer_is_private_person === true,
});

/** Kontekst kolejnej zaliczki dla formularza; błąd — tekst w polu `error` (formularz pokazuje go zamiast danych). */
async function advancePrefill(ctx: NativeContext, companies: Row[], sourceId: string) {
  try {
    const context = await nextAdvanceContext(ctx, sourceId);
    const source = context.source;
    if (!companies.some((company) => company.id === str(source.my_company_id))) {
      fail('Brak uprawnień do przygotowania kolejnej zaliczki dla firmy z dokumentu źródłowego.');
    }
    if (context.remainingGross <= 0) fail('Zaliczki obejmują już pełną wartość zamówienia. Możesz przygotować fakturę końcową.');
    let recipient: InvoiceRecipientDraft | null = null;
    let recipientError: string | null = null;
    try { recipient = recipientDraftFromInvoice(source); } catch (error) {
      recipientError = error instanceof Error ? error.message : 'Nie można odczytać zapisanych danych odbiorcy.';
    }
    return {
      error: null,
      sourceId: str(source.id), sourceNumber: str(source.invoice_number), currency: str(source.currency_code) || 'PLN',
      reservedGross: context.reservedGross, remainingGross: context.remainingGross, orderGross: context.orderGross,
      orderItems: context.orderItems.map(itemOut), orderToken: JSON.stringify(context.orderItems),
      companyId: str(source.my_company_id), eventId: str(source.event_id),
      billingArrangement: ARRANGEMENTS.includes(str(source.billing_arrangement)) ? str(source.billing_arrangement) : 'direct',
      serviceRecipientOrganizationId: str(source.service_recipient_organization_id), serviceRecipientContactId: str(source.service_recipient_contact_id),
      recipient, recipientError, buyer: buyerFromInvoice(source), privateBuyer: privateFromInvoice(source),
      individualId: str(source.buyer_contact_id), saleDate: day(source.sale_date) || null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Nie udało się przygotować kolejnej zaliczki.' };
  }
}

// MARK: Dane formularza

/** Dane do formularza: działalności, sposób płatności, nabywcy, osoby prywatne, faktury do korekty, kolejna zaliczka. */
export async function invoiceFormSetup(ctx: NativeContext, params: URLSearchParams) {
  const access = await issueAccess(ctx);
  const advanceFrom = trimmed(params.get('advanceFrom'));
  let invoiceQuery = ctx.supabase.from('invoices')
    .select('id, invoice_number, invoice_type, issue_date, total_gross, buyer_name, status, my_company_id')
    .neq('invoice_type', 'corrective').in('status', ['issued', 'sent', 'paid']).order('issue_date', { ascending: false });
  if (access.scope === 'sales') invoiceQuery = invoiceQuery.in('created_by', [access.employeeId, access.authUserId]);
  const [settingsRes, companies, clientsRes, invoicesRes, individualsRes] = await Promise.all([
    ctx.supabase.rpc('get_invoice_settings_for_creation'),
    issueCompanies(ctx, access),
    businessClients(ctx).then((list) => ({ list, error: null as string | null }))
      .catch(() => ({ list: [] as BusinessClient[], error: 'Nie udało się pobrać organizacji z CRM. Spróbuj ponownie lub wpisz dane ręcznie.' })),
    invoiceQuery,
    ctx.supabase.from('contacts').select('id, first_name, last_name, full_name, email, phone, mobile, address, street, postal_code, city')
      .eq('contact_type', 'individual').order('last_name', { ascending: true }),
  ]);
  if (settingsRes.error) fail('Brak uprawnień do tworzenia faktur. Wymagane: invoices_manage lub finances_manage', 403);
  const settings = (Array.isArray(settingsRes.data) ? settingsRes.data[0] : null) as Row | null;
  const method = str(settings?.default_payment_method);
  return {
    scope: access.scope,
    companies: companies.map(companyOut),
    defaultCompanyId: str((companies.find((company: Row) => company.is_default === true) || companies[0])?.id),
    paymentMethod: PAYMENT_METHODS.includes(method) ? method : 'Przelew',
    organizations: clientsRes.list,
    organizationsError: clientsRes.error,
    individuals: ((individualsRes.data || []) as Row[]).map((contact) => ({
      id: str(contact.id), firstName: str(contact.first_name), lastName: str(contact.last_name),
      name: str(contact.full_name) || `${str(contact.first_name)} ${str(contact.last_name)}`.trim(),
      email: str(contact.email), phone: str(contact.phone) || str(contact.mobile), street: str(contact.street) || str(contact.address),
      postalCode: str(contact.postal_code), city: str(contact.city),
    })),
    correctable: ((invoicesRes.data || []) as Row[]).map((invoice) => ({
      id: str(invoice.id), number: str(invoice.invoice_number), type: str(invoice.invoice_type), issueDate: day(invoice.issue_date) || null,
      gross: num(invoice.total_gross), buyerName: str(invoice.buyer_name), companyId: str(invoice.my_company_id),
    })),
    advance: advanceFrom ? await advancePrefill(ctx, companies, advanceFrom) : null,
  };
}

// MARK: Faktura korygowana

const normalizeNip = (value: unknown) => trimmed(value).replace(/^PL/i, '').replace(/[\s-]/g, '');
const normalizeCountry = (value: unknown) => {
  const country = (trimmed(value) || 'PL').toUpperCase();
  return ['POLSKA', 'POLAND'].includes(country) ? 'PL' : country;
};
type CorrectedBuyer = { source: 'organization' | 'manual'; organizationId: string; name: string; nip: string; street: string; postalCode: string; city: string; countryCode: string };
const correctedBuyerFromInvoice = (invoice: Row): CorrectedBuyer => ({
  source: invoice.organization_id ? 'organization' : 'manual', organizationId: str(invoice.organization_id),
  name: str(invoice.buyer_name), nip: normalizeNip(invoice.buyer_nip), street: str(invoice.buyer_street),
  postalCode: str(invoice.buyer_postal_code), city: str(invoice.buyer_city), countryCode: normalizeCountry(invoice.buyer_country),
});

async function originalInvoiceRow(ctx: NativeContext, access: InvoiceFinanceAccess, id: string) {
  if (!UUID.test(id)) return null;
  let query = ctx.supabase.from('invoices').select('*, invoice_items(*)').eq('id', id);
  if (access.scope === 'sales') query = query.in('created_by', [access.employeeId, access.authUserId]);
  const { data } = await query.maybeSingle();
  return (data as Row | null) || null;
}

async function originalKsefNumber(ctx: NativeContext, invoice: Row) {
  const { data } = await ctx.supabase.from('ksef_invoices').select('ksef_reference_number').eq('invoice_id', invoice.id).eq('sync_status', 'synced').maybeSingle();
  return str((data as Row | null)?.ksef_reference_number) || str(invoice.ksef_reference_number);
}

/** Pozycje faktury pierwotnej jako „przed korektą” (wartości zapisane, a gdy ich brak — wyliczone jak w CRM). */
function correctionItems(invoice: Row) {
  return [...((invoice.invoice_items || []) as Row[])]
    .sort((a, b) => num(a.position_number) - num(b.position_number))
    .map((item) => {
      const quantity = Number(item.quantity ?? 0);
      const priceNet = Number(item.price_net ?? 0);
      const net = Number(item.value_net ?? quantity * priceNet);
      const vat = Number(item.vat_amount ?? Math.round(net * Number(item.vat_rate ?? 0)) / 100);
      const gross = Number(item.value_gross ?? net + vat);
      return {
        position: num(item.position_number), name: str(item.name), unit: str(item.unit), vatRate: num(item.vat_rate),
        vatCode: str(item.vat_code) || String(item.vat_rate || 23), exemption: str(item.vat_exemption_reason),
        beforeQuantity: quantity, beforePriceNet: priceNet, beforeNet: net, beforeVat: vat, beforeGross: gross,
      };
    });
}

/** Faktura do korekty: dane stron, numer KSeF, pozycje „przed”, odbiorca zapisany w dokumencie. */
export async function invoiceOriginal(ctx: NativeContext, idParam: unknown) {
  const access = await issueAccess(ctx);
  const invoice = await originalInvoiceRow(ctx, access, trimmed(idParam));
  if (!invoice) fail('Nie udało się odczytać faktury korygowanej. Nie podstawiono danych z innego źródła.', 404);
  let recipient: InvoiceRecipientDraft | null = null;
  let recipientError: string | null = null;
  try { recipient = recipientDraftFromInvoice(invoice); } catch (error) {
    recipientError = error instanceof Error ? error.message : 'Nie można odczytać zapisanych danych odbiorcy faktury korygowanej.';
  }
  const ksefNumber = await originalKsefNumber(ctx, invoice);
  const eventId = str(invoice.event_id);
  const event = eventId ? await eventRow(ctx, access, eventId) : null;
  return {
    id: str(invoice.id), number: str(invoice.invoice_number), type: str(invoice.invoice_type), status: str(invoice.status),
    proforma: invoice.is_proforma === true, issueDate: day(invoice.issue_date) || null, saleDate: day(invoice.sale_date) || null,
    companyId: str(invoice.my_company_id), eventId, event: event ? eventOut(event) : null,
    billingArrangement: ARRANGEMENTS.includes(str(invoice.billing_arrangement)) ? str(invoice.billing_arrangement) : 'direct',
    serviceRecipientOrganizationId: str(invoice.service_recipient_organization_id), serviceRecipientContactId: str(invoice.service_recipient_contact_id),
    currency: str(invoice.currency_code) || 'PLN', buyer: buyerFromInvoice(invoice), privateBuyer: privateFromInvoice(invoice),
    correctedBuyer: correctedBuyerFromInvoice(invoice), recipient, recipientError,
    ksefNumber: ksefNumber || null, wasInKsef: Boolean(ksefNumber),
    totals: { net: num(invoice.total_net), vat: num(invoice.total_vat), gross: num(invoice.total_gross) },
    items: correctionItems(invoice),
  };
}

// MARK: Wyliczenia (jak formularz CRM)

type FormItem = {
  position_number: number; name: string; unit: string; quantity: number; price_net: number; vat_rate: number; vat_code: string;
  vat_exemption_reason?: string;
};
const itemValues = (item: FormItem) => {
  const valueNet = Number((Number(item.quantity ?? 0) * Number(item.price_net ?? 0)).toFixed(2));
  const vatAmount = Number((Math.round(valueNet * Number(item.vat_rate ?? 0)) / 100).toFixed(2));
  return { valueNet, vatAmount, valueGross: Number((valueNet + vatAmount).toFixed(2)) };
};
const totalsOf = (items: FormItem[]) => items.reduce((sum, item) => {
  const values = itemValues(item);
  return { totalNet: sum.totalNet + values.valueNet, totalVat: sum.totalVat + values.vatAmount, totalGross: sum.totalGross + values.valueGross };
}, { totalNet: 0, totalVat: 0, totalGross: 0 });
function combinedItemsError(items: FormItem[]) {
  if (!items.length) return 'Dodaj przynajmniej jedną pozycję stanowiącą podstawę kwoty.';
  if (new Set(items.map((item) => `${item.vat_code}|${item.vat_rate}|${item.vat_exemption_reason || ''}`)).size > 1) {
    return 'Jedna pozycja zbiorcza nie może łączyć różnych stawek lub podstaw VAT. Zachowaj pozycje szczegółowe.';
  }
  const source = totalsOf(items);
  const combinedVat = round2(round2(source.totalNet) * Number(items[0].vat_rate) / 100);
  if (Math.abs(combinedVat - round2(source.totalVat)) > 0.001) {
    return 'Scalenie zmieniłoby VAT przez zaokrąglenia. Zachowaj pozycje szczegółowe, aby nie zmienić uzgodnionej kwoty.';
  }
  return null;
}
const percentItems = (items: FormItem[], percent: number) => items.map((item) => ({ ...item, price_net: round2(Number(item.price_net) * percent / 100) }));

function formItems(value: unknown): FormItem[] {
  return (Array.isArray(value) ? value : []).slice(0, 500).map((raw, index) => {
    const item = object(raw);
    const code = str(item.vatCode);
    return {
      position_number: index + 1,
      name: str(item.name).slice(0, 1000),
      unit: (trimmed(item.unit) || 'szt.').slice(0, 30),
      quantity: Number(item.quantity),
      price_net: Number(item.priceNet),
      vat_rate: rateOf(code),
      vat_code: code,
      vat_exemption_reason: str(item.exemption) || undefined,
    };
  });
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

const NOT_NULL_FIELDS: Record<string, string> = {
  seller_street: 'adres sprzedawcy', seller_city: 'miasto sprzedawcy', seller_postal_code: 'kod pocztowy sprzedawcy', seller_nip: 'NIP sprzedawcy',
  seller_name: 'nazwa sprzedawcy', seller_email: 'email sprzedawcy', seller_phone: 'telefon sprzedawcy', buyer_nip: 'NIP nabywcy',
  buyer_name: 'nazwa nabywcy', buyer_street: 'adres nabywcy', buyer_city: 'miasto nabywcy', invoice_number: 'numer faktury',
  bank_name: 'nazwa banku sprzedawcy', bank_account: 'numer konta bankowego sprzedawcy',
};

// MARK: Zapis

/** Wystawienie dokumentu (`handleSubmit` z `/crm/invoices/new`): te same sprawdzenia i ten sam zapis. */
export async function invoiceCreate(ctx: NativeContext, body: Row) {
  const access = await issueAccess(ctx);
  const form = object(body.form);
  const type = str(form.type) as InvoiceType;
  if (!INVOICE_TYPES.includes(type)) fail('Wybierz typ faktury.');
  const advanceFrom = type === 'advance' ? trimmed(form.advanceFrom) : '';
  const correction = object(form.correction);
  const correctionKind = type === 'corrective' && correction.kind === 'party_data' ? 'party_data' : 'amount';
  const isPartyDataCorrection = type === 'corrective' && correctionKind === 'party_data';

  const issueDate = day(form.issueDate);
  const saleDate = day(form.saleDate);
  const paymentDays = trimmed(form.paymentDays);
  const isPaid = !isPartyDataCorrection && form.isPaid === true;
  const paidDate = day(form.paidDate);
  const paymentMethod = PAYMENT_METHODS.includes(str(form.paymentMethod)) ? str(form.paymentMethod) : 'Przelew';
  const dueDate = getInvoicePaymentDueDate(issueDate, paymentDays) || '';
  if (!DAY.test(saleDate)) fail('Podaj datę sprzedaży.');
  if (isPaid && !DAY.test(paidDate)) fail('Podaj datę opłacenia.');

  // Dokumenty źródłowe z bazy: kolejna zaliczka, faktura korygowana.
  const companies = await issueCompanies(ctx, access);
  let advance: AdvanceContext | null = null;
  if (advanceFrom) {
    advance = await nextAdvanceContext(ctx, advanceFrom);
    if (!companies.some((company) => company.id === str(advance!.source.my_company_id))) {
      fail('Brak uprawnień do przygotowania kolejnej zaliczki dla firmy z dokumentu źródłowego.');
    }
  }
  const original = type === 'corrective' ? await originalInvoiceRow(ctx, access, trimmed(correction.relatedId)) : null;
  const sourceBuyer = type === 'corrective' ? original : advance?.source ?? null;

  // Wydarzenie i strony rozliczenia.
  const selectedEventId = type === 'corrective' ? str(original?.event_id) : advance ? str(advance.source.event_id) : trimmed(form.eventId);
  if (!canUseEvent(access, selectedEventId)) fail('Nie masz uprawnień do wystawienia faktury dla tego wydarzenia.', 403);
  if ((!isPartyDataCorrection && !isPaid && !dueDate) || (isPartyDataCorrection && !getInvoicePaymentDueDate(issueDate, '0'))) {
    fail('Podaj poprawną datę wystawienia i termin płatności w pełnych dniach (0 lub więcej).');
  }
  const companyId = original ? str(original.my_company_id) : advance ? str(advance.source.my_company_id) : trimmed(form.companyId);
  if (!companyId) fail('Wybierz firmę wystawiającą fakturę');
  const event = selectedEventId ? await eventRow(ctx, access, selectedEventId) : null;
  const sourceDocument = original ?? advance?.source ?? null;
  const billingArrangement = sourceDocument
    ? (ARRANGEMENTS.includes(str(sourceDocument.billing_arrangement)) ? str(sourceDocument.billing_arrangement) : 'direct')
    : (ARRANGEMENTS.includes(str(form.billingArrangement)) ? str(form.billingArrangement) : 'direct');
  const serviceRecipientOrganizationId = sourceDocument ? str(sourceDocument.service_recipient_organization_id) : str(event?.organization_id);
  const serviceRecipientContactId = sourceDocument ? str(sourceDocument.service_recipient_contact_id) : str(event?.contact_person_id);
  const settlementGroup = selectedEventId ? await settlementGroupOf(ctx, access, selectedEventId).catch(() => null) : null;

  // Nabywca.
  const buyerIsPrivatePerson = isPartyDataCorrection ? false : sourceBuyer ? sourceBuyer.buyer_is_private_person === true : form.private === true;
  const formPrivate = object(form.privateBuyer);
  const privateBuyer = sourceBuyer ? privateFromInvoice(sourceBuyer) : {
    firstName: str(formPrivate.firstName), lastName: str(formPrivate.lastName), street: str(formPrivate.street),
    postalCode: str(formPrivate.postalCode), city: str(formPrivate.city), email: str(formPrivate.email), phone: str(formPrivate.phone),
  };
  const correctedRaw = object(correction.buyer);
  const correctedBuyer: CorrectedBuyer = {
    source: correctedRaw.source === 'organization' ? 'organization' : 'manual', organizationId: str(correctedRaw.organizationId),
    name: str(correctedRaw.name), nip: str(correctedRaw.nip), street: str(correctedRaw.street), postalCode: str(correctedRaw.postalCode),
    city: str(correctedRaw.city), countryCode: str(correctedRaw.countryCode),
  };
  const selectedOrgId = buyerIsPrivatePerson ? '' : isPartyDataCorrection ? correctedBuyer.organizationId
    : sourceBuyer ? str(sourceBuyer.organization_id) : trimmed(form.organizationId);

  // Nabywca zapisany w rozliczeniu wydarzenia (zwykła faktura) — inny wymaga potwierdzenia.
  if (type !== 'corrective' && !sourceBuyer && event) {
    let link: BuyerLink | null = null;
    if (event.organization_id && (str(event.billing_arrangement) || 'direct') === 'direct') link = await buyerLinkOf(ctx, str(event.organization_id)).catch(() => null);
    const expected = event.billing_arrangement && event.billing_arrangement !== 'direct'
      ? str(event.billing_organization_id) : link?.buyer.id || str(event.organization_id);
    if (expected && (buyerIsPrivatePerson || (selectedOrgId && selectedOrgId !== expected)) && form.buyerOverrideConfirmed !== true) {
      fail('Wybrany nabywca różni się od nabywcy przypisanego do rozliczenia wydarzenia. Sprawdź obie strony i potwierdź zmianę w formularzu.');
    }
  }

  // Odbiorca: korekta kwot — zapisany w dokumencie; pozostałe — z formularza.
  let recipientDraft = draftOf(form.recipient);
  let originalRecipient: InvoiceRecipientDraft | null = null;
  let recipientPrefillError: string | null = null;
  if (original) {
    try { originalRecipient = recipientDraftFromInvoice(original); } catch (error) {
      recipientPrefillError = error instanceof Error ? error.message : 'Nie można odczytać zapisanych danych odbiorcy faktury korygowanej.';
    }
    if (!isPartyDataCorrection) {
      if (recipientPrefillError) fail(recipientPrefillError);
      recipientDraft = originalRecipient!;
    }
  }

  if (isPartyDataCorrection) {
    if (!original || original.is_proforma === true || !['vat', 'advance', 'final'].includes(str(original.invoice_type))
      || ['draft', 'cancelled', 'proforma'].includes(str(original.status)) || original.buyer_is_private_person === true) {
      fail('Korektę danych można przygotować do wystawionej faktury VAT, zaliczkowej lub końcowej z polskim NIP nabywcy.');
    }
    const originalNip = normalizeNip(original.buyer_nip);
    const nipChecksum = [6, 5, 7, 2, 3, 4, 5, 6, 7].reduce((sum, weight, index) => sum + Number(originalNip[index]) * weight, 0) % 11;
    if (!/^\d{10}$/.test(originalNip) || nipChecksum !== Number(originalNip[9]) || normalizeNip(correctedBuyer.nip) !== originalNip) {
      fail('Korekta danych nie może zmieniać podatnika. Wymagany jest ten sam poprawny polski NIP co na fakturze pierwotnej.');
    }
    if (correctedBuyer.source === 'organization' && !correctedBuyer.organizationId) {
      fail('Wybierz organizację nabywcy z tym samym NIP lub przełącz na dane wpisane ręcznie.');
    }
    if (![correctedBuyer.name, correctedBuyer.street, correctedBuyer.postalCode, correctedBuyer.city].every((part) => part.trim())
      || !/^[A-Z]{2}$/.test(correctedBuyer.countryCode)) {
      fail('Uzupełnij pełną nazwę i adres nabywcy po korekcie oraz dwuliterowy kod kraju.');
    }
    if (!originalRecipient || validateInvoiceRecipientDraft(originalRecipient).length) {
      fail('Brakuje wiarygodnych zapisanych danych odbiorcy sprzed korekty. Nie pobieramy ich automatycznie z obecnej karty organizacji.');
    }
    const comparableBuyer = (buyer: CorrectedBuyer) => JSON.stringify([
      buyer.name.trim(), normalizeNip(buyer.nip), buyer.street.trim(), buyer.postalCode.trim(), buyer.city.trim(), buyer.countryCode.trim(),
    ]);
    const comparableRecipient = (recipient: InvoiceRecipientDraft) => recipient.mode === 'same_as_buyer' ? 'null' : JSON.stringify([
      recipient.data.name.trim(), normalizeNip(recipient.data.nip), recipient.data.internalId.trim(), recipient.data.street.trim(),
      recipient.data.postalCode.trim(), recipient.data.city.trim(), recipient.data.countryCode.trim(),
    ]);
    if (comparableBuyer(correctedBuyer) === comparableBuyer(correctedBuyerFromInvoice(original))
      && comparableRecipient(recipientDraft) === comparableRecipient(originalRecipient)) {
      fail('Nie zmieniono danych nabywcy ani odbiorcy. Wprowadź poprawne dane po korekcie.');
    }
    if (correction.confirmed !== true) fail('Sprawdź tabelę danych przed i po korekcie oraz potwierdź poprawność zmian.');
  }

  const recipientErrors = validateInvoiceRecipientDraft(recipientDraft);
  if (recipientErrors.length) fail(recipientErrors.join(' '));
  if (selectedEventId && billingArrangement !== 'direct' && buyerIsPrivatePerson) fail('Hotel lub pośrednik musi być wybrany jako organizacja.');
  if (buyerIsPrivatePerson && !advance) {
    if (![privateBuyer.firstName, privateBuyer.lastName, privateBuyer.street, privateBuyer.postalCode, privateBuyer.city].every((part) => part.trim())) {
      fail('Uzupełnij dane osoby prywatnej: imię, nazwisko, adres, kod pocztowy i miasto.');
    }
  } else if (!buyerIsPrivatePerson && !selectedOrgId && !advance && !isPartyDataCorrection) {
    fail('Wybierz nabywcę');
  }
  if (!isPartyDataCorrection && selectedEventId && billingArrangement !== 'direct' && selectedOrgId === serviceRecipientOrganizationId) {
    fail('Wybierz hotel lub inną organizację, która będzie nabywcą faktury.');
  }
  const invoiceNumber = trimmed(form.number);
  const autoNumber = form.autoNumber === true;
  if (!invoiceNumber) fail('Numer faktury jest wymagany');

  // Pozycje.
  const correctionReason = str(correction.reason);
  let items: FormItem[] = [];
  let correctionLines: Array<ReturnType<typeof correctionItems>[number] & { afterQuantity: number; afterPriceNet: number }> = [];
  if (type === 'corrective') {
    if (!original || !trimmed(correction.relatedId)) fail('Wybierz fakturę do korekty');
    if (!correctionReason.trim()) fail('Podaj przyczynę korekty');
    if (!isPartyDataCorrection) {
      const after = new Map<number, Row>(((Array.isArray(correction.items) ? correction.items : []) as unknown[]).map((raw) => {
        const row = object(raw);
        return [num(row.position), row] as [number, Row];
      }));
      correctionLines = correctionItems(original).map((line) => {
        const edit = after.get(line.position);
        const quantity = edit ? Number(edit.quantity) : line.beforeQuantity;
        const price = edit ? Number(edit.priceNet) : line.beforePriceNet;
        return { ...line, afterQuantity: Number.isFinite(quantity) ? quantity : line.beforeQuantity, afterPriceNet: Number.isFinite(price) ? price : line.beforePriceNet };
      });
      if (!correctionLines.length) fail('Faktura korygowana nie ma pozycji.');
      if (correctionLines.some((line) => !line.name.trim())) fail('Wypełnij nazwy wszystkich pozycji faktury');
      if (correctionLines.some((line) => line.vatCode === 'zw' && !line.exemption.trim())) fail('Podaj podstawę prawną dla każdej pozycji zwolnionej z VAT.');
      if (correctionLines.some((line) => line.vatCode === '0' || line.vatCode === 'np')) {
        fail('Dla 0% wybierz rodzaj transakcji (krajowa, WDT lub eksport), a dla „np.” wybierz np I albo np II.');
      }
    }
  } else {
    items = advance ? advance.orderItems.map((item) => ({ ...item, vat_code: str(item.vat_code) })) : formItems(form.items);
    if (!advance && items.some((item) => !VAT_CODES.includes(item.vat_code))) fail('Wybierz stawkę VAT dla każdej pozycji.');
    const simplified = !advance && form.simplified === true;
    if (!items.length || items.some((item) => (!simplified && !item.name.trim()) || !Number.isFinite(Number(item.quantity))
      || Number(item.quantity) <= 0 || !Number.isFinite(Number(item.price_net)) || Number(item.price_net) < 0)) {
      fail('Wypełnij wszystkie pozycje faktury');
    }
    if (items.some((item) => item.vat_code === 'zw' && !item.vat_exemption_reason?.trim())) fail('Podaj podstawę prawną dla każdej pozycji zwolnionej z VAT.');
    if (items.some((item) => item.vat_code === '0' || item.vat_code === 'np')) {
      fail('Dla 0% wybierz rodzaj transakcji (krajowa, WDT lub eksport), a dla „np.” wybierz np I albo np II.');
    }
    const simplifiedName = str(form.simplifiedName);
    if (simplified && (!simplifiedName.trim() || combinedItemsError(items))) fail(combinedItemsError(items) || 'Wpisz własną nazwę pozycji zbiorczej.');
    if (simplified) {
      // Jedna pozycja zbiorcza z sumą netto (stawka i podstawa VAT z pozycji źródłowych).
      const totalNet = items.reduce((sum, item) => sum + itemValues(item).valueNet, 0);
      items = [{
        position_number: 1, name: simplifiedName, unit: 'usł.', quantity: 1, price_net: Math.round(totalNet * 100) / 100,
        vat_rate: items[0]?.vat_rate ?? 23, vat_code: items[0]?.vat_code ?? '23', vat_exemption_reason: items[0]?.vat_exemption_reason,
      }];
    }
  }
  const proformaPercent = Number(form.proformaPercent);
  const advancePercent = Number(form.advancePercent);
  if (type === 'proforma' && (!Number.isFinite(proformaPercent) || proformaPercent <= 0 || proformaPercent > 100)) {
    fail('Wysokość proformy musi być większa od 0% i nie może przekraczać 100%.');
  }
  if (type === 'advance' && (!Number.isFinite(advancePercent) || advancePercent <= 0 || advancePercent > 100)) {
    fail('Zaliczka musi być większa od 0% i nie może przekraczać 100%.');
  }

  if (!autoNumber) {
    const { data: existing, error: existingError } = await ctx.supabase.from('invoices').select('id')
      .eq('my_company_id', companyId).eq('invoice_number', invoiceNumber).maybeSingle();
    if (existingError) fail(existingError.message || 'Nie udało się sprawdzić numeru faktury.');
    if (existing) fail('Ten numer faktury jest już użyty dla wybranej działalności.');
  }

  // Nabywca organizacja: korekta danych — dane po korekcie; dokument źródłowy — jego dane; zwykła — organizacja z CRM.
  let selectedOrg: { name: string; nip: string; street: string; postalCode: string; city: string; country: string; email: string; phone: string } | null = null;
  if (!buyerIsPrivatePerson) {
    if (isPartyDataCorrection) {
      selectedOrg = { name: correctedBuyer.name, nip: correctedBuyer.nip, street: correctedBuyer.street, postalCode: correctedBuyer.postalCode,
        city: correctedBuyer.city, country: correctedBuyer.countryCode, email: str(original?.buyer_email), phone: str(original?.buyer_phone) };
    } else if (sourceBuyer) {
      const buyer = buyerFromInvoice(sourceBuyer);
      selectedOrg = { name: buyer.name, nip: buyer.nip, street: buyer.street, postalCode: buyer.postalCode, city: buyer.city, country: buyer.country, email: buyer.email, phone: buyer.phone };
    } else {
      const clients = await businessClients(ctx).catch(() => [] as BusinessClient[]);
      const client = clients.find((candidate) => candidate.id === selectedOrgId);
      if (client) selectedOrg = { name: client.name, nip: client.nip, street: client.street, postalCode: client.postalCode, city: client.city, country: client.country, email: client.email, phone: client.phone };
    }
    if (!selectedOrg && !advance) fail('Nie udało się odczytać wybranego nabywcy. Wybierz go ponownie.');
    if (selectedOrg && (!selectedOrg.name.trim() || !selectedOrg.street.trim() || !selectedOrg.postalCode.trim() || !selectedOrg.city.trim())) {
      fail('Uzupełnij pełną nazwę i adres nabywcy: ulicę, kod pocztowy oraz miejscowość.');
    }
  }

  const company = companies.find((candidate) => candidate.id === companyId);
  if (!company) fail('Wybierz firmę wystawiającą fakturę');
  const signatureName = `${trimmed(ctx.employee.name)} ${trimmed(ctx.employee.surname)}`;
  if (!trimmed(ctx.employee.name) || !trimmed(ctx.employee.surname)) {
    fail('Uzupełnij imię i nazwisko w swoim profilu pracownika. Te dane są wymagane jako podpis osoby upoważnionej do wystawienia faktury.');
  }
  const missingSellerFields = SELLER_REQUIRED.filter(([key]) => !company[key]).map(([, label]) => label);
  if (missingSellerFields.length) {
    fail(`Uzupełnij dane firmy wystawiającej: ${missingSellerFields.join(', ')}. Przejdź do Ustawienia > Moje firmy.`);
  }
  if (!buyerIsPrivatePerson && !(str(advance?.source.buyer_nip) || selectedOrg?.nip)) {
    fail('Nabywca nie ma uzupełnionego NIP. Uzupełnij dane kontrahenta albo zaznacz fakturę dla osoby prywatnej.');
  }

  const orderItems = isPartyDataCorrection ? [] : items;
  const documentItems = type === 'advance' ? percentItems(orderItems, advancePercent)
    : type === 'proforma' ? percentItems(orderItems, proformaPercent) : orderItems;
  const orderTotals = totalsOf(orderItems);
  // Korekta: różnica „po” minus „przed” (jak `calculateItemValues` dla korekty).
  const documentTotals = type === 'corrective'
    ? correctionLines.reduce((sum, line) => {
      const afterNet = Number((line.afterQuantity * line.afterPriceNet).toFixed(2));
      const afterVat = Number((Math.round(afterNet * line.vatRate) / 100).toFixed(2));
      const afterGross = Number((afterNet + afterVat).toFixed(2));
      return {
        totalNet: sum.totalNet + Number((afterNet - line.beforeNet).toFixed(2)),
        totalVat: sum.totalVat + Number((afterVat - line.beforeVat).toFixed(2)),
        totalGross: sum.totalGross + Number((afterGross - line.beforeGross).toFixed(2)),
      };
    }, { totalNet: 0, totalVat: 0, totalGross: 0 })
    : totalsOf(documentItems);

  if (advance) {
    const fresh = await nextAdvanceContext(ctx, advanceFrom);
    const gross = documentTotals?.totalGross ?? 0;
    const currencyLabel = (str(advance.source.currency_code) || 'PLN') === 'PLN' ? 'zł' : str(advance.source.currency_code);
    if (gross <= 0 || gross > fresh.remainingGross + 0.001) {
      fail(`Kwota nowej zaliczki przekracza dostępne saldo zamówienia: ${fresh.remainingGross.toFixed(2)} ${currencyLabel}. Wcześniejsze zaliczki i ich szkice są już uwzględnione.`);
    }
    if (JSON.stringify(fresh.orderItems) !== str(form.advanceToken)) {
      fail('Zamówienie źródłowe zmieniło się. Odśwież formularz przed przygotowaniem kolejnej zaliczki.');
    }
  }

  const invoiceEventId = isPartyDataCorrection ? str(original?.event_id) || null : settlementGroup?.primaryEventId || selectedEventId || null;
  const currencyCode = str(advance?.source.currency_code) || (type === 'corrective' ? str(original?.currency_code) : '') || 'PLN';
  let footerNote: string | null;
  if (type === 'corrective') {
    const issued = str(original?.issue_date);
    footerNote = `Faktura korygująca odnosi się do faktury ${str(original?.invoice_number) || '-'} z dnia ${issued ? plDate(issued) : 'brak daty'}. Przyczyna korekty: ${correctionReason || '-'}.`;
  } else {
    footerNote = form.includeNote === true ? (trimmed(form.note) || null) : null;
  }
  const sellerStreet = [company.street, company.building_number, company.apartment_number ? `/${company.apartment_number}` : ''].filter(Boolean).join(' ').trim();
  const correctedNumber = str(original?.invoice_number);
  const correctedKsef = original ? await originalKsefNumber(ctx, original) : '';

  const invoiceData: Row = {
    buyer_is_private_person: buyerIsPrivatePerson,
    invoice_number: invoiceNumber,
    auto_number: autoNumber,
    invoice_type: type,
    is_proforma: type === 'proforma',
    status: !isPartyDataCorrection && isPaid ? 'paid' : type === 'proforma' ? 'proforma' : 'draft',
    paid_at: !isPartyDataCorrection && isPaid ? paidDate : null,
    payment_status: isPartyDataCorrection ? 'not_applicable' : isPaid ? 'paid' : 'unpaid',
    paid_amount: !isPartyDataCorrection && isPaid ? documentTotals?.totalGross ?? 0 : 0,
    payment_due_date: isPartyDataCorrection ? null : isPaid ? paidDate : dueDate,
    currency_code: currencyCode,
    order_total_net: type === 'advance' ? orderTotals.totalNet : null,
    order_total_vat: type === 'advance' ? orderTotals.totalVat : null,
    order_total_gross: type === 'advance' ? orderTotals.totalGross : null,
    footer_note: footerNote,
    signature_name: signatureName,
    website: trimmed(company.website) || null,
    issue_date: issueDate,
    sale_date: saleDate,
    event_id: invoiceEventId,
    organization_id: buyerIsPrivatePerson ? null : isPartyDataCorrection
      ? correctedBuyer.source === 'organization' ? correctedBuyer.organizationId : null : selectedOrgId || null,
    billing_arrangement: selectedEventId ? billingArrangement : 'direct',
    ...invoiceRecipientPayload(recipientDraft),
    service_recipient_contact_id: selectedEventId && recipientDraft.mode === 'organization'
      && recipientDraft.organizationId === serviceRecipientOrganizationId ? serviceRecipientContactId || null : null,
    buyer_name: buyerIsPrivatePerson ? `${privateBuyer.firstName} ${privateBuyer.lastName}`.trim() : selectedOrg?.name ?? '',
    buyer_nip: buyerIsPrivatePerson ? null : selectedOrg?.nip || null,
    buyer_street: buyerIsPrivatePerson ? privateBuyer.street : selectedOrg?.street || '',
    buyer_postal_code: buyerIsPrivatePerson ? privateBuyer.postalCode : selectedOrg?.postalCode || '',
    buyer_city: buyerIsPrivatePerson ? privateBuyer.city : selectedOrg?.city || '',
    buyer_country: isPartyDataCorrection ? correctedBuyer.countryCode : str(sourceBuyer?.buyer_country) || selectedOrg?.country || 'PL',
    buyer_email: buyerIsPrivatePerson ? privateBuyer.email || null : selectedOrg?.email || null,
    buyer_phone: buyerIsPrivatePerson ? privateBuyer.phone || null : selectedOrg?.phone || null,
    buyer_contact_id: buyerIsPrivatePerson ? (advance ? str(advance.source.buyer_contact_id) : sourceBuyer ? '' : trimmed(form.individualId)) || null : null,
    my_company_id: companyId,
    seller_name: company.legal_name,
    seller_nip: company.nip,
    seller_street: sellerStreet,
    seller_postal_code: company.postal_code,
    seller_city: company.city,
    seller_email: company.email,
    seller_phone: company.phone,
    seller_country: 'Polska',
    payment_method: isPartyDataCorrection ? null : paymentMethod,
    bank_name: company.bank_name || '',
    bank_account: company.bank_account || '',
    bank_swift_code: company.bank_swift_code || null,
    issue_place: company.city,
    company_logo_url: company.logo_url || null,
    created_by: ctx.employee.id,
    ...(advance ? {
      related_invoice_id: advance.source.id,
      buyer_name: advance.source.buyer_name,
      buyer_email: advance.source.buyer_email,
      buyer_phone: advance.source.buyer_phone,
      buyer_contact_person: advance.source.buyer_contact_person,
    } : {}),
    ...(type === 'corrective' ? {
      related_invoice_id: str(original?.id) || null,
      correction_kind: correctionKind,
      correction_reason: correctionReason,
      correction_type: [1, 2, 3].includes(Number(correction.type)) ? Number(correction.type) : 2,
      correction_scope: correction.scope === 'partial' ? 'partial' : 'full',
      corrected_invoice_number: correctedNumber,
      corrected_invoice_issue_date: day(original?.issue_date) || null,
      corrected_invoice_ksef_number: correctedKsef || null,
      corrected_invoice_was_in_ksef: Boolean(correctedKsef),
    } : {}),
  };

  const itemsToInsert = type === 'corrective'
    ? correctionLines.map((line) => ({
      position_number: line.position, name: line.name, unit: line.unit, vat_rate: line.vatRate, vat_code: line.vatCode,
      vat_exemption_reason: line.exemption.trim() || null, before_quantity: line.beforeQuantity, before_price_net: line.beforePriceNet,
      after_quantity: line.afterQuantity, after_price_net: line.afterPriceNet,
    }))
    : documentItems.map((item) => {
      const values = itemValues(item);
      return {
        position_number: item.position_number, name: item.name, unit: item.unit, quantity: item.quantity, price_net: item.price_net,
        vat_rate: item.vat_rate, vat_code: item.vat_code, vat_exemption_reason: item.vat_exemption_reason?.trim() || null,
        value_net: values.valueNet, vat_amount: values.vatAmount, value_gross: values.valueGross,
      };
    });
  const orderItemsToInsert = type === 'advance' ? orderItems.map((item) => {
    const values = itemValues(item);
    return {
      position_number: item.position_number, name: item.name, unit: item.unit, quantity: item.quantity, price_net: item.price_net,
      vat_rate: item.vat_rate, vat_code: item.vat_code, vat_exemption_reason: item.vat_exemption_reason?.trim() || null,
      value_net: values.valueNet, vat_amount: values.vatAmount, value_gross: values.valueGross,
    };
  }) : [];

  const { data: invoiceId, error: createError } = await ctx.supabase.rpc('create_invoice_atomic', {
    p_invoice: invoiceData, p_items: itemsToInsert, p_order_items: orderItemsToInsert,
  });
  if (createError || !invoiceId) {
    const error = createError as { code?: string; message?: string } | null;
    if (error?.code === '23502') {
      const column = error.message?.match(/column "(.+?)"/)?.[1] || '';
      fail(`Brakuje wymaganego pola: ${NOT_NULL_FIELDS[column] || column}. Uzupełnij dane i spróbuj ponownie.`);
    }
    if (error?.code === '23505') fail('Faktura o tym numerze już istnieje dla tej działalności. Wybierz inny numer.');
    fail(error?.message || 'Błąd podczas tworzenia faktury', error?.code === '42501' ? 403 : 400);
  }
  let warning: string | null = null;
  if (!isPartyDataCorrection && invoiceEventId && settlementGroup) {
    const { error: linkError } = await ctx.supabase.rpc('link_invoice_to_event_settlement', { p_invoice_id: invoiceId, p_source_event_id: invoiceEventId });
    if (linkError) warning = 'Faktura powstała, ale nie udało się przypisać jej do wszystkich wydarzeń grupy';
  }
  return { ok: true, id: str(invoiceId), message: 'Faktura została utworzona', warning };
}
