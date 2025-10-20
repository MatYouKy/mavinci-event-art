/*
  # System odbioru i zdania pojazdów dla kierowców

  1. Nowa tabela
    - `vehicle_handovers` - rejestracja odbioru i zdania pojazdu
      - `id` (uuid, primary key)
      - `event_vehicle_id` (uuid, foreign key to event_vehicles)
      - `driver_id` (uuid, foreign key to employees)
      - `handover_type` (text) - 'pickup' lub 'return'
      - `odometer_reading` (integer) - stan licznika
      - `timestamp` (timestamptz) - kiedy odebrał/zdał
      - `notes` (text) - uwagi kierowcy
      - `created_at` (timestamptz)

  2. Security (RLS)
    - Kierowcy mogą:
      - Dodawać odbiór/zdanie dla swoich pojazdów
      - Przeglądać swoje odbiory/zdania
    - Admini mogą wszystko

  3. Funkcje
    - Trigger do aktualizacji statusu pojazdu w event_vehicles
*/

-- Utwórz tabelę
CREATE TABLE IF NOT EXISTS vehicle_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_vehicle_id uuid NOT NULL REFERENCES event_vehicles(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES employees(id),
  handover_type text NOT NULL CHECK (handover_type IN ('pickup', 'return')),
  odometer_reading integer NOT NULL,
  timestamp timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Dodaj kolumnę do event_vehicles aby śledzić status odbioru
ALTER TABLE event_vehicles 
ADD COLUMN IF NOT EXISTS pickup_odometer integer,
ADD COLUMN IF NOT EXISTS pickup_timestamp timestamptz,
ADD COLUMN IF NOT EXISTS return_odometer integer,
ADD COLUMN IF NOT EXISTS return_timestamp timestamptz,
ADD COLUMN IF NOT EXISTS return_notes text;

-- Indeksy
CREATE INDEX IF NOT EXISTS idx_vehicle_handovers_event_vehicle 
  ON vehicle_handovers(event_vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_handovers_driver 
  ON vehicle_handovers(driver_id);

-- RLS
ALTER TABLE vehicle_handovers ENABLE ROW LEVEL SECURITY;

-- Policy dla kierowców - odczyt swoich handoverów
CREATE POLICY "Drivers can view own handovers"
  ON vehicle_handovers
  FOR SELECT
  TO authenticated
  USING (
    driver_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

-- Policy dla kierowców - dodawanie handoverów dla swoich pojazdów
CREATE POLICY "Drivers can add handovers for assigned vehicles"
  ON vehicle_handovers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    driver_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM event_vehicles
      WHERE event_vehicles.id = event_vehicle_id
      AND event_vehicles.driver_id = auth.uid()
    )
  );

-- Policy dla adminów - pełny dostęp
CREATE POLICY "Fleet managers can manage handovers"
  ON vehicle_handovers
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM employees
      WHERE employees.id = auth.uid()
      AND 'fleet_manage' = ANY(employees.permissions)
    )
  );

-- Funkcja aktualizująca event_vehicles po dodaniu handover
CREATE OR REPLACE FUNCTION update_event_vehicle_on_handover()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.handover_type = 'pickup' THEN
    UPDATE event_vehicles
    SET 
      pickup_odometer = NEW.odometer_reading,
      pickup_timestamp = NEW.timestamp
    WHERE id = NEW.event_vehicle_id;
  ELSIF NEW.handover_type = 'return' THEN
    UPDATE event_vehicles
    SET 
      return_odometer = NEW.odometer_reading,
      return_timestamp = NEW.timestamp,
      return_notes = NEW.notes
    WHERE id = NEW.event_vehicle_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger
DROP TRIGGER IF EXISTS trigger_update_event_vehicle_on_handover ON vehicle_handovers;
CREATE TRIGGER trigger_update_event_vehicle_on_handover
  AFTER INSERT ON vehicle_handovers
  FOR EACH ROW
  EXECUTE FUNCTION update_event_vehicle_on_handover();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_handovers;