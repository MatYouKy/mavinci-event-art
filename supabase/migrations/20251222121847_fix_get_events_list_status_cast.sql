/*
  # Fix get_events_list Status Type Cast

  1. Changes
    - Cast e.status to text when comparing with status_filter array
    - This fixes the "operator does not exist: event_status = text" error

  2. Technical Details
    - The status column is of type event_status (ENUM)
    - The status_filter parameter is text[]
    - Need explicit cast: e.status::text = ANY(status_filter)
*/

-- Drop and recreate the function with proper type casting
CREATE OR REPLACE FUNCTION get_events_list(
  start_date timestamptz DEFAULT NULL,
  end_date timestamptz DEFAULT NULL,
  status_filter text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  result jsonb;
BEGIN
  result := (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', e.id,
        'name', e.name,
        'description', e.description,
        'event_date', e.event_date,
        'event_end_date', e.event_end_date,
        'location', e.location,
        'status', e.status,
        'budget', e.budget,
        'final_cost', e.final_cost,
        'notes', e.notes,
        'category_id', e.category_id,
        'organization_id', e.organization_id,
        'contact_person_id', e.contact_person_id,
        'created_by', e.created_by,
        'created_at', e.created_at,
        'organization', CASE 
          WHEN o.id IS NOT NULL THEN jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'alias', o.alias
          )
          ELSE NULL
        END,
        'contact_person', CASE 
          WHEN c.id IS NOT NULL THEN jsonb_build_object(
            'id', c.id,
            'first_name', c.first_name,
            'last_name', c.last_name,
            'full_name', c.full_name
          )
          ELSE NULL
        END,
        'category', CASE 
          WHEN ec.id IS NOT NULL THEN jsonb_build_object(
            'id', ec.id,
            'name', ec.name,
            'color', ec.color,
            'custom_icon', CASE
              WHEN ci.id IS NOT NULL THEN jsonb_build_object(
                'id', ci.id,
                'name', ci.name,
                'svg_code', ci.svg_code
              )
              ELSE NULL
            END
          )
          ELSE NULL
        END,
        'assigned_employees', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'id', emp.id,
              'name', emp.name,
              'surname', emp.surname
            )
          ), '[]'::jsonb)
          FROM employee_assignments ea
          JOIN employees emp ON emp.id = ea.employee_id
          WHERE ea.event_id = e.id
          AND ea.status = 'accepted'
        ),
        'employees', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'id', ea.id,
              'employee_id', ea.employee_id,
              'role', ea.role,
              'status', ea.status
            )
          ), '[]'::jsonb)
          FROM employee_assignments ea
          WHERE ea.event_id = e.id
        ),
        'vehicles', (
          SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
              'id', ev.id,
              'driver_id', ev.driver_id
            )
          ), '[]'::jsonb)
          FROM event_vehicles ev
          WHERE ev.event_id = e.id
        )
      ) ORDER BY e.event_date
    ), '[]'::jsonb)
    FROM events e
    LEFT JOIN organizations o ON o.id = e.organization_id
    LEFT JOIN contacts c ON c.id = e.contact_person_id
    LEFT JOIN event_categories ec ON ec.id = e.category_id
    LEFT JOIN custom_icons ci ON ci.id = ec.icon_id
    WHERE 
      (start_date IS NULL OR e.event_date >= start_date)
      AND (end_date IS NULL OR e.event_date <= end_date)
      AND (status_filter IS NULL OR e.status::text = ANY(status_filter))
  );

  RETURN result;
END;
$$;

COMMENT ON FUNCTION get_events_list IS 
  'Pobiera listę wydarzeń z pełnymi relacjami. Respektuje RLS - użytkownicy widzą tylko wydarzenia do których mają dostęp.';
