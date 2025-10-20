/*
  # Naprawa triggera log_event_change dla usuwania

  1. Problem
    - Trigger log_events_changes jest AFTER DELETE
    - Próbuje dodać wpis do event_audit_log po usunięciu wydarzenia
    - Foreign key constraint failuje

  2. Rozwiązanie
    - Zmień trigger DELETE na BEFORE DELETE
    - Pozostaw INSERT i UPDATE jako AFTER
*/

-- Usuń stary trigger
DROP TRIGGER IF EXISTS log_events_changes ON events;

-- Stwórz dwa osobne triggery: AFTER dla INSERT/UPDATE, BEFORE dla DELETE
CREATE TRIGGER log_events_changes_after
  AFTER INSERT OR UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

CREATE TRIGGER log_events_changes_before_delete
  BEFORE DELETE ON events
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- To samo dla employee_assignments
DROP TRIGGER IF EXISTS log_employee_assignments_changes ON employee_assignments;

CREATE TRIGGER log_employee_assignments_changes_after
  AFTER INSERT OR UPDATE ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

CREATE TRIGGER log_employee_assignments_changes_before_delete
  BEFORE DELETE ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- To samo dla tasks
DROP TRIGGER IF EXISTS log_tasks_changes ON tasks;

CREATE TRIGGER log_tasks_changes_after
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW
  WHEN (NEW.event_id IS NOT NULL)
  EXECUTE FUNCTION log_event_change();

CREATE TRIGGER log_tasks_changes_before_delete
  BEFORE DELETE ON tasks
  FOR EACH ROW
  WHEN (OLD.event_id IS NOT NULL)
  EXECUTE FUNCTION log_event_change();
