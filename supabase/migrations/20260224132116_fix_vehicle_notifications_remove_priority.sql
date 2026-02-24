/*
  # Napraw notyfikacje pojazdów - usuń nieistniejącą kolumnę priority

  1. Problem
    - Funkcje check_unreturned_vehicles i check_vehicle_availability_on_assign
    - Próbują wstawić kolumnę "priority" która nie istnieje w tabeli notifications
    
  2. Rozwiązanie
    - Usunąć kolumnę priority z INSERT statements
    - Zaktualizować funkcje aby używały tylko istniejących kolumn
*/

-- Napraw funkcję check_unreturned_vehicles
CREATE OR REPLACE FUNCTION check_unreturned_vehicles()
RETURNS void AS $$
DECLARE
  v_event_vehicle RECORD;
  v_last_handover RECORD;
  v_next_event RECORD;
  v_creator_id uuid;
  v_admin_ids uuid[];
  v_notification_text text;
  v_notification_id uuid;
BEGIN
  -- Przejdź przez wszystkie pojazdy w nadchodzących wydarzeniach
  FOR v_event_vehicle IN
    SELECT
      ev.id as event_vehicle_id,
      ev.vehicle_id,
      ev.event_id,
      e.name as event_name,
      e.event_date,
      e.created_by as event_creator,
      v.name as vehicle_name,
      v.registration_number
    FROM event_vehicles ev
    JOIN events e ON e.id = ev.event_id
    LEFT JOIN vehicles v ON v.id = ev.vehicle_id
    WHERE ev.vehicle_id IS NOT NULL
      AND e.event_date >= now()
      AND e.event_date <= now() + interval '7 days'
    ORDER BY e.event_date ASC
  LOOP
    -- Znajdź ostatni handover dla tego pojazdu
    SELECT
      vh.handover_type,
      vh.timestamp,
      prev_e.name as prev_event_name,
      prev_e.event_date as prev_event_date,
      emp.name || ' ' || emp.surname as driver_name
    INTO v_last_handover
    FROM vehicle_handovers vh
    JOIN event_vehicles prev_ev ON prev_ev.id = vh.event_vehicle_id
    JOIN events prev_e ON prev_e.id = prev_ev.event_id
    JOIN employees emp ON emp.id = vh.driver_id
    WHERE prev_ev.vehicle_id = v_event_vehicle.vehicle_id
      AND prev_e.event_date < v_event_vehicle.event_date
    ORDER BY vh.timestamp DESC
    LIMIT 1;

    -- Jeśli ostatni handover to 'pickup' (nie został zdany)
    IF v_last_handover.handover_type = 'pickup' THEN
      -- Przygotuj tekst notyfikacji
      v_notification_text := 'ALERT: Pojazd ' ||
        COALESCE(v_event_vehicle.vehicle_name || ' (' || v_event_vehicle.registration_number || ')', 'ID: ' || v_event_vehicle.vehicle_id::text) ||
        ' jest zarezerwowany na ' || to_char(v_event_vehicle.event_date, 'DD.MM.YYYY HH24:MI') ||
        ' (' || v_event_vehicle.event_name || '), ale nie został zdany z poprzedniego wydarzenia: ' ||
        v_last_handover.prev_event_name || ' (' || to_char(v_last_handover.prev_event_date, 'DD.MM.YYYY') || '). ' ||
        'Ostatni odbiór: ' || v_last_handover.driver_name || '.';

      -- Pobierz creatora wydarzenia
      v_creator_id := v_event_vehicle.event_creator;

      -- Pobierz adminów
      SELECT array_agg(id) INTO v_admin_ids
      FROM employees
      WHERE role = 'admin' OR 'fleet_manage' = ANY(permissions);

      -- Utwórz notyfikację (BEZ priority)
      INSERT INTO notifications (
        title,
        message,
        type,
        category,
        related_entity_type,
        related_entity_id,
        created_at
      )
      VALUES (
        'Pojazd nie został zdany',
        v_notification_text,
        'warning',
        'vehicle_conflict',
        'event_vehicle',
        v_event_vehicle.event_vehicle_id::text,
        now()
      )
      RETURNING id INTO v_notification_id;

      -- Dodaj odbiorcę - creator (używamy user_id zamiast employee_id)
      IF v_creator_id IS NOT NULL THEN
        INSERT INTO notification_recipients (notification_id, user_id)
        VALUES (v_notification_id, v_creator_id)
        ON CONFLICT (notification_id, user_id) DO NOTHING;
      END IF;

      -- Dodaj odbiorców - admini
      IF v_admin_ids IS NOT NULL THEN
        INSERT INTO notification_recipients (notification_id, user_id)
        SELECT v_notification_id, unnest(v_admin_ids)
        ON CONFLICT (notification_id, user_id) DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Napraw funkcję check_vehicle_availability_on_assign
CREATE OR REPLACE FUNCTION check_vehicle_availability_on_assign()
RETURNS TRIGGER AS $$
DECLARE
  v_last_handover RECORD;
  v_creator_id uuid;
  v_admin_ids uuid[];
  v_notification_text text;
  v_vehicle_name text;
  v_event_name text;
  v_event_date timestamptz;
  v_notification_id uuid;
BEGIN
  -- Tylko dla pojazdów z floty (vehicle_id IS NOT NULL)
  IF NEW.vehicle_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pobierz nazwę pojazdu i dane wydarzenia
  SELECT
    v.name || ' (' || v.registration_number || ')' as vehicle_name,
    e.name as event_name,
    e.event_date,
    e.created_by
  INTO v_vehicle_name, v_event_name, v_event_date, v_creator_id
  FROM vehicles v, events e
  WHERE v.id = NEW.vehicle_id AND e.id = NEW.event_id;

  -- Znajdź ostatni handover
  SELECT
    vh.handover_type,
    prev_e.name as prev_event_name,
    prev_e.event_date as prev_event_date,
    emp.name || ' ' || emp.surname as driver_name
  INTO v_last_handover
  FROM vehicle_handovers vh
  JOIN event_vehicles prev_ev ON prev_ev.id = vh.event_vehicle_id
  JOIN events prev_e ON prev_e.id = prev_ev.event_id
  JOIN employees emp ON emp.id = vh.driver_id
  WHERE prev_ev.vehicle_id = NEW.vehicle_id
    AND prev_e.event_date < v_event_date
  ORDER BY vh.timestamp DESC
  LIMIT 1;

  -- Jeśli ostatni handover to 'pickup'
  IF v_last_handover.handover_type = 'pickup' THEN
    v_notification_text := 'UWAGA: Pojazd ' || v_vehicle_name ||
      ' został przypisany do wydarzenia "' || v_event_name || '" (' || to_char(v_event_date, 'DD.MM.YYYY HH24:MI') || '), ' ||
      'ale nie został jeszcze zdany z poprzedniego wydarzenia: ' ||
      v_last_handover.prev_event_name || ' (' || to_char(v_last_handover.prev_event_date, 'DD.MM.YYYY') || ').';

    -- Pobierz adminów
    SELECT array_agg(id) INTO v_admin_ids
    FROM employees
    WHERE role = 'admin' OR 'fleet_manage' = ANY(permissions);

    -- Utwórz notyfikację (BEZ priority)
    INSERT INTO notifications (
      title,
      message,
      type,
      category,
      related_entity_type,
      related_entity_id,
      action_url,
      created_at
    )
    VALUES (
      'Możliwy konflikt pojazdu',
      v_notification_text,
      'warning',
      'vehicle_conflict',
      'event_vehicle',
      NEW.id::text,
      '/crm/events/' || NEW.event_id || '?tab=logistics',
      now()
    )
    RETURNING id INTO v_notification_id;

    -- Dodaj creatora jako odbiorcę (używamy user_id)
    IF v_creator_id IS NOT NULL THEN
      INSERT INTO notification_recipients (notification_id, user_id)
      VALUES (v_notification_id, v_creator_id)
      ON CONFLICT (notification_id, user_id) DO NOTHING;
    END IF;

    -- Dodaj adminów
    IF v_admin_ids IS NOT NULL THEN
      INSERT INTO notification_recipients (notification_id, user_id)
      SELECT v_notification_id, unnest(v_admin_ids)
      ON CONFLICT (notification_id, user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;