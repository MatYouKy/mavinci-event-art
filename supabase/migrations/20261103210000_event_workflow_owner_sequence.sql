BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

-- All workflow reminders have exactly one recipient: the actual event author.
CREATE OR REPLACE FUNCTION private.event_workflow_owner(p_event uuid)
RETURNS TABLE(employee_id uuid,user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT e.id,u.id FROM public.events v JOIN public.employees e ON v.created_by IN(e.id,e.auth_user_id)
 JOIN auth.users u ON u.id=coalesce(e.auth_user_id,e.id)
 WHERE v.id=p_event AND e.is_active ORDER BY (e.auth_user_id=v.created_by) DESC,e.id LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.event_workflow_owner(uuid) FROM PUBLIC,anon,authenticated;

CREATE TABLE public.event_workflow_attention (
 event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
 owner_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
 owner_user_id uuid,
 next_action jsonb,
 activated_at timestamptz NOT NULL DEFAULT now(),
 checked_at timestamptz NOT NULL DEFAULT now(),
 snoozed_until timestamptz,
 snooze_note text,
 snoozed_requirement_id uuid
);
CREATE INDEX event_workflow_attention_owner_idx ON public.event_workflow_attention(owner_user_id,checked_at);
ALTER TABLE public.event_workflow_attention ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_workflow_attention FROM PUBLIC,anon,authenticated;

CREATE TABLE private.event_workflow_digest_deliveries (
 user_id uuid NOT NULL,
 delivery_date date NOT NULL,
 kind text NOT NULL CHECK(kind IN('daily','critical')),
 notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
 PRIMARY KEY(user_id,delivery_date,kind)
);
CREATE TABLE private.event_workflow_recipient_archive (
 recipient_id uuid PRIMARY KEY,
 notification_id uuid NOT NULL,
 original_row jsonb NOT NULL,
 reason text NOT NULL,
 archived_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.event_workflow_digest_deliveries,private.event_workflow_recipient_archive FROM PUBLIC,anon,authenticated;
ALTER TABLE public.event_workflow_tasks ADD COLUMN deferred boolean NOT NULL DEFAULT false;
ALTER TABLE public.event_workflow_tasks ADD COLUMN completed_by_workflow boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION private.event_workflow_next_action(p_event uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.events; inst public.event_workflow_instances; req record; owner record;
 met boolean; activation timestamptz; due_at timestamptz; starts_at timestamptz;
 payment_day date; step_tab text; result jsonb; state public.event_workflow_attention;
BEGIN
 SELECT * INTO ev FROM public.events WHERE id=p_event;
 IF NOT FOUND OR ev.status::text='cancelled' THEN RETURN NULL; END IF;
 SELECT * INTO inst FROM public.event_workflow_instances WHERE event_id=p_event AND status='active';
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO owner FROM private.event_workflow_owner(p_event);
 SELECT * INTO state FROM public.event_workflow_attention WHERE event_id=p_event;
 FOR req IN
  SELECT r.*,s.name stage_name,s.order_index stage_order,s.due_offset_days,
    (s.due_offset_days>0 OR EXISTS(SELECT 1 FROM public.event_workflow_requirements x WHERE x.stage_id=s.id AND x.requirement_key IN('invoice_issued','invoice_paid','final_payment_paid','closeout_complete'))) post_event,
    EXISTS(SELECT 1 FROM public.event_workflow_requirements x WHERE x.stage_id=s.id AND x.requirement_key IN('preflight_clear','tasks_complete')) readiness
  FROM public.event_workflow_stages s JOIN public.event_workflow_requirements r ON r.stage_id=s.id
  WHERE s.template_id=inst.template_id AND r.is_required
  ORDER BY s.order_index,s.id,(r.requirement_key IN('invoice_paid','final_payment_paid')),r.order_index,r.id
 LOOP
  -- Realization marked complete no longer needs preparation, but settlement still does.
  IF ev.status::text='completed' AND NOT coalesce(req.post_event,false) THEN CONTINUE; END IF;
  IF req.requirement_key='invoice_issued' THEN
   met:=EXISTS(SELECT 1 FROM public.invoices i WHERE i.status IN('issued','sent','paid','overdue')
    AND i.invoice_type IN('vat','final') AND i.is_proforma IS NOT TRUE
    AND (EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id AND a.event_id=p_event AND a.allocation_weight>0)
      OR(i.event_id=p_event AND NOT EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id))));
  ELSE met:=public.event_workflow_requirement_is_met(p_event,req.id); END IF;
  IF met THEN CONTINUE; END IF;
  starts_at:=NULL; payment_day:=NULL;
  IF req.post_event THEN
   starts_at:=(((coalesce(ev.event_end_date,ev.event_date) AT TIME ZONE 'Europe/Warsaw')::date+1)+time '09:00') AT TIME ZONE 'Europe/Warsaw';
  ELSIF req.readiness THEN
   starts_at:=ev.event_date+make_interval(days=>coalesce(req.due_offset_days,-1));
  END IF;
  IF req.requirement_key IN('invoice_paid','final_payment_paid','deposit_paid') THEN
   SELECT min(m.due_date) INTO payment_day FROM public.event_payment_milestones m
    WHERE m.event_id=p_event AND m.status NOT IN('paid','waived')
      AND (req.requirement_key<>'deposit_paid' OR m.milestone_type='deposit');
   IF payment_day IS NOT NULL THEN
    starts_at:=greatest(starts_at,(payment_day+time '09:00') AT TIME ZONE 'Europe/Warsaw');
   END IF;
  END IF;
  activation:=CASE WHEN state.next_action->>'requirement_id'=req.id::text THEN state.activated_at ELSE now() END;
  due_at:=CASE WHEN req.due_offset_days IS NULL THEN NULL
    ELSE (CASE WHEN req.post_event THEN coalesce(ev.event_end_date,ev.event_date) ELSE ev.event_date END)+make_interval(days=>req.due_offset_days) END;
  due_at:=greatest(due_at,activation+interval '1 day');
  IF NOT coalesce(req.post_event,false) AND ev.event_date>now() THEN due_at:=least(due_at,ev.event_date); END IF;
  IF payment_day IS NOT NULL THEN due_at:=(payment_day+time '23:59:59') AT TIME ZONE 'Europe/Warsaw'; END IF;
  IF req.requirement_key='invoice_issued' THEN due_at:=starts_at+interval '14 hours 59 minutes'; END IF;
  step_tab:=CASE req.requirement_key WHEN 'offer_accepted' THEN 'offers' WHEN 'contract_signed' THEN 'contracts'
    WHEN 'team_assigned' THEN 'team' WHEN 'agenda_ready' THEN 'agenda' WHEN 'wedding_card_ready' THEN 'agenda'
    WHEN 'equipment_assigned' THEN 'equipment' WHEN 'vehicle_assigned' THEN 'logistics'
    WHEN 'invoice_issued' THEN 'finances' WHEN 'invoice_paid' THEN 'finances' WHEN 'final_payment_paid' THEN 'finances' WHEN 'deposit_paid' THEN 'finances'
    WHEN 'tasks_complete' THEN 'tasks' ELSE 'details' END;
  result:=jsonb_build_object('event_id',ev.id,'event_name',ev.name,'event_date',ev.event_date,
    'stage_id',req.stage_id,'stage_order',req.stage_order,'stage_name',req.stage_name,'requirement_id',req.id,'key',req.requirement_key,
    'label',req.label,'due_at',due_at,'starts_at',starts_at,'status',CASE WHEN starts_at>now() THEN 'waiting' ELSE 'actionable' END,
    'owner_employee_id',owner.employee_id,'owner_user_id',owner.user_id,'tab',step_tab,
    'action_url',format('/crm/events/%s?tab=%s',ev.id,step_tab));
  IF state.snoozed_requirement_id=req.id AND state.snoozed_until>now() THEN
   result:=result||jsonb_build_object('status','snoozed','snoozed_until',state.snoozed_until,'snooze_note',state.snooze_note);
  END IF;
  RETURN result;
 END LOOP;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.event_workflow_next_action(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.refresh_event_workflow_attention(p_event uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE next jsonb; owner record;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event) THEN RETURN; END IF;
 SELECT * INTO owner FROM private.event_workflow_owner(p_event);
 next:=private.event_workflow_next_action(p_event);
 INSERT INTO public.event_workflow_attention(event_id,owner_employee_id,owner_user_id,next_action)
 VALUES(p_event,owner.employee_id,owner.user_id,next)
 ON CONFLICT(event_id) DO UPDATE SET owner_employee_id=excluded.owner_employee_id,owner_user_id=excluded.owner_user_id,
  next_action=excluded.next_action,checked_at=now(),
  activated_at=CASE WHEN event_workflow_attention.next_action->>'requirement_id' IS DISTINCT FROM excluded.next_action->>'requirement_id' THEN now() ELSE event_workflow_attention.activated_at END,
  snoozed_until=CASE WHEN event_workflow_attention.snoozed_requirement_id::text=excluded.next_action->>'requirement_id' THEN event_workflow_attention.snoozed_until END,
  snooze_note=CASE WHEN event_workflow_attention.snoozed_requirement_id::text=excluded.next_action->>'requirement_id' THEN event_workflow_attention.snooze_note END;
END $$;
REVOKE ALL ON FUNCTION private.refresh_event_workflow_attention(uuid) FROM PUBLIC,anon,authenticated;

-- Automatic workflow changes must not produce a second stream of task pushes.
DO $$ DECLARE f text; definition text; needle text:=E'BEGIN\n'; BEGIN
 FOREACH f IN ARRAY ARRAY['notify_task_status_change','notify_task_assignment'] LOOP
  definition:=pg_get_functiondef(('public.'||f||'()')::regprocedure);
  IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja triggera %',f; END IF;
  definition:=overlay(definition placing needle||$guard$  IF current_setting('app.event_workflow_sync',true)='on' THEN RETURN NEW; END IF;
$guard$ from position(needle in definition) for length(needle));
  EXECUTE definition;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.sync_event_workflow_tasks_internal(p_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ev public.events; inst public.event_workflow_instances; req record; linked record; next jsonb;
 owner record; met boolean; eligible boolean; task_id_value uuid; created_count integer:=0; previous_flag text;
BEGIN
 SELECT * INTO ev FROM public.events WHERE id=p_event_id FOR UPDATE;
 IF NOT FOUND THEN RETURN 0; END IF;
 previous_flag:=current_setting('app.event_workflow_sync',true);
 PERFORM set_config('app.event_workflow_sync','on',true);
 PERFORM public.ensure_event_workflow_instance(p_event_id);
 SELECT * INTO inst FROM public.event_workflow_instances WHERE event_id=p_event_id;
 SELECT * INTO owner FROM private.event_workflow_owner(p_event_id);
 next:=private.event_workflow_next_action(p_event_id);
 FOR req IN SELECT r.* FROM public.event_workflow_requirements r
  JOIN public.event_workflow_stages s ON s.id=r.stage_id
  WHERE s.template_id=inst.template_id AND r.auto_create_task AND r.is_required
 LOOP
  met:=public.event_workflow_requirement_is_met(p_event_id,req.id);
  IF req.requirement_key='invoice_issued' THEN
   met:=EXISTS(SELECT 1 FROM public.invoices i WHERE i.status IN('issued','sent','paid','overdue')
    AND i.invoice_type IN('vat','final') AND i.is_proforma IS NOT TRUE
    AND (EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id AND a.event_id=p_event_id AND a.allocation_weight>0)
      OR(i.event_id=p_event_id AND NOT EXISTS(SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id))));
  END IF;
  SELECT l.*,t.status::text task_status INTO linked FROM public.event_workflow_tasks l JOIN public.tasks t ON t.id=l.task_id
   WHERE l.instance_id=inst.id AND l.requirement_id=req.id;
  eligible:=coalesce(next->>'requirement_id'=req.id::text AND next->>'status' IN('actionable','snoozed'),false);
  IF met AND linked.task_id IS NOT NULL AND (linked.task_status NOT IN('completed','cancelled') OR linked.deferred) THEN
   UPDATE public.event_workflow_tasks SET deferred=false,completed_by_workflow=true WHERE instance_id=inst.id AND requirement_id=req.id;
   UPDATE public.tasks SET status='completed',board_column='completed',updated_at=now() WHERE id=linked.task_id;
  ELSIF NOT met AND eligible AND owner.employee_id IS NOT NULL THEN
   IF linked.task_id IS NULL THEN
    INSERT INTO public.tasks(title,description,priority,status,board_column,due_date,event_id,created_by,assigned_to)
    VALUES(coalesce(nullif(btrim(req.task_title),''),req.label),'Automatyczne zadanie procesu wydarzenia „'||ev.name||'”.',
     req.task_priority::public.task_priority,'todo','todo',(next->>'due_at')::timestamptz,p_event_id,owner.employee_id,owner.employee_id)
    RETURNING id INTO task_id_value;
    INSERT INTO public.event_workflow_tasks(instance_id,requirement_id,task_id) VALUES(inst.id,req.id,task_id_value);
    created_count:=created_count+1;
   ELSIF linked.deferred OR linked.completed_by_workflow THEN
    UPDATE public.event_workflow_tasks SET deferred=false,completed_by_workflow=false WHERE instance_id=inst.id AND requirement_id=req.id;
    UPDATE public.tasks SET status='todo',board_column='todo',due_date=(next->>'due_at')::timestamptz,updated_at=now() WHERE id=linked.task_id;
   ELSIF linked.task_status='todo' THEN
    UPDATE public.tasks SET due_date=(next->>'due_at')::timestamptz WHERE id=linked.task_id AND due_date IS DISTINCT FROM (next->>'due_at')::timestamptz;
   END IF;
  ELSIF NOT eligible AND linked.task_id IS NOT NULL AND linked.task_status='todo' THEN
   -- Do not alter manually created work or tasks that someone has already started.
   UPDATE public.event_workflow_tasks SET deferred=true WHERE instance_id=inst.id AND requirement_id=req.id;
   UPDATE public.tasks SET status='cancelled',board_column='cancelled',updated_at=now() WHERE id=linked.task_id;
  END IF;
 END LOOP;
 PERFORM private.refresh_event_workflow_attention(p_event_id);
 UPDATE public.notification_recipients nr SET is_read=true,read_at=coalesce(nr.read_at,now())
 FROM public.notifications n WHERE n.id=nr.notification_id AND NOT nr.is_read
  AND n.metadata->>'kind'='event_workflow_digest' AND nr.user_id=owner.user_id
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(n.metadata->'actions','[]'::jsonb)) a WHERE a->>'event_id'=p_event_id::text)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(n.metadata->'actions','[]'::jsonb)) a
    JOIN public.event_workflow_attention attention ON attention.event_id=(a->>'event_id')::uuid
    WHERE attention.next_action->>'status'='actionable' AND attention.next_action->>'requirement_id'=a->>'requirement_id');
 PERFORM set_config('app.event_workflow_sync',coalesce(previous_flag,''),true);
 RETURN created_count;
END $$;
REVOKE ALL ON FUNCTION public.sync_event_workflow_tasks_internal(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.refresh_workflow_event_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('app.event_workflow_sync',true)='on' THEN RETURN NULL; END IF;
 IF TG_TABLE_NAME='events' THEN
  PERFORM public.sync_event_workflow_tasks_internal(NEW.id);
 ELSIF TG_OP='DELETE' THEN
  PERFORM public.sync_event_workflow_tasks_internal(OLD.event_id);
 ELSE
  PERFORM public.sync_event_workflow_tasks_internal(NEW.event_id);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.refresh_workflow_event_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER refresh_workflow_after_event_update AFTER UPDATE OF event_date,event_end_date,status,created_by,location,organization_id,contact_person_id
 ON public.events FOR EACH ROW EXECUTE FUNCTION private.refresh_workflow_event_change();
CREATE TRIGGER refresh_workflow_after_task_change AFTER INSERT OR UPDATE OF status,board_column OR DELETE ON public.tasks
 FOR EACH ROW EXECUTE FUNCTION private.refresh_workflow_event_change();

CREATE OR REPLACE FUNCTION public.get_my_event_workflow_actions()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL OR public.current_session_is_seller_portal() THEN RAISE EXCEPTION 'Wymagane konto pracownika CRM.' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x.action ORDER BY x.action->>'due_at',x.id) FROM (
  SELECT ev.id,private.event_workflow_next_action(ev.id) action FROM public.events ev
  JOIN public.event_workflow_instances i ON i.event_id=ev.id AND i.status='active'
  JOIN LATERAL private.event_workflow_owner(ev.id) owner ON owner.user_id=auth.uid()
  WHERE ev.status::text<>'cancelled'
 ) x WHERE x.action IS NOT NULL),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.get_my_event_workflow_actions() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_event_workflow_actions() TO authenticated;

CREATE OR REPLACE FUNCTION public.snooze_event_workflow(p_event_id uuid,p_requirement_id uuid,p_until timestamptz,p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE next jsonb;
BEGIN
 IF auth.uid() IS NULL OR public.current_session_is_seller_portal() OR NOT EXISTS(SELECT 1 FROM private.event_workflow_owner(p_event_id) o WHERE o.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Tylko autor wydarzenia może odroczyć jego przypomnienia.' USING ERRCODE='42501';
 END IF;
 IF p_until IS NOT NULL AND (p_until<=now() OR p_until>now()+interval '30 days') THEN RAISE EXCEPTION 'Wybierz termin w ciągu najbliższych 30 dni.'; END IF;
 PERFORM 1 FROM public.events WHERE id=p_event_id FOR UPDATE;
 next:=private.event_workflow_next_action(p_event_id);
 IF next IS NULL OR next->>'requirement_id' IS DISTINCT FROM p_requirement_id::text THEN RAISE EXCEPTION 'Bieżący krok zmienił się. Odśwież listę.' USING ERRCODE='40001'; END IF;
 PERFORM private.refresh_event_workflow_attention(p_event_id);
 UPDATE public.event_workflow_attention SET snoozed_until=p_until,snooze_note=left(nullif(btrim(p_note),''),500),snoozed_requirement_id=p_requirement_id WHERE event_id=p_event_id;
 PERFORM private.refresh_event_workflow_attention(p_event_id);
 RETURN private.event_workflow_next_action(p_event_id);
END $$;
REVOKE ALL ON FUNCTION public.snooze_event_workflow(uuid,uuid,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.snooze_event_workflow(uuid,uuid,timestamptz,text) TO authenticated;

-- Preserve the existing readiness calculations and exceptions; annotate the active step.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.get_event_workflow_readiness(uuid)'::regprocedure);
 definition:=replace(definition,'FUNCTION public.get_event_workflow_readiness(', 'FUNCTION private.event_workflow_readiness_original(');
 definition:=replace(definition,'IF NOT public.can_view_event_workflows(p_event_id) THEN',
  'IF NOT (public.can_view_event_workflows(p_event_id) OR EXISTS(SELECT 1 FROM private.event_workflow_owner(p_event_id) o WHERE o.user_id=auth.uid())) THEN');
 EXECUTE definition;
END $$;
REVOKE ALL ON FUNCTION private.event_workflow_readiness_original(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_event_workflow_readiness(p_event_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; next jsonb; stages jsonb;
BEGIN
 result:=private.event_workflow_readiness_original(p_event_id);
 IF result IS NULL THEN RETURN NULL; END IF;
 next:=private.event_workflow_next_action(p_event_id);
 SELECT jsonb_agg(CASE WHEN s.value->>'status'='completed' THEN s.value
   WHEN s.value->>'id'=next->>'stage_id' THEN s.value||jsonb_build_object('status',CASE WHEN next->>'status' IN('waiting','snoozed') THEN 'waiting' WHEN (next->>'due_at')::timestamptz<now() THEN 'overdue' ELSE 'pending' END,'due_at',next->'due_at')
   ELSE s.value||jsonb_build_object('status','waiting') END ORDER BY s.ord)
 INTO stages FROM jsonb_array_elements(result->'stages') WITH ORDINALITY s(value,ord);
 RETURN result||jsonb_build_object('stages',coalesce(stages,'[]'::jsonb),'next_action',next,
  'can_snooze',EXISTS(SELECT 1 FROM private.event_workflow_owner(p_event_id) o WHERE o.user_id=auth.uid()));
END $$;

-- Legacy entry points cannot revive the old broad-recipient notifications.
CREATE OR REPLACE FUNCTION public.create_event_operational_notification(p_event_id uuid,p_alert_key text,p_kind text,p_title text,p_message text,p_type text,p_metadata jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM private.refresh_event_workflow_attention(p_event_id);
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.create_event_operational_notification(uuid,text,text,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.process_event_operational_alerts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item record; recipient record; notice uuid; items jsonb; msg text; count_all integer; sent integer:=0;
 today date:=(now() AT TIME ZONE 'Europe/Warsaw')::date; digest_kind text; fresh boolean; issue jsonb;
BEGIN
 -- Transaction-wide guard also covers cron retries and legacy entry points.
 IF NOT pg_try_advisory_xact_lock(20261103,210000) THEN RETURN 0; END IF;
 FOR item IN SELECT ev.id FROM public.events ev JOIN public.event_workflow_instances i ON i.event_id=ev.id
  LEFT JOIN public.event_workflow_attention a ON a.event_id=ev.id
  WHERE i.status='active' AND (a.checked_at IS NULL OR a.checked_at<now()-interval '10 minutes')
  ORDER BY a.checked_at NULLS FIRST,ev.id LIMIT 50
 LOOP PERFORM public.sync_event_workflow_tasks_internal(item.id); END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.event_operational_alert_settings WHERE is_active) THEN RETURN 0; END IF;
 IF (now() AT TIME ZONE 'Europe/Warsaw')::time<time '09:00' OR (now() AT TIME ZONE 'Europe/Warsaw')::time>=time '15:00' THEN RETURN 0; END IF;
 FOR recipient IN SELECT DISTINCT a.owner_user_id FROM public.event_workflow_attention a
  WHERE a.owner_user_id IS NOT NULL AND a.next_action->>'status'='actionable' AND a.checked_at>now()-interval '1 hour'
 LOOP
  -- Do not publish a partial morning digest before this author's initial refresh finishes.
  IF EXISTS(SELECT 1 FROM public.events ev JOIN public.event_workflow_instances i ON i.event_id=ev.id AND i.status='active'
   JOIN LATERAL private.event_workflow_owner(ev.id) o ON o.user_id=recipient.owner_user_id
   LEFT JOIN public.event_workflow_attention a ON a.event_id=ev.id WHERE ev.status::text<>'cancelled' AND (a.checked_at IS NULL OR a.checked_at<now()-interval '1 hour')) THEN CONTINUE; END IF;
  FOR digest_kind IN SELECT unnest(ARRAY['daily','critical']) LOOP
   IF EXISTS(SELECT 1 FROM private.event_workflow_digest_deliveries d WHERE d.user_id=recipient.owner_user_id AND d.delivery_date=today AND d.kind=digest_kind) THEN CONTINUE; END IF;
   -- A critical follow-up is allowed only for a newly detected risk after today's digest.
   IF digest_kind='critical' AND NOT EXISTS(SELECT 1 FROM private.event_workflow_digest_deliveries d WHERE d.user_id=recipient.owner_user_id AND d.delivery_date=today AND d.kind='daily') THEN CONTINUE; END IF;
   items:='[]'::jsonb; count_all:=0;
   FOR item IN SELECT a.* FROM public.event_workflow_attention a
    JOIN LATERAL private.event_workflow_owner(a.event_id) o ON o.user_id=a.owner_user_id
    WHERE a.owner_user_id=recipient.owner_user_id AND a.next_action->>'status'='actionable' AND a.checked_at>now()-interval '1 hour'
    ORDER BY (a.next_action->>'due_at')::timestamptz,a.event_id
   LOOP
    issue:=NULL;
    IF (item.next_action->>'event_date')::timestamptz BETWEEN now() AND now()+interval '24 hours' THEN
     issue:=public.get_event_preflight_core(item.event_id);
     IF coalesce((issue->>'critical_count')::integer,0)=0 THEN issue:=NULL; END IF;
    END IF;
    IF digest_kind='critical' AND (issue IS NULL OR EXISTS(
     SELECT 1 FROM private.event_workflow_digest_deliveries d JOIN public.notifications n ON n.id=d.notification_id
     CROSS JOIN LATERAL jsonb_array_elements(coalesce(n.metadata->'actions','[]'::jsonb)) x
     WHERE d.user_id=recipient.owner_user_id AND d.delivery_date=today AND x->>'event_id'=item.event_id::text AND x->'critical_issues'=issue->'issues'
    )) THEN CONTINUE; END IF;
    count_all:=count_all+1;
    IF jsonb_array_length(items)<20 THEN items:=items||jsonb_build_array(item.next_action||jsonb_build_object('critical_issues',issue->'issues')); END IF;
   END LOOP;
   IF count_all=0 THEN CONTINUE; END IF;
   SELECT string_agg(format('„%s”: %s',x->>'event_name',CASE WHEN digest_kind='critical' THEN coalesce((SELECT string_agg(y->>'label','; ') FROM jsonb_array_elements(coalesce(x->'critical_issues','[]'::jsonb)) y),x->>'label') ELSE x->>'label' END),E'\n') INTO msg FROM jsonb_array_elements(items) x;
   INSERT INTO private.event_workflow_digest_deliveries(user_id,delivery_date,kind) VALUES(recipient.owner_user_id,today,digest_kind) ON CONFLICT DO NOTHING;
   IF NOT FOUND THEN CONTINUE; END IF;
   INSERT INTO public.notifications(title,message,type,category,action_url,metadata)
    VALUES(CASE WHEN digest_kind='daily' THEN 'Twoje wydarzenia — następne kroki' ELSE 'Pilna kontrola przed wydarzeniem' END,
      left(msg,1400)||CASE WHEN count_all>20 THEN format(E'\n… oraz %s kolejnych wydarzeń.',count_all-20) ELSE '' END,
      CASE WHEN digest_kind='daily' THEN 'info' ELSE 'warning' END,'event',format('/crm/events/%s',items->0->>'event_id'),
      jsonb_build_object('kind','event_workflow_digest','digest_kind',digest_kind,'actions',items,'event_count',count_all,'owner_user_id',recipient.owner_user_id,'workflow_actions_url','/crm/events/actions')) RETURNING id INTO notice;
   INSERT INTO public.notification_recipients(notification_id,user_id,is_read) VALUES(notice,recipient.owner_user_id,false);
   UPDATE private.event_workflow_digest_deliveries SET notification_id=notice WHERE user_id=recipient.owner_user_id AND delivery_date=today AND event_workflow_digest_deliveries.kind=digest_kind;
   sent:=sent+1;
  END LOOP;
 END LOOP;
 RETURN sent;
END $$;
REVOKE ALL ON FUNCTION public.process_event_operational_alerts() FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.notify_overdue_event_workflows() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.process_event_operational_alerts(); $$;
CREATE OR REPLACE FUNCTION public.process_event_operational_alerts_in_delivery_window() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ SELECT public.process_event_operational_alerts(); $$;
REVOKE ALL ON FUNCTION public.notify_overdue_event_workflows(),public.process_event_operational_alerts_in_delivery_window() FROM PUBLIC,anon,authenticated;

-- Keep the old settings form compatible, but enforce owner-only routing in the database.
CREATE OR REPLACE FUNCTION private.force_event_workflow_owner_settings() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN NEW.alert_owner:=true; NEW.alert_admins:=false; NEW.alert_event_managers:=false; RETURN NEW; END $$;
CREATE TRIGGER force_event_workflow_owner_settings BEFORE INSERT OR UPDATE ON public.event_operational_alert_settings FOR EACH ROW EXECUTE FUNCTION private.force_event_workflow_owner_settings();
UPDATE public.event_operational_alert_settings SET alert_owner=true,alert_admins=false,alert_event_managers=false;

-- Retire historical workflow reminders. Wrong recipients are archived, not globally deleted notifications.
INSERT INTO private.event_workflow_recipient_archive(recipient_id,notification_id,original_row,reason)
 SELECT r.id,r.notification_id,to_jsonb(r),'workflow_owner_only' FROM public.notification_recipients r JOIN public.notifications n ON n.id=r.notification_id
 WHERE n.metadata->>'kind' IN('event_workflow_overdue','event_readiness','event_payment')
 AND NOT EXISTS(SELECT 1 FROM private.event_workflow_owner(n.related_entity_id::uuid) o WHERE o.user_id=r.user_id)
 ON CONFLICT DO NOTHING;
UPDATE public.notification_push_deliveries d SET status='skipped',last_error='Superseded by owner-only workflow digest',updated_at=now()
 FROM public.notification_recipients r JOIN public.notifications n ON n.id=r.notification_id
 WHERE d.notification_recipient_id=r.id AND d.status IN('pending','processing','failed')
  AND n.metadata->>'kind' IN('event_workflow_overdue','event_readiness','event_payment');
DELETE FROM public.notification_recipients r USING private.event_workflow_recipient_archive a WHERE r.id=a.recipient_id;
UPDATE public.notification_recipients r SET is_read=true,read_at=coalesce(r.read_at,now()) FROM public.notifications n
 WHERE n.id=r.notification_id AND n.metadata->>'kind' IN('event_workflow_overdue','event_readiness','event_payment') AND NOT r.is_read;
UPDATE public.crm_business_notification_outbox SET delivered_at=now(),last_error='Superseded by owner-only workflow digest',updated_at=now()
 WHERE delivered_at IS NULL AND (metadata->>'kind' IN('event_workflow_overdue','event_readiness','event_payment') OR notification_kind IN('event_workflow_overdue','event_readiness','event_payment'));

DO $$ DECLARE job record; BEGIN
 FOR job IN SELECT jobid FROM cron.job WHERE jobname IN('notify-overdue-event-workflows','process-event-operational-alerts','create-due-event-invoice-tasks') LOOP
  PERFORM cron.unschedule(job.jobid);
 END LOOP;
 PERFORM cron.schedule('process-event-operational-alerts','*/5 * * * *','SELECT public.process_event_operational_alerts_in_delivery_window();');
END $$;
DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT e.id FROM public.events e JOIN public.event_workflow_instances i ON i.event_id=e.id AND i.status='active'
  WHERE e.status::text<>'cancelled' ORDER BY e.created_at DESC LIMIT 10
 LOOP PERFORM public.sync_event_workflow_tasks_internal(item.id); END LOOP;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM cron.job WHERE jobname='process-event-operational-alerts')<>1 THEN RAISE EXCEPTION 'Nieprawidłowy harmonogram przypomnień'; END IF;
 IF EXISTS(SELECT 1 FROM public.event_operational_alert_settings WHERE alert_admins OR alert_event_managers OR NOT alert_owner) THEN RAISE EXCEPTION 'Nieprawidłowy zakres odbiorców'; END IF;
 RAISE NOTICE 'Workflow owner-only migration: archived recipients=%, initialized events=%',
  (SELECT count(*) FROM private.event_workflow_recipient_archive),(SELECT count(*) FROM public.event_workflow_attention);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
