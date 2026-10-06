/*
  # Odczyt danych handlowych w zakresie marek

  Polityki są RESTRICTIVE, więc nie zastępują istniejących uprawnień modułowych.
  Dodają wyłącznie drugi warunek: oferta/umowa musi należeć do marki pracownika.
  Rekordy jeszcze niepowiązane z wydarzeniem zachowują dotychczasową widoczność.
*/

CREATE OR REPLACE FUNCTION public.current_employee_can_access_event_company(p_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT public.current_employee_can_access_company(event.my_company_id)
    FROM public.events event
    WHERE event.id = p_event_id
  ), false);
$$;

REVOKE ALL ON FUNCTION public.current_employee_can_access_event_company(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_employee_can_access_event_company(uuid)
TO authenticated, service_role;

DROP POLICY IF EXISTS "Employees see assigned brands" ON public.my_companies;
CREATE POLICY "Employees see assigned brands"
ON public.my_companies
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (public.current_employee_can_access_company(my_companies.id));

DROP POLICY IF EXISTS "Offers respect employee brand scope" ON public.offers;
CREATE POLICY "Offers respect employee brand scope"
ON public.offers
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  offers.event_id IS NULL
  OR public.current_employee_can_access_event_company(offers.event_id)
);

DROP POLICY IF EXISTS "Contracts respect employee brand scope" ON public.contracts;
CREATE POLICY "Contracts respect employee brand scope"
ON public.contracts
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  contracts.event_id IS NULL
  OR public.current_employee_can_access_event_company(contracts.event_id)
);
