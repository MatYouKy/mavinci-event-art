/*
  # Fix Employee Timeline Function - Table Name

  1. Changes
    - Update get_employee_timeline function to use correct table name: employee_assignments instead of employee_event_assignments
*/

-- Drop old function
DROP FUNCTION IF EXISTS get_employee_timeline(uuid[], timestamptz, timestamptz);

-- Recreate function with correct table name
CREATE OR REPLACE FUNCTION get_employee_timeline(
  p_employee_ids uuid[],
  p_start_date timestamptz DEFAULT NOW() - INTERVAL '30 days',
  p_end_date timestamptz DEFAULT NOW() + INTERVAL '90 days'
)
RETURNS TABLE (
  item_id uuid,
  employee_id uuid,
  item_type text,
  start_time timestamptz,
  end_time timestamptz,
  title text,
  status text,
  color text,
  item_metadata jsonb
) AS $$
BEGIN
  RETURN QUERY
  -- Events (from employee_assignments)
  SELECT 
    ev.id as item_id,
    e.id as employee_id,
    'event'::text as item_type,
    ev.event_date as start_time,
    (ev.event_date + INTERVAL '1 day') as end_time,
    ev.name as title,
    ev.status::text as status,
    COALESCE(ec.color, '#3b82f6')::text as color,
    jsonb_build_object(
      'phase_name', ep.name,
      'category', ec.name,
      'location', l.name
    ) as item_metadata
  FROM employees e
  INNER JOIN employee_assignments ea ON ea.employee_id = e.id
  INNER JOIN events ev ON ev.id = ea.event_id
  LEFT JOIN event_phases ep ON ep.event_id = ev.id
  LEFT JOIN event_categories ec ON ec.id = ev.category_id
  LEFT JOIN locations l ON l.id = ev.location_id
  WHERE e.id = ANY(p_employee_ids)
    AND ev.event_date BETWEEN p_start_date AND p_end_date
    AND ev.deleted_at IS NULL

  UNION ALL

  -- Phase assignments (from event_phase_assignments)
  SELECT 
    epa.id as item_id,
    e.id as employee_id,
    'phase'::text as item_type,
    (ep.phase_date + ep.start_time) as start_time,
    (ep.phase_date + ep.end_time) as end_time,
    (ev.name || ' - ' || ep.name) as title,
    epa.invitation_status::text as status,
    COALESCE(ec.color, '#3b82f6')::text as color,
    jsonb_build_object(
      'event_id', ev.id,
      'phase_id', ep.id,
      'phase_name', ep.name,
      'phase_type', ep.phase_type,
      'event_name', ev.name,
      'category', ec.name,
      'location', l.name
    ) as item_metadata
  FROM employees e
  INNER JOIN event_phase_assignments epa ON epa.employee_id = e.id
  INNER JOIN event_phases ep ON ep.id = epa.phase_id
  INNER JOIN events ev ON ev.id = ep.event_id
  LEFT JOIN event_categories ec ON ec.id = ev.category_id
  LEFT JOIN locations l ON l.id = ev.location_id
  WHERE e.id = ANY(p_employee_ids)
    AND ep.phase_date BETWEEN p_start_date AND p_end_date
    AND ev.deleted_at IS NULL

  UNION ALL

  -- Absences (from employee_absences)
  SELECT 
    ea.id as item_id,
    e.id as employee_id,
    'absence'::text as item_type,
    ea.start_date as start_time,
    ea.end_date as end_time,
    CASE ea.absence_type
      WHEN 'vacation' THEN 'Urlop wypoczynkowy'
      WHEN 'sick_leave' THEN 'Zwolnienie lekarskie'
      WHEN 'unpaid_leave' THEN 'Urlop bezpłatny'
      WHEN 'training' THEN 'Szkolenie'
      WHEN 'remote_work' THEN 'Praca zdalna'
      ELSE 'Nieobecność'
    END as title,
    ea.approval_status::text as status,
    CASE ea.absence_type
      WHEN 'vacation' THEN '#10b981'
      WHEN 'sick_leave' THEN '#ef4444'
      WHEN 'unpaid_leave' THEN '#6b7280'
      WHEN 'training' THEN '#06b6d4'
      WHEN 'remote_work' THEN '#14b8a6'
      ELSE '#8b5cf6'
    END::text as color,
    jsonb_build_object(
      'absence_type', ea.absence_type,
      'all_day', ea.all_day,
      'notes', ea.notes,
      'approval_status', ea.approval_status
    ) as item_metadata
  FROM employees e
  INNER JOIN employee_absences ea ON ea.employee_id = e.id
  WHERE e.id = ANY(p_employee_ids)
    AND ea.start_date <= p_end_date
    AND ea.end_date >= p_start_date

  ORDER BY start_time, title;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;