/*
  # Add Employee Conflict Validation

  1. New Functions
    - `check_employee_availability` - checks if employee has conflicts (absences or other events)
    - Returns conflict information for given employee and date range

  2. Changes
    - Add trigger to validate before inserting/updating event_employees
    - Prevent assigning employees who have approved absences or other events in the same time
*/

-- Function to check if employee has conflicts in given date range
CREATE OR REPLACE FUNCTION check_employee_availability(
  p_employee_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_exclude_event_id uuid DEFAULT NULL
)
RETURNS TABLE (
  has_conflict boolean,
  conflict_type text,
  conflict_title text,
  conflict_start timestamptz,
  conflict_end timestamptz
) AS $$
BEGIN
  RETURN QUERY
  -- Check for approved absences
  SELECT
    true as has_conflict,
    'absence'::text as conflict_type,
    CASE ea.absence_type
      WHEN 'vacation' THEN 'Urlop wypoczynkowy'
      WHEN 'sick_leave' THEN 'Zwolnienie lekarskie'
      WHEN 'unpaid_leave' THEN 'Urlop bezpłatny'
      WHEN 'training' THEN 'Szkolenie'
      WHEN 'remote_work' THEN 'Praca zdalna'
      ELSE 'Inna nieobecność'
    END as conflict_title,
    ea.start_date as conflict_start,
    ea.end_date as conflict_end
  FROM employee_absences ea
  WHERE ea.employee_id = p_employee_id
    AND ea.status = 'approved'
    AND (
      (ea.start_date >= p_start_date AND ea.start_date < p_end_date)
      OR (ea.end_date > p_start_date AND ea.end_date <= p_end_date)
      OR (ea.start_date <= p_start_date AND ea.end_date >= p_end_date)
    )

  UNION ALL

  -- Check for other events
  SELECT
    true as has_conflict,
    'event'::text as conflict_type,
    ev.name as conflict_title,
    COALESCE(ep.start_time, ev.event_date) as conflict_start,
    COALESCE(ep.end_time, ev.event_end_date) as conflict_end
  FROM event_employees ee
  INNER JOIN events ev ON ev.id = ee.event_id
  LEFT JOIN event_phases ep ON ep.event_id = ev.id
  WHERE ee.employee_id = p_employee_id
    AND ee.invitation_status = 'accepted'
    AND (p_exclude_event_id IS NULL OR ev.id != p_exclude_event_id)
    AND (
      (COALESCE(ep.start_time, ev.event_date) >= p_start_date AND COALESCE(ep.start_time, ev.event_date) < p_end_date)
      OR (COALESCE(ep.end_time, ev.event_end_date) > p_start_date AND COALESCE(ep.end_time, ev.event_end_date) <= p_end_date)
      OR (COALESCE(ep.start_time, ev.event_date) <= p_start_date AND COALESCE(ep.end_time, ev.event_end_date) >= p_end_date)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to validate employee assignment
CREATE OR REPLACE FUNCTION validate_employee_assignment()
RETURNS TRIGGER AS $$
DECLARE
  v_event_start timestamptz;
  v_event_end timestamptz;
  v_conflict_count integer;
BEGIN
  -- Get event dates
  SELECT event_date, event_end_date
  INTO v_event_start, v_event_end
  FROM events
  WHERE id = NEW.event_id;

  -- Check for conflicts
  SELECT COUNT(*)
  INTO v_conflict_count
  FROM check_employee_availability(
    NEW.employee_id,
    v_event_start,
    v_event_end,
    NEW.event_id
  );

  -- If conflicts exist, raise warning (but allow insert - user might want to override)
  IF v_conflict_count > 0 THEN
    RAISE WARNING 'Employee has % conflicts in the selected date range', v_conflict_count;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger (only warns, doesn't block)
DROP TRIGGER IF EXISTS validate_employee_assignment_trigger ON event_employees;
CREATE TRIGGER validate_employee_assignment_trigger
  BEFORE INSERT OR UPDATE ON event_employees
  FOR EACH ROW
  EXECUTE FUNCTION validate_employee_assignment();

-- Add helper function to get employee conflicts for UI
CREATE OR REPLACE FUNCTION get_employee_conflicts(
  p_employee_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS jsonb AS $$
DECLARE
  v_conflicts jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'type', conflict_type,
      'title', conflict_title,
      'start', conflict_start,
      'end', conflict_end
    )
  )
  INTO v_conflicts
  FROM check_employee_availability(p_employee_id, p_start_date, p_end_date);

  RETURN COALESCE(v_conflicts, '[]'::jsonb);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;