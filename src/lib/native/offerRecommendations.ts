import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { fail } from './offers';
import { configurationPrice, createConfiguration, createModularConfiguration, validateConfiguration } from '@/lib/CRM/Offers/offerAddons';
import { modularSnapshotOf } from './modularConfigurator';
import {
  activeVariants,
  addonOf,
  audienceOf,
  draftOf,
  editable,
  evaluate,
  modularText,
  optionsFor,
  problem,
  PRODUCT_SELECT,
  productPackages,
  unitOf,
} from './offerItems';

/*
 * Oferty na Macu, część C2 — „Zobacz, co warto dobrać do takiego wydarzenia” (`OfferRecommendationsEditor`): propozycje
 * dodatkowe poza wyceną i rezerwacją. Odczyt listy (bez produktów, które trafiły do głównej oferty), budowa nowej propozycji
 * z katalogu jak `onAddRecommendation` w `AddOfferItemModal`, podgląd i zapis zmian jak okno „Edytuj propozycję”, zapis całej
 * listy (kolejność, układ w PDF, usunięcia) przez `save_offer_recommendations` ze sprawdzeniem, że nikt w międzyczasie
 * nie zmienił propozycji. Propozycje z konfiguratorem (scena, LED): zmiana konfiguracji (`modular`), własna cena
 * (`basePrice`) albo powrót do ceny z kalkulatora (`modularManual: false`), jak w oknie edycji CRM.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (value: unknown, message = 'Nieprawidłowa oferta.') => {
  const id = String(value || '');
  if (!UUID.test(id)) fail(message);
  return id;
};
const text = (value: unknown) => (value == null ? '' : String(value));
const num = (value: unknown) => (value === null || value === undefined || value === '' ? NaN : Number(value));
const finite = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : fallback);
const LAYOUTS = ['compact', 'full_page', 'visual'];

const listOf = (value: unknown) => (Array.isArray(value) ? value : []) as Row[];
const hashOf = (value: unknown) => createHash('sha256').update(JSON.stringify(listOf(value))).digest('hex');

async function load(ctx: NativeContext, id: string, edit: boolean) {
  const [{ data: allowed }, { data: offer, error }] = await Promise.all([
    ctx.supabase.rpc('sales_can_manage_offer', { p_offer: id }),
    ctx.supabase.from('offers').select('id, status, sales_channel, tax_percent, recommended_items, offer_items(product_id)').eq('id', id).maybeSingle(),
  ]);
  if (error || !offer) fail('Nie znaleziono oferty.');
  const row = offer as Row;
  const canEdit = allowed === true && row.status !== 'accepted' && row.sales_channel !== 'seller_portal';
  if (edit && !canEdit) {
    if (row.status === 'accepted') fail('Zaakceptowanej oferty nie można edytować.');
    if (row.sales_channel === 'seller_portal') fail('Ofertę z portalu sprzedawcy zmienia się w obsłudze oferty sprzedawcy.');
    fail('Nie masz uprawnień do zmiany tej oferty.');
  }
  const main = new Set(listOf(row.offer_items).map((item) => item.product_id).filter(Boolean));
  return { offer: row, canEdit, main };
}

async function signed(ctx: NativeContext, items: Row[]) {
  const paths = Array.from(new Set(items.map((item) => item.image_path).filter((path) => path && !/^https?:\/\//i.test(path))));
  const urls = new Map<string, string>();
  if (!paths.length) return urls;
  const { data } = await ctx.supabase.storage.from('offer-product-pages').createSignedUrls(paths, 3600);
  (data || []).forEach((image: Row) => { if (image?.path && image?.signedUrl && !image.error) urls.set(String(image.path), String(image.signedUrl)); });
  return urls;
}

/** Propozycja do wyświetlenia: zapisane dane bez zmian (`raw`) i to, czego Mac potrzebuje do edycji. */
function view(item: Row, urls: Map<string, string>) {
  const config = item.pricing_configuration as Row | undefined;
  const image = text(item.image_path);
  return {
    raw: item,
    imageUrl: image ? (/^https?:\/\//i.test(image) ? image : urls.get(image) || null) : null,
    modular: Boolean(config?.modular),
    modularManual: Boolean(config?.modular) && config?.modular_price_source === 'manual',
    configured: Boolean(config),
    basePrice: finite(config?.base_unit_price ?? item.unit_price),
    addons: config && !config.modular ? listOf(config.addons).map((addon) => {
      const normalized = addonOf(addon || {}) as Row;
      for (const key of ['included_quantity', 'quantity', 'unit_price']) normalized[key] = finite(normalized[key]);
      return normalized;
    }) : [],
  };
}

export async function offerRecommendations(ctx: NativeContext, id: string) {
  const key = uuid(id);
  const { offer, canEdit, main } = await load(ctx, key, false);
  // Produkt przeniesiony do głównej oferty znika z listy (jak filtr w `OfferRecommendationsEditor`).
  const items = listOf(offer.recommended_items).filter((item) => !main.has(item.product_id));
  const urls = await signed(ctx, items);
  return { canEdit, vatRate: Number(offer.tax_percent ?? 23), hash: hashOf(offer.recommended_items), items: items.map((item) => view(item, urls)) };
}

// MARK: Edycja jednej propozycji

/** Zmiany z okna „Edytuj propozycję” (jak `updateDraft`); cena po rabacie liczona z konfiguracji. */
function applyPatch(item: Row, patch: Row) {
  const next: Row = { ...item };
  const has = (key: string) => Object.prototype.hasOwnProperty.call(patch, key);
  if (has('name')) next.name = text(patch.name).slice(0, 160);
  if (has('description')) {
    next.description = text(patch.description).slice(0, 5000);
    next.description_override = true;
  }
  if (has('days')) next.days = num(patch.days);
  if (has('quantity')) next.quantity = num(patch.quantity);
  const config = next.pricing_configuration as Row | undefined;
  if (config?.modular) {
    // Konfigurator: zmiana zestawu przepisuje nazwę i opis (`modularTitle`, `modularScope`); cena z kalkulatora albo własna.
    if (has('addons')) fail('Konfigurator produktu nie może być łączony z dodatkami.');
    const modular = has('modular') ? modularSnapshotOf(patch.modular) : config.modular;
    const manual = has('modularManual') ? patch.modularManual === true : has('basePrice') || config.modular_price_source === 'manual';
    const price = has('basePrice') ? num(patch.basePrice) : num(config.base_unit_price);
    next.pricing_configuration = createModularConfiguration(modular, manual ? price : undefined);
    if (has('modular')) {
      const described = modularText(modular);
      next.name = described.name;
      next.description = described.description;
      next.description_override = true;
    }
  } else if (has('basePrice') || has('addons')) {
    if (config) {
      const base = has('basePrice') ? num(patch.basePrice) : num(config.base_unit_price);
      const addons = has('addons') ? listOf(patch.addons).slice(0, 41).map((addon) => addonOf(addon || {})) : listOf(config.addons);
      next.pricing_configuration = createConfiguration(base, addons as any, config.product_package);
    } else if (has('basePrice')) {
      next.unit_price = num(patch.basePrice);
    }
  }
  if (has('discountPercent') && config) next.discount_percent = num(patch.discountPercent);
  if (next.pricing_configuration) {
    next.unit_price = Math.round(configurationPrice(next.pricing_configuration) * (1 - (Number(next.discount_percent ?? 0)) / 100) * 100) / 100;
  }
  return next;
}

/** Sprawdzenia przed zapisem jak `persist` w `OfferRecommendationsEditor`. */
function problems(items: Row[], main: Set<string>) {
  if (items.some((item) => {
    const days = item.days ?? 1;
    return !text(item.name).trim() || !Number.isInteger(days) || days < 1 || days > 3650
      || !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unit_price) || item.unit_price < 0;
  })) return 'Uzupełnij nazwę, dodatnią ilość i cenę nie mniejszą niż zero.';
  for (const item of items) {
    if (!item.pricing_configuration) continue;
    const error = validateConfiguration(item.pricing_configuration);
    if (error) return `${item.name}: ${error}`;
    const discount = item.discount_percent ?? 0;
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) return 'Podaj rabat od 0 do 100%.';
  }
  const keys = items.map((item) => item.product_id);
  if (new Set(keys).size !== keys.length) return 'Ta sama pozycja występuje na liście propozycji więcej niż raz. Usuń powtórzenie.';
  if (items.some((item) => main.has(item.product_id))) {
    return 'Produkt z propozycji jest już w głównej ofercie. Usuń go z propozycji i odśwież ofertę, aby wczytać aktualny katalog.';
  }
  return null;
}

/** Podgląd w oknie „Edytuj propozycję”: propozycja po zmianach i ewentualny błąd zapisu. */
export async function previewOfferRecommendation(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const { main } = await load(ctx, id, true);
  const item = body.item && typeof body.item === 'object' ? body.item as Row : null;
  if (!item) fail('Nie znaleziono propozycji.');
  const next = applyPatch(item, body.patch && typeof body.patch === 'object' ? body.patch : {});
  const urls = await signed(ctx, [next]);
  return { item: view(next, urls), error: problems([next], main) };
}

/** Lista z Maca: obiekty propozycji bez zmian poza polami sprawdzanymi przy zapisie. */
function itemsOf(value: unknown) {
  return listOf(value).slice(0, 200).map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Nieprawidłowa lista proponowanych produktów.');
    const item: Row = { ...raw };
    item.id = text(item.id).slice(0, 80) || randomUUID();
    item.product_id = uuid(item.product_id, 'Nieprawidłowy produkt propozycji.');
    if (item.pdf_layout !== undefined && !LAYOUTS.includes(item.pdf_layout)) item.pdf_layout = 'compact';
    return item;
  });
}

/**
 * Zapis listy propozycji (kolejność, układ w PDF, usunięcia, nowe propozycje) i — opcjonalnie — zmian jednej propozycji
 * z okna edycji (`edit: { itemId, patch }`). `hash` — stan listy przy otwarciu edycji.
 */
export async function saveOfferRecommendations(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const { offer, main } = await load(ctx, id, true);
  if (text(body.hash) !== hashOf(offer.recommended_items)) fail('Propozycje zostały zmienione w innym oknie. Odśwież ofertę przed ponownym zapisem.');
  let next = itemsOf(body.items);
  const edit = body.edit && typeof body.edit === 'object' ? body.edit as Row : null;
  if (edit) {
    const target = text(edit.itemId);
    if (!next.some((item) => item.id === target)) fail('Nie znaleziono propozycji.');
    next = next.map((item) => (item.id === target ? applyPatch(item, edit.patch && typeof edit.patch === 'object' ? edit.patch : {}) : item));
  }
  const error = problems(next, main);
  if (error) fail(error);
  const { data, error: saveError } = await ctx.supabase.rpc('save_offer_recommendations', {
    p_offer_id: id, p_expected_recommendations: listOf(offer.recommended_items), p_recommendations: next,
  });
  if (saveError) fail(saveError.message || 'Nie udało się zapisać propozycji');
  if (!data || !Array.isArray((data as Row).recommended_items)) fail('Nie otrzymano potwierdzenia zapisu propozycji. Odśwież ofertę, aby sprawdzić zapisane dane.');
  return offerRecommendations(ctx, id);
}

// MARK: Nowa propozycja z katalogu

/**
 * „Dodaj propozycję” (`handleAddItem` z `onAddRecommendation`): ta sama wycena co pozycja oferty, rabat wliczony w cenę
 * jednostkową; propozycja trafia na listę w edycji i zapisuje się dopiero przyciskiem „Zapisz” w sekcji.
 */
export async function buildOfferRecommendation(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const offer = await editable(ctx, id);
  const productId = uuid(body.productId, 'Wybierz produkt');
  const { data: productRow } = await ctx.supabase.from('offer_products').select(PRODUCT_SELECT).eq('id', productId).maybeSingle();
  const product = productRow as Row | null;
  if (!product || product.is_active === false) fail('Wybierz produkt');
  const { data: main } = await ctx.supabase.from('offer_items').select('id').eq('offer_id', id).eq('product_id', productId).limit(1);
  if (main?.length) fail('Ten produkt jest już w głównej ofercie. Nie dodawaj go ponownie do propozycji.');
  const exclude = listOf(body.exclude).map(text);
  if (exclude.includes(productId) || listOf(offer.recommended_items).some((item) => item.product_id === productId)) {
    fail('Ten produkt jest już na liście propozycji.');
  }
  const draft = draftOf(body.draft);
  if (product.configuration_schema && !draft.modular) fail('Skonfiguruj produkt przed dodaniem propozycji.');
  if (!product.configuration_schema && draft.modular) fail('Ten produkt nie ma konfiguratora.');
  const result = evaluate(draft, optionsFor(draft, productPackages(product)), audienceOf(offer));
  const error = problem(draft, result);
  if (error) fail(error);
  const variant = activeVariants(product).find((row) => row.id === draft.variantId) || null;
  if (draft.variantId && !variant) fail('Wybierz wariant produktu.');
  const selectedPackage = result.selectedPackage as Row | undefined;
  const modular = draft.modular ? modularText(draft.modular) : null;
  const item: Row = {
    id: randomUUID(),
    product_id: productId,
    product_variant_id: variant?.id || null,
    name: modular ? modular.name : selectedPackage ? `${product.name} — ${selectedPackage.name}` : variant ? `${product.name} — ${variant.name}` : product.name,
    description: modular ? modular.description : product.offer_description || product.description || variant?.description || variant?.short_description || '',
    quantity: result.quantity,
    days: draft.days,
    unit: unitOf(draft, selectedPackage as any, text(product.unit)),
    unit_price: Math.round(result.price * (1 - draft.discountPercent / 100) * 100) / 100,
    pricing_configuration: result.configuration,
    discount_percent: draft.discountPercent,
    image_path: selectedPackage?.image_path || variant?.offer_image_path || product.offer_image_path || product.pdf_thumbnail_url || null,
  };
  return view(item, await signed(ctx, [item]));
}
