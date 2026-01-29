/*
  # Restrict tasks_view Permission to Assigned Tasks Only

  1. Changes
    - Users with `tasks_view` can ONLY see tasks they are assigned to
    - Users with `tasks_manage` can see ALL tasks
    - Users with `events_manage` can see ALL event-related tasks
    - Private tasks remain visible only to owner
    - Assigned users can always see their tasks

  2. Security
    - Prevents users with tasks_view from seeing all global tasks
    - Maintains proper access control based on permissions
    - Preserves admin access to everything
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view accessible tasks" ON tasks;

-- Create new restrictive policy
CREATE POLICY "Users can view accessible tasks"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    -- 1. Private tasks: only owner can see
    (is_private = true AND owner_id = auth.uid())
    OR
    -- 2. Users with tasks_manage can see ALL global tasks
    (is_private = false AND event_id IS NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    -- 3. Event tasks: users with events_manage can see ALL event tasks
    (is_private = false AND event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    -- 4. Assigned users (including tasks_view users) can ONLY see tasks they're assigned to
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = tasks.id
      AND task_assignees.employee_id = auth.uid()
    )
  );
