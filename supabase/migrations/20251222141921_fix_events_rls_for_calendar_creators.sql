/*
  # Fix events RLS - allow calendar users to see events they created
  
  Problem: Users with calendar_view can't see events they created unless they also have events_view
  
  Solution: Anyone with calendar permissions can see:
  - All events if they have manage permissions
  - Events they created
  - Events they are assigned to
*/

DROP POLICY IF EXISTS "Users can view events based on calendar permissions" ON events;

CREATE POLICY "Users can view events based on calendar permissions"
  ON events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Full access
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        OR 'events_manage' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        
        -- Limited access: see own events or assigned events
        OR (
          (
            'events_view' = ANY(emp.permissions)
            OR 'calendar_view' = ANY(emp.permissions)
          )
          AND (
            events.created_by = auth.uid()
            OR EXISTS (
              SELECT 1
              FROM employee_assignments ea
              WHERE ea.event_id = events.id
              AND ea.employee_id = auth.uid()
            )
          )
        )
        
        -- Anyone can see events they created (even without specific permissions)
        OR events.created_by = auth.uid()
      )
    )
  );

COMMENT ON POLICY "Users can view events based on calendar permissions" ON events IS 
'Users can view events based on their permissions. Anyone can see events they created.';
