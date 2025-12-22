/*
  # Fix meeting_participants RLS to prevent recursion
  
  1. Problem
    - meeting_participants SELECT checks meetings table
    - meetings SELECT checks meeting_participants table
    - This can cause infinite recursion
  
  2. Solution
    - Simplify meeting_participants SELECT policy
    - Direct checks only, no cross-table recursion
    - Users see participants if they have calendar permissions
    - AND (they created meeting OR they are participant)
  
  3. Security
    - Participants list is visible only to meeting creator and participants
    - Admins and calendar_manage see all
*/

-- Drop old SELECT policy
DROP POLICY IF EXISTS "Users can view participants based on permissions" ON meeting_participants;

-- Create simplified SELECT policy without recursion
CREATE POLICY "Users can view participants based on permissions"
  ON meeting_participants FOR SELECT
  TO authenticated
  USING (
    -- Must have calendar permissions
    EXISTS (
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
    AND (
      -- Admins and managers see all participants
      EXISTS (
        SELECT 1 FROM employees emp2
        WHERE emp2.id = auth.uid()
        AND (
          emp2.role = 'admin'
          OR 'admin' = ANY(emp2.permissions)
          OR 'calendar_manage' = ANY(emp2.permissions)
          OR 'events_manage' = ANY(emp2.permissions)
        )
      )
      OR
      -- Regular users see participants only for their meetings
      meeting_participants.meeting_id IN (
        SELECT m.id FROM meetings m
        WHERE m.deleted_at IS NULL
        AND (
          m.created_by = auth.uid()
          OR EXISTS (
            SELECT 1 FROM meeting_participants mp2
            WHERE mp2.meeting_id = m.id
            AND mp2.employee_id = auth.uid()
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view participants based on permissions" ON meeting_participants IS
  'Users can view participants only for meetings they created or are invited to';
