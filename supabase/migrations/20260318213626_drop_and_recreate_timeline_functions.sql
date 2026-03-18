/*
  # Drop and recreate timeline functions with correct column names

  1. Changes
    - Drop existing functions that use incorrect 'approval_status' column
    - Recreate all functions to use correct 'status' column name
    - Functions: get_employee_timeline_data, check_employee_availability, approve_absence, reject_absence
*/

-- Drop existing functions
DROP FUNCTION IF EXISTS get_employee_timeline_data(uuid[], timestamptz, timestamptz);
DROP FUNCTION IF EXISTS check_employee_availability(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS approve_absence(uuid, uuid);
DROP FUNCTION IF EXISTS reject_absence(uuid, uuid);

-- Recreate get_employee_timeline_data
CREATE OR REPLACE FUNCTION get_employee_timeline_data(
  p_employee_ids uuid[],
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  employee_id uuid,
  item_type text,
  item_id uuid,
  item_title text,
  item_start timestamptz,
  item_end timestamptz,
  item_status text,
  item_color text,
  item_metadata jsonb
) AS $$
BEGIN
  RETURN QUERY
  -- Nieobecności
  SELECT 
    ea.employee_id,
    'absence'::text as item_type,
    ea.id as item_id,
    CASE 
      WHEN ea.absence_type = 'vacation' THEN 'Urlop'
      WHEN ea.absence_type = 'sick_leave' THEN 'Zwolnienie lekarskie'
      WHEN ea.absence_type = 'personal' THEN 'Urlop okolicznościowy'
      WHEN ea.absence_type = 'unpaid' THEN 'Urlop bezpłatny'
      WHEN ea.absence_type = 'other' THEN 'Inne'
      ELSE ea.absence_type::text
    END as item_title,
    ea.start_date as item_start,
    ea.end_date as item_end,
    ea.status::text as item_status,
    CASE 
      WHEN ea.status::text = 'approved' THEN '#10b981'
      WHEN ea.status::text = 'pending' THEN '#f59e0b'
      WHEN ea.status::text = 'rejected' THEN '#ef4444'
      ELSE '#6b7280'
    END as item_color,
    jsonb_build_object(
      'absence_type', ea.absence_type,
      'all_day', ea.all_day,
      'notes', ea.notes
    ) as item_metadata
  FROM employee_absences ea
  WHERE ea.employee_id = ANY(p_employee_ids)
    AND ea.start_date <= p_end_date
    AND ea.end_date >= p_start_date
  
  UNION ALL
  
  -- Przypisania do faz wydarzeń
  SELECT 
    epa.employee_id,
    'event_phase'::text as item_type,
    epa.id as item_id,
    COALESCE(e.name || ' - ' || ep.name, ep.name, 'Faza wydarzenia') as item_title,
    ep.start_date as item_start,
    ep.end_date as item_end,
    COALESCE(epa.status, 'confirmed')::text as item_status,
    COALESCE(e.color, '#8b5cf6') as item_color,
    jsonb_build_object(
      'event_id', ep.event_id,
      'event_name', e.name,
      'phase_id', ep.id,
      'phase_name', ep.name,
      'role', epa.role
    ) as item_metadata
  FROM event_phase_assignments epa
  JOIN event_phases ep ON epa.phase_id = ep.id
  LEFT JOIN events e ON ep.event_id = e.id
  WHERE epa.employee_id = ANY(p_employee_ids)
    AND ep.start_date <= p_end_date
    AND ep.end_date >= p_start_date
  
  ORDER BY item_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate check_employee_availability
CREATE OR REPLACE FUNCTION check_employee_availability(
  p_employee_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  is_available boolean,
  conflicts jsonb
) AS $$
DECLARE
  v_conflicts jsonb := '[]'::jsonb;
  v_has_conflicts boolean := false;
BEGIN
  -- Check absences
  SELECT jsonb_agg(
    jsonb_build_object(
      'type', 'absence',
      'id', id,
      'absence_type', absence_type,
      'start_date', start_date,
      'end_date', end_date,
      'status', status
    )
  ) INTO v_conflicts
  FROM employee_absences
  WHERE employee_id = p_employee_id
    AND status::text IN ('approved', 'pending')
    AND start_date < p_end_date
    AND end_date > p_start_date;

  IF v_conflicts IS NOT NULL THEN
    v_has_conflicts := true;
  ELSE
    v_conflicts := '[]'::jsonb;
  END IF;

  -- Check event phase assignments
  WITH phase_conflicts AS (
    SELECT jsonb_build_object(
      'type', 'event_phase',
      'id', epa.id,
      'event_name', e.name,
      'phase_name', ep.name,
      'start_date', ep.start_date,
      'end_date', ep.end_date,
      'status', epa.status
    ) as conflict
    FROM event_phase_assignments epa
    JOIN event_phases ep ON epa.phase_id = ep.id
    LEFT JOIN events e ON ep.event_id = e.id
    WHERE epa.employee_id = p_employee_id
      AND ep.start_date < p_end_date
      AND ep.end_date > p_start_date
  )
  SELECT v_conflicts || jsonb_agg(conflict) INTO v_conflicts
  FROM phase_conflicts;

  IF v_conflicts != '[]'::jsonb THEN
    v_has_conflicts := true;
  END IF;

  RETURN QUERY SELECT NOT v_has_conflicts, v_conflicts;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate approve_absence
CREATE OR REPLACE FUNCTION approve_absence(
  p_absence_id uuid,
  p_approved_by uuid
)
RETURNS void AS $$
BEGIN
  UPDATE employee_absences
  SET 
    status = 'approved'::absence_status,
    approved_by = p_approved_by,
    approved_at = now(),
    updated_at = now()
  WHERE id = p_absence_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Recreate reject_absence
CREATE OR REPLACE FUNCTION reject_absence(
  p_absence_id uuid,
  p_approved_by uuid
)
RETURNS void AS $$
BEGIN
  UPDATE employee_absences
  SET 
    status = 'rejected'::absence_status,
    approved_by = p_approved_by,
    approved_at = now(),
    updated_at = now()
  WHERE id = p_absence_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;