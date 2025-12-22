/*
  # Allow Users with calendar_view to Create Meetings

  1. Changes
    - Update meetings INSERT policy to allow calendar_view users
    - Keep events INSERT policy restricted to calendar_manage/admin only
    - Users with only calendar_view can ONLY create meetings, not events

  2. Security
    - Events: Only admin or calendar_manage can create
    - Meetings: Any authenticated user with calendar_view can create
*/

-- Drop old meetings INSERT policy
DROP POLICY IF EXISTS "Users with calendar_manage can insert meetings" ON meetings;

-- Create new policy allowing calendar_view users to create meetings
CREATE POLICY "Users with calendar_view can create meetings"
  ON meetings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        'calendar_view' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        OR emp.role = 'admin'
      )
    )
  );

-- Verify policies
SELECT 
  'events' as table_name,
  policyname,
  cmd,
  'Only calendar_manage and admin can INSERT' as expected
FROM pg_policies
WHERE tablename = 'events' AND cmd = 'INSERT'

UNION ALL

SELECT 
  'meetings' as table_name,
  policyname,
  cmd,
  'calendar_view, calendar_manage and admin can INSERT' as expected
FROM pg_policies
WHERE tablename = 'meetings' AND cmd = 'INSERT'
ORDER BY table_name;
