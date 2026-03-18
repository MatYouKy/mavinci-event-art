/*
  # Fix event_phases column names in get_employee_timeline_data

  1. Changes
    - Change start_date/end_date to start_time/end_time for event_phases table
*/

DROP FUNCTION IF EXISTS get_employee_timeline_data(uuid[], timestamptz, timestamptz);

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
      WHEN ea.absence_type = 'unpaid_leave' THEN 'Urlop bezpłatny'
      WHEN ea.absence_type = 'parental_leave' THEN 'Urlop macierzyński/ojcowski'
      WHEN ea.absence_type = 'training' THEN 'Szkolenie'
      WHEN ea.absence_type = 'business_trip' THEN 'Wyjazd służbowy'
      WHEN ea.absence_type = 'remote_work' THEN 'Praca zdalna'
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
    ep.start_time as item_start,
    ep.end_time as item_end,
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
    AND ep.start_time <= p_end_date
    AND ep.end_time >= p_start_date
  
  ORDER BY item_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;