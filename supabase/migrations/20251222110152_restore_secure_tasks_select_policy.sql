/*
  # Restore Secure Tasks SELECT Policy

  1. Changes
    - Remove debug policy
    - Restore proper secure policy for viewing tasks

  2. Security
    - Users can view tasks based on permissions and assignments
    - Private tasks only visible to owner
    - Event tasks visible to users with events_manage
    - Assigned users can always see their tasks
*/

-- Drop debug policy
DROP POLICY IF EXISTS "DEBUG: All authenticated can view tasks" ON tasks;

-- Restore secure SELECT policy
CREATE POLICY "Users can view accessible tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    -- Private tasks: only owner
    (is_private = true AND owner_id = auth.uid())
    OR
    -- Global tasks: users with permissions
    (is_private = false AND event_id IS NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_view' = ANY(employees.permissions)
        OR 'tasks_manage' = ANY(employees.permissions)
        OR 'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    -- Event tasks: users with events_manage permission
    (is_private = false AND event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    -- Assigned to this task (can always see own assignments)
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = tasks.id
      AND task_assignees.employee_id = auth.uid()
    )
  );
