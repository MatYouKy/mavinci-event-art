/*
  # Nowa struktura: Organizacje i Kontakty (Klienci)

  1. Nowa tabela `contacts` (zastępuje contact_persons)
    - Niezależni klienci/kontakty
    - Pełne dane osobowe
    - Avatar i metadata
    - Social media
    - Tagi, języki, oceny
    
  2. Nowa tabela `contact_organizations` (relacja M:M)
    - Łączy kontakty z organizacjami
    - Pozycja w organizacji
    - Dział
    - Daty zatrudnienia (started_at, ended_at)
    - Historia zmian organizacji
    
  3. Migracja danych
    - Przeniesienie danych z contact_persons do contacts
    - Zachowanie relacji z organizacjami
    
  4. Bezpieczeństwo
    - RLS dla obu tabel
*/

-- Utwórz nową tabelę contacts (klienci/kontakty)
CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Dane podstawowe
  first_name text NOT NULL,
  last_name text NOT NULL,
  full_name text GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  
  -- Avatar
  avatar_url text,
  avatar_metadata jsonb DEFAULT '{}',
  
  -- Dane osobowe
  birth_date date,
  bio text,
  
  -- Kontakt
  email text,
  phone text,
  mobile text,
  preferred_contact_method text,
  
  -- Adres prywatny
  address text,
  city text,
  postal_code text,
  country text DEFAULT 'Polska',
  
  -- Social media
  linkedin_url text,
  facebook_url text,
  instagram_url text,
  website text,
  
  -- Metadata
  languages text[] DEFAULT ARRAY['Polski'],
  tags text[],
  status text DEFAULT 'active',
  rating integer CHECK (rating >= 1 AND rating <= 5),
  last_contact_date timestamptz,
  
  -- System
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES employees(id)
);

-- Utwórz tabelę relacji contacts <-> organizations
CREATE TABLE IF NOT EXISTS contact_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Relacje
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  
  -- Dane o zatrudnieniu/współpracy
  position text,
  department text,
  started_at date,
  ended_at date,
  is_current boolean DEFAULT true,
  is_primary boolean DEFAULT false,
  is_decision_maker boolean DEFAULT false,
  
  -- System
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Unikalność: kontakt + organizacja
  UNIQUE(contact_id, organization_id)
);

-- Indeksy dla contacts
CREATE INDEX IF NOT EXISTS idx_contacts_full_name ON contacts(full_name);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(email);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON contacts(created_at DESC);

-- Indeksy dla contact_organizations
CREATE INDEX IF NOT EXISTS idx_contact_orgs_contact_id ON contact_organizations(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_orgs_org_id ON contact_organizations(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_orgs_is_current ON contact_organizations(is_current);

-- RLS dla contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view all contacts"
  ON contacts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create contacts"
  ON contacts FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update contacts"
  ON contacts FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete contacts"
  ON contacts FOR DELETE TO authenticated USING (true);

-- RLS dla contact_organizations
ALTER TABLE contact_organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view contact-org relations"
  ON contact_organizations FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create contact-org relations"
  ON contact_organizations FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update contact-org relations"
  ON contact_organizations FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated users can delete contact-org relations"
  ON contact_organizations FOR DELETE TO authenticated USING (true);

-- Trigger do automatycznego ustawiania updated_at dla contacts
CREATE OR REPLACE FUNCTION update_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contacts_updated_at_trigger
  BEFORE UPDATE ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_contacts_updated_at();

-- Trigger do automatycznego ustawiania updated_at dla contact_organizations
CREATE OR REPLACE FUNCTION update_contact_organizations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contact_organizations_updated_at_trigger
  BEFORE UPDATE ON contact_organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_contact_organizations_updated_at();

-- Migracja danych z contact_persons do contacts (bez position i department)
INSERT INTO contacts (
  id,
  first_name,
  last_name,
  email,
  phone,
  mobile,
  birth_date,
  bio,
  avatar_url,
  avatar_metadata,
  preferred_contact_method,
  linkedin_url,
  facebook_url,
  instagram_url,
  address,
  city,
  postal_code,
  country,
  languages,
  tags,
  status,
  rating,
  last_contact_date,
  notes,
  created_at,
  updated_at
)
SELECT 
  id,
  first_name,
  last_name,
  email,
  phone,
  mobile,
  birth_date,
  bio,
  avatar_url,
  avatar_metadata,
  preferred_contact_method,
  linkedin_url,
  facebook_url,
  instagram_url,
  address,
  city,
  postal_code,
  country,
  languages,
  tags,
  status,
  rating,
  last_contact_date,
  notes,
  created_at,
  updated_at
FROM contact_persons
WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE contacts.id = contact_persons.id);

-- Migracja relacji contact_persons -> organizations do contact_organizations
INSERT INTO contact_organizations (
  contact_id,
  organization_id,
  position,
  department,
  is_primary,
  is_decision_maker,
  is_current,
  notes
)
SELECT 
  cp.id,
  cp.organization_id,
  cp.position,
  cp.department,
  COALESCE(cp.is_primary, false),
  COALESCE(cp.is_decision_maker, false),
  true,
  cp.notes
FROM contact_persons cp
WHERE cp.organization_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM contact_organizations co 
  WHERE co.contact_id = cp.id AND co.organization_id = cp.organization_id
);

-- Włącz realtime
ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
ALTER PUBLICATION supabase_realtime ADD TABLE contact_organizations;

-- Komentarze
COMMENT ON TABLE contacts IS 'Niezależni klienci/kontakty - mogą istnieć bez organizacji';
COMMENT ON TABLE contact_organizations IS 'Relacja M:M między kontaktami a organizacjami - historia zatrudnienia';
COMMENT ON COLUMN contact_organizations.is_current IS 'Czy osoba obecnie pracuje/współpracuje z organizacją';
COMMENT ON COLUMN contact_organizations.is_primary IS 'Czy to główny kontakt w organizacji';
COMMENT ON COLUMN contact_organizations.ended_at IS 'Data zakończenia współpracy (NULL = trwająca)';
COMMENT ON COLUMN contacts.full_name IS 'Automatycznie generowane pełne imię i nazwisko';