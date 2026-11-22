import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { NativeContext } from '@/lib/native/auth';
import { SITE } from '@/lib/SEO/site';
import { brochurePalette } from '@/lib/brochures/decorativePages';
import { portfolioContentFromSite } from '@/lib/portfolio/portfolioShared';
import {
  brandbookPublicUrl, employeeNames, fail, isObject, isOwnPublicStorageUrl, isUuid, sniffImageType, text, uuidOrNull, type Row,
} from '@/lib/social/socialCommon.server';
import {
  materialAccess, materialCompanies, materialFileRow, materialSystemFolder, materialsAlbum, materialsAlbums, materialsStoreBytes,
} from '@/lib/materials/materials.server';
import { cleanMaterialName } from '@/lib/materials/materialsShared';
import { showcaseAiSuggest } from './showcaseAi.server';
import { processShowcasePhoto } from './showcasePhotos.server';
import {
  SHOWCASE_AI_FIELDS, SHOWCASE_EXAMPLE, SHOWCASE_LIMITS, defaultShowcaseContent, emptyShowcaseBlock, isShowcaseIcon, isShowcaseMediaPath,
  normalizeShowcaseContent, showcaseExampleContent, type ShowcaseAiField,
  normalizeShowcaseMedia, normalizeShowcaseProductIds, showcaseContentMedia, showcaseContentProductIds, showcaseContentRealizationIds,
  showcaseLine, showcaseMaterialPaths, showcaseMediaKey, showcaseProblemCount, showcaseText,
  applyShowcaseLayout, normalizeShowcaseLayout, type ShowcaseLayout,
  type ShowcaseAccess, type ShowcaseAlbumOption, type ShowcaseBlock, type ShowcaseBrand, type ShowcaseContent, type ShowcaseHome,
  type ShowcaseItemDetail, type ShowcaseItemSummary, type ShowcaseMedia, type ShowcasePhotoBase, type ShowcasePickPhoto,
  type ShowcasePoint, type ShowcaseProductView, type ShowcaseRealizationView, type ShowcaseSectionView, type ShowcaseUrls,
} from './showcaseShared';

/*
 * Strefa sprzedawcy → „Prezentacje” na serwerze Next — jedno API dla CRM, Maca i (w etapie 2) iPada
 * (`/bridge/native/v1/showcase`). Token pracownika — RLS i funkcje bazy z migracji 20261122100000 (`sales_showcase_*`).
 * Dostęp: podgląd — `presentations_view` albo dostęp do ofert; przygotowanie — `presentations_manage` albo `offers_manage`.
 * Produkty katalogu i realizacje ze strony czytane na bieżąco; zdjęcia własne — WebP w prywatnym buckecie `sales-showcase`.
 * Główna baza zdjęć to Materiały (marka → Zdjęcia, albumy): zdjęcie z dysku trafia do Materiałów (bez duplikatu tego samego
 * pliku), a karta trzyma odnośnik — do pokazu jedną wspólną wersję WebP na wersję treści pliku (migracja 20261122140000).
 */

const BUCKET = 'sales-showcase';
const PRODUCT_BUCKET = 'offer-product-pages';
const SECTION_FIELDS = 'id, title, subtitle, icon, cover, sort_order, is_active, version, updated_at';
const ITEM_FIELDS = 'id, section_id, title, tagline, product_ids, content, sort_order, is_active, version, created_at, created_by, updated_at, updated_by';
const SITE_FIELDS = 'id, title, slug, category, location, event_date, date, description, image, image_url, alt, image_metadata, gallery, gallery_images';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MANAGE_MESSAGE = 'Prezentacje przygotowuje osoba z uprawnieniem „Prezentacje — przygotowanie” albo „Zarządzanie ofertami”.';

/** Komunikat bazy albo czytelny zamiennik. */
function check(error: { message?: string; code?: string } | null | undefined, fallback: string): void {
  if (!error) return;
  const code = error.code || '';
  const message = error.message || '';
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    fail(code === '42501' && message && !/permission denied|row-level security/i.test(message) ? message : MANAGE_MESSAGE, 403);
  }
  if (code === '40001') fail(message || 'Dane zmieniono w innym oknie. Odśwież widok.', 409);
  if (code === 'P0002') fail(message || 'Nie znaleziono.', 404);
  if (code === '22023') fail(message || fallback, 400);
  if (code === '23514' || code === '23502' || code === '23503') fail(fallback, 400);
  if (code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205') {
    fail('Prezentacje nie są jeszcze włączone na serwerze — potrzebna migracja 20261122100000_sales_showcase.sql.', 503);
  }
  if (code.startsWith('PGRST')) fail(fallback, 400);
  fail(message || fallback);
}

async function showcaseAccess(ctx: NativeContext): Promise<ShowcaseAccess> {
  const { data, error } = await ctx.supabase.rpc('sales_showcase_access');
  if (error) check(error, 'Nie udało się sprawdzić dostępu do prezentacji.');
  return { view: isObject(data) && data.view === true, manage: isObject(data) && data.manage === true };
}

async function requireView(ctx: NativeContext) {
  const access = await showcaseAccess(ctx);
  if (!access.view) fail('Prezentacje widzi osoba z dostępem do ofert albo uprawnieniem „Prezentacje — podgląd”.', 403);
  return access;
}

async function requireManage(ctx: NativeContext) {
  const access = await showcaseAccess(ctx);
  if (!access.manage) fail(MANAGE_MESSAGE, 403);
  return access;
}

const num = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const positive = (value: unknown) => {
  const parsed = num(value);
  return parsed != null && parsed > 0 ? parsed : null;
};
const plain = (value: unknown, limit: number) =>
  showcaseText(text(value).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'), limit);
const stableId = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 16);
const q = (value: unknown) => text(value).trim().slice(0, 80).replace(/[%,()\\]/g, ' ').trim();

/** Zdjęcie z katalogu produktów (bez kopii — podpisany adres przy odczycie). */
function productMedia(path: unknown, caption: unknown): ShowcaseMedia | null {
  const value = text(path).trim();
  if (!value || !isShowcaseMediaPath('product', value)) return null;
  return { id: stableId(`product:${value}`), source: 'product', path: value, thumb: null, width: null, height: null, caption: showcaseLine(caption, SHOWCASE_LIMITS.caption) };
}

/** Zdjęcie realizacji ze strony (publiczny adres naszego Storage). */
function siteMedia(src: unknown, thumb: unknown, caption: unknown): ShowcaseMedia | null {
  const value = text(src).trim();
  if (!value || !isShowcaseMediaPath('site', value) || !isOwnPublicStorageUrl(value)) return null;
  const small = text(thumb).trim();
  return {
    id: stableId(`site:${value}`), source: 'site', path: value,
    thumb: small && isShowcaseMediaPath('site', small) && isOwnPublicStorageUrl(small) ? small : null,
    width: null, height: null, caption: showcaseLine(caption, SHOWCASE_LIMITS.caption),
  };
}

/** Treść z zapisu: adresy zdjęć ze strony tylko z naszego Storage. */
function cleanContent(raw: unknown): ShowcaseContent {
  const content = normalizeShowcaseContent(raw);
  const allowed = (media: ShowcaseMedia | null) => !media || media.source !== 'site' || isOwnPublicStorageUrl(media.path);
  return {
    ...content,
    hero: allowed(content.hero) ? content.hero : null,
    blocks: content.blocks.map((block) => ({ ...block, photos: block.photos.filter(allowed) })),
  };
}

// Podpisane adresy ----------------------------------------------------------------------------------------------------------

async function signPaths(ctx: NativeContext, bucket: string, paths: string[], ttl = 3600) {
  const urls = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  for (let start = 0; start < unique.length; start += 100) {
    const { data } = await ctx.supabase.storage.from(bucket).createSignedUrls(unique.slice(start, start + 100), ttl);
    for (const item of data || []) if (item?.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

/** Adresy zdjęć (klucz `showcaseMediaKey`): własne i produktów — podpisane na godzinę, ze strony — publiczne. */
async function mediaUrls(ctx: NativeContext, media: Array<ShowcaseMedia | null | undefined>): Promise<ShowcaseUrls> {
  const list = media.filter((item): item is ShowcaseMedia => Boolean(item));
  const uploads = list.filter((item) => item.source === 'upload' || item.source === 'material');
  const products = list.filter((item) => item.source === 'product');
  const [own, catalog] = await Promise.all([
    signPaths(ctx, BUCKET, uploads.flatMap((item) => [item.path, item.thumb || ''])),
    signPaths(ctx, PRODUCT_BUCKET, products.map((item) => item.path)),
  ]);
  const urls: ShowcaseUrls = {};
  for (const item of list) {
    const key = showcaseMediaKey(item);
    if (urls[key]) continue;
    if (item.source === 'upload' || item.source === 'material') {
      const url = own.get(item.path) || null;
      urls[key] = { url, thumb: (item.thumb && own.get(item.thumb)) || url };
    } else if (item.source === 'product') {
      const url = catalog.get(item.path) || null;
      urls[key] = { url, thumb: url };
    } else {
      urls[key] = { url: item.path, thumb: item.thumb || item.path };
    }
  }
  return urls;
}

/** Miniatury zdjęć produktów katalogu (`offer_image_path`) po identyfikatorze produktu — pozycje „Oferty ze spotkania”. */
export async function showcaseProductThumbs(ctx: NativeContext, rows: Row[]): Promise<Map<string, string>> {
  const images = rows.map((row) => productMedia(row.offer_image_path, row.offer_image_alt || row.name));
  const urls = await mediaUrls(ctx, images);
  const thumbs = new Map<string, string>();
  rows.forEach((row, index) => {
    const media = images[index];
    const thumb = media ? urls[showcaseMediaKey(media)]?.thumb : null;
    if (thumb) thumbs.set(String(row.id), thumb);
  });
  return thumbs;
}

// Marka -----------------------------------------------------------------------------------------------------------------------

/** Marka domyślnej firmy z księgi znaku: logo (domyślne), sygnet, kolory i fonty według ról (jak podgląd broszur). */
async function showcaseBrand(ctx: NativeContext): Promise<ShowcaseBrand> {
  const { data: companies } = await ctx.supabase.from('my_companies').select('id, name, is_default, is_active, logo_url')
    .order('is_default', { ascending: false }).order('name').limit(20);
  const company = ((companies || []) as Row[]).find((row) => row.is_active !== false) || null;
  if (!company) return { name: 'Mavinci', logoUrl: null, sygnetUrl: null, ...paletteOf([]), headingFont: null, bodyFont: null };
  const [logos, colors, fonts] = await Promise.all([
    ctx.supabase.from('company_brandbook_logos').select('url, variant, label, background, is_default, order_index').eq('company_id', company.id).order('order_index'),
    ctx.supabase.from('company_brandbook_colors').select('hex, role').eq('company_id', company.id),
    ctx.supabase.from('company_brandbook_fonts').select('family, role, file_url, storage_path, order_index').eq('company_id', company.id).order('order_index'),
  ]);
  const logoRows = (logos.data || []) as Row[];
  const logo = logoRows.find((row) => row.is_default) || logoRows.find((row) => row.background === 'transparent') || logoRows[0];
  const sygnet = logoRows.find((row) => row.variant === 'icon') || logoRows.find((row) => /sygnet|signature|icon/i.test(text(row.label)));
  const fontRows = (fonts.data || []) as Row[];
  const font = (role: string): ShowcaseBrand['headingFont'] => {
    const row = fontRows.find((item) => item.role === role && (item.file_url || item.storage_path)) || fontRows.find((item) => item.role === role);
    if (!row || !text(row.family).trim()) return null;
    const url = brandbookPublicUrl(row.storage_path) || (/^https:\/\//i.test(text(row.file_url)) ? text(row.file_url) : null);
    return { family: text(row.family).trim().slice(0, 120), url };
  };
  return {
    name: text(company.name) || 'Mavinci',
    logoUrl: brandbookPublicUrl(logo?.url || company.logo_url),
    sygnetUrl: brandbookPublicUrl(sygnet?.url),
    ...paletteOf((colors.data || []) as Array<{ hex: string; role: string }>),
    headingFont: font('heading'),
    bodyFont: font('body'),
  };
}

function paletteOf(colors: Array<{ hex: string; role: string }>) {
  const palette = brochurePalette(colors.map((color) => ({ role: text(color.role), hex: text(color.hex).slice(0, 7) })));
  return { accent: palette.primaryColor, surface: palette.secondaryColor };
}

// Działy i karty ----------------------------------------------------------------------------------------------------------------

function sectionView(row: Row, itemCount: number): ShowcaseSectionView {
  return {
    id: String(row.id),
    title: text(row.title),
    subtitle: text(row.subtitle),
    icon: isShowcaseIcon(row.icon) ? row.icon : 'sparkles',
    cover: normalizeShowcaseMedia(row.cover),
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order) || 0,
    version: Number(row.version) || 1,
    itemCount,
  };
}

async function productBasics(ctx: NativeContext, ids: string[]) {
  const map = new Map<string, { name: string; image: ShowcaseMedia | null }>();
  const unique = Array.from(new Set(ids.filter(isUuid)));
  for (let start = 0; start < unique.length; start += 150) {
    const { data } = await ctx.supabase.from('offer_products').select('id, name, offer_image_path, offer_image_alt').in('id', unique.slice(start, start + 150));
    for (const row of (data || []) as Row[]) {
      map.set(String(row.id), { name: text(row.name) || 'Produkt', image: productMedia(row.offer_image_path, row.offer_image_alt || row.name) });
    }
  }
  return map;
}

const LAYOUT_TABLE = 'sales_showcase_layouts';
const LAYOUT_MISSING = 'Własny układ prezentacji zapisze się po aktualizacji bazy (migracja 20261125120000_sales_showcase_layouts.sql).';
const tableMissing = (error: { code?: string } | null | undefined) => ['42P01', 'PGRST205', 'PGRST202'].includes(error?.code || '');

/** Własny układ pracownika (kolejność działów i kart, ukryte u niego); brak tabeli (starsza baza) — kolejność domyślna. */
async function readLayout(ctx: NativeContext): Promise<{ layout: ShowcaseLayout | null; available: boolean }> {
  const { data, error } = await ctx.supabase.from(LAYOUT_TABLE).select('sections, items').eq('employee_id', ctx.employee.id).maybeSingle();
  if (error) {
    if (tableMissing(error)) return { layout: null, available: false };
    check(error, 'Nie udało się pobrać układu prezentacji.');
  }
  return { layout: data ? normalizeShowcaseLayout(data) : null, available: true };
}

/** „Zapisz układ” — kolejność działów i kart oraz ukryte u pracownika (CRM, Mac, telefon, iPad). Treści i działów kart nie zmienia. */
export async function showcaseSaveLayout(ctx: NativeContext, body: Row) {
  await requireView(ctx);
  const layout = normalizeShowcaseLayout(body.layout);
  const { error } = await ctx.supabase.from(LAYOUT_TABLE).upsert({
    employee_id: ctx.employee.id, sections: layout.sections, items: layout.items, updated_at: new Date().toISOString(),
  }, { onConflict: 'employee_id' });
  if (error) {
    if (tableMissing(error)) fail(LAYOUT_MISSING, 503);
    check(error, 'Nie udało się zapisać układu prezentacji.');
  }
  return { ok: true, layout };
}

/** „Przywróć układ domyślny” — kolejność ustalona przy przygotowaniu, nic nie jest ukryte. */
export async function showcaseResetLayout(ctx: NativeContext) {
  await requireView(ctx);
  const { error } = await ctx.supabase.from(LAYOUT_TABLE).delete().eq('employee_id', ctx.employee.id);
  if (error) {
    if (tableMissing(error)) fail(LAYOUT_MISSING, 503);
    check(error, 'Nie udało się przywrócić układu domyślnego.');
  }
  return { ok: true };
}

/** Strona startowa: działy, karty (skrót) w układzie pracownika, adresy miniatur, marka i zakres pracownika. */
export async function showcaseHome(ctx: NativeContext): Promise<ShowcaseHome> {
  const access = await requireView(ctx);
  const [sections, items, brand] = await Promise.all([
    ctx.supabase.from('sales_showcase_sections').select(SECTION_FIELDS).order('sort_order').order('title'),
    ctx.supabase.from('sales_showcase_items').select(ITEM_FIELDS).order('sort_order').order('title'),
    showcaseBrand(ctx),
  ]);
  check(sections.error, 'Nie udało się pobrać działów prezentacji.');
  check(items.error, 'Nie udało się pobrać prezentacji.');
  const itemRows = (items.data || []) as Row[];
  const basics = await productBasics(ctx, itemRows.flatMap((row) => normalizeShowcaseProductIds(row.product_ids)));
  const thumbs: ShowcaseMedia[] = [];
  const summaries: ShowcaseItemSummary[] = itemRows.map((row) => {
    const content = normalizeShowcaseContent(row.content);
    const productIds = normalizeShowcaseProductIds(row.product_ids);
    const thumb = content.hero || showcaseContentMedia(content)[0] || productIds.map((id) => basics.get(id)?.image || null).find(Boolean) || null;
    if (thumb) thumbs.push(thumb);
    return {
      id: String(row.id),
      sectionId: String(row.section_id),
      title: text(row.title),
      tagline: text(row.tagline),
      isActive: row.is_active !== false,
      sortOrder: Number(row.sort_order) || 0,
      version: Number(row.version) || 1,
      thumbKey: thumb ? showcaseMediaKey(thumb) : null,
      productNames: productIds.map((id) => basics.get(id)?.name).filter((name): name is string => Boolean(name)),
      blockCount: content.blocks.length,
      problems: showcaseProblemCount({ title: text(row.title), productIds, content }),
      updatedAt: text(row.updated_at),
    };
  });
  const sectionViews = ((sections.data || []) as Row[]).map((row) => sectionView(row, summaries.filter((item) => item.sectionId === String(row.id)).length));
  const [urls, mine] = await Promise.all([mediaUrls(ctx, [...thumbs, ...sectionViews.map((section) => section.cover)]), readLayout(ctx)]);
  const arranged = applyShowcaseLayout(sectionViews, summaries, mine.layout);
  return { access, sections: arranged.sections, items: arranged.items, urls, brand, layout: mine.layout, personal: mine.available };
}

async function itemRow(ctx: NativeContext, id: unknown): Promise<Row> {
  if (!isUuid(id)) fail('Nie znaleziono karty prezentacji.', 404);
  const { data, error } = await ctx.supabase.from('sales_showcase_items').select(ITEM_FIELDS).eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać karty prezentacji.');
  if (!data) fail('Nie znaleziono karty prezentacji (usunięta albo ukryta).', 404);
  return data as Row;
}

async function sectionRow(ctx: NativeContext, id: unknown): Promise<Row> {
  if (!isUuid(id)) fail('Nie znaleziono działu.', 404);
  const { data, error } = await ctx.supabase.from('sales_showcase_sections').select(SECTION_FIELDS).eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać działu.');
  if (!data) fail('Nie znaleziono działu.', 404);
  return data as Row;
}

const textList = (value: unknown, limit: number): ShowcasePoint[] => (Array.isArray(value) ? value : []).flatMap((item) => {
  if (typeof item === 'string') {
    const line = plain(item, limit);
    return line ? [{ title: line, text: '' }] : [];
  }
  if (!isObject(item)) return [];
  const title = plain(item.title ?? item.name, 200);
  const body = plain(item.description ?? item.text ?? item.content, limit);
  return title || body ? [{ title: title || body, text: title ? body : '' }] : [];
});

/** Produkty katalogu na bieżąco (Oferty → Produkty): opis, korzyści, warianty, pakiety, wymagania, ustalenia z obiektem. */
async function catalogProducts(ctx: NativeContext, ids: string[]): Promise<ShowcaseProductView[]> {
  const unique = Array.from(new Set(ids.filter(isUuid)));
  if (!unique.length) return [];
  const { data, error } = await ctx.supabase.from('offer_products')
    .select('id, name, is_active, category_id, unit, price_net, price_gross, vat_rate, setup_time_hours, teardown_time_hours, offer_short_description, offer_compact_description, offer_description, public_description, description, offer_benefits, offer_requirements, offer_additional_requirements, offer_image_path, offer_image_alt, sales_packages_enabled, sales_packages, configuration_schema')
    .in('id', unique);
  check(error, 'Nie udało się pobrać produktów z katalogu.');
  const rows = (data || []) as Row[];
  const categoryIds = Array.from(new Set(rows.map((row) => row.category_id).filter(isUuid)));
  const [variants, preparation, categories] = await Promise.all([
    ctx.supabase.from('offer_product_variants')
      .select('id, product_id, name, short_description, description, benefits, price_net, price_gross, is_recommended, offer_image_path, offer_image_alt, display_order')
      .in('product_id', unique).eq('is_active', true).order('display_order'),
    ctx.supabase.from('offer_product_preparation_items').select('product_id, kind, title, details, lead_days, order_index')
      .in('product_id', unique).eq('is_active', true).eq('kind', 'venue_confirmation').order('order_index'),
    categoryIds.length ? ctx.supabase.from('event_categories').select('id, name').in('id', categoryIds) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const categoryName = new Map(((categories.data || []) as Row[]).map((row) => [String(row.id), text(row.name)]));
  const views = rows.map((row): ShowcaseProductView => {
    const productVariants = ((variants.data || []) as Row[]).filter((variant) => String(variant.product_id) === String(row.id));
    const packages = row.sales_packages_enabled === true && Array.isArray(row.sales_packages) ? (row.sales_packages as unknown[]).filter(isObject) : [];
    const additional = textList(row.offer_additional_requirements, 600);
    return {
      id: String(row.id),
      name: text(row.name) || 'Produkt',
      category: categoryName.get(text(row.category_id)) || '',
      isActive: row.is_active !== false,
      configurable: Boolean(row.configuration_schema),
      shortDescription: plain(row.offer_short_description || row.offer_compact_description, 600),
      description: plain(row.public_description || row.offer_description || row.description, 4000),
      image: productMedia(row.offer_image_path, row.offer_image_alt || row.name),
      unit: text(row.unit),
      priceNet: num(row.price_net),
      priceGross: num(row.price_gross),
      vatRate: num(row.vat_rate),
      benefits: textList(row.offer_benefits, 600),
      variants: productVariants.map((variant) => ({
        id: String(variant.id),
        name: text(variant.name) || 'Wariant',
        shortDescription: plain(variant.short_description, 600),
        description: plain(variant.description, 2000),
        benefits: (Array.isArray(variant.benefits) ? variant.benefits : []).map((benefit: unknown) => plain(benefit, 300)).filter(Boolean),
        image: productMedia(variant.offer_image_path, variant.offer_image_alt || variant.name),
        priceNet: num(variant.price_net),
        priceGross: num(variant.price_gross),
        recommended: variant.is_recommended === true,
      })),
      packages: packages.filter((item) => plain(item.name, 120)).map((item, index) => ({
        id: text(item.id) || `package-${index}`,
        name: plain(item.name, 120),
        description: plain(item.description, 1500),
        scope: plain(item.included_label, 600),
        bonus: plain(item.bonus, 600),
        image: productMedia(item.image_path, item.image_alt || item.name),
        priceNet: num(item.price_net),
        priceOnRequest: item.price_on_request === true,
        highlighted: item.highlighted === true,
      })),
      requirements: additional.length ? additional : textList(row.offer_requirements, 600),
      preparation: ((preparation.data || []) as Row[]).filter((step) => String(step.product_id) === String(row.id)).map((step) => ({
        title: plain(step.title, 200),
        details: plain(step.details, 1000),
        leadDays: num(step.lead_days),
      })),
      setupHours: positive(row.setup_time_hours),
      teardownHours: positive(row.teardown_time_hours),
    };
  });
  return unique.map((id) => views.find((view) => view.id === id)).filter((view): view is ShowcaseProductView => Boolean(view));
}

function realizationView(row: Row): ShowcaseRealizationView {
  const content = portfolioContentFromSite(row);
  const photos = [...(content.image ? [content.image] : []), ...content.gallery]
    .map((photo) => siteMedia(photo.src, photo.thumb || photo.mobile, photo.alt || content.title))
    .filter((photo): photo is ShowcaseMedia => Boolean(photo))
    .filter((photo, index, all) => all.findIndex((other) => other.path === photo.path) === index)
    .slice(0, 16);
  const slug = text(row.slug);
  return {
    id: String(row.id),
    title: content.title || 'Realizacja',
    location: content.location,
    date: content.eventDate,
    category: content.category,
    description: content.description,
    photos,
    siteUrl: slug ? `${SITE.url}/portfolio/${encodeURIComponent(slug)}` : null,
  };
}

async function realizationViews(ctx: NativeContext, ids: string[]): Promise<ShowcaseRealizationView[]> {
  const unique = Array.from(new Set(ids.filter(isUuid)));
  if (!unique.length) return [];
  const { data, error } = await ctx.supabase.from('portfolio_projects').select(SITE_FIELDS).in('id', unique);
  check(error, 'Nie udało się pobrać realizacji ze strony.');
  const views = ((data || []) as Row[]).map(realizationView);
  return unique.map((id) => views.find((view) => view.id === id)).filter((view): view is ShowcaseRealizationView => Boolean(view));
}

const productMediaList = (products: ShowcaseProductView[]) => products.flatMap((product) => [
  product.image, ...product.variants.map((variant) => variant.image), ...product.packages.map((item) => item.image),
]);

/** Karta: treść, produkty i realizacje na bieżąco, adresy zdjęć. */
async function detail(ctx: NativeContext, row: Row): Promise<ShowcaseItemDetail> {
  const content = normalizeShowcaseContent(row.content);
  const productIds = normalizeShowcaseProductIds(row.product_ids);
  const [products, realizations, names] = await Promise.all([
    catalogProducts(ctx, showcaseContentProductIds(productIds, content)),
    realizationViews(ctx, showcaseContentRealizationIds(content)),
    employeeNames(ctx.supabase, [row.created_by, row.updated_by]),
  ]);
  const name = (id: unknown) => (isUuid(id) ? names.get(id.toLowerCase()) || null : null);
  const urls = await mediaUrls(ctx, [
    ...showcaseContentMedia(content), ...productMediaList(products), ...realizations.flatMap((item) => item.photos),
  ]);
  return {
    item: {
      id: String(row.id),
      sectionId: String(row.section_id),
      title: text(row.title),
      tagline: text(row.tagline),
      isActive: row.is_active !== false,
      productIds,
      content,
      version: Number(row.version) || 1,
      createdAt: text(row.created_at),
      createdByName: name(row.created_by),
      updatedAt: text(row.updated_at),
      updatedByName: name(row.updated_by),
    },
    products,
    realizations,
    urls,
  };
}

/** Produkt katalogu na bieżąco (warianty, pakiety, ceny) — „Dodaj pozycję” w ofercie ze spotkania. */
export async function showcaseProductDetail(ctx: NativeContext, id: string) {
  await requireView(ctx);
  const [product] = await catalogProducts(ctx, [id]);
  if (!product) fail('Nie znaleziono produktu w katalogu.', 404);
  return { product, urls: await mediaUrls(ctx, productMediaList([product])) };
}

export async function showcaseItem(ctx: NativeContext, id: string) {
  await requireView(ctx);
  return detail(ctx, await itemRow(ctx, id));
}

// Asystent AI -------------------------------------------------------------------------------------------------------------------

/**
 * Propozycje treści karty z danych produktów katalogu (bieżący szkic z edytora: tytuł, hasło, wstęp, produkty) i opisu od
 * sprzedawcy. Nic się nie zapisuje — edytor wstawia wybrane propozycje do szkicu.
 */
export async function showcaseAssist(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const fields = (Array.isArray(body.fields) ? body.fields : []).filter((field: unknown): field is ShowcaseAiField =>
    (SHOWCASE_AI_FIELDS as readonly string[]).includes(String(field)));
  const content = normalizeShowcaseContent(body.content);
  const products = await catalogProducts(ctx, showcaseContentProductIds(normalizeShowcaseProductIds(body.productIds), content));
  return showcaseAiSuggest({
    title: showcaseLine(body.title, SHOWCASE_LIMITS.title),
    tagline: showcaseLine(body.tagline, SHOWCASE_LIMITS.tagline),
    lead: content.lead,
    brief: showcaseText(body.brief, 2000),
    products,
    fields: Array.from(new Set(fields)),
  });
}

// Zapis: działy ---------------------------------------------------------------------------------------------------------------

/** Nowy albo zmieniony dział (wersja chroni przed nadpisaniem zmian z innego okna). */
export async function showcaseSaveSection(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const title = showcaseLine(body.title, SHOWCASE_LIMITS.sectionTitle);
  if (!title) fail('Podaj nazwę działu.', 400);
  const patch: Row = {
    title,
    subtitle: showcaseLine(body.subtitle, SHOWCASE_LIMITS.sectionSubtitle),
    icon: isShowcaseIcon(body.icon) ? body.icon : 'sparkles',
    is_active: body.isActive !== false,
  };
  if ('cover' in body) {
    const cover = normalizeShowcaseMedia(body.cover);
    patch.cover = cover && (cover.source !== 'site' || isOwnPublicStorageUrl(cover.path)) ? cover : null;
  }
  if (body.id) {
    const row = await sectionRow(ctx, body.id);
    const version = Number(body.version);
    if (!Number.isInteger(version) || version !== Number(row.version)) fail('Dział zmieniono w innym oknie. Odśwież widok — zmiany nie zostały zapisane.', 409);
    const { data, error } = await ctx.supabase.from('sales_showcase_sections').update(patch).eq('id', row.id).eq('version', version).select(SECTION_FIELDS);
    check(error, 'Nie udało się zapisać działu.');
    if (!data?.length) fail('Dział zmieniono w innym oknie. Odśwież widok — zmiany nie zostały zapisane.', 409);
    const oldCover = normalizeShowcaseMedia(row.cover);
    if (oldCover && 'cover' in patch && showcaseMediaKey(oldCover) !== (patch.cover ? showcaseMediaKey(patch.cover) : '')) await removeUnused(ctx, [oldCover]);
    return { section: sectionView(data[0] as Row, 0) };
  }
  const { data: last } = await ctx.supabase.from('sales_showcase_sections').select('sort_order').order('sort_order', { ascending: false }).limit(1);
  patch.sort_order = (Number((last as Row[] | null)?.[0]?.sort_order) || 0) + 1;
  const { data, error } = await ctx.supabase.from('sales_showcase_sections').insert(patch).select(SECTION_FIELDS).single();
  check(error, 'Nie udało się utworzyć działu.');
  return { section: sectionView(data as Row, 0) };
}

/** Usunięcie działu razem z kartami (potwierdzenie w aplikacji), zdjęcia — gdy nikt ich już nie używa. */
export async function showcaseDeleteSection(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const row = await sectionRow(ctx, body.id);
  const { data: items, error: itemsError } = await ctx.supabase.from('sales_showcase_items').select('id, content').eq('section_id', row.id);
  check(itemsError, 'Nie udało się pobrać kart działu.');
  const rows = (items || []) as Row[];
  if (rows.length && body.withItems !== true) {
    const n = rows.length;
    const word = n === 1 ? 'kartę' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'karty' : 'kart';
    fail(`Dział ma ${n} ${word} — potwierdź usunięcie razem z kartami.`, 409);
  }
  const { error } = await ctx.supabase.from('sales_showcase_sections').delete().eq('id', row.id);
  check(error, 'Nie udało się usunąć działu.');
  await removeUnused(ctx, [normalizeShowcaseMedia(row.cover), ...rows.flatMap((item) => showcaseContentMedia(normalizeShowcaseContent(item.content)))]);
  return { deleted: String(row.id), items: rows.length };
}

/** Kolejność działów (przeciąganie). */
export async function showcaseReorderSections(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const ids = Array.isArray(body.ids) ? body.ids.filter(isUuid) : [];
  if (!ids.length) fail('Nieprawidłowa kolejność.', 400);
  const { error } = await ctx.supabase.rpc('sales_showcase_reorder', { p_section: null, p_ids: ids });
  check(error, 'Nie udało się zmienić kolejności działów.');
  return { ok: true };
}

/** Kolejność kart w dziale; karta przeciągnięta z innego działu przechodzi do tego działu. */
export async function showcaseReorderItems(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const sectionId = uuidOrNull(body.sectionId);
  if (!sectionId) fail('Wybierz dział.', 400);
  const ids = Array.isArray(body.ids) ? body.ids.filter(isUuid) : [];
  if (!ids.length) fail('Nieprawidłowa kolejność.', 400);
  const { error } = await ctx.supabase.rpc('sales_showcase_reorder', { p_section: sectionId, p_ids: ids });
  check(error, 'Nie udało się zmienić kolejności kart.');
  return { ok: true };
}

// Zapis: karty ----------------------------------------------------------------------------------------------------------------

async function nextItemOrder(ctx: NativeContext, sectionId: string) {
  const { data } = await ctx.supabase.from('sales_showcase_items').select('sort_order').eq('section_id', sectionId).order('sort_order', { ascending: false }).limit(1);
  return (Number((data as Row[] | null)?.[0]?.sort_order) || 0) + 1;
}

/** Treść karty z produktu katalogu: zdjęcia produktu, wstęp, korzyści, warianty, pakiety, przygotowanie (bloki katalogu). */
function contentFromProduct(product: ShowcaseProductView): ShowcaseContent {
  const photos = [product.image, ...product.variants.map((variant) => variant.image), ...product.packages.map((item) => item.image)]
    .filter((photo): photo is ShowcaseMedia => Boolean(photo))
    .filter((photo, index, all) => all.findIndex((other) => other.path === photo.path) === index)
    .slice(0, 12);
  const looks: ShowcaseBlock = { ...emptyShowcaseBlock('photos', 'large'), photos };
  const blocks: ShowcaseBlock[] = [looks];
  blocks.push(product.benefits.length ? emptyShowcaseBlock('catalog', 'benefits', product.id) : emptyShowcaseBlock('points', 'benefits'));
  if (product.variants.length) blocks.push(emptyShowcaseBlock('catalog', 'variants', product.id));
  if (product.packages.length) blocks.push(emptyShowcaseBlock('catalog', 'packages', product.id));
  blocks.push(emptyShowcaseBlock('photos', 'grid'));
  blocks.push(product.requirements.length || product.preparation.length || product.setupHours != null
    ? emptyShowcaseBlock('catalog', 'preparation', product.id) : emptyShowcaseBlock('points', 'steps'));
  blocks.push(emptyShowcaseBlock('faq'));
  return normalizeShowcaseContent({
    lead: product.shortDescription || product.description.split('\n\n')[0] || '',
    hero: product.image,
    blocks,
  });
}

/**
 * Nowa karta w dziale — pusta (szkielet pokazu), z produktu katalogu („Utwórz z produktu”) albo z przykładu z instrukcji
 * („Utwórz kartę z przykładu” — ukryta do czasu uzupełnienia zdjęć).
 */
export async function showcaseCreateItem(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const section = await sectionRow(ctx, body.sectionId);
  const productId = uuidOrNull(body.productId);
  let title = showcaseLine(body.title, SHOWCASE_LIMITS.title);
  let content = defaultShowcaseContent();
  let productIds: string[] = [];
  let tagline = '';
  const example = body.example === true;
  if (example) {
    content = showcaseExampleContent();
    title = showcaseLine(SHOWCASE_EXAMPLE.title, SHOWCASE_LIMITS.title);
    tagline = showcaseLine(SHOWCASE_EXAMPLE.tagline, SHOWCASE_LIMITS.tagline);
  } else if (productId) {
    const [product] = await catalogProducts(ctx, [productId]);
    if (!product) fail('Nie znaleziono produktu w katalogu.', 404);
    content = contentFromProduct(product);
    productIds = [product.id];
    if (!title) title = showcaseLine(product.name, SHOWCASE_LIMITS.title);
  }
  const { data, error } = await ctx.supabase.from('sales_showcase_items').insert({
    section_id: section.id,
    title: title || 'Nowa karta',
    tagline,
    product_ids: productIds,
    content,
    sort_order: await nextItemOrder(ctx, String(section.id)),
    is_active: example ? false : body.isActive !== false,
  }).select(ITEM_FIELDS).single();
  check(error, 'Nie udało się utworzyć karty.');
  return detail(ctx, data as Row);
}

/** Zapis karty (wersja chroni przed nadpisaniem zmian z innego okna); zdjęcia usunięte z karty — z magazynu, gdy nieużywane. */
export async function showcaseSaveItem(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const row = await itemRow(ctx, body.id);
  const version = Number(body.version);
  if (!Number.isInteger(version) || version !== Number(row.version)) fail('Kartę zmieniono w innym oknie. Odśwież widok — Twoje zmiany nie zostały zapisane.', 409);
  const title = showcaseLine(body.title, SHOWCASE_LIMITS.title);
  if (!title) fail('Podaj tytuł karty.', 400);
  const content = cleanContent(body.content);
  const patch: Row = {
    title,
    tagline: showcaseLine(body.tagline, SHOWCASE_LIMITS.tagline),
    product_ids: normalizeShowcaseProductIds(body.productIds),
    content,
    is_active: body.isActive !== false,
  };
  const { data, error } = await ctx.supabase.from('sales_showcase_items').update(patch).eq('id', row.id).eq('version', version).select(ITEM_FIELDS);
  check(error, 'Nie udało się zapisać karty.');
  if (!data?.length) fail('Kartę zmieniono w innym oknie. Odśwież widok — Twoje zmiany nie zostały zapisane.', 409);
  const kept = new Set(showcaseContentMedia(content).map(showcaseMediaKey));
  await removeUnused(ctx, showcaseContentMedia(normalizeShowcaseContent(row.content)).filter((media) => !kept.has(showcaseMediaKey(media))));
  return detail(ctx, data[0] as Row);
}

/** Kopia karty na końcu działu (ukryta do czasu poprawek); zdjęcia wspólne z oryginałem. */
export async function showcaseDuplicateItem(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const row = await itemRow(ctx, body.id);
  const suffix = ' (kopia)';
  const { data, error } = await ctx.supabase.from('sales_showcase_items').insert({
    section_id: row.section_id,
    title: `${text(row.title).slice(0, SHOWCASE_LIMITS.title - suffix.length)}${suffix}`,
    tagline: text(row.tagline),
    product_ids: normalizeShowcaseProductIds(row.product_ids),
    content: normalizeShowcaseContent(row.content),
    sort_order: await nextItemOrder(ctx, String(row.section_id)),
    is_active: false,
  }).select(ITEM_FIELDS).single();
  check(error, 'Nie udało się skopiować karty.');
  return detail(ctx, data as Row);
}

export async function showcaseDeleteItem(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const row = await itemRow(ctx, body.id);
  const { error } = await ctx.supabase.from('sales_showcase_items').delete().eq('id', row.id);
  check(error, 'Nie udało się usunąć karty.');
  await removeUnused(ctx, showcaseContentMedia(normalizeShowcaseContent(row.content)));
  return { deleted: String(row.id) };
}

/** Usuwa z magazynu własne zdjęcia i wersje zdjęć z Materiałów, których nie używa już żadna karta ani okładka działu. */
async function removeUnused(ctx: NativeContext, media: Array<ShowcaseMedia | null | undefined>) {
  const candidates = Array.from(new Set(media.filter((item): item is ShowcaseMedia => item?.source === 'upload' || item?.source === 'material')
    .flatMap((item) => [item.path, item.thumb || '']).filter(Boolean)));
  if (!candidates.length) return;
  const [items, sections] = await Promise.all([
    ctx.supabase.from('sales_showcase_items').select('content'),
    ctx.supabase.from('sales_showcase_sections').select('cover'),
  ]);
  if (items.error || sections.error) return;
  const used = new Set<string>();
  const mark = (item: ShowcaseMedia | null) => {
    if (item?.source !== 'upload' && item?.source !== 'material') return;
    used.add(item.path);
    if (item.thumb) used.add(item.thumb);
  };
  for (const row of (items.data || []) as Row[]) showcaseContentMedia(normalizeShowcaseContent(row.content)).forEach(mark);
  for (const row of (sections.data || []) as Row[]) mark(normalizeShowcaseMedia(row.cover));
  const unused = candidates.filter((path) => !used.has(path));
  if (!unused.length) return;
  const { error } = await ctx.supabase.storage.from(BUCKET).remove(unused);
  if (error) console.warn('[showcase] remove', error.message);
}

// Zdjęcia --------------------------------------------------------------------------------------------------------------------

type Target = { folder: 'items' | 'sections'; id: string };

async function resolveTarget(ctx: NativeContext, input: { itemId?: unknown; sectionId?: unknown }): Promise<Target> {
  if (input.itemId) return { folder: 'items', id: String((await itemRow(ctx, input.itemId)).id) };
  if (input.sectionId) return { folder: 'sections', id: String((await sectionRow(ctx, input.sectionId)).id) };
  fail('Wybierz kartę albo dział.', 400);
}

/** Dwie wersje WebP w `sales-showcase/<items|sections>/<id>/` → zdjęcie do dodania w edytorze (zapis karty — „Zapisz”). */
async function storePhoto(ctx: NativeContext, target: Target, bytes: Buffer, caption: string) {
  if (bytes.length > SHOWCASE_LIMITS.uploadBytes) fail('Zdjęcie może mieć najwyżej 40 MB.', 413);
  const type = sniffImageType(bytes);
  if (!type) fail('Ten plik nie jest zdjęciem JPEG, PNG ani WebP.', 415);
  const processed = await processShowcasePhoto(bytes, type);
  const base = `${target.folder}/${target.id}/${Date.now()}-${randomBytes(4).toString('hex')}`;
  const upload = async (path: string, data: Buffer) => {
    const { error } = await ctx.supabase.storage.from(BUCKET).upload(path, data, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    if (error) {
      console.error('[showcase] upload', error.message);
      const denied = /row-level security|unauthorized|403/i.test(error.message || '');
      fail(denied ? MANAGE_MESSAGE : 'Nie udało się zapisać zdjęcia.', denied ? 403 : 502);
    }
  };
  const path = `${base}.webp`;
  const thumb = `${base}-t.webp`;
  await Promise.all([upload(path, processed.display), upload(thumb, processed.thumb)]);
  const photo: ShowcaseMedia = {
    id: stableId(`upload:${path}`), source: 'upload', path, thumb, width: processed.width, height: processed.height,
    caption: showcaseLine(caption, SHOWCASE_LIMITS.caption),
  };
  return { photo, urls: await mediaUrls(ctx, [photo]) };
}

// Baza zdjęć (Materiały) ------------------------------------------------------------------------------------------------------

const MATERIAL_DISPLAY_SIDE = 2560;

/** Gdzie trafiają zdjęcia z dysku: pierwsza marka z prawem zmian w Materiałach (domyślna najpierw) → folder „Zdjęcia”. */
async function photoBase(ctx: NativeContext): Promise<ShowcasePhotoBase> {
  const companies = await materialCompanies(ctx).catch(() => []);
  const company = companies.find((item) => item.access.manage);
  if (!company) return null;
  const folder = await materialSystemFolder(ctx, company.id, 'photos');
  return { companyId: company.id, companyName: company.name, folderId: folder?.id || null, folderName: folder?.name || company.name };
}

const alreadyStored = (error: { message?: string; statusCode?: string | number } | null) =>
  Boolean(error && (String(error.statusCode || '') === '409' || /already exists|duplicate/i.test(error.message || '')));

/**
 * Zdjęcie z Materiałów w prezentacji: jedna wersja WebP (2560 px + miniatura) na wersję treści pliku, wspólna dla wszystkich
 * kart i okładek. Gotowa wersja nie powstaje drugi raz. `bytes` — treść pliku, gdy serwer już ją ma (zdjęcie z dysku).
 */
async function materialRendition(ctx: NativeContext, file: Row, caption: string, bytes?: Buffer): Promise<ShowcaseMedia> {
  if (file.status !== 'ready') fail('Plik w Materiałach jest jeszcze wysyłany. Spróbuj za chwilę.', 409);
  if (!IMAGE_TYPES.includes(text(file.mime_type).toLowerCase())) fail('W prezentacji można użyć zdjęć JPEG, PNG i WebP z Materiałów.', 415);
  const version = Math.max(1, Number(file.content_version) || 1);
  const { path, thumb } = showcaseMaterialPaths(String(file.id), version);
  const { data: listed } = await ctx.supabase.storage.from(BUCKET).list(`materials/${String(file.id).toLowerCase()}`, { limit: 100 });
  const names = new Set(((listed || []) as Array<{ name?: string }>).map((item) => item.name || ''));
  let width: number | null = null;
  let height: number | null = null;
  if (names.has(path.split('/').pop()!) && names.has(thumb.split('/').pop()!)) {
    const W = Number(file.width) || 0;
    const H = Number(file.height) || 0;
    if (W > 0 && H > 0) {
      const scale = Math.min(1, MATERIAL_DISPLAY_SIDE / Math.max(W, H));
      width = Math.max(1, Math.round(W * scale));
      height = Math.max(1, Math.round(H * scale));
    }
  } else {
    const source = bytes ?? await download(ctx, 'materials', String(file.storage_path), file.size_bytes);
    const type = sniffImageType(source);
    if (!type) fail('Ten plik nie jest zdjęciem JPEG, PNG ani WebP.', 415);
    const processed = await processShowcasePhoto(source, type);
    const put = async (target: string, data: Buffer) => {
      const { error } = await ctx.supabase.storage.from(BUCKET).upload(target, data, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
      if (error && !alreadyStored(error as { message?: string; statusCode?: string })) {
        console.error('[showcase] material rendition', error.message);
        const denied = /row-level security|unauthorized|403/i.test(error.message || '');
        fail(denied ? MANAGE_MESSAGE : 'Nie udało się przygotować zdjęcia do prezentacji.', denied ? 403 : 502);
      }
    };
    await Promise.all([put(path, processed.display), put(thumb, processed.thumb)]);
    width = processed.width;
    height = processed.height;
  }
  return {
    id: stableId(`material:${path}`), source: 'material', path, thumb, width, height,
    caption: showcaseLine(caption, SHOWCASE_LIMITS.caption),
  };
}

const baseName = (name: unknown) => text(name).replace(/\.[A-Za-z0-9]{2,5}$/, '');

/** Okno wyboru zdjęć: gdzie trafiają zdjęcia z dysku i albumy bazy zdjęć (Materiały → Albumy). */
export async function showcasePhotoBase(ctx: NativeContext) {
  await requireManage(ctx);
  const access = await materialAccess(ctx, null);
  if (!access.view) {
    return { base: null as ShowcasePhotoBase, albums: [] as ShowcaseAlbumOption[], canView: false,
      problem: 'Baza zdjęć to Materiały — potrzebne uprawnienie „Materiały — podgląd” (wgrywanie: „Materiały — zarządzanie”).' };
  }
  const [base, albumReply, companies] = await Promise.all([
    photoBase(ctx),
    materialsAlbums(ctx, new URLSearchParams()).catch(() => ({ albums: [] as Array<Record<string, any>> })),
    ctx.supabase.from('my_companies').select('id, name'),
  ]);
  const companyName = new Map(((companies.data || []) as Row[]).map((row) => [String(row.id), text(row.name)]));
  const albums: ShowcaseAlbumOption[] = (albumReply.albums || []).map((album: Record<string, any>) => ({
    id: String(album.id), companyId: String(album.companyId), companyName: companyName.get(String(album.companyId)) || '',
    name: text(album.name) || 'Album', count: Number(album.count) || 0, thumbnailUrl: album.coverUrl || null,
  }));
  return { base, albums, canView: true, problem: '' };
}

/**
 * Zdjęcie z dysku / Findera (`POST ?op=upload&item=<karta>` albo `&section=<dział>`). Z `&base=1` (CRM, Mac, aplikacja od u124)
 * zdjęcie trafia do bazy zdjęć — Materiały → marka → Zdjęcia (ten sam plik drugi raz się nie zapisze) — a karta dostaje
 * odnośnik; bez prawa zmian w Materiałach — jak dotąd, do prezentacji. `&name=` — nazwa pliku w Materiałach.
 */
export async function showcaseUpload(ctx: NativeContext, params: URLSearchParams, bytes: Buffer) {
  await requireManage(ctx);
  if (params.get('base') === '1') {
    if (bytes.length > SHOWCASE_LIMITS.uploadBytes) fail('Zdjęcie może mieć najwyżej 40 MB.', 413);
    const base = await photoBase(ctx);
    if (base) {
      const type = sniffImageType(bytes);
      if (!type) fail('Ten plik nie jest zdjęciem JPEG, PNG ani WebP.', 415);
      const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const fallbackName = `zdjecie-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${extension}`;
      const name = cleanMaterialName(params.get('name')) || fallbackName;
      const { row, existing } = await materialsStoreBytes(ctx, { companyId: base.companyId, folderId: base.folderId, name, mime: type, bytes });
      const photo = await materialRendition(ctx, row, text(params.get('caption')) || baseName(row.name), bytes);
      return {
        photo, urls: await mediaUrls(ctx, [photo]), stored: 'materials' as const, existing,
        file: { id: String(row.id), name: text(row.name), folderName: base.folderName, companyName: base.companyName },
      };
    }
  }
  const target = await resolveTarget(ctx, { itemId: params.get('item') || undefined, sectionId: params.get('section') || undefined });
  return { ...(await storePhoto(ctx, target, bytes, text(params.get('caption')))), stored: 'presentation' as const, existing: false, file: null };
}

async function download(ctx: NativeContext, bucket: string, path: string, size: unknown) {
  if (Number(size) > SHOWCASE_LIMITS.uploadBytes) fail('Zdjęcie może mieć najwyżej 40 MB.', 413);
  const { data, error } = await ctx.supabase.storage.from(bucket).download(path);
  if (error || !data) fail('Nie udało się pobrać zdjęcia.', 502);
  return Buffer.from(await data.arrayBuffer());
}

/**
 * Zdjęcie z innego miejsca: produkt katalogu i realizacja ze strony — bez kopii (odwołanie), Materiały, pliki wydarzenia
 * i biblioteka social media — kopia WebP w prezentacjach (uprawnienia do źródła sprawdza baza).
 */
export async function showcaseImport(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const caption = text(body.caption);
  if (body.source === 'product') {
    const [product] = await catalogProducts(ctx, [text(body.productId)]);
    if (!product) fail('Nie znaleziono produktu w katalogu.', 404);
    const photo = productMediaList([product]).find((media) => media?.path === text(body.path));
    if (!photo) fail('Nie znaleziono zdjęcia produktu.', 404);
    const media = { ...photo, caption: showcaseLine(caption, SHOWCASE_LIMITS.caption) || photo.caption };
    return { photo: media, urls: await mediaUrls(ctx, [media]) };
  }
  if (body.source === 'site') {
    const [realization] = await realizationViews(ctx, [text(body.realizationId)]);
    if (!realization) fail('Nie znaleziono realizacji na stronie.', 404);
    const photo = realization.photos.find((media) => media.path === text(body.path));
    if (!photo) fail('Nie znaleziono zdjęcia realizacji.', 404);
    const media = { ...photo, caption: showcaseLine(caption, SHOWCASE_LIMITS.caption) || photo.caption };
    return { photo: media, urls: await mediaUrls(ctx, [media]) };
  }
  const fileId = uuidOrNull(body.fileId);
  if (!fileId) fail('Wybierz zdjęcie.', 400);
  if (body.source === 'material' && body.reference === true) {
    // Baza zdjęć: odnośnik do pliku Materiałów (wspólna wersja WebP do pokazu), bez kopii w karcie.
    const file = await materialFileRow(ctx, fileId);
    const photo = await materialRendition(ctx, file, caption || baseName(file.name));
    return { photo, urls: await mediaUrls(ctx, [photo]) };
  }
  let bytes: Buffer;
  if (body.source === 'event') {
    const { data: file, error } = await ctx.supabase.from('event_files').select('file_path, mime_type, file_size').eq('id', fileId).maybeSingle();
    if (error) fail('Nie masz dostępu do plików tego eventu.', 403);
    if (!file || !IMAGE_TYPES.includes(text(file.mime_type))) fail('Nie znaleziono zdjęcia w plikach eventu.', 404);
    bytes = await download(ctx, 'event-files', String(file.file_path), file.file_size);
  } else if (body.source === 'material') {
    const { data: file, error } = await ctx.supabase.from('material_files').select('storage_path, mime_type, size_bytes, status').eq('id', fileId).maybeSingle();
    if (error) fail('Materiały nie są dostępne albo nie masz do nich dostępu.', 403);
    if (!file || file.status !== 'ready' || !IMAGE_TYPES.includes(text(file.mime_type))) fail('Nie znaleziono zdjęcia w Materiałach.', 404);
    bytes = await download(ctx, 'materials', String(file.storage_path), file.size_bytes);
  } else if (body.source === 'social') {
    const { data: asset, error } = await ctx.supabase.from('social_assets').select('work_path, storage_path, status').eq('id', fileId).maybeSingle();
    if (error) fail('Biblioteka social media nie jest dostępna.', 403);
    if (!asset || !['ready', 'proposed'].includes(text(asset.status))) fail('Nie znaleziono zdjęcia w bibliotece social media.', 404);
    bytes = await download(ctx, 'social-media', text(asset.work_path) || String(asset.storage_path), 0);
  } else {
    fail('Nieznane źródło zdjęcia.', 400);
  }
  // Kopia (social media, starsze wersje aplikacji: Materiały bez odnośnika, pliki wydarzenia) — do karty albo działu.
  const target = await resolveTarget(ctx, { itemId: body.itemId, sectionId: body.sectionId });
  return storePhoto(ctx, target, bytes, caption);
}

// Wybór: produkty, realizacje, zdjęcia, wydarzenia ------------------------------------------------------------------------------

/** Produkty katalogu do powiązania z kartą (wyszukiwanie po nazwie; aktywne). */
export async function showcaseProducts(ctx: NativeContext, params: URLSearchParams) {
  await requireView(ctx);
  const search = q(params.get('q'));
  let query = ctx.supabase.from('offer_products').select('id, name, category_id, price_net, unit, offer_image_path, offer_image_alt, is_active')
    .eq('is_active', true).order('name').limit(search ? 60 : 200);
  if (search) query = query.ilike('name', `%${search}%`);
  const { data, error } = await query;
  check(error, 'Nie udało się pobrać produktów.');
  const rows = (data || []) as Row[];
  const categoryIds = Array.from(new Set(rows.map((row) => row.category_id).filter(isUuid)));
  const { data: categories } = categoryIds.length ? await ctx.supabase.from('event_categories').select('id, name').in('id', categoryIds) : { data: [] as Row[] };
  const categoryName = new Map(((categories || []) as Row[]).map((row) => [String(row.id), text(row.name)]));
  const images = rows.map((row) => productMedia(row.offer_image_path, row.offer_image_alt || row.name));
  const urls = await mediaUrls(ctx, images);
  return {
    products: rows.map((row, index) => ({
      id: String(row.id),
      name: text(row.name) || 'Produkt',
      category: categoryName.get(text(row.category_id)) || '',
      priceNet: num(row.price_net),
      unit: text(row.unit),
      thumbnailUrl: images[index] ? urls[showcaseMediaKey(images[index]!)]?.thumb || null : null,
    })),
  };
}

/** Realizacje ze strony (wyszukiwanie po tytule; najnowsze najpierw). */
export async function showcaseRealizations(ctx: NativeContext, params: URLSearchParams) {
  await requireView(ctx);
  const search = q(params.get('q'));
  let query = ctx.supabase.from('portfolio_projects').select(SITE_FIELDS).order('event_date', { ascending: false, nullsFirst: false }).limit(80);
  if (search) query = query.ilike('title', `%${search}%`);
  const { data, error } = await query;
  check(error, 'Nie udało się pobrać realizacji ze strony.');
  return {
    realizations: ((data || []) as Row[]).map(realizationView).map((view) => ({
      id: view.id, title: view.title, location: view.location, date: view.date, photos: view.photos.length,
      thumbnailUrl: view.photos[0] ? view.photos[0].thumb || view.photos[0].path : null,
    })),
  };
}

/** Wydarzenia do wyboru zdjęć z ich plików (wyszukiwanie po nazwie, najnowsze najpierw). */
export async function showcaseEvents(ctx: NativeContext, params: URLSearchParams) {
  await requireManage(ctx);
  const search = q(params.get('q'));
  let query = ctx.supabase.from('events').select('id, name, event_date').order('event_date', { ascending: false }).limit(40);
  if (search) query = query.ilike('name', `%${search}%`);
  const { data, error } = await query;
  check(error, 'Nie udało się pobrać eventów.');
  return { events: ((data || []) as Row[]).map((row) => ({ id: String(row.id), name: text(row.name) || 'Event', date: text(row.event_date) || null })) };
}

/**
 * Zdjęcia do wyboru: produkt (zdjęcie główne, warianty, pakiety), realizacja, baza zdjęć (Materiały, `album`), social media.
 * Pliki wydarzenia (`event`) — tylko dla starszych wersji aplikacji (okno wyboru już ich nie pokazuje).
 */
export async function showcasePhotos(ctx: NativeContext, params: URLSearchParams): Promise<{ source: string; photos: ShowcasePickPhoto[]; problem?: string; hasMore?: boolean }> {
  await requireManage(ctx);
  const source = text(params.get('source'));
  const search = q(params.get('q'));
  const fromMedia = async (media: ShowcaseMedia[]) => {
    const urls = await mediaUrls(ctx, media);
    return media.map((item) => ({
      id: item.id, name: item.caption || 'Zdjęcie', thumbnailUrl: urls[showcaseMediaKey(item)]?.thumb || null,
      url: urls[showcaseMediaKey(item)]?.url || null, width: item.width, height: item.height, media: item,
    }));
  };
  if (source === 'product') {
    const [product] = await catalogProducts(ctx, [text(params.get('product'))]);
    if (!product) return { source, photos: [] };
    const media = productMediaList([product]).filter((item): item is ShowcaseMedia => Boolean(item))
      .filter((item, index, all) => all.findIndex((other) => other.path === item.path) === index);
    return { source, photos: await fromMedia(media) };
  }
  if (source === 'site') {
    const [realization] = await realizationViews(ctx, [text(params.get('realization'))]);
    return { source, photos: realization ? await fromMedia(realization.photos) : [] };
  }
  if (source === 'event') {
    const eventId = uuidOrNull(params.get('event'));
    if (!eventId) return { source, photos: [] };
    const { data, error } = await ctx.supabase.from('event_files').select('id, name, original_name, file_path, mime_type, file_size, created_at')
      .eq('event_id', eventId).in('mime_type', IMAGE_TYPES).order('created_at', { ascending: false }).limit(150);
    if (error) return { source, photos: [], problem: 'Nie masz dostępu do plików tego eventu.' };
    const rows = (data || []) as Row[];
    const urls = await signPaths(ctx, 'event-files', rows.map((row) => text(row.file_path)));
    return {
      source,
      photos: rows.map((row) => ({
        id: String(row.id), name: text(row.original_name) || text(row.name) || 'Zdjęcie', thumbnailUrl: urls.get(text(row.file_path)) || null,
        width: null, height: null, media: null,
      })),
    };
  }
  if (source === 'material') {
    // Baza zdjęć: wszystkie zdjęcia Materiałów (najnowsze najpierw, stronami po 120) albo album (w kolejności albumu).
    const albumId = uuidOrNull(params.get('album'));
    if (albumId) {
      const reply = await materialsAlbum(ctx, albumId).catch(() => null);
      if (!reply) return { source, photos: [], problem: 'Nie znaleziono albumu albo nie masz do niego dostępu.' };
      const needle = search.toLocaleLowerCase('pl');
      return {
        source,
        photos: reply.files.filter((file) => IMAGE_TYPES.includes(file.mime.toLowerCase()) && (!needle || file.name.toLocaleLowerCase('pl').includes(needle)))
          .map((file) => ({ id: file.id, name: file.name, thumbnailUrl: file.thumbnailUrl, url: null, width: file.width, height: file.height, media: null })),
      };
    }
    const offset = Math.min(10_000, Math.max(0, Math.round(Number(params.get('offset')) || 0)));
    let query = ctx.supabase.from('material_files').select('id, name, storage_path, thumbnail_path, width, height')
      .eq('status', 'ready').in('mime_type', IMAGE_TYPES).order('updated_at', { ascending: false }).range(offset, offset + 120);
    if (search) query = query.ilike('name', `%${search}%`);
    const { data, error } = await query;
    if (error) return { source, photos: [], problem: 'Materiały nie są dostępne albo nie masz do nich dostępu.' };
    const rows = ((data || []) as Row[]).slice(0, 120);
    const urls = await signPaths(ctx, 'materials', rows.map((row) => text(row.thumbnail_path) || text(row.storage_path)));
    const empty = !rows.length && !offset && !(await materialAccess(ctx, null)).view;
    return {
      source,
      hasMore: ((data || []) as Row[]).length > 120,
      photos: rows.map((row) => ({
        id: String(row.id), name: text(row.name) || 'Zdjęcie', thumbnailUrl: urls.get(text(row.thumbnail_path) || text(row.storage_path)) || null,
        url: null, width: num(row.width), height: num(row.height), media: null,
      })),
      ...(empty ? { problem: 'Baza zdjęć to Materiały — potrzebne uprawnienie „Materiały — podgląd”.' } : {}),
    };
  }
  if (source === 'social') {
    let query = ctx.supabase.from('social_assets').select('id, title, original_name, thumbnail_path, width, height')
      .in('status', ['ready', 'proposed']).order('updated_at', { ascending: false }).limit(150);
    if (search) query = query.or(`title.ilike.%${search}%,original_name.ilike.%${search}%`);
    const { data, error } = await query;
    if (error) return { source, photos: [], problem: 'Biblioteka social media nie jest dostępna.' };
    const rows = (data || []) as Row[];
    const urls = await signPaths(ctx, 'social-media', rows.map((row) => text(row.thumbnail_path)));
    return {
      source,
      photos: rows.map((row) => ({
        id: String(row.id), name: text(row.title) || text(row.original_name) || 'Zdjęcie', thumbnailUrl: urls.get(text(row.thumbnail_path)) || null,
        width: num(row.width), height: num(row.height), media: null,
      })),
    };
  }
  fail('Nieznane źródło zdjęć.', 400);
}
