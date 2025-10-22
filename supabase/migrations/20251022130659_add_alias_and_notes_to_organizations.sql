/*
  # Dodanie pola alias i systemu notatek do organizations

  1. Zmiany w organizations
    - Dodanie pola `alias` - krótka nazwa wyświetlana
  
  2. Nowa tabela organization_notes
    - `id` - UUID, klucz główny
    - `organization_id` - UUID, FK do organizations
    - `note` - text, treść notatki
    - `created_by` - UUID, kto dodał (FK do employees.id)
    - `created_at` - timestamp
    
  3. Bezpieczeństwo
    - RLS dla organization_notes
*/

-- Dodaj pole alias do organizations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'organizations' AND column_name = 'alias'
  ) THEN
    ALTER TABLE organizations ADD COLUMN alias text;
  END IF;
END $$;

-- Utwórz tabelę organization_notes
CREATE TABLE IF NOT EXISTS organization_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  note text NOT NULL,
  created_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now()
);

-- Indeks dla szybkiego pobierania notatek organizacji
CREATE INDEX IF NOT EXISTS idx_organization_notes_org_id 
  ON organization_notes(organization_id);

CREATE INDEX IF NOT EXISTS idx_organization_notes_created_at
  ON organization_notes(created_at DESC);

-- RLS dla organization_notes
ALTER TABLE organization_notes ENABLE ROW LEVEL SECURITY;

-- Wszyscy zalogowani mogą czytać notatki
CREATE POLICY "Authenticated users can read organization notes"
  ON organization_notes
  FOR SELECT
  TO authenticated
  USING (true);

-- Zalogowani mogą dodawać notatki
CREATE POLICY "Authenticated users can insert organization notes"
  ON organization_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Tylko twórca lub admin może usuwać notatki
CREATE POLICY "Users can delete own notes or admins can delete all"
  ON organization_notes
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = created_by OR
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'admin' = ANY(permissions)
    )
  );

-- Włącz realtime dla notatek
ALTER PUBLICATION supabase_realtime ADD TABLE organization_notes;