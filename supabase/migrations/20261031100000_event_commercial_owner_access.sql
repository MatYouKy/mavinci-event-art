BEGIN;

-- Jedno źródło odpowiedzi „czy bieżący pracownik prowadzi sprzedaż tego wydarzenia”
-- i „czy może nim zarządzać”. Używane przez RLS agendy/wydarzeń, endpointy /bridge
-- oraz interfejs (rpc), żeby UI i baza podejmowały tę samą decyzję.
-- Wymaga: 20260907121000 (current_employee_can_view_event, employee_can_access_company)
-- i 20260926195000 (current_invoice_employee_id).

CREATE OR REPLACE FUNCTION public.current_employee_sells_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
    JOIN public.employees actor ON actor.id = public.current_invoice_employee_id()
    WHERE event.id = p_event_id
  ), false);
$$;

COMMENT ON FUNCTION public.current_employee_sells_event(uuid) IS
  'Opiekun sprzedaży wydarzenia: autor, właściciel zapytania, autor zaakceptowanej oferty albo opiekun sprzedawcy z portalu.';

-- Opiekun sprzedaży widzi wydarzenie, które sprzedaje (np. przejął zapytanie po autorze).
-- current_employee_can_view_event jest łatana w kilku migracjach przez pg_get_functiondef,
-- dlatego dopisujemy warunek tą samą techniką zamiast nadpisywać całą funkcję.
-- Kontrola marki (employee_can_access_company) pozostaje bez zmian.
DO $patch$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef('public.current_employee_can_view_event(uuid)'::regprocedure) INTO d;
  IF position('current_employee_sells_event' IN d) > 0 THEN RETURN; END IF;
  IF position('has_direct_access :=' IN d) = 0 THEN
    RAISE EXCEPTION 'Nieoczekiwana definicja current_employee_can_view_event — przerwano.';
  END IF;
  d := replace(d, 'has_direct_access :=',
    E'has_direct_access :=\n    public.current_employee_sells_event(event_row.id) OR');
  EXECUTE d;
END $patch$;

CREATE OR REPLACE FUNCTION public.current_employee_can_manage_event(p_event_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT coalesce((
    SELECT NOT public.current_session_is_seller_portal()
      AND public.current_employee_can_view_event(p_event_id)
      AND (
        actor.role::text = 'admin' OR actor.access_level::text = 'admin'
        OR coalesce(actor.permissions, '{}'::text[]) && ARRAY['admin', 'events_manage']::text[]
        OR public.current_employee_sells_event(p_event_id)
      )
    FROM public.employees actor
    WHERE actor.id = public.current_invoice_employee_id()
  ), false);
$$;

COMMENT ON FUNCTION public.current_employee_can_manage_event(uuid) IS
  'Zarządzanie wydarzeniem (agenda, status, dane): administrator, events_manage albo opiekun sprzedaży z dostępem do wydarzenia.';

REVOKE ALL ON FUNCTION public.current_employee_sells_event(uuid), public.current_employee_can_manage_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_sells_event(uuid), public.current_employee_can_manage_event(uuid) TO authenticated, service_role;

-- Agenda: dotychczasowe polityki sprawdzały wyłącznie employees.id = auth.uid() i events_manage.
-- Dodajemy polityki oparte o kanoniczną widoczność i zarządzanie wydarzeniem (OR z istniejącymi).
DROP POLICY IF EXISTS event_agendas_view_by_event ON public.event_agendas;
CREATE POLICY event_agendas_view_by_event ON public.event_agendas FOR SELECT TO authenticated
  USING (public.current_employee_can_view_event(event_id));
DROP POLICY IF EXISTS event_agendas_manage_by_event ON public.event_agendas;
CREATE POLICY event_agendas_manage_by_event ON public.event_agendas FOR ALL TO authenticated
  USING (public.current_employee_can_manage_event(event_id))
  WITH CHECK (public.current_employee_can_manage_event(event_id));

DROP POLICY IF EXISTS event_agenda_items_view_by_event ON public.event_agenda_items;
CREATE POLICY event_agenda_items_view_by_event ON public.event_agenda_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = event_agenda_items.agenda_id AND public.current_employee_can_view_event(agenda.event_id)));
DROP POLICY IF EXISTS event_agenda_items_manage_by_event ON public.event_agenda_items;
CREATE POLICY event_agenda_items_manage_by_event ON public.event_agenda_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = event_agenda_items.agenda_id AND public.current_employee_can_manage_event(agenda.event_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = event_agenda_items.agenda_id AND public.current_employee_can_manage_event(agenda.event_id)));

DROP POLICY IF EXISTS event_agenda_notes_view_by_event ON public.event_agenda_notes;
CREATE POLICY event_agenda_notes_view_by_event ON public.event_agenda_notes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = event_agenda_notes.agenda_id AND public.current_employee_can_view_event(agenda.event_id)));
DROP POLICY IF EXISTS event_agenda_notes_manage_by_event ON public.event_agenda_notes;
CREATE POLICY event_agenda_notes_manage_by_event ON public.event_agenda_notes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = event_agenda_notes.agenda_id AND public.current_employee_can_manage_event(agenda.event_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = event_agenda_notes.agenda_id AND public.current_employee_can_manage_event(agenda.event_id)));

-- Wydarzenie: opiekun sprzedaży, który nie jest autorem (np. przejął zapytanie), może je edytować.
-- Restrykcyjne polityki marek i etapu realizacji nadal obowiązują.
DROP POLICY IF EXISTS events_update_by_commercial_owner ON public.events;
CREATE POLICY events_update_by_commercial_owner ON public.events FOR UPDATE TO authenticated
  USING (public.current_employee_can_manage_event(id))
  WITH CHECK (public.current_employee_can_manage_event(id));

-- Zapytanie wskazuje wydarzenie, które opiekun sprzedaje — więc samo powiązanie nadaje prawa.
-- Bezpośrednio (z interfejsu/API) może je ustawić tylko autor wydarzenia, administrator
-- lub osoba z events_manage; funkcje sprzedaży ustawiają je dla wydarzeń utworzonych przez opiekuna.
CREATE OR REPLACE FUNCTION public.guard_inquiry_event_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE actor public.employees%ROWTYPE;
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true OR NEW.event_id IS NULL
    OR NEW.event_id IS NOT DISTINCT FROM OLD.event_id
    OR auth.uid() IS NULL OR auth.role() = 'service_role' OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  SELECT * INTO actor FROM public.employees WHERE id = public.current_invoice_employee_id();
  IF actor.id IS NULL THEN RETURN NEW; END IF;
  IF actor.role::text = 'admin' OR actor.access_level::text = 'admin'
    OR coalesce(actor.permissions, '{}'::text[]) && ARRAY['admin', 'events_manage']::text[]
    OR EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id
      AND e.created_by IN (actor.id, actor.auth_user_id)) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Zapytanie można powiązać tylko z własnym wydarzeniem. Cudze wydarzenie łączy autor albo osoba zarządzająca wydarzeniami.'
    USING ERRCODE = '42501';
END;
$$;
DROP TRIGGER IF EXISTS guard_inquiry_event_link ON public.tasks;
CREATE TRIGGER guard_inquiry_event_link BEFORE UPDATE OF event_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_inquiry_event_link();
REVOKE ALL ON FUNCTION public.guard_inquiry_event_link() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
