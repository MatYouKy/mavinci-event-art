-- Potwierdzenia ustaleń wydarzenia (`event_arrangement_acknowledgements`): klucz zastępczy zamiast klucza głównego
-- z (event_id, offer_id, employee_id).
--
-- Klucz główny złożony z kluczy obcych do `offers` i `events` sprawiał, że PostgREST uznawał tę tabelę za tabelę łączącą
-- offers ↔ events (a także offers ↔ employees i events ↔ employees). Od tej chwili każde osadzenie `events` w zapytaniu
-- o oferty i `offers` w zapytaniu o wydarzenia bez wskazania klucza kończyło się błędem „Could not embed because more than
-- one relationship was found for 'offers' and 'events'” — m.in. generowanie PDF oferty w CRM i na Macu.
--
-- Unikalność tych samych kolumn zostaje, więc `on conflict (event_id, offer_id, employee_id)` w
-- `acknowledge_event_arrangements` działa bez zmian. Tabela jest czytana i zapisywana tylko przez funkcje SQL.

alter table public.event_arrangement_acknowledgements
  add column if not exists id uuid not null default gen_random_uuid();

do $$
declare
  t constant regclass := 'public.event_arrangement_acknowledgements'::regclass;
begin
  if not exists (select 1 from pg_constraint where conrelid = t and conname = 'event_arrangement_acknowledgements_event_offer_employee_key') then
    alter table public.event_arrangement_acknowledgements
      add constraint event_arrangement_acknowledgements_event_offer_employee_key unique (event_id, offer_id, employee_id);
  end if;

  if exists (select 1 from pg_constraint where conrelid = t and contype = 'p' and array_length(conkey, 1) > 1) then
    alter table public.event_arrangement_acknowledgements drop constraint event_arrangement_acknowledgements_pkey;
  end if;

  if not exists (select 1 from pg_constraint where conrelid = t and contype = 'p') then
    alter table public.event_arrangement_acknowledgements
      add constraint event_arrangement_acknowledgements_pkey primary key (id);
  end if;
end $$;

notify pgrst, 'reload schema';
