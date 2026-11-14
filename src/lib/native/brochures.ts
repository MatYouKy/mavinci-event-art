import 'server-only';
import type { NativeContext } from './auth';
import { fail } from './offers';
import {
  BROCHURE_LAYOUTS, BROCHURE_ORNAMENT_PLACES, BROCHURE_ORNAMENTS, BROCHURE_PRESETS, BROCHURE_SLOGANS, brochureAssetKey, brochurePalette, imageBucket, pageDefaults, pageDesign,
  parseComposer, parseDecorativePages, requiresPageImage, resolvedBenefits, type BrochureLayout,
} from '@/lib/brochures/decorativePages';
import { BROCHURE_ICONS } from '@/lib/brochures/brochureIcons';
import { buildSalesBrochureHtml, type SalesBrochureSnapshot } from '@/lib/brochures/buildSalesBrochureHtml';
import { createHotelBrochureTemplate, HOTEL_TEMPLATE_PRODUCT_IDS } from '@/lib/brochures/hotelTemplate';

/*
 * Broszury na Macu (`/crm/brochures`), część G1: lista (aktywne / archiwum, pusta broszura, szablon „Hotele · 24 strony”,
 * zmiana nazwy, archiwizacja i przywracanie), edytor (ustawienia, kolory, okładka, katalog usług, kolejność i widoczność
 * stron, treść stron usług, zdjęcia z biblioteki lub z dysku), podgląd na żywo z tego samego układu co PDF, ostatni własny
 * PDF, wyszukiwarka klienta wersji PDF i szkic kampanii; część G2: Studio stron (układy, ikony, szablony stron i domyślne
 * rozmieszczenia z `decorativePages.ts`, podgląd pojedynczej strony graficznej do płótna rozmieszczenia).
 * Sam PDF i sprawdzanie generuje `/bridge/brochures/generate-pdf`
 * (token pracownika, jak w CRM). Te same tabele, RPC i magazyn plików co `BrochureEditorClient` (RLS tokenem pracownika).
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message: string) => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));
const one = <T>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] || null : value || null);
const record = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const AUDIENCES = ['hotel', 'venue', 'agency', 'corporate', 'wedding', 'general'];
const LAYOUTS = ['visual', 'classic', 'compact'];
const IMAGE_BUCKETS = ['offer-product-pages', 'offer-template-pages', 'seller-brand-assets'];
const PRODUCT_BUCKET = 'offer-product-pages';
const migrationMessage = (error: { code?: string; message?: string }, fallback: string) =>
  error.code === 'PGRST205' ? 'Najpierw uruchom migrację modułu broszur' : error.message || fallback;

/** Uprawnienia jak polityki tabel (`can_view_sales_brochures`, `can_manage_sales_brochures`) i zakresy wyników w CRM. */
export async function brochureAccess(ctx: NativeContext) {
  const [view, manage] = await Promise.all([
    ctx.supabase.rpc('can_view_sales_brochures'),
    ctx.supabase.rpc('can_manage_sales_brochures'),
  ]);
  if (view.error || manage.error) fail('Nie udało się sprawdzić uprawnień do broszur. Sprawdź dostępność bazy i migracji modułu broszur.');
  const has = (scope: string) => ctx.employee.permissions.includes(scope);
  return {
    canView: view.data === true || manage.data === true,
    canManage: manage.data === true,
    canViewResults: ctx.employee.isAdmin || has('offers_brochures_view_own') || has('offers_brochures_view_all'),
  };
}

async function requireView(ctx: NativeContext) {
  const access = await brochureAccess(ctx);
  if (!access.canView) fail('Nie masz dostępu do broszur.');
  return access;
}

async function requireManage(ctx: NativeContext) {
  const access = await brochureAccess(ctx);
  if (!access.canManage) fail('Nie masz uprawnień do edycji broszur.');
  return access;
}

/** Liczba stron jak na kafelku listy: widoczne usługi i strony graficzne oraz okładka, wprowadzenie i zakończenie. */
const pageCount = (row: Row) => {
  const config = record(row.brand_config);
  const items = Array.isArray(row.items) ? row.items : [];
  return items.filter((item: Row) => item?.is_visible).length
    + parseDecorativePages(config.decorative_pages).filter((page) => page.isVisible).length
    + 3 - parseComposer(config.composer).hiddenPages.length;
};

const recordView = (row: Row) => ({
  id: String(row.id),
  name: text(row.name),
  status: text(row.status) || 'draft',
  updatedAt: text(row.updated_at),
  pdfVersion: Number(row.current_pdf_version) || 0,
  modified: row.modified_after_generation === true,
});

export async function brochuresState(ctx: NativeContext) {
  const access = await requireView(ctx);
  const { data, error } = await ctx.supabase
    .from('sales_brochures')
    .select('id,name,title,audience_type,status,current_pdf_version,modified_after_generation,updated_at,brand_config,organization:organizations(name),items:sales_brochure_items(id,is_visible)')
    .order('updated_at', { ascending: false });
  if (error) fail(migrationMessage(error, 'Nie udało się pobrać broszur'));
  return {
    canManage: access.canManage,
    canViewResults: access.canViewResults,
    brochures: (data || []).map((row: Row) => ({
      ...recordView(row),
      title: text(row.title),
      audienceType: text(row.audience_type) || 'general',
      organization: one<Row>(row.organization)?.name || null,
      pageCount: pageCount(row),
    })),
  };
}

/** „Pusta broszura” albo „Szablon Hotele · 24 strony” — jak `createBrochure` na liście w CRM. */
export async function createBrochure(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const hotelTemplate = body.hotelTemplate === true;
  const { data: company, error: companyError } = await ctx.supabase
    .from('my_companies').select('id').eq('is_active', true).order('is_default', { ascending: false }).limit(1).maybeSingle();
  if (companyError || !company) fail(companyError?.message || 'Brak aktywnej działalności');

  const productImages: Record<string, string> = {};
  if (hotelTemplate) {
    const { data: products, error: imageError } = await ctx.supabase.from('offer_products')
      .select('id,offer_image_path').in('id', Object.values(HOTEL_TEMPLATE_PRODUCT_IDS));
    if (imageError) fail('Nie udało się pobrać aktualnych zdjęć usług do szablonu broszury. Spróbuj ponownie.');
    for (const product of products || []) {
      if (product.offer_image_path) productImages[product.id] = product.offer_image_path;
    }
  }
  const { data, error } = await ctx.supabase.from('sales_brochures').insert({
    name: 'Nowa broszura dla hoteli',
    title: 'Technika i produkcja wydarzeń dla hoteli',
    subtitle: 'Rozwiązania, które wspierają sprzedaż i realizację eventów',
    audience_type: 'hotel',
    ...(hotelTemplate ? createHotelBrochureTemplate(productImages) : {}),
    my_company_id: company!.id,
    contact_employee_id: ctx.employee.id,
    created_by: ctx.employee.id,
    updated_by: ctx.employee.id,
  }).select('id').single();
  if (error || !data) fail(error?.message || 'Nie udało się utworzyć broszury');
  const missingImages = hotelTemplate && Object.values(HOTEL_TEMPLATE_PRODUCT_IDS).some((id) => !productImages[id]);
  return {
    ...(await brochuresState(ctx)),
    savedId: String(data!.id),
    notice: missingImages ? 'Szablon utworzony. Część usług nie ma zdjęć — uzupełnij je w Studio stron przed generowaniem PDF.' : undefined,
  };
}

/** Zmiana nazwy, archiwum („Usuń broszurę”) i przywrócenie — tylko gdy nikt nie zmienił broszury w międzyczasie. */
export async function manageBrochure(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const id = uuid(body.id, 'Nie znaleziono broszury.');
  const action = text(body.action);
  if (!['rename', 'remove', 'restore'].includes(action)) fail('Nieznana operacja.');
  const name = text(body.name).trim();
  if (action === 'rename' && (!name || name.length > 200)) fail('Wpisz nazwę broszury — od 1 do 200 znaków.');
  const { data: current } = await ctx.supabase.from('sales_brochures').select('current_pdf_version').eq('id', id).maybeSingle();
  // Archiwum zachowuje źródło, zapisane PDF-y klientów, historię wysyłek i przypisania demo.
  const patch = action === 'rename' ? { name } : {
    status: action === 'remove' ? 'archived' : Number(current?.current_pdf_version) > 0 ? 'ready' : 'draft',
  };
  let request = ctx.supabase.from('sales_brochures').update(patch).eq('id', id).eq('updated_at', text(body.updatedAt));
  request = action === 'restore' ? request.eq('status', 'archived') : request.neq('status', 'archived');
  const { data, error } = await request.select('id,name,status,updated_at,current_pdf_version,modified_after_generation').maybeSingle();
  if (error) {
    fail(error.code === '42501' ? 'Nie masz uprawnień do zarządzania tą broszurą.'
      : 'Nie udało się potwierdzić zmiany. Odśwież widok, aby sprawdzić aktualny stan broszury.');
  }
  if (!data) fail('Broszura została zmieniona w innym oknie albo nie masz już dostępu do jej edycji. Odśwież widok przed kolejną próbą.');
  return {
    ...(await brochuresState(ctx)),
    record: recordView(data!),
    message: action === 'rename' ? 'Zmieniono nazwę broszury.'
      : action === 'remove' ? 'Przeniesiono broszurę do archiwum. Zapisane PDF-y zachowano.' : 'Przywrócono broszurę na aktywną listę.',
  };
}

// MARK: Edytor

type Asset = { key: string; label: string; path: string; bucket: string };
type CatalogProduct = { id: string; name: string; category: string | null; imagePath: string | null; variants: Array<{ id: string; name: string; imagePath: string | null }> };
const asset = (bucket: string, path: string, label: string): Asset => ({ key: brochureAssetKey(bucket, path), label, path, bucket });
const isUrl = (value: string) => /^https?:\/\//i.test(value);

/** Podpisane adresy zdjęć (jak `createSignedUrls` w edytorze CRM) — partie po 50 na kontener; adresy https bez zmian. */
export async function signBrochureAssets(ctx: NativeContext, assets: Array<{ bucket: string; path: string }>) {
  const urls: Record<string, string> = {};
  const missing = new Map<string, string[]>();
  for (const entry of assets.slice(0, 400)) {
    const path = text(entry.path);
    if (!path) continue;
    const bucket = imageBucket(entry.bucket);
    if (isUrl(path)) { urls[brochureAssetKey(bucket, path)] = path; continue; }
    const list = missing.get(bucket) || [];
    if (!list.includes(path)) list.push(path);
    missing.set(bucket, list);
  }
  for (const [bucket, paths] of missing) {
    for (let offset = 0; offset < paths.length; offset += 50) {
      const batch = paths.slice(offset, offset + 50);
      const { data } = await ctx.supabase.storage.from(bucket).createSignedUrls(batch, 3600);
      for (const image of data || []) {
        if (image?.path && image.signedUrl && !image.error) urls[brochureAssetKey(bucket, String(image.path))] = String(image.signedUrl);
      }
    }
  }
  return urls;
}

/** Zdjęcia hotelu z biblioteki organizacji (`get_crm_offer_branding`) dla wybranej marki. */
export async function brochureHotelAssets(ctx: NativeContext, organizationId: string | null, companyId: string | null) {
  if (!organizationId || !UUID.test(organizationId)) return { assets: [] as Asset[], notice: '' };
  const { data, error } = await ctx.supabase.rpc('get_crm_offer_branding', { p_organization: organizationId });
  if (error) return { assets: [] as Asset[], notice: 'Biblioteka organizacji jest niedostępna. Nadal możesz wgrać własne zdjęcia.' };
  const brand = (Array.isArray(data?.brands) ? data.brands : []).find((entry: Row) => entry?.id === companyId)?.branding;
  const images: Array<{ path: unknown; label: string }> = [
    ...(brand?.hotel_cover_image_url ? [{ path: brand.hotel_cover_image_url, label: 'Hotel: zdjęcie główne' }] : []),
    ...(Array.isArray(brand?.venue_image_urls) ? brand.venue_image_urls.map((path: unknown, index: number) => ({ path, label: `Hotel: galeria ${index + 1}` })) : []),
  ];
  return {
    assets: images.filter((image) => typeof image.path === 'string' && image.path).map((image) => asset('seller-brand-assets', String(image.path), image.label)),
    notice: images.length ? '' : 'Ta organizacja nie ma jeszcze zdjęć w bibliotece. Możesz wgrać je bezpośrednio do broszury.',
  };
}

const itemView = (row: Row) => {
  const product = one<Row>(row.product) || {};
  const variant = one<Row>(row.variant);
  const description = variant?.description || product.offer_description || product.description || '';
  return {
    id: String(row.id),
    productId: text(row.product_id),
    variantId: row.product_variant_id ? String(row.product_variant_id) : null,
    displayOrder: Number(row.display_order) || 0,
    customTitle: row.custom_title ?? null,
    customShort: row.custom_short_description ?? null,
    customDescription: row.custom_description ?? null,
    customBenefits: Array.isArray(row.custom_benefits) ? row.custom_benefits.map(String) : null,
    customImagePath: row.custom_image_path || null,
    layout: LAYOUTS.includes(row.page_layout) ? row.page_layout : 'visual',
    visible: row.is_visible !== false,
    // Treść katalogowa, którą dziedziczą puste pola (jak `itemTitle`, `itemShort`, `itemDescription`, `itemBenefits`).
    base: {
      title: variant?.name ? `${product.name} — ${variant.name}` : text(product.name),
      short: variant?.short_description || product.offer_short_description || '',
      description,
      compactDescription: variant?.description || product.offer_compact_description || product.offer_description || product.description || '',
      benefits: resolvedBenefits(null, variant?.benefits, product.offer_benefits),
      imagePath: variant?.offer_image_path || product.offer_image_path || '',
      category: one<Row>(product.category)?.name || null,
    },
  };
};

const ITEM_SELECT = `*,product:offer_products(id,name,description,offer_short_description,offer_description,offer_compact_description,offer_benefits,offer_image_path,category:event_categories(id,name)),
  variant:offer_product_variants(id,name,short_description,description,benefits,offer_image_path,display_order)`;

/**
 * Studio stron (`BrochureDecorativePagesEditor`): układy, ikony, domyślne rozmieszczenie każdego układu i nowe strony
 * („Własna strona” i szablony) — dokładnie jak `add()` w CRM; identyfikator nowej strony nadaje Mac.
 */
function brochureStudio(brochureId: string) {
  const newPage = (preset: keyof typeof BROCHURE_PRESETS | null) => {
    const template = preset ? BROCHURE_PRESETS[preset] : null;
    const layout: BrochureLayout = template?.layout || 'statement';
    const seller = preset === 'seller';
    return {
      layout, slogan: template?.slogan || BROCHURE_SLOGANS[0], caption: template?.caption || '', imagePath: '', imageBucket: 'offer-product-pages',
      imagePosition: 50, afterItemId: null, isVisible: true, points: template?.points || [],
      design: seller
        ? { ...pageDefaults(layout), showBrand: false, fontSize: 33, ornament: 'arc', text: { x: 10, y: 9, width: 80, height: 25 }, details: { x: 10, y: 37, width: 80, height: 54 } }
        : pageDefaults(layout),
      linkLabel: seller ? BROCHURE_PRESETS.seller.linkLabel : '',
      linkUrl: seller ? `https://mavinci.pl/demo-sprzedawcy/${brochureId}` : '',
      linkHint: seller ? BROCHURE_PRESETS.seller.linkHint : '',
    };
  };
  const layouts = Object.keys(BROCHURE_LAYOUTS) as BrochureLayout[];
  return {
    layouts: layouts.map((key) => ({ key, label: BROCHURE_LAYOUTS[key], requiresImage: requiresPageImage(key) })),
    icons: Object.entries(BROCHURE_ICONS).map(([key, label]) => ({ key, label })),
    ornaments: Object.entries(BROCHURE_ORNAMENTS).map(([key, label]) => ({ key, label })),
    ornamentPlaces: Object.entries(BROCHURE_ORNAMENT_PLACES).map(([key, label]) => ({ key, label })),
    defaults: Object.fromEntries(layouts.map((key) => [key, pageDefaults(key)])),
    presets: [
      { key: 'custom', label: 'Własna strona', page: newPage(null) },
      ...(Object.keys(BROCHURE_PRESETS) as Array<keyof typeof BROCHURE_PRESETS>).map((key) => ({ key, label: BROCHURE_PRESETS[key].label, page: newPage(key) })),
    ],
    maxPages: 40,
  };
}

export async function brochureEditor(ctx: NativeContext, rawId: string) {
  const access = await requireView(ctx);
  const id = uuid(rawId, 'Nie znaleziono broszury.');
  const [brochureRes, itemsRes, productsRes, organizationsRes, companiesRes, employeesRes, templatesRes, portfolioRes] = await Promise.all([
    ctx.supabase.from('sales_brochures').select('*').eq('id', id).maybeSingle(),
    ctx.supabase.from('sales_brochure_items').select(ITEM_SELECT).eq('brochure_id', id).order('display_order'),
    ctx.supabase.from('offer_products').select(`
      id,name,offer_image_path,category:event_categories(id,name),
      variants:offer_product_variants(id,name,offer_image_path,display_order,is_active)
    `).eq('is_active', true).order('display_order'),
    ctx.supabase.from('organizations').select('id,name').eq('status', 'active').order('name').limit(1000),
    ctx.supabase.from('my_companies').select('id,name').eq('is_active', true).order('is_default', { ascending: false }),
    ctx.supabase.from('employees').select('id,name,surname,email').eq('is_active', true).order('surname'),
    ctx.supabase.from('offer_template_categories').select('name,hero_image_path').not('hero_image_path', 'is', null),
    ctx.supabase.from('portfolio_projects').select('title,image,image_metadata').order('order_index'),
  ]);
  const error = brochureRes.error || itemsRes.error || productsRes.error || organizationsRes.error || companiesRes.error || employeesRes.error;
  if (error) fail(migrationMessage(error, 'Nie udało się pobrać broszury'));
  const brochure = brochureRes.data as Row | null;
  if (!brochure) fail('Nie znaleziono broszury');
  const config = record(brochure!.brand_config);

  const products: CatalogProduct[] = ((productsRes.data || []) as Row[]).map((row) => ({
    id: String(row.id),
    name: text(row.name),
    category: one<Row>(row.category)?.name || null,
    imagePath: row.offer_image_path || null,
    variants: (Array.isArray(row.variants) ? row.variants : [])
      .filter((variant: Row) => variant.is_active !== false)
      .sort((a: Row, b: Row) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0))
      .map((variant: Row) => ({ id: String(variant.id), name: text(variant.name), imagePath: variant.offer_image_path || null })),
  }));
  const thumbnails = await signBrochureAssets(ctx, products.filter((product) => product.imagePath)
    .map((product) => ({ bucket: PRODUCT_BUCKET, path: product.imagePath as string })));

  const companies = (companiesRes.data || []) as Row[];
  const { data: colors } = companies.length
    ? await ctx.supabase.from('company_brandbook_colors').select('company_id,hex,role').in('company_id', companies.map((company) => company.id))
    : { data: [] as Row[] };

  // Biblioteka zdjęć jak `decorationAssets` w CRM: usługi i warianty, zdjęcia hero szablonów ofert oraz portfolio strony.
  const library = new Map<string, Asset>();
  const add = (entry: Asset) => library.set(entry.key, entry);
  for (const product of products) {
    if (product.imagePath) add(asset(PRODUCT_BUCKET, product.imagePath, product.name));
    for (const variant of product.variants) {
      if (variant.imagePath) add(asset(PRODUCT_BUCKET, variant.imagePath, `${product.name} — ${variant.name}`));
    }
  }
  for (const row of (templatesRes.data || []) as Row[]) {
    if (row.hero_image_path) add(asset('offer-template-pages', String(row.hero_image_path), `Oferta: ${row.name}`));
  }
  for (const row of (portfolioRes.data || []) as Row[]) {
    const path = row.image_metadata?.desktop?.src || row.image;
    if (typeof path === 'string' && isUrl(path)) add(asset(PRODUCT_BUCKET, path, `Portfolio: ${row.title}`));
  }

  const hotel = await brochureHotelAssets(ctx, brochure!.organization_id || null, brochure!.my_company_id || null);

  // Ostatni własny PDF (jak menu „Ostatni PDF vN — odbiorca” w CRM); sam plik — `op=ownPdf`.
  let ownPdf: { version: number; recipient: string } | null = null;
  const { data: currentEmployeeId } = await ctx.supabase.rpc('current_brochure_employee_id');
  if (currentEmployeeId) {
    const { data: generation } = await ctx.supabase.from('sales_brochure_generations')
      .select('version,snapshot').eq('brochure_id', id).eq('created_by', currentEmployeeId)
      .order('version', { ascending: false }).limit(1).maybeSingle();
    if (generation) {
      const snapshot = record(generation.snapshot);
      ownPdf = {
        version: Number(generation.version) || 0,
        recipient: text(record(snapshot.recipient).name || snapshot.recipientEmail || record(snapshot.demoAttribution).recipientEmail),
      };
    }
  }

  return {
    canManage: access.canManage,
    canViewResults: access.canViewResults,
    currentEmployeeId: ctx.employee.id,
    brochure: {
      ...recordView(brochure!),
      title: text(brochure!.title),
      subtitle: text(brochure!.subtitle),
      introduction: text(brochure!.introduction),
      closingText: text(brochure!.closing_text),
      audienceType: AUDIENCES.includes(brochure!.audience_type) ? brochure!.audience_type : 'general',
      organizationId: brochure!.organization_id || null,
      myCompanyId: text(brochure!.my_company_id),
      contactEmployeeId: brochure!.contact_employee_id || null,
      coverImagePath: brochure!.cover_image_path || null,
      hasPdf: Boolean(brochure!.current_pdf_path),
      sellerDemo: config.seller_demo_enabled === true,
      composer: parseComposer(config.composer),
      decorativePages: parseDecorativePages(config.decorative_pages),
    },
    items: (itemsRes.data || []).filter((row: Row) => one(row.product)).map(itemView),
    products: products.map((product) => ({
      ...product,
      imageUrl: product.imagePath ? thumbnails[brochureAssetKey(PRODUCT_BUCKET, product.imagePath)] || null : null,
    })),
    organizations: (organizationsRes.data || []).map((row: Row) => ({ id: String(row.id), name: text(row.name) })),
    companies: companies.map((company) => ({
      id: String(company.id),
      name: text(company.name),
      ...brochurePalette(((colors || []) as Row[]).filter((color) => color.company_id === company.id) as Array<{ hex: string; role: string }>),
    })),
    employees: (employeesRes.data || []).map((row: Row) => ({
      id: String(row.id),
      name: [row.name, row.surname].filter(Boolean).join(' ') || text(row.email),
    })),
    library: [...library.values()],
    studio: brochureStudio(id),
    hotelAssets: hotel.assets,
    assetNotice: hotel.notice,
    ownPdf,
  };
}

/** Pola broszury z edytora Maca — jak `save` w `BrochureEditorClient` (puste teksty jako `null`). */
function brochureDraft(body: Row) {
  const raw = record(body.brochure);
  const optional = (value: unknown) => text(value).trim() || null;
  const audience = text(raw.audienceType);
  if (!AUDIENCES.includes(audience)) fail('Wybierz odbiorcę broszury.');
  return {
    name: text(raw.name).trim(),
    title: text(raw.title).trim(),
    subtitle: optional(raw.subtitle),
    introduction: optional(raw.introduction),
    closing_text: optional(raw.closingText),
    audience_type: audience,
    organization_id: UUID.test(text(raw.organizationId)) ? text(raw.organizationId) : null,
    cover_image_path: text(raw.coverImagePath) || null,
    my_company_id: uuid(raw.myCompanyId, 'Wybierz markę / działalność broszury.'),
    contact_employee_id: UUID.test(text(raw.contactEmployeeId)) ? text(raw.contactEmployeeId) : null,
  };
}

/** Strona usługi — personalizacja tylko w broszurze; pusta lista korzyści ukrywa korzyści, `null` dziedziczy katalog. */
function itemDraft(raw: Row) {
  const optional = (value: unknown) => (typeof value === 'string' ? value.trim() : '') || null;
  return {
    id: uuid(raw.id, 'Nieprawidłowa strona usługi.'),
    display_order: Number.isInteger(raw.displayOrder) ? raw.displayOrder : 0,
    custom_title: optional(raw.customTitle),
    custom_short_description: optional(raw.customShort),
    custom_description: optional(raw.customDescription),
    custom_benefits: Array.isArray(raw.customBenefits) ? raw.customBenefits.slice(0, 50).map(String).filter(Boolean) : null,
    custom_image_path: text(raw.customImagePath) || null,
    page_layout: LAYOUTS.includes(raw.layout) ? raw.layout : 'visual',
    is_visible: raw.visible !== false,
  };
}

export async function saveBrochure(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const id = uuid(body.id, 'Nie znaleziono broszury.');
  const draft = brochureDraft(body);
  if (!draft.name || !draft.title) fail('Uzupełnij nazwę broszury i tytuł okładki.');
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 300).map((raw: unknown) => itemDraft(record(raw)));
  const { data: current, error: currentError } = await ctx.supabase.from('sales_brochures').select('brand_config,status').eq('id', id).maybeSingle();
  if (currentError || !current) fail('Nie znaleziono broszury.');
  if (current!.status === 'archived') fail('Broszura jest w archiwum. Przywróć ją, aby ponownie edytować treść.');
  // Pozostałe klucze konfiguracji (np. identyfikator szablonu) zostają; brak listy stron nie czyści zapisanych stron.
  const config = record(current!.brand_config);
  const brandConfig: Row = {
    ...config,
    decorative_pages: Array.isArray(body.decorativePages) ? parseDecorativePages(body.decorativePages) : parseDecorativePages(config.decorative_pages),
    composer: body.composer && typeof body.composer === 'object' ? parseComposer(body.composer) : parseComposer(config.composer),
  };
  if (typeof body.sellerDemo === 'boolean') brandConfig.seller_demo_enabled = body.sellerDemo;
  const { data: saved, error } = await ctx.supabase.from('sales_brochures').update({
    ...draft, brand_config: brandConfig, updated_by: ctx.employee.id,
  }).eq('id', id).select('id').maybeSingle();
  if (error) fail(error.message || 'Nie udało się zapisać broszury');
  if (!saved) fail('Nie masz uprawnień do zapisania tej broszury.');
  for (const item of items) {
    const { id: itemId, ...patch } = item;
    const { error: itemError } = await ctx.supabase.from('sales_brochure_items').update(patch).eq('id', itemId).eq('brochure_id', id);
    if (itemError) fail(itemError.message || 'Nie udało się zapisać stron broszury');
  }
  return { ...(await brochureEditor(ctx, id)), message: body.quiet === true ? undefined : 'Zapisano broszurę' };
}

/** „Dodaj produkt bazowy” lub wariant z katalogu — na końcu listy usług. */
export async function addBrochureItem(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const id = uuid(body.id, 'Nie znaleziono broszury.');
  const productId = uuid(body.productId, 'Wybierz usługę z katalogu.');
  const variantId = body.variantId ? uuid(body.variantId, 'Wybierz wariant z katalogu.') : null;
  const { data: existing } = await ctx.supabase.from('sales_brochure_items').select('id').eq('brochure_id', id);
  const { error } = await ctx.supabase.from('sales_brochure_items').insert({
    brochure_id: id, product_id: productId, product_variant_id: variantId, display_order: (existing || []).length,
  });
  if (error) fail(error.code === '23505' ? 'Ta usługa lub wariant jest już w broszurze' : error.message || 'Nie udało się dodać usługi');
  return { ...(await brochureEditor(ctx, id)), message: 'Dodano usługę do broszury' };
}

export async function removeBrochureItem(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const id = uuid(body.id, 'Nie znaleziono broszury.');
  const itemId = uuid(body.itemId, 'Nie znaleziono usługi w broszurze.');
  const { error } = await ctx.supabase.from('sales_brochure_items').delete().eq('id', itemId).eq('brochure_id', id);
  if (error) fail(error.message || 'Nie udało się usunąć usługi');
  return { ...(await brochureEditor(ctx, id)), message: 'Usunięto usługę z broszury' };
}

/** Marka do podglądu (jak `previewCompany` w CRM): logo i fonty z brandbooka, kolory według ról. */
async function previewCompany(ctx: NativeContext, companyId: string, origin: string): Promise<SalesBrochureSnapshot['company']> {
  const [companyResult, logos, colors, fonts] = await Promise.all([
    ctx.supabase.from('my_companies').select('name,logo_url,email,phone,website').eq('id', companyId).maybeSingle(),
    ctx.supabase.from('company_brandbook_logos').select('url,is_default,background,order_index').eq('company_id', companyId).order('is_default', { ascending: false }).order('order_index'),
    ctx.supabase.from('company_brandbook_colors').select('hex,role').eq('company_id', companyId),
    ctx.supabase.from('company_brandbook_fonts').select('family,role,file_url,storage_path,order_index').eq('company_id', companyId).order('order_index'),
  ]);
  const company = companyResult.data as Row | null;
  if (!company) return { name: 'MAVINCI', primaryColor: '#d3bb73', secondaryColor: '#1c1f33' };
  const publicUrl = (path: string) => ctx.supabase.storage.from('company-logos').getPublicUrl(path).data.publicUrl;
  const logoRows = (logos.data || []) as Row[];
  const logo = logoRows.find((row) => row.is_default) || logoRows.find((row) => row.background === 'transparent') || logoRows[0];
  const rawLogo = text(logo?.url || company.logo_url);
  const fontRows = (fonts.data || []) as Row[];
  const heading = fontRows.find((font) => font.role === 'heading' && (font.file_url || font.storage_path));
  const bodyFont = fontRows.find((font) => font.role === 'body');
  return {
    name: text(company.name),
    email: company.email || null,
    phone: company.phone || null,
    website: company.website || null,
    ...brochurePalette((colors.data || []) as Array<{ hex: string; role: string }>),
    logoUrl: rawLogo ? (isUrl(rawLogo) ? rawLogo : publicUrl(rawLogo)) : null,
    headingFontFamily: heading?.family || null,
    bodyFontFamily: bodyFont?.family || null,
    bodyFontUrl: bodyFont?.file_url || (bodyFont?.storage_path ? publicUrl(bodyFont.storage_path)
      : /\bInter\b/i.test(bodyFont?.family || '') ? `${origin}/fonts/Inter-Variable.ttf` : null),
    headingFontUrl: heading?.file_url || (heading?.storage_path ? publicUrl(heading.storage_path) : null),
  };
}

/**
 * Podgląd całej broszury z niezapisanego szkicu (jak `BrochureQuickPreview`): ten sam układ HTML i brandbook co PDF,
 * zdjęcia przez podpisane adresy. `background` — kolor tła za stronami w oknie Maca.
 */
export async function brochurePreview(ctx: NativeContext, body: Row, origin: string) {
  await requireView(ctx);
  const id = uuid(body.id, 'Nie znaleziono broszury.');
  const raw = record(body.brochure);
  const companyId = uuid(raw.myCompanyId, 'Wybierz markę / działalność broszury.');
  const composer = parseComposer(body.composer);
  const decorations = parseDecorativePages(body.decorativePages);
  const overrides = new Map<string, Row>();
  for (const entry of (Array.isArray(body.items) ? body.items : []).slice(0, 300)) {
    const item = record(entry);
    if (UUID.test(text(item.id))) overrides.set(text(item.id), item);
  }
  const contactId = UUID.test(text(raw.contactEmployeeId)) ? text(raw.contactEmployeeId) : ctx.employee.id;
  const organizationId = UUID.test(text(raw.organizationId)) ? text(raw.organizationId) : null;
  const [itemsRes, contactRes, organizationRes, company] = await Promise.all([
    ctx.supabase.from('sales_brochure_items').select(ITEM_SELECT).eq('brochure_id', id).order('display_order'),
    ctx.supabase.from('employees').select('name,surname,email,phone_number').eq('id', contactId).maybeSingle(),
    organizationId ? ctx.supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle() : Promise.resolve({ data: null }),
    previewCompany(ctx, companyId, origin),
  ]);
  if (itemsRes.error) fail(itemsRes.error.message || 'Nie udało się przygotować podglądu');

  const items = ((itemsRes.data || []) as Row[]).filter((row) => one(row.product)).map((row) => {
    const view = itemView(row);
    const edit = overrides.get(view.id);
    if (!edit) return view;
    return {
      ...view,
      displayOrder: Number.isInteger(edit.displayOrder) ? edit.displayOrder : view.displayOrder,
      customTitle: typeof edit.customTitle === 'string' ? edit.customTitle : null,
      customShort: typeof edit.customShort === 'string' ? edit.customShort : null,
      customDescription: typeof edit.customDescription === 'string' ? edit.customDescription : null,
      customBenefits: Array.isArray(edit.customBenefits) ? edit.customBenefits.map(String) : null,
      customImagePath: text(edit.customImagePath) || null,
      layout: LAYOUTS.includes(edit.layout) ? edit.layout : view.layout,
      visible: edit.visible !== false,
    };
  }).filter((item) => item.visible).sort((a, b) => a.displayOrder - b.displayOrder);

  const coverPath = composer.coverImagePath || text(raw.coverImagePath);
  const coverBucket = composer.coverImagePath ? composer.coverImageBucket : PRODUCT_BUCKET;
  const urls = await signBrochureAssets(ctx, [
    ...items.map((item) => ({ bucket: PRODUCT_BUCKET, path: item.customImagePath || item.base.imagePath })),
    ...decorations.map((page) => ({ bucket: page.imageBucket, path: page.imagePath })),
    { bucket: coverBucket, path: coverPath },
  ]);
  const contact = contactRes.data as Row | null;
  const snapshot: SalesBrochureSnapshot = {
    brochure: {
      id, name: text(raw.name), title: text(raw.title), subtitle: text(raw.subtitle) || null,
      introduction: text(raw.introduction) || null, closingText: text(raw.closingText) || null, audienceType: text(raw.audienceType) || 'general',
    },
    company,
    organization: organizationRes.data ? { name: text((organizationRes.data as Row).name) } : null,
    contact: contact ? { name: [contact.name, contact.surname].filter(Boolean).join(' ') || '', email: contact.email, phone: contact.phone_number } : null,
    coverImageUrl: coverPath ? urls[brochureAssetKey(coverBucket, coverPath)] || null : null,
    composer,
    items: items.map((item) => {
      const path = item.customImagePath || item.base.imagePath;
      return {
        id: item.id,
        title: item.customTitle || item.base.title,
        shortDescription: item.customShort || item.base.short,
        description: item.customDescription || (item.layout === 'compact' ? item.base.compactDescription : item.base.description),
        benefits: resolvedBenefits(item.customBenefits, null, item.base.benefits),
        category: item.base.category,
        layout: item.layout as 'visual' | 'classic' | 'compact',
        imageUrl: path ? urls[brochureAssetKey(PRODUCT_BUCKET, path)] : undefined,
      };
    }),
    decorativePages: decorations.map((page) => ({ ...page, imageUrl: page.imagePath ? urls[brochureAssetKey(page.imageBucket, page.imagePath)] : undefined })),
    generatedAt: '',
  };
  const background = /^#[0-9a-f]{6}$/i.test(text(body.background)) ? text(body.background) : 'transparent';
  const html = buildSalesBrochureHtml(snapshot).replace('</style>', `.page{margin-bottom:16px}html,body{background:${background}}</style>`);
  const totalPages = items.length + decorations.filter((page) => page.isVisible).length + 3 - composer.hiddenPages.length;
  return { html, totalPages };
}

/**
 * Jedna strona graficzna do płótna rozmieszczenia w Studio stron (jak `BrochurePageCanvas`): układ HTML jak w PDF, kolory
 * broszury nałożone na brandbook marki, bez stron stałych.
 */
export async function brochurePagePreview(ctx: NativeContext, body: Row, origin: string) {
  await requireView(ctx);
  uuid(body.id, 'Nie znaleziono broszury.');
  const [page] = parseDecorativePages([record(body.page)]);
  if (!page) fail('Nieprawidłowa strona broszury.');
  const composer = parseComposer(body.composer);
  const companyId = uuid(body.myCompanyId, 'Wybierz markę / działalność broszury.');
  const organizationId = UUID.test(text(body.organizationId)) ? text(body.organizationId) : null;
  const [company, organizationRes] = await Promise.all([
    previewCompany(ctx, companyId, origin),
    organizationId ? ctx.supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const urls = page!.imagePath ? await signBrochureAssets(ctx, [{ bucket: page!.imageBucket, path: page!.imagePath }]) : {};
  const html = buildSalesBrochureHtml({
    brochure: { id: 'canvas', name: '', title: '', audienceType: 'general' },
    company: { ...company, primaryColor: composer.accentColor || company.primaryColor, secondaryColor: composer.brandColor || company.secondaryColor },
    organization: organizationRes.data ? { name: text((organizationRes.data as Row).name) } : null,
    items: [],
    decorativePages: [{
      ...page!, design: pageDesign(page!), isVisible: true,
      imageUrl: page!.imagePath ? urls[brochureAssetKey(page!.imageBucket, page!.imagePath)] : undefined,
    }],
    composer: { pageOrder: [], hiddenPages: ['cover', 'intro', 'closing'], coverImagePath: '', coverImageBucket: 'offer-product-pages', coverX: 50, coverY: 50, coverOverlay: 78 },
    generatedAt: '',
  });
  return { html };
}

/** Podpisy wybranych zdjęć (podgląd w wyborze zdjęcia i na liście stron). */
export async function brochureImageUrls(ctx: NativeContext, body: Row) {
  await requireView(ctx);
  const assets = (Array.isArray(body.assets) ? body.assets : []).map((entry: unknown) => record(entry))
    .filter((entry: Row) => IMAGE_BUCKETS.includes(text(entry.bucket)) && text(entry.path))
    .map((entry: Row) => ({ bucket: text(entry.bucket), path: text(entry.path) }));
  return { urls: await signBrochureAssets(ctx, assets) };
}

const imageType = (bytes: Buffer) => {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (bytes.length > 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
};

/** „Dodaj swoje zdjęcie” — plik zmniejszony na Macu trafia do biblioteki tej broszury (jak `BrochureImagePicker`). */
export async function uploadBrochureImage(ctx: NativeContext, body: Row) {
  await requireManage(ctx);
  const id = uuid(body.id, 'Nie znaleziono broszury.');
  const bytes = Buffer.from(text(body.data), 'base64');
  const kind = imageType(bytes);
  if (!kind || bytes.length > 10 * 1024 * 1024) fail('Wybierz JPG, PNG lub WebP do 10 MB.');
  const path = `assets/brochures/${id}/${crypto.randomUUID()}.${kind!.ext}`;
  const { error } = await ctx.supabase.storage.from(PRODUCT_BUCKET).upload(path, bytes, { contentType: kind!.type });
  if (error) fail(error.message || 'Nie udało się wgrać zdjęcia. Spróbuj ponownie.');
  const { data } = await ctx.supabase.storage.from(PRODUCT_BUCKET).createSignedUrl(path, 3600);
  return {
    path, bucket: PRODUCT_BUCKET, url: data?.signedUrl || null,
    message: 'Dodano zdjęcie do podglądu. Kliknij „Zapisz broszurę”, aby zachować zmianę.',
  };
}

/** Wyszukiwarka klienta wersji PDF (jak `BrochureClientPicker`): kontakt z obecnymi organizacjami albo organizacja. */
export async function brochureClients(ctx: NativeContext, mode: string, query: string) {
  await requireView(ctx);
  const term = query.trim().replace(/[,%()"\\]/g, ' ').trim().slice(0, 100);
  if (term.length < 2) return { results: [] };
  if (mode === 'organization') {
    const { data, error } = await ctx.supabase.from('organizations').select('id,name,email')
      .or(`name.ilike.%${term}%,email.ilike.%${term}%`).order('name').limit(15);
    if (error) fail('Nie udało się wyszukać klientów. Zmień zapytanie, aby spróbować ponownie.');
    return { results: (data || []).map((row: Row) => ({ id: String(row.id), name: text(row.name), email: text(row.email), organizations: [] })) };
  }
  const { data, error } = await ctx.supabase.from('contacts')
    .select('id,full_name,email,links:contact_organizations(is_current,organization:organizations(id,name))')
    .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`).order('full_name').limit(15);
  if (error) fail('Nie udało się wyszukać klientów. Zmień zapytanie, aby spróbować ponownie.');
  return {
    results: (data || []).map((row: Row) => {
      const linked = (Array.isArray(row.links) ? row.links : []).filter((link: Row) => link.is_current)
        .flatMap((link: Row) => (link.organization ? (Array.isArray(link.organization) ? link.organization : [link.organization]) : []));
      const organizations = [...new Map(linked.map((org: Row) => [String(org.id), { id: String(org.id), name: text(org.name) }] as const)).values()];
      return { id: String(row.id), name: text(row.full_name), email: text(row.email), organizations };
    }),
  };
}

/** Ostatni własny PDF tej broszury — adres pliku do podglądu w oknie aplikacji. */
export async function brochureOwnPdf(ctx: NativeContext, rawId: string) {
  await requireView(ctx);
  const id = uuid(rawId, 'Nie znaleziono broszury.');
  const { data: employeeId } = await ctx.supabase.rpc('current_brochure_employee_id');
  if (!employeeId) fail('Nie masz jeszcze zapisanego PDF tej broszury.');
  const { data: generation } = await ctx.supabase.from('sales_brochure_generations')
    .select('pdf_path,file_name,version').eq('brochure_id', id).eq('created_by', employeeId)
    .order('version', { ascending: false }).limit(1).maybeSingle();
  if (!generation?.pdf_path) fail('Nie masz jeszcze zapisanego PDF tej broszury.');
  const fileName = text(generation!.file_name) || 'Broszura.pdf';
  const { data } = await ctx.supabase.storage.from('generated-brochures').createSignedUrl(generation!.pdf_path, 3600, { download: fileName });
  if (!data?.signedUrl) fail('Nie udało się otworzyć PDF. Spróbuj ponownie.');
  return { url: data!.signedUrl, fileName, version: Number(generation!.version) || 0 };
}

/** „Utwórz szkic kampanii” — tylko z własnej, aktualnej i ogólnej wersji PDF (jak `createCampaign` w CRM). */
export async function createBrochureCampaign(ctx: NativeContext, body: Row) {
  const access = await requireManage(ctx);
  if (!access.canViewResults) fail('Wymagane jest uprawnienie do własnych linków, PDF-ów i statystyk broszur.');
  const id = uuid(body.id, 'Nie znaleziono broszury.');
  const { data: brochure } = await ctx.supabase.from('sales_brochures')
    .select('current_pdf_path,current_pdf_version,modified_after_generation,brand_config').eq('id', id).maybeSingle();
  if (!brochure) fail('Nie znaleziono broszury.');
  if (!brochure!.current_pdf_path || brochure!.modified_after_generation) fail('Przed utworzeniem kampanii wygeneruj aktualną ogólną wersję PDF.');
  const { data: generation, error: generationError } = await ctx.supabase.from('sales_brochure_generations')
    .select('snapshot,created_by,recipient_contact_id,recipient_organization_id,recipient_email')
    .eq('brochure_id', id).eq('version', brochure!.current_pdf_version).single();
  if (generationError || !generation) fail(generationError?.message || 'Nie udało się odczytać bieżącej wersji PDF.');
  const snapshot = record(generation!.snapshot);
  const attribution = record(snapshot.demoAttribution);
  if (generation!.created_by !== ctx.employee.id) fail('Do kampanii potrzebujesz własnej ogólnej wersji PDF. Wygeneruj ją bez klienta i e-maila odbiorcy.');
  if (attribution.campaignId) fail('Bieżący PDF jest przypisany do innej kampanii. Wygeneruj ogólną wersję przed utworzeniem kolejnej kampanii.');
  if (generation!.recipient_contact_id || generation!.recipient_organization_id || generation!.recipient_email
    || snapshot.recipientEmail || attribution.recipientEmail) {
    fail('Bieżący PDF jest przypisany do klienta. Do kampanii wygeneruj wersję ogólną bez klienta i e-maila odbiorcy.');
  }
  const { data, error } = await ctx.supabase.rpc('create_hotel_brochure_campaign', { p_brochure_id: id, p_name: null, p_subject: null });
  if (error || !data) fail(error?.message || 'Nie udało się przygotować kampanii');
  return { campaignId: String(data), sellerDemo: record(brochure!.brand_config).seller_demo_enabled === true };
}
