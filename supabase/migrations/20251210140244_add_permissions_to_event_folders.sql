/*
  # Dodanie kontroli dostępu do folderów wydarzeń
  
  1. Zmiany
    - Dodanie kolumny `required_permission` do `event_folders`
      - Określa wymagane uprawnienie do dostępu do folderu
      - Wartości: null (brak ograniczeń), 'contracts_manage', 'finances_manage', 'offers_create'
    - Dodanie kolumny `is_system_folder` do oznaczenia systemowych folderów (jak "Dokumenty")
  
  2. Aktualizacja RLS
    - Modyfikacja polityki SELECT aby sprawdzać uprawnienia pracowników
    - Pracownicy bez wymaganych uprawnień nie zobaczą folderów chronionych
*/

-- Dodaj kolumnę wymaganego uprawnienia do folderów
ALTER TABLE event_folders 
ADD COLUMN IF NOT EXISTS required_permission text,
ADD COLUMN IF NOT EXISTS is_system_folder boolean DEFAULT false;

-- Dodaj check constraint dla dozwolonych wartości uprawnień
ALTER TABLE event_folders
DROP CONSTRAINT IF EXISTS event_folders_required_permission_check;

ALTER TABLE event_folders
ADD CONSTRAINT event_folders_required_permission_check 
CHECK (required_permission IN ('contracts_manage', 'finances_manage', 'offers_create') OR required_permission IS NULL);

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_event_folders_required_permission ON event_folders(required_permission);

-- Usuń i odtwórz politykę SELECT dla folderów z uwzględnieniem uprawnień
DROP POLICY IF EXISTS "Team members and admins can view folders" ON event_folders;

CREATE POLICY "Team members and admins can view folders with permission check"
  ON event_folders FOR SELECT
  TO authenticated
  USING (
    -- Admin ma dostęp do wszystkiego
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    -- Creator wydarzenia ma dostęp do wszystkiego
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_folders.event_id
      AND events.created_by = auth.uid()
    )
    OR
    (
      -- Członek zespołu z odpowiednimi uprawnieniami
      EXISTS (
        SELECT 1 FROM employee_assignments
        WHERE employee_assignments.event_id = event_folders.event_id
        AND employee_assignments.employee_id = auth.uid()
        AND employee_assignments.status = 'accepted'
      )
      AND
      (
        -- Folder bez ograniczeń - wszyscy członkowie widzą
        event_folders.required_permission IS NULL
        OR
        -- Folder wymaga uprawnień - sprawdź czy pracownik je ma
        EXISTS (
          SELECT 1 FROM employees
          WHERE employees.id = auth.uid()
          AND event_folders.required_permission = ANY(employees.permissions)
        )
      )
    )
  );

-- Dodaj kolumnę do event_files określającą typ dokumentu (dla łatwiejszego filtrowania)
ALTER TABLE event_files
ADD COLUMN IF NOT EXISTS document_type text;

-- Check constraint dla typu dokumentu
ALTER TABLE event_files
DROP CONSTRAINT IF EXISTS event_files_document_type_check;

ALTER TABLE event_files
ADD CONSTRAINT event_files_document_type_check
CHECK (document_type IN ('offer', 'contract', 'invoice', 'agenda', 'other') OR document_type IS NULL);

CREATE INDEX IF NOT EXISTS idx_event_files_document_type ON event_files(document_type);

-- Funkcja pomocnicza do tworzenia/pobierania folderu "Dokumenty"
CREATE OR REPLACE FUNCTION get_or_create_documents_folder(
  p_event_id uuid,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_folder_id uuid;
BEGIN
  -- Sprawdź czy folder już istnieje
  SELECT id INTO v_folder_id
  FROM event_folders
  WHERE event_id = p_event_id
    AND name = 'Dokumenty'
    AND parent_folder_id IS NULL
    AND is_system_folder = true;
  
  -- Jeśli nie istnieje, utwórz
  IF v_folder_id IS NULL THEN
    INSERT INTO event_folders (
      event_id,
      parent_folder_id,
      name,
      path,
      is_system_folder,
      required_permission,
      created_by
    ) VALUES (
      p_event_id,
      NULL,
      'Dokumenty',
      'Dokumenty',
      true,
      NULL,  -- Brak ograniczeń na poziomie głównego folderu
      p_created_by
    )
    RETURNING id INTO v_folder_id;
  END IF;
  
  RETURN v_folder_id;
END;
$$;

-- Funkcja pomocnicza do tworzenia/pobierania podfolderu w "Dokumenty"
CREATE OR REPLACE FUNCTION get_or_create_documents_subfolder(
  p_event_id uuid,
  p_subfolder_name text,
  p_required_permission text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_documents_folder_id uuid;
  v_subfolder_id uuid;
BEGIN
  -- Pobierz/utwórz główny folder Dokumenty
  v_documents_folder_id := get_or_create_documents_folder(p_event_id, p_created_by);
  
  -- Sprawdź czy podfolder już istnieje
  SELECT id INTO v_subfolder_id
  FROM event_folders
  WHERE event_id = p_event_id
    AND name = p_subfolder_name
    AND parent_folder_id = v_documents_folder_id
    AND is_system_folder = true;
  
  -- Jeśli nie istnieje, utwórz
  IF v_subfolder_id IS NULL THEN
    INSERT INTO event_folders (
      event_id,
      parent_folder_id,
      name,
      path,
      is_system_folder,
      required_permission,
      created_by
    ) VALUES (
      p_event_id,
      v_documents_folder_id,
      p_subfolder_name,
      'Dokumenty/' || p_subfolder_name,
      true,
      p_required_permission,
      p_created_by
    )
    RETURNING id INTO v_subfolder_id;
  END IF;
  
  RETURN v_subfolder_id;
END;
$$;
