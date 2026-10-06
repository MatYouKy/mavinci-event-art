BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.review_seller_offer_and_accept(uuid,uuid,text,jsonb,text,numeric,boolean,text)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw uruchom migrację 20260917150000.';
  END IF;
END $$;

-- External sellers inherit the owner of their CONTACT, not the owner of the
-- hotel/end client. A deliberately empty contact owner never falls back to an
-- obsolete per-brand assignment. Internal profiles without a contact retain
-- their existing per-brand configuration. No saved assignments are deleted.
CREATE OR REPLACE FUNCTION public.seller_partner_manager_id(p_partner uuid,p_company uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN p.contact_id IS NOT NULL THEN c.owner_id ELSE s.manager_id END
  FROM public.sales_partner_profiles p
  LEFT JOIN public.contacts c ON c.id=p.contact_id
  LEFT JOIN public.seller_offer_delivery_settings s ON s.sales_partner_id=p.id AND s.my_company_id=p_company
  WHERE p.id=p_partner;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_offer_manager(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers%ROWTYPE; v_contact uuid; e public.employees%ROWTYPE; v_manager uuid;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_manage(p_offer_id),false)
    OR COALESCE(public.current_session_is_seller_portal(),true) THEN RAISE EXCEPTION 'Brak dostępu do opiekuna w CRM'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal';
  SELECT contact_id INTO v_contact FROM public.sales_partner_profiles WHERE id=o.sales_partner_id;
  v_manager:=public.seller_partner_manager_id(o.sales_partner_id,o.my_company_id);
  SELECT * INTO e FROM public.employees WHERE id=v_manager;
  RETURN jsonb_build_object('source',CASE WHEN v_contact IS NULL THEN 'seller' ELSE 'contact' END,
    'contact_id',v_contact,'manager_id',v_manager,
    'manager_name',NULLIF(btrim(concat_ws(' ',e.name,e.surname)),''),
    'available_for_brand',COALESCE(e.is_active AND public.employee_can_access_company(e.id,o.my_company_id)
      AND (e.role::text='admin' OR e.access_level::text='admin'
        OR COALESCE(e.permissions,'{}'::text[]) && ARRAY['admin','offers_manage']::text[]),false));
END;
$$;

CREATE OR REPLACE FUNCTION public.configure_seller_offer_manager(p_offer_id uuid,p_manager_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_configure(p_offer_id),false) THEN RAISE EXCEPTION 'Opiekuna zmienia administrator'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal';
  IF EXISTS(SELECT 1 FROM public.sales_partner_profiles WHERE id=o.sales_partner_id AND contact_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Opiekun jest dziedziczony z kontaktu sprzedawcy. Zmień go w sekcji Odpowiedzialność za klienta.';
  END IF;
  IF p_manager_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=p_manager_id AND e.is_active
    AND public.employee_can_access_company(e.id,o.my_company_id)
    AND (e.role::text='admin' OR e.access_level::text='admin' OR COALESCE(e.permissions,'{}'::text[]) && ARRAY['admin','offers_manage']::text[])) THEN
    RAISE EXCEPTION 'Opiekun musi mieć aktywny dostęp do ofert tej marki';
  END IF;
  INSERT INTO public.seller_offer_delivery_settings(sales_partner_id,my_company_id,manager_id)
    VALUES(o.sales_partner_id,o.my_company_id,p_manager_id)
    ON CONFLICT(sales_partner_id,my_company_id) DO UPDATE SET manager_id=EXCLUDED.manager_id;
END;
$$;

-- Existing recipient eligibility and brand boundaries remain unchanged.
CREATE OR REPLACE FUNCTION public.seller_offer_notification_recipients(p_offer_id uuid,p_review boolean)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company uuid; v_partner uuid; v_manager uuid; v_recipients uuid[];
BEGIN
  SELECT my_company_id,sales_partner_id INTO v_company,v_partner
    FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal';
  IF NOT FOUND THEN RETURN '{}'::uuid[]; END IF;
  IF p_review THEN v_manager:=public.seller_partner_manager_id(v_partner,v_company); END IF;
  WITH eligible AS (
    SELECT e.id,login.id AS user_id,
      (e.role::text='admin' OR e.access_level::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))) AS is_admin
    FROM public.employees e CROSS JOIN LATERAL (
      SELECT u.id FROM auth.users u WHERE u.id=e.auth_user_id OR u.id=e.id
        ORDER BY (u.id=e.auth_user_id) DESC NULLS LAST,u.id LIMIT 1
    ) login
    WHERE e.is_active AND public.employee_can_access_company(e.id,v_company)
      AND (e.role::text='admin' OR e.access_level::text='admin'
        OR COALESCE(e.permissions,'{}'::text[]) && ARRAY['admin','offers_manage']::text[])
      AND NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles p
        WHERE p.portal_auth_user_id=login.id AND p.portal_enabled AND p.contact_id IS NOT NULL)
  ), manager AS (SELECT user_id FROM eligible WHERE id=v_manager)
  SELECT array_agg(DISTINCT user_id) INTO v_recipients FROM eligible
    WHERE CASE WHEN p_review AND EXISTS(SELECT 1 FROM manager) THEN id=v_manager ELSE is_admin END;
  RETURN COALESCE(v_recipients,'{}'::uuid[]);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_offer_arrangements(p_offer uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer public.offers%ROWTYPE; v_values jsonb; v_event jsonb; v_team jsonb;
BEGIN
  IF NOT COALESCE(public.seller_arrangements_access(p_offer),false) THEN RAISE EXCEPTION 'Brak dostępu do ustaleń tej oferty i marki'; END IF;
  SELECT * INTO STRICT v_offer FROM public.offers WHERE id=p_offer;
  SELECT to_jsonb(a)-'offer_id'-'updated_by' INTO v_values FROM public.seller_offer_arrangements a WHERE a.offer_id=p_offer;
  SELECT jsonb_build_object('id',e.id,'name',e.name,'status',e.status,
    'starts_at',to_char(e.event_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'ends_at',to_char(e.event_end_date AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'setup_at',to_char(e.planned_setup_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'teardown_at',to_char(e.planned_teardown_at AT TIME ZONE 'Europe/Warsaw','YYYY-MM-DD"T"HH24:MI'),
    'location',e.location,'can_view_crm',CASE WHEN public.current_session_is_seller_portal() THEN false ELSE public.current_employee_can_view_event(e.id) END)
  INTO v_event FROM public.events e WHERE e.id=v_offer.event_id AND e.my_company_id=v_offer.my_company_id;
  WITH assigned AS (
    SELECT e.id,e.name,e.surname,e.email,e.phone_number,'Opiekun sprzedawcy'::text AS role,0 AS priority
    FROM public.employees e
    WHERE e.id=public.seller_partner_manager_id(v_offer.sales_partner_id,v_offer.my_company_id)
      AND e.is_active AND public.employee_can_access_company(e.id,v_offer.my_company_id)
    UNION ALL
    SELECT e.id,e.name,e.surname,e.email,e.phone_number,COALESCE(NULLIF(a.role,''),'Zespół realizacji'),1
    FROM public.employee_assignments a JOIN public.employees e ON e.id=a.employee_id AND e.is_active
    JOIN public.events event ON event.id=a.event_id AND event.my_company_id=v_offer.my_company_id
    WHERE a.event_id=v_offer.event_id AND a.status::text='accepted' AND event.status::text<>'cancelled'
  ), people AS (SELECT DISTINCT ON(id) * FROM assigned ORDER BY id,priority,role)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'name',btrim(concat_ws(' ',name,surname)),
    'role',role,'email',email,'phone',phone_number) ORDER BY priority,surname,name,id),'[]'::jsonb) INTO v_team FROM people;
  RETURN jsonb_build_object('can_edit',public.seller_arrangements_access(p_offer,true),'values',COALESCE(v_values,'{"revision":0}'::jsonb),
    'offer',jsonb_build_object('id',v_offer.id,'title',v_offer.title,'event_date',v_offer.event_date,
      'location',v_offer.event_location,'status',v_offer.status,'base_net',v_offer.partner_base_net,'client_net',v_offer.client_total_net),
    'client',jsonb_build_object('name',v_offer.portal_client_name,'company',v_offer.portal_client_company,
      'email',v_offer.portal_client_email,'phone',v_offer.portal_client_phone),'event',v_event,'team',v_team);
END;
$$;

CREATE OR REPLACE FUNCTION public.send_seller_message(p_conversation uuid,p_message_id uuid,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_c record; v_kind text; v_name text; v_seq bigint; v_notice uuid; v_recipients uuid[]; v_url text;
BEGIN
  IF NOT COALESCE(public.seller_conversation_access(p_conversation,true),false) THEN RAISE EXCEPTION 'Brak uprawnień do wysłania wiadomości'; END IF;
  IF length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Wiadomość musi mieć od 1 do 10 000 znaków'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_message_id::text,1));
  IF EXISTS(SELECT 1 FROM public.seller_messages WHERE id=p_message_id) THEN
    IF EXISTS(SELECT 1 FROM public.seller_messages WHERE id=p_message_id AND conversation_id=p_conversation
      AND sender_user_id=auth.uid() AND body=btrim(p_body)) THEN RETURN p_message_id; END IF;
    RAISE EXCEPTION 'Identyfikator wiadomości został już wykorzystany';
  END IF;
  SELECT c.*,p.contact_id,p.employee_id,p.portal_auth_user_id INTO v_c
  FROM public.seller_conversations c JOIN public.sales_partner_profiles p ON p.id=c.sales_partner_id
  WHERE c.id=p_conversation FOR UPDATE OF c;
  v_kind:=CASE WHEN public.current_session_is_seller_portal() THEN 'seller' ELSE 'crm' END;
  IF v_kind='seller' THEN
    SELECT full_name INTO v_name FROM public.contacts WHERE id=v_c.contact_id;
    WITH eligible AS (
      SELECT e.id AS employee_id,u.id AS user_id,
        (e.role::text='admin' OR e.access_level::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))) AS is_admin
      FROM public.employees e CROSS JOIN LATERAL (
        SELECT id FROM auth.users WHERE id=e.id OR id=e.auth_user_id ORDER BY (id=e.id) DESC LIMIT 1
      ) u
      WHERE e.is_active AND public.employee_can_access_company(e.id,v_c.my_company_id)
        AND (e.role::text='admin' OR e.access_level::text='admin'
          OR COALESCE(e.permissions,'{}'::text[]) && ARRAY['admin','contacts_manage','offers_manage'])
        AND NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles p WHERE p.portal_auth_user_id=u.id AND p.portal_enabled)
    ), manager AS (
      SELECT employee_id FROM eligible
        WHERE employee_id=public.seller_partner_manager_id(v_c.sales_partner_id,v_c.my_company_id)
    ) SELECT array_agg(DISTINCT user_id) INTO v_recipients FROM eligible
      WHERE is_admin OR employee_id IN(SELECT employee_id FROM manager) OR NOT EXISTS(SELECT 1 FROM manager);
    v_url:=CASE WHEN v_c.contact_id IS NOT NULL THEN '/crm/contacts/'||v_c.contact_id||'?tab=seller&conversation='||p_conversation
      ELSE '/crm/salespeople?seller='||v_c.sales_partner_id||'&conversation='||p_conversation END;
  ELSE
    SELECT concat_ws(' ',name,surname) INTO v_name FROM public.employees WHERE id=public.current_employee_id();
    SELECT array_agg(id) INTO v_recipients FROM auth.users WHERE id=v_c.portal_auth_user_id;
    v_url:='/seller/messages?conversation='||p_conversation;
  END IF;
  INSERT INTO public.seller_messages(id,conversation_id,sender_user_id,sender_kind,sender_name,body)
    VALUES(p_message_id,p_conversation,auth.uid(),v_kind,COALESCE(NULLIF(v_name,''),'MAVINCI'),btrim(p_body)) RETURNING seq INTO v_seq;
  IF COALESCE(cardinality(v_recipients),0)>0 THEN
    INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
    VALUES(CASE WHEN v_kind='seller' THEN 'Wiadomość od sprzedawcy' ELSE 'Odpowiedź opiekuna MAVINCI' END,
      COALESCE(v_name,'MAVINCI')||' · '||left(btrim(p_body),160),'info','system',v_url,NULL,p_message_id,
      jsonb_build_object('workflow','seller_chat','sales_partner_id',v_c.sales_partner_id,'conversation_id',p_conversation)) RETURNING id INTO v_notice;
    INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
      SELECT v_notice,u,false FROM unnest(v_recipients) u WHERE u<>auth.uid() ON CONFLICT DO NOTHING;
  END IF;
  RETURN p_message_id;
END;
$$;

-- A CRM operator may review an existing current PDF even when the old workflow
-- never created a seller request. This is an explicit NEW decision, not a
-- fabricated historical approval or a mass migration of draft offers.
CREATE OR REPLACE FUNCTION public.review_seller_offer_in_crm(
  p_offer_id uuid,p_document_id uuid,p_decision text,p_checks jsonb,p_response text,p_expected_review jsonb,
  p_discount numeric DEFAULT 0,p_special_request boolean DEFAULT false,p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers%ROWTYPE; v_before jsonb; v_key text;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.current_session_is_seller_portal(),true)
    OR NOT COALESCE(public.seller_offer_can_manage(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do decyzji CRM'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  SELECT to_jsonb(r) INTO v_before FROM public.seller_offer_reviews r WHERE r.offer_id=p_offer_id FOR UPDATE;
  v_key:=public.seller_offer_source_key(p_offer_id);
  IF o.status::text NOT IN ('draft','sent','viewed','accepted') THEN RAISE EXCEPTION 'Oferta jest odrzucona, anulowana lub wygasła. Najpierw wyjaśnij jej status.'; END IF;
  -- A retry cannot duplicate approval or apply a discount again.
  IF p_decision='approved' AND v_before->>'status'='approved'
    AND v_before->>'document_id'=p_document_id::text AND v_before->>'source_key'=v_key THEN
    RETURN public.accept_seller_offer_review(p_offer_id,p_document_id);
  END IF;
  IF COALESCE(v_before,'null'::jsonb) IS DISTINCT FROM COALESCE(p_expected_review,'null'::jsonb) THEN
    RAISE EXCEPTION 'Decyzja zmieniła się w innym oknie. Odśwież status przed jej rozpatrzeniem.';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.seller_offer_documents WHERE id=p_document_id AND offer_id=p_offer_id AND source_key=v_key) THEN
    RAISE EXCEPTION 'Wybierz aktualny PDF tej oferty. Historycznej wersji nie można zaakceptować jako bieżącej.';
  END IF;
  IF v_before->>'status'='approved' AND v_before->>'source_key'=v_key THEN
    RAISE EXCEPTION 'Aktualna oferta jest już zaakceptowana. Zachowano wcześniejszą decyzję.';
  END IF;
  IF v_before IS NULL OR v_before->>'status' IS DISTINCT FROM 'pending' OR v_before->>'source_key' IS DISTINCT FROM v_key THEN
    INSERT INTO public.seller_offer_reviews(offer_id,document_id,source_key,status,request_note)
      VALUES(p_offer_id,p_document_id,v_key,'pending','Rozpatrzenie uruchomione bezpośrednio w CRM — nie jest nowym zgłoszeniem sprzedawcy.')
    ON CONFLICT(offer_id) DO UPDATE SET document_id=EXCLUDED.document_id,source_key=EXCLUDED.source_key,status='pending',
      request_note=EXCLUDED.request_note,requested_at=now(),response_note='',reviewed_at=NULL,reviewed_by=NULL,
      date_checked=false,resources_checked=false,capacity_checked=false,discount_percent=0,discount_reason='';
  ELSIF v_before->>'document_id' IS DISTINCT FROM p_document_id::text THEN
    RAISE EXCEPTION 'Rozpatrz PDF wskazany w oczekującym zgłoszeniu.';
  END IF;
  -- The pending row, audit entries, decision, accepted offer and seller notice
  -- commit together. Existing checks, discount controls and history are kept.
  RETURN public.review_seller_offer_and_accept(p_offer_id,p_document_id,p_decision,p_checks,
    p_response,p_discount,p_special_request,p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.seller_offer_handoff_version()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 3; $$;

REVOKE ALL ON FUNCTION public.seller_partner_manager_id(uuid,uuid),public.seller_offer_notification_recipients(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.seller_partner_manager_id(uuid,uuid),public.seller_offer_notification_recipients(uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.get_seller_offer_manager(uuid),public.configure_seller_offer_manager(uuid,uuid),
  public.get_seller_offer_arrangements(uuid),public.send_seller_message(uuid,uuid,text),
  public.review_seller_offer_in_crm(uuid,uuid,text,jsonb,text,jsonb,numeric,boolean,text),public.seller_offer_handoff_version() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_seller_offer_manager(uuid),public.configure_seller_offer_manager(uuid,uuid),
  public.get_seller_offer_arrangements(uuid),public.send_seller_message(uuid,uuid,text),
  public.review_seller_offer_in_crm(uuid,uuid,text,jsonb,text,jsonb,numeric,boolean,text),public.seller_offer_handoff_version() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
