/*
  # Wyspecjalizowane tabele serwisu

  1. Nowa tabela: periodic_inspections
    - Kontrole techniczne i przeglądy okresowe
    - Bez statusu - tylko data wykonania i data kolejnego przeglądu
    - Kasuje alert "Zbliżający się przegląd"

  2. Nowa tabela: oil_changes
    - Wymiany oleju i filtrów
    - Przebieg między wymianami
    - Alert przy 12000 km LUB 1 rok
    - Lista użytych części

  3. Nowa tabela: oil_change_parts
    - Części użyte podczas wymiany oleju
    - Typ oleju, ilość, numer części

  4. Nowa tabela: timing_belt_changes
    - Wymiany rozrządu
    - Data, przebieg, przebieg do następnej wymiany

  5. Nowa tabela: vehicle_issues
    - Usterki pojazdu (jak w equipment)
    - Priorytet niski/średni/wysoki
    - Wysoki priorytet blokuje pojazd
*/

-- Kontrole techniczne i przeglądy okresowe
CREATE TABLE IF NOT EXISTS periodic_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  inspection_type text NOT NULL CHECK (inspection_type IN ('technical_inspection', 'periodic_service')),
  inspection_date date NOT NULL,
  valid_until date NOT NULL,
  certificate_number text,
  performed_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  service_provider text,
  passed boolean DEFAULT true,
  defects_noted text,
  cost numeric(10,2) DEFAULT 0,
  odometer_reading integer NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Wymiany oleju
CREATE TABLE IF NOT EXISTS oil_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  change_date date NOT NULL,
  odometer_reading integer NOT NULL,
  previous_change_mileage integer,
  mileage_since_last_change integer GENERATED ALWAYS AS (odometer_reading - COALESCE(previous_change_mileage, 0)) STORED,
  next_change_due_mileage integer NOT NULL,
  next_change_due_date date NOT NULL,
  service_provider text,
  labor_cost numeric(10,2) DEFAULT 0,
  parts_cost numeric(10,2) DEFAULT 0,
  total_cost numeric(10,2) GENERATED ALWAYS AS (labor_cost + parts_cost) STORED,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Części użyte podczas wymiany oleju
CREATE TABLE IF NOT EXISTS oil_change_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oil_change_id uuid NOT NULL REFERENCES oil_changes(id) ON DELETE CASCADE,
  part_type text NOT NULL CHECK (part_type IN ('oil', 'oil_filter', 'air_filter', 'cabin_filter', 'other')),
  part_name text NOT NULL,
  part_number text,
  quantity numeric(10,2) NOT NULL DEFAULT 1,
  unit text DEFAULT 'szt',
  cost numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Wymiany rozrządu
CREATE TABLE IF NOT EXISTS timing_belt_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  change_date date NOT NULL,
  odometer_reading integer NOT NULL,
  next_change_due_mileage integer NOT NULL,
  service_provider text,
  labor_cost numeric(10,2) DEFAULT 0,
  parts_cost numeric(10,2) DEFAULT 0,
  total_cost numeric(10,2) GENERATED ALWAYS AS (labor_cost + parts_cost) STORED,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Usterki pojazdów
CREATE TABLE IF NOT EXISTS vehicle_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  reported_by uuid REFERENCES employees(id) ON DELETE SET NULL,
  reported_date timestamptz DEFAULT now(),
  assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL,
  resolved_date timestamptz,
  blocks_availability boolean DEFAULT false,
  resolution_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE periodic_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE oil_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oil_change_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE timing_belt_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_issues ENABLE ROW LEVEL SECURITY;

-- Policies dla periodic_inspections
CREATE POLICY "Fleet managers can view inspections"
  ON periodic_inspections FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert inspections"
  ON periodic_inspections FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update inspections"
  ON periodic_inspections FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Only admins can delete inspections"
  ON periodic_inspections FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.is_admin = true
    )
  );

-- Policies dla oil_changes
CREATE POLICY "Fleet managers can view oil changes"
  ON oil_changes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert oil changes"
  ON oil_changes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update oil changes"
  ON oil_changes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Only admins can delete oil changes"
  ON oil_changes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.is_admin = true
    )
  );

-- Policies dla oil_change_parts
CREATE POLICY "Fleet managers can view parts"
  ON oil_change_parts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN oil_changes oc ON oc.id = oil_change_parts.oil_change_id
      WHERE e.id = auth.uid()
      AND 'fleet_manage' = ANY(e.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert parts"
  ON oil_change_parts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN oil_changes oc ON oc.id = oil_change_parts.oil_change_id
      WHERE e.id = auth.uid()
      AND 'fleet_manage' = ANY(e.permissions)
    )
  );

CREATE POLICY "Fleet managers can update parts"
  ON oil_change_parts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees e
      JOIN oil_changes oc ON oc.id = oil_change_parts.oil_change_id
      WHERE e.id = auth.uid()
      AND 'fleet_manage' = ANY(e.permissions)
    )
  );

CREATE POLICY "Only admins can delete parts"
  ON oil_change_parts FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.is_admin = true
    )
  );

-- Policies dla timing_belt_changes
CREATE POLICY "Fleet managers can view timing belt changes"
  ON timing_belt_changes FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert timing belt changes"
  ON timing_belt_changes FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update timing belt changes"
  ON timing_belt_changes FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Only admins can delete timing belt changes"
  ON timing_belt_changes FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.is_admin = true
    )
  );

-- Policies dla vehicle_issues
CREATE POLICY "Fleet managers can view issues"
  ON vehicle_issues FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert issues"
  ON vehicle_issues FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update issues"
  ON vehicle_issues FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Only admins can delete issues"
  ON vehicle_issues FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND employees.is_admin = true
    )
  );

-- Trigger: automatycznie blokuj pojazd przy krytycznych usterkach
CREATE OR REPLACE FUNCTION auto_block_critical_issues()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.priority IN ('high', 'critical') AND NEW.status IN ('open', 'in_progress') THEN
    NEW.blocks_availability = true;
  END IF;

  IF NEW.status IN ('resolved', 'closed') THEN
    NEW.blocks_availability = false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_block_issues
  BEFORE INSERT OR UPDATE ON vehicle_issues
  FOR EACH ROW
  EXECUTE FUNCTION auto_block_critical_issues();

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_periodic_inspections_vehicle ON periodic_inspections(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_periodic_inspections_valid_until ON periodic_inspections(vehicle_id, valid_until);
CREATE INDEX IF NOT EXISTS idx_oil_changes_vehicle ON oil_changes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_oil_changes_next_due ON oil_changes(vehicle_id, next_change_due_date);
CREATE INDEX IF NOT EXISTS idx_timing_belt_changes_vehicle ON timing_belt_changes(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_issues_vehicle ON vehicle_issues(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_issues_status ON vehicle_issues(vehicle_id, status);
CREATE INDEX IF NOT EXISTS idx_vehicle_issues_priority ON vehicle_issues(priority, status);
