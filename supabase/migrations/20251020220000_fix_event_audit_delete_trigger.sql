/*
  # Naprawa triggera audit dla usuwania wydarzeń

  1. Problem
    - Trigger audit_event_changes próbuje dodać wpis do event_audit_log AFTER DELETE
    - Ale wydarzenie jest już usuwane, więc foreign key constraint failuje

  2. Rozwiązanie
    - Zmień trigger DELETE na BEFORE DELETE zamiast AFTER DELETE
    - Lub usuń część DELETE z triggera (bo i tak mamy ON DELETE CASCADE)
*/

-- Opcja 1: Zmień trigger aby był BEFORE DELETE dla DELETE, ale AFTER dla INSERT/UPDATE
CREATE OR REPLACE FUNCTION audit_event_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_user_name text := 'System';
BEGIN
  -- INSERT - nowy event
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO event_audit_log (
      event_id,
      user_name,
      action,
      description
    ) VALUES (
      NEW.id,
      v_user_name,
      'created',
      'Utworzono nowy event: ' || NEW.name
    );
    RETURN NEW;
  END IF;

  -- UPDATE - zmiany w evencie
  IF (TG_OP = 'UPDATE') THEN
    -- Status zmieniony
    IF (OLD.status IS DISTINCT FROM NEW.status) THEN
      INSERT INTO event_audit_log (
        event_id,
        user_name,
        action,
        field_name,
        old_value,
        new_value,
        description
      ) VALUES (
        NEW.id,
        v_user_name,
        'status_changed',
        'status',
        OLD.status,
        NEW.status,
        'Zmieniono status z "' || OLD.status || '" na "' || NEW.status || '"'
      );
    END IF;

    -- Nazwa zmieniona
    IF (OLD.name IS DISTINCT FROM NEW.name) THEN
      INSERT INTO event_audit_log (
        event_id,
        user_name,
        action,
        field_name,
        old_value,
        new_value,
        description
      ) VALUES (
        NEW.id,
        v_user_name,
        'updated',
        'name',
        OLD.name,
        NEW.name,
        'Zmieniono nazwę eventu'
      );
    END IF;

    -- Lokalizacja zmieniona
    IF (OLD.location IS DISTINCT FROM NEW.location) THEN
      INSERT INTO event_audit_log (
        event_id,
        user_name,
        action,
        field_name,
        old_value,
        new_value,
        description
      ) VALUES (
        NEW.id,
        v_user_name,
        'updated',
        'location',
        OLD.location,
        NEW.location,
        'Zmieniono lokalizację eventu'
      );
    END IF;

    -- Data eventu zmieniona
    IF (OLD.event_date IS DISTINCT FROM NEW.event_date) THEN
      INSERT INTO event_audit_log (
        event_id,
        user_name,
        action,
        field_name,
        old_value,
        new_value,
        description
      ) VALUES (
        NEW.id,
        v_user_name,
        'updated',
        'event_date',
        OLD.event_date::text,
        NEW.event_date::text,
        'Zmieniono datę rozpoczęcia eventu'
      );
    END IF;

    -- Budżet zmieniony
    IF (OLD.budget IS DISTINCT FROM NEW.budget) THEN
      INSERT INTO event_audit_log (
        event_id,
        user_name,
        action,
        field_name,
        old_value,
        new_value,
        description
      ) VALUES (
        NEW.id,
        v_user_name,
        'updated',
        'budget',
        OLD.budget::text,
        NEW.budget::text,
        'Zmieniono budżet eventu'
      );
    END IF;

    RETURN NEW;
  END IF;

  -- DELETE - zapisz przed usunięciem
  IF (TG_OP = 'DELETE') THEN
    INSERT INTO event_audit_log (
      event_id,
      user_name,
      action,
      description
    ) VALUES (
      OLD.id,
      v_user_name,
      'deleted',
      'Usunięto event: ' || OLD.name
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Usuń stary trigger
DROP TRIGGER IF EXISTS audit_events_trigger ON events;

-- Stwórz dwa osobne triggery: AFTER dla INSERT/UPDATE, BEFORE dla DELETE
CREATE TRIGGER audit_events_after_trigger
  AFTER INSERT OR UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION audit_event_changes();

CREATE TRIGGER audit_events_before_delete_trigger
  BEFORE DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION audit_event_changes();
