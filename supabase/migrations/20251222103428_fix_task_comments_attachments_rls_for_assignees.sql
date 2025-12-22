/*
  # Fix Task Comments and Attachments RLS for Assigned Users

  1. Changes
    - Update SELECT policies for task_comments and task_attachments
    - Allow assigned users to view comments and attachments
    - Maintain security while enabling collaboration

  2. Security
    - Users can only see comments/attachments for tasks they have access to
    - Includes task creators, assignees, and users with permissions
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view task comments" ON task_comments;
DROP POLICY IF EXISTS "Users can view task attachments" ON task_attachments;

-- Task Comments SELECT: Allow users with task access
CREATE POLICY "Users can view task comments"
  ON task_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        -- Has tasks_view or tasks_manage permission
        'tasks_view' = ANY(employees.permissions)
        OR 'tasks_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    )
    OR
    -- Is assigned to this task
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = task_comments.task_id
      AND task_assignees.employee_id = auth.uid()
    )
    OR
    -- Is the task creator
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_comments.task_id
      AND tasks.created_by = auth.uid()
    )
    OR
    -- Is the task owner (for private tasks)
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_comments.task_id
      AND tasks.is_private = true
      AND tasks.owner_id = auth.uid()
    )
  );

-- Task Attachments SELECT: Allow users with task access
CREATE POLICY "Users can view task attachments"
  ON task_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        -- Has tasks_view or tasks_manage permission
        'tasks_view' = ANY(employees.permissions)
        OR 'tasks_manage' = ANY(employees.permissions)
        OR employees.role = 'admin'
      )
    )
    OR
    -- Is assigned to this task
    EXISTS (
      SELECT 1 FROM task_assignees
      WHERE task_assignees.task_id = task_attachments.task_id
      AND task_assignees.employee_id = auth.uid()
    )
    OR
    -- Is the task creator
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_attachments.task_id
      AND tasks.created_by = auth.uid()
    )
    OR
    -- Is the task owner (for private tasks)
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_attachments.task_id
      AND tasks.is_private = true
      AND tasks.owner_id = auth.uid()
    )
  );
