import 'server-only';
import { can, type NativeContext } from './auth';
import { fail } from './offers';
import { activeVariants, addonOf, draftOf, evaluate, optionsFor, problem, productPackages, unitOf } from './offerItems';
import { configurationNeedsTables, audienceTables, resolveAudienceConfiguration, type OfferAudience } from '@/lib/CRM/Offers/audiencePricing';
import { validateConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { formatEventAssumptionItems, normalizeEventAssumptionItems } from '@/lib/CRM/Offers/eventAssumptions';
import { productConfigurationSnapshot } from '@/lib/CRM/Offers/modularProduct';
import { productReadiness, READINESS_CHECK_SHORT, type ProductReadiness } from '@/lib/CRM/Offers/productReadiness';
import { applySeasonPrices, loadSeasonPrices, seasonPriceNotice, seasonVariantPrices } from '@/lib/CRM/Offers/seasonPrices';
import { productCategoryIds } from '@/lib/CRM/Offers/productCategories';

/*
 * Oferty na Macu, część E — kreator nowej oferty jak `OfferWizard` w CRM: wybór wydarzenia (lista „Wybierz event dla oferty”),
 * klient (organizacja albo osoba prywatna, „Dodaj nowego klienta”), dane podstawowe z wydarzenia, katalog produktów z pakietami
 * i wariantami, pozycje własne, cena docelowa i rabat, braki sprzętu w terminie (`check_offer_cart_equipment_conflicts_v2`)
 * oraz gotowość produktów do oferty (`productReadiness` — ta sama reguła co katalog i karta produktu). Mac trzyma szkic
 * kreatora; wycenę pozycji liczą funkcje z `offerItems.ts` (`evaluate`, jak okna pozycji CRM), a zapis odtwarza
 * `submitOfferWizard` (oferta, pozycje, podsumowanie z dokładnym rabatem, znacznik braków sprzętu w wydarzeniu).
 * Produkty z konfiguratorem (scena, LED): pozycja niesie konfigurację z `op=modular` (`modularConfigurator.ts`).
 * Cennik sezonowy (`seasonPrices.ts`): katalog kreatora ma ceny z cennika marki eventu na sezon daty eventu; nowa oferta
 * zapamiętuje cennik (`price_list_id`, gwarancja ceny), a pozycje — ceny wariantów z cennika.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message: string) => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const THUMBNAIL_BUCKET = 'offer-product-pages';
const TAX_PERCENT = 23;

/** Kreator jak polityki wstawiania ofert: oferty, wydarzenia albo własne wydarzenia (o konkretnym wydarzeniu decyduje RLS). */
export const canCreateOffers = (ctx: NativeContext) =>
  ['offers_manage', 'events_manage', 'events_create'].some((scope) => can(ctx.employee, scope));

const requireCreate = (ctx: NativeContext) => {
  if (!canCreateOffers(ctx)) fail('Nie masz uprawnień do tworzenia ofert.');
};

// MARK: Wybór wydarzenia

/** „Nowa oferta” na liście ofert (`handleNewOffer`): wydarzenia od najnowszych z nazwą klienta. */
export async function offerWizardEvents(ctx: NativeContext) {
  requireCreate(ctx);
  const { data, error } = await ctx.supabase.from('events')
    .select('id, name, event_date, client_type, organization_id, contact_person_id')
    .order('event_date', { ascending: false });
  if (error) fail(error.message || 'Błąd pobierania eventów');
  const rows = (data || []) as Row[];
  const orgIds = Array.from(new Set(rows.map((row) => row.organization_id).filter(Boolean)));
  const contactIds = Array.from(new Set(rows.map((row) => row.contact_person_id).filter(Boolean)));
  const [orgs, contacts] = await Promise.all([
    orgIds.length ? ctx.supabase.from('organizations').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] }),
    contactIds.length ? ctx.supabase.from('contacts').select('id, full_name, first_name, last_name').in('id', contactIds) : Promise.resolve({ data: [] }),
  ]);
  const orgById = new Map(((orgs.data || []) as Row[]).map((row) => [row.id, row]));
  const contactById = new Map(((contacts.data || []) as Row[]).map((row) => [row.id, row]));
  return {
    events: rows.map((row) => {
      const contact = contactById.get(row.contact_person_id);
      const individual = text(contact?.full_name) || [contact?.first_name, contact?.last_name].filter(Boolean).join(' ');
      return {
        id: String(row.id),
        name: text(row.name),
        date: row.event_date || null,
        client: row.client_type === 'individual'
          ? individual || 'Brak klienta indywidualnego'
          : text(orgById.get(row.organization_id)?.name) || individual || 'Brak klienta',
      };
    }),
  };
}

// MARK: Dane kreatora

export const WIZARD_PRODUCT_SELECT = `*, category:event_categories(id, name),
  variants:offer_product_variants(id, name, short_description, description, price_net, price_gross, is_recommended, is_active,
    display_order, quantity_source, overrides_contract_clauses, recommended_contract_clauses),
  equipment:offer_product_equipment(id), staff:offer_product_staff(hourly_rate, estimated_hours, compensation, is_optional)`;

/** Gotowość z zasobami z katalogu (sprzęt, obsada) — jak `readinessOf` w katalogu CRM i w kreatorze. */
const readinessOf = (row: Row): ProductReadiness => productReadiness(
  row,
  Array.isArray(row.equipment) ? { equipmentCount: row.equipment.length, staff: Array.isArray(row.staff) ? row.staff : [] } : null,
);
const readinessView = (readiness: ProductReadiness) => ({
  ready: readiness.ready,
  summary: readiness.ready
    ? 'Gotowy do oferty'
    : `Braki: ${Array.from(new Set(readiness.missing.map((check) => READINESS_CHECK_SHORT[check.key]))).join(', ')}`,
  groups: readiness.groups.map((group) => ({ key: group.key, label: group.label, short: group.short, ok: group.ok })),
});

const thumbnailPath = (value: unknown) => {
  const raw = text(value).trim();
  if (!raw || /^(?:https?:|data:|blob:)/i.test(raw)) return raw;
  return raw.replace(/^\/+/, '').replace(new RegExp(`^(?:public/)?${THUMBNAIL_BUCKET}/`), '');
};

async function signedThumbnails(ctx: NativeContext, rows: Row[]) {
  const paths = Array.from(new Set(rows.map((row) => thumbnailPath(row.pdf_thumbnail_url || row.offer_image_path))
    .filter((path) => path && !/^(?:https?:|data:|blob:)/i.test(path))));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await ctx.supabase.storage.from(THUMBNAIL_BUCKET).createSignedUrls(paths, 3600);
    (data || []).forEach((item: Row) => { if (item?.path && item?.signedUrl) urls.set(String(item.path), String(item.signedUrl)); });
  }
  return (row: Row) => {
    const path = thumbnailPath(row.pdf_thumbnail_url || row.offer_image_path);
    if (!path) return null;
    return /^(?:https?:|data:|blob:)/i.test(path) ? path : urls.get(path) || null;
  };
}

/** Dodatek produktu z pełnym zestawem pól (Mac dekoduje liczby — brakujące wartości jako 0). */
const addonView = (raw: Row) => {
  const addon = addonOf(raw || {}) as Row;
  const finite = (value: unknown) => (Number.isFinite(value) ? Number(value) : 0);
  return { ...addon, included_quantity: finite(addon.included_quantity), quantity: finite(addon.quantity), unit_price: finite(addon.unit_price) };
};

const productView = (row: Row, imageUrl: string | null) => {
  const category = Array.isArray(row.category) ? row.category[0] : row.category;
  const packages = row.configuration_schema ? [] : productPackages(row);
  return {
    id: String(row.id),
    name: text(row.name),
    categoryId: row.category_id ?? null,
    /** Kategoria główna i dodatkowe — filtr kategorii katalogu kreatora. */
    categoryIds: productCategoryIds(row),
    category: text(category?.name) || null,
    description: text(row.description),
    offerDescription: text(row.offer_description || row.description),
    unit: text(row.unit) || 'szt.',
    basePrice: Number(row.base_price) || 0,
    vatRate: Number(row.vat_rate ?? TAX_PERCENT),
    imageUrl,
    modular: Boolean(row.configuration_schema),
    quantitySource: row.quantity_source || 'manual',
    packagesEnabled: row.sales_packages_enabled === true,
    variants: row.configuration_schema ? [] : activeVariants(row).map((variant) => ({
      id: String(variant.id),
      name: text(variant.name),
      priceNet: Number(variant.price_net) || 0,
      priceGross: variant.price_gross == null ? null : Number(variant.price_gross),
      recommended: variant.is_recommended === true,
      quantitySource: variant.quantity_source || null,
      description: text(variant.description || variant.short_description || row.description),
    })),
    // Pełne pakiety do zmian tylko w tej ofercie (sprzęt i obsada, koszty — jak edytory w kroku katalogu CRM).
    packageOptions: packages,
    packages: packages.map((option) => ({
      id: String(option.id),
      name: text(option.name),
      included: text(option.included_label),
      bonus: text(option.bonus),
      priceNet: Number(option.price_net) || 0,
      priceOnRequest: option.price_on_request === true,
      includeProductAddons: option.include_product_addons === true,
    })),
    addons: (Array.isArray(row.pricing_addons) ? row.pricing_addons : []).slice(0, 40).map(addonView),
    readiness: readinessView(readinessOf(row)),
  };
};

/**
 * Otwarcie kreatora dla wydarzenia: dane wydarzenia (jak wczytanie w `OfferWizard`), klient z wydarzenia i krok startowy,
 * listy organizacji i osób prywatnych, kategorie i aktywne produkty z gotowością do oferty.
 */
export async function offerWizardSetup(ctx: NativeContext, eventId: string) {
  requireCreate(ctx);
  const id = uuid(eventId, 'Nie znaleziono eventu.');
  const { data: event, error } = await ctx.supabase.from('events').select(`
    id, name, description, event_date, event_end_date, location, location_id,
    client_type, organization_id, contact_person_id,
    locations(name, city, postal_code, formatted_address, address), event_categories(name)
  `).eq('id', id).maybeSingle();
  if (error || !event) fail('Nie udało się pobrać danych eventu. Spróbuj ponownie, aby uzupełnić ofertę zapisanymi informacjami.');
  const row = event as Row;
  const venue = Array.isArray(row.locations) ? row.locations[0] : row.locations;
  const location = venue
    ? [venue.name, venue.city, venue.postal_code].filter(Boolean).join(', ') || venue.formatted_address || venue.address || ''
    : '';
  const clientType = row.client_type || (row.organization_id ? 'business' : row.contact_person_id ? 'individual' : 'business');
  const initialStep = (clientType === 'business' ? row.organization_id : clientType === 'individual' ? row.contact_person_id : null) ? 2 : 1;

  const [orgs, contacts, categories, products, season] = await Promise.all([
    ctx.supabase.from('organizations').select('id, name, nip, email, phone').order('name'),
    ctx.supabase.from('contacts').select('id, first_name, last_name, full_name, email, phone').eq('contact_type', 'individual').order('last_name'),
    ctx.supabase.from('event_categories').select('id, name').eq('is_active', true).order('order_index'),
    ctx.supabase.from('offer_products').select(WIZARD_PRODUCT_SELECT).eq('is_active', true).order('display_order'),
    loadSeasonPrices(ctx.supabase, { eventId: id }),
  ]);
  if (products.error) fail('Błąd podczas ładowania produktów');
  const productRows = applySeasonPrices((products.data || []) as Array<Row & { id: string }>, season);
  const imageOf = await signedThumbnails(ctx, productRows);
  const description = text(row.description);
  return {
    event: {
      id: String(row.id),
      name: text(row.name),
      startsAt: row.event_date || null,
      endsAt: row.event_end_date || null,
      category: text((Array.isArray(row.event_categories) ? row.event_categories[0] : row.event_categories)?.name) || null,
    },
    clientType,
    organizationId: row.organization_id || '',
    contactId: row.contact_person_id || '',
    initialStep,
    location: location || (typeof row.location === 'string' ? row.location : ''),
    hasDescription: description.trim().length > 0,
    taxPercent: TAX_PERCENT,
    /** „Cennik: Wesela 2027” nad katalogiem (ceny produktów już z cennika) — `null`, gdy cennik nie dotyczy. */
    priceNotice: seasonPriceNotice(season, 'wizard'),
    organizations: ((orgs.data || []) as Row[]).map((org) => ({
      id: String(org.id), name: text(org.name), nip: text(org.nip), email: text(org.email), phone: text(org.phone),
    })),
    contacts: ((contacts.data || []) as Row[]).map((contact) => ({
      id: String(contact.id),
      name: text(contact.full_name) || [contact.first_name, contact.last_name].filter(Boolean).join(' '),
      email: text(contact.email), phone: text(contact.phone),
    })),
    categories: ((categories.data || []) as Row[]).map((category) => ({ id: String(category.id), name: text(category.name) })),
    products: productRows.map((product) => productView(product, imageOf(product))),
  };
}

/** „Dodaj nowego klienta” (osoba prywatna) w pierwszym kroku kreatora. */
export async function addOfferWizardContact(ctx: NativeContext, body: Row) {
  requireCreate(ctx);
  const first = text(body.firstName).trim().slice(0, 120);
  const last = text(body.lastName).trim().slice(0, 120);
  const email = text(body.email).trim().slice(0, 200);
  const phone = text(body.phone).trim().slice(0, 50);
  if (!first || !last) fail('Podaj imię i nazwisko klienta.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Podaj poprawny adres e-mail.');
  const { data, error } = await ctx.supabase.from('contacts')
    .insert([{ first_name: first, last_name: last, email: email || null, phone: phone || null, contact_type: 'individual' }])
    .select('id, full_name, first_name, last_name, email, phone').single();
  if (error || !data) fail('Wystąpił błąd podczas dodawania klienta');
  const contact = data as Row;
  return {
    contact: {
      id: String(contact.id),
      name: text(contact.full_name) || [contact.first_name, contact.last_name].filter(Boolean).join(' '),
      email: text(contact.email), phone: text(contact.phone),
    },
  };
}

// MARK: Wycena szkicu

export const audienceFrom = (body: Row): OfferAudience => {
  const raw = body.audience && typeof body.audience === 'object' ? body.audience as Row : {};
  const value = (input: unknown) => (input == null || input === '' ? null : Number(input));
  return { guest_count: value(raw.guestCount), guests_per_table: Number(raw.guestsPerTable ?? 10) || 10, table_count: value(raw.tableCount) };
};

const AUDIENCE_ERROR = 'Uzupełnij liczbę osób i poprawne ustawienia stołów w szczegółach oferty.';

export type Evaluated = {
  key: string;
  productId: string | null;
  product: Row | null;
  name: string;
  description: string;
  unit: string;
  quantity: number;
  days: number;
  baseUnitPrice: number;
  unitPrice: number;
  discountPercent: number;
  subtotal: number;
  configuration: Row | null;
  variantId: string | null;
  showVariants: boolean;
  showVariantPrices: boolean;
  needsTables: boolean;
  audienceRequired: boolean;
  /** Komunikat do podglądu (pod pozycją). */
  error: string | null;
  /** Komunikat przy tworzeniu (jak `submitOfferWizard`). */
  submitError: string | null;
};

/** Wycena pozycji szkicu (kreator, a także „Oferta ze spotkania” w Prezentacjach — `src/lib/showcase/showcaseOffer.server.ts`). */
export async function evaluateItems(ctx: NativeContext, body: Row, audience: OfferAudience) {
  const raw = (Array.isArray(body.items) ? body.items : []).slice(0, 200) as Row[];
  const ids = Array.from(new Set(raw.map((item) => text(item.productId)).filter((id) => UUID.test(id))));
  const products = new Map<string, Row>();
  if (ids.length) {
    const { data, error } = await ctx.supabase.from('offer_products').select(WIZARD_PRODUCT_SELECT).in('id', ids);
    if (error) fail('Błąd podczas ładowania produktów');
    ((data || []) as Row[]).forEach((row) => products.set(String(row.id), row));
  }
  const keys = new Set<string>();
  return raw.map((item, index): Evaluated => {
    let key = text(item.key).slice(0, 80) || `item-${index}`;
    if (keys.has(key)) key = `${key}-${index}`;
    keys.add(key);
    const draft = draftOf(item.draft);
    const name = text(item.name).trim().slice(0, 300);
    const description = text(item.description).slice(0, 4000);
    const days = draft.days;
    const productId = UUID.test(text(item.productId)) ? text(item.productId) : null;
    if (!productId) {
      // Pozycja własna („Dodaj pozycję” w ostatnim kroku): ilość × dni × cena, bez konfiguracji.
      const quantity = Number.isFinite(draft.quantity) ? draft.quantity : 0;
      const price = Number.isFinite(draft.unitPrice) ? draft.unitPrice : 0;
      const error = !name ? 'Podaj nazwę pozycji.'
        : !Number.isInteger(days) || days < 1 || days > 3650 ? 'Podaj liczbę dni od 1 do 3650.'
          : quantity <= 0 ? 'Ilość musi być większa od 0'
            : price < 0 ? 'Cena nie może być ujemna' : null;
      return {
        key, productId: null, product: null, name, description, unit: text(item.unit).trim().slice(0, 20) || 'szt',
        quantity, days: Number.isFinite(days) ? days : 1, baseUnitPrice: price, unitPrice: price, discountPercent: 0,
        subtotal: quantity * (Number.isFinite(days) ? days : 1) * price, configuration: null, variantId: null,
        showVariants: true, showVariantPrices: true, needsTables: false, audienceRequired: false, error, submitError: error ? `${name || 'Pozycja'}: ${error}` : null,
      };
    }
    const product = products.get(productId) || null;
    if (!product || product.is_active === false) {
      const error = 'Produkt nie jest już dostępny w katalogu.';
      return {
        key, productId, product: null, name: name || 'Produkt', description, unit: 'szt.', quantity: 0, days: 1, baseUnitPrice: 0, unitPrice: 0,
        discountPercent: 0, subtotal: 0, configuration: null, variantId: null, showVariants: true, showVariantPrices: true,
        needsTables: false, audienceRequired: false, error, submitError: `${name || 'Produkt'}: ${error}`,
      };
    }
    // Produkt z konfiguratorem: konfiguracja z Maca (bez niej — świeża z karty produktu, kalkulator poprosi o pobranie
    // sprzętu); zwykły produkt nigdy nie dostaje konfiguracji modułowej.
    if (product.configuration_schema) {
      draft.modular ||= productConfigurationSnapshot(product.configuration_schema);
      draft.variantId = null;
      draft.packageId = '';
    } else {
      draft.modular = null;
    }
    const variant = activeVariants(product).find((row) => row.id === draft.variantId) || null;
    const options = optionsFor(draft, productPackages(product));
    const result = evaluate({ ...draft, variantId: variant?.id || null, discountPercent: Number.isFinite(draft.discountPercent) ? draft.discountPercent : 0 }, options, audience);
    let error = problem(draft, result);
    let submitError: string | null = null;
    if (result.audienceError) {
      error = 'Podaj liczbę osób (i ustawienia stołów) powyżej — ta pozycja liczy się na osobę lub stół.';
      submitError = `${name || text(product.name)}: ${AUDIENCE_ERROR}`;
    } else if (draft.variantId && !variant) {
      error = 'Wybierz wariant produktu.';
    }
    if (error && !submitError) submitError = `${name || text(product.name)}: ${error}`;
    const quantity = Number.isFinite(result.quantity) ? result.quantity : 0;
    const safeDays = Number.isFinite(days) ? days : 1;
    const discount = Number.isFinite(draft.discountPercent) ? draft.discountPercent : 0;
    return {
      key, productId, product,
      name: name || text(product.name),
      description,
      unit: unitOf(draft, result.selectedPackage, text(product.unit)),
      quantity,
      days: safeDays,
      baseUnitPrice: Number(result.configuration.base_unit_price) || 0,
      unitPrice: Number.isFinite(result.price) ? result.price : 0,
      discountPercent: discount,
      // Jak `calcSubtotal` w kreatorze CRM (bez zaokrąglenia — suma pozycji liczy się z dokładnych wartości).
      subtotal: quantity * safeDays * (Number.isFinite(result.price) ? result.price : 0) * (1 - discount / 100),
      configuration: result.configuration as Row,
      variantId: result.selectedPackage ? null : variant?.id || null,
      // Konfiguracja zestawu ma w PDF pełną stronę bez wariantów (jak `addProduct` w kreatorze CRM).
      showVariants: draft.modular ? false : draft.showVariants,
      showVariantPrices: draft.modular ? false : draft.showVariantPrices,
      needsTables: configurationNeedsTables(result.configuration),
      audienceRequired: result.audienceRequired,
      error,
      submitError,
    };
  });
}

/** Cena docelowa i rabat całej oferty (jak `pricing` w `useOfferWizardLogic`). */
export function pricingOf(items: Evaluated[], target: unknown) {
  const listNet = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  const raw = target == null ? '' : String(target).trim().replace(',', '.');
  const parsed = raw === '' ? listNet : Number(raw);
  const targetNet = cents(Number.isFinite(parsed) ? Math.min(listNet, Math.max(0, parsed)) : listNet);
  const discountAmount = cents(listNet - targetNet);
  const discountPercent = listNet > 0 ? discountAmount / listNet * 100 : 0;
  const taxAmount = cents(targetNet * TAX_PERCENT / 100);
  return { listNet, targetNet, discountAmount, discountPercent, taxPercent: TAX_PERCENT, taxAmount, gross: cents(targetNet + taxAmount) };
}

/** Braki sprzętu w terminie wydarzenia dla pozycji z katalogu (jak `checkCartConflicts`); błąd sprawdzania — brak listy. */
async function conflictsOf(ctx: NativeContext, eventId: string, items: Evaluated[]) {
  const payload = items.filter((item) => item.productId && item.configuration).map((item) => ({
    product_id: item.productId,
    product_variant_id: item.variantId,
    pricing_configuration: item.configuration,
    quantity: item.quantity || 1,
  }));
  if (!payload.length) return { conflicts: [] as Row[], checked: true };
  const { data, error } = await ctx.supabase.rpc('check_offer_cart_equipment_conflicts_v2', {
    p_event_id: eventId, p_items: payload, p_substitutions: [],
  });
  if (error) return { conflicts: [] as Row[], checked: false };
  return { conflicts: (Array.isArray(data) ? data : []) as Row[], checked: true };
}

const conflictView = (row: Row) => ({
  key: `${text(row.item_type)}|${text(row.item_id)}`,
  name: text(row.item_name) || 'Sprzęt',
  required: Number(row.required_qty) || 0,
  available: Number(row.available_qty) || 0,
  reserved: Number(row.reserved_qty) || 0,
  total: Number(row.total_qty) || 0,
  shortage: Number(row.shortage_qty) || 0,
});

/** Podgląd kreatora: wycena pozycji, gotowość produktów, stoły, cena docelowa i braki sprzętu w terminie. */
export async function previewOfferWizard(ctx: NativeContext, body: Row) {
  requireCreate(ctx);
  const eventId = uuid(body.eventId, 'Nie znaleziono eventu.');
  const audience = audienceFrom(body);
  const items = await evaluateItems(ctx, body, audience);
  const conflicts = await conflictsOf(ctx, eventId, items);
  return {
    items: items.map((item) => ({
      key: item.key,
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      days: item.days,
      baseUnitPrice: item.baseUnitPrice,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      needsTables: item.needsTables,
      audienceRequired: item.audienceRequired,
      error: item.error,
      readiness: item.product ? readinessView(readinessOf(item.product)) : null,
    })),
    needsTables: items.some((item) => item.needsTables),
    pricing: pricingOf(items, body.targetNet),
    conflicts: conflicts.conflicts.map(conflictView),
    conflictsChecked: conflicts.checked,
  };
}

// MARK: Utworzenie oferty

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** „Utwórz ofertę” (`handleSubmit` + `submitOfferWizard`): oferta, pozycje, dokładne podsumowanie i znacznik braków. */
export async function createOfferFromWizard(ctx: NativeContext, body: Row) {
  requireCreate(ctx);
  const eventId = uuid(body.eventId, 'Nie znaleziono eventu.');
  const raw = Array.isArray(body.items) ? body.items : [];
  if (!raw.length) fail('Dodaj przynajmniej jedną pozycję do oferty');
  const clientType = body.clientType === 'individual' ? 'individual' : body.clientType === 'business' ? 'business' : '';
  if (!clientType) fail('Wybierz typ klienta');
  const organizationId = UUID.test(text(body.organizationId)) ? text(body.organizationId) : '';
  const contactId = UUID.test(text(body.contactId)) ? text(body.contactId) : '';
  if (clientType === 'business' && !organizationId) fail('Wybierz organizację');
  if (clientType === 'individual' && !contactId) fail('Wybierz kontakt');

  const data = body.offer && typeof body.offer === 'object' ? body.offer as Row : {};
  const validUntil = text(data.validUntil).trim();
  if (validUntil && !DATE.test(validUntil)) fail('Podaj poprawną datę ważności oferty.');
  const audience = audienceFrom(body);
  if (audience.guest_count != null && audienceTables(audience) == null) fail('Podaj poprawną liczbę osób i ustawienia stołów.');

  const [{ data: eventRow, error: eventError }, season] = await Promise.all([
    ctx.supabase.from('events').select('id, name, description').eq('id', eventId).maybeSingle(),
    loadSeasonPrices(ctx.supabase, { eventId }),
  ]);
  if (eventError || !eventRow) fail('Nie znaleziono eventu.');
  const event = eventRow as Row;
  const priceList = season?.price_list || null;

  const items = await evaluateItems(ctx, body, audience);
  const invalid = items.find((item) => item.submitError);
  if (invalid) fail(invalid.submitError!);
  for (const item of items) {
    if (!item.configuration) continue;
    const resolved = resolveAudienceConfiguration(item.configuration as never, audience, item.quantity);
    if (resolved.error) fail(`${item.name}: ${resolved.error}`);
    const error = validateConfiguration(item.configuration as never);
    if (error) fail(`${item.name}: ${error}`);
  }

  const { conflicts } = await conflictsOf(ctx, eventId, items);
  if (conflicts.length && body.acceptShortage !== true) {
    fail(`Brakuje ${conflicts.length} pozycji sprzętu w terminie eventu. Potwierdź utworzenie oferty mimo braków.`);
  }
  const hasEquipmentShortage = conflicts.length > 0;
  const pricing = pricingOf(items, body.targetNet);
  const description = text(event.description);
  const assumptionItems = normalizeEventAssumptionItems([], description);
  const totals = {
    subtotal: pricing.listNet,
    discount_percent: pricing.discountPercent,
    discount_amount: pricing.discountAmount,
    tax_percent: pricing.taxPercent,
    tax_amount: pricing.taxAmount,
    total_amount: pricing.gross,
  };
  const number = text(data.offerNumber).trim().slice(0, 80);
  const { data: created, error: offerError } = await ctx.supabase.from('offers').insert([{
    ...audience,
    event_id: eventId,
    title: text(event.name).trim() || null,
    client_type: clientType,
    organization_id: clientType === 'business' ? organizationId : null,
    contact_id: contactId || null,
    valid_until: validUntil || null,
    notes: text(data.notes).trim() ? text(data.notes).slice(0, 10000) : null,
    event_location: text(data.location).trim().slice(0, 500) || null,
    event_assumptions: formatEventAssumptionItems(assumptionItems) || description.trim() || null,
    event_assumption_items: assumptionItems,
    event_goal: text(data.goal).trim().slice(0, 4000) || null,
    status: 'draft',
    ...totals,
    created_by: ctx.employee.id,
    offer_number: number || null,
    ...(priceList ? { price_list_id: priceList.id } : {}),
  }]).select('id, offer_number').single();
  if (offerError || !created) fail(offerError?.message || 'Błąd podczas tworzenia oferty');
  const offer = created as Row;

  const rows = items.map((item, index) => ({
    offer_id: offer.id,
    product_id: item.productId,
    product_variant_id: item.variantId,
    // Ceny wariantów z cennika (gwarancja ceny w PDF); wybrany wariant — cena tej pozycji.
    variant_prices_net: priceList && item.productId
      ? { ...seasonVariantPrices(season, item.productId), ...(item.variantId ? { [item.variantId]: item.baseUnitPrice } : {}) }
      : {},
    show_variant_prices_in_pdf: item.showVariantPrices,
    show_product_variants_in_pdf: item.showVariants,
    name: item.name,
    description: item.description || null,
    quantity: item.quantity,
    days: item.days,
    unit: item.unit,
    unit_price: item.unitPrice,
    pricing_configuration: item.configuration,
    unit_cost: 0,
    discount_percent: item.discountPercent,
    discount_amount: Math.round((item.quantity * item.days * item.unitPrice * item.discountPercent / 100 + Number.EPSILON) * 100) / 100,
    transport_cost: 0,
    logistics_cost: 0,
    display_order: index + 1,
    notes: null,
  }));
  const { error: itemsError } = await ctx.supabase.from('offer_items').insert(rows);
  if (itemsError) {
    // Pusta oferta bez pozycji nie zostaje (w CRM zostawała szkicem bez pozycji).
    await ctx.supabase.from('offers').delete().eq('id', offer.id);
    fail(itemsError.message || 'Błąd podczas zapisywania pozycji oferty');
  }
  // Trigger przelicza ofertę po dodaniu pozycji — nadpisujemy podsumowanie dokładną kwotą rabatu (jak w CRM).
  const { error: totalsError } = await ctx.supabase.from('offers').update(totals).eq('id', offer.id);
  if (totalsError) fail(totalsError.message || 'Oferta została utworzona, ale nie udało się zapisać rabatu.');
  if (hasEquipmentShortage) {
    await ctx.supabase.from('events').update({ has_equipment_shortage: true }).eq('id', eventId);
  }
  const notReady = items.filter((item) => item.product && !readinessOf(item.product).ready).length;
  return {
    id: String(offer.id),
    number: text(offer.offer_number),
    message: `Utworzono ofertę: ${text(offer.offer_number)}`,
    notReady,
  };
}
