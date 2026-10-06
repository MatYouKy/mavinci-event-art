BEGIN;
ALTER TABLE public.contact_messages ADD COLUMN IF NOT EXISTS intake_metadata jsonb NOT NULL DEFAULT '{}';
CREATE TABLE public.inquiry_intake_reviews (
 source_kind text NOT NULL CHECK(source_kind IN ('contact_form','webhook','submission','marketing')),
 source_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','linked','ignored')),
 inquiry_id uuid REFERENCES public.tasks(id) ON DELETE RESTRICT, reason text, resolved_by uuid REFERENCES public.employees(id),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, PRIMARY KEY(source_kind,source_id)
);
ALTER TABLE public.inquiry_intake_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY intake_reviews_read ON public.inquiry_intake_reviews FOR SELECT TO authenticated USING(public.is_inquiry_admin() OR public.has_inquiry_permission('inquiries_manage_all'));
-- Preserve historical uncertainty: queue missing sources for explicit reconciliation.
INSERT INTO public.inquiry_intake_reviews(source_kind,source_id)
 SELECT 'contact_form',m.id FROM public.contact_messages m WHERE NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.is_inquiry AND t.inquiry_details->>'source_message_id'=m.id::text)
 UNION ALL SELECT 'webhook',e.id FROM public.inbound_events e WHERE NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.is_inquiry AND (t.inquiry_details->>'inbound_event_id'=e.id::text OR (t.inquiry_details->>'source_id'=e.source_id::text AND t.inquiry_details->>'external_event_id'=e.external_event_id)))
 UNION ALL SELECT 'submission',s.id FROM public.contact_form_submissions s WHERE NOT EXISTS(SELECT 1 FROM public.contact_messages m WHERE m.id::text=s.metadata->>'message_id' OR m.notes LIKE '%'||'Submission ID: '||s.id::text||'%')
 ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION public.ensure_intake_inquiry(p_kind text,p_source uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
  source_data jsonb; source_name text; source_slug text; details jsonb; inquiry_title text; inquiry_body text;
  existing public.tasks%ROWTYPE; result uuid; lock_key text;
BEGIN
  SELECT inquiry_id INTO result FROM public.inquiry_intake_reviews WHERE source_kind=p_kind AND source_id=p_source AND status='linked'; IF result IS NOT NULL THEN RETURN result; END IF;
  IF coalesce(current_setting('mavinci.resolve_intake',true),'')<>'yes' AND EXISTS(SELECT 1 FROM public.inquiry_intake_reviews WHERE source_kind=p_kind AND source_id=p_source AND status IN ('pending','ignored')) THEN RETURN NULL; END IF;
  IF p_kind='contact_form' THEN
    SELECT to_jsonb(m) INTO STRICT source_data FROM public.contact_messages m WHERE m.id=p_source;
    IF source_data->>'category'='team_join' AND coalesce(current_setting('mavinci.resolve_intake',true),'')<>'yes' THEN
      INSERT INTO public.inquiry_intake_reviews(source_kind,source_id,status,reason) VALUES(p_kind,p_source,'ignored','Zgłoszenie do zespołu — pozostaje w wiadomościach') ON CONFLICT DO NOTHING; RETURN NULL; END IF;
    lock_key:='contact_form:'||p_source;
    details:=jsonb_strip_nulls(jsonb_build_object('source_kind','contact_form','source_message_type','contact_form',
      'source_message_id',p_source,'source_message_date',source_data->>'created_at',
      'source_message_content',source_data->>'message','source_page',source_data->>'source_page',
      'event_type',source_data#>>'{intake_metadata,event_type}','location_text',source_data#>>'{intake_metadata,location_text}','category',source_data->>'category','subject',source_data->>'subject','client_text',source_data->>'name',
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
      'location_text',coalesce(source_data#>>'{metadata,location}',source_data#>>'{metadata,city}'),'termin',source_data#>>'{metadata,event_date}','scope',source_data#>>'{metadata,event_type}','metadata',source_data->'metadata'));
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


-- Form -> message -> inquiry stays in one transaction; structured fields are retained.
CREATE OR REPLACE FUNCTION public.process_contact_form_submission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE msg uuid; inquiry uuid; BEGIN
 SELECT m.id INTO msg FROM public.contact_messages m WHERE m.id::text=NEW.metadata->>'message_id' OR m.notes LIKE '%'||'Submission ID: '||NEW.id::text||'%' LIMIT 1;
 IF msg IS NULL THEN
 INSERT INTO public.contact_messages(name,email,phone,message,source_page,status,priority,category,subject,notes,created_at)
 VALUES(NEW.name,NEW.email,NEW.phone,NEW.message,NEW.source_page,'unread','normal','form_submission',coalesce(NEW.source_section,'Formularz kontaktowy'),'Submission ID: '||NEW.id::text,NEW.created_at) RETURNING id INTO msg;
 END IF;
 inquiry:=public.ensure_intake_inquiry('contact_form',msg);
 UPDATE public.contact_form_submissions SET metadata=coalesce(metadata,'{}')||jsonb_build_object('message_id',msg) WHERE id=NEW.id;
 UPDATE public.tasks SET inquiry_details=coalesce(inquiry_details,'{}')||jsonb_strip_nulls(jsonb_build_object('submission_id',NEW.id,'location_text',NEW.city_interest,'event_type',NEW.event_type,'utm_source',NEW.utm_source,'utm_medium',NEW.utm_medium,'utm_campaign',NEW.utm_campaign)) WHERE id=inquiry;
 RETURN NEW;
END $$;
CREATE FUNCTION public.queue_marketing_inquiry_review() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN INSERT INTO public.inquiry_intake_reviews(source_kind,source_id) VALUES('marketing',NEW.id) ON CONFLICT DO NOTHING; RETURN NEW; END $$;
CREATE TRIGGER marketing_inquiry_review AFTER INSERT ON public.marketing_messages FOR EACH ROW EXECUTE FUNCTION public.queue_marketing_inquiry_review();
INSERT INTO public.inquiry_intake_reviews(source_kind,source_id) SELECT 'marketing',id FROM public.marketing_messages ON CONFLICT DO NOTHING;
CREATE FUNCTION public.list_inquiry_intake_reviews() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT (public.is_inquiry_admin() OR public.has_inquiry_permission('inquiries_manage_all')) THEN RAISE EXCEPTION 'Brak uprawnień do kontroli źródeł'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(x ORDER BY created_at DESC),'[]') FROM (
 SELECT r.*,CASE r.source_kind WHEN 'contact_form' THEN (SELECT concat_ws(' · ',name,subject,message) FROM public.contact_messages WHERE id=r.source_id)
 WHEN 'webhook' THEN (SELECT concat_ws(' · ',title,body) FROM public.inbound_events WHERE id=r.source_id)
 WHEN 'submission' THEN (SELECT concat_ws(' · ',name,message) FROM public.contact_form_submissions WHERE id=r.source_id)
 WHEN 'marketing' THEN (SELECT message_preview FROM public.marketing_messages WHERE id=r.source_id) END AS description
 FROM public.inquiry_intake_reviews r WHERE status='pending' LIMIT 200) x);
END $$;
CREATE FUNCTION public.resolve_inquiry_intake_review(p_kind text,p_source uuid,p_action text,p_reason text,p_inquiry uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE review public.inquiry_intake_reviews; result uuid; source_data jsonb; msg uuid;
BEGIN
 IF NOT (public.is_inquiry_admin() OR public.has_inquiry_permission('inquiries_manage_all')) OR nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Wymagane uprawnienia i opis decyzji'; END IF;
 SELECT * INTO STRICT review FROM public.inquiry_intake_reviews WHERE source_kind=p_kind AND source_id=p_source FOR UPDATE;
 IF review.status<>'pending' THEN RETURN review.inquiry_id; END IF;
 IF p_action='link' THEN
  IF NOT EXISTS(SELECT 1 FROM public.tasks WHERE id=p_inquiry AND is_inquiry AND public.can_manage_inquiry(inquiry_owner_id)) THEN RAISE EXCEPTION 'Brak dostępu do zapytania'; END IF;
  result:=p_inquiry;
 ELSIF p_action='create' THEN
  PERFORM set_config('mavinci.resolve_intake','yes',true);
  IF p_kind IN ('contact_form','webhook') THEN result:=public.ensure_intake_inquiry(p_kind,p_source);
  ELSE
   IF p_kind='submission' THEN SELECT to_jsonb(x) INTO STRICT source_data FROM public.contact_form_submissions x WHERE id=p_source;
   ELSE SELECT to_jsonb(x) INTO STRICT source_data FROM public.marketing_messages x WHERE id=p_source; END IF;
   INSERT INTO public.tasks(title,description,priority,status,board_column,is_private,is_inquiry,inquiry_stage,inquiry_owner_id,inquiry_details)
   VALUES('Zapytanie: '||coalesce(source_data->>'name',source_data->>'sender_name','Nowy kontakt'),coalesce(source_data->>'message',source_data->>'message_preview'),'high','todo','todo',false,true,'new',public.sales_employee_id(),jsonb_strip_nulls(jsonb_build_object('source_kind',p_kind,'source_review_id',p_source,'client_text',source_data->>'name','client_email',source_data->>'email','client_phone',source_data->>'phone','location_text',source_data->>'city_interest','event_type',source_data->>'event_type','source_message_content',coalesce(source_data->>'message',source_data->>'message_preview')))) RETURNING id INTO result;
  END IF;
 ELSIF p_action<>'ignore' THEN RAISE EXCEPTION 'Nieprawidłowa decyzja'; END IF;
 UPDATE public.inquiry_intake_reviews SET status=CASE WHEN result IS NULL THEN 'ignored' ELSE 'linked' END,inquiry_id=result,reason=p_reason,resolved_by=public.sales_employee_id(),resolved_at=now() WHERE source_kind=p_kind AND source_id=p_source;
 PERFORM public.sales_log(result,'source',p_reason,jsonb_build_object('source_kind',p_kind,'source_id',p_source));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.list_inquiry_intake_reviews(),public.resolve_inquiry_intake_review(text,uuid,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_inquiry_intake_reviews(),public.resolve_inquiry_intake_review(text,uuid,text,text,uuid) TO authenticated;
GRANT SELECT ON public.inquiry_intake_reviews TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
