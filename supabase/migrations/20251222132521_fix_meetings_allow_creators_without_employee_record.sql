/*
  # Fix meetings visibility - allow creators to see their meetings
  
  1. Problem
    - Current policy requires employee record + permissions
    - Users without employee record can't see their own meetings
    - This is too restrictive
  
  2. Solution
    - ANY authenticated user can see meetings they created
    - ANY authenticated user can see meetings where they are participant
    - Employees with calendar_manage/admin see ALL meetings
  
  3. Security
    - Still private - only creator and participants see each meeting
    - Admins and calendar managers see everything
*/

-- Drop old restrictive policy
DROP POLICY IF EXISTS "Users can view meetings based on permissions" ON meetings;

-- Create flexible policy
CREATE POLICY "Users can view meetings based on permissions"
  ON meetings FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      -- 1. User created this meeting (no employee record required)
      created_by = auth.uid()
      OR
      -- 2. User is participant in this meeting (no employee record required)
      EXISTS (
        SELECT 1 FROM meeting_participants mp
        WHERE mp.meeting_id = meetings.id
        AND mp.employee_id = auth.uid()
      )
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
    )
  );

COMMENT ON POLICY "Users can view meetings based on permissions" ON meetings IS
  'Users can view meetings they created or are invited to. No employee record required for own meetings.';
