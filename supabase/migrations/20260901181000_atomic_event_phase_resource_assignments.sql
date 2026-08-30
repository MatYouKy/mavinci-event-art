/*
  Atomowe przypisania zasobów do wielu faz wydarzenia.

  Funkcje działają jako SECURITY INVOKER: zachowują RLS i uprawnienia osoby,
  która je wywołuje. Cała lista faz zapisuje się w jednej transakcji albo wcale.
*/

CREATE OR REPLACE FUNCTION public.assign_event_employee_to_phases(
  p_event_id uuid,
  p_employee_id uuid,
  p_phase_ids uuid[],
  p_role text DEFAULT 'technician'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase public.event_phases%ROWTYPE;
  v_phase_id uuid;
  v_inserted integer := 0;
BEGIN
  IF p_event_id IS NULL OR p_employee_id IS NULL OR COALESCE(cardinality(p_phase_ids), 0) = 0 THEN
    RAISE EXCEPTION 'event_id, employee_id and phase_ids are required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_phase_ids) AS requested(requested_phase_id)
    LEFT JOIN public.event_phases phase ON phase.id = requested.requested_phase_id
    WHERE phase.id IS NULL OR phase.event_id <> p_event_id
  ) THEN
    RAISE EXCEPTION 'Every phase must belong to the selected event';
  END IF;

  FOREACH v_phase_id IN ARRAY p_phase_ids LOOP
    SELECT * INTO STRICT v_phase
    FROM public.event_phases
    WHERE id = v_phase_id;

    INSERT INTO public.event_phase_assignments (
      phase_id,
      employee_id,
      assignment_start,
      assignment_end,
      phase_work_start,
      phase_work_end,
      role,
      invitation_status,
      invitation_email_sent
    )
    SELECT
      v_phase.id,
      p_employee_id,
      v_phase.start_time,
      v_phase.end_time,
      v_phase.start_time,
      v_phase.end_time,
      COALESCE(NULLIF(trim(p_role), ''), 'technician'),
      'pending',
      false
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_phase_assignments assignment
      WHERE assignment.phase_id = v_phase.id
        AND assignment.employee_id = p_employee_id
    );

    v_inserted := v_inserted + CASE WHEN FOUND THEN 1 ELSE 0 END;
  END LOOP;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_event_vehicle_to_phases(
  p_event_id uuid,
  p_vehicle_id uuid,
  p_phase_ids uuid[],
  p_driver_id uuid DEFAULT NULL,
  p_buffer_before_minutes integer DEFAULT 0,
  p_buffer_after_minutes integer DEFAULT 0,
  p_purpose text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_phase public.event_phases%ROWTYPE;
  v_phase_id uuid;
  v_inserted integer := 0;
BEGIN
  IF p_event_id IS NULL OR p_vehicle_id IS NULL OR COALESCE(cardinality(p_phase_ids), 0) = 0 THEN
    RAISE EXCEPTION 'event_id, vehicle_id and phase_ids are required';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_phase_ids) AS requested(requested_phase_id)
    LEFT JOIN public.event_phases phase ON phase.id = requested.requested_phase_id
    WHERE phase.id IS NULL OR phase.event_id <> p_event_id
  ) THEN
    RAISE EXCEPTION 'Every phase must belong to the selected event';
  END IF;

  FOREACH v_phase_id IN ARRAY p_phase_ids LOOP
    SELECT * INTO STRICT v_phase
    FROM public.event_phases
    WHERE id = v_phase_id;

    INSERT INTO public.event_phase_vehicles (
      phase_id,
      vehicle_id,
      driver_id,
      assigned_start,
      assigned_end,
      purpose,
      notes
    )
    SELECT
      v_phase.id,
      p_vehicle_id,
      p_driver_id,
      v_phase.start_time - make_interval(mins => GREATEST(COALESCE(p_buffer_before_minutes, 0), 0)),
      v_phase.end_time + make_interval(mins => GREATEST(COALESCE(p_buffer_after_minutes, 0), 0)),
      NULLIF(trim(p_purpose), ''),
      NULLIF(trim(p_notes), '')
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.event_phase_vehicles assignment
      WHERE assignment.phase_id = v_phase.id
        AND assignment.vehicle_id = p_vehicle_id
    );

    v_inserted := v_inserted + CASE WHEN FOUND THEN 1 ELSE 0 END;
  END LOOP;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_event_employee_to_phases(uuid, uuid, uuid[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_event_vehicle_to_phases(uuid, uuid, uuid[], uuid, integer, integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_event_employee_to_phases(uuid, uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_event_vehicle_to_phases(uuid, uuid, uuid[], uuid, integer, integer, text, text) TO authenticated;

COMMENT ON FUNCTION public.assign_event_employee_to_phases(uuid, uuid, uuid[], text) IS
  'Atomically assigns one employee to multiple phases while preserving caller RLS.';
COMMENT ON FUNCTION public.assign_event_vehicle_to_phases(uuid, uuid, uuid[], uuid, integer, integer, text, text) IS
  'Atomically assigns one vehicle to multiple phases; existing phase-to-logistics trigger performs synchronization.';
