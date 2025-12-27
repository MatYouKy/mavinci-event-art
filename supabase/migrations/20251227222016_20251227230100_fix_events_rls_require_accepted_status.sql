/*
  # Napraw RLS wydarzeń - wymagaj statusu "accepted"

  1. Problem
    - Obecna polityka pozwala pracownikom widzieć wydarzenia nawet ze statusem 'pending'
    - Pracownik powinien widzieć tylko wydarzenia gdzie ma status 'accepted'

  2. Rozwiązanie
    - Dodaj sprawdzenie ea.status = 'accepted' w polityce SELECT dla events
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
      -- Full access for admins and managers
      emp.role = 'admin'
      OR 'admin' = ANY(emp.permissions)
      OR 'events_manage' = ANY(emp.permissions)
      OR 'calendar_manage' = ANY(emp.permissions)
      
      -- Limited access for viewers - only events they created or are assigned to with ACCEPTED status
      OR (
        ('events_view' = ANY(emp.permissions) OR 'calendar_view' = ANY(emp.permissions))
        AND (
          events.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM employee_assignments ea
            WHERE ea.event_id = events.id
            AND ea.employee_id = auth.uid()
            AND ea.status = 'accepted'
          )
        )
      )
    )
  )
);

COMMENT ON POLICY "Users can view events based on calendar permissions" ON events IS 
'Admins and managers see all events. Regular users only see events they created or are assigned to with ACCEPTED status.';
