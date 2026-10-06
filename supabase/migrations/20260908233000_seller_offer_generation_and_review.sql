BEGIN;

-- Opis widoczny dla klienta jest używany przez zapis portalu i generator PDF.
-- Starszy schemat offers zawiera notes, ale nie definiuje description.
-- Nie kopiujemy notes: mogą zawierać wewnętrzne uwagi CRM.
ALTER TABLE public.offers
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN public.offers.description IS
  'Opis oferty widoczny dla klienta, używany w portalu sprzedawcy i PDF; niezależny od notatek wewnętrznych notes.';

CREATE OR REPLACE FUNCTION public.seller_offer_can_manage(p_offer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.offers o JOIN public.employees e ON e.id=public.current_employee_id()
    WHERE o.id=p_offer_id AND o.sales_channel='seller_portal' AND e.is_active=true
      AND public.current_employee_can_access_company(o.my_company_id)
      AND (e.role::text='admin' OR e.access_level::text='admin'
        OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))
        OR 'offers_manage'=ANY(COALESCE(e.permissions,'{}'::text[])))
  );
$$;
REVOKE ALL ON FUNCTION public.seller_offer_can_manage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_offer_can_manage(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seller_offer_source_key(p_offer_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT md5(jsonb_build_object(
    'title',o.title,'description',o.description,'event_date',o.event_date,
    'event_location',o.event_location,'valid_until',o.valid_until,
    'client_name',o.portal_client_name,'client_company',o.portal_client_company,
    'client_email',o.portal_client_email,'client_phone',o.portal_client_phone,
    'approval',o.partner_approval_status,'company',o.my_company_id,'branding',o.partner_branding_snapshot,'tax',o.tax_percent,
    'items',(SELECT jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'description',i.description,
      'unit',i.unit,'quantity',i.quantity,'price',i.client_unit_price,'image',i.partner_source_snapshot->'image_path')
      ORDER BY i.display_order,i.id) FROM public.offer_items i WHERE i.offer_id=o.id)
  )::text) FROM public.offers o WHERE o.id=p_offer_id AND o.sales_channel='seller_portal';
$$;
REVOKE ALL ON FUNCTION public.seller_offer_source_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_offer_source_key(uuid) TO service_role;

CREATE TABLE public.seller_offer_delivery_settings (
  sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id),
  my_company_id uuid NOT NULL REFERENCES public.my_companies(id),
  manager_id uuid REFERENCES public.employees(id),
  email_account_id uuid REFERENCES public.employee_email_accounts(id),
  PRIMARY KEY(sales_partner_id,my_company_id)
);
ALTER TABLE public.seller_offer_delivery_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_delivery_settings FROM anon,authenticated;

CREATE TABLE public.seller_offer_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id),
  source_key text NOT NULL,
  storage_path text UNIQUE NOT NULL,
  filename text NOT NULL,
  generated_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.seller_offer_documents(offer_id,created_at DESC);
ALTER TABLE public.seller_offer_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_documents FROM anon,authenticated;
GRANT SELECT ON public.seller_offer_documents TO authenticated;
CREATE POLICY seller_offer_document_read ON public.seller_offer_documents FOR SELECT TO authenticated
USING(public.seller_portal_offer_access_allowed(offer_id));
INSERT INTO storage.buckets(id,name,public) VALUES('seller-offer-documents','seller-offer-documents',false)
ON CONFLICT(id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='seller-offer-documents' AND public=true)
 THEN RAISE EXCEPTION 'Bucket seller-offer-documents musi być prywatny'; END IF;
END; $$;
CREATE POLICY seller_offer_pdf_read ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='seller-offer-documents' AND EXISTS(
 SELECT 1 FROM public.seller_offer_documents d WHERE d.storage_path=name
 AND public.seller_portal_offer_access_allowed(d.offer_id)));

CREATE TABLE public.seller_offer_reviews (
  offer_id uuid PRIMARY KEY REFERENCES public.offers(id),
  document_id uuid NOT NULL REFERENCES public.seller_offer_documents(id),
  source_key text NOT NULL,
  status text NOT NULL CHECK(status IN('pending','approved','changes_requested','rejected')),
  request_note text NOT NULL DEFAULT '',
  response_note text NOT NULL DEFAULT '',
  date_checked boolean NOT NULL DEFAULT false,
  resources_checked boolean NOT NULL DEFAULT false,
  capacity_checked boolean NOT NULL DEFAULT false,
  discount_percent numeric NOT NULL DEFAULT 0 CHECK(discount_percent>=0 AND discount_percent<=100),
  discount_reason text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES public.employees(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
ALTER TABLE public.seller_offer_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_reviews FROM anon,authenticated;

CREATE TABLE public.seller_offer_email_deliveries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL UNIQUE REFERENCES public.seller_offer_documents(id),
 recipient text NOT NULL,
 status text NOT NULL CHECK(status IN('sending','sent','unknown')),
 created_at timestamptz NOT NULL DEFAULT now(),
 sent_at timestamptz
);
ALTER TABLE public.seller_offer_email_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_email_deliveries FROM anon,authenticated;

CREATE OR REPLACE FUNCTION public.notify_seller_offer_workflow(p_offer_id uuid,p_document_id uuid,p_review boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer record; v_manager uuid; v_recipients uuid[]; v_notice uuid;
BEGIN
 SELECT o.*, COALESCE(c.full_name,'Sprzedawca') AS seller_name INTO v_offer
 FROM public.offers o JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id
 LEFT JOIN public.contacts c ON c.id=p.contact_id WHERE o.id=p_offer_id;
 IF p_review THEN
   SELECT manager_id INTO v_manager FROM public.seller_offer_delivery_settings
   WHERE sales_partner_id=v_offer.sales_partner_id AND my_company_id=v_offer.my_company_id;
   SELECT array_agg(COALESCE(e.auth_user_id,e.id)) INTO v_recipients
   FROM public.employees e JOIN auth.users u ON u.id=COALESCE(e.auth_user_id,e.id)
   WHERE e.id=v_manager AND e.is_active=true
     AND (e.role::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))
       OR 'offers_manage'=ANY(COALESCE(e.permissions,'{}'::text[])))
     AND (cardinality(COALESCE(e.my_company_ids,'{}'::uuid[]))=0 OR v_offer.my_company_id=ANY(e.my_company_ids)
       OR e.role::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[])));
 END IF;
 IF COALESCE(cardinality(v_recipients),0)=0 THEN
   SELECT array_agg(COALESCE(e.auth_user_id,e.id)) INTO v_recipients
   FROM public.employees e JOIN auth.users u ON u.id=COALESCE(e.auth_user_id,e.id)
   WHERE e.is_active=true AND (e.role::text='admin' OR e.access_level::text='admin'
     OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[])));
 END IF;
 INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
 VALUES(
   CASE WHEN p_review THEN 'Zapytanie sprzedawcy: termin i zasoby' ELSE 'Wygenerowano ofertę sprzedawcy' END,
   v_offer.seller_name||' · '||COALESCE(v_offer.offer_number,v_offer.title,'Oferta'),
   'info','offer','/crm/offers/'||p_offer_id::text||'?document='||p_document_id::text,
   'offer',p_offer_id,jsonb_build_object('document_id',p_document_id,'sales_partner_id',v_offer.sales_partner_id))
 RETURNING id INTO v_notice;
 INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
 SELECT v_notice,recipient,false FROM unnest(COALESCE(v_recipients,'{}'::uuid[])) recipient
 ON CONFLICT(notification_id,user_id) DO NOTHING;
END; $$;
REVOKE ALL ON FUNCTION public.notify_seller_offer_workflow(uuid,uuid,boolean) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.record_seller_offer_document(
 p_id uuid,p_offer_id uuid,p_source_key text,p_storage_path text,p_filename text,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_partner uuid;
BEGIN
 SELECT sales_partner_id INTO v_partner FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
 IF NOT FOUND OR public.seller_offer_source_key(p_offer_id) IS DISTINCT FROM p_source_key THEN
   RAISE EXCEPTION 'Oferta zmieniła się podczas generowania. Wygeneruj ją ponownie.';
 END IF;
 INSERT INTO public.seller_offer_documents(id,offer_id,source_key,storage_path,filename,generated_by)
 VALUES(p_id,p_offer_id,p_source_key,p_storage_path,p_filename,p_actor);
 UPDATE public.offers SET partner_generated_at=now(),partner_last_activity_at=now() WHERE id=p_offer_id;
 UPDATE public.seller_offer_reviews SET document_id=p_id WHERE offer_id=p_offer_id AND source_key=p_source_key AND status='approved';
 INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
 VALUES(p_offer_id,v_partner,'generated',jsonb_build_object('document_id',p_id,'actor',p_actor));
 PERFORM public.notify_seller_offer_workflow(p_offer_id,p_id,false);
 RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.record_seller_offer_document(uuid,uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_seller_offer_document(uuid,uuid,text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seller_offer_workflow_state(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_o record; v_manage boolean; v_key text; v_review jsonb; v_config jsonb;
BEGIN
 IF NOT public.seller_portal_offer_access_allowed(p_offer_id) THEN RAISE EXCEPTION 'Brak dostępu'; END IF;
 SELECT * INTO v_o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal';
 IF NOT FOUND THEN RETURN NULL; END IF;
 v_manage:=public.seller_offer_can_manage(p_offer_id);
 v_key:=public.seller_offer_source_key(p_offer_id);
 SELECT to_jsonb(r) INTO v_review FROM public.seller_offer_reviews r WHERE r.offer_id=p_offer_id;
 IF NOT v_manage THEN v_review:=v_review-'discount_percent'-'discount_reason'-'reviewed_by'; END IF;
 SELECT jsonb_build_object('manager_id',s.manager_id,'email_account_id',s.email_account_id,
   'sender_email',a.email_address,'email_ready',COALESCE(a.is_active AND NOT COALESCE(a.is_system_account,false),false))
 INTO v_config FROM public.seller_offer_delivery_settings s
 LEFT JOIN public.employee_email_accounts a ON a.id=s.email_account_id
 WHERE s.sales_partner_id=v_o.sales_partner_id AND s.my_company_id=v_o.my_company_id;
 IF NOT v_manage THEN v_config:=v_config-'manager_id'-'email_account_id'; END IF;
 RETURN jsonb_build_object(
 'can_manage',v_manage,'source_key',v_key,'config',v_config,'review',v_review,
 'recipient',v_o.portal_client_email,'title',v_o.title,'offer_number',v_o.offer_number,
 'documents',COALESCE((SELECT jsonb_agg(to_jsonb(d)||jsonb_build_object('current',d.source_key=v_key)
   ORDER BY d.created_at DESC,d.id) FROM public.seller_offer_documents d WHERE d.offer_id=p_offer_id),'[]'::jsonb),
 'delivery',(SELECT jsonb_build_object('status',x.status,'recipient',x.recipient,'document_id',x.document_id)
 FROM public.seller_offer_email_deliveries x JOIN public.seller_offer_documents d ON d.id=x.document_id
 WHERE d.offer_id=p_offer_id ORDER BY x.created_at DESC LIMIT 1));
END; $$;
REVOKE ALL ON FUNCTION public.seller_offer_workflow_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_offer_workflow_state(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.request_seller_offer_review(p_offer_id uuid,p_document_id uuid,p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_o record; v_key text;
BEGIN
 SELECT * INTO v_o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal'
 AND sales_partner_id=public.current_sales_partner_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Brak dostępu'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sales_partner_brand_terms WHERE sales_partner_id=v_o.sales_partner_id AND my_company_id=v_o.my_company_id AND is_active=true)
 THEN RAISE EXCEPTION 'Dostęp do marki nie jest aktywny'; END IF;
 v_key:=public.seller_offer_source_key(p_offer_id);
 IF NOT EXISTS(SELECT 1 FROM public.seller_offer_documents WHERE id=p_document_id AND offer_id=p_offer_id AND source_key=v_key)
 THEN RAISE EXCEPTION 'Najpierw wygeneruj aktualną wersję PDF'; END IF;
 IF v_o.event_date IS NULL THEN RAISE EXCEPTION 'Podaj termin wydarzenia przed wysłaniem zapytania'; END IF;
 IF EXISTS(SELECT 1 FROM public.seller_offer_reviews WHERE offer_id=p_offer_id AND source_key=v_key AND status IN('pending','approved'))
 THEN RAISE EXCEPTION 'Ta wersja ma już wysłane lub zaakceptowane zapytanie'; END IF;
 INSERT INTO public.seller_offer_reviews(offer_id,document_id,source_key,status,request_note)
 VALUES(p_offer_id,p_document_id,v_key,'pending',left(COALESCE(p_note,''),5000))
 ON CONFLICT(offer_id) DO UPDATE SET document_id=EXCLUDED.document_id,source_key=EXCLUDED.source_key,
 status='pending',request_note=EXCLUDED.request_note,response_note='',date_checked=false,resources_checked=false,
 capacity_checked=false,discount_percent=0,discount_reason='',reviewed_by=NULL,requested_at=now(),reviewed_at=NULL;
 INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
 VALUES(p_offer_id,v_o.sales_partner_id,'submitted_for_review',jsonb_build_object('document_id',p_document_id,'note',left(COALESCE(p_note,''),5000)));
 PERFORM public.notify_seller_offer_workflow(p_offer_id,p_document_id,true);
END; $$;
REVOKE ALL ON FUNCTION public.request_seller_offer_review(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_seller_offer_review(uuid,uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_individual_seller_price_to_offer_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_offer record;
  v_rate record;
BEGIN
  SELECT offer_row.sales_channel, offer_row.sales_partner_id, offer_row.my_company_id,
         offer_row.commercial_model
  INTO v_offer
  FROM public.offers offer_row
  WHERE offer_row.id = NEW.offer_id;

  IF v_offer.sales_channel <> 'seller_portal'
     OR NEW.is_partner_custom
     OR NEW.product_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE' AND current_setting('app.seller_offer_internal_discount',true)='1'
     AND public.seller_offer_can_manage(NEW.offer_id) THEN
    NEW.unit_price:=NEW.client_unit_price;
    NEW.partner_margin_amount:=(NEW.client_unit_price-NEW.base_partner_unit_price)*NEW.quantity;
    RETURN NEW;
  END IF;

  SELECT * INTO v_rate
  FROM public.resolve_seller_product_price(
    v_offer.sales_partner_id,
    v_offer.my_company_id,
    NEW.product_id,
    NEW.product_variant_id
  );

  IF NOT FOUND OR NOT COALESCE(v_rate.is_available, false) THEN
    RAISE EXCEPTION 'Produkt nie jest dostępny w cenniku tego sprzedawcy';
  END IF;

  NEW.base_partner_unit_price := v_rate.price_net;
  NEW.unit_cost := v_rate.price_net;
  IF v_offer.commercial_model = 'commission' THEN
    NEW.client_unit_price := v_rate.price_net;
    NEW.unit_price := v_rate.price_net;
  ELSE
    NEW.client_unit_price := GREATEST(COALESCE(NEW.client_unit_price, 0), 0);
    NEW.unit_price := NEW.client_unit_price;
  END IF;
  NEW.partner_margin_amount := (NEW.client_unit_price - v_rate.price_net) * COALESCE(NEW.quantity, 1);
  NEW.requires_internal_approval := COALESCE(NEW.requires_internal_approval, false)
    OR NEW.client_unit_price < v_rate.price_net;
  NEW.partner_source_snapshot := COALESCE(NEW.partner_source_snapshot, '{}'::jsonb) || jsonb_build_object(
    'seller_price_net', v_rate.price_net,
    'seller_price_source', v_rate.price_source,
    'requires_accommodation', v_rate.requires_accommodation,
    'accommodation_note', v_rate.accommodation_note,
    'logistics_note', v_rate.logistics_note,
    'additional_requirements', v_rate.additional_requirements,
    'captured_at', now()
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_seller_offer_resources(
 p_offer_id uuid,p_document_id uuid,p_decision text,p_checks jsonb,p_response text,
 p_discount numeric DEFAULT 0,p_special_request boolean DEFAULT false,p_reason text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_o record; v_r record; v_key text;
BEGIN
 IF NOT public.seller_offer_can_manage(p_offer_id) THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
 SELECT * INTO v_o FROM public.offers WHERE id=p_offer_id FOR UPDATE;
 SELECT * INTO v_r FROM public.seller_offer_reviews WHERE offer_id=p_offer_id FOR UPDATE;
 v_key:=public.seller_offer_source_key(p_offer_id);
 IF v_r.status IS DISTINCT FROM 'pending' OR v_r.document_id IS DISTINCT FROM p_document_id OR v_r.source_key IS DISTINCT FROM v_key
 THEN RAISE EXCEPTION 'Zapytanie jest nieaktualne lub zostało już obsłużone'; END IF;
 IF p_decision NOT IN('approved','changes_requested','rejected') THEN RAISE EXCEPTION 'Nieprawidłowa decyzja'; END IF;
 IF p_decision='approved' AND NOT (
   COALESCE((p_checks->>'date')::boolean,false) AND COALESCE((p_checks->>'resources')::boolean,false)
   AND COALESCE((p_checks->>'capacity')::boolean,false)) THEN
   RAISE EXCEPTION 'Potwierdź termin, zasoby oraz dostępność zespołu';
 END IF;
 IF p_discount IS NULL OR p_discount<0 OR p_discount>100 THEN RAISE EXCEPTION 'Nieprawidłowy rabat'; END IF;
 IF p_discount>0 THEN
   IF p_decision<>'approved' OR NOT COALESCE(p_special_request,false) OR length(btrim(COALESCE(p_reason,'')))<5
   THEN RAISE EXCEPTION 'Rabat wymaga specjalnego życzenia i uzasadnienia'; END IF;
   PERFORM set_config('app.seller_offer_internal_discount','1',true);
   UPDATE public.offer_items SET client_unit_price=round(client_unit_price*(1-p_discount/100),2),
     unit_price=round(client_unit_price*(1-p_discount/100),2),
     partner_margin_amount=(round(client_unit_price*(1-p_discount/100),2)-base_partner_unit_price)*quantity
   WHERE offer_id=p_offer_id;
   SET CONSTRAINTS trg_recalculate_individual_seller_offer_totals IMMEDIATE;
   SET CONSTRAINTS trg_recalculate_individual_seller_offer_totals DEFERRED;
   PERFORM set_config('app.seller_offer_internal_discount','0',true);
 END IF;
 UPDATE public.offers SET partner_approval_status=p_decision,
 partner_approved_by=CASE WHEN p_decision='approved' THEN public.current_employee_id() END,
 partner_approved_at=CASE WHEN p_decision='approved' THEN now() END WHERE id=p_offer_id;
 UPDATE public.seller_offer_reviews SET status=p_decision,source_key=public.seller_offer_source_key(p_offer_id),
 response_note=left(COALESCE(p_response,''),5000),date_checked=COALESCE((p_checks->>'date')::boolean,false),
 resources_checked=COALESCE((p_checks->>'resources')::boolean,false),capacity_checked=COALESCE((p_checks->>'capacity')::boolean,false),
 discount_percent=p_discount,discount_reason=left(COALESCE(p_reason,''),5000),reviewed_by=public.current_employee_id(),reviewed_at=now()
 WHERE offer_id=p_offer_id;
 INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
 VALUES(p_offer_id,v_o.sales_partner_id,p_decision,jsonb_build_object('document_id',p_document_id,'response',left(COALESCE(p_response,''),5000)));
END; $$;
REVOKE ALL ON FUNCTION public.review_seller_offer_resources(uuid,uuid,text,jsonb,text,numeric,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_seller_offer_resources(uuid,uuid,text,jsonb,text,numeric,boolean,text) TO authenticated;

CREATE TABLE public.seller_offer_review_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), offer_id uuid NOT NULL REFERENCES public.offers(id),
 details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.seller_offer_review_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_review_audit FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.audit_seller_offer_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 INSERT INTO public.seller_offer_review_audit(offer_id,details) VALUES(NEW.offer_id,to_jsonb(NEW));
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.audit_seller_offer_review() FROM PUBLIC;
CREATE TRIGGER seller_offer_review_audit AFTER INSERT OR UPDATE ON public.seller_offer_reviews
FOR EACH ROW EXECUTE FUNCTION public.audit_seller_offer_review();

CREATE OR REPLACE FUNCTION public.seller_offer_can_configure(p_offer_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.seller_offer_can_manage(p_offer_id) AND EXISTS(
 SELECT 1 FROM public.employees WHERE id=public.current_employee_id() AND is_active=true
 AND (role::text='admin' OR access_level::text='admin' OR 'admin'=ANY(COALESCE(permissions,'{}'::text[]))));
$$;
REVOKE ALL ON FUNCTION public.seller_offer_can_configure(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_offer_can_configure(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.configure_seller_offer_delivery(p_offer_id uuid,p_manager_id uuid,p_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_o record;
BEGIN
 IF NOT public.seller_offer_can_configure(p_offer_id) THEN RAISE EXCEPTION 'Konfigurację skrzynki i opiekuna zmienia administrator'; END IF;
 SELECT * INTO v_o FROM public.offers WHERE id=p_offer_id;
 IF p_manager_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.employees e WHERE e.id=p_manager_id AND e.is_active=true
   AND (e.role::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[])) OR 'offers_manage'=ANY(COALESCE(e.permissions,'{}'::text[])))
   AND (cardinality(COALESCE(e.my_company_ids,'{}'::uuid[]))=0 OR v_o.my_company_id=ANY(e.my_company_ids)
     OR e.role::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[])))
 ) THEN RAISE EXCEPTION 'Opiekun musi mieć aktywny dostęp do ofert tej marki'; END IF;
 IF p_account_id IS NOT NULL AND NOT EXISTS(
   SELECT 1 FROM public.employee_email_accounts a WHERE a.id=p_account_id AND a.is_active=true AND COALESCE(a.is_system_account,false)=false
 ) THEN RAISE EXCEPTION 'Wybierz aktywną, niesystemową skrzynkę sprzedawcy lub hotelu'; END IF;
 INSERT INTO public.seller_offer_delivery_settings(sales_partner_id,my_company_id,manager_id,email_account_id)
 VALUES(v_o.sales_partner_id,v_o.my_company_id,p_manager_id,p_account_id)
 ON CONFLICT(sales_partner_id,my_company_id) DO UPDATE SET manager_id=EXCLUDED.manager_id,email_account_id=EXCLUDED.email_account_id;
END; $$;
REVOKE ALL ON FUNCTION public.configure_seller_offer_delivery(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.configure_seller_offer_delivery(uuid,uuid,uuid) TO authenticated;


CREATE TABLE public.seller_offer_save_requests(
 sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id),
 request_id uuid NOT NULL,request_hash text NOT NULL,offer_id uuid NOT NULL REFERENCES public.offers(id),
 PRIMARY KEY(sales_partner_id,request_id));
ALTER TABLE public.seller_offer_save_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_offer_save_requests FROM anon,authenticated;
CREATE OR REPLACE FUNCTION public.save_seller_portal_offer_with_request(p_request_id uuid,p_offer jsonb,p_items jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_partner uuid:=public.current_sales_partner_id(); v_id uuid; v_hash text; v_payload text:=md5(p_offer::text||p_items::text);
BEGIN
 IF v_partner IS NULL OR p_request_id IS NULL THEN RAISE EXCEPTION 'Brak dostępu lub identyfikatora zapisu'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_partner::text||p_request_id::text,0));
 SELECT offer_id,request_hash INTO v_id,v_hash FROM public.seller_offer_save_requests WHERE sales_partner_id=v_partner AND request_id=p_request_id;
 IF FOUND THEN
   IF v_hash<>v_payload THEN RAISE EXCEPTION 'Poprzedni zapis już się zakończył. Otwórz zapisaną ofertę przed wprowadzeniem dalszych zmian.'; END IF;
   RETURN v_id;
 END IF;
 v_id:=public.save_seller_portal_offer(p_offer,p_items);
 INSERT INTO public.seller_offer_save_requests VALUES(v_partner,p_request_id,v_payload,v_id);
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.save_seller_portal_offer_with_request(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_seller_portal_offer_with_request(uuid,jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.claim_seller_offer_email(p_offer_id uuid,p_document_id uuid,p_actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_o record; v_id uuid;
BEGIN
 SELECT * INTO v_o FROM public.offers WHERE id=p_offer_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles WHERE id=v_o.sales_partner_id
   AND portal_auth_user_id=p_actor AND portal_enabled=true AND status='active') THEN RAISE EXCEPTION 'Brak dostępu'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sales_partner_brand_terms WHERE sales_partner_id=v_o.sales_partner_id AND my_company_id=v_o.my_company_id AND is_active=true)
 THEN RAISE EXCEPTION 'Dostęp do marki nie jest aktywny'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.seller_offer_reviews r JOIN public.seller_offer_documents d ON d.id=r.document_id
   WHERE r.offer_id=p_offer_id AND r.status='approved' AND d.id=p_document_id
   AND r.source_key=public.seller_offer_source_key(p_offer_id) AND d.source_key=r.source_key)
 THEN RAISE EXCEPTION 'Wyślij do opiekuna i uzyskaj akceptację aktualnej wersji'; END IF;
 INSERT INTO public.seller_offer_email_deliveries(document_id,recipient,status)
 VALUES(p_document_id,v_o.portal_client_email,'sending')
 ON CONFLICT(document_id) DO NOTHING RETURNING id INTO v_id;
 IF v_id IS NULL THEN RAISE EXCEPTION 'Wysyłka tej wersji już trwa lub została zarejestrowana. Sprawdź historię skrzynki przed ponowieniem.'; END IF;
 RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.claim_seller_offer_email(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_seller_offer_email(uuid,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_seller_offer_email(p_delivery_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_row record; v_partner uuid;
BEGIN
 SELECT x.*,d.offer_id,d.source_key INTO v_row FROM public.seller_offer_email_deliveries x
 JOIN public.seller_offer_documents d ON d.id=x.document_id WHERE x.id=p_delivery_id FOR UPDATE OF x;
 IF v_row.status='sent' THEN RETURN; END IF;
 UPDATE public.seller_offer_email_deliveries SET status='sent',sent_at=now() WHERE id=p_delivery_id;
 UPDATE public.offers SET status='sent',sent_at=now(),partner_last_activity_at=now()
 WHERE id=v_row.offer_id AND public.seller_offer_source_key(id)=v_row.source_key;
 SELECT sales_partner_id INTO v_partner FROM public.offers WHERE id=v_row.offer_id;
 INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
 VALUES(v_row.offer_id,v_partner,'sent',jsonb_build_object('document_id',v_row.document_id,'recipient',v_row.recipient));
END; $$;
REVOKE ALL ON FUNCTION public.complete_seller_offer_email(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_seller_offer_email(uuid) TO service_role;

GRANT ALL ON public.seller_offer_delivery_settings,public.seller_offer_documents,
 public.seller_offer_reviews,public.seller_offer_review_audit,
 public.seller_offer_email_deliveries,public.seller_offer_save_requests TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
