-- Zespół wydarzenia: zakres widoczności osoby wynika z jej roli w ustawieniach pracownika (`employees.access_level_id`),
-- a nie z wyboru przy dodawaniu do wydarzenia. Okna „Dodaj osobę do zespołu” (CRM, aplikacja na Maca) nie mają już
-- pola „Poziom dostępu”; przypisanie dostaje poziom pracownika automatycznie — także z kreatora wydarzenia,
-- timeline i aplikacji mobilnej. Uprawnienia współpracownika w wydarzeniu (edycja agendy, sprzętu…) bez zmian.
-- Istniejące przypisania zostają bez zmian. Migracja jest idempotentna — można ją uruchomić ponownie.

begin;

create or replace function public.event_assignment_access_from_employee()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  new.access_level_id := coalesce(
    (select e.access_level_id from public.employees e where e.id = new.employee_id),
    new.access_level_id
  );
  return new;
end
$function$;

revoke all on function public.event_assignment_access_from_employee() from public, anon, authenticated;

drop trigger if exists event_assignment_access_from_employee on public.employee_assignments;
create trigger event_assignment_access_from_employee
  before insert on public.employee_assignments
  for each row execute function public.event_assignment_access_from_employee();

commit;
