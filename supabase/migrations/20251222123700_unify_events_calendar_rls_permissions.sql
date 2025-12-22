/*
  # Unify Events and Calendar RLS Permissions

  1. Problem
    - /crm/events używa uprawnienia 'events_manage'
    - /crm/calendar używa uprawnienia 'calendar_manage'
    - To powoduje niespójność - różni użytkownicy widzą różne wydarzenia

  2. Solution
    - Zaktualizuj RLS dla events aby wspierała oba zestawy uprawnień:
      * events_manage OR calendar_manage → wszystkie wydarzenia
      * events_view OR calendar_view → tylko przypisane wydarzenia
    - Admin zawsze widzi wszystko

  3. Security
    - Maksymalna dostępność: admin, events_manage, calendar_manage
    - Ograniczona dostępność: events_view, calendar_view (tylko przypisane)
    - Brak uprawnień → nic nie widzi
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view events based on calendar permissions" ON events;

-- Create unified policy supporting both events_* and calendar_* permissions
CREATE POLICY "Users can view events based on permissions"
  ON events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees emp
      WHERE emp.id = auth.uid()
      AND (
        -- Full access: admin role or admin permission
        emp.role = 'admin'
        OR 'admin' = ANY(emp.permissions)
        
        -- Full access: events_manage or calendar_manage
        OR 'events_manage' = ANY(emp.permissions)
        OR 'calendar_manage' = ANY(emp.permissions)
        
        -- Limited access: events_view or calendar_view - only assigned events
        OR (
          ('events_view' = ANY(emp.permissions) OR 'calendar_view' = ANY(emp.permissions))
          AND (
            -- Events created by user
            events.created_by = auth.uid()
            OR
            -- Events assigned to user (any status)
            EXISTS (
              SELECT 1 FROM employee_assignments ea
              WHERE ea.event_id = events.id
              AND ea.employee_id = auth.uid()
            )
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view events based on permissions" ON events IS
  'Unified policy: admin/events_manage/calendar_manage see all, events_view/calendar_view see only assigned or created';
