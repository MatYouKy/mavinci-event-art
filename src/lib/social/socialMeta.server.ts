import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decryptMarketingCredentials } from '@/lib/marketing/crypto.server';
import { META_SOCIAL_SCOPES, MetaGraphError, hasMetaScope, metaGraph, missingMetaScopes } from '@/lib/marketing/metaGraph.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { SOCIAL_BUCKET, isObject, text, type Row } from './socialCommon.server';
import {
  SOCIAL_CHANNELS, SOCIAL_CHANNEL_LABELS, channelFormat, isSocialFormat, socialPublicationText, type SocialChannel, type SocialFormat,
} from './socialShared';

/*
 * Social media ↔ Meta (Etap 2): konto marki (strona Facebook, połączony Instagram firmowy, uprawnienia z ostatniej
 * autoryzacji), publikacja zaplanowanych postów (Facebook — zdjęcie z opisem, Instagram — post i relacja), komentarze
 * (pobieranie, odpowiedź) i ostatnie posty Instagram do siatki profilu.
 * Tokeny odczytuje wyłącznie serwer (klucz serwisowy, `marketing_integrations.credentials_encrypted`) i wysyła tylko
 * w nagłówku `Authorization`. Do przeglądarki, Maca i telefonu trafia stan bez tokenów (`SocialMetaStatus`).
 * Publikacja jest odporna na przerwanie: kanał „wysyłany” (`sending`) przy następnej próbie najpierw sprawdzamy w Meta
 * (post na stronie / status kontenera Instagram) i dopiero potem wysyłamy — bez podwójnej publikacji.
 */

type MetaCredentials = { user_access_token: string; page_access_tokens?: Record<string, string> };

export type SocialMetaChannelState = { ready: boolean; problem: string | null };

export type SocialMetaStatus = {
  connected: boolean;
  pageId: string | null;
  pageName: string | null;
  instagramId: string | null;
  instagramUsername: string | null;
  channels: Record<SocialChannel, SocialMetaChannelState>;
  comments: { facebookRead: boolean; facebookReply: boolean; instagram: boolean };
  missingScopes: string[];
  lastError: string | null;
};

export type SocialMetaAccount = SocialMetaStatus & { integrationId: string | null; pageToken: string | null; scopes: string[] };

const ALL_SOCIAL_SCOPES = Array.from(new Set(Object.values(META_SOCIAL_SCOPES).flat()));
const REAUTHORIZE = 'kliknij „Odśwież dostęp” przy Meta w ustawieniach marketingu marki';
const instagramLookups = new Map<string, number>();

export const errorMessage = (error: unknown) =>
  (error instanceof Error && error.message ? error.message : 'Nieznany błąd.').slice(0, 1000);

/** Konto Meta marki z tokenem strony (tylko serwer). */
export async function loadMetaAccount(admin: SupabaseClient, companyId: string): Promise<SocialMetaAccount> {
  const { data } = await admin.from('marketing_integrations')
    .select('id, status, settings, scopes, credentials_encrypted, last_error')
    .eq('company_id', companyId).eq('provider', 'meta').maybeSingle();
  const row = data as Row | null;
  const settings: Row = isObject(row?.settings) ? row!.settings : {};
  const scopes = Array.isArray(row?.scopes) ? (row!.scopes as unknown[]).map(String) : [];
  const pageId = text(settings.page_id).trim() || null;
  let pageToken: string | null = null;
  let decrypted = false;
  if (row?.credentials_encrypted) {
    try {
      const credentials = decryptMarketingCredentials<MetaCredentials>(String(row.credentials_encrypted));
      pageToken = (pageId && credentials.page_access_tokens?.[pageId]) || null;
      decrypted = true;
    } catch (error) {
      console.error('[social-meta] credentials', errorMessage(error));
    }
  }
  const connected = Boolean(row && row.status !== 'not_connected' && decrypted);
  let instagramId = text(settings.instagram_account_id).trim() || null;
  let instagramUsername = text(settings.instagram_username).trim() || null;

  // Połączenie sprzed Etapu 2 nie zna konta Instagram — sprawdzamy w Meta (najwyżej raz na 10 minut) i zapisujemy.
  if (connected && row?.id && pageId && pageToken && !instagramId && hasMetaScope(scopes, 'instagram_basic')
    && Date.now() - (instagramLookups.get(String(row.id)) || 0) > 10 * 60_000) {
    instagramLookups.set(String(row.id), Date.now());
    try {
      const page = await metaGraph<{ instagram_business_account?: { id: string; username?: string } }>(pageId, {
        token: pageToken, label: 'Konto Instagram strony', params: { fields: 'instagram_business_account{id,username}' },
      });
      if (page.instagram_business_account?.id) {
        instagramId = String(page.instagram_business_account.id);
        instagramUsername = text(page.instagram_business_account.username) || null;
        await admin.from('marketing_integrations').update({
          settings: { ...settings, instagram_account_id: instagramId, instagram_username: instagramUsername || '' },
        }).eq('id', row.id);
      }
    } catch (error) {
      console.warn('[social-meta] instagram lookup', errorMessage(error));
    }
  }

  const channelProblem = (channel: SocialChannel): string | null => {
    if (!row || !row.credentials_encrypted || row.status === 'not_connected') {
      return 'Meta nie jest połączona z marką — połącz konto w ustawieniach marketingu marki.';
    }
    if (!decrypted) return `Nie udało się odczytać zapisanego dostępu do Meta — ${REAUTHORIZE}.`;
    if (!pageId) return 'Wybierz stronę Facebook w ustawieniach marketingu marki.';
    if (!pageToken) return `Brak tokenu strony Facebook — ${REAUTHORIZE}.`;
    const required = channel === 'facebook_feed' ? META_SOCIAL_SCOPES.facebookPublish : META_SOCIAL_SCOPES.instagramPublish;
    const missing = missingMetaScopes(scopes, required);
    if (missing.length) {
      return `brak uprawnień Meta: ${missing.join(', ')} — dodaj je w konfiguracji logowania aplikacji Meta i ${REAUTHORIZE}.`;
    }
    if (channel !== 'facebook_feed' && !instagramId) {
      return `strona Facebook marki nie ma połączonego konta Instagram firmowego — połącz je w ustawieniach strony i ${REAUTHORIZE}.`;
    }
    return null;
  };
  const channels = Object.fromEntries(SOCIAL_CHANNELS.map((channel) => {
    const problem = channelProblem(channel);
    return [channel, { ready: !problem, problem }];
  })) as Record<SocialChannel, SocialMetaChannelState>;
  const usable = connected && Boolean(pageToken);
  return {
    integrationId: row?.id ? String(row.id) : null,
    pageToken,
    scopes,
    connected,
    pageId,
    pageName: text(settings.page_name) || null,
    instagramId,
    instagramUsername,
    channels,
    comments: {
      facebookRead: usable && hasMetaScope(scopes, 'pages_read_user_content'),
      facebookReply: usable && hasMetaScope(scopes, 'pages_read_user_content') && hasMetaScope(scopes, 'pages_manage_engagement'),
      instagram: usable && Boolean(instagramId) && hasMetaScope(scopes, 'instagram_manage_comments'),
    },
    missingScopes: connected ? missingMetaScopes(scopes, ALL_SOCIAL_SCOPES) : [],
    lastError: text(row?.last_error) || null,
  };
}

/** Stan konta Meta bez tokenów — dla web, Maca i telefonu. */
export function metaStatusDTO(account: SocialMetaAccount): SocialMetaStatus {
  return {
    connected: account.connected,
    pageId: account.pageId,
    pageName: account.pageName,
    instagramId: account.instagramId,
    instagramUsername: account.instagramUsername,
    channels: account.channels,
    comments: account.comments,
    missingScopes: account.missingScopes,
    lastError: account.lastError,
  };
}

export async function socialMetaAccount(companyId: string) {
  return loadMetaAccount(createSupabaseAdminClient(), companyId);
}

// Siatka profilu: ostatnie posty Instagram ----------------------------------------------------------------------------

export type InstagramGridItem = { id: string; imageUrl: string | null; permalink: string | null; date: string | null };
const gridCache = new Map<string, { at: number; items: InstagramGridItem[] }>();

/** Ostatnie posty profilu Instagram marki (pamięć 5 minut); `null` — konto nie jest dostępne. */
export async function instagramRecentMedia(account: SocialMetaAccount, companyId: string): Promise<InstagramGridItem[] | null> {
  if (!account.connected || !account.pageToken || !account.instagramId || !hasMetaScope(account.scopes, 'instagram_basic')) return null;
  const cached = gridCache.get(companyId);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.items;
  try {
    const result = await metaGraph<{ data?: Row[] }>(`${account.instagramId}/media`, {
      token: account.pageToken,
      label: 'Posty Instagram',
      params: { fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp', limit: 12 },
      timeoutMs: 15_000,
    });
    const items = (result.data || []).map((item) => ({
      id: text(item.id),
      imageUrl: (item.media_type === 'VIDEO' ? text(item.thumbnail_url) : text(item.media_url)) || null,
      permalink: text(item.permalink) || null,
      date: text(item.timestamp) || null,
    }));
    gridCache.set(companyId, { at: Date.now(), items });
    return items;
  } catch (error) {
    console.warn('[social-meta] instagram grid', errorMessage(error));
    return null;
  }
}

// Publikacja -----------------------------------------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
/** Instagram: opis razem z hashtagami. */
export const INSTAGRAM_CAPTION_LIMIT = 2200;
const CHANNEL_ORDER: SocialChannel[] = ['instagram_feed', 'facebook_feed', 'instagram_story'];

export type SocialPublishResult = { postId: string; status: string; error: string | null };

type PublicationRow = {
  id: string; status: string; attempts: number; attempted_at: string | null; container_id: string | null;
};

/** Błąd, po którym nie wiadomo, czy Meta przyjęła publikację (przerwane połączenie) — kanał zostaje „wysyłany”. */
class UncertainPublishError extends Error {}
/** Kanał nie został wysłany (brak grafiki, konto Meta niegotowe) — stan publikacji kanału się nie zmienia. */
class PrecheckError extends Error {}

const uncertain = (error: unknown) =>
  error instanceof MetaGraphError && error.status === 0
    ? new UncertainPublishError(`${error.message} Sprawdzę przy następnej próbie, czy post już jest, zanim wyślę go ponownie.`)
    : error;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function publicationRow(admin: SupabaseClient, post: Row, channel: SocialChannel, format: SocialFormat): Promise<PublicationRow> {
  const { data: existing, error } = await admin.from('social_publications').select('id, status, attempts, attempted_at, container_id')
    .eq('post_id', post.id).eq('channel', channel).maybeSingle();
  if (error) throw new Error(`Nie udało się odczytać stanu publikacji: ${error.message}`);
  if (existing) return existing as PublicationRow;
  const { data, error: insertError } = await admin.from('social_publications')
    .insert({ post_id: post.id, company_id: post.company_id, channel, format, status: 'pending' })
    .select('id, status, attempts, attempted_at, container_id').single();
  if (insertError || !data) throw new Error(`Nie udało się zapisać stanu publikacji: ${insertError?.message || ''}`);
  return data as PublicationRow;
}

async function updatePublication(admin: SupabaseClient, id: string, values: Row) {
  const { error } = await admin.from('social_publications').update(values).eq('id', id);
  if (error) throw new Error(`Nie udało się zapisać stanu publikacji: ${error.message}`);
}

async function signedImageUrl(admin: SupabaseClient, path: string) {
  const { data, error } = await admin.storage.from(SOCIAL_BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error('nie udało się udostępnić grafiki dla Meta.');
  return data.signedUrl;
}

const httpsOrNull = (value: unknown) => {
  const url = text(value).trim();
  return /^https:\/\/\S{4,}$/.test(url) && url.length <= 2000 ? url : null;
};

async function facebookPermalink(token: string, postId: string) {
  try {
    const result = await metaGraph<{ permalink_url?: string }>(postId, { token, label: 'Link do posta Facebook', params: { fields: 'permalink_url' } });
    return httpsOrNull(result.permalink_url) || `https://www.facebook.com/${postId}`;
  } catch {
    return `https://www.facebook.com/${postId}`;
  }
}

async function instagramPermalink(token: string, mediaId: string) {
  try {
    const result = await metaGraph<{ permalink?: string }>(mediaId, { token, label: 'Link do posta Instagram', params: { fields: 'permalink' } });
    return httpsOrNull(result.permalink);
  } catch {
    return null;
  }
}

const sameText = (a: unknown, b: string) => text(a).replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();
const notBefore = (value: unknown, since: number) => {
  const time = new Date(text(value)).getTime();
  return Number.isFinite(time) && time >= since;
};

/** Kontener Instagram gotowy do publikacji (zdjęcia zwykle od razu; czekamy najwyżej ~20 s). */
async function waitForContainer(token: string, containerId: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await metaGraph<{ status_code?: string; status?: string }>(containerId, {
      token, label: 'Instagram', params: { fields: 'status_code,status' },
    });
    const status = text(result.status_code);
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new Error(`Instagram odrzucił grafikę${result.status ? ` (${result.status})` : ''}.`);
    }
    await sleep(2500);
  }
  throw new Error('Instagram jeszcze przetwarza grafikę — ponów publikację za chwilę.');
}

/**
 * Kanał przerwany w trakcie wysyłki: czy post już jest w Meta? `done` — oznaczono jako opublikowany;
 * `container` — kontener Instagram gotowy do ponownej publikacji; `null` — można wysłać od nowa.
 */
async function recoverPublication(
  admin: SupabaseClient, account: SocialMetaAccount, channel: SocialChannel, publication: PublicationRow, message: string,
): Promise<'done' | { container: string } | null> {
  const token = account.pageToken as string;
  const since = (publication.attempted_at ? new Date(publication.attempted_at).getTime() : Date.now()) - 5 * 60_000;
  try {
    if (channel === 'facebook_feed') {
      const posts = await metaGraph<{ data?: Row[] }>(`${account.pageId}/published_posts`, {
        token, label: 'Facebook', params: { fields: 'id,message,created_time,permalink_url', limit: 10 },
      });
      const found = (posts.data || []).find((item) => sameText(item.message, message) && notBefore(item.created_time, since));
      if (!found) return null;
      await updatePublication(admin, publication.id, {
        status: 'published', external_id: text(found.id), permalink: httpsOrNull(found.permalink_url) || `https://www.facebook.com/${text(found.id)}`,
        published_at: text(found.created_time) || new Date().toISOString(), error: null,
      });
      return 'done';
    }
    if (!publication.container_id) return null;
    const container = await metaGraph<{ status_code?: string }>(publication.container_id, {
      token, label: 'Instagram', params: { fields: 'status_code' },
    });
    const status = text(container.status_code);
    if (status === 'FINISHED' || status === 'IN_PROGRESS') return { container: publication.container_id };
    if (status !== 'PUBLISHED') return null;
    const path = channel === 'instagram_story' ? `${account.instagramId}/stories` : `${account.instagramId}/media`;
    const media = await metaGraph<{ data?: Row[] }>(path, {
      token, label: 'Instagram', params: { fields: 'id,caption,timestamp,permalink', limit: 10 },
    });
    const found = (media.data || []).find((item) => notBefore(item.timestamp, since)
      && (channel === 'instagram_story' || sameText(item.caption, message)));
    await updatePublication(admin, publication.id, {
      status: 'published', external_id: found ? text(found.id) : null, permalink: found ? httpsOrNull(found.permalink) : null,
      published_at: found ? text(found.timestamp) || new Date().toISOString() : new Date().toISOString(), error: null,
    });
    return 'done';
  } catch (error) {
    // Nie da się sprawdzić — nie ponawiamy na ślepo; przy kolejnej próbie użytkownik świadomie wyśle ponownie.
    await updatePublication(admin, publication.id, {
      status: 'failed',
      error: `Nie udało się sprawdzić, czy post już jest w Meta (${errorMessage(error)}). Sprawdź profil przed ponowieniem publikacji.`.slice(0, 2000),
    });
    throw new Error('nie udało się sprawdzić, czy post już jest w Meta — sprawdź profil przed ponowieniem publikacji.');
  }
}

async function publishChannel(
  admin: SupabaseClient, account: SocialMetaAccount, post: Row, channel: SocialChannel, format: SocialFormat, path: string, message: string,
) {
  const publication = await publicationRow(admin, post, channel, format);
  if (publication.status === 'published') return;
  const token = account.pageToken as string;
  let reusable: string | null = null;
  if (publication.status === 'sending') {
    const recovered = await recoverPublication(admin, account, channel, publication, message);
    if (recovered === 'done') return;
    reusable = recovered?.container || null;
  }
  await updatePublication(admin, publication.id, {
    status: 'sending', attempts: (Number(publication.attempts) || 0) + 1, attempted_at: new Date().toISOString(), error: null, format,
    account_id: channel === 'facebook_feed' ? account.pageId : account.instagramId,
  });
  const imageUrl = await signedImageUrl(admin, path);

  if (channel === 'facebook_feed') {
    let result: { id?: string; post_id?: string };
    try {
      result = await metaGraph(`${account.pageId}/photos`, {
        token, method: 'POST', label: 'Facebook', params: { url: imageUrl, caption: message, published: true }, timeoutMs: 90_000,
      });
    } catch (error) {
      throw uncertain(error);
    }
    const externalId = text(result.post_id) || `${account.pageId}_${text(result.id)}`;
    await updatePublication(admin, publication.id, {
      status: 'published', external_id: externalId, permalink: await facebookPermalink(token, externalId),
      published_at: new Date().toISOString(), error: null,
    });
    return;
  }

  let container = reusable;
  if (!container) {
    const created = await metaGraph<{ id?: string }>(`${account.instagramId}/media`, {
      token,
      method: 'POST',
      label: 'Instagram',
      params: channel === 'instagram_story' ? { image_url: imageUrl, media_type: 'STORIES' } : { image_url: imageUrl, caption: message },
      timeoutMs: 90_000,
    });
    container = text(created.id);
    if (!container) throw new Error('Instagram nie zwrócił identyfikatora kontenera.');
    await updatePublication(admin, publication.id, { container_id: container });
  }
  await waitForContainer(token, container);
  let media: { id?: string };
  try {
    media = await metaGraph(`${account.instagramId}/media_publish`, {
      token, method: 'POST', label: 'Instagram', params: { creation_id: container }, timeoutMs: 90_000,
    });
  } catch (error) {
    throw uncertain(error);
  }
  const mediaId = text(media.id);
  await updatePublication(admin, publication.id, {
    status: 'published', external_id: mediaId || null, permalink: mediaId ? await instagramPermalink(token, mediaId) : null,
    published_at: new Date().toISOString(), error: null,
  });
}

async function publishClaimedPost(admin: SupabaseClient, postId: string, actorId: string | null): Promise<SocialPublishResult> {
  const errors: string[] = [];
  try {
    const { data } = await admin.from('social_posts').select('id, company_id, channels, caption, hashtags, publish_attempts')
      .eq('id', postId).maybeSingle();
    const post = data as Row | null;
    if (!post) throw new Error('Nie znaleziono posta.');
    if (Number(post.publish_attempts) > MAX_ATTEMPTS) {
      throw new Error('Publikacja nie powiodła się po kilku próbach — sprawdź połączenie z Meta i ponów publikację.');
    }
    const { data: problems } = await admin.rpc('social_post_problems', { p_post_id: postId, p_require_consent: true });
    if (Array.isArray(problems) && problems.length) throw new Error((problems as unknown[]).map(text).join(' '));
    const account = await loadMetaAccount(admin, String(post.company_id));
    const { data: variantData } = await admin.from('social_post_variants').select('format, rendered_path, asset_id').eq('post_id', postId);
    const rendered = new Map<SocialFormat, string>();
    for (const variant of (variantData || []) as Row[]) {
      if (variant.rendered_path && variant.asset_id && isSocialFormat(variant.format)) rendered.set(variant.format, String(variant.rendered_path));
    }
    const channels = CHANNEL_ORDER.filter((channel) => Array.isArray(post.channels) && post.channels.includes(channel));
    const hashtags = Array.isArray(post.hashtags) ? (post.hashtags as unknown[]).map(text) : [];
    const message = socialPublicationText(text(post.caption), hashtags);
    for (const channel of channels) {
      try {
        const format = channelFormat(channel, Array.from(rendered.keys()));
        if (!format) throw new PrecheckError('brak wygenerowanej grafiki — zapisz post, żeby ją utworzyć.');
        const problem = account.channels[channel].problem;
        if (problem) throw new PrecheckError(problem);
        if (channel === 'instagram_feed' && message.length > INSTAGRAM_CAPTION_LIMIT) {
          throw new PrecheckError(`opis z hashtagami ma ${message.length} znaków — Instagram przyjmuje najwyżej ${INSTAGRAM_CAPTION_LIMIT}.`);
        }
        await publishChannel(admin, account, post, channel, format, rendered.get(format) as string, message);
      } catch (error) {
        const failure = `${SOCIAL_CHANNEL_LABELS[channel]}: ${errorMessage(error)}`.slice(0, 2000);
        errors.push(failure);
        const { data: publication } = await admin.from('social_publications').select('id, status').eq('post_id', postId).eq('channel', channel).maybeSingle();
        if (publication && publication.status !== 'published') {
          // Niepewny wynik wysyłki i braki sprzed wysyłki nie zmieniają stanu kanału (bez ryzyka podwójnej publikacji).
          const keep = error instanceof UncertainPublishError || error instanceof PrecheckError;
          await admin.from('social_publications').update(keep ? { error: failure } : { status: 'failed', error: failure }).eq('id', publication.id);
        }
      }
    }
  } catch (error) {
    errors.push(errorMessage(error));
  }
  const { data: finished, error: finishError } = await admin.rpc('social_publish_finish', {
    p_post_id: postId, p_ok: errors.length === 0, p_error: errors.length ? errors.join(' ').slice(0, 2000) : null, p_actor: actorId,
  });
  if (finishError) console.error('[social-publish] finish', finishError.message);
  const result = isObject(finished) ? finished : {};
  return { postId, status: text(result.status) || (errors.length ? 'failed' : 'published'), error: errors.length ? errors.join(' ') : null };
}

/** Publikacja postów w terminie (pg_cron) albo jednego posta („Opublikuj teraz” — `actorId` nie dostaje powiadomienia o błędzie). */
export async function runSocialPublishing(options: { postId?: string | null; actorId?: string | null; limit?: number } = {}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('social_publish_claim', { p_post_id: options.postId ?? null, p_limit: options.limit ?? 5 });
  if (error) throw new Error(`Nie udało się pobrać postów do publikacji: ${error.message}`);
  const ids = (Array.isArray(data) ? data : []).map((item: unknown) => (isObject(item) ? text(item.social_publish_claim) : text(item))).filter(Boolean);
  const results: SocialPublishResult[] = [];
  for (const id of ids) results.push(await publishClaimedPost(admin, id, options.actorId ?? null));
  return results;
}

// Komentarze -----------------------------------------------------------------------------------------------------------

type CommentInput = {
  external_id: string; parent_external_id: string | null; author_name: string; author_external_id: string | null;
  is_own: boolean; message: string; commented_at: string; like_count: number;
};

const commentTime = (value: unknown) => {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

async function fetchComments(account: SocialMetaAccount, publication: Row): Promise<CommentInput[] | null> {
  const token = account.pageToken as string;
  if (publication.channel === 'facebook_feed') {
    if (!account.comments.facebookRead) return null;
    const result = await metaGraph<{ data?: Row[] }>(`${publication.external_id}/comments`, {
      token,
      label: 'Komentarze Facebook',
      params: {
        fields: 'id,message,from{id,name},created_time,like_count,comments.limit(50){id,message,from{id,name},created_time,like_count}',
        filter: 'toplevel', order: 'reverse_chronological', limit: 50,
      },
    });
    const map = (item: Row, parent: string | null): CommentInput => ({
      external_id: text(item.id),
      parent_external_id: parent,
      author_name: (isObject(item.from) ? text(item.from.name) : '') || 'Użytkownik Facebooka',
      author_external_id: isObject(item.from) ? text(item.from.id) || null : null,
      is_own: isObject(item.from) && text(item.from.id) === account.pageId,
      message: text(item.message).slice(0, 8000),
      commented_at: commentTime(item.created_time),
      like_count: Math.max(0, Number(item.like_count) || 0),
    });
    return (result.data || []).flatMap((item) => [
      map(item, null),
      ...((isObject(item.comments) && Array.isArray(item.comments.data) ? item.comments.data : []) as Row[]).map((reply) => map(reply, text(item.id))),
    ]).filter((item) => item.external_id);
  }
  if (publication.channel !== 'instagram_feed' || !account.comments.instagram) return null;
  const result = await metaGraph<{ data?: Row[] }>(`${publication.external_id}/comments`, {
    token,
    label: 'Komentarze Instagram',
    params: { fields: 'id,text,username,timestamp,like_count,from{id,username},replies{id,text,username,timestamp,like_count,from{id,username}}', limit: 50 },
  });
  const own = (item: Row) => (isObject(item.from) && text(item.from.id) === account.instagramId)
    || Boolean(account.instagramUsername && text(item.username).toLowerCase() === account.instagramUsername.toLowerCase());
  const map = (item: Row, parent: string | null): CommentInput => ({
    external_id: text(item.id),
    parent_external_id: parent,
    author_name: text(item.username) || (isObject(item.from) ? text(item.from.username) : '') || 'Użytkownik Instagrama',
    author_external_id: isObject(item.from) ? text(item.from.id) || null : null,
    is_own: own(item),
    message: text(item.text).slice(0, 8000),
    commented_at: commentTime(item.timestamp),
    like_count: Math.max(0, Number(item.like_count) || 0),
  });
  return (result.data || []).flatMap((item) => [
    map(item, null),
    ...((isObject(item.replies) && Array.isArray(item.replies.data) ? item.replies.data : []) as Row[]).map((reply) => map(reply, text(item.id))),
  ]).filter((item) => item.external_id);
}

/** Komentarze jednej publikacji: zapis, „ma odpowiedź marki”; zwraca liczbę nowych komentarzy bez odpowiedzi. */
async function syncPublicationComments(admin: SupabaseClient, account: SocialMetaAccount, publication: Row): Promise<number> {
  if (!account.connected || !account.pageToken) return 0;
  const comments = await fetchComments(account, publication);
  if (!comments) return 0;
  const platform = publication.channel === 'facebook_feed' ? 'facebook' : 'instagram';
  const { data: existingData } = await admin.from('social_comments').select('external_id').eq('publication_id', publication.id);
  const existing = new Set(((existingData || []) as Row[]).map((row) => text(row.external_id)));
  if (comments.length) {
    const { error } = await admin.from('social_comments').upsert(comments.map((comment) => ({
      ...comment,
      company_id: publication.company_id,
      post_id: publication.post_id,
      publication_id: publication.id,
      platform,
    })), { onConflict: 'platform,external_id' });
    if (error) throw new Error(`Nie udało się zapisać komentarzy: ${error.message}`);
  }
  const answered = new Map<string, string>();
  for (const comment of comments) {
    if (!comment.is_own || !comment.parent_external_id) continue;
    const current = answered.get(comment.parent_external_id);
    if (!current || comment.commented_at < current) answered.set(comment.parent_external_id, comment.commented_at);
  }
  for (const [externalId, at] of answered) {
    await admin.from('social_comments').update({ answered_at: at }).eq('platform', platform).eq('external_id', externalId).is('answered_at', null);
  }
  const fresh = comments.filter((comment) => !comment.parent_external_id && !comment.is_own && !existing.has(comment.external_id)
    && !answered.has(comment.external_id)).map((comment) => comment.external_id);
  if (fresh.length) {
    await admin.from('social_comments').update({ notified_at: new Date().toISOString() }).eq('platform', platform).in('external_id', fresh);
  }
  await admin.from('social_publications').update({ comments_synced_at: new Date().toISOString() }).eq('id', publication.id);
  return fresh.length;
}

/**
 * Odświeżenie komentarzy: opublikowane posty z ostatnich 30 dni (harmonogram), posty jednej marki, jeden post albo
 * wskazane publikacje (webhook). Nowe komentarze bez odpowiedzi → jedno powiadomienie autora posta.
 */
export async function syncSocialComments(options: { postId?: string; companyId?: string; publicationIds?: string[]; limit?: number } = {}) {
  const admin = createSupabaseAdminClient();
  let query = admin.from('social_publications').select('id, post_id, company_id, channel, external_id, published_at')
    .eq('status', 'published').not('external_id', 'is', null).in('channel', ['instagram_feed', 'facebook_feed']);
  if (options.postId) query = query.eq('post_id', options.postId);
  else if (options.publicationIds?.length) query = query.in('id', options.publicationIds);
  else {
    query = query.gte('published_at', new Date(Date.now() - 30 * 86_400_000).toISOString());
    if (options.companyId) query = query.eq('company_id', options.companyId);
  }
  const { data, error } = await query.order('published_at', { ascending: false }).limit(options.limit ?? 100);
  if (error) throw new Error(`Nie udało się pobrać opublikowanych postów: ${error.message}`);
  const accounts = new Map<string, SocialMetaAccount>();
  const freshByPost = new Map<string, number>();
  const errors: string[] = [];
  let synced = 0;
  for (const publication of (data || []) as Row[]) {
    const companyId = String(publication.company_id);
    let account = accounts.get(companyId);
    if (!account) {
      account = await loadMetaAccount(admin, companyId);
      accounts.set(companyId, account);
    }
    try {
      const fresh = await syncPublicationComments(admin, account, publication);
      synced += 1;
      if (fresh) freshByPost.set(String(publication.post_id), (freshByPost.get(String(publication.post_id)) || 0) + fresh);
    } catch (syncError) {
      errors.push(`${SOCIAL_CHANNEL_LABELS[publication.channel as SocialChannel] || 'Meta'}: ${errorMessage(syncError)}`);
    }
  }
  for (const [postId, count] of freshByPost) {
    const { error: notifyError } = await admin.rpc('social_comments_notify', { p_post_id: postId, p_count: count });
    if (notifyError) console.error('[social-comments] notify', notifyError.message);
  }
  return { publications: (data || []).length, synced, newComments: Array.from(freshByPost.values()).reduce((sum, value) => sum + value, 0), errors };
}

/** Odpowiedź marki na komentarz (strona Facebook / profil Instagram) — zapis w bazie i „ma odpowiedź”. */
export async function replyAsBrand(comment: Row, message: string, employeeId: string) {
  const admin = createSupabaseAdminClient();
  const account = await loadMetaAccount(admin, String(comment.company_id));
  const facebook = comment.platform === 'facebook';
  if (facebook ? !account.comments.facebookReply : !account.comments.instagram) {
    throw Object.assign(new Error(facebook
      ? `Odpowiedzi na Facebooku wymagają uprawnień pages_read_user_content i pages_manage_engagement — ${REAUTHORIZE}.`
      : `Odpowiedzi na Instagramie wymagają uprawnienia instagram_manage_comments i połączonego konta Instagram — ${REAUTHORIZE}.`), { status: 422 });
  }
  const root = text(comment.parent_external_id) || text(comment.external_id);
  let result: { id?: string };
  try {
    result = await metaGraph(facebook ? `${root}/comments` : `${root}/replies`, {
      token: account.pageToken as string, method: 'POST', label: facebook ? 'Facebook' : 'Instagram', params: { message },
    });
  } catch (error) {
    throw Object.assign(new Error(errorMessage(error)), { status: 502 });
  }
  const now = new Date().toISOString();
  if (result.id) {
    await admin.from('social_comments').upsert({
      company_id: comment.company_id,
      post_id: comment.post_id,
      publication_id: comment.publication_id,
      platform: comment.platform,
      external_id: text(result.id),
      parent_external_id: root,
      author_name: facebook ? account.pageName || 'Strona marki' : account.instagramUsername || 'Profil marki',
      author_external_id: facebook ? account.pageId : account.instagramId,
      is_own: true,
      message,
      commented_at: now,
      replied_by: employeeId,
    }, { onConflict: 'platform,external_id' });
  }
  await admin.from('social_comments').update({ answered_at: now }).eq('platform', comment.platform).eq('external_id', root).is('answered_at', null);
}

/** Publikacje odpowiadające zdarzeniom webhooka (post strony albo media Instagram). */
export async function publicationsForExternalIds(admin: SupabaseClient, ids: { facebook: string[]; instagram: string[] }) {
  const found: string[] = [];
  if (ids.facebook.length) {
    const { data } = await admin.from('social_publications').select('id').eq('channel', 'facebook_feed').in('external_id', ids.facebook);
    found.push(...((data || []) as Row[]).map((row) => String(row.id)));
  }
  if (ids.instagram.length) {
    const { data } = await admin.from('social_publications').select('id').eq('channel', 'instagram_feed').in('external_id', ids.instagram);
    found.push(...((data || []) as Row[]).map((row) => String(row.id)));
  }
  return Array.from(new Set(found));
}
