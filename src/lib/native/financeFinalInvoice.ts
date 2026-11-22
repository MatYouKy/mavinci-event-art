import 'server-only';
import type { NativeContext } from './auth';
import { getAcceptedCalculationInvoicePrefill, getAcceptedOfferInvoicePrefill } from '@/lib/invoices/acceptedOfferPrefill';
import { calculateFinalInvoice } from '@/lib/invoices/finalInvoiceCalculation';
import { inheritFinalInvoicePresentation } from '@/lib/invoices/inheritFinalInvoicePresentation';
import {
  invoiceRecipientPayload,
  recipientDraftFromInvoice,
  validateInvoiceRecipientDraft,
  type InvoiceRecipientDraft,
} from '@/lib/invoices/ksefRecipient';
import { DEFAULT_INVOICE_PAYMENT_TERM_DAYS, getInvoicePaymentDueDate } from '@/lib/invoices/paymentTerm';

/*
 * Faktura końcowa dla Maca — jak `FinalInvoiceWizardModal` w CRM: kontekst (zaliczka z karty, wydarzenie albo podmiot),
 * nierozliczone zaliczki do wyboru, pełna wartość zamówienia (zaakceptowana kalkulacja / oferta wydarzenia, także we
 * wspólnym rozliczeniu, albo zamówienie zapisane przy zaliczkach), pozycje odziedziczone z zaliczki albo pełnego
 * zamówienia (`inheritFinalInvoicePresentation`), rozliczenie (`calculateFinalInvoice`), numer, daty, odbiorca KSeF.
 * Zapis — sprawdzenia okna i `createFinalInvoice`, funkcja bazy `create_paid_final_invoice_atomic` tokenem pracownika,
 * potem przypisanie do wydarzeń grupy rozliczeń. Logika odczytu zamówienia — kopia `loadAdvanceOrder` (okno CRM)
 * i `loadFinalInvoiceEventOrder` (`src/lib/invoices/finalInvoiceEventOrder.ts`) z klientem pracownika.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class FinalInvoiceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new FinalInvoiceError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const trimmed = (value: unknown) => str(value).trim();
const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const object = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const uuidOrEmpty = (value: unknown) => (UUID.test(trimmed(value)) ? trimmed(value) : '');
const VAT_CODES = ['23', '8', '5', '0', '0 KR', '0 WDT', '0 EX', 'zw', 'np', 'np I', 'np II', 'oo'];
type VatCode = '23' | '8' | '5' | '0' | '0 KR' | '0 WDT' | '0 EX' | 'zw' | 'np' | 'np I' | 'np II' | 'oo';
type FinalItem = {
  name: string; unit: string; quantity: number; price_net: number; vat_rate: number; vat_code?: VatCode; vat_exemption_reason?: string | null;
};

const CANDIDATE_SELECT = `
  id, invoice_number, invoice_type, status, issue_date,
  total_net, total_vat, total_gross, paid_amount,
  event_id, related_invoice_id, organization_id, billing_arrangement,
  service_recipient_organization_id, service_recipient_contact_id,
  invoice_recipient_mode, invoice_recipient_data, ksef_recipient_snapshot,
  buyer_name, buyer_contact_id, buyer_nip, buyer_street, buyer_postal_code, buyer_city, buyer_country,
  buyer_email, buyer_phone, buyer_contact_person,
  payment_method, bank_account, issue_place, my_company_id,
  bank_name, currency_code,
  seller_name, seller_nip, seller_street, seller_postal_code, seller_city, seller_country,
  invoice_items (position_number, name, unit, quantity, price_net, vat_rate, vat_code, vat_exemption_reason),
  invoice_order_items (position_number, name, unit, quantity, price_net, vat_rate, vat_code, vat_exemption_reason),
  event:events!invoices_event_id_fkey(name),
  organization:organizations!invoices_organization_id_fkey(id, name)
`;

const normalizedText = (value: unknown) => str(value).trim().toLocaleLowerCase('pl-PL');
const normalizedNip = (value: unknown) => str(value).replace(/[^a-z\d]/gi, '').toUpperCase();

const sameSavedRecipient = (left: Row, right: Row) => {
  try {
    return JSON.stringify(recipientDraftFromInvoice(left)) === JSON.stringify(recipientDraftFromInvoice(right));
  } catch {
    return false;
  }
};

/** Ta sama sprzedaż co zaliczka źródłowa (`matchesAdvanceContext`). */
const matchesAdvanceContext = (invoice: Row, source: Row) => {
  const sourceNip = normalizedNip(source.buyer_nip);
  const sameBuyer = sourceNip
    ? normalizedNip(invoice.buyer_nip) === sourceNip
    : source.buyer_contact_id
      ? invoice.buyer_contact_id === source.buyer_contact_id
      : !normalizedNip(invoice.buyer_nip)
        && normalizedText(invoice.buyer_name) === normalizedText(source.buyer_name)
        && normalizedText(invoice.buyer_street) === normalizedText(source.buyer_street)
        && normalizedText(invoice.buyer_postal_code) === normalizedText(source.buyer_postal_code)
        && normalizedText(invoice.buyer_city) === normalizedText(source.buyer_city);
  return sameBuyer
    && invoice.my_company_id === source.my_company_id
    && normalizedNip(invoice.seller_nip) === normalizedNip(source.seller_nip)
    && (invoice.currency_code || 'PLN') === (source.currency_code || 'PLN')
    && invoice.organization_id === source.organization_id
    && invoice.billing_arrangement === source.billing_arrangement
    && invoice.service_recipient_organization_id === source.service_recipient_organization_id
    && invoice.service_recipient_contact_id === source.service_recipient_contact_id
    && sameSavedRecipient(invoice, source);
};

/** Zaliczki tego samego zamówienia co zaliczka źródłowa (`loadAdvanceOrder`). */
async function loadAdvanceOrder(ctx: NativeContext, sourceId: string) {
  const { data, error } = await ctx.supabase.from('invoices').select(CANDIDATE_SELECT).eq('id', sourceId).eq('invoice_type', 'advance').single();
  if (error || !data) fail('Nie udało się odczytać faktury zaliczkowej.');
  const source = data as Row;
  let orderSnapshot: Row[] | null = rows(source.invoice_order_items).length ? rows(source.invoice_order_items) : null;
  let orderEventId: string | null = source.event_id || null;
  const ancestors = new Set<string>([str(source.id)]);
  let root = source;
  while (root.related_invoice_id) {
    if (ancestors.has(str(root.related_invoice_id)) || ancestors.size >= 50) {
      fail('Nie udało się ustalić powiązań zamówienia. Sprawdź powiązane dokumenty.');
    }
    const { data: parentData, error: parentError } = await ctx.supabase.from('invoices').select(CANDIDATE_SELECT)
      .eq('id', root.related_invoice_id).maybeSingle();
    if (parentError) fail('Nie udało się ustalić powiązań zamówienia. Sprawdź powiązane dokumenty.');
    const parent = parentData as Row | null;
    if (!parent || !['advance', 'proforma'].includes(str(parent.invoice_type))) break;
    if (!orderSnapshot && rows(parent.invoice_order_items).length && matchesAdvanceContext(parent, source)) {
      orderSnapshot = rows(parent.invoice_order_items);
    }
    if (!orderEventId && matchesAdvanceContext(parent, source)) orderEventId = parent.event_id || null;
    ancestors.add(str(parent.id));
    root = parent;
    if (root.invoice_type === 'proforma') break;
  }
  const family = new Map<string, Row>([[str(source.id), source]]);
  if (root.invoice_type === 'advance') family.set(str(root.id), root);
  const visited = new Set<string>([str(root.id)]);
  let parentIds = [str(root.id)];
  let depth = 0;
  while (parentIds.length) {
    if (depth++ >= 50) fail('Nie udało się ustalić wszystkich zaliczek zamówienia. Sprawdź powiązane dokumenty.');
    const { data: children, error: childrenError } = await ctx.supabase.from('invoices').select(CANDIDATE_SELECT)
      .eq('invoice_type', 'advance').in('related_invoice_id', parentIds);
    if (childrenError) fail('Nie udało się ustalić wszystkich zaliczek zamówienia. Sprawdź powiązane dokumenty.');
    parentIds = [];
    for (const invoice of rows(children)) {
      if (visited.has(str(invoice.id))) continue;
      visited.add(str(invoice.id));
      family.set(str(invoice.id), invoice);
      parentIds.push(str(invoice.id));
    }
  }
  return {
    source,
    orderSnapshot,
    eventId: orderEventId,
    invoices: [...family.values()].filter((invoice) =>
      ['issued', 'sent', 'paid', 'overdue'].includes(str(invoice.status)) && matchesAdvanceContext(invoice, source)),
  };
}

type Context = { advanceId: string; mode: 'event' | 'organization'; eventId: string; organizationId: string };
const contextOf = (value: Row): Context => ({
  advanceId: uuidOrEmpty(value.advance),
  mode: value.mode === 'event' ? 'event' : 'organization',
  eventId: uuidOrEmpty(value.event),
  organizationId: uuidOrEmpty(value.org),
});

/** Nierozliczone zaliczki w kontekście (`fetchCandidates`). */
async function loadCandidates(ctx: NativeContext, context: Context) {
  let rawList: Row[];
  let advance: Awaited<ReturnType<typeof loadAdvanceOrder>> | null = null;
  if (context.advanceId) {
    advance = await loadAdvanceOrder(ctx, context.advanceId);
    rawList = advance.invoices;
  } else {
    let eventInvoiceIds: string[] = [];
    if (context.mode === 'event' && context.eventId) {
      const { data, error } = await ctx.supabase.from('event_invoice_settlements').select('id').eq('event_id', context.eventId);
      if (error) fail('Nie udało się pobrać zaliczek do rozliczenia.');
      eventInvoiceIds = [...new Set(rows(data).map((invoice) => str(invoice.id)))];
      if (!eventInvoiceIds.length) return { advance, candidates: [] as Row[] };
    }
    let query = ctx.supabase.from('invoices').select(CANDIDATE_SELECT).eq('invoice_type', 'advance')
      .in('status', ['issued', 'sent', 'paid', 'overdue']).order('issue_date', { ascending: false }).order('id', { ascending: true });
    if (context.mode === 'event' && context.eventId) query = query.in('id', eventInvoiceIds);
    else if (context.mode === 'organization' && context.organizationId) {
      query = query.or(`organization_id.eq.${context.organizationId},service_recipient_organization_id.eq.${context.organizationId}`);
    } else return { advance, candidates: [] as Row[] };
    const { data, error } = await query;
    if (error) fail('Nie udało się pobrać zaliczek do rozliczenia.');
    rawList = rows(data);
  }
  const ids = rawList.map((invoice) => str(invoice.id));
  let settled = new Set<string>();
  if (ids.length) {
    const { data, error } = await ctx.supabase.from('invoice_settlements').select('advance_invoice_id').in('advance_invoice_id', ids);
    if (error) fail('Nie udało się pobrać zaliczek do rozliczenia.');
    settled = new Set(rows(data).map((row) => str(row.advance_invoice_id)));
  }
  return { advance, candidates: rawList.filter((invoice) => !settled.has(str(invoice.id)) && Number(invoice.total_gross) > 0) };
}

function candidateOut(invoice: Row) {
  let recipient: InvoiceRecipientDraft | null = null;
  let recipientError: string | null = null;
  try { recipient = recipientDraftFromInvoice(invoice); } catch (error) {
    recipientError = error instanceof Error ? error.message : 'Nie udało się odczytać zapisanego odbiorcy zaliczki.';
  }
  const event = Array.isArray(invoice.event) ? invoice.event[0] : invoice.event;
  return {
    id: str(invoice.id), number: str(invoice.invoice_number), status: str(invoice.status), issueDate: str(invoice.issue_date).slice(0, 10) || null,
    net: num(invoice.total_net), vat: num(invoice.total_vat), gross: num(invoice.total_gross), paidAmount: num(invoice.paid_amount),
    currency: str(invoice.currency_code), eventId: str(invoice.event_id), eventName: str(object(event).name),
    companyId: str(invoice.my_company_id), buyerName: str(invoice.buyer_name), buyerNip: str(invoice.buyer_nip),
    buyerStreet: str(invoice.buyer_street), buyerPostalCode: str(invoice.buyer_postal_code), buyerCity: str(invoice.buyer_city),
    sellerName: str(invoice.seller_name), sellerNip: str(invoice.seller_nip),
    recipient, recipientError,
  };
}

/** Działalności do wyboru firmy wystawiającej (jak lista w oknie CRM). */
export async function finalSetup(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('my_companies').select('id, name, nip, is_default')
    .eq('is_active', true).order('is_default', { ascending: false }).order('name');
  if (error) fail('Nie udało się wczytać działalności.', 500);
  return { companies: rows(data).map((company) => ({ id: str(company.id), name: str(company.name), nip: str(company.nip), isDefault: company.is_default === true })) };
}

/** Wyszukiwanie wydarzenia albo podmiotu (50 wyników, jak w oknie CRM). */
export async function finalSearch(ctx: NativeContext, kindParam: unknown, queryParam: unknown) {
  const query = trimmed(queryParam).slice(0, 200);
  if (str(kindParam) === 'event') {
    let request = ctx.supabase.from('events').select('id, name, event_date').order('event_date', { ascending: false }).limit(50);
    if (query) request = request.ilike('name', `%${query}%`);
    const { data } = await request;
    return { options: rows(data).map((event) => ({ id: str(event.id), name: str(event.name), date: str(event.event_date).slice(0, 10) || null })) };
  }
  let request = ctx.supabase.from('organizations').select('id, name').order('name').limit(50);
  if (query) request = request.ilike('name', `%${query}%`);
  const { data } = await request;
  return { options: rows(data).map((organization) => ({ id: str(organization.id), name: str(organization.name), date: null })) };
}

/** Zaliczki do rozliczenia w kontekście okna; przy zaliczce z karty — także jej zamówienie i wydarzenie. */
export async function finalCandidates(ctx: NativeContext, params: URLSearchParams) {
  const context = contextOf({ advance: params.get('advance'), mode: params.get('mode'), event: params.get('event'), org: params.get('org') });
  const { advance, candidates } = await loadCandidates(ctx, context);
  // Nazwa podmiotu kontekstu („Podmiot: …”) — także gdy okno otwarto z wydarzeniem i podmiotem faktury.
  let organizationName: string | null = null;
  if (context.organizationId) {
    const { data } = await ctx.supabase.from('organizations').select('name').eq('id', context.organizationId).maybeSingle();
    organizationName = str((data as Row | null)?.name) || null;
  }
  return {
    source: advance ? candidateOut(advance.source) : null,
    sourceEventId: advance?.eventId || null,
    sourceEventName: advance ? str(object(Array.isArray(advance.source.event) ? advance.source.event[0] : advance.source.event).name) || null : null,
    organizationName,
    candidates: candidates.map(candidateOut),
  };
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function sourceCurrency(source: Row) {
  const stored = source.currency_code ?? source.currency ?? 'PLN';
  if (typeof stored !== 'string' || !/^[A-Z]{3}$/.test(stored.trim().toUpperCase())) {
    throw new Error('Źródło cen eventu ma nieprawidłową walutę. Popraw ją przed wystawieniem faktury końcowej.');
  }
  return stored.trim().toUpperCase();
}

function payerId(event: Row, group: Row | null) {
  const arrangement = group?.billing_arrangement || event.billing_arrangement || 'direct';
  return arrangement === 'direct' ? event.organization_id || null : group?.billing_organization_id || event.billing_organization_id || null;
}

/** Pełne uzgodnione zamówienie wydarzenia (kopia `loadFinalInvoiceEventOrder` z klientem pracownika). */
async function loadEventOrder(ctx: NativeContext, eventId: string) {
  const { data: membership, error: membershipError } = await ctx.supabase.from('event_settlement_group_members')
    .select('group_id').eq('event_id', eventId).maybeSingle();
  if (membershipError) throw new Error('Nie udało się odczytać wspólnego rozliczenia eventu. Spróbuj ponownie.');
  let group: Row | null = null;
  let eventIds = [eventId];
  if ((membership as Row | null)?.group_id) {
    const { data, error } = await ctx.supabase.from('event_settlement_groups')
      .select('id,name,primary_event_id,billing_arrangement,billing_organization_id,status').eq('id', (membership as Row).group_id).maybeSingle();
    if (error || !data) throw new Error('Nie udało się odczytać grupy rozliczeniowej eventu.');
    const groupRow = data as Row;
    if (groupRow.status === 'active') {
      group = groupRow;
      const { data: members, error: membersError } = await ctx.supabase.from('event_settlement_group_members').select('event_id').eq('group_id', groupRow.id);
      if (membersError || !rows(members).length) throw new Error('Nie udało się odczytać eventów wspólnego rozliczenia.');
      eventIds = [...new Set(rows(members).map((member) => str(member.event_id)))];
      if (!eventIds.includes(eventId) || !eventIds.includes(str(groupRow.primary_event_id))) {
        throw new Error('Powiązania wspólnego rozliczenia są niepełne. Sprawdź je w evencie.');
      }
    }
  }
  const { data: eventRows, error: eventsError } = await ctx.supabase.from('events').select('*').in('id', eventIds).order('event_date', { ascending: true });
  if (eventsError || !eventRows || eventRows.length !== eventIds.length) {
    throw new Error('Nie udało się odczytać wszystkich powiązanych eventów. Nie pobrano częściowej wartości zamówienia.');
  }
  const events = eventRows as Row[];
  const primaryEvent = events.find((event) => event.id === (group?.primary_event_id || eventId));
  if (!primaryEvent) throw new Error('Nie odnaleziono głównego eventu rozliczenia.');
  const expectedPayer = payerId(primaryEvent, group);
  if (events.some((event) => payerId(event, group) !== expectedPayer)) {
    throw new Error('Eventy wspólnego rozliczenia mają różnych nabywców. Sprawdź sposób rozliczenia eventów.');
  }
  const prepared = await Promise.all(events.map(async (event) => {
    let source: Row;
    let prefill: ReturnType<typeof getAcceptedOfferInvoicePrefill> | ReturnType<typeof getAcceptedCalculationInvoicePrefill>;
    let label: string;
    if (event.financial_source === 'calculation') {
      if (!event.accepted_calculation_id) {
        throw new Error(`Event „${event.name}” nie ma wybranej zaakceptowanej kalkulacji. Uzupełnij źródło cen w evencie.`);
      }
      const { data, error } = await ctx.supabase.from('event_calculations')
        .select('*,event_calculation_items(name,quantity,unit,unit_price,days,vat_rate,position)')
        .eq('id', event.accepted_calculation_id).eq('event_id', event.id).eq('is_accepted', true).maybeSingle();
      if (error || !data) throw new Error(`Nie odczytano zaakceptowanej kalkulacji eventu „${event.name}”. Sprawdź źródło cen w evencie.`);
      source = data as Row;
      prefill = getAcceptedCalculationInvoicePrefill(source as never);
      label = `Kalkulacja: ${str(source.name)}`;
    } else {
      const { data: financialRows, error: financialError } = await ctx.supabase.rpc('get_event_financial_info', { p_event_id: event.id });
      if (financialError) throw new Error(`Nie udało się odczytać uzgodnionych cen eventu „${event.name}”.`);
      const financialInfo = (Array.isArray(financialRows) ? financialRows[0] : null) as Row | null;
      if (!financialInfo?.accepted_offer_id) {
        throw new Error(`Event „${event.name}” nie ma zaakceptowanej oferty. Zaakceptuj właściwą ofertę lub kalkulację w evencie.`);
      }
      const { data, error } = await ctx.supabase.from('offers')
        .select('*,offer_items(name,quantity,unit,unit_price,discount_percent,total,display_order)')
        .eq('id', financialInfo.accepted_offer_id).eq('event_id', event.id).eq('status', 'accepted').maybeSingle();
      if (error || !data) throw new Error(`Nie odczytano zaakceptowanej oferty eventu „${event.name}”. Sprawdź źródło cen w evencie.`);
      source = data as Row;
      prefill = getAcceptedOfferInvoicePrefill(source as never, str(event.name));
      label = `Oferta ${str(source.offer_number) || str(financialInfo.accepted_offer_number)}`.trim();
    }
    const currencyCode = sourceCurrency(source);
    if ((event.currency_code || event.currency) && sourceCurrency(event) !== currencyCode) {
      throw new Error(`Waluta eventu „${event.name}” różni się od waluty jego uzgodnionych cen.`);
    }
    if (event.my_company_id && source.my_company_id && event.my_company_id !== source.my_company_id) {
      const { data: sourceAllowed, error: sourceAccessError } = await ctx.supabase.rpc('can_use_event_invoice_source', {
        p_event_id: event.id,
        p_source_kind: event.financial_source === 'calculation' ? 'calculation' : 'offer',
        p_source_id: source.id,
      });
      if (sourceAccessError || sourceAllowed !== true) {
        throw new Error(`Event „${event.name}” i jego źródło cen wskazują różne firmy, bez potwierdzonego przeniesienia przez fakturę.`);
      }
    }
    const calculatedNet = money(prefill.items.reduce((sum, item) => sum + money(item.quantity * item.price_net), 0));
    const calculatedVat = money(prefill.items.reduce((sum, item) => sum + money(money(item.quantity * item.price_net) * item.vat_rate / 100), 0));
    if (calculatedNet !== prefill.totals.net || calculatedVat !== prefill.totals.taxAmount || money(calculatedNet + calculatedVat) !== prefill.totals.gross) {
      throw new Error(`Kwoty pozycji eventu „${event.name}” nie odpowiadają jego uzgodnionemu podsumowaniu. Popraw źródło cen w evencie.`);
    }
    return { ...prefill, label, currencyCode, myCompanyId: (event.my_company_id || source.my_company_id || null) as string | null };
  }));
  const currencies = new Set(prepared.map((entry) => entry.currencyCode));
  const companies = new Set(prepared.map((entry) => entry.myCompanyId).filter((id): id is string => Boolean(id)));
  if (currencies.size !== 1 || companies.size > 1) {
    throw new Error('Wspólne rozliczenie obejmuje różne waluty lub firmy wystawiające fakturę. Nie można połączyć tych kwot.');
  }
  const items: FinalItem[] = prepared.flatMap((entry) => entry.items.map((item) => ({
    name: item.name, unit: item.unit, quantity: item.quantity, price_net: item.price_net, vat_rate: item.vat_rate, vat_code: item.vat_code as VatCode,
  })));
  if (!items.length || money(prepared.reduce((sum, entry) => sum + entry.totals.gross, 0)) <= 0) {
    throw new Error('Pełna wartość zamówienia eventu musi być większa od zera. Uzupełnij zaakceptowane źródło cen.');
  }
  return {
    items,
    eventName: str(group?.name) || str(primaryEvent.name) || 'Powiązane wydarzenie',
    eventIds,
    currencyCode: prepared[0].currencyCode,
    myCompanyId: [...companies][0] || null,
    sourceLabel: prepared.map((entry) => entry.label).join(' · '),
    notice: [...new Set(prepared.map((entry) => entry.notice).filter(Boolean))].join(' '),
  };
}

/** Zamówienie wydarzenia z kontrolą waluty i firmy względem zaliczek (`eventOrderError` w oknie CRM). */
async function eventOrderFor(ctx: NativeContext, eventId: string, reference: Row | null) {
  let order: Awaited<ReturnType<typeof loadEventOrder>> | null = null;
  let error: string | null = null;
  try {
    order = await loadEventOrder(ctx, eventId);
  } catch (problem) {
    error = problem instanceof Error ? problem.message : 'Nie udało się pobrać pełnego zamówienia eventu.';
  }
  const currency = str(reference?.currency_code) || order?.currencyCode || 'PLN';
  if (!error && order && reference && order.currencyCode !== currency) {
    error = 'Waluta zamówienia eventu różni się od waluty zaliczek. Sprawdź dokumenty przed rozliczeniem.';
  }
  if (!error && order?.myCompanyId && reference?.my_company_id && order.myCompanyId !== reference.my_company_id) {
    error = 'Event i zaliczki mają różne firmy wystawiające. Sprawdź rozliczenie eventu.';
  }
  return { order, error };
}

// Pozycje bez zmian względem okna CRM (jednostka i kod stawki jak w źródle; brak kodu — sama stawka).
const itemsOut = (items: FinalItem[] | null) => items?.map((item) => ({
  name: str(item.name), unit: str(item.unit), quantity: Number(item.quantity), priceNet: Number(item.price_net),
  vatRate: Number(item.vat_rate), vatCode: str(item.vat_code) || String(item.vat_rate), exemption: str(item.vat_exemption_reason),
})) ?? null;

/**
 * Pozycje faktury końcowej dla wybranej zaliczki wzorcowej i powiązanego wydarzenia: pełna wartość zamówienia
 * (wydarzenie albo zamówienie zapisane przy zaliczkach) oraz pozycje odziedziczone z zaliczki.
 */
export async function finalItems(ctx: NativeContext, params: URLSearchParams) {
  const advanceId = uuidOrEmpty(params.get('advance'));
  const snapshotId = uuidOrEmpty(params.get('snapshot'));
  const linkedEventId = uuidOrEmpty(params.get('event'));
  let snapshot: Row | null = null;
  let orderSnapshot: Row[] | null = null;
  if (advanceId) {
    const advance = await loadAdvanceOrder(ctx, advanceId);
    snapshot = advance.source;
    orderSnapshot = advance.orderSnapshot;
  } else if (snapshotId) {
    const { data } = await ctx.supabase.from('invoices').select(CANDIDATE_SELECT).eq('id', snapshotId).maybeSingle();
    snapshot = (data as Row | null) || null;
  }
  const snapshotItems = orderSnapshot?.length ? orderSnapshot : rows(snapshot?.invoice_order_items);
  let eventOrder: Awaited<ReturnType<typeof loadEventOrder>> | null = null;
  let eventOrderError: string | null = null;
  let fullValueItems: FinalItem[] | null = null;
  if (linkedEventId) {
    const result = await eventOrderFor(ctx, linkedEventId, snapshot);
    eventOrder = result.order;
    eventOrderError = result.error;
    fullValueItems = eventOrder && !eventOrderError ? eventOrder.items : null;
  } else if (snapshotItems.length) {
    fullValueItems = [...snapshotItems].sort((a, b) => num(a.position_number) - num(b.position_number)).map((item) => ({
      name: str(item.name) || 'Rozliczenie usługi zgodnie z umową',
      unit: str(item.unit) || 'szt.',
      quantity: Number(item.quantity ?? 1),
      price_net: Number(item.price_net ?? 0),
      vat_rate: Number(item.vat_rate ?? 23),
      vat_code: (item.vat_code ?? String(item.vat_rate ?? 23)) as VatCode,
      vat_exemption_reason: item.vat_exemption_reason ?? null,
    }));
  }
  const inherited = fullValueItems && snapshot
    ? inheritFinalInvoicePresentation({ invoiceItems: rows(snapshot.invoice_items) as never, fullOrderItems: fullValueItems, snapshotItems: snapshotItems as never })
    : { items: fullValueItems, error: null };
  return {
    eventOrder: eventOrder ? {
      eventName: eventOrder.eventName, eventIds: eventOrder.eventIds, currencyCode: eventOrder.currencyCode,
      myCompanyId: eventOrder.myCompanyId, sourceLabel: eventOrder.sourceLabel, notice: eventOrder.notice,
    } : null,
    eventOrderError,
    snapshotNumber: snapshot ? str(snapshot.invoice_number) : null,
    fullValueItems: itemsOut(fullValueItems),
    inheritedItems: itemsOut(inherited.items),
    presentationError: inherited.error,
  };
}

/** Numer przewidywany (`preview_invoice_number` dla faktury końcowej) z informacją o zajętym numerze. */
export async function finalNumber(ctx: NativeContext, companyParam: unknown) {
  const companyId = uuidOrEmpty(companyParam) || null;
  const { data, error } = await ctx.supabase.rpc('preview_invoice_number', { p_invoice_type: 'final', p_my_company_id: companyId });
  if (error || !data) return { number: '' };
  if (!companyId) return { number: str(data) };
  const { data: existing } = await ctx.supabase.from('invoices').select('id').eq('invoice_number', str(data)).eq('my_company_id', companyId).maybeSingle();
  return { number: existing ? `${str(data)} (zajęte)` : str(data) };
}

function finalItemsOf(value: unknown): FinalItem[] {
  return rows(value).slice(0, 500).map((item) => {
    const code = str(item.vatCode);
    return {
      name: str(item.name),
      unit: str(item.unit),
      quantity: Number(item.quantity),
      price_net: Number(item.priceNet),
      vat_rate: Number(item.vatRate),
      vat_code: (VAT_CODES.includes(code) ? code : undefined) as VatCode | undefined,
      vat_exemption_reason: str(item.exemption) || null,
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

/** „Wystaw fakturę końcową” — sprawdzenia `handleCreate` i `createFinalInvoice`, zapis i przypisanie do grupy rozliczeń. */
export async function finalCreate(ctx: NativeContext, body: Row) {
  const context = contextOf(body);
  const issueDate = trimmed(body.issueDate);
  const saleDate = trimmed(body.saleDate);
  const paymentDueDate = getInvoicePaymentDueDate(issueDate, str(body.paymentTermDays));
  if (!paymentDueDate) {
    fail('Podaj poprawną datę wystawienia i termin płatności w pełnych dniach (0 lub więcej).');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) fail('Podaj poprawną datę sprzedaży.');
  const { advance, candidates } = await loadCandidates(ctx, context);
  const selectedIds = new Set((Array.isArray(body.selected) ? body.selected : []).map(str).filter((id: string) => UUID.test(id)));
  const selectedInvoices = candidates.filter((invoice) => selectedIds.has(str(invoice.id)));
  if (selectedIds.size !== selectedInvoices.length) {
    fail('Lista zaliczek zmieniła się w międzyczasie — co najmniej jedna nie jest już dostępna do rozliczenia. Odśwież okno.');
  }
  const selectedEventIds = [...new Set(selectedInvoices.map((invoice) => str(invoice.event_id)).filter(Boolean))];
  const linkedEventId = advance ? advance.eventId || null
    : context.mode === 'event' ? context.eventId || null
      : selectedEventIds.length === 1 ? selectedEventIds[0] : null;
  const reference = advance?.source ?? selectedInvoices[0] ?? null;
  if (linkedEventId) {
    const { error } = await eventOrderFor(ctx, linkedEventId, reference);
    if (error) fail(error);
  }
  const items = finalItemsOf(body.items);
  const calculation = calculateFinalInvoice(items, selectedInvoices.map((invoice) => ({
    total_net: num(invoice.total_net), total_vat: num(invoice.total_vat), total_gross: num(invoice.total_gross),
  })));
  if (!Number.isFinite(calculation.totals.gross) || calculation.totals.gross <= 0) {
    fail('Uzupełnij pozycje pełnego zamówienia przed rozliczeniem zaliczek.');
  }
  if (!selectedInvoices.length) fail('Wybierz co najmniej jedną fakturę do rozliczenia');
  if (reference) {
    try { recipientDraftFromInvoice(reference); } catch (error) {
      fail(error instanceof Error ? error.message : 'Nie udało się odczytać zapisanego odbiorcy zaliczki.');
    }
  }
  const recipientDraft = draftOf(body.recipient);
  const recipientErrors = validateInvoiceRecipientDraft(recipientDraft);
  if (recipientErrors.length) fail(recipientErrors.join(' '));
  if (recipientDraft.mode !== 'same_as_buyer' && recipientDraft.data.internalId
    && recipientDraft.data.internalId.split('-')[0] !== normalizedNip(selectedInvoices[0].buyer_nip).replace(/^PL/, '')) {
    fail('Numer wewnętrzny odbiorcy musi wskazywać NIP nabywcy faktury.');
  }
  if (items.some((item) => !item.name.trim())) fail('Wszystkie pozycje muszą mieć nazwę');
  const useCustomNumber = body.useCustomNumber === true;
  const customNumber = trimmed(body.customNumber);
  if (useCustomNumber && !customNumber) fail('Podaj numer faktury');
  if (calculation.remaining.gross < -0.01) fail('Suma zaliczek przekracza wartość faktury końcowej.');

  const ref = selectedInvoices[0];
  if (advance && selectedInvoices.some((invoice) => !matchesAdvanceContext(invoice, advance.source))) {
    fail('Wybrane zaliczki muszą dotyczyć tego samego zamówienia, nabywcy i sprzedawcy.');
  }
  const digits = (value: unknown) => str(value).replace(/\D/g, '');
  const incompatible = selectedInvoices.some((invoice) =>
    invoice.my_company_id !== ref.my_company_id
    || digits(invoice.buyer_nip) !== digits(ref.buyer_nip)
    || (invoice.currency_code || 'PLN') !== (ref.currency_code || 'PLN')
    || (!advance && context.mode !== 'event' && invoice.event_id !== ref.event_id)
    || invoice.organization_id !== ref.organization_id
    || normalizedText(invoice.buyer_name) !== normalizedText(ref.buyer_name)
    || normalizedText(invoice.buyer_street) !== normalizedText(ref.buyer_street)
    || normalizedText(invoice.buyer_postal_code) !== normalizedText(ref.buyer_postal_code)
    || normalizedText(invoice.buyer_city) !== normalizedText(ref.buyer_city)
    || !sameSavedRecipient(invoice, ref));
  if (incompatible) {
    fail('Wybrane zaliczki muszą mieć tego samego sprzedawcę, nabywcę, walutę, wspólne rozliczenie i płatnika.');
  }
  if (new Set(selectedInvoices.map((invoice) => invoice.my_company_id).filter(Boolean)).size > 1) {
    fail('Nie można wystawić faktury końcowej dla zaliczek z różnych firm.');
  }

  // Firma: wybrana w oknie (przy zaliczce z karty — firma zaliczki), domyślnie firma zaliczek.
  // Przy zaliczce z karty pole firmy jest zablokowane na firmie zaliczki (jak w oknie CRM).
  const myCompanyId = (advance ? str(advance.source.my_company_id) : '') || uuidOrEmpty(body.companyId) || str(ref.my_company_id);
  let company: Row | null = null;
  if (myCompanyId) {
    const { data: companyRow } = await ctx.supabase.from('my_companies').select('id, bank_name, bank_account, bank_swift_code')
      .eq('id', myCompanyId).eq('is_active', true).maybeSingle();
    company = companyRow as Row | null;
  }

  // `createFinalInvoice`
  if (!items.length) fail('Faktura końcowa musi mieć co najmniej jedną pozycję');
  if (items.some((item) => !item.name.trim() || !Number.isFinite(item.quantity) || item.quantity <= 0
    || !Number.isFinite(item.price_net) || item.price_net < 0 || !Number.isFinite(item.vat_rate) || item.vat_rate < 0)) {
    fail('Pozycje faktury zawierają nieprawidłowe wartości');
  }
  if (items.some((item) => item.vat_code === 'zw' && !str(item.vat_exemption_reason).trim())) fail('Podaj podstawę prawną dla każdej pozycji zwolnionej z VAT');
  if (items.some((item) => item.vat_code === '0' || item.vat_code === 'np')) {
    fail('Uzupełnij klasyfikację pozycji 0% lub niepodlegających VAT przed utworzeniem faktury końcowej');
  }
  let invoiceNumber = '';
  if (useCustomNumber) {
    const { data: existing } = await ctx.supabase.from('invoices').select('id').eq('invoice_number', customNumber).eq('my_company_id', myCompanyId || null).maybeSingle();
    if (existing) fail('Faktura o tym numerze już istnieje');
    invoiceNumber = customNumber;
  }
  const name = trimmed(ctx.employee.name);
  const surname = trimmed(ctx.employee.surname);
  if (!name || !surname) {
    fail('Uzupełnij imię i nazwisko w swoim profilu pracownika. Te dane są wymagane jako podpis osoby upoważnionej do wystawienia faktury.');
  }
  const settledRefs = selectedInvoices.map((invoice) => ({
    id: str(invoice.id), invoice_number: str(invoice.invoice_number), total_net: num(invoice.total_net), total_vat: num(invoice.total_vat),
    total_gross: num(invoice.total_gross), invoice_type: str(invoice.invoice_type), issue_date: str(invoice.issue_date) || null,
  }));
  const { net: totalNet, vat: totalVat, gross: totalGross } = calculation.totals;
  const { net: settledNet, vat: settledVat, gross: settledGross } = calculation.settled;
  const { net: remainingNet, vat: remainingVat, gross: remainingGross } = calculation.remaining;
  const settledInvoicesJson = settledRefs.map((invoice) => ({
    id: invoice.id, invoiceNumber: invoice.invoice_number, invoiceType: invoice.invoice_type, issueDate: invoice.issue_date,
    totalNet: invoice.total_net, totalVat: invoice.total_vat, totalGross: invoice.total_gross,
  }));
  const settlementSummaryJson = {
    invoiceTotalNet: totalNet, invoiceTotalVat: totalVat, invoiceTotalGross: totalGross,
    settledNet, settledVat, settledGross, remainingNet, remainingVat, remainingGross,
  };
  const currency = str(ref.currency_code) || 'PLN';
  const settlementLines = settledRefs.map((invoice) => `- ${invoice.invoice_number} (zaliczkowa): ${Number(invoice.total_gross).toFixed(2)} ${currency} brutto`).join('\n');
  const settlementText = settledRefs.length
    ? `Rozliczone wpłaty / zaliczki:\n${settlementLines}\nSuma rozliczonych: ${settledGross.toFixed(2)} ${currency} brutto.\nDo dopłaty: ${remainingGross.toFixed(2)} ${currency} brutto.`
    : '';
  const todayDate = new Date().toISOString().split('T')[0];
  const defaultDue = getInvoicePaymentDueDate(issueDate || todayDate, DEFAULT_INVOICE_PAYMENT_TERM_DAYS);
  let recipientPayload: ReturnType<typeof invoiceRecipientPayload>;
  try {
    recipientPayload = invoiceRecipientPayload(recipientDraft);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Sprawdź dane odbiorcy.');
  }
  const insertPayload: Row = {
    invoice_number: invoiceNumber,
    auto_number: !useCustomNumber,
    invoice_type: 'final',
    status: 'draft',
    is_proforma: false,
    issue_date: issueDate || todayDate,
    sale_date: saleDate || todayDate,
    payment_due_date: paymentDueDate || defaultDue,
    event_id: linkedEventId || ref.event_id || null,
    organization_id: ref.organization_id || null,
    billing_arrangement: ref.billing_arrangement || 'direct',
    service_recipient_organization_id: ref.service_recipient_organization_id || null,
    service_recipient_contact_id: ref.service_recipient_contact_id || null,
    my_company_id: myCompanyId || null,
    created_by: ctx.employee.id,
    total_net: totalNet,
    total_vat: totalVat,
    total_gross: totalGross,
    currency_code: currency,
    payment_method: ref.payment_method ?? null,
    bank_account: company?.bank_account ?? ref.bank_account ?? null,
    bank_name: company?.bank_name ?? ref.bank_name ?? null,
    bank_swift_code: company?.bank_swift_code ?? null,
    issue_place: ref.issue_place ?? null,
    notes: settlementText || null,
    internal_notes: JSON.stringify({ kind: 'final_invoice', settled: settledInvoicesJson, settlementSummary: settlementSummaryJson }),
    settled_invoices: settledInvoicesJson,
    settlement_summary: settlementSummaryJson,
    related_invoice_id: settledRefs[0]?.id ?? null,
    buyer_name: ref.buyer_name,
    buyer_nip: ref.buyer_nip,
    buyer_street: ref.buyer_street,
    buyer_postal_code: ref.buyer_postal_code,
    buyer_city: ref.buyer_city,
    buyer_country: ref.buyer_country,
    buyer_email: ref.buyer_email,
    buyer_phone: ref.buyer_phone,
    buyer_contact_person: ref.buyer_contact_person,
    seller_name: ref.seller_name,
    seller_nip: ref.seller_nip,
    seller_street: ref.seller_street,
    seller_postal_code: ref.seller_postal_code,
    seller_city: ref.seller_city,
    seller_country: ref.seller_country,
  };
  // Odbiorca z okna zastępuje odbiorcę usługi zaliczki (kolejność jak w `createFinalInvoice`).
  Object.assign(insertPayload, recipientPayload);
  insertPayload.created_by = ctx.employee.id;
  insertPayload.signature_name = `${name} ${surname}`;

  const { data: createdId, error } = await ctx.supabase.rpc('create_paid_final_invoice_atomic', {
    p_invoice: insertPayload,
    p_items: calculation.items,
    p_advance_ids: settledRefs.map((invoice) => invoice.id),
  });
  if (error || !createdId) {
    fail(
      error?.code === 'PGRST202'
        ? 'Wystawianie faktur końcowych wymaga aktualizacji systemu. Skontaktuj się z administratorem.'
        : error?.message || 'Nie udało się utworzyć faktury końcowej',
      error?.code === '42501' ? 403 : 400,
    );
  }
  let warning: string | null = null;
  const settlementEventId = linkedEventId || ref.event_id;
  if (settlementEventId) {
    const { error: linkError } = await ctx.supabase.rpc('link_invoice_to_event_settlement', {
      p_invoice_id: createdId, p_source_event_id: settlementEventId,
    });
    if (linkError) warning = 'Faktura końcowa powstała, ale nie udało się przypisać jej do całej grupy eventów';
  }
  return { ok: true, id: str(createdId), message: 'Faktura końcowa utworzona', warning };
}
