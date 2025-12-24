/*
  # Update notify_employee_assignment to include initial status

  1. Changes
    - Dodaj assignment_status = 'pending' do metadata przy tworzeniu powiadomienia
    - To zapewnia spójność z dalszą synchronizacją statusu

  2. Context
    - Gdy pracownik otrzymuje zaproszenie, powiadomienie jest tworzone z requires_response = true
    - Teraz dodatkowo ustawiamy assignment_status = 'pending'
    - Gdy status się zmieni (accept/reject), trigger sync_notification_on_assignment_status_change zaktualizuje metadata
*/

CREATE OR REPLACE FUNCTION notify_employee_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  event_record RECORD;
  new_notification_id uuid;
BEGIN
  -- Only send notification for new assignments with pending status
  IF NEW.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Get event details
  SELECT
    e.id as event_id,
    e.name as event_name,
    e.event_date,
    e.event_end_date,
    e.location,
    e.description,
    c.name as category
  INTO event_record
  FROM events e
  LEFT JOIN event_categories c ON e.category_id = c.id
  WHERE e.id = NEW.event_id;

  -- Create notification with action_url to event details
  INSERT INTO notifications (
    category,
    title,
    message,
    type,
    related_entity_type,
    related_entity_id,
    action_url,
    metadata,
    created_at
  ) VALUES (
    'employee',
    'Zaproszenie do zespołu wydarzenia',
    format('Zostałeś zaproszony do zespołu wydarzenia "%s"', event_record.event_name),
    'info',
    'event',
    NEW.event_id::text,
    format('/crm/events/%s', NEW.event_id),
    jsonb_build_object(
      'event_id', NEW.event_id,
      'event_name', event_record.event_name,
      'event_date', event_record.event_date,
      'event_end_date', event_record.event_end_date,
      'location', event_record.location,
      'description', event_record.description,
      'category', event_record.category,
      'role', NEW.role,
      'responsibilities', NEW.responsibilities,
      'assignment_id', NEW.id,
      'assignment_status', 'pending',
      'requires_response', true
    ),
    now()
  ) RETURNING id INTO new_notification_id;

  -- Add recipient (employee being assigned)
  INSERT INTO notification_recipients (notification_id, user_id)
  VALUES (new_notification_id, NEW.employee_id)
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION notify_employee_assignment IS 
  'Tworzy powiadomienie z początkowym statusem "pending" przy dodaniu pracownika do wydarzenia';