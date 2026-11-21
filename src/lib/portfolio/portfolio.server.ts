import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import type { NativeContext } from '@/lib/native/auth';
import { SITE } from '@/lib/SEO/site';
import { employeeNames, fail, isObject, isUuid, sniffImageType, socialAccess, text, uuidOrNull, type Row } from '@/lib/social/socialCommon.server';
import { assetImport } from '@/lib/social/socialAssets.server';
import { createPost } from '@/lib/social/socialPosts.server';
import { SOCIAL_CHANNELS, SOCIAL_LIMITS, type SocialChannel } from '@/lib/social/socialShared';
import { PORTFOLIO_AI_FIELDS, portfolioAssist, type PortfolioAiField } from './portfolioAi.server';
import { processPortfolioPhoto } from './portfolioPhotos.server';
import {
  PORTFOLIO_LIMITS, emptyPortfolioContent, isPortfolioSlug, normalizePortfolioContent, portfolioContentFromSite, portfolioKeepPhotoDetails,
  portfolioPublishProblems, portfolioSiteFields, portfolioSiteSnapshot, portfolioSlug, type PortfolioContent, type PortfolioPhoto,
  type PortfolioStatus,
} from './portfolioShared';

/*
 * Marketing → „Realizacje” (portfolio strony) na serwerze Next — jedno API dla CRM, Maca i telefonu
 * (`/bridge/native/v1/portfolio`). Kopia robocza w `marketing_portfolio_items`, publikacja do `portfolio_projects`
 * funkcjami bazy (`portfolio_item_publish` / `_adopt` / `_sync` / `_unpublish`, migracja 20261121100000). Dostęp: edycja
 * strony (`can_edit_website()`). Zdjęcia: wersje WebP w publicznym buckecie `site-images` (`portfolio/<realizacja>/…`).
 * „Utwórz post”: zdjęcia realizacji → biblioteka social media marki → szkic posta z karuzelą (Social media).
 */

const SITE_BUCKET = 'site-images';
const ITEM_FIELDS = 'id, portfolio_project_id, event_id, company_id, content, title, slug, version, published_hash, published_at, published_by, created_at, created_by, updated_at, updated_by';
const SITE_FIELDS = 'id, title, slug, category, client, location, event_date, date, description, detailed_description, meta_description, keywords, tags, image, image_url, alt, image_metadata, gallery, gallery_images, features, event_city_slug, reference_city_slugs, conference_reference_enabled, is_featured, order_index, video_url';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const contentHash = (content: PortfolioContent) => createHash('sha256').update(portfolioSiteSnapshot(content)).digest('hex');
const siteUrl = (slug: string) => `${SITE.url}/portfolio/${encodeURIComponent(slug)}`;

/** Komunikat bazy albo czytelny zamiennik. */
function check(error: { message?: string; code?: string } | null | undefined, fallback: string): void {
  if (!error) return;
  const code = error.code || '';
  const message = error.message || '';
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    fail(code === '42501' && message && !/permission denied|row-level security/i.test(message)
      ? message : 'Realizacje prowadzi osoba z uprawnieniem do edycji strony (Strona — edycja).', 403);
  }
  if (code === '40001') fail(message || 'Realizację zmieniono w innym oknie. Odśwież widok.', 409);
  if (code === 'P0002') fail(message || 'Nie znaleziono realizacji.', 404);
  if (code === '23505') fail(/Adres/.test(message) ? message : 'Taki adres ma już inna realizacja — zmień adres.', 409);
  if (code === '22023' && /posta/.test(message)) {
    fail('Tej realizacji używają opublikowane posty social media — nie można jej usunąć ze strony.', 409);
  }
  if (code === '22023' || code === '23514') fail(message || fallback, 400);
  if (code.startsWith('PGRST')) fail(fallback, 400);
  fail(message || fallback);
}

async function requireEditor(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.rpc('can_edit_website');
  if (error || data !== true) fail('Realizacje prowadzi osoba z uprawnieniem do edycji strony (Strona — edycja).', 403);
}

async function defaultCompanyId(ctx: NativeContext): Promise<string | null> {
  const { data } = await ctx.supabase.from('my_companies').select('id, is_default').order('is_default', { ascending: false }).limit(1);
  return uuidOrNull((data as Row[] | null)?.[0]?.id);
}

type ItemState = { row: Row; content: PortfolioContent; site: Row | null; status: PortfolioStatus; siteContent: PortfolioContent | null };

/**
 * Stan realizacji względem strony. Zmiana zrobiona na stronie (tryb edycji) przy kopii roboczej bez własnych zmian
 * trafia do kopii od razu; przy zmianach w obu miejscach — konflikt (wybór: wersja ze strony albo publikacja kopii).
 */
async function resolveState(ctx: NativeContext, row: Row, site: Row | null): Promise<ItemState> {
  const content = normalizePortfolioContent(row.content);
  if (!row.portfolio_project_id || !site) return { row, content, site: null, status: 'draft', siteContent: null };
  const siteContent = portfolioContentFromSite(site);
  const siteHash = contentHash(siteContent);
  const draftHash = contentHash(content);
  if (siteHash === row.published_hash) {
    return { row, content, site, status: draftHash === siteHash ? 'published' : 'changed', siteContent };
  }
  if (draftHash === row.published_hash || draftHash === siteHash) {
    const merged = portfolioKeepPhotoDetails(siteContent, content);
    const { error } = await ctx.supabase.rpc('portfolio_item_sync', { p_id: row.id, p_content: merged, p_hash: siteHash });
    if (!error) {
      const { data } = await ctx.supabase.from('marketing_portfolio_items').select(ITEM_FIELDS).eq('id', row.id).maybeSingle();
      return { row: (data as Row) || row, content: merged, site, status: 'published', siteContent };
    }
    console.warn('[portfolio] sync', error.message);
  }
  return { row, content, site, status: 'conflict', siteContent };
}

async function siteRows(ctx: NativeContext, ids: unknown[]): Promise<Map<string, Row>> {
  const unique = Array.from(new Set(ids.filter(isUuid)));
  if (!unique.length) return new Map();
  const { data, error } = await ctx.supabase.from('portfolio_projects').select(SITE_FIELDS).in('id', unique);
  check(error, 'Nie udało się pobrać realizacji ze strony.');
  return new Map(((data || []) as Row[]).map((row) => [String(row.id), row]));
}

/** Kopie robocze dla realizacji, które są już na stronie (pierwsze otwarcie „Realizacji” albo dodane w trybie edycji strony). */
async function adoptSiteProjects(ctx: NativeContext, items: Row[]) {
  const { data, error } = await ctx.supabase.from('portfolio_projects').select(SITE_FIELDS);
  check(error, 'Nie udało się pobrać realizacji ze strony.');
  const linked = new Set(items.map((item) => text(item.portfolio_project_id)).filter(Boolean));
  const missing = ((data || []) as Row[]).filter((row) => !linked.has(String(row.id)));
  if (!missing.length) return false;
  const companyId = await defaultCompanyId(ctx);
  for (const row of missing) {
    const content = portfolioContentFromSite(row);
    const { error: adoptError } = await ctx.supabase.rpc('portfolio_item_adopt', {
      p_project: row.id, p_content: content, p_hash: contentHash(content), p_company: companyId,
    });
    if (adoptError && adoptError.code !== '23505') console.warn('[portfolio] adopt', adoptError.message);
  }
  return true;
}

const photoCount = (content: PortfolioContent) => content.gallery.length + (content.image ? 1 : 0);

function listItemDTO(state: ItemState, events: Map<string, Row>) {
  const { row, content, status } = state;
  const event = row.event_id ? events.get(String(row.event_id)) : null;
  const published = status !== 'draft' ? text(state.site?.slug) || content.slug : null;
  return {
    id: String(row.id),
    title: content.title || 'Realizacja bez tytułu',
    slug: content.slug,
    status,
    category: content.category,
    location: content.location,
    eventDate: content.eventDate,
    thumbnailUrl: content.image?.thumb || content.gallery[0]?.thumb || null,
    photos: photoCount(content),
    isFeatured: content.isFeatured,
    orderIndex: content.orderIndex,
    eventId: uuidOrNull(row.event_id),
    eventName: event ? text(event.name) || null : null,
    siteUrl: published ? siteUrl(published) : null,
    publishedAt: text(row.published_at) || null,
    updatedAt: text(row.updated_at),
    problems: portfolioPublishProblems(content).length,
  };
}

async function eventsById(ctx: NativeContext, ids: unknown[]) {
  const unique = Array.from(new Set(ids.filter(isUuid)));
  if (!unique.length) return new Map<string, Row>();
  const { data } = await ctx.supabase.from('events')
    .select('id, name, event_date, location, category:event_categories(name), venue:locations(name, city)').in('id', unique);
  return new Map(((data || []) as Row[]).map((row) => [String(row.id), row]));
}

const eventDTO = (row: Row | null | undefined) => {
  if (!row) return null;
  const venue = isObject(row.venue) ? row.venue : null;
  return {
    id: String(row.id),
    name: text(row.name) || 'Wydarzenie',
    date: text(row.event_date) || null,
    location: venue ? [text(venue.name), text(venue.city)].filter(Boolean).join(', ') : text(row.location),
    category: isObject(row.category) ? text(row.category.name) || null : null,
  };
};

/** Lista realizacji (kopie robocze + stan publikacji), kategorie i miasta do formularza. */
export async function portfolioHome(ctx: NativeContext) {
  await requireEditor(ctx);
  let { data, error } = await ctx.supabase.from('marketing_portfolio_items').select(ITEM_FIELDS).order('updated_at', { ascending: false });
  check(error, 'Nie udało się pobrać realizacji.');
  if (await adoptSiteProjects(ctx, (data || []) as Row[])) {
    ({ data, error } = await ctx.supabase.from('marketing_portfolio_items').select(ITEM_FIELDS).order('updated_at', { ascending: false }));
    check(error, 'Nie udało się pobrać realizacji.');
  }
  const rows = (data || []) as Row[];
  const [sites, events, cities] = await Promise.all([
    siteRows(ctx, rows.map((row) => row.portfolio_project_id)),
    eventsById(ctx, rows.map((row) => row.event_id)),
    portfolioCities(ctx),
  ]);
  const states = await Promise.all(rows.map((row) => resolveState(ctx, row, sites.get(text(row.portfolio_project_id)) || null)));
  const items = states.map((state) => listItemDTO(state, events));
  const categories = Array.from(new Set(states.map((state) => state.content.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pl'));
  return {
    items,
    categories,
    cities,
    counts: {
      draft: items.filter((item) => item.status === 'draft').length,
      published: items.filter((item) => item.status !== 'draft').length,
      changed: items.filter((item) => item.status === 'changed' || item.status === 'conflict').length,
    },
    siteUrl: `${SITE.url}/portfolio`,
  };
}

async function portfolioCities(ctx: NativeContext) {
  const { data } = await ctx.supabase.from('schema_org_places').select('locality, name').eq('is_global', true).order('name');
  return ((data || []) as Row[])
    .filter((row) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(text(row.locality)))
    .map((row) => ({ locality: text(row.locality), name: text(row.name) || text(row.locality) }));
}

async function itemRow(ctx: NativeContext, id: unknown): Promise<Row> {
  if (!isUuid(id)) fail('Nie znaleziono realizacji.', 404);
  const { data, error } = await ctx.supabase.from('marketing_portfolio_items').select(ITEM_FIELDS).eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać realizacji.');
  if (!data) fail('Nie znaleziono realizacji.', 404);
  return data as Row;
}

async function itemState(ctx: NativeContext, row: Row): Promise<ItemState> {
  const sites = await siteRows(ctx, [row.portfolio_project_id]);
  return resolveState(ctx, row, sites.get(text(row.portfolio_project_id)) || null);
}

/** Karta realizacji: kopia robocza, stan publikacji, wydarzenie, osoby i (przy konflikcie) wersja ze strony. */
async function detailDTO(ctx: NativeContext, state: ItemState) {
  const { row, content, status } = state;
  const [events, names] = await Promise.all([
    eventsById(ctx, [row.event_id]),
    employeeNames(ctx.supabase, [row.created_by, row.updated_by, row.published_by]),
  ]);
  const name = (id: unknown) => (isUuid(id) ? names.get(id.toLowerCase()) || null : null);
  const publishedSlug = state.site ? text(state.site.slug) : null;
  return {
    item: {
      id: String(row.id),
      version: Number(row.version) || 1,
      status,
      content,
      eventId: uuidOrNull(row.event_id),
      companyId: uuidOrNull(row.company_id),
      portfolioProjectId: state.site ? String(state.site.id) : null,
      publishedSlug,
      siteUrl: publishedSlug ? siteUrl(publishedSlug) : null,
      publishedAt: text(row.published_at) || null,
      publishedByName: name(row.published_by),
      createdAt: text(row.created_at),
      createdByName: name(row.created_by),
      updatedAt: text(row.updated_at),
      updatedByName: name(row.updated_by),
      problems: portfolioPublishProblems(content),
      siteContent: status === 'conflict' ? state.siteContent : null,
    },
    event: eventDTO(events.get(text(row.event_id))),
  };
}

export async function portfolioItem(ctx: NativeContext, id: string) {
  await requireEditor(ctx);
  return detailDTO(ctx, await itemState(ctx, await itemRow(ctx, id)));
}

/** Wolny adres (`base`, `base-2`, …) wśród kopii roboczych i realizacji na stronie. */
async function freeSlug(ctx: NativeContext, base: string, exceptItem?: string) {
  const root = isPortfolioSlug(base) ? base : portfolioSlug(base) || 'realizacja';
  const [items, sites] = await Promise.all([
    ctx.supabase.from('marketing_portfolio_items').select('id, slug').like('slug', `${root}%`),
    ctx.supabase.from('portfolio_projects').select('slug').like('slug', `${root}%`),
  ]);
  const taken = new Set([
    ...((items.data || []) as Row[]).filter((row) => String(row.id) !== exceptItem).map((row) => text(row.slug)),
    ...((sites.data || []) as Row[]).map((row) => text(row.slug)),
  ]);
  if (!taken.has(root)) return root;
  for (let index = 2; index < 500; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${root.slice(0, PORTFOLIO_LIMITS.slug - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${root.slice(0, 80)}-${randomBytes(3).toString('hex')}`;
}

/** Nowa realizacja (szkic) — pusta albo z danymi wydarzenia (nazwa, data, miejsce). */
export async function portfolioCreate(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const content = emptyPortfolioContent();
  const eventId = uuidOrNull(body.eventId);
  if (eventId) {
    const event = eventDTO((await eventsById(ctx, [eventId])).get(eventId));
    if (!event) fail('Nie znaleziono wydarzenia.', 404);
    content.title = event.name.slice(0, PORTFOLIO_LIMITS.title);
    content.eventDate = event.date ? event.date.slice(0, 10) : null;
    content.location = event.location.slice(0, PORTFOLIO_LIMITS.location);
    content.category = (event.category || '').slice(0, PORTFOLIO_LIMITS.category);
  }
  const title = text(body.title).trim();
  if (title) content.title = title.slice(0, PORTFOLIO_LIMITS.title);
  if (!content.title) content.title = 'Nowa realizacja';
  content.slug = await freeSlug(ctx, content.title);
  const normalized = normalizePortfolioContent(content);
  const { data, error } = await ctx.supabase.from('marketing_portfolio_items')
    .insert({ content: normalized, event_id: eventId, company_id: await defaultCompanyId(ctx) }).select(ITEM_FIELDS).single();
  check(error, 'Nie udało się utworzyć realizacji.');
  return detailDTO(ctx, await itemState(ctx, data as Row));
}

/** Zapis kopii roboczej (wersja chroni przed nadpisaniem zmian z innego okna). Adres opublikowanej realizacji się nie zmienia. */
export async function portfolioSave(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, body.id);
  const version = Number(body.version);
  if (!Number.isInteger(version) || version !== Number(row.version)) fail('Realizację zmieniono w innym oknie. Odśwież widok — Twoje zmiany nie zostały zapisane.', 409);
  const content = normalizePortfolioContent(body.content);
  if (!isPortfolioSlug(content.slug)) fail('Podaj adres realizacji: małe litery, cyfry i myślniki.', 400);
  if (!content.title) fail('Podaj tytuł realizacji.', 400);
  if (row.portfolio_project_id) {
    const site = (await siteRows(ctx, [row.portfolio_project_id])).get(String(row.portfolio_project_id));
    if (site && text(site.slug) !== content.slug) fail('Adres opublikowanej realizacji się nie zmienia (linki i pozycja w Google).', 400);
  }
  const { data: taken } = await ctx.supabase.from('portfolio_projects').select('id').eq('slug', content.slug)
    .neq('id', row.portfolio_project_id || '00000000-0000-0000-0000-000000000000').limit(1);
  if ((taken || []).length) fail(`Adres „${content.slug}” ma już inna realizacja na stronie — zmień adres.`, 409);
  const patch: Row = { content };
  if ('eventId' in body) patch.event_id = uuidOrNull(body.eventId);
  const { data, error } = await ctx.supabase.from('marketing_portfolio_items').update(patch)
    .eq('id', row.id).eq('version', version).select(ITEM_FIELDS);
  check(error, 'Nie udało się zapisać realizacji.');
  if (!data?.length) fail('Realizację zmieniono w innym oknie. Odśwież widok — Twoje zmiany nie zostały zapisane.', 409);
  return detailDTO(ctx, await itemState(ctx, data[0] as Row));
}

/**
 * Publikacja kopii roboczej na stronie (nowa realizacja albo zmiany). Przy konflikcie (zmiany także na stronie) —
 * tylko z `overwrite: true`. Skrót liczony z treści po zapisie na stronie (to, co strona odczyta z powrotem).
 */
export async function portfolioPublish(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, body.id);
  const version = Number(body.version);
  if (version !== Number(row.version)) fail('Realizację zmieniono w innym oknie. Odśwież widok — publikacja nie została wykonana.', 409);
  const state = await itemState(ctx, row);
  if (state.status === 'conflict' && body.overwrite !== true) {
    fail('Tę realizację zmieniono także na stronie. Pobierz wersję ze strony albo opublikuj swoją, zastępując zmiany na stronie.', 409);
  }
  const problems = portfolioPublishProblems(state.content);
  if (problems.length) fail(`Uzupełnij przed publikacją: ${problems.join(' ')}`, 422);
  const fields = portfolioSiteFields(state.content, state.site);
  const published = portfolioContentFromSite({ ...fields, event_date: fields.event_date || null });
  const publishedHash = contentHash(published);
  const { error } = await ctx.supabase.rpc('portfolio_item_publish', {
    p_id: row.id, p_version: Number(state.row.version), p_site: fields, p_hash: publishedHash,
  });
  check(error, 'Nie udało się opublikować realizacji.');
  // Kopia robocza = treść na stronie (gdyby zapis na stronie coś znormalizował inaczej).
  if (contentHash(state.content) !== publishedHash) {
    const { error: syncError } = await ctx.supabase.rpc('portfolio_item_sync', {
      p_id: row.id, p_content: portfolioKeepPhotoDetails(published, state.content), p_hash: publishedHash,
    });
    if (syncError) console.warn('[portfolio] publish sync', syncError.message);
  }
  return detailDTO(ctx, await itemState(ctx, await itemRow(ctx, row.id)));
}

/** Kopia robocza = wersja ze strony (odrzucenie niepublikowanych zmian albo rozwiązanie konfliktu). */
export async function portfolioDiscard(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, body.id);
  const state = await itemState(ctx, row);
  if (!state.site || !state.siteContent) fail('Realizacji nie ma jeszcze na stronie.', 400);
  const merged = portfolioKeepPhotoDetails(state.siteContent, state.content);
  const { error } = await ctx.supabase.rpc('portfolio_item_sync', { p_id: row.id, p_content: merged, p_hash: contentHash(state.siteContent) });
  check(error, 'Nie udało się pobrać wersji ze strony.');
  return detailDTO(ctx, await itemState(ctx, await itemRow(ctx, row.id)));
}

/** Usunięcie realizacji ze strony (kopia robocza zostaje jako szkic). */
export async function portfolioUnpublish(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, body.id);
  const { error } = await ctx.supabase.rpc('portfolio_item_unpublish', { p_id: row.id, p_version: Number(body.version) });
  check(error, 'Nie udało się usunąć realizacji ze strony.');
  return detailDTO(ctx, await itemState(ctx, await itemRow(ctx, row.id)));
}

/** Usunięcie kopii roboczej; realizacja na stronie — tylko razem z nią (`removeFromSite: true`). */
export async function portfolioDelete(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, body.id);
  if (row.portfolio_project_id) {
    if (body.removeFromSite !== true) fail('Ta realizacja jest na stronie — potwierdź usunięcie także ze strony.', 409);
    const { error } = await ctx.supabase.rpc('portfolio_item_unpublish', { p_id: row.id, p_version: Number(body.version) });
    check(error, 'Nie udało się usunąć realizacji ze strony.');
  }
  const { error } = await ctx.supabase.from('marketing_portfolio_items').delete().eq('id', row.id);
  check(error, 'Nie udało się usunąć realizacji.');
  return { deleted: String(row.id) };
}

// Zdjęcia ------------------------------------------------------------------------------------------------------------------

/** Zdjęcie do kopii roboczej: trzy wersje WebP w `site-images/portfolio/<realizacja>/`. Kreator dodaje je do galerii. */
async function storePhoto(ctx: NativeContext, itemId: string, bytes: Buffer, alt: string): Promise<PortfolioPhoto> {
  if (bytes.length > PORTFOLIO_LIMITS.uploadBytes) fail('Zdjęcie może mieć najwyżej 40 MB.', 413);
  const type = sniffImageType(bytes);
  if (!type) fail('Ten plik nie jest zdjęciem JPEG, PNG ani WebP.', 415);
  const processed = await processPortfolioPhoto(bytes, type);
  const base = `portfolio/${itemId}/${Date.now()}-${randomBytes(4).toString('hex')}`;
  const upload = async (suffix: string, data: Buffer) => {
    const path = `${base}-${suffix}.webp`;
    const { error } = await ctx.supabase.storage.from(SITE_BUCKET).upload(path, data, { contentType: 'image/webp', cacheControl: '31536000', upsert: false });
    if (error) {
      console.error('[portfolio] upload', error.message);
      fail('Nie udało się zapisać zdjęcia na stronie.', 502);
    }
    return ctx.supabase.storage.from(SITE_BUCKET).getPublicUrl(path).data.publicUrl;
  };
  const [src, mobile, thumb] = await Promise.all([upload('desktop', processed.desktop), upload('mobile', processed.mobile), upload('thumb', processed.thumb)]);
  return { src, mobile, thumb, alt: alt.trim().replace(/\s+/g, ' ').slice(0, PORTFOLIO_LIMITS.alt), width: processed.width, height: processed.height };
}

/** Zdjęcie wysłane z dysku albo telefonu (`POST ?op=upload&id=<realizacja>`). */
export async function portfolioUpload(ctx: NativeContext, id: string, bytes: Buffer) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, id);
  return { photo: await storePhoto(ctx, String(row.id), bytes, '') };
}

async function download(ctx: NativeContext, bucket: string, path: string, size: unknown) {
  if (Number(size) > PORTFOLIO_LIMITS.uploadBytes) fail('Zdjęcie może mieć najwyżej 40 MB.', 413);
  const { data, error } = await ctx.supabase.storage.from(bucket).download(path);
  if (error || !data) fail('Nie udało się pobrać zdjęcia.', 502);
  return Buffer.from(await data.arrayBuffer());
}

/** Zdjęcie z plików wydarzenia, Materiałów albo biblioteki social media (uprawnienia do źródła sprawdza baza). */
export async function portfolioImport(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, body.id);
  const fileId = uuidOrNull(body.fileId);
  if (!fileId) fail('Wybierz zdjęcie.', 400);
  let bytes: Buffer;
  if (body.source === 'event') {
    const { data: file, error } = await ctx.supabase.from('event_files').select('file_path, mime_type, file_size').eq('id', fileId).maybeSingle();
    check(error, 'Nie udało się pobrać pliku wydarzenia.');
    if (!file || !IMAGE_TYPES.includes(text(file.mime_type))) fail('Nie znaleziono zdjęcia w plikach wydarzenia.', 404);
    bytes = await download(ctx, 'event-files', String(file.file_path), file.file_size);
  } else if (body.source === 'material') {
    const { data: file, error } = await ctx.supabase.from('material_files').select('storage_path, mime_type, size_bytes, status').eq('id', fileId).maybeSingle();
    if (error) fail('Materiały nie są jeszcze dostępne albo nie masz do nich dostępu.', 403);
    if (!file || file.status !== 'ready' || !IMAGE_TYPES.includes(text(file.mime_type))) fail('Nie znaleziono zdjęcia w Materiałach.', 404);
    bytes = await download(ctx, 'materials', String(file.storage_path), file.size_bytes);
  } else if (body.source === 'social') {
    const { data: asset, error } = await ctx.supabase.from('social_assets').select('work_path, storage_path, status').eq('id', fileId).maybeSingle();
    if (error) fail('Biblioteka social media nie jest dostępna.', 403);
    if (!asset || !['ready', 'proposed'].includes(text(asset.status))) fail('Nie znaleziono zdjęcia w bibliotece social media.', 404);
    bytes = await download(ctx, 'social-media', text(asset.work_path) || String(asset.storage_path), 0);
  } else {
    fail('Nieznane źródło zdjęcia.', 400);
  }
  return { photo: await storePhoto(ctx, String(row.id), bytes, text(body.alt)) };
}

async function signed(ctx: NativeContext, bucket: string, paths: string[]) {
  const urls = new Map<string, string>();
  const unique = Array.from(new Set(paths.filter(Boolean)));
  for (let start = 0; start < unique.length; start += 100) {
    const { data } = await ctx.supabase.storage.from(bucket).createSignedUrls(unique.slice(start, start + 100), 3600);
    for (const item of data || []) if (item?.signedUrl && item.path) urls.set(item.path, item.signedUrl);
  }
  return urls;
}

/** Zdjęcia do wyboru: pliki wydarzenia, Materiały (z wyszukiwaniem) albo biblioteka social media. */
export async function portfolioPhotos(ctx: NativeContext, params: URLSearchParams) {
  await requireEditor(ctx);
  const source = params.get('source');
  const q = text(params.get('q')).trim().slice(0, 80).replace(/[%,()]/g, ' ');
  if (source === 'event') {
    const eventId = uuidOrNull(params.get('event'));
    if (!eventId) return { source, photos: [] };
    const { data, error } = await ctx.supabase.from('event_files').select('id, name, original_name, file_path, mime_type, file_size, created_at')
      .eq('event_id', eventId).in('mime_type', IMAGE_TYPES).order('created_at', { ascending: false }).limit(150);
    check(error, 'Nie udało się pobrać plików wydarzenia.');
    const rows = (data || []) as Row[];
    const urls = await signed(ctx, 'event-files', rows.map((row) => text(row.file_path)));
    return {
      source,
      photos: rows.map((row) => ({
        id: String(row.id), name: text(row.original_name) || text(row.name) || 'Zdjęcie', thumbnailUrl: urls.get(text(row.file_path)) || null,
        width: null, height: null, bytes: Number(row.file_size) || null,
      })),
    };
  }
  if (source === 'material') {
    let query = ctx.supabase.from('material_files').select('id, name, storage_path, thumbnail_path, width, height, size_bytes')
      .eq('status', 'ready').in('mime_type', IMAGE_TYPES).order('updated_at', { ascending: false }).limit(150);
    if (q) query = query.ilike('name', `%${q}%`);
    const { data, error } = await query;
    if (error) return { source, photos: [], problem: 'Materiały nie są jeszcze dostępne albo nie masz do nich dostępu.' };
    const rows = (data || []) as Row[];
    const urls = await signed(ctx, 'materials', rows.map((row) => text(row.thumbnail_path) || text(row.storage_path)));
    return {
      source,
      photos: rows.map((row) => ({
        id: String(row.id), name: text(row.name) || 'Zdjęcie', thumbnailUrl: urls.get(text(row.thumbnail_path) || text(row.storage_path)) || null,
        width: Number(row.width) || null, height: Number(row.height) || null, bytes: Number(row.size_bytes) || null,
      })),
    };
  }
  if (source === 'social') {
    let query = ctx.supabase.from('social_assets').select('id, title, original_name, thumbnail_path, width, height, bytes')
      .in('status', ['ready', 'proposed']).order('updated_at', { ascending: false }).limit(150);
    if (q) query = query.or(`title.ilike.%${q}%,original_name.ilike.%${q}%`);
    const { data, error } = await query;
    if (error) return { source, photos: [], problem: 'Biblioteka social media nie jest dostępna.' };
    const rows = (data || []) as Row[];
    const urls = await signed(ctx, 'social-media', rows.map((row) => text(row.thumbnail_path)));
    return {
      source,
      photos: rows.map((row) => ({
        id: String(row.id), name: text(row.title) || text(row.original_name) || 'Zdjęcie', thumbnailUrl: urls.get(text(row.thumbnail_path)) || null,
        width: Number(row.width) || null, height: Number(row.height) || null, bytes: Number(row.bytes) || null,
      })),
    };
  }
  fail('Nieznane źródło zdjęć.', 400);
}

/** Wydarzenia do powiązania z realizacją (wyszukiwanie po nazwie, najnowsze najpierw). */
export async function portfolioEvents(ctx: NativeContext, params: URLSearchParams) {
  await requireEditor(ctx);
  const q = text(params.get('q')).trim().slice(0, 80).replace(/[%,()]/g, ' ');
  let query = ctx.supabase.from('events').select('id, name, event_date, location, category:event_categories(name), venue:locations(name, city)')
    .order('event_date', { ascending: false }).limit(40);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data, error } = await query;
  check(error, 'Nie udało się pobrać wydarzeń.');
  return { events: ((data || []) as Row[]).map((row) => eventDTO(row)) };
}

/** Asystent AI: propozycje tekstów do niezapisanej treści z kreatora (wynik nie jest zapisywany). */
export async function portfolioAi(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, body.id);
  const content = normalizePortfolioContent(isObject(body.content) ? body.content : row.content);
  const fields = (Array.isArray(body.fields) ? body.fields : PORTFOLIO_AI_FIELDS)
    .filter((field: unknown): field is PortfolioAiField => PORTFOLIO_AI_FIELDS.includes(field as PortfolioAiField));
  const eventId = 'eventId' in body ? uuidOrNull(body.eventId) : uuidOrNull(row.event_id);
  const event = eventId ? (await eventsById(ctx, [eventId])).get(eventId) : null;
  const venue = event && isObject(event.venue) ? event.venue : null;
  let cityName: string | null = null;
  if (content.eventCitySlug) {
    const { data } = await ctx.supabase.from('schema_org_places').select('name').eq('is_global', true).eq('locality', content.eventCitySlug).limit(1).maybeSingle();
    cityName = text(data?.name) || null;
  }
  const photos = body.usePhotos === true || fields.includes('alts')
    ? [...(content.image ? [content.image] : []), ...content.gallery].slice(0, 12).map((photo, index) => ({ index: index + 1, url: photo.thumb, src: photo.src }))
    : [];
  return portfolioAssist({
    content,
    brief: text(body.brief).trim().slice(0, 1500),
    event: event ? {
      name: text(event.name),
      category: isObject(event.category) ? text(event.category.name) || null : null,
      venue: venue ? text(venue.name) || null : null,
      city: venue ? text(venue.city) || null : null,
      date: text(event.event_date) || null,
    } : null,
    cityName,
    fields,
    photos,
  });
}

// Social media ----------------------------------------------------------------------------------------------------------

/**
 * „Utwórz post” z realizacji: wybrane zdjęcia (domyślnie główne i galeria, najwyżej 10) trafiają do biblioteki social media
 * marki (zdjęcie już w bibliotece — bez kopii), powstaje szkic posta: okładka z tytułem realizacji i napisem „Realizacja”,
 * kolejne zdjęcia jako karuzela, opis z krótkiego opisu (z linkiem do strony, gdy realizacja jest opublikowana), hashtagi
 * ze słów kluczowych, wydarzenie i realizacja na stronie. Wymaga uprawnienia „Social media — tworzenie” w tej marce.
 */
export async function portfolioSocialPost(ctx: NativeContext, body: Row) {
  await requireEditor(ctx);
  const row = await itemRow(ctx, body.id);
  const content = normalizePortfolioContent(row.content);
  const photos = [...(content.image ? [content.image] : []), ...content.gallery];
  const wanted = Array.isArray(body.photos) ? body.photos.map(text) : photos.map((photo) => photo.src);
  const sources = Array.from(new Set(wanted.filter((src: string) => photos.some((photo) => photo.src === src)))).slice(0, SOCIAL_LIMITS.slides + 1);
  if (!sources.length) fail('Dodaj zdjęcia do realizacji, żeby utworzyć post.', 400);
  const companyId = uuidOrNull(body.companyId) || uuidOrNull(row.company_id) || await defaultCompanyId(ctx);
  if (!companyId) fail('Wybierz markę.', 400);
  const access = await socialAccess(ctx, companyId);
  if (!access.create) fail('Post w social media tworzy osoba z uprawnieniem „Social media — tworzenie” w tej marce.', 403);
  const assetIds: string[] = [];
  for (const src of sources) {
    const result = (await assetImport(ctx, { companyId, portfolioItemId: row.id, imageUrl: src })) as Row;
    const id = uuidOrNull(result.duplicateOf) || uuidOrNull(isObject(result.asset) ? result.asset.id : null);
    if (id && !assetIds.includes(id)) assetIds.push(id);
  }
  if (!assetIds.length) fail('Nie udało się dodać zdjęć do biblioteki social media.', 502);
  const channels: SocialChannel[] = Array.isArray(body.channels) && body.channels.some((channel: unknown) => SOCIAL_CHANNELS.includes(channel as SocialChannel))
    ? SOCIAL_CHANNELS.filter((channel) => (body.channels as unknown[]).includes(channel))
    : ['instagram_feed', 'facebook_feed'];
  const publishedSlug = row.portfolio_project_id ? content.slug : '';
  const caption = [content.description.trim(), publishedSlug ? `Więcej: ${siteUrl(publishedSlug)}` : ''].filter(Boolean).join('\n\n');
  const hashtags = content.keywords.map((keyword) => keyword.toLocaleLowerCase('pl').replace(/[^\p{L}\p{N}]+/gu, '')).filter((tag) => tag.length > 1).slice(0, 10);
  const detail = await createPost(ctx, {
    companyId,
    title: `Realizacja: ${content.title}`,
    channels,
    caption,
    hashtags,
    eventId: uuidOrNull(row.event_id),
    portfolioProjectId: uuidOrNull(row.portfolio_project_id),
    assetId: assetIds[0],
    slides: assetIds.slice(1).map((assetId) => ({ assetId })),
    headline: content.title.slice(0, SOCIAL_LIMITS.headline),
    subline: content.location.slice(0, SOCIAL_LIMITS.subline),
    kicker: 'Realizacja',
  });
  return { postId: detail.post.id, companyId, photos: assetIds.length };
}
