BEGIN;
SET LOCAL lock_timeout = '3s';

-- Preserve all subsequent invoice/payment workflow changes.
DO $patch$
DECLARE definition text; needle text := $old$WHEN 'contract_signed' THEN RETURN EXISTS ($old$;
BEGIN
  definition := pg_get_functiondef('public.event_workflow_requirement_is_met(uuid,uuid)'::regprocedure);
  IF position(needle in definition)=0 THEN RAISE EXCEPTION 'Nieznana wersja warunku podpisanej umowy.'; END IF;
  EXECUTE replace(definition,needle,$new$WHEN 'contract_signed' THEN RETURN EXISTS (
      SELECT 1 FROM public.event_partner_arrangements arrangement
      WHERE arrangement.event_id=p_event_id AND arrangement.enabled AND NOT arrangement.include_contract
    ) OR EXISTS ($new$);
END;
$patch$;

CREATE OR REPLACE FUNCTION public.get_event_workflow_readiness(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  instance_record record;
  stage_record record;
  requirement_record record;
  stages_json jsonb := '[]'::jsonb;
  requirements_json jsonb;
  requirement_met boolean;
  stage_total integer;
  stage_completed integer;
  total_required integer := 0;
  total_completed integer := 0;
  due_at_value timestamptz;
  stage_status text;
  partner_without_contract boolean;
BEGIN
  IF NOT public.can_view_event_workflows(p_event_id) THEN
    RAISE EXCEPTION 'Brak dostępu do procesu wydarzenia';
  END IF;

  PERFORM public.ensure_event_workflow_instance(p_event_id);

  SELECT instance.id, instance.status, instance.template_id, template.name AS template_name,
         event.name AS event_name, event.event_date
  INTO instance_record
  FROM public.event_workflow_instances instance
  JOIN public.event_workflow_templates template ON template.id = instance.template_id
  JOIN public.events event ON event.id = instance.event_id
  WHERE instance.event_id = p_event_id;

  IF instance_record.id IS NULL THEN RETURN NULL; END IF;
  SELECT EXISTS (SELECT 1 FROM public.event_partner_arrangements
    WHERE event_id=p_event_id AND enabled AND NOT include_contract)
  INTO partner_without_contract;

  FOR stage_record IN
    SELECT stage.* FROM public.event_workflow_stages stage
    WHERE stage.template_id = instance_record.template_id
    ORDER BY stage.order_index, stage.created_at
  LOOP
    requirements_json := '[]'::jsonb;
    stage_total := 0;
    stage_completed := 0;

    FOR requirement_record IN
      SELECT requirement.*, override.note, override.completed_by, override.completed_at
      FROM public.event_workflow_requirements requirement
      LEFT JOIN public.event_workflow_requirement_overrides override
        ON override.requirement_id = requirement.id AND override.instance_id = instance_record.id
      WHERE requirement.stage_id = stage_record.id
      ORDER BY requirement.order_index, requirement.created_at
    LOOP
      IF partner_without_contract AND requirement_record.requirement_key = 'contract_signed' THEN
        CONTINUE;
      END IF;
      requirement_met := public.event_workflow_requirement_is_met(p_event_id, requirement_record.id);
      IF requirement_record.is_required THEN
        stage_total := stage_total + 1;
        total_required := total_required + 1;
        IF requirement_met THEN
          stage_completed := stage_completed + 1;
          total_completed := total_completed + 1;
        END IF;
      END IF;

      requirements_json := requirements_json || jsonb_build_array(jsonb_build_object(
        'id', requirement_record.id,
        'key', requirement_record.requirement_key,
        'label', requirement_record.label,
        'description', requirement_record.description,
        'required', requirement_record.is_required,
        'completed', requirement_met,
        'manual', requirement_record.requirement_key = 'manual',
        'auto_create_task', requirement_record.auto_create_task,
        'note', requirement_record.note,
        'completed_by', requirement_record.completed_by,
        'completed_at', requirement_record.completed_at
      ));
    END LOOP;

    due_at_value := CASE
      WHEN stage_record.due_offset_days IS NULL THEN NULL
      ELSE instance_record.event_date + make_interval(days => stage_record.due_offset_days)
    END;

    stage_status := CASE
      WHEN stage_total = 0 OR stage_completed = stage_total THEN 'completed'
      WHEN due_at_value IS NOT NULL AND due_at_value < now() THEN 'overdue'
      ELSE 'pending'
    END;

    stages_json := stages_json || jsonb_build_array(jsonb_build_object(
      'id', stage_record.id,
      'name', stage_record.name,
      'description', CASE WHEN partner_without_contract AND stage_record.description = 'Klient, zaakceptowana oferta i podpisana umowa.' THEN 'Klient, zaakceptowana oferta i ustalenia z partnerem.' ELSE stage_record.description END,
      'order_index', stage_record.order_index,
      'color', stage_record.color,
      'is_blocking', stage_record.is_blocking,
      'due_at', due_at_value,
      'status', stage_status,
      'completed', stage_completed,
      'total', stage_total,
      'progress', CASE WHEN stage_total = 0 THEN 100 ELSE ROUND(stage_completed * 100.0 / stage_total) END,
      'requirements', requirements_json
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'instance_id', instance_record.id,
    'template_id', instance_record.template_id,
    'template_name', instance_record.template_name,
    'event_name', instance_record.event_name,
    'event_date', instance_record.event_date,
    'status', instance_record.status,
    'completed', total_completed,
    'total', total_required,
    'progress', CASE WHEN total_required = 0 THEN 100 ELSE ROUND(total_completed * 100.0 / total_required) END,
    'stages', stages_json
  );
END;
$$;

-- A saved arrangement refreshes automatic tasks; no manual completion overrides
-- or contract signature statuses are fabricated.
CREATE FUNCTION public.refresh_workflow_after_partner_arrangement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  PERFORM public.sync_event_workflow_tasks_internal(CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_workflow_after_partner_arrangement() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER refresh_workflow_after_partner_arrangement
AFTER INSERT OR UPDATE OR DELETE ON public.event_partner_arrangements
FOR EACH ROW EXECUTE FUNCTION public.refresh_workflow_after_partner_arrangement();
NOTIFY pgrst,'reload schema';
COMMIT;
