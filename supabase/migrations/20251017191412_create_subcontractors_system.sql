/*
  # System podwykonawców (Subcontractors System)

  ## Opis
  System do zarządzania podwykonawcami, ich zadaniami, kosztami i umowami.

  ## 1. Nowe tabele
  
  ### `subcontractors`
  - `id` (uuid, primary key)
  - `company_name` (text) - nazwa firmy podwykonawcy
  - `contact_person` (text) - osoba kontaktowa
  - `email` (text) - email kontaktowy
  - `phone` (text) - telefon
  - `nip` (text) - NIP podwykonawcy
  - `address` (text) - adres
  - `specialization` (text[]) - specjalizacje (array)
  - `hourly_rate` (decimal) - stawka godzinowa domyślna
  - `payment_terms` (text) - warunki płatności (np. "14 dni", "30 dni")
  - `bank_account` (text) - numer konta bankowego
  - `status` (text) - status: 'active', 'inactive', 'blacklisted'
  - `rating` (integer) - ocena 1-5
  - `notes` (text) - notatki
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### `subcontractor_tasks`
  - `id` (uuid, primary key)
  - `event_id` (uuid, foreign key -> events)
  - `subcontractor_id` (uuid, foreign key -> subcontractors)
  - `task_name` (text) - nazwa zadania
  - `description` (text) - opis zadania
  - `start_date` (date) - data rozpoczęcia
  - `end_date` (date) - data zakończenia
  - `estimated_hours` (decimal) - szacowane godziny
  - `actual_hours` (decimal) - rzeczywiste godziny
  - `hourly_rate` (decimal) - stawka dla tego zadania
  - `fixed_price` (decimal) - cena ryczałtowa (jeśli stosowana)
  - `payment_type` (text) - 'hourly', 'fixed', 'mixed'
  - `total_cost` (decimal, computed) - całkowity koszt
  - `status` (text) - 'planned', 'in_progress', 'completed', 'cancelled'
  - `invoice_number` (text) - numer faktury
  - `invoice_date` (date) - data faktury
  - `payment_status` (text) - 'pending', 'paid', 'overdue'
  - `payment_date` (date) - data płatności
  - `notes` (text)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ### `subcontractor_contracts`
  - `id` (uuid, primary key)
  - `subcontractor_id` (uuid, foreign key -> subcontractors)
  - `event_id` (uuid, foreign key -> events, nullable)
  - `contract_number` (text) - numer umowy
  - `contract_type` (text) - 'frame', 'project' - ramowa lub projektowa
  - `title` (text) - tytuł umowy
  - `description` (text) - opis
  - `start_date` (date) - data rozpoczęcia
  - `end_date` (date) - data zakończenia
  - `total_value` (decimal) - wartość umowy
  - `payment_terms` (text) - warunki płatności
  - `file_path` (text) - ścieżka do pliku umowy
  - `status` (text) - 'draft', 'active', 'completed', 'terminated'
  - `signed_date` (date) - data podpisania
  - `notes` (text)
  - `created_by` (uuid, foreign key -> auth.users)
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

  ## 2. Security
  - Włączenie RLS dla wszystkich tabel
  - Polityki dostępu dla pracowników z uprawnieniami

  ## 3. Indeksy
  - Indeksy dla relacji i często wyszukiwanych pól
*/

-- Tworzenie tabeli podwykonawców
CREATE TABLE IF NOT EXISTS subcontractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  contact_person text,
  email text,
  phone text,
  nip text,
  address text,
  specialization text[] DEFAULT ARRAY[]::text[],
  hourly_rate decimal(10,2) DEFAULT 0,
  payment_terms text DEFAULT '14 dni',
  bank_account text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'blacklisted')),
  rating integer CHECK (rating >= 1 AND rating <= 5),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tworzenie tabeli zadań podwykonawców
CREATE TABLE IF NOT EXISTS subcontractor_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE CASCADE,
  task_name text NOT NULL,
  description text,
  start_date date,
  end_date date,
  estimated_hours decimal(10,2) DEFAULT 0,
  actual_hours decimal(10,2) DEFAULT 0,
  hourly_rate decimal(10,2) DEFAULT 0,
  fixed_price decimal(10,2) DEFAULT 0,
  payment_type text DEFAULT 'hourly' CHECK (payment_type IN ('hourly', 'fixed', 'mixed')),
  total_cost decimal(10,2) GENERATED ALWAYS AS (
    CASE 
      WHEN payment_type = 'fixed' THEN fixed_price
      WHEN payment_type = 'hourly' THEN actual_hours * hourly_rate
      ELSE fixed_price + (actual_hours * hourly_rate)
    END
  ) STORED,
  status text DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'completed', 'cancelled')),
  invoice_number text,
  invoice_date date,
  payment_status text DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'overdue')),
  payment_date date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tworzenie tabeli umów z podwykonawcami
CREATE TABLE IF NOT EXISTS subcontractor_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontractor_id uuid REFERENCES subcontractors(id) ON DELETE CASCADE NOT NULL,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  contract_number text UNIQUE NOT NULL,
  contract_type text DEFAULT 'project' CHECK (contract_type IN ('frame', 'project')),
  title text NOT NULL,
  description text,
  start_date date,
  end_date date,
  total_value decimal(10,2) DEFAULT 0,
  payment_terms text,
  file_path text,
  status text DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'terminated')),
  signed_date date,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Indeksy dla wydajności
CREATE INDEX IF NOT EXISTS idx_subcontractors_status ON subcontractors(status);
CREATE INDEX IF NOT EXISTS idx_subcontractors_rating ON subcontractors(rating);
CREATE INDEX IF NOT EXISTS idx_subcontractor_tasks_event ON subcontractor_tasks(event_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_tasks_subcontractor ON subcontractor_tasks(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_tasks_status ON subcontractor_tasks(status);
CREATE INDEX IF NOT EXISTS idx_subcontractor_tasks_payment_status ON subcontractor_tasks(payment_status);
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_subcontractor ON subcontractor_contracts(subcontractor_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_event ON subcontractor_contracts(event_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_contracts_status ON subcontractor_contracts(status);

-- Funkcja aktualizacji updated_at
CREATE OR REPLACE FUNCTION update_subcontractors_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggery dla updated_at
CREATE TRIGGER update_subcontractors_timestamp
  BEFORE UPDATE ON subcontractors
  FOR EACH ROW
  EXECUTE FUNCTION update_subcontractors_updated_at();

CREATE TRIGGER update_subcontractor_tasks_timestamp
  BEFORE UPDATE ON subcontractor_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_subcontractors_updated_at();

CREATE TRIGGER update_subcontractor_contracts_timestamp
  BEFORE UPDATE ON subcontractor_contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_subcontractors_updated_at();

-- Włączenie RLS
ALTER TABLE subcontractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE subcontractor_contracts ENABLE ROW LEVEL SECURITY;

-- Polityki RLS dla subcontractors
CREATE POLICY "Pracownicy mogą zarządzać podwykonawcami"
  ON subcontractors
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'subcontractors_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'subcontractors_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Pracownicy mogą przeglądać podwykonawców"
  ON subcontractors
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND ('subcontractors_view' = ANY(employees.permissions) OR 'subcontractors_manage' = ANY(employees.permissions))
    )
  );

-- Polityki RLS dla subcontractor_tasks
CREATE POLICY "Pracownicy mogą zarządzać zadaniami podwykonawców"
  ON subcontractor_tasks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'subcontractors_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'subcontractors_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Pracownicy mogą przeglądać zadania podwykonawców"
  ON subcontractor_tasks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND ('subcontractors_view' = ANY(employees.permissions) OR 'subcontractors_manage' = ANY(employees.permissions))
    )
  );

-- Polityki RLS dla subcontractor_contracts
CREATE POLICY "Pracownicy mogą zarządzać umowami podwykonawców"
  ON subcontractor_contracts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'subcontractors_manage' = ANY(employees.permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'subcontractors_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Pracownicy mogą przeglądać umowy podwykonawców"
  ON subcontractor_contracts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND ('subcontractors_view' = ANY(employees.permissions) OR 'subcontractors_manage' = ANY(employees.permissions))
    )
  );

-- Przykładowe dane
INSERT INTO subcontractors (company_name, contact_person, email, phone, specialization, hourly_rate, status, rating)
VALUES 
  ('Tech Sound Systems', 'Jan Kowalski', 'jan@techsound.pl', '+48 500 100 200', ARRAY['nagłośnienie', 'oświetlenie'], 150.00, 'active', 5),
  ('Light Masters', 'Anna Nowak', 'anna@lightmasters.pl', '+48 600 200 300', ARRAY['oświetlenie', 'efekty specjalne'], 180.00, 'active', 4),
  ('Event Logistics', 'Piotr Wiśniewski', 'piotr@eventlogistics.pl', '+48 700 300 400', ARRAY['transport', 'montaż'], 120.00, 'active', 4)
ON CONFLICT DO NOTHING;