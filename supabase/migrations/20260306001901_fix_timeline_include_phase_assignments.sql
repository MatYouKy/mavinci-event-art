/*
  # Fix Timeline to Include Phase Assignments

  Przywraca funkcję get_employee_timeline_data aby pokazywała zarówno:
  - employee_assignments (przypisania do całego wydarzenia)
  - event_phase_assignments (przypisania do konkretnych faz)

  Każdy assignment ma swój własny invitation_status i kolor.
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
  -- Przypisania do FAZ (phase assignments) - najważniejsze, z dokładnymi godzinami
  SELECT
    e.id as employee_id,
    (e.name || ' ' || e.surname)::text as employee_name,
    'event'::text as item_type,
    ev.id as item_id,
    (ev.name || ' - ' || ep.name)::text as item_title,
    epa.assignment_start as item_start,
    epa.assignment_end as item_end,
    ev.status as item_status,
    -- Kolor zależy od invitation_status z phase_assignments
    CASE
      WHEN epa.invitation_status = 'pending' THEN '#fbbf24'
      WHEN epa.invitation_status = 'accepted' THEN COALESCE(ep.color, ec.color, '#10b981')
      WHEN epa.invitation_status = 'rejected' THEN '#ef4444'
      ELSE COALESCE(ep.color, ec.color, '#3b82f6')
    END as item_color,
    jsonb_build_object(
      'phase_name', ep.name,
      'phase_type_id', ep.phase_type_id,
      'category', ec.name,
      'location', l.name,
      'invitation_status', epa.invitation_status,
      'role', epa.role,
      'assignment_type', 'phase'
    ) as item_metadata
  FROM employees e
  INNER JOIN event_phase_assignments epa ON epa.employee_id = e.id
  INNER JOIN event_phases ep ON ep.id = epa.phase_id
  INNER JOIN events ev ON ev.id = ep.event_id
  LEFT JOIN event_categories ec ON ec.id = ev.category_id
  LEFT JOIN locations l ON l.id = ev.location_id
  WHERE e.id = ANY(p_employee_ids)
    AND (
      (epa.assignment_start >= p_start_date AND epa.assignment_start <= p_end_date)
      OR (epa.assignment_end >= p_start_date AND epa.assignment_end <= p_end_date)
      OR (epa.assignment_start <= p_start_date AND epa.assignment_end >= p_end_date)
    )

  UNION ALL

  -- Przypisania do CAŁYCH WYDARZEŃ (employee_assignments) - bez faz
  SELECT
    e.id as employee_id,
    (e.name || ' ' || e.surname)::text as employee_name,
    'event'::text as item_type,
    ev.id as item_id,
    ev.name as item_title,
    ev.event_date as item_start,
    COALESCE(ev.event_end_date, ev.event_date) as item_end,
    ev.status as item_status,
    -- Kolor zależy od invitation_status z employee_assignments
    CASE
      WHEN ea.invitation_status = 'pending' THEN '#fbbf24'
      WHEN ea.invitation_status = 'accepted' THEN COALESCE(ec.color, '#10b981')
      WHEN ea.invitation_status = 'rejected' THEN '#ef4444'
      ELSE COALESCE(ec.color, '#3b82f6')
    END as item_color,
    jsonb_build_object(
      'category', ec.name,
      'location', l.name,
      'invitation_status', ea.invitation_status,
      'role', ea.role,
      'assignment_type', 'event'
    ) as item_metadata
  FROM employees e
  INNER JOIN employee_assignments ea ON ea.employee_id = e.id
  INNER JOIN events ev ON ev.id = ea.event_id
  LEFT JOIN event_categories ec ON ec.id = ev.category_id
  LEFT JOIN locations l ON l.id = ev.location_id
  WHERE e.id = ANY(p_employee_ids)
    -- Pokazuj tylko jeśli NIE MA przypisań do faz dla tego wydarzenia
    AND NOT EXISTS (
      SELECT 1 FROM event_phase_assignments epa
      JOIN event_phases ep ON ep.id = epa.phase_id
      WHERE ep.event_id = ev.id
      AND epa.employee_id = e.id
    )
    AND (
      (ev.event_date >= p_start_date AND ev.event_date <= p_end_date)
      OR (COALESCE(ev.event_end_date, ev.event_date) >= p_start_date 
          AND COALESCE(ev.event_end_date, ev.event_date) <= p_end_date)
      OR (ev.event_date <= p_start_date 
          AND COALESCE(ev.event_end_date, ev.event_date) >= p_end_date)
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