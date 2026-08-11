/*
  # Secure mobile event fleet, sensitive files and pickup notifications

  - Admins/managers see every vehicle assigned to an event.
  - A lower-level employee sees an event vehicle only when assigned as its driver.
  - Offers, contracts, invoices and calculations are visible only to admins/managers.
  - A vehicle pickup creates one CRM notification for every admin and every
    manager assigned to the event. Existing notification delivery sends the push.
*/

CREATE OR REPLACE FUNCTION public.is_event_manager(p_employee_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.is_active = true
      AND (
        e.role IN ('admin', 'manager')
        OR e.access_level IN ('admin', 'manager')
        OR 'admin' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'events_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
        OR 'fleet_manage' = ANY(COALESCE(e.permissions, '{}'::text[]))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_event_driver(
  p_event_id uuid,
  p_employee_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.event_vehicles ev
    WHERE ev.event_id = p_event_id
      AND ev.driver_id = p_employee_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_event_participant(
  p_event_id uuid,
  p_employee_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_assignments ea
    WHERE ea.event_id = p_event_id
      AND ea.employee_id = p_employee_id
      AND ea.status = 'accepted'
  ) OR public.is_event_driver(p_event_id, p_employee_id);
$$;

CREATE OR REPLACE FUNCTION public.can_edit_operational_event_files(
  p_event_id uuid,
  p_employee_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.employee_assignments ea
    WHERE ea.event_id = p_event_id
      AND ea.employee_id = p_employee_id
      AND ea.status = 'accepted'
      AND COALESCE(ea.can_edit_files, false) = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_sensitive_event_document(p_document_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(p_document_type, 'other') IN ('offer', 'contract', 'invoice', 'calculation');
$$;

REVOKE ALL ON FUNCTION public.is_event_manager(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_event_driver(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_event_participant(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_operational_event_files(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_sensitive_event_document(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_event_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_driver(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_event_participant(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_operational_event_files(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_sensitive_event_document(text) TO authenticated;

-- Remove the old unconditional fleet read policy and its historical variants.
DROP POLICY IF EXISTS "Authenticated users can view event vehicles" ON public.event_vehicles;
DROP POLICY IF EXISTS "Employees can view event vehicles" ON public.event_vehicles;
DROP POLICY IF EXISTS "Users can view event vehicles" ON public.event_vehicles;
DROP POLICY IF EXISTS "Users can view event_vehicles" ON public.event_vehicles;

CREATE POLICY "Managers and assigned drivers can view event vehicles"
  ON public.event_vehicles
  FOR SELECT TO authenticated
  USING (
    public.is_event_manager(auth.uid())
    OR driver_id = auth.uid()
  );

-- A driver-only assignment also grants access to the event shell in mobile.
DROP POLICY IF EXISTS "Assigned drivers can view their events" ON public.events;
CREATE POLICY "Assigned drivers can view their events"
  ON public.events
  FOR SELECT TO authenticated
  USING (public.is_event_driver(id, auth.uid()));

-- Vehicle joins must work even when the driver has no global fleet permission.
DROP POLICY IF EXISTS "Event drivers can view assigned vehicles" ON public.vehicles;
CREATE POLICY "Event drivers can view assigned vehicles"
  ON public.vehicles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.event_vehicles ev
      WHERE ev.vehicle_id = vehicles.id
        AND ev.driver_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Event managers can view vehicle handovers" ON public.vehicle_handovers;
CREATE POLICY "Event managers can view vehicle handovers"
  ON public.vehicle_handovers
  FOR SELECT TO authenticated
  USING (public.is_event_manager(auth.uid()));

-- Sensitive event documents are never returned to lower-level employees.
DROP POLICY IF EXISTS "Team members and admins can view files" ON public.event_files;
DROP POLICY IF EXISTS "Managers see all and team sees operational files" ON public.event_files;
CREATE POLICY "Managers see all and team sees operational files"
  ON public.event_files
  FOR SELECT TO authenticated
  USING (
    public.is_event_manager(auth.uid())
    OR (
      NOT public.is_sensitive_event_document(document_type)
      AND public.is_event_participant(event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Managers can view all event folders" ON public.event_folders;
CREATE POLICY "Managers can view all event folders"
  ON public.event_folders
  FOR SELECT TO authenticated
  USING (public.is_event_manager(auth.uid()));

DROP POLICY IF EXISTS "Authorized users can upload files" ON public.event_files;
CREATE POLICY "Authorized users can upload files"
  ON public.event_files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_event_manager(auth.uid())
    OR (
      NOT public.is_sensitive_event_document(document_type)
      AND public.is_event_participant(event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Authorized users can update files" ON public.event_files;
CREATE POLICY "Authorized users can update files"
  ON public.event_files
  FOR UPDATE TO authenticated
  USING (
    public.is_event_manager(auth.uid())
    OR (
      NOT public.is_sensitive_event_document(document_type)
      AND public.can_edit_operational_event_files(event_id, auth.uid())
    )
  )
  WITH CHECK (
    public.is_event_manager(auth.uid())
    OR (
      NOT public.is_sensitive_event_document(document_type)
      AND public.can_edit_operational_event_files(event_id, auth.uid())
    )
  );

DROP POLICY IF EXISTS "Authorized users can delete files" ON public.event_files;
CREATE POLICY "Authorized users can delete files"
  ON public.event_files
  FOR DELETE TO authenticated
  USING (
    public.is_event_manager(auth.uid())
    OR (
      NOT public.is_sensitive_event_document(document_type)
      AND public.can_edit_operational_event_files(event_id, auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.notify_vehicle_pickup_to_event_managers()
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
BEGIN
  IF NEW.handover_type <> 'pickup' THEN
    RETURN NEW;
  END IF;

  BEGIN
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
      'Kierowca odebrał pojazd',
      format('%s odebrał(a) pojazd %s dla wydarzenia „%s”.',
        v_driver_name, v_vehicle_name, v_event_name),
      'success',
      'event',
      'event',
      v_event_id::text,
      '/crm/events/' || v_event_id::text || '?tab=fleet',
      jsonb_build_object(
        'kind', 'vehicle_pickup',
        'initial_tab', 'fleet',
        'handover_id', NEW.id,
        'event_vehicle_id', NEW.event_vehicle_id,
        'driver_id', NEW.driver_id,
        'vehicle_id', v_vehicle_id
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
  EXCEPTION WHEN OTHERS THEN
    -- Notification delivery must not roll back a valid vehicle pickup.
    RAISE NOTICE 'Could not create vehicle pickup notification: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_vehicle_pickup_to_event_managers
  ON public.vehicle_handovers;
CREATE TRIGGER trigger_notify_vehicle_pickup_to_event_managers
  AFTER INSERT ON public.vehicle_handovers
  FOR EACH ROW
  WHEN (NEW.handover_type = 'pickup')
  EXECUTE FUNCTION public.notify_vehicle_pickup_to_event_managers();

COMMENT ON FUNCTION public.notify_vehicle_pickup_to_event_managers() IS
  'Creates one CRM notification for admins and assigned event managers after a vehicle pickup.';
