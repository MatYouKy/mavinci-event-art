import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import {
  socialBrandDefaultTerms, socialBrandTermsRegex, type SocialBrandChannel,
} from '@/lib/social/socialShared';
import { MetaGraphError, metaGraph } from './metaGraph.server';
import { readJsonResponse } from './providers.server';

/*
 * Statystyki social media → „Zainteresowanie marką” — pobieranie liczb z Google i Meta (migracja
 * 20261130130000_brand_interest.sql). Wyłącznie liczby: Google i Meta nie podają, kto szukał ani kto odwiedził profil.
 *  - Google (Search Console): frazy zawierające nazwę marki (`includingRegex`, frazy z ustawień albo z nazwy i adresu
 *    strony marki) — dzień × fraza: wyświetlenia strony w wynikach (≈ wyszukiwania nazwy) i kliknięcia, 90 dni przy każdym
 *    pobraniu; dni bez fraz marki do ostatniego dnia, za który Google ma dane strony, zapisujemy jako 0.
 *  - Facebook: `page_views_total` (dziennie, 90 dni jednym zapytaniem; dzień = `end_time` − 1 doba, jak liczy Meta).
 *  - Instagram: `profile_views` konta (`metric_type=total_value`, jedno zapytanie na dzień w strefie Warszawa) — 3 ostatnie
 *    dni przy każdym pobraniu (Meta uzupełnia dane do 48 h) i najwyżej 10 brakujących dni z 90. Gdy Meta odrzuci metrykę
 *    jako nieznaną, kanał ma stan „niedostępne”, a widok liczy wejścia na profil z postów opublikowanych z CRM.
 * Wywołania: synchronizacja marketingu (co 6 godzin, `sync.server.ts`), „Odśwież” w statystykach i zmiana fraz marki.
 * Funkcje nie rzucają błędów Google / Meta — zapisują stan kanału z komunikatem (widoczny w statystykach).
 */

export const BRAND_INTEREST_DAYS = 90;
const INSTAGRAM_RECENT_DAYS = 3;
const INSTAGRAM_BACKFILL_PER_SYNC = 10;
const QUERIES_PER_DAY = 50;
const SEARCH_CONSOLE_PAGE = 25_000;

type BrandDay = { date: string; views: number; clicks?: number | null };
type BrandQuery = { date: string; query: string; impressions: number; clicks: number };
type BrandStatus = 'ok' | 'pending' | 'unavailable' | 'error';
export type BrandSyncResult = { channel: SocialBrandChannel; ok: boolean; status: BrandStatus; days: number; message: string | null };

// Daty w strefie Warszawa ------------------------------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });
const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

export const brandWarsawDate = (date = new Date()) => dayFormatter.format(date);

export function brandAddDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function warsawOffset(utc: number) {
  const parts = Object.fromEntries(offsetFormatter.formatToParts(new Date(utc)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)) - utc;
}

/** Północ dnia „RRRR-MM-DD” w Warszawie jako sekundy UTC. */
function warsawMidnightSeconds(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const guess = Date.UTC(year, month - 1, day);
  return Math.round((guess - warsawOffset(guess - warsawOffset(guess))) / 1000);
}

const count = (value: unknown) => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};

const errorText = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Nieznany błąd.').slice(0, 480);

// Zapis ---------------------------------------------------------------------------------------------------------------------

async function saveBrandInterest(input: {
  companyId: string;
  channel: SocialBrandChannel;
  status: BrandStatus;
  message?: string | null;
  days?: BrandDay[] | null;
  queries?: BrandQuery[] | null;
  replaceFrom?: string | null;
  replaceTo?: string | null;
}) {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('marketing_brand_interest_save', {
    p_company: input.companyId,
    p_channel: input.channel,
    p_status: input.status,
    p_message: input.message || null,
    p_days: input.days ?? null,
    p_queries: input.queries ?? null,
    p_replace_from: input.replaceFrom || null,
    p_replace_to: input.replaceTo || null,
  });
  if (error) throw new Error(`Zapis zainteresowania marką: ${error.message}`);
}

/** Stan kanału bez danych (np. błąd odświeżenia tokenu przed pobraniem). Błąd zapisu tylko w logu. */
export async function saveBrandInterestState(companyId: string, channel: SocialBrandChannel, status: BrandStatus, message: string | null) {
  try {
    await saveBrandInterest({ companyId, channel, status, message });
  } catch (error) {
    console.warn('[brand-interest] stan', channel, errorText(error));
  }
}

async function finish(
  companyId: string,
  channel: SocialBrandChannel,
  status: BrandStatus,
  message: string | null,
  data: { days?: BrandDay[]; queries?: BrandQuery[]; replaceFrom?: string; replaceTo?: string } = {},
): Promise<BrandSyncResult> {
  try {
    await saveBrandInterest({ companyId, channel, status, message, ...data });
    return { channel, ok: status === 'ok', status, days: data.days?.length || 0, message };
  } catch (error) {
    console.warn('[brand-interest] zapis', channel, errorText(error));
    return { channel, ok: false, status: 'error', days: 0, message: errorText(error) };
  }
}

// Frazy marki ------------------------------------------------------------------------------------------------------------

/** Frazy marki liczone w Google: zapisane w ustawieniach marketingu marki albo domyślne (nazwa i adres strony marki). */
export async function brandTermsFor(companyId: string): Promise<{ terms: string[]; isDefault: boolean }> {
  const admin = createSupabaseAdminClient();
  const [settings, company] = await Promise.all([
    admin.from('marketing_company_settings').select('brand_terms').eq('company_id', companyId).maybeSingle(),
    admin.from('my_companies').select('name, website').eq('id', companyId).maybeSingle(),
  ]);
  const saved = Array.isArray((settings.data as { brand_terms?: unknown } | null)?.brand_terms)
    ? ((settings.data as { brand_terms: unknown[] }).brand_terms).map(String).filter(Boolean)
    : [];
  if (!settings.error && saved.length) return { terms: saved, isDefault: false };
  const row = (company.data || {}) as { name?: string | null; website?: string | null };
  return { terms: socialBrandDefaultTerms(row.name || '', row.website || ''), isDefault: true };
}

// Google — Search Console ---------------------------------------------------------------------------------------------------

async function searchAnalytics(accessToken: string, siteUrl: string, body: Record<string, unknown>) {
  const rows: Array<{ keys?: string[]; clicks?: number; impressions?: number }> = [];
  for (let page = 0; page < 8; page += 1) {
    const data = await readJsonResponse(
      await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, rowLimit: SEARCH_CONSOLE_PAGE, startRow: page * SEARCH_CONSOLE_PAGE }),
        cache: 'no-store',
      }),
      'Google Search Console',
    );
    const batch = Array.isArray(data?.rows) ? data.rows : [];
    rows.push(...batch);
    if (batch.length < SEARCH_CONSOLE_PAGE) break;
  }
  return rows;
}

/** Frazy z nazwą marki z Search Console (90 dni) → dni i frazy. Nie rzuca błędów Google. */
export async function syncBrandSearch(options: { companyId: string; accessToken: string; siteUrl: string }): Promise<BrandSyncResult> {
  const { companyId, accessToken } = options;
  const siteUrl = options.siteUrl.trim();
  if (!siteUrl) {
    return finish(companyId, 'google', 'unavailable', 'Wybierz witrynę Search Console w ustawieniach marketingu marki.');
  }
  try {
    const { terms } = await brandTermsFor(companyId);
    const expression = socialBrandTermsRegex(terms);
    if (!expression) {
      return finish(companyId, 'google', 'unavailable', 'Brak fraz marki — wpisz je w „Frazy marki” w statystykach social media.');
    }
    const to = brandWarsawDate();
    const from = brandAddDays(to, -(BRAND_INTEREST_DAYS - 1));
    const base = { startDate: from, endDate: to, type: 'web', dataState: 'all' };

    // Dni, za które Google ma już dane strony (bez filtra) — dni bez fraz marki w tym okresie to 0, późniejsze — brak danych.
    const siteDays = (await searchAnalytics(accessToken, siteUrl, { ...base, dimensions: ['date'] }))
      .map((row) => String(row.keys?.[0] || '')).filter((date) => DATE.test(date)).sort();
    if (!siteDays.length) {
      return finish(companyId, 'google', 'ok', 'Google nie ma jeszcze danych tej witryny z ostatnich 90 dni.', { days: [], queries: [], replaceFrom: from, replaceTo: to });
    }
    const firstDay = siteDays[0];
    const lastDay = siteDays[siteDays.length - 1];

    const rows = await searchAnalytics(accessToken, siteUrl, {
      ...base,
      dimensions: ['date', 'query'],
      dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'query', operator: 'includingRegex', expression }] }],
    });

    const totals = new Map<string, { views: number; clicks: number }>();
    const perDay = new Map<string, BrandQuery[]>();
    for (const row of rows) {
      const date = String(row.keys?.[0] || '');
      const query = String(row.keys?.[1] || '').trim().slice(0, 300);
      if (!DATE.test(date) || !query || date < firstDay || date > lastDay) continue;
      const impressions = count(row.impressions);
      const clicks = count(row.clicks);
      const total = totals.get(date) || { views: 0, clicks: 0 };
      total.views += impressions;
      total.clicks += clicks;
      totals.set(date, total);
      perDay.set(date, [...(perDay.get(date) || []), { date, query, impressions, clicks }]);
    }

    const days: BrandDay[] = [];
    for (let date = firstDay; date <= lastDay; date = brandAddDays(date, 1)) {
      const total = totals.get(date);
      days.push({ date, views: total?.views || 0, clicks: total?.clicks || 0 });
    }
    const queries = Array.from(perDay.values()).flatMap((items) => items
      .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || a.query.localeCompare(b.query, 'pl'))
      .slice(0, QUERIES_PER_DAY));
    return finish(companyId, 'google', 'ok', null, { days, queries, replaceFrom: from, replaceTo: to });
  } catch (error) {
    return finish(companyId, 'google', 'error', errorText(error));
  }
}

// Meta — Facebook i Instagram ------------------------------------------------------------------------------------------------

const unknownMetric = (error: unknown) =>
  error instanceof MetaGraphError && error.code === 100 && /metric/i.test(error.message);
const noPermission = (error: unknown) =>
  error instanceof MetaGraphError && (error.code === 10 || (error.code !== null && error.code >= 200 && error.code <= 299));

async function syncFacebookPageViews(companyId: string, pageId: string, token: string): Promise<BrandSyncResult> {
  const to = brandWarsawDate();
  const from = brandAddDays(to, -(BRAND_INTEREST_DAYS - 1));
  try {
    const payload = await metaGraph<{ data?: Array<{ name?: string; values?: Array<{ value?: unknown; end_time?: string }> }> }>(
      `${pageId}/insights`,
      {
        token,
        label: 'Wyświetlenia strony Facebook',
        params: { metric: 'page_views_total', period: 'day', since: from, until: brandAddDays(to, 1) },
        timeoutMs: 20_000,
      },
    );
    const byDate = new Map<string, number>();
    for (const item of payload.data || []) {
      if (item.name && item.name !== 'page_views_total') continue;
      for (const value of item.values || []) {
        const end = String(value.end_time || '').slice(0, 10);
        if (!DATE.test(end)) continue;
        // `end_time` to koniec doby Meta (północ czasu pacyficznego) — wartość dotyczy dnia poprzedniego.
        const date = brandAddDays(end, -1);
        if (date < from || date > to) continue;
        byDate.set(date, count(value.value));
      }
    }
    const days = Array.from(byDate, ([date, views]) => ({ date, views })).sort((a, b) => a.date.localeCompare(b.date));
    return finish(companyId, 'facebook', 'ok', null, { days, replaceFrom: from, replaceTo: to });
  } catch (error) {
    if (unknownMetric(error)) {
      return finish(companyId, 'facebook', 'unavailable', 'Meta nie podaje wyświetleń strony Facebook w tej wersji API.');
    }
    return finish(companyId, 'facebook', noPermission(error) ? 'unavailable' : 'error', errorText(error));
  }
}

async function syncInstagramProfileViews(companyId: string, instagramId: string, token: string): Promise<BrandSyncResult> {
  const admin = createSupabaseAdminClient();
  const to = brandWarsawDate();
  const from = brandAddDays(to, -(BRAND_INTEREST_DAYS - 1));
  const { data: existing, error } = await admin.from('marketing_brand_interest_daily')
    .select('metric_date').eq('company_id', companyId).eq('channel', 'instagram').gte('metric_date', from).limit(400);
  if (error) return finish(companyId, 'instagram', 'error', `Odczyt zapisanych dni: ${error.message}`);
  const known = new Set((existing || []).map((row: { metric_date: string }) => String(row.metric_date)));

  const dates: string[] = [];
  for (let offset = 0; offset < INSTAGRAM_RECENT_DAYS; offset += 1) dates.push(brandAddDays(to, -offset));
  for (let date = brandAddDays(to, -INSTAGRAM_RECENT_DAYS); date >= from && dates.length < INSTAGRAM_RECENT_DAYS + INSTAGRAM_BACKFILL_PER_SYNC; date = brandAddDays(date, -1)) {
    if (!known.has(date)) dates.push(date);
  }

  const days: BrandDay[] = [];
  for (const date of dates) {
    try {
      const payload = await metaGraph<{ data?: Array<{ name?: string; total_value?: { value?: unknown } }> }>(`${instagramId}/insights`, {
        token,
        label: 'Wejścia na profil Instagram',
        params: {
          metric: 'profile_views',
          metric_type: 'total_value',
          period: 'day',
          since: warsawMidnightSeconds(date),
          until: warsawMidnightSeconds(brandAddDays(date, 1)),
        },
        timeoutMs: 20_000,
      });
      const item = (payload.data || []).find((entry) => !entry.name || entry.name === 'profile_views');
      days.push({ date, views: count(item?.total_value?.value) });
    } catch (cause) {
      if (unknownMetric(cause)) {
        return finish(companyId, 'instagram', 'unavailable',
          'Meta nie podaje już wejść na profil całego konta Instagram — liczymy wejścia na profil z postów opublikowanych z CRM.');
      }
      const status: BrandStatus = noPermission(cause) ? 'unavailable' : 'error';
      // Dni pobrane przed błędem zostają zapisane.
      return finish(companyId, 'instagram', status, errorText(cause), { days });
    }
  }
  return finish(companyId, 'instagram', 'ok', null, { days });
}

/** Facebook i Instagram marki. Nie rzuca błędów Meta. */
export async function syncBrandProfiles(options: {
  companyId: string;
  pageId: string | null;
  pageToken: string | null;
  instagramId: string | null;
  facebook?: boolean;
  instagram?: boolean;
}): Promise<BrandSyncResult[]> {
  const { companyId, pageId, pageToken, instagramId } = options;
  const results: BrandSyncResult[] = [];
  if (options.facebook !== false) {
    results.push(pageId && pageToken
      ? await syncFacebookPageViews(companyId, pageId, pageToken)
      : await finish(companyId, 'facebook', 'unavailable', 'Wybierz stronę Facebook w ustawieniach marketingu marki.'));
  }
  if (options.instagram !== false) {
    results.push(instagramId && pageToken
      ? await syncInstagramProfileViews(companyId, instagramId, pageToken)
      : await finish(companyId, 'instagram', 'unavailable',
        'Strona Facebook marki nie ma połączonego konta Instagram firmowego — połącz je i kliknij „Odśwież dostęp” przy Meta.'));
  }
  return results;
}
