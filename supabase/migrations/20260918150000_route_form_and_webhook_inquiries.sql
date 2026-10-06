-- Jeden rekord zapytania, jedna kolejka sprzedażowa; zadania są działaniami.
-- tasks pozostaje fizycznym magazynem zapytań (is_inquiry), bez kopiowania
-- komentarzy, załączników i historii do drugiej tabeli.
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.can_view_inquiry(uuid)') IS NULL
    OR to_regclass('public.inquiry_stage_history') IS NULL THEN
    RAISE EXCEPTION 'Najpierw uruchom migracje lejka i wspólnej kolejki zapytań (20260823).';
  END IF;
END $$;

CREATE FUNCTION public.ensure_intake_inquiry(p_kind text,p_source uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  source_data jsonb; source_name text; source_slug text; details jsonb; inquiry_title text; inquiry_body text;
  existing public.tasks%ROWTYPE; result uuid; lock_key text;
BEGIN
  IF p_kind='contact_form' THEN
    SELECT to_jsonb(m) INTO STRICT source_data FROM public.contact_messages m WHERE m.id=p_source;
    lock_key:='contact_form:'||p_source;
    details:=jsonb_strip_nulls(jsonb_build_object('source_kind','contact_form','source_message_type','contact_form',
      'source_message_id',p_source,'source_message_date',source_data->>'created_at',
      'source_message_content',source_data->>'message','source_page',source_data->>'source_page',
      'category',source_data->>'category','subject',source_data->>'subject','client_text',source_data->>'name',
      'client_email',source_data->>'email','client_phone',source_data->>'phone','client_company',source_data->>'company'));
    inquiry_title:='Zapytanie: '||coalesce(nullif(btrim(source_data->>'subject'),''),nullif(btrim(source_data->>'name'),''),'formularz WWW');
    inquiry_body:=concat_ws(E'\n','Źródło: formularz '||coalesce(nullif(source_data->>'source_page',''),'mavinci.pl'),
      'Nadawca: '||(source_data->>'name'),'Firma: '||(source_data->>'company'),
      'E-mail: '||(source_data->>'email'),'Telefon: '||(source_data->>'phone'),'',source_data->>'message');
  ELSIF p_kind='webhook' THEN
    SELECT to_jsonb(e),s.name,s.slug INTO STRICT source_data,source_name,source_slug
      FROM public.inbound_events e JOIN public.webhook_sources s ON s.id=e.source_id WHERE e.id=p_source;
    -- Dedupe uses the provider's stable key, also after an old failed delivery
    -- deleted/recreated the inbound row. Never infer identity from e-mail/title.
    lock_key:='webhook:'||(source_data->>'source_id')||':'||(source_data->>'external_event_id');
    details:=jsonb_strip_nulls(jsonb_build_object('source_kind','webhook','inbound_event_id',p_source,
      'external_event_id',source_data->>'external_event_id','source_id',source_data->>'source_id',
      'source_name',source_name,'source_slug',source_slug,'event_type',source_data->>'event_type',
      'event_time',source_data->>'event_time','source_message_date',source_data->>'created_at',
      'source_message_content',source_data->>'body','detail_url',source_data->>'detail_url',
      'client_text',coalesce(source_data#>>'{metadata,name}',source_data#>>'{metadata,client_name}'),
      'client_email',source_data#>>'{metadata,email}','client_phone',source_data#>>'{metadata,phone}',
      'client_company',coalesce(source_data#>>'{metadata,company}',source_data#>>'{metadata,client_company}'),
      'metadata',source_data->'metadata'));
    inquiry_title:='Zapytanie: '||coalesce(nullif(source_data->>'title',''),source_name,'webhook');
    inquiry_body:=concat_ws(E'\n','Źródło: '||source_name,'Typ zdarzenia: '||(source_data->>'event_type'),
      'Nadawca: '||(details->>'client_text'),'E-mail: '||(details->>'client_email'),
      'Telefon: '||(details->>'client_phone'),'',coalesce(nullif(source_data->>'body',''),source_data->>'title'));
  ELSE RAISE EXCEPTION 'Nieobsługiwane źródło zapytania'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lock_key,18150000));
  SELECT t.* INTO existing FROM public.tasks t WHERE
    (p_kind='contact_form' AND t.inquiry_details->>'source_message_id'=p_source::text
      AND (t.inquiry_details->>'source_kind'='contact_form' OR t.inquiry_details->>'source_message_type'='contact_form'))
    OR (p_kind='webhook' AND t.inquiry_details->>'source_kind'='webhook' AND
      (t.inquiry_details->>'inbound_event_id'=p_source::text OR
        (t.inquiry_details->>'source_id'=source_data->>'source_id'
          AND t.inquiry_details->>'external_event_id'=source_data->>'external_event_id')))
    ORDER BY t.is_inquiry DESC NULLS LAST,t.created_at,t.id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    -- Preserve existing ownership, decisions, IDs and related work. Do not
    -- reopen a completed task as a new sale or merge ambiguous historical rows.
    IF existing.is_inquiry IS DISTINCT FROM true OR existing.inquiry_stage IS NULL THEN
      UPDATE public.tasks SET is_inquiry=true,
        inquiry_details=details||coalesce(existing.inquiry_details,'{}'::jsonb),
        inquiry_stage=coalesce(existing.inquiry_stage,CASE
          WHEN existing.status::text='cancelled' THEN 'lost'
          WHEN existing.status::text='completed' OR existing.board_column='completed' THEN 'won'
          WHEN existing.board_column='review' THEN 'qualified'
          WHEN existing.status::text='in_progress' OR existing.board_column='in_progress' THEN 'contacted'
          ELSE 'new' END),
        lost_reason=CASE WHEN existing.status::text='cancelled' THEN coalesce(nullif(btrim(existing.lost_reason),''),'Zamknięte przed uporządkowaniem źródeł') ELSE existing.lost_reason END
        WHERE id=existing.id;
    END IF;
    RETURN existing.id;
  END IF;

  INSERT INTO public.tasks(title,description,priority,status,board_column,order_index,
    created_by,is_private,is_inquiry,inquiry_stage,inquiry_owner_id,inquiry_details)
    VALUES(left(inquiry_title,500),left(inquiry_body,10000),'urgent','todo','todo',0,
      NULL,false,true,'new',NULL,details||jsonb_build_object('intake_version',2)) RETURNING id INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_inquiry_from_contact_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.ensure_intake_inquiry('contact_form',NEW.id); RETURN NEW; END;
$$;
CREATE OR REPLACE FUNCTION public.create_inquiry_from_inbound_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN PERFORM public.ensure_intake_inquiry('webhook',NEW.id); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trigger_create_inquiry_from_contact_message ON public.contact_messages;
CREATE TRIGGER trigger_create_inquiry_from_contact_message AFTER INSERT ON public.contact_messages
  FOR EACH ROW EXECUTE FUNCTION public.create_inquiry_from_contact_message();
DROP TRIGGER IF EXISTS trigger_create_inquiry_from_inbound_event ON public.inbound_events;
CREATE TRIGGER trigger_create_inquiry_from_inbound_event AFTER INSERT ON public.inbound_events
  FOR EACH ROW EXECUTE FUNCTION public.create_inquiry_from_inbound_event();

-- An automated source is not authored by an arbitrarily chosen administrator.
-- Ordinary manually created tasks retain their current auto-assignment.
CREATE OR REPLACE FUNCTION public.auto_assign_task_creator()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.is_inquiry IS DISTINCT FROM true AND NEW.created_by IS NOT NULL THEN
    INSERT INTO public.task_assignees(task_id,employee_id) VALUES(NEW.id,NEW.created_by)
      ON CONFLICT(task_id,employee_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

-- Notification opt-in never grants inquiry access. Return Auth IDs rather than
-- assuming every employee's primary key is also their login ID.
CREATE FUNCTION public.intake_inquiry_recipients(p_kind text,p_inquiry uuid,p_source uuid DEFAULT NULL)
RETURNS TABLE(user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT DISTINCT login.id FROM public.tasks t
  CROSS JOIN public.employees e
  CROSS JOIN LATERAL (SELECT u.id FROM auth.users u WHERE u.id=e.auth_user_id OR u.id=e.id
    ORDER BY (u.id=e.auth_user_id) DESC NULLS LAST,u.id LIMIT 1) login
  LEFT JOIN public.employees owner ON owner.id=t.inquiry_owner_id
  LEFT JOIN public.employee_notification_settings pref ON pref.employee_id=e.id
  LEFT JOIN public.employee_webhook_notification_settings source_pref ON source_pref.employee_id=e.id AND source_pref.source_id=p_source
  CROSS JOIN LATERAL (SELECT (e.role::text='admin' OR e.access_level::text='admin'
    OR 'admin'=ANY(coalesce(e.permissions,'{}'::text[]))) AS is_admin) flags
  WHERE t.id=p_inquiry AND t.is_inquiry AND e.is_active
    AND NOT EXISTS(SELECT 1 FROM public.sales_partner_profiles p WHERE p.portal_auth_user_id=login.id AND p.portal_enabled AND p.contact_id IS NOT NULL)
    AND (flags.is_admin OR 'inquiries_view_all'=ANY(coalesce(e.permissions,'{}'::text[]))
      OR (t.inquiry_owner_id IS NULL AND coalesce(e.permissions,'{}'::text[]) && ARRAY['inquiries_view','inquiries_manage','inquiries_view_pool'])
      OR (t.inquiry_owner_id=e.id AND coalesce(e.permissions,'{}'::text[]) && ARRAY['inquiries_view','inquiries_manage','inquiries_view_own','inquiries_manage_own'])
      OR ('inquiries_view_team'=ANY(coalesce(e.permissions,'{}'::text[])) AND owner.is_active AND e.sales_team_id=owner.sales_team_id))
    AND CASE WHEN p_kind='contact_form' THEN coalesce(pref.contact_form_enabled,flags.is_admin)
      WHEN p_kind='webhook' THEN coalesce(pref.webhook_notifications_enabled,flags.is_admin) AND coalesce(source_pref.is_enabled,flags.is_admin)
      ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.notify_new_contact_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inquiry uuid; notice uuid; recipients uuid[];
BEGIN
  -- Lead creation is mandatory and transactional; only a notification failure
  -- may be tolerated without dropping the customer's inquiry.
  inquiry:=public.ensure_intake_inquiry('contact_form',NEW.id);
  BEGIN
    SELECT array_agg(user_id) INTO recipients FROM public.intake_inquiry_recipients('contact_form',inquiry);
    IF coalesce(cardinality(recipients),0)=0 THEN RETURN NEW; END IF;
    INSERT INTO public.notifications(title,message,type,category,action_url,related_entity_type,related_entity_id,metadata)
      VALUES('Nowe zapytanie z formularza',format('%s · %s',NEW.name,coalesce(NEW.subject,'Formularz WWW')),
        'info','contact_form','/crm/inquiries/'||inquiry,'contact_messages',NEW.id::text,
        jsonb_build_object('kind','inquiry_intake','inquiry_id',inquiry,'source_kind','contact_form','source_message_id',NEW.id))
      RETURNING id INTO notice;
    INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
      SELECT notice,id,false FROM unnest(recipients) id ON CONFLICT(notification_id,user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'Nie dostarczono powiadomienia formularza; zapytanie % pozostaje zapisane: %',inquiry,SQLERRM; END;
  RETURN NEW;
END;
$$;

-- Central routing also covers existing owner/SLA notifications and callers
-- still using legacy /crm/tasks links. No unrelated task links are changed.
CREATE FUNCTION public.route_inquiry_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE inquiry uuid;
BEGIN
  -- A follow-up task can reference an inquiry without being that inquiry.
  IF NEW.related_entity_type IN ('task','tasks') AND EXISTS (
    SELECT 1 FROM public.tasks WHERE id::text=NEW.related_entity_id::text AND is_inquiry IS DISTINCT FROM true
  ) THEN RETURN NEW; END IF;
  SELECT id INTO inquiry FROM public.tasks WHERE is_inquiry AND (
    id::text=NEW.metadata->>'inquiry_id'
    OR (NEW.related_entity_type IN ('task','tasks','inquiry') AND id::text=NEW.related_entity_id::text)
    OR NEW.action_url='/crm/tasks/'||id::text)
    ORDER BY created_at,id LIMIT 1;
  IF inquiry IS NULL AND NEW.related_entity_type='contact_messages' THEN
    SELECT id INTO inquiry FROM public.tasks WHERE is_inquiry
      AND (inquiry_details->>'source_kind'='contact_form' OR inquiry_details->>'source_message_type'='contact_form')
      AND inquiry_details->>'source_message_id'=NEW.related_entity_id::text ORDER BY created_at,id LIMIT 1;
  END IF;
  IF inquiry IS NULL AND NEW.metadata->>'origin'='webhook' THEN
    SELECT id INTO inquiry FROM public.tasks WHERE is_inquiry AND inquiry_details->>'source_kind'='webhook'
      AND inquiry_details->>'inbound_event_id'=NEW.metadata->>'inbound_event_id' ORDER BY created_at,id LIMIT 1;
  END IF;
  IF inquiry IS NOT NULL THEN
    NEW.action_url:='/crm/inquiries/'||inquiry;
    NEW.metadata:=coalesce(NEW.metadata,'{}'::jsonb)||jsonb_build_object('inquiry_id',inquiry);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER route_inquiry_notification_before_write BEFORE INSERT OR UPDATE OF action_url,metadata,related_entity_id ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.route_inquiry_notification();

-- Edge function authenticates the source key before calling this service-only
-- RPC. Event, inquiry and in-app notification commit atomically. Push is merely
-- an additional delivery channel and never causes the event to be recreated.
CREATE FUNCTION public.receive_inquiry_webhook(p_source uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE source public.webhook_sources; event public.inbound_events; inquiry uuid; notice uuid;
  recipients uuid[]; rows jsonb; external_id text:=btrim(p_payload->>'external_event_id');
  event_type text:=btrim(p_payload->>'event_type'); priority text:=coalesce(p_payload->>'priority','normal');
BEGIN
  SELECT * INTO STRICT source FROM public.webhook_sources WHERE id=p_source AND is_active FOR SHARE;
  IF coalesce(length(external_id),0) NOT BETWEEN 1 AND 255 OR coalesce(length(btrim(p_payload->>'title')),0) NOT BETWEEN 1 AND 500
    OR coalesce(length(event_type),0)=0 OR priority NOT IN ('low','normal','high','critical') THEN
    RAISE EXCEPTION 'Nieprawidłowe dane webhooka';
  END IF;
  IF coalesce(cardinality(source.allowed_event_types),0)>0 AND NOT event_type=ANY(source.allowed_event_types) THEN
    RAISE EXCEPTION 'Typ zdarzenia nie jest dozwolony dla źródła';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('receive:'||p_source||':'||external_id,18150000));
  SELECT * INTO event FROM public.inbound_events WHERE source_id=p_source AND external_event_id=external_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.inbound_events(source_id,external_event_id,event_type,title,body,priority,detail_url,event_time,metadata,status)
      VALUES(p_source,external_id,event_type,btrim(p_payload->>'title'),p_payload->>'body',priority,p_payload->>'detail_url',
        coalesce((p_payload->>'event_time')::timestamptz,now()),coalesce(nullif(p_payload->'metadata','null'::jsonb),'{}'::jsonb),'received')
      ON CONFLICT(source_id,external_event_id) DO NOTHING RETURNING * INTO event;
    IF NOT FOUND THEN
      SELECT * INTO STRICT event FROM public.inbound_events WHERE source_id=p_source AND external_event_id=external_id FOR UPDATE;
    END IF;
  END IF;
  inquiry:=public.ensure_intake_inquiry('webhook',event.id);
  IF event.status IN ('processed','ignored') THEN
    RETURN jsonb_build_object('status','duplicate','event_id',event.id,'inquiry_id',inquiry,'received_at',event.created_at,
      'notification_id',event.notification_id,'recipient_rows','[]'::jsonb,'recipients',0);
  END IF;
  SELECT array_agg(user_id) INTO recipients FROM public.intake_inquiry_recipients('webhook',inquiry,p_source);
  notice:=event.notification_id;
  IF coalesce(cardinality(recipients),0)>0 THEN
    IF notice IS NULL THEN
      INSERT INTO public.notifications(title,message,type,category,action_url,metadata)
        VALUES('Nowe zapytanie: '||left(event.title,200),left(coalesce(event.body,event.title),300),
          CASE event.priority WHEN 'critical' THEN 'error' WHEN 'high' THEN 'warning' ELSE 'info' END,
          'system','/crm/inquiries/'||inquiry,jsonb_build_object('origin','webhook','kind','inquiry_intake','inquiry_id',inquiry,
            'inbound_event_id',event.id,'source_slug',source.slug,'source_name',source.name,'event_type',event.event_type,'priority',event.priority))
        RETURNING id INTO notice;
    END IF;
    WITH added AS (
      INSERT INTO public.notification_recipients(notification_id,user_id,is_read)
        SELECT notice,id,false FROM unnest(recipients) id ON CONFLICT(notification_id,user_id) DO NOTHING
        RETURNING id,notification_id,user_id,is_read
    ) SELECT coalesce(jsonb_agg(to_jsonb(added)),'[]'::jsonb) INTO rows FROM added;
  END IF;
  UPDATE public.inbound_events SET status='processed',notification_id=notice,processed_at=now() WHERE id=event.id;
  RETURN jsonb_build_object('status','accepted','event_id',event.id,'inquiry_id',inquiry,'notification_id',notice,
    'recipients',coalesce(cardinality(recipients),0),'recipient_rows',coalesce(rows,'[]'::jsonb));
END;
$$;

-- Reconcile only explicit source references, never guessed names or e-mails.
-- Already handled inquiries retain their stages and owners. Missing historical
-- sources enter the queue now; source dates stay in inquiry_details.
DO $$ DECLARE item record; BEGIN
  FOR item IN SELECT m.id FROM public.contact_messages m
    WHERE m.status::text NOT IN ('archived','closed','resolved','spam')
      OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.inquiry_details->>'source_message_id'=m.id::text
        AND (t.inquiry_details->>'source_kind'='contact_form' OR t.inquiry_details->>'source_message_type'='contact_form'))
  LOOP PERFORM public.ensure_intake_inquiry('contact_form',item.id); END LOOP;
  FOR item IN SELECT id FROM public.inbound_events WHERE status<>'ignored'
  LOOP PERFORM public.ensure_intake_inquiry('webhook',item.id); END LOOP;
END $$;

-- Rewrite existing intake / inquiry notices without resending them or changing
-- their read state, recipients or original content.
UPDATE public.notifications SET action_url=action_url WHERE
  metadata ? 'inquiry_id' OR metadata->>'origin'='webhook' OR related_entity_type='contact_messages'
  OR (related_entity_type IN ('task','tasks') AND EXISTS(SELECT 1 FROM public.tasks t WHERE t.is_inquiry AND t.id::text=related_entity_id::text));

COMMENT ON FUNCTION public.create_inquiry_from_contact_message() IS 'Formularz od razu trafia do wspólnej kolejki Zapytania → Nowe, bez przypisania administratorowi.';
COMMENT ON FUNCTION public.create_inquiry_from_inbound_event() IS 'Webhook otrzymuje jedno zapytanie identyfikowane przez źródło i external_event_id.';
REVOKE ALL ON FUNCTION public.ensure_intake_inquiry(text,uuid),public.intake_inquiry_recipients(text,uuid,uuid),
  public.route_inquiry_notification(),public.create_inquiry_from_contact_message(),public.create_inquiry_from_inbound_event(),
  public.notify_new_contact_message() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.receive_inquiry_webhook(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.receive_inquiry_webhook(uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
