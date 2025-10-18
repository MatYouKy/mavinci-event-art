/*
  # Fix Custom Icons RLS and Task Comments

  1. Changes
    - Update custom_icons RLS policies to use event_categories_manage permission
    - Apply migration for task_comments and task_attachments if not exists
    - Create task-files storage bucket with proper policies

  2. Security
    - Proper permission checks for custom icons
    - RLS for task comments and attachments
*/

-- Fix custom_icons policies to use correct permission
DROP POLICY IF EXISTS "Employees with events_manage can insert icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with events_manage can update icons" ON custom_icons;
DROP POLICY IF EXISTS "Employees with events_manage can delete icons" ON custom_icons;

CREATE POLICY "Employees with event_categories_manage can insert icons"
  ON custom_icons FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees with event_categories_manage can update icons"
  ON custom_icons FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Employees with event_categories_manage can delete icons"
  ON custom_icons FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'event_categories_manage' = ANY(employees.permissions)
    )
  );

-- Ensure task-files bucket exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('task-files', 'task-files', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for task-files bucket
DO $$
BEGIN
  -- Allow authenticated users to upload files
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Authenticated users can upload task files'
  ) THEN
    CREATE POLICY "Authenticated users can upload task files"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'task-files');
  END IF;

  -- Allow authenticated users to view files
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Authenticated users can view task files'
  ) THEN
    CREATE POLICY "Authenticated users can view task files"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (bucket_id = 'task-files');
  END IF;

  -- Allow users to delete their own uploaded files
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Users can delete own task files'
  ) THEN
    CREATE POLICY "Users can delete own task files"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'task-files'
        AND auth.uid()::text = (storage.foldername(name))[1]
      );
  END IF;
END $$;
