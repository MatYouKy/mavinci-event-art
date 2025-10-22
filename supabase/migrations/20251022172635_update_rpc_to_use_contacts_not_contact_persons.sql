/*
  # Aktualizacja RPC - użycie contacts zamiast contact_persons
*/

DROP FUNCTION IF EXISTS get_events_list(timestamptz, timestamptz, text[]);
DROP FUNCTION IF EXISTS get_event_details(uuid);

CREATE FUNCTION get_events_list(
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

CREATE FUNCTION get_event_details(event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  event_data jsonb;
BEGIN
  SELECT to_jsonb(e.*) INTO event_data
  FROM events e
  WHERE e.id = event_id;

  IF event_data IS NULL THEN
    RETURN jsonb_build_object('error', 'Event not found');
  END IF;

  result := jsonb_build_object(
    'event', event_data,
    'organization', (
      SELECT to_jsonb(o.*)
      FROM organizations o
      WHERE o.id = (event_data->>'organization_id')::uuid
    ),
    'contact_person', (
      SELECT jsonb_build_object(
        'id', c.id,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'full_name', c.full_name,
        'email', c.email,
        'phone', c.phone,
        'mobile', c.mobile
      )
      FROM contacts c
      WHERE c.id = (event_data->>'contact_person_id')::uuid
    ),
    'category', (
      SELECT jsonb_build_object(
        'id', ec.id,
        'name', ec.name,
        'color', ec.color,
        'description', ec.description,
        'icon', CASE
          WHEN ci.id IS NOT NULL THEN jsonb_build_object(
            'id', ci.id,
            'name', ci.name,
            'svg_code', ci.svg_code,
            'preview_color', ci.preview_color
          )
          ELSE NULL
        END
      )
      FROM event_categories ec
      LEFT JOIN custom_icons ci ON ci.id = ec.icon_id
      WHERE ec.id = (event_data->>'category_id')::uuid
    ),
    'creator', (
      SELECT jsonb_build_object(
        'id', emp.id,
        'name', emp.name,
        'surname', emp.surname,
        'avatar_url', emp.avatar_url
      )
      FROM employees emp
      WHERE emp.id = (event_data->>'created_by')::uuid
    ),
    'employees', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ea.id,
          'employee_id', ea.employee_id,
          'role', ea.role,
          'responsibilities', ea.responsibilities,
          'status', ea.status,
          'invited_at', ea.invited_at,
          'responded_at', ea.responded_at,
          'notes', ea.notes,
          'can_invite_members', ea.can_invite_members,
          'employee', jsonb_build_object(
            'id', emp.id,
            'name', emp.name,
            'surname', emp.surname,
            'nickname', emp.nickname,
            'occupation', emp.occupation,
            'avatar_url', emp.avatar_url,
            'avatar_metadata', emp.avatar_metadata,
            'email', emp.email,
            'phone_number', emp.phone_number
          )
        ) ORDER BY ea.invited_at
      ), '[]'::jsonb)
      FROM employee_assignments ea
      LEFT JOIN employees emp ON emp.id = ea.employee_id
      WHERE ea.event_id = event_id
    ),
    'equipment', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ee.id,
          'equipment_id', ee.equipment_id,
          'kit_id', ee.kit_id,
          'quantity', ee.quantity,
          'notes', ee.notes,
          'status', ee.status
        ) ORDER BY ee.created_at
      ), '[]'::jsonb)
      FROM event_equipment ee
      WHERE ee.event_id = event_id
    ),
    'vehicles', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', ev.id,
          'vehicle_id', ev.vehicle_id,
          'driver_id', ev.driver_id
        ) ORDER BY ev.created_at
      ), '[]'::jsonb)
      FROM event_vehicles ev
      WHERE ev.event_id = event_id
    ),
    'offers', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'offer_number', o.offer_number,
          'created_at', o.created_at,
          'status', o.status
        ) ORDER BY o.created_at DESC
      ), '[]'::jsonb)
      FROM offers o
      WHERE o.event_id = event_id
    )
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_events_list(timestamptz, timestamptz, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION get_event_details(uuid) TO authenticated;
