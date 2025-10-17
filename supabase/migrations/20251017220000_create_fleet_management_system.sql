/*
  # System Zarządzania Flotą Pojazdów

  ## Funkcjonalność
  Kompletny system CRM do zarządzania flotą pojazdów firmowych

  ## 1. Tabele

  ### vehicles
  Główna tabela pojazdów z pełnymi informacjami:
  - Dane podstawowe (marka, model, VIN, rejestracja)
  - Dane techniczne (rok, silnik, moc, pojemność)
  - Status i lokalizacja
  - Koszty zakupu i leasing
  - Przebieg
  - Zdjęcia i dokumenty

  ### fuel_entries
  Historia tankowań:
  - Data i miejsce tankowania
  - Ilość i rodzaj paliwa
  - Koszt
  - Przebieg przy tankowaniu
  - Średnie zużycie

  ### maintenance_records
  Historia konserwacji i napraw:
  - Typ (przegląd, naprawa, serwis)
  - Data i przebieg
  - Opis prac
  - Koszty części i robocizny
  - Warsztat
  - Następny przegląd

  ### insurance_policies
  Ubezpieczenia pojazdów:
  - Typ (OC, AC, NNW)
  - Numer polisy
  - Ubezpieczyciel
  - Datyważności
  - Składka
  - Zakres ochrony

  ### vehicle_documents
  Dokumenty pojazdów:
  - Dowód rejestracyjny
  - Karta pojazdu
  - Przeglądy techniczne
  - Faktury
  - Umowy leasingowe

  ### vehicle_assignments
  Przypisania pojazdów do pracowników:
  - Okres przypisania
  - Typ (służbowy, prywatny)
  - Limit kilometrów
  - Notatki

  ### mileage_logs
  Dziennik przebiegu:
  - Data
  - Przebieg początkowy/końcowy
  - Trasa
  - Cel podróży
  - Pracownik

  ## 2. Bezpieczeństwo (RLS)
  - Admini: pełen dostęp
  - Użytkownicy z uprawnieniem 'fleet_manage': zarządzanie flotą
  - Użytkownicy z uprawnieniem 'fleet_view': odczyt
  - Przypisani kierowcy: odczyt swojego pojazdu i dodawanie wpisów

  ## 3. Triggery i Funkcje
  - Automatyczne obliczanie średniego zużycia paliwa
  - Powiadomienia o zbliżających się przeglądach
  - Powiadomienia o wygasających ubezpieczeniach
  - Automatyczna aktualizacja przebiegu
  - Historia zmian
*/

-- ============================================================================
-- 1. TABELA: vehicles (Pojazdy)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Dane podstawowe
  name text NOT NULL, -- Nazwa/alias pojazdu (np. "Dostawczak główny", "Bus eventowy")
  brand text NOT NULL, -- Marka (np. "Mercedes", "Ford")
  model text NOT NULL, -- Model (np. "Sprinter", "Transit")
  vin text UNIQUE, -- Numer VIN
  registration_number text UNIQUE, -- Numer rejestracyjny
  registration_date date, -- Data pierwszej rejestracji

  -- Dane techniczne
  year integer, -- Rok produkcji
  color text,
  engine_type text, -- Typ silnika (benzyna, diesel, elektryczny, hybryda)
  engine_capacity integer, -- Pojemność silnika w cm³
  power_hp integer, -- Moc w KM
  power_kw integer, -- Moc w kW
  fuel_type text, -- Typ paliwa (benzyna 95/98, diesel, LPG, elektryczny)
  transmission text, -- Skrzynia biegów (manualna, automatyczna)
  drive_type text, -- Napęd (przedni, tylny, 4x4)
  number_of_seats integer,
  max_load_kg integer, -- Maksymalne obciążenie w kg

  -- Status i wykorzystanie
  status text DEFAULT 'active', -- active, inactive, in_service, sold, scrapped
  ownership_type text, -- owned, leased, rented
  category text, -- personal_car, van, truck, bus, motorcycle, trailer

  -- Koszty i wartość
  purchase_price numeric(10, 2),
  purchase_date date,
  current_value numeric(10, 2),
  leasing_company text,
  leasing_monthly_cost numeric(10, 2),
  leasing_end_date date,

  -- Przebieg
  initial_mileage integer DEFAULT 0, -- Przebieg początkowy
  current_mileage integer DEFAULT 0, -- Aktualny przebieg

  -- Lokalizacja i przechowywanie
  current_location text, -- Aktualna lokalizacja
  parking_location text, -- Miejsce parkowania
  garage_location text, -- Garaż/baza

  -- Zdjęcia
  primary_image_url text,
  images jsonb DEFAULT '[]'::jsonb, -- Tablica URLi do zdjęć

  -- Uwagi i notatki
  description text,
  notes text,
  tags text[] DEFAULT '{}',

  -- Metadata
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES employees(id),

  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('active', 'inactive', 'in_service', 'sold', 'scrapped')),
  CONSTRAINT valid_ownership CHECK (ownership_type IN ('owned', 'leased', 'rented')),
  CONSTRAINT valid_mileage CHECK (current_mileage >= initial_mileage)
);

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_vehicles_status ON vehicles(status);
CREATE INDEX IF NOT EXISTS idx_vehicles_category ON vehicles(category);
CREATE INDEX IF NOT EXISTS idx_vehicles_registration ON vehicles(registration_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_created_at ON vehicles(created_at);

-- ============================================================================
-- 2. TABELA: fuel_entries (Tankowania)
-- ============================================================================

CREATE TABLE IF NOT EXISTS fuel_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Data i miejsce
  date date NOT NULL DEFAULT CURRENT_DATE,
  time time,
  location text, -- Stacja paliw
  odometer_reading integer NOT NULL, -- Przebieg przy tankowaniu

  -- Paliwo
  fuel_type text NOT NULL, -- benzyna95, benzyna98, diesel, LPG, elektryczny
  liters numeric(8, 2) NOT NULL, -- Ilość litrów/kWh
  price_per_liter numeric(8, 2) NOT NULL,
  total_cost numeric(10, 2) NOT NULL,

  -- Obliczenia
  distance_since_last integer, -- Przejechane km od ostatniego tankowania
  avg_consumption numeric(5, 2), -- Średnie zużycie l/100km

  -- Płatność
  payment_method text, -- cash, card, fuel_card, invoice
  receipt_number text,
  receipt_url text, -- URL do skanu paragonu

  -- Kto tankował
  filled_by uuid REFERENCES employees(id),

  -- Uwagi
  is_full_tank boolean DEFAULT true,
  notes text,

  created_at timestamptz DEFAULT now(),

  CONSTRAINT valid_fuel_type CHECK (fuel_type IN ('benzyna95', 'benzyna98', 'diesel', 'LPG', 'elektryczny', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_fuel_vehicle ON fuel_entries(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fuel_date ON fuel_entries(date);

-- ============================================================================
-- 3. TABELA: maintenance_records (Konserwacja i naprawy)
-- ============================================================================

CREATE TABLE IF NOT EXISTS maintenance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Typ i kategoria
  type text NOT NULL, -- service, repair, inspection, tire_change, oil_change, other
  category text, -- routine, urgent, warranty, recall

  -- Data i przebieg
  date date NOT NULL,
  odometer_reading integer NOT NULL,

  -- Opis
  title text NOT NULL,
  description text,
  work_performed text, -- Szczegółowy opis wykonanych prac

  -- Warsztat
  service_provider text, -- Nazwa warsztatu
  service_provider_address text,
  service_provider_phone text,

  -- Koszty
  labor_cost numeric(10, 2) DEFAULT 0,
  parts_cost numeric(10, 2) DEFAULT 0,
  total_cost numeric(10, 2) GENERATED ALWAYS AS (labor_cost + parts_cost) STORED,

  -- Części zamienne
  parts_replaced jsonb DEFAULT '[]'::jsonb, -- [{name, part_number, quantity, cost}]

  -- Dokumenty
  invoice_number text,
  invoice_url text,
  warranty_end_date date,

  -- Następna konserwacja
  next_service_date date,
  next_service_mileage integer,
  reminder_sent boolean DEFAULT false,

  -- Status
  status text DEFAULT 'completed', -- scheduled, in_progress, completed, cancelled

  -- Kto zlecił
  requested_by uuid REFERENCES employees(id),

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT valid_maintenance_type CHECK (type IN ('service', 'repair', 'inspection', 'tire_change', 'oil_change', 'other')),
  CONSTRAINT valid_maintenance_status CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_maintenance_vehicle ON maintenance_records(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_date ON maintenance_records(date);
CREATE INDEX IF NOT EXISTS idx_maintenance_next_service ON maintenance_records(next_service_date);

-- ============================================================================
-- 4. TABELA: insurance_policies (Ubezpieczenia)
-- ============================================================================

CREATE TABLE IF NOT EXISTS insurance_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Typ ubezpieczenia
  type text NOT NULL, -- oc, ac, nnw, assistance, gap

  -- Ubezpieczyciel
  insurance_company text NOT NULL,
  policy_number text NOT NULL,

  -- Daty
  start_date date NOT NULL,
  end_date date NOT NULL,
  issue_date date,

  -- Składka
  premium_amount numeric(10, 2) NOT NULL,
  payment_frequency text, -- annual, semi_annual, quarterly, monthly

  -- Zakres ochrony
  coverage_details jsonb DEFAULT '{}'::jsonb,
  deductible numeric(10, 2), -- Franszyza
  sum_insured numeric(10, 2), -- Suma ubezpieczenia

  -- Dokumenty
  policy_document_url text,

  -- Status
  status text DEFAULT 'active', -- active, expired, cancelled
  auto_renewal boolean DEFAULT false,
  reminder_sent boolean DEFAULT false,

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT valid_insurance_type CHECK (type IN ('oc', 'ac', 'nnw', 'assistance', 'gap', 'other')),
  CONSTRAINT valid_dates CHECK (end_date > start_date),
  CONSTRAINT valid_insurance_status CHECK (status IN ('active', 'expired', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_insurance_vehicle ON insurance_policies(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_insurance_end_date ON insurance_policies(end_date);
CREATE INDEX IF NOT EXISTS idx_insurance_status ON insurance_policies(status);

-- ============================================================================
-- 5. TABELA: vehicle_documents (Dokumenty pojazdu)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,

  -- Typ dokumentu
  type text NOT NULL, -- registration, technical_inspection, lease_agreement, purchase_invoice, other

  -- Podstawowe info
  title text NOT NULL,
  description text,
  document_number text,

  -- Daty
  issue_date date,
  expiry_date date,

  -- Plik
  file_url text NOT NULL,
  file_name text,
  file_size integer, -- w bajtach
  file_type text, -- pdf, jpg, png, etc

  -- Przypomnienia
  reminder_days_before integer, -- Ile dni przed wygaśnięciem przypomnieć
  reminder_sent boolean DEFAULT false,

  tags text[] DEFAULT '{}',
  notes text,

  uploaded_by uuid REFERENCES employees(id),
  created_at timestamptz DEFAULT now(),

  CONSTRAINT valid_document_type CHECK (type IN ('registration', 'technical_inspection', 'lease_agreement', 'purchase_invoice', 'warranty', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_documents_vehicle ON vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_documents_expiry ON vehicle_documents(expiry_date);

-- ============================================================================
-- 6. TABELA: vehicle_assignments (Przypisania pojazdów)
-- ============================================================================

CREATE TABLE IF NOT EXISTS vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,

  -- Okres przypisania
  start_date date NOT NULL,
  end_date date,

  -- Typ przypisania
  assignment_type text DEFAULT 'temporary', -- permanent, temporary, pool
  purpose text, -- business, mixed, personal

  -- Limity
  mileage_limit_monthly integer,
  fuel_card_assigned boolean DEFAULT false,
  fuel_card_number text,

  -- Przebieg przy przypisaniu
  mileage_at_start integer,
  mileage_at_end integer,

  -- Status
  status text DEFAULT 'active', -- active, ended, cancelled

  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT valid_assignment_dates CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT valid_assignment_type CHECK (assignment_type IN ('permanent', 'temporary', 'pool')),
  CONSTRAINT valid_assignment_status CHECK (status IN ('active', 'ended', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_assignments_vehicle ON vehicle_assignments(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_assignments_employee ON vehicle_assignments(employee_id);
CREATE INDEX IF NOT EXISTS idx_assignments_status ON vehicle_assignments(status);

-- ============================================================================
-- 7. TABELA: mileage_logs (Dziennik przebiegu)
-- ============================================================================

CREATE TABLE IF NOT EXISTS mileage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES employees(id),

  -- Data
  date date NOT NULL,

  -- Przebieg
  odometer_start integer NOT NULL,
  odometer_end integer NOT NULL,
  distance integer GENERATED ALWAYS AS (odometer_end - odometer_start) STORED,

  -- Trasa
  route_start text, -- Punkt początkowy
  route_end text, -- Punkt końcowy
  route_description text, -- Szczegóły trasy

  -- Cel podróży
  purpose text NOT NULL, -- business, private, commute
  trip_type text, -- one_way, round_trip

  -- Event (opcjonalnie powiązanie z eventem)
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,

  -- Uwagi
  notes text,

  created_at timestamptz DEFAULT now(),

  CONSTRAINT valid_mileage CHECK (odometer_end > odometer_start),
  CONSTRAINT valid_purpose CHECK (purpose IN ('business', 'private', 'commute'))
);

CREATE INDEX IF NOT EXISTS idx_mileage_vehicle ON mileage_logs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_mileage_employee ON mileage_logs(employee_id);
CREATE INDEX IF NOT EXISTS idx_mileage_date ON mileage_logs(date);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger: aktualizacja updated_at
CREATE OR REPLACE FUNCTION update_vehicle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vehicles_updated_at
  BEFORE UPDATE ON vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_updated_at();

CREATE TRIGGER maintenance_updated_at
  BEFORE UPDATE ON maintenance_records
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_updated_at();

CREATE TRIGGER insurance_updated_at
  BEFORE UPDATE ON insurance_policies
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_updated_at();

CREATE TRIGGER assignments_updated_at
  BEFORE UPDATE ON vehicle_assignments
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_updated_at();

-- Trigger: automatyczna aktualizacja przebiegu pojazdu
CREATE OR REPLACE FUNCTION update_vehicle_mileage()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE vehicles
  SET current_mileage = GREATEST(current_mileage, NEW.odometer_reading)
  WHERE id = NEW.vehicle_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fuel_update_mileage
  AFTER INSERT ON fuel_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_mileage();

CREATE TRIGGER maintenance_update_mileage
  AFTER INSERT ON maintenance_records
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_mileage();

-- Trigger: obliczanie średniego zużycia paliwa
CREATE OR REPLACE FUNCTION calculate_fuel_consumption()
RETURNS TRIGGER AS $$
DECLARE
  last_fuel fuel_entries;
BEGIN
  -- Pobierz ostatnie tankowanie
  SELECT * INTO last_fuel
  FROM fuel_entries
  WHERE vehicle_id = NEW.vehicle_id
    AND id != NEW.id
    AND odometer_reading < NEW.odometer_reading
  ORDER BY odometer_reading DESC
  LIMIT 1;

  IF FOUND THEN
    NEW.distance_since_last = NEW.odometer_reading - last_fuel.odometer_reading;

    -- Oblicz średnie zużycie tylko dla pełnego baku
    IF NEW.is_full_tank AND last_fuel.is_full_tank THEN
      NEW.avg_consumption = ROUND((NEW.liters / NEW.distance_since_last * 100)::numeric, 2);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER fuel_calculate_consumption
  BEFORE INSERT ON fuel_entries
  FOR EACH ROW
  EXECUTE FUNCTION calculate_fuel_consumption();

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fuel_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mileage_logs ENABLE ROW LEVEL SECURITY;

-- Vehicles policies
CREATE POLICY "Admini i fleet_manage mają pełen dostęp do vehicles"
  ON vehicles FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

CREATE POLICY "fleet_view może przeglądać vehicles"
  ON vehicles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions) OR 'fleet_view' = ANY(permissions))
    )
  );

CREATE POLICY "Przypisani kierowcy widzą swoje vehicles"
  ON vehicles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_assignments
      WHERE vehicle_id = vehicles.id
      AND employee_id = auth.uid()
      AND status = 'active'
    )
  );

-- Fuel entries policies
CREATE POLICY "Admini i fleet_manage mają pełen dostęp do fuel_entries"
  ON fuel_entries FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

CREATE POLICY "fleet_view może przeglądać fuel_entries"
  ON fuel_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions) OR 'fleet_view' = ANY(permissions))
    )
  );

CREATE POLICY "Przypisani kierowcy mogą dodawać wpisy fuel dla swojego pojazdu"
  ON fuel_entries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM vehicle_assignments
      WHERE vehicle_id = fuel_entries.vehicle_id
      AND employee_id = auth.uid()
      AND status = 'active'
    )
  );

CREATE POLICY "Przypisani kierowcy widzą fuel swojego pojazdu"
  ON fuel_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM vehicle_assignments
      WHERE vehicle_id = fuel_entries.vehicle_id
      AND employee_id = auth.uid()
      AND status = 'active'
    )
  );

-- Maintenance records policies
CREATE POLICY "Admini i fleet_manage mają pełen dostęp do maintenance"
  ON maintenance_records FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

CREATE POLICY "fleet_view może przeglądać maintenance"
  ON maintenance_records FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions) OR 'fleet_view' = ANY(permissions))
    )
  );

-- Insurance policies
CREATE POLICY "Admini i fleet_manage mają pełen dostęp do insurance"
  ON insurance_policies FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

CREATE POLICY "fleet_view może przeglądać insurance"
  ON insurance_policies FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions) OR 'fleet_view' = ANY(permissions))
    )
  );

-- Documents policies
CREATE POLICY "Admini i fleet_manage mają pełen dostęp do documents"
  ON vehicle_documents FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

CREATE POLICY "fleet_view może przeglądać documents"
  ON vehicle_documents FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions) OR 'fleet_view' = ANY(permissions))
    )
  );

-- Assignments policies
CREATE POLICY "Admini i fleet_manage mają pełen dostęp do assignments"
  ON vehicle_assignments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

CREATE POLICY "Wszyscy mogą przeglądać swoje assignments"
  ON vehicle_assignments FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

-- Mileage logs policies
CREATE POLICY "Admini i fleet_manage mają pełen dostęp do mileage"
  ON mileage_logs FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE id = auth.uid()
      AND ('admin' = ANY(permissions) OR 'fleet_manage' = ANY(permissions))
    )
  );

CREATE POLICY "Kierowcy mogą dodawać swoje mileage"
  ON mileage_logs FOR INSERT TO authenticated
  WITH CHECK (employee_id = auth.uid());

CREATE POLICY "Kierowcy widzą swoje mileage"
  ON mileage_logs FOR SELECT TO authenticated
  USING (employee_id = auth.uid());

-- Service role ma pełen dostęp
CREATE POLICY "Service role ma pełen dostęp do vehicles"
  ON vehicles FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role ma pełen dostęp do fuel_entries"
  ON fuel_entries FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role ma pełen dostęp do maintenance_records"
  ON maintenance_records FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role ma pełen dostęp do insurance_policies"
  ON insurance_policies FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role ma pełen dostęp do vehicle_documents"
  ON vehicle_documents FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role ma pełen dostęp do vehicle_assignments"
  ON vehicle_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Service role ma pełen dostęp do mileage_logs"
  ON mileage_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- WIDOKI I FUNKCJE POMOCNICZE
-- ============================================================================

-- Widok: pełne informacje o pojazdach z aktywnymi przypisaniami
CREATE OR REPLACE VIEW fleet_overview AS
SELECT
  v.*,
  va.employee_id as assigned_to,
  e.name as assigned_employee_name,
  e.surname as assigned_employee_surname,
  (
    SELECT COUNT(*)
    FROM maintenance_records mr
    WHERE mr.vehicle_id = v.id
    AND mr.next_service_date < CURRENT_DATE + INTERVAL '30 days'
    AND mr.next_service_date > CURRENT_DATE
  ) as upcoming_services,
  (
    SELECT COUNT(*)
    FROM insurance_policies ip
    WHERE ip.vehicle_id = v.id
    AND ip.end_date < CURRENT_DATE + INTERVAL '60 days'
    AND ip.end_date > CURRENT_DATE
    AND ip.status = 'active'
  ) as expiring_insurance,
  (
    SELECT SUM(total_cost)
    FROM maintenance_records mr
    WHERE mr.vehicle_id = v.id
    AND mr.date >= CURRENT_DATE - INTERVAL '12 months'
  ) as yearly_maintenance_cost,
  (
    SELECT SUM(total_cost)
    FROM fuel_entries fe
    WHERE fe.vehicle_id = v.id
    AND fe.date >= CURRENT_DATE - INTERVAL '12 months'
  ) as yearly_fuel_cost,
  (
    SELECT AVG(avg_consumption)
    FROM fuel_entries fe
    WHERE fe.vehicle_id = v.id
    AND fe.avg_consumption IS NOT NULL
    AND fe.date >= CURRENT_DATE - INTERVAL '3 months'
  ) as avg_fuel_consumption_3months
FROM vehicles v
LEFT JOIN vehicle_assignments va ON va.vehicle_id = v.id AND va.status = 'active'
LEFT JOIN employees e ON e.id = va.employee_id;

GRANT SELECT ON fleet_overview TO authenticated;

-- Funkcja: sprawdź dostępność pojazdu w okresie
CREATE OR REPLACE FUNCTION check_vehicle_availability(
  p_vehicle_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1
    FROM vehicle_assignments
    WHERE vehicle_id = p_vehicle_id
    AND status = 'active'
    AND (
      (start_date <= p_end_date AND (end_date IS NULL OR end_date >= p_start_date))
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja: generuj raport kosztów pojazdu
CREATE OR REPLACE FUNCTION get_vehicle_cost_report(
  p_vehicle_id uuid,
  p_start_date date DEFAULT CURRENT_DATE - INTERVAL '1 year',
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  fuel_cost numeric,
  maintenance_cost numeric,
  insurance_cost numeric,
  total_cost numeric,
  distance_traveled integer
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(fe.total_cost), 0) as fuel_cost,
    COALESCE(SUM(mr.total_cost), 0) as maintenance_cost,
    COALESCE(SUM(ip.premium_amount), 0) as insurance_cost,
    COALESCE(SUM(fe.total_cost), 0) + COALESCE(SUM(mr.total_cost), 0) + COALESCE(SUM(ip.premium_amount), 0) as total_cost,
    (
      SELECT COALESCE(MAX(odometer_reading), 0) - COALESCE(MIN(odometer_reading), 0)
      FROM fuel_entries
      WHERE vehicle_id = p_vehicle_id
      AND date BETWEEN p_start_date AND p_end_date
    ) as distance_traveled
  FROM vehicles v
  LEFT JOIN fuel_entries fe ON fe.vehicle_id = v.id AND fe.date BETWEEN p_start_date AND p_end_date
  LEFT JOIN maintenance_records mr ON mr.vehicle_id = v.id AND mr.date BETWEEN p_start_date AND p_end_date
  LEFT JOIN insurance_policies ip ON ip.vehicle_id = v.id AND ip.start_date <= p_end_date AND ip.end_date >= p_start_date
  WHERE v.id = p_vehicle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- KOMENTARZE
-- ============================================================================

COMMENT ON TABLE vehicles IS 'Tabela główna zarządzania flotą pojazdów - zawiera wszystkie informacje o pojazdach';
COMMENT ON TABLE fuel_entries IS 'Historia tankowań i zużycia paliwa';
COMMENT ON TABLE maintenance_records IS 'Historia konserwacji, przeglądów i napraw';
COMMENT ON TABLE insurance_policies IS 'Ubezpieczenia pojazdów (OC, AC, NNW itp.)';
COMMENT ON TABLE vehicle_documents IS 'Dokumenty pojazdów (dowody rejestracyjne, faktury, umowy)';
COMMENT ON TABLE vehicle_assignments IS 'Przypisania pojazdów do pracowników';
COMMENT ON TABLE mileage_logs IS 'Dziennik przebiegu i tras';
