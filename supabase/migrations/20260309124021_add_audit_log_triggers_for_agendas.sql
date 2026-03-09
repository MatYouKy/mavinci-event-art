/*
  # Add Audit Log Triggers for Event Agendas

  1. Problem
    - Zmiany w tabelach event_agendas, event_agenda_items i event_agenda_notes nie są logowane
    - Użytkownicy nie widzą historii zmian w zakładce Historia

  2. Solution
    - Dodaj triggery log_event_change dla wszystkich trzech tabel
    - Loguj INSERT, UPDATE i DELETE dla każdej tabeli
    - Używamy istniejącej funkcji log_event_change()

  3. Changes
    - event_agendas: triggery AFTER INSERT/UPDATE i BEFORE DELETE
    - event_agenda_items: triggery AFTER INSERT/UPDATE i BEFORE DELETE
    - event_agenda_notes: triggery AFTER INSERT/UPDATE i BEFORE DELETE
*/

-- =====================================================
-- TRIGGERY DLA event_agendas
-- =====================================================

-- DROP istniejących triggerów jeśli istnieją
DROP TRIGGER IF EXISTS log_event_agendas_changes_after ON event_agendas;
DROP TRIGGER IF EXISTS log_event_agendas_changes_before_delete ON event_agendas;

-- Trigger dla INSERT i UPDATE
CREATE TRIGGER log_event_agendas_changes_after
  AFTER INSERT OR UPDATE ON event_agendas
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- Trigger dla DELETE (BEFORE, aby mieć dostęp do OLD)
CREATE TRIGGER log_event_agendas_changes_before_delete
  BEFORE DELETE ON event_agendas
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- =====================================================
-- TRIGGERY DLA event_agenda_items
-- =====================================================

-- DROP istniejących triggerów jeśli istnieją
DROP TRIGGER IF EXISTS log_event_agenda_items_changes_after ON event_agenda_items;
DROP TRIGGER IF EXISTS log_event_agenda_items_changes_before_delete ON event_agenda_items;

-- Trigger dla INSERT i UPDATE
CREATE TRIGGER log_event_agenda_items_changes_after
  AFTER INSERT OR UPDATE ON event_agenda_items
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- Trigger dla DELETE (BEFORE, aby mieć dostęp do OLD)
CREATE TRIGGER log_event_agenda_items_changes_before_delete
  BEFORE DELETE ON event_agenda_items
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- =====================================================
-- TRIGGERY DLA event_agenda_notes
-- =====================================================

-- DROP istniejących triggerów jeśli istnieją
DROP TRIGGER IF EXISTS log_event_agenda_notes_changes_after ON event_agenda_notes;
DROP TRIGGER IF EXISTS log_event_agenda_notes_changes_before_delete ON event_agenda_notes;

-- Trigger dla INSERT i UPDATE
CREATE TRIGGER log_event_agenda_notes_changes_after
  AFTER INSERT OR UPDATE ON event_agenda_notes
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- Trigger dla DELETE (BEFORE, aby mieć dostęp do OLD)
CREATE TRIGGER log_event_agenda_notes_changes_before_delete
  BEFORE DELETE ON event_agenda_notes
  FOR EACH ROW
  EXECUTE FUNCTION log_event_change();

-- =====================================================
-- INFO: Jak to działa
-- =====================================================
/*
  Funkcja log_event_change() automatycznie:

  1. Pobiera event_id z:
     - event_agendas: poprzez agenda.event_id
     - event_agenda_items: poprzez item -> agenda -> event_id
     - event_agenda_notes: poprzez note -> agenda -> event_id

  2. Loguje do event_audit_log:
     - action: 'create' / 'update' / 'delete'
     - entity_type: nazwa tabeli (np. 'event_agenda_items')
     - entity_id: ID zmieninego rekordu
     - old_value / new_value: pełne dane JSONB
     - employee_id: auth.uid() użytkownika wykonującego zmianę

  3. Wpisy są widoczne w:
     - Hook useEventAuditLog()
     - Zakładka "Historia" w szczegółach wydarzenia
     - Z automatycznym formatowaniem i kolorowaniem
*/
