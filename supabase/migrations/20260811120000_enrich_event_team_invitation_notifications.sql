/*
  # Rich event team invitations

  Keep the existing notification and employee_assignments response flow, but add
  explicit invitation metadata and the inviter's name for native mobile actions.
*/

CREATE OR REPLACE FUNCTION public.notify_employee_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event record;
  v_inviter_name text;
  v_notification_id uuid;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT
    e.id AS event_id,
    e.name AS event_name,
    e.event_date,
    e.event_end_date,
    e.location,
    e.description,
    c.name AS category
  INTO v_event
  FROM public.events e
  LEFT JOIN public.event_categories c ON c.id = e.category_id
  WHERE e.id = NEW.event_id;

  SELECT COALESCE(
    NULLIF(CONCAT_WS(' ', inviter.name, inviter.surname), ''),
    inviter.nickname,
    'Organizator'
  )
  INTO v_inviter_name
  FROM public.employees inviter
  WHERE inviter.id = NEW.invited_by;

  v_inviter_name := COALESCE(v_inviter_name, 'Organizator');

  INSERT INTO public.notifications (
    category,
    title,
    message,
    type,
    related_entity_type,
    related_entity_id,
    action_url,
    metadata,
    created_at
  )
  VALUES (
    'employee',
    'Zaproszenie do zespołu wydarzenia',
    format('%s zaprasza Cię do zespołu wydarzenia „%s”.',
      v_inviter_name, v_event.event_name),
    'info',
    'event',
    NEW.event_id::text,
    format('/crm/events/%s', NEW.event_id),
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'event_invitation',
      'event_id', NEW.event_id,
      'event_name', v_event.event_name,
      'event_date', v_event.event_date,
      'event_end_date', v_event.event_end_date,
      'location', v_event.location,
      'description', v_event.description,
      'category', v_event.category,
      'role', NEW.role,
      'responsibilities', NEW.responsibilities,
      'invited_by', NEW.invited_by,
      'inviter_name', v_inviter_name,
      'assignment_id', NEW.id,
      'assignment_status', 'pending',
      'requires_response', true
    )),
    now()
  )
  RETURNING id INTO v_notification_id;

  INSERT INTO public.notification_recipients (
    notification_id,
    user_id,
    is_read,
    created_at
  )
  VALUES (
    v_notification_id,
    NEW.employee_id,
    false,
    now()
  )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.notify_employee_assignment() IS
  'Creates an actionable CRM and mobile push invitation for a pending event team assignment.';
