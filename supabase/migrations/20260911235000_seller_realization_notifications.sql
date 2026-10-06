BEGIN;

-- Notification and acceptance commit together. A link uses the offer identity,
-- which is stable both before and after CRM finishes creating its event.
CREATE UNIQUE INDEX IF NOT EXISTS uq_seller_realization_notice_key
  ON public.notifications ((metadata->>'seller_realization_key'))
  WHERE metadata->>'seller_realization_key' IS NOT NULL;

CREATE OR REPLACE FUNCTION public.notify_seller_realization_acceptance(p_offer_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer record; v_notice uuid; v_key text;
BEGIN
  SELECT o.id,o.sales_partner_id,o.my_company_id,o.offer_number,o.title,
    p.portal_auth_user_id,r.reviewed_at,b.name AS brand_name INTO v_offer
  FROM public.offers o
  JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id AND p.portal_enabled AND p.status='active'
  JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id AND t.my_company_id=o.my_company_id AND t.is_active
  JOIN public.seller_offer_reviews r ON r.offer_id=o.id AND r.status='approved'
  JOIN public.my_companies b ON b.id=o.my_company_id
  JOIN auth.users u ON u.id=p.portal_auth_user_id
  WHERE o.id=p_offer_id AND o.sales_channel='seller_portal' AND o.status::text='accepted';
  IF NOT FOUND THEN RETURN; END IF;
  -- PDF regeneration and event creation do not issue a second acceptance notice.
  v_key:=v_offer.id::text||':'||v_offer.portal_auth_user_id::text||':'||COALESCE(extract(epoch FROM v_offer.reviewed_at)::text,'accepted');
  INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
    VALUES('Oferta zaakceptowana — realizacja potwierdzona',
      concat_ws(' · ',COALESCE(v_offer.offer_number,v_offer.title,'Oferta'),v_offer.brand_name)||'. Otwórz realizację, aby zobaczyć ustalenia i rozmowę z opiekunem.',
      'info','offer','/seller/realizations/'||v_offer.id::text||'#seller-offer-review','offer',v_offer.id,
      jsonb_build_object('workflow','seller_review_result','event','realization_accepted','decision','approved',
        'offer_id',v_offer.id,'sales_partner_id',v_offer.sales_partner_id,'my_company_id',v_offer.my_company_id,
        'reviewed_at',v_offer.reviewed_at,'seller_realization_key',v_key))
    ON CONFLICT DO NOTHING RETURNING id INTO v_notice;
  IF v_notice IS NULL THEN
    SELECT id INTO v_notice FROM public.notifications WHERE metadata->>'seller_realization_key'=v_key;
  END IF;
  IF v_notice IS NOT NULL THEN
    INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
      VALUES(v_notice,v_offer.portal_auth_user_id,false)
      ON CONFLICT(notification_id,user_id) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_seller_review_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offer record; v_notice uuid;
BEGIN
  IF NEW.status='pending' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status='approved' THEN
    -- During first confirmation offers.status is not accepted yet: the offer
    -- trigger below delivers after that transition. This also handles a new
    -- approval of a realization that was already accepted previously.
    PERFORM public.notify_seller_realization_acceptance(NEW.offer_id);
    RETURN NEW;
  END IF;
  SELECT o.id,o.sales_partner_id,o.my_company_id,o.offer_number,o.title,p.portal_auth_user_id INTO v_offer
  FROM public.offers o
  JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id AND p.portal_enabled AND p.status='active'
  JOIN public.sales_partner_brand_terms t ON t.sales_partner_id=p.id AND t.my_company_id=o.my_company_id AND t.is_active
  JOIN auth.users u ON u.id=p.portal_auth_user_id WHERE o.id=NEW.offer_id AND o.sales_channel='seller_portal';
  IF NOT FOUND THEN RETURN NEW; END IF;
  INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
    VALUES(CASE NEW.status WHEN 'changes_requested' THEN 'Opiekun prosi o zmiany oferty' ELSE 'Opiekun odrzucił zapytanie' END,
      COALESCE(v_offer.offer_number,v_offer.title,'Oferta'),'info','offer',
      '/seller/offers/'||NEW.offer_id::text||'#seller-offer-review','offer',NEW.offer_id,
      jsonb_build_object('workflow','seller_review_result','decision',NEW.status,'offer_id',NEW.offer_id,
        'sales_partner_id',v_offer.sales_partner_id,'my_company_id',v_offer.my_company_id)) RETURNING id INTO v_notice;
  INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
    VALUES(v_notice,v_offer.portal_auth_user_id,false);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_seller_accepted_offer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.sales_channel='seller_portal' AND NEW.status::text='accepted' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.notify_seller_realization_acceptance(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS seller_realization_accepted_notification ON public.offers;
CREATE TRIGGER seller_realization_accepted_notification AFTER UPDATE OF status ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.notify_seller_accepted_offer();

-- Repair links in still-unread legacy approvals only when the order really is
-- accepted. Do not create historical notifications or reset any read receipt.
UPDATE public.notifications n
SET action_url='/seller/realizations/'||o.id::text||'#seller-offer-review',
    metadata=n.metadata||jsonb_build_object('event','realization_accepted','decision','approved','offer_id',o.id)
FROM public.offers o JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id
WHERE n.related_entity_type='offer' AND n.related_entity_id::text=o.id::text
  AND n.metadata->>'workflow'='seller_review_result'
  AND n.metadata->>'sales_partner_id'=p.id::text
  AND n.title='Oferta zaakceptowana przez opiekuna'
  AND o.sales_channel='seller_portal' AND o.status::text='accepted'
  AND EXISTS (SELECT 1 FROM public.notification_recipients nr
    WHERE nr.notification_id=n.id AND nr.user_id=p.portal_auth_user_id AND NOT nr.is_read);

REVOKE ALL ON FUNCTION public.notify_seller_realization_acceptance(uuid),public.notify_seller_review_decision(),
  public.notify_seller_accepted_offer() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
