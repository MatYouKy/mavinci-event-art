/*
  Prevent workflow refresh triggers fired by ON DELETE CASCADE from recreating
  a workflow instance after its parent event has already been removed.
*/

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
  IF p_event_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.events event
    WHERE event.id = p_event_id
  ) THEN
    RETURN NULL;
  END IF;

  SELECT instance.id INTO existing_instance
  FROM public.event_workflow_instances instance
  WHERE instance.event_id = p_event_id;

  IF existing_instance IS NOT NULL THEN
    RETURN existing_instance;
  END IF;

  SELECT event.category_id INTO event_category
  FROM public.events event
  WHERE event.id = p_event_id;

  SELECT template.id INTO selected_template
  FROM public.event_workflow_templates template
  LEFT JOIN public.event_workflow_template_categories mapping
    ON mapping.template_id = template.id
   AND mapping.category_id = event_category
  WHERE template.is_active = true
    AND (mapping.category_id IS NOT NULL OR template.is_default = true)
  ORDER BY
    (mapping.category_id IS NOT NULL) DESC,
    template.is_default DESC,
    template.created_at
  LIMIT 1;

  IF selected_template IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.event_workflow_instances(event_id, template_id)
  VALUES (p_event_id, selected_template)
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO existing_instance;

  IF existing_instance IS NULL THEN
    SELECT instance.id INTO existing_instance
    FROM public.event_workflow_instances instance
    WHERE instance.event_id = p_event_id;
  END IF;

  RETURN existing_instance;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_event_workflow_after_related_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  related_event_id uuid;
BEGIN
  related_event_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.event_id
    ELSE NEW.event_id
  END;

  IF related_event_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.events event
       WHERE event.id = related_event_id
     ) THEN
    PERFORM public.sync_event_workflow_tasks(related_event_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.ensure_event_workflow_instance(uuid) IS
  'Returns or creates the workflow instance only while the parent event exists.';

COMMENT ON FUNCTION public.refresh_event_workflow_after_related_change() IS
  'Refreshes workflow after related changes and safely skips event delete cascades.';
