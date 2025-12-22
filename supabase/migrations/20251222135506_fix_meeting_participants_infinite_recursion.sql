/*
  # Fix infinite recursion in meeting_participants RLS
  
  Problem: Policy references meeting_participants.employee_id inside EXISTS
  which causes Postgres to check the policy again = infinite loop.
  
  Solution: Simplify policy - just check if user can see the meeting,
  don't reference meeting_participants fields in the condition.
*/

DROP POLICY IF EXISTS "Users can view participants based on permissions" ON meeting_participants;

CREATE POLICY "Users can view participants based on permissions"
  ON meeting_participants
  FOR SELECT
  TO authenticated
  USING (
    -- Can view participants if user has admin/calendar permissions
    EXISTS (
      SELECT 1
      FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        OR 'events_manage' = ANY(emp.permissions)
        OR 'calendar_view' = ANY(emp.permissions)
      )
    )
    -- OR if they created the meeting
    OR EXISTS (
      SELECT 1
      FROM meetings m
      WHERE m.id = meeting_participants.meeting_id
      AND m.deleted_at IS NULL
      AND m.created_by = auth.uid()
    )
    -- OR if they are one of the participants (direct check without subquery)
    OR meeting_participants.employee_id = auth.uid()
  );

COMMENT ON POLICY "Users can view participants based on permissions" ON meeting_participants IS 
'Users can view participants if they have calendar permissions, created the meeting, or are participants';
