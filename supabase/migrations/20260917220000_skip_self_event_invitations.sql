BEGIN;

-- Suppress invitations only for the person making their own assignment or the
-- event's author. Do not change RLS, existing assignments or notification history.
-- Both employee UUIDs and linked authentication UUIDs occur in legacy records.
CREATE OR REPLACE FUNCTION public.event_assignment_is_own(p_event_id uuid, p_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees employee
    LEFT JOIN public.events event ON event.id = p_event_id
    WHERE employee.id = p_employee_id
      AND (
        auth.uid() = employee.id OR auth.uid() = employee.auth_user_id
        OR event.created_by = employee.id OR event.created_by = employee.auth_user_id
      )
  );
$$;
REVOKE ALL ON FUNCTION public.event_assignment_is_own(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.accept_own_event_team_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- A real response to an existing invitation must retain its normal workflow.
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.event_id, NEW.employee_id) IS NOT DISTINCT FROM ROW(OLD.event_id, OLD.employee_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.invited_by IS NULL THEN
    SELECT employee.id INTO NEW.invited_by FROM public.employees employee
    WHERE employee.id = auth.uid() OR employee.auth_user_id = auth.uid()
    ORDER BY (employee.id = auth.uid()) DESC, employee.id LIMIT 1;
  END IF;
  IF public.event_assignment_is_own(NEW.event_id, NEW.employee_id) THEN
    NEW.status := 'accepted';
    NEW.responded_at := now();
    -- Do not mark an unsent email as sent. The sender also checks the status.
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_own_event_team_assignment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER accept_own_event_team_assignment
  BEFORE INSERT OR UPDATE OF event_id, employee_id ON public.employee_assignments
  FOR EACH ROW EXECUTE FUNCTION public.accept_own_event_team_assignment();

CREATE OR REPLACE FUNCTION public.accept_own_event_phase_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE target_event uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.phase_id, NEW.employee_id) IS NOT DISTINCT FROM ROW(OLD.phase_id, OLD.employee_id) THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT phase.event_id INTO target_event FROM public.event_phases phase WHERE phase.id = NEW.phase_id;
  IF public.event_assignment_is_own(target_event, NEW.employee_id) THEN
    NEW.invitation_status := 'accepted';
    NEW.invitation_responded_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_own_event_phase_assignment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER accept_own_event_phase_assignment
  BEFORE INSERT OR UPDATE OF phase_id, employee_id ON public.event_phase_assignments
  FOR EACH ROW EXECUTE FUNCTION public.accept_own_event_phase_assignment();

CREATE OR REPLACE FUNCTION public.accept_own_driver_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.driver_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.event_id, NEW.driver_id) IS NOT DISTINCT FROM ROW(OLD.event_id, OLD.driver_id) THEN
      RETURN NEW;
    END IF;
    -- A replacement driver must never inherit the previous driver's acceptance.
    NEW.invitation_status := 'pending';
    NEW.invited_at := now();
    NEW.responded_at := NULL;
  END IF;
  IF public.event_assignment_is_own(NEW.event_id, NEW.driver_id) THEN
    NEW.invitation_status := 'accepted';
    NEW.responded_at := now();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_own_driver_assignment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER accept_own_driver_assignment
  BEFORE INSERT OR UPDATE OF event_id, driver_id ON public.event_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.accept_own_driver_assignment();

-- Preserve the existing rich notification/deep link for other drivers. The
-- original function did not check who was assigning the vehicle or its status.
CREATE OR REPLACE FUNCTION public.notify_driver_invitation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_event_name text;
  v_event_date timestamptz;
  v_event_location text;
  v_vehicle_name text;
  v_notification_id uuid;
BEGIN
  IF NEW.driver_id IS NULL OR NEW.invitation_status IS DISTINCT FROM 'pending'
    OR public.event_assignment_is_own(NEW.event_id, NEW.driver_id) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN
    RETURN NEW;
  END IF;

  SELECT e.name, e.event_date, e.location
  INTO v_event_name, v_event_date, v_event_location
  FROM public.events e WHERE e.id = NEW.event_id;
  SELECT coalesce(nullif(v.name, ''), nullif(concat_ws(' ', v.brand, v.model), ''),
    nullif(NEW.external_company_name, ''), 'Pojazd') INTO v_vehicle_name
  FROM (SELECT 1) seed LEFT JOIN public.vehicles v ON v.id = NEW.vehicle_id;

  INSERT INTO public.notifications (
    title, message, type, category, related_entity_type, related_entity_id,
    action_url, metadata, created_at
  ) VALUES (
    'Przypisano Ci pojazd na wydarzenie',
    format('Przypisano Ci pojazd %s jako kierowcy wydarzenia „%s” (%s).',
      coalesce(v_vehicle_name, 'Pojazd'), coalesce(v_event_name, 'Wydarzenie'),
      to_char(v_event_date AT TIME ZONE 'Europe/Warsaw', 'DD.MM.YYYY HH24:MI')),
    'info', 'event_assignment', 'event', NEW.event_id::text,
    '/crm/events/' || NEW.event_id::text || '?tab=fleet',
    jsonb_strip_nulls(jsonb_build_object(
      'kind', 'vehicle_assignment', 'initial_tab', 'fleet',
      'event_id', NEW.event_id, 'event_vehicle_id', NEW.id,
      'vehicle_id', NEW.vehicle_id, 'driver_id', NEW.driver_id, 'location', v_event_location
    )), now()
  ) RETURNING id INTO v_notification_id;
  INSERT INTO public.notification_recipients (notification_id, user_id, is_read, created_at)
  VALUES (v_notification_id, NEW.driver_id, false, now())
  ON CONFLICT (notification_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_driver_invitation() FROM PUBLIC, anon, authenticated;

COMMIT;
