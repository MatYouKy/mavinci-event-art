-- Wydajność RLS eventów i ofert (`docs/rls-performance.md`). Lista eventów i ofert u pracowników bez roli administratora
-- przekraczała limit 8 s na zapytanie (statement timeout → „Nie udało się pobrać danych”): polityki wywoływały dla każdego
-- wiersza łańcuch funkcji, część po kilka razy, a przy przypisaniach — dla każdego przypisania każdego eventu.
--
-- Tylko przepisania bez zmiany wyników — kto który wiersz widzi, zostaje dokładnie tak jak dotąd (sprawdzone na kopii
-- funkcji i polityk z produkcji na danych testowych, `docs/rls-performance.md`):
--  1. crm_record_id_scope_allows, crm_record_scope_allows — najpierw tani test zakresu („tylko własne” w module,
--     crm_record_scope_limited); dotąd przy każdym wierszu najpierw is_realization_manager i can_receive_warehouse_event.
--  2. crm_record_base_owned — kontakty i sprzedawcy po identyfikatorze (indeks), zamiast porównania c.id::text z każdym
--     kontaktem; identyfikator w innym zapisie niż kanoniczny i tak nie pasował do c.id::text, więc wynik się nie zmienia.
--  2a. Funkcje z warunkiem employee.id = public.sales_employee_id() (i current_invoice_employee_id, portal sprzedawcy) — bieżący
--     pracownik raz na wywołanie (podzapytanie), a nie dla każdego wiersza tabeli pracowników przy każdym wywołaniu.
--  3. current_employee_can_view_event — „bezpośredni dostęp” liczony dopiero, gdy jest potrzebny; najpierw tanie warunki
--     (autor, zaakceptowane przypisanie), potem sprzedaż eventu i własność rekordu.
--  4. Polityki eventów „Users can view events based on permissions” i „Users can view own assigned events by auth_user_id” —
--     przypisanie sprawdza rls_event_assignment_visible: jeden odczyt przypisania tego pracownika i ten sam zakres eventu,
--     który dotąd dokładało RLS employee_assignments (crm_parent_scope_event_id, portal sprzedawcy) — ale raz na event,
--     nie dla każdego przypisania każdego eventu.
--  5. Polityki z samym NOT current_session_is_seller_portal() — wywołanie jako podzapytanie (raz na zapytanie, nie na wiersz).
--  6. Oferty: crm_creator_offer_read usunięta — w całości zawiera się w crm_owned_offer_read (offers_create należy do
--     offers_view | offers_create | offers_manage, warunek własności ten sam); w crm_owned_offer_read własność liczona dopiero
--     przy uprawnieniu do ofert; portal sprzedawcy i jego identyfikator w politykach ofert — jako podzapytania.
-- Plik idempotentny — można go wykonać ponownie.

BEGIN;

-- ─── 1. Zakres „tylko własne” — najpierw tani test ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_record_id_scope_allows(p_module text, p_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_row jsonb;
BEGIN
 -- Bez „tylko własne” w module każdy rekord mieści się w zakresie — ten warunek był dotąd trzeci; kolejność nie zmienia
 -- wyniku (wszystkie trzy warunki zwracają od razu true, żaden nie zwraca NULL).
 IF NOT public.crm_record_scope_limited(p_module) THEN RETURN true; END IF;
 IF p_module='events' AND public.is_realization_manager(p_id) THEN RETURN true; END IF;
 IF p_module='events' AND public.can_receive_warehouse_event(p_id) THEN RETURN true; END IF;
 IF p_id IS NULL THEN RETURN false; END IF;
 IF p_module='events' THEN SELECT to_jsonb(e) INTO v_row FROM public.events e WHERE id=p_id;
 ELSIF p_module='offers' THEN SELECT to_jsonb(o) INTO v_row FROM public.offers o WHERE id=p_id;
 ELSIF p_module='contracts' THEN SELECT to_jsonb(c) INTO v_row FROM public.contracts c WHERE id=p_id;
 ELSE RETURN false; END IF;
 RETURN coalesce(public.crm_record_owned(p_module,v_row),false);
END;
$$;

CREATE OR REPLACE FUNCTION public.crm_record_scope_allows(p_module text, p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 -- Jak dotąd: (event — kierownik realizacji) OR (event — przyjęcie na magazyn) OR NOT „tylko własne” OR rekord własny;
 -- crm_record_scope_limited nigdy nie zwraca NULL, więc CASE daje ten sam wynik, a resztę liczy tylko przy „tylko własne”.
 SELECT CASE WHEN NOT public.crm_record_scope_limited(p_module) THEN true
   ELSE (p_module='events' AND public.is_realization_manager((p_row->>'id')::uuid))
     OR (p_module='events' AND public.can_receive_warehouse_event((p_row->>'id')::uuid))
     OR public.crm_record_owned(p_module,p_row) END;
$$;

-- ─── 2. Własność rekordu — kontakty i sprzedawcy po identyfikatorze ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.crm_record_base_owned(p_row jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 -- Identyfikatory z wiersza (tekst JSON) dopasowane do uuid tylko w zapisie kanonicznym (tak wygląda c.id::text) — jak dotąd
 -- przy porównaniu c.id::text IN (...), ale z indeksem po id zamiast przeglądania wszystkich kontaktów.
 SELECT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=(SELECT public.sales_employee_id()) AND (
 p_row->>'created_by' IN (e.id::text,e.auth_user_id::text)
 OR EXISTS(SELECT 1 FROM public.contacts c WHERE c.id IN (
   CASE WHEN p_row->>'contact_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_row->>'contact_id')::uuid END,
   CASE WHEN p_row->>'contact_person_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_row->>'contact_person_id')::uuid END,
   CASE WHEN p_row->>'client_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_row->>'client_id')::uuid END)
   AND c.owner_id=e.id)
 OR EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=(p_row->>'organization_id')::uuid AND o.owner_id=e.id)
 OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=(p_row->>'inquiry_id')::uuid AND t.is_inquiry AND t.inquiry_owner_id=e.id)
 OR EXISTS(SELECT 1 FROM public.sales_partner_profiles p JOIN public.contacts c ON c.id=p.contact_id
 WHERE p.id IN (
   CASE WHEN p_row->>'sales_partner_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_row->>'sales_partner_id')::uuid END,
   CASE WHEN p_row->>'referring_sales_partner_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p_row->>'referring_sales_partner_id')::uuid END)
   AND c.owner_id=e.id)
 ));
$$;

-- ─── 2a. Bieżący pracownik raz na wywołanie ───────────────────────────────────────────────────────────────────────────────

-- W tych funkcjach warunek employee.id = public.sales_employee_id() (i podobne) był liczony dla każdego wiersza tabeli
-- pracowników, przy każdym wywołaniu funkcji. Funkcje bieżącego pracownika są STABLE bez argumentów — w jednym zapytaniu
-- dają ten sam wynik, więc podzapytanie (SELECT …) liczy je raz. Treść funkcji poza tym bez zmian (jak na produkcji).

CREATE OR REPLACE FUNCTION public.crm_record_scope_limited(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT coalesce(bool_or(e.role <> 'admin' AND e.access_level <> 'admin' AND
 (p_module||'_own_only')=ANY(coalesce(e.permissions,'{}'))),false)
 FROM public.employees e WHERE e.id=(SELECT public.sales_employee_id());
$$;

CREATE OR REPLACE FUNCTION public.is_realization_manager(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS(SELECT 1 FROM public.event_realizations r JOIN public.employees employee ON employee.id=r.manager_id
 JOIN public.events e ON e.id=r.event_id WHERE r.event_id=p_event_id AND employee.id=(SELECT public.sales_employee_id())
 AND employee.is_active AND public.employee_can_access_company(employee.id,e.my_company_id));
$$;

CREATE OR REPLACE FUNCTION public.can_receive_warehouse_event(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS(SELECT 1 FROM public.employees employee JOIN public.events event ON event.id=p_event_id
 WHERE employee.id=(SELECT public.sales_employee_id()) AND 'equipment_manage'=ANY(coalesce(employee.permissions,'{}'))
 AND public.employee_can_access_company(employee.id,event.my_company_id)
 AND event.status::text IN ('offer_accepted','in_preparation','ready_for_live','ready_for_execution','in_progress','completed','invoiced','settled'));
$$;

CREATE OR REPLACE FUNCTION public.can_direct_realization(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT EXISTS(
 SELECT 1 FROM public.events e JOIN public.employees employee ON employee.id=(SELECT public.sales_employee_id())
 WHERE e.id=p_event_id
 AND (NOT public.crm_record_scope_limited('events') OR public.crm_record_owned('events',to_jsonb(e)))
 AND employee.is_active AND public.employee_can_access_company(employee.id,e.my_company_id)
 AND (employee.role='admin' OR employee.access_level='admin' OR e.created_by IN (employee.id,employee.auth_user_id)
 OR 'events_manage'=ANY(coalesce(employee.permissions,'{}'))));
$$;

CREATE OR REPLACE FUNCTION public.realization_operational_only(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT public.is_realization_manager(p_event_id) AND NOT public.can_direct_realization(p_event_id)
 AND NOT EXISTS(SELECT 1 FROM public.employees employee WHERE employee.id=(SELECT public.sales_employee_id())
 AND coalesce(employee.permissions,'{}') && ARRAY['offers_view','offers_create','offers_manage','finances_view','finances_manage','invoices_view','invoices_create','invoices_manage','contracts_view','contracts_manage']);
$$;

CREATE OR REPLACE FUNCTION public.event_visible_to_sales_colleague(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e JOIN public.events v ON v.id = p_event_id
     WHERE e.id = (SELECT public.sales_employee_id()) AND e.is_active AND NOT (SELECT public.current_session_is_seller_portal())
       AND coalesce(e.permissions, '{}') && ARRAY['offers_view','offers_create','offers_manage','offers_own_only',
             'inquiries_view','inquiries_view_own','inquiries_view_team','inquiries_view_all','inquiries_view_pool',
             'inquiries_manage','inquiries_manage_own','inquiries_manage_team','inquiries_manage_all','events_create']
       AND public.employee_can_access_company(e.id, v.my_company_id)
       AND v.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled'));
$$;

CREATE OR REPLACE FUNCTION public.sales_can_manage_document(p_inquiry uuid, p_event uuid, p_creator uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT (p_event IS NULL OR public.current_employee_can_access_event_company(p_event)) AND
 CASE WHEN p_inquiry IS NOT NULL THEN EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=p_inquiry AND t.is_inquiry AND t.archived_at IS NULL AND public.can_manage_inquiry(t.inquiry_owner_id,t.id))
 ELSE EXISTS(SELECT 1 FROM public.employees e WHERE e.id=(SELECT public.sales_employee_id()) AND (e.role::text='admin' OR coalesce(e.permissions,'{}') && ARRAY['admin','offers_manage','events_manage'])) END;
$$;

CREATE OR REPLACE FUNCTION public.current_employee_sells_event(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT
      event.created_by IN (actor.id, actor.auth_user_id)
      OR EXISTS (
        SELECT 1 FROM public.tasks inquiry
        WHERE inquiry.is_inquiry AND inquiry.event_id = event.id
          AND inquiry.inquiry_owner_id = actor.id
      )
      OR EXISTS (
        SELECT 1 FROM public.offers offer
        WHERE offer.event_id = event.id AND offer.status::text = 'accepted'
          AND (offer.created_by IN (actor.id, actor.auth_user_id)
            OR (offer.sales_channel = 'seller_portal' AND EXISTS (
              SELECT 1 FROM public.sales_partner_profiles partner
              JOIN public.contacts contact ON contact.id = partner.contact_id
              WHERE partner.id = offer.sales_partner_id AND contact.owner_id = actor.id)))
      )
    FROM public.events event
    JOIN public.employees actor ON actor.id = (SELECT public.current_invoice_employee_id())
    WHERE event.id = p_event_id
  ), false);
$$;

-- ─── 3. Widoczność eventu — „bezpośredni dostęp” dopiero, gdy potrzebny ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_employee_can_view_event(p_event_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  employee_row public.employees%ROWTYPE;
  event_row public.events%ROWTYPE;
  employee_permissions text[];
  visibility_stage text;
  has_direct_access boolean;
BEGIN
  IF public.can_receive_warehouse_event(p_event_id) THEN RETURN true; END IF;
  IF NOT public.crm_record_id_scope_allows('events',p_event_id) THEN RETURN false; END IF;
  SELECT * INTO employee_row
  FROM public.employees employee
  WHERE employee.id = auth.uid()
     OR employee.auth_user_id = auth.uid()
  ORDER BY (employee.id = auth.uid()) DESC
  LIMIT 1;

  IF NOT FOUND THEN RETURN false; END IF;

  SELECT * INTO event_row
  FROM public.events
  WHERE id = p_event_id;

  IF NOT FOUND THEN RETURN false; END IF;

  employee_permissions := COALESCE(employee_row.permissions, '{}'::text[]);

  IF employee_row.role = 'admin' OR 'admin' = ANY(employee_permissions) THEN
    RETURN true;
  END IF;

  -- „Bezpośredni dostęp” (autor, zaakceptowane przypisanie, sprzedaż eventu, własny rekord przy uprawnieniu do eventów) —
  -- ta sama alternatywa co dotąd, tylko tańsze warunki pierwsze i liczona dopiero, gdy wynik od niej zależy.
  -- Starsze wydarzenia bez marki pozostają dostępne tylko dla autora lub
  -- przypisanego pracownika. Nowe wydarzenia pracownika z zakresem selected
  -- muszą już wskazać markę.
  IF event_row.my_company_id IS NULL THEN
    has_direct_access :=
      event_row.created_by IN (employee_row.id, employee_row.auth_user_id)
      OR EXISTS (
        SELECT 1
        FROM public.employee_assignments assignment
        WHERE assignment.event_id = event_row.id
          AND assignment.employee_id = employee_row.id
          AND assignment.status = 'accepted'
      )
      OR public.current_employee_sells_event(event_row.id)
      OR (employee_permissions && ARRAY['events_view','events_create','events_manage']
          AND public.crm_record_owned('events',to_jsonb(event_row)));
    IF has_direct_access THEN
      RETURN true;
    END IF;
  END IF;

  IF NOT public.employee_can_access_company(employee_row.id, event_row.my_company_id) THEN
    RETURN false;
  END IF;

  IF 'events_manage' = ANY(employee_permissions)
     OR 'calendar_manage' = ANY(employee_permissions) THEN
    RETURN true;
  END IF;

  IF event_row.my_company_id IS NOT NULL THEN
    has_direct_access :=
      event_row.created_by IN (employee_row.id, employee_row.auth_user_id)
      OR EXISTS (
        SELECT 1
        FROM public.employee_assignments assignment
        WHERE assignment.event_id = event_row.id
          AND assignment.employee_id = employee_row.id
          AND assignment.status = 'accepted'
      )
      OR public.current_employee_sells_event(event_row.id)
      OR (employee_permissions && ARRAY['events_view','events_create','events_manage']
          AND public.crm_record_owned('events',to_jsonb(event_row)));
  END IF;

  IF has_direct_access THEN
    RETURN true;
  END IF;

  visibility_stage := public.event_visibility_stage(event_row.status::text);

  IF 'events_view_planning' = ANY(employee_permissions) THEN
    RETURN visibility_stage IN ('planning', 'operational', 'archive');
  END IF;

  IF 'events_view_operational' = ANY(employee_permissions)
     OR 'calendar_view_accepted_only' = ANY(employee_permissions) THEN
    RETURN visibility_stage IN ('operational', 'archive');
  END IF;

  RETURN false;
END;
$$;

-- ─── 4. Polityki eventów z przypisaniem pracownika ────────────────────────────────────────────────────────────────────────

-- Przypisanie pracownika do eventu (bez odrzuconego) tak, jak widziały je polityki eventów przez RLS employee_assignments:
-- dla zalogowanego wiersz przypisania jest widoczny (polityka „true”), gdy event mieści się w zakresie „tylko własne”
-- (crm_parent_scope_event_id) i sesja nie jest portalem sprzedawcy. Warunek zakresu zależy tylko od eventu — liczony raz.
CREATE OR REPLACE FUNCTION public.rls_event_assignment_visible(p_event_id uuid, p_employee_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.employee_assignments ea
    WHERE ea.event_id = p_event_id AND ea.employee_id = p_employee_id AND ea.status <> 'rejected'
  ) THEN
    RETURN false;
  END IF;
  RETURN (p_event_id IS NULL OR public.crm_record_id_scope_allows('events', p_event_id))
    AND NOT public.current_session_is_seller_portal();
END;
$$;
REVOKE ALL ON FUNCTION public.rls_event_assignment_visible(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rls_event_assignment_visible(uuid, uuid) TO authenticated, service_role;

ALTER POLICY "Users can view events based on permissions" ON public.events USING ((EXISTS ( SELECT 1
   FROM public.employees emp
  WHERE ((emp.id = auth.uid()) AND ((emp.role = 'admin'::text) OR ('admin'::text = ANY (emp.permissions)) OR ('events_manage'::text = ANY (emp.permissions)) OR ('calendar_manage'::text = ANY (emp.permissions)) OR ((('events_view'::text = ANY (emp.permissions)) OR ('calendar_view'::text = ANY (emp.permissions))) AND ((events.created_by = auth.uid()) OR public.rls_event_assignment_visible(events.id, auth.uid()))))))));

ALTER POLICY "Users can view own assigned events by auth_user_id" ON public.events USING ((EXISTS ( SELECT 1
   FROM public.employees emp
  WHERE ((emp.auth_user_id = auth.uid()) AND ((emp.role = 'admin'::text) OR ('admin'::text = ANY (emp.permissions)) OR ('events_manage'::text = ANY (emp.permissions)) OR ('calendar_manage'::text = ANY (emp.permissions)) OR ((('events_view'::text = ANY (emp.permissions)) OR ('calendar_view'::text = ANY (emp.permissions)) OR ('events_create'::text = ANY (emp.permissions))) AND ((events.created_by = auth.uid()) OR public.rls_event_assignment_visible(events.id, emp.id))))))));

-- ─── 5. Portal sprzedawcy — raz na zapytanie ──────────────────────────────────────────────────────────────────────────────

-- Wszystkie polityki, których cały warunek to NOT current_session_is_seller_portal() (funkcja STABLE bez argumentów — ta sama
-- wartość w całym zapytaniu): podzapytanie liczy ją raz, zamiast dla każdego wiersza.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT tablename, policyname, with_check IS NOT NULL AS has_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND qual = '(NOT current_session_is_seller_portal())'
      AND (with_check IS NULL OR with_check = '(NOT current_session_is_seller_portal())')
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I USING (NOT (SELECT public.current_session_is_seller_portal()))%s',
      p.policyname, p.tablename,
      CASE WHEN p.has_check THEN ' WITH CHECK (NOT (SELECT public.current_session_is_seller_portal()))' ELSE '' END);
  END LOOP;
END $$;

-- ─── 6. Oferty ────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Zawiera się w crm_owned_offer_read: ten sam pracownik i ta sama własność rekordu, a offers_create należy do
-- offers_view | offers_create | offers_manage — odczyt ofert się nie zmienia, odpada tylko drugie liczenie własności.
DROP POLICY IF EXISTS crm_creator_offer_read ON public.offers;

ALTER POLICY crm_owned_offer_read ON public.offers USING ((EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = (SELECT public.sales_employee_id())) AND CASE WHEN (COALESCE(e.permissions, '{}'::text[]) && ARRAY['offers_view'::text, 'offers_create'::text, 'offers_manage'::text]) THEN public.crm_record_owned('offers'::text, to_jsonb(offers.*)) ELSE false END))));

ALTER POLICY seller_portal_offer_brand_guard ON public.offers USING ((((SELECT public.current_session_is_seller_portal()) AND (sales_channel = 'seller_portal'::text) AND (sales_partner_id = (SELECT public.current_sales_partner_id()))) OR ((NOT (SELECT public.current_session_is_seller_portal())) AND ((sales_channel <> 'seller_portal'::text) OR public.current_employee_can_access_company(my_company_id)))));

ALTER POLICY seller_portal_offer_manager_scope ON public.offers USING (((sales_channel IS DISTINCT FROM 'seller_portal'::text) OR (SELECT public.current_session_is_seller_portal()) OR (event_id IS NOT NULL) OR public.seller_portal_offer_staff_visible(sales_partner_id)));

ALTER POLICY seller_portal_offers_select ON public.offers USING (((sales_channel = 'seller_portal'::text) AND (sales_partner_id = (SELECT public.current_sales_partner_id()))));

COMMIT;
