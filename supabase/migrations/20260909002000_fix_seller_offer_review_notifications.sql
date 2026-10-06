BEGIN;

-- Resolve an actual login account, not a COALESCE that can choose a stale auth_user_id.
-- Only active employees allowed to review this brand may receive a review request.
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
   SELECT array_agg(DISTINCT login.id) INTO v_recipients
   FROM public.employees e
   CROSS JOIN LATERAL (
     SELECT u.id FROM auth.users u WHERE u.id=e.id OR u.id=e.auth_user_id
     ORDER BY (u.id=e.id) DESC LIMIT 1
   ) login
   WHERE e.id=v_manager AND e.is_active=true
     AND public.employee_can_access_company(e.id,v_company)
     AND (e.role::text='admin' OR e.access_level::text='admin'
       OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))
       OR 'offers_manage'=ANY(COALESCE(e.permissions,'{}'::text[])));
 END IF;
 IF COALESCE(cardinality(v_recipients),0)=0 THEN
   SELECT array_agg(DISTINCT login.id) INTO v_recipients
   FROM public.employees e
   CROSS JOIN LATERAL (
     SELECT u.id FROM auth.users u WHERE u.id=e.id OR u.id=e.auth_user_id
     ORDER BY (u.id=e.id) DESC LIMIT 1
   ) login
   WHERE e.is_active=true AND public.employee_can_access_company(e.id,v_company)
     AND (e.role::text='admin' OR e.access_level::text='admin'
       OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[])));
 END IF;
 RETURN COALESCE(v_recipients,'{}'::uuid[]);
END; $$;
REVOKE ALL ON FUNCTION public.seller_offer_notification_recipients(uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.seller_offer_notification_recipients(uuid,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.notify_seller_offer_workflow(p_offer_id uuid,p_document_id uuid,p_review boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer record; v_recipients uuid[]; v_notice uuid; v_title text; v_url text;
BEGIN
 -- Serialize duplicate registrations/repair for the same offer.
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
 v_recipients:=public.seller_offer_notification_recipients(p_offer_id,p_review);
 IF cardinality(v_recipients)=0 THEN
   RAISE EXCEPTION 'Brak odbiorców powiadomienia. Administrator musi przypisać aktywnego opiekuna z kontem logowania i dostępem do ofert tej marki albo skonfigurować administratora.';
 END IF;
 v_title:=CASE WHEN p_review THEN 'Zapytanie sprzedawcy: termin i zasoby' ELSE 'Wygenerowano ofertę sprzedawcy' END;
 v_url:='/crm/offers/'||p_offer_id::text||'?document='||p_document_id::text||'&preview=1'
   ||CASE WHEN p_review THEN '#seller-offer-review' ELSE '' END;
 SELECT n.id INTO v_notice FROM public.notifications n
 WHERE n.related_entity_id::text=p_offer_id::text AND n.title=v_title
   AND n.metadata->>'document_id'=p_document_id::text
 ORDER BY n.created_at DESC LIMIT 1;
 IF v_notice IS NULL THEN
   INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
   VALUES(v_title,v_offer.seller_name||' · '||COALESCE(v_offer.offer_number,v_offer.title,'Oferta'),
     'info','offer',v_url,'offer',p_offer_id,
     jsonb_build_object('document_id',p_document_id,'sales_partner_id',v_offer.sales_partner_id,'workflow','seller_offer'))
   RETURNING id INTO v_notice;
 ELSE
   UPDATE public.notifications SET action_url=v_url WHERE id=v_notice;
 END IF;
 INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
 SELECT v_notice,recipient,false FROM unnest(v_recipients) recipient
 ON CONFLICT(notification_id,user_id) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.notify_seller_offer_workflow(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.notify_seller_offer_workflow(uuid,uuid,boolean) TO service_role;

-- Repair pending requests without sending duplicate notifications to existing recipients.
-- A missing account configuration must not prevent installation of the fix.
DO $$
DECLARE request record;
BEGIN
 FOR request IN SELECT offer_id,document_id FROM public.seller_offer_reviews WHERE status='pending'
 LOOP
   IF cardinality(public.seller_offer_notification_recipients(request.offer_id,true))>0 THEN
     PERFORM public.notify_seller_offer_workflow(request.offer_id,request.document_id,true);
   ELSE
     RAISE WARNING 'Brak odbiorców dla zapytania oferty %. Uzupełnij opiekuna lub konto administratora.',request.offer_id;
   END IF;
 END LOOP;
END; $$;

NOTIFY pgrst,'reload schema';
COMMIT;
