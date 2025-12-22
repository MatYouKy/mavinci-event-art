/*
  # Fix meeting_participants - allow access without employee record
  
  1. Problem
    - Current policy requires employee record in DB
    - Users without employee record can't see participants
    - Should match meetings policy logic
  
  2. Solution
    - ANY authenticated user can see participants for meetings they created
    - ANY authenticated user can see participants for meetings where they are participant
    - Employees with admin/calendar_manage see ALL participants
  
  3. Security
    - Participants list visible only to meeting creator and other participants
    - No employee record required for own meetings
*/

-- Drop old policy
DROP POLICY IF EXISTS "Users can view participants based on permissions" ON meeting_participants;

-- Create flexible policy matching meetings logic
CREATE POLICY "Users can view participants based on permissions"
  ON meeting_participants FOR SELECT
  TO authenticated
  USING (
    -- 1. User created this meeting (check directly in meetings)
    meeting_participants.meeting_id IN (
      SELECT m.id FROM meetings m
      WHERE m.created_by = auth.uid()
      AND m.deleted_at IS NULL
    )
    OR
    -- 2. User is participant in this meeting
    meeting_participants.employee_id = auth.uid()
    OR
    -- 3. User is admin or has calendar_manage permission
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        OR 'events_manage' = ANY(emp.permissions)
      )
    )
  );

COMMENT ON POLICY "Users can view participants based on permissions" ON meeting_participants IS
  'Users can view participants for meetings they created or are invited to. No employee record required.';
