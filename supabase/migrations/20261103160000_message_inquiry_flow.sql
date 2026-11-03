-- One canonical sales source for manual intake and AI; existing RLS remains authoritative.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS inquiry_source_key text;

CREATE OR REPLACE FUNCTION public.crm_inquiry_source_key(p_type text,p_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN p_type='received' THEN (
  SELECT 'email:'||md5(coalesce(nullif(btrim(e.message_id,'<> '),''),e.id::text)) FROM public.received_emails e WHERE e.id=p_id
 ) WHEN p_type='contact_form' THEN (
  SELECT 'contact_form:'||m.id::text FROM public.contact_messages m WHERE m.id=p_id
 ) END;
$$;
REVOKE ALL ON FUNCTION public.crm_inquiry_source_key(text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_inquiry_source_key(text,uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION private.set_inquiry_source_key() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source_type text; source_id text; resolved text;
BEGIN
 IF NEW.is_inquiry IS NOT TRUE THEN NEW.inquiry_source_key:=NULL; RETURN NEW; END IF;
 source_type:=CASE WHEN nullif(NEW.inquiry_details->>'received_email_id','') IS NOT NULL THEN 'received'
 ELSE coalesce(NEW.inquiry_details->>'source_message_type',CASE WHEN NEW.inquiry_details->>'source_kind'='contact_form' THEN 'contact_form' END) END;
 source_id:=coalesce(nullif(NEW.inquiry_details->>'received_email_id',''),NEW.inquiry_details->>'source_message_id');
 IF source_type IN ('received','contact_form') AND source_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' THEN
  resolved:=public.crm_inquiry_source_key(source_type,source_id::uuid);
 END IF;
 -- Keep historical identity when its source was removed. It cannot be changed by editing the brief.
 IF TG_OP='UPDATE' AND OLD.inquiry_source_key IS NOT NULL THEN
  IF resolved IS NOT NULL AND resolved<>OLD.inquiry_source_key THEN RAISE EXCEPTION 'Nie można zmienić źródła istniejącego zapytania.'; END IF;
  resolved:=OLD.inquiry_source_key;
 END IF;
 NEW.inquiry_source_key:=resolved;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.set_inquiry_source_key() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS set_inquiry_source_key ON public.tasks;
CREATE TRIGGER set_inquiry_source_key BEFORE INSERT OR UPDATE OF is_inquiry,inquiry_details,inquiry_source_key ON public.tasks
 FOR EACH ROW EXECUTE FUNCTION private.set_inquiry_source_key();
-- No automatic deletion or merging. A conflicting historical source aborts this migration.
UPDATE public.tasks SET inquiry_source_key=NULL WHERE is_inquiry AND inquiry_source_key IS NULL
 AND (inquiry_details ? 'received_email_id' OR inquiry_details->>'source_message_type' IN ('received','contact_form') OR inquiry_details->>'source_kind'='contact_form');
CREATE UNIQUE INDEX IF NOT EXISTS tasks_unique_inquiry_source ON public.tasks(inquiry_source_key) WHERE inquiry_source_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_message_sales_context(p_messages jsonb)
RETURNS TABLE(message_type text,message_id uuid,inquiries jsonb,ai_status text,ai_intent text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 WITH input AS MATERIALIZED (
  SELECT DISTINCT x.type,x.id FROM jsonb_to_recordset(p_messages) x(type text,id uuid) LIMIT 100
 ), accessible AS MATERIALIZED (
  SELECT i.type,i.id,public.crm_inquiry_source_key(i.type,i.id) source_key FROM input i
  WHERE (i.type='received' AND EXISTS(SELECT 1 FROM public.received_emails e WHERE e.id=i.id))
   OR (i.type='contact_form' AND EXISTS(SELECT 1 FROM public.contact_messages m WHERE m.id=i.id))
   OR (i.type='sent' AND EXISTS(SELECT 1 FROM public.sent_emails s WHERE s.id=i.id))
 ), reply_sources AS (
  SELECT a.type,a.id,ref.value source_message_id FROM accessible a
  JOIN public.received_emails e ON a.type='received' AND e.id=a.id
  CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(e.raw_headers)='object' THEN e.raw_headers ELSE '{}'::jsonb END) h
  CROSS JOIN LATERAL unnest(public.crm_email_reference_ids(h.value)) ref(value)
  WHERE lower(h.key) IN ('in-reply-to','references')
 ), related AS (
  SELECT a.type,a.id,t.id inquiry_id FROM accessible a JOIN public.tasks t ON t.inquiry_source_key=a.source_key AND t.is_inquiry
  UNION
  SELECT r.type,r.id,t.id FROM reply_sources r JOIN public.tasks t ON t.inquiry_source_key='email:'||md5(r.source_message_id) AND t.is_inquiry
  UNION
  SELECT a.type,a.id,l.inquiry_id FROM accessible a JOIN public.inquiry_email_links l
   ON (a.type='received' AND l.received_email_id=a.id) OR (a.type='sent' AND l.sent_email_id=a.id) WHERE NOT l.excluded
  UNION
  SELECT a.type,a.id,c.inquiry_id FROM accessible a JOIN public.email_sales_conversation_messages m
   ON (a.type='received' AND m.received_email_id=a.id) OR (a.type='sent' AND m.sent_email_id=a.id)
   JOIN public.email_sales_conversations c ON c.id=m.conversation_id WHERE c.inquiry_id IS NOT NULL
  UNION
  SELECT a.type,a.id,t.id FROM accessible a JOIN public.email_sales_conversation_messages m
   ON (a.type='received' AND m.received_email_id=a.id) OR (a.type='sent' AND m.sent_email_id=a.id)
   JOIN public.email_sales_conversation_messages root ON root.conversation_id=m.conversation_id AND root.received_email_id IS NOT NULL
   JOIN public.tasks t ON t.inquiry_source_key=public.crm_inquiry_source_key('received',root.received_email_id) AND t.is_inquiry
 ) SELECT a.type,a.id,coalesce((SELECT jsonb_agg(jsonb_build_object(
    'id',t.id,'stage',t.inquiry_stage,'ownerId',t.inquiry_owner_id,
    'ownerName',nullif(concat_ws(' ',e.name,e.surname),''),'archived',t.archived_at IS NOT NULL) ORDER BY t.created_at,t.id)
   FROM related r JOIN public.tasks t ON t.id=r.inquiry_id AND t.is_inquiry
   LEFT JOIN public.employees e ON e.id=t.inquiry_owner_id WHERE r.type=a.type AND r.id=a.id),'[]'::jsonb),q.status,q.intent
 FROM accessible a LEFT JOIN public.email_ai_qualifications q ON a.type='received' AND q.received_email_id=a.id;
$$;
REVOKE ALL ON FUNCTION public.crm_message_sales_context(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_message_sales_context(jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.crm_create_inquiry_from_message(p_type text,p_id uuid,p_owner uuid DEFAULT NULL,p_guest_count integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.sales_employee_id(); owner uuid; source_key text; source jsonb; links jsonb; inquiry public.tasks; result uuid;
BEGIN
 IF actor IS NULL OR public.current_session_is_seller_portal() THEN RAISE EXCEPTION 'Wymagane konto pracownika CRM.' USING ERRCODE='42501'; END IF;
 IF p_type NOT IN ('received','contact_form') THEN RAISE EXCEPTION 'Wybierz wiadomość odebraną lub formularz.'; END IF;
 IF p_guest_count IS NOT NULL AND (p_guest_count<1 OR p_guest_count>100000) THEN RAISE EXCEPTION 'Nieprawidłowa liczba osób.'; END IF;
 source_key:=public.crm_inquiry_source_key(p_type,p_id);
 IF source_key IS NULL THEN RAISE EXCEPTION 'Brak dostępu do wiadomości.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(20261103,160000);
 SELECT c.inquiries INTO links FROM public.crm_message_sales_context(jsonb_build_array(jsonb_build_object('type',p_type,'id',p_id))) c;
 IF jsonb_array_length(links)>1 THEN RAISE EXCEPTION 'Wiadomość ma kilka powiązań. Otwórz właściwe zapytanie.'; END IF;
 IF jsonb_array_length(links)=1 THEN
  RETURN jsonb_build_object('id',links->0->>'id','created',false,'ownerId',links->0->>'ownerId');
 END IF;
 owner:=coalesce(p_owner,actor);
 IF NOT EXISTS(SELECT 1 FROM public.employees WHERE id=owner AND is_active)
 OR NOT (public.can_manage_inquiry(owner) OR public.can_assign_inquiry_owner(owner)) THEN
  RAISE EXCEPTION 'Brak uprawnień do przypisania zapytania tej osobie.' USING ERRCODE='42501';
 END IF;
 IF p_type='received' THEN SELECT to_jsonb(e) INTO source FROM public.received_emails e WHERE e.id=p_id AND deleted_at IS NULL;
 ELSE SELECT to_jsonb(m) INTO source FROM public.contact_messages m WHERE m.id=p_id AND deleted_at IS NULL; END IF;
 IF source IS NULL THEN RAISE EXCEPTION 'Najpierw przywróć wiadomość z kosza.'; END IF;
 INSERT INTO public.tasks(title,description,priority,status,board_column,order_index,created_by,is_inquiry,inquiry_stage,inquiry_owner_id,inquiry_details)
 VALUES(left('Zapytanie: '||coalesce(nullif(source->>'subject',''),'Wiadomość'),500),
  left(coalesce(source->>'body_text',source->>'message',regexp_replace(coalesce(source->>'body_html',''),'<[^>]*>',' ','g')),10000),
  'urgent','todo','todo',0,actor,true,'new',owner,jsonb_build_object(
   'source_kind',CASE WHEN p_type='received' THEN 'email_manual' ELSE 'contact_form' END,
   'source_message_type',p_type,'source_message_id',p_id,
   'received_email_id',CASE WHEN p_type='received' THEN p_id END,
   'source_message_date',coalesce(source->>'received_date',source->>'created_at'),
   'client_email',coalesce(source->>'from_address',source->>'email'),'client_text',coalesce(source->>'name',source->>'from_address',source->>'email'),
   'client_phone',source->>'phone','guest_count',p_guest_count)) RETURNING id INTO result;
 -- This is the sales owner, not an extra task participant. No second, non-atomic assignment insert.
 RETURN jsonb_build_object('id',result,'created',true,'ownerId',owner);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'Wiadomość jest już w lejku. Odśwież jej status; jeśli zapytanie nie jest widoczne, skontaktuj się z opiekunem zespołu.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION public.crm_create_inquiry_from_message(text,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_create_inquiry_from_message(text,uuid,uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_create_ai_email_inquiry(p_email_id uuid,p_title text,p_description text,p_details jsonb,p_creator uuid,p_probability integer)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE source_key text; links jsonb; result uuid;
BEGIN
 source_key:=public.crm_inquiry_source_key('received',p_email_id);
 IF source_key IS NULL THEN RAISE EXCEPTION 'Nie znaleziono wiadomości.'; END IF;
 PERFORM pg_advisory_xact_lock(20261103,160000);
 SELECT c.inquiries INTO links FROM public.crm_message_sales_context(jsonb_build_array(jsonb_build_object('type','received','id',p_email_id))) c;
 IF jsonb_array_length(links)>1 THEN RAISE EXCEPTION 'Wiadomość ma kilka powiązań. Wymagana weryfikacja.'; END IF;
 IF jsonb_array_length(links)=1 THEN RETURN (links->0->>'id')::uuid; END IF;
 INSERT INTO public.tasks(title,description,priority,status,board_column,order_index,created_by,is_inquiry,inquiry_stage,inquiry_owner_id,next_action_at,win_probability,inquiry_details)
 VALUES(left(p_title,500),left(p_description,10000),'urgent','todo','todo',0,p_creator,true,'new',NULL,now()+interval '2 hours',p_probability,
 p_details||jsonb_build_object('source_kind','email_ai','received_email_id',p_email_id)) RETURNING id INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.crm_create_ai_email_inquiry(uuid,text,text,jsonb,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_create_ai_email_inquiry(uuid,text,text,jsonb,uuid,integer) TO service_role;

-- A linked inquiry owns the sales assignment. Legacy clients cannot silently overwrite it on a mail.
CREATE OR REPLACE FUNCTION private.guard_linked_message_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE links jsonb; kind text;
BEGIN
 IF NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to THEN RETURN NEW; END IF;
 kind:=CASE WHEN TG_TABLE_NAME='received_emails' THEN 'received' ELSE 'contact_form' END;
 SELECT c.inquiries INTO links FROM public.crm_message_sales_context(jsonb_build_array(jsonb_build_object('type',kind,'id',OLD.id))) c;
 IF coalesce(jsonb_array_length(links),0)>0 THEN
  RAISE EXCEPTION 'Ta wiadomość należy do zapytania. Zmień opiekuna przez przekazanie zapytania.' USING ERRCODE='40001';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_linked_message_assignment() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS guard_linked_message_assignment ON public.received_emails;
CREATE TRIGGER guard_linked_message_assignment BEFORE UPDATE OF assigned_to ON public.received_emails FOR EACH ROW EXECUTE FUNCTION private.guard_linked_message_assignment();
DROP TRIGGER IF EXISTS guard_linked_message_assignment ON public.contact_messages;
CREATE TRIGGER guard_linked_message_assignment BEFORE UPDATE OF assigned_to ON public.contact_messages FOR EACH ROW EXECUTE FUNCTION private.guard_linked_message_assignment();
DO $$ DECLARE item text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH item IN ARRAY ARRAY['tasks','email_ai_qualifications','inquiry_email_links'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=item) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',item);
   END IF;
  END LOOP;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
