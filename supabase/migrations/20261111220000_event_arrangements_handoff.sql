-- Ustalenia sprzedawcy w karcie wydarzenia (Przegląd, paski w zakładkach): odczyt ustaleń ofert powiązanych z wydarzeniem
-- (`seller_offer_arrangements`: sala, liczba osób, montaż / start / koniec / demontaż, dni wydarzenia, wymagania techniczne
-- i logistyczne, kontakty na miejscu, miejsce) dla osób, które widzą wydarzenie — bez kwot oferty — oraz potwierdzenie
-- zapoznania się z ustaleniami (np. przez kierownika realizacji przy przejęciu imprezy) z numerem rewizji ustaleń, żeby
-- późniejsze zmiany były widoczne jako „zmienione po potwierdzeniu”.
-- Migracja jest idempotentna — można ją uruchomić ponownie.

begin;

create table if not exists public.event_arrangement_acknowledgements (
  event_id uuid not null references public.events(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  revision integer not null default 0,
  acknowledged_at timestamptz not null default now(),
  primary key (event_id, offer_id, employee_id)
);

alter table public.event_arrangement_acknowledgements enable row level security;

drop policy if exists event_arrangement_ack_read on public.event_arrangement_acknowledgements;
create policy event_arrangement_ack_read on public.event_arrangement_acknowledgements
  for select to authenticated using (public.current_employee_can_view_event(event_id));

drop policy if exists event_arrangement_ack_seller_portal_deny on public.event_arrangement_acknowledgements;
create policy event_arrangement_ack_seller_portal_deny on public.event_arrangement_acknowledgements
  as restrictive for all to authenticated using (not public.current_session_is_seller_portal());

grant select on public.event_arrangement_acknowledgements to authenticated;

-- Zapis wyłącznie przez funkcje poniżej (bez polityk insert / update / delete).

create or replace function public.get_event_arrangements(p_event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_offers jsonb;
begin
  if auth.uid() is null then
    raise exception 'Wymagane logowanie.' using errcode = '42501';
  end if;
  if public.current_session_is_seller_portal() or not coalesce(public.current_employee_can_view_event(p_event), false) then
    raise exception 'Brak dostępu do ustaleń tego wydarzenia' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'offer_id', o.id,
      'offer_number', o.offer_number,
      'title', o.title,
      'status', o.status::text,
      'revision', coalesce(a.revision, 0),
      'updated_at', a.updated_at,
      'updated_by_name', nullif(btrim(concat_ws(' ', u.name, u.surname)), ''),
      'room', a.room,
      'participant_count', a.participant_count,
      'setup_at', to_char(a.setup_at, 'YYYY-MM-DD"T"HH24:MI'),
      'starts_at', to_char(a.starts_at, 'YYYY-MM-DD"T"HH24:MI'),
      'ends_at', to_char(a.ends_at, 'YYYY-MM-DD"T"HH24:MI'),
      'teardown_at', to_char(a.teardown_at, 'YYYY-MM-DD"T"HH24:MI'),
      'materials_due_date', a.materials_due_date,
      'technical_requirements', a.technical_requirements,
      'logistics_requirements', a.logistics_requirements,
      'contacts', coalesce(a.contacts, '[]'::jsonb),
      'event_days', coalesce(a.event_days, '[]'::jsonb),
      'venue', a.venue_snapshot,
      'acknowledgements', (
        select coalesce(jsonb_agg(jsonb_build_object(
            'employee_id', k.employee_id,
            'name', nullif(btrim(concat_ws(' ', e.name, e.surname)), ''),
            'revision', k.revision,
            'acknowledged_at', k.acknowledged_at
          ) order by k.acknowledged_at desc), '[]'::jsonb)
        from public.event_arrangement_acknowledgements k
        left join public.employees e on e.id = k.employee_id
        where k.event_id = p_event and k.offer_id = o.id
      )
    ) order by o.created_at), '[]'::jsonb)
  into v_offers
  from public.offers o
  join public.seller_offer_arrangements a on a.offer_id = o.id
  left join public.employees u on u.id = a.updated_by
  where o.event_id = p_event;

  return jsonb_build_object('offers', v_offers);
end;
$$;

create or replace function public.acknowledge_event_arrangements(p_event uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if auth.uid() is null or v_me is null then
    raise exception 'Wymagane logowanie.' using errcode = '42501';
  end if;
  if public.current_session_is_seller_portal() or not coalesce(public.current_employee_can_view_event(p_event), false) then
    raise exception 'Brak dostępu do ustaleń tego wydarzenia' using errcode = '42501';
  end if;

  insert into public.event_arrangement_acknowledgements (event_id, offer_id, employee_id, revision, acknowledged_at)
  select p_event, o.id, v_me, coalesce(a.revision, 0), now()
  from public.offers o
  join public.seller_offer_arrangements a on a.offer_id = o.id
  where o.event_id = p_event
  on conflict (event_id, offer_id, employee_id)
  do update set revision = excluded.revision, acknowledged_at = excluded.acknowledged_at;

  return public.get_event_arrangements(p_event);
end;
$$;

revoke all on function public.get_event_arrangements(uuid) from public;
grant execute on function public.get_event_arrangements(uuid) to authenticated;
revoke all on function public.acknowledge_event_arrangements(uuid) from public;
grant execute on function public.acknowledge_event_arrangements(uuid) to authenticated;

commit;
