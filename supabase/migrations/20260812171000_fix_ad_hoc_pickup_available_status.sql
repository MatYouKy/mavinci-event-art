/*
  # Allow pickup for the current vehicle availability status

  Vehicle statuses were migrated from `active` to `available`. Keep support
  for both values while continuing to reject service, compliance and retired
  statuses.
*/

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
      RAISE EXCEPTION 'Pojazd nie jest dostępny do odbioru (status: %).', v_vehicle.status;
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

REVOKE ALL ON FUNCTION public.record_ad_hoc_vehicle_handover(uuid, text, integer, text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_ad_hoc_vehicle_handover(uuid, text, integer, text, text)
  TO authenticated;

