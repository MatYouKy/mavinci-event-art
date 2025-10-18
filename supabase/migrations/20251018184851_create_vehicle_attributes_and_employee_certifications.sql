/*
  # System właściwości pojazdów i certyfikatów pracowników

  1. Nowe tabele
    - `vehicle_attribute_types` - typy właściwości (hak, winda, DMC, itp.)
    - `vehicle_attributes` - właściwości przypisane do konkretnych pojazdów
    - `employee_certifications` - certyfikaty/uprawnienia pracowników (prawo jazdy, SEP, itp.)
    - `certification_types` - typy certyfikatów
    
  2. Zabezpieczenia
    - RLS dla wszystkich tabel
    - Polityki dla zalogowanych użytkowników
*/

-- Typy certyfikatów/uprawnień (prawo jazdy, SEP, UDT, itp.)
CREATE TABLE IF NOT EXISTS certification_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  icon text,
  requires_renewal boolean DEFAULT false,
  validity_period_months integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE certification_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view certification types"
  ON certification_types FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage certification types"
  ON certification_types FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Certyfikaty/uprawnienia pracowników
CREATE TABLE IF NOT EXISTS employee_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  certification_type_id uuid NOT NULL REFERENCES certification_types(id) ON DELETE CASCADE,
  issued_date date NOT NULL,
  expiry_date date,
  certification_number text,
  issuing_authority text,
  notes text,
  document_url text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(employee_id, certification_type_id, certification_number)
);

ALTER TABLE employee_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view employee certifications"
  ON employee_certifications FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage employee certifications"
  ON employee_certifications FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Typy właściwości pojazdów
CREATE TABLE IF NOT EXISTS vehicle_attribute_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  data_type text NOT NULL CHECK (data_type IN ('boolean', 'number', 'text', 'select')),
  options jsonb, -- dla typu 'select' - lista opcji
  unit text, -- jednostka dla liczb (kg, cm, itp.)
  icon text,
  category text, -- 'equipment', 'capacity', 'license_requirement', 'technical'
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE vehicle_attribute_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view vehicle attribute types"
  ON vehicle_attribute_types FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage vehicle attribute types"
  ON vehicle_attribute_types FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Właściwości przypisane do pojazdów
CREATE TABLE IF NOT EXISTS vehicle_attributes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  attribute_type_id uuid NOT NULL REFERENCES vehicle_attribute_types(id) ON DELETE CASCADE,
  value text NOT NULL, -- przechowujemy wszystko jako text, konwersja na froncie
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(vehicle_id, attribute_type_id)
);

ALTER TABLE vehicle_attributes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view vehicle attributes"
  ON vehicle_attributes FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage vehicle attributes"
  ON vehicle_attributes FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Tabela powiązań: które certyfikaty są wymagane dla danej właściwości pojazdu
CREATE TABLE IF NOT EXISTS vehicle_attribute_certification_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_type_id uuid NOT NULL REFERENCES vehicle_attribute_types(id) ON DELETE CASCADE,
  certification_type_id uuid NOT NULL REFERENCES certification_types(id) ON DELETE CASCADE,
  required_when_value text, -- wymagany certyfikat gdy wartość właściwości = X (np. DMC > 3500)
  created_at timestamptz DEFAULT now(),
  UNIQUE(attribute_type_id, certification_type_id)
);

ALTER TABLE vehicle_attribute_certification_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view attribute certification requirements"
  ON vehicle_attribute_certification_requirements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage attribute certification requirements"
  ON vehicle_attribute_certification_requirements FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Indeksy dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_employee_certifications_employee ON employee_certifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_certifications_type ON employee_certifications(certification_type_id);
CREATE INDEX IF NOT EXISTS idx_employee_certifications_expiry ON employee_certifications(expiry_date) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_vehicle_attributes_vehicle ON vehicle_attributes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_attributes_type ON vehicle_attributes(attribute_type_id);

-- Funkcja sprawdzająca czy pracownik ma wymagane certyfikaty dla pojazdu
CREATE OR REPLACE FUNCTION check_employee_vehicle_compatibility(
  p_employee_id uuid,
  p_vehicle_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
  v_missing_certs jsonb;
  v_expired_certs jsonb;
BEGIN
  -- Znajdź brakujące certyfikaty
  SELECT jsonb_agg(jsonb_build_object(
    'certification_type', ct.name,
    'attribute', vat.name,
    'required_for', va.value
  ))
  INTO v_missing_certs
  FROM vehicle_attributes va
  JOIN vehicle_attribute_certification_requirements vacr ON va.attribute_type_id = vacr.attribute_type_id
  JOIN certification_types ct ON vacr.certification_type_id = ct.id
  JOIN vehicle_attribute_types vat ON va.attribute_type_id = vat.id
  WHERE va.vehicle_id = p_vehicle_id
  AND NOT EXISTS (
    SELECT 1 FROM employee_certifications ec
    WHERE ec.employee_id = p_employee_id
    AND ec.certification_type_id = ct.id
    AND ec.is_active = true
    AND (ec.expiry_date IS NULL OR ec.expiry_date >= CURRENT_DATE)
  );

  -- Znajdź wygasłe certyfikaty
  SELECT jsonb_agg(jsonb_build_object(
    'certification_type', ct.name,
    'expiry_date', ec.expiry_date
  ))
  INTO v_expired_certs
  FROM employee_certifications ec
  JOIN certification_types ct ON ec.certification_type_id = ct.id
  WHERE ec.employee_id = p_employee_id
  AND ec.is_active = true
  AND ec.expiry_date < CURRENT_DATE;

  v_result := jsonb_build_object(
    'compatible', (v_missing_certs IS NULL),
    'missing_certifications', COALESCE(v_missing_certs, '[]'::jsonb),
    'expired_certifications', COALESCE(v_expired_certs, '[]'::jsonb)
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Wstaw przykładowe typy certyfikatów
INSERT INTO certification_types (name, description, icon, requires_renewal, validity_period_months) VALUES
  ('Prawo jazdy kat. B', 'Podstawowe prawo jazdy do 3.5t', 'Car', true, 180),
  ('Prawo jazdy kat. C', 'Prawo jazdy do pojazdów powyżej 3.5t', 'Truck', true, 60),
  ('Prawo jazdy kat. C+E', 'Prawo jazdy do pojazdów z przyczepą powyżej 3.5t', 'TruckIcon', true, 60),
  ('Prawo jazdy kat. D', 'Prawo jazdy do przewozu osób', 'Bus', true, 60),
  ('SEP do 1kV', 'Świadectwo kwalifikacyjne SEP', 'Zap', true, 60),
  ('UDT do dźwigów', 'Uprawnienia do obsługi dźwigów', 'CraneIcon', true, 60),
  ('Uprawnienia do wózków widłowych', 'Obsługa wózków widłowych', 'Forklift', true, 60),
  ('Kurs pierwszej pomocy', 'Certyfikat pierwszej pomocy', 'Heart', true, 24)
ON CONFLICT (name) DO NOTHING;

-- Wstaw przykładowe typy właściwości pojazdów
INSERT INTO vehicle_attribute_types (name, description, data_type, unit, icon, category) VALUES
  ('Hak holowniczy', 'Pojazd wyposażony w hak holowniczy', 'boolean', NULL, 'Link', 'equipment'),
  ('Winda załadowcza', 'Pojazd wyposażony w windę załadowczą', 'boolean', NULL, 'ArrowUpDown', 'equipment'),
  ('DMC', 'Dopuszczalna masa całkowita', 'number', 'kg', 'Weight', 'capacity'),
  ('Ładowność', 'Maksymalna ładowność', 'number', 'kg', 'Package', 'capacity'),
  ('Liczba miejsc siedzących', 'Ilość miejsc dla pasażerów', 'number', 'os.', 'Users', 'capacity'),
  ('Wymagana kategoria prawa jazdy', 'Minimalna kategoria prawa jazdy', 'select', NULL, 'FileCheck', 'license_requirement'),
  ('Paka otwarta', 'Pojazd typu pick-up z otwartą paką', 'boolean', NULL, 'Box', 'equipment'),
  ('Klimatyzacja', 'Pojazd z klimatyzacją', 'boolean', NULL, 'Wind', 'equipment'),
  ('Napęd 4x4', 'Pojazd z napędem na cztery koła', 'boolean', NULL, 'Compass', 'technical'),
  ('Wysokość zabudowy', 'Wysokość przestrzeni ładunkowej', 'number', 'cm', 'Ruler', 'capacity')
ON CONFLICT (name) DO NOTHING;

-- Aktualizuj opcje dla pola "Wymagana kategoria prawa jazdy"
UPDATE vehicle_attribute_types 
SET options = '["B", "C", "C+E", "D"]'::jsonb
WHERE name = 'Wymagana kategoria prawa jazdy';

-- Powiąż wymagania certyfikatów z właściwościami
INSERT INTO vehicle_attribute_certification_requirements (attribute_type_id, certification_type_id, required_when_value)
SELECT 
  vat.id,
  ct.id,
  'C'
FROM vehicle_attribute_types vat
CROSS JOIN certification_types ct
WHERE vat.name = 'Wymagana kategoria prawa jazdy'
AND ct.name = 'Prawo jazdy kat. C'
ON CONFLICT DO NOTHING;

INSERT INTO vehicle_attribute_certification_requirements (attribute_type_id, certification_type_id, required_when_value)
SELECT 
  vat.id,
  ct.id,
  'C+E'
FROM vehicle_attribute_types vat
CROSS JOIN certification_types ct
WHERE vat.name = 'Wymagana kategoria prawa jazdy'
AND ct.name = 'Prawo jazdy kat. C+E'
ON CONFLICT DO NOTHING;

INSERT INTO vehicle_attribute_certification_requirements (attribute_type_id, certification_type_id, required_when_value)
SELECT 
  vat.id,
  ct.id,
  'D'
FROM vehicle_attribute_types vat
CROSS JOIN certification_types ct
WHERE vat.name = 'Wymagana kategoria prawa jazdy'
AND ct.name = 'Prawo jazdy kat. D'
ON CONFLICT DO NOTHING;

-- Dodaj trigger dla updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_certification_types_updated_at BEFORE UPDATE ON certification_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_employee_certifications_updated_at BEFORE UPDATE ON employee_certifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vehicle_attribute_types_updated_at BEFORE UPDATE ON vehicle_attribute_types
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_vehicle_attributes_updated_at BEFORE UPDATE ON vehicle_attributes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
