import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MetaGraphError, hasMetaScope, metaGraph } from '@/lib/marketing/metaGraph.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { isObject, text, type Row } from './socialCommon.server';
import { errorMessage, loadMetaAccount, type SocialMetaAccount } from './socialMeta.server';
import {
  SOCIAL_METRICS, SOCIAL_METRIC_COLUMNS, socialMetricsFromRow, type SocialChannel, type SocialMetricKey, type SocialMetricValues,
} from './socialShared';

/*
 * Social media (Etap 3): wyniki opublikowanych postów z Meta Graph API (token strony tylko na serwerze, w nagłówku).
 *  - Instagram post: `/{media}/insights` — views, reach, saved, shares, total_interactions, likes, comments, profile_visits,
 *    follows (bez `instagram_manage_insights` — `like_count` i `comments_count` z pól posta),
 *  - Instagram relacja: views, reach, shares, total_interactions, replies, profile_visits, follows — Meta podaje je tylko
 *    przez 24 h od publikacji i tylko przy co najmniej 5 odbiorcach,
 *  - Facebook: pola posta (reakcje, komentarze, udostępnienia) + `/{post}/insights` z `read_insights` — post_media_view
 *    (wyświetlenia), post_total_media_view_unique (zasięg), post_clicks.
 * Metryka, której Meta nie zna w danej wersji API (kod 100), jest pomijana i zapamiętywana — pozostałe pobierają się dalej.
 * Wynik: `social_publications.metrics` (ostatni stan) + zrzut dnia w `social_post_metrics_daily`.
 */

const INSTAGRAM_FEED: Partial<Record<SocialMetricKey, string>> = {
  views: 'views', reach: 'reach', saves: 'saved', shares: 'shares', interactions: 'total_interactions', likes: 'likes',
  comments: 'comments', profileVisits: 'profile_visits', follows: 'follows',
};
const INSTAGRAM_STORY: Partial<Record<SocialMetricKey, string>> = {
  views: 'views', reach: 'reach', shares: 'shares', interactions: 'total_interactions', replies: 'replies',
  profileVisits: 'profile_visits', follows: 'follows',
};
const FACEBOOK_POST: Partial<Record<SocialMetricKey, string>> = {
  views: 'post_media_view', reach: 'post_total_media_view_unique', clicks: 'post_clicks',
};

/** Metryki odrzucone przez Meta jako nieznane (kanał:metryka) — nie pytamy o nie ponownie do restartu serwera. */
const unsupported = new Set<string>();

class MetricsProblem extends Error {}

const invalidMetric = (error: unknown) =>
  error instanceof MetaGraphError && error.code === 100 && /metric/i.test(error.message);
const denied = (error: unknown) =>
  error instanceof MetaGraphError && (error.code === 10 || (error.code !== null && error.code >= 200 && error.code <= 299));

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  if (isObject(value)) {
    const numbers = Object.values(value).map(numeric).filter((item): item is number => item !== null);
    return numbers.length ? numbers.reduce((sum, item) => sum + item, 0) : null;
  }
  return null;
}

/** Wartość metryki z odpowiedzi `insights` (`values[…].value` albo `total_value.value`). */
function insightValue(item: Row): number | null {
  if (Array.isArray(item.values) && item.values.length) return numeric(item.values[item.values.length - 1]?.value);
  if (isObject(item.total_value)) return numeric(item.total_value.value);
  return null;
}

async function insights(path: string, token: string, channel: SocialChannel, wanted: Partial<Record<SocialMetricKey, string>>) {
  const names = Array.from(new Set(Object.values(wanted).filter((name): name is string => Boolean(name))))
    .filter((name) => !unsupported.has(`${channel}:${name}`));
  const values = new Map<string, number>();
  const read = (payload: { data?: Row[] }) => {
    for (const item of payload.data || []) {
      const value = insightValue(item);
      if (value !== null && value >= 0) values.set(text(item.name), value);
    }
  };
  if (!names.length) return values;
  try {
    read(await metaGraph<{ data?: Row[] }>(`${path}/insights`, {
      token, label: 'Statystyki posta', params: { metric: names.join(',') }, timeoutMs: 20_000,
    }));
  } catch (error) {
    if (!invalidMetric(error)) throw error;
    // Jedna z metryk nie istnieje w tej wersji API — pytamy o każdą osobno i zapamiętujemy nieznane.
    for (const name of names) {
      try {
        read(await metaGraph<{ data?: Row[] }>(`${path}/insights`, {
          token, label: 'Statystyki posta', params: { metric: name }, timeoutMs: 20_000,
        }));
      } catch (inner) {
        if (!invalidMetric(inner)) throw inner;
        unsupported.add(`${channel}:${name}`);
        console.warn('[social-metrics] metryka nieobsługiwana przez Meta', channel, name);
      }
    }
  }
  return values;
}

const mapValues = (source: Map<string, number>, wanted: Partial<Record<SocialMetricKey, string>>): SocialMetricValues => {
  const result: SocialMetricValues = {};
  for (const [key, name] of Object.entries(wanted) as Array<[SocialMetricKey, string]>) {
    const value = source.get(name);
    if (value !== undefined) result[key] = value;
  }
  return result;
};

/** Interakcje policzone z części, gdy Meta nie podała sumy. */
function withInteractions(metrics: SocialMetricValues): SocialMetricValues {
  if (metrics.interactions != null) return metrics;
  const parts = [metrics.likes, metrics.comments, metrics.shares, metrics.saves].filter((item): item is number => item != null);
  return parts.length ? { ...metrics, interactions: parts.reduce((sum, item) => sum + item, 0) } : metrics;
}

async function instagramMetrics(account: SocialMetaAccount, publication: Row): Promise<SocialMetricValues> {
  const token = account.pageToken as string;
  const channel = publication.channel as SocialChannel;
  const story = channel === 'instagram_story';
  const mediaId = text(publication.external_id);
  if (hasMetaScope(account.scopes, 'instagram_manage_insights')) {
    try {
      return withInteractions(mapValues(await insights(mediaId, token, channel, story ? INSTAGRAM_STORY : INSTAGRAM_FEED),
        story ? INSTAGRAM_STORY : INSTAGRAM_FEED));
    } catch (error) {
      if (story && error instanceof MetaGraphError && error.code === 10) {
        throw new MetricsProblem('Za mało odbiorców relacji, by Meta podała statystyki (najmniej 5).');
      }
      if (!denied(error)) throw error;
    }
  }
  if (story) throw new MetricsProblem('Statystyki relacji wymagają uprawnienia Meta instagram_manage_insights.');
  // Bez uprawnień do statystyk: polubienia i komentarze z pól posta.
  const media = await metaGraph<Row>(mediaId, { token, label: 'Post Instagram', params: { fields: 'like_count,comments_count' } });
  return withInteractions({
    ...(numeric(media.like_count) !== null ? { likes: numeric(media.like_count) as number } : {}),
    ...(numeric(media.comments_count) !== null ? { comments: numeric(media.comments_count) as number } : {}),
  });
}

async function facebookMetrics(account: SocialMetaAccount, publication: Row): Promise<SocialMetricValues> {
  const token = account.pageToken as string;
  const postId = text(publication.external_id);
  const result: SocialMetricValues = {};
  const fieldSets = [
    'shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)',
    'shares,reactions.summary(total_count).limit(0)',
  ];
  for (const fields of fieldSets) {
    try {
      const post = await metaGraph<Row>(postId, { token, label: 'Post Facebook', params: { fields } });
      if (isObject(post.shares)) result.shares = numeric(post.shares.count) ?? 0;
      else result.shares = 0;
      const reactions = isObject(post.reactions) && isObject(post.reactions.summary) ? numeric(post.reactions.summary.total_count) : null;
      if (reactions !== null) result.likes = reactions;
      const comments = isObject(post.comments) && isObject(post.comments.summary) ? numeric(post.comments.summary.total_count) : null;
      if (comments !== null) result.comments = comments;
      break;
    } catch (error) {
      // Komentarze wymagają `pages_read_user_content` — bez nich pobieramy reakcje i udostępnienia.
      if (!denied(error) || fields === fieldSets[fieldSets.length - 1]) throw error;
    }
  }
  if (hasMetaScope(account.scopes, 'read_insights')) {
    try {
      Object.assign(result, mapValues(await insights(postId, token, 'facebook_feed', FACEBOOK_POST), FACEBOOK_POST));
    } catch (error) {
      if (!denied(error)) throw error;
    }
  }
  return withInteractions(result);
}

/** Dzień w strefie Warszawa („RRRR-MM-DD”). */
export const warsawDate = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

const toColumns = (metrics: SocialMetricValues): Row =>
  Object.fromEntries(SOCIAL_METRICS.map((key) => [SOCIAL_METRIC_COLUMNS[key], metrics[key] ?? null]));

const toJson = (metrics: SocialMetricValues): Row =>
  Object.fromEntries(SOCIAL_METRICS.filter((key) => metrics[key] != null).map((key) => [SOCIAL_METRIC_COLUMNS[key], metrics[key]]));

async function syncPublication(admin: SupabaseClient, account: SocialMetaAccount | null, publication: Row) {
  let metrics: SocialMetricValues = {};
  let problem: string | null = null;
  if (!account || !account.connected || !account.pageToken) {
    problem = 'Meta nie jest połączona z marką — połącz konto w ustawieniach marketingu marki.';
  } else {
    try {
      metrics = publication.channel === 'facebook_feed'
        ? await facebookMetrics(account, publication)
        : await instagramMetrics(account, publication);
    } catch (error) {
      problem = error instanceof MetricsProblem ? error.message : errorMessage(error);
      if (!(error instanceof MetricsProblem)) console.warn('[social-metrics]', publication.id, problem);
    }
  }
  // Ostatni stan: nowe wartości nadpisują poprzednie, metryki chwilowo niedostępne zostają z poprzedniego pobrania.
  const merged: SocialMetricValues = { ...socialMetricsFromRow(isObject(publication.metrics) ? publication.metrics : null), ...metrics };
  const now = new Date().toISOString();
  if (Object.keys(metrics).length) {
    const { error } = await admin.from('social_post_metrics_daily').upsert({
      publication_id: publication.id,
      metric_date: warsawDate(),
      post_id: publication.post_id,
      company_id: publication.company_id,
      channel: publication.channel,
      ...toColumns(merged),
    }, { onConflict: 'publication_id,metric_date' });
    if (error) console.error('[social-metrics] zrzut dnia', error.message);
  }
  const { error } = await admin.from('social_publications').update({
    metrics: toJson(merged),
    metrics_synced_at: now,
    metrics_error: problem ? problem.slice(0, 1000) : null,
  }).eq('id', publication.id);
  if (error) console.error('[social-metrics] publikacja', error.message);
  return { ok: !problem, metrics: merged };
}

const PUBLICATION_FIELDS = 'id, post_id, company_id, channel, external_id, published_at, metrics, metrics_synced_at';

/**
 * Odświeżenie wyników. Bez opcji — kolejka z harmonogramu (`social_metrics_due`); `postId` — kanały posta; `companyId` —
 * publikacje marki z ostatnich `days` dni (domyślnie 90; relacje tylko z 24 h), pobrane ponad 10 minut temu.
 */
export async function syncSocialMetrics(options: { postId?: string; companyId?: string; days?: number; limit?: number } = {}) {
  const admin = createSupabaseAdminClient();
  const limit = Math.min(Math.max(options.limit ?? 40, 1), 200);
  let rows: Row[] = [];
  if (options.postId || options.companyId) {
    let query = admin.from('social_publications').select(PUBLICATION_FIELDS)
      .eq('status', 'published').not('external_id', 'is', null).not('published_at', 'is', null);
    if (options.postId) {
      query = query.eq('post_id', options.postId);
    } else {
      const since = new Date(Date.now() - Math.min(Math.max(options.days ?? 90, 1), 90) * 86_400_000).toISOString();
      const fresh = new Date(Date.now() - 10 * 60_000).toISOString();
      query = query.eq('company_id', options.companyId as string).gte('published_at', since)
        .or(`metrics_synced_at.is.null,metrics_synced_at.lt.${fresh}`);
    }
    const { data, error } = await query.order('published_at', { ascending: false }).limit(limit);
    if (error) throw error;
    const storyLimit = Date.now() - 24 * 3_600_000;
    rows = ((data || []) as Row[]).filter((row) =>
      row.channel !== 'instagram_story' || new Date(text(row.published_at)).getTime() > storyLimit);
  } else {
    const { data: due, error: dueError } = await admin.rpc('social_metrics_due', { p_limit: limit, p_company: null });
    if (dueError) throw dueError;
    const ids = ((due || []) as unknown[]).map((item) => (isObject(item) ? text(Object.values(item)[0]) : text(item))).filter(Boolean);
    if (ids.length) {
      const { data, error } = await admin.from('social_publications').select(PUBLICATION_FIELDS).in('id', ids);
      if (error) throw error;
      rows = (data || []) as Row[];
    }
  }

  const accounts = new Map<string, SocialMetaAccount | null>();
  let synced = 0;
  let failed = 0;
  for (const row of rows) {
    const companyId = String(row.company_id);
    if (!accounts.has(companyId)) {
      accounts.set(companyId, await loadMetaAccount(admin, companyId).catch((error) => {
        console.warn('[social-metrics] konto Meta', errorMessage(error));
        return null;
      }));
    }
    const result = await syncPublication(admin, accounts.get(companyId) || null, row);
    if (result.ok) synced += 1;
    else failed += 1;
  }
  return { publications: rows.length, synced, failed };
}
