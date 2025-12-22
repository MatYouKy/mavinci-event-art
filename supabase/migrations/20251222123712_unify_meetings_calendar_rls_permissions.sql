/*
  # Unify Meetings and Calendar RLS Permissions

  1. Changes
    - Zaktualizuj RLS dla meetings aby wspierała zarówno events_* jak i calendar_* uprawnienia
    - Spójność z polityką dla events

  2. Security
    - Admin / events_manage / calendar_manage → wszystkie spotkania
    - events_view / calendar_view → tylko spotkania w których uczestniczy lub które utworzył
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view meetings based on calendar permissions" ON meetings;

-- Create unified policy for meetings
CREATE POLICY "Users can view meetings based on permissions"
  ON meetings FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Full access: admin role or admin permission
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        
        -- Full access: events_manage or calendar_manage
        OR 'events_manage' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        
        -- Limited access: events_view or calendar_view - only their meetings
        OR (
          ('events_view' = ANY(emp.permissions) OR 'calendar_view' = ANY(emp.permissions))
          AND (
            -- Meetings created by user
            meetings.created_by = auth.uid()
            OR
            -- Meetings user participates in
            EXISTS (
              SELECT 1 FROM meeting_participants mp
              WHERE mp.meeting_id = meetings.id
              AND mp.employee_id = auth.uid()
            )
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view meetings based on permissions" ON meetings IS
  'Unified policy: admin/events_manage/calendar_manage see all, events_view/calendar_view see only their meetings';
