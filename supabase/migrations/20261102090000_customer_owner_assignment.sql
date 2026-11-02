-- Opiekun kontaktu / organizacji: przypisanie twórcy, przekazywanie, ochrona przed przejęciem (2026-11-02).
--
-- Zasady właściciela:
--  * Nowy kontakt (i nowa organizacja) jest automatycznie przypisany do osoby, która go tworzy — każdego pracownika
--    CRM, także administratora (wcześniej tylko sprzedawcy). Jawnie wskazany opiekun przy tworzeniu zostaje.
--  * Opiekun może przekazać swój kontakt innej osobie (albo zwolnić go — bez opiekuna). Nie może zabrać kontaktu,
--    który ma innego opiekuna. Kontakt bez opiekuna pracownik może przypisać tylko sobie.
--  * Administrator zmienia każde przypisanie. Wyjątek dla kierownika zespołu sprzedaży został usunięty
--    („jedynie admin może edytować wszystkie przypisania”; dziś nikt nie ma tej funkcji).
--  * Opiekunem może być każdy aktywny pracownik CRM (bez kont portalu sprzedawcy) — skoro twórca zostaje opiekunem.
--  * Zmiana etapu relacji — bez zmian (administrator lub contacts_manage).
-- Dotyczy tabel contacts i organizations (wspólne wyzwalacze). Istniejące kontakty bez opiekuna zostają bez zmian.
-- Lista osób do wyboru w CRM: public.list_customer_owner_candidates() — ta sama reguła co w bazie.
-- Plik można bezpiecznie uruchomić ponownie.
BEGIN;

CREATE OR REPLACE FUNCTION public.employee_is_eligible_customer_owner(p_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = p_employee_id AND employee.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.sales_partner_profiles profile
        WHERE profile.portal_enabled = true AND profile.portal_auth_user_id IN (employee.id, employee.auth_user_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.set_default_customer_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RETURN NEW;
  END IF;
  IF NEW.owner_id IS NULL THEN
    -- Twórca zostaje opiekunem (każdy pracownik CRM, także administrator).
    NEW.owner_id := public.current_crm_employee_id();
  ELSIF NOT public.employee_is_eligible_customer_owner(NEW.owner_id) THEN
    RAISE EXCEPTION 'Wybrana osoba nie może być opiekunem klienta.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_customer360_responsibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_actor uuid;
  v_owner_name text;
BEGIN
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
     AND pg_trigger_depth() <= 1 AND NOT public.can_manage_customer360() THEN
    RAISE EXCEPTION 'Brak uprawnień do zmiany etapu relacji';
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND pg_trigger_depth() <= 1 AND auth.uid() IS NOT NULL THEN
    v_actor := public.current_crm_employee_id();
    IF v_actor IS NULL OR public.current_session_is_seller_portal() THEN
      RAISE EXCEPTION 'Brak uprawnień do zmiany opiekuna.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.is_customer360_admin() THEN
      IF OLD.owner_id IS NULL THEN
        IF NEW.owner_id IS DISTINCT FROM v_actor THEN
          RAISE EXCEPTION 'Klienta bez opiekuna możesz przypisać tylko sobie. Innej osobie przypisuje go administrator.'
            USING ERRCODE = '42501';
        END IF;
      ELSIF OLD.owner_id IS DISTINCT FROM v_actor THEN
        SELECT nullif(concat_ws(' ', employee.name, employee.surname), '') INTO v_owner_name
        FROM public.employees employee WHERE employee.id = OLD.owner_id;
        RAISE EXCEPTION 'Klient ma już opiekuna (%). Zmienić go może tylko obecny opiekun albo administrator.',
          coalesce(v_owner_name, 'inna osoba') USING ERRCODE = '42501';
      END IF;
    END IF;
    IF NEW.owner_id IS NOT NULL AND NOT public.employee_is_eligible_customer_owner(NEW.owner_id) THEN
      RAISE EXCEPTION 'Wybrana osoba nie może być opiekunem klienta.' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Osoby, które można wybrać jako opiekuna (ta sama reguła co wyzwalacz).
CREATE OR REPLACE FUNCTION public.list_customer_owner_candidates()
RETURNS TABLE (id uuid, name text, surname text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT employee.id, employee.name, employee.surname
  FROM public.employees employee
  WHERE public.current_crm_employee_id() IS NOT NULL AND NOT public.current_session_is_seller_portal()
    AND public.employee_is_eligible_customer_owner(employee.id)
  ORDER BY employee.surname, employee.name;
$$;
COMMENT ON FUNCTION public.list_customer_owner_candidates() IS
  'Pracownicy, których można wskazać jako opiekuna kontaktu / organizacji (aktywni, bez kont portalu sprzedawcy).';
REVOKE ALL ON FUNCTION public.list_customer_owner_candidates() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_customer_owner_candidates() TO authenticated, service_role;

COMMIT;
