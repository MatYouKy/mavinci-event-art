import 'server-only';
import type { NativeContext } from './auth';
import { fail, offersAccess } from './offers';
import { priceListSeason, priceListStatusLabels, type PriceListStatus } from '@/lib/CRM/Offers/seasonPrices';
import {
  loadPriceListAttention,
  PRICE_LIST_ATTENTION_HINT,
  priceListAttentionGapText,
  priceListAttentionOfferText,
  priceListAttentionOfferTitle,
} from '@/lib/CRM/Offers/priceListAttention';
import {
  PRICE_ROUNDING_STEPS,
  PRICE_LIST_PRODUCT_SELECT,
  PRICE_LIST_PRODUCT_SELECT_LEGACY,
  priceListRows,
  priceWithPercent,
  type PriceListCatalogProduct,
  type PriceListEntryRow,
} from '@/lib/CRM/Offers/priceListRows';

/*
 * Cenniki sezonowe na Macu — jak „Oferty → Cenniki” w CRM (`PriceListsManager`): lista cenników marek, edytor cen produktów
 * i wariantów, nowy cennik (z cenami z katalogu), kopia na kolejny sezon z podwyżką, zmiana wszystkich cen o %, status
 * (szkic / aktywny / archiwum) i usuwanie nieużytego. Te same tabele i funkcje bazy (`price_lists`, `price_list_entries`,
 * `price_list_fill_from_catalog`, `price_list_duplicate`) tokenem pracownika — uprawnienia pilnuje RLS (podgląd: dostęp do marki,
 * zmiany: admin albo `offers_manage`). Karta produktu: ceny produktu w cennikach (`productSeasonPrices`). Lista ma też
 * „Do sprawdzenia” (`priceListAttention.ts`, jak w CRM) — przed migracją `price_list_attention` pole `attention` jest puste.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: PriceListStatus[] = ['draft', 'active', 'archived'];
const text = (value: unknown) => (value == null ? '' : String(value));
const uuid = (value: unknown, message = 'Nie znaleziono cennika.') => {
  const id = text(value);
  if (!UUID.test(id)) fail(message);
  return id;
};
function dbFail(error: { message?: string; code?: string } | null | undefined, fallback: string): never {
  if (error?.code === '23503') fail('Cennik jest użyty w ofertach — zarchiwizuj go zamiast usuwać.');
  if (error?.code === '42P01' || error?.code === 'PGRST205') fail('Cenniki sezonowe wymagają migracji 20261129100000_season_price_lists.sql.');
  fail(error?.message || fallback);
}
const percentOf = (value: unknown) => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < -50 || parsed > 200) fail('Zmiana cen musi mieścić się w zakresie od -50% do +200%.');
  return parsed;
};
const roundingOf = (value: unknown) => {
  const parsed = Number(value ?? 1);
  if (!PRICE_ROUNDING_STEPS.includes(parsed as (typeof PRICE_ROUNDING_STEPS)[number])) fail('Nieprawidłowe zaokrąglenie cen.');
  return parsed;
};
const season = (from: unknown, to: unknown) => {
  const start = text(from).slice(0, 10);
  const end = text(to).slice(0, 10);
  if (!DATE.test(start) || !DATE.test(end) || end < start) fail('Podaj poprawny sezon (od – do).');
  return { start, end };
};
const nameOf = (value: unknown) => {
  const name = text(value).trim();
  if (!name || name.length > 120) fail('Podaj nazwę cennika (do 120 znaków).');
  return name;
};

/** Zarządzanie cennikami (jak RLS): admin albo `offers_manage`. */
export const canManagePriceLists = (ctx: NativeContext) => offersAccess(ctx).canManage || ctx.employee.isAdmin;

const listView = (row: Row, companies: Map<string, string>) => ({
  id: text(row.id),
  companyId: text(row.my_company_id),
  company: companies.get(text(row.my_company_id)) || 'Marka',
  name: text(row.name),
  seasonFrom: text(row.season_from).slice(0, 10),
  seasonTo: text(row.season_to).slice(0, 10),
  season: priceListSeason({ season_from: text(row.season_from).slice(0, 10), season_to: text(row.season_to).slice(0, 10) }),
  status: (STATUSES.includes(row.status) ? row.status : 'draft') as PriceListStatus,
  statusLabel: priceListStatusLabels[(STATUSES.includes(row.status) ? row.status : 'draft') as PriceListStatus],
  notes: text(row.notes),
  entryCount: Number(row.entries?.[0]?.count) || 0,
  offerCount: Number(row.offers?.[0]?.count) || 0,
});

/** „Do sprawdzenia” z opisami jak w CRM; przed migracją albo przy błędzie — `null`. */
async function priceListAttentionView(ctx: NativeContext) {
  const attention = await loadPriceListAttention(ctx.supabase);
  if (!attention) return null;
  return {
    offers: attention.offers.map((offer) => ({
      id: offer.offerId,
      kind: offer.kind,
      date: offer.date,
      title: priceListAttentionOfferTitle(offer),
      text: priceListAttentionOfferText(offer),
    })),
    missing: attention.missing.map((gap) => ({
      id: `${gap.companyId}-${gap.year}`,
      companyId: gap.companyId,
      year: gap.year,
      events: gap.events,
      text: priceListAttentionGapText(gap),
    })),
    hint: PRICE_LIST_ATTENTION_HINT,
  };
}

/** Lista cenników (z liczbą cen i ofert), marki i kategorie do okien, „Do sprawdzenia”. */
export async function priceListsState(ctx: NativeContext) {
  const [lists, companies, categories, attention] = await Promise.all([
    ctx.supabase.from('price_lists')
      .select('id, my_company_id, name, season_from, season_to, status, notes, entries:price_list_entries(count), offers(count)')
      .order('season_from', { ascending: false }),
    ctx.supabase.from('my_companies').select('id, name').eq('is_active', true).order('name'),
    ctx.supabase.from('event_categories').select('id, name').order('name'),
    priceListAttentionView(ctx),
  ]);
  if (lists.error) dbFail(lists.error, 'Nie udało się pobrać cenników.');
  const names = new Map(((companies.data || []) as Row[]).map((row) => [text(row.id), text(row.name)]));
  return {
    canManage: canManagePriceLists(ctx),
    companies: ((companies.data || []) as Row[]).map((row) => ({ id: text(row.id), name: text(row.name) })),
    categories: ((categories.data || []) as Row[]).map((row) => ({ id: text(row.id), name: text(row.name) })),
    lists: ((lists.data || []) as Row[]).map((row) => listView(row, names)),
    attention,
  };
}


/** Edytor cennika: wiersze produktów i wariantów z ceną katalogową i ceną w cenniku. */
export async function priceListEditor(ctx: NativeContext, id: string) {
  const key = uuid(id);
  const [list, entries, products, categories, companies] = await Promise.all([
    ctx.supabase.from('price_lists').select('id, my_company_id, name, season_from, season_to, status, notes, entries:price_list_entries(count), offers(count)')
      .eq('id', key).maybeSingle(),
    ctx.supabase.from('price_list_entries').select('id, product_id, product_variant_id, price_net').eq('price_list_id', key),
    ctx.supabase.from('offer_products').select(PRICE_LIST_PRODUCT_SELECT).order('name'),
    ctx.supabase.from('event_categories').select('id, name'),
    ctx.supabase.from('my_companies').select('id, name'),
  ]);
  // Bez migracji kategorii dodatkowych (kolumny jeszcze nie ma) — produkty bez nich.
  const productRows = products.error?.code === '42703'
    ? await ctx.supabase.from('offer_products').select(PRICE_LIST_PRODUCT_SELECT_LEGACY).order('name')
    : products;
  if (list.error) dbFail(list.error, 'Nie udało się pobrać cennika.');
  if (!list.data) fail('Nie znaleziono cennika.');
  if (entries.error || productRows.error) dbFail(entries.error || productRows.error, 'Nie udało się pobrać cen cennika.');
  const categoryNames = Object.fromEntries(((categories.data || []) as Row[]).map((row) => [text(row.id), text(row.name)]));
  const companyNames = new Map(((companies.data || []) as Row[]).map((row) => [text(row.id), text(row.name)]));
  const entryRows = ((entries.data || []) as Row[]).map((row): PriceListEntryRow => ({
    id: text(row.id), product_id: text(row.product_id), product_variant_id: row.product_variant_id ? text(row.product_variant_id) : null,
    price_net: Number(row.price_net) || 0,
  }));
  return {
    canManage: canManagePriceLists(ctx),
    list: listView(list.data as Row, companyNames),
    rows: priceListRows((productRows.data || []) as PriceListCatalogProduct[], entryRows, categoryNames).map((row) => ({
      ...row,
      category: row.categoryId ? categoryNames[row.categoryId] || null : null,
    })),
  };
}

/** Nowy cennik (szkic), opcjonalnie od razu z cenami z katalogu. Zwraca stan listy i identyfikator. */
export async function createPriceList(ctx: NativeContext, body: Row) {
  const companyId = uuid(body.companyId, 'Wybierz markę.');
  const name = nameOf(body.name);
  const { start, end } = season(body.seasonFrom, body.seasonTo);
  const fill = body.fill && typeof body.fill === 'object' ? body.fill as Row : null;
  const categoryId = fill && UUID.test(text(fill.categoryId)) ? text(fill.categoryId) : null;
  const percent = fill ? percentOf(fill.percent) : 0;
  const rounding = fill ? roundingOf(fill.rounding) : 1;
  const { data, error } = await ctx.supabase.from('price_lists')
    .insert({ my_company_id: companyId, name, season_from: start, season_to: end, status: 'draft', notes: text(body.notes).trim().slice(0, 2000) })
    .select('id').single();
  if (error || !data) dbFail(error, 'Nie udało się utworzyć cennika.');
  const id = text((data as Row).id);
  let added = 0;
  if (fill) {
    const result = await ctx.supabase.rpc('price_list_fill_from_catalog', { p_price_list_id: id, p_category_id: categoryId, p_percent: percent, p_rounding: rounding });
    if (result.error) dbFail(result.error, 'Cennik utworzony, ale nie udało się uzupełnić cen z katalogu.');
    added = Number(result.data) || 0;
  }
  return {
    ...(await priceListsState(ctx)),
    savedId: id,
    message: `Utworzono cennik „${name}” (szkic)${fill ? ` z cenami z katalogu: ${added}` : ''}. Sprawdź ceny i aktywuj cennik.`,
  };
}

/** Ustawienia cennika (nazwa, sezon, notatki) i status. */
export async function updatePriceList(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const patch: Row = {};
  if (body.name !== undefined) patch.name = nameOf(body.name);
  if (body.seasonFrom !== undefined || body.seasonTo !== undefined) {
    const { start, end } = season(body.seasonFrom, body.seasonTo);
    patch.season_from = start;
    patch.season_to = end;
  }
  if (body.notes !== undefined) patch.notes = text(body.notes).trim().slice(0, 2000);
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) fail('Nieprawidłowy status cennika.');
    patch.status = body.status;
  }
  if (!Object.keys(patch).length) fail('Brak zmian do zapisania.');
  const { data, error } = await ctx.supabase.from('price_lists').update(patch).eq('id', id).select('id, name').maybeSingle();
  if (error) dbFail(error, 'Nie udało się zapisać cennika.');
  if (!data) fail('Nie masz uprawnień do zmiany tego cennika.');
  const name = text((data as Row).name);
  const message = patch.status === 'active' ? `Cennik „${name}” jest aktywny — nowe oferty eventów z jego sezonu dostają jego ceny.`
    : patch.status === 'archived' ? `Cennik „${name}” przeniesiony do archiwum.`
      : patch.status === 'draft' ? `Cennik „${name}” jest szkicem.` : 'Zapisano ustawienia cennika.';
  return { ...(await priceListsState(ctx)), message };
}

/** Usunięcie nieużytego cennika (z cenami). Cennik użyty w ofertach — tylko archiwum. */
export async function deletePriceList(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const { data, error } = await ctx.supabase.from('price_lists').delete().eq('id', id).select('id');
  if (error) dbFail(error, 'Nie udało się usunąć cennika.');
  if (!data?.length) fail('Nie masz uprawnień do usunięcia tego cennika.');
  return { ...(await priceListsState(ctx)), message: 'Cennik usunięty.' };
}

/** „Kopiuj na kolejny sezon”: szkic z cenami zmienionymi o procent i zaokrąglonymi. */
export async function duplicatePriceList(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const name = nameOf(body.name);
  const { start, end } = season(body.seasonFrom, body.seasonTo);
  const percent = percentOf(body.percent);
  const rounding = roundingOf(body.rounding);
  const { data, error } = await ctx.supabase.rpc('price_list_duplicate', {
    p_source_id: id, p_name: name, p_season_from: start, p_season_to: end, p_percent: percent, p_rounding: rounding,
  });
  if (error || !data) dbFail(error, 'Nie udało się skopiować cennika.');
  return {
    ...(await priceListsState(ctx)),
    savedId: text(data),
    message: `Utworzono szkic „${name}” z cenami ${percent >= 0 ? '+' : ''}${percent}%. Sprawdź ceny i aktywuj cennik.`,
  };
}

/** „Uzupełnij z katalogu”: brakujące aktywne produkty i warianty (opcjonalnie jednej kategorii) z ceną katalogową ± %. */
export async function fillPriceList(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const categoryId = UUID.test(text(body.categoryId)) ? text(body.categoryId) : null;
  const { data, error } = await ctx.supabase.rpc('price_list_fill_from_catalog', {
    p_price_list_id: id, p_category_id: categoryId, p_percent: percentOf(body.percent), p_rounding: roundingOf(body.rounding),
  });
  if (error) dbFail(error, 'Nie udało się uzupełnić cennika.');
  return { ...(await priceListEditor(ctx, id)), message: `Dodano ceny z katalogu: ${Number(data) || 0}.` };
}

/**
 * Zapis cen z edytora: `changes` = [{productId, variantId, price}] — liczba ustawia cenę, `null` usuwa pozycję z cennika.
 * Każda zmiana dotyczy wiersza produktu albo wariantu tego produktu (pilnuje też wyzwalacz bazy).
 */
export async function savePriceListPrices(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const raw = (Array.isArray(body.changes) ? body.changes : []).slice(0, 2000) as Row[];
  if (!raw.length) fail('Brak zmian do zapisania.');
  const { data: current, error: currentError } = await ctx.supabase.from('price_list_entries')
    .select('id, product_id, product_variant_id, price_net').eq('price_list_id', id);
  if (currentError) dbFail(currentError, 'Nie udało się pobrać cen cennika.');
  const existing = new Map(((current || []) as Row[]).map((row) => [`${row.product_id}:${row.product_variant_id || ''}`, row]));
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const removals: string[] = [];
  for (const change of raw) {
    const productId = uuid(change.productId, 'Nieprawidłowy produkt w zmianach.');
    const variantId = change.variantId ? uuid(change.variantId, 'Nieprawidłowy wariant w zmianach.') : null;
    const entry = existing.get(`${productId}:${variantId || ''}`);
    if (change.price === null || change.price === undefined || change.price === '') {
      if (entry) removals.push(text(entry.id));
      continue;
    }
    const price = Number(change.price);
    if (!Number.isFinite(price) || price < 0 || price > 999999999.99) fail('Ceny muszą być nieujemne (do 999 999 999,99 zł).');
    const rounded = Math.round(price * 100) / 100;
    if (entry) {
      if (Number(entry.price_net) !== rounded) updates.push({ id: entry.id, price_list_id: id, product_id: productId, product_variant_id: variantId, price_net: rounded });
    } else {
      inserts.push({ price_list_id: id, product_id: productId, product_variant_id: variantId, price_net: rounded });
    }
  }
  if (inserts.length) { const { error } = await ctx.supabase.from('price_list_entries').insert(inserts); if (error) dbFail(error, 'Nie udało się dodać cen.'); }
  if (updates.length) { const { error } = await ctx.supabase.from('price_list_entries').upsert(updates, { onConflict: 'id' }); if (error) dbFail(error, 'Nie udało się zmienić cen.'); }
  if (removals.length) { const { error } = await ctx.supabase.from('price_list_entries').delete().in('id', removals); if (error) dbFail(error, 'Nie udało się usunąć cen.'); }
  const count = inserts.length + updates.length + removals.length;
  return { ...(await priceListEditor(ctx, id)), message: count ? `Zapisano ceny w cenniku (${count}).` : 'Ceny bez zmian.' };
}

/** „Zmień ceny o %”: wszystkie ceny cennika zmienione o procent i zaokrąglone. */
export async function percentPriceList(ctx: NativeContext, body: Row) {
  const id = uuid(body.id);
  const percent = percentOf(body.percent);
  const rounding = roundingOf(body.rounding);
  const { data, error } = await ctx.supabase.from('price_list_entries').select('id, product_id, product_variant_id, price_net').eq('price_list_id', id);
  if (error) dbFail(error, 'Nie udało się pobrać cen cennika.');
  const updates = ((data || []) as Row[]).map((row) => ({
    id: row.id, price_list_id: id, product_id: row.product_id, product_variant_id: row.product_variant_id,
    price_net: priceWithPercent(Number(row.price_net) || 0, percent, rounding),
  }));
  if (updates.length) {
    const { error: saveError } = await ctx.supabase.from('price_list_entries').upsert(updates, { onConflict: 'id' });
    if (saveError) dbFail(saveError, 'Nie udało się zmienić cen.');
  }
  return { ...(await priceListEditor(ctx, id)), message: `Zmieniono ceny (${updates.length}) o ${percent >= 0 ? '+' : ''}${percent}%.` };
}

/** Karta produktu: ceny produktu i jego wariantów w cennikach (aktywne, szkice, archiwum). */
export async function productSeasonPrices(ctx: NativeContext, productId: string) {
  const id = uuid(productId, 'Nie znaleziono produktu.');
  const [entries, lists, product, companies] = await Promise.all([
    ctx.supabase.from('price_list_entries').select('price_list_id, product_variant_id, price_net').eq('product_id', id),
    ctx.supabase.from('price_lists').select('id, my_company_id, name, season_from, season_to, status').order('season_from', { ascending: false }),
    ctx.supabase.from('offer_products').select('id, base_price, variants:offer_product_variants(id, name, price_net, is_active, display_order)').eq('id', id).maybeSingle(),
    ctx.supabase.from('my_companies').select('id, name'),
  ]);
  // Bez migracji cenników — pusta sekcja (karta produktu działa jak dotąd).
  if (entries.error || lists.error) return { available: false, canManage: false, lists: [] };
  const names = new Map(((companies.data || []) as Row[]).map((row) => [text(row.id), text(row.name)]));
  const variants = ((((product.data as Row | null)?.variants) || []) as Row[])
    .sort((a, b) => (Number(a.display_order) || 0) - (Number(b.display_order) || 0));
  const byList = new Map<string, Row[]>();
  ((entries.data || []) as Row[]).forEach((row) => byList.set(text(row.price_list_id), [...(byList.get(text(row.price_list_id)) || []), row]));
  return {
    available: true,
    canManage: canManagePriceLists(ctx),
    catalogBase: Number((product.data as Row | null)?.base_price) || 0,
    lists: ((lists.data || []) as Row[]).filter((row) => byList.has(text(row.id))).map((row) => {
      const rows = byList.get(text(row.id)) || [];
      const base = rows.find((entry) => !entry.product_variant_id);
      return {
        id: text(row.id),
        name: text(row.name),
        company: names.get(text(row.my_company_id)) || 'Marka',
        season: priceListSeason({ season_from: text(row.season_from).slice(0, 10), season_to: text(row.season_to).slice(0, 10) }),
        status: (STATUSES.includes(row.status) ? row.status : 'draft') as PriceListStatus,
        statusLabel: priceListStatusLabels[(STATUSES.includes(row.status) ? row.status : 'draft') as PriceListStatus],
        basePrice: base ? Number(base.price_net) : null,
        variants: variants
          .filter((variant) => rows.some((entry) => entry.product_variant_id === variant.id))
          .map((variant) => ({
            id: text(variant.id),
            name: text(variant.name),
            catalogPrice: Number(variant.price_net) || 0,
            price: Number(rows.find((entry) => entry.product_variant_id === variant.id)?.price_net) || 0,
          })),
      };
    }),
  };
}
