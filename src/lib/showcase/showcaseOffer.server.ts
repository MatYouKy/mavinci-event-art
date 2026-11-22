import 'server-only';
import type { NativeContext } from '@/lib/native/auth';
import { offerEmailSetup, sendOfferEmail } from '@/lib/native/offerActions';
import { configureModularView, modularSnapshotOf } from '@/lib/native/modularConfigurator';
import { activeVariants, initialDraft, modularText, productPackages } from '@/lib/native/offerItems';
import { offerPdf } from '@/lib/native/offers';
import { WIZARD_PRODUCT_SELECT, evaluateItems, pricingOf, type Evaluated } from '@/lib/native/offerWizard';
import { resolveAudienceConfiguration, type OfferAudience } from '@/lib/CRM/Offers/audiencePricing';
import { formatEventAssumptionItems, normalizeEventAssumptionItems } from '@/lib/CRM/Offers/eventAssumptions';
import { validateConfiguration } from '@/lib/CRM/Offers/offerAddons';
import type { ProductConfigurationSnapshot } from '@/lib/CRM/Offers/modularProduct';
import { fail, isObject, isUuid, text, type Row } from '@/lib/social/socialCommon.server';
import { inquiryTitleLabel, systemLabel } from '@/lib/ui/systemLabels';
import {
  SHOWCASE_OFFER_LIMITS, isShowcaseOfferDiscountDisplay, isShowcaseOfferEmail, isShowcaseOfferPlaceholder, normalizeShowcaseOfferDraft, showcaseOfferProblem,
  showcaseOfferScope, type ShowcaseOfferApproval, type ShowcaseOfferDiscountDisplay, type ShowcaseOfferClientContext, type ShowcaseOfferClientHit, type ShowcaseOfferDraft,
  type ShowcaseConfigNode, type ShowcaseConfigView, type ShowcaseOfferConfiguration,
  type ShowcaseOfferEmailSetup, type ShowcaseOfferInquiry, type ShowcaseOfferLine, type ShowcaseOfferLocation, type ShowcaseOfferPerson,
  type ShowcaseOfferPreview,
  type ShowcaseOfferPreviewLine, type ShowcaseOfferResult, type ShowcaseOfferSetup, type ShowcaseOfferStatus,
} from './showcaseShared';
import { showcaseProductThumbs } from './showcase.server';

/*
 * Strefa sprzedawcy → „Prezentacje” → „Oferta ze spotkania” (CRM, Mac, iPad i telefon — `/bridge/native/v1/showcase`).
 * Klient ogląda pokaz i chce ofertę: sprzedawca wybiera warianty i pakiety, klienta (z CRM albo nowego) i od razu tworzy
 * ofertę. W CRM to zapytanie (źródło „Rozmowa / spotkanie”, etap „Zakwalifikowane”, opiekun — sprzedawca) z ofertą jako
 * wariantem zapytania (jak „Nowa oferta” w zapytaniu); wydarzenie powstaje po akceptacji, jak dziś.
 * Pozycje i ceny liczą te same funkcje co kreator ofert (`evaluateItems`, `pricingOf`, szkic pozycji jak `AddOfferItemModal`),
 * klienta i zapytanie zapisuje funkcja bazy `sales_showcase_offer_request` (migracja 20261122120000), ofertę i pozycje —
 * token pracownika (RLS ofert zapytania). Rabat powyżej progu (`sales_offer_guardrails`) — prośba o akceptację jak w CRM;
 * wysyłka dopiero po akceptacji. PDF tworzy `/bridge/offers/generate-pdf` (klient woła go bezpośrednio, z postępem).
 * Miejsce: podpowiedzi z bazy lokalizacji (`locationId` trafia do zapytania — migracja 20261122160000) albo wpisany tekst.
 * Produkty z konfiguratorem (scena, ekran LED): konfigurator na tablecie i telefonie (`op=offerConfigure`, te same funkcje co
 * kreator ofert — `modularConfigurator.ts`); przy wycenie serwer pobiera aktualny sprzęt i stawki z magazynu.
 */

const MIGRATION = 'Oferta ze spotkania nie jest jeszcze włączona na serwerze — potrzebna migracja 20261122120000_sales_showcase_offer.sql.';
const DENIED = 'Ofertę ze spotkania tworzy osoba z podglądem prezentacji, która prowadzi zapytania (uprawnienie do zapytań).';
const CONFIGURABLE = 'Produkt ma konfigurator (scena, ekran LED) — usuń pozycję i dodaj ją przez „Skonfiguruj”.';
const TABLE_GUESTS = 10;

type DbError = { message?: string; code?: string } | null | undefined;
type FailExtra = { inquiryId?: string; organizationId?: string; contactId?: string };

/** Błąd z zapisanym zapytaniem i klientem — ponowna próba dopina ofertę do tego zapytania (bez drugiego zapytania i klienta). */
function failWith(message: string, status: number, extra: FailExtra = {}): never {
  throw Object.assign(new Error(message), { status, ...extra });
}

const missingFunction = (error: DbError) => ['42883', 'PGRST202'].includes(error?.code || '');

/** Komunikat bazy (RAISE EXCEPTION, RLS z opisem) albo czytelny zamiennik dla błędów technicznych. */
function dbFail(error: DbError, fallback: string, extra: FailExtra = {}): void {
  if (!error) return;
  const code = error.code || '';
  const message = error.message || '';
  const technical = !message || /permission denied|row-level security|violates|syntax|column|relation|function|duplicate key/i.test(message);
  if (missingFunction(error)) failWith(MIGRATION, 503, extra);
  if (code === '42501') failWith(technical ? 'Nie masz uprawnień do tej operacji.' : message, 403, extra);
  if ((code === '22023' || code === 'P0001') && !technical) failWith(message, 400, extra);
  failWith(fallback, 400, extra);
}

/** Funkcje modułu ofert rzucają zwykłe błędy z polskim komunikatem — trasa ma go pokazać (400), a nie zamienić. */
async function relay<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (typeof (error as { status?: unknown })?.status === 'number') throw error;
    throw Object.assign(new Error(error instanceof Error && error.message ? error.message : 'Operacja nie powiodła się.'), { status: 400 });
  }
}

async function canOffer(ctx: NativeContext): Promise<boolean> {
  const { data, error } = await ctx.supabase.rpc('sales_showcase_offer_can');
  if (error) {
    if (missingFunction(error)) fail(MIGRATION, 503);
    fail('Nie udało się sprawdzić uprawnień do ofert.', 500);
  }
  return data === true;
}

async function requireOffer(ctx: NativeContext) {
  if (!(await canOffer(ctx))) fail(DENIED, 403);
}

const offerId = (value: unknown) => {
  if (!isUuid(value)) fail('Nie znaleziono oferty.', 404);
  return value.toLowerCase();
};

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
/** Data w czasie polskim (`YYYY-MM-DD`) przesunięta o liczbę dni. */
const warsawDate = (offsetDays: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(Date.now() + offsetDays * 86_400_000));
/** Fraza wyszukiwania bez znaków, które zmieniają filtr PostgREST. */
const searchTerm = (value: unknown) => text(value).replace(/[%,()\\*"':;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SHOWCASE_OFFER_LIMITS.search);
const personName = (row: Row) => text(row.full_name).trim() || [text(row.first_name), text(row.last_name)].filter(Boolean).join(' ').trim();

// MARK: Ustawienia

/** Sekcja `offerWizard` ustawień pracownika (`employees.preferences`) — sposób pokazania rabatu w PDF oferty. */
const offerWizardPreferences = (preferences: unknown): Row => {
  const wizard = isObject(preferences) ? (preferences as Row).offerWizard : null;
  return isObject(wizard) ? (wizard as Row) : {};
};

/** Czy pracownik tworzy oferty z pokazu, progi rabatu, czy sam akceptuje rabaty i jak pokazuje rabat klientowi w PDF. */
export async function showcaseOfferSetup(ctx: NativeContext): Promise<ShowcaseOfferSetup> {
  const [allowed, approve, limits, profile] = await Promise.all([
    ctx.supabase.rpc('sales_showcase_offer_can'),
    ctx.supabase.rpc('current_employee_can_approve_offers'),
    ctx.supabase.from('sales_offer_guardrails').select('enabled, max_discount_percent, min_margin_percent').eq('id', 1).maybeSingle(),
    ctx.supabase.from('employees').select('preferences').eq('id', ctx.employee.id).maybeSingle(),
  ]);
  if (allowed.error && !missingFunction(allowed.error)) fail('Nie udało się sprawdzić uprawnień do ofert.', 500);
  const guard = (limits.data || null) as Row | null;
  const enabled = allowed.data === true;
  const savedDisplay = offerWizardPreferences((profile.data as Row | null)?.preferences).discountDisplay;
  return {
    canOffer: enabled,
    reason: allowed.error ? MIGRATION : enabled ? '' : DENIED,
    canApprove: approve.data === true,
    guardrails: {
      enabled: guard?.enabled === true,
      maxDiscountPercent: number(guard?.max_discount_percent, 10),
      minMarginPercent: number(guard?.min_margin_percent, 25),
    },
    validDays: SHOWCASE_OFFER_LIMITS.validDays,
    discountDisplay: isShowcaseOfferDiscountDisplay(savedDisplay) ? savedDisplay : 'lines',
  };
}

/**
 * Zapamiętanie, jak sprzedawca pokazuje rabat klientowi w PDF (`employees.preferences.offerWizard.discountDisplay`) — to samo w CRM,
 * na Macu, iPadzie i telefonie. Własny wiersz pracownika, jego tokenem (RLS); pozostałe ustawienia zostają bez zmian.
 */
export async function showcaseOfferDiscountDisplay(ctx: NativeContext, body: Row): Promise<{ discountDisplay: ShowcaseOfferDiscountDisplay }> {
  if (!isShowcaseOfferDiscountDisplay(body.discountDisplay)) fail('Nieznany sposób pokazania rabatu.', 400);
  const discountDisplay = body.discountDisplay;
  const { data, error } = await ctx.supabase.from('employees').select('preferences').eq('id', ctx.employee.id).maybeSingle();
  if (error || !data) fail('Nie udało się odczytać ustawień.', 500);
  const preferences = isObject((data as Row).preferences) ? ((data as Row).preferences as Row) : {};
  const next = { ...preferences, offerWizard: { ...offerWizardPreferences(preferences), discountDisplay } };
  const saved = await ctx.supabase.from('employees').update({ preferences: next }).eq('id', ctx.employee.id).select('id').maybeSingle();
  if (saved.error || !saved.data) fail('Nie udało się zapamiętać ustawienia rabatu w PDF.', 500);
  return { discountDisplay };
}

// MARK: Klient

/** Wyszukiwanie klienta (organizacje bez podwykonawców i osoby) w zakresie pracownika (RLS). */
/** Podpowiedzi miejsca z bazy lokalizacji (nazwa, miasto, adres); bez wpisanego tekstu — pierwsze alfabetycznie. */
export async function showcaseOfferLocations(ctx: NativeContext, params: URLSearchParams): Promise<{ locations: ShowcaseOfferLocation[] }> {
  await requireOffer(ctx);
  const term = searchTerm(params.get('q'));
  let query = ctx.supabase.from('locations').select('id, name, city, address, formatted_address').order('name').limit(12);
  if (term.length >= 2) {
    const pattern = `%${term}%`;
    query = query.or(`name.ilike.${pattern},city.ilike.${pattern},address.ilike.${pattern},formatted_address.ilike.${pattern}`);
  }
  const { data, error } = await query;
  if (error) return { locations: [] };
  return {
    locations: ((data || []) as Row[]).filter((row) => isUuid(row.id) && text(row.name).trim()).map((row) => {
      const name = text(row.name).trim();
      const city = text(row.city).trim();
      return { id: String(row.id), name, city, address: text(row.address).trim() || text(row.formatted_address).trim(), label: [name, city].filter(Boolean).join(', ') };
    }),
  };
}

export async function showcaseOfferClients(ctx: NativeContext, params: URLSearchParams): Promise<{ clients: ShowcaseOfferClientHit[] }> {
  await requireOffer(ctx);
  const term = searchTerm(params.get('q'));
  if (term.length < 2) return { clients: [] };
  const pattern = `%${term}%`;
  const [orgs, contacts] = await Promise.all([
    ctx.supabase.from('organizations').select('id, name, alias, nip, city, email, phone, organization_type')
      .or(`name.ilike.${pattern},alias.ilike.${pattern},nip.ilike.${pattern},email.ilike.${pattern}`).order('name').limit(15),
    ctx.supabase.from('contacts').select('id, first_name, last_name, full_name, email, phone, mobile, company_name')
      .or(`full_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern},mobile.ilike.${pattern},company_name.ilike.${pattern}`)
      .order('last_name').limit(10),
  ]);
  if (orgs.error || contacts.error) fail('Nie udało się wyszukać klientów.', 400);
  const orgRows = ((orgs.data || []) as Row[]).filter((row) => text(row.organization_type) !== 'subcontractor').slice(0, 8);
  const contactRows = (contacts.data || []) as Row[];
  // Firma osoby kontaktowej (bieżąca, potem główna) — oferta trafia wtedy do firmy, a osoba jest kontaktem.
  const links = contactRows.length
    ? await ctx.supabase.from('contact_organizations').select('contact_id, organization_id, is_current, is_primary').in('contact_id', contactRows.map((row) => row.id))
    : { data: [] as Row[], error: null };
  const linkRows = ((links.data || []) as Row[]).sort((a, b) => Number(b.is_current === true) - Number(a.is_current === true) || Number(b.is_primary === true) - Number(a.is_primary === true));
  const linkedIds = Array.from(new Set(linkRows.map((row) => text(row.organization_id)).filter(isUuid)));
  const linkedOrgs = linkedIds.length
    ? await ctx.supabase.from('organizations').select('id, name, organization_type').in('id', linkedIds)
    : { data: [] as Row[], error: null };
  const orgName = new Map(((linkedOrgs.data || []) as Row[]).filter((row) => text(row.organization_type) !== 'subcontractor').map((row) => [String(row.id), text(row.name)]));
  const clients: ShowcaseOfferClientHit[] = [
    ...orgRows.map((row): ShowcaseOfferClientHit => ({
      kind: 'organization',
      id: String(row.id),
      name: text(row.name) || 'Organizacja',
      detail: [row.nip ? `NIP ${text(row.nip)}` : '', text(row.city), text(row.email)].filter(Boolean).join(' · '),
      organizationId: String(row.id),
      organizationName: text(row.name),
      email: text(row.email),
      phone: text(row.phone),
    })),
    ...contactRows.map((row): ShowcaseOfferClientHit => {
      const link = linkRows.find((entry) => String(entry.contact_id) === String(row.id) && orgName.has(text(entry.organization_id)));
      const organizationId = link ? text(link.organization_id) : null;
      const organizationName = organizationId ? orgName.get(organizationId) || '' : '';
      return {
        kind: 'contact',
        id: String(row.id),
        name: personName(row) || 'Osoba',
        detail: [organizationName || text(row.company_name), text(row.email) || text(row.phone) || text(row.mobile)].filter(Boolean).join(' · '),
        organizationId,
        organizationName,
        email: text(row.email),
        phone: text(row.phone) || text(row.mobile),
      };
    }),
  ];
  return { clients };
}

/** Osoby kontaktowe wybranej firmy i otwarte zapytania klienta, które pracownik prowadzi (oferta jako kolejny wariant). */
export async function showcaseOfferClientContext(ctx: NativeContext, params: URLSearchParams): Promise<ShowcaseOfferClientContext> {
  await requireOffer(ctx);
  const organization = params.get('organization');
  const contact = params.get('contact');
  const org = isUuid(organization) ? organization.toLowerCase() : null;
  const person = isUuid(contact) ? contact.toLowerCase() : null;
  if (!org && !person) return { persons: [], inquiries: [] };

  let persons: ShowcaseOfferPerson[] = [];
  if (org) {
    const { data: links } = await ctx.supabase.from('contact_organizations').select('contact_id, is_primary, is_current').eq('organization_id', org).limit(40);
    const linkRows = (links || []) as Row[];
    const ids = linkRows.map((row) => text(row.contact_id)).filter(isUuid);
    if (ids.length) {
      const { data } = await ctx.supabase.from('contacts').select('id, first_name, last_name, full_name, email, phone, mobile').in('id', ids);
      const primary = new Set(linkRows.filter((row) => row.is_primary === true).map((row) => text(row.contact_id)));
      persons = ((data || []) as Row[])
        .map((row) => ({ id: String(row.id), name: personName(row) || 'Osoba', email: text(row.email), phone: text(row.phone) || text(row.mobile), primary: primary.has(String(row.id)) }))
        .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name, 'pl'))
        .map(({ primary: _primary, ...rest }) => rest);
    }
  }

  let query = ctx.supabase.from('tasks').select('id, title, inquiry_stage, inquiry_owner_id, inquiry_details, due_date, updated_at')
    .eq('is_inquiry', true).is('archived_at', null).is('deleted_at', null)
    .or('inquiry_stage.is.null,inquiry_stage.not.in.(won,lost)')
    .order('updated_at', { ascending: false }).limit(10);
  query = org ? query.eq('organization_id', org) : query.eq('contact_id', person!).is('organization_id', null);
  const { data: rows, error } = await query;
  if (error) fail('Nie udało się pobrać zapytań klienta.', 400);
  const list = (rows || []) as Row[];
  // Tylko zapytania, które pracownik może prowadzić (ta sama reguła co zapis oferty w zapytaniu).
  const manageable = await Promise.all(list.map(async (row) => {
    const { data } = await ctx.supabase.rpc('can_manage_inquiry', { inquiry_owner: row.inquiry_owner_id || null, inquiry_id: row.id });
    return data === true;
  }));
  const inquiries = list.filter((_, index) => manageable[index]).map((row): ShowcaseOfferInquiry => {
    const details = isObject(row.inquiry_details) ? row.inquiry_details : {};
    const guests = Number(details.guest_count);
    const stage = text(row.inquiry_stage) || 'new';
    return {
      id: String(row.id),
      title: inquiryTitleLabel(text(row.title)) || 'Zapytanie',
      stage,
      stageLabel: systemLabel(stage),
      date: text(details.termin) || null,
      location: text(details.location_text),
      guestCount: Number.isInteger(guests) && guests > 0 ? guests : null,
      updatedAt: text(row.updated_at),
    };
  });
  return { persons, inquiries };
}

// MARK: Wycena

/**
 * Szkic pozycji jak w CRM po wyborze produktu (`initialDraft`), potem wybrany wariant albo pakiet (jak zmiana w oknie pozycji):
 * cena z katalogu, przelicznik ilości wariantu, dodatki produktu albo pakietu. Nazwa i opis jak `addOfferItem`.
 */
function lineDraft(product: Row, line: ShowcaseOfferLine): Row | string {
  if (product.configuration_schema) return configuredDraft(product, line);
  if (line.kind === 'configured') return 'Ten produkt nie ma już konfiguratora — usuń pozycję i dodaj ją ponownie.';
  const base = initialDraft(product, undefined).draft as Row;
  const variants = activeVariants(product);
  const packages = productPackages(product);
  const productName = text(product.name) || 'Produkt';
  let name = productName;
  let description = text(product.description);
  const applyVariant = (variant: Row) => {
    Object.assign(base, {
      variantId: variant.id,
      packageId: '',
      unitPrice: Number(variant.price_net) || 0,
      quantitySource: variant.quantity_source || product.quantity_source || 'manual',
      addons: ((product.pricing_addons || []) as Row[]).map((addon) => ({ ...addon })),
      showVariantPrices: true,
    });
    name = `${productName} — ${text(variant.name)}`;
    description = text(variant.description || variant.short_description || product.description);
  };
  const applyPackage = (option: Row, price: number) => {
    Object.assign(base, {
      variantId: null,
      packageId: option.id,
      unitPrice: price,
      addons: option.include_product_addons ? structuredClone(product.pricing_addons || []) : [],
      showVariantPrices: false,
    });
    name = `${productName} — ${text(option.name)}`;
    description = [text(option.included_label), text(option.bonus)].filter(Boolean).join('. ');
  };
  if (line.kind === 'variant') {
    const variant = variants.find((entry) => String(entry.id) === line.optionId);
    if (!variant) return 'Ten wariant nie jest już dostępny w katalogu.';
    applyVariant(variant);
  } else if (line.kind === 'package') {
    const option = packages.find((entry) => String(entry.id) === line.optionId) as Row | undefined;
    if (!option) return 'Ten pakiet nie jest już dostępny w katalogu.';
    if (option.price_on_request === true && !(line.agreedPrice && line.agreedPrice > 0)) {
      return `Wpisz uzgodnioną cenę pakietu „${text(option.name)}” — wycena indywidualna nie oznacza bezpłatnej usługi.`;
    }
    applyPackage(option, option.price_on_request === true ? line.agreedPrice! : Number(option.price_net) || 0);
  } else {
    // Sam produkt — domyślny wybór CRM (pierwszy pakiet albo polecany wariant).
    const option = packages.find((entry) => entry.id === base.packageId) as Row | undefined;
    const variant = variants.find((entry) => entry.id === base.variantId);
    if (option) {
      if (option.price_on_request === true) return `Wybierz pakiet produktu „${productName}” i wpisz uzgodnioną cenę.`;
      name = `${productName} — ${text(option.name)}`;
      description = [text(option.included_label), text(option.bonus)].filter(Boolean).join('. ');
    } else if (variant) {
      name = `${productName} — ${text(variant.name)}`;
      description = text(variant.description || variant.short_description || product.description);
    }
  }
  base.quantity = line.quantity;
  base.days = line.days;
  // Rabat pozycji (jak w kreatorze ofert) — rabat całej oferty liczy się od wartości po nim.
  base.discountPercent = line.discountPercent;
  return { productId: String(product.id), name: name.slice(0, 300), description: description.slice(0, 4000), draft: base };
}

/**
 * Pozycja z konfiguratora: szkic jak w kreatorze ofert (konfiguracja modułowa, cena z kalkulatora, jednostka „zestaw”),
 * nazwa i zakres z konfiguracji (`modularTitle`, `modularScope`).
 */
function configuredDraft(product: Row, line: ShowcaseOfferLine): Row | string {
  if (line.kind !== 'configured' || !line.modular) return CONFIGURABLE;
  let modular: ProductConfigurationSnapshot;
  try {
    modular = modularSnapshotOf(line.modular);
  } catch {
    return 'Konfiguracja tej pozycji jest nieprawidłowa — otwórz ją i skonfiguruj ponownie.';
  }
  const described = modularText(modular);
  const base = initialDraft(product, undefined).draft as Row;
  return {
    productId: String(product.id),
    name: (described.name || text(product.name) || 'Produkt').slice(0, 300),
    description: described.description.slice(0, 4000),
    draft: {
      ...base, variantId: null, packageId: '', addons: [], modular, modularManual: false, quantity: line.quantity, days: line.days,
      discountPercent: line.discountPercent,
    },
  };
}

type Evaluation = {
  draft: ShowcaseOfferDraft;
  audience: OfferAudience;
  /** Pozycje bez błędów (w kolejności koszyka). */
  items: Evaluated[];
  lines: ShowcaseOfferPreviewLine[];
  pricing: ReturnType<typeof pricingOf>;
  problem: string | null;
};

/** `thumbs` — miniatury zdjęć produktów do pozycji (podgląd na ekranie; przy tworzeniu oferty niepotrzebne). */
async function evaluateDraft(ctx: NativeContext, draft: ShowcaseOfferDraft, thumbs = false): Promise<Evaluation> {
  const ids = Array.from(new Set(draft.lines.map((line) => line.productId)));
  const products = new Map<string, Row>();
  if (ids.length) {
    const { data, error } = await ctx.supabase.from('offer_products').select(WIZARD_PRODUCT_SELECT).in('id', ids);
    if (error) fail('Nie udało się pobrać produktów z katalogu.', 400);
    for (const row of (data || []) as Row[]) products.set(String(row.id), row);
  }
  const thumbnails = thumbs && products.size
    ? await showcaseProductThumbs(ctx, Array.from(products.values())).catch(() => new Map<string, string>())
    : new Map<string, string>();
  // Konfiguracje z konfiguratora: aktualny sprzęt i stawki z magazynu (cena nie zależy od kopii z urządzenia).
  const configured = new Map<string, Record<string, unknown> | string>();
  for (const line of draft.lines) {
    if (line.kind !== 'configured' || !line.modular || !products.get(line.productId)?.configuration_schema) continue;
    try {
      const fresh = await configureModularView(ctx, { snapshot: line.modular, refresh: true, view: false });
      configured.set(line.key, fresh.snapshot as unknown as Record<string, unknown>);
    } catch (error) {
      configured.set(line.key, error instanceof Error && error.message ? error.message : 'Nie udało się przeliczyć konfiguracji.');
    }
  }
  const audience: OfferAudience = { guest_count: draft.event.guestCount, guests_per_table: TABLE_GUESTS, table_count: null };
  const prepared = draft.lines.map((line) => {
    const product = products.get(line.productId);
    if (!product || product.is_active === false) return { line, error: 'Produkt nie jest już dostępny w katalogu.', body: null as Row | null };
    const fresh = configured.get(line.key);
    if (typeof fresh === 'string') return { line, error: fresh, body: null as Row | null };
    const body = lineDraft(product, fresh ? { ...line, modular: fresh } : line);
    return typeof body === 'string' ? { line, error: body, body: null as Row | null } : { line, error: null as string | null, body };
  });
  const bodies = prepared.filter((entry) => entry.body).map((entry, index) => ({ ...entry.body, key: `line-${index}` }));
  const evaluated = bodies.length ? await evaluateItems(ctx, { items: bodies }, audience) : [];
  let cursor = 0;
  const pairs = prepared.map((entry) => ({ ...entry, item: entry.body ? evaluated[cursor++] || null : null }));
  const lines = pairs.map(({ line, error, item }): ShowcaseOfferPreviewLine => ({
    key: line.key,
    name: item?.name || line.label,
    unit: item?.unit || '',
    quantity: item ? item.quantity : line.quantity,
    days: item ? item.days : line.days,
    unitPrice: item ? cents(item.unitPrice) : 0,
    subtotal: item ? cents(item.subtotal) : 0,
    listSubtotal: item ? cents(item.quantity * item.days * item.unitPrice) : 0,
    discountPercent: item ? item.discountPercent : line.discountPercent,
    quantityFromAudience: item ? item.unit === 'osoba' || item.unit === 'stół' : false,
    error: error || item?.error || null,
    thumbnailUrl: thumbnails.get(line.productId) || null,
  }));
  const items = pairs.filter((entry) => entry.item && !entry.error && !entry.item.error).map((entry) => entry.item!) as Evaluated[];
  const listNet = items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0);
  // Rabat nigdy wyższy niż wybrany procent (zaokrąglenie ceny docelowej w górę do grosza).
  const target = Math.ceil(listNet * (1 - draft.discountPercent / 100) * 100 - 1e-6) / 100;
  const pricing = pricingOf(items, Math.max(0, target));
  const failed = pairs.find((entry) => entry.error || entry.item?.error);
  const problem = failed ? `${failed.item?.name || failed.line.label}: ${failed.error || failed.item?.error}` : null;
  return { draft, audience, items, lines, pricing, problem };
}

/** Rabaty pozycji (od ich wartości przed rabatem) i rabat łączny z rabatem całej oferty — jak próg akceptacji w bazie. */
function discountsOf(evaluation: Evaluation) {
  const before = evaluation.items.reduce((sum, item) => sum + item.quantity * item.days * item.unitPrice, 0);
  const lineDiscountAmount = cents(Math.max(0, before - evaluation.pricing.listNet));
  const effective = before > 0 ? (lineDiscountAmount + evaluation.pricing.discountAmount) / before * 100 : 0;
  return { lineDiscountAmount, effectiveDiscountPercent: Math.round(effective * 100) / 100 };
}

const previewOf = (evaluation: Evaluation): ShowcaseOfferPreview => ({
  lines: evaluation.lines,
  listNet: cents(evaluation.pricing.listNet),
  discountPercent: Math.round(evaluation.pricing.discountPercent * 100) / 100,
  discountAmount: evaluation.pricing.discountAmount,
  ...discountsOf(evaluation),
  net: evaluation.pricing.targetNet,
  taxPercent: evaluation.pricing.taxPercent,
  tax: evaluation.pricing.taxAmount,
  gross: evaluation.pricing.gross,
  // Tylko problemy pozycji i cen — dane klienta sprawdza na bieżąco urządzenie (`showcaseOfferProblem`), a przy tworzeniu serwer.
  problem: evaluation.problem || (evaluation.items.length && evaluation.pricing.listNet <= 0 ? 'Oferta ma wartość 0 zł — sprawdź ceny pozycji w katalogu.' : null),
});

/** Podgląd: pozycje z cenami z katalogu, rabat, VAT i problem blokujący utworzenie. */
export async function showcaseOfferPreview(ctx: NativeContext, body: Row): Promise<ShowcaseOfferPreview> {
  await requireOffer(ctx);
  return previewOf(await evaluateDraft(ctx, normalizeShowcaseOfferDraft(body.draft), true));
}

// MARK: Konfigurator (scena, ekran LED)

/** Węzeł drzewa wyboru bez stawki części (zostaje ilość). */
function clientNode(node: Row | null | undefined): ShowcaseConfigNode | null {
  if (!node) return null;
  return {
    id: text(node.id),
    path: text(node.path),
    name: text(node.name),
    detail: text(node.detail).split(' · ')[0],
    groups: ((node.groups || []) as Row[]).map((group) => ({
      key: text(group.key),
      kind: group.kind,
      label: text(group.label),
      placeholder: text(group.placeholder),
      options: ((group.options || []) as Row[]).map((option) => ({ id: text(option.id), label: text(option.label) })),
      selected: text(group.selected),
      enabled: group.enabled === true,
      children: ((group.children || []) as Row[]).map(clientNode).filter((child): child is ShowcaseConfigNode => Boolean(child)),
    })),
  };
}

/** Widok konfiguratora dla pokazu (klient widzi ekran razem ze sprzedawcą): bez stawek części, stanu magazynu i nazw angielskich. */
function clientView(view: Row): ShowcaseConfigView {
  const led = view.led as Row | null;
  return {
    profile: text(view.profile),
    heading: text(view.heading),
    title: text(view.title),
    scope: Array.isArray(view.scope) ? (view.scope as unknown[]).map(text) : [],
    error: view.error ? text(view.error) : null,
    loadError: view.loadError ? text(view.loadError) : null,
    lines: ((view.lines || []) as Row[]).map((line) => ({ key: text(line.key), name: text(line.name), quantity: text(line.quantity) })),
    calculatorTotal: typeof view.calculatorTotal === 'number' ? view.calculatorTotal : null,
    totalText: text(view.totalText),
    note: view.note ? text(view.note) : null,
    roots: ((view.roots || []) as Row[]).map((root) => ({
      id: text(root.id),
      title: text(root.title),
      optional: root.optional === true,
      optionalLabel: text(root.optionalLabel),
      enabled: root.enabled === true,
      quantityEditable: root.quantityEditable === true,
      quantity: typeof root.quantity === 'number' ? root.quantity : null,
      tree: clientNode(root.tree as Row | null),
    })),
    stage: (view.stage as ShowcaseConfigView['stage']) || null,
    led: led ? {
      hasSections: led.hasSections === true,
      canAdd: led.canAdd === true,
      sections: (led.sections || []) as NonNullable<ShowcaseConfigView['led']>['sections'],
      totals: led.totals ? text(led.totals) : null,
      notices: (led.notices || []) as NonNullable<ShowcaseConfigView['led']>['notices'],
    } : null,
    legacyStage: (view.legacyStage as ShowcaseConfigView['legacyStage']) || null,
    components: (view.components as ShowcaseConfigView['components']) || null,
    area: typeof view.area === 'number' ? view.area : null,
    areaEditable: view.areaEditable === true,
  };
}

/**
 * Konfigurator produktu w ofercie ze spotkania: `productId` (nowa konfiguracja z karty produktu) albo `snapshot` (pozycja
 * z koszyka), `edits` — zmiany w kolejności wprowadzenia, `refresh` — ponowne pobranie sprzętu, `quantity` — liczba zestawów.
 */
export async function showcaseOfferConfigure(ctx: NativeContext, body: Row): Promise<ShowcaseOfferConfiguration> {
  await requireOffer(ctx);
  if (!isObject(body.snapshot)) {
    if (!isUuid(body.productId)) fail('Wybierz produkt.');
    const { data } = await ctx.supabase.from('offer_products').select('is_active, configuration_schema').eq('id', body.productId).maybeSingle();
    const product = (data || null) as Row | null;
    if (!product || product.is_active === false) fail('Produkt nie jest już dostępny w katalogu.', 404);
    if (!product.configuration_schema) fail('Ten produkt nie ma konfiguratora.');
  }
  const quantity = Number(body.quantity);
  const result = await relay(() => configureModularView(ctx, {
    productId: isObject(body.snapshot) ? undefined : body.productId,
    snapshot: isObject(body.snapshot) ? body.snapshot : undefined,
    edits: Array.isArray(body.edits) ? body.edits : [],
    refresh: body.refresh === true,
    quantity: Number.isFinite(quantity) && quantity >= 1 ? quantity : 1,
  }));
  return { snapshot: result.snapshot as unknown as Record<string, unknown>, view: clientView((result.view || {}) as Row) };
}

// MARK: Utworzenie

function approvalOf(data: unknown): ShowcaseOfferApproval {
  const row = isObject(data) ? data : {};
  return {
    required: row.required === true,
    canSend: row.can_send !== false,
    status: row.approval_status ? text(row.approval_status) : null,
    reasons: (Array.isArray(row.reasons) ? row.reasons : []).map((reason: unknown) => (isObject(reason) ? text(reason.message) : '')).filter(Boolean),
    canApprove: row.can_approve === true,
  };
}

async function guardrail(ctx: NativeContext, id: string): Promise<ShowcaseOfferApproval> {
  const { data } = await ctx.supabase.rpc('get_offer_guardrail_status', { p_offer_id: id });
  return approvalOf(data);
}

async function clientOf(ctx: NativeContext, organizationId: unknown, contactId: unknown) {
  const [org, contact] = await Promise.all([
    isUuid(organizationId) ? ctx.supabase.from('organizations').select('name, email').eq('id', organizationId).maybeSingle() : Promise.resolve({ data: null }),
    isUuid(contactId) ? ctx.supabase.from('contacts').select('first_name, last_name, full_name, email').eq('id', contactId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const orgRow = (org.data || null) as Row | null;
  const contactRow = (contact.data || null) as Row | null;
  return {
    name: text(orgRow?.name) || (contactRow ? personName(contactRow) : ''),
    email: text(contactRow?.email) || text(orgRow?.email),
  };
}

/**
 * „Utwórz ofertę”: klient i zapytanie (funkcja bazy), oferta zapytania z pozycjami i dokładnym rabatem (jak kreator),
 * powiązanie z zapytaniem, stan akceptacji rabatu. Ponowne wywołanie z tym samym szkicem zwraca utworzoną ofertę.
 */
export async function showcaseOfferCreate(ctx: NativeContext, body: Row): Promise<ShowcaseOfferResult> {
  await requireOffer(ctx);
  const draft = normalizeShowcaseOfferDraft(body.draft);

  // Powtórzone „Utwórz ofertę” (np. po zerwanym połączeniu) — ta sama oferta, bez drugiego zapytania.
  const { data: existingRow } = await ctx.supabase.from('offers').select('id, offer_number, inquiry_id, organization_id, contact_id, created_by, total_amount, subtotal, discount_amount')
    .eq('id', draft.id).maybeSingle();
  if (existingRow) {
    const existing = existingRow as Row;
    if (String(existing.created_by) !== String(ctx.employee.id)) fail('Ta oferta już istnieje. Odśwież pokaz i spróbuj ponownie.', 409);
    const client = await clientOf(ctx, existing.organization_id, existing.contact_id);
    let clientName = client.name;
    if (!clientName && isUuid(existing.inquiry_id)) {
      // Klient roboczy — nazwa z zapytania.
      const { data: inquiryRow } = await ctx.supabase.from('tasks').select('inquiry_details').eq('id', existing.inquiry_id).maybeSingle();
      const details = (inquiryRow as Row | null)?.inquiry_details;
      clientName = isObject(details) ? text((details as Row).client_text) : '';
    }
    return {
      offerId: String(existing.id),
      number: text(existing.offer_number),
      inquiryId: text(existing.inquiry_id),
      inquiryCreated: false,
      clientName,
      clientEmail: client.email,
      clientPlaceholder: !isUuid(existing.organization_id) && !isUuid(existing.contact_id),
      net: cents(number(existing.subtotal) - number(existing.discount_amount)),
      gross: number(existing.total_amount),
      approval: await guardrail(ctx, String(existing.id)),
    };
  }

  const problem = showcaseOfferProblem(draft);
  if (problem) fail(problem);
  const evaluation = await evaluateDraft(ctx, draft);
  if (evaluation.problem) fail(evaluation.problem);
  for (const item of evaluation.items) {
    if (!item.configuration) continue;
    const resolved = resolveAudienceConfiguration(item.configuration as never, evaluation.audience, item.quantity);
    if (resolved.error) fail(`${item.name}: ${resolved.error}`);
    const error = validateConfiguration(item.configuration as never);
    if (error) fail(`${item.name}: ${error}`);
  }
  const { pricing } = evaluation;
  if (pricing.listNet <= 0) fail('Oferta ma wartość 0 zł — sprawdź ceny pozycji w katalogu.');

  // 1. Klient (z CRM albo nowy, bez duplikatów) i zapytanie (nowe albo otwarte zapytanie klienta).
  const { data: requested, error: requestError } = await ctx.supabase.rpc('sales_showcase_offer_request', {
    p_request: {
      client: {
        organizationId: draft.client.organizationId,
        contactId: draft.client.contactId,
        company: draft.client.company,
        nip: draft.client.nip,
        firstName: draft.client.firstName,
        lastName: draft.client.lastName,
        email: draft.client.email,
        phone: draft.client.phone,
        // Klient roboczy (sama nazwa, bez bazy) — zapytanie i oferta bez klienta; przypisanie później w CRM.
        placeholder: isShowcaseOfferPlaceholder(draft.client) ? draft.client.placeholder : '',
      },
      event: {
        name: draft.event.name, date: draft.event.date, location: draft.event.location, locationId: draft.event.locationId,
        guestCount: draft.event.guestCount,
      },
      inquiryId: draft.inquiryId,
      note: draft.note,
      scope: showcaseOfferScope(draft.lines),
      estimatedNet: pricing.targetNet,
    },
  });
  dbFail(requestError, 'Nie udało się zapisać klienta i zapytania.');
  const request = (isObject(requested) ? requested : {}) as Row;
  const inquiryId = text(request.inquiryId);
  if (!isUuid(inquiryId)) fail('Nie udało się zapisać zapytania.');
  const inquiryCreated = isObject(request.created) && request.created.inquiry === true;
  const keep: FailExtra = {
    inquiryId,
    ...(isUuid(request.organizationId) ? { organizationId: request.organizationId } : {}),
    ...(isUuid(request.contactId) ? { contactId: request.contactId } : {}),
  };

  // 2. Ustalenia zapytania w ofercie (jak „Nowa oferta” w zapytaniu: założenia, cel, miejsce, liczba osób, podsumowanie).
  const { data: inquiryRow } = await ctx.supabase.from('tasks').select('id, title, brief_revision, event_id, inquiry_details').eq('id', inquiryId).maybeSingle();
  const inquiry = (inquiryRow || {}) as Row;
  const details: Row = isObject(inquiry.inquiry_details) ? inquiry.inquiry_details : {};
  let approved: string | null = null;
  if (details.approved_summary) {
    const { data } = await ctx.supabase.rpc('get_inquiry_approved_summary', { p_inquiry: inquiryId });
    approved = typeof data === 'string' && data.trim() ? data : null;
  }
  // Nowe zapytanie: karty założeń z rozmowy (liczba gości, miejsce); otwarte zapytanie — jego założenia (jak w CRM).
  const assumptionItems = inquiryCreated
    ? normalizeEventAssumptionItems([
      ...(draft.event.guestCount ? [{ key: 'guest_count', value: `${draft.event.guestCount} osób`, badge_value: String(draft.event.guestCount) }] : []),
      ...(draft.event.location ? [{ key: 'venue', value: draft.event.location }] : []),
    ], '')
    : normalizeEventAssumptionItems(details.event_assumption_items, text(details.event_assumptions));
  const assumptions = formatEventAssumptionItems(assumptionItems) || (inquiryCreated ? '' : text(details.scope));
  const placeholder = request.placeholder === true;
  const notes = [
    placeholder ? `Klient roboczy: ${text(request.clientName) || 'bez nazwy'} — przypisz klienta w CRM przed wysłaniem oferty.` : '',
    approved ? `Zatwierdzone podsumowanie zapytania:\n${approved}` : '',
    draft.note ? `Notatka ze spotkania:\n${draft.note}` : '',
  ].filter(Boolean).join('\n\n');
  const totals = {
    subtotal: pricing.listNet,
    discount_percent: pricing.discountPercent,
    discount_amount: pricing.discountAmount,
    tax_percent: pricing.taxPercent,
    tax_amount: pricing.taxAmount,
    total_amount: pricing.gross,
  };
  // Bez klienta (klient roboczy) — oferta bez typu klienta i bez powiązań (jak oferta bez klienta w CRM).
  const clientType = request.clientType === 'business' ? 'business' : request.clientType === 'individual' ? 'individual' : null;
  // Tytuł nie bierze nazwy roboczej klienta (zapytanie „Zapytanie: <nazwa robocza>”) — trafiłaby do PDF.
  const title = (draft.event.name || (placeholder && inquiryCreated ? '' : inquiryTitleLabel(text(inquiry.title)))
    || evaluation.items.map((item) => item.name).join(', ')).slice(0, 180);
  const { data: created, error: offerError } = await ctx.supabase.from('offers').insert([{
    id: draft.id,
    inquiry_id: inquiryId,
    source_brief_revision: Number(inquiry.brief_revision || 1),
    event_id: isUuid(inquiry.event_id) ? inquiry.event_id : null,
    title: title || null,
    client_type: clientType,
    organization_id: clientType === 'business' && isUuid(request.organizationId) ? request.organizationId : null,
    contact_id: clientType && isUuid(request.contactId) ? request.contactId : null,
    valid_until: warsawDate(SHOWCASE_OFFER_LIMITS.validDays),
    status: 'draft',
    notes: notes || null,
    event_location: (text(details.location_text) || draft.event.location).slice(0, 500) || null,
    // Bez liczby osób w szkicu — wyzwalacz bierze ją z zapytania.
    guest_count: evaluation.audience.guest_count,
    guests_per_table: TABLE_GUESTS,
    table_count: null,
    event_assumptions: assumptions || null,
    event_assumption_items: assumptionItems,
    event_goal: text(details.event_goal) || null,
    ...totals,
    created_by: ctx.employee.id,
  }]).select('id, offer_number').single();
  dbFail(offerError, 'Nie udało się utworzyć oferty. Zapytanie zostało zapisane — spróbuj ponownie.', keep);
  if (!created) failWith('Nie udało się utworzyć oferty. Zapytanie zostało zapisane — spróbuj ponownie.', 400, keep);
  const offer = created as Row;

  // 3. Pozycje (jak kreator ofert) i dokładny rabat w podsumowaniu.
  const rows = evaluation.items.map((item, index) => ({
    offer_id: offer.id,
    product_id: item.productId,
    product_variant_id: item.variantId,
    variant_prices_net: {},
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
    // Oferta bez pozycji nie zostaje; zapytanie zostaje — ponowna próba dopina do niego nową ofertę.
    await ctx.supabase.from('offers').delete().eq('id', offer.id);
    dbFail(itemsError, 'Nie udało się zapisać pozycji oferty. Zapytanie zostało zapisane — spróbuj ponownie.', keep);
  }
  const { error: totalsError } = await ctx.supabase.from('offers').update(totals).eq('id', offer.id);
  if (totalsError) failWith('Oferta została utworzona, ale nie udało się zapisać rabatu. Otwórz ją w CRM i sprawdź rabat.', 400, keep);
  // Rabat w PDF inny niż domyślny („przy pozycjach”) — bez migracji 20261124120000 PDF pokaże rabat przy pozycjach.
  if (draft.discountDisplay !== 'lines') {
    const { error: displayError } = await ctx.supabase.from('offers').update({ discount_display: draft.discountDisplay }).eq('id', offer.id);
    if (displayError) console.warn('[showcase] discount_display', displayError.code, displayError.message);
  }
  // Najnowsza oferta zapytania (jak „Nowa oferta” w zapytaniu) — bez blokowania, gdy zapytanie zmienił ktoś inny.
  await ctx.supabase.from('tasks').update({ linked_offer_id: offer.id }).eq('id', inquiryId);

  return {
    offerId: String(offer.id),
    number: text(offer.offer_number),
    inquiryId,
    inquiryCreated,
    clientName: text(request.clientName),
    clientEmail: text(request.clientEmail),
    clientPlaceholder: placeholder,
    net: pricing.targetNet,
    gross: pricing.gross,
    approval: await guardrail(ctx, String(offer.id)),
  };
}

// MARK: Po utworzeniu

/** Stan oferty po utworzeniu: numer, status, aktualny PDF i akceptacja rabatu. */
export async function showcaseOfferStatus(ctx: NativeContext, id: string): Promise<ShowcaseOfferStatus> {
  await requireOffer(ctx);
  const key = offerId(id);
  const [{ data }, approval] = await Promise.all([
    ctx.supabase.from('offers').select('id, offer_number, status, generated_pdf_url, modified_after_generation').eq('id', key).maybeSingle(),
    guardrail(ctx, key),
  ]);
  if (!data) fail('Nie znaleziono oferty.', 404);
  const row = data as Row;
  return {
    offerId: String(row.id),
    number: text(row.offer_number),
    status: text(row.status) || 'draft',
    pdfReady: Boolean(row.generated_pdf_url) && row.modified_after_generation !== true,
    approval,
  };
}

/** Prośba o akceptację rabatu (jak w CRM — powiadomienie trafia do osób akceptujących, nie do autora). */
export async function showcaseOfferApproval(ctx: NativeContext, body: Row): Promise<ShowcaseOfferApproval> {
  await requireOffer(ctx);
  const key = offerId(body.id);
  const note = text(body.note).trim().slice(0, 1000);
  const { error } = await ctx.supabase.rpc('request_offer_approval', { p_offer_id: key, p_note: note || null });
  dbFail(error, 'Nie udało się wysłać prośby o akceptację.');
  return guardrail(ctx, key);
}

/** Podpisany adres PDF oferty (1 godzina) — podgląd dla klienta na ekranie. */
export async function showcaseOfferPdf(ctx: NativeContext, id: string) {
  await requireOffer(ctx);
  const key = offerId(id);
  return relay(() => offerPdf(ctx, key, 'pl'));
}

/** Okno wysyłki: skrzynki pracownika, adresat (klient oferty), temat i treść jak w CRM, stan PDF. */
export async function showcaseOfferEmail(ctx: NativeContext, id: string): Promise<ShowcaseOfferEmailSetup> {
  await requireOffer(ctx);
  const key = offerId(id);
  const setup = await relay(() => offerEmailSetup(ctx, key));
  return {
    number: text(setup.number),
    accounts: (setup.accounts || []).map((account) => ({ id: text(account.id), label: text(account.label) })),
    to: text(setup.to),
    recipientName: text(setup.recipientName),
    subject: text(setup.subject),
    text: text(setup.text),
    pdfReady: setup.pdfReady === true,
  };
}

/** Wysyłka oferty z aktualnym PDF (jak „Wyślij ofertę” w CRM) — rabat powyżej progu dopiero po akceptacji. */
export async function showcaseOfferEmailSend(ctx: NativeContext, body: Row, accessToken: string) {
  await requireOffer(ctx);
  const key = offerId(body.id);
  const to = text(body.to).trim();
  const addresses = to.split(/[,;]/).map((value) => value.trim()).filter(Boolean);
  if (!addresses.length) fail('Wprowadź adres email odbiorcy');
  if (addresses.some((value) => !isShowcaseOfferEmail(value))) fail('Podaj poprawny adres e-mail odbiorcy.');
  const approval = await guardrail(ctx, key);
  if (!approval.canSend) fail('Rabat czeka na akceptację — ofertę wyślesz po akceptacji.', 409);
  const result = await relay(() => sendOfferEmail(ctx, {
    id: key,
    to: addresses.join(', '),
    subject: text(body.subject),
    text: text(body.text),
    accountId: text(body.accountId),
    recipientName: text(body.recipientName),
    cc: '',
    bcc: '',
  }, accessToken));
  return { sent: true, scheduled: result.scheduled === true, warning: result.warning ? text(result.warning) : null };
}
