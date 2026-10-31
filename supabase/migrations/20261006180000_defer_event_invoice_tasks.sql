BEGIN;
SET LOCAL lock_timeout = '3s';

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
  invoice_task_day date;
BEGIN

  IF p_event_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.events WHERE id=p_event_id) THEN RETURN 0; END IF;
  PERFORM 1 FROM public.events WHERE id = p_event_id FOR UPDATE;
  PERFORM public.ensure_event_workflow_instance(p_event_id);
  SELECT instance.* INTO instance_record
  FROM public.event_workflow_instances instance WHERE instance.event_id = p_event_id;
  SELECT event.* INTO event_record FROM public.events event WHERE event.id = p_event_id;
  IF instance_record.id IS NULL THEN RETURN 0; END IF;
  invoice_task_day := (coalesce(event_record.event_end_date,event_record.event_date) AT TIME ZONE 'Europe/Warsaw')::date + 1;


  FOR requirement_record IN
    SELECT requirement.*, stage.due_offset_days
    FROM public.event_workflow_requirements requirement
    JOIN public.event_workflow_stages stage ON stage.id = requirement.stage_id
    WHERE stage.template_id = instance_record.template_id
      AND requirement.auto_create_task = true
      AND requirement.is_required = true
  LOOP
    IF requirement_record.requirement_key = 'invoice_issued' THEN
      -- No task exists before the first day after realization finishes.
      IF invoice_task_day IS NULL OR event_record.status::text = 'cancelled'
        OR (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date < invoice_task_day THEN
        CONTINUE;
      END IF;
      -- An advance invoice does not replace the invoice for the final settlement.
      is_met := EXISTS (
        SELECT 1 FROM public.invoices i WHERE i.status IN ('issued','sent','paid','overdue')
          AND i.invoice_type IN ('vat','final') AND i.is_proforma IS NOT TRUE
          AND (EXISTS (SELECT 1 FROM public.invoice_event_allocations a
               WHERE a.invoice_id=i.id AND a.event_id=p_event_id AND a.allocation_weight>0)
            OR (i.event_id=p_event_id AND NOT EXISTS (
               SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id)))
      );
    ELSE
      is_met := public.event_workflow_requirement_is_met(p_event_id, requirement_record.id);
    END IF;
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
        CASE WHEN requirement_record.requirement_key = 'invoice_issued'
             THEN ((invoice_task_day + time '23:59:59') AT TIME ZONE 'Europe/Warsaw')
             WHEN requirement_record.due_offset_days IS NULL THEN NULL
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

-- Time passing does not trigger an event update: an hourly job creates due tasks.
CREATE OR REPLACE FUNCTION public.create_due_event_invoice_tasks()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item record; created integer := 0;
BEGIN
  FOR item IN
    SELECT DISTINCT e.id
    FROM public.events e
    JOIN public.event_workflow_instances instance ON instance.event_id=e.id
    JOIN public.event_workflow_stages stage ON stage.template_id=instance.template_id
    JOIN public.event_workflow_requirements req ON req.stage_id=stage.id
    WHERE e.status::text <> 'cancelled'
      AND req.requirement_key='invoice_issued' AND req.auto_create_task AND req.is_required
      AND (coalesce(e.event_end_date,e.event_date) AT TIME ZONE 'Europe/Warsaw')::date
        < (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Warsaw')::date
      AND NOT EXISTS (SELECT 1 FROM public.event_workflow_tasks link
        WHERE link.instance_id=instance.id AND link.requirement_id=req.id)
      AND NOT EXISTS (SELECT 1 FROM public.invoices i
        WHERE i.status IN ('issued','sent','paid','overdue') AND i.invoice_type IN ('vat','final')
          AND i.is_proforma IS NOT TRUE
          AND (EXISTS (SELECT 1 FROM public.invoice_event_allocations a
            WHERE a.invoice_id=i.id AND a.event_id=e.id AND a.allocation_weight>0)
            OR (i.event_id=e.id AND NOT EXISTS (SELECT 1 FROM public.invoice_event_allocations a WHERE a.invoice_id=i.id))))
    ORDER BY e.id LIMIT 100
  LOOP
    created := created + public.sync_event_workflow_tasks_internal(item.id);
  END LOOP;
  RETURN created;
END;
$$;
REVOKE ALL ON FUNCTION public.create_due_event_invoice_tasks() FROM PUBLIC,anon,authenticated;
DO $$
DECLARE existing_job bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='cron') THEN
    RAISE EXCEPTION 'Brak pg_cron — nie można zaplanować automatycznego tworzenia zadań fakturowania.';
  END IF;
  FOR existing_job IN SELECT jobid FROM cron.job WHERE jobname='create-due-event-invoice-tasks' LOOP
    PERFORM cron.unschedule(existing_job);
  END LOOP;
  PERFORM cron.schedule('create-due-event-invoice-tasks','0 * * * *','SELECT public.create_due_event_invoice_tasks();');
END;
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
