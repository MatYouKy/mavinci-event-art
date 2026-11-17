import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { NativeContext } from './auth';
import { allRows } from './page';
import { placeSearch } from './eventClientLocation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { getMarketingOverview } from '@/lib/marketing/data.server';
import { syncMarketingIntegration, updateExternalCampaignStatus } from '@/lib/marketing/sync.server';
import { generateMarketingInsight } from '@/lib/marketing/insight.server';

/*
 * Strona na Macu (`/crm/page?tab=website`): struktura strony z odwiedzinami, analiza ruchu (`/crm/page/analytics` —
 * wizyty, unikalne sesje, czas, formularze, źródła, urządzenia, miasta, podstrony, „Online teraz”, reset statystyk
 * z potwierdzeniem hasłem), dane strukturalne Schema.org (`/crm/page/schema-org` — dane globalne, obszary obsługi,
 * miasta do sugestii, wyjątki odmiany) oraz „Marketing i ADS” (`MarketingWorkspace` — przegląd, kampanie, wiadomości,
 * analiza AI). Tokenem pracownika (RLS) — marketing jak `/bridge/marketing/*` (uprawnienia i marki pracownika).
 */

type Row = Record<string, any>;
const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const text = (value: unknown) => (typeof value === 'string' ? value : value == null ? '' : String(value));
const clip = (value: unknown, max: number) => text(value).trim().slice(0, max);
const orNull = (value: string) => (value ? value : null);

function fail(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status });
}
function check(error: { message?: string; code?: string } | null | undefined, message: string) {
  if (!error) return;
  if (error.code === '42501') fail('Brak uprawnień do tej operacji.', 403);
  fail(message);
}

// MARK: Dostęp

const MARKETING_VIEW = ['marketing_campaigns_view', 'marketing_campaigns_manage', 'marketing_campaigns_approve'];

/** Dostęp do sekcji (uprawnienia jak w CRM i regułach bazy: edycja strony WWW — `website_edit`). */
export function websiteAccess(ctx: NativeContext) {
  const permissions = ctx.employee.permissions;
  return {
    canEdit: permissions.includes('website_edit'),
    canReset: permissions.includes('admin') || permissions.includes('website_edit'),
    canViewMarketing: ctx.employee.isAdmin || MARKETING_VIEW.some((p) => permissions.includes(p)),
    canManageMarketing: ctx.employee.isAdmin || permissions.includes('marketing_campaigns_manage'),
  };
}
function requireEdit(ctx: NativeContext) {
  if (!websiteAccess(ctx).canEdit) fail('Edycja danych strony wymaga uprawnienia do edycji strony WWW.', 403);
}

// MARK: Czas polski

const WARSAW = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Warsaw', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function offsetAt(ms: number) {
  const p = Object.fromEntries(WARSAW.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
function warsawMidnight(day: string) {
  const t0 = Date.parse(`${day}T00:00:00Z`);
  return new Date(t0 - offsetAt(t0 - offsetAt(t0))).toISOString();
}
const shiftDay = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' });
const warsawDay = (value: unknown) => {
  const date = new Date(text(value));
  return Number.isNaN(date.getTime()) ? '' : DAY.format(date);
};
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Okres raportu jak `getDateBounds`: ostatnie N dni od północy (czas polski) albo własny zakres dni. */
function bounds(range: number, from?: string, to?: string) {
  if (from && to) {
    if (!isDay(from) || !isDay(to) || to < from) fail('Nieprawidłowy zakres dat.');
    return { start: warsawMidnight(from), end: new Date(Date.parse(warsawMidnight(shiftDay(to, 1))) - 1).toISOString() };
  }
  const days = Math.min(3650, Math.max(1, Math.round(range) || 30));
  const today = warsawDay(new Date().toISOString());
  return { start: warsawMidnight(shiftDay(today, -(days - 1))), end: new Date().toISOString() };
}

// MARK: Struktura strony i analiza ruchu

const normalizePageUrl = (value?: string | null) => {
  if (!value) return '/';
  let normalized = value.trim();
  try {
    if (/^https?:\/\//i.test(normalized)) normalized = new URL(normalized).pathname;
  } catch {
    // historyczny wpis bez poprawnego adresu
  }
  normalized = normalized.split('?')[0].split('#')[0];
  if (!normalized || normalized === '/') return '/';
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withSlash.replace(/\/+$/, '') || '/';
};
const isMessageFromPage = (source: string | null, pageUrl: string) => {
  const a = normalizePageUrl(source).toLocaleLowerCase('pl-PL');
  const b = normalizePageUrl(pageUrl).toLocaleLowerCase('pl-PL');
  if (a === b) return true;
  if (b === '/') return false;
  return a.split('/').filter(Boolean).at(-1) === b.split('/').filter(Boolean).at(-1);
};

/** Odwiedziny podstron z ostatnich `days` dni (`getAllPages`) — wszystkie wpisy, stronami. */
export async function websitePages(ctx: NativeContext, days: number) {
  const since = new Date(Date.now() - Math.min(3650, Math.max(1, days || 30)) * 86_400_000).toISOString();
  const rows = await allRows<Row>((c) => c.from('page_analytics').select('page_url,page_title').gte('created_at', since).order('created_at').order('id'), ctx.supabase, 200_000);
  const stats = new Map<string, { title: string; visits: number }>();
  for (const row of rows) {
    const url = text(row.page_url);
    const entry = stats.get(url) ?? { title: text(row.page_title) || url, visits: 0 };
    entry.visits += 1;
    stats.set(url, entry);
  }
  return {
    access: websiteAccess(ctx),
    pages: [...stats.entries()].map(([url, value]) => ({ url, title: value.title, visits: value.visits })).sort((a, b) => b.visits - a.visits),
  };
}

/** Zgłoszenia z formularzy bez danych osobowych (`get_contact_form_analytics`; bez funkcji — odczyt tabel jak w CRM). */
async function contactFormCounts(ctx: NativeContext, start: string, end: string) {
  const { data, error } = await ctx.supabase.rpc('get_contact_form_analytics', { p_from: start, p_to: end });
  if (!error && data && typeof data === 'object') {
    const result = data as Row;
    return { messages: Array.isArray(result.messages) ? result.messages as Row[] : [], structured: Array.isArray(result.structured) ? result.structured as Row[] : [] };
  }
  if (error && error.code !== 'PGRST202' && error.code !== '42883') {
    if (error.code === '42501') return { messages: [], structured: [] };
    fail('Nie udało się pobrać zgłoszeń z formularzy.');
  }
  const [messages, structured] = await Promise.all([
    ctx.supabase.from('contact_messages').select('source_page, category, created_at').gte('created_at', start).lte('created_at', end),
    ctx.supabase.from('contact_form_submissions').select('source_page, city_interest').gte('created_at', start).lte('created_at', end),
  ]);
  check(messages.error, 'Nie udało się pobrać zgłoszeń z formularzy.');
  return { messages: (messages.data ?? []) as Row[], structured: structured.error ? [] : (structured.data ?? []) as Row[] };
}

export async function onlineUsers(ctx: NativeContext) {
  await ctx.supabase.rpc('cleanup_stale_sessions');
  const { count, error } = await ctx.supabase.from('active_sessions').select('*', { count: 'exact', head: true }).not('page_url', 'like', '%/crm%');
  check(error, 'Nie udało się pobrać liczby osób online.');
  return { online: count || 0 };
}

/** Analiza ruchu (`getAnalyticsStats`) — wszystkie wizyty z okresu (stronami), dni w czasie polskim. */
export async function websiteAnalytics(ctx: NativeContext, range: number, from: string | null, to: string | null, page: string | null) {
  const { start, end } = bounds(range, from || undefined, to || undefined);
  const pageUrl = page ? normalizePageUrl(page) : null;
  const [visits, forms, online] = await Promise.all([
    allRows<Row>((c) => {
      let q = c.from('page_analytics').select('page_url,referrer,session_id,device_type,time_on_page,created_at')
        .gte('created_at', start).lte('created_at', end).order('created_at').order('id');
      if (pageUrl) q = q.eq('page_url', pageUrl);
      return q;
    }, ctx.supabase, 200_000),
    contactFormCounts(ctx, start, end),
    onlineUsers(ctx).catch(() => ({ online: 0 })),
  ]);
  const timed = visits.filter((v) => Number(v.time_on_page) > 0);
  const pages = new Map<string, { visits: number; sessions: Set<string>; time: number; timed: number }>();
  const sources = new Map<string, number>();
  const devices = new Map<string, number>();
  const daily = new Map<string, number>();
  for (const v of visits) {
    const url = text(v.page_url);
    const stat = pages.get(url) ?? { visits: 0, sessions: new Set<string>(), time: 0, timed: 0 };
    stat.visits += 1;
    stat.sessions.add(text(v.session_id));
    if (Number(v.time_on_page) > 0) { stat.time += Number(v.time_on_page); stat.timed += 1; }
    pages.set(url, stat);
    const referrer = text(v.referrer);
    const source = referrer.includes('google') ? 'Google' : referrer.includes('facebook') ? 'Facebook'
      : referrer.includes('linkedin') ? 'LinkedIn' : referrer ? 'Other' : 'Direct';
    sources.set(source, (sources.get(source) ?? 0) + 1);
    const device = text(v.device_type) || 'unknown';
    devices.set(device, (devices.get(device) ?? 0) + 1);
    const day = warsawDay(v.created_at);
    daily.set(day, (daily.get(day) ?? 0) + 1);
  }
  const relevantForms = forms.messages.filter((m) => !pageUrl || isMessageFromPage(text(m.source_page), pageUrl));
  const cities = new Map<string, number>();
  for (const form of forms.structured) {
    if (pageUrl && !isMessageFromPage(text(form.source_page), pageUrl)) continue;
    const city = text(form.city_interest);
    if (city) cities.set(city, (cities.get(city) ?? 0) + 1);
  }
  return {
    access: websiteAccess(ctx),
    online: online.online,
    totalVisits: visits.length,
    uniqueVisitors: new Set(visits.map((v) => text(v.session_id))).size,
    avgTimeOnPage: timed.length ? Math.round(timed.reduce((sum, v) => sum + Number(v.time_on_page), 0) / timed.length) : 0,
    contactForms: relevantForms.length,
    topPages: [...pages.entries()].map(([url, s]) => ({
      url, visits: s.visits, uniqueVisitors: s.sessions.size, avgTime: s.timed ? Math.round(s.time / s.timed) : 0,
    })).sort((a, b) => b.visits - a.visits).slice(0, 10),
    trafficSources: [...sources.entries()].map(([source, count]) => ({ source, visits: count })).sort((a, b) => b.visits - a.visits),
    devices: [...devices.entries()].map(([device, count]) => ({
      device, visits: count, percentage: visits.length ? Math.round((count / visits.length) * 100) : 0,
    })).sort((a, b) => b.visits - a.visits),
    topCities: [...cities.entries()].map(([city, count]) => ({ city, submissions: count })).sort((a, b) => b.submissions - a.submissions).slice(0, 5),
    dailyVisits: [...daily.entries()].map(([date, count]) => ({ date, visits: count })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * „Resetuj statystyki” jak `ResetAnalyticsModal`: hasło zalogowanego konta sprawdzone osobnym, nietrwałym klientem (sesja
 * weryfikacji od razu unieważniana), potem `reset_analytics_data` tokenem pracownika. Hasła nie zapisujemy ani nie logujemy.
 */
export async function resetAnalytics(ctx: NativeContext, body: Row) {
  const password = typeof body.password === 'string' ? body.password : '';
  body.password = '';
  if (!password || password.length > 1024) fail('Wpisz hasło aby kontynuować');
  if (!websiteAccess(ctx).canReset) fail('Brak uprawnień do resetowania statystyk', 403);
  const admin = createSupabaseAdminClient();
  // Adres e-mail wyłącznie z konta zweryfikowanego tokenem — nigdy z treści żądania.
  const { data: account, error: accountError } = await admin.auth.admin.getUserById(ctx.employee.authUserId);
  const email = account?.user?.email;
  if (accountError || !email) fail('Sesja wygasła. Zaloguj się ponownie.', 401);
  const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: passwordError } = await verifier.auth.signInWithPassword({ email, password });
  try {
    if (passwordError || !verified.session || verified.user?.id !== ctx.employee.authUserId) {
      if (passwordError?.status === 429) fail('Zbyt wiele prób weryfikacji hasła. Odczekaj i spróbuj ponownie.');
      fail('Nieprawidłowe hasło. Spróbuj ponownie.');
    }
    const { error } = await ctx.supabase.rpc('reset_analytics_data');
    if (error) fail(error.message || 'Błąd podczas resetowania statystyk');
    return { ok: true, message: 'Statystyki zostały zresetowane pomyślnie' };
  } finally {
    if (verified.session?.access_token) {
      await admin.auth.admin.signOut(verified.session.access_token, 'local').catch(() => undefined);
    }
  }
}

// MARK: Schema.org

const GLOBAL_TEXT: Record<string, number> = {
  organization_name: 300, organization_url: 500, organization_logo: 1000, telephone: 50, email: 300, facebook_url: 500,
  instagram_url: 500, linkedin_url: 500, youtube_url: 500, twitter_url: 500, street_address: 300, locality: 200,
  postal_code: 20, region: 200, default_image: 1000,
};
const placeItem = (row: Row) => ({
  id: String(row.id), name: text(row.name), locality: text(row.locality), postalCode: text(row.postal_code), region: text(row.region),
  order: Number(row.display_order) || 0,
});

export async function schemaOrg(ctx: NativeContext) {
  const [globalRes, placesRes] = await Promise.all([
    ctx.supabase.from('schema_org_global').select('*').limit(1).maybeSingle(),
    ctx.supabase.from('schema_org_places').select('*').eq('is_global', true).eq('is_active', true).order('display_order'),
  ]);
  check(globalRes.error, 'Nie udało się pobrać danych Schema.org.');
  check(placesRes.error, 'Nie udało się pobrać obszarów obsługi.');
  const global = globalRes.data as Row | null;
  return {
    access: websiteAccess(ctx),
    global: global ? Object.fromEntries([['id', String(global.id)], ['country', text(global.country)],
      ...Object.keys(GLOBAL_TEXT).map((key) => [key, text(global[key])])]) : null,
    places: ((placesRes.data ?? []) as Row[]).map(placeItem),
  };
}

export async function saveSchemaGlobal(ctx: NativeContext, body: Row) {
  requireEdit(ctx);
  const id = text(body.id);
  if (!UUID.test(id)) fail('Nieprawidłowa konfiguracja.');
  const values = body.values && typeof body.values === 'object' ? body.values as Row : {};
  const patch: Row = { updated_at: new Date().toISOString() };
  for (const [key, max] of Object.entries(GLOBAL_TEXT)) {
    if (key in values) patch[key] = key === 'organization_name' || key === 'organization_url' ? clip(values[key], max) : orNull(clip(values[key], max));
  }
  if ('organization_name' in patch && !patch.organization_name) fail('Podaj nazwę organizacji.');
  if ('organization_url' in patch && !patch.organization_url) fail('Podaj adres URL organizacji.');
  const { data, error } = await ctx.supabase.from('schema_org_global').update(patch).eq('id', id).select('id');
  check(error, 'Błąd podczas zapisywania');
  if (!data?.length) fail('Nie zapisano zmian — brak uprawnień do edycji strony WWW.', 403);
  return { ok: true, message: 'Dane zapisane!' };
}

/** Miasta z bazy sugestii (`polish_cities`) do obszarów obsługi — bez już dodanych. */
export async function searchCities(ctx: NativeContext, query: string) {
  const q = clip(query, 100).replace(/[%,()]/g, ' ').trim();
  if (q.length < 2) return { cities: [] };
  const normalized = q.toLowerCase().replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l').replace(/ń/g, 'n')
    .replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z');
  const [citiesRes, placesRes] = await Promise.all([
    ctx.supabase.from('polish_cities').select('id,name,slug,postal_code,region,population').or(`name.ilike.%${q}%,slug.ilike.%${normalized}%`)
      .order('population', { ascending: false }).limit(20),
    ctx.supabase.from('schema_org_places').select('locality').eq('is_global', true).eq('is_active', true),
  ]);
  check(citiesRes.error, 'Nie udało się wyszukać miast.');
  const added = new Set(((placesRes.data ?? []) as Row[]).map((p) => text(p.locality).toLowerCase()));
  return {
    cities: ((citiesRes.data ?? []) as Row[]).filter((c) => !added.has(text(c.slug).toLowerCase())).slice(0, 10).map((c) => ({
      id: String(c.id), name: text(c.name), slug: text(c.slug), postalCode: text(c.postal_code), region: text(c.region),
    })),
  };
}

export async function addPlace(ctx: NativeContext, body: Row) {
  requireEdit(ctx);
  const name = clip(body.name, 200), locality = clip(body.locality, 200).toLowerCase();
  if (!name || !locality) fail('Wypełnij wymagane pola');
  const { data: last } = await ctx.supabase.from('schema_org_places').select('display_order').eq('is_global', true)
    .order('display_order', { ascending: false }).limit(1).maybeSingle();
  const { error } = await ctx.supabase.from('schema_org_places').insert({
    name, locality, postal_code: orNull(clip(body.postalCode, 20)), region: orNull(clip(body.region, 200)), country: 'PL',
    display_order: last ? (Number((last as Row).display_order) || 0) + 1 : 0, is_active: true, is_global: true,
  });
  check(error, 'Błąd podczas dodawania miejsca');
  return { ok: true, message: 'Miejsce dodane do obszarów obsługi' };
}

export async function updatePlace(ctx: NativeContext, id: string, body: Row) {
  requireEdit(ctx);
  const name = clip(body.name, 200), locality = clip(body.locality, 200);
  if (!name || !locality) fail('Wypełnij wymagane pola');
  const { data, error } = await ctx.supabase.from('schema_org_places').update({
    name, locality, postal_code: orNull(clip(body.postalCode, 20)), region: orNull(clip(body.region, 200)),
  }).eq('id', id).select('id');
  check(error, 'Błąd podczas aktualizacji');
  if (!data?.length) fail('Nie zapisano zmian — brak uprawnień albo miejsce zostało usunięte.', 403);
  return { ok: true, message: 'Miejsce zaktualizowane' };
}

export async function deletePlace(ctx: NativeContext, id: string) {
  requireEdit(ctx);
  const { data, error } = await ctx.supabase.from('schema_org_places').delete().eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania');
  if (!data?.length) fail('Nie usunięto — brak uprawnień albo miejsce zostało już usunięte.', 403);
  return { ok: true, message: 'Miejsce usunięte' };
}

const VOIVODESHIPS: Record<string, string> = {
  'Lower Silesian Voivodeship': 'Województwo Dolnośląskie', 'Kuyavian-Pomeranian Voivodeship': 'Województwo Kujawsko-Pomorskie',
  'Lublin Voivodeship': 'Województwo Lubelskie', 'Lubusz Voivodeship': 'Województwo Lubuskie', 'Łódź Voivodeship': 'Województwo Łódzkie',
  'Lodz Voivodeship': 'Województwo Łódzkie', 'Lesser Poland Voivodeship': 'Województwo Małopolskie', 'Masovian Voivodeship': 'Województwo Mazowieckie',
  'Opole Voivodeship': 'Województwo Opolskie', 'Subcarpathian Voivodeship': 'Województwo Podkarpackie', 'Podlaskie Voivodeship': 'Województwo Podlaskie',
  'Pomeranian Voivodeship': 'Województwo Pomorskie', 'Silesian Voivodeship': 'Województwo Śląskie', 'Świętokrzyskie Voivodeship': 'Województwo Świętokrzyskie',
  'Swietokrzyskie Voivodeship': 'Województwo Świętokrzyskie', 'Warmian-Masurian Voivodeship': 'Województwo Warmińsko-Mazurskie',
  'Greater Poland Voivodeship': 'Województwo Wielkopolskie', 'West Pomeranian Voivodeship': 'Województwo Zachodniopomorskie',
};
const voivodeship = (region: string) => {
  if (!region) return '';
  if (VOIVODESHIPS[region]) return VOIVODESHIPS[region];
  // Odpowiedź po polsku: „województwo warmińsko-mazurskie” → „Województwo Warmińsko-Mazurskie”.
  if (/^województwo\s/i.test(region)) {
    return region.split(/(\s|-)/).map((part) => (/^[\s-]$/.test(part) ? part : part.charAt(0).toLocaleUpperCase('pl-PL') + part.slice(1))).join('');
  }
  return region;
};

export const citySearch = (ctx: NativeContext, params: URLSearchParams) => placeSearch(ctx, '', params);

/** Miasto z wyników Google (jak `AddPolishCityModal`): nazwa, kod pocztowy (pełny), województwo, punkt. */
export async function cityPlace(ctx: NativeContext, params: URLSearchParams) {
  const placeId = clip(params.get('placeId'), 300);
  if (!placeId) fail('Brak identyfikatora miejsca.');
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) fail('Brak klucza Google Maps w konfiguracji serwera.');
  const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('key', key);
  url.searchParams.set('language', 'pl');
  url.searchParams.set('fields', ['place_id', 'name', 'formatted_address', 'geometry/location', 'address_component'].join(','));
  const token = clip(params.get('sessiontoken'), 100);
  if (token) url.searchParams.set('sessiontoken', token);
  const response = await fetch(url.toString(), { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (data?.status !== 'OK' || !data.result) fail('Nie udało się pobrać szczegółów miejsca.');
  const place = data.result as Row;
  const components = (Array.isArray(place.address_components) ? place.address_components : []) as Row[];
  const component = (type: string) => text(components.find((c) => Array.isArray(c.types) && c.types.includes(type))?.long_name);
  const postal = component('postal_code');
  const city = component('locality') || component('postal_town') || text(place.name);
  return {
    name: city, postalCode: /^\d{2}-\d{3}$/.test(postal) ? postal : '', region: voivodeship(component('administrative_area_level_1')),
    formattedAddress: text(place.formatted_address), placeId,
  };
}

const slugify = (value: string) => value.toLowerCase().trim().replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e').replace(/ł/g, 'l')
  .replace(/ń/g, 'n').replace(/ó/g, 'o').replace(/ś/g, 's').replace(/[źż]/g, 'z').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

export async function addCity(ctx: NativeContext, body: Row) {
  requireEdit(ctx);
  const name = clip(body.name, 200);
  const slug = slugify(clip(body.slug, 200) || name);
  const region = clip(body.region, 200);
  if (!name) fail('Nazwa miasta jest wymagana');
  if (!slug) fail('Slug miasta jest wymagany');
  if (!region) fail('Region jest wymagany');
  const populationText = clip(body.population, 20);
  const population = populationText ? Number(populationText.replace(/\s/g, '')) : null;
  if (population !== null && (!Number.isInteger(population) || population < 0)) fail('Liczba ludności musi być liczbą całkowitą.');
  const { data: existing } = await ctx.supabase.from('polish_cities').select('id').eq('slug', slug).maybeSingle();
  if (existing) fail('Miasto z takim slugiem już istnieje');
  const { error } = await ctx.supabase.from('polish_cities').insert({ name, slug, postal_code: orNull(clip(body.postalCode, 20)), region, population });
  check(error, 'Błąd podczas dodawania miasta');
  return { ok: true, message: 'Miasto dodane do sugestii' };
}

const caseItem = (row: Row) => ({
  id: String(row.id), cityKey: text(row.city_key), nominative: text(row.nominative), genitive: text(row.genitive),
  locative: text(row.locative), preposition: row.locative_preposition === 'we' ? 'we' : 'w',
});

export async function cityCases(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('polish_city_cases').select('id, city_key, nominative, genitive, locative, locative_preposition')
    .eq('is_active', true).order('city_key');
  check(error, 'Nie udało się pobrać wyjątków odmiany.');
  return { cases: ((data ?? []) as Row[]).map(caseItem) };
}

function casePayload(body: Row) {
  const cityKey = clip(body.cityKey, 200).toLowerCase();
  if (!cityKey) fail('Podaj klucz miasta (np. łódź).');
  return {
    city_key: cityKey, nominative: clip(body.nominative, 200), genitive: clip(body.genitive, 200), locative: clip(body.locative, 200),
    locative_preposition: body.preposition === 'we' ? 'we' : 'w',
  };
}

export async function addCityCase(ctx: NativeContext, body: Row) {
  const { error } = await ctx.supabase.from('polish_city_cases').insert({ ...casePayload(body), is_active: true });
  check(error, 'Błąd podczas dodawania wyjątku odmiany miast');
  return { ok: true, message: 'Wyjątek odmiany miast dodany' };
}

export async function updateCityCase(ctx: NativeContext, id: string, body: Row) {
  const { data, error } = await ctx.supabase.from('polish_city_cases').update(casePayload(body)).eq('id', id).select('id');
  check(error, 'Błąd podczas zapisywania wyjątku odmiany miast');
  if (!data?.length) fail('Nie znaleziono wyjątku odmiany.', 404);
  return { ok: true, message: 'Wyjątek odmiany miast zapisany' };
}

/** Usunięcie wyjątku odmiany — jak w CRM wpis zostaje oznaczony jako nieaktywny. */
export async function deleteCityCase(ctx: NativeContext, id: string) {
  const { data, error } = await ctx.supabase.from('polish_city_cases').update({ is_active: false }).eq('id', id).select('id');
  check(error, 'Błąd podczas usuwania wyjątku odmiany miast');
  if (!data?.length) fail('Nie znaleziono wyjątku odmiany.', 404);
  return { ok: true, message: 'Wyjątek odmiany miast usunięty' };
}

// MARK: Marketing i ADS

/** Dostęp jak `getMarketingAccess` + marki pracownika (`my_company_ids`) i zapamiętana marka (`preferences.marketing`). */
async function marketingAccess(ctx: NativeContext, mode: 'view' | 'manage') {
  const access = websiteAccess(ctx);
  if (!(mode === 'manage' ? access.canManageMarketing : access.canViewMarketing)) {
    fail(mode === 'manage' ? 'Brak uprawnień do zarządzania marketingiem.' : 'Brak dostępu do marketingu.', 403);
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('employees').select('id, my_company_ids, preferences').eq('id', ctx.employee.id).maybeSingle();
  if (error || !data) fail('Nie udało się odczytać profilu pracownika.');
  const row = data as Row;
  return {
    admin,
    companyIds: (Array.isArray(row.my_company_ids) ? row.my_company_ids : []).map(String) as string[],
    preferences: (row.preferences && typeof row.preferences === 'object' ? row.preferences : {}) as Row,
  };
}
const canAccessCompany = (ctx: NativeContext, companyIds: string[], companyId: string) =>
  ctx.employee.isAdmin || companyIds.length === 0 || companyIds.includes(companyId);

export async function marketingOverview(ctx: NativeContext, companyId: string | null) {
  const access = await marketingAccess(ctx, 'view');
  if (companyId && !canAccessCompany(ctx, access.companyIds, companyId)) fail('Brak dostępu do wybranej marki.', 403);
  const preferred = companyId || text(access.preferences.marketing?.companyId) || null;
  const overview = await getMarketingOverview(access.companyIds, preferred);
  return { ...overview, canManage: websiteAccess(ctx).canManageMarketing };
}

export async function marketingSelectCompany(ctx: NativeContext, companyId: string) {
  const access = await marketingAccess(ctx, 'view');
  if (!canAccessCompany(ctx, access.companyIds, companyId)) fail('Nieprawidłowa lub niedostępna marka.');
  const preferences = { ...access.preferences, marketing: { ...(access.preferences.marketing || {}), companyId } };
  const { error } = await access.admin.from('employees').update({ preferences }).eq('id', ctx.employee.id);
  if (error) fail('Nie udało się zapisać wybranej marki.');
  return { ok: true };
}

export async function marketingSync(ctx: NativeContext, companyId: string) {
  const access = await marketingAccess(ctx, 'manage');
  if (!canAccessCompany(ctx, access.companyIds, companyId)) fail('Brak dostępu do wybranej marki.', 403);
  const { data: integrations, error } = await access.admin.from('marketing_integrations')
    .select('id, company_id, provider, settings, credentials_encrypted').not('credentials_encrypted', 'is', null).eq('company_id', companyId);
  if (error) fail('Nie udało się zsynchronizować danych.');
  const results = [];
  for (const integration of integrations ?? []) results.push(await syncMarketingIntegration(integration as any));
  const failed = results.filter((result) => !result.ok);
  if (failed.length) fail(failed[0].error || 'Część źródeł nie została zsynchronizowana.');
  return { ok: true, synced: results.length, message: 'Dane marketingowe zostały zsynchronizowane' };
}

/** Wstrzymanie albo uruchomienie kampanii u dostawcy (Google Ads / Meta) — jak `PATCH /bridge/marketing/sync`. */
export async function marketingCampaignStatus(ctx: NativeContext, companyId: string, campaignId: string, status: unknown) {
  const next = status === 'ACTIVE' ? 'ACTIVE' : status === 'PAUSED' ? 'PAUSED' : null;
  if (!next) fail('Nieprawidłowe dane kampanii.');
  const access = await marketingAccess(ctx, 'manage');
  if (!canAccessCompany(ctx, access.companyIds, companyId)) fail('Nieprawidłowe dane kampanii.');
  const { data: campaign, error } = await access.admin.from('marketing_campaigns').select('provider, external_campaign_id, integration_id')
    .eq('id', campaignId).eq('company_id', companyId).maybeSingle();
  if (error || !campaign) fail('Nie znaleziono kampanii.', 404);
  const { data: integration, error: integrationError } = await access.admin.from('marketing_integrations')
    .select('id, company_id, provider, settings, credentials_encrypted').eq('id', (campaign as Row).integration_id).maybeSingle();
  if (integrationError || !integration) fail('Nie znaleziono integracji kampanii.');
  await updateExternalCampaignStatus(integration as any, campaign as any, next);
  return { ok: true, status: next, message: next === 'PAUSED' ? 'Kampania została wstrzymana' : 'Kampania została uruchomiona' };
}

export async function marketingMessageRead(ctx: NativeContext, companyId: string, messageId: string) {
  const access = await marketingAccess(ctx, 'view');
  if (!canAccessCompany(ctx, access.companyIds, companyId)) fail('Nieprawidłowa wiadomość.');
  const { error } = await access.admin.from('marketing_messages').update({ is_read: true }).eq('id', messageId).eq('company_id', companyId);
  if (error) fail('Nie udało się zaktualizować wiadomości.');
  return { ok: true };
}

export async function marketingAnalysis(ctx: NativeContext, companyId: string) {
  const access = await marketingAccess(ctx, 'manage');
  if (!canAccessCompany(ctx, access.companyIds, companyId)) fail('Nieprawidłowa lub niedostępna marka.');
  const insight = await generateMarketingInsight(access.companyIds, companyId, ctx.employee.id);
  return { ok: true, insight, message: 'Nowa analiza AI jest gotowa' };
}
