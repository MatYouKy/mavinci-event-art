/*
  # Fix meeting_participants infinite recursion
  
  Problem: Policy checks meetings table which checks meeting_participants - infinite loop
  
  Solution: Simplify policies to avoid circular dependencies
  - Remove checks that query other tables
  - Use direct column checks only
*/

-- Drop all existing policies
DROP POLICY IF EXISTS "Users can view participants based on permissions" ON meeting_participants;
DROP POLICY IF EXISTS "Users can add participants to their meetings" ON meeting_participants;
DROP POLICY IF EXISTS "Users can update participants in their meetings" ON meeting_participants;
DROP POLICY IF EXISTS "Users can remove participants from their meetings" ON meeting_participants;

-- Simple SELECT policy - no joins to meetings table
CREATE POLICY "Users can view meeting participants"
  ON meeting_participants
  FOR SELECT
  TO authenticated
  USING (
    -- User is the participant
    employee_id = auth.uid()
    OR contact_id = auth.uid()
    -- User has calendar permissions (no subqueries to meetings)
    OR EXISTS (
      SELECT 1
      FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        OR 'calendar_view' = ANY(emp.permissions)
      )
    )
  );

-- Simple INSERT policy
CREATE POLICY "Users can add meeting participants"
  ON meeting_participants
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'calendar_manage' = ANY(emp.permissions)
        OR 'calendar_view' = ANY(emp.permissions)
      )
    )
  );

-- Simple UPDATE policy
CREATE POLICY "Users can update meeting participants"
  ON meeting_participants
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'calendar_manage' = ANY(emp.permissions)
      )
    )
  );

-- Simple DELETE policy
CREATE POLICY "Users can delete meeting participants"
  ON meeting_participants
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'calendar_manage' = ANY(emp.permissions)
      )
    )
  );

COMMENT ON POLICY "Users can view meeting participants" ON meeting_participants IS 
'Users can see meeting participants if they are participants themselves or have calendar permissions';
