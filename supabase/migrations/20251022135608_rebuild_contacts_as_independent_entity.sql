/*
  # Przebudowa systemu kontaktów jako niezależne byty

  1. Zmiany w contact_persons
    - Zmiana organization_id na opcjonalny (kontakt może istnieć sam)
    - Dodanie pełnych danych osobowych
    - Dodanie avatara i metadanych
    - Dodanie więcej pól kontaktowych
    
  2. Nowe pola
    - `full_name` - pełne imię i nazwisko (obliczane automatycznie)
    - `avatar_url` - URL do avatara
    - `avatar_metadata` - metadane avatara (JSONB)
    - `birth_date` - data urodzenia
    - `preferred_contact_method` - preferowana metoda kontaktu
    - `linkedin_url`, `facebook_url` - social media
    - `address`, `city`, `postal_code` - adres prywatny
    - `languages` - języki (array)
    - `tags` - tagi (array)
    - `status` - status kontaktu
    - `rating` - ocena kontaktu (1-5)
    - `last_contact_date` - data ostatniego kontaktu
    
  3. Bezpieczeństwo
    - Aktualizacja RLS policies
*/

-- Najpierw usuń stare policies
DROP POLICY IF EXISTS "Authenticated users can read contact persons" ON contact_persons;
DROP POLICY IF EXISTS "Authenticated users can insert contact persons" ON contact_persons;
DROP POLICY IF EXISTS "Authenticated users can update contact persons" ON contact_persons;
DROP POLICY IF EXISTS "Authenticated users can delete contact persons" ON contact_persons;

-- Zmień organization_id na opcjonalny
ALTER TABLE contact_persons ALTER COLUMN organization_id DROP NOT NULL;

-- Dodaj nowe pola
ALTER TABLE contact_persons 
  ADD COLUMN IF NOT EXISTS full_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS avatar_metadata jsonb DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS birth_date date,
  ADD COLUMN IF NOT EXISTS preferred_contact_method text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS facebook_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'Polska',
  ADD COLUMN IF NOT EXISTS languages text[] DEFAULT ARRAY['Polski'],
  ADD COLUMN IF NOT EXISTS tags text[],
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS rating integer CHECK (rating >= 1 AND rating <= 5),
  ADD COLUMN IF NOT EXISTS last_contact_date timestamptz,
  ADD COLUMN IF NOT EXISTS bio text;

-- Dodaj indeksy
CREATE INDEX IF NOT EXISTS idx_contact_persons_full_name 
  ON contact_persons(full_name);

CREATE INDEX IF NOT EXISTS idx_contact_persons_email 
  ON contact_persons(email);

CREATE INDEX IF NOT EXISTS idx_contact_persons_status 
  ON contact_persons(status);

CREATE INDEX IF NOT EXISTS idx_contact_persons_tags 
  ON contact_persons USING gin(tags);

-- Nowe RLS policies
CREATE POLICY "Authenticated users can view all contacts"
  ON contact_persons
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create contacts"
  ON contact_persons
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update contacts"
  ON contact_persons
  FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can delete contacts"
  ON contact_persons
  FOR DELETE
  TO authenticated
  USING (true);

-- Włącz realtime
ALTER PUBLICATION supabase_realtime ADD TABLE contact_persons;

-- Dodaj trigger do automatycznego ustawiania updated_at
CREATE OR REPLACE FUNCTION update_contact_persons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_contact_persons_updated_at_trigger ON contact_persons;

CREATE TRIGGER update_contact_persons_updated_at_trigger
  BEFORE UPDATE ON contact_persons
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_persons_updated_at();