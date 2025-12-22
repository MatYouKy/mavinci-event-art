/*
  # Allow calendar users to see all meetings
  
  1. Change
    - Users with calendar_view or calendar_manage can now see ALL meetings
    - Not just their own meetings
    - This makes sense for team collaboration
  
  2. Reasoning
    - Calendar is a team tool
    - Users need to see all meetings to coordinate
    - Security is maintained through permission checks
*/

-- Drop old policy
DROP POLICY IF EXISTS "Users can view meetings based on permissions" ON meetings;

-- Create new policy allowing calendar users to see all meetings
CREATE POLICY "Users can view meetings based on permissions"
  ON meetings FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        OR 'calendar_view' = ANY(emp.permissions)
        OR 'events_manage' = ANY(emp.permissions)
        OR 'events_view' = ANY(emp.permissions)
      )
    )
  );

COMMENT ON POLICY "Users can view meetings based on permissions" ON meetings IS
  'Users with calendar permissions can view all meetings for team coordination';
