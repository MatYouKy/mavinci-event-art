-- Działy i przełożeni, dostępność pracowników w Spotkaniach i e-maile do uczestników spoza firmy
-- ===============================================================================================================
-- Można uruchomić ponownie. Opis: docs/team-availability.md.
--
-- employees.department    — dział: management (Zarząd), sales (Sprzedaż), office (Biuro), warehouse (Magazyn — magazyn,
--                           DJ, technicy). Pusty traktujemy jak Biuro. Nowy pracownik dostaje dział z roli firmowej.
-- employees.supervisor_id — bezpośredni przełożony (piramida). Dział i przełożonego zmienia administrator albo osoba
--                           z „Zarządzanie pracownikami” (employees_manage); bez pętli w piramidzie.
--
-- Zakres planu (kogo plan z tytułami widzi pracownik — private.schedule_visible_employee_ids):
--   Zarząd, administrator i „Zarządzanie pracownikami” — wszystkich;
--   Sprzedaż i Biuro — Sprzedaż, Biuro i Magazyn;
--   Magazyn — swój dział;
--   każdy — siebie i swoich podwładnych (cała gałąź w dół).
--
-- get_team_availability(ids, od, do, pomiń_spotkanie) — zajętość wybranych osób: spotkania (bez odwołanych i odrzuconych
--   zaproszeń), eventy i fazy (ekipa), nieobecności (zatwierdzone i oczekujące). Szczegóły (tytuł, miejsce, identyfikator):
--   osoby z zakresu i spotkania, w których widz uczestniczy; spotkanie prywatne — tylko „Zajęty”, chyba że widz w nim
--   uczestniczy; typ nieobecności — sam pracownik, Zarząd / administrator / „Zarządzanie pracownikami” i przełożeni (pozostali:
--   „Nieobecność”). Osoby spoza zakresu (np. zaproszone na spotkanie) — sama zajętość bez szczegółów (detailed = false).
-- get_schedule_people() — osoby z zakresu do wyboru w widoku „Pracownicy”.
-- set_employee_structure(id, dział, przełożony) — zapis działu i przełożonego (karta pracownika w CRM, na Macu i w telefonie).
-- meeting_mail_context(id) — dane spotkania i uczestników spoza firmy (kontakty z e-mailem) dla serwera CRM, który wysyła
--   zaproszenie / zmianę / odwołanie z ICS (także chwilę po usunięciu spotkania — do 2 godzin).

begin;

-- 1. Pola ---------------------------------------------------------------------------------------------------------
alter table public.employees add column if not exists department text;
alter table public.employees add column if not exists supervisor_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employees_department_check' and conrelid = 'public.employees'::regclass) then
    alter table public.employees add constraint employees_department_check
      check (department is null or department in ('management', 'sales', 'office', 'warehouse'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_supervisor_id_fkey' and conrelid = 'public.employees'::regclass) then
    alter table public.employees add constraint employees_supervisor_id_fkey
      foreign key (supervisor_id) references public.employees(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'employees_supervisor_not_self' and conrelid = 'public.employees'::regclass) then
    alter table public.employees add constraint employees_supervisor_not_self check (supervisor_id is null or supervisor_id <> id);
  end if;
end $$;

create index if not exists employees_supervisor_idx on public.employees (supervisor_id) where supervisor_id is not null;

-- 2. Dział domyślny z roli firmowej --------------------------------------------------------------------------------
create or replace function private.default_employee_department(p_role text, p_access_level text, p_access_level_id uuid)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select case
    when p_role in ('admin', 'manager') or p_access_level = 'admin' or al.slug in ('admin', 'manager') then 'management'
    when al.slug like 'sales%' then 'sales'
    when al.slug in ('warehouse', 'dj', 'technician', 'event-technician') or p_role in ('technician', 'dj', 'warehouse') then 'warehouse'
    else 'office'
  end
  from (select 1) one
  left join public.access_levels al on al.id = p_access_level_id
$$;
revoke all on function private.default_employee_department(text, text, uuid) from public;

-- Dotychczasowi pracownicy bez działu (tylko pusty dział — ponowne uruchomienie niczego nie nadpisuje).
update public.employees e
   set department = private.default_employee_department(e.role, e.access_level, e.access_level_id)
 where e.department is null;

-- 3. Kto może zmieniać dział i przełożonego -------------------------------------------------------------------------
create or replace function private.can_manage_employee_structure()
returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((
    select not public.current_session_is_seller_portal() and (
      e.role = 'admin' or e.access_level = 'admin'
      or coalesce(e.permissions, '{}'::text[]) && array['admin', 'employees_manage'])
      from public.employees e
     where e.id = public.current_crm_employee_id() and e.is_active
  ), false)
$$;
revoke all on function private.can_manage_employee_structure() from public;

create or replace function private.guard_employee_structure()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_cursor uuid;
  v_depth integer := 0;
begin
  if tg_op = 'INSERT' and new.department is null then
    new.department := private.default_employee_department(new.role, new.access_level, new.access_level_id);
  end if;
  if tg_op = 'UPDATE' and new.department is not distinct from old.department
     and new.supervisor_id is not distinct from old.supervisor_id then
    return new;
  end if;
  -- Z API (sesja użytkownika) — tylko administrator albo „Zarządzanie pracownikami”. Bez sesji (migracje, serwer) — bez ograniczeń.
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not private.can_manage_employee_structure()
     and (tg_op = 'UPDATE' or new.supervisor_id is not null) then
    raise exception 'Dział i przełożonego zmienia administrator albo osoba z uprawnieniem „Zarządzanie pracownikami”.'
      using errcode = '42501';
  end if;
  -- Bez pętli w piramidzie: przełożony nie może być (pośrednio) podwładnym tej osoby.
  v_cursor := new.supervisor_id;
  while v_cursor is not null and v_depth < 64 loop
    if v_cursor = new.id then
      raise exception 'Wybrana osoba jest (pośrednio) podwładnym tego pracownika — wybierz innego przełożonego.';
    end if;
    v_depth := v_depth + 1;
    select e.supervisor_id into v_cursor from public.employees e where e.id = v_cursor;
  end loop;
  return new;
end $$;
revoke all on function private.guard_employee_structure() from public;

drop trigger if exists trg_guard_employee_structure on public.employees;
create trigger trg_guard_employee_structure before insert or update of department, supervisor_id on public.employees
  for each row execute function private.guard_employee_structure();

-- INSERT bez działu: trigger „before insert or update of …” działa przy każdym INSERT, więc dział domyślny zawsze się ustawi.

-- 4. Zakres planu ----------------------------------------------------------------------------------------------------
create or replace function private.schedule_visible_employee_ids()
returns setof uuid language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_me public.employees;
  v_all boolean;
  v_department text;
begin
  select * into v_me from public.employees e where e.id = public.current_crm_employee_id() and e.is_active;
  if v_me.id is null or public.current_session_is_seller_portal() then return; end if;
  v_all := v_me.role = 'admin' or v_me.access_level = 'admin'
           or coalesce(v_me.permissions, '{}'::text[]) && array['admin', 'employees_manage']
           or v_me.department = 'management';
  v_department := coalesce(v_me.department, 'office');
  return query
    with recursive below(id, depth) as (
      select e.id, 1 from public.employees e where e.supervisor_id = v_me.id
      union
      select e.id, b.depth + 1 from public.employees e join below b on e.supervisor_id = b.id where b.depth < 64
    )
    select e.id from public.employees e
     where e.is_active and (
       e.id = v_me.id or coalesce(v_all, false)
       or e.id in (select b.id from below b)
       or (v_department in ('sales', 'office') and coalesce(e.department, 'office') in ('sales', 'office', 'warehouse'))
       or (v_department = 'warehouse' and coalesce(e.department, 'office') = 'warehouse')
     );
end $$;
revoke all on function private.schedule_visible_employee_ids() from public;

-- Podwładni bieżącego pracownika (cała gałąź w dół).
create or replace function private.current_employee_subordinates()
returns setof uuid language sql stable security definer set search_path = pg_catalog, public as $$
  with recursive below(id, depth) as (
    select e.id, 1 from public.employees e where e.supervisor_id = public.current_crm_employee_id()
    union
    select e.id, b.depth + 1 from public.employees e join below b on e.supervisor_id = b.id where b.depth < 64
  )
  select distinct b.id from below b
$$;
revoke all on function private.current_employee_subordinates() from public;

-- 5. Osoby do widoku „Pracownicy” -------------------------------------------------------------------------------------
create or replace function public.get_schedule_people()
returns table(id uuid, name text, surname text, nickname text, avatar_url text, department text, supervisor_id uuid,
              occupation text, is_self boolean, is_subordinate boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
declare
  v_me uuid := public.current_crm_employee_id();
begin
  perform private.require_crm_employee();
  return query
    select e.id, e.name::text, e.surname::text, e.nickname::text, e.avatar_url::text, coalesce(e.department, 'office')::text,
           e.supervisor_id, e.occupation::text, e.id = v_me,
           e.id in (select s from private.current_employee_subordinates() s)
      from public.employees e
     where e.id in (select v from private.schedule_visible_employee_ids() v)
     order by (e.id = v_me) desc, e.name, e.surname;
end $$;
revoke all on function public.get_schedule_people() from public, anon;
grant execute on function public.get_schedule_people() to authenticated;

-- 6. Dostępność -------------------------------------------------------------------------------------------------------
create or replace function public.get_team_availability(p_employee_ids uuid[], p_from timestamptz, p_to timestamptz,
                                                        p_exclude_meeting uuid default null)
returns table(employee_id uuid, kind text, item_id uuid, title text, subtitle text, starts_at timestamptz,
              ends_at timestamptz, all_day boolean, tentative boolean, detailed boolean)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
#variable_conflict use_column
declare
  v_me public.employees;
  v_ids uuid[];
  v_scope uuid[];
  v_below uuid[];
  v_full boolean;
begin
  perform private.require_crm_employee();
  select * into v_me from public.employees e where e.id = public.current_crm_employee_id() and e.is_active;
  if v_me.id is null or public.current_session_is_seller_portal() then
    raise exception 'Brak dostępu do planu pracowników.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Podaj poprawny przedział czasu.';
  end if;
  if p_to - p_from > interval '62 days' then
    raise exception 'Przedział dostępności może mieć najwyżej 62 dni.';
  end if;
  select array_agg(distinct x) into v_ids
    from unnest(coalesce(p_employee_ids, '{}'::uuid[])) x
   where exists (select 1 from public.employees e where e.id = x and e.is_active);
  if v_ids is null then return; end if;
  if cardinality(v_ids) > 60 then
    raise exception 'Wybierz najwyżej 60 osób.';
  end if;
  select coalesce(array_agg(s), '{}'::uuid[]) into v_scope from private.schedule_visible_employee_ids() s;
  select coalesce(array_agg(s), '{}'::uuid[]) into v_below from private.current_employee_subordinates() s;
  v_full := v_me.role = 'admin' or v_me.access_level = 'admin'
            or coalesce(v_me.permissions, '{}'::text[]) && array['admin', 'employees_manage']
            or v_me.department = 'management';

  return query
  -- Spotkania (uczestnik bez odrzucenia albo autor)
  select who.emp, 'meeting'::text,
         case when v.vis then m.id end,
         case when v.vis then coalesce(nullif(btrim(m.title), ''), 'Spotkanie')::text end,
         case when v.vis then nullif(coalesce(ml.name, m.location_text), '')::text end,
         m.datetime_start,
         greatest(coalesce(m.datetime_end, m.datetime_start + interval '1 hour'), m.datetime_start + interval '15 minutes'),
         coalesce(m.is_all_day, false),
         m.status = 'tentative' or who.response in ('pending', 'tentative'),
         v.vis
    from public.meetings m
    left join public.locations ml on ml.id = m.location_id
    cross join lateral (
      select p.employee_id as emp, (case when p.employee_id = m.created_by then 'accepted' else p.response end)::text as response
        from public.meeting_participants p
       where p.meeting_id = m.id and p.employee_id = any (v_ids)
         and (p.response <> 'declined' or p.employee_id = m.created_by)
      union
      select m.created_by, 'accepted'::text where m.created_by = any (v_ids)
    ) who
    cross join lateral (
      -- Szczegóły: widz bierze udział w spotkaniu albo osoba jest w jego zakresie, a spotkanie nie jest prywatne.
      select m.created_by = v_me.id
             or exists (select 1 from public.meeting_participants vp where vp.meeting_id = m.id and vp.employee_id = v_me.id)
             or (who.emp = any (v_scope) and not coalesce(m.is_private, false)) as vis
    ) v
   where m.deleted_at is null
     and m.status <> 'cancelled'
     and (p_exclude_meeting is null or m.id <> p_exclude_meeting)
     and m.datetime_start < p_to
     and coalesce(m.datetime_end, m.datetime_start + interval '1 hour') > p_from

  union all
  -- Eventy (ekipa wydarzenia)
  select ea.employee_id, 'event'::text,
         case when ea.employee_id = any (v_scope) then ev.id end,
         case when ea.employee_id = any (v_scope) then ev.name::text end,
         case when ea.employee_id = any (v_scope) then nullif(l.name, '')::text end,
         ev.event_date,
         greatest(coalesce(ev.event_end_date, ev.event_date + interval '4 hours'), ev.event_date + interval '30 minutes'),
         (coalesce(ev.event_end_date, ev.event_date) - ev.event_date) >= interval '20 hours',
         coalesce(ea.status, 'accepted') = 'pending',
         ea.employee_id = any (v_scope)
    from public.employee_assignments ea
    join public.events ev on ev.id = ea.event_id
    left join public.locations l on l.id = ev.location_id
   where ea.employee_id = any (v_ids)
     and coalesce(ea.status, 'accepted') <> 'rejected'
     and ev.status::text <> 'cancelled'
     and ev.event_date < p_to
     and greatest(coalesce(ev.event_end_date, ev.event_date + interval '4 hours'), ev.event_date + interval '30 minutes') > p_from

  union all
  -- Fazy eventów (osoby przypisane tylko do fazy, bez całego eventu)
  select epa.employee_id, 'phase'::text,
         case when epa.employee_id = any (v_scope) then ev.id end,
         case when epa.employee_id = any (v_scope) then (ep.name || ' — ' || ev.name)::text end,
         case when epa.employee_id = any (v_scope) then nullif(l.name, '')::text end,
         ep.start_time,
         greatest(ep.end_time, ep.start_time + interval '15 minutes'),
         (ep.end_time - ep.start_time) >= interval '20 hours',
         coalesce(epa.invitation_status, 'accepted') = 'pending',
         epa.employee_id = any (v_scope)
    from public.event_phase_assignments epa
    join public.event_phases ep on ep.id = epa.phase_id
    join public.events ev on ev.id = ep.event_id
    left join public.locations l on l.id = ev.location_id
   where epa.employee_id = any (v_ids)
     and coalesce(epa.invitation_status, 'accepted') <> 'rejected'
     and ev.status::text <> 'cancelled'
     and ep.start_time < p_to and ep.end_time > p_from
     and not exists (select 1 from public.employee_assignments ea2
                      where ea2.event_id = ev.id and ea2.employee_id = epa.employee_id
                        and coalesce(ea2.status, 'accepted') <> 'rejected')

  union all
  -- Nieobecności
  select ab.employee_id, 'absence'::text, null::uuid,
         case
           when ab.employee_id = v_me.id or coalesce(v_full, false) or ab.employee_id = any (v_below) then
             (case ab.absence_type::text when 'vacation' then 'Urlop wypoczynkowy' when 'sick_leave' then 'Zwolnienie lekarskie'
                when 'unpaid_leave' then 'Urlop bezpłatny' when 'training' then 'Szkolenie' when 'remote_work' then 'Praca zdalna'
                else 'Nieobecność' end)::text
           when ab.employee_id = any (v_scope) then 'Nieobecność'::text
         end,
         null::text,
         ab.start_date, greatest(ab.end_date, ab.start_date + interval '1 hour'),
         coalesce(ab.all_day, true),
         ab.approval_status::text = 'pending',
         ab.employee_id = any (v_scope)
    from public.employee_absences ab
   where ab.employee_id = any (v_ids)
     and ab.approval_status::text in ('approved', 'pending')
     and ab.start_date < p_to and ab.end_date > p_from
   order by 1, 6;
end $$;
revoke all on function public.get_team_availability(uuid[], timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_team_availability(uuid[], timestamptz, timestamptz, uuid) to authenticated;

-- 7. Zapis działu i przełożonego ---------------------------------------------------------------------------------------
create or replace function public.set_employee_structure(p_employee_id uuid, p_department text, p_supervisor_id uuid default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  perform private.require_crm_employee();
  if not private.can_manage_employee_structure() then
    raise exception 'Dział i przełożonego zmienia administrator albo osoba z uprawnieniem „Zarządzanie pracownikami”.'
      using errcode = '42501';
  end if;
  if p_department is null or p_department not in ('management', 'sales', 'office', 'warehouse') then
    raise exception 'Wybierz dział.';
  end if;
  if not exists (select 1 from public.employees e where e.id = p_employee_id and e.is_active) then
    raise exception 'Nie znaleziono pracownika.';
  end if;
  if p_supervisor_id = p_employee_id then
    raise exception 'Pracownik nie może być swoim przełożonym.';
  end if;
  if p_supervisor_id is not null and not exists (select 1 from public.employees e where e.id = p_supervisor_id and e.is_active) then
    raise exception 'Wybierz przełożonego z listy aktywnych pracowników.';
  end if;
  update public.employees set department = p_department, supervisor_id = p_supervisor_id where id = p_employee_id;
  return jsonb_build_object('id', p_employee_id, 'department', p_department, 'supervisor_id', p_supervisor_id);
end $$;
revoke all on function public.set_employee_structure(uuid, text, uuid) from public, anon;
grant execute on function public.set_employee_structure(uuid, text, uuid) to authenticated;

-- 8. Kontekst e-maila do uczestników spoza firmy ------------------------------------------------------------------------
create or replace function public.meeting_mail_context(p_meeting_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  v_me public.employees;
  m public.meetings;
  v_location record;
  v_series public.meeting_series;
  v_organizer text;
  v_contacts jsonb;
begin
  perform private.require_crm_employee();
  select * into v_me from public.employees e where e.id = public.current_crm_employee_id() and e.is_active;
  select * into m from public.meetings mm where mm.id = p_meeting_id;
  if v_me.id is null or public.current_session_is_seller_portal() or m.id is null
     or (m.deleted_at is not null and m.deleted_at < now() - interval '2 hours') then
    raise exception 'Nie znaleziono spotkania.' using errcode = '42501';
  end if;
  if not (m.created_by = v_me.id
          or ((v_me.role = 'admin' or v_me.access_level = 'admin'
               or coalesce(v_me.permissions, '{}'::text[]) && array['admin', 'calendar_manage'])
              and exists (select 1 from public.meeting_participants p where p.meeting_id = m.id and p.employee_id = v_me.id))) then
    raise exception 'E-maile do osób spoza firmy wysyła organizator spotkania albo uczestnicząca w nim osoba zarządzająca kalendarzem.'
      using errcode = '42501';
  end if;
  select l.name, l.address, l.city into v_location from public.locations l where l.id = m.location_id;
  if m.series_id is not null then
    select * into v_series from public.meeting_series s where s.id = m.series_id;
  end if;
  select nullif(btrim(concat_ws(' ', e.name, e.surname)), '') into v_organizer from public.employees e where e.id = m.created_by;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'name', coalesce(nullif(btrim(c.full_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Kontakt'),
           'email', nullif(btrim(c.email), ''))
         order by c.last_name, c.first_name), '[]'::jsonb)
    into v_contacts
    from (select distinct p.contact_id from public.meeting_participants p where p.meeting_id = m.id and p.contact_id is not null) pc
    join public.contacts c on c.id = pc.contact_id;
  return jsonb_build_object(
    'id', m.id,
    'title', coalesce(nullif(btrim(m.title), ''), 'Spotkanie'),
    'start', m.datetime_start,
    'end', m.datetime_end,
    'allDay', coalesce(m.is_all_day, false),
    'location', nullif(coalesce(v_location.name, m.location_text), ''),
    'address', case when v_location.name is not null then nullif(concat_ws(', ', nullif(btrim(v_location.address), ''), nullif(btrim(v_location.city), '')), '') end,
    'status', coalesce(m.status, 'confirmed'),
    'deleted', m.deleted_at is not null,
    'seriesId', m.series_id,
    'recurrenceDays', coalesce(m.recurrence_days, 0),
    'recurrenceIndex', m.recurrence_index,
    'seriesEndsBefore', v_series.ends_before,
    'organizer', v_organizer,
    'contacts', v_contacts
  );
end $$;
revoke all on function public.meeting_mail_context(uuid) from public, anon;
grant execute on function public.meeting_mail_context(uuid) to authenticated;

commit;
