/*
  Pojazd przypisany do fazy jest jednocześnie pojazdem wydarzenia.

  event_phase_vehicles pozostaje źródłem szczegółowego harmonogramu fazowego,
  a event_vehicles jest kanonicznym wpisem widocznym w zakładce Logistyka.
*/

ALTER TABLE public.event_vehicles
  ADD COLUMN IF NOT EXISTS added_from_phase boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phase_assignment_from timestamptz,
  ADD COLUMN IF NOT EXISTS phase_assignment_until timestamptz;

CREATE OR REPLACE FUNCTION public.sync_event_vehicle_from_phase_assignments(
  p_event_id uuid,
  p_vehicle_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assignment_start timestamptz;
  v_assignment_end timestamptz;
  v_driver_id uuid;
  v_event_vehicle_id uuid;
BEGIN
  IF p_event_id IS NULL OR p_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'event_id and vehicle_id are required';
  END IF;

  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.employees employee
    WHERE employee.auth_user_id = auth.uid()
      AND (
        'admin' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        OR 'events_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
        OR 'fleet_manage' = ANY(COALESCE(employee.permissions, ARRAY[]::text[]))
      )
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to synchronize event vehicle';
  END IF;

  SELECT
    MIN(assignment.assigned_start),
    MAX(assignment.assigned_end),
    (ARRAY_AGG(assignment.driver_id ORDER BY assignment.assigned_start)
      FILTER (WHERE assignment.driver_id IS NOT NULL))[1]
  INTO
    v_assignment_start,
    v_assignment_end,
    v_driver_id
  FROM public.event_phase_vehicles assignment
  JOIN public.event_phases phase ON phase.id = assignment.phase_id
  WHERE phase.event_id = p_event_id
    AND assignment.vehicle_id = p_vehicle_id;

  IF v_assignment_start IS NULL OR v_assignment_end IS NULL THEN
    UPDATE public.event_vehicles event_vehicle
    SET
      phase_assignment_from = NULL,
      phase_assignment_until = NULL
    WHERE event_vehicle.event_id = p_event_id
      AND event_vehicle.vehicle_id = p_vehicle_id
    RETURNING event_vehicle.id INTO v_event_vehicle_id;

    RETURN v_event_vehicle_id;
  END IF;

  INSERT INTO public.event_vehicles (
    event_id,
    vehicle_id,
    role,
    driver_id,
    vehicle_available_from,
    vehicle_available_until,
    phase_assignment_from,
    phase_assignment_until,
    added_from_phase,
    status
  ) VALUES (
    p_event_id,
    p_vehicle_id,
    'transport_equipment',
    v_driver_id,
    v_assignment_start,
    v_assignment_end,
    v_assignment_start,
    v_assignment_end,
    true,
    'planned'
  )
  ON CONFLICT (event_id, vehicle_id) DO UPDATE
  SET
    driver_id = COALESCE(public.event_vehicles.driver_id, EXCLUDED.driver_id),
    phase_assignment_from = EXCLUDED.phase_assignment_from,
    phase_assignment_until = EXCLUDED.phase_assignment_until,
    vehicle_available_from = LEAST(
      COALESCE(public.event_vehicles.vehicle_available_from, EXCLUDED.vehicle_available_from),
      EXCLUDED.vehicle_available_from
    ),
    vehicle_available_until = GREATEST(
      COALESCE(public.event_vehicles.vehicle_available_until, EXCLUDED.vehicle_available_until),
      EXCLUDED.vehicle_available_until
    )
  RETURNING id INTO v_event_vehicle_id;

  RETURN v_event_vehicle_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_event_vehicle_after_phase_assignment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_event_id uuid;
  v_new_event_id uuid;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT phase.event_id
    INTO v_old_event_id
    FROM public.event_phases phase
    WHERE phase.id = OLD.phase_id;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT phase.event_id
    INTO v_new_event_id
    FROM public.event_phases phase
    WHERE phase.id = NEW.phase_id;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') AND v_old_event_id IS NOT NULL THEN
    PERFORM public.sync_event_vehicle_from_phase_assignments(v_old_event_id, OLD.vehicle_id);
  END IF;

  IF TG_OP = 'INSERT' AND v_new_event_id IS NOT NULL THEN
    PERFORM public.sync_event_vehicle_from_phase_assignments(v_new_event_id, NEW.vehicle_id);
  ELSIF TG_OP = 'UPDATE'
    AND v_new_event_id IS NOT NULL
    AND (
      v_new_event_id IS DISTINCT FROM v_old_event_id
      OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id
      OR NEW.assigned_start IS DISTINCT FROM OLD.assigned_start
      OR NEW.assigned_end IS DISTINCT FROM OLD.assigned_end
      OR NEW.driver_id IS DISTINCT FROM OLD.driver_id
    ) THEN
    PERFORM public.sync_event_vehicle_from_phase_assignments(v_new_event_id, NEW.vehicle_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_event_vehicle_after_phase_assignment_change
  ON public.event_phase_vehicles;

CREATE TRIGGER trigger_sync_event_vehicle_after_phase_assignment_change
  AFTER INSERT OR UPDATE OF phase_id, vehicle_id, driver_id, assigned_start, assigned_end OR DELETE
  ON public.event_phase_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_event_vehicle_after_phase_assignment_change();

DO $$
DECLARE
  assignment_pair record;
BEGIN
  FOR assignment_pair IN
    SELECT DISTINCT phase.event_id, assignment.vehicle_id
    FROM public.event_phase_vehicles assignment
    JOIN public.event_phases phase ON phase.id = assignment.phase_id
  LOOP
    PERFORM public.sync_event_vehicle_from_phase_assignments(
      assignment_pair.event_id,
      assignment_pair.vehicle_id
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_event_vehicle_from_phase_assignments(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_event_vehicle_from_phase_assignments(uuid, uuid)
  TO authenticated;

COMMENT ON COLUMN public.event_vehicles.added_from_phase IS
  'Pojazd został automatycznie dodany do logistyki podczas przypisywania do fazy';
COMMENT ON COLUMN public.event_vehicles.phase_assignment_from IS
  'Najwcześniejszy początek przypisania pojazdu do faz wydarzenia';
COMMENT ON COLUMN public.event_vehicles.phase_assignment_until IS
  'Najpóźniejszy koniec przypisania pojazdu do faz wydarzenia';
COMMENT ON FUNCTION public.sync_event_vehicle_from_phase_assignments(uuid, uuid) IS
  'Tworzy lub aktualizuje kanoniczny wpis event_vehicles na podstawie przypisań do faz';
