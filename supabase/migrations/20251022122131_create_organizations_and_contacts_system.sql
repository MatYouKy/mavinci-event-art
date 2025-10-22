/*
  # System organizacji i osób kontaktowych

  ## Opis
  Nowy system zarządzania kontaktami z hierarchią:
  Organizacje (firmy/hotele/restauracje) → Osoby kontaktowe → Wydarzenia/Historia/Przypomnienia

  ## 1. Nowe tabele

  ### `organizations`
  Organizacje - firmy klientów, hotele, restauracje, podwykonawcy, freelancerzy

  ### `contact_persons`
  Osoby kontaktowe przypisane do organizacji

  ### `contact_reminders`
  Przypomnienia związane z organizacjami/osobami

  ### `contact_history`
  Historia kontaktów z organizacjami/osobami

  ## 2. Migracja danych
  - Przeniesienie danych z `clients` do `organizations` (type='client')
  - Przeniesienie danych z `subcontractors` do `organizations` (type='subcontractor')
  - Aktualizacja relacji w `events` i innych tabelach

  ## 3. Security
  - Włączenie RLS dla wszystkich tabel
  - Polityki dostępu dla pracowników z odpowiednimi uprawnieniami
*/

-- Tworzenie typów enum
DO $$ BEGIN
  CREATE TYPE organization_type AS ENUM ('client', 'subcontractor');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE business_type AS ENUM ('company', 'hotel', 'restaurant', 'venue', 'freelancer', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE contact_reminder_type AS ENUM ('call', 'email', 'meeting', 'follow_up', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE contact_history_type AS ENUM ('call', 'email', 'meeting', 'event', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE reminder_priority AS ENUM ('low', 'medium', 'high');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE organization_status AS ENUM ('active', 'inactive', 'blacklisted');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Tabela organizacji
CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Klasyfikacja
  organization_type organization_type NOT NULL DEFAULT 'client',
  business_type business_type NOT NULL DEFAULT 'company',

  -- Dane podstawowe
  name text NOT NULL,
  nip text,

  -- Adres
  address text,
  city text,
  postal_code text,
  country text DEFAULT 'Polska',

  -- Kontakt
  email text,
  phone text,
  website text,

  -- Status i ocena
  status organization_status DEFAULT 'active',
  rating integer CHECK (rating >= 1 AND rating <= 5),
  tags text[] DEFAULT ARRAY[]::text[],
  notes text,

  -- Dla podwykonawców
  specialization text[] DEFAULT ARRAY[]::text[],
  hourly_rate decimal(10,2),
  payment_terms text,
  bank_account text,

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Migracja danych z clients do organizations (PRZED zmianą events)
INSERT INTO organizations (
  id,
  organization_type,
  business_type,
  name,
  nip,
  address,
  email,
  phone,
  notes,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  'client'::organization_type,
  'company'::business_type,
  COALESCE(company_name, first_name || ' ' || last_name) as name,
  nip,
  address,
  email,
  phone,
  notes,
  'active'::organization_status,
  created_at,
  updated_at
FROM clients
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE organizations.id = clients.id)
ON CONFLICT (id) DO NOTHING;

-- Migracja danych z subcontractors do organizations
INSERT INTO organizations (
  id,
  organization_type,
  business_type,
  name,
  nip,
  address,
  email,
  phone,
  notes,
  status,
  specialization,
  hourly_rate,
  payment_terms,
  bank_account,
  rating,
  created_at,
  updated_at
)
SELECT
  id,
  'subcontractor'::organization_type,
  CASE
    WHEN contact_person IS NOT NULL AND company_name ~ 'freelanc' THEN 'freelancer'::business_type
    ELSE 'company'::business_type
  END,
  company_name as name,
  nip,
  address,
  email,
  phone,
  notes,
  status::organization_status,
  specialization,
  hourly_rate,
  payment_terms,
  bank_account,
  rating,
  created_at,
  updated_at
FROM subcontractors
WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE organizations.id = subcontractors.id)
ON CONFLICT (id) DO NOTHING;

-- Tabela osób kontaktowych
CREATE TABLE IF NOT EXISTS contact_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Dane osobowe
  first_name text NOT NULL,
  last_name text NOT NULL,
  position text,
  department text,

  -- Kontakt
  email text,
  phone text,
  mobile text,

  -- Flagi
  is_primary boolean DEFAULT false,
  is_decision_maker boolean DEFAULT false,

  -- Notatki
  notes text,

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tworzenie osób kontaktowych z subcontractors
INSERT INTO contact_persons (
  organization_id,
  first_name,
  last_name,
  email,
  phone,
  is_primary,
  created_at
)
SELECT
  id as organization_id,
  split_part(contact_person, ' ', 1) as first_name,
  COALESCE(split_part(contact_person, ' ', 2), '') as last_name,
  email,
  phone,
  true,
  created_at
FROM subcontractors
WHERE contact_person IS NOT NULL
  AND contact_person != ''
  AND EXISTS (SELECT 1 FROM organizations WHERE organizations.id = subcontractors.id)
  AND NOT EXISTS (
    SELECT 1 FROM contact_persons
    WHERE contact_persons.organization_id = subcontractors.id
  );

-- Tworzenie osób kontaktowych z clients (gdy są dane osobowe)
INSERT INTO contact_persons (
  organization_id,
  first_name,
  last_name,
  email,
  phone,
  is_primary,
  created_at
)
SELECT
  id as organization_id,
  first_name,
  last_name,
  email,
  phone,
  true,
  created_at
FROM clients
WHERE first_name IS NOT NULL
  AND first_name != ''
  AND company_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM organizations WHERE organizations.id = clients.id)
  AND NOT EXISTS (
    SELECT 1 FROM contact_persons
    WHERE contact_persons.organization_id = clients.id
  );

-- Tabela przypomnień
CREATE TABLE IF NOT EXISTS contact_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Powiązania
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  contact_person_id uuid REFERENCES contact_persons(id) ON DELETE CASCADE,
  assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_by uuid REFERENCES employees(id) ON DELETE SET NULL,

  -- Dane przypomnienia
  reminder_type contact_reminder_type NOT NULL DEFAULT 'call',
  title text NOT NULL,
  description text,
  reminder_date timestamptz NOT NULL,

  -- Status
  is_completed boolean DEFAULT false,
  completed_at timestamptz,
  priority reminder_priority DEFAULT 'medium',

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  -- Przynajmniej jedna z relacji musi być wypełniona
  CHECK (organization_id IS NOT NULL OR contact_person_id IS NOT NULL)
);

-- Tabela historii kontaktów
CREATE TABLE IF NOT EXISTS contact_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Powiązania
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_person_id uuid REFERENCES contact_persons(id) ON DELETE SET NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  contacted_by uuid REFERENCES employees(id) ON DELETE SET NULL,

  -- Dane kontaktu
  contact_type contact_history_type NOT NULL DEFAULT 'call',
  subject text,
  description text,
  contact_date timestamptz NOT NULL DEFAULT now(),

  -- Wynik i kolejne kroki
  outcome text,
  next_action text,

  -- Metadata
  created_at timestamptz DEFAULT now()
);

-- Aktualizacja tabeli events - zmiana relacji z clients na organizations
DO $$
BEGIN
  -- Dodaj nową kolumnę contact_person_id jeśli nie istnieje
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'contact_person_id'
  ) THEN
    ALTER TABLE events ADD COLUMN contact_person_id uuid REFERENCES contact_persons(id) ON DELETE SET NULL;
  END IF;

  -- Zmień nazwę kolumny jeśli jeszcze nie została zmieniona
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'events' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE events DROP CONSTRAINT IF EXISTS events_client_id_fkey;
    ALTER TABLE events RENAME COLUMN client_id TO organization_id;
    ALTER TABLE events ADD CONSTRAINT events_organization_id_fkey
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indeksy dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(organization_type);
CREATE INDEX IF NOT EXISTS idx_organizations_business_type ON organizations(business_type);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status);
CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);
CREATE INDEX IF NOT EXISTS idx_organizations_email ON organizations(email);

CREATE INDEX IF NOT EXISTS idx_contact_persons_organization_id ON contact_persons(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_persons_is_primary ON contact_persons(is_primary);
CREATE INDEX IF NOT EXISTS idx_contact_persons_email ON contact_persons(email);

CREATE INDEX IF NOT EXISTS idx_contact_reminders_organization_id ON contact_reminders(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_reminders_contact_person_id ON contact_reminders(contact_person_id);
CREATE INDEX IF NOT EXISTS idx_contact_reminders_assigned_to ON contact_reminders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_contact_reminders_reminder_date ON contact_reminders(reminder_date);
CREATE INDEX IF NOT EXISTS idx_contact_reminders_is_completed ON contact_reminders(is_completed);

CREATE INDEX IF NOT EXISTS idx_contact_history_organization_id ON contact_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_contact_history_contact_person_id ON contact_history(contact_person_id);
CREATE INDEX IF NOT EXISTS idx_contact_history_event_id ON contact_history(event_id);
CREATE INDEX IF NOT EXISTS idx_contact_history_contact_date ON contact_history(contact_date);

CREATE INDEX IF NOT EXISTS idx_events_organization_id ON events(organization_id);
CREATE INDEX IF NOT EXISTS idx_events_contact_person_id ON events(contact_person_id);

-- Triggery dla updated_at
DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contact_persons_updated_at ON contact_persons;
CREATE TRIGGER update_contact_persons_updated_at
  BEFORE UPDATE ON contact_persons
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_contact_reminders_updated_at ON contact_reminders;
CREATE TRIGGER update_contact_reminders_updated_at
  BEFORE UPDATE ON contact_reminders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Włączenie RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_history ENABLE ROW LEVEL SECURITY;

-- RLS Policies dla organizations
DROP POLICY IF EXISTS "Authenticated users can view organizations" ON organizations;
CREATE POLICY "Authenticated users can view organizations"
  ON organizations FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert organizations" ON organizations;
CREATE POLICY "Authenticated users can insert organizations"
  ON organizations FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update organizations" ON organizations;
CREATE POLICY "Authenticated users can update organizations"
  ON organizations FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete organizations" ON organizations;
CREATE POLICY "Authenticated users can delete organizations"
  ON organizations FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies dla contact_persons
DROP POLICY IF EXISTS "Authenticated users can view contact persons" ON contact_persons;
CREATE POLICY "Authenticated users can view contact persons"
  ON contact_persons FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert contact persons" ON contact_persons;
CREATE POLICY "Authenticated users can insert contact persons"
  ON contact_persons FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update contact persons" ON contact_persons;
CREATE POLICY "Authenticated users can update contact persons"
  ON contact_persons FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete contact persons" ON contact_persons;
CREATE POLICY "Authenticated users can delete contact persons"
  ON contact_persons FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies dla contact_reminders
DROP POLICY IF EXISTS "Authenticated users can view contact reminders" ON contact_reminders;
CREATE POLICY "Authenticated users can view contact reminders"
  ON contact_reminders FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert contact reminders" ON contact_reminders;
CREATE POLICY "Authenticated users can insert contact reminders"
  ON contact_reminders FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update contact reminders" ON contact_reminders;
CREATE POLICY "Authenticated users can update contact reminders"
  ON contact_reminders FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete contact reminders" ON contact_reminders;
CREATE POLICY "Authenticated users can delete contact reminders"
  ON contact_reminders FOR DELETE
  TO authenticated
  USING (true);

-- RLS Policies dla contact_history
DROP POLICY IF EXISTS "Authenticated users can view contact history" ON contact_history;
CREATE POLICY "Authenticated users can view contact history"
  ON contact_history FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert contact history" ON contact_history;
CREATE POLICY "Authenticated users can insert contact history"
  ON contact_history FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can update contact history" ON contact_history;
CREATE POLICY "Authenticated users can update contact history"
  ON contact_history FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Authenticated users can delete contact history" ON contact_history;
CREATE POLICY "Authenticated users can delete contact history"
  ON contact_history FOR DELETE
  TO authenticated
  USING (true);