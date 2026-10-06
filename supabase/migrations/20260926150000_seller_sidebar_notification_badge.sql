BEGIN;

-- Sidebar badge only: actual unread deliveries, not all pending reviews or
-- conversation history. No changes to inbox, offer or notification RLS.
-- Existing employee preference: notifications.sellerSidebarScope, default mine.
CREATE OR REPLACE FUNCTION public.get_seller_sidebar_badge()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_admin boolean;
  v_scope text := 'mine';
  v_count bigint := 0;
BEGIN
  IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN
    RETURN jsonb_build_object('count',0,'scope','mine','employee_id',NULL,'can_choose_scope',false);
  END IF;
  SELECT * INTO v_employee FROM public.employees WHERE id=public.current_employee_id() AND is_active=true;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('count',0,'scope','mine','employee_id',NULL,'can_choose_scope',false);
  END IF;
  v_admin:=COALESCE(v_employee.role::text='admin' OR v_employee.access_level::text='admin'
    OR 'admin'=ANY(COALESCE(v_employee.permissions,'{}'::text[])),false);
  IF NOT v_admin AND NOT (COALESCE(v_employee.permissions,'{}'::text[])
    && ARRAY['contacts_view','contacts_manage','finances_view','finances_manage']) THEN
    RETURN jsonb_build_object('count',0,'scope','mine','employee_id',v_employee.id,'can_choose_scope',false);
  END IF;
  -- A hand-written preference cannot grant a non-admin the global count.
  IF v_admin AND v_employee.preferences #>> '{notifications,sellerSidebarScope}' = 'all' THEN
    v_scope:='all';
  END IF;

  WITH incoming AS (
    SELECT n.id,COALESCE(o.my_company_id,conversation.my_company_id) AS company_id
    FROM public.notifications n
    LEFT JOIN public.offers o ON o.id::text=n.related_entity_id::text AND o.sales_channel='seller_portal'
      AND (n.metadata->>'workflow'='seller_offer'
        OR (n.metadata->>'workflow' IS NULL
          AND n.title IN ('Zapytanie sprzedawcy: termin i zasoby','Wygenerowano ofertę sprzedawcy')))
    LEFT JOIN public.seller_messages message ON message.id::text=n.related_entity_id::text
      AND n.metadata->>'workflow'='seller_chat' AND message.sender_kind='seller'
    LEFT JOIN public.seller_conversations conversation ON conversation.id=message.conversation_id
    JOIN public.sales_partner_profiles partner ON partner.id=COALESCE(o.sales_partner_id,conversation.sales_partner_id)
    JOIN public.contacts contact ON contact.id=partner.contact_id
    WHERE partner.employee_id IS NULL
      AND partner.partner_type IN ('hotel_employee','agency_employee','independent_referrer')
      AND (v_admin OR contact.owner_id=v_employee.id)
      AND public.seller_workspace_staff_access(COALESCE(o.my_company_id,conversation.my_company_id))
  )
  SELECT count(DISTINCT incoming.id) INTO v_count FROM incoming
  WHERE EXISTS(
    SELECT 1 FROM public.notification_recipients recipient
    WHERE recipient.notification_id=incoming.id AND recipient.is_read IS NOT TRUE
      AND CASE WHEN v_scope='mine' THEN recipient.user_id=auth.uid()
        ELSE EXISTS(SELECT 1 FROM public.employees employee
          WHERE employee.is_active=true
            AND (employee.auth_user_id=recipient.user_id OR employee.id=recipient.user_id)
            AND public.employee_can_access_company(employee.id,incoming.company_id)
            AND NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles portal
              WHERE portal.portal_auth_user_id=recipient.user_id AND portal.portal_enabled AND portal.contact_id IS NOT NULL))
      END
  );
  RETURN jsonb_build_object('count',v_count,'scope',v_scope,
    'employee_id',v_employee.id,'can_choose_scope',v_admin);
END; $$;
REVOKE ALL ON FUNCTION public.get_seller_sidebar_badge() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_sidebar_badge() TO authenticated;
COMMENT ON FUNCTION public.get_seller_sidebar_badge() IS
  'Nieprzeczytane powiadomienia CRM od sprzedawców zewnętrznych. Domyślnie własne dostarczenia; wyłącznie administrator może wybrać wszystkie. Jedno powiadomienie liczone raz, niezależnie od liczby odbiorców.';

NOTIFY pgrst,'reload schema';
COMMIT;
