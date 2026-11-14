import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { fail, PRODUCT_UUID, productsAccess } from './products';
import { validateAddons, type ProductAddon } from '@/lib/CRM/Offers/offerAddons';
import { validateSalesPackages, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';
import { getOfferRequirementLabel, inferOfferRequirementCategory } from '@/lib/CRM/Offers/offerRequirements';
import { relatedServicePagePath, servicePagePath } from '@/lib/CRM/Offers/relatedServices';

/*
 * Karta produktu na Macu, część C1 — warianty (elementy) produktu ze zdjęciami, przygotowanie i zamówienia (kroki realizacji),
 * wymagania produktu, powiązane usługi na stronie oraz dodatki i limity pakietu: te same pola, sprawdzenia i zapis co
 * `saveVariantSection`, `ProductPreparationItems`, `saveRequirementSection`, `ProductRelatedServicesSection`
 * i `saveAddonSection` w CRM.
 */

type Row = Record<string, any>;
const BUCKET = 'offer-product-pages';

const uuid = (value: unknown, message: string) => {
  const id = String(value || '');
  if (!PRODUCT_UUID.test(id)) fail(message);
  return id;
};
const editor = (ctx: NativeContext) => {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do zmiany produktów.');
};
const isMissingTable = (code?: string) => code === '42P01' || code === 'PGRST205';

/** Kategorie wymagań produktu (`PRODUCT_REQUIREMENT_CATEGORIES` w CRM). */
const REQUIREMENT_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: 'people', label: 'Ludzie i obsada' },
  { value: 'resources', label: 'Sprzęt i zasoby' },
  { value: 'place', label: 'Miejsce realizacji' },
  { value: 'time', label: 'Czas i harmonogram' },
  { value: 'power', label: 'Zasilanie' },
  { value: 'internet', label: 'Łącze internetowe' },
  { value: 'access', label: 'Dostęp i rozładunek' },
  { value: 'setup', label: 'Montaż i próba' },
  { value: 'surface', label: 'Miejsce realizacji' },
  { value: 'venue_approval', label: 'Zgoda obiektu' },
  { value: 'coordination', label: 'Koordynacja z obiektem' },
  { value: 'schedule', label: 'Harmonogram i materiały' },
  { value: 'safety', label: 'Bezpieczeństwo' },
  { value: 'technical', label: 'Inny warunek techniczny' },
  { value: 'accommodation', label: 'Zakwaterowanie' },
  { value: 'backstage', label: 'Zaplecze / garderoba' },
  { value: 'hospitality', label: 'Gościnność / catering' },
  { value: 'logistics', label: 'Logistyka' },
  { value: 'other', label: 'Inne' },
];

const PREPARATION_COLUMNS = 'id,product_id,kind,title,details,lead_days,anchor,owner_role,supplier,quantity_per_unit,unit,blocks_ready,order_index,is_active';
const PREPARATION_KINDS = ['order', 'stock_check', 'venue_confirmation', 'task'];
const PREPARATION_ANCHORS = ['event', 'loading'];
const PREPARATION_ROLES = ['warehouse', 'sales', 'manager'];

const normalizeRequirementText = (value: string) => value.toLocaleLowerCase('pl-PL').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();

/** Wymagania produktu z kategoriami, łącznie ze starszymi wpisami `offer_requirements` (jak `withCategorizedProductRequirements`). */
function requirementsOf(product: Row) {
  const categorized = (Array.isArray(product.offer_additional_requirements) ? product.offer_additional_requirements : []).map((item: Row, index: number) => {
    const description = String(item?.description || item?.title || '').trim();
    const category = String(inferOfferRequirementCategory(description, item?.category));
    return {
      id: String(item?.id || `stored-${index}`),
      category,
      title: String(item?.title || getOfferRequirementLabel(category)).trim(),
      description,
    };
  });
  const known = new Set(categorized.map((item: Row) => normalizeRequirementText(item.description)));
  (Array.isArray(product.offer_requirements) ? product.offer_requirements : []).forEach((value: unknown, index: number) => {
    const text = String(value || '').trim();
    const print = normalizeRequirementText(text);
    if (!text || known.has(print)) return;
    const category = String(inferOfferRequirementCategory(text));
    categorized.push({ id: `legacy-${index}-${print.slice(0, 20)}`, category, title: getOfferRequirementLabel(category), description: text });
    known.add(print);
  });
  return categorized;
}

// MARK: Odczyt

export async function productExtras(ctx: NativeContext, productValue: string) {
  const access = productsAccess(ctx);
  const productId = uuid(productValue, 'Nieprawidłowy produkt.');
  const [productRes, variantsRes, preparation, permission, services] = await Promise.all([
    ctx.supabase.from('offer_products').select('id, vat_rate, service_duration_hours, extension_price_net_per_hour, sales_packages_enabled, '
      + 'sales_packages, pricing_addons, offer_requirements, offer_additional_requirements, related_service_ids, related_service_url, related_service_label')
      .eq('id', productId).maybeSingle(),
    ctx.supabase.from('offer_product_variants').select('*').eq('product_id', productId).order('display_order'),
    ctx.supabase.from('offer_product_preparation_items').select(PREPARATION_COLUMNS).eq('product_id', productId)
      .order('order_index', { ascending: true }).order('created_at', { ascending: true }),
    ctx.supabase.rpc('can_manage_product_preparation'),
    ctx.supabase.from('services_catalog').select('id, title, slug, is_active').order('order_index'),
  ]);
  if (productRes.error || !productRes.data) fail('Nie znaleziono produktu.');
  if (variantsRes.error) fail(variantsRes.error.message);
  const product = productRes.data as Row;
  const variants = (variantsRes.data || []) as Row[];
  const packages = product.sales_packages_enabled === true && Array.isArray(product.sales_packages) ? product.sales_packages as Row[] : [];
  const allPackages = Array.isArray(product.sales_packages) ? product.sales_packages as Row[] : [];
  const paths = [...variants.map((variant) => variant.offer_image_path), ...allPackages.map((item) => item?.image_path)].filter(Boolean) as string[];
  const signed = paths.length ? await ctx.supabase.storage.from(BUCKET).createSignedUrls(paths, 3600) : { data: [] as Row[] };
  const urls = new Map(((signed.data || []) as Row[]).filter((item) => item?.signedUrl).map((item) => [String(item.path), String(item.signedUrl)]));
  const individual = variants.some((variant) => variant.is_active !== false) || packages.length > 0;
  const number = (value: unknown) => (value == null || value === '' ? null : Number(value));

  return {
    canEdit: access.canEdit,
    elementMode: product.sales_packages_enabled === true,
    vatRate: Number(product.vat_rate ?? 23),
    defaults: {
      serviceDurationHours: number(product.service_duration_hours),
      extensionPriceNetPerHour: individual ? null : number(product.extension_price_net_per_hour),
    },
    packageElementIds: Array.from(new Set<string>((Array.isArray(product.sales_packages) ? product.sales_packages as Row[] : []).flatMap((item) => (Array.isArray(item?.element_ids) ? item.element_ids.map(String) : [])))),
    variants: variants.map((variant) => ({
      id: String(variant.id),
      name: String(variant.name || ''),
      shortDescription: variant.short_description ? String(variant.short_description) : '',
      description: variant.description ? String(variant.description) : '',
      benefits: Array.isArray(variant.benefits) ? variant.benefits.map(String) : [],
      imagePath: variant.offer_image_path ? String(variant.offer_image_path) : null,
      imageAlt: variant.offer_image_alt ? String(variant.offer_image_alt) : '',
      imageUrl: variant.offer_image_path ? urls.get(String(variant.offer_image_path)) || null : null,
      priceNet: Number(variant.price_net || 0),
      priceGross: Number(variant.price_gross || 0),
      quantitySource: variant.quantity_source ? String(variant.quantity_source) : 'manual',
      serviceDurationHours: number(variant.service_duration_hours),
      extensionPriceNetPerHour: number(variant.extension_price_net_per_hour),
      recommended: variant.is_recommended === true,
      active: variant.is_active !== false,
    })),
    preparation: {
      available: !(preparation.error && isMissingTable(preparation.error.code)),
      error: preparation.error && !isMissingTable(preparation.error.code) ? 'Nie udało się wczytać przygotowania i zamówień.' : null,
      canManage: !permission.error && permission.data === true,
      items: ((preparation.data || []) as Row[]).map((item) => ({
        id: String(item.id),
        kind: String(item.kind),
        title: String(item.title || ''),
        details: item.details ? String(item.details) : null,
        leadDays: Number(item.lead_days ?? 0),
        anchor: String(item.anchor || 'event'),
        ownerRole: String(item.owner_role || 'warehouse'),
        supplier: item.supplier ? String(item.supplier) : null,
        quantity: number(item.quantity_per_unit),
        unit: item.unit ? String(item.unit) : null,
        blocksReady: item.blocks_ready === true,
        active: item.is_active !== false,
      })),
    },
    requirements: requirementsOf(product),
    requirementCategories: REQUIREMENT_CATEGORIES.map((category) => ({ ...category, defaultTitle: getOfferRequirementLabel(category.value) })),
    related: {
      ids: Array.isArray(product.related_service_ids) ? product.related_service_ids.map(String) : [],
      url: product.related_service_url ? String(product.related_service_url) : null,
      label: product.related_service_label ? String(product.related_service_label) : null,
      publicPath: relatedServicePagePath(product.related_service_url),
      services: ((services.data || []) as Row[]).filter((service) => servicePagePath(service.slug)).map((service) => ({
        id: String(service.id),
        title: String(service.title || ''),
        path: servicePagePath(service.slug),
        active: service.is_active !== false,
      })),
      error: services.error ? 'Nie udało się wczytać katalogu usług.' : null,
    },
    addons: Array.isArray(product.pricing_addons) ? product.pricing_addons : [],
    packages: {
      enabled: product.sales_packages_enabled === true,
      items: allPackages.map((item) => ({ ...item, image_url: item?.image_path ? urls.get(String(item.image_path)) || null : null })),
    },
  };
}

// MARK: Warianty / elementy

const IMAGE_TYPES: Array<{ type: string; extension: string; test: (bytes: Buffer) => boolean }> = [
  { type: 'image/png', extension: 'png', test: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', extension: 'jpg', test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: 'image/webp', extension: 'webp', test: (bytes) => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
];

const optionalAmount = (value: unknown) => {
  if (value == null || value === '') return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) fail('Ceny i czas usługi muszą być nieujemnymi liczbami');
  return amount;
};

/** Pełna lista wariantów w nowej kolejności (jak „Zapisz element”, przenoszenie, rekomendacja i usuwanie w CRM). */
export async function saveVariants(ctx: NativeContext, body: Row) {
  editor(ctx);
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const input = Array.isArray(body.variants) ? body.variants as Row[] : [];
  if (input.length > 60) fail('Produkt może mieć najwyżej 60 elementów.');
  const variants = input.map((item, index) => {
    const name = String(item?.name ?? '').trim();
    const short = String(item?.shortDescription ?? '').trim();
    const description = String(item?.description ?? '').trim();
    if (!name) fail('Każdy element musi mieć nazwę');
    if (name.length > 200) fail('Nazwa elementu jest za długa.');
    if (short.length > 95 || description.length > 205) fail('Skróć opisy do wskazanych limitów.');
    const priceNet = optionalAmount(item?.priceNet) ?? 0;
    const priceGross = optionalAmount(item?.priceGross) ?? 0;
    const quantitySource = ['manual', 'guests', 'tables'].includes(item?.quantitySource) ? item.quantitySource : 'manual';
    return {
      id: uuid(item?.id, 'Nieprawidłowy element produktu.'),
      product_id: productId,
      name,
      short_description: short || null,
      description: description || null,
      benefits: (Array.isArray(item?.benefits) ? item.benefits : []).map((line: unknown) => String(line ?? '').trim()).filter(Boolean).slice(0, 40),
      offer_image_path: typeof item?.imagePath === 'string' && item.imagePath.startsWith(`assets/${productId}/`) && !item.imagePath.includes('..') ? item.imagePath : null,
      offer_image_alt: String(item?.imageAlt ?? '').trim().slice(0, 300) || null,
      quantity_source: quantitySource,
      price_net: priceNet,
      price_gross: priceGross,
      service_duration_hours: optionalAmount(item?.serviceDurationHours),
      extension_price_net_per_hour: optionalAmount(item?.extensionPriceNetPerHour),
      is_recommended: item?.recommended === true,
      is_active: item?.active !== false,
      display_order: index,
    };
  });
  const names = variants.map((variant) => variant.name.toLocaleLowerCase('pl-PL'));
  if (new Set(names).size !== names.length) fail('Nazwy elementów produktu muszą być unikalne');
  if (variants.filter((variant) => variant.is_recommended).length > 1) {
    const first = variants.findIndex((variant) => variant.is_recommended);
    variants.forEach((variant, index) => { variant.is_recommended = index === first; });
  }

  const [productRes, existingRes] = await Promise.all([
    ctx.supabase.from('offer_products').select('id, sales_packages').eq('id', productId).maybeSingle(),
    ctx.supabase.from('offer_product_variants').select('id').eq('product_id', productId),
  ]);
  if (productRes.error || !productRes.data) fail('Nie znaleziono produktu.');
  if (existingRes.error) fail(existingRes.error.message);
  const ids = new Set(variants.map((variant) => variant.id));
  const removed = ((existingRes.data || []) as Row[]).map((row) => String(row.id)).filter((id) => !ids.has(id));
  const packages = Array.isArray((productRes.data as Row).sales_packages) ? (productRes.data as Row).sales_packages as Row[] : [];
  if (removed.length && packages.some((item) => (item?.element_ids || []).some((id: string) => removed.includes(id)))) {
    fail('Najpierw usuń element ze składu pakietów, aby usunąć go z produktu.');
  }

  // Zdjęcie elementu (Mac zmniejsza je do 1800 px jak `optimizeOfferImage`).
  let uploaded: string | null = null;
  if (body.image && typeof body.image === 'object') {
    const target = variants.find((variant) => variant.id === body.image.variantId);
    if (!target) fail('Nie znaleziono elementu dla zdjęcia.');
    if (body.image.remove === true) target.offer_image_path = null;
    if (typeof body.image.data === 'string' && body.image.data) {
      const bytes = Buffer.from(body.image.data, 'base64');
      if (bytes.length > 8 * 1024 * 1024) fail('Zdjęcie jest za duże.');
      const kind = IMAGE_TYPES.find((item) => item.test(bytes));
      if (!kind) fail('Wybierz zdjęcie JPG, PNG lub WebP o wielkości do 10 MB.');
      const path = `assets/${productId}/variants/${target.id}-${randomUUID()}.${kind.extension}`;
      const { error } = await ctx.supabase.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, upsert: false });
      if (error) fail(error.message || 'Nie udało się wysłać zdjęcia.');
      uploaded = path;
      target.offer_image_path = path;
    }
  }
  try {
    if (removed.length) {
      const { error } = await ctx.supabase.from('offer_product_variants').delete().eq('product_id', productId).in('id', removed);
      if (error) fail(error.message);
    }
    if (variants.length) {
      const { error } = await ctx.supabase.from('offer_product_variants').upsert(variants, { onConflict: 'id' });
      if (error) fail(error.message);
    }
  } catch (error) {
    if (uploaded) await ctx.supabase.storage.from(BUCKET).remove([uploaded]).catch(() => undefined);
    throw error;
  }
  return productExtras(ctx, productId);
}

// MARK: Przygotowanie i zamówienia

function preparationError(error: Row | null, fallback: string): never {
  const code = error?.code;
  if (code === '42501') fail('Brak uprawnień do zmiany kroków przygotowania (administrator, oferty lub magazyn).');
  if (code === '23514' || code === '23502' || code === '22P02') fail('Sprawdź pola: nazwa 2–200 znaków, dni 0–90, ilość większa od zera.');
  if (code === 'PGRST205' || code === '42P01') fail('Funkcja nie jest jeszcze włączona w bazie (brak migracji kroków realizacji).');
  fail(error?.message || fallback);
}

export async function savePreparation(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const item = body.item && typeof body.item === 'object' ? body.item as Row : {};
  const title = String(item.title ?? '').trim();
  const leadDays = Number(item.leadDays);
  const details = String(item.details ?? '');
  const supplier = String(item.supplier ?? '').trim();
  const unit = String(item.unit ?? '').trim();
  if (title.length < 2 || title.length > 200) fail('Podaj nazwę kroku (2–200 znaków).');
  if (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 90) fail('Liczba dni wyprzedzenia musi być liczbą całkowitą od 0 do 90.');
  let quantity: number | null = null;
  if (item.quantity != null && item.quantity !== '') {
    quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity >= 1e10) fail('Ilość na sztukę usługi musi być liczbą większą od zera.');
    quantity = Math.round(quantity * 100) / 100;
  }
  if (supplier.length > 300) fail('Nazwa dostawcy może mieć najwyżej 300 znaków.');
  if (unit.length > 30) fail('Jednostka może mieć najwyżej 30 znaków.');
  if (details.length > 2000) fail('Opis może mieć najwyżej 2000 znaków.');
  const row = {
    kind: PREPARATION_KINDS.includes(item.kind) ? item.kind : 'order',
    title,
    details: details.trim() || null,
    lead_days: leadDays,
    anchor: PREPARATION_ANCHORS.includes(item.anchor) ? item.anchor : 'event',
    owner_role: PREPARATION_ROLES.includes(item.ownerRole) ? item.ownerRole : 'warehouse',
    supplier: supplier || null,
    quantity_per_unit: quantity,
    unit: unit || null,
    blocks_ready: item.blocksReady === true,
    is_active: item.active !== false,
  };
  if (item.itemId) {
    const itemId = uuid(item.itemId, 'Nieprawidłowy krok.');
    const { data, error } = await ctx.supabase.from('offer_product_preparation_items').update(row).eq('id', itemId).eq('product_id', productId).select('id');
    if (error) preparationError(error, 'Nie udało się zapisać. Spróbuj ponownie.');
    if (!data?.length) preparationError({ code: '42501' }, '');
  } else {
    const { data: existing } = await ctx.supabase.from('offer_product_preparation_items').select('order_index').eq('product_id', productId);
    const next = ((existing || []) as Row[]).reduce((max, entry) => Math.max(max, Number(entry.order_index ?? 0)), -1) + 1;
    const { data, error } = await ctx.supabase.from('offer_product_preparation_items').insert({ ...row, product_id: productId, order_index: next }).select('id');
    if (error) preparationError(error, 'Nie udało się zapisać. Spróbuj ponownie.');
    if (!data?.length) preparationError({ code: '42501' }, '');
  }
  return productExtras(ctx, productId);
}

export async function togglePreparation(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const itemId = uuid(body.itemId, 'Nieprawidłowy krok.');
  const { data: current, error: readError } = await ctx.supabase.from('offer_product_preparation_items').select('is_active')
    .eq('id', itemId).eq('product_id', productId).maybeSingle();
  if (readError || !current) fail('Nie znaleziono kroku przygotowania.');
  const { data, error } = await ctx.supabase.from('offer_product_preparation_items').update({ is_active: !(current as Row).is_active })
    .eq('id', itemId).eq('product_id', productId).select('id');
  if (error) preparationError(error, 'Nie udało się zmienić stanu kroku.');
  if (!data?.length) preparationError({ code: '42501' }, '');
  return productExtras(ctx, productId);
}

export async function removePreparation(ctx: NativeContext, body: Row) {
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const itemId = uuid(body.itemId, 'Nieprawidłowy krok.');
  const { data, error } = await ctx.supabase.from('offer_product_preparation_items').delete().eq('id', itemId).eq('product_id', productId).select('id');
  if (error) preparationError(error, 'Nie udało się usunąć kroku.');
  if (!data?.length) preparationError({ code: '42501' }, '');
  return productExtras(ctx, productId);
}

// MARK: Wymagania, powiązane usługi, dodatki

async function patchProduct(ctx: NativeContext, productId: string, patch: Row, message: string) {
  const { data, error } = await ctx.supabase.from('offer_products').update(patch).eq('id', productId).select('id').maybeSingle();
  if (error || !data) fail(error?.message || message);
}

export async function saveRequirements(ctx: NativeContext, body: Row) {
  editor(ctx);
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const input = Array.isArray(body.requirements) ? body.requirements as Row[] : [];
  if (input.length > 60) fail('Produkt może mieć najwyżej 60 wymagań.');
  const requirements = input.map((item) => ({
    id: typeof item?.id === 'string' && item.id && item.id.length <= 80 ? item.id : randomUUID(),
    category: String(item?.category || 'other'),
    title: String(item?.title ?? '').trim(),
    description: String(item?.description ?? '').trim(),
  })).filter((item) => item.title || item.description);
  if (requirements.some((item) => !REQUIREMENT_CATEGORIES.some((category) => category.value === item.category))) fail('Wybierz kategorię wymagania.');
  if (requirements.some((item) => !item.title || !item.description)) fail('Podaj nazwę i warunki realizacji wymagania.');
  if (requirements.some((item) => item.title.length > 200 || item.description.length > 4000)) fail('Treść wymagania jest za długa.');
  await patchProduct(ctx, productId, { offer_requirements: [], offer_additional_requirements: requirements }, 'Nie udało się zapisać wymagań');
  return productExtras(ctx, productId);
}

export async function saveRelatedServices(ctx: NativeContext, body: Row) {
  editor(ctx);
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const ids = Array.from(new Set((Array.isArray(body.ids) ? body.ids : []).map(String).filter((id: string) => PRODUCT_UUID.test(id)))).slice(0, 50);
  const raw = String(body.url ?? '').trim();
  const url = relatedServicePagePath(raw);
  if (raw && !url) fail('Podaj adres strony Mavinci z działu /oferta/ lub /uslugi/, np. /oferta/kasyno.');
  const label = url ? String(body.label ?? '').trim().slice(0, 120) || null : null;
  await patchProduct(ctx, productId, { related_service_ids: ids, related_service_url: url, related_service_label: label }, 'Nie udało się zapisać powiązań.');
  return productExtras(ctx, productId);
}

export async function saveAddons(ctx: NativeContext, body: Row) {
  editor(ctx);
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const addons = (Array.isArray(body.addons) ? body.addons : []) as ProductAddon[];
  const problem = validateAddons(addons);
  if (problem) fail(problem);
  const clean = addons.map((addon) => ({
    id: String(addon.id),
    name: String(addon.name).trim(),
    description: String(addon.description || '').trim(),
    kind: addon.kind,
    unit: String(addon.unit).trim(),
    included_quantity: Number(addon.included_quantity || 0),
    quantity: Number(addon.quantity || 0),
    unit_price: Number(addon.unit_price || 0),
    enabled: addon.enabled === true,
    ...(addon.price_on_request ? { price_on_request: true } : {}),
    ...(addon.quantity_source ? { quantity_source: addon.quantity_source } : {}),
    ...(addon.staff_role ? { staff_role: String(addon.staff_role).trim() } : {}),
    ...(addon.staff_hours != null ? { staff_hours: Number(addon.staff_hours) } : {}),
    ...(addon.max_quantity != null ? { max_quantity: Number(addon.max_quantity) } : {}),
  }));
  await patchProduct(ctx, productId, { pricing_addons: clean, ...(clean.length ? { offer_page_variant: 'default' } : {}) }, 'Nie udało się zapisać dodatków');
  return productExtras(ctx, productId);
}

// MARK: Pakiety sprzedaży (druga strona oferty)

/** Lista pakietów (do trzech) i przełącznik „Dwie strony” jak `ProductSalesPackagesSection` + `saveSalesPackages` w CRM. */
export async function savePackages(ctx: NativeContext, body: Row) {
  editor(ctx);
  const productId = uuid(body.id, 'Nieprawidłowy produkt.');
  const input = Array.isArray(body.packages) ? body.packages as Row[] : [];
  const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
  const packages = input.map((item) => {
    const next: Row = {
      id: text(item?.id),
      name: text(item?.name).trim(),
      description: text(item?.description),
      included_label: text(item?.included_label).trim(),
      element_ids: Array.isArray(item?.element_ids) ? item.element_ids.map(String) : [],
      price_net: Number(item?.price_net),
      extension_price_net_per_hour: item?.extension_price_net_per_hour == null || item.extension_price_net_per_hour === '' ? null : Number(item.extension_price_net_per_hour),
      bonus: text(item?.bonus),
      highlighted: item?.highlighted === true,
      image_path: typeof item?.image_path === 'string' && item.image_path ? item.image_path : null,
      image_alt: text(item?.image_alt),
    };
    if (item?.price_on_request === true) next.price_on_request = true;
    if (item?.include_product_addons === true) next.include_product_addons = true;
    if (item?.audience_pricing && typeof item.audience_pricing === 'object') next.audience_pricing = item.audience_pricing;
    if (Array.isArray(item?.cost_items)) next.cost_items = item.cost_items;
    if (item?.resources && typeof item.resources === 'object') next.resources = item.resources;
    return next as ProductSalesPackage;
  });
  const problem = validateSalesPackages(packages);
  if (problem) fail(problem);
  if (packages.some((item) => item.image_path && (!item.image_path.startsWith(`assets/${productId}/`) || item.image_path.includes('..')))) fail('Nieprawidłowe zdjęcie pakietu.');
  const { data: variantRows, error: variantError } = await ctx.supabase.from('offer_product_variants').select('id').eq('product_id', productId);
  if (variantError) fail(variantError.message);
  const elements = new Set(((variantRows || []) as Row[]).map((row) => String(row.id)));
  if (packages.some((item) => item.element_ids.some((id) => !elements.has(id)))) fail('Zaktualizuj skład pakietu — jeden z elementów został usunięty.');

  const uploaded: string[] = [];
  try {
    for (const image of Array.isArray(body.images) ? body.images as Row[] : []) {
      const target = packages.find((item) => item.id === image?.packageId);
      if (!target || typeof image.data !== 'string' || !image.data) continue;
      const bytes = Buffer.from(image.data, 'base64');
      if (bytes.length > 8 * 1024 * 1024) fail('Zdjęcie pakietu jest za duże.');
      const kind = IMAGE_TYPES.find((entry) => entry.test(bytes));
      if (!kind) fail('Wybierz JPG, PNG lub WebP o wielkości do 10 MB.');
      const path = `assets/${productId}/packages/${target.id}-${randomUUID()}.${kind.extension}`;
      const { error } = await ctx.supabase.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, upsert: false });
      if (error) fail(error.message || 'Nie udało się wysłać zdjęcia pakietu.');
      uploaded.push(path);
      target.image_path = path;
    }
    const enabled = body.enabled === true && packages.length > 0;
    // Pakiety rozliczane są w sztukach pakietu (jak `saveProductSection` w CRM).
    await patchProduct(ctx, productId, {
      sales_packages: packages,
      sales_packages_enabled: enabled,
      ...(enabled ? { unit: 'pakiet', min_quantity: 1 } : {}),
    }, 'Nie udało się zapisać pakietu.');
  } catch (error) {
    if (uploaded.length) await ctx.supabase.storage.from(BUCKET).remove(uploaded).catch(() => undefined);
    throw error;
  }
  return productExtras(ctx, productId);
}
