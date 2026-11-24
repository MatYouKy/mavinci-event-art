import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { OFFER_IMAGES_BUCKET } from './productImages';
import { productDuplicateName, type ProductDuplicateResult } from '@/lib/CRM/Offers/productDuplicate';

/*
 * „Duplikuj” produkt (CRM i Mac, `src/lib/CRM/Offers/productDuplicate.ts`): nowy produkt z nowym identyfikatorem i kopią karty —
 * wiersz produktu (z pakietami, dodatkami, wymaganiami, klauzulami, tekstami EN), warianty z nowymi identyfikatorami (odwołania
 * do nich w pakietach, tekstach EN i konfiguratorze dostają nowe identyfikatory), sprzęt i obsada (produktu i wariantów), moduły
 * Mavinci LIVE, przygotowanie i zamówienia oraz ceny w cennikach sezonów (bez archiwalnych). Zdjęcia kopiujemy do folderu nowego
 * produktu (karta na Macu przyjmuje tylko zdjęcia z folderu produktu), kadry przechodzą na nowe ścieżki. Kopia jest nieaktywna.
 * Zapis tokenem pracownika (RLS): bez uprawnień do Mavinci LIVE, przygotowania lub cenników ta część jest pomijana i wypisana
 * w odpowiedzi; błąd w części podstawowej usuwa nowy produkt (kaskadą jego części) i skopiowane pliki.
 */

type Row = Record<string, any>;
const fail = (message: string): never => { throw new Error(message); };
const OMIT = new Set(['id', 'created_at', 'updated_at']);
const strip = (row: Row, extra: string[] = []) =>
  Object.fromEntries(Object.entries(row).filter(([key]) => !OMIT.has(key) && !extra.includes(key))) as Row;
const isMissingTable = (code?: string) => code === '42P01' || code === 'PGRST205';
const isForbidden = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === '42501' || /row-level security|permission denied/i.test(error.message || '')));
const alreadyExists = (error: unknown) =>
  /already exists|duplicate|409/i.test(`${(error as { message?: string })?.message || ''} ${(error as { statusCode?: string })?.statusCode || ''}`);
const packagesOf = (row: Row) => (Array.isArray(row?.sales_packages) ? row.sales_packages as Row[] : []);
/** Błąd zapisu części podstawowej — z RLS po polsku, inne z bazy. */
const insertFailed = (error: { code?: string; message?: string }, fallback: string): never =>
  fail(isForbidden(error) ? `${fallback} Nie masz do tego uprawnień.` : error.message || fallback);

async function optionalRows(query: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>) {
  const { data, error } = await query;
  if (error && !isMissingTable(error.code)) fail(error.message || 'Nie udało się odczytać produktu.');
  return (data || []) as Row[];
}

export async function duplicateProduct(ctx: NativeContext, sourceId: string): Promise<ProductDuplicateResult> {
  const [productRes, variants, equipment, staff, live, preparation, entries] = await Promise.all([
    ctx.supabase.from('offer_products').select('*').eq('id', sourceId).maybeSingle(),
    optionalRows(ctx.supabase.from('offer_product_variants').select('*').eq('product_id', sourceId).order('display_order')),
    optionalRows(ctx.supabase.from('offer_product_equipment').select('*').eq('product_id', sourceId)),
    optionalRows(ctx.supabase.from('offer_product_staff').select('*').eq('product_id', sourceId)),
    optionalRows(ctx.supabase.from('offer_product_mavinci_live_modules').select('*').eq('product_id', sourceId)),
    optionalRows(ctx.supabase.from('offer_product_preparation_items').select('*').eq('product_id', sourceId).order('order_index')),
    optionalRows(ctx.supabase.from('price_list_entries').select('price_list_id,product_variant_id,price_net').eq('product_id', sourceId)),
  ]);
  if (productRes.error) fail(productRes.error.message);
  const product = productRes.data as Row | null;
  if (!product) fail('Nie znaleziono produktu.');
  const source = product as Row;

  const newId = randomUUID();
  const variantIds = new Map(variants.map((row) => [String(row.id), randomUUID()]));
  const swapIds = (text: string) => {
    let out = text;
    variantIds.forEach((to, from) => { if (out.includes(from)) out = out.split(from).join(to); });
    return out;
  };
  const mappedVariant = (value: unknown) => (value == null ? null : variantIds.get(String(value)) ?? undefined);

  // Zdjęcia używane przez produkt, warianty i pakiety → kopie w folderze nowego produktu.
  const referenced = new Set<string>();
  const addPath = (path: unknown) => {
    if (typeof path === 'string' && /^assets\/[^?#\\]+$/.test(path) && !path.includes('..') && !path.includes('//')) referenced.add(path);
  };
  addPath(source.offer_image_path);
  variants.forEach((row) => addPath(row.offer_image_path));
  packagesOf(source).forEach((item) => addPath(item?.image_path));
  const prefix = `assets/${sourceId}/`;
  const used = new Set<string>();
  const targetOf = (path: string) => {
    const base = path.startsWith(prefix) ? `assets/${newId}/${swapIds(path.slice(prefix.length))}` : `assets/${newId}/${path.slice(path.lastIndexOf('/') + 1)}`;
    let next = base;
    for (let index = 2; used.has(next); index += 1) next = base.replace(/(\.[^./]+)?$/, `-${index}$1`);
    used.add(next);
    return next;
  };
  const pathMap = new Map<string, string>();
  const copied: string[] = [];
  let imagesMissing = 0;
  for (const path of referenced) {
    const next = targetOf(path);
    const { error } = await ctx.supabase.storage.from(OFFER_IMAGES_BUCKET).copy(path, next);
    if (error && !alreadyExists(error)) { imagesMissing += 1; continue; }
    if (!error) copied.push(next);
    pathMap.set(path, next);
  }
  // Zdjęcie bez skopiowanego pliku — kopia jest bez niego (nie wskazujemy pliku innego produktu).
  const mapPath = (value: unknown) => (typeof value === 'string' && referenced.has(value) ? pathMap.get(value) ?? null : value ?? null);
  const remap = (value: unknown): unknown => {
    if (typeof value === 'string') return referenced.has(value) ? pathMap.get(value) ?? null : swapIds(value);
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value as Row).map(([key, item]) => [pathMap.get(key) ?? swapIds(key), remap(item)]));
    }
    return value;
  };

  const crops = source.offer_image_crops && typeof source.offer_image_crops === 'object' && !Array.isArray(source.offer_image_crops)
    ? Object.fromEntries(Object.entries(source.offer_image_crops as Row).filter(([key]) => pathMap.has(key)).map(([key, value]) => [pathMap.get(key), value]))
    : {};
  const row = remap(strip(source)) as Row;
  Object.assign(row, {
    id: newId,
    name: productDuplicateName(String(source.name || '')),
    is_active: false,
    offer_image_path: mapPath(source.offer_image_path),
    offer_image_crops: crops,
  });

  const skipped: string[] = [];
  let created = false;
  try {
    const { error: productError } = await ctx.supabase.from('offer_products').insert(row);
    if (productError) insertFailed(productError, 'Nie udało się utworzyć kopii produktu.');
    created = true;

    if (variants.length) {
      const { error } = await ctx.supabase.from('offer_product_variants').insert(variants.map((variant) => ({
        ...(remap(strip(variant)) as Row),
        id: variantIds.get(String(variant.id)),
        product_id: newId,
        offer_image_path: mapPath(variant.offer_image_path),
      })));
      if (error) insertFailed(error, 'Nie udało się skopiować wariantów.');
    }
    // Sprzęt i obsada produktu oraz wariantów (wiersze wariantu spoza produktu pomijamy — nie przenosimy ich do produktu bazowego).
    const scoped = (rows: Row[]): Row[] => rows.filter((item) => mappedVariant(item.product_variant_id) !== undefined)
      .map((item) => ({ ...strip(item), id: randomUUID(), product_id: newId, product_variant_id: mappedVariant(item.product_variant_id) }));
    const equipmentRows = scoped(equipment);
    if (equipmentRows.length) {
      const { error } = await ctx.supabase.from('offer_product_equipment').insert(equipmentRows);
      if (error) insertFailed(error, 'Nie udało się skopiować sprzętu.');
    }
    const staffRows = scoped(staff);
    if (staffRows.length) {
      const { error } = await ctx.supabase.from('offer_product_staff').insert(staffRows);
      if (error) insertFailed(error, 'Nie udało się skopiować obsady.');
    }
    // Części z osobnymi uprawnieniami: bez uprawnień — pomijamy i informujemy.
    const liveRows = scoped(live).map((item) => ({ ...item, configuration: remap(item.configuration) }));
    if (liveRows.length) {
      const { error } = await ctx.supabase.from('offer_product_mavinci_live_modules').insert(liveRows);
      if (isForbidden(error)) skipped.push('moduły Mavinci LIVE');
      else if (error) fail(error.message || 'Nie udało się skopiować modułów Mavinci LIVE.');
    }
    if (preparation.length) {
      const { error } = await ctx.supabase.from('offer_product_preparation_items').insert(preparation.map((item) => ({
        ...strip(item, ['created_by']), id: randomUUID(), product_id: newId, created_by: ctx.employee.id,
      })));
      if (isForbidden(error)) skipped.push('przygotowanie i zamówienia');
      else if (error) fail(error.message || 'Nie udało się skopiować przygotowania i zamówień.');
    }
    if (entries.length) {
      const lists = [...new Set(entries.map((item) => String(item.price_list_id)))];
      const { data: listRows } = await ctx.supabase.from('price_lists').select('id,status').in('id', lists);
      const open = new Set(((listRows || []) as Row[]).filter((item) => item.status !== 'archived').map((item) => String(item.id)));
      const priceRows = entries.filter((item) => open.has(String(item.price_list_id)) && mappedVariant(item.product_variant_id) !== undefined)
        .map((item) => ({ price_list_id: item.price_list_id, product_id: newId, product_variant_id: mappedVariant(item.product_variant_id), price_net: item.price_net }));
      if (priceRows.length) {
        const { error } = await ctx.supabase.from('price_list_entries').insert(priceRows);
        if (isForbidden(error)) skipped.push('ceny w cennikach sezonów');
        else if (error) fail(error.message || 'Nie udało się skopiować cen w cennikach.');
      }
    }
  } catch (error) {
    if (created) await ctx.supabase.from('offer_products').delete().eq('id', newId);
    if (copied.length) await ctx.supabase.storage.from(OFFER_IMAGES_BUCKET).remove(copied).catch(() => undefined);
    throw error;
  }
  return { ok: true, id: newId, name: String(row.name), skipped, imagesMissing };
}
