/*
  # Fix Employee Timeline - Remove invitation_status

  1. Changes
    - Remove references to invitation_status from event_employees (doesn't exist)
    - Use event_phase_assignments for phases with invitation_status
    - Show all events from event_employees (no status filtering)
*/

DROP FUNCTION IF EXISTS get_employee_timeline_data(uuid[], timestamptz, timestamptz);

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
  -- Wydarzenia (cały event dla pracowników przypisanych do eventu)
  SELECT DISTINCT
    e.id as employee_id,
    (e.name || ' ' || e.surname)::text as employee_name,
    'event'::text as item_type,
    ev.id as item_id,
    ev.name as item_title,
    ev.event_date as item_start,
    ev.event_end_date as item_end,
    ev.status as item_status,
    COALESCE(ec.color, '#3b82f6') as item_color,
    jsonb_build_object(
      'event_id', ev.id,
      'category', ec.name,
      'location', l.name,
      'role', ee.role
    ) as item_metadata
  FROM employees e
  INNER JOIN event_employees ee ON ee.employee_id = e.id
  INNER JOIN events ev ON ev.id = ee.event_id
  LEFT JOIN event_categories ec ON ec.id = ev.category_id
  LEFT JOIN locations l ON l.id = ev.location_id
  WHERE e.id = ANY(p_employee_ids)
    AND (
      (ev.event_date >= p_start_date AND ev.event_date <= p_end_date)
      OR (ev.event_end_date >= p_start_date AND ev.event_end_date <= p_end_date)
      OR (ev.event_date <= p_start_date AND ev.event_end_date >= p_end_date)
    )

  UNION ALL

  -- Fazy wydarzeń (z przypisaniami do konkretnych faz)
  SELECT DISTINCT
    e.id as employee_id,
    (e.name || ' ' || e.surname)::text as employee_name,
    'event_phase'::text as item_type,
    ep.id as item_id,
    ev.name || ' - ' || ep.name as item_title,
    COALESCE(epa.assignment_start, ep.start_time) as item_start,
    COALESCE(epa.assignment_end, ep.end_time) as item_end,
    ev.status as item_status,
    COALESCE(ep.color, ec.color, '#8b5cf6') as item_color,
    jsonb_build_object(
      'event_id', ev.id,
      'phase_id', ep.id,
      'phase_name', ep.name,
      'phase_type_id', ep.phase_type_id,
      'category', ec.name,
      'location', l.name,
      'invitation_status', epa.invitation_status,
      'role', COALESCE(epa.role, ee.role)
    ) as item_metadata
  FROM employees e
  INNER JOIN event_phase_assignments epa ON epa.employee_id = e.id
  INNER JOIN event_phases ep ON ep.id = epa.phase_id
  INNER JOIN events ev ON ev.id = ep.event_id
  LEFT JOIN event_employees ee ON ee.event_id = ev.id AND ee.employee_id = e.id
  LEFT JOIN event_categories ec ON ec.id = ev.category_id
  LEFT JOIN locations l ON l.id = ev.location_id
  WHERE e.id = ANY(p_employee_ids)
    AND ep.start_time IS NOT NULL
    AND ep.end_time IS NOT NULL
    AND (epa.invitation_status IS NULL OR epa.invitation_status IN ('pending', 'accepted'))
    AND (
      (COALESCE(epa.assignment_start, ep.start_time) >= p_start_date AND COALESCE(epa.assignment_start, ep.start_time) <= p_end_date)
      OR (COALESCE(epa.assignment_end, ep.end_time) >= p_start_date AND COALESCE(epa.assignment_end, ep.end_time) <= p_end_date)
      OR (COALESCE(epa.assignment_start, ep.start_time) <= p_start_date AND COALESCE(epa.assignment_end, ep.end_time) >= p_end_date)
    )

  UNION ALL

  -- Nieobecności
  SELECT
    e.id as employee_id,
    (e.name || ' ' || e.surname)::text as employee_name,
    'absence'::text as item_type,
    ea.id as item_id,
    CASE ea.absence_type
      WHEN 'vacation' THEN 'Urlop wypoczynkowy'
      WHEN 'sick_leave' THEN 'Zwolnienie lekarskie'
      WHEN 'unpaid_leave' THEN 'Urlop bezpłatny'
      WHEN 'training' THEN 'Szkolenie'
      WHEN 'remote_work' THEN 'Praca zdalna'
      ELSE 'Inna nieobecność'
    END as item_title,
    ea.start_date as item_start,
    ea.end_date as item_end,
    ea.status::text as item_status,
    CASE ea.absence_type
      WHEN 'vacation' THEN '#10b981'
      WHEN 'sick_leave' THEN '#ef4444'
      WHEN 'unpaid_leave' THEN '#6b7280'
      WHEN 'training' THEN '#06b6d4'
      WHEN 'remote_work' THEN '#14b8a6'
      ELSE '#8b5cf6'
    END as item_color,
    jsonb_build_object(
      'absence_type', ea.absence_type,
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