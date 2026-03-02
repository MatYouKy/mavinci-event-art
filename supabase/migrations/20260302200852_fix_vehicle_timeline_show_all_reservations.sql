/*
  # Fix Vehicle Timeline - Pokaż wszystkie rezerwacje

  1. Zmiany
    - Aktualizuje funkcję get_vehicle_timeline aby pokazywała wszystkie rezerwacje pojazdów
    - Uwzględnia wszystkie statusy wydarzeń (inquiry, offer_sent, itp.) oprócz cancelled
    - Dodaje odpowiednie kolory dla różnych statusów wydarzeń
    - Pokazuje rezerwacje nawet jeśli wydarzenie jest w statusie zapytania

  2. Kolory dla statusów
    - inquiry (zapytanie) - niebieski (#3b82f6)
    - offer_to_send, offer_sent (oferty) - fioletowy (#8b5cf6)
    - offer_accepted (zaakceptowana) - zielony jasny (#22c55e)
    - in_preparation (przygotowanie) - pomarańczowy (#f59e0b)
    - in_progress (w trakcie) - zielony (#10b981)
    - completed (zakończone) - szary (#6b7280)
    - invoiced (zafakturowane) - złoty (#d3bb73)
    - cancelled (anulowane) - czerwony (#ef4444)
*/

-- Aktualizuj funkcję do pobierania timeline pojazdu
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

  -- Wydarzenia (event_vehicles) - wszystkie rezerwacje pojazdów (oprócz cancelled)
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
      END,
      ' [',
      CASE e.status::text
        WHEN 'inquiry' THEN 'Zapytanie'
        WHEN 'offer_to_send' THEN 'Oferta do wysłania'
        WHEN 'offer_sent' THEN 'Oferta wysłana'
        WHEN 'offer_accepted' THEN 'Oferta zaakceptowana'
        WHEN 'in_preparation' THEN 'Przygotowanie'
        WHEN 'in_progress' THEN 'W trakcie'
        WHEN 'completed' THEN 'Zakończone'
        WHEN 'invoiced' THEN 'Zafakturowane'
        WHEN 'cancelled' THEN 'Anulowane'
        ELSE e.status::text
      END,
      ']'
    ) as description,
    COALESCE(e.status::text, 'inquiry') as status,
    CASE e.status::text
      WHEN 'inquiry' THEN '#3b82f6'
      WHEN 'offer_to_send' THEN '#8b5cf6'
      WHEN 'offer_sent' THEN '#8b5cf6'
      WHEN 'offer_accepted' THEN '#22c55e'
      WHEN 'in_preparation' THEN '#f59e0b'
      WHEN 'in_progress' THEN '#10b981'
      WHEN 'completed' THEN '#6b7280'
      WHEN 'invoiced' THEN '#d3bb73'
      WHEN 'cancelled' THEN '#ef4444'
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
    AND e.status != 'cancelled'
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

COMMENT ON FUNCTION get_vehicle_timeline IS 'Pobiera timeline wykorzystania pojazdu uwzględniając wszystkie rezerwacje (wydarzenia), naprawy i serwisy. Pokazuje wydarzenia we wszystkich statusach oprócz cancelled.';