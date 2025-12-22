/*
  # Fix meeting_participants RLS for nested queries
  
  Problem: Nested queries in Supabase API (meetings -> meeting_participants -> employees)
  are blocked by RLS even when user has access to the meeting.
  
  Solution: Allow users to view participants of meetings they have access to.
*/

DROP POLICY IF EXISTS "Users can view participants based on permissions" ON meeting_participants;

CREATE POLICY "Users can view participants based on permissions"
  ON meeting_participants
  FOR SELECT
  TO authenticated
  USING (
    -- Allow if user can see the meeting (reuse meetings RLS logic)
    EXISTS (
      SELECT 1
      FROM meetings m
      WHERE m.id = meeting_participants.meeting_id
      AND m.deleted_at IS NULL
      AND (
        m.created_by = auth.uid()
        OR meeting_participants.employee_id = auth.uid()
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
    )
  );

COMMENT ON POLICY "Users can view participants based on permissions" ON meeting_participants IS 
'Users can view participants of meetings they created, are part of, or have admin/calendar_manage permissions';
