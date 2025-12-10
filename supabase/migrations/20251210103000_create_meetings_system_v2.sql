/*
  # System spotkań i przypomnień

  1. Nowe Tabele
    - `meetings`
      - `id` (uuid, primary key)
      - `title` (text) - Tytuł spotkania/przypomnienia
      - `location_id` (uuid, opcjonalne) - Powiązanie z lokalizacją
      - `location_text` (text, opcjonalne) - Lokalizacja jako tekst
      - `datetime_start` (timestamptz) - Data i godzina rozpoczęcia
      - `datetime_end` (timestamptz, opcjonalne) - Data i godzina zakończenia
      - `notes` (text, opcjonalne) - Notatki
      - `event_id` (uuid, opcjonalne) - Powiązanie z wydarzeniem
      - `created_by` (uuid) - Kto utworzył
      - `color` (text) - Kolor w kalendarzu
      - `is_all_day` (boolean) - Czy całodniowe
      - `created_at`, `updated_at`, `deleted_at`
    
    - `meeting_participants`
      - `id` (uuid, primary key)
      - `meeting_id` (uuid) - Powiązanie ze spotkaniem
      - `employee_id` (uuid, opcjonalne) - Pracownik
      - `contact_id` (uuid, opcjonalne) - Kontakt
      - `created_at`

  2. Security
    - RLS włączone dla obu tabel
    - Dostęp dla użytkowników z uprawnieniem 'calendar_manage'
    - Uczestnicy mogą zobaczyć spotkania, w których uczestniczą
*/

-- Tabela meetings
CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  location_text text,
  datetime_start timestamptz NOT NULL,
  datetime_end timestamptz,
  notes text,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  color text DEFAULT '#d3bb73',
  is_all_day boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

-- Tabela meeting_participants
CREATE TABLE IF NOT EXISTS meeting_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT meeting_participants_one_reference CHECK (
    (employee_id IS NOT NULL AND contact_id IS NULL) OR
    (employee_id IS NULL AND contact_id IS NOT NULL)
  )
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_meetings_datetime_start ON meetings(datetime_start) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_created_by ON meetings(created_by) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_event_id ON meetings(event_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting_id ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_employee_id ON meeting_participants(employee_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_contact_id ON meeting_participants(contact_id);

-- Trigger dla updated_at
CREATE OR REPLACE FUNCTION update_meetings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS meetings_updated_at ON meetings;
CREATE TRIGGER meetings_updated_at
  BEFORE UPDATE ON meetings
  FOR EACH ROW
  EXECUTE FUNCTION update_meetings_updated_at();

-- RLS dla meetings
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do everything with meetings"
  ON meetings
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

CREATE POLICY "Users with calendar_manage can view all meetings"
  ON meetings
  FOR SELECT
  TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      EXISTS (
        SELECT 1 FROM employees
        WHERE employees.id = auth.uid()
        AND 'calendar_manage' = ANY(employees.permissions)
      )
      OR created_by = auth.uid()
      OR EXISTS (
        SELECT 1 FROM meeting_participants
        WHERE meeting_participants.meeting_id = meetings.id
        AND meeting_participants.employee_id = auth.uid()
      )
    )
  );

CREATE POLICY "Users with calendar_manage can insert meetings"
  ON meetings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'calendar_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with calendar_manage can update meetings"
  ON meetings
  FOR UPDATE
  TO authenticated
  USING (
    deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'calendar_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Users with calendar_manage can delete meetings"
  ON meetings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'calendar_manage' = ANY(employees.permissions)
    )
  );

-- RLS dla meeting_participants
ALTER TABLE meeting_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage meeting participants"
  ON meeting_participants
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.role = 'admin'
    )
  );

CREATE POLICY "Users with calendar_manage can view participants"
  ON meeting_participants
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'calendar_manage' = ANY(employees.permissions)
    )
    OR employee_id = auth.uid()
  );

CREATE POLICY "Users with calendar_manage can manage participants"
  ON meeting_participants
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'calendar_manage' = ANY(employees.permissions)
    )
  );

-- Dodaj uprawnienie calendar_manage do admina jeśli nie ma
DO $$
BEGIN
  UPDATE employees
  SET permissions = array_append(permissions, 'calendar_manage')
  WHERE role = 'admin'
  AND NOT ('calendar_manage' = ANY(permissions));
END $$;

-- Włącz realtime dla meetings
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE meetings;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE meeting_participants;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;