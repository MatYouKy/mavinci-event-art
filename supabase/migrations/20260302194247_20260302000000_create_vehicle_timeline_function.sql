/*
  # Funkcja timeline dla pojazdów

  1. Nowa funkcja RPC
    - `get_vehicle_timeline` - pobiera timeline wykorzystania pojazdu
    - Uwzględnia przypisania do wydarzeń (event_vehicles)
    - Uwzględnia okresy napraw/serwisu (maintenance_records gdzie status='in_progress')
    - Uwzględnia okresy uszkodzenia (vehicle status='in_service')
    - Zwraca ujednoliconą strukturę z typem okresu i informacjami

  2. Zwracane dane
    - id - identyfikator wpisu
    - type - typ: 'event', 'maintenance', 'unavailable'
    - start_date - data rozpoczęcia
    - end_date - data zakończenia
    - title - tytuł/nazwa
    - description - opis
    - status - status
    - color - kolor do wyświetlenia
    - related_id - ID powiązanego rekordu (event_id, maintenance_id)
*/

-- Funkcja do pobierania timeline pojazdu
CREATE OR REPLACE FUNCTION get_vehicle_timeline(
  p_vehicle_id uuid,
  p_start_date timestamptz DEFAULT NOW() - INTERVAL '30 days',
  p_end_date timestamptz DEFAULT NOW() + INTERVAL '90 days'
)
RETURNS TABLE (
  id uuid,
  type text,
  start_date timestamptz,
  end_date timestamptz,
  title text,
  description text,
  status text,
  color text,
  related_id uuid,
  event_name text,
  driver_name text,
  location text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY

  -- Wydarzenia (event_vehicles) - wykorzystanie pojazdu na eventach
  SELECT
    ev.id,
    'event'::text as type,
    COALESCE(ep.work_start_datetime, e.event_start_datetime) as start_date,
    COALESCE(ep.work_end_datetime, e.event_end_datetime) as end_date,
    e.name as title,
    CONCAT('Wydarzenie: ', e.name,
      CASE
        WHEN ev.driver_id IS NOT NULL THEN CONCAT(' - Kierowca: ', emp.name, ' ', emp.surname)
        ELSE ''
      END
    ) as description,
    COALESCE(e.status::text, 'planned') as status,
    CASE
      WHEN e.status = 'confirmed' THEN '#10b981'
      WHEN e.status = 'planned' THEN '#3b82f6'
      WHEN e.status = 'cancelled' THEN '#ef4444'
      ELSE '#d3bb73'
    END as color,
    e.id as related_id,
    e.name as event_name,
    CASE
      WHEN emp.id IS NOT NULL THEN emp.name || ' ' || emp.surname
      ELSE NULL
    END as driver_name,
    COALESCE(loc.name, e.location) as location
  FROM event_vehicles ev
  JOIN events e ON e.id = ev.event_id
  LEFT JOIN event_phases ep ON ep.id = (
    SELECT id FROM event_phases
    WHERE event_id = e.id
    ORDER BY work_start_datetime ASC
    LIMIT 1
  )
  LEFT JOIN employees emp ON emp.id = ev.driver_id
  LEFT JOIN locations loc ON loc.id = e.location_id
  WHERE ev.vehicle_id = p_vehicle_id
    AND COALESCE(ep.work_end_datetime, e.event_end_datetime) >= p_start_date
    AND COALESCE(ep.work_start_datetime, e.event_start_datetime) <= p_end_date
    AND e.deleted_at IS NULL
    AND ev.status != 'cancelled'

  UNION ALL

  -- Naprawy i serwisy (maintenance_records)
  SELECT
    mr.id,
    'maintenance'::text as type,
    mr.date::timestamptz as start_date,
    COALESCE(mr.next_service_date::timestamptz, mr.date::timestamptz + INTERVAL '1 day') as end_date,
    COALESCE(mr.title, mr.type) as title,
    CONCAT('Serwis: ', COALESCE(mr.title, mr.type),
      CASE
        WHEN mr.service_provider IS NOT NULL THEN CONCAT(' - ', mr.service_provider)
        ELSE ''
      END
    ) as description,
    COALESCE(mr.status, 'completed')::text as status,
    CASE
      WHEN mr.status = 'in_progress' THEN '#f59e0b'
      WHEN mr.status = 'completed' THEN '#10b981'
      WHEN mr.status = 'scheduled' THEN '#3b82f6'
      ELSE '#6b7280'
    END as color,
    mr.id as related_id,
    NULL::text as event_name,
    NULL::text as driver_name,
    mr.service_provider as location
  FROM maintenance_records mr
  WHERE mr.vehicle_id = p_vehicle_id
    AND mr.date >= p_start_date::date
    AND mr.date <= p_end_date::date
    AND mr.status IN ('in_progress', 'scheduled')

  UNION ALL

  -- Przeglądy okresowe (periodic_inspections) gdy są w trakcie
  SELECT
    pi.id,
    'maintenance'::text as type,
    pi.inspection_date::timestamptz as start_date,
    (pi.inspection_date::timestamptz + INTERVAL '1 day') as end_date,
    CASE
      WHEN pi.inspection_type = 'technical_inspection' THEN 'Przegląd techniczny'
      ELSE 'Przegląd okresowy'
    END as title,
    CONCAT(
      CASE
        WHEN pi.inspection_type = 'technical_inspection' THEN 'Przegląd techniczny'
        ELSE 'Przegląd okresowy'
      END,
      CASE
        WHEN pi.service_provider IS NOT NULL THEN CONCAT(' - ', pi.service_provider)
        ELSE ''
      END
    ) as description,
    CASE
      WHEN pi.passed THEN 'completed'
      ELSE 'failed'
    END::text as status,
    CASE
      WHEN pi.passed THEN '#10b981'
      ELSE '#ef4444'
    END as color,
    pi.id as related_id,
    NULL::text as event_name,
    NULL::text as driver_name,
    pi.service_provider as location
  FROM periodic_inspections pi
  WHERE pi.vehicle_id = p_vehicle_id
    AND pi.inspection_date >= p_start_date::date
    AND pi.inspection_date <= p_end_date::date

  ORDER BY start_date ASC;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_vehicle_timeline TO authenticated;
GRANT EXECUTE ON FUNCTION get_vehicle_timeline TO anon;

COMMENT ON FUNCTION get_vehicle_timeline IS 'Pobiera timeline wykorzystania pojazdu uwzględniając wydarzenia, naprawy i serwisy';
