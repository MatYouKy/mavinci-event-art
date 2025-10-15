/*
  # Enhanced Tasks System with Kanban Board

  ## Overview
  Comprehensive task management system with Kanban board, multiple assignees, and scope-based permissions.

  ## Changes Made

  ### 1. Tasks Table Enhancement
  - Add `created_by` field to track task author
  - Modify `assigned_to` to be nullable (will use task_assignees for multiple assignments)
  - Add `order_index` for Kanban column ordering
  - Add `column` field for Kanban board organization

  ### 2. New Tables
  - `task_assignees` - Many-to-many relationship for assigning multiple employees to a task
  - `task_comments` - Comments on tasks
  - `task_attachments` - File attachments for tasks

  ### 3. Security (RLS)
  - Scope-based permissions for tasks module
  - Users can only view/edit tasks based on their permissions
  - Task creators and assignees have automatic access

  ### 4. Indexes
  - Performance indexes for common queries
*/

-- Add created_by to tasks table
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Add order_index for Kanban ordering
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS order_index integer DEFAULT 0;

-- Add board_column for Kanban board (todo, in_progress, review, completed)
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS board_column text DEFAULT 'todo';

-- Create task_assignees table for multiple assignees
CREATE TABLE IF NOT EXISTS task_assignees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assigned_at timestamptz DEFAULT now(),
  assigned_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  UNIQUE(task_id, employee_id)
);

-- Create task_comments table
CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create task_attachments table
CREATE TABLE IF NOT EXISTS task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_size integer,
  file_type text,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- Drop old policies
DROP POLICY IF EXISTS "Authenticated users can view tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can insert tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can update tasks" ON tasks;
DROP POLICY IF EXISTS "Authenticated users can delete tasks" ON tasks;

-- Create new RLS policies for tasks with scope-based permissions

-- SELECT: Users with tasks_view permission OR creators OR assignees can view
CREATE POLICY "Users can view tasks based on scope"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_view' = ANY(employees.permissions)
        OR tasks.created_by = employees.id
        OR tasks.id IN (
          SELECT task_id FROM task_assignees WHERE employee_id = employees.id
        )
      )
    )
  );

-- INSERT: Users with tasks_create permission can create
CREATE POLICY "Users with tasks_create can insert tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'tasks_create' = ANY(employees.permissions)
    )
  );

-- UPDATE: Users with tasks_manage OR creators OR assignees can update
CREATE POLICY "Users can update tasks based on scope"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR tasks.created_by = employees.id
        OR tasks.id IN (
          SELECT task_id FROM task_assignees WHERE employee_id = employees.id
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'tasks_manage' = ANY(employees.permissions)
        OR tasks.created_by = employees.id
      )
    )
  );

-- DELETE: Only users with tasks_manage permission can delete
CREATE POLICY "Users with tasks_manage can delete tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'tasks_manage' = ANY(employees.permissions)
    )
  );

-- RLS Policies for task_assignees
CREATE POLICY "Users can view task assignees if they can view the task"
  ON task_assignees FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_assignees.task_id
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          'tasks_view' = ANY(employees.permissions)
          OR tasks.created_by = employees.id
          OR tasks.id IN (
            SELECT ta.task_id FROM task_assignees ta WHERE ta.employee_id = employees.id
          )
        )
      )
    )
  );

CREATE POLICY "Task creators and managers can assign users"
  ON task_assignees FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_assignees.task_id
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          'tasks_manage' = ANY(employees.permissions)
          OR tasks.created_by = employees.id
        )
      )
    )
  );

CREATE POLICY "Task creators and managers can remove assignees"
  ON task_assignees FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_assignees.task_id
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          'tasks_manage' = ANY(employees.permissions)
          OR tasks.created_by = employees.id
        )
      )
    )
  );

-- RLS Policies for task_comments
CREATE POLICY "Users can view comments on tasks they can view"
  ON task_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_comments.task_id
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          'tasks_view' = ANY(employees.permissions)
          OR tasks.created_by = employees.id
          OR tasks.id IN (
            SELECT task_id FROM task_assignees WHERE employee_id = employees.id
          )
        )
      )
    )
  );

CREATE POLICY "Users can add comments to tasks they can view"
  ON task_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_comments.task_id
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          'tasks_view' = ANY(employees.permissions)
          OR tasks.created_by = employees.id
          OR tasks.id IN (
            SELECT task_id FROM task_assignees WHERE employee_id = employees.id
          )
        )
      )
    )
  );

CREATE POLICY "Users can update their own comments"
  ON task_comments FOR UPDATE
  TO authenticated
  USING (employee_id = auth.uid())
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Users can delete their own comments or if they manage tasks"
  ON task_comments FOR DELETE
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'tasks_manage' = ANY(employees.permissions)
    )
  );

-- RLS Policies for task_attachments
CREATE POLICY "Users can view attachments on tasks they can view"
  ON task_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_attachments.task_id
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          'tasks_view' = ANY(employees.permissions)
          OR tasks.created_by = employees.id
          OR tasks.id IN (
            SELECT task_id FROM task_assignees WHERE employee_id = employees.id
          )
        )
      )
    )
  );

CREATE POLICY "Users can add attachments to tasks they can view"
  ON task_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks
      WHERE tasks.id = task_attachments.task_id
      AND EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND (
          'tasks_view' = ANY(employees.permissions)
          OR tasks.created_by = employees.id
          OR tasks.id IN (
            SELECT task_id FROM task_assignees WHERE employee_id = employees.id
          )
        )
      )
    )
  );

CREATE POLICY "Users can delete their own attachments or if they manage tasks"
  ON task_attachments FOR DELETE
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'tasks_manage' = ANY(employees.permissions)
    )
  );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tasks_created_by ON tasks(created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_board_column ON tasks(board_column);
CREATE INDEX IF NOT EXISTS idx_tasks_order_index ON tasks(order_index);
CREATE INDEX IF NOT EXISTS idx_task_assignees_task_id ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_employee_id ON task_assignees(employee_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);

-- Update existing tasks to have created_by (set to first admin if exists)
UPDATE tasks
SET created_by = (
  SELECT id FROM employees
  WHERE 'admin' = ANY(permissions)
  LIMIT 1
)
WHERE created_by IS NULL;

-- Create a function to automatically set created_by on task creation
CREATE OR REPLACE FUNCTION set_task_creator()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS task_set_creator ON tasks;
CREATE TRIGGER task_set_creator
  BEFORE INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_creator();

-- Update function for updated_at
CREATE OR REPLACE FUNCTION update_task_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_update_timestamp ON tasks;
CREATE TRIGGER task_update_timestamp
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_task_updated_at();
