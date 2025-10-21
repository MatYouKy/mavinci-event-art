/*
  # Naprawa aktualizacji timestamps przy handover

  1. Problem
    - Funkcja aktualizowała ZAWSZE oba pola (pickup i return)
    - Powodowało to nadpisywanie starych wartości
    - Pojazd nigdy nie był w użytkowaniu

  2. Rozwiązanie
    - Pickup: ustawia pickup_timestamp i pickup_odometer, ZERUJE return pola
    - Return: ustawia return_timestamp i return_odometer, ZACHOWUJE pickup pola
    - Dzięki temu is_in_use będzie poprawnie ustawiony
*/

-- Poprawiona funkcja aktualizująca timestamps
CREATE OR REPLACE FUNCTION update_event_vehicle_timestamps_on_handover()
RETURNS TRIGGER AS $$
BEGIN
  -- Aktualizuj event_vehicles w zależności od typu handover
  IF NEW.handover_type = 'pickup' THEN
    -- Odbierz pojazd: ustaw pickup, wyzeruj return (może był wcześniej zwrócony)
    UPDATE event_vehicles
    SET
      pickup_timestamp = NEW.timestamp,
      pickup_odometer = NEW.odometer_reading,
      return_timestamp = NULL,
      return_odometer = NULL,
      return_notes = NULL
    WHERE id = NEW.event_vehicle_id;
    
  ELSIF NEW.handover_type = 'return' THEN
    -- Zdaj pojazd: ustaw return, zachowaj pickup
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

-- Napraw istniejące rekordy - użyj OSTATNIEGO handover dla każdego pojazdu
DO $$
DECLARE
  rec RECORD;
  last_handover RECORD;
BEGIN
  -- Dla każdego event_vehicle który ma handovery
  FOR rec IN 
    SELECT DISTINCT event_vehicle_id 
    FROM vehicle_handovers
  LOOP
    -- Znajdź ostatni handover
    SELECT * INTO last_handover
    FROM vehicle_handovers
    WHERE event_vehicle_id = rec.event_vehicle_id
    ORDER BY timestamp DESC
    LIMIT 1;
    
    -- Zaktualizuj event_vehicles na podstawie ostatniego handover
    IF last_handover.handover_type = 'pickup' THEN
      UPDATE event_vehicles
      SET
        pickup_timestamp = last_handover.timestamp,
        pickup_odometer = last_handover.odometer_reading,
        return_timestamp = NULL,
        return_odometer = NULL,
        return_notes = NULL
      WHERE id = rec.event_vehicle_id;
      
    ELSIF last_handover.handover_type = 'return' THEN
      -- Dla return musimy znaleźć ostatni pickup PRZED tym return
      DECLARE
        last_pickup RECORD;
      BEGIN
        SELECT * INTO last_pickup
        FROM vehicle_handovers
        WHERE event_vehicle_id = rec.event_vehicle_id
        AND handover_type = 'pickup'
        AND timestamp < last_handover.timestamp
        ORDER BY timestamp DESC
        LIMIT 1;
        
        UPDATE event_vehicles
        SET
          pickup_timestamp = last_pickup.timestamp,
          pickup_odometer = last_pickup.odometer_reading,
          return_timestamp = last_handover.timestamp,
          return_odometer = last_handover.odometer_reading,
          return_notes = last_handover.notes
        WHERE id = rec.event_vehicle_id;
      END;
    END IF;
  END LOOP;
END $$;
