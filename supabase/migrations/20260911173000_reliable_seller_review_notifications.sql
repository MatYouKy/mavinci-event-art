BEGIN;

-- Keep the existing routing: the eligible assigned manager, otherwise brand
-- administrators. Use the linked login first, not a legacy employees.id login.
CREATE OR REPLACE FUNCTION public.seller_offer_notification_recipients(p_offer_id uuid,p_review boolean)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_company uuid; v_partner uuid; v_manager uuid; v_recipients uuid[];
BEGIN
  SELECT my_company_id,sales_partner_id INTO v_company,v_partner
  FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal';
  IF NOT FOUND THEN RETURN '{}'::uuid[]; END IF;
  IF p_review THEN
    SELECT manager_id INTO v_manager FROM public.seller_offer_delivery_settings
    WHERE sales_partner_id=v_partner AND my_company_id=v_company;
  END IF;
  WITH eligible AS (
    SELECT e.id,login.id AS user_id,
      (e.role::text='admin' OR e.access_level::text='admin'
        OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))) AS is_admin
    FROM public.employees e
    CROSS JOIN LATERAL (
      SELECT u.id FROM auth.users u WHERE u.id=e.auth_user_id OR u.id=e.id
      ORDER BY (u.id=e.auth_user_id) DESC NULLS LAST,u.id LIMIT 1
    ) login
    WHERE e.is_active=true AND public.employee_can_access_company(e.id,v_company)
      AND (e.role::text='admin' OR e.access_level::text='admin'
        OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))
        OR 'offers_manage'=ANY(COALESCE(e.permissions,'{}'::text[])))
      AND NOT EXISTS (SELECT 1 FROM public.sales_partner_profiles p
        WHERE p.portal_auth_user_id=login.id AND p.portal_enabled=true AND p.contact_id IS NOT NULL)
  ), manager AS (SELECT user_id FROM eligible WHERE id=v_manager)
  SELECT array_agg(DISTINCT user_id) INTO v_recipients FROM eligible
  WHERE CASE WHEN p_review AND EXISTS(SELECT 1 FROM manager)
    THEN id=v_manager ELSE is_admin END;
  RETURN COALESCE(v_recipients,'{}'::uuid[]);
END;
$$;
REVOKE ALL ON FUNCTION public.seller_offer_notification_recipients(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.seller_offer_notification_recipients(uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_seller_offer_workflow(p_offer_id uuid,p_document_id uuid,p_review boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer record; v_recipients uuid[]; v_notice uuid; v_title text; v_url text;
  v_requested_at timestamptz; v_request_key text; v_metadata jsonb;
BEGIN
  PERFORM 1 FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  SELECT o.*,COALESCE(NULLIF(o.partner_branding_snapshot->>'display_name',''),c.full_name,
    NULLIF(concat_ws(' ',e.name,e.surname),''),'Sprzedawca') AS seller_name INTO v_offer
  FROM public.offers o JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id
  LEFT JOIN public.contacts c ON c.id=p.contact_id
  LEFT JOIN public.employees e ON e.id=p.employee_id
  WHERE o.id=p_offer_id AND o.sales_channel='seller_portal';
  IF NOT FOUND THEN RAISE EXCEPTION 'Nie znaleziono oferty sprzedawcy'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.seller_offer_documents WHERE id=p_document_id AND offer_id=p_offer_id)
    THEN RAISE EXCEPTION 'Nie znaleziono wersji PDF tej oferty'; END IF;
  IF p_review THEN
    SELECT requested_at INTO v_requested_at FROM public.seller_offer_reviews
    WHERE offer_id=p_offer_id AND document_id=p_document_id AND status='pending';
    IF NOT FOUND THEN RAISE EXCEPTION 'Brak oczekującego przekazania tej wersji oferty'; END IF;
    -- One notification per submission, not per PDF. Submitting unchanged PDF
    -- again after requested changes must not reuse an already-read notice.
    v_request_key:=p_offer_id::text||':'||p_document_id::text||':'||extract(epoch FROM v_requested_at)::text;
  END IF;
  v_recipients:=public.seller_offer_notification_recipients(p_offer_id,p_review);
  IF cardinality(v_recipients)=0 THEN
    RAISE EXCEPTION 'Brak odbiorcy powiadomienia CRM. Przypisz aktywnego opiekuna z kontem logowania i uprawnieniami do ofert tej marki albo administratora z dostępem do marki. Przekazanie nie zostało zapisane.';
  END IF;
  v_title:=CASE WHEN p_review THEN 'Zapytanie sprzedawcy: termin i zasoby' ELSE 'Wygenerowano ofertę sprzedawcy' END;
  v_url:='/crm/offers/'||p_offer_id::text||'?document='||p_document_id::text||'&preview=1'
    ||CASE WHEN p_review THEN '#seller-offer-review' ELSE '' END;
  v_metadata:=jsonb_strip_nulls(jsonb_build_object('workflow','seller_offer',
    'event',CASE WHEN p_review THEN 'review_requested' ELSE 'document_generated' END,
    'document_id',p_document_id,'sales_partner_id',v_offer.sales_partner_id,
    'review_request_key',v_request_key,'review_requested_at',v_requested_at));
  SELECT n.id INTO v_notice FROM public.notifications n
  WHERE n.related_entity_id::text=p_offer_id::text AND n.title=v_title
    AND n.metadata->>'document_id'=p_document_id::text
    AND (NOT p_review OR n.metadata->>'review_request_key'=v_request_key
      OR (n.metadata->>'review_request_key' IS NULL AND n.created_at>=v_requested_at))
  ORDER BY n.created_at DESC,n.id LIMIT 1;
  IF v_notice IS NULL THEN
    INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
    VALUES(v_title,v_offer.seller_name||' · '||COALESCE(v_offer.offer_number,v_offer.title,'Oferta'),
      'info','offer',v_url,'offer',p_offer_id,v_metadata) RETURNING id INTO v_notice;
  ELSE
    UPDATE public.notifications SET action_url=v_url,metadata=COALESCE(metadata,'{}'::jsonb)||v_metadata WHERE id=v_notice;
  END IF;
  INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
  SELECT v_notice,recipient,false FROM unnest(v_recipients) recipient
  ON CONFLICT(notification_id,user_id) DO NOTHING;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_seller_offer_workflow(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notify_seller_offer_workflow(uuid,uuid,boolean) TO service_role;

-- Submission and recipient delivery are one transaction. The browser must not
-- report success when there is no addressed CRM notification. Existing review
-- ownership/brand/PDF/decision checks remain in request_seller_offer_review.
CREATE OR REPLACE FUNCTION public.request_seller_offer_review_with_notification(p_offer_id uuid,p_document_id uuid,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_requested_at timestamptz; v_request_key text; v_count integer; v_recipients uuid[];
BEGIN
  PERFORM public.request_seller_offer_review(p_offer_id,p_document_id,p_note);
  SELECT requested_at INTO STRICT v_requested_at FROM public.seller_offer_reviews
    WHERE offer_id=p_offer_id AND document_id=p_document_id AND status='pending';
  v_request_key:=p_offer_id::text||':'||p_document_id::text||':'||extract(epoch FROM v_requested_at)::text;
  v_recipients:=public.seller_offer_notification_recipients(p_offer_id,true);
  SELECT count(DISTINCT nr.user_id)::integer INTO v_count
  FROM public.notifications n JOIN public.notification_recipients nr ON nr.notification_id=n.id
  WHERE n.related_entity_id::text=p_offer_id::text AND n.metadata->>'review_request_key'=v_request_key
    AND nr.user_id=ANY(v_recipients);
  IF v_count=0 THEN RAISE EXCEPTION 'Nie zapisano odbiorcy powiadomienia CRM. Przekazanie nie zostało zapisane. Skontaktuj się z opiekunem.'; END IF;
  RETURN jsonb_build_object('notified_recipients',v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.request_seller_offer_review_with_notification(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_seller_offer_review_with_notification(uuid,uuid,text) TO authenticated;

-- Repair only currently pending requests, without changing any approval,
-- marking old notices unread, or sending duplicate notices to existing recipients.
DO $$
DECLARE request record;
BEGIN
  FOR request IN SELECT r.offer_id,r.document_id FROM public.seller_offer_reviews r
    JOIN public.offers o ON o.id=r.offer_id WHERE r.status='pending' AND o.sales_channel='seller_portal'
  LOOP
    IF cardinality(public.seller_offer_notification_recipients(request.offer_id,true))>0 THEN
      PERFORM public.notify_seller_offer_workflow(request.offer_id,request.document_id,true);
    ELSE
      RAISE WARNING 'Oferta %: brak aktywnego odbiorcy CRM tej marki. Uzupełnij opiekuna lub administratora.',request.offer_id;
    END IF;
  END LOOP;
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
