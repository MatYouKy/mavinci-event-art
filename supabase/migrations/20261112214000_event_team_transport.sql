-- Zespół wydarzenia: którym autem jedzie każda osoba (przypisanie do pojazdu z logistyki wydarzenia).
-- Kierowca jest przypisany w logistyce (`event_vehicles.driver_id`); pozostałe osoby z zespołu dostają
-- `employee_assignments.transport_event_vehicle_id` (menu ⋯ przy osobie w zakładce Zespół, CRM i aplikacja na Maca).
-- Dzięki temu widać, czy jedzie wystarczająco dużo aut — wąskim gardłem są miejsca siedzące (`vehicles.number_of_seats`).
-- Usunięcie pojazdu z wydarzenia czyści przypisanie. Migracja jest idempotentna — można ją uruchomić ponownie.

begin;

alter table public.employee_assignments
  add column if not exists transport_event_vehicle_id uuid references public.event_vehicles(id) on delete set null;

create index if not exists employee_assignments_transport_vehicle_idx
  on public.employee_assignments (transport_event_vehicle_id)
  where transport_event_vehicle_id is not null;

comment on column public.employee_assignments.transport_event_vehicle_id is
  'Pojazd wydarzenia (event_vehicles), którym jedzie ta osoba; kierowca jest w event_vehicles.driver_id.';

create or replace function public.check_assignment_transport_vehicle()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if new.transport_event_vehicle_id is not null and not exists (
    select 1 from public.event_vehicles v
    where v.id = new.transport_event_vehicle_id and v.event_id = new.event_id
  ) then
    raise exception 'Wybrany pojazd nie jest przypisany do tego wydarzenia.' using errcode = '22023';
  end if;
  return new;
end
$function$;

revoke all on function public.check_assignment_transport_vehicle() from public, anon, authenticated;

drop trigger if exists check_assignment_transport_vehicle on public.employee_assignments;
create trigger check_assignment_transport_vehicle
  before insert or update of transport_event_vehicle_id, event_id on public.employee_assignments
  for each row execute function public.check_assignment_transport_vehicle();

commit;
