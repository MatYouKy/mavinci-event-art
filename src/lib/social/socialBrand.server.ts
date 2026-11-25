import 'server-only';
import type { NativeContext } from '@/lib/native/auth';
import { brandAddDays, brandTermsFor } from '@/lib/marketing/brandInterest.server';
import { syncCompanyBrandInterest } from '@/lib/marketing/sync.server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { check, fail, isObject, requireAccess, text, uuidOrNull, type Row } from './socialCommon.server';
import {
  SOCIAL_BRAND_CHANNELS, socialBrandSum, socialBrandTermsFromText,
  type SocialBrandChannel, type SocialBrandChannelState, type SocialBrandDay, type SocialBrandInterest, type SocialBrandQuery,
  type SocialBrandStatus, type SocialBrandValues,
} from './socialShared';

/*
 * Social media → Statystyki → „Zainteresowanie marką” (migracja 20261130130000_brand_interest.sql): wyszukiwania nazwy
 * w Google, wejścia na stronę Facebook i na profil Instagram marki — dzień po dniu, okres wobec poprzedniego, frazy z Google
 * i stan kanałów. Odczyt z uprawnieniami osoby (RLS: dostęp do social media albo marketingu marki); pobieranie z Google
 * i Meta — `src/lib/marketing/brandInterest.server.ts`. Te same dane dla web, Maca i telefonu (`op=stats`, pole `brand`).
 */

const REFRESH_MIN_AGE_MS = 5 * 60_000;

type BrandRange = { from: string; to: string; previousFrom: string; previousTo: string };

const empty = (): SocialBrandValues => ({ google: null, googleClicks: null, facebook: null, instagram: null });

const missingTable = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error && (error.code === '42P01' || error.code === '42883' || error.code === 'PGRST202' || error.code === 'PGRST205'
    || /does not exist|could not find/i.test(error.message || '')));

const NOT_CONNECTED: Record<SocialBrandChannel, string> = {
  google: 'Połącz Google i wybierz witrynę Search Console w ustawieniach marketingu marki.',
  facebook: 'Połącz Meta i wybierz stronę Facebook w ustawieniach marketingu marki.',
  instagram: 'Połącz konto Instagram firmowe ze stroną Facebook marki i kliknij „Odśwież dostęp” przy Meta.',
};
const WAITING = 'Dane pojawią się po najbliższym pobraniu (co 6 godzin) albo po „Odśwież”.';

/** Połączenia kanałów marki (bez tokenów). */
async function connections(companyId: string): Promise<Record<SocialBrandChannel, boolean>> {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('marketing_integrations')
    .select('provider, status, settings, credentials_encrypted').eq('company_id', companyId).in('provider', ['google', 'meta']);
  const rows = (data || []) as Row[];
  const ready = (provider: string) => rows.find((row) => row.provider === provider && row.credentials_encrypted && row.status !== 'not_connected');
  const google = ready('google');
  const meta = ready('meta');
  const settings = (row: Row | undefined): Row => (isObject(row?.settings) ? row!.settings : {});
  return {
    google: Boolean(google && text(settings(google).search_console_site_url).trim()),
    facebook: Boolean(meta && text(settings(meta).page_id).trim()),
    instagram: Boolean(meta && text(settings(meta).page_id).trim() && text(settings(meta).instagram_account_id).trim()),
  };
}

/** Sekcja „Zainteresowanie marką” w `op=stats`; `null` — przed migracją bazy (sekcja ukryta). */
export async function brandInterestFor(ctx: NativeContext, companyId: string, range: BrandRange, canRefresh: boolean): Promise<SocialBrandInterest | null> {
  const [dailyResult, statesResult, queriesResult, postsResult, canEditResult, terms, connected] = await Promise.all([
    ctx.supabase.from('marketing_brand_interest_daily').select('channel, metric_date, views, clicks')
      .eq('company_id', companyId).gte('metric_date', range.previousFrom).lte('metric_date', range.to)
      .order('metric_date').limit(2000),
    ctx.supabase.from('marketing_brand_interest_sync').select('channel, status, message, checked_at, synced_at').eq('company_id', companyId),
    ctx.supabase.rpc('marketing_brand_queries_top', { p_company: companyId, p_from: range.from, p_to: range.to, p_limit: 10 }),
    ctx.supabase.rpc('social_profile_visits_timeline', { p_company: companyId, p_from: range.previousFrom, p_to: range.to }),
    ctx.supabase.rpc('marketing_brand_terms_can_edit', { p_company: companyId }),
    brandTermsFor(companyId),
    connections(companyId),
  ]);
  if (missingTable(dailyResult.error) || missingTable(statesResult.error)) return null;
  check(dailyResult.error || statesResult.error, 'Nie udało się pobrać zainteresowania marką.');
  if (queriesResult.error) console.warn('[social-brand] frazy', queriesResult.error.message);
  if (postsResult.error) console.warn('[social-brand] instagram z postów', postsResult.error.message);

  const values = new Map<string, Row>();
  const accountDays = new Set<string>();
  for (const row of (dailyResult.data || []) as Row[]) {
    const date = text(row.metric_date);
    values.set(`${text(row.channel)}:${date}`, row);
    if (row.channel === 'instagram') accountDays.add(date);
  }
  const postVisits = new Map<string, number>();
  for (const row of (postsResult.data || []) as Row[]) postVisits.set(text(row.metric_date), Number(row.profile_visits) || 0);

  const states = new Map<string, Row>();
  for (const row of (statesResult.data || []) as Row[]) states.set(text(row.channel), row);

  const channels = Object.fromEntries(SOCIAL_BRAND_CHANNELS.map((channel): [SocialBrandChannel, SocialBrandChannelState] => {
    const state = states.get(channel);
    if (!connected[channel]) return [channel, { status: 'not_connected', message: NOT_CONNECTED[channel], syncedAt: null, checkedAt: null }];
    if (!state) return [channel, { status: 'pending', message: WAITING, syncedAt: null, checkedAt: null }];
    return [channel, {
      status: text(state.status) as SocialBrandStatus,
      message: text(state.message) || null,
      syncedAt: text(state.synced_at) || null,
      checkedAt: text(state.checked_at) || null,
    }];
  })) as Record<SocialBrandChannel, SocialBrandChannelState>;

  // Instagram: wejścia na profil konta, a gdy Meta ich nie podaje — wejścia z postów opublikowanych z CRM.
  const instagramSource: SocialBrandInterest['instagramSource'] = !connected.instagram ? null
    : accountDays.size > 0 ? 'account'
      : channels.instagram.status === 'unavailable' && !postsResult.error ? 'posts' : null;

  const dayValues = (date: string): SocialBrandDay => {
    const google = values.get(`google:${date}`);
    const facebook = values.get(`facebook:${date}`);
    const instagram = values.get(`instagram:${date}`);
    return {
      date,
      google: google ? Number(google.views) || 0 : null,
      googleClicks: google ? Number(google.clicks) || 0 : null,
      facebook: facebook ? Number(facebook.views) || 0 : null,
      instagram: instagramSource === 'account' ? (instagram ? Number(instagram.views) || 0 : null)
        : instagramSource === 'posts' ? postVisits.get(date) || 0 : null,
    };
  };
  const span = (from: string, to: string) => {
    const days: SocialBrandDay[] = [];
    for (let date = from; date <= to; date = brandAddDays(date, 1)) days.push(dayValues(date));
    return days;
  };
  const totalsOf = (days: SocialBrandDay[]): SocialBrandValues => ({
    google: socialBrandSum(days, 'google'),
    googleClicks: socialBrandSum(days, 'googleClicks'),
    facebook: socialBrandSum(days, 'facebook'),
    instagram: socialBrandSum(days, 'instagram'),
  });
  const days = span(range.from, range.to);
  const previousDays = span(range.previousFrom, range.previousTo);

  const queries: SocialBrandQuery[] = ((queriesResult.data || []) as Row[]).map((row) => ({
    query: text(row.query), searches: Number(row.impressions) || 0, clicks: Number(row.clicks) || 0,
  })).filter((row) => row.query);

  return {
    terms: terms.terms,
    defaultTerms: terms.isDefault,
    canEditTerms: canEditResult.data === true,
    canRefresh,
    range,
    totals: days.length ? totalsOf(days) : empty(),
    previous: previousDays.length ? totalsOf(previousDays) : empty(),
    days,
    queries,
    channels,
    instagramSource,
  };
}

/** Zakres dat sekcji: od dnia początku okresu statystyk do dziś i tyle samo dni wcześniej (strefa Warszawa). */
export function brandRange(from: string, to: string): BrandRange {
  const length = Math.max(1, Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1);
  return { from, to, previousFrom: brandAddDays(from, -length), previousTo: brandAddDays(from, -1) };
}

/** „Odśwież” w sekcji: Google i Meta marki (kanały pobrane ponad 5 minut temu) — dostęp „view” social media marki. */
export async function refreshBrandInterest(ctx: NativeContext, body: Row) {
  const companyId = uuidOrNull(body.companyId);
  if (!companyId) fail('Wybierz markę.');
  await requireAccess(ctx, companyId, 'view');
  await syncCompanyBrandInterest(companyId, { minAgeMs: REFRESH_MIN_AGE_MS });
  return companyId;
}

/** „Frazy marki”: zapis (zarządzający marketingiem albo akceptujący social media marki) i pobranie Google od nowa. */
export async function saveBrandTerms(ctx: NativeContext, body: Row) {
  const companyId = uuidOrNull(body.companyId);
  if (!companyId) fail('Wybierz markę.');
  const source = Array.isArray(body.terms) ? (body.terms as unknown[]).map(text).join('\n') : text(body.terms);
  const parsed = socialBrandTermsFromText(source);
  if (parsed.error) fail(parsed.error);
  const { error } = await ctx.supabase.rpc('marketing_brand_terms_save', { p_company: companyId, p_terms: parsed.terms });
  check(error, 'Nie udało się zapisać fraz marki.');
  try {
    await syncCompanyBrandInterest(companyId, { channels: ['google'] });
  } catch (cause) {
    console.warn('[social-brand] google po zmianie fraz', cause instanceof Error ? cause.message : cause);
  }
  return companyId;
}
