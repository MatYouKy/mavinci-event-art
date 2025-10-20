/*
  # Link Task Attachments to Event Files

  1. Zmiany w tabeli `task_attachments`
    - Dodanie kolumny `event_file_id` (nullable) - link do pliku wydarzenia
    - Dodanie kolumny `is_linked` (boolean) - czy to link czy upload
    - Modyfikacja: `file_url` i `file_path` mogą być NULL jeśli `event_file_id` istnieje

  2. Logika
    - Jeśli `event_file_id` istnieje, plik jest linkowany z wydarzenia (nie duplikujemy)
    - Jeśli `event_file_id` jest NULL, plik jest uploadowany bezpośrednio do taska
    - Taski związane z wydarzeniem mogą linkować do plików wydarzenia
    - Taski prywatne (bez event_id) mogą tylko uploadować własne pliki

  3. Constraints
    - CHECK: albo event_file_id albo (file_url i file_path) muszą istnieć
*/

-- Dodaj nowe kolumny
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

-- Dodaj index dla event_file_id
CREATE INDEX IF NOT EXISTS idx_task_attachments_event_file_id ON task_attachments(event_file_id);

-- Modyfikuj constraints - file_url i file_path mogą być NULL jeśli event_file_id istnieje
ALTER TABLE task_attachments
ALTER COLUMN file_url DROP NOT NULL;

-- Dodaj constraint sprawdzający że albo mamy event_file_id albo własny plik
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

-- Utwórz view dla łatwego dostępu do załączników z pełnymi informacjami
CREATE OR REPLACE VIEW task_attachments_with_files AS
SELECT
  ta.id,
  ta.task_id,
  ta.event_file_id,
  ta.is_linked,
  ta.file_name,
  COALESCE(ef.name, ta.file_name) as display_name,
  COALESCE(ef.original_name, ta.file_name) as original_name,
  ta.file_url,
  COALESCE(ef.file_path, ta.file_url) as file_path_resolved,
  ta.file_type,
  COALESCE(ef.mime_type, ta.file_type) as mime_type_resolved,
  ta.file_size,
  COALESCE(ef.file_size, ta.file_size) as file_size_resolved,
  ta.uploaded_by,
  ta.created_at,
  ef.thumbnail_url,
  ef.event_id as linked_event_id,
  ef.folder_id as linked_folder_id
FROM task_attachments ta
LEFT JOIN event_files ef ON ta.event_file_id = ef.id;

-- Grant access to the view
GRANT SELECT ON task_attachments_with_files TO authenticated;

-- Dodaj funkcję helper do linkowania pliku wydarzenia do taska
CREATE OR REPLACE FUNCTION link_event_file_to_task(
  p_task_id uuid,
  p_event_file_id uuid,
  p_employee_id uuid
) RETURNS uuid AS $$
DECLARE
  v_attachment_id uuid;
  v_file_name text;
  v_file_type text;
  v_file_size bigint;
BEGIN
  -- Pobierz informacje o pliku wydarzenia
  SELECT name, mime_type, file_size
  INTO v_file_name, v_file_type, v_file_size
  FROM event_files
  WHERE id = p_event_file_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Event file not found';
  END IF;

  -- Sprawdź czy już nie ma takiego linka
  SELECT id INTO v_attachment_id
  FROM task_attachments
  WHERE task_id = p_task_id
    AND event_file_id = p_event_file_id
    AND is_linked = true;

  IF FOUND THEN
    RETURN v_attachment_id;
  END IF;

  -- Utwórz link do pliku
  INSERT INTO task_attachments (
    task_id,
    event_file_id,
    is_linked,
    file_name,
    file_type,
    file_size,
    uploaded_by
  ) VALUES (
    p_task_id,
    p_event_file_id,
    true,
    v_file_name,
    v_file_type,
    v_file_size,
    p_employee_id
  ) RETURNING id INTO v_attachment_id;

  RETURN v_attachment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION link_event_file_to_task TO authenticated;

COMMENT ON FUNCTION link_event_file_to_task IS
'Linkuje plik wydarzenia do taska. Jeśli link już istnieje, zwraca istniejący ID.';

-- Dodaj trigger do aktualizacji is_linked przy zmianie event_file_id
CREATE OR REPLACE FUNCTION update_task_attachment_is_linked()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.event_file_id IS NOT NULL THEN
    NEW.is_linked := true;
  ELSE
    NEW.is_linked := false;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_task_attachment_is_linked ON task_attachments;
CREATE TRIGGER trigger_update_task_attachment_is_linked
  BEFORE INSERT OR UPDATE ON task_attachments
  FOR EACH ROW
  EXECUTE FUNCTION update_task_attachment_is_linked();
