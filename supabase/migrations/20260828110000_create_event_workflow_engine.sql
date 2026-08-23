/*
  # Event workflow and operational readiness

  A configurable process layer over the existing CRM data. Requirements are
  evaluated from their canonical tables; manual confirmation is only used for
  checks which cannot be proven by an existing record.
*/

CREATE OR REPLACE FUNCTION public.current_workflow_employee_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT employee.id
  FROM public.employees employee
  WHERE employee.is_active = true
    AND (employee.id = auth.uid() OR employee.auth_user_id = auth.uid())
  ORDER BY (employee.id = auth.uid()) DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_view_event_workflows(p_event_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH current_employee AS (
    SELECT employee.*
    FROM public.employees employee
    WHERE employee.id = public.current_workflow_employee_id()
  )
  SELECT EXISTS (
    SELECT 1
    FROM current_employee employee
    WHERE employee.role = 'admin'
      OR employee.access_level = 'admin'
      OR 'events_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR 'events_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
      OR p_event_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.events event
        WHERE event.id = p_event_id AND event.created_by = employee.id
      )
      OR EXISTS (
        SELECT 1 FROM public.employee_assignments assignment
        WHERE assignment.event_id = p_event_id
          AND assignment.employee_id = employee.id
          AND COALESCE(assignment.status, 'accepted') <> 'rejected'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_event_workflows(p_event_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.id = public.current_workflow_employee_id()
      AND (
        employee.role = 'admin'
        OR employee.access_level = 'admin'
        OR 'events_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        OR (p_event_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.events event
          WHERE event.id = p_event_id AND event.created_by = employee.id
        ))
      )
  );
$$;

CREATE TABLE IF NOT EXISTS public.event_workflow_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES public.employees(id) ON DELETE SET NULL
    DEFAULT public.current_workflow_employee_id(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS event_workflow_one_default_idx
  ON public.event_workflow_templates(is_default)
  WHERE is_default = true AND is_active = true;

CREATE TABLE IF NOT EXISTS public.event_workflow_template_categories (
  template_id uuid NOT NULL REFERENCES public.event_workflow_templates(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.event_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, category_id)
);

CREATE TABLE IF NOT EXISTS public.event_workflow_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.event_workflow_templates(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  order_index integer NOT NULL DEFAULT 0,
  due_offset_days integer,
  color text NOT NULL DEFAULT '#d3bb73',
  is_blocking boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_workflow_stages_template_order_idx
  ON public.event_workflow_stages(template_id, order_index);

CREATE TABLE IF NOT EXISTS public.event_workflow_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.event_workflow_stages(id) ON DELETE CASCADE,
  requirement_key text NOT NULL,
  label text NOT NULL,
  description text,
  is_required boolean NOT NULL DEFAULT true,
  order_index integer NOT NULL DEFAULT 0,
  auto_create_task boolean NOT NULL DEFAULT false,
  task_title text,
  task_priority text NOT NULL DEFAULT 'high'
    CHECK (task_priority IN ('low', 'medium', 'high', 'urgent')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(stage_id, requirement_key, label)
);

CREATE TABLE IF NOT EXISTS public.event_workflow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.events(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.event_workflow_templates(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'cancelled')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.event_workflow_requirement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.event_workflow_instances(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES public.event_workflow_requirements(id) ON DELETE CASCADE,
  is_completed boolean NOT NULL DEFAULT true,
  note text,
  completed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instance_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS public.event_workflow_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES public.event_workflow_instances(id) ON DELETE CASCADE,
  requirement_id uuid NOT NULL REFERENCES public.event_workflow_requirements(id) ON DELETE CASCADE,
  task_id uuid NOT NULL UNIQUE REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instance_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS public.event_workflow_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  instance_id uuid REFERENCES public.event_workflow_instances(id) ON DELETE SET NULL,
  requirement_id uuid REFERENCES public.event_workflow_requirements(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  performed_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_workflow_activity_event_idx
  ON public.event_workflow_activity(event_id, created_at DESC);

ALTER TABLE public.event_workflow_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_workflow_template_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_workflow_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_workflow_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_workflow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_workflow_requirement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_workflow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_workflow_activity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "workflow templates are visible" ON public.event_workflow_templates;
CREATE POLICY "workflow templates are visible" ON public.event_workflow_templates
  FOR SELECT TO authenticated USING (public.can_view_event_workflows(NULL));
DROP POLICY IF EXISTS "workflow templates are managed" ON public.event_workflow_templates;
CREATE POLICY "workflow templates are managed" ON public.event_workflow_templates
  FOR ALL TO authenticated USING (public.can_manage_event_workflows(NULL))
  WITH CHECK (public.can_manage_event_workflows(NULL));

DROP POLICY IF EXISTS "workflow categories are visible" ON public.event_workflow_template_categories;
CREATE POLICY "workflow categories are visible" ON public.event_workflow_template_categories
  FOR SELECT TO authenticated USING (public.can_view_event_workflows(NULL));
DROP POLICY IF EXISTS "workflow categories are managed" ON public.event_workflow_template_categories;
CREATE POLICY "workflow categories are managed" ON public.event_workflow_template_categories
  FOR ALL TO authenticated USING (public.can_manage_event_workflows(NULL))
  WITH CHECK (public.can_manage_event_workflows(NULL));

DROP POLICY IF EXISTS "workflow stages are visible" ON public.event_workflow_stages;
CREATE POLICY "workflow stages are visible" ON public.event_workflow_stages
  FOR SELECT TO authenticated USING (public.can_view_event_workflows(NULL));
DROP POLICY IF EXISTS "workflow stages are managed" ON public.event_workflow_stages;
CREATE POLICY "workflow stages are managed" ON public.event_workflow_stages
  FOR ALL TO authenticated USING (public.can_manage_event_workflows(NULL))
  WITH CHECK (public.can_manage_event_workflows(NULL));

DROP POLICY IF EXISTS "workflow requirements are visible" ON public.event_workflow_requirements;
CREATE POLICY "workflow requirements are visible" ON public.event_workflow_requirements
  FOR SELECT TO authenticated USING (public.can_view_event_workflows(NULL));
DROP POLICY IF EXISTS "workflow requirements are managed" ON public.event_workflow_requirements;
CREATE POLICY "workflow requirements are managed" ON public.event_workflow_requirements
  FOR ALL TO authenticated USING (public.can_manage_event_workflows(NULL))
  WITH CHECK (public.can_manage_event_workflows(NULL));

DROP POLICY IF EXISTS "workflow instances follow event access" ON public.event_workflow_instances;
CREATE POLICY "workflow instances follow event access" ON public.event_workflow_instances
  FOR SELECT TO authenticated USING (public.can_view_event_workflows(event_id));
DROP POLICY IF EXISTS "workflow instances are managed" ON public.event_workflow_instances;
CREATE POLICY "workflow instances are managed" ON public.event_workflow_instances
  FOR ALL TO authenticated USING (public.can_manage_event_workflows(event_id))
  WITH CHECK (public.can_manage_event_workflows(event_id));

DROP POLICY IF EXISTS "workflow overrides follow event access" ON public.event_workflow_requirement_overrides;
CREATE POLICY "workflow overrides follow event access" ON public.event_workflow_requirement_overrides
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.event_workflow_instances instance
    WHERE instance.id = instance_id AND public.can_view_event_workflows(instance.event_id)
  ));
DROP POLICY IF EXISTS "workflow overrides are managed" ON public.event_workflow_requirement_overrides;
CREATE POLICY "workflow overrides are managed" ON public.event_workflow_requirement_overrides
  FOR ALL TO authenticated USING (EXISTS (
    SELECT 1 FROM public.event_workflow_instances instance
    WHERE instance.id = instance_id AND public.can_manage_event_workflows(instance.event_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.event_workflow_instances instance
    WHERE instance.id = instance_id AND public.can_manage_event_workflows(instance.event_id)
  ));

DROP POLICY IF EXISTS "workflow task links follow event access" ON public.event_workflow_tasks;
CREATE POLICY "workflow task links follow event access" ON public.event_workflow_tasks
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.event_workflow_instances instance
    WHERE instance.id = instance_id AND public.can_view_event_workflows(instance.event_id)
  ));

DROP POLICY IF EXISTS "workflow activity follows event access" ON public.event_workflow_activity;
CREATE POLICY "workflow activity follows event access" ON public.event_workflow_activity
  FOR SELECT TO authenticated USING (public.can_view_event_workflows(event_id));

CREATE OR REPLACE FUNCTION public.ensure_event_workflow_instance(p_event_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  event_category uuid;
  selected_template uuid;
  existing_instance uuid;
BEGIN
  SELECT instance.id INTO existing_instance
  FROM public.event_workflow_instances instance
  WHERE instance.event_id = p_event_id;

  IF existing_instance IS NOT NULL THEN
    RETURN existing_instance;
  END IF;

  SELECT event.category_id INTO event_category
  FROM public.events event WHERE event.id = p_event_id;

  SELECT template.id INTO selected_template
  FROM public.event_workflow_templates template
  LEFT JOIN public.event_workflow_template_categories mapping
    ON mapping.template_id = template.id AND mapping.category_id = event_category
  WHERE template.is_active = true
    AND (mapping.category_id IS NOT NULL OR template.is_default = true)
  ORDER BY (mapping.category_id IS NOT NULL) DESC, template.is_default DESC, template.created_at
  LIMIT 1;

  IF selected_template IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.event_workflow_instances(event_id, template_id)
  VALUES (p_event_id, selected_template)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO existing_instance;

  IF existing_instance IS NULL THEN
    SELECT id INTO existing_instance FROM public.event_workflow_instances WHERE event_id = p_event_id;
  END IF;

  RETURN existing_instance;
END;
$$;

CREATE OR REPLACE FUNCTION public.event_workflow_requirement_is_met(
  p_event_id uuid,
  p_requirement_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  requirement_key text;
  instance_id_value uuid;
  manually_completed boolean;
BEGIN
  SELECT requirement.requirement_key, instance.id
  INTO requirement_key, instance_id_value
  FROM public.event_workflow_requirements requirement
  JOIN public.event_workflow_stages stage ON stage.id = requirement.stage_id
  JOIN public.event_workflow_instances instance ON instance.template_id = stage.template_id
  WHERE requirement.id = p_requirement_id AND instance.event_id = p_event_id;

  SELECT override.is_completed INTO manually_completed
  FROM public.event_workflow_requirement_overrides override
  WHERE override.instance_id = instance_id_value
    AND override.requirement_id = p_requirement_id;

  IF manually_completed IS TRUE THEN RETURN true; END IF;

  CASE requirement_key
    WHEN 'event_details_complete' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.events event
        WHERE event.id = p_event_id
          AND event.event_date IS NOT NULL
          AND NULLIF(BTRIM(COALESCE(event.location, '')), '') IS NOT NULL
          AND (event.contact_person_id IS NOT NULL OR event.organization_id IS NOT NULL OR event.client_id IS NOT NULL)
      );
    WHEN 'client_assigned' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.events event
        WHERE event.id = p_event_id
          AND (event.contact_person_id IS NOT NULL OR event.organization_id IS NOT NULL OR event.client_id IS NOT NULL)
      );
    WHEN 'offer_accepted' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.offers offer
        WHERE offer.event_id = p_event_id AND offer.status::text IN ('accepted', 'approved', 'won')
      );
    WHEN 'contract_signed' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.contracts contract
        WHERE contract.event_id = p_event_id
          AND (contract.status::text IN ('signed', 'signed_returned', 'completed') OR contract.signed_at IS NOT NULL)
      );
    WHEN 'team_assigned' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.employee_assignments assignment
        WHERE assignment.event_id = p_event_id
          AND COALESCE(assignment.status, 'accepted') = 'accepted'
      );
    WHEN 'equipment_assigned' THEN
      RETURN EXISTS (SELECT 1 FROM public.event_equipment equipment WHERE equipment.event_id = p_event_id);
    WHEN 'vehicle_assigned' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.event_vehicles vehicle
        WHERE vehicle.event_id = p_event_id AND COALESCE(vehicle.status, 'planned') <> 'cancelled'
      );
    WHEN 'agenda_ready' THEN
      RETURN EXISTS (SELECT 1 FROM public.event_agendas agenda WHERE agenda.event_id = p_event_id);
    WHEN 'tasks_complete' THEN
      RETURN NOT EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.event_id = p_event_id
          AND task.status::text NOT IN ('completed', 'cancelled')
          AND NOT EXISTS (
            SELECT 1 FROM public.event_workflow_tasks workflow_task
            WHERE workflow_task.task_id = task.id
          )
      );
    WHEN 'invoice_issued' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.invoices invoice
        WHERE invoice.event_id = p_event_id AND invoice.status IN ('issued', 'sent', 'paid', 'overdue')
      );
    WHEN 'invoice_paid' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.invoices invoice
        WHERE invoice.event_id = p_event_id AND invoice.status = 'paid'
      );
    WHEN 'wedding_card_ready' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.wedding_cards card
        WHERE card.event_id = p_event_id AND card.status IN ('submitted', 'approved')
      );
    ELSE
      RETURN COALESCE(manually_completed, false);
  END CASE;
END;
$$;

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
      'description', stage_record.description,
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

CREATE OR REPLACE FUNCTION public.set_event_workflow_requirement_override(
  p_event_id uuid,
  p_requirement_id uuid,
  p_completed boolean,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  instance_id_value uuid;
  requirement_key_value text;
BEGIN
  IF NOT public.can_manage_event_workflows(p_event_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do potwierdzania gotowości';
  END IF;

  instance_id_value := public.ensure_event_workflow_instance(p_event_id);
  SELECT requirement.requirement_key INTO requirement_key_value
  FROM public.event_workflow_requirements requirement
  JOIN public.event_workflow_stages stage ON stage.id = requirement.stage_id
  JOIN public.event_workflow_instances instance ON instance.template_id = stage.template_id
  WHERE requirement.id = p_requirement_id AND instance.id = instance_id_value;

  IF requirement_key_value IS DISTINCT FROM 'manual' THEN
    RAISE EXCEPTION 'Ten warunek jest wyliczany automatycznie z danych CRM';
  END IF;

  INSERT INTO public.event_workflow_requirement_overrides(
    instance_id, requirement_id, is_completed, note, completed_by, completed_at, updated_at
  ) VALUES (
    instance_id_value, p_requirement_id, p_completed, NULLIF(BTRIM(p_note), ''),
    public.current_workflow_employee_id(), CASE WHEN p_completed THEN now() ELSE NULL END, now()
  )
  ON CONFLICT (instance_id, requirement_id) DO UPDATE SET
    is_completed = EXCLUDED.is_completed,
    note = EXCLUDED.note,
    completed_by = EXCLUDED.completed_by,
    completed_at = EXCLUDED.completed_at,
    updated_at = now();

  INSERT INTO public.event_workflow_activity(
    event_id, instance_id, requirement_id, action, details, performed_by
  ) VALUES (
    p_event_id, instance_id_value, p_requirement_id,
    CASE WHEN p_completed THEN 'requirement_completed' ELSE 'requirement_reopened' END,
    jsonb_build_object('note', p_note), public.current_workflow_employee_id()
  );

  RETURN public.get_event_workflow_readiness(p_event_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_event_workflow_tasks(p_event_id uuid)
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
  IF auth.uid() IS NOT NULL AND NOT public.can_manage_event_workflows(p_event_id) THEN
    RAISE EXCEPTION 'Brak uprawnień do synchronizacji zadań procesu';
  END IF;

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

CREATE OR REPLACE FUNCTION public.get_event_workflow_attention_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  result_count integer := 0;
  instance_record record;
  stage_record record;
BEGIN
  FOR instance_record IN
    SELECT instance.id, instance.event_id, instance.template_id, event.event_date
    FROM public.event_workflow_instances instance
    JOIN public.events event ON event.id = instance.event_id
    WHERE instance.status = 'active'
      AND event.status::text NOT IN ('cancelled', 'completed')
      AND public.can_view_event_workflows(instance.event_id)
  LOOP
    FOR stage_record IN
      SELECT stage.id, stage.due_offset_days
      FROM public.event_workflow_stages stage
      WHERE stage.template_id = instance_record.template_id
        AND stage.is_blocking = true
        AND stage.due_offset_days IS NOT NULL
        AND instance_record.event_date + make_interval(days => stage.due_offset_days) < now()
    LOOP
      IF EXISTS (
        SELECT 1 FROM public.event_workflow_requirements requirement
        WHERE requirement.stage_id = stage_record.id
          AND requirement.is_required = true
          AND NOT public.event_workflow_requirement_is_met(instance_record.event_id, requirement.id)
      ) THEN
        result_count := result_count + 1;
        EXIT;
      END IF;
    END LOOP;
  END LOOP;
  RETURN result_count;
END;
$$;

-- Default process. It is intentionally useful for every event category.
DO $$
DECLARE
  template_id_value uuid;
  stage_id_value uuid;
BEGIN
  SELECT id INTO template_id_value
  FROM public.event_workflow_templates
  WHERE name = 'Standardowa realizacja wydarzenia'
  LIMIT 1;

  IF template_id_value IS NULL THEN
    UPDATE public.event_workflow_templates SET is_default = false WHERE is_default = true;
    INSERT INTO public.event_workflow_templates(name, description, is_default)
    VALUES (
      'Standardowa realizacja wydarzenia',
      'Kontrola kompletności od sprzedaży, przez przygotowanie, po rozliczenie.',
      true
    ) RETURNING id INTO template_id_value;

    INSERT INTO public.event_workflow_stages(template_id, name, description, order_index, due_offset_days, color)
    VALUES (template_id_value, 'Formalności', 'Klient, zaakceptowana oferta i podpisana umowa.', 10, -30, '#60a5fa')
    RETURNING id INTO stage_id_value;
    INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index, auto_create_task, task_title)
    VALUES
      (stage_id_value, 'event_details_complete', 'Uzupełnione kluczowe dane wydarzenia', 10, false, NULL),
      (stage_id_value, 'offer_accepted', 'Zaakceptowana oferta', 20, true, 'Uzyskaj akceptację oferty'),
      (stage_id_value, 'contract_signed', 'Podpisana umowa', 30, true, 'Dopilnuj podpisania umowy');

    INSERT INTO public.event_workflow_stages(template_id, name, description, order_index, due_offset_days, color)
    VALUES (template_id_value, 'Przygotowanie realizacji', 'Zespół, agenda i zasoby potrzebne do realizacji.', 20, -7, '#d3bb73')
    RETURNING id INTO stage_id_value;
    INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index, auto_create_task, task_title)
    VALUES
      (stage_id_value, 'team_assigned', 'Przypisany i zaakceptowany zespół', 10, true, 'Skompletuj zespół wydarzenia'),
      (stage_id_value, 'agenda_ready', 'Przygotowana agenda', 20, true, 'Przygotuj agendę wydarzenia'),
      (stage_id_value, 'equipment_assigned', 'Przypisany sprzęt', 30, true, 'Zarezerwuj sprzęt na wydarzenie'),
      (stage_id_value, 'vehicle_assigned', 'Zaplanowany transport', 40, false, NULL);

    INSERT INTO public.event_workflow_stages(template_id, name, description, order_index, due_offset_days, color)
    VALUES (template_id_value, 'Gotowość operacyjna', 'Ostatnia kontrola przed rozpoczęciem wydarzenia.', 30, -1, '#34d399')
    RETURNING id INTO stage_id_value;
    INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, description, order_index)
    VALUES
      (stage_id_value, 'tasks_complete', 'Brak otwartych zadań przygotowawczych', NULL, 10),
      (stage_id_value, 'manual', 'Potwierdzona gotowość realizacji', 'Końcowa kontrola odpowiedzialnego managera.', 20);

    INSERT INTO public.event_workflow_stages(template_id, name, description, order_index, due_offset_days, color)
    VALUES (template_id_value, 'Rozliczenie i zamknięcie', 'Dokumenty finansowe oraz końcowe potwierdzenie.', 40, 7, '#a78bfa')
    RETURNING id INTO stage_id_value;
    INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, description, order_index, auto_create_task, task_title)
    VALUES
      (stage_id_value, 'invoice_issued', 'Wystawiona faktura', NULL, 10, true, 'Wystaw fakturę za wydarzenie'),
      (stage_id_value, 'invoice_paid', 'Płatność zaksięgowana', NULL, 20, false, NULL),
      (stage_id_value, 'manual', 'Zamknięte zwroty, szkody i dokumentacja', 'Potwierdzenie końcowe osoby odpowiedzialnej.', 30, false, NULL);
  END IF;
END;
$$;

-- Wedding template extends the standard process with the wedding card.
DO $$
DECLARE
  template_id_value uuid;
  stage_id_value uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.event_categories WHERE LOWER(name) LIKE 'wesel%')
    AND NOT EXISTS (SELECT 1 FROM public.event_workflow_templates WHERE name = 'Realizacja wesela') THEN
    INSERT INTO public.event_workflow_templates(name, description, is_default)
    VALUES ('Realizacja wesela', 'Proces realizacji wesela z kontrolą Karty Weselnej.', false)
    RETURNING id INTO template_id_value;

    INSERT INTO public.event_workflow_template_categories(template_id, category_id)
    SELECT template_id_value, category.id FROM public.event_categories category
    WHERE LOWER(category.name) LIKE 'wesel%';

    INSERT INTO public.event_workflow_stages(template_id, name, description, order_index, due_offset_days, color)
    VALUES (template_id_value, 'Formalności', 'Klient, zaakceptowana oferta i podpisana umowa.', 10, -60, '#60a5fa')
    RETURNING id INTO stage_id_value;
    INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index, auto_create_task, task_title)
    VALUES
      (stage_id_value, 'event_details_complete', 'Uzupełnione kluczowe dane wesela', 10, false, NULL),
      (stage_id_value, 'offer_accepted', 'Zaakceptowana oferta', 20, true, 'Uzyskaj akceptację oferty weselnej'),
      (stage_id_value, 'contract_signed', 'Podpisana umowa', 30, true, 'Dopilnuj podpisania umowy weselnej');

    INSERT INTO public.event_workflow_stages(template_id, name, description, order_index, due_offset_days, color)
    VALUES (template_id_value, 'Program wesela', 'Karta Weselna i agenda stanowią jedno źródło ustaleń.', 20, -14, '#f472b6')
    RETURNING id INTO stage_id_value;
    INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index, auto_create_task, task_title)
    VALUES
      (stage_id_value, 'wedding_card_ready', 'Karta Weselna wysłana do akceptacji', 10, true, 'Dopilnuj uzupełnienia Karty Weselnej'),
      (stage_id_value, 'agenda_ready', 'Przygotowana agenda realizacyjna', 20, true, 'Przygotuj agendę wesela');

    INSERT INTO public.event_workflow_stages(template_id, name, description, order_index, due_offset_days, color)
    VALUES (template_id_value, 'Gotowość operacyjna', 'Zespół, sprzęt, transport i kontrola końcowa.', 30, -2, '#34d399')
    RETURNING id INTO stage_id_value;
    INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index, auto_create_task, task_title)
    VALUES
      (stage_id_value, 'team_assigned', 'Przypisany i zaakceptowany zespół', 10, true, 'Skompletuj zespół wesela'),
      (stage_id_value, 'equipment_assigned', 'Przypisany sprzęt', 20, true, 'Zarezerwuj sprzęt na wesele'),
      (stage_id_value, 'vehicle_assigned', 'Zaplanowany transport', 30, false, NULL),
      (stage_id_value, 'manual', 'Potwierdzona gotowość realizacji', 40, false, NULL);

    INSERT INTO public.event_workflow_stages(template_id, name, description, order_index, due_offset_days, color)
    VALUES (template_id_value, 'Rozliczenie i zamknięcie', 'Faktura, płatność i zamknięcie dokumentacji.', 40, 7, '#a78bfa')
    RETURNING id INTO stage_id_value;
    INSERT INTO public.event_workflow_requirements(stage_id, requirement_key, label, order_index, auto_create_task, task_title)
    VALUES
      (stage_id_value, 'invoice_issued', 'Wystawiona faktura', 10, true, 'Wystaw fakturę za wesele'),
      (stage_id_value, 'invoice_paid', 'Płatność zaksięgowana', 20, false, NULL),
      (stage_id_value, 'manual', 'Zamknięte zwroty, szkody i dokumentacja', 30, false, NULL);
  END IF;
END;
$$;

INSERT INTO public.event_workflow_instances(event_id, template_id)
SELECT event.id, COALESCE(category_template.id, default_template.id)
FROM public.events event
LEFT JOIN LATERAL (
  SELECT template.id
  FROM public.event_workflow_templates template
  JOIN public.event_workflow_template_categories mapping ON mapping.template_id = template.id
  WHERE mapping.category_id = event.category_id AND template.is_active = true
  ORDER BY template.created_at LIMIT 1
) category_template ON true
LEFT JOIN LATERAL (
  SELECT template.id FROM public.event_workflow_templates template
  WHERE template.is_default = true AND template.is_active = true
  ORDER BY template.created_at LIMIT 1
) default_template ON true
WHERE COALESCE(category_template.id, default_template.id) IS NOT NULL
ON CONFLICT (event_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.initialize_event_workflow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_event_workflow_instance(NEW.id);
  PERFORM public.sync_event_workflow_tasks(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS initialize_event_workflow_after_insert ON public.events;
CREATE TRIGGER initialize_event_workflow_after_insert
  AFTER INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.initialize_event_workflow();

CREATE OR REPLACE FUNCTION public.refresh_event_workflow_after_related_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  related_event_id uuid;
BEGIN
  related_event_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  IF related_event_id IS NOT NULL THEN
    PERFORM public.sync_event_workflow_tasks(related_event_id);
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refresh_workflow_after_offer ON public.offers;
CREATE TRIGGER refresh_workflow_after_offer
  AFTER INSERT OR UPDATE OR DELETE ON public.offers
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DROP TRIGGER IF EXISTS refresh_workflow_after_contract ON public.contracts;
CREATE TRIGGER refresh_workflow_after_contract
  AFTER INSERT OR UPDATE OR DELETE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DROP TRIGGER IF EXISTS refresh_workflow_after_assignment ON public.employee_assignments;
CREATE TRIGGER refresh_workflow_after_assignment
  AFTER INSERT OR UPDATE OR DELETE ON public.employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DROP TRIGGER IF EXISTS refresh_workflow_after_equipment ON public.event_equipment;
CREATE TRIGGER refresh_workflow_after_equipment
  AFTER INSERT OR UPDATE OR DELETE ON public.event_equipment
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DROP TRIGGER IF EXISTS refresh_workflow_after_vehicle ON public.event_vehicles;
CREATE TRIGGER refresh_workflow_after_vehicle
  AFTER INSERT OR UPDATE OR DELETE ON public.event_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DROP TRIGGER IF EXISTS refresh_workflow_after_agenda ON public.event_agendas;
CREATE TRIGGER refresh_workflow_after_agenda
  AFTER INSERT OR UPDATE OR DELETE ON public.event_agendas
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DROP TRIGGER IF EXISTS refresh_workflow_after_invoice ON public.invoices;
CREATE TRIGGER refresh_workflow_after_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

DROP TRIGGER IF EXISTS refresh_workflow_after_wedding_card ON public.wedding_cards;
CREATE TRIGGER refresh_workflow_after_wedding_card
  AFTER INSERT OR UPDATE OR DELETE ON public.wedding_cards
  FOR EACH ROW EXECUTE FUNCTION public.refresh_event_workflow_after_related_change();

CREATE OR REPLACE FUNCTION public.notify_overdue_event_workflows()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  overdue_item record;
  notification_id_value uuid;
  recipient record;
  sent_count integer := 0;
BEGIN
  FOR overdue_item IN
    SELECT instance.id AS instance_id, instance.event_id, event.name AS event_name,
           event.created_by, stage.id AS stage_id, stage.name AS stage_name,
           event.event_date + make_interval(days => stage.due_offset_days) AS due_at
    FROM public.event_workflow_instances instance
    JOIN public.events event ON event.id = instance.event_id
    JOIN public.event_workflow_stages stage ON stage.template_id = instance.template_id
    WHERE instance.status = 'active'
      AND event.status::text NOT IN ('cancelled', 'completed')
      AND stage.is_blocking = true
      AND stage.due_offset_days IS NOT NULL
      AND event.event_date + make_interval(days => stage.due_offset_days) < now()
      AND EXISTS (
        SELECT 1 FROM public.event_workflow_requirements requirement
        WHERE requirement.stage_id = stage.id
          AND requirement.is_required = true
          AND NOT public.event_workflow_requirement_is_met(instance.event_id, requirement.id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.event_workflow_activity activity
        WHERE activity.instance_id = instance.id
          AND activity.action = 'overdue_notification_sent'
          AND activity.details->>'stage_id' = stage.id::text
      )
  LOOP
    INSERT INTO public.notifications(
      title, message, type, category, action_url,
      related_entity_type, related_entity_id, metadata, created_at
    ) VALUES (
      'Etap wydarzenia wymaga działania',
      format('„%s”: etap „%s” przekroczył termin i ma niespełnione wymagania.', overdue_item.event_name, overdue_item.stage_name),
      'warning', 'event', format('/crm/events/%s', overdue_item.event_id),
      'event', overdue_item.event_id,
      jsonb_build_object(
        'kind', 'event_workflow_overdue',
        'event_id', overdue_item.event_id,
        'instance_id', overdue_item.instance_id,
        'stage_id', overdue_item.stage_id,
        'due_at', overdue_item.due_at
      ), now()
    ) RETURNING id INTO notification_id_value;

    FOR recipient IN
      SELECT DISTINCT auth_user.id AS user_id
      FROM public.employees employee
      JOIN auth.users auth_user ON auth_user.id = COALESCE(employee.auth_user_id, employee.id)
      WHERE employee.is_active = true
        AND (
          employee.role = 'admin'
          OR employee.access_level = 'admin'
          OR employee.id = overdue_item.created_by
          OR 'events_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    LOOP
      INSERT INTO public.notification_recipients(notification_id, user_id, is_read)
      VALUES (notification_id_value, recipient.user_id, false)
      ON CONFLICT (notification_id, user_id) DO NOTHING;
    END LOOP;

    INSERT INTO public.event_workflow_activity(
      event_id, instance_id, action, details
    ) VALUES (
      overdue_item.event_id, overdue_item.instance_id, 'overdue_notification_sent',
      jsonb_build_object('stage_id', overdue_item.stage_id, 'notification_id', notification_id_value, 'due_at', overdue_item.due_at)
    );
    sent_count := sent_count + 1;
  END LOOP;

  RETURN sent_count;
END;
$$;

DO $schedule_event_workflow_alerts$
DECLARE job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; event workflow alerts were not scheduled: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR job_id IN EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'notify-overdue-event-workflows'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING job_id;
    END LOOP;
    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING 'notify-overdue-event-workflows', '15 * * * *', 'SELECT public.notify_overdue_event_workflows();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule event workflow alerts: %', SQLERRM;
END;
$schedule_event_workflow_alerts$;

GRANT SELECT ON public.event_workflow_templates, public.event_workflow_template_categories,
  public.event_workflow_stages, public.event_workflow_requirements, public.event_workflow_instances,
  public.event_workflow_requirement_overrides, public.event_workflow_tasks,
  public.event_workflow_activity TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.event_workflow_templates,
  public.event_workflow_template_categories, public.event_workflow_stages,
  public.event_workflow_requirements TO authenticated;
REVOKE ALL ON FUNCTION public.current_workflow_employee_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_event_workflows(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_event_workflows(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_event_workflow_instance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.event_workflow_requirement_is_met(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_workflow_readiness(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_event_workflow_requirement_override(uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_event_workflow_tasks(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_event_workflow_attention_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_overdue_event_workflows() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_workflow_employee_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_event_workflows(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_event_workflows(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_workflow_readiness(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_workflow_requirement_override(uuid, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_event_workflow_tasks(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_workflow_attention_count() TO authenticated;

COMMENT ON TABLE public.event_workflow_templates IS 'Configurable operational process templates for CRM events.';
COMMENT ON FUNCTION public.get_event_workflow_readiness(uuid) IS 'Returns readiness calculated from canonical CRM records and explicit manual confirmations.';
