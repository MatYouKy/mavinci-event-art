import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from '@/lib/native/auth';
import { analyzeSocialImage } from './socialAnalyze.server';
import {
  check, downloadSocialFile, employeeNames, fail, fetchPublicStorageFile, isObject, isOwnPublicStorageUrl, isUuid,
  removeSocialFiles, requireAccess, signedUrls, sniffImageType, socialAccess, socialCompanies, text, uploadSocialFile, uuidOrNull,
  type Row,
} from './socialCommon.server';
import {
  SOCIAL_CONSENT_PLATFORMS, SOCIAL_CONSENT_STATUSES, SOCIAL_LIMITS, SOCIAL_UPLOAD_TYPES, type SocialAccess, type SocialAssetSource,
  type SocialAssetStatus, type SocialConsentSource, type SocialConsentStatus, type SocialCrops,
} from './socialShared';

/*
 * Biblioteka social media: zdjęcia marki z powiązaniem z wydarzeniem / realizacją i statusem zgody klienta.
 * Wgrywanie: `assetCreate` (wpis „wgrywanie” i ścieżka) → aplikacja wgrywa plik do `social-media` tokenem pracownika →
 * `assetFinish` (analiza w Chromium: wymiary, wersja robocza, miniatura, kadry; duplikat — usunięcie i wskazanie istniejącego).
 * Import z plików wydarzenia i z realizacji na stronie — serwer kopiuje plik i analizuje. Członek zespołu wydarzenia
 * (bez uprawnień social media) dodaje zdjęcie jako propozycję. Zgoda: zdjęcie → wydarzenie → klient (`social_asset_consent`).
 */

export const ASSET_FIELDS = 'id, company_id, kind, source, status, storage_path, work_path, thumbnail_path, original_name, mime_type, bytes, width, height, content_sha256, title, note, event_id, portfolio_project_id, organization_id, visible_brands, consent_status, consent_channels, consent_note, consent_by, consent_at, crops, created_by, created_at, updated_at, consent:social_asset_consent';

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export type SocialConsentState = { status: string; channels: string[]; source: SocialConsentSource };

export type SocialAssetDTO = {
  id: string;
  companyId: string;
  kind: string;
  source: SocialAssetSource;
  status: SocialAssetStatus;
  title: string;
  note: string;
  originalName: string;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  workUrl: string | null;
  crops: SocialCrops;
  eventId: string | null;
  eventName: string | null;
  eventDate: string | null;
  organizationId: string | null;
  organizationName: string | null;
  portfolioProjectId: string | null;
  portfolioTitle: string | null;
  visibleBrands: string[];
  consentStatus: SocialConsentStatus;
  consentChannels: string[];
  consentNote: string;
  consentBy: string | null;
  consentAt: string | null;
  consent: SocialConsentState;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  usedIn: number;
};

const list = (value: unknown) => (Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : []);

function consentState(value: unknown): SocialConsentState {
  const row = isObject(value) ? value : {};
  const source = text(row.source);
  return {
    status: text(row.status) || 'unknown',
    channels: list(row.channels),
    source: (['asset', 'event', 'organization', 'none'].includes(source) ? source : 'none') as SocialConsentSource,
  };
}

/** Wiersze `social_assets` → DTO z nazwami, linkami i liczbą postów. */
export async function assetDTOs(ctx: NativeContext, rows: Row[], options: { work?: boolean } = {}): Promise<SocialAssetDTO[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.id));
  const eventIds = Array.from(new Set(rows.map((row) => row.event_id).filter(isUuid)));
  const portfolioIds = Array.from(new Set(rows.map((row) => row.portfolio_project_id).filter(isUuid)));
  const { data: eventData } = eventIds.length
    ? await ctx.supabase.from('events').select('id, name, event_date, organization_id').in('id', eventIds)
    : { data: [] as Row[] };
  const eventOrganization = new Map(((eventData || []) as Row[]).map((row) => [String(row.id), uuidOrNull(row.organization_id)]));
  // Klient zdjęcia: wskazany przy zdjęciu albo klient wydarzenia (zgoda klienta jest domyślna dla jego wydarzeń).
  const clientOf = (row: Row) => uuidOrNull(row.organization_id) || eventOrganization.get(text(row.event_id)) || null;
  const organizationIds = Array.from(new Set(rows.map(clientOf).filter((id): id is string => Boolean(id))));
  const [events, organizations, portfolio, usage, names, urls, slideUsage, slotUsage] = await Promise.all([
    Promise.resolve({ data: eventData }),
    organizationIds.length ? ctx.supabase.from('organizations').select('id, name').in('id', organizationIds) : Promise.resolve({ data: [] }),
    portfolioIds.length ? ctx.supabase.from('portfolio_projects').select('id, title').in('id', portfolioIds) : Promise.resolve({ data: [] }),
    ctx.supabase.from('social_post_variants').select('asset_id, post_id').in('asset_id', ids),
    employeeNames(ctx.supabase, rows.map((row) => row.created_by)),
    signedUrls(ctx.supabase, rows.flatMap((row) => [row.thumbnail_path, options.work ? row.work_path : null])),
    ctx.supabase.from('social_post_slides').select('asset_id, post_id').in('asset_id', ids),
    ctx.supabase.from('social_post_slots').select('asset_id, post_id').in('asset_id', ids),
  ]);
  const map = (data: unknown) => new Map(((data || []) as Row[]).map((row) => [String(row.id), row]));
  const eventRows = map(events.data);
  const organizationRows = map(organizations.data);
  const portfolioRows = map(portfolio.data);
  const used = new Map<string, Set<string>>();
  for (const row of [...((usage.data || []) as Row[]), ...((slideUsage.data || []) as Row[]), ...((slotUsage.data || []) as Row[])]) {
    const set = used.get(String(row.asset_id)) || new Set<string>();
    set.add(String(row.post_id));
    used.set(String(row.asset_id), set);
  }
  return rows.map((row) => {
    const event = eventRows.get(text(row.event_id));
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      kind: text(row.kind) || 'photo',
      source: (text(row.source) || 'upload') as SocialAssetSource,
      status: (text(row.status) || 'ready') as SocialAssetStatus,
      title: text(row.title),
      note: text(row.note),
      originalName: text(row.original_name),
      width: Number(row.width) || null,
      height: Number(row.height) || null,
      thumbnailUrl: row.thumbnail_path ? urls.get(row.thumbnail_path) || null : null,
      workUrl: options.work && row.work_path ? urls.get(row.work_path) || null : null,
      crops: isObject(row.crops) ? (row.crops as SocialCrops) : {},
      eventId: uuidOrNull(row.event_id),
      eventName: event ? text(event.name) : null,
      eventDate: event ? text(event.event_date) || null : null,
      organizationId: clientOf(row),
      organizationName: organizationRows.get(text(clientOf(row)))?.name ?? null,
      portfolioProjectId: uuidOrNull(row.portfolio_project_id),
      portfolioTitle: portfolioRows.get(text(row.portfolio_project_id))?.title ?? null,
      visibleBrands: list(row.visible_brands),
      consentStatus: (text(row.consent_status) || 'inherit') as SocialConsentStatus,
      consentChannels: list(row.consent_channels),
      consentNote: text(row.consent_note),
      consentBy: uuidOrNull(row.consent_by),
      consentAt: text(row.consent_at) || null,
      consent: consentState(row.consent),
      createdBy: uuidOrNull(row.created_by),
      createdByName: row.created_by ? names.get(String(row.created_by).toLowerCase()) || null : null,
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
      usedIn: used.get(String(row.id))?.size || 0,
    };
  });
}

async function companyFor(ctx: NativeContext, companyId: unknown) {
  const companies = await socialCompanies(ctx);
  const company = companies.find((item) => item.id === uuidOrNull(companyId)) || companies[0];
  if (!company) fail('Nie masz dostępu do social media.', 403);
  return { company, companies };
}

/** Biblioteka marki z filtrami: status, wydarzenie, zgoda, użycie, wyszukiwanie. */
export async function libraryList(ctx: NativeContext, params: URLSearchParams) {
  const { company, companies } = await companyFor(ctx, params.get('company'));
  const access = await requireAccess(ctx, company.id, 'view');
  const status = params.get('status') || 'ready';
  const limit = Math.min(200, Math.max(10, Number(params.get('limit')) || 60));
  const offset = Math.max(0, Number(params.get('offset')) || 0);
  let query = ctx.supabase.from('social_assets').select(ASSET_FIELDS, { count: 'exact' }).eq('company_id', company.id);
  if (status === 'all') query = query.neq('status', 'uploading');
  else if (['ready', 'proposed', 'archived'].includes(status)) query = query.eq('status', status);
  const eventId = uuidOrNull(params.get('event'));
  if (eventId) query = query.eq('event_id', eventId);
  const q = (params.get('q') || '').trim().slice(0, 80).replace(/[%,()]/g, ' ');
  if (q) query = query.or(`title.ilike.%${q}%,original_name.ilike.%${q}%,note.ilike.%${q}%`);
  const consent = params.get('consent');
  const used = params.get('used');
  // Filtry zgody i użycia liczone po stronie serwera Next — wtedy do 500 najnowszych zdjęć, stronicowanie po filtrze.
  const filtered = consent === 'ok' || consent === 'missing' || used === 'used' || used === 'unused';
  const { data, error, count } = await query.order('created_at', { ascending: false })
    .range(filtered ? 0 : offset, filtered ? 499 : offset + limit - 1);
  check(error, 'Nie udało się pobrać biblioteki.');
  let assets = await assetDTOs(ctx, (data || []) as Row[]);
  if (consent === 'ok') assets = assets.filter((asset) => ['granted', 'not_required'].includes(asset.consent.status));
  if (consent === 'missing') assets = assets.filter((asset) => !['granted', 'not_required'].includes(asset.consent.status));
  if (used === 'used') assets = assets.filter((asset) => asset.usedIn > 0);
  if (used === 'unused') assets = assets.filter((asset) => asset.usedIn === 0);
  const total = filtered ? assets.length : count ?? assets.length;
  if (filtered) assets = assets.slice(offset, offset + limit);
  const { count: proposals } = await ctx.supabase.from('social_assets').select('id', { count: 'exact', head: true })
    .eq('company_id', company.id).eq('status', 'proposed');
  return { companies, company, access, assets, total, offset, limit, proposals: proposals || 0 };
}

export async function assetRow(ctx: NativeContext, id: string): Promise<Row> {
  if (!isUuid(id)) fail('Nie znaleziono zdjęcia.', 404);
  const { data, error } = await ctx.supabase.from('social_assets').select(ASSET_FIELDS).eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać zdjęcia.');
  if (!data) fail('Nie znaleziono zdjęcia.', 404);
  return data as Row;
}

export async function assetDetail(ctx: NativeContext, id: string) {
  const row = await assetRow(ctx, id);
  const access = await socialAccess(ctx, String(row.company_id));
  const [asset] = await assetDTOs(ctx, [row], { work: true });
  const [{ data: usage }, { data: slideUsage }, { data: slotUsage }] = await Promise.all([
    ctx.supabase.from('social_post_variants').select('format, post:social_posts(id, title, status, scheduled_at)').eq('asset_id', id),
    ctx.supabase.from('social_post_slides').select('format, post:social_posts(id, title, status, scheduled_at)').eq('asset_id', id),
    ctx.supabase.from('social_post_slots').select('format, post:social_posts(id, title, status, scheduled_at)').eq('asset_id', id),
  ]);
  const posts = new Map<string, Row>();
  for (const item of [...((usage || []) as Row[]), ...((slideUsage || []) as Row[]), ...((slotUsage || []) as Row[])]) {
    const post = isObject(item.post) ? item.post : null;
    if (post) posts.set(String(post.id), { id: String(post.id), title: text(post.title), status: text(post.status), scheduledAt: text(post.scheduled_at) || null });
  }
  return { asset, access, posts: Array.from(posts.values()) };
}

async function eventInfo(ctx: NativeContext, eventId: string) {
  const { data } = await ctx.supabase.from('events').select('id, name, my_company_id, organization_id').eq('id', eventId).maybeSingle();
  return data as Row | null;
}

/** Nowe zdjęcie: wpis „wgrywanie” i ścieżka pliku do wgrania tokenem pracownika. */
export async function assetCreate(ctx: NativeContext, body: Row) {
  const mimeType = text(body.mimeType).toLowerCase();
  if (!(SOCIAL_UPLOAD_TYPES as readonly string[]).includes(mimeType)) {
    fail('Dodaj zdjęcie JPEG, PNG albo WebP (zdjęcia HEIC zapisz najpierw jako JPEG).', 415);
  }
  const bytes = Number(body.bytes) || 0;
  if (bytes > SOCIAL_LIMITS.uploadBytes) fail('Zdjęcie może mieć najwyżej 40 MB.', 413);
  const source = (['upload', 'camera', 'mac'].includes(text(body.source)) ? text(body.source) : 'upload') as SocialAssetSource;
  const eventId = uuidOrNull(body.eventId);
  const event = eventId ? await eventInfo(ctx, eventId) : null;
  if (eventId && !event) fail('Nie znaleziono wydarzenia albo nie masz do niego dostępu.', 404);
  let companyId = uuidOrNull(body.companyId) || uuidOrNull(event?.my_company_id);
  if (!companyId) {
    const { data } = await ctx.supabase.from('my_companies').select('id').eq('is_default', true).eq('is_active', true).limit(1).maybeSingle();
    companyId = uuidOrNull(data?.id);
  }
  if (!companyId) fail('Wybierz markę.', 400);
  const access = await socialAccess(ctx, companyId);
  if (!access.create && !eventId) fail('Zdjęcie do biblioteki dodaje twórca treści. Członek zespołu wydarzenia może dodać zdjęcie z wydarzenia.', 403);
  const id = randomUUID();
  const path = `${companyId}/assets/${id}/original.${EXTENSIONS[mimeType]}`;
  const { error } = await ctx.supabase.from('social_assets').insert({
    id,
    company_id: companyId,
    kind: 'photo',
    source,
    storage_path: path,
    original_name: text(body.fileName).slice(0, 255),
    mime_type: mimeType,
    bytes: bytes || null,
    event_id: eventId,
    title: text(body.title).trim().slice(0, SOCIAL_LIMITS.title),
    note: text(body.note).trim().slice(0, SOCIAL_LIMITS.note),
  });
  if (error && (error.code === '42501' || /row-level security/i.test(error.message || ''))) {
    fail('Zdjęcie z wydarzenia może dodać członek zespołu tego wydarzenia albo twórca treści.', 403);
  }
  check(error, 'Nie udało się przygotować wgrywania zdjęcia.');
  return { assetId: id, bucket: 'social-media', path, companyId, proposal: !access.create };
}

/** Analiza wgranego pliku i zapis wersji roboczej, miniatury i kadrów; duplikat w marce — usunięcie wgranego. */
export async function assetFinish(ctx: NativeContext, id: string, bytesOverride?: Buffer) {
  const row = await assetRow(ctx, id);
  if (row.status !== 'uploading') return assetDetail(ctx, id);
  const original = bytesOverride || await downloadSocialFile(ctx.supabase, String(row.storage_path));
  const type = sniffImageType(original);
  if (!type) {
    await discardUpload(ctx, row);
    fail('To nie jest zdjęcie JPEG, PNG ani WebP.', 415);
  }
  const analysis = await analyzeSocialImage(original, type);
  const { data: duplicate } = await ctx.supabase.from('social_assets').select('id, status')
    .eq('company_id', row.company_id).eq('content_sha256', analysis.sha256).neq('id', id).neq('status', 'uploading').limit(1).maybeSingle();
  if (duplicate) {
    await discardUpload(ctx, row);
    const detail = await assetDetail(ctx, String(duplicate.id)).catch(() => null);
    return { ...(detail || {}), duplicateOf: String(duplicate.id), message: 'To zdjęcie jest już w bibliotece.' };
  }
  const base = `${row.company_id}/assets/${id}`;
  await uploadSocialFile(ctx.supabase, `${base}/work.jpg`, analysis.work, 'image/jpeg');
  await uploadSocialFile(ctx.supabase, `${base}/thumb.jpg`, analysis.thumbnail, 'image/jpeg');
  const access = await socialAccess(ctx, String(row.company_id));
  const { error } = await ctx.supabase.from('social_assets').update({
    status: access.create ? 'ready' : 'proposed',
    work_path: `${base}/work.jpg`,
    thumbnail_path: `${base}/thumb.jpg`,
    width: analysis.width,
    height: analysis.height,
    bytes: original.length,
    mime_type: type,
    content_sha256: analysis.sha256,
    crops: analysis.crops,
  }).eq('id', id);
  check(error, 'Nie udało się zapisać zdjęcia w bibliotece.');
  return assetDetail(ctx, id);
}

/**
 * Plik zdjęcia przesłany przez serwer CRM (Mac i telefon — także przy połączeniu przez serwer, bez bezpośredniego dostępu
 * do Storage): zapis w ścieżce wpisu „wgrywanie” wgrywającego i analiza.
 */
export async function assetUpload(ctx: NativeContext, id: string, bytes: Buffer) {
  const row = await assetRow(ctx, id);
  if (row.status !== 'uploading' || row.created_by !== ctx.employee.id) fail('To zdjęcie jest już w bibliotece.', 409);
  if (!bytes.length) fail('Pusty plik.', 400);
  if (bytes.length > SOCIAL_LIMITS.uploadBytes) fail('Zdjęcie może mieć najwyżej 40 MB.', 413);
  const type = sniffImageType(bytes);
  if (!type || EXTENSIONS[type] !== String(row.storage_path).split('.').pop()) {
    await discardUpload(ctx, row);
    fail('To nie jest zdjęcie JPEG, PNG ani WebP zgodne z zapowiedzianym plikiem.', 415);
  }
  await uploadSocialFile(ctx.supabase, String(row.storage_path), bytes, type);
  return assetFinish(ctx, id, bytes);
}

async function discardUpload(ctx: NativeContext, row: Row) {
  const base = `${row.company_id}/assets/${row.id}`;
  await removeSocialFiles(ctx.supabase, [String(row.storage_path), `${base}/work.jpg`, `${base}/thumb.jpg`]);
  await ctx.supabase.from('social_assets').delete().eq('id', row.id).eq('status', 'uploading');
}

/** Import zdjęcia z plików wydarzenia (`event_files`) albo galerii realizacji na stronie (`portfolio_projects`). */
export async function assetImport(ctx: NativeContext, body: Row) {
  let bytes: Buffer;
  let fileName: string;
  let eventId: string | null = null;
  let portfolioId: string | null = null;
  let source: SocialAssetSource;
  if (isUuid(body.eventFileId)) {
    const { data: file, error } = await ctx.supabase.from('event_files').select('id, event_id, file_path, mime_type, original_name, name, file_size')
      .eq('id', body.eventFileId).maybeSingle();
    check(error, 'Nie udało się pobrać pliku wydarzenia.');
    if (!file) fail('Nie znaleziono pliku wydarzenia.', 404);
    if (Number(file.file_size) > SOCIAL_LIMITS.uploadBytes) fail('Zdjęcie może mieć najwyżej 40 MB.', 413);
    const { data: blob, error: downloadError } = await ctx.supabase.storage.from('event-files').download(String(file.file_path));
    if (downloadError || !blob) fail('Nie udało się pobrać pliku wydarzenia.', 502);
    bytes = Buffer.from(await blob.arrayBuffer());
    fileName = text(file.original_name) || text(file.name) || 'zdjecie.jpg';
    eventId = uuidOrNull(file.event_id);
    source = 'event_file';
  } else if (isUuid(body.portfolioProjectId) && typeof body.imageUrl === 'string') {
    const imageUrl = body.imageUrl.trim();
    if (!isOwnPublicStorageUrl(imageUrl)) fail('Nieobsługiwany adres zdjęcia realizacji.', 400);
    const { data: project } = await ctx.supabase.from('portfolio_projects').select('id, title, image, image_url, gallery').eq('id', body.portfolioProjectId).maybeSingle();
    if (!project) fail('Nie znaleziono realizacji.', 404);
    if (!portfolioImageUrls(project as Row).includes(imageUrl)) fail('To zdjęcie nie należy do tej realizacji.', 400);
    bytes = (await fetchPublicStorageFile(imageUrl, SOCIAL_LIMITS.uploadBytes)).bytes;
    fileName = decodeURIComponent(imageUrl.split('/').pop() || 'realizacja.jpg');
    portfolioId = String(project.id);
    source = 'portfolio';
  } else if (isUuid(body.portfolioItemId) && typeof body.imageUrl === 'string') {
    // Zdjęcie z karty realizacji (Marketing → Realizacje), także jeszcze nieopublikowanej — dostęp sprawdza baza (edycja strony).
    const imageUrl = body.imageUrl.trim();
    if (!isOwnPublicStorageUrl(imageUrl)) fail('Nieobsługiwany adres zdjęcia realizacji.', 400);
    const { data: item } = await ctx.supabase.from('marketing_portfolio_items').select('id, portfolio_project_id, event_id, content')
      .eq('id', body.portfolioItemId).maybeSingle();
    if (!item) fail('Nie znaleziono realizacji.', 404);
    const content = isObject(item.content) ? item.content : {};
    const photos = [content.image, ...(Array.isArray(content.gallery) ? content.gallery : [])].filter(isObject);
    if (!photos.some((photo) => text(photo.src) === imageUrl)) fail('To zdjęcie nie należy do tej realizacji.', 400);
    bytes = (await fetchPublicStorageFile(imageUrl, SOCIAL_LIMITS.uploadBytes)).bytes;
    fileName = decodeURIComponent(imageUrl.split('/').pop() || 'realizacja.webp');
    portfolioId = uuidOrNull(item.portfolio_project_id);
    // Wydarzenie realizacji (zgoda klienta) — tylko gdy pracownik je widzi.
    eventId = uuidOrNull(item.event_id);
    if (eventId && !(await eventInfo(ctx, eventId))) eventId = null;
    source = 'portfolio';
  } else {
    fail('Wybierz zdjęcie do importu.', 400);
  }
  const type = sniffImageType(bytes);
  if (!type) fail('Ten plik nie jest zdjęciem JPEG, PNG ani WebP.', 415);
  const created = await assetCreate(ctx, {
    companyId: body.companyId, eventId, fileName, mimeType: type, bytes: bytes.length, source: 'upload',
  });
  await uploadSocialFile(ctx.supabase, created.path, bytes, type);
  const patch: Row = { source };
  if (portfolioId) patch.portfolio_project_id = portfolioId;
  if (body.eventFileId) patch.source_ref = String(body.eventFileId);
  const { error } = await ctx.supabase.from('social_assets').update(patch).eq('id', created.assetId);
  check(error, 'Nie udało się zapisać źródła zdjęcia.');
  return assetFinish(ctx, created.assetId, bytes);
}

/** Zmiana opisu, powiązań, zgody i statusu zdjęcia (propozycja → biblioteka, archiwum). */
export async function assetUpdate(ctx: NativeContext, body: Row) {
  const row = await assetRow(ctx, text(body.id));
  const access = await socialAccess(ctx, String(row.company_id));
  if (!access.create) fail('Zdjęcia w bibliotece zmienia twórca treści.', 403);
  if (body.updatedAt && text(body.updatedAt) !== text(row.updated_at)) fail('Zdjęcie zmieniono w innym oknie. Odśwież widok.', 409);
  const patch: Row = {};
  if ('title' in body) patch.title = text(body.title).trim().slice(0, SOCIAL_LIMITS.title);
  if ('note' in body) patch.note = text(body.note).trim().slice(0, SOCIAL_LIMITS.note);
  if ('eventId' in body) patch.event_id = uuidOrNull(body.eventId);
  if ('portfolioProjectId' in body) patch.portfolio_project_id = uuidOrNull(body.portfolioProjectId);
  if ('organizationId' in body) patch.organization_id = uuidOrNull(body.organizationId);
  if ('visibleBrands' in body) patch.visible_brands = list(body.visibleBrands).map((item) => item.trim().slice(0, 60)).slice(0, 20);
  if ('status' in body) {
    const status = text(body.status);
    if (!['ready', 'archived', 'proposed'].includes(status) || row.status === 'uploading') fail('Nieprawidłowy status zdjęcia.');
    patch.status = status;
  }
  if ('consentStatus' in body || 'consentChannels' in body || 'consentNote' in body) {
    if (!access.consent) fail('Status zgody klienta ustawia twórca treści lub akceptujący.', 403);
    if ('consentStatus' in body) {
      const status = text(body.consentStatus);
      if (!(SOCIAL_CONSENT_STATUSES as readonly string[]).includes(status)) fail('Nieprawidłowy status zgody.');
      patch.consent_status = status;
    }
    if ('consentChannels' in body) patch.consent_channels = list(body.consentChannels).filter((item) => (SOCIAL_CONSENT_PLATFORMS as readonly string[]).includes(item));
    if ('consentNote' in body) patch.consent_note = text(body.consentNote).trim().slice(0, SOCIAL_LIMITS.note);
  }
  if (!Object.keys(patch).length) return assetDetail(ctx, String(row.id));
  const { data, error } = await ctx.supabase.from('social_assets').update(patch).eq('id', row.id).eq('updated_at', row.updated_at).select('id');
  check(error, 'Nie udało się zapisać zdjęcia.');
  if (!data?.length) fail('Zdjęcie zmieniono w innym oknie. Odśwież widok.', 409);
  return assetDetail(ctx, String(row.id));
}

/** Usunięcie zdjęcia (pliki i wpis) — tylko nieużyte w postach; użyte można przenieść do archiwum. */
export async function assetDelete(ctx: NativeContext, id: string) {
  const row = await assetRow(ctx, id);
  const access = await socialAccess(ctx, String(row.company_id));
  const own = row.status === 'uploading' && row.created_by === ctx.employee.id;
  if (!access.create && !own) fail('Zdjęcia z biblioteki usuwa twórca treści.', 403);
  const [{ count }, { count: slideCount }, { count: slotCount }] = await Promise.all([
    ctx.supabase.from('social_post_variants').select('id', { count: 'exact', head: true }).eq('asset_id', id),
    ctx.supabase.from('social_post_slides').select('id', { count: 'exact', head: true }).eq('asset_id', id),
    ctx.supabase.from('social_post_slots').select('id', { count: 'exact', head: true }).eq('asset_id', id),
  ]);
  if ((count || 0) + (slideCount || 0) + (slotCount || 0) > 0) fail('Zdjęcie jest użyte w postach — zamiast usuwać, przenieś je do archiwum.', 409);
  const { data, error } = await ctx.supabase.from('social_assets').delete().eq('id', id).select('id');
  check(error, 'Nie udało się usunąć zdjęcia.');
  if (!data?.length) fail('Nie udało się usunąć zdjęcia.', 403);
  await removeSocialFiles(ctx.supabase, [row.storage_path, row.work_path, row.thumbnail_path]);
  return { deleted: id };
}

/** Zgoda klienta na poziomie wydarzenia albo organizacji klienta (domyślna dla zdjęć z jego wydarzeń). */
export async function consentSave(ctx: NativeContext, body: Row) {
  const eventId = uuidOrNull(body.eventId);
  const organizationId = eventId ? null : uuidOrNull(body.organizationId);
  if (!eventId && !organizationId) fail('Wybierz wydarzenie albo klienta.');
  const status = text(body.status);
  if (!['unknown', 'requested', 'granted', 'denied', 'not_required'].includes(status)) fail('Nieprawidłowy status zgody.');
  const { data: allowed } = await ctx.supabase.rpc('social_media_can', { p_company: null, p_scope: 'consent' });
  if (allowed !== true) fail('Status zgody klienta ustawia twórca treści lub akceptujący.', 403);
  const values = {
    status,
    channels: list(body.channels).filter((item) => (SOCIAL_CONSENT_PLATFORMS as readonly string[]).includes(item)),
    note: text(body.note).trim().slice(0, SOCIAL_LIMITS.note),
  };
  const column = eventId ? 'event_id' : 'organization_id';
  const target = (eventId || organizationId) as string;
  const { data: existing } = await ctx.supabase.from('social_publication_consents').select('id').eq(column, target).maybeSingle();
  const result = existing
    ? await ctx.supabase.from('social_publication_consents').update(values).eq('id', existing.id).select('*').single()
    : await ctx.supabase.from('social_publication_consents').insert({ ...values, [column]: target }).select('*').single();
  check(result.error, 'Nie udało się zapisać zgody klienta.');
  return { consent: consentDTO(result.data as Row) };
}

export function consentDTO(row: Row | null | undefined) {
  if (!row) return null;
  return {
    id: String(row.id),
    eventId: uuidOrNull(row.event_id),
    organizationId: uuidOrNull(row.organization_id),
    status: text(row.status),
    channels: list(row.channels),
    note: text(row.note),
    decidedAt: text(row.decided_at) || null,
  };
}

/** Wydarzenia do wyboru (dostęp jak w CRM — RLS) z marki albo bez marki; zgody wydarzenia i klienta. */
export async function eventsPicker(ctx: NativeContext, params: URLSearchParams) {
  const companyId = uuidOrNull(params.get('company'));
  const q = (params.get('q') || '').trim().slice(0, 80).replace(/[%,()]/g, ' ');
  let query = ctx.supabase.from('events')
    .select('id, name, event_date, location, my_company_id, organization_id, organization:organizations!events_organization_id_fkey(name), venue:locations(name, city)')
    .order('event_date', { ascending: false }).limit(40);
  if (companyId) query = query.or(`my_company_id.eq.${companyId},my_company_id.is.null`);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data, error } = await query;
  check(error, 'Nie udało się pobrać wydarzeń.');
  const rows = (data || []) as Row[];
  const eventIds = rows.map((row) => String(row.id));
  const organizationIds = Array.from(new Set(rows.map((row) => row.organization_id).filter(isUuid)));
  const [eventConsents, organizationConsents] = await Promise.all([
    eventIds.length ? ctx.supabase.from('social_publication_consents').select('*').in('event_id', eventIds) : Promise.resolve({ data: [] }),
    organizationIds.length ? ctx.supabase.from('social_publication_consents').select('*').in('organization_id', organizationIds) : Promise.resolve({ data: [] }),
  ]);
  const byEvent = new Map(((eventConsents.data || []) as Row[]).map((row) => [String(row.event_id), row]));
  const byOrganization = new Map(((organizationConsents.data || []) as Row[]).map((row) => [String(row.organization_id), row]));
  return {
    events: rows.map((row) => {
      const venue = isObject(row.venue) ? row.venue : null;
      return {
        id: String(row.id),
        name: text(row.name) || 'Wydarzenie',
        date: text(row.event_date) || null,
        location: venue ? [text(venue.name), text(venue.city)].filter(Boolean).join(', ') : text(row.location),
        organizationId: uuidOrNull(row.organization_id),
        organizationName: isObject(row.organization) ? text(row.organization.name) || null : null,
        eventConsent: consentDTO(byEvent.get(String(row.id))),
        organizationConsent: consentDTO(byOrganization.get(text(row.organization_id))),
      };
    }),
  };
}

/** Zdjęcia z plików wydarzenia (JPEG, PNG, WebP) z linkami podglądu. */
export async function eventImages(ctx: NativeContext, eventId: string) {
  if (!isUuid(eventId)) fail('Nie znaleziono wydarzenia.', 404);
  const { data, error } = await ctx.supabase.from('event_files').select('id, name, original_name, file_path, mime_type, file_size, created_at')
    .eq('event_id', eventId).in('mime_type', ['image/jpeg', 'image/png', 'image/webp']).order('created_at', { ascending: false }).limit(120);
  check(error, 'Nie udało się pobrać plików wydarzenia.');
  const rows = (data || []) as Row[];
  const paths = rows.map((row) => String(row.file_path));
  const signed = paths.length ? await ctx.supabase.storage.from('event-files').createSignedUrls(paths, 3600) : { data: [] };
  const urls = new Map(((signed.data || []) as Row[]).filter((item) => item.signedUrl).map((item) => [String(item.path), String(item.signedUrl)]));
  const { data: imported } = await ctx.supabase.from('social_assets').select('source_ref').eq('source', 'event_file').in('source_ref', rows.map((row) => String(row.id)));
  const importedIds = new Set(((imported || []) as Row[]).map((row) => text(row.source_ref)));
  return {
    files: rows.map((row) => ({
      id: String(row.id),
      name: text(row.original_name) || text(row.name),
      url: urls.get(String(row.file_path)) || null,
      bytes: Number(row.file_size) || null,
      imported: importedIds.has(String(row.id)),
    })),
  };
}

function portfolioImageUrls(project: Row): string[] {
  const urls = new Set<string>();
  for (const value of [project.image, project.image_url]) if (typeof value === 'string' && value) urls.add(value);
  if (Array.isArray(project.gallery)) {
    for (const item of project.gallery) {
      const src = isObject(item) ? text(item.src) : text(item);
      if (src) urls.add(src);
    }
  }
  return Array.from(urls).filter(isOwnPublicStorageUrl);
}

/** Realizacje ze strony z galerią (zdjęcia publiczne) do importu. */
export async function portfolioPicker(ctx: NativeContext, params: URLSearchParams) {
  const q = (params.get('q') || '').trim().slice(0, 80).replace(/[%,()]/g, ' ');
  let query = ctx.supabase.from('portfolio_projects').select('id, title, location, event_date, image, image_url, gallery').order('order_index').limit(60);
  if (q) query = query.ilike('title', `%${q}%`);
  const { data, error } = await query;
  check(error, 'Nie udało się pobrać realizacji.');
  return {
    projects: ((data || []) as Row[]).map((row) => ({
      id: String(row.id),
      title: text(row.title),
      location: text(row.location),
      date: text(row.event_date) || null,
      images: portfolioImageUrls(row).slice(0, 40),
    })),
  };
}

export type { SocialAccess };
