import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NativeContext } from '@/lib/native/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import {
  check, fail, isObject, isUuid, signedUrls, socialAccess, socialCompanies, text, uuidOrNull, type Row, type SocialCompany,
} from './socialCommon.server';
import { errorMessage, loadMetaAccount, metaStatusDTO, socialMetaAccount } from './socialMeta.server';
import { syncSocialMetrics, warsawDate } from './socialMetrics.server';
import {
  SOCIAL_BEST_TIMES_MIN_POSTS, SOCIAL_BEST_TIMES_MIN_SAMPLE, SOCIAL_CHANNELS, SOCIAL_CHANNEL_LABELS, SOCIAL_FORMATS, SOCIAL_METRICS,
  SOCIAL_STATS_RANGES, SOCIAL_TIME_BANDS, SOCIAL_WEEKDAYS, formatSocialNumber, formatSocialPercent, socialChangeLabel,
  socialEngagementRate, socialMetricsFromRow, socialPeriodLabel, socialPlural, socialSlotLabel, socialTimeBand,
  type SocialAccess, type SocialChannel, type SocialMetricValues,
} from './socialShared';

/*
 * Social media (Etap 3): zakładka „Statystyki” (wyniki postów opublikowanych w okresie, porównanie z poprzednim okresem,
 * kanały, przyrosty dzienne, najlepsze posty, najlepsze pory publikacji z własnych wyników) i raport tygodniowy
 * „Trendy i rekomendacje” (`marketing_ai_insights`, `kind = 'social_weekly'`). Te same dane dla web CRM, Maca i telefonu
 * (`/bridge/native/v1/social`, `op=stats`).
 * Raport: zawsze liczby i wnioski z danych; analiza AI (OpenAI marketingu) tylko po zgodzie w ustawieniach social media
 * marki — do AI trafiają wyłącznie zagregowane wyniki (bez tytułów, opisów, komentarzy i danych osobowych).
 */

const DAY = 86_400_000;
const PUBLICATION_FIELDS = 'id, post_id, channel, format, published_at, permalink, metrics, metrics_synced_at, metrics_error';
const REPORT_LIST_FIELDS = 'id, period_start, period_end, summary, model, created_at, updated_at';
const REPORT_FIELDS = 'id, company_id, period_start, period_end, summary, recommendations, risks, opportunities, model, details, created_at, updated_at';
const BEST_TIMES_DAYS = 180;

// Daty w strefie Warszawa ------------------------------------------------------------------------------------------------

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const slotFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', weekday: 'short', hour: '2-digit', hourCycle: 'h23' });
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Dzień tygodnia (0 = poniedziałek) i pora publikacji w strefie Warszawa. */
function warsawSlot(value: unknown): { weekday: number; band: number } | null {
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return null;
  const parts = slotFormatter.formatToParts(date);
  const weekday = WEEKDAY_INDEX[parts.find((part) => part.type === 'weekday')?.value || ''];
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  if (weekday === undefined || !Number.isFinite(hour)) return null;
  return { weekday, band: socialTimeBand(hour % 24) };
}

function warsawOffset(utc: number) {
  const parts = Object.fromEntries(offsetFormatter.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)) - utc;
}

/** Północ dnia „RRRR-MM-DD” w Warszawie jako chwila UTC. */
function warsawMidnight(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);
  return new Date(guess - warsawOffset(guess - warsawOffset(guess)));
}

const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};

const isMonday = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00Z`).getUTCDay() === 1;

/** Poniedziałek poprzedniego tygodnia (jak `social_report_last_week()` w bazie) — gdy baza nie odpowie. */
function fallbackLastWeek() {
  const today = warsawDate();
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(today, -weekday - 7);
}

// Agregaty ---------------------------------------------------------------------------------------------------------------

export type SocialTotals = SocialMetricValues & { posts: number; publications: number; rate: number | null };

function totalsOf(rows: Row[]): SocialTotals {
  const totals: SocialTotals = { posts: new Set(rows.map((row) => String(row.post_id))).size, publications: rows.length, rate: null };
  let interactions = 0;
  let base = 0;
  for (const row of rows) {
    const metrics = socialMetricsFromRow(isObject(row.metrics) ? row.metrics : null);
    for (const key of SOCIAL_METRICS) {
      const value = metrics[key];
      if (value != null) totals[key] = (totals[key] ?? 0) + value;
    }
    const rowBase = metrics.reach && metrics.reach > 0 ? metrics.reach : metrics.views && metrics.views > 0 ? metrics.views : 0;
    if (rowBase > 0 && metrics.interactions != null) {
      interactions += metrics.interactions;
      base += rowBase;
    }
  }
  totals.rate = base > 0 ? interactions / base : null;
  return totals;
}

export type SocialBestTime = { weekday: number; band: number; label: string; posts: number; rate: number; avgReach: number; avgInteractions: number };
export type SocialBestTimes = { sample: number; minSample: number; cells: SocialBestTime[]; top: SocialBestTime[] };

/** Najlepsze pory z własnych wyników: posty w feedzie (bez relacji), średni wskaźnik zaangażowania w porze. */
function bestTimesOf(rows: Row[]): SocialBestTimes {
  const cells = new Map<string, { weekday: number; band: number; posts: number; rate: number; reach: number; interactions: number }>();
  let sample = 0;
  for (const row of rows) {
    if (row.channel === 'instagram_story') continue;
    const metrics = socialMetricsFromRow(isObject(row.metrics) ? row.metrics : null);
    const rate = socialEngagementRate(metrics);
    const slot = warsawSlot(row.published_at);
    if (rate === null || !slot) continue;
    sample += 1;
    const key = `${slot.weekday}:${slot.band}`;
    const cell = cells.get(key) || { ...slot, posts: 0, rate: 0, reach: 0, interactions: 0 };
    cell.posts += 1;
    cell.rate += rate;
    cell.reach += metrics.reach ?? metrics.views ?? 0;
    cell.interactions += metrics.interactions ?? 0;
    cells.set(key, cell);
  }
  const list: SocialBestTime[] = Array.from(cells.values()).map((cell) => ({
    weekday: cell.weekday,
    band: cell.band,
    label: socialSlotLabel(cell.weekday, cell.band),
    posts: cell.posts,
    rate: cell.rate / cell.posts,
    avgReach: Math.round(cell.reach / cell.posts),
    avgInteractions: Math.round(cell.interactions / cell.posts),
  })).sort((a, b) => a.weekday - b.weekday || a.band - b.band);
  const top = sample >= SOCIAL_BEST_TIMES_MIN_SAMPLE
    ? list.filter((cell) => cell.posts >= SOCIAL_BEST_TIMES_MIN_POSTS)
      .sort((a, b) => b.rate - a.rate || b.avgReach - a.avgReach).slice(0, 3)
    : [];
  return { sample, minSample: SOCIAL_BEST_TIMES_MIN_SAMPLE, cells: list, top };
}

function channelTotals(rows: Row[]) {
  return SOCIAL_CHANNELS.map((channel) => ({ channel, totals: totalsOf(rows.filter((row) => row.channel === channel)) }))
    .filter((item) => item.totals.publications > 0);
}

type PostAggregate = { postId: string; channels: SocialChannel[]; publishedAt: string | null; permalink: string | null; metrics: SocialMetricValues };

/** Wyniki postów (suma kanałów), najlepsze najpierw: interakcje, potem wyświetlenia. */
function postAggregates(rows: Row[]): PostAggregate[] {
  const posts = new Map<string, PostAggregate & { rows: Row[] }>();
  for (const row of rows) {
    const id = String(row.post_id);
    const item = posts.get(id) || { postId: id, channels: [], publishedAt: null, permalink: null, metrics: {}, rows: [] };
    item.rows.push(row);
    if (!item.channels.includes(row.channel)) item.channels.push(row.channel);
    const published = text(row.published_at) || null;
    if (published && (!item.publishedAt || published < item.publishedAt)) item.publishedAt = published;
    if (!item.permalink || row.channel === 'instagram_feed') item.permalink = text(row.permalink) || item.permalink;
    posts.set(id, item);
  }
  return Array.from(posts.values()).map(({ rows: list, ...item }) => {
    const totals = totalsOf(list);
    const metrics: SocialMetricValues = {};
    for (const key of SOCIAL_METRICS) if (totals[key] != null) metrics[key] = totals[key];
    return { ...item, channels: SOCIAL_CHANNELS.filter((channel) => item.channels.includes(channel)), metrics };
  }).sort((a, b) => (b.metrics.interactions ?? -1) - (a.metrics.interactions ?? -1) || (b.metrics.views ?? -1) - (a.metrics.views ?? -1));
}

/** Miniatury postów: wyrenderowana grafika (4:5, 1:1, 9:16, 1,91:1), podpisany link na 1 h. */
async function postThumbnails(supabase: SupabaseClient, postIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const ids = Array.from(new Set(postIds.filter(isUuid)));
  if (!ids.length) return result;
  const { data } = await supabase.from('social_post_variants').select('post_id, format, rendered_path').in('post_id', ids)
    .not('rendered_path', 'is', null);
  const best = new Map<string, Row>();
  for (const variant of (data || []) as Row[]) {
    const current = best.get(String(variant.post_id));
    if (!current || SOCIAL_FORMATS.indexOf(variant.format) < SOCIAL_FORMATS.indexOf(current.format)) best.set(String(variant.post_id), variant);
  }
  const urls = await signedUrls(supabase, Array.from(best.values()).map((variant) => text(variant.rendered_path)));
  for (const [postId, variant] of best) {
    const url = urls.get(text(variant.rendered_path));
    if (url) result.set(postId, url);
  }
  return result;
}

async function postTitles(supabase: SupabaseClient, postIds: string[]): Promise<Map<string, Row>> {
  const ids = Array.from(new Set(postIds.filter(isUuid)));
  const result = new Map<string, Row>();
  if (!ids.length) return result;
  const { data } = await supabase.from('social_posts').select('id, title, caption, hashtags').in('id', ids);
  for (const row of (data || []) as Row[]) result.set(String(row.id), row);
  return result;
}

const postLabel = (row: Row | undefined) =>
  text(row?.title).trim() || text(row?.caption).trim().replace(/\s+/g, ' ').slice(0, 60) || 'Post';

// Raport (DTO) -----------------------------------------------------------------------------------------------------------

export type SocialRecommendation = { title: string; rationale: string; priority: 'high' | 'medium' | 'low'; channel: string };
export type SocialTopPost = PostAggregate & { title: string; thumbnailUrl: string | null };

export type SocialReportSummary = {
  id: string;
  periodStart: string;
  periodEnd: string;
  summary: string;
  aiUsed: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type SocialReportDTO = SocialReportSummary & {
  trends: string[];
  recommendations: SocialRecommendation[];
  risks: string[];
  opportunities: string[];
  model: string | null;
  totals: SocialTotals | null;
  previous: SocialTotals | null;
  channels: Array<{ channel: SocialChannel; totals: SocialTotals }>;
  topPosts: SocialTopPost[];
  bestTimes: SocialBestTime[];
  comments: { received: number; unanswered: number } | null;
  scheduledNext: number | null;
  aiNote: string | null;
};

const stringList = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

function recommendationList(value: unknown): SocialRecommendation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((item) => ({
    title: text(item.title),
    rationale: text(item.rationale),
    priority: (['high', 'medium', 'low'].includes(text(item.priority)) ? text(item.priority) : 'medium') as SocialRecommendation['priority'],
    channel: text(item.channel),
  })).filter((item) => item.title);
}

const totalsFrom = (value: unknown): SocialTotals | null => {
  if (!isObject(value)) return null;
  const metrics = socialMetricsFromRow(Object.fromEntries(Object.entries(value).map(([key, item]) => [key === 'profileVisits' ? 'profile_visits' : key, item])));
  return { ...metrics, posts: Number(value.posts) || 0, publications: Number(value.publications) || 0, rate: typeof value.rate === 'number' ? value.rate : null };
};

function reportSummary(row: Row): SocialReportSummary {
  return {
    id: String(row.id),
    periodStart: text(row.period_start),
    periodEnd: text(row.period_end),
    summary: text(row.summary),
    aiUsed: Boolean(text(row.model)),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at) || null,
  };
}

function reportDTO(row: Row, thumbnails: Map<string, string>): SocialReportDTO {
  const details = isObject(row.details) ? row.details : {};
  return {
    ...reportSummary(row),
    trends: stringList(details.trends),
    recommendations: recommendationList(row.recommendations),
    risks: stringList(row.risks),
    opportunities: stringList(row.opportunities),
    model: text(row.model) || null,
    totals: totalsFrom(details.totals),
    previous: totalsFrom(details.previous),
    channels: (Array.isArray(details.channels) ? details.channels : []).filter(isObject)
      .filter((item) => (SOCIAL_CHANNELS as readonly string[]).includes(text(item.channel)))
      .map((item) => ({ channel: item.channel as SocialChannel, totals: totalsFrom(item.totals) as SocialTotals })).filter((item) => item.totals),
    topPosts: (Array.isArray(details.topPosts) ? details.topPosts : []).filter(isObject).map((item) => ({
      postId: text(item.postId),
      title: text(item.title) || 'Post',
      channels: stringList(item.channels).filter((channel): channel is SocialChannel => (SOCIAL_CHANNELS as readonly string[]).includes(channel)),
      publishedAt: text(item.publishedAt) || null,
      permalink: text(item.permalink) || null,
      metrics: totalsFrom(item.metrics) || {},
      thumbnailUrl: thumbnails.get(text(item.postId)) || null,
    })).map(({ metrics, ...item }) => {
      const values: SocialMetricValues = {};
      for (const key of SOCIAL_METRICS) if ((metrics as SocialMetricValues)[key] != null) values[key] = (metrics as SocialMetricValues)[key];
      return { ...item, metrics: values };
    }),
    bestTimes: (Array.isArray(details.bestTimes) ? details.bestTimes : []).filter(isObject).map((item) => ({
      weekday: Number(item.weekday) || 0,
      band: Number(item.band) || 0,
      label: text(item.label) || socialSlotLabel(Number(item.weekday) || 0, Number(item.band) || 0),
      posts: Number(item.posts) || 0,
      rate: Number(item.rate) || 0,
      avgReach: Number(item.avgReach) || 0,
      avgInteractions: Number(item.avgInteractions) || 0,
    })),
    comments: isObject(details.comments)
      ? { received: Number(details.comments.received) || 0, unanswered: Number(details.comments.unanswered) || 0 } : null,
    scheduledNext: details.scheduledNext == null ? null : Number(details.scheduledNext) || 0,
    aiNote: text(details.aiNote) || null,
  };
}

// Statystyki (zakładka) --------------------------------------------------------------------------------------------------

export type SocialStatsDTO = {
  companies: SocialCompany[];
  company: SocialCompany;
  access: SocialAccess;
  range: { days: number; from: string; to: string };
  totals: SocialTotals;
  previous: SocialTotals;
  channels: Array<{ channel: SocialChannel; totals: SocialTotals }>;
  timeline: Array<{ date: string; views: number; interactions: number }>;
  bestTimes: SocialBestTimes;
  topPosts: SocialTopPost[];
  sync: { publications: number; withMetrics: number; lastSyncedAt: string | null; problems: string[] };
  insights: { connected: boolean; facebook: boolean; instagram: boolean; missingScopes: string[] };
  reports: SocialReportSummary[];
  report: SocialReportDTO | null;
  settings: { aiReportsEnabled: boolean; aiReportsConsentAt: string | null };
  canRefresh: boolean;
  canGenerate: boolean;
  lastWeekStart: string;
};

/** Zakładka „Statystyki”: `company`, `days` (7 | 28 | 90), `report` (raport do pokazania; domyślnie najnowszy). */
export async function socialStats(ctx: NativeContext, params: URLSearchParams): Promise<SocialStatsDTO> {
  const companies = await socialCompanies(ctx);
  if (!companies.length) fail('Nie masz dostępu do social media. Poproś administratora o uprawnienie w sekcji „Social media”.', 403);
  const reportId = uuidOrNull(params.get('report'));
  let selected: Row | null = null;
  if (reportId) {
    const { data } = await ctx.supabase.from('marketing_ai_insights').select(REPORT_FIELDS).eq('id', reportId).eq('kind', 'social_weekly').maybeSingle();
    selected = (data as Row | null) || null;
  }
  const company = companies.find((item) => selected && item.id === String(selected.company_id))
    || companies.find((item) => item.id === uuidOrNull(params.get('company'))) || companies[0];
  if (selected && String(selected.company_id) !== company.id) selected = null;
  const requested = Number(params.get('days'));
  const days = (SOCIAL_STATS_RANGES as readonly number[]).includes(requested) ? requested : 28;
  const now = Date.now();
  const from = new Date(now - days * DAY);
  const previousFrom = new Date(now - 2 * days * DAY);

  const [access, periodResult, bestResult, timelineResult, reportsResult, meta, settingsResult, lastWeekResult] = await Promise.all([
    socialAccess(ctx, company.id),
    ctx.supabase.from('social_publications').select(PUBLICATION_FIELDS).eq('company_id', company.id).eq('status', 'published')
      .gte('published_at', previousFrom.toISOString()).order('published_at', { ascending: false }).limit(1000),
    ctx.supabase.from('social_publications').select('channel, published_at, metrics').eq('company_id', company.id).eq('status', 'published')
      .neq('channel', 'instagram_story').gte('published_at', new Date(now - BEST_TIMES_DAYS * DAY).toISOString()).limit(1000),
    ctx.supabase.rpc('social_metrics_timeline', { p_company: company.id, p_from: warsawDate(from), p_to: warsawDate(new Date(now)) }),
    ctx.supabase.from('marketing_ai_insights').select(REPORT_LIST_FIELDS).eq('company_id', company.id).eq('kind', 'social_weekly')
      .order('period_start', { ascending: false }).limit(12),
    socialMetaAccount(company.id).then(metaStatusDTO).catch((error) => {
      console.warn('[social-stats] meta', errorMessage(error));
      return null;
    }),
    ctx.supabase.from('social_settings').select('ai_reports_enabled, ai_reports_consent_at').eq('company_id', company.id).maybeSingle(),
    ctx.supabase.rpc('social_report_last_week'),
  ]);
  check(periodResult.error || bestResult.error || reportsResult.error, 'Nie udało się pobrać statystyk social media.');
  if (timelineResult.error) console.warn('[social-stats] timeline', timelineResult.error.message);

  const rows = (periodResult.data || []) as Row[];
  const publishedAt = (row: Row) => Date.parse(text(row.published_at)) || 0;
  const current = rows.filter((row) => publishedAt(row) >= from.getTime());
  const previous = rows.filter((row) => publishedAt(row) < from.getTime());
  const aggregates = postAggregates(current).slice(0, 5);

  if (!selected && reportsResult.data?.length) {
    const { data } = await ctx.supabase.from('marketing_ai_insights').select(REPORT_FIELDS).eq('id', (reportsResult.data[0] as Row).id).maybeSingle();
    selected = (data as Row | null) || null;
  }
  const reportPostIds = selected && isObject(selected.details) && Array.isArray(selected.details.topPosts)
    ? (selected.details.topPosts as unknown[]).filter(isObject).map((item) => text(item.postId)) : [];
  const [titles, thumbnails] = await Promise.all([
    postTitles(ctx.supabase, aggregates.map((item) => item.postId)),
    postThumbnails(ctx.supabase, [...aggregates.map((item) => item.postId), ...reportPostIds]),
  ]);

  const timelineValues = new Map<string, { views: number; interactions: number }>();
  for (const item of (timelineResult.data || []) as Row[]) {
    timelineValues.set(text(item.metric_date), { views: Number(item.views) || 0, interactions: Number(item.interactions) || 0 });
  }
  const timeline: SocialStatsDTO['timeline'] = [];
  for (let date = warsawDate(from); date <= warsawDate(new Date(now)); date = addDays(date, 1)) {
    timeline.push({ date, ...(timelineValues.get(date) || { views: 0, interactions: 0 }) });
  }
  const synced = rows.map((row) => text(row.metrics_synced_at)).filter(Boolean).sort();
  const settings = settingsResult.data as Row | null;

  return {
    companies,
    company,
    access,
    range: { days, from: from.toISOString(), to: new Date(now).toISOString() },
    totals: totalsOf(current),
    previous: totalsOf(previous),
    channels: channelTotals(current),
    timeline,
    bestTimes: bestTimesOf((bestResult.data || []) as Row[]),
    topPosts: aggregates.map((item) => ({
      ...item, title: postLabel(titles.get(item.postId)), thumbnailUrl: thumbnails.get(item.postId) || null,
    })),
    sync: {
      publications: current.length,
      withMetrics: current.filter((row) => isObject(row.metrics) && Object.keys(row.metrics).length > 0).length,
      lastSyncedAt: synced.length ? synced[synced.length - 1] : null,
      problems: Array.from(new Set(current.map((row) => text(row.metrics_error)).filter(Boolean))).slice(0, 3),
    },
    insights: {
      connected: Boolean(meta?.connected),
      facebook: Boolean(meta?.insights?.facebook),
      instagram: Boolean(meta?.insights?.instagram),
      missingScopes: (meta?.missingScopes || []).filter((scope) => scope === 'read_insights' || scope === 'instagram_manage_insights'),
    },
    reports: ((reportsResult.data || []) as Row[]).map(reportSummary),
    report: selected ? reportDTO(selected, thumbnails) : null,
    settings: { aiReportsEnabled: settings?.ai_reports_enabled === true, aiReportsConsentAt: text(settings?.ai_reports_consent_at) || null },
    canRefresh: access.view,
    canGenerate: access.create,
    lastWeekStart: text(lastWeekResult.data) || fallbackLastWeek(),
  };
}

/** „Odśwież wyniki” w karcie posta — kanały posta z Meta (dostęp „view” marki). */
export async function refreshPostMetrics(ctx: NativeContext, postId: string) {
  const { data, error } = await ctx.supabase.from('social_posts').select('id, company_id').eq('id', postId).maybeSingle();
  check(error, 'Nie udało się pobrać posta.');
  if (!data) fail('Nie znaleziono posta.', 404);
  if (!(await socialAccess(ctx, String((data as Row).company_id))).view) fail('Nie masz dostępu do social media tej marki.', 403);
  return syncSocialMetrics({ postId });
}

/** „Odśwież statystyki” — wyniki publikacji marki z ostatnich 90 dni (pobrane ponad 10 minut temu), potem zakładka. */
export async function refreshCompanyMetrics(ctx: NativeContext, body: Row) {
  const companyId = uuidOrNull(body.companyId);
  if (!companyId) fail('Wybierz markę.');
  if (!(await socialAccess(ctx, companyId)).view) fail('Nie masz dostępu do social media tej marki.', 403);
  await syncSocialMetrics({ companyId, days: 90, limit: 80 });
  const params = new URLSearchParams({ company: companyId });
  if (body.days) params.set('days', String(body.days));
  if (uuidOrNull(body.report)) params.set('report', String(body.report));
  return socialStats(ctx, params);
}

// Raport tygodniowy ----------------------------------------------------------------------------------------------------

type ReportContent = {
  summary: string;
  trends: string[];
  recommendations: SocialRecommendation[];
  risks: string[];
  opportunities: string[];
};

function extractResponseText(response: any) {
  if (typeof response?.output_text === 'string') return response.output_text;
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

async function aiReport(snapshot: Row): Promise<{ content: ReportContent; model: string }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('brak konfiguracji OPENAI_API_KEY na serwerze');
  const model = process.env.OPENAI_MARKETING_MODEL || 'gpt-5.4';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
      body: JSON.stringify({
        model,
        store: false,
        input: [
          {
            role: 'system',
            content: 'Jesteś analitykiem social media polskiej firmy eventowej (marka premium, styl „subtelnie, z klasą”). '
              + 'Analizujesz wyłącznie dostarczone, zagregowane wyniki postów z Instagrama i Facebooka za tydzień i porównanie '
              + 'z poprzednim tygodniem. Nie wymyślaj brakujących danych — gdy danych jest mało albo brakuje metryk, napisz to wprost. '
              + 'Trendy: 2–4 krótkie zdania z liczbami. Rekomendacje: 2–5 konkretnych działań na najbliższy tydzień (dzień i pora, '
              + 'kanał, format, częstotliwość, odpowiedzi na komentarze), każda wynikająca z danych. Ryzyka i szanse: krótko, '
              + 'najwyżej po 3. Odpowiadaj po polsku, bez emotek.',
          },
          { role: 'user', content: `Wyniki social media marki:\n${JSON.stringify(snapshot)}` },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'social_weekly_report',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                summary: { type: 'string' },
                trends: { type: 'array', items: { type: 'string' } },
                recommendations: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      title: { type: 'string' },
                      rationale: { type: 'string' },
                      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                      channel: { type: 'string' },
                    },
                    required: ['title', 'rationale', 'priority', 'channel'],
                  },
                },
                risks: { type: 'array', items: { type: 'string' } },
                opportunities: { type: 'array', items: { type: 'string' } },
              },
              required: ['summary', 'trends', 'recommendations', 'risks', 'opportunities'],
            },
          },
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || `usługa AI odpowiedziała błędem ${response.status}`);
    const raw = extractResponseText(body);
    if (!raw) throw new Error('usługa AI zwróciła pustą odpowiedź');
    const parsed = JSON.parse(raw);
    return {
      model,
      content: {
        summary: text(parsed.summary).slice(0, 4000),
        trends: stringList(parsed.trends).slice(0, 6),
        recommendations: recommendationList(parsed.recommendations).slice(0, 6),
        risks: stringList(parsed.risks).slice(0, 4),
        opportunities: stringList(parsed.opportunities).slice(0, 4),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

const channelName = (channel: SocialChannel) => SOCIAL_CHANNEL_LABELS[channel] || channel;
const countLabel = (count: number, one: string, few: string, many: string) => `${count} ${socialPlural(count, one, few, many)}`;

/** Liczby i wnioski bez AI (zawsze w raporcie; bez zgody na AI — cała treść raportu). */
function ruleBasedContent(input: {
  label: string; totals: SocialTotals; previous: SocialTotals; channels: Array<{ channel: SocialChannel; totals: SocialTotals }>;
  top: SocialTopPost[]; best: SocialBestTime[]; received: number; unanswered: number; scheduledNext: number; missingScopes: string[];
  problems: string[];
}): ReportContent {
  const { totals, previous } = input;
  const channelsText = input.channels.map((item) => `${channelName(item.channel)}: ${item.totals.publications}`).join(', ');
  const metricsText = [
    totals.views != null ? `wyświetlenia ${formatSocialNumber(totals.views)}${socialChangeLabel(totals.views, previous.views) ? ` (${socialChangeLabel(totals.views, previous.views)})` : ''}` : null,
    totals.reach != null ? `zasięg ${formatSocialNumber(totals.reach)}` : null,
    totals.interactions != null ? `interakcje ${formatSocialNumber(totals.interactions)}${socialChangeLabel(totals.interactions, previous.interactions) ? ` (${socialChangeLabel(totals.interactions, previous.interactions)})` : ''}` : null,
    totals.saves != null ? `zapisania ${formatSocialNumber(totals.saves)}` : null,
  ].filter(Boolean).join(', ');
  const summary = totals.posts
    ? `Tydzień ${input.label}: ${countLabel(totals.posts, 'opublikowany post', 'opublikowane posty', 'opublikowanych postów')}${channelsText ? ` (${channelsText})` : ''}.${metricsText ? ` Wyniki: ${metricsText}.` : ' Meta nie podała jeszcze wyników.'}`
    : `Tydzień ${input.label}: brak opublikowanych postów.${previous.posts ? ` Tydzień wcześniej: ${countLabel(previous.posts, 'post', 'posty', 'postów')}.` : ''}`;

  const trends: string[] = [];
  if (totals.posts && previous.posts) trends.push(`Liczba postów: ${totals.posts} wobec ${previous.posts} tydzień wcześniej.`);
  if (totals.rate != null) {
    const change = previous.rate != null ? ` (tydzień wcześniej ${formatSocialPercent(previous.rate)})` : '';
    trends.push(`Wskaźnik zaangażowania: ${formatSocialPercent(totals.rate)}${change}.`);
  }
  const bestChannel = input.channels.filter((item) => item.totals.rate != null).sort((a, b) => (b.totals.rate ?? 0) - (a.totals.rate ?? 0))[0];
  if (bestChannel && input.channels.length > 1) trends.push(`Najwyższe zaangażowanie: ${channelName(bestChannel.channel)} (${formatSocialPercent(bestChannel.totals.rate)}).`);
  if (input.top[0] && input.top[0].metrics.interactions != null) {
    trends.push(`Najwięcej interakcji: „${input.top[0].title}” — ${formatSocialNumber(input.top[0].metrics.interactions)}.`);
  }
  if (input.received) trends.push(`Komentarze w tygodniu: ${input.received}.`);

  const recommendations: SocialRecommendation[] = [];
  if (input.best[0]) {
    recommendations.push({
      title: `Publikuj: ${input.best[0].label}`,
      rationale: `W tej porze posty mają najwyższy wskaźnik zaangażowania (${formatSocialPercent(input.best[0].rate)}, ${countLabel(input.best[0].posts, 'post', 'posty', 'postów')} z ostatnich 6 miesięcy).`,
      priority: 'medium',
      channel: 'Instagram i Facebook',
    });
  }
  if (input.unanswered) {
    recommendations.push({
      title: `Odpowiedz na ${countLabel(input.unanswered, 'komentarz', 'komentarze', 'komentarzy')}`,
      rationale: 'Komentarze bez odpowiedzi czekają w zakładce „Komentarze”.',
      priority: 'high',
      channel: 'Instagram i Facebook',
    });
  }
  if (!input.scheduledNext) {
    recommendations.push({
      title: 'Zaplanuj posty na najbliższy tydzień',
      rationale: 'Na najbliższe 7 dni nie ma zaplanowanych publikacji.',
      priority: totals.posts ? 'medium' : 'high',
      channel: 'Instagram i Facebook',
    });
  }
  if (input.missingScopes.length) {
    recommendations.push({
      title: 'Uzupełnij uprawnienia Meta do statystyk',
      rationale: `Brakuje: ${input.missingScopes.join(', ')} — bez nich raport nie zawiera wszystkich wyników (zasięg, wyświetlenia, zapisania).`,
      priority: 'medium',
      channel: 'Meta',
    });
  }
  const risks: string[] = [];
  const viewsChange = totals.views != null && previous.views ? (totals.views - previous.views) / previous.views : null;
  if (viewsChange !== null && viewsChange <= -0.2) risks.push(`Wyświetlenia spadły o ${Math.round(Math.abs(viewsChange) * 100)}% wobec poprzedniego tygodnia.`);
  if (input.problems.length) risks.push(`Nie wszystkie wyniki udało się pobrać z Meta: ${input.problems[0]}`);
  return { summary, trends, recommendations, risks, opportunities: [] };
}

/**
 * Raport tygodniowy marki za tydzień od poniedziałku `weekStart` (domyślnie poprzedni tydzień). Najpierw odświeża wyniki
 * publikacji z ostatnich 3 tygodni. `actorId` — pracownik, który przygotował raport ręcznie (bez powiadomienia dla niego).
 */
export async function generateSocialWeeklyReport(options: { companyId: string; weekStart?: string | null; actorId?: string | null }) {
  const admin = createSupabaseAdminClient();
  const { data: lastWeekData } = await admin.rpc('social_report_last_week');
  const lastWeek = text(lastWeekData) || fallbackLastWeek();
  const start = options.weekStart || lastWeek;
  if (!isMonday(start)) fail('Raport obejmuje tydzień od poniedziałku.');
  if (start > lastWeek || start < addDays(lastWeek, -84)) fail('Raport można przygotować za jeden z 12 ostatnich pełnych tygodni.');
  const end = addDays(start, 6);
  const companyId = options.companyId;

  await syncSocialMetrics({ companyId, days: 21, limit: 80 }).catch((error) => console.warn('[social-report] metryki', errorMessage(error)));

  const startAt = warsawMidnight(start).toISOString();
  const endAt = warsawMidnight(addDays(start, 7)).toISOString();
  const previousAt = warsawMidnight(addDays(start, -7)).toISOString();
  const now = new Date();
  const [companyResult, publicationsResult, bestResult, receivedResult, unansweredResult, scheduledResult, settingsResult, account] = await Promise.all([
    admin.from('my_companies').select('id, name').eq('id', companyId).maybeSingle(),
    admin.from('social_publications').select(PUBLICATION_FIELDS).eq('company_id', companyId).eq('status', 'published')
      .gte('published_at', previousAt).lt('published_at', endAt).limit(1000),
    admin.from('social_publications').select('channel, published_at, metrics').eq('company_id', companyId).eq('status', 'published')
      .neq('channel', 'instagram_story').gte('published_at', new Date(Date.parse(endAt) - BEST_TIMES_DAYS * DAY).toISOString())
      .lt('published_at', endAt).limit(1000),
    admin.from('social_comments').select('id', { count: 'exact', head: true }).eq('company_id', companyId).is('parent_external_id', null)
      .eq('is_own', false).gte('commented_at', startAt).lt('commented_at', endAt),
    admin.from('social_comments').select('id', { count: 'exact', head: true }).eq('company_id', companyId).is('parent_external_id', null)
      .eq('is_own', false).is('answered_at', null),
    admin.from('social_posts').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('status', 'scheduled')
      .gte('scheduled_at', now.toISOString()).lt('scheduled_at', new Date(now.getTime() + 7 * DAY).toISOString()),
    admin.from('social_settings').select('ai_reports_enabled').eq('company_id', companyId).maybeSingle(),
    loadMetaAccount(admin, companyId).catch(() => null),
  ]);
  if (!companyResult.data) fail('Nie znaleziono marki.', 404);
  if (publicationsResult.error || bestResult.error) throw publicationsResult.error || bestResult.error;

  const rows = (publicationsResult.data || []) as Row[];
  const weekStartsAt = Date.parse(startAt);
  const current = rows.filter((row) => (Date.parse(text(row.published_at)) || 0) >= weekStartsAt);
  const previousRows = rows.filter((row) => (Date.parse(text(row.published_at)) || 0) < weekStartsAt);
  const totals = totalsOf(current);
  const previous = totalsOf(previousRows);
  const channels = channelTotals(current);
  const aggregates = postAggregates(current);
  const titles = await postTitles(admin, aggregates.map((item) => item.postId));
  const top: SocialTopPost[] = aggregates.slice(0, 3).map((item) => ({ ...item, title: postLabel(titles.get(item.postId)), thumbnailUrl: null }));
  const best = bestTimesOf((bestResult.data || []) as Row[]).top;
  const received = receivedResult.count || 0;
  const unanswered = unansweredResult.count || 0;
  const scheduledNext = scheduledResult.count || 0;
  const missingScopes = account?.connected ? account.missingScopes.filter((scope) => scope === 'read_insights' || scope === 'instagram_manage_insights') : [];
  const problems = Array.from(new Set(current.map((row) => text(row.metrics_error)).filter(Boolean)));
  const label = socialPeriodLabel(start, end);
  const rules = ruleBasedContent({ label, totals, previous, channels, top, best, received, unanswered, scheduledNext, missingScopes, problems });

  // AI: wyłącznie zagregowane wyniki — bez tytułów, opisów, komentarzy i danych osobowych.
  let content = rules;
  let model: string | null = null;
  let aiNote: string | null = null;
  let snapshot: Row = {};
  if ((settingsResult.data as Row | null)?.ai_reports_enabled === true) {
    snapshot = {
      okres: { od: start, do: end },
      wyniki: totals,
      poprzedniTydzien: previous,
      kanaly: channels.map((item) => ({ kanal: channelName(item.channel), ...item.totals })),
      posty: aggregates.slice(0, 30).map((item) => {
        const post = titles.get(item.postId);
        const slot = warsawSlot(item.publishedAt);
        return {
          kanaly: item.channels.map(channelName),
          dzien: slot ? SOCIAL_WEEKDAYS[slot.weekday] : null,
          pora: slot ? SOCIAL_TIME_BANDS[slot.band].label : null,
          dlugoscOpisu: text(post?.caption).length,
          hashtagi: Array.isArray(post?.hashtags) ? post!.hashtags.length : 0,
          wyniki: item.metrics,
        };
      }),
      najlepszePory6Miesiecy: best.map((item) => ({ pora: item.label, posty: item.posts, zaangazowanie: Number(item.rate.toFixed(4)) })),
      komentarze: { wTygodniu: received, bezOdpowiedzi: unanswered },
      zaplanowaneNa7Dni: scheduledNext,
      dostepneMetryki: {
        facebook: account?.insights.facebook ? 'pełne' : 'tylko reakcje, komentarze i udostępnienia',
        instagram: account?.insights.instagram ? 'pełne' : 'tylko polubienia i komentarze',
      },
    };
    try {
      const result = await aiReport(snapshot);
      model = result.model;
      content = {
        summary: result.content.summary || rules.summary,
        trends: result.content.trends.length ? result.content.trends : rules.trends,
        recommendations: result.content.recommendations.length ? result.content.recommendations : rules.recommendations,
        risks: result.content.risks,
        opportunities: result.content.opportunities,
      };
    } catch (error) {
      console.warn('[social-report] AI', errorMessage(error));
      aiNote = 'Analiza AI była chwilowo niedostępna — raport zawiera liczby i wnioski z danych.';
      snapshot = {};
    }
  } else {
    aiNote = 'Raport bez analizy AI — włącz ją w ustawieniach social media marki (zgoda akceptującego).';
  }

  const details = {
    version: 1,
    totals,
    previous,
    channels,
    topPosts: top.map((item) => ({
      postId: item.postId, title: item.title, channels: item.channels, publishedAt: item.publishedAt, permalink: item.permalink, metrics: item.metrics,
    })),
    bestTimes: best,
    comments: { received, unanswered },
    scheduledNext,
    trends: content.trends,
    missingScopes,
    aiNote,
    generatedAt: new Date().toISOString(),
  };
  const brand = text((companyResult.data as Row).name) || 'Marka';
  const message = [
    brand,
    label,
    totals.posts ? countLabel(totals.posts, 'post', 'posty', 'postów') : 'bez nowych postów',
    totals.views != null ? `${formatSocialNumber(totals.views)} wyświetleń` : null,
  ].filter(Boolean).join(' · ');
  const { data, error } = await admin.rpc('social_report_save', {
    p_company: companyId,
    p_period_start: start,
    p_period_end: end,
    p_summary: content.summary,
    p_recommendations: content.recommendations,
    p_risks: content.risks,
    p_opportunities: content.opportunities,
    p_model: model,
    p_input: snapshot,
    p_details: details,
    p_actor: options.actorId ?? null,
    p_message: message,
  });
  if (error) throw error;
  return { id: text(isObject(data) ? data.id : ''), created: isObject(data) && data.created === true, periodStart: start, ai: Boolean(model) };
}

/** Harmonogram (poniedziałek): raporty marek z publikacjami z ostatnich 5 tygodni, bez raportu za poprzedni tydzień. */
export async function generateDueSocialReports() {
  const admin = createSupabaseAdminClient();
  const { data: lastWeekData, error: weekError } = await admin.rpc('social_report_last_week');
  if (weekError) throw weekError;
  const lastWeek = text(lastWeekData) || fallbackLastWeek();
  const { data: publications, error } = await admin.from('social_publications').select('company_id').eq('status', 'published')
    .gte('published_at', new Date(Date.now() - 35 * DAY).toISOString()).limit(5000);
  if (error) throw error;
  const companies = Array.from(new Set(((publications || []) as Row[]).map((row) => String(row.company_id))));
  if (!companies.length) return { reports: [] };
  const { data: existing } = await admin.from('marketing_ai_insights').select('company_id').eq('kind', 'social_weekly')
    .eq('period_start', lastWeek).in('company_id', companies);
  const done = new Set(((existing || []) as Row[]).map((row) => String(row.company_id)));
  const reports: Array<{ companyId: string; id?: string; error?: string }> = [];
  for (const companyId of companies.filter((id) => !done.has(id))) {
    try {
      const result = await generateSocialWeeklyReport({ companyId, weekStart: lastWeek });
      reports.push({ companyId, id: result.id });
    } catch (reportError) {
      console.error('[social-report]', companyId, reportError);
      reports.push({ companyId, error: errorMessage(reportError) });
    }
  }
  return { reports };
}

/** „Przygotuj raport” (twórca treści): raport za poprzedni (albo wskazany) tydzień, potem zakładka z tym raportem. */
export async function generateReport(ctx: NativeContext, body: Row) {
  const companyId = uuidOrNull(body.companyId);
  if (!companyId) fail('Wybierz markę.');
  if (!(await socialAccess(ctx, companyId)).create) fail('Nie masz uprawnień do tej operacji w social media.', 403);
  const weekStart = text(body.weekStart).trim() || null;
  const result = await generateSocialWeeklyReport({ companyId, weekStart, actorId: ctx.employee.id });
  const params = new URLSearchParams({ company: companyId, report: result.id });
  if (body.days) params.set('days', String(body.days));
  return socialStats(ctx, params);
}
