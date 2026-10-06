/*
  # Zapis danych tylko w zakresie przypisanych marek

  Polityki RESTRICTIVE nie nadają żadnych nowych praw. Ograniczają istniejące
  prawa zapisu tak, aby nie można było zmienić wydarzenia, oferty ani umowy
  należącej do nieprzypisanej marki.
*/

DROP POLICY IF EXISTS "Event inserts respect employee brand scope" ON public.events;
CREATE POLICY "Event inserts respect employee brand scope"
ON public.events AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (public.current_employee_can_access_company(events.my_company_id));

DROP POLICY IF EXISTS "Event updates respect employee brand scope" ON public.events;
CREATE POLICY "Event updates respect employee brand scope"
ON public.events AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (public.current_employee_can_access_company(events.my_company_id))
WITH CHECK (public.current_employee_can_access_company(events.my_company_id));

DROP POLICY IF EXISTS "Event deletes respect employee brand scope" ON public.events;
CREATE POLICY "Event deletes respect employee brand scope"
ON public.events AS RESTRICTIVE
FOR DELETE TO authenticated
USING (public.current_employee_can_access_company(events.my_company_id));

DROP POLICY IF EXISTS "Offer inserts respect employee brand scope" ON public.offers;
CREATE POLICY "Offer inserts respect employee brand scope"
ON public.offers AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  offers.event_id IS NULL
  OR public.current_employee_can_access_event_company(offers.event_id)
);

DROP POLICY IF EXISTS "Offer updates respect employee brand scope" ON public.offers;
CREATE POLICY "Offer updates respect employee brand scope"
ON public.offers AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  offers.event_id IS NULL
  OR public.current_employee_can_access_event_company(offers.event_id)
)
WITH CHECK (
  offers.event_id IS NULL
  OR public.current_employee_can_access_event_company(offers.event_id)
);

DROP POLICY IF EXISTS "Offer deletes respect employee brand scope" ON public.offers;
CREATE POLICY "Offer deletes respect employee brand scope"
ON public.offers AS RESTRICTIVE
FOR DELETE TO authenticated
USING (
  offers.event_id IS NULL
  OR public.current_employee_can_access_event_company(offers.event_id)
);

DROP POLICY IF EXISTS "Contract inserts respect employee brand scope" ON public.contracts;
CREATE POLICY "Contract inserts respect employee brand scope"
ON public.contracts AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK (
  contracts.event_id IS NULL
  OR public.current_employee_can_access_event_company(contracts.event_id)
);

DROP POLICY IF EXISTS "Contract updates respect employee brand scope" ON public.contracts;
CREATE POLICY "Contract updates respect employee brand scope"
ON public.contracts AS RESTRICTIVE
FOR UPDATE TO authenticated
USING (
  contracts.event_id IS NULL
  OR public.current_employee_can_access_event_company(contracts.event_id)
)
WITH CHECK (
  contracts.event_id IS NULL
  OR public.current_employee_can_access_event_company(contracts.event_id)
);

DROP POLICY IF EXISTS "Contract deletes respect employee brand scope" ON public.contracts;
CREATE POLICY "Contract deletes respect employee brand scope"
ON public.contracts AS RESTRICTIVE
FOR DELETE TO authenticated
USING (
  contracts.event_id IS NULL
  OR public.current_employee_can_access_event_company(contracts.event_id)
);
