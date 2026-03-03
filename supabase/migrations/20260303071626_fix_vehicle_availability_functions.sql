/*
  # Naprawa funkcji dostępności pojazdów

  1. Zmiany
    - Usuwa nieistniejącą kolumnę capacity
    - Używa number_of_seats zamiast capacity
*/

-- Popraw funkcję zwracającą dostępne pojazdy
DROP FUNCTION IF EXISTS get_available_vehicles_for_event(timestamptz, timestamptz, uuid, text);

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
  number_of_seats integer,
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
    v.number_of_seats,
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

GRANT EXECUTE ON FUNCTION get_available_vehicles_for_event TO authenticated;
GRANT EXECUTE ON FUNCTION get_available_vehicles_for_event TO anon;