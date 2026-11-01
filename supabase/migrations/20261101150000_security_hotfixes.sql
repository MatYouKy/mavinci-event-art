-- Poprawki bezpieczeństwa po audycie uprawnień (2026-11-01).
--
-- 1. employees — pracownik bez uprawnień administratora może przez API zmieniać tylko „zwykłe” pola
--    swojego profilu (imię, kontakt, adres, avatar, tło, preferencje, last_active_at, podpis itd.).
--    Pola uprawnień i przypisań konta (rola, poziom dostępu, uprawnienia, zakładki, spółki, zakres
--    finansów, zespół sprzedaży, aktywność/archiwizacja konta, widoczność na stronie, odbiór formularzy
--    kontaktowych, powiązanie z kontem logowania) zmienia wyłącznie administrator. Wcześniej polityki
--    UPDATE „własny profil” pozwalały każdemu nadać sobie np. uprawnienie 'admin'.
--    Wyjątek: trigger kadrowy (umowa zlecenia z ewidencją czasu w CRM) może dopisać pracownikowi samo
--    uprawnienie 'time_tracking_view_own' — robi to osoba z personnel_manage, niekoniecznie administrator.
--    Konta pracowników tworzy wyłącznie administrator (CRM robi to przez Edge Function create-employee
--    z kluczem service_role — tego ograniczenie nie dotyczy).
-- 2. ksef_invoices — usunięcie faktury z lokalnej bazy tylko dla osoby zarządzającej finansami
--    (finance_can_manage) i mającej dostęp do spółki faktury. Wcześniej: każdy zalogowany.
-- 3. contact_form_submissions — zgłoszenia z formularza czyta i zmienia tylko zalogowany pracownik CRM
--    (nie konto portalu sprzedawcy). Wcześniej czytać i zmieniać mógł każdy, także bez logowania.
--    Formularz na stronie nadal wysyła zgłoszenia bez logowania (polityka INSERT bez zmian; upsert
--    z ON CONFLICT (id) widzi wyłącznie wiersz, który właśnie wstawia — szczegóły w sekcji 3).
-- 4. Funkcje SECURITY DEFINER bez kontroli uprawnień — odebranie EXECUTE rolom PUBLIC/anon/authenticated
--    (wywołują je wyłącznie triggery, pg_cron albo inne funkcje SECURITY DEFINER). get_active_timer
--    i get_time_summary zostają dostępne dla zalogowanych, ale sprawdzają, czy wolno czytać czas pracy
--    wskazanego pracownika. Dodatkowo delete_employee_hard — dostępna dla anon, bez żadnej kontroli.
-- Plik można bezpiecznie uruchomić ponownie.
BEGIN;

-- 1. employees: ochrona pól uprawnień -------------------------------------------------------------

-- Lista pól, które zmienia wyłącznie administrator. Pola nieistniejące w tabeli są pomijane
-- (porównanie przez to_jsonb daje wtedy NULL = NULL).
CREATE OR REPLACE FUNCTION private.employee_privileged_columns()
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
  SELECT ARRAY[
    -- tożsamość i powiązanie z kontem logowania (employees.id = auth.uid() w wielu politykach)
    'id', 'auth_user_id',
    -- rola, poziom dostępu i uprawnienia
    'role', 'access_level', 'access_level_id', 'permissions', 'role_permissions_inherited',
    'event_tabs', 'contact_tabs', 'organization_tabs',
    -- zakres danych: spółki, faktury, finanse, zespół sprzedaży
    'my_company_ids', 'company_access_mode', 'invoice_company_permissions', 'finance_access_scope',
    'sales_team_id', 'is_sales_team_manager',
    -- stan konta
    'is_active', 'archived_at',
    -- publikacja danych na stronie (polityka anon „Public can view website employees”)
    -- i dostęp do zgłoszeń z formularza kontaktowego — w CRM edytuje je tylko administrator
    'show_on_website', 'can_receive_contact_forms'
  ]::text[]
$$;

CREATE OR REPLACE FUNCTION private.guard_employee_privileged_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_added text[];
  v_removed text[];
BEGIN
  -- Bez sesji użytkownika API (pg_cron, migracje, GoTrue, Edge Functions z kluczem service_role) — bez
  -- ograniczeń. Żądanie z rolą anon (auth.uid() = NULL) NIE jest zwolnione.
  IF coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  -- Administrator CRM. Funkcje czytają wiersz pracownika sprzed zmiany (trigger BEFORE),
  -- więc nie da się „awansować” i od razu przejść tej kontroli. Nie modyfikują employees — brak rekurencji.
  IF public.current_employee_is_crm_admin() OR public.is_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'Konto pracownika może utworzyć wyłącznie administrator.' USING ERRCODE = '42501';
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);
  SELECT array_agg(c ORDER BY c) INTO v_changed
  FROM unnest(private.employee_privileged_columns()) AS c
  WHERE v_new -> c IS DISTINCT FROM v_old -> c;

  IF v_changed IS NULL THEN
    RETURN NEW;
  END IF;

  -- Wyjątek dla triggerów kadrowych (grant_personnel_crm_time_access, grant_linked_personnel_crm_time_access):
  -- dopisanie wyłącznie 'time_tracking_view_own' wykonywane z innego triggera (pg_trigger_depth() > 1).
  -- Bezpośredni UPDATE z API ma głębokość 1, więc z tego wyjątku nie skorzysta.
  IF v_changed = ARRAY['permissions']::text[] AND pg_trigger_depth() > 1 THEN
    v_added := ARRAY(SELECT unnest(coalesce(NEW.permissions, '{}'::text[]))
                     EXCEPT SELECT unnest(coalesce(OLD.permissions, '{}'::text[])));
    v_removed := ARRAY(SELECT unnest(coalesce(OLD.permissions, '{}'::text[]))
                       EXCEPT SELECT unnest(coalesce(NEW.permissions, '{}'::text[])));
    IF cardinality(v_removed) = 0 AND v_added <@ ARRAY['time_tracking_view_own']::text[] THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION 'Tylko administrator może zmieniać uprawnienia, rolę i przypisania konta pracownika (zmienione pola: %).',
    array_to_string(v_changed, ', ')
    USING ERRCODE = '42501';
END;
$$;

REVOKE EXECUTE ON FUNCTION private.employee_privileged_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.guard_employee_privileged_columns() FROM PUBLIC, anon, authenticated;

-- Nazwa „zzzz_…”: trigger BEFORE odpala się alfabetycznie jako ostatni, więc porównuje ostateczny NEW
-- (po trg_apply_access_level_package, który przy zmianie access_level_id nadpisuje permissions/role).
DROP TRIGGER IF EXISTS zzzz_guard_employee_privileged_columns ON public.employees;
CREATE TRIGGER zzzz_guard_employee_privileged_columns
  BEFORE INSERT OR UPDATE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION private.guard_employee_privileged_columns();

-- Dodawanie kont pracowników przez API — tylko administrator (wcześniej WITH CHECK (true)).
DROP POLICY IF EXISTS "Authenticated can insert employees" ON public.employees;
DROP POLICY IF EXISTS employees_insert_admin_only ON public.employees;
CREATE POLICY employees_insert_admin_only ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (public.current_employee_is_crm_admin() OR public.is_admin(auth.uid()));

-- 2. ksef_invoices: usuwanie tylko przez osobę zarządzającą finansami spółki ------------------------
DROP POLICY IF EXISTS "Authenticated users can delete ksef invoices temporary" ON public.ksef_invoices;
DROP POLICY IF EXISTS ksef_invoices_delete_finance_manage ON public.ksef_invoices;
CREATE POLICY ksef_invoices_delete_finance_manage ON public.ksef_invoices
  FOR DELETE TO authenticated
  USING (public.finance_can_manage() AND public.finance_company_visible(my_company_id));
-- Restrykcyjna polityka ksef_sales_delete_scope (sprzedawca nie usuwa) pozostaje bez zmian.

-- 3. contact_form_submissions: odczyt i zmiana tylko dla zalogowanych pracowników -------------------
DROP POLICY IF EXISTS "Admins can view contact forms" ON public.contact_form_submissions;
DROP POLICY IF EXISTS "Admins can update contact forms" ON public.contact_form_submissions;
DROP POLICY IF EXISTS contact_form_submissions_staff_read ON public.contact_form_submissions;
DROP POLICY IF EXISTS contact_form_submissions_staff_update ON public.contact_form_submissions;
CREATE POLICY contact_form_submissions_staff_read ON public.contact_form_submissions
  FOR SELECT TO authenticated
  USING (NOT public.current_session_is_seller_portal());
CREATE POLICY contact_form_submissions_staff_update ON public.contact_form_submissions
  FOR UPDATE TO authenticated
  USING (NOT public.current_session_is_seller_portal())
  WITH CHECK (NOT public.current_session_is_seller_portal());
-- „Anyone can submit contact form” (INSERT dla public) zostaje — formularz na stronie działa bez logowania.
--
-- Formularz (ContactFormWithTracking) wysyła upsert z ignoreDuplicates, czyli
-- INSERT … ON CONFLICT (id) DO NOTHING. Przy ON CONFLICT z kolumną Postgres sprawdza nowy wiersz
-- także politykami SELECT — bez nich anonimowe zgłoszenie kończy się błędem RLS (także przy ponowieniu
-- z tym samym id). Dlatego wiersz właśnie wstawiany jest widoczny dla wstawiającego: trigger BEFORE INSERT
-- zapamiętuje jego id w zmiennej lokalnej transakcji, a polityka SELECT dopuszcza tylko ten jeden wiersz.
-- Zwykły odczyt bez logowania zwraca 0 wierszy. Gdy formularz przejdzie na zwykły .insert()
-- (duplikat = kod 23505 traktowany jak sukces), trigger i tę politykę można usunąć.
CREATE OR REPLACE FUNCTION private.mark_contact_form_submission_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM set_config('app.contact_form_submission_id', NEW.id::text, true);
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION private.mark_contact_form_submission_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_mark_contact_form_submission_insert ON public.contact_form_submissions;
CREATE TRIGGER a_mark_contact_form_submission_insert
  BEFORE INSERT ON public.contact_form_submissions
  FOR EACH ROW EXECUTE FUNCTION private.mark_contact_form_submission_insert();

DROP POLICY IF EXISTS contact_form_submissions_insert_echo ON public.contact_form_submissions;
CREATE POLICY contact_form_submissions_insert_echo ON public.contact_form_submissions
  FOR SELECT TO anon, authenticated
  USING (id::text = current_setting('app.contact_form_submission_id', true));

-- 4. Funkcje SECURITY DEFINER bez kontroli uprawnień ---------------------------------------------
DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.update_monthly_summary(integer, integer, uuid)',
    'public.recalculate_bank_transaction_match_state(uuid)',
    'public.recalculate_external_invoice_bank_payment(uuid)',
    'public.recalculate_local_invoice_bank_payment(uuid)',
    'public.employee_work_minutes_for_day(uuid, date)',
    'public.create_employee_overtime_alert(uuid, date)',
    'public.check_all_employee_overtime()',
    'public.delete_employee_hard(uuid)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE NOTICE 'Pominięto %: funkcja nie istnieje.', v_sig;
      CONTINUE;
    END IF;
    -- Wywołują je triggery / pg_cron / inne funkcje SECURITY DEFINER (właściciel postgres) — EXECUTE
    -- dla klientów API nie jest potrzebne. service_role zostaje (Edge Functions, ręczne naprawy).
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_sig);
  END LOOP;
END $$;

-- Czy bieżąca sesja może czytać czas pracy wskazanego pracownika.
-- Bez JWT (pg_cron, postgres) i service_role — tak. Zalogowany — własny czas, administrator,
-- kadry (personnel_view/personnel_manage) albo time_tracking_view/time_tracking_manage (jak polityki time_entries).
CREATE OR REPLACE FUNCTION private.can_read_employee_time(p_employee_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN coalesce(auth.role(), '') NOT IN ('anon', 'authenticated') THEN true
    WHEN auth.uid() IS NULL THEN false
    ELSE public.personnel_can_report_own_time(p_employee_id)
      OR public.current_employee_is_crm_admin()
      OR public.personnel_can_access(false)
      OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = public.current_invoice_employee_id()
          AND coalesce(e.permissions, '{}'::text[]) && ARRAY['time_tracking_view', 'time_tracking_manage']::text[]
      )
  END
$$;
REVOKE EXECUTE ON FUNCTION private.can_read_employee_time(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_active_timer(p_employee_id uuid)
RETURNS TABLE(id uuid, task_id uuid, event_id uuid, title text, description text, start_time timestamptz, tags text[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT private.can_read_employee_time(p_employee_id) THEN
    RAISE EXCEPTION 'Brak dostępu do czasu pracy tego pracownika.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT te.id, te.task_id, te.event_id, te.title, te.description, te.start_time, te.tags
  FROM public.time_entries te
  WHERE te.employee_id = p_employee_id
    AND te.end_time IS NULL
  ORDER BY te.start_time DESC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_time_summary(p_employee_id uuid, p_start_date timestamptz, p_end_date timestamptz)
RETURNS TABLE(total_minutes integer, total_hours numeric, billable_minutes integer, billable_hours numeric, entries_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT private.can_read_employee_time(p_employee_id) THEN
    RAISE EXCEPTION 'Brak dostępu do czasu pracy tego pracownika.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    COALESCE(SUM(te.duration_minutes), 0)::integer,
    ROUND(COALESCE(SUM(te.duration_minutes), 0) / 60.0, 2),
    COALESCE(SUM(CASE WHEN te.is_billable THEN te.duration_minutes ELSE 0 END), 0)::integer,
    ROUND(COALESCE(SUM(CASE WHEN te.is_billable THEN te.duration_minutes ELSE 0 END), 0) / 60.0, 2),
    COUNT(*)::integer
  FROM public.time_entries te
  WHERE te.employee_id = p_employee_id
    AND te.start_time >= p_start_date
    AND te.start_time < p_end_date
    AND te.end_time IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_active_timer(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_time_summary(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_active_timer(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_time_summary(uuid, timestamptz, timestamptz) TO authenticated, service_role;

COMMIT;
