/*
  # Create Task Comments and Attachments System

  1. New Tables
    - `task_comments`
      - `id` (uuid, primary key)
      - `task_id` (uuid, foreign key to tasks)
      - `employee_id` (uuid, foreign key to employees)
      - `content` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `task_attachments`
      - `id` (uuid, primary key)
      - `task_id` (uuid, foreign key to tasks)
      - `file_name` (text)
      - `file_url` (text)
      - `file_type` (text)
      - `file_size` (bigint)
      - `uploaded_by` (uuid, foreign key to employees)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Add policies for authenticated users to read their task comments/attachments
    - Add policies for assigned users to create comments/attachments
*/

CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_employee_id ON task_comments(employee_id);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'task_comments'
    AND policyname = 'Users can view task comments'
  ) THEN
    CREATE POLICY "Users can view task comments"
      ON task_comments FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.id = task_comments.task_id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'task_comments'
    AND policyname = 'Users can add comments to tasks'
  ) THEN
    CREATE POLICY "Users can add comments to tasks"
      ON task_comments FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = employee_id
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.id = task_comments.task_id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'task_comments'
    AND policyname = 'Users can update own comments'
  ) THEN
    CREATE POLICY "Users can update own comments"
      ON task_comments FOR UPDATE
      TO authenticated
      USING (auth.uid() = employee_id)
      WITH CHECK (auth.uid() = employee_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'task_comments'
    AND policyname = 'Users can delete own comments'
  ) THEN
    CREATE POLICY "Users can delete own comments"
      ON task_comments FOR DELETE
      TO authenticated
      USING (auth.uid() = employee_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS task_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  uploaded_by uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_uploaded_by ON task_attachments(uploaded_by);

ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'task_attachments'
    AND policyname = 'Users can view task attachments'
  ) THEN
    CREATE POLICY "Users can view task attachments"
      ON task_attachments FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.id = task_attachments.task_id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'task_attachments'
    AND policyname = 'Users can upload attachments to tasks'
  ) THEN
    CREATE POLICY "Users can upload attachments to tasks"
      ON task_attachments FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() = uploaded_by
        AND EXISTS (
          SELECT 1 FROM tasks
          WHERE tasks.id = task_attachments.task_id
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'task_attachments'
    AND policyname = 'Users can delete own attachments'
  ) THEN
    CREATE POLICY "Users can delete own attachments"
      ON task_attachments FOR DELETE
      TO authenticated
      USING (auth.uid() = uploaded_by);
  END IF;
END $$;
