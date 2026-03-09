/*
  # Fix log_event_change() to Support Agenda Tables

  1. Problem
    - Funkcja log_event_change() zakłada że wszystkie tabele mają kolumnę event_id
    - Tabele event_agenda_items i event_agenda_notes mają agenda_id zamiast event_id
    - Przez to nie logują zmian do event_audit_log

  2. Solution
    - Rozszerz funkcję log_event_change() aby obsługiwała tabele z agenda_id
    - Dla tabel event_agenda_items i event_agenda_notes:
      * Pobierz agenda_id z NEW/OLD
      * Odczytaj event_id z tabeli event_agendas
      * Użyj tego event_id do logowania

  3. Changes
    - Dodano logikę dla tabel z agenda_id
    - Zachowano backward compatibility dla istniejących tabel
*/

CREATE OR REPLACE FUNCTION log_event_change()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id uuid;
  v_employee_id uuid;
  v_agenda_id uuid;
BEGIN
  -- Get employee_id safely
  BEGIN
    v_employee_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_employee_id := NULL;
  END;

  -- CRITICAL FIX: Skip DELETE for events table to avoid FK constraint violation
  IF TG_TABLE_NAME = 'events' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Get event_id based on table type
  IF TG_TABLE_NAME = 'events' THEN
    -- Direct event table
    v_event_id := COALESCE(NEW.id, OLD.id);
    
  ELSIF TG_TABLE_NAME = 'event_agendas' THEN
    -- Agenda table has event_id directly
    v_event_id := COALESCE(NEW.event_id, OLD.event_id);
    
  ELSIF TG_TABLE_NAME IN ('event_agenda_items', 'event_agenda_notes') THEN
    -- Agenda sub-tables have agenda_id, need to lookup event_id
    v_agenda_id := COALESCE(NEW.agenda_id, OLD.agenda_id);
    
    IF v_agenda_id IS NOT NULL THEN
      SELECT event_id INTO v_event_id
      FROM event_agendas
      WHERE id = v_agenda_id;
    END IF;
    
  ELSE
    -- Other tables have event_id directly
    v_event_id := COALESCE(NEW.event_id, OLD.event_id);
  END IF;

  -- Skip if no event_id
  IF v_event_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Log the change based on the operation
  IF TG_OP = 'INSERT' THEN
    INSERT INTO event_audit_log (
      event_id,
      employee_id,
      action,
      entity_type,
      entity_id,
      new_value,
      metadata
    ) VALUES (
      v_event_id,
      v_employee_id,
      'create',
      TG_TABLE_NAME,
      NEW.id::text,
      to_jsonb(NEW),
      jsonb_build_object('table', TG_TABLE_NAME)
    );
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO event_audit_log (
      event_id,
      employee_id,
      action,
      entity_type,
      entity_id,
      field_name,
      old_value,
      new_value,
      metadata
    ) VALUES (
      v_event_id,
      v_employee_id,
      'update',
      TG_TABLE_NAME,
      NEW.id::text,
      NULL, -- field_name (could be enhanced to show specific field)
      to_jsonb(OLD),
      to_jsonb(NEW),
      jsonb_build_object('table', TG_TABLE_NAME)
    );
  ELSIF TG_OP = 'DELETE' THEN
    -- Log delete for non-event tables (tasks, assignments, etc.)
    INSERT INTO event_audit_log (
      event_id,
      employee_id,
      action,
      entity_type,
      entity_id,
      old_value,
      metadata
    ) VALUES (
      v_event_id,
      v_employee_id,
      'delete',
      TG_TABLE_NAME,
      OLD.id::text,
      to_jsonb(OLD),
      jsonb_build_object('table', TG_TABLE_NAME)
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
