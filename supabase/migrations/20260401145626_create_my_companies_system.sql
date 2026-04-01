/*
  # System zarządzania własnymi firmami

  1. Nowa tabela
    - `my_companies` - firmy użytkownika (działalności)
      - `id` (uuid, primary key)
      - `name` (text) - nazwa firmy
      - `legal_name` (text) - pełna nazwa prawna
      - `nip` (text, unique) - NIP
      - `regon` (text, nullable)
      - `krs` (text, nullable)
      - `address` (text)
      - `city` (text)
      - `postal_code` (text)
      - `country` (text, default 'Polska')
      - `email` (text)
      - `phone` (text)
      - `bank_account` (text, nullable) - numer konta bankowego
      - `logo_url` (text, nullable)
      - `is_active` (boolean, default true)
      - `is_default` (boolean, default false) - domyślna firma
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Zmiany w istniejących tabelach
    - Dodaj `my_company_id` do `invoices`
    - Zmień `organization_id` na `my_company_id` w `ksef_credentials`

  3. Bezpieczeństwo
    - Enable RLS
    - Policies dla uprawnień invoices_manage
*/

-- Create my_companies table
CREATE TABLE IF NOT EXISTS my_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text NOT NULL,
  nip text UNIQUE NOT NULL,
  regon text,
  krs text,
  address text NOT NULL,
  city text NOT NULL,
  postal_code text NOT NULL,
  country text DEFAULT 'Polska',
  email text NOT NULL,
  phone text NOT NULL,
  bank_account text,
  logo_url text,
  is_active boolean DEFAULT true,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index
CREATE INDEX IF NOT EXISTS idx_my_companies_nip ON my_companies(nip);
CREATE INDEX IF NOT EXISTS idx_my_companies_is_default ON my_companies(is_default);

-- Enable RLS
ALTER TABLE my_companies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for my_companies
CREATE POLICY "Admin and invoices_manage can view companies"
  ON my_companies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
        OR 'invoices_view' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and invoices_manage can insert companies"
  ON my_companies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin and invoices_manage can update companies"
  ON my_companies FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND (
        'admin' = ANY(employees.permissions)
        OR 'invoices_manage' = ANY(employees.permissions)
      )
    )
  );

CREATE POLICY "Admin can delete companies"
  ON my_companies FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'admin' = ANY(employees.permissions)
    )
  );

-- Add my_company_id to invoices
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'my_company_id'
  ) THEN
    ALTER TABLE invoices ADD COLUMN my_company_id uuid REFERENCES my_companies(id) ON DELETE SET NULL;
    CREATE INDEX idx_invoices_my_company ON invoices(my_company_id);
  END IF;
END $$;

-- Update ksef_credentials to use my_company_id
DO $$ 
BEGIN
  -- Dodaj nową kolumnę
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_credentials' AND column_name = 'my_company_id'
  ) THEN
    ALTER TABLE ksef_credentials ADD COLUMN my_company_id uuid REFERENCES my_companies(id) ON DELETE CASCADE;
    CREATE INDEX idx_ksef_credentials_my_company ON ksef_credentials(my_company_id);
  END IF;
  
  -- Usuń stare ograniczenie unique
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'unique_org_ksef' AND table_name = 'ksef_credentials'
  ) THEN
    ALTER TABLE ksef_credentials DROP CONSTRAINT unique_org_ksef;
  END IF;
  
  -- Dodaj nowe ograniczenie unique na my_company_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'unique_my_company_ksef' AND table_name = 'ksef_credentials'
  ) THEN
    ALTER TABLE ksef_credentials ADD CONSTRAINT unique_my_company_ksef UNIQUE(my_company_id);
  END IF;
END $$;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_my_companies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
BEGIN
  DROP TRIGGER IF EXISTS my_companies_updated_at ON my_companies;
  CREATE TRIGGER my_companies_updated_at
    BEFORE UPDATE ON my_companies
    FOR EACH ROW
    EXECUTE FUNCTION update_my_companies_updated_at();
END $$;

-- Ensure only one default company
CREATE OR REPLACE FUNCTION ensure_single_default_company()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE my_companies 
    SET is_default = false 
    WHERE id != NEW.id AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ 
BEGIN
  DROP TRIGGER IF EXISTS ensure_single_default_company_trigger ON my_companies;
  CREATE TRIGGER ensure_single_default_company_trigger
    BEFORE INSERT OR UPDATE ON my_companies
    FOR EACH ROW
    EXECUTE FUNCTION ensure_single_default_company();
END $$;

-- Insert sample companies
INSERT INTO my_companies (name, legal_name, nip, address, city, postal_code, email, phone, is_default, is_active)
VALUES 
  (
    'Mavinci',
    'Mavinci Spółka z ograniczoną odpowiedzialnością',
    '7394011583',
    'ul. Przykładowa 1',
    'Warszawa',
    '00-001',
    'biuro@mavinci.pl',
    '+48 123 456 789',
    true,
    true
  ),
  (
    'NASTROJOWO',
    'NASTROJOWO Dominika Kwiatkowska',
    '9840217338',
    'ul. Przykładowa 2',
    'Warszawa',
    '00-002',
    'kontakt@nastrojowo.pl',
    '+48 987 654 321',
    false,
    true
  )
ON CONFLICT (nip) DO NOTHING;
