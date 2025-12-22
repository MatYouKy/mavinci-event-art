/*
  # Fix locations RLS for calendar users
  
  Problem: Users with calendar_view can't see location details in their meetings
  because they don't have locations_view permission.
  
  Solution: Allow users with calendar permissions to view locations used in meetings/events.
*/

DROP POLICY IF EXISTS "Users with locations_view can view locations" ON locations;

CREATE POLICY "Users with locations_view can view locations"
  ON locations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'locations_view' = ANY(employees.permissions)
        OR 'locations_manage' = ANY(employees.permissions)
        OR 'admin' = ANY(employees.permissions)
        OR 'calendar_view' = ANY(employees.permissions)
        OR 'calendar_manage' = ANY(employees.permissions)
      )
    )
  );

COMMENT ON POLICY "Users with locations_view can view locations" ON locations IS 
'Users with locations or calendar permissions can view locations';
