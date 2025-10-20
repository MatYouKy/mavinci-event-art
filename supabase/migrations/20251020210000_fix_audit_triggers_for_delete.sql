/*
  # Naprawa triggerów audit log przy usuwaniu wydarzenia

  1. Problem
    - Przy usuwaniu wydarzenia, triggery próbują dodać wpis do audit log
    - Ale wydarzenie jest już usuwane, więc foreign key constraint failuje

  2. Rozwiązanie
    - Zmień triggery na BEFORE DELETE zamiast AFTER
    - LUB zmień funkcje żeby nie robiły INSERT gdy event jest usuwany
    - LUB zmień trigger z AFTER na BEFORE INSERT/UPDATE tylko (nie DELETE)
*/

-- Zmień triggery żeby były tylko na INSERT i UPDATE, nie na DELETE
DROP TRIGGER IF EXISTS trigger_log_vehicle_assignment ON event_vehicles;
CREATE TRIGGER trigger_log_vehicle_assignment
  AFTER INSERT ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_assignment_to_event();

DROP TRIGGER IF EXISTS trigger_log_driver_assignment ON event_vehicles;
CREATE TRIGGER trigger_log_driver_assignment
  AFTER UPDATE OF driver_id ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION log_driver_assignment_to_vehicle();

-- Upewnij się że trigger handover też nie ma problemu
-- (ten jest OK bo działa na vehicle_handovers, nie event_vehicles)

-- Dodatkowo - zaktualizuj trigger sprawdzający konflikty pojazdów
-- żeby NIE uruchamiał się gdy wydarzenie jest usuwane
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
  -- Tylko dla INSERT (nie dla DELETE)
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

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

-- Odtwórz trigger
DROP TRIGGER IF EXISTS trigger_check_vehicle_on_assign ON event_vehicles;
CREATE TRIGGER trigger_check_vehicle_on_assign
  AFTER INSERT ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION check_vehicle_availability_on_assign();
