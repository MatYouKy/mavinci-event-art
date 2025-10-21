/*
  # Naprawa event_audit_log i aktualizacji przebiegu pojazdu

  1. Problem
    - Funkcje triggerów używają kolumny user_id w event_audit_log, ale jej nie ma
    - Przebieg pojazdu nie jest aktualizowany po handoverze
    - Kolumny old_value i new_value powinny być jsonb

  2. Rozwiązanie
    - Dodaj kolumnę user_id do event_audit_log
    - Zmień old_value i new_value na jsonb
    - Dodaj trigger do aktualizacji przebiegu pojazdu
    - Napraw funkcje triggerów aby działały poprawnie
*/

-- Dodaj brakujące kolumny do event_audit_log jeśli nie istnieją
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE event_audit_log ADD COLUMN user_id uuid REFERENCES employees(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_event_audit_log_user_id ON event_audit_log(user_id);
  END IF;
END $$;

-- Zmień typ kolumn old_value i new_value na jsonb jeśli są text
DO $$
BEGIN
  -- Sprawdź typ kolumny old_value
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' 
    AND column_name = 'old_value' 
    AND data_type = 'text'
  ) THEN
    -- Konwertuj istniejące dane i zmień typ
    ALTER TABLE event_audit_log 
    ALTER COLUMN old_value TYPE jsonb 
    USING CASE 
      WHEN old_value IS NULL THEN NULL 
      ELSE to_jsonb(old_value) 
    END;
  END IF;

  -- Sprawdź typ kolumny new_value
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'event_audit_log' 
    AND column_name = 'new_value' 
    AND data_type = 'text'
  ) THEN
    -- Konwertuj istniejące dane i zmień typ
    ALTER TABLE event_audit_log 
    ALTER COLUMN new_value TYPE jsonb 
    USING CASE 
      WHEN new_value IS NULL THEN NULL 
      ELSE to_jsonb(new_value) 
    END;
  END IF;
END $$;

-- Funkcja do aktualizacji przebiegu pojazdu po handoverze
CREATE OR REPLACE FUNCTION update_vehicle_mileage_on_handover()
RETURNS TRIGGER AS $$
DECLARE
  v_vehicle_id uuid;
BEGIN
  -- Pobierz vehicle_id z event_vehicles
  SELECT vehicle_id INTO v_vehicle_id
  FROM event_vehicles
  WHERE id = NEW.event_vehicle_id;

  -- Aktualizuj przebieg tylko jeśli to jest pojazd z floty (nie zewnętrzny)
  IF v_vehicle_id IS NOT NULL THEN
    UPDATE vehicles
    SET 
      current_mileage = NEW.odometer_reading,
      updated_at = now()
    WHERE id = v_vehicle_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger do aktualizacji przebiegu
DROP TRIGGER IF EXISTS trigger_update_vehicle_mileage ON vehicle_handovers;
CREATE TRIGGER trigger_update_vehicle_mileage
  AFTER INSERT ON vehicle_handovers
  FOR EACH ROW
  EXECUTE FUNCTION update_vehicle_mileage_on_handover();

-- Napraw funkcję log_vehicle_assignment_to_event aby używała prawidłowych kolumn
CREATE OR REPLACE FUNCTION log_vehicle_assignment_to_event()
RETURNS TRIGGER AS $$
DECLARE
  v_event_name text;
  v_vehicle_name text;
  v_employee_name text;
  v_driver_name text;
  v_description text;
  v_user_id uuid;
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

  -- Pobierz ID i nazwę osoby dodającej
  v_user_id := auth.uid();
  SELECT COALESCE(name || ' ' || surname, email)
  INTO v_employee_name
  FROM employees
  WHERE id = v_user_id;

  -- Jeśli nie ma zalogowanego użytkownika, użyj System
  IF v_employee_name IS NULL THEN
    v_employee_name := 'System';
    v_user_id := NULL;
  END IF;

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
    v_user_id,
    v_employee_name,
    'vehicle_assigned',
    'event_vehicles',
    to_jsonb(v_vehicle_name),
    v_description,
    now()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Napraw funkcję log_driver_assignment_to_vehicle
CREATE OR REPLACE FUNCTION log_driver_assignment_to_vehicle()
RETURNS TRIGGER AS $$
DECLARE
  v_event_name text;
  v_vehicle_name text;
  v_employee_name text;
  v_old_driver_name text;
  v_new_driver_name text;
  v_description text;
  v_user_id uuid;
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

  -- Pobierz ID i nazwę użytkownika
  v_user_id := auth.uid();
  SELECT COALESCE(name || ' ' || surname, email)
  INTO v_employee_name
  FROM employees
  WHERE id = v_user_id;

  IF v_employee_name IS NULL THEN
    v_employee_name := 'System';
    v_user_id := NULL;
  END IF;

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
    v_user_id,
    v_employee_name,
    'driver_assigned',
    'driver',
    to_jsonb(v_old_driver_name),
    to_jsonb(v_new_driver_name),
    v_description,
    now()
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Napraw funkcję log_vehicle_handover_to_event_audit
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
    to_jsonb(NEW.odometer_reading::text || ' km'),
    v_action_description,
    NEW.timestamp
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
