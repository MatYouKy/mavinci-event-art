/*
  # Automatyczna aktualizacja przebiegu pojazdu przy odbiórze/zdaniu

  1. Funkcja
    - Aktualizuje `current_mileage` w tabeli `vehicles` po każdym handoverze
    - Pobiera najnowszy odczyt licznika dla danego pojazdu
    - Działa automatycznie przez trigger

  2. Logika
    - Po zapisaniu handoveru, znajdź vehicle_id
    - Pobierz najnowszy odczyt ze wszystkich handoverów tego pojazdu
    - Zaktualizuj current_mileage w vehicles
*/

-- Funkcja aktualizująca przebieg pojazdu
CREATE OR REPLACE FUNCTION update_vehicle_current_mileage()
RETURNS TRIGGER AS $$
DECLARE
  v_vehicle_id uuid;
  v_latest_mileage integer;
BEGIN
  -- Pobierz vehicle_id z event_vehicles
  SELECT vehicle_id INTO v_vehicle_id
  FROM event_vehicles
  WHERE id = NEW.event_vehicle_id;

  -- Jeśli nie ma vehicle_id (pojazd zewnętrzny), zakończ
  IF v_vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pobierz najnowszy odczyt licznika dla tego pojazdu
  SELECT MAX(vh.odometer_reading) INTO v_latest_mileage
  FROM vehicle_handovers vh
  JOIN event_vehicles ev ON ev.id = vh.event_vehicle_id
  WHERE ev.vehicle_id = v_vehicle_id;

  -- Zaktualizuj current_mileage w vehicles
  IF v_latest_mileage IS NOT NULL THEN
    UPDATE vehicles
    SET
      current_mileage = v_latest_mileage,
      updated_at = now()
    WHERE id = v_vehicle_id;

    RAISE NOTICE 'Updated vehicle % mileage to %', v_vehicle_id, v_latest_mileage;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger uruchamiający funkcję po każdym INSERT/UPDATE w vehicle_handovers
DROP TRIGGER IF EXISTS trigger_update_vehicle_mileage ON vehicle_handovers;
CREATE TRIGGER trigger_update_vehicle_mileage
  AFTER INSERT OR UPDATE ON vehicle_handovers
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_current_mileage();
