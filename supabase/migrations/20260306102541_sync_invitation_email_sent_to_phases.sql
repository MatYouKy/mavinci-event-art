/*
  # Synchronizacja invitation_email_sent z employee_assignments do event_phase_assignments

  1. Problem
    - employee_assignments ma invitation_email_sent
    - event_phase_assignments też ma invitation_email_sent
    - Nie są synchronizowane

  2. Rozwiązanie
    - Trigger synchronizujący invitation_email_sent przy UPDATE employee_assignments

  3. Flow
    - Kliknięcie "Wyślij zaproszenie" -> Edge Function -> employee_assignments.invitation_email_sent = true
    - Trigger -> synchronizuje do event_phase_assignments dla tego samego pracownika i wydarzenia
    - Trigger notify_phase_assignment -> wysyła powiadomienie bo invitation_email_sent = true
*/

-- Funkcja synchronizująca invitation_email_sent do faz
CREATE OR REPLACE FUNCTION sync_invitation_email_sent_to_phases()
RETURNS TRIGGER AS $$
BEGIN
  -- Tylko gdy invitation_email_sent się zmienia
  IF OLD.invitation_email_sent = NEW.invitation_email_sent THEN
    RETURN NEW;
  END IF;

  -- Aktualizuj wszystkie przypisania do faz dla tego pracownika w tym wydarzeniu
  UPDATE event_phase_assignments
  SET
    invitation_email_sent = NEW.invitation_email_sent,
    invitation_email_sent_at = NEW.invitation_email_sent_at
  WHERE employee_id = NEW.employee_id
  AND phase_id IN (
    SELECT id FROM event_phases WHERE event_id = NEW.event_id
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger synchronizujący
DROP TRIGGER IF EXISTS sync_invitation_email_sent_to_phases ON employee_assignments;

CREATE TRIGGER sync_invitation_email_sent_to_phases
  AFTER UPDATE OF invitation_email_sent ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION sync_invitation_email_sent_to_phases();

COMMENT ON TRIGGER sync_invitation_email_sent_to_phases ON employee_assignments IS
  'Synchronizuje invitation_email_sent do event_phase_assignments';