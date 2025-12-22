/*
  # Fix Task Assignees RLS Circular Dependency

  1. Changes
    - Remove circular dependency in SELECT policy
    - Simplify logic to check directly if user is the assignee
    - Check if user is task creator

  2. Security
    - Users can view assignees for tasks they have access to
    - No circular dependency issues
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view task assignees" ON task_assignees;

-- Create simplified policy without circular dependency
CREATE POLICY "Users can view task assignees"
  ON task_assignees FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        -- Has tasks_view or tasks_manage permission or is admin
        'tasks_view' = ANY(employees.permissions)
        OR 'tasks_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    )
    OR
    -- Is this specific assignee (can see themselves)
    task_assignees.employee_id = auth.uid()
    OR
    -- Is the task creator
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_assignees.task_id
      AND tasks.created_by = auth.uid()
    )
  );
