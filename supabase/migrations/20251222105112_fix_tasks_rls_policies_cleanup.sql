/*
  # Fix Tasks RLS Policies - Cleanup and Simplify

  1. Changes
    - Remove duplicate and conflicting policies
    - Create clean, simple policies for all operations
    - Ensure assigned users can access their tasks

  2. Security
    - Users can view tasks they have access to
    - Users can modify tasks based on their role and assignment
*/

-- Drop all existing conflicting policies
DROP POLICY IF EXISTS "Authenticated users can view all tasks" ON tasks;
DROP POLICY IF EXISTS "Users can view accessible tasks" ON tasks;
DROP POLICY IF EXISTS "Users can insert tasks" ON tasks;
DROP POLICY IF EXISTS "Users can update their tasks" ON tasks;
DROP POLICY IF EXISTS "Users can delete their tasks" ON tasks;
DROP POLICY IF EXISTS "Twórca może usunąć swoje zadanie" ON tasks;
DROP POLICY IF EXISTS "Właściciel może usunąć prywatne zadanie" ON tasks;
DROP POLICY IF EXISTS "Użytkownicy z tasks_manage mogą usuwać zadania" ON tasks;
DROP POLICY IF EXISTS "Przypisani użytkownicy mogą usunąć zadanie" ON tasks;

-- SELECT: Users can view tasks they have access to
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

-- INSERT: Users can create tasks
CREATE POLICY "Users can insert tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Private tasks: owner must be self
    (is_private = true AND owner_id = auth.uid())
    OR
    -- Global tasks: need tasks_manage
    (is_private = false AND event_id IS NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    -- Event tasks: need events_manage
    (is_private = false AND event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
  );

-- UPDATE: Users can update tasks they have access to
CREATE POLICY "Users can update tasks"
  ON tasks FOR UPDATE
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
        'tasks_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    -- Event tasks: users with events_manage
    (is_private = false AND event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    -- Assigned users can update (status, progress, etc)
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = tasks.id
      AND task_assignees.employee_id = auth.uid()
    )
  )
  WITH CHECK (
    -- Same conditions as USING
    (is_private = true AND owner_id = auth.uid())
    OR
    (is_private = false AND event_id IS NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    (is_private = false AND event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = tasks.id
      AND task_assignees.employee_id = auth.uid()
    )
  );

-- DELETE: Users can delete tasks
CREATE POLICY "Users can delete tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    -- Private tasks: only owner
    (is_private = true AND owner_id = auth.uid())
    OR
    -- Global tasks: users with tasks_manage
    (is_private = false AND event_id IS NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
    OR
    -- Event tasks: users with events_manage
    (is_private = false AND event_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'events_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    ))
  );
