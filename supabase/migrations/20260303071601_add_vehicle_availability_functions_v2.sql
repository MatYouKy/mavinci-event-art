/*
  # Funkcje sprawdzania dostępności pojazdów v2

  1. Nowe funkcje
    - `is_vehicle_available` - sprawdza czy pojazd jest dostępny (boolean)
    - `get_available_vehicles_for_event` - zwraca listę dostępnych pojazdów

  2. Logika
    - Sprawdza konflikty z innymi wydarzeniami (event_vehicles)
    - Sprawdza konflikty z serwisami i naprawami (maintenance_records)
    - Zwraca tylko aktywne pojazdy (status = 'active')
*/

-- Funkcja sprawdzająca czy pojazd jest dostępny (zwraca true/false)
CREATE OR REPLACE FUNCTION is_vehicle_available(
  p_vehicle_id uuid,
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_exclude_event_vehicle_id uuid DEFAULT NULL
)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_conflict_count integer;
BEGIN
  -- Sprawdź czy pojazd jest aktywny
  IF NOT EXISTS (
    SELECT 1 FROM vehicles 
    WHERE id = p_vehicle_id 
    AND status = 'active'
  ) THEN
    RETURN false;
  END IF;

  -- Sprawdź konflikty z innymi wydarzeniami
  SELECT COUNT(*) INTO v_conflict_count
  FROM event_vehicles ev
  JOIN events e ON e.id = ev.event_id
  LEFT JOIN event_phases ep ON ep.id = (
    SELECT ep_sub.id FROM event_phases ep_sub
    WHERE ep_sub.event_id = e.id
    ORDER BY ep_sub.start_time ASC
    LIMIT 1
  )
  WHERE ev.vehicle_id = p_vehicle_id
    AND ev.status != 'cancelled'
    AND e.status != 'cancelled'
    AND (p_exclude_event_vehicle_id IS NULL OR ev.id != p_exclude_event_vehicle_id)
    AND (
      -- Sprawdź nakładanie się terminów
      (COALESCE(ep.start_time, e.event_date) < p_end_date AND 
       COALESCE(ep.end_time, e.event_end_date) > p_start_date)
    );

  IF v_conflict_count > 0 THEN
    RETURN false;
  END IF;

  -- Sprawdź konflikty z serwisami w trakcie lub zaplanowanymi
  SELECT COUNT(*) INTO v_conflict_count
  FROM maintenance_records mr
  WHERE mr.vehicle_id = p_vehicle_id
    AND mr.status IN ('in_progress', 'scheduled')
    AND (
      mr.date::timestamptz < p_end_date AND 
      COALESCE(mr.next_service_date::timestamptz, mr.date::timestamptz + INTERVAL '1 day') > p_start_date
    );

  IF v_conflict_count > 0 THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

-- Funkcja zwracająca listę dostępnych pojazdów dla wydarzenia
CREATE OR REPLACE FUNCTION get_available_vehicles_for_event(
  p_start_date timestamptz,
  p_end_date timestamptz,
  p_exclude_event_vehicle_id uuid DEFAULT NULL,
  p_vehicle_type text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  brand text,
  model text,
  registration_number text,
  status text,
  vehicle_type text,
  capacity integer,
  year integer,
  notes text,
  is_available boolean,
  conflicting_events_count integer
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.name,
    v.brand,
    v.model,
    v.registration_number,
    v.status,
    v.vehicle_type,
    v.capacity,
    v.year,
    v.notes,
    is_vehicle_available(v.id, p_start_date, p_end_date, p_exclude_event_vehicle_id) as is_available,
    (
      SELECT COUNT(*)::integer
      FROM event_vehicles ev
      JOIN events e ON e.id = ev.event_id
      LEFT JOIN event_phases ep ON ep.id = (
        SELECT ep_sub.id FROM event_phases ep_sub
        WHERE ep_sub.event_id = e.id
        ORDER BY ep_sub.start_time ASC
        LIMIT 1
      )
      WHERE ev.vehicle_id = v.id
        AND ev.status != 'cancelled'
        AND e.status != 'cancelled'
        AND (p_exclude_event_vehicle_id IS NULL OR ev.id != p_exclude_event_vehicle_id)
        AND (
          (COALESCE(ep.start_time, e.event_date) < p_end_date AND 
           COALESCE(ep.end_time, e.event_end_date) > p_start_date)
        )
    ) as conflicting_events_count
  FROM vehicles v
  WHERE v.status = 'active'
    AND (p_vehicle_type IS NULL OR v.vehicle_type = p_vehicle_type)
  ORDER BY 
    is_vehicle_available(v.id, p_start_date, p_end_date, p_exclude_event_vehicle_id) DESC,
    v.name ASC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION is_vehicle_available TO authenticated;
GRANT EXECUTE ON FUNCTION is_vehicle_available TO anon;
GRANT EXECUTE ON FUNCTION get_available_vehicles_for_event TO authenticated;
GRANT EXECUTE ON FUNCTION get_available_vehicles_for_event TO anon;

-- Komentarze
COMMENT ON FUNCTION is_vehicle_available IS 'Sprawdza czy pojazd jest dostępny w podanym terminie. Zwraca true jeśli dostępny, false jeśli zajęty.';
COMMENT ON FUNCTION get_available_vehicles_for_event IS 'Zwraca listę wszystkich aktywnych pojazdów z informacją o dostępności w podanym terminie. Dostępne pojazdy są wyświetlane jako pierwsze.';