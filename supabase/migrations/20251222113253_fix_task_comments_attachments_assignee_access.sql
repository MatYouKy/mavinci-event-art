/*
  # Fix Task Comments and Attachments Access for Assignees

  1. Changes
    - Allow assigned users to view and add comments
    - Allow assigned users to view and add attachments
    - Maintain admin/creator delete permissions

  2. Security
    - No circular dependencies
    - Assigned users have read/write access to their task's comments and attachments
*/

-- Drop existing policies for task_comments
DROP POLICY IF EXISTS "Users can view task comments" ON task_comments;
DROP POLICY IF EXISTS "Users can create task comments" ON task_comments;
DROP POLICY IF EXISTS "Users can update own comments" ON task_comments;
DROP POLICY IF EXISTS "Admins and comment creators can delete comments" ON task_comments;
DROP POLICY IF EXISTS "Task creators can delete comments" ON task_comments;

-- Recreate task_comments policies
CREATE POLICY "Users can view task comments if assigned or with permission"
  ON task_comments FOR SELECT
  TO authenticated
  USING (
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
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = task_comments.task_id
      AND task_assignees.employee_id = auth.uid()
    )
  );

CREATE POLICY "Users can create comments if assigned or with permission"
  ON task_comments FOR INSERT
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
    OR
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = task_comments.task_id
      AND task_assignees.employee_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own comments"
  ON task_comments FOR UPDATE
  TO authenticated
  USING (employee_id = auth.uid());

CREATE POLICY "Admins, task creators, and comment creators can delete"
  ON task_comments FOR DELETE
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
    OR
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_comments.task_id
      AND tasks.created_by = auth.uid()
    )
  );

-- Drop existing policies for task_attachments
DROP POLICY IF EXISTS "Users can view task attachments" ON task_attachments;
DROP POLICY IF EXISTS "Users can create task attachments" ON task_attachments;
DROP POLICY IF EXISTS "Users can update own attachments" ON task_attachments;
DROP POLICY IF EXISTS "Admins can delete any attachment" ON task_attachments;
DROP POLICY IF EXISTS "Users can delete own attachments" ON task_attachments;

-- Recreate task_attachments policies
CREATE POLICY "Users can view attachments if assigned or with permission"
  ON task_attachments FOR SELECT
  TO authenticated
  USING (
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
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = task_attachments.task_id
      AND task_assignees.employee_id = auth.uid()
    )
  );

CREATE POLICY "Users can create attachments if assigned or with permission"
  ON task_attachments FOR INSERT
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
    OR
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = task_attachments.task_id
      AND task_assignees.employee_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own attachments or admins all"
  ON task_attachments FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );
