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
    WHERE agenda.id = agenda_id AND public.current_employee_can_view_event(agenda.event_id)));
DROP POLICY IF EXISTS event_agenda_items_manage_by_event ON public.event_agenda_items;
CREATE POLICY event_agenda_items_manage_by_event ON public.event_agenda_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = agenda_id AND public.current_employee_can_manage_event(agenda.event_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = agenda_id AND public.current_employee_can_manage_event(agenda.event_id)));

DROP POLICY IF EXISTS event_agenda_notes_view_by_event ON public.event_agenda_notes;
CREATE POLICY event_agenda_notes_view_by_event ON public.event_agenda_notes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = agenda_id AND public.current_employee_can_view_event(agenda.event_id)));
DROP POLICY IF EXISTS event_agenda_notes_manage_by_event ON public.event_agenda_notes;
CREATE POLICY event_agenda_notes_manage_by_event ON public.event_agenda_notes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = agenda_id AND public.current_employee_can_manage_event(agenda.event_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.event_agendas agenda
    WHERE agenda.id = agenda_id AND public.current_employee_can_manage_event(agenda.event_id)));

-- Wydarzenie: opiekun sprzedaży, który nie jest autorem (np. przejął zapytanie), może je edytować.
-- Restrykcyjne polityki marek i etapu realizacji nadal obowiązują.
DROP POLICY IF EXISTS events_update_by_commercial_owner ON public.events;
CREATE POLICY events_update_by_commercial_owner ON public.events FOR UPDATE TO authenticated
  USING (public.current_employee_can_manage_event(id))
  WITH CHECK (public.current_employee_can_manage_event(id));

NOTIFY pgrst, 'reload schema';
COMMIT;
