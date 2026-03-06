/*
  # Naprawa systemu powiadomień dla przypisań do faz

  1. Problem
    - Przypisanie do fazy automatycznie wysyłało powiadomienie
    - Powinno wysyłać dopiero po kliknięciu "Wyślij zaproszenie"

  2. Rozwiązanie
    - Dodaj kolumnę invitation_email_sent do event_phase_assignments
    - Trigger powiadomienia sprawdza czy email został wysłany
    - Tylko wtedy gdy invitation_email_sent = true wysyła powiadomienie

  3. Flow
    - Przypisanie do fazy: invitation_email_sent = false, invitation_status = 'pending'
    - Admin auto-akceptacja: invitation_status = 'accepted' (bez powiadomienia)
    - Kliknięcie "Wyślij zaproszenie": ustawia invitation_email_sent = true, wysyła email + powiadomienie
    - Akceptacja przez email: aktualizuje status, synchronizuje do timeline
*/

-- Dodaj kolumnę do event_phase_assignments
ALTER TABLE event_phase_assignments
ADD COLUMN IF NOT EXISTS invitation_email_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS invitation_email_sent_at TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN event_phase_assignments.invitation_email_sent IS
  'Czy zaproszenie zostało wysłane emailem (true po kliknięciu "Wyślij zaproszenie")';

COMMENT ON COLUMN event_phase_assignments.invitation_email_sent_at IS
  'Data i czas wysłania zaproszenia emailem';

-- Aktualizuj funkcję notify_phase_assignment - sprawdzaj invitation_email_sent
CREATE OR REPLACE FUNCTION notify_phase_assignment()
RETURNS TRIGGER AS $$
DECLARE
  event_record RECORD;
  phase_record RECORD;
  notification_id uuid;
BEGIN
  -- Wysyłaj powiadomienie TYLKO gdy:
  -- 1. Status = pending (nie auto-zaakceptowano)
  -- 2. invitation_email_sent = true (kliknięto "Wyślij zaproszenie")
  IF NEW.invitation_status != 'pending' OR NEW.invitation_email_sent != true THEN
    RETURN NEW;
  END IF;

  -- Pobierz dane fazy i wydarzenia
  SELECT
    ep.id as phase_id,
    ep.name as phase_name,
    ep.start_time,
    ep.end_time,
    e.id as event_id,
    e.name as event_name,
    e.created_by,
    ec.name as category_name,
    l.name as location_name
  INTO phase_record
  FROM event_phases ep
  JOIN events e ON e.id = ep.event_id
  LEFT JOIN event_categories ec ON ec.id = e.category_id
  LEFT JOIN locations l ON l.id = e.location_id
  WHERE ep.id = NEW.phase_id;

  -- Utwórz powiadomienie
  INSERT INTO notifications (
    category,
    title,
    message,
    related_entity_type,
    related_entity_id,
    metadata,
    created_at
  ) VALUES (
    'team_invitation',
    'Zaproszenie do fazy wydarzenia',
    format('Zostałeś zaproszony do fazy "%s" w wydarzeniu "%s"',
      phase_record.phase_name,
      phase_record.event_name
    ),
    'event_phase_assignment',
    NEW.id,
    jsonb_build_object(
      'event_id', phase_record.event_id,
      'event_name', phase_record.event_name,
      'phase_id', phase_record.phase_id,
      'phase_name', phase_record.phase_name,
      'phase_start', phase_record.start_time,
      'phase_end', phase_record.end_time,
      'category', phase_record.category_name,
      'location', phase_record.location_name,
      'role', NEW.role,
      'assignment_id', NEW.id,
      'invitation_status', NEW.invitation_status,
      'requires_response', true
    ),
    now()
  ) RETURNING id INTO notification_id;

  -- Dodaj odbiorcę
  INSERT INTO notification_recipients (notification_id, user_id)
  VALUES (notification_id, NEW.employee_id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger dla powiadomień - sprawdza invitation_email_sent
DROP TRIGGER IF EXISTS notify_phase_assignment ON event_phase_assignments;

CREATE TRIGGER notify_phase_assignment
  AFTER INSERT OR UPDATE OF invitation_email_sent ON event_phase_assignments
  FOR EACH ROW
  WHEN (NEW.invitation_email_sent = true AND NEW.invitation_status = 'pending')
  EXECUTE FUNCTION notify_phase_assignment();

COMMENT ON TRIGGER notify_phase_assignment ON event_phase_assignments IS
  'Wysyła powiadomienie tylko po ustawieniu invitation_email_sent = true (kliknięciu "Wyślij zaproszenie")';