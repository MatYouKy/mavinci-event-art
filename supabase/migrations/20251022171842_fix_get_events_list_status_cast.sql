/*
  # Naprawa get_events_list - cast status do text
  
  Problem:
  - status jest typu event_status (ENUM)
  - status_filter to text[]
  - Brak cast powoduje błąd "operator does not exist: event_status = text"
*/

CREATE OR REPLACE FUNCTION get_events_list(
  start_date timestamptz DEFAULT NULL,
  end_date timestamptz DEFAULT NULL,
  status_filter text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
          WHEN cp.id IS NOT NULL THEN jsonb_build_object(
            'id', cp.id,
            'first_name', cp.first_name,
            'last_name', cp.last_name,
            'full_name', COALESCE(cp.first_name || ' ' || cp.last_name, cp.first_name, cp.last_name)
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
    LEFT JOIN contact_persons cp ON cp.id = e.contact_person_id
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
