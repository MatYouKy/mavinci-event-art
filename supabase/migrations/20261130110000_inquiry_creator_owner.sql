-- Zapytanie dodane ręcznie ma od razu opiekuna — osobę, która je dodaje.
--
-- Dotąd zapytanie dodane w CRM („Nowe zapytanie”, z wiadomości, przetargu, karty klienta, kalendarza), na Macu albo
-- w aplikacji mobilnej bez wybranego opiekuna trafiało do wspólnej kolejki „Nieprzypisane” — także wtedy, gdy dodawała je
-- osoba, która sama prowadzi zapytania. Teraz `prepare_inquiry_sales_automation()` (BEFORE INSERT) ustawia opiekunem
-- pracownika z sesji (`sales_employee_id()`), jeśli może prowadzić zapytania: administrator albo `inquiries_assign`,
-- `inquiries_manage`, `inquiries_manage_own`, `inquiries_manage_all` (jak przejmowanie ze wspólnej puli i przydział
-- rotacyjny). Wskazany opiekun (przydział innej osobie) zostaje bez zmian. Bez sesji pracownika — formularze WWW, webhooki,
-- poczta (AI), portal sprzedawcy — jak dotąd: wspólna kolejka albo przydział rotacyjny z ustawień SLA. Ta sama reguła
-- w interfejsie: `src/lib/CRM/inquiries/inquiryCreatorOwner.ts` (CRM, serwer), `mobile/src/lib/permissions.ts`, Mac.
--
-- `notify_inquiry_owner_change()`: bez powiadomienia „Przypisano Ci zapytanie” dla osoby, która sama zostaje opiekunem —
-- porównanie także z `sales_employee_id()` (konto pracownika powiązane przez `auth_user_id`).
--
-- Dane: otwarte zapytania dodane ręcznie (`inquiry_details.source_kind = 'manual'`), bez opiekuna, których autor może
-- prowadzić zapytania — opiekunem zostaje autor (bez powiadomień; wpis w historii zapytania).

create or replace function public.prepare_inquiry_sales_automation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  settings public.inquiry_sla_settings%rowtype;
  selected_owner uuid;
  creator uuid;
begin
  if new.is_inquiry is distinct from true then return new; end if;
  select * into settings from public.inquiry_sla_settings where id = 1;

  -- Osoba dodająca zapytanie (sesja pracownika CRM) zostaje jego opiekunem, jeśli może prowadzić zapytania.
  if tg_op = 'INSERT'
     and new.inquiry_owner_id is null
     and auth.uid() is not null
     and not public.current_session_is_seller_portal()
  then
    select employee.id into creator
    from public.employees employee
    where employee.id = public.sales_employee_id()
      and employee.is_active = true
      and (
        employee.role = 'admin'
        or employee.access_level = 'admin'
        or coalesce(employee.permissions, '{}'::text[])
           && array['admin', 'inquiries_assign', 'inquiries_manage', 'inquiries_manage_own', 'inquiries_manage_all']::text[]
      );
    if creator is not null then
      new.inquiry_owner_id := creator;
    end if;
  end if;

  if tg_op = 'INSERT'
     and new.inquiry_owner_id is null
     and settings.assignment_mode = 'round_robin'
  then
    select employee.id into selected_owner
    from public.employees employee
    where employee.is_active = true
      and (
        employee.role = 'admin'
        or employee.access_level = 'admin'
        or 'inquiries_manage' = any(coalesce(employee.permissions, '{}'::text[]))
        or 'inquiries_manage_own' = any(coalesce(employee.permissions, '{}'::text[]))
      )
    order by (
      select count(*)
      from public.tasks owned
      where owned.is_inquiry = true
        and owned.inquiry_owner_id = employee.id
        and owned.inquiry_stage not in ('won', 'lost')
    ), employee.id
    limit 1;
    new.inquiry_owner_id := selected_owner;
  end if;

  if settings.require_next_action_after_contact = true
     and new.first_contact_at is not null
     and coalesce(new.inquiry_stage, 'new') not in ('won', 'lost')
     and new.next_action_at is null
  then
    new.next_action_at := now() + make_interval(hours => settings.default_next_action_hours);
  end if;

  return new;
end;
$function$;

create or replace function public.notify_inquiry_owner_change()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_notification_id uuid;
  notifications_enabled boolean;
begin
  if new.is_inquiry is distinct from true or new.inquiry_owner_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.inquiry_owner_id is not distinct from old.inquiry_owner_id then
    return new;
  end if;

  -- Samodzielne przejęcie albo dodanie zapytania ma natychmiastowy feedback w interfejsie i nie wymaga
  -- dodatkowego bannera do tej samej osoby.
  if new.inquiry_owner_id = auth.uid() or new.inquiry_owner_id = public.sales_employee_id() then
    return new;
  end if;

  select coalesce(settings.inquiry_assignments_enabled, true)
  into notifications_enabled
  from public.employees employee
  left join public.employee_notification_settings settings
    on settings.employee_id = employee.id
  where employee.id = new.inquiry_owner_id
    and employee.is_active = true
    and (
      employee.role = 'admin'
      or employee.access_level = 'admin'
      or 'inquiries_view' = any(coalesce(employee.permissions, '{}'::text[]))
      or 'inquiries_view_own' = any(coalesce(employee.permissions, '{}'::text[]))
      or 'inquiries_manage' = any(coalesce(employee.permissions, '{}'::text[]))
      or 'inquiries_manage_own' = any(coalesce(employee.permissions, '{}'::text[]))
    );

  if coalesce(notifications_enabled, false) is distinct from true then
    return new;
  end if;

  insert into public.notifications (
    title, message, type, category, action_url,
    related_entity_type, related_entity_id, metadata, created_at
  ) values (
    'Przypisano Ci zapytanie',
    format('Otrzymujesz odpowiedzialność za „%s”.', new.title),
    'info',
    'tasks',
    format('/crm/tasks/%s', new.id),
    'task',
    new.id::text,
    jsonb_build_object('kind', 'inquiry_assignment', 'inquiry_id', new.id),
    now()
  ) returning id into v_notification_id;

  insert into public.notification_recipients (notification_id, user_id, is_read)
  values (v_notification_id, new.inquiry_owner_id, false)
  on conflict (notification_id, user_id) do nothing;

  return new;
exception when others then
  raise notice 'Nie udało się wysłać powiadomienia o przypisaniu zapytania: %', sqlerrm;
  return new;
end;
$function$;

-- Otwarte zapytania dodane ręcznie, które dotąd czekały w „Nieprzypisane”: opiekunem zostaje autor (bez powiadomienia
-- „Przypisano Ci zapytanie” — autor sam je dodał; przypomnienia SLA przeliczają się jak przy przejęciu).
alter table public.tasks disable trigger notify_inquiry_owner_change_after_write;

with assigned as (
  update public.tasks t
     set inquiry_owner_id = t.created_by,
         updated_at = now()
    from public.employees employee
   where t.is_inquiry = true
     and t.inquiry_owner_id is null
     and t.archived_at is null
     and coalesce(t.inquiry_stage, 'new') not in ('won', 'lost')
     and t.inquiry_details ->> 'source_kind' = 'manual'
     and employee.id = t.created_by
     and employee.is_active = true
     and (
       employee.role = 'admin'
       or employee.access_level = 'admin'
       or coalesce(employee.permissions, '{}'::text[])
          && array['admin', 'inquiries_assign', 'inquiries_manage', 'inquiries_manage_own', 'inquiries_manage_all']::text[]
     )
  returning t.id, t.created_by
)
insert into public.inquiry_activity (inquiry_id, kind, body, actor_id, metadata)
select assigned.id, 'note', 'Opiekunem zapytania została osoba, która je dodała.', assigned.created_by,
       jsonb_build_object('new_owner_id', assigned.created_by, 'reason', 'creator_owner')
  from assigned;

alter table public.tasks enable trigger notify_inquiry_owner_change_after_write;
