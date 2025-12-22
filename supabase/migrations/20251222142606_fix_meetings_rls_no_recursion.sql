/*
  # Fix meetings RLS - remove infinite recursion
  
  Problem: Meetings SELECT policy checks meeting_participants which causes infinite loop
  
  Solution: Simplify meetings policies to not reference meeting_participants in SELECT
*/

-- Drop existing problematic policies
DROP POLICY IF EXISTS "Users can view meetings based on permissions" ON meetings;
DROP POLICY IF EXISTS "Users can update their own meetings" ON meetings;
DROP POLICY IF EXISTS "Admins can do everything with meetings" ON meetings;

-- Simple SELECT policy - no subqueries to meeting_participants
CREATE POLICY "Users can view meetings"
  ON meetings
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      -- User created the meeting
      created_by = auth.uid()
      -- User has permissions to see all meetings
      OR EXISTS (
        SELECT 1
        FROM employees emp
        WHERE emp.id = auth.uid()
        AND (
          emp.role = 'admin'
          OR 'admin' = ANY(emp.permissions)
          OR 'calendar_manage' = ANY(emp.permissions)
          OR 'events_manage' = ANY(emp.permissions)
        )
      )
    )
  );

-- UPDATE policy
CREATE POLICY "Users can update meetings"
  ON meetings
  FOR UPDATE
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM employees emp
        WHERE emp.id = auth.uid()
        AND (
          emp.role = 'admin'
          OR 'calendar_manage' = ANY(emp.permissions)
        )
      )
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND (
      created_by = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM employees emp
        WHERE emp.id = auth.uid()
        AND (
          emp.role = 'admin'
          OR 'calendar_manage' = ANY(emp.permissions)
        )
      )
    )
  );

-- DELETE policy
CREATE POLICY "Users can delete meetings"
  ON meetings
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

-- Keep the existing INSERT policy
-- DROP POLICY IF EXISTS "Users with calendar_view can create meetings" ON meetings;

COMMENT ON POLICY "Users can view meetings" ON meetings IS 
'Users can view meetings they created or if they have calendar management permissions. Participants see meetings through the get_events_list function.';
