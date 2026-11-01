-- Zasady dla wpisów czasu pracy (time_entries).
--
-- 1. Ślad audytowy przeżywa usunięcie wpisu: historia (time_entries_history) i wątki do wyjaśnienia
--    (time_entry_threads) nie są już kasowane kaskadowo — po usunięciu wpisu time_entry_id = NULL
--    (identyfikator wpisu zostaje w old_values/new_values historii). Klienci API nie mogą pisać do
--    historii — zapisują ją wyłącznie triggery log_time_entry_* (SECURITY DEFINER).
-- 2. Trigger a_guard_time_entry_rules (BEFORE INSERT/UPDATE/DELETE, odpala się jako pierwszy):
--    a. rozliczony okres (employee_time_settlements, ostatnie nieanulowane settled_until) jest zamknięty
--       dla wszystkich, także kierowników — wpis zaczynający się przed settled_until nie może być
--       dodany, zmieniony ani usunięty; korekta = najpierw cofnięcie rozliczenia;
--    b. pracownik (nie kierownik): licznik uruchamia się tylko „teraz” (±5 min), żadnych wpisów
--       w przyszłości (> teraz + 5 min), nie można ponownie otworzyć zakończonego wpisu;
--    c. pojedynczy wpis — maksymalnie 24 godziny (wszyscy);
--    d. wpisy jednego pracownika nie mogą się nakładać (wszyscy; dotyczy nowych i zmienianych wierszy —
--       istniejące nakładki zostają, ale edycja takiego wiersza musi je usunąć);
--    e. pracownik nie usuwa wpisu z otwartym wątkiem do wyjaśnienia i nie ustala stawki godzinowej
--       (INSERT: stawka z profilu wynagrodzenia/umowy; UPDATE: stawka bez zmian).
--    „Kierownik” = administrator CRM albo personnel_manage (public.personnel_can_access(true)).
--    Bez sesji użytkownika API (pg_cron, migracje, service_role — auth.role() inne niż anon/authenticated)
--    trigger nic nie sprawdza.
-- 3. Jeden otwarty licznik na pracownika (indeks unikalny częściowy), o ile dane na to pozwalają.
-- Plik można bezpiecznie uruchomić ponownie.
BEGIN;

-- 1. Historia i wątki przeżywają usunięcie wpisu ----------------------------------------------------

-- Triggery historii już są SECURITY DEFINER — ALTER jest no-op, ale gwarantuje to przed odebraniem
-- praw zapisu do historii (zachowanie funkcji się nie zmienia).
DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.log_time_entry_insert()', 'public.log_time_entry_update()', 'public.log_time_entry_delete()'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'Brak funkcji % — przerwano, bo bez niej historia czasu pracy nie byłaby zapisywana.', v_sig;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', v_sig);
  END LOOP;
END $$;

ALTER TABLE public.time_entries_history ALTER COLUMN time_entry_id DROP NOT NULL;
ALTER TABLE public.time_entries_history DROP CONSTRAINT IF EXISTS time_entries_history_time_entry_id_fkey;
ALTER TABLE public.time_entries_history
  ADD CONSTRAINT time_entries_history_time_entry_id_fkey
  FOREIGN KEY (time_entry_id) REFERENCES public.time_entries(id) ON DELETE SET NULL;

ALTER TABLE public.time_entry_threads ALTER COLUMN time_entry_id DROP NOT NULL;
ALTER TABLE public.time_entry_threads DROP CONSTRAINT IF EXISTS time_entry_threads_time_entry_id_fkey;
ALTER TABLE public.time_entry_threads
  ADD CONSTRAINT time_entry_threads_time_entry_id_fkey
  FOREIGN KEY (time_entry_id) REFERENCES public.time_entries(id) ON DELETE SET NULL;

-- Historii nie zapisuje się z API (SELECT zostaje — czytają ją polityki RLS i widok
-- admin_time_entries_history_view). Akcja FK SET NULL działa z prawami właściciela tabeli.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.time_entries_history FROM anon, authenticated;

-- 2. Reguły wpisów czasu pracy ---------------------------------------------------------------

-- Koniec ostatniego nieanulowanego rozliczenia czasu pracy pracownika (NULL — brak rozliczeń).
CREATE OR REPLACE FUNCTION private.time_entry_settled_until(p_employee_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.settled_until
  FROM public.employee_time_settlements s
  WHERE s.employee_id = p_employee_id
    AND s.voided_at IS NULL
  ORDER BY s.settled_until DESC
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION private.time_entry_settled_until(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_time_entry_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  -- Kolumny utrzymywane przez system (triggery) — ich zmiana nie jest „edycją wpisu”.
  c_system_columns constant text[] := ARRAY['updated_at', 'edit_count', 'duration_minutes',
    'compensation_snapshot', 'personnel_rate_snapshot'];
  c_tolerance constant interval := interval '5 minutes';
  c_max_duration constant interval := interval '24 hours';
  v_manager boolean;
  v_direct boolean := pg_trigger_depth() = 1;
  v_times_changed boolean := false;
  v_user_change boolean := false;
  v_settled timestamptz;
  v_conflict record;
BEGIN
  -- Bez sesji użytkownika API (pg_cron, migracje, Edge Functions z kluczem service_role) — bez kontroli.
  -- Żądanie z rolą anon nie jest zwolnione (i tak nie ma polityk zapisu do time_entries).
  IF coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_manager := public.current_employee_is_crm_admin() OR public.personnel_can_access(true);

  -- e. Stawka godzinowa i licznik edycji nie pochodzą od klienta.
  IF TG_OP = 'INSERT' THEN
    IF NOT v_manager THEN
      -- default_employee_time_rate (odpala się po tym triggerze) uzupełni stawkę z profilu wynagrodzenia,
      -- a z_personnel_work — ze stawki umowy.
      NEW.hourly_rate := NULL;
    END IF;
    IF v_direct THEN
      NEW.edit_count := 0;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NOT v_manager THEN
      NEW.hourly_rate := OLD.hourly_rate;
    END IF;
    -- edit_count podbija wyłącznie trigger update_edit_count (zagnieżdżony UPDATE, głębokość > 1).
    IF v_direct THEN
      NEW.edit_count := OLD.edit_count;
    END IF;
  END IF;

  -- Co się faktycznie zmienia. Zagnieżdżone UPDATE-y (update_edit_count, FK ON DELETE SET NULL
  -- przy usuwaniu wydarzenia) nie są edycją wpisu, chyba że zmieniają godziny lub pracownika.
  IF TG_OP = 'INSERT' THEN
    v_times_changed := true;
    v_user_change := true;
  ELSIF TG_OP = 'UPDATE' THEN
    v_times_changed := NEW.start_time IS DISTINCT FROM OLD.start_time
      OR NEW.end_time IS DISTINCT FROM OLD.end_time
      OR NEW.employee_id IS DISTINCT FROM OLD.employee_id;
    v_user_change := v_times_changed
      OR (v_direct AND (to_jsonb(NEW) - c_system_columns) IS DISTINCT FROM (to_jsonb(OLD) - c_system_columns));
  END IF;

  -- a. Rozliczony okres — dla wszystkich, także kierowników.
  --    Rozliczenie obejmuje wpisy zakończone do settled_until; wpis trwający przez settled_until nie może
  --    istnieć (save_employee_time_settlement to blokuje), więc „rozliczony” = start_time < settled_until.
  --    Wpis zaczynający się dokładnie w settled_until należy już do kolejnego okresu.
  IF TG_OP = 'DELETE' OR v_user_change THEN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      v_settled := private.time_entry_settled_until(OLD.employee_id);
      IF v_settled IS NOT NULL AND OLD.start_time < v_settled THEN
        RAISE EXCEPTION 'Czas pracy do % jest już rozliczony — wpisu z tego okresu nie można zmienić ani usunąć. Aby go poprawić, najpierw cofnij rozliczenie.',
          to_char(v_settled AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')
          USING ERRCODE = '42501';
      END IF;
    END IF;
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      v_settled := private.time_entry_settled_until(NEW.employee_id);
      IF v_settled IS NOT NULL AND NEW.start_time < v_settled THEN
        RAISE EXCEPTION 'Czas pracy do % jest już rozliczony — nie można dodać ani przenieść wpisu do tego okresu. Aby go poprawić, najpierw cofnij rozliczenie.',
          to_char(v_settled AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- e. Pracownik nie usuwa wpisu z otwartym wątkiem do wyjaśnienia.
    IF NOT v_manager AND EXISTS (
      SELECT 1 FROM public.time_entry_threads t WHERE t.time_entry_id = OLD.id AND NOT t.resolved
    ) THEN
      RAISE EXCEPTION 'Ten wpis ma otwarty wątek do wyjaśnienia — nie można go usunąć, dopóki administrator nie zamknie wątku.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT v_user_change THEN
    RETURN NEW;
  END IF;

  IF NEW.end_time IS NOT NULL AND NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'Koniec wpisu musi być późniejszy niż jego początek.' USING ERRCODE = '23514';
  END IF;

  -- c. Maksymalnie 24 godziny w jednym wpisie.
  IF NEW.end_time IS NOT NULL AND NEW.end_time - NEW.start_time > c_max_duration THEN
    RAISE EXCEPTION 'Pojedynczy wpis czasu pracy nie może przekraczać 24 godzin. Podziel pracę na kilka wpisów (np. osobny wpis na każdy dzień), a jeśli licznik nie został zatrzymany na czas — ustaw faktyczną godzinę zakończenia.'
      USING ERRCODE = '23514';
  END IF;

  -- b. Pracownik: bez przyszłości, licznik tylko „teraz”, bez ponownego otwierania wpisów.
  IF NOT v_manager AND v_times_changed THEN
    IF TG_OP = 'UPDATE' AND OLD.end_time IS NOT NULL AND NEW.end_time IS NULL THEN
      RAISE EXCEPTION 'Nie można ponownie otworzyć zakończonego wpisu. Uruchom nowy licznik albo popraw godziny tego wpisu.'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.start_time > now() + c_tolerance OR NEW.end_time > now() + c_tolerance THEN
      RAISE EXCEPTION 'Nie można zapisać czasu pracy w przyszłości — godzina rozpoczęcia i zakończenia nie może być późniejsza niż teraz.'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.end_time IS NULL
      AND (TG_OP = 'INSERT' OR NEW.start_time IS DISTINCT FROM OLD.start_time)
      AND NEW.start_time < now() - c_tolerance THEN
      RAISE EXCEPTION 'Licznik czasu można uruchomić tylko od bieżącej chwili (dopuszczalna różnica 5 minut). Wcześniejszą pracę dodaj jako zakończony wpis.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  -- d. Brak nakładania się wpisów jednego pracownika. Otwarty licznik trwa „do odwołania” (koniec = ∞),
  --    więc nie da się też uruchomić drugiego licznika ani dopisać pracy po starcie trwającego licznika.
  --    Blokada doradcza serializuje równoległe zapisy tego samego pracownika.
  PERFORM pg_advisory_xact_lock(hashtextextended('public.time_entries:' || NEW.employee_id::text, 0));
  SELECT te.start_time, te.end_time INTO v_conflict
  FROM public.time_entries te
  WHERE te.employee_id = NEW.employee_id
    AND te.id <> NEW.id
    AND (TG_OP = 'INSERT' OR te.id <> OLD.id)
    AND tstzrange(te.start_time, coalesce(te.end_time, 'infinity'::timestamptz), '[)')
        && tstzrange(NEW.start_time, coalesce(NEW.end_time, 'infinity'::timestamptz), '[)')
  ORDER BY te.start_time
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Wpis nakłada się na inny wpis tego pracownika (% – %). Popraw godziny tak, aby wpisy się nie pokrywały.',
      to_char(v_conflict.start_time AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'),
      coalesce(to_char(v_conflict.end_time AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI'), 'trwa')
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.guard_time_entry_rules() FROM PUBLIC, anon, authenticated;

-- Nazwa „a_…”: triggery BEFORE odpalają się alfabetycznie, więc ten działa przed default_employee_time_rate
-- (który uzupełnia stawkę przez coalesce(NEW.hourly_rate, profil) — dlatego stawkę od pracownika
-- zerujemy wcześniej) i przed z_personnel_work (który może ustawić stawkę z umowy).
DROP TRIGGER IF EXISTS a_guard_time_entry_rules ON public.time_entries;
CREATE TRIGGER a_guard_time_entry_rules
  BEFORE INSERT OR UPDATE OR DELETE ON public.time_entries
  FOR EACH ROW EXECUTE FUNCTION private.guard_time_entry_rules();

-- Informacyjnie: istniejące nakładające się wpisy (zostają, ale ich edycja wymaga usunięcia nakładki).
DO $$
DECLARE
  v_pairs integer;
  v_entries integer;
BEGIN
  SELECT count(*) INTO v_pairs
  FROM public.time_entries a
  JOIN public.time_entries b ON b.employee_id = a.employee_id AND a.id < b.id
   AND tstzrange(a.start_time, coalesce(a.end_time, 'infinity'::timestamptz), '[)')
       && tstzrange(b.start_time, coalesce(b.end_time, 'infinity'::timestamptz), '[)');
  SELECT count(DISTINCT a.id) INTO v_entries
  FROM public.time_entries a
  JOIN public.time_entries b ON b.employee_id = a.employee_id AND a.id <> b.id
   AND tstzrange(a.start_time, coalesce(a.end_time, 'infinity'::timestamptz), '[)')
       && tstzrange(b.start_time, coalesce(b.end_time, 'infinity'::timestamptz), '[)');
  IF v_pairs > 0 THEN
    RAISE NOTICE 'Istniejące nakładające się wpisy czasu pracy: % par, % wpisów (pozostawione bez zmian).', v_pairs, v_entries;
  END IF;
END $$;

-- 3. Jeden otwarty licznik na pracownika -------------------------------------------------------
DO $$
DECLARE
  v_employees integer;
BEGIN
  IF to_regclass('public.time_entries_one_open_timer_per_employee') IS NOT NULL THEN
    RETURN;
  END IF;
  SELECT count(*) INTO v_employees
  FROM (
    SELECT employee_id FROM public.time_entries
    WHERE end_time IS NULL
    GROUP BY employee_id
    HAVING count(*) > 1
  ) duplicates;
  IF v_employees > 0 THEN
    RAISE NOTICE 'Pominięto indeks time_entries_one_open_timer_per_employee: % pracowników ma więcej niż jeden otwarty licznik. Zamknij nadmiarowe liczniki i uruchom migrację ponownie.', v_employees;
  ELSE
    CREATE UNIQUE INDEX time_entries_one_open_timer_per_employee
      ON public.time_entries (employee_id)
      WHERE end_time IS NULL;
  END IF;
END $$;

COMMIT;
