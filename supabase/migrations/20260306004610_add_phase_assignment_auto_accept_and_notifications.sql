/*
  # Auto-accept Phase Assignments for Admins + Notifications

  1. Trigger auto-akceptacji dla admina
    - Admin/events_manage automatycznie ma invitation_status = 'accepted'
    - Inni dostają 'pending'
  
  2. Powiadomienia
    - Wysyłaj powiadomienie o nowym zaproszeniu (pending)
    - Wysyłaj powiadomienie o odpowiedzi (accepted/rejected)
*/

-- Function: Auto-accept dla admina przy INSERT
CREATE OR REPLACE FUNCTION auto_accept_phase_assignment_for_admin()
RETURNS TRIGGER AS $$
DECLARE
  emp_record RECORD;
BEGIN
  -- Pobierz dane pracownika
  SELECT role, permissions
  INTO emp_record
  FROM employees
  WHERE id = NEW.employee_id;

  -- Jeśli admin lub events_manage - automatycznie akceptuj
  IF emp_record.role = 'admin' 
     OR 'admin' = ANY(emp_record.permissions)
     OR 'events_manage' = ANY(emp_record.permissions) THEN
    NEW.invitation_status := 'accepted';
    NEW.invitation_responded_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger dla auto-akceptacji
DROP TRIGGER IF EXISTS trigger_auto_accept_phase_assignment ON event_phase_assignments;

CREATE TRIGGER trigger_auto_accept_phase_assignment
  BEFORE INSERT ON event_phase_assignments
  FOR EACH ROW
  EXECUTE FUNCTION auto_accept_phase_assignment_for_admin();

-- Function: Powiadomienie o nowym zaproszeniu do fazy
CREATE OR REPLACE FUNCTION notify_phase_assignment()
RETURNS TRIGGER AS $$
DECLARE
  event_record RECORD;
  phase_record RECORD;
  notification_id uuid;
BEGIN
  -- Tylko dla pending (nie wysyłaj jeśli auto-zaakceptowano)
  IF NEW.invitation_status != 'pending' THEN
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

-- Function: Powiadomienie o odpowiedzi na zaproszenie do fazy
CREATE OR REPLACE FUNCTION notify_phase_assignment_response()
RETURNS TRIGGER AS $$
DECLARE
  phase_record RECORD;
  employee_record RECORD;
  response_text text;
  notification_id uuid;
BEGIN
  -- Tylko gdy status się zmienia z pending
  IF OLD.invitation_status = NEW.invitation_status 
     OR OLD.invitation_status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Pobierz dane
  SELECT 
    ep.name as phase_name,
    e.id as event_id,
    e.name as event_name,
    e.created_by
  INTO phase_record
  FROM event_phases ep
  JOIN events e ON e.id = ep.event_id
  WHERE ep.id = NEW.phase_id;

  SELECT name, surname, nickname
  INTO employee_record
  FROM employees
  WHERE id = NEW.employee_id;

  -- Tekst odpowiedzi
  IF NEW.invitation_status = 'accepted' THEN
    response_text := 'zaakceptował';
  ELSIF NEW.invitation_status = 'rejected' THEN
    response_text := 'odrzucił';
  ELSE
    RETURN NEW;
  END IF;

  -- Utwórz powiadomienie dla twórcy wydarzenia
  INSERT INTO notifications (
    category,
    title,
    message,
    related_entity_type,
    related_entity_id,
    metadata,
    created_at
  ) VALUES (
    'team_response',
    'Odpowiedź na zaproszenie do fazy',
    format('%s %s zaproszenie do fazy "%s" w wydarzeniu "%s"',
      COALESCE(employee_record.nickname, employee_record.name || ' ' || employee_record.surname),
      response_text,
      phase_record.phase_name,
      phase_record.event_name
    ),
    'event_phase_assignment',
    NEW.id,
    jsonb_build_object(
      'event_id', phase_record.event_id,
      'event_name', phase_record.event_name,
      'phase_id', NEW.phase_id,
      'phase_name', phase_record.phase_name,
      'employee_id', NEW.employee_id,
      'employee_name', COALESCE(employee_record.nickname, employee_record.name || ' ' || employee_record.surname),
      'invitation_status', NEW.invitation_status,
      'role', NEW.role
    ),
    now()
  ) RETURNING id INTO notification_id;

  -- Dodaj odbiorcę (twórca wydarzenia)
  INSERT INTO notification_recipients (notification_id, user_id)
  VALUES (notification_id, phase_record.created_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Synchronizacja metadata powiadomienia
CREATE OR REPLACE FUNCTION sync_phase_notification_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  notification_record RECORD;
BEGIN
  -- Tylko przy zmianie invitation_status
  IF OLD.invitation_status = NEW.invitation_status THEN
    RETURN NEW;
  END IF;

  -- Znajdź powiadomienie
  SELECT n.id, n.metadata
  INTO notification_record
  FROM notifications n
  WHERE n.related_entity_type = 'event_phase_assignment'
  AND n.related_entity_id = NEW.id
  AND EXISTS (
    SELECT 1 FROM notification_recipients nr
    WHERE nr.notification_id = n.id
    AND nr.user_id = NEW.employee_id
  )
  ORDER BY n.created_at DESC
  LIMIT 1;

  -- Aktualizuj metadata
  IF notification_record.id IS NOT NULL THEN
    UPDATE notifications
    SET
      metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{invitation_status}',
        to_jsonb(NEW.invitation_status)
      ),
      metadata = jsonb_set(
        metadata,
        '{invitation_responded_at}',
        to_jsonb(NEW.invitation_responded_at)
      ),
      metadata = jsonb_set(
        metadata,
        '{requires_response}',
        to_jsonb(NEW.invitation_status = 'pending')
      )
    WHERE id = notification_record.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Triggery
DROP TRIGGER IF EXISTS notify_phase_assignment ON event_phase_assignments;
DROP TRIGGER IF EXISTS notify_phase_assignment_response ON event_phase_assignments;
DROP TRIGGER IF EXISTS sync_phase_notification_metadata ON event_phase_assignments;

CREATE TRIGGER notify_phase_assignment
  AFTER INSERT ON event_phase_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_phase_assignment();

CREATE TRIGGER notify_phase_assignment_response
  AFTER UPDATE ON event_phase_assignments
  FOR EACH ROW
  EXECUTE FUNCTION notify_phase_assignment_response();

CREATE TRIGGER sync_phase_notification_metadata
  AFTER UPDATE OF invitation_status ON event_phase_assignments
  FOR EACH ROW
  EXECUTE FUNCTION sync_phase_notification_metadata();