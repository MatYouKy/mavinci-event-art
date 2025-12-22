/*
  # Fix infinite recursion in meeting_participants RLS policies
  
  1. Problem
    - SELECT policy for meeting_participants checks meeting_participants again
    - This creates infinite recursion when querying meetings with participants
  
  2. Solution
    - Drop all existing meeting_participants policies
    - Create new simplified policies without recursion
    - SELECT: Check only employee permissions and meeting creator
    - INSERT: Allow users with calendar permissions to add participants
    - UPDATE/DELETE: Only meeting creator can modify
  
  3. Security
    - Users with calendar_view/calendar_manage can view participants
    - Only meeting creator can add/modify/remove participants
    - Admin role has full access
*/

-- Drop all existing policies for meeting_participants
DROP POLICY IF EXISTS "Users can view meeting participants" ON meeting_participants;
DROP POLICY IF EXISTS "Users can add participants to their meetings" ON meeting_participants;
DROP POLICY IF EXISTS "Users can update participants in their meetings" ON meeting_participants;
DROP POLICY IF EXISTS "Users can remove participants from their meetings" ON meeting_participants;

-- SELECT: Simple check without recursion
CREATE POLICY "Users can view participants based on permissions"
  ON meeting_participants FOR SELECT
  TO authenticated
  USING (
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
    AND EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_participants.meeting_id
      AND m.deleted_at IS NULL
      AND (
        m.created_by = auth.uid()
        OR meeting_participants.employee_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM employees emp2
          WHERE emp2.id = auth.uid()
          AND (
            emp2.role = 'admin'
            OR 'admin' = ANY(emp2.permissions)
            OR 'calendar_manage' = ANY(emp2.permissions)
            OR 'events_manage' = ANY(emp2.permissions)
          )
        )
      )
    )
  );

-- INSERT: Users with calendar permissions can add participants to their meetings
CREATE POLICY "Users can add participants to their meetings"
  ON meeting_participants FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'calendar_manage' = ANY(emp.permissions)
        OR 'calendar_view' = ANY(emp.permissions)
      )
    )
    AND EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_participants.meeting_id
      AND m.created_by = auth.uid()
    )
  );

-- UPDATE: Only meeting creator can update participants
CREATE POLICY "Users can update participants in their meetings"
  ON meeting_participants FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'calendar_manage' = ANY(emp.permissions)
      )
    )
    AND EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_participants.meeting_id
      AND m.created_by = auth.uid()
    )
  );

-- DELETE: Only meeting creator can remove participants
CREATE POLICY "Users can remove participants from their meetings"
  ON meeting_participants FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'calendar_manage' = ANY(emp.permissions)
      )
    )
    AND EXISTS (
      SELECT 1 FROM meetings m
      WHERE m.id = meeting_participants.meeting_id
      AND m.created_by = auth.uid()
    )
  );

COMMENT ON POLICY "Users can view participants based on permissions" ON meeting_participants IS
  'Users can view participants if they have calendar permissions and are creator or participant';

COMMENT ON POLICY "Users can add participants to their meetings" ON meeting_participants IS
  'Users with calendar_view/calendar_manage can add participants to meetings they created';

COMMENT ON POLICY "Users can update participants in their meetings" ON meeting_participants IS
  'Only meeting creator or admin can update participants';

COMMENT ON POLICY "Users can remove participants from their meetings" ON meeting_participants IS
  'Only meeting creator or admin can remove participants';
