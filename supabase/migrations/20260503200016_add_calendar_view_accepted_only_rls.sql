/*
  # Add calendar_view_accepted_only RLS support

  1. Problem
    - Employees with the new `calendar_view_accepted_only` permission need to SELECT
      accepted events from the events table so they can open event detail pages
      (restricted to the overview tab) even when they are not assigned to the event.

  2. Changes
    - Extend the `Users can view events based on calendar permissions` SELECT policy
      so users holding `calendar_view_accepted_only` can view events with
      status = 'offer_accepted'.
    - Everything else remains identical; admins/managers still see all events;
      assigned users still need ACCEPTED assignments to view other events.

  3. Security notes
    - This permission only grants SELECT access to events that reached
      `status = 'offer_accepted'`. Pending, offer_sent, cancelled, etc. remain hidden.
    - No write access is granted.
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
      emp.role = 'admin'
      OR 'admin' = ANY(emp.permissions)
      OR 'events_manage' = ANY(emp.permissions)
      OR 'calendar_manage' = ANY(emp.permissions)

      OR (
        'calendar_view_accepted_only' = ANY(emp.permissions)
        AND events.status = 'offer_accepted'
      )

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
'Admins and managers see all events. Users with calendar_view_accepted_only see all offer_accepted events. Other viewers only see events they created or are assigned to with ACCEPTED status.';
