-- Drop existing triggers first
DROP TRIGGER IF EXISTS log_events_changes ON events;
DROP TRIGGER IF EXISTS log_employee_assignments_changes ON employee_assignments;
DROP TRIGGER IF EXISTS log_tasks_changes ON tasks;

-- Recreate helper function with proper NULL handling
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
      old_value,
      new_value,
      metadata
    ) VALUES (
      v_event_id,
      v_employee_id,
      'update',
      TG_TABLE_NAME,
      NEW.id::text,
      to_jsonb(OLD),
      to_jsonb(NEW),
      jsonb_build_object('table', TG_TABLE_NAME)
    );
  ELSIF TG_OP = 'DELETE' THEN
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

-- Recreate triggers
CREATE TRIGGER log_events_changes
  AFTER INSERT OR UPDATE OR DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

CREATE TRIGGER log_employee_assignments_changes
  AFTER INSERT OR UPDATE OR DELETE ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- For tasks, check event_id in the function itself
CREATE TRIGGER log_tasks_changes
  AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();