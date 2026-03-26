/*
  # Fix check_employee_availability Function - Table Name

  1. Changes
    - Update check_employee_availability function to use correct table name: employee_assignments instead of employee_event_assignments
*/

-- Drop old function
DROP FUNCTION IF EXISTS check_employee_availability(uuid, timestamptz, timestamptz);

-- Recreate with correct table name
CREATE OR REPLACE FUNCTION check_employee_availability(
  p_employee_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb AS $$
DECLARE
  v_conflicts jsonb[];
  v_conflict jsonb;
BEGIN
  -- Check for event conflicts (using employee_assignments)
  FOR v_conflict IN
    SELECT jsonb_build_object(
      'type', 'event',
      'id', ev.id,
      'name', ev.name,
      'start_date', COALESCE(ep.phase_date + ep.start_time, ev.event_date),
      'end_date', COALESCE(ep.phase_date + ep.end_time, ev.event_date + INTERVAL '1 day'),
      'status', ea.invitation_status
    )
    FROM employee_assignments ea
    INNER JOIN events ev ON ev.id = ea.event_id
    LEFT JOIN event_phases ep ON ep.event_id = ev.id
    WHERE ea.employee_id = p_employee_id
      AND ev.deleted_at IS NULL
      AND (
        (COALESCE(ep.phase_date + ep.start_time, ev.event_date) <= p_end_date)
        AND (COALESCE(ep.phase_date + ep.end_time, ev.event_date + INTERVAL '1 day') >= p_start_date)
      )
  LOOP
    v_conflicts := array_append(v_conflicts, v_conflict);
  END LOOP;

  -- Check for absence conflicts
  FOR v_conflict IN
    SELECT jsonb_build_object(
      'type', 'absence',
      'id', ea.id,
      'absence_type', ea.absence_type,
      'start_date', ea.start_date,
      'end_date', ea.end_date,
      'approval_status', ea.approval_status
    )
    FROM employee_absences ea
    WHERE ea.employee_id = p_employee_id
      AND ea.approval_status IN ('pending', 'approved')
      AND (
        (ea.start_date <= p_end_date)
        AND (ea.end_date >= p_start_date)
      )
  LOOP
    v_conflicts := array_append(v_conflicts, v_conflict);
  END LOOP;

  RETURN jsonb_build_object(
    'available', (array_length(v_conflicts, 1) IS NULL),
    'conflicts', COALESCE(v_conflicts, ARRAY[]::jsonb[])
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;