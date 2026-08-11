/*
  # Task assignment notifications

  Every newly assigned employee receives one CRM notification containing the
  task id and assignment author. The mobile push is sent by the dedicated
  send-task-assignment-push Edge Function invoked by the assigning client.
*/

CREATE OR REPLACE FUNCTION public.set_task_assignment_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.assigned_by IS NULL THEN
    NEW.assigned_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_task_assignment_actor_before_insert
  ON public.task_assignees;
CREATE TRIGGER set_task_assignment_actor_before_insert
  BEFORE INSERT ON public.task_assignees
  FOR EACH ROW
  EXECUTE FUNCTION public.set_task_assignment_actor();

CREATE OR REPLACE FUNCTION public.notify_task_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notification_id uuid;
  v_task_title text;
  v_actor_id uuid;
  v_actor_name text;
BEGIN
  v_actor_id := COALESCE(NEW.assigned_by, auth.uid());

  -- Creating/keeping your own assignment must not generate a notification.
  IF v_actor_id IS NULL OR NEW.employee_id = v_actor_id THEN
    RETURN NEW;
  END IF;

  SELECT t.title
  INTO v_task_title
  FROM public.tasks t
  WHERE t.id = NEW.task_id;

  IF v_task_title IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    NULLIF(BTRIM(CONCAT_WS(' ', e.name, e.surname)), ''),
    NULLIF(BTRIM(e.nickname), ''),
    'Użytkownik'
  )
  INTO v_actor_name
  FROM public.employees e
  WHERE e.id = v_actor_id;

  v_actor_name := COALESCE(v_actor_name, 'Użytkownik');

  INSERT INTO public.notifications (
    title,
    message,
    type,
    category,
    related_entity_type,
    related_entity_id,
    action_url,
    metadata,
    created_at
  )
  VALUES (
    'Przypisano Cię do zadania',
    FORMAT('%s przypisał(a) Cię do zadania „%s”.', v_actor_name, v_task_title),
    'info',
    'tasks',
    'task',
    NEW.task_id::text,
    FORMAT('/crm/tasks/%s', NEW.task_id),
    jsonb_build_object(
      'kind', 'task_assignment',
      'task_id', NEW.task_id,
      'task_assignment_id', NEW.id,
      'assigned_by', v_actor_id,
      'assigned_by_name', v_actor_name
    ),
    now()
  )
  RETURNING id INTO v_notification_id;

  INSERT INTO public.notification_recipients (
    notification_id,
    user_id,
    is_read
  )
  VALUES (
    v_notification_id,
    NEW.employee_id,
    false
  )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_task_assignment_after_insert
  ON public.task_assignees;
CREATE TRIGGER notify_task_assignment_after_insert
  AFTER INSERT ON public.task_assignees
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_assignment();

REVOKE ALL ON FUNCTION public.set_task_assignment_actor() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.notify_task_assignment() FROM PUBLIC;

COMMENT ON FUNCTION public.notify_task_assignment() IS
  'Creates a navigable CRM notification when another employee is assigned to a task.';
