-- Dostęp do kontaktów i wiadomości z formularza zgodny z uprawnieniami pracownika
-- ===============================================================================================================
-- Można uruchomić ponownie.
--
-- 1. Baza kontaktów i organizacji (crm_can_read_client_directory): samo „Wiadomości” (messages_view / manage / assign)
--    nie daje już wglądu we wszystkie kontakty i organizacje. Kontakty widzi osoba z zakresem kontaktów, klientów,
--    ofert, zapytań, umów, faktur / finansów, przetargów, zarządzania wydarzeniami albo kampanii marketingowych;
--    pozostali — tylko kontakty powiązane z ich wydarzeniami (obszar „klient”), własne i utworzone przez siebie.
-- 2. Wiadomości z formularza kontaktowego (contact_messages, contact_form_submissions): tylko administrator,
--    „Wiadomości: zarządzanie” (messages_manage), „Dostęp do formularza kontaktowego” (can_receive_contact_forms)
--    albo osoba, której przypisano wiadomość. Wcześniej wystarczało messages_view (zgłoszenia z formularza — każdy
--    pracownik). Statystyki strony WWW dostają liczby bez danych osobowych (get_contact_form_analytics).
-- 3. Stare powiadomienia „Nowa wiadomość kontaktowa” u osób bez dostępu do formularza — usunięte.

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Kontakty i organizacje
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_can_read_client_directory()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT EXISTS (SELECT 1 FROM public.employees e
    WHERE e.id = public.sales_employee_id() AND e.is_active AND NOT public.current_session_is_seller_portal()
      AND (e.role IN ('admin','manager') OR e.access_level IN ('admin','manager')
        OR coalesce(e.permissions,'{}') && ARRAY[
          'admin','contacts_view','contacts_manage','contacts_create','clients_view','clients_manage','clients_create',
          'offers_view','offers_manage','offers_create','inquiries_view','inquiries_view_own','inquiries_view_team',
          'inquiries_view_all','inquiries_view_pool','inquiries_manage','inquiries_manage_own','inquiries_manage_team',
          'inquiries_manage_all','inquiries_assign','tenders_view',
          'tenders_manage','invoices_view','invoices_manage','finances_view','finances_manage','contracts_view',
          'contracts_manage','contracts_create','events_manage','events_create','marketing_campaigns_view']));
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Formularz kontaktowy
-- ---------------------------------------------------------------------------------------------------------------
-- Ta sama reguła co w CRM (getMessages.server, unreadCounter): administrator, messages_manage albo
-- „Dostęp do formularza kontaktowego”.
CREATE OR REPLACE FUNCTION public.current_employee_has_contact_form_access()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT auth.uid() IS NOT NULL AND NOT coalesce(public.current_session_is_seller_portal(), false) AND EXISTS (
    SELECT 1 FROM public.employees e
     WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid()) AND e.is_active
       AND (e.role = 'admin' OR e.access_level = 'admin'
         OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'messages_manage']
         OR coalesce(e.can_receive_contact_forms, false)));
$$;

DROP POLICY IF EXISTS "Authorized employees can view contact messages" ON public.contact_messages;
CREATE POLICY "Authorized employees can view contact messages" ON public.contact_messages
  FOR SELECT TO authenticated
  USING (public.current_employee_has_contact_form_access()
         OR (assigned_to IS NOT NULL AND assigned_to = public.sales_employee_id()));

DROP POLICY IF EXISTS contact_form_submissions_staff_read ON public.contact_form_submissions;
CREATE POLICY contact_form_submissions_staff_read ON public.contact_form_submissions
  FOR SELECT TO authenticated
  USING (public.current_employee_has_contact_form_access());

DROP POLICY IF EXISTS contact_form_submissions_staff_update ON public.contact_form_submissions;
CREATE POLICY contact_form_submissions_staff_update ON public.contact_form_submissions
  FOR UPDATE TO authenticated
  USING (public.current_employee_has_contact_form_access())
  WITH CHECK (public.current_employee_has_contact_form_access());

-- Statystyki strony WWW (CRM „Strona” → analityka): liczba zgłoszeń według strony, kategorii i miasta — bez imion,
-- e-maili, telefonów i treści. Dostęp: panel strony WWW, kampanie marketingowe, formularz kontaktowy, administrator.
CREATE OR REPLACE FUNCTION public.get_contact_form_analytics(p_from timestamptz, p_to timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT (public.current_employee_has_contact_form_access() OR EXISTS (
       SELECT 1 FROM public.employees e
        WHERE (e.id = auth.uid() OR e.auth_user_id = auth.uid()) AND e.is_active
          AND NOT coalesce(public.current_session_is_seller_portal(), false)
          AND coalesce(e.permissions, '{}'::text[]) && ARRAY['page_view', 'page_manage', 'website_view', 'website_edit',
                'website_manage', 'marketing_campaigns_view', 'marketing_campaigns_manage'])) THEN
    RAISE EXCEPTION 'Brak dostępu do statystyk strony WWW.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('source_page', m.source_page, 'category', m.category,
                   'created_at', m.created_at) ORDER BY m.created_at)
                 FROM public.contact_messages m
                WHERE m.created_at >= p_from AND m.created_at <= p_to AND m.deleted_at IS NULL), '[]'::jsonb),
    'structured', coalesce((SELECT jsonb_agg(jsonb_build_object('source_page', s.source_page, 'city_interest', s.city_interest))
                 FROM public.contact_form_submissions s
                WHERE s.created_at >= p_from AND s.created_at <= p_to), '[]'::jsonb));
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Stare powiadomienia o wiadomościach z formularza u osób bez dostępu do formularza
-- ---------------------------------------------------------------------------------------------------------------
DELETE FROM public.notification_recipients nr
 USING public.notifications n
 WHERE n.id = nr.notification_id
   AND n.category = 'contact_form'
   AND n.related_entity_type = 'contact_messages'
   AND coalesce(n.metadata->>'kind', '') <> 'inquiry_intake'
   AND NOT EXISTS (
     SELECT 1 FROM public.employees e
      WHERE (e.id = nr.user_id OR e.auth_user_id = nr.user_id) AND e.is_active
        AND (e.role = 'admin' OR e.access_level = 'admin'
          OR coalesce(e.permissions, '{}'::text[]) && ARRAY['admin', 'messages_manage']
          OR coalesce(e.can_receive_contact_forms, false)));

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Uprawnienia
-- ---------------------------------------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.current_employee_has_contact_form_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_employee_has_contact_form_access() TO authenticated;
REVOKE ALL ON FUNCTION public.get_contact_form_analytics(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_contact_form_analytics(timestamptz, timestamptz) TO authenticated;
