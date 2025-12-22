/*
  # Fix Calendar RLS to Check Admin Permission

  1. Changes
    - Update events SELECT policy to check for 'admin' in permissions array
    - Update meetings SELECT policy to check for 'admin' in permissions array
    - Both should check: role = 'admin' OR 'admin' = ANY(permissions)

  2. Security
    - Users with role='admin' OR 'admin' permission see all events/meetings
    - Users with 'calendar_manage' see all events/meetings
    - Users with 'calendar_view' see only their assigned events/meetings
    - Users without calendar permissions see nothing
*/

-- Drop and recreate events SELECT policy
DROP POLICY IF EXISTS "Users can view events based on calendar permissions" ON events;

CREATE POLICY "Users can view events based on calendar permissions"
  ON events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Full access with admin role or permission
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        -- Full access with calendar_manage
        OR 'calendar_manage' = ANY(emp.permissions)
        -- Limited access with calendar_view - only assigned events
        OR (
          'calendar_view' = ANY(emp.permissions)
          AND EXISTS (
            SELECT 1 FROM employee_assignments ea
            WHERE ea.event_id = events.id
            AND ea.employee_id = auth.uid()
            AND ea.status = 'accepted'
          )
        )
      )
    )
  );

-- Drop and recreate meetings SELECT policy
DROP POLICY IF EXISTS "Users can view meetings based on calendar permissions" ON meetings;

CREATE POLICY "Users can view meetings based on calendar permissions"
  ON meetings FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Full access with admin role or permission
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        -- Full access with calendar_manage
        OR 'calendar_manage' = ANY(emp.permissions)
        -- Limited access with calendar_view - only meetings they participate in
        OR (
          'calendar_view' = ANY(emp.permissions)
          AND (
            meetings.created_by = auth.uid()
            OR EXISTS (
              SELECT 1 FROM meeting_participants mp
              WHERE mp.meeting_id = meetings.id
              AND mp.employee_id = auth.uid()
            )
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view events based on calendar permissions" ON events IS
  'Kontroluje dostęp do wydarzeń: admin/calendar_manage widzą wszystko, calendar_view tylko przypisane wydarzenia';

COMMENT ON POLICY "Users can view meetings based on calendar permissions" ON meetings IS
  'Kontroluje dostęp do spotkań: admin/calendar_manage widzą wszystko, calendar_view tylko swoje spotkania';
