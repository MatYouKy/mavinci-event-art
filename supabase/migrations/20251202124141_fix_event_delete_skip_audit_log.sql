/*
  # Fix Event Deletion - Skip Audit Log for Event DELETE
  
  1. Problem
    - When deleting an event, trigger tries to insert into event_audit_log
    - event_audit_log.event_id has NOT NULL constraint and REFERENCES events(id)
    - After event is deleted, foreign key constraint fails
    - Error: "Key (event_id)=(...) is not present in table events"
  
  2. Solution
    - Modify log_event_change() function to SKIP logging for DELETE on events table
    - Keep DELETE logging for other tables (tasks, assignments, etc.)
    - CASCADE will delete all event_audit_log entries automatically anyway
  
  3. Changes
    - Update log_event_change() function
    - Add check: IF TG_TABLE_NAME = 'events' AND TG_OP = 'DELETE' THEN RETURN OLD
*/

CREATE OR REPLACE FUNCTION log_event_change()
RETURNS TRIGGER AS $$
DECLARE
  v_event_id uuid;
  v_employee_id uuid;
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

  -- Get event_id based on table
  IF TG_TABLE_NAME = 'events' THEN
    v_event_id := COALESCE(NEW.id, OLD.id);
  ELSE
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