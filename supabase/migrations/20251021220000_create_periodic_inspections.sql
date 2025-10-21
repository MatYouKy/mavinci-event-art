/*
  # Tabela przegladów okresowych

  1. Nowa tabela: periodic_inspections
    - id (uuid, primary key)
    - vehicle_id (uuid, foreign key)
    - inspection_type (text) - 'technical' lub 'emissions'
    - inspection_date (date) - data przeglądu
    - valid_until (date) - ważny do
    - next_inspection_due (date) - termin następnego przeglądu
    - inspection_station (text) - stacja diagnostyczna
    - inspector_name (text, optional) - imię inspektora
    - certificate_number (text, optional) - numer certyfikatu
    - odometer_reading (integer, optional) - przebieg
    - result (text) - 'passed', 'failed', 'conditional'
    - issues_found (text[], optional) - znalezione usterki
    - cost (numeric) - koszt
    - is_current (boolean) - czy jest aktualny
    - notes (text, optional)
    - created_at, updated_at

  2. Security: RLS enabled
*/

CREATE TABLE IF NOT EXISTS periodic_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  inspection_type text NOT NULL CHECK (inspection_type IN ('technical', 'emissions')),
  inspection_date date NOT NULL,
  valid_until date NOT NULL,
  next_inspection_due date,
  inspection_station text NOT NULL,
  inspector_name text,
  certificate_number text,
  odometer_reading integer,
  result text NOT NULL CHECK (result IN ('passed', 'failed', 'conditional')),
  issues_found text[],
  cost numeric(10,2) DEFAULT 0,
  is_current boolean DEFAULT false,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE periodic_inspections ENABLE ROW LEVEL SECURITY;

-- Policies: wszyscy z fleet_manage mogą wszystko
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

CREATE POLICY "Fleet managers can delete inspections"
  ON periodic_inspections FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

-- Trigger: oznacz poprzednie przeglądy jako nieaktualne
CREATE OR REPLACE FUNCTION manage_current_inspection()
RETURNS TRIGGER AS $$
BEGIN
  -- Jeśli nowy przegląd jest oznaczony jako aktualny
  IF NEW.is_current = true THEN
    -- Oznacz wszystkie inne przeglądy tego samego typu dla tego pojazdu jako nieaktualne
    UPDATE periodic_inspections
    SET is_current = false
    WHERE vehicle_id = NEW.vehicle_id
      AND inspection_type = NEW.inspection_type
      AND id != NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_manage_current_inspection
  AFTER INSERT OR UPDATE ON periodic_inspections
  FOR EACH ROW
  EXECUTE FUNCTION manage_current_inspection();

-- Index dla wydajności
CREATE INDEX IF NOT EXISTS idx_periodic_inspections_vehicle_id ON periodic_inspections(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_periodic_inspections_is_current ON periodic_inspections(vehicle_id, is_current) WHERE is_current = true;
