-- Nowa wiadomość (CRM, Mac, telefon): podpowiedzi adresatów w polach „Do”, „DW” i „UDW” — jak w Thunderbirdzie.
--
-- `email_recipient_suggestions(p_query, p_limit)` szuka wpisywanego tekstu (imię, nazwisko, fragment adresu, nazwa firmy
-- lub organizacji) w:
-- • kontaktach (nazwa, e-mail, firma, bieżące organizacje kontaktu),
-- • organizacjach (nazwa, alias, e-mail),
-- • pracownikach (aktywni),
-- • korespondencji z ostatnich 3 lat — nadawcy wiadomości odebranych i adresaci wysłanych (bez adresów technicznych:
--   no-reply, mailer-daemon, postmaster, bounce).
-- Jeden wiersz na adres e-mail z powiązaniem: kontakt, pracownik, organizacja (bieżąca organizacja kontaktu, organizacja
-- z tym adresem albo z domeną adresu w `correspondence_domains`) i liczba wiadomości wysłanych / odebranych.
-- Kolejność: trafność (początek słowa przed fragmentem), liczba wysłanych i odebranych, świeżość, znany kontakt.
-- Funkcja działa z uprawnieniami osoby (SECURITY INVOKER — RLS): podpowiada tylko kontakty, organizacje i korespondencję
-- ze skrzynek, które ta osoba widzi w CRM. Bez zapisu danych. Plik idempotentny.

begin;

create or replace function public.email_suggest_norm(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:]]+', ' ', 'g'));
$$;

-- 3 — początek słowa (imię, nazwisko, część adresu: „marz” w „k.marzewska@…”), 1 — fragment w środku, 0 — brak.
create or replace function public.email_suggest_match(p_value text, p_term text)
returns integer
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select case
    when coalesce(p_term, '') = '' or p_value is null then 0
    when strpos(' ' || public.email_suggest_norm(p_value), ' ' || p_term) > 0 then 3
    when strpos(public.email_suggest_norm(p_value), p_term) > 0 then 1
    else 0
  end;
$$;

create or replace function public.email_recipient_suggestions(p_query text, p_limit integer default 8)
returns table(
  email text,
  name text,
  kind text,
  contact_id uuid,
  organization_id uuid,
  organization_name text,
  employee_id uuid,
  sent_count integer,
  received_count integer,
  last_at timestamptz
)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with params as (
    select public.email_suggest_norm(left(coalesce(p_query, ''), 100)) as term,
      least(greatest(coalesce(p_limit, 8), 1), 20) as max_rows,
      '([A-Za-z0-9._%+''-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)'::text as pattern
  ),
  correspondence as (
    select lower(found.address[1]) as email,
      case when r.from_address ~ '<'
        then nullif(btrim(regexp_replace(split_part(r.from_address, '<', 1), '["'']+', '', 'g')), '') end as display_name,
      0 as sent, 1 as received, coalesce(r.received_date, r.created_at) as at
    from public.received_emails r
    cross join params p
    cross join lateral regexp_matches(coalesce(r.from_address, ''), p.pattern, 'g') as found(address)
    where p.term <> '' and r.deleted_at is null and coalesce(r.received_date, r.created_at) > now() - interval '3 years'
    union all
    select lower(found.address[1]),
      case when s.to_address ~ '<' and s.to_address !~ '[,;]'
        then nullif(btrim(regexp_replace(split_part(s.to_address, '<', 1), '["'']+', '', 'g')), '') end,
      1, 0, coalesce(s.sent_at, s.created_at)
    from public.sent_emails s
    cross join params p
    cross join lateral regexp_matches(coalesce(s.to_address, ''), p.pattern, 'g') as found(address)
    where p.term <> '' and s.deleted_at is null and coalesce(s.sent_at, s.created_at) > now() - interval '3 years'
  ),
  stats as (
    select c.email,
      -- Nazwa z nagłówka: najpierw ta, którą podaje nadawca (odebrane), potem wpisana przy wysyłce — najnowsza.
      (array_agg(c.display_name order by c.received desc, c.at desc) filter (where c.display_name is not null))[1] as display_name,
      sum(c.sent)::integer as sent_count,
      sum(c.received)::integer as received_count,
      max(c.at) as last_at
    from correspondence c
    where split_part(c.email, '@', 1) !~ '^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?)([+._-]|$)'
    group by c.email
  ),
  domains as (
    select distinct on (lower(btrim(d.domain))) lower(btrim(d.domain)) as domain, o.id as organization_id, o.name
    from public.organizations o
    cross join lateral unnest(coalesce(o.correspondence_domains, '{}'::text[])) as d(domain)
    where btrim(coalesce(d.domain, '')) <> ''
    order by lower(btrim(d.domain)), o.name
  ),
  sources as (
    -- Kontakty (z pierwszą bieżącą organizacją kontaktu).
    select lower(found.address[1]) as email,
      greatest(
        public.email_suggest_match(c.full_name, p.term),
        public.email_suggest_match(found.address[1], p.term),
        public.email_suggest_match(c.company_name, p.term),
        coalesce(org.match, 0)
      ) as match,
      'contact'::text as source, c.id as contact_id, nullif(btrim(c.full_name), '') as contact_name,
      org.id as organization_id, org.name as organization_name, null::uuid as employee_id, null::text as employee_name,
      null::text as display_name, 0 as sent_count, 0 as received_count, null::timestamptz as last_at, c.updated_at as ranked_at
    from public.contacts c
    cross join params p
    cross join lateral regexp_matches(coalesce(c.email, ''), p.pattern, 'g') as found(address)
    left join lateral (
      select (array_agg(o.id order by o.name))[1] as id, (array_agg(o.name order by o.name))[1] as name,
        max(public.email_suggest_match(o.name, p.term)) as match
      from public.contact_organizations co
      join public.organizations o on o.id = co.organization_id
      where co.contact_id = c.id and co.is_current
    ) org on true
    where p.term <> ''
    union all
    -- Organizacje (adres organizacji).
    select lower(found.address[1]),
      greatest(public.email_suggest_match(o.name, p.term), public.email_suggest_match(o.alias, p.term),
        public.email_suggest_match(found.address[1], p.term)),
      'organization', null, null, o.id, o.name, null, null, null, 0, 0, null, o.updated_at
    from public.organizations o
    cross join params p
    cross join lateral regexp_matches(coalesce(o.email, ''), p.pattern, 'g') as found(address)
    where p.term <> ''
    union all
    -- Pracownicy (aktywni).
    select lower(found.address[1]),
      greatest(public.email_suggest_match(concat_ws(' ', e.name, e.surname), p.term),
        public.email_suggest_match(found.address[1], p.term)),
      'employee', null, null, null, null, e.id, nullif(btrim(concat_ws(' ', e.name, e.surname)), ''), null, 0, 0, null, null
    from public.employees e
    cross join params p
    cross join lateral regexp_matches(coalesce(e.email, ''), p.pattern, 'g') as found(address)
    where p.term <> '' and coalesce(e.is_active, true)
    union all
    -- Korespondencja (z organizacją domeny adresu).
    select s.email,
      greatest(public.email_suggest_match(s.email, p.term), public.email_suggest_match(s.display_name, p.term),
        public.email_suggest_match(d.name, p.term)),
      'correspondence', null, null, d.organization_id, d.name, null, null, s.display_name,
      s.sent_count, s.received_count, s.last_at, null
    from stats s
    cross join params p
    left join domains d on d.domain = split_part(s.email, '@', 2)
  ),
  grouped as (
    select s.email,
      max(s.match) as match,
      (array_agg(s.contact_id order by s.ranked_at desc nulls last) filter (where s.contact_id is not null))[1] as contact_id,
      (array_agg(s.contact_name order by s.ranked_at desc nulls last) filter (where s.contact_name is not null))[1] as contact_name,
      (array_agg(s.organization_id order by s.source = 'contact' desc, s.source = 'organization' desc)
        filter (where s.organization_id is not null))[1] as organization_id,
      (array_agg(s.organization_name order by s.source = 'contact' desc, s.source = 'organization' desc)
        filter (where s.organization_name is not null))[1] as organization_name,
      bool_or(s.source = 'organization') as organization_address,
      (array_agg(s.employee_id) filter (where s.employee_id is not null))[1] as employee_id,
      (array_agg(s.employee_name) filter (where s.employee_name is not null))[1] as employee_name,
      (array_agg(s.display_name) filter (where s.display_name is not null))[1] as display_name,
      max(s.sent_count) as sent_count,
      max(s.received_count) as received_count,
      max(s.last_at) as last_at
    from sources s
    where s.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    group by s.email
  )
  select g.email,
    coalesce(g.contact_name, g.employee_name, g.display_name, case when g.organization_address then g.organization_name end) as name,
    case
      when g.contact_id is not null then 'contact'
      when g.employee_id is not null then 'employee'
      when g.organization_address then 'organization'
      else 'correspondence'
    end as kind,
    g.contact_id, g.organization_id, g.organization_name, g.employee_id,
    coalesce(g.sent_count, 0), coalesce(g.received_count, 0), g.last_at
  from grouped g
  cross join params p
  where g.match >= case when char_length(p.term) < 2 then 3 else 1 end
  order by
    g.match * 100
      + least(coalesce(g.sent_count, 0), 25) * 4
      + least(coalesce(g.received_count, 0), 25) * 2
      + case when g.last_at > now() - interval '30 days' then 20 when g.last_at > now() - interval '180 days' then 10 else 0 end
      + case when g.contact_id is not null then 12 when g.organization_address then 8 when g.employee_id is not null then 6 else 0 end
      desc,
    g.last_at desc nulls last,
    g.email
  limit (select max_rows from params);
$$;

revoke all on function public.email_recipient_suggestions(text, integer) from public, anon;
grant execute on function public.email_recipient_suggestions(text, integer) to authenticated, service_role;
grant execute on function public.email_suggest_norm(text) to authenticated, service_role;
grant execute on function public.email_suggest_match(text, text) to authenticated, service_role;

commit;
