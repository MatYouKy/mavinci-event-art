/*
  # Fix Calendar and Events Permissions

  1. Changes
    - Drop existing events SELECT policy
    - Create new SELECT policy that:
      - Allows users with 'calendar_manage' permission to see all events
      - Allows users with 'calendar_view' permission to see only events they are assigned to
      - Blocks access for users without any calendar permissions
    - Update INSERT policy to require 'calendar_manage' permission
    - Keep existing UPDATE and DELETE policies

  2. Security
    - Users with 'calendar_manage' can see all events and create new ones
    - Users with 'calendar_view' can only see events where they are assigned (in employee_assignments table)
    - Users without calendar permissions cannot access events at all
*/

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view all events" ON events;

-- Create new SELECT policy with proper permission checks
CREATE POLICY "Users can view events based on calendar permissions"
  ON events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Full access with calendar_manage
        'calendar_manage' = ANY(emp.permissions)
        OR emp.role = 'admin'
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

-- Update INSERT policy to require calendar_manage
DROP POLICY IF EXISTS "Users with permission can create events" ON events;

CREATE POLICY "Users with calendar_manage can create events"
  ON events FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        'calendar_manage' = ANY(emp.permissions)
        OR emp.role = 'admin'
      )
    )
  );

-- Comment: UPDATE and DELETE policies remain unchanged as they already check proper permissions
