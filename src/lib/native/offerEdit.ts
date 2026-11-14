import 'server-only';
import type { NativeContext } from './auth';
import { fail, offerDetail } from './offers';
import { getOfferPricingTotals } from '@/lib/CRM/Offers/offerTotals';
import { calculateOfferDiscount, type OfferDiscountMode } from '@/lib/CRM/Offers/offerDiscount';
import { resolveOfferSchedule } from '@/lib/CRM/Offers/offerSchedule';
import { offerNeedsTables } from '@/lib/CRM/Offers/audiencePricing';
import {
  EVENT_ASSUMPTION_OPTIONS,
  EVENT_ASSUMPTION_VALUE_MAX_LENGTH,
  formatEventAssumptionItems,
  getEventAssumptionOption,
  normalizeEventAssumptionItems,
  syncGuestCountAssumptions,
  type EventAssumptionItem,
  type EventAssumptionKey,
} from '@/lib/CRM/Offers/eventAssumptions';
import { getCalculationNumber } from '@/lib/CRM/calculations/calculationNumber';

/*
 * Oferty na Macu, część B — edycja treści oferty jak w CRM: informacje podstawowe (`OfferBasicInfo.handleSave`), założenia
 * wydarzenia (`OfferAssumptionsSection`, propozycja AI `draft_offer_assumptions`), rabat (`OfferDetails`), kolejność, układ
 * w PDF, widoczność wariantów i usuwanie pozycji (`OfferItems`). Zmiany tylko dla zarządzających ofertą
 * (`sales_can_manage_offer`), nie dla zaakceptowanych ani ofert z portalu sprzedawcy (jak `canEditCrmContent`).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message = 'Nieprawidłowa oferta.') => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const optionalUuid = (value: unknown) => {
  const id = String(value || '');
  if (!id) return null;
  if (!UUID.test(id)) fail('Nieprawidłowy wybór.');
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));

/** Oferta do edycji treści: zarządzający, nie zaakceptowana, nie z portalu sprzedawcy. */
async function editable(ctx: NativeContext, id: string, select = 'id, status, sales_channel') {
  const [{ data: allowed, error: permissionError }, { data: offer, error }] = await Promise.all([
    ctx.supabase.rpc('sales_can_manage_offer', { p_offer: id }),
    ctx.supabase.from('offers').select(select).eq('id', id).maybeSingle(),
  ]);
  if (error || !offer) fail('Nie znaleziono oferty.');
  if (permissionError || allowed !== true) fail('Nie masz uprawnień do zmiany tej oferty.');
  const row = offer as unknown as Row;
  if (row.sales_channel === 'seller_portal') fail('Ofertę z portalu sprzedawcy zmienia się w obsłudze oferty sprzedawcy.');
  if (row.status === 'accepted') fail('Zaakceptowanej oferty nie można edytować.');
  return row;
}

// MARK: Dane do edycji informacji podstawowych

const EDIT_SELECT = `id, status, sales_channel, title, client_type, organization_id, contact_id, event_id, inquiry_id, event_date,
  event_location, guest_count, guests_per_table, table_count, valid_until, notes, hero_image_path, hero_image_alt, info_page_sections,
  pricing_source, source_calculation_id,
  inquiry:tasks!inquiry_id(id, title, inquiry_details),
  event:events!event_id(id, name, event_date, location),
  offer_items(pricing_configuration)`;

const DEFAULT_INFO_SECTIONS = [
  { key: 'event_details', title: 'TERMIN I MIEJSCE' },
  { key: 'pricing_source', title: 'ZAKRES I WYCENA' },
  { key: 'coordination', title: 'KONTAKT I KOORDYNACJA' },
];

/** Trzy dodatkowe karty strony informacyjnej ze starszych ofert (jak `normalizeInfoPageSections`). */
function infoSections(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return DEFAULT_INFO_SECTIONS.map((fallback, index) => {
    const stored = source[index];
    if (!stored || typeof stored !== 'object') return { ...fallback, content: '' };
    return { key: text(stored.key) || fallback.key, title: text(stored.title) || fallback.title, content: text(stored.content) };
  });
}

/** Kalkulacje wydarzenia lub zapytania (źródło wyceny „zaakceptowana kalkulacja”). */
async function calculations(ctx: NativeContext, eventId: string | null, inquiryId: string | null) {
  if (!eventId && !inquiryId) return [];
  let query = ctx.supabase.from('event_calculations').select('id, name, created_at, is_accepted').order('created_at', { ascending: false });
  if (eventId && inquiryId) query = query.or(`event_id.eq.${eventId},inquiry_id.eq.${inquiryId}`);
  else if (eventId) query = query.eq('event_id', eventId);
  else query = query.eq('inquiry_id', inquiryId as string);
  const { data, error } = await query;
  if (error) return [];
  return ((data || []) as Row[]).map((row) => ({
    id: String(row.id), accepted: row.is_accepted === true,
    label: `${getCalculationNumber(row.id, row.created_at)} — ${text(row.name)}`,
  }));
}

export async function offerEditor(ctx: NativeContext, id: string) {
  const key = uuid(id);
  const offer = await editable(ctx, key, EDIT_SELECT);
  const details = offer.inquiry?.inquiry_details || {};
  const schedule = resolveOfferSchedule(offer);
  const [organizations, individuals, events, locations, calcs] = await Promise.all([
    ctx.supabase.from('organizations').select('id, name, alias').order('name'),
    ctx.supabase.from('contacts').select('id, full_name, first_name, last_name, email, phone, mobile').eq('contact_type', 'individual').order('full_name'),
    ctx.supabase.from('events').select('id, name, event_date').order('event_date', { ascending: false }),
    ctx.supabase.from('locations').select('id, name, city, postal_code, address, formatted_address').order('name'),
    calculations(ctx, offer.event_id || null, offer.inquiry_id || offer.inquiry?.id || null),
  ]);
  const location = offer.event?.location;
  const relationLocation = typeof location === 'string'
    ? location
    : location?.name || location?.formatted_address || location?.address
      || [location?.street, location?.postal_code, location?.city].filter(Boolean).join(' ');
  const clientType = offer.client_type === 'individual' ? 'individual'
    : offer.client_type === 'business' || offer.organization_id ? 'business' : offer.contact_id ? 'individual' : 'business';
  const name = (row: Row) => text(row.full_name) || [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Bez nazwy';
  return {
    title: text(offer.title),
    inheritedTitle: text(offer.event?.name || text(offer.inquiry?.title).replace(/^Zapytanie:\s*/i, '')),
    clientType,
    organizationId: offer.organization_id || null,
    contactId: offer.contact_id || null,
    eventId: offer.event_id || null,
    eventDate: offer.event_date || offer.event?.event_date || details.termin || null,
    fromInquiry: schedule.fromInquiry,
    scheduleStart: schedule.startLabel || 'Nie ustalono',
    scheduleEnd: schedule.endLabel || 'Nie ustalono',
    location: text(offer.event_location || relationLocation || details.location_text),
    guestCount: offer.guest_count ?? null,
    guestsPerTable: offer.guests_per_table ?? 10,
    tableCount: offer.table_count ?? null,
    needsTables: offerNeedsTables(offer),
    validUntil: text(offer.valid_until).slice(0, 10) || null,
    notes: text(offer.notes),
    heroPath: offer.hero_image_path || null,
    heroAlt: text(offer.hero_image_alt),
    infoSections: infoSections(offer.info_page_sections),
    pricingSource: offer.pricing_source === 'calculation' ? 'calculation' : 'offer',
    calculationId: offer.source_calculation_id || null,
    calculations: calcs,
    organizations: ((organizations.data || []) as Row[]).map((row) => ({ id: String(row.id), name: text(row.name), alias: row.alias || null })),
    individuals: ((individuals.data || []) as Row[]).map((row) => ({
      id: String(row.id), name: name(row), email: row.email || null, phone: row.mobile || row.phone || null,
    })),
    events: ((events.data || []) as Row[]).map((row) => ({ id: String(row.id), name: text(row.name) || 'Wydarzenie bez nazwy', date: row.event_date || null })),
    locations: ((locations.data || []) as Row[]).map((row) => ({
      id: String(row.id),
      label: `${text(row.name)}${row.city ? `, ${row.city}` : ''}${row.postal_code ? `, ${row.postal_code}` : ''}`,
      search: [row.name, row.city, row.address, row.formatted_address].filter(Boolean).join(' '),
    })),
  };
}

/** Osoby kontaktowe organizacji (jak `fetchBusinessContacts`): kontakt główny pierwszy. */
export async function organizationContacts(ctx: NativeContext, organization: string) {
  const id = uuid(organization, 'Nieprawidłowa organizacja.');
  const { data, error } = await ctx.supabase.from('contacts')
    .select('id, full_name, first_name, last_name, email, phone, mobile, contact_organizations!inner(organization_id, is_primary)')
    .eq('contact_organizations.organization_id', id).eq('contact_type', 'contact').order('full_name');
  if (error) fail('Nie udało się pobrać osób kontaktowych.');
  return {
    contacts: ((data || []) as Row[]).map((row) => ({
      id: String(row.id),
      name: text(row.full_name) || [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Bez nazwy',
      email: row.email || null,
      phone: row.mobile || row.phone || null,
      primary: Array.isArray(row.contact_organizations) && row.contact_organizations.some((link: Row) => link.is_primary === true),
    })),
  };
}

export async function offerCalculations(ctx: NativeContext, id: string, eventId: string | null) {
  const key = uuid(id);
  const { data } = await ctx.supabase.from('offers').select('inquiry_id').eq('id', key).maybeSingle();
  return { calculations: await calculations(ctx, optionalUuid(eventId), (data as Row | null)?.inquiry_id || null) };
}

// MARK: Zapis informacji podstawowych

const IMAGE_TYPES: Array<{ type: string; extension: string; test: (bytes: Buffer) => boolean }> = [
  { type: 'image/png', extension: 'png', test: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', extension: 'jpg', test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: 'image/webp', extension: 'webp', test: (bytes) => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
];

const wholeNumber = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value));

export async function saveOfferBasic(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id, 'id, status, sales_channel, inquiry_id, event_date, hero_image_path, inquiry:tasks!inquiry_id(id)');
  const input = body.fields && typeof body.fields === 'object' ? body.fields as Row : {};
  const clientType = input.clientType === 'individual' ? 'individual' : 'business';
  const organizationId = optionalUuid(input.organizationId);
  const contactId = optionalUuid(input.contactId);
  if (clientType === 'individual' && !contactId) fail('Wybierz klienta indywidualnego');
  if (clientType === 'business' && !organizationId) fail('Wybierz organizację');
  const pricingSource = input.pricingSource === 'calculation' ? 'calculation' : 'offer';
  const calculationId = optionalUuid(input.calculationId);
  if (pricingSource === 'calculation' && !calculationId) fail('Wybierz kalkulację, która ma stanowić podstawę wyceny');

  // Termin z zapytania zmienia się w zapytaniu; w pozostałych ofertach zapisuje się w ofercie (nie zmienia wydarzenia).
  const fromInquiry = Boolean(offer.inquiry_id || offer.inquiry?.id);
  let eventDate = offer.event_date || null;
  if (!fromInquiry) {
    const raw = text(input.eventDate).trim();
    if (raw) {
      const parsed = new Date(raw);
      if (!Number.isFinite(parsed.getTime())) fail('Podaj prawidłowy termin wydarzenia');
      eventDate = parsed.toISOString();
    } else {
      eventDate = null;
    }
  }

  const guestCount = wholeNumber(input.guestCount);
  const tableCount = wholeNumber(input.tableCount);
  const guestsPerTable = Number(input.guestsPerTable ?? 10);
  if ((guestCount != null && (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 100000))
    || (tableCount != null && (!Number.isInteger(tableCount) || tableCount < 1 || tableCount > 100000))
    || !Number.isInteger(guestsPerTable) || guestsPerTable < 1 || guestsPerTable > 100) {
    fail('Podaj poprawną liczbę osób i stołów oraz od 1 do 100 osób przy stole.');
  }
  const validUntil = text(input.validUntil).slice(0, 10);
  if (validUntil && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) fail('Nieprawidłowa data ważności.');
  const title = text(input.title).trim();
  if (title.length > 180) fail('Tytuł oferty może mieć maksymalnie 180 znaków.');
  const notes = text(input.notes);
  if (notes.length > 20000) fail('Notatki są za długie.');
  const location = text(input.location).trim();
  if (location.length > 500) fail('Nazwa miejsca jest za długa.');
  const heroAlt = text(input.heroAlt).trim().slice(0, 300);
  const sections = infoSections(input.infoSections).map((section) => ({
    key: section.key, title: section.title.trim().slice(0, 120), content: section.content.trim().slice(0, 4000),
  }));

  // Grafika hero: nowa (Mac zmniejsza do 1800 px), usunięcie (grafika szablonu) albo bez zmian.
  let heroPath = offer.hero_image_path || null;
  const hero = body.hero && typeof body.hero === 'object' ? body.hero as Row : null;
  if (hero?.remove === true) heroPath = null;
  if (typeof hero?.data === 'string' && hero.data) {
    const bytes = Buffer.from(hero.data, 'base64');
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) fail('Zdjęcie może mieć maksymalnie 12 MB');
    const kind = IMAGE_TYPES.find((item) => item.test(bytes));
    if (!kind) fail('Wybierz zdjęcie JPG, PNG lub WEBP');
    heroPath = `offer-heroes/${id}/hero-${Date.now()}.${kind.extension}`;
    const { error } = await ctx.supabase.storage.from('offer-template-pages').upload(heroPath, bytes, { contentType: kind.type, upsert: true });
    if (error) fail(error.message || 'Nie udało się wysłać grafiki hero.');
  }

  const patch: Row = {
    client_type: clientType,
    pricing_source: pricingSource,
    source_calculation_id: pricingSource === 'calculation' ? calculationId : null,
    ...(body.refreshCalculation === true && pricingSource === 'calculation' ? { calculation_snapshot: null } : {}),
    title: title || null,
    organization_id: clientType === 'business' ? organizationId : null,
    contact_id: contactId,
    event_id: optionalUuid(input.eventId),
    event_date: eventDate,
    event_location: location || null,
    guest_count: guestCount,
    guests_per_table: guestsPerTable,
    table_count: tableCount,
    valid_until: validUntil || null,
    notes,
    hero_image_path: heroPath,
    hero_image_alt: heroPath ? heroAlt || null : null,
    info_page_sections: sections,
  };
  const { data, error } = await ctx.supabase.from('offers').update(patch).eq('id', id).select('id').maybeSingle();
  if (error) fail(error.message || 'Błąd podczas aktualizacji oferty');
  if (!data) fail('Nie masz uprawnień do zmiany tej oferty.');
  return offerDetail(ctx, id);
}

// MARK: Założenia wydarzenia

/** Karty do wyboru (`EVENT_ASSUMPTION_OPTIONS`) i zapisane założenia do edycji. */
export async function offerAssumptionsEditor(ctx: NativeContext, id: string) {
  const key = uuid(id);
  const offer = await editable(ctx, key, 'id, status, sales_channel, guest_count, event_assumptions, event_assumption_items, event_goal, inquiry_id, inquiry:tasks!inquiry_id(id, inquiry_details), event:events!event_id(category:event_categories(name)), offer_items(name, product:offer_products(name))');
  const details = offer.inquiry?.inquiry_details || {};
  const legacy = text(offer.event_assumptions || details.event_assumptions || details.scope);
  const stored = Array.isArray(offer.event_assumption_items) && offer.event_assumption_items.some((item: Row) => text(item?.value).trim())
    ? offer.event_assumption_items : details.event_assumption_items;
  const guestCount = offer.guest_count ?? null;
  return {
    items: syncGuestCountAssumptions(normalizeEventAssumptionItems(stored, legacy), guestCount),
    goal: text(offer.event_goal || details.event_goal),
    guestCount,
    maxLength: EVENT_ASSUMPTION_VALUE_MAX_LENGTH,
    options: EVENT_ASSUMPTION_OPTIONS.map((option) => ({
      key: option.key, label: option.label, question: option.question, placeholder: option.placeholder,
      multiline: option.multiline === true, defaultValue: option.defaultValue || '', defaultBadge: option.defaultBadgeValue || '',
    })),
  };
}

function assumptionItems(value: unknown) {
  return (Array.isArray(value) ? value : []).slice(0, 3).map((item: Row) => ({
    key: text(item?.key) as EventAssumptionKey,
    label: text(item?.label).slice(0, 80),
    value: text(item?.value).slice(0, EVENT_ASSUMPTION_VALUE_MAX_LENGTH),
    badge_value: text(item?.badge_value ?? item?.badge).trim().toLocaleUpperCase('pl-PL').slice(0, 7),
  }));
}

export async function saveOfferAssumptions(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id, 'id, status, sales_channel, guest_count');
  const items = syncGuestCountAssumptions(normalizeEventAssumptionItems(assumptionItems(body.items)), offer.guest_count ?? null);
  const goal = text(body.goal).trim();
  if (goal.length > 2000) fail('Cel wydarzenia jest za długi.');
  const { data, error } = await ctx.supabase.from('offers').update({
    event_assumption_items: items,
    event_assumptions: formatEventAssumptionItems(items) || null,
    event_goal: goal || null,
  }).eq('id', id).select('id').maybeSingle();
  if (error) fail(error.message || 'Nie udało się zapisać założeń');
  if (!data) fail('Nie masz uprawnień do zmiany tej oferty.');
  return offerDetail(ctx, id);
}

/** „Zaproponuj z AI” (`draft_offer_assumptions`): treści trzech wybranych kart i opcjonalnie cel wydarzenia. */
export async function draftOfferAssumptions(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id, 'id, status, sales_channel, guest_count, inquiry_id, event:events!event_id(category:event_categories(name)), offer_items(name, product:offer_products(name))');
  const requested = normalizeEventAssumptionItems(assumptionItems(body.items));
  const instructions = text(body.instructions).trim();
  if (instructions.length > 2000) fail('Dodatkowe wskazówki mogą mieć maksymalnie 2000 znaków');
  const generateGoal = body.generateGoal !== false;
  const guestCount = offer.guest_count ?? null;
  const { data, error } = await ctx.supabase.functions.invoke('assist-inquiry', {
    body: {
      action: 'draft_offer_assumptions',
      selectedAssumptions: requested.map((item) => ({ key: item.key, label: item.label, value: item.value })),
      ...(instructions ? { additionalInstructions: instructions } : {}),
      inquiryId: offer.inquiry_id || undefined,
      context: {
        event_goal: text(body.goal),
        ...(guestCount == null ? {} : { guest_count: guestCount }),
        event_category: text(offer.event?.category?.name).slice(0, 100),
        product_names: ((offer.offer_items || []) as Row[]).map((item) => text(item.name || item.product?.name).slice(0, 120)).filter(Boolean).slice(0, 30),
      },
    },
  });
  let message = (data as Row | null)?.error as string | undefined;
  if (error && !message) {
    try { message = (await (error as any).context?.json())?.error; } catch { /* komunikat zastępczy */ }
  }
  if (error || message) fail(message || 'Nie udało się przygotować założeń przez AI');
  const result = ((data as Row | null)?.result || {}) as Row;
  const candidates = Array.isArray(result.assumptions) ? result.assumptions as Row[] : [];
  if (candidates.length !== requested.length || candidates.some((candidate, index) => candidate?.key !== requested[index].key)) {
    fail('AI nie zachowało wybranych kategorii. Spróbuj ponownie.');
  }
  const allowed = new Set(EVENT_ASSUMPTION_OPTIONS.map((option) => option.key));
  const used = new Set<EventAssumptionKey>();
  const items = candidates.reduce<EventAssumptionItem[]>((list, candidate) => {
    const key = text(candidate?.key) as EventAssumptionKey;
    if (!allowed.has(key) || (key !== 'custom' && used.has(key))) return list;
    if (key !== 'custom') used.add(key);
    const option = getEventAssumptionOption(key);
    const value = text(candidate?.value).trim();
    if (!value) return list;
    list.push({
      key,
      label: key === 'custom' ? text(candidate?.label || option.label).trim().slice(0, 80) : option.label,
      value: value.slice(0, EVENT_ASSUMPTION_VALUE_MAX_LENGTH),
      badge_value: text(candidate?.badge_value).trim().slice(0, 7),
    });
    return list;
  }, []).slice(0, 3);
  if (items.length !== 3) fail('AI nie przygotowało trzech kompletnych założeń. Spróbuj ponownie.');
  const goal = text(result.event_goal).trim();
  if (generateGoal && !goal) fail('AI nie przygotowało celu wydarzenia. Spróbuj ponownie.');
  const sources = result.source_context as Row | undefined;
  return {
    items: syncGuestCountAssumptions(items, guestCount),
    goal: generateGoal ? goal : null,
    sources: sources
      ? `Wykorzystano analizy: ${sources.analysis_count}, wiadomości: ${sources.correspondence_count}. ${sources.approved_summary_current ? 'Uwzględniono aktualne zatwierdzone podsumowanie.' : 'Brak aktualnego zatwierdzonego podsumowania.'}`
      : null,
  };
}

// MARK: Rabat całej oferty (`OfferDetails`)

const DISCOUNT_SELECT = `id, status, sales_channel, logistics_enabled, logistics_price_net, totals_include_logistics, subtotal, discount_amount,
  discount_percent, tax_amount, tax_percent, total_amount, pricing_source, calculation_snapshot`;

export async function saveOfferDiscount(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id, DISCOUNT_SELECT);
  const base = getOfferPricingTotals(offer);
  if (base.source !== 'offer') fail('Rabat ustawia się dla oferty wycenianej z pozycji, nie z kalkulacji.');
  const mode = (['amount', 'percent', 'target'].includes(body.mode) ? body.mode : 'amount') as OfferDiscountMode;
  const preview = calculateOfferDiscount(base.listNet, base.taxPercent, mode, text(body.value));
  if (!preview) fail('Podaj kwotę od 0 do wartości oferty lub rabat od 0 do 100%.');
  const { net: _net, ...payload } = preview;
  const { data, error } = await ctx.supabase.from('offers').update({ ...payload, totals_include_logistics: true }).eq('id', id).select('id').maybeSingle();
  if (error) fail(error.message || 'Nie udało się zapisać rabatu');
  if (!data) fail('Nie masz uprawnień do zmiany tej oferty.');
  return offerDetail(ctx, id);
}

// MARK: Pozycje: kolejność, układ w PDF, warianty, usunięcie

async function offerItem(ctx: NativeContext, offer: string, item: unknown) {
  const itemId = uuid(item, 'Nieprawidłowa pozycja oferty.');
  const { data, error } = await ctx.supabase.from('offer_items').select('id, offer_id').eq('id', itemId).maybeSingle();
  if (error || !data || (data as Row).offer_id !== offer) fail('Nie znaleziono pozycji oferty.');
  return itemId;
}

export async function reorderOfferItems(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  await editable(ctx, id);
  const ids = (Array.isArray(body.itemIds) ? body.itemIds : []).map((item: unknown) => uuid(item, 'Nieprawidłowa pozycja oferty.'));
  const expected = (Array.isArray(body.expectedIds) ? body.expectedIds : []).map((item: unknown) => uuid(item, 'Nieprawidłowa pozycja oferty.'));
  if (!ids.length || ids.length !== expected.length) fail('Nieprawidłowa kolejność pozycji.');
  const { error } = await ctx.supabase.rpc('reorder_offer_items', { p_offer_id: id, p_item_ids: ids, p_expected_item_ids: expected });
  if (error) fail(error.message || 'Błąd podczas zmiany kolejności');
  return offerDetail(ctx, id);
}

/** Układ strony produktu w PDF i widoczność wariantów (jak przyciski i pola wyboru pozycji w CRM). */
export async function updateOfferItemPresentation(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  await editable(ctx, id);
  const itemId = await offerItem(ctx, id, body.itemId);
  const patch: Row = {};
  if (body.layout !== undefined) {
    if (!['compact', 'default', 'visual'].includes(body.layout)) fail('Nieprawidłowy układ.');
    patch.offer_page_variant_override = body.layout;
  }
  if (typeof body.showVariants === 'boolean') patch.show_product_variants_in_pdf = body.showVariants;
  if (typeof body.showVariantPrices === 'boolean') patch.show_variant_prices_in_pdf = body.showVariantPrices;
  if (!Object.keys(patch).length) fail('Brak zmian do zapisania.');
  const { data, error } = await ctx.supabase.from('offer_items').update(patch).eq('id', itemId).select('id').maybeSingle();
  if (error) fail(error.message || 'Nie udało się zmienić prezentacji pozycji');
  if (!data) fail('Nie masz uprawnień do zmiany tej oferty.');
  return offerDetail(ctx, id);
}

export async function deleteOfferItem(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  await editable(ctx, id);
  const itemId = await offerItem(ctx, id, body.itemId);
  const { data, error } = await ctx.supabase.from('offer_items').delete().eq('id', itemId).select('id');
  if (error) fail(error.message || 'Błąd podczas usuwania pozycji');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia tej pozycji.');
  return offerDetail(ctx, id);
}
