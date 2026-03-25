/*
  # Fix Timeline Functions - Drop and Recreate

  1. Changes
    - Drop existing functions
    - Recreate with approval_status
*/

-- Drop existing functions
DROP FUNCTION IF EXISTS get_employee_timeline_data(uuid[], timestamptz, timestamptz);
DROP FUNCTION IF EXISTS check_absence_overlap(uuid, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS check_employee_availability(uuid, timestamptz, timestamptz, uuid);

-- Timeline data function (FIXED)
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
    ev.status::text as item_status,
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
    AND eea.invitation_status != 'rejected'
    AND (
      (COALESCE(ep.start_time, ev.start_date) >= p_start_date AND COALESCE(ep.start_time, ev.start_date) <= p_end_date)
      OR (COALESCE(ep.end_time, ev.end_date) >= p_start_date AND COALESCE(ep.end_time, ev.end_date) <= p_end_date)
      OR (COALESCE(ep.start_time, ev.start_date) <= p_start_date AND COALESCE(ep.end_time, ev.end_date) >= p_end_date)
    )

  UNION ALL

  -- Nieobecności (FIXED: użyj approval_status)
  SELECT
    e.id as employee_id,
    (e.name || ' ' || e.surname)::text as employee_name,
    'absence'::text as item_type,
    ea.id as item_id,
    ea.absence_type::text as item_title,
    ea.start_date as item_start,
    ea.end_date as item_end,
    ea.approval_status::text as item_status,
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
    AND ea.approval_status IN ('approved', 'pending')
    AND (
      (ea.start_date >= p_start_date AND ea.start_date <= p_end_date)
      OR (ea.end_date >= p_start_date AND ea.end_date <= p_end_date)
      OR (ea.start_date <= p_start_date AND ea.end_date >= p_end_date)
    )

  ORDER BY employee_id, item_start;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Overlap check function (FIXED)
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
    AND approval_status IN ('approved', 'pending')
    AND (p_absence_id IS NULL OR id != p_absence_id)
    AND (
      (start_date <= p_start_date AND end_date >= p_start_date)
      OR (start_date <= p_end_date AND end_date >= p_end_date)
      OR (start_date >= p_start_date AND end_date <= p_end_date)
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Employee availability check (FIXED)
CREATE OR REPLACE FUNCTION check_employee_availability(
  p_employee_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_event_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_conflicts jsonb := '[]'::jsonb;
  v_event record;
  v_absence record;
BEGIN
  -- Sprawdź konflikty z innymi wydarzeniami
  FOR v_event IN (
    SELECT 
      ev.id,
      ev.name,
      eea.invitation_status,
      COALESCE(ep.start_time, ev.start_date) as event_start,
      COALESCE(ep.end_time, ev.end_date) as event_end
    FROM employee_event_assignments eea
    INNER JOIN events ev ON ev.id = eea.event_id
    LEFT JOIN event_phases ep ON ep.event_id = ev.id
    WHERE eea.employee_id = p_employee_id
      AND ev.deleted_at IS NULL
      AND eea.invitation_status != 'rejected'
      AND (p_event_id IS NULL OR ev.id != p_event_id)
      AND (
        (COALESCE(ep.start_time, ev.start_date) <= p_start_date AND COALESCE(ep.end_time, ev.end_date) >= p_start_date)
        OR (COALESCE(ep.start_time, ev.start_date) <= p_end_date AND COALESCE(ep.end_time, ev.end_date) >= p_end_date)
        OR (COALESCE(ep.start_time, ev.start_date) >= p_start_date AND COALESCE(ep.end_time, ev.end_date) <= p_end_date)
      )
  ) LOOP
    v_conflicts := v_conflicts || jsonb_build_object(
      'type', 'event',
      'id', v_event.id,
      'name', v_event.name,
      'start', v_event.event_start,
      'end', v_event.event_end,
      'status', v_event.invitation_status
    );
  END LOOP;

  -- Sprawdź konflikty z nieobecnościami (FIXED: użyj approval_status)
  FOR v_absence IN (
    SELECT 
      id,
      absence_type,
      start_date,
      end_date,
      approval_status
    FROM employee_absences
    WHERE employee_id = p_employee_id
      AND approval_status IN ('approved', 'pending')
      AND (
        (start_date <= p_start_date AND end_date >= p_start_date)
        OR (start_date <= p_end_date AND end_date >= p_end_date)
        OR (start_date >= p_start_date AND end_date <= p_end_date)
      )
  ) LOOP
    v_conflicts := v_conflicts || jsonb_build_object(
      'type', 'absence',
      'id', v_absence.id,
      'absence_type', v_absence.absence_type,
      'start', v_absence.start_date,
      'end', v_absence.end_date,
      'status', v_absence.approval_status
    );
  END LOOP;

  RETURN jsonb_build_object(
    'has_conflicts', jsonb_array_length(v_conflicts) > 0,
    'conflicts', v_conflicts
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;