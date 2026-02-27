/*
  # Enhance Employee Absences for Timeline

  1. New Functions
    - get_employee_timeline_data - agreguje wydarzenia i nieobecności
    - check_absence_overlap - sprawdza konflikty
*/

-- Timeline data function
CREATE OR REPLACE FUNCTION get_employee_timeline_data(
  p_employee_ids uuid[],
  p_start_date timestamptz,
  p_end_date timestamptz
)
RETURNS TABLE (
  employee_id uuid,
  employee_name text,
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
  -- Wydarzenia z fazami
  SELECT
    e.id as employee_id,
    (e.name || ' ' || e.surname)::text as employee_name,
    'event'::text as item_type,
    ev.id as item_id,
    ev.name as item_title,
    COALESCE(ep.start_time, ev.start_date) as item_start,
    COALESCE(ep.end_time, ev.end_date) as item_end,
    ev.status as item_status,
    COALESCE(ep.color, ec.color, '#3b82f6') as item_color,
    jsonb_build_object(
      'phase_name', ep.name,
      'category', ec.name,
      'location', l.name
    ) as item_metadata
  FROM employees e
  INNER JOIN employee_event_assignments eea ON eea.employee_id = e.id
  INNER JOIN events ev ON ev.id = eea.event_id
  LEFT JOIN event_phases ep ON ep.event_id = ev.id
  LEFT JOIN event_categories ec ON ec.id = ev.category_id
  LEFT JOIN locations l ON l.id = ev.location_id
  WHERE e.id = ANY(p_employee_ids)
    AND ev.deleted_at IS NULL
    AND eea.status != 'rejected'
    AND (
      (COALESCE(ep.start_time, ev.start_date) >= p_start_date AND COALESCE(ep.start_time, ev.start_date) <= p_end_date)
      OR (COALESCE(ep.end_time, ev.end_date) >= p_start_date AND COALESCE(ep.end_time, ev.end_date) <= p_end_date)
      OR (COALESCE(ep.start_time, ev.start_date) <= p_start_date AND COALESCE(ep.end_time, ev.end_date) >= p_end_date)
    )

  UNION ALL

  -- Nieobecności
  SELECT
    e.id as employee_id,
    (e.name || ' ' || e.surname)::text as employee_name,
    'absence'::text as item_type,
    ea.id as item_id,
    ea.absence_type::text as item_title,
    ea.start_date as item_start,
    ea.end_date as item_end,
    ea.status::text as item_status,
    CASE ea.absence_type::text
      WHEN 'vacation' THEN '#10b981'
      WHEN 'sick_leave' THEN '#ef4444'
      WHEN 'unpaid_leave' THEN '#6b7280'
      WHEN 'training' THEN '#06b6d4'
      WHEN 'remote_work' THEN '#14b8a6'
      ELSE '#8b5cf6'
    END as item_color,
    jsonb_build_object(
      'all_day', ea.all_day,
      'notes', ea.notes,
      'approved_by', COALESCE(approver.name || ' ' || approver.surname, '')
    ) as item_metadata
  FROM employees e
  INNER JOIN employee_absences ea ON ea.employee_id = e.id
  LEFT JOIN employees approver ON approver.id = ea.approved_by
  WHERE e.id = ANY(p_employee_ids)
    AND ea.status IN ('approved', 'pending')
    AND (
      (ea.start_date >= p_start_date AND ea.start_date <= p_end_date)
      OR (ea.end_date >= p_start_date AND ea.end_date <= p_end_date)
      OR (ea.start_date <= p_start_date AND ea.end_date >= p_end_date)
    )

  ORDER BY employee_id, item_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Overlap check function
CREATE OR REPLACE FUNCTION check_absence_overlap(
  p_employee_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_absence_id uuid DEFAULT NULL
)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM employee_absences
    WHERE employee_id = p_employee_id
    AND status IN ('approved', 'pending')
    AND (p_absence_id IS NULL OR id != p_absence_id)
    AND (
      (start_date <= p_start_date AND end_date >= p_start_date)
      OR (start_date <= p_end_date AND end_date >= p_end_date)
      OR (start_date >= p_start_date AND end_date <= p_end_date)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;