-- Dostęp do finansów według działalności (2026-11-01).
--
-- Zasada właściciela: „Jeśli widzi finanse, to widzi w danym zakresie, przypisany do działalności, więc
-- dodana działalność musi określać co dla niej widzi w finansach. Nie może być takiej sytuacji, że każdy
-- zalogowany widzi finanse i tematy, które powinny być ukryte przed zwykłymi pracownikami.”
-- Fakturowanie zostaje przy administratorze; oferty, kalkulacje i finanse własnej sprzedaży należą do sprzedawcy.
--
-- 1. employees.finance_company_access = {id_działalności: poziom}. Poziomy (rosnąco):
--      none           — brak dostępu do finansów tej działalności,
--      sales          — tylko własna sprzedaż: własne faktury (utworzone przez siebie lub dotyczące sprzedanych przez
--                       siebie wydarzeń), oferty, prowizje sprzedawców pod opieką, raport własnej sprzedaży;
--                       bez banku i kosztów; nie wystawia faktur,
--      invoices       — podgląd faktur sprzedaży i kosztowych, KSeF i dokumentów zewnętrznych tej działalności; bez banku,
--      invoices_issue — jak wyżej + wystawianie i edycja faktur,
--      finance_view   — wszystkie finanse tej działalności tylko do odczytu: faktury, KSeF, dokumenty kosztowe,
--                       wyciągi i operacje bankowe, uzgadnianie, deklaracje ZUS/US, zestawienia, gotówka,
--      finance_manage — jak wyżej + import wyciągów, uzgadnianie, deklaracje, usuwanie z KSeF, ustawienia działalności.
--    Administrator ma niejawnie finance_manage we wszystkich działalnościach (nic nie zapisujemy).
--    Konto portalu sprzedawcy ma zawsze none. Zmienia wyłącznie administrator (pole chronione triggerem).
-- 2. Funkcje finance_company_level / finance_company_level_at_least / finance_company_manageable są jedynym
--    źródłem prawdy; dotychczasowe funkcje (finance_can_view, finance_can_manage, finance_company_visible,
--    invoice_finance_scope, can_*_invoice_*, get_invoice_finance_access, can_view_event_commercials …) zachowują
--    sygnatury, ale liczą wynik z poziomów. Każdy zapis „finance_can_manage() AND finance_company_visible(x)”
--    zastępuje finance_company_manageable(x) — zarządzanie działalnością A i podgląd B nie pozwala zapisać B.
-- 3. Uprawnienia globalne: finances_view / finances_manage oznaczają już tylko wartości finansowe WYDARZEŃ
--    (budżet, przychód, koszty, prowizje) wydarzeń, które pracownik widzi, w działalnościach, do których ma dostęp
--    — nigdy bank, faktury ani dokumenty działalności. invoices_view, invoices_manage, ksef_manage,
--    bank_statements_view, bank_statements_manage niczego już w bazie nie nadają (pozostałość).
-- 4. Migracja danych (reguły w sekcji 4). Kolumny finance_access_scope i invoice_company_permissions zostają,
--    ale są przestarzałe — żadna funkcja ich już nie czyta.
-- 5. Polityki RLS tabel z pieniędzmi działalności i polityki magazynu plików korzystają wyłącznie z nowych funkcji.
-- Wymaga: 20261101120000, 20261101130000, 20261101150000 (trigger zzzz_guard_employee_privileged_columns).
-- Plik można bezpiecznie uruchomić ponownie.
BEGIN;

-- 0. Warunki wstępne ----------------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('private.employee_privileged_columns()') IS NULL
     OR to_regprocedure('private.guard_employee_privileged_columns()') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migrację 20261101150000_security_hotfixes.sql.';
  END IF;
  IF to_regprocedure('private.require_finance_company(uuid,boolean)') IS NULL
     OR to_regprocedure('private.require_finance_manage_for_transaction(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw zastosuj migracje 20261101120000 i 20261101130000 (uzgadnianie i deklaracje).';
  END IF;
END $$;

-- 1. Kolumna, poziomy, walidacja ----------------------------------------------------------------------
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS finance_company_access jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_finance_company_access_object;
ALTER TABLE public.employees ADD CONSTRAINT employees_finance_company_access_object
  CHECK (jsonb_typeof(finance_company_access) = 'object');
COMMENT ON COLUMN public.employees.finance_company_access IS
  'Dostęp do finansów według działalności: {id_działalności: poziom}, poziomy: none < sales < invoices < invoices_issue < finance_view < finance_manage. Administrator ma niejawnie finance_manage wszędzie. Zmienia wyłącznie administrator.';
COMMENT ON COLUMN public.employees.finance_access_scope IS
  'PRZESTARZAŁE od 20261101170000 — zastąpione przez finance_company_access; żadna funkcja tego pola nie czyta.';
COMMENT ON COLUMN public.employees.invoice_company_permissions IS
  'PRZESTARZAŁE od 20261101170000 — zastąpione przez finance_company_access; żadna funkcja tego pola nie czyta.';

-- Ranga poziomu (NULL = brak dostępu). Nieznana nazwa to błąd programisty, nie brak dostępu.
CREATE OR REPLACE FUNCTION private.finance_level_rank(p_level text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
BEGIN
  RETURN CASE coalesce(p_level, 'none')
    WHEN 'none' THEN 0 WHEN 'sales' THEN 1 WHEN 'invoices' THEN 2 WHEN 'invoices_issue' THEN 3
    WHEN 'finance_view' THEN 4 WHEN 'finance_manage' THEN 5
    ELSE NULL END;
END $$;

CREATE OR REPLACE FUNCTION private.finance_level_require(p_level text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog AS $$
DECLARE v_rank integer := private.finance_level_rank(p_level);
BEGIN
  IF v_rank IS NULL THEN
    RAISE EXCEPTION 'Nieznany poziom dostępu do finansów: „%”. Dozwolone: none, sales, invoices, invoices_issue, finance_view, finance_manage.', p_level;
  END IF;
  RETURN v_rank;
END $$;

-- Walidacja i normalizacja: klucze to istniejące działalności, do których pracownik ma dostęp; wartości z listy;
-- wpisy „none” są usuwane. Gdy administrator zawęża dostęp do działalności, a samego pola nie zmienia,
-- wpisy działalności, do których pracownik stracił dostęp, są usuwane automatycznie.
CREATE OR REPLACE FUNCTION private.validate_employee_finance_company_access()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_key text;
  v_value jsonb;
  v_level text;
  v_clean jsonb := '{}'::jsonb;
  v_prune boolean := false;
  v_company_name text;
  v_is_admin boolean;
BEGIN
  IF NEW.finance_company_access IS NULL THEN
    NEW.finance_company_access := '{}'::jsonb;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.finance_company_access IS NOT DISTINCT FROM OLD.finance_company_access THEN
    IF ROW(NEW.role, NEW.access_level, NEW.permissions, NEW.company_access_mode, NEW.my_company_ids)
       IS NOT DISTINCT FROM ROW(OLD.role, OLD.access_level, OLD.permissions, OLD.company_access_mode, OLD.my_company_ids) THEN
      RETURN NEW;
    END IF;
    v_prune := true;
  END IF;
  IF jsonb_typeof(NEW.finance_company_access) <> 'object' THEN
    RAISE EXCEPTION 'Dostęp do finansów musi mieć postać {id_działalności: poziom}.' USING ERRCODE = '22023';
  END IF;
  v_is_admin := NEW.role::text = 'admin' OR NEW.access_level::text = 'admin'
    OR 'admin' = ANY(coalesce(NEW.permissions, '{}'::text[]));

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(NEW.finance_company_access) LOOP
    v_level := CASE WHEN jsonb_typeof(v_value) = 'string' THEN v_value #>> '{}' END;
    IF private.finance_level_rank(v_level) IS NULL THEN
      RAISE EXCEPTION 'Nieznany poziom dostępu do finansów: „%”. Dozwolone: none, sales, invoices, invoices_issue, finance_view, finance_manage.',
        coalesce(v_level, v_value::text) USING ERRCODE = '22023';
    END IF;
    v_company_name := NULL;
    IF v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT c.name INTO v_company_name FROM public.my_companies c WHERE c.id = v_key::uuid;
    END IF;
    IF v_company_name IS NULL THEN
      IF v_prune THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Nie ma działalności o identyfikatorze „%”.', v_key USING ERRCODE = '22023';
    END IF;
    IF NOT (v_is_admin OR NEW.company_access_mode = 'all'
            OR v_key::uuid = ANY(coalesce(NEW.my_company_ids, '{}'::uuid[]))) THEN
      IF v_prune THEN CONTINUE; END IF;
      RAISE EXCEPTION 'Pracownik nie ma dostępu do działalności „%”, więc nie może widzieć jej finansów. Najpierw przypisz działalność.',
        v_company_name USING ERRCODE = '22023';
    END IF;
    IF v_level <> 'none' THEN
      v_clean := v_clean || jsonb_build_object(lower(v_key), v_level);
    END IF;
  END LOOP;
  NEW.finance_company_access := v_clean;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.validate_employee_finance_company_access() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_employee_finance_company_access ON public.employees;
CREATE TRIGGER trg_validate_employee_finance_company_access
  BEFORE INSERT OR UPDATE OF finance_company_access, role, access_level, permissions, company_access_mode, my_company_ids
  ON public.employees
  FOR EACH ROW EXECUTE FUNCTION private.validate_employee_finance_company_access();

-- 2. Pole chronione: ta sama lista co w 20261101150000, plus finance_company_access ------------------
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
    'finance_company_access',
    'sales_team_id', 'is_sales_team_manager',
    -- stan konta
    'is_active', 'archived_at',
    -- publikacja danych na stronie (polityka anon „Public can view website employees”)
    -- i dostęp do zgłoszeń z formularza kontaktowego — w CRM edytuje je tylko administrator
    'show_on_website', 'can_receive_contact_forms'
  ]::text[]
$$;
REVOKE EXECUTE ON FUNCTION private.employee_privileged_columns() FROM PUBLIC, anon, authenticated;

-- 3. Funkcje poziomów ---------------------------------------------------------------------------------

-- Poziom dowolnego pracownika (powiadomienia, triggery). Niedostępna dla API.
CREATE OR REPLACE FUNCTION private.employee_finance_company_level(p_employee_id uuid, p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT CASE
      WHEN NOT coalesce(e.is_active, false) THEN 'none'
      WHEN EXISTS (SELECT 1 FROM public.sales_partner_profiles p
                   WHERE p.portal_enabled = true AND p.contact_id IS NOT NULL
                     AND p.portal_auth_user_id IN (e.id, e.auth_user_id)) THEN 'none'
      WHEN e.role::text = 'admin' OR e.access_level::text = 'admin'
        OR 'admin' = ANY(coalesce(e.permissions, '{}'::text[])) THEN 'finance_manage'
      WHEN p_company_id IS NULL THEN 'none'
      WHEN NOT EXISTS (SELECT 1 FROM public.my_companies c WHERE c.id = p_company_id) THEN 'none'
      WHEN NOT public.employee_can_access_company(e.id, p_company_id) THEN 'none'
      WHEN private.finance_level_rank(e.finance_company_access ->> p_company_id::text) IS NULL THEN 'none'
      ELSE coalesce(e.finance_company_access ->> p_company_id::text, 'none') END
    FROM public.employees e WHERE e.id = p_employee_id
  ), 'none');
$$;
REVOKE EXECUTE ON FUNCTION private.employee_finance_company_level(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Poziom zalogowanego pracownika w działalności. Konto portalu sprzedawcy: zawsze none.
CREATE OR REPLACE FUNCTION public.finance_company_level(p_company_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN 'none'
    ELSE private.employee_finance_company_level(public.current_invoice_employee_id(), p_company_id) END;
$$;

CREATE OR REPLACE FUNCTION public.finance_company_level_at_least(p_company_id uuid, p_level text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT private.finance_level_rank(public.finance_company_level(p_company_id)) >= private.finance_level_require(p_level);
$$;

CREATE OR REPLACE FUNCTION public.finance_company_manageable(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_company_level(p_company_id) = 'finance_manage';
$$;

-- Czy w co najmniej jednej działalności pracownik ma dany poziom (administrator: zawsze).
CREATE OR REPLACE FUNCTION public.finance_any_company_level_at_least(p_level text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN private.finance_level_require(p_level) = 0 THEN true
    ELSE public.invoice_finance_is_admin() AND NOT public.current_session_is_seller_portal()
      OR EXISTS (SELECT 1 FROM public.my_companies c WHERE public.finance_company_level_at_least(c.id, p_level)) END;
$$;

-- Poziom dla wiersza z działalnością albo wydarzeniem (np. gotówka wydarzenia bez wpisanej działalności).
CREATE OR REPLACE FUNCTION public.finance_event_row_at_least(p_company_id uuid, p_event_id uuid, p_level text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_company_level_at_least(
    coalesce(p_company_id, (SELECT e.my_company_id FROM public.events e WHERE e.id = p_event_id)), p_level);
$$;

-- Ścieżki plików „{id_działalności}/…” w magazynie (wyciągi bankowe).
CREATE OR REPLACE FUNCTION public.finance_storage_company_at_least(p_folder text, p_level text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(p_folder ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.finance_company_level_at_least(p_folder::uuid, p_level), false);
$$;

-- 3a. Dotychczasowe funkcje — te same sygnatury, wynik z poziomów -------------------------------------

-- 'company' — co najmniej „invoices” w jakiejkolwiek działalności (lub administrator);
-- 'sales'   — wyłącznie poziomy „sales”; 'none' — brak dostępu (polityki restrykcyjne „sales_finance_private”
-- ograniczają konta 'sales' do własnej sprzedaży, a polityki zezwalające sprawdzają działalność wiersza).
CREATE OR REPLACE FUNCTION public.invoice_finance_scope()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN 'none'
    WHEN public.invoice_finance_is_admin() THEN 'company'
    WHEN public.finance_any_company_level_at_least('invoices') THEN 'company'
    WHEN public.finance_any_company_level_at_least('sales') THEN 'sales'
    ELSE 'none' END;
$$;

CREATE OR REPLACE FUNCTION public.finance_can_view()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_any_company_level_at_least('finance_view');
$$;

CREATE OR REPLACE FUNCTION public.finance_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_any_company_level_at_least('finance_manage');
$$;

CREATE OR REPLACE FUNCTION public.finance_company_visible(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_company_level_at_least(p_company_id, 'finance_view');
$$;

-- Wystawianie faktur w co najmniej jednej działalności.
CREATE OR REPLACE FUNCTION public.can_manage_invoices()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_any_company_level_at_least('invoices_issue');
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoice_company(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_company_level_at_least(p_company_id, 'sales');
$$;

CREATE OR REPLACE FUNCTION public.can_manage_invoice_company(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.finance_company_level_at_least(p_company_id, 'invoices_issue');
$$;

-- Faktura „własna” sprzedawcy (poziom sales): utworzona przez niego albo dotycząca wydarzenia, które sprzedał
-- (wydarzenie faktury lub przypisanie w invoice_event_allocations).
CREATE OR REPLACE FUNCTION public.can_view_invoice_row(p_company_id uuid, p_created_by uuid, p_invoice_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT CASE public.finance_company_level(p_company_id)
    WHEN 'none' THEN false
    WHEN 'sales' THEN coalesce(
      EXISTS (SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
                AND p_created_by IN (e.id, e.auth_user_id))
      OR (p_invoice_id IS NOT NULL AND (
        EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice_id AND i.event_id IS NOT NULL
                  AND public.invoice_sales_event_owned(i.event_id))
        OR EXISTS (SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id = p_invoice_id
                  AND public.invoice_sales_event_owned(a.event_id)))), false)
    ELSE true END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoice_row(p_company_id uuid, p_created_by uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.can_view_invoice_row(p_company_id, p_created_by, NULL::uuid);
$$;

CREATE OR REPLACE FUNCTION public.can_view_invoice(p_invoice_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice_id
    AND public.can_view_invoice_row(i.my_company_id, i.created_by, i.id));
$$;

CREATE OR REPLACE FUNCTION public.can_manage_invoice(p_invoice_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = p_invoice_id
    AND public.can_manage_invoice_company(i.my_company_id));
$$;

-- Wydarzenie sprzedane przez zalogowanego sprzedawcę w działalności, w której ma poziom „sales”
-- (dawniej: zakres 'sales' całego konta). Treść jak dotąd, zmieniony tylko warunek zakresu.
CREATE OR REPLACE FUNCTION public.invoice_sales_event_owned(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.events event JOIN public.employees actor
      ON actor.id = public.current_invoice_employee_id()
    WHERE event.id = p_event_id AND public.finance_company_level(event.my_company_id) = 'sales'
      AND public.employee_can_access_company(actor.id, event.my_company_id)
      AND CASE WHEN event.financial_source = 'calculation' THEN EXISTS (
        SELECT 1 FROM public.event_calculations c WHERE c.id = event.accepted_calculation_id
          AND c.event_id = event.id AND c.is_accepted = true AND c.created_by IN (actor.id, actor.auth_user_id)
      ) ELSE EXISTS (
        SELECT 1 FROM public.offers o WHERE o.event_id = event.id AND o.status::text = 'accepted'
          AND (o.my_company_id IS NOT DISTINCT FROM event.my_company_id OR public.event_invoice_source_company_matches(event.id, 'offer', o.id, o.my_company_id))
          AND (CASE WHEN o.sales_channel = 'seller_portal' THEN
            EXISTS (SELECT 1 FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id = p.contact_id
              WHERE p.id = o.sales_partner_id AND c.owner_id = actor.id)
          ELSE o.created_by IN (actor.id, actor.auth_user_id) END)
      ) END);
$$;

-- Opiekun sprzedaży (dawny zakres sales_lead): konto, które ma wyłącznie poziom „sales” w co najmniej jednej
-- działalności i globalne uprawnienie do wartości finansowych wydarzeń (finances_view lub finances_manage).
-- Widzi i planuje koszty, gotówkę (odczyt) i prowizje WŁASNYCH wydarzeń; nie wystawia faktur.
CREATE OR REPLACE FUNCTION public.sales_finance_is_lead()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT NOT public.invoice_finance_is_admin() AND NOT public.current_session_is_seller_portal()
      AND coalesce(e.permissions, '{}'::text[]) && ARRAY['finances_view', 'finances_manage']::text[]
      AND EXISTS (SELECT 1 FROM public.my_companies c WHERE public.finance_company_level(c.id) = 'sales')
    FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.sales_lead_owns_event(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.sales_finance_is_lead()
    AND public.current_employee_sells_event(p_event_id)
    AND public.current_employee_can_view_event(p_event_id)
    AND coalesce((SELECT public.finance_company_level(e.my_company_id) = 'sales'
                  FROM public.events e WHERE e.id = p_event_id), false);
$$;

-- Prowizje sprzedawców pod opieką — tylko w działalnościach, w których opiekun ma co najmniej „sales”.
CREATE OR REPLACE FUNCTION public.sales_commission_visible(p_commission_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.event_commissions commission
    JOIN public.events event ON event.id = commission.event_id
    LEFT JOIN public.sales_partner_profiles profile ON profile.id = commission.sales_partner_id
    JOIN public.contacts contact ON contact.id = coalesce(profile.contact_id, commission.contact_id)
    WHERE commission.id = p_commission_id
      AND contact.owner_id = public.current_invoice_employee_id()
      AND public.finance_company_level_at_least(event.my_company_id, 'sales'));
$$;

-- Wartości handlowe wydarzenia (budżet, przychód, harmonogram płatności, płatnicy, rozliczenia zbiorcze):
-- administrator; poziom ≥ invoices w działalności wydarzenia (zmiana: ≥ invoices_issue); globalne finances_view /
-- finances_manage (zmiana: finances_manage) przy widocznym wydarzeniu w dostępnej działalności; sprzedawca, który
-- utworzył lub sprzedał wydarzenie i ma w jego działalności co najmniej „sales”.
CREATE OR REPLACE FUNCTION public.can_view_event_commercials(p_event_id uuid, p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_company uuid;
  v_created_by uuid;
  v_event_perms text[] := CASE WHEN p_manage THEN ARRAY['finances_manage']::text[]
                               ELSE ARRAY['finances_view', 'finances_manage']::text[] END;
  v_min_level text := CASE WHEN p_manage THEN 'invoices_issue' ELSE 'invoices' END;
BEGIN
  IF p_event_id IS NOT NULL AND NOT public.crm_record_id_scope_allows('events', p_event_id) THEN RETURN false; END IF;
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN RETURN false; END IF;
  SELECT * INTO v_employee FROM public.employees e
  WHERE e.id = public.current_workflow_employee_id() AND e.is_active = true;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.invoice_finance_is_admin() OR v_employee.role = 'admin' OR v_employee.access_level = 'admin' THEN RETURN true; END IF;
  IF p_event_id IS NULL THEN RETURN false; END IF;
  SELECT e.my_company_id, e.created_by INTO v_company, v_created_by FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.finance_company_level_at_least(v_company, v_min_level) THEN
    RETURN true;
  END IF;
  IF coalesce(v_employee.permissions, '{}'::text[]) && v_event_perms
     AND public.employee_can_access_company(v_employee.id, v_company)
     AND public.current_employee_can_view_event(p_event_id) THEN
    RETURN true;
  END IF;
  IF public.finance_company_level_at_least(v_company, 'sales')
     AND (v_created_by IN (v_employee.id, v_employee.auth_user_id) OR public.current_employee_sells_event(p_event_id)) THEN
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- Koszty, prowizje (rozliczenia) wydarzenia: administrator; poziom ≥ invoices (zmiana: finance_manage) w działalności
-- wydarzenia; globalne finances_view / finances_manage (zmiana: finances_manage) przy widocznym wydarzeniu
-- w dostępnej działalności. Opiekun sprzedaży ma osobne polityki (sales_lead_owns_event).
CREATE OR REPLACE FUNCTION public.event_finance_can_access(p_event_id uuid, p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_company uuid;
  v_event_perms text[] := CASE WHEN p_manage THEN ARRAY['finances_manage']::text[]
                               ELSE ARRAY['finances_view', 'finances_manage']::text[] END;
  v_min_level text := CASE WHEN p_manage THEN 'finance_manage' ELSE 'invoices' END;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN RETURN false; END IF;
  SELECT * INTO v_employee FROM public.employees e
  WHERE e.id = public.current_invoice_employee_id() AND e.is_active = true;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.invoice_finance_is_admin() THEN RETURN true; END IF;
  IF p_event_id IS NULL OR NOT public.crm_record_id_scope_allows('events', p_event_id) THEN RETURN false; END IF;
  SELECT e.my_company_id INTO v_company FROM public.events e WHERE e.id = p_event_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF public.finance_company_level_at_least(v_company, v_min_level) THEN
    RETURN true;
  END IF;
  IF coalesce(v_employee.permissions, '{}'::text[]) && v_event_perms
     AND public.employee_can_access_company(v_employee.id, v_company)
     AND public.current_employee_can_view_event(p_event_id) THEN
    RETURN true;
  END IF;
  RETURN false;
END $$;

-- Rozliczenia prowizji: bez wydarzenia — czy w ogóle wolno otworzyć rejestr; z wydarzeniem — jak koszty wydarzenia.
CREATE OR REPLACE FUNCTION public.commission_settlement_can_access(p_event_id uuid DEFAULT NULL::uuid, p_manage boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce(auth.uid() IS NOT NULL AND NOT public.current_session_is_seller_portal()
    AND CASE WHEN p_event_id IS NULL THEN
      public.finance_any_company_level_at_least(CASE WHEN p_manage THEN 'finance_manage' ELSE 'invoices' END)
      OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
        AND coalesce(e.permissions, '{}'::text[])
          && CASE WHEN p_manage THEN ARRAY['finances_manage']::text[] ELSE ARRAY['finances_view', 'finances_manage']::text[] END)
    ELSE public.event_finance_can_access(p_event_id, p_manage) END, false);
$$;

CREATE OR REPLACE FUNCTION public.get_event_finance_access(p_event_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT jsonb_build_object(
    'scope', public.invoice_finance_scope(),
    'companyLevel', coalesce((SELECT public.finance_company_level(e.my_company_id) FROM public.events e WHERE e.id = p_event_id), 'none'),
    'canViewCommercials', public.can_view_event_commercials(p_event_id, false),
    'canManageCommercials', public.can_view_event_commercials(p_event_id, true),
    'canViewCosts', public.event_finance_can_access(p_event_id, false) OR public.sales_lead_owns_event(p_event_id),
    'canManageCosts', public.event_finance_can_access(p_event_id, true) OR public.sales_lead_owns_event(p_event_id),
    'canApproveCosts', public.event_finance_can_access(p_event_id, true),
    'canPlanCommissions', public.event_finance_can_access(p_event_id, true) OR public.sales_lead_owns_event(p_event_id),
    'canApproveCommissions', public.event_finance_can_access(p_event_id, true),
    'canIssueInvoices', EXISTS (SELECT 1 FROM public.events e
      WHERE e.id = p_event_id AND public.can_manage_invoice_company(e.my_company_id))
  );
$$;

-- Dotychczasowe klucze bez zmian + poziomy według działalności i listy działalności dla ekranów finansów.
CREATE OR REPLACE FUNCTION public.get_invoice_finance_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  actor uuid := public.current_invoice_employee_id();
  scope text := public.invoice_finance_scope();
  is_lead boolean := public.sales_finance_is_lead();
  is_admin boolean := public.invoice_finance_is_admin() AND NOT public.current_session_is_seller_portal();
  levels jsonb := '{}';
  contacts jsonb := '[]'; partners jsonb := '[]'; events jsonb := '[]';
  has_sales boolean;
  event_view boolean; event_manage boolean;
BEGIN
  IF actor IS NULL OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Wymagane aktywne konto pracownika.' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(jsonb_object_agg(l.id::text, l.level), '{}') INTO levels
  FROM (SELECT c.id, public.finance_company_level(c.id) AS level FROM public.my_companies c) l
  WHERE l.level <> 'none';
  has_sales := EXISTS (SELECT 1 FROM jsonb_each_text(levels) j WHERE j.value = 'sales');
  IF has_sales THEN
    SELECT coalesce(jsonb_agg(c.id ORDER BY c.id), '[]') INTO contacts FROM public.contacts c
      WHERE c.owner_id = actor;
    SELECT coalesce(jsonb_agg(p.id ORDER BY p.id), '[]') INTO partners FROM public.sales_partner_profiles p
      JOIN public.contacts c ON c.id = p.contact_id WHERE c.owner_id = actor;
    SELECT coalesce(jsonb_agg(e.id ORDER BY e.id), '[]') INTO events FROM public.events e
      WHERE public.invoice_sales_event_owned(e.id);
  END IF;
  SELECT is_admin OR coalesce(e.permissions, '{}'::text[]) && ARRAY['finances_view', 'finances_manage']::text[],
         is_admin OR 'finances_manage' = ANY(coalesce(e.permissions, '{}'::text[]))
    INTO event_view, event_manage
  FROM public.employees e WHERE e.id = actor;
  RETURN jsonb_build_object('employeeId', actor, 'authUserId', auth.uid(), 'scope', scope,
    'tier', CASE WHEN scope = 'sales' AND is_lead THEN 'sales_lead' ELSE scope END,
    'canViewOwnInvoices', scope IN ('sales', 'company'),
    'canIssueInvoices', public.can_manage_invoices(),
    'canViewCompanyFinance', public.finance_can_view(),
    'canManageCompanyFinance', public.finance_can_manage(),
    'canPlanOwnEventCosts', scope = 'sales' AND is_lead,
    'managedSellerContactIds', contacts, 'managedSellerPartnerIds', partners, 'soldEventIds', events,
    'isAdmin', is_admin,
    'companyLevels', levels,
    'salesCompanyIds', (SELECT coalesce(jsonb_agg(j.key ORDER BY j.key), '[]') FROM jsonb_each_text(levels) j
      WHERE private.finance_level_rank(j.value) >= 1),
    'invoiceViewCompanyIds', (SELECT coalesce(jsonb_agg(j.key ORDER BY j.key), '[]') FROM jsonb_each_text(levels) j
      WHERE private.finance_level_rank(j.value) >= 2),
    'invoiceIssueCompanyIds', (SELECT coalesce(jsonb_agg(j.key ORDER BY j.key), '[]') FROM jsonb_each_text(levels) j
      WHERE private.finance_level_rank(j.value) >= 3),
    'financeViewCompanyIds', (SELECT coalesce(jsonb_agg(j.key ORDER BY j.key), '[]') FROM jsonb_each_text(levels) j
      WHERE private.finance_level_rank(j.value) >= 4),
    'financeManageCompanyIds', (SELECT coalesce(jsonb_agg(j.key ORDER BY j.key), '[]') FROM jsonb_each_text(levels) j
      WHERE private.finance_level_rank(j.value) >= 5),
    'canViewEventFinance', coalesce(event_view, false),
    'canManageEventFinance', coalesce(event_manage, false));
END $$;

-- Wynagrodzenia (stawki pracowników): administrator albo employees_manage; finances_view / finances_manage
-- (wartości wydarzeń) już ich nie odsłaniają. Pozostała treść bez zmian.
CREATE OR REPLACE FUNCTION public.compensation_can_access(manage boolean DEFAULT false, admin_only boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_scope() <> 'sales' AND coalesce(NOT public.current_session_is_seller_portal()
    AND EXISTS (SELECT 1 FROM public.employees e WHERE e.id = public.current_invoice_employee_id()
      AND (public.invoice_finance_is_admin() OR (NOT admin_only
        AND 'employees_manage' = ANY(coalesce(e.permissions, '{}'::text[]))))), false);
$$;

-- Dokumenty zewnętrzne i subskrypcje bez wskazanej działalności (tabela subscriptions nie ma my_company_id):
-- tylko administrator. Dokumenty z działalnością mają polityki według poziomu (sekcja 5).
CREATE OR REPLACE FUNCTION public.can_read_external_invoices()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_is_admin() AND NOT public.current_session_is_seller_portal();
$$;

CREATE OR REPLACE FUNCTION public.can_manage_external_invoices()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.invoice_finance_is_admin() AND NOT public.current_session_is_seller_portal();
$$;

-- Deklaracje (20261101130000): podgląd ≥ finance_view, zapis = finance_manage w działalności deklaracji.
CREATE OR REPLACE FUNCTION private.require_finance_company(p_company_id uuid, p_manage boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT (
       CASE WHEN p_manage THEN public.finance_company_manageable(p_company_id)
            ELSE public.finance_company_visible(p_company_id) END) THEN
    RAISE EXCEPTION 'Brak uprawnień do deklaracji tej firmy.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Uzgadnianie (20261101130000): zapis tylko przy finance_manage w działalności wyciągu.
CREATE OR REPLACE FUNCTION private.require_finance_manage_for_transaction(p_transaction_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_company uuid;
BEGIN
  SELECT s.my_company_id INTO v_company
  FROM public.bank_transactions bt JOIN public.bank_statements s ON s.id = bt.statement_id
  WHERE bt.id = p_transaction_id;
  IF v_company IS NULL THEN RAISE EXCEPTION 'Nie znaleziono operacji. Odśwież widok.'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.finance_company_manageable(v_company) THEN
    RAISE EXCEPTION 'Brak uprawnień do rozliczania płatności.' USING ERRCODE = '42501';
  END IF;
  RETURN v_company;
END;
$$;

-- 3b. Punktowe poprawki istniejących funkcji ----------------------------------------------------------
-- Definicje pozostają dokładnie takie jak w bazie (pg_get_functiondef), zmienia się wyłącznie podany fragment
-- kontroli uprawnień. Gdy fragmentu nie ma, a nowego też nie — migracja przerywa się (nieznana wersja funkcji).
CREATE TEMP TABLE finaccess_patches (fn text NOT NULL, ord integer NOT NULL, old_text text NOT NULL, new_text text NOT NULL)
  ON COMMIT DROP;

-- a) RPC uzgadniania i rozliczeń banku (20261101120000/20261101130000): wszędzie, gdzie zapis sprawdzał
--    „finance_can_manage() AND finance_company_visible(x)”, sprawdza teraz finance_company_manageable(x).
INSERT INTO finaccess_patches (fn, ord, old_text, new_text)
SELECT f, 1, 'public.finance_can_manage() AND public.finance_company_visible(', 'public.finance_company_manageable('
FROM unnest(ARRAY[
  'public.accept_bank_reconciliation_proposal(uuid,integer)',
  'public.clear_bank_transaction_explanation(uuid)',
  'public.confirm_bank_statement_sources(uuid,integer,integer)',
  'public.flag_bank_match_for_explanation(uuid,text)',
  'public.link_vat_account_transactions(uuid,uuid,text)',
  'public.match_bank_transaction_to_document(uuid,text,uuid,numeric,numeric,text,text[])',
  'public.reconcile_bank_month(uuid,integer,integer)',
  'public.reconcile_external_invoice_with_bank_transaction(uuid,uuid,numeric,numeric,numeric,text[])',
  'public.reconcile_paid_ksef_invoice_with_bank_transaction(uuid,uuid,numeric,numeric,text[])',
  'public.reject_bank_reconciliation_proposal(uuid)',
  'public.unmatch_bank_transaction(uuid,uuid)'
]) AS f;

-- Te funkcje mają ogólną bramkę finance_can_manage() (zarządzanie co najmniej jedną działalnością) i osobno
-- sprawdzają działalność wiersza — sprawdzenie działalności staje się sprawdzeniem zarządzania.
INSERT INTO finaccess_patches (fn, ord, old_text, new_text) VALUES
  ('public.acknowledge_accounting_document_followup(uuid,boolean,jsonb)', 1,
   'AND public.finance_company_visible(bs.my_company_id)', 'AND public.finance_company_manageable(bs.my_company_id)'),
  ('public.acknowledge_accounting_document_followup(uuid,boolean,jsonb)', 2,
   'OR public.finance_company_visible(v_company_id) IS NOT TRUE THEN', 'OR public.finance_company_manageable(v_company_id) IS NOT TRUE THEN'),
  ('public.acknowledge_accounting_document_followup(uuid,boolean,jsonb)', 3,
   'IF FOUND AND public.finance_company_visible(v_entry.my_company_id) IS NOT TRUE THEN',
   'IF FOUND AND public.finance_company_manageable(v_entry.my_company_id) IS NOT TRUE THEN'),
  ('public.auto_link_vat_account_transfers_for_period(integer,integer,uuid)', 1,
   'OR public.finance_company_visible(regular_statement.my_company_id)',
   'OR public.finance_company_manageable(regular_statement.my_company_id)'),
  ('public.claim_accounting_delivery(uuid,text,jsonb)', 1,
   'NOT public.finance_can_manage() OR NOT public.finance_company_visible(p_company_id)',
   'NOT public.finance_company_manageable(p_company_id)'),
  ('public.complete_accounting_delivery(uuid[],text,text)', 1,
   'AND public.finance_company_visible(a.my_company_id)))', 'AND public.finance_company_manageable(a.my_company_id)))'),
  ('public.reconcile_personnel_payment_with_bank_transaction(uuid,uuid,numeric,numeric,text[])', 1,
   'AND public.finance_company_visible(v_statement_company_id)', 'AND public.finance_company_manageable(v_statement_company_id)');

-- b) Raport finansowy: wcześniej każdy z finance_can_view() i dostępem do wszystkich marek widział wszystkie
--    działalności. Teraz bez ograniczeń tylko administrator; pozostali — działalności z poziomem ≥ finance_view
--    (dotyczy też liczników jakości danych: miesiące wyciągów i powiązania KSeF).
INSERT INTO finaccess_patches (fn, ord, old_text, new_text) VALUES
  ('public.get_financial_report(date,date,uuid[])', 1,
   E'  v_unrestricted := v_employee.role = ''admin''\n    OR v_employee.access_level = ''admin''\n    OR ''admin'' = ANY(v_employee.permissions)\n    OR cardinality(v_employee.my_company_ids) = 0;\n  v_allowed_companies := v_employee.my_company_ids;',
   E'  v_unrestricted := public.invoice_finance_is_admin();\n  v_allowed_companies := ARRAY(SELECT c.id FROM public.my_companies c WHERE public.finance_company_visible(c.id));'),
  ('public.get_financial_report(date,date,uuid[])', 2,
   'WHERE bs.processed=true AND make_date(',
   'WHERE bs.processed=true AND (v_unrestricted OR bs.my_company_id = ANY(v_allowed_companies)) AND make_date('),
  ('public.get_financial_report(date,date,uuid[])', 3,
   'WHERE k.invoice_id IS NOT NULL AND COALESCE(k.issue_date',
   'WHERE k.invoice_id IS NOT NULL AND (v_unrestricted OR k.my_company_id = ANY(v_allowed_companies)) AND COALESCE(k.issue_date');

-- c) Raport własnej sprzedaży: dostępny przy poziomie „sales” w co najmniej jednej działalności
--    (wydarzenia filtruje invoice_sales_event_owned — tylko działalności z poziomem „sales”).
INSERT INTO finaccess_patches (fn, ord, old_text, new_text) VALUES
  ('public.get_my_sales_financial_report(date,date,uuid[])', 1,
   'IF public.invoice_finance_scope() <> ''sales'' OR auth.uid() IS NULL THEN',
   'IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.my_companies c WHERE public.finance_company_level(c.id) = ''sales'') THEN');

-- d) Budżety faktur na liście wydarzeń: ta sama reguła co wartości handlowe wydarzenia.
INSERT INTO finaccess_patches (fn, ord, old_text, new_text) VALUES
  ('public.get_event_list_invoice_budgets(uuid[])', 1,
   'OR (public.invoice_finance_scope()=''company'' AND public.can_view_event_commercials(e.id,false)))',
   'OR public.can_view_event_commercials(e.id,false))');

-- e) Powiadomienia: odbiorcy według poziomu w działalności dokumentu (bez uprawnień globalnych i bez
--    przestarzałych invoice_company_permissions; dostęp do działalności sprawdza employee_finance_company_level).
INSERT INTO finaccess_patches (fn, ord, old_text, new_text) VALUES
  ('public.notify_finance_on_offer_accepted()', 1,
   E'      OR (coalesce(e.permissions, ''{}''::text[]) && ARRAY[''finances_manage'', ''invoices_manage'']::text[]\n        AND coalesce(e.finance_access_scope, ''inherit'') NOT IN (''sales'', ''sales_lead'')\n        AND NOT (coalesce(e.finance_access_scope, ''inherit'') = ''inherit'' AND level.slug = ''sales-specialist'')));',
   E'      OR private.finance_level_rank(private.employee_finance_company_level(e.id,\n        coalesce(NEW.my_company_id, (SELECT ev.my_company_id FROM public.events ev WHERE ev.id = NEW.event_id)))) >= 3);'),
  ('public.notify_new_received_ksef_invoice()', 1,
   E'      OR ''invoices_view'' = ANY(COALESCE(employee.permissions, ''{}''::text[]))\n      OR ''invoices_manage'' = ANY(COALESCE(employee.permissions, ''{}''::text[]))\n    )\n    AND (\n      employee.role::text = ''admin''\n      OR employee.access_level::text = ''admin''\n      OR ''admin'' = ANY(COALESCE(employee.permissions, ''{}''::text[]))\n      OR (\n        (\n          cardinality(COALESCE(employee.my_company_ids, ''{}''::uuid[])) = 0\n          OR NEW.my_company_id = ANY(COALESCE(employee.my_company_ids, ''{}''::uuid[]))\n        )\n        AND (\n          COALESCE(employee.invoice_company_permissions, ''{}''::jsonb) = ''{}''::jsonb\n          OR COALESCE(\n            employee.invoice_company_permissions -> NEW.my_company_id::text,\n            ''[]''::jsonb\n          ) ?| ARRAY[''view'', ''view_own'', ''view_all'', ''issue'', ''manage'']\n        )\n      )\n    )\n',
   E'      OR private.finance_level_rank(private.employee_finance_company_level(employee.id, NEW.my_company_id)) >= 2\n    )\n'),
  ('public.check_and_notify_invoice_payments()', 1,
   E'WHERE permissions @> ARRAY[''ksef_manage'']::text[]\nOR permissions @> ARRAY[''admin'']::text[];',
   E'WHERE permissions @> ARRAY[''admin'']::text[];');

-- f) Ustawienia do wystawiania faktur: poziom „invoices_issue” w co najmniej jednej działalności (lub administrator).
INSERT INTO finaccess_patches (fn, ord, old_text, new_text) VALUES
  ('public.get_invoice_settings_for_creation()', 1,
   E'(''finances_manage'' = ANY(permissions) OR ''invoices_manage'' = ANY(permissions))',
   E'public.can_manage_invoices()'),
  ('public.get_invoice_settings_for_creation()', 2,
   'Permission denied: requires admin role or invoices_manage/finances_manage permission',
   'Brak uprawnień: wystawianie faktur wymaga poziomu „Wystawianie faktur” w co najmniej jednej działalności');

-- g) KSeF i sprzedawca polecający: zarządzanie w działalności dokumentu / wydarzenia, nie „gdziekolwiek”.
INSERT INTO finaccess_patches (fn, ord, old_text, new_text) VALUES
  ('public.retry_local_sales_ksef(uuid)', 1,
   'NOT coalesce(public.finance_can_manage(),false)', 'NOT coalesce(public.finance_company_manageable(company),false)'),
  ('public.validate_event_referring_sales_partner()', 1,
   'ELSIF NOT coalesce(public.finance_can_manage(), false) THEN',
   'ELSIF NOT coalesce(public.finance_company_manageable(NEW.my_company_id), false) THEN');

-- h) Funkcje SECURITY DEFINER bez żadnej kontroli, dostępne nawet dla anon: usuwanie faktury i nadawanie numerów
--    faktur. Usuwanie — finance_manage w działalności faktury; numer — wystawianie faktur w działalności
--    (bez działalności: wystawianie w którejkolwiek). Klucz service_role bez zmian.
INSERT INTO finaccess_patches (fn, ord, old_text, new_text) VALUES
  ('public.delete_local_invoice_and_repair_numbering(uuid)', 1,
   E'    raise exception ''Faktura nie istnieje'';\n  end if;\n\n  select count(*)',
   E'    raise exception ''Faktura nie istnieje'';\n  end if;\n\n  IF auth.role() IS DISTINCT FROM ''service_role'' AND NOT public.finance_company_manageable(v_invoice.my_company_id) THEN\n    RAISE EXCEPTION ''Brak uprawnień do usunięcia faktury tej działalności.'' USING ERRCODE = ''42501'';\n  END IF;\n\n  select count(*)'),
  ('public.generate_invoice_number(text,uuid)', 1,
   E'  v_number text;\nBEGIN\n  IF p_my_company_id IS NOT NULL THEN',
   E'  v_number text;\nBEGIN\n  IF auth.role() IS DISTINCT FROM ''service_role'' AND NOT ((p_my_company_id IS NULL AND public.can_manage_invoices())\n       OR (p_my_company_id IS NOT NULL AND public.can_manage_invoice_company(p_my_company_id))) THEN\n    RAISE EXCEPTION ''Brak uprawnień do wystawiania faktur tej działalności.'' USING ERRCODE = ''42501'';\n  END IF;\n  IF p_my_company_id IS NOT NULL THEN'),
  ('public.generate_invoice_number(text)', 1,
   E'v_settings_id uuid;\nBEGIN\nSELECT id, current_year',
   E'v_settings_id uuid;\nBEGIN\nIF auth.role() IS DISTINCT FROM ''service_role'' AND NOT public.can_manage_invoices() THEN\n  RAISE EXCEPTION ''Brak uprawnień do wystawiania faktur.'' USING ERRCODE = ''42501'';\nEND IF;\nSELECT id, current_year');

DO $$
DECLARE
  r record;
  v_fn regprocedure;
  v_def text;
  v_new text;
BEGIN
  FOR r IN SELECT fn, array_agg(old_text ORDER BY ord) AS olds, array_agg(new_text ORDER BY ord) AS news
           FROM finaccess_patches GROUP BY fn ORDER BY fn LOOP
    v_fn := to_regprocedure(r.fn);
    IF v_fn IS NULL THEN
      RAISE EXCEPTION 'Brak funkcji % — nie można zmienić kontroli uprawnień.', r.fn;
    END IF;
    v_def := pg_get_functiondef(v_fn);
    v_new := v_def;
    FOR i IN 1 .. cardinality(r.olds) LOOP
      IF position(r.olds[i] IN r.news[i]) > 0 THEN
        RAISE EXCEPTION 'Poprawka nr % funkcji % nie jest idempotentna (nowy fragment zawiera stary).', i, r.fn;
      END IF;
      IF position(r.olds[i] IN v_new) > 0 THEN
        v_new := replace(v_new, r.olds[i], r.news[i]);
      ELSIF position(r.news[i] IN v_new) = 0 THEN
        RAISE EXCEPTION 'Funkcja % ma nieoczekiwaną treść (brak fragmentu nr %). Sprawdź ręcznie.', r.fn, i;
      END IF;
    END LOOP;
    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;

  -- Kontrola: żadna funkcja zapisu nie sprawdza już działalności przez sam podgląd.
  FOR r IN SELECT DISTINCT fn FROM finaccess_patches
           WHERE old_text LIKE '%finance_company_visible(%' LOOP
    IF pg_get_functiondef(to_regprocedure(r.fn)) LIKE '%finance_company_visible(%' THEN
      RAISE EXCEPTION 'Funkcja % nadal sprawdza finance_company_visible przy zapisie.', r.fn;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname IN ('public', 'private') AND p.prokind = 'f'
               AND pg_get_functiondef(p.oid) ~ 'finance_can_manage\(\)\s+AND\s+public\.finance_company_visible') THEN
    RAISE EXCEPTION 'Pozostała funkcja ze wzorcem „finance_can_manage() AND finance_company_visible(…)”.';
  END IF;
END $$;

-- Generator przypomnień o płatnościach nie jest wywoływany przez CRM ani pg_cron — bez dostępu z API.
REVOKE EXECUTE ON FUNCTION public.check_and_notify_invoice_payments() FROM PUBLIC, anon, authenticated;
-- Funkcje finansowe bez kontroli uprawnień wywoływane wyłącznie przez inne funkcje SECURITY DEFINER albo przez
-- serwer z kluczem service_role (bridge KSeF) — bez dostępu z API. Usuwanie faktury i numeracja: bez anon.
REVOKE EXECUTE ON FUNCTION public.finish_ksef_send_attempt_failure_atomic(uuid, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_invoice_settlement_allocations(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.import_costs_from_accepted_offer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_ksef_send_attempt_failure_atomic(uuid, text, boolean, uuid),
  public.refresh_invoice_settlement_allocations(uuid, uuid), public.import_costs_from_accepted_offer(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.delete_local_invoice_and_repair_numbering(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_invoice_number(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_invoice_number(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_local_invoice_and_repair_numbering(uuid), public.generate_invoice_number(text, uuid),
  public.generate_invoice_number(text) TO authenticated, service_role;

-- Uprawnienia funkcji pomocniczych: wywołują je polityki i CRM (zalogowani), nie anon.
DO $$
DECLARE v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.finance_company_level(uuid)', 'public.finance_company_level_at_least(uuid,text)',
    'public.finance_company_manageable(uuid)', 'public.finance_any_company_level_at_least(text)',
    'public.finance_event_row_at_least(uuid,uuid,text)', 'public.finance_storage_company_at_least(text,text)',
    'public.event_finance_can_access(uuid,boolean)', 'public.can_view_invoice_row(uuid,uuid,uuid)'
  ] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', v_sig);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION private.finance_level_rank(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION private.finance_level_require(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.finance_level_rank(text), private.finance_level_require(text) TO authenticated, service_role;

-- 4. Migracja danych ----------------------------------------------------------------------------------
-- Reguły (wykonywane tylko dla kont, które nie mają jeszcze żadnego wpisu w finance_company_access, więc
-- ponowne uruchomienie niczego nie nadpisuje):
--   * konto portalu sprzedawcy → nic; administrator → nic (ma finance_manage niejawnie);
--   * invoice_company_permissions dla każdej działalności, do której pracownik ma dostęp:
--       'manage' i globalne invoices_manage lub finances_manage  → finance_manage,
--       w przeciwnym razie 'issue' (lub 'manage') przy zakresie sprzedażowym → sales
--         (zakres sprzedażowy = finance_access_scope sales/sales_lead albo 'inherit' z rolą sales-specialist —
--          tak jak liczyła to dotychczasowa invoice_finance_scope; sprzedawca nie wystawia faktur),
--       w przeciwnym razie 'issue' (lub 'manage')                 → invoices_issue,
--       'view_all'                                                → invoices,
--       'view_own' / 'view'                                       → sales;
--   * zakres sprzedażowy bez praw do działalności                → sales w każdej dostępnej działalności;
--   * globalne uprawnienia finansowe BEZ praw do działalności (np. konto „contractor”) → brak dostępu do
--     finansów działalności (wcześniej oznaczały pełny bank wszystkich działalności).
UPDATE public.employees e
SET finance_company_access = m.access
FROM (
  SELECT e2.id, coalesce(jsonb_object_agg(c.id::text, lvl.level) FILTER (WHERE lvl.level IS NOT NULL), '{}'::jsonb) AS access
  FROM public.employees e2
  LEFT JOIN public.access_levels a ON a.id = e2.access_level_id
  CROSS JOIN public.my_companies c
  CROSS JOIN LATERAL (
    SELECT coalesce(e2.invoice_company_permissions -> c.id::text, '[]'::jsonb) AS rights,
      (coalesce(e2.finance_access_scope, 'inherit') IN ('sales', 'sales_lead')
        OR (coalesce(e2.finance_access_scope, 'inherit') = 'inherit' AND a.slug = 'sales-specialist')) AS sales_scope,
      coalesce(e2.permissions, '{}'::text[]) && ARRAY['invoices_manage', 'finances_manage']::text[] AS global_manage,
      coalesce(e2.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb AS no_company_rights
  ) x
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN x.rights ? 'manage' AND x.global_manage THEN 'finance_manage'
      WHEN x.rights ?| ARRAY['issue', 'manage'] AND x.sales_scope THEN 'sales'
      WHEN x.rights ?| ARRAY['issue', 'manage'] THEN 'invoices_issue'
      WHEN x.rights ? 'view_all' THEN 'invoices'
      WHEN x.rights ?| ARRAY['view_own', 'view'] THEN 'sales'
      WHEN x.no_company_rights AND x.sales_scope THEN 'sales'
      ELSE NULL END AS level
  ) lvl
  WHERE e2.finance_company_access = '{}'::jsonb
    AND NOT (e2.role::text = 'admin' OR e2.access_level::text = 'admin' OR 'admin' = ANY(coalesce(e2.permissions, '{}'::text[])))
    AND NOT EXISTS (SELECT 1 FROM public.sales_partner_profiles p
                    WHERE p.portal_enabled = true AND p.contact_id IS NOT NULL
                      AND p.portal_auth_user_id IN (e2.id, e2.auth_user_id))
    AND public.employee_can_access_company(e2.id, c.id)
  GROUP BY e2.id
) m
WHERE e.id = m.id AND m.access <> '{}'::jsonb;

-- Konto z rolą (poziomem dostępu) „contractor”, które ma globalne finances_view / finances_manage i ŻADNYCH praw
-- do działalności: zdejmujemy te dwa uprawnienia, bo po zmianie znaczenia odsłaniałyby wartości finansowe wydarzeń.
-- Dotyczy wyłącznie kont, których access_levels.slug = 'contractor' i invoice_company_permissions = {}.
-- Inne konta zachowują finances_view / finances_manage (teraz: tylko wartości finansowe widocznych wydarzeń).
UPDATE public.employees e
SET permissions = ARRAY(SELECT p FROM unnest(e.permissions) AS p WHERE p NOT IN ('finances_view', 'finances_manage'))
FROM public.access_levels a
WHERE a.id = e.access_level_id AND a.slug = 'contractor'
  AND coalesce(e.invoice_company_permissions, '{}'::jsonb) = '{}'::jsonb
  AND e.finance_company_access = '{}'::jsonb
  AND coalesce(e.permissions, '{}'::text[]) && ARRAY['finances_view', 'finances_manage']::text[]
  AND NOT (e.role::text = 'admin' OR e.access_level::text = 'admin' OR 'admin' = ANY(coalesce(e.permissions, '{}'::text[])));

-- 5. Polityki RLS -------------------------------------------------------------------------------------

-- Wyciągi i operacje bankowe: tylko według poziomu działalności (usunięte stare polityki bank_statements_view/manage).
DROP POLICY IF EXISTS "Bank statements manage access" ON public.bank_statements;
DROP POLICY IF EXISTS "Bank statements view access" ON public.bank_statements;
DROP POLICY IF EXISTS bank_statements_finance_read ON public.bank_statements;
DROP POLICY IF EXISTS bank_statements_finance_manage ON public.bank_statements;
CREATE POLICY bank_statements_finance_read ON public.bank_statements FOR SELECT TO authenticated
  USING (public.finance_company_visible(my_company_id));
CREATE POLICY bank_statements_finance_manage ON public.bank_statements FOR ALL TO authenticated
  USING (public.finance_company_manageable(my_company_id))
  WITH CHECK (public.finance_company_manageable(my_company_id));

DROP POLICY IF EXISTS "Bank transactions manage access" ON public.bank_transactions;
DROP POLICY IF EXISTS "Bank transactions view access" ON public.bank_transactions;
DROP POLICY IF EXISTS bank_transactions_finance_read ON public.bank_transactions;
DROP POLICY IF EXISTS bank_transactions_finance_manage ON public.bank_transactions;
CREATE POLICY bank_transactions_finance_read ON public.bank_transactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bank_statements bs
    WHERE bs.id = bank_transactions.statement_id AND public.finance_company_visible(bs.my_company_id)));
CREATE POLICY bank_transactions_finance_manage ON public.bank_transactions FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bank_statements bs
    WHERE bs.id = bank_transactions.statement_id AND public.finance_company_manageable(bs.my_company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bank_statements bs
    WHERE bs.id = bank_transactions.statement_id AND public.finance_company_manageable(bs.my_company_id)));

DROP POLICY IF EXISTS bank_transaction_supporting_documents_manage ON public.bank_transaction_supporting_documents;
CREATE POLICY bank_transaction_supporting_documents_manage ON public.bank_transaction_supporting_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bank_transactions bt JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.id = bank_transaction_supporting_documents.bank_transaction_id AND public.finance_company_manageable(bs.my_company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.bank_transactions bt JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.id = bank_transaction_supporting_documents.bank_transaction_id AND public.finance_company_manageable(bs.my_company_id)));

DROP POLICY IF EXISTS bank_counterparty_mapping_manage ON public.bank_counterparty_mapping_templates;
CREATE POLICY bank_counterparty_mapping_manage ON public.bank_counterparty_mapping_templates FOR ALL TO authenticated
  USING (my_company_id IS NOT NULL AND public.finance_company_manageable(my_company_id))
  WITH CHECK (my_company_id IS NOT NULL AND public.finance_company_manageable(my_company_id));

DROP POLICY IF EXISTS legacy_bank_matches_read ON public.legacy_bank_transaction_match_audit;
CREATE POLICY legacy_bank_matches_read ON public.legacy_bank_transaction_match_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.bank_transactions bt JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.id = legacy_bank_transaction_match_audit.bank_transaction_id AND public.finance_company_manageable(bs.my_company_id)));

DROP POLICY IF EXISTS "Bank AI reports are created by authorized staff" ON public.bank_ai_reconciliation_reports;
DROP POLICY IF EXISTS "Bank AI reports are deleted by authorized staff" ON public.bank_ai_reconciliation_reports;
DROP POLICY IF EXISTS "Bank AI reports are updated by authorized staff" ON public.bank_ai_reconciliation_reports;
DROP POLICY IF EXISTS "Bank AI reports are visible to authorized staff" ON public.bank_ai_reconciliation_reports;
CREATE POLICY "Bank AI reports are visible to authorized staff" ON public.bank_ai_reconciliation_reports FOR SELECT TO authenticated
  USING (((NOT contains_personnel_data) OR public.can_view_personnel_contracts())
    AND CASE WHEN my_company_id IS NULL THEN created_by = public.current_invoice_employee_id() AND public.finance_can_view()
             ELSE public.finance_company_visible(my_company_id) END);
CREATE POLICY "Bank AI reports are created by authorized staff" ON public.bank_ai_reconciliation_reports FOR INSERT TO authenticated
  WITH CHECK (created_by = public.current_invoice_employee_id()
    AND ((NOT contains_personnel_data) OR public.can_manage_personnel_contracts())
    AND CASE WHEN my_company_id IS NULL THEN public.finance_can_manage() ELSE public.finance_company_manageable(my_company_id) END);
CREATE POLICY "Bank AI reports are updated by authorized staff" ON public.bank_ai_reconciliation_reports FOR UPDATE TO authenticated
  USING (((NOT contains_personnel_data) OR public.can_manage_personnel_contracts())
    AND CASE WHEN my_company_id IS NULL THEN created_by = public.current_invoice_employee_id() AND public.finance_can_manage()
             ELSE public.finance_company_manageable(my_company_id) END)
  WITH CHECK (((NOT contains_personnel_data) OR public.can_manage_personnel_contracts())
    AND CASE WHEN my_company_id IS NULL THEN created_by = public.current_invoice_employee_id() AND public.finance_can_manage()
             ELSE public.finance_company_manageable(my_company_id) END);
CREATE POLICY "Bank AI reports are deleted by authorized staff" ON public.bank_ai_reconciliation_reports FOR DELETE TO authenticated
  USING (((NOT contains_personnel_data) OR public.can_manage_personnel_contracts())
    AND CASE WHEN my_company_id IS NULL THEN created_by = public.current_invoice_employee_id() AND public.finance_can_manage()
             ELSE public.finance_company_manageable(my_company_id) END);

-- Zapisy finansów działalności: finance_manage w działalności wiersza (podgląd bez zmian: ≥ finance_view).
DROP POLICY IF EXISTS accounting_month_handoffs_manage ON public.accounting_month_handoffs;
CREATE POLICY accounting_month_handoffs_manage ON public.accounting_month_handoffs FOR ALL TO authenticated
  USING (public.finance_company_manageable(my_company_id)) WITH CHECK (public.finance_company_manageable(my_company_id));
DROP POLICY IF EXISTS financial_entries_manage ON public.financial_entries;
CREATE POLICY financial_entries_manage ON public.financial_entries FOR ALL TO authenticated
  USING (public.finance_company_manageable(my_company_id)) WITH CHECK (public.finance_company_manageable(my_company_id));
DROP POLICY IF EXISTS financial_payment_review_manage ON public.financial_payment_review_issues;
CREATE POLICY financial_payment_review_manage ON public.financial_payment_review_issues FOR UPDATE TO authenticated
  USING (public.finance_company_manageable(my_company_id)) WITH CHECK (public.finance_company_manageable(my_company_id));
DROP POLICY IF EXISTS saldeo_delivery_log_manage ON public.saldeo_delivery_log;
CREATE POLICY saldeo_delivery_log_manage ON public.saldeo_delivery_log FOR ALL TO authenticated
  USING (public.finance_company_manageable(my_company_id)) WITH CHECK (public.finance_company_manageable(my_company_id));
DROP POLICY IF EXISTS ksef_invoice_payments_manage ON public.ksef_invoice_payments;
CREATE POLICY ksef_invoice_payments_manage ON public.ksef_invoice_payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.ksef_invoices ki
    WHERE ki.id = ksef_invoice_payments.ksef_invoice_id AND public.finance_company_manageable(ki.my_company_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.ksef_invoices ki
    WHERE ki.id = ksef_invoice_payments.ksef_invoice_id AND public.finance_company_manageable(ki.my_company_id)));

-- Zestawienia miesięczne (wcześniej: admin lub ksef_manage, wszystkie działalności).
DROP POLICY IF EXISTS "Admins can manage monthly summaries" ON public.monthly_financial_summaries;
DROP POLICY IF EXISTS "Admins can view monthly summaries" ON public.monthly_financial_summaries;
DROP POLICY IF EXISTS monthly_financial_summaries_read ON public.monthly_financial_summaries;
DROP POLICY IF EXISTS monthly_financial_summaries_manage ON public.monthly_financial_summaries;
CREATE POLICY monthly_financial_summaries_read ON public.monthly_financial_summaries FOR SELECT TO authenticated
  USING (public.finance_company_visible(my_company_id));
CREATE POLICY monthly_financial_summaries_manage ON public.monthly_financial_summaries FOR ALL TO authenticated
  USING (public.finance_company_manageable(my_company_id)) WITH CHECK (public.finance_company_manageable(my_company_id));

-- Dokumenty zewnętrzne (koszty): podgląd ≥ invoices, zapis finance_manage (usunięte read_/insert_/update_/
-- delete_external_invoices oparte na uprawnieniach globalnych).
DROP POLICY IF EXISTS read_external_invoices ON public.external_invoices;
DROP POLICY IF EXISTS insert_external_invoices ON public.external_invoices;
DROP POLICY IF EXISTS update_external_invoices ON public.external_invoices;
DROP POLICY IF EXISTS delete_external_invoices ON public.external_invoices;
DROP POLICY IF EXISTS external_invoices_finance_read ON public.external_invoices;
DROP POLICY IF EXISTS external_invoices_finance_manage ON public.external_invoices;
CREATE POLICY external_invoices_finance_read ON public.external_invoices FOR SELECT TO authenticated
  USING (public.finance_company_level_at_least(my_company_id, 'invoices'));
CREATE POLICY external_invoices_finance_manage ON public.external_invoices FOR ALL TO authenticated
  USING (public.finance_company_manageable(my_company_id)) WITH CHECK (public.finance_company_manageable(my_company_id));

-- KSeF: podgląd ≥ invoices; zapis faktur wystawionych ≥ invoices_issue, otrzymanych — finance_manage;
-- usuwanie finance_manage. Usunięte polityki „Admin and invoices_view/invoices_manage …”.
DROP POLICY IF EXISTS "Admin and invoices_manage can insert KSeF invoices" ON public.ksef_invoices;
DROP POLICY IF EXISTS "Admin and invoices_manage can update KSeF invoices" ON public.ksef_invoices;
DROP POLICY IF EXISTS "Admin and invoices_view can view KSeF invoices" ON public.ksef_invoices;
DROP POLICY IF EXISTS ksef_invoices_delete_finance_manage ON public.ksef_invoices;
DROP POLICY IF EXISTS ksef_invoices_finance_read ON public.ksef_invoices;
DROP POLICY IF EXISTS ksef_invoices_finance_insert ON public.ksef_invoices;
DROP POLICY IF EXISTS ksef_invoices_finance_update ON public.ksef_invoices;
CREATE POLICY ksef_invoices_finance_read ON public.ksef_invoices FOR SELECT TO authenticated
  USING (public.finance_company_level_at_least(my_company_id, 'invoices'));
CREATE POLICY ksef_invoices_finance_insert ON public.ksef_invoices FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN invoice_type::text = 'issued' THEN public.finance_company_level_at_least(my_company_id, 'invoices_issue')
                   ELSE public.finance_company_manageable(my_company_id) END);
CREATE POLICY ksef_invoices_finance_update ON public.ksef_invoices FOR UPDATE TO authenticated
  USING (CASE WHEN invoice_type::text = 'issued' THEN public.finance_company_level_at_least(my_company_id, 'invoices_issue')
              ELSE public.finance_company_manageable(my_company_id) END)
  WITH CHECK (CASE WHEN invoice_type::text = 'issued' THEN public.finance_company_level_at_least(my_company_id, 'invoices_issue')
                   ELSE public.finance_company_manageable(my_company_id) END);
CREATE POLICY ksef_invoices_delete_finance_manage ON public.ksef_invoices FOR DELETE TO authenticated
  USING (public.finance_company_manageable(my_company_id));

-- Dane dostępowe KSeF działalności: finance_manage (bez działalności — administrator).
DROP POLICY IF EXISTS "Admin and invoices_manage can insert KSeF credentials" ON public.ksef_credentials;
DROP POLICY IF EXISTS "Admin and invoices_manage can update KSeF credentials" ON public.ksef_credentials;
DROP POLICY IF EXISTS "Admin and invoices_manage can view KSeF credentials" ON public.ksef_credentials;
DROP POLICY IF EXISTS ksef_credentials_finance_read ON public.ksef_credentials;
DROP POLICY IF EXISTS ksef_credentials_finance_insert ON public.ksef_credentials;
DROP POLICY IF EXISTS ksef_credentials_finance_update ON public.ksef_credentials;
CREATE POLICY ksef_credentials_finance_read ON public.ksef_credentials FOR SELECT TO authenticated
  USING (CASE WHEN my_company_id IS NULL THEN public.invoice_finance_is_admin() ELSE public.finance_company_manageable(my_company_id) END);
CREATE POLICY ksef_credentials_finance_insert ON public.ksef_credentials FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN my_company_id IS NULL THEN public.invoice_finance_is_admin() ELSE public.finance_company_manageable(my_company_id) END);
CREATE POLICY ksef_credentials_finance_update ON public.ksef_credentials FOR UPDATE TO authenticated
  USING (CASE WHEN my_company_id IS NULL THEN public.invoice_finance_is_admin() ELSE public.finance_company_manageable(my_company_id) END)
  WITH CHECK (CASE WHEN my_company_id IS NULL THEN public.invoice_finance_is_admin() ELSE public.finance_company_manageable(my_company_id) END);

-- Dziennik synchronizacji KSeF (wcześniej: odczyt invoices_view, zapis — każdy zalogowany).
DROP POLICY IF EXISTS "Admin and invoices_view can view sync log" ON public.ksef_sync_log;
DROP POLICY IF EXISTS "System can insert sync log" ON public.ksef_sync_log;
DROP POLICY IF EXISTS ksef_sync_log_finance_read ON public.ksef_sync_log;
DROP POLICY IF EXISTS ksef_sync_log_finance_insert ON public.ksef_sync_log;
CREATE POLICY ksef_sync_log_finance_read ON public.ksef_sync_log FOR SELECT TO authenticated
  USING (CASE WHEN my_company_id IS NULL THEN public.invoice_finance_is_admin()
              ELSE public.finance_company_level_at_least(my_company_id, 'invoices') END);
CREATE POLICY ksef_sync_log_finance_insert ON public.ksef_sync_log FOR INSERT TO authenticated
  WITH CHECK (CASE WHEN my_company_id IS NULL THEN public.invoice_finance_is_admin()
                   ELSE public.finance_company_level_at_least(my_company_id, 'invoices_issue') END);

-- Faktury sprzedaży: podgląd według poziomu (sales — własne, ≥ invoices — wszystkie), wystawianie i edycja
-- ≥ invoices_issue, usuwanie finance_manage. „invoices_sales_lead_no_delete” zbędna (sprzedawca nie usuwa faktur).
DROP POLICY IF EXISTS invoices_sales_lead_no_delete ON public.invoices;
DROP POLICY IF EXISTS invoice_rows_read_canonical ON public.invoices;
DROP POLICY IF EXISTS invoice_rows_delete_canonical ON public.invoices;
DROP POLICY IF EXISTS invoices_sales_scope ON public.invoices;
CREATE POLICY invoice_rows_read_canonical ON public.invoices FOR SELECT TO authenticated
  USING (public.can_view_invoice_row(my_company_id, created_by, id));
CREATE POLICY invoice_rows_delete_canonical ON public.invoices FOR DELETE TO authenticated
  USING (public.finance_company_manageable(my_company_id));
CREATE POLICY invoices_sales_scope ON public.invoices AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.can_view_invoice_row(my_company_id, created_by, id))
  WITH CHECK (public.can_view_invoice_row(my_company_id, created_by, id));

-- Ustawienia faktur (globalne, bez działalności; wcześniej tylko finances_manage — nawet administrator nie miał dostępu).
DROP POLICY IF EXISTS "Allow read invoice_settings for finances_manage" ON public.invoice_settings;
DROP POLICY IF EXISTS "Allow update invoice_settings for finances_manage" ON public.invoice_settings;
DROP POLICY IF EXISTS invoice_settings_read ON public.invoice_settings;
DROP POLICY IF EXISTS invoice_settings_admin_update ON public.invoice_settings;
CREATE POLICY invoice_settings_read ON public.invoice_settings FOR SELECT TO authenticated
  USING (public.invoice_finance_is_admin() OR public.can_manage_invoices());
CREATE POLICY invoice_settings_admin_update ON public.invoice_settings FOR UPDATE TO authenticated
  USING (public.invoice_finance_is_admin()) WITH CHECK (public.invoice_finance_is_admin());

-- Działalności (dane firmy, rachunki bankowe, numeracja faktur): podgląd przy poziomie ≥ sales, zmiana — finance_manage,
-- dodawanie — administrator. Usunięte polityki oparte na invoices_view / invoices_manage.
DROP POLICY IF EXISTS "Admin and invoices_manage can insert companies" ON public.my_companies;
DROP POLICY IF EXISTS "Admin and invoices_manage can update companies" ON public.my_companies;
DROP POLICY IF EXISTS "Admin and invoices_manage can view companies" ON public.my_companies;
DROP POLICY IF EXISTS my_companies_finance_read ON public.my_companies;
DROP POLICY IF EXISTS my_companies_finance_update ON public.my_companies;
DROP POLICY IF EXISTS my_companies_admin_insert ON public.my_companies;
CREATE POLICY my_companies_finance_read ON public.my_companies FOR SELECT TO authenticated
  USING (public.finance_company_level_at_least(id, 'sales'));
CREATE POLICY my_companies_finance_update ON public.my_companies FOR UPDATE TO authenticated
  USING (public.finance_company_manageable(id)) WITH CHECK (public.finance_company_manageable(id));
CREATE POLICY my_companies_admin_insert ON public.my_companies FOR INSERT TO authenticated
  WITH CHECK (public.invoice_finance_is_admin());

-- Brandbook działalności: administrator albo finance_manage tej działalności (wcześniej: invoices_manage).
DO $$
DECLARE v_table text; v_kind text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['colors', 'fonts', 'logos', 'styles'] LOOP
    FOREACH v_kind IN ARRAY ARRAY['insert', 'update', 'delete'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'brandbook_' || v_table || '_' || v_kind, 'company_brandbook_' || v_table);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.finance_company_manageable(company_id))',
      'brandbook_' || v_table || '_insert', 'company_brandbook_' || v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.finance_company_manageable(company_id)) WITH CHECK (public.finance_company_manageable(company_id))',
      'brandbook_' || v_table || '_update', 'company_brandbook_' || v_table);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.finance_company_manageable(company_id))',
      'brandbook_' || v_table || '_delete', 'company_brandbook_' || v_table);
  END LOOP;
END $$;

-- Gotówka wydarzeń: poziom działalności (wiersza albo wydarzenia); opiekun sprzedaży czyta gotówkę własnych
-- wydarzeń (sales_lead_cash_read, bez zmian). Usunięte polityki „Admins can …” (admin lub finances_manage).
DROP POLICY IF EXISTS "Admins can delete cash transactions" ON public.event_cash_transactions;
DROP POLICY IF EXISTS "Admins can insert cash transactions" ON public.event_cash_transactions;
DROP POLICY IF EXISTS "Admins can update cash transactions" ON public.event_cash_transactions;
DROP POLICY IF EXISTS "Admins can view cash transactions" ON public.event_cash_transactions;
DROP POLICY IF EXISTS event_cash_finance_read ON public.event_cash_transactions;
DROP POLICY IF EXISTS event_cash_finance_insert ON public.event_cash_transactions;
DROP POLICY IF EXISTS event_cash_finance_update ON public.event_cash_transactions;
DROP POLICY IF EXISTS event_cash_finance_delete ON public.event_cash_transactions;
CREATE POLICY event_cash_finance_read ON public.event_cash_transactions FOR SELECT TO authenticated
  USING (public.finance_event_row_at_least(my_company_id, event_id, 'finance_view'));
CREATE POLICY event_cash_finance_insert ON public.event_cash_transactions FOR INSERT TO authenticated
  WITH CHECK (public.finance_event_row_at_least(my_company_id, event_id, 'finance_manage'));
CREATE POLICY event_cash_finance_update ON public.event_cash_transactions FOR UPDATE TO authenticated
  USING (public.finance_event_row_at_least(my_company_id, event_id, 'finance_manage'))
  WITH CHECK (public.finance_event_row_at_least(my_company_id, event_id, 'finance_manage'));
CREATE POLICY event_cash_finance_delete ON public.event_cash_transactions FOR DELETE TO authenticated
  USING (public.finance_event_row_at_least(my_company_id, event_id, 'finance_manage'));

-- Koszty wydarzeń: event_finance_can_access (usunięte polityki oparte na globalnym finances_manage i na samym
-- przypisaniu do wydarzenia). Polityki opiekuna sprzedaży i service_role bez zmian.
DROP POLICY IF EXISTS "Allow delete event_costs for finances_manage" ON public.event_costs;
DROP POLICY IF EXISTS "Allow insert event_costs for finances_manage" ON public.event_costs;
DROP POLICY IF EXISTS "Allow read event_costs for finances_manage or event access" ON public.event_costs;
DROP POLICY IF EXISTS "Allow update event_costs for finances_manage" ON public.event_costs;
DROP POLICY IF EXISTS event_costs_finance_read ON public.event_costs;
DROP POLICY IF EXISTS event_costs_finance_insert ON public.event_costs;
DROP POLICY IF EXISTS event_costs_finance_update ON public.event_costs;
DROP POLICY IF EXISTS event_costs_finance_delete ON public.event_costs;
CREATE POLICY event_costs_finance_read ON public.event_costs FOR SELECT TO authenticated
  USING (public.event_finance_can_access(event_id, false));
CREATE POLICY event_costs_finance_insert ON public.event_costs FOR INSERT TO authenticated
  WITH CHECK (public.event_finance_can_access(event_id, true));
CREATE POLICY event_costs_finance_update ON public.event_costs FOR UPDATE TO authenticated
  USING (public.event_finance_can_access(event_id, true)) WITH CHECK (public.event_finance_can_access(event_id, true));
CREATE POLICY event_costs_finance_delete ON public.event_costs FOR DELETE TO authenticated
  USING (public.event_finance_can_access(event_id, true));

-- Prowizje: rozliczenia według wydarzenia (usunięte event_commissions_select / event_commissions_manage).
DROP POLICY IF EXISTS event_commissions_select ON public.event_commissions;
DROP POLICY IF EXISTS event_commissions_manage ON public.event_commissions;
DROP POLICY IF EXISTS event_commissions_finance_read ON public.event_commissions;
DROP POLICY IF EXISTS event_commissions_finance_manage ON public.event_commissions;
CREATE POLICY event_commissions_finance_read ON public.event_commissions FOR SELECT TO authenticated
  USING (public.commission_settlement_can_access(event_id, false));
CREATE POLICY event_commissions_finance_manage ON public.event_commissions FOR ALL TO authenticated
  USING (public.commission_settlement_can_access(event_id, true))
  WITH CHECK (public.commission_settlement_can_access(event_id, true));

-- 6. Magazyn plików -----------------------------------------------------------------------------------
-- Wyciągi bankowe: ścieżka „{id_działalności}/…”. Usunięte: „Authenticated users can upload bank statements”
-- (każdy zalogowany) i „Finance users … bank statements files” (admin/ksef_manage/invoices_manage).
DROP POLICY IF EXISTS "Authenticated users can upload bank statements" ON storage.objects;
DROP POLICY IF EXISTS "Finance users can read bank statements files" ON storage.objects;
DROP POLICY IF EXISTS "Finance users can upload bank statements files" ON storage.objects;
DROP POLICY IF EXISTS "Finance users can delete bank statements files" ON storage.objects;
DROP POLICY IF EXISTS bank_statements_storage_read ON storage.objects;
DROP POLICY IF EXISTS bank_statements_storage_insert ON storage.objects;
DROP POLICY IF EXISTS bank_statements_storage_delete ON storage.objects;
CREATE POLICY bank_statements_storage_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'bank-statements' AND (
    public.finance_storage_company_at_least((storage.foldername(name))[1], 'finance_view')
    OR EXISTS (SELECT 1 FROM public.bank_statements s WHERE s.file_storage_path = objects.name
               AND public.finance_company_visible(s.my_company_id))));
CREATE POLICY bank_statements_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bank-statements'
    AND public.finance_storage_company_at_least((storage.foldername(name))[1], 'finance_manage'));
CREATE POLICY bank_statements_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'bank-statements' AND (
    public.finance_storage_company_at_least((storage.foldername(name))[1], 'finance_manage')
    OR EXISTS (SELECT 1 FROM public.bank_statements s WHERE s.file_storage_path = objects.name
               AND public.finance_company_manageable(s.my_company_id))));

-- Pliki dokumentów zewnętrznych: ścieżka bez działalności, więc dostęp według dokumentu, który wskazuje plik.
-- Plik jeszcze niepodpięty widzi i usuwa tylko osoba, która go wgrała (formularz dokumentu). Usunięte:
-- „Authenticated users can view/upload/delete invoice files” (każdy zalogowany).
DROP POLICY IF EXISTS "Authenticated users can view invoice files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload invoice files" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete invoice files" ON storage.objects;
DROP POLICY IF EXISTS read_external_invoice_files ON storage.objects;
DROP POLICY IF EXISTS insert_external_invoice_files ON storage.objects;
DROP POLICY IF EXISTS delete_external_invoice_files ON storage.objects;
CREATE POLICY read_external_invoice_files ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'external-invoices' AND (
    public.can_read_external_invoices()
    OR EXISTS (SELECT 1 FROM public.external_invoices x WHERE x.file_url = objects.name
               AND public.finance_company_level_at_least(x.my_company_id, 'invoices'))
    OR (owner_id = auth.uid()::text AND public.finance_can_manage()
        AND NOT EXISTS (SELECT 1 FROM public.external_invoices x WHERE x.file_url = objects.name))));
CREATE POLICY insert_external_invoice_files ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'external-invoices' AND public.finance_can_manage());
CREATE POLICY delete_external_invoice_files ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'external-invoices' AND (
    public.can_manage_external_invoices()
    OR EXISTS (SELECT 1 FROM public.external_invoices x WHERE x.file_url = objects.name
               AND public.finance_company_manageable(x.my_company_id))
    OR (owner_id = auth.uid()::text AND public.finance_can_manage()
        AND NOT EXISTS (SELECT 1 FROM public.external_invoices x WHERE x.file_url = objects.name))));

-- Dokumenty do operacji bankowych i pliki deklaracji: zapis finance_manage w działalności (podgląd bez zmian).
DROP POLICY IF EXISTS bank_supporting_documents_storage_insert ON storage.objects;
DROP POLICY IF EXISTS bank_supporting_documents_storage_delete ON storage.objects;
CREATE POLICY bank_supporting_documents_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'bank-supporting-documents' AND EXISTS (
    SELECT 1 FROM public.bank_transactions bt JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.id::text = (storage.foldername(objects.name))[2] AND bs.my_company_id::text = (storage.foldername(objects.name))[1]
      AND public.finance_company_manageable(bs.my_company_id)));
CREATE POLICY bank_supporting_documents_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'bank-supporting-documents' AND EXISTS (
    SELECT 1 FROM public.bank_transactions bt JOIN public.bank_statements bs ON bs.id = bt.statement_id
    WHERE bt.id::text = (storage.foldername(objects.name))[2] AND bs.my_company_id::text = (storage.foldername(objects.name))[1]
      AND public.finance_company_manageable(bs.my_company_id)));
DROP POLICY IF EXISTS finance_declarations_storage_insert ON storage.objects;
DROP POLICY IF EXISTS finance_declarations_storage_delete ON storage.objects;
CREATE POLICY finance_declarations_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'finance-declarations' AND EXISTS (
    SELECT 1 FROM public.finance_declarations d
    WHERE d.id::text = (storage.foldername(objects.name))[2] AND d.my_company_id::text = (storage.foldername(objects.name))[1]
      AND public.finance_company_manageable(d.my_company_id)));
CREATE POLICY finance_declarations_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'finance-declarations' AND EXISTS (
    SELECT 1 FROM public.finance_declarations d
    WHERE d.id::text = (storage.foldername(objects.name))[2] AND d.my_company_id::text = (storage.foldername(objects.name))[1]
      AND public.finance_company_manageable(d.my_company_id)));

-- 7. Kontrola końcowa: żadna polityka nie nadaje dostępu przez stare uprawnienia globalne ani przez wzorzec
--    „finance_can_manage() AND finance_company_visible(…)”.
DO $$
DECLARE v_list text;
BEGIN
  SELECT string_agg(schemaname || '.' || tablename || ' „' || policyname || '”', ', ' ORDER BY 1) INTO v_list
  FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~
        '(''(invoices_view|invoices_manage|ksef_manage|bank_statements_view|bank_statements_manage)''|finance_can_manage\(\) AND finance_company_visible)';
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Pozostały polityki oparte na starych uprawnieniach finansowych: %', v_list;
  END IF;
END $$;

COMMIT;
