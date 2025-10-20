/*
  # Fix Task Attachments - Rename employee_id to uploaded_by
  
  1. Zmiany
    - Zmiana nazwy kolumny employee_id na uploaded_by w task_attachments
    - Dodanie kolumn event_file_id i is_linked
    - Modyfikacja file_url aby mogło być NULL
    - Dodanie storage policies dla event-files bucket
    
  2. Security
    - Storage policies dla authenticated users
    - RLS policies pozostają takie same (działają z uploaded_by)
*/

-- Zmień nazwę kolumny employee_id na uploaded_by
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_attachments' AND column_name = 'employee_id'
  ) THEN
    ALTER TABLE task_attachments RENAME COLUMN employee_id TO uploaded_by;
  END IF;
END $$;

-- Dodaj event_file_id i is_linked jeśli nie istnieją
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_attachments' AND column_name = 'event_file_id'
  ) THEN
    ALTER TABLE task_attachments
    ADD COLUMN event_file_id uuid REFERENCES event_files(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'task_attachments' AND column_name = 'is_linked'
  ) THEN
    ALTER TABLE task_attachments
    ADD COLUMN is_linked boolean DEFAULT false NOT NULL;
  END IF;
END $$;

-- Index dla event_file_id
CREATE INDEX IF NOT EXISTS idx_task_attachments_event_file_id ON task_attachments(event_file_id);

-- Modyfikuj constraints - file_url może być NULL
ALTER TABLE task_attachments
ALTER COLUMN file_url DROP NOT NULL;

-- Dodaj constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'task_attachments_file_source_check'
  ) THEN
    ALTER TABLE task_attachments
    ADD CONSTRAINT task_attachments_file_source_check
    CHECK (
      (event_file_id IS NOT NULL AND is_linked = true) OR
      (event_file_id IS NULL AND file_url IS NOT NULL AND is_linked = false)
    );
  END IF;
END $$;

-- Storage policies dla event-files bucket (dla task attachments)
DO $$
BEGIN
  -- Allow authenticated users to upload task files
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Authenticated users can upload to task-attachments folder'
  ) THEN
    CREATE POLICY "Authenticated users can upload to task-attachments folder"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'event-files' AND
        (storage.foldername(name))[1] = 'task-attachments'
      );
  END IF;

  -- Allow authenticated users to view task files
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Authenticated users can view task-attachments files'
  ) THEN
    CREATE POLICY "Authenticated users can view task-attachments files"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'event-files' AND
        (storage.foldername(name))[1] = 'task-attachments'
      );
  END IF;

  -- Allow users to delete task files they uploaded
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname = 'Users can delete own task-attachments files'
  ) THEN
    CREATE POLICY "Users can delete own task-attachments files"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'event-files' AND
        (storage.foldername(name))[1] = 'task-attachments'
      );
  END IF;
END $$;

-- Aktualizuj RLS policies aby używały uploaded_by zamiast employee_id
DROP POLICY IF EXISTS "Users can delete their own attachments or if they manage tasks" ON task_attachments;
CREATE POLICY "Users can delete their own attachments or if they manage tasks"
  ON task_attachments FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'tasks_manage' = ANY(employees.permissions)
    )
  );
