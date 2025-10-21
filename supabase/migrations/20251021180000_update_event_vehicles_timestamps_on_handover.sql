/*
  # Aktualizacja timestamps w event_vehicles po handover

  1. Zmiany
    - Dodanie funkcji do aktualizacji pickup_timestamp i return_timestamp w event_vehicles
    - Gdy kierowca odbiera pojazd - zapisuje pickup_timestamp i pickup_odometer
    - Gdy kierowca zdaje pojazd - zapisuje return_timestamp i return_odometer

  2. Funkcjonalność
    - Automatyczna aktualizacja event_vehicles po zapisaniu vehicle_handover
    - Umożliwia wyświetlanie statusu "W użytkowaniu" w czasie rzeczywistym
*/

-- Funkcja aktualizująca timestamps w event_vehicles po handover
CREATE OR REPLACE FUNCTION update_event_vehicle_timestamps_on_handover()
RETURNS TRIGGER AS $$
BEGIN
  -- Aktualizuj event_vehicles w zależności od typu handover
  IF NEW.handover_type = 'pickup' THEN
    UPDATE event_vehicles
    SET
      pickup_timestamp = NEW.timestamp,
      pickup_odometer = NEW.odometer_reading
    WHERE id = NEW.event_vehicle_id;
  ELSIF NEW.handover_type = 'return' THEN
    UPDATE event_vehicles
    SET
      return_timestamp = NEW.timestamp,
      return_odometer = NEW.odometer_reading,
      return_notes = NEW.notes
    WHERE id = NEW.event_vehicle_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger do aktualizacji timestamps
DROP TRIGGER IF EXISTS trigger_update_event_vehicle_timestamps ON vehicle_handovers;
CREATE TRIGGER trigger_update_event_vehicle_timestamps
  AFTER INSERT ON vehicle_handovers
  FOR EACH ROW
  EXECUTE FUNCTION update_event_vehicle_timestamps_on_handover();
