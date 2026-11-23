import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Strona „Cennik” w broszurze (oferta weselna, etap 3): broszura to wszystkie pozycje, które możemy zaproponować, więc jej
 * cennik obejmuje każdą widoczną stronę usługi z ceną z wybranego cennika sezonowego (`sales_brochures.price_list_id`,
 * migracja 20261129130000). Pozycja bez ceny w cenniku — cena z katalogu (jak w ofertach); produkt z wariantami — warianty
 * w jednym wierszu („2 szt. 500 zł · 4 szt. 800 zł”); konfigurator albo cena 0 — „wycena indywidualna”.
 * Wspólne dla generatora PDF, podglądu w CRM i podglądu Maca (serwer). Ceny netto z cennika — bez dopisków (jak w broszurze
 * Event Rulers); kwota jest kwotą z cennika.
 */

export type BrochurePriceOption = { label: string; price: number | null };
export type BrochurePriceRow = { id: string; title: string; options: BrochurePriceOption[] };
export type BrochurePriceListSnapshot = { name: string; season: string; rows: BrochurePriceRow[] };

/** Strona usługi broszury: identyfikator, tytuł ze strony (z personalizacją) i produkt / wariant katalogu. */
export type BrochurePriceItem = { id: string; title: string; productId: string; variantId: string | null };

type Product = {
  id: string;
  base_price: number | null;
  configuration_schema?: unknown;
  variants?: Array<{ id: string; name: string; price_net: number | null; is_active?: boolean | null; display_order?: number | null }> | null;
};
type Entry = { product_id: string; product_variant_id: string | null; price_net: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** „sezon 2027” dla pełnego roku, inaczej „01.05.2027 – 30.09.2027”. */
export function brochureSeasonLabel(from: string, to: string) {
  const date = (value: string) => {
    const [year, month, day] = String(value || '').slice(0, 10).split('-');
    return year && month && day ? `${day}.${month}.${year}` : String(value || '');
  };
  const year = String(from || '').slice(0, 4);
  if (/^\d{4}-01-01/.test(from) && String(to || '').startsWith(`${year}-12-31`)) return `sezon ${year}`;
  return `${date(from)} – ${date(to)}`;
}

/** Wiersze cennika w kolejności stron broszury. */
export function brochurePriceRows(items: BrochurePriceItem[], products: Product[], entries: Entry[]): BrochurePriceRow[] {
  const byProduct = new Map(products.map((product) => [product.id, product]));
  const prices = new Map(entries.map((entry) => [`${entry.product_id}:${entry.product_variant_id || ''}`, Number(entry.price_net)]));
  const priced = (value: number | null | undefined) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.round(Number(value) * 100) / 100 : null);
  const rows: BrochurePriceRow[] = [];
  for (const item of items) {
    const product = byProduct.get(item.productId);
    if (!product) continue;
    if (product.configuration_schema) {
      rows.push({ id: item.id, title: item.title, options: [{ label: '', price: null }] });
      continue;
    }
    const variants = (product.variants || [])
      .filter((variant) => variant.is_active !== false)
      .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
    const variantPrice = (variant: { id: string; price_net: number | null }) =>
      priced(prices.get(`${product.id}:${variant.id}`) ?? variant.price_net);
    if (item.variantId) {
      const variant = (product.variants || []).find((candidate) => candidate.id === item.variantId);
      rows.push({ id: item.id, title: item.title, options: [{ label: '', price: variant ? variantPrice(variant) : null }] });
    } else if (variants.length) {
      rows.push({ id: item.id, title: item.title, options: variants.map((variant) => ({ label: variant.name, price: variantPrice(variant) })) });
    } else {
      rows.push({ id: item.id, title: item.title, options: [{ label: '', price: priced(prices.get(`${product.id}:`) ?? product.base_price) }] });
    }
  }
  return rows;
}

/** Cennik broszury z bazy (klient pracownika w CRM, serwisowy w generatorze); bez cennika albo bez dostępu — `null`. */
export async function loadBrochurePriceList(
  client: SupabaseClient,
  priceListId: string | null | undefined,
  items: BrochurePriceItem[],
): Promise<BrochurePriceListSnapshot | null> {
  if (!priceListId || !UUID.test(priceListId) || !items.length) return null;
  const productIds = Array.from(new Set(items.map((item) => item.productId).filter((id) => UUID.test(id))));
  const [list, entries, products] = await Promise.all([
    client.from('price_lists').select('id, name, season_from, season_to').eq('id', priceListId).maybeSingle(),
    client.from('price_list_entries').select('product_id, product_variant_id, price_net').eq('price_list_id', priceListId).in('product_id', productIds),
    client.from('offer_products')
      .select('id, base_price, configuration_schema, variants:offer_product_variants(id, name, price_net, is_active, display_order)')
      .in('id', productIds),
  ]);
  if (list.error || !list.data || entries.error || products.error) return null;
  const row = list.data as { name: string; season_from: string; season_to: string };
  return {
    name: String(row.name || ''),
    season: brochureSeasonLabel(String(row.season_from), String(row.season_to)),
    rows: brochurePriceRows(items, (products.data || []) as Product[], (entries.data || []) as Entry[]),
  };
}

/** Wiersze na stronach A4 (stała wysokość strony — bez wychodzenia treści poza stronę): wiersz z wariantami zajmuje więcej. */
export function brochurePricePages(priceList: BrochurePriceListSnapshot | null | undefined): BrochurePriceRow[][] {
  if (!priceList?.rows.length) return [];
  const pages: BrochurePriceRow[][] = [];
  let page: BrochurePriceRow[] = [];
  let used = 0;
  const capacity = 18;
  for (const row of priceList.rows) {
    // Wiersze tekstu: nazwa do 2 (dłuższa jest ucinana), warianty — co najmniej 2 w wierszu; jednostka ≈ 9,6 mm z marginesem.
    const lines = Math.min(4, Math.max(row.title.length > 40 ? 2 : 1, Math.ceil(row.options.length / 2)));
    const cost = 0.6 + 0.45 * lines;
    if (page.length && used + cost > capacity) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(row);
    used += cost;
  }
  if (page.length) pages.push(page);
  return pages;
}

/** Kwota jak w broszurze Event Rulers: grupy tysięcy, bez groszy przy pełnej kwocie. */
export function brochurePrice(value: number | null) {
  if (value === null) return 'wycena indywidualna';
  const rounded = Math.round(value * 100) / 100;
  const [whole, fraction] = rounded.toFixed(Number.isInteger(rounded) ? 0 : 2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction ? `,${fraction}` : ''} zł`;
}
