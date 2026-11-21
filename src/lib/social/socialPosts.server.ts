import 'server-only';
import type { NativeContext } from '@/lib/native/auth';
import { assistSocial, generateSocialSuggestions, type SocialAiContext } from './socialAi.server';
import { assetDTOs, ASSET_FIELDS, type SocialAssetDTO } from './socialAssets.server';
import {
  brandbookPublicUrl, check, downloadSocialFile, employeeNames, fail, isObject, isUuid, removeSocialFiles, requireAccess, safeFileName,
  signedUrls, socialAccess, socialCompanies, text, uuidOrNull, type Row,
} from './socialCommon.server';
import {
  graphicSpec, loadTemplates, pickTemplate, renderCanvas, renderHash, renderOverlay, renderVariant, templateDTO, type LoadedTemplate,
  type RenderedTile, type SocialGraphicSpec, type SocialTemplateDTO,
} from './socialTemplate.server';
import {
  SOCIAL_CHANNELS, SOCIAL_FORMATS, SOCIAL_LIMITS, SOCIAL_SLIDE_FORMATS, channelFormat, defaultFormatsForChannels, effectiveCrop, fitCrop, formatSlug,
  SOCIAL_CHANNEL_LABELS, isSocialAiGoal, isSocialAiLength, isSocialAiRewrite, isSocialAiTone, isSocialChannel, isSocialCrop, isSocialFormat,
  isSocialGraphicStyle, normalizeHashtags, socialCanPublishNow, socialCommentPlatform, socialConsentAllows, socialPostActions,
  socialPublicationText, socialEngagementRate, socialMetricsFromRow,
  type SocialAccess, type SocialChannel, type SocialCommentPlatform, type SocialMetricValues, type SocialCrop, type SocialFormat, type SocialGraphicStyle, type SocialPostAction,
  type SocialPostStatus,
} from './socialShared';
import { createZip } from './zip.server';
import { LINKEDIN_TEXT_LIMIT } from './socialLinkedIn.server';
import {
  SOCIAL_CANVAS_PRESETS, SOCIAL_LAYOUT_PRESETS, fitAspectCrop, parseSocialCanvas, parseSocialLayout, socialAspectCrop, socialCanvasLabel, socialCanvasSize,
  socialCanvasTileCount, socialCropFitsAspect, socialLayoutPreset, socialLayoutSlotAspect, socialLayoutSlots, type SocialCanvas, type SocialLayoutDefinition,
} from './socialLayout';
import {
  INSTAGRAM_CAPTION_LIMIT, errorMessage, instagramRecentMedia, metaStatusDTO, replyAsBrand, runSocialPublishing, socialMetaAccount,
  syncSocialComments,
  type SocialMetaAccount, type SocialMetaStatus,
} from './socialMeta.server';

/*
 * Posty social media: kalendarz (lista w zakresie dat + szkice bez terminu + czekające na akceptację), karta posta
 * (warianty grafik ze stylem i napisem nad tytułem, podglądy, braki, historia, akcje), zapis treści i grafik z renderem, zmiany statusu
 * (`social_post_transition`), termin z kalendarza, kopia, usunięcie, opisy AI i paczka do ręcznej publikacji (Etap 1),
 * planowanie i publikacja w Meta, wyniki kanałów, komentarze z odpowiedziami i siatka profilu z Instagrama (Etap 2),
 * statystyki kanałów posta z Meta (Etap 3; zakładka „Statystyki” i raport tygodniowy — `socialReport.server.ts`).
 * Karuzele: okładka to warianty, kolejne zdjęcia — `social_post_slides` (pozycja 1–9 × format feedu, ten sam szablon i styl
 * co okładka, bez tekstów).
 * Układy jako dane (`socialLayout.ts`): wariant ma wskazany układ (`layout_id` — układ marki, albo gotowy układ) i migawkę
 * jego definicji (`layout`) z chwili zapisu; kolaż — zdjęcia w miejscach 1–3 w `social_post_slots` (miejsce 0 to zdjęcie
 * wariantu). Kadr zdjęcia w układzie ma proporcje miejsca (nie formatu).
 * Siatka profilu i panorama (Etap G): układ z `canvas` (duża grafika) — post ma jeden wariant 4:5, serwer tnie render na kafelki
 * (`social_post_tiles`); siatka publikuje się na Instagramie jako osobne posty od ostatniego kafelka do pierwszego (opis
 * z hashtagami na kafelku 1, na pozostałych same hashtagi), panorama — jako karuzela (Instagram, Facebook, LinkedIn).
 * Te same funkcje obsługują web CRM, Maca i telefon (`/bridge/native/v1/social`).
 */

const POST_FIELDS = 'id, company_id, title, status, channels, scheduled_at, caption, hashtags, template_id, event_id, portfolio_project_id, ai_suggestions, author_id, revision, submitted_at, submitted_by, reviewed_at, reviewed_by, review_note, approved_revision, published_at, published_by, published_url, cancelled_at, created_at, updated_at, updated_by, scheduled_by, publish_attempts, publish_error';
const VARIANT_FIELDS = 'id, post_id, format, asset_id, crop, headline, subline, style, kicker, layout_id, layout, rendered_path, render_hash, rendered_at, updated_at';
const SLOT_FIELDS = 'id, post_id, slot, format, asset_id, crop, updated_at';
const LAYOUT_FIELDS = 'id, company_id, name, definition, is_archived, updated_at';
const SLIDE_FIELDS = 'id, post_id, position, format, asset_id, crop, rendered_path, render_hash, rendered_at, updated_at';

/** Styl grafiki wariantu (wartość spoza listy — „Klasyczny”). */
const variantStyle = (value: unknown): SocialGraphicStyle => (isSocialGraphicStyle(value) ? value : 'classic');
/** Napis nad tytułem — jedna linia, limit jak w bazie. */
const kickerText = (value: unknown) => text(value).trim().replace(/\s+/g, ' ').slice(0, SOCIAL_LIMITS.kicker);
const MAX_RANGE_DAYS = 120;

const channelsOf = (value: unknown): SocialChannel[] =>
  Array.isArray(value) ? SOCIAL_CHANNELS.filter((channel) => value.includes(channel)) : [];

export type SocialPostListItem = {
  id: string;
  companyId: string;
  title: string;
  status: SocialPostStatus;
  channels: SocialChannel[];
  scheduledAt: string | null;
  captionPreview: string;
  thumbnailUrl: string | null;
  formats: SocialFormat[];
  /** Liczba zdjęć w poście (okładka + karuzela); 1 — pojedyncze zdjęcie. */
  photos: number;
  /** Siatka profilu albo panorama (duża grafika pocięta na kafelki); `null` — zwykły post. */
  canvas: { mode: 'grid' | 'panorama'; tiles: number } | null;
  authorId: string | null;
  authorName: string | null;
  revision: number;
  approvedRevision: number | null;
  eventId: string | null;
  publishedAt: string | null;
  publishedUrl: string | null;
  publishError: string | null;
  updatedAt: string;
};

async function listItems(ctx: NativeContext, rows: Row[]): Promise<SocialPostListItem[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => String(row.id));
  const [{ data: variants }, names, { data: slides }] = await Promise.all([
    ctx.supabase.from('social_post_variants').select('post_id, format, rendered_path, canvas:layout->canvas, asset:social_assets(thumbnail_path)').in('post_id', ids),
    employeeNames(ctx.supabase, rows.map((row) => row.author_id)),
    ctx.supabase.from('social_post_slides').select('post_id, position').in('post_id', ids),
  ]);
  const slideCount = new Map<string, Set<number>>();
  for (const slide of (slides || []) as Row[]) {
    const set = slideCount.get(String(slide.post_id)) || new Set<number>();
    set.add(Number(slide.position));
    slideCount.set(String(slide.post_id), set);
  }
  const byPost = new Map<string, Row[]>();
  for (const variant of (variants || []) as Row[]) {
    const list = byPost.get(String(variant.post_id)) || [];
    list.push(variant);
    byPost.set(String(variant.post_id), list);
  }
  const preferred = (list: Row[]) => {
    const sorted = [...list].sort((a, b) => SOCIAL_FORMATS.indexOf(a.format) - SOCIAL_FORMATS.indexOf(b.format));
    return sorted.find((item) => item.rendered_path) || sorted[0];
  };
  const thumbPaths = rows.map((row) => {
    const variant = preferred(byPost.get(String(row.id)) || []);
    return variant ? variant.rendered_path || (isObject(variant.asset) ? variant.asset.thumbnail_path : null) : null;
  });
  const urls = await signedUrls(ctx.supabase, thumbPaths);
  return rows.map((row, index) => {
    const list = byPost.get(String(row.id)) || [];
    const canvas = list.map((item) => parseSocialCanvas(item.canvas)).find(Boolean) || null;
    return {
      id: String(row.id),
      companyId: String(row.company_id),
      title: text(row.title),
      status: text(row.status) as SocialPostStatus,
      channels: channelsOf(row.channels),
      scheduledAt: text(row.scheduled_at) || null,
      captionPreview: text(row.caption).slice(0, 160),
      thumbnailUrl: thumbPaths[index] ? urls.get(thumbPaths[index] as string) || null : null,
      formats: SOCIAL_FORMATS.filter((format) => list.some((item) => item.format === format)),
      photos: canvas ? socialCanvasTileCount(canvas) : 1 + (slideCount.get(String(row.id))?.size || 0),
      canvas: canvas ? { mode: canvas.mode, tiles: socialCanvasTileCount(canvas) } : null,
      authorId: uuidOrNull(row.author_id),
      authorName: row.author_id ? names.get(String(row.author_id).toLowerCase()) || null : null,
      revision: Number(row.revision) || 1,
      approvedRevision: row.approved_revision == null ? null : Number(row.approved_revision),
      eventId: uuidOrNull(row.event_id),
      publishedAt: text(row.published_at) || null,
      publishedUrl: text(row.published_url) || null,
      publishError: text(row.publish_error) || null,
      updatedAt: text(row.updated_at),
    };
  });
}

function settingsDTO(row: Row | null | undefined) {
  return {
    aiCaptionsEnabled: row?.ai_captions_enabled === true,
    aiConsentAt: text(row?.ai_consent_at) || null,
    aiReportsEnabled: row?.ai_reports_enabled === true,
    aiReportsConsentAt: text(row?.ai_reports_consent_at) || null,
    defaultHashtags: Array.isArray(row?.default_hashtags) ? (row!.default_hashtags as unknown[]).map(text) : [],
    captionStyle: text(row?.caption_style),
    updatedAt: text(row?.updated_at) || null,
  };
}

function range(params: URLSearchParams) {
  const now = new Date();
  const fromRaw = new Date(params.get('from') || '');
  const toRaw = new Date(params.get('to') || '');
  const from = Number.isNaN(fromRaw.getTime()) ? new Date(now.getFullYear(), now.getMonth() - 1, 20) : fromRaw;
  let to = Number.isNaN(toRaw.getTime()) ? new Date(now.getFullYear(), now.getMonth() + 1, 10) : toRaw;
  if (to <= from) to = new Date(from.getTime() + 35 * 86_400_000);
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) to = new Date(from.getTime() + MAX_RANGE_DAYS * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Kalendarz marki: posty w zakresie, szkice bez terminu i posty czekające na akceptację lub poprawę. */
export async function socialHome(ctx: NativeContext, params: URLSearchParams) {
  const companies = await socialCompanies(ctx);
  if (!companies.length) fail('Nie masz dostępu do social media. Poproś administratora o uprawnienie w sekcji „Social media”.', 403);
  const company = companies.find((item) => item.id === uuidOrNull(params.get('company'))) || companies[0];
  const { from, to } = range(params);
  const base = () => ctx.supabase.from('social_posts').select(POST_FIELDS).eq('company_id', company.id);
  const [access, scheduled, undated, pending, settings, templates, proposals, unanswered, meta] = await Promise.all([
    socialAccess(ctx, company.id),
    base().gte('scheduled_at', from).lt('scheduled_at', to).order('scheduled_at').limit(400),
    base().is('scheduled_at', null).not('status', 'in', '(published,cancelled)').order('updated_at', { ascending: false }).limit(100),
    base().in('status', ['in_review', 'changes_requested', 'failed', 'publishing']).order('updated_at', { ascending: false }).limit(100),
    ctx.supabase.from('social_settings').select('*').eq('company_id', company.id).maybeSingle(),
    loadTemplates(ctx, company.id),
    ctx.supabase.from('social_assets').select('id', { count: 'exact', head: true }).eq('company_id', company.id).eq('status', 'proposed'),
    ctx.supabase.from('social_comments').select('id', { count: 'exact', head: true }).eq('company_id', company.id)
      .is('parent_external_id', null).eq('is_own', false).is('answered_at', null),
    socialMetaAccount(company.id).then(metaStatusDTO).catch((error) => {
      console.warn('[social] meta status', errorMessage(error));
      return null;
    }),
  ]);
  check(scheduled.error || undated.error || pending.error, 'Nie udało się pobrać kalendarza social media.');
  const rows = new Map<string, Row>();
  for (const row of [...(scheduled.data || []), ...(undated.data || []), ...(pending.data || [])] as Row[]) rows.set(String(row.id), row);
  const posts = await listItems(ctx, Array.from(rows.values()));
  return {
    companies,
    company,
    access,
    range: { from, to },
    settings: settingsDTO(settings.data as Row | null),
    templates: templates.map(templateDTO),
    posts,
    counts: {
      inReview: posts.filter((post) => post.status === 'in_review').length,
      changesRequested: posts.filter((post) => post.status === 'changes_requested').length,
      failed: posts.filter((post) => post.status === 'failed').length,
      proposals: proposals.count || 0,
      unansweredComments: unanswered.count || 0,
    },
    meta,
  };
}

async function postRow(ctx: NativeContext, id: string): Promise<Row> {
  if (!isUuid(id)) fail('Nie znaleziono posta.', 404);
  const { data, error } = await ctx.supabase.from('social_posts').select(POST_FIELDS).eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać posta.');
  if (!data) fail('Nie znaleziono posta.', 404);
  return data as Row;
}

type VariantRow = Row & { assetRow: Row | null };

async function variantRows(ctx: NativeContext, postId: string): Promise<VariantRow[]> {
  const { data, error } = await ctx.supabase.from('social_post_variants').select(`${VARIANT_FIELDS}, asset:social_assets(${ASSET_FIELDS})`).eq('post_id', postId);
  check(error, 'Nie udało się pobrać grafik posta.');
  return ((data || []) as Row[])
    .map((row): VariantRow => ({ ...row, assetRow: isObject(row.asset) ? row.asset : null }))
    .sort((a, b) => SOCIAL_FORMATS.indexOf(a.format) - SOCIAL_FORMATS.indexOf(b.format));
}

/** Układ wariantu (migawka definicji z chwili zapisu) albo `null` — styl grafiki. */
const variantLayout = (variant: Row | undefined): SocialLayoutDefinition | null => (variant ? parseSocialLayout(variant.layout) : null);

/** Kadr zdjęcia w miejscu układu: zapisany (gdy ma proporcje miejsca), propozycja formatu z biblioteki albo środek zdjęcia. */
function layoutCrop(own: unknown, asset: Row, format: SocialFormat, aspect: number): SocialCrop {
  const width = Number(asset.width);
  const height = Number(asset.height);
  if (isSocialCrop(own) && socialCropFitsAspect(own, width, height, aspect)) return own;
  const proposal = isObject(asset.crops) ? (asset.crops as Row)[format] : null;
  if (isSocialCrop(proposal) && socialCropFitsAspect(proposal, width, height, aspect)) return proposal;
  return socialAspectCrop(width, height, aspect);
}

const usableAsset = (asset: Row | null | undefined): asset is Row =>
  Boolean(asset?.work_path && Number(asset.width) && Number(asset.height));

function renderSource(variant: VariantRow, slots: SlotRow[] = []) {
  const asset = variant.assetRow;
  if (!usableAsset(asset) || !isSocialFormat(variant.format)) return null;
  const format = variant.format as SocialFormat;
  const layout = variantLayout(variant);
  return {
    format,
    workPath: String(asset.work_path),
    crop: layout
      ? layoutCrop(variant.crop, asset, format, socialLayoutSlotAspect(layout, 0, format))
      : effectiveCrop(isSocialCrop(variant.crop) ? variant.crop : null, isObject(asset.crops) ? asset.crops : null,
        Number(asset.width), Number(asset.height), format),
    headline: text(variant.headline),
    subline: text(variant.subline),
    style: variantStyle(variant.style),
    kicker: text(variant.kicker),
    layout,
    // Zdjęcia kolażu (miejsca 1…n-1) w tym formacie; brak zdjęcia — tło układu w tym miejscu.
    slots: layout ? Array.from({ length: socialLayoutSlots(layout) }, (_, slot) => {
      if (slot === 0) return null;
      const row = slots.find((item) => Number(item.slot) === slot && item.format === format);
      if (!row || !usableAsset(row.assetRow)) return null;
      return { workPath: String(row.assetRow.work_path), crop: layoutCrop(row.crop, row.assetRow, format, socialLayoutSlotAspect(layout, slot, format)) };
    }) : [],
  };
}

type SlotRow = Row & { assetRow: Row | null };

async function slotRows(ctx: NativeContext, postId: string): Promise<SlotRow[]> {
  const { data, error } = await ctx.supabase.from('social_post_slots').select(`${SLOT_FIELDS}, asset:social_assets(${ASSET_FIELDS})`).eq('post_id', postId);
  check(error, 'Nie udało się pobrać zdjęć kolażu.');
  return ((data || []) as Row[])
    .map((row): SlotRow => ({ ...row, assetRow: isObject(row.asset) ? row.asset : null }))
    .sort((a, b) => Number(a.slot) - Number(b.slot) || SOCIAL_FORMATS.indexOf(a.format) - SOCIAL_FORMATS.indexOf(b.format));
}

/** Układ do wyboru w kreatorze: gotowy (`key`) albo układ marki (`id`). */
export type SocialLayoutOption = {
  id: string | null;
  key: string | null;
  name: string;
  description: string;
  definition: SocialLayoutDefinition;
  /** Liczba zdjęć (miejsce 0 — zdjęcie wariantu, kolejne — kolaż). */
  slots: number;
  archived: boolean;
};

/** Układ posta: wskazany układ i migawka definicji zapisana w wariantach. */
export type SocialPostLayoutDTO = {
  id: string | null; key: string | null; name: string; definition: SocialLayoutDefinition; slots: number;
  /** Układ marki (albo gotowy) zmieniono po zapisaniu posta — post ma migawkę; nowa wersja po zapisie z `layout.refresh`. */
  outdated: boolean;
};

/** Zdjęcie kolażu (miejsce 1–3) z kadrami w formatach posta. */
export type SocialSlotDTO = {
  slot: number;
  assetId: string;
  asset: SocialAssetDTO | null;
  formats: Array<{ format: SocialFormat; crop: SocialCrop | null; effectiveCrop: SocialCrop | null; aspect: number }>;
};

/** Źródło migawki układu (`layout.source`) — wskazanie układu marki albo gotowego układu. */
function layoutSource(raw: unknown): { id: string | null; key: string | null; name: string } {
  const source = isObject(raw) && isObject((raw as Row).source) ? (raw as Row).source as Row : {};
  return { id: uuidOrNull(source.id), key: typeof source.key === 'string' ? source.key : null, name: text(source.name) || 'Układ' };
}

function postLayoutDTO(variants: VariantRow[]): SocialPostLayoutDTO | null {
  const variant = variants.find((item) => variantLayout(item));
  const definition = variantLayout(variant);
  if (!variant || !definition) return null;
  const source = layoutSource(variant.layout);
  return {
    id: uuidOrNull(variant.layout_id) || source.id, key: source.key, name: source.name, definition, slots: socialLayoutSlots(definition), outdated: false,
  };
}

/** Gotowe układy i układy marki (bez archiwalnych — chyba że post go używa; bez układów dużej grafiki). */
async function layoutOptions(ctx: NativeContext, companyId: string, usedId: string | null = null): Promise<SocialLayoutOption[]> {
  const { data } = await ctx.supabase.from('social_layouts').select(LAYOUT_FIELDS).eq('company_id', companyId).order('name');
  const brand = ((data || []) as Row[])
    .filter((row) => !row.is_archived || String(row.id) === usedId)
    .map((row): SocialLayoutOption | null => {
      const definition = parseSocialLayout(row.definition);
      return definition && !definition.canvas ? {
        id: String(row.id), key: null, name: text(row.name), description: '', definition, slots: socialLayoutSlots(definition), archived: row.is_archived === true,
      } : null;
    })
    .filter((item): item is SocialLayoutOption => Boolean(item));
  return [
    ...brand,
    ...SOCIAL_LAYOUT_PRESETS.map((preset) => ({
      id: null, key: preset.key, name: preset.name, description: preset.description, definition: preset.definition,
      slots: socialLayoutSlots(preset.definition), archived: false,
    })),
  ];
}

/** Gotowe układy siatki profilu i panoramy (kształt — `definition.canvas`). */
const canvasLayoutOptions = (): SocialLayoutOption[] => SOCIAL_CANVAS_PRESETS.map((preset) => ({
  id: null, key: preset.key, name: preset.name, description: preset.description, definition: preset.definition,
  slots: socialLayoutSlots(preset.definition), archived: false,
}));

/** Duża grafika posta (siatka, panorama) — z migawki układu wariantu. */
const variantsCanvas = (variants: Row[]): SocialCanvas | null => variants.map((variant) => variantLayout(variant)?.canvas || null).find(Boolean) || null;

/** Kanały dozwolone dla dużej grafiki: siatka — tylko feed Instagram; panorama — bez relacji. */
function canvasChannels(canvas: SocialCanvas, channels: SocialChannel[]): SocialChannel[] {
  if (canvas.mode === 'grid') return ['instagram_feed'];
  const allowed = channels.filter((channel) => channel !== 'instagram_story');
  return allowed.length ? allowed : ['instagram_feed', 'facebook_feed'];
}

async function tileRows(ctx: NativeContext, postId: string): Promise<Row[]> {
  const { data, error } = await ctx.supabase.from('social_post_tiles').select('id, post_id, position, rendered_path, render_hash, rendered_at')
    .eq('post_id', postId).order('position');
  check(error, 'Nie udało się pobrać kafelków.');
  return (data || []) as Row[];
}

const renderedTiles = (rows: Row[]): RenderedTile[] => rows.map((row) => ({
  id: String(row.id), position: Number(row.position), renderedPath: text(row.rendered_path) || null, renderHash: text(row.render_hash) || null,
}));

/** Duża grafika w karcie posta: kształt, wymiary i opis. */
export type SocialCanvasDTO = {
  mode: 'grid' | 'panorama'; rows: number | null; slides: number | null; tiles: number; width: number; height: number; label: string;
};
/** Kafelek / slajd dużej grafiki (1 — lewy górny); siatka publikuje się od ostatniego. */
export type SocialTileDTO = { position: number; renderedUrl: string | null; upToDate: boolean };

const canvasDTO = (canvas: SocialCanvas): SocialCanvasDTO => ({
  mode: canvas.mode, rows: canvas.mode === 'grid' ? canvas.rows : null, slides: canvas.mode === 'panorama' ? canvas.slides : null,
  tiles: socialCanvasTileCount(canvas), ...socialCanvasSize(canvas), label: socialCanvasLabel(canvas),
});

type SlideRow = Row & { assetRow: Row | null };

async function slideRows(ctx: NativeContext, postId: string): Promise<SlideRow[]> {
  const { data, error } = await ctx.supabase.from('social_post_slides').select(`${SLIDE_FIELDS}, asset:social_assets(${ASSET_FIELDS})`).eq('post_id', postId);
  check(error, 'Nie udało się pobrać zdjęć karuzeli.');
  return ((data || []) as Row[])
    .map((row): SlideRow => ({ ...row, assetRow: isObject(row.asset) ? row.asset : null }))
    .sort((a, b) => Number(a.position) - Number(b.position) || SOCIAL_FORMATS.indexOf(a.format) - SOCIAL_FORMATS.indexOf(b.format));
}

/** Grafika zdjęcia karuzeli: szablon i styl okładki w tym formacie (albo pierwszej okładki), bez tytułu, podpisu i napisu. */
function slideSource(slide: SlideRow, variants: VariantRow[]) {
  const asset = slide.assetRow;
  if (!asset?.work_path || !Number(asset.width) || !Number(asset.height) || !isSocialFormat(slide.format)) return null;
  const cover = variants.find((variant) => variant.format === slide.format) || variants[0];
  return {
    format: slide.format as SocialFormat,
    workPath: String(asset.work_path),
    crop: effectiveCrop(isSocialCrop(slide.crop) ? slide.crop : null, isObject(asset.crops) ? asset.crops : null,
      Number(asset.width), Number(asset.height), slide.format as SocialFormat),
    headline: '',
    subline: '',
    style: variantStyle(cover?.style),
    kicker: '',
  };
}

/** Zdjęcie karuzeli (pozycja) z grafikami w formatach feedu okładki. */
export type SocialSlideDTO = {
  position: number;
  assetId: string;
  asset: SocialAssetDTO | null;
  formats: Array<{ format: SocialFormat; crop: SocialCrop | null; effectiveCrop: SocialCrop | null; renderedUrl: string | null; upToDate: boolean }>;
};

export type SocialVariantDTO = {
  id: string;
  format: SocialFormat;
  assetId: string | null;
  crop: SocialCrop | null;
  effectiveCrop: SocialCrop | null;
  headline: string;
  subline: string;
  /** Styl grafiki i napis nad tytułem (np. „Realizacja”). */
  style: SocialGraphicStyle;
  kicker: string;
  /** Proporcje kadru zdjęcia (szerokość / wysokość): format albo — w układzie — miejsce 0. */
  aspect: number;
  renderedUrl: string | null;
  renderedAt: string | null;
  upToDate: boolean;
  asset: SocialAssetDTO | null;
};

export type SocialPostDetail = {
  company: { id: string; name: string };
  post: SocialPostListItem & {
    caption: string;
    hashtags: string[];
    templateId: string | null;
    portfolioProjectId: string | null;
    aiSuggestions: unknown[];
    submittedAt: string | null;
    reviewedAt: string | null;
    reviewedByName: string | null;
    reviewNote: string | null;
    publishedByName: string | null;
    scheduledByName: string | null;
    publishAttempts: number;
    createdAt: string;
  };
  access: SocialAccess;
  actions: SocialPostAction[];
  /** „Opublikuj teraz” / „Ponów publikację” (publikujący, zatwierdzona wersja). */
  canPublishNow: boolean;
  variants: SocialVariantDTO[];
  /** Kolejne zdjęcia karuzeli (feed Instagram i Facebook) — okładka to `variants`. */
  slides: SocialSlideDTO[];
  /** Układ jako dane (zamiast stylu) i zdjęcia kolażu w miejscach 1–3; `layouts` — układy do wyboru. */
  layout: SocialPostLayoutDTO | null;
  layouts: SocialLayoutOption[];
  slots: SocialSlotDTO[];
  /** Siatka profilu / panorama: kształt dużej grafiki, kafelki (po zapisie) i gotowe układy dużej grafiki do wyboru. */
  canvas: SocialCanvasDTO | null;
  tiles: SocialTileDTO[];
  canvasLayouts: SocialLayoutOption[];
  channelFormats: Partial<Record<SocialChannel, SocialFormat | null>>;
  /** `meta` — co blokuje automatyczną publikację w Meta (konto, uprawnienia, grafiki). */
  problems: { submit: string[]; publish: string[]; meta: string[] };
  publications: SocialPublicationDTO[];
  meta: SocialMetaStatus | null;
  comments: { total: number; unanswered: number };
  history: Array<{ kind: string; actorName: string | null; note: string | null; revision: number | null; createdAt: string }>;
  template: SocialTemplateDTO | null;
  templates: SocialTemplateDTO[];
  spec: SocialGraphicSpec | null;
  event: { id: string; name: string; date: string | null; location: string; organizationName: string | null } | null;
  portfolio: { id: string; title: string } | null;
  /** Siatka profilu: posty z CRM (zatwierdzone, zaplanowane) i — gdy Instagram jest połączony — ostatnie posty z profilu. */
  grid: Array<{ id: string; status: SocialPostStatus; imageUrl: string | null; date: string | null; source: 'crm' | 'instagram'; permalink: string | null }>;
  publicationText: string;
  settings: ReturnType<typeof settingsDTO>;
};

export type SocialPublicationDTO = {
  channel: SocialChannel;
  /** Kafelek siatki profilu (1 — lewy górny; siatka — osobny post na kafelek); 0 — cały post. */
  tile: number;
  status: string;
  format: SocialFormat | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  publishedAt: string | null;
  attemptedAt: string | null;
  /** Wyniki z Meta (Etap 3): stan narastająco od publikacji; brak klucza — Meta nie podaje metryki dla kanału. */
  metrics: SocialMetricValues;
  rate: number | null;
  metricsSyncedAt: string | null;
  metricsError: string | null;
};

const publicationDTO = (row: Row): SocialPublicationDTO => ({
  channel: row.channel as SocialChannel,
  tile: Number(row.tile) || 0,
  status: text(row.status),
  format: isSocialFormat(row.format) ? row.format : null,
  permalink: text(row.permalink) || null,
  error: text(row.error) || null,
  attempts: Number(row.attempts) || 0,
  publishedAt: text(row.published_at) || null,
  attemptedAt: text(row.attempted_at) || null,
  metrics: socialMetricsFromRow(isObject(row.metrics) ? row.metrics : null),
  rate: socialEngagementRate(socialMetricsFromRow(isObject(row.metrics) ? row.metrics : null)),
  metricsSyncedAt: text(row.metrics_synced_at) || null,
  metricsError: text(row.metrics_error) || null,
});

/** Braki blokujące publikację w Meta: konto i uprawnienia kanałów oraz wygenerowane grafiki (duża grafika — kafelki). */
function metaProblems(
  account: SocialMetaAccount | null, channels: SocialChannel[], renderedFormats: SocialFormat[], slides: SocialSlideDTO[] = [],
  tilesReady: boolean | null = null,
): string[] {
  return channels.flatMap((channel) => {
    const label = SOCIAL_CHANNEL_LABELS[channel];
    const problem = account ? account.channels[channel].problem
      : `nie udało się sprawdzić połączenia z ${channel === 'linkedin_page' ? 'LinkedIn' : 'Meta'}.`;
    const format = channelFormat(channel, renderedFormats);
    const slidesMissing = channel !== 'instagram_story' && format
      && slides.some((slide) => !slide.formats.some((item) => item.format === format && item.renderedUrl));
    return [
      problem ? `${label}: ${problem}` : null,
      tilesReady === null ? (format ? null : `${label}: brak wygenerowanej grafiki — zapisz post.`)
        : tilesReady ? null : `${label}: brak aktualnych kafelków — zapisz post.`,
      tilesReady === null && slidesMissing ? `${label}: brak grafik karuzeli — zapisz post.` : null,
    ].filter((item): item is string => Boolean(item));
  });
}

/** Karta posta. */
export async function socialPost(ctx: NativeContext, id: string): Promise<SocialPostDetail> {
  const row = await postRow(ctx, id);
  const companyId = String(row.company_id);
  const [access, variants, templates, historyResult, submitProblems, publishProblems, settings, companyRow, publicationsResult,
    commentRows, metaAccount, slides, slots, tiles] = await Promise.all([
    socialAccess(ctx, companyId),
    variantRows(ctx, id),
    loadTemplates(ctx, companyId),
    ctx.supabase.from('social_post_events').select('kind, actor_id, note, revision, created_at').eq('post_id', id).order('created_at', { ascending: false }).limit(60),
    ctx.supabase.rpc('social_post_problems', { p_post_id: id, p_require_consent: false }),
    ctx.supabase.rpc('social_post_problems', { p_post_id: id, p_require_consent: true }),
    ctx.supabase.from('social_settings').select('*').eq('company_id', companyId).maybeSingle(),
    ctx.supabase.from('my_companies').select('id, name').eq('id', companyId).maybeSingle(),
    ctx.supabase.from('social_publications')
      .select('channel, tile, status, format, permalink, error, attempts, published_at, attempted_at, metrics, metrics_synced_at, metrics_error').eq('post_id', id),
    ctx.supabase.from('social_comments').select('parent_external_id, is_own, answered_at').eq('post_id', id).limit(2000),
    socialMetaAccount(companyId).catch((error) => {
      console.warn('[social] meta account', errorMessage(error));
      return null;
    }),
    slideRows(ctx, id),
    slotRows(ctx, id),
    tileRows(ctx, id),
  ]);
  const publications = ((publicationsResult.data || []) as Row[]).map(publicationDTO)
    .sort((a, b) => SOCIAL_CHANNELS.indexOf(a.channel) - SOCIAL_CHANNELS.indexOf(b.channel) || a.tile - b.tile);
  const topComments = ((commentRows.data || []) as Row[]).filter((item) => !item.parent_external_id && !item.is_own);
  const template = pickTemplate(templates, row.template_id);
  const [listItem] = await listItems(ctx, [row]);
  const history = (historyResult.data || []) as Row[];
  const names = await employeeNames(ctx.supabase, [...history.map((item) => item.actor_id), row.reviewed_by, row.published_by, row.scheduled_by]);
  const assets = await assetDTOs(ctx, [...variants, ...slides, ...slots].map((item) => item.assetRow).filter((asset): asset is Row => Boolean(asset))
    .filter((asset, index, list) => list.findIndex((item) => item.id === asset.id) === index), { work: true });
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const rendered = await signedUrls(ctx.supabase, [...variants, ...slides, ...tiles].map((item) => item.rendered_path));
  const postLayout = postLayoutDTO(variants);
  const canvas = postLayout?.definition.canvas || null;
  // Kafelki dużej grafiki: aktualne, gdy mają skrót aktualnej grafiki wariantu 4:5 (wszystkie z jednego renderu).
  const canvasVariant = canvas ? variants.find((variant) => variant.format === '4:5') || variants[0] : null;
  const canvasSource = canvasVariant ? renderSource(canvasVariant, slots) : null;
  const canvasExpected = canvas && template && canvasSource && !template.problems.length ? renderHash(template, canvasSource) : null;
  const tileDTOs: SocialTileDTO[] = canvas ? tiles.filter((tile) => Number(tile.position) <= socialCanvasTileCount(canvas)).map((tile) => ({
    position: Number(tile.position),
    renderedUrl: tile.rendered_path ? rendered.get(tile.rendered_path) || null : null,
    upToDate: Boolean(canvasExpected && tile.render_hash === canvasExpected && tile.rendered_path),
  })) : [];
  const tilesReady = canvas ? tileDTOs.length === socialCanvasTileCount(canvas) && tileDTOs.every((tile) => tile.upToDate) : null;
  const variantDTOs: SocialVariantDTO[] = variants.map((variant) => {
    const source = renderSource(variant, slots);
    const expected = template && source && !template.problems.length ? renderHash(template, source) : null;
    return {
      id: String(variant.id),
      format: variant.format as SocialFormat,
      assetId: uuidOrNull(variant.asset_id),
      crop: isSocialCrop(variant.crop) ? variant.crop : null,
      effectiveCrop: source?.crop || null,
      headline: text(variant.headline),
      subline: text(variant.subline),
      style: variantStyle(variant.style),
      kicker: text(variant.kicker),
      aspect: Math.round(socialLayoutSlotAspect(variantLayout(variant), 0, variant.format as SocialFormat) * 10000) / 10000,
      renderedUrl: variant.rendered_path ? rendered.get(variant.rendered_path) || null : null,
      renderedAt: text(variant.rendered_at) || null,
      upToDate: Boolean(expected && variant.render_hash === expected && variant.rendered_path) && tilesReady !== false,
      asset: variant.asset_id ? assetById.get(String(variant.asset_id)) || null : null,
    };
  });
  const formats = variantDTOs.filter((variant) => variant.assetId).map((variant) => variant.format);
  const channels = channelsOf(row.channels);
  const slideDTOs: SocialSlideDTO[] = [];
  for (const slide of slides) {
    const position = Number(slide.position);
    let entry = slideDTOs.find((item) => item.position === position);
    if (!entry) {
      entry = { position, assetId: String(slide.asset_id), asset: assetById.get(String(slide.asset_id)) || null, formats: [] };
      slideDTOs.push(entry);
    }
    const source = slideSource(slide, variants);
    const expected = template && source && !template.problems.length ? renderHash(template, source) : null;
    entry.formats.push({
      format: slide.format as SocialFormat,
      crop: isSocialCrop(slide.crop) ? slide.crop : null,
      effectiveCrop: source?.crop || null,
      renderedUrl: slide.rendered_path ? rendered.get(slide.rendered_path) || null : null,
      upToDate: Boolean(expected && slide.render_hash === expected && slide.rendered_path),
    });
  }

  const slotDTOs: SocialSlotDTO[] = [];
  for (const row of slots) {
    const slot = Number(row.slot);
    let entry = slotDTOs.find((item) => item.slot === slot);
    if (!entry) {
      entry = { slot, assetId: String(row.asset_id), asset: assetById.get(String(row.asset_id)) || null, formats: [] };
      slotDTOs.push(entry);
    }
    const format = row.format as SocialFormat;
    const layout = variantLayout(variants.find((variant) => variant.format === format));
    const aspect = socialLayoutSlotAspect(layout, slot, format);
    entry.formats.push({
      format,
      crop: isSocialCrop(row.crop) ? row.crop : null,
      effectiveCrop: usableAsset(row.assetRow) ? layoutCrop(row.crop, row.assetRow, format, aspect) : null,
      aspect: Math.round(aspect * 10000) / 10000,
    });
  }
  const layouts = await layoutOptions(ctx, companyId, postLayout?.id || null);
  if (postLayout) {
    const option = [...layouts, ...canvasLayoutOptions()]
      .find((item) => (postLayout.id ? item.id === postLayout.id : Boolean(postLayout.key) && item.key === postLayout.key));
    // Porównanie znormalizowanych definicji (ta sama kolejność pól i zaokrąglenia po obu stronach).
    postLayout.outdated = Boolean(option) && JSON.stringify(parseSocialLayout(option!.definition)) !== JSON.stringify(parseSocialLayout(postLayout.definition));
  }

  let event: SocialPostDetail['event'] = null;
  if (isUuid(row.event_id)) {
    const { data: eventData } = await ctx.supabase.from('events')
      .select('id, name, event_date, location, organization:organizations!events_organization_id_fkey(name), venue:locations(name, city)')
      .eq('id', row.event_id).maybeSingle();
    const data = eventData as Row | null;
    if (data) {
      const venue = isObject(data.venue) ? data.venue : null;
      event = {
        id: String(data.id),
        name: text(data.name),
        date: text(data.event_date) || null,
        location: venue ? [text(venue.name), text(venue.city)].filter(Boolean).join(', ') : text(data.location),
        organizationName: isObject(data.organization) ? text(data.organization.name) || null : null,
      };
    }
  }
  let portfolio: SocialPostDetail['portfolio'] = null;
  if (isUuid(row.portfolio_project_id)) {
    const { data } = await ctx.supabase.from('portfolio_projects').select('id, title').eq('id', row.portfolio_project_id).maybeSingle();
    if (data) portfolio = { id: String(data.id), title: text(data.title) };
  }

  // Siatka profilu: posty marki z CRM i — gdy Instagram jest połączony — prawdziwe ostatnie posty z profilu
  // (wtedy z CRM tylko jeszcze nieopublikowane: zatwierdzone, zaplanowane, publikowane).
  const instagramGrid = metaAccount ? await instagramRecentMedia(metaAccount, companyId) : null;
  const { data: gridRows } = await ctx.supabase.from('social_posts').select('id, status, scheduled_at, published_at')
    .eq('company_id', companyId).neq('id', id)
    .in('status', instagramGrid ? ['approved', 'scheduled', 'publishing'] : ['published', 'approved', 'scheduled', 'publishing'])
    .order('scheduled_at', { ascending: false, nullsFirst: false }).limit(12);
  const gridIds = ((gridRows || []) as Row[]).map((item) => String(item.id));
  const { data: gridVariants } = gridIds.length
    ? await ctx.supabase.from('social_post_variants').select('post_id, format, rendered_path, canvas:layout->canvas').in('post_id', gridIds).in('format', ['4:5', '1:1'])
    : { data: [] as Row[] };
  const gridPath = new Map<string, string>();
  const gridSeries = new Set<string>();
  for (const variant of (gridVariants || []) as Row[]) {
    if (parseSocialCanvas(variant.canvas)?.mode === 'grid') gridSeries.add(String(variant.post_id));
    if (!variant.rendered_path) continue;
    if (!gridPath.has(String(variant.post_id)) || variant.format === '4:5') gridPath.set(String(variant.post_id), String(variant.rendered_path));
  }
  // Inne siatki profilu zajmują w siatce tyle pól, ile mają kafelków (kafelek 1 — najnowszy, na początku).
  const { data: seriesTiles } = gridSeries.size
    ? await ctx.supabase.from('social_post_tiles').select('post_id, position, rendered_path').in('post_id', Array.from(gridSeries)).order('position')
    : { data: [] as Row[] };
  const tilesByPost = new Map<string, Row[]>();
  for (const tile of (seriesTiles || []) as Row[]) {
    const list = tilesByPost.get(String(tile.post_id)) || [];
    list.push(tile);
    tilesByPost.set(String(tile.post_id), list);
  }
  const gridUrls = await signedUrls(ctx.supabase, [...Array.from(gridPath.values()), ...((seriesTiles || []) as Row[]).map((tile) => tile.rendered_path)]);

  const hashtags = Array.isArray(row.hashtags) ? (row.hashtags as unknown[]).map(text) : [];
  return {
    company: { id: companyId, name: text(companyRow.data?.name) || 'Marka' },
    post: {
      ...listItem,
      caption: text(row.caption),
      hashtags,
      templateId: template?.id || null,
      portfolioProjectId: uuidOrNull(row.portfolio_project_id),
      aiSuggestions: Array.isArray(row.ai_suggestions) ? row.ai_suggestions : [],
      submittedAt: text(row.submitted_at) || null,
      reviewedAt: text(row.reviewed_at) || null,
      reviewedByName: row.reviewed_by ? names.get(String(row.reviewed_by).toLowerCase()) || null : null,
      reviewNote: text(row.review_note) || null,
      publishedByName: row.published_by ? names.get(String(row.published_by).toLowerCase()) || null : null,
      scheduledByName: row.scheduled_by ? names.get(String(row.scheduled_by).toLowerCase()) || null : null,
      publishAttempts: Number(row.publish_attempts) || 0,
      createdAt: text(row.created_at),
    },
    access,
    actions: socialPostActions({
      status: listItem.status, authorId: listItem.authorId, revision: listItem.revision, approvedRevision: listItem.approvedRevision,
    }, access, { partial: publications.some((publication) => publication.status === 'published') }),
    canPublishNow: socialCanPublishNow(listItem, access),
    variants: variantDTOs,
    slides: slideDTOs,
    layout: postLayout,
    layouts,
    slots: slotDTOs,
    canvas: canvas ? canvasDTO(canvas) : null,
    tiles: tileDTOs,
    canvasLayouts: canvasLayoutOptions(),
    channelFormats: Object.fromEntries(channels.map((channel) => [channel, channelFormat(channel, formats)])),
    problems: {
      submit: Array.isArray(submitProblems.data) ? (submitProblems.data as unknown[]).map(text) : [],
      publish: Array.isArray(publishProblems.data) ? (publishProblems.data as unknown[]).map(text) : [],
      meta: metaProblems(metaAccount, channels.filter((channel) => !publications.some((item) => item.channel === channel && item.status === 'published')),
        variantDTOs.filter((variant) => variant.assetId && variant.renderedUrl).map((variant) => variant.format), slideDTOs, tilesReady),
    },
    publications,
    meta: metaAccount ? metaStatusDTO(metaAccount) : null,
    comments: { total: topComments.length, unanswered: topComments.filter((item) => !item.answered_at).length },
    history: history.map((item) => ({
      kind: text(item.kind),
      actorName: item.actor_id ? names.get(String(item.actor_id).toLowerCase()) || null : null,
      note: text(item.note) || null,
      revision: item.revision == null ? null : Number(item.revision),
      createdAt: text(item.created_at),
    })),
    template: template ? templateDTO(template) : null,
    templates: templates.map(templateDTO),
    spec: template ? await graphicSpec(template) : null,
    event,
    portfolio,
    grid: [
      ...((gridRows || []) as Row[]).flatMap((item) => {
        const base = {
          status: text(item.status) as SocialPostStatus, date: text(item.published_at) || text(item.scheduled_at) || null, source: 'crm' as const, permalink: null,
        };
        const series = tilesByPost.get(String(item.id));
        if (series?.length) {
          return series.map((tile) => ({ ...base, id: `${String(item.id)}-${Number(tile.position)}`, imageUrl: tile.rendered_path ? gridUrls.get(String(tile.rendered_path)) || null : null }));
        }
        return [{ ...base, id: String(item.id), imageUrl: gridPath.has(String(item.id)) ? gridUrls.get(gridPath.get(String(item.id)) as string) || null : null }];
      }),
      ...(instagramGrid || []).map((item) => ({
        id: `ig-${item.id}`,
        status: 'published' as SocialPostStatus,
        imageUrl: item.imageUrl,
        date: item.date,
        source: 'instagram' as const,
        permalink: item.permalink,
      })),
    ].slice(0, 12),
    publicationText: socialPublicationText(text(row.caption), hashtags),
    settings: settingsDTO(settings.data as Row | null),
  };
}

/** Render nieaktualnych grafik posta (np. po zmianie kadru, tekstu albo księgi znaku). */
async function renderStale(ctx: NativeContext, post: Row, templates?: LoadedTemplate[]) {
  const list = templates || await loadTemplates(ctx, String(post.company_id));
  const template = pickTemplate(list, post.template_id);
  if (!template || template.problems.length) return { rendered: 0, skipped: template ? template.problems : ['Marka nie ma szablonu grafik.'] };
  const [variants, slides, slots] = await Promise.all([
    variantRows(ctx, String(post.id)), slideRows(ctx, String(post.id)), slotRows(ctx, String(post.id)),
  ]);
  let rendered = 0;
  for (const variant of variants) {
    const source = renderSource(variant, slots);
    if (!source) continue;
    if (source.layout?.canvas) {
      // Duża grafika: jeden render i kafelki (tylko wariant 4:5 — inne formaty nie występują w siatce i panoramie).
      if (variant.format !== '4:5') continue;
      const result = await renderCanvas(ctx, { id: String(post.id), companyId: String(post.company_id) }, template,
        { id: String(variant.id), renderedPath: variant.rendered_path || null, renderHash: variant.render_hash || null }, source,
        renderedTiles(await tileRows(ctx, String(post.id))));
      if (result.rendered) rendered += 1;
      continue;
    }
    const result = await renderVariant(ctx, { id: String(post.id), companyId: String(post.company_id) }, template,
      { id: String(variant.id), renderedPath: variant.rendered_path || null, renderHash: variant.render_hash || null }, source);
    if (result.rendered) rendered += 1;
  }
  for (const slide of slides) {
    const source = slideSource(slide, variants);
    if (!source) continue;
    const result = await renderVariant(ctx, { id: String(post.id), companyId: String(post.company_id) }, template,
      { id: String(slide.id), renderedPath: slide.rendered_path || null, renderHash: slide.render_hash || null }, source,
      { position: Number(slide.position) });
    if (result.rendered) rendered += 1;
  }
  return { rendered, skipped: [] as string[] };
}

function editable(row: Row) {
  if (row.status === 'published' || row.status === 'cancelled') {
    fail('Opublikowanego ani anulowanego posta nie można zmieniać — przywróć go do szkicu albo zrób kopię.', 409);
  }
  if (row.status === 'publishing') fail('Post jest właśnie publikowany — poczekaj chwilę i odśwież widok.', 409);
}

function scheduledValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) fail('Nieprawidłowy termin publikacji.');
  return date.toISOString();
}

/** Pola posta z żądania (tylko podane). */
function postPatch(body: Row): Row {
  const patch: Row = {};
  if ('title' in body) patch.title = text(body.title).trim().slice(0, SOCIAL_LIMITS.title);
  if ('channels' in body) {
    const channels = Array.isArray(body.channels) ? body.channels.filter(isSocialChannel) : [];
    patch.channels = Array.from(new Set(channels));
  }
  if ('scheduledAt' in body) patch.scheduled_at = scheduledValue(body.scheduledAt);
  if ('caption' in body) patch.caption = text(body.caption).slice(0, SOCIAL_LIMITS.caption);
  if ('hashtags' in body) {
    const hashtags = normalizeHashtags(Array.isArray(body.hashtags) ? body.hashtags.map(text) : text(body.hashtags));
    if (hashtags.length > SOCIAL_LIMITS.hashtags) fail(`Instagram przyjmuje najwyżej ${SOCIAL_LIMITS.hashtags} hashtagów.`);
    patch.hashtags = hashtags;
  }
  if ('templateId' in body) patch.template_id = uuidOrNull(body.templateId);
  if ('eventId' in body) patch.event_id = uuidOrNull(body.eventId);
  if ('portfolioProjectId' in body) patch.portfolio_project_id = uuidOrNull(body.portfolioProjectId);
  return patch;
}

/** Wariant z żądania; `style` i `kicker` pominięte (starsze wersje aplikacji) — bez zmiany zapisanych. */
type VariantInput = {
  format: SocialFormat; assetId: string | null; crop: SocialCrop | null; headline: string; subline: string;
  style?: SocialGraphicStyle; kicker?: string;
};

function variantInputs(value: unknown): VariantInput[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const result: VariantInput[] = [];
  for (const item of value) {
    if (!isObject(item) || !isSocialFormat(item.format) || seen.has(item.format)) continue;
    seen.add(item.format);
    result.push({
      format: item.format,
      assetId: uuidOrNull(item.assetId),
      crop: isSocialCrop(item.crop) ? item.crop : null,
      headline: text(item.headline).trim().replace(/\s+/g, ' ').slice(0, SOCIAL_LIMITS.headline),
      subline: text(item.subline).trim().replace(/\s+/g, ' ').slice(0, SOCIAL_LIMITS.subline),
      ...(isSocialGraphicStyle(item.style) ? { style: item.style } : {}),
      ...('kicker' in item ? { kicker: kickerText(item.kicker) } : {}),
    });
  }
  return result;
}

/**
 * Zapis wariantów: usunięcie niepotrzebnych formatów, zmiana i dodanie pozostałych (kadr dopasowany do proporcji).
 * Styl i napis bez wartości w żądaniu: zapisane w wariancie, a w nowym formacie — jak w pozostałych formatach posta
 * albo domyślny styl szablonu marki.
 */
async function saveVariants(
  ctx: NativeContext, post: Row, inputs: VariantInput[], defaultStyle: SocialGraphicStyle = 'classic',
  /** Układ posta: `undefined` — bez zmiany (nowy format dostaje układ pozostałych), `null`-owy snapshot — styl grafiki. */
  layoutChoice?: LayoutChoice,
) {
  const current = await variantRows(ctx, String(post.id));
  const postStyle = current.length ? variantStyle(current[0].style) : defaultStyle;
  const postKicker = current.length ? text(current[0].kicker) : '';
  const postLayout = current.find((variant) => variant.layout) || null;
  const layoutOf = (existing: VariantRow | undefined): LayoutChoice => layoutChoice
    ?? (existing ? { id: uuidOrNull(existing.layout_id), snapshot: isObject(existing.layout) ? existing.layout : null }
      : { id: uuidOrNull(postLayout?.layout_id), snapshot: isObject(postLayout?.layout) ? postLayout!.layout as Row : null });
  const assetIds = Array.from(new Set(inputs.map((input) => input.assetId).filter((id): id is string => Boolean(id))));
  const { data: assetData } = assetIds.length
    ? await ctx.supabase.from('social_assets').select('id, company_id, status, width, height').in('id', assetIds)
    : { data: [] as Row[] };
  const assets = new Map(((assetData || []) as Row[]).map((row) => [String(row.id), row]));
  for (const id of assetIds) {
    const asset = assets.get(id);
    if (!asset || asset.company_id !== post.company_id) fail('Wybierz zdjęcie z biblioteki tej marki.', 400);
    if (!['ready', 'proposed'].includes(text(asset.status))) fail('To zdjęcie jest w archiwum albo jeszcze się wgrywa.', 409);
  }
  const wanted = new Set(inputs.map((input) => input.format));
  const removed = current.filter((variant) => !wanted.has(variant.format));
  if (removed.length) {
    const { error } = await ctx.supabase.from('social_post_variants').delete().in('id', removed.map((variant) => variant.id));
    check(error, 'Nie udało się usunąć formatu grafiki.');
    await removeSocialFiles(ctx.supabase, removed.map((variant) => variant.rendered_path));
  }
  for (const input of inputs) {
    const asset = input.assetId ? assets.get(input.assetId) : null;
    const existing = current.find((variant) => variant.format === input.format);
    const layout = layoutOf(existing);
    const definition = parseSocialLayout(layout.snapshot);
    // Kadr w proporcjach miejsca 0 układu albo formatu (styl).
    const crop = input.crop && asset
      ? definition
        ? fitAspectCrop(input.crop, Number(asset.width), Number(asset.height), socialLayoutSlotAspect(definition, 0, input.format))
        : fitCrop(input.crop, Number(asset.width), Number(asset.height), input.format)
      : null;
    const style = input.style ?? (existing ? variantStyle(existing.style) : postStyle);
    const kicker = input.kicker ?? (existing ? text(existing.kicker) : postKicker);
    const values = {
      asset_id: input.assetId, crop, headline: input.headline, subline: input.subline, style, kicker,
      layout_id: definition ? layout.id : null, layout: definition ? layout.snapshot : null,
    };
    if (existing) {
      const same = existing.asset_id === input.assetId && JSON.stringify(existing.crop ?? null) === JSON.stringify(crop)
        && text(existing.headline) === input.headline && text(existing.subline) === input.subline
        && variantStyle(existing.style) === style && text(existing.kicker) === kicker
        && uuidOrNull(existing.layout_id) === values.layout_id && JSON.stringify(existing.layout ?? null) === JSON.stringify(values.layout);
      if (same) continue;
      const { error } = await ctx.supabase.from('social_post_variants').update(values).eq('id', existing.id);
      check(error, 'Nie udało się zapisać grafiki.');
    } else {
      const { error } = await ctx.supabase.from('social_post_variants').insert({ post_id: post.id, format: input.format, ...values });
      check(error, 'Nie udało się dodać formatu grafiki.');
    }
  }
}

/** Zdjęcie karuzeli z żądania: zdjęcie z biblioteki i (opcjonalnie) kadry w formatach feedu. */
type SlideInput = { assetId: string; crops: Partial<Record<SocialFormat, SocialCrop | null>> };

function slideInputs(value: unknown): SlideInput[] | null {
  if (!Array.isArray(value)) return null;
  const result: SlideInput[] = [];
  for (const item of value) {
    const assetId = isObject(item) ? uuidOrNull(item.assetId) : uuidOrNull(item);
    if (!assetId) continue;
    // Kadr w formacie: wartość — ten kadr, `null` — propozycja zdjęcia, brak klucza — dotychczasowy kadr tego zdjęcia.
    const crops: Partial<Record<SocialFormat, SocialCrop | null>> = {};
    if (isObject(item) && isObject(item.crops)) {
      const source = item.crops as Row;
      for (const format of SOCIAL_SLIDE_FORMATS) {
        if (format in source) crops[format] = isSocialCrop(source[format]) ? (source[format] as SocialCrop) : null;
      }
    }
    result.push({ assetId, crops });
  }
  if (result.length > SOCIAL_LIMITS.slides) {
    fail(`Karuzela może mieć najwyżej ${SOCIAL_LIMITS.slides + 1} zdjęć (okładka i ${SOCIAL_LIMITS.slides} kolejnych).`);
  }
  return result;
}

/**
 * Zdjęcia karuzeli: pozycje 1…n w każdym formacie feedu okładki (4:5, 1:1, 1.91:1). `inputs = null` — te same zdjęcia,
 * tylko dopasowanie do formatów okładki (np. po dodaniu albo usunięciu formatu). Kadr bez wartości w żądaniu — dotychczasowy
 * kadr tego zdjęcia w tym formacie (także po zmianie kolejności) albo propozycja zdjęcia.
 */
async function saveSlides(ctx: NativeContext, post: Row, inputs: SlideInput[] | null) {
  const [variants, current] = await Promise.all([variantRows(ctx, String(post.id)), slideRows(ctx, String(post.id))]);
  if (!inputs && !current.length) return;
  let wanted: SlideInput[];
  if (inputs) {
    wanted = inputs;
  } else {
    const byPosition = new Map<number, SlideInput>();
    for (const slide of current) {
      const position = Number(slide.position);
      const entry = byPosition.get(position) || { assetId: String(slide.asset_id), crops: {} };
      if (entry.assetId === String(slide.asset_id) && isSocialCrop(slide.crop)) entry.crops[slide.format as SocialFormat] = slide.crop;
      byPosition.set(position, entry);
    }
    wanted = Array.from(byPosition.entries()).sort((a, b) => a[0] - b[0]).map(([, entry]) => entry);
  }
  const formats = SOCIAL_SLIDE_FORMATS.filter((format) => variants.some((variant) => variant.format === format && variant.asset_id));
  const assetIds = Array.from(new Set(wanted.map((input) => input.assetId)));
  const { data: assetData } = assetIds.length
    ? await ctx.supabase.from('social_assets').select('id, company_id, status, width, height').in('id', assetIds)
    : { data: [] as Row[] };
  const assets = new Map(((assetData || []) as Row[]).map((row) => [String(row.id), row]));
  if (inputs) {
    for (const id of assetIds) {
      const asset = assets.get(id);
      if (!asset || asset.company_id !== post.company_id) fail('Wybierz zdjęcia karuzeli z biblioteki tej marki.', 400);
      const known = current.some((slide) => String(slide.asset_id) === id);
      if (!known && !['ready', 'proposed'].includes(text(asset.status))) fail('Zdjęcie karuzeli jest w archiwum albo jeszcze się wgrywa.', 409);
    }
  }
  const existing = new Map(current.map((slide) => [`${slide.position}|${slide.format}`, slide]));
  const desired = new Map<string, { position: number; format: SocialFormat; asset_id: string; crop: SocialCrop | null }>();
  wanted.forEach((input, index) => {
    const asset = assets.get(input.assetId);
    if (!asset) return;
    for (const format of formats) {
      const position = index + 1;
      const key = `${position}|${format}`;
      // Nowy format dla zdjęcia, które tymczasem trafiło do archiwum — pomijamy (baza i tak by go nie przyjęła).
      if (!existing.has(key) && !['ready', 'proposed'].includes(text(asset.status))) continue;
      const previous = current.find((slide) => String(slide.asset_id) === input.assetId && slide.format === format && isSocialCrop(slide.crop));
      const raw = format in input.crops ? input.crops[format] ?? null : previous ? (previous.crop as SocialCrop) : null;
      const crop = raw ? fitCrop(raw, Number(asset.width), Number(asset.height), format) : null;
      desired.set(key, { position, format, asset_id: input.assetId, crop });
    }
  });
  const removed = current.filter((slide) => !desired.has(`${slide.position}|${slide.format}`));
  if (removed.length) {
    const { error } = await ctx.supabase.from('social_post_slides').delete().in('id', removed.map((slide) => slide.id));
    check(error, 'Nie udało się usunąć zdjęcia karuzeli.');
    await removeSocialFiles(ctx.supabase, removed.map((slide) => slide.rendered_path));
  }
  for (const [key, values] of desired) {
    const slide = existing.get(key);
    if (slide) {
      if (String(slide.asset_id) === values.asset_id && JSON.stringify(slide.crop ?? null) === JSON.stringify(values.crop)) continue;
      const { error } = await ctx.supabase.from('social_post_slides').update({ asset_id: values.asset_id, crop: values.crop }).eq('id', slide.id);
      check(error, 'Nie udało się zapisać zdjęcia karuzeli.');
    } else {
      const { error } = await ctx.supabase.from('social_post_slides').insert({ post_id: post.id, ...values });
      check(error, 'Nie udało się dodać zdjęcia karuzeli.');
    }
  }
}

/** Wybrany układ posta: wskazanie układu marki (albo `null` — gotowy układ / styl) i migawka definicji (`null` — styl). */
type LayoutChoice = { id: string | null; snapshot: Row | null };

/**
 * Układ z żądania: brak klucza `layout` — bez zmiany; `null` — styl grafiki; `{ id }` — układ marki; `{ key }` — gotowy
 * układ. Ten sam układ co w poście zostaje z dotychczasową migawką (zatwierdzony wygląd), chyba że `refresh: true`
 * (aktualna wersja układu marki).
 */
async function resolveLayout(ctx: NativeContext, companyId: string, body: Row, current: VariantRow[]): Promise<LayoutChoice | undefined> {
  if (!('layout' in body)) return undefined;
  const value = body.layout;
  if (value === null || value === '' || value === false) return { id: null, snapshot: null };
  if (!isObject(value)) fail('Nieznany układ grafiki.', 400);
  const used = current.find((variant) => variant.layout) || null;
  const usedSource = layoutSource(used?.layout);
  const refresh = value.refresh === true;
  const id = uuidOrNull(value.id);
  if (id) {
    if (!refresh && used && (uuidOrNull(used.layout_id) || usedSource.id) === id && parseSocialLayout(used.layout)) {
      return { id, snapshot: used.layout as Row };
    }
    const { data } = await ctx.supabase.from('social_layouts').select(LAYOUT_FIELDS).eq('id', id).eq('company_id', companyId).maybeSingle();
    const row = data as Row | null;
    if (!row) fail('Nie znaleziono układu w tej marce.', 404);
    if (row.is_archived && !(used && uuidOrNull(used.layout_id) === id)) fail('Ten układ jest w archiwum — wybierz inny.', 409);
    const definition = parseSocialLayout(row.definition);
    if (!definition) fail('Układ jest niekompletny — popraw go w edytorze układów.', 422);
    return { id, snapshot: { ...definition, source: { kind: 'brand', id, name: text(row.name) } } };
  }
  const key = typeof value.key === 'string' ? value.key : '';
  const preset = socialLayoutPreset(key);
  if (!preset) fail('Nieznany układ grafiki.', 400);
  if (!refresh && used && usedSource.key === key && parseSocialLayout(used.layout)) return { id: null, snapshot: used.layout as Row };
  return { id: null, snapshot: { ...preset.definition, source: { kind: 'preset', key, name: preset.name } } };
}

/** Zdjęcie kolażu z żądania: miejsce 1–3, zdjęcie z biblioteki i (opcjonalnie) kadry w formatach. */
type SlotInput = { slot: number; assetId: string; crops: Partial<Record<SocialFormat, SocialCrop | null>> };

function slotInputs(value: unknown): SlotInput[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  const result: SlotInput[] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const slot = Number(item.slot);
    const assetId = uuidOrNull(item.assetId);
    if (!Number.isInteger(slot) || slot < 1 || slot > 3 || !assetId || seen.has(slot)) continue;
    seen.add(slot);
    // Kadr: wartość — ten kadr, `null` — propozycja, brak klucza — dotychczasowy kadr tego zdjęcia w tym miejscu.
    const crops: Partial<Record<SocialFormat, SocialCrop | null>> = {};
    if (isObject(item.crops)) {
      const source = item.crops as Row;
      for (const format of SOCIAL_FORMATS) {
        if (format in source) crops[format] = isSocialCrop(source[format]) ? (source[format] as SocialCrop) : null;
      }
    }
    result.push({ slot, assetId, crops });
  }
  return result;
}

/**
 * Zdjęcia kolażu: miejsca 1…n-1 układu posta w każdym formacie z grafiką. `inputs = null` — te same zdjęcia, tylko
 * dopasowanie do układu i formatów (nadmiarowe miejsca i formaty usuwane, kadry dopasowane do proporcji miejsc).
 */
async function saveSlots(ctx: NativeContext, post: Row, inputs: SlotInput[] | null) {
  const [variants, current] = await Promise.all([variantRows(ctx, String(post.id)), slotRows(ctx, String(post.id))]);
  if (!inputs && !current.length) return;
  const wanted = new Map<number, SlotInput>();
  if (inputs) {
    for (const input of inputs) wanted.set(input.slot, input);
  } else {
    for (const row of current) {
      const slot = Number(row.slot);
      const entry = wanted.get(slot) || { slot, assetId: String(row.asset_id), crops: {} };
      if (entry.assetId === String(row.asset_id) && isSocialCrop(row.crop)) entry.crops[row.format as SocialFormat] = row.crop;
      wanted.set(slot, entry);
    }
  }
  const assetIds = Array.from(new Set(Array.from(wanted.values()).map((input) => input.assetId)));
  const { data: assetData } = assetIds.length
    ? await ctx.supabase.from('social_assets').select('id, company_id, status, width, height').in('id', assetIds)
    : { data: [] as Row[] };
  const assets = new Map(((assetData || []) as Row[]).map((row) => [String(row.id), row]));
  if (inputs) {
    for (const id of assetIds) {
      const asset = assets.get(id);
      if (!asset || asset.company_id !== post.company_id) fail('Wybierz zdjęcia kolażu z biblioteki tej marki.', 400);
      const known = current.some((row) => String(row.asset_id) === id);
      if (!known && !['ready', 'proposed'].includes(text(asset.status))) fail('Zdjęcie kolażu jest w archiwum albo jeszcze się wgrywa.', 409);
    }
  }
  const existing = new Map(current.map((row) => [`${row.slot}|${row.format}`, row]));
  const desired = new Map<string, { slot: number; format: SocialFormat; asset_id: string; crop: SocialCrop | null }>();
  for (const variant of variants) {
    if (!variant.asset_id || !isSocialFormat(variant.format)) continue;
    const format = variant.format as SocialFormat;
    const layout = variantLayout(variant);
    if (!layout) continue;
    const count = socialLayoutSlots(layout);
    for (const [slot, input] of wanted) {
      if (slot >= count) continue;
      const asset = assets.get(input.assetId);
      if (!asset) continue;
      const key = `${slot}|${format}`;
      if (!existing.has(key) && !['ready', 'proposed'].includes(text(asset.status))) continue;
      const previous = current.find((row) => Number(row.slot) === slot && String(row.asset_id) === input.assetId && row.format === format && isSocialCrop(row.crop));
      const raw = format in input.crops ? input.crops[format] ?? null : previous ? (previous.crop as SocialCrop) : null;
      const crop = raw ? fitAspectCrop(raw, Number(asset.width), Number(asset.height), socialLayoutSlotAspect(layout, slot, format)) : null;
      desired.set(key, { slot, format, asset_id: input.assetId, crop });
    }
  }
  const removed = current.filter((row) => !desired.has(`${row.slot}|${row.format}`));
  if (removed.length) {
    const { error } = await ctx.supabase.from('social_post_slots').delete().in('id', removed.map((row) => row.id));
    check(error, 'Nie udało się usunąć zdjęcia kolażu.');
  }
  for (const [key, values] of desired) {
    const row = existing.get(key);
    if (row) {
      if (String(row.asset_id) === values.asset_id && JSON.stringify(row.crop ?? null) === JSON.stringify(values.crop)) continue;
      const { error } = await ctx.supabase.from('social_post_slots').update({ asset_id: values.asset_id, crop: values.crop }).eq('id', row.id);
      check(error, 'Nie udało się zapisać zdjęcia kolażu.');
    } else {
      const { error } = await ctx.supabase.from('social_post_slots').insert({ post_id: post.id, ...values });
      check(error, 'Nie udało się dodać zdjęcia kolażu.');
    }
  }
}

/** Nowy szkic (opcjonalnie od razu ze zdjęciem z biblioteki — szybki post z telefonu; kolejne zdjęcia — karuzela). */
export async function createPost(ctx: NativeContext, body: Row) {
  const companies = await socialCompanies(ctx);
  const assetId = uuidOrNull(body.assetId);
  const asset = assetId
    ? ((await ctx.supabase.from('social_assets').select('company_id, status, event_id').eq('id', assetId).maybeSingle()).data as Row | null)
    : null;
  // Bez wskazanej marki (szybki post z telefonu) post trafia do marki zdjęcia.
  const companyId = uuidOrNull(body.companyId) || uuidOrNull(asset?.company_id);
  const company = companies.find((item) => item.id === companyId) || companies[0];
  if (!company) fail('Nie masz dostępu do social media.', 403);
  await requireAccess(ctx, company.id, 'create');
  const templates = await loadTemplates(ctx, company.id);
  const template = pickTemplate(templates, body.templateId);
  const patch = postPatch(body);
  const layout = await resolveLayout(ctx, company.id, body, []);
  // Siatka profilu / panorama: jeden wariant 4:5 i kanały dozwolone dla dużej grafiki.
  const canvas = parseSocialLayout(layout?.snapshot)?.canvas || null;
  const requested: SocialChannel[] = Array.isArray(patch.channels) && patch.channels.length ? patch.channels : ['instagram_feed'];
  const channels: SocialChannel[] = canvas ? canvasChannels(canvas, requested) : requested;
  let eventId = patch.event_id ?? null;
  if (assetId) {
    if (!asset || asset.company_id !== company.id) fail('Wybierz zdjęcie z biblioteki tej marki.', 400);
    if (!['ready', 'proposed'].includes(text(asset.status))) fail('To zdjęcie jest w archiwum albo jeszcze się wgrywa.', 409);
    eventId = eventId || uuidOrNull(asset.event_id);
  }
  const { data, error } = await ctx.supabase.from('social_posts').insert({
    ...patch,
    company_id: company.id,
    channels,
    event_id: eventId,
    template_id: template?.id || null,
  }).select(POST_FIELDS).single();
  check(error, 'Nie udało się utworzyć posta.');
  const post = data as Row;
  const formats: SocialFormat[] = canvas ? ['4:5'] : Array.isArray(body.formats) && body.formats.some(isSocialFormat)
    ? SOCIAL_FORMATS.filter((format) => (body.formats as unknown[]).includes(format))
    : defaultFormatsForChannels(channels);
  await saveVariants(ctx, post, formats.map((format) => ({
    format,
    assetId,
    crop: null,
    headline: text(body.headline).trim().slice(0, SOCIAL_LIMITS.headline),
    subline: text(body.subline).trim().slice(0, SOCIAL_LIMITS.subline),
    style: isSocialGraphicStyle(body.graphicStyle) ? body.graphicStyle : template?.defaultStyle || 'classic',
    kicker: kickerText(body.kicker),
  })), 'classic', layout);
  const slides = canvas ? null : slideInputs(body.slides);
  if (assetId && slides?.length) await saveSlides(ctx, post, slides.filter((slide) => slide.assetId !== assetId));
  const slots = slotInputs(body.slots);
  if (assetId && slots?.length) await saveSlots(ctx, post, slots);
  if (assetId) await renderStale(ctx, post, templates);
  return socialPost(ctx, String(post.id));
}

/** Zapis treści posta i grafik (z renderem nieaktualnych grafik) — wersja z `updatedAt` chroni przed nadpisaniem. */
export async function savePost(ctx: NativeContext, body: Row) {
  const row = await postRow(ctx, text(body.id));
  await requireAccess(ctx, String(row.company_id), 'create');
  editable(row);
  if (text(body.updatedAt) !== text(row.updated_at)) fail('Post zmieniono w innym oknie. Odśwież widok — Twoje zmiany nie zostały zapisane.', 409);
  const currentVariants = await variantRows(ctx, String(row.id));
  const layout = await resolveLayout(ctx, String(row.company_id), body, currentVariants);
  const currentCanvas = variantsCanvas(currentVariants);
  const nextCanvas = layout !== undefined ? parseSocialLayout(layout.snapshot)?.canvas || null : currentCanvas;
  if (currentCanvas && !nextCanvas) {
    fail('Siatkę profilu i panoramę można zmienić tylko na inny układ siatki albo panoramy — zwykły post utwórz jako nowy.', 400);
  }
  if (!currentCanvas && nextCanvas && currentVariants.length) {
    fail('Siatkę profilu albo panoramę utworzysz przyciskiem „Nowa siatka / panorama” — zwykłego posta nie da się w nią zmienić.', 400);
  }
  const patch = postPatch(body);
  if ('channels' in patch && !(patch.channels as unknown[]).length) fail('Wybierz co najmniej jeden kanał publikacji.');
  if (nextCanvas) {
    // Siatka — tylko feed Instagram; panorama — bez relacji (także po zmianie kształtu bez kanałów w żądaniu).
    const wanted = canvasChannels(nextCanvas, 'channels' in patch ? patch.channels as SocialChannel[] : channelsOf(row.channels));
    if ('channels' in patch || wanted.join(',') !== channelsOf(row.channels).join(',')) patch.channels = wanted;
  }
  const { data, error } = await ctx.supabase.from('social_posts').update(Object.keys(patch).length ? patch : { title: row.title })
    .eq('id', row.id).eq('updated_at', row.updated_at).select(POST_FIELDS);
  check(error, 'Nie udało się zapisać posta.');
  if (!data?.length) fail('Post zmieniono w innym oknie. Odśwież widok — Twoje zmiany nie zostały zapisane.', 409);
  const post = data[0] as Row;
  const templates = await loadTemplates(ctx, String(post.company_id));
  const variants = variantInputs(body.variants);
  // Zmiana układu bez wariantów w żądaniu — te same zdjęcia i teksty z nowym układem (kadry dopasowane do miejsc).
  const requestedVariants = variants ?? (layout !== undefined ? currentVariants.filter((variant) => isSocialFormat(variant.format)).map((variant) => ({
    format: variant.format as SocialFormat,
    assetId: uuidOrNull(variant.asset_id),
    crop: isSocialCrop(variant.crop) ? variant.crop : null,
    headline: text(variant.headline),
    subline: text(variant.subline),
  })) : null);
  // Duża grafika: jeden wariant 4:5 (ze zdjęciem i tekstami z pierwszego podanego formatu).
  const variantList = requestedVariants && nextCanvas
    ? (requestedVariants.find((item) => item.format === '4:5') ? requestedVariants.filter((item) => item.format === '4:5')
      : requestedVariants.slice(0, 1).map((item) => ({ ...item, format: '4:5' as SocialFormat, crop: null })))
    : requestedVariants;
  if (variantList) await saveVariants(ctx, post, variantList, pickTemplate(templates, post.template_id)?.defaultStyle || 'classic', layout);
  // Karuzela: `slides` (nowe wersje aplikacji) albo tylko dopasowanie zdjęć do zmienionych formatów okładki; duża grafika — bez karuzeli.
  const slides = nextCanvas ? [] : slideInputs(body.slides);
  if (slides || variantList) await saveSlides(ctx, post, slides);
  // Kolaż: `slots` albo tylko dopasowanie do układu i formatów (starsze wersje aplikacji nie wysyłają `slots`).
  const slots = slotInputs(body.slots);
  if (slots || variantList) await saveSlots(ctx, post, slots);
  if (body.render !== false) await renderStale(ctx, post, templates);
  return socialPost(ctx, String(post.id));
}

/**
 * Warstwa grafiki bez zdjęcia (PNG z przezroczystym tłem) do podglądu kadru na żywo na Macu — szablon jak przy renderze
 * posta (wybrany albo domyślny marki), tytuł, podpis, styl i napis nad tytułem z formularza (jeszcze niezapisane; także
 * miniatury stylów). Bez zapisu w bazie i magazynie.
 */
export async function graphicOverlay(ctx: NativeContext, body: Row): Promise<Buffer> {
  const companyId = uuidOrNull(body.companyId);
  if (!companyId) fail('Wybierz markę.', 400);
  if (!isSocialFormat(body.format)) fail('Nieznany format grafiki.', 400);
  await requireAccess(ctx, companyId, 'view');
  const template = pickTemplate(await loadTemplates(ctx, companyId), body.templateId);
  if (!template) fail('Marka nie ma jeszcze szablonu grafiki — dodaj go w „Szablony i AI”.', 404);
  // Układ: definicja z kreatora (np. migawka zapisana w poście albo wybrany, jeszcze niezapisany układ).
  const layout = 'layout' in body ? parseSocialLayout(typeof body.layout === 'string' ? safeJson(body.layout) : body.layout) : null;
  return renderOverlay(template, {
    format: body.format,
    headline: text(body.headline).trim().replace(/\s+/g, ' ').slice(0, SOCIAL_LIMITS.headline),
    subline: text(body.subline).trim().replace(/\s+/g, ' ').slice(0, SOCIAL_LIMITS.subline),
    style: variantStyle(body.style),
    kicker: kickerText(body.kicker),
    layout,
  });
}

const safeJson = (value: string): unknown => {
  try { return JSON.parse(value); } catch { return null; }
};

/** Ponowny render grafik posta (np. po zmianie księgi znaku albo szablonu). */
export async function renderPost(ctx: NativeContext, id: string) {
  const row = await postRow(ctx, id);
  await requireAccess(ctx, String(row.company_id), 'create');
  const result = await renderStale(ctx, row);
  if (result.skipped.length) fail(`Szablon grafik nie jest gotowy: ${result.skipped.join(' ')}`, 422);
  return socialPost(ctx, id);
}

/** Zmiana statusu (wyślij do akceptacji, zatwierdź, do poprawy, przywróć, anuluj, wstrzymaj publikację, opublikowany). */
export async function transitionPost(ctx: NativeContext, body: Row) {
  const row = await postRow(ctx, text(body.id));
  const action = text(body.action) as SocialPostAction;
  if (!['submit', 'approve', 'request_changes', 'reopen', 'cancel', 'schedule', 'unschedule', 'publish'].includes(action)) fail('Nieznana akcja.');
  if (action === 'submit' || action === 'approve') {
    // Akceptujący i autor widzą aktualne grafiki — przed wysłaniem i zatwierdzeniem dorenderowujemy brakujące.
    const access = await socialAccess(ctx, String(row.company_id));
    if (access.create && row.status !== 'published' && row.status !== 'cancelled') await renderStale(ctx, row).catch(() => undefined);
  }
  const { error } = await ctx.supabase.rpc('social_post_transition', {
    p_post_id: row.id,
    p_action: action,
    p_expected_revision: Number.isFinite(Number(body.revision)) && body.revision !== null && body.revision !== '' ? Number(body.revision) : null,
    p_note: text(body.note).trim() || null,
    p_published_url: text(body.url).trim() || null,
  });
  check(error, 'Nie udało się zmienić statusu posta.');
  return socialPost(ctx, String(row.id));
}

/** Termin z kalendarza (przeciągnięcie) — bez zmiany treści; zatwierdzony post pozostaje zatwierdzony. */
export async function schedulePost(ctx: NativeContext, body: Row) {
  const row = await postRow(ctx, text(body.id));
  await requireAccess(ctx, String(row.company_id), 'create');
  editable(row);
  if (body.updatedAt && text(body.updatedAt) !== text(row.updated_at)) fail('Post zmieniono w innym oknie. Odśwież kalendarz.', 409);
  const { data, error } = await ctx.supabase.from('social_posts').update({ scheduled_at: scheduledValue(body.scheduledAt) })
    .eq('id', row.id).eq('updated_at', row.updated_at).select(POST_FIELDS);
  check(error, 'Nie udało się zmienić terminu.');
  if (!data?.length) fail('Post zmieniono w innym oknie. Odśwież kalendarz.', 409);
  const [item] = await listItems(ctx, data as Row[]);
  return { post: item };
}

/** Kopia posta (np. opublikowanego) jako nowy szkic z tymi samymi grafikami. */
export async function duplicatePost(ctx: NativeContext, id: string) {
  const row = await postRow(ctx, id);
  await requireAccess(ctx, String(row.company_id), 'create');
  const [variants, slides, slots] = await Promise.all([variantRows(ctx, id), slideRows(ctx, id), slotRows(ctx, id)]);
  const { data, error } = await ctx.supabase.from('social_posts').insert({
    company_id: row.company_id,
    title: `${text(row.title) || 'Post'} (kopia)`.slice(0, SOCIAL_LIMITS.title),
    channels: row.channels,
    caption: row.caption,
    hashtags: row.hashtags,
    template_id: row.template_id,
    event_id: row.event_id,
    portfolio_project_id: row.portfolio_project_id,
  }).select(POST_FIELDS).single();
  check(error, 'Nie udało się skopiować posta.');
  const copy = data as Row;
  await saveVariants(ctx, copy, variants
    .filter((variant) => !variant.asset_id || ['ready', 'proposed'].includes(text(variant.assetRow?.status)))
    .map((variant) => ({
      format: variant.format as SocialFormat,
      assetId: uuidOrNull(variant.asset_id),
      crop: isSocialCrop(variant.crop) ? variant.crop : null,
      headline: text(variant.headline),
      subline: text(variant.subline),
      style: variantStyle(variant.style),
      kicker: text(variant.kicker),
    })), 'classic', (() => {
    // Ten sam układ (ta sama migawka definicji — kopia wygląda jak oryginał).
    const used = variants.find((variant) => variantLayout(variant));
    return used ? { id: uuidOrNull(used.layout_id), snapshot: used.layout as Row } : { id: null, snapshot: null };
  })());
  // Kolaż: te same zdjęcia i kadry w miejscach (bez zdjęć z archiwum).
  const slotCopies = new Map<number, SlotInput>();
  for (const row of slots) {
    if (!['ready', 'proposed'].includes(text(row.assetRow?.status))) continue;
    const slot = Number(row.slot);
    const entry = slotCopies.get(slot) || { slot, assetId: String(row.asset_id), crops: {} };
    if (entry.assetId === String(row.asset_id) && isSocialCrop(row.crop)) entry.crops[row.format as SocialFormat] = row.crop;
    slotCopies.set(slot, entry);
  }
  if (slotCopies.size) await saveSlots(ctx, copy, Array.from(slotCopies.values()));
  // Karuzela: te same zdjęcia i kadry (bez zdjęć, które tymczasem trafiły do archiwum).
  const byPosition = new Map<number, SlideInput>();
  for (const slide of slides) {
    if (!['ready', 'proposed'].includes(text(slide.assetRow?.status))) continue;
    const position = Number(slide.position);
    const entry = byPosition.get(position) || { assetId: String(slide.asset_id), crops: {} };
    if (isSocialCrop(slide.crop)) entry.crops[slide.format as SocialFormat] = slide.crop;
    byPosition.set(position, entry);
  }
  const copied = Array.from(byPosition.entries()).sort((a, b) => a[0] - b[0]).map(([, entry]) => entry);
  if (copied.length) await saveSlides(ctx, copy, copied);
  await renderStale(ctx, copy).catch(() => undefined);
  return socialPost(ctx, String(copy.id));
}

/** Usunięcie szkicu albo anulowanego posta (autor lub akceptujący) wraz z grafikami. */
export async function deletePost(ctx: NativeContext, id: string) {
  const row = await postRow(ctx, id);
  if (!['draft', 'cancelled'].includes(text(row.status))) fail('Usunąć można szkic albo anulowany post. Inny post najpierw anuluj.', 409);
  const [variants, slides, tiles] = await Promise.all([variantRows(ctx, id), slideRows(ctx, id), tileRows(ctx, id)]);
  const { data, error } = await ctx.supabase.from('social_posts').delete().eq('id', id).select('id');
  check(error, 'Nie udało się usunąć posta.');
  if (!data?.length) fail('Szkic usuwa jego autor albo akceptujący.', 403);
  await removeSocialFiles(ctx.supabase, [...variants, ...slides, ...tiles].map((item) => item.rendered_path));
  return { deleted: id };
}

/** Niezapisane wartości z kreatora dla asystenta AI (pominięte pole — wartość z posta). */
type AiDraft = {
  eventId?: string | null;
  assetId?: string | null;
  caption?: string;
  hashtags?: string[];
  headline?: string;
  subline?: string;
  channels?: SocialChannel[];
};

/**
 * Dane posta dla asystenta AI — bez danych osobowych; nazwa wydarzenia i klient tylko wtedy, gdy wszystkie zdjęcia posta
 * (albo wydarzenie) mają zgodę klienta na publikację. `draft` — wartości z kreatora, jeszcze niezapisane.
 */
async function aiContext(ctx: NativeContext, row: Row, settings: Row, draft: AiDraft = {}): Promise<{ context: SocialAiContext; asset: Row | null }> {
  const variants = await variantRows(ctx, String(row.id));
  let asset: Row | null = null;
  if (draft.assetId) {
    const { data } = await ctx.supabase.from('social_assets').select('id, company_id, thumbnail_path, consent:social_asset_consent')
      .eq('id', draft.assetId).maybeSingle();
    if (data && String((data as Row).company_id) === String(row.company_id)) asset = data as Row;
  }
  if (!asset) {
    const first = variants.find((variant) => variant.assetRow)?.assetRow;
    if (first) asset = first;
  }
  const assetIds = Array.from(new Set([
    ...variants.map((variant) => variant.asset_id).filter(isUuid),
    ...(asset && isUuid(asset.id) ? [String(asset.id)] : []),
  ]));
  const consents = await Promise.all(assetIds.map(async (assetId) => {
    const { data } = await ctx.supabase.from('social_assets').select('consent:social_asset_consent').eq('id', assetId).maybeSingle();
    return isObject(data?.consent) ? text(data.consent.status) : 'unknown';
  }));
  if (asset && !isObject(asset.consent)) {
    const index = assetIds.indexOf(String(asset.id));
    asset = { ...asset, consent: { status: index >= 0 ? consents[index] : 'unknown' } };
  }
  const { data: company } = await ctx.supabase.from('my_companies').select('name').eq('id', row.company_id).maybeSingle();
  const eventId = draft.eventId !== undefined ? draft.eventId : uuidOrNull(row.event_id);
  let eventName: string | null = null;
  let clientName: string | null = null;
  let category: string | null = null;
  let venue: string | null = null;
  let city: string | null = null;
  let month: string | null = null;
  if (isUuid(eventId)) {
    const { data: eventData } = await ctx.supabase.from('events')
      .select('name, event_date, location, organization:organizations!events_organization_id_fkey(name), category:event_categories(name), place:locations(name, city)')
      .eq('id', eventId).maybeSingle();
    const event = eventData as Row | null;
    if (event) {
      const { data: eventConsent } = await ctx.supabase.from('social_publication_consents').select('status').eq('event_id', eventId).maybeSingle();
      const named = consents.length ? consents.every((status) => status === 'granted') : eventConsent?.status === 'granted';
      if (named) {
        eventName = text(event.name) || null;
        clientName = isObject(event.organization) ? text(event.organization.name) || null : null;
      }
      category = isObject(event.category) ? text(event.category.name) || null : null;
      const place = isObject(event.place) ? event.place : null;
      venue = place ? text(place.name) || null : null;
      city = place ? text(place.city) || null : null;
      const date = new Date(text(event.event_date));
      month = Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' });
    }
  }
  let portfolioTitle: string | null = null;
  let portfolioDescription: string | null = null;
  if (isUuid(row.portfolio_project_id)) {
    const { data } = await ctx.supabase.from('portfolio_projects').select('title, description, location').eq('id', row.portfolio_project_id).maybeSingle();
    portfolioTitle = text(data?.title) || null;
    portfolioDescription = text(data?.description) || null;
    city = city || text(data?.location) || null;
  }
  const first = variants[0];
  return {
    asset,
    context: {
      brand: text(company?.name) || 'marka',
      channels: draft.channels?.length ? draft.channels : channelsOf(row.channels),
      eventName,
      clientName,
      category,
      venue,
      city,
      month,
      portfolioTitle,
      portfolioDescription,
      draftCaption: draft.caption !== undefined ? draft.caption : text(row.caption),
      draftHashtags: draft.hashtags !== undefined ? draft.hashtags : (Array.isArray(row.hashtags) ? row.hashtags.map(text) : []),
      headline: draft.headline !== undefined ? draft.headline : text(first?.headline),
      subline: draft.subline !== undefined ? draft.subline : text(first?.subline),
      styleNote: text(settings.caption_style),
      defaultHashtags: Array.isArray(settings.default_hashtags) ? settings.default_hashtags.map(text) : [],
    },
  };
}

async function aiSettings(ctx: NativeContext, row: Row): Promise<Row> {
  const { data: settings } = await ctx.supabase.from('social_settings').select('*').eq('company_id', row.company_id).maybeSingle();
  if (!settings?.ai_captions_enabled) {
    fail('Asystent AI jest wyłączony dla tej marki. Włącza go osoba akceptująca posty („Szablony i AI” albo przycisk w kreatorze).', 412);
  }
  return settings as Row;
}

/** 3 wersje opisu z danymi realizacji zapisane w poście (`op=suggest`, starsze wersje aplikacji). */
export async function suggestPost(ctx: NativeContext, id: string) {
  const row = await postRow(ctx, id);
  await requireAccess(ctx, String(row.company_id), 'create');
  editable(row);
  const settings = await aiSettings(ctx, row);
  const { context } = await aiContext(ctx, row, settings);
  const { suggestions, model } = await generateSocialSuggestions(context);
  const stored = suggestions.map((item) => ({ ...item, model, createdAt: new Date().toISOString() }));
  const { error } = await ctx.supabase.from('social_posts').update({ ai_suggestions: stored }).eq('id', id);
  check(error, 'Nie udało się zapisać propozycji AI.');
  return socialPost(ctx, id);
}

/**
 * Asystent AI w kreatorze (CRM, Mac, telefon): `mode` write — 3 wersje opisu z hashtagami, tytułem i podpisem grafiki
 * (temat, cel, ton, długość); rewrite — poprawka bieżącego opisu (szybka albo własne polecenie); hashtags — podpowiedzi
 * w grupach. Bierze niezapisane wartości z kreatora (opis, hashtagi, teksty grafiki, wydarzenie, zdjęcie), wyniku nie
 * zapisuje (formularz zostaje bez zmian, dopóki pracownik nie wybierze propozycji). Zdjęcie trafia do AI tylko na prośbę
 * i gdy ma zgodę klienta na publikację.
 */
export async function assistPost(ctx: NativeContext, body: Row) {
  const id = uuidOrNull(body.id);
  if (!id) fail('Nie znaleziono posta.', 404);
  const row = await postRow(ctx, id);
  await requireAccess(ctx, String(row.company_id), 'create');
  editable(row);
  const settings = await aiSettings(ctx, row);
  const mode = body.mode === 'rewrite' ? 'rewrite' : body.mode === 'hashtags' ? 'hashtags' : 'write';
  const draft: AiDraft = {};
  if ('eventId' in body) draft.eventId = uuidOrNull(body.eventId);
  if ('assetId' in body) draft.assetId = uuidOrNull(body.assetId);
  if ('caption' in body) draft.caption = text(body.caption).slice(0, SOCIAL_LIMITS.caption);
  if ('hashtags' in body) draft.hashtags = normalizeHashtags(Array.isArray(body.hashtags) ? body.hashtags.map(text) : text(body.hashtags)).slice(0, SOCIAL_LIMITS.hashtags);
  if ('headline' in body) draft.headline = text(body.headline).trim().slice(0, SOCIAL_LIMITS.headline);
  if ('subline' in body) draft.subline = text(body.subline).trim().slice(0, SOCIAL_LIMITS.subline);
  if (Array.isArray(body.channels)) draft.channels = body.channels.filter(isSocialChannel);
  const { context, asset } = await aiContext(ctx, row, settings, draft);

  let photo: string | null = null;
  let photoNote: string | null = null;
  if (body.usePhoto === true) {
    const consent = isObject(asset?.consent) ? text(asset!.consent.status) : 'unknown';
    if (!asset || !text(asset.thumbnail_path)) {
      photoNote = 'Post nie ma jeszcze zdjęcia — asystent pisał bez niego.';
    } else if (!socialConsentAllows(consent)) {
      photoNote = 'Zdjęcie nie ma zgody klienta na publikację — asystent pisał bez niego.';
    } else {
      try {
        photo = `data:image/jpeg;base64,${(await downloadSocialFile(ctx.supabase, text(asset.thumbnail_path))).toString('base64')}`;
      } catch {
        photoNote = 'Nie udało się odczytać miniatury zdjęcia — asystent pisał bez niego.';
      }
    }
  }

  const result = await assistSocial(context, {
    mode,
    topic: text(body.topic).trim().slice(0, 500),
    goal: isSocialAiGoal(body.goal) ? body.goal : null,
    tone: isSocialAiTone(body.tone) ? body.tone : null,
    length: isSocialAiLength(body.length) ? body.length : null,
    rewrite: mode === 'rewrite' && isSocialAiRewrite(body.rewrite) ? body.rewrite : null,
    instruction: text(body.instruction).trim().slice(0, 300),
    photo,
  });
  return { ...result, photoNote };
}

/** Paczka do ręcznej publikacji: grafiki kanałów (JPEG) i opis z hashtagami (opis.txt). */
export async function postPackage(ctx: NativeContext, id: string): Promise<{ fileName: string; zip: Buffer }> {
  const row = await postRow(ctx, id);
  const variants = (await variantRows(ctx, id)).filter((variant) => variant.rendered_path);
  if (!variants.length) fail('Post nie ma jeszcze grafik. Zapisz post, żeby je wygenerować.', 409);
  const slides = (await slideRows(ctx, id)).filter((slide) => slide.rendered_path);
  const base = safeFileName(text(row.title), 'post');
  const files: Array<{ name: string; data: Buffer }> = [];
  const canvas = variantsCanvas(variants);
  if (canvas) {
    // Siatka profilu / panorama: kafelki z numerami (1 — lewy górny) i instrukcja publikacji.
    const tiles = (await tileRows(ctx, id)).filter((tile) => tile.rendered_path && Number(tile.position) <= socialCanvasTileCount(canvas));
    if (tiles.length < socialCanvasTileCount(canvas)) fail('Post nie ma jeszcze wszystkich kafelków. Zapisz post, żeby je wygenerować.', 409);
    const name = (position: number) => `${base}-${canvas.mode === 'grid' ? 'kafelek' : 'slajd'}-${String(position).padStart(2, '0')}.jpg`;
    for (const tile of tiles) files.push({ name: name(Number(tile.position)), data: await downloadSocialFile(ctx.supabase, String(tile.rendered_path)) });
    const hashtags = Array.isArray(row.hashtags) ? row.hashtags.map(text) : [];
    const order = tiles.map((tile) => Number(tile.position));
    const guide = canvas.mode === 'grid'
      ? `Siatka profilu Instagram — ${order.length} osobnych postów. Publikuj od ostatniego kafelka do pierwszego: ${[...order].reverse().map(name).join(', ')}.\n`
        + 'Opis z hashtagami — przy kafelku 1 (lewy górny, publikowany na końcu); przy pozostałych same hashtagi.\n'
        + 'Siatka zostaje równa, gdy kolejne posty publikujesz po 3 naraz; przypięte posty przesuwają siatkę.'
      : `Panorama — jedna karuzela: ${order.map(name).join(', ')} (w tej kolejności).`;
    files.push({ name: 'opis.txt', data: Buffer.from(`${socialPublicationText(text(row.caption), hashtags)}\n\n---\n${guide}\n`, 'utf8') });
    return { fileName: `${base}.zip`, zip: createZip(files) };
  }
  for (const variant of variants) {
    files.push({ name: `${base}-${formatSlug(variant.format as SocialFormat)}.jpg`, data: await downloadSocialFile(ctx.supabase, String(variant.rendered_path)) });
  }
  // Karuzela: kolejne zdjęcia z numerem (okładka — bez numeru, czyli 1.).
  for (const slide of slides) {
    files.push({
      name: `${base}-${formatSlug(slide.format as SocialFormat)}-${Number(slide.position) + 1}.jpg`,
      data: await downloadSocialFile(ctx.supabase, String(slide.rendered_path)),
    });
  }
  const hashtags = Array.isArray(row.hashtags) ? row.hashtags.map(text) : [];
  const channels = channelsOf(row.channels);
  const formats = variants.map((variant) => variant.format as SocialFormat);
  const guide = channels.map((channel) => {
    const format = channelFormat(channel, formats);
    const extra = format && channel !== 'instagram_story'
      ? slides.filter((slide) => slide.format === format).map((slide) => `${base}-${formatSlug(format)}-${Number(slide.position) + 1}.jpg`)
      : [];
    const label = SOCIAL_CHANNEL_LABELS[channel];
    const first = format ? `${base}-${formatSlug(format)}.jpg` : 'brak grafiki';
    return `${label}: ${extra.length ? `karuzela — ${[first, ...extra].join(', ')}` : first}`;
  }).join('\n');
  files.push({ name: 'opis.txt', data: Buffer.from(`${socialPublicationText(text(row.caption), hashtags)}\n\n---\n${guide}\n`, 'utf8') });
  return { fileName: `${base}.zip`, zip: createZip(files) };
}

/** Ustawienia marki: opisy AI i analiza AI raportu tygodniowego (zgody), stałe hashtagi i wskazówki stylu — akceptujący. */
export async function saveSettings(ctx: NativeContext, body: Row) {
  const companyId = uuidOrNull(body.companyId);
  if (!companyId) fail('Wybierz markę.');
  await requireAccess(ctx, companyId, 'approve');
  const values: Row = { company_id: companyId };
  if ('aiCaptionsEnabled' in body) values.ai_captions_enabled = body.aiCaptionsEnabled === true;
  if ('aiReportsEnabled' in body) values.ai_reports_enabled = body.aiReportsEnabled === true;
  if ('defaultHashtags' in body) {
    const tags = normalizeHashtags(Array.isArray(body.defaultHashtags) ? body.defaultHashtags.map(text) : text(body.defaultHashtags));
    if (tags.length > SOCIAL_LIMITS.hashtags) fail(`Najwyżej ${SOCIAL_LIMITS.hashtags} stałych hashtagów.`);
    values.default_hashtags = tags;
  }
  if ('captionStyle' in body) values.caption_style = text(body.captionStyle).trim().slice(0, 600);
  const { data, error } = await ctx.supabase.from('social_settings').upsert(values, { onConflict: 'company_id' }).select('*').single();
  check(error, 'Nie udało się zapisać ustawień social media.');
  return { settings: settingsDTO(data as Row) };
}

/** Szablon marki: odwołania do księgi znaku (logo, fonty, kolory), nazwa, domyślny, domyślny styl grafik — akceptujący. */
export async function saveTemplate(ctx: NativeContext, body: Row) {
  const companyId = uuidOrNull(body.companyId);
  if (!companyId) fail('Wybierz markę.');
  await requireAccess(ctx, companyId, 'approve');
  const values: Row = {};
  if ('name' in body) values.name = text(body.name).trim().slice(0, 80) || 'Szablon marki';
  if ('isDefault' in body) values.is_default = body.isDefault === true;
  for (const [key, column] of [
    ['logoId', 'logo_id'], ['titleFontId', 'title_font_id'], ['captionFontId', 'caption_font_id'],
    ['overlayColorId', 'overlay_color_id'], ['accentColorId', 'accent_color_id'], ['textColorId', 'text_color_id'],
  ] as const) {
    if (key in body) values[column] = uuidOrNull(body[key]);
  }
  const id = uuidOrNull(body.id);
  // Domyślny styl nowych postów — w ustawieniach szablonu (pozostałe ustawienia układu bez zmian).
  if ('defaultStyle' in body) {
    let settings: Row = {};
    if (id) {
      const { data: current, error: currentError } = await ctx.supabase.from('social_brand_templates').select('settings')
        .eq('id', id).eq('company_id', companyId).maybeSingle();
      check(currentError, 'Nie udało się pobrać szablonu.');
      if (!current) fail('Nie znaleziono szablonu.', 404);
      settings = isObject(current.settings) ? current.settings : {};
    }
    values.settings = { ...settings, defaultStyle: variantStyle(body.defaultStyle) };
  }
  const result = id
    ? await ctx.supabase.from('social_brand_templates').update(values).eq('id', id).eq('company_id', companyId).select('id').maybeSingle()
    : await ctx.supabase.from('social_brand_templates').insert({ company_id: companyId, ...values }).select('id').single();
  check(result.error, 'Nie udało się zapisać szablonu.');
  if (!result.data) fail('Nie znaleziono szablonu.', 404);
  const templates = await loadTemplates(ctx, companyId);
  return { templates: templates.map(templateDTO) };
}

/** Księga znaku marki do edytora szablonu: logo, fonty (z informacją o pliku) i kolory. */
export async function brandbookOptions(ctx: NativeContext, companyId: string) {
  if (!isUuid(companyId)) fail('Wybierz markę.');
  await requireAccess(ctx, companyId, 'view');
  const [logos, fonts, colors] = await Promise.all([
    ctx.supabase.from('company_brandbook_logos').select('id, label, url, variant, background').eq('company_id', companyId).order('order_index'),
    ctx.supabase.from('company_brandbook_fonts').select('id, label, family, role, storage_path').eq('company_id', companyId).order('order_index'),
    ctx.supabase.from('company_brandbook_colors').select('id, label, hex, role').eq('company_id', companyId).order('order_index'),
  ]);
  return {
    logos: ((logos.data || []) as Row[]).map((row) => ({ id: String(row.id), label: text(row.label), variant: text(row.variant), background: text(row.background), url: brandbookPublicUrl(row.url) })),
    fonts: ((fonts.data || []) as Row[]).map((row) => ({ id: String(row.id), label: text(row.label), family: text(row.family), role: text(row.role), hasFile: Boolean(row.storage_path) })),
    colors: ((colors.data || []) as Row[]).map((row) => ({ id: String(row.id), label: text(row.label), hex: text(row.hex), role: text(row.role) })),
  };
}

// Etap 2: publikacja w Meta i komentarze ----------------------------------------------------------------------------

function expectedRevision(body: Row, row: Row) {
  if (body.revision === undefined || body.revision === null || body.revision === '') return;
  if (Number(body.revision) !== Number(row.revision)) fail('Post zmieniono w innym oknie. Odśwież widok i spróbuj ponownie.', 409);
}

/** Braki przed publikacją w Meta (konto, uprawnienia kanałów, grafiki) — komunikat zamiast nieudanej próby. */
async function requireMetaReady(ctx: NativeContext, row: Row) {
  const account = await socialMetaAccount(String(row.company_id));
  const variants = await variantRows(ctx, String(row.id));
  const { data } = await ctx.supabase.from('social_publications').select('channel, status').eq('post_id', row.id);
  const published = new Set(((data || []) as Row[]).filter((item) => item.status === 'published').map((item) => String(item.channel)));
  const pending = channelsOf(row.channels).filter((channel) => !published.has(channel));
  const problems = metaProblems(account, pending,
    variants.filter((variant) => variant.asset_id && variant.rendered_path && isSocialFormat(variant.format)).map((variant) => variant.format as SocialFormat));
  const message = socialPublicationText(String(row.caption || ''), Array.isArray(row.hashtags) ? row.hashtags.map(String) : []);
  if (pending.includes('instagram_feed') && message.length > INSTAGRAM_CAPTION_LIMIT) {
    problems.push(`${SOCIAL_CHANNEL_LABELS.instagram_feed}: opis z hashtagami ma ${message.length} znaków — Instagram przyjmuje najwyżej ${INSTAGRAM_CAPTION_LIMIT}.`);
  }
  if (pending.includes('linkedin_page') && message.length > LINKEDIN_TEXT_LIMIT) {
    problems.push(`${SOCIAL_CHANNEL_LABELS.linkedin_page}: opis z hashtagami ma ${message.length} znaków — LinkedIn przyjmuje najwyżej ${LINKEDIN_TEXT_LIMIT}.`);
  }
  if (problems.length) fail(problems.join(' '), 422);
}

/**
 * „Zaplanuj publikację” (publikujący): termin co najmniej minutę w przyszłości, zatwierdzona wersja, gotowe konto Meta.
 * Zaplanowany post — tylko zmiana terminu.
 */
export async function schedulePublication(ctx: NativeContext, body: Row) {
  const row = await postRow(ctx, text(body.id));
  await requireAccess(ctx, String(row.company_id), 'publish');
  expectedRevision(body, row);
  if (!['approved', 'failed', 'scheduled'].includes(text(row.status))) fail('Zaplanować można zatwierdzony post.', 409);
  if (Number(row.approved_revision) !== Number(row.revision)) fail('Zaplanować można tylko zatwierdzoną wersję posta.', 409);
  const when = scheduledValue(body.scheduledAt);
  if (!when) fail('Ustaw termin publikacji.');
  if (new Date(when).getTime() < Date.now() + 60_000) fail('Termin publikacji musi być co najmniej minutę w przyszłości — albo wybierz „Opublikuj teraz”.');
  await requireMetaReady(ctx, row);
  const { error } = await ctx.supabase.from('social_posts').update({ scheduled_at: when }).eq('id', row.id);
  check(error, 'Nie udało się zapisać terminu publikacji.');
  if (row.status !== 'scheduled') {
    const { error: transitionError } = await ctx.supabase.rpc('social_post_transition', {
      p_post_id: row.id, p_action: 'schedule', p_expected_revision: Number(row.revision), p_note: null, p_published_url: null,
    });
    check(transitionError, 'Nie udało się zaplanować publikacji.');
  }
  return socialPost(ctx, String(row.id));
}

/**
 * „Opublikuj teraz” / „Ponów publikację” (publikujący): termin = teraz, status „zaplanowany” i od razu publikacja
 * (osoba klikająca widzi wynik — nie dostaje powiadomienia o błędzie). Kanały już opublikowane są pomijane.
 */
export async function publishNow(ctx: NativeContext, body: Row) {
  const row = await postRow(ctx, text(body.id));
  await requireAccess(ctx, String(row.company_id), 'publish');
  expectedRevision(body, row);
  if (!['approved', 'failed', 'scheduled'].includes(text(row.status))) {
    fail(row.status === 'publishing' ? 'Post jest właśnie publikowany — odśwież widok za chwilę.' : 'Opublikować można zatwierdzony post.', 409);
  }
  if (Number(row.approved_revision) !== Number(row.revision)) fail('Opublikować można tylko zatwierdzoną wersję posta.', 409);
  await requireMetaReady(ctx, row);
  const { error } = await ctx.supabase.from('social_posts').update({ scheduled_at: new Date().toISOString() }).eq('id', row.id);
  check(error, 'Nie udało się rozpocząć publikacji.');
  if (row.status !== 'scheduled') {
    const { error: transitionError } = await ctx.supabase.rpc('social_post_transition', {
      p_post_id: row.id, p_action: 'schedule', p_expected_revision: Number(row.revision), p_note: 'Opublikuj teraz', p_published_url: null,
    });
    check(transitionError, 'Nie udało się rozpocząć publikacji.');
  }
  const [result] = await runSocialPublishing({ postId: String(row.id), actorId: ctx.employee.id, limit: 1 });
  const detail = await socialPost(ctx, String(row.id));
  return {
    ...detail,
    publishResult: result ? { status: result.status, error: result.error } : { status: 'publishing', error: null },
  };
}

export type SocialCommentDTO = {
  id: string;
  platform: SocialCommentPlatform;
  authorName: string;
  isOwn: boolean;
  message: string;
  commentedAt: string;
  likeCount: number;
  answeredAt: string | null;
  repliedByName: string | null;
};

export type SocialCommentThread = SocialCommentDTO & {
  postId: string;
  channel: SocialChannel;
  permalink: string | null;
  post: { id: string; title: string; thumbnailUrl: string | null } | null;
  replies: SocialCommentDTO[];
};

/**
 * Komentarze: jednego posta (wszystkie wątki) albo marki (skrzynka: najnowsze wątki, `filter=unanswered` — bez odpowiedzi
 * marki). Odpowiadać może twórca treści, gdy Meta / LinkedIn przyznały uprawnienia do komentarzy.
 */
export async function socialComments(ctx: NativeContext, params: URLSearchParams) {
  const postId = uuidOrNull(params.get('post'));
  let companyId: string;
  if (postId) companyId = String((await postRow(ctx, postId)).company_id);
  else {
    const companies = await socialCompanies(ctx);
    const company = companies.find((item) => item.id === uuidOrNull(params.get('company'))) || companies[0];
    if (!company) fail('Nie masz dostępu do social media.', 403);
    companyId = company.id;
  }
  const access = await requireAccess(ctx, companyId, 'view');
  const unansweredOnly = params.get('filter') === 'unanswered';
  let roots = ctx.supabase.from('social_comments').select('*').eq('company_id', companyId).is('parent_external_id', null);
  if (postId) roots = roots.eq('post_id', postId).order('commented_at', { ascending: true }).limit(300);
  else {
    roots = roots.eq('is_own', false).order('commented_at', { ascending: false }).limit(80);
    if (unansweredOnly) roots = roots.is('answered_at', null);
  }
  const { data: rootData, error } = await roots;
  check(error, 'Nie udało się pobrać komentarzy.');
  const rootRows = (rootData || []) as Row[];
  const rootIds = rootRows.map((row) => text(row.external_id));
  const { data: replyData } = rootIds.length
    ? await ctx.supabase.from('social_comments').select('*').eq('company_id', companyId).in('parent_external_id', rootIds)
      .order('commented_at', { ascending: true }).limit(1000)
    : { data: [] as Row[] };
  const replies = (replyData || []) as Row[];
  const publicationIds = Array.from(new Set(rootRows.map((row) => String(row.publication_id))));
  const postIds = Array.from(new Set(rootRows.map((row) => String(row.post_id))));
  const [{ data: publicationData }, { data: postData }, names, unanswered, account] = await Promise.all([
    publicationIds.length
      ? ctx.supabase.from('social_publications').select('id, channel, permalink').in('id', publicationIds)
      : Promise.resolve({ data: [] as Row[] }),
    postIds.length ? ctx.supabase.from('social_posts').select(POST_FIELDS).in('id', postIds) : Promise.resolve({ data: [] as Row[] }),
    employeeNames(ctx.supabase, replies.map((row) => row.replied_by)),
    ctx.supabase.from('social_comments').select('id', { count: 'exact', head: true }).eq('company_id', companyId)
      .is('parent_external_id', null).eq('is_own', false).is('answered_at', null),
    socialMetaAccount(companyId).catch(() => null),
  ]);
  const publications = new Map(((publicationData || []) as Row[]).map((row) => [String(row.id), row]));
  const posts = new Map((await listItems(ctx, (postData || []) as Row[])).map((item) => [item.id, item]));
  const dto = (row: Row): SocialCommentDTO => ({
    id: String(row.id),
    platform: socialCommentPlatform(row.platform),
    authorName: text(row.author_name) || 'Użytkownik',
    isOwn: row.is_own === true,
    message: text(row.message),
    commentedAt: text(row.commented_at),
    likeCount: Number(row.like_count) || 0,
    answeredAt: text(row.answered_at) || null,
    repliedByName: row.replied_by ? names.get(String(row.replied_by).toLowerCase()) || null : null,
  });
  const threads: SocialCommentThread[] = rootRows.map((row) => {
    const publication = publications.get(String(row.publication_id));
    const post = posts.get(String(row.post_id));
    return {
      ...dto(row),
      postId: String(row.post_id),
      channel: (publication?.channel
        || (row.platform === 'facebook' ? 'facebook_feed' : row.platform === 'linkedin' ? 'linkedin_page' : 'instagram_feed')) as SocialChannel,
      permalink: text(publication?.permalink) || null,
      post: post ? { id: post.id, title: post.title || post.captionPreview.slice(0, 60) || 'Post', thumbnailUrl: post.thumbnailUrl } : null,
      replies: replies.filter((reply) => text(reply.parent_external_id) === text(row.external_id)
        && reply.platform === row.platform).map(dto),
    };
  });
  return {
    companyId,
    threads,
    unanswered: unanswered.count || 0,
    canReply: access.create,
    replyChannels: {
      facebook: Boolean(account?.comments.facebookReply),
      instagram: Boolean(account?.comments.instagram),
      linkedin: Boolean(account?.linkedin.comments),
    },
  };
}

/** Odświeżenie komentarzy posta albo marki z Meta i LinkedIn (przycisk „Odśwież”). */
export async function refreshComments(ctx: NativeContext, body: Row) {
  const postId = uuidOrNull(body.postId);
  const params = new URLSearchParams();
  if (postId) {
    const row = await postRow(ctx, postId);
    await requireAccess(ctx, String(row.company_id), 'view');
    await syncSocialComments({ postId });
    params.set('post', postId);
  } else {
    const companyId = uuidOrNull(body.companyId);
    if (!companyId) fail('Wybierz markę.');
    await requireAccess(ctx, companyId, 'view');
    await syncSocialComments({ companyId, limit: 40 });
    params.set('company', companyId);
    if (body.filter === 'unanswered') params.set('filter', 'unanswered');
  }
  return socialComments(ctx, params);
}

/** Odpowiedź marki na komentarz (twórca treści). */
export async function replyComment(ctx: NativeContext, body: Row) {
  const id = uuidOrNull(body.commentId);
  if (!id) fail('Nie znaleziono komentarza.', 404);
  const message = text(body.message).trim();
  if (!message) fail('Napisz odpowiedź.');
  if (message.length > SOCIAL_LIMITS.reply) fail(`Odpowiedź może mieć najwyżej ${SOCIAL_LIMITS.reply} znaków.`);
  const { data, error } = await ctx.supabase.from('social_comments').select('*').eq('id', id).maybeSingle();
  check(error, 'Nie udało się pobrać komentarza.');
  if (!data) fail('Nie znaleziono komentarza.', 404);
  const comment = data as Row;
  await requireAccess(ctx, String(comment.company_id), 'create');
  try {
    await replyAsBrand(comment, message, ctx.employee.id);
  } catch (replyError) {
    const status = (replyError as { status?: number }).status;
    fail(errorMessage(replyError), typeof status === 'number' ? status : 502);
  }
  const params = new URLSearchParams();
  if (body.scope === 'company') {
    params.set('company', String(comment.company_id));
    if (body.filter === 'unanswered') params.set('filter', 'unanswered');
  } else params.set('post', String(comment.post_id));
  return socialComments(ctx, params);
}
