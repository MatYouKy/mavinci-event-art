/*
  # Fix Task Assignees Circular Dependency

  1. Changes
    - Remove all circular dependencies between tasks and task_assignees
    - Allow employees to delete themselves from tasks
    - Allow assigned employees to view task details even without tasks_view permission

  2. Security
    - task_assignees policies don't check tasks table (breaks circular dependency)
    - tasks policies can check task_assignees (one-way dependency only)
    - Employees can always see and remove their own assignments
*/

-- Drop all existing policies for task_assignees
DROP POLICY IF EXISTS "Users can view accessible task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Users can manage task assignees" ON task_assignees;
DROP POLICY IF EXISTS "Admins can delete any task assignee" ON task_assignees;
DROP POLICY IF EXISTS "Users can delete own assignment" ON task_assignees;
DROP POLICY IF EXISTS "Users can view task assignees simple" ON task_assignees;
DROP POLICY IF EXISTS "Users can insert task assignees with permission" ON task_assignees;
DROP POLICY IF EXISTS "Users can update task assignees with permission" ON task_assignees;
DROP POLICY IF EXISTS "Users can delete task assignees with permission" ON task_assignees;

-- Simple policies for task_assignees without checking tasks table
CREATE POLICY "Users can view own assignments or with permission"
  ON task_assignees FOR SELECT
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR
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
  );

CREATE POLICY "Users can insert assignees with permission"
  ON task_assignees FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR 'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    )
  );

CREATE POLICY "Users can update assignees with permission"
  ON task_assignees FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR 'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    )
  );

CREATE POLICY "Users can delete own assignment"
  ON task_assignees FOR DELETE
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR 'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    )
  );

-- Drop and recreate tasks SELECT policy with assignee access
DROP POLICY IF EXISTS "Users can view accessible tasks" ON tasks;

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
    -- Assigned users can ALWAYS see their tasks (even without permissions)
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = tasks.id
      AND task_assignees.employee_id = auth.uid()
    )
  );
