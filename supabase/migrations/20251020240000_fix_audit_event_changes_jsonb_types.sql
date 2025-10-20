/*
  # Naprawa typów w funkcji audit_event_changes

  1. Problem
    - Kolumny old_value i new_value w event_audit_log są typu jsonb
    - Funkcja audit_event_changes() wstawia text zamiast jsonb
    - Błąd: column "old_value" is of type jsonb but expression is of type text

  2. Rozwiązanie
    - Konwertuj wszystkie wartości text na jsonb używając to_jsonb() lub jsonb_build_object()
*/

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
        to_jsonb(OLD.status),
        to_jsonb(NEW.status),
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
        to_jsonb(OLD.name),
        to_jsonb(NEW.name),
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
        to_jsonb(OLD.location),
        to_jsonb(NEW.location),
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
        to_jsonb(OLD.event_date::text),
        to_jsonb(NEW.event_date::text),
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
        to_jsonb(OLD.budget),
        to_jsonb(NEW.budget),
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
