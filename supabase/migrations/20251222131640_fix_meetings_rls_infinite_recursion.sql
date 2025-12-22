/*
  # Fix infinite recursion in meetings RLS policies
  
  1. Problem
    - meetings SELECT policy checks meeting_participants
    - meeting_participants SELECT policy checks meetings
    - This creates infinite recursion loop (42P17 error)
  
  2. Solution
    - Simplify meetings SELECT policy to NOT check meeting_participants
    - Users can view meetings if:
      * They have calendar permissions (admin, calendar_manage, calendar_view)
      * They are the creator (created_by = auth.uid())
    - Participant visibility is handled separately
  
  3. Security
    - Admin and calendar_manage users can see all meetings
    - calendar_view users can see their own created meetings
    - All policies respect deleted_at IS NULL
*/

-- Drop the problematic SELECT policy
DROP POLICY IF EXISTS "Users can view meetings based on permissions" ON meetings;

-- Create new simplified SELECT policy without recursion
CREATE POLICY "Users can view meetings based on permissions"
  ON meetings FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        OR (
          ('calendar_view' = ANY(emp.permissions) OR 'events_view' = ANY(emp.permissions))
          AND meetings.created_by = auth.uid()
        )
      )
    )
  );

-- Add comment explaining the policy
COMMENT ON POLICY "Users can view meetings based on permissions" ON meetings IS
  'Users can view meetings if they have calendar permissions and are creator. Participant check removed to prevent recursion.';

-- Grant necessary permissions to authenticated users
GRANT SELECT ON meetings TO authenticated;
GRANT SELECT ON meeting_participants TO authenticated;
