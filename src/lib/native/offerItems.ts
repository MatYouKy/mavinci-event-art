import 'server-only';
import type { NativeContext } from './auth';
import { fail, offerDetail } from './offers';
import { modularSnapshotOf } from './modularConfigurator';
import {
  configurationPrice,
  createConfiguration,
  createModularConfiguration,
  validateConfiguration,
  type OfferConfiguration,
  type ProductAddon,
} from '@/lib/CRM/Offers/offerAddons';
import { modularScope, modularTitle, type ProductConfigurationSnapshot } from '@/lib/CRM/Offers/modularProduct';
import {
  configurationNeedsTables,
  resolveAudienceConfiguration,
  type OfferAudience,
  type QuantitySource,
} from '@/lib/CRM/Offers/audiencePricing';
import { pricedPackageSelection, type ProductSalesPackage } from '@/lib/CRM/Offers/productSalesPackages';

/*
 * Oferty na Macu, część B2 — dodawanie i edycja pozycji oferty jak `AddOfferItemModal` / `EditOfferItemModal`: wybór produktu
 * z katalogu, wariant albo pakiet, ilość (ręcznie, z liczby osób lub stołów), dni, cena, rabat, dodatki, ceny wariantów
 * w tej ofercie, widoczność wariantów w PDF i stawka VAT. Wycenę liczą te same funkcje co CRM (`createConfiguration`,
 * `resolveAudienceConfiguration`, `configurationPrice`, `validateConfiguration`) — Mac wysyła szkic, serwer zwraca podgląd
 * i zapisuje. Produkty z konfiguratorem (scena, LED): szkic niesie konfigurację (`modular`, z `op=modular`), cenę liczy
 * `createModularConfiguration` — z kalkulatora albo własna (`modularManual`), jak `ModularPriceHint` w CRM.
 * Pakiety w tej ofercie (`ProductPackagePicker`): szkic może nieść `packageOptions` — cena, zakres, cena z liczby osób,
 * sprzęt i obsada oraz koszty pakietów tylko w tej ofercie; serwer przenosi wyłącznie te pola na zapisane pakiety.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message = 'Nieprawidłowa oferta.') => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));
const money = (value: number) => Math.round(value * 100) / 100;
const VAT_RATES = [0, 5, 8, 23];

export async function editable(ctx: NativeContext, id: string) {
  const [{ data: allowed, error: permissionError }, { data: offer, error }] = await Promise.all([
    ctx.supabase.rpc('sales_can_manage_offer', { p_offer: id }),
    ctx.supabase.from('offers').select('id, status, sales_channel, guest_count, guests_per_table, table_count, tax_percent, recommended_items').eq('id', id).maybeSingle(),
  ]);
  if (error || !offer) fail('Nie znaleziono oferty.');
  if (permissionError || allowed !== true) fail('Nie masz uprawnień do zmiany tej oferty.');
  const row = offer as Row;
  if (row.sales_channel === 'seller_portal') fail('Ofertę z portalu sprzedawcy zmienia się w obsłudze oferty sprzedawcy.');
  if (row.status === 'accepted') fail('Zaakceptowanej oferty nie można edytować.');
  return row;
}

export const audienceOf = (offer: Row): OfferAudience => ({
  guest_count: offer.guest_count ?? null, guests_per_table: offer.guests_per_table ?? 10, table_count: offer.table_count ?? null,
});

export const PRODUCT_SELECT = `id, name, description, offer_description, unit, base_price, quantity_source, pricing_addons, sales_packages,
  sales_packages_enabled, configuration_schema, offer_image_path, pdf_thumbnail_url, is_active,
  variants:offer_product_variants(id, name, short_description, description, price_net, is_recommended, is_active, display_order, quantity_source, offer_image_path),
  category:event_categories(name)`;

export const activeVariants = (product: Row) => ((product.variants || []) as Row[])
  .filter((variant) => variant.is_active !== false)
  .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
export const productPackages = (product: Row): ProductSalesPackage[] =>
  product.sales_packages_enabled && Array.isArray(product.sales_packages) ? product.sales_packages : [];

/** Pakiety i warianty do wyboru (Mac zmienia szkic według tych samych zasad co okna CRM). */
const variantView = (variant: Row) => ({
  id: String(variant.id), name: text(variant.name), priceNet: Number(variant.price_net) || 0, recommended: variant.is_recommended === true,
  quantitySource: (variant.quantity_source || 'manual') as QuantitySource,
});
const packageView = (option: ProductSalesPackage) => ({
  id: String(option.id), name: text(option.name), included: text(option.included_label), priceNet: Number(option.price_net) || 0,
  priceOnRequest: option.price_on_request === true, audiencePricing: Boolean(option.audience_pricing),
  includeProductAddons: option.include_product_addons === true,
  resourcesMissing: !Array.isArray(option.resources?.equipment) || !Array.isArray(option.resources?.staff),
});

// MARK: Szkic pozycji

export type Draft = {
  variantId: string | null;
  packageId: string;
  quantity: number;
  quantitySource: QuantitySource;
  days: number;
  unitPrice: number;
  discountPercent: number;
  addons: ProductAddon[];
  variantPrices: Record<string, number>;
  showVariants: boolean;
  showVariantPrices: boolean;
  name: string;
  vatRate: number | null;
  /** Konfiguracja produktu modułowego (scena, LED) — wtedy bez pakietów, wariantów i dodatków. */
  modular: ProductConfigurationSnapshot | null;
  /** Własna cena bazowa zamiast ceny z kalkulatora (`modular_price_source: 'manual'`). */
  modularManual: boolean;
  /** Pakiety zmienione w tej ofercie (cena, zakres, cena z liczby osób, sprzęt i obsada, koszty); `null` — bez zmian. */
  packageOptions: Row[] | null;
};

const num = (value: unknown) => (value === null || value === undefined || value === '' ? NaN : Number(value));

export function addonOf(raw: Row): ProductAddon {
  const addon: Row = {
    id: text(raw.id).slice(0, 80), name: text(raw.name).slice(0, 120), description: text(raw.description).slice(0, 500),
    kind: ['over_limit', 'quantity', 'optional'].includes(raw.kind) ? raw.kind : 'quantity', unit: text(raw.unit).slice(0, 20),
    included_quantity: num(raw.included_quantity), quantity: num(raw.quantity), unit_price: num(raw.unit_price), enabled: raw.enabled === true,
  };
  if (raw.price_on_request === true) addon.price_on_request = true;
  if (['manual', 'guests', 'tables'].includes(raw.quantity_source)) addon.quantity_source = raw.quantity_source;
  if (typeof raw.staff_role === 'string' && raw.staff_role.trim()) addon.staff_role = raw.staff_role;
  if (raw.staff_hours != null && raw.staff_hours !== '') addon.staff_hours = Number(raw.staff_hours);
  if (raw.max_quantity != null && raw.max_quantity !== '') addon.max_quantity = Number(raw.max_quantity);
  if (!Number.isFinite(addon.included_quantity)) addon.included_quantity = 0;
  return addon as ProductAddon;
}

export function draftOf(input: unknown): Draft {
  const raw = input && typeof input === 'object' ? input as Row : {};
  const prices: Record<string, number> = {};
  if (raw.variantPrices && typeof raw.variantPrices === 'object') {
    for (const [key, value] of Object.entries(raw.variantPrices as Row).slice(0, 100)) if (UUID.test(key)) prices[key] = num(value);
  }
  return {
    variantId: UUID.test(text(raw.variantId)) ? text(raw.variantId) : null,
    packageId: text(raw.packageId).slice(0, 80),
    quantity: num(raw.quantity),
    quantitySource: ['guests', 'tables'].includes(raw.quantitySource) ? raw.quantitySource : 'manual',
    days: num(raw.days),
    unitPrice: num(raw.unitPrice),
    discountPercent: num(raw.discountPercent ?? 0),
    addons: (Array.isArray(raw.addons) ? raw.addons : []).slice(0, 41).map((addon: Row) => addonOf(addon || {})),
    variantPrices: prices,
    showVariants: raw.showVariants !== false,
    showVariantPrices: raw.showVariantPrices !== false,
    name: text(raw.name).trim().slice(0, 300),
    vatRate: raw.vatRate == null || raw.vatRate === '' ? null : Number(raw.vatRate),
    modular: raw.modular && typeof raw.modular === 'object' ? modularSnapshotOf(raw.modular) : null,
    modularManual: raw.modularManual === true,
    packageOptions: Array.isArray(raw.packageOptions) ? (raw.packageOptions as unknown[]).slice(0, 3).filter((item) => item && typeof item === 'object') as Row[] : null,
  };
}

/**
 * Pakiety pozycji z poprawkami z tej oferty (jak `onChange` w `ProductPackagePicker` i edytory zasobów i kosztów w kreatorze):
 * z Maca przechodzą tylko cena, zakres, cena z liczby osób, sprzęt i obsada oraz koszty — reszta pakietu zostaje zapisana.
 */
export function optionsFor(draft: Draft, options: ProductSalesPackage[]): ProductSalesPackage[] {
  if (!draft.packageOptions) return options;
  const edits = new Map(draft.packageOptions.map((item) => [text(item.id), item]));
  return options.map((option) => {
    const edit = edits.get(String(option.id));
    if (!edit) return option;
    const next: Row = { ...option };
    if (edit.price_net !== undefined) next.price_net = num(edit.price_net);
    if (typeof edit.included_label === 'string') next.included_label = edit.included_label.slice(0, 95);
    if (edit.audience_pricing !== undefined) next.audience_pricing = edit.audience_pricing && typeof edit.audience_pricing === 'object' ? edit.audience_pricing : null;
    if (edit.resources !== undefined) next.resources = edit.resources && typeof edit.resources === 'object' ? edit.resources : null;
    if (edit.cost_items !== undefined) next.cost_items = Array.isArray(edit.cost_items) ? edit.cost_items : null;
    return next as ProductSalesPackage;
  });
}

/** Sprzęt i obsada pakietów z karty produktu (`Pobierz sprzęt i obsadę z produktu` w oknie edycji pozycji). */
const catalogResources = (product: Row) => Object.fromEntries(productPackages(product)
  .filter((option) => Array.isArray(option.resources?.equipment) && Array.isArray(option.resources?.staff))
  .map((option) => [String(option.id), option.resources]));

/** Wycena szkicu (jak `rawConfiguration` → `resolveAudienceConfiguration` → `configurationPrice` w oknach CRM). */
export function evaluate(draft: Draft, options: ProductSalesPackage[], audience: OfferAudience) {
  if (draft.modular) {
    // Produkt modułowy: cena z kalkulatora albo własna, ilość ręczna (jak `rawConfiguration` przy `modular` w oknach CRM).
    const configuration = createModularConfiguration(draft.modular, draft.modularManual ? draft.unitPrice : undefined);
    return {
      selectedPackage: undefined as ProductSalesPackage | undefined,
      configuration,
      quantity: draft.quantity,
      price: configurationPrice(configuration),
      audienceRequired: false,
      audienceError: null as string | null,
    };
  }
  const selectedPackage = options.find((option) => option.id === draft.packageId);
  const raw: OfferConfiguration = {
    ...createConfiguration(draft.unitPrice, draft.addons,
      selectedPackage ? pricedPackageSelection({ selected_id: selectedPackage.id, options }, draft.unitPrice) : undefined),
    quantity_source: selectedPackage ? 'manual' : draft.quantitySource,
  };
  const resolved = resolveAudienceConfiguration(raw, audience, draft.quantity);
  const configuration = resolved.configuration;
  const quantity = resolved.quantity;
  const audienceRequired = Boolean(selectedPackage?.audience_pricing) || raw.quantity_source !== 'manual'
    || draft.addons.some((addon) => addon.quantity_source && addon.quantity_source !== 'manual');
  const audienceError = resolved.error ? 'Uzupełnij i zapisz dane w sekcji Uczestnicy oferty powyżej.' : null;
  const price = configurationPrice(configuration);
  return { selectedPackage, configuration, quantity, price, audienceRequired, audienceError };
}

/** Sprawdzenia przed zapisem jak `handleAddItem` / `handleSave` w CRM. */
export function problem(draft: Draft, result: ReturnType<typeof evaluate>) {
  if (result.audienceError) return result.audienceError;
  if (!Number.isInteger(draft.days) || draft.days < 1 || draft.days > 3650) return 'Podaj liczbę dni od 1 do 3650.';
  if (!Number.isFinite(result.quantity) || result.quantity <= 0) return 'Ilość musi być większa od 0';
  const basePrice = draft.modular ? result.configuration.base_unit_price : draft.unitPrice;
  if (!Number.isFinite(basePrice) || basePrice < 0) return 'Cena nie może być ujemna';
  if (!Number.isFinite(draft.discountPercent) || draft.discountPercent < 0 || draft.discountPercent > 100) return 'Rabat musi być w zakresie 0–100%';
  if (Object.values(draft.variantPrices).some((price) => !Number.isFinite(price) || price < 0 || price > 999999999.99)) {
    return 'Podaj poprawne, nieujemne ceny wszystkich wariantów.';
  }
  return validateConfiguration(result.configuration);
}

function summary(draft: Draft, result: ReturnType<typeof evaluate>, audience: OfferAudience, vatRate: number, recommendation = false) {
  const quantity = Number.isFinite(result.quantity) ? result.quantity : 0;
  const days = Number.isFinite(draft.days) ? draft.days : 0;
  const discount = Number.isFinite(draft.discountPercent) ? draft.discountPercent : 0;
  const subtotal = quantity * days * result.price;
  // Propozycja dodatkowa: rabat wliczony w cenę jednostkową (jak `total` w `AddOfferItemModal` z `onAddRecommendation`).
  const total = recommendation
    ? Math.round(quantity * days * (Math.round(result.price * (1 - discount / 100) * 100) / 100) * 100) / 100
    : Math.round((subtotal - Math.round(subtotal * discount) / 100) * 100) / 100;
  const vat = Math.round(total * vatRate) / 100;
  const guests = Number(audience.guest_count) || 0;
  return {
    quantity,
    unitPrice: result.configuration.base_unit_price,
    configuredPrice: result.price,
    subtotal: money(subtotal),
    discountAmount: money(subtotal - total),
    total,
    vat,
    gross: money(total + vat),
    audienceRequired: result.audienceRequired,
    needsTables: configurationNeedsTables(result.configuration),
    audienceNote: guests
      ? `Oferta dla ${guests} osób${configurationNeedsTables(result.configuration) ? ` · stoły: ${audience.table_count ?? Math.ceil(guests / (audience.guests_per_table || 10))}` : ''}`
      : null,
    packageAudiencePricing: Boolean(result.selectedPackage?.audience_pricing),
    packageResourcesMissing: Boolean(result.selectedPackage)
      && (!Array.isArray(result.selectedPackage?.resources?.equipment) || !Array.isArray(result.selectedPackage?.resources?.staff)),
    error: problem(draft, result),
  };
}

export const unitOf = (draft: Draft, selectedPackage: ProductSalesPackage | undefined, fallback: string) =>
  draft.modular ? 'zestaw' : selectedPackage ? 'pakiet' : draft.quantitySource === 'guests' ? 'osoba' : draft.quantitySource === 'tables' ? 'stół' : fallback;

/** Nazwa i opis pozycji z konfiguracji (`modularTitle`, `modularScope`, jak okna CRM). */
export const modularText = (modular: ProductConfigurationSnapshot) => ({ name: modularTitle(modular), description: modularScope(modular).join('\n') });

// MARK: Katalog do dodawania

/** Szkic początkowy po wyborze produktu (jak `useEffect([selectedProduct])` w `AddOfferItemModal`, także z propozycji). */
export function initialDraft(product: Row, proposal: Row | undefined) {
  const variants = activeVariants(product);
  const config = proposal?.pricing_configuration as Row | undefined;
  if (product.configuration_schema) {
    // Produkt modułowy: zapisana konfiguracja z propozycji albo — bez niej — Mac pobiera nową (`op=modular`).
    const saved = config?.modular as Row | undefined;
    return {
      draft: {
        variantId: null, packageId: '', quantity: Number(proposal?.quantity) || 1, quantitySource: 'manual',
        days: Number(proposal?.days ?? 1) || 1, unitPrice: saved ? Number(config?.base_unit_price) || 0 : 0,
        discountPercent: Number(proposal?.discount_percent || 0), addons: [], variantPrices: {}, showVariants: false,
        showVariantPrices: false, modular: saved || null, modularManual: Boolean(saved) && config?.modular_price_source === 'manual',
      } as Row,
      packages: [] as ProductSalesPackage[],
    };
  }
  const defaultVariant = proposal ? variants.find((variant) => variant.id === proposal.product_variant_id) : variants.find((variant) => variant.is_recommended) || variants[0];
  const copied = config?.product_package as Row | undefined;
  const options: ProductSalesPackage[] = copied?.options || productPackages(product);
  const pkg = copied ? options.find((option) => option.id === copied.selected_id) : proposal ? undefined : options[0];
  const draft: Row = {
    variantId: defaultVariant?.id || null,
    packageId: '',
    quantity: Number(proposal?.quantity) || 1,
    quantitySource: config?.quantity_source || defaultVariant?.quantity_source || product.quantity_source || 'manual',
    days: Number(proposal?.days ?? 1) || 1,
    unitPrice: proposal ? Number(config?.base_unit_price ?? proposal.unit_price) || 0 : defaultVariant ? Number(defaultVariant.price_net) || 0 : Number(product.base_price) || 0,
    discountPercent: config ? Number(proposal?.discount_percent || 0) : 0,
    addons: ((proposal ? config?.addons || [] : product.pricing_addons || []) as Row[]).map((addon) => ({ ...addon })),
    variantPrices: {},
    showVariants: true,
    showVariantPrices: true,
  };
  if (pkg) {
    draft.variantId = null;
    draft.packageId = pkg.id;
    draft.addons = config?.addons || (pkg.include_product_addons ? structuredClone(product.pricing_addons || []) : []);
    draft.unitPrice = config?.base_unit_price ?? pkg.price_net;
    draft.showVariantPrices = false;
  }
  return { draft, packages: options };
}

/**
 * Katalog do dodawania pozycji albo — `exclude !== null` — propozycji dodatkowych: bez produktów z głównej oferty, zapisanych
 * propozycji i propozycji dodanych w tej edycji (`exclude`), szkic bez danych propozycji (jak `onAddRecommendation`).
 */
export async function offerItemCatalog(ctx: NativeContext, id: string, exclude: string[] | null = null) {
  const key = uuid(id);
  const offer = await editable(ctx, key);
  const [items, products] = await Promise.all([
    ctx.supabase.from('offer_items').select('product_id').eq('offer_id', key),
    ctx.supabase.from('offer_products').select(PRODUCT_SELECT).eq('is_active', true).order('name'),
  ]);
  if (items.error || products.error) fail('Błąd podczas ładowania produktów');
  const proposals = (Array.isArray(offer.recommended_items) ? offer.recommended_items : []) as Row[];
  const rows = (products.data || []) as Row[];
  const paths = Array.from(new Set(rows.map((row) => row.pdf_thumbnail_url || row.offer_image_path).filter((path) => path && !/^https?:\/\//i.test(path))));
  const urls = new Map<string, string>();
  if (paths.length) {
    const { data } = await ctx.supabase.storage.from('offer-product-pages').createSignedUrls(paths, 3600);
    (data || []).forEach((item: Row) => { if (item?.path && item?.signedUrl) urls.set(String(item.path), String(item.signedUrl)); });
  }
  const used = new Set(((items.data || []) as Row[]).map((row) => row.product_id).filter(Boolean));
  if (exclude) [...exclude, ...proposals.map((item) => item.product_id)].forEach((productId) => used.add(productId));
  return {
    audience: audienceOf(offer),
    vatRate: Number(offer.tax_percent ?? 23),
    products: rows.filter((row) => !used.has(row.id)).map((row) => {
      const proposal = exclude ? undefined : proposals.find((item) => item.product_id === row.id);
      const start = initialDraft(row, proposal);
      const image = row.pdf_thumbnail_url || row.offer_image_path || null;
      return {
        id: String(row.id),
        name: text(row.name),
        packageOptions: start.packages,
        description: text(row.offer_description || row.description),
        category: text(row.category?.name) || null,
        unit: text(row.unit) || 'szt.',
        basePrice: Number(row.base_price) || 0,
        imagePath: image,
        imageUrl: image ? (/^https?:\/\//i.test(image) ? image : urls.get(image) || null) : null,
        modular: Boolean(row.configuration_schema),
        quantitySource: (row.quantity_source || 'manual') as QuantitySource,
        variants: activeVariants(row).map(variantView),
        packages: start.packages.map(packageView),
        productAddons: (row.pricing_addons || []) as ProductAddon[],
        proposal: proposal ? text(proposal.name) || text(row.name) : null,
        initial: start.draft,
      };
    }),
  };
}

// MARK: Edycja pozycji

const ITEM_SELECT = `id, offer_id, product_id, name, description, quantity, days, unit, unit_price, discount_percent, product_variant_id,
  pricing_configuration, variant_prices_net, show_variant_prices_in_pdf, show_product_variants_in_pdf, product:offer_products(${PRODUCT_SELECT})`;

async function offerItem(ctx: NativeContext, offer: string, itemId: unknown) {
  const id = uuid(itemId, 'Nieprawidłowa pozycja oferty.');
  const { data, error } = await ctx.supabase.from('offer_items').select(ITEM_SELECT).eq('id', id).maybeSingle();
  if (error || !data || (data as Row).offer_id !== offer) fail('Nie znaleziono pozycji oferty.');
  return data as Row;
}

const itemPackages = (item: Row): ProductSalesPackage[] =>
  item.pricing_configuration?.product_package?.options || (item.product ? productPackages(item.product) : []);

export async function offerItemEditor(ctx: NativeContext, id: string, itemId: string) {
  const key = uuid(id);
  const offer = await editable(ctx, key);
  const item = await offerItem(ctx, key, itemId);
  const config = (item.pricing_configuration || null) as Row | null;
  const product = (item.product || {}) as Row;
  const packages = itemPackages(item);
  const variantPrices: Record<string, number> = { ...(item.variant_prices_net || {}) };
  if (item.product_variant_id) variantPrices[item.product_variant_id] = Number(config?.base_unit_price ?? item.unit_price ?? 0);
  return {
    id: String(item.id),
    productId: item.product_id || null,
    productName: text(product.name) || null,
    productDescription: text(item.description || product.description) || null,
    productUnit: text(product.unit || item.unit) || 'szt.',
    modular: Boolean(config?.modular),
    audience: audienceOf(offer),
    vatRate: Number(offer.tax_percent ?? 23),
    variants: activeVariants(product).map(variantView),
    packages: packages.map(packageView),
    packageOptions: packages,
    catalogResources: catalogResources(product),
    productAddons: (product.pricing_addons || []) as ProductAddon[],
    productQuantitySource: (product.quantity_source || 'manual') as QuantitySource,
    productBasePrice: Number(product.base_price) || 0,
    canLoadProductAddons: !config && Boolean(product.pricing_addons?.length),
    // „Przejdź na konfigurator — przelicz tę pozycję”: wcześniejsza wycena produktu, który ma teraz konfigurator.
    canUseConfigurator: !config?.modular && Boolean(product.configuration_schema),
    allowIndividual: !packages.every((option) => option.price_on_request),
    draft: {
      variantId: item.product_variant_id || null,
      packageId: config?.product_package?.selected_id || '',
      quantity: Number(item.quantity) || 1,
      quantitySource: config?.quantity_source || 'manual',
      days: Number(item.days ?? 1) || 1,
      unitPrice: Number(config?.base_unit_price ?? item.unit_price ?? 0),
      discountPercent: Number(item.discount_percent ?? 0),
      addons: ((config?.addons || []) as Row[]).map((addon) => ({ ...addon })),
      variantPrices,
      showVariants: item.show_product_variants_in_pdf !== false,
      showVariantPrices: item.show_variant_prices_in_pdf !== false,
      name: text(item.name || product.name),
      vatRate: Number(offer.tax_percent ?? 23),
      modular: config?.modular || null,
      modularManual: Boolean(config?.modular) && config?.modular_price_source === 'manual',
    },
  };
}

// MARK: Podgląd, dodanie, zapis

/** Podgląd wyceny szkicu: dodawanie (`productId`) albo edycja (`itemId`). */
export async function previewOfferItem(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id);
  const draft = draftOf(body.draft);
  const audience = audienceOf(offer);
  let options: ProductSalesPackage[];
  if (body.itemId) {
    options = itemPackages(await offerItem(ctx, id, body.itemId));
  } else {
    const productId = uuid(body.productId, 'Wybierz produkt');
    const { data: product } = await ctx.supabase.from('offer_products').select(PRODUCT_SELECT).eq('id', productId).maybeSingle();
    if (!product) fail('Wybierz produkt');
    const proposal = ((offer.recommended_items || []) as Row[]).find((item) => item.product_id === productId);
    options = proposal?.pricing_configuration?.product_package?.options || productPackages(product as Row);
  }
  const vatRate = draft.vatRate != null && VAT_RATES.includes(draft.vatRate) ? draft.vatRate : Number(offer.tax_percent ?? 23);
  return summary(draft, evaluate(draft, optionsFor(draft, options), audience), audience, vatRate, body.recommendation === true);
}

export async function addOfferItem(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id);
  const productId = uuid(body.productId, 'Wybierz produkt');
  const { data: productRow } = await ctx.supabase.from('offer_products').select(PRODUCT_SELECT).eq('id', productId).maybeSingle();
  const product = productRow as Row | null;
  if (!product || product.is_active === false) fail('Wybierz produkt');
  const draft = draftOf(body.draft);
  if (product.configuration_schema && !draft.modular) fail('Skonfiguruj produkt przed dodaniem do oferty.');
  if (!product.configuration_schema && draft.modular) fail('Ten produkt nie ma konfiguratora.');
  const { data: existing } = await ctx.supabase.from('offer_items').select('id').eq('offer_id', id).eq('product_id', productId).limit(1);
  if (existing?.length) fail('Ten produkt jest już dodany. Wybierz inną pozycję.');
  const recommendations = (Array.isArray(offer.recommended_items) ? offer.recommended_items : []) as Row[];
  const proposal = recommendations.find((item) => item.product_id === productId);
  if (proposal && body.moveRecommendation !== true) fail(`„${product.name}” jest już w propozycjach dodatkowych. Potwierdź przeniesienie do głównej listy.`);
  const audience = audienceOf(offer);
  const options: ProductSalesPackage[] = optionsFor(draft, proposal?.pricing_configuration?.product_package?.options || productPackages(product));
  const result = evaluate(draft, options, audience);
  const error = problem(draft, result);
  if (error) fail(error);
  const variant = activeVariants(product).find((row) => row.id === draft.variantId) || null;
  if (draft.variantId && !variant) fail('Wybierz wariant produktu.');
  const selectedPackage = result.selectedPackage;
  const sameProposal = proposal && proposal.product_variant_id === (variant?.id || null);
  const modular = draft.modular ? modularText(draft.modular) : null;
  const item = {
    offer_id: id,
    product_id: productId,
    product_variant_id: variant?.id || null,
    variant_prices_net: { ...draft.variantPrices, ...(variant ? { [variant.id]: draft.unitPrice } : {}) },
    show_variant_prices_in_pdf: modular ? false : draft.showVariantPrices,
    show_product_variants_in_pdf: modular ? false : draft.showVariants,
    name: modular ? modular.name : selectedPackage ? `${product.name} — ${selectedPackage.name}` : sameProposal ? proposal!.name
      : variant ? `${product.name} — ${variant.name}` : product.name,
    description: modular ? modular.description : selectedPackage ? [selectedPackage.included_label, selectedPackage.bonus].filter(Boolean).join('. ')
      : sameProposal ? proposal!.description : variant?.description || variant?.short_description || product.description,
    quantity: result.quantity,
    days: draft.days,
    unit: unitOf(draft, selectedPackage, text(product.unit)),
    unit_price: result.price,
    pricing_configuration: result.configuration,
    unit_cost: 0,
    discount_percent: draft.discountPercent,
    discount_amount: Math.round(result.quantity * draft.days * result.price * draft.discountPercent) / 100,
    transport_cost: 0,
    logistics_cost: 0,
    display_order: 999,
    notes: null,
  };
  const { error: saveError } = await ctx.supabase.rpc('add_offer_item_without_duplicate', {
    p_offer_id: id, p_move_recommendation: Boolean(proposal), p_expected_recommendations: offer.recommended_items, p_item: item,
  });
  if (saveError) fail(saveError.message || 'Błąd podczas dodawania pozycji');
  return offerDetail(ctx, id);
}

export async function updateOfferItem(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id);
  const item = await offerItem(ctx, id, body.itemId);
  const draft = draftOf(body.draft);
  if (!draft.name) fail('Nazwa pozycji nie może być pusta');
  // Pozycja z konfiguratorem zostaje przy konfiguratorze; inną można świadomie przełączyć, gdy produkt go ma.
  if (item.pricing_configuration?.modular && !draft.modular) fail('Brakuje konfiguracji produktu. Otwórz pozycję ponownie.');
  if (draft.modular && !item.pricing_configuration?.modular && !item.product?.configuration_schema) fail('Ten produkt nie ma konfiguratora.');
  const audience = audienceOf(offer);
  const result = evaluate(draft, optionsFor(draft, itemPackages(item)), audience);
  const error = problem(draft, result);
  if (error) fail(error);
  const variants = activeVariants(item.product || {});
  if (draft.variantId && !variants.some((variant) => variant.id === draft.variantId)) fail('Wybierz wariant produktu.');
  const selectedPackage = result.selectedPackage;
  const quantity = result.quantity;
  const discountAmount = (quantity * draft.days * result.price * draft.discountPercent) / 100;
  const patch: Row = {
    name: draft.name,
    ...(draft.modular ? { description: modularText(draft.modular).description } : {}),
    ...(selectedPackage ? { description: [selectedPackage.included_label, selectedPackage.bonus].filter(Boolean).join('. ') } : {}),
    quantity,
    days: draft.days,
    unit: unitOf(draft, selectedPackage, text(item.product?.unit || item.unit)),
    unit_price: result.price,
    pricing_configuration: result.configuration,
    discount_amount: money(discountAmount),
    discount_percent: draft.discountPercent,
    product_variant_id: draft.variantId,
    variant_prices_net: { ...draft.variantPrices, ...(draft.variantId ? { [draft.variantId]: draft.unitPrice } : {}) },
    show_variant_prices_in_pdf: draft.showVariantPrices,
    show_product_variants_in_pdf: draft.showVariants,
  };
  const { data, error: saveError } = await ctx.supabase.from('offer_items').update(patch).eq('id', item.id).select('id').maybeSingle();
  if (saveError) fail(saveError.message || 'Błąd podczas aktualizacji pozycji');
  if (!data) fail('Nie masz uprawnień do zmiany tej pozycji.');
  // Stawka VAT jest wspólna dla oferty (jak w oknie edycji pozycji w CRM).
  if (draft.vatRate != null && VAT_RATES.includes(draft.vatRate) && draft.vatRate !== Number(offer.tax_percent ?? 23)) {
    await ctx.supabase.from('offers').update({ tax_percent: draft.vatRate }).eq('id', id);
  }
  return offerDetail(ctx, id);
}

/** „Zapisz liczbę osób i przelicz” (`useOfferAudience.saveAudience`): zapis tylko, gdy nikt w międzyczasie nie zmienił danych. */
export async function saveOfferAudience(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id);
  const guests = body.guestCount == null || body.guestCount === '' ? null : Number(body.guestCount);
  const capacity = Number(body.guestsPerTable ?? 10);
  const tables = body.tableCount == null || body.tableCount === '' ? null : Number(body.tableCount);
  if ((guests != null && (!Number.isInteger(guests) || guests < 1 || guests > 100000)) || !Number.isInteger(capacity) || capacity < 1 || capacity > 100
    || (tables != null && (!Number.isInteger(tables) || tables < 1 || tables > 100000))) {
    fail('Podaj całkowitą liczbę osób i stołów oraz od 1 do 100 osób przy stole.');
  }
  const expected = body.expected && typeof body.expected === 'object' ? body.expected as Row : audienceOf(offer);
  let query = ctx.supabase.from('offers').update({ guest_count: guests, guests_per_table: capacity, table_count: tables }).eq('id', id);
  query = expected.guest_count == null ? query.is('guest_count', null) : query.eq('guest_count', expected.guest_count);
  query = expected.table_count == null ? query.is('table_count', null) : query.eq('table_count', expected.table_count);
  query = query.eq('guests_per_table', expected.guests_per_table ?? 10);
  const { data, error } = await query.select('guest_count, guests_per_table, table_count').maybeSingle();
  if (error) fail(error.message);
  if (!data) fail('Dane uczestników zmieniły się w innym oknie. Wczytuję aktualne wartości; wpisz zmianę ponownie.');
  return { audience: data };
}
