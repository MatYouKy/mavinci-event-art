/*
  # Fix Meetings RLS for Calendar View Permission

  1. Changes
    - Drop existing SELECT policy for meetings
    - Create new SELECT policy that:
      - Allows users with 'calendar_manage' to see all meetings
      - Allows users with 'calendar_view' to see only meetings they participate in
      - Blocks access for users without calendar permissions

  2. Security
    - Users with 'calendar_manage' see all meetings
    - Users with 'calendar_view' see only their own meetings
    - Users without calendar permissions see no meetings
    - Respects deleted_at soft delete
*/

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users with calendar_manage can view all meetings" ON meetings;

-- Create new SELECT policy with proper permission checks
CREATE POLICY "Users can view meetings based on calendar permissions"
  ON meetings FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Full access with calendar_manage
        'calendar_manage' = ANY(emp.permissions)
        OR emp.role = 'admin'
        -- Limited access with calendar_view - only meetings they participate in
        OR (
          'calendar_view' = ANY(emp.permissions)
          AND (
            meetings.created_by = auth.uid()
            OR EXISTS (
              SELECT 1 FROM meeting_participants mp
              WHERE mp.meeting_id = meetings.id
              AND mp.employee_id = auth.uid()
            )
          )
        )
      )
    )
  );

-- Comment: INSERT, UPDATE and DELETE policies remain unchanged
