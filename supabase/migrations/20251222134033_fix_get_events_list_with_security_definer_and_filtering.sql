/*
  # Fix get_events_list - use SECURITY DEFINER with internal filtering
  
  1. Problem
    - SECURITY INVOKER doesn't work - users see 0 events
    - Need to bypass RLS to query tables but filter results based on permissions
  
  2. Solution
    - Use SECURITY DEFINER to bypass RLS
    - Check user permissions inside function
    - Filter events based on user's access level
    - Admins/calendar_manage see all
    - Others see only events they created or are assigned to
  
  3. Security
    - All filtering logic is in the function
    - Users cannot see events they shouldn't have access to
*/

DROP FUNCTION IF EXISTS get_events_list(timestamp with time zone, timestamp with time zone, text[]);

CREATE OR REPLACE FUNCTION get_events_list(
  start_date timestamp with time zone DEFAULT NULL,
  end_date timestamp with time zone DEFAULT NULL,
  status_filter text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
  current_user_id uuid;
  has_full_access boolean;
BEGIN
  -- Get current user ID
  current_user_id := auth.uid();
  
  -- Check if user has full access (admin or calendar_manage)
  SELECT EXISTS (
    SELECT 1
    FROM employees emp
    WHERE emp.id = current_user_id
    AND (
      emp.role = 'admin'
      OR 'admin' = ANY(emp.permissions)
      OR 'events_manage' = ANY(emp.permissions)
      OR 'calendar_manage' = ANY(emp.permissions)
    )
  ) INTO has_full_access;

  result := (
    SELECT COALESCE(jsonb_agg(event_data ORDER BY event_date), '[]'::jsonb)
    FROM (
      -- Events from events table
      SELECT
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
          'is_meeting', false,
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
          )
        ) as event_data,
        e.event_date
      FROM events e
      LEFT JOIN organizations o ON o.id = e.organization_id
      LEFT JOIN contacts c ON c.id = e.contact_person_id
      LEFT JOIN event_categories ec ON ec.id = e.category_id
      LEFT JOIN custom_icons ci ON ci.id = ec.icon_id
      WHERE 
        (start_date IS NULL OR e.event_date >= start_date)
        AND (end_date IS NULL OR e.event_date <= end_date)
        AND (status_filter IS NULL OR e.status::text = ANY(status_filter))
        -- Security filter: admins see all, others see only their events or assigned events
        AND (
          has_full_access = true
          OR e.created_by = current_user_id
          OR EXISTS (
            SELECT 1
            FROM employee_assignments ea
            WHERE ea.event_id = e.id
            AND ea.employee_id = current_user_id
          )
        )

      UNION ALL

      -- Meetings from meetings table
      SELECT
        jsonb_build_object(
          'id', m.id,
          'name', m.title,
          'description', m.notes,
          'event_date', m.datetime_start,
          'event_end_date', m.datetime_end,
          'location', COALESCE(loc.name, m.location_text, ''),
          'status', 'scheduled',
          'budget', NULL,
          'final_cost', NULL,
          'notes', m.notes,
          'category_id', NULL,
          'organization_id', NULL,
          'contact_person_id', NULL,
          'created_by', m.created_by,
          'created_at', m.created_at,
          'is_meeting', true,
          'organization', NULL,
          'contact_person', NULL,
          'category', NULL,
          'meeting_data', jsonb_build_object(
            'notes', m.notes,
            'meeting_participants', (
              SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                  'employee_id', mp.employee_id,
                  'name', emp.name,
                  'surname', emp.surname
                )
              ), '[]'::jsonb)
              FROM meeting_participants mp
              LEFT JOIN employees emp ON emp.id = mp.employee_id
              WHERE mp.meeting_id = m.id
            )
          ),
          'assigned_employees', (
            SELECT COALESCE(jsonb_agg(
              jsonb_build_object(
                'id', emp.id,
                'name', emp.name,
                'surname', emp.surname
              )
            ), '[]'::jsonb)
            FROM meeting_participants mp
            JOIN employees emp ON emp.id = mp.employee_id
            WHERE mp.meeting_id = m.id
          )
        ) as event_data,
        m.datetime_start as event_date
      FROM meetings m
      LEFT JOIN locations loc ON loc.id = m.location_id
      WHERE 
        (start_date IS NULL OR m.datetime_start >= start_date)
        AND (end_date IS NULL OR m.datetime_start <= end_date)
        AND m.deleted_at IS NULL
        -- Security filter: admins see all, others see only their meetings or where they are participants
        AND (
          has_full_access = true
          OR m.created_by = current_user_id
          OR EXISTS (
            SELECT 1
            FROM meeting_participants mp
            WHERE mp.meeting_id = m.id
            AND mp.employee_id = current_user_id
          )
        )
    ) combined_events
  );

  RETURN result;
END;
$$;

COMMENT ON FUNCTION get_events_list IS 'Returns filtered list of events and meetings based on user permissions - secure version';
