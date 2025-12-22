/*
  # Simplify events RLS for calendar security
  
  1. Problem
    - Current policy is too complex and may allow users to see all events
    - Users with calendar_view should ONLY see events they created or are assigned to
  
  2. Security Rules
    - Admins: see all events
    - calendar_manage: see all events
    - events_manage: see all events
    - calendar_view OR events_view: ONLY events they created OR are assigned to
    - No permissions: no access
  
  3. Changes
    - Drop existing SELECT policy
    - Create new simplified policy with clear logic
*/

DROP POLICY IF EXISTS "Users can view events based on permissions" ON events;

CREATE POLICY "Users can view events based on calendar permissions"
ON events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM employees emp
    WHERE emp.id = auth.uid()
    AND (
      -- Full access for admins and managers
      emp.role = 'admin'
      OR 'admin' = ANY(emp.permissions)
      OR 'events_manage' = ANY(emp.permissions)
      OR 'calendar_manage' = ANY(emp.permissions)
      
      -- Limited access for viewers - only events they created or are assigned to
      OR (
        ('events_view' = ANY(emp.permissions) OR 'calendar_view' = ANY(emp.permissions))
        AND (
          events.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM employee_assignments ea
            WHERE ea.event_id = events.id
            AND ea.employee_id = auth.uid()
          )
        )
      )
    )
  )
);

COMMENT ON POLICY "Users can view events based on calendar permissions" ON events IS 
'Admins and managers see all events. Regular users only see events they created or are assigned to.';
