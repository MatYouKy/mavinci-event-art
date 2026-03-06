/*
  # Synchronizacja statusu zaproszenia między employee_assignments a event_phase_assignments

  1. Problem
    - Akceptacja zaproszenia przez email/notyfikację aktualizuje tylko employee_assignments.status
    - event_phase_assignments.invitation_status pozostaje 'pending'
    - Timeline nie pokazuje pracownika jako zaakceptowanego

  2. Rozwiązanie
    - Trigger który synchronizuje status z employee_assignments do wszystkich event_phase_assignments
    - Gdy employee_assignments.status zmienia się na 'accepted' lub 'rejected'
    - Wszystkie przypisania tego pracownika do faz tego wydarzenia dostają ten sam status

  3. Przykład
    - Pracownik akceptuje zaproszenie przez email → employee_assignments.status = 'accepted'
    - Trigger automatycznie ustawia invitation_status = 'accepted' dla wszystkich jego przypisań do faz
*/

-- Funkcja synchronizująca status zaproszenia
CREATE OR REPLACE FUNCTION sync_invitation_status_to_phases()
RETURNS TRIGGER AS $$
BEGIN
  -- Tylko gdy status się zmienia na accepted lub rejected
  IF NEW.status IN ('accepted', 'rejected') AND (OLD.status IS NULL OR OLD.status != NEW.status) THEN
    -- Aktualizuj wszystkie przypisania tego pracownika do faz tego wydarzenia
    UPDATE event_phase_assignments
    SET
      invitation_status = NEW.status,
      updated_at = NOW()
    WHERE
      employee_id = NEW.employee_id
      AND phase_id IN (
        SELECT id FROM event_phases WHERE event_id = NEW.event_id
      )
      AND invitation_status != NEW.status; -- Tylko jeśli status jest inny

    RAISE NOTICE 'Synchronized invitation status % for employee % in event %', NEW.status, NEW.employee_id, NEW.event_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger na employee_assignments
DROP TRIGGER IF EXISTS sync_invitation_status_trigger ON employee_assignments;
CREATE TRIGGER sync_invitation_status_trigger
  AFTER UPDATE OF status ON employee_assignments
  FOR EACH ROW
  EXECUTE FUNCTION sync_invitation_status_to_phases();

-- Dodaj komentarz
COMMENT ON FUNCTION sync_invitation_status_to_phases() IS
  'Synchronizuje status zaproszenia z employee_assignments do event_phase_assignments';