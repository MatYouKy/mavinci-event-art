/*
  # System alertów o niezdanych pojazdach

  1. Funkcja sprawdzająca konflikty
    - Sprawdza czy pojazd jest zarezerwowany w kolejnym wydarzeniu
    - Sprawdza czy pojazd został zdany z poprzedniego wydarzenia
    - Wysyła alerty do creatora wydarzenia i adminów

  2. Trigger
    - Uruchamia się codziennie lub po dodaniu nowego event_vehicle
    - Sprawdza wszystkie aktywne wydarzenia
*/

-- Funkcja sprawdzająca niezdane pojazdy i wysyłająca alerty
CREATE OR REPLACE FUNCTION check_unreturned_vehicles()
RETURNS void AS $$
DECLARE
  v_event_vehicle RECORD;
  v_last_handover RECORD;
  v_next_event RECORD;
  v_creator_id uuid;
  v_admin_ids uuid[];
  v_notification_text text;
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

      -- Utwórz notyfikację dla creatora
      IF v_creator_id IS NOT NULL THEN
        INSERT INTO notifications (category, title, message, priority, entity_type, entity_id, created_at)
        VALUES (
          'vehicle_conflict',
          'Pojazd nie został zdany',
          v_notification_text,
          'high',
          'event_vehicle',
          v_event_vehicle.event_vehicle_id,
          now()
        ) ON CONFLICT DO NOTHING;

        -- Dodaj odbiorcę - creator
        INSERT INTO notification_recipients (notification_id, employee_id, is_read)
        SELECT
          (SELECT id FROM notifications WHERE entity_id = v_event_vehicle.event_vehicle_id AND category = 'vehicle_conflict' ORDER BY created_at DESC LIMIT 1),
          v_creator_id,
          false
        ON CONFLICT DO NOTHING;
      END IF;

      -- Dodaj odbiorców - admini
      IF v_admin_ids IS NOT NULL THEN
        INSERT INTO notification_recipients (notification_id, employee_id, is_read)
        SELECT
          (SELECT id FROM notifications WHERE entity_id = v_event_vehicle.event_vehicle_id AND category = 'vehicle_conflict' ORDER BY created_at DESC LIMIT 1),
          unnest(v_admin_ids),
          false
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja uruchamiana po dodaniu pojazdu do wydarzenia
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

    -- Utwórz notyfikację
    INSERT INTO notifications (category, title, message, priority, entity_type, entity_id, created_at)
    VALUES (
      'vehicle_conflict',
      'Możliwy konflikt pojazdu',
      v_notification_text,
      'high',
      'event_vehicle',
      NEW.id,
      now()
    );

    -- Dodaj creatora jako odbiorcę
    IF v_creator_id IS NOT NULL THEN
      INSERT INTO notification_recipients (notification_id, employee_id, is_read)
      VALUES (
        (SELECT id FROM notifications WHERE entity_id = NEW.id AND category = 'vehicle_conflict' ORDER BY created_at DESC LIMIT 1),
        v_creator_id,
        false
      );
    END IF;

    -- Dodaj adminów
    IF v_admin_ids IS NOT NULL THEN
      INSERT INTO notification_recipients (notification_id, employee_id, is_read)
      SELECT
        (SELECT id FROM notifications WHERE entity_id = NEW.id AND category = 'vehicle_conflict' ORDER BY created_at DESC LIMIT 1),
        unnest(v_admin_ids),
        false;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger na event_vehicles
DROP TRIGGER IF EXISTS trigger_check_vehicle_on_assign ON event_vehicles;
CREATE TRIGGER trigger_check_vehicle_on_assign
  AFTER INSERT ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION check_vehicle_availability_on_assign();
