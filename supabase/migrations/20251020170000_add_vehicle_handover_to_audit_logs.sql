/*
  # Dodanie wpisu do audit log przy odbiórze/zdaniu pojazdu

  1. Trigger dla event_audit_log
    - Po INSERT w vehicle_handovers, dodaj wpis do event_audit_log
    - Zawiera informacje: kto, kiedy, jakie auto, stan licznika

  2. Widok dla historii pojazdu
    - Łączy vehicle_handovers z event_vehicles i vehicles
    - Pokazuje pełną historię odbiorów/zdań dla pojazdu
*/

-- Funkcja dodająca wpis do event_audit_log po handoverze
CREATE OR REPLACE FUNCTION log_vehicle_handover_to_event_audit()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id uuid;
  v_employee_name text;
  v_vehicle_name text;
  v_action_description text;
BEGIN
  -- Pobierz event_id z event_vehicles
  SELECT event_id INTO v_event_id
  FROM event_vehicles
  WHERE id = NEW.event_vehicle_id;

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

  -- Stwórz opis akcji
  IF NEW.handover_type = 'pickup' THEN
    v_action_description := v_employee_name || ' odebrał pojazd ' || v_vehicle_name ||
      ' (stan licznika: ' || NEW.odometer_reading || ' km)';
  ELSE
    v_action_description := v_employee_name || ' zdał pojazd ' || v_vehicle_name ||
      ' (stan licznika: ' || NEW.odometer_reading || ' km)';
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

-- Trigger
DROP TRIGGER IF EXISTS trigger_log_vehicle_handover ON vehicle_handovers;
CREATE TRIGGER trigger_log_vehicle_handover
  AFTER INSERT ON vehicle_handovers
  FOR EACH ROW
  EXECUTE FUNCTION log_vehicle_handover_to_event_audit();

-- Widok dla historii pojazdu (wszystkie handovery danego pojazdu)
CREATE OR REPLACE VIEW vehicle_handover_history AS
SELECT
  vh.id,
  vh.event_vehicle_id,
  vh.driver_id,
  vh.handover_type,
  vh.odometer_reading,
  vh.timestamp,
  vh.notes,
  ev.event_id,
  ev.vehicle_id,
  e.name as event_name,
  e.event_date,
  e.location as event_location,
  v.name as vehicle_name,
  v.registration_number,
  emp.name || ' ' || emp.surname as driver_name,
  emp.email as driver_email
FROM vehicle_handovers vh
JOIN event_vehicles ev ON ev.id = vh.event_vehicle_id
LEFT JOIN events e ON e.id = ev.event_id
LEFT JOIN vehicles v ON v.id = ev.vehicle_id
LEFT JOIN employees emp ON emp.id = vh.driver_id
ORDER BY vh.timestamp DESC;

-- Grant dostępu do widoku
GRANT SELECT ON vehicle_handover_history TO authenticated;
