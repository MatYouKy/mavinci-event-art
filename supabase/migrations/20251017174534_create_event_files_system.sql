/*
  # System plików dla wydarzeń

  1. Nowe tabele
    - `event_folders` - Foldery dla plików wydarzeń (struktura drzewa)
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key do events)
      - `parent_folder_id` (uuid, self-reference, null = root)
      - `name` (text)
      - `path` (text) - pełna ścieżka dla łatwiejszego wyszukiwania
      - `created_by` (uuid, foreign key do employees)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      
    - `event_files` - Pliki wydarzeń
      - `id` (uuid, primary key)
      - `event_id` (uuid, foreign key do events)
      - `folder_id` (uuid, foreign key do event_folders, nullable)
      - `name` (text)
      - `original_name` (text)
      - `file_path` (text) - ścieżka w storage
      - `file_size` (bigint)
      - `mime_type` (text)
      - `thumbnail_url` (text, nullable)
      - `uploaded_by` (uuid, foreign key do employees)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS na wszystkich tabelach
    - Polityki dostępu oparte na członkostwie w zespole wydarzenia
    - Admin i creator mają pełny dostęp
    - Członkowie zespołu z can_edit_files mogą dodawać/edytować
    - Wszyscy członkowie mogą przeglądać
*/

-- Event Folders Table
CREATE TABLE IF NOT EXISTS event_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  parent_folder_id uuid REFERENCES event_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  path text NOT NULL,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id, parent_folder_id, name)
);

CREATE INDEX IF NOT EXISTS idx_event_folders_event_id ON event_folders(event_id);
CREATE INDEX IF NOT EXISTS idx_event_folders_parent ON event_folders(parent_folder_id);
CREATE INDEX IF NOT EXISTS idx_event_folders_path ON event_folders(path);

ALTER TABLE event_folders ENABLE ROW LEVEL SECURITY;

-- Event Files Table
CREATE TABLE IF NOT EXISTS event_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES event_folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  original_name text NOT NULL,
  file_path text NOT NULL,
  file_size bigint DEFAULT 0,
  mime_type text,
  thumbnail_url text,
  uploaded_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id, folder_id, name)
);

CREATE INDEX IF NOT EXISTS idx_event_files_event_id ON event_files(event_id);
CREATE INDEX IF NOT EXISTS idx_event_files_folder ON event_files(folder_id);
CREATE INDEX IF NOT EXISTS idx_event_files_uploaded_by ON event_files(uploaded_by);

ALTER TABLE event_files ENABLE ROW LEVEL SECURITY;

-- RLS Policies for event_folders

-- Czytanie: członkowie zespołu i admini
CREATE POLICY "Team members and admins can view folders"
  ON event_folders FOR SELECT
  TO authenticated
  USING (
    -- Admin
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    -- Creator wydarzenia
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_folders.event_id
      AND events.created_by = auth.uid()
    )
    OR
    -- Członek zespołu
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_folders.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
    )
  );

-- Tworzenie: admin, creator, członkowie z can_edit_files
CREATE POLICY "Authorized users can create folders"
  ON event_folders FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Admin
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    -- Creator wydarzenia
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_folders.event_id
      AND events.created_by = auth.uid()
    )
    OR
    -- Członek z uprawnieniem can_edit_files
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_folders.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
      AND employee_assignments.can_edit_files = true
    )
  );

-- Aktualizacja: admin, creator, członkowie z can_edit_files
CREATE POLICY "Authorized users can update folders"
  ON event_folders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_folders.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_folders.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
      AND employee_assignments.can_edit_files = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_folders.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_folders.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
      AND employee_assignments.can_edit_files = true
    )
  );

-- Usuwanie: admin, creator, członkowie z can_edit_files
CREATE POLICY "Authorized users can delete folders"
  ON event_folders FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_folders.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_folders.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
      AND employee_assignments.can_edit_files = true
    )
  );

-- RLS Policies for event_files (identyczne jak dla folders)

CREATE POLICY "Team members and admins can view files"
  ON event_files FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_files.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_files.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
    )
  );

CREATE POLICY "Authorized users can upload files"
  ON event_files FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_files.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_files.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
      AND employee_assignments.can_edit_files = true
    )
  );

CREATE POLICY "Authorized users can update files"
  ON event_files FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_files.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_files.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
      AND employee_assignments.can_edit_files = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_files.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_files.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
      AND employee_assignments.can_edit_files = true
    )
  );

CREATE POLICY "Authorized users can delete files"
  ON event_files FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'events_manage' = ANY(employees.permissions)
    )
    OR
    EXISTS (
      SELECT 1 FROM events
      WHERE events.id = event_files.event_id
      AND events.created_by = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM employee_assignments
      WHERE employee_assignments.event_id = event_files.event_id
      AND employee_assignments.employee_id = auth.uid()
      AND employee_assignments.status = 'accepted'
      AND employee_assignments.can_edit_files = true
    )
  );

-- Funkcja pomocnicza do budowania pełnej ścieżki
CREATE OR REPLACE FUNCTION update_folder_path()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_folder_id IS NULL THEN
    NEW.path = NEW.name;
  ELSE
    SELECT path || '/' || NEW.name INTO NEW.path
    FROM event_folders
    WHERE id = NEW.parent_folder_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_folder_path_trigger
  BEFORE INSERT OR UPDATE ON event_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_folder_path();
