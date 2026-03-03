/*
  # Fix Calendar Timeline RPC - Fix ambiguous event_id

  1. Changes
    - Fix ambiguous event_id in event_phases subqueries
    - Use qualified column names to avoid ambiguity
*/

CREATE OR REPLACE FUNCTION get_calendar_timeline_resources(
  p_start_date timestamptz DEFAULT NOW() - INTERVAL '30 days',
  p_end_date timestamptz DEFAULT NOW() + INTERVAL '90 days'
)
RETURNS TABLE (
  resource_type text,
  resource_id uuid,
  resource_name text,
  resource_metadata jsonb,
  event_id uuid,
  event_name text,
  event_start timestamptz,
  event_end timestamptz,
  event_status text,
  assignment_status text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY

  -- Pojazdy z przypisaniami do wydarzeń
  SELECT
    'vehicle'::text as resource_type,
    v.id as resource_id,
    v.name as resource_name,
    jsonb_build_object(
      'registration_number', v.registration_number,
      'vehicle_type', v.vehicle_type,
      'status', v.status
    ) as resource_metadata,
    e.id as event_id,
    e.name as event_name,
    COALESCE(ep.work_start_datetime, e.event_start_datetime, e.event_date) as event_start,
    COALESCE(ep.work_end_datetime, e.event_end_datetime, e.event_end_date) as event_end,
    e.status::text as event_status,
    ev.status::text as assignment_status
  FROM vehicles v
  LEFT JOIN event_vehicles ev ON ev.vehicle_id = v.id
  LEFT JOIN events e ON e.id = ev.event_id AND e.status != 'cancelled'
  LEFT JOIN event_phases ep ON ep.id = (
    SELECT ep2.id FROM event_phases ep2
    WHERE ep2.event_id = e.id
    ORDER BY ep2.work_start_datetime ASC
    LIMIT 1
  )
  WHERE v.status IN ('available', 'in_use', 'maintenance')
    AND (
      ev.id IS NULL
      OR (
        COALESCE(ep.work_end_datetime, e.event_end_datetime, e.event_end_date) >= p_start_date
        AND COALESCE(ep.work_start_datetime, e.event_start_datetime, e.event_date) <= p_end_date
        AND ev.status != 'cancelled'
      )
    )

  UNION ALL

  -- Pracownicy z przypisaniami do wydarzeń (event_employees - stary system)
  SELECT
    'employee'::text as resource_type,
    emp.id as resource_id,
    (emp.name || ' ' || emp.surname) as resource_name,
    jsonb_build_object(
      'nickname', emp.nickname,
      'role', emp.role,
      'email', emp.email
    ) as resource_metadata,
    e.id as event_id,
    e.name as event_name,
    COALESCE(e.event_start_datetime, e.event_date) as event_start,
    COALESCE(e.event_end_datetime, e.event_end_date) as event_end,
    e.status::text as event_status,
    'assigned'::text as assignment_status
  FROM employees emp
  LEFT JOIN event_employees ee ON ee.employee_id = emp.id
  LEFT JOIN events e ON e.id = ee.event_id AND e.status != 'cancelled'
  WHERE emp.is_active = true
    AND (
      ee.id IS NULL
      OR (
        COALESCE(e.event_end_datetime, e.event_end_date) >= p_start_date
        AND COALESCE(e.event_start_datetime, e.event_date) <= p_end_date
      )
    )

  UNION ALL

  -- Pracownicy z przypisaniami (employee_assignments - nowy system z invitation_status)
  SELECT
    'employee'::text as resource_type,
    emp.id as resource_id,
    (emp.name || ' ' || emp.surname) as resource_name,
    jsonb_build_object(
      'nickname', emp.nickname,
      'role', emp.role,
      'email', emp.email
    ) as resource_metadata,
    e.id as event_id,
    e.name as event_name,
    COALESCE(ep.work_start_datetime, e.event_start_datetime, e.event_date) as event_start,
    COALESCE(ep.work_end_datetime, e.event_end_datetime, e.event_end_date) as event_end,
    e.status::text as event_status,
    COALESCE(ea.status, 'pending')::text as assignment_status
  FROM employees emp
  LEFT JOIN employee_assignments ea ON ea.employee_id = emp.id
  LEFT JOIN events e ON e.id = ea.event_id AND e.status != 'cancelled'
  LEFT JOIN event_phases ep ON ep.id = (
    SELECT ep2.id FROM event_phases ep2
    WHERE ep2.event_id = e.id
    ORDER BY ep2.work_start_datetime ASC
    LIMIT 1
  )
  WHERE emp.is_active = true
    AND ea.id IS NOT NULL
    AND COALESCE(ea.status, 'pending') IN ('pending', 'accepted')
    AND (
      COALESCE(ep.work_end_datetime, e.event_end_datetime, e.event_end_date) >= p_start_date
      AND COALESCE(ep.work_start_datetime, e.event_start_datetime, e.event_date) <= p_end_date
    )

  UNION ALL

  -- Sprzęt z przypisaniami do wydarzeń
  SELECT
    'equipment'::text as resource_type,
    ei.id as resource_id,
    ei.name as resource_name,
    jsonb_build_object(
      'category_id', ei.category_id,
      'status', ei.status,
      'serial_number', ei.serial_number
    ) as resource_metadata,
    e.id as event_id,
    e.name as event_name,
    COALESCE(ep.work_start_datetime, e.event_start_datetime, e.event_date) as event_start,
    COALESCE(ep.work_end_datetime, e.event_end_datetime, e.event_end_date) as event_end,
    e.status::text as event_status,
    COALESCE(eeq.status, 'reserved')::text as assignment_status
  FROM equipment_items ei
  LEFT JOIN event_equipment eeq ON eeq.equipment_id = ei.id
  LEFT JOIN events e ON e.id = eeq.event_id AND e.status != 'cancelled'
  LEFT JOIN event_phases ep ON ep.id = (
    SELECT ep2.id FROM event_phases ep2
    WHERE ep2.event_id = e.id
    ORDER BY ep2.work_start_datetime ASC
    LIMIT 1
  )
  WHERE ei.status IN ('available', 'in_use')
    AND (
      eeq.id IS NULL
      OR (
        COALESCE(ep.work_end_datetime, e.event_end_datetime, e.event_end_date) >= p_start_date
        AND COALESCE(ep.work_start_datetime, e.event_start_datetime, e.event_date) <= p_end_date
        AND COALESCE(eeq.status, 'reserved') != 'cancelled'
      )
    )

  ORDER BY resource_type, resource_name, event_start;
END;
$$;

COMMENT ON FUNCTION get_calendar_timeline_resources IS 'Pobiera wszystkie zasoby (pojazdy, pracownicy, sprzęt) wraz z ich przypisaniami do wydarzeń dla widoku Timeline w kalendarzu';
