/*
  # Dodanie flagi is_in_use do event_vehicles

  1. Zmiana
    - Dodanie kolumny `is_in_use` boolean DEFAULT false
    - Automatyczna aktualizacja flagi przez trigger
    - Uproszczenie logiki sprawdzania statusu pojazdu

  2. Logika
    - is_in_use = true gdy pickup_timestamp IS NOT NULL AND return_timestamp IS NULL
    - is_in_use = false gdy return_timestamp IS NOT NULL lub pojazd nieodebrany
    - Trigger automatycznie zarządza flagą przy zmianach
*/

-- Dodaj kolumnę is_in_use
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_vehicles' AND column_name = 'is_in_use'
  ) THEN
    ALTER TABLE event_vehicles ADD COLUMN is_in_use boolean DEFAULT false;
    COMMENT ON COLUMN event_vehicles.is_in_use IS 'Czy pojazd jest obecnie w użytkowaniu (odebrany, ale nie zwrócony)';
  END IF;
END $$;

-- Ustaw is_in_use dla istniejących rekordów
UPDATE event_vehicles
SET is_in_use = (pickup_timestamp IS NOT NULL AND return_timestamp IS NULL);

-- Funkcja aktualizująca flagę is_in_use
CREATE OR REPLACE FUNCTION update_is_in_use_flag()
RETURNS TRIGGER AS $$
BEGIN
  -- Automatycznie ustaw is_in_use na podstawie timestamps
  IF NEW.pickup_timestamp IS NOT NULL AND NEW.return_timestamp IS NULL THEN
    NEW.is_in_use = true;
  ELSE
    NEW.is_in_use = false;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger do automatycznej aktualizacji is_in_use
DROP TRIGGER IF EXISTS trigger_update_is_in_use ON event_vehicles;
CREATE TRIGGER trigger_update_is_in_use
  BEFORE INSERT OR UPDATE OF pickup_timestamp, return_timestamp ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_is_in_use_flag();

-- Dodaj indeks dla szybkiego wyszukiwania pojazdów w użytkowaniu
CREATE INDEX IF NOT EXISTS idx_event_vehicles_is_in_use 
  ON event_vehicles(is_in_use) 
  WHERE is_in_use = true;

CREATE INDEX IF NOT EXISTS idx_event_vehicles_vehicle_in_use 
  ON event_vehicles(vehicle_id, is_in_use) 
  WHERE is_in_use = true;
