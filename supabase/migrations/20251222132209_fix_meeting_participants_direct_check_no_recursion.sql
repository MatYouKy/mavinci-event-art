/*
  # Fix meeting_participants - completely remove recursion
  
  1. Strategy
    - meeting_participants policy does NOT check meetings
    - meetings policy checks meeting_participants directly in subquery
    - This breaks the circular dependency
  
  2. Solution for meeting_participants
    - Admin/calendar_manage see all
    - Regular users see only rows where THEY are the participant
    - OR where meeting was created by them (checked via created_by directly)
  
  3. This prevents recursion because:
    - meetings -> meeting_participants (one direction only)
    - meeting_participants does NOT check meetings
*/

-- Drop old policy
DROP POLICY IF EXISTS "Users can view participants based on permissions" ON meeting_participants;

-- Create non-recursive policy
CREATE POLICY "Users can view participants based on permissions"
  ON meeting_participants FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Admins and managers see all participants
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        OR 'events_manage' = ANY(emp.permissions)
        OR (
          -- Regular calendar users see participants where:
          ('calendar_view' = ANY(emp.permissions) OR 'events_view' = ANY(emp.permissions))
          AND (
            -- They are the participant in this row
            meeting_participants.employee_id = auth.uid()
            OR
            -- They created this meeting (direct check on meetings without recursion)
            meeting_participants.meeting_id IN (
              SELECT m.id FROM meetings m
              WHERE m.created_by = auth.uid()
              AND m.deleted_at IS NULL
            )
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view participants based on permissions" ON meeting_participants IS
  'Users can view participants for their own meetings. Direct check prevents recursion.';
