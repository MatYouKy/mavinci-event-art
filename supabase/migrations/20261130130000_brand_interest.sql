-- Social media → Statystyki → „Zainteresowanie marką”: jak często ktoś szuka marki z nazwy i wchodzi na jej profile.
-- Wyłącznie liczby — Google i Meta nie podają, kto szukał ani kto odwiedził profil.
--
-- • `marketing_brand_interest_daily` — dzień × kanał: Google — ile razy strona marki pokazała się w wynikach na frazy
--   z nazwą (praktycznie liczba wyszukiwań nazwy) i ile było kliknięć (Search Console); Facebook — wyświetlenia strony
--   (`page_views_total`); Instagram — wejścia na profil konta (`profile_views`, gdy Meta je podaje).
-- • `marketing_brand_queries_daily` — frazy z nazwą marki wpisane w Google (dzień × fraza; Google podaje frazy zbiorczo,
--   bez osób; rzadkie frazy pomija).
-- • `marketing_brand_interest_sync` — stan pobrania kanału (ok, czeka, niedostępne, błąd) z komunikatem do widoku.
-- • `marketing_company_settings.brand_terms` — frazy marki liczone w Google (puste = z nazwy i adresu strony marki).
--   Zmienia je zarządzający marketingiem albo akceptujący social media marki (`marketing_brand_terms_save`).
-- • Odczyt: osoby z dostępem do social media albo marketingu marki (RLS). Zapis danych — wyłącznie serwer
--   (`marketing_brand_interest_save`, klucz serwisowy).
-- • `social_profile_visits_timeline` — dzienne przyrosty wejść na profil z postów Instagram opublikowanych z CRM (gdy Meta
--   nie podaje wejść na profil konta).
-- Plik idempotentny — można go wykonać ponownie.

begin;

-- 1. Frazy marki --------------------------------------------------------------------------------------------------------------

create or replace function public.marketing_brand_terms_valid(p_terms text[])
returns boolean
language sql
immutable
set search_path = pg_catalog, public
as $$
  select cardinality(coalesce(p_terms, '{}'::text[])) <= 10
    and not exists (
      select 1
      from unnest(coalesce(p_terms, '{}'::text[])) as t(term)
      where term is null
        or char_length(term) not between 2 and 60
        or term <> btrim(term)
        or term ~ '\s\s'
        or term !~ '^[a-z0-9à-öø-ÿąćęłńśźż][a-z0-9à-öø-ÿąćęłńśźż &.''+-]*$'
    )
    and (select count(distinct term) from unnest(coalesce(p_terms, '{}'::text[])) as t(term))
      = cardinality(coalesce(p_terms, '{}'::text[]));
$$;

alter table public.marketing_company_settings add column if not exists brand_terms text[] not null default '{}'::text[];
alter table public.marketing_company_settings drop constraint if exists marketing_company_settings_brand_terms_check;
alter table public.marketing_company_settings add constraint marketing_company_settings_brand_terms_check
  check (public.marketing_brand_terms_valid(brand_terms));

-- 2. Dane -----------------------------------------------------------------------------------------------------------------------

create table if not exists public.marketing_brand_interest_daily (
  company_id uuid not null references public.my_companies(id) on delete cascade,
  channel text not null,
  metric_date date not null,
  views bigint not null default 0,
  clicks bigint,
  synced_at timestamptz not null default now(),
  primary key (company_id, channel, metric_date),
  constraint marketing_brand_interest_daily_channel_check check (channel in ('google', 'facebook', 'instagram')),
  constraint marketing_brand_interest_daily_values_check check (views >= 0 and (clicks is null or clicks >= 0))
);

create table if not exists public.marketing_brand_queries_daily (
  company_id uuid not null references public.my_companies(id) on delete cascade,
  metric_date date not null,
  query text not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  primary key (company_id, metric_date, query),
  constraint marketing_brand_queries_daily_query_check check (char_length(query) between 1 and 300),
  constraint marketing_brand_queries_daily_values_check check (impressions >= 0 and clicks >= 0)
);

create table if not exists public.marketing_brand_interest_sync (
  company_id uuid not null references public.my_companies(id) on delete cascade,
  channel text not null,
  status text not null,
  message text,
  checked_at timestamptz not null default now(),
  synced_at timestamptz,
  primary key (company_id, channel),
  constraint marketing_brand_interest_sync_channel_check check (channel in ('google', 'facebook', 'instagram')),
  constraint marketing_brand_interest_sync_status_check check (status in ('ok', 'pending', 'unavailable', 'error')),
  constraint marketing_brand_interest_sync_message_check check (message is null or char_length(message) <= 500)
);

-- 3. Zapis z serwera (synchronizacja marketingu i „Odśwież” w statystykach) ------------------------------------------------
-- p_days: [{date, views, clicks}], p_queries (tylko Google): [{date, query, impressions, clicks}].
-- p_replace_from / p_replace_to: okres pobrany w całości — wcześniejsze wiersze kanału z tego okresu są usuwane.

create or replace function public.marketing_brand_interest_save(
  p_company uuid,
  p_channel text,
  p_status text,
  p_message text default null,
  p_days jsonb default null,
  p_queries jsonb default null,
  p_replace_from date default null,
  p_replace_to date default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_count integer := 0;
begin
  if p_company is null or not exists (select 1 from public.my_companies c where c.id = p_company) then
    raise exception 'Nie znaleziono marki.' using errcode = 'P0002';
  end if;
  if p_channel is null or p_channel not in ('google', 'facebook', 'instagram') then
    raise exception 'Nieznany kanał zainteresowania marką.' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('ok', 'pending', 'unavailable', 'error') then
    raise exception 'Nieznany stan pobrania.' using errcode = '22023';
  end if;

  if p_replace_from is not null then
    if p_replace_to is null or p_replace_to < p_replace_from or p_replace_to - p_replace_from > 400 then
      raise exception 'Nieprawidłowy okres danych.' using errcode = '22023';
    end if;
    delete from public.marketing_brand_interest_daily d
    where d.company_id = p_company and d.channel = p_channel and d.metric_date between p_replace_from and p_replace_to;
    if p_channel = 'google' then
      delete from public.marketing_brand_queries_daily q
      where q.company_id = p_company and q.metric_date between p_replace_from and p_replace_to;
    end if;
  end if;

  if jsonb_typeof(p_days) = 'array' then
    insert into public.marketing_brand_interest_daily as t (company_id, channel, metric_date, views, clicks, synced_at)
    select p_company, p_channel, (item->>'date')::date,
      max(greatest(coalesce((item->>'views')::bigint, 0), 0)),
      case when p_channel = 'google' then max(greatest(coalesce((item->>'clicks')::bigint, 0), 0)) end,
      now()
    from jsonb_array_elements(p_days) as item
    where jsonb_typeof(item) = 'object' and coalesce(item->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
    group by (item->>'date')::date
    on conflict (company_id, channel, metric_date) do update
      set views = excluded.views, clicks = excluded.clicks, synced_at = excluded.synced_at;
    get diagnostics v_count = row_count;
  end if;

  if p_channel = 'google' and jsonb_typeof(p_queries) = 'array' then
    insert into public.marketing_brand_queries_daily as t (company_id, metric_date, query, impressions, clicks)
    select p_company, (item->>'date')::date, left(btrim(item->>'query'), 300),
      sum(greatest(coalesce((item->>'impressions')::bigint, 0), 0)),
      sum(greatest(coalesce((item->>'clicks')::bigint, 0), 0))
    from jsonb_array_elements(p_queries) as item
    where jsonb_typeof(item) = 'object'
      and coalesce(item->>'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
      and btrim(coalesce(item->>'query', '')) <> ''
    group by (item->>'date')::date, left(btrim(item->>'query'), 300)
    on conflict (company_id, metric_date, query) do update
      set impressions = excluded.impressions, clicks = excluded.clicks;
  end if;

  insert into public.marketing_brand_interest_sync as s (company_id, channel, status, message, checked_at, synced_at)
  values (
    p_company, p_channel, p_status, left(nullif(btrim(coalesce(p_message, '')), ''), 500), now(),
    case when p_status = 'ok' then now() end
  )
  on conflict (company_id, channel) do update
    set status = excluded.status,
      message = excluded.message,
      checked_at = excluded.checked_at,
      synced_at = coalesce(excluded.synced_at, s.synced_at);

  return v_count;
end;
$$;

revoke all on function public.marketing_brand_interest_save(uuid, text, text, text, jsonb, jsonb, date, date)
  from public, anon, authenticated;
grant execute on function public.marketing_brand_interest_save(uuid, text, text, text, jsonb, jsonb, date, date) to service_role;

-- 4. Zmiana fraz marki ----------------------------------------------------------------------------------------------------------

create or replace function public.marketing_brand_terms_can_edit(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p_company is not null
    and not public.current_session_is_seller_portal()
    and (
      public.can_access_marketing_company(p_company, 'marketing_campaigns_manage')
      or public.social_media_can(p_company, 'approve')
    );
$$;

revoke all on function public.marketing_brand_terms_can_edit(uuid) from public, anon;
grant execute on function public.marketing_brand_terms_can_edit(uuid) to authenticated, service_role;

-- Puste frazy = frazy domyślne (z nazwy i adresu strony marki). Po zmianie dane Google marki są czyszczone
-- (liczyły inne frazy), a stan kanału czeka na ponowne pobranie.
create or replace function public.marketing_brand_terms_save(p_company uuid, p_terms text[])
returns text[]
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_terms text[] := coalesce(p_terms, '{}'::text[]);
  v_old text[];
begin
  if p_company is null or not exists (select 1 from public.my_companies c where c.id = p_company) then
    raise exception 'Nie znaleziono marki.' using errcode = 'P0002';
  end if;
  if not public.marketing_brand_terms_can_edit(p_company) then
    raise exception 'Frazy marki zmienia osoba zarządzająca marketingiem albo akceptująca social media marki.' using errcode = '42501';
  end if;
  if not public.marketing_brand_terms_valid(v_terms) then
    raise exception 'Nieprawidłowe frazy marki: od 2 do 60 znaków (litery, cyfry, spacja i znaki & . '' + -), najwyżej 10, bez powtórzeń.'
      using errcode = '22023';
  end if;

  select s.brand_terms into v_old from public.marketing_company_settings s where s.company_id = p_company;

  insert into public.marketing_company_settings as s (company_id, brand_terms)
  values (p_company, v_terms)
  on conflict (company_id) do update set brand_terms = excluded.brand_terms;

  if coalesce(v_old, '{}'::text[]) is distinct from v_terms then
    delete from public.marketing_brand_interest_daily d where d.company_id = p_company and d.channel = 'google';
    delete from public.marketing_brand_queries_daily q where q.company_id = p_company;
    insert into public.marketing_brand_interest_sync as s (company_id, channel, status, message, checked_at, synced_at)
    values (p_company, 'google', 'pending', 'Zmieniono frazy marki — wyniki pojawią się po pobraniu danych z Google.', now(), null)
    on conflict (company_id, channel) do update
      set status = excluded.status, message = excluded.message, checked_at = excluded.checked_at, synced_at = null;
  end if;

  return v_terms;
end;
$$;

revoke all on function public.marketing_brand_terms_save(uuid, text[]) from public, anon;
grant execute on function public.marketing_brand_terms_save(uuid, text[]) to authenticated, service_role;

-- 5. Odczyt (z uprawnieniami osoby — RLS) -----------------------------------------------------------------------------------

create or replace function public.marketing_brand_queries_top(p_company uuid, p_from date, p_to date, p_limit integer default 10)
returns table(query text, impressions bigint, clicks bigint)
language sql
stable
set search_path = pg_catalog, public
as $$
  select q.query, sum(q.impressions)::bigint, sum(q.clicks)::bigint
  from public.marketing_brand_queries_daily q
  where q.company_id = p_company
    and q.metric_date between p_from and p_to
    and p_to - p_from <= 400
  group by q.query
  order by 2 desc, 3 desc, 1
  limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

create or replace function public.social_profile_visits_timeline(p_company uuid, p_from date, p_to date)
returns table(metric_date date, profile_visits bigint)
language sql
stable
set search_path = pg_catalog, public
as $$
  with snaps as (
    select d.metric_date, d.profile_visits, lag(d.profile_visits) over w as prev_visits
    from public.social_post_metrics_daily d
    where d.company_id = p_company and d.channel like 'instagram%' and d.metric_date <= p_to
    window w as (partition by d.publication_id order by d.metric_date)
  )
  select s.metric_date, sum(greatest(coalesce(s.profile_visits, 0) - coalesce(s.prev_visits, 0), 0))::bigint
  from snaps s
  where s.metric_date >= p_from and p_to - p_from <= 400
  group by s.metric_date
  order by s.metric_date;
$$;

revoke all on function public.marketing_brand_queries_top(uuid, date, date, integer) from public, anon;
grant execute on function public.marketing_brand_queries_top(uuid, date, date, integer) to authenticated, service_role;
revoke all on function public.social_profile_visits_timeline(uuid, date, date) from public, anon;
grant execute on function public.social_profile_visits_timeline(uuid, date, date) to authenticated, service_role;

-- 6. Uprawnienia -----------------------------------------------------------------------------------------------------------------

alter table public.marketing_brand_interest_daily enable row level security;
alter table public.marketing_brand_queries_daily enable row level security;
alter table public.marketing_brand_interest_sync enable row level security;

drop policy if exists marketing_brand_interest_daily_select on public.marketing_brand_interest_daily;
create policy marketing_brand_interest_daily_select on public.marketing_brand_interest_daily for select to authenticated
  using (public.social_media_can(company_id, 'view') or public.can_access_marketing_company(company_id));
drop policy if exists marketing_brand_queries_daily_select on public.marketing_brand_queries_daily;
create policy marketing_brand_queries_daily_select on public.marketing_brand_queries_daily for select to authenticated
  using (public.social_media_can(company_id, 'view') or public.can_access_marketing_company(company_id));
drop policy if exists marketing_brand_interest_sync_select on public.marketing_brand_interest_sync;
create policy marketing_brand_interest_sync_select on public.marketing_brand_interest_sync for select to authenticated
  using (public.social_media_can(company_id, 'view') or public.can_access_marketing_company(company_id));

revoke all on public.marketing_brand_interest_daily, public.marketing_brand_queries_daily, public.marketing_brand_interest_sync
  from public, anon, authenticated;
grant select on public.marketing_brand_interest_daily, public.marketing_brand_queries_daily, public.marketing_brand_interest_sync
  to authenticated;
grant all on public.marketing_brand_interest_daily, public.marketing_brand_queries_daily, public.marketing_brand_interest_sync
  to service_role;

commit;
