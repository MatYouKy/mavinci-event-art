/*
  # Add Foreign Keys for Task Comments and Attachments
  
  1. Changes
    - Add foreign key: task_comments.employee_id → employees.id
    - Add foreign key: task_attachments.uploaded_by → employees.id
    
  2. Purpose
    - Enable PostgREST to join tables for fetching employee data
    - Ensure referential integrity
*/

-- Add foreign key for task_comments.employee_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'task_comments_employee_id_fkey'
    AND table_name = 'task_comments'
  ) THEN
    ALTER TABLE task_comments
    ADD CONSTRAINT task_comments_employee_id_fkey
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add foreign key for task_attachments.uploaded_by
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'task_attachments_uploaded_by_fkey'
    AND table_name = 'task_attachments'
  ) THEN
    ALTER TABLE task_attachments
    ADD CONSTRAINT task_attachments_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES employees(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_task_comments_employee_id ON task_comments(employee_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_uploaded_by ON task_attachments(uploaded_by);
