import 'server-only';
import { NextRequest } from 'next/server';
import type { NativeContext } from './auth';
import { GET as configurationGet, PUT as configurationPut } from '@/app/bridge/seller/catalog/[id]/configuration/route';
import type { OfferConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { isSellerLedPackage } from '@/lib/seller/ledPackage';

/*
 * Indywidualny cennik sprzedawcy na Macu — 1:1 ze stroną CRM `/crm/salespeople/[id]/pricing`: marki z aktywnymi warunkami,
 * pozycje (produkty i warianty widoczne w portalu) z ceną wewnętrzną, automatyczną (+20%), indywidualną i wynikową,
 * dostępnością i warunkami (nocleg, logistyka, wymagania) — `get_sales_partner_price_list` / `save_sales_partner_price_list`
 * tokenem pracownika (uprawnienia rozstrzyga baza). „Ceny konfiguracji i rozszerzeń” (`SellerComponentPrices`) — ta sama
 * trasa co CRM, `/bridge/seller/catalog/[id]/configuration?partner=…` (GET / PUT), wywołana tutaj bezpośrednio.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'offer-product-pages';
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
const idOf = (value: unknown, message: string) => {
  const id = str(value);
  if (!UUID.test(id)) fail(message);
  return id;
};

/** Nagłówek cennika: nazwa sprzedawcy, kontakt i marki z aktywnymi warunkami (jak pierwsze wczytanie strony w CRM). */
export async function sellerPricing(ctx: NativeContext, partnerParam: unknown) {
  const partnerId = idOf(partnerParam, 'Nieprawidłowy sprzedawca.');
  const [profileResult, termsResult, companiesResult] = await Promise.all([
    ctx.supabase.from('sales_partner_profiles').select('id,employee_id,contact_id').eq('id', partnerId).maybeSingle(),
    ctx.supabase.from('sales_partner_brand_terms').select('my_company_id,is_active').eq('sales_partner_id', partnerId).eq('is_active', true),
    ctx.supabase.from('my_companies').select('id,name').eq('is_active', true).order('name'),
  ]);
  if (profileResult.error || !profileResult.data) fail(profileResult.error?.message || 'Nie znaleziono sprzedawcy.', profileResult.error ? 400 : 404);
  const profile = profileResult.data as Row;
  let sellerName = 'Sprzedawca';
  if (profile.contact_id) {
    const { data } = await ctx.supabase.from('contacts').select('full_name').eq('id', profile.contact_id).maybeSingle();
    if ((data as Row | null)?.full_name) sellerName = str((data as Row).full_name);
  } else if (profile.employee_id) {
    const { data } = await ctx.supabase.from('employees').select('name,surname').eq('id', profile.employee_id).maybeSingle();
    if (data) sellerName = `${(data as Row).name || ''} ${(data as Row).surname || ''}`.trim() || 'Sprzedawca';
  }
  const activeIds = new Set(((termsResult.data || []) as Row[]).map((term) => str(term.my_company_id)));
  const brands = ((companiesResult.data || []) as Row[])
    .filter((company) => activeIds.has(str(company.id)))
    .map((company) => ({ id: str(company.id), name: str(company.name) }));
  const error = termsResult.error || companiesResult.error;
  return {
    id: partnerId,
    sellerName,
    contactId: str(profile.contact_id) || null,
    brands,
    message: error ? error.message || 'Nie udało się pobrać marek.' : null,
  };
}

/** Ścieżka w magazynie `offer-product-pages` albo adres zewnętrzny (jak `SellerPricingThumbnail` w CRM). */
function imageSource(value: unknown): string {
  const source = str(value).trim();
  if (!source) return '';
  if (/^https?:\/\//i.test(source)) {
    let url: URL;
    try { url = new URL(source); } catch { return ''; }
    let origin = '';
    try { origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin; } catch { origin = ''; }
    const prefix = new RegExp(`^/storage/v1/(?:object|render/image)/(?:public|sign|authenticated)/${BUCKET}/`);
    if (origin && url.origin === origin && prefix.test(url.pathname)) return decodeURIComponent(url.pathname.replace(prefix, ''));
    return source;
  }
  return source.replace(/^\/+/, '').replace(new RegExp(`^(?:public/)?${BUCKET}/`), '');
}

const amount = (value: unknown) => (value == null || value === '' ? null : Number(value));

/** Pozycje cennika jednej marki z miniaturami (podpisane adresy na godzinę). */
export async function sellerPriceList(ctx: NativeContext, partnerParam: unknown, brandParam: unknown) {
  const partnerId = idOf(partnerParam, 'Nieprawidłowy sprzedawca.');
  const brandId = idOf(brandParam, 'Wybierz markę.');
  const { data, error } = await ctx.supabase.rpc('get_sales_partner_price_list', { p_sales_partner_id: partnerId, p_company_id: brandId });
  if (error) fail(error.message || 'Nie udało się pobrać cennika.', error.code === '42501' ? 403 : 400);
  const response = (data || {}) as Row;
  if (response.access_policy !== 'explicit_grant') {
    return {
      blocked: 'Cennik wymaga migracji 20260908203000 w Supabase. Wprowadza ona dostęp do produktów wyłącznie po zaznaczeniu „Dostępny”. Do tego czasu zapis cennika jest wyłączony.',
      defaultMarkup: 20, items: [] as unknown[],
    };
  }
  const rows = (Array.isArray(response.items) ? response.items : []) as Row[];
  const sources = rows.map((row) => [imageSource(row.offer_image_path), imageSource(row.pdf_thumbnail_url)] as const);
  const paths = Array.from(new Set(sources.flat().filter((source) => source && !/^https?:\/\//i.test(source))));
  const signed = new Map<string, string>();
  for (let index = 0; index < paths.length; index += 200) {
    const { data: urls } = await ctx.supabase.storage.from(BUCKET).createSignedUrls(paths.slice(index, index + 200), 3600);
    ((urls || []) as Row[]).forEach((item) => { if (item?.path && item?.signedUrl) signed.set(str(item.path), str(item.signedUrl)); });
  }
  const resolve = (source: string) => (!source ? null : /^https?:\/\//i.test(source) ? source : signed.get(source) || null);
  return {
    blocked: null,
    defaultMarkup: Number(response.default_markup_percent || 20),
    items: rows.map((row, index) => {
      // Najpierw zdjęcie produktu do oferty, potem miniatura strony PDF — jak w CRM.
      const [image, fallback] = sources[index];
      const imageUrl = resolve(image) || resolve(fallback);
      return {
        productId: str(row.product_id),
        variantId: str(row.product_variant_id) || null,
        productName: str(row.product_name),
        variantName: str(row.variant_name) || null,
        imagePath: imageUrl ? (resolve(image) ? image : fallback) : null,
        imageUrl,
        unit: str(row.unit) || null,
        categoryName: str(row.category_name) || null,
        directPrice: Number(row.direct_price_net || 0),
        defaultPrice: Number(row.default_price_net || 0),
        price: amount(row.price_net),
        available: row.is_available === true,
        requiresAccommodation: row.requires_accommodation === true,
        accommodationNote: str(row.accommodation_note),
        logisticsCost: amount(row.estimated_logistics_cost),
        logisticsNote: str(row.logistics_note),
        requirements: str(row.additional_requirements),
      };
    }),
  };
}

/** „Zapisz cennik” — cała lista marki, jak w CRM (`save_sales_partner_price_list`). */
export async function saveSellerPriceList(ctx: NativeContext, body: Row) {
  const partnerId = idOf(body.id, 'Nieprawidłowy sprzedawca.');
  const brandId = idOf(body.brand, 'Wybierz markę.');
  if (!Array.isArray(body.items) || body.items.length > 5000) fail('Nieprawidłowa lista pozycji cennika.');
  const money = (value: unknown) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) fail('Podaj poprawne kwoty w cenniku.');
    if (number < 0) fail('Cena indywidualna i koszt logistyki nie mogą być ujemne.');
    return Math.round(number * 100) / 100;
  };
  const note = (value: unknown, max = 20000) => (typeof value === 'string' ? value.slice(0, max) : null);
  const items = (body.items as unknown[]).map((raw) => {
    const item = (raw && typeof raw === 'object' ? raw : {}) as Row;
    const productId = idOf(item.productId, 'Nieprawidłowy produkt w cenniku.');
    const variantId = item.variantId ? idOf(item.variantId, 'Nieprawidłowy wariant w cenniku.') : null;
    return {
      product_id: productId,
      product_variant_id: variantId,
      price_net: money(item.price),
      is_available: item.available === true,
      requires_accommodation: item.requiresAccommodation === true,
      accommodation_note: note(item.accommodationNote),
      estimated_logistics_cost: money(item.logisticsCost),
      logistics_note: note(item.logisticsNote),
      additional_requirements: note(item.requirements),
    };
  });
  const { error } = await ctx.supabase.rpc('save_sales_partner_price_list', { p_sales_partner_id: partnerId, p_company_id: brandId, p_items: items });
  if (error) fail(error.message || 'Nie udało się zapisać cennika.', error.code === '42501' ? 403 : 400);
  return { ok: true, message: 'Indywidualny cennik został zapisany.' };
}

// --- Ceny konfiguracji i rozszerzeń (`SellerComponentPrices`) ------------------------------------------------------------

function configurationRequest(request: Request, productId: string, brandId: string, partnerId: string, init: { method: 'GET' | 'PUT'; body?: string }) {
  const url = new URL(`/bridge/seller/catalog/${productId}/configuration`, request.url);
  url.searchParams.set('brand', brandId);
  url.searchParams.set('partner', partnerId);
  return new NextRequest(url, {
    method: init.method,
    headers: { authorization: request.headers.get('authorization') || '', 'content-type': 'application/json' },
    ...(init.body ? { body: init.body } : {}),
  });
}

async function readConfiguration(request: Request, productId: string, brandId: string, partnerId: string) {
  const response = await configurationGet(configurationRequest(request, productId, brandId, partnerId, { method: 'GET' }), { params: { id: productId } });
  const data = await response.json().catch(() => ({})) as Row;
  if (!response.ok) fail(str(data.error) || 'Nie udało się odczytać stawek.', response.status);
  const rates = (Array.isArray(data.rates) ? data.rates : []) as Row[];
  return {
    name: str(data.name),
    revision: str(data.revision),
    configurable: data.configurable === true,
    led: isSellerLedPackage((data.configuration || null) as OfferConfiguration | null),
    rates: rates.map((rate) => ({ key: str(rate.key), label: str(rate.label), price: rate.price == null ? null : Number(rate.price) })),
  };
}

/** Stawki konfiguracji i rozszerzeń produktu podstawowego dla sprzedawcy i marki (uprawnienia sprawdza trasa CRM). */
export async function sellerComponentPrices(request: Request, query: URLSearchParams) {
  const partnerId = idOf(query.get('id'), 'Nieprawidłowy sprzedawca.');
  const brandId = idOf(query.get('brand'), 'Wybierz markę.');
  const productId = idOf(query.get('product'), 'Nieprawidłowy produkt.');
  return readConfiguration(request, productId, brandId, partnerId);
}

/** „Zapisz stawki konfiguracji” — wersja (`revision`) chroni przed zapisem na nieaktualnych danych, jak w CRM. */
export async function saveSellerComponentPrices(request: Request, body: Row) {
  const partnerId = idOf(body.id, 'Nieprawidłowy sprzedawca.');
  const brandId = idOf(body.brand, 'Wybierz markę.');
  const productId = idOf(body.product, 'Nieprawidłowy produkt.');
  if (!Array.isArray(body.rates)) fail('Niekompletna lista stawek.');
  const rates = (body.rates as Row[]).map((rate) => {
    const price = rate?.price == null || rate.price === '' ? null : Number(rate.price);
    // Puste pole = „do wyceny”; błędna liczba nie może po cichu wyczyścić stawki.
    if (price !== null && !Number.isFinite(price)) fail('Podaj poprawne, nieujemne stawki z dwoma miejscami po przecinku lub pozostaw puste.');
    return { key: str(rate?.key), price };
  });
  const response = await configurationPut(configurationRequest(request, productId, brandId, partnerId, {
    method: 'PUT', body: JSON.stringify({ revision: str(body.revision), rates }),
  }), { params: { id: productId } });
  const data = await response.json().catch(() => ({})) as Row;
  if (!response.ok) fail(str(data.error) || 'Nie udało się zapisać stawek.', response.status);
  return {
    ...(await readConfiguration(request, productId, brandId, partnerId)),
    message: 'Stawki zapisane. Zapisane konfiguracje wcześniejszych ofert nie zostały przeliczone.',
  };
}
