import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { sniffImage, webpVersion } from '@/lib/images/imageConvert.server';
import { PRODUCT_MATERIAL_IMAGE_SIDE, productMaterialImagePath } from '@/lib/CRM/Offers/productImageSource';
import { materialFileRow } from '@/lib/materials/materials.server';

/*
 * Zdjęcia w magazynie `offer-product-pages` (produkty, warianty/elementy, pakiety, własne zdjęcia broszur) zapisujemy tylko jako
 * lekkie WebP przygotowane na serwerze (Chromium jak render PDF — `imageConvert.server.ts`), niezależnie od tego, czy plik przyszedł
 * z komputera (CRM, Mac), czy z Dysku (Materiały). PDF oferty i broszury zamienia WebP na JPEG/PNG przy generowaniu.
 * Starsze zdjęcia JPG/PNG zamienia „Zamień zdjęcia na WebP” w katalogu (`convertOfferImages`) — stare pliki zostają w magazynie,
 * bo mogą ich używać wcześniejsze broszury.
 */

type Row = Record<string, any>;
export const OFFER_IMAGES_BUCKET = 'offer-product-pages';
/** Najwięcej, ile może mieć zdjęcie z komputera (po zmniejszeniu w CRM lub na Macu). */
export const OFFER_IMAGE_UPLOAD_MAX = 10 * 1024 * 1024;
const MATERIAL_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MATERIAL_IMAGE_MAX_BYTES = 60 * 1024 * 1024;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const fail = (message: string): never => { throw new Error(message); };
const alreadyExists = (error: unknown) =>
  /already exists|duplicate|409/i.test(`${(error as { message?: string })?.message || ''} ${(error as { statusCode?: string })?.statusCode || ''}`);

async function exists(ctx: NativeContext, path: string) {
  const slash = path.lastIndexOf('/');
  const name = path.slice(slash + 1);
  const { data } = await ctx.supabase.storage.from(OFFER_IMAGES_BUCKET).list(path.slice(0, slash), { search: name, limit: 10 });
  return ((data || []) as Row[]).some((item) => item?.name === name);
}

async function put(ctx: NativeContext, path: string, data: Buffer, allowExisting: boolean) {
  const { error } = await ctx.supabase.storage.from(OFFER_IMAGES_BUCKET)
    .upload(path, data, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
  if (error && !(allowExisting && alreadyExists(error))) fail(error.message || 'Nie udało się zapisać zdjęcia.');
}

/**
 * Zdjęcie z komputera (base64, JPG/PNG/WebP do 10 MB) → WebP (dłuższy bok do `maxSide`) pod `<folder>/<prefix><uuid>.webp`.
 * Zwraca ścieżkę; zapis ścieżki w produkcie, wariancie, pakiecie lub broszurze robi wywołujący.
 */
export async function storeOfferWebp(ctx: NativeContext, data: unknown, folder: string, prefix: string, maxSide: number, quality = 0.86) {
  const bytes = Buffer.from(typeof data === 'string' ? data : '', 'base64');
  if (!bytes.length) fail('Nie wybrano zdjęcia.');
  if (bytes.length > OFFER_IMAGE_UPLOAD_MAX) fail('Zdjęcie jest za duże (ponad 10 MB).');
  const mime = sniffImage(bytes);
  if (!mime || !UPLOAD_TYPES.includes(mime)) fail('Wybierz zdjęcie JPG, PNG lub WebP.');
  const webp = (await webpVersion(bytes, maxSide, quality)).data;
  const path = `${folder}/${prefix}${randomUUID()}.webp`;
  await put(ctx, path, webp, false);
  return path;
}

/**
 * Zdjęcie z Dysku (Materiały) dla produktu, wariantu lub pakietu: oryginał zostaje w Dysku, produkt dostaje lekką wersję WebP
 * (`productMaterialImagePath` — plik i wersja treści, wspólna dla zdjęcia głównego, wariantów i pakietów tego produktu; ta sama
 * wersja drugi raz się nie zapisuje). Dostęp do pliku sprawdza baza (RLS Materiałów). Ścieżki nie wolno usuwać przy wycofaniu
 * zapisu — może jej używać inne zdjęcie produktu.
 */
export async function materialWebp(ctx: NativeContext, productId: string, fileIdValue: unknown) {
  const file = await materialFileRow(ctx, fileIdValue);
  if (file.status !== 'ready') fail('Ten plik w Dysku jest jeszcze wysyłany. Spróbuj za chwilę.');
  if (!MATERIAL_IMAGE_MIME.includes(String(file.mime_type || '').toLowerCase())) fail('Wybierz z Dysku zdjęcie JPG, PNG lub WebP.');
  if (Number(file.size_bytes || 0) > MATERIAL_IMAGE_MAX_BYTES) fail('To zdjęcie w Dysku jest za duże (ponad 60 MB).');
  const path = productMaterialImagePath(productId, String(file.id), Number(file.content_version || 1));
  if (!(await exists(ctx, path))) {
    const { data: original, error } = await ctx.supabase.storage.from('materials').download(String(file.storage_path));
    if (error || !original) fail('Nie udało się pobrać zdjęcia z Dysku. Spróbuj ponownie.');
    const webp = (await webpVersion(Buffer.from(await original!.arrayBuffer()), PRODUCT_MATERIAL_IMAGE_SIDE)).data;
    await put(ctx, path, webp, true);
  }
  return path;
}

// MARK: Zamiana starszych zdjęć JPG/PNG na WebP

type Pending = { kind: 'product' | 'variant' | 'package'; productId: string; ownerId: string; path: string; label: string };

const needsWebp = (path: unknown): path is string =>
  typeof path === 'string' && /^assets\/[^?#]+\.(?:jpe?g|png)$/i.test(path) && !path.includes('..') && !path.includes('//');
const keyOf = (item: Pending) => `${item.kind}:${item.ownerId}:${item.path}`;
const packagesOf = (row: Row) => (Array.isArray(row?.sales_packages) ? row.sales_packages as Row[] : []);

/**
 * Nowa ścieżka WebP: ten sam folder i nazwa z rozszerzeniem `.webp`; zdjęcie spoza folderu produktu (np. wspólne zdjęcie kilku
 * produktów) dostaje kopię w folderze produktu — karta produktu na Macu przyjmuje tylko zdjęcia z folderu produktu.
 */
function webpPathOf(item: Pending) {
  const base = item.path.replace(/\.(?:jpe?g|png)$/i, '.webp');
  const folder = `assets/${item.productId}/`;
  return base.startsWith(folder) ? base : `${folder}${base.slice(base.lastIndexOf('/') + 1)}`;
}

async function pendingImages(ctx: NativeContext): Promise<Pending[]> {
  const [productsRes, variantsRes] = await Promise.all([
    ctx.supabase.from('offer_products').select('id,name,offer_image_path,sales_packages').order('display_order').order('name'),
    ctx.supabase.from('offer_product_variants').select('id,product_id,name,offer_image_path,display_order')
      .not('offer_image_path', 'is', null).order('display_order'),
  ]);
  if (productsRes.error) fail(productsRes.error.message);
  if (variantsRes.error) fail(variantsRes.error.message);
  const products = (productsRes.data || []) as Row[];
  const names = new Map(products.map((row) => [String(row.id), String(row.name || 'Produkt')]));
  const list: Pending[] = [];
  products.forEach((row) => {
    const productId = String(row.id);
    if (needsWebp(row.offer_image_path)) {
      list.push({ kind: 'product', productId, ownerId: productId, path: row.offer_image_path, label: `${names.get(productId)} — zdjęcie główne` });
    }
    packagesOf(row).forEach((item) => {
      if (needsWebp(item?.image_path) && typeof item?.id === 'string' && item.id) {
        list.push({ kind: 'package', productId, ownerId: item.id, path: item.image_path, label: `${names.get(productId)} — pakiet ${String(item.name || '').trim() || 'bez nazwy'}` });
      }
    });
  });
  ((variantsRes.data || []) as Row[]).forEach((row) => {
    const productId = String(row.product_id);
    if (!names.has(productId) || !needsWebp(row.offer_image_path)) return;
    list.push({ kind: 'variant', productId, ownerId: String(row.id), path: row.offer_image_path, label: `${names.get(productId)} — ${String(row.name || 'element')}` });
  });
  return list;
}

/** Ile zdjęć produktów, wariantów i pakietów jest jeszcze w JPG/PNG. */
export async function offerImagesPending(ctx: NativeContext) {
  return { count: (await pendingImages(ctx)).length };
}

/** Kadry zdjęć (`offer_image_crops`) są zapisane po ścieżce — nowa ścieżka przejmuje kadry starej. */
async function moveCrops(ctx: NativeContext, productId: string, from: string, to: string) {
  const [productRes, variantsRes] = await Promise.all([
    ctx.supabase.from('offer_products').select('offer_image_path,offer_image_crops').eq('id', productId).maybeSingle(),
    ctx.supabase.from('offer_product_variants').select('id').eq('product_id', productId).eq('offer_image_path', from).limit(1),
  ]);
  const row = productRes.data as Row | null;
  const crops = row?.offer_image_crops && typeof row.offer_image_crops === 'object' && !Array.isArray(row.offer_image_crops)
    ? { ...(row.offer_image_crops as Row) } : null;
  if (!crops || !crops[from]) return;
  if (!crops[to]) crops[to] = crops[from];
  // Stary klucz zostaje, dopóki inne zdjęcie tego produktu wskazuje jeszcze starą ścieżkę.
  if (row!.offer_image_path !== from && !(variantsRes.data || []).length) delete crops[from];
  await ctx.supabase.from('offer_products').update({ offer_image_crops: crops }).eq('id', productId);
}

async function applyPath(ctx: NativeContext, item: Pending, next: string) {
  if (item.kind === 'product') {
    const { error } = await ctx.supabase.from('offer_products').update({ offer_image_path: next })
      .eq('id', item.productId).eq('offer_image_path', item.path);
    if (error) fail(error.message);
  } else if (item.kind === 'variant') {
    const { error } = await ctx.supabase.from('offer_product_variants').update({ offer_image_path: next })
      .eq('id', item.ownerId).eq('offer_image_path', item.path);
    if (error) fail(error.message);
  } else {
    const { data, error } = await ctx.supabase.from('offer_products').select('sales_packages').eq('id', item.productId).maybeSingle();
    if (error || !data) fail(error?.message || 'Nie znaleziono produktu.');
    let changed = false;
    const packages = packagesOf(data as Row).map((entry) => {
      if (entry?.id !== item.ownerId || entry?.image_path !== item.path) return entry;
      changed = true;
      return { ...entry, image_path: next };
    });
    if (!changed) return;
    const { error: updateError } = await ctx.supabase.from('offer_products').update({ sales_packages: packages }).eq('id', item.productId);
    if (updateError) fail(updateError.message);
  }
  await moveCrops(ctx, item.productId, item.path, next);
}

/**
 * Porcja zamiany (najwyżej `limit` zdjęć, domyślnie 4): pobranie oryginału, WebP do 1800 px, zapis obok (stary plik zostaje),
 * zmiana ścieżki w produkcie, wariancie lub pakiecie i przeniesienie kadrów. `skip` — klucze zdjęć, których nie udało się zamienić
 * w tej serii (nie próbujemy ich drugi raz). Odpowiedź: zamienione, błędy (z opisem zdjęcia) i ile jeszcze zostało.
 */
export async function convertOfferImages(ctx: NativeContext, body: Row) {
  const skip = new Set((Array.isArray(body.skip) ? body.skip : []).slice(0, 1000).map((value: unknown) => String(value)));
  const limit = Math.min(8, Math.max(1, Math.floor(Number(body.limit) || 4)));
  const batch = (await pendingImages(ctx)).filter((item) => !skip.has(keyOf(item))).slice(0, limit);
  const failed: Array<{ key: string; label: string; error: string }> = [];
  const ready = new Set<string>();
  let converted = 0;
  for (const item of batch) {
    try {
      const next = webpPathOf(item);
      if (!ready.has(next) && !(await exists(ctx, next))) {
        const { data: original, error } = await ctx.supabase.storage.from(OFFER_IMAGES_BUCKET).download(item.path);
        if (error || !original) fail('Brak pliku zdjęcia w magazynie — wgraj zdjęcie ponownie.');
        const webp = (await webpVersion(Buffer.from(await original!.arrayBuffer()), PRODUCT_MATERIAL_IMAGE_SIDE)).data;
        await put(ctx, next, webp, true);
      }
      ready.add(next);
      await applyPath(ctx, item, next);
      converted += 1;
    } catch (error) {
      failed.push({ key: keyOf(item), label: item.label, error: (error as Error)?.message || 'Nie udało się zamienić zdjęcia.' });
    }
  }
  const failedKeys = new Set(failed.map((item) => item.key));
  const remaining = (await pendingImages(ctx)).filter((item) => !skip.has(keyOf(item)) && !failedKeys.has(keyOf(item))).length;
  return { converted, failed, remaining };
}
