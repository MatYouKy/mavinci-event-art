/*
  # Secure vehicle pickup and return for assigned mobile drivers

  The handover history remains the source of truth. Existing database triggers
  update event_vehicles.is_in_use, pickup/return timestamps and vehicle mileage.
*/

CREATE OR REPLACE FUNCTION public.record_assigned_vehicle_handover(
  p_event_vehicle_id uuid,
  p_handover_type text,
  p_odometer_reading integer,
  p_notes text DEFAULT NULL
)
RETURNS public.vehicle_handovers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_assignment public.event_vehicles%ROWTYPE;
  v_current_mileage integer;
  v_handover public.vehicle_handovers%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Brak aktywnej sesji użytkownika.';
  END IF;

  IF p_handover_type NOT IN ('pickup', 'return') THEN
    RAISE EXCEPTION 'Nieprawidłowy typ operacji.';
  END IF;

  IF p_odometer_reading IS NULL OR p_odometer_reading < 0 THEN
    RAISE EXCEPTION 'Stan licznika musi być nieujemną liczbą całkowitą.';
  END IF;

  SELECT id
  INTO v_employee_id
  FROM public.employees
  WHERE id = auth.uid()
    AND is_active = true;

  IF v_employee_id IS NULL THEN
    RAISE EXCEPTION 'Nie znaleziono aktywnego pracownika dla tej sesji.';
  END IF;

  SELECT ev.*
  INTO v_assignment
  FROM public.event_vehicles ev
  WHERE ev.id = p_event_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Nie znaleziono przypisania pojazdu do wydarzenia.';
  END IF;

  IF v_assignment.driver_id IS DISTINCT FROM v_employee_id THEN
    RAISE EXCEPTION 'Tylko przypisany kierowca może potwierdzić odbiór lub zdanie pojazdu.';
  END IF;

  IF v_assignment.vehicle_id IS NOT NULL THEN
    SELECT current_mileage
    INTO v_current_mileage
    FROM public.vehicles
    WHERE id = v_assignment.vehicle_id
    FOR UPDATE;

    IF p_odometer_reading < COALESCE(v_current_mileage, 0) THEN
      RAISE EXCEPTION 'Stan licznika nie może być niższy niż ostatnio zapisany przebieg (% km).',
        v_current_mileage;
    END IF;
  END IF;

  IF p_handover_type = 'pickup' THEN
    IF COALESCE(v_assignment.is_in_use, false) THEN
      RAISE EXCEPTION 'Ten pojazd został już odebrany.';
    END IF;

    IF v_assignment.vehicle_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.event_vehicles other_assignment
      WHERE other_assignment.vehicle_id = v_assignment.vehicle_id
        AND other_assignment.id <> v_assignment.id
        AND other_assignment.is_in_use = true
    ) THEN
      RAISE EXCEPTION 'Ten pojazd jest obecnie używany przy innym wydarzeniu.';
    END IF;
  ELSE
    IF NOT COALESCE(v_assignment.is_in_use, false) THEN
      RAISE EXCEPTION 'Nie można zdać pojazdu, który nie został odebrany.';
    END IF;

    IF v_assignment.pickup_odometer IS NOT NULL
      AND p_odometer_reading < v_assignment.pickup_odometer THEN
      RAISE EXCEPTION 'Stan licznika przy zdaniu nie może być niższy niż przy odbiorze (% km).',
        v_assignment.pickup_odometer;
    END IF;
  END IF;

  INSERT INTO public.vehicle_handovers (
    event_vehicle_id,
    driver_id,
    handover_type,
    odometer_reading,
    "timestamp",
    notes
  )
  VALUES (
    v_assignment.id,
    v_employee_id,
    p_handover_type,
    p_odometer_reading,
    now(),
    NULLIF(BTRIM(p_notes), '')
  )
  RETURNING * INTO v_handover;

  RETURN v_handover;
END;
$$;

REVOKE ALL ON FUNCTION public.record_assigned_vehicle_handover(uuid, text, integer, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_assigned_vehicle_handover(uuid, text, integer, text)
  TO authenticated;

COMMENT ON FUNCTION public.record_assigned_vehicle_handover(uuid, text, integer, text) IS
  'Atomically records a pickup or return by the driver assigned to an event vehicle.';
