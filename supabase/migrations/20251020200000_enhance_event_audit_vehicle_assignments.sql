/*
  # Szczegółowa historia pojazdów w wydarzeniach

  1. Dodaj wpis gdy pojazd jest przypisany do wydarzenia
  2. Dodaj wpis gdy kierowca jest przypisany do pojazdu
  3. Rozszerz wpisy o handoverach o więcej szczegółów
*/

-- Funkcja dodająca wpis gdy pojazd jest dodany do wydarzenia
CREATE OR REPLACE FUNCTION log_vehicle_assignment_to_event()
RETURNS TRIGGER AS $$
DECLARE
  v_event_name text;
  v_vehicle_name text;
  v_employee_name text;
  v_driver_name text;
  v_description text;
BEGIN
  -- Pobierz nazwę wydarzenia
  SELECT name INTO v_event_name FROM events WHERE id = NEW.event_id;

  -- Pobierz nazwę pojazdu lub zewnętrznej firmy
  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT name || ' (' || registration_number || ')'
    INTO v_vehicle_name
    FROM vehicles
    WHERE id = NEW.vehicle_id;
  ELSE
    v_vehicle_name := 'Pojazd zewnętrzny: ' || COALESCE(NEW.external_company_name, 'Nieznany');
  END IF;

  -- Pobierz nazwę osoby dodającej
  SELECT COALESCE(name || ' ' || surname, email)
  INTO v_employee_name
  FROM employees
  WHERE id = auth.uid();

  -- Pobierz nazwę kierowcy jeśli jest przypisany
  IF NEW.driver_id IS NOT NULL THEN
    SELECT name || ' ' || surname
    INTO v_driver_name
    FROM employees
    WHERE id = NEW.driver_id;
  END IF;

  -- Stwórz opis
  v_description := v_employee_name || ' dodał pojazd ' || v_vehicle_name || ' do wydarzenia';

  IF v_driver_name IS NOT NULL THEN
    v_description := v_description || ' i przypisał kierowcę: ' || v_driver_name;
  END IF;

  -- Dodaj wpis do audit log
  INSERT INTO event_audit_log (
    event_id,
    user_id,
    user_name,
    action,
    field_name,
    new_value,
    description,
    created_at
  ) VALUES (
    NEW.event_id,
    auth.uid(),
    v_employee_name,
    'vehicle_assigned',
    'event_vehicles',
    v_vehicle_name,
    v_description,
    now()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja dodająca wpis gdy kierowca jest przypisany/zmieniony
CREATE OR REPLACE FUNCTION log_driver_assignment_to_vehicle()
RETURNS TRIGGER AS $$
DECLARE
  v_event_name text;
  v_vehicle_name text;
  v_employee_name text;
  v_old_driver_name text;
  v_new_driver_name text;
  v_description text;
BEGIN
  -- Tylko gdy zmienia się driver_id
  IF OLD.driver_id IS NOT DISTINCT FROM NEW.driver_id THEN
    RETURN NEW;
  END IF;

  -- Pobierz nazwy
  SELECT name INTO v_event_name FROM events WHERE id = NEW.event_id;

  IF NEW.vehicle_id IS NOT NULL THEN
    SELECT name || ' (' || registration_number || ')'
    INTO v_vehicle_name
    FROM vehicles
    WHERE id = NEW.vehicle_id;
  ELSE
    v_vehicle_name := COALESCE(NEW.external_company_name, 'Pojazd');
  END IF;

  SELECT COALESCE(name || ' ' || surname, email)
  INTO v_employee_name
  FROM employees
  WHERE id = auth.uid();

  -- Stary kierowca
  IF OLD.driver_id IS NOT NULL THEN
    SELECT name || ' ' || surname INTO v_old_driver_name
    FROM employees WHERE id = OLD.driver_id;
  END IF;

  -- Nowy kierowca
  IF NEW.driver_id IS NOT NULL THEN
    SELECT name || ' ' || surname INTO v_new_driver_name
    FROM employees WHERE id = NEW.driver_id;
  END IF;

  -- Stwórz opis
  IF OLD.driver_id IS NULL AND NEW.driver_id IS NOT NULL THEN
    v_description := v_employee_name || ' przypisał kierowcę ' || v_new_driver_name || ' do pojazdu ' || v_vehicle_name;
  ELSIF OLD.driver_id IS NOT NULL AND NEW.driver_id IS NULL THEN
    v_description := v_employee_name || ' usunął przypisanie kierowcy ' || v_old_driver_name || ' z pojazdu ' || v_vehicle_name;
  ELSE
    v_description := v_employee_name || ' zmienił kierowcę pojazdu ' || v_vehicle_name || ' z ' || v_old_driver_name || ' na ' || v_new_driver_name;
  END IF;

  -- Dodaj wpis
  INSERT INTO event_audit_log (
    event_id,
    user_id,
    user_name,
    action,
    field_name,
    old_value,
    new_value,
    description,
    created_at
  ) VALUES (
    NEW.event_id,
    auth.uid(),
    v_employee_name,
    'driver_assigned',
    'driver',
    v_old_driver_name,
    v_new_driver_name,
    v_description,
    now()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Ulepszona funkcja dla handoverów
CREATE OR REPLACE FUNCTION log_vehicle_handover_to_event_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id uuid;
  v_employee_name text;
  v_vehicle_name text;
  v_event_name text;
  v_action_description text;
BEGIN
  -- Pobierz event_id i nazwę wydarzenia
  SELECT event_id, e.name
  INTO v_event_id, v_event_name
  FROM event_vehicles ev
  JOIN events e ON e.id = ev.event_id
  WHERE ev.id = NEW.event_vehicle_id;

  -- Pobierz nazwę pracownika
  SELECT COALESCE(name || ' ' || surname, email)
  INTO v_employee_name
  FROM employees
  WHERE id = NEW.driver_id;

  -- Pobierz nazwę pojazdu
  SELECT COALESCE(
    v.name || ' (' || v.registration_number || ')',
    ev.external_company_name,
    'Pojazd'
  )
  INTO v_vehicle_name
  FROM event_vehicles ev
  LEFT JOIN vehicles v ON v.id = ev.vehicle_id
  WHERE ev.id = NEW.event_vehicle_id;

  -- Stwórz szczegółowy opis akcji
  IF NEW.handover_type = 'pickup' THEN
    v_action_description := v_employee_name || ' odebrał pojazd ' || v_vehicle_name ||
      ' dla wydarzenia "' || v_event_name || '" (stan licznika: ' || NEW.odometer_reading || ' km)';
  ELSE
    v_action_description := v_employee_name || ' zdał pojazd ' || v_vehicle_name ||
      ' po wydarzeniu "' || v_event_name || '" (stan licznika: ' || NEW.odometer_reading || ' km)';
  END IF;

  -- Dodaj notatki jeśli są
  IF NEW.notes IS NOT NULL AND NEW.notes != '' THEN
    v_action_description := v_action_description || '. Uwagi: ' || NEW.notes;
  END IF;

  -- Dodaj wpis do event_audit_log
  INSERT INTO event_audit_log (
    event_id,
    user_id,
    user_name,
    action,
    field_name,
    new_value,
    description,
    created_at
  ) VALUES (
    v_event_id,
    NEW.driver_id,
    v_employee_name,
    CASE WHEN NEW.handover_type = 'pickup' THEN 'vehicle_pickup' ELSE 'vehicle_return' END,
    'vehicle_handover',
    NEW.odometer_reading::text || ' km',
    v_action_description,
    NEW.timestamp
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Triggery
DROP TRIGGER IF EXISTS trigger_log_vehicle_assignment ON event_vehicles;
CREATE TRIGGER trigger_log_vehicle_assignment
  AFTER INSERT ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_assignment_to_event();

DROP TRIGGER IF EXISTS trigger_log_driver_assignment ON event_vehicles;
CREATE TRIGGER trigger_log_driver_assignment
  AFTER UPDATE ON event_vehicles
  FOR EACH ROW
  EXECUTE FUNCTION log_driver_assignment_to_vehicle();

DROP TRIGGER IF EXISTS trigger_log_vehicle_handover ON vehicle_handovers;
CREATE TRIGGER trigger_log_vehicle_handover
  AFTER INSERT ON vehicle_handovers
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_handover_to_event_audit();
