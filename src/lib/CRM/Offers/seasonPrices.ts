import type { SupabaseClient } from '@supabase/supabase-js';

/*
 * Cenniki sezonowe (migracja `20261129100000_season_price_lists.sql`).
 *
 * Cena zależy od roku eventu: marka realizująca ma cenniki z okresem sezonu, a oferta bierze cennik według marki
 * (oferta → event → domyślna marka kategorii eventu) i daty eventu. Cennik podpowiada ceny przy dodawaniu pozycji —
 * katalog produktów dostaje ceny sezonu (`applySeasonPrices`) w kreatorze oferty i w oknach pozycji (CRM, Mac przez
 * serwer). Zapisana pozycja trzyma swoją cenę (gwarancja ceny); oferta zapamiętuje cennik (`offers.price_list_id`),
 * a pozycja — ceny wariantów z cennika (`variant_prices_net`, `seasonVariantPrices`). Ceny istniejącej oferty zmienia
 * tylko świadome „Przelicz według cennika” (`apply_price_list_to_offer` — najpierw podgląd różnic).
 *
 * Bez migracji funkcja `offer_season_prices` nie istnieje — `loadSeasonPrices` zwraca wtedy `null` i wszystko działa
 * jak dotąd (ceny z katalogu).
 */

export type PriceListStatus = 'draft' | 'active' | 'archived';

export type PriceListSummary = {
  id: string;
  name: string;
  season_from: string;
  season_to: string;
  status: PriceListStatus;
  my_company_id: string;
  company_name: string | null;
  entry_count: number;
};

export type SeasonPriceEntry = { product_id: string; variant_id: string | null; price_net: number };

export type SeasonPrices = {
  context: {
    company_id: string | null;
    company_name: string | null;
    /** Data, według której wybrano sezon (YYYY-MM-DD, czas polski). */
    date: string;
    date_source: 'event' | 'offer' | 'today';
    sales_channel: string | null;
    offer_status: string | null;
  };
  /** `offer` — cennik zapamiętany w ofercie (gwarancja ceny); `season` — cennik sezonu dla marki i daty. */
  source: 'offer' | 'season' | null;
  price_list: PriceListSummary | null;
  /** Cennik sezonu, gdy różni się od zapamiętanego w ofercie (np. event przeniesiony na inny rok). */
  suggested: PriceListSummary | null;
  entries: SeasonPriceEntry[];
};

export type PriceListChange = {
  item_id: string;
  name: string;
  quantity: number;
  days: number;
  old_price: number;
  new_price: number;
  old_unit_price: number;
  new_unit_price: number;
  old_subtotal: number;
  new_subtotal: number;
};

export type PriceListApplyResult = {
  price_list: PriceListSummary | null;
  changes: PriceListChange[];
  unchanged: number;
  skipped: { item_id: string; name: string; reason: string }[];
  delta_net: number;
  applied: boolean;
  /** Oferta już jest powiązana z tym cennikiem. */
  linked: boolean;
};

type Raw = Record<string, unknown>;
const text = (value: unknown) => (value == null ? '' : String(value));
const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const record = (value: unknown): Raw | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : null);

export function normalizePriceList(value: unknown): PriceListSummary | null {
  const raw = record(value);
  if (!raw || !raw.id) return null;
  const status = text(raw.status);
  return {
    id: text(raw.id),
    name: text(raw.name),
    season_from: text(raw.season_from).slice(0, 10),
    season_to: text(raw.season_to).slice(0, 10),
    status: status === 'active' || status === 'archived' ? status : 'draft',
    my_company_id: text(raw.my_company_id),
    company_name: raw.company_name == null ? null : text(raw.company_name),
    entry_count: num(raw.entry_count),
  };
}

export function normalizeSeasonPrices(value: unknown): SeasonPrices | null {
  const raw = record(value);
  if (!raw) return null;
  const context = record(raw.context) || {};
  const source = text(raw.source);
  const dateSource = text(context.date_source);
  return {
    context: {
      company_id: context.company_id ? text(context.company_id) : null,
      company_name: context.company_name ? text(context.company_name) : null,
      date: text(context.date).slice(0, 10),
      date_source: dateSource === 'event' || dateSource === 'offer' ? dateSource : 'today',
      sales_channel: context.sales_channel ? text(context.sales_channel) : null,
      offer_status: context.offer_status ? text(context.offer_status) : null,
    },
    source: source === 'offer' || source === 'season' ? source : null,
    price_list: normalizePriceList(raw.price_list),
    suggested: normalizePriceList(raw.suggested),
    entries: (Array.isArray(raw.entries) ? raw.entries : [])
      .map(record)
      .filter((entry): entry is Raw => Boolean(entry?.product_id))
      .map((entry) => ({
        product_id: text(entry.product_id),
        variant_id: entry.variant_id ? text(entry.variant_id) : null,
        price_net: num(entry.price_net),
      })),
  };
}

export function normalizeApplyResult(value: unknown): PriceListApplyResult {
  const raw = record(value) || {};
  return {
    price_list: normalizePriceList(raw.price_list),
    changes: (Array.isArray(raw.changes) ? raw.changes : []).map(record).filter((row): row is Raw => Boolean(row)).map((row) => ({
      item_id: text(row.item_id),
      name: text(row.name),
      quantity: num(row.quantity),
      days: num(row.days) || 1,
      old_price: num(row.old_price),
      new_price: num(row.new_price),
      old_unit_price: num(row.old_unit_price),
      new_unit_price: num(row.new_unit_price),
      old_subtotal: num(row.old_subtotal),
      new_subtotal: num(row.new_subtotal),
    })),
    unchanged: num(raw.unchanged),
    skipped: (Array.isArray(raw.skipped) ? raw.skipped : []).map(record).filter((row): row is Raw => Boolean(row)).map((row) => ({
      item_id: text(row.item_id), name: text(row.name), reason: text(row.reason),
    })),
    delta_net: num(raw.delta_net),
    applied: raw.applied === true,
    linked: raw.linked === true,
  };
}

/** Ceny sezonu dla nowej oferty eventu (`eventId`) albo istniejącej oferty (`offerId`); `null`, gdy brak (lub przed migracją). */
export async function loadSeasonPrices(
  client: SupabaseClient,
  target: { eventId?: string | null; offerId?: string | null },
): Promise<SeasonPrices | null> {
  if (!target.eventId && !target.offerId) return null;
  try {
    const { data, error } = await client.rpc('offer_season_prices', {
      p_event_id: target.eventId || null,
      p_offer_id: target.offerId || null,
    });
    if (error || !data) return null;
    return normalizeSeasonPrices(data);
  } catch {
    return null;
  }
}

/**
 * Ceny sezonu marki dla daty (`YYYY-MM-DD`) bez eventu i oferty — oferta ze spotkania w Prezentacjach (marka działu, termin
 * z rozmowy albo dziś). Aktywny cennik marki obejmujący datę (`season_price_list_id`); brak — `null` (ceny z katalogu).
 */
export async function loadCompanySeasonPrices(
  client: SupabaseClient,
  companyId: string,
  date: string,
  dateSource: 'event' | 'today',
): Promise<SeasonPrices | null> {
  if (!companyId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  try {
    const { data: listId, error } = await client.rpc('season_price_list_id', { p_company_id: companyId, p_date: date });
    if (error || typeof listId !== 'string' || !listId) return null;
    const [summary, entries] = await Promise.all([
      client.rpc('price_list_summary', { p_price_list_id: listId }),
      client.from('price_list_entries').select('product_id, product_variant_id, price_net').eq('price_list_id', listId),
    ]);
    if (summary.error || entries.error || !summary.data) return null;
    return normalizeSeasonPrices({
      context: { company_id: companyId, company_name: record(summary.data)?.company_name ?? null, date, date_source: dateSource },
      source: 'season',
      price_list: summary.data,
      suggested: null,
      entries: ((entries.data || []) as Raw[]).map((row) => ({ product_id: row.product_id, variant_id: row.product_variant_id, price_net: row.price_net })),
    });
  } catch {
    return null;
  }
}

/** Podgląd albo zastosowanie cennika do oferty; błędy bazy (np. zaakceptowana oferta) jako `Error` z czytelnym opisem. */
export async function applyPriceListToOffer(
  client: SupabaseClient,
  offerId: string,
  options: { priceListId?: string | null; dryRun: boolean },
): Promise<PriceListApplyResult> {
  const { data, error } = await client.rpc('apply_price_list_to_offer', {
    p_offer_id: offerId,
    p_price_list_id: options.priceListId || null,
    p_dry_run: options.dryRun,
  });
  if (error) throw new Error(error.message || 'Nie udało się przeliczyć oferty według cennika.');
  return normalizeApplyResult(data);
}

// MARK: Ceny w katalogu

const priceKey = (productId: string, variantId: string | null | undefined) => `${productId}:${variantId || ''}`;

/** Ceny cennika według produktu i wariantu (pusta mapa, gdy brak cennika). */
export function seasonPriceIndex(prices: SeasonPrices | null | undefined): Map<string, number> {
  const index = new Map<string, number>();
  if (!prices?.price_list) return index;
  for (const entry of prices.entries) index.set(priceKey(entry.product_id, entry.variant_id), entry.price_net);
  return index;
}

export function seasonPriceOf(prices: SeasonPrices | null | undefined, productId: string, variantId: string | null = null): number | null {
  if (!prices?.price_list) return null;
  const entry = prices.entries.find((row) => row.product_id === productId && (row.variant_id || null) === (variantId || null));
  return entry ? entry.price_net : null;
}

type PricedVariant = { id: string; price_net?: number | null };
type PricedProduct = { id: string; base_price?: number | null; variants?: PricedVariant[] | null };

/** Produkt z cenami sezonu (cena bazowa i ceny wariantów); bez ceny w cenniku zostaje cena z katalogu. */
export function applySeasonPrice<P extends PricedProduct>(product: P, index: Map<string, number>): P {
  if (!index.size) return product;
  const base = index.get(priceKey(product.id, null));
  const variants = product.variants
    ? product.variants.map((variant) => {
      const price = index.get(priceKey(product.id, variant.id));
      return price === undefined ? variant : { ...variant, price_net: price };
    })
    : product.variants;
  return { ...product, ...(base === undefined ? {} : { base_price: base }), variants };
}

export function applySeasonPrices<P extends PricedProduct>(products: P[], prices: SeasonPrices | null | undefined): P[] {
  const index = seasonPriceIndex(prices);
  if (!index.size) return products;
  return products.map((product) => applySeasonPrice(product, index));
}

/** Ceny wszystkich wariantów produktu z cennika — zapisywane w pozycji (`variant_prices_net`), by PDF nie zmienił się z katalogiem. */
export function seasonVariantPrices(prices: SeasonPrices | null | undefined, productId: string | null | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  if (!prices?.price_list || !productId) return result;
  for (const entry of prices.entries) {
    if (entry.product_id === productId && entry.variant_id) result[entry.variant_id] = entry.price_net;
  }
  return result;
}

// MARK: Opisy dla sprzedawcy (CRM i Mac)

const formatDate = (value: string) => {
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}.${month}.${year}` : value;
};

export const priceListSeason = (list: Pick<PriceListSummary, 'season_from' | 'season_to'>) =>
  `${formatDate(list.season_from)} – ${formatDate(list.season_to)}`;

export const priceListStatusLabels: Record<PriceListStatus, string> = {
  draft: 'Szkic',
  active: 'Aktywny',
  archived: 'Archiwum',
};

export type SeasonPriceNotice = {
  tone: 'info' | 'warning' | 'muted';
  title: string;
  detail: string;
  /** Można przeliczyć ofertę według cennika sezonu (jest aktywny cennik dla marki i daty eventu). */
  canReprice: boolean;
};

/** Gdzie pokazujemy opis: kreator nowej oferty, strona oferty (gwarancja ceny, „Przelicz”), okno dodawania/edycji pozycji. */
export type SeasonPriceNoticeMode = 'wizard' | 'offer' | 'item';

/** Opis cennika dla sprzedawcy; `null` — cennik sezonowy nie dotyczy (oferta sprzedawcy albo brak danych). */
export function seasonPriceNotice(prices: SeasonPrices | null | undefined, mode: SeasonPriceNoticeMode): SeasonPriceNotice | null {
  if (!prices || prices.context.sales_channel === 'seller_portal') return null;
  const forOffer = mode === 'offer';
  const { context, price_list: list, suggested, source } = prices;
  const date = context.date ? formatDate(context.date) : '';
  const dateLabel = context.date_source === 'today' ? `dziś (${date})` : `data eventu ${date}`;
  const accepted = context.offer_status === 'accepted';
  if (list) {
    const company = list.company_name ? ` ${list.company_name}` : '';
    if (forOffer && source === 'offer' && suggested) {
      return {
        tone: 'warning',
        title: `Cennik: ${list.name}`,
        detail: `Ceny oferty są gwarantowane według cennika „${list.name}”, a ${dateLabel} wskazuje cennik „${suggested.name}” (${priceListSeason(suggested)}). Przelicz, jeśli klient ma dostać ceny z nowego sezonu.`,
        canReprice: !accepted,
      };
    }
    if (forOffer && source === 'offer') {
      return {
        tone: 'info',
        title: `Cennik: ${list.name}`,
        detail: `Oferta wyceniona według cennika${company} na sezon ${priceListSeason(list)}. Ceny pozycji nie zmieniają się same (gwarancja ceny); nowe pozycje dostają ceny z tego cennika.`,
        canReprice: !accepted,
      };
    }
    if (mode === 'item') {
      return {
        tone: 'info',
        title: `Cennik: ${list.name}`,
        detail: source === 'offer'
          ? `Ceny produktów i wariantów z cennika${company} na sezon ${priceListSeason(list)} — według niego wyceniono tę ofertę.`
          : `Ceny produktów i wariantów z cennika${company} na sezon ${priceListSeason(list)} (${dateLabel}).`,
        canReprice: false,
      };
    }
    return {
      tone: 'info',
      title: `Cennik: ${list.name}`,
      detail: forOffer
        ? `Nowe pozycje dostają ceny z cennika${company} na sezon ${priceListSeason(list)} (${dateLabel}). Zapisane pozycje mają swoje ceny — „Przelicz według cennika” pokaże różnice.`
        : `Ceny produktów z cennika${company} na sezon ${priceListSeason(list)} (${dateLabel}). Po utworzeniu oferty ceny są gwarantowane.`,
      canReprice: forOffer && !accepted,
    };
  }
  if (!context.company_id) {
    return {
      tone: 'muted',
      title: 'Ceny z katalogu',
      detail: 'Event nie ma marki realizującej, więc cennik sezonowy nie został wybrany — ceny z katalogu produktów.',
      canReprice: false,
    };
  }
  return {
    tone: 'muted',
    title: 'Ceny z katalogu',
    detail: `Brak aktywnego cennika ${context.company_name || 'marki'} na ${dateLabel.replace(/^data eventu /, '')} — ceny z katalogu produktów.`,
    canReprice: false,
  };
}
