BEGIN;
CREATE UNIQUE INDEX notifications_assignment_response_once ON public.notifications ((metadata->>'assignment_response_key')) WHERE metadata ? 'assignment_response_key';
CREATE OR REPLACE FUNCTION public.guard_repeated_assignment_response()
RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF (to_jsonb(NEW)-ARRAY['status','responded_at','updated_at']) = (to_jsonb(OLD)-ARRAY['status','responded_at','updated_at']) THEN
  -- Old app versions can retry unconditionally; do not run logging/workflow/notification triggers twice.
  IF OLD.status::text IN ('accepted','rejected') AND NEW.status::text IN ('accepted','rejected') THEN RETURN NULL; END IF;
  IF OLD.status='pending' AND NEW.status::text IN ('accepted','rejected') AND NEW.invitation_expires_at < now() THEN
   RAISE EXCEPTION 'Zaproszenie wygasło. Poproś organizatora o ponowne wysłanie.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aaaa_guard_repeated_assignment_response BEFORE UPDATE ON public.employee_assignments FOR EACH ROW EXECUTE FUNCTION public.guard_repeated_assignment_response();

CREATE OR REPLACE FUNCTION public.notify_assignment_response()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE ev record; employee_name text; phases text; notification_id uuid; response_key text;
BEGIN
 IF OLD.status IS DISTINCT FROM 'pending' OR NEW.status::text NOT IN ('accepted','rejected') THEN RETURN NEW; END IF;
 SELECT id,name,created_by INTO ev FROM public.events WHERE id=NEW.event_id;
 IF ev.created_by IS NULL THEN RETURN NEW; END IF;
 SELECT coalesce(nullif(nickname,''),concat_ws(' ',name,surname)) INTO employee_name FROM public.employees WHERE id=NEW.employee_id;
 SELECT string_agg(p.name,', ' ORDER BY p.start_time,p.id) INTO phases FROM public.event_phases p
 WHERE p.event_id=NEW.event_id AND EXISTS(SELECT 1 FROM public.event_phase_assignments a WHERE a.phase_id=p.id AND a.employee_id=NEW.employee_id);
 response_key:='assignment-response:'||NEW.id::text||':'||coalesce(NEW.invitation_token::text,NEW.id::text);
 INSERT INTO public.notifications(category,title,message,type,related_entity_type,related_entity_id,action_url,metadata)
 VALUES('employee','Odpowiedź na zaproszenie',format('%s %s zaproszenie do wydarzenia "%s".%s',employee_name,
 CASE WHEN NEW.status='accepted' THEN 'zaakceptował(a)' ELSE 'odrzucił(a)' END,ev.name,
 CASE WHEN phases IS NULL THEN '' ELSE ' Fazy: '||phases||'.' END),
 CASE WHEN NEW.status='accepted' THEN 'success' ELSE 'warning' END,'event',NEW.event_id::text,'/crm/events/'||NEW.event_id::text,
 jsonb_build_object('assignment_response_key',response_key,'assignment_id',NEW.id,'event_id',NEW.event_id,'event_name',ev.name,
 'employee_id',NEW.employee_id,'employee_name',employee_name,'status',NEW.status,'role',NEW.role,'phases',phases))
 ON CONFLICT DO NOTHING RETURNING id INTO notification_id;
 IF notification_id IS NOT NULL THEN
  INSERT INTO public.notification_recipients(notification_id,user_id) VALUES(notification_id,ev.created_by) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;

-- Preserve standalone phase responses; only suppress notifications produced by
-- the nested propagation of the already-acknowledged event invitation.
DO $migration$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.notify_phase_assignment_response()'::regprocedure);
 definition:=regexp_replace(definition,'BEGIN', $guard$BEGIN
  IF pg_trigger_depth()>1 AND EXISTS(
   SELECT 1 FROM public.employee_assignments a JOIN public.event_phases p ON p.event_id=a.event_id
   WHERE p.id=NEW.phase_id AND a.employee_id=NEW.employee_id AND a.status::text=NEW.invitation_status::text
     AND a.status::text IN ('accepted','rejected')
  ) THEN RETURN NEW; END IF;
 $guard$);
 EXECUTE definition;
END $migration$;
CREATE OR REPLACE FUNCTION public.sync_notification_on_assignment_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
 UPDATE public.notifications n SET metadata=coalesce(n.metadata,'{}'::jsonb)||jsonb_build_object(
  'assignment_status',NEW.status,'responded_at',NEW.responded_at,'requires_response',NEW.status='pending')
 WHERE n.metadata->>'assignment_id'=NEW.id::text AND EXISTS(
 SELECT 1 FROM public.notification_recipients r WHERE r.notification_id=n.id AND r.user_id=NEW.employee_id);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_repeated_assignment_response() FROM PUBLIC,anon,authenticated;
COMMIT;
