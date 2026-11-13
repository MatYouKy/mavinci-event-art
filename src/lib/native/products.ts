import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { can, type NativeContext } from './auth';
import {
  productReadiness,
  READINESS_CHECK_SHORT,
  READINESS_EXEMPTION_KEYS,
  withoutReadinessExemption,
  withReadinessExemption,
  type ProductReadiness,
  type ReadinessExemptionKey,
} from '@/lib/CRM/Offers/productReadiness';
import { compactProductBlockReason } from '@/lib/CRM/Offers/productPresentation';
import { packageCostLineNet, staffCostItem } from '@/lib/CRM/Offers/productSalesPackages';

/*
 * Produkty (katalog oferty) na Macu — `/crm/offers?tab=catalog` i karta produktu `/crm/offers/products/[id]`: te same dane
 * i zasady co w CRM (RLS tokenem pracownika). Gotowość do oferty liczy `productReadiness` (jak katalog i karta w CRM),
 * zapis sekcji karty jak `saveProductSection` w `ProductDetailPage` (te same pola i sprawdzenia), grafika do oferty
 * w magazynie `offer-product-pages` (`assets/<id>/offer-image-<uuid>`).
 */

type Row = Record<string, any>;
export const PRODUCT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = 'offer-product-pages';

export function fail(message: string): never {
  throw new Error(message);
}

/** Uprawnienia jak w CRM: podgląd `offers_view`, edycja karty `offers_manage` (albo administrator). */
export const productsAccess = (ctx: NativeContext) => ({
  canView: can(ctx.employee, 'offers_view') || can(ctx.employee, 'offers_manage'),
  canEdit: ctx.employee.isAdmin || can(ctx.employee, 'offers_manage'),
});

const productId = (value: unknown) => {
  const id = String(value || '');
  if (!PRODUCT_UUID.test(id)) fail('Nieprawidłowy produkt.');
  return id;
};

// MARK: Katalog

const CATALOG_SELECT = '*,category:event_categories(id,name),'
  + 'variants:offer_product_variants(id,name,price_net,price_gross,is_recommended,is_active,display_order,offer_image_path,overrides_contract_clauses,recommended_contract_clauses),'
  + 'equipment:offer_product_equipment(id),staff:offer_product_staff(hourly_rate,estimated_hours,compensation,is_optional)';

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/** Gotowość z zasobami z katalogu (sprzęt, obsada) — jak `readinessOf` w katalogu CRM. */
const readinessOf = (row: Row): ProductReadiness => productReadiness(
  row,
  Array.isArray(row.equipment) ? { equipmentCount: row.equipment.length, staff: Array.isArray(row.staff) ? row.staff : [] } : null,
);

/** „Gotowy do oferty” albo „Braki: koszt, zdjęcie…” (jak `readinessSummary` w CRM). */
const readinessText = (readiness: ProductReadiness) => readiness.ready
  ? 'Gotowy do oferty'
  : `Braki: ${Array.from(new Set(readiness.missing.map((check) => READINESS_CHECK_SHORT[check.key]))).join(', ')}`;

/** Cena „od”: najtańszy aktywny wariant albo cena produktu (jak `getProductPrices` w katalogu CRM). */
function prices(row: Row) {
  const variants = (Array.isArray(row.variants) ? row.variants : []).filter((variant: Row) => variant?.is_active !== false);
  const lowest = variants.reduce((best: Row | null, variant: Row) => (!best || number(variant.price_net) < number(best.price_net) ? variant : best), null);
  const net = number(lowest?.price_net ?? row.price_net ?? row.base_price);
  const vat = number(row.vat_rate, 23);
  const gross = number(lowest?.price_gross ?? row.price_gross, net * (1 + vat / 100));
  const cost = number(row.cost_net ?? row.cost_price);
  return { net, gross, fromVariant: Boolean(lowest), margin: cost > 0 && net > 0 ? ((net - cost) / net) * 100 : null };
}

async function signed(ctx: NativeContext, paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const urls = new Map<string, string>();
  if (!unique.length) return urls;
  const { data } = await ctx.supabase.storage.from(BUCKET).createSignedUrls(unique, 3600);
  (data || []).forEach((item: Row) => { if (item?.path && item?.signedUrl) urls.set(String(item.path), String(item.signedUrl)); });
  return urls;
}

export async function productsState(ctx: NativeContext) {
  const access = productsAccess(ctx);
  const [categoriesRes, productsRes] = await Promise.all([
    ctx.supabase.from('event_categories').select('id, name').eq('is_active', true).order('order_index'),
    ctx.supabase.from('offer_products').select(CATALOG_SELECT).order('display_order'),
  ]);
  if (productsRes.error) throw productsRes.error;
  const rows = (productsRes.data || []) as Row[];
  const items = rows.map((row) => {
    const readiness = readinessOf(row);
    const price = prices(row);
    const category = Array.isArray(row.category) ? row.category[0] : row.category;
    const variants = (Array.isArray(row.variants) ? row.variants : []).filter((variant: Row) => variant?.is_active !== false);
    return {
      id: String(row.id),
      name: String(row.name || ''),
      categoryId: row.category_id ?? null,
      category: category?.name ? String(category.name) : null,
      active: row.is_active !== false,
      order: number(row.display_order),
      priceNet: price.net,
      priceGross: price.gross,
      fromVariant: price.fromVariant,
      margin: price.margin,
      unit: String(row.unit || ''),
      description: String(row.description || '').trim().slice(0, 400),
      tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
      imagePath: row.offer_image_path || null,
      personnel: row.is_personnel_service === true,
      subcontractor: row.is_subcontractor_service === true,
      packages: row.sales_packages_enabled === true && Array.isArray(row.sales_packages) ? row.sales_packages.length : 0,
      variants: variants.length,
      updatedAt: row.updated_at ?? null,
      readiness: {
        ready: readiness.ready,
        summary: readinessText(readiness),
        groups: readiness.groups.map((group) => ({ key: group.key, label: group.label, short: group.short, ok: group.ok })),
      },
    };
  });
  // Szukanie jak w CRM (nazwa, opis, tagi) robi Mac na pełnym opisie — tu skrót wystarczy do listy.
  const categories = ((categoriesRes.data || []) as Row[]).map((row) => ({ id: String(row.id), name: String(row.name || '') }));
  const payload = { ...access, isAdmin: ctx.employee.isAdmin, categories, products: items };
  const hash = createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  // Podpisane adresy miniatur zmieniają się przy każdym pobraniu — poza skrótem zmian.
  const urls = await signed(ctx, items.map((item) => item.imagePath || ''));
  return { ...payload, products: items.map((item) => ({ ...item, imageUrl: item.imagePath ? urls.get(item.imagePath) || null : null })), hash };
}

// MARK: Karta produktu

/** Pola karty (część A): podstawowe, prezentacja, wycena, ceny i koszty, realizacja, podwykonawca, tagi, grafika. */
const CARD_FIELDS = [
  'id', 'name', 'category_id', 'description', 'is_active', 'is_personnel_service', 'display_order', 'updated_at',
  'offer_short_description', 'offer_description', 'public_description', 'offer_compact_description', 'service_duration_hours',
  'extension_price_net_per_hour', 'offer_benefits', 'product_page_url', 'offer_page_variant',
  'unit', 'min_quantity', 'quantity_source',
  'vat_rate', 'price_net', 'price_gross', 'cost_net', 'cost_gross', 'transport_cost_net', 'transport_cost_gross',
  'logistics_cost_net', 'logistics_cost_gross', 'base_price',
  'requires_vehicle', 'requires_driver', 'setup_time_hours', 'teardown_time_hours', 'max_quantity',
  'is_subcontractor_service', 'subcontractor_id', 'subcontractor_service_catalog_id', 'subcontractor_settlement_method',
  'subcontractor_economic_cost', 'tags',
  'offer_image_path', 'offer_image_alt', 'offer_image_position_x', 'offer_image_position_y', 'offer_image_zoom',
  'readiness_exemptions', 'sales_packages_enabled',
] as const;

const DETAIL_SELECT = '*,category:event_categories(id,name),'
  + 'variants:offer_product_variants(id,name,price_net,price_gross,is_recommended,is_active,display_order,offer_image_path,overrides_contract_clauses,recommended_contract_clauses)';

/** Koszt obsady produktu bazowego dla firmy (jak `ProductStaffSection` → „Obsada — koszt dla firmy”); `null` — nieustalony. */
function staffCost(rows: Row[]): number | null {
  let total = 0;
  for (const row of rows) {
    if (row.is_optional) continue;
    let cost: number | null;
    if (row.compensation) {
      const line = staffCostItem({ ...row, notes: row.notes || '' } as any);
      cost = line ? packageCostLineNet(line) : null;
    } else {
      cost = row.hourly_rate != null && row.estimated_hours != null
        ? Math.round(Number(row.hourly_rate) * Number(row.estimated_hours) * Number(row.quantity) * 100) / 100
        : null;
    }
    if (cost == null || !Number.isFinite(cost)) return null;
    total += cost;
  }
  return Math.round(total * 100) / 100;
}

export async function productDetail(ctx: NativeContext, id: string) {
  const access = productsAccess(ctx);
  const productKey = productId(id);
  const [productRes, equipmentRes, staffRes, categoriesRes, subcontractorsRes] = await Promise.all([
    ctx.supabase.from('offer_products').select(DETAIL_SELECT).eq('id', productKey).maybeSingle(),
    ctx.supabase.from('offer_product_equipment').select('id', { count: 'exact', head: true }).eq('product_id', productKey),
    ctx.supabase.from('offer_product_staff').select('id, role, quantity, hourly_rate, estimated_hours, compensation, is_optional, notes, product_variant_id').eq('product_id', productKey),
    ctx.supabase.from('event_categories').select('id, name').eq('is_active', true).order('order_index'),
    ctx.supabase.from('organizations').select('id, name').eq('organization_type', 'subcontractor').eq('status', 'active').order('name'),
  ]);
  if (productRes.error || !productRes.data) fail('Nie znaleziono produktu.');
  const row = productRes.data as Row;
  const staffRows = staffRes.error ? null : (staffRes.data || []) as Row[];
  const resources = equipmentRes.error || !staffRows ? null : { equipmentCount: equipmentRes.count ?? 0, staff: staffRows };
  const readiness = productReadiness(row, resources);
  const variants = (Array.isArray(row.variants) ? row.variants : []).filter((variant: Row) => variant?.is_active !== false);
  const isStage = ['stage', 'warehouse_stage'].includes(row.configuration_schema?.profile || '');
  const urls = await signed(ctx, [row.offer_image_path || '']);
  const services = row.subcontractor_id ? await subcontractorServices(ctx, row.subcontractor_id) : [];
  const packages = row.sales_packages_enabled === true && Array.isArray(row.sales_packages) ? row.sales_packages.length : 0;
  return {
    ...access,
    product: Object.fromEntries(CARD_FIELDS.map((key) => [key, row[key] ?? null])),
    imageUrl: row.offer_image_path ? urls.get(row.offer_image_path) || null : null,
    facts: {
      variants: variants.length,
      packages,
      packageNames: packages ? (row.sales_packages as Row[]).map((item) => String(item?.name || 'Pakiet')) : [],
      addons: Array.isArray(row.pricing_addons) ? row.pricing_addons.length : 0,
      stage: isStage,
      compactBlockReason: compactProductBlockReason({ ...row, offer_product_variants: variants }),
      individualExtensionRates: variants.length > 0 || packages > 0,
      staffCostNet: staffRows ? staffCost(staffRows.filter((item) => !item.product_variant_id)) : null,
    },
    readiness: {
      ready: readiness.ready,
      summary: readinessText(readiness),
      resourcesChecked: resources !== null,
      groups: readiness.groups.map((group) => ({
        key: group.key,
        label: group.label,
        short: group.short,
        ok: group.ok,
        checks: group.checks.map((check) => ({
          key: check.key,
          label: check.label,
          state: check.state,
          anchor: check.anchor,
          detail: check.detail,
          exemptionKey: check.exemptionKey,
          exemption: check.exemption ? { reason: check.exemption.reason, at: check.exemption.at ?? null } : null,
        })),
      })),
    },
    categories: ((categoriesRes.data || []) as Row[]).map((item) => ({ id: String(item.id), name: String(item.name || '') })),
    subcontractors: ((subcontractorsRes.data || []) as Row[]).map((item) => ({ id: String(item.id), name: String(item.name || '') })),
    services,
  };
}

/** Usługi i sprzęt podwykonawcy (organizacja → `subcontractor_service_catalog` i `subcontractor_rental_equipment`). */
export async function subcontractorServices(ctx: NativeContext, organizationId: string) {
  if (!PRODUCT_UUID.test(String(organizationId || ''))) return [];
  const { data: organization } = await ctx.supabase.from('organizations').select('subcontractor_id').eq('id', organizationId).maybeSingle();
  const subcontractor = (organization as Row | null)?.subcontractor_id;
  if (!subcontractor) return [];
  const [services, equipment] = await Promise.all([
    ctx.supabase.from('subcontractor_service_catalog').select('*').eq('subcontractor_id', subcontractor).eq('is_active', true).order('name'),
    ctx.supabase.from('subcontractor_rental_equipment').select('*').eq('subcontractor_id', subcontractor).eq('is_active', true).order('name'),
  ]);
  const amount = (value: unknown) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
  const pick = (row: Row, type: 'service' | 'equipment') => ({
    id: String(row.id),
    name: String(row.name || ''),
    type,
    unit: row.unit ? String(row.unit) : null,
    settlementMethod: row.settlement_method ? String(row.settlement_method) : null,
    priceNet: amount(row.price_net),
    priceGross: amount(row.price_gross),
    unitPrice: amount(row.unit_price),
    vatRate: amount(row.vat_rate),
    economicCost: amount(row.economic_cost),
    dailyPriceNet: amount(row.daily_price_net),
    dailyPriceGross: amount(row.daily_price_gross),
    rentalPricePerDay: amount(row.rental_price_per_day),
  });
  return [
    ...((services.data || []) as Row[]).map((row) => pick(row, 'service')),
    ...((equipment.data || []) as Row[]).map((row) => pick(row, 'equipment')),
  ];
}

// MARK: Zapis sekcji karty (jak `saveProductSection` w CRM)

const SECTION_FIELDS: Record<string, readonly string[]> = {
  basic: ['name', 'category_id', 'description', 'is_active', 'is_personnel_service'],
  presentation: ['offer_short_description', 'offer_description', 'public_description', 'offer_compact_description', 'service_duration_hours',
    'extension_price_net_per_hour', 'offer_benefits', 'product_page_url', 'offer_page_variant'],
  pricing_units: ['unit', 'min_quantity', 'quantity_source'],
  pricing: ['vat_rate', 'price_net', 'price_gross', 'cost_net', 'cost_gross', 'transport_cost_net', 'transport_cost_gross',
    'logistics_cost_net', 'logistics_cost_gross'],
  technical: ['requires_vehicle', 'requires_driver', 'setup_time_hours', 'teardown_time_hours', 'max_quantity'],
  supplier: ['is_subcontractor_service', 'subcontractor_id', 'subcontractor_service_catalog_id', 'subcontractor_settlement_method',
    'subcontractor_economic_cost', 'vat_rate', 'price_net', 'price_gross', 'cost_net', 'cost_gross', 'transport_cost_net',
    'transport_cost_gross', 'logistics_cost_net', 'logistics_cost_gross', 'base_price'],
  tags: ['tags'],
  offer_image: ['offer_image_path', 'offer_image_alt', 'offer_image_position_x', 'offer_image_position_y', 'offer_image_zoom'],
};

const BOOLEAN_FIELDS = new Set(['is_active', 'is_personnel_service', 'requires_vehicle', 'requires_driver', 'is_subcontractor_service']);
const NUMBER_FIELDS = new Set(['vat_rate', 'price_net', 'price_gross', 'cost_net', 'cost_gross', 'transport_cost_net', 'transport_cost_gross',
  'logistics_cost_net', 'logistics_cost_gross', 'base_price', 'min_quantity', 'max_quantity', 'setup_time_hours', 'teardown_time_hours',
  'service_duration_hours', 'extension_price_net_per_hour', 'subcontractor_economic_cost', 'offer_image_position_x',
  'offer_image_position_y', 'offer_image_zoom']);
/** Liczby, które mogą być puste (CRM: „bez limitu”, „nie określono”). */
const NULLABLE_NUMBERS = new Set(['max_quantity', 'service_duration_hours', 'extension_price_net_per_hour', 'subcontractor_economic_cost']);
const UUID_FIELDS = new Set(['category_id', 'subcontractor_id', 'subcontractor_service_catalog_id']);
const LIST_FIELDS = new Set(['offer_benefits', 'tags']);
const TEXT_LIMITS: Record<string, number> = {
  name: 300, description: 8000, offer_short_description: 1000, offer_description: 8000, public_description: 16000,
  offer_compact_description: 2000, product_page_url: 1000, offer_image_alt: 300, unit: 40, subcontractor_settlement_method: 60,
};

function coerce(key: string, value: unknown) {
  if (BOOLEAN_FIELDS.has(key)) return value === true;
  if (NUMBER_FIELDS.has(key)) {
    if ((value === null || value === '') && NULLABLE_NUMBERS.has(key)) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) fail('Ilości, czas i kwoty muszą być liczbami.');
    return parsed;
  }
  if (UUID_FIELDS.has(key)) {
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !PRODUCT_UUID.test(value)) fail('Nieprawidłowy wybór.');
    return value;
  }
  if (LIST_FIELDS.has(key)) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item ?? '').trim().slice(0, 500)).filter(Boolean).slice(0, 50);
  }
  if (value === null) return null;
  const text = String(value ?? '');
  const limit = TEXT_LIMITS[key] ?? 2000;
  if (text.length > limit) fail('Tekst jest za długi.');
  return text;
}

const NON_NEGATIVE = ['vat_rate', 'price_net', 'price_gross', 'cost_net', 'cost_gross', 'transport_cost_net', 'transport_cost_gross',
  'logistics_cost_net', 'logistics_cost_gross', 'min_quantity', 'max_quantity', 'setup_time_hours', 'teardown_time_hours',
  'service_duration_hours', 'extension_price_net_per_hour'];

export async function saveProductSection(ctx: NativeContext, body: Row) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do zmiany produktów.');
  const id = productId(body.id);
  const section = String(body.section || '');
  const fields = SECTION_FIELDS[section];
  if (!fields) fail('Nieznana sekcja produktu.');
  const input = body.patch && typeof body.patch === 'object' ? body.patch as Row : {};
  const patch: Row = {};
  fields.forEach((key) => { if (key in input) patch[key] = coerce(key, input[key]); });
  if (!Object.keys(patch).length) fail('Brak zmian do zapisania.');

  const { data: current, error: readError } = await ctx.supabase.from('offer_products')
    .select('id, sales_packages_enabled, sales_packages, pricing_addons, configuration_schema, offer_product_variants(is_active)')
    .eq('id', id).maybeSingle();
  if (readError || !current) fail('Nie znaleziono produktu.');
  const product = current as Row;

  if (section === 'basic') {
    patch.name = String(patch.name || '').trim();
    if (!patch.name) fail('Podaj nazwę produktu');
  }
  if (section === 'pricing_units') {
    patch.unit = String(patch.unit || '').trim();
    if (!patch.unit) fail('Podaj jednostkę produktu');
    if (!Number.isFinite(patch.min_quantity) || Number(patch.min_quantity) <= 0) fail('Minimalna ilość musi być większa od zera');
    if ('quantity_source' in patch && !['manual', 'guests', 'tables'].includes(patch.quantity_source)) patch.quantity_source = 'manual';
  }
  if (product.sales_packages_enabled && Array.isArray(product.sales_packages) && product.sales_packages.length && section === 'pricing_units') {
    patch.unit = 'pakiet';
    patch.min_quantity = 1;
  }
  if (NON_NEGATIVE.some((key) => patch[key] != null && Number(patch[key]) < 0)) fail('Ilości, czas i kwoty muszą być nieujemnymi liczbami');
  if (section === 'presentation') {
    const url = String(patch.product_page_url || '').trim();
    if (url) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
      } catch {
        fail('Wklej pełny link rozpoczynający się od https:// lub http://');
      }
    }
    patch.product_page_url = url || null;
    patch.public_description = String(patch.public_description || '').trim() || null;
    patch.offer_compact_description = String(patch.offer_compact_description || '').trim() || null;
    const isStage = ['stage', 'warehouse_stage'].includes(product.configuration_schema?.profile || '');
    const variant = ['default', 'visual', 'compact'].includes(patch.offer_page_variant) ? patch.offer_page_variant : 'default';
    const blocked = compactProductBlockReason({ ...product, offer_product_variants: product.offer_product_variants });
    patch.offer_page_variant = isStage
      ? (variant === 'compact' ? 'compact' : 'default')
      : (Array.isArray(product.pricing_addons) && product.pricing_addons.length) || (variant === 'compact' && blocked) ? 'default' : variant;
  }
  if (section === 'offer_image') {
    const path = patch.offer_image_path;
    if (path != null && (typeof path !== 'string' || !path.startsWith(`assets/${id}/`) || path.includes('..'))) fail('Nieprawidłowa grafika.');
    patch.offer_image_alt = String(patch.offer_image_alt || '').trim() || null;
    patch.offer_image_position_x = Math.min(100, Math.max(0, Number(patch.offer_image_position_x ?? 50)));
    patch.offer_image_position_y = Math.min(100, Math.max(0, Number(patch.offer_image_position_y ?? 25)));
    patch.offer_image_zoom = Math.min(3, Math.max(0.5, Number(patch.offer_image_zoom ?? 1)));
  }
  if (section === 'supplier' && 'subcontractor_settlement_method' in patch) {
    patch.subcontractor_settlement_method = patch.subcontractor_settlement_method || null;
  }

  const { data, error } = await ctx.supabase.from('offer_products').update(patch).eq('id', id).select('id').maybeSingle();
  if (error) fail(error.message);
  if (!data) fail('Nie znaleziono produktu albo nie masz uprawnień do jego zmiany.');
  return productDetail(ctx, id);
}

// MARK: „Nie dotyczy”, nowy produkt, usunięcie, grafika

export async function setReadinessExemption(ctx: NativeContext, body: Row) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do zmiany produktów.');
  const id = productId(body.id);
  const key = String(body.key || '') as ReadinessExemptionKey;
  if (!READINESS_EXEMPTION_KEYS.includes(key)) fail('Nieznane wymaganie.');
  const { data: current, error: readError } = await ctx.supabase.from('offer_products').select('readiness_exemptions').eq('id', id).maybeSingle();
  if (readError || !current) fail('Nie znaleziono produktu.');
  const existing = (current as Row).readiness_exemptions;
  const next = typeof body.reason === 'string' && body.reason.trim()
    ? withReadinessExemption(existing, key, body.reason, ctx.employee.id)
    : withoutReadinessExemption(existing, key);
  const { data, error } = await ctx.supabase.from('offer_products').update({ readiness_exemptions: next }).eq('id', id).select('id').maybeSingle();
  if (error) fail(error.message);
  if (!data) fail('Nie znaleziono produktu.');
  return productDetail(ctx, id);
}

/** Nowy produkt z wartościami domyślnymi jak „Nowy produkt” w CRM; resztę uzupełnia się na karcie. */
export async function createProduct(ctx: NativeContext, body: Row) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do dodawania produktów.');
  const name = String(body.name ?? '').trim();
  if (!name) fail('Podaj nazwę produktu');
  if (name.length > 300) fail('Nazwa produktu jest za długa.');
  const category = body.category_id && PRODUCT_UUID.test(String(body.category_id)) ? String(body.category_id) : null;
  const { data, error } = await ctx.supabase.from('offer_products').insert({
    name, category_id: category, description: '', vat_rate: 23, price_net: 0, price_gross: 0, cost_net: 0, cost_gross: 0,
    transport_cost_net: 0, transport_cost_gross: 0, logistics_cost_net: 0, logistics_cost_gross: 0, setup_time_hours: 0,
    teardown_time_hours: 0, unit: 'szt', min_quantity: 1, max_quantity: null, requires_vehicle: false, requires_driver: false,
    tags: [], is_active: true, is_personnel_service: false, display_order: 0, offer_benefits: [], offer_requirements: [],
    offer_additional_requirements: [], offer_image_position_x: 50, offer_image_position_y: 25, offer_image_zoom: 1,
    offer_page_variant: 'default', offer_page_enabled: true, is_subcontractor_service: false, pricing_addons: [], related_service_ids: [],
  }).select('id').single();
  if (error || !data) fail(error?.message || 'Nie udało się dodać produktu.');
  return { ok: true, id: String((data as Row).id) };
}

export async function deleteProduct(ctx: NativeContext, body: Row) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do usuwania produktów.');
  const id = productId(body.id);
  const { data, error } = await ctx.supabase.from('offer_products').delete().eq('id', id).select('id');
  if (error) {
    if (error.code === '23503') fail('Produkt jest używany w ofertach lub wydarzeniach. Wyłącz go („Produkt aktywny”) zamiast usuwać.');
    fail(error.message);
  }
  if (!data?.length) fail('Nie znaleziono produktu albo nie masz uprawnień do jego usunięcia.');
  return { ok: true };
}

const IMAGE_TYPES: Array<{ type: string; extension: string; test: (bytes: Buffer) => boolean }> = [
  { type: 'image/png', extension: 'png', test: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', extension: 'jpg', test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { type: 'image/webp', extension: 'webp', test: (bytes) => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
];

/** Zdjęcie produktu do oferty (Mac zmniejsza je wcześniej do 1800 px jak `optimizeOfferImage`); zapis ścieżki — sekcja `offer_image`. */
export async function uploadProductImage(ctx: NativeContext, body: Row) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do zmiany produktów.');
  const id = productId(body.id);
  const bytes = Buffer.from(typeof body.data === 'string' ? body.data : '', 'base64');
  if (!bytes.length) fail('Nie wybrano zdjęcia.');
  if (bytes.length > 8 * 1024 * 1024) fail('Zdjęcie jest za duże.');
  const kind = IMAGE_TYPES.find((item) => item.test(bytes));
  if (!kind) fail('Wybierz zdjęcie JPG, PNG lub WebP.');
  const path = `assets/${id}/offer-image-${randomUUID()}.${kind.extension}`;
  const { error } = await ctx.supabase.storage.from(BUCKET).upload(path, bytes, { contentType: kind.type, upsert: false });
  if (error) fail(error.message || 'Nie udało się wysłać zdjęcia.');
  const urls = await signed(ctx, [path]);
  return { ok: true, path, url: urls.get(path) || null };
}

/**
 * Wersja angielska po zmianie treści — jak `refreshEnglish` w CRM po zapisie sekcji (`translate-product`, action generate).
 * Mac wywołuje ją w tle; błąd nie cofa zapisu, a CRM pokaże nieaktualne tłumaczenie do ponownego wygenerowania.
 */
export async function refreshProductEnglish(ctx: NativeContext, body: Row) {
  if (!productsAccess(ctx).canEdit) fail('Nie masz uprawnień do zmiany produktów.');
  const id = productId(body.id);
  const { data, error } = await ctx.supabase.functions.invoke('translate-product', { body: { action: 'generate', productId: id } });
  let message = (data as Row | null)?.error as string | undefined;
  if (error && !message) {
    try { message = (await (error as any).context?.json())?.error; } catch { /* komunikat zastępczy */ }
  }
  if (error || message) fail(message || 'Nie udało się przygotować wersji angielskiej.');
  return { ok: true };
}
