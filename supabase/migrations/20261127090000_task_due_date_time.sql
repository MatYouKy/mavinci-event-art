-- Termin zadania z godziną (CRM, Mac, aplikacja mobilna).
--
-- Formularze zapisywały sam dzień terminu („2026-11-25”), a kolumna `tasks.due_date` (timestamptz) robiła z niego północ UTC,
-- czyli 01:00 (zimą) / 02:00 (latem) czasu polskiego — stąd „losowa godzina” w zadaniach, kalendarzu i planie pracownika,
-- a zadanie było „po terminie” już o 1 w nocy. Od teraz termin bez godziny to koniec dnia, 23:59 czasu polskiego (plan pracownika
-- `get_employee_schedule` pokazuje go jako cały dzień), a termin z godziną zapisuje się tak, jak wybrał pracownik
-- (`src/lib/CRM/tasks/taskDue.ts`; godzina wypadająca na północ UTC dostaje 1 sekundę, więc wyzwalacz jej nie rusza).
--
-- 1. Wyzwalacz: zapis terminu zadania dokładnie o północy UTC (sam dzień — starsze wersje aplikacji i formularze) → 23:59
--    czasu polskiego tego dnia. Zapytań (`is_inquiry`) nie dotyczy — ich termin pokazuje kalendarz jak dotąd.
-- 2. Porządek danych: istniejące zadania (bez zapytań) z terminem dokładnie o północy UTC → 23:59 czasu polskiego tego dnia.

create or replace function private.task_due_date_end_of_day()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.due_date is not null
     and coalesce(new.is_inquiry, false) = false
     and (tg_op = 'INSERT' or new.due_date is distinct from old.due_date)
     and (new.due_date at time zone 'UTC')::time = time '00:00' then
    new.due_date := ((new.due_date at time zone 'UTC')::date + time '23:59') at time zone 'Europe/Warsaw';
  end if;
  return new;
end
$$;

comment on function private.task_due_date_end_of_day() is
  'Termin zadania (bez zapytań) zapisany jako sam dzień (północ UTC) → 23:59 czasu polskiego tego dnia (termin na cały dzień).';

drop trigger if exists task_due_date_end_of_day on public.tasks;
create trigger task_due_date_end_of_day
  before insert or update of due_date on public.tasks
  for each row execute function private.task_due_date_end_of_day();

update public.tasks
   set due_date = ((due_date at time zone 'UTC')::date + time '23:59') at time zone 'Europe/Warsaw'
 where due_date is not null
   and coalesce(is_inquiry, false) = false
   and (due_date at time zone 'UTC')::time = time '00:00';
