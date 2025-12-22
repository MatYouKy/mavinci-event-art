/*
  # Simplified Task Assignees RLS Policy

  1. Changes
    - Remove ALL circular dependencies
    - Allow users to see assignees if they have permissions OR if they are the assignee
    - No checks against tasks table to avoid circular dependency

  2. Security
    - Users with tasks_view/tasks_manage can see all assignees
    - Users can always see their own assignments
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view task assignees" ON task_assignees;

-- Create simplified policy - NO circular dependency
CREATE POLICY "Users can view task assignees"
  ON task_assignees FOR SELECT
  TO authenticated
  USING (
    -- Has tasks permissions or is admin
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_view' = ANY(employees.permissions)
        OR 'tasks_manage' = ANY(employees.permissions)
        OR 'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    )
    OR
    -- Is this specific assignee (can always see themselves)
    task_assignees.employee_id = auth.uid()
  );
