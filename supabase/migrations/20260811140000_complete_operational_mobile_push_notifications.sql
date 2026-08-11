/*
  # Complete operational mobile push notifications

  - Meeting participants are notified by the database, regardless of whether
    the meeting was created from web or mobile.
  - Both vehicle pickup and vehicle return notify administrators and assigned
    event managers.
  - Work time is checked on the server and one alert per employee/day is sent
    after reaching eight hours, even when the mobile time screen is closed.
*/

-- ---------------------------------------------------------------------------
-- Meeting assignments
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_meeting_participant_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meeting record;
  v_actor_id uuid;
  v_actor_name text;
  v_notification_id uuid;
BEGIN
  IF NEW.employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT
    m.id,
    m.title,
    m.datetime_start,
    m.location_text,
    m.created_by
  INTO v_meeting
  FROM public.meetings m
  WHERE m.id = NEW.meeting_id;

  IF v_meeting.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_actor_id := COALESCE(v_meeting.created_by, auth.uid());

  -- The organizer already knows about the meeting.
  IF NEW.employee_id = v_actor_id THEN
    RETURN NEW;
  END IF;

  -- Mobile historically removed and reinserted participants while editing.
  -- Do not issue a second invitation for the same employee and meeting.
  IF EXISTS (
    SELECT 1
    FROM public.notifications n
    JOIN public.notification_recipients nr ON nr.notification_id = n.id
    WHERE n.category = 'meeting_invitation'
      AND n.related_entity_type = 'meeting'
      AND n.related_entity_id = NEW.meeting_id::text
      AND nr.user_id = NEW.employee_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    NULLIF(BTRIM(CONCAT_WS(' ', e.name, e.surname)), ''),
    NULLIF(BTRIM(e.nickname), ''),
    'Organizator'
  )
  INTO v_actor_name
  FROM public.employees e
  WHERE e.id = v_actor_id;

  v_actor_name := COALESCE(v_actor_name, 'Organizator');

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
    'Zaproszenie na spotkanie',
    format('%s zaprasza Cię na spotkanie „%s” (%s).',
      v_actor_name,
      v_meeting.title,
      to_char(v_meeting.datetime_start AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')
    ),
    'info',
    'meeting_invitation',
    'meeting',
    NEW.meeting_id::text,
    '/crm/calendar?meeting=' || NEW.meeting_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'meeting_assignment',
      'meeting_id', NEW.meeting_id,
      'meeting_participant_id', NEW.id,
      'assigned_by', v_actor_id,
      'assigned_by_name', v_actor_name,
      'datetime_start', v_meeting.datetime_start,
      'location', v_meeting.location_text
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

DROP TRIGGER IF EXISTS notify_meeting_participant_assignment_after_insert
  ON public.meeting_participants;
CREATE TRIGGER notify_meeting_participant_assignment_after_insert
  AFTER INSERT ON public.meeting_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_meeting_participant_assignment();

REVOKE ALL ON FUNCTION public.notify_meeting_participant_assignment() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Driver assignment deep-link data
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_driver_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_name text;
  v_event_date timestamptz;
  v_event_location text;
  v_vehicle_name text;
  v_notification_id uuid;
BEGIN
  IF NEW.driver_id IS NULL
    OR NOT (
      TG_OP = 'INSERT'
      OR (TG_OP = 'UPDATE' AND NEW.driver_id IS DISTINCT FROM OLD.driver_id)
    )
  THEN
    RETURN NEW;
  END IF;

  SELECT e.name, e.event_date, e.location
  INTO v_event_name, v_event_date, v_event_location
  FROM public.events e
  WHERE e.id = NEW.event_id;

  SELECT COALESCE(
    NULLIF(v.name, ''),
    NULLIF(CONCAT_WS(' ', v.brand, v.model), ''),
    NULLIF(NEW.external_company_name, ''),
    'Pojazd'
  )
  INTO v_vehicle_name
  FROM (SELECT 1) seed
  LEFT JOIN public.vehicles v ON v.id = NEW.vehicle_id;

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
    'Przypisano Ci pojazd na wydarzenie',
    format('Przypisano Ci pojazd %s jako kierowcy wydarzenia „%s” (%s).',
      COALESCE(v_vehicle_name, 'Pojazd'),
      COALESCE(v_event_name, 'Wydarzenie'),
      to_char(v_event_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')
    ),
    'info',
    'event_assignment',
    'event',
    NEW.event_id::text,
    '/crm/events/' || NEW.event_id::text || '?tab=fleet',
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'vehicle_assignment',
      'initial_tab', 'fleet',
      'event_id', NEW.event_id,
      'event_vehicle_id', NEW.id,
      'vehicle_id', NEW.vehicle_id,
      'driver_id', NEW.driver_id,
      'location', v_event_location
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
  VALUES (v_notification_id, NEW.driver_id, false, now())
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_driver_invitation() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Vehicle pickup and return
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_vehicle_handover_to_event_managers()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
  v_vehicle_id uuid;
  v_event_name text;
  v_vehicle_name text;
  v_driver_name text;
  v_notification_id uuid;
  v_recipient_count integer;
  v_title text;
  v_kind text;
  v_verb text;
  v_type text;
BEGIN
  IF NEW.handover_type NOT IN ('pickup', 'return') THEN
    RETURN NEW;
  END IF;

  SELECT
    ev.event_id,
    ev.vehicle_id,
    e.name,
    COALESCE(
      NULLIF(v.name, ''),
      NULLIF(CONCAT_WS(' ', v.brand, v.model), ''),
      NULLIF(ev.external_company_name, ''),
      'Pojazd'
    ),
    COALESCE(
      NULLIF(CONCAT_WS(' ', driver.name, driver.surname), ''),
      driver.nickname,
      'Kierowca'
    )
  INTO
    v_event_id,
    v_vehicle_id,
    v_event_name,
    v_vehicle_name,
    v_driver_name
  FROM public.event_vehicles ev
  JOIN public.events e ON e.id = ev.event_id
  LEFT JOIN public.vehicles v ON v.id = ev.vehicle_id
  LEFT JOIN public.employees driver ON driver.id = NEW.driver_id
  WHERE ev.id = NEW.event_vehicle_id;

  IF v_event_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.handover_type = 'pickup' THEN
    v_title := 'Kierowca odebrał pojazd';
    v_kind := 'vehicle_pickup';
    v_verb := 'odebrał(a)';
    v_type := 'success';
  ELSE
    v_title := 'Kierowca zdał pojazd';
    v_kind := 'vehicle_return';
    v_verb := 'zdał(a)';
    v_type := 'info';
  END IF;

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
    v_title,
    format('%s %s pojazd %s dla wydarzenia „%s”.',
      v_driver_name, v_verb, v_vehicle_name, v_event_name),
    v_type,
    'event',
    'event',
    v_event_id::text,
    '/crm/events/' || v_event_id::text || '?tab=fleet',
    jsonb_build_object(
      'kind', v_kind,
      'initial_tab', 'fleet',
      'handover_id', NEW.id,
      'event_vehicle_id', NEW.event_vehicle_id,
      'driver_id', NEW.driver_id,
      'vehicle_id', v_vehicle_id,
      'odometer_reading', NEW.odometer_reading
    ),
    now()
  )
  RETURNING id INTO v_notification_id;

  INSERT INTO public.notification_recipients (
    notification_id,
    user_id,
    is_read,
    created_at
  )
  SELECT DISTINCT
    v_notification_id,
    recipient.id,
    false,
    now()
  FROM public.employees recipient
  WHERE recipient.is_active = true
    AND (
      recipient.role = 'admin'
      OR recipient.access_level = 'admin'
      OR 'admin' = ANY(COALESCE(recipient.permissions, '{}'::text[]))
      OR (
        (
          recipient.role = 'manager'
          OR recipient.access_level = 'manager'
          OR 'events_manage' = ANY(COALESCE(recipient.permissions, '{}'::text[]))
          OR 'fleet_manage' = ANY(COALESCE(recipient.permissions, '{}'::text[]))
        )
        AND EXISTS (
          SELECT 1
          FROM public.employee_assignments ea
          WHERE ea.event_id = v_event_id
            AND ea.employee_id = recipient.id
            AND ea.status = 'accepted'
        )
      )
    )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_recipient_count = ROW_COUNT;

  IF v_recipient_count = 0 THEN
    DELETE FROM public.notifications WHERE id = v_notification_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Handover confirmation is business-critical and must not be rolled back by
  -- a temporary notification failure.
  RAISE WARNING 'Could not create vehicle handover notification: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_vehicle_pickup_to_event_managers
  ON public.vehicle_handovers;
DROP TRIGGER IF EXISTS trigger_notify_vehicle_handover_to_event_managers
  ON public.vehicle_handovers;
CREATE TRIGGER trigger_notify_vehicle_handover_to_event_managers
  AFTER INSERT ON public.vehicle_handovers
  FOR EACH ROW
  WHEN (NEW.handover_type IN ('pickup', 'return'))
  EXECUTE FUNCTION public.notify_vehicle_handover_to_event_managers();

REVOKE ALL ON FUNCTION public.notify_vehicle_handover_to_event_managers() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Eight-hour work alerts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_overtime_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  worked_minutes integer NOT NULL,
  notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);

ALTER TABLE public.employee_overtime_alerts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.employee_work_minutes_for_day(
  p_employee_id uuid,
  p_work_date date
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT
      p_work_date::timestamp AT TIME ZONE 'Europe/Warsaw' AS day_start,
      (p_work_date + 1)::timestamp AT TIME ZONE 'Europe/Warsaw' AS day_end
  )
  SELECT COALESCE(FLOOR(SUM(
    EXTRACT(EPOCH FROM (
      LEAST(COALESCE(te.end_time, now()), bounds.day_end)
      - GREATEST(te.start_time, bounds.day_start)
    )) / 60
  )), 0)::integer
  FROM public.time_entries te
  CROSS JOIN bounds
  WHERE te.employee_id = p_employee_id
    AND te.start_time < bounds.day_end
    AND COALESCE(te.end_time, now()) > bounds.day_start;
$$;

CREATE OR REPLACE FUNCTION public.create_employee_overtime_alert(
  p_employee_id uuid,
  p_work_date date DEFAULT ((now() AT TIME ZONE 'Europe/Warsaw')::date)
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_minutes integer;
  v_employee_name text;
  v_alert_id uuid;
  v_notification_id uuid;
BEGIN
  v_minutes := public.employee_work_minutes_for_day(p_employee_id, p_work_date);

  IF v_minutes < 480 THEN
    RETURN false;
  END IF;

  INSERT INTO public.employee_overtime_alerts (
    employee_id,
    work_date,
    worked_minutes
  )
  VALUES (p_employee_id, p_work_date, v_minutes)
  ON CONFLICT (employee_id, work_date) DO NOTHING
  RETURNING id INTO v_alert_id;

  IF v_alert_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(
    NULLIF(BTRIM(CONCAT_WS(' ', e.name, e.surname)), ''),
    NULLIF(BTRIM(e.nickname), ''),
    'Pracownik'
  )
  INTO v_employee_name
  FROM public.employees e
  WHERE e.id = p_employee_id;

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
    'Przekroczono 8 godzin pracy',
    format('%s zarejestrował(a) dziś %s godz. pracy.',
      COALESCE(v_employee_name, 'Pracownik'),
      to_char(v_minutes / 60.0, 'FM999990D00')
    ),
    'warning',
    'employee',
    'employee',
    p_employee_id::text,
    '/crm/employees/' || p_employee_id::text,
    jsonb_build_object(
      'kind', 'overtime',
      'employee_id', p_employee_id,
      'work_date', p_work_date,
      'worked_minutes', v_minutes
    ),
    now()
  )
  RETURNING id INTO v_notification_id;

  UPDATE public.employee_overtime_alerts
  SET notification_id = v_notification_id
  WHERE id = v_alert_id;

  -- The employee receives a personal warning. Administrators and employees
  -- responsible for time tracking receive the management alert.
  INSERT INTO public.notification_recipients (
    notification_id,
    user_id,
    is_read,
    created_at
  )
  SELECT DISTINCT
    v_notification_id,
    recipient.id,
    false,
    now()
  FROM public.employees recipient
  WHERE recipient.is_active = true
    AND (
      recipient.id = p_employee_id
      OR recipient.role = 'admin'
      OR recipient.access_level = 'admin'
      OR 'admin' = ANY(COALESCE(recipient.permissions, '{}'::text[]))
      OR 'time_tracking_manage' = ANY(COALESCE(recipient.permissions, '{}'::text[]))
    )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_my_overtime_timer()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Brak aktywnej sesji użytkownika.';
  END IF;

  RETURN public.create_employee_overtime_alert(
    auth.uid(),
    (now() AT TIME ZONE 'Europe/Warsaw')::date
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.check_all_employee_overtime()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_created_count integer := 0;
BEGIN
  FOR v_employee_id IN
    SELECT DISTINCT te.employee_id
    FROM public.time_entries te
    JOIN public.employees e ON e.id = te.employee_id
    WHERE e.is_active = true
      AND te.start_time < now()
      AND COALESCE(te.end_time, now()) >
        ((now() AT TIME ZONE 'Europe/Warsaw')::date::timestamp AT TIME ZONE 'Europe/Warsaw')
  LOOP
    IF public.create_employee_overtime_alert(
      v_employee_id,
      (now() AT TIME ZONE 'Europe/Warsaw')::date
    ) THEN
      v_created_count := v_created_count + 1;
    END IF;
  END LOOP;

  RETURN v_created_count;
END;
$$;

REVOKE ALL ON FUNCTION public.employee_work_minutes_for_day(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_employee_overtime_alert(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_all_employee_overtime() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_my_overtime_timer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_my_overtime_timer() TO authenticated;

-- pg_cron is available on hosted Supabase. Keep the RPC fallback above for
-- environments where the extension is intentionally disabled.
DO $schedule_overtime_check$
DECLARE
  v_job_id bigint;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'pg_cron is unavailable; mobile RPC fallback remains active: %', SQLERRM;
  END;

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    FOR v_job_id IN EXECUTE
      'SELECT jobid FROM cron.job WHERE jobname = $1'
      USING 'check-employee-overtime'
    LOOP
      EXECUTE 'SELECT cron.unschedule($1)' USING v_job_id;
    END LOOP;

    EXECUTE 'SELECT cron.schedule($1, $2, $3)'
      USING
        'check-employee-overtime',
        '*/5 * * * *',
        'SELECT public.check_all_employee_overtime();';
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not schedule overtime check; mobile RPC fallback remains active: %', SQLERRM;
END;
$schedule_overtime_check$;

COMMENT ON FUNCTION public.notify_meeting_participant_assignment() IS
  'Creates one CRM/mobile invitation when an employee is added to a meeting.';
COMMENT ON FUNCTION public.notify_vehicle_handover_to_event_managers() IS
  'Notifies admins and assigned event managers after vehicle pickup or return.';
COMMENT ON FUNCTION public.check_all_employee_overtime() IS
  'Creates one daily 8-hour work alert per employee and is scheduled every five minutes.';
