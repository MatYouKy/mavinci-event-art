import 'server-only';
import type { NativeContext } from '@/lib/native/auth';
import { generateSocialSuggestions } from './socialAi.server';
import { assetDTOs, ASSET_FIELDS, type SocialAssetDTO } from './socialAssets.server';
import {
  brandbookPublicUrl, check, downloadSocialFile, employeeNames, fail, isObject, isUuid, removeSocialFiles, requireAccess, safeFileName,
  signedUrls, socialAccess, socialCompanies, text, uuidOrNull, type Row,
} from './socialCommon.server';
import {
  graphicSpec, loadTemplates, pickTemplate, renderHash, renderVariant, templateDTO, type LoadedTemplate, type SocialGraphicSpec,
  type SocialTemplateDTO,
} from './socialTemplate.server';
import {
  SOCIAL_CHANNELS, SOCIAL_FORMATS, SOCIAL_LIMITS, channelFormat, defaultFormatsForChannels, effectiveCrop, fitCrop, formatSlug,
  SOCIAL_CHANNEL_LABELS, isSocialChannel, isSocialCrop, isSocialFormat, normalizeHashtags, socialCanPublishNow, socialPostActions,
  socialPublicationText,
  type SocialAccess, type SocialChannel, type SocialCrop, type SocialFormat, type SocialPostAction, type SocialPostStatus,
} from './socialShared';
import { createZip } from './zip.server';
import {
  INSTAGRAM_CAPTION_LIMIT, errorMessage, instagramRecentMedia, metaStatusDTO, replyAsBrand, runSocialPublishing, socialMetaAccount,
  syncSocialComments,
  type SocialMetaAccount, type SocialMetaStatus,
} from './socialMeta.server';

/*
 * Posty social media: kalendarz (lista w zakresie dat + szkice bez terminu + czekające na akceptację), karta posta
 * (warianty grafik, podglądy, braki, historia, akcje), zapis treści i grafik z renderem, zmiany statusu
 * (`social_post_transition`), termin z kalendarza, kopia, usunięcie, opisy AI i paczka do ręcznej publikacji (Etap 1),
 * planowanie i publikacja w Meta, wyniki kanałów, komentarze z odpowiedziami i siatka profilu z Instagrama (Etap 2).
 * Te same funkcje obsługują web CRM, Maca i telefon (`/bridge/native/v1/social`).
 */

const POST_FIELDS = 'id, company_id, title, status, channels, scheduled_at, caption, hashtags, template_id, event_id, portfolio_project_id, ai_suggestions, author_id, revision, submitted_at, submitted_by, reviewed_at, reviewed_by, review_note, approved_revision, published_at, published_by, published_url, cancelled_at, created_at, updated_at, updated_by, scheduled_by, publish_attempts, publish_error';
const VARIANT_FIELDS = 'id, post_id, format, asset_id, crop, headline, subline, rendered_path, render_hash, rendered_at, updated_at';
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
  const [{ data: variants }, names] = await Promise.all([
    ctx.supabase.from('social_post_variants').select('post_id, format, rendered_path, asset:social_assets(thumbnail_path)').in('post_id', ids),
    employeeNames(ctx.supabase, rows.map((row) => row.author_id)),
  ]);
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

function renderSource(variant: VariantRow) {
  const asset = variant.assetRow;
  if (!asset?.work_path || !Number(asset.width) || !Number(asset.height) || !isSocialFormat(variant.format)) return null;
  return {
    format: variant.format as SocialFormat,
    workPath: String(asset.work_path),
    crop: effectiveCrop(isSocialCrop(variant.crop) ? variant.crop : null, isObject(asset.crops) ? asset.crops : null,
      Number(asset.width), Number(asset.height), variant.format as SocialFormat),
    headline: text(variant.headline),
    subline: text(variant.subline),
  };
}

export type SocialVariantDTO = {
  id: string;
  format: SocialFormat;
  assetId: string | null;
  crop: SocialCrop | null;
  effectiveCrop: SocialCrop | null;
  headline: string;
  subline: string;
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
  status: string;
  format: SocialFormat | null;
  permalink: string | null;
  error: string | null;
  attempts: number;
  publishedAt: string | null;
  attemptedAt: string | null;
};

const publicationDTO = (row: Row): SocialPublicationDTO => ({
  channel: row.channel as SocialChannel,
  status: text(row.status),
  format: isSocialFormat(row.format) ? row.format : null,
  permalink: text(row.permalink) || null,
  error: text(row.error) || null,
  attempts: Number(row.attempts) || 0,
  publishedAt: text(row.published_at) || null,
  attemptedAt: text(row.attempted_at) || null,
});

/** Braki blokujące publikację w Meta: konto i uprawnienia kanałów oraz wygenerowane grafiki. */
function metaProblems(account: SocialMetaAccount | null, channels: SocialChannel[], renderedFormats: SocialFormat[]): string[] {
  return channels.flatMap((channel) => {
    const label = SOCIAL_CHANNEL_LABELS[channel];
    const problem = account ? account.channels[channel].problem : 'nie udało się sprawdzić połączenia z Meta.';
    const format = channelFormat(channel, renderedFormats);
    return [problem ? `${label}: ${problem}` : null, format ? null : `${label}: brak wygenerowanej grafiki — zapisz post.`]
      .filter((item): item is string => Boolean(item));
  });
}

/** Karta posta. */
export async function socialPost(ctx: NativeContext, id: string): Promise<SocialPostDetail> {
  const row = await postRow(ctx, id);
  const companyId = String(row.company_id);
  const [access, variants, templates, historyResult, submitProblems, publishProblems, settings, companyRow, publicationsResult,
    commentRows, metaAccount] = await Promise.all([
    socialAccess(ctx, companyId),
    variantRows(ctx, id),
    loadTemplates(ctx, companyId),
    ctx.supabase.from('social_post_events').select('kind, actor_id, note, revision, created_at').eq('post_id', id).order('created_at', { ascending: false }).limit(60),
    ctx.supabase.rpc('social_post_problems', { p_post_id: id, p_require_consent: false }),
    ctx.supabase.rpc('social_post_problems', { p_post_id: id, p_require_consent: true }),
    ctx.supabase.from('social_settings').select('*').eq('company_id', companyId).maybeSingle(),
    ctx.supabase.from('my_companies').select('id, name').eq('id', companyId).maybeSingle(),
    ctx.supabase.from('social_publications').select('channel, status, format, permalink, error, attempts, published_at, attempted_at').eq('post_id', id),
    ctx.supabase.from('social_comments').select('parent_external_id, is_own, answered_at').eq('post_id', id).limit(2000),
    socialMetaAccount(companyId).catch((error) => {
      console.warn('[social] meta account', errorMessage(error));
      return null;
    }),
  ]);
  const publications = ((publicationsResult.data || []) as Row[]).map(publicationDTO)
    .sort((a, b) => SOCIAL_CHANNELS.indexOf(a.channel) - SOCIAL_CHANNELS.indexOf(b.channel));
  const topComments = ((commentRows.data || []) as Row[]).filter((item) => !item.parent_external_id && !item.is_own);
  const template = pickTemplate(templates, row.template_id);
  const [listItem] = await listItems(ctx, [row]);
  const history = (historyResult.data || []) as Row[];
  const names = await employeeNames(ctx.supabase, [...history.map((item) => item.actor_id), row.reviewed_by, row.published_by, row.scheduled_by]);
  const assets = await assetDTOs(ctx, variants.map((variant) => variant.assetRow).filter((asset): asset is Row => Boolean(asset))
    .filter((asset, index, list) => list.findIndex((item) => item.id === asset.id) === index), { work: true });
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));
  const rendered = await signedUrls(ctx.supabase, variants.map((variant) => variant.rendered_path));
  const variantDTOs: SocialVariantDTO[] = variants.map((variant) => {
    const source = renderSource(variant);
    const expected = template && source && !template.problems.length ? renderHash(template, source) : null;
    return {
      id: String(variant.id),
      format: variant.format as SocialFormat,
      assetId: uuidOrNull(variant.asset_id),
      crop: isSocialCrop(variant.crop) ? variant.crop : null,
      effectiveCrop: source?.crop || null,
      headline: text(variant.headline),
      subline: text(variant.subline),
      renderedUrl: variant.rendered_path ? rendered.get(variant.rendered_path) || null : null,
      renderedAt: text(variant.rendered_at) || null,
      upToDate: Boolean(expected && variant.render_hash === expected && variant.rendered_path),
      asset: variant.asset_id ? assetById.get(String(variant.asset_id)) || null : null,
    };
  });
  const formats = variantDTOs.filter((variant) => variant.assetId).map((variant) => variant.format);
  const channels = channelsOf(row.channels);

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
    ? await ctx.supabase.from('social_post_variants').select('post_id, format, rendered_path').in('post_id', gridIds).in('format', ['4:5', '1:1'])
    : { data: [] as Row[] };
  const gridPath = new Map<string, string>();
  for (const variant of (gridVariants || []) as Row[]) {
    if (!variant.rendered_path) continue;
    if (!gridPath.has(String(variant.post_id)) || variant.format === '4:5') gridPath.set(String(variant.post_id), String(variant.rendered_path));
  }
  const gridUrls = await signedUrls(ctx.supabase, Array.from(gridPath.values()));

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
    channelFormats: Object.fromEntries(channels.map((channel) => [channel, channelFormat(channel, formats)])),
    problems: {
      submit: Array.isArray(submitProblems.data) ? (submitProblems.data as unknown[]).map(text) : [],
      publish: Array.isArray(publishProblems.data) ? (publishProblems.data as unknown[]).map(text) : [],
      meta: metaProblems(metaAccount, channels.filter((channel) => !publications.some((item) => item.channel === channel && item.status === 'published')),
        variantDTOs.filter((variant) => variant.assetId && variant.renderedUrl).map((variant) => variant.format)),
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
      ...((gridRows || []) as Row[]).map((item) => ({
        id: String(item.id),
        status: text(item.status) as SocialPostStatus,
        imageUrl: gridPath.has(String(item.id)) ? gridUrls.get(gridPath.get(String(item.id)) as string) || null : null,
        date: text(item.published_at) || text(item.scheduled_at) || null,
        source: 'crm' as const,
        permalink: null,
      })),
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
  const variants = await variantRows(ctx, String(post.id));
  let rendered = 0;
  for (const variant of variants) {
    const source = renderSource(variant);
    if (!source) continue;
    const result = await renderVariant(ctx, { id: String(post.id), companyId: String(post.company_id) }, template,
      { id: String(variant.id), renderedPath: variant.rendered_path || null, renderHash: variant.render_hash || null }, source);
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

type VariantInput = { format: SocialFormat; assetId: string | null; crop: SocialCrop | null; headline: string; subline: string };

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
    });
  }
  return result;
}

/** Zapis wariantów: usunięcie niepotrzebnych formatów, zmiana i dodanie pozostałych (kadr dopasowany do proporcji). */
async function saveVariants(ctx: NativeContext, post: Row, inputs: VariantInput[]) {
  const current = await variantRows(ctx, String(post.id));
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
    const crop = input.crop && asset ? fitCrop(input.crop, Number(asset.width), Number(asset.height), input.format) : null;
    const values = { asset_id: input.assetId, crop, headline: input.headline, subline: input.subline };
    const existing = current.find((variant) => variant.format === input.format);
    if (existing) {
      const same = existing.asset_id === input.assetId && JSON.stringify(existing.crop ?? null) === JSON.stringify(crop)
        && text(existing.headline) === input.headline && text(existing.subline) === input.subline;
      if (same) continue;
      const { error } = await ctx.supabase.from('social_post_variants').update(values).eq('id', existing.id);
      check(error, 'Nie udało się zapisać grafiki.');
    } else {
      const { error } = await ctx.supabase.from('social_post_variants').insert({ post_id: post.id, format: input.format, ...values });
      check(error, 'Nie udało się dodać formatu grafiki.');
    }
  }
}

/** Nowy szkic (opcjonalnie od razu ze zdjęciem z biblioteki — szybki post z telefonu). */
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
  const channels: SocialChannel[] = Array.isArray(patch.channels) && patch.channels.length ? patch.channels : ['instagram_feed'];
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
  const formats = Array.isArray(body.formats) && body.formats.some(isSocialFormat)
    ? SOCIAL_FORMATS.filter((format) => (body.formats as unknown[]).includes(format))
    : defaultFormatsForChannels(channels);
  await saveVariants(ctx, post, formats.map((format) => ({
    format,
    assetId,
    crop: null,
    headline: text(body.headline).trim().slice(0, SOCIAL_LIMITS.headline),
    subline: text(body.subline).trim().slice(0, SOCIAL_LIMITS.subline),
  })));
  if (assetId) await renderStale(ctx, post, templates);
  return socialPost(ctx, String(post.id));
}

/** Zapis treści posta i grafik (z renderem nieaktualnych grafik) — wersja z `updatedAt` chroni przed nadpisaniem. */
export async function savePost(ctx: NativeContext, body: Row) {
  const row = await postRow(ctx, text(body.id));
  await requireAccess(ctx, String(row.company_id), 'create');
  editable(row);
  if (text(body.updatedAt) !== text(row.updated_at)) fail('Post zmieniono w innym oknie. Odśwież widok — Twoje zmiany nie zostały zapisane.', 409);
  const patch = postPatch(body);
  if ('channels' in patch && !(patch.channels as unknown[]).length) fail('Wybierz co najmniej jeden kanał publikacji.');
  const { data, error } = await ctx.supabase.from('social_posts').update(Object.keys(patch).length ? patch : { title: row.title })
    .eq('id', row.id).eq('updated_at', row.updated_at).select(POST_FIELDS);
  check(error, 'Nie udało się zapisać posta.');
  if (!data?.length) fail('Post zmieniono w innym oknie. Odśwież widok — Twoje zmiany nie zostały zapisane.', 409);
  const post = data[0] as Row;
  const variants = variantInputs(body.variants);
  if (variants) await saveVariants(ctx, post, variants);
  if (body.render !== false) await renderStale(ctx, post);
  return socialPost(ctx, String(post.id));
}

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
  const variants = await variantRows(ctx, id);
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
    })));
  await renderStale(ctx, copy).catch(() => undefined);
  return socialPost(ctx, String(copy.id));
}

/** Usunięcie szkicu albo anulowanego posta (autor lub akceptujący) wraz z grafikami. */
export async function deletePost(ctx: NativeContext, id: string) {
  const row = await postRow(ctx, id);
  if (!['draft', 'cancelled'].includes(text(row.status))) fail('Usunąć można szkic albo anulowany post. Inny post najpierw anuluj.', 409);
  const variants = await variantRows(ctx, id);
  const { data, error } = await ctx.supabase.from('social_posts').delete().eq('id', id).select('id');
  check(error, 'Nie udało się usunąć posta.');
  if (!data?.length) fail('Szkic usuwa jego autor albo akceptujący.', 403);
  await removeSocialFiles(ctx.supabase, variants.map((variant) => variant.rendered_path));
  return { deleted: id };
}

/** 2–3 wersje opisu, hashtagi oraz tytuł i podpis grafiki z danych wydarzenia i realizacji. */
export async function suggestPost(ctx: NativeContext, id: string) {
  const row = await postRow(ctx, id);
  await requireAccess(ctx, String(row.company_id), 'create');
  editable(row);
  const { data: settings } = await ctx.supabase.from('social_settings').select('*').eq('company_id', row.company_id).maybeSingle();
  if (!settings?.ai_captions_enabled) {
    fail('Opisy AI są wyłączone dla tej marki. Włącza je osoba akceptująca posty w ustawieniach social media.', 412);
  }
  const variants = await variantRows(ctx, id);
  const consents = await Promise.all(variants.filter((variant) => variant.assetRow).map(async (variant) => {
    const { data } = await ctx.supabase.from('social_assets').select('consent:social_asset_consent').eq('id', variant.asset_id).maybeSingle();
    return isObject(data?.consent) ? text(data.consent.status) : 'unknown';
  }));
  const { data: company } = await ctx.supabase.from('my_companies').select('name').eq('id', row.company_id).maybeSingle();
  let eventName: string | null = null;
  let clientName: string | null = null;
  let category: string | null = null;
  let venue: string | null = null;
  let city: string | null = null;
  let month: string | null = null;
  if (isUuid(row.event_id)) {
    const { data: eventData } = await ctx.supabase.from('events')
      .select('name, event_date, location, organization:organizations!events_organization_id_fkey(name), category:event_categories(name), place:locations(name, city)')
      .eq('id', row.event_id).maybeSingle();
    const event = eventData as Row | null;
    if (event) {
      const { data: eventConsent } = await ctx.supabase.from('social_publication_consents').select('status').eq('event_id', row.event_id).maybeSingle();
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
  const { suggestions, model } = await generateSocialSuggestions({
    brand: text(company?.name) || 'marka',
    channels: channelsOf(row.channels),
    eventName,
    clientName,
    category,
    venue,
    city,
    month,
    portfolioTitle,
    portfolioDescription,
    draftCaption: text(row.caption),
    headline: text(first?.headline),
    subline: text(first?.subline),
    styleNote: text(settings.caption_style),
    defaultHashtags: Array.isArray(settings.default_hashtags) ? settings.default_hashtags.map(text) : [],
  });
  const stored = suggestions.map((item) => ({ ...item, model, createdAt: new Date().toISOString() }));
  const { error } = await ctx.supabase.from('social_posts').update({ ai_suggestions: stored }).eq('id', id);
  check(error, 'Nie udało się zapisać propozycji AI.');
  return socialPost(ctx, id);
}

/** Paczka do ręcznej publikacji: grafiki kanałów (JPEG) i opis z hashtagami (opis.txt). */
export async function postPackage(ctx: NativeContext, id: string): Promise<{ fileName: string; zip: Buffer }> {
  const row = await postRow(ctx, id);
  const variants = (await variantRows(ctx, id)).filter((variant) => variant.rendered_path);
  if (!variants.length) fail('Post nie ma jeszcze grafik. Zapisz post, żeby je wygenerować.', 409);
  const base = safeFileName(text(row.title), 'post');
  const files: Array<{ name: string; data: Buffer }> = [];
  for (const variant of variants) {
    files.push({ name: `${base}-${formatSlug(variant.format as SocialFormat)}.jpg`, data: await downloadSocialFile(ctx.supabase, String(variant.rendered_path)) });
  }
  const hashtags = Array.isArray(row.hashtags) ? row.hashtags.map(text) : [];
  const channels = channelsOf(row.channels);
  const formats = variants.map((variant) => variant.format as SocialFormat);
  const guide = channels.map((channel) => {
    const format = channelFormat(channel, formats);
    return `${channel === 'instagram_feed' ? 'Instagram — post' : channel === 'instagram_story' ? 'Instagram — relacja' : 'Facebook — post'}: ${format ? `${base}-${formatSlug(format)}.jpg` : 'brak grafiki'}`;
  }).join('\n');
  files.push({ name: 'opis.txt', data: Buffer.from(`${socialPublicationText(text(row.caption), hashtags)}\n\n---\n${guide}\n`, 'utf8') });
  return { fileName: `${base}.zip`, zip: createZip(files) };
}

/** Ustawienia marki: opisy AI (zgoda), stałe hashtagi i wskazówki stylu — akceptujący. */
export async function saveSettings(ctx: NativeContext, body: Row) {
  const companyId = uuidOrNull(body.companyId);
  if (!companyId) fail('Wybierz markę.');
  await requireAccess(ctx, companyId, 'approve');
  const values: Row = { company_id: companyId };
  if ('aiCaptionsEnabled' in body) values.ai_captions_enabled = body.aiCaptionsEnabled === true;
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

/** Szablon marki: odwołania do księgi znaku (logo, fonty, kolory), nazwa, domyślny — akceptujący. */
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
  platform: 'facebook' | 'instagram';
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
 * marki). Odpowiadać może twórca treści, gdy Meta przyznała uprawnienia do komentarzy.
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
    platform: row.platform === 'facebook' ? 'facebook' : 'instagram',
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
      channel: (publication?.channel || (row.platform === 'facebook' ? 'facebook_feed' : 'instagram_feed')) as SocialChannel,
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
    },
  };
}

/** Odświeżenie komentarzy posta albo marki z Meta (przycisk „Odśwież”). */
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
