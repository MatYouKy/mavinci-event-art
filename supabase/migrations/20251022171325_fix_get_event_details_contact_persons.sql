/*
  # Naprawa get_event_details - contact_persons
*/

CREATE OR REPLACE FUNCTION get_event_details(event_id uuid)
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
        'id', cp.id,
        'first_name', cp.first_name,
        'last_name', cp.last_name,
        'full_name', COALESCE(cp.first_name || ' ' || cp.last_name, cp.first_name, cp.last_name),
        'email', cp.email,
        'phone', cp.phone
      )
      FROM contact_persons cp
      WHERE cp.id = (event_data->>'contact_person_id')::uuid
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

GRANT EXECUTE ON FUNCTION get_event_details(uuid) TO authenticated;
