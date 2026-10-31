BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
CREATE OR REPLACE FUNCTION public.link_offer_context(p_offer uuid,p_event uuid DEFAULT NULL,p_inquiry uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE o public.offers; t public.tasks; target_event uuid; target_inquiry uuid;
BEGIN
 IF auth.uid() IS NULL OR NOT public.sales_can_manage_offer(p_offer) THEN RAISE EXCEPTION 'Brak uprawnień do powiązania oferty'; END IF;
 IF (p_event IS NULL) = (p_inquiry IS NULL) THEN RAISE EXCEPTION 'Wybierz wydarzenie albo zapytanie'; END IF;
 -- Lock the inquiry before the offer, as in the acceptance workflow.
 SELECT coalesce(p_inquiry,inquiry_id) INTO target_inquiry FROM public.offers WHERE id=p_offer;
 IF target_inquiry IS NOT NULL THEN
   SELECT * INTO STRICT t FROM public.tasks WHERE id=target_inquiry AND is_inquiry AND archived_at IS NULL FOR UPDATE;
   IF NOT public.can_manage_inquiry(t.inquiry_owner_id) THEN RAISE EXCEPTION 'Brak uprawnień do zapytania'; END IF;
 END IF;
 SELECT coalesce(p_event,event_id,t.event_id) INTO target_event FROM public.offers WHERE id=p_offer;
 IF target_event IS NOT NULL THEN
   PERFORM 1 FROM public.events WHERE id=target_event FOR UPDATE;
   IF NOT FOUND OR NOT public.current_employee_can_access_event_company(target_event) THEN RAISE EXCEPTION 'Brak dostępu do wydarzenia'; END IF;
 END IF;
 SELECT * INTO STRICT o FROM public.offers WHERE id=p_offer FOR UPDATE;
 IF NOT public.sales_can_manage_offer(o.id) OR o.sales_channel='seller_portal' THEN RAISE EXCEPTION 'Ta oferta nie może zostać powiązana w tym widoku'; END IF;
 IF (o.inquiry_id IS NOT NULL AND o.inquiry_id IS DISTINCT FROM target_inquiry)
   OR (o.event_id IS NOT NULL AND o.event_id IS DISTINCT FROM target_event) THEN
   RAISE EXCEPTION 'Oferta ma już inne powiązanie. Odśwież jej dane.';
 END IF;
 IF t.event_id IS NOT NULL AND t.event_id IS DISTINCT FROM target_event THEN RAISE EXCEPTION 'Zapytanie dotyczy innego wydarzenia'; END IF;
 IF NOT public.sales_can_manage_document(target_inquiry,target_event,o.created_by) THEN RAISE EXCEPTION 'Brak uprawnień do docelowego powiązania'; END IF;
 IF o.status='accepted' THEN
   IF t.accepted_offer_id IS NOT NULL AND t.accepted_offer_id<>o.id THEN RAISE EXCEPTION 'Zapytanie ma już inną zaakceptowaną ofertę'; END IF;
   IF EXISTS(SELECT 1 FROM public.offers WHERE event_id=target_event AND status='accepted' AND id<>o.id) THEN RAISE EXCEPTION 'Wydarzenie ma już inną zaakceptowaną ofertę'; END IF;
 END IF;
 IF o.event_id IS NOT DISTINCT FROM target_event AND o.inquiry_id IS NOT DISTINCT FROM target_inquiry THEN RETURN o.id; END IF;
 PERFORM set_config('mavinci.sales_decision','yes',true);
 UPDATE public.offers SET event_id=target_event,inquiry_id=target_inquiry,modified_after_generation=true WHERE id=o.id;
 IF target_inquiry IS NOT NULL THEN
   UPDATE public.tasks SET linked_offer_id=o.id,
     accepted_offer_id=CASE WHEN o.status='accepted' THEN o.id ELSE accepted_offer_id END,
     inquiry_stage=CASE WHEN o.status='accepted' THEN 'won' ELSE inquiry_stage END
   WHERE id=target_inquiry;
   PERFORM public.sales_log(target_inquiry,'offer','Powiązano istniejącą ofertę',jsonb_build_object('offer_id',o.id,'event_id',target_event));
 END IF;
 RETURN o.id;
END $$;
REVOKE ALL ON FUNCTION public.link_offer_context(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.link_offer_context(uuid,uuid,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
