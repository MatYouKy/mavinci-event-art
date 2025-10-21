/*
  # Dodanie wsparcia dla przyczep w tabeli vehicles

  1. Nowe kolumny
    - `vehicle_type` - typ pojazdu (car/trailer)
    - `length_cm` - długość w cm (dla przyczep)
    - `width_cm` - szerokość w cm (dla przyczep)
    - `height_cm` - wysokość w cm (dla przyczep)
    - `weight_kg` - waga własna w kg (dla przyczep)

  2. Dodatkowe atrybuty
    - Dodanie atrybutu "Wymaga haka holowniczego" dla przyczep

  3. Funkcje pomocnicze
    - Funkcja sprawdzająca zgodność pojazdu z przyczepą
*/

-- Dodaj nowe kolumny do vehicles
DO $$
BEGIN
  -- Typ pojazdu
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'vehicle_type'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN vehicle_type text DEFAULT 'car' CHECK (vehicle_type IN ('car', 'trailer'));
    COMMENT ON COLUMN vehicles.vehicle_type IS 'Typ pojazdu: car (samochód) lub trailer (przyczepa)';
  END IF;

  -- Pola dla przyczep - wymiary
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'length_cm'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN length_cm integer;
    COMMENT ON COLUMN vehicles.length_cm IS 'Długość pojazdu/przyczepy w centymetrach';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'width_cm'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN width_cm integer;
    COMMENT ON COLUMN vehicles.width_cm IS 'Szerokość pojazdu/przyczepy w centymetrach';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'height_cm'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN height_cm integer;
    COMMENT ON COLUMN vehicles.height_cm IS 'Wysokość pojazdu/przyczepy w centymetrach';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vehicles' AND column_name = 'weight_kg'
  ) THEN
    ALTER TABLE vehicles ADD COLUMN weight_kg integer;
    COMMENT ON COLUMN vehicles.weight_kg IS 'Waga własna pojazdu/przyczepy w kilogramach';
  END IF;
END $$;

-- Dodaj nowy typ atrybutu dla przyczep (jeśli nie istnieje)
INSERT INTO vehicle_attribute_types (name, description, data_type, category, is_active)
VALUES 
  ('Wymaga haka holowniczego', 'Przyczepa wymaga pojazdu z hakiem holowniczym', 'boolean', 'requirement', true)
ON CONFLICT (name) DO NOTHING;

-- Funkcja walidująca zgodność pojazdu z przyczepą
CREATE OR REPLACE FUNCTION can_vehicle_tow_trailer(
  p_vehicle_id uuid,
  p_trailer_id uuid
)
RETURNS TABLE(can_tow boolean, reason text) AS $$
DECLARE
  v_has_tow_hitch boolean DEFAULT false;
  v_trailer_requires_hitch boolean DEFAULT false;
  v_vehicle_type text;
  v_trailer_type text;
  v_tow_hitch_attr_id uuid;
  v_requires_hitch_attr_id uuid;
BEGIN
  -- Sprawdź typy pojazdów
  SELECT vehicle_type INTO v_vehicle_type FROM vehicles WHERE id = p_vehicle_id;
  SELECT vehicle_type INTO v_trailer_type FROM vehicles WHERE id = p_trailer_id;

  -- Pojazd musi być typu 'car', przyczepa typu 'trailer'
  IF v_vehicle_type IS NULL OR v_trailer_type IS NULL THEN
    RETURN QUERY SELECT false, 'Nie znaleziono pojazdu lub przyczepy';
    RETURN;
  END IF;

  IF v_vehicle_type != 'car' THEN
    RETURN QUERY SELECT false, 'Pierwszy pojazd musi być typu samochód';
    RETURN;
  END IF;

  IF v_trailer_type != 'trailer' THEN
    RETURN QUERY SELECT false, 'Drugi pojazd musi być typu przyczepa';
    RETURN;
  END IF;

  -- Pobierz ID atrybutów
  SELECT id INTO v_tow_hitch_attr_id FROM vehicle_attribute_types WHERE name = 'Hak holowniczy';
  SELECT id INTO v_requires_hitch_attr_id FROM vehicle_attribute_types WHERE name = 'Wymaga haka holowniczego';

  -- Sprawdź czy pojazd ma hak
  IF v_tow_hitch_attr_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM vehicle_attributes
      WHERE vehicle_id = p_vehicle_id
      AND attribute_type_id = v_tow_hitch_attr_id
      AND value = 'true'
    ) INTO v_has_tow_hitch;
  END IF;

  -- Sprawdź czy przyczepa wymaga haka
  IF v_requires_hitch_attr_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM vehicle_attributes
      WHERE vehicle_id = p_trailer_id
      AND attribute_type_id = v_requires_hitch_attr_id
      AND value = 'true'
    ) INTO v_trailer_requires_hitch;
  END IF;

  -- Jeśli przyczepa wymaga haka, pojazd musi go mieć
  IF v_trailer_requires_hitch AND NOT v_has_tow_hitch THEN
    RETURN QUERY SELECT false, 'Przyczepa wymaga pojazdu z hakiem holowniczym';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'Pojazd może holować tę przyczepę';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
