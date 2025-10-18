/*
  # Rozszerzenie systemu logistyki o zarządzanie dostępnością

  1. Zmiany w tabeli event_vehicles
    - Dodanie pól dla pojazdów zewnętrznych
    - Dodanie szczegółowych czasów przygotowania
    - Dodanie czasu dostępności pojazdu
    
  2. Nowa funkcja sprawdzania dostępności
    - Sprawdza konflikty rezerwacji pojazdów
    - Zwraca listę wydarzeń kolidujących
    
  3. Nowy widok z konfliktami
    - Pokazuje nakładające się rezerwacje
*/

-- Dodaj kolumny do event_vehicles
ALTER TABLE event_vehicles
ADD COLUMN IF NOT EXISTS is_external boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS external_company_name text,
ADD COLUMN IF NOT EXISTS external_rental_cost numeric(10,2),
ADD COLUMN IF NOT EXISTS loading_time_minutes integer DEFAULT 60,
ADD COLUMN IF NOT EXISTS preparation_time_minutes integer DEFAULT 30,
ADD COLUMN IF NOT EXISTS travel_time_minutes integer,
ADD COLUMN IF NOT EXISTS vehicle_available_from timestamptz,
ADD COLUMN IF NOT EXISTS vehicle_available_until timestamptz,
ADD COLUMN IF NOT EXISTS calculated_departure_time timestamptz;

-- Komentarze do nowych kolumn
COMMENT ON COLUMN event_vehicles.is_external IS 'Czy pojazd jest zewnętrzny (wypożyczony)';
COMMENT ON COLUMN event_vehicles.external_company_name IS 'Nazwa firmy wypożyczającej';
COMMENT ON COLUMN event_vehicles.external_rental_cost IS 'Koszt wypożyczenia';
COMMENT ON COLUMN event_vehicles.loading_time_minutes IS 'Czas potrzebny na załadunek (minuty)';
COMMENT ON COLUMN event_vehicles.preparation_time_minutes IS 'Czas przygotowania pojazdu (minuty)';
COMMENT ON COLUMN event_vehicles.travel_time_minutes IS 'Szacowany czas dojazdu (minuty)';
COMMENT ON COLUMN event_vehicles.vehicle_available_from IS 'Od kiedy pojazd jest dostępny';
COMMENT ON COLUMN event_vehicles.vehicle_available_until IS 'Do kiedy pojazd jest dostępny';
COMMENT ON COLUMN event_vehicles.calculated_departure_time IS 'Obliczony czas wyjazdu';

-- Funkcja do sprawdzania dostępności pojazdu
CREATE OR REPLACE FUNCTION check_vehicle_availability(
  p_vehicle_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_exclude_event_id uuid DEFAULT NULL
)
RETURNS TABLE(
  conflicting_event_id uuid,
  event_name text,
  event_date timestamptz,
  event_location text,
  overlap_start timestamptz,
  overlap_end timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id as conflicting_event_id,
    e.name as event_name,
    e.event_date,
    e.location as event_location,
    GREATEST(ev.vehicle_available_from, p_start_time) as overlap_start,
    LEAST(ev.vehicle_available_until, p_end_time) as overlap_end
  FROM event_vehicles ev
  JOIN events e ON e.id = ev.event_id
  WHERE ev.vehicle_id = p_vehicle_id
    AND (p_exclude_event_id IS NULL OR ev.event_id != p_exclude_event_id)
    AND ev.status NOT IN ('cancelled', 'completed')
    AND (
      (ev.vehicle_available_from, ev.vehicle_available_until) OVERLAPS (p_start_time, p_end_time)
      OR
      (p_start_time, p_end_time) OVERLAPS (ev.vehicle_available_from, ev.vehicle_available_until)
    )
  ORDER BY ev.vehicle_available_from;
END;
$$ LANGUAGE plpgsql STABLE;

-- Widok pokazujący konflikty rezerwacji
CREATE OR REPLACE VIEW vehicle_reservation_conflicts AS
SELECT 
  ev1.id as reservation_id,
  ev1.event_id as event_id,
  e1.name as event_name,
  e1.event_date,
  ev1.vehicle_id,
  v.name as vehicle_name,
  v.registration_number,
  ev1.vehicle_available_from,
  ev1.vehicle_available_until,
  ev2.id as conflicting_reservation_id,
  ev2.event_id as conflicting_event_id,
  e2.name as conflicting_event_name,
  e2.event_date as conflicting_event_date,
  ev2.vehicle_available_from as conflicting_from,
  ev2.vehicle_available_until as conflicting_until,
  GREATEST(ev1.vehicle_available_from, ev2.vehicle_available_from) as overlap_start,
  LEAST(ev1.vehicle_available_until, ev2.vehicle_available_until) as overlap_end
FROM event_vehicles ev1
JOIN events e1 ON e1.id = ev1.event_id
JOIN vehicles v ON v.id = ev1.vehicle_id
JOIN event_vehicles ev2 ON ev2.vehicle_id = ev1.vehicle_id
  AND ev2.id != ev1.id
  AND ev2.status NOT IN ('cancelled', 'completed')
JOIN events e2 ON e2.id = ev2.event_id
WHERE ev1.status NOT IN ('cancelled', 'completed')
  AND (
    (ev1.vehicle_available_from, ev1.vehicle_available_until) OVERLAPS 
    (ev2.vehicle_available_from, ev2.vehicle_available_until)
  )
ORDER BY ev1.vehicle_available_from, v.name;

-- Funkcja do automatycznego obliczania czasu wyjazdu
CREATE OR REPLACE FUNCTION calculate_departure_time(
  p_event_date timestamptz,
  p_loading_minutes integer,
  p_preparation_minutes integer,
  p_travel_minutes integer
)
RETURNS timestamptz AS $$
BEGIN
  RETURN p_event_date 
    - (COALESCE(p_loading_minutes, 60) || ' minutes')::interval
    - (COALESCE(p_preparation_minutes, 30) || ' minutes')::interval
    - (COALESCE(p_travel_minutes, 60) || ' minutes')::interval;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger do automatycznego obliczania calculated_departure_time
CREATE OR REPLACE FUNCTION update_calculated_departure_time()
RETURNS TRIGGER AS $$
DECLARE
  v_event_date timestamptz;
BEGIN
  -- Pobierz datę wydarzenia
  SELECT event_date INTO v_event_date
  FROM events
  WHERE id = NEW.event_id;

  -- Oblicz czas wyjazdu
  NEW.calculated_departure_time := calculate_departure_time(
    v_event_date,
    NEW.loading_time_minutes,
    NEW.preparation_time_minutes,
    NEW.travel_time_minutes
  );

  -- Jeśli nie ma ustawionego departure_time, użyj obliczonego
  IF NEW.departure_time IS NULL THEN
    NEW.departure_time := NEW.calculated_departure_time;
  END IF;

  -- Ustaw vehicle_available_from jeśli nie jest ustawiony
  IF NEW.vehicle_available_from IS NULL THEN
    NEW.vehicle_available_from := NEW.calculated_departure_time;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_vehicles_calculate_departure
  BEFORE INSERT OR UPDATE OF loading_time_minutes, preparation_time_minutes, travel_time_minutes
  ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION update_calculated_departure_time();

-- Grant permissions na nową funkcję
GRANT EXECUTE ON FUNCTION check_vehicle_availability(uuid, timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION calculate_departure_time(timestamptz, integer, integer, integer) TO authenticated;

-- RLS dla widoku konfliktów
GRANT SELECT ON vehicle_reservation_conflicts TO authenticated;
