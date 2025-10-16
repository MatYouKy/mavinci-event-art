/*
  # Fix notification text and update function

  1. Changes
    - Change notification title from "Odpowiedź na zaproszenie" to "Odpowiedziano na zaproszenie"
    - This better reflects that the action has been completed (past tense)
*/

-- Recreate the function with corrected notification title
CREATE OR REPLACE FUNCTION notify_assignment_response()
RETURNS TRIGGER AS $$
DECLARE
  event_record RECORD;
  employee_record RECORD;
  response_text text;
  notification_id uuid;
BEGIN
  -- Only send notification when status changes from pending
  IF OLD.status = NEW.status OR OLD.status != 'pending' THEN
    RETURN NEW;
  END IF;

  -- Skip if there's no created_by (shouldn't happen but be safe)
  SELECT created_by INTO event_record FROM events WHERE id = NEW.event_id;
  IF event_record.created_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get event and employee details
  SELECT
    e.id as event_id,
    e.name as event_name,
    e.created_by
  INTO event_record
  FROM events e
  WHERE e.id = NEW.event_id;

  SELECT
    name,
    surname,
    nickname
  INTO employee_record
  FROM employees
  WHERE id = NEW.employee_id;

  -- Set response text based on status
  IF NEW.status = 'accepted' THEN
    response_text := 'zaakceptował';
  ELSIF NEW.status = 'rejected' THEN
    response_text := 'odrzucił';
  ELSE
    RETURN NEW;
  END IF;

  -- Create notification for event creator
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
    'Odpowiedziano na zaproszenie',  -- Changed from "Odpowiedź na zaproszenie"
    format('%s %s zaproszenie do wydarzenia "%s"',
      COALESCE(employee_record.nickname, employee_record.name || ' ' || employee_record.surname),
      response_text,
      event_record.event_name
    ),
    'employee_assignment',
    NEW.id::text,
    jsonb_build_object(
      'event_id', NEW.event_id,
      'event_name', event_record.event_name,
      'employee_id', NEW.employee_id,
      'employee_name', COALESCE(employee_record.nickname, employee_record.name || ' ' || employee_record.surname),
      'status', NEW.status,
      'role', NEW.role
    ),
    now()
  ) RETURNING id INTO notification_id;

  -- Add recipient (event creator)
  INSERT INTO notification_recipients (notification_id, user_id)
  VALUES (notification_id, event_record.created_by)
  ON CONFLICT (notification_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
