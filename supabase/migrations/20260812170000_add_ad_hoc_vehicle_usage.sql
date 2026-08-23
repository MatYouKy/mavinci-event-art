/*
  # Ad-hoc vehicle usage with a complete handover history

  Extends vehicle_handovers so the same register covers both event assignments
  and short operational trips that are not connected to an event.
*/

ALTER TABLE public.vehicle_handovers
  ALTER COLUMN event_vehicle_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS usage_source text NOT NULL DEFAULT 'event',
  ADD COLUMN IF NOT EXISTS usage_session_id uuid,
  ADD COLUMN IF NOT EXISTS purpose text;

UPDATE public.vehicle_handovers handover
SET vehicle_id = assignment.vehicle_id
FROM public.event_vehicles assignment
WHERE assignment.id = handover.event_vehicle_id
  AND handover.vehicle_id IS NULL;

ALTER TABLE public.vehicle_handovers
  DROP CONSTRAINT IF EXISTS vehicle_handovers_usage_source_check,
  DROP CONSTRAINT IF EXISTS vehicle_handovers_usage_context_check;

ALTER TABLE public.vehicle_handovers
  ADD CONSTRAINT vehicle_handovers_usage_source_check
    CHECK (usage_source IN ('event', 'ad_hoc')),
  ADD CONSTRAINT vehicle_handovers_usage_context_check
    CHECK (
      (usage_source = 'event' AND event_vehicle_id IS NOT NULL)
      OR (
        usage_source = 'ad_hoc'
        AND event_vehicle_id IS NULL
        AND vehicle_id IS NOT NULL
        AND usage_session_id IS NOT NULL
        AND purpose IS NOT NULL
        AND char_length(btrim(purpose)) BETWEEN 3 AND 500
      )
    );

CREATE INDEX IF NOT EXISTS idx_vehicle_handovers_vehicle_timestamp
  ON public.vehicle_handovers(vehicle_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_handovers_usage_session
  ON public.vehicle_handovers(usage_session_id)
  WHERE usage_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_handovers_ad_hoc_session_action
  ON public.vehicle_handovers(usage_session_id, handover_type)
  WHERE usage_source = 'ad_hoc';

CREATE OR REPLACE FUNCTION public.prepare_vehicle_handover_context()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.event_vehicle_id IS NOT NULL THEN
    SELECT assignment.vehicle_id
    INTO NEW.vehicle_id
    FROM public.event_vehicles assignment
    WHERE assignment.id = NEW.event_vehicle_id;

    NEW.usage_source := 'event';
  ELSIF NEW.usage_source = 'ad_hoc' THEN
    IF NEW.vehicle_id IS NULL OR NEW.usage_session_id IS NULL THEN
      RAISE EXCEPTION 'Brak kontekstu doraźnego użycia pojazdu.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Przekazanie musi dotyczyć wydarzenia albo użycia doraźnego.';
  END IF;

  IF NEW.handover_type = 'pickup' AND NEW.vehicle_id IS NOT NULL THEN
    IF NEW.usage_source = 'ad_hoc' AND EXISTS (
      SELECT 1
      FROM public.event_vehicles assignment
      WHERE assignment.vehicle_id = NEW.vehicle_id
        AND assignment.is_in_use = true
    ) THEN
      RAISE EXCEPTION 'Pojazd jest aktualnie używany przy wydarzeniu.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.vehicle_handovers pickup
      WHERE pickup.vehicle_id = NEW.vehicle_id
        AND pickup.usage_source = 'ad_hoc'
        AND pickup.handover_type = 'pickup'
        AND NOT EXISTS (
          SELECT 1
          FROM public.vehicle_handovers returned
          WHERE returned.usage_session_id = pickup.usage_session_id
            AND returned.usage_source = 'ad_hoc'
            AND returned.handover_type = 'return'
        )
    ) THEN
      RAISE EXCEPTION 'Pojazd został już odebrany do innego wyjazdu.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_prepare_vehicle_handover_context
  ON public.vehicle_handovers;
CREATE TRIGGER trigger_prepare_vehicle_handover_context
  BEFORE INSERT ON public.vehicle_handovers
  FOR EACH ROW
  EXECUTE FUNCTION public.prepare_vehicle_handover_context();

-- The event audit trigger must only receive event-related handovers.
DROP TRIGGER IF EXISTS trigger_log_vehicle_handover ON public.vehicle_handovers;
CREATE TRIGGER trigger_log_vehicle_handover
  AFTER INSERT ON public.vehicle_handovers
  FOR EACH ROW
  WHEN (NEW.event_vehicle_id IS NOT NULL)
  EXECUTE FUNCTION public.log_vehicle_handover_to_event_audit();

CREATE OR REPLACE FUNCTION public.update_vehicle_mileage_on_handover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vehicle_id uuid;
BEGIN
  v_vehicle_id := NEW.vehicle_id;

  IF v_vehicle_id IS NULL AND NEW.event_vehicle_id IS NOT NULL THEN
    SELECT assignment.vehicle_id
    INTO v_vehicle_id
    FROM public.event_vehicles assignment
    WHERE assignment.id = NEW.event_vehicle_id;
  END IF;

  IF v_vehicle_id IS NOT NULL THEN
    UPDATE public.vehicles
    SET current_mileage = GREATEST(COALESCE(current_mileage, 0), NEW.odometer_reading),
        updated_at = now()
    WHERE id = v_vehicle_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_vehicle_mileage ON public.vehicle_handovers;
CREATE TRIGGER trigger_update_vehicle_mileage
  AFTER INSERT OR UPDATE ON public.vehicle_handovers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_vehicle_mileage_on_handover();

DROP POLICY IF EXISTS "Fleet viewers can read vehicle handovers" ON public.vehicle_handovers;
CREATE POLICY "Fleet viewers can read vehicle handovers"
  ON public.vehicle_handovers
  FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
        AND (
          employee.role IN ('admin', 'manager')
          OR employee.access_level IN ('admin', 'manager')
          OR 'fleet_view' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
        )
    )
  );

CREATE OR REPLACE FUNCTION public.record_ad_hoc_vehicle_handover(
  p_vehicle_id uuid,
  p_handover_type text,
  p_odometer_reading integer,
  p_purpose text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.vehicle_handovers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee public.employees%ROWTYPE;
  v_vehicle public.vehicles%ROWTYPE;
  v_pickup public.vehicle_handovers%ROWTYPE;
  v_handover public.vehicle_handovers%ROWTYPE;
  v_session_id uuid;
  v_purpose text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Brak aktywnej sesji użytkownika.';
  END IF;

  SELECT *
  INTO v_employee
  FROM public.employees employee
  WHERE employee.id = auth.uid()
    AND employee.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono aktywnego pracownika.';
  END IF;

  IF NOT (
    v_employee.role = 'admin'
    OR v_employee.access_level = 'admin'
    OR 'fleet_view' = ANY(COALESCE(v_employee.permissions, '{}'::text[]))
    OR 'fleet_manage' = ANY(COALESCE(v_employee.permissions, '{}'::text[]))
  ) THEN
    RAISE EXCEPTION 'Nie masz uprawnień do korzystania z floty.';
  END IF;

  IF p_handover_type NOT IN ('pickup', 'return') THEN
    RAISE EXCEPTION 'Nieprawidłowy typ operacji.';
  END IF;

  SELECT *
  INTO v_vehicle
  FROM public.vehicles vehicle
  WHERE vehicle.id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono pojazdu.';
  END IF;

  IF p_odometer_reading IS NULL OR p_odometer_reading < COALESCE(v_vehicle.current_mileage, 0) THEN
    RAISE EXCEPTION 'Stan licznika nie może być niższy niż % km.',
      COALESCE(v_vehicle.current_mileage, 0);
  END IF;

  IF p_handover_type = 'pickup' THEN
    IF v_vehicle.status NOT IN ('active', 'available') THEN
      RAISE EXCEPTION 'Można odebrać wyłącznie aktywny i dostępny pojazd.';
    END IF;

    v_purpose := NULLIF(btrim(p_purpose), '');
    IF v_purpose IS NULL OR char_length(v_purpose) < 3 THEN
      RAISE EXCEPTION 'Podaj cel wyjazdu.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.event_vehicles assignment
      WHERE assignment.vehicle_id = p_vehicle_id
        AND assignment.is_in_use = true
    ) THEN
      RAISE EXCEPTION 'Pojazd jest aktualnie używany przy wydarzeniu.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.vehicle_handovers pickup
      WHERE pickup.vehicle_id = p_vehicle_id
        AND pickup.usage_source = 'ad_hoc'
        AND pickup.handover_type = 'pickup'
        AND NOT EXISTS (
          SELECT 1
          FROM public.vehicle_handovers returned
          WHERE returned.usage_session_id = pickup.usage_session_id
            AND returned.handover_type = 'return'
        )
    ) THEN
      RAISE EXCEPTION 'Pojazd jest już używany przez inną osobę.';
    END IF;

    v_session_id := gen_random_uuid();
  ELSE
    SELECT pickup.*
    INTO v_pickup
    FROM public.vehicle_handovers pickup
    WHERE pickup.vehicle_id = p_vehicle_id
      AND pickup.driver_id = auth.uid()
      AND pickup.usage_source = 'ad_hoc'
      AND pickup.handover_type = 'pickup'
      AND NOT EXISTS (
        SELECT 1
        FROM public.vehicle_handovers returned
        WHERE returned.usage_session_id = pickup.usage_session_id
          AND returned.handover_type = 'return'
      )
    ORDER BY pickup."timestamp" DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Nie masz aktywnego odbioru tego pojazdu.';
    END IF;

    IF p_odometer_reading < v_pickup.odometer_reading THEN
      RAISE EXCEPTION 'Stan licznika nie może być niższy niż przy odbiorze (% km).',
        v_pickup.odometer_reading;
    END IF;

    v_session_id := v_pickup.usage_session_id;
    v_purpose := v_pickup.purpose;
  END IF;

  INSERT INTO public.vehicle_handovers (
    event_vehicle_id,
    vehicle_id,
    driver_id,
    handover_type,
    odometer_reading,
    "timestamp",
    notes,
    usage_source,
    usage_session_id,
    purpose
  ) VALUES (
    NULL,
    p_vehicle_id,
    auth.uid(),
    p_handover_type,
    p_odometer_reading,
    now(),
    NULLIF(btrim(p_notes), ''),
    'ad_hoc',
    v_session_id,
    v_purpose
  )
  RETURNING * INTO v_handover;

  RETURN v_handover;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_vehicle_usages()
RETURNS TABLE (
  vehicle_id uuid,
  usage_session_id uuid,
  driver_id uuid,
  driver_name text,
  driver_first_name text,
  driver_surname text,
  pickup_timestamp timestamptz,
  pickup_odometer integer,
  purpose text,
  pickup_notes text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT
    pickup.vehicle_id,
    pickup.usage_session_id,
    pickup.driver_id,
    COALESCE(
      NULLIF(concat_ws(' ', employee.name, employee.surname), ''),
      employee.nickname,
      employee.email,
      'Pracownik'
    ) AS driver_name,
    employee.name AS driver_first_name,
    employee.surname AS driver_surname,
    pickup."timestamp",
    pickup.odometer_reading,
    pickup.purpose,
    pickup.notes
  FROM public.vehicle_handovers pickup
  JOIN public.employees employee ON employee.id = pickup.driver_id
  WHERE pickup.usage_source = 'ad_hoc'
    AND pickup.handover_type = 'pickup'
    AND NOT EXISTS (
      SELECT 1
      FROM public.vehicle_handovers returned
      WHERE returned.usage_session_id = pickup.usage_session_id
        AND returned.handover_type = 'return'
    )
    AND (
      pickup.driver_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.employees viewer
        WHERE viewer.id = auth.uid()
          AND viewer.is_active = true
          AND (
            viewer.role IN ('admin', 'manager')
            OR viewer.access_level IN ('admin', 'manager')
            OR 'fleet_view' = ANY(COALESCE(viewer.permissions, '{}'::text[]))
            OR 'fleet_manage' = ANY(COALESCE(viewer.permissions, '{}'::text[]))
          )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_record_vehicle_operation(
  p_vehicle_id uuid,
  p_event_vehicle_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.employees employee
      WHERE employee.id = auth.uid()
        AND employee.is_active = true
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.employees employee
        WHERE employee.id = auth.uid()
          AND (
            employee.role = 'admin'
            OR employee.access_level = 'admin'
            OR 'fleet_manage' = ANY(COALESCE(employee.permissions, '{}'::text[]))
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_assignments assignment
        WHERE assignment.vehicle_id = p_vehicle_id
          AND assignment.employee_id = auth.uid()
          AND assignment.status = 'active'
      )
      OR EXISTS (
        SELECT 1
        FROM public.event_vehicles assignment
        WHERE assignment.vehicle_id = p_vehicle_id
          AND assignment.driver_id = auth.uid()
          AND assignment.status NOT IN ('completed', 'cancelled')
          AND (p_event_vehicle_id IS NULL OR assignment.id = p_event_vehicle_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_handovers pickup
        WHERE pickup.vehicle_id = p_vehicle_id
          AND pickup.driver_id = auth.uid()
          AND pickup.usage_source = 'ad_hoc'
          AND pickup.handover_type = 'pickup'
          AND NOT EXISTS (
            SELECT 1
            FROM public.vehicle_handovers returned
            WHERE returned.usage_session_id = pickup.usage_session_id
              AND returned.handover_type = 'return'
          )
      )
    );
$$;

CREATE OR REPLACE VIEW public.vehicle_handover_history
WITH (security_invoker = true)
AS
SELECT
  handover.id,
  handover.event_vehicle_id,
  handover.driver_id,
  handover.handover_type,
  handover.odometer_reading,
  handover."timestamp",
  handover.notes,
  assignment.event_id,
  COALESCE(handover.vehicle_id, assignment.vehicle_id) AS vehicle_id,
  event.name AS event_name,
  event.event_date,
  event.location AS event_location,
  vehicle.name AS vehicle_name,
  vehicle.registration_number,
  employee.name || ' ' || employee.surname AS driver_name,
  employee.email AS driver_email,
  handover.usage_source,
  handover.usage_session_id,
  handover.purpose
FROM public.vehicle_handovers handover
LEFT JOIN public.event_vehicles assignment ON assignment.id = handover.event_vehicle_id
LEFT JOIN public.events event ON event.id = assignment.event_id
LEFT JOIN public.vehicles vehicle
  ON vehicle.id = COALESCE(handover.vehicle_id, assignment.vehicle_id)
LEFT JOIN public.employees employee ON employee.id = handover.driver_id
ORDER BY handover."timestamp" DESC;

GRANT SELECT ON public.vehicle_handover_history TO authenticated;

CREATE OR REPLACE FUNCTION public.notify_ad_hoc_vehicle_handover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vehicle_name text;
  v_driver_name text;
  v_notification_id uuid;
  v_recipient_count integer;
BEGIN
  SELECT COALESCE(
    NULLIF(vehicle.name, ''),
    NULLIF(concat_ws(' ', vehicle.brand, vehicle.model), ''),
    vehicle.registration_number,
    'Pojazd'
  )
  INTO v_vehicle_name
  FROM public.vehicles vehicle
  WHERE vehicle.id = NEW.vehicle_id;

  SELECT COALESCE(
    NULLIF(concat_ws(' ', employee.name, employee.surname), ''),
    employee.nickname,
    employee.email,
    'Pracownik'
  )
  INTO v_driver_name
  FROM public.employees employee
  WHERE employee.id = NEW.driver_id;

  INSERT INTO public.notifications (
    title,
    message,
    type,
    category,
    action_url,
    metadata,
    created_at
  ) VALUES (
    CASE WHEN NEW.handover_type = 'pickup'
      THEN 'Pracownik odebrał pojazd'
      ELSE 'Pracownik zdał pojazd'
    END,
    format(
      '%s %s pojazd %s. Cel: %s. Licznik: %s km.',
      v_driver_name,
      CASE WHEN NEW.handover_type = 'pickup' THEN 'odebrał(a)' ELSE 'zdał(a)' END,
      v_vehicle_name,
      NEW.purpose,
      NEW.odometer_reading
    ),
    CASE WHEN NEW.handover_type = 'pickup' THEN 'success' ELSE 'info' END,
    'system',
    '/crm/fleet/' || NEW.vehicle_id::text,
    jsonb_build_object(
      'kind', CASE WHEN NEW.handover_type = 'pickup'
        THEN 'vehicle_ad_hoc_pickup'
        ELSE 'vehicle_ad_hoc_return'
      END,
      'handover_id', NEW.id,
      'usage_session_id', NEW.usage_session_id,
      'vehicle_id', NEW.vehicle_id,
      'driver_id', NEW.driver_id,
      'purpose', NEW.purpose,
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
  SELECT
    v_notification_id,
    recipient.id,
    false,
    now()
  FROM public.employees recipient
  WHERE recipient.is_active = true
    AND recipient.id <> NEW.driver_id
    AND (
      recipient.role = 'admin'
      OR recipient.access_level = 'admin'
      OR 'fleet_manage' = ANY(COALESCE(recipient.permissions, '{}'::text[]))
    )
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_recipient_count = ROW_COUNT;
  IF v_recipient_count = 0 THEN
    DELETE FROM public.notifications WHERE id = v_notification_id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Could not create ad-hoc vehicle notification: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_ad_hoc_vehicle_handover
  ON public.vehicle_handovers;
CREATE TRIGGER trigger_notify_ad_hoc_vehicle_handover
  AFTER INSERT ON public.vehicle_handovers
  FOR EACH ROW
  WHEN (NEW.usage_source = 'ad_hoc')
  EXECUTE FUNCTION public.notify_ad_hoc_vehicle_handover();

REVOKE ALL ON FUNCTION public.record_ad_hoc_vehicle_handover(uuid, text, integer, text, text)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_current_vehicle_usages()
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_ad_hoc_vehicle_handover(uuid, text, integer, text, text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_vehicle_usages()
  TO authenticated;

COMMENT ON FUNCTION public.record_ad_hoc_vehicle_handover(uuid, text, integer, text, text) IS
  'Atomically records pickup or return for a vehicle trip not connected to an event.';
