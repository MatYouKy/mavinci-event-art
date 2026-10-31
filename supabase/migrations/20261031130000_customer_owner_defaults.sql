BEGIN;

-- 1. Opiekun klienta jest ustawiany automatycznie przy dodaniu kontaktu lub organizacji
--    przez osobę ze sprzedaży. Od opiekuna zależą: widoczność sprzedawców zewnętrznych,
--    prowizje i raport „Moja sprzedaż”, więc rekord bez opiekuna „znika” ze sprzedaży.
-- 2. Tożsamość pracownika: id lub auth_user_id (jak w nowszych funkcjach), nie tylko id = auth.uid().
-- 3. Przejęcie cudzego klienta wymaga administratora albo kierownika zespołu sprzedaży.

CREATE OR REPLACE FUNCTION public.current_crm_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT public.current_invoice_employee_id();
$$;
COMMENT ON FUNCTION public.current_crm_employee_id() IS
  'Kanoniczny identyfikator pracownika bieżącej sesji (id albo auth_user_id, aktywny, jednoznaczny). Używaj w nowych funkcjach.';

CREATE OR REPLACE FUNCTION public.can_manage_customer360()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = public.current_crm_employee_id()
      AND employee.is_active = true
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR coalesce(employee.permissions, '{}'::text[]) && ARRAY['admin', 'contacts_manage']::text[]
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_customer360_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    WHERE employee.id = public.current_crm_employee_id()
      AND employee.is_active = true
      AND (employee.role = 'admin' OR employee.access_level = 'admin'
        OR 'admin' = ANY(coalesce(employee.permissions, '{}'::text[])))
  );
$$;

-- Ta sama lista co src/components/crm/contacts/ownerEligibility.ts.
CREATE OR REPLACE FUNCTION public.employee_is_eligible_customer_owner(p_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    LEFT JOIN public.access_levels level ON level.id = employee.access_level_id
    WHERE employee.id = p_employee_id AND employee.is_active = true
      AND (employee.role::text IN ('sales', 'manager', 'admin')
        OR employee.access_level::text IN ('sales', 'manager', 'admin')
        OR level.slug IN ('sales-specialist', 'manager', 'event-manager', 'operations-director', 'admin', 'company-admin'))
  );
$$;

CREATE OR REPLACE FUNCTION public.set_default_customer_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid;
BEGIN
  IF NEW.owner_id IS NOT NULL OR auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RETURN NEW;
  END IF;
  actor := public.current_crm_employee_id();
  IF actor IS NOT NULL AND public.employee_is_eligible_customer_owner(actor) THEN
    NEW.owner_id := actor;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_default_owner ON public.contacts;
CREATE TRIGGER contacts_default_owner BEFORE INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_default_customer_owner();
DROP TRIGGER IF EXISTS organizations_default_owner ON public.organizations;
CREATE TRIGGER organizations_default_owner BEFORE INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_default_customer_owner();

-- Ta sama reguła co w 20260824010000, plus: zwykły sprzedawca może przejąć klienta bez opiekuna
-- albo przekazać własnego; przejęcie cudzego — administrator lub kierownik zespołu tego opiekuna.
CREATE OR REPLACE FUNCTION public.protect_customer360_responsibility()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor public.employees%ROWTYPE;
BEGIN
  IF (
    NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
  ) AND pg_trigger_depth() <= 1 AND NOT public.can_manage_customer360() THEN
    RAISE EXCEPTION 'Brak uprawnień do zmiany opiekuna lub etapu relacji';
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id AND pg_trigger_depth() <= 1
    AND auth.uid() IS NOT NULL AND OLD.owner_id IS NOT NULL AND NOT public.is_customer360_admin() THEN
    SELECT * INTO actor FROM public.employees WHERE id = public.current_crm_employee_id();
    IF NOT (
      OLD.owner_id = actor.id
      OR (actor.is_sales_team_manager AND actor.sales_team_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.employees previous_owner
        WHERE previous_owner.id = OLD.owner_id AND previous_owner.sales_team_id = actor.sales_team_id))
    ) THEN
      RAISE EXCEPTION 'Klient ma już opiekuna. Przekazanie zleca administrator lub kierownik zespołu.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.owner_id IS NOT NULL AND NEW.owner_id IS DISTINCT FROM OLD.owner_id AND pg_trigger_depth() <= 1
    AND auth.uid() IS NOT NULL AND NOT public.employee_is_eligible_customer_owner(NEW.owner_id) THEN
    RAISE EXCEPTION 'Wybrana osoba nie może być opiekunem klienta.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.current_crm_employee_id(), public.employee_is_eligible_customer_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_crm_employee_id(), public.employee_is_eligible_customer_owner(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_default_customer_owner() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
