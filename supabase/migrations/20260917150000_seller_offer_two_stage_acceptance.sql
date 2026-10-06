BEGIN;

-- Requires the earlier handoff/notifications migrations. No historical offer
-- is approved, event downgraded, or notification marked unread by this migration.
DO $$ BEGIN
  IF to_regprocedure('public.create_event_from_seller_offer(uuid,text,integer,jsonb)') IS NULL
    OR to_regprocedure('public.notify_seller_realization_acceptance(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Najpierw uruchom migracje 20260911234500 oraz 20260911235000.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.seller_offer_handoff_version()
RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 2; $$;

-- Offer acceptance is commercial approval, NOT the separate CRM confirmation
-- of an event. Ordinary, non-portal offers keep their existing behavior.
CREATE OR REPLACE FUNCTION public.sync_event_status_from_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.event_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status::text='sent' THEN
    UPDATE public.events SET status='offer_sent',updated_at=now()
      WHERE id=NEW.event_id AND status::text IN ('inquiry','offer_to_send');
  ELSIF NEW.status::text='accepted' AND NEW.sales_channel IS DISTINCT FROM 'seller_portal' THEN
    UPDATE public.events SET status='offer_accepted',updated_at=now()
      WHERE id=NEW.event_id AND status::text IN ('inquiry','offer_to_send','offer_sent');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_seller_offer_review(p_offer_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers%ROWTYPE; r public.seller_offer_reviews%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.current_session_is_seller_portal(),true)
    OR NOT COALESCE(public.seller_offer_can_manage(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień do akceptacji oferty'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  SELECT * INTO r FROM public.seller_offer_reviews WHERE offer_id=p_offer_id FOR UPDATE;
  IF r.status IS DISTINCT FROM 'approved' OR r.document_id IS DISTINCT FROM p_document_id
    OR r.source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id) THEN
    RAISE EXCEPTION 'Decyzja nie dotyczy aktualnej oferty. Wczytaj i rozpatrz aktualną wersję.';
  END IF;
  IF o.status::text NOT IN ('draft','sent','viewed','accepted') THEN
    RAISE EXCEPTION 'Nie można zaakceptować odrzuconej, anulowanej lub wygasłej oferty.';
  END IF;
  IF o.event_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.events e
    WHERE e.id=o.event_id AND e.my_company_id=o.my_company_id AND e.status::text<>'cancelled') THEN
    RAISE EXCEPTION 'Powiązane wydarzenie jest anulowane lub ma niezgodną markę.';
  END IF;
  IF o.status::text<>'accepted' THEN
    UPDATE public.offers SET status='accepted',accepted_at=COALESCE(accepted_at,now()),partner_last_activity_at=now()
      WHERE id=p_offer_id;
    INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
      VALUES(p_offer_id,o.sales_partner_id,'accepted',jsonb_build_object(
        'source','crm_offer_acceptance','document_id',p_document_id,'actor',auth.uid(),
        'next_step','crm_realization_confirmation'));
  END IF;
  RETURN jsonb_build_object('offer_status','accepted','event_id',o.event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_seller_offer_and_accept(
  p_offer_id uuid,p_document_id uuid,p_decision text,p_checks jsonb,p_response text,
  p_discount numeric DEFAULT 0,p_special_request boolean DEFAULT false,p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR COALESCE(public.current_session_is_seller_portal(),true)
    OR NOT COALESCE(public.seller_offer_can_manage(p_offer_id),false) THEN RAISE EXCEPTION 'Brak uprawnień'; END IF;
  PERFORM 1 FROM public.offers WHERE id=p_offer_id FOR UPDATE;
  -- Retrying a committed decision must not reapply a discount.
  IF p_decision='approved' AND EXISTS (SELECT 1 FROM public.seller_offer_reviews r
    WHERE r.offer_id=p_offer_id AND r.document_id=p_document_id AND r.status='approved'
      AND r.source_key=public.seller_offer_source_key(p_offer_id)) THEN
    RETURN public.accept_seller_offer_review(p_offer_id,p_document_id);
  END IF;
  PERFORM public.review_seller_offer_resources(p_offer_id,p_document_id,p_decision,p_checks,
    p_response,p_discount,p_special_request,p_reason);
  IF p_decision='approved' THEN RETURN public.accept_seller_offer_review(p_offer_id,p_document_id); END IF;
  RETURN jsonb_build_object('success',true);
END;
$$;

-- Also make already-open, older CRM clients stop at commercial acceptance.
CREATE OR REPLACE FUNCTION public.review_seller_offer_and_confirm(
  p_offer_id uuid,p_document_id uuid,p_decision text,p_checks jsonb,p_response text,
  p_discount numeric DEFAULT 0,p_special_request boolean DEFAULT false,p_reason text DEFAULT '')
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT public.review_seller_offer_and_accept(p_offer_id,p_document_id,p_decision,p_checks,
    p_response,p_discount,p_special_request,p_reason);
$$;

-- The final decision needs event-management rights in the same brand. A missing
-- event must be created explicitly through the prefilled CRM form instead.
CREATE OR REPLACE FUNCTION public.confirm_seller_offer_realization(p_offer_id uuid,p_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers%ROWTYPE; r public.seller_offer_reviews%ROWTYPE; e public.events%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_create_event(p_offer_id),false) THEN
    RAISE EXCEPTION 'Potwierdzenie realizacji wymaga uprawnień do ofert i wydarzeń tej marki';
  END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal' FOR UPDATE;
  SELECT * INTO r FROM public.seller_offer_reviews WHERE offer_id=p_offer_id FOR UPDATE;
  IF o.status::text<>'accepted' OR r.status IS DISTINCT FROM 'approved'
    OR r.document_id IS DISTINCT FROM p_document_id OR r.source_key IS DISTINCT FROM public.seller_offer_source_key(p_offer_id) THEN
    RAISE EXCEPTION 'Najpierw zaakceptuj aktualną ofertę.';
  END IF;
  IF o.event_id IS NULL THEN RAISE EXCEPTION 'Otwórz formularz wydarzenia, uzupełnij dane i osobno potwierdź realizację.'; END IF;
  SELECT * INTO STRICT e FROM public.events WHERE id=o.event_id FOR UPDATE;
  IF e.my_company_id IS DISTINCT FROM o.my_company_id OR NOT COALESCE(public.current_employee_can_view_event(e.id),false) THEN
    RAISE EXCEPTION 'Brak dostępu do powiązanego wydarzenia tej marki';
  END IF;
  IF e.status::text NOT IN ('inquiry','offer_to_send','offer_sent','offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled') THEN
    RAISE EXCEPTION 'Nie można potwierdzić wydarzenia w tym statusie. Anulowane wydarzenie nie zostanie przywrócone.';
  END IF;
  IF e.status::text IN ('inquiry','offer_to_send','offer_sent') THEN
    UPDATE public.events SET status='offer_accepted',updated_at=now() WHERE id=e.id;
    UPDATE public.offers SET partner_last_activity_at=now(),updated_at=now() WHERE id=p_offer_id;
    INSERT INTO public.partner_offer_activities(offer_id,sales_partner_id,activity_type,metadata)
      VALUES(p_offer_id,o.sales_partner_id,'accepted',jsonb_build_object(
        'source','crm_realization_confirmation','event_id',e.id,'document_id',p_document_id,'actor',auth.uid()));
  END IF;
  RETURN jsonb_build_object('offer_status','accepted','event_id',e.id,'stage','confirmed');
END;
$$;

-- Manager-only settings leave any historical mailbox assignment untouched.
CREATE OR REPLACE FUNCTION public.configure_seller_offer_manager(p_offer_id uuid,p_manager_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers%ROWTYPE;
BEGIN
  IF NOT COALESCE(public.seller_offer_can_configure(p_offer_id),false) THEN RAISE EXCEPTION 'Opiekuna zmienia administrator'; END IF;
  SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer_id AND sales_channel='seller_portal';
  IF p_manager_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.employees e WHERE e.id=p_manager_id AND e.is_active
    AND (e.role::text='admin' OR e.access_level::text='admin' OR COALESCE(e.permissions,'{}'::text[]) && ARRAY['admin','offers_manage']::text[])
    AND (cardinality(COALESCE(e.my_company_ids,'{}'::uuid[]))=0 OR o.my_company_id=ANY(e.my_company_ids)
      OR e.role::text='admin' OR e.access_level::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[])))) THEN
    RAISE EXCEPTION 'Opiekun musi mieć aktywny dostęp do ofert tej marki';
  END IF;
  INSERT INTO public.seller_offer_delivery_settings(sales_partner_id,my_company_id,manager_id)
    VALUES(o.sales_partner_id,o.my_company_id,p_manager_id)
    ON CONFLICT(sales_partner_id,my_company_id) DO UPDATE SET manager_id=EXCLUDED.manager_id;
END;
$$;

-- One notice for acceptance and a separate one for actual CRM confirmation.
-- Event status remains the source of truth; existing operational events retain
-- their stage, and regeneration/duplicate clicks never resend the same notice.
CREATE OR REPLACE FUNCTION public.notify_seller_realization_acceptance(p_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o record; v_notice uuid; v_key text; v_confirmed boolean; v_stage text;
BEGIN
  SELECT x.id,x.sales_partner_id,x.my_company_id,x.offer_number,x.title,x.event_id,
    p.portal_auth_user_id,r.reviewed_at,b.name AS brand_name,e.status::text AS event_status INTO o
  FROM public.offers x
  JOIN public.sales_partner_profiles p ON p.id=x.sales_partner_id AND p.portal_enabled AND p.status='active'
  JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id AND t.my_company_id=x.my_company_id AND t.is_active
  JOIN public.seller_offer_reviews r ON r.offer_id=x.id AND r.status='approved'
  JOIN public.my_companies b ON b.id=x.my_company_id
  JOIN auth.users u ON u.id=p.portal_auth_user_id
  LEFT JOIN public.events e ON e.id=x.event_id AND e.my_company_id=x.my_company_id
  WHERE x.id=p_offer_id AND x.sales_channel='seller_portal' AND x.status::text='accepted';
  IF NOT FOUND OR o.event_status='cancelled' THEN RETURN; END IF;
  v_confirmed:=COALESCE(o.event_status IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled'),false);
  v_stage:=CASE WHEN v_confirmed THEN 'realization_confirmed' ELSE 'realization_accepted' END;
  v_key:=o.id::text||':'||o.portal_auth_user_id::text||':'||v_stage||':'||
    CASE WHEN v_confirmed THEN o.event_id::text ELSE COALESCE(extract(epoch FROM o.reviewed_at)::text,'accepted') END;
  INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
    VALUES(CASE WHEN v_confirmed THEN 'Realizacja potwierdzona przez CRM' ELSE 'Oferta zaakceptowana — realizacja oczekuje na potwierdzenie CRM' END,
      concat_ws(' · ',COALESCE(o.offer_number,o.title,'Oferta'),o.brand_name)||
        CASE WHEN v_confirmed THEN '. CRM potwierdził wydarzenie. Otwórz ustalenia i rozmowę.'
          ELSE '. Oferta trafiła do Realizacji. To jeszcze nie jest potwierdzenie wydarzenia.' END,
      'info','offer','/seller/realizations/'||o.id::text||'#seller-offer-review','offer',o.id,
      jsonb_build_object('workflow','seller_review_result','event',v_stage,'decision','approved',
        'offer_id',o.id,'sales_partner_id',o.sales_partner_id,'my_company_id',o.my_company_id,
        'reviewed_at',o.reviewed_at,'seller_realization_key',v_key))
    ON CONFLICT DO NOTHING RETURNING id INTO v_notice;
  IF v_notice IS NOT NULL THEN
    INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
      VALUES(v_notice,o.portal_auth_user_id,false) ON CONFLICT(notification_id,user_id) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_seller_linked_realization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.sales_channel='seller_portal' AND NEW.event_id IS NOT NULL AND NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    PERFORM public.notify_seller_realization_acceptance(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS seller_linked_realization_notification ON public.offers;
CREATE TRIGGER seller_linked_realization_notification AFTER UPDATE OF event_id ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.notify_seller_linked_realization();

CREATE OR REPLACE FUNCTION public.notify_seller_confirmed_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    AND OLD.status::text NOT IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled')
    AND NEW.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled') THEN
    FOR v_offer IN SELECT id FROM public.offers WHERE event_id=NEW.id AND my_company_id=NEW.my_company_id
      AND sales_channel='seller_portal' AND status::text='accepted' LOOP
      PERFORM public.notify_seller_realization_acceptance(v_offer);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS seller_event_confirmation_notification ON public.events;
CREATE TRIGGER seller_event_confirmation_notification AFTER UPDATE OF status ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.notify_seller_confirmed_event();

-- Correct only misleading unread legacy titles, without resending anything.
UPDATE public.notifications n SET title='Oferta zaakceptowana — realizacja oczekuje na potwierdzenie CRM',
  message='Oferta trafiła do Realizacji. Oczekuje na osobne potwierdzenie wydarzenia przez CRM.'
FROM public.offers o
WHERE n.related_entity_id::text=o.id::text AND n.related_entity_type='offer'
  AND n.metadata->>'event'='realization_accepted' AND o.sales_channel='seller_portal' AND o.status::text='accepted'
  AND NOT EXISTS (SELECT 1 FROM public.events e WHERE e.id=o.event_id AND e.my_company_id=o.my_company_id
    AND e.status::text IN ('offer_accepted','in_preparation','ready_for_live','in_progress','completed','invoiced','settled','cancelled'))
  AND EXISTS (SELECT 1 FROM public.notification_recipients nr WHERE nr.notification_id=n.id AND NOT nr.is_read);

REVOKE ALL ON FUNCTION public.seller_offer_handoff_version(),public.accept_seller_offer_review(uuid,uuid),
  public.review_seller_offer_and_accept(uuid,uuid,text,jsonb,text,numeric,boolean,text),
  public.review_seller_offer_and_confirm(uuid,uuid,text,jsonb,text,numeric,boolean,text),
  public.confirm_seller_offer_realization(uuid,uuid),public.configure_seller_offer_manager(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_offer_handoff_version(),public.accept_seller_offer_review(uuid,uuid),
  public.review_seller_offer_and_accept(uuid,uuid,text,jsonb,text,numeric,boolean,text),
  public.review_seller_offer_and_confirm(uuid,uuid,text,jsonb,text,numeric,boolean,text),
  public.confirm_seller_offer_realization(uuid,uuid),public.configure_seller_offer_manager(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.notify_seller_realization_acceptance(uuid),public.notify_seller_linked_realization(),
  public.notify_seller_confirmed_event() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
