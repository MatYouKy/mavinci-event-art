/*
  # Fix check_employee_availability - Use approval_status Column

  Naprawia funkcję check_employee_availability aby używała:
  - employee_absences.approval_status (nie status)
*/

DROP FUNCTION IF EXISTS check_employee_availability(uuid, timestamptz, timestamptz, uuid, uuid);

CREATE OR REPLACE FUNCTION check_employee_availability(
  p_employee_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_exclude_event_id uuid DEFAULT NULL,
  p_exclude_phase_id uuid DEFAULT NULL
)
RETURNS TABLE (
  has_conflict boolean,
  conflict_type text,
  conflict_id uuid,
  conflict_title text,
  conflict_start timestamptz,
  conflict_end timestamptz,
  conflict_status text,
  conflict_details jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  -- Sprawdź nieobecności (urlopy, zwolnienia)
  SELECT
    true as has_conflict,
    'absence'::text as conflict_type,
    ea.id as conflict_id,
    CASE ea.absence_type
      WHEN 'vacation' THEN 'Urlop wypoczynkowy'
      WHEN 'sick_leave' THEN 'Zwolnienie lekarskie'
      WHEN 'unpaid_leave' THEN 'Urlop bezpłatny'
      WHEN 'parental_leave' THEN 'Urlop macierzyński/ojcowski'
      WHEN 'training' THEN 'Szkolenie'
      WHEN 'business_trip' THEN 'Wyjazd służbowy'
      WHEN 'remote_work' THEN 'Praca zdalna'
      ELSE 'Inna nieobecność'
    END as conflict_title,
    ea.start_date as conflict_start,
    ea.end_date as conflict_end,
    -- POPRAWKA: użyj approval_status zamiast status
    ea.approval_status::text as conflict_status,
    jsonb_build_object(
      'absence_type', ea.absence_type,
      'all_day', ea.all_day,
      'notes', ea.notes
    ) as conflict_details
  FROM employee_absences ea
  WHERE ea.employee_id = p_employee_id
    -- POPRAWKA: użyj approval_status zamiast status
    AND ea.approval_status IN ('approved', 'pending')
    AND (
      (ea.start_date >= p_start_date AND ea.start_date < p_end_date)
      OR (ea.end_date > p_start_date AND ea.end_date <= p_end_date)
      OR (ea.start_date <= p_start_date AND ea.end_date >= p_end_date)
    )

  UNION ALL

  -- Sprawdź przypisania do FAZ
  SELECT
    true as has_conflict,
    'phase'::text as conflict_type,
    epa.id as conflict_id,
    (e.name || ' - ' || ep.name)::text as conflict_title,
    epa.assignment_start as conflict_start,
    epa.assignment_end as conflict_end,
    epa.invitation_status::text as conflict_status,
    jsonb_build_object(
      'event_id', e.id,
      'event_name', e.name,
      'phase_id', ep.id,
      'phase_name', ep.name,
      'role', epa.role
    ) as conflict_details
  FROM event_phase_assignments epa
  JOIN event_phases ep ON ep.id = epa.phase_id
  JOIN events e ON e.id = ep.event_id
  WHERE epa.employee_id = p_employee_id
    AND epa.invitation_status IN ('accepted', 'pending')
    AND (p_exclude_phase_id IS NULL OR epa.phase_id != p_exclude_phase_id)
    AND (p_exclude_event_id IS NULL OR ep.event_id != p_exclude_event_id)
    AND (
      (epa.assignment_start >= p_start_date AND epa.assignment_start < p_end_date)
      OR (epa.assignment_end > p_start_date AND epa.assignment_end <= p_end_date)
      OR (epa.assignment_start <= p_start_date AND epa.assignment_end >= p_end_date)
    )

  UNION ALL

  -- Sprawdź przypisania do CAŁYCH WYDARZEŃ (tylko jeśli nie ma przypisań do faz)
  SELECT
    true as has_conflict,
    'event'::text as conflict_type,
    ea.id as conflict_id,
    e.name as conflict_title,
    e.event_date as conflict_start,
    COALESCE(e.event_end_date, e.event_date) as conflict_end,
    ea.status::text as conflict_status,
    jsonb_build_object(
      'event_id', e.id,
      'event_name', e.name,
      'role', ea.role
    ) as conflict_details
  FROM employee_assignments ea
  JOIN events e ON e.id = ea.event_id
  WHERE ea.employee_id = p_employee_id
    AND ea.status IN ('accepted', 'pending')
    AND (p_exclude_event_id IS NULL OR ea.event_id != p_exclude_event_id)
    -- Pokazuj tylko jeśli NIE MA przypisań do faz dla tego wydarzenia
    AND NOT EXISTS (
      SELECT 1 FROM event_phase_assignments epa
      JOIN event_phases ep ON ep.id = epa.phase_id
      WHERE ep.event_id = e.id
      AND epa.employee_id = p_employee_id
    )
    AND (
      (e.event_date >= p_start_date AND e.event_date < p_end_date)
      OR (COALESCE(e.event_end_date, e.event_date) > p_start_date 
          AND COALESCE(e.event_end_date, e.event_date) <= p_end_date)
      OR (e.event_date <= p_start_date 
          AND COALESCE(e.event_end_date, e.event_date) >= p_end_date)
    );
END;
$$;