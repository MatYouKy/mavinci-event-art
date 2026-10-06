BEGIN;

DO $$ BEGIN
 IF to_regclass('public.sales_partner_profiles') IS NULL
   OR to_regclass('public.seller_offer_reviews') IS NULL
   OR to_regclass('public.seller_offer_delivery_settings') IS NULL THEN
   RAISE EXCEPTION 'Najpierw zastosuj wcześniejsze migracje katalogu sprzedawców i akceptacji ofert (20260907131000 oraz 20260908233000 wraz z późniejszymi poprawkami).';
 END IF;
END; $$;

-- CRM uses the employee's existing permissions AND company scope. A portal
-- session never inherits CRM access, even if an old employee row still exists.
CREATE OR REPLACE FUNCTION public.seller_workspace_staff_access(p_company uuid, p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT NOT public.current_session_is_seller_portal() AND EXISTS (
   SELECT 1 FROM public.employees e WHERE e.id=public.current_employee_id() AND e.is_active=true
   AND public.current_employee_can_access_company(p_company)
   AND (e.role::text='admin' OR e.access_level::text='admin' OR 'admin'=ANY(COALESCE(e.permissions,'{}'::text[]))
     OR COALESCE(e.permissions,'{}'::text[]) && CASE WHEN p_write
       THEN ARRAY['contacts_manage','offers_manage']
       ELSE ARRAY['contacts_view','contacts_manage','offers_view','offers_manage','finances_view','finances_manage'] END)
 );
$$;

CREATE OR REPLACE FUNCTION public.seller_workspace_brand_access(p_partner uuid,p_company uuid,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.sales_partner_brand_terms t
   WHERE t.sales_partner_id=p_partner AND t.my_company_id=p_company
   AND ((t.is_active AND p_partner=public.current_sales_partner_id())
     OR public.seller_workspace_staff_access(p_company,p_write)));
$$;

CREATE OR REPLACE FUNCTION public.seller_workspace_offers_access(p_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT public.seller_workspace_staff_access(p_company) AND EXISTS (
   SELECT 1 FROM public.employees e WHERE e.id=public.current_employee_id()
   AND (e.role::text='admin' OR e.access_level::text='admin'
     OR COALESCE(e.permissions,'{}'::text[]) && ARRAY['admin','offers_view','offers_manage'])
 );
$$;

CREATE TABLE IF NOT EXISTS public.seller_conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 sales_partner_id uuid NOT NULL REFERENCES public.sales_partner_profiles(id),
 my_company_id uuid NOT NULL REFERENCES public.my_companies(id),
 offer_id uuid REFERENCES public.offers(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seller_conversation_general ON public.seller_conversations(sales_partner_id,my_company_id) WHERE offer_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS seller_conversation_offer ON public.seller_conversations(offer_id) WHERE offer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.seller_messages (
 id uuid PRIMARY KEY,
 seq bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 conversation_id uuid NOT NULL REFERENCES public.seller_conversations(id),
 sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 sender_kind text NOT NULL CHECK(sender_kind IN ('seller','crm')),
 sender_name text NOT NULL,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS seller_messages_conversation_seq ON public.seller_messages(conversation_id,seq DESC);
CREATE TABLE IF NOT EXISTS public.seller_message_reads (
 conversation_id uuid NOT NULL REFERENCES public.seller_conversations(id),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 last_read_seq bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(conversation_id,user_id)
);

CREATE OR REPLACE FUNCTION public.seller_conversation_access(p_conversation uuid,p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS (SELECT 1 FROM public.seller_conversations c WHERE c.id=p_conversation
   AND public.seller_workspace_brand_access(c.sales_partner_id,c.my_company_id,p_write));
$$;

ALTER TABLE public.seller_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_message_reads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.seller_conversations,public.seller_messages,public.seller_message_reads FROM anon,authenticated;
GRANT SELECT ON public.seller_conversations,public.seller_messages,public.seller_message_reads TO authenticated;
GRANT ALL ON public.seller_conversations,public.seller_messages,public.seller_message_reads TO service_role;
DROP POLICY IF EXISTS seller_conversation_read ON public.seller_conversations;
CREATE POLICY seller_conversation_read ON public.seller_conversations FOR SELECT TO authenticated
 USING(public.seller_workspace_brand_access(sales_partner_id,my_company_id));
DROP POLICY IF EXISTS seller_message_read ON public.seller_messages;
CREATE POLICY seller_message_read ON public.seller_messages FOR SELECT TO authenticated
 USING(public.seller_conversation_access(conversation_id));
DROP POLICY IF EXISTS seller_read_cursor_self ON public.seller_message_reads;
CREATE POLICY seller_read_cursor_self ON public.seller_message_reads FOR SELECT TO authenticated
 USING(user_id=auth.uid() AND public.seller_conversation_access(conversation_id));

-- Conversations and messages cannot be edited/deleted by either side.
CREATE OR REPLACE FUNCTION public.open_seller_conversation(p_partner uuid,p_company uuid,p_offer uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.seller_workspace_brand_access(p_partner,p_company,true) THEN RAISE EXCEPTION 'Brak dostępu do rozmowy tej marki'; END IF;
 IF p_offer IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.offers WHERE id=p_offer
   AND sales_partner_id=p_partner AND my_company_id=p_company)
 THEN RAISE EXCEPTION 'Oferta nie należy do tego sprzedawcy i marki'; END IF;
 -- Serialize creation of the same conversation, including a general thread.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_partner::text||p_company::text||COALESCE(p_offer::text,'general'),0));
 SELECT id INTO v_id FROM public.seller_conversations WHERE sales_partner_id=p_partner
   AND my_company_id=p_company AND offer_id IS NOT DISTINCT FROM p_offer;
 IF v_id IS NULL THEN
   INSERT INTO public.seller_conversations(sales_partner_id,my_company_id,offer_id)
   VALUES(p_partner,p_company,p_offer) RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.list_seller_conversations(p_partner uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT COALESCE(jsonb_agg(x.row ORDER BY x.latest_seq DESC NULLS LAST,x.id),'[]'::jsonb) FROM (
   SELECT c.id,last_message.seq AS latest_seq,jsonb_build_object(
     'id',c.id,'my_company_id',c.my_company_id,'brand_name',b.name,'offer_id',c.offer_id,
     'title',CASE WHEN c.offer_id IS NULL THEN 'Rozmowa ogólna' ELSE COALESCE(o.offer_number,o.title,'Oferta') END,
     'last_message',last_message.body,'last_at',last_message.created_at,
     'can_send',public.seller_conversation_access(c.id,true),
     'unread',(SELECT count(*) FROM public.seller_messages m WHERE m.conversation_id=c.id
       AND m.sender_kind=CASE WHEN public.current_session_is_seller_portal() THEN 'crm' ELSE 'seller' END
       AND m.seq>COALESCE(r.last_read_seq,0))) AS row
   FROM public.seller_conversations c JOIN public.my_companies b ON b.id=c.my_company_id
   LEFT JOIN public.offers o ON o.id=c.offer_id
   LEFT JOIN public.seller_message_reads r ON r.conversation_id=c.id AND r.user_id=auth.uid()
   LEFT JOIN LATERAL (SELECT seq,body,created_at FROM public.seller_messages
     WHERE conversation_id=c.id ORDER BY seq DESC LIMIT 1) last_message ON true
   WHERE c.sales_partner_id=p_partner AND public.seller_conversation_access(c.id)
 ) x;
$$;

CREATE OR REPLACE FUNCTION public.get_seller_messages(p_conversation uuid,p_before bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_rows jsonb;
BEGIN
 IF NOT public.seller_conversation_access(p_conversation) THEN RAISE EXCEPTION 'Brak dostępu do rozmowy'; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.seq),'[]'::jsonb) INTO v_rows FROM (
   SELECT id,seq,sender_kind,sender_name,body,created_at,sender_user_id=auth.uid() AS own
   FROM public.seller_messages WHERE conversation_id=p_conversation AND (p_before IS NULL OR seq<p_before)
   ORDER BY seq DESC LIMIT 50
 ) m;
 RETURN v_rows;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_seller_conversation_read(p_conversation uuid,p_through bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT public.seller_conversation_access(p_conversation) THEN RAISE EXCEPTION 'Brak dostępu do rozmowy'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.seller_messages WHERE conversation_id=p_conversation AND seq=p_through)
 THEN RETURN; END IF;
 INSERT INTO public.seller_message_reads(conversation_id,user_id,last_read_seq)
 VALUES(p_conversation,auth.uid(),p_through) ON CONFLICT(conversation_id,user_id)
 DO UPDATE SET last_read_seq=greatest(public.seller_message_reads.last_read_seq,EXCLUDED.last_read_seq);
 UPDATE public.notification_recipients r SET is_read=true,read_at=now()
 -- Notification entity IDs may be text (including non-UUID identifiers).
 FROM public.notifications n JOIN public.seller_messages m ON n.related_entity_id::text=m.id::text
 WHERE r.notification_id=n.id AND r.user_id=auth.uid() AND NOT r.is_read
 AND n.metadata->>'workflow'='seller_chat' AND m.conversation_id=p_conversation AND m.seq<=p_through;
END; $$;

CREATE OR REPLACE FUNCTION public.send_seller_message(p_conversation uuid,p_message_id uuid,p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_c record; v_kind text; v_name text; v_seq bigint; v_notice uuid; v_recipients uuid[]; v_url text;
BEGIN
 IF NOT public.seller_conversation_access(p_conversation,true) THEN RAISE EXCEPTION 'Brak uprawnień do wysłania wiadomości'; END IF;
 IF length(btrim(COALESCE(p_body,''))) NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Wiadomość musi mieć od 1 do 10 000 znaków'; END IF;
 -- Idempotency also covers retries after a lost response.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_message_id::text,1));
 IF EXISTS(SELECT 1 FROM public.seller_messages WHERE id=p_message_id) THEN
   IF EXISTS(SELECT 1 FROM public.seller_messages WHERE id=p_message_id AND conversation_id=p_conversation
     AND sender_user_id=auth.uid() AND body=btrim(p_body)) THEN RETURN p_message_id; END IF;
   RAISE EXCEPTION 'Identyfikator wiadomości został już wykorzystany';
 END IF;
 -- Lock before allocating seq: read cursors cannot skip a concurrent uncommitted message.
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
     SELECT e.employee_id FROM eligible e JOIN public.seller_offer_delivery_settings s ON s.manager_id=e.employee_id
     WHERE s.sales_partner_id=v_c.sales_partner_id AND s.my_company_id=v_c.my_company_id
   ) SELECT array_agg(DISTINCT user_id) INTO v_recipients FROM eligible
   WHERE is_admin OR employee_id IN (SELECT employee_id FROM manager) OR NOT EXISTS(SELECT 1 FROM manager);
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
END; $$;

-- Each pending review counts once, regardless of how many PDF notifications exist.
-- Reading its notification does not dismiss the pending decision.
CREATE OR REPLACE FUNCTION public.get_seller_inbox()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 WITH items AS (
   SELECT 'review:'||r.offer_id AS id,'review'::text AS kind,o.sales_partner_id,
     COALESCE(o.offer_number,o.title,'Oferta') AS title,1::bigint AS count,r.requested_at AS created_at,
     '/crm/offers/'||o.id||'?document='||r.document_id||'&preview=1#seller-offer-review' AS action_url,
     NULL::uuid AS recipient_id,NULL::uuid AS conversation_id,o.id AS offer_id
   FROM public.seller_offer_reviews r JOIN public.offers o ON o.id=r.offer_id
   WHERE r.status='pending' AND public.seller_offer_can_manage(o.id)
     AND public.seller_workspace_offers_access(o.my_company_id)
   UNION ALL
   SELECT 'chat:'||c.id,'message',c.sales_partner_id,
     CASE WHEN c.offer_id IS NULL THEN 'Rozmowa ogólna' ELSE COALESCE(o.offer_number,o.title,'Rozmowa o ofercie') END,
     count(*),max(m.created_at),CASE WHEN public.current_session_is_seller_portal() THEN '/seller/messages?conversation='||c.id
       WHEN p.contact_id IS NOT NULL THEN '/crm/contacts/'||p.contact_id||'?tab=seller&conversation='||c.id
       ELSE '/crm/salespeople?seller='||p.id||'&conversation='||c.id END,NULL::uuid,c.id,c.offer_id
   FROM public.seller_conversations c JOIN public.sales_partner_profiles p ON p.id=c.sales_partner_id
   LEFT JOIN public.offers o ON o.id=c.offer_id
   JOIN public.seller_messages m ON m.conversation_id=c.id
   LEFT JOIN public.seller_message_reads r ON r.conversation_id=c.id AND r.user_id=auth.uid()
   WHERE public.seller_conversation_access(c.id) AND m.seq>COALESCE(r.last_read_seq,0)
     AND m.sender_kind=CASE WHEN public.current_session_is_seller_portal() THEN 'crm' ELSE 'seller' END
   GROUP BY c.id,p.id,o.id
   UNION ALL
   SELECT 'notice:'||nr.id,'notification',p.id,n.title,1,n.created_at,n.action_url,nr.id,NULL::uuid,o.id
   FROM public.notification_recipients nr JOIN public.notifications n ON n.id=nr.notification_id
   JOIN public.sales_partner_profiles p ON p.id::text=n.metadata->>'sales_partner_id'
   LEFT JOIN public.offers o ON o.id::text=n.related_entity_id::text
   WHERE nr.user_id=auth.uid() AND NOT nr.is_read AND n.metadata->>'workflow' IN ('seller_offer','seller_review_result')
     AND ((public.current_session_is_seller_portal() AND p.id=public.current_sales_partner_id()
       AND EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=p.id AND t.my_company_id=o.my_company_id AND t.is_active))
       OR public.seller_workspace_offers_access(o.my_company_id))
     AND NOT EXISTS(SELECT 1 FROM public.seller_offer_reviews r WHERE r.offer_id=o.id AND r.status='pending')
     AND (n.metadata->>'workflow'<>'seller_offer' OR n.title<>'Zapytanie sprzedawcy: termin i zasoby')
 ) SELECT COALESCE(jsonb_agg(to_jsonb(items) ORDER BY created_at DESC,id),'[]'::jsonb) FROM items;
$$;

CREATE OR REPLACE FUNCTION public.get_crm_seller_workspace(p_partner uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_brands jsonb; v_offers jsonb; v_events jsonb;
BEGIN
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',t.my_company_id,'name',b.name,
   'can_chat',public.seller_workspace_staff_access(t.my_company_id,true)) ORDER BY b.name),'[]'::jsonb) INTO v_brands
 FROM public.sales_partner_brand_terms t JOIN public.my_companies b ON b.id=t.my_company_id
 WHERE t.sales_partner_id=p_partner AND public.seller_workspace_staff_access(t.my_company_id);
 IF v_brands='[]'::jsonb THEN RAISE EXCEPTION 'Brak dostępu do sprzedaży tego sprzedawcy w przypisanych markach'; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',o.id,'title',o.title,'offer_number',o.offer_number,
   'my_company_id',o.my_company_id,'brand_name',b.name,'status',o.status,'created_at',o.created_at,
   'client_name',COALESCE(NULLIF(o.portal_client_company,''),o.portal_client_name),
   'event_date',o.event_date,'event_id',o.event_id,'client_total_net',o.client_total_net,
   'partner_base_net',o.partner_base_net,'generated_at',o.partner_generated_at,
   'review_status',r.status,'document_id',r.document_id) ORDER BY o.created_at DESC,o.id),'[]'::jsonb) INTO v_offers
 FROM public.offers o JOIN public.my_companies b ON b.id=o.my_company_id
 LEFT JOIN public.seller_offer_reviews r ON r.offer_id=o.id
 WHERE o.sales_partner_id=p_partner AND public.seller_workspace_offers_access(o.my_company_id);
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'event_date',e.event_date,
   'status',e.status,'my_company_id',e.my_company_id,'brand_name',b.name) ORDER BY e.event_date DESC,e.id),'[]'::jsonb) INTO v_events
 FROM public.events e LEFT JOIN public.my_companies b ON b.id=e.my_company_id
 WHERE public.current_employee_can_view_event(e.id) AND public.seller_workspace_staff_access(e.my_company_id)
 AND (EXISTS(SELECT 1 FROM public.offers o WHERE o.event_id=e.id AND o.sales_partner_id=p_partner)
   OR EXISTS(SELECT 1 FROM public.event_commissions c WHERE c.event_id=e.id AND c.sales_partner_id=p_partner AND c.status<>'cancelled'));
 RETURN jsonb_build_object('brands',v_brands,'offers',v_offers,'events',v_events,
   'can_view_offers',EXISTS(SELECT 1 FROM public.sales_partner_brand_terms t WHERE t.sales_partner_id=p_partner AND public.seller_workspace_offers_access(t.my_company_id)));
END; $$;

CREATE OR REPLACE FUNCTION public.notify_seller_review_decision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_o record; v_notice uuid;
BEGIN
 IF NEW.status='pending' OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
 SELECT o.id,o.sales_partner_id,o.offer_number,o.title,p.portal_auth_user_id INTO v_o FROM public.offers o
 JOIN public.sales_partner_profiles p ON p.id=o.sales_partner_id WHERE o.id=NEW.offer_id AND p.portal_enabled AND p.status='active';
 IF v_o.portal_auth_user_id IS NULL OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=v_o.portal_auth_user_id) THEN RETURN NEW; END IF;
 INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
 VALUES(CASE NEW.status WHEN 'approved' THEN 'Oferta zaakceptowana przez opiekuna' WHEN 'changes_requested' THEN 'Opiekun prosi o zmiany oferty' ELSE 'Opiekun odrzucił zapytanie' END,
   COALESCE(v_o.offer_number,v_o.title,'Oferta'),'info','offer','/seller/offers/'||NEW.offer_id,
   'offer',NEW.offer_id,jsonb_build_object('workflow','seller_review_result','sales_partner_id',v_o.sales_partner_id)) RETURNING id INTO v_notice;
 INSERT INTO public.notification_recipients(notification_id,user_id,is_read) VALUES(v_notice,v_o.portal_auth_user_id,false);
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS seller_review_decision_notification ON public.seller_offer_reviews;
CREATE TRIGGER seller_review_decision_notification AFTER UPDATE ON public.seller_offer_reviews
 FOR EACH ROW EXECUTE FUNCTION public.notify_seller_review_decision();

REVOKE ALL ON FUNCTION public.seller_workspace_staff_access(uuid,boolean),public.seller_workspace_brand_access(uuid,uuid,boolean),
 public.seller_workspace_offers_access(uuid),
 public.seller_conversation_access(uuid,boolean),public.open_seller_conversation(uuid,uuid,uuid),public.list_seller_conversations(uuid),
 public.get_seller_messages(uuid,bigint),public.mark_seller_conversation_read(uuid,bigint),public.send_seller_message(uuid,uuid,text),
 public.get_seller_inbox(),public.get_crm_seller_workspace(uuid),public.notify_seller_review_decision() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.seller_workspace_staff_access(uuid,boolean),public.seller_workspace_brand_access(uuid,uuid,boolean),
 public.seller_workspace_offers_access(uuid),
 public.seller_conversation_access(uuid,boolean),public.open_seller_conversation(uuid,uuid,uuid),public.list_seller_conversations(uuid),
 public.get_seller_messages(uuid,bigint),public.mark_seller_conversation_read(uuid,bigint),public.send_seller_message(uuid,uuid,text),
 public.get_seller_inbox(),public.get_crm_seller_workspace(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.notify_seller_review_decision() FROM authenticated;

DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='seller_messages') THEN
     ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_messages;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='seller_message_reads') THEN
     ALTER PUBLICATION supabase_realtime ADD TABLE public.seller_message_reads;
   END IF;
 END IF;
END; $$;
NOTIFY pgrst,'reload schema';
COMMIT;
