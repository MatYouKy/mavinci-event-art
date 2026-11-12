-- Powiadomienia tylko niezbędne: nikt nie dostaje powiadomienia o własnym działaniu.
-- Przykłady: autor wydarzenia dodaje siebie jako kierowcę, sam siebie wyznacza na kierownika realizacji,
-- sprzedawca zmienia swoje wydarzenie albo ofertę, ktoś przypisuje siebie do zadania lub spotkania.
--
-- 1. Strażnik na `notification_recipients` (dotyczy wszystkich istniejących i przyszłych powiadomień):
--    odbiorca, który jest zalogowanym autorem zmiany (`auth.uid()`), jest pomijany. Powiadomienia z zadań
--    automatycznych (przypomnienia, poczta, KSeF, flota) nie mają zalogowanego autora i działają jak dotąd.
--    Wyjątek: powiadomienie z `metadata.allow_self = true` (np. przyszłe „Twój eksport jest gotowy”).
-- 2. „Wyznaczono Cię na kierownika realizacji” — dodatkowo pomijane, gdy wyznaczający = wyznaczony
--    (`appointed_by`), także gdy zmianę wykonał proces bez sesji użytkownika.
--
-- Samodzielne przypisania do zespołu, pojazdu i etapu są już przyjmowane automatycznie
-- (`accept_own_event_team_assignment`, `accept_own_driver_assignment`, `accept_own_event_phase_assignment`),
-- więc pominięte powiadomienie nie zostawia zaproszenia bez odpowiedzi.
-- Migracja jest idempotentna — można ją uruchomić ponownie.

begin;

create or replace function public.skip_own_action_notification()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or new.user_id is null then
    return new;
  end if;

  if new.user_id <> v_actor and not exists (
    select 1 from public.employees e where e.id = new.user_id and e.auth_user_id = v_actor
  ) then
    return new;
  end if;

  if exists (
    select 1 from public.notifications n
    where n.id = new.notification_id and n.metadata ->> 'allow_self' = 'true'
  ) then
    return new;
  end if;

  -- Własne działanie: bez wpisu odbiorcy nie ma powiadomienia w CRM, na telefonie ani w e-mailu.
  return null;
end
$function$;

revoke all on function public.skip_own_action_notification() from public, anon, authenticated;

drop trigger if exists aaa_skip_own_action_notification on public.notification_recipients;
create trigger aaa_skip_own_action_notification
  before insert on public.notification_recipients
  for each row execute function public.skip_own_action_notification();

comment on function public.skip_own_action_notification() is
  'Nie tworzy powiadomienia dla osoby, która sama wykonała zmianę (auth.uid()); wyjątek: metadata.allow_self = true.';

create or replace function public.notify_realization_responsibility()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
 if new.manager_id is not null and (tg_op = 'INSERT' or new.manager_id is distinct from old.manager_id)
    and new.manager_id is distinct from new.appointed_by then
  perform public.notify_event_operation(new.event_id, 'manager_appointed',
   'manager:' || new.event_id || ':' || new.manager_id || ':' || coalesce(new.appointed_at, statement_timestamp())::text,
   'Wyznaczono Cię na kierownika realizacji',
   case when exists (select 1 from public.event_warehouse_handoffs h where h.event_id = new.event_id and h.ready_at is not null)
    then 'Magazyn potwierdził już gotowość. Możesz przejąć realizację.'
    else 'Odpowiadasz za realizację. Otrzymasz powiadomienie, gdy magazyn potwierdzi gotowość.' end, new.manager_id);
 end if;
 if new.started_at is not null and (tg_op = 'INSERT' or old.started_at is null) then
  perform public.notify_event_operation(new.event_id, 'realization_started', 'started:' || new.event_id,
   'Kierownik przejął realizację', coalesce(new.manager_name, 'Kierownik') || ' rozpoczął realizację wydarzenia.');
 end if;
 if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
  perform public.notify_event_operation(new.event_id, 'realization_completed', 'completed:' || new.event_id,
   'Realizacja zakończona', coalesce(new.manager_name, 'Kierownik') || ' potwierdził zakończenie realizacji.');
 end if;
 return new;
end
$function$;

commit;
