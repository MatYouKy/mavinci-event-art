/*
  # Fix meetings privacy - show only participant meetings
  
  1. Change
    - Regular users (calendar_view) see ONLY their own meetings
    - "Their own" means: created_by them OR they are participant
    - Admin and calendar_manage still see all meetings
  
  2. Security
    - Meetings are private by default
    - Only participants can see meeting details
    - No infinite recursion - direct participant check
*/

-- Drop old policy
DROP POLICY IF EXISTS "Users can view meetings based on permissions" ON meetings;

-- Create privacy-respecting policy
CREATE POLICY "Users can view meetings based on permissions"
  ON meetings FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      -- Admins and calendar managers see everything
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
      OR
      -- Regular users see only their meetings
      (
        EXISTS (
          SELECT 1 FROM employees emp
          WHERE emp.id = auth.uid()
          AND (
            'calendar_view' = ANY(emp.permissions)
            OR 'events_view' = ANY(emp.permissions)
          )
        )
        AND (
          -- Creator can see their own meetings
          meetings.created_by = auth.uid()
          OR
          -- Participants can see meetings they're invited to
          EXISTS (
            SELECT 1 FROM meeting_participants mp
            WHERE mp.meeting_id = meetings.id
            AND mp.employee_id = auth.uid()
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view meetings based on permissions" ON meetings IS
  'Users can only view meetings they created or are invited to. Admins see all.';
