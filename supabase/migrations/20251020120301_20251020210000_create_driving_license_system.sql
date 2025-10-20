/*
  # System kategorii prawa jazdy dla pojazdów i pracowników

  1. Nowe tabele
    - `driving_license_categories` - kategorie prawa jazdy (B, C, C+E, D, itd.)
    - `employee_driving_licenses` - prawa jazdy pracowników
    - `vehicle_license_requirements` - wymagane kategorie dla pojazdów

  2. Zabezpieczenia
    - RLS dla wszystkich tabel
    - Dostęp dla authenticated users

  3. Dane przykładowe
    - Podstawowe kategorie prawa jazdy (B, C, C+E, D, D+E, T)
*/

-- Kategorie prawa jazdy
CREATE TABLE IF NOT EXISTS driving_license_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  icon text,
  order_index integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE driving_license_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view driving license categories"
  ON driving_license_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users with equipment_manage can manage license categories"
  ON driving_license_categories FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'equipment_manage' = ANY(permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'equipment_manage' = ANY(permissions)
    )
  );

-- Prawa jazdy pracowników
CREATE TABLE IF NOT EXISTS employee_driving_licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  license_category_id uuid NOT NULL REFERENCES driving_license_categories(id) ON DELETE CASCADE,
  obtained_date date,
  expiry_date date,
  license_number text,
  notes text,
  verified_by uuid REFERENCES employees(id),
  verified_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, license_category_id)
);

ALTER TABLE employee_driving_licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view employee driving licenses"
  ON employee_driving_licenses FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Employees can manage own licenses and admins can manage all"
  ON employee_driving_licenses FOR ALL
  TO authenticated
  USING (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('employees_manage' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
    )
  )
  WITH CHECK (
    employee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('employees_manage' = ANY(permissions) OR 'equipment_manage' = ANY(permissions))
    )
  );

-- Wymagane kategorie prawa jazdy dla pojazdów
CREATE TABLE IF NOT EXISTS vehicle_license_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  license_category_id uuid NOT NULL REFERENCES driving_license_categories(id) ON DELETE CASCADE,
  is_required boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vehicle_id, license_category_id)
);

ALTER TABLE vehicle_license_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view vehicle license requirements"
  ON vehicle_license_requirements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users with equipment_manage can manage vehicle requirements"
  ON vehicle_license_requirements FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'equipment_manage' = ANY(permissions)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND 'equipment_manage' = ANY(permissions)
    )
  );

-- Dodaj podstawowe kategorie prawa jazdy
INSERT INTO driving_license_categories (code, name, description, order_index, is_active) VALUES
  ('B', 'Kategoria B', 'Samochody osobowe do 3,5 tony', 1, true),
  ('C', 'Kategoria C', 'Samochody ciężarowe powyżej 3,5 tony', 2, true),
  ('C+E', 'Kategoria C+E', 'Samochody ciężarowe z przyczepą', 3, true),
  ('D', 'Kategoria D', 'Autobusy', 4, true),
  ('D+E', 'Kategoria D+E', 'Autobusy z przyczepą', 5, true),
  ('T', 'Kategoria T', 'Ciągniki rolnicze', 6, true),
  ('B+E', 'Kategoria B+E', 'Samochód osobowy z przyczepą powyżej 750kg', 7, true)
ON CONFLICT (code) DO NOTHING;

-- Enable realtime dla wszystkich tabel
ALTER PUBLICATION supabase_realtime ADD TABLE driving_license_categories;
ALTER PUBLICATION supabase_realtime ADD TABLE employee_driving_licenses;
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_license_requirements;