import 'server-only';
import type { NativeContext } from './auth';
import { assetUrls, roomItem } from './locations';

/*
 * „Branding i wizytówka — podgląd” na Macu — 1:1 z `CrmOfferBrandingPanel` (karta sprzedawcy → Ustawienia, karta organizacji →
 * „Branding ofert”): `get_crm_offer_branding` (marki, organizacja, branding wspólny organizacji albo sprzedawcy niezależnego,
 * wizytówka sprzedawcy) — w CRM tylko podgląd, edycję ma sprzedawca w portalu. Pliki z `seller-brand-assets` jako podpisane
 * adresy (godzina), jak `IdentityAssetPreview`. „Przestrzenie i kontakty hotelu” (`HotelVenueSettings` w trybie CRM):
 * `get_seller_hotel_context` — lokalizacja hotelu z salami i informacjami technicznymi (materiały `location-materials`)
 * oraz aktualne kontakty organizacji. Tokenem pracownika — dostęp rozstrzyga baza.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'seller-brand-assets';
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const isObject = (value: unknown): value is Row => !!value && typeof value === 'object' && !Array.isArray(value);

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const optionalId = (value: unknown, message: string) => {
  const id = str(value);
  if (!id) return null;
  if (!UUID.test(id)) fail(message);
  return id;
};

/** Pola `SellerBranding` widoczne w podglądzie CRM (wizytówka i wygląd ofert). */
function brandingOut(raw: unknown) {
  const value = isObject(raw) ? raw : {};
  const gallery = Array.isArray(value.venue_image_urls) ? value.venue_image_urls.map(str).filter(Boolean) : [];
  return {
    displayName: str(value.display_name),
    positionTitle: str(value.position_title),
    contactEmail: str(value.contact_email),
    contactPhone: str(value.contact_phone),
    portrait: str(value.portrait_url) || null,
    logo: str(value.hotel_logo_url) || null,
    cover: str(value.hotel_cover_image_url) || null,
    gallery,
    primaryColor: str(value.brand_primary_color) || null,
    secondaryColor: str(value.brand_secondary_color) || null,
    surfaceColor: str(value.brand_surface_color) || null,
    headingFont: str(value.heading_font_family) || 'Noto Sans',
    headingFontPath: str(value.heading_font_path) || null,
    brandbook: str(value.brandbook_url) || null,
    brandbookNotes: str(value.brandbook_notes),
    footerText: str(value.footer_text),
    disclosureText: str(value.disclosure_text),
    organizationBrandingConfigured: typeof value.organization_branding_configured === 'boolean' ? value.organization_branding_configured : null,
  };
}

/** Podgląd brandingu ofert: sprzedawca (`partner`) z wybraną organizacją albo sama organizacja. */
export async function offerBranding(ctx: NativeContext, partnerParam: unknown, organizationParam: unknown) {
  const partnerId = optionalId(partnerParam, 'Nieprawidłowy sprzedawca.');
  const organizationId = optionalId(organizationParam, 'Nieprawidłowa organizacja.');
  if (!partnerId && !organizationId) fail('Wskaż sprzedawcę albo organizację.');
  const { data, error } = await ctx.supabase.rpc('get_crm_offer_branding', { p_partner: partnerId, p_organization: organizationId });
  if (error) fail(error.message || 'Nie udało się pobrać brandingu.', error.code === '42501' ? 403 : 400);
  const value = (isObject(data) ? data : {}) as Row;
  const brands = (Array.isArray(value.brands) ? value.brands : []).filter(isObject).map((brand: Row) => ({
    id: str(brand.id), name: str(brand.name), branding: brandingOut(brand.branding),
  }));
  // Podpisane adresy plików wszystkich marek naraz (logo, okładka, galeria, zdjęcie, czcionka, brandbook).
  const paths = Array.from(new Set(brands.flatMap(({ branding }) => [
    branding.portrait, branding.logo, branding.cover, branding.headingFontPath, branding.brandbook, ...branding.gallery,
  ]).filter((path): path is string => Boolean(path) && !/^https?:\/\//i.test(String(path)))));
  const urls: Record<string, string> = {};
  for (let index = 0; index < paths.length; index += 200) {
    const { data: signed } = await ctx.supabase.storage.from(BUCKET).createSignedUrls(paths.slice(index, index + 200), 3600);
    ((signed || []) as Row[]).forEach((item) => { if (item?.path && item?.signedUrl) urls[str(item.path)] = str(item.signedUrl); });
  }
  return {
    organizationId: str(value.organization_id) || null,
    organizationName: str(value.organization_name) || null,
    organizations: (Array.isArray(value.organizations) ? value.organizations : []).filter(isObject)
      .map((item: Row) => ({ id: str(item.id), name: str(item.name) })),
    brands,
    urls,
  };
}

/** `hotelContextError` z `src/lib/seller/hotel.ts` — ten sam komunikat o brakującej migracji. */
function hotelError(error: { code?: string; message?: string } | null) {
  return ['PGRST202', '42883', '42P01'].includes(error?.code || '')
    ? 'Baza hotelu wymaga migracji 20260928130000_seller_hotel_venue_directory.sql oraz 20260928143000_seller_hotel_contact_organizations.sql.'
    : error?.message || 'Nie udało się wczytać bazy hotelu.';
}

/** Przestrzenie i kontakty hotelu organizacji (`get_seller_hotel_context` z organizacją, jak `HotelVenueSettings` w CRM). */
export async function hotelVenue(ctx: NativeContext, organizationParam: unknown) {
  const organizationId = optionalId(organizationParam, 'Nieprawidłowa organizacja.');
  if (!organizationId) fail('Wskaż organizację.');
  const { data, error } = await ctx.supabase.rpc('get_seller_hotel_context', { p_organization: organizationId });
  if (error) fail(hotelError(error), error.code === '42501' ? 403 : 400);
  const value = (isObject(data) ? data : {}) as Row;
  const location = isObject(value.location) ? value.location : null;
  const rooms = location && Array.isArray(location.rooms) ? location.rooms.filter(isObject).map(roomItem) : [];
  const technical = location && isObject(location.technical_details) ? location.technical_details : {};
  return {
    available: value.available === true,
    canEdit: value.can_edit === true,
    organization: isObject(value.organization) ? { id: str(value.organization.id), name: str(value.organization.name) } : null,
    location: location ? {
      id: str(location.id), name: str(location.name), rooms, technical,
      urls: await assetUrls(ctx, [technical, ...rooms.map((room) => room.technical)]),
    } : null,
    contacts: (Array.isArray(value.contacts) ? value.contacts : []).filter(isObject).map((person: Row) => ({
      id: str(person.id), name: str(person.name), role: str(person.role), email: str(person.email), phone: str(person.phone),
    })),
  };
}
