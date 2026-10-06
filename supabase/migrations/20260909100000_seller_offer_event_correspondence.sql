BEGIN;

DO $$ BEGIN
 IF to_regclass('public.seller_conversations') IS NULL
   OR to_regprocedure('public.seller_conversation_access(uuid,boolean)') IS NULL THEN
   RAISE EXCEPTION 'Najpierw zastosuj poprawioną migrację 20260909090000_seller_workspace_and_chat.sql.';
 END IF;
END; $$;

-- One conversation per offer for its entire lifetime. The existing offer ->
-- event relationship also exposes that same conversation in the event. There
-- is no copy of messages or read cursors and no dependency on a sales status.
-- General conversations (offer_id IS NULL) never become event correspondence.
CREATE OR REPLACE FUNCTION public.seller_conversation_summary(p_conversation uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object(
   'id',c.id,'my_company_id',c.my_company_id,'brand_name',b.name,'offer_id',c.offer_id,
   'title',CASE WHEN c.offer_id IS NULL THEN 'Rozmowa ogólna' ELSE COALESCE(o.offer_number,o.title,'Oferta') END,
   'offer_title',o.title,
   'has_event',e.id IS NOT NULL,
   -- A seller can see the stage of their offer, not internal event records.
   'event_id',CASE WHEN access.can_view_event THEN e.id END,
   'event_name',CASE WHEN access.can_view_event THEN e.name END,
   'can_view_event',access.can_view_event,
   'last_message',last_message.body,'last_at',last_message.created_at,
   'can_send',public.seller_conversation_access(c.id,true),
   'unread',(SELECT count(*) FROM public.seller_messages m WHERE m.conversation_id=c.id
     AND m.sender_kind=CASE WHEN public.current_session_is_seller_portal() THEN 'crm' ELSE 'seller' END
     AND m.seq>COALESCE(r.last_read_seq,0)))
 FROM public.seller_conversations c
 JOIN public.my_companies b ON b.id=c.my_company_id
 LEFT JOIN public.offers o ON o.id=c.offer_id AND o.sales_partner_id=c.sales_partner_id AND o.my_company_id=c.my_company_id
 LEFT JOIN public.events e ON e.id=o.event_id AND e.my_company_id=c.my_company_id
 CROSS JOIN LATERAL (SELECT COALESCE(e.id IS NOT NULL
   AND NOT public.current_session_is_seller_portal()
   AND public.current_employee_can_view_event(e.id),false) AS can_view_event) access
 LEFT JOIN public.seller_message_reads r ON r.conversation_id=c.id AND r.user_id=auth.uid()
 LEFT JOIN LATERAL (SELECT body,created_at FROM public.seller_messages
   WHERE conversation_id=c.id ORDER BY seq DESC LIMIT 1) last_message ON true
 WHERE c.id=p_conversation AND public.seller_conversation_access(c.id);
$$;

CREATE OR REPLACE FUNCTION public.list_seller_conversations(p_partner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(public.seller_conversation_summary(c.id)
   ORDER BY latest.seq DESC NULLS LAST,c.id),'[]'::jsonb)
 FROM public.seller_conversations c
 LEFT JOIN LATERAL (SELECT seq FROM public.seller_messages
   WHERE conversation_id=c.id ORDER BY seq DESC LIMIT 1) latest ON true
 WHERE c.sales_partner_id=p_partner AND public.seller_conversation_access(c.id);
$$;

CREATE OR REPLACE FUNCTION public.get_event_seller_correspondence(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_offers jsonb;
BEGIN
 IF public.current_session_is_seller_portal()
   OR NOT COALESCE(public.current_employee_can_view_event(p_event),false) THEN
   RAISE EXCEPTION 'Brak dostępu do ustaleń tego wydarzenia';
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
   'id',o.id,'my_company_id',o.my_company_id,'brand_name',b.name,
   'title',o.title,'offer_number',o.offer_number,
   'sales_partner_id',o.sales_partner_id,
   'partner_name',COALESCE(NULLIF(contact.full_name,''),NULLIF(btrim(concat_ws(' ',employee.name,employee.surname)),''),'Sprzedawca'),
   'can_start',public.seller_workspace_brand_access(o.sales_partner_id,o.my_company_id,true),
   'conversation',public.seller_conversation_summary(c.id)
 ) ORDER BY o.created_at DESC,o.id),'[]'::jsonb) INTO v_offers
 FROM public.offers o
 JOIN public.events e ON e.id=o.event_id AND e.my_company_id=o.my_company_id
 JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id
 JOIN public.my_companies b ON b.id=o.my_company_id
 LEFT JOIN public.contacts contact ON contact.id=p.contact_id
 LEFT JOIN public.employees employee ON employee.id=p.employee_id
 LEFT JOIN public.seller_conversations c ON c.offer_id=o.id
   AND c.sales_partner_id=o.sales_partner_id AND c.my_company_id=o.my_company_id
 WHERE o.event_id=p_event
   AND public.seller_workspace_brand_access(o.sales_partner_id,o.my_company_id);
 RETURN jsonb_build_object('offers',v_offers);
END; $$;

REVOKE ALL ON FUNCTION public.seller_conversation_summary(uuid),
 public.list_seller_conversations(uuid),public.get_event_seller_correspondence(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_conversation_summary(uuid),
 public.list_seller_conversations(uuid),public.get_event_seller_correspondence(uuid) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
