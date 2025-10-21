/*
  # Tabela serwisu i napraw

  1. Nowa tabela: maintenance_repairs
    - id (uuid, primary key)
    - vehicle_id (uuid, foreign key)
    - repair_type (text) - typ serwisu/naprawy
    - severity (text) - 'low', 'medium', 'high'
    - title (text) - tytuł naprawy
    - description (text, optional)
    - reported_date (date)
    - started_date (date, optional)
    - completed_date (date, optional)
    - estimated_completion_date (date, optional)
    - odometer_reading (integer)
    - service_provider (text, optional) - warsztat
    - labor_cost (numeric)
    - parts_cost (numeric)
    - other_cost (numeric)
    - total_cost (numeric)
    - status (text) - 'scheduled', 'in_progress', 'completed', 'cancelled'
    - blocks_availability (boolean) - czy blokuje dostępność pojazdu
    - assigned_to (uuid, optional) - przypisany pracownik
    - notes (text, optional)
    - created_at, updated_at

  2. Security: RLS enabled
*/

CREATE TABLE IF NOT EXISTS maintenance_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  repair_type text NOT NULL CHECK (repair_type IN ('service', 'repair', 'tire_change', 'oil_change', 'brake_service', 'battery_replacement', 'other')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  title text NOT NULL,
  description text,
  reported_date date NOT NULL DEFAULT CURRENT_DATE,
  started_date date,
  completed_date date,
  estimated_completion_date date,
  odometer_reading integer NOT NULL,
  service_provider text,
  labor_cost numeric(10,2) DEFAULT 0,
  parts_cost numeric(10,2) DEFAULT 0,
  other_cost numeric(10,2) DEFAULT 0,
  total_cost numeric(10,2) GENERATED ALWAYS AS (labor_cost + parts_cost + other_cost) STORED,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
  blocks_availability boolean DEFAULT false,
  assigned_to uuid REFERENCES employees(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE maintenance_repairs ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Fleet managers can view repairs"
  ON maintenance_repairs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can insert repairs"
  ON maintenance_repairs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can update repairs"
  ON maintenance_repairs FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

CREATE POLICY "Fleet managers can delete repairs"
  ON maintenance_repairs FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

-- Trigger: automatycznie blokuj pojazd przy naprawie wysokiej wagi
CREATE OR REPLACE FUNCTION auto_block_high_severity_repairs()
RETURNS TRIGGER AS $$
BEGIN
  -- Jeśli naprawa jest wysokiej wagi i w trakcie lub zaplanowana
  IF NEW.severity = 'high' AND NEW.status IN ('scheduled', 'in_progress') THEN
    NEW.blocks_availability = true;
  END IF;

  -- Jeśli naprawa została ukończona, odblokuj
  IF NEW.status = 'completed' THEN
    NEW.blocks_availability = false;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_block_repairs
  BEFORE INSERT OR UPDATE ON maintenance_repairs
  FOR EACH ROW
  EXECUTE FUNCTION auto_block_high_severity_repairs();

-- Index
CREATE INDEX IF NOT EXISTS idx_maintenance_repairs_vehicle_id ON maintenance_repairs(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_repairs_status ON maintenance_repairs(vehicle_id, status);
