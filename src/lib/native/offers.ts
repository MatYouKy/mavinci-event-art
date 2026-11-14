import 'server-only';
import { createHash } from 'node:crypto';
import { can, type NativeContext } from './auth';
import { getOfferPricingTotals, roundMoney } from '@/lib/CRM/Offers/offerTotals';
import { offerSource } from '@/lib/CRM/Offers/offerSource';
import { resolveOfferSchedule } from '@/lib/CRM/Offers/offerSchedule';
import { offerNeedsTables } from '@/lib/CRM/Offers/audiencePricing';
import { normalizeEventAssumptionItems, syncGuestCountAssumptions } from '@/lib/CRM/Offers/eventAssumptions';
import { expandConfiguredItems, hasOfferAddons } from '@/lib/CRM/Offers/offerAddons';
import { getCalculationNumber } from '@/lib/CRM/calculations/calculationNumber';
import { offerPdfFileName } from '@/lib/CRM/Offers/offerPdfFileName';

/*
 * Oferty na Macu — lista `/crm/offers` i strona oferty `/crm/offers/[id]` (część A: odczyt, status, usuwanie, PDF do podglądu).
 * Te same zapytania i zasady co w CRM (RLS tokenem pracownika, `sales_can_manage_offer` przy zmianach); widok strony liczy
 * serwer tymi samymi funkcjami co CRM (`getOfferPricingTotals`, `resolveOfferSchedule`, założenia, dodatki pozycji).
 */

type Row = Record<string, any>;
const OFFER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fail(message: string): never {
  throw new Error(message);
}

/** Uprawnienia jak w menu CRM: podgląd `offers_view`, zarządzanie `offers_manage` (zmiany dodatkowo `sales_can_manage_offer`). */
export const offersAccess = (ctx: NativeContext) => ({
  canView: can(ctx.employee, 'offers_view') || can(ctx.employee, 'offers_manage'),
  canManage: can(ctx.employee, 'offers_manage'),
  isAdmin: ctx.employee.isAdmin,
});

const offerId = (value: unknown) => {
  const id = String(value || '');
  if (!OFFER_UUID.test(id)) fail('Nieprawidłowa oferta.');
  return id;
};

export const OFFER_STATUS_LABELS: Record<string, string> = {
  draft: 'Szkic', sent: 'Wysłana', accepted: 'Zaakceptowana', rejected: 'Odrzucona', expired: 'Wygasła',
};

const text = (value: unknown) => (value == null ? '' : String(value));
const fullName = (person: Row | null | undefined) =>
  text(person?.full_name) || [person?.first_name, person?.last_name].filter(Boolean).join(' ').trim();

/** Jak `normalize` w `matchesOfferSearch`: bez polskich znaków, małe litery. */
const normalize = (value: unknown) => text(value).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[łŁ]/g, 'l').toLowerCase().trim();

/** Klient na liście (jak `getClientName` w `OfferPage`). */
function clientName(offer: Row) {
  if (offer.organization?.name) return offer.organization.alias || offer.organization.name;
  if (offer.contact?.full_name) return offer.contact.full_name;
  if (offer.contact?.first_name || offer.contact?.last_name) return `${offer.contact.first_name || ''} ${offer.contact.last_name || ''}`.trim();
  const event = offer.event;
  if (event?.organization?.name) return event.organization.name;
  if (event?.contact?.first_name || event?.contact?.last_name) return `${event.contact.first_name || ''} ${event.contact.last_name || ''}`.trim();
  if (offer.client?.company_name) return offer.client.company_name;
  if (offer.client?.first_name || offer.client?.last_name) return `${offer.client.first_name || ''} ${offer.client.last_name || ''}`.trim();
  return 'Brak klienta';
}

/** Tekst i telefony do wyszukiwania (jak `matchesOfferSearch`: numer, tytuł, wydarzenie, strony oferty). */
function searchFields(offer: Row) {
  const parties = [offer.organization, offer.contact, offer.contact_person, offer.client, offer.event?.organization, offer.event?.contact]
    .flatMap((party) => (Array.isArray(party) ? party : party ? [party] : [])) as Row[];
  const search = normalize([offer.offer_number, offer.title, offer.event?.name,
    ...parties.flatMap((p) => [p.name, p.alias, p.company_name, p.full_name, p.first_name, p.last_name, p.email, p.phone, p.mobile])]
    .filter(Boolean).join(' '));
  const phones = parties.flatMap((p) => [p.phone, p.mobile]).filter(Boolean).map((p) => String(p).replace(/\D/g, '')).filter(Boolean);
  return { search, phones: Array.from(new Set(phones)) };
}

// MARK: Lista ofert (`getOffersData` w CRM)

const LIST_SELECT = `
  id, title, offer_number, event_id, inquiry_id, organization_id, contact_id, total_amount, valid_until, status, created_at, created_by,
  sales_channel, updated_at,
  logistics_enabled, logistics_price_net, totals_include_logistics, subtotal, discount_amount, discount_percent, tax_amount, tax_percent,
  pricing_source, calculation_snapshot,
  organization:organizations!organization_id(id, name, alias, email),
  contact:contacts!contact_id(id, full_name, first_name, last_name, company_name, email, phone, mobile),
  event:events!event_id(name, event_date, organization_id, contact_person_id),
  creator:employees!created_by(name, surname)`;

export async function offersState(ctx: NativeContext) {
  const access = offersAccess(ctx);
  const offers: Row[] = [];
  for (let offset = 0; ; offset += 250) {
    const { data, error } = await ctx.supabase.from('offers').select(LIST_SELECT)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 249);
    if (error) fail(error.message || 'Nie udało się pobrać ofert.');
    offers.push(...((data || []) as Row[]));
    if ((data || []).length < 250) break;
  }
  // Organizacja i osoba kontaktowa wydarzenia (jak drugi krok `getOffersData`).
  const orgIds = Array.from(new Set(offers.map((offer) => offer.event?.organization_id).filter(Boolean)));
  const contactIds = Array.from(new Set(offers.map((offer) => offer.event?.contact_person_id).filter(Boolean)));
  const [orgs, contacts] = await Promise.all([
    orgIds.length ? ctx.supabase.from('organizations').select('id, name, alias, email').in('id', orgIds) : Promise.resolve({ data: [], error: null }),
    contactIds.length
      ? ctx.supabase.from('contacts').select('id, full_name, first_name, last_name, company_name, email, phone, mobile').in('id', contactIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (orgs.error || contacts.error) fail('Nie udało się pobrać klientów ofert.');
  const orgMap = new Map(((orgs.data || []) as Row[]).map((row) => [row.id, row]));
  const contactMap = new Map(((contacts.data || []) as Row[]).map((row) => [row.id, row]));
  const items = offers.map((offer) => {
    if (offer.event?.organization_id && orgMap.has(offer.event.organization_id)) offer.event.organization = orgMap.get(offer.event.organization_id);
    if (offer.event?.contact_person_id && contactMap.has(offer.event.contact_person_id)) offer.event.contact = contactMap.get(offer.event.contact_person_id);
    const totals = getOfferPricingTotals(offer);
    return {
      id: offer.id as string,
      number: text(offer.offer_number),
      title: text(offer.title || offer.event?.name) || null,
      status: text(offer.status) || 'draft',
      client: clientName(offer),
      net: totals.net,
      gross: totals.gross,
      totalAmount: Number(offer.total_amount) || 0,
      validUntil: offer.valid_until || null,
      createdAt: offer.created_at || null,
      updatedAt: offer.updated_at || null,
      creator: [offer.creator?.name, offer.creator?.surname].filter(Boolean).join(' ') || null,
      eventId: offer.event_id || null,
      inquiryId: offer.inquiry_id || null,
      eventName: offer.event?.name || null,
      eventDate: offer.event?.event_date || null,
      seller: offer.sales_channel === 'seller_portal',
      ...searchFields(offer),
    };
  });
  const payload = { ...access, offers: items };
  const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { ...payload, hash };
}

// MARK: Strona oferty (`getOfferById` w CRM)

const VARIANT_FIELDS = `id, product_id, name, short_description, description, benefits, price_net, price_gross, is_recommended, is_active,
  display_order, quantity_source, offer_image_path, offer_image_alt`;

const DETAIL_SELECT = `
  *,
  organization:organizations!organization_id(id, name, alias, email),
  contact:contacts!contact_id(id, full_name, first_name, last_name, email, phone, mobile),
  contact_person:contacts!contact_id(id, full_name, first_name, last_name, email, phone, mobile),
  inquiry:tasks!inquiry_id(id, title, description, inquiry_details, due_date, event_id),
  event:events!event_id(
    id, name, event_date, location, financial_source, accepted_calculation_id,
    accepted_calculation:event_calculations!accepted_calculation_id(id, name, created_at, is_accepted, event_calculation_items(quantity, unit_price, days, vat_rate)),
    category:event_categories(id, name, default_offer_template_category_id),
    contact:contacts(email, first_name, last_name)
  ),
  last_generated_by_employee:employees!last_generated_by(id, name, surname),
  offer_items(
    id, offer_id, product_id, name, description, quantity, days, unit, unit_price, discount_percent, discount_amount, subtotal, total,
    display_order, product_variant_id, offer_page_variant_override, pricing_configuration, variant_prices_net,
    show_variant_prices_in_pdf, show_product_variants_in_pdf,
    product_variant:offer_product_variants!product_variant_id(${VARIANT_FIELDS}),
    product:offer_products(
      english_version, translation_revision, id, name, description, pdf_page_url, pdf_thumbnail_url, offer_image_path, offer_page_variant,
      pricing_addons, configuration_schema, sales_packages, sales_packages_enabled, quantity_source, product_page_url, offer_requirements,
      offer_additional_requirements,
      variants:offer_product_variants(${VARIANT_FIELDS})
    )
  )`;

async function signedUrls(ctx: NativeContext, bucket: string, paths: string[]) {
  const unique = Array.from(new Set(paths.filter((path) => path && !/^https?:\/\//i.test(path))));
  const urls = new Map<string, string>();
  if (!unique.length) return urls;
  const { data } = await ctx.supabase.storage.from(bucket).createSignedUrls(unique, 3600);
  (data || []).forEach((item: Row) => { if (item?.path && item?.signedUrl) urls.set(String(item.path), String(item.signedUrl)); });
  return urls;
}

/** Miejsce wydarzenia jak `resolvedEventLocation` w `OfferBasicInfo`. */
function eventLocation(offer: Row) {
  const location = offer.event?.location;
  const fromRelation = typeof location === 'string'
    ? location
    : location?.name || location?.formatted_address || location?.address
      || [location?.street, location?.postal_code, location?.city].filter(Boolean).join(' ');
  return text(offer.event_location || fromRelation || offer.inquiry?.inquiry_details?.location_text);
}

/** Pozycja oferty z układem w PDF i rozpisaniem dodatków (jak `OfferItems`). */
function itemView(item: Row, vatRate: number, thumbs: Map<string, string>) {
  const name = text(item.name).trim() || text(item.product?.name) || 'Pozycja oferty';
  const description = text(item.description).trim() || text(item.product?.description);
  const netValue = Number(item.total || 0);
  const catalogLayout = ['compact', 'visual'].includes(item.product?.offer_page_variant) ? item.product.offer_page_variant : 'default';
  const isStage = ['stage', 'warehouse_stage'].includes(item.pricing_configuration?.modular?.profile || '');
  const hasAddons = hasOfferAddons(item) || Boolean(item.pricing_configuration?.modular);
  const hasPackages = Boolean(item.pricing_configuration?.product_package?.options?.length
    || (item.product?.sales_packages_enabled && !item.product_variant_id && item.product?.sales_packages?.length));
  const blockedByElements = (Array.isArray(item.product?.variants) ? item.product.variants : []).some((variant: Row) => variant.is_active !== false);
  const requested = item.offer_page_variant_override || catalogLayout;
  const printLayout = isStage
    ? (requested === 'compact' ? 'compact' : 'default')
    : hasAddons || hasPackages || (blockedByElements && requested === 'compact') ? 'default' : requested;
  const hasProductVariants = !hasPackages && blockedByElements;
  const showsVariantComparison = !hasAddons && hasProductVariants && item.show_product_variants_in_pdf !== false;
  let addons: Row[] = [];
  if (hasOfferAddons(item) && !item.pricing_configuration?.modular) {
    try {
      addons = expandConfiguredItems([item]).map((row: Row) => ({
        id: String(row.id), name: text(row.name), quantity: Number(row.quantity) || 0, unit: text(row.unit), days: Number(row.days ?? 1) || 1,
        unitPrice: Number(row.unit_price) || 0, subtotal: Number(row.subtotal) || 0,
      }));
    } catch { addons = []; }
  }
  const imagePath = item.product_variant?.offer_image_path || item.product?.offer_image_path || item.product?.pdf_thumbnail_url || null;
  return {
    id: String(item.id),
    order: Number(item.display_order) || 0,
    productId: item.product_id || null,
    name,
    description,
    variantName: item.product_variant?.name || null,
    baseProduct: item.product?.name && item.product.name !== name ? name : null,
    quantity: Number(item.quantity) || 0,
    unit: text(item.unit) || 'szt.',
    days: Number(item.days ?? 1) || 1,
    unitPrice: Number(item.unit_price) || 0,
    unitGross: roundMoney((Number(item.unit_price) || 0) * (1 + vatRate / 100)),
    discountPercent: Number(item.discount_percent) || 0,
    discountAmount: Number(item.discount_amount) || 0,
    subtotal: Number(item.subtotal) || 0,
    net: netValue,
    gross: roundMoney(netValue * (1 + vatRate / 100)),
    imagePath,
    imageUrl: imagePath ? (/^https?:\/\//i.test(imagePath) ? imagePath : thumbs.get(imagePath) || null) : null,
    layout: {
      print: printLayout,
      stage: isStage,
      hasAddons,
      hasPackages,
      blockedByElements,
      hasProductVariants,
      showsVariantComparison,
      showVariants: !hasAddons && item.show_product_variants_in_pdf !== false,
      showVariantPrices: item.show_variant_prices_in_pdf !== false,
    },
    addons,
  };
}

/** Karty założeń jak widok `OfferAssumptionsSection` (znaczek, etykieta, opis). */
function assumptionsView(offer: Row) {
  const details = offer.inquiry?.inquiry_details || {};
  const legacy = text(offer.event_assumptions || details.event_assumptions || details.scope);
  const stored = Array.isArray(offer.event_assumption_items) && offer.event_assumption_items.some((item: Row) => text(item?.value).trim())
    ? offer.event_assumption_items : details.event_assumption_items;
  const guestCount = offer.guest_count ?? null;
  const items = syncGuestCountAssumptions(normalizeEventAssumptionItems(stored, legacy), guestCount)
    .filter((item) => item.value.trim() || item.badge_value?.trim());
  return {
    items: items.map((item, index) => {
      const explicit = item.badge_value?.trim() || '';
      const raw = item.value.trim();
      const valueAsBadge = !explicit && raw.length > 0 && raw.length <= 7 && !raw.includes('\n');
      return { key: item.key, badge: explicit || (valueAsBadge ? raw : String(index + 1).padStart(2, '0')), label: item.label, detail: valueAsBadge ? '' : raw };
    }),
    legacy: items.length ? '' : legacy,
    goal: text(offer.event_goal || details.event_goal),
    guestNote: guestCount != null && !items.some((item) => item.key === 'guest_count')
      ? `Liczba gości: ${guestCount}. Możesz wybrać „Liczba gości” w jednej z trzech kart — wartość uzupełni się automatycznie.` : null,
  };
}

/** Tabela „Podsumowanie” jak `OfferDetails` (pozycje, logistyka, rabat, razem). */
function summaryView(offer: Row) {
  const totals = getOfferPricingTotals(offer);
  const lineDiscounts = totals.source === 'offer'
    ? (offer.offer_items || []).reduce((sum: number, item: Row) => sum + Number(item.discount_amount || 0), 0) : 0;
  const listNet = totals.listNet + lineDiscounts;
  const logisticsNet = totals.source === 'offer' && offer.logistics_enabled ? roundMoney(Math.max(0, Number(offer.logistics_price_net) || 0)) : 0;
  const logisticsGross = roundMoney(logisticsNet * (1 + totals.taxPercent / 100));
  const itemsNet = roundMoney(listNet - logisticsNet);
  const discount = totals.discountAmount + lineDiscounts;
  const discountPercent = listNet > 0 ? discount / listNet * 100 : 0;
  const listGross = totals.hasMixedVatRates ? totals.gross : Math.round(listNet * (1 + totals.taxPercent / 100) * 100) / 100;
  const rows: Array<{ label: string; net: number; gross: number; emphasis?: boolean }> = [];
  if (logisticsNet > 0) {
    rows.push({ label: 'Pozycje oferty', net: itemsNet, gross: roundMoney(itemsNet * (1 + totals.taxPercent / 100)) });
    rows.push({ label: 'Logistyka', net: logisticsNet, gross: logisticsGross });
  }
  rows.push({ label: 'Razem przed rabatem', net: listNet, gross: listGross });
  if (discount > 0) rows.push({ label: `Rabat ${discountPercent.toFixed(2)}%`, net: -discount, gross: -(listGross - totals.gross) });
  rows.push({ label: discount > 0 ? 'Razem po rabacie' : 'Razem do zapłaty', net: totals.net, gross: totals.gross, emphasis: true });
  return {
    rows,
    vat: `Kwoty w PLN · VAT ${totals.hasMixedVatRates ? 'według stawek pozycji' : `${totals.taxPercent}%`}: ${totals.taxAmount.toFixed(2)} zł`,
    logisticsNote: logisticsNet > 0 ? 'Logistyka jest ujęta w sumie. Rabat od całej oferty obejmuje również jej cenę.' : null,
    calculation: totals.source === 'calculation',
    /** Podstawa rabatu całej oferty (jak edytor rabatu w `OfferDetails`). */
    discount: {
      listNet: totals.listNet, taxPercent: totals.taxPercent, amount: totals.discountAmount, percent: totals.discountPercent,
      logisticsNet,
    },
  };
}

export async function offerDetail(ctx: NativeContext, id: string) {
  const access = offersAccess(ctx);
  const key = offerId(id);
  const { data, error } = await ctx.supabase.from('offers').select(DETAIL_SELECT).eq('id', key).maybeSingle();
  if (error) fail(error.message || 'Nie udało się pobrać oferty.');
  if (!data) fail('Nie znaleziono oferty');
  const offer = data as Row;
  const [permission, history, amendment, calculation, english, draftRevision] = await Promise.all([
    ctx.supabase.rpc('sales_can_manage_offer', { p_offer: key }),
    ctx.supabase.from('offer_history').select('id, change_type, change_description, created_at, new_values, changed_by_employee:employees!changed_by(name, surname)')
      .eq('offer_id', key).order('created_at', { ascending: false }),
    ctx.supabase.from('offer_amendments').select('source_offer_id').eq('offer_id', key).maybeSingle(),
    offer.pricing_source === 'calculation' && offer.source_calculation_id && !offer.calculation_snapshot
      ? ctx.supabase.from('event_calculations').select('id, name, created_at').eq('id', offer.source_calculation_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Ostatni PDF w wersji angielskiej (jak `englishPdf` w `OfferActions`).
    ctx.supabase.from('offer_language_documents').select('file_path, file_name, source_revision').eq('offer_id', key).eq('language', 'en')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    // Szkic wcześniej zaakceptowanej oferty (`OfferDraftRevisionActions`).
    ctx.supabase.from('offer_draft_revisions').select('saved_revision').eq('offer_id', key).maybeSingle(),
  ]);
  const englishPdf = (english.data || null) as Row | null;
  const canManage = !permission.error && permission.data === true;
  const seller = offer.sales_channel === 'seller_portal';
  const items = ((offer.offer_items || []) as Row[]).slice()
    .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0) || String(a.id).localeCompare(String(b.id)));
  const thumbPaths = items.map((item) => item.product_variant?.offer_image_path || item.product?.offer_image_path || item.product?.pdf_thumbnail_url || '');
  const [thumbs, heroes] = await Promise.all([
    signedUrls(ctx, 'offer-product-pages', thumbPaths),
    signedUrls(ctx, 'offer-template-pages', [offer.hero_image_path || '']),
  ]);
  const vatRate = Number(offer.tax_percent ?? 23) || 0;
  const details = offer.inquiry?.inquiry_details || {};
  const totals = getOfferPricingTotals(offer);
  const schedule = resolveOfferSchedule(offer);

  // Strony oferty (jak `OfferBasicInfo`): typ klienta, kontakt, organizacja; oferta sprzedawcy — dane z portalu.
  const clientType = seller
    ? (offer.portal_client_company ? 'business' : 'individual')
    : offer.client_type === 'individual' ? 'individual'
      : offer.client_type === 'business' || offer.organization_id ? 'business' : offer.contact_id ? 'individual' : 'business';
  const contact = clientType === 'business'
    ? offer.contact_person || offer.contact || offer.event?.contact
    : offer.contact || offer.event?.contact;
  const inherited = text(offer.event?.name || text(offer.inquiry?.title).replace(/^Zapytanie:\s*/i, ''));
  const needsTables = offerNeedsTables(offer);
  const guestCount = offer.guest_count ?? null;
  const tables = needsTables && guestCount
    ? ` · stoły: ${offer.table_count ?? Math.ceil(guestCount / (offer.guests_per_table || 10))} (${offer.table_count ? 'ustawiono ręcznie' : `średnio ${offer.guests_per_table || 10} osób/stół`})`
    : '';
  const pricingCalculation = offer.calculation_snapshot || calculation.data;
  const source = offerSource(offer);

  // Kontakt do panelu „Kontekst zapytania” i nagłówka (jak strona oferty w CRM).
  const pageContact = offer.client_type === 'business'
    ? offer.contact_person || offer.contact || offer.event?.contact
    : offer.contact || offer.event?.contact;
  const pageClient = fullName(pageContact) || offer.organization?.alias || offer.organization?.name
    || [offer.event?.contact?.first_name, offer.event?.contact?.last_name].filter(Boolean).join(' ') || text(details.client_text);
  const pageEmail = text(pageContact?.email || offer.organization?.email || details.client_email);
  const pagePhone = text(pageContact?.mobile || pageContact?.phone || details.client_phone);
  const historyRows = ((history.data || []) as Row[]);
  const updatedAfterAcceptance = historyRows.find((row) => row.new_values?.in_place_update);

  return {
    ...access,
    canManage,
    /** Edycja treści w CRM: zarządzający ofertą, nie zaakceptowana, nie z portalu sprzedawcy. */
    canEdit: canManage && offer.status !== 'accepted' && !seller,
    offer: {
      id: key,
      number: text(offer.offer_number),
      title: text(offer.title || offer.event?.name || text(offer.inquiry?.title).replace(/^Zapytanie:\s*/i, '')).trim() || 'Bez tytułu',
      status: text(offer.status) || 'draft',
      seller,
      eventId: offer.event_id || null,
      inquiryId: offer.inquiry_id || null,
      updatedAt: offer.updated_at || null,
      createdAt: offer.created_at || null,
      validUntil: offer.valid_until || null,
      contentRevision: offer.content_revision ?? null,
    },
    source: source ? {
      kind: source.kind,
      id: source.kind === 'event' ? (offer.event_id || offer.inquiry?.event_id) : offer.inquiry_id,
      label: source.actionLabel,
    } : null,
    basic: {
      title: text(offer.title || inherited) || 'Bez tytułu',
      titleInherited: !offer.title && Boolean(inherited),
      clientType,
      organization: seller ? text(offer.portal_client_company) : text(offer.organization?.alias || offer.organization?.name),
      legalName: !seller && offer.organization?.alias && offer.organization?.name ? text(offer.organization.name) : null,
      contactName: seller ? text(offer.portal_client_name) : fullName(contact),
      contactEmail: text(seller ? offer.portal_client_email : contact?.email) || null,
      contactPhone: text(seller ? offer.portal_client_phone : contact?.mobile || contact?.phone) || null,
      sellerDescription: seller ? text(offer.description) || null : null,
      eventLabel: offer.event?.name || text(offer.inquiry?.title).replace(/^Zapytanie:\s*/i, '')
        || (seller ? 'Samodzielna oferta sprzedawcy — bez powiązanego wydarzenia CRM' : '-'),
      audience: `Liczba osób: ${guestCount ?? 'Nie ustalono'}${tables}`,
      guestCount,
      pricingSource: offer.pricing_source === 'calculation' ? 'Zaakceptowana kalkulacja' : 'Pozycje oferty',
      calculation: offer.pricing_source === 'calculation' && pricingCalculation?.id
        ? `${getCalculationNumber(pricingCalculation.id, pricingCalculation.created_at)} — ${text(pricingCalculation.name)}` : null,
      hero: seller && offer.partner_branding_snapshot?.hotel_cover_image_url ? 'Okładka z profilu sprzedawcy'
        : offer.hero_image_path ? 'Indywidualna grafika tej oferty' : 'Domyślna grafika szablonu',
      heroPath: offer.hero_image_path || null,
      heroUrl: offer.hero_image_path ? heroes.get(offer.hero_image_path) || null : null,
      heroAlt: text(offer.hero_image_alt) || null,
      start: schedule.startLabel || 'Nie ustalono',
      end: schedule.endLabel || 'Nie ustalono',
      location: eventLocation(offer) || '-',
      totals: {
        gross: totals.gross, net: totals.net, discountAmount: totals.discountAmount, discountPercent: totals.discountPercent,
        taxAmount: totals.taxAmount, taxPercent: totals.taxPercent, mixedVat: totals.hasMixedVatRates,
      },
      lastGenerated: offer.last_generated_by && offer.last_generated_at ? {
        name: `${text(offer.last_generated_by_employee?.name)} ${text(offer.last_generated_by_employee?.surname) || 'Nieznany'}`.trim(),
        at: offer.last_generated_at,
      } : null,
      notes: text(offer.notes) || null,
    },
    assumptions: assumptionsView(offer),
    vatRate,
    items: items.map((item) => itemView(item, vatRate, thumbs)),
    summary: summaryView(offer),
    history: historyRows.map((row) => ({
      id: String(row.id),
      type: text(row.change_type),
      description: text(row.change_description),
      at: row.created_at || null,
      author: row.changed_by_employee ? `${text(row.changed_by_employee.name)} ${text(row.changed_by_employee.surname)}`.trim() : null,
    })),
    updatedAfterAcceptance: updatedAfterAcceptance?.created_at || null,
    inquiry: offer.inquiry ? {
      id: offer.inquiry.id,
      title: text(offer.inquiry.title).replace(/^Zapytanie:\s*/i, '') || text(offer.title) || 'Zapytanie',
      message: text(details.source_message_content || offer.inquiry.description).trim() || null,
      source: text(details.source || details.source_name) || 'Zapytanie',
      client: pageClient || null,
      email: pageEmail || null,
      phone: pagePhone || null,
      receivedEmailId: details.received_email_id || null,
      contactMessageId: details.received_email_id ? null : details.source_message_id || null,
      items: [
        { label: 'Termin', value: text(details.termin || offer.inquiry.due_date || offer.event?.event_date), kind: 'date' },
        { label: 'Miejsce', value: text(details.location_text || (typeof offer.event?.location === 'string' ? offer.event.location : '')), kind: 'location' },
        { label: 'Zakres', value: text(details.scope || details.event_type), kind: 'scope' },
      ].filter((item) => item.value),
    } : null,
    client: { name: pageClient || null, email: pageEmail || null, phone: pagePhone || null },
    pdf: {
      exists: Boolean(offer.generated_pdf_url),
      stale: offer.modified_after_generation === true,
      fileName: offerPdfFileName(offer.offer_number),
      en: {
        exists: Boolean(englishPdf?.file_path),
        stale: Boolean(englishPdf?.file_path) && Number(englishPdf?.source_revision) !== Number(offer.content_revision),
        fileName: text(englishPdf?.file_name) || offerPdfFileName(offer.offer_number).replace(/\.pdf$/i, '-EN.pdf'),
      },
    },
    amendmentSource: amendment.data?.source_offer_id || null,
    draftRevision: draftRevision.data ? { savedRevision: (draftRevision.data as Row).saved_revision ?? null } : null,
  };
}

// MARK: Zmiany (część A): status, usunięcie, PDF do podglądu

async function requireManage(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.rpc('sales_can_manage_offer', { p_offer: id });
  if (error || data !== true) fail('Nie masz uprawnień do zmiany tej oferty.');
}

/**
 * Status jak lista „Status oferty” w CRM. Akceptacja ma osobną ścieżkę (zapytanie → akceptacja wariantu, wydarzenie → rezerwacja
 * sprzętu), więc tu przyjmujemy tylko szkic, wysłaną, odrzuconą i wygasłą.
 */
export async function setOfferStatus(ctx: NativeContext, body: Row) {
  const id = offerId(body.id);
  const status = String(body.status || '');
  if (!['draft', 'sent', 'rejected', 'expired'].includes(status)) fail('Akceptację oferty wykonaj w zapytaniu lub przyciskiem rezerwacji sprzętu.');
  await requireManage(ctx, id);
  const { data: current, error: readError } = await ctx.supabase.from('offers').select('id, sales_channel').eq('id', id).maybeSingle();
  if (readError || !current) fail('Nie znaleziono oferty.');
  if ((current as Row).sales_channel === 'seller_portal') fail('Status oferty sprzedawcy zmienia się w obsłudze oferty z portalu.');
  const { data, error } = await ctx.supabase.from('offers').update({ status }).eq('id', id).select('id').maybeSingle();
  if (error) fail(error.message || 'Błąd podczas zmiany statusu');
  if (!data) fail('Nie masz uprawnień do zmiany tej oferty.');
  return offerDetail(ctx, id);
}

/** Usunięcie jak `deleteOfferWithFiles`: najpierw wiersz (odmowa nie może usunąć plików), potem PDF i pliki wydarzenia. */
export async function deleteOffer(ctx: NativeContext, body: Row) {
  const id = offerId(body.id);
  const { data: offer, error: readError } = await ctx.supabase.from('offers').select('generated_pdf_url, inquiry_id, status, sales_channel').eq('id', id).single();
  if (readError || !offer) fail('Nie znaleziono oferty.');
  const row = offer as Row;
  if (row.sales_channel === 'seller_portal') fail('Oferty z portalu sprzedawcy nie usuwa się w CRM.');
  await requireManage(ctx, id);
  const { data: versions, error: versionsError } = await ctx.supabase.from('sales_document_files').select('id').eq('offer_id', id).limit(1);
  if (versionsError) fail(versionsError.message);
  if (row.status === 'accepted' || (row.inquiry_id && versions?.length)) {
    fail('Zachowujemy ofertę i historię dokumentów. Możesz odrzucić wariant lub utworzyć jego kopię.');
  }
  const { data: files, error: filesError } = await ctx.supabase.from('event_files').select('file_path').eq('offer_id', id);
  if (filesError) fail(filesError.message);
  const { error: deleteError } = await ctx.supabase.from('offers').delete().eq('id', id).select('id').single();
  if (deleteError) fail(deleteError.message || 'Nie udało się usunąć oferty.');
  if (row.generated_pdf_url) await ctx.supabase.storage.from('generated-offers').remove([row.generated_pdf_url]);
  const paths = ((files || []) as Row[]).map((file) => file.file_path).filter(Boolean);
  if (paths.length) await ctx.supabase.storage.from('event-files').remove(paths);
  return { ok: true };
}

/** Zapisany PDF oferty (PL) — podpisany adres na godzinę i nazwa pliku do pobrania (jak „Pokaż / Pobierz PDF”). */
/** Zapisany PDF oferty: polski (`generated_pdf_url`) albo ostatni angielski (`offer_language_documents`). */
export async function offerPdf(ctx: NativeContext, id: string, language: string | null = 'pl') {
  const key = offerId(id);
  const { data, error } = await ctx.supabase.from('offers').select('offer_number, generated_pdf_url').eq('id', key).maybeSingle();
  if (error || !data) fail('Nie znaleziono oferty.');
  const row = data as Row;
  let path = text(row.generated_pdf_url);
  let name = offerPdfFileName(row.offer_number);
  if (language === 'en') {
    const { data: english } = await ctx.supabase.from('offer_language_documents').select('file_path, file_name').eq('offer_id', key).eq('language', 'en')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    path = text((english as Row | null)?.file_path);
    name = text((english as Row | null)?.file_name) || name.replace(/\.pdf$/i, '-EN.pdf');
  }
  if (!path) fail('Oferta nie ma jeszcze wygenerowanego PDF.');
  const { data: link, error: linkError } = await ctx.supabase.storage.from('generated-offers').createSignedUrl(path, 3600);
  if (linkError || !link?.signedUrl) fail('Nie udało się pobrać PDF');
  return { url: link.signedUrl, name };
}

/**
 * „Usuń PDF” jak `deleteOfferPdfFiles`: tylko pliki (oferta zostaje) — główny PDF, kopie w plikach wydarzenia, wpisy
 * `event_files` i znacznik pliku w ofercie. Gdy oferta ma zapisane wersje dokumentów, pliki zostają.
 */
export async function deleteOfferPdf(ctx: NativeContext, body: Row) {
  const id = offerId(body.id);
  await requireManage(ctx, id);
  const { data: versions, error: historyError } = await ctx.supabase.from('sales_document_files').select('id').eq('offer_id', id).limit(1);
  if (historyError) fail(historyError.message || 'Błąd podczas usuwania plików PDF');
  if (versions?.length) fail('Zachowujemy zapisane wersje dokumentów. Wygeneruj nową wersję PDF.');
  const { data: offer } = await ctx.supabase.from('offers').select('generated_pdf_url').eq('id', id).maybeSingle();
  const main = text((offer as Row | null)?.generated_pdf_url);
  if (main) await ctx.supabase.storage.from('generated-offers').remove([main]);
  const { data: files } = await ctx.supabase.from('event_files').select('file_path').eq('offer_id', id).eq('document_type', 'offer');
  const paths = ((files || []) as Row[]).map((file) => text(file.file_path)).filter(Boolean);
  if (paths.length) await ctx.supabase.storage.from('event-files').remove(paths);
  await ctx.supabase.from('event_files').delete().eq('offer_id', id).eq('document_type', 'offer');
  const { error } = await ctx.supabase.from('offers').update({ generated_pdf_url: null, modified_after_generation: false }).eq('id', id);
  if (error) fail(error.message || 'Błąd podczas usuwania plików PDF');
  return offerDetail(ctx, id);
}

/**
 * Angielska treść oferty (`translate-offer`, jak `requestOfferEnglish`): `read` — zapisane tłumaczenie, `generate` — tłumaczenie
 * brakujących tekstów (do 3 minut). Podpis potwierdza, że PDF EN powstanie z tej wersji treści.
 */
export async function offerEnglish(ctx: NativeContext, body: Row) {
  const id = offerId(body.id);
  const action = body.action === 'generate' ? 'generate' : 'read';
  const { data, error } = await ctx.supabase.functions.invoke('translate-offer', { body: { offerId: id, action } });
  let message = (data as Row | null)?.error as string | undefined;
  if (error && !message) {
    try { message = (await (error as any).context?.json())?.error; } catch { /* komunikat zastępczy */ }
  }
  if (error || message) fail(message || 'Nie udało się przygotować angielskiej treści oferty.');
  const row = (data || {}) as Row;
  if (typeof row.ready !== 'boolean') fail('Nieprawidłowa odpowiedź usługi tłumaczenia.');
  return { ready: row.ready, signature: row.ready ? text(row.signature) || null : null };
}
