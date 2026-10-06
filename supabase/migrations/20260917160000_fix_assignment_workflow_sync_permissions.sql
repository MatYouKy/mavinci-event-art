BEGIN;
-- Only an authenticated employee changing their own invitation response can
-- refresh derived workflow tasks without manager rights. All other trigger paths
-- and the public RPC retain manager authorization. Internal execution is revoked.
CREATE OR REPLACE FUNCTION public.sync_event_workflow_tasks_internal(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  instance_record record;
  requirement_record record;
  event_record record;
  task_id_value uuid;
  created_count integer := 0;
  is_met boolean;
BEGIN

  IF p_event_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.events WHERE id=p_event_id) THEN RETURN 0; END IF;
  PERFORM public.ensure_event_workflow_instance(p_event_id);
  SELECT instance.* INTO instance_record
  FROM public.event_workflow_instances instance WHERE instance.event_id = p_event_id;
  SELECT event.* INTO event_record FROM public.events event WHERE event.id = p_event_id;
  IF instance_record.id IS NULL THEN RETURN 0; END IF;

  FOR requirement_record IN
    SELECT requirement.*, stage.due_offset_days
    FROM public.event_workflow_requirements requirement
    JOIN public.event_workflow_stages stage ON stage.id = requirement.stage_id
    WHERE stage.template_id = instance_record.template_id
      AND requirement.auto_create_task = true
      AND requirement.is_required = true
  LOOP
    is_met := public.event_workflow_requirement_is_met(p_event_id, requirement_record.id);
    SELECT link.task_id INTO task_id_value
    FROM public.event_workflow_tasks link
    WHERE link.instance_id = instance_record.id AND link.requirement_id = requirement_record.id;

    IF is_met AND task_id_value IS NOT NULL THEN
      UPDATE public.tasks SET status = 'completed', board_column = 'completed', updated_at = now()
      WHERE id = task_id_value AND status::text NOT IN ('completed', 'cancelled');
    ELSIF NOT is_met AND task_id_value IS NULL THEN
      INSERT INTO public.tasks(title, description, priority, status, board_column, due_date, event_id, created_by, assigned_to)
      VALUES (
        COALESCE(NULLIF(BTRIM(requirement_record.task_title), ''), requirement_record.label),
        'Automatyczne zadanie procesu wydarzenia „' || event_record.name || '”.',
        requirement_record.task_priority::task_priority,
        'todo', 'todo',
        CASE WHEN requirement_record.due_offset_days IS NULL THEN NULL
             ELSE event_record.event_date + make_interval(days => requirement_record.due_offset_days) END,
        p_event_id,
        COALESCE(event_record.created_by, public.current_workflow_employee_id()),
        event_record.created_by
      ) RETURNING id INTO task_id_value;

      INSERT INTO public.event_workflow_tasks(instance_id, requirement_id, task_id)
      VALUES (instance_record.id, requirement_record.id, task_id_value);
      created_count := created_count + 1;
    END IF;
  END LOOP;

  RETURN created_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_event_workflow_tasks_internal(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sync_event_workflow_tasks(p_event_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_event_workflows(p_event_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do synchronizacji zadań procesu' USING ERRCODE='42501';
  END IF;
  RETURN public.sync_event_workflow_tasks_internal(p_event_id);
END;
$$;
CREATE OR REPLACE FUNCTION public.refresh_event_workflow_after_related_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE related_event_id uuid; own_response boolean:=false;
BEGIN
 related_event_id:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
 -- The exception is exclusively for a worker responding to their own invitation.
 -- No event, employee, role, rates or other assignment fields may change here.
 IF TG_TABLE_SCHEMA='public' AND TG_TABLE_NAME='employee_assignments' AND TG_OP='UPDATE' THEN
  own_response:=auth.uid() IS NOT NULL
   AND NEW.status::text IN ('accepted','rejected')
   AND (to_jsonb(NEW)-ARRAY['status','responded_at','updated_at']) = (to_jsonb(OLD)-ARRAY['status','responded_at','updated_at'])
   AND EXISTS(SELECT 1 FROM public.employees e WHERE e.id=NEW.employee_id
    AND (e.id=auth.uid() OR e.auth_user_id=auth.uid()) AND e.is_active);
 END IF;
 IF related_event_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=related_event_id) THEN
  IF own_response THEN
   PERFORM public.sync_event_workflow_tasks_internal(related_event_id);
  ELSE
   PERFORM public.sync_event_workflow_tasks(related_event_id);
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_event_workflow_after_related_change() FROM PUBLIC,anon,authenticated;
COMMIT;
