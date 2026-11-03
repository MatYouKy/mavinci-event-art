-- Fix explicit ownership on existing AI inquiries; no historical owner is guessed.
BEGIN;
SET LOCAL lock_timeout='5s';

-- Keep the existing claim permissions; use employee identity, not the auth UUID.
CREATE OR REPLACE FUNCTION public.claim_inquiry(p_inquiry_id uuid)
RETURNS TABLE(inquiry_id uuid,owner_id uuid,claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.sales_employee_id(); inquiry public.tasks;
BEGIN
 IF actor IS NULL OR public.current_session_is_seller_portal() THEN
  RAISE EXCEPTION 'Wymagane konto pracownika CRM.' USING ERRCODE='42501';
 END IF;
 IF NOT (public.is_inquiry_admin() OR public.has_inquiry_permission('inquiries_assign') OR public.has_inquiry_permission('inquiries_manage')) THEN
  RAISE EXCEPTION 'Brak uprawnienia do przejmowania zapytań.' USING ERRCODE='42501';
 END IF;
 SELECT * INTO inquiry FROM public.tasks t WHERE t.id=p_inquiry_id AND t.is_inquiry FOR UPDATE;
 IF NOT FOUND OR NOT public.can_view_inquiry(inquiry.inquiry_owner_id,inquiry.id) THEN
  RAISE EXCEPTION 'Nie znaleziono zapytania lub brak dostępu.' USING ERRCODE='42501';
 END IF;
 IF inquiry.archived_at IS NOT NULL OR inquiry.inquiry_stage IN ('won','lost') THEN
  RAISE EXCEPTION 'Nie można przejąć zamkniętego zapytania.';
 END IF;
 IF inquiry.inquiry_owner_id=actor THEN
  RETURN QUERY SELECT inquiry.id,actor,false; RETURN;
 END IF;
 IF inquiry.inquiry_owner_id IS NOT NULL THEN
  RAISE EXCEPTION 'To zapytanie zostało już przejęte przez inną osobę. Odśwież jego status.' USING ERRCODE='40001';
 END IF;
 UPDATE public.tasks t SET inquiry_owner_id=actor,updated_at=now() WHERE t.id=inquiry.id AND t.inquiry_owner_id IS NULL;
 INSERT INTO public.inquiry_activity(inquiry_id,kind,body,actor_id,metadata)
  VALUES(inquiry.id,'note','Przejęto zapytanie ze wspólnej puli.',actor,jsonb_build_object('new_owner_id',actor));
 RETURN QUERY SELECT inquiry.id,actor,true;
END $$;
REVOKE ALL ON FUNCTION public.claim_inquiry(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_inquiry(uuid) TO authenticated;

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
    'ownerName',coalesce(nullif(e.nickname,''),nullif(concat_ws(' ',e.name,e.surname),'')),
    'ownerAvatarUrl',e.avatar_url,'ownerAvatarMetadata',e.avatar_metadata,'archived',t.archived_at IS NOT NULL) ORDER BY t.created_at,t.id)
   FROM related r JOIN public.tasks t ON t.id=r.inquiry_id AND t.is_inquiry
   LEFT JOIN public.employees e ON e.id=t.inquiry_owner_id WHERE r.type=a.type AND r.id=a.id),'[]'::jsonb),q.status,q.intent
 FROM accessible a LEFT JOIN public.email_ai_qualifications q ON a.type='received' AND q.received_email_id=a.id;
$$;
REVOKE ALL ON FUNCTION public.crm_message_sales_context(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_message_sales_context(jsonb) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.crm_create_inquiry_from_message(p_type text,p_id uuid,p_owner uuid DEFAULT NULL,p_guest_count integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE actor uuid:=public.sales_employee_id(); owner uuid; source_key text; source jsonb; links jsonb; inquiry public.tasks; result uuid; claim_result record;
BEGIN
 IF actor IS NULL OR public.current_session_is_seller_portal() THEN RAISE EXCEPTION 'Wymagane konto pracownika CRM.' USING ERRCODE='42501'; END IF;
 IF p_type NOT IN ('received','contact_form') THEN RAISE EXCEPTION 'Wybierz wiadomość odebraną lub formularz.'; END IF;
 IF p_guest_count IS NOT NULL AND (p_guest_count<1 OR p_guest_count>100000) THEN RAISE EXCEPTION 'Nieprawidłowa liczba osób.'; END IF;
 source_key:=public.crm_inquiry_source_key(p_type,p_id);
 IF source_key IS NULL THEN RAISE EXCEPTION 'Brak dostępu do wiadomości.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(20261103,160000);
 SELECT c.inquiries INTO links FROM public.crm_message_sales_context(jsonb_build_array(jsonb_build_object('type',p_type,'id',p_id))) c;
 IF jsonb_array_length(links)>1 THEN RAISE EXCEPTION 'Wiadomość ma kilka powiązań. Otwórz właściwe zapytanie.'; END IF;
 IF jsonb_array_length(links)=1 AND nullif(links->0->>'ownerId','') IS NOT NULL THEN
  -- An explicit handoff is required to change an existing owner.
  RETURN jsonb_build_object('id',links->0->>'id','created',false,'claimed',false,'ownerId',links->0->>'ownerId');
 END IF;
 owner:=coalesce(p_owner,actor);
 IF NOT EXISTS(SELECT 1 FROM public.employees WHERE id=owner AND is_active)
 OR NOT (public.can_manage_inquiry(owner) OR public.can_assign_inquiry_owner(owner)) THEN
  RAISE EXCEPTION 'Brak uprawnień do przypisania zapytania tej osobie.' USING ERRCODE='42501';
 END IF;
 IF p_type='received' THEN SELECT to_jsonb(e) INTO source FROM public.received_emails e WHERE e.id=p_id AND deleted_at IS NULL;
 ELSE SELECT to_jsonb(m) INTO source FROM public.contact_messages m WHERE m.id=p_id AND deleted_at IS NULL; END IF;
 IF source IS NULL THEN RAISE EXCEPTION 'Najpierw przywróć wiadomość z kosza.'; END IF;
 IF jsonb_array_length(links)=1 THEN
  result:=(links->0->>'id')::uuid;
  IF coalesce((links->0->>'archived')::boolean,false) OR links->0->>'stage' IN ('won','lost') THEN
   RAISE EXCEPTION 'Zamknięte zapytanie wymaga otwarcia w lejku; nie przypisano opiekuna.';
  END IF;
  IF owner=actor THEN
   -- A pool inquiry cannot be updated through ordinary task RLS by its future owner.
   SELECT * INTO claim_result FROM public.claim_inquiry(result);
   RETURN jsonb_build_object('id',result,'created',false,'claimed',claim_result.claimed,'ownerId',claim_result.owner_id);
  END IF;
  IF NOT public.can_assign_inquiry_owner(owner) THEN
   RAISE EXCEPTION 'Brak uprawnień do przypisania zapytania tej osobie.' USING ERRCODE='42501';
  END IF;
  -- Existing task RLS still applies when assigning another employee.
  UPDATE public.tasks SET inquiry_owner_id=owner,updated_at=now()
   WHERE id=result AND is_inquiry AND inquiry_owner_id IS NULL AND archived_at IS NULL
     AND inquiry_stage NOT IN ('won','lost') RETURNING * INTO inquiry;
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Nie przypisano zapytania: zmienił się opiekun lub nie masz uprawnień. Odśwież jego status.' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.inquiry_activity(inquiry_id,kind,body,actor_id,metadata)
   VALUES(result,'note','Przypisano opiekuna z wiadomości.',actor,jsonb_build_object('new_owner_id',owner,'source_message_id',p_id));
  RETURN jsonb_build_object('id',result,'created',false,'claimed',true,'ownerId',owner);
 END IF;
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
 RETURN jsonb_build_object('id',result,'created',true,'claimed',true,'ownerId',owner);
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'Wiadomość jest już w lejku. Odśwież jej status; jeśli zapytanie nie jest widoczne, skontaktuj się z opiekunem zespołu.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION public.crm_create_inquiry_from_message(text,uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_create_inquiry_from_message(text,uuid,uuid,integer) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
